import type { Prisma, PrismaClient, StallMessageChannel, StallTemplateKey } from '@prisma/client';
import {
  type CommRecipient,
  DEFAULT_TEMPLATES,
  type EmailTemplateView,
  type Quote,
  type QuoteLine,
  type ReminderKind,
  type ReminderRow,
  type SendEmailResult,
  type TemplateKeyValue,
  chargeLines,
  depositLines,
  formatInr,
  renderTemplate,
  virtualAccountFor,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { mintAccessLink } from './accounts';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { UnknownRequestError, UnknownTemplateError, WrongTemplateError } from './errors';
import { allocatedNumbers, allocatedZone, factsInclude, refreshStage } from './facts';
import { ensureCoupon } from './onboarding';
import { planToView, quoteContext, quoteFor, toQuoteView } from './quotes';
import { signatureLinkFor } from './signature';
import { MODULE_KEY } from './roles';
import { type RequestScope, UNSCOPED, scopeWhere } from './scope';

/** Vendor communication: the editable letters, who has had one, and the log of
 *  chasing calls.
 *
 *  The rule that shapes this file is one line of the requirement — "Once the
 *  email is sent it should not be sent again." It is enforced by a UNIQUE on
 *  `(requestId, templateKey, channel)` and NOT by a check before the insert,
 *  because a bulk send of two hundred rows and an individual send of one of
 *  them can be in flight at the same moment. A duplicate is reported as a skip,
 *  never as a failure of the whole batch.
 *
 *  ⚠️ The uniqueness is per CHANNEL. A letter goes out by email and by WhatsApp
 *  — the team asked for both, and WhatsApp is the one a village trader actually
 *  reads — and the two are independent: a WhatsApp number that bounced must not
 *  block the email, and a team that emailed in January must still be able to
 *  send the WhatsApp in February. Every screen that asks "has this person been
 *  told" therefore has to say on which channel.
 */

const SEED_BY_KEY = new Map(DEFAULT_TEMPLATES.map((t) => [t.key, t]));

/** Seeds an edition's letters from the defaults. Idempotent; called whenever
 *  templates are read so an edition created before Phase 2 still has them. */
export async function ensureTemplates(db: Db, editionId: string): Promise<void> {
  for (const t of DEFAULT_TEMPLATES) {
    await db.stallEmailTemplate.upsert({
      where: { editionId_key: { editionId, key: t.key } },
      create: {
        editionId,
        key: t.key,
        subject: t.subject,
        body: t.body,
        whatsappBody: t.whatsappBody,
      },
      update: {},
    });
  }
}

export async function listTemplates(db: Db, editionId: string): Promise<EmailTemplateView[]> {
  await ensureTemplates(db, editionId);
  const rows = await db.stallEmailTemplate.findMany({
    where: { editionId },
    orderBy: { key: 'asc' },
  });
  return Promise.all(
    rows.map(async (r) => {
      const seed = SEED_BY_KEY.get(r.key);
      return {
        key: r.key as TemplateKeyValue,
        name: seed?.name ?? r.key,
        description: seed?.description ?? '',
        subject: r.subject,
        body: r.body,
        whatsappBody: r.whatsappBody,
        appliesTo: [...(seed?.appliesTo ?? [])],
        updatedAt: r.updatedAt?.toISOString() ?? null,
        attachment:
          r.attachmentKey && r.attachmentName
            ? { name: r.attachmentName, key: r.attachmentKey, bytes: r.attachmentBytes ?? 0 }
            : null,
      };
    }),
  );
}

export async function updateTemplate(
  db: PrismaClient,
  editionId: string,
  key: StallTemplateKey,
  patch: { subject: string; body: string },
  by: string,
): Promise<void> {
  await ensureTemplates(db, editionId);
  await db.stallEmailTemplate.update({
    where: { editionId_key: { editionId, key } },
    data: { ...patch, updatedAt: new Date(), updatedBy: by },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_email_template.updated',
    subjectRef: `${editionId}:${key}`,
  });
}

export async function setTemplateAttachment(
  db: PrismaClient,
  editionId: string,
  key: StallTemplateKey,
  file: { key: string; name: string; bytes: number } | null,
  by: string,
): Promise<void> {
  await ensureTemplates(db, editionId);
  await db.stallEmailTemplate.update({
    where: { editionId_key: { editionId, key } },
    data: {
      attachmentKey: file?.key ?? null,
      attachmentName: file?.name ?? null,
      attachmentBytes: file?.bytes ?? null,
      updatedAt: new Date(),
      updatedBy: by,
    },
  });
}

// ── Who is due a letter ─────────────────────────────────────────────────────

function suggestedTemplate(requestType: string): TemplateKeyValue {
  return requestType === 'ASHRAM' ? 'SELECTION_ASHRAM' : 'SELECTION_VENDOR';
}

/** Everyone SELECTED, with what has already gone out. Not paginated: the whole
 *  point of the screen is to tick a box against every row and send once, and a
 *  selection list is a few hundred rows at most. */
export async function listRecipients(
  db: Db,
  editionId: string,
  scope: RequestScope = UNSCOPED,
): Promise<CommRecipient[]> {
  const rows = await db.stallRequest.findMany({
    where: { editionId, status: 'SELECTED', ...scopeWhere(scope) },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: true } },
      messages: true,
    },
    orderBy: [{ requestType: 'asc' }, { stallName: 'asc' }],
  });
  return rows.map((r) => {
    const suggested = suggestedTemplate(r.requestType);
    return {
      id: r.id,
      reference: r.reference,
      stallName: r.stallName,
      requesterName: r.requesterName,
      email: r.email,
      requestType: r.requestType,
      stallNumbers: r.allocations.map((a) => a.stall.number),
      suggestedTemplate: suggested,
      sentAt:
        r.messages
          .find((e) => e.templateKey === suggested && e.channel === 'EMAIL')
          ?.sentAt.toISOString() ?? null,
      sentTemplates: r.messages.map((e) => ({
        key: e.templateKey,
        channel: e.channel,
        sentAt: e.sentAt.toISOString(),
      })),
    };
  });
}

// ── Sending ─────────────────────────────────────────────────────────────────

const LINK_TTL_DAYS = 180;

/** Builds every placeholder value for one request.
 *
 *  Minting the access links here, at send time, is deliberate: a bank-form link
 *  that was created when the request was submitted would have been sitting in a
 *  database for months before anybody used it. One is minted when the letter
 *  that carries it goes out, and expires six months later. */
async function templateVars(
  db: PrismaClient,
  r: Awaited<ReturnType<typeof loadForSend>>[number],
  key: StallTemplateKey,
  deps: StallsDeps,
  by: string,
): Promise<Record<string, string>> {
  // 🔴 The stall number renders as a blank until the stall has CHECKED IN, and
  // the seeded letters do not ask for it before then. Telling a requester their
  // number in advance is the thing the team asked not to happen: "some of them
  // come in advance, they look at where the stall is, they'll come and fight
  // with you — I don't want this location". It is handed over at the counter
  // with the wristbands, where somebody is standing there to have that
  // conversation. The placeholder stays available for a letter an admin writes
  // to go out afterwards.
  const numbers = r.checkIn ? allocatedNumbers(r) : [];
  const vars: Record<string, string> = {
    requesterName: r.requesterName,
    stallName: r.stallName,
    reference: r.reference,
    stallNumbers: numbers.join(', '),
    // The AREA is told early, and has to be: the rent depends on it, so a
    // requester cannot be asked to pay without knowing it.
    zoneCode: allocatedZone(r) ?? r.agreedZoneCode ?? r.preferredZoneCode,
    editionName: r.edition.name,
    virtualAccountRent:
      virtualAccountFor(
        {
          rentPrefix: r.edition.virtualAccountRentPrefix,
          depositPrefix: r.edition.virtualAccountDepositPrefix,
        },
        r.contactNumber,
        'RENT',
      ) ?? '',
    virtualAccountDeposit:
      virtualAccountFor(
        {
          rentPrefix: r.edition.virtualAccountRentPrefix,
          depositPrefix: r.edition.virtualAccountDepositPrefix,
        },
        r.contactNumber,
        'DEPOSIT',
      ) ?? '',
  };

  const statusLink = await mintAccessLink(db, {
    accountId: r.accountId,
    requestId: r.id,
    purpose: 'STATUS',
    ttlDays: 365,
  });
  vars.statusUrl = deps.statusUrl(statusLink.token);

  if (key === 'SELECTION_VENDOR' && r.requestType === 'VENDOR') {
    const bank = await mintAccessLink(db, {
      accountId: r.accountId,
      requestId: r.id,
      purpose: 'BANK_FORM',
      ttlDays: LINK_TTL_DAYS,
    });
    vars.bankFormUrl = deps.bankFormUrl(bank.token);
    // The agreement goes out for signature with the same letter. A provider
    // that is not configured yields no URL and the placeholder renders empty,
    // rather than the letter failing to send.
    vars.signatureUrl = (await signatureLinkFor(db, r.id, deps, by)) ?? '';
  }

  if (key === 'PAYMENT_DETAILS') {
    const plan = r.paymentPlan;
    const live = quoteFor(r, await quoteContext(db, r.editionId));
    const view = plan ? planToView(plan) : toQuoteView(live);
    // What is actually owed, which is the quoted figure unless the team agreed
    // a concession — see `payableFeePaise`.
    vars.feeTotal = formatInr(view.payableFeePaise);
    vars.depositTotal = formatInr(view.depositTotalPaise);
    vars.grandTotal = formatInr(view.payableFeePaise + view.depositTotalPaise);
    vars.gstAmount = formatInr(view.gstPaise);
    vars.netAmount = formatInr(view.netPaise);
    vars.stallDeposit = formatInr(view.stallDepositPaise);
    vars.equipmentDeposit = formatInr(view.equipmentDepositPaise);

    // 🔴 The FROZEN lines where there are any. The plan is what the vendor was
    // told; a re-send that recomputed them would print a breakdown that no
    // longer sums to the total beside it. Plans frozen before the column
    // existed have none, and the letter then falls back to the summed figures
    // it has always printed.
    const frozen = (plan?.lines ?? null) as QuoteLine[] | null;
    const forLetter: Quote | null = frozen
      ? { ...view, lines: frozen, exempt: false }
      : (live ?? null);
    vars.charges = forLetter ? chargeLines(forLetter) : '';
    vars.depositBreakdown = forLetter ? depositLines(forLetter) : '';
  }

  if (key === 'ONBOARDING_FSSAI_STAFF' || key === 'SELECTION_ASHRAM') {
    const coupon = await ensureCoupon(db, r.id, r.stallName, r.edition.year, by);
    vars.staffCouponCode = coupon.code;
    vars.staffRegistrationUrl = deps.staffRegistrationUrl(coupon.code);
    if (r.stallType === 'FOOD') {
      const fssai = await mintAccessLink(db, {
        accountId: r.accountId,
        requestId: r.id,
        purpose: 'FSSAI_UPLOAD',
        ttlDays: LINK_TTL_DAYS,
      });
      vars.fssaiUrl = deps.fssaiUrl(fssai.token);
    }
  }

  return vars;
}

function loadForSend(db: PrismaClient, ids: string[]) {
  return db.stallRequest.findMany({
    where: { id: { in: ids } },
    include: { ...factsInclude, edition: true },
  });
}

/** Sends one template to many requests. Never throws for a single bad row —
 *  the caller gets a list of what went and a list of what did not, with a
 *  reason per row, because the screen has to show both. */
export async function sendTemplate(
  db: PrismaClient,
  editionId: string,
  input: {
    templateKey: StallTemplateKey;
    requestIds: string[];
    channels?: StallMessageChannel[];
  },
  deps: StallsDeps,
  by: string,
): Promise<SendEmailResult> {
  await ensureTemplates(db, editionId);
  const template = await db.stallEmailTemplate.findUnique({
    where: { editionId_key: { editionId, key: input.templateKey } },
  });
  if (!template) throw new UnknownTemplateError(input.templateKey);
  const seed = SEED_BY_KEY.get(input.templateKey);
  const appliesTo = new Set<string>(seed?.appliesTo ?? []);

  const attachment =
    template.attachmentKey && template.attachmentName && deps.files.configured()
      ? {
          filename: template.attachmentName,
          url: await deps.files.presignView(template.attachmentKey),
        }
      : null;

  const rows = await loadForSend(db, input.requestIds);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const sent: string[] = [];
  const skipped: SendEmailResult['skipped'] = [];
  const byChannel: Record<string, number> = { EMAIL: 0, WHATSAPP: 0 };
  const channels: StallMessageChannel[] = input.channels?.length
    ? input.channels
    : ['EMAIL', 'WHATSAPP'];

  for (const id of input.requestIds) {
    const r = byId.get(id);
    if (!r) {
      skipped.push({ requestId: id, reason: 'no such request' });
      continue;
    }
    if (r.status !== 'SELECTED') {
      skipped.push({ requestId: id, reason: `request is ${r.status.toLowerCase()}, not selected` });
      continue;
    }
    if (!appliesTo.has(r.requestType)) {
      // The guard that keeps the vendor letter — and its bank-form link — away
      // from an ashram department.
      skipped.push({
        requestId: id,
        reason: `this letter is not for a ${r.requestType.toLowerCase()} request`,
      });
      continue;
    }
    // Already sent on EVERY channel being asked for is a skip; already sent on
    // some of them is not — the remaining ones still go.
    const already = new Set(
      r.messages.filter((e) => e.templateKey === input.templateKey).map((e) => e.channel),
    );
    const todo = channels.filter((c) => !already.has(c));
    if (todo.length === 0) {
      skipped.push({ requestId: id, reason: 'already sent' });
      continue;
    }

    const vars = await templateVars(db, r, input.templateKey, deps, by);
    const subject = renderTemplate(template.subject, vars);

    let anySent = false;
    const failures: string[] = [];

    for (const channel of todo) {
      const isEmail = channel === 'EMAIL';
      const rawBody = isEmail ? template.body : template.whatsappBody;
      // A template with no WhatsApp wording is email-only by design — an
      // absence, not a failure, so it is not reported as one.
      if (!rawBody.trim()) continue;
      const text = renderTemplate(rawBody, vars);
      const to = isEmail ? r.email : r.contactNumber;

      try {
        // The log row is written FIRST. If two senders race, one insert loses
        // on the unique constraint and that requester gets exactly one letter
        // on that channel — the opposite order would send twice and record
        // once.
        await db.stallMessageLog.create({
          data: {
            requestId: r.id,
            templateKey: input.templateKey,
            channel,
            sentTo: to,
            subject,
            sentBy: by,
          },
        });
      } catch {
        continue;
      }

      try {
        if (isEmail) {
          await deps.mail.send({
            to,
            subject,
            text,
            attachments: attachment ? [attachment] : undefined,
          });
        } else {
          // No attachment: WhatsApp carries the short wording, and the zone map
          // rides on the email that goes out beside it.
          await deps.whatsapp.send({ to, text });
        }
      } catch {
        // Logged as sent and the transport failed. Undo the log so the row can
        // be retried — an unsent letter recorded as sent is the one failure
        // this screen cannot recover from on its own.
        await db.stallMessageLog.deleteMany({
          where: { requestId: r.id, templateKey: input.templateKey, channel },
        });
        failures.push(channel);
        continue;
      }

      byChannel[channel] = (byChannel[channel] ?? 0) + 1;
      anySent = true;
    }

    if (!anySent) {
      skipped.push({
        requestId: id,
        reason: failures.length
          ? `could not be delivered on ${failures.join(', ').toLowerCase()} — try again`
          : 'nothing to send on the chosen channels',
      });
      continue;
    }
    // ⚠️ One channel getting through is enough to move the request on. The
    // requester has been told; chasing the other channel is a separate job, and
    // holding the whole onboarding back for it would strand a vendor who read
    // the WhatsApp and is waiting to pay.
    if (failures.length > 0) {
      skipped.push({
        requestId: id,
        reason: `sent, but ${failures.join(', ').toLowerCase()} failed`,
      });
    }

    if (input.templateKey === 'PAYMENT_DETAILS') await freezePaymentPlan(db, r.id);
    await refreshStage(db, r.id);
    await recordActivity(db, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_message.sent',
      subjectRef: r.id,
      detail: { templateKey: input.templateKey, channels: todo, failures },
    });
    sent.push(id);
  }

  return { sent, skipped, byChannel };
}

/** Freezes the amount quoted in the payment email. See `StallPaymentPlan`. */
export async function freezePaymentPlan(db: PrismaClient, requestId: string): Promise<void> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: factsInclude,
  });
  if (!r) throw new UnknownRequestError(requestId);
  const q = quoteFor(r, await quoteContext(db, r.editionId));
  if (!q || q.exempt) return;
  await db.stallPaymentPlan.upsert({
    where: { requestId },
    create: {
      requestId,
      stallFeePaise: q.stallFeePaise,
      plugFeePaise: q.plugFeePaise,
      equipmentFeePaise: q.equipmentFeePaise,
      netPaise: q.netPaise,
      gstPaise: q.gstPaise,
      feeTotalPaise: q.feeTotalPaise,
      stallDepositPaise: q.stallDepositPaise,
      equipmentDepositPaise: q.equipmentDepositPaise,
      depositTotalPaise: q.depositTotalPaise,
      // 🔴 The itemisation, frozen with the sums. The letter prints the
      // arithmetic, and recomputing it on a re-send would produce lines that no
      // longer add up to the total beside them the moment a vendor revises
      // their plug points.
      // ⚠️ Cast, because Prisma's JSON input type does not accept a typed
      // interface array directly. The shape is `QuoteLine[]` and `quote.ts`
      // owns it; this is the one place it crosses into a JSON column.
      lines: q.lines as unknown as Prisma.InputJsonValue,
    },
    // Never re-quoted: the vendor was told a number and that is the number.
    update: {},
  });
}

/** Re-sending is an admin act, not an accident: it clears the log row so the
 *  next send goes through. Recorded on the trail, because "why did this vendor
 *  get two letters" has to be answerable. */
export async function clearSendLog(
  db: PrismaClient,
  requestId: string,
  key: StallTemplateKey,
  by: string,
): Promise<void> {
  const deleted = await db.stallMessageLog.deleteMany({ where: { requestId, templateKey: key } });
  if (deleted.count === 0) throw new WrongTemplateError(key, 'has not been sent to this request');
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_email.unsent',
    subjectRef: requestId,
    detail: { templateKey: key },
  });
}

// ── Reminder calls ──────────────────────────────────────────────────────────

/** Who is holding up the bank form or the payment, with the call history. The
 *  requirement lists this twice — once under bank details and once under
 *  payment — and it is one table with a `kind`. */
export async function listReminders(
  db: Db,
  editionId: string,
  kind: ReminderKind,
  scope: RequestScope = UNSCOPED,
): Promise<ReminderRow[]> {
  const rows = await db.stallRequest.findMany({
    where: {
      editionId,
      status: 'SELECTED',
      ...scopeWhere(scope),
      ...(kind === 'BANK'
        ? { requestType: 'VENDOR', bankDetail: null }
        : { requestType: { in: ['VENDOR', 'LOCAL_WELFARE'] }, payments: { none: {} } }),
    },
    include: { reminders: { where: { kind }, orderBy: { calledAt: 'desc' } } },
    orderBy: { stallName: 'asc' },
  });
  return rows.map((r) => ({
    requestId: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    contactNumber: r.contactNumber,
    email: r.email,
    kind,
    callCount: r.reminders.length,
    lastCalledAt: r.reminders[0]?.calledAt.toISOString() ?? null,
  }));
}

export async function logReminder(
  db: PrismaClient,
  requestId: string,
  input: { kind: ReminderKind; note?: string },
  by: string,
): Promise<void> {
  const exists = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { id: true },
  });
  if (!exists) throw new UnknownRequestError(requestId);
  await db.stallReminderCall.create({
    data: { requestId, kind: input.kind, note: input.note ?? null, calledBy: by },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_reminder.logged',
    subjectRef: requestId,
    detail: { kind: input.kind },
  });
}

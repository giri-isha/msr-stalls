import type { Prisma, PrismaClient, StallEmailTemplateKey } from '@prisma/client';
import {
  type CommsRow,
  DEFAULT_TEMPLATES,
  type EmailLogRow,
  OPTIONAL_PLACEHOLDERS,
  PLACEHOLDERS,
  type SendEmailInput,
  type SendResult,
  TEMPLATE_KEYS,
  type TemplateKey,
  type TemplatePreview,
  formatInr,
  renderTemplate,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { linksFor } from './config';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { AlreadySentError, NotSelectedError, UnknownRequestError } from './errors';
import { publicUrl } from './links';
import { ensureQuote } from './payments';
import { MODULE_KEY } from './roles';
import { advanceStage } from './stage';

/** Sent once, ever, unless `force`: the requirement is explicit for the
 *  selection confirmation, and the post-payment mail carries a coupon that
 *  must not be re-issued by accident. Reminders and the payment details may
 *  repeat. */
const SEND_ONCE = new Set<TemplateKey>([
  'SELECTION_VENDOR',
  'SELECTION_ASHRAM',
  'SELECTION_LOCAL_WELFARE',
  'POST_PAYMENT',
]);

const SELECTION_FOR: Record<string, TemplateKey> = {
  VENDOR: 'SELECTION_VENDOR',
  LOCAL_WELFARE: 'SELECTION_LOCAL_WELFARE',
  ASHRAM: 'SELECTION_ASHRAM',
  ASHRAM_FOOD: 'SELECTION_ASHRAM',
};

export async function listTemplates(db: Db, editionId: string) {
  const rows = await db.stallEmailTemplate.findMany({ where: { editionId } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return TEMPLATE_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      subject: row?.subject ?? DEFAULT_TEMPLATES[key].subject,
      body: row?.body ?? DEFAULT_TEMPLATES[key].body,
      attachmentKey: row?.attachmentKey ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      placeholders: PLACEHOLDERS[key],
    };
  });
}

export async function upsertTemplate(
  db: PrismaClient,
  editionId: string,
  key: StallEmailTemplateKey,
  input: { subject: string; body: string; attachmentKey?: string | null },
  by: string,
) {
  const row = await db.stallEmailTemplate.upsert({
    where: { editionId_key: { editionId, key } },
    create: {
      editionId,
      key,
      subject: input.subject,
      body: input.body,
      attachmentKey: input.attachmentKey ?? null,
      updatedBy: by,
    },
    update: {
      subject: input.subject,
      body: input.body,
      attachmentKey: input.attachmentKey ?? null,
      updatedBy: by,
    },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_email_template.updated',
    subjectRef: editionId,
    detail: { key },
  });
  return row;
}

const withBits = {
  allocations: { where: { releasedAt: null }, include: { stall: { include: { zone: true } } } },
  edition: { select: { name: true, id: true } },
  payment: true,
  staffCoupon: true,
} satisfies Prisma.StallRequestInclude;
type Req = Prisma.StallRequestGetPayload<{ include: typeof withBits }>;

/** Everything a template may mention, for one request. Links are minted here,
 *  so a preview mints too — acceptable, they expire. */
export async function templateVars(
  db: Db,
  r: Req,
  key: TemplateKey,
  deps: Pick<StallsDeps, 'linkUrl'>,
): Promise<Record<string, string>> {
  const links = await linksFor(db, r.editionId);
  const need = new Set(PLACEHOLDERS[key]);
  const vars: Record<string, string> = {
    requesterName: r.requesterName,
    stallName: r.stallName,
    reference: r.reference,
    stallNumbers: r.allocations.map((a) => a.stall.number).join(', '),
    zone: r.allocations[0]?.stall.zone.code ?? r.preferredZoneCode,
    editionName: r.edition.name,
    termsUrl: links.termsUrl ?? '',
    bankInstructions: links.bankInstructions ?? '',
    fssaiProcessUrl: links.fssaiProcessUrl ?? '',
    staffRegistrationUrl: links.staffRegistrationUrl ?? '',
    couponCode: r.staffCoupon?.code ?? '',
    maxStaff: r.staffCoupon ? String(r.staffCoupon.maxStaff) : String(r.passesStaff),
  };
  if (need.has('statusUrl')) vars.statusUrl = await publicUrl(db, r, 'STATUS', deps);
  if (need.has('bankFormUrl')) vars.bankFormUrl = await publicUrl(db, r, 'BANK_FORM', deps);
  if (need.has('fssaiUploadUrl'))
    vars.fssaiUploadUrl = await publicUrl(db, r, 'FSSAI_UPLOAD', deps);
  if (need.has('billLines') || need.has('totalPayable')) {
    const p = r.payment;
    if (p) {
      const lines: Array<[string, number]> = [
        ['Stall rent', p.stallFeePaise],
        ['Plug points', p.plugPointsFeePaise],
        ['Chairs & tables', p.furnitureFeePaise],
        [`GST ${p.gstPercent}%`, p.gstPaise],
        ['Security deposit (refundable)', p.stallDepositPaise],
        ['Chairs & tables advance (refundable)', p.furnitureDepositPaise],
      ];
      vars.billLines = lines
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}: ${formatInr(v)}`)
        .join('\n');
      vars.totalPayable = formatInr(p.totalPayablePaise);
    }
  }
  return vars;
}

async function templateFor(db: Db, editionId: string, key: TemplateKey) {
  const row = await db.stallEmailTemplate.findUnique({
    where: { editionId_key: { editionId, key } },
  });
  return {
    subject: row?.subject ?? DEFAULT_TEMPLATES[key].subject,
    body: row?.body ?? DEFAULT_TEMPLATES[key].body,
  };
}

export async function previewTemplate(
  db: Db,
  editionId: string,
  key: TemplateKey,
  requestId: string,
  deps: Pick<StallsDeps, 'linkUrl'>,
): Promise<TemplatePreview> {
  const r = await db.stallRequest.findUnique({ where: { id: requestId }, include: withBits });
  if (!r) throw new UnknownRequestError(requestId);
  const tpl = await templateFor(db, editionId, key);
  const vars = await templateVars(db, r, key, deps);
  const s = renderTemplate(tpl.subject, vars);
  const b = renderTemplate(tpl.body, vars);
  return { subject: s.text, body: b.text, missing: [...new Set([...s.missing, ...b.missing])] };
}

/** Send one template to many requests. Each request is its own unit: a skip or
 *  a failure on one never stops the rest, and the result says which was which. */
export async function sendEmails(
  db: PrismaClient,
  editionId: string,
  input: SendEmailInput,
  by: string,
  deps: Pick<StallsDeps, 'linkUrl' | 'mail'>,
): Promise<SendResult> {
  const key = input.templateKey as TemplateKey;
  const tpl = await templateFor(db, editionId, key);
  const result: SendResult = { sent: [], skipped: [], failed: [] };

  for (const requestId of input.requestIds) {
    const r = await db.stallRequest.findUnique({ where: { id: requestId }, include: withBits });
    if (!r) {
      result.skipped.push({ requestId, reason: 'unknown request' });
      continue;
    }
    if (r.status !== 'SELECTED') {
      result.skipped.push({ requestId, reason: 'not selected' });
      continue;
    }
    if (key.startsWith('SELECTION_') && SELECTION_FOR[r.requestType] !== key) {
      result.skipped.push({
        requestId,
        reason: `${key} is not the template for a ${r.requestType} request`,
      });
      continue;
    }
    if (SEND_ONCE.has(key) && !input.force) {
      const prior = await db.stallEmailLog.findFirst({
        where: { requestId, templateKey: key, status: 'SENT' },
      });
      if (prior) {
        result.skipped.push({ requestId, reason: 'already sent' });
        continue;
      }
    }
    if (key === 'PAYMENT_DETAILS' || key === 'PAYMENT_REMINDER') {
      // The bill must exist to be quoted. Quoting is idempotent.
      await ensureQuote(db, requestId, by);
    }
    const fresh = await db.stallRequest.findUnique({ where: { id: requestId }, include: withBits });
    if (!fresh) continue;
    const vars = await templateVars(db, fresh, key, deps);
    const s = renderTemplate(tpl.subject, vars);
    const b = renderTemplate(tpl.body, vars);
    const missing = [...new Set([...s.missing, ...b.missing])].filter(
      (m) => !OPTIONAL_PLACEHOLDERS.has(m),
    );
    if (missing.length && !input.force) {
      result.skipped.push({ requestId, reason: `missing: ${missing.join(', ')}` });
      continue;
    }

    try {
      await deps.mail.send({ to: fresh.email, subject: s.text, text: b.text });
      await db.stallEmailLog.create({
        data: {
          requestId,
          templateKey: key,
          toEmail: fresh.email,
          subject: s.text,
          status: 'SENT',
          sentBy: by,
        },
      });
      if (key.startsWith('SELECTION_')) await advanceStage(db, requestId, 'CONFIRMATION_SENT');
      if (key === 'PAYMENT_DETAILS') {
        await db.stallPayment.update({ where: { requestId }, data: { emailSentAt: new Date() } });
        await advanceStage(db, requestId, 'PAYMENT_SENT');
      }
      await recordActivity(db, {
        actorRef: by,
        moduleKey: MODULE_KEY,
        action: 'stall_email.sent',
        subjectRef: requestId,
        detail: { key, to: fresh.email },
      });
      result.sent.push(requestId);
    } catch (e) {
      const error = (e as Error).message;
      await db.stallEmailLog.create({
        data: {
          requestId,
          templateKey: key,
          toEmail: fresh.email,
          subject: s.text,
          status: 'FAILED',
          error,
          sentBy: by,
        },
      });
      result.failed.push({ requestId, error });
    }
  }
  return result;
}

/** Throws the specific error for a single-request send, for the route that
 *  sends to one vendor and wants a 409 rather than a skipped list. */
export async function sendOne(
  db: PrismaClient,
  editionId: string,
  requestId: string,
  key: TemplateKey,
  by: string,
  deps: Pick<StallsDeps, 'linkUrl' | 'mail'>,
  force = false,
): Promise<void> {
  const r = await sendEmails(
    db,
    editionId,
    { requestIds: [requestId], templateKey: key, force },
    by,
    deps,
  );
  if (r.sent.includes(requestId)) return;
  const skip = r.skipped[0]?.reason ?? r.failed[0]?.error ?? 'not sent';
  if (skip === 'already sent') throw new AlreadySentError(requestId, key);
  if (skip === 'not selected') throw new NotSelectedError(requestId);
  throw new Error(skip);
}

export async function listEmailLog(db: Db, requestId: string): Promise<EmailLogRow[]> {
  const rows = await db.stallEmailLog.findMany({
    where: { requestId },
    orderBy: { sentAt: 'desc' },
  });
  return rows.map((l) => ({
    id: l.id,
    templateKey: l.templateKey,
    toEmail: l.toEmail,
    subject: l.subject,
    status: l.status,
    error: l.error,
    sentAt: l.sentAt.toISOString(),
    sentBy: l.sentBy,
  }));
}

/** Selected requests with the last time each template went out — the
 *  Communication screen's list, with its "not sent yet" checkboxes. */
export async function commsRows(
  db: Db,
  editionId: string,
  q: { requestType?: string },
): Promise<CommsRow[]> {
  const rows = await db.stallRequest.findMany({
    where: {
      editionId,
      status: 'SELECTED',
      ...(q.requestType ? { requestType: q.requestType as never } : {}),
    },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: true } },
      emailLogs: { where: { status: 'SENT' }, orderBy: { sentAt: 'desc' } },
    },
    orderBy: [{ requestType: 'asc' }, { stallName: 'asc' }],
  });
  return rows.map((r) => {
    const lastSent: Record<string, string> = {};
    for (const l of r.emailLogs)
      if (!lastSent[l.templateKey]) lastSent[l.templateKey] = l.sentAt.toISOString();
    return {
      id: r.id,
      reference: r.reference,
      requestType: r.requestType,
      stallName: r.stallName,
      requesterName: r.requesterName,
      email: r.email,
      status: r.status,
      stage: r.stage,
      allocatedStalls: r.allocations.map((a) => a.stall.number),
      lastSent,
    };
  });
}

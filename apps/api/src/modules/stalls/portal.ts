import type { PrismaClient, StallAccount } from '@prisma/client';
import {
  type ContinueStepInput,
  type FlowConfig,
  type PublicBankDetails,
  type PublicBeneficiary,
  type PublicFssaiDetails,
  type PublicPaymentDue,
  type QuoteLine,
  type QuoteView,
  type PublicStaffCoupon,
  type PublicStatusResponse,
  type RequestCouponInput,
  type SubmittedRequest,
  submittedSections,
  type OnboardingStep,
  type SelfServeStepValue,
  isSelfServe,
  isStepAsked,
  gstPercentOf,
  virtualAccountFor,
} from '@stalls/core';
import { audit, requesterActor } from './audit';
import { findAccountByContact, mintAccessLink } from './accounts';
import { flowFor } from './config';
import { claimsFor } from './payment-claims';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { StepLockedError, StepNotOpenError, UnknownAccessLinkError } from './errors';
import {
  type RequestWithFacts,
  blockedByFor,
  factsInclude,
  gatedFor,
  registeredOn,
  staffExpected,
  stepLockedFor,
} from './facts';
import type { Mailer } from './mailer';
import { ensureCoupon } from './onboarding';
import { planToView, quoteContext, quoteFor, toQuoteView } from './quotes';
import { STATUS_LINK_TTL_DAYS } from './submit';

/** The vendor's own portal: getting back in, seeing what is outstanding, and
 *  opening the one form that is theirs to fill.
 *
 *  TWO credentials arrive here and the functions below know neither:
 *
 *    • the signed LINK the receipt email carries. "Getting back in" is then:
 *      name the mailbox or the number you applied under, and a fresh link is
 *      sent THERE. Nothing is shown to the person typing, so this cannot be
 *      used to ask whether somebody has applied.
 *    • the SESSION of a requester who registered and logged in — see
 *      `session.ts`. The newer of the two, and the one that outlives the
 *      password when the host's Isha OIDC lands.
 *
 *  The link is not going away when it does: those links are in inboxes now and
 *  are held by the vendors furthest through onboarding.
 */

/** Same TTL as a selection email's links, and for the same reason: a form that
 *  sat open in a tab for six months should be reopened, not resumed. */
const STEP_LINK_TTL_DAYS = 180;

/** A request as the portal reads it: the shared facts, plus the edition
 *  prefixes the virtual accounts are built from. */
type PortalRequest = RequestWithFacts & {
  edition: {
    virtualAccountRentPrefix: string | null;
    virtualAccountDepositPrefix: string | null;
    beneficiaryName: string | null;
    beneficiaryAddress: string | null;
    bankAccountType: string | null;
    bankName: string | null;
    bankIfsc: string | null;
    bankBranch: string | null;
  };
  ashramDetail: AshramDetail | null;
  appliances: Array<{ name: string; watts: number }>;
  customValues: Array<{ value: string; field: { label: string } }>;
};

type AshramDetail = {
  department: string;
  departmentHead: string;
  departmentHeadContact: string;
  requestedBy: string;
  requesterContact: string;
  usage: string;
  usageOther: string | null;
  creditCardNeeded: boolean;
  wantsThembu: boolean;
  fssaiExpected: boolean | null;
};

/** Mints a status link and mails it, if the contact matches an account.
 *
 *  Returns nothing either way. The route answers `{ ok: true }` whichever
 *  happened — a caller must not be able to use this to learn whether an address
 *  has applied, and a timing difference is not worth defending against here
 *  because the two paths differ by one indexed lookup. */
export async function sendAccessLink(db: Db, deps: AccessLinkDeps, contact: string): Promise<void> {
  const account = await findAccountByContact(db, contact);
  if (!account) return;

  // ⚠️ Only a HIT is recorded. A row per miss would make the log a way of
  // reading which contacts have an account — the one thing this route's
  // identical answers exist to prevent.
  await audit(db, {
    actor: requesterActor(account.id, account.displayName),
    action: 'stall_account.access_link_requested',
    subject: { type: 'account', ref: account.id },
  });

  try {
    await deliverAccessLink(db, deps, account);
  } catch {
    // Logged by the mailer. A transport failure must not become a different
    // response from "no such account" — the vendor asks again, or calls.
  }
}

export type AccessLinkDeps = { mail: Mailer; statusUrl(token: string): string };

/**
 * Mints a status link for an account already in hand, and mails it.
 *
 * ⚠️ This one THROWS where `sendAccessLink` swallows, and the difference is
 * the whole reason it is a separate function. The public route must answer
 * identically whether or not the contact matched, so a send failure there has
 * to look like a miss. The backoffice route above it is called by someone already
 * holding `config:read` and already looking at the whole directory — there is
 * nothing left for them to learn — so it may say plainly that the mail did not
 * go, which is the only useful thing to tell a person who pressed Send.
 */
export async function deliverAccessLink(
  db: Db,
  deps: AccessLinkDeps,
  account: StallAccount,
): Promise<void> {
  const { token } = await mintAccessLink(db, {
    accountId: account.id,
    purpose: 'STATUS',
    ttlDays: STATUS_LINK_TTL_DAYS,
  });
  await deps.mail.send(accessLinkMail(account, deps.statusUrl(token)));
}

function accessLinkMail(account: StallAccount, statusUrl: string) {
  const text = [
    `Here is the link to your stall requests.`,
    ``,
    statusUrl,
    ``,
    `It opens your requests, tells you what is still outstanding, and takes you`,
    `to any form you still have to fill.`,
    ``,
    `Please keep this link private — anyone with it can see your requests.`,
    `If you did not ask for it, you can ignore this email.`,
  ].join('\n');
  return {
    to: account.email,
    subject: 'Your stall requests',
    text,
    about: { accountId: account.id },
  };
}

/** That vendor's own requests, and nothing else.
 *
 *  Fields the team uses internally — flag reason, reject reason, the notes on a
 *  request — are not here. What IS here beyond the bare status is the pending
 *  list, from the same `pendingSteps` the Onboarding table and the check-in
 *  counter read, so the vendor is never told they are all set while the
 *  counter is told otherwise.
 *
 *  ⚠️ Takes the ACCOUNT, not the link that named it. Two credentials reach this
 *  view — the signed link in the receipt email and the session cookie a
 *  logged-in requester holds — and both must answer identically. Narrowing the
 *  parameter to what the function actually reads is what makes a second way in
 *  a second CALLER rather than a second view. */
export async function statusView(db: Db, account: StallAccount): Promise<PublicStatusResponse> {
  const requests = await db.stallRequest.findMany({
    where: { accountId: account.id },
    orderBy: { submittedAt: 'desc' },
    // The EDITION rides along for one reason: the virtual accounts a requester
    // is asked to transfer to are built from its prefixes. Kept local to this
    // query rather than added to `factsInclude`, which six screens share and
    // none of the others need it.
    include: {
      ...factsInclude,
      edition: {
        select: {
          virtualAccountRentPrefix: true,
          virtualAccountDepositPrefix: true,
          // And WHO the transfer is made to. The prefixes alone name an account
          // number; a vendor making an NEFT needs the bank and the IFSC beside
          // it, and the letter has always printed them.
          beneficiaryName: true,
          beneficiaryAddress: true,
          bankAccountType: true,
          bankName: true,
          bankIfsc: true,
          bankBranch: true,
        },
      },
      // The requester's own ANSWERS, so their page can read back what they
      // filled in. Local to this query for the same reason the edition is:
      // `factsInclude` is shared by six screens and the other five have the
      // application in hand already.
      ashramDetail: true,
      appliances: { orderBy: { sortOrder: 'asc' } },
      customValues: { include: { field: { select: { label: true } } } },
    },
  });

  // One flow lookup per edition, not per request — a vendor with four stalls
  // has them all in the same edition, and this keeps that the common case.
  const flows = new Map<string, Awaited<ReturnType<typeof flowFor>>>();
  const flowOf = async (editionId: string) => {
    const cached = flows.get(editionId);
    if (cached) return cached;
    const flow = await flowFor(db, editionId);
    flows.set(editionId, flow);
    return flow;
  };

  // The rate card, cached the same way and for the same reason.
  const quotes = new Map<string, Awaited<ReturnType<typeof quoteContext>>>();
  const quoteCtxOf = async (editionId: string) => {
    const cached = quotes.get(editionId);
    if (cached) return cached;
    const ctx = await quoteContext(db, editionId);
    quotes.set(editionId, ctx);
    return ctx;
  };

  return {
    displayName: account.displayName,
    requests: await Promise.all(
      requests.map(async (r) => {
        // The quote is read once per request and handed to `paymentDue` whole,
        // because the figures and the LINES behind them have to come from the
        // same place: a frozen plan's total beside a live quote's arithmetic is
        // a breakdown that does not add up to the figure above it.
        const ctx = await quoteCtxOf(r.editionId);
        const live = quoteFor(r, ctx);
        const view = r.paymentPlan ? planToView(r.paymentPlan) : toQuoteView(live);
        // 🔴 The FROZEN lines where the letter froze any — what the vendor was
        // TOLD. A vendor who revised their plug points after the letter went
        // out would otherwise read a breakdown that no longer sums to the total
        // beside it. Plans frozen before the column existed have none, and the
        // page falls back to the live lines, exactly as `comms.ts` does for the
        // letter.
        const frozen = (r.paymentPlan?.lines ?? null) as QuoteLine[] | null;
        return {
          reference: r.reference,
          requestType: r.requestType,
          stallName: r.stallName,
          status: r.status,
          submittedAt: r.submittedAt.toISOString(),
          // The AREA, once the team has settled it. This one IS told early — the
          // rent depends on it, so a requester cannot be asked to pay without
          // knowing it. A shortlist is internal and must not read as a promise,
          // so nothing is shown before SELECTED.
          allocatedZone:
            r.status === 'SELECTED'
              ? (r.allocations[0]?.stall.zone.code ?? r.agreedZoneCode ?? null)
              : null,
          // 🔴 The stall NUMBER within that area, and only once the stall has
          // actually CHECKED IN.
          //
          // This is the thing the team asked not to happen early, and the reason
          // is operational: "some of them come in advance, they look at where the
          // stall is, they'll come and fight with you — I don't want this
          // location". The number is handed over at the counter with the
          // wristbands, which is also the moment somebody is standing there to
          // have that conversation.
          allocatedStalls: r.checkIn ? r.allocations.map((a) => a.stall.number) : [],
          // 🔴 `gatedFor`, so each entry carries whether the requester may act
          // on it yet. The WHOLE list, locked steps included: the portal draws a
          // tab only for an open one and lists the rest greyed on the Overview,
          // so the requester reads the whole road and can only walk their part of
          // it. Onboarding and Check-in still read `pendingFor` and still see
          // everything outstanding, which is the point of the two functions.
          pending: r.status === 'SELECTED' ? gatedFor(r, await flowOf(r.editionId)) : [],
          // Both blocks are null for anything not SELECTED, for the same reason
          // `pending` is empty there: a requester still waiting on a decision has
          // nothing to pay and nobody to register, and showing either would read
          // as a decision already made.
          payment:
            r.status === 'SELECTED'
              ? paymentDue(r, view, {
                  lines: frozen ?? live?.lines ?? null,
                  gstPercent: ctx.rates.gstPercent,
                })
              : null,
          // 🔴 Their own claims, INCLUDING rejected ones with the reason. That
          // reason is the only thing telling them what to correct, and a
          // rejection they never see returns them to the mailbox this replaced.
          paymentClaims: r.status === 'SELECTED' ? await claimsFor(db, r.id) : [],
          staff: r.status === 'SELECTED' ? staffView(r, await flowOf(r.editionId)) : null,
          // 🔴 Whatever the status. The answers are the requester's own from the
          // moment they pressed Submit, and a request still under review is
          // exactly the one whose answers they come back to check — which they
          // could not do before this, because the only copy was the form they no
          // longer had.
          submitted: submittedSections(answers(r)),
          // 🔴 Whatever the status, and whether or not the step is still
          // outstanding. These two blocks are the reason a finished step no
          // longer vanishes off this page without trace — see `PublicRequestStatus.bank`.
          bank: bankView(r),
          fssai: fssaiView(r),
        };
      }),
    ),
  };
}

/** The last four, and asterisks for the rest.
 *
 *  ⚠️ Not a redaction of somebody else's secret — it is the requester's own
 *  account number, on their own page. It is masked because the page is reached
 *  by a link that sits in an inbox for a year and gets forwarded, and because
 *  the last four is the whole of what a person actually checks their own
 *  account against. A short value is masked entirely rather than mostly shown.
 */
function maskTail(value: string | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.length <= 4) return '•'.repeat(v.length);
  return `${'•'.repeat(v.length - 4)}${v.slice(-4)}`;
}

/** The bank details, read back to the requester who sent them.
 *
 *  Null where none were ever submitted, which is also how the page tells "not
 *  sent" from "not asked": a request that is not asked for bank details has no
 *  pending entry for the step either, so the tab appears for neither. */
function bankView(r: PortalRequest): PublicBankDetails | null {
  const b = r.bankDetail;
  if (!b) return null;
  return {
    submittedAt: b.submittedAt.toISOString(),
    accountHolder: b.accountHolder,
    bankName: b.bankName,
    branch: b.branch,
    accountNumberMasked: maskTail(b.accountNumber),
    ifsc: b.ifsc,
    panMasked: maskTail(b.panNumber),
    invoiceName: b.invoiceName,
    gstNumber: b.gstNumber,
  };
}

/** The FSSAI certificate on file, read back.
 *
 *  ⚠️ File NAMES, not links. The uploads are served from a private store the
 *  backoffice reads through its own authorisation; handing the portal a URL
 *  would make this read-back a second door onto that store, which is a bigger
 *  change than showing somebody what they sent. */
function fssaiView(r: PortalRequest): PublicFssaiDetails | null {
  const f = r.fssai;
  if (!f) return null;
  return {
    submittedAt: f.submittedAt.toISOString(),
    ownerName: f.ownerName,
    mobile: f.mobile,
    files: f.files.map((file) => ({
      fileName: file.fileName,
      uploadedAt: file.uploadedAt.toISOString(),
    })),
    verified: f.verifiedAt !== null,
  };
}

/** The row, in the shape `submittedSections` reads.
 *
 *  ⚠️ A mapper and nothing else: which answers are shown, what they are called
 *  and which of them are dropped for being unanswered are decided in
 *  `@stalls/core`, where the requester's page and this route read one copy of
 *  them. See `submitted.ts`. */
function answers(r: PortalRequest): SubmittedRequest {
  return {
    requestType: r.requestType,
    stallName: r.stallName,
    requesterName: r.requesterName,
    email: r.email,
    contactNumber: r.contactNumber,
    address: r.address,
    stallType: r.stallType,
    preferredZoneCode: r.preferredZoneCode,
    itemsSelling: r.itemsSelling,
    numStallsRequested: r.numStallsRequested,
    remarks: r.remarks,
    plugs5a: r.plugs5a,
    plugs15a: r.plugs15a,
    gasStoves: r.gasStoves,
    appliances: r.appliances.map((a) => ({ name: a.name, watts: a.watts })),
    tablesNeeded: r.tablesNeeded,
    chairsNeeded: r.chairsNeeded,
    passes2w: r.passes2w,
    passes4w: r.passes4w,
    passesStaff: r.passesStaff,
    depositAcknowledged: r.depositAcknowledgedAt !== null,
    ashram: r.ashramDetail,
    custom: r.customValues.map((v) => ({ label: v.field.label, value: v.value })),
  };
}

/** The `PAYMENT_DETAILS` letter, as data.
 *
 *  🔴 The caller picks the quote the way Finance does — `planToView` where the
 *  payment letter has frozen one, the live `quoteFor` otherwise. That fallback
 *  is the point. The plan row is written only by `freezePaymentPlan` when the
 *  letter goes out, so a vendor waiting on a letter that never came would
 *  otherwise be shown "payment pending" with no figure and no way to get one —
 *  which is the whole complaint this work answers. The rate card is public and
 *  the quote is computed from what they themselves filled in; there is nothing
 *  here they are not entitled to see before a letter names it.
 *
 *  🔴 `payableFeePaise` — what is OWED, which for a local welfare trader is the
 *  concession the team agreed and not the card rate they were quoted. The same
 *  figure `paymentConfirmed` settles against, so paying what this page asks for
 *  actually clears the chip. The quoted rate is deliberately not returned
 *  beside it; see the note on `PublicPaymentDue`.
 *
 *  ⚠️ Null for an EXEMPT stall (an ashram department is billed internally and
 *  owes nothing here) and null for an UNPRICED one (a zone with no rate). Zero
 *  is not the answer to either: on this page a zero reads as "free", and
 *  telling a trader their stall is free because nobody has set a rate for their
 *  area is worse than telling them nothing. The chip stands on its own until
 *  there is a real figure.
 *
 *  The account numbers come from `virtualAccountFor`, the call `comms.ts` makes
 *  when it writes the letter — the page and the letter cannot name different
 *  accounts. */
function paymentDue(
  r: PortalRequest,
  quote: QuoteView,
  charges: { lines: QuoteLine[] | null; gstPercent: number },
): PublicPaymentDue | null {
  if (quote.exempt || quote.unpriced) return null;

  const prefixes = {
    rentPrefix: r.edition.virtualAccountRentPrefix,
    depositPrefix: r.edition.virtualAccountDepositPrefix,
  };

  return {
    feePaise: quote.payableFeePaise,
    // ⚠️ Never discounted. The deposit comes back in full, so a concession on
    // it would mean refunding money that was never taken.
    depositPaise: quote.depositTotalPaise,
    // Already the payable fee plus the deposit — see `planToView`.
    totalPaise: quote.grandTotalPaise,
    breakdown: breakdownOf(quote, charges),
    // The two halves of the deposit, because they are refunded apart: a fine
    // comes off the stall's, unreturned furniture off the furniture's.
    stallDepositPaise: quote.stallDepositPaise,
    equipmentDepositPaise: quote.equipmentDepositPaise,
    virtualAccountRent: virtualAccountFor(prefixes, r.contactNumber, 'RENT'),
    virtualAccountDeposit: virtualAccountFor(prefixes, r.contactNumber, 'DEPOSIT'),
    beneficiary: beneficiaryOf(r.edition),
  };
}

/** The arithmetic behind the fee — or nothing, where showing it would mislead.
 *
 *  🔴 A CONCESSION suppresses it. The lines add up to what was quoted, and the
 *  fee beside them is what the team agreed to take instead; printing the two
 *  together shows a local welfare trader the figure they were talked down from,
 *  which the whole `payableFeePaise` design exists to avoid, and printing a
 *  breakdown that does not sum to the total above it is worse than printing
 *  none. The figure they owe is on the page either way.
 *
 *  ⚠️ The GST percentage is DERIVED from the figures rather than read off
 *  today's charge config, so a plan frozen at 18% is never relabelled 12%
 *  because an admin changed the rate afterwards. The config is only the
 *  fallback for a quote with nothing to divide by. */
function breakdownOf(quote: QuoteView, charges: { lines: QuoteLine[] | null; gstPercent: number }) {
  if (!charges.lines || charges.lines.length === 0) return null;
  if (quote.discretionaryFeePaise !== null) return null;
  return {
    lines: charges.lines,
    netPaise: quote.netPaise,
    gstPaise: quote.gstPaise,
    // `gstPercentOf` — the same derivation the letter's GST line is labelled
    // with, so the page and the letter cannot print different rates against
    // the same frozen plan.
    gstPercent: quote.netPaise > 0 ? gstPercentOf(quote) : charges.gstPercent,
    feeTotalPaise: quote.feeTotalPaise,
  };
}

/** Who the money goes to. Null when the edition has been told none of it — a
 *  page that named the accounts without the bank is still usable by somebody
 *  who has the letter, and an empty table is not. */
function beneficiaryOf(e: PortalRequest['edition']): PublicBeneficiary | null {
  const b: PublicBeneficiary = {
    accountName: e.beneficiaryName,
    address: e.beneficiaryAddress,
    accountType: e.bankAccountType,
    bankName: e.bankName,
    ifsc: e.bankIfsc,
    branch: e.bankBranch,
  };
  return Object.values(b).some((v) => v !== null) ? b : null;
}

/** The stall's live coupons, or the fact that there are none yet.
 *
 *  ⚠️ An EMPTY list is what lets the portal offer a step `pendingSteps` cannot
 *  yet name. `staffExpected` is the coupons' capacity, so until one is issued
 *  the pending list is silent — correctly, since nobody can register against a
 *  coupon that does not exist. This block says "and you may ask for one", which
 *  is the whole point of `couponFor` below.
 *
 *  ⚠️ The vendor sees EVERY live code, including one the team issued to a
 *  caterer against this stall. That is deliberate: the registrations land on
 *  their stall and are counted against their roster at the gate, so a code they
 *  cannot see would be a number they are answerable for and cannot check.
 *
 *  🔴 And whether the step may be started at all, which the pending list cannot
 *  say. `pendingSteps` is silent about STAFF_REGISTRATION until a coupon
 *  exists, so a portal reading only `pending` drew the tab and its Get Your
 *  Coupon button for a step `couponFor` was about to refuse — a vendor pressing
 *  a button and getting "opens once BANK_FORM is complete" thrown back at them.
 *  The two questions asked here are the two `assertStepAvailable` asks, in the
 *  same order, so the tab cannot offer what the mint would refuse. */
function staffView(r: PortalRequest, flow: FlowConfig): PublicStaffCoupon {
  // ⚠️ `stepLockedFor`, not a lookup in the gated list — same reason as in
  // `couponFor`: the question is about the step's STAGE, and the gated list
  // has nothing to say about a step whose starting move is what makes it
  // outstanding.
  const asked = isStepAsked(flow, r.requestType, 'STAFF_REGISTRATION');
  const locked = asked && stepLockedFor(r, flow, 'STAFF_REGISTRATION');
  return {
    coupons: r.coupons.map((c) => ({
      id: c.id,
      code: c.code,
      capacity: c.capacity,
      registered: registeredOn(c.id, r.staff),
    })),
    registered: r.staff.length,
    capacity: staffExpected(r),
    open: asked && !locked,
    // Empty for a step that is not asked: `blockedByFor` names what the OPEN
    // stage is waiting on, which would read as "staff opens after this" for a
    // step that is never opening.
    blockedBy: locked ? blockedByFor(r, flow) : [],
  };
}

/** Opens one outstanding step for a requester who has proved who they are.
 *
 *  The CREDENTIAL — a status link or a session — is what the caller checked
 *  before getting here; `reference` only picks which of THAT account's requests
 *  is meant, so a reference belonging to somebody else is indistinguishable
 *  from one that does not exist. The step must actually be outstanding: a 409
 *  rather than a link keeps this from becoming a way to mint a bank-form link
 *  for a request whose bank details are already in. */
export async function stepLink(
  db: Db,
  deps: Pick<StallsDeps, 'bankFormUrl' | 'fssaiUrl'>,
  accountId: string,
  input: ContinueStepInput,
): Promise<{ url: string }> {
  const request = await db.stallRequest.findFirst({
    where: { accountId, reference: input.reference },
    include: factsInclude,
  });
  if (request?.status !== 'SELECTED') throw new UnknownAccessLinkError();

  const flow = await flowFor(db, request.editionId);
  const gated = gatedFor(request, flow).find((g) => g.step === input.step);
  // Nothing to do here at all — already submitted, switched off, or not asked
  // of this requester type.
  if (!gated || !isSelfServe(gated.step)) throw new StepNotOpenError(input.step);
  // ⚠️ Outstanding, but the edition's ordering has not reached it. A different
  // refusal from the one above, because it is a different thing to be told:
  // "there is nothing to do" sends a requester looking for a problem, where
  // "this opens once payment is confirmed" tells them to wait.
  if (!gated.open) throw new StepLockedError(input.step, gated.blockedBy);

  const purpose = input.step === 'BANK_FORM' ? 'BANK_FORM' : 'FSSAI_UPLOAD';
  const { token } = await mintAccessLink(db, {
    accountId: request.accountId,
    requestId: request.id,
    purpose,
    ttlDays: STEP_LINK_TTL_DAYS,
  });

  const url: Record<SelfServeStepValue, string> = {
    BANK_FORM: deps.bankFormUrl(token),
    FSSAI: deps.fssaiUrl(token),
  };
  return { url: url[input.step] };
}

/** Refuses a step this requester type is not asked for, or that the edition's
 *  ordering has not reached yet.
 *
 *  ⚠️ Shared by the coupon route and the staff registration route because both
 *  reach a step WITHOUT the portal: one mints the credential, the other is
 *  entered with a code that may have been forwarded from a letter sent months
 *  ago. Hiding a tab does nothing about either.
 *
 *  🔴 TWO refusals, in this order, and they are different things to be told.
 *  Not asked is `StepNotOpenError` — there is nothing here and there never will
 *  be, for an ashram whose edition does not register staff. Locked is
 *  `StepLockedError`, which names what comes first. A requester told the wrong
 *  one of those goes looking for a problem that does not exist, or waits for a
 *  turn that never comes. */
export async function assertStepAvailable(
  db: Db,
  requestId: string,
  step: OnboardingStep,
): Promise<void> {
  const r = await db.stallRequest.findUnique({ where: { id: requestId }, include: factsInclude });
  if (!r) return;
  const flow = await flowFor(db, r.editionId);
  if (!isStepAsked(flow, r.requestType, step)) throw new StepNotOpenError(step);
  if (stepLockedFor(r, flow, step)) {
    throw new StepLockedError(step, blockedByFor(r, flow));
  }
}

/**
 * Issues the staff-registration coupon for one of the caller's own requests,
 * or hands back the one already issued.
 *
 * 🔴 The step this unblocks is the one a requester could not reach at all. A
 * coupon was minted only by an admin pressing Issue Coupon, or as a side effect
 * of sending `ONBOARDING_FSSAI_STAFF` — so a vendor who never received that
 * letter had no coupon, `staffExpected` was 0, `pendingSteps` said nothing was
 * outstanding, and their team could not be registered.
 *
 * ⚠️ Idempotent, and that is load-bearing rather than tidy. `ensureCoupon`
 * returns the existing code, so pressing this twice — or pressing it after the
 * letter went out — hands back the SAME coupon the vendor's staff may already
 * be registering against. A second code would leave those registrations
 * counting against something nobody is looking at.
 *
 * ⚠️ The CREDENTIAL was checked by the caller; `reference` only picks which of
 * THAT account's requests is meant, so one belonging to somebody else is
 * indistinguishable from one that does not exist. Same rule as `stepLink`.
 *
 * ⚠️ SELECTED only. A coupon on a request still under review would be a
 * decision this route is not entitled to leak.
 *
 * The trail records the ACCOUNT as the actor: the requester asked for this,
 * and attributing it to whichever admin opens the record next would be a lie
 * about who did.
 */
export async function couponFor(
  db: PrismaClient,
  accountId: string,
  input: RequestCouponInput,
): Promise<{ code: string }> {
  const request = await db.stallRequest.findFirst({
    where: { accountId, reference: input.reference },
    include: { edition: { select: { year: true } } },
  });
  if (request?.status !== 'SELECTED') throw new UnknownAccessLinkError();

  // 🔴 Refused while STAFF_REGISTRATION is not asked of this requester type or
  // is locked, and refused BEFORE the mint.
  // `ensureCoupon` is a write: minting and then hiding the code would leave a
  // live credential the staff route is about to refuse, and a stall holding a
  // coupon nobody may use reads on Onboarding as one that was offered a step.
  //
  // ⚠️ `stepLockedFor`, NOT a lookup in the gated list. `staffExpected` is 0
  // until a coupon exists, so `pendingSteps` says nothing about the step — and
  // a check that looked for it there would answer "not locked" for exactly the
  // request this button is about to mint a coupon for. The question is about
  // the step's stage.
  await assertStepAvailable(db, request.id, 'STAFF_REGISTRATION');

  const coupon = await ensureCoupon(
    db,
    request.id,
    request.stallName,
    request.edition.year,
    requesterActor(accountId),
  );
  return { code: coupon.code };
}

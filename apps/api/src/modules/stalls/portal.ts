import type { PrismaClient, StallAccount } from '@prisma/client';
import {
  type ContinueStepInput,
  type PublicPaymentDue,
  type QuoteView,
  type PublicStaffCoupon,
  type PublicStatusResponse,
  type RequestCouponInput,
  type SelfServeStepValue,
  isSelfServe,
  virtualAccountFor,
} from '@msr/stalls';
import { findAccountByContact, mintAccessLink } from './accounts';
import { flowFor } from './config';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { StepNotOpenError, UnknownAccessLinkError } from './errors';
import {
  type RequestWithFacts,
  factsInclude,
  pendingFor,
  registeredOn,
  staffExpected,
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
  };
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
    `Here is the link to your MSR stall requests.`,
    ``,
    statusUrl,
    ``,
    `It opens your requests, tells you what is still outstanding, and takes you`,
    `to any form you still have to fill.`,
    ``,
    `Please keep this link private — anyone with it can see your requests.`,
    `If you did not ask for it, you can ignore this email.`,
  ].join('\n');
  return { to: account.email, subject: 'Your MSR stall requests', text };
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
        select: { virtualAccountRentPrefix: true, virtualAccountDepositPrefix: true },
      },
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
      requests.map(async (r) => ({
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
        pending: r.status === 'SELECTED' ? pendingFor(r, await flowOf(r.editionId)) : [],
        // Both blocks are null for anything not SELECTED, for the same reason
        // `pending` is empty there: a requester still waiting on a decision has
        // nothing to pay and nobody to register, and showing either would read
        // as a decision already made.
        payment:
          r.status === 'SELECTED'
            ? paymentDue(
                r,
                r.paymentPlan
                  ? planToView(r.paymentPlan)
                  : toQuoteView(quoteFor(r, await quoteCtxOf(r.editionId))),
              )
            : null,
        staff: r.status === 'SELECTED' ? staffView(r) : null,
      })),
    ),
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
function paymentDue(r: PortalRequest, quote: QuoteView): PublicPaymentDue | null {
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
    virtualAccountRent: virtualAccountFor(prefixes, r.contactNumber, 'RENT'),
    virtualAccountDeposit: virtualAccountFor(prefixes, r.contactNumber, 'DEPOSIT'),
  };
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
 *  cannot see would be a number they are answerable for and cannot check. */
function staffView(r: PortalRequest): PublicStaffCoupon {
  return {
    coupons: r.coupons.map((c) => ({
      id: c.id,
      code: c.code,
      capacity: c.capacity,
      registered: registeredOn(c.id, r.staff),
    })),
    registered: r.staff.length,
    capacity: staffExpected(r),
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
  const open = pendingFor(request, flow).some((p) => p.step === input.step && isSelfServe(p.step));
  if (!open) throw new StepNotOpenError(input.step);

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

/**
 * Issues the staff-registration coupon for one of the caller's own requests,
 * or hands back the one already issued.
 *
 * 🔴 The step this unblocks is the one a requester could not reach at all. A
 * coupon was minted only by an admin pressing Issue Coupon, or as a side effect
 * of sending `ONBOARDING_FSSAI_STAFF` — so a vendor who never received that
 * letter had no coupon, `staffExpected` was 0, `pendingSteps` said nothing was
 * outstanding, and their team could not be registered. Staff registration is
 * the one step `FlowConfig` cannot switch off, because an unregistered person
 * cannot be let onto the venue.
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
 * The trail records the REQUEST as its own actor, following the bank form:
 * the vendor acted, and attributing it to whichever admin opens the record next
 * would be a lie about who asked.
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

  const coupon = await ensureCoupon(
    db,
    request.id,
    request.stallName,
    request.edition.year,
    request.id,
  );
  return { code: coupon.code };
}

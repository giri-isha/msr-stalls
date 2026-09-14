import type { StallAccessLink, StallAccount } from '@prisma/client';
import {
  type ContinueStepInput,
  type PublicStatusResponse,
  type SelfServeStepValue,
  isSelfServe,
} from '@msr/stalls';
import { findAccountByContact, mintAccessLink } from './accounts';
import { flowFor } from './config';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { StepNotOpenError, UnknownAccessLinkError } from './errors';
import { factsInclude, pendingFor } from './facts';
import type { Mailer } from './mailer';
import { STATUS_LINK_TTL_DAYS } from './submit';

/** The vendor's own portal: getting back in, seeing what is outstanding, and
 *  opening the one form that is theirs to fill.
 *
 *  The requirement asks for register-and-login by email or phone number. This
 *  module has no passwords — a request mints a signed link and the receipt
 *  email carries it — so "login" is: name the mailbox or the number you applied
 *  under, and a fresh link is sent there. Nothing is ever shown to the person
 *  typing; the link is the credential and it goes to the vendor, not to the
 *  browser that asked.
 */

/** Same TTL as a selection email's links, and for the same reason: a form that
 *  sat open in a tab for six months should be reopened, not resumed. */
const STEP_LINK_TTL_DAYS = 180;

/** Mints a status link and mails it, if the contact matches an account.
 *
 *  Returns nothing either way. The route answers `{ ok: true }` whichever
 *  happened — a caller must not be able to use this to learn whether an address
 *  has applied, and a timing difference is not worth defending against here
 *  because the two paths differ by one indexed lookup. */
export async function sendAccessLink(
  db: Db,
  deps: { mail: Mailer; statusUrl(token: string): string },
  contact: string,
): Promise<void> {
  const account = await findAccountByContact(db, contact);
  if (!account) return;

  const { token } = await mintAccessLink(db, {
    accountId: account.id,
    purpose: 'STATUS',
    ttlDays: STATUS_LINK_TTL_DAYS,
  });

  try {
    await deps.mail.send(accessLinkMail(account, deps.statusUrl(token)));
  } catch {
    // Logged by the mailer. A transport failure must not become a different
    // response from "no such account" — the vendor asks again, or calls.
  }
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
 *  counter is told otherwise. */
export async function statusView(
  db: Db,
  link: StallAccessLink & { account: StallAccount },
): Promise<PublicStatusResponse> {
  const requests = await db.stallRequest.findMany({
    where: { accountId: link.accountId },
    orderBy: { submittedAt: 'desc' },
    include: factsInclude,
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

  return {
    displayName: link.account.displayName,
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
      })),
    ),
  };
}

/** Opens one outstanding step for the holder of a status link.
 *
 *  The status link is the credential; `reference` only picks which of THAT
 *  account's requests is meant, so a reference belonging to somebody else is
 *  indistinguishable from one that does not exist. The step must actually be
 *  outstanding: a 409 rather than a link keeps this from becoming a way to mint
 *  a bank-form link for a request whose bank details are already in. */
export async function stepLink(
  db: Db,
  deps: Pick<StallsDeps, 'bankFormUrl' | 'fssaiUrl'>,
  link: StallAccessLink,
  input: ContinueStepInput,
): Promise<{ url: string }> {
  const request = await db.stallRequest.findFirst({
    where: { accountId: link.accountId, reference: input.reference },
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

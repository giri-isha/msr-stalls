// Filing a requester's forms from the backoffice.
//
// 🔴 The same functions the requester's own routes call, with a `Filing` that
// says a member acted and for whom. Nothing here validates a form: `submit.ts`,
// `bank.ts`, `onboarding.ts` and `payment-claims.ts` do that, once, for both
// sides — so a question an admin appended is asked of the desk too, and a
// question they switched off is asked of neither.
//
// What this file owns is the ACCOUNT question — whose request is this — and
// the read-side views a backoffice form needs to draw itself.
import type { PrismaClient, StallAccount, StallRequestType } from '@prisma/client';
import {
  type CouponView,
  type FileRequestInput,
  type FileRequestResponse,
  type FilingRequester,
  type FssaiFormView,
  PLACEHOLDER_EMAIL_DOMAIN,
  type RequesterLookupResponse,
  canReach,
  isPlaceholderEmail,
} from '@stalls/core';
import { findAccountByContact, normalizeEmail, resolveRequesterType } from './accounts';
import { type AuditActor, onBehalfOf } from './audit';
import { declarationsForForm } from './declarations';
import type { Db } from './editions';
import { AmbiguousRequesterError, RequestTypeForbiddenError, UnknownRequestError } from './errors';
import { publicFormFor } from './form-builder';
import { ensureCoupon, resolveCoupon, toCouponView } from './onboarding';
import type { BackofficeCaller } from './roles';
import { type SubmitDeps, submitRequest } from './submit';

/** What the requester step of the filing page shows once a contact is typed.
 *
 *  ⚠️ Its own route on `filing.request`, not the Users directory: that needs
 *  `config.read`, which a Local Welfare member does not hold and has no
 *  business holding. It returns who the account is and how much they already
 *  have here — never a token, never a link. */
export async function lookupRequester(
  db: Db,
  editionId: string,
  contact: string,
): Promise<RequesterLookupResponse> {
  const account = await findAccountByContact(db, contact);
  if (!account) return { match: null };
  const requestCount = await db.stallRequest.count({ where: { accountId: account.id, editionId } });
  return {
    match: {
      accountId: account.id,
      displayName: account.displayName,
      // A placeholder address is not an address — the same rule the public
      // session route follows, so the page does not offer one to be cleared.
      email: isPlaceholderEmail(account.email) ? '' : account.email,
      phone: account.phone,
      requesterType: await resolveRequesterType(db, account),
      requestCount,
    },
  };
}

/**
 * The account a filing lands on.
 *
 * Each contact given is looked up. One account, or the same account twice:
 * attach. Two DIFFERENT accounts: refuse with both names — the desk can see
 * both rows and picks one contact, because merging two vendors' histories on a
 * typo is not undoable. None: create, following `register`'s own convention so
 * that a phone-only account carries the placeholder address that keeps it out
 * of every send.
 */
export async function resolveFilingAccount(
  db: Db,
  requester: FilingRequester,
  requestType: StallRequestType,
): Promise<{ account: StallAccount; created: boolean }> {
  const byEmail = requester.email ? await findAccountByContact(db, requester.email) : null;
  const byPhone = requester.phone ? await findAccountByContact(db, requester.phone) : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    throw new AmbiguousRequesterError(byEmail.displayName, byPhone.displayName);
  }
  const existing = byEmail ?? byPhone;
  if (existing) return { account: existing, created: false };

  const account = await db.stallAccount.create({
    data: {
      email: requester.email
        ? normalizeEmail(requester.email)
        : `mobile+${requester.phone}@${PLACEHOLDER_EMAIL_DOMAIN}`,
      phone: requester.phone ?? '',
      displayName: requester.displayName,
      requesterType: requestType,
    },
  });
  return { account, created: true };
}

/** A member files a request.
 *
 *  Scope first — a Local Welfare member may not file a vendor form — then the
 *  account, then the ONE write the public has, with the member as actor.
 *
 *  ⚠️ The status token the write mints is DROPPED here. The receipt carries it
 *  to the requester's own contact; the filer never sees it, because a status
 *  link is a credential for the whole account. */
export async function fileRequest(
  db: PrismaClient,
  deps: SubmitDeps,
  caller: BackofficeCaller,
  input: FileRequestInput,
): Promise<FileRequestResponse> {
  if (!canReach(caller.requestTypeScope, input.request.requestType)) {
    throw new RequestTypeForbiddenError(input.request.requestType);
  }
  const { account, created } = await resolveFilingAccount(
    db,
    input.requester,
    input.request.requestType,
  );
  const result = await submitRequest(
    db,
    input.request,
    deps,
    account.id,
    onBehalfOf({ personId: caller.personId, displayName: caller.displayName }, account.id),
  );
  return {
    requestId: result.requestId,
    reference: result.reference,
    accountId: account.id,
    accountCreated: created,
  };
}

/** The FSSAI form as the page draws it.
 *
 *  Moved here from the public route so the BACKOFFICE can draw the same form;
 *  the public route calls this too, and the two cannot drift. */
export async function fssaiFormView(db: Db, requestId: string): Promise<FssaiFormView> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: { fssai: { include: { files: true } } },
  });
  if (!r) throw new UnknownRequestError(requestId);
  const [form, declarations] = await Promise.all([
    publicFormFor(db, r.editionId, 'FSSAI'),
    declarationsForForm(db, r.editionId, 'FSSAI'),
  ]);
  return {
    form,
    declarations,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    uploadedAt: r.fssai?.submittedAt.toISOString() ?? null,
    verifiedAt: r.fssai?.verifiedAt?.toISOString() ?? null,
    files: (r.fssai?.files ?? []).map((f) => ({
      name: f.fileName,
      uploadedAt: f.uploadedAt.toISOString(),
    })),
  };
}

/** The staff form for a stall, on the stall's OWN coupon — found, or issued
 *  now. `ensureCoupon` is idempotent, so opening this screen twice does not
 *  leave a second code nobody is counting. */
export async function staffFormView(
  db: PrismaClient,
  requestId: string,
  by: AuditActor,
): Promise<CouponView & { couponCode: string }> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: { edition: { select: { year: true } } },
  });
  if (!r) throw new UnknownRequestError(requestId);
  const coupon = await ensureCoupon(db, r.id, r.stallName, r.edition.year, by);
  const { request } = await resolveCoupon(db, coupon.code);
  return { ...(await toCouponView(db, request, coupon)), couponCode: coupon.code };
}

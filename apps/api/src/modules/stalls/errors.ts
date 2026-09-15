// The module's own domain errors. Each is thrown from a domain seam and mapped
// to a status at the route edge — handlers never construct status codes for
// domain conditions themselves. A new condition gets a class here and one line
// in `routes.ts`'s mapper, and nowhere else.

/** No edition is marked active. Refused rather than picking one at random —
 *  which is what a "latest year" fallback would do the day 2027's edition is
 *  created early and nobody has flipped it on yet. Mapped to 503: the system is
 *  not misconfigured by the caller, it is not ready. */
export class NoActiveEditionError extends Error {
  constructor() {
    super('no active stall edition — an admin must activate one');
    this.name = 'NoActiveEditionError';
  }
}

/** Mapped to 404. Deliberately the SAME class for a bad token, an expired one
 *  and a revoked one, so the response cannot be used to distinguish "wrong"
 *  from "expired" — a distinguishable expired-token response confirms that the
 *  token once existed. */
export class UnknownAccessLinkError extends Error {
  constructor() {
    super('this link is not valid');
    this.name = 'UnknownAccessLinkError';
  }
}

/** Every way a password login can fail, as ONE error.
 *
 *  ⚠️ Unknown contact, wrong password, a credential that was never confirmed,
 *  a locked-out credential and a string that is not a contact at all ALL raise
 *  this, with this message. Telling them apart would make the login route a
 *  way of asking whether a particular shopkeeper has applied — which is the
 *  question the whole public surface is built to refuse. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('that login is not valid');
    this.name = 'InvalidCredentialsError';
  }
}

export class UnknownRequestError extends Error {
  constructor(readonly requestId: string) {
    super(`no stall request ${requestId}`);
    this.name = 'UnknownRequestError';
  }
}

export class UnknownStallError extends Error {
  constructor(readonly stallNumber: string) {
    super(`no stall ${stallNumber} in this edition`);
    this.name = 'UnknownStallError';
  }
}

export class UnknownZoneError extends Error {
  constructor(readonly zoneCode: string) {
    super(`no zone ${zoneCode} in this edition`);
    this.name = 'UnknownZoneError';
  }
}

/** Two staff selected the same stall at once and the database constraint
 *  refused the second. Mapped to 409. The route relies on the constraint, not
 *  on a read-then-write check — see `StallAllocation.activeStallId`. */
export class StallAlreadyAllocatedError extends Error {
  constructor(readonly stallNumber: string) {
    super(`stall ${stallNumber} is already allocated`);
    this.name = 'StallAlreadyAllocatedError';
  }
}

export class StallBlockedError extends Error {
  constructor(readonly stallNumber: string) {
    super(`stall ${stallNumber} is blocked and cannot be allocated`);
    this.name = 'StallBlockedError';
  }
}

/** Selecting MORE stalls than the request asked for. Fewer is allowed — the
 *  team routinely offers one where three were requested. Mapped to 422. */
export class TooManyStallsError extends Error {
  constructor(
    readonly requested: number,
    readonly offered: number,
  ) {
    super(`request asked for ${requested} stall(s); cannot allocate ${offered}`);
    this.name = 'TooManyStallsError';
  }
}

/** A transition the status machine does not allow — selecting a REJECTED
 *  request, shortlisting one already SELECTED. Mapped to 409. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`cannot move a ${from} request to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Removing the last admin would lock the whole team out. Mapped to 409. */
export class LastAdminError extends Error {
  constructor() {
    super('cannot remove the last stalls admin');
    this.name = 'LastAdminError';
  }
}

/** A custom field that already carries values on submitted requests can be
 *  deactivated but not deleted — deleting it would silently drop what vendors
 *  typed. Mapped to 409. */
export class CustomFieldInUseError extends Error {
  constructor(readonly fieldId: string) {
    super('this field already has answers; deactivate it instead of deleting');
    this.name = 'CustomFieldInUseError';
  }
}

/** A bay this edition already has. Mapped to 409 — the code is the bay's
 *  identity, and silently updating the existing one would rename a bay the
 *  admin believed they were creating. */
export class ZoneExistsError extends Error {
  constructor(readonly zoneCode: string) {
    super(`zone ${zoneCode} already exists in this edition`);
    this.name = 'ZoneExistsError';
  }
}

/** A bay that still holds stalls. Mapped to 409 rather than cascading: the
 *  cascade would be silent and would take the stalls, their allocations and the
 *  record of who stood where with it. */
export class ZoneInUseError extends Error {
  constructor(
    readonly zoneCode: string,
    readonly stallCount: number,
  ) {
    super(`zone ${zoneCode} still holds ${stallCount} stalls; remove them first`);
    this.name = 'ZoneInUseError';
  }
}

/** A category key this edition does not define. Mapped to 422 — inventing the
 *  column instead would let a typo become a permanent one nobody can explain. */
export class UnknownCategoryError extends Error {
  constructor(readonly key: string) {
    super(`no planning category ${key} in this edition`);
    this.name = 'UnknownCategoryError';
  }
}

/** A planning column something is still planned or standing against. Mapped to
 *  409, for the same reason a bay in use is. */
export class CategoryInUseError extends Error {
  constructor(
    readonly key: string,
    readonly count: number,
  ) {
    super(`category ${key} is used by ${count} plans or stalls; clear them first`);
    this.name = 'CategoryInUseError';
  }
}

/** A request asking for more stalls in one bay than the edition allows. Ground
 *  in a second bay is a second request, so the team can accept one and decline
 *  the other. Mapped to 422. */
export class TooManyStallsRequestedError extends Error {
  constructor(
    readonly asked: number,
    readonly max: number,
  ) {
    super(`a request may ask for at most ${max} stalls in one area; this asked for ${asked}`);
    this.name = 'TooManyStallsRequestedError';
  }
}

/** A requester type this staff member's roles do not reach. Mapped to 403.
 *
 *  Distinct from "no permission at all": the local welfare team holds real
 *  write access, just not to anybody else's requests. */
export class RequestTypeForbiddenError extends Error {
  constructor(readonly requestType: string) {
    super(`your role does not cover ${requestType} requests`);
    this.name = 'RequestTypeForbiddenError';
  }
}

/** The signature provider refused, or is not configured. Mapped to 502. */
export class SignatureProviderError extends Error {
  constructor(readonly detail: string) {
    super(`the signature provider could not be reached: ${detail}`);
    this.name = 'SignatureProviderError';
  }
}

export class UnknownPersonError extends Error {
  constructor(readonly ref: string) {
    super(`no staff member ${ref}`);
    this.name = 'UnknownPersonError';
  }
}

// ── Phase 2 and 3 ───────────────────────────────────────────────────────────

/** A template key that this edition has no row for. Mapped to 404. */
export class UnknownTemplateError extends Error {
  constructor(readonly key: string) {
    super(`no email template ${key}`);
    this.name = 'UnknownTemplateError';
  }
}

/** The template is real but does not belong on this request — the vendor
 *  letter aimed at an ashram department, or a re-send cleared for a letter
 *  that was never sent. Mapped to 409. */
export class WrongTemplateError extends Error {
  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`template ${key} ${reason}`);
    this.name = 'WrongTemplateError';
  }
}

/** Unknown, revoked, or belonging to a request that is no longer selected —
 *  deliberately ONE class, like `UnknownAccessLinkError`, so the public page
 *  cannot be used to discover which coupons exist. Mapped to 404. */
export class UnknownCouponError extends Error {
  constructor() {
    super('this coupon is not valid');
    this.name = 'UnknownCouponError';
  }
}

/** Registering more staff than the coupon's capacity allows. Mapped to 409: the
 *  vendor asks the team to raise the coupon rather than the system silently
 *  admitting an extra person. The cap is always real — the team's default is
 *  eight, and a capacity of zero is not "unlimited". */
export class CouponFullError extends Error {
  constructor(readonly max: number) {
    super(`all ${max} staff registrations for this stall have been used`);
    this.name = 'CouponFullError';
  }
}

/** The bank form has already been submitted. Mapped to 409 — after Finance has
 *  acted on an account number, changing it is a phone call to the team, not a
 *  second form submission. */
export class BankDetailsLockedError extends Error {
  constructor() {
    super('bank details have already been submitted for this request');
    this.name = 'BankDetailsLockedError';
  }
}

/** A step that the edition's flow config has switched off, or that does not
 *  apply to this requester type. Mapped to 409. */
export class StepNotOpenError extends Error {
  constructor(readonly step: string) {
    super(`the ${step} step is not open for this request`);
    this.name = 'StepNotOpenError';
  }
}

/** A refund already sent to Finance. Mapped to 409 — the figures are frozen
 *  because a voucher is being raised against them. */
export class RefundAlreadySubmittedError extends Error {
  constructor() {
    super('this refund has already been sent to Finance');
    this.name = 'RefundAlreadySubmittedError';
  }
}

/** The same NEFT reference entered twice against one request. Mapped to 409:
 *  double-counting a credit would shrink the vendor's refund. */
export class DuplicatePaymentError extends Error {
  constructor(readonly referenceNo: string) {
    super(`reference ${referenceNo} is already recorded against this request`);
    this.name = 'DuplicatePaymentError';
  }
}

/** Uploads are off because no object store is configured. Mapped to 503 —
 *  nothing the caller did is wrong. */
export class UploadsUnavailableError extends Error {
  constructor() {
    super('file uploads are not available — no media store is configured');
    this.name = 'UploadsUnavailableError';
  }
}

// ── The users directory ─────────────────────────────────────────────────────

/** A requester account id that matches nothing. Mapped to 404.
 *
 *  Named plainly, unlike `UnknownAccessLinkError` and `UnknownCouponError`
 *  which are deliberately vague: those answer a public route where "no such
 *  thing" is itself worth hiding. This one answers a staff route whose caller
 *  is already reading the whole directory. */
export class UnknownAccountError extends Error {
  constructor(readonly accountId: string) {
    super(`no requester account ${accountId}`);
    this.name = 'UnknownAccountError';
  }
}

/** A support action asked of an account it means nothing for — resending a
 *  confirmation to somebody already confirmed, or to somebody who never
 *  registered a password at all. Mapped to 409, so the screen can say which of
 *  those it was instead of showing an error page. */
export class NothingToSendError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NothingToSendError';
  }
}

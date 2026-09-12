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

export class UnknownPersonError extends Error {
  constructor(readonly ref: string) {
    super(`no staff member ${ref}`);
    this.name = 'UnknownPersonError';
  }
}

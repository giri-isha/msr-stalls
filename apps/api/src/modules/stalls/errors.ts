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

/** Two backoffice members selected the same stall at once and the database constraint
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

/** A request in a bay this caller's grant does not reach. Mapped to 403, the
 *  same as every other refusal — which half of the rule stopped them is not the
 *  caller's business. */
export class ZoneForbiddenError extends Error {
  constructor(readonly zoneCode: string | null) {
    super(`this request is not in a bay you cover`);
    this.name = 'ZoneForbiddenError';
  }
}

/** An edition this caller's grant does not reach. Mapped to 403.
 *
 *  ⚠️ Not 404 and not an empty list: a volunteer whose grant covered only last
 *  year needs to be told that their access has lapsed, not shown an event with
 *  nothing in it. */
export class EditionForbiddenError extends Error {
  constructor(readonly editionId: string) {
    super('your access does not cover the edition currently running');
    this.name = 'EditionForbiddenError';
  }
}

/** A role key that no longer names a role. Mapped to 404.
 *
 *  Reachable now that roles are data: an admin may retire one between a screen
 *  loading its picker and somebody choosing from it. */
export class UnknownRoleError extends Error {
  constructor(readonly roleKey: string) {
    super(`no stalls role ${roleKey}`);
    this.name = 'UnknownRoleError';
  }
}

/** A grant refused because the role sits above the grantor in the hierarchy.
 *  Mapped to 403.
 *
 *  Carries the wording from `cannotAssign` rather than building its own: an
 *  admin who meets this on two screens should read the same sentence. */
export class RoleAboveYouError extends Error {
  constructor(
    readonly roleKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'RoleAboveYouError';
  }
}

/** An account refused because its holder sits above the caller. Mapped to 403.
 *
 *  Distinct from `RoleAboveYouError` because it is a wider refusal: not "you
 *  cannot give them that role" but "you cannot touch this account at all". */
export class PersonAboveYouError extends Error {
  constructor(
    readonly personRef: string,
    message: string,
  ) {
    super(message);
    this.name = 'PersonAboveYouError';
  }
}

/** A role key somebody already used. Mapped to 409. */
export class RoleKeyTakenError extends Error {
  constructor(readonly roleKey: string) {
    super(`a stalls role called ${roleKey} already exists`);
    this.name = 'RoleKeyTakenError';
  }
}

/** A role that people still hold. Mapped to 409.
 *
 *  Deleting it would strand their grants, so the grant table refuses it at the
 *  foreign key too. This is the readable version of that refusal, raised before
 *  the database has to. */
export class RoleInUseError extends Error {
  constructor(
    readonly roleKey: string,
    readonly grantCount: number,
  ) {
    super(
      `${roleKey} is held by ${grantCount} ${grantCount === 1 ? 'person' : 'people'} — ` +
        'revoke it from them before deleting it',
    );
    this.name = 'RoleInUseError';
  }
}

/** A shipped role somebody tried to delete or re-key. Mapped to 409.
 *
 *  ⚠️ Its PRIVILEGES stay editable. Retuning what Lead grants is the whole
 *  point of roles being data; what cannot change is the key, because grants and
 *  the host's participation rows refer to it, and the role's existence, because
 *  the seed would put it straight back. */
export class SystemRoleError extends Error {
  constructor(
    readonly roleKey: string,
    what: string,
  ) {
    super(`${roleKey} ships with the module and ${what}`);
    this.name = 'SystemRoleError';
  }
}

/** A parent that would make the hierarchy loop back on itself. Mapped to 409. */
export class RoleCycleError extends Error {
  constructor() {
    super('that would make the role hierarchy loop back on itself');
    this.name = 'RoleCycleError';
  }
}

/** An attempt to put something into a role that the author does not hold.
 *  Mapped to 403.
 *
 *  🔴 The guard that stops `roles.write` being a route to every other
 *  privilege. Whoever can author a role can, with `users.write`, hand it to
 *  themselves — so a role may never carry more than its author already carries. */
export class PrivilegeEscalationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivilegeEscalationError';
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

/** A requester type this backoffice member's roles do not reach. Mapped to 403.
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
    super(`no backoffice member ${ref}`);
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
 *  thing" is itself worth hiding. This one answers a backoffice route whose caller
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

/** An edit that would move a requester onto an address another account already
 *  holds. Mapped to 409.
 *
 *  ⚠️ Names the account in the way: email is the module's identity key, so the
 *  desk correcting a typo needs to know they have found the vendor's OTHER
 *  account rather than an anonymous collision. Both rows are already on the
 *  screen in front of them. */
export class AccountEmailTakenError extends Error {
  constructor(readonly heldBy: string) {
    super(`${heldBy} already uses this email — a requester's address is their identity here`);
    this.name = 'AccountEmailTakenError';
  }
}

/** A password a desk cannot set for a requester. Mapped to 409.
 *
 *  Two conditions reach it, and both are answerable on the screen that raised
 *  them: the account carries no address or number to register a login against,
 *  and the contact it does carry is already another account's login. Neither
 *  is a bug in the request — the desk's next move is to correct the requester's
 *  details, which is the dialog one row over.
 *
 *  ⚠️ TEMPORARY, with the rest of the requester password login. */
export class CannotSetPasswordError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CannotSetPasswordError';
  }
}

/* ── Declarations ──────────────────────────────────────────────────────────*/

/** A declaration id that is not on this edition. Mapped to 404. */
export class UnknownDeclarationError extends Error {
  constructor(readonly id: string) {
    super('that declaration is not on this edition');
    this.name = 'UnknownDeclarationError';
  }
}

/** A key an admin typed that the vocabulary will not take. Mapped to 400.
 *
 *  ⚠️ The key is what a consent is FILED under and it is stable across versions
 *  and variants, so it has the shape of an identifier rather than of a
 *  sentence. Refused with the rule rather than silently slugified: an admin who
 *  typed "Request Submission" and got `request_submission` would have no idea
 *  which of the two to reuse when adding a variant later. */
export class BadDeclarationKeyError extends Error {
  constructor(readonly key: string) {
    super(`"${key}" is not a declaration key — use lower case letters, digits and underscores`);
    this.name = 'BadDeclarationKeyError';
  }
}

/** A key and variant that already exist. Mapped to 409.
 *
 *  ⚠️ Reusing a KEY is the documented way to add a form-specific wording — the
 *  same key, one row per form — so this fires only when the key and the variant
 *  both already exist, and the message says which of the two the admin meant. */
export class DeclarationExistsError extends Error {
  constructor(
    readonly key: string,
    readonly requestType: string | null,
  ) {
    super(
      requestType
        ? `${key} already has a ${requestType} variant — edit that one instead`
        : `${key} already exists — edit it, or add a variant for one form`,
    );
    this.name = 'DeclarationExistsError';
  }
}

/** An edit aimed at a version that has been superseded. Mapped to 409.
 *
 *  🔴 An archived version is a RECORD, not a draft. Editing one would change
 *  what somebody is recorded as having agreed to, which is the entire thing
 *  versioning exists to prevent — so it is refused rather than quietly forked
 *  into a new version off an old branch. */
export class ArchivedDeclarationError extends Error {
  constructor(readonly id: string) {
    super('that is an archived version — edit the current one instead');
    this.name = 'ArchivedDeclarationError';
  }
}

/** The wording moved while somebody had the form open. Mapped to 409.
 *
 *  🔴 The one refusal in this module that exists to protect the REQUESTER
 *  rather than the data. A consent is worth exactly what the person saw when
 *  they gave it, so a form that was opened before a new version was published
 *  cannot be allowed to submit against it — the alternative is a log recording
 *  agreement to a paragraph that was never on their screen, which is worse than
 *  useless because it looks authoritative. They re-read and tick again. */
export class DeclarationsChangedError extends Error {
  constructor() {
    super(
      'the wording on this form was updated while you had it open — ' +
        'please read it again and resubmit',
    );
    this.name = 'DeclarationsChangedError';
  }
}

/* ── The form builder ──────────────────────────────────────────────────────*/

/** A field id that is not on this edition. Mapped to 404. */
export class UnknownFormFieldError extends Error {
  constructor(readonly id: string) {
    super('that field is not on this edition');
    this.name = 'UnknownFormFieldError';
  }
}

/** A form or section id that is not on this edition. Mapped to 404. */
export class UnknownFormError extends Error {
  constructor(readonly id: string) {
    super('that form is not on this edition');
    this.name = 'UnknownFormError';
  }
}

/** An edit to the one thing a built-in field cannot change. Mapped to 409.
 *
 *  🔴 Not a policy. A built-in field's answer lands in a TYPED COLUMN on
 *  `stall_request` — `stall_name`, `email`, `num_stalls_requested` — so
 *  retyping one would post a string into an integer column and renaming one
 *  would post an answer the submit path has nowhere to put. Everything a screen
 *  can actually control is editable on these fields; this is the short list
 *  that having a database underneath makes impossible.
 *
 *  ⚠️ A built-in that should stop being asked is switched OFF, not deleted or
 *  retyped — `isActive` is supported on every field for exactly this. */
export class BuiltInFieldLockedError extends Error {
  constructor(
    readonly label: string,
    readonly attribute: string,
  ) {
    super(
      `"${label}" is a built-in question and its ${attribute} cannot change — ` +
        'its answer goes into a column of its own. Switch it off instead of changing it.',
    );
    this.name = 'BuiltInFieldLockedError';
  }
}

/** A field type the builder cannot author. Mapped to 400.
 *
 *  ⚠️ `appliances` and `zone` are STRUCTURAL: one is a repeating row editor
 *  wired to its own table, the other resolves its choices from the edition's
 *  bays at render time. Offering either from a picker would produce a field
 *  nothing knows how to draw. */
export class UnauthorableFieldTypeError extends Error {
  constructor(readonly fieldType: string) {
    super(`"${fieldType}" is not a field type a form can be given`);
    this.name = 'UnauthorableFieldTypeError';
  }
}

# Filing on behalf of a requester, and a full audit log

Date: 2026-09-17
Status: Proposed

## The problem

Two gaps, one root: the module knows what happened to a request only when the
requester did it themselves.

**Nobody can file for a requester.** The only write that creates a request is
the public one, keyed on the requester's own session. The same is true of the
bank form, the FSSAI upload, staff registration and the payment claim: each is
reached by a signed link or a coupon the requester holds. The traceability
sheet marks "the local welfare team files on behalf of their traders" as built,
and the `requests.write` privilege describes itself as "Enter a request on
behalf of a trader" — but only the role scoping was built. A village trader with
no email address, a vendor who cannot follow a link read out over the phone, an
ashram department that sends a paper form: the backoffice has no screen for any
of them.

**The trail is write-only, and thin.** The module calls the host's
`recordActivity` at fifty places, and nothing reads a single row back. Public
writes are half-covered — the bank form is recorded with the *request id* as
the actor, the FSSAI upload, staff registration and payment claim are not
recorded at all — and nothing records a requester signing in, a letter going
out, or what a field said before it was amended. "Who changed this, and from
what" cannot be answered today.

## Decisions

### Filing on behalf

1. **Five privileges in a category of their own.** `filing.request`,
   `filing.bank`, `filing.fssai`, `filing.staff`, `filing.claim`, all of kind
   `action`, under a new category `filing` — *Filing on behalf*. Not five more
   items under Requests: the category is the unit a role is granted whole, and
   these hand a backoffice member the power to speak for a requester. Seeded:
   Admin reaches them through `allPrivileges`; Lead holds all five; Local
   Welfare holds request, FSSAI, staff and claim — never bank, because a local
   welfare stall is not asked for bank details. Finance, Volunteer and
   Electrical hold none. `requests.write`'s description loses the words "on
   behalf of a trader": it amends, and filing is now its own privilege.

2. **Requester-type scope still governs.** A Local Welfare member may file only
   a `LOCAL_WELFARE` form, and every request-addressed filing route passes
   `requireRequestScope` before it does anything. The form-picker step offers
   only the types inside the caller's scope.

3. **A contact of either kind is enough.** `StallAccount.email` and `.phone`
   both become nullable, with a check constraint that at least one is present.
   `email` keeps its unique index (Postgres allows many nulls); `phone` gains a
   unique index of its own, since it is now a lookup key that can stand alone.
   Filing takes the requester's display name plus an email, a phone or both.
   `findAccountByContact` already resolves either.

4. **An existing account is attached to, never duplicated.** Before the form is
   shown, the contacts are resolved. One match: the screen names the account
   ("This is Kumar Stores, 2 requests") and the request attaches to it. No
   match: a new account is created with the form's requester type. Two
   different accounts for the two contacts: refused with a sentence that says
   so; the filer picks one contact. An account whose `requesterType` differs
   from the chosen form is refused exactly as the public write refuses it.

5. **The receipt goes to the requester, and only the reference comes back.**
   If the account has an email the receipt with the status link is mailed; if
   only a phone, it goes by WhatsApp; if the send fails the request still
   stands. The filing response carries the reference and the request id, never
   the token — the rule the support routes already follow, because a route that
   hands a backoffice member the link is a route into the account.

6. **The submit functions gain an actor; nothing else about them changes.**
   `submitRequest`, `submitBankDetails`, `submitFssai`, `registerStaff` and
   `submitPaymentClaim` each take an `Actor`:

   ```ts
   type Actor =
     | { kind: 'requester'; accountId: string }
     | { kind: 'backoffice'; personId: string; onBehalfOfAccountId: string };
   ```

   The public routes pass the first; the five new backoffice routes pass the
   second. Validation, the stall cap, the type check, the declarations check,
   the coupon capacity — all run once, in the same function, for both callers.

7. **Five backoffice routes.** In `routes.ts`, each gated on its own privilege
   and then on scope:

   | Route | Privilege | Calls |
   |---|---|---|
   | `POST /requests/file` | `filing.request` | `submitRequest` |
   | `POST /requests/:id/bank` | `filing.bank` | `submitBankDetails` |
   | `POST /requests/:id/fssai` | `filing.fssai` | `submitFssai` |
   | `POST /requests/:id/staff` | `filing.staff` | `registerStaff` via the request's coupon |
   | `POST /requests/:id/payment-claim` | `filing.claim` | `submitPaymentClaim` |

   `FileRequestInput` is `{ requester: { displayName, email?, phone? },
   request: SubmitRequestInput, attestation: true }`. Staff filing resolves the
   request's live coupon with `ensureCoupon` and registers against it, so the
   capacity rule and the coupon's audit both still hold. Documents for the bank
   form and FSSAI are presigned through the existing backoffice `POST /uploads`;
   `isOurKey` checks the shape of a key, not who minted it, so the same purposes
   are accepted from either side.

8. **Declarations are attested, not skipped.** The filer is shown the same
   declarations the requester would see and ticks one box: "I read these to the
   requester and they agreed." `StallDeclarationConsent` gains a nullable
   `attestedBy` (a person id, no FK — Person is another module's). A consent
   row with `attestedBy` set is one the requester did not tick themselves, and
   the request's detail says so beside the declarations.

9. **The public forms split into a body and a wrapper.** `RequestForm`,
   `BankForm`, `FssaiForm`, `StaffRegistration` and `PaymentClaimDialog` each
   become a body component that takes its config and a submit function, and a
   thin public wrapper that loads by token or session exactly as today. The
   backoffice reuses the bodies; the public pages do not change behaviour.

10. **Two entry points in the backoffice.** On Requests, a **File a request**
    button (drawn for any holder of `filing.request`) opens
    `/m/stalls/requests/new`: which form, who the requester is, then the form.
    On a request's detail, the Bank Form, FSSAI and Staff tabs show **Enter on
    their behalf** while the step is outstanding and the caller holds the
    matching privilege, and the payment area shows **Record a transfer they
    reported**. Every heading names the requester, and the submit button reads
    "File on their behalf" — never "Submit", so the filer is not for a moment
    the vendor.

### The audit log

11. **A module-owned table, insert-only.** `StallAuditEvent` in the `stalls`
    schema:

    | Column | Notes |
    |---|---|
    | `id`, `occurredAt` | |
    | `editionId?`, `requestId?`, `accountId?` | text refs, no FKs — the trail outlives the rows |
    | `actorKind` | `BACKOFFICE` · `REQUESTER` · `SYSTEM` |
    | `actorRef` | person id, account id, or `system` |
    | `actorName` | display name at the time, so a renamed or deleted person still reads |
    | `onBehalfOfAccountId?` | set on every filing |
    | `channel` | `BACKOFFICE` · `PORTAL` · `SYSTEM` |
    | `action` | `noun.verb`, the existing vocabulary |
    | `subjectType`, `subjectRef` | |
    | `changes?` | `[{ field, before, after }]` |
    | `detail` | anything the reader needs, kept small |
    | `outcome` | `OK` · `FAILED`, for sends and logins |

    Indexes: `(editionId, occurredAt)`, `(requestId, occurredAt)`,
    `(actorRef, occurredAt)`, `(action)`. No route updates or deletes a row.
    No retention rule: the log lives as long as the database.

12. **One writer.** `audit(tx, event)` in `apps/api/src/modules/stalls/audit.ts`
    inserts the row and forwards the same event to the host's `recordActivity`
    with `onBehalfOfAccountId` and `changes` folded into `detail`, so the
    host's console sees everything at migration. It is the only file in the
    module that imports the foundation stub; the boundary rule is tightened to
    say so. All fifty existing call sites move to it. On the way, the public
    writes that name the request as the actor are fixed to name the account.

13. **The vocabulary is typed.** `AUDIT_ACTIONS` in `@stalls/core` lists every
    action as a literal, and `describeAuditAction(action)` returns its label,
    family and glyph. `audit()` takes the union, so an action nobody labelled
    does not compile — the same trick `STALL_PRIVILEGES` uses.

14. **New events.** Requester: `stall_account.registered`, `.logged_in`,
    `.login_failed`, `.logged_out`, `.password_reset_requested`,
    `.password_reset`, `.access_link_requested`. Portal submissions:
    `stall_request.submitted`, `stall_fssai.submitted`,
    `stall_vendor_staff.registered`, `stall_payment_claim.submitted`, each
    attributed to the account, with `onBehalfOfAccountId` when a backoffice
    member filed it. Backoffice: `stall_backoffice.signed_in`, written by
    `auditBackofficeSignIn(db, person)`, which the module exports and the
    shell's dev sign-in calls; `migration-to-host.md` gains a line saying the
    host's SSO owns this event there. Outbound: `stall_email.sent` /
    `.failed` and `stall_whatsapp.sent` / `.failed`, written by two decorators
    that wrap `deps.mail` and `deps.whatsapp` at registration. `OutboundMail`
    and `OutboundWhatsApp` gain an optional `about?: { requestId?, accountId? }`
    so a letter is filed against the request it concerns.

15. **Change sets on every update.** A pure `changeSet(before, after, fields)`
    returns `[{ field, before, after }]` for the fields that differ.
    `patchRequest` and every other `*.updated` / `*.amended` action record one.
    Bank account numbers are stored masked to their last four digits in both
    `changes` and `detail`; the record is the source, the log is not a second
    copy of it. Aadhaar is already stored as last four only.

16. **Reading is a sensitive privilege.** `audit.read`, kind `sensitive`, in a
    new category `audit` — *Audit*. Seeded to Lead; Admin reaches it through
    `allPrivileges`. Nobody else. Two routes:

    - `GET /audit` — the active edition's log. Query: `q` (matches action
      label, actor name, reference), `actions[]`, `actorKind`, `actorRef`,
      `requestId`, `from`, `to`, `page`, `pageSize`. Edition scope applies
      through `activeEditionFor`. Events carrying a `requestId` are narrowed by
      the request's type through `scopeWhere`; events carrying none — role
      edits, config — are visible to any holder of the privilege. Rows return
      the actor's display name and, when there is one, the request's reference
      and requester type.
    - `GET /requests/:id/audit` — one request's timeline, after
      `requireRequestScope`.

17. **Two screens.** **Audit Logs** at `/m/stalls/audit`, a nav item gated on
    `audit.read`: search, an event-type filter, actor-kind chips (All ·
    Backoffice · Requesters · System), a date range, a paged table with
    Timestamp · Event · Actor · Entity · Channel, and an expandable row showing
    the change set and detail. **Activity Log**, a tab on `RequestDetail` drawn
    for holders of `audit.read`: a timeline with a glyph per action family,
    each entry expandable to the change set (old value struck through, new
    value beside it) or to the submitted form data. Both read labels from
    `describeAuditAction`, so the two screens and the Documentation say the
    same words.

18. **What is deliberately not recorded.** Reads. Who opened a bank detail or
    exported a list is not written, because a row per view would bury the
    writes the log exists to answer for. If that changes it is one more
    `audit()` call in the route, not a redesign.

## Data flow

Filing a request from the backoffice:

```
Requests › File a request
  └─ pick form (narrowed to caller's scope)
  └─ requester: name + email/phone  →  GET /users?contact=  →  attach or new
  └─ RequestFormBody(config, submit)
       submit → POST /requests/file
                 requirePrivilege('filing.request') → narrowType(scope, form)
                 → submitRequest(db, input, deps, { kind:'backoffice', personId, onBehalfOfAccountId })
                     tx: account (find or create) → request → consent(attestedBy) → audit(stall_request.submitted, onBehalfOf)
                     after commit: receipt to account's email or phone → audit(stall_email.sent | failed)
                 ← { requestId, reference }
  └─ navigate to /m/stalls/requests/:id, toast with the reference
```

Reading one request's log:

```
RequestDetail › Activity Log
  └─ GET /requests/:id/audit  →  requireBackoffice → requirePrivilege('audit.read') → requireRequestScope
       → stallAuditEvent.findMany({ requestId }, orderBy occurredAt desc)
       → actor names already on the row; reference joined from the request
```

## Error handling

- A filing route refuses with the module's existing errors — wrong requester
  type, too many stalls, declarations changed, coupon full — and the web puts
  each back on the field that caused it, as the public form does.
- Two contacts naming two accounts is a new `AmbiguousRequesterError` (409)
  with both display names in the message.
- A receipt that fails to send does not fail the filing; the failure is its own
  audit row and the toast says the request was filed and the receipt was not.
- `audit()` runs inside the caller's transaction where there is one, so a write
  with no audit row cannot commit. Outbound and sign-in events run outside a
  transaction and are best-effort: a failure to write one is logged and does
  not fail the send.

## Testing

- **Filing routes**, one file per route: privilege refused (403), scope refused
  (404, as every scoped route does), account created / attached / ambiguous,
  receipt sent when a contact exists and not when none, consent row carries
  `attestedBy`, audit row carries `onBehalfOfAccountId` and the filer as actor.
- **Writer**: row inserted and host trail forwarded with the same action;
  masking applied to account numbers; an unknown action does not compile.
- **Change sets**: pure tests on `changeSet`; `patchRequest` records before and
  after.
- **New events**: each requester and portal event has a test asserting the row
  and its actor kind; the mail decorator records sent and failed.
- **Read routes**: `audit.read` refused without it; edition scope; type scope
  narrows request-bound events and leaves unbound ones; filters and paging.
- **Web**: the filing flow (form picker narrowed to scope, requester lookup
  attach/new, submit button wording), the two screens render and filter, the
  Activity Log tab is absent without `audit.read`.
- **Core**: every `AUDIT_ACTIONS` member has a label, family and glyph; the
  parity test on seeded roles is extended to the new privileges.

## Out of scope

- A requester-facing activity log on the portal.
- Editing or purging audit rows, and any retention schedule.
- Recording reads.
- Claiming an account a backoffice member created: the trader who later gets an
  email still goes through the desk (`passwords.write`), as `requirements-
  traceability.md` already records.

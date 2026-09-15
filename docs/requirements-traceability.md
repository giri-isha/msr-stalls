# Requirements → where they live

Every line of the MSR 2026 stalls requirement, against the code that answers
it. Written as a cross-check, so the three columns that matter are: what was
asked, where it is, and where what was built differs from what was asked.

Status vocabulary:

- **Built** — the requirement is met.
- **Differs** — met in a different shape, deliberately. The reason is given;
  each of these is a decision the stalls team can reverse.
- **Open** — not built, and worth a decision.

Paths are the screen (web) or the route (api). `@msr/stalls` is the pure
package both sides share.

---

## 1. Registration and the four request forms

| Requirement | Where | Status |
|---|---|---|
| Ashram, Ashram Food, Local Welfare and Vendor request forms | `packages/stalls/src/forms.ts`, `/stalls/apply/:type` | Built |
| The 2025 field lists, with their Tamil | `forms.ts` (transcribed from the 2025 PDFs) | Built |
| Anyone with the link can register | `POST /public/register` is open and rate-limited per IP; `POST /public/requests` now needs a session | Built |
| Register and log in with email or phone number | `POST /public/register` with an email **or** a mobile and a password, confirmed by a link sent to that contact; `POST /public/login` returns a session cookie. `/stalls/status` still emails a signed link to anyone who never registered. A logged-in requester reads the same portal at `GET /public/requests` — the session and the signed link are two credentials onto one view. | Built — see [Vendor identity](#vendor-identity) below. The password is a stopgap until the host's Isha OIDC. |
| Admin-added questions | `StallCustomField`, Admin → Custom fields | Built |
| At most two stalls in one bay per request — "if they want another area, they raise another request, so we can individually accept one and reject the other" | `StallEdition.maxStallsPerRequest`, enforced in `submit.ts`; 422 with the cap in the message | Built |

## 2. Planning

| Requirement | Where | Status |
|---|---|---|
| Food stalls per zone computed from the crowd in each bay | `StallZone.expectedCrowd` ÷ `StallChargeConfig.crowdPerStall`, `planning.ts` | Built |
| Stalls per numeric number entered by the coordinator | `crowdPerStall`, editable in Admin → Charges | Built |
| Categories as in the 2025 planning sheet | `StallCategory` (vendor food, ashram food, LW food, vendor non-food, ashram non-food, help desk, backup) | Built |
| Zones, stall counts and stall numbers configured | Admin → Zones; `applyPlan` generates numbers and never removes an allocated stall | Built |

## 3. Vendor selection

| Requirement | Where | Status |
|---|---|---|
| View stall, location and owner details, then **shortlist** | Stall Requests → request detail → Shortlist | Built |
| View the same, then **select** | `SelectDialog`, `POST /requests/:id/select` | Built |
| A column for the stall number area, from the configured zones | `StallAllocation` → `Stall.number`; shown on the list, the detail and the vendor's own page | Built |
| One stall, one occupant | Database constraint on `StallAllocation.activeStallId`, not a check-then-write | Built |
| Moving a requester to another bay — "that side is already filled up, why don't you look at this side" | `StallRequest.agreedZoneCode`, written by `POST /requests/:id/select` or `PATCH /requests/:id`. It is what the quote prices, ahead of the bay that was asked for | Built |
| Selecting before a stall number exists — "the side will be decided, but the stall number may not be still put at the time of the payment" | `stallNumbers` may be empty; the bay alone selects the request | Built |
| Correcting a request over the phone — "in case there are any other changes, we anyway speak to them and make that" | `PATCH /requests/:id`, Stall Requests → request detail → Amend. Status, allocations, money and the agreement timestamps are deliberately not patchable | Built |

## 4. Vendor communication

| Requirement | Where | Status |
|---|---|---|
| Email template with an attachment | `StallEmailTemplate` (subject, body, one attachment key), Communication → Templates | Built |
| Different templates for ashram and vendor stalls | `SELECTION_ASHRAM` / `SELECTION_VENDOR` | Built |
| Bulk send and individual send | One route (`POST /comms/send`); a list of one is an individual send | Built |
| WhatsApp beside the email — "we would like to send them a WhatsApp message, as well as an email" | A second body per template (`whatsappBody`), edited on the same screen. Short, no attachment; empty means the letter is email-only | Built |
| Editable wording — "the content we may like to change, but it should have a specific way of getting the data from the system for each person" | Communication → Templates, with the placeholder list and a warning for one the module cannot fill | Built |
| Triggered by hand, not automatically — "we toggle between shortlist and selected; sometimes by mistake we do the selection, so let the mail be a manual trigger" | Every send is a button; nothing sends on a status change | Built |
| Once sent, never sent again | `UNIQUE (requestId, templateKey, channel)` on `StallMessageLog` — a constraint, not a flag. Per channel, so a WhatsApp that failed can be retried without re-sending the email | Built |
| Who has had a letter, and when | Communication list shows `sentAt` per template | Built |

## 5. Bank, GST and contract collection

| Requirement | Where | Status |
|---|---|---|
| The selection email carries the bank-form link | `comms.ts` mints a `BANK_FORM` link into `SELECTION_VENDOR` | Built |
| The 2025 bank form's fields, vendors only | `StallBankDetail`, `/stalls/bank/:token` | Built |
| Cheque, PAN and GST documents | Presigned straight to object storage; the API never sees the bytes | Built |
| Contract agreement | The agreement checkboxes the 2025 form used (`agreedTermsAt`, `agreedNeftAt`), plus digital signature through a provider port (`signer.ts`, `StallContractSignature`) — `GET/POST /requests/:id/signature` and `POST .../refresh` | Built; no provider is wired up in this repo, and the standalone adapter reports itself unconfigured rather than pretending |
| The terms document the requester accepts — "to view the terms and conditions document, please click here" on the 2025 form | `StallEdition.termsUrl`, set in Admin → Season settings, linked beside the acceptance tick-box on the bank form. Blank until the legal team issues one, and the consent then stands without a link rather than with one that 404s | Built |
| MICR code | Required on the 2025 form; optional here | Differs — the cancelled cheque carries it and is uploaded anyway, so requiring it turns a legible cheque into a blocked submission |
| Reminder calls for bank details pending | `StallReminderCall(kind: BANK)`, Communication → Reminder calls | Built |
| A vendor who lost the email can get back to the form | Their status page lists what is outstanding and opens the bank form from there — reached by the emailed link (`/stalls/status/:token`) **or**, once logged in, from `/stalls/requests` | Built |

## 6. Payment details and finance

| Requirement | Where | Status |
|---|---|---|
| Payment email once bank details are in | `PAYMENT_DETAILS` template | Built |
| The calculation shown on the selected-vendor screen | `quote.ts`, itemised as the 2025 payment sheet itemises it | Built |
| Who was sent it, with the date | `StallMessageLog`, per channel | Built |
| The figures frozen at the moment the vendor is told | `StallPaymentPlan` | Built |
| Finance confirms fee and deposit with reference, amount and date | `StallPaymentRecord`, Finance → Payment confirmation | Built |
| What the local welfare team actually agreed to collect — "for A3 the cost is 10,000; for the coconut wala, probably we will give that at 5,000 — it is best that it is there in the system" | `StallPaymentPlan.discretionaryFeePaise` with a required reason, `PUT /finance/payments/:id/discretionary-fee`. The quoted figure is kept: what they were told and what they owe are two numbers, and "paid in full" is measured against the second | Built |
| Payment through the system | Not built. Payment is NEFT to a virtual account, as in 2025, and the Finance screen says so. | Open — deliberate; revisit only if a gateway is introduced |
| Reminder calls for payment pending | `StallReminderCall(kind: PAYMENT)`, same screen | Built |

## 7. Vendor staff registration

| Requirement | Where | Status |
|---|---|---|
| Email after payment with FSSAI process and the registration link | `ONBOARDING_FSSAI_STAFF` template | Built |
| Registration by secure coupon, so only the vendor's team can use it | `StallStaffCoupon` — 40 bits in a readable alphabet; `coupons.ts` | Built |
| The registration fields | `StallVendorStaff`, `/stalls/staff/:code` | Built |
| Aadhaar | Only the last four digits are ever stored | Differs — deliberate |

## 8. FSSAI certificate

| Requirement | Where | Status |
|---|---|---|
| The vendor logs in and uploads | `/stalls/fssai/:token`, reached from the email **or** from their own status page | Built |
| The team verifies | Vendor Onboarding → verify; a re-upload clears the tick | Built |

## 9. Electrical and venue prep

| Requirement | Where | Status |
|---|---|---|
| Stall-wise layout and electrical details, per bay | Electrical & Venue, `GET /electrical` | Built |
| Printable on A4 | `@media print` scoped to that screen | Built |
| Shared with the electrical and venue-prep teams | By print, or by a sign-in holding the **Electrical & Venue Prep** role — `electrical:read`, which reaches the sheet and the bay list and nothing else | Built |

## 10. Check-in

| Requirement | Where | Status |
|---|---|---|
| Vendor name, stall number, staff registered, vehicle passes | Check-in, `GET /checkin` | Built |
| What is still pending — payment, FSSAI, staff | `pendingSteps` in `@msr/stalls`, the same function the vendor's page reads | Built |
| Ashram stalls check in too | Same screen; the pending list adapts to the requester type | Built |
| Nothing blocks a check-in | Deliberate: the chips inform, they do not gate | Built |

## 11. Chairs and tables

| Requirement | Where | Status |
|---|---|---|
| What each stall asked for | `StallEquipmentIssue` snapshots it when the row opens | Built |
| Mark as distributed | Chairs & Tables → Distribute | Built |
| Add extras and collect the money | `extraChairs` / `extraTables` / `extraChargePaise` / `extraCollectedAt` | Built |
| Mark as collected the next day | `collectedAt` | Built |
| Note what is broken or missing | `missingChairs`, `missingTables`, `damaged`, `note` | Built |
| Flag the stall for the next action | `flagged` | Built |
| A printable challan | `GET /equipment/:id/challan`, two-part, print-scoped | Built |

## 12. Refund to finance

| Requirement | Where | Status |
|---|---|---|
| Chairs and tables not returned or damaged, priced | `equipmentDeduction` in `quote.ts`, rates in Admin → Charges | Built |
| Penalties for unclean stalls | `StallFine`, categories in Admin → Fine types | Built |
| The amount handed to Finance, with a voucher reference | `StallRefund`, Finance → Refunds | Built |
| Equipment deductions come off the **chairs-and-tables** deposit; penalties off the **stall** deposit | `StallRefund.stallDepositPaise` / `equipmentDepositPaise`, each deduction charged to its own, with a shortfall per bucket. The quote has always computed the two apart and the 2025 payment sheet carries both columns | Built |

## 13. Admin

| Requirement | Where | Status |
|---|---|---|
| Stall amount (vendor and local welfare) | Admin → Bays and rent, a row per bay × food/non-food × requester scope (`StallRateCard`) | Built |
| Refundable advance, area-wise | `StallRateCard.depositPaise` — it rides on the rate row, so a bay's rent and its advance are edited together and cannot drift apart | Built |
| Furniture deposit | Admin → Charges (`chairTableDepositPaise`), flat and charged once when any furniture is taken, as the 2025 sheet carries it | Built |
| Chair and table amount | Admin → Charges — three rates, because 2025 quoted three: ashram, local welfare, and the vendor pair the bank-details form carries | Built |
| Fine categorisation | Admin → Fine types | Built |
| Access management | Access → Users, `StallStaffRole`. A role hierarchy limits who may hand out which role, and a grant can be narrowed to particular seasons and bays | Built |
| Bays added and removed for a redrawn venue | Admin → Bays (`POST`/`DELETE /config/zones`). A bay holding stalls refuses with a 409 rather than cascading | Built |
| The planning grid's columns | Admin → Planning columns (`PUT /config/plan-categories`), including the sponsor and Adiyogi columns the 2025 sheet carries | Built |
| The season's own settings | Admin → Editions (`PATCH /editions/:id/settings`): name, the two virtual-account prefixes, the stalls-per-request cap — which the public write enforces | Built |
| Number of stalls, stall numbers | Planning → Apply | Built |
| What one coupon admits | Onboarding → the coupon block (`PUT /onboarding/:id/coupon/capacity`). Eight by default, raised case by case on the code the vendor already holds | Built |

## 14. Types of user

| Requirement | Where | Status |
|---|---|---|
| External vendors / local welfare / ashram stall vendors | Requester types on the account side (`StallRequestType`), never staff roles | Built |
| Admin, Lead, Volunteer | `stall_role` / `stall_privilege`, seeded from `SEED_ROLES` in `@msr/stalls/rbac.ts`. Roles are DATA — an admin retunes them in Access → Roles & Privileges without a deploy | Built |
| — | A fourth role, **Finance**, exists because the finance requirement needs one that is not the Lead | Differs — an addition, not a substitution |
| The local welfare team works inside the application and files on behalf of their traders | A fifth role, **Local Welfare**, scoped to `LOCAL_WELFARE` requests. `scope.ts` narrows every list and guards every request-addressed route, so the role's write access cannot reach a commercial vendor's record | Built |

---

## Decisions still open

### Vendor identity

The requirement says "register & login (SSO) using email or phone number".

**Closed 2026-09-15, in mechanism.** A requester registers with an email
address or a mobile number and a password, confirms it by following a link sent
to that contact, and logs in for a session. `/stalls/apply` asks for an account
before it opens a form, and a request now belongs to the session rather than to
the address typed into it. Design:
`docs/superpowers/specs/2026-09-15-stalls-vendor-login-design.md`.

Item 1, **delivery is email only**, is closed with it: a mobile registration
confirms and resets over the existing WhatsApp port, so a requester with no
working email address is no longer dependent on one.

**Item 2, real SSO, stays open — and is the reason the password is temporary.**
It would mean the host's Isha OIDC. Ashram departments have identities there;
external vendors do not, and host ADR 0016 keeps vendors out of the `Person`
directory deliberately. Reversing that is a host decision, not a module one.

The password login is built to be deleted rather than extended. A session is a
`StallAccessLink` carrying a `SESSION` purpose, minted by `startSession` — so
the swap is: an OIDC callback calls that same function, `StallCredential` and
the six password routes are dropped, and nothing else in the module moves.

**What is still NOT self-serve.** Registering on a contact that already has an
account does not attach a password to it — staff do that linking. So the
village traders the local welfare team files for, who have no address of their
own, still cannot reach the portal themselves; staff screens remain their only
route. That was a deliberate call, not an oversight, and `StallCredential` is
shaped to take a claim flow if it is revisited.

### Pooled deposit — closed

Previously recorded here as open, on the grounds that which deposit each
deduction came off was a policy question. It is not: the requirement answers it
in two sentences — furniture not returned or damaged "will be deducted from
deposit against chairs and tables", a penalty for an unclean stall "will be
deducted from stall deposit" — and both figures already existed on the quote
and on the 2025 payment sheet. The refund now charges each deduction to its own
deposit and carries a shortfall per bucket.

The one judgement made along the way, stated so it can be reversed: where
Finance has confirmed a deposit credit that differs from the quoted total (a
short payment), the amount is apportioned between the two buckets in the quoted
proportion, with the remainder on the stall deposit so the two always sum back
to exactly what was paid.

### The 2025 sources

The forms, the planning sheet, the payment sheet and the electrical sheet were
transcribed from the 2025 originals. If any of those Google Forms changed for
2026, the change has to be brought across by hand — `forms.ts` is the place, and
`packages/stalls/src/forms.test.ts` locks the field lists so a change is visible
in a diff.


## Open questions for the stalls team

Not defects, and not work that can be finished without an answer from outside
this repository.

| Question | Why it is open | Where |
|---|---|---|
| The Tamil for the refundable-advance consent | The 2025 Tamil names a flat Rs.4000. The advance is area-wise now, so that sentence is no longer true — and it is the sentence that tells a requester money will be withheld from them. It needs the team's own revised wording, not a translation invented here. The field renders its English help alone until then, which is correct rather than broken. | `packages/stalls/src/forms.ts`, `depositAcknowledged.helpTa` |
| Whether the vendor chair and table rates are current | Rs.100 and Rs.400 per day come from the 2025 bank-details form. They are seeded as an edition's defaults and an admin sets them per season, so a stale figure is editable rather than baked in — but nobody has confirmed the 2026 numbers. | Admin → Charges |

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
| Anyone with the link can register | `POST /public/requests` — the one open write, rate-limited per IP | Built |
| Register and log in with email or phone number | Submitting IS the signup: it creates an account keyed on the email and mints a signed link. `/stalls/status` takes an email address **or** a mobile number and emails that account its link back. | Differs — no password, no OTP. See [Vendor identity](#vendor-identity) below. |
| Admin-added questions | `StallCustomField`, Admin → Custom fields | Built |

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

## 4. Vendor communication

| Requirement | Where | Status |
|---|---|---|
| Email template with an attachment | `StallEmailTemplate` (subject, body, one attachment key), Communication → Templates | Built |
| Different templates for ashram and vendor stalls | `SELECTION_ASHRAM` / `SELECTION_VENDOR` | Built |
| Bulk send and individual send | One route (`POST /comms/send`); a list of one is an individual send | Built |
| Once sent, never sent again | `UNIQUE (requestId, templateKey, channel)` on `StallMessageLog` — a constraint, not a flag. Per channel, so a WhatsApp that failed can be retried without re-sending the email | Built |
| Who has had a letter, and when | Communication list shows `sentAt` per template | Built |

## 5. Bank, GST and contract collection

| Requirement | Where | Status |
|---|---|---|
| The selection email carries the bank-form link | `comms.ts` mints a `BANK_FORM` link into `SELECTION_VENDOR` | Built |
| The 2025 bank form's fields, vendors only | `StallBankDetail`, `/stalls/bank/:token` | Built |
| Cheque, PAN and GST documents | Presigned straight to object storage; the API never sees the bytes | Built |
| Contract agreement | The agreement checkboxes the 2025 form used (`agreedTermsAt`, `agreedNeftAt`), plus digital signature through a provider port (`signer.ts`, `StallContractSignature`) — `GET/POST /requests/:id/signature` and `POST .../refresh` | Built; no provider is wired up in this repo, and the standalone adapter reports itself unconfigured rather than pretending |
| Reminder calls for bank details pending | `StallReminderCall(kind: BANK)`, Communication → Reminder calls | Built |
| A vendor who lost the email can get back to the form | Their status page lists what is outstanding and opens the bank form from there | Built |

## 6. Payment details and finance

| Requirement | Where | Status |
|---|---|---|
| Payment email once bank details are in | `PAYMENT_DETAILS` template | Built |
| The calculation shown on the selected-vendor screen | `quote.ts`, itemised as the 2025 payment sheet itemises it | Built |
| Who was sent it, with the date | `StallMessageLog`, per channel | Built |
| The figures frozen at the moment the vendor is told | `StallPaymentPlan` | Built |
| Finance confirms fee and deposit with reference, amount and date | `StallPaymentRecord`, Finance → Payment confirmation | Built |
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
| Shared with the electrical and venue-prep teams | By print or by a staff sign-in holding `planning:read` | Differs — there is no separate read-only role for those teams |

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
| Equipment deductions come off the **chairs-and-tables** deposit; penalties off the **stall** deposit | One pooled deposit (`depositHeldPaise`), both deductions against it, floored at zero, with `shortfallPaise` for anything over | Differs — see [Pooled deposit](#pooled-deposit) |

## 13. Admin

| Requirement | Where | Status |
|---|---|---|
| Stall amount (vendor and local welfare) | Admin → Bays and rent, a row per bay × food/non-food × requester scope (`StallRateCard`) | Built |
| Refundable advance, area-wise | `StallRateCard.depositPaise` — it rides on the rate row, so a bay's rent and its advance are edited together and cannot drift apart | Built |
| Furniture deposit | Admin → Charges (`chairTableDepositPaise`), flat and charged once when any furniture is taken, as the 2025 sheet carries it | Built |
| Chair and table amount | Admin → Charges — three rates, because 2025 quoted three: ashram, local welfare, and the vendor pair the bank-details form carries | Built |
| Fine categorisation | Admin → Fine types | Built |
| Access management | Admin → Users, `StallStaffRole` | Built |
| Bays added and removed for a redrawn venue | Admin → Bays (`POST`/`DELETE /config/zones`). A bay holding stalls refuses with a 409 rather than cascading | Built |
| The planning grid's columns | Admin → Planning columns (`PUT /config/plan-categories`), including the sponsor and Adiyogi columns the 2025 sheet carries | Built |
| The season's own settings | Admin → Editions (`PATCH /editions/:id/settings`): name, the two virtual-account prefixes, the stalls-per-request cap | Built |
| Number of stalls, stall numbers | Planning → Apply | Built |
| What one coupon admits | Onboarding → the coupon block (`PUT /onboarding/:id/coupon/capacity`). Eight by default, raised case by case on the code the vendor already holds | Built |

## 14. Types of user

| Requirement | Where | Status |
|---|---|---|
| External vendors / local welfare / ashram stall vendors | Requester types on the account side (`StallRequestType`), never staff roles | Built |
| Admin, Lead, Volunteer | `ROLES` in `@msr/stalls/rbac.ts` | Built |
| — | A fourth role, **Finance**, exists because the finance requirement needs one that is not the Lead | Differs — an addition, not a substitution |

---

## Decisions still open

### Vendor identity

The requirement says "register & login (SSO) using email or phone number".
There is no password anywhere in this module. A submission creates the account,
the receipt email carries a long signed link, and that link is the credential
for every later page. `/stalls/status` closes the gap that left: an email
address or a mobile number gets the link emailed **to the address on the
account**, never to whoever asked.

Two things to decide:

1. **Delivery is email only.** The module has a `Mailer` port and no SMS port,
   so a vendor whose email address is wrong still needs the team. Adding SMS
   delivery is a port and an adapter, nothing structural.
2. **Real SSO for requesters** would mean the host's Isha OIDC. Ashram
   departments have identities there; external vendors do not. Host ADR 0016
   keeps vendors out of the `Person` directory deliberately — reversing that is
   a host decision, not a module one.

### Pooled deposit

The requirement points each deduction at its own deposit. The code holds one
deposit total and takes both deductions from it. The refund is identical unless
one bucket over-runs its own deposit — a stall that loses ₹6,000 of furniture
against a ₹4,000 furniture deposit currently eats into the stall deposit
instead of raising a ₹2,000 shortfall.

Splitting it is a migration (two columns on `StallRefund`), a change to
`computeRefund`, and a change to the Finance screen. It has not been done
because which behaviour the team wants is a policy question, not a coding one.

### A read-only role for electrical and venue prep

Those teams currently need `planning:read`, which also opens Planning and the
stall grid. A `stalls_electrical` role granting only the sheet would be four
lines in `rbac.ts` and a nav entry.

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

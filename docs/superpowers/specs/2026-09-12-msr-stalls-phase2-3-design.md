# MSR Stalls — Phases 2 & 3 (Onboarding, Money, Event Ops) Design

Date: 2026-09-12
Status: Directed by the user ("build the full App"); builds on the approved Phase 1 spec.

## Cross-check against the 13 requirement areas

| # | Requirement (from the PDF) | Where it lands |
|---|---|---|
| 1 | Ashram, Local welfare and Vendor stall registration | Phase 1 — done |
| 2 | Vendor selection (view/shortlist/select, stall number by zone) | Phase 1 — done |
| 3 | Vendor communication — selection confirmation email, templates per type, bulk + individual, attachment, **never sent twice** | **Communication** (Phase 2) |
| 4 | Vendor bank, GST details and contract agreement form, reached from the confirmation email; reminder for pending | **Bank form** by signed link (Phase 2) |
| 5 | Selected-vendor view + payment details email; calculation shown; who was sent, when | **Onboarding / Payment** (Phase 2) |
| 6 | Finance confirms payment when not through the system: reference no, amount, date; reminder for pending | **Finance** (Phase 2) |
| 7 | Vendor staff registration by secure coupon; email after payment with FSSAI + staff link | **Staff coupons** (Phase 3) |
| 8 | Vendor uploads FSSAI certificate | **FSSAI** by signed link (Phase 3) |
| 9 | Share stall layout + electrical details with venue/electrical team, A4-printable | **Electrical & Venue** (Phase 3) |
| 10 | Check-in: name, stall number, staff count, vehicle passes; pending items visible | **Check-in** (Phase 3) |
| 11 | Chairs & tables: see request, mark distributed, add extras + collect money, next-day return, note damage/missing, flag | **Chairs & Tables** (Phase 3) |
| 12 | Refund input to finance: furniture deductions, cleanliness fines, off the deposit | **Refunds** (Phase 3) |
| 13 | Admin: stall amounts, deposits, chair/table rates, fines, access, zones/stall numbers | Phase 1 admin + additions here |

**Planning screen** (the "**" item) — Phase 1. **User types** (external vendor, LW vendor, ashram vendor, admin, volunteer, lead) — Phase 1 RBAC + vendor accounts.

## UI system decision

The web module adopts the **msr-volunteering** UI system, ported verbatim under the module's own scope:

- `apps/web/src/modules/stalls/ui/tokens.css` — the same tokens, scoped to `.msrs` (not `.msrv`) so both modules coexist in the host without collision, following the volunteering header's own reasoning.
- `ui/ui.tsx` — `Card`, `H1`, `Pill`/`Tag`/`TONE`, `Btn`, `Toolbar`, `Search`, `KV`, `Empty`, `Loading`, `ErrorBox`, `toolBtnStyle`, `gridMinWidth`. `STATUS_TONE` carries this module's vocabulary.
- `ui/components/` — `Dialog` (+ `Field`, `inputStyle`), `IconBtn`, `StatTiles`, `RowCard`, `Pager`, `Toast`, `Overlay`, `SearchSelect`.
- `ui/icons.tsx` — `<Icon name=… />` over lucide.
- Inline `style` objects reading `var(--…)`, the display face Outfit for `H1`, Geist for text.

The shadcn/Tailwind primitives from Phase 1 are removed from the module; the shell keeps Tailwind only for the dev sign-in page.

## Data model additions (all `@@schema("stalls")`, `Stall` prefix)

- **`StallEditionLinks`** (1:1 edition) — `staffRegistrationUrl`, `fssaiProcessUrl`, `termsUrl`, `financeEmail`, `bankInstructions` (Isha's NEFT details text for the payment email).
- **`StallChargeConfig`** gains `vendorChairRatePaise` (₹100) and `vendorTableRatePaise` (₹400) — the 2025 bank-details form quotes a *third* table rate for vendors.
- **`Stall`** gains `cluster String?` — the 2025 electrical sheet groups stalls by electrical cluster within a zone.
- **`StallEmailTemplate`** — `editionId`, `key` (`SELECTION_VENDOR | SELECTION_ASHRAM | SELECTION_LOCAL_WELFARE | PAYMENT_DETAILS | BANK_REMINDER | PAYMENT_REMINDER | POST_PAYMENT`), `subject`, `body` with `{{placeholders}}`, `attachmentKey?`.
- **`StallEmailLog`** — `requestId`, `templateKey`, `toEmail`, `subject`, `status` (`SENT | FAILED`), `error?`, `sentAt`, `sentBy`. A selection confirmation is refused when a `SENT` log exists for that request+key.
- **`StallBankDetails`** (1:1 request) — every field on the 2025 form: invoice name, account holder, mobile, address, pincode, bank, branch, account number, IFSC, MICR, cheque/passbook media key, advance-return acknowledgement, PAN + media key, GST number (or NONE) + media key, NEFT agreement, T&C agreement, `submittedAt`. The vendor's electrical/logistics block on the same form writes to the existing `StallRequest` columns.
- **`StallPayment`** (1:1 request) — the computed bill (`stallFeePaise`, `plugPointsFeePaise`, `furnitureFeePaise`, `netPaise`, `gstPercent`, `gstPaise`, `grossPaise`, `stallDepositPaise`, `furnitureDepositPaise`, `depositTotalPaise`, `totalPayablePaise`, `quotedAt`, `quotedBy`, `emailSentAt?`) and the confirmation (`confirmedAt?`, `confirmedBy?`, `creditDate?`, `referenceNo?`, `ecollectCode?`, `remitterName?`, `mode?`, `amountReceivedPaise?`, `notes?`). Mirrors the 2025 finance sheet's columns.
- **`StallStaffCoupon`** (1:1 request) — `code` (unique, e.g. `MSR26-C1-1-K7Q2`), `maxStaff`, `registeredCount`, `issuedAt`, `revokedAt?`.
- **`StallFssai`** (1:1 request) — `mediaKey`, `fileName`, `licenseNumber?`, `validTill?`, `uploadedAt`, `verifiedAt?`, `verifiedBy?`, `rejectedReason?`.
- **`StallCheckIn`** (1:1 request) — `checkedInAt`, `checkedInBy`, `staffPresent`, `passes2wIssued`, `passes4wIssued`, `passesStaffIssued`, `notes?`.
- **`StallFurnitureLedger`** (1:1 request) — ordered (copied), issued, extra, `extraChargePaise`, `cashCollectedPaise`, `issuedAt/By`; returned, missing, damaged, `returnedAt/By`; `flagged`, `notes`.
- **`StallFine`** — `requestId`, `fineTypeId?`, `reason`, `amountPaise`, `leviedAt/By`, `waivedAt/By?`.
- **`StallRefund`** (1:1 request) — `depositTotalPaise`, `furnitureDeductionPaise`, `finesPaise`, `refundablePaise`, `preparedAt/By`, `sentToFinanceAt?`, `paidAt/By?`, `referenceNo?`.

## Stage machine

`NEW → BANK_FORM_SENT` (selection confirmation sent) `→ BANK_FORM_FILLED` (vendor submits) `→ PAYMENT_SENT` (payment email) `→ PAYMENT_CONFIRMED` (finance) `→ FSSAI_PENDING` (food stalls, when the flow enables FSSAI) `→ READY → CHECKED_IN`. Flow toggles skip steps: bank off → selection goes to PAYMENT_SENT path; payment off → straight to FSSAI/READY; FSSAI off or non-food → READY after payment. Ashram requests skip bank and payment entirely (no rent) and go READY on selection.

## Pure logic in `@msr/stalls`

- `billing.ts` — `computeBill(request, charges, rate)`: stall fee = rent × stalls; plug fee = max(0, plugs5a − stalls) × 5A rate + plugs15a × 15A rate (one 5 A point per stall is included); furniture fee = (chairs × chair rate + tables × table rate) × event days, with the rate picked by requester type; GST on net; deposits by type. Every figure is integer paise.
- `refund.ts` — `computeRefund(deposits, ledger, fines, rates)`: deductions for missing/damaged at replacement rates, fines summed, floor at zero.
- `coupon.ts` — `newCouponCode(year, stallNumber)`, unambiguous alphabet.
- `templates.ts` — `renderTemplate(body, vars)` with `{{name}}` placeholders and the list of supported placeholders per key; `DEFAULT_TEMPLATES`.
- `stages.ts` — `nextStage(current, event, flow, isFood, isAshram)` and `stageSteps(flow, …)` for the vendor status page and the onboarding screen.

## Public surface (signed links only)

`GET/POST /public/bank/:token`, `POST /public/bank/:token/upload` (presign), `GET/POST /public/fssai/:token`, `GET /public/staff/:token`. The status page shows the stage steps and offers whichever link is currently open.

## Staff screens (all on the volunteering UI system)

Dashboard · Stall Requests · All Requests · Planning & Zones · **Communication** · **Onboarding** (selected vendors: bank status, payment quote, send payment email, reminders) · **Finance** (pending confirmations, confirm with reference/amount/date; refunds to pay) · **Electrical & Venue** (per-zone/cluster sheet, print) · **Check-in** · **Chairs & Tables** · **Refunds** · Admin (+ templates, links, vendor rates).

## Out of scope, stated

Real SMS; payment gateway; the external Sewadhar registration itself; pass printing.

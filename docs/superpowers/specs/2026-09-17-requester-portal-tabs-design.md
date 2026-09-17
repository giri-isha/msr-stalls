# The requester's portal: one request, in tabs

Date: 2026-09-17
Status: Built

## The problem

The signed-in public side has a nav with two tabs, **Request a Stall** and
**My Requests**, and the second is where a requester actually lives. The first
is an action, not a place, and drawing it as a tab puts the thing you do once
level with the thing you come back for.

Beneath it, `MyRequests` stacks every request as a card, and inside each card
the outstanding steps are a column of chips with their detail hanging under
them — the payment figures, a claim form that unfolds inline, the coupon block.
Eleven things in one flow. On a laptop the whole page sits in a 1060px column
with a third of the screen empty either side.

This is a portal: a requester logs in to see their own request and what it still
needs from them. The page should read like one.

## Decisions

1. **Request a Stall is a button, top right.** A primary button in the header,
   beside the signed-in name. The `Nav` strip goes: with the requests page as
   the portal there is nothing left to tab between. The brand mark links to
   `/stalls/requests` when signed in. Signed out, the header shows neither the
   button nor a name — the rule the shell already follows, so a vendor arriving
   on a bank-form link meets no chrome they have to understand.

2. **The page is fluid.** `WIDTH = 1060` goes. Main runs the width of the
   viewport with 28px gutters on desktop and 14px on a phone. Login, register
   and reset keep their own `maxWidth` and centre themselves; `RequestForm`
   already lays its short answers two-up and simply gets the room.

3. **One request on screen at a time.** A row of pills above the request —
   `Vendor Stall 1 · VEN-2026-0008` — drawn only when the account holds more
   than one. The chosen reference is held in the URL as `?ref=`, so a refresh
   or a forwarded link lands on the same request. With no `?ref`, or one that
   matches nothing, the first request (most recent) is shown.

4. **The request's sections are tabs.** A header band (reference, stall name,
   type and date, allocated stalls when known, status pill) sits over a tab
   strip; the tab body fills the card below. `ui/components/Tabs.tsx` is the
   right tool here — these are sections of one page, state-driven, not routes.
   The nav case it was refused for no longer exists.

5. **Which tabs exist is read off the API, never decided here.** `pending`,
   `payment`, `staff` and `submitted` already say everything the page needs.
   A step tab is present only when the API has said the step is outstanding or
   has sent data for it. Bank details and FSSAI therefore vanish once done —
   the API does not tell "done" from "not applicable" for those, and a green
   tick invented on the page would be the page deciding. Keeping them visible
   as done is a later, separate addition to `@stalls/core` (`stepStates`
   beside `pendingSteps`), not part of this change.

   As built, the Payment tab's green mark means "a reported transfer was
   confirmed" rather than "`payment` present and PAYMENT no longer pending":
   the latter also holds when an admin has switched the payment step off, and
   a green mark there would be the page deciding. The mark reads a fact.

6. **Reporting a transfer is a dialog.** The inline claim form opened in the
   middle of the payment figures and pushed everything below it down. It
   becomes `Dialog`, opened from a button in the Payment tab; on success the
   page re-reads and the claim appears in the list beside the figures.

7. **Both credentials get the same view.** `StatusPage` (the emailed link) and
   `MyRequests` (the session) render one component and differ only in their
   callbacks, as today. `StatusPage` keeps its own H1 because it has no header
   chrome above it.

## The header

```
[■ Stalls / Isha Stall Team]                 [+ Request a Stall]  Vendor Request  [Log Out] [☼]
```

Sticky, full width, `var(--card)` on a `var(--bd)` bottom border, as now. On a
phone the button drops its label and keeps the ticket glyph, `aria-label`led,
the way Log Out already does.

## The request view

```
( Vendor Stall 1 · VEN-2026-0008 )  ( Vendor Stall 2 · VEN-2026-0011 )     ← only if >1

┌──────────────────────────────────────────────────────────────────────┐
│ VEN-2026-0008                                             [Selected] │
│ Vendor Stall 1                                                       │
│ Vendor · submitted 17 Sept 2026 · Stall A-14                         │
├──────────────────────────────────────────────────────────────────────┤
│ Overview   ● Bank details   ● Payment   ● FSSAI   ● Staff   What you submitted │
├──────────────────────────────────────────────────────────────────────┤
│ tab body                                                             │
└──────────────────────────────────────────────────────────────────────┘
```

The dot on a step tab is amber while the step is in `pending`, green on Staff
once `staff.registered > 0` and on Payment once `payment` is present and
`PAYMENT` is no longer pending. No dot on Overview or What you submitted.

The default tab is Overview. The strip scrolls sideways on a phone; the
component already does this.

### Tabs

| Tab | Present when | Body |
|---|---|---|
| Overview | always | The status sentence (`STATUS_COPY`). On a SELECTED request, a **Still to do** list: one row per `pending` step — amber marker, the step's label, and its action (Open the Form for `BANK_FORM` and `FSSAI`; See payment, which switches to the Payment tab; Register staff, which switches to Staff). "Nothing is outstanding on this request." when the list is empty. Before selection the list is not drawn. |
| Bank details | `BANK_FORM` ∈ `pending` | One sentence on what the form collects and why only vendors are asked; **Open the Form**. |
| Payment | `payment` ≠ null, or `PAYMENT` ∈ `pending`, or `paymentClaims` non-empty | Two panels, side by side above 720px, stacked below. **What to pay**: fee incl. GST, refundable deposit, total (bold), fee account and deposit account with copy buttons — or "Please ask the stall team for the account." — and the one-paragraph warning about paying into no other account. Absent when `payment` is null; the panel then says Finance has not quoted yet. **Transfers you have reported**: one row per claim (Checking / Confirmed / Not found, purpose, amount, UTR, date; a rejected claim shows its reason), or "Nothing reported yet." **Report a transfer** / **Report another transfer** opens the dialog. |
| FSSAI | `FSSAI` ∈ `pending` | Same shape as Bank details, for the upload. |
| Staff | `staff` ≠ null | With coupons: a panel of rows — each coupon's code with a copy button (and, where more than one, its own registered/capacity), Registered, "Your coupon(s) admit up to N people" — then a Register Staff button per coupon. Beside it a panel of the explanatory copy (register only who will work the stall; share with your own team only). Without a coupon: the sentence about registration being required and **Get Your Coupon**, which POSTs and reveals the rest. |
| What you submitted | `submitted` non-empty | The read-back grid exactly as today, drawn as a tab body rather than a `<details>`. |

The Overview's "See payment" and "Register staff" rows switch tabs rather than
opening anything, because the figures and the coupon are on this page; the
form-opening rows mint their link on the click, as now.

### Copy that goes

- `FormPicker`'s footer "Already submitted? My Requests has every request…" —
  the header button now does this.
- `MyRequests`' footer "Need another stall? Send in Another Request…" — same.
- The `H1` "My Requests" on `MyRequests` — the header band is the page's title.

## The claim dialog

`PaymentClaim` keeps its fields, its prefill from what is owed, its error
mapping and its toast. The card it drew inline becomes a `Dialog` (width 460,
title "Report a transfer", note "Rent and the deposit are paid separately…").
`ClaimRow` moves to the Payment tab's right-hand panel.

## Files

| File | Change |
|---|---|
| `app/PublicLayout.tsx` | Drop `Nav` and `WIDTH`; add the Request a Stall button; brand links to `/stalls/requests` when signed in; fluid main. |
| `public/MyRequests.tsx` | Drop the H1 and the footer; read `?ref`; render `RequestView`. |
| `public/RequestCards.tsx` → `public/RequestView.tsx` | The switcher, header band, tab strip and the six tab bodies. `Panel`, `Row`, `Copyable` stay. `RequestCards` is removed; both pages call `RequestView`. |
| `public/PaymentClaim.tsx` | Form in a `Dialog`; export `ClaimRow`. |
| `public/FormPicker.tsx` | Drop the footer paragraph. |
| `public/StatusPage.tsx` | Render `RequestView`. |
| `.gitignore` | Add `.superpowers/`. |

No change to `apps/api` or `packages/stalls`.

## Tests

`apps/web`:

- `shell.test.tsx` — signed in, the header has a Request a Stall link and no
  `nav`; signed out, neither the link nor a name.
- `MyRequests.test.tsx` — the existing assertions (status copy, pending chips,
  Open the Form minting the URL, coupon absent/present, payment figures,
  rejected-claim reason, empty state) are kept and reach their content by
  picking the tab. New: two requests draw the switcher and `?ref` picks the
  second; one request draws no switcher; a step in `pending` has a tab and a
  step not in it does not; Report a transfer opens a dialog and a successful
  submit closes it and re-reads.
- `StatusPage.test.tsx` — the same view behind the token; its H1 and expired
  link card unchanged.

## Deliberately unchanged

- The three step forms and staff registration stay on their own routes behind
  their own credentials. The portal opens them; it does not embed them.
- `pendingSteps` remains the only source for what is outstanding.
- The emailed status link keeps working, unchanged.

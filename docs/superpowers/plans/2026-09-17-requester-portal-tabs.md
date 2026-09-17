# Requester Portal Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the signed-in public side into a portal — a header with Request a Stall as a button, a fluid page, one request on screen at a time with its sections as tabs, and a dialog for reporting a transfer.

**Architecture:** `RequestCards.tsx` (one long card per request) is replaced by `RequestView.tsx` (a switcher, a header band, a `Tabs` strip and one body per tab), with each tab body in its own file. Which tabs exist is read off the request the API sent — `pending`, `payment`, `paymentClaims`, `staff`, `submitted` — and the page decides nothing about what is outstanding. `MyRequests` (session) and `StatusPage` (emailed link) both render `RequestView` and differ only in the callbacks they pass. The shell drops its nav and its 1060px column.

**Tech Stack:** React 19, react-router 8, TypeScript, Vitest + Testing Library + user-event, Biome. Design system in `apps/web/src/modules/stalls/ui`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-17-requester-portal-tabs-design.md`.
- No change to `apps/api` or `packages/stalls`.
- `pendingSteps` (via `request.pending`) is the only source for what is outstanding. Never invent a chore or a tick on the page.
- "Staff" means the vendor's own team; never "backoffice" in requester-facing copy.
- Buttons: `<Icon/>` then label, no literal space between (the `Btn` gap does the spacing). Labels Title Case; prose sentence case.
- Icon names must exist in `ui/icons.tsx` REGISTRY. Used here: `ticket`, `list-view`, `clipboard-list`, `clock`, `circle-check`, `chevron-right`, `copy`, `plus`, `send`, `users`, `map-pin`, `rupee`, `file-text`, `shield`, `layout-grid`, `info`, `log-out`, `sun`, `moon`.
- Comment style: files open with a `/** … */` block saying what and why; ⚠️ marks a rule, 🔴 marks a rule learned from a failure. Match the density of the surrounding code.
- Every task ends with `npm run typecheck --workspace=apps/web` and the named tests passing, and a commit. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Work on branch `feat/requester-portal-tabs`. Do not stage `package-lock.json` (an unrelated local change).
- All paths below are relative to the repo root unless prefixed with `web/`, which means `apps/web/src/modules/stalls/`.

---

## File structure

| File | Responsibility |
|---|---|
| `web/ui/components/Tabs.tsx` | Gains an optional `mark` on a tab: a small amber or green dot after the label. |
| `web/public/portal-ui.tsx` | **New.** `Panel`, `PanelTitle`, `Row`, `Copyable` — the plates and rows every tab body is built from. Moved out of `RequestCards.tsx`. |
| `web/public/PaymentClaim.tsx` | `PaymentClaimDialog` (the form in a `Dialog`) and `ClaimRow` (one reported transfer). |
| `web/public/PaymentTab.tsx` | **New.** What to pay, and transfers reported. Opens the dialog. |
| `web/public/StaffTab.tsx` | **New.** Coupon(s), counts, Register Staff, Get Your Coupon. |
| `web/public/SubmittedTab.tsx` | **New.** The read-back grid. |
| `web/public/RequestView.tsx` | **New.** `portalTabs()`, the switcher, the header band, the tab strip, the Overview and the Bank/FSSAI step bodies. |
| `web/public/RequestCards.tsx` | **Deleted** in Task 7. |
| `web/public/MyRequests.tsx` | Renders `RequestView`; loses its H1 and footer. |
| `web/public/StatusPage.tsx` | Renders `RequestView`. |
| `web/public/FormPicker.tsx` | Loses its "Already submitted?" footer. |
| `apps/web/src/app/PublicLayout.tsx` | Fluid; Request a Stall button; no nav. |

---

### Task 1: A tab can carry a mark

**Files:**
- Modify: `web/ui/components/Tabs.tsx`
- Test: `web/ui/components/Tabs.test.tsx` (new)

**Interfaces:**
- Produces: `TabDef.mark?: 'warn' | 'ok'` — draws a 6px dot after the label in `var(--warn)` / `var(--ok)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/modules/stalls/ui/components/Tabs.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Tabs } from './Tabs';

describe('Tabs', () => {
  test('a tab carrying a mark draws it, and one without does not', () => {
    render(
      <Tabs
        label='Sections'
        active='a'
        onPick={() => {}}
        tabs={[
          { key: 'a', label: 'Overview' },
          { key: 'b', label: 'Payment', mark: 'warn' },
          { key: 'c', label: 'Staff', mark: 'ok' },
        ]}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Overview' }).querySelector('[data-mark]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Payment' }).querySelector('[data-mark="warn"]')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Staff' }).querySelector('[data-mark="ok"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/stalls/ui/components/Tabs.test.tsx`
Expected: FAIL — TypeScript error on `mark` or the `[data-mark]` query returning null for Payment.

- [ ] **Step 3: Add `mark` to `TabDef` and draw it**

In `apps/web/src/modules/stalls/ui/components/Tabs.tsx`, change the type:

```ts
export type TabDef = {
  key: string;
  label: string;
  /** Icon name from `ui/icons`. Omitted on strips whose labels carry enough. */
  glyph?: string;
  /** A dot after the label: `warn` for a section with something outstanding
   *  in it, `ok` for one that is settled. The strip then reads as a checklist
   *  before any tab is opened. ⚠️ Decoration only — the section's own body
   *  says the same thing in words, so nothing is lost on a screen reader. */
  mark?: 'warn' | 'ok';
};
```

And inside the button, after `{t.label}`:

```tsx
            {t.label}
            {t.mark && (
              <span
                data-mark={t.mark}
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flex: 'none',
                  background: t.mark === 'warn' ? 'var(--warn)' : 'var(--ok)',
                }}
              />
            )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run src/modules/stalls/ui/components/Tabs.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/stalls/ui/components/Tabs.tsx apps/web/src/modules/stalls/ui/components/Tabs.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): a tab can carry a mark

A small amber or green dot after the label, so a strip of sections reads as
a checklist before any of them is opened.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The plates and rows move to their own file

**Files:**
- Create: `web/public/portal-ui.tsx`
- Modify: `web/public/RequestCards.tsx` (import from the new file; delete the local copies)

**Interfaces:**
- Produces:
  - `Panel({ children }: { children: ReactNode })` — the muted plate a tab body's block sits on. Full width of its grid cell.
  - `PanelTitle({ icon, children }: { icon?: string; children: ReactNode })` — 12px bold muted heading with an optional glyph, for the top of a `Panel`.
  - `Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean })` — label 132px + value; stacked on a phone.
  - `Copyable({ value, label }: { value: string; label: string })` — mono value with a copy button labelled `Copy ${label.toLowerCase()}`.

- [ ] **Step 1: Create `portal-ui.tsx`**

Create `apps/web/src/modules/stalls/public/portal-ui.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Icon, useIsMobile, useToast } from '../ui';

/**
 * The pieces every tab of the requester's portal is built from — one plate,
 * one heading, one label-and-value row, one copyable value — so the payment
 * figures, the coupon and the read-back grid read as one thing rather than as
 * panels that grew separately.
 */

/** The plate a tab body's block sits on. Fills its grid cell: the tab bodies
 *  lay their panels out two-up above 720px and the grid does the capping. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        justifyItems: 'start',
        alignContent: 'start',
        width: '100%',
        padding: '14px 16px',
        borderRadius: 'var(--r3)',
        background: 'var(--mut)',
        border: '1px solid var(--bd)',
      }}
    >
      {children}
    </div>
  );
}

/** A panel's heading. Muted and small, so the figures under it are what a
 *  reader's eye lands on. */
export function PanelTitle({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--mfg)',
        marginBottom: 4,
      }}
    >
      {icon && <Icon name={icon} size={13} color='var(--pri)' />}
      {children}
    </div>
  );
}

/** A label and its value.
 *
 *  ⚠️ STACKED on a phone, side by side above it. Beside each other the label
 *  takes a fixed 132px rail, which is what lines the rows up into a column a
 *  reader can scan — and on a 390px screen leaves too little for a coupon code,
 *  so the value wrapped under a label that was still vertically centred against
 *  it. Label over value is the same information in the space there is. */
export function Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  const mobile = useIsMobile();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        gap: mobile ? 2 : 10,
        width: '100%',
        fontSize: 12.5,
        alignItems: mobile ? 'stretch' : 'center',
      }}
    >
      <div style={{ width: mobile ? undefined : 132, flex: 'none', color: 'var(--mfg)' }}>{k}</div>
      <div style={{ flex: 1, minWidth: 0, fontWeight: strong ? 700 : 600 }}>{v}</div>
    </div>
  );
}

/**
 * A value a requester has to get somewhere else exactly right — an account
 * number they will type into their bank, a coupon they will forward to their
 * team. Both are transcription errors waiting to happen, and a wrong account
 * number means money that has to be traced.
 *
 * ⚠️ The clipboard is not always there — an insecure origin, an older browser,
 * a denied permission — so a failure falls back to telling them to copy it by
 * hand rather than silently doing nothing. The value is on screen either way;
 * the button is a convenience, never the only way to get at it.
 */
export function Copyable({ value, label }: { value: string; label: string }) {
  const toast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.ok(`${label} copied.`);
    } catch {
      toast.fail(
        new Error(`Could not copy. Please select the ${label.toLowerCase()} and copy it.`),
      );
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{value}</span>
      <button
        type='button'
        onClick={() => void copy()}
        aria-label={`Copy ${label.toLowerCase()}`}
        title={`Copy ${label.toLowerCase()}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: 4,
          borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)',
          background: 'var(--bg)',
          color: 'var(--mfg)',
          cursor: 'pointer',
        }}
      >
        <Icon name='copy' size={12} />
      </button>
    </span>
  );
}
```

- [ ] **Step 2: Point `RequestCards.tsx` at it**

In `apps/web/src/modules/stalls/public/RequestCards.tsx`: delete the local `function Panel`, `function Row` and `function Copyable` definitions (each with its doc comment), and add to the imports:

```ts
import { Copyable, Panel, Row } from './portal-ui';
```

`RequestCards.tsx` is deleted in Task 7; this keeps the existing tests green meanwhile.

- [ ] **Step 3: Typecheck and run the existing portal tests**

Run: `npm run typecheck --workspace=apps/web && cd apps/web && npx vitest run src/modules/stalls/public/MyRequests.test.tsx src/modules/stalls/public/StatusPage.test.tsx`
Expected: typecheck clean; 15 + 9 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/stalls/public/portal-ui.tsx apps/web/src/modules/stalls/public/RequestCards.tsx
git commit -m "$(cat <<'EOF'
refactor(stalls): the portal's plates and rows live in one file

Panel, Row and Copyable move out of the card so the tab bodies that replace
it can share them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reporting a transfer is a dialog

**Files:**
- Modify: `web/public/PaymentClaim.tsx`
- Modify: `web/public/RequestCards.tsx` (temporary shim so it still compiles)

**Interfaces:**
- Produces:
  - `PaymentClaimDialog({ reference, payment, onClose, onSubmitted }: { reference: string; payment: PublicPaymentDue | null; onClose(): void; onSubmitted(): void })` — a `Dialog` titled "Report a transfer". Calls `onSubmitted()` then `onClose()` on success.
  - `ClaimRow({ claim }: { claim: PaymentClaimView })` — exported.
- The old default export `PaymentClaim` is removed.

- [ ] **Step 1: Rewrite `PaymentClaim.tsx`**

Replace the whole of `apps/web/src/modules/stalls/public/PaymentClaim.tsx` with:

```tsx
import type { PaymentClaimView, PublicPaymentDue } from '@stalls/core';
import { formatInr } from '@stalls/core';
import { useState } from 'react';
import { submitPaymentClaim } from '../api';
import { fieldErrorsFrom } from '../api-client';
import { formatDate } from '../hooks';
import { Btn, Dialog, FormField, Icon, Input, Select, Tag, Textarea, useToast } from '../ui';

/**
 * Where a requester tells us what they transferred.
 *
 * 🔴 This replaces a mailbox. The 2025 letter ended "please send transfer
 * details on E-mail IDs finance.support@… once you make the payment", and
 * finance matched those mails against the bank statement by hand. A claim
 * lands as a row in a queue instead.
 *
 * ⚠️ A CLAIM, not a receipt. Submitting moves nothing: the stage advances when
 * finance verifies it and the payment record is written. Saying otherwise on
 * this page would tell a vendor they were done when nobody had looked.
 *
 * A DIALOG, where it used to unfold inline under the payment figures and push
 * everything below them down the page. The figures stay where they were while
 * the form is open, which matters: the amount owed is what the vendor is
 * copying from.
 */
export function PaymentClaimDialog({
  reference,
  payment,
  onClose,
  onSubmitted,
}: {
  reference: string;
  payment: PublicPaymentDue | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const [purpose, setPurpose] = useState<'RENT' | 'DEPOSIT'>('RENT');
  const [referenceNo, setReferenceNo] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [remitterName, setRemitterName] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // ⚠️ Prefilled from what is owed for the purpose chosen, because the figure
  // is right there on the page behind and retyping it is where a digit gets
  // dropped. Still editable: a vendor who paid a different amount has to be
  // able to say so, and that gap is exactly what finance needs to see.
  const owed = payment ? (purpose === 'RENT' ? payment.feePaise : payment.depositPaise) : null;

  const submit = async () => {
    setErrors({});
    setBusy(true);
    try {
      await submitPaymentClaim({
        reference,
        purpose,
        referenceNo: referenceNo.trim(),
        // Rupees on screen, paise on the wire — the whole module counts in
        // paise so a rounding error cannot appear between two screens.
        amountPaise: Math.round(Number(amount) * 100),
        paidOn,
        remitterName: remitterName.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.ok('Thank you. Finance will confirm it against the bank statement.');
      onSubmitted();
      onClose();
    } catch (e) {
      setErrors(fieldErrorsFrom(e));
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = referenceNo.trim() !== '' && amount.trim() !== '' && paidOn !== '';

  return (
    <Dialog
      title='Report a transfer'
      note='Rent and the deposit are paid separately, so please report them separately. We check what you tell us against the bank statement before it counts as paid.'
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={submit} disabled={busy || !ready}>
            <Icon name='send' size={14} />
            {busy ? 'Sending…' : 'Report It'}
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='claim-purpose' label='Which payment' required>
          <Select
            id='claim-purpose'
            value={purpose}
            onChange={(v) => setPurpose(v as 'RENT' | 'DEPOSIT')}
          >
            <option value='RENT'>Rent</option>
            <option value='DEPOSIT'>Refundable deposit</option>
          </Select>
        </FormField>

        <FormField
          id='claim-reference'
          label='UTR or reference number'
          help='The reference your bank gave the transfer. This is what we match against.'
          required
          error={errors.referenceNo}
        >
          <Input
            id='claim-reference'
            value={referenceNo}
            invalid={!!errors.referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
          />
        </FormField>

        <FormField
          id='claim-amount'
          label='Amount transferred'
          help={owed !== null ? `${formatInr(owed)} is due for this.` : undefined}
          required
          error={errors.amountPaise}
        >
          <Input
            id='claim-amount'
            type='number'
            inputMode='decimal'
            min={1}
            placeholder={owed !== null ? String(Math.round(owed / 100)) : undefined}
            value={amount}
            invalid={!!errors.amountPaise}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>

        <FormField
          id='claim-paid-on'
          label='Date of transfer'
          help='The date it shows on your statement.'
          required
          error={errors.paidOn}
        >
          <Input
            id='claim-paid-on'
            type='date'
            value={paidOn}
            invalid={!!errors.paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </FormField>

        <FormField
          id='claim-remitter'
          label='Name on the account you paid from'
          help='Optional, and it helps us find the credit if the reference does not match.'
        >
          <Input
            id='claim-remitter'
            value={remitterName}
            onChange={(e) => setRemitterName(e.target.value)}
          />
        </FormField>

        <FormField id='claim-note' label='Anything we should know'>
          <Textarea
            id='claim-note'
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

/**
 * One reported transfer, and where it stands.
 *
 * 🔴 A REJECTED claim shows its reason. That reason is the only thing telling
 * the requester what to correct, and a rejection they cannot see returns them
 * to the mailbox this replaced.
 */
export function ClaimRow({ claim }: { claim: PaymentClaimView }) {
  const tone = claim.status === 'VERIFIED' ? 'ok' : claim.status === 'REJECTED' ? 'des' : 'warn';
  const label =
    claim.status === 'VERIFIED'
      ? 'Confirmed'
      : claim.status === 'REJECTED'
        ? 'Not found'
        : 'Checking';

  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        width: '100%',
        padding: '9px 12px',
        borderRadius: 'var(--r2)',
        border: '1px solid var(--line)',
        background: 'var(--card)',
        fontSize: 12.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag tone={tone} size='sm'>
          {label}
        </Tag>
        <span style={{ fontWeight: 600 }}>
          {claim.purpose === 'RENT' ? 'Rent' : 'Deposit'} · {formatInr(claim.amountPaise)}
        </span>
        <span style={{ color: 'var(--mfg)' }}>
          {claim.referenceNo} · paid {formatDate(claim.paidOn)}
        </span>
      </div>
      {claim.status === 'REJECTED' && claim.rejectReason && (
        <div style={{ color: 'var(--des-fg)', lineHeight: 1.55 }}>
          {claim.rejectReason} Please check the details and report it again.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Shim `RequestCards.tsx` so it compiles until Task 7**

In `apps/web/src/modules/stalls/public/RequestCards.tsx`, change the import `import { PaymentClaim } from './PaymentClaim';` to `import { ClaimRow, PaymentClaimDialog } from './PaymentClaim';`, and inside `Step` replace

```tsx
      {step.step === 'PAYMENT' && (
        <PaymentClaim
          reference={reference}
          payment={payment}
          claims={claims}
          onSubmitted={onClaimed}
        />
      )}
```

with

```tsx
      {step.step === 'PAYMENT' && (
        <ClaimShim reference={reference} payment={payment} claims={claims} onClaimed={onClaimed} />
      )}
```

and add at the bottom of the file:

```tsx
/** Holds the old card together until `RequestView` replaces it. */
function ClaimShim({
  reference,
  payment,
  claims,
  onClaimed,
}: {
  reference: string;
  payment: PublicPaymentDue | null;
  claims: PaymentClaimView[];
  onClaimed(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      {claims.map((c) => (
        <ClaimRow key={c.id} claim={c} />
      ))}
      <Btn onClick={() => setOpen(true)}>
        <Icon name='plus' size={14} />
        {claims.length > 0 ? 'Report Another Transfer' : 'Report a Transfer'}
      </Btn>
      {open && (
        <PaymentClaimDialog
          reference={reference}
          payment={payment}
          onClose={() => setOpen(false)}
          onSubmitted={onClaimed}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and run the portal tests**

Run: `npm run typecheck --workspace=apps/web && cd apps/web && npx vitest run src/modules/stalls/public/`
Expected: clean; all public tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/stalls/public/PaymentClaim.tsx apps/web/src/modules/stalls/public/RequestCards.tsx
git commit -m "$(cat <<'EOF'
feat(stalls): reporting a transfer is a dialog

The claim form opened inline under the payment figures and pushed the rest
of the card down. It opens over the page now, with the figures it is copied
from still in view behind it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The Payment tab

**Files:**
- Create: `web/public/PaymentTab.tsx`

**Interfaces:**
- Consumes: `Panel`, `PanelTitle`, `Row`, `Copyable` (Task 2); `PaymentClaimDialog`, `ClaimRow` (Task 3).
- Produces: `PaymentTab({ request, reload }: { request: PublicRequestStatus; reload(): void })`.

- [ ] **Step 1: Create `PaymentTab.tsx`**

Create `apps/web/src/modules/stalls/public/PaymentTab.tsx`:

```tsx
import type { PublicPaymentDue, PublicRequestStatus } from '@stalls/core';
import { formatInr } from '@stalls/core';
import { useState } from 'react';
import { Btn, Icon, Tag, useIsMobile } from '../ui';
import { ClaimRow, PaymentClaimDialog } from './PaymentClaim';
import { Copyable, Panel, PanelTitle, Row } from './portal-ui';

/**
 * What is owed and where to send it — the payment-details letter, on the page
 * — beside what the requester has told us they transferred.
 *
 * 🔴 ONE fee, and it is what is OWED. Where the team agreed a concession, that
 * is the figure here and it is the figure `paymentConfirmed` settles against,
 * so a trader who pays what this panel asks for actually clears the step. The
 * rate they were quoted before the concession is not shown beside it.
 *
 * ⚠️ The figures are absent until Finance has quoted. "Payment pending" with
 * no figure is honest; a number invented on this page would not be. Reporting
 * a transfer is offered even then: a requester who paid against a letter can
 * still tell us, and finance would rather have the reference than a mailbox.
 *
 * ⚠️ An account number can be null — an edition with no virtual-account prefix,
 * or a contact that is not a mobile. The row says to ask rather than printing a
 * blank where an account number should be, because a vendor transferring to a
 * half-remembered account is the expensive failure here.
 */
export function PaymentTab({ request, reload }: { request: PublicRequestStatus; reload(): void }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const payment = request.payment ?? null;
  // ⚠️ Defaulted. An API that has not been redeployed yet answers without
  // this field, and a missing list must not take the whole page down.
  const claims = request.paymentClaims ?? [];
  const pending = request.pending.find((p) => p.step === 'PAYMENT');

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {pending && (
        <div>
          <Tag tone='warn' size='sm'>
            <Icon name='clock' size={12} /> {pending.label}
          </Tag>
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <Panel>
          <PanelTitle icon='rupee'>What to pay</PanelTitle>
          {payment ? (
            <Due payment={payment} />
          ) : (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
              Finance has not sent the figures yet. The amount and the accounts to pay into will
              appear here once they have. If you have already paid against a letter, you can still
              report the transfer.
            </p>
          )}
        </Panel>
        <Panel>
          <PanelTitle icon='file-text'>Transfers you have reported</PanelTitle>
          {claims.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
              Nothing reported yet. Once you have paid, tell us the UTR so Finance can match it
              against the bank statement.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 6, width: '100%' }}>
              {claims.map((c) => (
                <ClaimRow key={c.id} claim={c} />
              ))}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <Btn kind='primary' onClick={() => setOpen(true)}>
              <Icon name='plus' size={14} />
              {claims.length > 0 ? 'Report Another Transfer' : 'Report a Transfer'}
            </Btn>
          </div>
        </Panel>
      </div>
      {open && (
        <PaymentClaimDialog
          reference={request.reference}
          payment={payment}
          onClose={() => setOpen(false)}
          // ⚠️ Re-read, because the claim should appear in the list beside the
          // figures — a page that did not would leave the requester unsure
          // whether it had been received, which is the doubt the mailbox made.
          onSubmitted={reload}
        />
      )}
    </div>
  );
}

function Due({ payment }: { payment: PublicPaymentDue }) {
  return (
    <>
      <Row k='Fee, including GST' v={formatInr(payment.feePaise)} />
      <Row k='Refundable deposit' v={formatInr(payment.depositPaise)} />
      <Row k='Total to transfer' v={formatInr(payment.totalPaise)} strong />
      <AccountRow k='Fee, to account' account={payment.virtualAccountRent} />
      <AccountRow k='Deposit, to account' account={payment.virtualAccountDeposit} />
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--mfg)', lineHeight: 1.6 }}>
        These accounts are issued to you alone, which is how we identify your payment. Please do not
        pay into any other account, and please keep the reference number.
      </p>
    </>
  );
}

function AccountRow({ k, account }: { k: string; account: string | null }) {
  if (!account) {
    return (
      <Row
        k={k}
        v={<span style={{ color: 'var(--mfg)' }}>Please ask the stall team for the account.</span>}
      />
    );
  }
  return <Row k={k} v={<Copyable value={account} label='Account number' />} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=apps/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/modules/stalls/public/PaymentTab.tsx
git commit -m "$(cat <<'EOF'
feat(stalls): the portal's Payment tab

What to pay beside what has been reported, on two plates.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The Staff and Submitted tabs

**Files:**
- Create: `web/public/StaffTab.tsx`
- Create: `web/public/SubmittedTab.tsx`

**Interfaces:**
- Produces:
  - `StaffTab({ request, getCoupon }: { request: PublicRequestStatus; getCoupon(reference: string): Promise<{ code: string }> })` — renders nothing if `request.staff` is null.
  - `SubmittedTab({ sections }: { sections: SubmittedSection[] })`.

- [ ] **Step 1: Create `StaffTab.tsx`**

Create `apps/web/src/modules/stalls/public/StaffTab.tsx`:

```tsx
import type { CouponSummary, PublicRequestStatus } from '@stalls/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { Btn, Icon, Tag, useIsMobile, useToast } from '../ui';
import { Copyable, Panel, PanelTitle, Row } from './portal-ui';

/**
 * The vendor's own team, and the coupon they register against.
 *
 * ⚠️ "STAFF" throughout, never "backoffice". The backoffice is the stall TEAM —
 * the people running the event — and "staff" is the vendor's own, the people
 * who will stand at their stall. One word used for both is how a privilege
 * named for one gets read as the other. The rule is in the README;
 * `STEP_LABEL` in `@stalls/core` carries the other half of it.
 *
 * 🔴 `pendingSteps` emits STAFF_REGISTRATION only once a coupon has been
 * ISSUED, and a coupon was issued only by a backoffice member pressing a
 * button or sending the FSSAI-and-staff letter. A vendor who never received
 * that letter saw no chip, had no code, and could not register the people who
 * would be standing at their stall. So: no coupon is not a dead end, it is a
 * button.
 *
 * ⚠️ The warn tag follows `pending`, never this tab's own opinion. Nothing
 * here says a chore is outstanding unless the API did.
 *
 * ⚠️ The coupon is a credential — anyone holding it can add a person to this
 * stall's roster. Showing it to the account holder is exactly right: they are
 * the person who forwards it to their own team.
 */
export function StaffTab({
  request,
  getCoupon,
}: {
  request: PublicRequestStatus;
  getCoupon(reference: string): Promise<{ code: string }>;
}) {
  const mobile = useIsMobile();
  const toast = useToast();
  const [issued, setIssued] = useState<CouponSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const staff = request.staff;
  if (!staff) return null;

  // 🔴 A LIST. The team can issue a stall more than one live code — a caterer's
  // beside the vendor's own — and the vendor sees every one of them, because
  // every registration made on any of them lands on THEIR roster.
  const coupons = staff.coupons.length > 0 ? staff.coupons : issued;
  const outstanding = request.pending.find((p) => p.step === 'STAFF_REGISTRATION');

  const issue = async () => {
    setBusy(true);
    try {
      const minted = await getCoupon(request.reference);
      // Held locally rather than refetched: the request list is loaded by the
      // page above and this is the one fact on it that just changed.
      setIssued([{ id: minted.code, code: minted.code, capacity: 0, registered: 0 }]);
      toast.ok('Your coupon is ready.');
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {outstanding && (
        <div>
          <Tag tone='warn' size='sm'>
            <Icon name='clock' size={12} /> {outstanding.label}
          </Tag>
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {coupons.length > 0 ? (
          <Panel>
            <PanelTitle icon='users'>
              {coupons.length === 1 ? 'Your coupon' : 'Your coupons'}
            </PanelTitle>
            {coupons.map((c) => (
              <Coupon key={c.id} coupon={c} sole={coupons.length === 1} />
            ))}
            <Row k='Registered' v={`${staff.registered}`} />
            {/* ⚠️ "N of 8" read as a quota — which is what had a vendor believing
                they still owed the stall team five more people. The cap is a
                ceiling the gate enforces, and the backoffice words it this way. */}
            {staff.capacity > 0 && (
              <Row
                k={coupons.length === 1 ? 'Your coupon admits' : 'Your coupons admit'}
                v={`up to ${staff.capacity} ${staff.capacity === 1 ? 'person' : 'people'}`}
              />
            )}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 8,
                paddingTop: 10,
                width: '100%',
                borderTop: '1px solid var(--bd)',
              }}
            >
              {coupons.map((c) => (
                // An in-app route, so a router push — the coupon page is the
                // same application and a full reload would throw away the
                // session it is already holding.
                //
                // ⚠️ Each code gets its OWN button, named by the code once there
                // is more than one: the vendor is forwarding one to their
                // kitchen team and the other to a caterer.
                <Link
                  key={c.id}
                  to={`/stalls/staff/${encodeURIComponent(c.code)}`}
                  style={{ color: 'inherit' }}
                >
                  <Btn kind='primary'>
                    Register Staff
                    {coupons.length > 1 && ` · ${c.code}`}
                    <Icon name='chevron-right' size={14} />
                  </Btn>
                </Link>
              ))}
            </div>
          </Panel>
        ) : (
          <Panel>
            <PanelTitle icon='users'>Your coupon</PanelTitle>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>
              Everyone working on your stall has to be registered before they can be given a pass.
              Your coupon is the key they register with.
            </p>
            <div style={{ marginTop: 4 }}>
              <Btn kind='primary' onClick={() => void issue()} disabled={busy}>
                {busy ? 'Getting your coupon…' : 'Get Your Coupon'}
                <Icon name='chevron-right' size={14} />
              </Btn>
            </div>
          </Panel>
        )}
        <Panel>
          <PanelTitle icon='info'>How it works</PanelTitle>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            Forward the coupon to the people who will work on your stall; each of them registers
            themselves with it. Register only those who will actually be there — there is no need
            to use up the whole allowance. Share it with your own team only: everyone who registers
            with it is recorded against your stall.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** One coupon, as two rows: the code to forward, and — where a stall holds
 *  more than one — how far that particular code has got. */
function Coupon({ coupon, sole }: { coupon: CouponSummary; sole: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'start', width: '100%' }}>
      <Row k='Coupon' v={<Copyable value={coupon.code} label='Coupon' />} />
      {!sole && coupon.capacity > 0 && (
        <Row k='On this code' v={`${coupon.registered} registered, up to ${coupon.capacity}`} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `SubmittedTab.tsx`**

Create `apps/web/src/modules/stalls/public/SubmittedTab.tsx`:

```tsx
import type { SubmittedSection } from '@stalls/core';
import { Icon } from '../ui';

/**
 * What the requester themselves filled in, read back to them.
 *
 * 🔴 This is the answer to "what did I put on the form?", which the portal
 * could not answer at all. A vendor asked in October how many 15 A points they
 * had said they needed had one place to look — a form they no longer had — and
 * the stall team took the call. The sections, their labels and which answers
 * are dropped for being unanswered are all decided in `submittedSections`; this
 * only draws them.
 *
 * A TAB, where it was a closed `<details>` at the foot of the card. The reason
 * it was closed still holds — the page's job on arrival is what has been
 * decided and what is outstanding — and a tab that is not the default keeps it
 * out of the way just as well, without a second disclosure pattern on a page
 * that already has one.
 */
export function SubmittedTab({ sections }: { sections: SubmittedSection[] }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {sections.map((section) => (
        <div key={section.title}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--mfg)',
              marginBottom: 9,
            }}
          >
            <Icon name={section.glyph} size={13} color='var(--pri)' />
            {section.title}
          </div>
          {/* ⚠️ `auto-fill`, not `auto-fit`: `auto-fit` collapses the tracks
              no cell landed in, so a block of two answers would stretch across
              the full width while the block above it kept a narrower column,
              and the two would read as different grids. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))',
              gap: '12px 18px',
            }}
          >
            {section.facts.map((f) => (
              <div key={f.label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginBottom: 2 }}>
                  {f.label}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=apps/web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/stalls/public/StaffTab.tsx apps/web/src/modules/stalls/public/SubmittedTab.tsx
git commit -m "$(cat <<'EOF'
feat(stalls): the portal's Staff and What-you-submitted tabs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `RequestView` — switcher, band, strip, Overview, step tabs

**Files:**
- Create: `web/public/RequestView.tsx`

**Interfaces:**
- Consumes: `Tabs`, `TabDef` with `mark` (Task 1); `PaymentTab` (Task 4); `StaffTab`, `SubmittedTab` (Task 5); `Panel`, `PanelTitle` (Task 2).
- Produces:
  - `RequestViewProps { requests: PublicRequestStatus[]; openStep(reference: string, step: 'BANK_FORM' | 'FSSAI'): Promise<{ url: string }>; getCoupon(reference: string): Promise<{ code: string }>; reload(): void }`
  - `RequestView(props: RequestViewProps)` — reads and writes `?ref=` itself via `useSearchParams`.
  - `type PortalTab = 'overview' | 'bank' | 'payment' | 'fssai' | 'staff' | 'submitted'`
  - `portalTabs(r: PublicRequestStatus): Array<TabDef & { key: PortalTab }>`

- [ ] **Step 1: Create `RequestView.tsx`**

Create `apps/web/src/modules/stalls/public/RequestView.tsx`:

```tsx
import { type PendingStep, type PublicRequestStatus, isSelfServe } from '@stalls/core';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { formatDate } from '../hooks';
import { Btn, Card, Icon, Tag, useIsMobile, useToast } from '../ui';
import { Tabs, type TabDef } from '../ui/components/Tabs';
import { PaymentTab } from './PaymentTab';
import { StaffTab } from './StaffTab';
import { SubmittedTab } from './SubmittedTab';
import { Panel, PanelTitle } from './portal-ui';

/**
 * A requester's own request, drawn the same way whichever credential got them
 * here — the signed link in the receipt email, or the session cookie of
 * somebody logged in.
 *
 * ⚠️ The two pages differ ONLY in their callbacks: one names the request
 * against a token in the URL, the other against the cookie. Everything a
 * requester reads — what the status means, what is outstanding, which step has
 * a button — is here once. When each page drew its own, that was how a vendor
 * could be told they were all set on one screen and be stopped at the counter.
 *
 * ⚠️ Nothing here decides what is outstanding. `pending` arrives from the API,
 * out of the same `pendingSteps` the Onboarding table and the check-in counter
 * read. What this file decides is only which TAB a thing sits in — and a tab
 * exists only when the API sent something for it.
 *
 * 🔴 ONE request at a time, in TABS, where this was every request as a card
 * and every step as a chip with its detail hanging under it — eleven things
 * in one flow with nothing but vertical gaps saying which belonged to which.
 * The request is the page now: a header band names it, a strip of sections
 * runs under it, and each section has the room to lay its figures out.
 */
export interface RequestViewProps {
  requests: PublicRequestStatus[];
  /** Mints the link for one self-serve step. Called on the CLICK — see below. */
  openStep(reference: string, step: 'BANK_FORM' | 'FSSAI'): Promise<{ url: string }>;
  /** Issues the staff coupon, or returns the one already issued. Idempotent. */
  getCoupon(reference: string): Promise<{ code: string }>;
  /** Re-reads the requests, after something on this page changed them. */
  reload(): void;
}

export type PortalTab = 'overview' | 'bank' | 'payment' | 'fssai' | 'staff' | 'submitted';

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Received. The stall team will review it.',
  SHORTLISTED: 'Under consideration.',
  // 🔴 This used to end "Further instructions will follow by email", which was
  // both the plan and the problem: it pointed at an inbox as the only way
  // forward. What happens next is the list underneath, which they can act on.
  SELECTED: 'Selected. Anything still outstanding is listed below.',
  BACKUP: 'On the backup list — you will be contacted if a stall frees up.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

/**
 * Which tabs a request has, read off what the API sent.
 *
 * ⚠️ A step tab is present only while the API says the step is outstanding, or
 * has sent data for it. Bank details and FSSAI therefore vanish once done —
 * the API does not tell "done" from "not applicable" for those, and a green
 * tick invented here would be this page deciding.
 *
 * The marks are facts, not opinions: amber is "in `pending`"; green on Staff
 * is "somebody is registered", green on Payment is "a transfer was confirmed".
 */
export function portalTabs(r: PublicRequestStatus): Array<TabDef & { key: PortalTab }> {
  const pending = new Set(r.pending.map((p) => p.step));
  const claims = r.paymentClaims ?? [];
  const tabs: Array<TabDef & { key: PortalTab }> = [
    { key: 'overview', label: 'Overview', glyph: 'layout-grid' },
  ];
  if (pending.has('BANK_FORM')) {
    tabs.push({ key: 'bank', label: 'Bank Details', glyph: 'file-text', mark: 'warn' });
  }
  if (r.payment || pending.has('PAYMENT') || claims.length > 0) {
    tabs.push({
      key: 'payment',
      label: 'Payment',
      glyph: 'rupee',
      mark: pending.has('PAYMENT')
        ? 'warn'
        : claims.some((c) => c.status === 'VERIFIED')
          ? 'ok'
          : undefined,
    });
  }
  if (pending.has('FSSAI')) {
    tabs.push({ key: 'fssai', label: 'FSSAI', glyph: 'shield', mark: 'warn' });
  }
  if (r.staff) {
    tabs.push({
      key: 'staff',
      label: 'Staff',
      glyph: 'users',
      mark: pending.has('STAFF_REGISTRATION')
        ? 'warn'
        : r.staff.registered > 0
          ? 'ok'
          : undefined,
    });
  }
  // ⚠️ `undefined` is tolerated, not just empty. The API and the web deploy
  // separately, and a page served ahead of the API must still show the status.
  if ((r.submitted ?? []).length > 0) {
    tabs.push({ key: 'submitted', label: 'What You Submitted', glyph: 'clipboard-list' });
  }
  return tabs;
}

export function RequestView({ requests, openStep, getCoupon, reload }: RequestViewProps) {
  const [params, setParams] = useSearchParams();
  // ⚠️ The chosen request lives in the URL, so a refresh or a forwarded link
  // lands on the same one. Anything that matches nothing falls back to the
  // first, which the API sends newest first.
  const ref = params.get('ref');
  const current = requests.find((r) => r.reference === ref) ?? requests[0];
  if (!current) return null;

  const pick = (reference: string) => {
    const next = new URLSearchParams(params);
    next.set('ref', reference);
    setParams(next, { replace: true });
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {requests.length > 1 && (
        <Switcher requests={requests} current={current.reference} onPick={pick} />
      )}
      {/* Keyed on the reference so the tab state starts over on a switch — a
          second request opened on the first one's Payment tab would be a page
          that had quietly kept its place in the wrong document. */}
      <RequestPanel
        key={current.reference}
        request={current}
        openStep={openStep}
        getCoupon={getCoupon}
        reload={reload}
      />
    </div>
  );
}

/** The row of requests, drawn only when there is more than one to choose from. */
function Switcher({
  requests,
  current,
  onPick,
}: {
  requests: PublicRequestStatus[];
  current: string;
  onPick(reference: string): void;
}) {
  return (
    <div
      role='group'
      aria-label='Your Requests'
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
    >
      {requests.map((r) => {
        const on = r.reference === current;
        return (
          <button
            key={r.reference}
            type='button'
            aria-pressed={on}
            onClick={() => onPick(r.reference)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              borderRadius: 'var(--r2)',
              border: `1px solid ${on ? 'var(--pri)' : 'var(--bd)'}`,
              background: on ? 'var(--pri-t)' : 'var(--card)',
              color: on ? 'var(--pri)' : 'var(--fg)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {r.stallName}
            <span
              style={{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--mfg)',
              }}
            >
              {r.reference}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One request: the header band, the tab strip and the open tab's body. */
function RequestPanel({
  request: r,
  openStep,
  getCoupon,
  reload,
}: { request: PublicRequestStatus } & Omit<RequestViewProps, 'requests'>) {
  const mobile = useIsMobile();
  const toast = useToast();
  const [active, setActive] = useState<PortalTab>('overview');
  const [busy, setBusy] = useState<string | null>(null);

  const tabs = portalTabs(r);
  // A tab that stopped existing — bank details went in, and the page re-read —
  // must not leave an empty body under the strip.
  const tab: PortalTab = tabs.some((t) => t.key === active) ? active : 'overview';

  // The link is minted on the click, not when the page loads. Rendering the
  // list would otherwise mint a bank-form link every time the page refreshed.
  const open = async (step: 'BANK_FORM' | 'FSSAI') => {
    setBusy(step);
    try {
      const { url } = await openStep(r.reference, step);
      // A whole-page navigation, not a router push: the URL is built by the
      // shell (the host decides where these pages live) and carries a token
      // this page has never seen.
      window.location.assign(url);
    } catch (e) {
      toast.fail(e);
      setBusy(null);
    }
  };

  const pad = mobile ? '14px 16px 18px' : '18px 22px 24px';

  return (
    <Card pad={0}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          padding: mobile ? '14px 16px' : '18px 22px',
          background: 'var(--rail)',
          borderBottom: '1px solid var(--line)',
          borderRadius: 'var(--r4) var(--r4) 0 0',
        }}
      >
        <div style={{ flex: 1, minWidth: 180 }}>
          <div
            style={{
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              fontSize: 11.5,
              color: 'var(--mfg)',
            }}
          >
            {r.reference}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: mobile ? 18 : 22,
              fontWeight: 600,
              letterSpacing: '-.3px',
              marginTop: 1,
            }}
          >
            {r.stallName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 4 }}>
            {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted {formatDate(r.submittedAt)}
          </div>
        </div>
        {r.allocatedStalls.length > 0 && (
          // The allocation is the one fact on this page a vendor comes back
          // for, so it sits in the band beside the status rather than as a
          // line of body text.
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 11px',
              borderRadius: 'var(--r2)',
              background: 'var(--ok-t)',
              border: '1px solid var(--ok-b)',
              color: 'var(--ok-fg)',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <Icon name='map-pin' size={14} />
            Stall{r.allocatedStalls.length > 1 ? 's' : ''}{' '}
            <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>
              {r.allocatedStalls.join(', ')}
            </span>
          </div>
        )}
        <StatusPill status={r.status} />
      </header>

      <Tabs
        label='Request Sections'
        tabs={tabs}
        active={tab}
        onPick={(k) => setActive(k as PortalTab)}
        style={{ padding: mobile ? '0 8px' : '0 12px', marginBottom: 0 }}
      />

      <div style={{ padding: pad }}>
        {tab === 'overview' && (
          <Overview request={r} busy={busy} onOpen={open} onPick={setActive} />
        )}
        {tab === 'bank' && (
          <StepTab
            step={r.pending.find((p) => p.step === 'BANK_FORM')}
            busy={busy === 'BANK_FORM'}
            onOpen={() => void open('BANK_FORM')}
          >
            Your bank details, GST number and the name to invoice, so Finance can raise the invoice
            and return your deposit to the right account after the event. Only vendors are asked
            for this.
          </StepTab>
        )}
        {tab === 'payment' && <PaymentTab request={r} reload={reload} />}
        {tab === 'fssai' && (
          <StepTab
            step={r.pending.find((p) => p.step === 'FSSAI')}
            busy={busy === 'FSSAI'}
            onOpen={() => void open('FSSAI')}
          >
            A stall selling food needs its FSSAI certificate on file before check-in. Upload a
            photo or scan of it — up to five pages, if it was photographed a page at a time.
          </StepTab>
        )}
        {tab === 'staff' && <StaffTab request={r} getCoupon={getCoupon} />}
        {tab === 'submitted' && <SubmittedTab sections={r.submitted ?? []} />}
      </div>
    </Card>
  );
}

/**
 * The status, and what is still to do.
 *
 * Each outstanding step is a row with its own way forward: the two self-serve
 * forms open on a freshly minted link; payment and staff have nothing to mint,
 * so their rows switch to the tab where the figures and the coupon are.
 *
 * ⚠️ Drawn only for a SELECTED request. A vendor waiting on a decision has
 * nothing to do, and a list of future chores would read as one.
 */
function Overview({
  request: r,
  busy,
  onOpen,
  onPick,
}: {
  request: PublicRequestStatus;
  busy: string | null;
  onOpen(step: 'BANK_FORM' | 'FSSAI'): Promise<void>;
  onPick(tab: PortalTab): void;
}) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>{STATUS_COPY[r.status]}</p>
      {r.status === 'SELECTED' &&
        (r.pending.length > 0 ? (
          <Panel>
            <PanelTitle icon='clock'>Still to do</PanelTitle>
            <div style={{ display: 'grid', width: '100%' }}>
              {r.pending.map((p) => (
                <StepRow key={p.step} step={p} busy={busy} onOpen={onOpen} onPick={onPick} />
              ))}
            </div>
          </Panel>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--mfg)', margin: 0, lineHeight: 1.6 }}>
            Nothing is outstanding on this request.
          </p>
        ))}
    </div>
  );
}

function StepRow({
  step,
  busy,
  onOpen,
  onPick,
}: {
  step: PendingStep;
  busy: string | null;
  onOpen(step: 'BANK_FORM' | 'FSSAI'): Promise<void>;
  onPick(tab: PortalTab): void;
}) {
  const mobile = useIsMobile();
  const action = isSelfServe(step.step) ? (
    <Btn kind='primary' onClick={() => void onOpen(step.step)} disabled={busy !== null}>
      {busy === step.step ? 'Opening…' : 'Open the Form'}
      <Icon name='chevron-right' size={14} />
    </Btn>
  ) : step.step === 'PAYMENT' ? (
    <Btn onClick={() => onPick('payment')}>
      See Payment
      <Icon name='chevron-right' size={14} />
    </Btn>
  ) : (
    <Btn onClick={() => onPick('staff')}>
      Go to Staff
      <Icon name='chevron-right' size={14} />
    </Btn>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        alignItems: mobile ? 'stretch' : 'center',
        gap: 10,
        width: '100%',
        padding: '10px 0',
        borderBottom: '1px solid var(--bd)',
      }}
    >
      <Tag tone='warn' size='sm'>
        <Icon name='clock' size={12} /> {step.label}
      </Tag>
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
}

/**
 * A self-serve step's own tab: what the form is for, and the way in.
 *
 * ⚠️ Present only while the step is in `pending` — see `portalTabs` — so `step`
 * is defined whenever this renders; the guard is for the moment between a
 * re-read and the strip catching up.
 */
function StepTab({
  step,
  busy,
  onOpen,
  children,
}: {
  step: PendingStep | undefined;
  busy: boolean;
  onOpen(): void;
  children: React.ReactNode;
}) {
  if (!step) return null;
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <Tag tone='warn' size='sm'>
        <Icon name='clock' size={12} /> {step.label}
      </Tag>
      <Panel>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, maxWidth: 620 }}>{children}</p>
        <div style={{ marginTop: 4 }}>
          <Btn kind='primary' onClick={onOpen} disabled={busy}>
            {busy ? 'Opening…' : 'Open the Form'}
            <Icon name='chevron-right' size={14} />
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace=apps/web`
Expected: clean. If `Tabs` is not reachable as `'../ui/components/Tabs'`, check how `backoffice/RequestDetail.tsx` imports it (it imports `Tabs` from `'../ui'`); use the same path and import `type TabDef` from `'../ui/components/Tabs'`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/modules/stalls/public/RequestView.tsx
git commit -m "$(cat <<'EOF'
feat(stalls): one request at a time, in tabs

The request is the page: a header band names it, a strip of sections runs
under it, and each section has the room to lay its figures out. Which tabs
exist is read off what the API sent; nothing here decides what is outstanding.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Both pages render `RequestView`; the card goes; the tests follow

**Files:**
- Modify: `web/public/MyRequests.tsx`
- Modify: `web/public/StatusPage.tsx`
- Delete: `web/public/RequestCards.tsx`
- Modify: `web/public/MyRequests.test.tsx`
- Modify: `web/public/StatusPage.test.tsx`

- [ ] **Step 1: Rewrite `MyRequests.test.tsx`**

Replace the whole file `apps/web/src/modules/stalls/public/MyRequests.test.tsx` with:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { MyRequests } from './MyRequests';

afterEach(() => vi.unstubAllGlobals());

const routes = [
  { path: '/stalls/requests', element: <MyRequests /> },
  { path: '/stalls/login', element: <div>the login page</div> },
  { path: '/stalls/apply', element: <div>the form picker</div> },
];

const render = (path = '/stalls/requests') => renderAt(path, routes, { requester: true });

const SESSION = {
  accountId: 'a-1',
  displayName: 'Priya Venkat',
  requesterType: 'VENDOR',
  email: 'priya@greenleaf.example',
  phone: '9840012345',
};

/** What the API reads back off the row — see `submittedSections`. */
const SUBMITTED = [
  {
    title: 'Your Request',
    glyph: 'clipboard-list',
    facts: [
      { label: 'Stall Name', value: 'Green Leaf Organics' },
      { label: 'Location Requested', value: 'C1' },
      { label: 'Items', value: 'Organic spices, cold-pressed oils, honey' },
    ],
  },
  {
    title: 'Electrical',
    glyph: 'sliders',
    facts: [{ label: '15 A Plug Points', value: '2' }],
  },
];

/** One selected request with whatever is outstanding on it. */
const withPending = (
  pending: Array<{ step: string; label: string }>,
  extra: Record<string, unknown> = {},
) => ({
  displayName: 'Priya Venkat',
  requests: [
    {
      reference: 'VEN-2026-0001',
      requestType: 'VENDOR',
      stallName: 'Green Leaf Organics',
      status: 'SELECTED',
      submittedAt: '2026-09-01T10:00:00.000Z',
      allocatedZone: 'C1',
      allocatedStalls: ['C1-4'],
      pending,
      payment: null,
      paymentClaims: [],
      staff: null,
      submitted: SUBMITTED,
      ...extra,
    },
  ],
});

const TWO = {
  displayName: 'Priya Venkat',
  requests: [
    {
      reference: 'VEN-2026-0002',
      requestType: 'VENDOR',
      stallName: 'Second Stall',
      status: 'SUBMITTED',
      submittedAt: '2026-09-02T10:00:00.000Z',
      allocatedZone: null,
      allocatedStalls: [],
      pending: [],
    },
    {
      reference: 'VEN-2026-0001',
      requestType: 'VENDOR',
      stallName: 'Green Leaf Organics',
      status: 'SELECTED',
      submittedAt: '2026-09-01T10:00:00.000Z',
      allocatedZone: 'C1',
      allocatedStalls: ['C1-4'],
      pending: [],
    },
  ],
};

const PAYMENT = {
  feePaise: 11_800_000, // ₹1,18,000
  depositPaise: 2_000_000, // ₹20,000
  totalPaise: 13_800_000, // ₹1,38,000
  virtualAccountRent: 'STALLR9840012345',
  virtualAccountDeposit: 'STALLD9840012345',
};

const signedIn = (requests: unknown) =>
  installFetch([
    ['GET', /\/public\/session$/, () => SESSION],
    ['GET', /\/public\/requests$/, () => requests],
  ]);

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const noTab = (name: RegExp) => expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();

describe('MyRequests', () => {
  test('shows the newest request first, with the one sentence a new applicant comes back for', async () => {
    signedIn(TWO);
    render();

    expect(await screen.findByText('VEN-2026-0002')).toBeInTheDocument();
    expect(screen.getByText(/Received. The stall team will review it./)).toBeInTheDocument();
    // The other request is in the switcher, not on the page.
    expect(screen.queryByText('C1-4')).not.toBeInTheDocument();
  });

  test('two requests draw a switcher; one does not', async () => {
    signedIn(TWO);
    render();

    const group = await screen.findByRole('group', { name: 'Your Requests' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(within(group).getByRole('button', { name: /Second Stall/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a lone request has no switcher to choose from', async () => {
    signedIn(withPending([]));
    render();

    await screen.findByText('VEN-2026-0001');
    expect(screen.queryByRole('group', { name: 'Your Requests' })).not.toBeInTheDocument();
  });

  test('the switcher moves between requests and keeps the choice in the URL', async () => {
    signedIn(TWO);
    const { router } = render();

    await userEvent.click(
      await screen.findByRole('button', { name: /Green Leaf Organics VEN-2026-0001/ }),
    );

    expect(await screen.findByText('C1-4')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?ref=VEN-2026-0001');
  });

  test('?ref in the URL picks the request, so a refresh lands where it was', async () => {
    signedIn(TWO);
    render('/stalls/requests?ref=VEN-2026-0001');

    expect(await screen.findByText('C1-4')).toBeInTheDocument();
    expect(screen.queryByText(/Received. The stall team/)).not.toBeInTheDocument();
  });

  test('carries no token in the URL it asks on — the cookie is the credential', async () => {
    const fx = signedIn({ displayName: 'Priya Venkat', requests: [] });
    render();

    await screen.findByText(/have not requested a stall/i);
    expect(fx.calls.map((c) => `${c.method} ${c.url}`)).toContain(
      'GET /api/m/stalls/public/requests',
    );
  });

  test('sends somebody who is not logged in to the login page', async () => {
    installFetch([['GET', /\/public\/session$/, () => [404, { error: 'no session' }]]]);
    const { router } = render();

    await waitFor(() => expect(router.state.location.pathname).toBe('/stalls/login'));
  });

  test('offers an empty account the way to the forms', async () => {
    signedIn({ displayName: 'Priya Venkat', requests: [] });
    render();

    expect(await screen.findByText(/have not requested a stall/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Request a Stall/ })).toHaveAttribute(
      'href',
      '/stalls/apply',
    );
  });

  test('a tab exists for a step the API says is outstanding, and not otherwise', async () => {
    signedIn(
      withPending([
        { step: 'BANK_FORM', label: 'Bank details pending' },
        { step: 'PAYMENT', label: 'Payment pending' },
      ]),
    );
    render();

    await screen.findByRole('tab', { name: /Overview/ });
    tab(/Bank Details/);
    tab(/Payment/);
    noTab(/FSSAI/);
    // ⚠️ `staff` is null here, so no Staff tab either — the tab set is what the
    // API sent, nothing more.
    noTab(/Staff/);
  });

  test('the overview lists what is still to do, with a way in only where there is one', async () => {
    signedIn(
      withPending([
        { step: 'BANK_FORM', label: 'Bank details pending' },
        { step: 'PAYMENT', label: 'Payment pending' },
      ]),
    );
    render();

    expect(await screen.findByText('Bank details pending')).toBeInTheDocument();
    // Payment shows — the requester should know the team is waiting on it —
    // but its row leads to the figures, because Finance moves the step and
    // this page cannot.
    expect(screen.getByText('Payment pending')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open the Form/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /See Payment/ })).toBeInTheDocument();
  });

  test('"See Payment" on the overview opens the Payment tab', async () => {
    signedIn(withPending([{ step: 'PAYMENT', label: 'Payment pending' }], { payment: PAYMENT }));
    render();

    await userEvent.click(await screen.findByRole('button', { name: /See Payment/ }));

    expect(screen.getByRole('tab', { name: /Payment/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('₹1,38,000')).toBeInTheDocument();
  });

  test('opens a step on the click, naming its own request', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([{ step: 'FSSAI', label: 'FSSAI certificate pending' }]),
      ],
      [
        'POST',
        /\/public\/requests\/continue$/,
        () => ({ url: 'http://web.test/stalls/fssai/tok' }),
      ],
    ]);
    render();

    await userEvent.click(await screen.findByRole('button', { name: /Open the Form/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://web.test/stalls/fssai/tok'));
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001', step: 'FSSAI' });
  });

  test("the step's own tab opens the form too", async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([{ step: 'BANK_FORM', label: 'Bank details pending' }]),
      ],
      ['POST', /\/public\/requests\/continue$/, () => ({ url: 'http://web.test/stalls/bank/tok' })],
    ]);
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Bank Details/ }));
    await userEvent.click(screen.getByRole('button', { name: /Open the Form/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://web.test/stalls/bank/tok'));
  });

  test('names the amount and the accounts on the Payment tab', async () => {
    // 🔴 The whole point: these figures used to exist only in a letter, and a
    // vendor who never got it had a chip saying "payment pending" and no way on
    // this earth to find out what to pay or where.
    signedIn(withPending([{ step: 'PAYMENT', label: 'Payment pending' }], { payment: PAYMENT }));
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    expect(screen.getByText('₹1,18,000')).toBeInTheDocument();
    expect(screen.getByText('₹20,000')).toBeInTheDocument();
    expect(screen.getByText('₹1,38,000')).toBeInTheDocument();
    expect(screen.getByText('STALLR9840012345')).toBeInTheDocument();
    expect(screen.getByText('STALLD9840012345')).toBeInTheDocument();
  });

  test('says where to ask rather than printing a blank account number', async () => {
    signedIn(
      withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
        payment: { ...PAYMENT, virtualAccountRent: null, virtualAccountDeposit: null },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    // A vendor transferring to a half-remembered account is the expensive
    // failure here, so a missing number is said out loud.
    expect(screen.getAllByText(/ask the stall team for the account/i)).toHaveLength(2);
  });

  test('a confirmed transfer keeps the Payment tab after the step has cleared', async () => {
    signedIn(
      withPending([], {
        payment: PAYMENT,
        paymentClaims: [
          {
            id: 'pc-1',
            purpose: 'RENT',
            amountPaise: 11_800_000,
            referenceNo: 'UTR123',
            paidOn: '2026-09-05',
            status: 'VERIFIED',
            rejectReason: null,
          },
        ],
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/UTR123/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Report Another Transfer/ })).toBeInTheDocument();
  });

  test('a rejected transfer shows its reason', async () => {
    // 🔴 That reason is the only thing telling the requester what to correct.
    signedIn(
      withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
        payment: PAYMENT,
        paymentClaims: [
          {
            id: 'pc-1',
            purpose: 'RENT',
            amountPaise: 11_800_000,
            referenceNo: 'UTR999',
            paidOn: '2026-09-05',
            status: 'REJECTED',
            rejectReason: 'No credit with this reference on the statement.',
          },
        ],
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));

    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.getByText(/No credit with this reference/)).toBeInTheDocument();
  });

  test('reporting a transfer opens a dialog, sends the claim, and re-reads', async () => {
    let reads = 0;
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => {
          reads += 1;
          return withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
            payment: PAYMENT,
          });
        },
      ],
      ['POST', /\/public\/requests\/payment-claim$/, () => ({ id: 'pc-1' })],
    ]);
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await userEvent.click(screen.getByRole('button', { name: /Report a Transfer/ }));

    const dialog = screen.getByRole('dialog', { name: 'Report a transfer' });
    await userEvent.type(within(dialog).getByLabelText(/UTR or reference number/), 'UTR123');
    await userEvent.type(within(dialog).getByLabelText(/Amount transferred/), '118000');
    await userEvent.type(within(dialog).getByLabelText(/Date of transfer/), '2026-09-05');
    await userEvent.click(within(dialog).getByRole('button', { name: /Report It/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = fx.calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({
      reference: 'VEN-2026-0001',
      purpose: 'RENT',
      referenceNo: 'UTR123',
      amountPaise: 11_800_000,
      paidOn: '2026-09-05',
    });
    await waitFor(() => expect(reads).toBe(2));
  });

  test('shows the coupon and the way to register on the Staff tab', async () => {
    signedIn(
      withPending([{ step: 'STAFF_REGISTRATION', label: 'Staff not registered' }], {
        staff: {
          coupons: [{ id: 'c-1', code: 'GLO-2026-K7Q4M2X9', capacity: 8, registered: 0 }],
          capacity: 8,
          registered: 0,
        },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Staff/ }));

    expect(screen.getByText('Staff not registered')).toBeInTheDocument();
    expect(screen.getByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    // ⚠️ Never "0 of 8": the cap is what the coupon admits, not what the stall
    // owes. Reading it as a quota is the misreading this wording exists to stop.
    expect(screen.getByText('up to 8 people')).toBeInTheDocument();
    expect(screen.queryByText('0 of 8')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Register Staff/ })).toHaveAttribute(
      'href',
      '/stalls/staff/GLO-2026-K7Q4M2X9',
    );
  });

  test('offers a coupon to a vendor who has none, without inventing a chore', async () => {
    signedIn(withPending([], { staff: { coupons: [], capacity: 0, registered: 0 } }));
    render();

    // ⚠️ `pendingSteps` said nothing is outstanding — it cannot, with no coupon
    // to register against — so the overview must not say otherwise.
    expect(await screen.findByText(/Nothing is outstanding/)).toBeInTheDocument();
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Staff/ }));
    expect(screen.getByRole('button', { name: /Get Your Coupon/ })).toBeInTheDocument();
  });

  test('asking for a coupon names its own request and reveals the code', async () => {
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([], { staff: { coupons: [], capacity: 0, registered: 0 } }),
      ],
      ['POST', /\/public\/requests\/coupon$/, () => ({ code: 'GLO-2026-K7Q4M2X9' })],
    ]);
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Staff/ }));
    await userEvent.click(screen.getByRole('button', { name: /Get Your Coupon/ }));

    expect(await screen.findByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001' });
    expect(screen.getByRole('link', { name: /Register Staff/ })).toHaveAttribute(
      'href',
      '/stalls/staff/GLO-2026-K7Q4M2X9',
    );
  });

  test('a stall holding two codes gets a way in for each of them', async () => {
    // 🔴 The vendor forwards one code to their kitchen team and the other to a
    // caterer. One button beside a list of codes would not say which is which.
    signedIn(
      withPending([{ step: 'STAFF_REGISTRATION', label: 'Staff not registered' }], {
        staff: {
          coupons: [
            { id: 'c-1', code: 'GLO-2026-K7Q4M2X9', capacity: 8, registered: 2 },
            { id: 'c-2', code: 'GLO-2026-B4K2M7PW', capacity: 4, registered: 0 },
          ],
          capacity: 12,
          registered: 2,
        },
      }),
    );
    render();

    await userEvent.click(await screen.findByRole('tab', { name: /Staff/ }));

    expect(screen.getByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(screen.getByText('GLO-2026-B4K2M7PW')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: /Register Staff/ });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/stalls/staff/GLO-2026-K7Q4M2X9',
      '/stalls/staff/GLO-2026-B4K2M7PW',
    ]);

    // Each code's own usage, and the stall's ceiling as the two added up.
    expect(screen.getByText('2 registered, up to 8')).toBeInTheDocument();
    expect(screen.getByText('0 registered, up to 4')).toBeInTheDocument();
    expect(screen.getByText('up to 12 people')).toBeInTheDocument();
  });

  test('reads back what the requester submitted, on its own tab', async () => {
    // 🔴 What they filled in, read back to them — the question the portal could
    // not answer at all. Not the default tab: the page's job first is to say
    // what has been decided and what is outstanding.
    signedIn(withPending([]));
    render();

    await screen.findByRole('tab', { name: /Overview/ });
    expect(screen.queryByText('Location Requested')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /What You Submitted/ }));

    expect(screen.getByText('Location Requested')).toBeInTheDocument();
    expect(screen.getByText('Organic spices, cold-pressed oils, honey')).toBeInTheDocument();
    expect(screen.getByText('15 A Plug Points')).toBeInTheDocument();
    expect(screen.getByText('Electrical')).toBeInTheDocument();
  });

  test('draws no such tab for a payload that carries no answers', async () => {
    // The API and the web deploy separately: a page served ahead of the API
    // that fills this block must still show the status a requester came for.
    signedIn(withPending([], { submitted: undefined }));
    render();

    await screen.findByText('Green Leaf Organics');
    noTab(/What You Submitted/);
  });

  test('a request still under consideration is given no list of future chores', async () => {
    signedIn({
      displayName: 'Priya Venkat',
      requests: [
        {
          reference: 'VEN-2026-0002',
          requestType: 'VENDOR',
          stallName: 'Second Stall',
          status: 'SHORTLISTED',
          submittedAt: '2026-09-02T10:00:00.000Z',
          allocatedZone: null,
          allocatedStalls: [],
          pending: [],
        },
      ],
    });
    render();

    await screen.findByText('Second Stall');
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is outstanding/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/modules/stalls/public/MyRequests.test.tsx`
Expected: many FAIL — no `tab` roles, no switcher group (the page still renders `RequestCards`).

- [ ] **Step 3: Rewrite `MyRequests.tsx`**

Replace `apps/web/src/modules/stalls/public/MyRequests.tsx` with:

```tsx
import { Link, Navigate } from 'react-router';
import { continueMyStep, getMyRequests, requestMyCoupon } from '../api';
import { useLoad } from '../hooks';
import { useRequester } from '../requester';
import { Btn, Card, Icon, Loading } from '../ui';
import { RequestView } from './RequestView';

/**
 * A requester's own requests, reached by logging in.
 *
 * The same portal `StatusPage` serves, behind the other credential. A requester
 * who registered, applied and came back a week later asks one question — what
 * happened to my request? — and before this page the only answer was in their
 * inbox.
 *
 * ⚠️ No token anywhere: the session cookie is the whole credential, and the API
 * reads the account off it. A `reference` in the body of "open this step" picks
 * which of THAT account's requests is meant and can name no other.
 *
 * ⚠️ The gate is `useRequester()`, not a failed fetch. A signed-out reader is
 * sent to the login rather than shown an error, because arriving here signed
 * out is the ordinary case — a bookmark, or a session that quietly expired.
 *
 * No heading of its own: the request's header band is the page's title, and
 * the header above has the way to a new request. A "My Requests" H1 over a
 * band that already names the request said the same thing twice.
 */
export function MyRequests() {
  const { requester, status } = useRequester();

  if (status === 'loading') return <Loading />;
  if (!requester) return <Navigate to='/stalls/login' replace />;

  return <Loaded />;
}

/** Split out so the fetch begins only once there IS a session — a hook cannot
 *  sit behind the redirect above, and asking before then would spend a request
 *  to be told what `useRequester` already knows. */
function Loaded() {
  const { data, loading, reload } = useLoad(() => getMyRequests(), []);

  if (loading) return <Loading />;

  // ⚠️ An error is drawn as the empty state rather than as a failure. There is
  // nothing a requester can do about it, and "we could not load your requests"
  // beside a working link to the forms is the same page with more alarm in it.
  const requests = data?.requests ?? [];

  if (requests.length === 0) {
    return (
      <Card pad={18} style={{ display: 'grid', gap: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>You have not requested a stall yet</div>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
          Once you send one in, this page tells you where it has got to and which forms are still
          waiting on you.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Link to='/stalls/apply' style={{ color: 'inherit' }}>
            <Btn kind='primary'>
              <Icon name='ticket' size={14} />
              Request a Stall
            </Btn>
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <RequestView
      requests={requests}
      openStep={(reference, step) => continueMyStep({ reference, step })}
      getCoupon={(reference) => requestMyCoupon({ reference })}
      reload={reload}
    />
  );
}
```

- [ ] **Step 4: Point `StatusPage.tsx` at `RequestView`**

In `apps/web/src/modules/stalls/public/StatusPage.tsx`: change `import { RequestCards } from './RequestCards';` to `import { RequestView } from './RequestView';` and replace `<RequestCards` with `<RequestView` in the JSX (the props are identical).

- [ ] **Step 5: Delete `RequestCards.tsx`**

```bash
git rm apps/web/src/modules/stalls/public/RequestCards.tsx
```

Then: `grep -rn "RequestCards" apps/web/src` — expected: no matches.

- [ ] **Step 6: Update `StatusPage.test.tsx`**

In `apps/web/src/modules/stalls/public/StatusPage.test.tsx`, replace the first test ("shows the vendor's requests, and the stall number only once selected") with:

```tsx
  test("shows the vendor's requests one at a time, and the stall number only once selected", async () => {
    installFetch([
      [
        'GET',
        /\/public\/status\//,
        () => ({
          displayName: 'Priya Venkat',
          requests: [
            {
              reference: 'VEN-2026-0002',
              requestType: 'VENDOR',
              stallName: 'Second Stall',
              status: 'SHORTLISTED',
              submittedAt: '2026-09-02T10:00:00.000Z',
              allocatedStalls: [],
              pending: [],
            },
            {
              reference: 'VEN-2026-0001',
              requestType: 'VENDOR',
              stallName: 'Green Leaf Organics',
              status: 'SELECTED',
              submittedAt: '2026-09-01T10:00:00.000Z',
              allocatedStalls: ['A4-5'],
              pending: [],
            },
          ],
        }),
      ],
    ]);
    renderAt(`/stalls/status/${'t'.repeat(43)}`, routes);
    expect(await screen.findByText('Priya Venkat')).toBeInTheDocument();
    // The newest request is on screen; the other is in the switcher.
    expect(screen.getByText('Shortlisted')).toBeInTheDocument();
    expect(screen.queryByText('A4-5')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Green Leaf Organics/ }));

    expect(screen.getByText('A4-5')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
  });
```

In the test "the emailed link can ask for a coupon too, naming its own token", before the `Get Your Coupon` click insert:

```tsx
    await userEvent.click(await screen.findByRole('tab', { name: /Staff/ }));
```

and change `await screen.findByRole('button', { name: /Get Your Coupon/ })` to `screen.getByRole('button', { name: /Get Your Coupon/ })`.

The remaining tests ("shows what is outstanding…", "a request still under consideration…", "opening a step mints the link…", "not valid" page, AccessLink) need no change — the overview carries the chips and the Open the Form button.

- [ ] **Step 7: Run the public tests**

Run: `cd apps/web && npx vitest run src/modules/stalls/public/`
Expected: all pass. If `getByRole('button', { name: /Green Leaf Organics VEN-2026-0001/ })` does not match, the accessible name is the button's text content — check it reads `Green Leaf OrganicsVEN-2026-0001` (no space) and loosen the regex to `/Green Leaf Organics/`.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck --workspace=apps/web && npx biome check apps/web/src/modules/stalls/public`
Expected: clean. Fix any Biome formatting with `npx biome format --write apps/web/src/modules/stalls/public`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/modules/stalls/public/
git commit -m "$(cat <<'EOF'
feat(stalls): both portal pages show one request in tabs

MyRequests and StatusPage render RequestView; the card list goes. The tests
reach each section by picking its tab.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The shell — a button, no nav, fluid

**Files:**
- Modify: `apps/web/src/app/PublicLayout.tsx`
- Modify: `web/public/FormPicker.tsx`
- Modify: `apps/web/src/app/shell.test.tsx`

- [ ] **Step 1: Add the failing shell tests**

In `apps/web/src/app/shell.test.tsx`, inside `describe('the public shell', …)`, add:

```tsx
  test('signed in, the way to a new request is a button in the header, not a tab', async () => {
    installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      ['GET', /\/public\/requests$/, () => ({ displayName: 'Priya Venkat', requests: [] })],
    ]);
    renderPublic('/stalls/requests');

    const header = await screen.findByRole('banner');
    expect(within(header).getByRole('link', { name: 'Request a Stall' })).toHaveAttribute(
      'href',
      '/stalls/apply',
    );
    expect(within(header).getByText('Priya Venkat')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Log Out' })).toBeInTheDocument();
    // ⚠️ No tab strip. The requests page IS the portal; there is nothing left
    // to tab between, and an action drawn as a tab reads as a place.
    expect(within(header).queryByRole('navigation')).not.toBeInTheDocument();
  });

  test('signed out, the header carries neither the button nor a name', async () => {
    installFetch([['GET', /\/public\/session$/, () => [404, { error: 'no session' }]]]);
    renderPublic('/stalls/login');

    const header = await screen.findByRole('banner');
    expect(within(header).queryByRole('link', { name: 'Request a Stall' })).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Log Out' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run src/app/shell.test.tsx`
Expected: the first new test FAILS (no link named "Request a Stall" in the header; a `navigation` is present).

- [ ] **Step 3: Rewrite `PublicLayout.tsx`**

Replace `apps/web/src/app/PublicLayout.tsx` with:

```tsx
// SHELL — the chrome around the public forms. Discarded at migration.
//
// ⚠️ Deliberately NOT the backoffice shell. There is no sidebar and no account
// menu: the reader is a requester filling in one form, often on a phone, and
// every control that is not the form is a thing to get wrong. What it does
// share is the token scope — `Frame` is the same, so the card, the type and the
// palette are the product's, not a second look grown for the public side.
//
// 🔴 FLUID, and with a button where there was a nav. The public side ran in a
// 1060px column with a two-tab rail — Request a Stall, My Requests — and the
// first of those is an action, not a place. With the requests page as the
// portal there is nothing left to tab between: the way to a new request is a
// primary button at the top right, and the page takes the width it is given.
import { Link, Outlet, useNavigate } from 'react-router';
import { RequesterProvider, useRequester } from '@/modules/stalls';
import { logoutRequester } from '@/modules/stalls/api';
import { Btn, Frame, Icon, ToastProvider, useIsMobile } from '@/modules/stalls/ui';
import { useTheme } from '@/modules/stalls/use-theme';

/** ⚠️ The requester provider wraps the whole public tree, not just the apply
 *  page. The header's button and "signed in as" read it, and so does the gate
 *  on `FormPicker` and on `RequestForm` — one fetch for the lot rather than one
 *  per screen.
 *
 *  ⚠️ `ToastProvider` sits OUTSIDE it, the same way round as the backoffice
 *  shell and for the same reason: the gate on `MyRequests` swaps its whole
 *  subtree once the session lands, and a toast host inside it would unmount on
 *  that transition and drop what it was holding. The public side needs one at
 *  all because `MyRequests`, `StaffRegistration`, `BankForm` and `FssaiForm`
 *  each call `useToast()`, which THROWS outside a provider — and the shell is
 *  the only thing above all four. */
export function PublicLayout() {
  return (
    <ToastProvider>
      <RequesterProvider>
        <PublicChrome />
      </RequesterProvider>
    </ToastProvider>
  );
}

function PublicChrome() {
  const mobile = useIsMobile();
  const { theme, toggle } = useTheme();
  const { requester } = useRequester();

  return (
    <Frame>
      <div style={{ minHeight: '100svh', background: 'var(--bg)' }}>
        <header
          style={{
            borderBottom: '1px solid var(--bd)',
            background: 'var(--card)',
            // Sticky: the requests page is long and the way to a new request
            // should not have scrolled away by the time somebody wants it.
            position: 'sticky',
            top: 0,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: mobile ? 8 : 12,
            padding: mobile ? '10px 14px' : '12px 28px',
          }}
        >
          <Link
            // Signed in, the mark goes home to the portal; signed out there is
            // no portal to go to, and the forms are the front door.
            to={requester ? '/stalls/requests' : '/stalls/apply'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minWidth: 0,
              color: 'var(--fg)',
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--r3)',
                background: 'var(--pri)',
                color: 'var(--pfg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              <Icon name='ticket' size={16} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontWeight: 700,
                  fontSize: 14,
                  letterSpacing: '-.2px',
                }}
              >
                Stalls
              </span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--mfg)' }}>
                Isha Stall Team
              </span>
            </span>
          </Link>
          <div style={{ flex: 1 }} />
          <RequestStallButton />
          <SignedInAs />
          {/* The one control that stays whoever is reading. A form filled in
              at night on a phone is the case dark mode exists for. */}
          <button
            type='button'
            onClick={toggle}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 'var(--r2)',
              border: '1px solid var(--bd)',
              background: 'var(--card)',
              color: 'var(--mfg)',
              cursor: 'pointer',
              flex: 'none',
            }}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
        </header>
        <main style={{ padding: mobile ? '16px 14px 72px' : '26px 28px 64px' }}>
          <Outlet />
        </main>
      </div>
    </Frame>
  );
}

/**
 * The way to a new request — a primary button, because it is the one thing a
 * signed-in requester DOES from here rather than a place they go.
 *
 * ⚠️ NOTHING at all when signed out, which is the rule the rest of this shell
 * follows: a vendor holding a bank-form link from an email meets no chrome they
 * have to understand, and a button that would bounce them to a login is chrome
 * at its worst.
 *
 * ⚠️ Labelled whatever it draws. On a phone it is the glyph alone — the label
 * beside a name beside two more buttons does not fit — and an unlabelled icon
 * button is a button a screen reader cannot name.
 */
function RequestStallButton() {
  const { requester } = useRequester();
  const mobile = useIsMobile();
  if (!requester) return null;

  return (
    <Link to='/stalls/apply' aria-label='Request a Stall' title='Request a Stall' style={{ color: 'inherit' }}>
      <Btn kind='primary'>
        <Icon name='plus' size={14} />
        {mobile ? '' : 'Request a Stall'}
      </Btn>
    </Link>
  );
}

/** Who is signed in, and the way out.
 *
 *  Nothing at all when signed out — see the note on `RequestStallButton`. */
function SignedInAs() {
  const { requester, reload } = useRequester();
  const nav = useNavigate();
  const mobile = useIsMobile();

  if (!requester) return null;

  const signOut = async () => {
    try {
      await logoutRequester();
    } catch {
      // Nothing useful to say. The cookie is cleared server-side or it is not,
      // and `reload()` below settles what the page shows either way.
    }
    reload();
    nav('/stalls/apply');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {!mobile && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--mfg)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 180,
          }}
        >
          {requester.displayName}
        </span>
      )}
      <button
        type='button'
        onClick={() => void signOut()}
        // ⚠️ Labelled whatever it draws. On a phone it is the glyph alone —
        // "Log Out" beside a name beside a theme toggle does not fit — and an
        // unlabelled icon button is a button a screen reader cannot name.
        aria-label='Log Out'
        title='Log Out'
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 32,
          padding: '0 10px',
          borderRadius: 'var(--r2)',
          border: '1px solid var(--bd)',
          background: 'var(--card)',
          color: 'var(--mfg)',
          fontSize: 12,
          cursor: 'pointer',
          flex: 'none',
        }}
      >
        <Icon name='log-out' size={14} />
        {mobile ? '' : 'Log Out'}
      </button>
    </div>
  );
}
```

Note: `Btn` inside a `Link` — the existing `FormPicker` and `MyRequests` empty state already do this, so it is the established pattern. `useLocation` is no longer imported.

- [ ] **Step 4: Drop the footer on `FormPicker.tsx`**

In `apps/web/src/modules/stalls/public/FormPicker.tsx`, delete the closing `<p style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 20, lineHeight: 1.6 }}> Already submitted? … </p>` block entirely — the whole paragraph, both the signed-in and signed-out branches — **except** the signed-out case still needs its status-link hint. Replace the block with:

```tsx
      {!signedIn && (
        <p style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 20, lineHeight: 1.6 }}>
          Already submitted? Use the link in your confirmation email to check your status — or{' '}
          <Link to='/stalls/status'>have it emailed to you again</Link>.
        </p>
      )}
```

The signed-in sentence about My Requests goes: the header button and the brand mark now carry that.

- [ ] **Step 5: Run the shell and public-onboarding tests**

Run: `cd apps/web && npx vitest run src/app/shell.test.tsx src/modules/stalls/public/PublicOnboarding.test.tsx src/modules/stalls/public/RequesterAuth.test.tsx`
Expected: all pass. If `PublicOnboarding.test.tsx` asserted the "My Requests has every request" sentence on the apply page, update that assertion to look for the header link instead (it renders without the layout, so most likely simply remove the assertion).

- [ ] **Step 6: Typecheck, lint, full web suite**

Run: `npm run typecheck --workspace=apps/web && npx biome check apps/web/src && npm run test --workspace=apps/web`
Expected: all clean and green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/PublicLayout.tsx apps/web/src/app/shell.test.tsx apps/web/src/modules/stalls/public/FormPicker.tsx apps/web/src/modules/stalls/public/PublicOnboarding.test.tsx
git commit -m "$(cat <<'EOF'
feat(stalls): the public shell is fluid, with a button where the nav was

Request a Stall is an action, not a place. It is a primary button at the top
right; the tab rail goes, and the page takes the width it is given.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: See it, and finish

**Files:** none new.

- [ ] **Step 1: Run the whole check**

Run from the repo root: `npm run typecheck && npm run check && npm run lint:boundaries && npm run test --workspace=apps/web`
Expected: all clean.

- [ ] **Step 2: Look at it in the browser**

Run: `npm run dev` (from the repo root; API + web), sign in as the vendor account used in the screenshots, open `http://localhost:5173/stalls/requests`. Check:

- header: brand · [+ Request a Stall] · name · Log Out · theme; no tab rail; page fills the width
- one request card with band, tab strip, Overview checklist
- Payment tab: two panels; Report a Transfer opens a dialog; Cancel closes it
- Staff tab: coupon panel beside How it works
- What You Submitted tab: the grid
- shrink the window under 720px: switcher/tabs scroll, panels stack, header button is glyph-only
- the ashram account: Overview + Staff (+ Submitted) only — no Bank/Payment/FSSAI tabs

Take a screenshot of the requests page at desktop width for the PR.

- [ ] **Step 3: Update the spec's status and the traceability doc**

In `docs/superpowers/specs/2026-09-17-requester-portal-tabs-design.md` change `Status: Approved` to `Status: Built`. Note in the spec, under Decisions §5, that the Payment tab's green mark means "a transfer was confirmed" rather than "PAYMENT no longer pending" — the plan chose the fact over the inference.

Run: `grep -n "portal\|My Requests" docs/requirements-traceability.md | head` — if a row describes the portal as "cards" or names the nav tab, reword it to match (one request in tabs; Request a Stall is a header button). If nothing matches, skip.

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs(stalls): the portal spec is built

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
git push -u origin feat/requester-portal-tabs
gh pr create --title "feat(stalls): the requester's portal shows one request, in tabs" --body "$(cat <<'EOF'
## What

The signed-in public side becomes a portal:

- **Request a Stall** is a primary button in the header, top right. The two-tab nav goes.
- The page is fluid — no more 1060px column.
- **One request on screen at a time**, chosen by a row of pills (only drawn when the account holds more than one; kept in `?ref=`).
- The request's sections are **tabs**: Overview · Bank Details · Payment · FSSAI · Staff · What You Submitted. Which tabs exist is read off what the API sent; the page decides nothing about what is outstanding.
- **Reporting a transfer is a dialog**, opened from the Payment tab.

Both credentials — the session and the emailed link — render the same view.

Spec: `docs/superpowers/specs/2026-09-17-requester-portal-tabs-design.md`

## Not in this change

- Bank details and FSSAI tabs disappear once done rather than showing a tick — the API does not tell "done" from "not applicable" for those. A `stepStates` beside `pendingSteps` would let them stay; separate work.
- No API or `@stalls/core` changes.

## Screenshots

_(attach the desktop screenshot from Task 9 step 2)_

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage.** Header button + no nav + brand link (Task 8) · fluid width (Task 8) · one request with `?ref` switcher (Task 6) · header band with allocation and pill (Task 6) · `Tabs` component with marks (Tasks 1, 6) · tab presence rules (Task 6 `portalTabs`) · Overview checklist with tab-switching rows (Task 6) · Payment two panels (Task 4) · Staff panels incl. Get Your Coupon (Task 5) · Submitted as a tab (Task 5) · claim dialog (Task 3) · FormPicker/MyRequests footers dropped, H1 dropped (Tasks 7, 8) · StatusPage keeps H1 (Task 7) · tests for switcher, `?ref`, tab presence, dialog, shell (Tasks 7, 8) · `.gitignore` already done in the spec commit.

**Deviation from spec, deliberate:** the Payment tab's green mark is "a claim is VERIFIED" rather than "`payment` present and PAYMENT not pending", because the latter also holds when an admin has switched the payment step off, and a green tick there would be the page deciding. Recorded in Task 9 step 3.

**Type consistency.** `RequestViewProps.openStep(reference, step: 'BANK_FORM' | 'FSSAI')` matches `continueMyStep({ reference, step })` and `continueStep(token, { reference, step })`. `getCoupon(reference) => Promise<{ code }>` matches `requestMyCoupon` / `requestCoupon`. `PaymentClaimDialog` props `{ reference, payment, onClose, onSubmitted }` are used identically in Tasks 3 (shim), 4. `TabDef.mark` defined Task 1, used Task 6. `Panel`, `PanelTitle`, `Row`, `Copyable` signatures match across Tasks 2, 4, 5, 6.

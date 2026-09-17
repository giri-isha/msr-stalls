import type { PaymentClaimView, PublicPaymentDue, SubmitPaymentClaimInput } from '@stalls/core';
import { formatInr } from '@stalls/core';
import { useState } from 'react';
import { submitPaymentClaim } from '../api';
import { fieldErrorsFrom } from '../api-client';
import { formatDate } from '../hooks';
import { Btn, Dialog, FormField, Icon, Input, Select, Tag, Textarea, useToast } from '../ui';

/** Paise as the plain rupee figure an `<input type="number">` will hold — not
 *  `formatInr`, which groups and prefixes and is not a number at all. */
const rupeesOf = (paise: number) => String(paise / 100);

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
 * 🔴 THE TWO PAYMENTS ARE NOT THE SAME SHAPE, and this form is where that
 * shows. The deposit is one transfer of one figure — it is held as one and
 * refunded as one — so it is offered ONCE and its amount is fixed. The rent may
 * arrive in instalments, so its amount stays the requester's to type and what
 * is already reported is subtracted from what the field offers.
 *
 * A DIALOG, where it used to unfold inline under the payment figures and push
 * everything below them down the page. The figures stay where they were while
 * the form is open, which matters: the amount owed is what the vendor is
 * copying from.
 */
export function PaymentClaimDialog({
  reference,
  payment,
  claims = [],
  onClose,
  onSubmitted,
  submit: submitProp,
  // ⚠️ "Add payment details" on the requester's side, because "report" reads
  // either as telling us about a problem or as being asked to pay again — see
  // the note at the top of `PaymentTab`. The backoffice passes its own title:
  // a member filing for a vendor IS recording something reported to them.
  title = 'Add payment details',
  submitLabel = 'Save Details',
}: {
  reference: string;
  payment: PublicPaymentDue | null;
  /** What has already been reported against this request, so the form does not
   *  offer a payment there is nothing left to report against.
   *
   *  ⚠️ Empty where the caller does not know. The backoffice files against a
   *  request whose claims it has not read, and an unknown history must not hide
   *  a purpose a member is trying to record. */
  claims?: readonly PaymentClaimView[];
  onClose: () => void;
  onSubmitted: () => void;
  /** How the claim is sent. The requester's own dialog posts it against their
   *  session; the backoffice posts it against the request it is filing for. */
  submit?: (input: Omit<SubmitPaymentClaimInput, 'reference'>) => Promise<unknown>;
  title?: string;
  submitLabel?: string;
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

  // 🔴 A PENDING claim counts as reported. Waiting for finance to check one is
  // not a reason to send the same transfer in again, and two claims against one
  // credit is the reconciliation by hand this queue replaced. A REJECTED claim
  // does not count — it is the one thing here that has to be reported again.
  const reported = claims.filter((c) => c.status !== 'REJECTED');
  const depositReported = reported.some((c) => c.purpose === 'DEPOSIT');
  const rentReportedPaise = reported
    .filter((c) => c.purpose === 'RENT')
    .reduce((sum, c) => sum + c.amountPaise, 0);

  // 🔴 THE DEPOSIT IS ONE TRANSFER. It is held as one figure and refunded as
  // one, so half of it on the statement is a credit that settles nothing and
  // gets chased instead. Where the figure is known the amount is FIXED rather
  // than merely prefilled — the field below is read-only for it.
  //
  // ⚠️ RENT IS THE OPPOSITE, deliberately: a trader may send it in instalments,
  // so the field stays theirs to type and what is offered is what is left after
  // everything already reported.
  const depositTotalPaise = purpose === 'DEPOSIT' && payment ? payment.depositPaise : null;
  const rentLeftPaise = payment ? Math.max(payment.feePaise - rentReportedPaise, 0) : null;

  // ⚠️ Prefilled from what is owed for the purpose chosen, because the figure
  // is right there on the page behind and retyping it is where a digit gets
  // dropped. Still editable for rent: a vendor who paid a different amount has
  // to be able to say so, and that gap is exactly what finance needs to see.
  const owed = payment ? (purpose === 'RENT' ? payment.feePaise : payment.depositPaise) : null;
  const amountValue = depositTotalPaise !== null ? rupeesOf(depositTotalPaise) : amount;

  // ⚠️ For rent the help carries what is LEFT, not only what the whole thing
  // costs. A trader paying the second of three instalments is looking at this
  // line to work out the figure, and "₹20,768 is due" is the wrong one.
  const amountHelp =
    depositTotalPaise !== null
      ? `${formatInr(depositTotalPaise)}, transferred in one go — the deposit cannot be split.`
      : owed === null
        ? undefined
        : rentReportedPaise > 0
          ? `${formatInr(owed)} is due in all. You have added ${formatInr(rentReportedPaise)} so far, so ${formatInr(rentLeftPaise ?? 0)} is left. Rent may be sent in instalments.`
          : `${formatInr(owed)} is due for this. You may send it in instalments.`;

  const submit = async () => {
    setErrors({});
    setBusy(true);
    try {
      const body = {
        purpose,
        referenceNo: referenceNo.trim(),
        // Rupees on screen, paise on the wire — the whole module counts in
        // paise so a rounding error cannot appear between two screens. The
        // fixed deposit figure skips the field entirely and goes as it is
        // held: it has to match a statement line to the rupee.
        amountPaise: depositTotalPaise ?? Math.round(Number(amount) * 100),
        paidOn,
        remitterName: remitterName.trim() || undefined,
        note: note.trim() || undefined,
      };
      await (submitProp ?? ((input) => submitPaymentClaim({ reference, ...input })))(body);
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

  const ready = referenceNo.trim() !== '' && amountValue.trim() !== '' && paidOn !== '';

  return (
    <Dialog
      title={title}
      note='Rent and the deposit are paid separately, so please add them separately. We check what you tell us against the bank statement before it counts as paid.'
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={submit} disabled={busy || !ready}>
            <Icon name='send' size={14} />
            {busy ? 'Sending…' : submitLabel}
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField
          id='claim-purpose'
          label='Which payment'
          // ⚠️ The deposit drops OUT of the list once it has been reported,
          // rather than staying as a choice that leads to a duplicate. Said out
          // loud, because a list that quietly grew shorter reads as a bug.
          help={
            depositReported
              ? 'You have already added the refundable deposit, so only rent is left to add.'
              : undefined
          }
          required
        >
          <Select
            id='claim-purpose'
            value={purpose}
            onChange={(v) => setPurpose(v as 'RENT' | 'DEPOSIT')}
          >
            <option value='RENT'>Rent</option>
            {!depositReported && <option value='DEPOSIT'>Refundable deposit</option>}
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
          help={amountHelp}
          required
          error={errors.amountPaise}
        >
          <Input
            id='claim-amount'
            type='number'
            inputMode='decimal'
            min={1}
            // ⚠️ `readOnly`, not `disabled`: a disabled field is skipped by the
            // keyboard and reads as "not asked for", and the deposit figure is
            // the one thing on this form the requester most needs to SEE.
            readOnly={depositTotalPaise !== null}
            placeholder={rentLeftPaise !== null ? rupeesOf(rentLeftPaise) : undefined}
            value={amountValue}
            invalid={!!errors.amountPaise}
            style={depositTotalPaise !== null ? { color: 'var(--mfg)' } : undefined}
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
          {claim.rejectReason} Please check the details and add it again.
        </div>
      )}
    </div>
  );
}

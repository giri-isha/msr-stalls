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

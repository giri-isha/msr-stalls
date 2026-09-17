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

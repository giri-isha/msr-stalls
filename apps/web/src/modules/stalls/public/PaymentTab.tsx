import type {
  PublicBeneficiary,
  PublicChargeBreakdown,
  PublicPaymentDue,
  PublicRequestStatus,
  QuoteLine,
} from '@stalls/core';
import { CHARGE_GROUPS, CHARGE_GROUP_HEADING, chargeSum, formatInr } from '@stalls/core';
import { useState } from 'react';
import { Btn, Icon, Tag, useIsMobile } from '../ui';
import { ClaimRow, PaymentClaimDialog } from './PaymentClaim';
import { Copyable, Panel, PanelTitle, Row } from './portal-ui';

/**
 * What is owed and where to send it — the payment-details letter, on the page —
 * beside what the requester has told us they transferred.
 *
 * 🔴 TWO PAYMENTS, and the page is built around that before anything else. Rent
 * and the refundable deposit land in different virtual accounts, and a vendor
 * who transfers the sum of both into one of them has paid an amount that
 * reconciles against neither — a refund request and a chase, not a payment. The
 * letter says so twice and in capitals; this page says it by putting each
 * amount in its own panel with its own account under it, so there is no single
 * "total" figure to transfer in one go.
 *
 * 🔴 And the ARITHMETIC, which this page did not used to show. It had "Fee,
 * including GST: ₹17,700" and nothing else, while the letter for the same
 * request printed "15 Amp : 4 × 1000 : ₹4,000.00". A vendor querying their bill
 * asks about the multiplication, not the total, so the page that was meant to
 * replace the letter sent them back to the letter. The lines come from the API,
 * out of the frozen plan where one exists — see `PublicPaymentDue.breakdown`.
 *
 * 🔴 ONE fee, and it is what is OWED. Where the team agreed a concession, that
 * is the figure here and it is the figure `paymentConfirmed` settles against,
 * so a trader who pays what this panel asks for actually clears the step. The
 * rate they were quoted before the concession is not shown beside it — and the
 * breakdown arrives null in that case, because lines adding up to the quoted
 * figure under a total that is smaller is exactly that comparison drawn out.
 *
 * ⚠️ The figures are absent until Finance has quoted. "Payment pending" with no
 * figure is honest; a number invented on this page would not be. Reporting a
 * transfer is offered even then: a requester who paid against a letter can
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
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {payment ? (
            <>
              <SeparatelyNote />
              <RentPanel payment={payment} />
              <DepositPanel payment={payment} />
            </>
          ) : (
            <Panel>
              <PanelTitle icon='rupee'>What to pay</PanelTitle>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
                Finance has not sent the figures yet. The amount and the accounts to pay into will
                appear here once they have. If you have already paid against a letter, you can still
                report the transfer.
              </p>
            </Panel>
          )}
        </div>
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
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
          {payment?.beneficiary && <BeneficiaryPanel beneficiary={payment.beneficiary} />}
          {payment && <NotesPanel />}
        </div>
      </div>
      {open && (
        <PaymentClaimDialog
          reference={request.reference}
          payment={payment}
          // What has been reported already, so the form neither offers the
          // deposit a second time nor asks for rent that has been sent.
          claims={claims}
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

/** 🔴 The one instruction on this page that costs money to ignore, so it is
 *  above both figures rather than a footnote under them. The two amounts go to
 *  two accounts; their sum, sent to either, reconciles against neither. */
function SeparatelyNote() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 'var(--r2)',
        background: 'var(--warn-t)',
        border: '1px solid var(--warn-b)',
        color: 'var(--warn-fg)',
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <Icon name='alert-triangle' size={14} />
      <span>
        <strong>Please make the two payments separately.</strong> The rent and the refundable
        deposit go to different accounts — one transfer for both amounts cannot be matched to your
        stall. Transfer by NEFT or RTGS only; please do not use IMPS.
      </span>
    </div>
  );
}

/** Payment 1 — the rent, itemised, with the account it is paid into. */
function RentPanel({ payment }: { payment: PublicPaymentDue }) {
  return (
    <Panel>
      <PanelTitle icon='rupee'>Payment 1 — Rent</PanelTitle>
      {payment.breakdown ? (
        <Breakdown breakdown={payment.breakdown} />
      ) : (
        // No breakdown where a concession is in force, or where an older API
        // did not send one. The figure owed is the figure owed either way.
        <Row k='Fee, including GST' v={formatInr(payment.feePaise)} />
      )}
      <Total label='Total for rent' amountPaise={payment.feePaise} />
      <AccountRow k='Pay into account' account={payment.virtualAccountRent} />
    </Panel>
  );
}

/**
 * Payment 2 — the refundable deposit, split.
 *
 * ⚠️ Two figures and a total, as the letter has it. The split is not decoration:
 * the two halves are refunded apart, a fine for an unclean stall coming off the
 * stall's and unreturned chairs off the furniture's. The furniture line is
 * dropped where no furniture was taken — a vendor must not read a caution
 * deposit for chairs they never had.
 *
 * ⚠️ Never discounted, even where the fee above it was. The deposit comes back
 * in full, so a concession on it would mean refunding money never taken.
 */
function DepositPanel({ payment }: { payment: PublicPaymentDue }) {
  const equipment = payment.equipmentDepositPaise;
  return (
    <Panel>
      <PanelTitle icon='shield'>Payment 2 — Refundable deposit</PanelTitle>
      {equipment > 0 ? (
        <>
          <Row k='Deposit — stall' v={formatInr(payment.stallDepositPaise)} />
          <Row k='Deposit — chairs and tables' v={formatInr(equipment)} />
        </>
      ) : (
        <Row k='Deposit — stall' v={formatInr(payment.stallDepositPaise)} />
      )}
      <Total label='Total caution deposit' amountPaise={payment.depositPaise} />
      <AccountRow k='Pay into account' account={payment.virtualAccountDeposit} />
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--mfg)', lineHeight: 1.6 }}>
        Returned to your bank account after the event, less anything deducted for chairs and tables
        not returned or returned damaged, or for an unclean stall.
      </p>
    </Panel>
  );
}

/**
 * The charged items with their arithmetic intact.
 *
 * ⚠️ Zero rows are DROPPED, exactly as the letter drops them. A stall that took
 * no chairs should not read a line charging it nothing — a reader who has to
 * decide whether ₹0 is a mistake is a reader who rings up. The API sends them
 * all so it can tell "asked for none" from "not charged for"; that distinction
 * belongs to the electrical sheet, not to this page.
 *
 * ⚠️ The multiplication text comes from `chargeSum` in `@stalls/core`, the same
 * function the letter's lines are built with. Written again here is how a page
 * saying "4 plug points" ends up beside a letter saying "4 × 1000" for the line
 * a vendor is on the phone about.
 */
function Breakdown({ breakdown }: { breakdown: PublicChargeBreakdown }) {
  return (
    <>
      {CHARGE_GROUPS.map((group) => {
        const lines = breakdown.lines.filter((l) => l.group === group && l.amountPaise > 0);
        if (lines.length === 0) return null;
        // The rent stands alone, with no heading and no multiplication unless
        // more than one stall was allocated.
        if (group === 'stall') {
          return lines.map((l) => (
            <Row
              key={l.key}
              k={l.count > 1 ? chargeSum(l) : l.label}
              v={formatInr(l.amountPaise)}
            />
          ));
        }
        return (
          <div key={group} style={{ display: 'grid', gap: 6, width: '100%' }}>
            <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 2 }}>
              {CHARGE_GROUP_HEADING[group]}
            </div>
            {lines.map((l) => (
              <ItemRow key={l.key} line={l} />
            ))}
          </div>
        );
      })}
      <Row k={`GST ${breakdown.gstPercent}%`} v={formatInr(breakdown.gstPaise)} />
    </>
  );
}

/** One indented item under a group heading. */
function ItemRow({ line }: { line: QuoteLine }) {
  return (
    <div style={{ paddingLeft: 12 }}>
      <Row k={chargeSum(line)} v={formatInr(line.amountPaise)} />
    </div>
  );
}

/** A panel's own total, ruled off the lines above it the way the letter is. */
function Total({ label, amountPaise }: { label: string; amountPaise: number }) {
  return (
    <div
      style={{
        width: '100%',
        marginTop: 4,
        paddingTop: 8,
        borderTop: '1px solid var(--bd)',
      }}
    >
      <Row k={label} v={formatInr(amountPaise)} strong />
    </div>
  );
}

/**
 * Who the transfer is made to.
 *
 * ⚠️ From the edition's settings, which is also where the letter's block comes
 * from — so a bank change moves both at once. A line the team has not filled in
 * is left out rather than drawn empty; a half-filled table naming what it knows
 * is still a table somebody can transfer from.
 */
function BeneficiaryPanel({ beneficiary }: { beneficiary: PublicBeneficiary }) {
  const rows: Array<[string, string | null]> = [
    ['Account name', beneficiary.accountName],
    ['Beneficiary address', beneficiary.address],
    ['Account type', beneficiary.accountType],
    ['Bank', beneficiary.bankName],
    ['RTGS / NEFT / IFSC', beneficiary.ifsc],
    ['Branch', beneficiary.branch],
  ];
  return (
    <Panel>
      <PanelTitle icon='home'>Who to pay</PanelTitle>
      {rows.map(([label, value]) =>
        value ? (
          <Row
            key={label}
            k={label}
            v={
              label === 'RTGS / NEFT / IFSC' ? (
                <Copyable value={value} label='IFSC' />
              ) : (
                <span>{value}</span>
              )
            }
          />
        ) : null,
      )}
    </Panel>
  );
}

/**
 * The letter's "Important" list, on the page.
 *
 * 🔴 Every one of these is a way a transfer arrives and cannot be matched to a
 * stall. They are not general advice: a UPI app sends no remitter details, so a
 * payment made through one is a credit on a statement with nobody's name
 * against it, and the vendor is chased for a payment they have made.
 */
function NotesPanel() {
  return (
    <Panel>
      <PanelTitle icon='info'>Before you transfer</PanelTitle>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          display: 'grid',
          gap: 6,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: 'var(--fg)',
        }}
      >
        <li>NEFT or RTGS only. Cash, cheque and DD are not accepted into these accounts.</li>
        <li>
          Please do not pay through Google Pay, PhonePe or Paytm — they do not send the remitter
          details, so we cannot tell whose payment it is.
        </li>
        <li>
          Add the beneficiary on your bank’s desktop site. Many banking apps will not accept letters
          in the account number field.
        </li>
        <li>HDFC account holders can add it under “Add Beneficiary — ECMS code”.</li>
        <li>Please transfer from one account only, so the payment can be reconciled.</li>
        <li>
          These accounts are issued to you alone. Please do not share them or pay into any other
          account.
        </li>
        <li>Once you have paid, report the transfer here so Finance can match it.</li>
      </ul>
    </Panel>
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

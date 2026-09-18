import type {
  PaymentClaimView,
  PublicBeneficiary,
  PublicChargeBreakdown,
  PublicPaymentDue,
  PublicRequestStatus,
} from '@stalls/core';
import { CHARGE_GROUPS, CHARGE_GROUP_HEADING, chargeSum, formatInr } from '@stalls/core';
import React, { type CSSProperties, type ReactNode, useState } from 'react';
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
 * letter says so twice and in capitals; this page says it by giving each
 * payment its own line with its own account under it, and by having NO total
 * row: there is no single figure on this page to transfer in one go.
 *
 * 🔴 AN INVOICE, not two plates. Each payment is a line — what it is, what is
 * due, and once anything has been added, what has been added and what is left
 * — with its arithmetic indented under it. A vendor paying rent in instalments
 * reads the balance off the line instead of subtracting two figures from two
 * boxes; a vendor who has paid reads a zero. The "Added" and "Balance" columns
 * appear only once there is a payment to show in them: three columns of the
 * same figure and a zero say nothing a single column does not.
 *
 * 🔴 ONE fee, and it is what is OWED. Where the team agreed a concession, that
 * is the figure here and it is the figure `paymentConfirmed` settles against,
 * so a trader who pays what this line asks for actually clears the step. The
 * rate they were quoted before the concession is not shown beside it — and the
 * breakdown arrives null in that case, because lines adding up to the quoted
 * figure under a total that is smaller is exactly that comparison drawn out.
 *
 * ⚠️ "Added" counts a claim that is still being checked, and not one that was
 * rejected. Waiting for finance is not a reason to send the same transfer
 * again; a rejected one is the one thing that has to be sent again. Same rule
 * the claim dialog applies to what it offers.
 *
 * ⚠️ The figures are absent until Finance has quoted. "Payment pending" with no
 * figure is honest; a number invented on this page would not be. Adding payment
 * details is offered even then: a requester who paid against a letter can still
 * tell us, and finance would rather have the reference than a mailbox.
 *
 * ⚠️ "Add payment details", never "report a transfer". A vendor reads "report"
 * as telling us about a problem — and the ones who did not read it that way
 * read it as being asked to do the payment again. What the button opens is a
 * short form about a transfer they have already made.
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
    <div style={{ display: 'grid', gap: 16 }}>
      {pending && (
        <div>
          <Tag tone='warn' size='sm'>
            <Icon name='clock' size={12} /> {pending.label}
          </Tag>
        </div>
      )}
      {payment && <SeparatelyNote />}
      {payment && <NotesPanel />}

      {/* 🔴 THE BILL AND THE LEDGER, SIDE BY SIDE. The bill caps itself at a
          readable measure — see `Invoice` — so on the full-width page the whole
          right of the screen was empty while what a vendor has already sent sat
          a scroll below the thing it answers. They are the two halves of one
          question: this is what is due, this is what I have paid.

          ⚠️ FLEX-WRAP, not a two-column grid. The pair has to become one column
          on a phone, but also in the narrower space a tablet leaves beside the
          section rail, and `flex-wrap` folds on the space there actually is
          rather than on a breakpoint that cannot see the rail. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0, maxWidth: 860 }}>
          {payment ? (
            <Invoice payment={payment} claims={claims} />
          ) : (
            <Panel>
              <PanelTitle icon='rupee'>What to pay</PanelTitle>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
                Finance has not sent the figures yet. The amount and the accounts to pay into will
                appear here once they have. If you have already paid against a letter, you can still
                add the details.
              </p>
            </Panel>
          )}
        </div>

        <div style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 520 }}>
          <Panel>
            <PanelTitle icon='file-text'>Payments you have added</PanelTitle>
            {claims.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
                Nothing added yet. Once you have paid, add the details of the transfer — the UTR
                above all — so Finance can match it against the bank statement.
              </p>
            ) : (
              // One per row: this is a column beside the bill now, not a band
              // across the page, so there is no width to lay claims out in.
              <div style={{ display: 'grid', gap: 6, width: '100%' }}>
                {claims.map((c) => (
                  <ClaimRow key={c.id} claim={c} />
                ))}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <Btn kind='primary' onClick={() => setOpen(true)}>
                <Icon name='plus' size={14} />
                {claims.length > 0 ? 'Add Another Payment' : 'Add Payment Details'}
              </Btn>
            </div>
          </Panel>
        </div>
      </div>

      {payment?.beneficiary && (
        <div
          style={{
            // ⚠️ CAPPED at 420px rather than splitting the page. This is a
            // label-and-value table read with a bank app in the other hand,
            // and half a full-width page is a rail nothing lines up against.
            maxWidth: mobile ? undefined : 420,
            paddingTop: 14,
            borderTop: '1px solid var(--line)',
          }}
        >
          <BeneficiaryPanel beneficiary={payment.beneficiary} />
        </div>
      )}

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
 *  above the figures rather than a footnote under them, and it is the one
 *  filled block on the page: the two amounts go to two accounts, and their
 *  sum, sent to either, reconciles against neither. */
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

/** What has been added against one purpose — pending included, rejected not.
 *  See the note at the top of the file. */
function addedFor(claims: readonly PaymentClaimView[], purpose: 'RENT' | 'DEPOSIT'): number {
  return claims
    .filter((c) => c.purpose === purpose && c.status !== 'REJECTED')
    .reduce((sum, c) => sum + c.amountPaise, 0);
}

/**
 * The two payments as the lines of an invoice.
 *
 * A real `<table>`: the figures are a column a reader adds up, and a screen
 * reader gets "Rent, Due, ₹20,768" rather than three unrelated cells. The
 * breakdown is indented under each line in the same Due column, so the units
 * line up under the units all the way down.
 *
 * ⚠️ No footer row. See the file's note: a total for both payments is the
 * figure this page must never print.
 */
function Invoice({
  payment,
  claims,
}: {
  payment: PublicPaymentDue;
  claims: readonly PaymentClaimView[];
}) {
  const mobile = useIsMobile();
  const ledger = claims.some((c) => c.status !== 'REJECTED');
  const rentAdded = addedFor(claims, 'RENT');
  const depositAdded = addedFor(claims, 'DEPOSIT');
  const equipment = payment.equipmentDepositPaise;

  const th: CSSProperties = {
    textAlign: 'right',
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    color: 'var(--mfg)',
    padding: '0 0 8px 12px',
    borderBottom: '1px solid var(--bd)',
    whiteSpace: 'nowrap',
  };

  return (
    // ⚠️ The bill CAPS ITSELF, now the page is the screen — the column it sits
    // in carries the same figure. A table set across a whole monitor puts
    // "Rent" hard left and ₹20,768 hard right with three feet of nothing
    // between them, which is the one arrangement of a figure and its name that
    // cannot be read as a pair.
    <div style={{ overflowX: 'auto', width: '100%', maxWidth: 860 }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12.5,
          fontVariantNumeric: 'tabular-nums',
          minWidth: ledger && mobile ? 360 : undefined,
        }}
      >
        <thead>
          <tr>
            <th scope='col' style={{ ...th, textAlign: 'left', padding: '0 0 8px' }}>
              Payment
            </th>
            <th scope='col' style={th}>
              Due
            </th>
            {ledger && (
              <>
                <th scope='col' style={th}>
                  Added
                </th>
                <th scope='col' style={th}>
                  Balance
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          <Line
            n={1}
            icon='rupee'
            title='Rent'
            sub='Total for rent'
            duePaise={payment.feePaise}
            addedPaise={ledger ? rentAdded : null}
            account={payment.virtualAccountRent}
            detail={
              payment.breakdown ? (
                <Breakdown breakdown={payment.breakdown} cols={ledger ? 4 : 2} />
              ) : (
                // No breakdown where a concession is in force, or where an
                // older API did not send one. The figure owed is the figure
                // owed either way, and it is already on the line.
                <NoteRow cols={ledger ? 4 : 2}>
                  The agreed rent for your stall, inclusive of GST.
                </NoteRow>
              )
            }
          />
          <Line
            n={2}
            icon='shield'
            title='Refundable deposit'
            sub='Total caution deposit'
            duePaise={payment.depositPaise}
            addedPaise={ledger ? depositAdded : null}
            account={payment.virtualAccountDeposit}
            detail={
              <>
                <SubRow
                  label='Deposit — stall'
                  amountPaise={payment.stallDepositPaise}
                  cols={ledger ? 4 : 2}
                />
                {equipment > 0 && (
                  <SubRow
                    label='Deposit — chairs and tables'
                    amountPaise={equipment}
                    cols={ledger ? 4 : 2}
                  />
                )}
                <NoteRow cols={ledger ? 4 : 2}>
                  Returned to your bank account after the event, less anything deducted for chairs
                  and tables not returned or returned damaged, or for an unclean stall.
                </NoteRow>
              </>
            }
          />
        </tbody>
      </table>
    </div>
  );
}

/**
 * One payment: the line with its figures, its arithmetic under it, and the
 * account it goes into at the foot.
 *
 * ⚠️ The numbered badge is the two-payments rule, drawn. The warning above
 * says it in words; "1" and "2" on two lines, each with its own figure and
 * its own account, is the same instruction in a form that survives not being
 * read.
 */
function Line({
  n,
  icon,
  title,
  sub,
  duePaise,
  addedPaise,
  account,
  detail,
}: {
  n: 1 | 2;
  icon: string;
  title: string;
  sub: string;
  duePaise: number;
  /** Null hides the Added and Balance cells — the table has no such columns. */
  addedPaise: number | null;
  account: string | null;
  detail: ReactNode;
}) {
  const balance = addedPaise === null ? null : Math.max(duePaise - addedPaise, 0);
  const cols = addedPaise === null ? 2 : 4;
  const amount: CSSProperties = {
    textAlign: 'right',
    verticalAlign: 'top',
    padding: '12px 0 4px 12px',
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: '-.3px',
    whiteSpace: 'nowrap',
  };
  return (
    <>
      <tr>
        <th
          scope='row'
          style={{
            textAlign: 'left',
            verticalAlign: 'top',
            padding: '12px 0 4px',
            fontWeight: 700,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                flex: 'none',
                borderRadius: '50%',
                background: 'var(--pri-t)',
                color: 'var(--pri)',
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {n}
            </span>
            <Icon name={icon} size={13} color='var(--pri)' />
            <span>
              {title}
              <span
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--mfg)',
                  marginTop: 1,
                }}
              >
                {sub}
              </span>
            </span>
          </span>
        </th>
        <td style={amount}>{formatInr(duePaise)}</td>
        {addedPaise !== null && balance !== null && (
          <>
            <td style={{ ...amount, color: addedPaise > 0 ? 'var(--fg)' : 'var(--mfg)' }}>
              {addedPaise > 0 ? formatInr(addedPaise) : '—'}
            </td>
            <td
              style={{
                ...amount,
                color: balance === 0 ? 'var(--ok-fg)' : 'var(--warn-fg)',
              }}
            >
              {formatInr(balance)}
            </td>
          </>
        )}
      </tr>
      {detail}
      <tr>
        <td colSpan={cols} style={{ padding: '8px 0 14px' }}>
          <AccountStrip account={account} />
        </td>
      </tr>
    </>
  );
}

/** One line of the arithmetic: what it is, indented and muted, with its
 *  figure in the Due column so the units sit under the units. */
function SubRow({
  label,
  amountPaise,
  cols,
  deeper,
}: {
  label: string;
  amountPaise: number;
  cols: 2 | 4;
  deeper?: boolean;
}) {
  return (
    <tr>
      <td
        style={{
          padding: `3px 0 3px ${deeper ? 44 : 28}px`,
          color: 'var(--mfg)',
          fontSize: 12,
        }}
      >
        {label}
      </td>
      <td
        style={{
          textAlign: 'right',
          padding: '3px 0 3px 12px',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {formatInr(amountPaise)}
      </td>
      {cols === 4 && <td colSpan={2} />}
    </tr>
  );
}

/** A heading over a group of sub-rows — "Cost of additional plug points". */
function GroupRow({ children, cols }: { children: ReactNode; cols: 2 | 4 }) {
  return (
    <tr>
      <td
        colSpan={cols}
        style={{
          padding: '6px 0 2px 28px',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--mfg)',
          letterSpacing: '.02em',
        }}
      >
        {children}
      </td>
    </tr>
  );
}

/** A sentence under a line, where a figure would be noise. */
function NoteRow({ children, cols }: { children: ReactNode; cols: 2 | 4 }) {
  return (
    <tr>
      <td
        colSpan={cols}
        style={{
          padding: '4px 0 2px 28px',
          fontSize: 11.5,
          color: 'var(--mfg)',
          lineHeight: 1.55,
        }}
      >
        {children}
      </td>
    </tr>
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
function Breakdown({ breakdown, cols }: { breakdown: PublicChargeBreakdown; cols: 2 | 4 }) {
  return (
    <>
      {CHARGE_GROUPS.map((group) => {
        const lines = breakdown.lines.filter((l) => l.group === group && l.amountPaise > 0);
        if (lines.length === 0) return null;
        // The rent stands alone, with no heading and no multiplication unless
        // more than one stall was allocated.
        if (group === 'stall') {
          return lines.map((l) => (
            <SubRow
              key={l.key}
              label={l.count > 1 ? chargeSum(l) : l.label}
              amountPaise={l.amountPaise}
              cols={cols}
            />
          ));
        }
        return (
          <React.Fragment key={group}>
            <GroupRow cols={cols}>{CHARGE_GROUP_HEADING[group]}</GroupRow>
            {lines.map((l) => (
              <SubRow
                key={l.key}
                label={chargeSum(l)}
                amountPaise={l.amountPaise}
                cols={cols}
                deeper
              />
            ))}
          </React.Fragment>
        );
      })}
      {/* GST is charged ON the lines above rather than being one more of them,
          so it sits apart from them. */}
      <SubRow label={`GST ${breakdown.gstPercent}%`} amountPaise={breakdown.gstPaise} cols={cols} />
    </>
  );
}

/**
 * The account this line's figure is transferred into.
 *
 * ⚠️ On a soft plate — the one plate on this page — because it is half of what
 * the line is for: a figure with no account to send it to is not a payment,
 * and a vendor finds this again with a bank app open in the other hand. The
 * two plates are also how they check, before pressing send, that the rent is
 * not going into the deposit account.
 *
 * ⚠️ An account number can be null — an edition with no virtual-account prefix,
 * or a contact that is not a mobile. It says to ask rather than printing a
 * blank where an account number should be, because a vendor transferring to a
 * half-remembered account is the expensive failure here.
 */
function AccountStrip({ account }: { account: string | null }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '8px 12px',
        marginLeft: 28,
        borderRadius: 'var(--r2)',
        background: 'var(--mut)',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--mfg)', fontSize: 11.5, fontWeight: 600 }}>Pay into account</span>
      {account ? (
        <Copyable value={account} label='Account number' />
      ) : (
        <span style={{ color: 'var(--mfg)' }}>Please ask the stall team for the account.</span>
      )}
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
 *
 * 🔴 ABOVE the figures, not under them. In a column below the bill it was a
 * footnote a scroll past the button it is trying to reach — read, if at all,
 * after the transfer it was meant to change. A rule that costs money to ignore
 * is read before the amount or it is not read.
 *
 * 🔴 THE RULE LEADS, the reason follows it. "Please do not pay through Google
 * Pay, PhonePe or Paytm — they do not send the remitter details" is a sentence a
 * reader has to finish before learning there is a rule in it; "No Google Pay,
 * PhonePe or Paytm." is the rule, and what follows is why. Seven of these get
 * scanned rather than read, and a reader who stops at the dark half has still
 * read the half that matters.
 *
 * ⚠️ FULL WIDTH, in columns that fill it. Capped at 420px beside a beneficiary
 * table that is often absent, every item broke into four or five short lines
 * with a word stranded on the last — prose set to a measure nothing else on the
 * page uses. `auto-fit` lays them two or three up on a desktop and one up on a
 * phone, and no line breaks mid-clause.
 *
 * ⚠️ An OUTLINED block with amber markers, not a filled one. The block above
 * the figures is the one instruction that costs money to ignore and it is
 * filled so it wins; these are reference — true, worth having, read once — and
 * two filled blocks on one page would leave neither of them louder.
 */
function NotesPanel() {
  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        padding: '11px 14px 13px',
        borderRadius: 'var(--r3)',
        border: '1px solid var(--line)',
      }}
    >
      <PanelTitle icon='info'>Before you transfer</PanelTitle>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
          gap: '8px 26px',
        }}
      >
        {NOTES.map(([rule, why]) => (
          <Note key={rule} rule={rule} why={why} />
        ))}
      </ul>
    </div>
  );
}

/** The rule in the page's own colour, the reason after it in the muted one. */
function Note({ rule, why }: { rule: string; why: string }) {
  return (
    <li style={{ display: 'flex', gap: 9, fontSize: 12.5, lineHeight: 1.55 }}>
      <span
        aria-hidden
        style={{
          // Nudged to the middle of the first line rather than sat on its
          // baseline, which is where a flex row would otherwise park it.
          flex: '0 0 auto',
          width: 5,
          height: 5,
          marginTop: 7,
          borderRadius: '50%',
          background: 'var(--warn)',
        }}
      />
      <span style={{ color: 'var(--mfg)' }}>
        <strong style={{ color: 'var(--fg)', fontWeight: 600 }}>{rule}</strong> {why}
      </span>
    </li>
  );
}

const NOTES: ReadonlyArray<readonly [rule: string, why: string]> = [
  ['NEFT or RTGS only.', 'Cash, cheque and DD are not accepted into these accounts.'],
  [
    'No Google Pay, PhonePe or Paytm.',
    'They do not send the remitter details, so we cannot tell whose payment it is.',
  ],
  [
    'Add the beneficiary on your bank’s desktop site.',
    'Many banking apps will not accept letters in the account number field.',
  ],
  ['HDFC account holders', 'can add it under “Add Beneficiary — ECMS code”.'],
  ['Transfer from one account only,', 'so the payment can be reconciled.'],
  [
    'These accounts are issued to you alone.',
    'Please do not share them or pay into any other account.',
  ],
  ['Once you have paid, add the payment details here', 'so Finance can match it.'],
];

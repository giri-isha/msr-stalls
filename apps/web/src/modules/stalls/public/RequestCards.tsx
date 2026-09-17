import { useState } from 'react';
import { Link } from 'react-router';
import {
  type PendingStep,
  type CouponSummary,
  type PaymentClaimView,
  type PublicPaymentDue,
  type PublicRequestStatus,
  type SubmittedSection,
  formatInr,
  isSelfServe,
} from '@stalls/core';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { PaymentClaim } from './PaymentClaim';
import { Copyable, Panel, Row } from './portal-ui';
import { formatDate } from '../hooks';
import { Btn, Card, Icon, Tag, useIsMobile, useToast } from '../ui';

/**
 * A requester's own requests, drawn the same way whichever credential got them
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
 * read. What this file decides is only where a block SITS.
 *
 * 🔴 The three letters — selection, payment details, FSSAI-and-staff — are what
 * used to carry a requester from one step to the next, and a requester who
 * never got one, or lost it, was stuck. They still go out. They are no longer
 * the only route: every figure and every code they carry is on this page too.
 */
export interface RequestCardsProps {
  requests: PublicRequestStatus[];
  /** Mints the link for one self-serve step. Called on the CLICK — see below. */
  openStep(reference: string, step: 'BANK_FORM' | 'FSSAI'): Promise<{ url: string }>;
  /** Issues the staff coupon, or returns the one already issued. Idempotent. */
  getCoupon(reference: string): Promise<{ code: string }>;
  /** Re-reads the requests. ⚠️ Needed because reporting a transfer changes what
   *  this page should show — the claim appears in the list beneath the figures —
   *  and a page that did not re-read would leave the requester unsure whether
   *  it had been received, which is exactly the doubt the mailbox created. */
  reload(): void;
}

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Received. The stall team will review it.',
  SHORTLISTED: 'Under consideration.',
  // 🔴 This used to end "Further instructions will follow by email", which was
  // both the plan and the problem: it pointed at an inbox as the only way
  // forward, and a requester whose letter never arrived had nowhere else to
  // look. What happens next is the list underneath, which they can now act on.
  SELECTED: 'Selected. Anything still outstanding is listed below.',
  BACKUP: 'On the backup list — you will be contacted if a stall frees up.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

export function RequestCards({ requests, openStep, getCoupon, reload }: RequestCardsProps) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {requests.map((r) => (
        <RequestCard
          key={r.reference}
          request={r}
          openStep={openStep}
          getCoupon={getCoupon}
          reload={reload}
        />
      ))}
    </div>
  );
}

/**
 * One request.
 *
 * 🔴 Three BANDS, where this was one column of stacked blocks. The card had
 * grown a reference, a name, a status sentence, an allocation plate, a chip
 * list with the payment figures under it and the staff coupon under that —
 * eleven things in one flow, with nothing but vertical gaps saying which
 * belonged to which. The identity is a header on its own rail, what is
 * outstanding is the body, and what the requester filled in is a section they
 * open. The status pill sits in the header, level with the name it describes,
 * rather than floating to the right of the whole stack.
 */
function RequestCard({
  request: r,
  openStep,
  getCoupon,
  reload,
}: {
  request: PublicRequestStatus;
} & Omit<RequestCardsProps, 'requests'>) {
  const mobile = useIsMobile();
  const outstanding = r.pending.length > 0 || r.staff !== null;

  return (
    <Card pad={0}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          padding: mobile ? '14px 16px' : '16px 18px',
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
              fontSize: mobile ? 16 : 18,
              fontWeight: 600,
              letterSpacing: '-.2px',
              marginTop: 1,
            }}
          >
            {r.stallName}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 3 }}>
            {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted {formatDate(r.submittedAt)}
          </div>
        </div>
        <StatusPill status={r.status} />
      </header>

      <div style={{ padding: mobile ? '14px 16px' : '16px 18px' }}>
        <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>{STATUS_COPY[r.status]}</p>
        {r.allocatedStalls.length > 0 && (
          // The allocation is the one fact on this page a vendor comes back
          // for, so it gets its own plate rather than a line of body text
          // among the rest.
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 12,
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
        {/* ⚠️ Both blocks draw nothing at all unless the API said there is
            something to do, which is why this whole div can be empty and the
            padding above still has to look deliberate. */}
        <Pending request={r} openStep={openStep} reload={reload} />
        <Staff request={r} getCoupon={getCoupon} />
        {!outstanding && r.status === 'SELECTED' && (
          <p style={{ fontSize: 12.5, color: 'var(--mfg)', margin: '12px 0 0', lineHeight: 1.6 }}>
            Nothing is outstanding on this request.
          </p>
        )}
      </div>

      <Submitted sections={r.submitted} />
    </Card>
  );
}

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
 * ⚠️ CLOSED to begin with. The page's job on arrival is to say what has been
 * decided and what is outstanding; a full application unfolded above that would
 * bury both. It is a `<details>` rather than a button and a piece of state
 * because that is the element for exactly this — it opens with no script, and a
 * browser's find-in-page can reach inside it.
 */
function Submitted({ sections }: { sections: SubmittedSection[] | undefined }) {
  const mobile = useIsMobile();
  // ⚠️ `undefined` is tolerated, not just empty. The contract says this block
  // is always there, but the API and the web are deployed separately — a page
  // served ahead of the API that fills it would otherwise throw here and take
  // the whole card down, hiding the status a requester came for over a section
  // they had not opened.
  if (!sections || sections.length === 0) return null;

  return (
    <details style={{ borderTop: '1px solid var(--line)' }}>
      <summary
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: mobile ? '12px 16px' : '13px 18px',
          cursor: 'pointer',
          fontSize: 12.5,
          fontWeight: 700,
          color: 'var(--mfg)',
          listStyle: 'none',
        }}
      >
        <Icon name='clipboard-list' size={14} />
        What you submitted
        <span style={{ flex: 1 }} />
        {/* The chevron turns over when the block opens — the one rule for that
            is in `tokens.css`, beside the two browser defaults a `<details>`
            has to have taken off it. */}
        <span className='stalls-chev' style={{ display: 'flex', color: 'var(--mfg)' }}>
          <Icon name='chevron-down' size={14} />
        </span>
      </summary>
      <div
        style={{
          display: 'grid',
          gap: 16,
          padding: mobile ? '14px 16px 16px' : '16px 18px 20px',
          // The read-back sits on the same rail as the header, so an open
          // section reads as a second zone of the card rather than as more of
          // the body it hangs under.
          background: 'var(--rail)',
          borderTop: '1px solid var(--line)',
          borderRadius: '0 0 var(--r4) var(--r4)',
        }}
      >
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
            {/* ⚠️ `auto-fill`, not `auto-fit`, and the reason is the one
                `Facts` gives: `auto-fit` collapses the tracks no cell landed
                in, so a block of two answers would stretch across the full
                width while the block above it — four answers, four tracks —
                kept a narrower column, and the two would read as different
                grids. */}
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
    </details>
  );
}

/**
 * What is still outstanding on a selected stall, and the way into each step.
 *
 * BANK_FORM and FSSAI open a form on a freshly minted link — see `isSelfServe`.
 * PAYMENT opens nothing, because money arrives by NEFT and Finance confirms it;
 * what it needs is not a button but the figures, which are here now rather than
 * only in the letter. STAFF_REGISTRATION is handled by `Staff` below, which
 * has to be able to draw itself when there is no chip at all.
 *
 * The link is minted on the click, not when the page loads. Rendering the list
 * would otherwise mint a bank-form link every time the page was refreshed.
 */
function Pending({
  request,
  openStep,
  reload,
}: {
  request: PublicRequestStatus;
  openStep: RequestCardsProps['openStep'];
  reload: RequestCardsProps['reload'];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const steps = request.pending;

  if (steps.length === 0) return null;

  const open = async (step: 'BANK_FORM' | 'FSSAI') => {
    setBusy(step);
    try {
      const { url } = await openStep(request.reference, step);
      // A whole-page navigation, not a router push: the URL is built by the
      // shell (the host decides where these pages live) and carries a token
      // this page has never seen.
      window.location.assign(url);
    } catch (e) {
      toast.fail(e);
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 8, justifyItems: 'start' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mfg)' }}>Still to do</div>
      {steps.map((p) => (
        <Step
          key={p.step}
          step={p}
          reference={request.reference}
          payment={request.payment}
          claims={request.paymentClaims}
          busy={busy}
          onOpen={() => void open(p.step as 'BANK_FORM' | 'FSSAI')}
          onClaimed={reload}
        />
      ))}
    </div>
  );
}

/** One chip, with whatever that step needs sitting under it. */
function Step({
  step,
  reference,
  payment,
  claims,
  busy,
  onOpen,
  onClaimed,
}: {
  step: PendingStep;
  reference: string;
  payment: PublicPaymentDue | null;
  claims: PaymentClaimView[];
  busy: string | null;
  onOpen(): void;
  onClaimed(): void;
}) {
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag tone='warn' size='sm'>
          <Icon name='clock' size={12} /> {step.label}
        </Tag>
        {isSelfServe(step.step) && (
          <Btn kind='primary' onClick={onOpen} disabled={busy !== null}>
            {busy === step.step ? 'Opening…' : 'Open the Form'}
            <Icon name='chevron-right' size={14} />
          </Btn>
        )}
      </div>
      {step.step === 'PAYMENT' && payment && <PaymentDue payment={payment} />}
      {/* 🔴 Reporting the transfer, where the 2025 letter said to send an email.
          Offered even with no quote yet: a requester who paid against a letter
          can still tell us, and finance would rather have the reference than a
          mailbox. */}
      {step.step === 'PAYMENT' && (
        <PaymentClaim
          reference={reference}
          payment={payment}
          claims={claims}
          onSubmitted={onClaimed}
        />
      )}
    </div>
  );
}

/**
 * What is owed and where to send it — the payment-details letter, on the page.
 *
 * 🔴 ONE fee, and it is what is OWED. Where the team agreed a concession, that
 * is the figure here and it is the figure `paymentConfirmed` settles against,
 * so a trader who pays what this panel asks for actually clears the step. The
 * rate they were quoted before the concession is not shown beside it.
 *
 * ⚠️ Absent entirely until Finance has quoted. "Payment pending" with no figure
 * is honest; a number invented on this page would not be.
 *
 * ⚠️ An account number can be null — an edition with no virtual-account prefix,
 * or a contact that is not a mobile. The row says to ask rather than printing a
 * blank where an account number should be, because a vendor transferring to a
 * half-remembered account is the expensive failure here.
 */
function PaymentDue({ payment }: { payment: PublicPaymentDue }) {
  return (
    <Panel>
      <Row k='Fee, including GST' v={formatInr(payment.feePaise)} />
      <Row k='Refundable deposit' v={formatInr(payment.depositPaise)} />
      <Row k='Total to transfer' v={formatInr(payment.totalPaise)} strong />
      <AccountRow k='Fee, to account' account={payment.virtualAccountRent} />
      <AccountRow k='Deposit, to account' account={payment.virtualAccountDeposit} />
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--mfg)', lineHeight: 1.6 }}>
        These accounts are issued to you alone, which is how we identify your payment. Please do not
        pay into any other account, and please keep the reference number.
      </p>
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

/**
 * The vendor's own team, and the coupon they register against.
 *
 * ⚠️ "STAFF" throughout, never "backoffice". The backoffice is the stall TEAM —
 * the people running the event — and "staff" is the vendor's own, the people
 * who will stand at their stall. One word used for both is how a privilege
 * named for one gets read as the other, and this block, which a vendor reads,
 * had drifted into calling their own team a backoffice. The rule is in the
 * README; `STEP_LABEL` in `@stalls/core` carries the other half of it.
 *
 * 🔴 This block is why the work exists. `pendingSteps` emits
 * STAFF_REGISTRATION only once a coupon has been ISSUED — `staffExpected` is
 * the coupon's capacity — and a coupon was issued only by a backoffice member
 * pressing a button or sending the FSSAI-and-staff letter. A vendor who never
 * received that letter saw no chip, had no code, and could not register the
 * people who would be standing at their stall. Staff registration is the one
 * step the Flow Builder cannot switch off, because an unregistered person
 * cannot be let onto the venue.
 *
 * So: no coupon is not a dead end, it is a button.
 *
 * ⚠️ The tone is deliberate. When there IS a chip, this sits under it and the
 * chip carries the warning. When there is not, this draws its own heading and a
 * NEUTRAL tag — because `pendingSteps` has said nothing is outstanding, and a
 * warn-tone chip invented here would be this page deciding that for itself,
 * which is the one thing it must never do.
 *
 * ⚠️ The coupon is a credential — anyone holding it can add a person to this
 * stall's roster. Showing it to the account holder is exactly right: they are
 * the person who forwards it to their own team. It goes no further than a page
 * that already required their session or their signed link.
 */
function Staff({
  request,
  getCoupon,
}: {
  request: PublicRequestStatus;
  getCoupon: RequestCardsProps['getCoupon'];
}) {
  const toast = useToast();
  const [issued, setIssued] = useState<CouponSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const staff = request.staff;
  if (!staff) return null;

  // 🔴 A LIST. The team can issue a stall more than one live code — a caterer's
  // beside the vendor's own — and the vendor sees every one of them, because
  // every registration made on any of them lands on THEIR roster and is counted
  // against their stall at the gate.
  const coupons = staff.coupons.length > 0 ? staff.coupons : issued;
  const steps = request.pending;
  const outstanding = steps.find((p) => p.step === 'STAFF_REGISTRATION');
  // ⚠️ This block is drawn AFTER the chip list, so it reads as hanging off the
  // staff chip only while that chip is the LAST one — which it is, because
  // `pendingSteps` emits the steps in the order a requester meets them and
  // staff registration comes last. Checked rather than assumed: if that order
  // ever changes, this falls back to its own heading instead of quietly
  // attaching itself to whichever chip happens to have ended up at the bottom.
  const attached = steps[steps.length - 1]?.step === 'STAFF_REGISTRATION';

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

  const body =
    coupons.length > 0 ? (
      <Panel>
        {/* 🔴 The FIGURES first, then the buttons. Each coupon used to carry its
            own Register button inline, between its code and the counts below
            it — so a 36px control sat in the middle of a list of label-and-value
            rows and broke the one thing that made them readable as a list. The
            rows are a block now and the ways in are a row of their own under
            them. */}
        {coupons.map((c) => (
          <Coupon key={c.id} coupon={c} sole={coupons.length === 1} />
        ))}
        <Row k='Registered' v={`${staff.registered}`} />
        {/* ⚠️ "N of 8" read as a quota — which is what had a vendor believing
          they still owed the stall team five more people. The cap is a ceiling
          the gate enforces, and the backoffice already words it this way. */}
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
            // An in-app route, so a router push — the coupon page is the same
            // application and a full reload would throw away the session it is
            // already holding.
            //
            // ⚠️ Each code gets its OWN button, named by the code once there is
            // more than one. Where a stall holds two, the vendor is forwarding
            // one to their kitchen team and the other to a caterer, and a single
            // button beside a list of codes would not say which is which.
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
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--mfg)', lineHeight: 1.6 }}>
          Register only the people who will actually be working on your stall — there is no need to
          use up the whole allowance. Share a coupon with your own team only; everyone who registers
          with it is recorded against your stall.
        </p>
      </Panel>
    ) : (
      <Panel>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>
          Everyone working on your stall has to be registered before they can be given a pass. Your
          coupon is the key they register with.
        </p>
        <div>
          <Btn kind='primary' onClick={() => void issue()} disabled={busy}>
            {busy ? 'Getting your coupon…' : 'Get Your Coupon'}
            <Icon name='chevron-right' size={14} />
          </Btn>
        </div>
      </Panel>
    );

  // Attached: the chip above already said this is outstanding, so the panel
  // simply hangs off it and says nothing about urgency of its own.
  if (attached) return <div style={{ marginTop: -4 }}>{body}</div>;

  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 8, justifyItems: 'start' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mfg)' }}>Staff Requests</div>
      {/* ⚠️ The tone follows `pending`, never this component's own opinion.
          Warn only where the API said the step is outstanding; neutral when it
          said nothing — which is the ordinary case before a coupon exists,
          since nobody can register against one that has not been issued. */}
      <Tag tone={outstanding ? 'warn' : 'neutral'} size='sm'>
        <Icon name={outstanding ? 'clock' : 'users'} size={12} />{' '}
        {outstanding?.label ?? 'Staff registration'}
      </Tag>
      {body}
    </div>
  );
}

/** One coupon, as two rows: the code to forward, and — where a stall holds
 *  more than one — how far that particular code has got. The way IN sits with
 *  the other buttons under the whole block; see the note there. */
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

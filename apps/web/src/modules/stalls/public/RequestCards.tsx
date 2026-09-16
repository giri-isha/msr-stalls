import { useState } from 'react';
import { Link } from 'react-router';
import {
  type PendingStep,
  type CouponSummary,
  type PublicPaymentDue,
  type PublicRequestStatus,
  formatInr,
  isSelfServe,
} from '@msr/stalls';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { formatDate } from '../hooks';
import { Btn, Card, Icon, Tag, useToast } from '../ui';

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

export function RequestCards({ requests, openStep, getCoupon }: RequestCardsProps) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {requests.map((r) => (
        <Card key={r.reference}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div
                style={{
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                  fontSize: 11.5,
                  color: 'var(--mfg)',
                }}
              >
                {r.reference}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{r.stallName}</div>
              <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>
                {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted {formatDate(r.submittedAt)}
              </div>
              <p style={{ fontSize: 13, margin: '10px 0 0', lineHeight: 1.6 }}>
                {STATUS_COPY[r.status]}
              </p>
              {r.allocatedStalls.length > 0 && (
                // The allocation is the one fact on this page a vendor comes
                // back for, so it gets its own plate rather than a line of
                // body text among the rest.
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 10,
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
              <Pending request={r} openStep={openStep} />
              <Backoffice request={r} getCoupon={getCoupon} />
            </div>
            <StatusPill status={r.status} />
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * What is still outstanding on a selected stall, and the way into each step.
 *
 * BANK_FORM and FSSAI open a form on a freshly minted link — see `isSelfServe`.
 * PAYMENT opens nothing, because money arrives by NEFT and Finance confirms it;
 * what it needs is not a button but the figures, which are here now rather than
 * only in the letter. STAFF_REGISTRATION is handled by `Backoffice` below,
 * which has to be able to draw itself when there is no chip at all.
 *
 * The link is minted on the click, not when the page loads. Rendering the list
 * would otherwise mint a bank-form link every time the page was refreshed.
 */
function Pending({
  request,
  openStep,
}: {
  request: PublicRequestStatus;
  openStep: RequestCardsProps['openStep'];
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
          payment={request.payment}
          busy={busy}
          onOpen={() => void open(p.step as 'BANK_FORM' | 'FSSAI')}
        />
      ))}
    </div>
  );
}

/** One chip, with whatever that step needs sitting under it. */
function Step({
  step,
  payment,
  busy,
  onOpen,
}: {
  step: PendingStep;
  payment: PublicPaymentDue | null;
  busy: string | null;
  onOpen(): void;
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
function Backoffice({
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
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--mfg)', lineHeight: 1.6 }}>
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
    <div style={{ marginTop: 12, display: 'grid', gap: 8, justifyItems: 'start' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mfg)' }}>Your backoffice</div>
      {/* ⚠️ The tone follows `pending`, never this component's own opinion.
          Warn only where the API said the step is outstanding; neutral when it
          said nothing — which is the ordinary case before a coupon exists,
          since nobody can register against one that has not been issued. */}
      <Tag tone={outstanding ? 'warn' : 'neutral'} size='sm'>
        <Icon name={outstanding ? 'clock' : 'users'} size={12} />{' '}
        {outstanding?.label ?? 'Backoffice registration'}
      </Tag>
      {body}
    </div>
  );
}

/**
 * One coupon: the code, and the way into the registration page with it.
 *
 * ⚠️ Each code gets its own button. Where a stall holds two, the vendor is
 * forwarding one to their kitchen team and the other to a caterer, and a single
 * button next to a list of codes would not say which is which.
 */
function Coupon({ coupon, sole }: { coupon: CouponSummary; sole: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'start', width: '100%' }}>
      <Row k='Coupon' v={<Copyable value={coupon.code} label='Coupon' />} />
      {!sole && coupon.capacity > 0 && (
        <Row k='On this code' v={`${coupon.registered} registered, up to ${coupon.capacity}`} />
      )}
      <div style={{ marginTop: 2 }}>
        {/* An in-app route, so a router push — the coupon page is the same
            application and a full reload would throw away the session it is
            already holding. */}
        <Link to={`/stalls/staff/${encodeURIComponent(coupon.code)}`} style={{ color: 'inherit' }}>
          <Btn kind='primary'>
            Register Backoffice
            <Icon name='chevron-right' size={14} />
          </Btn>
        </Link>
      </div>
    </div>
  );
}

/** The plate a step's detail sits on — one look for the payment figures and the
 *  coupon, so the card reads as one thing rather than two panels that grew
 *  separately. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        justifyItems: 'start',
        width: '100%',
        maxWidth: 460,
        padding: '10px 12px',
        borderRadius: 'var(--r2)',
        background: 'var(--mut)',
        border: '1px solid var(--bd)',
      }}
    >
      {children}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        width: '100%',
        fontSize: 12.5,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: 132, flex: 'none', color: 'var(--mfg)' }}>{k}</div>
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
function Copyable({ value, label }: { value: string; label: string }) {
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

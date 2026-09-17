import type { CouponSummary, CouponView, PublicRequestStatus } from '@stalls/core';
import { useState } from 'react';
import { getCoupon } from '../api';
import { useLoad } from '../hooks';
import { Btn, Icon, Loading, Tag, useIsMobile, useToast } from '../ui';
import { Roster, StaffRegisterDialog } from './StaffRegistration';
import { Panel, PanelTitle, Row } from './portal-ui';

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
 * 🔴 The coupon is drawn as a TICKET — the code set large on a dashed plate
 * with Copy and Share beside it — because forwarding it is the whole job of
 * this tab. It was one row of eight, in the same 12.5px as "Registered: 3",
 * and the vendor's kitchen team received it as a screenshot with the wrong
 * line circled. What is forwarded most gets the shape of a thing you forward.
 *
 * ⚠️ The warn tag follows `pending`, never this tab's own opinion. Nothing
 * here says a chore is outstanding unless the API did.
 *
 * ⚠️ The coupon is a credential — anyone holding it can add a person to this
 * stall's roster. Showing it to the account holder is exactly right: they are
 * the person who forwards it to their own team. The WhatsApp share sends the
 * code and the registration link, nothing else about the stall.
 */
export function StaffTab({
  request,
  getCoupon,
  reload,
}: {
  request: PublicRequestStatus;
  getCoupon(reference: string): Promise<{ code: string }>;
  /** Re-reads the request after the dialog has registered somebody — the count
   *  under the ticket and the mark on the section are read off it. */
  reload(): void;
}) {
  const mobile = useIsMobile();
  const toast = useToast();
  const [issued, setIssued] = useState<CouponSummary[]>([]);
  const [busy, setBusy] = useState(false);
  // Which coupon the modal is filling in against, or nothing.
  const [registering, setRegistering] = useState<string | null>(null);
  // Bumped when the modal closes, to re-read the roster below it.
  const [round, setRound] = useState(0);

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
    <div style={{ display: 'grid', gap: 14 }}>
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
          gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 1.2fr) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {coupons.length > 0 ? (
          <Panel>
            <PanelTitle icon='users'>
              {coupons.length === 1 ? 'Your coupon' : 'Your coupons'}
            </PanelTitle>
            <div style={{ display: 'grid', gap: 10, width: '100%' }}>
              {coupons.map((c) => (
                <Ticket
                  key={c.id}
                  coupon={c}
                  sole={coupons.length === 1}
                  stall={request.stallName}
                  onRegister={() => setRegistering(c.code)}
                />
              ))}
            </div>
            <div style={{ display: 'grid', gap: 4, width: '100%', marginTop: 6 }}>
              <Row k='Registered' v={`${staff.registered}`} />
              {/* ⚠️ "N of 8" read as a quota — which is what had a vendor
                  believing they still owed the stall team five more people.
                  The cap is a ceiling the gate enforces, and the backoffice
                  words it this way. */}
              {staff.capacity > 0 && (
                <Row
                  k={coupons.length === 1 ? 'Your coupon admits' : 'Your coupons admit'}
                  v={`up to ${staff.capacity} ${staff.capacity === 1 ? 'person' : 'people'}`}
                />
              )}
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
            themselves with it. Register only those who will actually be there — there is no need to
            use up the whole allowance. Share it with your own team only: everyone who registers
            with it is recorded against your stall.
          </p>
        </Panel>
      </div>
      {coupons.length > 0 && (
        <RegisteredStaff
          coupons={coupons}
          capacity={staff.capacity}
          round={round}
          onAdd={() => setRegistering(coupons[0].code)}
        />
      )}
      {registering && (
        <StaffRegisterDialog
          code={registering}
          onClose={() => {
            setRegistering(null);
            setRound((n) => n + 1);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * The people who are actually registered against this stall.
 *
 * 🔴 The section said "Registered: 3" and nothing else, which is the one fact
 * about their own team a vendor cannot check: whether the three are the three
 * they meant, whether the cook they told to register did, whether somebody
 * registered twice. The number was also the whole answer to a question the
 * counter asks them at check-in.
 *
 * ⚠️ Read from the COUPONS, not from the request. The request's staff block
 * carries the count and the capacity; the roster hangs off the coupon route,
 * which the portal may call because it is holding the codes already. Nothing
 * is sent that the vendor could not read by opening the coupon link they
 * forward to their own team, and it arrives masked either way.
 *
 * ⚠️ POOLED across codes. A stall holding a vendor's code and a caterer's has
 * one team, and the count beside it is the stall's. Newest last, the order
 * they walked up in.
 *
 * ⚠️ A failure here draws NOTHING rather than an error. The count and the
 * coupon are already on screen and still true; a red box about a list that
 * was extra to begin with would read as something being wrong with the
 * registrations themselves.
 */
function RegisteredStaff({
  coupons,
  capacity,
  round,
  onAdd,
}: {
  coupons: CouponSummary[];
  capacity: number;
  /** Changes when the modal has been used, to re-read the list. */
  round: number;
  onAdd(): void;
}) {
  const codes = coupons.map((c) => c.code).join(',');
  const { data, error, loading } = useLoad(
    () => Promise.all(coupons.map((c) => getCoupon(c.code))),
    [codes, round],
  );

  if (loading) return <Loading />;
  if (error || !data) return null;

  const people = data
    .flatMap((c: CouponView) => c.staff)
    .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
  const full = capacity > 0 && people.length >= capacity;

  return (
    <Panel>
      <PanelTitle icon='users'>Who is registered</PanelTitle>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          width: '100%',
          marginBottom: 2,
        }}
      >
        <Tag tone={people.length > 0 ? 'ok' : 'neutral'} size='sm'>
          {people.length} registered
          {capacity > 0 ? ` of up to ${capacity}` : ''}
        </Tag>
        {/* ⚠️ Offered against the FIRST code where a stall holds several. The
            tickets above are where a vendor picks between them; this is the
            shortcut from the list they are already looking at. */}
        {!full && (
          <Btn onClick={onAdd}>
            <Icon name='user-plus' size={14} />
            Register Someone
          </Btn>
        )}
      </div>
      <Roster staff={people} />
      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
        Mobile numbers are shown in part only. Everyone here has to carry the ID they registered
        with to the counter.
      </p>
    </Panel>
  );
}

/** Where a coupon holder registers — the same in-app route the button below
 *  pushes to, made absolute so it survives being pasted into a chat. */
function registerUrl(code: string): string {
  const path = `/stalls/staff/${encodeURIComponent(code)}`;
  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();
}

/**
 * One coupon, as the ticket it is: the code large, and the three things a
 * vendor does with it — copy it, send it, or register somebody themselves.
 *
 * ⚠️ The code is drawn ONCE, in the ticket. The Register Staff button names it
 * only where there is more than one, so the vendor forwarding one to their
 * kitchen and the other to a caterer can tell the buttons apart.
 *
 * ⚠️ The clipboard is not always there — an insecure origin, an older browser,
 * a denied permission — so a failure says to copy it by hand rather than doing
 * nothing. The code is on screen either way.
 */
function Ticket({
  coupon,
  sole,
  stall,
  onRegister,
}: {
  coupon: CouponSummary;
  sole: boolean;
  stall: string;
  onRegister(): void;
}) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      toast.ok('Coupon copied.');
    } catch {
      toast.fail(new Error('Could not copy. Please select the coupon and copy it.'));
    }
  };
  const message =
    `Staff registration for ${stall}. Register yourself with coupon ${coupon.code} at ` +
    registerUrl(coupon.code);

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        width: '100%',
        padding: '14px 16px',
        borderRadius: 'var(--r3)',
        border: '1.5px dashed var(--pri)',
        background: 'var(--pri-t)',
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--info-fg)',
          }}
        >
          Staff coupon
        </span>
        <span
          style={{
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '.06em',
            wordBreak: 'break-all',
            lineHeight: 1.2,
          }}
        >
          {coupon.code}
        </span>
        {!sole && coupon.capacity > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
            {coupon.registered} registered, up to {coupon.capacity}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Btn onClick={() => void copy()}>
          <Icon name='copy' size={14} />
          Copy
        </Btn>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target='_blank'
          rel='noreferrer'
          style={{ color: 'inherit' }}
        >
          <Btn>
            <Icon name='message-circle' size={14} />
            Share on WhatsApp
          </Btn>
        </a>
        {/* 🔴 A MODAL, not a page. The vendor is already signed in and looking
            at the section this belongs to; sending them to the coupon URL threw
            the portal away, looked the code up again, and left them to find
            their way back. The page is still there for the team they forward
            the coupon to — see `StaffRegisterDialog`. */}
        <Btn kind='primary' onClick={onRegister}>
          <Icon name='user-plus' size={14} />
          Register Staff
          {!sole && ` · ${coupon.code}`}
        </Btn>
      </div>
    </div>
  );
}

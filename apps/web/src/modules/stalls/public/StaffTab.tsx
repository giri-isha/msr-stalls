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

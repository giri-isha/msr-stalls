import { useParams } from 'react-router';
import { ApiError } from '../api-client';
import { getStaffView } from '../api';
import { useLoad } from '../hooks';
import { Card, Empty, H1, KV, Loading } from '../ui/ui';

/** The vendor's staff-registration coupon and where to use it. Registration
 *  itself happens in the external Sewadhar system; this page hands over the
 *  key and says how many staff it admits. */
export function StaffPage() {
  const { token = '' } = useParams();
  const { data: v, error, loading } = useLoad(() => getStaffView(token), [token]);
  if (loading) return <Loading />;
  if (error || !v) {
    const nf = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        <Empty>{nf ? 'This link is not valid. Please use the link from your email.' : 'Something went wrong. Please try again.'}</Empty>
      </Card>
    );
  }
  return (
    <div>
      <H1 sub={`${v.stallName} · ${v.reference}${v.stallNumbers.length ? ` · Stall ${v.stallNumbers.join(', ')}` : ''}`}>
        Staff registration
      </H1>
      <Card>
        {v.couponCode ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--mfg)', marginBottom: 6 }}>Your coupon code — keep it private</div>
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '1px',
                padding: '14px 18px',
                borderRadius: 'var(--r3)',
                background: 'var(--pri-t)',
                color: 'var(--pri)',
                display: 'inline-block',
                marginBottom: 14,
              }}
            >
              {v.couponCode}
            </div>
            <KV k='Staff admitted' v={`${v.registeredCount} registered of ${v.maxStaff}`} />
            <KV
              k='Where to register'
              v={
                v.staffRegistrationUrl ? (
                  <a href={v.staffRegistrationUrl} target='_blank' rel='noreferrer'>
                    {v.staffRegistrationUrl}
                  </a>
                ) : (
                  'The stall team will share the registration link.'
                )
              }
            />
            <KV
              k='How it works'
              v='Each staff member registers with their own details and a passport-size photo, and enters this coupon code. Passes are printed against your stall.'
            />
          </>
        ) : (
          <Empty>Your coupon has not been issued yet. It arrives by email once your payment is confirmed.</Empty>
        )}
      </Card>
    </div>
  );
}

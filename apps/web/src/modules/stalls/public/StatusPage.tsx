import { Link, useParams } from 'react-router';
import { ApiError } from '../api-client';
import { continueStep, getStatus, requestCoupon } from '../api';
import { useLoad } from '../hooks';
import { Card, H1, Icon, Loading } from '../ui';
import { RequestCards } from './RequestCards';

/**
 * The vendor's own portal.
 *
 * Reached only through the signed link in the receipt email — that link is the
 * whole of "logged in" here. A bad or expired token is a plain "not valid"
 * page, never a hint about why, with the one way forward a vendor has: ask for
 * a fresh link by the email or number they applied with.
 *
 * ⚠️ What is outstanding comes from the API's `pendingSteps`, the same function
 * the Onboarding table and the check-in counter call. This page must never
 * decide for itself what a vendor still owes — when it did, a vendor could be
 * told they were all set here and be stopped at the counter.
 */
export function StatusPage() {
  const { token = '' } = useParams();
  const { data, error, loading } = useLoad(() => getStatus(token), [token]);

  if (loading) return <Loading />;

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center' }}>
        <div
          style={{
            width: 44,
            height: 44,
            margin: '4px auto 14px',
            borderRadius: '50%',
            // ⚠️ `warn`, not `des`. A link that has expired is not the reader's
            // mistake and there is nothing here they broke; red would tell them
            // something went wrong with their request, which is the one thing
            // this page cannot say either way.
            background: 'var(--warn-t)',
            border: '1px solid var(--warn-b)',
            color: 'var(--warn)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name='alert-triangle' size={21} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {notFound ? 'This link is not valid' : 'Something went wrong'}
        </div>
        <p style={{ fontSize: 13, color: 'var(--mfg)', marginTop: 6, lineHeight: 1.6 }}>
          {notFound
            ? 'Please use the link from your most recent confirmation email.'
            : 'Please try again in a moment.'}
        </p>
        {notFound && (
          <p style={{ fontSize: 12.5, marginTop: 10 }}>
            <Link to='/stalls/status'>Email Me a New Link</Link>
          </p>
        )}
      </Card>
    );
  }

  return (
    <div>
      <H1 sub={data.displayName}>Your Stall Requests</H1>

      <RequestCards
        requests={data.requests}
        openStep={(reference, step) => continueStep(token, { reference, step })}
        getCoupon={(reference) => requestCoupon(token, { reference })}
      />
    </div>
  );
}

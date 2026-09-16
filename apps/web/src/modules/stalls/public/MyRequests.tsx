import { Link, Navigate } from 'react-router';
import { continueMyStep, getMyRequests, requestMyCoupon } from '../api';
import { useLoad } from '../hooks';
import { useRequester } from '../requester';
import { Btn, Card, H1, Icon, Loading } from '../ui';
import { RequestCards } from './RequestCards';

/**
 * A requester's own requests, reached by logging in.
 *
 * The same portal `StatusPage` serves, behind the other credential. A requester
 * who registered, applied and came back a week later asks one question — what
 * happened to my request? — and before this page the only answer was in their
 * inbox.
 *
 * ⚠️ No token anywhere: the session cookie is the whole credential, and the API
 * reads the account off it. A `reference` in the body of "open this step" picks
 * which of THAT account's requests is meant and can name no other.
 *
 * ⚠️ The gate is `useRequester()`, not a failed fetch. A signed-out reader is
 * sent to the login rather than shown an error, because arriving here signed
 * out is the ordinary case — a bookmark, or a session that quietly expired.
 */
export function MyRequests() {
  const { requester, status } = useRequester();

  if (status === 'loading') return <Loading />;
  if (!requester) return <Navigate to='/stalls/login' replace />;

  return <Loaded />;
}

/** Split out so the fetch begins only once there IS a session — a hook cannot
 *  sit behind the redirect above, and asking before then would spend a request
 *  to be told what `useRequester` already knows. */
function Loaded() {
  const { data, loading, reload } = useLoad(() => getMyRequests(), []);

  if (loading) return <Loading />;

  // ⚠️ An error is drawn as the empty state rather than as a failure. There is
  // nothing a requester can do about it, and "we could not load your requests"
  // beside a working link to the forms is the same page with more alarm in it.
  const requests = data?.requests ?? [];

  return (
    <div>
      {/* ⚠️ "My Requests", the words on the tab that got the reader here. The
          heading said "Your Stall Requests" while the nav said My Requests,
          and a page whose title is not the name of the thing you pressed is a
          page you check twice to be sure you arrived. The emailed-link portal
          keeps its own heading — `StatusPage` has no nav above it. */}
      <H1 icon={<Icon name='list-view' size={18} />} sub={data?.displayName ?? undefined}>
        My Requests
      </H1>

      {requests.length === 0 ? (
        <Card pad={18} style={{ display: 'grid', gap: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>You have not requested a stall yet</div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            Once you send one in, this page tells you where it has got to and which forms are still
            waiting on you.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Link to='/stalls/apply' style={{ color: 'inherit' }}>
              <Btn kind='primary'>
                <Icon name='ticket' size={14} />
                Request a Stall
              </Btn>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <RequestCards
            requests={requests}
            openStep={(reference, step) => continueMyStep({ reference, step })}
            getCoupon={(reference) => requestMyCoupon({ reference })}
            reload={reload}
          />
          <p style={{ fontSize: 12.5, color: 'var(--mfg)', marginTop: 20, lineHeight: 1.6 }}>
            Need another stall? <Link to='/stalls/apply'>Send in Another Request</Link>. A request
            is capped at what one decision can cover, so ground in a second area is a second
            request.
          </p>
        </>
      )}
    </div>
  );
}

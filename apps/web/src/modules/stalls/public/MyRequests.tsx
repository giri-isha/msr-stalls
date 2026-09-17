import { Link, Navigate } from 'react-router';
import { continueMyStep, getMyRequests, requestMyCoupon } from '../api';
import { useLoad } from '../hooks';
import { useRequester } from '../requester';
import { Btn, Card, H1, Icon, Loading } from '../ui';
import { RequestView } from './RequestView';

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
 *
 * ⚠️ The page IS titled, where it deliberately was not. The argument for no
 * heading was that the request's header band already names the request — true,
 * but it names ONE request, and a reader arriving from a form or a link has
 * nothing telling them which of the site's pages they are on. The forms link
 * back here by this name (`BackToRequests`), so the name has to be on the page
 * they land on.
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

  if (requests.length === 0) {
    return (
      <>
        <Heading />
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
      </>
    );
  }

  return (
    <>
      <Heading />
      <RequestView
        requests={requests}
        openStep={(reference, step) => continueMyStep({ reference, step })}
        getCoupon={(reference) => requestMyCoupon({ reference })}
        reload={reload}
      />
    </>
  );
}

/** The page's own name, top left — the one the forms link back to.
 *
 *  ⚠️ No actions on it. The way to a new request is the primary button in the
 *  shell's header, and a second one here would be the same offer twice. */
function Heading() {
  return (
    <H1
      icon={<Icon name='clipboard-list' size={18} />}
      sub='Where each of your requests has got to, and what is still waiting on you.'
    >
      My Requests
    </H1>
  );
}

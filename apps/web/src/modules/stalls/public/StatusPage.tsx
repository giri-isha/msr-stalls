import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { type PendingStep, isSelfServe } from '@msr/stalls';
import { ApiError } from '../api-client';
import { continueStep, getStatus } from '../api';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { formatDate, useLoad } from '../hooks';
import { Btn, Card, H1, Icon, Loading, Tag, useToast } from '../ui';

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Received. The stall team will review it.',
  SHORTLISTED: 'Under consideration.',
  SELECTED: 'Selected. Further instructions will follow by email.',
  BACKUP: 'On the backup list — you will be contacted if a stall frees up.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

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
            <Link to='/stalls/status'>Email me a new link</Link>
          </p>
        )}
      </Card>
    );
  }

  return (
    <div>
      <H1 sub={data.displayName}>Your stall requests</H1>

      <div style={{ display: 'grid', gap: 12 }}>
        {data.requests.map((r) => (
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
                  {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted{' '}
                  {formatDate(r.submittedAt)}
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
                <Pending token={token} reference={r.reference} steps={r.pending} />
              </div>
              <StatusPill status={r.status} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * What is still outstanding on a selected stall, and the way into the one form
 * the vendor can fill themselves.
 *
 * Only BANK_FORM and FSSAI get a button — see `isSelfServe`. Payment is
 * confirmed by Finance against a bank credit and staff register on a coupon the
 * vendor forwards to their own team, so a button on either would promise
 * something this page cannot do. Those still SHOW: a vendor who can see that
 * the team is waiting on a transfer is the point of the list.
 *
 * The link is minted on the click, not when the page loads. Rendering the list
 * would otherwise mint a bank-form link every time a vendor refreshed.
 */
function Pending({
  token,
  reference,
  steps,
}: {
  token: string;
  reference: string;
  steps: PendingStep[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (steps.length === 0) return null;

  const open = async (step: 'BANK_FORM' | 'FSSAI') => {
    setBusy(step);
    try {
      const { url } = await continueStep(token, { reference, step });
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
        <div
          key={p.step}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <Tag tone='warn' size='sm'>
            <Icon name='clock' size={12} /> {p.label}
          </Tag>
          {isSelfServe(p.step) && (
            <Btn
              kind='primary'
              onClick={() => void open(p.step as 'BANK_FORM' | 'FSSAI')}
              disabled={busy !== null}
            >
              {busy === p.step ? 'Opening…' : 'Open the form'}
              <Icon name='chevron-right' size={14} />
            </Btn>
          )}
        </div>
      ))}
    </div>
  );
}

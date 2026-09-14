import type { RequestStatus } from '@msr/stalls';
import { useParams } from 'react-router';
import { ApiError } from '../api-client';
import { getStatus } from '../api';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { Steps } from '../components/Steps';
import { formatDate, useLoad } from '../hooks';
import { Card, Empty, H1, Loading } from '../ui/ui';

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Received. The stall team will review it.',
  SHORTLISTED: 'Under consideration.',
  SELECTED: 'Selected. Follow the steps below.',
  BACKUP: 'On the backup list — you will be contacted if a stall frees up.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

function ActionLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 'var(--r2)',
        background: 'var(--pri)',
        color: 'var(--pfg)',
        fontWeight: 700,
        fontSize: 13,
        boxShadow: 'var(--sh-pri)',
      }}
    >
      {children}
    </a>
  );
}

/** Reached only through the signed link in the receipt email. A bad or
 *  expired token is a plain "not valid" page — never a hint about why. */
export function StatusPage() {
  const { token = '' } = useParams();
  const { data, error, loading } = useLoad(() => getStatus(token), [token]);

  if (loading) return <Loading />;
  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        <Empty>
          <div style={{ fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>
            {notFound ? 'This link is not valid' : 'Something went wrong'}
          </div>
          {notFound ? 'Please use the link from your most recent confirmation email.' : 'Please try again in a moment.'}
        </Empty>
      </Card>
    );
  }

  return (
    <div>
      <H1 sub={data.displayName}>Your stall requests</H1>
      <div style={{ display: 'grid', gap: 12 }}>
        {data.requests.map((r) => (
          <Card key={r.reference}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--mfg)' }}>{r.reference}</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{r.stallName}</div>
                <div style={{ fontSize: 12, color: 'var(--mfg)' }}>
                  {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted {formatDate(r.submittedAt)}
                </div>
              </div>
              <StatusPill status={r.status as RequestStatus} />
            </div>
            <p style={{ fontSize: 13.5, margin: '12px 0 0' }}>{STATUS_COPY[r.status]}</p>
            {r.allocatedStalls.length > 0 && (
              <p style={{ fontSize: 13.5, margin: '6px 0 0' }}>
                Stall{r.allocatedStalls.length > 1 ? 's' : ''}: <b>{r.allocatedStalls.join(', ')}</b>
              </p>
            )}
            {(r.steps ?? []).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <Steps steps={r.steps} />
              </div>
            )}
            {(r.bankFormUrl || r.fssaiUploadUrl || r.staffUrl || r.paymentDue) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
                {r.bankFormUrl && <ActionLink href={r.bankFormUrl}>Fill in bank & GST details</ActionLink>}
                {r.paymentDue && (
                  <span style={{ fontSize: 13 }}>
                    Payment due: <b>{r.paymentDue}</b> — see your payment email for NEFT details.
                  </span>
                )}
                {r.fssaiUploadUrl && <ActionLink href={r.fssaiUploadUrl}>Upload FSSAI certificate</ActionLink>}
                {r.staffUrl && <ActionLink href={r.staffUrl}>Staff registration</ActionLink>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

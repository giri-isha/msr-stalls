import { useParams } from 'react-router';
import { Card, CardContent } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api-client';
import { getStatus } from '../api';
import { StatusPill, TYPE_LABEL } from '../components/StatusPill';
import { formatDate, useLoad } from '../hooks';

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: 'Received. The stall team will review it.',
  SHORTLISTED: 'Under consideration.',
  SELECTED: 'Selected. Further instructions will follow by email.',
  BACKUP: 'On the backup list — you will be contacted if a stall frees up.',
  REJECTED: 'Not selected this year.',
  CANCELLED: 'Cancelled.',
};

/** Reached only through the signed link in the receipt email. A bad or
 *  expired token is a plain "not valid" page — never a hint about why. */
export function StatusPage() {
  const { token = '' } = useParams();
  const { data, error, loading } = useLoad(() => getStatus(token), [token]);

  if (loading) return <p className='text-sm text-ink-2'>Loading…</p>;
  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        <CardContent className='p-6 text-center'>
          <h1 className='text-lg font-semibold'>
            {notFound ? 'This link is not valid' : 'Something went wrong'}
          </h1>
          <p className='mt-1 text-sm text-ink-2'>
            {notFound
              ? 'Please use the link from your most recent confirmation email.'
              : 'Please try again in a moment.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold'>Your stall requests</h1>
        <p className='mt-1 text-sm text-ink-2'>{data.displayName}</p>
      </div>
      {data.requests.map((r) => (
        <Card key={r.reference}>
          <CardContent className='flex flex-wrap items-start justify-between gap-3 p-5'>
            <div className='min-w-0'>
              <div className='font-mono text-xs text-ink-2'>{r.reference}</div>
              <div className='text-base font-semibold'>{r.stallName}</div>
              <div className='text-xs text-ink-2'>
                {TYPE_LABEL[r.requestType] ?? r.requestType} · submitted {formatDate(r.submittedAt)}
              </div>
              <p className='mt-2 text-sm'>{STATUS_COPY[r.status]}</p>
              {r.allocatedStalls.length > 0 && (
                <p className='mt-1 text-sm'>
                  Stall{r.allocatedStalls.length > 1 ? 's' : ''}:{' '}
                  <span className='font-semibold'>{r.allocatedStalls.join(', ')}</span>
                </p>
              )}
            </div>
            <StatusPill status={r.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

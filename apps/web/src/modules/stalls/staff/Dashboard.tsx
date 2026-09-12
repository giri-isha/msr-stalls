import { Link } from 'react-router';
import { Card, CardContent } from '../../../components/ui/card';
import { getDashboard } from '../api';
import { STATUS_LABEL, TYPE_LABEL } from '../components/StatusPill';
import { useLoad } from '../hooks';

function Tile({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
}) {
  const body = (
    <Card className={to ? 'transition-colors hover:border-accent' : undefined}>
      <CardContent className='p-4'>
        <div className='text-xs font-medium uppercase tracking-wide text-ink-2'>{label}</div>
        <div className='mt-1 text-2xl font-bold'>{value}</div>
        {hint && <div className='mt-0.5 text-xs text-ink-3'>{hint}</div>}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function Dashboard() {
  const { data, error, loading } = useLoad(getDashboard);
  if (loading) return <p className='text-sm text-ink-2'>Loading…</p>;
  if (error || !data) return <p className='text-sm text-bad'>{error?.message}</p>;

  const s = data.byStatus;
  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-bold'>Dashboard</h1>
        <p className='text-sm text-ink-2'>Maha Shivratri · MSR Stalls Program</p>
      </div>

      <section>
        <h2 className='mb-2 text-sm font-semibold text-ink-2'>Requests</h2>
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          <Tile label='Total requests' value={data.total} to='/m/stalls/all' />
          {(['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'] as const).map((t) => (
            <Tile
              key={t}
              label={TYPE_LABEL[t]}
              value={data.byType[t] ?? 0}
              to={`/m/stalls/all?requestType=${t}`}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className='mb-2 text-sm font-semibold text-ink-2'>Selection</h2>
        <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
          {(['SUBMITTED', 'SHORTLISTED', 'SELECTED', 'BACKUP', 'REJECTED'] as const).map((st) => (
            <Tile
              key={st}
              label={STATUS_LABEL[st]}
              value={s[st] ?? 0}
              to={`/m/stalls/all?status=${st}`}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className='mb-2 text-sm font-semibold text-ink-2'>Stalls</h2>
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          <Tile label='Planned' value={data.stallsPlanned} to='/m/stalls/planning' />
          <Tile label='Allocated' value={data.stallsAllocated} />
          <Tile
            label='Flagged for follow-up'
            value={data.flagged}
            to='/m/stalls/all?flagged=true'
          />
        </div>
      </section>

      <section>
        <h2 className='mb-2 text-sm font-semibold text-ink-2'>Onboarding · Phase 2 and 3</h2>
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          <Tile label='Pending bank details' value='—' hint='Phase 2' />
          <Tile label='Pending payment' value='—' hint='Phase 2' />
          <Tile label='FSSAI pending' value='—' hint='Phase 3' />
          <Tile label='Not checked in' value='—' hint='Phase 3' />
        </div>
      </section>
    </div>
  );
}

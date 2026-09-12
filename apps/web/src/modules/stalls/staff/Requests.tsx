import type { ListRequestsQuery, RequestSummary } from '@msr/stalls';
import { Flag, LayoutGrid, List, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input, Select } from '../../../components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '../../../components/ui/table';
import { cn } from '../../../lib/cn';
import { listRequests } from '../api';
import { STATUS_LABEL, StatusPill, TYPE_LABEL, TypeBadge } from '../components/StatusPill';
import { formatDate } from '../hooks';
import { RequestDetail } from './RequestDetail';

type Mode = 'triage' | 'all';

/** "Stall Requests" (triage: what needs a decision, cards or table) and "All
 *  Requests" (the full pipeline table with every filter) are one screen with
 *  two presets — the prototype had both, and they read the same list. */
export function Requests({ mode }: { mode: Mode }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const requestType = params.get('requestType') ?? '';
  const status = params.get('status') ?? '';
  const stage = params.get('stage') ?? '';
  const zoneCode = params.get('zoneCode') ?? '';
  const flagged = params.get('flagged') === 'true';
  const [view, setView] = useState<'table' | 'cards'>(mode === 'triage' ? 'cards' : 'table');
  const [selected, setSelected] = useState<string | null>(null);

  const [items, setItems] = useState<RequestSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query: Partial<ListRequestsQuery> = {
    q: q || undefined,
    requestType: (requestType || undefined) as ListRequestsQuery['requestType'],
    status: (status || undefined) as ListRequestsQuery['status'],
    stage: (stage || undefined) as ListRequestsQuery['stage'],
    zoneCode: (zoneCode || undefined) as ListRequestsQuery['zoneCode'],
    flagged: flagged || undefined,
    limit: 50,
  };
  const key = JSON.stringify(query);

  const load = useCallback(
    async (append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await listRequests({
          ...query,
          cursor: append ? (cursor ?? undefined) : undefined,
        });
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: key is the serialised query
    [key, cursor],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the query changes
  useEffect(() => {
    void load(false);
  }, [key]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const onChanged = () => void load(false);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold'>
            {mode === 'triage' ? 'Stall Requests' : 'All Requests'}
          </h1>
          <p className='text-sm text-ink-2'>
            {mode === 'triage'
              ? 'Review, shortlist and select. Click a request to see its full application.'
              : 'Every request in the pipeline, with every filter.'}
          </p>
        </div>
        <div className='flex items-center gap-1 rounded-md border border-line bg-surface p-0.5'>
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size='sm'
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
            aria-label='Table view'
          >
            <List className='h-4 w-4' />
          </Button>
          <Button
            variant={view === 'cards' ? 'secondary' : 'ghost'}
            size='sm'
            onClick={() => setView('cards')}
            aria-pressed={view === 'cards'}
            aria-label='Card view'
          >
            <LayoutGrid className='h-4 w-4' />
          </Button>
        </div>
      </div>

      <div className='flex flex-wrap gap-2'>
        <div className='relative min-w-64 flex-1'>
          <Search className='pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-3' />
          <Input
            aria-label='Search'
            placeholder='Search by name, reference, email or phone…'
            className='pl-8'
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>
        <Select
          aria-label='Type'
          value={requestType}
          onChange={(e) => setParam('requestType', e.target.value)}
          className='w-44'
        >
          <option value=''>All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          aria-label='Status'
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
          className='w-40'
        >
          <option value=''>All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        {mode === 'all' && (
          <>
            <Select
              aria-label='Zone'
              value={zoneCode}
              onChange={(e) => setParam('zoneCode', e.target.value)}
              className='w-32'
            >
              <option value=''>All zones</option>
              {['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
            <Button
              variant={flagged ? 'secondary' : 'outline'}
              size='default'
              onClick={() => setParam('flagged', flagged ? '' : 'true')}
              aria-pressed={flagged}
            >
              <Flag className='h-4 w-4' /> Flagged
            </Button>
          </>
        )}
      </div>

      {error && (
        <p role='alert' className='text-sm text-bad'>
          {error}
        </p>
      )}

      {view === 'table' ? (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Stall</TH>
                <TH>Type</TH>
                <TH>Requester</TH>
                <TH>Zone</TH>
                <TH className='text-right'>Stalls</TH>
                <TH>Status</TH>
                <TH>Allocated</TH>
                <TH>Submitted</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((r) => (
                <TR
                  key={r.id}
                  className='cursor-pointer'
                  data-state={selected === r.id ? 'selected' : undefined}
                  onClick={() => setSelected(r.id)}
                >
                  <TD className='font-mono text-xs'>
                    {r.flagged && (
                      <Flag className='mr-1 inline h-3 w-3 text-warn' aria-label='Flagged' />
                    )}
                    {r.reference}
                  </TD>
                  <TD className='font-medium'>{r.stallName}</TD>
                  <TD>
                    <TypeBadge type={r.requestType} />
                  </TD>
                  <TD>
                    <div>{r.requesterName}</div>
                    <div className='text-xs text-ink-2'>{r.contactNumber}</div>
                  </TD>
                  <TD>{r.preferredZoneCode}</TD>
                  <TD className='text-right'>{r.numStallsRequested}</TD>
                  <TD>
                    <StatusPill status={r.status} />
                  </TD>
                  <TD className='font-mono text-xs'>{r.allocatedStalls.join(', ')}</TD>
                  <TD className='text-xs text-ink-2'>{formatDate(r.submittedAt)}</TD>
                </TR>
              ))}
              {!loading && items.length === 0 && (
                <TR>
                  <TD colSpan={9} className='py-10 text-center text-ink-2'>
                    No requests match.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </Card>
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {items.map((r) => (
            <button
              type='button'
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={cn('text-left', selected === r.id && '[&>div]:border-accent')}
            >
              <Card className='h-full transition-colors hover:border-accent'>
                <CardContent className='space-y-2 p-4'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <div className='font-mono text-xs text-ink-2'>
                        {r.flagged && <Flag className='mr-1 inline h-3 w-3 text-warn' />}
                        {r.reference}
                      </div>
                      <div className='truncate font-semibold'>{r.stallName}</div>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className='flex flex-wrap items-center gap-2 text-xs text-ink-2'>
                    <TypeBadge type={r.requestType} />
                    <span>{r.stallType === 'FOOD' ? 'Food' : 'Non-food'}</span>
                    <span>· {r.preferredZoneCode}</span>
                    <span>
                      · {r.numStallsRequested} stall{r.numStallsRequested > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className='text-sm'>
                    {r.requesterName} <span className='text-ink-2'>· {r.contactNumber}</span>
                  </div>
                  {r.allocatedStalls.length > 0 && (
                    <div className='font-mono text-xs text-good'>
                      {r.allocatedStalls.join(', ')}
                    </div>
                  )}
                </CardContent>
              </Card>
            </button>
          ))}
          {!loading && items.length === 0 && (
            <p className='col-span-full py-10 text-center text-sm text-ink-2'>No requests match.</p>
          )}
        </div>
      )}

      <div className='flex items-center justify-between text-xs text-ink-2'>
        <span>{loading ? 'Loading…' : `${items.length} shown`}</span>
        {cursor && (
          <Button variant='outline' size='sm' onClick={() => load(true)} disabled={loading}>
            Load more
          </Button>
        )}
      </div>

      {selected && (
        <RequestDetail id={selected} onClose={() => setSelected(null)} onChanged={onChanged} />
      )}
    </div>
  );
}

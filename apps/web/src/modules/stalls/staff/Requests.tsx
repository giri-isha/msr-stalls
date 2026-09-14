import type { ListRequestsQuery, RequestSummary } from '@msr/stalls';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { listRequests } from '../api';
import { SelectInput, TextInput } from '../components/FormControls';
import { Grid, Mono, Sub } from '../components/Grid';
import { STATUS_LABEL, StatusPill, TYPE_LABEL, TypeTag } from '../components/StatusPill';
import { formatDate } from '../hooks';
import { Icon } from '../ui/icons';
import { Btn, Card, Empty, ErrorBox, H1, Toolbar, toolBtnStyle } from '../ui/ui';
import { RequestDetail } from './RequestDetail';

type Mode = 'triage' | 'all';

/** "Stall Requests" (triage: what needs a decision, cards by default) and
 *  "All Requests" (the full pipeline table with every filter) are one screen
 *  with two presets — the prototype had both, and they read the same list. */
export function Requests({ mode }: { mode: Mode }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const requestType = params.get('requestType') ?? '';
  const status = params.get('status') ?? '';
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
        const page = await listRequests({ ...query, cursor: append ? (cursor ?? undefined) : undefined });
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
    <div>
      <H1
        icon={<Icon name={mode === 'triage' ? 'clipboard-list' : 'list-view'} size={20} />}
        sub={mode === 'triage' ? 'Review, shortlist and select. Open a request to see its full application.' : 'Every request in the pipeline, with every filter.'}
        actions={
          <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--mut)', borderRadius: 'calc(var(--r4) - 4px)' }}>
            {(['table', 'cards'] as const).map((v) => (
              <button
                type='button'
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={v === 'table' ? 'Table view' : 'Card view'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  borderRadius: 'calc(var(--r4) - 8px)',
                  border: 0,
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: view === v ? 700 : 500,
                  background: view === v ? 'var(--card)' : 'transparent',
                  color: view === v ? 'var(--fg)' : 'var(--mfg)',
                  boxShadow: view === v ? 'var(--ring)' : 'none',
                }}
              >
                <Icon name={v === 'table' ? 'list-view' : 'layout-grid'} size={14} />
                {v === 'table' ? 'Table' : 'Cards'}
              </button>
            ))}
          </div>
        }
      >
        {mode === 'triage' ? 'Stall Requests' : 'All Requests'}
      </H1>

      <Toolbar>
        <div style={{ flex: 1, minWidth: 220 }}>
          <TextInput aria-label='Search' placeholder='Search by name, reference, email or phone…' value={q} onChange={(e) => setParam('q', e.target.value)} />
        </div>
        <SelectInput aria-label='Type' value={requestType} onChange={(e) => setParam('requestType', e.target.value)} style={{ width: 170 }}>
          <option value=''>All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        <SelectInput aria-label='Status' value={status} onChange={(e) => setParam('status', e.target.value)} style={{ width: 160 }}>
          <option value=''>All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        {mode === 'all' && (
          <>
            <SelectInput aria-label='Zone' value={zoneCode} onChange={(e) => setParam('zoneCode', e.target.value)} style={{ width: 120 }}>
              <option value=''>All zones</option>
              {['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </SelectInput>
            <button type='button' onClick={() => setParam('flagged', flagged ? '' : 'true')} aria-pressed={flagged} style={toolBtnStyle(flagged)}>
              <Icon name='alert-triangle' size={13} /> Flagged
            </button>
          </>
        )}
      </Toolbar>

      {error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      {view === 'table' ? (
        <Grid<RequestSummary>
          rows={items}
          rowKey={(r) => r.id}
          onRow={(r) => setSelected(r.id)}
          selectedKey={selected}
          empty='No requests match.'
          columns={[
            {
              key: 'ref',
              header: 'Reference',
              width: '130px',
              mobile: 'sub',
              render: (r) => (
                <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                  {r.flagged && <Icon name='alert-triangle' size={12} color='var(--warn)' />}
                  <Mono>{r.reference}</Mono>
                </span>
              ),
            },
            { key: 'stall', header: 'Stall', width: '1.5fr', mobile: 'title', render: (r) => <b>{r.stallName}</b> },
            { key: 'type', header: 'Type', width: '120px', render: (r) => <TypeTag type={r.requestType} size='sm' /> },
            {
              key: 'req',
              header: 'Requester',
              width: '1.2fr',
              render: (r) => (
                <>
                  {r.requesterName}
                  <Sub>{r.contactNumber}</Sub>
                </>
              ),
            },
            { key: 'zone', header: 'Zone', width: '60px', render: (r) => r.preferredZoneCode },
            { key: 'n', header: 'Stalls', width: '60px', align: 'right', render: (r) => r.numStallsRequested },
            { key: 'status', header: 'Status', width: '120px', render: (r) => <StatusPill status={r.status} size='sm' /> },
            { key: 'alloc', header: 'Allocated', width: '110px', render: (r) => <Mono>{r.allocatedStalls.join(', ')}</Mono> },
            { key: 'date', header: 'Submitted', width: '100px', mobile: 'hide', render: (r) => <span style={{ color: 'var(--mfg)' }}>{formatDate(r.submittedAt)}</span> },
          ]}
        />
      ) : items.length === 0 && !loading ? (
        <Card>
          <Empty>No requests match.</Empty>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
          {items.map((r) => (
            <Card key={r.id} pad={14} onAct={() => setSelected(r.id)} label={`${r.stallName} ${r.reference}`} style={selected === r.id ? { borderColor: 'var(--pri)', boxShadow: '0 0 0 1px var(--pri)' } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--mfg)', display: 'flex', gap: 5, alignItems: 'center' }}>
                    {r.flagged && <Icon name='alert-triangle' size={12} color='var(--warn)' />}
                    <Mono>{r.reference}</Mono>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.stallName}</div>
                </div>
                <StatusPill status={r.status} size='sm' />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--mfg)' }}>
                <TypeTag type={r.requestType} size='sm' />
                <span>{r.stallType === 'FOOD' ? 'Food' : 'Non-food'}</span>
                <span>· {r.preferredZoneCode}</span>
                <span>· {r.numStallsRequested} stall{r.numStallsRequested > 1 ? 's' : ''}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                {r.requesterName} <span style={{ color: 'var(--mfg)' }}>· {r.contactNumber}</span>
              </div>
              {r.allocatedStalls.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ok-fg)' }}>
                  <Mono>{r.allocatedStalls.join(', ')}</Mono>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12, color: 'var(--mfg)' }}>
        <span>{loading ? 'Loading…' : `${items.length} shown`}</span>
        {cursor && (
          <Btn onClick={() => load(true)} disabled={loading}>
            Load more
          </Btn>
        )}
      </div>

      {selected && <RequestDetail id={selected} onClose={() => setSelected(null)} onChanged={onChanged} />}
    </div>
  );
}

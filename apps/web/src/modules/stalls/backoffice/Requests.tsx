import type { ListRequestsQuery, RequestSummary } from '@msr/stalls';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { listRequests, listZones } from '../api';
import {
  STAGE_LABEL,
  STATUS_LABEL,
  StagePill,
  StatusPill,
  TYPE_LABEL,
  TypeBadge,
  hasStage,
} from '../components/StatusPill';
import { formatDate, useLoad } from '../hooks';
import {
  Btn,
  Card,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Loading,
  Search,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  toolBtnStyle,
  Toolbar,
  useListView,
  ViewToggle,
  ColumnsButton,
  useColumns,
  type ColumnDef,
} from '../ui';

/** The pipeline's columns, in the order the table draws them.
 *
 *  ⚠️ `reference` and `stallName` are LOCKED. They are the two things that say
 *  which request a row is, and a pipeline with both hidden is ten rows of
 *  statuses belonging to nobody — reachable in two clicks and remembered until
 *  somebody works out how to undo it.
 *
 *  `contactNumber` rides inside the requester cell rather than being a column
 *  of its own, so it is not listed here; hiding the requester takes it too,
 *  which is what somebody hiding "Requester" means. */
const COLUMNS: ColumnDef[] = [
  { key: 'reference', label: 'Reference', locked: true },
  { key: 'stallName', label: 'Stall', locked: true },
  { key: 'requestType', label: 'Type' },
  { key: 'requester', label: 'Requester' },
  { key: 'zone', label: 'Zone' },
  { key: 'stalls', label: 'Stalls' },
  { key: 'status', label: 'Status' },
  { key: 'stage', label: 'Stage' },
  { key: 'allocated', label: 'Allocated' },
  { key: 'submitted', label: 'Submitted' },
];

/** Every request in the pipeline, with every filter.
 *
 *  ⚠️ There was a second list — "Stall Requests", a triage preset that showed
 *  the same rows as cards with three of the filters hidden. It is gone. Two
 *  screens over one table meant a coordinator had to know which preset a
 *  request would show up under before they could go looking for it, and the
 *  answer depended on a stage they were trying to look up in the first place.
 *  Triage is what the filters are FOR, so it is a filter now, not an address. */
export function Requests() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const requestType = params.get('requestType') ?? '';
  const status = params.get('status') ?? '';
  const stage = params.get('stage') ?? '';
  const zoneCode = params.get('zoneCode') ?? '';
  const flagged = params.get('flagged') === 'true';
  const [view, setView] = useListView('requests');
  const columns = useColumns('requests', COLUMNS);
  // The bays are the edition's own rows, not a list in this file: the venue is
  // redrawn every year, and a filter that cannot offer a new bay hides every
  // request standing in it.
  const { data: zones } = useLoad(() => listZones(), []);
  const navigate = useNavigate();

  // The record hangs one segment under this list, and the list's filters ride
  // along in the query string so the back link lands where the reader left.
  const to = (id: string) => ({
    pathname: `/m/stalls/requests/${id}`,
    search: params.toString(),
  });

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

  // `key` is the serialised query, standing in for every field inside it, and
  // `cursor` is read on the append path. Neither is something the rule can see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key serialises the query
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

  // ⚠️ The phone is no longer FORCED into cards. `useListView` opens it there,
  // which is what a phone wants without being asked — but a coordinator who
  // picks the table gets the table, scrolled sideways inside its card, because
  // "find me VEN-2026-0114" is a job the tiles are bad at and the width does
  // not change that. The toggle used to be drawn on mobile and ignored there,
  // which is a control that lies about what it does.
  const asCards = view === 'cards';

  return (
    <div>
      <H1
        icon={<Icon name='list-view' size={18} />}
        sub='Every request in the pipeline. Click one to see its full application.'
        actions={
          <>
            {/* ⚠️ Only with the table. The cards are a fixed layout — they read
                the same fields whatever the picker says — so offering it there
                would be a control that changes nothing on the screen it is
                sitting on. */}
            {view === 'table' && <ColumnsButton state={columns} />}
            <ViewToggle view={view} onChange={setView} />
          </>
        }
      >
        All Requests
      </H1>

      <Toolbar>
        <Search
          value={q}
          onChange={(v) => setParam('q', v)}
          placeholder='Search by name, reference, email or phone…'
        />
        <Select
          aria-label='Type'
          value={requestType}
          onChange={(e) => setParam('requestType', e.target.value)}
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value=''>All Types</option>
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
          style={{ width: 'auto', minWidth: 140 }}
        >
          <option value=''>All Statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        {/* Stage, zone and flagged were hidden on the triage preset. With one
            list there is no preset to hide them from, and these three are what
            triage actually WAS: "show me everyone still sitting on a bank
            form" is a question the API always answered and the screen only
            sometimes asked. */}
        <Select
          aria-label='Stage'
          value={stage}
          onChange={(e) => setParam('stage', e.target.value)}
          style={{ width: 'auto', minWidth: 170 }}
        >
          <option value=''>All Stages</option>
          {Object.entries(STAGE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          aria-label='Zone'
          value={zoneCode}
          onChange={(e) => setParam('zoneCode', e.target.value)}
          style={{ width: 'auto', minWidth: 120 }}
        >
          <option value=''>All Zones</option>
          {(zones ?? []).map((z) => (
            <option key={z.code} value={z.code}>
              {z.code}
            </option>
          ))}
        </Select>
        {/* ⚠️ `aria-pressed`, not a variant swap. "Flagged is on" is carried
            by the primary tint, which is information only a sighted reader
            gets otherwise — the same reason `Chip` announces its state. */}
        <button
          type='button'
          aria-pressed={flagged}
          onClick={() => setParam('flagged', flagged ? '' : 'true')}
          style={toolBtnStyle(flagged)}
        >
          <Icon name='alert-triangle' size={14} />
          Flagged
        </button>
      </Toolbar>

      {error && <ErrorBox>{error}</ErrorBox>}

      {loading && items.length === 0 ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>No requests match.</Empty>
      ) : asCards ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(288px,1fr))',
            gap: 12,
          }}
        >
          {items.map((r) => (
            <RequestCard key={r.id} r={r} onOpen={() => navigate(to(r.id))} />
          ))}
        </div>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Stall</TH>
                {columns.shown('requestType') && <TH>Type</TH>}
                {columns.shown('requester') && <TH>Requester</TH>}
                {columns.shown('zone') && <TH>Zone</TH>}
                {columns.shown('stalls') && <TH align='right'>Stalls</TH>}
                {columns.shown('status') && <TH>Status</TH>}
                {columns.shown('stage') && <TH>Stage</TH>}
                {columns.shown('allocated') && <TH>Allocated</TH>}
                {columns.shown('submitted') && <TH>Submitted</TH>}
              </TR>
            </THead>
            <TBody>
              {items.map((r) => (
                <TR key={r.id} onClick={() => navigate(to(r.id))}>
                  <TD mono style={{ fontSize: 11.5 }}>
                    {r.flagged && <FlagMark />}
                    {r.reference}
                  </TD>
                  {/* ⚠️ A real link inside the row, not just the row's own
                      `onClick`. A `<tr>` takes no focus and answers no Enter,
                      so while the record was a drawer the whole pipeline was
                      unreachable without a mouse; now that opening one is a
                      navigation, it can be the anchor it always should have
                      been. The row click stays — it is the bigger target. */}
                  <TD style={{ fontWeight: 600, fontSize: 13 }}>
                    <Link
                      to={to(r.id)}
                      style={{ color: 'inherit', textDecoration: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.stallName}
                    </Link>
                  </TD>
                  {columns.shown('requestType') && (
                    <TD>
                      <TypeBadge type={r.requestType} />
                    </TD>
                  )}
                  {columns.shown('requester') && (
                    <TD>
                      <div>{r.requesterName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.contactNumber}</div>
                    </TD>
                  )}
                  {columns.shown('zone') && <TD>{r.preferredZoneCode}</TD>}
                  {columns.shown('stalls') && <TD align='right'>{r.numStallsRequested}</TD>}
                  {columns.shown('status') && (
                    <TD>
                      <StatusPill status={r.status} />
                    </TD>
                  )}
                  {columns.shown('stage') && (
                    <TD>
                      {hasStage(r.status) ? (
                        <StagePill stage={r.stage} />
                      ) : (
                        <span style={{ color: 'var(--mfg)' }}>—</span>
                      )}
                    </TD>
                  )}
                  {columns.shown('allocated') && (
                    <TD mono style={{ fontSize: 11.5, color: 'var(--ok-fg)', fontWeight: 600 }}>
                      {r.allocatedStalls.join(', ')}
                    </TD>
                  )}
                  {columns.shown('submitted') && (
                    <TD muted style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                      {formatDate(r.submittedAt)}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 14,
          fontSize: 12,
          color: 'var(--mfg)',
        }}
      >
        <span>{loading ? 'Loading…' : `${items.length.toLocaleString('en-IN')} shown`}</span>
        <div style={{ flex: 1 }} />
        {cursor && (
          <Btn onClick={() => load(true)} disabled={loading}>
            <Icon name='chevron-down' size={14} />
            Load More
          </Btn>
        )}
      </div>
    </div>
  );
}

/**
 * The marker in front of a flagged reference, in the table and on the card.
 *
 * ⚠️ `role='img'`, and it is the reason this is a component rather than the
 * same eleven lines twice. `aria-label` is only honoured on an element that has
 * a role to name — a bare `<span>` has none, so the label was dropped and the
 * marker announced nothing at all, in both copies. The role is what makes the
 * glyph a graphic with a name; the `Icon` inside stays `aria-hidden`, so it is
 * announced once.
 */
function FlagMark() {
  return (
    <span
      role='img'
      aria-label='Flagged'
      style={{
        display: 'inline-flex',
        verticalAlign: '-2px',
        marginRight: 5,
        color: 'var(--warn)',
      }}
    >
      <Icon name='alert-triangle' size={12} />
    </span>
  );
}

function RequestCard({ r, onOpen }: { r: RequestSummary; onOpen: () => void }) {
  return (
    <Card
      pad={15}
      onAct={onOpen}
      label={`${r.stallName}, ${r.reference}`}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              fontSize: 11,
              color: 'var(--mfg)',
            }}
          >
            {r.flagged && <FlagMark />}
            {r.reference}
          </div>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.stallName}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: 5,
            flex: 'none',
          }}
        >
          <StatusPill status={r.status} />
          {hasStage(r.status) && <StagePill stage={r.stage} />}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
        <TypeBadge type={r.requestType} />
        <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          {r.stallType === 'FOOD' ? 'Food' : 'Non-food'} · {r.preferredZoneCode} ·{' '}
          {r.numStallsRequested} stall{r.numStallsRequested > 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ fontSize: 12.5 }}>
        {r.requesterName}
        <span style={{ color: 'var(--mfg)' }}> · {r.contactNumber}</span>
      </div>

      {r.allocatedStalls.length > 0 && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            marginTop: 'auto',
            padding: '4px 9px',
            borderRadius: 999,
            background: 'var(--ok-t)',
            border: '1px solid var(--ok-b)',
            color: 'var(--ok-fg)',
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          <Icon name='map-pin' size={12} />
          <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>
            {r.allocatedStalls.join(', ')}
          </span>
        </div>
      )}
    </Card>
  );
}

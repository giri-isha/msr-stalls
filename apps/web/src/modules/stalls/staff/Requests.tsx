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
  useIsMobile,
} from '../ui';

type Mode = 'triage' | 'all';

/** "Stall Requests" (triage: what needs a decision, cards or table) and "All
 *  Requests" (the full pipeline table with every filter) are one screen with
 *  two presets — the prototype had both, and they read the same list. */
export function Requests({ mode }: { mode: Mode }) {
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const q = params.get('q') ?? '';
  const requestType = params.get('requestType') ?? '';
  const status = params.get('status') ?? '';
  const stage = params.get('stage') ?? '';
  const zoneCode = params.get('zoneCode') ?? '';
  const flagged = params.get('flagged') === 'true';
  const [view, setView] = useState<'table' | 'cards'>(mode === 'triage' ? 'cards' : 'table');
  // The bays are the season's own rows, not a list in this file: the venue is
  // redrawn every year, and a filter that cannot offer a new bay hides every
  // request standing in it.
  const { data: zones } = useLoad(() => listZones(), []);
  const navigate = useNavigate();

  // The record hangs one segment under this list, and the list's filters ride
  // along in the query string so the back link lands where the reader left.
  const base = mode === 'triage' ? '/m/stalls/requests' : '/m/stalls/all';
  const to = (id: string) => ({ pathname: `${base}/${id}`, search: params.toString() });

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

  // A table of eleven columns has no narrow form, so a phone gets the cards
  // whichever view is chosen. The toggle is still drawn — the choice is
  // remembered for when the window widens — it simply does not apply here.
  const asCards = view === 'cards' || mobile;

  return (
    <div>
      <H1
        icon={<Icon name={mode === 'triage' ? 'clipboard-list' : 'list-view'} size={18} />}
        sub={
          mode === 'triage'
            ? 'Review, shortlist and select. Click a request to see its full application.'
            : 'Every request in the pipeline, with every filter.'
        }
        actions={
          // The two views, as one segmented control on the card plate.
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: 2,
              borderRadius: 'var(--r2)',
              border: '1px solid var(--bd)',
              background: 'var(--card)',
            }}
          >
            <ViewBtn
              on={view === 'table'}
              label='Table view'
              glyph='list-view'
              onClick={() => setView('table')}
            />
            <ViewBtn
              on={view === 'cards'}
              label='Card view'
              glyph='layout-grid'
              onClick={() => setView('cards')}
            />
          </div>
        }
      >
        {mode === 'triage' ? 'Stall Requests' : 'All Requests'}
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
          style={{ width: 'auto', minWidth: 140 }}
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
            {/* The stage filter. The query has always accepted `stage` and the
                pipeline has always carried one — this is the control that was
                missing, which is why "show me everyone still sitting on a bank
                form" could be asked of the API but not of the screen. */}
            <Select
              aria-label='Stage'
              value={stage}
              onChange={(e) => setParam('stage', e.target.value)}
              style={{ width: 'auto', minWidth: 170 }}
            >
              <option value=''>All stages</option>
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
              <option value=''>All zones</option>
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
          </>
        )}
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
                <TH>Type</TH>
                <TH>Requester</TH>
                <TH>Zone</TH>
                <TH align='right'>Stalls</TH>
                <TH>Status</TH>
                <TH>Stage</TH>
                <TH>Allocated</TH>
                <TH>Submitted</TH>
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
                  <TD>
                    <TypeBadge type={r.requestType} />
                  </TD>
                  <TD>
                    <div>{r.requesterName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.contactNumber}</div>
                  </TD>
                  <TD>{r.preferredZoneCode}</TD>
                  <TD align='right'>{r.numStallsRequested}</TD>
                  <TD>
                    <StatusPill status={r.status} />
                  </TD>
                  <TD>
                    {hasStage(r.status) ? (
                      <StagePill stage={r.stage} />
                    ) : (
                      <span style={{ color: 'var(--mfg)' }}>—</span>
                    )}
                  </TD>
                  <TD mono style={{ fontSize: 11.5, color: 'var(--ok-fg)', fontWeight: 600 }}>
                    {r.allocatedStalls.join(', ')}
                  </TD>
                  <TD muted style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    {formatDate(r.submittedAt)}
                  </TD>
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
            Load more
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

function ViewBtn({
  on,
  label,
  glyph,
  onClick,
}: {
  on: boolean;
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 28,
        borderRadius: 'var(--r)',
        border: 0,
        background: on ? 'var(--pri-t)' : 'transparent',
        color: on ? 'var(--pri)' : 'var(--mfg)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <Icon name={glyph} size={15} />
    </button>
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

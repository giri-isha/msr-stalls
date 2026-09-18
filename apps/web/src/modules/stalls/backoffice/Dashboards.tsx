// REPORTS & DASHBOARDS — the KPI strip, and the catalog of reports under it.
//
// The KPI tiles ARE the old Dashboard screen, moved here whole. They were the
// module's landing until Home took that job, and they were always the wrong
// thing to land on: a wall of counts nobody had chosen, half of which most
// callers could not read. They are exactly right as the top of a reports screen,
// where somebody has come to look at numbers on purpose.
//
// ⚠️ The catalog below comes from the API, not from the registry the web can
// see. A caller is shown the reports they may open, and the server is the only
// reader that knows which those are.
import { type RequestStatus, STALL_REQUEST_TYPES } from '@stalls/core';
import { Link } from 'react-router';
import { getDashboard, listReports } from '../api';
import { requestStatusTone, STATUS_LABEL, TYPE_LABEL } from '../components/StatusPill';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  card,
  Card,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Loading,
  TONE,
  type Tone,
  useIsMobile,
} from '../ui';

/**
 * One reading.
 *
 * ⚠️ The shape is `StatTiles`' — a tinted glyph chip, the number at 22px/700
 * with a −.6px track, the caption at 11.5px on `--mfg` — drawn here rather than
 * imported because that component's tiles are a view FILTER whose labels are
 * the filter values it sends back. These tiles navigate. Reusing it would mean
 * an `onPick` that is really a router push and a `statusTone` that has never
 * heard of "Backup"; the twenty lines below are the smaller cost, and they
 * follow the same tokens, so a retune still moves both.
 */
function Tile({
  label,
  value,
  hint,
  glyph,
  tone = 'neutral',
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  glyph: string;
  tone?: Tone;
  to?: string;
}) {
  const mobile = useIsMobile();
  const [tint, fg] = TONE[tone];
  const face = (
    <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 10 : 12 }}>
      <div
        style={{
          width: mobile ? 30 : 36,
          height: mobile ? 30 : 36,
          borderRadius: 'var(--r3)',
          background: tint,
          color: fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <Icon name={glyph} size={mobile ? 15 : 17} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: mobile ? 18 : 22, fontWeight: 700, letterSpacing: '-.6px' }}>
          {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--mfg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        {hint && <div style={{ fontSize: 10.5, color: 'var(--mfg)', marginTop: 1 }}>{hint}</div>}
      </div>
    </div>
  );

  const box: React.CSSProperties = { ...card, padding: mobile ? 12 : 14 };
  if (!to) return <div style={box}>{face}</div>;
  return (
    <Link to={to} className='stalls-lift' style={{ ...box, display: 'block', color: 'inherit' }}>
      {face}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '.9px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
          marginBottom: 9,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: 12,
        }}
      >
        {children}
      </div>
    </section>
  );
}

const TYPE_GLYPH: Record<string, string> = {
  VENDOR: 'ticket',
  LOCAL_WELFARE: 'users',
  ASHRAM: 'layout-grid',
};

const STATUS_GLYPH: Record<RequestStatus, string> = {
  SUBMITTED: 'clipboard-list',
  SHORTLISTED: 'clock',
  SELECTED: 'circle-check',
  BACKUP: 'refresh',
  REJECTED: 'ban',
  CANCELLED: 'ban',
};

/** The counts, for a caller who may read requests. Their own component so the
 *  report catalog below still renders for somebody who may not — a finance
 *  officer scoped to the money has reports here and no business with the
 *  pipeline. */
function Kpis() {
  const { data, error, loading } = useLoad(getDashboard);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the counts.'}</ErrorBox>;

  const s = data.byStatus;
  return (
    <>
      <Group title='Requests'>
        <Tile
          label='Total Requests'
          value={data.total}
          glyph='clipboard-list'
          tone='info'
          to='/m/stalls/requests'
        />
        {/* ⚠️ `STALL_REQUEST_TYPES`, not a list written out here. Ashram food
            stopped being a request type when the two ashram forms merged, and a
            tile hand-listed in this file would have gone on counting a type the
            API no longer returns — reading zero, for ever, next to the real
            ones. */}
        {STALL_REQUEST_TYPES.map((t) => (
          <Tile
            key={t}
            label={TYPE_LABEL[t]}
            value={data.byType[t] ?? 0}
            glyph={TYPE_GLYPH[t]}
            // ⚠️ `violet`, matching `TypeBadge`. The type pill and the type tile
            // are the same fact in two places; a different colour in each is how
            // a dashboard and a list stop agreeing about what they are counting.
            tone='violet'
            to={`/m/stalls/requests?requestType=${t}`}
          />
        ))}
      </Group>

      <Group title='Selection'>
        {(['SUBMITTED', 'SHORTLISTED', 'SELECTED', 'BACKUP', 'REJECTED'] as const).map((st) => (
          <Tile
            key={st}
            label={STATUS_LABEL[st]}
            value={s[st] ?? 0}
            glyph={STATUS_GLYPH[st]}
            tone={requestStatusTone(st)}
            to={`/m/stalls/requests?status=${st}`}
          />
        ))}
      </Group>

      <Group title='Stalls'>
        <Tile
          label='Planned'
          value={data.stallsPlanned}
          glyph='layers'
          tone='info'
          to='/m/stalls/planning'
        />
        <Tile label='Allocated' value={data.stallsAllocated} glyph='map-pin' tone='ok' />
        <Tile
          label='Flagged for Follow-Up'
          value={data.flagged}
          glyph='alert-triangle'
          tone='warn'
          to='/m/stalls/requests?flagged=true'
        />
      </Group>
    </>
  );
}

/** The report catalog, grouped as the catalog groups it. */
function Catalog() {
  const { data, error, loading } = useLoad(listReports);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the reports.'}</ErrorBox>;
  if (data.reports.length === 0) {
    return <Empty>There are no reports your role can open.</Empty>;
  }

  // Grouped here rather than by the API, which sends the catalog flat: the
  // grouping is presentation, and the order inside each group is the catalog's.
  const groups: string[] = [];
  for (const r of data.reports) if (!groups.includes(r.group)) groups.push(r.group);

  return (
    <>
      {groups.map((group) => (
        <Group key={group} title={group}>
          {data.reports
            .filter((r) => r.group === group)
            .map((r) => (
              <Link
                key={r.key}
                to={`/m/stalls/dashboards/${r.key}`}
                className='stalls-lift'
                style={{ ...card, padding: 15, display: 'block', color: 'inherit' }}
              >
                <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 'var(--r3)',
                      background: 'var(--pri-t)',
                      color: 'var(--fg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 'none',
                    }}
                  >
                    <Icon name={r.glyph} size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.2px' }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>
                      {r.note}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
        </Group>
      ))}
    </>
  );
}

export function Dashboards() {
  const { can } = useMe();
  return (
    <div>
      <H1
        icon={<Icon name='bar-chart' size={18} />}
        sub='Where the edition stands, and the tables behind it'
      >
        Reports & Dashboards
      </H1>

      {can('requests.read') ? (
        <Kpis />
      ) : (
        // Not an empty space and not an error: a caller who may open reports but
        // not the pipeline is a real role — a finance officer, a check-in lead —
        // and the sentence says which half of the screen is theirs.
        <Card pad={14} style={{ marginBottom: 22, fontSize: 12.5, color: 'var(--mfg)' }}>
          The headline counts read the request pipeline, which your role does not open. The reports
          below are yours.
        </Card>
      )}

      <Catalog />
    </div>
  );
}

import { type RequestStatus, STALL_REQUEST_TYPES } from '@msr/stalls';
import { Link } from 'react-router';
import { getDashboard } from '../api';
import { requestStatusTone, STATUS_LABEL, TYPE_LABEL } from '../components/StatusPill';
import { useLoad } from '../hooks';
import { card, ErrorBox, H1, Icon, Loading, TONE, type Tone, useIsMobile } from '../ui';

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
    <Link to={to} className='msrs-lift' style={{ ...box, display: 'block', color: 'inherit' }}>
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

export function Dashboard() {
  const { data, error, loading } = useLoad(getDashboard);
  if (loading) return <Loading />;
  if (error || !data)
    return <ErrorBox>{error?.message ?? 'Could not load the dashboard.'}</ErrorBox>;

  const s = data.byStatus;
  return (
    <div>
      <H1 icon={<Icon name='home' size={18} />} sub='Maha Shivratri · MSR Stalls Program'>
        Dashboard
      </H1>

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

      <Group title='Onboarding · Phase 2 and 3'>
        <Tile label='Pending Bank Details' value='—' hint='Phase 2' glyph='file-text' />
        <Tile label='Pending Payment' value='—' hint='Phase 2' glyph='ticket' />
        <Tile label='FSSAI Pending' value='—' hint='Phase 3' glyph='shield' />
        <Tile label='Not Checked In' value='—' hint='Phase 3' glyph='log-in' />
      </Group>
    </div>
  );
}

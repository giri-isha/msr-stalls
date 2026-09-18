// HOME — where every signed-in member lands.
//
// 🔴 This replaced `Dashboard.tsx`, which was one fixed screen of four tile
// groups shown to anybody holding `requests.read` and to nobody else. Two things
// were wrong with that. The finance officer and the volunteer who counts chairs
// opened the same page, most of which neither of them needed; and the volunteer
// who holds no `requests.read` opened nothing at all and was bounced to whatever
// screen happened to be first in the nav.
//
// The cards are resolved per role now (Configs › Home Page), each gates itself
// on the privilege that opens the data behind it, and the API sends only the
// ones this caller resolved to — filled, in one request.
import { Link } from 'react-router';
import { SPAN_COLUMNS, packWidgetRows } from '@stalls/core';
import type { HomeWidgetView } from '@stalls/core';
import { getHome } from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Card,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Loading,
  TONE,
  type Tone,
  useIsMobile,
  useIsNarrow,
} from '../ui';

/** One reading inside a card: a number, what it counts, and where it goes.
 *
 *  ⚠️ Not `StatTiles`, which is a view FILTER whose labels are the values it
 *  sends back. These navigate. Sharing that component would mean an `onPick`
 *  that is really a router push. */
function Stat({
  label,
  value,
  tone = 'neutral',
  to,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  to?: string;
}) {
  const [, fg] = TONE[tone];
  const face = (
    <>
      <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-.6px', color: fg }}>
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
    </>
  );

  if (!to) return <div style={{ minWidth: 0 }}>{face}</div>;
  return (
    <Link to={to} style={{ minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
      {face}
    </Link>
  );
}

/** The stats inside a card, wrapping rather than scrolling. */
function Stats({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))',
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

/** Rupees from paise, short — `₹2.4L` rather than `₹240,000`, because a card is
 *  read at a glance and the exact figure is on the Finance screen. */
function money(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
}

const n = (data: HomeWidgetView['data'], key: string): number => {
  const v = data?.[key];
  return typeof v === 'number' ? v : 0;
};

/** The quick-links card: this caller's own sidebar, as tiles.
 *
 *  ⚠️ Drawn from `useMe().nav` rather than from a payload of its own. It IS the
 *  sidebar — already resolved, already arranged — so a card that fetched its own
 *  copy would be a second list that could disagree with the one beside it. */
function QuickLinks() {
  const { nav } = useMe();
  const items = nav.flatMap((g) => g.items).filter((i) => !i.end);
  if (items.length === 0) return <Empty>Nothing to open yet.</Empty>;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))',
        gap: 10,
      }}
    >
      {items.map((i) => (
        <Link
          key={i.key}
          to={i.to}
          className='stalls-lift'
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: 11,
            borderRadius: 'var(--r3)',
            border: '1px solid var(--bd)',
            background: 'var(--card)',
            color: 'inherit',
            textDecoration: 'none',
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--r3)',
              background: 'var(--pri-t)',
              color: 'var(--fg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <Icon name={i.glyph} size={16} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {i.label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--mfg)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {i.meta}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** What each card draws. A key with no entry renders its own empty sentence —
 *  which is what a card whose loader failed looks like, and is deliberately not
 *  an error page: one card is a reading, and seven good ones are still worth
 *  somebody's morning. */
const BODIES: Partial<Record<string, (w: HomeWidgetView) => React.ReactNode>> = {
  requests_summary: (w) => (
    <Stats>
      <Stat label='Filed' value={n(w.data, 'total')} to='/m/stalls/requests' />
      <Stat
        label='Submitted'
        value={n(w.data, 'submitted')}
        tone='info'
        to='/m/stalls/requests?status=SUBMITTED'
      />
      <Stat
        label='Shortlisted'
        value={n(w.data, 'shortlisted')}
        tone='info'
        to='/m/stalls/requests?status=SHORTLISTED'
      />
      <Stat
        label='Selected'
        value={n(w.data, 'selected')}
        tone='ok'
        to='/m/stalls/requests?status=SELECTED'
      />
      <Stat label='Backup' value={n(w.data, 'backup')} to='/m/stalls/requests?status=BACKUP' />
      <Stat
        label='Rejected'
        value={n(w.data, 'rejected')}
        tone='des'
        to='/m/stalls/requests?status=REJECTED'
      />
    </Stats>
  ),

  requests_by_type: (w) => (
    <Stats>
      <Stat
        label='Vendor'
        value={n(w.data, 'VENDOR')}
        tone='violet'
        to='/m/stalls/requests?requestType=VENDOR'
      />
      <Stat
        label='Local Welfare'
        value={n(w.data, 'LOCAL_WELFARE')}
        tone='violet'
        to='/m/stalls/requests?requestType=LOCAL_WELFARE'
      />
      <Stat
        label='Ashram'
        value={n(w.data, 'ASHRAM')}
        tone='violet'
        to='/m/stalls/requests?requestType=ASHRAM'
      />
    </Stats>
  ),

  follow_ups: (w) => (
    <Stats>
      <Stat
        label='Awaiting a call back'
        value={n(w.data, 'flagged')}
        tone='warn'
        to='/m/stalls/requests?flagged=true'
      />
    </Stats>
  ),

  stalls_allocation: (w) => (
    <Stats>
      <Stat label='Planned' value={n(w.data, 'planned')} tone='info' to='/m/stalls/planning' />
      <Stat label='Allocated' value={n(w.data, 'allocated')} tone='ok' />
    </Stats>
  ),

  onboarding_progress: (w) => (
    <Stats>
      <Stat label='Selected' value={n(w.data, 'selected')} tone='ok' />
      <Stat label='Bank Pending' value={n(w.data, 'bankPending')} tone='warn' />
      <Stat label='Payment Pending' value={n(w.data, 'paymentPending')} tone='warn' />
      <Stat label='FSSAI Pending' value={n(w.data, 'fssaiPending')} tone='warn' />
      <Stat label='Staff Pending' value={n(w.data, 'staffPending')} tone='warn' />
    </Stats>
  ),

  finance_summary: (w) => (
    <Stats>
      <Stat label='Quoted' value={money(n(w.data, 'quotedPaise'))} />
      <Stat label='Collected' value={money(n(w.data, 'collectedPaise'))} tone='ok' />
      <Stat label='Outstanding' value={money(n(w.data, 'duePaise'))} tone='warn' />
    </Stats>
  ),

  checkin_status: (w) => (
    <Stats>
      <Stat label='Checked In' value={n(w.data, 'checkedIn')} tone='ok' />
      <Stat label='Still Expected' value={n(w.data, 'pending')} tone='warn' />
    </Stats>
  ),

  equipment_counts: (w) => (
    <Stats>
      <Stat label='Issued' value={n(w.data, 'distributed')} tone='info' />
      <Stat label='Returned' value={n(w.data, 'collected')} tone='ok' />
      <Stat label='Damaged' value={n(w.data, 'damaged')} tone='warn' />
      <Stat label='Missing' value={n(w.data, 'missing')} tone='des' />
    </Stats>
  ),

  quick_links: () => <QuickLinks />,
};

function WidgetCard({ widget }: { widget: HomeWidgetView }) {
  const body = BODIES[widget.key];
  return (
    <Card pad={15} style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <Icon name={widget.glyph} size={15} />
        <div
          style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.2px', flex: 1, minWidth: 0 }}
        >
          {widget.label}
        </div>
        {widget.to && (
          <Link
            to={widget.to}
            style={{
              fontSize: 11.5,
              color: 'var(--pri)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              flex: 'none',
            }}
          >
            Open
            <Icon name='arrow-right' size={13} />
          </Link>
        )}
      </div>
      {/* ⚠️ `data === null` is the loader having FAILED — see `HomeWidgetView`.
          A card with nothing to load sends `{}` and draws normally, which is
          what Quick Links does. A card the web has no body for is a registry
          entry a deployed client has never heard of, and gets the same line. */}
      {body && widget.data ? (
        body(widget)
      ) : (
        <div style={{ fontSize: 12, color: 'var(--mfg)' }}>
          These figures could not be read just now.
        </div>
      )}
    </Card>
  );
}

export function Home() {
  const { data, error, loading } = useLoad(getHome);
  const mobile = useIsMobile();
  const narrow = useIsNarrow();

  if (loading && !data) return <Loading />;
  if (error || !data)
    return <ErrorBox>{error?.message ?? 'Could not load your home page.'}</ErrorBox>;

  // ⚠️ The spans come off the payload, which carries the registry's — the API
  // is the only reader that knows which cards this caller resolved to, so the
  // packing has to happen where the list is, not where the registry is.
  const rows = packWidgetRows(data.widgets);

  return (
    <div>
      <H1 icon={<Icon name='home' size={18} />} sub={data.editionLabel}>
        Home
      </H1>

      {data.widgets.length === 0 ? (
        // The caller whose grant reaches nothing. Says what happened and who
        // can fix it, rather than blaming them for arriving.
        <Empty>
          Your stalls access does not reach any of the home cards yet. Ask whoever set it up to
          grant a role with something in it.
        </Empty>
      ) : (
        rows.map((row) => (
          <div
            key={row.map((w) => w.key).join('|')}
            style={{
              display: 'grid',
              // Below the narrow breakpoint every card takes the full width:
              // a `third` at 360px is a card with no room for the number in it.
              gridTemplateColumns: narrow
                ? '1fr'
                : row.map((w) => `${SPAN_COLUMNS[w.span]}fr`).join(' '),
              gap: mobile ? 12 : 14,
              marginBottom: mobile ? 12 : 14,
            }}
          >
            {row.map((w) => (
              <WidgetCard key={w.key} widget={w} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

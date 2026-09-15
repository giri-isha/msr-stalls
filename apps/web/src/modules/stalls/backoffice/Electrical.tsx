import { useMemo, useState } from 'react';
import { getElectrical, listZones } from '../api';
import { useLoad } from '../hooks';
import {
  Btn,
  Card,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Loading,
  Search,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  toolBtnStyle,
} from '../ui';

/**
 * The stall-wise electrical layout the electrical and venue-prep teams walk the
 * bays with.
 *
 * ⚠️ **This screen exists to be printed.** The 2025 original is one spreadsheet
 * tab per bay, carried on paper; the requirement asks for "the format which is
 * printable in A4 sheet". So the print stylesheet below is not a nicety — it is
 * the deliverable, and everything chrome (nav, toolbar, buttons) is hidden from
 * it while the table keeps its rules and header.
 *
 * The 5A column says *including the one free plug*, which is not what the
 * request form asked for. That conversion happens server-side
 * (`plugs5aIncludingDefault`) so the screen and the sheet can never disagree
 * about it.
 */
export function Electrical() {
  const [zone, setZone] = useState<string>('');
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad(() => getElectrical(zone || undefined), [zone]);
  // The bays are the edition's own rows, not a constant: the venue layout is
  // redrawn every year, and a filter built from a fixed list would quietly
  // offer no way to print a bay that was added this edition.
  // ⚠️ The bays alone, not the whole config: the electrical and venue-prep
  // teams hold `electrical:read` and nothing else, and `/config` is Admin's.
  const config = useLoad(listZones);
  const zones = config.data ?? [];

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        !term ||
        r.stallNumber.toLowerCase().includes(term) ||
        r.stallName.toLowerCase().includes(term),
    );
  }, [data, q]);

  return (
    <div>
      <style>{PRINT_CSS}</style>

      <div className='msrs-noprint'>
        <H1
          icon={<Icon name='sliders' size={18} />}
          sub='Stall-wise plug points and appliance load, shared with the electrical and venue prep teams. Pick a cluster, then print.'
          actions={
            <Btn kind='primary' onClick={() => window.print()} disabled={rows.length === 0}>
              <Icon name='download' size={14} />
              Print A4 {zone ? `(${zone})` : '(all)'}
            </Btn>
          }
        >
          Electrical &amp; Venue
        </H1>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            type='button'
            aria-pressed={zone === ''}
            onClick={() => setZone('')}
            style={toolBtnStyle(zone === '')}
          >
            All clusters
          </button>
          {zones.map((z) => (
            <button
              key={z.code}
              type='button'
              aria-pressed={zone === z.code}
              onClick={() => setZone(z.code)}
              style={toolBtnStyle(zone === z.code)}
              title={z.name}
            >
              {z.code}
            </button>
          ))}
          <Search value={q} onChange={setQ} placeholder='Search stall number or name…' />
        </div>
      </div>

      {error && <ErrorBox>{error.message}</ErrorBox>}
      {loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className='msrs-noprint'>
          <Empty>
            No allocated stalls in this cluster yet. The sheet is built from stall allocations, so
            it fills up as selection proceeds.
          </Empty>
        </div>
      ) : (
        <>
          {/* Only visible on paper: a sheet handed to another team has to say
              what it is and which bay it covers without anyone writing on it. */}
          <div className='msrs-printonly msrs-printhead'>
            <span>Electrical &amp; Venue Prep — {zone ? `Cluster ${zone}` : 'All clusters'}</span>
            <span>{data?.editionName}</span>
          </div>

          <div className='msrs-sheet'>
            <Card pad={0} style={{ overflow: 'hidden' }}>
              <Table>
                <THead>
                  <TR>
                    <TH>Stall No</TH>
                    <TH>Stall Name</TH>
                    <TH>Category</TH>
                    <TH align='right'>5A (incl. 1 default)</TH>
                    <TH align='right'>15A</TH>
                    <TH align='right'>Gas</TH>
                    <TH>Appliances &amp; wattage</TH>
                    <TH align='right'>Total W</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.stallNumber}>
                      <TD mono style={{ fontWeight: 600, fontSize: 12 }}>
                        {r.stallNumber}
                      </TD>
                      <TD style={{ fontSize: 12.5 }}>{r.stallName}</TD>
                      <TD muted style={{ fontSize: 11.5 }}>
                        {r.category.replace(/_/g, ' ').toLowerCase()}
                      </TD>
                      <TD align='right'>{r.plugs5aTotal}</TD>
                      <TD align='right'>{r.plugs15a}</TD>
                      <TD align='right'>{r.gasStoves || '—'}</TD>
                      <TD style={{ fontSize: 11.5 }}>
                        {r.appliances.length === 0
                          ? '—'
                          : r.appliances.map((a) => `${a.name} ${a.watts}W`).join(', ')}
                      </TD>
                      <TD align='right' style={{ fontWeight: 600 }}>
                        {r.totalWatts.toLocaleString('en-IN')}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          </div>

          <div
            className='msrs-noprint'
            style={{
              display: 'flex',
              gap: 18,
              marginTop: 12,
              fontSize: 12,
              color: 'var(--mfg)',
              flexWrap: 'wrap',
            }}
          >
            <span>{rows.length} stalls</span>
            <span>{data?.totals.plugs5a.toLocaleString('en-IN')} × 5A</span>
            <span>{data?.totals.plugs15a.toLocaleString('en-IN')} × 15A</span>
            <span>{data?.totals.watts.toLocaleString('en-IN')} W total load</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The A4 rules.
 *
 * Scoped to `@media print` and injected by this screen rather than added to
 * `index.css`, because it hides the app shell — a global rule doing that would
 * silently break printing on every other screen. `msrs-noprint` on the chrome,
 * `msrs-printonly` on the paper header, and the table forced back to visible
 * borders because the screen's colour tokens print as nothing on white.
 */
const PRINT_CSS = `
.msrs-printonly { display: none; }
@media print {
  @page { size: A4 landscape; margin: 12mm; }
  body { background: #fff !important; }
  .msrs-noprint, nav, header, aside, [data-app-chrome] { display: none !important; }
  .msrs-printonly { display: flex !important; justify-content: space-between;
    font-size: 12px; font-weight: 700; margin-bottom: 8px; }
  .msrs-sheet { border: 0 !important; box-shadow: none !important; }
  .msrs-sheet table { font-size: 10px !important; width: 100%; }
  .msrs-sheet th, .msrs-sheet td {
    border: 1px solid #999 !important; padding: 3px 5px !important;
    color: #000 !important; background: #fff !important;
    white-space: normal !important; position: static !important;
  }
  .msrs-sheet tr { break-inside: avoid; }
}
`;

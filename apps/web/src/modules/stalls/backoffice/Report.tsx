// ONE REPORT — any of them.
//
// ⚠️ The key comes from the URL, and there is deliberately no component per
// report. A report is a title, some columns and some rows; eight screens that
// differed only in a string would be eight places to fix a column alignment. It
// also makes every report a link somebody can paste to a colleague.
import { Link, useParams } from 'react-router';
import type { ReportColumn, ReportView } from '@stalls/core';
import { getReport, reportCsvUrl } from '../api';
import { useLoad } from '../hooks';
import { Btn, Empty, ErrorBox, H1, Icon, Loading, TBody, TD, TH, THead, TR, Table } from '../ui';

/** A cell, as its column says to draw it.
 *
 *  ⚠️ Money arrives in PAISE and is drawn in rupees, here and in the CSV, and
 *  nowhere in between does a float touch it — the module holds every amount as
 *  an integer and converts once, at the edge, which is this function. */
function cell(value: string | number | null | undefined, kind: ReportColumn['kind']) {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money' && typeof value === 'number') {
    return `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }
  if (kind === 'number' && typeof value === 'number') return value.toLocaleString('en-IN');
  return String(value);
}

function Body({ view }: { view: ReportView }) {
  if (view.rows.length === 0) {
    return <Empty>Nothing to report for this edition yet.</Empty>;
  }

  return (
    <Table>
      <THead>
        <TR>
          {view.columns.map((c) => (
            // Numbers right, words left — a column of figures that is not
            // right-aligned cannot be scanned for an order of magnitude.
            <TH key={c.key} style={c.kind === 'text' ? undefined : { textAlign: 'right' }}>
              {c.label}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {/* ⚠️ Keyed on the row's own first text column, not on its index. Every
            report's leading column is what the row IS — a status, a bay, a
            requester type — and it is unique within the table, which an index is
            only by accident. */}
        {view.rows.map((row) => (
          <TR key={String(row[view.columns[0]?.key ?? ''] ?? '')}>
            {view.columns.map((c) => (
              <TD key={c.key} style={c.kind === 'text' ? undefined : { textAlign: 'right' }}>
                {cell(row[c.key], c.kind)}
              </TD>
            ))}
          </TR>
        ))}
        {view.total && (
          // The foot, as a row rather than a `<tfoot>`: the table component owns
          // its own sections, and a total that is visually a row and structurally
          // a footer reads differently to a screen reader than it looks.
          <TR>
            {view.columns.map((c) => (
              <TD
                key={c.key}
                style={{
                  fontWeight: 700,
                  borderTop: '2px solid var(--bd)',
                  ...(c.kind === 'text' ? {} : { textAlign: 'right' }),
                }}
              >
                {cell(view.total?.[c.key], c.kind)}
              </TD>
            ))}
          </TR>
        )}
      </TBody>
    </Table>
  );
}

export function Report() {
  const { key = '' } = useParams();
  const { data, error, loading } = useLoad(() => getReport(key), [key]);

  // ⚠️ `if (loading)`, NOT the `loading && !data` the rest of the module uses
  // — and the difference is `[key]`. One `<Report>` serves every report in the
  // catalog, so on the way from one to the next `data` still holds the LAST
  // one; keeping it on screen would put the previous report's rows under the
  // new report's heading. Everywhere that guard is relaxed, the load has no
  // deps and the stale data is the same data.
  if (loading) return <Loading />;
  if (error || !data) {
    return (
      <div>
        <ErrorBox>{error?.message ?? 'Could not load this report.'}</ErrorBox>
        <div style={{ marginTop: 14 }}>
          <Link to='/m/stalls/dashboards' style={{ fontSize: 12.5, color: 'var(--pri)' }}>
            Back to Reports & Dashboards
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <H1
        icon={<Icon name='bar-chart' size={18} />}
        sub={`${data.note} · ${data.editionLabel}`}
        actions={
          // ⚠️ A navigation, not a fetch. The response carries a
          // `content-disposition`, which is the browser's own way of saving a
          // file — pulling the CSV into memory to re-create that is work for a
          // worse result on a slow connection. `Btn` renders a button, so the
          // navigation is the click handler rather than an `href`; the row is
          // disabled when there is nothing in the table to export.
          <Btn
            kind='primary'
            onClick={() => {
              window.location.href = reportCsvUrl(data.key);
            }}
            disabled={data.rows.length === 0}
          >
            <Icon name='download' size={14} />
            Export CSV
          </Btn>
        }
      >
        {data.title}
      </H1>

      <Body view={data} />
    </div>
  );
}

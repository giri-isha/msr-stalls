import type { ChallanView, EquipmentAction, EquipmentRow } from '@msr/stalls';
import { formatInr } from '@msr/stalls';
import { useMemo, useState } from 'react';
import { equipmentAction, getChallan, listEquipment, patchEquipment } from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Checkbox,
  Dialog,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Input,
  Loading,
  Search,
  Tag,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  toolBtnStyle,
  useIsMobile,
  useToast,
} from '../ui';

/**
 * Chairs and tables, over the two days of the counter.
 *
 * Day one: hand out what was ordered online, add anything extra and take cash
 * for it, print the two-part challan. Day two: collect, and note what is
 * missing or broken — which is what the refund screen then deducts from the
 * deposit.
 *
 * ⚠️ The "Requested" column is a SNAPSHOT taken when the row was opened, not a
 * live read of the request. The vendor is standing at the counter holding a
 * printed challan; if the request were edited that evening the paper and the
 * screen would disagree, and the paper is what was signed.
 */
export function Equipment() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload, setData } = useLoad(listEquipment);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'out' | 'flagged'>('all');
  const [challan, setChallan] = useState<ChallanView | null>(null);
  const mobile = useIsMobile();
  const canWrite = can('checkin.write');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (r) =>
          !term ||
          r.stallName.toLowerCase().includes(term) ||
          r.stallNumbers.some((n) => n.toLowerCase().includes(term)),
      )
      .filter((r) => {
        if (filter === 'todo') return r.distributedAt === null;
        if (filter === 'out') return r.distributedAt !== null && r.collectedAt === null;
        if (filter === 'flagged') return r.flagged;
        return true;
      });
  }, [data, q, filter]);

  const replace = (row: EquipmentRow) =>
    setData((prev) => (prev ?? []).map((r) => (r.requestId === row.requestId ? row : r)));

  const run = async (fn: () => Promise<EquipmentRow>, message?: string) => {
    try {
      replace(await fn());
      if (message) toast.ok(message);
    } catch (e) {
      toast.fail(e);
      reload();
    }
  };

  const openChallan = async (id: string) => {
    try {
      setChallan(await getChallan(id));
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <div>
      <H1
        icon={<Icon name='layout-grid' size={18} />}
        sub='Distribute what was ordered, charge for extras at the counter, then collect and note anything missing or broken.'
      >
        Chairs &amp; Tables
      </H1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <Search value={q} onChange={setQ} placeholder='Search stall or stall number…' />
        {(
          [
            ['all', 'All'],
            ['todo', 'To distribute'],
            ['out', 'Out — to collect'],
            ['flagged', 'Flagged only'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type='button'
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            style={toolBtnStyle(filter === key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorBox>{error.message}</ErrorBox>}
      {loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No stalls ordered chairs or tables.</Empty>
      ) : mobile ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <EquipmentCard
              key={r.requestId}
              row={r}
              canWrite={canWrite}
              onRun={run}
              onChallan={() => openChallan(r.requestId)}
            />
          ))}
        </div>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Stall</TH>
                <TH align='right'>Ordered</TH>
                <TH align='right'>Extra chairs</TH>
                <TH align='right'>Extra tables</TH>
                <TH align='right'>Cash due</TH>
                <TH>Returned</TH>
                <TH>Condition</TH>
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.requestId}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {r.stallName}
                      {r.flagged && (
                        <Tag tone='des' size='sm' style={{ marginLeft: 6 }}>
                          Flagged
                        </Tag>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: 'ui-monospace,Menlo,monospace',
                        fontSize: 11.5,
                        color: 'var(--mfg)',
                      }}
                    >
                      {r.stallNumbers.join(', ') || '—'}
                    </div>
                  </TD>
                  <TD align='right' style={{ whiteSpace: 'nowrap' }}>
                    {r.chairsRequested} ch / {r.tablesRequested} tb
                  </TD>
                  <TD align='right'>
                    <NumberCell
                      value={r.extraChairs}
                      disabled={!canWrite}
                      onCommit={(v) => run(() => patchEquipment(r.requestId, { extraChairs: v }))}
                    />
                  </TD>
                  <TD align='right'>
                    <NumberCell
                      value={r.extraTables}
                      disabled={!canWrite}
                      onCommit={(v) => run(() => patchEquipment(r.requestId, { extraTables: v }))}
                    />
                  </TD>
                  <TD align='right'>
                    {r.extraChargePaise > 0 ? (
                      <Tag tone={r.extraCollectedAt ? 'ok' : 'warn'} size='sm'>
                        {formatInr(r.extraChargePaise)}
                        {r.extraCollectedAt ? ' paid' : ''}
                      </Tag>
                    ) : (
                      <span style={{ color: 'var(--mfg)' }}>—</span>
                    )}
                  </TD>
                  <TD>
                    <StageTag row={r} />
                  </TD>
                  <TD>
                    <ConditionCell row={r} canWrite={canWrite} onRun={run} />
                  </TD>
                  <TD align='right'>
                    <Actions
                      row={r}
                      canWrite={canWrite}
                      onRun={run}
                      onChallan={() => openChallan(r.requestId)}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {challan && <ChallanDialog data={challan} onClose={() => setChallan(null)} />}
    </div>
  );
}

type Run = (fn: () => Promise<EquipmentRow>, message?: string) => Promise<void>;

function StageTag({ row }: { row: EquipmentRow }) {
  if (row.collectedAt) {
    return (
      <Tag tone='ok' size='sm'>
        Collected
      </Tag>
    );
  }
  if (row.distributedAt) {
    return (
      <Tag tone='info' size='sm'>
        Out
      </Tag>
    );
  }
  return (
    <Tag tone='neutral' size='sm'>
      Not out
    </Tag>
  );
}

/** Commits on blur, not on every keystroke: a counter typing "12" would
 *  otherwise send a 1 and a 12, and the first of those is a real charge. */
function NumberCell({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Input
      type='number'
      min={0}
      value={text}
      disabled={disabled}
      aria-label='Count'
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = Number(text);
        if (Number.isInteger(v) && v >= 0 && v !== value) onCommit(v);
        else setText(String(value));
      }}
      style={{ width: 64, padding: '5px 8px', fontSize: 12.5, textAlign: 'right' }}
    />
  );
}

function ConditionCell({
  row,
  canWrite,
  onRun,
}: {
  row: EquipmentRow;
  canWrite: boolean;
  onRun: Run;
}) {
  const [note, setNote] = useState(row.note ?? '');
  return (
    <div style={{ display: 'grid', gap: 5, minWidth: 220 }}>
      <Input
        value={note}
        disabled={!canWrite}
        aria-label='Condition note'
        placeholder='e.g. 1 chair broken'
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== (row.note ?? '')) onRun(() => patchEquipment(row.requestId, { note }));
        }}
        style={{ padding: '5px 8px', fontSize: 12 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
        <span style={{ color: 'var(--mfg)' }}>Missing</span>
        <NumberCell
          value={row.missingChairs}
          disabled={!canWrite}
          onCommit={(v) => onRun(() => patchEquipment(row.requestId, { missingChairs: v }))}
        />
        <span style={{ color: 'var(--mfg)' }}>ch</span>
        <NumberCell
          value={row.missingTables}
          disabled={!canWrite}
          onCommit={(v) => onRun(() => patchEquipment(row.requestId, { missingTables: v }))}
        />
        <span style={{ color: 'var(--mfg)' }}>tb</span>
        <label
          htmlFor={`damaged-${row.requestId}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Checkbox
            id={`damaged-${row.requestId}`}
            checked={row.damaged}
            disabled={!canWrite}
            onChange={(e) =>
              onRun(() => patchEquipment(row.requestId, { damaged: e.target.checked }))
            }
          />
          Damaged
        </label>
      </div>
      {row.deductionPaise > 0 && (
        <span style={{ fontSize: 11, color: 'var(--warn-fg,var(--mfg))' }}>
          Deduction {formatInr(row.deductionPaise)}
        </span>
      )}
    </div>
  );
}

function Actions({
  row,
  canWrite,
  onRun,
  onChallan,
}: {
  row: EquipmentRow;
  canWrite: boolean;
  onRun: Run;
  onChallan: () => void;
}) {
  const act = (action: EquipmentAction, message: string) =>
    onRun(() => equipmentAction(row.requestId, action), message);

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {canWrite &&
        (row.distributedAt ? (
          <Btn onClick={() => act('UNDISTRIBUTE', 'Marked not distributed.')}>Undo</Btn>
        ) : (
          <Btn kind='primary' onClick={() => act('DISTRIBUTE', 'Distributed.')}>
            Distribute
          </Btn>
        ))}
      {canWrite && row.extraChargePaise > 0 && !row.extraCollectedAt && (
        <Btn onClick={() => act('COLLECT_EXTRA_PAYMENT', 'Cash recorded.')}>Cash taken</Btn>
      )}
      {canWrite &&
        row.distributedAt &&
        (row.collectedAt ? (
          <Btn onClick={() => act('UNCOLLECT', 'Marked not collected.')}>Undo collect</Btn>
        ) : (
          <Btn onClick={() => act('COLLECT', 'Collected.')}>Collect</Btn>
        ))}
      {canWrite && (
        <Btn
          kind={row.flagged ? 'danger' : 'ghost'}
          onClick={() => onRun(() => patchEquipment(row.requestId, { flagged: !row.flagged }))}
        >
          <Icon name='alert-triangle' size={13} />
          {row.flagged ? 'Unflag' : 'Flag'}
        </Btn>
      )}
      <Btn onClick={onChallan}>Challan</Btn>
    </div>
  );
}

function EquipmentCard({
  row,
  canWrite,
  onRun,
  onChallan,
}: {
  row: EquipmentRow;
  canWrite: boolean;
  onRun: Run;
  onChallan: () => void;
}) {
  return (
    <Card pad={14} style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{row.stallName}</div>
          <div
            style={{
              fontFamily: 'ui-monospace,Menlo,monospace',
              fontSize: 11.5,
              color: 'var(--mfg)',
            }}
          >
            {row.stallNumbers.join(', ') || '—'} · {row.chairsRequested} chairs /{' '}
            {row.tablesRequested} tables
          </div>
        </div>
        <StageTag row={row} />
      </div>
      <ConditionCell row={row} canWrite={canWrite} onRun={onRun} />
      <Actions row={row} canWrite={canWrite} onRun={onRun} onChallan={onChallan} />
    </Card>
  );
}

// ── The paper challan ───────────────────────────────────────────────────────

/**
 * Two identical halves — vendor copy and office copy — on one sheet, with blank
 * boxes for the figures written in by hand at the counter.
 *
 * The blanks are deliberate and copy the 2025 slip: rent, advance, total and
 * returned are filled in with a pen while the vendor watches, then signed. The
 * system records the counts; the paper records the cash.
 */
function ChallanDialog({ data, onClose }: { data: ChallanView; onClose: () => void }) {
  return (
    <Dialog
      title='Chairs and tables challan'
      onClose={onClose}
      width={760}
      footer={
        <Btn kind='primary' onClick={() => window.print()}>
          <Icon name='download' size={14} />
          Print
        </Btn>
      }
    >
      <style>{CHALLAN_CSS}</style>
      <div className='msrs-challan' style={{ display: 'grid', gap: 14 }}>
        {(['Vendor copy', 'Office copy'] as const).map((copy) => (
          <div
            key={copy}
            style={{
              border: '1px solid var(--bd)',
              borderRadius: 'var(--r2)',
              padding: 14,
              fontSize: 12.5,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              <span>
                Chairs and Tables Challan — {copy} · {data.editionName}
              </span>
              <span>Category: {data.category.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
            <div style={{ display: 'grid', gap: 3, marginBottom: 8 }}>
              <div>
                Stall Number: <strong>{data.stallNumber}</strong> &nbsp;&nbsp; Stall Name:{' '}
                <strong>{data.stallName}</strong>
              </div>
              <div>
                Owner: <strong>{data.ownerName}</strong> &nbsp;&nbsp; Contact:{' '}
                <strong>{data.contactNumber}</strong>
              </div>
              <div>
                Ordered online: <strong>{data.chairsOnline}</strong> chairs,{' '}
                <strong>{data.tablesOnline}</strong> tables
              </div>
              <div>
                Extra at counter: <strong>{data.extraChairs}</strong> chairs,{' '}
                <strong>{data.extraTables}</strong> tables — {formatInr(data.extraChargePaise)}
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cell} />
                  <th style={cell}>Chairs</th>
                  <th style={cell}>Tables</th>
                </tr>
              </thead>
              <tbody>
                {['Paid in cash on MSR day — rent', 'Advance', 'Total', 'Returned'].map((label) => (
                  <tr key={label}>
                    <td style={cell}>{label}</td>
                    <td style={cell}>&nbsp;</td>
                    <td style={cell}>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 10, color: 'var(--mfg)' }}>
              Signature: ______________________
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

const cell: React.CSSProperties = {
  border: '1px solid var(--bd)',
  padding: '4px 6px',
  textAlign: 'left',
};

const CHALLAN_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body * { visibility: hidden; }
  .msrs-challan, .msrs-challan * { visibility: visible; }
  .msrs-challan { position: absolute; inset: 0; color: #000; }
  .msrs-challan td, .msrs-challan th { border: 1px solid #000 !important; }
}
`;

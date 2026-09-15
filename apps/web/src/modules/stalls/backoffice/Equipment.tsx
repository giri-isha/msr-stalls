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
  FormField,
  H1,
  Icon,
  IconBtn,
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
  // ⚠️ The page holds it, not the row: a dialog is a <div>, and a <div> inside
  // a <tr> is markup React will not have.
  const [editing, setEditing] = useState<EquipmentRow | null>(null);
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
      return true;
    } catch (e) {
      toast.fail(e);
      reload();
      return false;
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
              onEdit={() => setEditing(r)}
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
                  <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {r.extraChairs || <span style={{ color: 'var(--mfg)' }}>—</span>}
                  </TD>
                  <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {r.extraTables || <span style={{ color: 'var(--mfg)' }}>—</span>}
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
                    <ConditionSummary row={r} />
                  </TD>
                  <TD align='right'>
                    <Actions
                      row={r}
                      canWrite={canWrite}
                      onRun={run}
                      onEdit={() => setEditing(r)}
                      onChallan={() => openChallan(r.requestId)}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {editing && <CounterDialog row={editing} onRun={run} onClose={() => setEditing(null)} />}
      {challan && <ChallanDialog data={challan} onClose={() => setChallan(null)} />}
    </div>
  );
}

/** ⚠️ Answers whether it went through, so the counter dialog can stay open on a
 *  refusal rather than closing and taking the figures with it. */
type Run = (fn: () => Promise<EquipmentRow>, message?: string) => Promise<boolean>;

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

/**
 * What was found when the chairs came back — read here, changed in the dialog.
 *
 * ⚠️ Nothing at all when nothing is wrong. The overwhelming majority of rows
 * return complete, and a column of empty fields and unticked boxes made the
 * handful that did not look exactly like the ones that did.
 */
function ConditionSummary({ row }: { row: EquipmentRow }) {
  const missing = [
    row.missingChairs > 0 ? `${row.missingChairs} ch` : null,
    row.missingTables > 0 ? `${row.missingTables} tb` : null,
  ].filter(Boolean);
  const clean = missing.length === 0 && !row.damaged && !row.note;

  if (clean) return <span style={{ color: 'var(--mfg)' }}>—</span>;

  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {missing.length > 0 && (
          <Tag tone='warn' size='sm'>
            {missing.join(' / ')} missing
          </Tag>
        )}
        {row.damaged && (
          <Tag tone='des' size='sm'>
            Damaged
          </Tag>
        )}
      </div>
      {row.note && <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{row.note}</span>}
      {row.deductionPaise > 0 && (
        <span style={{ fontSize: 11, color: 'var(--warn-fg,var(--mfg))' }}>
          Deduction {formatInr(row.deductionPaise)}
        </span>
      )}
    </div>
  );
}

/**
 * Everything the counter writes down, in one box.
 *
 * 🔴 One PATCH, not six. These were six inline controls that each fired on its
 * own blur or tick, so a counter correcting an entry — two chairs missing, no,
 * three, and one of them broken — sent three requests, and the middle one was
 * a figure nobody meant. Worse, the extras are CHARGED: a half-typed "12" used
 * to leave the counter as a 1 before it left as a 12. Here the figures are
 * settled first and sent once.
 */
function CounterDialog({
  row,
  onRun,
  onClose,
}: {
  row: EquipmentRow;
  onRun: Run;
  onClose: () => void;
}) {
  const [v, setV] = useState({
    extraChairs: String(row.extraChairs),
    extraTables: String(row.extraTables),
    missingChairs: String(row.missingChairs),
    missingTables: String(row.missingTables),
    damaged: row.damaged,
    note: row.note ?? '',
  });
  const [saving, setSaving] = useState(false);

  const num = (s: string) => {
    const x = Number(s);
    return Number.isInteger(x) && x >= 0 && x <= 500 ? x : null;
  };
  const counts = [v.extraChairs, v.extraTables, v.missingChairs, v.missingTables];
  const valid = counts.every((s) => num(s) !== null);

  // ⚠️ The extras are frozen once the cash has been taken. Re-pricing a charge
  // the vendor has already paid at the counter would leave the money in the
  // drawer disagreeing with the figure on the screen.
  const extrasLocked = row.extraCollectedAt !== null;

  const field = (k: 'extraChairs' | 'extraTables' | 'missingChairs' | 'missingTables') => ({
    type: 'number' as const,
    min: 0,
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }),
  });

  const save = async () => {
    setSaving(true);
    const ok = await onRun(
      () =>
        patchEquipment(row.requestId, {
          ...(extrasLocked
            ? {}
            : { extraChairs: num(v.extraChairs) ?? 0, extraTables: num(v.extraTables) ?? 0 }),
          missingChairs: num(v.missingChairs) ?? 0,
          missingTables: num(v.missingTables) ?? 0,
          damaged: v.damaged,
          note: v.note.trim(),
        }),
      'Saved.',
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title={row.stallName}
      note={`${row.stallNumbers.join(', ') || 'No stall number'} · ordered ${row.chairsRequested} chairs and ${row.tablesRequested} tables.`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={saving || !valid}>
            Save
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Section title='Taken at the counter'>
          {extrasLocked ? (
            <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
              {formatInr(row.extraChargePaise)} for {row.extraChairs} extra chairs and{' '}
              {row.extraTables} extra tables has already been collected in cash, so the extras are
              fixed.
            </div>
          ) : (
            <Pair>
              <FormField id='eq-xch' label='Extra chairs'>
                <Input id='eq-xch' {...field('extraChairs')} />
              </FormField>
              <FormField id='eq-xtb' label='Extra tables'>
                <Input id='eq-xtb' {...field('extraTables')} />
              </FormField>
            </Pair>
          )}
        </Section>

        <Section title='Found on return'>
          <Pair>
            <FormField id='eq-mch' label='Chairs missing'>
              <Input id='eq-mch' {...field('missingChairs')} />
            </FormField>
            <FormField id='eq-mtb' label='Tables missing'>
              <Input id='eq-mtb' {...field('missingTables')} />
            </FormField>
          </Pair>
          <FormField id='eq-note' label='Condition note'>
            <Input
              id='eq-note'
              value={v.note}
              placeholder='e.g. 1 chair broken'
              onChange={(e) => setV({ ...v, note: e.target.value })}
            />
          </FormField>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the label WRAPS its control,
              which associates them implicitly; the rule cannot see the input inside
              <Checkbox>. */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <Checkbox
              checked={v.damaged}
              onChange={(e) => setV({ ...v, damaged: e.target.checked })}
            />
            Damaged
          </label>
        </Section>

        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          What is missing or damaged is priced from the admin’s replacement rates and deducted from
          this stall’s deposit on the refund screen.
        </div>
      </div>
    </Dialog>
  );
}

/** A titled block inside the counter dialog. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.6px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** Two fields side by side, stacking on a phone. */
function Pair({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function Actions({
  row,
  canWrite,
  onRun,
  onEdit,
  onChallan,
}: {
  row: EquipmentRow;
  canWrite: boolean;
  onRun: Run;
  onEdit: () => void;
  onChallan: () => void;
}) {
  const act = (action: EquipmentAction, message: string) =>
    onRun(() => equipmentAction(row.requestId, action), message);

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {canWrite && <IconBtn label={`Edit ${row.stallName}`} glyph='pencil' onClick={onEdit} />}
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
  onEdit,
  onChallan,
}: {
  row: EquipmentRow;
  canWrite: boolean;
  onRun: Run;
  onEdit: () => void;
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
      {/* The extras and the cash line, which the desktop table gives their own
          columns — a card has no columns, so they are said here. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(row.extraChairs > 0 || row.extraTables > 0) && (
          <Tag size='sm'>
            +{row.extraChairs} ch / +{row.extraTables} tb
          </Tag>
        )}
        {row.extraChargePaise > 0 && (
          <Tag tone={row.extraCollectedAt ? 'ok' : 'warn'} size='sm'>
            {formatInr(row.extraChargePaise)}
            {row.extraCollectedAt ? ' paid' : ''}
          </Tag>
        )}
        <ConditionSummary row={row} />
      </div>
      <Actions row={row} canWrite={canWrite} onRun={onRun} onEdit={onEdit} onChallan={onChallan} />
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

import type { RateCardEntry, RateScope } from '@msr/stalls';
import { formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { Fragment, useEffect, useState } from 'react';
import * as api from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Checkbox,
  Dialog,
  Empty,
  ErrorBox,
  FormField,
  H1,
  Icon,
  AddBtn,
  DialogButtons,
  EditBtn,
  IconBtn,
  Input,
  Loading,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tag,
  toolBtnStyle,
  useToast,
} from '../ui';
import { Panel } from '../components/Panel';
import { Declarations } from './Declarations';

const TABS = [
  { label: 'Bays', glyph: 'map-pin' },
  { label: 'Planning columns', glyph: 'layout-grid' },
  { label: 'Rates', glyph: 'ticket' },
  { label: 'Charges', glyph: 'file-text' },
  { label: 'Fines', glyph: 'ban' },
  { label: 'Custom fields', glyph: 'sliders' },
  { label: 'Declarations', glyph: 'scroll' },
  { label: 'Flow', glyph: 'arrow-left-right' },
  { label: 'Editions', glyph: 'calendar' },
] as const;
type Tab = (typeof TABS)[number]['label'];

/** A grid of fields at the rhythm the panels use. */
function Grid({ min = 220, children }: { min?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`,
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

/** Rupee input over a paise value. The number the admin types is rupees; the
 *  number that crosses the wire is integer paise. */
function RupeeInput({
  id,
  label,
  paise,
  onPaise,
  disabled,
}: {
  id: string;
  label: string;
  paise: number;
  onPaise: (p: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(paiseToRupees(paise)));
  useEffect(() => setText(String(paiseToRupees(paise))), [paise]);
  return (
    <FormField id={id} label={label}>
      <div style={{ position: 'relative' }}>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 13,
            color: 'var(--mfg)',
            pointerEvents: 'none',
          }}
        >
          ₹
        </span>
        <Input
          id={id}
          type='number'
          min={0}
          step='1'
          style={{ paddingLeft: 26 }}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = Number(text);
            if (Number.isFinite(v) && v >= 0) onPaise(rupeesToPaise(v));
            else setText(String(paiseToRupees(paise)));
          }}
        />
      </div>
    </FormField>
  );
}

export function Admin() {
  const { can } = useMe();
  const toast = useToast();
  const writable = can('config.write');
  const [tab, setTab] = useState<Tab>('Bays');
  const cfg = useLoad(api.getConfig);

  if (cfg.loading) return <Loading />;
  if (cfg.error || !cfg.data)
    return <ErrorBox>{cfg.error?.message ?? 'Could not load the configuration.'}</ErrorBox>;
  const c = cfg.data;

  // ⚠️ Returns whether it went through. The dialogs below close on `true` and
  // stay open on `false` — a refused save that closed the box anyway would take
  // the admin's typing with it, which is exactly when they least want to retype.
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.ok(label);
      cfg.reload();
      return true;
    } catch (e) {
      toast.fail(e);
      return false;
    }
  };

  return (
    <div>
      <H1
        icon={<Icon name='settings' size={18} />}
        sub={
          <>
            {c.edition.name} ·{' '}
            <Tag tone={writable ? 'ok' : 'neutral'} size='sm'>
              {writable ? 'you can edit' : 'read only'}
            </Tag>
          </>
        }
      >
        Admin
      </H1>

      {/* ⚠️ Tabs as toolbar buttons on the shared control skin, not an
          underlined rail. `toolBtnStyle` is the one look a chosen control wears
          across the product — the reference module's own note on it is about
          three near-copies of exactly this drifting apart. A tab strip here
          would be a fourth. */}
      <div
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}
        role='tablist'
        aria-label='Configuration sections'
      >
        {TABS.map((t) => (
          <button
            key={t.label}
            type='button'
            role='tab'
            aria-selected={tab === t.label}
            onClick={() => setTab(t.label)}
            style={toolBtnStyle(tab === t.label)}
          >
            <Icon name={t.glyph} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'Bays' && <Zones c={c} writable={writable} run={run} />}
      {tab === 'Planning columns' && <PlanCategories c={c} writable={writable} run={run} />}
      {tab === 'Rates' && <Rates c={c} writable={writable} run={run} />}
      {tab === 'Charges' && <Charges c={c} writable={writable} run={run} />}
      {tab === 'Fines' && <Fines c={c} writable={writable} run={run} />}
      {tab === 'Custom fields' && <CustomFields c={c} writable={writable} run={run} />}
      {/* ⚠️ Reads its own data rather than taking `c`. The config payload is
          what is LIVE; this screen shows every version including the archived
          ones, which is a different question and a different query. */}
      {tab === 'Declarations' && <Declarations writable={writable} />}
      {tab === 'Flow' && <Flow c={c} writable={writable} run={run} />}
      {/* ⚠️ Users and Roles used to be two tabs here. They are screens of their
          own under Access now — each one a full page with its own toolbar,
          rather than a page inside a strip that had grown to ten items. */}
      {tab === 'Editions' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <EditionSettings c={c} writable={writable} run={run} />
          <Editions writable={writable} run={run} />
        </div>
      )}
    </div>
  );
}

type PanelProps = {
  c: api.BackofficeConfig;
  writable: boolean;
  run: (l: string, f: () => Promise<unknown>) => Promise<boolean>;
};

/**
 * Bays, added and removed from here.
 *
 * 🔴 The venue layout is redrawn every year. This used to be a closed union of
 * the seven codes 2025 happened to use, so a new bay meant a code change and a
 * redeploy — an edition's layout waiting on an engineer.
 *
 * ⚠️ A bay holding stalls cannot be removed, and the row says so before the
 * button is pressed rather than after a refused request. The alternative is
 * cascading, which would take the stalls, their allocations and the record of
 * who stood where with them.
 */
function Zones({ c, writable, run }: PanelProps) {
  // ⚠️ Held by the PANEL, not the row. A dialog is a <div>, and a <div> inside
  // a <tr> is invalid markup React will complain about — so the row raises the
  // intent and the box is rendered out here, beside the table.
  const [editing, setEditing] = useState<api.BackofficeConfig['zones'][number] | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Panel
      title='Bays'
      note='The physical areas stalls are planned into. The layout is redrawn each edition, so bays are added and removed here rather than in a migration.'
      actions={<AddBtn what='bay' writable={writable} onClick={() => setAdding(true)} />}
    >
      <Table>
        <THead>
          <TR>
            <TH>Code</TH>
            <TH>Name</TH>
            <TH align='right'>Expected crowd</TH>
            <TH>Vendors</TH>
            <TH align='right'>Stalls</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {c.zones.map((z) => (
            <ZoneRow key={z.id} z={z} writable={writable} run={run} onEdit={setEditing} />
          ))}
        </TBody>
      </Table>

      {editing && <ZoneDialog z={editing} run={run} onClose={() => setEditing(null)} />}

      {adding && <ZoneAddDialog run={run} onClose={() => setAdding(false)} />}
    </Panel>
  );
}

/**
 * The planning grid's columns.
 *
 * 🔴 The 2025 sheet carries sponsor and Adiyogi columns the old enum never had,
 * so a sponsor stall could not be counted apart from an ashram one — and the
 * whole purpose of the grid is to see how many of each are standing in a bay.
 *
 * ⚠️ Saved whole: a column left out of the list is one the edition no longer
 * carries. A column already planned or allocated against cannot be removed, and
 * `inUse` is why its delete is disabled rather than refused after the fact.
 */
function PlanCategories({ c, writable, run }: PanelProps) {
  const [rows, setRows] = useState(c.planCategories);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => setRows(c.planCategories), [c.planCategories]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(c.planCategories);

  const save = () =>
    run('Columns saved', () =>
      api.putPlanCategories(
        rows.map((r, i) => ({ key: r.key, name: r.name, isFood: r.isFood, sortOrder: i })),
      ),
    );

  return (
    <Panel
      title='Planning columns'
      note='What can occupy a stall position. These are the Planning grid’s columns, in this order. A column something is already planned or allocated against cannot be removed.'
      actions={<AddBtn what='column' writable={writable} onClick={() => setAdding(true)} />}
      footer={
        <Btn kind='primary' disabled={!writable || !dirty} onClick={save}>
          <Icon name='check' size={14} />
          Save columns
        </Btn>
      }
    >
      <Table>
        <THead>
          <TR>
            <TH>Key</TH>
            <TH>Name</TH>
            <TH>Food</TH>
            <TH align='right'>Order</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {rows.map((r, i) => (
            <TR key={r.key}>
              <TD mono>{r.key}</TD>
              <TD>{r.name}</TD>
              <TD muted>{r.isFood ? 'Yes' : '—'}</TD>
              <TD align='right'>
                <IconBtn
                  label={`Move ${r.key} up`}
                  glyph='chevron-up'
                  disabled={!writable || i === 0}
                  onClick={() =>
                    setRows((rs) => {
                      const next = [...rs];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })
                  }
                />
                <IconBtn
                  label={`Move ${r.key} down`}
                  glyph='chevron-down'
                  disabled={!writable || i === rows.length - 1}
                  onClick={() =>
                    setRows((rs) => {
                      const next = [...rs];
                      [next[i], next[i + 1]] = [next[i + 1], next[i]];
                      return next;
                    })
                  }
                />
              </TD>
              <TD align='right' style={{ whiteSpace: 'nowrap' }}>
                <EditBtn what={r.key} writable={writable} onClick={() => setEditing(i)} />
                {r.inUse ? (
                  <span style={{ fontSize: 11.5, color: 'var(--mfg)', marginLeft: 6 }}>In use</span>
                ) : (
                  <IconBtn
                    label={`Remove ${r.key}`}
                    glyph='trash'
                    disabled={!writable}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  />
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {editing !== null && rows[editing] && (
        <ColumnDialog
          row={rows[editing]}
          onClose={() => setEditing(null)}
          onApply={(patch) => {
            setRows((rs) => rs.map((x, j) => (j === editing ? { ...x, ...patch } : x)));
            setEditing(null);
          }}
        />
      )}

      {adding && (
        <PlanCategoryAddDialog
          taken={rows.map((r) => r.key)}
          onAdd={(row) => {
            setRows((rs) => [...rs, { ...row, sortOrder: rs.length, inUse: false }]);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </Panel>
  );
}

/**
 * One planning column, in a box.
 *
 * ⚠️ This one writes NOTHING. The columns are saved whole by the panel — a
 * column dropped from the list is a column the edition no longer carries — so
 * the dialog hands its change back to the draft and the panel's Save is still
 * the only thing that crosses the wire. The footer says so, because a box with
 * a Save button in it that does not save is otherwise a lie.
 */
/**
 * A new planning column.
 *
 * ⚠️ Writes NOTHING, like `ColumnDialog`. The columns are saved whole by the
 * panel, so this hands a row back and the panel's own Save is still the only
 * thing that reaches the API — which is also why the key is checked against the
 * DRAFT list rather than the saved one. Adding SPONSOR_FOOD twice before
 * pressing Save has to be refused by the second dialog, and the server has not
 * heard of the first one yet.
 */
function PlanCategoryAddDialog({
  taken,
  onAdd,
  onClose,
}: {
  taken: string[];
  onAdd: (row: { key: string; name: string; isFood: boolean }) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [isFood, setIsFood] = useState(false);
  const code = key.trim().toUpperCase();
  const valid = /^[A-Z][A-Z0-9_]{0,39}$/.test(code) && !taken.includes(code);

  return (
    <Dialog
      title='Add a column'
      note='Added to the list — nothing is written until Save columns. The key is what every saved plan will refer to, so it cannot be changed afterwards.'
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() => onAdd({ key: code, name: name.trim(), isFood })}
          disabled={!valid || name.trim() === ''}
          save='Add column'
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='nc-key' label='Key'>
          <Input
            id='nc-key'
            value={key}
            placeholder='SPONSOR_FOOD'
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
        </FormField>
        <FormField id='nc-name' label='Column heading'>
          <Input
            id='nc-name'
            value={name}
            placeholder='Sponsor food'
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField id='nc-food' label='Food'>
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
            <Checkbox checked={isFood} onChange={(e) => setIsFood(e.target.checked)} />
            Counts as a food stall
          </label>
        </FormField>
      </div>
    </Dialog>
  );
}

function ColumnDialog({
  row,
  onApply,
  onClose,
}: {
  row: api.BackofficeConfig['planCategories'][number];
  onApply: (patch: { name: string; isFood: boolean }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [isFood, setIsFood] = useState(row.isFood);
  return (
    <Dialog
      title={`Edit ${row.key}`}
      note='The key is what the planning grid and every saved plan refer to, so it cannot be changed. Nothing is written until Save columns.'
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() => onApply({ name: name.trim(), isFood })}
          disabled={name.trim() === ''}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='pc-name' label='Column heading'>
          <Input id='pc-name' value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField id='pc-food' label='Food'>
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
            <Checkbox checked={isFood} onChange={(e) => setIsFood(e.target.checked)} />
            Counts as a food stall
          </label>
        </FormField>
      </div>
    </Dialog>
  );
}

/**
 * The edition's own settings.
 *
 * The two virtual-account prefixes are Finance's: a requester's rent and their
 * deposit are paid into accounts built from the prefix and their mobile number,
 * so an edition with no prefix issued yet quotes no account to pay into.
 */
function EditionSettings({ c, writable, run }: PanelProps) {
  const [v, setV] = useState({
    name: c.edition.name,
    virtualAccountRentPrefix: '',
    virtualAccountDepositPrefix: '',
    maxStallsPerRequest: 1,
    termsUrl: '',
  });
  const [loaded, setLoaded] = useState<string | null>(null);
  if (c.edition.id !== loaded) {
    setLoaded(c.edition.id);
    setV({
      name: c.edition.name,
      virtualAccountRentPrefix: c.edition.virtualAccountRentPrefix ?? '',
      virtualAccountDepositPrefix: c.edition.virtualAccountDepositPrefix ?? '',
      maxStallsPerRequest: c.edition.maxStallsPerRequest,
      termsUrl: c.edition.termsUrl ?? '',
    });
  }

  return (
    <Panel
      title='Edition settings'
      note='The edition’s name as it appears on every letter, the two virtual-account prefixes Finance issues for it, the cap on how many stalls one request may ask for in a single bay, and where this edition’s terms can be read.'
      footer={
        <Btn
          kind='primary'
          disabled={!writable}
          onClick={() =>
            run('Edition settings saved', () =>
              api.updateEditionSettings(c.edition.id, {
                name: v.name.trim(),
                virtualAccountRentPrefix: v.virtualAccountRentPrefix.trim() || null,
                virtualAccountDepositPrefix: v.virtualAccountDepositPrefix.trim() || null,
                maxStallsPerRequest: v.maxStallsPerRequest,
                termsUrl: v.termsUrl.trim() || null,
              }),
            )
          }
        >
          <Icon name='check' size={14} />
          Save settings
        </Btn>
      }
    >
      <Grid>
        <FormField id='ed-name' label='Edition name'>
          <Input
            id='ed-name'
            value={v.name}
            disabled={!writable}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </FormField>
        <FormField id='ed-rent' label='Virtual account prefix — rent'>
          <Input
            id='ed-rent'
            value={v.virtualAccountRentPrefix}
            placeholder='Not issued yet'
            disabled={!writable}
            onChange={(e) => setV({ ...v, virtualAccountRentPrefix: e.target.value.toUpperCase() })}
          />
        </FormField>
        <FormField id='ed-dep' label='Virtual account prefix — deposit'>
          <Input
            id='ed-dep'
            value={v.virtualAccountDepositPrefix}
            placeholder='Not issued yet'
            disabled={!writable}
            onChange={(e) =>
              setV({ ...v, virtualAccountDepositPrefix: e.target.value.toUpperCase() })
            }
          />
        </FormField>
        <FormField id='ed-max' label='Stalls per request'>
          <Input
            id='ed-max'
            type='number'
            min={1}
            max={20}
            value={v.maxStallsPerRequest}
            disabled={!writable}
            onChange={(e) => setV({ ...v, maxStallsPerRequest: Number(e.target.value) || 1 })}
          />
        </FormField>
      </Grid>
      {/* 🔴 The bank form records that a requester accepted the terms. This is
          the document they accepted — without it that consent cannot be
          produced if a stall is ever in dispute. Blank until the legal team
          issues the edition's document, and the form then shows the consent
          without a link rather than one that goes nowhere. */}
      <FormField
        id='ed-terms'
        label='Terms and conditions link'
        help='Shown beside the acceptance tick-box on the bank details form. Leave blank until the document is issued.'
      >
        <Input
          id='ed-terms'
          type='url'
          value={v.termsUrl}
          placeholder='https://…'
          disabled={!writable}
          onChange={(e) => setV({ ...v, termsUrl: e.target.value })}
        />
      </FormField>
    </Panel>
  );
}

/** A bay, as a record. The figures are read here and changed in the dialog the
 *  pencil opens. */
function ZoneRow({
  z,
  writable,
  run,
  onEdit,
}: {
  z: api.BackofficeConfig['zones'][number];
  onEdit: (z: api.BackofficeConfig['zones'][number]) => void;
} & Omit<PanelProps, 'c'>) {
  return (
    <TR>
      <TD mono style={{ fontWeight: 700 }}>
        {z.code}
      </TD>
      <TD>{z.name}</TD>
      <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
        {z.expectedCrowd.toLocaleString('en-IN')}
      </TD>
      <TD>
        {/* ⚠️ A tag only when the bay is closed. "Open" for everything else
            would put a badge on almost every row and leave the exception
            competing with the rule for attention. */}
        {z.isClosedToVendors ? (
          <Tag size='sm'>Closed to vendors</Tag>
        ) : (
          <span style={{ color: 'var(--mfg)' }}>Open</span>
        )}
      </TD>
      <TD align='right' muted>
        {z.stallCount}
      </TD>
      <TD align='right' style={{ whiteSpace: 'nowrap' }}>
        <EditBtn what={z.code} writable={writable} onClick={() => onEdit(z)} />
        {/* ⚠️ Disabled, with the reason, rather than offered and refused. A bay
            is emptied before it leaves a layout, so this is the normal order of
            work — and the alternative to refusing is a cascade that would take
            the stalls and the record of who stood in them. */}
        <IconBtn
          label={
            z.stallCount > 0
              ? `${z.code} has ${z.stallCount} stalls and cannot be removed`
              : `Remove ${z.code}`
          }
          glyph='trash'
          disabled={!writable || z.stallCount > 0}
          onClick={() => run(`${z.code} removed`, () => api.deleteZone(z.code))}
        />
      </TD>
    </TR>
  );
}

/**
 * A new bay.
 *
 * ⚠️ The code is asked for HERE and nowhere else. `ZoneDialog` cannot change it
 * — it is the bay's identity, and the stalls, allocations and planning rows
 * hanging off it all name it — so this is the one moment it is a question.
 */
function ZoneAddDialog({ run, onClose }: { run: PanelProps['run']; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [crowd, setCrowd] = useState('');
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = /^[A-Z]{1,2}\d{0,2}$/.test(code.trim().toUpperCase()) && name.trim() !== '';

  const add = async () => {
    setSaving(true);
    const ok = await run(`${code.toUpperCase()} added`, () =>
      api.createZone({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        expectedCrowd: Number(crowd) || 0,
        isClosedToVendors: closed,
      }),
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title='Add a bay'
      note='The code is the bay’s identity and cannot be changed afterwards.'
      onClose={onClose}
      footer={
        <DialogButtons onClose={onClose} onSave={add} disabled={saving || !valid} save='Add bay' />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='nz-code' label='Code'>
          <Input
            id='nz-code'
            value={code}
            placeholder='D1'
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </FormField>
        <FormField id='nz-name' label='Name'>
          <Input
            id='nz-name'
            value={name}
            placeholder='D1 — new lawn'
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField id='nz-crowd' label='Expected crowd'>
          <Input
            id='nz-crowd'
            type='number'
            min={0}
            value={crowd}
            onChange={(e) => setCrowd(e.target.value)}
          />
        </FormField>
        <FormField id='nz-closed' label='Vendors'>
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
            <Checkbox checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            Closed to vendors — ashram and local welfare only
          </label>
        </FormField>
      </div>
    </Dialog>
  );
}

function ZoneDialog({
  z,
  run,
  onClose,
}: {
  z: api.BackofficeConfig['zones'][number];
  run: PanelProps['run'];
  onClose: () => void;
}) {
  const [name, setName] = useState(z.name);
  const [crowd, setCrowd] = useState(String(z.expectedCrowd));
  const [closed, setClosed] = useState(z.isClosedToVendors);
  const [saving, setSaving] = useState(false);
  const dirty =
    name !== z.name || Number(crowd) !== z.expectedCrowd || closed !== z.isClosedToVendors;

  const save = async () => {
    setSaving(true);
    const ok = await run(`${z.code} saved`, () =>
      api.updateZone(z.code, {
        name: name.trim(),
        expectedCrowd: Number(crowd) || 0,
        isClosedToVendors: closed,
      }),
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title={`Edit ${z.code}`}
      note={`${z.stallCount} ${z.stallCount === 1 ? 'stall stands' : 'stalls stand'} in this bay. The code is the bay’s identity and cannot be changed here.`}
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={save}
          disabled={saving || !dirty || name.trim() === ''}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='z-name' label='Name'>
          <Input id='z-name' value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField id='z-crowd' label='Expected crowd'>
          <Input
            id='z-crowd'
            type='number'
            min={0}
            value={crowd}
            onChange={(e) => setCrowd(e.target.value)}
          />
        </FormField>
        <FormField id='z-closed' label='Vendors'>
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
            <Checkbox checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            Closed to vendors — ashram and local welfare only
          </label>
        </FormField>
      </div>
    </Dialog>
  );
}

/**
 * The rent matrix: one row per bay, four figures each.
 *
 * The old panel edited four numbers against two bands — "A4/B3/B4" and
 * "C1/C2" — which is how the printed form quotes it but not how the ground
 * works. Two bays that happen to share a letter are a different proposition
 * (a VIP bay behind Adiyogi against a general-seating bay) and could never be
 * priced apart. Worse, the bays closed to trade had no row at all, so the VAP
 * traders who pay the most of any local welfare stall were unbillable.
 *
 * ⚠️ Local welfare is its OWN scope, not a discount. The same ground is quoted
 * one figure to a trader and a lower one to a village welfare requester,
 * because the second is a contribution rather than a market price. A bay closed
 * to vendors still takes local welfare figures — that is the whole point.
 *
 * ⚠️ The advance rides on the rate row, so it is area-wise too: "keep the
 * advance also area wise — it might be 3000, and for the free area it might be
 * only 2000". Rent and advance are edited together here and cannot drift apart.
 */
function Rates({ c, writable, run }: PanelProps) {
  const [entries, setEntries] = useState<RateCardEntry[]>(c.rateCard);
  const [isFood, setIsFood] = useState(true);
  const [editing, setEditing] = useState<api.BackofficeConfig['zones'][number] | null>(null);
  useEffect(() => setEntries(c.rateCard), [c.rateCard]);

  const row = (zoneCode: string, scope: RateScope) =>
    entries.find((e) => e.zoneCode === zoneCode && e.isFood === isFood && e.scope === scope) ??
    null;

  const set = (zoneCode: string, scope: RateScope, patch: Partial<RateCardEntry>) =>
    setEntries((es) => {
      const i = es.findIndex(
        (e) => e.zoneCode === zoneCode && e.isFood === isFood && e.scope === scope,
      );
      if (i >= 0) {
        const next = [...es];
        next[i] = { ...next[i], ...patch };
        return next;
      }
      return [...es, { zoneCode, isFood, scope, amountPaise: 0, depositPaise: 0, ...patch }];
    });

  // A row left at zero rent is not a free stall — it is a bay this scope does
  // not price. Dropping it is what makes the form say "not available this
  // year" rather than quoting nothing and taking the booking anyway.
  const priced = entries.filter((e) => e.amountPaise > 0);

  return (
    <Panel
      title='Stall rent and advance'
      note='Per stall, before GST, for each bay. A bay left at zero is not priced at that scope and the form will not offer it. The advance is refundable and is set per bay beside the rent.'
      footer={
        <Btn
          kind='primary'
          disabled={!writable}
          onClick={() => run('Rates saved', () => api.putRateCard(priced))}
        >
          <Icon name='check' size={14} />
          Save rates
        </Btn>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Food', value: true },
          { label: 'Non-food', value: false },
        ].map((t) => (
          <button
            key={t.label}
            type='button'
            aria-pressed={isFood === t.value}
            onClick={() => setIsFood(t.value)}
            style={toolBtnStyle(isFood === t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Bay</TH>
            <TH align='right'>Vendor rent</TH>
            <TH align='right'>Vendor advance</TH>
            <TH align='right'>Local welfare rent</TH>
            <TH align='right'>Local welfare advance</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {c.zones.map((z) => (
            <TR key={z.id}>
              <TD>
                <span style={{ fontWeight: 600 }}>{z.code}</span>
                <span style={{ color: 'var(--mfg)', marginLeft: 8, fontSize: 12 }}>{z.name}</span>
              </TD>
              {(['VENDOR', 'LOCAL_WELFARE'] as const).map((scope) => {
                // ⚠️ `--mfg`, not a warning colour. A bay the trade cannot have
                // is an absence, not a mistake somebody made.
                const closedToTrade = scope === 'VENDOR' && z.isClosedToVendors;
                const r = row(z.code, scope);
                return closedToTrade ? (
                  <TD key={scope} align='right' colSpan={2} muted>
                    Closed to trade
                  </TD>
                ) : (
                  <Fragment key={scope}>
                    <TD align='right'>
                      <Money paise={r?.amountPaise ?? 0} />
                    </TD>
                    <TD align='right'>
                      <Money paise={r?.depositPaise ?? 0} />
                    </TD>
                  </Fragment>
                );
              })}
              <TD align='right'>
                <EditBtn
                  what={`${z.code} ${isFood ? 'food' : 'non-food'} rates`}
                  writable={writable}
                  onClick={() => setEditing(z)}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {editing && (
        <RateDialog
          z={editing}
          isFood={isFood}
          vendor={row(editing.code, 'VENDOR')}
          localWelfare={row(editing.code, 'LOCAL_WELFARE')}
          onApply={(scope, patch) => set(editing.code, scope, patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

/** A figure in the rent grid. Zero is not "₹0" — a bay left at zero is one this
 *  scope does not price, and it is dropped on save rather than quoted free. */
function Money({ paise }: { paise: number }) {
  return paise > 0 ? (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatInr(paise)}</span>
  ) : (
    <span style={{ color: 'var(--mfg)' }}>—</span>
  );
}

/**
 * One bay's four figures.
 *
 * ⚠️ Local, and applied on Save. The panel holds a draft that its own Save
 * writes whole, so a dialog that wrote straight into that draft would leave
 * Cancel with nothing to cancel.
 */
function RateDialog({
  z,
  isFood,
  vendor,
  localWelfare,
  onApply,
  onClose,
}: {
  z: api.BackofficeConfig['zones'][number];
  isFood: boolean;
  vendor: RateCardEntry | null;
  localWelfare: RateCardEntry | null;
  onApply: (scope: RateScope, patch: Partial<RateCardEntry>) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState({
    vendorRent: vendor?.amountPaise ?? 0,
    vendorAdvance: vendor?.depositPaise ?? 0,
    lwRent: localWelfare?.amountPaise ?? 0,
    lwAdvance: localWelfare?.depositPaise ?? 0,
  });
  const set = (k: keyof typeof v) => ({
    paise: v[k],
    onPaise: (p: number) => setV((prev) => ({ ...prev, [k]: p })),
  });

  return (
    <Dialog
      title={`${z.code} — ${isFood ? 'food' : 'non-food'} rates`}
      note={`${z.name}. Per stall, before GST. A figure left at zero is not priced at that scope and the form will not offer it. Nothing is written until Save rates.`}
      onClose={onClose}
      width={520}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() => {
            if (!z.isClosedToVendors)
              onApply('VENDOR', { amountPaise: v.vendorRent, depositPaise: v.vendorAdvance });
            onApply('LOCAL_WELFARE', { amountPaise: v.lwRent, depositPaise: v.lwAdvance });
            onClose();
          }}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {/* ⚠️ Absent, not disabled. A bay closed to trade has no vendor
            proposition at all, and empty fields nobody may fill read as
            something broken rather than as something that does not apply. */}
        {z.isClosedToVendors ? (
          <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
            {z.code} is closed to vendors, so it carries local welfare figures only.
          </div>
        ) : (
          <Grid min={200}>
            <RupeeInput id='rd-v-rent' label='Vendor rent' {...set('vendorRent')} />
            <RupeeInput id='rd-v-adv' label='Vendor advance' {...set('vendorAdvance')} />
          </Grid>
        )}
        <Grid min={200}>
          <RupeeInput id='rd-lw-rent' label='Local welfare rent' {...set('lwRent')} />
          <RupeeInput id='rd-lw-adv' label='Local welfare advance' {...set('lwAdvance')} />
        </Grid>
      </div>
    </Dialog>
  );
}

function Charges({ c, writable, run }: PanelProps) {
  const [v, setV] = useState(c.charges);
  useEffect(() => setV(c.charges), [c.charges]);
  const f = (k: keyof typeof v) => ({
    paise: v[k] as number,
    onPaise: (p: number) => setV({ ...v, [k]: p }),
    disabled: !writable,
  });
  return (
    <Panel
      title='Charges and deposits'
      note='The 2025 forms quoted three different chair and table rates — to ashram departments, to local welfare stalls and to vendors. All three are kept, because they are what was charged. The refundable advance is not here: it is set per bay, beside that bay’s rent.'
      footer={
        <Btn
          kind='primary'
          disabled={!writable}
          onClick={() =>
            run('Charges saved', () => {
              const { id: _id, editionId: _e, ...body } = v;
              return api.putCharges(body);
            })
          }
        >
          <Icon name='check' size={14} />
          Save charges
        </Btn>
      }
    >
      <Grid>
        <RupeeInput id='chair' label='Chair / day (ashram)' {...f('chairRatePaise')} />
        <RupeeInput id='table' label='Table / day (ashram)' {...f('tableRatePaise')} />
        <RupeeInput id='lwchair' label='Chair / day (local welfare)' {...f('lwChairRatePaise')} />
        <RupeeInput id='lwtable' label='Table / day (local welfare)' {...f('lwTableRatePaise')} />
        <RupeeInput id='vchair' label='Chair / day (vendor)' {...f('vendorChairRatePaise')} />
        <RupeeInput id='vtable' label='Table / day (vendor)' {...f('vendorTableRatePaise')} />
        <RupeeInput
          id='chairrep'
          label='Chair replacement (not returned)'
          {...f('chairReplacementPaise')}
        />
        <RupeeInput
          id='tablerep'
          label='Table replacement (not returned)'
          {...f('tableReplacementPaise')}
        />
        <RupeeInput id='p5' label='Extra 5 A plug point' {...f('plug5aRatePaise')} />
        <RupeeInput id='p15' label='15 A plug point' {...f('plug15aRatePaise')} />
        <FormField id='gst' label='GST %'>
          <Input
            id='gst'
            type='number'
            min={0}
            max={100}
            value={v.gstPercent}
            disabled={!writable}
            onChange={(e) => setV({ ...v, gstPercent: Number(e.target.value) || 0 })}
          />
        </FormField>
        {/* Chairs and tables are billed per day, so the number of days is part
            of the bill and not a fact about the calendar. Editing it re-prices
            every furniture line that has not been frozen onto a payment letter. */}
        <RupeeInput
          id='ctdep'
          label='Furniture deposit (flat, once)'
          {...f('chairTableDepositPaise')}
        />
        <RupeeInput id='damage' label='Damage penalty' {...f('damagePenaltyPaise')} />
        <FormField id='days' label='Days furniture is held (billing)'>
          <Input
            id='days'
            type='number'
            min={1}
            max={30}
            value={v.equipmentDays}
            disabled={!writable}
            onChange={(e) => setV({ ...v, equipmentDays: Number(e.target.value) || 1 })}
          />
        </FormField>
        <FormField id='cps2' label='People per stall (planning)'>
          <Input
            id='cps2'
            type='number'
            min={1}
            value={v.crowdPerStall}
            disabled={!writable}
            onChange={(e) => setV({ ...v, crowdPerStall: Number(e.target.value) || 1 })}
          />
        </FormField>
      </Grid>
    </Panel>
  );
}

function Fines({ c, writable, run }: PanelProps) {
  const [editing, setEditing] = useState<api.BackofficeConfig['fineTypes'][number] | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title='Fine types'
      note='Deducted from the deposit in Phase 3. Configured here.'
      actions={<AddBtn what='fine type' writable={writable} onClick={() => setAdding(true)} />}
    >
      {c.fineTypes.length === 0 ? (
        <Empty>No fine types yet.</Empty>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Reason</TH>
              <TH align='right'>Default</TH>
              <TH>Active</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.fineTypes.map((ft) => (
              <TR key={ft.id} style={{ opacity: ft.isActive ? 1 : 0.55 }}>
                <TD>{ft.reason}</TD>
                <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatInr(ft.defaultAmountPaise)}
                </TD>
                <TD>
                  {ft.isActive ? (
                    <Tag tone='ok' size='sm'>
                      Active
                    </Tag>
                  ) : (
                    <Tag size='sm'>Retired</Tag>
                  )}
                </TD>
                <TD align='right'>
                  <EditBtn what={ft.reason} writable={writable} onClick={() => setEditing(ft)} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing && <FineDialog ft={editing} run={run} onClose={() => setEditing(null)} />}

      {adding && <FineAddDialog run={run} onClose={() => setAdding(false)} />}
    </Panel>
  );
}

/**
 * A new fine type.
 *
 * ⚠️ The reason is asked for here and never again: `putFineType` upserts ON it,
 * so it is the row's key, and `FineDialog` shows it rather than editing it. A
 * fine that needs renaming is retired and re-added.
 */
function FineAddDialog({ run, onClose }: { run: PanelProps['run']; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setSaving(true);
    const ok = await run('Fine added', () =>
      api.putFineType({
        reason: reason.trim(),
        defaultAmountPaise: rupeesToPaise(Number(amount)),
        isActive: true,
      }),
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title='Add a fine type'
      note='The reason is the fine’s identity and cannot be changed afterwards — a fine that needs renaming is retired and re-added.'
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={add}
          disabled={saving || !reason.trim() || !amount}
          save='Add fine type'
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='fr' label='Reason'>
          <Input
            id='fr'
            placeholder='Chairs returned broken'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <FormField id='fa' label='Default amount (₹)'>
          <Input
            id='fa'
            type='number'
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

/**
 * A fine type's default and whether it is still offered.
 *
 * ⚠️ The reason is the KEY — `putFineType` upserts on it — so changing the
 * wording here would leave the old category standing and add a second one
 * beside it. It is shown and not edited for that reason; a fine that needs
 * renaming is retired and re-added.
 */
function FineDialog({
  ft,
  run,
  onClose,
}: {
  ft: api.BackofficeConfig['fineTypes'][number];
  run: PanelProps['run'];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(paiseToRupees(ft.defaultAmountPaise)));
  const [active, setActive] = useState(ft.isActive);
  const [saving, setSaving] = useState(false);
  const rupees = Number(amount);
  const valid = Number.isFinite(rupees) && rupees >= 0;

  const save = async () => {
    setSaving(true);
    const ok = await run('Fine saved', () =>
      api.putFineType({
        reason: ft.reason,
        defaultAmountPaise: rupeesToPaise(rupees),
        isActive: active,
      }),
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title={`Edit ${ft.reason}`}
      note='The reason is how this fine is recorded against a deposit, so it cannot be changed. Retire it instead and add the new wording.'
      onClose={onClose}
      footer={<DialogButtons onClose={onClose} onSave={save} disabled={saving || !valid} />}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='ft-amount' label='Default amount (₹)'>
          <Input
            id='ft-amount'
            type='number'
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField
          id='ft-active'
          label='Offered'
          help='A retired fine stays on every deposit it was already deducted from; it is only withdrawn from the refund screen’s list.'
        >
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
            <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
            Offered on the refund screen
          </label>
        </FormField>
      </div>
    </Dialog>
  );
}

const FORM_TYPES = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD', 'BANK', 'FSSAI'] as const;

function CustomFields({ c, writable, run }: PanelProps) {
  const [editing, setEditing] = useState<api.BackofficeConfig['customFields'][number] | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title='Custom fields'
      note='Appended to the end of a base form. A field that has been answered can be deactivated but not deleted.'
      actions={<AddBtn what='field' writable={writable} onClick={() => setAdding(true)} />}
    >
      {c.customFields.length === 0 ? (
        <Empty>No custom fields on any form yet.</Empty>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Form</TH>
              <TH>Label</TH>
              <TH>Type</TH>
              <TH>Required</TH>
              <TH>Active</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.customFields.map((f) => (
              // A deactivated field is still on the record of everybody who
              // answered it, so it fades rather than leaving.
              <TR key={f.id} style={{ opacity: f.isActive ? 1 : 0.55 }}>
                <TD>
                  <Tag size='sm'>{f.formType}</Tag>
                </TD>
                <TD>
                  {f.label}
                  {f.labelTa && (
                    <span
                      className='msrs-tamil'
                      lang='ta'
                      style={{ marginLeft: 5, color: 'var(--mfg)' }}
                    >
                      / {f.labelTa}
                    </span>
                  )}
                </TD>
                <TD muted>{f.fieldType}</TD>
                <TD muted>{f.isRequired ? 'Yes' : '—'}</TD>
                <TD>
                  {f.isActive ? (
                    <Tag tone='ok' size='sm'>
                      Active
                    </Tag>
                  ) : (
                    <Tag size='sm'>Off</Tag>
                  )}
                </TD>
                <TD align='right' style={{ whiteSpace: 'nowrap' }}>
                  <EditBtn what={f.label} writable={writable} onClick={() => setEditing(f)} />
                  <Btn
                    kind='danger'
                    disabled={!writable}
                    onClick={() => run('Deleted', () => api.deleteCustomField(f.id))}
                  >
                    <Icon name='trash' size={14} />
                    Delete
                  </Btn>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing && <CustomFieldDialog f={editing} run={run} onClose={() => setEditing(null)} />}

      {adding && (
        <CustomFieldAddDialog
          countOn={(t) => c.customFields.filter((f) => f.formType === t).length}
          run={run}
          onClose={() => setAdding(false)}
        />
      )}
    </Panel>
  );
}

/**
 * A new custom field.
 *
 * ⚠️ The form it goes on is asked HERE and cannot be changed afterwards: moving
 * a field between forms would leave the answers already given filed under a
 * form that never asked the question. `CustomFieldDialog` shows the form and
 * does not offer it, for the same reason.
 */
function CustomFieldAddDialog({
  countOn,
  run,
  onClose,
}: {
  /** How many fields the chosen form already carries — the new one's sort
   *  order, so it lands at the end of that form rather than the end of all of
   *  them. */
  countOn: (t: (typeof FORM_TYPES)[number]) => number;
  run: PanelProps['run'];
  onClose: () => void;
}) {
  const [formType, setFormType] = useState<(typeof FORM_TYPES)[number]>('VENDOR');
  const [label, setLabel] = useState('');
  const [labelTa, setLabelTa] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [required, setRequired] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setSaving(true);
    const ok = await run('Field added', () =>
      api.createCustomField({
        formType,
        label: label.trim(),
        labelTa: labelTa.trim() || null,
        fieldType,
        isRequired: required,
        sortOrder: countOn(formType),
      }),
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title='Add a custom field'
      note='Appended to the end of the form it is put on. Which form that is cannot be changed afterwards.'
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={add}
          disabled={saving || !label.trim()}
          save='Add field'
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='cf-form' label='Form'>
          <Select
            id='cf-form'
            value={formType}
            onChange={(e) => setFormType(e.target.value as (typeof FORM_TYPES)[number])}
          >
            {FORM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </FormField>
        <FormField id='cf-label' label='Label'>
          <Input id='cf-label' value={label} onChange={(e) => setLabel(e.target.value)} />
        </FormField>
        <FormField id='cf-ta' label='Tamil label (optional)'>
          <Input
            id='cf-ta'
            className='msrs-tamil'
            value={labelTa}
            onChange={(e) => setLabelTa(e.target.value)}
          />
        </FormField>
        <FormField id='cf-type' label='Type'>
          <Select id='cf-type' value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
            <option value='text'>Text</option>
            <option value='textarea'>Paragraph</option>
            <option value='number'>Number</option>
            <option value='checkbox'>Checkbox</option>
          </Select>
        </FormField>
        <FormField id='cf-req' label='Required'>
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
            <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
            The form will not submit without an answer
          </label>
        </FormField>
      </div>
    </Dialog>
  );
}

/**
 * A custom field's wording and whether the form still asks it.
 *
 * ⚠️ The form it belongs to is not editable. Moving a field between forms would
 * leave the answers already given filed under a form that never asked the
 * question — the field is switched off here and added to the other form
 * instead.
 */
function CustomFieldDialog({
  f,
  run,
  onClose,
}: {
  f: api.BackofficeConfig['customFields'][number];
  run: PanelProps['run'];
  onClose: () => void;
}) {
  const [label, setLabel] = useState(f.label);
  const [labelTa, setLabelTa] = useState(f.labelTa ?? '');
  const [fieldType, setFieldType] = useState(f.fieldType);
  const [required, setRequired] = useState(f.isRequired);
  const [active, setActive] = useState(f.isActive);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const ok = await run('Field saved', () =>
      api.patchCustomField(f.id, {
        label: label.trim(),
        labelTa: labelTa.trim() || null,
        fieldType,
        isRequired: required,
        isActive: active,
      }),
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title={`Edit ${f.label}`}
      note={`Asked on the ${f.formType} form. A field that has been answered can be switched off but not moved to another form.`}
      onClose={onClose}
      width={520}
      footer={
        <DialogButtons onClose={onClose} onSave={save} disabled={saving || label.trim() === ''} />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='cfd-label' label='Label'>
          <Input id='cfd-label' value={label} onChange={(e) => setLabel(e.target.value)} />
        </FormField>
        <FormField id='cfd-ta' label='Tamil label (optional)'>
          <Input
            id='cfd-ta'
            className='msrs-tamil'
            value={labelTa}
            onChange={(e) => setLabelTa(e.target.value)}
          />
        </FormField>
        <FormField
          id='cfd-type'
          label='Type'
          help='Changing the type of a field that has been answered leaves those answers as they were recorded.'
        >
          <Select id='cfd-type' value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
            <option value='text'>Text</option>
            <option value='textarea'>Paragraph</option>
            <option value='number'>Number</option>
            <option value='checkbox'>Checkbox</option>
          </Select>
        </FormField>
        <Grid min={180}>
          <FormField id='cfd-req' label='Required'>
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
              <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
              Must be answered
            </label>
          </FormField>
          <FormField id='cfd-active' label='Active'>
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
              <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
              Still asked on the form
            </label>
          </FormField>
        </Grid>
      </div>
    </Dialog>
  );
}

function Flow({ c, writable, run }: PanelProps) {
  const [v, setV] = useState(c.flow);
  useEffect(() => setV(c.flow), [c.flow]);

  const Step = ({ k, label, help }: { k: keyof typeof v; label: string; help: string }) => (
    // The label WRAPS its control, which associates them implicitly; the rule
    // cannot see the input inside <Checkbox>.
    // biome-ignore lint/a11y/noLabelWithoutControl: implicit association by wrapping
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
        padding: '12px 14px',
        borderRadius: 'var(--r3)',
        border: `1px solid ${v[k] ? 'var(--pri)' : 'var(--bd)'}`,
        background: v[k] ? 'var(--pri-t)' : 'var(--card)',
        cursor: writable ? 'pointer' : 'default',
      }}
    >
      <Checkbox
        checked={v[k]}
        disabled={!writable}
        onChange={(e) => setV({ ...v, [k]: e.target.checked })}
        style={{ marginTop: 2 }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>
          {help}
        </span>
      </span>
    </label>
  );

  return (
    <Panel
      title='Onboarding flow'
      note='Which steps a selected vendor goes through. Phase 2 and 3 read these.'
      footer={
        <Btn
          kind='primary'
          disabled={!writable}
          onClick={() => run('Flow saved', () => api.putFlow(v))}
        >
          <Icon name='check' size={14} />
          Save
        </Btn>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <Step
          k='bankStepEnabled'
          label='Bank, GST and contract details'
          help='Collected by emailed form after selection.'
        />
        <Step
          k='paymentStepEnabled'
          label='Payment details and confirmation'
          help='Payment email, then finance confirms receipt.'
        />
        <Step
          k='fssaiStepEnabled'
          label='FSSAI certificate upload'
          help='Food stalls upload before check-in.'
        />
      </div>
    </Panel>
  );
}

function Editions({ writable, run }: { writable: boolean; run: PanelProps['run'] }) {
  const eds = useLoad(api.listEditions);
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title='Editions'
      note='One per MSR. Exactly one is active; the public forms and every backoffice screen read it. Creating a new one seeds zones, rates and charges from the 2025 defaults.'
      actions={<AddBtn what='edition' writable={writable} onClick={() => setAdding(true)} />}
    >
      {eds.data === null ? (
        <Loading />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Year</TH>
              <TH>Name</TH>
              <TH>Active</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {eds.data.map((e) => (
              <TR key={e.id}>
                <TD style={{ fontWeight: 700 }}>{e.year}</TD>
                <TD>{e.name}</TD>
                <TD>{e.isActive && <Tag tone='ok'>Active</Tag>}</TD>
                <TD align='right'>
                  {!e.isActive && (
                    <Btn
                      disabled={!writable}
                      onClick={() =>
                        run(`${e.year} activated`, async () => {
                          await api.activateEdition(e.id);
                          eds.reload();
                        })
                      }
                    >
                      <Icon name='circle-check' size={14} />
                      Activate
                    </Btn>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {adding && (
        <EditionAddDialog
          run={run}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            eds.reload();
          }}
        />
      )}
    </Panel>
  );
}

/**
 * A new edition.
 *
 * 🔴 Creating one ACTIVATES it, and every backoffice screen reads the active
 * edition — so pressing this moves the whole module to a year with no requests
 * in it. That was a bare "Create and activate" at the bottom of a panel, a
 * mis-click away from a screen full of empty tables; behind a dialog it is
 * something a person has to mean, and the note says what happens before they
 * commit rather than after.
 */
function EditionAddDialog({
  run,
  onClose,
  onCreated,
}: {
  run: PanelProps['run'];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    const ok = await run('Edition created', () =>
      api.createEdition({
        year: Number(year),
        name: name.trim() || `MSR ${year}`,
        activate: true,
      }),
    );
    if (ok) onCreated();
    else setSaving(false);
  };

  return (
    <Dialog
      title='Add an edition'
      note='Created and made active immediately — every backoffice screen reads the active edition, so this moves the module to the new year. Zones, rates and charges are seeded from the 2025 defaults.'
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={create}
          disabled={saving || !Number(year)}
          save='Create and activate'
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='ey' label='Year'>
          <Input id='ey' type='number' value={year} onChange={(e) => setYear(e.target.value)} />
        </FormField>
        <FormField id='en' label='Name'>
          <Input
            id='en'
            placeholder={`MSR ${year}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

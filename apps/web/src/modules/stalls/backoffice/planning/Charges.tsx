import type { ChargeItemView } from '@stalls/core';
import { formatInr, paiseToRupees, rupeesToPaise } from '@stalls/core';
import { useEffect, useState } from 'react';
import * as api from '../../api';
import { Grid, type PanelProps, RupeeInput } from '../../components/config';
import { Panel } from '../../components/Panel';
import {
  Btn,
  Checkbox,
  Dialog,
  FormField,
  Icon,
  IconBtn,
  Input,
  RowActions,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tag,
  useToast,
} from '../../ui';
import { CopyAction } from '../CopyFromDialog';

/**
 * What everything costs, as one table.
 *
 * 🔴 The rows are things and the columns are who is being charged, because that
 * is the shape of the question — "what does a vendor pay for a table" is one
 * cell, and it used to be one of fourteen loose fields in a grid where the
 * ashram chair rate sat next to the local welfare table rate with nothing
 * saying they were the same kind of figure.
 *
 * 🔴 The table is READ-ONLY and a row is edited in a dialog. Forty-five live
 * number inputs is a wall nobody can read a price off: the figures are what the
 * screen is for, and they were buried in the furniture of editing them. It also
 * left every rate one stray keystroke from moving while an admin scrolled past.
 *
 * ⚠️ The rows come from TWO places and deliberately do not look like it. Chair
 * and Table are columns on the charge config — they are ordered online, priced
 * onto the payment letter and printed on the challan, and moving them into the
 * catalogue would re-line every frozen letter to gain nothing. Everything below
 * them is a catalogue row. An admin editing the table has no reason to care,
 * and the day they do is the day something is wrong.
 */

/** Chair and Table, mapped onto the config fields that hold them. */
const FIXED = [
  {
    name: 'Chair',
    rent: ['chairRatePaise', 'lwChairRatePaise', 'vendorChairRatePaise'],
    perDay: 'chairPerDay',
    missing: 'chairReplacementPaise',
    damaged: 'chairDamagePaise',
  },
  {
    name: 'Table',
    rent: ['tableRatePaise', 'lwTableRatePaise', 'vendorTableRatePaise'],
    perDay: 'tablePerDay',
    missing: 'tableReplacementPaise',
    damaged: 'tableDamagePaise',
  },
] as const;

type Fixed = (typeof FIXED)[number];

/** What one row of the matrix holds, wherever it happens to be stored. */
interface Draft {
  name: string;
  ashram: number;
  lw: number;
  vendor: number;
  perDay: boolean;
  missing: number;
  damaged: number;
}

/** A row on screen: the figures, plus what it takes to edit or retire it. */
interface Row extends Draft {
  id: string;
  /** Set for Chair and Table, which live on the charge config and cannot be
   *  renamed, archived or deleted — they are ordered online. */
  fixed: Fixed | null;
  archived: boolean;
  /** Lent to at least one stall, so it can be archived but not deleted. */
  inUse: boolean;
}

/** Marks a row that exists only on the screen so far. */
const NEW_PREFIX = 'new:';

/** Derived from the name so nobody has to invent one, and never recomputed
 *  afterwards: the key is what the audit trail and the challan quote, so it has
 *  to survive a rename. */
const keyFrom = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

const BLANK: Draft = {
  name: '',
  ashram: 0,
  lw: 0,
  vendor: 0,
  perDay: true,
  missing: 0,
  damaged: 0,
};

export function Charges({ c, writable, run, reload }: PanelProps) {
  const [v, setV] = useState(c.charges);
  const [items, setItems] = useState<ChargeItemView[]>(c.chargeItems);
  /** The row being edited, or a blank one being added. */
  const [editing, setEditing] = useState<Row | null>(null);
  const toast = useToast();

  useEffect(() => setV(c.charges), [c.charges]);
  useEffect(() => setItems(c.chargeItems), [c.chargeItems]);

  const rows: Row[] = [
    ...FIXED.map((f) => ({
      id: f.name,
      fixed: f,
      name: f.name,
      ashram: v[f.rent[0]],
      lw: v[f.rent[1]],
      vendor: v[f.rent[2]],
      perDay: v[f.perDay],
      missing: v[f.missing],
      damaged: v[f.damaged],
      archived: false,
      inUse: true,
    })),
    ...items.map((i) => ({
      id: i.id,
      fixed: null,
      name: i.name,
      ashram: i.ashramRatePaise,
      lw: i.lwRatePaise,
      vendor: i.vendorRatePaise,
      perDay: i.perDay,
      missing: i.missingPaise,
      damaged: i.damagedPaise,
      archived: !i.isActive,
      inUse: i.inUse,
    })),
  ];

  const setItem = (id: string, patch: Partial<ChargeItemView>) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  /** Writes the dialog's figures back wherever that row actually lives. */
  const apply = (row: Row, d: Draft) => {
    if (row.fixed) {
      const f = row.fixed;
      setV({
        ...v,
        [f.rent[0]]: d.ashram,
        [f.rent[1]]: d.lw,
        [f.rent[2]]: d.vendor,
        [f.perDay]: d.perDay,
        [f.missing]: d.missing,
        [f.damaged]: d.damaged,
      });
      setEditing(null);
      return;
    }

    const key = keyFrom(d.name);
    if (!key) return toast.info('Give the item a name.');
    if (items.some((i) => i.id !== row.id && i.key === key)) {
      return toast.info(`${d.name} is already on the list.`);
    }

    const existing = items.find((i) => i.id === row.id);
    const next: ChargeItemView = {
      id: row.id,
      // ⚠️ The key of a row that already exists is NEVER recomputed. It is what
      // the audit trail and the challan quote, so a rename that moved it would
      // orphan every record of the thing being renamed.
      key: existing?.key || key,
      name: d.name.trim(),
      ashramRatePaise: d.ashram,
      lwRatePaise: d.lw,
      vendorRatePaise: d.vendor,
      perDay: d.perDay,
      missingPaise: d.missing,
      damagedPaise: d.damaged,
      isActive: !row.archived,
      sortOrder: existing?.sortOrder ?? items.length,
      inUse: row.inUse,
    };
    // Held unsaved alongside every other pending edit — one Save writes the
    // whole screen, so a new row is not published before its neighbours.
    setItems(existing ? items.map((i) => (i.id === row.id ? next : i)) : [...items, next]);
    setEditing(null);
  };

  // 🔴 One button saves BOTH. The rates and the catalogue are one table on the
  // screen; a Save that wrote half of it would leave an admin looking at a row
  // whose rent had been saved and whose replacement charge had not.
  const save = () =>
    run('Charges saved', async () => {
      const { id: _id, editionId: _e, ...body } = v;
      await api.putCharges(body);
      await api.putChargeItems(
        items.map(({ inUse: _u, id, ...i }) => ({
          // ⚠️ A row added but not yet saved carries a stand-in id so React can
          // key it. It is not a uuid and must not be sent: the server matches an
          // unsent id on `key` instead and creates the row.
          ...(id.startsWith(NEW_PREFIX) ? {} : { id }),
          ...i,
        })),
      );
    });

  return (
    <Panel
      title='Charges and Deposits'
      actions={<CopyAction section='charges' writable={writable} onCopied={reload} />}
      note='Rows are what is lent, columns are who is being charged — the 2025 forms quote three different chair and table rates, to ashram departments, to local welfare stalls and to vendors, and all three are what was charged. Add a row for anything else the counter hands out. The refundable advance is not here: it is set per bay, beside that bay’s rent.'
      footer={
        <Btn kind='primary' disabled={!writable} onClick={save}>
          <Icon name='check' size={14} />
          Save Charges
        </Btn>
      }
    >
      <div style={{ display: 'grid', gap: 22 }}>
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH align='right'>Ashram</TH>
                <TH align='right'>Local Welfare</TH>
                <TH align='right'>Vendor</TH>
                <TH>Charged</TH>
                <TH align='right'>Not Returned</TH>
                <TH align='right'>Damaged</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id} style={row.archived ? { opacity: 0.55 } : undefined}>
                  <TD>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{row.name}</strong>
                      {row.archived && (
                        <Tag tone='neutral' size='sm'>
                          Archived
                        </Tag>
                      )}
                    </div>
                  </TD>
                  <TD align='right'>{formatInr(row.ashram)}</TD>
                  <TD align='right'>{formatInr(row.lw)}</TD>
                  <TD align='right'>{formatInr(row.vendor)}</TD>
                  {/* "Per day" against "Once" rather than a tick: a ticked box in
                      a read-only table reads as something you can change, and an
                      empty one says nothing at all about what it meant. */}
                  <TD>
                    <span style={{ fontSize: 12, color: 'var(--mfg)' }}>
                      {row.perDay ? 'Per day' : 'Once'}
                    </span>
                  </TD>
                  <TD align='right'>{formatInr(row.missing)}</TD>
                  <TD align='right'>{formatInr(row.damaged)}</TD>
                  <TD>
                    {writable && (
                      <RowActions>
                        <IconBtn
                          label={`Edit ${row.name}`}
                          glyph='pencil'
                          onClick={() => setEditing(row)}
                        />
                        {/* 🔴 TWO controls for a catalogue row, because
                            archiving and deleting are two different acts and one
                            button could only offer whichever the row's state
                            happened to select. An archived item that had never
                            been lent offered a bin and no way back — the one
                            state where bringing it back is most obviously what
                            somebody meant.
                            ⚠️ Deleting is offered only for an item nobody has
                            ever been handed: the item is the reason a challan
                            says what it says and a deposit was docked what it
                            was docked, and removing it would take a vendor's
                            receipt with it. The server enforces this too, so a
                            slip here fails loudly. */}
                        {!row.fixed && (
                          <IconBtn
                            label={row.archived ? `Unarchive ${row.name}` : `Archive ${row.name}`}
                            glyph={row.archived ? 'archive-restore' : 'archive'}
                            onClick={() => setItem(row.id, { isActive: row.archived })}
                          />
                        )}
                        {!row.fixed && !row.inUse && (
                          <IconBtn
                            label={`Delete ${row.name}`}
                            glyph='trash'
                            onClick={() => setItems(items.filter((i) => i.id !== row.id))}
                          />
                        )}
                      </RowActions>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        {writable && (
          <div>
            <Btn
              onClick={() =>
                setEditing({
                  ...BLANK,
                  id: `${NEW_PREFIX}${items.length}`,
                  fixed: null,
                  archived: false,
                  inUse: false,
                })
              }
            >
              <Icon name='plus' size={14} />
              Add Item
            </Btn>
          </div>
        )}

        <Grid>
          <RupeeInput
            id='p5'
            label='Extra 5 A Plug Point'
            paise={v.plug5aRatePaise}
            onPaise={(p) => setV({ ...v, plug5aRatePaise: p })}
            disabled={!writable}
          />
          <RupeeInput
            id='p15'
            label='15 A Plug Point'
            paise={v.plug15aRatePaise}
            onPaise={(p) => setV({ ...v, plug15aRatePaise: p })}
            disabled={!writable}
          />
          <RupeeInput
            id='ctdep'
            label='Furniture Deposit (Flat, Once)'
            paise={v.chairTableDepositPaise}
            onPaise={(p) => setV({ ...v, chairTableDepositPaise: p })}
            disabled={!writable}
          />
          {/* Chairs and tables are billed per day, so the number of days is part
              of the bill and not a fact about the calendar. Editing it re-prices
              every furniture line that has not been frozen onto a payment letter. */}
          <Num
            id='days'
            label='Days Furniture Is Held (Billing)'
            value={v.equipmentDays}
            min={1}
            max={30}
            disabled={!writable}
            onChange={(n) => setV({ ...v, equipmentDays: n })}
          />
          <Num
            id='cps2'
            label='People per Stall (Planning)'
            value={v.crowdPerStall}
            min={1}
            disabled={!writable}
            onChange={(n) => setV({ ...v, crowdPerStall: n })}
          />
        </Grid>

        {/* 🔴 Three rates, because the decision is made three times. The team
            has taken the position that the stall is taxed and the chairs are
            not; one figure could not say so. A refundable deposit is not a
            supply at all, which is why it starts at zero rather than at 18. */}
        <Grid>
          <Num
            id='gstrent'
            label='GST % — Rent'
            value={v.gstRentPercent}
            min={0}
            max={100}
            disabled={!writable}
            onChange={(n) => setV({ ...v, gstRentPercent: n })}
          />
          <Num
            id='gstitems'
            label='GST % — Items (furniture, plugs)'
            value={v.gstItemsPercent}
            min={0}
            max={100}
            disabled={!writable}
            onChange={(n) => setV({ ...v, gstItemsPercent: n })}
          />
          <Num
            id='gstdep'
            label='GST % — Deposit'
            value={v.gstDepositPercent}
            min={0}
            max={100}
            disabled={!writable}
            onChange={(n) => setV({ ...v, gstDepositPercent: n })}
          />
        </Grid>
      </div>

      {editing && (
        <RowDialog
          row={editing}
          onSave={(d) => apply(editing, d)}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

/** A labelled whole-number field. */
function Num({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <FormField id={id} label={label}>
      <Input
        id={id}
        type='number'
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(min, n) : min);
        }}
      />
    </FormField>
  );
}

/**
 * One row of the matrix, edited.
 *
 * 🔴 ONE dialog for a chair and for a fan. They are stored in different places
 * and priced by the same rules, and two dialogs is how the fan ends up being
 * asked something the chair is not — or worse, how one of them quietly stops
 * asking for the damage charge.
 *
 * Held as strings while they are typed: a half-typed figure is not a number
 * yet, and a price must not pass through one.
 */
function RowDialog({
  row,
  onSave,
  onClose,
}: {
  row: Row;
  onSave: (d: Draft) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [perDay, setPerDay] = useState(row.perDay);
  const [text, setText] = useState({
    ashram: String(paiseToRupees(row.ashram)),
    lw: String(paiseToRupees(row.lw)),
    vendor: String(paiseToRupees(row.vendor)),
    missing: String(paiseToRupees(row.missing)),
    damaged: String(paiseToRupees(row.damaged)),
  });

  type MoneyKey = keyof typeof text;
  const KEYS: MoneyKey[] = ['ashram', 'lw', 'vendor', 'missing', 'damaged'];
  const rupees = (k: MoneyKey) => {
    const n = Number(text[k]);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const valid = name.trim().length > 0 && KEYS.every((k) => rupees(k) !== null);

  const money = (k: MoneyKey, label: string) => (
    <FormField id={`row-${k}`} label={label}>
      <Input
        id={`row-${k}`}
        type='number'
        min={0}
        step='1'
        value={text[k]}
        onChange={(e) => setText({ ...text, [k]: e.target.value })}
      />
    </FormField>
  );

  return (
    <Dialog
      title={row.fixed ? row.name : row.name || 'Add an Item'}
      note={
        row.fixed
          ? 'Ordered online and printed on the payment letter, so the name is fixed. The three rates are what the forms quote for each kind of requester.'
          : 'Fans, carpets — anything the counter hands out beyond chairs and tables.'
      }
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            kind='primary'
            disabled={!valid}
            onClick={() =>
              onSave({
                name: name.trim(),
                perDay,
                ashram: rupeesToPaise(rupees('ashram') ?? 0),
                lw: rupeesToPaise(rupees('lw') ?? 0),
                vendor: rupeesToPaise(rupees('vendor') ?? 0),
                missing: rupeesToPaise(rupees('missing') ?? 0),
                damaged: rupeesToPaise(rupees('damaged') ?? 0),
              })
            }
          >
            <Icon name='check' size={14} />
            Done
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {/* Chair and Table cannot be renamed: the payment letter, the challan
            and the refund all say "Chair", and a rename here would leave them
            saying it about something else. */}
        {!row.fixed && (
          <FormField id='row-name' label='Name'>
            <Input
              id='row-name'
              value={name}
              autoFocus
              placeholder='Fan'
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
        )}

        <Grid min={140}>
          {money('ashram', 'Ashram')}
          {money('lw', 'Local Welfare')}
          {money('vendor', 'Vendor')}
        </Grid>

        <label
          htmlFor='row-perday'
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
        >
          <Checkbox
            id='row-perday'
            checked={perDay}
            onChange={(e) => setPerDay(e.target.checked)}
          />
          Charged per day
        </label>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          A fan is rented by the day, and multiplied by “Days Furniture Is Held”. Laying a carpet is
          charged once, however long it stays down.
        </div>

        <Grid min={140}>
          {money('missing', 'Not Returned')}
          {money('damaged', 'Damaged')}
        </Grid>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          Charged per item against the furniture deposit when it does not come back, and when it
          comes back unusable.
        </div>
      </div>
    </Dialog>
  );
}

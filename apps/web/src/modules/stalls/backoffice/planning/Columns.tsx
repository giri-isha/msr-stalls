import { useEffect, useState } from 'react';
import * as api from '../../api';
import type { PanelProps } from '../../components/config';
import { Panel } from '../../components/Panel';
import {
  AddBtn,
  Btn,
  Checkbox,
  Dialog,
  DialogButtons,
  EditBtn,
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
} from '../../ui';
import { CopyAction } from '../CopyFromDialog';

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
export function PlanCategories({ c, writable, run, reload }: PanelProps) {
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
      title='Planning Columns'
      note='What can occupy a stall position. These are the Planning grid’s columns, in this order. A column something is already planned or allocated against cannot be removed.'
      actions={
        <>
          <CopyAction section='planCategories' writable={writable} onCopied={reload} />
          <AddBtn what='column' writable={writable} onClick={() => setAdding(true)} />
        </>
      }
      footer={
        <Btn kind='primary' disabled={!writable || !dirty} onClick={save}>
          <Icon name='check' size={14} />
          Save Columns
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
                <RowActions>
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
                </RowActions>
              </TD>
              <TD align='right'>
                <RowActions>
                  <EditBtn what={r.key} writable={writable} onClick={() => setEditing(i)} />
                  {r.inUse ? (
                    <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>In use</span>
                  ) : (
                    <IconBtn
                      label={`Remove ${r.key}`}
                      glyph='trash'
                      disabled={!writable}
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    />
                  )}
                </RowActions>
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
        <FormField id='pc-name' label='Column Heading'>
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
      title='Add a Column'
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
        <FormField id='nc-name' label='Column Heading'>
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

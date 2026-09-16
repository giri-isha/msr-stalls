import { formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { useState } from 'react';
import * as api from '../../api';
import type { PanelProps } from '../../components/config';
import { Panel } from '../../components/Panel';
import {
  AddBtn,
  Checkbox,
  Dialog,
  DialogButtons,
  EditBtn,
  Empty,
  FormField,
  Input,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tag,
} from '../../ui';
import { CopyAction } from '../CopyFromDialog';

export function Fines({ c, writable, run, reload }: PanelProps) {
  const [editing, setEditing] = useState<api.BackofficeConfig['fineTypes'][number] | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title='Fine Types'
      note='Deducted from the deposit in Phase 3. Configured here.'
      actions={
        <>
          <CopyAction section='fineTypes' writable={writable} onCopied={reload} />
          <AddBtn what='fine type' writable={writable} onClick={() => setAdding(true)} />
        </>
      }
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
      title='Add a Fine Type'
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
        <FormField id='fa' label='Default Amount (₹)'>
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
        <FormField id='ft-amount' label='Default Amount (₹)'>
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

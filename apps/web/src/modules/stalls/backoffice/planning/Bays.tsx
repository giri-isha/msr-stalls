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
  FormField,
  IconBtn,
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
export function Bays({ c, writable, run, reload }: PanelProps) {
  // ⚠️ Held by the PANEL, not the row. A dialog is a <div>, and a <div> inside
  // a <tr> is invalid markup React will complain about — so the row raises the
  // intent and the box is rendered out here, beside the table.
  const [editing, setEditing] = useState<api.BackofficeConfig['zones'][number] | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Panel
      title='Bays'
      note='The physical areas stalls are planned into. The layout is redrawn each edition, so bays are added and removed here rather than in a migration.'
      actions={
        <>
          <CopyAction section='zones' writable={writable} onCopied={reload} />
          <AddBtn what='bay' writable={writable} onClick={() => setAdding(true)} />
        </>
      }
    >
      <Table>
        <THead>
          <TR>
            <TH>Code</TH>
            <TH>Name</TH>
            <TH align='right'>Expected Crowd</TH>
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
} & Omit<PanelProps, 'c' | 'reload'>) {
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
          <Tag size='sm'>Closed to Vendors</Tag>
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
      title='Add a Bay'
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
        <FormField id='nz-crowd' label='Expected Crowd'>
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
        <FormField id='z-crowd' label='Expected Crowd'>
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

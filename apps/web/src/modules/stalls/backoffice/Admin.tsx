import { useEffect, useState } from 'react';
import * as api from '../api';
import { Grid, type PanelProps } from '../components/config';
import { Panel } from '../components/Panel';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  AddBtn,
  Btn,
  Checkbox,
  Dialog,
  DialogButtons,
  EditBtn,
  ErrorBox,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  RowActions,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tabs,
  Tag,
  useToast,
} from '../ui';
import { Declarations } from './Declarations';
import { FormBuilder } from './FormBuilder';

/** ⚠️ Five tabs shorter than it was. Bays, Planning Columns, Rates, Charges and
 *  Fines configure an EDITION'S STALLS, and they are on Planning & Zones now —
 *  beside the grid that counts them, rather than a nav group away from it. What
 *  is left here is the paperwork and the years themselves. */
const TABS = [
  { label: 'Form Builder', glyph: 'clipboard-list' },
  { label: 'Declarations', glyph: 'scroll' },
  { label: 'Flow', glyph: 'arrow-left-right' },
  { label: 'Editions', glyph: 'calendar' },
] as const;
type Tab = (typeof TABS)[number]['label'];

export function Admin() {
  const { can } = useMe();
  const toast = useToast();
  // ⚠️ Which edition is being LOOKED AT. Empty means the active one, which is
  // what the screen opens on and what every write goes to regardless — see
  // `viewing` below.
  const [viewing, setViewing] = useState('');
  const [tab, setTab] = useState<Tab>('Form Builder');
  const cfg = useLoad(() => api.getConfig(viewing || undefined), [viewing]);
  const editions = useLoad(api.listEditions);

  if (cfg.loading) return <Loading />;
  if (cfg.error || !cfg.data)
    return <ErrorBox>{cfg.error?.message ?? 'Could not load the configuration.'}</ErrorBox>;
  const c = cfg.data;

  // 🔴 A past edition is READ ONLY. Every write on this screen goes to the
  // ACTIVE edition — none of them carries an edition at all — so a screen
  // pointed at 2025 with its Save buttons live would write 2025's figures into
  // this year under a heading saying 2025. The selector is for comparing and
  // for copying out of; the year being edited never changes.
  const past = !c.edition.isActive;
  const writable = can('config.write') && !past;

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
              {past ? 'past edition · read only' : writable ? 'you can edit' : 'read only'}
            </Tag>
          </>
        }
      >
        Admin
      </H1>

      {/* The edition being looked at. Beside the title rather than inside a
          panel: it changes what every panel below is showing, and a control
          that reframes a whole screen belongs at the top of it. */}
      {(editions.data?.length ?? 0) > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <label htmlFor='admin-edition' style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
            Showing
          </label>
          <Select
            id='admin-edition'
            value={viewing || (editions.data?.find((e) => e.isActive)?.id ?? '')}
            onChange={(v) => setViewing(v)}
            style={{ width: 'auto', minWidth: 190 }}
          >
            {editions.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.isActive ? ' — active' : ''}
              </option>
            ))}
          </Select>
          {past && (
            <span style={{ fontSize: 12, color: 'var(--mfg)' }}>
              A past edition. Nothing here can be edited — use “Copy from…” on a panel to bring its
              settings into the active edition.
            </span>
          )}
        </div>
      )}

      {/* The shared underlined rail. This screen used to draw its own row of
          `toolBtnStyle` pills, as four other screens each did — see
          `ui/components/Tabs.tsx` for why page sections are not pills. */}
      <Tabs
        label='Configuration Sections'
        tabs={TABS.map((t) => ({ key: t.label, label: t.label, glyph: t.glyph }))}
        active={tab}
        onPick={(k) => setTab(k as Tab)}
      />

      {/* ⚠️ Reads its own data rather than taking `c`. `c.customFields` is the
          appended questions only, and this screen is about the whole form.
          There used to be a Custom fields tab beside it listing exactly those
          appended rows — the same `stall_form_field` records, minus the context
          that says where on the form they are asked. Two screens editing one
          table, and the shorter one could not reorder. */}
      {tab === 'Form Builder' && (
        <FormBuilder writable={writable} editionId={viewing || undefined} />
      )}
      {/* ⚠️ Reads its own data rather than taking `c`. The config payload is
          what is LIVE; this screen shows every version including the archived
          ones, which is a different question and a different query. */}
      {tab === 'Declarations' && (
        <Declarations writable={writable} editionId={viewing || undefined} />
      )}
      {tab === 'Flow' && <Flow c={c} writable={writable} run={run} reload={cfg.reload} />}
      {/* ⚠️ Users and Roles used to be two tabs here. They are screens of their
          own under Access now — each one a full page with its own toolbar,
          rather than a page inside a strip that had grown to ten items. */}
      {/* ⚠️ Gated on the privilege rather than on `writable`, so it stays live
          while a past edition is being looked at. The settings of a year are
          edited on its own row here — which is the one thing on this screen
          that is not about the year the selector is pointed at, and the reason
          the panel below reads its own list rather than taking `c`. */}
      {tab === 'Editions' && <Editions writable={can('config.write')} run={run} />}
    </div>
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
      title='Onboarding Flow'
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
          label='Bank, GST and Contract Details'
          help='Collected by emailed form after selection.'
        />
        <Step
          k='paymentStepEnabled'
          label='Payment Details and Confirmation'
          help='Payment email, then finance confirms receipt.'
        />
        <Step
          k='fssaiStepEnabled'
          label='FSSAI Certificate Upload'
          help='Food stalls upload before check-in.'
        />
      </div>
    </Panel>
  );
}

/**
 * The editions, as records. The settings of one are read on its row and changed
 * in the dialog its pencil opens.
 *
 * 🔴 The active edition's settings used to sit in a panel of their own above
 * this table — five inputs open on the screen whether or not anybody came to
 * change them, and reachable for the ACTIVE year only, so correcting a past
 * edition's name meant activating it first. Every other list on this screen
 * reads in a row and writes in a dialog; this one is the same shape now, and
 * the pencil is per row because the settings belong to the edition rather than
 * to the screen.
 */
function Editions({ writable, run }: { writable: boolean; run: PanelProps['run'] }) {
  const eds = useLoad(api.listEditions);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditionRow | null>(null);
  return (
    <Panel
      title='Editions'
      note='One per edition. Exactly one is active; the public forms and every backoffice screen read it. Creating a new one seeds zones, rates and charges from the 2025 defaults — to carry last year’s own settings across instead, use “Copy from…” on the panel you want.'
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
              <TH>Stalls per Request</TH>
              <TH>Virtual Accounts</TH>
              <TH>Active</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {eds.data.map((e) => (
              <TR key={e.id}>
                <TD style={{ fontWeight: 700 }}>{e.year}</TD>
                <TD>{e.name}</TD>
                <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {e.maxStallsPerRequest}
                </TD>
                {/* ⚠️ The two prefixes read together or not at all: a payment
                    letter needs the rent account AND the deposit account, so a
                    year holding one of them is half-issued rather than issued.
                    "Not issued yet" is the normal state of a new edition. */}
                <TD mono muted>
                  {e.virtualAccountRentPrefix && e.virtualAccountDepositPrefix
                    ? `${e.virtualAccountRentPrefix} · ${e.virtualAccountDepositPrefix}`
                    : 'Not issued yet'}
                </TD>
                <TD>{e.isActive && <Tag tone='ok'>Active</Tag>}</TD>
                <TD align='right'>
                  <RowActions>
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
                    <EditBtn what={e.name} writable={writable} onClick={() => setEditing(e)} />
                  </RowActions>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {editing && (
        <EditionDialog
          e={editing}
          run={run}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            eds.reload();
          }}
        />
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

type EditionRow = Awaited<ReturnType<typeof api.listEditions>>[number];

/**
 * One edition's own settings.
 *
 * The two virtual-account prefixes are Finance's: a requester's rent and their
 * deposit are paid into accounts built from the prefix and their mobile number,
 * so an edition with no prefix issued yet quotes no account to pay into.
 *
 * ⚠️ Opened from a row, so it edits THAT edition — including a past one, which
 * makes it the one write on this screen not aimed at the active year. Every
 * other panel here writes to whatever is active regardless of what the selector
 * at the top is showing, which is why they go read-only on a past edition and
 * this does not: the row was pressed, and the heading names the year being
 * changed.
 */
function EditionDialog({
  e,
  run,
  onClose,
  onSaved,
}: {
  e: EditionRow;
  run: PanelProps['run'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState({
    name: e.name,
    virtualAccountRentPrefix: e.virtualAccountRentPrefix ?? '',
    virtualAccountDepositPrefix: e.virtualAccountDepositPrefix ?? '',
    maxStallsPerRequest: e.maxStallsPerRequest,
    termsUrl: e.termsUrl ?? '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const ok = await run('Edition settings saved', () =>
      api.updateEditionSettings(e.id, {
        name: v.name.trim(),
        virtualAccountRentPrefix: v.virtualAccountRentPrefix.trim() || null,
        virtualAccountDepositPrefix: v.virtualAccountDepositPrefix.trim() || null,
        maxStallsPerRequest: v.maxStallsPerRequest,
        termsUrl: v.termsUrl.trim() || null,
      }),
    );
    if (ok) onSaved();
    else setSaving(false);
  };

  return (
    <Dialog
      title={`${e.year} settings`}
      note='The edition’s name as it appears on every letter, the two virtual-account prefixes Finance issues for it, the cap on how many stalls one request may ask for in a single bay, and where this edition’s terms can be read.'
      onClose={onClose}
      footer={<DialogButtons onClose={onClose} onSave={save} disabled={saving || !v.name.trim()} />}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Grid>
          <FormField id='ed-name' label='Edition Name'>
            <Input
              id='ed-name'
              value={v.name}
              onChange={(ev) => setV({ ...v, name: ev.target.value })}
            />
          </FormField>
          <FormField id='ed-max' label='Stalls per Request'>
            <Input
              id='ed-max'
              type='number'
              min={1}
              max={20}
              value={v.maxStallsPerRequest}
              onChange={(ev) => setV({ ...v, maxStallsPerRequest: Number(ev.target.value) || 1 })}
            />
          </FormField>
          <FormField id='ed-rent' label='Virtual Account Prefix — Rent'>
            <Input
              id='ed-rent'
              value={v.virtualAccountRentPrefix}
              placeholder='Not issued yet'
              onChange={(ev) =>
                setV({ ...v, virtualAccountRentPrefix: ev.target.value.toUpperCase() })
              }
            />
          </FormField>
          <FormField id='ed-dep' label='Virtual Account Prefix — Deposit'>
            <Input
              id='ed-dep'
              value={v.virtualAccountDepositPrefix}
              placeholder='Not issued yet'
              onChange={(ev) =>
                setV({ ...v, virtualAccountDepositPrefix: ev.target.value.toUpperCase() })
              }
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
          label='Terms and Conditions Link'
          help='Shown beside the acceptance tick-box on the bank details form. Leave blank until the document is issued.'
        >
          <Input
            id='ed-terms'
            type='url'
            value={v.termsUrl}
            placeholder='https://…'
            onChange={(ev) => setV({ ...v, termsUrl: ev.target.value })}
          />
        </FormField>
      </div>
    </Dialog>
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
        name: name.trim() || `Stalls ${year}`,
        activate: true,
      }),
    );
    if (ok) onCreated();
    else setSaving(false);
  };

  return (
    <Dialog
      title='Add an Edition'
      note='Created and made active immediately — every backoffice screen reads the active edition, so this moves the module to the new year. Zones, rates and charges are seeded from the 2025 defaults; “Copy from…” on a panel brings a past edition’s own settings across afterwards.'
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
            placeholder={`Stalls ${year}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

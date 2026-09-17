import { useEffect, useState } from 'react';
import {
  ALL_ASKED,
  ALL_AT_ONCE,
  type OnboardingStep,
  REQUEST_CAP_SCOPE_LABEL,
  REQUEST_CAP_SCOPES,
  type RequestCapScope,
  type StallRequestType,
  needsBankStep,
  needsPaymentStep,
} from '@stalls/core';
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
  Tag,
  useToast,
} from '../ui';
import { Declarations } from './Declarations';
import { CallFormBuilder } from './CallFormBuilder';
import { FormBuilder } from './FormBuilder';

/** The five tabs this file draws.
 *
 *  ⚠️ **The STRIP is not here any more.** It was a `TABS` literal and a `Tabs`
 *  rail at the top of this screen; both live on `Configs.tsx` now, where they
 *  carry these five beside Home Page and Sidebar Layout. An admin arranging the
 *  app was hunting the same job in two places, and a second rail under the first
 *  one reads as a broken one.
 *
 *  ⚠️ Five tabs shorter than it once was, too. Bays, Planning Columns, Rates,
 *  Charges and Fines configure an EDITION'S STALLS, and they are on Planning &
 *  Zones now — beside the grid that counts them, rather than a nav group away
 *  from it. What is left here is the paperwork and the years themselves. */
export type AdminTab = 'forms' | 'call-form' | 'declarations' | 'flow' | 'editions';

/** The five paperwork tabs of Configs. Renders the panel it is given and the
 *  edition selector above it — never a heading or a tab strip, both of which
 *  belong to the screen that mounts this. */
export function AdminPanels({ tab }: { tab: AdminTab }) {
  const { can } = useMe();
  const toast = useToast();
  // ⚠️ Which edition is being LOOKED AT. Empty means the active one, which is
  // what the screen opens on and what every write goes to regardless — see
  // `viewing` below.
  const [viewing, setViewing] = useState('');
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
      {/* The edition this screen is pointed at, and whether it can be edited.
          Was the subtitle under a heading this file no longer draws. */}
      <div style={{ marginBottom: 14, fontSize: 12.5, color: 'var(--mfg)' }}>
        {c.edition.name} ·{' '}
        <Tag tone={writable ? 'ok' : 'neutral'} size='sm'>
          {past ? 'past edition · read only' : writable ? 'you can edit' : 'read only'}
        </Tag>
      </div>

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

      {/* ⚠️ Reads its own data rather than taking `c`. `c.customFields` is the
          appended questions only, and this screen is about the whole form.
          There used to be a Custom fields tab beside it listing exactly those
          appended rows — the same `stall_form_field` records, minus the context
          that says where on the form they are asked. Two screens editing one
          table, and the shorter one could not reorder. */}
      {tab === 'forms' && <FormBuilder writable={writable} editionId={viewing || undefined} />}
      {/* ⚠️ Reads its own data rather than taking `c`. The config payload is
          what is LIVE; this screen shows every version including the archived
          ones, which is a different question and a different query. */}
      {tab === 'call-form' && (
        <CallFormBuilder writable={writable} editionId={viewing || undefined} />
      )}

      {tab === 'declarations' && (
        <Declarations writable={writable} editionId={viewing || undefined} />
      )}
      {tab === 'flow' && <Flow c={c} writable={writable} run={run} reload={cfg.reload} />}
      {/* ⚠️ Users and Roles used to be two tabs here. They are screens of their
          own under Access now — each one a full page with its own toolbar,
          rather than a page inside a strip that had grown to ten items. */}
      {/* ⚠️ Gated on the privilege rather than on `writable`, so it stays live
          while a past edition is being looked at. The settings of a year are
          edited on its own row here — which is the one thing on this screen
          that is not about the year the selector is pointed at, and the reason
          the panel below reads its own list rather than taking `c`. */}
      {tab === 'editions' && <Editions writable={can('config.write')} run={run} />}
    </div>
  );
}

/** The four steps, in the order they are worked, with what each one is. */
const FLOW_STEPS: Array<{ step: OnboardingStep; label: string; help: string }> = [
  {
    step: 'BANK_FORM',
    label: 'Bank, GST and Contract Details',
    help: 'Collected by emailed form after selection.',
  },
  {
    step: 'PAYMENT',
    label: 'Payment Details and Confirmation',
    help: 'Payment email, then finance confirms receipt.',
  },
  { step: 'FSSAI', label: 'FSSAI Certificate Upload', help: 'Food stalls upload before check-in.' },
  {
    step: 'STAFF_REGISTRATION',
    label: 'Staff Registration',
    help: 'Coupon, then the stall’s own people register against it.',
  },
];

const FLOW_TYPES: Array<{ type: StallRequestType; label: string }> = [
  { type: 'VENDOR', label: 'Vendor' },
  { type: 'LOCAL_WELFARE', label: 'Local Welfare' },
  { type: 'ASHRAM', label: 'Ashram' },
];

/** Whether a step is asked of a requester type at all.
 *
 * ⚠️ Drawn as a DASH rather than left out. A gap in the grid reads as a
 * mistake; a dash says the step does not exist for that type, which is a fact
 * about the flow the screen should teach. The rules are `@stalls/core`'s — the
 * screen asks them rather than repeating them. */
const stepApplies = (step: OnboardingStep, type: StallRequestType): boolean => {
  if (step === 'BANK_FORM') return needsBankStep(type);
  if (step === 'PAYMENT') return needsPaymentStep(type);
  return true;
};

const ONE_AT_A_TIME: Record<OnboardingStep, number> = {
  BANK_FORM: 1,
  PAYMENT: 2,
  FSSAI: 3,
  STAFF_REGISTRATION: 4,
};

/** ⚠️ The web and the API deploy separately, so a screen served ahead of an API
 *  that sends neither `asked` nor `stages` must still open. Everything asked,
 *  all at once, is the right thing to fall back to: it is the default, and it
 *  is what such an API is doing. */
const withFlow = (flow: api.BackofficeConfig['flow']): api.BackofficeConfig['flow'] => ({
  ...flow,
  asked: flow.asked ?? {
    VENDOR: { ...ALL_ASKED },
    LOCAL_WELFARE: { ...ALL_ASKED },
    ASHRAM: { ...ALL_ASKED },
  },
  stages: flow.stages ?? {
    VENDOR: { ...ALL_AT_ONCE },
    LOCAL_WELFARE: { ...ALL_AT_ONCE },
    ASHRAM: { ...ALL_AT_ONCE },
  },
});

function Flow({ c, writable, run }: PanelProps) {
  const [v, setV] = useState(() => withFlow(c.flow));
  useEffect(() => setV(withFlow(c.flow)), [c.flow]);

  const asked = (type: StallRequestType, step: OnboardingStep) => v.asked?.[type]?.[step] ?? true;

  const setAsked = (type: StallRequestType, step: OnboardingStep, on: boolean) =>
    setV({
      ...v,
      asked: { ...v.asked, [type]: { ...v.asked?.[type], [step]: on } } as NonNullable<
        typeof v.asked
      >,
    });

  const setStage = (type: StallRequestType, step: OnboardingStep, stage: number) =>
    setV({
      ...v,
      stages: { ...v.stages, [type]: { ...v.stages[type], [step]: stage } },
    });

  const fill = (type: StallRequestType, stages: Record<OnboardingStep, number>) =>
    setV({ ...v, stages: { ...v.stages, [type]: { ...stages } } });

  return (
    <Panel
      title='Onboarding Flow'
      note='Which steps a selected requester goes through, and in what order.'
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
      {/* 🔴 TWO grids, not one with a tick and a number in each cell. Whether a
          step happens and when it happens are different questions; side by side
          in one control, "off" and "last" become neighbours, which is how an
          admin switches a step off while meaning to defer it. */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Which steps are asked</div>
        <p style={{ fontSize: 11.5, color: 'var(--mfg)', margin: '4px 0 12px' }}>
          Unticked, the step is not asked of that requester type at all — no tab in their portal, no
          link or coupon in their letters, and nothing to chase on Onboarding.
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--mfg)' }}>Step</th>
              {FLOW_TYPES.map((t) => (
                <th
                  key={t.type}
                  style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--mfg)' }}
                >
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FLOW_STEPS.map(({ step, label, help }) => (
              <tr key={`asked-${step}`} style={{ borderTop: '1px solid var(--bd)' }}>
                <td style={{ padding: '8px' }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--mfg)' }}>
                    {help}
                  </span>
                </td>
                {FLOW_TYPES.map((t) => (
                  <td key={t.type} style={{ textAlign: 'center', padding: '8px' }}>
                    {stepApplies(step, t.type) ? (
                      <Checkbox
                        checked={asked(t.type, step)}
                        disabled={!writable}
                        aria-label={`${label} asked of ${t.label}`}
                        onChange={(e) => setAsked(t.type, step, e.target.checked)}
                      />
                    ) : (
                      // Not asked of this requester type at all — see
                      // `needsBankStep` and `needsPaymentStep`. A DASH, never a
                      // gap: a gap reads as a mistake.
                      <span
                        title={`${label} is not asked of a ${t.label.toLowerCase()} request`}
                        style={{ color: 'var(--mfg)' }}
                      >
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>When each step opens</div>
        <p style={{ fontSize: 11.5, color: 'var(--mfg)', margin: '4px 0 12px' }}>
          The lowest number still outstanding is what the requester can act on; anything numbered
          above it stays locked until that one is done. Steps sharing a number open together, so all
          1s opens everything at once.
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--mfg)' }}>Step</th>
              {FLOW_TYPES.map((t) => (
                <th
                  key={t.type}
                  style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--mfg)' }}
                >
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FLOW_STEPS.map(({ step, label, help }) => (
              <tr key={step} style={{ borderTop: '1px solid var(--bd)' }}>
                <td style={{ padding: '8px' }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--mfg)' }}>
                    {help}
                  </span>
                </td>
                {FLOW_TYPES.map((t) => (
                  <td key={t.type} style={{ textAlign: 'center', padding: '8px' }}>
                    {stepApplies(step, t.type) ? (
                      // ⚠️ A step switched off above keeps its NUMBER, greyed
                      // and unedittable — distinct from the dash, which says the
                      // step can never apply. The number is what the ordering
                      // returns to if it is ticked back on, and blanking it here
                      // would lose an edition's numbering to a stray click.
                      <input
                        type='number'
                        min={1}
                        max={4}
                        aria-label={`${label} stage for ${t.label}`}
                        disabled={!writable || !asked(t.type, step)}
                        title={
                          asked(t.type, step)
                            ? undefined
                            : `${label} is not asked of a ${t.label.toLowerCase()} request in this edition`
                        }
                        value={v.stages[t.type][step]}
                        onChange={(e) => setStage(t.type, step, Number(e.target.value))}
                        style={{
                          width: 52,
                          textAlign: 'center',
                          padding: '5px 4px',
                          borderRadius: 'var(--r2)',
                          border: '1px solid var(--bd)',
                          background: 'var(--card)',
                          color: 'inherit',
                          opacity: asked(t.type, step) ? 1 : 0.45,
                        }}
                      />
                    ) : (
                      // Not asked of this requester type at all — see
                      // `needsBankStep` and `needsPaymentStep`.
                      <span
                        title={`${label} is not asked of a ${t.label.toLowerCase()} request`}
                        style={{ color: 'var(--mfg)' }}
                      >
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--bd)' }}>
              <td style={{ padding: '8px', color: 'var(--mfg)', fontSize: 11.5 }}>Fill a column</td>
              {FLOW_TYPES.map((t) => (
                <td key={t.type} style={{ textAlign: 'center', padding: '8px' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    <Btn
                      kind='ghost'
                      disabled={!writable}
                      onClick={() => fill(t.type, { ...ALL_AT_ONCE })}
                    >
                      All at once
                    </Btn>
                    <Btn
                      kind='ghost'
                      disabled={!writable}
                      onClick={() => fill(t.type, ONE_AT_A_TIME)}
                    >
                      One at a time
                    </Btn>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
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
              <TH>Requests at a Time</TH>
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
                {/* The number alone is half the rule — two of WHAT is the other
                    half — so the scope rides beside it rather than being a
                    setting you can only see by opening the dialog. */}
                <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {e.maxOpenRequests}{' '}
                  <span style={{ color: 'var(--mfg)', fontVariantNumeric: 'normal' }}>
                    {REQUEST_CAP_SCOPE_LABEL[e.requestCapScope]}
                  </span>
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

/** The three scopes as the Admin screen offers them, and what each one means
 *  in the team's own terms.
 *
 *  ⚠️ Wording only. `REQUEST_CAP_STATUSES` in `@stalls/core` is what actually
 *  decides which statuses count, and the API enforces from that same table —
 *  so a scope described here and enforced somewhere else cannot happen. */
const CAP_SCOPE_OPTION: Record<RequestCapScope, string> = {
  UNDECIDED: 'Awaiting a decision',
  OPEN: 'Still open',
  ALL: 'Every request this edition',
};

const CAP_SCOPE_HELP: Record<RequestCapScope, string> = {
  UNDECIDED:
    'Only requests nobody has ruled on yet — submitted and shortlisted. Selecting a request frees the slot, so a selected vendor may keep applying for more ground.',
  OPEN: 'Everything still live — submitted, shortlisted, selected and backup. Only a rejection or a cancellation frees a slot.',
  ALL: 'Every request the account has filed this edition, decided or not. A rejection frees nothing: the cap is that many attempts a year.',
};

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
    maxOpenRequests: e.maxOpenRequests,
    requestCapScope: e.requestCapScope,
    termsUrl: e.termsUrl ?? '',
    beneficiaryName: e.beneficiaryName ?? '',
    beneficiaryAddress: e.beneficiaryAddress ?? '',
    bankAccountType: e.bankAccountType ?? '',
    bankName: e.bankName ?? '',
    bankIfsc: e.bankIfsc ?? '',
    bankBranch: e.bankBranch ?? '',
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
        maxOpenRequests: v.maxOpenRequests,
        requestCapScope: v.requestCapScope,
        termsUrl: v.termsUrl.trim() || null,
        beneficiaryName: v.beneficiaryName.trim() || null,
        beneficiaryAddress: v.beneficiaryAddress.trim() || null,
        bankAccountType: v.bankAccountType.trim() || null,
        bankName: v.bankName.trim() || null,
        bankIfsc: v.bankIfsc.trim() || null,
        bankBranch: v.bankBranch.trim() || null,
      }),
    );
    if (ok) onSaved();
    else setSaving(false);
  };

  return (
    <Dialog
      title={`${e.year} settings`}
      note='The edition’s name as it appears on every letter, the two virtual-account prefixes Finance issues for it, the two caps on what a requester may ask for, where this edition’s terms can be read, and the beneficiary the payment letter and the vendor’s payment page both name.'
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
          <FormField
            id='ed-max'
            label='Stalls per Request'
            help='How many stalls one request may ask for in a single bay. Ground in a second bay is a second request.'
          >
            <Input
              id='ed-max'
              type='number'
              min={1}
              max={20}
              value={v.maxStallsPerRequest}
              onChange={(ev) => setV({ ...v, maxStallsPerRequest: Number(ev.target.value) || 1 })}
            />
          </FormField>
          {/* 🔴 The number and the scope are ONE rule and sit side by side. A
              cap of two says nothing until you say two of what — and the three
              readings differ in a way the team feels: under “awaiting a
              decision” a vendor already selected for two bays may keep
              applying, and under “filed this edition” two rejections use up
              their year. */}
          <FormField
            id='ed-open'
            label='Requests at a Time'
            help='How many requests one account may have going at once. A request above this is refused when it is sent.'
          >
            <Input
              id='ed-open'
              type='number'
              min={1}
              max={20}
              value={v.maxOpenRequests}
              onChange={(ev) => setV({ ...v, maxOpenRequests: Number(ev.target.value) || 1 })}
            />
          </FormField>
          <FormField
            id='ed-scope'
            label='Which Requests Count'
            help={CAP_SCOPE_HELP[v.requestCapScope]}
          >
            <Select
              id='ed-scope'
              value={v.requestCapScope}
              onChange={(val) => setV({ ...v, requestCapScope: val as RequestCapScope })}
            >
              {REQUEST_CAP_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {CAP_SCOPE_OPTION[scope]}
                </option>
              ))}
            </Select>
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
        {/* 🔴 Who the money goes to. This used to be prose inside the payment
            letter, which was fine while the letter was the only place a vendor
            read it — the team changes banks without a deploy, and an editable
            template is what let them. It stopped working the day the vendor's
            own payment page had to print the same table: a page that knows the
            account number and not the IFSC is a page nobody can transfer from,
            and a second copy of a bank identity is one bank change away from a
            letter and a page naming different beneficiaries.

            ⚠️ Blank on a new edition, and that is deliberate — a page must
            print nothing rather than last year's bank. */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--mfg)', marginTop: 4 }}>
          Beneficiary — who vendors transfer to
        </div>
        <Grid>
          <FormField id='ed-ben-name' label='Account Name'>
            <Input
              id='ed-ben-name'
              value={v.beneficiaryName}
              placeholder='Not set'
              onChange={(ev) => setV({ ...v, beneficiaryName: ev.target.value })}
            />
          </FormField>
          <FormField id='ed-ben-type' label='Account Type'>
            <Input
              id='ed-ben-type'
              value={v.bankAccountType}
              placeholder='Savings'
              onChange={(ev) => setV({ ...v, bankAccountType: ev.target.value })}
            />
          </FormField>
          <FormField id='ed-ben-bank' label='Bank Name'>
            <Input
              id='ed-ben-bank'
              value={v.bankName}
              placeholder='Not set'
              onChange={(ev) => setV({ ...v, bankName: ev.target.value })}
            />
          </FormField>
          <FormField id='ed-ben-ifsc' label='RTGS / NEFT / IFSC Code'>
            <Input
              id='ed-ben-ifsc'
              value={v.bankIfsc}
              placeholder='HDFC0004989'
              onChange={(ev) => setV({ ...v, bankIfsc: ev.target.value.toUpperCase() })}
            />
          </FormField>
        </Grid>
        <FormField id='ed-ben-addr' label='Beneficiary Address'>
          <Input
            id='ed-ben-addr'
            value={v.beneficiaryAddress}
            placeholder='Not set'
            onChange={(ev) => setV({ ...v, beneficiaryAddress: ev.target.value })}
          />
        </FormField>
        <FormField id='ed-ben-branch' label='Branch'>
          <Input
            id='ed-ben-branch'
            value={v.bankBranch}
            placeholder='Not set'
            onChange={(ev) => setV({ ...v, bankBranch: ev.target.value })}
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

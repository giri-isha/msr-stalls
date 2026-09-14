import type { RateCardEntry, RateScope } from '@msr/stalls';
import { ROLES, formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { Fragment, useEffect, useState } from 'react';
import * as api from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Checkbox,
  Empty,
  ErrorBox,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  Search,
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

const TABS = [
  { label: 'Zones', glyph: 'map-pin' },
  { label: 'Rates', glyph: 'ticket' },
  { label: 'Charges', glyph: 'file-text' },
  { label: 'Fines', glyph: 'ban' },
  { label: 'Custom fields', glyph: 'sliders' },
  { label: 'Flow', glyph: 'arrow-left-right' },
  { label: 'Users', glyph: 'users' },
  { label: 'Editions', glyph: 'calendar' },
] as const;
type Tab = (typeof TABS)[number]['label'];

/**
 * A titled panel.
 *
 * The reference system has no Card header component — its screens draw their
 * own — so this is that pattern, once, rather than eight times down this file.
 */
function Panel({
  title,
  note,
  children,
  footer,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      <div style={{ padding: '15px 18px 13px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        {note && (
          <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3, lineHeight: 1.55 }}>
            {note}
          </div>
        )}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
      {footer && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '13px 18px',
            borderTop: '1px solid var(--line)',
            background: 'var(--rail)',
          }}
        >
          {footer}
        </div>
      )}
    </Card>
  );
}

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
  const writable = can('config:write');
  const [tab, setTab] = useState<Tab>('Zones');
  const cfg = useLoad(api.getConfig);

  if (cfg.loading) return <Loading />;
  if (cfg.error || !cfg.data)
    return <ErrorBox>{cfg.error?.message ?? 'Could not load the configuration.'}</ErrorBox>;
  const c = cfg.data;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.ok(label);
      cfg.reload();
    } catch (e) {
      toast.fail(e);
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

      {tab === 'Zones' && <Zones c={c} writable={writable} run={run} />}
      {tab === 'Rates' && <Rates c={c} writable={writable} run={run} />}
      {tab === 'Charges' && <Charges c={c} writable={writable} run={run} />}
      {tab === 'Fines' && <Fines c={c} writable={writable} run={run} />}
      {tab === 'Custom fields' && <CustomFields c={c} writable={writable} run={run} />}
      {tab === 'Flow' && <Flow c={c} writable={writable} run={run} />}
      {tab === 'Users' && <Users writable={can('users:write')} />}
      {tab === 'Editions' && <Editions writable={writable} run={run} />}
    </div>
  );
}

type PanelProps = {
  c: api.StaffConfig;
  writable: boolean;
  run: (l: string, f: () => Promise<unknown>) => Promise<void>;
};

function Zones({ c, writable, run }: PanelProps) {
  return (
    <Panel title='Zones' note='The physical areas stalls are planned into.'>
      <Table>
        <THead>
          <TR>
            <TH>Code</TH>
            <TH>Name</TH>
            <TH align='right'>Expected crowd</TH>
            <TH>Vendors</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {c.zones.map((z) => (
            <ZoneRow key={z.id} z={z} writable={writable} run={run} />
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}

function ZoneRow({
  z,
  writable,
  run,
}: { z: api.StaffConfig['zones'][number] } & Omit<PanelProps, 'c'>) {
  const [name, setName] = useState(z.name);
  const [crowd, setCrowd] = useState(String(z.expectedCrowd));
  const [closed, setClosed] = useState(z.isClosedToVendors);
  const dirty =
    name !== z.name || Number(crowd) !== z.expectedCrowd || closed !== z.isClosedToVendors;
  return (
    <TR>
      <TD mono style={{ fontWeight: 700 }}>
        {z.code}
      </TD>
      <TD>
        <Input
          aria-label={`${z.code} name`}
          value={name}
          disabled={!writable}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 12.5 }}
        />
      </TD>
      <TD align='right'>
        <Input
          aria-label={`${z.code} crowd`}
          type='number'
          min={0}
          style={{ width: 110, textAlign: 'right', padding: '6px 8px', fontSize: 12.5 }}
          value={crowd}
          disabled={!writable}
          onChange={(e) => setCrowd(e.target.value)}
        />
      </TD>
      <TD>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <Checkbox
            checked={closed}
            disabled={!writable}
            onChange={(e) => setClosed(e.target.checked)}
          />
          Closed to vendors
        </label>
      </TD>
      <TD align='right'>
        <Btn
          disabled={!writable || !dirty}
          onClick={() =>
            run(`${z.code} saved`, () =>
              api.updateZone(z.code, {
                name,
                expectedCrowd: Number(crowd) || 0,
                isClosedToVendors: closed,
              }),
            )
          }
        >
          Save
        </Btn>
      </TD>
    </TR>
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
      return [
        ...es,
        { zoneCode, isFood, scope, amountPaise: 0, depositPaise: 0, ...patch },
      ];
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
        <Btn kind='primary' disabled={!writable} onClick={() => run('Rates saved', () => api.putRateCard(priced))}>
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
                      <RateCell
                        id={`${z.code}-${scope}-rent`}
                        label={`${z.code} ${scope === 'VENDOR' ? 'vendor' : 'local welfare'} rent`}
                        paise={r?.amountPaise ?? 0}
                        onPaise={(amountPaise) => set(z.code, scope, { amountPaise })}
                        disabled={!writable}
                      />
                    </TD>
                    <TD align='right'>
                      <RateCell
                        id={`${z.code}-${scope}-adv`}
                        label={`${z.code} ${scope === 'VENDOR' ? 'vendor' : 'local welfare'} advance`}
                        paise={r?.depositPaise ?? 0}
                        onPaise={(depositPaise) => set(z.code, scope, { depositPaise })}
                        disabled={!writable}
                      />
                    </TD>
                  </Fragment>
                );
              })}
            </TR>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}

/** A rupee cell inside the rent grid. Narrower than `RupeeInput` and without a
 *  label of its own, because the column heading already carries it — the label
 *  is kept for screen readers only. */
function RateCell({
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
  return (
    <Input
      id={id}
      aria-label={label}
      type='number'
      min={0}
      step={100}
      style={{ width: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      value={paiseToRupees(paise)}
      disabled={disabled}
      onChange={(e) => onPaise(rupeesToPaise(Number(e.target.value) || 0))}
    />
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
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  return (
    <Panel title='Fine types' note='Deducted from the deposit in Phase 3. Configured here.'>
      {c.fineTypes.length === 0 ? (
        <Empty>No fine types yet.</Empty>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Reason</TH>
              <TH align='right'>Default</TH>
              <TH>Active</TH>
            </TR>
          </THead>
          <TBody>
            {c.fineTypes.map((ft) => (
              <TR key={ft.id}>
                <TD>{ft.reason}</TD>
                <TD align='right'>{formatInr(ft.defaultAmountPaise)}</TD>
                <TD>
                  <Checkbox
                    aria-label={`${ft.reason} active`}
                    checked={ft.isActive}
                    disabled={!writable}
                    onChange={(e) =>
                      run('Updated', () =>
                        api.putFineType({
                          reason: ft.reason,
                          defaultAmountPaise: ft.defaultAmountPaise,
                          isActive: e.target.checked,
                        }),
                      )
                    }
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {writable && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: 12,
            marginTop: 18,
            paddingTop: 16,
            borderTop: '1px solid var(--line)',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <FormField id='fr' label='New fine'>
              <Input
                id='fr'
                placeholder='Reason'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
          </div>
          <div style={{ width: 140 }}>
            <FormField id='fa' label='Amount (₹)'>
              <Input
                id='fa'
                type='number'
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
          </div>
          <Btn
            kind='primary'
            disabled={!reason.trim() || !amount}
            onClick={() =>
              run('Fine added', async () => {
                await api.putFineType({
                  reason: reason.trim(),
                  defaultAmountPaise: rupeesToPaise(Number(amount)),
                  isActive: true,
                });
                setReason('');
                setAmount('');
              })
            }
          >
            <Icon name='plus' size={14} /> Add
          </Btn>
        </div>
      )}
    </Panel>
  );
}

const FORM_TYPES = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD', 'BANK', 'FSSAI'] as const;

function CustomFields({ c, writable, run }: PanelProps) {
  const [formType, setFormType] = useState<(typeof FORM_TYPES)[number]>('VENDOR');
  const [label, setLabel] = useState('');
  const [labelTa, setLabelTa] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [required, setRequired] = useState(false);
  return (
    <Panel
      title='Custom fields'
      note='Appended to the end of a base form. A field that has been answered can be deactivated but not deleted.'
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
                  <Checkbox
                    aria-label={`${f.label} active`}
                    checked={f.isActive}
                    disabled={!writable}
                    onChange={(e) =>
                      run('Updated', () =>
                        api.patchCustomField(f.id, { isActive: e.target.checked }),
                      )
                    }
                  />
                </TD>
                <TD align='right'>
                  <Btn
                    kind='danger'
                    disabled={!writable}
                    onClick={() => run('Deleted', () => api.deleteCustomField(f.id))}
                  >
                    Delete
                  </Btn>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {writable && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <Grid min={170}>
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
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, paddingBottom: 1 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  height: 37,
                }}
              >
                <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
                Required
              </label>
              <Btn
                kind='primary'
                disabled={!label.trim()}
                onClick={() =>
                  run('Field added', async () => {
                    await api.createCustomField({
                      formType,
                      label: label.trim(),
                      labelTa: labelTa.trim() || null,
                      fieldType,
                      isRequired: required,
                      sortOrder: c.customFields.filter((f) => f.formType === formType).length,
                    });
                    setLabel('');
                    setLabelTa('');
                  })
                }
              >
                <Icon name='plus' size={14} /> Add
              </Btn>
            </div>
          </Grid>
        </div>
      )}
    </Panel>
  );
}

function Flow({ c, writable, run }: PanelProps) {
  const [v, setV] = useState(c.flow);
  useEffect(() => setV(c.flow), [c.flow]);

  const Step = ({ k, label, help }: { k: keyof typeof v; label: string; help: string }) => (
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

function Users({ writable }: { writable: boolean }) {
  const toast = useToast();
  const staff = useLoad(api.listStaff);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<
    Array<{ personId: string; email: string; displayName: string }>
  >([]);
  const [roleKey, setRoleKey] = useState(ROLES[1].roleKey);

  const search = async () => {
    if (!q.trim()) return setFound([]);
    setFound(await api.searchPeople(q.trim()));
  };
  const grant = async (personId: string) => {
    try {
      await api.grantRole(personId, roleKey);
      toast.ok('Granted');
      setFound([]);
      setQ('');
      staff.reload();
    } catch (e) {
      toast.fail(e);
    }
  };
  const revoke = async (personId: string, rk: string) => {
    try {
      await api.revokeRole(personId, rk);
      toast.ok('Revoked');
      staff.reload();
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='Roles'
        note='What each role may do. Declared by the module, not by the platform.'
      >
        <Table>
          <THead>
            <TR>
              <TH>Role</TH>
              <TH>Access</TH>
            </TR>
          </THead>
          <TBody>
            {ROLES.map((r) => (
              <TR key={r.roleKey}>
                <TD style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</TD>
                <TD muted>{r.description}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Panel title='Staff'>
        {staff.data === null ? (
          <Loading />
        ) : staff.data.length === 0 ? (
          <Empty>Nobody has a stalls role yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Roles</TH>
              </TR>
            </THead>
            <TBody>
              {staff.data.map((s) => (
                <TR key={s.personId}>
                  <TD style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.displayName}</TD>
                  <TD muted>{s.email}</TD>
                  <TD>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {s.roleKeys.map((rk) => (
                        <span
                          key={rk}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Tag tone='violet' size='sm'>
                            {ROLES.find((r) => r.roleKey === rk)?.name ?? rk}
                          </Tag>
                          {writable && (
                            <button
                              type='button'
                              aria-label={`Revoke ${rk} from ${s.displayName}`}
                              onClick={() => revoke(s.personId, rk)}
                              style={{
                                display: 'flex',
                                border: 0,
                                background: 'none',
                                padding: 2,
                                cursor: 'pointer',
                                color: 'var(--mfg)',
                              }}
                            >
                              <Icon name='x' size={13} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {writable && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '.6px',
                textTransform: 'uppercase',
                color: 'var(--mfg)',
                marginBottom: 9,
              }}
            >
              Add a staff member
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Search
                label='Search people'
                value={q}
                onChange={setQ}
                placeholder='Search name or email…'
              />
              <Btn onClick={search}>
                <Icon name='search' size={14} /> Search
              </Btn>
              <Select
                aria-label='Role'
                value={roleKey}
                onChange={(e) => setRoleKey(e.target.value)}
                style={{ width: 'auto', minWidth: 200 }}
              >
                {ROLES.map((r) => (
                  <option key={r.roleKey} value={r.roleKey}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
              {found.map((p) => (
                <div
                  key={p.personId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 'var(--r2)',
                    background: 'var(--mut)',
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {p.displayName} <span style={{ color: 'var(--mfg)' }}>· {p.email}</span>
                  </span>
                  <Btn kind='primary' onClick={() => grant(p.personId)}>
                    Grant
                  </Btn>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Editions({ writable, run }: { writable: boolean; run: PanelProps['run'] }) {
  const eds = useLoad(api.listEditions);
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [name, setName] = useState('');
  return (
    <Panel
      title='Editions'
      note='One per MSR. Exactly one is active; the public forms and every staff screen read it. Creating a new one seeds zones, rates and charges from the 2025 defaults.'
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
                      Activate
                    </Btn>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {writable && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: 12,
            marginTop: 18,
            paddingTop: 16,
            borderTop: '1px solid var(--line)',
          }}
        >
          <div style={{ width: 120 }}>
            <FormField id='ey' label='Year'>
              <Input id='ey' type='number' value={year} onChange={(e) => setYear(e.target.value)} />
            </FormField>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <FormField id='en' label='Name'>
              <Input
                id='en'
                placeholder={`MSR ${year}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
          </div>
          <Btn
            kind='primary'
            onClick={() =>
              run('Edition created', async () => {
                await api.createEdition({
                  year: Number(year),
                  name: name.trim() || `MSR ${year}`,
                  activate: true,
                });
                eds.reload();
              })
            }
          >
            Create and activate
          </Btn>
        </div>
      )}
    </Panel>
  );
}

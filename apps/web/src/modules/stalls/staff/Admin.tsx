import { ROLES, formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { useEffect, useState } from 'react';
import * as api from '../api';
import { CheckRow, Field, Row2, SelectInput, TextArea, TextInput } from '../components/FormControls';
import { Grid, Mono, Sub } from '../components/Grid';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, Card, ErrorBox, H1, Loading, Tag } from '../ui/ui';

const TABS = ['Zones', 'Rates', 'Charges', 'Fines', 'Custom fields', 'Flow', 'Links', 'Users', 'Editions'] as const;
type Tab = (typeof TABS)[number];

/** Rupee input over a paise value. The number the admin types is rupees; the
 *  number that crosses the wire is integer paise. */
function RupeeInput({ id, label, paise, onPaise, disabled, help }: { id: string; label: string; paise: number; onPaise: (p: number) => void; disabled?: boolean; help?: string }) {
  const [text, setText] = useState(String(paiseToRupees(paise)));
  useEffect(() => setText(String(paiseToRupees(paise))), [paise]);
  return (
    <Field id={id} label={label} help={help}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: 9, fontSize: 13, color: 'var(--mfg)' }}>₹</span>
        <TextInput
          id={id}
          inputMode='numeric'
          style={{ paddingLeft: 24 }}
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
    </Field>
  );
}

type Run = (label: string, fn: () => Promise<unknown>) => Promise<void>;
type Panel = { c: api.StaffConfig; writable: boolean; run: Run };

export function Admin() {
  const { can } = useMe();
  const toast = useToast();
  const writable = can('config:write');
  const [tab, setTab] = useState<Tab>('Zones');
  const cfg = useLoad(api.getConfig);

  if (cfg.loading) return <Loading />;
  if (cfg.error || !cfg.data) return <ErrorBox>{cfg.error?.message}</ErrorBox>;
  const c = cfg.data;

  const run: Run = async (label, fn) => {
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
      <H1 icon={<Icon name='settings' size={20} />} sub={`${c.edition.name} · ${writable ? 'you can edit' : 'read only'}`}>
        Admin
      </H1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, background: 'var(--mut)', borderRadius: 'calc(var(--r4) - 4px)', marginBottom: 16, width: 'fit-content', maxWidth: '100%' }}>
        {TABS.map((t) => (
          <button
            type='button'
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '7px 14px',
              borderRadius: 'calc(var(--r4) - 8px)',
              border: 0,
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: tab === t ? 700 : 500,
              background: tab === t ? 'var(--card)' : 'transparent',
              color: tab === t ? 'var(--fg)' : 'var(--mfg)',
              boxShadow: tab === t ? 'var(--ring)' : 'none',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Zones' && <Zones c={c} writable={writable} run={run} />}
      {tab === 'Rates' && <Rates c={c} writable={writable} run={run} />}
      {tab === 'Charges' && <Charges c={c} writable={writable} run={run} />}
      {tab === 'Fines' && <Fines c={c} writable={writable} run={run} />}
      {tab === 'Custom fields' && <CustomFields c={c} writable={writable} run={run} />}
      {tab === 'Flow' && <Flow c={c} writable={writable} run={run} />}
      {tab === 'Links' && <Links writable={writable} run={run} />}
      {tab === 'Users' && <Users writable={can('users:write')} />}
      {tab === 'Editions' && <Editions writable={writable} run={run} />}
    </div>
  );
}

function Zones({ c, writable, run }: Panel) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; crowd: string; closed: boolean }>>({});
  const d = (z: api.StaffConfig['zones'][number]) => drafts[z.code] ?? { name: z.name, crowd: String(z.expectedCrowd), closed: z.isClosedToVendors };
  const set = (code: string, patch: Partial<{ name: string; crowd: string; closed: boolean }>, z: api.StaffConfig['zones'][number]) => setDrafts((s) => ({ ...s, [code]: { ...d(z), ...patch } }));
  return (
    <Grid
      rows={c.zones}
      rowKey={(z) => z.id}
      columns={[
        { key: 'code', header: 'Code', width: '70px', mobile: 'title', render: (z) => <b>{z.code}</b> },
        { key: 'name', header: 'Name', width: '1.6fr', render: (z) => <TextInput aria-label={`${z.code} name`} value={d(z).name} disabled={!writable} onChange={(e) => set(z.code, { name: e.target.value }, z)} /> },
        { key: 'crowd', header: 'Expected crowd', width: '140px', render: (z) => <TextInput aria-label={`${z.code} crowd`} inputMode='numeric' value={d(z).crowd} disabled={!writable} onChange={(e) => set(z.code, { crowd: e.target.value }, z)} /> },
        {
          key: 'closed',
          header: 'Vendors',
          width: '170px',
          render: (z) => (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <input type='checkbox' checked={d(z).closed} disabled={!writable} onChange={(e) => set(z.code, { closed: e.target.checked }, z)} style={{ accentColor: 'var(--pri)' }} />
              Closed to vendors
            </label>
          ),
        },
      ]}
      actions={(z) => {
        const x = d(z);
        const dirty = x.name !== z.name || Number(x.crowd) !== z.expectedCrowd || x.closed !== z.isClosedToVendors;
        return (
          <Btn disabled={!writable || !dirty} onClick={() => run(`${z.code} saved`, () => api.updateZone(z.code, { name: x.name, expectedCrowd: Number(x.crowd) || 0, isClosedToVendors: x.closed }))}>
            Save
          </Btn>
        );
      }}
    />
  );
}

function Rates({ c, writable, run }: Panel) {
  const [entries, setEntries] = useState(c.rateCard);
  useEffect(() => setEntries(c.rateCard), [c.rateCard]);
  const get = (g: 'AB' | 'C', f: boolean) => entries.find((e) => e.zoneGroup === g && e.isFood === f)?.amountPaise ?? 0;
  const set = (g: 'AB' | 'C', f: boolean, p: number) =>
    setEntries((es) => {
      const i = es.findIndex((e) => e.zoneGroup === g && e.isFood === f);
      const next = [...es];
      if (i >= 0) next[i] = { ...next[i]!, amountPaise: p };
      else next.push({ zoneGroup: g, isFood: f, amountPaise: p });
      return next;
    });
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Stall rent</div>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 14 }}>Per stall, before GST. A3 and B2 are closed to vendors and carry no rent.</div>
      <Row2>
        <RupeeInput id='ab-food' label='A4 / B3 / B4 — Food' paise={get('AB', true)} onPaise={(p) => set('AB', true, p)} disabled={!writable} />
        <RupeeInput id='ab-nonfood' label='A4 / B3 / B4 — Non-food' paise={get('AB', false)} onPaise={(p) => set('AB', false, p)} disabled={!writable} />
        <RupeeInput id='c-food' label='C1 / C2 — Food' paise={get('C', true)} onPaise={(p) => set('C', true, p)} disabled={!writable} />
        <RupeeInput id='c-nonfood' label='C1 / C2 — Non-food' paise={get('C', false)} onPaise={(p) => set('C', false, p)} disabled={!writable} />
      </Row2>
      <Btn kind='primary' disabled={!writable} onClick={() => run('Rates saved', () => api.putRateCard(entries.filter((e) => e.zoneGroup !== 'CLOSED')))}>
        Save rates
      </Btn>
    </Card>
  );
}

function Charges({ c, writable, run }: Panel) {
  const [v, setV] = useState(c.charges);
  useEffect(() => setV(c.charges), [c.charges]);
  const f = (k: keyof typeof v) => ({ paise: v[k] as number, onPaise: (p: number) => setV({ ...v, [k]: p }), disabled: !writable });
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Charges and deposits</div>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 14 }}>
        The 2025 forms quoted three different chair and table rate pairs — to ashram departments, to local welfare stalls and to vendors. All three are kept.
      </div>
      <Row2>
        <RupeeInput id='chair' label='Chair / day — ashram' {...f('chairRatePaise')} />
        <RupeeInput id='table' label='Table / day — ashram' {...f('tableRatePaise')} />
        <RupeeInput id='lwchair' label='Chair / day — local welfare' {...f('lwChairRatePaise')} />
        <RupeeInput id='lwtable' label='Table / day — local welfare' {...f('lwTableRatePaise')} />
        <RupeeInput id='vchair' label='Chair / day — vendor' {...f('vendorChairRatePaise')} />
        <RupeeInput id='vtable' label='Table / day — vendor' {...f('vendorTableRatePaise')} />
        <RupeeInput id='vdep' label='Security deposit — vendor' {...f('vendorDepositPaise')} />
        <RupeeInput id='lwdep' label='Caution deposit — local welfare' {...f('localWelfareDepositPaise')} />
        <RupeeInput id='p5' label='Extra 5 A plug point' {...f('plug5aRatePaise')} />
        <RupeeInput id='p15' label='15 A plug point' {...f('plug15aRatePaise')} />
        <RupeeInput id='crep' label='Replacement — chair' {...f('chairReplacementPaise')} help='Deducted from the deposit per missing or damaged chair' />
        <RupeeInput id='trep' label='Replacement — table' {...f('tableReplacementPaise')} />
        <Field id='gst' label='GST %'>
          <TextInput id='gst' inputMode='numeric' value={v.gstPercent} disabled={!writable} onChange={(e) => setV({ ...v, gstPercent: Number(e.target.value) || 0 })} />
        </Field>
        <Field id='days' label='Event days' help='Chairs and tables are billed per day for this many days'>
          <TextInput id='days' inputMode='numeric' value={v.eventDays} disabled={!writable} onChange={(e) => setV({ ...v, eventDays: Number(e.target.value) || 1 })} />
        </Field>
        <Field id='cps2' label='People per stall (planning)'>
          <TextInput id='cps2' inputMode='numeric' value={v.crowdPerStall} disabled={!writable} onChange={(e) => setV({ ...v, crowdPerStall: Number(e.target.value) || 1 })} />
        </Field>
      </Row2>
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
    </Card>
  );
}

function Fines({ c, writable, run }: Panel) {
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Grid
        rows={c.fineTypes}
        rowKey={(f) => f.id}
        empty='No fine types yet.'
        columns={[
          { key: 'reason', header: 'Reason', width: '1fr', mobile: 'title', render: (f) => f.reason },
          { key: 'amt', header: 'Default', width: '120px', align: 'right', render: (f) => formatInr(f.defaultAmountPaise) },
          {
            key: 'active',
            header: 'Active',
            width: '80px',
            render: (f) => (
              <input type='checkbox' aria-label={`${f.reason} active`} checked={f.isActive} disabled={!writable} onChange={(e) => run('Updated', () => api.putFineType({ reason: f.reason, defaultAmountPaise: f.defaultAmountPaise, isActive: e.target.checked }))} style={{ accentColor: 'var(--pri)' }} />
            ),
          },
        ]}
      />
      {writable && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>New fine type</div>
          <Row2>
            <Field id='fr' label='Reason'>
              <TextInput id='fr' placeholder='Unclean stall' value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field id='fa' label='Amount (₹)'>
              <TextInput id='fa' inputMode='numeric' value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </Row2>
          <Btn
            kind='primary'
            disabled={!reason.trim() || !amount}
            onClick={() =>
              run('Fine type added', async () => {
                await api.putFineType({ reason: reason.trim(), defaultAmountPaise: rupeesToPaise(Number(amount)), isActive: true });
                setReason('');
                setAmount('');
              })
            }
          >
            Add
          </Btn>
        </Card>
      )}
    </div>
  );
}

const FORM_TYPES = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD', 'BANK', 'FSSAI'] as const;

function CustomFields({ c, writable, run }: Panel) {
  const [formType, setFormType] = useState<(typeof FORM_TYPES)[number]>('VENDOR');
  const [label, setLabel] = useState('');
  const [labelTa, setLabelTa] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [required, setRequired] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Grid
        rows={c.customFields}
        rowKey={(f) => f.id}
        empty='No custom fields. The base forms are fixed; anything you add here is appended to the end.'
        columns={[
          { key: 'form', header: 'Form', width: '130px', mobile: 'sub', render: (f) => <Tag size='sm'>{f.formType}</Tag> },
          {
            key: 'label',
            header: 'Label',
            width: '1.6fr',
            mobile: 'title',
            render: (f) => (
              <span style={{ opacity: f.isActive ? 1 : 0.55 }}>
                {f.label}
                {f.labelTa && (
                  <span className='msrs-ta' lang='ta' style={{ color: 'var(--mfg)', marginLeft: 6 }}>
                    / {f.labelTa}
                  </span>
                )}
              </span>
            ),
          },
          { key: 'type', header: 'Type', width: '90px', render: (f) => f.fieldType },
          { key: 'req', header: 'Required', width: '80px', render: (f) => (f.isRequired ? 'Yes' : '—') },
          {
            key: 'active',
            header: 'Active',
            width: '70px',
            render: (f) => <input type='checkbox' aria-label={`${f.label} active`} checked={f.isActive} disabled={!writable} onChange={(e) => run('Updated', () => api.patchCustomField(f.id, { isActive: e.target.checked }))} style={{ accentColor: 'var(--pri)' }} />,
          },
        ]}
        actions={(f) => (
          <Btn kind='danger' disabled={!writable} onClick={() => run('Deleted', () => api.deleteCustomField(f.id))}>
            Delete
          </Btn>
        )}
      />
      {writable && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Add a field</div>
          <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 12 }}>A field that has been answered can be deactivated but not deleted.</div>
          <Row2>
            <Field id='cf-form' label='Form'>
              <SelectInput id='cf-form' value={formType} onChange={(e) => setFormType(e.target.value as (typeof FORM_TYPES)[number])}>
                {FORM_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </SelectInput>
            </Field>
            <Field id='cf-type' label='Type'>
              <SelectInput id='cf-type' value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
                <option value='text'>Text</option>
                <option value='textarea'>Paragraph</option>
                <option value='number'>Number</option>
                <option value='checkbox'>Checkbox</option>
              </SelectInput>
            </Field>
            <Field id='cf-label' label='Label'>
              <TextInput id='cf-label' value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field id='cf-ta' label='Tamil label (optional)'>
              <TextInput id='cf-ta' className='msrs-ta' value={labelTa} onChange={(e) => setLabelTa(e.target.value)} />
            </Field>
          </Row2>
          <CheckRow id='cf-req' checked={required} onChange={setRequired} label='Required' />
          <Btn
            kind='primary'
            disabled={!label.trim()}
            onClick={() =>
              run('Field added', async () => {
                await api.createCustomField({ formType, label: label.trim(), labelTa: labelTa.trim() || null, fieldType, isRequired: required, sortOrder: c.customFields.filter((f) => f.formType === formType).length });
                setLabel('');
                setLabelTa('');
              })
            }
          >
            Add
          </Btn>
        </Card>
      )}
    </div>
  );
}

function Flow({ c, writable, run }: Panel) {
  const [v, setV] = useState(c.flow);
  useEffect(() => setV(c.flow), [c.flow]);
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Onboarding flow</div>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 12 }}>Which steps a selected vendor goes through. Ashram departments skip the money steps regardless.</div>
      <CheckRow id='f-bank' checked={v.bankStepEnabled} disabled={!writable} onChange={(b) => setV({ ...v, bankStepEnabled: b })} label='Bank, GST and contract details' help='Collected by emailed form after selection.' />
      <CheckRow id='f-pay' checked={v.paymentStepEnabled} disabled={!writable} onChange={(b) => setV({ ...v, paymentStepEnabled: b })} label='Payment details and confirmation' help='Payment email, then finance confirms receipt.' />
      <CheckRow id='f-fssai' checked={v.fssaiStepEnabled} disabled={!writable} onChange={(b) => setV({ ...v, fssaiStepEnabled: b })} label='FSSAI certificate upload' help='Food stalls upload before check-in.' />
      <Btn kind='primary' disabled={!writable} onClick={() => run('Flow saved', () => api.putFlow(v))}>
        Save
      </Btn>
    </Card>
  );
}

function Links({ writable, run }: { writable: boolean; run: Run }) {
  const links = useLoad(api.getLinks);
  const [v, setV] = useState<api.LinksRow | null>(null);
  useEffect(() => {
    if (links.data) setV(links.data);
  }, [links.data]);
  if (!v) return <Loading />;
  const s = (k: keyof api.LinksRow) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value || null });
  return (
    <Card>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>Links and texts</div>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 12 }}>What the emails and the vendor's pages carry. Blank ones render as nothing.</div>
      <Field id='l-terms' label='Terms and conditions URL'>
        <TextInput id='l-terms' type='url' value={v.termsUrl ?? ''} disabled={!writable} onChange={s('termsUrl')} />
      </Field>
      <Field id='l-staff' label='Staff registration URL' help='The external Sewadhar registration page'>
        <TextInput id='l-staff' type='url' value={v.staffRegistrationUrl ?? ''} disabled={!writable} onChange={s('staffRegistrationUrl')} />
      </Field>
      <Field id='l-fssai' label='FSSAI process URL' help='How a vendor obtains a certificate'>
        <TextInput id='l-fssai' type='url' value={v.fssaiProcessUrl ?? ''} disabled={!writable} onChange={s('fssaiProcessUrl')} />
      </Field>
      <Field id='l-fin' label='Finance email'>
        <TextInput id='l-fin' type='email' value={v.financeEmail ?? ''} disabled={!writable} onChange={s('financeEmail')} />
      </Field>
      <Field id='l-bank' label='NEFT instructions' help="Isha Foundation's account details, as printed in the payment email">
        <TextArea id='l-bank' rows={4} value={v.bankInstructions ?? ''} disabled={!writable} onChange={s('bankInstructions')} />
      </Field>
      <Btn
        kind='primary'
        disabled={!writable}
        onClick={() =>
          run('Links saved', () =>
            api.putLinks({
              termsUrl: v.termsUrl,
              staffRegistrationUrl: v.staffRegistrationUrl,
              fssaiProcessUrl: v.fssaiProcessUrl,
              financeEmail: v.financeEmail,
              bankInstructions: v.bankInstructions,
            }),
          )
        }
      >
        Save
      </Btn>
    </Card>
  );
}

function Users({ writable }: { writable: boolean }) {
  const toast = useToast();
  const staff = useLoad(api.listStaff);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Array<{ personId: string; email: string; displayName: string }>>([]);
  const [roleKey, setRoleKey] = useState(ROLES[1]!.roleKey);

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
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Roles</div>
        <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 10 }}>What each role may do. Declared by the module, not by the platform.</div>
        {ROLES.map((r) => (
          <div key={r.roleKey} style={{ display: 'flex', gap: 12, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
            <div style={{ width: 200, fontWeight: 600, flex: 'none' }}>{r.name}</div>
            <div style={{ color: 'var(--mfg)' }}>{r.description}</div>
          </div>
        ))}
      </Card>
      <Grid
        rows={staff.data ?? []}
        rowKey={(s) => s.personId}
        empty='Nobody holds a stalls role yet.'
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: '1.2fr',
            mobile: 'title',
            render: (s) => (
              <>
                <b>{s.displayName}</b>
                <Sub>{s.email}</Sub>
              </>
            ),
          },
          {
            key: 'roles',
            header: 'Roles',
            width: '2fr',
            render: (s) => (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {s.roleKeys.map((rk) => (
                  <span key={rk} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Tag tone='info' size='sm'>
                      {ROLES.find((r) => r.roleKey === rk)?.name ?? rk}
                    </Tag>
                    {writable && (
                      <button type='button' aria-label={`Revoke ${rk} from ${s.displayName}`} onClick={() => revoke(s.personId, rk)} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--mfg)', padding: 2, display: 'flex' }}>
                        <Icon name='x' size={12} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ),
          },
        ]}
      />
      {writable && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Add a staff member</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <TextInput id='ps' placeholder='Search name or email…' value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            </div>
            <Btn onClick={search}>Search</Btn>
            <SelectInput aria-label='Role' value={roleKey} onChange={(e) => setRoleKey(e.target.value)} style={{ width: 220 }}>
              {ROLES.map((r) => (
                <option key={r.roleKey} value={r.roleKey}>
                  {r.name}
                </option>
              ))}
            </SelectInput>
          </div>
          {found.map((p) => (
            <div key={p.personId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px', marginTop: 8, borderRadius: 'var(--r2)', background: 'var(--mut)', fontSize: 13 }}>
              <span>
                {p.displayName} <span style={{ color: 'var(--mfg)' }}>· {p.email}</span>
              </span>
              <Btn kind='primary' onClick={() => grant(p.personId)}>
                Grant
              </Btn>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Editions({ writable, run }: { writable: boolean; run: Run }) {
  const eds = useLoad(api.listEditions);
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [name, setName] = useState('');
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Grid
        rows={eds.data ?? []}
        rowKey={(e) => e.id}
        columns={[
          { key: 'year', header: 'Year', width: '80px', mobile: 'title', render: (e) => <b>{e.year}</b> },
          { key: 'name', header: 'Name', width: '1fr', render: (e) => e.name },
          { key: 'active', header: 'Active', width: '100px', render: (e) => (e.isActive ? <Tag tone='ok' size='sm'>Active</Tag> : null) },
        ]}
        actions={(e) =>
          e.isActive ? null : (
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
          )
        }
      />
      {writable && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>New edition</div>
          <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 12 }}>
            One per MSR. Exactly one is active; the public forms and every staff screen read it. A new one is seeded with the 2025 zones, rates, charges and email templates.
          </div>
          <Row2>
            <Field id='ey' label='Year'>
              <TextInput id='ey' inputMode='numeric' value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
            <Field id='en' label='Name'>
              <TextInput id='en' placeholder={`MSR ${year}`} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </Row2>
          <Btn
            kind='primary'
            onClick={() =>
              run('Edition created', async () => {
                await api.createEdition({ year: Number(year), name: name.trim() || `MSR ${year}`, activate: true });
                eds.reload();
              })
            }
          >
            Create and activate
          </Btn>
        </Card>
      )}
    </div>
  );
}

export { Mono };

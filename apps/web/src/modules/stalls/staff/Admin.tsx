import { ROLES, formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Checkbox, Field, Input, Label, Select } from '../../../components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '../../../components/ui/table';
import { cn } from '../../../lib/cn';
import * as api from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';

const TABS = [
  'Zones',
  'Rates',
  'Charges',
  'Fines',
  'Custom fields',
  'Flow',
  'Users',
  'Editions',
] as const;
type Tab = (typeof TABS)[number];

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
    <Field id={id} label={label}>
      <div className='relative'>
        <span className='pointer-events-none absolute left-3 top-2 text-sm text-ink-3'>₹</span>
        <Input
          id={id}
          type='number'
          min={0}
          step='1'
          className='pl-7'
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

export function Admin() {
  const { can } = useMe();
  const writable = can('config:write');
  const [tab, setTab] = useState<Tab>('Zones');
  const cfg = useLoad(api.getConfig);

  if (cfg.loading) return <p className='text-sm text-ink-2'>Loading…</p>;
  if (cfg.error || !cfg.data) return <p className='text-sm text-bad'>{cfg.error?.message}</p>;
  const c = cfg.data;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
      cfg.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold'>Admin</h1>
        <p className='text-sm text-ink-2'>
          {c.edition.name} · {writable ? 'you can edit' : 'read only'}
        </p>
      </div>
      <div className='flex flex-wrap gap-1 border-b border-line'>
        {TABS.map((t) => (
          <button
            type='button'
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === t
                ? 'border-accent font-semibold text-accent'
                : 'border-transparent text-ink-2 hover:text-ink',
            )}
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
      {tab === 'Users' && <Users writable={can('users:write')} />}
      {tab === 'Editions' && <Editions writable={writable} run={run} />}
    </div>
  );
}

type Panel = {
  c: api.StaffConfig;
  writable: boolean;
  run: (l: string, f: () => Promise<unknown>) => Promise<void>;
};

function Zones({ c, writable, run }: Panel) {
  return (
    <Card>
      <Table>
        <THead>
          <TR>
            <TH>Code</TH>
            <TH>Name</TH>
            <TH className='text-right'>Expected crowd</TH>
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
    </Card>
  );
}

function ZoneRow({ z, writable, run }: { z: api.StaffConfig['zones'][number] } & Omit<Panel, 'c'>) {
  const [name, setName] = useState(z.name);
  const [crowd, setCrowd] = useState(String(z.expectedCrowd));
  const [closed, setClosed] = useState(z.isClosedToVendors);
  const dirty =
    name !== z.name || Number(crowd) !== z.expectedCrowd || closed !== z.isClosedToVendors;
  return (
    <TR>
      <TD className='font-mono font-semibold'>{z.code}</TD>
      <TD>
        <Input
          aria-label={`${z.code} name`}
          value={name}
          disabled={!writable}
          onChange={(e) => setName(e.target.value)}
        />
      </TD>
      <TD className='text-right'>
        <Input
          aria-label={`${z.code} crowd`}
          type='number'
          min={0}
          className='w-28 text-right'
          value={crowd}
          disabled={!writable}
          onChange={(e) => setCrowd(e.target.value)}
        />
      </TD>
      <TD>
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={closed}
            disabled={!writable}
            onChange={(e) => setClosed(e.target.checked)}
          />
          Closed to vendors
        </label>
      </TD>
      <TD className='text-right'>
        <Button
          size='sm'
          variant='outline'
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
        </Button>
      </TD>
    </TR>
  );
}

function Rates({ c, writable, run }: Panel) {
  const [entries, setEntries] = useState(c.rateCard);
  useEffect(() => setEntries(c.rateCard), [c.rateCard]);
  const get = (g: 'AB' | 'C', f: boolean) =>
    entries.find((e) => e.zoneGroup === g && e.isFood === f)?.amountPaise ?? 0;
  const set = (g: 'AB' | 'C', f: boolean, p: number) =>
    setEntries((es) => {
      const i = es.findIndex((e) => e.zoneGroup === g && e.isFood === f);
      const next = [...es];
      if (i >= 0) next[i] = { ...next[i], amountPaise: p };
      else next.push({ zoneGroup: g, isFood: f, amountPaise: p });
      return next;
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stall rent</CardTitle>
        <CardDescription>
          Per stall, before GST. A3 and B2 are closed to vendors and carry no rent.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4 sm:grid-cols-2'>
        <RupeeInput
          id='ab-food'
          label='A4 / B3 / B4 — Food'
          paise={get('AB', true)}
          onPaise={(p) => set('AB', true, p)}
          disabled={!writable}
        />
        <RupeeInput
          id='ab-nonfood'
          label='A4 / B3 / B4 — Non-food'
          paise={get('AB', false)}
          onPaise={(p) => set('AB', false, p)}
          disabled={!writable}
        />
        <RupeeInput
          id='c-food'
          label='C1 / C2 — Food'
          paise={get('C', true)}
          onPaise={(p) => set('C', true, p)}
          disabled={!writable}
        />
        <RupeeInput
          id='c-nonfood'
          label='C1 / C2 — Non-food'
          paise={get('C', false)}
          onPaise={(p) => set('C', false, p)}
          disabled={!writable}
        />
        <div className='sm:col-span-2'>
          <Button
            disabled={!writable}
            onClick={() =>
              run('Rates saved', () =>
                api.putRateCard(entries.filter((e) => e.zoneGroup !== 'CLOSED')),
              )
            }
          >
            Save rates
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Charges({ c, writable, run }: Panel) {
  const [v, setV] = useState(c.charges);
  useEffect(() => setV(c.charges), [c.charges]);
  const f = (k: keyof typeof v) => ({
    paise: v[k] as number,
    onPaise: (p: number) => setV({ ...v, [k]: p }),
    disabled: !writable,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Charges and deposits</CardTitle>
        <CardDescription>
          The 2025 forms quoted different chair and table rates to ashram departments and to local
          welfare stalls. Both are kept.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <RupeeInput id='chair' label='Chair / day (ashram)' {...f('chairRatePaise')} />
        <RupeeInput id='table' label='Table / day (ashram)' {...f('tableRatePaise')} />
        <RupeeInput id='lwchair' label='Chair / day (local welfare)' {...f('lwChairRatePaise')} />
        <RupeeInput id='lwtable' label='Table / day (local welfare)' {...f('lwTableRatePaise')} />
        <RupeeInput id='vdep' label='Security deposit — vendor' {...f('vendorDepositPaise')} />
        <RupeeInput
          id='lwdep'
          label='Caution deposit — local welfare'
          {...f('localWelfareDepositPaise')}
        />
        <RupeeInput id='p5' label='Extra 5 A plug point' {...f('plug5aRatePaise')} />
        <RupeeInput id='p15' label='15 A plug point' {...f('plug15aRatePaise')} />
        <Field id='gst' label='GST %'>
          <Input
            id='gst'
            type='number'
            min={0}
            max={100}
            value={v.gstPercent}
            disabled={!writable}
            onChange={(e) => setV({ ...v, gstPercent: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field id='cps2' label='People per stall (planning)'>
          <Input
            id='cps2'
            type='number'
            min={1}
            value={v.crowdPerStall}
            disabled={!writable}
            onChange={(e) => setV({ ...v, crowdPerStall: Number(e.target.value) || 1 })}
          />
        </Field>
        <div className='sm:col-span-2 lg:col-span-3'>
          <Button
            disabled={!writable}
            onClick={() =>
              run('Charges saved', () => {
                const { id: _id, editionId: _e, ...body } = v;
                return api.putCharges(body);
              })
            }
          >
            Save charges
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Fines({ c, writable, run }: Panel) {
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fine types</CardTitle>
        <CardDescription>Deducted from the deposit in Phase 3. Configured here.</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <Table>
          <THead>
            <TR>
              <TH>Reason</TH>
              <TH className='text-right'>Default</TH>
              <TH>Active</TH>
            </TR>
          </THead>
          <TBody>
            {c.fineTypes.map((ft) => (
              <TR key={ft.id}>
                <TD>{ft.reason}</TD>
                <TD className='text-right tabular-nums'>{formatInr(ft.defaultAmountPaise)}</TD>
                <TD>
                  <Checkbox
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
        {writable && (
          <div className='flex flex-wrap items-end gap-2'>
            <Field id='fr' label='New fine'>
              <Input
                id='fr'
                placeholder='Reason'
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Field id='fa' label='Amount (₹)'>
              <Input
                id='fa'
                type='number'
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className='w-32'
              />
            </Field>
            <Button
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
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
        <CardDescription>
          Appended to the end of a base form. A field that has been answered can be deactivated but
          not deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
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
              <TR key={f.id} className={cn(!f.isActive && 'opacity-60')}>
                <TD>
                  <Badge>{f.formType}</Badge>
                </TD>
                <TD>
                  {f.label}
                  {f.labelTa && (
                    <span className='font-tamil ml-1 text-ink-2' lang='ta'>
                      / {f.labelTa}
                    </span>
                  )}
                </TD>
                <TD>{f.fieldType}</TD>
                <TD>{f.isRequired ? 'Yes' : '—'}</TD>
                <TD>
                  <Checkbox
                    checked={f.isActive}
                    disabled={!writable}
                    onChange={(e) =>
                      run('Updated', () =>
                        api.patchCustomField(f.id, { isActive: e.target.checked }),
                      )
                    }
                  />
                </TD>
                <TD className='text-right'>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={!writable}
                    onClick={() => run('Deleted', () => api.deleteCustomField(f.id))}
                  >
                    Delete
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {writable && (
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
            <Field id='cf-form' label='Form'>
              <Select
                id='cf-form'
                value={formType}
                onChange={(e) => setFormType(e.target.value as (typeof FORM_TYPES)[number])}
              >
                {FORM_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field id='cf-label' label='Label'>
              <Input id='cf-label' value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field id='cf-ta' label='Tamil label (optional)'>
              <Input
                id='cf-ta'
                className='font-tamil'
                value={labelTa}
                onChange={(e) => setLabelTa(e.target.value)}
              />
            </Field>
            <Field id='cf-type' label='Type'>
              <Select id='cf-type' value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
                <option value='text'>Text</option>
                <option value='textarea'>Paragraph</option>
                <option value='number'>Number</option>
                <option value='checkbox'>Checkbox</option>
              </Select>
            </Field>
            <div className='flex items-end gap-3'>
              <label className='flex items-center gap-2 pb-2 text-sm'>
                <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />{' '}
                Required
              </label>
              <Button
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
                Add
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Flow({ c, writable, run }: Panel) {
  const [v, setV] = useState(c.flow);
  useEffect(() => setV(c.flow), [c.flow]);
  const Row = ({ k, label, help }: { k: keyof typeof v; label: string; help: string }) => (
    <label className='flex items-start gap-3 rounded-md border border-line p-3'>
      <Checkbox
        checked={v[k]}
        disabled={!writable}
        onChange={(e) => setV({ ...v, [k]: e.target.checked })}
        className='mt-0.5'
      />
      <span>
        <span className='block text-sm font-medium'>{label}</span>
        <span className='block text-xs text-ink-2'>{help}</span>
      </span>
    </label>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding flow</CardTitle>
        <CardDescription>
          Which steps a selected vendor goes through. Phase 2 and 3 read these.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <Row
          k='bankStepEnabled'
          label='Bank, GST and contract details'
          help='Collected by emailed form after selection.'
        />
        <Row
          k='paymentStepEnabled'
          label='Payment details and confirmation'
          help='Payment email, then finance confirms receipt.'
        />
        <Row
          k='fssaiStepEnabled'
          label='FSSAI certificate upload'
          help='Food stalls upload before check-in.'
        />
        <Button disabled={!writable} onClick={() => run('Flow saved', () => api.putFlow(v))}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function Users({ writable }: { writable: boolean }) {
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
      toast.success('Granted');
      setFound([]);
      setQ('');
      staff.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const revoke = async (personId: string, rk: string) => {
    try {
      await api.revokeRole(personId, rk);
      toast.success('Revoked');
      staff.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>
            What each role may do. Declared by the module, not by the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  <TD className='font-medium'>{r.name}</TD>
                  <TD className='text-ink-2'>{r.description}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Roles</TH>
              </TR>
            </THead>
            <TBody>
              {(staff.data ?? []).map((s) => (
                <TR key={s.personId}>
                  <TD className='font-medium'>{s.displayName}</TD>
                  <TD className='text-ink-2'>{s.email}</TD>
                  <TD>
                    <div className='flex flex-wrap gap-1'>
                      {s.roleKeys.map((rk) => (
                        <span key={rk} className='inline-flex items-center gap-1'>
                          <Badge tone='accent'>
                            {ROLES.find((r) => r.roleKey === rk)?.name ?? rk}
                          </Badge>
                          {writable && (
                            <button
                              type='button'
                              className='text-xs text-ink-3 hover:text-bad'
                              aria-label={`Revoke ${rk} from ${s.displayName}`}
                              onClick={() => revoke(s.personId, rk)}
                            >
                              ×
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
          {writable && (
            <div className='space-y-2 rounded-md border border-line p-3'>
              <Label htmlFor='ps'>Add a staff member</Label>
              <div className='flex flex-wrap gap-2'>
                <Input
                  id='ps'
                  placeholder='Search name or email…'
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  className='w-64'
                />
                <Button variant='outline' onClick={search}>
                  Search
                </Button>
                <Select
                  aria-label='Role'
                  value={roleKey}
                  onChange={(e) => setRoleKey(e.target.value)}
                  className='w-56'
                >
                  {ROLES.map((r) => (
                    <option key={r.roleKey} value={r.roleKey}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              {found.map((p) => (
                <div
                  key={p.personId}
                  className='flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-sm'
                >
                  <span>
                    {p.displayName} <span className='text-ink-2'>· {p.email}</span>
                  </span>
                  <Button size='sm' onClick={() => grant(p.personId)}>
                    Grant
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Editions({ writable, run }: { writable: boolean; run: Panel['run'] }) {
  const eds = useLoad(api.listEditions);
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [name, setName] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Editions</CardTitle>
        <CardDescription>
          One per MSR. Exactly one is active; the public forms and every staff screen read it.
          Creating a new one seeds zones, rates and charges from the 2025 defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
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
            {(eds.data ?? []).map((e) => (
              <TR key={e.id}>
                <TD className='font-semibold'>{e.year}</TD>
                <TD>{e.name}</TD>
                <TD>{e.isActive && <Badge tone='good'>Active</Badge>}</TD>
                <TD className='text-right'>
                  {!e.isActive && (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={!writable}
                      onClick={() =>
                        run(`${e.year} activated`, async () => {
                          await api.activateEdition(e.id);
                          eds.reload();
                        })
                      }
                    >
                      Activate
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {writable && (
          <div className='flex flex-wrap items-end gap-2'>
            <Field id='ey' label='Year'>
              <Input
                id='ey'
                type='number'
                className='w-28'
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </Field>
            <Field id='en' label='Name'>
              <Input
                id='en'
                placeholder={`MSR ${year}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button
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
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

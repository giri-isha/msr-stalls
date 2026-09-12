import {
  FORM_DEFINITIONS,
  type FormField,
  type PublicConfig,
  type StallRequestType,
  SubmitRequestInput,
  formatInr,
} from '@msr/stalls';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '../../../components/ui/input';
import { ApiError, fieldErrorsFrom } from '../../../lib/api-client';
import { getPublicConfig, submitRequest } from '../api';
import { type ApplianceRow, ApplianceRows } from '../components/ApplianceRows';
import { BilingualLabel } from '../components/BilingualLabel';
import { ZoneSelect } from '../components/ZoneSelect';
import { useLoad } from '../hooks';
import { SLUG_TYPE } from './FormPicker';

type Values = Record<string, string | boolean | ApplianceRow[]>;

const ASHRAM_TYPES = new Set<StallRequestType>(['ASHRAM', 'ASHRAM_FOOD']);
const ASHRAM_BLOCK = new Set([
  'departmentHead',
  'departmentHeadContact',
  'department',
  'requestedBy',
  'requesterContact',
  'creditCardNeeded',
  'usage',
  'wantsThembu',
  'fssaiExpected',
]);
const NUMERIC = new Set([
  'numStallsRequested',
  'plugs5a',
  'plugs15a',
  'gasStoves',
  'tablesNeeded',
  'chairsNeeded',
  'passes2w',
  'passes4w',
  'passesStaff',
]);

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (str(v).trim() === '' ? undefined : Number(str(v)));
const yes = (v: unknown) => v === 'YES';

/** Turn the flat, string-valued form state into the wire shape. The form's
 *  field names and the contract's keys differ in a few known places — the
 *  ashram forms nest a department block and have no vendor name of their own —
 *  and this is the one function that knows about them. */
function buildInput(
  type: StallRequestType,
  values: Values,
  customFieldIds: string[],
): Record<string, unknown> {
  const ashram = ASHRAM_TYPES.has(type);
  const appliances = (Array.isArray(values.appliances) ? values.appliances : [])
    .filter((a) => a.name.trim() !== '')
    .map((a) => ({ name: a.name.trim(), watts: num(a.watts) ?? 0 }));
  const customFields: Record<string, string> = {};
  for (const id of customFieldIds) {
    const v = values[`cf:${id}`];
    if (typeof v === 'boolean') customFields[id] = v ? 'yes' : '';
    else if (typeof v === 'string' && v.trim()) customFields[id] = v.trim();
  }
  const base: Record<string, unknown> = {
    requestType: type,
    stallName: str(values.stallName),
    requesterName: ashram ? str(values.requestedBy) : str(values.requesterName),
    email: str(values.email),
    contactNumber: ashram ? str(values.requesterContact) : str(values.contactNumber),
    address: str(values.address) || undefined,
    stallType: ashram ? (type === 'ASHRAM_FOOD' ? 'FOOD' : 'NON_FOOD') : str(values.stallType),
    preferredZoneCode: str(values.preferredZoneCode),
    itemsSelling: str(values.itemsSelling),
    numStallsRequested: num(values.numStallsRequested),
    remarks: str(values.remarks) || undefined,
    agreed: values.agreed === true,
    depositAcknowledged: values.depositAcknowledged === true,
    appliances: appliances.length ? appliances : undefined,
    customFields,
  };
  for (const k of NUMERIC)
    if (k !== 'numStallsRequested' && k in values) base[k] = num(values[k]) ?? 0;
  if (ashram) {
    base.ashram = {
      departmentHead: str(values.departmentHead),
      departmentHeadContact: str(values.departmentHeadContact),
      department: str(values.department),
      requestedBy: str(values.requestedBy),
      requesterContact: str(values.requesterContact),
      creditCardNeeded: yes(values.creditCardNeeded),
      usage: str(values.usage),
      wantsThembu: yes(values.wantsThembu),
      fssaiExpected: values.fssaiExpected === undefined ? undefined : yes(values.fssaiExpected),
    };
  }
  return base;
}

/** The inverse of the renames above, for putting a server or Zod error back on
 *  the input that caused it. */
function fieldNameFor(path: string, type: StallRequestType): string {
  const ashram = ASHRAM_TYPES.has(type);
  if (path.startsWith('ashram.')) return path.slice('ashram.'.length);
  if (path === 'ashram') return 'departmentHead';
  if (path === 'requesterName' && ashram) return 'requestedBy';
  if (path === 'contactNumber' && ashram) return 'requesterContact';
  if (path.startsWith('customFields.')) return `cf:${path.slice('customFields.'.length)}`;
  return path;
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'boolean') return v === false;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function RequestForm() {
  const { type: slug } = useParams();
  const type = slug ? SLUG_TYPE[slug] : undefined;
  if (!type) return <Navigate to='/stalls/apply' replace />;
  return <Form type={type} />;
}

function Form({ type }: { type: StallRequestType }) {
  const def = FORM_DEFINITIONS[type];
  const navigate = useNavigate();
  const config = useLoad(getPublicConfig);
  const customFields = useMemo(
    () => (config.data?.customFields ?? []).filter((f) => f.formType === type),
    [config.data, type],
  );

  const [values, setValues] = useState<Values>({ appliances: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const set = (name: string, v: Values[string]) => {
    setValues((s) => ({ ...s, [name]: v }));
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };

  const allFields: FormField[] = [
    ...def.fields,
    ...customFields.map<FormField>((f) => ({
      name: `cf:${f.id}`,
      label: f.label,
      labelTa: f.labelTa,
      type: f.fieldType as FormField['type'],
      required: f.isRequired,
    })),
  ];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopError(null);
    // Required-ness comes from the form definition; shape from the contract.
    const missing: Record<string, string> = {};
    for (const f of allFields) {
      if (f.required && isEmpty(values[f.name])) {
        missing[f.name] = f.type === 'checkbox' ? 'Please tick to continue' : 'Required';
      }
    }
    const built = buildInput(
      type,
      values,
      customFields.map((f) => f.id),
    );
    const parsed = SubmitRequestInput.safeParse(built);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const name = fieldNameFor(issue.path.join('.'), type);
        if (!missing[name]) missing[name] = issue.message.replace(/^Invalid input:\s*/, '');
      }
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      setTopError('Please fix the highlighted fields.');
      document.getElementById(Object.keys(missing)[0])?.scrollIntoView?.({ block: 'center' });
      return;
    }
    if (!parsed.success) return;

    setSubmitting(true);
    try {
      const r = await submitRequest(parsed.data);
      navigate('/stalls/submitted', { state: { ...r, type }, replace: true });
    } catch (err) {
      const fe = fieldErrorsFrom(err);
      const mapped = Object.fromEntries(
        Object.entries(fe).map(([k, v]) => [fieldNameFor(k, type), v]),
      );
      setErrors(mapped);
      setTopError(
        err instanceof ApiError && err.status === 503
          ? 'Stall requests are not open right now. Please try again later.'
          : Object.keys(mapped).length
            ? 'Please fix the highlighted fields.'
            : (err as Error).message,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const isFood = ASHRAM_TYPES.has(type) ? type === 'ASHRAM_FOOD' : values.stallType === 'FOOD';

  return (
    <form onSubmit={onSubmit} noValidate className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold'>{def.title}</h1>
        {config.data && (
          <p className='mt-1 text-xs text-ink-3'>
            {config.data.edition.name}
            {type === 'LOCAL_WELFARE' &&
              ` · Refundable caution deposit ${formatInr(config.data.charges.localWelfareDepositPaise)}`}
          </p>
        )}
      </div>

      <Card className='border-accent/40 bg-accent-soft/30'>
        <CardContent className='space-y-2 p-4 text-sm'>
          <p>{def.disclaimer}</p>
          {def.disclaimerTa && (
            <p className='font-tamil' lang='ta'>
              {def.disclaimerTa}
            </p>
          )}
        </CardContent>
      </Card>

      {topError && (
        <p
          role='alert'
          className='rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad'
        >
          {topError}
        </p>
      )}

      <Card>
        <CardContent className='space-y-5 p-5'>
          {allFields.map((f) => (
            <FieldControl
              key={f.name}
              field={f}
              value={values[f.name]}
              error={errors[f.name]}
              onChange={(v) => set(f.name, v)}
              config={config.data}
              type={type}
              isFood={isFood}
            />
          ))}
        </CardContent>
      </Card>

      <div className='flex items-center justify-end gap-3'>
        <Button type='submit' size='lg' disabled={submitting || values.agreed !== true}>
          {submitting ? 'Submitting…' : 'Submit request'}
        </Button>
      </div>
    </form>
  );
}

function FieldControl({
  field: f,
  value,
  error,
  onChange,
  config,
  type,
  isFood,
}: {
  field: FormField;
  value: Values[string] | undefined;
  error?: string;
  onChange: (v: Values[string]) => void;
  config: PublicConfig | null;
  type: StallRequestType;
  isFood: boolean;
}) {
  const id = f.name;
  const label = <BilingualLabel en={f.label} ta={f.labelTa} />;
  const help = f.help ? (
    <>
      {f.help}
      {f.helpTa && (
        <>
          {' / '}
          <span className='font-tamil' lang='ta'>
            {f.helpTa}
          </span>
        </>
      )}
    </>
  ) : undefined;
  const invalid = error ? true : undefined;
  const common = {
    id,
    'aria-invalid': invalid,
    'aria-describedby': error ? `${id}-error` : undefined,
  };

  if (f.type === 'checkbox') {
    return (
      <div className='space-y-1.5'>
        {f.help && (
          <p className='text-sm text-ink-2' id={`${id}-help`}>
            {help}
          </p>
        )}
        <label htmlFor={id} className='flex items-start gap-2 text-sm'>
          <Checkbox
            {...common}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className='mt-0.5'
          />
          <span>
            {label}
            {f.required && (
              <span className='ml-1 text-bad' aria-hidden>
                *
              </span>
            )}
          </span>
        </label>
        {error && (
          <p id={`${id}-error`} role='alert' className='text-xs text-bad'>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <Field id={id} label={label} help={help} error={error} required={f.required}>
      {f.type === 'appliances' ? (
        <ApplianceRows
          id={id}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          max={f.max}
        />
      ) : f.name === 'preferredZoneCode' && f.options ? (
        <ZoneSelect
          name={id}
          value={str(value)}
          onChange={onChange}
          options={f.options}
          zones={config?.zones ?? null}
          showRent={type === 'VENDOR'}
          isFood={isFood}
          invalid={invalid}
        />
      ) : f.type === 'radio' && f.options ? (
        <div className='space-y-1.5' role='radiogroup'>
          {f.options.map((o) => (
            <label
              key={o.value}
              htmlFor={`${id}-${o.value}`}
              className='flex items-center gap-2 text-sm'
            >
              <input
                id={`${id}-${o.value}`}
                type='radio'
                name={id}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                className='accent-accent'
              />
              <BilingualLabel en={o.label} ta={o.labelTa} />
            </label>
          ))}
        </div>
      ) : f.type === 'select' && f.options ? (
        <Select {...common} value={str(value)} onChange={(e) => onChange(e.target.value)}>
          <option value=''>Choose…</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.labelTa ? ` / ${o.labelTa}` : ''}
            </option>
          ))}
        </Select>
      ) : f.type === 'textarea' ? (
        <Textarea {...common} value={str(value)} onChange={(e) => onChange(e.target.value)} />
      ) : f.type === 'number' ? (
        <Input
          {...common}
          type='number'
          inputMode='numeric'
          min={f.min}
          max={f.max}
          value={str(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          {...common}
          type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
          inputMode={f.type === 'tel' ? 'tel' : undefined}
          autoComplete={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : undefined}
          value={str(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

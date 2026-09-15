import {
  declarationsFor,
  FORM_DEFINITIONS,
  type FormField,
  type PublicConfig,
  type RateScope,
  type RequesterSession,
  type StallRequestType,
  SubmitRequestInput,
  zoneOptions,
} from '@msr/stalls';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, fieldErrorsFrom } from '../api-client';
import { getPublicConfig, submitRequest } from '../api';
import { type ApplianceRow, ApplianceRows } from '../components/ApplianceRows';
import { BilingualLabel } from '../components/BilingualLabel';
import { DeclarationText } from '../components/DeclarationText';
import { ZoneSelect } from '../components/ZoneSelect';
import { useLoad } from '../hooks';
import { useRequester } from '../requester';
import {
  Card,
  Checkbox,
  ChoicePlate,
  FieldError,
  FieldStack,
  FormField as Labelled,
  Icon,
  Input,
  Loading,
  Radio,
  Select,
  Textarea,
} from '../ui';
import { SLUG_TYPE } from './FormPicker';

type Values = Record<string, string | boolean | ApplianceRow[]>;

const ASHRAM_TYPES = new Set<StallRequestType>(['ASHRAM', 'ASHRAM_FOOD']);
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
  declarationIds: string[],
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
    // The exact versions this page drew. The API checks them against what is
    // live and refuses the submission if the wording moved while the form was
    // open — see `DeclarationsChangedError`.
    declarationIds,
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
  const { requester, status } = useRequester();
  const type = slug ? SLUG_TYPE[slug] : undefined;
  if (!type) return <Navigate to='/stalls/apply' replace />;
  // ⚠️ The API refuses an unauthenticated submission regardless — this only
  // saves a vendor filling in two pages of form before being told. Wait for the
  // session to land first, or a signed-in reader is bounced on every refresh.
  if (status === 'loading') return <Loading />;
  if (!requester) return <Navigate to='/stalls/apply' replace />;
  return <Form type={type} requester={requester} />;
}

function Form({ type, requester }: { type: StallRequestType; requester: RequesterSession }) {
  const def = FORM_DEFINITIONS[type];
  const navigate = useNavigate();
  // ⚠️ Quoted at THIS form's scope. A local welfare requester asking after A3
  // gets a figure; a vendor asking after the same bay is told it is closed to
  // trade. One bay, two answers — which is why the rent cannot be a property of
  // the zone and the form has to say who is asking.
  const scope: RateScope = type === 'LOCAL_WELFARE' ? 'LOCAL_WELFARE' : 'VENDOR';
  const config = useLoad(() => getPublicConfig(scope), [scope]);

  // ⚠️ `declarationsFor`, the same function the API validates the submission
  // with. A page that picked its own variant would be a second opinion about
  // which wording this form asks — and the one that matters legally is the
  // server's, so a disagreement would show up as a refused submission nobody
  // could explain.
  const shown = declarationsFor(config.data?.declarations ?? [], type);
  const customFields = useMemo(
    () => (config.data?.customFields ?? []).filter((f) => f.formType === type),
    [config.data, type],
  );

  // Prefilled from the account, and every one of them still editable: a
  // department files for several contact people under one login, so these are
  // facts about THIS request. Since the gate landed they select nothing — the
  // session decides which account the request belongs to.
  //
  // `email` is blank when the account was registered on a mobile: the column
  // holds a placeholder that is not an address, and the session route already
  // reports it as empty rather than handing it back to be cleared by hand.
  const [values, setValues] = useState<Values>({
    appliances: [],
    requesterName: requester.displayName,
    requestedBy: requester.displayName,
    email: requester.email,
    contactNumber: requester.phone,
    requesterContact: requester.phone,
  });
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
      shown.map((d) => d.id),
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
    <form onSubmit={onSubmit} noValidate>
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '-.5px',
            lineHeight: 1.15,
          }}
        >
          {def.title}
        </div>
        {config.data && (
          <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 5 }}>
            {config.data.edition.name}
            {/* The refundable advance used to be quoted here as one figure for
                the whole venue. It is area-wise now — "it might be 3000, and
                for the free area it might be only 2000" — so it belongs beside
                the bay it applies to, in the location list below, and stating
                a single number here would be stating the wrong one. */}
          </div>
        )}
      </div>

      {/* The terms, on the primary tint rather than a warning one. This is the
          thing a reader agrees to, not a thing that has gone wrong. */}
      <div
        style={{
          padding: '13px 15px',
          borderRadius: 'var(--r3)',
          background: 'var(--pri-t)',
          border: '1px solid var(--pri-t2)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ flex: 'none', color: 'var(--pri)', marginTop: 1 }}>
            <Icon name='info' size={16} />
          </span>
          <div style={{ minWidth: 0, fontSize: 12.5, lineHeight: 1.65 }}>
            {/* 🔴 The edition's own declarations, not the constant in
                `forms.ts`. Falls back to that constant when an edition has
                none — a form with no disclaimer at all is worse than one
                showing last year's, and an edition seeded before this feature
                existed has nothing in the table. */}
            {shown.length > 0 ? (
              shown.map((d, i) => (
                <div key={d.id} style={{ marginTop: i === 0 ? 0 : 10 }}>
                  <DeclarationText body={d.body} />
                  {d.bodyTa && (
                    <div className='msrs-tamil' lang='ta' style={{ marginTop: 7 }}>
                      <DeclarationText body={d.bodyTa} />
                    </div>
                  )}
                </div>
              ))
            ) : (
              <>
                <p style={{ margin: 0 }}>{def.disclaimer}</p>
                {def.disclaimerTa && (
                  <p className='msrs-tamil' lang='ta' style={{ margin: '7px 0 0' }}>
                    {def.disclaimerTa}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {topError && (
        <div
          role='alert'
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '11px 14px',
            borderRadius: 'var(--r2)',
            background: 'var(--des-t)',
            color: 'var(--des-fg)',
            border: '1px solid var(--des-b)',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          <Icon name='alert-triangle' size={16} />
          {topError}
        </div>
      )}

      <Card pad={0}>
        <div style={{ padding: 18 }}>
          <FieldStack>
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
          </FieldStack>
        </div>

        {/* ⚠️ The submit sits INSIDE the card, on its own rail, rather than
            floating on the page below it. On a phone the form is one long
            column and the button is the end of it; a detached control after a
            card edge reads as belonging to the next thing, not this one. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '14px 18px',
            borderTop: '1px solid var(--line)',
            background: 'var(--rail)',
            borderRadius: '0 0 var(--r4) var(--r4)',
          }}
        >
          <button
            type='submit'
            disabled={submitting || values.agreed !== true}
            className={submitting || values.agreed !== true ? undefined : 'msrs-lift'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              padding: '11px 20px',
              borderRadius: 'var(--r2)',
              border: '1px solid transparent',
              background: 'var(--pri)',
              color: 'var(--pfg)',
              boxShadow: 'var(--sh-pri)',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: submitting || values.agreed !== true ? 'not-allowed' : 'pointer',
              opacity: submitting || values.agreed !== true ? 0.5 : 1,
            }}
          >
            {submitting ? 'Submitting…' : 'Submit request'}
            {!submitting && <Icon name='chevron-right' size={15} />}
          </button>
        </div>
      </Card>
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
          <span className='msrs-tamil' lang='ta'>
            {f.helpTa}
          </span>
        </>
      )}
    </>
  ) : undefined;
  const invalid = error ? true : undefined;
  const common = {
    id,
    invalid,
    'aria-invalid': invalid,
    'aria-describedby': error ? `${id}-error` : f.help ? `${id}-help` : undefined,
  };

  if (f.type === 'checkbox') {
    // ⚠️ The consent question is a PLATE, not a bare tick and a line of text.
    // It is the control that gates submission, and on a phone a 16px box beside
    // a two-line paragraph is the smallest target on the longest screen.
    const on = value === true;
    return (
      <div>
        {f.help && (
          <div
            id={`${id}-help`}
            style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 8, lineHeight: 1.6 }}
          >
            {help}
          </div>
        )}
        <ChoicePlate htmlFor={id} selected={on}>
          <Checkbox
            {...common}
            checked={on}
            onChange={(e) => onChange(e.target.checked)}
            style={{ marginTop: 1 }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            {label}
            {f.required && (
              <span aria-hidden style={{ marginLeft: 3, color: 'var(--des-fg)' }}>
                *
              </span>
            )}
          </span>
        </ChoicePlate>
        <FieldError of={error} id={`${id}-error`} />
      </div>
    );
  }

  return (
    <Labelled id={id} label={label} help={help} error={error} required={f.required}>
      {f.type === 'appliances' ? (
        <ApplianceRows
          id={id}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          max={f.max}
        />
      ) : f.type === 'zone' ? (
        // ⚠️ The choices are the edition's own bays, resolved here rather than
        // baked into the field, so a bay added for a redrawn layout appears on
        // the form without a code change. The vendor form drops the bays closed
        // to trade; the local welfare form keeps them, because those are the
        // ones a village trader is most likely to want.
        //
        // Local welfare is quoted a rent too — a lower one for the same ground,
        // not no rent at all. Only the ashram forms, which are billed
        // internally and never quoted, hide the figures.
        <ZoneSelect
          name={id}
          value={str(value)}
          onChange={onChange}
          options={zoneOptions(config?.zones ?? [], type === 'VENDOR')}
          zones={config?.zones ?? null}
          showRent={type === 'VENDOR' || type === 'LOCAL_WELFARE'}
          isFood={isFood}
          invalid={invalid}
        />
      ) : f.type === 'radio' && f.options ? (
        <div style={{ display: 'grid', gap: 8 }} role='radiogroup'>
          {f.options.map((o) => (
            <ChoicePlate key={o.value} htmlFor={`${id}-${o.value}`} selected={value === o.value}>
              <Radio
                id={`${id}-${o.value}`}
                name={id}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                style={{ marginTop: 2 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <BilingualLabel en={o.label} ta={o.labelTa} />
              </span>
            </ChoicePlate>
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
    </Labelled>
  );
}

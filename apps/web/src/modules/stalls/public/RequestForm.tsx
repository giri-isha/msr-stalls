import {
  type BuiltFormField,
  declarationsFor,
  FORM_DEFINITIONS,
  type FormField,
  renderForm,
  type RenderedGroup,
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
import { DeclarationConsent, allTicked } from '../components/DeclarationConsent';
import { type FieldValue, FieldControl } from '../components/FormFields';
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

/** ⚠️ Includes `string[]`, for a `file`/`files` answer — a list of media-store
 *  keys. A request form has no built-in file question, but an admin can append
 *  one, and the value type has to admit what the control produces. */
type Values = Record<string, string | boolean | ApplianceRow[] | string[]>;

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
  consented: boolean,
): Record<string, unknown> {
  const ashram = ASHRAM_TYPES.has(type);
  // ⚠️ `isApplianceRows`, not `Array.isArray`. A `files` answer is also an
  // array — of upload keys — and treating one as an appliance list would read
  // `.name` off a string.
  const rows = values.appliances;
  const appliances = (
    Array.isArray(rows) && rows.every((r) => typeof r === 'object' && r !== null)
      ? (rows as ApplianceRow[])
      : []
  )
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
    // 🔴 Derived from the ticks, not from a field. `agreed` is no longer a
    // question on the form — its wording is a declaration row and its tick is
    // drawn beside that wording above Submit. The column still records THAT
    // somebody agreed; `declarationIds` below is what records to what.
    agreed: consented,
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

/**
 * The key a field's answer travels under in the form's own state.
 *
 * ⚠️ TWO key spaces, and they are not interchangeable. A built-in answers by
 * `name`, because that is the contract key its value is posted under and the
 * column it lands in; an appended field answers by id under a `cf:` prefix,
 * because it has no column and its id is all it has. Reading one with the
 * other's key finds nothing, which looks exactly like an unanswered question.
 */
function fieldKey(f: BuiltFormField): string {
  return f.isBuiltIn && f.name !== null ? f.name : `cf:${f.id}`;
}

/** A built field in the shape `FieldControl` draws. That component predates the
 *  builder and still speaks `FormField`; the adapter is here rather than
 *  rewriting it, because what it knows about `zone` and `appliances` is real
 *  and would have to be rebuilt to no purpose. */
function asFormField(f: BuiltFormField): FormField {
  return {
    name: fieldKey(f),
    label: f.label,
    labelTa: f.labelTa,
    help: f.help ?? undefined,
    helpTa: f.helpTa,
    type: f.type,
    required: f.required,
    options: f.options ?? undefined,
    min: f.min ?? undefined,
    max: f.max ?? undefined,
  };
}

/** The constant's fields, as built ones — the fallback path only. */
function fromConstant(f: FormField, i: number): BuiltFormField {
  return {
    id: f.name,
    name: f.name,
    label: f.label,
    labelTa: f.labelTa,
    help: f.help ?? null,
    helpTa: f.helpTa ?? null,
    type: f.type,
    required: f.required,
    isBuiltIn: true,
    isActive: true,
    sectionId: null,
    sortOrder: i,
    options: f.options ?? null,
    min: f.min ?? null,
    max: f.max ?? null,
  };
}

function appended(
  id: string,
  label: string,
  labelTa: string | null,
  fieldType: string,
  required: boolean,
): BuiltFormField {
  return {
    id,
    name: null,
    label,
    labelTa,
    help: null,
    helpTa: null,
    type: fieldType as FormField['type'],
    required,
    isBuiltIn: false,
    isActive: true,
    sectionId: null,
    sortOrder: 0,
    options: null,
    min: null,
    max: null,
  };
}

/** A heading the edition put on the form. The 2025 forms have none — they are
 *  one run of questions — so this draws nothing until somebody adds one. */
function SectionHeading({
  section,
}: {
  section: { heading: string; headingTa: string | null; help: string | null };
}) {
  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{section.heading}</div>
      {section.headingTa && (
        <div className='msrs-tamil' lang='ta' style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
          {section.headingTa}
        </div>
      )}
      {section.help && (
        <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3 }}>{section.help}</div>
      )}
    </div>
  );
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
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggleDeclaration = (id: string, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  // 🔴 `config.data` must have ARRIVED, not merely "shown is empty". Until the
  // config loads, `shown` is [] and `allTicked` is vacuously true — which would
  // enable Submit on a form that does not yet know what it has to ask consent
  // for, and post it with an empty `declarationIds` the API reads as the claim
  // "I displayed none". A slow connection would silently skip the consent.
  const consented = config.data !== null && allTicked(shown, ticked);
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

  /**
   * The form, as the EDITION defines it — headings, order, wording and all.
   *
   * 🔴 `def.fields` was the constant in `forms.ts`, and a custom field could
   * only be appended after it. The rows say what the form is now, so a
   * coordinator reordering a question or fixing a label does it on a screen
   * rather than in a pull request.
   *
   * ⚠️ The constant is still the fallback, for an edition seeded before forms
   * became data. `seedFormDefinitions` fills those rows in on the next boot, so
   * this is a window rather than a mode — but a request form that renders
   * nothing is worse than one rendering last year's wording, and the window is
   * exactly as long as one deploy.
   */
  const built = (config.data?.forms ?? []).find((f) => f.formType === type) ?? null;

  const groups: RenderedGroup[] = built
    ? renderForm(built)
    : [
        {
          section: null,
          fields: [
            ...def.fields.map(fromConstant),
            ...customFields.map((f) =>
              appended(f.id, f.label, f.labelTa, f.fieldType, f.isRequired),
            ),
          ],
        },
      ];
  const allFields = groups.flatMap((g) => g.fields);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopError(null);
    // Required-ness comes from the form definition; shape from the contract.
    const missing: Record<string, string> = {};
    for (const f of allFields) {
      const key = fieldKey(f);
      if (f.required && isEmpty(values[key])) {
        missing[key] = f.type === 'checkbox' ? 'Please tick to continue' : 'Required';
      }
    }
    const built = buildInput(
      type,
      values,
      // ⚠️ The APPENDED fields of the form as drawn, not `config.customFields`.
      // The two agree today; they would stop agreeing the moment a field is
      // switched off, and the one the reader actually filled in is this one.
      allFields.filter((f) => !f.isBuiltIn).map((f) => f.id),
      shown.map((d) => d.id),
      consented,
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
            {groups.map((g, gi) => (
              <div key={g.section?.id ?? `loose-${gi}`} style={{ display: 'contents' }}>
                {g.section && <SectionHeading section={g.section} />}
                {g.fields.map((f) => {
                  const key = fieldKey(f);
                  return (
                    <FieldControl
                      key={f.id}
                      field={asFormField(f)}
                      value={values[key]}
                      error={errors[key]}
                      onChange={(v) => set(key, v ?? '')}
                      config={config.data}
                      type={type}
                      isFood={isFood}
                    />
                  );
                })}
              </div>
            ))}
          </FieldStack>
        </div>

        {/* 🔴 The consents, immediately above Submit and labelled by their own
            wording. They used to be an information plate at the TOP of this
            form with a bare "I Agree" tick thirty questions below it — by the
            time the tick was in reach the words had been off screen for
            minutes. */}
        <div style={{ padding: '0 18px' }}>
          <DeclarationConsent
            declarations={shown}
            ticked={ticked}
            onToggle={toggleDeclaration}
            error={errors.declarationIds}
          />
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
            disabled={submitting || !consented}
            className={submitting || !consented ? undefined : 'msrs-lift'}
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
              cursor: submitting || !consented ? 'not-allowed' : 'pointer',
              opacity: submitting || !consented ? 0.5 : 1,
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

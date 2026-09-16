import {
  asFormField,
  type BuiltFormField,
  declarationsFor,
  type FieldRuleValues,
  fieldIsAsked,
  FORM_DEFINITIONS,
  type FormField,
  NO_RULES,
  renderForm,
  type RenderedGroup,
  type RateScope,
  type RequesterSession,
  type StallRequestType,
  SubmitRequestInput,
  validateAgainstForm,
} from '@stalls/core';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError, fieldErrorsFrom } from '../api-client';
import { getPublicConfig, submitRequest } from '../api';
import type { ApplianceRow } from '../components/ApplianceRows';
import { DeclarationConsent, allTicked } from '../components/DeclarationConsent';
import { FieldControl } from '../components/FormFields';
import { useLoad } from '../hooks';
import { useRequester } from '../requester';
import { Card, FieldStack, Icon, Loading } from '../ui';

/** ⚠️ Includes `string[]`, for a `file`/`files` answer — a list of media-store
 *  keys. A request form has no built-in file question, but an admin can append
 *  one, and the value type has to admit what the control produces. */
type Values = Record<string, string | boolean | ApplianceRow[] | string[]>;

/** ⚠️ ONE type now, where this was a set of two. The ashram forms merged, and
 *  what used to distinguish them — whether the stall sells food — is the
 *  `stallType` answer, exactly as it is on the other two forms. */
const isAshram = (type: StallRequestType) => type === 'ASHRAM';
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
  const ashram = isAshram(type);
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
    // 🔴 Asked on every form. It used to be INFERRED on the ashram ones — the
    // request type said which of the two forms had been opened — so a
    // department that opened the wrong one declared the wrong thing about its
    // stall without ever being asked.
    stallType: str(values.stallType),
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
      // ⚠️ Undefined for a non-food stall, whatever is sitting in `values`. The
      // question is hidden once the answer above changes to Non Food, and
      // posting the stale reply would record an answer to a question that is
      // not on screen. The API applies the same rule — see `submit.ts`.
      fssaiExpected:
        values.stallType !== 'FOOD' || values.fssaiExpected === undefined
          ? undefined
          : yes(values.fssaiExpected),
    };
  }
  return base;
}

/**
 * The page's own state, as `validateAgainstForm` addresses the BUILT-IN half.
 *
 * ⚠️ It is the same object. The validator reads a built-in by the form field's
 * `name`, and that is precisely the key this page stores the answer under —
 * `fieldKey` returns it — so there is nothing to translate. The function exists
 * to say so, because `buildInput` right above it does translate, and the two
 * key spaces being different there and identical here is the sort of thing that
 * gets "fixed" into a bug.
 *
 * 🔴 `values` holds what the CONTROLS produced: `'5'` for a number, `'YES'` for
 * a yes/no picker, `true` for a tick. The checker reads a number out of a
 * string on purpose, for exactly this reason — the alternative is checking the
 * wire shape, which is built after validation and drops anything blank.
 */
function builtInAnswers(_type: StallRequestType, values: Values): Record<string, unknown> {
  return values;
}

/** The appended half, keyed by field id — the space `customFields.<id>` names.
 *
 *  ⚠️ A list answer is passed as a LIST. A `files` question's limit is how many
 *  were uploaded, and joining the keys into one string would make that a rule
 *  about commas. */
function customAnswers(fields: BuiltFormField[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.isBuiltIn) continue;
    // ⚠️ A tick answers `true`, and the wire carries the word. An unticked box
    // stays blank, which is what makes a required one report as missing rather
    // than as the word "false".
    const v = values[`cf:${f.id}`];
    out[f.id] = typeof v === 'boolean' ? (v ? 'yes' : '') : v;
  }
  return out;
}

/** The inverse of the renames above, for putting a server or Zod error back on
 *  the input that caused it. */
function fieldNameFor(path: string, type: StallRequestType): string {
  const ashram = isAshram(type);
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
    ...ruleValuesFrom(f),
    mediaKey: f.mediaKey ?? null,
  };
}

/** The limits off a constant's field. `undefined` there, `null` on a row. */
function ruleValuesFrom(f: FormField): FieldRuleValues {
  return {
    min: f.min ?? null,
    max: f.max ?? null,
    minLen: f.minLen ?? null,
    maxLen: f.maxLen ?? null,
    decimals: f.decimals ?? null,
    pattern: f.pattern ?? null,
    patternHint: f.patternHint ?? null,
    window: f.window ?? null,
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
    ...NO_RULES,
    mediaKey: null,
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
        <div className='stalls-tamil' lang='ta' style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
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

/**
 * One application form, for the type its ROUTE names.
 *
 * ⚠️ `type` is a prop, not a URL segment. It used to read `:type` out of
 * `useParams` and look the slug up, which meant the component could only ever
 * be mounted at one path and a bad slug rendered a page that then redirected.
 * Each form has its own route now — see `request-forms.tsx` — so an unknown
 * slug never reaches here at all.
 */
export function RequestForm({ type }: { type: StallRequestType }) {
  const { requester, status } = useRequester();
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

  const defined: RenderedGroup[] = built
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

  /**
   * Whether this stall sells food — the answer the ashram form used to make by
   * being two forms.
   *
   * ⚠️ `undefined` until it is picked, and that is not the same as false. The
   * food-only questions are DRAWN on a form nobody has answered yet: one that
   * appears when you tick a box above it reads as a form that grew, while one
   * that was always there and is now required reads as a form you have not
   * finished.
   */
  const stallType = str(values.stallType);
  const answers = { isFood: stallType === '' ? undefined : stallType === 'FOOD' };

  // A question the reader's own answers have taken off the form — see
  // `fieldIsAsked`, which the API's validator reads too, so the page and the
  // refusal cannot disagree about what was asked.
  const groups: RenderedGroup[] = defined
    .map((g) => ({ ...g, fields: g.fields.filter((f) => fieldIsAsked(f, answers)) }))
    // A heading whose every question is hidden is a heading for nothing.
    .filter((g) => g.fields.length > 0);
  const allFields = groups.flatMap((g) => g.fields);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopError(null);
    /**
     * What the EDITION'S OWN FORM insists on — required-ness and every limit —
     * checked before the round-trip.
     *
     * 🔴 `validateAgainstForm` is the function `submit.ts` refuses with, not a
     * second opinion written for the browser. This page used to run its own
     * loop over `f.required`, which was fine while required-ness was the only
     * rule a row carried; now that a row also says how long an answer may be,
     * how many digits a number has and which days a date question admits, two
     * implementations would be two answers — and the one a vendor meets first
     * would be the one that let the form through.
     *
     * ⚠️ Keyed the way the FORM is keyed, not the way the wire is: the
     * validator reports `customFields.<id>` and the state calls it `cf:<id>`,
     * which is exactly what `fieldNameFor` already translates for server
     * errors.
     */
    const missing: Record<string, string> = {};
    if (built) {
      for (const v of validateAgainstForm(
        built,
        { builtIn: builtInAnswers(type, values), custom: customAnswers(allFields, values) },
        answers,
      )) {
        missing[fieldNameFor(v.fieldKey, type)] = v.message;
      }
    } else {
      // The fallback path: an edition seeded before forms became data has no
      // rows to validate against, so required-ness is all there is to check —
      // which is exactly what this page did before any of it.
      for (const f of allFields) {
        const key = fieldKey(f);
        if (f.required && isEmpty(values[key])) {
          missing[key] = f.type === 'checkbox' ? 'Please tick to continue' : 'Required';
        }
      }
    }
    const input = buildInput(
      type,
      values,
      // ⚠️ The APPENDED fields of the form as drawn, not `config.customFields`.
      // The two agree today; they would stop agreeing the moment a field is
      // switched off, and the one the reader actually filled in is this one.
      allFields.filter((f) => !f.isBuiltIn).map((f) => f.id),
      shown.map((d) => d.id),
      consented,
    );
    const parsed = SubmitRequestInput.safeParse(input);
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

  const isFood = answers.isFood === true;

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
                      field={asFormField(f, key)}
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
            className={submitting || !consented ? undefined : 'stalls-lift'}
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

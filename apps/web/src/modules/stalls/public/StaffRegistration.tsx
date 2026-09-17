import type { CouponView, RegisterStaffInput } from '@stalls/core';
import { asFormField, formFields } from '@stalls/core';
import { type ReactNode, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { fieldErrorsFrom } from '../api-client';
import { DeclarationConsent, allTicked } from '../components/DeclarationConsent';
import { FieldControl } from '../components/FormFields';
import { getCoupon, registerStaff } from '../api';
import { formatDate } from '../hooks';
import {
  Btn,
  Card,
  Empty,
  ErrorBox,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  Select,
  Tag,
  useToast,
} from '../ui';

/**
 * Vendor staff registration, on a coupon.
 *
 * From the requirement: "The staff registration has to be made by secure coupon
 * basis so that registration is done by only the vendor using a key." So the
 * coupon is the whole credential — it names the stall, and there is no other
 * way in. The vendor forwards the link to their own team and each person
 * registers themselves.
 *
 * ⚠️ The roster shown back is **masked**. Anyone holding the coupon can see it,
 * which is the vendor's whole team, and a full list of mobile numbers is not
 * theirs to collect. The stalls team sees the unmasked list on Onboarding.
 *
 * ⚠️ For an Aadhaar the server keeps only the last four digits. The gate
 * volunteer compares four digits against the card in a person's hand; nothing
 * here needs the other eight, and holding them would make this table worth
 * stealing.
 */

const ID_TYPES: Array<[RegisterStaffInput['idType'], string]> = [
  ['AADHAAR', 'Aadhaar'],
  ['VOTER_ID', 'Voter ID'],
  ['DRIVING_LICENCE', 'Driving Licence'],
  ['PASSPORT', 'Passport'],
  ['OTHER', 'Other'],
];

export function StaffRegistration() {
  const { code: codeParam } = useParams();

  const [code, setCode] = useState(codeParam ?? '');
  const [coupon, setCoupon] = useState<CouponView | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const lookup = async (value: string) => {
    if (!value.trim()) return;
    setLooking(true);
    setLookupError(null);
    try {
      setCoupon(await getCoupon(value.trim()));
    } catch {
      // One message for every failure — wrong code, expired, cancelled stall.
      // Telling them apart would make this page a way to discover live coupons.
      setLookupError('That coupon is not valid. Please check it with the stall owner.');
      setCoupon(null);
    } finally {
      setLooking(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: look up the coupon in the link once
  useEffect(() => {
    if (codeParam) void lookup(codeParam);
  }, [codeParam]);

  const full = coupon !== null && coupon.maxStaff > 0 && coupon.registered >= coupon.maxStaff;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 620 }}>
      <H1
        icon={<Icon name='user-plus' size={18} />}
        sub='Everyone working on the stall must be registered before they can be given a pass.'
      >
        Stall Staff Registration
      </H1>

      {!coupon && (
        <Card pad={18} style={{ display: 'grid', gap: 12 }}>
          <FormField
            id='coupon'
            label='Stall Coupon'
            help='The stall owner has this. Three letters of the stall name, the edition year, then eight characters.'
            error={lookupError ?? undefined}
          >
            <Input
              id='coupon'
              value={code}
              autoCapitalize='characters'
              invalid={!!lookupError}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookup(code);
              }}
            />
          </FormField>
          <div>
            <Btn kind='primary' onClick={() => lookup(code)} disabled={looking || !code.trim()}>
              <Icon name='chevron-right' size={14} />
              {looking ? 'Checking…' : 'Continue'}
            </Btn>
          </div>
        </Card>
      )}

      {looking && !coupon && <Loading />}

      {coupon && (
        <>
          <Card pad={18} style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{coupon.stallName}</div>
            <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
              {coupon.reference}
              {coupon.stallNumbers.length > 0 && ` · stall ${coupon.stallNumbers.join(', ')}`}
            </div>
            <div style={{ marginTop: 4 }}>
              <Tag tone={full ? 'des' : 'ok'} size='sm'>
                {coupon.registered}
                {coupon.maxStaff > 0 ? ` of ${coupon.maxStaff}` : ''} registered
              </Tag>
            </div>
          </Card>

          {full ? (
            <ErrorBox>
              All {coupon.maxStaff} staff registrations for this stall have been used. Please ask
              the stalls team if you need another pass.
            </ErrorBox>
          ) : (
            <StaffFormBody
              coupon={coupon}
              submit={(body) => registerStaff({ ...body, couponCode: code.trim() })}
              onRegistered={setCoupon}
            />
          )}

          <Card pad={18} style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Registered so far</div>
            {coupon.staff.length === 0 ? (
              <Empty>Nobody yet.</Empty>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {coupon.staff.map((s) => (
                  <div
                    key={`${s.name}-${s.registeredAt}`}
                    style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline' }}
                  >
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    <span
                      style={{
                        color: 'var(--mfg)',
                        fontFamily: 'ui-monospace,Menlo,monospace',
                        fontSize: 12,
                      }}
                    >
                      {s.mobile}
                    </span>
                    <span style={{ color: 'var(--mfg)', fontSize: 11.5, marginLeft: 'auto' }}>
                      {formatDate(s.registeredAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * One person's registration, on a coupon somebody else resolved.
 *
 * 🔴 Split out so the BACKOFFICE can register a stall's team for it — the same
 * questions, the same consents, and the same clearing between people, because
 * this form is used by a QUEUE: leaving one person's tick set would register
 * the next against a consent they never gave.
 */
export function StaffFormBody({
  coupon,
  submit,
  submitLabel = 'Register',
  beforeSubmit,
  ready: readyProp = true,
  onRegistered,
}: {
  coupon: CouponView;
  submit: (body: Omit<RegisterStaffInput, 'couponCode'>) => Promise<CouponView>;
  submitLabel?: string;
  beforeSubmit?: ReactNode;
  ready?: boolean;
  onRegistered?: (next: CouponView) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [idType, setIdType] = useState<RegisterStaffInput['idType']>('AADHAAR');
  const [idNumber, setIdNumber] = useState('');
  const [role, setRole] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Questions this edition appended to the staff form. Answers are filed
  // against the person, not the stall — see `replaceCustomValues`.
  const appendedFields = (coupon.form ? formFields(coupon.form) : []).filter((f) => !f.isBuiltIn);

  const send = async () => {
    setErrors({});
    setBusy(true);
    try {
      const next = await submit({
        name: name.trim(),
        mobile: mobile.trim(),
        idType,
        idNumber: idNumber.trim(),
        role: role.trim() || undefined,
        declarationIds: coupon.declarations.map((d) => d.id),
        // 🔴 Filed against THIS PERSON, not the stall. Eight people register
        // against one coupon and share a request.
        customFields: Object.fromEntries(Object.entries(extra).filter(([, v]) => v.trim() !== '')),
      });
      setName('');
      setMobile('');
      setIdNumber('');
      setRole('');
      // ⚠️ Cleared for the NEXT person. The page is used by a queue in turn, and
      // leaving one person's consent ticked would register the next one against
      // a tick they never made.
      setExtra({});
      setTicked(new Set());
      onRegistered?.(next);
      toast.ok('Registered. The next person can use the same link.');
    } catch (e) {
      setErrors(fieldErrorsFrom(e));
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const ready =
    readyProp &&
    !!name.trim() &&
    !!mobile.trim() &&
    !!idNumber.trim() &&
    allTicked(coupon.declarations, ticked);

  return (
    <Card pad={18} style={{ display: 'grid', gap: 14 }}>
      <FormField id='staff-name' label='Full Name' required error={errors.name}>
        <Input
          id='staff-name'
          value={name}
          invalid={!!errors.name}
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <FormField id='staff-mobile' label='Mobile Number' required error={errors.mobile}>
        <Input
          id='staff-mobile'
          type='tel'
          inputMode='tel'
          value={mobile}
          invalid={!!errors.mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
      </FormField>
      <FormField id='staff-idtype' label='ID Proof' required>
        {/* ⚠️ `?? ''` for the TYPE, not for the screen: the contract
                  made this optional once a form was allowed to stop asking
                  for it, and the state here still starts on a real choice. */}
        <Select
          id='staff-idtype'
          value={idType ?? ''}
          onChange={(v) => setIdType(v as RegisterStaffInput['idType'])}
        >
          {ID_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id='staff-idnumber'
        label='ID Number'
        required
        help={idType === 'AADHAAR' ? 'Only the last four digits are stored.' : undefined}
        error={errors.idNumber}
      >
        <Input
          id='staff-idnumber'
          value={idNumber}
          invalid={!!errors.idNumber}
          onChange={(e) => setIdNumber(e.target.value)}
        />
      </FormField>
      <FormField id='staff-role' label='Role on the Stall'>
        <Input
          id='staff-role'
          value={role}
          placeholder='e.g. Cook, cashier'
          onChange={(e) => setRole(e.target.value)}
        />
      </FormField>
      {appendedFields.length > 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {appendedFields.map((f) => (
            <FieldControl
              key={f.id}
              field={asFormField(f)}
              value={extra[f.id] ?? ''}
              onChange={(v) =>
                setExtra((was) => ({ ...was, [f.id]: typeof v === 'string' ? v : '' }))
              }
            />
          ))}
        </div>
      )}

      <DeclarationConsent declarations={coupon.declarations} ticked={ticked} onToggle={toggle} />

      {beforeSubmit}

      <div>
        <Btn kind='primary' onClick={send} disabled={busy || !ready}>
          <Icon name='user-plus' size={14} />
          {busy ? 'Registering…' : submitLabel}
        </Btn>
      </div>
    </Card>
  );
}

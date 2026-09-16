import type { BuiltFormField, PresignUploadInput, SubmitBankDetailsInput } from '@msr/stalls';
import { asFormField, formFields, uploadPurposeFor } from '@msr/stalls';
import { useState } from 'react';
import { useParams } from 'react-router';
import { fieldErrorsFrom } from '../api-client';
import { getBankForm, presignPublicUpload, submitBankDetails, uploadFile } from '../api';
import { type ApplianceRow, ApplianceRows } from '../components/ApplianceRows';
import { BilingualLabel } from '../components/BilingualLabel';
import { DeclarationConsent, allTicked } from '../components/DeclarationConsent';
import { FieldControl } from '../components/FormFields';
import { useLoad } from '../hooks';
import { Btn, Card, ErrorBox, FormField, H1, Icon, Loading, Tag, Textarea, useToast } from '../ui';

/**
 * "MSR Stalls Bank Details and Requirements" — the vendor's own Phase 2 form.
 *
 * Reached only from the link in the selection email. The link is what says
 * which request this is; nothing the browser sends does. That is why there is
 * no request id anywhere in this file.
 *
 * The Tamil beside each label is copied from the 2025 form's own column
 * headings (`Vendor Stall Payment Details - 2025`), not translated. Where the
 * 2025 sheet had no Tamil for a field, there is none here.
 */

interface TextField {
  name: keyof SubmitBankDetailsInput;
  label: string;
  labelTa: string | null;
  required?: boolean;
  type?: string;
  help?: string;
}

const _FIELDS: TextField[] = [
  { name: 'email', label: 'Email', labelTa: null, required: true, type: 'email' },
  {
    name: 'invoiceName',
    label: 'Name as Required on Invoice',
    labelTa: 'விலைப்பட்டியலில் குறிப்பிடப்பட வேண்டிய பெயர்',
    required: true,
  },
  {
    name: 'accountHolder',
    label: 'Name of the Bank Account Holder',
    labelTa: 'வங்கி கணக்கு வைத்திருப்பவரின் பெயர்',
    required: true,
  },
  { name: 'mobile', label: 'Mobile Number', labelTa: 'கைபேசி எண்', required: true, type: 'tel' },
  { name: 'address', label: 'Address', labelTa: 'முகவரி', required: true },
  { name: 'pincode', label: 'Pincode', labelTa: 'பின்கோடு', required: true },
  { name: 'bankName', label: 'Bank Name', labelTa: 'வங்கி பெயர்', required: true },
  { name: 'branch', label: 'Bank Branch', labelTa: 'வங்கிக்கிளை', required: true },
  {
    name: 'accountNumber',
    label: 'Account Number',
    labelTa: 'வங்கி கணக்கு எண்',
    required: true,
  },
  { name: 'ifsc', label: 'IFSC Code', labelTa: null, required: true },
  { name: 'micr', label: 'MICR Code', labelTa: null },
  { name: 'panNumber', label: 'PAN Card Number', labelTa: 'பான் கார்டு எண்', required: true },
  {
    name: 'gstNumber',
    label: 'GST Number',
    labelTa: 'ஜிஎஸ்டி எண்',
    required: true,
    help: "Enter 'None' if not applicable.",
  },
];

const _COUNTS: Array<{
  name: keyof SubmitBankDetailsInput;
  label: string;
  labelTa: string | null;
}> = [
  { name: 'plugs5a', label: '5 Amp Plug Points Needed', labelTa: null },
  { name: 'plugs15a', label: '15 Amp Plug Points Needed', labelTa: null },
  { name: 'gasStoves', label: 'Number of Gas Stoves', labelTa: null },
  { name: 'tablesNeeded', label: 'Tables Needed', labelTa: null },
  { name: 'chairsNeeded', label: 'Chairs Needed', labelTa: null },
  { name: 'passes2w', label: '2-Wheeler Passes', labelTa: null },
  { name: 'passes4w', label: '4-Wheeler Passes', labelTa: null },
  { name: 'passesStaff', label: 'Staff Passes', labelTa: null },
];

type Values = Record<string, string>;

export function BankForm() {
  const { token = '' } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => getBankForm(token), [token]);

  const [values, setValues] = useState<Values>({});
  const [appliances, setAppliances] = useState<ApplianceRow[]>([{ name: '', watts: '' }]);
  const [files, setFiles] = useState<Record<string, { key: string; name: string }>>({});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const presign = presignPublicUpload(token);

  // 🔴 The edition's own definition, grouped the way this page lays it out.
  // `formFields` drops the questions an admin switched off and orders the rest,
  // once, so the three cards below and the validator agree about what is asked.
  const rows = data?.form ? formFields(data.form) : [];
  const builtIns = rows.filter((f) => f.isBuiltIn);
  const textFields = builtIns.filter((f) => ['text', 'email', 'tel', 'textarea'].includes(f.type));
  const fileFields = builtIns.filter((f) => f.type === 'file');
  const countFields = builtIns.filter((f) => f.type === 'number');
  // ⚠️ Questions an ADMIN appended. They have no column, so their answers are
  // filed by field id — which is why they are keyed by `f.id` below and the
  // built-ins by `f.name`.
  const appendedFields = rows.filter((f) => !f.isBuiltIn);

  /** Which upload folder a document belongs in. */
  const purposeOf = (f: { name: string | null; isBuiltIn: boolean }) =>
    uploadPurposeFor(f) as PresignUploadInput['purpose'];

  /** Where this page keeps the uploaded key. A built-in's purpose is unique to
   *  it; two appended file questions share `FORM_FIELD`, so they are separated
   *  by field id. */
  const slotOf = (f: BuiltFormField) => (f.isBuiltIn ? purposeOf(f) : `${purposeOf(f)}:${f.id}`);

  // Prefill the requirements block from what was asked for at request time. The
  // vendor is confirming or correcting November's answers, not retyping them.
  //
  // ⚠️ Done DURING render rather than in an effect. An effect would paint a
  // form full of zeros first and fill it a frame later, which on a slow phone
  // reads as "they lost what I told them" — and a vendor who starts typing into
  // that frame has their answer overwritten. `loadedFor` is the guard that makes
  // this a one-shot adjustment rather than a loop.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (data && data.reference !== loadedFor) {
    setLoadedFor(data.reference);
    setValues({
      email: data.email,
      plugs5a: String(data.current.plugs5a),
      plugs15a: String(data.current.plugs15a),
      gasStoves: String(data.current.gasStoves),
      tablesNeeded: String(data.current.tablesNeeded),
      chairsNeeded: String(data.current.chairsNeeded),
      passes2w: String(data.current.passes2w),
      passes4w: String(data.current.passes4w),
      passesStaff: String(data.current.passesStaff),
    });
    if (data.current.appliances.length > 0) {
      setAppliances(data.current.appliances.map((a) => ({ name: a.name, watts: String(a.watts) })));
    }
  }

  if (loading && !data) return <Loading />;
  if (error) {
    return (
      <ErrorBox>
        This link is not valid. It may have expired, or it may already have been used. Please ask
        the stalls team for a new one.
      </ErrorBox>
    );
  }
  if (!data) return null;

  if (done || data.submittedAt) {
    return (
      <Card pad={24} style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        <Tag tone='ok'>
          <Icon name='check' size={12} /> Received
        </Tag>
        <h2 style={{ margin: 0, fontSize: 20 }}>Thank you — we have your details</h2>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', maxWidth: 560 }}>
          We will email you the payment details and the Isha Foundation bank account to transfer to.
          If anything in your bank details needs to change, please call the stalls team rather than
          filling this form again.
        </p>
      </Card>
    );
  }

  const set = (name: string, v: string) => setValues((prev) => ({ ...prev, [name]: v }));
  const num = (name: string) => Number(values[name] ?? 0) || 0;

  /** ⚠️ Keyed by PURPOSE, which for a built-in document is its own folder and
   *  for an admin-added one is `FORM_FIELD` plus the field id. Two appended file
   *  questions would otherwise share a slot. */
  const pick = async (
    purpose: PresignUploadInput['purpose'],
    file: File,
    fieldId?: string,
    slot = fieldId ? `${purpose}:${fieldId}` : purpose,
  ) => {
    try {
      const up = await uploadFile(presign, file, purpose, fieldId);
      setFiles((prev) => ({ ...prev, [slot]: up }));
      toast.ok(`${file.name} uploaded.`);
    } catch (e) {
      toast.fail(e);
    }
  };

  const submit = async () => {
    setErrors({});
    setBusy(true);
    try {
      await submitBankDetails(token, {
        email: values.email ?? '',
        invoiceName: values.invoiceName ?? '',
        accountHolder: values.accountHolder ?? '',
        mobile: values.mobile ?? '',
        address: values.address ?? '',
        pincode: values.pincode ?? '',
        bankName: values.bankName ?? '',
        branch: values.branch ?? '',
        accountNumber: values.accountNumber ?? '',
        ifsc: values.ifsc ?? '',
        micr: values.micr ?? '',
        panNumber: values.panNumber ?? '',
        gstNumber: values.gstNumber ?? '',
        chequeKey: files.BANK_CHEQUE?.key ?? '',
        panKey: files.BANK_PAN?.key ?? '',
        gstKey: files.BANK_GST?.key ?? '',
        // The exact versions this page drew. The API checks them against what
        // is live and refuses the submission if the wording moved while the
        // form sat open — see `DeclarationsChangedError`.
        declarationIds: data.declarations.map((d) => d.id),
        // Answers to questions this edition appended, keyed by field id.
        customFields: Object.fromEntries(
          appendedFields
            .map((f) => [
              f.id,
              f.type === 'file' || f.type === 'files'
                ? (files[slotOf(f)]?.key ?? '')
                : (values[f.id] ?? ''),
            ])
            .filter(([, v]) => v !== ''),
        ),
        plugs5a: num('plugs5a'),
        plugs15a: num('plugs15a'),
        gasStoves: num('gasStoves'),
        appliances: appliances
          .filter((a) => a.name.trim() !== '')
          .map((a) => ({ name: a.name.trim(), watts: Number(a.watts) || 0 })),
        tablesNeeded: num('tablesNeeded'),
        chairsNeeded: num('chairsNeeded'),
        passes2w: num('passes2w'),
        passes4w: num('passes4w'),
        passesStaff: num('passesStaff'),
        remarks: values.remarks ?? '',
      } as SubmitBankDetailsInput);
      setDone(true);
    } catch (e) {
      const fields = fieldErrorsFrom(e);
      setErrors(fields);
      toast.fail(e);
      if (Object.keys(fields).length === 0) reload();
    } finally {
      setBusy(false);
    }
  };

  // ⚠️ Gated on the form having ARRIVED. Until it does there is nothing to tick
  // and no required document known, so every clause below is vacuously true —
  // which would let a slow connection submit a form it had not drawn.
  const requiredDocsIn = fileFields
    .filter((f) => f.required)
    .every((f) => files[slotOf(f)] !== undefined);
  const ready = data.form !== null && allTicked(data.declarations, ticked) && requiredDocsIn;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <H1
        icon={<Icon name='file-text' size={18} />}
        sub={`${data.stallName} · ${data.reference}${data.stallNumbers.length ? ` · stall ${data.stallNumbers.join(', ')}` : ''}`}
      >
        Bank Details &amp; Requirements
      </H1>

      <Card pad={18} style={{ display: 'grid', gap: 6 }}>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          For selected vendors only. Please give us the details below so your refund and invoice can
          be processed. <strong>No payment is collected on this form.</strong>
        </p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)' }}>
          Fields marked * are required.
        </p>
      </Card>

      <Card pad={18} style={{ display: 'grid', gap: 14 }}>
        {/* 🔴 From the edition's ROWS, not from a constant. The label, the
            Tamil beside it, the help text, whether it is required and whether
            it is asked at all are all the Form Builder's to change — which is
            the whole reason this form stopped being JSX. `FIELDS` remains only
            as the fallback for the window before an edition has rows. */}
        {textFields.map((f) => (
          <FieldControl
            key={f.id}
            field={asFormField(f)}
            value={values[f.name ?? f.id] ?? ''}
            error={errors[f.name ?? f.id]}
            onChange={(v) => set(f.name ?? f.id, typeof v === 'string' ? v : '')}
          />
        ))}
      </Card>

      <Card pad={18} style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Documents</div>
        {/* ⚠️ Each keeps its OWN upload purpose — `BANK_CHEQUE`, `BANK_PAN`,
            `BANK_GST`. Those folders already hold live data and the columns
            behind them are typed, so retyping them to `FORM_FIELD` would orphan
            every cheque already uploaded. */}
        {fileFields.map((f) => (
          <FileField
            key={f.id}
            label={`${f.label}${f.required ? ' *' : ''}`}
            labelTa={f.labelTa}
            chosen={files[slotOf(f)]?.name}
            onPick={(file) => pick(purposeOf(f), file, f.isBuiltIn ? undefined : f.id, slotOf(f))}
          />
        ))}
      </Card>

      <Card pad={18} style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Final stall requirements</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)' }}>
          These replace what you asked for when you applied, so please check them. The first 5 Amp
          plug point is free; anything beyond it is charged.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 12,
          }}
        >
          {countFields.map((f) => (
            <FieldControl
              key={f.id}
              field={asFormField(f)}
              value={values[f.name ?? f.id] ?? '0'}
              error={errors[f.name ?? f.id]}
              onChange={(v) => set(f.name ?? f.id, typeof v === 'string' ? v : '')}
            />
          ))}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Electrical appliances &amp; wattage
          </div>
          <ApplianceRows id='bank-appliances' value={appliances} onChange={setAppliances} />
        </div>
        <FormField id='bank-remarks' label='Additional Remarks' error={errors.remarks}>
          <Textarea
            id='bank-remarks'
            rows={3}
            value={values.remarks ?? ''}
            onChange={(e) => set('remarks', e.target.value)}
          />
        </FormField>
      </Card>

      {/* Questions this edition ADDED to the form. They have no column, so
          their answers are filed by field id — see `allowedCustomValues`. */}
      {appendedFields.length > 0 && (
        <Card pad={18} style={{ display: 'grid', gap: 14 }}>
          {appendedFields.map((f) =>
            f.type === 'file' || f.type === 'files' ? (
              <FileField
                key={f.id}
                label={`${f.label}${f.required ? ' *' : ''}`}
                labelTa={f.labelTa}
                chosen={files[slotOf(f)]?.name}
                onPick={(file) => pick(purposeOf(f), file, f.id, slotOf(f))}
              />
            ) : (
              <FieldControl
                key={f.id}
                field={asFormField(f)}
                value={values[f.id] ?? ''}
                error={errors[f.id]}
                onChange={(v) => set(f.id, typeof v === 'string' ? v : '')}
              />
            ),
          )}
        </Card>
      )}

      <Card pad={18} style={{ display: 'grid', gap: 12 }}>
        {/* 🔴 The consents are declaration ROWS now, versioned, with one tick
            each. They were two `z.literal(true)` flags with their wording in
            this file and their record two bare timestamps — which says THAT
            somebody agreed and never WHAT. */}
        <DeclarationConsent
          declarations={data.declarations}
          ticked={ticked}
          onToggle={toggle}
          error={errors.declarationIds}
        />
        <div>
          <Btn kind='primary' onClick={submit} disabled={!ready || busy}>
            <Icon name='send' size={14} />
            {busy ? 'Submitting…' : 'Submit'}
          </Btn>
          {!ready && (
            <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 8 }}>
              Upload the cancelled cheque and PAN card, and tick both agreements, to submit.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function FileField({
  label,
  labelTa,
  chosen,
  onPick,
}: {
  label: string;
  labelTa: string | null;
  chosen?: string;
  onPick: (file: File) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <BilingualLabel en={label} ta={labelTa} />
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          border: '1px dashed var(--bd)',
          borderRadius: 'var(--r2)',
          cursor: busy ? 'progress' : 'pointer',
          fontSize: 13,
          color: chosen ? 'var(--ok-fg)' : 'var(--mfg)',
        }}
      >
        <input
          type='file'
          accept='application/pdf,image/*'
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
              await onPick(file);
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
        <Icon name={chosen ? 'check' : 'plus'} size={14} />
        {chosen ?? 'Choose a file (PDF or photo, up to 20 MB)'}
      </label>
    </div>
  );
}

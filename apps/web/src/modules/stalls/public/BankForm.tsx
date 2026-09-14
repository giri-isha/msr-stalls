import type { SubmitBankDetailsInput } from '@msr/stalls';
import { useState } from 'react';
import { useParams } from 'react-router';
import { fieldErrorsFrom } from '../api-client';
import { getBankForm, presignPublicUpload, submitBankDetails, uploadFile } from '../api';
import { type ApplianceRow, ApplianceRows } from '../components/ApplianceRows';
import { BilingualLabel } from '../components/BilingualLabel';
import { useLoad } from '../hooks';
import {
  Btn,
  Card,
  Checkbox,
  ErrorBox,
  FieldError,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  Tag,
  Textarea,
  useToast,
} from '../ui';

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

const FIELDS: TextField[] = [
  { name: 'email', label: 'Email', labelTa: null, required: true, type: 'email' },
  {
    name: 'invoiceName',
    label: 'Name as required on invoice',
    labelTa: 'விலைப்பட்டியலில் குறிப்பிடப்பட வேண்டிய பெயர்',
    required: true,
  },
  {
    name: 'accountHolder',
    label: 'Name of the bank account holder',
    labelTa: 'வங்கி கணக்கு வைத்திருப்பவரின் பெயர்',
    required: true,
  },
  { name: 'mobile', label: 'Mobile number', labelTa: 'கைபேசி எண்', required: true, type: 'tel' },
  { name: 'address', label: 'Address', labelTa: 'முகவரி', required: true },
  { name: 'pincode', label: 'Pincode', labelTa: 'பின்கோடு', required: true },
  { name: 'bankName', label: 'Bank name', labelTa: 'வங்கி பெயர்', required: true },
  { name: 'branch', label: 'Bank branch', labelTa: 'வங்கிக்கிளை', required: true },
  {
    name: 'accountNumber',
    label: 'Account number',
    labelTa: 'வங்கி கணக்கு எண்',
    required: true,
  },
  { name: 'ifsc', label: 'IFSC code', labelTa: null, required: true },
  { name: 'micr', label: 'MICR code', labelTa: null },
  { name: 'panNumber', label: 'PAN card number', labelTa: 'பான் கார்டு எண்', required: true },
  {
    name: 'gstNumber',
    label: 'GST number',
    labelTa: 'ஜிஎஸ்டி எண்',
    required: true,
    help: "Enter 'None' if not applicable.",
  },
];

const COUNTS: Array<{ name: keyof SubmitBankDetailsInput; label: string; labelTa: string | null }> =
  [
    { name: 'plugs5a', label: '5 Amp plug points needed', labelTa: null },
    { name: 'plugs15a', label: '15 Amp plug points needed', labelTa: null },
    { name: 'gasStoves', label: 'Number of gas stoves', labelTa: null },
    { name: 'tablesNeeded', label: 'Tables needed', labelTa: null },
    { name: 'chairsNeeded', label: 'Chairs needed', labelTa: null },
    { name: 'passes2w', label: '2-wheeler passes', labelTa: null },
    { name: 'passes4w', label: '4-wheeler passes', labelTa: null },
    { name: 'passesStaff', label: 'Staff passes', labelTa: null },
  ];

type Values = Record<string, string>;

export function BankForm() {
  const { token = '' } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => getBankForm(token), [token]);

  const [values, setValues] = useState<Values>({});
  const [appliances, setAppliances] = useState<ApplianceRow[]>([{ name: '', watts: '' }]);
  const [files, setFiles] = useState<Record<string, { key: string; name: string }>>({});
  const [agreeNeft, setAgreeNeft] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const presign = presignPublicUpload(token);

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

  const pick = async (purpose: 'BANK_CHEQUE' | 'BANK_PAN' | 'BANK_GST', file: File) => {
    try {
      const up = await uploadFile(presign, file, purpose);
      setFiles((prev) => ({ ...prev, [purpose]: up }));
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
        agreeNeft: true,
        agreeTerms: true,
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

  const ready = agreeNeft && agreeTerms && files.BANK_CHEQUE && files.BANK_PAN;

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
        {FIELDS.map((f) => {
          const id = `bank-${String(f.name)}`;
          return (
            <FormField
              key={String(f.name)}
              id={id}
              label={<BilingualLabel en={f.label} ta={f.labelTa} />}
              help={f.help}
              required={f.required}
              error={errors[String(f.name)]}
            >
              <Input
                id={id}
                type={f.type ?? 'text'}
                invalid={!!errors[String(f.name)]}
                aria-describedby={errors[String(f.name)] ? `${id}-error` : undefined}
                value={values[String(f.name)] ?? ''}
                onChange={(e) => set(String(f.name), e.target.value)}
              />
            </FormField>
          );
        })}
      </Card>

      <Card pad={18} style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Documents</div>
        <FileField
          label='Cancelled cheque or bank passbook front page *'
          labelTa='ரத்து செய்யப்பட்ட காசோலை அல்லது வங்கி பாஸ்புக் முதல் பக்கம்'
          chosen={files.BANK_CHEQUE?.name}
          onPick={(file) => pick('BANK_CHEQUE', file)}
        />
        <FileField
          label='PAN card *'
          labelTa='பான் கார்டு'
          chosen={files.BANK_PAN?.name}
          onPick={(file) => pick('BANK_PAN', file)}
        />
        <FileField
          label='GST certificate (if applicable)'
          labelTa={null}
          chosen={files.BANK_GST?.name}
          onPick={(file) => pick('BANK_GST', file)}
        />
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
          {COUNTS.map((c) => {
            const id = `bank-${String(c.name)}`;
            return (
              <FormField
                key={String(c.name)}
                id={id}
                label={<BilingualLabel en={c.label} ta={c.labelTa} />}
                error={errors[String(c.name)]}
              >
                <Input
                  id={id}
                  type='number'
                  inputMode='numeric'
                  min={0}
                  value={values[String(c.name)] ?? '0'}
                  onChange={(e) => set(String(c.name), e.target.value)}
                />
              </FormField>
            );
          })}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Electrical appliances &amp; wattage
          </div>
          <ApplianceRows id='bank-appliances' value={appliances} onChange={setAppliances} />
        </div>
        <FormField id='bank-remarks' label='Additional remarks' error={errors.remarks}>
          <Textarea
            id='bank-remarks'
            rows={3}
            value={values.remarks ?? ''}
            onChange={(e) => set('remarks', e.target.value)}
          />
        </FormField>
      </Card>

      <Card pad={18} style={{ display: 'grid', gap: 12 }}>
        <label
          htmlFor='agree-neft'
          style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}
        >
          <Checkbox
            id='agree-neft'
            checked={agreeNeft}
            onChange={(e) => setAgreeNeft(e.target.checked)}
          />
          <span>
            I agree — Isha Foundation's bank account details will be sent to me by email or SMS, and
            I will transfer the amount online using NEFT. *
          </span>
        </label>
        <label
          htmlFor='agree-terms'
          style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}
        >
          <Checkbox
            id='agree-terms'
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
          />
          <span>
            I agree that the deposit will be returned only to the bank account given above, and that
            deductions may be made for unreturned or damaged chairs and tables or for an unclean
            stall. *
          </span>
        </label>
        <FieldError of={errors.agreeNeft ?? errors.agreeTerms} />
        <div>
          <Btn kind='primary' onClick={submit} disabled={!ready || busy}>
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

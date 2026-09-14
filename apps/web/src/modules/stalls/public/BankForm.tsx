import { BANK_FORM_FIELDS, BankDetailsInput, type FormField, formatInr } from '@msr/stalls';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, fieldErrorsFrom } from '../api-client';
import { getBankView, submitBank, uploadFile } from '../api';
import { type ApplianceRow, ApplianceRows } from '../components/ApplianceRows';
import { CheckRow, Field, NumberInput, SectionTitle, TextArea, TextInput } from '../components/FormControls';
import { useLoad } from '../hooks';
import { Card, Empty, ErrorBox, H1, Loading, Tag } from '../ui/ui';
import { Icon } from '../ui/icons';

type Values = Record<string, string | boolean | ApplianceRow[]>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (str(v).trim() === '' ? 0 : Number(str(v)));

const UPLOADS: Record<string, 'CHEQUE' | 'PAN' | 'GST'> = {
  chequeMediaKey: 'CHEQUE',
  panMediaKey: 'PAN',
  gstMediaKey: 'GST',
};

/** The 2025 "MSR stalls bank details and requirements" form, reached only by
 *  the signed link in the selection email. One screen for a vendor and a local
 *  welfare stall alike; the API decides the deposit. */
export function BankForm() {
  const { token = '' } = useParams();
  const view = useLoad(() => getBankView(token), [token]);
  const [values, setValues] = useState<Values>({ appliances: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [top, setTop] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const p = view.data?.prefill;
    if (!p) return;
    setValues((v) => ({
      ...v,
      mobile: p.mobile,
      address: p.address ?? '',
      plugs5a: String(p.plugs5a),
      plugs15a: String(p.plugs15a),
      gasStoves: String(p.gasStoves),
      tablesNeeded: String(p.tablesNeeded),
      chairsNeeded: String(p.chairsNeeded),
      passes2w: String(p.passes2w),
      passes4w: String(p.passes4w),
      passesStaff: String(p.passesStaff),
      appliances: p.appliances.map((a) => ({ name: a.name, watts: String(a.watts) })),
    }));
  }, [view.data]);

  if (view.loading) return <Loading />;
  if (view.error || !view.data) {
    const nf = view.error instanceof ApiError && view.error.status === 404;
    return (
      <Card>
        <Empty>{nf ? 'This link is not valid. Please use the link from your confirmation email.' : 'Something went wrong. Please try again.'}</Empty>
      </Card>
    );
  }
  const v = view.data;

  const set = (name: string, val: Values[string]) => {
    setValues((s) => ({ ...s, [name]: val }));
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };

  const onFile = async (name: string, file: File | undefined) => {
    if (!file) return;
    setUploading(name);
    try {
      const key = await uploadFile(token, UPLOADS[name]!, file);
      setUploaded((u) => ({ ...u, [name]: file.name }));
      set(name, key);
    } catch (e) {
      setErrors((er) => ({ ...er, [name]: (e as Error).message }));
    } finally {
      setUploading(null);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTop(null);
    const built: Record<string, unknown> = {
      invoiceName: str(values.invoiceName),
      accountHolder: str(values.accountHolder),
      mobile: str(values.mobile),
      address: str(values.address),
      pincode: str(values.pincode),
      bankName: str(values.bankName),
      branch: str(values.branch),
      accountNumber: str(values.accountNumber),
      ifsc: str(values.ifsc),
      micr: str(values.micr),
      chequeMediaKey: str(values.chequeMediaKey) || undefined,
      advanceReturnAck: values.advanceReturnAck === true,
      panNumber: str(values.panNumber),
      panMediaKey: str(values.panMediaKey) || undefined,
      gstNumber: str(values.gstNumber) || 'NONE',
      gstMediaKey: str(values.gstMediaKey) || undefined,
      neftAgreed: values.neftAgreed === true,
      tncAgreed: values.tncAgreed === true,
      plugs5a: num(values.plugs5a),
      plugs15a: num(values.plugs15a),
      gasStoves: num(values.gasStoves),
      appliances: (Array.isArray(values.appliances) ? values.appliances : [])
        .filter((a) => a.name.trim())
        .map((a) => ({ name: a.name.trim(), watts: num(a.watts) })),
      tablesNeeded: num(values.tablesNeeded),
      chairsNeeded: num(values.chairsNeeded),
      passes2w: num(values.passes2w),
      passes4w: num(values.passes4w),
      passesStaff: num(values.passesStaff),
      remarks: str(values.remarks) || undefined,
    };
    const missing: Record<string, string> = {};
    for (const f of BANK_FORM_FIELDS) {
      const val = values[f.name];
      const empty = val === undefined || val === '' || val === false;
      if (f.required && empty) missing[f.name] = f.type === 'checkbox' ? 'Please tick to continue' : 'Required';
    }
    const parsed = BankDetailsInput.safeParse(built);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const name = i.path.join('.');
        if (!missing[name]) missing[name] = i.message.replace(/^Invalid input:\s*/, '');
      }
    }
    if (Object.keys(missing).length) {
      setErrors(missing);
      setTop('Please fix the highlighted fields.');
      document.getElementById(Object.keys(missing)[0])?.scrollIntoView?.({ block: 'center' });
      return;
    }
    if (!parsed.success) return;
    setBusy(true);
    try {
      const r = await submitBank(token, parsed.data);
      setDone(r.reference);
    } catch (err) {
      const fe = fieldErrorsFrom(err);
      setErrors(fe);
      setTop(Object.keys(fe).length ? 'Please fix the highlighted fields.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ color: 'var(--ok)', margin: '12px 0' }}>
          <Icon name='circle-check' size={44} strokeWidth={1.6} />
        </div>
        <H1 sub={`Reference ${done}. The stall team will send your payment details by email.`}>Details received</H1>
      </div>
    );
  }

  const byName = new Map(BANK_FORM_FIELDS.map((f) => [f.name, f]));
  const F = (name: string) => byName.get(name)!;

  const text = (f: FormField, type = 'text') => (
    <Field key={f.name} id={f.name} label={f.label} labelTa={f.labelTa} help={f.help} helpTa={f.helpTa ?? null} error={errors[f.name]} required={f.required}>
      <TextInput id={f.name} type={type} invalid={!!errors[f.name]} value={str(values[f.name])} onChange={(e) => set(f.name, e.target.value)} />
    </Field>
  );
  const number = (f: FormField) => (
    <Field key={f.name} id={f.name} label={f.label} labelTa={f.labelTa} help={f.help} helpTa={f.helpTa ?? null} error={errors[f.name]} required={f.required}>
      <NumberInput id={f.name} invalid={!!errors[f.name]} value={str(values[f.name])} onChange={(e) => set(f.name, e.target.value)} />
    </Field>
  );
  const upload = (f: FormField) => (
    <Field key={f.name} id={f.name} label={f.label} labelTa={f.labelTa} help={f.help} helpTa={f.helpTa ?? null} error={errors[f.name]} required={f.required}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          id={f.name}
          type='file'
          accept='image/jpeg,image/png,application/pdf'
          disabled={uploading !== null}
          onChange={(e) => onFile(f.name, e.target.files?.[0])}
          style={{ fontSize: 13 }}
        />
        {uploading === f.name && <span style={{ fontSize: 12, color: 'var(--mfg)' }}>Uploading…</span>}
        {uploaded[f.name] && <Tag tone='ok'>{uploaded[f.name]}</Tag>}
      </div>
    </Field>
  );
  const check = (f: FormField) => (
    <CheckRow key={f.name} id={f.name} checked={values[f.name] === true} onChange={(b) => set(f.name, b)} label={f.label} labelTa={f.labelTa} help={f.help} helpTa={f.helpTa ?? null} error={errors[f.name]} required={f.required} />
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <H1 sub={`${v.stallName} · ${v.reference}${v.stallNumbers.length ? ` · Stall ${v.stallNumbers.join(', ')}` : ''}`}>
        Bank details and requirements
      </H1>
      <Card style={{ marginBottom: 14, background: 'var(--pri-t)', borderColor: 'var(--pri-t2)' }}>
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          Please provide the below details to share the payment details.{' '}
          <span className='msrs-ta' lang='ta'>
            கட்டணம் செலுத்துவதற்கான விவரங்களை பகிர, கீழே உள்ள விவரங்களை வழங்கவும்.
          </span>
          <div style={{ marginTop: 6 }}>
            Refundable deposit for this stall: <b>{formatInr(v.depositPaise)}</b>
            {v.termsUrl && (
              <>
                {' · '}
                <a href={v.termsUrl} target='_blank' rel='noreferrer'>
                  Terms and conditions
                </a>
              </>
            )}
          </div>
        </div>
      </Card>
      {v.submitted && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13 }}>
            <b>Already submitted</b> on {new Date(v.submitted.submittedAt).toLocaleDateString('en-IN')} — {v.submitted.accountHolder},{' '}
            {v.submitted.bankName} {v.submitted.accountNumberMasked}. Submitting again replaces it.
          </div>
        </Card>
      )}
      {top && (
        <div style={{ marginBottom: 14 }}>
          <ErrorBox>
            <span role='alert'>{top}</span>
          </ErrorBox>
        </div>
      )}
      <Card>
        <SectionTitle>Invoice and bank account</SectionTitle>
        {text(F('invoiceName'))}
        {text(F('accountHolder'))}
        {text(F('mobile'), 'tel')}
        <Field id='address' label={F('address').label} labelTa={F('address').labelTa} error={errors.address} required>
          <TextArea id='address' invalid={!!errors.address} value={str(values.address)} onChange={(e) => set('address', e.target.value)} />
        </Field>
        {text(F('pincode'))}
        {text(F('bankName'))}
        {text(F('branch'))}
        {text(F('accountNumber'))}
        {text(F('ifsc'))}
        {text(F('micr'))}
        {upload(F('chequeMediaKey'))}
        {check(F('advanceReturnAck'))}

        <SectionTitle>PAN and GST</SectionTitle>
        {text(F('panNumber'))}
        {upload(F('panMediaKey'))}
        {text(F('gstNumber'))}
        {upload(F('gstMediaKey'))}
        {check(F('neftAgreed'))}

        <SectionTitle>Electrical and logistics</SectionTitle>
        {number(F('plugs5a'))}
        {number(F('plugs15a'))}
        {number(F('gasStoves'))}
        <Field id='appliances' label={F('appliances').label} labelTa={F('appliances').labelTa}>
          <ApplianceRows id='appliances' value={Array.isArray(values.appliances) ? values.appliances : []} onChange={(rows) => set('appliances', rows)} />
        </Field>
        {number(F('tablesNeeded'))}
        {number(F('chairsNeeded'))}
        {number(F('passes2w'))}
        {number(F('passes4w'))}
        {number(F('passesStaff'))}
        <Field id='remarks' label={F('remarks').label} labelTa={F('remarks').labelTa}>
          <TextArea id='remarks' value={str(values.remarks)} onChange={(e) => set('remarks', e.target.value)} />
        </Field>

        <SectionTitle>Terms</SectionTitle>
        {check(F('tncAgreed'))}
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          type='submit'
          disabled={busy || uploading !== null}
          className={busy || uploading !== null ? undefined : 'msrs-lift'}
          style={{
            padding: '10px 18px',
            borderRadius: 'var(--r2)',
            border: '1px solid transparent',
            background: 'var(--pri)',
            color: 'var(--pfg)',
            fontSize: 13.5,
            fontWeight: 700,
            cursor: busy || uploading !== null ? 'not-allowed' : 'pointer',
            opacity: busy || uploading !== null ? 0.5 : 1,
            boxShadow: 'var(--sh-pri)',
          }}
        >
          {busy ? 'Submitting…' : 'Submit details'}
        </button>
      </div>
    </form>
  );
}

import type {
  FssaiFormView,
  PresignUploadInput,
  PresignUploadResponse,
  SubmitFssaiInput,
} from '@stalls/core';
import { asFormField, formFields } from '@stalls/core';
import { type ReactNode, useState } from 'react';
import { useParams } from 'react-router';
import { getFssaiForm, presignPublicUpload, submitFssai, uploadFile } from '../api';
import { formatDate, useLoad } from '../hooks';
import { DeclarationConsent, allTicked } from '../components/DeclarationConsent';
import { FieldControl } from '../components/FormFields';
import {
  Btn,
  Card,
  ErrorBox,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  Tag,
  useIsMobile,
  useToast,
} from '../ui';
import { BackToRequests } from './portal-ui';

/**
 * The FSSAI certificate upload — "The vendor should login and upload the FSSAI
 * Certificate."
 *
 * The "login" is the signed link in the vendor's email, the same mechanism the
 * status page and the bank form use. Up to five files, because a certificate is
 * often photographed a page at a time.
 *
 * ⚠️ Re-uploading REPLACES what was there and clears any verification the team
 * had already given. That is deliberate: a vendor who swaps a valid certificate
 * for an expired one after it was ticked off would otherwise keep the tick.
 */
export function FssaiForm() {
  const { token = '' } = useParams();
  const { data, error, loading, reload } = useLoad(() => getFssaiForm(token), [token]);
  const [done, setDone] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) {
    return (
      <ErrorBox>
        This link is not valid. It may have expired. Please ask the stalls team for a new one.
      </ErrorBox>
    );
  }
  if (!data) return null;

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
      <BackToRequests />
      <H1 icon={<Icon name='shield' size={18} />} sub={`${data.stallName} · ${data.reference}`}>
        FSSAI Certificate
      </H1>
      {done ? (
        <Card pad={24} style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
          <Tag tone='ok'>
            <Icon name='check' size={12} /> Uploaded
          </Tag>
          <h2 style={{ margin: 0, fontSize: 20 }}>Thank you</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)' }}>
            The stalls team will check your certificate. You do not need to do anything else unless
            we contact you.
          </p>
        </Card>
      ) : (
        <FssaiFormBody
          data={data}
          presign={presignPublicUpload(token)}
          submit={(body) => submitFssai(token, body)}
          onDone={() => {
            setDone(true);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * The upload itself, drawn from a view somebody else loaded.
 *
 * 🔴 Split out so the BACKOFFICE can upload a certificate a vendor sent by
 * some other means — the same questions, the same consents, the same rule that
 * a re-upload clears the team's tick.
 */
export function FssaiFormBody({
  data,
  presign,
  submit,
  submitLabel = 'Submit',
  beforeSubmit,
  ready: readyProp = true,
  onDone,
}: {
  data: FssaiFormView;
  presign: (input: PresignUploadInput) => Promise<PresignUploadResponse>;
  submit: (body: SubmitFssaiInput) => Promise<void>;
  submitLabel?: string;
  beforeSubmit?: ReactNode;
  ready?: boolean;
  onDone?: () => void;
}) {
  const toast = useToast();
  const mobileView = useIsMobile();

  const [ownerName, setOwnerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [files, setFiles] = useState<Array<{ key: string; name: string }>>([]);
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

  // 🔴 The edition's own definition. This form seeds no questions of its own
  // beyond the three built-ins, but an admin can append any — and until the
  // definition ARRIVES there is nothing to tick and nothing required, so the
  // gate would be vacuously satisfied.
  const rows = data.form ? formFields(data.form) : [];
  const appendedFields = rows.filter((f) => !f.isBuiltIn);
  const ready =
    readyProp && data.form !== null && files.length > 0 && allTicked(data.declarations, ticked);

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await submit({
        stallName: data.stallName,
        ownerName: ownerName.trim() || undefined,
        mobile: mobile.trim() || undefined,
        files,
        // The exact versions this page drew. This form seeds no declaration, so
        // the list is usually empty — and stays correct the day the team
        // authors one, without a deploy.
        declarationIds: data.declarations.map((d) => d.id),
        customFields: Object.fromEntries(Object.entries(extra).filter(([, v]) => v.trim() !== '')),
      });
      onDone?.();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card pad={18} style={{ display: 'grid', gap: 6 }}>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          Every food stall must have a valid FSSAI certificate. Please upload yours below — up to
          five files, PDF or photo.
        </p>
        {data.uploadedAt && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)' }}>
            You uploaded {data.files.length} file{data.files.length === 1 ? '' : 's'} on{' '}
            {formatDate(data.uploadedAt)}
            {data.verifiedAt ? ', and it has been verified.' : '.'} Uploading again replaces them.
          </p>
        )}
      </Card>

      <Card pad={18} style={{ display: 'grid', gap: 16 }}>
        {/* Two short answers, beside each other on anything wider than a
            phone. Stacked, they were two boxes and a mile of card to the right
            of them. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: mobileView ? '1fr' : 'repeat(2,minmax(0,1fr))',
            gap: mobileView ? 14 : '16px 20px',
            alignItems: 'start',
          }}
        >
          <FormField id='fssai-owner' label='Owner Name'>
            <Input
              id='fssai-owner'
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </FormField>
          <FormField id='fssai-mobile' label='Mobile Number'>
            <Input
              id='fssai-mobile'
              type='tel'
              inputMode='tel'
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
          </FormField>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>FSSAI certificate *</span>
          {files.map((f) => (
            <div
              key={f.key}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
            >
              <Tag tone='ok' size='sm'>
                <Icon name='file-text' size={11} /> {f.name}
              </Tag>
              <Btn onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))}>
                <Icon name='trash' size={14} />
                Remove
              </Btn>
            </div>
          ))}
          {files.length < 5 && (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                border: '1px dashed var(--bd)',
                borderRadius: 'var(--r2)',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--mfg)',
              }}
            >
              <input
                type='file'
                accept='application/pdf,image/*'
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const up = await uploadFile(presign, file, 'FSSAI');
                    setFiles((prev) => [...prev, up]);
                    toast.ok(`${file.name} uploaded.`);
                  } catch (err) {
                    toast.fail(err);
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
              <Icon name='plus' size={14} />
              Add a file (PDF or photo, up to 20 MB)
            </label>
          )}
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          {/* Questions this edition appended, and the consents it asks for.
              Both are empty until the team authors them, and the button then
              behaves exactly as it does today. */}
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

          <DeclarationConsent declarations={data.declarations} ticked={ticked} onToggle={toggle} />

          {beforeSubmit}

          {/* Wrapped: a bare button is a grid item and would stretch to the
              width of the card. */}
          <div>
            <Btn kind='primary' onClick={send} disabled={busy || !ready}>
              <Icon name='send' size={14} />
              {busy ? 'Submitting…' : submitLabel}
            </Btn>
          </div>
        </div>
      </Card>
    </>
  );
}

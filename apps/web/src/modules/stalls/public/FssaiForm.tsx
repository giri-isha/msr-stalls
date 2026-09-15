import { useState } from 'react';
import { useParams } from 'react-router';
import { getFssaiForm, presignPublicUpload, submitFssai, uploadFile } from '../api';
import { formatDate, useLoad } from '../hooks';
import { Btn, Card, ErrorBox, FormField, H1, Icon, Input, Loading, Tag, useToast } from '../ui';

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
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => getFssaiForm(token), [token]);

  const [ownerName, setOwnerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [files, setFiles] = useState<Array<{ key: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const presign = presignPublicUpload(token);

  if (loading && !data) return <Loading />;
  if (error) {
    return (
      <ErrorBox>
        This link is not valid. It may have expired. Please ask the stalls team for a new one.
      </ErrorBox>
    );
  }
  if (!data) return null;

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      await submitFssai(token, {
        stallName: data.stallName,
        ownerName: ownerName.trim() || undefined,
        mobile: mobile.trim() || undefined,
        files,
      });
      setDone(true);
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
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
        <>
          <Card pad={18} style={{ display: 'grid', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Every food stall must have a valid FSSAI certificate. Please upload yours below — up
              to five files, PDF or photo.
            </p>
            {data.uploadedAt && (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)' }}>
                You uploaded {data.files.length} file{data.files.length === 1 ? '' : 's'} on{' '}
                {formatDate(data.uploadedAt)}
                {data.verifiedAt ? ', and it has been verified.' : '.'} Uploading again replaces
                them.
              </p>
            )}
          </Card>

          <Card pad={18} style={{ display: 'grid', gap: 14 }}>
            <FormField id='fssai-owner' label='Owner name'>
              <Input
                id='fssai-owner'
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </FormField>
            <FormField id='fssai-mobile' label='Mobile number'>
              <Input
                id='fssai-mobile'
                type='tel'
                inputMode='tel'
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </FormField>

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

            <div>
              <Btn kind='primary' onClick={submit} disabled={busy || files.length === 0}>
                <Icon name='send' size={14} />
                {busy ? 'Submitting…' : 'Submit'}
              </Btn>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

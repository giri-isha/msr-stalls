import { useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../api-client';
import { getFssaiView, submitFssai, uploadFile } from '../api';
import { Field, TextInput } from '../components/FormControls';
import { formatDate, useLoad } from '../hooks';
import { Btn, Card, Empty, ErrorBox, H1, Loading, Tag } from '../ui/ui';

/** FSSAI certificate upload, by the signed link in the post-payment email.
 *  A new upload replaces the old one and answers any rejection. */
export function FssaiUpload() {
  const { token = '' } = useParams();
  const view = useLoad(() => getFssaiView(token), [token]);
  const [file, setFile] = useState<File | null>(null);
  const [license, setLicense] = useState('');
  const [validTill, setValidTill] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (view.loading) return <Loading />;
  if (view.error || !view.data) {
    const nf = view.error instanceof ApiError && view.error.status === 404;
    return (
      <Card>
        <Empty>{nf ? 'This link is not valid. Please use the link from your email.' : 'Something went wrong. Please try again.'}</Empty>
      </Card>
    );
  }
  const v = view.data;

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const key = await uploadFile(token, 'FSSAI', file);
      await submitFssai(token, { mediaKey: key, fileName: file.name, licenseNumber: license || '', validTill: validTill || '' });
      setFile(null);
      view.reload();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 503 ? 'Uploads are not available right now. Please try again later.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <H1 sub={`${v.stallName} · ${v.reference}`}>FSSAI certificate</H1>
      {v.fssaiProcessUrl && (
        <Card style={{ marginBottom: 14, background: 'var(--pri-t)', borderColor: 'var(--pri-t2)' }}>
          <div style={{ fontSize: 13 }}>
            Don't have a certificate yet?{' '}
            <a href={v.fssaiProcessUrl} target='_blank' rel='noreferrer'>
              How to obtain one
            </a>
          </div>
        </Card>
      )}
      {v.current && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <b>{v.current.fileName}</b>
            <span style={{ color: 'var(--mfg)' }}>uploaded {formatDate(v.current.uploadedAt)}</span>
            {v.current.verifiedAt ? (
              <Tag tone='ok'>Verified</Tag>
            ) : v.current.rejectedReason ? (
              <Tag tone='des'>Not accepted: {v.current.rejectedReason}</Tag>
            ) : (
              <Tag tone='warn'>Awaiting review</Tag>
            )}
          </div>
        </Card>
      )}
      {!v.current?.verifiedAt && (
        <Card>
          <Field id='file' label={v.current ? 'Upload a new certificate' : 'Upload your certificate'} help='JPG, PNG or PDF, up to 10 MB' required>
            <input id='file' type='file' accept='image/jpeg,image/png,application/pdf' onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
          </Field>
          <Field id='license' label='FSSAI licence number' help='14 digits, if known'>
            <TextInput id='license' value={license} onChange={(e) => setLicense(e.target.value)} inputMode='numeric' />
          </Field>
          <Field id='valid' label='Valid till'>
            <TextInput id='valid' type='date' value={validTill} onChange={(e) => setValidTill(e.target.value)} />
          </Field>
          {error && (
            <div style={{ marginBottom: 12 }}>
              <ErrorBox>{error}</ErrorBox>
            </div>
          )}
          <Btn kind='primary' disabled={!file || busy} onClick={submit}>
            {busy ? 'Uploading…' : 'Upload'}
          </Btn>
        </Card>
      )}
    </div>
  );
}

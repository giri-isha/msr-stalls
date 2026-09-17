import type { RequestDetail as Detail } from '@stalls/core';
import { type ReactNode, useState } from 'react';
import * as api from '../api';
import { Attestation } from '../components/Attestation';
import { useLoad } from '../hooks';
import { BankFormBody } from '../public/BankForm';
import { FssaiFormBody } from '../public/FssaiForm';
import { PaymentClaimDialog } from '../public/PaymentClaim';
import { StaffFormBody } from '../public/StaffRegistration';
import { Dialog, ErrorBox, Loading } from '../ui';

/**
 * The four requester forms, opened from the record and filed by a member.
 *
 * Each dialog loads the same view the requester's own page loads, draws the
 * same body, and posts to the filing route for THIS request. The attestation
 * sits above the submit and gates it; the button never reads "Submit", because
 * the member is not the person agreeing to anything.
 */
export type OnBehalf = 'bank' | 'fssai' | 'staff' | 'claim';

const TITLE: Record<Exclude<OnBehalf, 'claim'>, string> = {
  bank: 'Bank Details & Requirements',
  fssai: 'FSSAI Certificate',
  staff: 'Stall Staff Registration',
};

export function FileForRequester({
  r,
  which,
  onClose,
  onDone,
}: {
  r: Detail;
  which: OnBehalf;
  onClose: () => void;
  onDone: () => void;
}) {
  const [attested, setAttested] = useState(false);
  const attestation = (
    <Attestation checked={attested} onChange={setAttested} requesterName={r.requesterName} />
  );
  const done = () => {
    onDone();
    onClose();
  };

  // A claim carries no declarations, so it needs no attestation — and it
  // already has a dialog of its own that the requester uses.
  if (which === 'claim') {
    return (
      <PaymentClaimDialog
        reference={r.reference}
        payment={null}
        title={`Record a transfer ${r.requesterName} reported`}
        submitLabel='Record It'
        submit={(input) => api.fileClaim(r.id, input)}
        onClose={onClose}
        onSubmitted={onDone}
      />
    );
  }

  return (
    <Dialog title={`${TITLE[which]} — for ${r.requesterName}`} onClose={onClose} width={760}>
      {which === 'bank' && (
        <Bank r={r} attested={attested} attestation={attestation} onDone={done} />
      )}
      {which === 'fssai' && (
        <Fssai r={r} attested={attested} attestation={attestation} onDone={done} />
      )}
      {which === 'staff' && (
        <Staff r={r} attested={attested} attestation={attestation} onDone={onDone} />
      )}
    </Dialog>
  );
}

interface Inner {
  r: Detail;
  attested: boolean;
  attestation: ReactNode;
  onDone: () => void;
}

function Bank({ r, attested, attestation, onDone }: Inner) {
  const { data, error, loading } = useLoad(() => api.getBankFormFor(r.id), [r.id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the form.'}</ErrorBox>;
  return (
    <BankFormBody
      data={data}
      presign={api.presignBackofficeUpload}
      submit={(body) => api.fileBank(r.id, { ...body, attestation: true })}
      submitLabel='File on Their Behalf'
      ready={attested}
      beforeSubmit={attestation}
      onDone={onDone}
    />
  );
}

function Fssai({ r, attested, attestation, onDone }: Inner) {
  const { data, error, loading } = useLoad(() => api.getFssaiFormFor(r.id), [r.id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the form.'}</ErrorBox>;
  return (
    <FssaiFormBody
      data={data}
      presign={api.presignBackofficeUpload}
      submit={(body) => api.fileFssai(r.id, { ...body, attestation: true })}
      submitLabel='File on Their Behalf'
      ready={attested}
      beforeSubmit={attestation}
      onDone={onDone}
    />
  );
}

/** ⚠️ Stays open after each person, like the vendor's own page: a desk
 *  registering a stall's team works through a list, not one name. */
function Staff({ r, attested, attestation, onDone }: Inner) {
  const { data, error, loading, setData } = useLoad(() => api.getStaffFormFor(r.id), [r.id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the form.'}</ErrorBox>;
  return (
    <StaffFormBody
      coupon={data}
      submit={(body) => api.fileStaff(r.id, { ...body, attestation: true })}
      submitLabel='File on Their Behalf'
      ready={attested}
      beforeSubmit={attestation}
      onRegistered={(next) => {
        setData({ ...data, ...next });
        onDone();
      }}
    />
  );
}

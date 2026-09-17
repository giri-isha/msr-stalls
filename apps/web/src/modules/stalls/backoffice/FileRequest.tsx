import {
  PLACEHOLDER_EMAIL_DOMAIN,
  type RequesterLookupResponse,
  type StallRequestType,
  type SubmitRequestInput,
  canReach,
  parseContact,
} from '@stalls/core';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { fileRequest, lookupRequester } from '../api';
import { Attestation } from '../components/Attestation';
import { useDebounced } from '../hooks';
import { useMe } from '../me';
import { RequestFormBody } from '../public/RequestForm';
import { REQUEST_FORMS } from '../public/request-forms';
import { Btn, Card, Empty, FormField, H1, Icon, Input, Tag, useToast } from '../ui';

/**
 * A member files a stall request for somebody who cannot.
 *
 * Three steps on one page: which form, who it is for, then the form itself —
 * the SAME body the requester fills, so a question added on the Form Builder
 * is asked here too and the API refuses exactly what it refuses them.
 *
 * ⚠️ Only the forms inside the caller's scope are offered. A Local Welfare
 * member sees one tile; the API would refuse the other two anyway, and a tile
 * that opens a form the server will not take costs a page of typing.
 *
 * ⚠️ The requester step decides WHOSE request this is, and says so before the
 * form opens: a known contact shows the account and how many requests it
 * already holds, because attaching to the wrong vendor is the mistake a desk
 * cannot see afterwards.
 */
type Step = 'type' | 'requester' | 'form';

export function FileRequest() {
  const { me, can } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [type, setType] = useState<StallRequestType | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [attested, setAttested] = useState(false);
  const [step, setStep] = useState<Step>('type');

  // One lookup per SETTLED contact, so a number typed digit by digit is not
  // ten requests. Either contact may name the account, so both are looked up.
  const settledEmail = useDebounced(email);
  const settledPhone = useDebounced(phone);
  const [byEmail, setByEmail] = useState<RequesterLookupResponse['match']>(null);
  const [byPhone, setByPhone] = useState<RequesterLookupResponse['match']>(null);
  useEffect(() => {
    if (!parseContact(settledEmail)) {
      setByEmail(null);
      return;
    }
    let alive = true;
    lookupRequester(settledEmail)
      .then((r) => alive && setByEmail(r.match))
      .catch(() => alive && setByEmail(null));
    return () => {
      alive = false;
    };
  }, [settledEmail]);
  useEffect(() => {
    if (!parseContact(settledPhone)) {
      setByPhone(null);
      return;
    }
    let alive = true;
    lookupRequester(settledPhone)
      .then((r) => alive && setByPhone(r.match))
      .catch(() => alive && setByPhone(null));
    return () => {
      alive = false;
    };
  }, [settledPhone]);

  const scope = me?.requestTypeScope ?? null;
  const forms = REQUEST_FORMS.filter((f) => canReach(scope, f.type));
  const match = byEmail ?? byPhone;
  const ambiguous = !!byEmail && !!byPhone && byEmail.accountId !== byPhone.accountId;
  const wrongType = !!match?.requesterType && !!type && match.requesterType !== type;
  const hasContact = !!parseContact(email) || !!parseContact(phone);
  const name = match?.displayName ?? displayName.trim();
  const canOpen = !!type && hasContact && !!name && !ambiguous && !wrongType;

  if (!can('filing.request')) {
    return <Empty>Your role does not file requests on a requester's behalf.</Empty>;
  }

  const submit = async (input: SubmitRequestInput) => {
    const r = await fileRequest({
      requester: {
        displayName: name,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      },
      request: input,
      attestation: true,
    });
    toast.ok(`${r.reference} filed for ${name}. The receipt has gone to their own contact.`);
    navigate(`/m/stalls/requests/${r.requestId}`, { replace: true });
  };

  return (
    <div>
      <Link
        to='/m/stalls/requests'
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 12,
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--mfg)',
          textDecoration: 'none',
        }}
      >
        <Icon name='chevron-left' size={14} />
        All Requests
      </Link>
      <H1
        icon={<Icon name='clipboard-list' size={18} />}
        sub='For a vendor, department or trader who cannot fill the form themselves. They receive the receipt; you see the record.'
      >
        File a Request
      </H1>

      {step === 'type' && (
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))',
          }}
        >
          {forms.map((f) => (
            <Card key={f.type} pad={0}>
              <button
                type='button'
                onClick={() => {
                  setType(f.type);
                  setStep('requester');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: 16,
                  border: 0,
                  borderRadius: 'var(--r3)',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'inherit',
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--r2)',
                    display: 'grid',
                    placeItems: 'center',
                    background: f.tint,
                    flex: 'none',
                  }}
                >
                  <Icon name={f.glyph} size={17} />
                </span>
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.who}</span>
                  {f.whoTa && (
                    <span
                      className='stalls-tamil'
                      lang='ta'
                      style={{ fontSize: 12, color: 'var(--mfg)' }}
                    >
                      {f.whoTa}
                    </span>
                  )}
                </span>
              </button>
            </Card>
          ))}
        </div>
      )}

      {step === 'requester' && type && (
        <Card pad={18} style={{ display: 'grid', gap: 14, maxWidth: 620 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Who is this for?</div>
          <FormField
            id='req-phone'
            label='Mobile Number'
            help='Either contact is enough. A trader with no email address is filed on their number, and hears from us by WhatsApp.'
          >
            <Input
              id='req-phone'
              type='tel'
              inputMode='tel'
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </FormField>
          <FormField id='req-email' label='Email'>
            <Input
              id='req-email'
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>

          {match && !ambiguous && (
            <div
              style={{
                display: 'grid',
                gap: 6,
                padding: '10px 12px',
                borderRadius: 'var(--r2)',
                background: 'var(--ok-t)',
                border: '1px solid var(--ok-b)',
                fontSize: 12.5,
              }}
            >
              <div>
                <Icon name='user' size={12} /> This is <strong>{match.displayName}</strong> ·{' '}
                {match.requestCount} request{match.requestCount === 1 ? '' : 's'} this edition.
              </div>
              {wrongType && (
                <Tag tone='des' size='sm'>
                  Registered for the {match.requesterType} form — this one would be refused.
                </Tag>
              )}
            </div>
          )}

          {ambiguous && byEmail && byPhone && (
            <Tag tone='des'>
              That email belongs to {byEmail.displayName} and that number to {byPhone.displayName}.
              File with one contact or the other.
            </Tag>
          )}

          {!match && (
            <FormField id='req-name' label='Requester Name' required>
              <Input
                id='req-name'
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </FormField>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={() => setStep('type')}>Back</Btn>
            <Btn kind='primary' disabled={!canOpen} onClick={() => setStep('form')}>
              <Icon name='chevron-right' size={14} />
              Open the Form
            </Btn>
          </div>
        </Card>
      )}

      {step === 'form' && type && (
        <RequestFormBody
          type={type}
          requester={{
            displayName: name,
            // ⚠️ A phone-only requester is given the placeholder address their
            // ACCOUNT will carry, so the form's email question is answered the
            // way the API expects. The filer can overwrite it with a real one.
            email:
              email.trim() ||
              (phone.trim()
                ? `mobile+${parseContact(phone)?.value ?? phone.trim()}@${PLACEHOLDER_EMAIL_DOMAIN}`
                : ''),
            phone: parseContact(phone)?.value ?? '',
          }}
          submit={submit}
          submitLabel='File on Their Behalf'
          ready={attested}
          beforeSubmit={
            <Attestation checked={attested} onChange={setAttested} requesterName={name} />
          }
        />
      )}
    </div>
  );
}

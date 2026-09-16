import { FORM_DEFINITIONS, MIN_PASSWORD_LENGTH, type StallRequestType } from '@stalls/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { registerRequester } from '../api';
import { BilingualLabel } from '../components/BilingualLabel';
import { Btn, Card, ChoicePlate, FieldError, FormField, H1, Icon, Input, Radio } from '../ui';
import { REQUEST_FORMS } from './request-forms';

/**
 * Creating a stall account.
 *
 * ⚠️ TEMPORARY — replaced by the host's Isha OIDC.
 *
 * ⚠️ The panel after submitting says the SAME thing whatever happened, because
 * the API answers the same 202 to a free contact, one that already has an
 * account, and a string that is not a contact at all. Copy reading "your
 * account has been created" would be false in two of those three cases — and
 * false in a way that answers the question the whole public surface refuses:
 * whether a particular person has applied.
 *
 * So the copy carries BOTH outcomes, hedged on the "if". A returning vendor is
 * not sent to a login that will refuse them; they are told, in the same breath
 * as everyone else, that the stall team sets their login up.
 *
 * ⚠️ There is no confirmation step any more, so the panel sends people to log
 * in rather than to their inbox — but it still cannot sign them in itself, for
 * the reason above. See `registration.ts` for why confirmation went.
 */
export function Register() {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  // 🔴 No default. A pre-picked "Vendor" would be answered by whoever did not
  // read the question, and it is the one answer on this screen the requester
  // cannot change afterwards without calling the stall team.
  const [kind, setKind] = useState<StallRequestType | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const [noKind, setNoKind] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !name.trim() || !contact.trim()) return;
    if (!kind) {
      setNoKind(true);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setBusy(true);
    try {
      await registerRequester({
        contact: contact.trim(),
        password,
        displayName: name.trim(),
        requesterType: kind,
      });
    } catch {
      // Even a failure lands on the panel below. The only errors this route
      // raises are the rate limit and a transport fault, and neither is worth
      // telling a reader about in words that would also distinguish a real
      // account from one that does not exist.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  if (sent) {
    return (
      <div style={{ display: 'grid', gap: 16, maxWidth: 460, margin: '0 auto' }}>
        <Card pad={22} style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, textAlign: 'center' }}>Almost there</div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            If we could set up an account for that email address or mobile number, it is ready now —
            log in with the password you just chose.
          </p>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            If you have applied for a stall before, your details are already with us and the stall
            team will set your login up for you — please call them.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', textAlign: 'center' }}>
            <Link to='/stalls/login'>Go to Log In</Link>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 540, margin: '0 auto' }}>
      <H1 icon={<Icon name='user' size={18} />} sub='You need one before you can request a stall'>
        Create an Account
      </H1>

      <Card pad={18}>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <FormField id='reg-name' label={<BilingualLabel en='Your name' ta='உங்கள் பெயர்' />}>
            <Input
              id='reg-name'
              autoFocus
              autoComplete='name'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField
            id='reg-contact'
            label={
              <BilingualLabel en='Email address or mobile number' ta='மின்னஞ்சல் அல்லது கைபேசி எண்' />
            }
            help='This is your login, and where every letter about your stall goes.'
          >
            <Input
              id='reg-contact'
              autoComplete='username'
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder='you@example.com or 98765 43210'
            />
          </FormField>

          {/* 🔴 Which form the account may fill, asked ONCE and here.
              A trader, a village welfare requester and an ashram department are
              asked different questions and priced off different rate scopes, so
              the answer decides which form opens for this login — see
              `FormPicker`. It is not a preference the apply page can talk them
              out of, and the API refuses a request of any other type. */}
          <fieldset
            style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 8 }}
            aria-describedby={noKind ? 'reg-kind-error' : undefined}
          >
            <legend style={{ padding: 0, fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>
              What kind of stall will you be requesting?
              <span aria-hidden style={{ marginLeft: 3, color: 'var(--des-fg)' }}>
                *
              </span>
            </legend>
            <div style={{ fontSize: 12, color: 'var(--mfg)', marginBottom: 4, lineHeight: 1.6 }}>
              This decides which form you fill. If it later turns out to be wrong, the stall team
              can move your account — you do not have to register again.
            </div>
            {REQUEST_FORMS.map((form) => (
              <ChoicePlate
                key={form.type}
                htmlFor={`reg-kind-${form.type}`}
                selected={kind === form.type}
              >
                <Radio
                  id={`reg-kind-${form.type}`}
                  name='reg-kind'
                  value={form.type}
                  checked={kind === form.type}
                  onChange={() => {
                    setKind(form.type);
                    setNoKind(false);
                  }}
                  style={{ marginTop: 1 }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>
                    {FORM_DEFINITIONS[form.type].title.replace(/ Request Form$/, '')}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--mfg)' }}>
                    {form.who}
                  </span>
                  {form.whoTa && (
                    <span
                      className='stalls-tamil'
                      lang='ta'
                      style={{ display: 'block', fontSize: 12, color: 'var(--mfg)' }}
                    >
                      {form.whoTa}
                    </span>
                  )}
                </span>
              </ChoicePlate>
            ))}
            <FieldError
              of={noKind ? 'Please choose the kind of stall you will be requesting.' : undefined}
              id='reg-kind-error'
            />
          </fieldset>

          <FormField
            id='reg-password'
            label={<BilingualLabel en='Password' ta='கடவுச்சொல்' />}
            error={tooShort ? `Please use at least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          >
            <Input
              id='reg-password'
              type='password'
              autoComplete='new-password'
              invalid={tooShort}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (tooShort && e.target.value.length >= MIN_PASSWORD_LENGTH) setTooShort(false);
              }}
            />
          </FormField>

          <Btn
            kind='primary'
            onClick={() => void submit()}
            disabled={busy || !name.trim() || !contact.trim()}
          >
            <Icon name='user' size={14} />
            {busy ? 'Creating…' : 'Create my account'}
          </Btn>
        </form>
      </Card>

      <p style={{ fontSize: 12.5, color: 'var(--mfg)', textAlign: 'center', margin: 0 }}>
        Already have one? <Link to='/stalls/login'>Log In</Link>.
      </p>
    </div>
  );
}

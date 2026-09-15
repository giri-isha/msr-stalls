import { MIN_PASSWORD_LENGTH } from '@msr/stalls';
import { useState } from 'react';
import { Link } from 'react-router';
import { registerRequester } from '../api';
import { BilingualLabel } from '../components/BilingualLabel';
import { Btn, Card, FormField, H1, Icon, Input } from '../ui';

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
 * So the copy carries BOTH outcomes. A returning vendor is not left staring at
 * an inbox that will never have anything in it; they are told, in the same
 * breath as everyone else, that the stall team sets their login up.
 */
export function Register() {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [tooShort, setTooShort] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !name.trim() || !contact.trim()) return;
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
          <div style={{ fontSize: 15, fontWeight: 700, textAlign: 'center' }}>
            Check your email or WhatsApp
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            If we can set up an account for that email address or mobile number, a confirmation link
            is on its way to it. Open the link and you are signed in.
          </p>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            If you have applied for a stall before, your details are already with us and the stall
            team will set your login up for you — please call them.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', textAlign: 'center' }}>
            <Link to='/stalls/login'>Back to log in</Link>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 440, margin: '0 auto' }}>
      <H1 icon={<Icon name='user' size={18} />} sub='You need one before you can request a stall'>
        Create an account
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
            help='We will send your confirmation here, and every letter about your stall.'
          >
            <Input
              id='reg-contact'
              autoComplete='username'
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder='you@example.com or 98765 43210'
            />
          </FormField>

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
        Already have one? <Link to='/stalls/login'>Log in</Link>.
      </p>
    </div>
  );
}

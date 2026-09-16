import { MIN_PASSWORD_LENGTH } from '@stalls/core';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { completePasswordReset, requestPasswordReset } from '../api';
import { BilingualLabel } from '../components/BilingualLabel';
import { useRequester } from '../requester';
import { Btn, Card, FormField, H1, Icon, Input } from '../ui';

/**
 * Both halves of a forgotten password, on one screen.
 *
 * Without a token in the path it asks for the contact and — like every other
 * route on this surface — answers the same panel whether or not anything
 * matched. With a token it takes the new password.
 *
 * ⚠️ TEMPORARY, with the rest of the password login.
 */
export function ResetPassword() {
  const { token } = useParams();
  return token ? <SetNewPassword token={token} /> : <AskForLink />;
}

function AskForLink() {
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !contact.trim()) return;
    setBusy(true);
    try {
      await requestPasswordReset(contact.trim());
    } catch {
      // The panel is the same either way — see `Register`.
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
            If there is a login for that email address or mobile number, a link to set a new
            password is on its way to it.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)', textAlign: 'center' }}>
            <Link to='/stalls/login'>Back to Log In</Link>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 440, margin: '0 auto' }}>
      <H1 icon={<Icon name='key' size={18} />} sub='We will send you a link to set a new one'>
        Forgotten password
      </H1>
      <Card pad={18}>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <FormField
            id='reset-contact'
            label={
              <BilingualLabel en='Email address or mobile number' ta='மின்னஞ்சல் அல்லது கைபேசி எண்' />
            }
          >
            <Input
              id='reset-contact'
              autoFocus
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder='you@example.com or 98765 43210'
            />
          </FormField>
          <Btn kind='primary' onClick={() => void submit()} disabled={busy || !contact.trim()}>
            <Icon name='key' size={14} />
            {busy ? 'Sending…' : 'Send me a link'}
          </Btn>
        </form>
      </Card>
    </div>
  );
}

function SetNewPassword({ token }: { token: string }) {
  const nav = useNavigate();
  const { reload } = useRequester();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setBusy(true);
    setFailed(false);
    try {
      await completePasswordReset(token, password);
      reload();
      nav('/stalls/apply');
    } catch {
      // A used or expired link. Amber rather than red, and no blame: the
      // reader did nothing wrong, the link simply aged out.
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 440, margin: '0 auto' }}>
      <H1 icon={<Icon name='key' size={18} />} sub='Setting it signs you in'>
        Choose a new password
      </H1>
      <Card pad={18}>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <FormField
            id='reset-password'
            label={<BilingualLabel en='New password' ta='புதிய கடவுச்சொல்' />}
            error={tooShort ? `Please use at least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          >
            <Input
              id='reset-password'
              type='password'
              autoFocus
              autoComplete='new-password'
              invalid={tooShort}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (tooShort && e.target.value.length >= MIN_PASSWORD_LENGTH) setTooShort(false);
              }}
            />
          </FormField>

          {failed && (
            <div
              role='alert'
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                padding: '9px 12px',
                borderRadius: 'var(--r2)',
                background: 'var(--warn-t)',
                border: '1px solid var(--warn-b)',
                color: 'var(--warn)',
              }}
            >
              This link is no longer valid. Please{' '}
              <Link to='/stalls/forgot'>ask for a new one</Link>.
            </div>
          )}

          <Btn kind='primary' onClick={() => void submit()} disabled={busy}>
            <Icon name='key' size={14} />
            {busy ? 'Saving…' : 'Set my password'}
          </Btn>
        </form>
      </Card>
    </div>
  );
}

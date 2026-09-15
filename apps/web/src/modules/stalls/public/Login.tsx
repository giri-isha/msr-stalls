import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { loginRequester } from '../api';
import { BilingualLabel } from '../components/BilingualLabel';
import { useRequester } from '../requester';
import { Btn, Card, FormField, H1, Icon, Input } from '../ui';

/**
 * Logging in with a password.
 *
 * ⚠️ TEMPORARY — the host's Isha OIDC replaces this whole screen. See
 * `docs/superpowers/specs/2026-09-15-stalls-vendor-login-design.md`.
 *
 * ⚠️ ONE failure message, whatever went wrong. The API answers the same 401 to
 * an unknown contact, a wrong password and a registration that was never
 * confirmed, and this screen must not be more helpful than that: "we have no
 * account for that number" is exactly the sentence that turns a login box into
 * a way of asking whether a particular shopkeeper has applied.
 */
export function Login() {
  const nav = useNavigate();
  const { reload } = useRequester();
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !contact.trim() || !password) return;
    setBusy(true);
    setFailed(false);
    try {
      await loginRequester({ contact: contact.trim(), password });
      reload();
      nav('/stalls/apply');
    } catch {
      // Every failure, including a transport fault, reads the same. A reader
      // who has genuinely mistyped tries again; nobody learns anything else.
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 440, margin: '0 auto' }}>
      <H1 icon={<Icon name='log-in' size={18} />} sub='Sign in to your stall account'>
        Log in
      </H1>

      <Card pad={18}>
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <FormField
            id='login-contact'
            label={
              <BilingualLabel en='Email address or mobile number' ta='மின்னஞ்சல் அல்லது கைபேசி எண்' />
            }
          >
            <Input
              id='login-contact'
              autoFocus
              autoComplete='username'
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder='you@example.com or 98765 43210'
            />
          </FormField>

          <FormField id='login-password' label={<BilingualLabel en='Password' ta='கடவுச்சொல்' />}>
            <Input
              id='login-password'
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
                background: 'var(--des-t)',
                border: '1px solid var(--des-b)',
                color: 'var(--des-fg)',
              }}
            >
              That email or mobile number and password do not match. Please try again.
            </div>
          )}

          <Btn
            kind='primary'
            onClick={() => void submit()}
            disabled={busy || !contact.trim() || !password}
          >
            <Icon name='log-in' size={14} />
            {busy ? 'Signing in…' : 'Log in'}
          </Btn>
        </form>
      </Card>

      <div
        style={{
          fontSize: 12.5,
          color: 'var(--mfg)',
          textAlign: 'center',
          display: 'grid',
          gap: 6,
        }}
      >
        <div>
          <Link to='/stalls/forgot'>Forgotten your password?</Link>
        </div>
        <div>
          No account yet? <Link to='/stalls/register'>Create one</Link>.
        </div>
        <div>
          Applied before we had logins?{' '}
          <Link to='/stalls/status'>Email me a link to my requests</Link>.
        </div>
      </div>
    </div>
  );
}

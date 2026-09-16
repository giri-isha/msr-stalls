import { useState } from 'react';
import { Link } from 'react-router';
import { requestAccessLink } from '../api';
import { Btn, Card, FormField, H1, Icon, Input } from '../ui';
import { BilingualLabel } from '../components/BilingualLabel';

/**
 * "I applied but I cannot find the email."
 *
 * The requirement asks a vendor to register and log in with an email address or
 * a phone number. This module has no passwords and no OTP — a submission mints
 * a long signed link and the receipt email carries it — so logging in is:
 * name the mailbox or the number you applied under, and the link is sent there.
 *
 * ⚠️ The answer is the same whether or not that contact has ever applied. It
 * has to be: a page that said "no request found" would let anyone ask whether a
 * particular shopkeeper had applied, which is precisely what the signed-link
 * design refuses to answer. The copy is therefore written to be true in both
 * cases rather than reassuring in one.
 */
export function AccessLink() {
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!contact.trim() || busy) return;
    setBusy(true);
    try {
      await requestAccessLink(contact);
    } catch {
      // Even a failure says "sent". The only errors this route can raise are
      // the rate limit and a transport fault, and neither is worth telling a
      // vendor about in words that would also distinguish a real account.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 480, margin: '0 auto' }}>
      <H1 icon={<Icon name='log-in' size={18} />} sub='Already applied?'>
        Find my stall requests
      </H1>

      {sent ? (
        <Card pad={22} style={{ display: 'grid', gap: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Check your email</div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            If we have a stall request under that email address or mobile number, the link to it is
            on its way to the email address on the request.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--mfg)' }}>
            Nothing yet? Check your spam folder, then{' '}
            <button
              type='button'
              onClick={() => setSent(false)}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                font: 'inherit',
                color: 'var(--acc)',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              try another email or number
            </button>
            .
          </p>
        </Card>
      ) : (
        <Card pad={18}>
          {/* A single-field form, so Enter submits it without a submit button —
              `Btn` renders `type='button'` by design and the click path is the
              same call. */}
          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
              Enter the email address or mobile number you applied with. We will email you the link
              to your requests — it shows what is still outstanding and opens any form you still
              have to fill.
            </p>
            <FormField
              id='access-contact'
              label={
                <BilingualLabel en='Email address or mobile number' ta='மின்னஞ்சல் அல்லது கைபேசி எண்' />
              }
            >
              <Input
                id='access-contact'
                autoFocus
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder='you@example.com or 98765 43210'
              />
            </FormField>
            <Btn kind='primary' onClick={() => void submit()} disabled={busy || !contact.trim()}>
              <Icon name='key' size={14} />
              {busy ? 'Sending…' : 'Email me my link'}
            </Btn>
          </form>
        </Card>
      )}

      <p style={{ fontSize: 12.5, color: 'var(--mfg)', textAlign: 'center', margin: 0 }}>
        Not applied yet? <Link to='/stalls/apply'>Start a Stall Request</Link>.
      </p>
    </div>
  );
}

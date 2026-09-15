import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { confirmRegistration } from '../api';
import { useRequester } from '../requester';
import { Card, Icon, Loading } from '../ui';

/**
 * The link from the confirmation message.
 *
 * Following it is the proof that the person holds the contact they registered
 * under — which is the only reason the register route is allowed to answer
 * everyone identically. So it confirms and signs them in, in one step, with
 * nothing to press.
 *
 * ⚠️ A used or expired link is amber, not red, and says nothing about why:
 * single use is deliberate, and a link that has already been followed most
 * often means the reader is on their second tap of the same message.
 */
export function ConfirmRegistration() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const { reload } = useRequester();
  const [failed, setFailed] = useState(false);
  // ⚠️ React 18+ mounts effects twice in development. Confirmation is single
  // use, so the second call would land on an already-revoked link and show a
  // failure on a registration that had just succeeded.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    let alive = true;
    confirmRegistration(token)
      .then(() => {
        if (!alive) return;
        reload();
        nav('/stalls/apply');
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [token, nav, reload]);

  if (!failed) return <Loading />;

  return (
    <Card style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center' }}>
      <div
        style={{
          width: 44,
          height: 44,
          margin: '4px auto 14px',
          borderRadius: '50%',
          background: 'var(--warn-t)',
          border: '1px solid var(--warn-b)',
          color: 'var(--warn)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name='alert-triangle' size={21} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>This link is no longer valid</div>
      <p style={{ fontSize: 13, color: 'var(--mfg)', marginTop: 6, lineHeight: 1.6 }}>
        Confirmation links can only be used once. If you have already confirmed, just log in.
      </p>
      <p style={{ fontSize: 12.5, marginTop: 10 }}>
        <Link to='/stalls/login'>Log in</Link> · <Link to='/stalls/forgot'>Forgotten password</Link>
      </p>
    </Card>
  );
}

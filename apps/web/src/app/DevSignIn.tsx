// SHELL — the standalone stand-in for Isha SSO. Lists the seeded backoffice and
// signs in as one of them with a single click. Discarded at migration; the
// API route it calls exists only outside production.
import { useEffect, useState } from 'react';
import { apiFetch } from '@/modules/stalls/api-client';
import { Card, ErrorBox, Icon, Loading } from '@/modules/stalls/ui';

interface Person {
  personId: string;
  email: string;
  displayName: string;
}

export function DevSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Person[]>('/api/dev/people')
      .then(setPeople)
      .catch((e) => {
        setPeople([]);
        setError((e as Error).message);
      });
  }, []);

  const signIn = async (email: string) => {
    setBusy(email);
    setError(null);
    try {
      await apiFetch('/api/dev/signin', { method: 'POST', json: { email } });
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        minHeight: '100svh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <Card pad={0} style={{ width: '100%', maxWidth: 420, overflow: 'hidden' }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--r3)',
              background: 'var(--pri-t)',
              color: 'var(--pri)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <Icon name='key' size={18} />
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-.4px',
            }}
          >
            Sign in — development
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--mfg)', marginTop: 4, lineHeight: 1.5 }}>
            In the host this is Isha SSO. Here, pick a seeded backoffice member. Run{' '}
            <code
              style={{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                background: 'var(--mut)',
                borderRadius: 'var(--r)',
                padding: '1px 5px',
              }}
            >
              npm run db:seed
            </code>{' '}
            if the list is empty.
          </div>
        </div>

        <div style={{ padding: 14, display: 'grid', gap: 8 }}>
          {people === null && <Loading />}
          {people?.map((p) => (
            <button
              key={p.personId}
              type='button'
              className='stalls-lift'
              disabled={busy !== null}
              onClick={() => signIn(p.email)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '11px 13px',
                borderRadius: 'var(--r2)',
                border: '1px solid var(--bd)',
                background: 'var(--card)',
                color: 'var(--fg)',
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy && busy !== p.email ? 0.5 : 1,
                textAlign: 'left',
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{p.displayName}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--mfg)' }}>
                  {p.email}
                </span>
              </span>
              <Icon name='chevron-right' size={15} />
            </button>
          ))}
          {people?.length === 0 && !error && (
            <div style={{ fontSize: 13, color: 'var(--mfg)' }}>
              Nobody in the backoffice seeded yet.
            </div>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
        </div>
      </Card>
    </div>
  );
}

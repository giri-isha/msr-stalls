// SHELL — the standalone stand-in for Isha SSO. Lists the seeded staff and
// signs in as one of them with a click. Discarded at migration; the API route
// it calls exists only outside production.
import { useEffect, useState } from 'react';
import { apiFetch } from '@/modules/stalls/api-client';
import { Card, ErrorBox, H1 } from '@/modules/stalls/ui/ui';

interface Person {
  personId: string;
  email: string;
  displayName: string;
}

export function DevSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Person[]>('/api/dev/people')
      .then(setPeople)
      .catch((e) => setError((e as Error).message));
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
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <H1 sub='In the host this is Isha SSO. Here, pick a seeded staff member.'>Sign in — development</H1>
        <Card pad={10}>
          <div style={{ display: 'grid', gap: 6 }}>
            {people.map((p) => (
              <button
                type='button'
                key={p.personId}
                disabled={busy !== null}
                onClick={() => signIn(p.email)}
                className='msrs-lift'
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 'var(--r2)',
                  border: '1px solid var(--bd)',
                  background: 'var(--card)',
                  color: 'var(--fg)',
                  cursor: 'pointer',
                  fontSize: 13,
                  textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: 600 }}>{p.displayName}</span>
                <span style={{ fontSize: 12, color: 'var(--mfg)' }}>{p.email}</span>
              </button>
            ))}
            {people.length === 0 && !error && (
              <div style={{ fontSize: 13, color: 'var(--mfg)', padding: 8 }}>
                No staff seeded yet — run <code>npm run db:seed</code>.
              </div>
            )}
            {error && <ErrorBox>{error}</ErrorBox>}
          </div>
        </Card>
      </div>
    </div>
  );
}

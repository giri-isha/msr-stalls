// SHELL — the standalone stand-in for Isha SSO. Lists the seeded staff and
// signs in as one of them with a single click. Discarded at migration; the
// API route it calls exists only outside production.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';

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
      .catch((e) => setError(e.message));
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
    <div className='flex min-h-screen items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Sign in — development</CardTitle>
          <CardDescription>
            In the host this is Isha SSO. Here, pick a seeded staff member. Run{' '}
            <code className='rounded bg-surface-2 px-1'>npm run db:seed</code> if the list is empty.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-2'>
          {people.map((p) => (
            <Button
              key={p.personId}
              variant='outline'
              className='w-full justify-between'
              disabled={busy !== null}
              onClick={() => signIn(p.email)}
            >
              <span>{p.displayName}</span>
              <span className='text-xs text-ink-2'>{p.email}</span>
            </Button>
          ))}
          {people.length === 0 && !error && (
            <p className='text-sm text-ink-2'>No staff seeded yet.</p>
          )}
          {error && (
            <p role='alert' className='text-sm text-bad'>
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

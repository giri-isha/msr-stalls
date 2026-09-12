import { CheckCircle2 } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router';
import { buttonVariants } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';

interface State {
  reference?: string;
  statusToken?: string;
}

export function Submitted() {
  const state = (useLocation().state ?? {}) as State;
  if (!state.reference || !state.statusToken) return <Navigate to='/stalls/apply' replace />;
  const statusPath = `/stalls/status/${state.statusToken}`;
  return (
    <div className='mx-auto max-w-lg space-y-5 py-6 text-center'>
      <CheckCircle2 className='mx-auto h-12 w-12 text-good' />
      <div>
        <h1 className='text-2xl font-bold'>Request received</h1>
        <p className='mt-1 text-sm text-ink-2'>
          Your reference is{' '}
          <span className='font-mono font-semibold text-ink'>{state.reference}</span>. A copy has
          been emailed to you.
        </p>
      </div>
      <Card>
        <CardContent className='space-y-3 p-5 text-left text-sm'>
          <p>
            Submission does not guarantee allocation. The Isha Stall Team will review all requests
            and inform selected stalls by email.
          </p>
          <p>
            You can check your status at any time using the private link below — it is also in your
            email. Please do not share it.
          </p>
          <Link
            to={statusPath}
            className={buttonVariants({ variant: 'outline', className: 'w-full' })}
          >
            Open my status page
          </Link>
        </CardContent>
      </Card>
      <Link to='/stalls/apply' className='text-sm text-accent underline-offset-4 hover:underline'>
        Submit another request
      </Link>
    </div>
  );
}

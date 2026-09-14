import { Link, Navigate, useLocation } from 'react-router';
import { Card, H1 } from '../ui/ui';
import { Icon } from '../ui/icons';

interface State {
  reference?: string;
  statusToken?: string;
}

export function Submitted() {
  const state = (useLocation().state ?? {}) as State;
  if (!state.reference || !state.statusToken) return <Navigate to='/stalls/apply' replace />;
  const statusPath = `/stalls/status/${state.statusToken}`;
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0 16px', color: 'var(--ok)' }}>
        <Icon name='circle-check' size={44} strokeWidth={1.6} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <H1
          sub={
            <>
              Your reference is <b style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--fg)' }}>{state.reference}</b>. A
              copy has been emailed to you.
            </>
          }
        >
          Request received
        </H1>
      </div>
      <Card>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>
            Submission does not guarantee allocation. The Isha Stall Team will review all requests and inform selected
            stalls by email.
          </p>
          <p style={{ margin: 0 }}>
            You can check your status at any time using the private link below — it is also in your email. Please do
            not share it.
          </p>
          <Link
            to={statusPath}
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '10px 14px',
              borderRadius: 'var(--r2)',
              border: '1px solid var(--bd)',
              background: 'var(--card)',
              color: 'var(--fg)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Open my status page
          </Link>
        </div>
      </Card>
      <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>
        <Link to='/stalls/apply'>Submit another request</Link>
      </p>
    </div>
  );
}

import { Link, Navigate, useLocation } from 'react-router';
import { Card, Icon } from '../ui';

interface State {
  reference?: string;
  statusToken?: string;
}

export function Submitted() {
  const state = (useLocation().state ?? {}) as State;
  if (!state.reference || !state.statusToken) return <Navigate to='/stalls/apply' replace />;

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
      {/* ⚠️ The tone's TINT behind the tone's accent, not a solid green disc.
          A glyph is an icon rather than text, so the accent is legal on the
          tint here — and the tint is what keeps a 56px circle from reading as
          an alert on a page that is only good news. */}
      <div
        style={{
          width: 56,
          height: 56,
          margin: '6px auto 16px',
          borderRadius: '50%',
          background: 'var(--ok-t)',
          border: '1px solid var(--ok-b)',
          color: 'var(--ok)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name='circle-check' size={28} />
      </div>

      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-.5px',
          lineHeight: 1.15,
        }}
      >
        Request received
      </div>
      <p style={{ fontSize: 13.5, color: 'var(--mfg)', marginTop: 6, lineHeight: 1.6 }}>
        Your reference is{' '}
        <span
          style={{
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontWeight: 700,
            color: 'var(--fg)',
          }}
        >
          {state.reference}
        </span>
        . A copy has been emailed to you.
      </p>

      <Card style={{ marginTop: 20, textAlign: 'left' }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65 }}>
          Submission does not guarantee allocation. The Isha Stall Team will review all requests and
          inform selected stalls by email.
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.65 }}>
          You can check your status at any time from your requests page. The same page opens from
          the private link in your email — please do not share that link.
        </p>
        {/* ⚠️ An anchor styled as the primary button, not a `Btn` with a
            navigate handler. This is the one thing the page exists to hand over,
            and a real link is what can be middle-clicked, copied, and reached by
            a reader who navigates by links. */}
        <Link
          to='/stalls/requests'
          className='msrs-lift'
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            marginTop: 16,
            padding: '11px 14px',
            borderRadius: 'var(--r2)',
            background: 'var(--pri)',
            color: 'var(--pfg)',
            boxShadow: 'var(--sh-pri)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Icon name='eye' size={15} />
          Open my requests
        </Link>
      </Card>

      <Link
        to='/stalls/apply'
        style={{ display: 'inline-block', marginTop: 18, fontSize: 13, fontWeight: 600 }}
      >
        Submit another request
      </Link>
    </div>
  );
}

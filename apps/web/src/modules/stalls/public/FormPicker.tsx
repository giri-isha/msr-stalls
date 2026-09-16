import { FORM_DEFINITIONS, type StallRequestType } from '@stalls/core';
import { Link } from 'react-router';
import { useRequester } from '../requester';
import { Btn, card, Card, H1, Icon, Loading } from '../ui';
import { REQUEST_FORMS, type RequestFormRoute, TYPE_SLUG } from './request-forms';

/**
 * The forms — behind an account, and narrowed to the one that account is for.
 *
 * ⚠️ Signed out, the tiles are still DRAWN, just not links. An applicant
 * deciding whether to sign up needs to see what they would be signing up for;
 * a bare login wall in front of unnamed forms asks them to take it on trust.
 * The gate sits above them, not instead of them.
 *
 * 🔴 Signed IN, only the account's OWN form opens. A requester registers as a
 * trader, a local welfare requester or an ashram department, and the three are
 * asked different questions and priced off different rate scopes — so which
 * one a request is cannot be a choice made on this page. The other two tiles
 * stay on screen, locked and saying why: a department that registered as a
 * vendor by mistake needs to see that the form they want exists and that the
 * fix is a phone call, not a tile that has silently vanished.
 *
 * The account requirement is TEMPORARY in mechanism only — a password now, the
 * host's Isha OIDC later. What is not temporary is that a request belongs to a
 * session rather than to an address typed into the form.
 */
export function FormPicker() {
  const { requester, status } = useRequester();

  if (status === 'loading') return <Loading />;
  const signedIn = requester !== null;
  // Null for an account that has never applied and pre-dates the question —
  // nothing has decided yet, so all three are open. See `resolveRequesterType`.
  const mine = requester?.requesterType ?? null;
  const ownForm = mine ? REQUEST_FORMS.find((f) => f.type === mine) : undefined;

  return (
    <div>
      <H1
        icon={<Icon name='ticket' size={18} />}
        sub='Submission does not guarantee allocation. Allocation is at the sole discretion of the Isha Stall Team.'
      >
        Request a Stall
      </H1>

      {!signedIn && (
        <Card pad={20} style={{ display: 'grid', gap: 12, textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            To request a stall you need an account
          </div>
          <p
            style={{
              margin: '0 auto',
              maxWidth: 520,
              fontSize: 13.5,
              color: 'var(--mfg)',
              lineHeight: 1.6,
            }}
          >
            It keeps your requests together and lets you come back to see where each one has got to,
            and which forms are still waiting on you.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to='/stalls/register' style={{ color: 'inherit' }}>
              <Btn kind='primary'>
                <Icon name='user' size={14} />
                Create an Account
              </Btn>
            </Link>
            <Link to='/stalls/login' style={{ color: 'inherit' }}>
              <Btn>
                <Icon name='log-in' size={14} />
                Log In
              </Btn>
            </Link>
          </div>
        </Card>
      )}

      {ownForm && (
        // What this account may fill, said before the tiles rather than left to
        // be inferred from which of them is greyed out.
        <p style={{ fontSize: 12.5, color: 'var(--mfg)', margin: '0 0 14', lineHeight: 1.6 }}>
          Your account is registered for{' '}
          <strong style={{ color: 'var(--fg)' }}>
            {ownForm.who.replace(/ —.*$/, '').toLowerCase()}
          </strong>
          . If that is not right, please contact the stall team — they can move your account rather
          than have you register a second time.
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
          gap: 14,
        }}
      >
        {REQUEST_FORMS.map((form) => {
          // Open when this is the account's own form, or when nothing has
          // decided yet. Everything else is drawn and locked.
          const open = signedIn && (mine === null || mine === form.type);
          if (open) {
            return (
              <Link key={form.type} to={TYPE_SLUG[form.type]} style={{ color: 'inherit' }}>
                <Tile form={form} />
              </Link>
            );
          }
          return (
            // ⚠️ Not a disabled link — no link at all. An anchor that goes
            // nowhere is still announced as one, and a reader on a screen
            // reader would be told there are destinations here when there
            // are none. It is not `aria-hidden` either, once there is a REASON
            // to read: "not your form" is the very thing such a reader needs.
            <div
              key={form.type}
              style={{ opacity: 0.55 }}
              aria-hidden={signedIn ? undefined : true}
            >
              <Tile form={form} locked={signedIn} />
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 20, lineHeight: 1.6 }}>
        Already submitted?{' '}
        {signedIn ? (
          <>
            <Link to='/stalls/requests'>My Requests</Link> has every request on this account, what
            has been decided, and which forms are still waiting on you.
          </>
        ) : (
          <>
            Use the link in your confirmation email to check your status — or{' '}
            <Link to='/stalls/status'>have it emailed to you again</Link>.
          </>
        )}
      </p>
    </div>
  );
}

/** One form's tile.
 *
 *  ⚠️ The `card` STYLE rather than the `Card` component, because the tile needs
 *  the hover lift and `Card` only wears it in its actionable form — which is a
 *  focusable div with role="button", and nesting one inside the anchor that
 *  wraps this would announce the same destination twice and put two tab stops
 *  on one tile. */
function Tile({ form, locked }: { form: RequestFormRoute; locked?: boolean }) {
  return (
    <div
      className={locked ? undefined : 'stalls-lift'}
      style={{
        ...card,
        padding: 16,
        height: '100%',
        display: 'flex',
        gap: 13,
        alignItems: 'center',
        cursor: locked ? 'default' : 'pointer',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--r3)',
          background: form.tint,
          color: 'var(--fg)',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={form.glyph} size={19} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
          {FORM_DEFINITIONS[form.type as StallRequestType].title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3 }}>{form.who}</div>
        {form.whoTa && (
          <div
            className='stalls-tamil'
            lang='ta'
            style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 1 }}
          >
            {form.whoTa}
          </div>
        )}
      </div>
      <Icon name={locked ? 'lock' : 'chevron-right'} size={16} color='var(--mfg)' />
    </div>
  );
}

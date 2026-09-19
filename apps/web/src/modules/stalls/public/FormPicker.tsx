import {
  canFileMore,
  FORM_DEFINITIONS,
  type RequesterAllowance,
  type StallRequestType,
} from '@stalls/core';
import { Link } from 'react-router';
import { useRequester } from '../requester';
import { Btn, card, Card, H1, Icon, Loading } from '../ui';
import { REQUEST_FORMS, type RequestFormRoute, TYPE_SLUG } from './request-forms';

/**
 * The forms — behind an account, and narrowed to the one that account is for.
 *
 * ⚠️ Signed out, all three tiles are DRAWN, just not links. An applicant
 * deciding whether to sign up needs to see what they would be signing up for;
 * a bare login wall in front of unnamed forms asks them to take it on trust.
 * The gate sits above them, not instead of them.
 *
 * 🔴 Signed IN, the account's own form is the ONLY one on the page. A requester
 * registers as a trader, a local welfare requester or an ashram department, and
 * the three are asked different questions and priced off different rate scopes
 * — so which one a request is cannot be a choice made on this page.
 *
 * 🔴 The other two used to be drawn and locked, so that a department registered
 * as a vendor by mistake could see that the form they want exists. The sentence
 * above the tiles says that in words now — what the account is registered for,
 * and that the team can move it — and two greyed-out cards beside it were the
 * same fact said again in a form that reads as a choice being withheld. One
 * tile and one sentence; nothing to try to click.
 *
 * 🔴 And nothing at all once the edition's cap is spent. `canFileMore` reads
 * the same count the submit path refuses on, so this page and the post cannot
 * disagree about whether there is a form here to fill.
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
  // ⚠️ `?? null` for a page served ahead of an API that does not send the
  // allowance yet — `canFileMore` reads null as "not capped", so deploy skew
  // leaves the forms offered rather than hiding them.
  const allowance = requester?.allowance ?? null;
  const spent = signedIn && !canFileMore(allowance);
  // Signed out, all three; signed in, the one this account is for — or all
  // three for an account that pre-dates the question and has decided nothing.
  const shown = ownForm ? [ownForm] : REQUEST_FORMS;

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

      {ownForm && !spent && (
        // What this account may fill, and — now that the other two tiles are
        // gone — the whole of how somebody registered as the wrong one is put
        // right. This sentence is the fix, so it does not get to be optional.
        <p style={{ fontSize: 12.5, color: 'var(--mfg)', margin: '0 0 14', lineHeight: 1.6 }}>
          Your account is registered for{' '}
          <strong style={{ color: 'var(--fg)' }}>
            {ownForm.who.replace(/ —.*$/, '').toLowerCase()}
          </strong>
          . If that is not right, please contact the stall team — they can move your account rather
          than have you register a second time.
        </p>
      )}

      {spent ? (
        <CapReached allowance={allowance} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
            gap: 14,
          }}
        >
          {shown.map((form) => {
            // Open when this is the account's own form, or when nothing has
            // decided yet. Signed out, the tile is drawn and is not a link.
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
              // are none.
              <div key={form.type} style={{ opacity: 0.55 }} aria-hidden>
                <Tile form={form} />
              </div>
            );
          })}
        </div>
      )}

      {/* Signed in, the header carries the way to the requests page; a second
          sentence about it here said the same thing twice. */}
      {!signedIn && (
        <p style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 20, lineHeight: 1.6 }}>
          Already submitted? Use the link in your confirmation email to check your status.
        </p>
      )}
    </div>
  );
}

/**
 * The account has filed as many requests as this edition allows.
 *
 * ⚠️ It says the FIGURES and the words the refusal uses — "2 of 2 still open" —
 * rather than "you cannot request a stall". A cap that names itself is one a
 * requester can act on: a rejection or a cancellation may free a slot, and
 * which of their requests are being counted is the thing that decides whether
 * waiting helps. `countedAs` comes from the API so this sentence and the one
 * the post would refuse with cannot word the same rule differently.
 */
function CapReached({ allowance }: { allowance: RequesterAllowance | null }) {
  if (!allowance) return null;
  return (
    <Card pad={20} style={{ display: 'grid', gap: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>
        You have as many requests as this year allows
      </div>
      <p
        style={{
          margin: '0 auto',
          maxWidth: 560,
          fontSize: 13.5,
          color: 'var(--mfg)',
          lineHeight: 1.6,
        }}
      >
        {allowance.used} of {allowance.max} {allowance.countedAs}. Ground in another bay is a
        separate request, so the stall team can accept one and decline another — if you need more
        than this, please talk to them rather than registering a second account.
      </p>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Link to='/stalls/requests' style={{ color: 'inherit' }}>
          <Btn>
            <Icon name='layout-grid' size={14} />
            See Your Requests
          </Btn>
        </Link>
      </div>
    </Card>
  );
}

/** One form's tile.
 *
 *  ⚠️ The `card` STYLE rather than the `Card` component, because the tile needs
 *  the hover lift and `Card` only wears it in its actionable form — which is a
 *  focusable div with role="button", and nesting one inside the anchor that
 *  wraps this would announce the same destination twice and put two tab stops
 *  on one tile. */
function Tile({ form }: { form: RequestFormRoute }) {
  return (
    <div
      className='stalls-lift'
      style={{
        ...card,
        padding: 16,
        height: '100%',
        display: 'flex',
        gap: 13,
        alignItems: 'center',
        cursor: 'pointer',
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
      <Icon name='chevron-right' size={16} color='var(--mfg)' />
    </div>
  );
}

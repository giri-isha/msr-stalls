import { FORM_DEFINITIONS, type StallRequestType } from '@msr/stalls';
import { Link } from 'react-router';
import { useRequester } from '../requester';
import { Btn, card, Card, H1, Icon, Loading } from '../ui';

export const TYPE_SLUG: Record<StallRequestType, string> = {
  VENDOR: 'vendor',
  LOCAL_WELFARE: 'local-welfare',
  ASHRAM: 'ashram',
  ASHRAM_FOOD: 'ashram-food',
};
export const SLUG_TYPE: Record<string, StallRequestType> = Object.fromEntries(
  Object.entries(TYPE_SLUG).map(([t, s]) => [s, t as StallRequestType]),
);

/**
 * Who each form is for, and the glyph that says it at a glance.
 *
 * ⚠️ The tints are the `--<tone>-t` family, not the `--av*` avatar plates. A
 * tone tint is light in the light theme and dark in the dark one, so the glyph
 * on it takes `--fg` and stays readable in both — the rule `NavTileCard`'s
 * header spells out. An `--av*` plate is dark in BOTH and would need white.
 */
const BLURB: Record<
  StallRequestType,
  { who: string; whoTa: string | null; glyph: string; tint: string }
> = {
  VENDOR: {
    who: 'External food and retail vendors',
    whoTa: 'வெளி விற்பனையாளர்கள்',
    glyph: 'ticket',
    tint: 'var(--pri-t)',
  },
  LOCAL_WELFARE: {
    who: 'Local welfare and community stalls',
    whoTa: null,
    glyph: 'users',
    tint: 'var(--teal-t)',
  },
  ASHRAM: {
    who: 'Ashram departments — display and sales',
    whoTa: null,
    glyph: 'layout-grid',
    tint: 'var(--violet-t)',
  },
  ASHRAM_FOOD: {
    who: 'Ashram departments — food stalls',
    whoTa: null,
    glyph: 'layers',
    tint: 'var(--gold-t)',
  },
};

/**
 * The four forms — behind an account.
 *
 * ⚠️ Signed out, the tiles are still DRAWN, just not links. An applicant
 * deciding whether to sign up needs to see what they would be signing up for;
 * a bare login wall in front of four unnamed forms asks them to take it on
 * trust. The gate sits above them, not instead of them.
 *
 * The account requirement is TEMPORARY in mechanism only — a password now, the
 * host's Isha OIDC later. What is not temporary is that a request belongs to a
 * session rather than to an address typed into the form.
 */
export function FormPicker() {
  const order: StallRequestType[] = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'];
  const { requester, status } = useRequester();

  if (status === 'loading') return <Loading />;
  const signedIn = requester !== null;

  return (
    <div>
      <H1 sub='Choose the form that matches who you are. Submission does not guarantee allocation.'>
        Request a stall
      </H1>

      {!signedIn && (
        <Card pad={18} style={{ display: 'grid', gap: 12, textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            To request a stall you need an account
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
            It keeps your requests together and lets you come back to see where each one has got to,
            and which forms are still waiting on you.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to='/stalls/register' style={{ color: 'inherit' }}>
              <Btn kind='primary'>
                <Icon name='user' size={14} />
                Create an account
              </Btn>
            </Link>
            <Link to='/stalls/login' style={{ color: 'inherit' }}>
              <Btn>
                <Icon name='log-in' size={14} />
                Log in
              </Btn>
            </Link>
          </div>
        </Card>
      )}

      {signedIn && (
        // ⚠️ A link, not a count. A number would mean a second fetch on a page
        // that makes one, to decorate a destination that renders the count
        // anyway — and this page has to stay cheap for readers who are only
        // deciding whether to sign up.
        <p style={{ fontSize: 12.5, marginBottom: 14 }}>
          <Link to='/stalls/requests'>View your requests</Link> — what has been decided, and which
          forms are still waiting on you.
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
          gap: 12,
        }}
      >
        {order.map((t) =>
          signedIn ? (
            <Link key={t} to={TYPE_SLUG[t]} style={{ color: 'inherit' }}>
              <Tile type={t} />
            </Link>
          ) : (
            // ⚠️ Not a disabled link — no link at all. An anchor that goes
            // nowhere is still announced as one, and a reader on a screen
            // reader would be told there are four destinations here when there
            // are none.
            <div key={t} style={{ opacity: 0.55 }} aria-hidden='true'>
              <Tile type={t} />
            </div>
          ),
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 18, lineHeight: 1.6 }}>
        Already submitted? Use the link in your confirmation email to check your status — or{' '}
        <Link to='/stalls/status'>have it emailed to you again</Link>.
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
function Tile({ type }: { type: StallRequestType }) {
  const b = BLURB[type];
  return (
    <div
      className='msrs-lift'
      style={{
        ...card,
        padding: 15,
        height: '100%',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 'var(--r3)',
          background: b.tint,
          color: 'var(--fg)',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={b.glyph} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
          {FORM_DEFINITIONS[type].title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3 }}>{b.who}</div>
        {b.whoTa && (
          <div
            className='msrs-tamil'
            lang='ta'
            style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 1 }}
          >
            {b.whoTa}
          </div>
        )}
      </div>
      <Icon name='chevron-right' size={16} color='var(--mfg)' />
    </div>
  );
}

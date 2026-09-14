import { FORM_DEFINITIONS, type StallRequestType } from '@msr/stalls';
import { Link } from 'react-router';
import { card, H1, Icon } from '../ui';

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

export function FormPicker() {
  const order: StallRequestType[] = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'];
  return (
    <div>
      <H1 sub='Choose the form that matches who you are. Submission does not guarantee allocation.'>
        Request a stall
      </H1>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
          gap: 12,
        }}
      >
        {order.map((t) => {
          const b = BLURB[t];
          return (
            <Link key={t} to={TYPE_SLUG[t]} style={{ color: 'inherit' }}>
              {/* ⚠️ The `card` STYLE rather than the `Card` component, because
                  the tile needs the hover lift and `Card` only wears it in its
                  actionable form — which is a focusable div with role="button",
                  and nesting one inside this anchor would announce the same
                  destination twice and put two tab stops on one tile. */}
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
                    {FORM_DEFINITIONS[t].title}
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
            </Link>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 18, lineHeight: 1.6 }}>
        Already submitted? Use the link in your confirmation email to check your status — or{' '}
        <Link to='/stalls/status'>have it emailed to you again</Link>.
      </p>
    </div>
  );
}

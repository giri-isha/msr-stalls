import { FORM_DEFINITIONS, type StallRequestType } from '@msr/stalls';
import { useNavigate } from 'react-router';
import { Card, H1 } from '../ui/ui';
import { Icon } from '../ui/icons';

export const TYPE_SLUG: Record<StallRequestType, string> = {
  VENDOR: 'vendor',
  LOCAL_WELFARE: 'local-welfare',
  ASHRAM: 'ashram',
  ASHRAM_FOOD: 'ashram-food',
};
export const SLUG_TYPE: Record<string, StallRequestType> = Object.fromEntries(
  Object.entries(TYPE_SLUG).map(([t, s]) => [s, t as StallRequestType]),
);

const BLURB: Record<StallRequestType, { who: string; whoTa: string | null; icon: string }> = {
  VENDOR: { who: 'External food and retail vendors', whoTa: 'வெளி விற்பனையாளர்கள்', icon: 'users' },
  LOCAL_WELFARE: { who: 'Local welfare and community stalls', whoTa: null, icon: 'heart-handshake' },
  ASHRAM: { who: 'Ashram departments — display and sales', whoTa: null, icon: 'home' },
  ASHRAM_FOOD: { who: 'Ashram departments — food stalls', whoTa: null, icon: 'home' },
};

export function FormPicker() {
  const navigate = useNavigate();
  const order: StallRequestType[] = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'];
  return (
    <div>
      <H1 sub='Choose the form that matches who you are. Submission does not guarantee allocation.'>
        Request a stall
      </H1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
        {order.map((t) => (
          <Card key={t} onAct={() => navigate(TYPE_SLUG[t])} label={FORM_DEFINITIONS[t].title}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 'var(--r3)',
                  background: 'var(--pri-t)',
                  color: 'var(--pri)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                <Icon name={BLURB[t].icon} size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{FORM_DEFINITIONS[t].title}</div>
                <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 2 }}>
                  {BLURB[t].who}
                  {BLURB[t].whoTa && (
                    <>
                      {' / '}
                      <span className='msrs-ta' lang='ta'>
                        {BLURB[t].whoTa}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Icon name='chevron-right' size={16} color='var(--mfg)' />
            </div>
          </Card>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 18 }}>
        Already submitted? Use the link in your confirmation email to check your status.
      </p>
    </div>
  );
}

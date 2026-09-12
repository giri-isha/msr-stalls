import { FORM_DEFINITIONS, type StallRequestType } from '@msr/stalls';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '../../../components/ui/card';

export const TYPE_SLUG: Record<StallRequestType, string> = {
  VENDOR: 'vendor',
  LOCAL_WELFARE: 'local-welfare',
  ASHRAM: 'ashram',
  ASHRAM_FOOD: 'ashram-food',
};
export const SLUG_TYPE: Record<string, StallRequestType> = Object.fromEntries(
  Object.entries(TYPE_SLUG).map(([t, s]) => [s, t as StallRequestType]),
);

const BLURB: Record<StallRequestType, { who: string; whoTa: string | null }> = {
  VENDOR: { who: 'External food and retail vendors', whoTa: 'வெளி விற்பனையாளர்கள்' },
  LOCAL_WELFARE: { who: 'Local welfare and community stalls', whoTa: null },
  ASHRAM: { who: 'Ashram departments — display and sales', whoTa: null },
  ASHRAM_FOOD: { who: 'Ashram departments — food stalls', whoTa: null },
};

export function FormPicker() {
  const order: StallRequestType[] = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'];
  return (
    <div className='space-y-5'>
      <div>
        <h1 className='text-2xl font-bold'>Request a stall</h1>
        <p className='mt-1 text-sm text-ink-2'>
          Choose the form that matches who you are. Submission does not guarantee allocation.
        </p>
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        {order.map((t) => (
          <Link key={t} to={TYPE_SLUG[t]} className='group'>
            <Card className='flex h-full items-center justify-between p-4 transition-colors group-hover:border-accent'>
              <div>
                <div className='font-semibold'>{FORM_DEFINITIONS[t].title}</div>
                <div className='mt-0.5 text-xs text-ink-2'>{BLURB[t].who}</div>
              </div>
              <ChevronRight className='h-4 w-4 text-ink-3' />
            </Card>
          </Link>
        ))}
      </div>
      <p className='text-xs text-ink-3'>
        Already submitted? Use the link in your confirmation email to check your status.
      </p>
    </div>
  );
}

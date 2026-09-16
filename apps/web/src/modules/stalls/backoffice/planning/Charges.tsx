import { useEffect, useState } from 'react';
import * as api from '../../api';
import { Grid, type PanelProps, RupeeInput } from '../../components/config';
import { Panel } from '../../components/Panel';
import { Btn, FormField, Icon, Input } from '../../ui';
import { CopyAction } from '../CopyFromDialog';

export function Charges({ c, writable, run, reload }: PanelProps) {
  const [v, setV] = useState(c.charges);
  useEffect(() => setV(c.charges), [c.charges]);
  const f = (k: keyof typeof v) => ({
    paise: v[k] as number,
    onPaise: (p: number) => setV({ ...v, [k]: p }),
    disabled: !writable,
  });
  return (
    <Panel
      title='Charges and Deposits'
      actions={<CopyAction section='charges' writable={writable} onCopied={reload} />}
      note='The 2025 forms quoted three different chair and table rates — to ashram departments, to local welfare stalls and to vendors. All three are kept, because they are what was charged. The refundable advance is not here: it is set per bay, beside that bay’s rent.'
      footer={
        <Btn
          kind='primary'
          disabled={!writable}
          onClick={() =>
            run('Charges saved', () => {
              const { id: _id, editionId: _e, ...body } = v;
              return api.putCharges(body);
            })
          }
        >
          <Icon name='check' size={14} />
          Save Charges
        </Btn>
      }
    >
      <Grid>
        <RupeeInput id='chair' label='Chair / Day (Ashram)' {...f('chairRatePaise')} />
        <RupeeInput id='table' label='Table / Day (Ashram)' {...f('tableRatePaise')} />
        <RupeeInput id='lwchair' label='Chair / Day (Local Welfare)' {...f('lwChairRatePaise')} />
        <RupeeInput id='lwtable' label='Table / Day (Local Welfare)' {...f('lwTableRatePaise')} />
        <RupeeInput id='vchair' label='Chair / Day (Vendor)' {...f('vendorChairRatePaise')} />
        <RupeeInput id='vtable' label='Table / Day (Vendor)' {...f('vendorTableRatePaise')} />
        <RupeeInput
          id='chairrep'
          label='Chair Replacement (Not Returned)'
          {...f('chairReplacementPaise')}
        />
        <RupeeInput
          id='tablerep'
          label='Table Replacement (Not Returned)'
          {...f('tableReplacementPaise')}
        />
        <RupeeInput id='p5' label='Extra 5 A Plug Point' {...f('plug5aRatePaise')} />
        <RupeeInput id='p15' label='15 A Plug Point' {...f('plug15aRatePaise')} />
        <FormField id='gst' label='GST %'>
          <Input
            id='gst'
            type='number'
            min={0}
            max={100}
            value={v.gstPercent}
            disabled={!writable}
            onChange={(e) => setV({ ...v, gstPercent: Number(e.target.value) || 0 })}
          />
        </FormField>
        {/* Chairs and tables are billed per day, so the number of days is part
            of the bill and not a fact about the calendar. Editing it re-prices
            every furniture line that has not been frozen onto a payment letter. */}
        <RupeeInput
          id='ctdep'
          label='Furniture Deposit (Flat, Once)'
          {...f('chairTableDepositPaise')}
        />
        <RupeeInput id='damage' label='Damage Penalty' {...f('damagePenaltyPaise')} />
        <FormField id='days' label='Days Furniture Is Held (Billing)'>
          <Input
            id='days'
            type='number'
            min={1}
            max={30}
            value={v.equipmentDays}
            disabled={!writable}
            onChange={(e) => setV({ ...v, equipmentDays: Number(e.target.value) || 1 })}
          />
        </FormField>
        <FormField id='cps2' label='People per Stall (Planning)'>
          <Input
            id='cps2'
            type='number'
            min={1}
            value={v.crowdPerStall}
            disabled={!writable}
            onChange={(e) => setV({ ...v, crowdPerStall: Number(e.target.value) || 1 })}
          />
        </FormField>
      </Grid>
    </Panel>
  );
}

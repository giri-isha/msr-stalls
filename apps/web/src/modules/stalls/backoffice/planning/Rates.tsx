import type { RateCardEntry, RateScope } from '@stalls/core';
import { formatInr } from '@stalls/core';
import { Fragment, useEffect, useState } from 'react';
import * as api from '../../api';
import { Grid, type PanelProps, RupeeInput } from '../../components/config';
import { Panel } from '../../components/Panel';
import {
  Btn,
  Dialog,
  DialogButtons,
  EditBtn,
  Icon,
  RowActions,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  toolBtnStyle,
} from '../../ui';
import { CopyAction } from '../CopyFromDialog';

/**
 * The rent matrix: one row per bay, four figures each.
 *
 * The old panel edited four numbers against two bands — "A4/B3/B4" and
 * "C1/C2" — which is how the printed form quotes it but not how the ground
 * works. Two bays that happen to share a letter are a different proposition
 * (a VIP bay behind Adiyogi against a general-seating bay) and could never be
 * priced apart. Worse, the bays closed to trade had no row at all, so the VAP
 * traders who pay the most of any local welfare stall were unbillable.
 *
 * ⚠️ Local welfare is its OWN scope, not a discount. The same ground is quoted
 * one figure to a trader and a lower one to a village welfare requester,
 * because the second is a contribution rather than a market price. A bay closed
 * to vendors still takes local welfare figures — that is the whole point.
 *
 * ⚠️ The advance rides on the rate row, so it is area-wise too: "keep the
 * advance also area wise — it might be 3000, and for the free area it might be
 * only 2000". Rent and advance are edited together here and cannot drift apart.
 */
export function Rates({ c, writable, run, reload }: PanelProps) {
  const [entries, setEntries] = useState<RateCardEntry[]>(c.rateCard);
  const [isFood, setIsFood] = useState(true);
  const [editing, setEditing] = useState<api.BackofficeConfig['zones'][number] | null>(null);
  useEffect(() => setEntries(c.rateCard), [c.rateCard]);

  const row = (zoneCode: string, scope: RateScope) =>
    entries.find((e) => e.zoneCode === zoneCode && e.isFood === isFood && e.scope === scope) ??
    null;

  const set = (zoneCode: string, scope: RateScope, patch: Partial<RateCardEntry>) =>
    setEntries((es) => {
      const i = es.findIndex(
        (e) => e.zoneCode === zoneCode && e.isFood === isFood && e.scope === scope,
      );
      if (i >= 0) {
        const next = [...es];
        next[i] = { ...next[i], ...patch };
        return next;
      }
      return [...es, { zoneCode, isFood, scope, amountPaise: 0, depositPaise: 0, ...patch }];
    });

  // A row left at zero rent is not a free stall — it is a bay this scope does
  // not price. Dropping it is what makes the form say "not available this
  // year" rather than quoting nothing and taking the booking anyway.
  const priced = entries.filter((e) => e.amountPaise > 0);

  return (
    <Panel
      title='Stall Rent and Advance'
      note='Per stall, before GST, for each bay. A bay left at zero is not priced at that scope and the form will not offer it. The advance is refundable and is set per bay beside the rent.'
      actions={<CopyAction section='rates' writable={writable} onCopied={reload} />}
      footer={
        <Btn
          kind='primary'
          disabled={!writable}
          onClick={() => run('Rates saved', () => api.putRateCard(priced))}
        >
          <Icon name='check' size={14} />
          Save Rates
        </Btn>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Food', value: true },
          { label: 'Non-Food', value: false },
        ].map((t) => (
          <button
            key={t.label}
            type='button'
            aria-pressed={isFood === t.value}
            onClick={() => setIsFood(t.value)}
            style={toolBtnStyle(isFood === t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Bay</TH>
            <TH align='right'>Vendor Rent</TH>
            <TH align='right'>Vendor Advance</TH>
            <TH align='right'>Local Welfare Rent</TH>
            <TH align='right'>Local Welfare Advance</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {c.zones.map((z) => (
            <TR key={z.id}>
              <TD>
                <span style={{ fontWeight: 600 }}>{z.code}</span>
                <span style={{ color: 'var(--mfg)', marginLeft: 8, fontSize: 12 }}>{z.name}</span>
              </TD>
              {(['VENDOR', 'LOCAL_WELFARE'] as const).map((scope) => {
                // ⚠️ `--mfg`, not a warning colour. A bay the trade cannot have
                // is an absence, not a mistake somebody made.
                const closedToTrade = scope === 'VENDOR' && z.isClosedToVendors;
                const r = row(z.code, scope);
                return closedToTrade ? (
                  <TD key={scope} align='right' colSpan={2} muted>
                    Closed to Trade
                  </TD>
                ) : (
                  <Fragment key={scope}>
                    <TD align='right'>
                      <Money paise={r?.amountPaise ?? 0} />
                    </TD>
                    <TD align='right'>
                      <Money paise={r?.depositPaise ?? 0} />
                    </TD>
                  </Fragment>
                );
              })}
              <TD align='right'>
                <RowActions>
                  <EditBtn
                    what={`${z.code} ${isFood ? 'food' : 'non-food'} rates`}
                    writable={writable}
                    onClick={() => setEditing(z)}
                  />
                </RowActions>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {editing && (
        <RateDialog
          z={editing}
          isFood={isFood}
          vendor={row(editing.code, 'VENDOR')}
          localWelfare={row(editing.code, 'LOCAL_WELFARE')}
          onApply={(scope, patch) => set(editing.code, scope, patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

/** A figure in the rent grid. Zero is not "₹0" — a bay left at zero is one this
 *  scope does not price, and it is dropped on save rather than quoted free. */
function Money({ paise }: { paise: number }) {
  return paise > 0 ? (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatInr(paise)}</span>
  ) : (
    <span style={{ color: 'var(--mfg)' }}>—</span>
  );
}

/**
 * One bay's four figures.
 *
 * ⚠️ Local, and applied on Save. The panel holds a draft that its own Save
 * writes whole, so a dialog that wrote straight into that draft would leave
 * Cancel with nothing to cancel.
 */
function RateDialog({
  z,
  isFood,
  vendor,
  localWelfare,
  onApply,
  onClose,
}: {
  z: api.BackofficeConfig['zones'][number];
  isFood: boolean;
  vendor: RateCardEntry | null;
  localWelfare: RateCardEntry | null;
  onApply: (scope: RateScope, patch: Partial<RateCardEntry>) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState({
    vendorRent: vendor?.amountPaise ?? 0,
    vendorAdvance: vendor?.depositPaise ?? 0,
    lwRent: localWelfare?.amountPaise ?? 0,
    lwAdvance: localWelfare?.depositPaise ?? 0,
  });
  const set = (k: keyof typeof v) => ({
    paise: v[k],
    onPaise: (p: number) => setV((prev) => ({ ...prev, [k]: p })),
  });

  return (
    <Dialog
      title={`${z.code} — ${isFood ? 'food' : 'non-food'} rates`}
      note={`${z.name}. Per stall, before GST. A figure left at zero is not priced at that scope and the form will not offer it. Nothing is written until Save rates.`}
      onClose={onClose}
      width={520}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() => {
            if (!z.isClosedToVendors)
              onApply('VENDOR', { amountPaise: v.vendorRent, depositPaise: v.vendorAdvance });
            onApply('LOCAL_WELFARE', { amountPaise: v.lwRent, depositPaise: v.lwAdvance });
            onClose();
          }}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {/* ⚠️ Absent, not disabled. A bay closed to trade has no vendor
            proposition at all, and empty fields nobody may fill read as
            something broken rather than as something that does not apply. */}
        {z.isClosedToVendors ? (
          <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
            {z.code} is closed to vendors, so it carries local welfare figures only.
          </div>
        ) : (
          <Grid min={200}>
            <RupeeInput id='rd-v-rent' label='Vendor Rent' {...set('vendorRent')} />
            <RupeeInput id='rd-v-adv' label='Vendor Advance' {...set('vendorAdvance')} />
          </Grid>
        )}
        <Grid min={200}>
          <RupeeInput id='rd-lw-rent' label='Local Welfare Rent' {...set('lwRent')} />
          <RupeeInput id='rd-lw-adv' label='Local Welfare Advance' {...set('lwAdvance')} />
        </Grid>
      </div>
    </Dialog>
  );
}

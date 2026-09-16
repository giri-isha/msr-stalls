import { paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { useEffect, useState } from 'react';
import type * as api from '../api';
import { FormField, Input } from '../ui';

/**
 * The pieces every configuration panel is built out of.
 *
 * ⚠️ Its own file rather than Admin's. The five panels that configure an
 * edition's bays, columns and money moved to `backoffice/planning/`, and Flow
 * and Editions stayed behind on Admin — so these three are now used from both
 * sides of that split. Either side importing them from the other is a cycle the
 * boundary guard forbids, which is the same reason `Panel` sits beside them.
 */

/** A grid of fields at the rhythm the panels use. */
export function Grid({ min = 220, children }: { min?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`,
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

/** Rupee input over a paise value. The number the admin types is rupees; the
 *  number that crosses the wire is integer paise. */
export function RupeeInput({
  id,
  label,
  paise,
  onPaise,
  disabled,
}: {
  id: string;
  label: string;
  paise: number;
  onPaise: (p: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(paiseToRupees(paise)));
  useEffect(() => setText(String(paiseToRupees(paise))), [paise]);
  return (
    <FormField id={id} label={label}>
      <div style={{ position: 'relative' }}>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 13,
            color: 'var(--mfg)',
            pointerEvents: 'none',
          }}
        >
          ₹
        </span>
        <Input
          id={id}
          type='number'
          min={0}
          step='1'
          style={{ paddingLeft: 26 }}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = Number(text);
            if (Number.isFinite(v) && v >= 0) onPaise(rupeesToPaise(v));
            else setText(String(paiseToRupees(paise)));
          }}
        />
      </div>
    </FormField>
  );
}

export type PanelProps = {
  c: api.BackofficeConfig;
  writable: boolean;
  run: (l: string, f: () => Promise<unknown>) => Promise<boolean>;
  /** Re-read the configuration. `run` already does it after a save; this is for
   *  the copy dialog, which writes through its own call. */
  reload: () => void;
};

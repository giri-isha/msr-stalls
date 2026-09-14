import type { StatusStep } from '@msr/stalls';
import { Icon } from '../ui/icons';

/** The onboarding path as a row of steps — done, current, to do. Shown to the
 *  vendor on the status page and to staff on the onboarding screen. */
export function Steps({ steps }: { steps: StatusStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol
      aria-label='Progress'
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {steps.map((s) => {
        const tone =
          s.state === 'done'
            ? { bg: 'var(--ok-t)', fg: 'var(--ok-fg)', bd: 'var(--ok-b)' }
            : s.state === 'current'
              ? { bg: 'var(--pri-t)', fg: 'var(--info-fg)', bd: 'var(--pri)' }
              : { bg: 'var(--mut)', fg: 'var(--mfg)', bd: 'var(--bd)' };
        return (
          <li
            key={s.stage}
            aria-current={s.state === 'current' ? 'step' : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: tone.bg,
              color: tone.fg,
              border: `1px solid ${tone.bd}`,
            }}
          >
            {s.state === 'done' && <Icon name='check' size={12} />}
            {s.state === 'current' && <Icon name='circle-dot' size={12} />}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

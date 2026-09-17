import type { AuditChange, AuditEventView } from '@stalls/core';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { formatDateTime } from '../hooks';
import { Btn, Icon, TONE, Tag } from '../ui';

/**
 * The pieces both audit screens draw: a change set, a detail block, the actor,
 * and the timeline a request's Activity Log tab is made of.
 *
 * One file, so the Audit Logs page's expanded row and the request's tab say
 * the same thing the same way — two renderings of one row is how the two
 * screens start disagreeing about what happened.
 *
 * ⚠️ A change draws BEFORE struck through and AFTER beside it, in that order.
 * It is the only place in the module where a reader is shown a value that is
 * no longer true, and the strike is what says which one it is without a
 * heading to explain it.
 */

const scalar = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};

export function ChangeList({ changes }: { changes: AuditChange[] }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mfg)' }}>Changes</div>
      {changes.map((c) => (
        <div
          key={c.field}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: 8,
            fontSize: 12.5,
          }}
        >
          <code style={{ fontSize: 12 }}>{c.field}</code>
          <s style={{ color: 'var(--des-fg)' }}>{scalar(c.before)}</s>
          <Icon name='arrow-right' size={12} />
          <span style={{ color: 'var(--ok-fg)', fontWeight: 600 }}>{scalar(c.after)}</span>
        </div>
      ))}
    </div>
  );
}

export function DetailList({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail);
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mfg)' }}>Details</div>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
          <code style={{ fontSize: 12, flex: 'none' }}>{k}</code>
          <span style={{ wordBreak: 'break-word' }}>{scalar(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** Who did it, and for whom. A filing names both people; everything else names
 *  one. */
export function Actor({ e }: { e: AuditEventView }) {
  const glyph =
    e.actorKind === 'BACKOFFICE' ? 'user' : e.actorKind === 'REQUESTER' ? 'ticket' : 'settings';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <Icon name={glyph} size={12} />
      <span style={{ fontWeight: 600 }}>{e.actorName}</span>
      {e.onBehalfOf && <span style={{ color: 'var(--mfg)' }}>for {e.onBehalfOf.displayName}</span>}
    </span>
  );
}

/** Whether a row has anything behind its summary line. */
export const hasMore = (e: AuditEventView) =>
  (e.changes !== null && e.changes.length > 0) || Object.keys(e.detail).length > 0;

export function Expanded({ e }: { e: AuditEventView }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {e.changes && e.changes.length > 0 && <ChangeList changes={e.changes} />}
      <DetailList detail={e.detail} />
    </div>
  );
}

/** The plate behind a family's glyph, coloured by the action's own tone. */
function plate(tone: AuditEventView['tone']): CSSProperties {
  const [bg, fg, bd] = TONE[tone] ?? TONE.neutral;
  return {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    background: bg,
    color: fg,
    border: `1px solid ${bd}`,
    flex: 'none',
  };
}

export function ActivityTimeline({ events }: { events: AuditEventView[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {events.map((e, i) => {
        const shown = open.has(e.id);
        return (
          <li key={e.id} style={{ display: 'flex', gap: 14 }}>
            {/* The rail: a plate per event, joined by a line to the next. The
                last event has no line, so the timeline ends rather than
                trailing off. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={plate(e.tone)} aria-hidden>
                <Icon name={e.glyph} size={13} />
              </span>
              {i < events.length - 1 && (
                <span style={{ flex: 1, width: 2, background: 'var(--bd)', minHeight: 18 }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{e.label}</span>
                {e.outcome === 'FAILED' && (
                  <Tag tone='des' size='sm'>
                    Failed
                  </Tag>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 12,
                  color: 'var(--mfg)',
                  marginTop: 3,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name='clock' size={11} /> {formatDateTime(e.occurredAt)}
                </span>
                <Actor e={e} />
              </div>
              {hasMore(e) && (
                <div style={{ marginTop: 6 }}>
                  <Btn onClick={() => toggle(e.id)}>
                    <Icon name={shown ? 'chevron-up' : 'chevron-down'} size={12} />
                    {shown ? 'Hide Details' : 'Show Details'}
                  </Btn>
                </div>
              )}
              {shown && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 'var(--r2)',
                    background: 'var(--rail)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <Expanded e={e} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type { ReactNode };

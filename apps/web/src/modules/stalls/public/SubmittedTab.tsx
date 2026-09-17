import type { SubmittedSection } from '@stalls/core';
import { Icon } from '../ui';

/**
 * What the requester themselves filled in, read back to them.
 *
 * 🔴 This is the answer to "what did I put on the form?", which the portal
 * could not answer at all. A vendor asked in October how many 15 A points they
 * had said they needed had one place to look — a form they no longer had — and
 * the stall team took the call. The sections, their labels and which answers
 * are dropped for being unanswered are all decided in `submittedSections`; this
 * only draws them.
 *
 * A TAB, where it was a closed `<details>` at the foot of the card. The reason
 * it was closed still holds — the page's job on arrival is what has been
 * decided and what is outstanding — and a tab that is not the default keeps it
 * out of the way just as well, without a second disclosure pattern on a page
 * that already has one.
 */
export function SubmittedTab({ sections }: { sections: SubmittedSection[] }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {sections.map((section) => (
        <div key={section.title}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--mfg)',
              marginBottom: 9,
            }}
          >
            <Icon name={section.glyph} size={13} color='var(--pri)' />
            {section.title}
          </div>
          {/* ⚠️ `auto-fill`, not `auto-fit`: `auto-fit` collapses the tracks
              no cell landed in, so a block of two answers would stretch across
              the full width while the block above it kept a narrower column,
              and the two would read as different grids. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))',
              gap: '12px 18px',
            }}
          >
            {section.facts.map((f) => (
              <div key={f.label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginBottom: 2 }}>
                  {f.label}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { PrivilegeCatalogEntry } from '@msr/stalls';
import { Checkbox, Icon, Search, Tag } from '../../ui';
import { KIND_TONE, groupByCategory } from './catalogue';

/**
 * The vocabulary, as a tree of ticks.
 *
 * ⚠️ **Collapsed by default, and searchable.** This replaced a flat list that
 * rendered every category always-open: at a few dozen privileges that was a
 * long page, and at two hundred it is a screen nobody can find anything in. The
 * category row carries a tick of its own so the usual act — "give this role all
 * of Finance" — is one click rather than five.
 *
 * 🔴 **A privilege the author does not hold is DISABLED, never hidden.** A role
 * may not carry more than its author carries, because whoever composes a role
 * can hand it to themselves. Hiding those boxes would make the rule invisible
 * and the vocabulary look smaller than it is; greying them says why. The guard
 * that MATTERS is `assertNoEscalation` on the server — this only saves a round
 * trip to be told.
 */
export function PrivilegeTree({
  catalogue,
  chosen,
  onToggle,
  onToggleMany,
  held,
}: {
  catalogue: readonly PrivilegeCatalogEntry[];
  chosen: readonly string[];
  onToggle: (code: string) => void;
  /** Every code in a category at once, set to `on`. */
  onToggleMany: (codes: string[], on: boolean) => void;
  /** Whether the AUTHOR holds this privilege themselves. */
  held: (code: string) => boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  /**
   * Only the ACTIVE vocabulary is offered.
   *
   * ⚠️ A retired privilege a role still bundles is deliberately not listed —
   * nothing should be able to add one back — which is why `RoleDialog` carries
   * those codes through a save rather than sending only what this tree knows
   * about. Listing them here would invite an author to "tidy up" a code that a
   * route may still be enforcing until the next release.
   */
  const groups = useMemo(() => groupByCategory(catalogue.filter((p) => p.isActive)), [catalogue]);

  const needle = q.trim().toLowerCase();
  const matching = (p: PrivilegeCatalogEntry) =>
    !needle ||
    p.label.toLowerCase().includes(needle) ||
    p.code.toLowerCase().includes(needle) ||
    p.description.toLowerCase().includes(needle);

  const shown = groups
    .map((g) => ({
      ...g,
      // A category whose NAME matches keeps all of its items — searching for
      // "finance" should find the category, not empty it.
      items: g.name.toLowerCase().includes(needle) ? g.items : g.items.filter(matching),
    }))
    .filter((g) => g.items.length > 0);

  const active = groups.flatMap((g) => g.items);
  const selected = active.filter((p) => chosen.includes(p.code)).length;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Search
            label='Search Privileges'
            value={q}
            onChange={setQ}
            placeholder='Search privileges or categories…'
          />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--mfg)' }}>
          {selected} of {active.length} selected
        </span>
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        {shown.map((group) => {
          // ⚠️ Only what the author may actually grant counts towards the
          // category tick. Otherwise a category they can never complete would
          // sit for ever at "3/5" and its box would never settle.
          const grantable = group.items.filter((p) => held(p.code)).map((p) => p.code);
          const on = group.items.filter((p) => chosen.includes(p.code)).length;
          const all = grantable.length > 0 && grantable.every((c) => chosen.includes(c));
          const isOpen = open.has(group.key) || needle.length > 0;

          return (
            <div
              key={group.key}
              style={{ borderRadius: 'var(--r2)', border: '1px solid var(--bd)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                <Checkbox
                  aria-label={`Every privilege under ${group.name}`}
                  checked={all}
                  // The third state: some but not all. Without it, a half-filled
                  // category is indistinguishable from an empty one.
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && !all;
                  }}
                  disabled={grantable.length === 0}
                  onChange={() => onToggleMany(grantable, !all)}
                />
                <button
                  type='button'
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(group.key)) next.add(group.key);
                      return next;
                    })
                  }
                  aria-expanded={isOpen}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--fg)',
                    font: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{group.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--mfg)' }}>
                    {on}/{group.items.length}
                  </span>
                </button>
              </div>

              {isOpen && (
                <div style={{ display: 'grid', gap: 2, padding: '0 10px 8px 34px' }}>
                  {group.items.map((item) => (
                    <label
                      key={item.code}
                      htmlFor={`priv-${item.code}`}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 9,
                        padding: '6px 0',
                        cursor: held(item.code) ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <Checkbox
                        id={`priv-${item.code}`}
                        checked={chosen.includes(item.code)}
                        disabled={!held(item.code)}
                        onChange={() => onToggle(item.code)}
                        style={{ marginTop: 2 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</span>
                        <span style={{ marginLeft: 6 }}>
                          <Tag size='sm' tone={KIND_TONE[item.kind] ?? 'neutral'}>
                            {item.kind}
                          </Tag>
                        </span>
                        <span
                          style={{
                            display: 'block',
                            fontSize: 12,
                            color: 'var(--mfg)',
                            marginTop: 1,
                          }}
                        >
                          {item.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

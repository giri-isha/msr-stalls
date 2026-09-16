import { useState } from 'react';
import { type PrivilegeCatalogEntry, privilegeCategoryName } from '@msr/stalls';
import { Empty, Search, Select, TBody, TD, TH, THead, TR, Table, Tag } from '../../ui';
import { KIND_TONE } from './catalogue';

/**
 * The privilege catalogue — the reference an admin reads while composing a role.
 *
 * 🔴 **Read only, and that is the design.** A privilege means nothing unless a
 * route enforces it, so the vocabulary is code. One authored here would be a
 * code that grants nothing while reading, on this very table, as a rule that
 * does. There is no Add button for the same reason there is no Delete: what is
 * authored is the COMPOSITION, one tab to the left.
 *
 * The one thing the table knows that the bundle cannot is `isActive`. A
 * privilege is retired by clearing it — never by deleting a row roles still
 * bundle — so a retired privilege is listed as retired rather than vanishing.
 */
export function Privileges({ catalogue }: { catalogue: readonly PrivilegeCatalogEntry[] }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');

  const categories = [...new Set(catalogue.map((p) => p.category))];
  const needle = q.trim().toLowerCase();
  const rows = catalogue.filter(
    (p) =>
      (!category || p.category === category) &&
      (!needle ||
        p.label.toLowerCase().includes(needle) ||
        p.code.toLowerCase().includes(needle) ||
        p.description.toLowerCase().includes(needle)),
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Search
            label='Search Privileges'
            value={q}
            onChange={setQ}
            placeholder='Search privileges…'
          />
        </div>
        <Select
          aria-label='Category'
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ width: 'auto', minWidth: 190 }}
        >
          <option value=''>All Categories</option>
          {categories.map((key) => (
            <option key={key} value={key}>
              {privilegeCategoryName(key)}
            </option>
          ))}
        </Select>
      </div>

      {rows.length === 0 ? (
        <Empty>No privilege matches that.</Empty>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Type</TH>
              {/* The code, because it is what a route actually enforces — and
                  what an engineer is given when an admin asks why a screen is
                  refused. A label alone cannot be looked up. */}
              <TH>Identifier</TH>
              <TH>Category</TH>
              <TH>Status</TH>
              <TH>What It Allows</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.code}>
                <TD>
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                </TD>
                <TD>
                  <Tag size='sm' tone={KIND_TONE[p.kind] ?? 'neutral'}>
                    {p.kind}
                  </Tag>
                </TD>
                <TD>
                  <code
                    style={{
                      fontSize: 11.5,
                      padding: '2px 6px',
                      borderRadius: 'var(--r1)',
                      background: 'var(--mut)',
                      color: 'var(--mfg)',
                    }}
                  >
                    {p.code}
                  </code>
                </TD>
                <TD muted>{privilegeCategoryName(p.category)}</TD>
                <TD>
                  <Tag size='sm' tone={p.isActive ? 'ok' : 'neutral'}>
                    {p.isActive ? 'Active' : 'Retired'}
                  </Tag>
                </TD>
                <TD muted>{p.description}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

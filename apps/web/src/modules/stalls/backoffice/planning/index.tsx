import type { StallPrivilege } from '@stalls/core';
import { useState } from 'react';
import * as api from '../../api';
import { useLoad } from '../../hooks';
import { useMe } from '../../me';
import { ErrorBox, H1, Icon, Loading, Select, Tabs, Tag, useToast } from '../../ui';
import { Bays } from './Bays';
import { Charges } from './Charges';
import { PlanCategories } from './Columns';
import { Fines } from './Fines';
import { Plan } from './Plan';
import { Rates } from './Rates';

/**
 * The screen an edition's stalls are settled on, end to end.
 *
 * 🔴 The five configuration tabs used to live on Admin, behind a different nav
 * group and a different privilege. Working out how many stalls a bay carries
 * and adding the bay itself were two screens, so adding one mid-planning meant
 * leaving the grid, finding Admin, and coming back to a page that had to be
 * reloaded before it showed the new row.
 *
 * ⚠️ Each tab carries its OWN privilege rather than the page carrying one. The
 * grid is `planning.read` and the five are `config.read`, exactly as they were
 * before the move — a coordinator who plans stalls does not thereby get to read
 * the rate card, and a config admin who never plans still gets the panels.
 */
const TABS = [
  { label: 'Plan', glyph: 'layers', requires: 'planning.read' },
  { label: 'Bays', glyph: 'map-pin', requires: 'config.read' },
  { label: 'Planning Columns', glyph: 'layout-grid', requires: 'config.read' },
  { label: 'Rates', glyph: 'ticket', requires: 'config.read' },
  { label: 'Charges', glyph: 'file-text', requires: 'config.read' },
  { label: 'Fines', glyph: 'ban', requires: 'config.read' },
] as const satisfies ReadonlyArray<{ label: string; glyph: string; requires: StallPrivilege }>;
type Tab = (typeof TABS)[number]['label'];

type Edition = Awaited<ReturnType<typeof api.listEditions>>[number];

export function Planning() {
  const { can } = useMe();
  const toast = useToast();
  // ⚠️ Which edition is being LOOKED AT, on the configuration tabs only. Empty
  // means the active one, which is what the screen opens on and what every
  // write goes to regardless — see `past` below.
  const [viewing, setViewing] = useState('');
  const [chosen, setChosen] = useState<Tab | null>(null);

  // ⚠️ Recomputed every render rather than settled once. `useMe` answers `false`
  // for everything until the session has loaded, so a tab picked at first render
  // would be whatever the empty privilege list allowed — which is nothing.
  const tabs = TABS.filter((t) => can(t.requires));
  const tab = tabs.find((t) => t.label === chosen)?.label ?? tabs[0]?.label;
  const onPlan = tab === 'Plan';

  // Asked for only by someone allowed to read it. A coordinator holding
  // `planning.read` alone would otherwise fire a request on every visit that the
  // API is right to refuse, and wear the error banner for it.
  const readsConfig = can('config.read');
  const cfg = useLoad(
    () => (readsConfig ? api.getConfig(viewing || undefined) : Promise.resolve(null)),
    [readsConfig, viewing],
  );
  const editions = useLoad(
    () => (readsConfig ? api.listEditions() : Promise.resolve([] as Edition[])),
    [readsConfig],
  );

  const c = cfg.data;
  // 🔴 A past edition is READ ONLY. Every write on the configuration tabs goes
  // to the ACTIVE edition — none of them carries an edition at all — so a screen
  // pointed at 2025 with its Save buttons live would write 2025's figures into
  // this year under a heading saying 2025. The selector is for comparing and for
  // copying out of; the year being edited never changes.
  const past = c ? !c.edition.isActive : false;
  const writable = can('config.write') && !past;

  // ⚠️ Returns whether it went through. The dialogs below close on `true` and
  // stay open on `false` — a refused save that closed the box anyway would take
  // the admin's typing with it, which is exactly when they least want to retype.
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.ok(label);
      cfg.reload();
      return true;
    } catch (e) {
      toast.fail(e);
      return false;
    }
  };

  if (!tab) return <ErrorBox>You do not have access to planning or configuration.</ErrorBox>;

  return (
    <div>
      <H1
        icon={<Icon name='layers' size={18} />}
        // ⚠️ The edition only while a configuration tab is open. The plan grid
        // is always the ACTIVE edition — `getPlan` takes no edition — so a
        // subtitle reading "Stalls 2025 · read only" over it would name a year the
        // grid underneath is not showing.
        sub={
          onPlan || !c ? undefined : (
            <>
              {c.edition.name} ·{' '}
              <Tag tone={writable ? 'ok' : 'neutral'} size='sm'>
                {past ? 'past edition · read only' : writable ? 'you can edit' : 'read only'}
              </Tag>
            </>
          )
        }
      >
        Planning &amp; Zones
      </H1>

      {/* The shared underlined rail, as on Admin. Hidden when a coordinator can
          reach only one section — a one-tab rail names nothing. */}
      {tabs.length > 1 && (
        <Tabs
          label='Planning Sections'
          tabs={tabs.map((t) => ({ key: t.label, label: t.label, glyph: t.glyph }))}
          active={tab ?? ''}
          onPick={(k) => setChosen(k as Tab)}
        />
      )}

      {/* The edition being looked at. Above the panel rather than inside it: it
          changes what the panel is showing, and a control that reframes a screen
          belongs at the top of it. Never over the Plan tab — see the H1 above. */}
      {!onPlan && (editions.data?.length ?? 0) > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <label htmlFor='planning-edition' style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
            Showing
          </label>
          <Select
            id='planning-edition'
            value={viewing || (editions.data?.find((e) => e.isActive)?.id ?? '')}
            onChange={(v) => setViewing(v)}
            style={{ width: 'auto', minWidth: 190 }}
          >
            {editions.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.isActive ? ' — active' : ''}
              </option>
            ))}
          </Select>
          {past && (
            <span style={{ fontSize: 12, color: 'var(--mfg)' }}>
              A past edition. Nothing here can be edited — use “Copy From…” on a panel to bring its
              settings into the active edition.
            </span>
          )}
        </div>
      )}

      {onPlan ? (
        <Plan />
      ) : cfg.loading ? (
        <Loading />
      ) : cfg.error || !c ? (
        <ErrorBox>{cfg.error?.message ?? 'Could not load the configuration.'}</ErrorBox>
      ) : (
        <>
          {tab === 'Bays' && <Bays c={c} writable={writable} run={run} reload={cfg.reload} />}
          {tab === 'Planning Columns' && (
            <PlanCategories c={c} writable={writable} run={run} reload={cfg.reload} />
          )}
          {tab === 'Rates' && <Rates c={c} writable={writable} run={run} reload={cfg.reload} />}
          {tab === 'Charges' && <Charges c={c} writable={writable} run={run} reload={cfg.reload} />}
          {tab === 'Fines' && <Fines c={c} writable={writable} run={run} reload={cfg.reload} />}
        </>
      )}
    </div>
  );
}

// CONFIGS — the configuration screens as one screen with one strip of tabs.
//
// 🔴 They were TWO destinations for one job, about to become three. Admin held
// the paperwork (the forms, the declarations, the flow, the years); Home Page
// and Sidebar Layout — which cards a role lands on and how its sidebar reads —
// had nowhere to go but a third link beside it. An admin arranging the app would
// have hunted the same job in three places.
//
// Folding them together granted nobody anything and took nothing away: each tab
// is gated on the privilege it carried as a screen of its own, so a caller who
// holds one tab gets that tab, alone.
//
// ⚠️ The tab lives in the QUERY STRING, not in state. `/m/stalls/admin` still
// exists and redirects onto `?tab=forms`, so every bookmark and every link in an
// old email lands where it used to; and picking a tab pushes, so the browser's
// back button walks the tabs.
import { useSearchParams } from 'react-router';
import { configTabsFor } from '@stalls/core';
import { useMe } from '../me';
import { Empty, H1, Icon, Tabs } from '../ui';
import { AdminPanels, type AdminTab } from './Admin';
import { HomeConfig } from './HomeConfig';
import { SidebarConfig } from './SidebarConfig';

/** Which tab keys the five paperwork panels answer to. */
const ADMIN_TABS: AdminTab[] = ['forms', 'call-form', 'declarations', 'flow', 'editions'];
const isAdminTab = (key: string): key is AdminTab => (ADMIN_TABS as string[]).includes(key);

export function Configs() {
  const { can } = useMe();
  const [params, setParams] = useSearchParams();
  const tabs = configTabsFor(can);

  // ⚠️ A caller who reaches this screen and holds no tab is a caller the sidebar
  // never offered it to — the link is gated on the union of these privileges. It
  // is still worth a sentence: the other way in is a typed URL.
  if (tabs.length === 0) return <Empty>There is nothing here you may configure.</Empty>;

  const wanted = params.get('tab') ?? '';
  // `tabs` is non-empty — the guard above returned otherwise — so the fallback
  // is the first tab this caller holds, never undefined.
  const [first] = tabs;
  const current = tabs.find((t) => t.key === wanted) ?? first;
  const pick = (key: string) => setParams({ tab: key });

  return (
    <div>
      <H1 icon={<Icon name={current.glyph} size={18} />} sub={current.blurb}>
        {current.label}
      </H1>

      <Tabs
        label='Configuration Sections'
        tabs={tabs.map((t) => ({ key: t.key, label: t.label, glyph: t.glyph }))}
        active={current.key}
        onPick={pick}
      />

      {/* Only the active tab is mounted. Each of these fetches its own payload,
          and a strip that mounted all seven would fetch six of them for nothing
          — the Form Builder's alone is every field of every form. */}
      {current.key === 'home' && <HomeConfig />}
      {current.key === 'sidebar' && <SidebarConfig />}
      {isAdminTab(current.key) && <AdminPanels tab={current.key} />}
    </div>
  );
}

/** Kept honest by a test: every tab in the registry is either one of the two new
 *  screens or one of the five `AdminPanels` answers to. A tab with no body would
 *  render a heading over an empty page — and a body with no tab is a screen
 *  nothing can reach. */
export const CONFIG_TAB_BODIES = ['home', 'sidebar', ...ADMIN_TABS] as const;

// Configs — the configuration screens as one screen with a strip of tabs.
//
// 🔴 They were TWO destinations for one job. Admin held the paperwork (forms,
// declarations, the flow, the editions) and lived under Configuration; the two
// new screens — which cards a role lands on and how its sidebar reads — had
// nowhere to go but a third link beside it. An admin arranging the app would
// have hunted the same job in three places.
//
// Folding them together grants nobody anything and takes nothing away: each tab
// is gated on the privilege it carried as a screen of its own, so a caller who
// holds one tab gets that tab, alone.
import type { StallPrivilege } from './rbac';

export interface ConfigTabDef {
  /** The `?tab=` value, and what a bookmark carries. */
  key: string;
  label: string;
  /** One line under the heading, saying what the tab decides. */
  blurb: string;
  glyph: string;
  /** Any-of. Holding one of these opens the tab. */
  privileges: readonly StallPrivilege[];
}

/**
 * The strip, in the order it reads: what a person SEES first (their home, their
 * sidebar), then what they are ASKED (the forms and the declarations), then the
 * machinery behind both (the flow and the years).
 */
export const CONFIG_TABS: readonly ConfigTabDef[] = [
  {
    key: 'home',
    label: 'Home Page',
    blurb: 'Which cards each role lands on, and in what order.',
    glyph: 'home',
    privileges: ['config.read'],
  },
  {
    key: 'sidebar',
    label: 'Sidebar Layout',
    blurb: 'Which links each role sees, under which heading, and in what order.',
    glyph: 'list-view',
    privileges: ['config.read'],
  },
  {
    key: 'forms',
    label: 'Form Builder',
    blurb: 'The sections and fields of each application form.',
    glyph: 'clipboard-list',
    privileges: ['config.read'],
  },
  {
    key: 'call-form',
    label: 'Call Log Form',
    // ⚠️ Its own tab, beside the Form Builder rather than inside it. Both build
    // forms, and the resemblance is the trap: a question on the Form Builder is
    // asked of a VENDOR filling a form, and one here is asked of a CALLER with
    // that vendor on the phone. A single picker over both would put "Items
    // Selling" and "What reason did they give" in one list.
    blurb: 'What a caller is asked to record when they log a call.',
    glyph: 'phone-call',
    privileges: ['config.read'],
  },
  {
    key: 'declarations',
    label: 'Declarations',
    blurb: 'The terms a requester agrees to, and which form asks for them.',
    glyph: 'scroll',
    privileges: ['config.read'],
  },
  {
    key: 'flow',
    label: 'Flow',
    blurb: 'Which onboarding steps each requester type is asked for.',
    glyph: 'arrow-left-right',
    privileges: ['config.read'],
  },
  {
    key: 'editions',
    label: 'Editions',
    blurb: 'The years, and which one the module is running.',
    glyph: 'calendar',
    privileges: ['config.read'],
  },
];

export const CONFIG_TAB_BY_KEY = new Map(CONFIG_TABS.map((t) => [t.key, t]));

/** Every privilege that opens at least one tab. The SHELL accepts exactly this
 *  union — narrower and somebody holds a tab but is refused the screen carrying
 *  it; wider and the sidebar offers a screen with nothing on it. */
export const CONFIG_TABS_ANY: readonly StallPrivilege[] = [
  ...new Set(CONFIG_TABS.flatMap((t) => t.privileges)),
];

export const configTabsFor = (can: (p: StallPrivilege) => boolean): ConfigTabDef[] =>
  CONFIG_TABS.filter((t) => t.privileges.some(can));

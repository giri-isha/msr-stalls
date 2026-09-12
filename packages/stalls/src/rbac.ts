/** This module's own access control.
 *
 *  Host ADR 0016: the Foundation records only THAT a person uses a module; which
 *  role they hold is the module's own fact, granted on the module's own Users
 *  screen against its own table. Nothing here is stored by the host, so nothing
 *  here can go stale against it — renaming a role below changes what it grants
 *  and nothing else in the system has to be told.
 *
 *  This file survives migration untouched. It is the whole of the module's
 *  authorisation vocabulary. */
export const MODULE_KEY = 'stalls';

/** Named after what a person DOES, not after a screen. Screens get renamed and
 *  merged; "may confirm a payment" does not. */
export const STALL_ACTIONS = [
  'requests:read',
  'requests:write',
  'planning:read',
  'planning:write',
  'selection:read',
  'selection:write',
  'comms:write',
  'finance:read',
  'finance:write',
  'checkin:write',
  'config:read',
  'config:write',
  'users:write',
  'refunds:write',
] as const;
export type StallAction = (typeof STALL_ACTIONS)[number];

export interface StallRole {
  roleKey: string;
  name: string;
  description: string;
  actions: readonly StallAction[];
}

const LEAD_ACTIONS = [
  'requests:read',
  'requests:write',
  'planning:read',
  'planning:write',
  'selection:read',
  'selection:write',
  'comms:write',
  'finance:read',
  'config:read',
  'refunds:write',
] as const;

/** The four staff roles from the requirements PDF's "Types of Users" list.
 *  Vendors are not here: an external vendor is a `StallAccount`, not a staff
 *  member, and never holds one of these. Keeping the two populations in
 *  separate tables is what stops a vendor ever being granted `config:write`. */
export const ROLES: StallRole[] = [
  {
    roleKey: 'stalls_admin',
    name: 'Admin',
    description: 'Full access, including module configuration',
    actions: STALL_ACTIONS,
  },
  {
    roleKey: 'stalls_lead',
    name: 'Lead (Stall Coordinator)',
    description: 'Planning, selection, communication and finance visibility',
    actions: LEAD_ACTIONS,
  },
  {
    roleKey: 'stalls_volunteer',
    name: 'Volunteer',
    description: 'Check-in, chairs and tables',
    actions: ['requests:read', 'checkin:write'],
  },
  {
    roleKey: 'stalls_finance',
    name: 'Finance',
    description: 'Payment confirmation and refunds',
    actions: ['requests:read', 'finance:read', 'finance:write'],
  },
];

const BY_KEY = new Map(ROLES.map((r) => [r.roleKey, r]));

/** An unknown role key grants nothing rather than throwing.
 *
 *  Grants are data an admin edits. A key that was removed from ROLES but still
 *  sits on somebody's row must read as "no access" — throwing would turn a
 *  stale grant into a 500 on every request that person makes, including the
 *  one an admin would use to fix it. */
export function can(roleKeys: string[], action: StallAction): boolean {
  return roleKeys.some((key) => BY_KEY.get(key)?.actions.includes(action) ?? false);
}

export function actionsFor(roleKeys: string[]): StallAction[] {
  return STALL_ACTIONS.filter((action) => can(roleKeys, action));
}

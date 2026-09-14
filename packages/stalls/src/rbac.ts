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
  /** Which requester types this role may see and touch. `null` is every type.
   *
   *  🔴 The local welfare team works inside this application — they file the
   *  requests, because the traders they file them for are village vendors who
   *  mostly have no email address and no way to fill a form themselves. That
   *  makes them staff. It does not make them stall coordinators: they have no
   *  business reading a commercial vendor's bank details or rejecting somebody
   *  else's request. Without a scope the only way to let them enter a request
   *  is `requests:write`, which is unscoped, so the choice would be "give them
   *  everything" or "keep doing it on paper". */
  requestTypeScope: readonly string[] | null;
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
    requestTypeScope: null,
  },
  {
    roleKey: 'stalls_lead',
    name: 'Lead (Stall Coordinator)',
    description: 'Planning, selection, communication and finance visibility',
    actions: LEAD_ACTIONS,
    requestTypeScope: null,
  },
  {
    roleKey: 'stalls_volunteer',
    name: 'Volunteer',
    description: 'Check-in, chairs and tables',
    actions: ['requests:read', 'checkin:write'],
    requestTypeScope: null,
  },
  {
    roleKey: 'stalls_finance',
    name: 'Finance',
    description: 'Payment confirmation and refunds',
    actions: ['requests:read', 'finance:read', 'finance:write'],
    requestTypeScope: null,
  },
  {
    roleKey: 'stalls_local_welfare',
    name: 'Local Welfare',
    description: 'Files and follows up local welfare stalls, and nothing else',
    actions: ['requests:read', 'requests:write', 'selection:read', 'finance:read'],
    requestTypeScope: ['LOCAL_WELFARE'],
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

/** The requester types these roles may reach, or `null` for all of them.
 *
 *  ⚠️ Scopes UNION rather than intersect: someone holding both Lead and Local
 *  Welfare is a lead who also files local welfare stalls, not a lead confined
 *  to them. An unscoped role therefore widens the answer to `null`, and that is
 *  the whole rule — a narrow role can never take access away from a broad one,
 *  it can only be the only thing someone holds. */
export function requestTypeScopeFor(roleKeys: string[]): string[] | null {
  const held = roleKeys.map((key) => BY_KEY.get(key)).filter((r) => r !== undefined);
  if (held.length === 0) return [];
  if (held.some((r) => r.requestTypeScope === null)) return null;
  return [...new Set(held.flatMap((r) => r.requestTypeScope ?? []))];
}

/** Whether these roles may touch a request of this type at all. */
export function canReachRequestType(roleKeys: string[], requestType: string): boolean {
  const scope = requestTypeScopeFor(roleKeys);
  return scope === null || scope.includes(requestType);
}

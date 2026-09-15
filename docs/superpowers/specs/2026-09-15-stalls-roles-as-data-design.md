# Roles, privileges and a role hierarchy, as data

> **All four phases, built.** A (privileges and roles as data), B (hierarchy and
> assignability), C (the role editor) and D (grant-level edition and zone scope).
> Ported from the msr-app Volunteering module, with the departures recorded below.

## Why

Today a stalls role is code: `ROLES` in `packages/stalls/src/rbac.ts`, six roles
over fifteen flat actions, resolved by a pure `can(roleKeys, action)`. Changing
what a role grants is a deploy.

The requirement is that an admin composes roles without one. That is the same
requirement that made msr's [ADR 0018] supersede [ADR 0005]: the privilege
*vocabulary* stays developer-defined — a privilege means nothing unless code
enforces it — while the *bundling* of privileges into roles becomes data.

Alongside it, a role hierarchy: who may hand out which role, and whose account
they may edit. Stalls had nothing of this; any holder of `users.write` could
grant any role, including one above their own.

## Departures from the msr port

Four, each deliberate.

**Privileges union across held roles.** msr resolves privileges from
`user.roles[0]` — a "primary" role picked with no `orderBy` — and unions only
scope and editions. Stalls already unions, host [ADR 0006] mandates union, and
`requestTypeScopeFor` has a documented union rule ("a narrow role can never take
access away from a broad one"). A faithful port would regress a person holding
Lead + Local Welfare to whichever row came back first. Union stays.

**No `level` column.** msr carries `parentId` *and* `level: Int` — two sources
of truth for depth that can drift — and `assignableRoleIds` reads only
`parentId`. Depth is derived where it is displayed.

**No `canSeeUnassigned`.** It gates unassigned *volunteers*. Stalls has no such
population.

**`requestTypeScope` stays on the role**, now editable as data rather than
compiled in — and it stayed there through phase D. It is what the role is *for*,
where the two scopes D adds describe a particular person's grant. msr puts a
single `scope` string on the role and the granted ids on the grant; stalls needs
all three axes at once, so that shape does not fit and was not copied.

## The vocabulary

`PRIVILEGE_CATEGORIES` in `packages/stalls/src/rbac.ts`, pure and testable; the
seed writes it to `StallPrivilege`. Codes are re-prefixed from `a:b` to `a.b` to
match msr's shape. This is free **now** and expensive later: the codes are a
`StallPrivilege` string-literal union threaded through `requirePrivilege`, the web's
`can()`, nav entries and `Documentation.tsx`, so the compiler finds every call
site — and no code is stored in any row yet, because `stall_staff_role` holds
role *keys*. Once codes become table rows, a re-prefix needs msr's `legacyCode`
escape hatch. Doing it before the migration is the last cheap moment.

| Category | Privileges | Kind |
|---|---|---|
| `requests` Requests | `requests.read`, `requests.write` | view, action |
| `planning` Planning | `planning.read`, `planning.write` | view, action |
| `electrical` Electrical & Venue Prep | `electrical.read` | view |
| `selection` Selection | `selection.read`, `selection.write` | view, action |
| `comms` Communication | `comms.write` | action |
| `finance` Finance | `finance.read`, `finance.write`, `refunds.write` | sensitive, action, action |
| `checkin` Check-in | `checkin.write` | action |
| `config` Configuration | `config.read`, `config.write` | view, config |
| `access` Access | `users.write`, `roles.write` | config, config |

`electrical.read` keeps its own category rather than joining Planning. The
category is the unit a role is granted whole, so merging them would quietly undo
the reason that privilege exists: the electrical team gets a plug-point count
without the planning grid and every requester's details.

`finance.read` is `sensitive`, not `view` — it reaches bank details. `kind`
gates nothing at runtime (it does not in msr either, verified); it is role-editor
presentation, seeded now because phase C needs it.

## The tables

Four in the `stalls` schema, `Stall`-prefixed per the existing convention.

- **`StallPrivilege`** — `code` unique, `label`, `category`, `kind`,
  `description`, `isActive`.
- **`StallRole`** — `roleKey` unique, `name`, `description`, `parentKey`
  (self-relation), `isSystem`, `allPrivileges`, `canAssignSameLevel`,
  `requestTypeScope`, `sortOrder`.
- **`StallRolePrivilege`** — the join.
- **`StallStaffRole`** — the grant; `roleKey` gains a real FK to `StallRole`,
  and phase D adds `editionScope` / `zoneScope`. `personRef` stays a non-FK:
  Person belongs to another module.

`allPrivileges` is ported as-is. It is what lets a privilege added in a later
release reach Admin with no seed edit, and it resolves against the live
`StallPrivilege` table rather than against stored join rows — so a role holding
it has no `StallRolePrivilege` rows at all, and any query that only joins those
rows misses it.

## Resolution

`requireStaff` already queries the grant table. It now joins through to roles and
privileges in one query, and `StaffCaller` gains:

```ts
privileges: string[]              // union across held roles
requestTypeScope: string[] | null // from the ROLE
editionScope: string[] | null     // from the GRANT (phase D)
zoneScope: string[] | null        // from the GRANT (phase D)
```

`null` means unrestricted on every axis; `[]` means "reaches nothing", which is
what holding no grant at all resolves to. The two are opposite answers and the
`[]`→`null` mapping from the column happens in exactly one place, `scopeOfRow`.

`can()` stays pure but takes resolved privileges rather than role keys:
`can(privileges, code)`. The union rule for request-type scope moves to
`unionRequestTypeScope(scopes)` — same rule, same comment, now over role rows.

An unknown or retired role key still grants nothing rather than throwing, for
the reason already recorded in `rbac.ts`: a stale grant must read as "no access",
not as a 500 on every request including the one an admin would use to fix it.

## Hierarchy and assignability (phase B)

`assignableRoleKeys` / `editableRoleKeys` ported from
`apps/api/src/modules/msr-volunteering/assignable-roles.ts`, kept pure and
walking the tree in memory — a dozen rows an admin edits by hand, and the rule
must stay testable without a database.

- You may hand out every role **beneath** yours.
- You may hand out **your own** only if it carries `canAssignSameLevel`.
- Never a sibling: two roles drawn level report to different people.
- **Editable** = assignable **plus the roles you hold**, so the top of a branch
  can still fix its own account and correct a peer's phone number.

msr's fourth rule — a `Limited`-scope role is "a seat, not a rung", assignable
from either branch — is **dropped**. It keys off a scope vocabulary stalls does
not have, and inventing an analogue would widen who can grant what on a guess.

Seeded hierarchy:

```
stalls_admin  (allPrivileges, canAssignSameLevel)
└── stalls_lead
    ├── stalls_volunteer
    ├── stalls_finance
    ├── stalls_local_welfare
    └── stalls_electrical
```

Enforced on every write path that grants, revokes or edits: the Users screen's
three actions. Refusal wording ported verbatim, because an admin meeting it on
two screens should read the same sentence.

## The web stops importing `ROLES`

`Users.tsx` renders its role picker from the imported `ROLES` constant. Under
roles-as-data that is exactly the bug msr's [ADR 0065] names: once a role is
authored rather than shipped, a client-side copy is not merely stale, it is
unknowable. The screen fetches `GET /stalls/roles` instead, which returns the
live roles already narrowed to what the caller may assign — so the picker cannot
offer a role the server will refuse.

## Seeding and bootstrap

The seed is idempotent and upserts by code / key, so it can run on an existing
database. Privileges come from `PRIVILEGE_CATEGORIES`; the six roles seed with
`isSystem: true`.

`isSystem` blocks deletion and the editing of `roleKey`, not the editing of
privileges — an admin retuning what Lead grants is the point of the feature.

Existing `stall_staff_role` rows need no migration: role keys are unchanged.
The migration inserts the privilege and role rows in the same transaction that
adds the FK, so the FK can never be added against an empty role table.

## Testing

The safety net that matters is a **parity test**: for each of the six seeded
roles, the privileges resolved through the new tables equal the actions the old
static `ROLES` granted, re-prefixed. It is the one test that proves the migration
changed no one's access, and it is written before the resolver is switched over.

Beyond it:

- `rbac.test.ts` — union, `allPrivileges` against the live table, an unknown key
  granting nothing, the scope union rule.
- Assignability — the tree walk, a cycle guard, same-level with and without the
  flag, never a sibling, and `editable` ⊃ `assignable`.
- `directory.test.ts` — the three write paths refuse with the ported wording, and
  `GET /stalls/roles` never offers a role the caller may not assign.
- `scope.test.ts` — unchanged and must stay passing; it is the evidence that
  request-type scoping survived the move.

## The role editor (phase C)

`roles.write` gates Admin → Roles. It is seeded into the vocabulary and nothing
else changes in the seed: Admin carries `allPrivileges`, so it reaches the new
privilege with no seed edit — which is the flag demonstrating its own point.

The screen composes; it never invents. `PRIVILEGE_CATEGORIES` ships in the
bundle and is only ever listed, because a privilege means nothing unless a route
enforces it.

🔴 **The guard the feature rests on is `assertNoEscalation`.** Whoever can author
a role can, with `users.write`, grant it to themselves, so a role may never carry
more than its author already carries — not in privileges, not in the
`allPrivileges` flag, not in requester types. Without it, `roles.write` is a
route to every other privilege. The editor also disables the tick boxes for
privileges the author lacks, but that is a courtesy in front of the guard, not
the guard.

Three more rules, each with a test:

- A role is only ever created or moved **into** the author's own reach: its
  parent must be one they could hand out. A role with no parent sits above
  everything, so only somebody at the top of the tree can make one.
- Editing is gated on `assignableRoleKeys`, not `editableRoleKeys` — retuning a
  role you hold but cannot hand out is editing your own reach.
- `isSystem` blocks deletion and re-keying, never the editing of privileges.
  Children of a deleted role are lifted to the root by `onDelete: SetNull`
  rather than cascading a subtree out of existence.

## Grant-level scope (phase D)

Two `String[]` columns on the grant: `editionScope` and `zoneScope`. **Empty
means everything**, which is the safe direction and not the permissive one — a
person given the whole event must not lose next year the moment somebody creates
it, with nothing watching.

They sit on the **grant** rather than the role because two people can hold the
same role for different seasons or different bays. `requestTypeScope` stays on
the role: it is what the role is *for*.

Zones are held by **code**, not id. A zone row is per-edition, so scoping by id
would silently empty a grant the day next year's bays are created, and a marshal
who runs A1 runs A1 every season. Editions are held by id and deliberately carry
no foreign key — an array column cannot — so a deleted edition leaves a stale id
that can never match the active one again.

Enforcement differs by axis, and the difference is the design:

- **Zone narrows a list.** It joins `requestType` in `scopeWhere`, as an `AND`
  rather than a bare `OR` because every caller spreads that result into a `where`
  of its own. A request counts as being in its *agreed* bay once the team has
  settled one, and its *requested* bay until then — otherwise an unplaced request
  falls outside every bay-scoped person's reach and the marshal about to receive
  it cannot see it coming.
- **Edition is a refusal, not a filter.** Every staff query already runs against
  the active edition, so a grant that does not cover it does not narrow what the
  caller sees — it means they have no business here this year. All thirty staff
  routes resolve the season through `activeEditionFor`, which refuses; the
  unguarded `activeEdition` is no longer imported by `routes.ts` at all, so a
  route cannot quietly opt out.

Granting is guarded the same way authoring is: a scoped grantor cannot hand out a
wider grant than their own, because an empty scope means "everything". Re-granting
a role somebody already holds **resets** its scope rather than merging — the
screen sends the whole picture, and a narrowed grant that silently kept last
year's wider reach is the one failure nobody would look for.

## Known gaps

- **The shipped roles never exercise the hierarchy.** `users.write` belongs to
  Admin alone, and Admin sits at the root carrying `can_assign_same_level`, so
  the only role that can reach the Users screen can already assign everything.
  The hierarchy is enforced and tested, but it starts to *bite* only once
  somebody authors a role granting `users.write` lower down — which is what the
  role editor is for.
- **Scope is set when a grant is made, not edited in place.** The Add-staff
  dialog carries the bay and season pickers; re-granting from there resets an
  existing grant's scope. A dedicated per-grant scope editor in the Roles dialog
  is not built.
- **`resetDatabase` leaves the RBAC tables alone**, because truncating them
  breaks the foreign key every `seedStaff` call depends on. Any test that mutates
  a shipped role must restore it with `seedRbac`, or it leaks into every file
  that runs afterwards. This bit once, in exactly that way.

[ADR 0018]: ../../../../msr-app-replit/docs/adr/0018-roles-privileges-scope-as-data-runtime-builder.md
[ADR 0005]: ../../../../msr-app-replit/docs/adr/0005-static-roles-as-data-not-runtime-builder.md
[ADR 0006]: ../../../../msr-app-replit/docs/adr/0006-multiple-roles-per-module-union.md
[ADR 0065]: ../../../../msr-app-replit/docs/adr/0065-a-module-surface-gates-on-its-own-permissions-not-the-role-key.md

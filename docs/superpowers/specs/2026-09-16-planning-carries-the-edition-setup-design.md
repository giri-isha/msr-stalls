# Planning & Zones carries the edition's setup

## The problem

An edition's stall plan is settled across two screens. The coordinator works out
how many stalls each bay should carry on **Planning & Zones**, but the bays
themselves, the grid's own columns, and the money those stalls are let at —
rates, charges, fines — are all tabs on **Admin**, behind a different nav group
and a different privilege. Adding a bay mid-planning means leaving the grid,
finding Admin, adding the row, and coming back to a screen that has to be
reloaded before it shows.

The five panels are also the reason `Admin.tsx` is 57.5 KB and holds nine
panels with their dialogs.

## What changes

Five Admin tabs — **Bays**, **Planning Columns**, **Rates**, **Charges**,
**Fines** — move onto Planning & Zones as tabs beside the plan grid. Each panel
already carries a `Copy From…` action, so copying a section out of a past
edition arrives on Planning & Zones by travelling with them.

Admin keeps Form Builder, Declarations, Flow and Editions.

Nothing on the API side is touched: no route, contract, schema, privilege or
`CopySection` value changes.

## Where the code goes

A new folder mirroring the existing `backoffice/access/`:

```
backoffice/planning/
  index.tsx    Planning shell — H1, tab strip, edition selector, run()
  Plan.tsx     the grid, moved from backoffice/Planning.tsx
  Bays.tsx     Zones + ZoneRow + ZoneAddDialog + ZoneDialog
  Columns.tsx  PlanCategories + PlanCategoryAddDialog + ColumnDialog
  Rates.tsx    Rates + Money + RateDialog
  Charges.tsx  Charges
  Fines.tsx    Fines + FineAddDialog + FineDialog
```

`Grid`, `RupeeInput` and the `PanelProps` type are used on both sides of the
split — `Flow` and `Editions` stay in Admin — so they move to
`components/config.tsx`, beside the existing `components/Panel.tsx`.

The panels move unchanged. `Admin.tsx` drops to roughly 25 KB and opens on Form
Builder.

## The tab strip and gating

The same `toolBtnStyle` strip Admin uses, never an underlined rail.

| Tab | Shown when | Writes need |
|---|---|---|
| Plan | `planning.read` | `planning.write` |
| Bays, Planning Columns, Rates, Charges, Fines | `config.read` | `config.write` |

The opening tab is the first one visible, so a config-only admin lands on Bays
rather than on an empty page.

Two supporting changes:

- `StallsNavItem.requires` widens from `StallPrivilege` to
  `StallPrivilege | StallPrivilege[]`, and its two readers —
  `app/BackofficeLayout.tsx` and `modules/stalls/index.tsx` — test with
  `.some()`. Planning & Zones then requires `['planning.read', 'config.read']`,
  meaning either.
- `getConfig` is called only when the caller holds `config.read`, so a
  planning-only coordinator never fires a request the API would refuse.

## The edition selector

The `Showing <edition>` control from Admin comes along, rendered only while a
config tab is open and more than one edition exists. Same read-only banner on a
past edition, and the same rule that every write goes to the ACTIVE edition
regardless of what is being looked at.

The Plan tab never shows the selector and always reads the active edition:
`getPlan` carries no edition parameter, and giving it one is out of scope.

## Docs and tests

- `Documentation.tsx`: the five bullets describing these panels move from the
  Admin entry to the Planning & Zones entry.
- `Admin.test.tsx`'s coverage of the five panels moves to
  `planning/index.test.tsx`; the rest stays.
- `Planning.test.tsx` becomes `planning/Plan.test.tsx`, plus a strip test
  asserting each gate.
- `app/shell.test.tsx`'s nav assertion is re-checked against the widened
  `requires`.

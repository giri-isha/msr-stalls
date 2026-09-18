# Backoffice refresh button — design

**Date:** 2026-09-18

## The ask

A refresh button in the top right of the backoffice shell.

## What refresh means here

Not `window.location.reload()`. The button re-runs the **current screen's
fetches** and leaves the page standing: scroll position, filters, expanded
rows, open dialogs and half-filled forms all survive. A full reload would
throw all of that away and re-download the app to answer a question — "is
there anything new?" — that a handful of GETs already answers.

## The mechanism

Every screen in the module loads through `useLoad` (`modules/stalls/hooks.ts`),
which already owns a private `tick` counter and a `reload()` that bumps it.
There are 59 call sites. A global refresh is that same signal, raised one level:
a module-wide token that every `useLoad` puts in its effect deps.

### `RefreshProvider` — `modules/stalls/refresh.tsx`

```ts
interface RefreshState {
  /** Bumped by refresh(). useLoad carries it in its effect deps. */
  token: number;
  /** A refresh is in flight — the button spins and is disabled. */
  refreshing: boolean;
  refresh(): void;
  /** Called by useLoad on mount. Returns its unregister. */
  register(): () => void;
  /** Called by useLoad around each fetch. +1 in flight, -1 settled. */
  setBusy(delta: number): void;
}
```

**The default context value is a working no-op** — `token: 0`, `refreshing:
false`, functions that do nothing. This is the whole of the "does not touch the
public screens" story: `useLoad` inside `PublicLayout` and the requester forms
reads the default, its deps never change, and it behaves exactly as it does
today. No provider, no subscription, no cost.

### Why `refreshing` clears on a transition, not a level

The obvious rule — "clear when nothing is in flight" — races. `refresh()` bumps
the token; React then runs the loaders' effects and the provider's own effect in
the same pass, and the provider's effect sees the *committed* busy count, which
is still 0. It would clear `refreshing` before a single request started.

So the rule is a **transition**: clear when the count goes from >0 back to 0.

```ts
const prev = useRef(0);
useEffect(() => {
  if (prev.current > 0 && busy === 0) setRefreshing(false);
  prev.current = busy;
}, [busy]);
```

That leaves one hole — a screen with no loaders mounted at all, where the count
never rises and the button would spin forever. Closed at the source rather than
with a timeout: `refresh()` is a no-op when the registered loader count is zero.
`register()` is what maintains that count, and it is a ref, not state — the
provider does not need to re-render when a screen mounts, only when something is
in flight.

### `useLoad` changes

Three lines of subscription:

- `token` joins `tick` and the caller's `deps` in the effect deps.
- `register()` on mount, unregister on unmount.
- `setBusy(+1)` when the fetch starts, `setBusy(-1)` when it settles — **and in
  the effect cleanup** if it has not settled yet, so a deps change mid-flight
  cannot leak a count and strand the spinner.

## The button

In `Topbar` (`app/BackofficeLayout.tsx`), immediately left of the theme toggle,
so the right end of the bar reads *roles · refresh · theme · avatar*. Existing
`topBtn` style, existing `refresh` glyph (`RefreshCw`, already in the icon
registry — and the registry's action convention already assigns `refresh` to
"do it again"). Spins via a new `@keyframes stalls-spin` in `tokens.css`;
`disabled` while spinning. Kept on a phone: it sheds nothing, and a phone is
where a stale list is most likely to be looked at.

It also calls `useMe().reload()`, so a role or sidebar change lands with the
rest.

## Two supporting fixes

Both are the same bug in two places, and both are on the path of this feature.

**`Gate` blanks the shell on a `/me` reload.** It returns `<Loading/>` whenever
`status === 'loading'`, so refreshing `/me` would replace the entire backoffice
with a spinner. Changed to `status === 'loading' && !me` — the first load still
shows the spinner, a reload keeps the app on screen.

**Seven screens flash to a spinner on refresh.** `Home.tsx:350`,
`Dashboards.tsx:154,225`, `Report.tsx:87` and `FileForRequester.tsx:88,105,124`
guard with a bare `if (loading) return <Loading />`, which throws the content
away and loses scroll position every time the token moves. Tightened to
`loading && !data`, which is what `Finance.tsx`, `Requests.tsx` and the rest of
the module already do. The public screens with the same shape are left alone —
they are not under the provider and cannot see a refresh.

## Tests

`refresh.test.tsx`:

- `refresh()` bumps the token and every mounted `useLoad` refetches.
- `refreshing` is true while a fetch is outstanding and false once it settles.
- `refresh()` with no loaders mounted does not set `refreshing`.
- A `useLoad` with no provider above it refetches on its own `reload()` and is
  untouched by anything else — the public-screen guarantee, asserted.
- A loader unmounting mid-flight does not strand `refreshing`.

## Not doing

A keyboard shortcut, a "last updated" timestamp, an auto-refresh interval, or a
modifier-click escape hatch to a hard reload. None were asked for; the browser's
own reload is still one keystroke away.

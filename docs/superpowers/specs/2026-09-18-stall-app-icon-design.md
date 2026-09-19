# The app icon, as a stall

**Date:** 2026-09-18
**Status:** implemented

## The problem

The favicon, the installed PWA icon and the sidebar's brand tile all drew
`layout-grid` — four squares. It said nothing about what the app is for. A
coordinator with three ashram tools installed picks this one out of a launcher
by its position, not its mark.

## The mark

Lucide's `store`: an awning over a shopfront. It beats `tent` for this — a tent
reads as camping, and a bare triangle is a weak silhouette at 32px — and it
comes from the icon set the module already uses everywhere, so the brand tile
stays a member of the same family rather than a one-off drawing.

Registered as `store` in `ui/icons.tsx`.

## Scope

Two marks change and no others:

- `apps/web/src/app/BackofficeLayout.tsx` — the 32px brand tile in the sidebar.
- The six PNGs in `apps/web/public`, via `tools/make-icons.py`.

Every other `layout-grid` in the module stays. The Logistics section, the
Equipment screen, the list/grid view toggle and the "See Your Requests" button
all mean *a grid*; only the sidebar tile meant *this app*.

`index.html` and the `vite.config.ts` manifest are untouched — the filenames,
sizes and `purpose` entries are the same, so only the bytes behind them change.

## Drawing it

`tools/make-icons.py` keeps its whole frame: the `--pri`/`--pfg`/`--bg` colours
converted from oklch, 4x supersampling, a rounded plate for the plain icons,
full bleed and a middle-80% safe area for the maskable ones, and the rule that
the build never runs this script — it is run by hand and its output committed.

Two helpers join the rasterizer, both still dependency-free:

- `fill_poly` — even-odd scanline fill, for the awning.
- `stroke` — polylines as capsules, which gives round caps and joins for free.
  It walks only each segment's own bounding box; walking the whole tile per
  segment draws the same picture about two hundred times slower.

`corner` and `scallops` flatten the curved bits into points — circular arcs for
the rounded corners, a sine bulge for the valance. Lucide's real path is
beziers and there is no bezier rasterizer here, so the committed PNGs are the
mark **redrawn**, not a render of it: same silhouette, same read, not
pixel-identical to what React draws in the sidebar beside it.

## Two decisions that only appeared once it was drawn

**The awning is filled where the sidebar's glyph outlines it.** Stroked, a
scalloped valance needs a trough deeper than the stroke is wide before it reads
as scallops. At favicon-32 the whole glyph is about 17px across, and there is no
stroke weight at which the wave both survives and stays a wave — it closes into
a grey bar. Filled, the scallops become silhouette, which is the one thing a
16px tab icon keeps. The body and the doorway stay stroked at the app's own
weight.

**Three scallops, not four or five.** Four is prettier at 512px and flattens
into a straight edge at 32, where each lobe is four pixels wide. Three survives
both. An icon that only works large fails in the place it is always seen.

The stroke on the body and door is still thickened optically below 128px — up
to 45% at 32 — for the same reason.

## Verification

No unit test can usefully assert raster output. Instead:

- The six PNGs were regenerated and inspected at 32, 180, 192 and 512.
- Both maskable icons were cropped to a launcher's circle programmatically: no
  ink outside the circle, and none outside the 80% safe radius.
- `npm run typecheck` clean; `biome check` clean on both changed sources;
  `apps/web` suite 445 passing.

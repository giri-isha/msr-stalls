#!/usr/bin/env python3
"""The PWA icons, drawn from the app's own mark.

⚠️ GENERATED, and committed. The build does not run this — a build step that
needs a working Python to produce a file the manifest points at is a build that
breaks on a machine nobody thought about. Re-run it by hand if the brand colour
or the mark changes, and commit what comes out.

The mark is the `store` glyph the sidebar already draws on `--pri`
(BackofficeLayout.tsx) — an awning over a shopfront, which is the nearest thing
the icon set has to a stall — so the installed icon and the app's own header are
the same thing rather than two marks that drifted. The colour is `--pri`
converted from oklch, not a hex picked to look close to it.

🔴 APPROXIMATED ARTWORK. There is no bezier rasterizer in here and lucide's
store path is arcs, so the mark below is that mark REDRAWN from straight runs,
circular corners and sine-bulge scallops: the same silhouette and the same read,
not pixel-identical to the glyph React renders beside it. Replace the PNGs when
there is a properly designed icon — no manifest entry has to change.

⚠️ The awning is FILLED where the sidebar's glyph outlines it. Stroked, its
valance needs a trough deeper than the stroke is wide to read as scallops at
all, and at favicon-32 the whole glyph is 17px across — there is no stroke
weight where the wave both survives and stays a wave. Filled, the scallops are
silhouette, and silhouette is the one thing a 16px tab icon keeps.

No dependencies: a PNG is a zlib stream of filtered scanlines, and every shape
here is a distance test against a rectangle or a line segment. Anti-aliasing is
4x supersampling, so neither the plate's rounded corners nor the awning's
scallops staircase at 192px.
"""
import struct
import zlib
from math import cos, pi, sin
from pathlib import Path

BRAND = (0x37, 0x2A, 0xAC)  # --pri, oklch(0.398 0.195 277.366)
INK = (0xEF, 0xF2, 0xFF)  # --pfg
GROUND = (0xF9, 0xFA, 0xFC)  # --bg, behind the rounded plate
SS = 4  # supersample factor

OUT = Path(__file__).resolve().parent.parent / 'apps' / 'web' / 'public'


def rounded_rect(px, w, h, x0, y0, x1, y1, r, colour):
    """Fill a rounded rectangle, in supersampled space."""
    for y in range(max(0, int(y0)), min(h, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(w, int(x1) + 1)):
            dx = max(x0 + r - x, 0.0, x - (x1 - r))
            dy = max(y0 + r - y, 0.0, y - (y1 - r))
            if dx * dx + dy * dy <= r * r:
                px[y][x] = colour


def fill_poly(px, w, h, pts, colour):
    """Fill a closed polygon, scanline by scanline.

    Even-odd crossings of each row against every edge. The half-open `ay <= y <
    by` test is what stops a vertex that sits exactly on a scanline being
    counted by both of its edges and punching a one-pixel hole in the fill.
    """
    ys = [p[1] for p in pts]
    for y in range(max(0, int(min(ys))), min(h - 1, int(max(ys)) + 1) + 1):
        xs = []
        for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
            if (ay <= y < by) or (by <= y < ay):
                xs.append(ax + (y - ay) * (bx - ax) / (by - ay))
        xs.sort()
        row = px[y]
        for i in range(0, len(xs) - 1, 2):
            for x in range(max(0, int(xs[i])), min(w - 1, int(xs[i + 1]) + 1) + 1):
                row[x] = colour


def stroke(px, w, h, pts, width, colour):
    """Stroke a polyline, with round caps and joins.

    Each segment is filled as a capsule — every pixel within half a stroke of
    it — which is what makes the joins come out round for free: two capsules
    meeting at a point already overlap in a disc.

    ⚠️ Only the pixels inside a segment's own bounding box are tested. Walking
    the whole tile once per segment draws exactly the same picture and does
    about two hundred times the work, which at 512px and 4x supersampling is
    the difference between seconds and minutes.
    """
    r = width / 2
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        dd = dx * dx + dy * dy
        for y in range(
            max(0, int(min(ay, by) - r) - 1), min(h - 1, int(max(ay, by) + r) + 1) + 1
        ):
            row = px[y]
            for x in range(
                max(0, int(min(ax, bx) - r) - 1), min(w - 1, int(max(ax, bx) + r) + 1) + 1
            ):
                # Closest point on the segment, clamped to its ends — the clamp
                # is the round cap.
                t = ((x - ax) * dx + (y - ay) * dy) / dd if dd else 0.0
                t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
                ex = x - (ax + t * dx)
                ey = y - (ay + t * dy)
                if ex * ex + ey * ey <= r * r:
                    row[x] = colour


def corner(cx, cy, r, a0, a1, steps=10):
    """A circular arc as points. y grows DOWNWARD, so a positive angle is low."""
    return [
        (cx + r * cos(a0 + (a1 - a0) * i / steps), cy + r * sin(a0 + (a1 - a0) * i / steps))
        for i in range(steps + 1)
    ]


def scallops(x0, x1, y, count, sag, steps=10):
    """The awning's valance: `count` bumps hanging off the line at `y`.

    A sine bulge, not a circular arc. At every size this renders at, the two are
    the same handful of pixels, and a sine needs no centre-and-sweep arithmetic
    to stay tangent to its neighbours.

    ⚠️ THREE bumps, not the four or five a market awning really has. Four is
    prettier at 512px and closes up into a straight edge at 32, where each lobe
    is four pixels wide; three survives both, and an icon that only works large
    is an icon that fails in the one place it is always seen — the browser tab.
    """
    pts = []
    span = (x1 - x0) / count
    for i in range(count):
        sx = x0 + i * span
        for j in range(steps + 1):
            t = j / steps
            pts.append((sx + t * span, y + sag * sin(pi * t)))
    return pts


# ── The mark, on lucide's 24-unit grid ──────────────────────────────────────
#
# Coordinates are the store glyph's own, so this stays comparable to the path in
# node_modules/lucide-react/dist/esm/icons/store.mjs when that icon next moves.

# Filled, not stroked — see the note at the top. Less flare than lucide's, which
# solid would read as a tent roof rather than an awning.
AWNING = (
    [(6.0, 2.4), (18.0, 2.4), (21.4, 7.6)]
    + scallops(21.4, 2.6, 7.6, 3, 2.4)
    + [(2.6, 7.6)]
)

# Open at the top, and running up UNDER the awning rather than stopping below
# it: same ink either way, and a 0.6-unit gap between the two is a hairline at
# 512px that looks like the drawing came apart.
BODY = (
    [(4.0, 9.0), (4.0, 19.0)]
    + corner(6.0, 19.0, 2.0, pi, pi / 2)
    + corner(18.0, 19.0, 2.0, pi / 2, 0.0)
    + [(20.0, 9.0)]
)

DOOR = (
    [(15.0, 21.0), (15.0, 16.0)]
    + corner(14.0, 16.0, 1.0, 0.0, -pi / 2)
    + corner(10.0, 16.0, 1.0, -pi / 2, -pi)
    + [(9.0, 21.0)]
)

STROKED = (BODY, DOOR)
INK_BOX = (2.6, 2.4, 21.4, 21.0)  # what the three paths actually span
STEM = 1.9  # the app's own stroke width — see `Icon` in ui/icons.tsx


def stroke_width(size):
    """`STEM`, thickened optically on the small tiles.

    ⚠️ Scaled straight down, the stroke lands near a pixel at favicon-32 and the
    mark greys out in a browser tab — the awning stops reading as an awning and
    becomes a smudge. Below 128px it is fattened, up to 45% at 32, which keeps
    the glyph black-and-white at tab size while the large icons stay airy.
    """
    return STEM * (1.0 + 0.45 * max(0.0, min(1.0, (128 - size) / 96.0)))


def draw(size, maskable):
    """The mark at `size`, as rows of packed RGB."""
    w = h = size * SS

    if maskable:
        # ⚠️ Full bleed. The launcher applies its own shape, and a rounded icon
        # inside a circle reads as a smaller icon with a halo around it.
        px = [[BRAND] * w for _ in range(h)]
    else:
        px = [[GROUND] * w for _ in range(h)]
        rounded_rect(px, w, h, 0, 0, w - 1, h - 1, w * 0.22, BRAND)

    # ⚠️ The glyph sits inside the middle 80% on a maskable icon — outside that
    # a launcher is free to crop, and a cropped mark is what "the statue's head
    # got cut off" means in the module this was ported from.
    box = w * (0.42 if maskable else 0.52)

    weight = stroke_width(size)
    gx0, gy0, gx1, gy1 = INK_BOX
    # The stroke spills half its width past the path on every side, so it is the
    # PATH plus a whole stroke that has to fit the box. Leave it out and the
    # maskable icons lose a slice of awning to the crop.
    scale = box / (max(gx1 - gx0, gy1 - gy0) + weight)
    ox = w / 2 - (gx0 + gx1) / 2 * scale
    oy = h / 2 - (gy0 + gy1) / 2 * scale

    place = lambda path: [(x * scale + ox, y * scale + oy) for x, y in path]
    fill_poly(px, w, h, place(AWNING), INK)
    for path in STROKED:
        stroke(px, w, h, place(path), weight * scale, INK)

    out = []
    for y in range(size):
        line = bytearray()
        for x in range(size):
            r = g = b = 0
            for sy in range(SS):
                base = px[y * SS + sy]
                for sx in range(SS):
                    pr, pg, pb = base[x * SS + sx]
                    r += pr
                    g += pg
                    b += pb
            n = SS * SS
            line += bytes((r // n, g // n, b // n))
        out.append(bytes(line))
    return out


def write_png(path, rows):
    raw = b''.join(b'\x00' + r for r in rows)  # filter type 0 per scanline
    size = len(rows)

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    path.write_bytes(png)
    print(f'{path.name:<24} {size}x{size}  {len(png):,} bytes')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        write_png(OUT / f'pwa-{size}.png', draw(size, maskable=False))
        write_png(OUT / f'maskable-{size}.png', draw(size, maskable=True))
    write_png(OUT / 'apple-touch-icon.png', draw(180, maskable=False))
    write_png(OUT / 'favicon-32.png', draw(32, maskable=False))

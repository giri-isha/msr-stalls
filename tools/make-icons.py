#!/usr/bin/env python3
"""The PWA icons, drawn from the app's own mark.

⚠️ GENERATED, and committed. The build does not run this — a build step that
needs a working Python to produce a file the manifest points at is a build that
breaks on a machine nobody thought about. Re-run it by hand if the brand colour
or the mark changes, and commit what comes out.

The mark is the `layout-grid` glyph the sidebar already draws on `--pri`
(BackofficeLayout.tsx), so the installed icon and the app's own header are the
same thing rather than two marks that drifted. The colour is `--pri` converted
from oklch, not a hex picked to look close to it.

🔴 PLACEHOLDER ARTWORK. It is the app's mark rendered honestly at every size,
which is what installability needs; it is not a designed icon. Replace the PNGs
when there is one — no manifest entry has to change.

No dependencies: a PNG is a zlib stream of filtered scanlines and the mark is
rectangles. Anti-aliasing is 4x supersampling, so the rounded corners do not
staircase at 192px.
"""
import struct
import zlib
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


def draw(size, maskable):
    """The mark at `size`, as rows of packed RGB."""
    w = h = size * SS

    if maskable:
        # ⚠️ Full bleed. The launcher applies its own shape, and a rounded icon
        # inside a circle reads as a smaller icon with a halo around it.
        px = [[BRAND for _ in range(w)] for _ in range(h)]
    else:
        px = [[GROUND for _ in range(w)] for _ in range(h)]
        rounded_rect(px, w, h, 0, 0, w - 1, h - 1, w * 0.22, BRAND)

    # ⚠️ The glyph sits inside the middle 80% on a maskable icon — outside that
    # a launcher is free to crop, and a cropped mark is what "the statue's head
    # got cut off" means in the module this was ported from.
    span = 0.42 if maskable else 0.52
    gap = 0.085
    box = w * span
    cell = (box - w * gap) / 2
    left = (w - box) / 2
    top = (h - box) / 2
    radius = cell * 0.22

    for row in range(2):
        for col in range(2):
            x0 = left + col * (cell + w * gap)
            y0 = top + row * (cell + w * gap)
            rounded_rect(px, w, h, x0, y0, x0 + cell, y0 + cell, radius, INK)

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

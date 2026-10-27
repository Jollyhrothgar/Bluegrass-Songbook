#!/usr/bin/env python3
"""Generate every site and app icon in docs/ from the BB monogram.

The source is `docs/images/favicon.svg`: the BB letters between two rows of
flourishes on a rounded black tile, with an even black border all round.
Pages link only the PNG/ICO renders made here, never the SVG itself: a
browser rasterizes an SVG favicon with its own plain antialiasing, which is
what made the small sizes muddy.

    uv run --with resvg-py python scripts/lib/make_icons.py

16px is hand-drawn (`HAND_16`). Every other size is rendered (`render`), all
of it aimed at a white-on-black logo surviving at 32-48px:

1. Supersample: draw the tile and the white artwork as separate coverage
   masks at SS x the target size.
2. Bolden (small sizes only): dilate the white by a fraction of an output
   pixel, the way type is drawn heavier at small optical sizes, so the thin
   flourishes don't fade out. Much past 0.15px the counters of the Bs fill in.
3. Average in linear light. Coverage IS linear luminance here; the usual
   rasterizer treats it as sRGB, so a half-covered pixel came out at sRGB 128
   (~20% bright) and every thin white line looked thinner and greyer.
4. Grid fit (small sizes only): shift the artwork, not the tile, in 1/8px
   steps and keep the offset with the fewest grey pixels. That lands stems
   and edges on pixel boundaries, which is what font hinting does by hand.

Outputs (all regenerable, all committed):
    docs/favicon.ico                   16 / 32 / 48 — the path crawlers ask
                                       for unprompted
    docs/images/favicon-{16,32,48,96,192}.png
    docs/images/apple-touch-icon.png   180x180, square (iOS rounds it)
    docs/images/icon-192.png           PWA manifest, purpose "any"
    docs/images/icon-512.png           PWA manifest, purpose "any"
    docs/images/icon-maskable-512.png  PWA manifest, purpose "maskable":
                                       full-bleed black, art inset to the
                                       safe zone

Google Search shows a site's favicon only if it is a multiple of 48px square;
the 48/96/192 PNGs exist for that. Re-run when favicon.svg changes. Nothing in
the build calls it.
"""

import io
from pathlib import Path

import numpy as np
import resvg_py
from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parents[2]
DOCS = REPO / 'docs'
IMAGES = DOCS / 'images'
SOURCE = IMAGES / 'favicon.svg'

ROUNDED = 'rx="200" '
# The artwork's outermost group; grid fitting wraps it in a translate.
ART_GROUP = '  <g transform="translate(38.6,46.1)'
VIEWBOX = 1128

SMALL = 48            # sizes at or below this get boldening + grid fitting
BOLD_PX = 0.15        # dilation, in output pixels
SS_SMALL, SS_LARGE = 16, 4
GRID_STEPS = [i / 8 for i in range(-4, 4)]

# 16px is hand-drawn, not rendered: at that size the flourishes are ~1.5px
# tall and no amount of filtering keeps them from greying out the tile. Each
# B is 6x6 (bottom bowl larger, two-pixel stem); each flourish row is an end
# curl, a bar, and the centre crown pointing in at the letters.
# '#' white, '.' black, '+' the tile's anti-aliased corner, ' ' transparent.
_B = ['#####.',
      '.##..#',
      '.####.',
      '.##..#',
      '.##..#',
      '#####.']
HAND_16 = [' +............+ ',
           '+##...####...##+',
           '.#.###.##.###.#.',
           '.......##.......',
           '................',
           *('.' + row + '..' + row + '.' for row in _B),
           '................',
           '.......##.......',
           '.#.###.##.###.#.',
           '+##...####...##+',
           ' +............+ ']
HAND_PIXELS = {'#': (255, 255, 255, 255), '.': (0, 0, 0, 255),
               '+': (0, 0, 0, 150), ' ': (0, 0, 0, 0)}

# Maskable icons are cropped to a platform-chosen shape; only the middle 80%
# (a circle) is guaranteed visible. The tile is drawn at this fraction of the
# canvas so the artwork's corners stay inside that circle.
MASKABLE_INSET = 0.6


def square(svg: str) -> str:
    """The tile without rounded corners, for platforms that apply their own mask."""
    if ROUNDED not in svg:
        raise SystemExit(f'{SOURCE.name}: no rounded <rect> to square off')
    return svg.replace(ROUNDED, '', 1)


def _coverage(svg: str, px: int) -> np.ndarray:
    png = bytes(resvg_py.svg_to_bytes(svg_string=svg, width=px, height=px))
    return np.asarray(Image.open(io.BytesIO(png)).getchannel('A'), dtype=np.float64) / 255


def _split(svg: str) -> tuple:
    """(tile-only SVG, artwork-only SVG)."""
    head, art = svg.split('<rect', 1)
    rect, rest = art.split('/>', 1)
    return head + '<rect' + rect + '/>\n</svg>', head + rest


def _shift(art_svg: str, dx: float, dy: float, size: int) -> str:
    if ART_GROUP not in art_svg:
        raise SystemExit(f'{SOURCE.name}: artwork group not found; update ART_GROUP')
    u = VIEWBOX / size
    return (art_svg.replace(ART_GROUP, f'  <g transform="translate({dx * u:.3f},{dy * u:.3f})">\n'
                            + ART_GROUP, 1)
            .replace('</g>\n</svg>', '</g>\n  </g>\n</svg>'))


def _downsample(tile: np.ndarray, art: np.ndarray, size: int, ss: int) -> np.ndarray:
    """Box-filter to `size`; returns (luminance as sRGB 0..1, alpha 0..1)."""
    alpha = tile.reshape(size, ss, size, ss).mean(axis=(1, 3))
    white = art.reshape(size, ss, size, ss).mean(axis=(1, 3))
    lum = np.divide(white, alpha, out=np.zeros_like(white), where=alpha > 0)
    srgb = np.where(lum <= 0.0031308, 12.92 * lum, 1.055 * lum ** (1 / 2.4) - 0.055)
    return srgb, alpha


def _greyness(srgb: np.ndarray, alpha: np.ndarray) -> float:
    inside = alpha > 0.99
    return float(np.minimum(srgb, 1 - srgb)[inside].mean())


def render(svg: str, size: int) -> Image.Image:
    small = size <= SMALL
    ss = SS_SMALL if small else SS_LARGE
    tile_svg, art_svg = _split(svg)
    tile = _coverage(tile_svg, size * ss)

    best = None
    for dx in GRID_STEPS if small else [0.0]:
        for dy in GRID_STEPS if small else [0.0]:
            art = _coverage(_shift(art_svg, dx, dy, size), size * ss)
            if small:
                k = 2 * round(BOLD_PX * ss) + 1
                art = np.asarray(Image.fromarray((art * 255).astype(np.uint8))
                                 .filter(ImageFilter.MaxFilter(k)), dtype=np.float64) / 255
            srgb, alpha = _downsample(tile, np.minimum(art, tile), size, ss)
            score = _greyness(srgb, alpha)
            if best is None or score < best[0]:
                best = (score, srgb, alpha)

    _, srgb, alpha = best
    v = (srgb * 255).round().astype(np.uint8)
    a = (alpha * 255).round().astype(np.uint8)
    return Image.fromarray(np.dstack([v, v, v, a]), 'RGBA')


def hand_drawn(grid: list) -> Image.Image:
    if len(grid) != len(grid[0]) or any(len(row) != len(grid) for row in grid):
        raise SystemExit('hand-drawn icon must be square')
    return Image.fromarray(np.array([[HAND_PIXELS[c] for c in row] for row in grid],
                                    dtype=np.uint8), 'RGBA')


def save(image: Image.Image, out: Path) -> None:
    image.save(out, 'PNG', optimize=True)
    print(f'wrote {out.relative_to(REPO)} ({image.width}x{image.height})')


def maskable(svg: str, size: int) -> Image.Image:
    art_px = round(size * MASKABLE_INSET)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    offset = (size - art_px) // 2
    canvas.alpha_composite(render(square(svg), art_px), (offset, offset))
    return canvas


def main() -> None:
    svg = SOURCE.read_text(encoding='utf-8')

    small = {16: hand_drawn(HAND_16), 32: render(svg, 32), 48: render(svg, 48)}
    for size, image in small.items():
        save(image, IMAGES / f'favicon-{size}.png')
    for size in (96, 192):
        save(render(svg, size), IMAGES / f'favicon-{size}.png')
    save(render(square(svg), 180), IMAGES / 'apple-touch-icon.png')

    save(render(svg, 192), IMAGES / 'icon-192.png')
    save(render(svg, 512), IMAGES / 'icon-512.png')
    save(maskable(svg, 512), IMAGES / 'icon-maskable-512.png')

    ico = DOCS / 'favicon.ico'
    small[48].save(ico, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)],
                   append_images=[small[16], small[32]])
    print(f'wrote {ico.relative_to(REPO)} (16, 32, 48)')


if __name__ == '__main__':
    main()

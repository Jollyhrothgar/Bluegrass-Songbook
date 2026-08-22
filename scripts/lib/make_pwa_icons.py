#!/usr/bin/env python3
"""Generate the PWA icons in docs/images/ from the banjo logo.

The manifest (docs/manifest.webmanifest) needs OPAQUE square PNGs: the source
`docs/images/banjo.png` is black line art on transparency, which disappears
into a dark launcher background. This flattens it onto the light theme's
background token and writes the three sizes the manifest names.

    uv run python scripts/lib/make_pwa_icons.py

Outputs (all regenerable, all committed):
    docs/images/icon-192.png           192x192, purpose "any"
    docs/images/icon-512.png           512x512, purpose "any"
    docs/images/icon-maskable-512.png  512x512, art inset to the 80% safe
                                       zone, purpose "maskable"

Re-run it when the logo changes. Nothing in the build calls it.
"""

from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
IMAGES = REPO / "docs" / "images"
SOURCE = IMAGES / "banjo.png"

# --bg from docs/css/style.css (:root, light theme)
BACKGROUND = (250, 250, 250, 255)


def render(size: int, inset: float, out: Path) -> None:
    """Flatten the logo onto an opaque square, scaled to `inset` of the box."""
    art_px = max(1, int(size * inset))
    art = Image.open(SOURCE).convert("RGBA").resize(
        (art_px, art_px), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    offset = (size - art_px) // 2
    canvas.alpha_composite(art, (offset, offset))
    canvas.convert("RGB").save(out, "PNG", optimize=True)
    print(f"wrote {out.relative_to(REPO)} ({size}x{size})")


def main() -> None:
    render(192, 1.0, IMAGES / "icon-192.png")
    render(512, 1.0, IMAGES / "icon-512.png")
    # Maskable icons are cropped to a platform-chosen shape; only the middle
    # 80% is guaranteed visible, so the art is inset to that safe zone.
    render(512, 0.8, IMAGES / "icon-maskable-512.png")


if __name__ == "__main__":
    main()

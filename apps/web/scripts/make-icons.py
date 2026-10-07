"""Render PWA PNG icons matching public/icon.svg. Run: python scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

BRAND = (79, 70, 229)
public = Path(__file__).resolve().parent.parent / "public"


def icon(size: int) -> Image.Image:
    s = size / 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(14 * s), fill=BRAND)
    # speech bubble
    d.ellipse([12 * s, 13 * s, 52 * s, 47.5 * s], fill="white")
    d.polygon([(18 * s, 40 * s), (14.9 * s, 49.7 * s), (27 * s, 44 * s)], fill="white")
    # relay arrow
    w = max(2, int(3.5 * s))
    d.line([(24 * s, 31 * s), (35 * s, 31 * s)], fill=BRAND, width=w)
    d.line([(30 * s, 25 * s), (36 * s, 31 * s), (30 * s, 37 * s)], fill=BRAND, width=w, joint="curve")
    return img


for size in (192, 512):
    icon(size).save(public / f"icon-{size}.png")
print("icons written to", public)

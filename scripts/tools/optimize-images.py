"""Shrink the site's share-preview PNGs (og-*.png and preview.png) without visible change.

Run from the repo root after you add or replace an image:
    python scripts/tools/optimize-images.py

Needs Pillow:  pip install pillow
Each image is reduced to a 256-colour palette with dithering. A file is only
replaced if the result is smaller.

The app icons (assets/icon-*.png) are left alone on purpose: they are photo-style
artwork, and a 256-colour palette makes them look blotchy.
"""
import glob
import os

from PIL import Image

files = sorted(glob.glob("assets/og-*.png") + ["preview.png"])
saved_total = 0
for path in files:
    if not os.path.exists(path):
        continue
    before = os.path.getsize(path)
    im = Image.open(path)
    if im.mode == "P":
        continue  # already a palette image
    if im.mode == "RGBA":
        q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    else:
        q = im.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
    tmp = path + ".tmp"
    q.save(tmp, format="PNG", optimize=True)
    after = os.path.getsize(tmp)
    if after < before:
        os.replace(tmp, path)
        saved_total += before - after
        print(f"{path}: {before // 1024} KB -> {after // 1024} KB")
    else:
        os.remove(tmp)
print(f"Saved {saved_total // 1024} KB")

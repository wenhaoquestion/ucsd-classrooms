#!/usr/bin/env python3
"""Suggest Geisel floor-map measurements for data/indoor/GEISEL/trace.json.

Renders a library floor-map PDF at 72 dpi (1 px = 1 PDF point) and prints:
- `blue`: the map's blue fills (rooms, named spaces, restroom and elevator
  cores), each with its bounding box and outline
- `outline`: the floor outline, ignoring black icons on its edge (floors 1-2)
- `courtyards`: dark gray "Inaccessible Courtyard" regions
- `staff`: mid gray regions, which the maps leave without detail

It only suggests geometry; a person reads every room label off the map and
writes the reviewed values into trace.json. Then run
`node scripts/build-geisel-indoor.mjs`.

Needs poppler's `pdftoppm`, plus Pillow, NumPy, SciPy and scikit-image.

    python -I scripts/trace-geisel-maps.py Library-Maps_Geisel-Floor-6.pdf
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure


def render(pdf):
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / 'page'
        subprocess.run(['pdftoppm', '-r', '72', '-png', '-f', '1', '-l', '1', '-singlefile', str(pdf), str(base)], check=True)
        return np.asarray(Image.open(base.with_suffix('.png')).convert('RGB')).astype(int)


def polygon(mask, tolerance):
    contour = max(measure.find_contours(mask.astype(float), 0.5), key=len)
    simple = measure.approximate_polygon(contour, tolerance=tolerance)
    return [[round(float(x), 1), round(float(y), 1)] for y, x in simple[:-1]]


def blue_fills(img):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    # The maps' room blue is about rgb(0, 99, 158)
    labels, _ = ndimage.label((b > 120) & (r < 40) & (g > 60) & (g < 130))
    fills = []
    for i, (ys, xs) in enumerate(ndimage.find_objects(labels), 1):
        mask = labels == i
        if mask.sum() >= 150:
            # Close over the white text printed on the fill
            solid = ndimage.binary_fill_holes(ndimage.binary_closing(mask, iterations=3))
            fills.append({'box': [xs.start, ys.start, xs.stop, ys.stop], 'outline': polygon(solid, 1.5)})
    return sorted(fills, key=lambda fill: (fill['box'][1], fill['box'][0]))


def staff(img):
    # Areas the maps fill flat gray, rgb(154, 154, 154), without any detail
    gray = ndimage.binary_opening(np.abs(img - 154).sum(-1) < 9, iterations=2)
    labels, n = ndimage.label(gray)
    return [polygon(labels == i, 3) for i in range(1, n + 1) if (labels == i).sum() >= 3000]


def outline(img):
    # Floor fills are neither white nor black, so edge icons drop out
    floor = (img.sum(-1) < 740) & (img.max(-1) > 70)
    floor = ndimage.binary_opening(ndimage.binary_closing(floor, iterations=2), iterations=3)
    labels, n = ndimage.label(floor)
    sizes = ndimage.sum(floor, labels, range(1, n + 1))
    largest = ndimage.binary_fill_holes(labels == 1 + int(np.argmax(sizes)))
    return polygon(largest, 4)


def courtyards(img):
    # Courtyards are filled with rgb(89-91, 89-91, 89-91)
    dark = (np.abs(img - 90).sum(-1) < 12)
    dark = ndimage.binary_fill_holes(ndimage.binary_closing(dark, iterations=3))
    labels, n = ndimage.label(dark)
    return [polygon(labels == i, 2.5) for i in range(1, n + 1) if (labels == i).sum() >= 8000]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pdf', type=Path)
    args = parser.parse_args()
    img = render(args.pdf)
    print(json.dumps({'blue': blue_fills(img), 'outline': outline(img), 'courtyards': courtyards(img), 'staff': staff(img)}))


if __name__ == '__main__':
    main()

"""Tracing assistant for the CSE (EBU3B) floor maps.

Finds connected regions filled with each legend color and the building
outline, and emits simplified pixel polygons plus an overlay with region IDs.
It does not read room numbers; those are assigned by a person.

usage: python -I segment.py plan.jpg out.json overlay.png
"""

import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

LEGEND = {"office": (289, 718), "conference": (376, 718), "lab": (576, 718)}
# Areas of the sheet that are not the building (title block, legend, street)
ERODE = int(__import__("os").environ.get("ERODE", "4"))
EXCLUDE = [(0, 0, 362, 192), (0, 690, 1000, 773), (925, 0, 1000, 773)]


def rdp(points, eps):
    if len(points) < 3:
        return points
    start, end = np.array(points[0], float), np.array(points[-1], float)
    line = end - start
    norm = np.hypot(*line)
    best, index = -1.0, 0
    for i in range(1, len(points) - 1):
        p = np.array(points[i], float) - start
        d = abs(line[0] * p[1] - line[1] * p[0]) / norm if norm else np.hypot(*p)
        if d > best:
            best, index = d, i
    if best > eps:
        return rdp(points[: index + 1], eps)[:-1] + rdp(points[index:], eps)
    return [points[0], points[-1]]


def trace(mask):
    """Traces the outer boundary of a filled mask along pixel corners."""
    # Close diagonal pinches so every boundary corner has one outgoing edge
    mask = ndimage.binary_closing(np.pad(mask, 1), structure=np.ones((2, 2), bool))[1:-1, 1:-1] | mask
    h, w = mask.shape
    padded = np.zeros((h + 2, w + 2), bool)
    padded[1:-1, 1:-1] = mask
    # Directed boundary edges between pixel corners, keeping the region on the left
    edges = {}
    ys, xs = np.nonzero(padded)
    for y, x in zip(ys, xs):
        if not padded[y - 1, x]:
            edges[(x + 1, y)] = (x, y)
        if not padded[y + 1, x]:
            edges[(x, y + 1)] = (x + 1, y + 1)
        if not padded[y, x - 1]:
            edges[(x, y)] = (x, y + 1)
        if not padded[y, x + 1]:
            edges[(x + 1, y + 1)] = (x + 1, y)
    # Follow the loop that contains the topmost-leftmost corner
    start = min(edges, key=lambda p: (p[1], p[0]))
    loop = [start]
    current = edges[start]
    while current != start and len(loop) < 20000:
        loop.append(current)
        current = edges.get(current)
        if current is None:
            break
    if current != start:
        ys, xs = np.nonzero(mask)
        print("warning: open boundary, using bbox", file=sys.stderr)
        return [(xs.min(), ys.min()), (xs.max() + 1, ys.min()), (xs.max() + 1, ys.max() + 1), (xs.min(), ys.max() + 1)]
    # Undo padding offset
    return [(x - 1, y - 1) for x, y in loop]


def simplify(loop, eps):
    # Split the closed loop in two so RDP has fixed endpoints
    far = max(range(len(loop)), key=lambda i: (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2)
    a = rdp(loop[: far + 1], eps)
    b = rdp(loop[far:] + [loop[0]], eps)
    points = a[:-1] + b[:-1]
    return [[int(x), int(y)] for x, y in points]


def components(labels, count, min_area):
    """Yields (offset_x, offset_y, filled sub-mask) per label, cropped for speed."""
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        y0, x0 = sl[0].start, sl[1].start
        sub = ndimage.binary_fill_holes(labels[sl] == i)
        if sub.sum() >= min_area:
            yield x0, y0, sub


def main(path, out_json, out_overlay):
    img = np.asarray(Image.open(path).convert("RGB")).astype(int)
    h, w, _ = img.shape
    allowed = np.ones((h, w), bool)
    for x0, y0, x1, y1 in EXCLUDE:
        allowed[y0:y1, x0:x1] = False

    regions = []
    masks = []
    room_mask = np.zeros((h, w), bool)
    for kind, (sx, sy) in LEGEND.items():
        color = np.median(img[sy - 2 : sy + 3, sx - 2 : sx + 3].reshape(-1, 3), axis=0)
        override = __import__("os").environ.get("COLOR_" + kind)
        if override:
            color = np.array([int(c) for c in override.split(",")])
        tolerance = 10 if override else 16
        dist = np.sqrt(((img - color) ** 2).sum(axis=2))
        mask = (dist < tolerance) & allowed
        # Erode first so rooms joined only through door gaps separate, then
        # grow the seeds back over the original fill
        seeds, count = ndimage.label(ndimage.binary_erosion(mask, iterations=ERODE) if ERODE > 0 else mask)
        _, (iy, ix) = ndimage.distance_transform_edt(seeds == 0, return_indices=True)
        labels = np.where(mask, seeds[iy, ix], 0)
        for x0, y0, sub in components(labels, count, 60):
            area = int(sub.sum())
            ys, xs = np.nonzero(sub)
            ys, xs = ys + y0, xs + x0
            room_mask[y0 : y0 + sub.shape[0], x0 : x0 + sub.shape[1]] |= sub
            loop = [(x + x0, y + y0) for x, y in trace(sub)]
            masks.append((x0, y0, sub))
            regions.append(
                {
                    "kind": kind,
                    "area": area,
                    "bbox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                    "centroid": [round(float(xs.mean()) + 0.5, 1), round(float(ys.mean()) + 0.5, 1)],
                    "polygon": simplify(loop, 1.3),
                    "_mask": len(masks) - 1,
                }
            )
    regions.sort(key=lambda r: (r["bbox"][0] // 40, r["bbox"][1]))
    id_image = np.full((h, w), -1, np.int32)
    for i, region in enumerate(regions):
        region["id"] = i
        x0, y0, sub = masks[region.pop("_mask")]
        view = id_image[y0 : y0 + sub.shape[0], x0 : x0 + sub.shape[1]]
        view[sub] = i
    np.save(out_json.replace(".json", "-ids.npy"), id_image)

    # Building outline: dark linework + room fills, closed and hole-filled
    gray = img.mean(axis=2)
    walls = (gray < 110) & allowed
    solid = ndimage.binary_closing(walls | room_mask, iterations=4)
    solid = ndimage.binary_fill_holes(solid)
    labels, count = ndimage.label(solid)
    sizes = ndimage.sum(solid, labels, range(1, count + 1))
    building = labels == (int(np.argmax(sizes)) + 1)
    outline = simplify(trace(building), 2.0)

    # Grey "Warren College" shading on the lower levels
    grey = (np.abs(img - 226).max(axis=2) < 8) & allowed
    grey_labels, grey_count = ndimage.label(ndimage.binary_opening(grey, iterations=2))
    shaded = []
    for x0, y0, sub in components(grey_labels, grey_count, 5000):
        shaded.append(simplify([(x + x0, y + y0) for x, y in trace(sub)], 2.0))

    with open(out_json, "w") as f:
        json.dump({"image": path.split("/")[-1], "size": [w, h], "outline": outline, "shaded": shaded, "regions": regions}, f)

    overlay = Image.open(path).convert("RGB").resize((w * 2, h * 2), Image.NEAREST)
    draw = ImageDraw.Draw(overlay)
    draw.line([(x * 2, y * 2) for x, y in outline + [outline[0]]], fill=(255, 0, 255), width=3)
    for region in regions:
        pts = [(x * 2, y * 2) for x, y in region["polygon"]]
        draw.line(pts + [pts[0]], fill=(255, 0, 0), width=2)
        cx, cy = region["centroid"]
        draw.text((cx * 2 - 6, cy * 2 + 6), str(region["id"]), fill=(255, 0, 0))
    overlay.save(out_overlay)
    print(len(regions), "regions,", len(outline), "outline points")


if __name__ == "__main__":
    main(*sys.argv[1:4])

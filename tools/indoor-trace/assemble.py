"""Combines segmented regions + a hand-written label sheet into pixel polygons.

usage: python -I assemble.py PLANS_DIR SEG_DIR labels.json out.json

Label sheet, per floor:
  rooms:  {label: [region ids]}            union of segmented regions
  splits: [{region, axis, cuts, labels}]   cut one region into several rooms
  manual: {label: {kind, polygon}}         hand-traced pixel polygon
  hull:   [labels] or "offices"            use the convex hull (ragged fills)
  ignore: [region ids]                     regions that aren't rooms (e.g. shading)
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, __file__.rsplit("/", 1)[0].rsplit("\\", 1)[0])
from segment import EXCLUDE, simplify, trace  # noqa: E402

# Context drawings that are not the building (compass, sculpture, labels)
OUTLINE_EXCLUDE = EXCLUDE + [(195, 210, 315, 330), (395, 150, 530, 280), (430, 80, 560, 118), (20, 330, 70, 460)]


def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def mask_hull(mask):
    ys, xs = np.nonzero(mask)
    corners = set()
    for x, y in zip(xs.tolist(), ys.tolist()):
        corners.update(((x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)))
    return [[int(x), int(y)] for x, y in hull(list(corners))]


def rasterize(polygon, shape):
    img = Image.new("1", (shape[1], shape[0]), 0)
    ImageDraw.Draw(img).polygon([tuple(p) for p in polygon], fill=1)
    return np.asarray(img, bool)


plans_dir, seg_dir, labels_path, out_path = sys.argv[1:5]
sheet = json.load(open(labels_path))
result = {}
for floor, spec in sheet.items():
    data = json.load(open(f"{seg_dir}/{floor}.json"))
    ids = np.load(f"{seg_dir}/{floor}-ids.npy")
    shape = ids.shape
    kinds = {r["id"]: r["kind"] for r in data["regions"]}
    used = set()
    parts = {}  # label -> {"mask", "regions"}

    def add(label, mask, region_ids):
        entry = parts.setdefault(label, {"mask": np.zeros(shape, bool), "regions": []})
        entry["mask"] |= mask
        entry["regions"] += region_ids

    def claim(i):
        if i in used:
            raise SystemExit(f"{floor}: region {i} assigned twice")
        used.add(i)

    for label, region_ids in spec.get("rooms", {}).items():
        for i in region_ids:
            claim(i)
        add(label, np.isin(ids, region_ids), region_ids)
    for split in spec.get("splits", []):
        i = split["region"]
        claim(i)
        mask = ids == i
        edges = [-np.inf, *split["cuts"], np.inf]
        coords = np.indices(shape)[0 if split["axis"] == "y" else 1]
        for label, lo, hi in zip(split["labels"], edges[:-1], edges[1:]):
            part = mask & (coords >= lo) & (coords < hi)
            lab, n = ndimage.label(part)
            if n > 1:
                sizes = ndimage.sum(part, lab, range(1, n + 1))
                part = lab == (int(np.argmax(sizes)) + 1)
            add(label, part, [i])

    hull_spec = spec.get("hull", [])
    rooms = []
    for label, entry in parts.items():
        region_ids = entry["regions"]
        kind_set = sorted({kinds[i] for i in region_ids})
        kind = kind_set[0] if len(kind_set) == 1 else "mixed"
        mask = entry["mask"]
        if len(region_ids) > 1:
            mask = ndimage.binary_closing(mask, iterations=3) | mask
        mask = ndimage.binary_fill_holes(mask)
        _, pieces = ndimage.label(mask)
        use_hull = pieces > 1 or label in hull_spec or (hull_spec == "offices" and kind == "office")
        polygon = mask_hull(mask) if use_hull else simplify(trace(mask), 1.3)
        if use_hull:
            mask = rasterize(polygon, shape) | mask
        dist = ndimage.distance_transform_edt(np.pad(mask, 1))[1:-1, 1:-1]
        y, x = np.unravel_index(np.argmax(dist), dist.shape)
        rooms.append(
            {
                "label": label,
                "kind": kind,
                "regions": sorted(region_ids),
                "method": "hull" if use_hull else "trace",
                "polygon": polygon,
                "labelAt": [int(x) + 0.5, int(y) + 0.5],
                "areaPx": int(mask.sum()),
            }
        )
    for label, manual in spec.get("manual", {}).items():
        mask = rasterize(manual["polygon"], shape)
        dist = ndimage.distance_transform_edt(np.pad(mask, 1))[1:-1, 1:-1]
        y, x = np.unravel_index(np.argmax(dist), dist.shape)
        rooms.append(
            {
                "label": label,
                "kind": manual["kind"],
                "regions": [],
                "method": "manual",
                "polygon": manual["polygon"],
                "labelAt": [int(x) + 0.5, int(y) + 0.5],
                "areaPx": int(mask.sum()),
            }
        )

    # Floor outline: dark linework + room fills + shaded wing, each separate part kept
    img = np.asarray(Image.open(f"{plans_dir}/{floor}.jpg").convert("L")).astype(int)
    allowed = np.ones(shape, bool)
    for x0, y0, x1, y1 in OUTLINE_EXCLUDE:
        allowed[y0:y1, x0:x1] = False
    solid = ((img < 110) & allowed) | (ids >= 0)
    for room in rooms:
        solid |= rasterize(room["polygon"], shape)
    for shaded in data.get("shaded", []):
        solid |= rasterize(shaded, shape)
    solid = ndimage.binary_fill_holes(ndimage.binary_closing(solid, iterations=4))
    labels, count = ndimage.label(solid)
    outline = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        sub = labels[sl] == i
        if sub.sum() < 1500:
            continue
        y0, x0 = sl[0].start, sl[1].start
        outline.append([[x + x0, y + y0] for x, y in simplify(trace(sub), 2.0)])

    ignored = set(spec.get("ignore", []))
    unassigned = [r for r in data["regions"] if r["id"] not in used and r["id"] not in ignored]
    result[floor] = {
        "image": data["image"],
        "size": data["size"],
        "outline": outline,
        "shaded": data.get("shaded", []),
        "rooms": sorted(rooms, key=lambda r: r["label"]),
        "unlabeledRegions": [
            {"id": r["id"], "kind": r["kind"], "polygon": r["polygon"], "centroid": r["centroid"]}
            for r in unassigned
        ],
    }
    print(floor, len(rooms), "rooms;", len(outline), "outline parts; unlabeled regions:", [r["id"] for r in unassigned])

json.dump(result, open(out_path, "w"), indent=1)

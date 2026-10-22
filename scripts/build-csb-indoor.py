#!/usr/bin/env python3
"""Build the CSB classroom supplement from reviewed PDF-point polygons.

python scripts/build-csb-indoor.py [--review]

--review renders overlays from the original cached PDF using Poppler and Pillow.
The runtime JSON and registration report need only Python's standard library.
"""

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TRACE = ROOT / "data/indoor/CSB/trace.json"
BASE = ROOT / "static/indoor/facilities/CSB.json"
OUTPUT = ROOT / "static/indoor/CSB-combined.json"
REPORT = ROOT / "data/indoor/CSB/registration.json"


def fit(source, target):
    """Least-squares uniform scale + translation; preserve printed north-up."""
    source_mean = [statistics.mean(p[i] for p in source) for i in (0, 1)]
    target_mean = [statistics.mean(p[i] for p in target) for i in (0, 1)]
    numerator = sum((a[i] - source_mean[i]) * (b[i] - target_mean[i])
                    for a, b in zip(source, target) for i in (0, 1))
    denominator = sum((p[i] - source_mean[i]) ** 2 for p in source for i in (0, 1))
    scale = numerator / denominator
    offset = [target_mean[i] - scale * source_mean[i] for i in (0, 1)]
    residuals = [math.dist([scale * p[i] + offset[i] for i in (0, 1)], q)
                 for p, q in zip(source, target)]
    if scale <= 0 or max(residuals) > 3:
        raise ValueError("Floor registration requires visual review")
    return {"scale": scale, "offset": offset, "rotationDeg": 0,
            "anchorResidualsReferencePoints": residuals}


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def review(trace, original):
    from PIL import Image, ImageDraw, ImageFont
    folder = ROOT / "local/indoor-sources/csb-review"
    folder.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftoppm", "-f", "2", "-l", "4", "-r", "144", "-png",
                    str(original), str(folder / "page")], check=True)
    font = ImageFont.truetype("DejaVuSans.ttf", 20)
    for floor in trace["floors"]:
        image = Image.open(folder / f"page-{floor['page']}.png").convert("RGBA")
        layer = Image.new("RGBA", image.size)
        draw = ImageDraw.Draw(layer)
        points = lambda values: [(x * 2, y * 2) for x, y in values]
        for polygon in floor["outline"]:
            draw.line(points(polygon["outer"] + [polygon["outer"][0]]), fill=(220, 90, 0, 240), width=2)
            for hole in polygon.get("holes", []):
                draw.line(points(hole + [hole[0]]), fill=(220, 90, 0, 240), width=2)
        for room in floor["rooms"]:
            draw.polygon(points(room["polygon"]), fill=(40, 140, 255, 45), outline=(0, 90, 220, 255), width=3)
            x, y = room["labelAt"]
            draw.text((x * 2, y * 2 + 18), room["key"], fill=(0, 70, 170), font=font, anchor="mt")
        for index, (x, y) in enumerate(floor["anchors"]):
            draw.ellipse((x * 2 - 4, y * 2 - 4, x * 2 + 4, y * 2 + 4), fill=(170, 0, 180, 240))
            draw.text((x * 2 + 6, y * 2), f"A{index + 1}", fill=(170, 0, 180), font=font)
        Image.alpha_composite(image, layer).convert("RGB").save(folder / f"review-{floor['id']}.png")
    print(f"Review overlays: {folder.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    trace = json.loads(TRACE.read_text())
    original = ROOT / trace["sourceFile"]
    if original.exists():
        if hashlib.sha256(original.read_bytes()).hexdigest() != trace["sha256"]:
            raise ValueError("Original PDF checksum changed; re-review before rebuilding")
    elif args.review:
        raise FileNotFoundError("--review needs the original PDF recorded in trace.json")
    baseline = json.loads(BASE.read_text())
    result = copy.deepcopy(baseline)
    result["geometryStatus"] = "source-traced"
    result["provenance"] = ("Nine classroom outlines traced from UC San Diego's 2018 Cognitive Science Building emergency plans. "
                            "Door details and floor boundaries are simplified; relative floor alignment and heights are illustrative. "
                            "This historical plan may predate alterations.")
    result["coordinateSystem"] = {
        "units": "relative",
        "description": "1 unit = 10 PDF points on the first-floor drawing. Other floors are aligned to three common building/core corners. No measured scale or campus georeference is claimed.",
        "northDeg": 0,
        "northNote": "The north arrow printed on every source page points toward page-up; floor registration uses scale and translation only.",
    }
    result.pop("geo", None)
    result["notes"] = trace["limitations"]
    source = next(s for s in result["sources"] if s["id"] == trace["source"])
    source["imageRef"] = f"Original PDF: {trace['byteLength']} bytes; SHA-256 {trace['sha256']}"
    source["revision"] = trace["revision"]
    source["scale"] = "No scale bar or measured wall dimensions. Relative units are used."
    source["orientation"] = "North arrow points to page-up."
    source["notes"] = [trace["method"], "Physical PDF pages 2, 3 and 4 were rendered and visually reviewed; classroom room numbers were cross-checked against PDF text."]
    # Campus geometry is no longer the source of the supplemented slabs.
    result["sources"] = [s for s in result["sources"] if s["id"] != "CAMPUS-MAP"]
    reference = next(f for f in trace["floors"] if f["id"] == trace["referenceFloor"])
    registration = []
    mapped = []
    for index, floor in enumerate(result["floors"]):
        drawing = next(f for f in trace["floors"] if f["id"] == floor["id"])
        transform = fit(drawing["anchors"], reference["anchors"])
        def point(p):
            return [round((transform["scale"] * p[i] + transform["offset"][i]
                           - trace["referenceOriginPoints"][i]) * trace["localUnitsPerReferencePoint"], 5)
                    for i in (0, 1)]
        def polygon(p):
            return {"outer": [point(v) for v in p["outer"]],
                    **({"holes": [[point(v) for v in h] for h in p["holes"]]} if p.get("holes") else {})}
        floor["vertical"] = {"baseElevation": (index - 1) * 3, "height": 3, "estimated": True,
                             "note": "Illustrative spacing in relative drawing units; the PDF provides no floor heights."}
        floor["outline"] = [polygon(p) for p in drawing["outline"]]
        floor["outlineConfidence"] = "approximate"
        floor["rooms"] = []
        measurements = []
        for room in drawing["rooms"]:
            notes = ["Principal room walls traced from the source; small door recesses, wall thickness and columns are simplified."]
            refs = [{"source": trace["source"], "page": drawing["page"]}]
            if "areaSqft" in room:
                notes.append(f"Facilities lists {room['areaSqft']} sq ft. This is retained as corroborating metadata, not used to assert a measured drawing scale.")
                refs.append({"source": "UCSD-FIS", "note": "Room/floor listing and room area"})
                measurements.append({"key": room["key"], "listedAreaSqft": room["areaSqft"],
                                     "tracedAreaPdfPointsSquared": round(area(room["polygon"]), 4)})
            floor["rooms"].append({
                "id": f"CSB-EHS-{floor['id']}-{room['key']}", "label": room["key"], "scheduleKey": room["key"],
                "type": "classroom" if floor["id"] == "LL" else "unknown", "floor": floor["id"],
                "footprint": {"outer": [point(v) for v in room["polygon"]]}, "labelAt": point(room["labelAt"]),
                "confidence": {"location": "traced", "shape": "approximate", "label": "direct"}, "sources": refs, "notes": notes,
            })
            mapped.append(room["key"])
        floor["unplaced"] = [r for r in floor.get("unplaced", []) if r["scheduleKey"] not in mapped]
        floor["areas"] = []
        floor["sources"] = [{"source": trace["source"], "page": drawing["page"]}, {"source": "UCSD-FIS", "note": "Existing room/floor listing"}]
        floor["notes"] = ["Only scheduled classrooms are traced. Remaining interior spaces are not modeled; the slab follows a simplified source outline."]
        floor["transforms"] = [{"source": trace["source"], "imageSizePx": trace["pageSizePoints"],
                                "originPx": [(trace["referenceOriginPoints"][i] - transform["offset"][i]) / transform["scale"] for i in (0, 1)],
                                "rotationDeg": 0, "scale": transform["scale"] * trace["localUnitsPerReferencePoint"],
                                "note": f"Input coordinates are physical PDF points, not rendered screenshot pixels; physical PDF page {drawing['page']}."}]
        registration.append({"floor": floor["id"], "page": drawing["page"], **transform,
                             "sourceAnchors": drawing["anchors"], "referenceAnchors": reference["anchors"],
                             "roomAreas": measurements})
    expected = {"001", "002", "003", "004", "005", "115", "180", "272", "280"}
    if set(mapped) != expected or len(mapped) != 9:
        raise ValueError("Unexpected scheduled room set")
    OUTPUT.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    REPORT.write_text(json.dumps({"schemaVersion": 1, "sourcePdfSha256": trace["sha256"],
                                 "traceSha256": hashlib.sha256(TRACE.read_bytes()).hexdigest(),
                                 "output": str(OUTPUT.relative_to(ROOT)), "method": trace["registrationMethod"],
                                 "coordinateUnits": "relative", "geoReferenced": False, "floors": registration}, indent=2) + "\n")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {len(mapped)} classrooms, 3 floors, relative coordinates, no campus georeference")
    if args.review:
        review(trace, original)


if __name__ == "__main__":
    main()

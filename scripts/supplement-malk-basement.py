#!/usr/bin/env python3
"""Build the three reviewed MALK basement rooms from public FIS raster tiles.

python scripts/supplement-malk-basement.py [--review]
The source PNG, public HTML and exact pixel traces are retained for auditing.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/MALK/fis-basement-trace.json"


def read(path):
    return json.loads((ROOT / path).read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def inventory(layout):
    return sorted(room["scheduleKey"] for floor in layout["floors"]
                  for room in floor["rooms"] + floor.get("unplaced", [])
                  if room.get("scheduleKey"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    trace = read(TRACE)
    source = trace["source"]
    assert sha(source["localPath"]) == source["sha256"], "Re-review changed source raster"
    assert sha(source["htmlPath"]) == source["htmlSha256"], "Re-review changed source inventory"
    assert sha(trace["baseLayout"]) == trace["baseSha256"], "Review changed base before supplementing"
    base = read(trace["baseLayout"])
    result = copy.deepcopy(base)
    assert result["building"] == "MALK" and result["coordinateSystem"]["units"] == "meters"
    floor = next(f for f in result["floors"] if f["id"] == "B")
    assert not floor["rooms"]
    spec = importlib.util.spec_from_file_location("registration", ROOT / "scripts/supplement-ebu2-584.py")
    math_utils = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(math_utils)

    def target(item):
        return floor["outline"][item["targetPolygon"]]["outer"][item["targetVertex"]]

    controls = trace["registration"]["controlPoints"]
    a, b, tx, tz = math_utils.fit_similarity([p["sourcePoint"] for p in controls], [target(p) for p in controls])

    def transform(point):
        return [a * point[0] - b * point[1] + tx, b * point[0] + a * point[1] + tz]

    def rounded(point):
        return [round(x, 6) for x in transform(point)]

    checks = {kind: [{**p, "targetPoint": target(p), "transformedPoint": transform(p["sourcePoint"]),
                      "residualMeters": math.dist(transform(p["sourcePoint"]), target(p))}
                     for p in trace["registration"][kind]] for kind in ["controlPoints", "holdoutPoints"]}
    assert max(p["residualMeters"] for p in checks["controlPoints"]) < 0.15
    assert max(p["residualMeters"] for p in checks["holdoutPoints"]) < 0.3
    area_checks = []
    for item in trace["rooms"]:
        key = item["scheduleKey"]
        crosswalk = item["crosswalk"]
        assert crosswalk["verifiedTitle"] == item["label"] + " [" + key + "]"
        listed = next(r for r in floor["unplaced"] if r["scheduleKey"] == key)
        assert listed["areaSqft"] == item["listedAreaSqft"]
        area = math_utils.area([transform(p) for p in item["outer"]]) / 0.09290304
        delta = abs(area / item["listedAreaSqft"] - 1)
        assert delta < 0.06, "Area mismatch requires renewed review"
        area_checks.append({"scheduleKey": key, "tracedAreaSqft": area,
                            "listedAreaSqft": listed["areaSqft"], "rasterLabelAreaSqft": item["drawnAreaSqft"],
                            "relativeDifferenceFromListing": delta})
        floor["rooms"].append({
            "id": "B-FIS-" + item["label"], "label": item["label"], "scheduleKey": key,
            "type": "classroom", "floor": "B", "footprint": {"outer": [rounded(p) for p in item["outer"]]},
            "labelAt": rounded(item["labelAt"]),
            "confidence": {"location": "approximate", "shape": "approximate", "label": "direct"},
            "sources": [{"source": source["id"], "region": "West classroom wing: " + item["label"]},
                        {"source": "MALK-DETAILS-" + str(item["facilityRoomId"]), "note": "The official detail-page title explicitly gives " + crosswalk["verifiedTitle"] + "."}],
            "notes": ["The plan labels this room " + item["label"] + "; the exact retained schedule key is " + key + ".",
                      "Simplified walls traced from the 2025-03-21 public raster; no measured three-dimensional interior or current CAD-vault geometry is claimed.",
                      f"Traced area {area:.1f} sq ft; current floor-listing area {listed['areaSqft']} sq ft. This is a consistency check, not survey accuracy."]})
        result["sources"].append({"id": "MALK-DETAILS-" + str(item["facilityRoomId"]),
                                  "title": "UCSD Classroom Details — " + crosswalk["verifiedTitle"],
                                  "url": crosswalk["url"], "publisher": "UC San Diego Facilities",
                                  "building": "MALK", "floors": ["B"], "accessed": source["accessed"],
                                  "notes": ["The publicly visible title explicitly pairs source and schedule room labels. This is an identity crosswalk, not a geometry source."]})
    recovered = {r["scheduleKey"] for r in trace["rooms"]}
    floor["unplaced"] = [r for r in floor["unplaced"] if r.get("scheduleKey") not in recovered]
    floor["outline"] = [{"outer": [rounded(p) for p in trace["floorOutlinePixels"]]}]
    floor["outlineConfidence"] = "approximate"
    floor["sources"].append({"source": source["id"]})
    floor.setdefault("notes", []).extend(trace["limitations"])
    scale = math.hypot(a, b)
    origin = [(-a * tx - b * tz) / (scale * scale), (b * tx - a * tz) / (scale * scale)]
    floor["transforms"] = [{"source": source["id"], "imageSizePx": source["imageSizePx"],
                          "originPx": origin, "rotationDeg": math.degrees(math.atan2(b, a)), "scale": scale,
                          "note": "Similarity into the retained local meter frame; see explicit control and withheld points in the trace/review files."}]
    result["sources"].append({"id": source["id"], "title": "Brian C. Malk Hall — basement public FIS master-plan raster",
                              "url": source["url"], "publisher": "UC San Diego Facilities", "building": "MALK",
                              "floors": ["B"], "accessed": source["accessed"], "revision": source["printedDate"],
                              "orientation": "Printed north arrow points up; local rotation inherits approximate campus registration.",
                              "scale": "Registered to shared eastern facade corners, independently checked against listed room areas.",
                              "notes": ["Original public viewer tiles at zoom 5, assembled from _BASE and A-AREA-CAFM layers.",
                                        "Assembled raster SHA-256: " + source["sha256"],
                                        "Source plan key 11434, bkey 1001857, fcode B; displayed publication date 2025-03-21.",
                                        "Exact review scope: EB90, EB91, EB92 and simplified basement envelope only.",
                                        "FIS warns that its viewer imagery is no longer maintained; newer CAD may differ."]})
    result["provenance"] = "UC San Diego Facilities floor listings and approximate campus exterior shapes, supplemented by three west-wing basement classrooms and the basement envelope traced from the public 2025-03-21 FIS raster. Other floors remain unchanged and without room polygons."
    assert inventory(result) == inventory(base)
    assert len(inventory(result)) == len(set(inventory(result))) == 9
    assert result["geo"] == base["geo"]
    assert result["floors"][1:] == base["floors"][1:]
    report = {"schemaVersion": 1, "building": "MALK", "output": trace["output"], "source": source,
              "inputHashes": {p: sha(p) for p in [TRACE, trace["baseLayout"], source["localPath"], source["htmlPath"]]},
              "transform": {"formula": "x=a*u-b*v+tx; z=b*u+a*v+tz", "a": a, "b": b, "tx": tx, "tz": tz,
                            "metersPerPixel": scale, "rotationDeg": math.degrees(math.atan2(b, a))},
              "registrationChecks": checks, "areaChecks": area_checks,
              "recoveredScheduleKeys": sorted(recovered),
              "remainingUnplacedKeys": [r["scheduleKey"] for f in result["floors"] for r in f.get("unplaced", [])],
              "limitations": trace["limitations"]}
    (ROOT / trace["output"]).write_text(json.dumps(result, separators=(",", ":")) + "\n")
    (ROOT / "data/indoor/MALK/fis-basement-review.json").write_text(json.dumps(report, indent=2) + "\n")
    if args.review:
        from PIL import Image, ImageDraw, ImageFont
        im = Image.open(ROOT / source["localPath"]).convert("RGBA")
        assert list(im.size) == source["imageSizePx"]
        overlay = Image.new("RGBA", im.size)
        draw = ImageDraw.Draw(overlay)
        font = ImageFont.truetype("DejaVuSans.ttf", 34)
        outline = [tuple(p) for p in trace["floorOutlinePixels"]]
        draw.line(outline + [outline[0]], fill=(150, 40, 180, 255), width=5)
        for item in trace["rooms"]:
            polygon = [tuple(p) for p in item["outer"]]
            draw.polygon(polygon, fill=(40, 120, 255, 48), outline=(0, 80, 210, 255), width=5)
            x, y = item["labelAt"]
            draw.text((x, y + 45), item["scheduleKey"], fill=(0, 60, 180), font=font, anchor="mt")
        for kind, color in [("controlPoints", (200, 0, 0, 255)), ("holdoutPoints", (0, 80, 200, 255))]:
            for i, p in enumerate(checks[kind]):
                x, y = p["sourcePoint"]
                draw.ellipse((x-10, y-10, x+10, y+10), fill=color)
                draw.text((x+13, y), kind[0].upper()+str(i+1), fill=color, font=font)
        out = Image.alpha_composite(im, overlay).convert("RGB")
        folder = ROOT / "local/indoor-sources/MALK-review"
        folder.mkdir(exist_ok=True)
        out.save(folder / "B-review.png")
        out.crop((2350,1950,4050,3550)).save(folder / "B-rooms-review.png")
    print("Recovered MALK B90/B91/B92; six other keys remain unplaced; upper five floors unchanged.")


if __name__ == "__main__":
    main()

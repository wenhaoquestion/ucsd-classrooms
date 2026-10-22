#!/usr/bin/env python3
"""Reproduce 11 MANDE basement classroom traces while retaining all original rooms.

python scripts/supplement-mande-basements.py [--review]
The public L1 raster calibrates the original mirrored local frame. Shared shafts
register B1 to L1 and B2 to B1. No geographic registration is inferred.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/MANDE/fis-basements-trace.json"


def read(path):
    return json.loads((ROOT / path).read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def inventory(layout):
    return sorted(r["scheduleKey"] for f in layout["floors"]
                  for r in f["rooms"] + f.get("unplaced", []) if r.get("scheduleKey"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    trace = read(TRACE)
    assert sha(trace["baseLayout"]) == trace["baseSha256"], "Review changed base first"
    base = read(trace["baseLayout"])
    assert "geo" not in base
    result = copy.deepcopy(base)
    for source in trace["sources"].values():
        assert sha(source["localPath"]) == source["sha256"]
        assert sha(source["htmlPath"]) == source["htmlSha256"]
    spec = importlib.util.spec_from_file_location("registration", ROOT / "scripts/supplement-ebu2-584.py")
    utils = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(utils)
    l1 = next(f for f in base["floors"] if f["id"] == "L1")
    rooms = {r["label"]: r for r in l1["rooms"]}
    registration = trace["registration"]
    controls = registration["localFrame"]["controlPoints"]

    def existing(p):
        return rooms[p["room"]]["footprint"]["outer"][p["vertex"]]

    a, b, tx, tz = utils.fit_similarity([[-p["point"][0], p["point"][1]] for p in controls],
                                       [existing(p) for p in controls])

    def local(point):
        u, v = point
        return [-a*u-b*v+tx, -b*u+a*v+tz]

    review = {"schemaVersion": 1, "building": "MANDE", "output": trace["output"],
              "sources": trace["sources"], "inputHashes": {TRACE: sha(TRACE), trace["baseLayout"]: sha(trace["baseLayout"])},
              "localTransform": {"formula": "x=-a*u-b*v+tx; z=-b*u+a*v+tz", "a": a, "b": b,
                                 "tx": tx, "tz": tz, "metersPerPixel": math.hypot(a, b), "reflection": True},
              "registrationChecks": {}, "areaChecks": [], "limitations": trace["limitations"]}
    for kind in ["controlPoints", "holdoutPoints"]:
        points = [{**p, "targetPoint": existing(p), "residualMeters": math.dist(local(p["point"]), existing(p))}
                  for p in registration["localFrame"][kind]]
        assert max(p["residualMeters"] for p in points) < 0.04
        review["registrationChecks"]["L1-"+kind] = points
    cross = {}
    for floor_id in ["B1", "B2"]:
        reg = registration[floor_id]
        pars = utils.fit_similarity([p["sourcePoint"] for p in reg["controlPoints"]],
                                    [p["targetPoint"] for p in reg["controlPoints"]])
        aa, bb, xx, yy = pars
        cross[floor_id] = pars
        review.setdefault("crossFloorTransforms", {})[floor_id] = {
            "target": reg["target"], "formula": "u=a*x-b*y+tx; v=b*x+a*y+ty",
            "a": aa, "b": bb, "tx": xx, "ty": yy, "method": reg["method"]}
        for kind in ["controlPoints", "holdoutPoints"]:
            checks = []
            for p in reg[kind]:
                x, y = p["sourcePoint"]
                transformed = [aa*x-bb*y+xx, bb*x+aa*y+yy]
                checks.append({**p, "residualTargetPixels": math.dist(transformed, p["targetPoint"])})
            assert max(p["residualTargetPixels"] for p in checks) < 0.1
            review["registrationChecks"][floor_id+"-"+kind] = checks

    def to_local(floor_id, point):
        aa, bb, xx, yy = cross[floor_id]
        u, v = point
        transformed = [aa*u-bb*v+xx, bb*u+aa*v+yy]
        return local(transformed) if floor_id == "B1" else to_local("B1", transformed)

    def rounded(floor_id, point):
        return [round(v, 6) for v in to_local(floor_id, point)]

    for floor_id in ["B1", "B2"]:
        floor = next(f for f in result["floors"] if f["id"] == floor_id)
        assert not floor["rooms"]
        source = trace["sources"][floor_id]
        items = [r for r in trace["rooms"] if r["floor"] == floor_id]
        for item in items:
            key = item["scheduleKey"]
            assert sum(r["scheduleKey"] == key for r in floor["unplaced"]) == 1
            area = utils.area([to_local(floor_id, p) for p in item["outer"]]) / 0.09290304
            difference = abs(area / item["drawnAreaSqft"] - 1)
            assert difference < 0.10, (key, area, item["drawnAreaSqft"])
            review["areaChecks"].append({"scheduleKey": key, "tracedAreaSqft": area,
                                          "printedAreaSqft": item["drawnAreaSqft"], "relativeDifference": difference})
            floor["rooms"].append({"id": floor_id+"-FIS-"+key, "label": key, "scheduleKey": key,
                                   "floor": floor_id, "type": "classroom",
                                   "footprint": {"outer": [rounded(floor_id, p) for p in item["outer"]]},
                                   "labelAt": rounded(floor_id, item["labelAt"]),
                                   "confidence": {"location": "approximate", "shape": "approximate", "label": "direct"},
                                   "sources": [{"source": source["id"], "region": "Room "+key,
                                                "note": "Exact printed room label; no inferred prefix or area-based identity matching."}],
                                   "notes": ["Simplified walls traced from the public master plan dated "+source["printedDate"]+".",
                                             f"Traced area {area:.1f} sq ft; printed area {item['drawnAreaSqft']} sq ft. Area is an independent consistency check, not survey accuracy."]})
        recovered = {r["scheduleKey"] for r in items}
        floor["unplaced"] = [r for r in floor["unplaced"] if r["scheduleKey"] not in recovered]
        floor["outline"] = [{"outer": [rounded(floor_id, p) for p in part["outer"]]}
                            for part in trace["floorOutlines"][floor_id]]
        floor["outlineConfidence"] = "approximate"
        floor["sources"].extend([{"source": source["id"]}, {"source": trace["sources"]["L1"]["id"], "note": "Cross-floor registration only."}])
        floor["notes"] = trace["limitations"][:]
        # SourceTransform has no reflection field; retain the complete matrix in
        # the audit JSON instead of serializing an incorrect rotation-only transform.
        floor.pop("transforms", None)
    for floor_id, source in trace["sources"].items():
        result["sources"].append({"id": source["id"], "title": source["title"], "url": source["url"],
                                  "publisher": "UC San Diego Facilities", "building": "MANDE", "floors": [floor_id],
                                  "accessed": source["accessed"], "revision": source["printedDate"],
                                  "notes": ["Public FIS raster tiles at native zoom 5; original PNG SHA-256: "+source["sha256"],
                                            "Review scope: "+("calibration corners of rooms 101, 103, 134 and shared shaft geometry; no new L1 room geometry." if floor_id == "L1" else ", ".join(r["scheduleKey"] for r in trace["rooms"] if r["floor"] == floor_id)+" and the reviewed outline portions only."),
                                            "Viewer imagery may be outdated; no newer CAD-vault export is claimed."]})
    result["provenance"] = "Original 114 Facilities room polygons, supplemented by 11 basement teaching rooms traced from public 2018/2024 master-plan rasters; 2017 L1 raster and shared shafts calibrate the existing mirrored local frame."
    assert result["floors"][2:] == base["floors"][2:]
    assert sum(len(f["rooms"]) for f in result["floors"]) == 125
    assert inventory(result) == inventory(base)
    assert len(inventory(result)) == len(set(inventory(result)))
    assert "geo" not in result
    review["recoveredScheduleKeys"] = sorted(r["scheduleKey"] for r in trace["rooms"])
    review["remainingUnplacedKeys"] = [r["scheduleKey"] for f in result["floors"] for r in f.get("unplaced", [])]
    assert review["remainingUnplacedKeys"] == ["212"]
    (ROOT / trace["output"]).write_text(json.dumps(result, separators=(",", ":"))+"\n")
    (ROOT / "data/indoor/MANDE/fis-basements-review.json").write_text(json.dumps(review, indent=2)+"\n")
    if args.review:
        from PIL import Image, ImageDraw, ImageFont
        folder = ROOT / "local/indoor-sources/MANDE-review"
        folder.mkdir(exist_ok=True)
        for floor_id in ["B1", "B2"]:
            im = Image.open(ROOT / trace["sources"][floor_id]["localPath"]).convert("RGBA")
            overlay = Image.new("RGBA", im.size)
            draw = ImageDraw.Draw(overlay)
            font = ImageFont.truetype("DejaVuSans.ttf", 33)
            for part in trace["floorOutlines"][floor_id]:
                p = [tuple(v) for v in part["outer"]]
                draw.line(p+[p[0]], fill=(140,40,180,255), width=4)
            for r in trace["rooms"]:
                if r["floor"] != floor_id:
                    continue
                draw.polygon([tuple(p) for p in r["outer"]], fill=(20,120,255,45), outline=(0,80,200,255), width=4)
                x,y = r["labelAt"]
                draw.text((x,y+44), r["scheduleKey"], fill=(0,60,180), font=font, anchor="mt")
            out = Image.alpha_composite(im,overlay).convert("RGB")
            out.save(folder / (floor_id+"-review.png"))
            if floor_id == "B1":
                for name, crop in [("north",(1220,1200,2920,2240)),("central",(2050,2500,2970,3280)),("south",(2170,3200,3970,4230))]:
                    out.crop(crop).save(folder / (floor_id+"-"+name+"-review.png"))
    print("Recovered 11 MANDE basement keys; preserved 114 existing rooms and mirrored frame without geo; 212 remains unplaced.")


if __name__ == "__main__":
    main()

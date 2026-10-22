#!/usr/bin/env python3
"""Add EBU1 2315 from an inspected PDF with reproducible registration checks.

The source PDF is hash-pinned. No other floor, the campus frame, or the
inherited approximate floor plate is changed. Uses Python's standard library.
"""

import copy
import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/EBU1/ehs-2315-trace.json"
OUTPUT = "static/indoor/EBU1-combined.json"
REPORT = "data/indoor/EBU1/supplement-2315.json"


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def fit_similarity(source, target):
    src_mean = [sum(p[i] for p in source) / len(source) for i in range(2)]
    dst_mean = [sum(p[i] for p in target) / len(target) for i in range(2)]
    src = [[p[i] - src_mean[i] for i in range(2)] for p in source]
    dst = [[p[i] - dst_mean[i] for i in range(2)] for p in target]
    denominator = sum(x * x + y * y for x, y in src)
    a = sum(p[0] * q[0] + p[1] * q[1] for p, q in zip(src, dst)) / denominator
    b = sum(p[0] * q[1] - p[1] * q[0] for p, q in zip(src, dst)) / denominator
    return (a, b, dst_mean[0] - a * src_mean[0] + b * src_mean[1],
            dst_mean[1] - b * src_mean[0] - a * src_mean[1])


def inside(point, ring):
    found = False
    x, y = point
    for p, q in zip(ring, ring[1:] + ring[:1]):
        if (p[1] > y) != (q[1] > y):
            if x < p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]):
                found = not found
    return found


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    source = trace["source"]
    pdf = (ROOT / source["localPath"]).read_bytes()
    if not pdf.startswith(b"%PDF-") or hashlib.sha256(pdf).hexdigest() != source["sha256"]:
        raise ValueError("Source differs from the visually reviewed PDF")
    registration = trace["registration"]
    layout_path = registration["targetLayout"]
    original = json.loads((ROOT / layout_path).read_text())
    if original["building"] != "EBU1" or original["coordinateSystem"]["units"] != "meters":
        raise ValueError("Expected EBU1 Facilities geometry in meters")
    reference = next(f for f in original["floors"] if f["id"] == registration["targetFloor"])
    reference_rooms = {r["label"]: r for r in reference["rooms"]}

    def target_point(control):
        return reference_rooms[control["targetRoom"]]["footprint"]["outer"][control["targetVertex"]]

    controls = registration["controlPoints"]
    a, b, tx, tz = fit_similarity([p["sourcePoint"] for p in controls], [target_point(p) for p in controls])

    def transform(point):
        return [a * point[0] - b * point[1] + tx, b * point[0] + a * point[1] + tz]

    checks = {}
    for key in ("controlPoints", "holdoutPoints"):
        checks[key] = [{**p, "targetPoint": target_point(p), "transformedPoint": transform(p["sourcePoint"]),
                        "residualMeters": math.dist(transform(p["sourcePoint"]), target_point(p))}
                       for p in registration[key]]
    if max(p["residualMeters"] for p in checks["controlPoints"]) > 0.1:
        raise ValueError("Control fit has changed; review source registration")
    if max(p["residualMeters"] for p in checks["holdoutPoints"]) > 0.2:
        raise ValueError("Withheld structural checks no longer agree")

    combined = copy.deepcopy(original)
    floor = next(f for f in combined["floors"] if f["id"] == "L2")
    if floor["rooms"]:
        raise ValueError("Level 2 now contains geometry; review before supplementing")
    listed = next(r for r in floor["unplaced"] if r["scheduleKey"] == "2315")
    room = trace["room"]
    if listed["areaSqft"] != room["listedAreaSqft"]:
        raise ValueError("Listed area has changed; review the original drawing")
    bounds = room["labelBounds"]
    label_point = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
    if not inside(label_point, room["outer"]):
        raise ValueError("Original PDF label is outside the traced room")
    polygon = [transform(p) for p in room["outer"]]
    area_sqft = area(polygon) / 0.09290304
    area_difference = abs(area_sqft / listed["areaSqft"] - 1)
    if area_difference > 0.1:
        raise ValueError("Traced and listed areas disagree by more than 10 percent")
    note = ("Room 2315 is traced from the actual 2021 emergency plan, page 4, including visible column intrusions. "
            "Placement is approximately registered through repeated mechanical-tower corners to existing Level 3 geometry. "
            "The campus fit and vertical spacing remain approximate; later alterations cannot be excluded.")
    floor["rooms"] = [{
        "id": "L2-EHS-2315", "label": "2315", "scheduleKey": "2315", "type": "classroom", "floor": "L2",
        "footprint": {"outer": [[round(v, 6) for v in p] for p in polygon]},
        "labelAt": [round(v, 6) for v in transform(label_point)],
        "confidence": {"location": "approximate", "shape": "approximate", "label": "direct"},
        "sources": [{"source": source["id"], "page": 4, "region": "West side of central north-south lab wing; room marked 2315"},
                    {"source": "UCSD-FIS", "note": "Level 2 listing, 936 ft2 area cross-check, and Level 3 structural-tower registration"}],
        "notes": [note, f"Traced area {area_sqft:.1f} ft2 versus listed 936 ft2 ({100 * area_difference:.2f}% difference). This consistency check does not establish survey accuracy."]
    }]
    floor["unplaced"] = [r for r in floor["unplaced"] if r["scheduleKey"] != "2315"]
    floor["sources"].append({"source": source["id"], "page": 4})
    floor["notes"] = [note, "The surrounding Level 2 floor plate remains the pre-existing copied outline; this supplement verifies room 2315 only."]
    combined["sources"].append({
        "id": source["id"], "title": "Jacobs Hall / Engineering Building Unit I emergency floor plans",
        "url": source["url"], "publisher": "UC San Diego EH&S / Jacobs School of Engineering",
        "building": "EBU1", "floors": ["L2"], "page": 4, "accessed": source["accessed"], "revision": source["printedDate"],
        "orientation": "Printed north arrow points up on the page.",
        "scale": "Matched to repeated mechanical-tower corners in the existing Facilities meter frame; no independent surveyed scale.",
        "notes": ["PDF SHA-256: " + source["sha256"], "Source trace and registration checks: data/indoor/EBU1/ehs-2315-trace.json and supplement-2315.json"]
    })
    combined["provenance"] += " Second-floor room 2315 is supplemented from a visually reviewed 2021 emergency plan with approximate structural registration and an area consistency check."
    (ROOT / OUTPUT).write_text(json.dumps(combined, separators=(",", ":")) + "\n")
    report = {
        "schemaVersion": 1, "building": "EBU1", "output": OUTPUT,
        "inputHashes": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in (TRACE, layout_path, source["localPath"])},
        "source": source,
        "transform": {"formula": "x = a*u - b*v + tx; z = b*u + a*v + tz", "a": a, "b": b, "tx": tx, "tz": tz,
                      "metersPerPDFPoint": math.hypot(a, b), "rotationDeg": math.degrees(math.atan2(b, a))},
        "registrationChecks": checks,
        "areaCheck": {"tracedAreaSqft": area_sqft, "listedAreaSqft": listed["areaSqft"], "relativeDifference": area_difference},
        "addedRoomPolygons": 1, "recoveredScheduleKeys": ["2315"],
        "remainingUnplacedKeys": [r["scheduleKey"] for f in combined["floors"] for r in f.get("unplaced", [])],
        "limitations": trace["limitations"]
    }
    (ROOT / REPORT).write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {OUTPUT}: EBU1 2315, {area_sqft:.1f} versus 936 ft2 ({area_difference:.2%} difference)")
    print(f"Maximum withheld structural-corner residual: {max(p['residualMeters'] for p in checks['holdoutPoints']):.4f} m; campus placement remains approximate")


if __name__ == "__main__":
    main()

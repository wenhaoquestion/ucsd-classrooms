#!/usr/bin/env python3
"""Recover EBU2 584 from the acquired, visually reviewed emergency-plan PDF.

Pure Python; one similarity fit, two withheld checks, and an independent
listed-area check. No other EBU2 floor or room is modified.
"""

import copy
import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/EBU2/ehs-584-trace.json"
OUTPUT = "static/indoor/EBU2-combined.json"
REPORT = "data/indoor/EBU2/supplement-584.json"


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def fit_similarity(source, target):
    source_mean = [sum(p[i] for p in source) / len(source) for i in range(2)]
    target_mean = [sum(p[i] for p in target) / len(target) for i in range(2)]
    src = [[p[i] - source_mean[i] for i in range(2)] for p in source]
    dst = [[p[i] - target_mean[i] for i in range(2)] for p in target]
    denominator = sum(x * x + y * y for x, y in src)
    a = sum(p[0] * q[0] + p[1] * q[1] for p, q in zip(src, dst)) / denominator
    b = sum(p[0] * q[1] - p[1] * q[0] for p, q in zip(src, dst)) / denominator
    tx = target_mean[0] - a * source_mean[0] + b * source_mean[1]
    tz = target_mean[1] - b * source_mean[0] - a * source_mean[1]
    return a, b, tx, tz


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    source = trace["source"]
    pdf = (ROOT / source["localPath"]).read_bytes()
    digest = hashlib.sha256(pdf).hexdigest()
    if not pdf.startswith(b"%PDF-") or digest != source["sha256"]:
        raise ValueError("Source PDF differs from the visually reviewed document")
    layout_path = trace["registration"]["targetLayout"]
    target = json.loads((ROOT / layout_path).read_text())
    if target["building"] != "EBU2" or target["coordinateSystem"]["units"] != "meters":
        raise ValueError("Expected EBU2 Facilities geometry in meters")
    reference_floor = next(f for f in target["floors"] if f["id"] == trace["registration"]["targetFloor"])
    reference_rooms = {r["label"]: r for r in reference_floor["rooms"]}

    def target_point(control):
        return reference_rooms[control["targetRoom"]]["footprint"]["outer"][control["targetVertex"]]

    controls = trace["registration"]["controlPoints"]
    a, b, tx, tz = fit_similarity([p["sourcePoint"] for p in controls], [target_point(p) for p in controls])

    def transform(point):
        return [a * point[0] - b * point[1] + tx, b * point[0] + a * point[1] + tz]

    checks = {}
    for key in ("controlPoints", "holdoutPoints"):
        checks[key] = [{**point, "targetPoint": target_point(point),
                        "transformedPoint": transform(point["sourcePoint"]),
                        "residualMeters": math.dist(transform(point["sourcePoint"]), target_point(point))}
                       for point in trace["registration"][key]]
    if max(p["residualMeters"] for p in checks["controlPoints"]) > 0.1:
        raise ValueError("Control fit changed; review registration")
    if max(p["residualMeters"] for p in checks["holdoutPoints"]) > 0.2:
        raise ValueError("Withheld facade checks changed; review registration")

    combined = copy.deepcopy(target)
    floor = next(f for f in combined["floors"] if f["id"] == "L5")
    if floor["rooms"]:
        raise ValueError("Level 5 now contains polygons; review instead of replacing")
    listed = next(r for r in floor["unplaced"] if r["scheduleKey"] == "584")
    room_trace = trace["rooms"][0]
    if listed["areaSqft"] != room_trace["listedAreaSqft"]:
        raise ValueError("Listed area has changed; review the source")
    polygon = [transform(p) for p in room_trace["outer"]]
    area_sqft = area(polygon) / 0.09290304
    area_difference = abs(area_sqft / listed["areaSqft"] - 1)
    if area_difference > 0.1:
        raise ValueError("Traced and listed areas disagree by more than 10 percent")
    bounds = room_trace["labelBounds"]
    label_point = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
    if not (149.76 < label_point[0] < 186.96 and 313.2 < label_point[1] < 386.88):
        raise ValueError("PDF room label is outside its traced room")
    note = ("Traced from the actual 2021 emergency plan, page 7. Placement is approximate, registered to the repeated office-wing facade in existing Level 2 geometry; "
            "small jamb/column recesses are simplified. The inherited campus fit and vertical spacing remain approximate. Later alterations cannot be excluded.")
    floor["rooms"] = [{
        "id": "L5-EHS-584", "label": "584", "scheduleKey": "584", "type": "classroom", "floor": "L5",
        "footprint": {"outer": [[round(v, 6) for v in p] for p in polygon]},
        "labelAt": [round(v, 6) for v in transform(label_point)],
        "confidence": {"location": "approximate", "shape": "approximate", "label": "direct"},
        "sources": [{"source": source["id"], "page": 7, "region": "West office wing, central rectangular room marked 584"},
                    {"source": "UCSD-FIS", "note": "Level 5 listing, 896 ft2 area check, and Level 2 facade registration"}],
        "notes": [note, f"Traced area {area_sqft:.1f} ft2 versus listed 896 ft2 ({100 * area_difference:.2f}% difference); this is a consistency check, not survey accuracy."]
    }]
    floor["unplaced"] = [r for r in floor["unplaced"] if r["scheduleKey"] != "584"]
    floor["sources"].append({"source": source["id"], "page": 7})
    floor["notes"] = ["Room 584 is traced from the 2021 emergency plan. The surrounding floor plate remains copied from Level 2 and is not a verified fifth-floor or roof outline.", note]
    existing_source = next((s for s in combined["sources"] if s["id"] == source["id"]), None)
    supplemental_source = {
        "id": source["id"], "title": "Engineering Building Unit II emergency floor plans",
        "url": source["url"], "publisher": "UC San Diego Jacobs School of Engineering / EH&S",
        "building": "EBU2", "floors": list(dict.fromkeys((existing_source or {}).get("floors", []) + ["L5"])),
        "accessed": source["accessed"], "revision": source["printedDate"],
        "orientation": "Printed north arrow points up on the page.",
        "scale": "No independent surveyed scale; matched to repeated facade corners in the existing meter frame.",
        "notes": (existing_source or {}).get("notes", []) + ["PDF SHA-256: " + digest, "Page 7 room 584 is visually traced; registration trace and checks: data/indoor/EBU2/ehs-584-trace.json and supplement-584.json"]
    }
    if existing_source is None:
        combined["sources"].append(supplemental_source)
    else:
        existing_source.update(supplemental_source)
    combined["provenance"] += " Fifth-floor room 584 is supplemented from a visually reviewed 2021 emergency plan with explicit approximate registration and an area consistency check."
    (ROOT / OUTPUT).write_text(json.dumps(combined, separators=(",", ":")) + "\n")
    report = {
        "schemaVersion": 1, "building": "EBU2", "output": OUTPUT,
        "inputHashes": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (TRACE, layout_path, source["localPath"])},
        "source": source,
        "transform": {"formula": "x = a*u - b*v + tx; z = b*u + a*v + tz", "a": a, "b": b, "tx": tx, "tz": tz,
                      "metersPerPDFPoint": math.hypot(a, b), "rotationDeg": math.degrees(math.atan2(b, a))},
        "registrationChecks": checks,
        "areaCheck": {"tracedAreaSqft": area_sqft, "listedAreaSqft": listed["areaSqft"], "relativeDifference": area_difference},
        "addedRoomPolygons": 1, "recoveredScheduleKeys": ["584"],
        "remainingUnplacedKeys": [r["scheduleKey"] for f in combined["floors"] for r in f.get("unplaced", [])],
        "limitations": trace["limitations"]
    }
    (ROOT / REPORT).write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {OUTPUT}: EBU2 584, area {area_sqft:.1f} versus {listed['areaSqft']} ft2 ({area_difference:.2%} difference)")
    print(f"Maximum withheld facade-corner residual: {max(p['residualMeters'] for p in checks['holdoutPoints']):.4f} m; inherited campus placement remains approximate")


if __name__ == "__main__":
    main()

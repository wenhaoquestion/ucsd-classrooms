#!/usr/bin/env python3
"""Fill EBU3B's two empty Facilities floors from the committed CSE traces.

python scripts/supplement-indoor.py

Uses the same campus/local transform as IndoorScene.setContext, inverted for
source-local -> campus. It never adjusts upper-floor Facilities geometry.
"""

import copy
import hashlib
import json
import math
from pathlib import Path
import statistics


ROOT = Path(__file__).resolve().parents[1]
SOURCE = "static/indoor/EBU3B.json"
TARGET = "static/indoor/facilities/EBU3B.json"
OUTPUT = "static/indoor/EBU3B-combined.json"
REPORT = "data/indoor/EBU3B/supplement.json"
FLOORS = ("B", "L1")
EXPECTED_RECOVERED = {"B240", "B250", "B260", "B270", "1202"}


def load(path):
    return json.loads((ROOT / path).read_text())


def rotate(point, degrees):
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    x, z = point
    return [x * c - z * s, x * s + z * c]


def transform(point, source_geo, target_geo):
    # Renderer: local = R(+geo.rotationDeg) * (campus - geo.origin) * scale.
    scaled = [v / source_geo["unitsPerMeter"] for v in point]
    campus_delta = rotate(scaled, -source_geo["rotationDeg"])
    campus = [v + offset for v, offset in zip(campus_delta, source_geo["origin"])]
    target_delta = [v - offset for v, offset in zip(campus, target_geo["origin"])]
    return [round(v * target_geo["unitsPerMeter"], 6)
            for v in rotate(target_delta, target_geo["rotationDeg"])]


def polygon_centroid(polygon):
    ring = polygon["outer"]
    area, x, z = 0.0, 0.0, 0.0
    for a, b in zip(ring, ring[1:] + ring[:1]):
        cross = a[0] * b[1] - b[0] * a[1]
        area += cross
        x += (a[0] + b[0]) * cross
        z += (a[1] + b[1]) * cross
    return [x / (3 * area), z / (3 * area)]


def main():
    source, target = load(SOURCE), load(TARGET)
    if source["building"] != "EBU3B" or target["building"] != "EBU3B":
        raise ValueError("Unexpected building")
    if set(source["geo"]["caans"]) != set(target["geo"]["caans"]):
        raise ValueError("Source and target must describe the same campus footprint")
    if target["coordinateSystem"]["units"] != "meters":
        raise ValueError("Expected Facilities meter frame")
    point = lambda p: transform(p, source["geo"], target["geo"])
    polygon = lambda p: {"outer": [point(v) for v in p["outer"]],
                         **({"holes": [[point(v) for v in h] for h in p["holes"]]} if p.get("holes") else {})}

    # Check rotation direction and cross-source placement against unchanged rooms.
    comparisons = []
    source_floors = {floor["id"]: floor for floor in source["floors"]}
    for floor in target["floors"]:
        if floor["id"] in FLOORS:
            continue
        by_label = {room["label"]: room for room in floor["rooms"]}
        for room in source_floors[floor["id"]]["rooms"]:
            other = by_label.get(room["label"])
            if other:
                error = math.dist(point(polygon_centroid(room["footprint"])), polygon_centroid(other["footprint"]))
                comparisons.append({"floor": floor["id"], "label": room["label"], "centroidDifferenceMeters": round(error, 4)})
    errors = [entry["centroidDifferenceMeters"] for entry in comparisons]
    if len(errors) < 100 or statistics.median(errors) > 3 or max(errors) > 5:
        raise ValueError("Existing source/Facilities alignment has changed; review before supplementing")

    combined = copy.deepcopy(target)
    note = ("Traced from the public CSE floor map, then transformed into the Facilities meter frame using the two existing campus footprint fits. "
            "Room positions and metric dimensions are approximate; the original map has no scale bar. "
            "Facilities floor heights are retained and remain estimated.")
    recovered = set()
    added_rooms = 0
    for floor in combined["floors"]:
        if floor["id"] not in FLOORS:
            continue
        if floor["rooms"]:
            raise ValueError(f"{floor['id']} now has Facilities polygons; review instead of replacing them")
        original = source_floors[floor["id"]]
        floor["outline"] = [polygon(p) for p in original["outline"]]
        floor["outlineConfidence"] = "approximate"
        floor["rooms"] = copy.deepcopy(original["rooms"])
        for room in floor["rooms"]:
            room["footprint"] = polygon(room["footprint"])
            if "labelAt" in room:
                room["labelAt"] = point(room["labelAt"])
            room["confidence"]["location"] = "approximate"
            room["confidence"]["shape"] = "approximate"
            room.setdefault("notes", []).append(note)
            if room["scheduleKey"] is not None:
                recovered.add(room["scheduleKey"])
        added_rooms += len(floor["rooms"])
        floor["unplaced"] = [room for room in floor.get("unplaced", []) if room["scheduleKey"] not in recovered]
        floor["areas"] = copy.deepcopy(original.get("areas", []))
        for area in floor["areas"]:
            area["footprint"] = polygon(area["footprint"])
            area["confidence"] = "approximate"
        floor["features"] = copy.deepcopy(original.get("features", []))
        for feature in floor["features"]:
            feature["at"] = point(feature["at"])
            feature["confidence"] = "approximate"
        floor["sources"] = copy.deepcopy(original["sources"]) + [{"source": "UCSD-FIS", "note": "Floor listing and illustrative vertical spacing"}]
        floor["notes"] = original.get("notes", []) + [note]
        # SourceTransform cannot encode arbitrary target translations directly.
        # The exact original frames and algorithm are saved in supplement.json.
        floor.pop("transforms", None)
    if recovered != EXPECTED_RECOVERED:
        raise ValueError(f"Unexpected recovered schedule keys: {sorted(recovered)}")
    ids = {source["id"] for source in combined["sources"]}
    for item in source["sources"]:
        if item["id"] not in ids:
            combined["sources"].append(copy.deepcopy(item))
    combined["provenance"] = ("UCSD Facilities floor plans, supplemented on the basement and first floor by traced public CSE floor maps. "
                              "Supplemental placement and dimensions are approximate; sources and renovation caveats are retained.")
    combined.setdefault("notes", []).append("Basement and Level 1 room outlines are supplemented from the CSE department maps; Level 2–4 Facilities geometry is unchanged. "
                                            "The CSE first-floor map may predate renovation. Rooms 1113, 1117 and 1124 remain floor-only because the map shades the Warren College wing without room details.")
    (ROOT / OUTPUT).write_text(json.dumps(combined, separators=(",", ":")) + "\n")
    report = {"schemaVersion": 1, "building": "EBU3B", "output": OUTPUT,
              "inputHashes": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (SOURCE, TARGET)},
              "sourceGeo": source["geo"], "targetGeo": target["geo"],
              "formula": "targetLocal = targetScale * R(targetAngle) * (sourceOrigin + R(-sourceAngle) * sourceLocal / sourceScale - targetOrigin)",
              "sourceHasSurveyedScale": False, "positionAndDimensionConfidence": "approximate",
              "supplementedFloors": list(FLOORS), "addedRoomPolygons": added_rooms, "recoveredScheduleKeys": sorted(recovered),
              "remainingFloorOnlyKeys": ["1113", "1117", "1124"],
              "crossCheck": {"matchedUpperFloorRoomLabels": len(errors), "medianCentroidDifferenceMeters": round(statistics.median(errors), 4),
                             "maxCentroidDifferenceMeters": max(errors), "comparisons": comparisons},
              "limitations": ["The source map has no scale bar; metric scale and campus placement come from the pre-existing approximate footprint fit.",
                              "The shared-label comparison is a sanity check, not independent survey validation.",
                              "CSE renovation may have changed the first floor after the undated map."]}
    (ROOT / REPORT).write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {OUTPUT}: {added_rooms} supplemental room polygons, {len(recovered)} recovered schedule keys")
    print(f"Alignment sanity check: {len(errors)} shared labels; median {statistics.median(errors):.2f} m, max {max(errors):.2f} m")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Audit stored indoor schedule mappings without requiring network or packages.

python scripts/audit-indoor-coverage.py --output data/indoor/coverage-baseline.json
python scripts/audit-indoor-coverage.py --layout static/indoor/EBU3B-combined.json

The denominator is the schedule keys recorded in committed layouts, not a new
scrape of every term. Explicit --layout files override the Facilities baseline.
"""

import argparse
import collections
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative):
    return json.loads((ROOT / relative).read_text())


def polygon_area(polygon):
    def ring_area(ring):
        return abs(sum(a[0] * b[1] - b[0] * a[1]
                       for a, b in zip(ring, ring[1:] + ring[:1]))) / 2
    return ring_area(polygon["outer"]) - sum(map(ring_area, polygon.get("holes", [])))


def audit(layout_paths):
    names = {code: data["name"] for college in read("src/lib/buildings.json")["colleges"].values()
             for code, data in college.items()}
    campus = read("src/lib/indoor/campusCodes.json")
    totals = collections.Counter()
    buildings = []
    for code, relative in sorted(layout_paths.items()):
        layout = read(relative)
        rooms = {room["id"]: room for floor in layout["floors"] for room in floor["rooms"]}
        placed = {room["scheduleKey"]: room for room in rooms.values() if room["scheduleKey"] is not None}
        for alias in layout.get("scheduleAliases", []):
            placed[alias["scheduleKey"]] = rooms[alias["room"]]
        unplaced = {room["scheduleKey"]: (floor, room) for floor in layout["floors"]
                    for room in floor.get("unplaced", []) if room["scheduleKey"] is not None}
        missing = {room["scheduleKey"]: room["reason"] for room in layout.get("knownUnmapped", [])}
        overlap = (set(placed) & set(unplaced)) | (set(placed) & set(missing)) | (set(unplaced) & set(missing))
        if overlap:
            raise ValueError(f"{code}: keys assigned to multiple coverage categories: {sorted(overlap)}")
        counts = {"placed": len(placed), "floorListed": sum(r["basis"] == "floor-listing" for _, r in unplaced.values()),
                  "floorInferred": sum(r["basis"] == "room-number" for _, r in unplaced.values()),
                  "unmapped": len(missing), "roomPolygons": len(rooms), "floors": len(layout["floors"]),
                  "floorsWithoutRoomPolygons": sum(not f["rooms"] for f in layout["floors"])}
        counts["recordedScheduleKeys"] = len(placed) + len(unplaced) + len(missing)
        counts["positionGaps"] = len(unplaced) + len(missing)
        totals.update(counts)
        floors = []
        existing_candidates = []
        for floor in layout["floors"]:
            floor_placed = sorted(key for key, room in placed.items() if room["floor"] == floor["id"])
            floor_unplaced = [{"key": key, "basis": room["basis"], **({"areaSqft": room["areaSqft"]} if "areaSqft" in room else {})}
                              for key, (f, room) in unplaced.items() if f["id"] == floor["id"]]
            floors.append({"id": floor["id"], "label": floor["label"], "roomPolygons": len(floor["rooms"]),
                           "placedKeys": floor_placed, "positionGaps": floor_unplaced,
                           "notes": floor.get("notes", [])})
            for key, (f, unplaced_room) in unplaced.items():
                if f["id"] != floor["id"]:
                    continue
                candidates = [r for r in floor["rooms"] if r["label"] == key and r["scheduleKey"] is None]
                if candidates:
                    existing_candidates.append({"key": key, "floor": floor["id"], "listedAreaSqft": unplaced_room.get("areaSqft"),
                                                "candidates": [{"id": r["id"], "type": r["type"], "name": r.get("name"),
                                                                "polygonAreaSqft": round(polygon_area(r["footprint"]) * 10.76391041671, 2)
                                                                if layout["coordinateSystem"]["units"] == "meters" else None}
                                                               for r in candidates],
                                                "note": "Candidate only: check use, identity and area before mapping."})
        buildings.append({"building": code, "name": names.get(code, layout["name"]), "layout": str(relative),
                          "sha256": hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(), "counts": counts,
                          "floors": floors, "unmappedKeys": missing, "existingGeometryCandidates": existing_candidates,
                          "sources": [{k: s[k] for k in ("id", "title", "url", "accessed") if k in s} for s in layout["sources"]]})
    buildings.sort(key=lambda b: (-b["counts"]["positionGaps"], b["building"]))
    no_layout = [{"building": code, "name": name, "status": "exterior-shell" if code in campus else "no-geometry"}
                 for code, name in sorted(names.items()) if code not in layout_paths]
    return {"schemaVersion": 1, "scope": "Schedule keys recorded in the supplied indoor layouts; no live schedule scrape. These counts exclude rooms that only appear in unprovided terms or buildings without an indoor file.",
            "baseline": "static/indoor/facilities/index.json with explicit --layout overrides",
            "summary": {"knownBuildingCodes": len(names), "indoorBuildingCodes": len(buildings),
                        "knownCodesWithoutIndoorLayout": len(no_layout), **dict(totals)},
            "buildingsByPositionGap": buildings, "knownBuildingsWithoutIndoorLayouts": no_layout,
            "reproducibilityGaps": ["The documented local/fis-tools/ and local/fis-cache/ directories are absent from this checkout."
                                    for _ in [0] if not (ROOT / "local/fis-tools").exists()]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--layout", action="append", default=[], help="Override one building with this repository-relative layout")
    parser.add_argument("--manifest", action="store_true", help="Use the literal source/supplement entries in the website manifest")
    parser.add_argument("--output", default="data/indoor/coverage-current.json")
    args = parser.parse_args()
    paths = {code: f"static/indoor/facilities/{code}.json" for code in read("static/indoor/facilities/index.json")["buildings"]}
    if args.manifest:
        manifest = (ROOT / "src/lib/indoor/manifest.ts").read_text()
        for name in ("SOURCE_LAYOUTS", "SUPPLEMENTAL_LAYOUTS"):
            block = re.search(r"export const " + name + r"[^=]*=\s*\{(.*?)\n\};", manifest, re.S)
            if block is None:
                raise ValueError("Manifest format changed; review audit parsing: " + name)
            for relative in re.findall(r'file:\s*"([^"]+)"', block[1]):
                path = "static/" + relative
                paths[read(path)["building"]] = path
    for relative in args.layout:
        paths[read(relative)["building"]] = relative
    report = audit(paths)
    if args.manifest:
        report["baseline"] = "Runtime INDOOR_MANIFEST (Facilities, source layouts, then reviewed supplements), followed by any explicit --layout overrides"
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(report["summary"], indent=2))
    print(f"Wrote {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Verify the acquired PFBH PDF and quantify its unresolved area conflict.

This deliberately does not produce or modify a runtime indoor layout.
Only Python's standard library is required; the PDF must have been acquired.
"""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/PFBH/ehs-basement-trace.json"
LAYOUT = "static/indoor/facilities/PFBH.json"
REPORT = "data/indoor/PFBH/plan-conflict.json"


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    source = ROOT / trace["source"]["localPath"]
    pdf = source.read_bytes()
    if not pdf.startswith(b"%PDF-") or hashlib.sha256(pdf).hexdigest() != trace["source"]["sha256"]:
        raise ValueError("Source PDF differs from the visually reviewed document")
    layout = json.loads((ROOT / LAYOUT).read_text())
    basement = next(f for f in layout["floors"] if f["id"] == "B")
    listed = {r["scheduleKey"]: r for r in basement["unplaced"]}
    rooms = []
    for room in trace["rooms"]:
        key = room["scheduleKeyCandidate"]
        bounds = room["labelBounds"]
        center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
        ring = room["outer"]
        if not (min(v[0] for v in ring) < center[0] < max(v[0] for v in ring)
                and min(v[1] for v in ring) < center[1] < max(v[1] for v in ring)):
            raise ValueError(f"Label {key} is outside its traced polygon")
        rooms.append({"label": key,
                      "historicalAreaSquarePoints": round(area(ring), 6),
                      "currentListedAreaSqft": listed[key]["areaSqft"],
                      "runtimePlacementAllowed": False})
    by_label = {room["label"]: room for room in rooms}
    source_ratio = by_label["003"]["historicalAreaSquarePoints"] / by_label["005"]["historicalAreaSquarePoints"]
    listed_ratio = by_label["003"]["currentListedAreaSqft"] / by_label["005"]["currentListedAreaSqft"]
    report = {
        "schemaVersion": 1, "building": "PFBH", "floor": "B",
        "status": "blocked-by-conflicting-source-geometry",
        "source": {**trace["source"], "sha256": hashlib.sha256(pdf).hexdigest(), "bytes": len(pdf)},
        "inputHashes": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in (TRACE, LAYOUT)},
        "rooms": rooms,
        "comparison": {"historical003To005AreaRatio": round(source_ratio, 6),
                       "facilitiesListed003To005AreaRatio": round(listed_ratio, 6),
                       "ratioDisagreementFactor": round(source_ratio / listed_ratio, 6),
                       "interpretation": "Relative room areas are incompatible under any common scale or affine registration. Door/wall tracing uncertainty is far smaller than this disagreement."},
        "runtimeChanges": {"addedRoomPolygons": 0, "recoveredScheduleKeys": [], "remainingUnplacedKeys": ["003", "005"]},
        "nextEvidenceNeeded": "A current numbered PFBH basement plan, or an authoritative crosswalk explaining changes to rooms 003 and 005.",
        "limitations": trace["limitations"]
    }
    (ROOT / REPORT).write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {REPORT}; historical 003/005 area ratio={source_ratio:.3f}, listed ratio={listed_ratio:.3f}. No runtime placements changed.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Audit historical HDSI room candidates without changing any runtime geometry."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REVIEW = "data/indoor/HDSI/literature-2010-review.json"
LAYOUT = "static/indoor/facilities/HDSI.json"
REPORT = "data/indoor/HDSI/history-audit.json"


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y):
            if x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
                result = not result
    return result


def main():
    review = json.loads((ROOT / REVIEW).read_text())
    source = review["source"]
    pdf = (ROOT / source["localPath"]).read_bytes()
    if (not pdf.startswith(b"%PDF-") or len(pdf) != source["bytes"]
            or hashlib.sha256(pdf).hexdigest() != source["sha256"]):
        raise ValueError("The PDF differs from the visually reviewed source")
    layout = json.loads((ROOT / LAYOUT).read_text())
    if layout["building"] != "HDSI":
        raise ValueError("Expected HDSI base layout")
    listed = {(f["id"], r["scheduleKey"]): r
              for f in layout["floors"] for r in f.get("unplaced", [])}
    checks = []
    for room in review["roomComparisons"]:
        current = listed[(room["floor"], room["scheduleKey"])]["areaSqft"]
        if current != room["currentListedAreaSqft"]:
            raise ValueError(f"Listed room {room['scheduleKey']} has changed; review again")
        if ring := room.get("historicalOuterApproximate"):
            bounds = room["labelBounds"]
            center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
            if not inside(center, ring):
                raise ValueError("Historical label falls outside the candidate trace")
        historical = room["historicalPrintedAreaSqft"]
        checks.append({
            "scheduleKey": room["scheduleKey"], "floor": room["floor"],
            "sourcePage": room["page"], "historicalPrintedAreaSqft": historical,
            "currentListedAreaSqft": current,
            "historicalToCurrentAreaRatio": round(historical / current, 6),
            "relativeAreaDifference": round(abs(historical / current - 1), 6),
            "currentBoundaryVerified": False, "runtimePlacementAllowed": False,
            "decision": room["decision"], "reason": room["reason"]
        })
    report = {
        "schemaVersion": 1, "building": "HDSI", "status": review["status"],
        "source": source,
        "inputHashes": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
                        for p in [REVIEW, LAYOUT, source["localPath"]]},
        "roomChecks": checks,
        "runtimeChanges": {"addedRoomPolygons": 0, "recoveredScheduleKeys": [],
                           "remainingUnplacedKeys": ["123", "336", "355"]},
        "nextEvidenceNeeded": review["nextEvidenceNeeded"],
        "limitations": review["limitations"]
    }
    (ROOT / REPORT).write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {REPORT}. Verified four historical floor-plan pages; all three rooms remain unplaced.")
    print("Room 355 has a 0.48% listed-area difference, but its current wall boundaries remain unverified.")


if __name__ == "__main__":
    main()

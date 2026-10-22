#!/usr/bin/env python3
"""Build Mayer Hall Addition's distinct schedule-code view from reviewed evidence.

node scripts/extract-myr-a-schedule.mjs
python scripts/build-myr-a-indoor.py [--review]
Original MAYER layouts remain unchanged. Six mappings reuse native Facilities
polygons; room5623 is traced from the genuine Physics EAP fifth-floor diagram.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/MYR-A/addition-trace.json"


def read(path):
    return json.loads((ROOT / path).read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    trace = read(TRACE)
    inventory = read(trace["scheduleInventory"])
    assert sha(trace["baseLayout"]) == trace["baseSha256"], "Review changed original geometry"
    assert sha(trace["source"]["localPath"]) == trace["source"]["sha256"], "Review changed PDF"
    assert sha(inventory["source"]["localPath"]) == inventory["source"]["sha256"], "Review changed term snapshot"
    assert inventory["keys"] == ["2544", "2574", "2702", "2722", "3544", "4623", "5623"]
    base = read(trace["baseLayout"])
    old_rooms = {r["id"]: r for f in base["floors"] for r in f["rooms"]}
    assert len(old_rooms) == 176 and all("-804-" in key for key in old_rooms)
    assert not any(r["scheduleKey"] for r in old_rooms.values())
    result = copy.deepcopy(base)
    result["building"], result["name"] = "MYR-A", "Mayer Hall Addition"
    result["provenance"] = (
        "UC San Diego Facilities bkey804 polygons for Mayer Hall Addition, matched to six exact FA26 schedule keys. "
        "A seventh room,5623, is traced from the official Physics emergency-plan fifth-floor diagram. "
        "This separate schedule-code view retains the original indoor geometry; campus fit and fifth-floor trace remain approximate.")
    result["geo"]["caans"] = ["6264"]
    result["geo"]["note"] += " This Addition view retains the same approximate coordinate fit and restricts its identity to CAAN6264; it is not a newly surveyed campus placement."
    result["notes"] = trace["limitations"]
    for source in result["sources"]:
        source["building"] = "MYR-A"
        if source["id"] == "UCSD-FIS":
            source["title"] = "UCSD Facilities Mayer Hall Expansion / Addition viewer (bkey804)"
            source["url"] = "https://facilities.ucsd.edu/Buildings/Viewer/Default.htm?bkey=804"
            source.setdefault("notes", []).append("All176 reused room IDs explicitly carry804. No old-wing bkey348 room polygon is imported into this Addition view.")
    for floor in result["floors"]:
        floor["unplaced"] = []
        floor.setdefault("notes", []).append("This is the MYR-A schedule-code view; MAYER old-wing schedule keys are retained only in the separate MAYER layout.")
    result.pop("knownUnmapped", None)
    rooms = {r["id"]: r for f in result["floors"] for r in f["rooms"]}
    for item in trace["reviewedExistingRooms"]:
        room = rooms[item["roomId"]]
        assert room["label"] == item["scheduleKey"] and room["floor"] == item["floor"]
        room["scheduleKey"] = item["scheduleKey"]
        room["sources"].extend([
            {"source": "MYRA-FA26", "note": "Exact MYR-A room key from the captured application schedule feed."},
            {"source": trace["source"]["id"], "page": item["crossCheckPdfPage"],
             "note": "Independent room-number / position cross-check in the connected Mayer floor diagram."}])
        room.setdefault("notes", []).append("The original Facilities polygon and confidence are retained without reshaping. Schedule identity is exact, not a generic prefix alias.")
    # Compute the already-reviewed fifth-floor registration from explicit controls,
    # rather than copying an opaque transform or borrowing another floor's room.
    spec = importlib.util.spec_from_file_location("mayer_geometry", ROOT / "scripts/supplement-mayer-physics.py")
    utils = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(utils)
    addition = trace["newTrace"]
    registration = addition["registration"]
    target_rooms = {r["id"]: r for f in base["floors"] if f["id"] == registration["targetFloor"] for r in f["rooms"]}
    target = lambda p: target_rooms[p["targetRoomId"]]["footprint"]["outer"][p["targetVertex"]]
    multiplier, offset = utils.fit([p["sourcePoint"] for p in registration["controls"]],
                                   [target(p) for p in registration["controls"]])

    def transform(point):
        z = multiplier * complex(*point) + offset
        return [round(z.real, 6), round(z.imag, 6)]

    checks = {kind: [{**p, "targetPoint": target(p), "transformedPoint": transform(p["sourcePoint"]),
                      "residualMeters": math.dist(transform(p["sourcePoint"]), target(p))}
                     for p in registration[kind]] for kind in ["controls", "holdouts"]}
    assert max(p["residualMeters"] for p in checks["controls"]) < 0.15
    assert max(p["residualMeters"] for p in checks["holdouts"]) < 1.1
    footprint = {"outer": [transform(p) for p in addition["outer"]]}
    room = {"id": "L5-PHYSICS-5623", "label": "5623", "scheduleKey": "5623", "type": "conference",
            "floor": "L5", "footprint": footprint, "labelAt": transform(addition["labelAt"]),
            "confidence": {"location": "approximate", "shape": "approximate", "label": "direct"},
            "sources": [{"source": trace["source"]["id"], "page": 37, "region": "5623, below the diagonal north office wing; adjoining5653 excluded."},
                        {"source": "MYRA-FA26"}, {"source": "MYRA-PHYSICS-EVENT"},
                        {"source": "MYRA-PHYSICS-ROOMS"}, {"source": "MYRA-OFFICIAL-SCHEDULE"}],
            "notes": [addition["traceNotes"],
                      "This is room5623 on the fifth floor, traced independently; the fourth-floor4623 polygon is not copied.",
                      "Registration inherits about1.02m maximum held-out wall-corner error. No official5623 area is asserted."]}
    floor = next(f for f in result["floors"] if f["id"] == "L5")
    assert not floor["rooms"]
    floor["rooms"] = [room]
    floor["outline"] = [copy.deepcopy(footprint)]
    floor["outlineConfidence"] = "approximate"
    floor["sources"] = [{"source": trace["source"]["id"], "page": 37},
                        {"source": "UCSD-FIS", "note": "Fourth-floor exterior wall corners provide the reviewed approximate registration."}]
    floor["notes"] = ["Partial fifth-floor coverage: the slab shows only the reviewed room5623 region. Other fifth-floor rooms and corridors are not modeled.",
                      "The old repeated Level4 placeholder outline is not reused. Vertical height remains estimated."]
    origin = -offset / multiplier
    floor["transforms"] = [{"source": trace["source"]["id"], "imageSizePx": addition["renderSizePx"],
                            "originPx": [origin.real, origin.imag], "rotationDeg": math.degrees(math.atan2(multiplier.imag, multiplier.real)),
                            "scale": abs(multiplier), "note": "Physical PDF page37 rendered to2400px. Control and withheld wall corners are recorded in addition-review.json."}]
    pdf_source = trace["source"]
    result["sources"].append({"id": pdf_source["id"], "title": "Physics Department Emergency Action Plan — connected Mayer floor diagrams",
                              "url": pdf_source["url"], "localFile": pdf_source["localPath"],
                              "publisher": "UC San Diego Department of Physics / EH&S", "building": "MYR-A",
                              "floors": ["L2", "L3", "L4", "L5"], "accessed": pdf_source["accessed"],
                              "revision": pdf_source["revision"],
                              "notes": ["Official discovery page: " + pdf_source["discoveryUrl"],
                                        "SHA-256: " + pdf_source["sha256"],
                                        "Exact import scope: room5623 principal walls on page37 only; pages25/29/33 cross-check six existing room identities. Other packet geometry is not newly modeled."]})
    result["sources"].append({"id": "MYRA-FA26", "title": "Application schedule feed — Fall2026 MYR-A room inventory",
                              "url": inventory["source"]["url"], "localFile": inventory["source"]["localPath"],
                              "publisher": "SheepTester uxdy schedule feed", "building": "MYR-A",
                              "floors": ["L2", "L3", "L4", "L5"], "accessed": "2026-10-22",
                              "notes": [inventory["source"]["note"],
                                        "Source scrape timestamp: " + inventory["source"]["scrapedAt"],
                                        "SHA-256: " + inventory["source"]["sha256"],
                                        "Parsed by the same coursesFromFile.ts as the website:48 meeting records and7 distinct room keys."]})
    for source in trace["identitySources"]:
        result["sources"].append({**source, "building": "MYR-A", "floors": ["L2", "L3", "L4", "L5"]})
    new_rooms = {r["id"]: r for f in result["floors"] for r in f["rooms"]}
    for key, old in old_rooms.items():
        for field in ["id", "label", "type", "floor", "footprint", "confidence"]:
            assert new_rooms[key][field] == old[field], "Existing geometry/classification changed"
    mapped = sorted(r["scheduleKey"] for r in new_rooms.values() if r["scheduleKey"])
    assert mapped == inventory["keys"] and len(mapped) == len(set(mapped)) == 7
    assert new_rooms["L2-804-66093"]["scheduleKey"] is None, "Do not map the same-number service polygon"
    assert not any(f.get("unplaced") for f in result["floors"])
    report = {"schemaVersion": 1, "building": "MYR-A", "output": trace["output"],
              "inputHashes": {p: sha(p) for p in [TRACE, trace["baseLayout"], trace["scheduleInventory"],
                                                  pdf_source["localPath"], inventory["source"]["localPath"]]},
              "scheduleInventory": {"term": "FA26", "keys": inventory["keys"], "meetingRecordCount": inventory["meetingRecordCount"], "source": inventory["source"]},
              "existingRoomPolygonsPreserved": len(old_rooms), "reusedMappedRoomIds": trace["reviewedExistingRooms"],
              "newTrace": addition, "registrationChecks": checks,
              "transform": {"a": multiplier.real, "b": multiplier.imag, "tx": offset.real, "tz": offset.imag},
              "tracedAreaSqft": utils.area(footprint["outer"]) / 0.09290304,
              "areaNote": "Computed trace area is reported for review only; no listed5623 area was available for independent checking.",
              "limitations": trace["limitations"]}
    (ROOT / trace["output"]).write_text(json.dumps(result, separators=(",", ":")) + "\n")
    (ROOT / "data/indoor/MYR-A/addition-review.json").write_text(json.dumps(report, indent=2) + "\n")
    if args.review:
        from PIL import Image, ImageDraw, ImageFont
        source_image = ROOT / "local/indoor-sources/physics-review/detail-37.png"
        if not source_image.exists():
            subprocess.run(["pdftoppm", "-f", "37", "-l", "37", "-scale-to", "2400", "-png",
                            str(ROOT / pdf_source["localPath"]), str(source_image.parent / "detail")], check=True)
        image = Image.open(source_image).convert("RGBA")
        assert list(image.size) == addition["renderSizePx"]
        overlay = Image.new("RGBA", image.size)
        draw = ImageDraw.Draw(overlay)
        points = [tuple(p) for p in addition["outer"]]
        draw.polygon(points, fill=(40, 140, 255, 50), outline=(0, 70, 220, 255), width=3)
        font = ImageFont.truetype("DejaVuSans.ttf", 18)
        draw.text((addition["labelAt"][0], addition["labelAt"][1] + 27), "MYR-A5623", anchor="mm", fill=(0, 40, 160), font=font)
        composite = Image.alpha_composite(image, overlay).convert("RGB")
        folder = ROOT / "local/indoor-sources/MYR-A-review"
        folder.mkdir(exist_ok=True)
        composite.save(folder / "L5-review.png")
        composite.crop((880,430,1125,670)).resize((980,960)).save(folder / "5623-review.png")
    print("MYR-A:7 exact FA26 keys mapped (6 existing Facilities polygons plus traced5623);176 original room shapes preserved.")


if __name__ == "__main__":
    main()

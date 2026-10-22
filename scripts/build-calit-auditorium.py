#!/usr/bin/env python3
"""Build CALIT 1511 from the official QI diagram and documented room identity.

python scripts/build-calit-auditorium.py [--review]
The build is offline; --review additionally requires Pillow and pdftoppm.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TRACE = ROOT / "data/indoor/CALIT/auditorium-trace.json"


def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1])))/2


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    trace = json.loads(TRACE.read_text())
    for source in trace["sources"]:
        assert sha(ROOT/source["localPath"]) == source["sha256"], source["localPath"]
    base = json.loads((ROOT/trace["baseLayout"]).read_text())
    expected = {r["scheduleKey"] for f in base["floors"] for r in f.get("rooms", [])+f.get("unplaced", []) if r.get("scheduleKey")}
    expected.update(r["scheduleKey"] for r in base.get("knownUnmapped", []))
    assert expected == {"1511"}, "Reconcile any changed base schedule inventory before rebuilding"
    listing = next(r for f in base["floors"] if f["id"] == "L1" for r in f["unplaced"] if r["scheduleKey"] == "1511")
    assert listing["areaSqft"] == trace["scale"]["listedAreaSqft"] == 2865
    fis = (ROOT/trace["sources"][2]["localPath"]).read_text()
    assert re.search(r"remoteToggleHighlight\('Room', '31372:#000000'\).*?>1511 <span[^>]*>\(2865 sqft\)", fis)
    room = trace["room"]
    pixel_area = area(room["outer"])
    scale = math.sqrt(trace["scale"]["listedAreaSqft"]*.09290304/pixel_area)

    def point(p):
        return [round((p[i]-trace["originPx"][i])*scale, 6) for i in (0, 1)]

    ring = [point(p) for p in room["outer"]]
    refs = [
        {"source": "CALIT-QI-EVENT-DIAGRAM", "region": "Lower fixed-tier auditorium; stage and main seating enclosure"},
        {"source": "CALIT-SEAW-NOV-2006", "page": 7, "region": "Right column: NEES/UCSD seminar venue", "note": "Historical direct room-name crosswalk: Main Auditorium, Room 1511."},
        {"source": "CALIT-FIS-L1-LISTING", "region": "1511 / Room 31372 / 2865 sqft", "note": "Room number, level and the sole area used to set approximate scale."},
    ]
    runtime_room = {
        "id": "L1-1511-QI-DIAGRAM", "label": "1511", "scheduleKey": "1511", "name": "Atkinson Hall Main Auditorium",
        "floor": "L1", "type": "lecture-hall", "footprint": {"outer": ring}, "labelAt": point(room["labelAt"]),
        "confidence": {"location": "approximate", "shape": "traced", "label": "direct"},
        "sources": refs, "notes": room["boundaryNotes"]+[
            "The 1511 identity is explicitly documented by the November 2006 SEAW announcement, page 7. It is not printed on the undated QI event diagram.",
            "Uniform scale is fitted to this room's FIS area of 2865 sqft. Area agreement is imposed by calibration, not independently validated.",
            "This source reconstruction does not establish the present-day as-built condition."
        ],
    }
    sources = []
    for source in trace["sources"]:
        entry = {k: source[k] for k in ("id", "title", "url", "publisher", "revision")}
        entry.update({"building": "CALIT", "floors": ["L1"], "accessed": trace["reviewed"],
                      "notes": ["Source SHA-256: "+source["sha256"], source["use"]]})
        if "page" in source:
            entry["page"] = source["page"]
        sources.append(entry)
    layout = {
        "schemaVersion": 1, "building": "CALIT", "name": "Atkinson Hall", "geometryStatus": "source-traced",
        "provenance": "Local auditorium-only reconstruction from the undated official QI event diagram. Room 1511 identity is supported by a directly inspected November 2006 SEAW announcement; current public FIS metadata supplies Level 1 and approximate area scale. No full-building interior or campus placement is claimed.",
        "coordinateSystem": {"units": "meters", "northDeg": None,
                             "description": "Drawing-axis local meters, uniformly fitted to one FIS room area; approximate scale, no campus registration.",
                             "northNote": "The source diagram has no established north angle. True north is unknown."},
        "sources": sources,
        "floors": [{"id": "L1", "label": "Level 1 · auditorium only", "shortLabel": "1",
                    "vertical": {"baseElevation": 0, "height": 4, "estimated": True,
                                 "note": "Illustrative extrusion height; neither tier elevations nor floor-to-ceiling height are supplied by the sources."},
                    "outline": [{"outer": ring}], "outlineConfidence": "approximate", "rooms": [runtime_room],
                    "unplaced": [], "areas": [], "sources": refs,
                    "transforms": [{"source": "CALIT-QI-EVENT-DIAGRAM", "imageSizePx": trace["sources"][0]["imageSizePx"],
                                    "originPx": trace["originPx"], "rotationDeg": 0, "scale": scale,
                                    "note": "Single-room area-fitted scale; not an independent dimensional or area check."}],
                    "notes": ["The outline is the traced room footprint, not the building exterior or the complete first floor."]}],
        "knownUnmapped": [], "notes": trace["limitations"],
    }
    output = ROOT/trace["outputLayout"]
    output.write_text(json.dumps(layout, separators=(",", ":"))+"\n")
    report = {
        "schemaVersion": 1, "building": "CALIT", "reviewed": trace["reviewed"], "output": trace["outputLayout"],
        "addedScheduleKeys": ["1511"], "preservedScheduleKeys": sorted(expected), "sourceImageSizePx": trace["sources"][0]["imageSizePx"],
        "sourcePixelArea": pixel_area, "metersPerPixel": scale, "scaleBasis": trace["scale"],
        "calibratedAreaSqft": area(ring)/.09290304, "independentAreaValidation": False,
        "roomIdentityEvidence": {"source": "CALIT-SEAW-NOV-2006", "page": 7, "pageVisuallyInspected": True,
                                 "quotedText": "Atkinson Hall Main Auditorium– Room 1511 of the Calit 2 Building, UC San Diego.",
                                 "evidenceDate": "2006-11", "modernAsBuiltConfirmation": False},
        "northKnown": False, "campusRegistration": False, "includedFloors": ["L1"],
        "basePreservedSeparately": {"path": trace["baseLayout"], "floors": [f["id"] for f in base["floors"]],
                                   "roomPolygons": sum(len(f["rooms"]) for f in base["floors"])},
        "limitations": trace["limitations"],
        "inputHashes": {p: sha(ROOT/p) for p in [str(TRACE.relative_to(ROOT)), trace["baseLayout"]]+[s["localPath"] for s in trace["sources"]]},
        "outputSha256": sha(output), "reviewOverlay": "local/indoor-sources/CALIT-auditorium-review.png",
        "identityPageImage": "local/indoor-sources/CALIT-seaw-page-7-review.png",
    }
    (ROOT/"data/indoor/CALIT/auditorium-review.json").write_text(json.dumps(report, indent=2)+"\n")
    print(f"CALIT 1511: one local room, {scale:.8f} m/px fitted to 2865 sqft; no independent area check, no geo, north unknown")
    if args.review:
        from PIL import Image, ImageDraw, ImageFont
        im = Image.open(ROOT/trace["sources"][0]["localPath"]).convert("RGBA")
        assert list(im.size) == trace["sources"][0]["imageSizePx"]
        layer = Image.new("RGBA", im.size)
        draw = ImageDraw.Draw(layer)
        pts = [tuple(p) for p in room["outer"]]
        draw.polygon(pts, fill=(0, 100, 220, 36))
        draw.line(pts+pts[:1], fill=(0, 70, 200, 255), width=2)
        font = ImageFont.truetype("DejaVuSans.ttf", 18)
        draw.text(tuple(room["labelAt"]), "1511", font=font, fill=(0, 50, 180), anchor="mm")
        Image.alpha_composite(im, layer).convert("RGB").save(ROOT/report["reviewOverlay"])
        subprocess.run(["pdftoppm", "-f", "7", "-singlefile", "-scale-to", "1800", "-png",
                        str(ROOT/trace["sources"][1]["localPath"]), str((ROOT/report["identityPageImage"]).with_suffix(""))], check=True, capture_output=True)


if __name__ == "__main__":
    main()

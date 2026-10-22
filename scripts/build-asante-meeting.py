#!/usr/bin/env python3
"""Build four Asante meeting rooms from the reviewed official I-House image.

python scripts/build-asante-meeting.py [--review]
The optional image overlay requires Pillow; the build uses the standard library.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACE = ROOT / "data/indoor/ASANT/meeting-trace.json"
OUTPUT = ROOT / "static/indoor/ASANT-meeting.json"
REPORT = ROOT / "data/indoor/ASANT/meeting-review.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    trace = json.loads(TRACE.read_text())
    source = trace["source"]
    image_path = ROOT / source["localPath"]
    if hashlib.sha256(image_path.read_bytes()).hexdigest() != source["sha256"]:
        raise ValueError("Original source image changed; re-review before rebuilding")
    original = json.loads((ROOT / "static/indoor/facilities/ASANT.json").read_text())
    expected = {r["scheduleKey"] for f in original["floors"] for r in f["rooms"] + f.get("unplaced", []) if r.get("scheduleKey")}
    if expected != {r["key"] for r in trace["rooms"]} or len(trace["rooms"]) != 4:
        raise ValueError("Meeting-room trace must preserve every original ASANT schedule key exactly once")
    def point(p):
        return [round((p[i]-trace["originPx"][i])*trace["localUnitsPerPixel"], 4) for i in (0, 1)]
    ref = {"source": source["id"]}
    rooms = []
    for room in trace["rooms"]:
        rooms.append({"id": f"ASANT-MEETING-{room['key']}", "label": room["key"], "name": f"Asante Meeting Room {room['key'][-1]}",
            "scheduleKey": room["key"], "type": "conference", "floor": "L1",
            "footprint": {"outer": [point(p) for p in room["outer"]]}, "labelAt": point(room["labelAt"]),
            "confidence": {"location": "traced", "shape": "approximate", "label": "direct"},
            "sources": [{**ref, "region": room["printedLabel"]}, {"source": "ASANT-IHOUSE-FAQ", "note": f"Room {room['key'][-1]} capacity: {room['capacity']}"}],
            "notes": [f"Official plan label: {room['printedLabel']}. Official I-House FAQ capacity: {room['capacity']} persons.",
                      "Principal visible walls traced; small columns and doorway recesses are simplified."] + ([room["note"]] if room.get("note") else [])})
    result = {
        "schemaVersion": 1, "building": "ASANT", "name": trace["name"], "geometryStatus": "source-traced",
        "provenance": "Four Asante Meeting Rooms traced from UC San Diego International House's official floor plan. This is the meeting venue (CAAN 7025); the previously associated three-floor Asante W housing layout is preserved separately. Drawing units and floor height are illustrative.",
        "coordinateSystem": {"units": "relative", "description": "One unit equals ten pixels in the original 700 × 546 floor-plan image. No metric dimensions or campus registration are claimed.",
                             "northDeg": None, "northNote": "Source drawing orientation is preserved; no unambiguous north angle was established."},
        "sources": [
            {"id": source["id"], "title": "Asante Meeting Rooms official floor plan", "url": source["url"], "publisher": "UC San Diego International House",
             "building": "ASANT", "floors": ["L1"], "accessed": trace["reviewed"], "revision": source["revision"],
             "imageRef": "700 × 546 JPEG; SHA-256 " + source["sha256"], "scale": "Relative image units; architectural scale not established.",
             "notes": ["Official page linking this floor plan: " + source["discoveryUrl"]]},
            {"id": "ASANT-IHOUSE-FAQ", "title": "I-House FAQ — Asante Meeting Rooms capacities", "url": trace["faqUrl"],
             "publisher": "UC San Diego International House", "building": "ASANT", "floors": ["L1"], "accessed": trace["reviewed"]}
        ],
        "floors": [{"id": "L1", "label": "Meeting rooms", "shortLabel": "1", "vertical": {"baseElevation": 0, "height": 3.5, "estimated": True,
                   "note": "Illustrative height in relative units; source supplies no vertical elevations."},
            "outline": [{"outer": [point(p) for p in ring]} for ring in trace["outline"]], "outlineConfidence": "approximate",
            "transforms": [{"source": source["id"], "imageSizePx": source["imageSizePx"], "originPx": trace["originPx"], "rotationDeg": 0, "scale": trace["localUnitsPerPixel"]}],
            "rooms": rooms, "unplaced": [], "areas": [],
            "features": [{**f, "at": point(f["at"]), "confidence": "traced", "sources": [ref]} for f in trace["features"]],
            "sources": [ref], "notes": ["Only the single meeting-room level depicted by the source is modeled. A and D are separated by the movable partition shown on the drawing."]}],
        "knownUnmapped": [], "notes": trace["limitations"]
    }
    OUTPUT.write_text(json.dumps(result, separators=(",", ":"))+"\n")
    REPORT.write_text(json.dumps({"building": "ASANT", "reviewed": trace["reviewed"], "source": source,
        "traceSha256": hashlib.sha256(TRACE.read_bytes()).hexdigest(), "recoveredKeys": sorted(expected),
        "coordinateUnits": "relative", "geoReferenced": False, "identityCorrection": trace["identityCorrection"],
        "originalUnscheduledPolygonsPreservedInSeparateInput": sum(len(f["rooms"]) for f in original["floors"]),
        "limitations": trace["limitations"]}, indent=2)+"\n")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: four meeting rooms, relative units, no campus georeference")
    if args.review:
        from PIL import Image, ImageDraw, ImageFont
        image = Image.open(image_path).convert("RGBA")
        if list(image.size) != source["imageSizePx"]:
            raise ValueError("Source image dimensions changed")
        layer = Image.new("RGBA", image.size)
        draw = ImageDraw.Draw(layer)
        font = ImageFont.truetype("DejaVuSans.ttf", 15)
        for ring in trace["outline"]:
            draw.line([tuple(p) for p in ring+[ring[0]]], fill=(230, 125, 0, 255), width=2)
        for room in trace["rooms"]:
            draw.polygon([tuple(p) for p in room["outer"]], fill=(0, 150, 230, 40), outline=(0, 90, 200, 255), width=2)
            x, y = room["labelAt"]
            draw.text((x, y+14), room["key"], fill=(0, 70, 170), font=font, anchor="mt")
        path = ROOT / "local/indoor-sources/ASANT-meeting-review.png"
        Image.alpha_composite(image, layer).convert("RGB").save(path)
        print(f"Review overlay: {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

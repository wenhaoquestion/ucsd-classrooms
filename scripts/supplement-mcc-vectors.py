#!/usr/bin/env python3
"""Import exact public FIS Communication polygons; never request protected rasters.

python scripts/supplement-mcc-vectors.py [--review]
Requires the two hashed public HTML originals retained under local/indoor-sources.
"""
import argparse
import copy
import hashlib
import html
import json
import math
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = "data/indoor/MCC/fis-vector-import.json"
SQFT_TO_SQM = 0.09290304


def read(path):
    return json.loads((ROOT / path).read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def inventory(layout):
    return sorted(r["scheduleKey"] for f in layout["floors"]
                  for r in f["rooms"] + f.get("unplaced", []) if r.get("scheduleKey"))


def ring_area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def polygon_area(polygon):
    return ring_area(polygon["outer"]) - sum(ring_area(r) for r in polygon.get("holes", []))


def parse_source(source):
    assert sha(source["localPath"]) == source["sha256"], "Source changed: review again"
    text = (ROOT / source["localPath"]).read_text()
    assert "Communication - " in text and f"init({source['planKey']}," in text
    # Parse inert JSON and the explicitly numbered room rows, never execute HTML/JS.
    match = re.search(r"'(\{\"polys\".*?\})'", text)
    assert match, "Public vector data is absent"
    polygons = json.loads(match.group(1))["polys"]
    room_pattern = (r'onClick="remoteToggleHighlight\(\x27Room\x27, '
                    r'\x27(\d+):[^\x27]+\x27\);" class="layer"[^>]*>'
                    r'\s*([^<]+)\s*<span[^>]*>\(([^ ]+) sqft\)')
    rows = {}
    for key, label, sqft in re.findall(room_pattern, text):
        assert key not in rows
        rows[key] = {"label": html.unescape(label).strip(), "areaSqft": float(sqft.replace(",", ""))}
    classes = dict(re.findall(r"\[\s*(\d+), 'roomType', '([^']+)'", text))
    converted = {}
    width, height = source["imageSizePx"]
    for key, geometry in polygons.items():
        assert geometry["type"] == "Polygon", "Review other GeoJSON geometry types explicitly"
        rings = []
        for points in geometry["coordinates"]:
            assert points[0] == points[-1] and len(points) >= 4
            assert all(0 <= value <= 1 for point in points for value in point)
            rings.append([[x * width, y * height] for x, y in points[:-1]])
        converted[key] = {"outer": rings[0], "holes": rings[1:]}
        assert polygon_area(converted[key]) > 0
    return {"source": source, "polygons": converted, "rows": rows, "classes": classes,
            "sourceNormalizedPolygons": polygons}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    config = read(CONFIG)
    assert sha(config["baseLayout"]) == config["baseSha256"], "Review changed base before importing"
    base = read(config["baseLayout"])
    assert base["building"] == "MCC" and not any(f["rooms"] for f in base["floors"])
    parsed = {source["floor"]: parse_source(source) for source in config["sources"]}
    assert len(parsed["L1"]["polygons"]) == 54
    assert set(parsed["L2"]["polygons"]) == {"51275"}
    calibration = parsed[config["scaleCalibration"]["floor"]]
    independent_scales = [math.sqrt(row["areaSqft"] * SQFT_TO_SQM /
                                    polygon_area(calibration["polygons"][key]))
                          for key, row in calibration["rows"].items() if key in calibration["polygons"]]
    assert len(independent_scales) == 52
    scale = statistics.median(independent_scales)
    assert max(abs(value / scale - 1) for value in independent_scales) < 0.015
    origin = config["scaleCalibration"]["imageOriginPx"]

    def point(p):
        return [round((value - zero) * scale, 8) for value, zero in zip(p, origin)]

    def transform(poly):
        return {"outer": [point(p) for p in poly["outer"]],
                "holes": [[point(p) for p in ring] for ring in poly.get("holes", [])]}

    result = copy.deepcopy(base)
    result.pop("geo", None)
    result["geometryStatus"] = "facilities-plan"
    result["coordinateSystem"] = {
        "units": "meters", "northDeg": None,
        "description": "Local public-plan coordinates scaled by 52 independently listed room areas; native image center is (0,0). No campus placement is available.",
        "northNote": "True north and alignment between floors have not been independently established."}
    result["provenance"] = (
        "Exact public UC San Diego Facilities vector boundaries for Communication Building, bkey 391 / CAAN 6614. "
        "Four first-floor schedule rooms are matched by explicit room IDs and labels; second-floor classrooms remain unplaced. "
        "Local scale is checked against published room areas; campus placement and floor elevations are not surveyed.")
    result["notes"] = [
        "MCC means Media Center and Communication Building, not Moores Cancer Center. No Cancer Center geometry or area is reused.",
        "The prior corrected exterior-shell file is retained separately. Its campus polygons and geo are not combined with these unregistered indoor coordinates.",
        *config["limitations"]]
    area_checks = []
    source_inventory = {}
    for floor in result["floors"]:
        floor_id = floor["id"]
        data = parsed[floor_id]
        source = data["source"]
        source_id = source["id"]
        floor["outline"] = [transform(poly) for poly in data["polygons"].values()]
        floor["outlineConfidence"] = "direct"
        floor["rooms"], floor["areas"] = [], []
        floor["sources"] = [{"source": source_id}]
        floor["transforms"] = [{"source": source_id, "imageSizePx": source["imageSizePx"],
                                "originPx": origin, "rotationDeg": 0, "scale": scale,
                                "note": "Normalized GeoJSON x/y are multiplied by native width/height, then translated and scaled. No campus or between-floor registration is asserted."}]
        floor["vertical"]["note"] = "Retained estimated display height; no measured vertical geometry is available."
        floor["notes"] = [
            "Outline parts are exactly the published space polygons, not an inferred full exterior slab.",
            "Native drawing position is preserved without a verified alignment to other floors or the campus map."]
        if floor_id == "L2":
            floor["notes"].append("Only the public circulation space (C)253 has a polygon. All four scheduled rooms remain unplaced.")
        for key, poly in data["polygons"].items():
            row = data["rows"].get(key)
            room_class = data["classes"].get(key, "U")
            footprint = transform(poly)
            refs = [{"source": source_id, "region": "init polys[" + key + "]",
                     "note": "Exact normalized GeoJSON polygon; official room ID " + key + "."}]
            if row:
                calculated_sqft = polygon_area(footprint) / SQFT_TO_SQM
                delta = abs(calculated_sqft / row["areaSqft"] - 1)
                assert delta < 0.015
                area_checks.append({"floor": floor_id, "facilityRoomId": key, "label": row["label"],
                                    "listedAreaSqft": row["areaSqft"], "convertedAreaSqft": calculated_sqft,
                                    "relativeDifference": delta})
            if room_class in {"C", "U"}:
                area = {"id": floor_id + "-FIS-" + key,
                        "kind": "corridor" if room_class == "C" else "unknown",
                        "footprint": footprint, "confidence": "direct", "sources": refs}
                if row:
                    area["label"] = row["label"]
                floor["areas"].append(area)
                continue
            assert row, "A room needs an explicit source label"
            schedule_key = config["classrooms"].get(key) if floor_id == "L1" else None
            assert schedule_key is None or schedule_key == row["label"]
            room_type = ("classroom" if schedule_key else "restroom" if room_class == "T"
                         else "service" if room_class == "M" else "unknown")
            floor["rooms"].append({
                "id": floor_id + "-FIS-" + key, "label": row["label"], "scheduleKey": schedule_key,
                "type": room_type, "floor": floor_id, "footprint": footprint,
                "confidence": {"location": "direct", "shape": "direct", "label": "direct"},
                "sources": refs,
                "notes": [f"Official listed area {row['areaSqft']:g} sq ft. Shape is directly converted from the public polygon, not traced from a thumbnail.",
                          "Assignable-area classification alone does not establish the purpose of an unscheduled room."]})
        recovered = {r["scheduleKey"] for r in floor["rooms"] if r["scheduleKey"]}
        floor["unplaced"] = [r for r in floor["unplaced"] if r["scheduleKey"] not in recovered]
        for room in floor["unplaced"]:
            matches = [row for row in data["rows"].values() if row["label"] == room["scheduleKey"]]
            if len(matches) == 1:
                room["basis"] = "floor-listing"
                room["areaSqft"] = matches[0]["areaSqft"]
        result["sources"].append({
            "id": source_id, "title": source["title"].strip(), "url": source["url"],
            "localFile": source["localPath"], "publisher": "UC San Diego Facilities",
            "building": "MCC", "floors": [floor_id], "accessed": source["accessed"],
            "orientation": "Native drawing axes; true north and cross-floor registration unknown.",
            "scale": "52 first-floor polygon/area pairs calibrate one meter-per-pixel scale; all 53 available polygon/listing pairs pass the recorded area check.",
            "notes": ["Public embed HTML SHA-256: " + source["sha256"],
                      f"FIS bkey 391, floor {source['fcode']}, plan key {source['planKey']}; normalized public GeoJSON vectors only.",
                      source["rasterAvailability"],
                      "No drawing revision date is asserted. HTML DC.Date is site metadata, not a verified plan revision."]})
        source_inventory[floor_id] = {
            "source": source, "polygonCount": len(data["polygons"]),
            "listedRoomCount": len(data["rows"]),
            "polygonsWithoutLabels": [key for key in data["polygons"] if key not in data["rows"]],
            "listedRoomsWithoutPolygons": [{"facilityRoomId": key, **row}
                                           for key, row in data["rows"].items() if key not in data["polygons"]],
            "officialNormalizedPolygons": data["sourceNormalizedPolygons"], "officialRoomRows": data["rows"]}
    assert inventory(result) == inventory(base)
    assert len(inventory(result)) == len(set(inventory(result))) == 8
    assert [r["scheduleKey"] for r in result["floors"][1]["unplaced"]] == ["201", "221", "222", "250"]
    assert not result["floors"][1]["rooms"] and "geo" not in result
    report = {"schemaVersion": 1, "building": "MCC", "output": config["output"],
              "inputHashes": {p: sha(p) for p in [CONFIG, config["baseLayout"]]},
              "sources": source_inventory,
              "scaleCalibration": {"metersPerNativePixel": scale, "calibrationPairs": 52,
                                   "areaChecksIncludingL2Corridor": len(area_checks),
                                   "maximumRelativeAreaDifference": max(x["relativeDifference"] for x in area_checks)},
              "areaChecks": area_checks, "recoveredScheduleKeys": sorted(config["classrooms"].values()),
              "remainingUnplacedKeys": ["201", "221", "222", "250"],
              "limitations": config["limitations"]}
    (ROOT / config["output"]).write_text(json.dumps(result, separators=(",", ":")) + "\n")
    (ROOT / "data/indoor/MCC/fis-vector-review.json").write_text(json.dumps(report, indent=2) + "\n")
    if args.review:
        from PIL import Image, ImageDraw, ImageFont
        folder = ROOT / "local/indoor-sources/MCC-review"
        folder.mkdir(exist_ok=True)
        for floor_id, data in parsed.items():
            image = Image.new("RGB", (1600, 1280), "white")
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype("DejaVuSans.ttf", 17)
            title_font = ImageFont.truetype("DejaVuSans.ttf", 25)
            draw.text((35, 20), "MCC " + floor_id + " — original public FIS vector boundaries", fill="black", font=title_font)
            draw.text((35, 55), "No raster available; blue = exact scheduled-room ID matches; no campus registration.", fill="black", font=font)
            for key, poly in data["polygons"].items():
                points = [(x / 5544 * 1500 + 50, y / 4158 * 1125 + 100) for x, y in poly["outer"]]
                is_classroom = floor_id == "L1" and key in config["classrooms"]
                draw.polygon(points, fill=(185, 220, 255) if is_classroom else (235, 235, 235),
                             outline=(0, 80, 210) if is_classroom else (110, 110, 110), width=3 if is_classroom else 1)
                for ring in poly.get("holes", []):
                    draw.polygon([(x / 5544 * 1500 + 50, y / 4158 * 1125 + 100) for x, y in ring], fill="white", outline="gray")
                row = data["rows"].get(key)
                if row:
                    # This review-only anchor is not exported as a room position.
                    x = sum(p[0] for p in points) / len(points)
                    y = sum(p[1] for p in points) / len(points)
                    draw.text((x, y), row["label"], anchor="mm", font=font,
                              fill=(0, 50, 180) if is_classroom else "black")
            image.save(folder / (floor_id + "-vector-review.png"))
    print("MCC: imported 54 L1 space polygons, including four exact schedule matches; L2 has only corridor 253. Four upstairs keys remain unplaced.")


if __name__ == "__main__":
    main()

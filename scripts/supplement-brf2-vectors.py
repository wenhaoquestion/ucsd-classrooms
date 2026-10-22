#!/usr/bin/env python3
"""Import BRF2 L4's public FIS vectors, with a held-out classroom area check.

python scripts/supplement-brf2-vectors.py --review
The retained HTML is parsed as data. No network access or HTML execution occurs.
"""
import argparse
import hashlib
import html
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = "data/indoor/BRF2/fis-vector-import.json"
FLOOR_EVIDENCE = "data/indoor/BRF2/floor-listing-evidence.json"
SQFT_TO_SQM = 0.09290304


def read(path):
    return json.loads((ROOT / path).read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def ring_area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def area(poly):
    return ring_area(poly["outer"]) - sum(ring_area(h) for h in poly.get("holes", []))


def clean_ring(points):
    """Discard only repeated identical vertices, without changing the boundary."""
    result = []
    for point in points:
        if not result or point != result[-1]:
            result.append(point)
    while len(result) > 1 and result[0] == result[-1]:
        result.pop()
    assert len(result) >= 3
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    config = read(CONFIG)
    floor_evidence = read(FLOOR_EVIDENCE)
    source = config["source"]
    assert sha(source["localPath"]) == source["sha256"], "Source changed; review again"
    text = (ROOT / source["localPath"]).read_text()
    assert "Israni BRF - Fourth Floor" in text and "init(11089," in text
    native = json.loads(re.search(r"'(\{\"polys\".*?\})'", text).group(1))["polys"]
    pattern = (r'onClick="remoteToggleHighlight\(\x27Room\x27, '
               r'\x27(\d+):[^\x27]+\x27\);" class="layer"[^>]*>'
               r'\s*([^<]+)\s*<span[^>]*>\(([^ ]+) sqft\)')
    rows = {key: {"label": html.unescape(label).strip(),
                  "areaSqft": float(sqft.replace(",", ""))}
            for key, label, sqft in re.findall(pattern, text)}
    classes = dict(re.findall(r"\[\s*(\d+), 'roomType', '([^']+)'", text))
    assert len(native) == 127 and len(rows) == 125
    assert rows["73656"] == {"label": "4103", "areaSqft": 740.0}
    width, height = source["imageSizePx"]
    # The last native zoom dimension is explicitly [width, height] in init().
    assert f"[{width}, {height}]" in text
    pixels = {}
    cleanup = {}
    for key, polygon in native.items():
        assert polygon["type"] == "Polygon"
        rings = []
        removed = 0
        for points in polygon["coordinates"]:
            assert points[0] == points[-1]
            assert all(0 <= value <= 1 for point in points for value in point)
            ring = clean_ring(points)
            removed += len(points) - len(ring)
            rings.append([[x * width, y * height] for x, y in ring])
        pixels[key] = {"outer": rings[0], "holes": rings[1:]}
        cleanup[key] = removed
        assert area(pixels[key]) > 0
    calibration_ids = [key for key, row in rows.items()
                       if key in pixels and key not in config["classrooms"]
                       and key not in config["excludedPolygons"]
                       and row["areaSqft"] >= config["scaleCalibration"]["minimumCalibrationAreaSqft"]]
    assert len(calibration_ids) == config["scaleCalibration"]["expectedCalibrationPairs"]
    scales = {key: math.sqrt(rows[key]["areaSqft"] * SQFT_TO_SQM / area(pixels[key]))
              for key in calibration_ids}
    # Every whole-sq-ft listing constrains the squared scale to an interval.
    # Intersect the non-target intervals rather than allowing small-space
    # rounding to bias a simple median. The target remains fully held out.
    low = max((rows[key]["areaSqft"] - 0.5) * SQFT_TO_SQM / area(pixels[key])
              for key in calibration_ids)
    high = min((rows[key]["areaSqft"] + 0.5) * SQFT_TO_SQM / area(pixels[key])
               for key in calibration_ids)
    assert 0 < low <= high, "No single isotropic scale satisfies the rounded source areas"
    scale = math.sqrt((low + high) / 2)
    origin = config["scaleCalibration"]["imageOriginPx"]

    def transform(poly):
        def point(p):
            return [round((p[0] - origin[0]) * scale, 8),
                    round((p[1] - origin[1]) * scale, 8)]
        return {"outer": [point(p) for p in poly["outer"]],
                "holes": [[point(p) for p in h] for h in poly["holes"]]}

    source_id = source["id"]
    floor = {
        "id": "L4", "label": "Fourth floor — public space boundaries", "shortLabel": "4",
        "vertical": {"baseElevation": 10.5, "height": 3.5, "estimated": True,
                     "note": "Display estimates only; no measured story height or datum is available."},
        "outline": [], "outlineConfidence": "direct", "rooms": [], "areas": [], "unplaced": [],
        "sources": [{"source": source_id}],
        "transforms": [{"source": source_id, "imageSizePx": [width, height],
                        "originPx": origin, "rotationDeg": 0, "scale": scale,
                        "note": "Normalized x/y are multiplied by native width/height, then translated and isotropically scaled. Campus registration and true north are unknown."}],
        "notes": ["Only this level has recovered geometry; two other schedule rooms have source-listed floors without positions, and 1102 remains explicitly unmapped.",
                  "Outline parts are the published space polygons. They do not assert a complete exterior slab or wall thickness.",
                  "No raster is available; repeated identical vertices were removed without changing any boundary."]}
    area_checks = []
    for key, polygon in pixels.items():
        footprint = transform(polygon)
        row = rows.get(key)
        room_class = classes.get(key, "U")
        refs = [{"source": source_id, "region": "init polys[" + key + "]",
                 "note": "Exact public normalized polygon and official Facilities room ID " + key + "."}]
        if row:
            calculated_sqft = area(footprint) / SQFT_TO_SQM
            delta_sqft = abs(calculated_sqft - row["areaSqft"])
            # The source areas are rounded to whole square feet. Check all pairs,
            # including small service spaces and the classroom excluded from calibration.
            # A 0.01 sq ft margin covers the published six-decimal normalized
            # coordinate quantization; it does not hide a geometric mismatch.
            assert delta_sqft <= 0.51, (key, delta_sqft)
            area_checks.append({"facilityRoomId": key, "label": row["label"],
                                "listedAreaSqft": row["areaSqft"],
                                "convertedAreaSqft": calculated_sqft,
                                "absoluteDifferenceSqft": delta_sqft,
                                "relativeDifference": delta_sqft / row["areaSqft"],
                                "exported": key not in config["excludedPolygons"],
                                "usedForCalibration": key in calibration_ids})
        if key in config["excludedPolygons"]:
            continue
        floor["outline"].append(footprint)
        if room_class in {"C", "U"}:
            item = {"id": "L4-FIS-" + key, "kind": "corridor" if room_class == "C" else "unknown",
                    "footprint": footprint, "confidence": "direct", "sources": refs}
            if row:
                item["label"] = row["label"]
            floor["areas"].append(item)
        else:
            assert row, "No room label available"
            schedule_key = config["classrooms"].get(key)
            assert schedule_key is None or schedule_key == row["label"]
            floor["rooms"].append({
                "id": "L4-FIS-" + key, "label": row["label"], "scheduleKey": schedule_key,
                "floor": "L4", "type": "classroom" if schedule_key else "restroom" if room_class == "T"
                else "service" if room_class in {"J", "M"} else "unknown",
                "footprint": footprint, "confidence": {"location": "direct", "shape": "direct", "label": "direct"},
                "sources": refs,
                "notes": [f"Published listed area: {row['areaSqft']:g} sq ft. Geometry is directly converted from the public vector.",
                          "True north, campus position and surveyed dimensions are not established."]})
    output = {
        "schemaVersion": 1, "building": "BRF2", "name": "Biomedical Research Facility II (Israni BRF)",
        "geometryStatus": "facilities-plan",
        "provenance": "Public UC San Diego Facilities fourth-floor vectors identify classroom 4103 exactly. Original event-organizer pages establish floors for 1104 and 5A03 without geometry; 1102 remains unmapped. No campus placement or surveyed vertical dimensions are claimed.",
        "coordinateSystem": {"units": "meters", "northDeg": None,
                             "description": "Native fourth-floor plan axes, centered locally and scaled using 89 independent published room areas.",
                             "northNote": "True north, campus registration and alignment to other floors are unknown."},
        "sources": [{"id": source_id, "title": source["title"], "url": source["url"],
                     "localFile": source["localPath"], "publisher": "UC San Diego Facilities",
                     "building": "BRF2", "floors": ["L4"], "accessed": source["accessed"],
                     "orientation": "Native plan axes; true north unverified.",
                     "scale": "Calibrated from 89 non-target polygon/area pairs. 4103 is checked independently against 740 sq ft.",
                     "notes": ["Public HTML SHA-256: " + source["sha256"],
                               "bkey 903, fcode 4, plan key 11089. Raster returned Login HTML; only public vectors are used.",
                               "No drawing revision date is established. HTML metadata is not treated as a plan revision."]}],
        "floors": [floor], "scheduleAliases": [], "knownUnmapped": config["knownUnmapped"],
        "notes": config["limitations"]}
    for listing in floor_evidence["listings"]:
        output["sources"].append({
            "id": listing["sourceId"], "title": listing["title"], "url": listing["url"],
            "publisher": "Rat Genes — UC San Diego research event organizers",
            "building": "BRF2", "floors": [listing["floor"]],
            "accessed": floor_evidence["reviewedAt"][:10],
            "notes": ["Floor evidence only; no plan, dimensions or room position are published.",
                      "Evidence: " + FLOOR_EVIDENCE, "Event date: " + listing["eventDate"]]})
        output["floors"].append({
            "id": listing["floor"], "label": listing["floorLabel"] + " — floor listing only",
            "shortLabel": listing["floor"][1:],
            "vertical": {"baseElevation": (int(listing["floor"][1:]) - 1) * 3.5,
                         "height": 3.5, "estimated": True,
                         "note": "Display ordering only; no measured elevation or floor geometry is established."},
            "outline": [], "outlineConfidence": "unknown", "rooms": [], "areas": [],
            "unplaced": [{"label": listing["scheduleKey"], "scheduleKey": listing["scheduleKey"],
                          "basis": "floor-listing"}],
            "sources": [{"source": listing["sourceId"], "region": listing["section"],
                         "note": listing["excerpt"]}],
            "notes": ["The event organizer explicitly lists this room on this floor. Its boundary and position remain unknown.",
                      "No floor outline is drawn or copied from another level."] + listing.get("limitations", [])})
    output["floors"].sort(key=lambda f: int(f["id"][1:]))
    checks_by_id = {c["facilityRoomId"]: c for c in area_checks}
    report = {
        "schemaVersion": 1, "building": "BRF2", "output": config["output"],
        "inputHashes": {CONFIG: sha(CONFIG), FLOOR_EVIDENCE: sha(FLOOR_EVIDENCE), source["localPath"]: source["sha256"]},
        "source": source, "publicPolygonCount": len(native), "listedRoomCount": len(rows),
        "importedPolygonCount": len(floor["outline"]),
        "excludedPolygons": config["excludedPolygons"],
        "exportedRoomCount": len(floor["rooms"]), "exportedAreaCount": len(floor["areas"]),
        "originalNormalizedPolygons": native, "officialRoomRows": rows,
        "consecutiveAndClosingDuplicateVerticesRemoved": cleanup,
        "scaleCalibration": {"metersPerNativePixel": scale, "pairCount": len(calibration_ids),
                             "calibrationRoomIds": calibration_ids,
                             "method": "Midpoint of the common squared-scale interval allowed by 89 independently rounded whole-square-foot areas; target 4103 and the self-intersecting corridor excluded.",
                             "admissibleSquaredScaleInterval": [low, high],
                             "maximumRelativeScaleDifference": max(abs(s / scale - 1) for s in scales.values()),
                             "areaCheckCount": len(area_checks),
                             "maximumAbsoluteAreaDifferenceSqft": max(c["absoluteDifferenceSqft"] for c in area_checks)},
        "heldOutClassroomChecks": [checks_by_id[key] for key in config["classrooms"]],
        "areaChecks": area_checks, "recoveredScheduleKeys": ["4103"],
        "remainingUnmappedKeys": [x["scheduleKey"] for x in config["knownUnmapped"]],
        "floorListingEvidence": floor_evidence,
        "floorListedUnplacedKeys": [x["scheduleKey"] for x in floor_evidence["listings"]],
        "reviewImage": "local/indoor-sources/BRF2-review/L4-vector-review.png",
        "limitations": config["limitations"]}
    (ROOT / config["output"]).write_text(json.dumps(output, separators=(",", ":")) + "\n")
    (ROOT / "data/indoor/BRF2/fis-vector-review.json").write_text(json.dumps(report, indent=2) + "\n")
    if args.review:
        from PIL import Image, ImageDraw, ImageFont
        image = Image.new("RGB", (1500, 1900), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype("DejaVuSans.ttf", 12)
        title_font = ImageFont.truetype("DejaVuSans.ttf", 23)
        draw.text((25, 15), "BRF2 L4 — exact public vector boundaries", fill="black", font=title_font)
        draw.text((25, 48), "Blue: 4103 / ID 73656; no raster, north or campus registration is claimed.", fill="black", font=font)
        draw.text((25, 68), "Corridor (C)4107 is omitted: its published ring self-intersects. Other boundaries remain unchanged.", fill="black", font=font)
        factor = 0.19
        for key, polygon in pixels.items():
            if key in config["excludedPolygons"]:
                continue
            points = [(x * factor + 50, y * factor + 90) for x, y in polygon["outer"]]
            target = key in config["classrooms"]
            draw.polygon(points, fill=(180, 218, 255) if target else (242, 242, 242),
                         outline=(0, 70, 200) if target else (135, 135, 135), width=3 if target else 1)
            for ring in polygon["holes"]:
                draw.polygon([(x * factor + 50, y * factor + 90) for x, y in ring], fill="white", outline="gray")
            if key in rows:
                # Review-only anchor, never exported as a mapped room position.
                x = sum(p[0] for p in points) / len(points)
                y = sum(p[1] for p in points) / len(points)
                draw.text((x, y), rows[key]["label"], font=font, anchor="mm",
                          fill=(0, 60, 180) if target else "black")
        path = ROOT / report["reviewImage"]
        path.parent.mkdir(exist_ok=True)
        image.save(path)
    print(f"BRF2: 4103 recovered; {len(native)} public space polygons; {len(calibration_ids)} scale pairs; 1104/5A03 floor-listed only; 1102 unmapped.")


if __name__ == "__main__":
    main()

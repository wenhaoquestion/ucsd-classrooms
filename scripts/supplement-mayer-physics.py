#!/usr/bin/env python3
"""Recover six Mayer rooms from the reviewed Physics emergency-plan packet.

python scripts/supplement-mayer-physics.py [--review]
Standard-library build; optional overlays require Poppler and Pillow.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TRACE = ROOT / "data/indoor/MAYER/physics-trace.json"
OUTPUT = ROOT / "static/indoor/MAYER-combined.json"
REPORT = ROOT / "data/indoor/MAYER/physics-supplement.json"


def fit(source, target):
    src = [complex(*p) for p in source]
    dst = [complex(*p) for p in target]
    sm, tm = sum(src) / len(src), sum(dst) / len(dst)
    multiplier = sum((s-sm).conjugate() * (t-tm) for s, t in zip(src, dst)) / sum(abs(s-sm)**2 for s in src)
    return multiplier, tm - multiplier * sm


def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1]))) / 2


def clip_old_wing(ring, edge):
    """Keep the old-wing side of the existing straight expansion-wing join."""
    (x1, z1), (x2, z2) = edge
    side = lambda p: p[0] - x1 - (p[1]-z1) * (x2-x1)/(z2-z1)
    result = []
    for start, end in zip(ring[-1:]+ring[:-1], ring):
        a, b = side(start), side(end)
        if (a <= 0) != (b <= 0):
            fraction = a / (a-b)
            result.append([start[i] + fraction*(end[i]-start[i]) for i in (0, 1)])
        if b <= 0:
            result.append(end)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    trace = json.loads(TRACE.read_text())
    pdf = ROOT / trace["source"]["localPath"]
    if hashlib.sha256(pdf.read_bytes()).hexdigest() != trace["source"]["sha256"]:
        raise ValueError("Source PDF changed: re-review required")
    baseline_path = ROOT / trace["targetLayout"]
    baseline = json.loads(baseline_path.read_text())
    if baseline["building"] != "MAYER" or baseline["coordinateSystem"]["units"] != "meters":
        raise ValueError("Expected the reviewed Facilities Mayer meter frame")
    result = copy.deepcopy(baseline)
    source_id = trace["source"]["id"]
    result["sources"].append({
        "id": source_id, "title": "Physics Department Emergency Action Plan — Mayer Hall floor diagrams",
        "url": trace["source"]["url"], "publisher": "UC San Diego Department of Physics / EH&S",
        "building": "MAYER", "floors": ["L2", "L4", "L5"], "accessed": trace["source"]["accessed"],
        "revision": trace["source"]["revision"],
        "orientation": "Mayer legacy diagrams print north toward page-left. Registration rotates each drawing into the existing local meter frame.",
        "scale": "Approximate scale fitted to matching Facilities wall corners; no independent surveyed dimensions.",
        "imageRef": f"Original PDF: {trace['source']['bytes']} bytes; SHA-256 {trace['source']['sha256']}",
        "notes": ["Official source link: " + trace["source"]["discoveryUrl"], trace["method"]]
    })
    result["provenance"] += " Six old-wing rooms are supplemented from the actual Physics emergency-plan packet, using approximate registration to matching expansion-wing walls."
    result["notes"] = result.get("notes", []) + trace["limitations"]
    recovered, reports = [], []
    for drawing in trace["floors"]:
        floor = next(f for f in result["floors"] if f["id"] == drawing["id"])
        reference = next(f for f in baseline["floors"] if f["id"] == drawing["targetFloor"])
        rooms = {r["id"]: r for r in reference["rooms"]}
        target = lambda p: rooms[p["targetRoomId"]]["footprint"]["outer"][p["targetVertex"]]
        multiplier, offset = fit([p["sourcePoint"] for p in drawing["controls"]], [target(p) for p in drawing["controls"]])
        def transform(point):
            p = multiplier * complex(*point) + offset
            return [p.real, p.imag]
        rounded = lambda p: [round(v, 6) for v in p]
        checks = {name: [{**p, "targetPoint": target(p), "transformedPoint": transform(p["sourcePoint"]),
                         "residualMeters": math.dist(transform(p["sourcePoint"]), target(p))} for p in drawing[name]]
                  for name in ("controls", "holdouts")}
        if max(p["residualMeters"] for p in checks["controls"]) > 0.4 or max(p["residualMeters"] for p in checks["holdouts"]) > 1.5:
            raise ValueError(f"{drawing['id']} registration changed: re-review required")
        additions = []
        for room in drawing["rooms"]:
            listed = next(r for r in floor["unplaced"] if r["scheduleKey"] == room["key"])
            polygon = [transform(p) for p in room["outer"]]
            square_feet = area(polygon) / 0.09290304
            notes = ["Principal walls traced from the actual scanned floor diagram. Small door/column recesses are simplified. Placement and shape remain approximate."]
            if "listedAreaSqft" in room:
                if listed["areaSqft"] != room["listedAreaSqft"]:
                    raise ValueError("Facilities area changed: re-review required")
                difference = abs(square_feet/listed["areaSqft"]-1)
                if difference > 0.15:
                    raise ValueError("Traced/listed area discrepancy exceeds the reviewed tolerance")
                notes.append(f"Traced area {square_feet:.1f} sq ft versus listed {listed['areaSqft']} sq ft ({difference:.1%} difference); this is a consistency check, not survey accuracy.")
            floor["rooms"].append({
                "id": f"{drawing['id']}-PHYSICS-{room['key']}", "label": room["key"], "scheduleKey": room["key"],
                "type": "unknown", "floor": floor["id"], "footprint": {"outer": [rounded(p) for p in polygon]},
                "labelAt": rounded(transform(room["labelAt"])),
                "confidence": {"location": "approximate", "shape": "approximate", "label": "direct"},
                "sources": [{"source": source_id, "page": drawing["page"]}, {"source": "UCSD-FIS", "note": "Existing schedule-key inventory; matching expansion-wing walls support approximate registration."}],
                "notes": notes
            })
            recovered.append(room["key"])
            additions.append({"key": room["key"], "tracedAreaSqft": square_feet,
                              **({"listedAreaSqft": listed["areaSqft"], "relativeDifference": difference} if "listedAreaSqft" in room else {})})
        floor["unplaced"] = [r for r in floor["unplaced"] if r["scheduleKey"] not in recovered]
        old_wing = clip_old_wing([transform(p) for p in drawing["oldWingOutlinePx"]], drawing["existingJoinEdge"])
        floor["outline"].append({"outer": [rounded(p) for p in old_wing]})
        floor["outlineConfidence"] = "approximate"
        floor["sources"].append({"source": source_id, "page": drawing["page"]})
        floor["notes"] = (["The expansion-wing outline is inherited from Level 4 and not newly verified."] if floor["id"] == "L5" else floor.get("notes", [])) + [
            "The added old-wing slab is a simplified main-body envelope traced from the visible room/corridor bounds and clipped at the existing expansion-wing join. Other old-wing interiors and exterior bridges/stairs are not modeled."]
        origin = -offset/multiplier
        floor.setdefault("transforms", []).append({"source": source_id, "imageSizePx": trace["render"]["sizePx"],
            "originPx": [origin.real, origin.imag], "rotationDeg": math.degrees(math.atan2(multiplier.imag, multiplier.real)),
            "scale": abs(multiplier), "note": f"Scanned physical PDF page {drawing['page']}, rendered with -scale-to 2400. Approximate similarity registration; see data/indoor/MAYER/physics-supplement.json."})
        reports.append({"floor": floor["id"], "page": drawing["page"], "targetFloor": reference["id"], "checks": checks,
            "transform": {"a": multiplier.real, "b": multiplier.imag, "tx": offset.real, "tz": offset.imag,
                          "metersPerRenderPixel": abs(multiplier), "rotationDeg": math.degrees(math.atan2(multiplier.imag, multiplier.real))}, "rooms": additions})
    if set(recovered) != {"2110", "2130", "2306", "2326", "4322", "5301"} or len(recovered) != 6:
        raise ValueError("Unexpected recovered key set")
    old_rooms = {r["id"]: r for f in baseline["floors"] for r in f["rooms"]}
    new_rooms = {r["id"]: r for f in result["floors"] for r in f["rooms"]}
    if any(new_rooms.get(key) != value for key, value in old_rooms.items()):
        raise ValueError("Original geometry must remain unchanged")
    OUTPUT.write_text(json.dumps(result, separators=(",", ":"))+"\n")
    REPORT.write_text(json.dumps({"building": "MAYER", "source": trace["source"], "recoveredKeys": recovered,
        "inputHashes": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in (TRACE, baseline_path, pdf)},
        "originalRoomsPreserved": len(old_rooms), "floors": reports, "limitations": trace["limitations"]}, indent=2)+"\n")
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: six recovered rooms; {len(old_rooms)} original room shapes preserved")
    if args.review:
        review(trace, baseline, reports, pdf)


def review(trace, baseline, reports, pdf):
    from PIL import Image, ImageDraw, ImageFont
    folder = ROOT / "local/indoor-sources/physics-review"
    folder.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype("DejaVuSans.ttf", 23)
    for drawing, report in zip(trace["floors"], reports):
        page = drawing["page"]
        filename = folder / f"detail-{page}.png"
        if not filename.exists():
            subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-scale-to", "2400", "-png", str(pdf), str(folder/"detail")], check=True)
        image = Image.open(filename).convert("RGBA")
        if list(image.size) != trace["render"]["sizePx"]:
            raise ValueError("Review raster dimensions differ from the trace")
        layer = Image.new("RGBA", image.size)
        draw = ImageDraw.Draw(layer)
        outline = [tuple(p) for p in drawing["oldWingOutlinePx"]]
        draw.line(outline+[outline[0]], fill=(240, 140, 0, 230), width=3)
        for room in drawing["rooms"]:
            draw.polygon([tuple(p) for p in room["outer"]], fill=(0, 150, 255, 50), outline=(0, 100, 220, 255), width=3)
            draw.text(tuple(room["labelAt"]), room["key"], fill=(0, 60, 180), font=font, anchor="mm")
        for name, color in [("controls", (160, 0, 180)), ("holdouts", (0, 160, 60))]:
            for i, point in enumerate(drawing[name]):
                x, y = point["sourcePoint"]
                draw.ellipse((x-5, y-5, x+5, y+5), fill=color)
                draw.text((x+5, y-25), f"{name[0].upper()}{i+1}", fill=color, font=font)
        Image.alpha_composite(image, layer).convert("RGB").save(folder/f"MAYER-{drawing['id']}-review.png")
        # Separate overlay checks the registration against every existing room.
        t = report["transform"]
        m, offset = complex(t["a"], t["b"]), complex(t["tx"], t["tz"])
        fit_image = Image.open(filename).convert("RGB")
        fit_draw = ImageDraw.Draw(fit_image)
        reference = next(f for f in baseline["floors"] if f["id"] == drawing["targetFloor"])
        for room in reference["rooms"]:
            points = [(complex(*p)-offset)/m for p in room["footprint"]["outer"]]
            xy = [(p.real, p.imag) for p in points]
            fit_draw.line(xy+[xy[0]], fill=(230, 40, 180), width=2)
        fit_image.save(folder/f"MAYER-{drawing['id']}-registration.png")
    print(f"Review overlays written to {folder.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

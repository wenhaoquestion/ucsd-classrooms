#!/usr/bin/env python3
"""Supplement GH with the dimensioned, numbered 2016 room 242 diagram.

The 2012 design scheme establishes only approximate within-building position.
This is an independent local view: no campus registration is asserted.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/GH/242-trace.json"
OUTPUT = "static/indoor/GH-combined.json"


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    for source in trace["sources"]:
        if hashlib.sha256((ROOT / source["localPath"]).read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError("Source changed: " + source["localPath"])
    original = json.loads((ROOT / trace["baseLayout"]).read_text())
    layout = copy.deepcopy(original)
    # Keep every existing plate in its original local meter frame; remove only
    # the link from that frame to the campus map. The new room is transformed
    # into this same frame by the explicit measured scale and coarse offset.
    layout.pop("geo", None)
    layout["geometryStatus"] = "source-traced"
    layout["coordinateSystem"] = {
        "units": "meters", "northDeg": 0,
        "description": "Independent local meter view centered on the inherited approximate floor plates. Room 242 scale comes from its dimensioned UCSD seating plan; its coarse position uses the 2012 design scheme. Campus registration is deliberately unset.",
        "northNote": "North is inherited from the old local floor frame. The 2012 scheme points north to page left; matching the auditorium front makes north point down in the 2016 room diagram. This orientation crosswalk is approximate."
    }
    registration = trace["registration"]
    dimensions = trace["dimensionCheck"]
    scale = dimensions["primary"]["meters"] / dimensions["primary"]["pixels"]
    original_floor = next(f for f in original["floors"] if f["id"] == "L3")
    floor = next(f for f in layout["floors"] if f["id"] == "L3")
    listed = next(r for r in floor["unplaced"] if r["scheduleKey"] == "242")
    if floor["rooms"]:
        raise ValueError("GH L3 has new geometry; review before combining")
    outline = original_floor["outline"][0]["outer"]
    width = max(p[0] for p in outline) - min(p[0] for p in outline)
    depth = max(p[1] for p in outline) - min(p[1] for p in outline)
    bounds = registration["schemeInteriorBoundsPx"]
    chamber = registration["schemeAuditoriumBoundsPx"]
    center = [(chamber[i] + chamber[i + 2]) / 2 for i in range(2)]
    origin = [(bounds[i] + bounds[i + 2]) / 2 for i in range(2)]
    # North points left in the scheme. Normalize its approximate central
    # position, not its scale, to the inherited plate. This is not a survey fit.
    offset = [-(center[1] - origin[1]) / (bounds[3] - bounds[1]) * width,
              (center[0] - origin[0]) / (bounds[2] - bounds[0]) * depth]

    def transform(p):
        return [round(offset[i] - (p[i] - registration["roomOriginPx"][i]) * scale, 6) for i in range(2)]

    polygon = [transform(p) for p in trace["roomOuterPx"]]
    room_area = area(polygon) / 0.09290304
    note = ("This auditorium spans Levels 2 and 3. L3 is retained only as the display layer from the Facilities listing; "
            "it does not establish a single physical floor or an entrance route. The 2016 numbered seating plan supplies the full room boundary and dimensions. "
            "The 2017 published building plan shows only its lower portion. Approximate placement uses a 2012 design scheme marked NOT FOR CONSTRUCTION.")
    floor["rooms"] = [{
        "id": "L3-242-SPANNING-L2-L3", "label": "242", "scheduleKey": "242",
        "name": "417-seat auditorium — spans Levels 2 and 3", "type": "lecture-hall", "floor": "L3",
        "footprint": {"outer": polygon}, "labelAt": transform(registration["roomOriginPx"]),
        "confidence": {"location": "approximate", "shape": "traced", "label": "direct"},
        "sources": [
            {"source": "GH-242-SEATING-2016", "page": 1, "note": "Printed room number, 417 seats, perimeter and measured dimensions"},
            {"source": "GH-DESIGN-L3-2012", "note": "Approximate orientation and central position only; schematic proposal with no final room number"},
            {"source": "UCSD-FIS", "note": "Existing L3 listing is preserved as display layer only; listed area is a consistency check"}
        ],
        "notes": [note, "Front curved wall is sampled as a polygon; door openings are closed for visualization. No internal seats, circulation routes or stepped elevations are modeled.",
                  f"Traced area approximately {room_area:.0f} ft²; Facilities lists {listed['areaSqft']} ft². This is not a survey-area reconciliation."]
    }]
    floor["unplaced"] = [r for r in floor["unplaced"] if r["scheduleKey"] != "242"]
    floor.setdefault("sources", []).extend([{"source": "GH-242-SEATING-2016", "page": 1}, {"source": "GH-DESIGN-L3-2012"}])
    floor.setdefault("notes", []).append(note)
    floor["label"] = "Level 3 · room 242 spans Levels 2–3"
    for f in layout["floors"]:
        f.setdefault("notes", []).append("The inherited approximate campus-derived floor plate and floor-only room listings are retained in the same local frame. The plate is not a newly verified floor plan.")
    for source in trace["sources"]:
        layout["sources"].append({k: v for k, v in source.items() if k not in ("localPath", "sha256")})
        layout["sources"][-1]["notes"] = ["Local source SHA-256: " + source["sha256"]]
    layout["provenance"] = ("Facilities floor-only room listings and approximate floor plates, supplemented with the actual numbered 2016 GH242 room diagram. "
                            "The auditorium spans L2–L3 and is displayed once on L3. Position is approximate; this local view has no campus registration.")
    independent_scale = dimensions["independent"]["meters"] / dimensions["independent"]["pixels"]
    report = {"building": "GH", "output": OUTPUT, "addedScheduleKeys": ["242"],
              "displayFloor": "L3", "physicalFloorScope": ["L2", "L3"],
              "displayFloorBasis": "Preserved existing Facilities listing, not confirmation that room 242 occupies only L3",
              "campusRegistration": False, "metersPerTracePixel": scale,
              "independentDimensionScaleDifference": abs(independent_scale / scale - 1),
              "localOffsetMeters": offset, "tracedAreaSqft": room_area,
              "listedAreaSqft": listed["areaSqft"], "relativeAreaDifference": abs(room_area / listed["areaSqft"] - 1),
              "retainedFloors": [f["id"] for f in layout["floors"]],
              "remainingUnplaced": [r["scheduleKey"] for f in layout["floors"] for r in f["unplaced"]],
              "limitations": trace["limitations"],
              "inputHashes": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in [TRACE, trace["baseLayout"]]}}
    if report["independentDimensionScaleDifference"] > 0.02 or report["relativeAreaDifference"] > 0.15:
        raise ValueError("Dimension or area consistency check failed")
    (ROOT / OUTPUT).write_text(json.dumps(layout, separators=(",", ":")) + "\n")
    (ROOT / "data/indoor/GH/242-review.json").write_text(json.dumps(report, indent=2) + "\n")

    from PIL import Image, ImageDraw
    out = ROOT / "local/indoor-sources/GH-review"
    out.mkdir(exist_ok=True)
    subprocess.run(["pdftoppm", "-f", "1", "-singlefile", "-scale-to", "2200", "-png",
                    str(ROOT / trace["sources"][0]["localPath"]), str(out / "242-source")], check=True)
    image = Image.open(out / "242-source.png").convert("RGBA").resize(tuple(trace["imageSizePx"]))
    overlay = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(overlay)
    pts = [tuple(p) for p in trace["roomOuterPx"]]
    draw.polygon(pts, fill=(0, 180, 70, 50))
    draw.line(pts + pts[:1], fill=(0, 140, 50, 255), width=2)
    Image.alpha_composite(image, overlay).convert("RGB").save(out / "242-outline-review.png")
    print(f"GH242: {room_area:.1f} ft², {report['relativeAreaDifference']:.2%} from listed area; 4 floors retained, 19 rooms remain unplaced")


if __name__ == "__main__":
    main()

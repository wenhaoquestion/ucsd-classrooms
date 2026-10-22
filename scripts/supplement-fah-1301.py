#!/usr/bin/env python3
"""Rebuild retained FAH emergency-plan geometry, then add public FIS room 1301.

python scripts/supplement-fah-1301.py [--review]
The original JS builder also invokes this supplement, so either entry point
produces the same three-room output. Relative units and existing rooms survive.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TRACE = "data/indoor/FAH/fis-1301-trace.json"


def read(path):
    return json.loads((ROOT / path).read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    parser.add_argument("--from-base", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.from_base:
        subprocess.run(["node", "scripts/build-fah-indoor.mjs"], cwd=ROOT,
                       env={**os.environ, "FAH_BASE_ONLY": "1"}, check=True)
    trace = read(TRACE)
    source = trace["source"]
    assert sha(source["localPath"]) == source["sha256"]
    assert sha(source["htmlPath"]) == source["htmlSha256"]
    assert sha(trace["output"]) == trace["baseSha256"], "Review changed emergency-plan base before supplementing"
    base = read(trace["output"])
    result = copy.deepcopy(base)
    assert result["coordinateSystem"]["units"] == "relative" and "geo" not in result
    floor = next(f for f in result["floors"] if f["id"] == "L1")
    rooms = {r["label"]: r for r in floor["rooms"]}
    assert set(rooms) == {"1101", "1450"}
    assert [r["scheduleKey"] for r in floor["unplaced"]] == ["1301"]
    spec = importlib.util.spec_from_file_location("registration", ROOT / "scripts/supplement-ebu2-584.py")
    utils = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(utils)

    def target(p):
        return rooms[p["room"]]["footprint"]["outer"][p["vertex"]]

    controls = trace["registration"]["controlPoints"]
    a,b,tx,tz = utils.fit_similarity([p["point"] for p in controls], [target(p) for p in controls])

    def transform(point):
        u,v = point
        return [a*u-b*v+tx,b*u+a*v+tz]

    def rounded(point):
        return [round(v,6) for v in transform(point)]

    checks = {}
    for kind in ["controlPoints", "holdoutPoints"]:
        checks[kind] = [{**p, "targetPoint": target(p), "residualRelativeUnits": math.dist(transform(p["point"]),target(p))}
                        for p in trace["registration"][kind]]
    assert max(p["residualRelativeUnits"] for p in checks["controlPoints"]) < 0.03
    assert max(p["residualRelativeUnits"] for p in checks["holdoutPoints"]) < 1.0
    item = trace["room"]
    ref = trace["areaCheckReference"]
    pixel_area = utils.area(item["outer"])
    area_from_reference = pixel_area / utils.area(ref["outer"]) * ref["printedAreaSqft"]
    area_delta = abs(area_from_reference / item["printedAreaSqft"] - 1)
    assert area_delta < 0.08, (area_from_reference, item["printedAreaSqft"])
    room = {"id": "FAH-1301", "label": "1301", "scheduleKey": "1301", "floor": "L1", "type": "classroom",
            "footprint": {"outer": [rounded(p) for p in item["outer"]]}, "labelAt": rounded(item["labelAt"]),
            "confidence": {"location": "approximate", "shape": "approximate", "label": "direct"},
            "sources": [{"source": source["id"], "region": "First-floor auditorium explicitly labelled 1301 (5877 sq ft)"},
                        {"source": "UCSD-FIS", "note": "Exact retained schedule key and first-floor listing."}],
            "notes": trace["limitations"][:2]}
    floor["rooms"].append(room)
    floor["unplaced"] = []
    floor["sources"].append({"source": source["id"]})
    floor["notes"] = ["Three exact first-floor classroom labels have reviewed polygons: 1101 and 1450 from the emergency plan, 1301 from the FIS raster."] + trace["limitations"]
    scale = math.hypot(a,b)
    origin = [(-a*tx-b*tz)/(scale*scale),(b*tx-a*tz)/(scale*scale)]
    floor["transforms"].append({"source": source["id"], "imageSizePx": source["imageSizePx"], "originPx": origin,
                                "rotationDeg": math.degrees(math.atan2(b,a)), "scale": scale,
                                "note": "Similarity into retained relative coordinates; not meters. Independent gross-room check errors reach 0.964 relative units; see review JSON."})
    result["sources"].append({"id": source["id"], "title": source["title"], "url": source["url"],
                              "publisher": "UC San Diego Facilities", "building": "FAH", "floors": ["L1"],
                              "accessed": source["accessed"], "revision": source["printedDate"],
                              "notes": ["Review scope: auditorium 1301 only; rooms 1101/1450 provide calibration and retain their previous geometry.",
                                        "Public viewer native raster tiles, zoom 5; SHA-256: "+source["sha256"],
                                        "Runtime coordinates remain relative and without geo; FIS north points up but retained emergency-plan frame differs by approximately 90 degrees.",
                                        "FIS warns its viewer imagery may be outdated; no current CAD-vault export is claimed."]})
    result["provenance"] = "Three classrooms across four retained floors: 1101/1450 and floor silhouettes from UCSD emergency plans; auditorium 1301 from the public 2024-09-17 FIS master-plan raster. Common room corners align the relative frames approximately; no metric or campus placement is claimed."
    assert result["floors"][1:] == base["floors"][1:]
    assert floor["rooms"][:2] == base["floors"][0]["rooms"]
    assert result["coordinateSystem"] == base["coordinateSystem"]
    result["coordinateSystem"]["northDeg"] = None
    result["coordinateSystem"]["northNote"] = "The emergency-plan and FIS raster north arrows both point page-up, but matching room walls requires about 90 degrees of rotation between them. True north is unresolved; only relative room alignment is retained."
    result["notes"] = [
        "Three exact classroom keys, 1101, 1301 and 1450, have reviewed first-floor positions. The first two source types are documented separately in the room references.",
        *[note for note in result.get("notes", []) if not note.startswith(("Two exact", "1301 remains"))],
        result["coordinateSystem"]["northNote"],
    ]
    assert {r["scheduleKey"] for f in result["floors"] for r in f["rooms"]+f.get("unplaced",[])} == {"1101","1301","1450"}
    (ROOT / trace["output"]).write_text(json.dumps(result,separators=(",",":"))+"\n")
    review = {"schemaVersion":1,"building":"FAH","output":trace["output"],"source":source,
              "inputHashes":{TRACE:sha(TRACE),"emergencyPlanBase":trace["baseSha256"]},
              "transform":{"formula":"x=a*u-b*v+tx; z=b*u+a*v+tz","a":a,"b":b,"tx":tx,"tz":tz,
                           "relativeUnitsPerPixel":scale,"rotationDeg":math.degrees(math.atan2(b,a))},
              "registrationChecks":checks,"recoveredScheduleKeys":["1301"],"remainingUnplacedKeys":[],
              "areaCheck":{"pixelArea":pixel_area,"referenceRoom":"1101","referencePrintedAreaSqft":ref["printedAreaSqft"],
                           "areaFromPixelRatioSqft":area_from_reference,"printed1301AreaSqft":item["printedAreaSqft"],"relativeDifference":area_delta},
              "limitations":trace["limitations"]}
    (ROOT / "data/indoor/FAH/fis-1301-review.json").write_text(json.dumps(review,indent=2)+"\n")
    if args.review:
        from PIL import Image,ImageDraw,ImageFont
        im=Image.open(ROOT/source["localPath"]).convert("RGBA")
        overlay=Image.new("RGBA",im.size);draw=ImageDraw.Draw(overlay)
        draw.polygon([tuple(p) for p in item["outer"]],fill=(20,120,255,50),outline=(0,70,190,255),width=5)
        draw.text((1715,1630),"1301",fill=(0,70,190),font=ImageFont.truetype("DejaVuSans.ttf",45),anchor="mt")
        out=Image.alpha_composite(im,overlay).convert("RGB")
        folder=ROOT/"local/indoor-sources/FAH-render";folder.mkdir(exist_ok=True)
        out.save(folder/"L1-FIS-review.png");out.crop((980,1420,2460,2300)).save(folder/"1301-FIS-review.png")
    print("FAH: added 1301, retained 1101/1450 and four relative floors; no remaining unplaced schedule keys.")


if __name__ == "__main__":
    output = ROOT / "static/indoor/FAH.json"
    saved_output = output.read_bytes() if output.exists() else None
    try:
        main()
    except BaseException:
        if saved_output is not None:
            output.write_bytes(saved_output)
        raise

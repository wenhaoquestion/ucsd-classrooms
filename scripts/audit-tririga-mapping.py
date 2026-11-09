"""Rebuild the reviewed, local-only TRIRIGA building identity inventory.

This does not turn approximate name matches into geometry. Each selection is an
explicit name crosswalk, checked against the catalog, retained Facilities bkeys
and campus CAAN names. Compound buildings retain separate source frames.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT.parent / "artifacts/tririga-floorplans/index.json"

# Source identities, room crosswalks and review notes stay in an ignored local
# configuration. Importing this module never reads authenticated review data.


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def normalized(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", value.replace("&", "and").replace("building", ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--review-config", type=Path, default=ROOT / "data/indoor/tririga/mapping-review-config.json",
                        help="Required local reviewed identities and crosswalks; never published with the tool.")
    parser.add_argument("--output", type=Path, default=ROOT / "data/indoor/tririga/building-mapping.json")
    args = parser.parse_args()
    if not args.review_config.is_file():
        parser.error(f"Local reviewed mapping configuration required: {args.review_config}. Supply it with --review-config.")
    review_config = read(args.review_config)
    required_tables = ("NAMES", "SPECIAL", "UNRESOLVED", "LABEL_CROSSWALKS", "CROSSWALK_BASIS", "entryOverrides")
    if review_config.get("schemaVersion") != 1 or any(not isinstance(review_config.get(key), dict) for key in required_tables):
        parser.error("Local reviewed mapping configuration requires schemaVersion 1 and all reviewed tables.")
    if not isinstance(review_config.get("globalLimitations"), list) or not all(isinstance(note, str) for note in review_config["globalLimitations"]):
        parser.error("Local reviewed mapping configuration requires a globalLimitations list of strings.")
    NAMES, SPECIAL, UNRESOLVED, LABEL_CROSSWALKS, CROSSWALK_BASIS = (review_config[key] for key in required_tables[:5])
    index = read(args.index)
    catalog = {k: v for college in read(ROOT / "src/lib/buildings.json")["colleges"].values() for k, v in college.items()}
    campus_codes = read(ROOT / "src/lib/indoor/campusCodes.json")
    campus = read(ROOT / "static/campus/buildings.json")["buildings"]
    campus_names = {b["caan"]: b.get("name") for b in campus if b.get("caan")}
    active = {b["building"]: b for b in read(ROOT / "data/indoor/research/active-term-coverage.json")["buildings"]}
    by_name = defaultdict(list)
    floors = defaultdict(list)
    for record in index["records"]:
        if record["kind"] == "building":
            by_name[record["building_name"]].append(record)
        elif record["kind"] == "floor":
            floors[record["building_record_id"]].append(record)
    manifest = (ROOT / "src/lib/indoor/manifest.ts").read_text(encoding="utf-8")
    overrides = {}
    for match in re.finditer(r'\s+(?:"([A-Z0-9-]+)"|([A-Z0-9-]+)): \{ file: "([^"]+)"', manifest):
        overrides[match[1] or match[2]] = "static/" + match[3]
    entries = []
    for code, info in sorted(catalog.items()):
        baseline = overrides.get(code, f"static/indoor/facilities/{code}.json")
        baseline_path = ROOT / baseline
        old = read(baseline_path) if baseline_path.exists() else None
        bkeys = sorted(set(re.findall(r"bkey[ =](\d+)", json.dumps(old.get("sources", [])) if old else "")))
        old_keys = set()
        if old:
            for floor in old["floors"]:
                for room in floor.get("rooms", []) + floor.get("unplaced", []):
                    if room.get("scheduleKey"):
                        old_keys.add(room["scheduleKey"])
            for room in old.get("knownUnmapped", []):
                if isinstance(room, dict) and room.get("scheduleKey"):
                    old_keys.add(room["scheduleKey"])
                elif isinstance(room, str):
                    old_keys.add(room)
            for alias in old.get("scheduleAliases", []):
                if isinstance(alias, dict) and alias.get("scheduleKey"):
                    old_keys.add(alias["scheduleKey"])
        active_keys = active.get(code, {}).get("exactKeys", [])
        status, note, extra = SPECIAL.get(code, ("mapped", "Exact or reviewed catalog-name correspondence; floor associations remain the source record IDs, not room-number guesses.", []))
        entry = {
            "code": code, "name": info["name"], "status": status if code in NAMES else "unresolved",
            "sourceBuildings": [], "caans": campus_codes.get(code, []),
            "campusNames": {c: campus_names.get(c) for c in campus_codes.get(code, [])},
            "activeScheduleKeys": active_keys, "retainedScheduleKeys": sorted(old_keys),
            "baselineLayout": baseline if old else None,
            "baselineFloors": len(old["floors"]) if old else 0,
            "baselineRooms": sum(len(f.get("rooms", [])) for f in old["floors"]) if old else 0,
            "priority": "active-no-interior" if active_keys and not old else "active-empty-interior" if active_keys and not any(f.get("rooms") for f in (old or {}).get("floors", [])) else "active-correction" if active_keys else "catalog-coverage",
            "evidence": [{"file": "src/lib/buildings.json", "note": f"Catalog code {code} is {info['name']}."}, {"file": "src/lib/indoor/campusCodes.json", "note": "Existing CAANs are identity hints, not verified indoor registration."}],
            "limitations": [note if code in NAMES else UNRESOLVED.get(code, "No reviewed TRIRIGA building crosswalk.")],
        }
        if old:
            entry["evidence"].append({"file": baseline, "sha256": digest(baseline_path), "note": f"Retained runtime baseline; source Facilities bkeys: {', '.join(bkeys) or 'none'}."})
        for path in extra:
            entry["evidence"].append({"file": path, "note": "Prior reviewed identity, numbered-room crosswalk or source limitation."})
        selected_names = NAMES.get(code, [])
        if isinstance(selected_names, str):
            selected_names = [selected_names]
        all_labels = []
        for name in selected_names:
            assert len(by_name[name]) == 1, f"Expected unique source building: {code}: {name}"
            record = by_name[name][0]
            bid = record["building_record_id"]
            source_floors = sorted(floors[bid], key=lambda f: (float(f.get("floor_level", 0)), f["floor_record_id"]))
            source_bkeys = Counter()
            for floor in source_floors:
                for room_id, labels in floor.get("label_detail", {}).get("room_labels", {}).items():
                    for label in labels:
                        m = re.match(r"\(CU\)(\d+)-", label)
                        if m:
                            source_bkeys[m[1]] += 1
                    all_labels.append({"buildingRecordId": bid, "floorRecordId": floor["floor_record_id"], "floorName": floor["floor_name"], "drawingId": floor.get("drawing_id"), "roomRecordId": room_id, "labels": labels})
            entry["sourceBuildings"].append({
                "id": bid, "name": name, "coordinateFrame": bid,
                "identityBasis": "normalized-name" if normalized(info["name"]) == normalized(name) else "reviewed-alias-and-source-crosscheck",
                "sourceBkeys": sorted(source_bkeys), "matchingBaselineBkeys": sorted(set(bkeys) & set(source_bkeys)),
                "floors": [{"id": f["floor_record_id"], "name": f["floor_name"], "levelOrdinal": f.get("floor_level"), "drawingId": f.get("drawing_id"), "status": f["status"], "svgPath": f.get("svg_path"), "labelCount": f.get("label_count", 0)} for f in source_floors],
            })
            entry["evidence"].append({"file": str(args.index.resolve()), "note": f"Exact index building record {bid} is {name}; CU labels corroborate Facilities bkeys {', '.join(sorted(source_bkeys)) or 'not present'}.", "journalLine": record.get("journal_line")})
        entry["independentSourceFrames"] = len(selected_names) > 1
        entry["exactActiveLabelEvidence"] = {key: [r for r in all_labels if key in r["labels"]] for key in active_keys}
        entry["activeKeysWithoutExactSourceLabel"] = [k for k, records in entry["exactActiveLabelEvidence"].items() if not records]
        entry["scheduleLabelCrosswalks"] = []
        for key, label in LABEL_CROSSWALKS.get(code, {}).items():
            matches = [r for r in all_labels if label in r["labels"]]
            assert len(matches) == 1, f"Crosswalk must identify exactly one source space: {code} {key} -> {label}"
            entry["scheduleLabelCrosswalks"].append({"scheduleKey": key, "sourceLabel": label, **matches[0], "basis": CROSSWALK_BASIS[code]})
        crosswalk_keys = {r["scheduleKey"] for r in entry["scheduleLabelCrosswalks"]}
        entry["activeKeysWithoutReviewedSourceLabel"] = [k for k in entry["activeKeysWithoutExactSourceLabel"] if k not in crosswalk_keys]
        entry_override = review_config["entryOverrides"].get(code, {})
        entry.update(entry_override.get("fields", {}))
        for source_override in entry_override.get("sourceBuildings", []):
            entry["sourceBuildings"][source_override["index"]].update(source_override["fields"])
        entries.append(entry)
    mapped = [e for e in entries if e["status"] == "mapped"]
    selected_floors = {
        f["id"]: f
        for e in mapped for source in e["sourceBuildings"] for f in source["floors"]
        if not source.get("includeFloorRecordIds") or f["id"] in source["includeFloorRecordIds"]
    }
    output = {
        "schemaVersion": 1, "sourceIndex": str(args.index.resolve()), "sourceIndexSha256": digest(args.index),
        "sourceIndexGeneratedAt": index.get("generated_at"), "accessPolicy": "local-preview-only; authenticated TRIRIGA source and derived layouts require separate publication review",
        "method": "Explicit reviewed name crosswalk; catalog and CAAN identity; retained Facilities bkeys corroborated by source CU labels. No fuzzy name match creates a mapping.",
        "floorPolicy": "Use floor record IDs and floor names. floor_level is sorting metadata, not a physical level. Roofs, penthouses, mezzanines and basements retain explicit names. Distinct building records are independent CAD frames unless separately registered.",
        "summary": {"catalogCodes": len(entries), "mappedCodes": len(mapped), "preserveExistingCodes": len([e for e in entries if e["status"] == "preserve-existing"]), "unresolvedCodes": len([e for e in entries if e["status"] == "unresolved"]), "mappedWithActiveClasses": sum(bool(e["activeScheduleKeys"]) for e in mapped), "selectedPhysicalBuildings": len({s["id"] for e in mapped for s in e["sourceBuildings"]}), "selectedFloorRecords": len(selected_floors), "selectedExportedFloorRecords": sum(f["status"] == "exported" for f in selected_floors.values()), "selectedDrawingIds": len({f["drawingId"] for f in selected_floors.values() if f.get("drawingId")}), "retainedScheduleKeys": sum(len(e["retainedScheduleKeys"]) for e in entries), "activeScheduleKeys": sum(len(e["activeScheduleKeys"]) for e in entries), "reviewedLabelCrosswalks": sum(len(e["scheduleLabelCrosswalks"]) for e in entries), "activeKeysWithoutReviewedSourceLabel": sum(len(e["activeKeysWithoutReviewedSourceLabel"]) for e in entries), "newInteriorCandidates": [e["code"] for e in mapped if not e["baselineLayout"]], "emptyInteriorCandidates": [e["code"] for e in mapped if e["baselineLayout"] and not e["baselineRooms"]], "independentFrameCodes": [e["code"] for e in mapped if e["independentSourceFrames"]]},
        "globalLimitations": review_config["globalLimitations"],
        "entries": entries,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

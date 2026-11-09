#!/usr/bin/env python3
"""Audit the effective local indoor manifest against fixed stored/FA26 inventories.

python scripts/audit-tririga-coverage.py
Use --allow-partial --output ../artifacts/coverage-preview.json during conversion.
The default audit requires a complete conversion report and writes
data/indoor/tririga/coverage-report.json atomically. No network or source edits.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = ('placed', 'floorListed', 'floorInferred', 'unmapped', 'no-layout')


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def polygon_has_area(polygon):
    ring = polygon.get('outer', [])
    if len(ring) < 3 or any(len(p) != 2 or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in p) for p in ring):
        return False
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1]))) > 1e-10


def index_layout(layout):
    """Mirror exact-key indexing; labels alone never count as schedule mappings."""
    if layout is None:
        return None
    rooms, placed, unplaced, missing, floors = {}, {}, {}, {}, set()
    def assign(key, room):
        if key in placed and placed[key]['roomId'] != room['id']:
            raise ValueError(f'Ambiguous schedule key {key}.')
        placed[key] = {'category': 'placed', 'floor': room['floor'], 'roomId': room['id'], 'label': room['label']}
    for floor in layout['floors']:
        if floor['id'] in floors:
            raise ValueError(f'Duplicate floor ID {floor["id"]}.')
        floors.add(floor['id'])
        for room in floor['rooms']:
            if room['id'] in rooms or room['floor'] != floor['id'] or not polygon_has_area(room['footprint']):
                raise ValueError(f'Invalid or duplicate room {room["id"]}.')
            rooms[room['id']] = room
            if room.get('scheduleKey') is not None:
                assign(room['scheduleKey'], room)
        for room in floor.get('unplaced', []):
            key = room.get('scheduleKey')
            if key is None:
                continue
            if room.get('basis') not in ('floor-listing', 'room-number'):
                raise ValueError(f'Unknown unplaced basis for {key}.')
            unplaced.setdefault(key, {'category': 'floorListed' if room['basis'] == 'floor-listing' else 'floorInferred',
                                     'floor': floor['id'], 'label': room['label'], 'basis': room['basis']})
    for alias in layout.get('scheduleAliases', []):
        if alias['room'] not in rooms:
            raise ValueError(f'Unknown alias target {alias["room"]}.')
        assign(alias['scheduleKey'], rooms[alias['room']])
    for room in layout.get('knownUnmapped', []):
        missing[room['scheduleKey']] = {'category': 'unmapped', 'reason': room['reason']}
    if (set(placed) & set(unplaced)) | (set(placed) & set(missing)) | (set(unplaced) & set(missing)):
        raise ValueError('Schedule keys appear in multiple coverage categories.')
    return {'keys': {**missing, **unplaced, **placed}, 'roomCount': len(rooms), 'floorCount': len(floors)}


def classify(index, key):
    if index is None:
        return {'category': 'no-layout', 'registered': False, 'reason': 'No registered indoor file.'}
    if key in index['keys']:
        return {**index['keys'][key], 'registered': True}
    return {'category': 'unmapped', 'registered': False, 'reason': 'Schedule key absent from explicit layout mappings/listings; label-only fallback is not counted.'}


def compare_inventory(inventory, effective_indexes):
    rows, totals, baseline_totals = [], Counter(), Counter()
    for code, keys in sorted(inventory.items()):
        for key, previous in sorted(keys.items()):
            state = classify(effective_indexes.get(code), key)
            totals[state['category']] += 1
            baseline_totals[previous['category']] += 1
            rows.append({'building': code, 'key': key, 'before': previous['category'], **state})
    counts = lambda c: {k: c[k] for k in CATEGORIES}
    return {'totalKeys': len(rows), 'before': counts(baseline_totals), 'after': counts(totals),
            'positionedGain': totals['placed']-baseline_totals['placed'],
            'registeredKeys': sum(r['registered'] for r in rows),
            'missingRegisteredKeys': [r for r in rows if not r['registered']],
            'lostPositionedKeys': [r for r in rows if r['before'] == 'placed' and r['category'] != 'placed'],
            'newlyPositionedKeys': [r for r in rows if r['before'] != 'placed' and r['category'] == 'placed'],
            'remainingPositionGaps': [r for r in rows if r['category'] != 'placed'], 'keys': rows}


def historical_inventory(report):
    result = {}
    for building in report['buildingsByPositionGap']:
        keys = {key: {'category': 'unmapped'} for key in building['unmappedKeys']}
        for floor in building['floors']:
            for key in floor['placedKeys']:
                keys[key] = {'category': 'placed'}
            for room in floor['positionGaps']:
                keys[room['key']] = {'category': 'floorListed' if room['basis'] == 'floor-listing' else 'floorInferred'}
        result[building['building']] = keys
    return result


def active_inventory(report):
    return {b['building']: {r['key']: {'category': r['category']} for r in b['keys'] if r['category'] != 'nonphysical'}
            for b in report['buildings'] if any(r['category'] != 'nonphysical' for r in b['keys'])}


def public_paths(root):
    manifest = (root/'src/lib/indoor/manifest.ts').read_text(encoding='utf-8')
    def literals(name):
        block = re.search(r'export const '+name+r'[^=]*=\s*\{(.*?)\n\};', manifest, re.S)
        if not block:
            raise ValueError('Manifest format changed: '+name)
        return {code or quoted: ('static/'+file, status) for code, quoted, file, status in re.findall(
            r'(?:\b([A-Z][A-Z0-9]*)|"([A-Z0-9-]+)"):\s*\{\s*file:\s*"([^"]+)",\s*status:\s*"([^"]+)"', block[1])}
    paths = literals('SOURCE_LAYOUTS')
    paths.update({code: (f'static/indoor/facilities/{code}.json', 'facilities-plan')
                  for code in read(root/'static/indoor/facilities/index.json')['buildings']})
    paths.update(literals('SUPPLEMENTAL_LAYOUTS'))
    return paths


def source_floor_records(layout):
    if layout is None:
        return []
    sources = {s['id']: s for s in layout.get('sources', [])}
    records = {}
    for floor in layout['floors']:
        used = {s['source'] for s in floor.get('sources', [])}
        used.update(t['source'] for t in floor.get('transforms', []))
        for obj in floor.get('rooms', []) + floor.get('areas', []) + floor.get('features', []):
            used.update(s['source'] for s in obj.get('sources', []))
        for sid in used:
            source = sources.get(sid, {})
            tri = source.get('tririga')
            if not tri:
                continue
            record = records.setdefault(tri['floorRecordId'], {**tri, 'sourceId': sid, 'title': source['title'],
                                       'localFile': source.get('localFile'), 'url': source.get('url'), 'displayFloorIds': []})
            if floor['id'] not in record['displayFloorIds']:
                record['displayFloorIds'].append(floor['id'])
    return sorted(records.values(), key=lambda r: r['floorRecordId'])


def named_events(value, key):
    result = []
    if isinstance(value, dict):
        for name, item in value.items():
            if name == key:
                result.append(item)
            result.extend(named_events(item, key))
    elif isinstance(value, list):
        for item in value:
            result.extend(named_events(item, key))
    return result


def audit(root=ROOT, allow_partial=False):
    tracked = {}
    def load(relative):
        path = root/relative
        data = path.read_bytes()
        tracked[relative] = hashlib.sha256(data).hexdigest()
        return json.loads(data)
    old_report = load('data/indoor/coverage-current.json')
    active_report = load('data/indoor/research/active-term-coverage.json')
    mapping = load('data/indoor/tririga/building-mapping.json')
    conversion = load('data/indoor/tririga/conversion-report.json')
    private = load('static/indoor/tririga-local/index.json')
    public = public_paths(root)
    effective = {**public, **{code: (f'static/indoor/tririga-local/{code}.json', 'facilities-plan') for code in private['buildings']}}
    layouts, indexes, errors = {}, {}, []
    for code, (relative, status) in effective.items():
        layout = load(relative)
        if layout['building'] != code or layout['geometryStatus'] != status:
            errors.append(f'{code}: manifest identity/status does not match file.')
        layouts[code] = layout
        try:
            indexes[code] = index_layout(layout)
        except (ValueError, KeyError, TypeError) as error:
            indexes[code] = None
            errors.append(f'{code}: {error}')
    baseline_layouts = {code: (layouts[code] if code not in private['buildings'] else load(relative))
                        for code, (relative, _) in public.items()}
    baseline_indexes = {code: index_layout(layout) for code, layout in baseline_layouts.items()}
    stored = compare_inventory(historical_inventory(old_report), indexes)
    active = compare_inventory(active_inventory(active_report), indexes)
    baseline_check = compare_inventory(historical_inventory(old_report), baseline_indexes)
    if stored['totalKeys'] != 551 or stored['before']['placed'] != 420:
        errors.append('Historical stored denominator changed; expected 551 keys / 420 positioned.')
    if active['totalKeys'] != 461 or active['before']['placed'] != 361:
        errors.append('Historical FA26 denominator changed; expected 461 keys / 361 positioned.')
    if baseline_check['missingRegisteredKeys'] or baseline_check['lostPositionedKeys']:
        errors.append('Public baseline no longer preserves the fixed historical inventory.')
    if stored['missingRegisteredKeys']:
        errors.append('Some historical schedule keys disappeared from effective layout records.')
    if stored['lostPositionedKeys']:
        errors.append('Some historically positioned schedule keys lost geometry.')
    if active['lostPositionedKeys']:
        errors.append('Some FA26 previously positioned schedule keys lost geometry.')
    audit_by_code = {b['building']: b for b in conversion.get('buildings', [])}
    mapping_by_code = {e['code']: e for e in mapping['entries']}
    conversion_missing = sorted(set(mapping_by_code)-set(audit_by_code))
    generated_codes = {b['building'] for b in conversion.get('buildings', []) if b['status'] == 'generated'}
    conversion_matches_index = generated_codes == set(private['buildings'])
    complete = not conversion_missing and conversion_matches_index
    if not allow_partial and not complete:
        errors.append('Conversion report is partial or does not match the local index; rerun after the full conversion completes.')
    buildings, unique_source_records, unique_source_buildings = [], set(), set()
    for code, entry in sorted(mapping_by_code.items()):
        old, layout = baseline_layouts.get(code), layouts.get(code)
        old_floors = {f['id']: f for f in (old or {}).get('floors', [])}
        new_floors = {f['id']: f for f in (layout or {}).get('floors', [])}
        old_rooms = sum(len(f['rooms']) for f in old_floors.values())
        new_rooms = sum(len(f['rooms']) for f in new_floors.values())
        local = code in private['buildings']
        converted = audit_by_code.get(code)
        records = source_floor_records(layout)
        imported_ids = {r['floorRecordId'] for r in records}
        unique_source_records.update(imported_ids)
        unique_source_buildings.update(r['buildingRecordId'] for r in records)
        expected = {f['id']: f for s in entry['sourceBuildings'] for f in s['floors']
                    if not s.get('includeFloorRecordIds') or f['id'] in s['includeFloorRecordIds']}
        excluded = {f['sourceFloorRecordId']: f for f in (converted or {}).get('floors', [])
                    if f.get('sourceFloorRecordId') and f.get('status') != 'imported'}
        missing_sources = []
        for rid, source in expected.items():
            if rid in imported_ids:
                continue
            review = excluded.get(rid, {})
            reason = review.get('reason') or review.get('warnings') or (converted or {}).get('reason')
            if not reason:
                reason = '; '.join(entry['limitations']) if entry['status'] != 'mapped' else 'No imported reference in the effective layout; conversion detail unavailable in this snapshot.'
            missing_sources.append({'sourceFloorRecordId': rid, 'name': source['name'], 'drawingId': source['drawingId'],
                                    'sourceStatus': source['status'], 'conversionStatus': review.get('status'), 'reason': reason})
        row = {'building': code, 'name': entry['name'], 'localOverlay': local,
               'effectiveFile': effective.get(code, [None])[0],
               'newIndoorBuilding': local and old is None,
               'formerShellNowHasRooms': local and old is not None and old_rooms == 0 and new_rooms > 0,
               'correctedExistingBuilding': local and old is not None,
               'displayFloorsBefore': len(old_floors), 'displayFloorsAfter': len(new_floors),
               'roomPolygonsBefore': old_rooms, 'roomPolygonsAfter': new_rooms,
               'addedDisplayFloorIds': sorted(set(new_floors)-set(old_floors)),
               'removedDisplayFloorIds': sorted(set(old_floors)-set(new_floors)),
               'existingFloorsNewlyDetailed': sorted(fid for fid in old_floors.keys() & new_floors.keys()
                                                    if not old_floors[fid]['rooms'] and new_floors[fid]['rooms']),
               'referencedTririgaFloorRecords': records, 'referencedSourceFloorCount': len(records),
               'multipleSourceBuildingFrames': sorted({r['buildingRecordId'] for r in records}),
               'missingOrUnimportedSourceFloors': missing_sources,
               'conversionStatus': converted.get('status') if converted else 'not-in-conversion-snapshot',
               'preservedReason': ((converted or {}).get('reason') or '; '.join(entry['limitations'])) if not local else None,
               'sourceUnitCorrections': named_events(converted, 'sourceUnitCorrection') if converted else [],
               'activePositionGaps': [r for r in active['remainingPositionGaps'] if r['building'] == code],
               'storedPositionGaps': [r for r in stored['remainingPositionGaps'] if r['building'] == code],
               'limitations': entry['limitations']}
        buildings.append(row)
    unchanged = all((root/path).exists() and sha(root/path) == digest for path, digest in tracked.items())
    if not unchanged:
        errors.append('An input changed while auditing; rerun after generation finishes.')
    overlay_rows = [b for b in buildings if b['localOverlay']]
    summary = {'publicBuildingCodes': len(public), 'localOverlayBuildingCodes': len(private['buildings']),
               'effectiveBuildingCodes': len(effective), 'newIndoorBuildingCodes': [b['building'] for b in buildings if b['newIndoorBuilding']],
               'formerShellsNowWithRooms': [b['building'] for b in buildings if b['formerShellNowHasRooms']],
               'correctedExistingBuildingCodes': [b['building'] for b in buildings if b['correctedExistingBuilding']],
               'localDisplayFloors': sum(b['displayFloorsAfter'] for b in overlay_rows),
               'localRoomPolygons': sum(b['roomPolygonsAfter'] for b in overlay_rows),
               'effectiveDisplayFloors': sum(v['floorCount'] for v in indexes.values() if v),
               'effectiveRoomPolygons': sum(v['roomCount'] for v in indexes.values() if v),
               'addedDisplayFloorRecords': sum(len(b['addedDisplayFloorIds']) for b in overlay_rows),
               'removedDisplayFloorRecords': sum(len(b['removedDisplayFloorIds']) for b in overlay_rows),
               'existingFloorRecordsNewlyDetailed': sum(len(b['existingFloorsNewlyDetailed']) for b in overlay_rows),
               'referencedTririgaFloorRecordViews': sum(b['referencedSourceFloorCount'] for b in buildings),
               'distinctReferencedTririgaFloorRecords': len(unique_source_records),
               'distinctReferencedTririgaBuildingRecords': len(unique_source_buildings),
               'sourceUnitCorrectionCount': sum(len(b['sourceUnitCorrections']) for b in buildings),
               'multipleSourceFrameCodes': [b['building'] for b in buildings if len(b['multipleSourceBuildingFrames']) > 1],
               'stored551': {'registered': stored['registeredKeys'], 'positionedBefore': 420, 'positionedAfter': stored['after']['placed'], 'positionedGain': stored['positionedGain']},
               'activeFA26': {'totalKeys': 461, 'positionedBefore': 361, 'positionedAfter': active['after']['placed'],
                              'positionedGain': active['positionedGain'], 'counts': active['after']}}
    return {'schemaVersion': 1, 'publication': 'local-only; authenticated derivatives require separate release review',
            'completeConversionSnapshot': complete, 'inputsUnchangedDuringAudit': unchanged,
            'conversionCodesMissingFromSnapshot': conversion_missing, 'conversionGeneratedCodesMatchIndex': conversion_matches_index,
            'ok': not errors, 'errors': errors, 'summary': summary, 'storedInventory': stored, 'activeTermInventory': active,
            'activeTermSnapshot': active_report['snapshot'], 'buildings': buildings, 'inputSha256': tracked,
            'methodology': [
                'Effective local manifest = current SOURCE_LAYOUTS, Facilities index, SUPPLEMENTAL_LAYOUTS, then tririga-local/index overrides. Unregistered stale local files do not count.',
                '551 stored keys / 420 prior positioned keys come from the retained coverage-current report, independently of generated output. FA26 uses all 461 physical keys / 361 prior placed keys from the production-parser audit snapshot.',
                'Only explicit scheduleKey or scheduleAliases joins count as positioned. Room-label URL fallback is excluded; numeric strings and leading zeros stay exact.',
                'Registered means a key remains in explicit placed, floor-listed, floor-inferred or known-unmapped records. Runtime schedules are independently fetched; this audits preservation of indoor navigation metadata.',
                'Display floor IDs, newly detailed display floors, referenced source floor views, and distinct physical floor record IDs are separate counts. Added display IDs can include renamed or split levels and are not asserted to be newly discovered physical storeys.',
                'Geometry checks here cover finite nonzero room polygons and index integrity; run validate:indoor --local separately for full schema and polygon validation.',
                'Source-unit correction details require the matching complete conversion report. Missing conversion rows are never interpreted as a successful conversion.',
            ]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='data/indoor/tririga/coverage-report.json')
    parser.add_argument('--allow-partial', action='store_true')
    args = parser.parse_args()
    report = audit(allow_partial=args.allow_partial)
    path = ROOT/args.output
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    temporary.replace(path)
    print(json.dumps({'ok': report['ok'], 'completeConversionSnapshot': report['completeConversionSnapshot'],
                      'errors': report['errors'], 'summary': report['summary']}, indent=2))
    if not report['ok']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

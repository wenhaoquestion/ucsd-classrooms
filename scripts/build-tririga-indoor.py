#!/usr/bin/env python3
"""Build authenticated TRIRIGA layouts for local preview only.

python scripts/build-tririga-indoor.py --source-root ../artifacts/tririga-floorplans
Requires numpy/scipy. No network requests or original SVG copies are made.
Public source layouts are never overwritten. The local index is written last.
"""
import argparse
from collections import Counter, defaultdict
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import sys

import numpy as np
import scipy

from tririga_svg import parse_svg, point_in_ring
from tririga_registration import bounds, centroid, polygon_area, register, transform_polygons
from tririga_baseline_registration import registration_to_baseline

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'static/indoor/tririga-local'
REPORT = ROOT / 'data/indoor/tririga'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def json_native(value):
    """Convert numerical audit scalars without losing their boolean semantics."""
    if isinstance(value,np.generic):
        return value.item()
    if isinstance(value,np.ndarray):
        return value.tolist()
    raise TypeError(f'Unsupported report value: {type(value).__name__}')


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'),default=json_native,allow_nan=False)+'\n', encoding='utf-8')
    temporary.replace(path)


def public_layouts():
    paths = {code: ROOT / f'static/indoor/facilities/{code}.json'
             for code in read(ROOT/'static/indoor/facilities/index.json')['buildings']}
    manifest = (ROOT/'src/lib/indoor/manifest.ts').read_text(encoding='utf-8')
    for name in ('SOURCE_LAYOUTS', 'SUPPLEMENTAL_LAYOUTS'):
        block = re.search(r'export const '+name+r'[^=]*=\s*\{(.*?)\n\};', manifest, re.S)
        for relative in re.findall(r'file:\s*"([^"]+)"', block[1]):
            path = ROOT/'static'/relative
            paths[read(path)['building']] = path
    return {code: read(path) for code, path in paths.items()}


def level(record):
    """TRIRIGA floor_level is a sort ordinal, not a physical storey number."""
    name = record['floor_name'].lower()
    if 'mezz' in name:
        if name.strip()=='mezzanine':
            # BRF2's explicit indexed sequence puts M010x spaces between its
            # basement and first floor. No measured height is claimed.
            return 'M','M',-.5
        base_name = re.sub(r'\s*mezzanine\s*','',record['floor_name'],flags=re.I)
        base_id, base_short, base_height = level({**record,'floor_name':base_name}) if base_name else ('L1','1',0.)
        return base_id+'M',base_short+'M',(base_height if base_height is not None else 0.)+.5
    if 'partial' in name:
        base_name = re.sub(r'\s*partial\s*',' ',record['floor_name'],flags=re.I)
        base_id, base_short, base_height = level({**record,'floor_name':base_name})
        return base_id+'P',base_short+'P',(base_height if base_height is not None else 0.)+.5
    ordinals = ['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth',
                'eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth']
    for i, word in enumerate(ordinals, 1):
        if re.search(r'\b'+word+r'\b', name) and 'basement' not in name:
            return f'L{i}', str(i), float(i-1)
    if 'basement' in name or name in ('b','b1','b2'):
        number = re.search(r'(\d+)', name)
        n = int(number[1]) if number else 1
        return ('B' if n == 1 else f'B{n}'), ('B' if n == 1 else f'B{n}'), -float(n)
    if 'lower' in name:
        return 'LL', 'LL', -1.
    if 'roof' in name:
        number = re.search(r'(\d+)',name)
        suffix = number[1] if number else ''
        return 'R'+suffix, 'R'+suffix, 100.+(int(suffix)-1 if suffix else 0)
    if 'ground' in name:
        return 'G', 'G', 0.
    m = re.search(r'(?:floor|level)\s*(\d+)|(\d+)(?:st|nd|rd|th)?\s*(?:floor|level)', name)
    if m:
        n = int(m[1] or m[2])
        return f'L{n}', str(n), float(n-1)
    return 'F'+record['floor_record_id'], record['floor_name'], None


def mapping_keys(layout):
    placed = {r['scheduleKey']: (f, r) for f in layout.get('floors', []) for r in f['rooms'] if r['scheduleKey']}
    by_id = {r['id']: (f, r) for f in layout.get('floors', []) for r in f['rooms']}
    placed.update({a['scheduleKey']: by_id[a['room']] for a in layout.get('scheduleAliases', [])})
    unplaced = {r['scheduleKey']: (f, r) for f in layout.get('floors', []) for r in f.get('unplaced', []) if r['scheduleKey']}
    unmapped = {r['scheduleKey']: r for r in layout.get('knownUnmapped', [])}
    return placed, unplaced, unmapped


def source_floor_key(floor):
    fid = floor['id'].upper()
    if re.fullmatch(r'(L\d+|B\d*|LL|R|M|G)', fid):
        return fid
    match = re.search(r'L(\d+)$', fid)
    return 'L'+match[1] if match else fid


def similarity(old_floor, new_floor):
    """Fit old fallback rooms only using >=3 unique, noncollinear room labels."""
    old = defaultdict(list)
    new = defaultdict(list)
    for room in old_floor['rooms']:
        old[room['label']].append(room)
    for room in new_floor['rooms']:
        new[room['label']].append(room)
    keys = sorted(k for k in old.keys() & new.keys() if len(old[k]) == len(new[k]) == 1)
    if len(keys) < 3:
        return None
    a = np.asarray([centroid(old[k][0]['footprint']) for k in keys])
    b = np.asarray([centroid(new[k][0]['footprint']) for k in keys])
    ac, bc = a-a.mean(axis=0), b-b.mean(axis=0)
    if np.linalg.matrix_rank(ac) < 2:
        return None
    u, s, vt = np.linalg.svd(ac.T@bc)
    matrix = (u@vt).T * (s.sum()/np.sum(ac*ac))
    shift = b.mean(axis=0) - a.mean(axis=0)@matrix.T
    residuals = np.linalg.norm(a@matrix.T+shift-b, axis=1)
    span = max(np.linalg.norm(np.ptp(b, axis=0)), 1e-6)
    if max(residuals)/span > .045 or np.mean(residuals)/span > .02:
        return None
    return matrix, shift, {'labels':keys, 'maxResidualFraction':float(max(residuals)/span),
                           'meanResidualFraction':float(np.mean(residuals)/span)}


def room_type(label, name, scheduled):
    if scheduled:
        return 'classroom'
    if re.match(r'^\((TW|TM|TG|TU)\)', label):
        return 'restroom'
    if label.startswith('('):
        return 'service'
    if 'classroom' in (name or '').lower():
        return 'classroom'
    if 'office' in (name or '').lower():
        return 'office'
    return 'unknown'


def build(entry, records, source_root, previous, overrides=()):
    code = entry['code']
    audit = {'building':code, 'name':entry['name'], 'floors':[], 'limitations':list(entry.get('limitations', []))}
    selected = []
    source_buildings = entry['sourceBuildings']
    by_building = {b['id']:b for b in source_buildings}
    for record in records:
        if record.get('kind') != 'floor' or record['building_record_id'] not in by_building:
            continue
        source_building = by_building[record['building_record_id']]
        floor_ids = source_building.get('includeFloorRecordIds')
        space_ids = source_building.get('includeSpaceRecordIds')
        if floor_ids and record['floor_record_id'] not in floor_ids:
            continue
        fid, short, height = level(record)
        if record.get('status') != 'exported' or not record.get('svg_path'):
            audit['floors'].append({'sourceFloorRecordId':record['floor_record_id'], 'name':record['floor_name'],
                                    'status':'missing-source', 'reason':record.get('detail',record['status'])})
            continue
        path = source_root/record['svg_path']
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != record['sha256']:
            raise ValueError(f'{code} source hash changed: {path}')
        parsed = parse_svg(path, expected_floor_record_id=record['floor_record_id'], label_detail=record.get('label_detail'))
        if space_ids:
            parsed['spaces'] = [s for s in parsed['spaces'] if s['record_id'] in space_ids]
            parsed['outline'] = [p for s in parsed['spaces'] for p in s['polygons']]
        if not parsed['outline'] or height is None:
            audit['floors'].append({'sourceFloorRecordId':record['floor_record_id'], 'name':record['floor_name'],
                                   'status':'unresolved-geometry' if height is not None else 'unresolved-level', 'warnings':parsed.get('warnings',[])})
            continue
        selected.append({'record':record, 'parsed':parsed, 'id':fid, 'short':short, 'height':height,
                         'space_ids':space_ids})
    if not selected:
        return None, {**audit, 'status':'preserved', 'reason':'No usable sourced floor outlines.'}
    # Prefer first floor, then most spaces; no independent centering of levels.
    selected.sort(key=lambda f:(f['id'] != 'L1', -len(f['parsed']['spaces'])))
    # Prior layouts provide a shared relative frame only when independent room
    # labels, withheld anchors and room areas corroborate a similarity fit.
    # Unlike per-floor bbox fits this can establish a real CAD unit conversion.
    registered = []
    if previous:
        for floor in selected:
            fit = registration_to_baseline(floor['parsed'], previous, floor['id'])
            if fit:
                floor['baseline_fit'] = fit
        for building_id in by_building:
            candidates = [f for f in selected if f['record']['building_record_id']==building_id and f.get('baseline_fit')]
            if not candidates:
                continue
            floor = max(candidates,key=lambda f:f['baseline_fit']['evidence']['inlierCount'])
            fit = floor['baseline_fit']
            floor['matrix'],floor['shift'] = np.asarray(fit['matrix']),np.asarray(fit['shift'])
            floor['registration'] = {'method':'shared-reviewed-baseline-room-anchors',**fit['evidence']}
            registered.append(floor)
    baseline_frame = bool(registered)
    if not registered:
        base = selected[0]
        base['matrix'], base['shift'] = np.eye(2), np.zeros(2)
        base['registration'] = {'method':'reference-floor', 'referenceFloorRecordId':base['record']['floor_record_id']}
        registered = [base]
    pending = [f for f in selected if not any(f is r for r in registered)]
    while pending:
        progress = False
        for floor in pending[:]:
            fits = []
            for reference in registered:
                if reference['record']['building_record_id']!=floor['record']['building_record_id']:
                    continue
                reviewed = next((x for x in overrides if x['buildingRecordId']==floor['record']['building_record_id']
                                 and x['floorRecordId']==floor['record']['floor_record_id']
                                 and x['referenceFloorRecordId']==reference['record']['floor_record_id']),None)
                if reviewed:
                    if (reviewed['svgSha256']!=floor['record']['sha256'] or
                        reviewed['referenceSvgSha256']!=reference['record']['sha256']):
                        raise ValueError('Reviewed registration source hashes changed; re-review the landmarks.')
                    fit={'matrix':np.asarray(reviewed['matrix'],dtype=float),
                         'shift':np.asarray(reviewed['translation'],dtype=float),
                         'evidence':{'method':'reviewed-source-specific-landmarks','boundaryAgreement':0.,
                                     'anchors':[],**reviewed['evidence']}}
                    fits.append((3.,reference,fit))
                    continue
                factors = [1.]
                if floor.get('baseline_fit'):
                    ratio = float(np.sqrt(abs(np.linalg.det(floor['baseline_fit']['matrix'])/np.linalg.det(reference['matrix']))))
                    nearest = min((1/12, .25, .5, 2.,4.,12.),key=lambda n:abs(n-ratio))
                    if abs(ratio/nearest-1)<.02:
                        factors.append(nearest)
                for factor in factors:
                    parsed = floor['parsed']
                    if factor!=1:
                        parsed = copy.deepcopy(parsed)
                        parsed['outline']=transform_polygons(parsed['outline'],np.eye(2)*factor,np.zeros(2))
                        for space in parsed['spaces']:
                            space['polygons']=transform_polygons(space['polygons'],np.eye(2)*factor,np.zeros(2))
                    fit = register(parsed, reference['parsed'])
                    if fit:
                        fit['matrix'] *= factor
                        if factor!=1:
                            fit['evidence']['sourceUnitCorrection']={'factor':factor,'basis':'Independent room-label/area baseline fit and rigid common-core/wall registration both corroborate the discrete CAD unit conversion.',
                                                                   'baselineFit':floor['baseline_fit']['evidence']}
                        fits.append((fit['evidence']['boundaryAgreement'] + .1*len(fit['evidence']['anchors']), reference, fit))
            if not fits:
                continue
            _, reference, fit = max(fits, key=lambda x:x[0])
            floor['matrix'] = reference['matrix'] @ fit['matrix']
            floor['shift'] = fit['shift'] @ reference['matrix'].T + reference['shift']
            floor['registration'] = {'method':'rigid-common-boundaries-and-service-cores',
                 'referenceFloorRecordId':reference['record']['floor_record_id'], **fit['evidence']}
            registered.append(floor)
            pending.remove(floor)
            progress = True
        if not progress:
            break
    for floor in pending:
        audit['floors'].append({'sourceFloorRecordId':floor['record']['floor_record_id'], 'name':floor['record']['floor_name'],
                               'status':'unresolved-alignment', 'reason':'No unique rigid fit supported by repeated boundaries or separated service cores; not stacked speculatively.'})
    all_polys = [p for f in registered for p in transform_polygons(f['parsed']['outline'], f['matrix'], f['shift'])]
    if baseline_frame:
        all_polys += [p for f in previous['floors'] for p in f['outline']]
    box = bounds(all_polys)
    origin = (box[:2]+box[2:])/2
    scale = 100/max(box[2:]-box[:2])
    old_placed, old_unplaced, old_unmapped = mapping_keys(previous or {})
    keys = set(entry.get('activeScheduleKeys', [])) | old_placed.keys() | old_unplaced.keys() | old_unmapped.keys()
    sources, floors = [], []
    max_level = max(f['height'] for f in selected if f['height'] < 100) if any(f['height']<100 for f in selected) else 0
    floor_ids_seen = set()
    for f in sorted(registered, key=lambda f:f['height']):
        record, parsed = f['record'], f['parsed']
        fid = f['id']
        if fid in floor_ids_seen:
            fid += '-'+record['floor_record_id']
        floor_ids_seen.add(fid)
        source_id = 'TRIRIGA-'+record['floor_record_id']
        matrix, shift = f['matrix']*scale, (f['shift']-origin)*scale
        refs = [{'source':source_id}]
        sources.append({'id':source_id, 'title':f"UCSD TRIRIGA Work Location — {record['building_name']}, {record['floor_name']}",
            'url':record['source_url'], 'localFile':str((source_root/record['svg_path']).resolve()), 'publisher':'UC San Diego Facilities / TRIRIGA',
            'building':code, 'floors':[fid], 'accessed':record.get('normalized_at','2026-11-09')[:10], 'access':'authenticated',
            'tririga':{'buildingRecordId':record['building_record_id'],'floorRecordId':record['floor_record_id'],
                       'drawingId':record['drawing_id'], 'svgSha256':record['sha256']},
            'scale':'CAD source units are registered into one common building frame; no measured physical scale is asserted.',
            'orientation':'Unknown north. Rigid relative floor alignment only.',
            'notes':['Authenticated export: local preview only; publication rights have not been reviewed.',
                     'The normalized SVG preserves CAD geometry and nested transforms. Space labels are joined by record ID.',
                     'Source floor_level is an ordering field; the displayed storey is derived from floor_name.']})
        floor = {'id':fid, 'label':record['floor_name'], 'shortLabel':f['short'],
            'vertical':{'baseElevation':(max_level+1+f['height']-100 if f['height']>=100 else f['height'])*4, 'height':4, 'estimated':True,
                        'note':'Illustrative relative spacing, not measured elevations or storey heights.'},
            'outline':transform_polygons(parsed['outline'], matrix, shift), 'outlineConfidence':'direct',
            'rooms':[], 'areas':[], 'features':[], 'unplaced':[], 'sources':refs,
            'notes':['Direct floor gross-area boundary; may include covered/exterior areas rather than the architectural outer wall.',
                     'Cross-floor rigid alignment evidence is recorded in the local conversion report.'],
            'transforms':[{'source':source_id, 'originPx':(-np.linalg.inv(matrix)@shift).tolist(),
                           'rotationDeg':math.degrees(math.atan2(matrix[1,0],matrix[0,0])),
                           'scale':float(np.sqrt(abs(np.linalg.det(matrix)))),
                           'note':'Input is SVG user coordinates after all nested SVG transforms. This transform includes source registration and the shared final display normalization.'}]}
        if np.linalg.det(matrix)<0:
            floor.pop('transforms')
            floor['notes'].append('Source registration includes a coordinate reflection; exact affine matrix is in the conversion report.')
        if f['space_ids']:
            floor['notes'] = ['Only the explicitly identified auditorium space is imported; outline is its room extent, not the whole floor.']
        for space in parsed['spaces']:
            polys = transform_polygons(space['polygons'], matrix, shift)
            label = space.get('label') or ''
            if not label or label.startswith(('(CU)','(R)')):
                for i, polygon in enumerate(polys):
                    floor['areas'].append({'id':f"T-{record['floor_record_id']}-{space['record_id']}-{i}",
                          'kind':'unknown' if label else 'unlabeled-room', 'label':label or 'Unlabeled source space',
                          'footprint':polygon,'confidence':'direct','sources':[{'source':source_id,'region':'Space record '+space['record_id']}],
                          'notes':['Source non-room area annotation is retained without assigning a classroom or an enclosed room volume.']})
                continue
            for i, polygon in enumerate(polys):
                room = {'id':f"T-{record['floor_record_id']}-{space['record_id']}-{i}", 'label':label,
                     'scheduleKey':None, 'type':room_type(label,space.get('name'),False), 'floor':fid, 'footprint':polygon,
                     'confidence':{'location':'direct','shape':'direct','label':'direct'},
                     'sources':[{'source':source_id,'region':'Space record '+space['record_id']}],
                     'notes':['Space boundary extracted by record ID; no inferred rectangular room envelope.']}
                if space.get('name'):
                    room['name'] = space['name']
                floor['rooms'].append(room)
        audit['floors'].append({'id':fid, 'sourceFloorRecordId':record['floor_record_id'], 'drawingId':record['drawing_id'],
             'name':record['floor_name'], 'status':'imported','spaces':len(parsed['spaces']), 'roomPolygons':len(floor['rooms']),
             'registration':f['registration'], 'matrix':matrix.tolist(), 'translation':shift.tolist(),
             'warnings':parsed.get('warnings',[]), 'parserEvidence':parsed.get('evidence',{})})
        floors.append(floor)
    layout = {'schemaVersion':1,'building':code,'name':entry['name'],'geometryStatus':'facilities-plan',
          'provenance':'Local preview from authenticated UCSD TRIRIGA floor plans. Room boundaries and numbers follow the source; relative floor alignment and heights have documented limits. Publication review pending.',
          'coordinateSystem':{'units':'relative','description':'Source CAD frames are registered with recorded rigid or independently corroborated similarity transforms, then the combined building is normalized once to 100 units. Shared final scale: '+str(scale)+'.',
                              'northDeg':None,'northNote':'No surveyed north or campus registration asserted.'},
          'sources':sources,'floors':floors,'scheduleAliases':[],'knownUnmapped':[],
          'notes':['Local authenticated-source derivative; excluded from public builds.',
                   'Roof, basement and mezzanine labels retain source semantics; vertical spacing is illustrative.',
                   'Exact room-key matches and established prior aliases are preserved. Unresolved rooms receive no invented positions.']}
    # Same-storey records from independent wings share one display level. Their
    # source references and individual transformations remain separately audited.
    merged = {}
    for floor in floors:
        height = floor['vertical']['baseElevation']
        if height not in merged:
            merged[height] = floor
            continue
        target = merged[height]
        for room in floor['rooms']:
            room['floor'] = target['id']
        for field in ('outline','rooms','areas','features','unplaced','sources','transforms'):
            target.setdefault(field,[]).extend(floor.get(field,[]))
        for source in sources:
            source['floors'] = list(dict.fromkeys(target['id'] if fid==floor['id'] else fid for fid in source['floors']))
        target['notes'].append('Multiple source records are registered parts of this display level; see individual source IDs.')
    floors[:] = list(merged.values())
    if baseline_frame:
        # Retain levels not covered by the current authenticated export. Their
        # original geometry is in the established baseline frame, so this does
        # not guess a location or re-center an unregistered source drawing.
        for old_floor in previous['floors']:
            if any(f['id']==source_floor_key(old_floor) for f in floors):
                continue
            retained = copy.deepcopy(old_floor)
            retained['id'] = source_floor_key(old_floor)
            old_record = {'floor_name':old_floor['label'],'floor_record_id':'legacy'}
            _,_,old_height = level(old_record)
            if old_height is None:
                old_height = old_floor['vertical']['baseElevation']/max(old_floor['vertical']['height'],1e-6)
            retained['vertical'] = {'baseElevation':old_height*4,'height':4,'estimated':True,'note':'Retained reviewed prior level; illustrative relative spacing.'}
            if any(abs(f['vertical']['baseElevation']-retained['vertical']['baseElevation'])<1e-8 for f in floors):
                continue
            retained['outline'] = transform_polygons(retained['outline'],np.eye(2)*scale,-origin*scale)
            retained.pop('planDrawing',None)
            retained.pop('transforms',None)
            for field in ('rooms','areas','details'):
                for obj in retained.get(field,[]):
                    obj['footprint']=transform_polygons([obj['footprint']],np.eye(2)*scale,-origin*scale)[0]
                    obj.pop('labelAt',None)
            for feature in retained.get('features',[]):
                feature['at']=(np.asarray(feature['at'])*scale-origin*scale).tolist()
            for room in retained['rooms']:
                room['floor']=retained['id']
                room['scheduleKey']=None
            retained.setdefault('notes',[]).append('Retained public baseline level; no unregistered TRIRIGA floor is substituted.')
            floors.append(retained)
            audit.setdefault('retainedPriorFloors',[]).append(retained['id'])
        sources.extend(copy.deepcopy(s) for s in previous['sources'] if s['id'] not in {x['id'] for x in sources})
        floors.sort(key=lambda f:f['vertical']['baseElevation'])
    by_label = defaultdict(list)
    for floor in floors:
        for room in floor['rooms']:
            by_label[room['label']].append((floor,room))
    assigned, lost = set(), []
    crosswalks = {x['scheduleKey']:x for x in entry.get('scheduleLabelCrosswalks',[])}
    for key in sorted(keys):
        candidates = by_label[key]
        if key in crosswalks:
            crosswalk = crosswalks[key]
            candidates = [(f,r) for f,r in by_label[crosswalk['sourceLabel']]
                          if any(s.get('region')=='Space record '+crosswalk['roomRecordId'] for s in r['sources'])]
        if not candidates and key in old_placed:
            candidates = by_label[old_placed[key][1]['label']]
        if len(candidates) > 1 and key in old_placed:
            expected = source_floor_key(old_placed[key][0])
            narrowed = [(f,r) for f,r in candidates if f['id'] == expected]
            if len(narrowed) == 1:
                candidates = narrowed
        if len(candidates) == 1:
            _, room = candidates[0]
            if room['scheduleKey'] is None:
                room['scheduleKey'] = key
                room['type'] = 'classroom'
                if key in crosswalks:
                    room['notes'].append('Reviewed schedule-label crosswalk: '+crosswalks[key]['basis'])
            else:
                layout['scheduleAliases'].append({'scheduleKey':key,'room':room['id'],
                     'note':'Preserved explicit prior schedule alias to the same sourced room label.'})
            assigned.add(key)
            continue
        if key in old_placed:
            old_floor, old_room = old_placed[key]
            new_floor = next((f for f in floors if f['id'] == source_floor_key(old_floor)),None)
            fit = ((np.eye(2)*scale,-origin*scale,{'method':'established-common-baseline-frame'}) if new_floor and baseline_frame
                   else similarity(old_floor, new_floor) if new_floor else None)
            if fit:
                matrix, shift, evidence = fit
                room = copy.deepcopy(old_room)
                room['id'] = 'RETAINED-'+room['id']
                room['floor'] = new_floor['id']
                room['scheduleKey'] = key
                room['footprint'] = transform_polygons([room['footprint']],matrix,shift)[0]
                room.pop('labelAt',None)
                room['confidence']['location'] = 'approximate'
                room.setdefault('notes',[]).append('Retained reviewed prior room, aligned using shared room labels; absent from this TRIRIGA export.')
                # Reused aliases must target one geometry object, not clone IDs.
                existing = next((r for f in floors for r in f['rooms'] if r['id']==room['id']),None)
                if existing:
                    layout['scheduleAliases'].append({'scheduleKey':key,'room':existing['id'],'note':'Retained prior explicit schedule alias.'})
                else:
                    new_floor['rooms'].append(room)
                    if not any(point_in_ring(p,outline['outer']) for p in room['footprint']['outer'] for outline in new_floor['outline']):
                        new_floor['outline'].append(copy.deepcopy(room['footprint']))
                        new_floor['outlineConfidence']='approximate'
                        new_floor['notes'].append('Additional disconnected outline is the retained classroom extent only; its complete wing boundary is not asserted.')
                for source in previous['sources']:
                    if source['id'] not in {s['id'] for s in sources}:
                        sources.append(copy.deepcopy(source))
                audit.setdefault('retainedPriorRooms',[]).append({'key':key,'floor':new_floor['id'],'registration':evidence})
                assigned.add(key)
                continue
            lost.append(key)
        if key in old_unplaced:
            old_floor, old_room = old_unplaced[key]
            new_floor = next((f for f in floors if f['id']==source_floor_key(old_floor)),None)
            if new_floor is None and old_room['basis']=='floor-listing':
                old_id=source_floor_key(old_floor)
                _,_,height=level({'floor_name':old_floor['label'],'floor_record_id':'legacy'})
                if height is not None and not any(abs(f['vertical']['baseElevation']-height*4)<1e-8 for f in floors):
                    new_floor={'id':old_id,'label':old_floor['label'],'shortLabel':old_floor['shortLabel'],
                        'vertical':{'baseElevation':height*4,'height':4,'estimated':True,'note':'Illustrative ordering of a retained source floor listing.'},
                        'outline':[],'outlineConfidence':'unknown','rooms':[],'unplaced':[],
                        'sources':copy.deepcopy(old_floor['sources']),
                        'notes':['Retained verified floor listing. No unregistered geometry is drawn for this level.']}
                    floors.append(new_floor)
                    sources.extend(copy.deepcopy(s) for s in previous['sources'] if s['id'] not in {x['id'] for x in sources})
            if new_floor:
                new_floor['unplaced'].append(copy.deepcopy(old_room))
                continue
        layout['knownUnmapped'].append({'scheduleKey':key,'reason':'No unique verified space label/geometry match in the exported floors; previous source remains available in the public baseline.'})
    if lost:
        return None, {**audit,'status':'preserved','reason':'Local replacement would lose existing positioned schedule keys; keep the reviewed baseline until registration can preserve them.','lostPositionedKeys':lost}
    floors.sort(key=lambda f:f['vertical']['baseElevation'])
    for lower,upper in zip(floors,floors[1:]):
        distance=upper['vertical']['baseElevation']-lower['vertical']['baseElevation']
        if distance>0:
            lower['vertical']['height']=min(lower['vertical']['height'],distance)
    before = len(old_placed)
    after = len(mapping_keys(layout)[0])
    audit.update({'status':'generated','previousFloors':len((previous or {}).get('floors',[])), 'newFloors':len(floors),
             'previousRoomPolygons':sum(len(f['rooms']) for f in (previous or {}).get('floors',[])),
             'roomPolygons':sum(len(f['rooms']) for f in floors),'placedBefore':before,'placedAfter':after,
             'newlyPositionedKeys':sorted(assigned-old_placed.keys()),'activeKeys':entry.get('activeScheduleKeys',[]),
             'activePositionedKeys':sorted(assigned & set(entry.get('activeScheduleKeys',[]))),
             'remainingKeys':sorted(keys-assigned)})
    return layout, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',default='../artifacts/tririga-floorplans')
    parser.add_argument('--building',action='append',help='Limit to codes for debugging; never use this for a full coverage report.')
    args = parser.parse_args()
    source_root = Path(args.source_root).resolve()
    index = read(source_root/'index.json')
    mapping = read(REPORT/'building-mapping.json')
    override_path=REPORT/'registration-overrides.json'
    overrides=read(override_path)['entries'] if override_path.exists() else []
    public = public_layouts()
    report = {'schemaVersion':1,'scope':'subset debug build' if args.building else 'all reviewed catalog mappings',
              'sourceIndex':str(source_root/'index.json'),
              'sourceIndexSha256':hashlib.sha256((source_root/'index.json').read_bytes()).hexdigest(),
              'toolVersions':{'python':sys.version.split()[0],'numpy':np.__version__,'scipy':scipy.__version__},
              'inputSha256':{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in [REPORT/'building-mapping.json',*(ROOT/'scripts'/name for name in
                    ['build-tririga-indoor.py','tririga_svg.py','tririga_registration.py','tririga_baseline_registration.py'])]},
              'publication':'local-only; authenticated sources; excluded from production builds', 'buildings':[]}
    if override_path.exists():
        report['inputSha256'][str(override_path.relative_to(ROOT))]=hashlib.sha256(override_path.read_bytes()).hexdigest()
    codes = []
    for entry in mapping['entries']:
        if args.building and entry['code'] not in args.building:
            continue
        if entry['status'] != 'mapped' or entry['code']=='GEISEL':
            report['buildings'].append({'building':entry['code'],'status':entry['status'],'limitations':entry.get('limitations',[])})
            continue
        try:
            layout, audit = build(entry,index['records'],source_root,public.get(entry['code']),overrides)
        except Exception as error:
            audit = {'building':entry['code'],'status':'conversion-error','reason':str(error)}
            layout = None
        if layout:
            write(OUTPUT/(entry['code']+'.json'),layout)
            codes.append(entry['code'])
        report['buildings'].append(audit)
        print(f"{entry['code']}: {audit['status']} {audit.get('newFloors','')} floors {audit.get('roomPolygons','')} rooms {audit.get('reason','')}",flush=True)
    report['summary'] = dict(Counter(b['status'] for b in report['buildings']))
    report['summary'].update({'localBuildingCodes':len(codes), 'floors':sum(b.get('newFloors',0) for b in report['buildings']),
           'roomPolygons':sum(b.get('roomPolygons',0) for b in report['buildings']),
           'newlyPositionedKeys':sum(len(b.get('newlyPositionedKeys',[])) for b in report['buildings']),
           'newBuildingCodes':[b['building'] for b in report['buildings'] if b['status']=='generated' and b.get('previousFloors')==0]})
    # Remove only stale generated code files, within this explicit private dir.
    # Debug subsets retain unrelated files and merge their existing index.
    if args.building:
        prior_codes = read(OUTPUT/'index.json')['buildings'] if (OUTPUT/'index.json').exists() else []
        codes += [code for code in prior_codes if code not in args.building]
    for path in OUTPUT.glob('*.json'):
        if path.name!='index.json' and path.stem not in codes:
            path.unlink()
    report['outputSha256'] = {code:hashlib.sha256((OUTPUT/(code+'.json')).read_bytes()).hexdigest() for code in sorted(codes)}
    write(REPORT/('conversion-report-subset.json' if args.building else 'conversion-report.json'),report)
    write(OUTPUT/'index.json',{'schemaVersion':1,'buildings':sorted(codes)})
    print(json.dumps(report['summary'],indent=2))
    if any(b['status']=='conversion-error' for b in report['buildings']):
        raise SystemExit(1)


if __name__=='__main__':
    main()

#!/usr/bin/env python3
"""Recover 14 COA classroom footprints from retained public FIS raster plans.

No downloads. Requires Pillow only for auditable source overlays. The original
ten floor levels and approximate campus slabs are preserved, not scaled to
conceal discrepancies with the newly traced rooms.
"""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACE = 'data/indoor/COA/trace.json'
OUTPUT = 'static/indoor/COA-combined.json'


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    for source in trace['sources'].values():
        assert hashlib.sha256((ROOT / source['localPath']).read_bytes()).hexdigest() == source['sha256'], 'Source raster changed'
    spec = importlib.util.spec_from_file_location('registration_math', ROOT / 'scripts/supplement-ebu2-584.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = json.loads((ROOT / trace['registration']['targetLayout']).read_text())
    layout = copy.deepcopy(base)
    reference = next(f for f in base['floors'] if f['id'] == 'L1')['outline']

    def target(p):
        return reference[p['targetPart']]['outer'][p['targetVertex']]

    controls = trace['registration']['controlPoints']
    a, b, _, _ = module.fit_similarity([p['sourcePoint'] for p in controls], [target(p) for p in controls])
    # The roof outline gives orientation/position, while the printed C130 area
    # gives scale. A free roof fit would inflate the known C130 area by ~6%.
    anchor = trace['registration']['scaleAnchor']
    anchor_room = next(r for r in trace['floors'][anchor['floor']]['rooms'] if r['scheduleKey'] == anchor['scheduleKey'])
    scale = math.sqrt(anchor['printedAreaSqft'] * 0.09290304 / module.area(anchor_room['outer']))
    free_scale = math.hypot(a, b)
    a, b = a / free_scale * scale, b / free_scale * scale
    tx = sum(target(p)[0] - a*p['sourcePoint'][0] + b*p['sourcePoint'][1] for p in controls) / len(controls)
    tz = sum(target(p)[1] - b*p['sourcePoint'][0] - a*p['sourcePoint'][1] for p in controls) / len(controls)

    def transform(p):
        return [a*p[0] - b*p[1] + tx, b*p[0] + a*p[1] + tz]

    def rounded(p):
        return [round(v, 6) for v in transform(p)]

    checks = {kind: [{**p, 'targetPoint': target(p), 'transformedPoint': transform(p['sourcePoint']), 'residualMeters': math.dist(transform(p['sourcePoint']), target(p))} for p in trace['registration'][kind]] for kind in ['controlPoints', 'holdoutPoints']}
    assert max(p['residualMeters'] for p in checks['controlPoints']) < 1.3
    assert max(p['residualMeters'] for p in checks['holdoutPoints']) < 1.6
    area_checks = []
    recovered = []
    from PIL import Image, ImageDraw
    review_dir = ROOT / 'local/indoor-sources/COA-review'
    review_dir.mkdir(parents=True, exist_ok=True)
    for fid, floor_trace in trace['floors'].items():
        floor = next(f for f in layout['floors'] if f['id'] == fid)
        assert not floor['rooms'], 'Review new existing geometry before supplementing'
        source = trace['sources'][fid]
        image = Image.open(ROOT / source['localPath']).convert('RGBA')
        assert list(image.size) == trace['render']['size']
        overlay = Image.new('RGBA', image.size)
        draw = ImageDraw.Draw(overlay)
        for item in floor_trace['rooms']:
            key = item['scheduleKey']
            listed = next(r for r in floor['unplaced'] if r['scheduleKey'] == key)
            assert listed['areaSqft'] == item['listedAreaSqft']
            sqft = module.area(item['outer']) * scale * scale / 0.09290304
            source_area = sum(item['sourceAreasSqft'])
            difference = sqft / source_area - 1
            assert abs(difference) < 0.1, 'Area discrepancy requires renewed visual review'
            area_checks.append({'floor': fid, 'scheduleKey': key, 'tracedSqft': sqft, 'printedSqft': source_area, 'printedComponentAreasSqft': item['sourceAreasSqft'], 'listedPrimaryRoomSqft': listed['areaSqft'], 'relativeDifference': difference, 'isCalibrationAnchor': fid == anchor['floor'] and key == anchor['scheduleKey']})
            refs = [{'source': source['id'], 'region': ', '.join(item['sourceLabels'])}, {'source': 'UCSD-FIS', 'note': 'Same-floor current room listing uses schedule numbers without the source C building prefix.'}, {'source': 'CAMPUS-MAP', 'note': 'Approximate orientation and campus placement only; held-out discrepancy reaches 1.51 m.'}]
            notes = [trace['limitations'][0], f'Traced area {sqft:.0f} ft² versus printed {source_area} ft² ({difference*100:+.1f}%); area calibration and manual trace are approximate.']
            if len(item['sourceLabels']) > 1:
                refs += [{'source': evidence['id']} for evidence in trace['combinationEvidence']]
                notes.append(trace['limitations'][1])
            floor['rooms'].append({'id': fid+'-FIS-'+key, 'label': ' / '.join(item['sourceLabels']), 'scheduleKey': key, 'type': 'lecture-hall' if key == '130' else 'classroom', 'floor': fid, 'footprint': {'outer': [rounded(p) for p in item['outer']]}, 'labelAt': rounded(item['labelAt']), 'confidence': {'location': 'approximate', 'shape': 'approximate', 'label': 'direct'}, 'sources': refs, 'notes': notes})
            recovered.append(key)
            points = [tuple(p) for p in item['outer']]
            draw.polygon(points, fill=(0, 90, 255, 35))
            draw.line(points + [points[0]], fill=(0, 80, 240, 255), width=3)
        keys = {r['scheduleKey'] for r in floor_trace['rooms']}
        floor['unplaced'] = [r for r in floor['unplaced'] if r['scheduleKey'] not in keys]
        floor['sources'].append({'source': source['id']})
        floor.setdefault('notes', []).extend(trace['limitations'])
        floor['transforms'] = [{'source': source['id'], 'imageSizePx': trace['render']['size'], 'originPx': [-(a*tx+b*tz)/(scale*scale), (b*tx-a*tz)/(scale*scale)], 'rotationDeg': math.degrees(math.atan2(b, a)), 'scale': scale, 'note': 'Printed C130 area fixes approximate metric scale; rigid fit to four campus exterior corners, three independent facade holdouts. B and L1 repeat the same source grid/stair and wing corners.'}]
        Image.alpha_composite(image, overlay).convert('RGB').save(review_dir / (fid+'-review.png'))
        layout['sources'].append({'id': source['id'], 'title': 'Coalition '+('basement' if fid == 'B' else 'first floor')+' Facilities master plan', 'url': source['url'], 'localFile': source['localPath'], 'publisher': 'UC San Diego Facilities Information System', 'building': 'COA', 'floors': [fid], 'accessed': source['accessed'], 'revision': source['printedDate'], 'orientation': 'Source north arrow points up.', 'scale': 'Printed 1/16 inch = 1 foot; native raster metric calibration uses the printed C130 area, not display DPI.', 'notes': ['SHA-256: '+source['sha256'], 'Native public BASE + A-AREA-CAFM tiles, 4609×3457 pixels. Manual room boundary trace; whole-floor slab is not traced.', trace['limitations'][4]]})
    for evidence in trace['combinationEvidence']:
        layout['sources'].append({'id': evidence['id'], 'title': 'Coalition combined and split classroom references', 'url': evidence['url'], 'publisher': evidence['publisher'], 'building': 'COA', 'floors': ['B', 'L1'], 'accessed': evidence['accessed'], 'notes': [evidence['evidence']]})
    layout['geometryStatus'] = 'source-traced'
    layout['provenance'] = 'Fourteen scheduled classroom footprints on B and L1 are manually traced from the public March 2025 FIS master-plan rasters. C125/C126, C127/C128 and CB27/CB28 are combined, partitionable rooms under keys 125, 127 and B27. All ten original floor levels and approximate campus-footprint slabs are retained. Six L2 classrooms remain floor-listed without geometry. Metric scale, campus registration and heights are approximate; this is partial interior geometry, not a complete as-built model.'
    layout['coordinateSystem']['description'] = 'Meters in the existing campus-footprint frame. Traced B/L1 pixels are scaled using printed C130 area and rigidly aligned to exterior corners; held-out campus discrepancy reaches 1.51 m.'
    layout['geo']['note'] = 'Inherited campus origin; traced room position is approximate (up to 1.51 m facade holdout discrepancy).'
    assert len(layout['floors']) == len(base['floors']) == 10
    # Preserve all higher-floor context exactly, including L2's unplaced rooms.
    assert layout['floors'][2:] == base['floors'][2:]
    assert len(recovered) == len(set(recovered)) == 14
    # Keep the campus fit separately reviewable: orange is the inherited roof
    # footprint, blue the trace, purple controls and green held-out corners.
    registration_image = Image.open(review_dir / 'L1-review.png').convert('RGB')
    draw = ImageDraw.Draw(registration_image)

    def inverse(p):
        x, z = p[0] - tx, p[1] - tz
        return ((a*x+b*z)/(scale*scale), (-b*x+a*z)/(scale*scale))

    for polygon in reference:
        points = [inverse(p) for p in polygon['outer']]
        draw.line(points + [points[0]], fill=(220, 90, 0), width=5)
    for kind, color in [('controlPoints', (200, 0, 200)), ('holdoutPoints', (0, 130, 0))]:
        for point in checks[kind]:
            u, v = point['sourcePoint']
            draw.ellipse((u-11, v-11, u+11, v+11), outline=color, width=4)
            draw.line([(u, v), inverse(point['targetPoint'])], fill=color, width=6)
    registration_image.save(review_dir / 'campus-registration.png')
    (ROOT / OUTPUT).write_text(json.dumps(layout, separators=(',', ':'))+'\n')
    report = {'schemaVersion': 1, 'building': 'COA', 'output': OUTPUT, 'trace': TRACE, 'sources': trace['sources'], 'transform': {'formula': 'x=a*u-b*v+tx; z=b*u+a*v+tz', 'a': a, 'b': b, 'tx': tx, 'tz': tz, 'unitsPerPixel': scale, 'freeRoofFitUnitsPerPixelNotUsed': free_scale, 'scaleAnchor': anchor}, 'registrationChecks': checks, 'areaChecks': area_checks, 'recoveredScheduleKeys': recovered, 'remainingUnplacedKeys': [r['scheduleKey'] for f in layout['floors'] for r in f.get('unplaced', [])], 'retainedFloorCount': len(layout['floors']), 'slabTreatment': 'All existing approximate campus roof footprint slabs are retained unchanged; no fabricated whole-floor outline or open lobby geometry.', 'reviewOverlays': ['local/indoor-sources/COA-review/B-review.png', 'local/indoor-sources/COA-review/L1-review.png'], 'limitations': trace['limitations']}
    report['reviewOverlays'].append('local/indoor-sources/COA-review/campus-registration.png')
    (ROOT / 'data/indoor/COA/review.json').write_text(json.dumps(report, indent=2)+'\n')
    print('Recovered COA:', ', '.join(recovered), '; remaining:', ', '.join(report['remainingUnplacedKeys']))


if __name__ == '__main__':
    main()

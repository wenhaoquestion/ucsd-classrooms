#!/usr/bin/env python3
"""Trace six Solis classrooms from the hash-pinned public 2024 FIS raster."""
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACE = 'data/indoor/SOLIS/public-fis-trace.json'


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1]
                   for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def inside(point, ring):
    x, y = point
    hit = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y):
            if x < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]):
                hit = not hit
    return hit


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    source = trace['source']
    raster = ROOT / source['localPath']
    assert hashlib.sha256(raster.read_bytes()).hexdigest() == source['sha256'], 'Source raster changed'
    base = json.loads((ROOT / trace['baseLayout']).read_text())
    layout = copy.deepcopy(base)
    floor = next(f for f in layout['floors'] if f['id'] == 'L1')
    assert not floor['rooms'], 'Review existing room geometry before supplementing'
    by_key = {r['scheduleKey']: r for r in floor['unplaced']}
    rooms = {r['label']: r for r in trace['rooms']}
    reg = trace['registration']
    control = rooms[reg['scaleControlRoom']]
    scale = math.sqrt(control['listedAreaSqft'] * 0.09290304 / area(control['outer']))
    offset = [sum(p['target'][k] - scale * p['source'][k] for p in reg['controls']) / len(reg['controls'])
              for k in range(2)]

    def transform(p):
        return [round(scale * p[k] + offset[k], 6) for k in range(2)]

    checks = {}
    for kind, limit in [('controls', 'maxControlResidualMeters'), ('holdouts', 'maxHoldoutResidualMeters')]:
        checks[kind] = [{**p, 'residualMeters': math.dist(transform(p['source']), p['target'])} for p in reg[kind]]
        assert max(p['residualMeters'] for p in checks[kind]) <= reg[limit], 'Exterior registration changed'
    area_checks = []
    for room in trace['rooms']:
        key = room['scheduleKey']
        assert by_key[key]['areaSqft'] == room['listedAreaSqft'], 'Listed area changed'
        assert inside(room['labelPoint'], room['outer']), 'Printed label is outside trace'
        sqft = area(room['outer']) * scale * scale / 0.09290304
        difference = abs(sqft / room['listedAreaSqft'] - 1)
        assert difference < 0.035, f'{key} room area does not agree'
        area_checks.append({'room': key, 'tracedAreaSqft': sqft, 'listedAreaSqft': room['listedAreaSqft'],
                            'relativeDifference': difference, 'usedToSetScale': key == reg['scaleControlRoom']})
        floor['rooms'].append({'id': 'L1-FIS-2024-' + key, 'label': key, 'scheduleKey': key,
            'floor': 'L1', 'type': 'lecture-hall' if key in ('104', '107') else 'classroom',
            'footprint': {'outer': [transform(p) for p in room['outer']]},
            'labelAt': transform(room['labelPoint']),
            'confidence': {'location': 'approximate', 'shape': 'traced', 'label': 'direct'},
            'sources': [{'source': source['id'], 'imageRef': source['sheet'], 'region': 'Room ' + key}],
            'notes': ['Traced from the public FIS first-floor plan dated 2024-09-17; door openings are closed.',
                      f'Traced area {sqft:.1f} ft² versus listed {room["listedAreaSqft"]} ft²; one common scale is used for all rooms.',
                      source['warning']]})
    independent = trace['independentAreaCheck']
    independent_sqft = area(independent['outer']) * scale * scale / 0.09290304
    assert abs(independent_sqft / independent['printedAreaSqft'] - 1) < 0.04
    recovered = set(rooms)
    floor['unplaced'] = [r for r in floor['unplaced'] if r['scheduleKey'] not in recovered]
    floor.setdefault('sources', []).append({'source': source['id']})
    layout['geometryStatus'] = 'source-traced'
    layout['provenance'] += ' Six classrooms are traced from the public 2024 FIS raster with one area-calibrated scale and explicit approximate exterior registration.'
    layout['sources'].append({'id': source['id'], 'title': source['title'], 'url': source['url'],
        'publisher': 'UC San Diego Facilities', 'building': 'SOLIS', 'floors': ['L1'],
        'accessed': source['accessed'], 'revision': source['printedDate'], 'imageRef': source['sheet'],
        'notes': ['Source PNG SHA-256: ' + source['sha256'], source['warning'],
                  'Pixel traces and exterior controls: ' + TRACE]})
    assert layout['geo'] == base['geo'] and floor['outline'] == base['floors'][0]['outline']
    (ROOT / trace['outputLayout']).write_text(json.dumps(layout, separators=(',', ':')) + '\n')
    report = {'schemaVersion': 1, 'building': 'SOLIS', 'output': trace['outputLayout'],
        'inputHashes': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
                        for p in (TRACE, trace['baseLayout'], source['localPath'])},
        'addedScheduleKeys': sorted(recovered), 'metersPerReferencePixel': scale,
        'transform': {'formula': 'x = s*u + tx; z = s*v + tz', 's': scale, 'tx': offset[0], 'tz': offset[1]},
        'registrationChecks': checks, 'areaChecks': area_checks,
        'independentAreaCheck': {'label': independent['label'], 'tracedAreaSqft': independent_sqft,
                                  'printedAreaSqft': independent['printedAreaSqft']},
        'campusGeometryRetained': True, 'campusRegistrationConfidence': 'approximate',
        'limitations': trace['limitations']}
    (ROOT / 'data/indoor/SOLIS/public-fis-review.json').write_text(json.dumps(report, indent=2) + '\n')
    from PIL import Image, ImageDraw
    image = Image.open(raster).convert('RGBA').resize(tuple(source['referenceSize']))
    overlay = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(overlay)
    for room in trace['rooms']:
        points = [tuple(p) for p in room['outer']]
        draw.polygon(points, fill=(0, 140, 255, 30))
        draw.line(points + points[:1], fill=(0, 80, 220, 255), width=2)
    out = ROOT / 'local/indoor-sources/SOLIS-FIS-trace-review.png'
    Image.alpha_composite(image, overlay).convert('RGB').save(out)
    print('SOLIS:', ', '.join(sorted(recovered)), 'added; maximum area error',
          f'{max(r["relativeDifference"] for r in area_checks):.2%}')


if __name__ == '__main__':
    main()

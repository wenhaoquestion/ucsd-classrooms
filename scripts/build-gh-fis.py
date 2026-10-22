#!/usr/bin/env python3
"""Add GH 320/321 from the public 2021 FIS raster, preserving full GH242."""
import copy
import hashlib
import json
import math
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
TRACE = 'data/indoor/GH/public-fis-trace.json'


def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1]))) / 2


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    source = trace['source']
    assert hashlib.sha256((ROOT / source['localPath']).read_bytes()).hexdigest() == source['sha256']
    # Regenerate the same prior source-backed auditorium first, making this
    # final builder independent of the current combined file's generated state.
    runpy.run_path(str(ROOT / trace['baseBuilder']), run_name='__main__')
    base = json.loads((ROOT / trace['baseLayout']).read_text())
    layout = copy.deepcopy(base)
    floor = next(f for f in layout['floors'] if f['id'] == 'L3')
    auditorium = copy.deepcopy(floor['rooms'][0])
    assert auditorium['scheduleKey'] == '242' and len(floor['rooms']) == 1
    rooms = {r['label']: r for r in trace['rooms']}
    reg = trace['registration']
    scale_room = rooms[reg['scaleControlRoom']]
    scale = math.sqrt(scale_room['listedAreaSqft'] * .09290304 / area(scale_room['outer']))
    offset = [sum(p['target'][k] - scale*p['source'][k] for p in reg['controls']) / len(reg['controls']) for k in range(2)]

    def transform(p):
        return [round(scale*p[k] + offset[k], 6) for k in range(2)]

    residuals = {}
    for kind, limit in [('controls', 'maxControlResidualMeters'), ('holdouts', 'maxHoldoutResidualMeters')]:
        residuals[kind] = []
        for p in reg[kind]:
            assert p['target'] == auditorium['footprint']['outer'][p['existing242Vertex']]
            residuals[kind].append({**p, 'residualMeters': math.dist(transform(p['source']), p['target'])})
        assert max(p['residualMeters'] for p in residuals[kind]) < reg[limit]
    listed = {r['scheduleKey']: r for r in floor['unplaced']}
    area_checks = []
    for r in trace['rooms']:
        key = r['scheduleKey']
        assert listed[key]['areaSqft'] == r['listedAreaSqft']
        sqft = area(r['outer']) * scale**2 / .09290304
        difference = abs(sqft / r['listedAreaSqft'] - 1)
        assert difference < .03
        area_checks.append({'room': key, 'tracedAreaSqft': sqft, 'listedAreaSqft': r['listedAreaSqft'],
                            'relativeDifference': difference, 'usedToSetScale': key == reg['scaleControlRoom']})
        floor['rooms'].append({'id': 'L3-FIS-2021-' + key, 'label': key, 'scheduleKey': key,
            'floor': 'L3', 'type': 'classroom', 'footprint': {'outer': [transform(p) for p in r['outer']]},
            'labelAt': transform(r['labelPoint']), 'confidence': {'location': 'approximate', 'shape': 'traced', 'label': 'direct'},
            'sources': [{'source': source['id'], 'imageRef': source['sheet'], 'region': 'Room ' + key}],
            'notes': ['Traced from the public FIS third-floor plan dated 2021-11-09; door openings are closed.',
                      'Approximate local registration uses the unchanged complete room 242; no campus registration is supplied.',
                      source['warning']]})
    floor['unplaced'] = [r for r in floor['unplaced'] if r['scheduleKey'] not in rooms]
    floor['sources'].append({'source': source['id']})
    layout['sources'].append({'id': source['id'], 'title': source['title'], 'url': source['url'],
        'publisher': 'UC San Diego Facilities', 'building': 'GH', 'floors': ['L3'], 'accessed': source['accessed'][:10],
        'revision': source['printedDate'], 'imageRef': source['sheet'],
        'notes': ['Source PNG SHA-256: ' + source['sha256'], source['warning'], 'Pixel traces and controls: ' + TRACE]})
    layout['provenance'] += ' Rooms 320 and 321 are traced from the public 2021 FIS raster, using one scale and approximate registration to the retained auditorium.'
    assert floor['rooms'][0] == auditorium and 'geo' not in layout
    assert all(a['outline'] == b['outline'] for a, b in zip(layout['floors'], base['floors']))
    for a, b in zip(layout['floors'], base['floors']):
        if a['id'] != 'L3':
            assert a == b
    (ROOT / trace['outputLayout']).write_text(json.dumps(layout, separators=(',', ':')) + '\n')
    report = {'schemaVersion': 1, 'building': 'GH', 'output': trace['outputLayout'], 'addedScheduleKeys': sorted(rooms),
        'preservedScheduleKeys': ['242'], 'campusRegistration': False,
        'transform': {'formula': 'x=s*u+tx; z=s*v+tz', 's': scale, 'tx': offset[0], 'tz': offset[1]},
        'registrationChecks': residuals, 'areaChecks': area_checks, 'limitations': trace['limitations'],
        'inputHashes': {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in (TRACE, trace['baseBuilder'], source['localPath'])},
        'remainingUnplaced': [r['scheduleKey'] for f in layout['floors'] for r in f['unplaced']]}
    (ROOT / 'data/indoor/GH/public-fis-review.json').write_text(json.dumps(report, indent=2) + '\n')
    from PIL import Image, ImageDraw
    image = Image.open(ROOT / source['localPath']).convert('RGBA').resize(tuple(source['referenceSize']))
    overlay = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(overlay)
    for r in trace['rooms']:
        points = [tuple(p) for p in r['outer']]
        draw.polygon(points, fill=(0,140,255,35)); draw.line(points+points[:1], fill=(0,80,220,255), width=2)
    Image.alpha_composite(image, overlay).convert('RGB').save(ROOT/'local/indoor-sources/GH-FIS-trace-review.png')
    print('GH: 320, 321 added; complete room 242 unchanged; maximum area error', f'{max(r["relativeDifference"] for r in area_checks):.2%}')


def rebuild():
    # The first-stage builder writes the same layout. Restore the last complete
    # result if a later registration/source/overlay check fails.
    trace = json.loads((ROOT / TRACE).read_text())
    targets = {ROOT / trace['baseLayout'], ROOT / trace['outputLayout'],
               ROOT / 'data/indoor/GH/242-review.json',
               ROOT / 'data/indoor/GH/public-fis-review.json'}
    previous = {p: p.read_bytes() if p.exists() else None for p in targets}
    try:
        main()
    except BaseException:
        for path, body in previous.items():
            if body is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(body)
        raise


if __name__ == '__main__':
    rebuild()

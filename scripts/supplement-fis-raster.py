#!/usr/bin/env python3
"""Reproduce reviewed FIS raster supplements; never download or infer rooms.

Usage: python3 scripts/supplement-fis-raster.py CENTR
Trace files specify every source, control, room boundary, and limitation.
"""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def polygon_union(first, second):
    """Exact edge-split union for two intersecting simple rings without holes.

    This preserves the existing slab and adds only a source-traced footprint;
    it does not infer an exterior facade from a roof or stretch any old ring.
    """
    def signed(r):
        return sum(p[0]*q[1]-q[0]*p[1] for p, q in zip(r, r[1:]+r[:1]))

    def inside(p, r):
        hit = False
        for u, v in zip(r, r[1:]+r[:1]):
            if (u[1] > p[1]) != (v[1] > p[1]) and p[0] < (v[0]-u[0])*(p[1]-u[1])/(v[1]-u[1])+u[0]:
                hit = not hit
        return hit

    rings = [r if signed(r) > 0 else list(reversed(r)) for r in [first, second]]
    segments = []
    for index, ring in enumerate(rings):
        other = rings[1-index]
        for p, q in zip(ring, ring[1:]+ring[:1]):
            dx, dy = q[0]-p[0], q[1]-p[1]
            cuts = [0., 1.]
            for u, v in zip(other, other[1:]+other[:1]):
                ex, ey = v[0]-u[0], v[1]-u[1]
                denominator = dx*ey-dy*ex
                if abs(denominator) < 1e-10:
                    continue
                t = ((u[0]-p[0])*ey-(u[1]-p[1])*ex)/denominator
                s = ((u[0]-p[0])*dy-(u[1]-p[1])*dx)/denominator
                if 0 < t < 1 and 0 <= s <= 1:
                    cuts.append(t)
            cuts.sort()
            for t, s in zip(cuts, cuts[1:]):
                if s-t < 1e-10 or inside([p[0]+dx*(t+s)/2, p[1]+dy*(t+s)/2], other):
                    continue
                segments.append((tuple(round(p[i]+[dx,dy][i]*t, 7) for i in range(2)), tuple(round(p[i]+[dx,dy][i]*s, 7) for i in range(2))))
    links = dict(segments)
    assert len(links) == len(segments), 'Ambiguous union junction; inspect rather than approximate'
    result, holes = [], []
    while links:
        start = next(iter(links))
        ring, current = [], start
        while True:
            ring.append(list(current))
            current = links.pop(current)
            if current == start:
                break
        if signed(ring) > 0:
            result.append({'outer': ring})
        else:
            holes.append(ring)
    for hole in holes:
        owner = next(part for part in result if inside(hole[0], part['outer']))
        owner.setdefault('holes', []).append(hole)
    return result


def build(code, variant=''):
    trace_path = f'data/indoor/{code}/fis-trace{variant}.json'
    trace = json.loads((ROOT / trace_path).read_text())
    source = trace['source']
    assert hashlib.sha256((ROOT / source['localPath']).read_bytes()).hexdigest() == source['sha256']
    spec = importlib.util.spec_from_file_location('registration_math', ROOT / 'scripts/supplement-ebu2-584.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = json.loads((ROOT / trace['input']).read_text())
    layout = copy.deepcopy(base)
    assert layout['building'] == code
    registration = trace['registration']
    sign = -1 if registration.get('mirrorSourceY') else 1

    def source_point(p):
        return [p[0], sign*p[1]]

    def target(p):
        floor = next(f for f in base['floors'] if f['id'] == p['targetFloor'])
        if 'targetRoom' in p:
            room = next(r for r in floor['rooms'] if r['label'] == p['targetRoom'])
            return room['footprint']['outer'][p['targetVertex']]
        return floor['outline'][p.get('targetPart', 0)]['outer'][p['targetVertex']]

    controls = registration['controls']
    a, b, tx, tz = module.fit_similarity([source_point(p['sourcePoint']) for p in controls], [target(p) for p in controls])
    scale = math.hypot(a, b)

    def transform(p):
        u, v = source_point(p)
        return [a*u-b*v+tx, b*u+a*v+tz]

    def rounded(p):
        return [round(v, 6) for v in transform(p)]

    def inverse(p):
        x, z = p[0]-tx, p[1]-tz
        return [(a*x+b*z)/(scale*scale), sign*(-b*x+a*z)/(scale*scale)]

    checks = {kind: [{**p, 'targetPoint': target(p), 'transformedPoint': transform(p['sourcePoint']), 'residualMeters': math.dist(transform(p['sourcePoint']), target(p))} for p in registration[kind]] for kind in ['controls', 'holdouts']}
    assert max(p['residualMeters'] for p in checks['controls']) < registration['maxControlResidualMeters']
    assert max(p['residualMeters'] for p in checks['holdouts']) < registration['maxHoldoutResidualMeters']
    floor = next(f for f in layout['floors'] if f['id'] == trace['floor'])
    from PIL import Image, ImageDraw
    image = Image.open(ROOT / source['localPath']).convert('RGBA')
    assert list(image.size) == source['size']
    overlay = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(overlay)
    areas = []
    recovered = []
    for room in trace['rooms']:
        key = room['scheduleKey']
        assert not any(r['scheduleKey'] == key for f in base['floors'] for r in f['rooms'])
        listed = next(r for r in floor.get('unplaced', []) if r['scheduleKey'] == key)
        if 'listedAreaSqft' in room:
            assert listed.get('areaSqft') == room['listedAreaSqft']
        sqft = module.area(room['outer']) * scale * scale / 0.09290304
        difference = sqft / room['printedAreaSqft'] - 1
        assert abs(difference) < trace.get('maxAreaRelativeDifference', .1)
        areas.append({'scheduleKey': key, 'tracedSqft': sqft, 'printedSqft': room['printedAreaSqft'], 'relativeDifference': difference, 'referenceAreaBasis': room.get('areaBasis', 'Printed source label')})
        floor['rooms'].append({'id': trace['floor']+'-FIS-'+key, 'label': room['sourceLabel'], 'scheduleKey': key, 'type': 'classroom', 'floor': trace['floor'], 'footprint': {'outer': [rounded(p) for p in room['outer']]}, 'labelAt': rounded(room['labelAt']), 'confidence': {'location': 'approximate', 'shape': 'approximate', 'label': 'direct'}, 'sources': [{'source': source['id'], 'region': 'Room '+room['sourceLabel']}, {'source': 'UCSD-FIS', 'note': 'Approximate registration to retained floor geometry; see the reproducible control and holdout report.'}], 'notes': trace['limitations'] + [f'Traced area {sqft:.0f} ft² versus documented {room["printedAreaSqft"]} ft² ({difference*100:+.1f}%).']})
        recovered.append(key)
        points = [tuple(p) for p in room['outer']]
        draw.polygon(points, fill=(0, 90, 255, 40))
        draw.line(points+[points[0]], fill=(0, 70, 255, 255), width=3)
    floor['unplaced'] = [r for r in floor.get('unplaced', []) if r['scheduleKey'] not in recovered]
    if trace.get('slabUnionRoomKeys'):
        assert len(floor['outline']) == 1 and not floor['outline'][0].get('holes')
        for key in trace['slabUnionRoomKeys']:
            room = next(r for r in floor['rooms'] if r['scheduleKey'] == key)
            floor['outline'] = polygon_union(floor['outline'][0]['outer'], room['footprint']['outer'])
            assert len(floor['outline']) == 1
    floor['sources'].append({'source': source['id']})
    floor.setdefault('notes', []).extend(trace['limitations'])
    # The schema's simple SourceTransform cannot represent reflection. The
    # exact signed affine mapping remains in the trace report in that case.
    if sign == 1:
        floor.setdefault('transforms', []).append({'source': source['id'], 'imageSizePx': source['size'], 'originPx': [-(a*tx+b*tz)/(scale*scale), (b*tx-a*tz)/(scale*scale)], 'rotationDeg': math.degrees(math.atan2(b, a)), 'scale': scale, 'note': 'Approximate similarity registration; data/indoor/'+code+'/fis-review'+variant+'.json records controls and independent holdouts.'})
    layout['sources'].append({'id': source['id'], 'title': source['title'], 'url': source['url'], 'localFile': source['localPath'], 'publisher': 'UC San Diego Facilities Information System', 'building': code, 'floors': [trace['floor']], 'accessed': source['accessed'], 'revision': source['printedDate'], 'notes': ['SHA-256: '+source['sha256'], 'Native stitched raster; manually reviewed room labels and boundaries.', *trace['limitations']]})
    layout['geometryStatus'] = 'source-traced'
    layout['provenance'] += ' Added '+', '.join(recovered)+' from the retained public FIS raster. New geometry is manually traced and approximately registered; existing rooms and levels are retained.'
    if trace.get('removeGeo'):
        layout.pop('geo', None)
        layout['coordinateSystem']['northDeg'] = None
        layout['coordinateSystem']['northNote'] = trace['removeGeoReason']
        layout['provenance'] += ' '+trace['removeGeoReason']
    for old, new in zip(base['floors'], layout['floors']):
        if not (old['id'] == trace['floor'] and trace.get('slabUnionRoomKeys')):
            assert old['outline'] == new['outline']
        assert old['rooms'] == new['rooms'][:len(old['rooms'])]
        if old['id'] != trace['floor']:
            assert old == new
    out = ROOT / f'local/indoor-sources/{code}-review'
    out.mkdir(exist_ok=True)
    reviewed = Image.alpha_composite(image, overlay).convert('RGB')
    reviewed.save(out / (trace['floor']+'-FIS-review.png'))
    draw = ImageDraw.Draw(reviewed)
    reference = next(f for f in base['floors'] if f['id'] == trace['floor'])
    for polygon in [r['footprint'] for r in reference['rooms']] + reference['outline']:
        points = [tuple(inverse(p)) for p in polygon['outer']]
        draw.line(points+[points[0]], fill=(0, 135, 0), width=3)
    for kind, color in [('controls', (200, 0, 200)), ('holdouts', (240, 100, 0))]:
        for p in checks[kind]:
            u, v = p['sourcePoint']
            draw.ellipse((u-9, v-9, u+9, v+9), outline=color, width=4)
            draw.line([(u, v), tuple(inverse(p['targetPoint']))], fill=color, width=5)
    reviewed.save(out / (trace['floor']+'-FIS-registration.png'))
    report = {'schemaVersion': 1, 'building': code, 'trace': trace_path, 'output': trace['output'], 'source': source, 'transform': {'formula': 'x=a*u-b*sign*v+tx; z=b*u+a*sign*v+tz', 'a': a, 'b': b, 'sign': sign, 'tx': tx, 'tz': tz, 'metersPerPixel': scale}, 'registrationChecks': checks, 'registrationReferenceRaster': registration.get('referenceRaster', source['id']), 'areaChecks': areas, 'recoveredScheduleKeys': recovered, 'remainingUnplacedKeys': [r['scheduleKey'] for f in layout['floors'] for r in f.get('unplaced', [])], 'retainedFloorCount': len(layout['floors']), 'reviewOverlays': [str((out / (trace['floor']+suffix)).relative_to(ROOT)) for suffix in ['-FIS-review.png', '-FIS-registration.png']], 'limitations': trace['limitations']}
    (ROOT / trace['output']).write_text(json.dumps(layout, separators=(',', ':'))+'\n')
    (ROOT / f'data/indoor/{code}/fis-review{variant}.json').write_text(json.dumps(report, indent=2)+'\n')
    print(code, 'recovered:', ', '.join(recovered), '; remaining:', ', '.join(report['remainingUnplacedKeys']))


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '')

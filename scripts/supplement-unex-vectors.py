#!/usr/bin/env python3
"""Convert the official public UNEXG/UNEXN room vectors, without raster tiles."""
import copy
import hashlib
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[1]


def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1]))) / 2


def build(code):
    trace = json.loads((ROOT / f'data/indoor/{code}/public-vector-source.json').read_text())
    source = trace['source']
    html = ROOT / source['htmlFile']
    if html.exists():
        assert hashlib.sha256(html.read_bytes()).hexdigest() == source['htmlSha256']
    width, height = source['nativeImageSize']
    rings = [[(p[0]*width, p[1]*height) for p in r['sourcePolygon']['coordinates'][0][:-1]] for r in trace['rooms']]
    for item in trace['rooms']:
        coordinates = item['sourcePolygon']['coordinates']
        assert item['sourcePolygon']['type'] == 'Polygon' and len(coordinates) == 1
        assert coordinates[0][0] == coordinates[0][-1]
    scales = [math.sqrt(room['listedAreaSqft'] * 0.09290304 / area(ring)) for room, ring in zip(trace['rooms'], rings)]
    scale = statistics.median(scales)
    points = [p for ring in rings for p in ring]
    origin = [(min(p[i] for p in points) + max(p[i] for p in points)) / 2 for i in [0, 1]]

    def transform(p):
        return [round((p[i]-origin[i])*scale, 6) for i in [0, 1]]

    layout = copy.deepcopy(json.loads((ROOT / f'static/indoor/facilities/{code}.json').read_text()))
    assert len(layout['floors']) == 1 and not layout['floors'][0]['rooms']
    floor = layout['floors'][0]
    old = {r['scheduleKey']: r for r in floor['unplaced']}
    checks = []
    floor['outline'] = []
    for item, ring in zip(trace['rooms'], rings):
        key = item['scheduleKey']
        assert old[key]['areaSqft'] == item['listedAreaSqft']
        polygon = {'outer': [transform(p) for p in ring]}
        sqft = area(polygon['outer']) / 0.09290304
        difference = abs(sqft / item['listedAreaSqft'] - 1)
        assert difference < 0.01
        checks.append({'room': key, 'listedSqft': item['listedAreaSqft'], 'convertedSqft': sqft, 'relativeDifference': difference})
        floor['rooms'].append({'id': f'L1-FIS-VECTOR-{item["facilityRoomId"]}', 'label': item['label'], 'scheduleKey': key,
                              'type': 'classroom', 'floor': 'L1', 'footprint': polygon,
                              'labelAt': transform([sum(p[i] for p in ring)/len(ring) for i in [0, 1]]),
                              'confidence': {'location': 'direct', 'shape': 'approximate', 'label': 'direct'},
                              'sources': [{'source': source['id'], 'note': 'Facilities room ID '+item['facilityRoomId']}],
                              'notes': trace['limitations']})
        floor['outline'].append(copy.deepcopy(polygon))
    floor['unplaced'] = []
    floor['sources'] = [{'source': source['id']}]
    floor['notes'] = trace['limitations']
    floor['sourceTransform'] = {'source': source['id'], 'imageSizePx': [width, height], 'originPx': origin,
                               'rotationDeg': 0, 'scale': scale, 'note': 'Vector coordinates converted to native pixels; shared scale estimated from listed areas.'}
    layout.pop('geo', None)
    layout['coordinateSystem'] = {'units': 'meters', 'northDeg': None,
                                  'description': 'Local source-plan frame; approximate shared metric scale from listed room areas.',
                                  'northNote': 'The raster and its north arrow were unavailable. No campus registration is asserted.'}
    layout['provenance'] = 'Official UCSD Facilities room vectors and matching room inventory from the public classroom floor-plan embed. Local coordinates only; approximate metric scale. Full exterior walls are unavailable.'
    layout['sources'].append({'id': source['id'], 'title': 'Official public floor-plan vectors and room inventory',
                              'url': source['url'], 'publisher': 'UC San Diego Facilities', 'building': code, 'floors': ['L1'],
                              'accessed': source['accessed'], 'revision': source['revision'],
                              'imageRef': 'HTML SHA-256: '+source['htmlSha256'], 'scale': 'Median of independent per-room area scales; same scale applied to every polygon.',
                              'notes': trace['limitations']})
    output = f'static/indoor/{code}-combined.json'
    (ROOT / output).write_text(json.dumps(layout, separators=(',', ':'))+'\n')
    review = {'schemaVersion': 1, 'building': code, 'source': source, 'output': output, 'recoveredKeys': sorted(old),
              'sharedMetersPerPixel': scale, 'perRoomMetersPerPixel': scales, 'originPx': origin,
              'areaConsistencyChecks': checks, 'campusRegistration': False, 'limitations': trace['limitations']}
    (ROOT / f'data/indoor/{code}/public-vector-review.json').write_text(json.dumps(review, indent=2)+'\n')
    from PIL import Image, ImageDraw
    image = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(image)
    draw.text((40, 40), code+' — official vector geometry; raster background unavailable', fill='black', font_size=42)
    for item, ring in zip(trace['rooms'], rings):
        draw.polygon(ring, fill=(218, 236, 255), outline=(0, 70, 150), width=5)
        center = tuple(sum(p[i] for p in ring)/len(ring) for i in [0, 1])
        draw.text(center, item['label']+' / '+str(item['listedAreaSqft'])+' sqft', anchor='mm', fill='black', font_size=42)
    image.thumbnail((1600, 1200))
    image.save(ROOT / f'local/indoor-sources/{code}-vector-review.png')
    print(code, 'recovered', ', '.join(sorted(old)), '; no raster or campus orientation claimed')


if __name__ == '__main__':
    for building in ['UNEXG', 'UNEXN']:
        build(building)

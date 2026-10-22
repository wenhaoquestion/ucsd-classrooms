#!/usr/bin/env python3
"""Add three numbered SSB rooms from the public first-floor FIS raster."""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    trace = json.loads((ROOT / 'data/indoor/SSB/public-fis-trace.json').read_text())
    source = trace['source']
    assert hashlib.sha256((ROOT / source['localPath']).read_bytes()).hexdigest() == source['sha256']
    spec = importlib.util.spec_from_file_location('registration_math', ROOT / 'scripts/supplement-ebu2-584.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    layout = copy.deepcopy(json.loads((ROOT / trace['targetLayout']).read_text()))
    floor = next(f for f in layout['floors'] if f['id'] == trace['floor'])
    rooms = {r['label']: r for r in floor['rooms']}

    def target(p):
        return rooms[p['room']]['footprint']['outer'][p['vertex']]

    controls = trace['controlPoints']
    a, b, tx, tz = module.fit_similarity([p['point'] for p in controls], [target(p) for p in controls])

    def transform(p):
        return [a*p[0] - b*p[1] + tx, b*p[0] + a*p[1] + tz]

    checks = {kind: [{**p, 'targetPoint': target(p), 'residualMeters': math.dist(transform(p['point']), target(p))} for p in trace[kind]] for kind in ['controlPoints', 'holdoutPoints']}
    assert max(p['residualMeters'] for p in checks['controlPoints']) < 0.3
    assert max(p['residualMeters'] for p in checks['holdoutPoints']) < 0.2
    area_checks = []
    for item in trace['rooms']:
        key = item['label']
        listed = next(r for r in floor['unplaced'] if r['scheduleKey'] == key)
        assert listed['areaSqft'] == item['listedAreaSqft']
        polygon = [[round(v, 6) for v in transform(p)] for p in item['outer']]
        sqft = module.area(polygon) / 0.09290304
        difference = abs(sqft / listed['areaSqft'] - 1)
        assert difference < 0.03
        area_checks.append({'room': key, 'tracedSqft': sqft, 'listedSqft': listed['areaSqft'], 'relativeDifference': difference})
        floor['rooms'].append({'id': 'L1-FIS-TRACE-'+key, 'label': key, 'scheduleKey': key, 'type': 'classroom', 'floor': 'L1', 'footprint': {'outer': polygon}, 'labelAt': [round(v, 6) for v in transform(item['labelAt'])], 'confidence': {'location': 'approximate', 'shape': 'approximate', 'label': 'direct'}, 'sources': [{'source': source['id']}], 'notes': trace['limitations'][:3]})
        floor['outline'].append({'outer': copy.deepcopy(polygon)})
    recovered = {r['label'] for r in trace['rooms']}
    floor['unplaced'] = [r for r in floor['unplaced'] if r['scheduleKey'] not in recovered]
    floor['sources'].append({'source': source['id']})
    floor.setdefault('notes', []).extend(trace['limitations'])
    layout['sources'].append({'id': source['id'], 'title': 'SSB first-floor master plan, public classroom viewer', 'url': source['url'], 'publisher': 'UC San Diego Facilities', 'building': 'SSB', 'floors': ['L1'], 'accessed': source['accessed'], 'revision': source['revision'], 'imageRef': 'SHA-256: '+source['sha256'], 'scale': 'Similarity registration to two existing rooms; room areas independently checked.', 'notes': trace['limitations']})
    layout['provenance'] += ' Rooms 103, 106 and 139 are traced from the public first-floor FIS raster dated 2019-04-23; the original rooms and upper floors are preserved.'
    output = 'static/indoor/SSB-combined.json'
    (ROOT / output).write_text(json.dumps(layout, separators=(',', ':'))+'\n')
    report = {'schemaVersion': 1, 'source': source, 'output': output, 'transform': {'a': a, 'b': b, 'tx': tx, 'tz': tz}, 'registrationChecks': checks, 'areaChecks': area_checks, 'recoveredKeys': sorted(recovered), 'limitations': trace['limitations']}
    (ROOT / 'data/indoor/SSB/public-fis-review.json').write_text(json.dumps(report, indent=2)+'\n')
    from PIL import Image, ImageDraw
    image = Image.open(ROOT / source['localPath']).convert('RGBA')
    assert list(image.size) == source['imageSize']
    overlay = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(overlay)
    for room in trace['rooms']:
        points = [tuple(p) for p in room['outer']]
        draw.polygon(points, fill=(0, 120, 255, 45))
        draw.line(points+[points[0]], fill=(0, 90, 240, 255), width=3)
    folder = ROOT / 'local/indoor-sources/SSB-review'
    folder.mkdir(exist_ok=True)
    Image.alpha_composite(image, overlay).convert('RGB').save(folder / 'L1-review.png')
    print('Added SSB 103, 106, 139; preserved all existing rooms and other floors.')


if __name__ == '__main__':
    main()

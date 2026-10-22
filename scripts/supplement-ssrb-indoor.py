#!/usr/bin/env python3
"""Trace three SSRB classrooms from the retained 2018 numbered floor plan."""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TRACE = 'data/indoor/SSRB/trace.json'
OUTPUT = 'static/indoor/SSRB-combined.json'


def main():
    trace = json.loads((ROOT / TRACE).read_text())
    source = trace['source']
    assert hashlib.sha256((ROOT / source['localPath']).read_bytes()).hexdigest() == source['sha256']
    # Shared pure similarity/area math; importing this module does not run its main.
    spec = importlib.util.spec_from_file_location('ebu2_math', ROOT / 'scripts/supplement-ebu2-584.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    base = json.loads((ROOT / trace['registration']['targetLayout']).read_text())
    layout = copy.deepcopy(base)
    floor = next(f for f in layout['floors'] if f['id'] == 'L3')
    assert not floor['rooms'], 'Review new existing room geometry before supplementing'
    outline = floor['outline'][0]['outer']
    controls = trace['registration']['controlPoints']
    a, b, tx, tz = module.fit_similarity([p['sourcePoint'] for p in controls], [outline[p['targetVertex']] for p in controls])

    def transform(p):
        return [a*p[0] - b*p[1] + tx, b*p[0] + a*p[1] + tz]

    checks = {kind: [{**p, 'targetPoint': outline[p['targetVertex']], 'residualMeters': math.dist(transform(p['sourcePoint']), outline[p['targetVertex']])} for p in trace['registration'][kind]] for kind in ['controlPoints', 'holdoutPoints']}
    assert max(p['residualMeters'] for p in checks['controlPoints']) < 0.5
    assert max(p['residualMeters'] for p in checks['holdoutPoints']) < 1.7
    area_checks = []
    for item in trace['rooms']:
        key = item['label']
        listed = next(r for r in floor['unplaced'] if r['scheduleKey'] == key)
        polygon = [transform(p) for p in item['outer']]
        sqft = module.area(polygon) / 0.09290304
        if 'listedAreaSqft' in item:
            assert listed['areaSqft'] == item['listedAreaSqft']
            difference = abs(sqft / item['listedAreaSqft'] - 1)
            assert difference < 0.1, 'Area conflict requires renewed source review'
            area_checks.append({'room': key, 'tracedSqft': sqft, 'listedSqft': item['listedAreaSqft'], 'relativeDifference': difference})
        floor['rooms'].append({'id': 'L3-EHS-'+key, 'label': key, 'scheduleKey': key, 'type': 'classroom', 'floor': 'L3', 'footprint': {'outer': [[round(v, 6) for v in p] for p in polygon]}, 'labelAt': [round(v, 6) for v in transform(item['labelAt'])], 'confidence': {'location': 'approximate', 'shape': 'approximate', 'label': 'direct'}, 'sources': [{'source': source['id'], 'page': 4}, {'source': 'CAMPUS-MAP', 'note': 'Approximate registration to the existing exterior footprint'}], 'notes': trace['limitations'][:3]})
    recovered = {r['label'] for r in trace['rooms']}
    floor['unplaced'] = [r for r in floor['unplaced'] if r['scheduleKey'] not in recovered]
    floor['sources'].append({'source': source['id'], 'page': 4})
    floor.setdefault('notes', []).extend(trace['limitations'])
    layout['sources'].append({'id': source['id'], 'title': 'Social Sciences Research Building emergency floor plans', 'url': source['url'], 'publisher': 'UC San Diego Cognitive Science / EH&S', 'building': 'SSRB', 'floors': ['L3'], 'accessed': source['accessed'], 'revision': source['printedDate'], 'orientation': 'North points up in the source plan.', 'scale': 'Approximate similarity registration to the existing meter frame.', 'notes': ['PDF SHA-256: '+source['sha256'], 'Trace and registration checks: data/indoor/SSRB/trace.json and registration.json']})
    layout['provenance'] += ' Three third-floor rooms are traced from the 2018 emergency plan; campus fit remains approximate and the conflicting 310 identifier stays unplaced.'
    (ROOT / OUTPUT).write_text(json.dumps(layout, separators=(',', ':'))+'\n')
    report = {'schemaVersion': 1, 'building': 'SSRB', 'output': OUTPUT, 'source': source, 'transform': {'formula': 'x=a*u-b*v+tx; z=b*u+a*v+tz', 'a': a, 'b': b, 'tx': tx, 'tz': tz}, 'registrationChecks': checks, 'areaChecks': area_checks, 'recoveredScheduleKeys': sorted(recovered), 'remainingUnplacedKeys': [r['scheduleKey'] for f in layout['floors'] for r in f.get('unplaced', [])], 'limitations': trace['limitations']}
    (ROOT / 'data/indoor/SSRB/registration.json').write_text(json.dumps(report, indent=2)+'\n')
    # Overlay the exact trace on the original source for review.
    from PIL import Image, ImageDraw
    out = ROOT / 'local/indoor-sources/SSRB-review'
    out.mkdir(exist_ok=True)
    subprocess.run(['pdftoppm', '-f', '4', '-l', '4', '-singlefile', '-scale-to', '2400', '-png', str(ROOT/source['localPath']), str(out/'source')], check=True)
    im = Image.open(out/'source.png').convert('RGBA')
    assert list(im.size) == trace['render']['size']
    overlay = Image.new('RGBA', im.size)
    draw = ImageDraw.Draw(overlay)
    for item in trace['rooms']:
        points = [tuple(p) for p in item['outer']]
        draw.polygon(points, fill=(0, 180, 60, 65))
        draw.line(points+[points[0]], fill=(0, 150, 40, 255), width=3)
    Image.alpha_composite(im, overlay).convert('RGB').save(out/'L3-review.png')
    print('Recovered SSRB:', ', '.join(sorted(recovered)), '; 310 remains unplaced')


if __name__ == '__main__':
    main()

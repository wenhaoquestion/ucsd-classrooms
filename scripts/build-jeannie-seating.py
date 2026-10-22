#!/usr/bin/env python3
"""Rebuild the dimensioned Jeannie GA0205 auditorium trace, without campus registration."""
import copy
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TRACE = 'data/indoor/JEANN/seating-trace.json'


def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1])))/2


def main():
    trace = json.loads((ROOT/TRACE).read_text())
    src, inventory = trace['source'], trace['supportingSource']
    for s in [src, inventory]:
        assert hashlib.sha256((ROOT/s['localPath']).read_bytes()).hexdigest() == s['sha256']
    base = json.loads((ROOT/trace['baseLayout']).read_text())
    oldfloor = next(f for f in base['floors'] if f['id'] == 'L2')
    listing = next(r for r in oldfloor['unplaced'] if r['scheduleKey'] == 'AUD')
    assert listing['areaSqft'] == inventory['listedAreaSqft'] == 5878
    text = (ROOT/inventory['localPath']).read_text()
    assert "'Room', '126640:#000000'" in text and 'GA0205' in text and '(5878 sqft)' in text
    ref = trace['scale']
    scale = ref['dimensionInches']*.0254/math.dist(ref['from'],ref['to'])
    dimensions = []
    for d in trace['dimensionChecks']:
        measured = math.dist(d['from'],d['to'])*scale
        expected = d['dimensionInches']*.0254
        error = abs(measured/expected-1)
        assert error < d['maxRelativeDifference'], d['name']
        dimensions.append({**d,'measuredMeters':measured,'expectedMeters':expected,'relativeDifference':error})

    def transform(p):
        return [round((p[k]-trace['referenceOrigin'][k])*scale,6) for k in range(2)]

    r = trace['classroom']
    poly = [transform(p) for p in r['outer']]
    sqft = area(poly)/.09290304
    difference = abs(sqft/r['listedAreaSqft']-1)
    assert difference < .02
    source_ref = {'source':src['id'],'page':1,'region':'Jeannie Auditorium [GA0205]'}
    room = {'id':'L2-GA0205-SEATING-2021','label':'GA0205','scheduleKey':'AUD','name':'The Jeannie Auditorium',
        'floor':'L2','type':'lecture-hall','footprint':{'outer':poly},'labelAt':transform(r['labelPoint']),
        'confidence':{'location':'approximate','shape':'traced','label':'direct'},
        'sources':[source_ref,{'source':inventory['id'],'region':'GA0205 / room ID126640'}],
        'notes':r['boundaryNotes']+[f'Dimension-calibrated footprint {sqft:.1f} ft² versus the independent FIS inventory area 5878 ft² ({difference:.2%} difference).']}
    floor = {'id':'L2','label':'Level 2 · auditorium','shortLabel':'2','vertical':copy.deepcopy(oldfloor['vertical']),
        'outline':[{'outer':poly}],'outlineConfidence':'approximate','rooms':[room],'unplaced':[],'areas':[],
        'sources':[source_ref,{'source':inventory['id']}],
        'notes':['Available auditorium room extent only; this outline is not the complete building exterior.']}
    layout = {'schemaVersion':1,'building':'JEANN','name':'The Jeannie','geometryStatus':'source-traced',
        'provenance':'Main auditorium GA0205 traced from the complete perimeter on the UCSD December 2021 dimensioned seating plan; current Facilities inventory independently confirms room identity, L2 and area.',
        'coordinateSystem':{'units':'meters','northDeg':None,
            'description':'Independent drawing-axis meters centered on the auditorium; not campus registered.',
            'northNote':'No north arrow is available in this source. True north is unknown.'},
        'sources':[],'floors':[floor],'knownUnmapped':[],'notes':trace['limitations']}
    for s in [src,inventory]:
        entry = {'id':s['id'],'title':s['title'],'url':s['url'],'publisher':'UC San Diego','building':'JEANN',
            'floors':['L2'],'accessed':s['accessed'][:10],'notes':['Source SHA-256: '+s['sha256']]}
        if 'page' in s: entry['page'] = s['page']
        if 'printedDate' in s: entry['revision'] = s['printedDate']
        if 'use' in s: entry['notes'].append(s['use'])
        layout['sources'].append(entry)
    (ROOT/trace['outputLayout']).write_text(json.dumps(layout,separators=(',',':'))+'\n')
    report = {'schemaVersion':1,'building':'JEANN','output':trace['outputLayout'],'addedScheduleKeys':['AUD'],
        'printedRoomLabel':'GA0205','displayFloor':'L2','metersPerReferencePixel':scale,'scaleEvidence':ref,
        'dimensionChecks':dimensions,'mainRoomAreaSqft':sqft,'listedAreaSqft':5878,'relativeAreaDifference':difference,
        'campusRegistration':False,'limitations':trace['limitations'],
        'inputHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in [TRACE,trace['baseLayout'],src['localPath'],inventory['localPath']]}}
    (ROOT/'data/indoor/JEANN/seating-review.json').write_text(json.dumps(report,indent=2)+'\n')
    from PIL import Image,ImageDraw
    with tempfile.TemporaryDirectory(prefix='jeannie-trace-') as tmp:
        prefix = str(Path(tmp)/'page')
        subprocess.run(['pdftoppm','-scale-to','2600','-png','-singlefile',str(ROOT/src['localPath']),prefix],check=True,capture_output=True)
        im = Image.open(prefix+'.png').convert('RGBA').resize(tuple(src['referenceSize']))
        layer = Image.new('RGBA',im.size); draw = ImageDraw.Draw(layer)
        ring = [tuple(p) for p in r['outer']]
        draw.polygon(ring,fill=(0,70,220,30));draw.line(ring+ring[:1],fill=(0,70,220,255),width=2)
        Image.alpha_composite(im,layer).convert('RGB').save(ROOT/'local/indoor-sources/JEANN-seating-trace-review.png')
    print(f'JEANN AUD / GA0205: {sqft:.1f} ft², {difference:.2%} area difference; independent dimension errors < {max(d["relativeDifference"] for d in dimensions):.2%}')


if __name__ == '__main__':
    main()

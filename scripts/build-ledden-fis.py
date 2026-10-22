#!/usr/bin/env python3
"""Build the actual Ledden auditorium from numbered FIS and dimensioned sources."""
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACE = 'data/indoor/LEDDN/public-fis-trace.json'


def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1])))/2


def main():
    trace=json.loads((ROOT/TRACE).read_text())
    source=trace['source']
    for s in [source]+trace['supportingSources']:
        assert hashlib.sha256((ROOT/s['localPath']).read_bytes()).hexdigest()==s['sha256']
    base=json.loads((ROOT/trace['baseLayout']).read_text())
    original_floor=next(f for f in base['floors'] if f['id']=='L2')
    listing=next(r for r in original_floor['unplaced'] if r['scheduleKey']=='AUD')
    assert listing['areaSqft']==trace['classroom']['printedAreaSqft']
    ref=trace['scaleReference']
    metric=json.loads((ROOT/ref['file']).read_text())
    scale=next(f for f in metric['floors'] if f['floor']==ref['floor'])[ref['field']]
    dims=[]
    for d in trace['dimensionChecks']:
        meters=d['referencePixels']*scale
        expected=d['dimensionInches']*.0254
        error=abs(meters/expected-1)
        assert error<d['maxRelativeDifference']
        dims.append({**d,'tracedMeters':meters,'dimensionedMeters':expected,'relativeDifference':error})

    def transform(p):
        return [round((p[k]-trace['referenceOrigin'][k])*scale,6) for k in range(2)]

    room=trace['classroom'];poly=[transform(p) for p in room['outer']]
    sqft=area(poly)/.09290304
    assert abs(sqft/room['printedAreaSqft']-1)<.04
    room_source={'source':source['id'],'imageRef':source['sheet'],'region':'2250'}
    mainroom={'id':'L2-FIS-2024-2250','label':'2250','scheduleKey':'AUD','name':'Ledden Auditorium — HSS 2250',
        'floor':'L2','type':'lecture-hall','footprint':{'outer':poly},'labelAt':transform(room['labelPoint']),
        'confidence':{'location':'approximate','shape':'traced','label':'direct'},
        'sources':[room_source,{'source':'UCSD-KNOW-YOUR-CAMPUS','page':15,'note':'Direct historical HSS2250-to-Ledden name crosswalk.'},
                   {'source':'LEDDN-2250-SEATING-2018','page':1,'note':'Direct HSS2250 label, independent dimensions and perimeter checks.'}],
        'notes':['Complete projected main lecture-room footprint; the room spans physical L1/L2 and is displayed once on L2.',
            room['northBoundaryNote'],room['bottomNotchNote'],f'Traced area {sqft:.1f} ft² versus Facilities 1888 ft²; scale is independently verified by printed dimensions.',source['warning']]}
    service=trace['serviceRoom'];lobby=trace['lobby']
    servicepoly=[transform(p) for p in service['outer']]
    lobbypoly=[transform(p) for p in lobby['outer']]
    for part,polygon in [(service,servicepoly),(lobby,lobbypoly)]:
        assert abs(area(polygon)/.09290304/part['printedAreaSqft']-1)<.06
    floor={'id':'L2','label':'Level 2 · auditorium spans Levels 1–2','shortLabel':'2',
        'vertical':copy.deepcopy(original_floor['vertical']),
        'outline':[{'outer':[transform(p) for p in trace['outline']]}],'outlineConfidence':'approximate',
        'rooms':[mainroom,{'id':'L2-FIS-2024-2260','label':'2260','scheduleKey':None,'floor':'L2','type':'service',
            'footprint':{'outer':servicepoly},'labelAt':transform(service['labelPoint']),
            'confidence':{'location':'approximate','shape':'traced','label':'direct'},
            'sources':[{'source':source['id'],'imageRef':source['sheet'],'region':'2260'}]}],
        'unplaced':[],'areas':[{'id':'L2-FIS-2024-2255','kind':'corridor','label':'2255 · entrance lobby',
            'footprint':{'outer':lobbypoly},'confidence':'approximate','sources':[{'source':source['id'],'region':'2255'}]}],
        'sources':[{'source':source['id']},{'source':'LEDDN-2250-SEATING-2018','page':1}],
        'notes':trace['limitations']}
    layout={'schemaVersion':1,'building':'LEDDN','name':'Ledden Auditorium','geometryStatus':'source-traced',
        'provenance':'Directly labeled FIS room2250, dimensioned UCSD HSS2250 seating plan and official Ledden name crosswalk. This is the independent auditorium building; duplicated HSS office floors from the old generated layout are excluded.',
        'coordinateSystem':{'units':'meters','northDeg':0,'description':'Independent local meters centered on the auditorium. Image north is up; no campus registration is supplied.',
            'northNote':'North follows the arrow on the 2024 public FIS floor plan; physical height and stepped seating are not reconstructed.'},
        'sources':[],'floors':[floor],'knownUnmapped':[]}
    for s in [source]+trace['supportingSources']:
        out={'id':s['id'],'title':s['title'],'url':s['url'],'publisher':'UC San Diego','building':'LEDDN',
            'floors':['L2'],'accessed':s['accessed'][:10],'notes':['Source SHA-256: '+s['sha256']]}
        if 'page' in s:out['page']=s['page']
        if 'printedDate' in s:out['revision']=s['printedDate']
        if 'revision' in s:out['revision']=s['revision']
        if 'use' in s:out['notes'].append(s['use'])
        layout['sources'].append(out)
    (ROOT/trace['outputLayout']).write_text(json.dumps(layout,separators=(',',':'))+'\n')
    report={'schemaVersion':1,'building':'LEDDN','output':trace['outputLayout'],'addedScheduleKeys':['AUD'],
        'printedRoomLabel':'2250','nameCrosswalkSource':'UCSD-KNOW-YOUR-CAMPUS, PDF page15',
        'metersPerReferencePixel':scale,'dimensionChecks':dims,'mainRoomAreaSqft':sqft,
        'listedAreaSqft':1888,'relativeAreaDifference':abs(sqft/1888-1),'campusRegistration':False,
        'removedUnrelatedHssRoomCount':sum(len(f['rooms']) for f in base['floors']),
        'displayFloor':'L2','physicalFloorScope':['L1','L2'],'limitations':trace['limitations'],
        'inputHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in [TRACE,trace['baseLayout'],ref['file'],source['localPath']]+[s['localPath'] for s in trace['supportingSources']]}}
    (ROOT/'data/indoor/LEDDN/public-fis-review.json').write_text(json.dumps(report,indent=2)+'\n')
    from PIL import Image,ImageDraw
    im=Image.open(ROOT/source['localPath']).convert('RGBA').resize(tuple(source['referenceSize']))
    overlay=Image.new('RGBA',im.size);draw=ImageDraw.Draw(overlay)
    for part,color in [(room,(0,80,220,255)),(lobby,(0,140,60,255)),(service,(190,100,0,255))]:
        p=[tuple(v) for v in part['outer']];draw.polygon(p,fill=(*color[:3],30));draw.line(p+p[:1],fill=color,width=2)
    out=Image.alpha_composite(im,overlay).convert('RGB').crop((1040,190,1360,610)).resize((960,1260))
    out.save(ROOT/'local/indoor-sources/LEDDN-FIS-trace-review.png')
    print('LEDDN AUD (2250):',f'{sqft:.1f} ft²; area difference {abs(sqft/1888-1):.2%}; independent dimension errors < {max(d["relativeDifference"] for d in dims):.2%}')


if __name__=='__main__':
    main()

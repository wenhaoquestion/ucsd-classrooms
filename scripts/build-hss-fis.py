#!/usr/bin/env python3
"""Repair HSS lower-floor metric frames and trace seven missing classrooms."""
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRACE = 'data/indoor/HSS/public-fis-trace.json'


def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1]))) / 2


def fit(controls):
    ps = [p['source'] for p in controls]
    qs = [p['target'] for p in controls]
    pc = [sum(p[k] for p in ps)/len(ps) for k in range(2)]
    qc = [sum(q[k] for q in qs)/len(qs) for k in range(2)]
    den = sum((p[0]-pc[0])**2+(p[1]-pc[1])**2 for p in ps)
    a = sum((p[0]-pc[0])*(q[0]-qc[0])+(p[1]-pc[1])*(q[1]-qc[1]) for p,q in zip(ps,qs))/den
    b = sum((p[0]-pc[0])*(q[1]-qc[1])-(p[1]-pc[1])*(q[0]-qc[0]) for p,q in zip(ps,qs))/den
    return {'a': a, 'b': b, 'tx': qc[0]-a*pc[0]+b*pc[1], 'tz': qc[1]-b*pc[0]-a*pc[1]}


def transform(p, c):
    return [c['a']*p[0]-c['b']*p[1]+c['tx'], c['b']*p[0]+c['a']*p[1]+c['tz']]


def inverse(p, c):
    x, y = p[0]-c['tx'], p[1]-c['tz']
    den = c['a']**2+c['b']**2
    return [(c['a']*x+c['b']*y)/den, (-c['b']*x+c['a']*y)/den]


def inside(point, ring):
    x, y = point
    hit = False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        if (a[1]>y)!=(b[1]>y) and x<a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]):
            hit = not hit
    return hit


def clip_min_x(ring, minimum):
    result = []
    for a,b in zip(ring[-1:]+ring[:-1],ring):
        ina,inb = a[0]>=minimum,b[0]>=minimum
        if ina!=inb:
            t=(minimum-a[0])/(b[0]-a[0])
            result.append([minimum,a[1]+t*(b[1]-a[1])])
        if inb:
            result.append(b)
    return result


def main():
    trace = json.loads((ROOT/TRACE).read_text())
    assert hashlib.sha256((ROOT/trace['baseLayout']).read_bytes()).hexdigest() == trace['baseSha256']
    base = json.loads((ROOT/trace['baseLayout']).read_text())
    layout = copy.deepcopy(base)
    sources = {s['id']:s for s in trace['sources']}
    floors = {f['id']:f for f in layout['floors']}
    base_floors = {f['id']:f for f in base['floors']}
    for s in sources.values():
        assert hashlib.sha256((ROOT/s['localPath']).read_bytes()).hexdigest() == s['sha256']
        layout['sources'].append({'id':s['id'],'title':s['title'],'url':s['url'],'publisher':'UC San Diego Facilities',
            'building':'HSS','floors':['L1' if 'L1' in s['id'] else 'L2'],'accessed':s['accessed'][:10],
            'revision':s['printedDate'],'imageRef':s['sheet'],
            'notes':['Source PNG SHA-256: '+s['sha256'],s['warning'],'Pixel traces and controls: '+TRACE]})
    reports = []
    added = []
    for tf in trace['floors']:
        floor = floors[tf['id']]
        source = sources[tf['source']]
        core = tf['coreRegistration']
        oldreg = tf['oldFrameRegistration']
        cnew, cold = fit(core['controls']), fit(oldreg['controls'])
        newscale, oldscale = math.hypot(cnew['a'],cnew['b']), math.hypot(cold['a'],cold['b'])
        by_label = {r['label']:r for r in base_floors[tf['id']]['rooms']}
        core_rooms = {r['label']:r for r in base_floors[core['targetFloor']]['rooms']}
        for p in oldreg['controls']:
            assert p['target']==by_label[p['room']]['footprint']['outer'][p['vertex']]
        for p in core['controls']+core['holdouts']:
            assert p['target']==core_rooms[p['room']]['footprint']['outer'][p['vertex']]
        checks = {}
        for name, points, coeff, limit in [('coreControls',core['controls'],cnew,core['maxControlResidualMeters']),
                ('southStairHoldouts',core['holdouts'],cnew,core['maxHoldoutResidualMeters']),
                ('oldRoomControls',oldreg['controls'],cold,oldreg['maxOldFrameResidualMeters'])]:
            checks[name] = [{**p,'residualMeters':math.dist(transform(p['source'],coeff),p['target'])} for p in points]
            assert max(p['residualMeters'] for p in checks[name]) < limit, name

        def from_source(p):
            return [round(x,6) for x in transform(p,cnew)]

        def repair_frame(p):
            return from_source(inverse(p,cold))

        def polygon(poly):
            return {k:[[repair_frame(p) for p in ring] for ring in value] if k=='holes' else
                       [repair_frame(p) for p in value] for k,value in poly.items()}

        old_checks = []
        clips = {c['scheduleKey']:c for c in tf.get('boundaryClips',[])}
        for room in floor['rooms']:
            original = copy.deepcopy(room)
            room['footprint'] = polygon(room['footprint'])
            if room['scheduleKey'] in clips:
                clip=clips[room['scheduleKey']]
                pixels=[inverse(p,cold) for p in original['footprint']['outer']]
                room['footprint']['outer']=[from_source(p) for p in clip_min_x(pixels,clip['referenceXMinimum'])]
            if 'labelAt' in room:
                room['labelAt'] = repair_frame(room['labelAt'])
            before = area(original['footprint']['outer'])/.09290304
            after = area(room['footprint']['outer'])/.09290304
            listed = tf['inheritedRoomAreas'][room['label']]
            old_checks.append({'label':room['label'],'oldAreaSqft':before,'correctedAreaSqft':after,
                'printedAreaSqft':listed,'relativeDifference':abs(after/listed-1)})
            # The old imported area-ratio notes described a different source
            # frame. Replace them with the area of the actual corrected output.
            room['notes'] = [n for n in room.get('notes',[]) if not n.startswith('Outline traced from the Facilities drawing image; its area is')]
            room['notes'].extend([f'Lower-floor metric scale repaired uniformly by factor {newscale/oldscale:.6f}; identifier retained and any additional boundary repair is documented separately.',
                f'Corrected inherited trace area {after:.1f} ft² versus printed {listed} ft²; the approximate inherited outline is not independently stretched to force area equality.'])
            if room['scheduleKey'] in clips:
                room['notes'].append(clips[room['scheduleKey']]['reason'])
            room['sources'].append({'source':source['id'],'note':'Verified room location and uniform floor-scale correction via shared L4 core.'})
        floor['outline'] = [polygon(p) for p in floor['outline']]
        for item in floor.get('areas',[]):
            item['footprint'] = polygon(item['footprint'])
        for item in floor.get('features',[]):
            if 'at' in item:
                item['at'] = repair_frame(item['at'])
        floor['notes'] = [n for n in floor.get('notes',[]) if not n.startswith('No room outlines for this floor;')]
        floor['notes'].append('The former lower-floor meter scale was too small. All inherited geometry was corrected by one similarity using same-floor room controls and the unchanged L4 elevator/stair core. The inherited outline fragments are not a complete floor envelope.')
        room_checks, replaced = [], []
        listed = {r['scheduleKey']:r for r in floor['unplaced']}
        for r in tf['rooms']+tf.get('repairs',[]):
            key = r['scheduleKey']
            replacing = r in tf.get('repairs',[])
            if not replacing:
                assert listed[key]['areaSqft']==r['printedAreaSqft']
            assert inside(r['labelPoint'],r['outer'])
            poly = [from_source(p) for p in r['outer']]
            sqft = area(poly)/.09290304
            diff = abs(sqft/r['printedAreaSqft']-1)
            assert diff < r['maxRelativeAreaDifference'], (key,sqft,diff)
            newroom = {'id':tf['id']+'-FIS-'+source['printedDate'][:4]+'-'+key,'label':key,'scheduleKey':key,
                'floor':tf['id'],'type':'lecture-hall' if key=='1330' else 'classroom','footprint':{'outer':poly},
                'labelAt':from_source(r['labelPoint']),'confidence':{'location':'approximate','shape':'traced','label':'direct'},
                'sources':[{'source':source['id'],'imageRef':source['sheet'],'region':'Room '+key}],
                'notes':['Traced directly from the printed numbered room boundary; door openings are closed.',
                         f'Traced area {sqft:.1f} ft² versus printed {r["printedAreaSqft"]} ft². Scale comes from shared core registration, independently of this room area.',source['warning']]}
            if replacing:
                index = next(i for i,v in enumerate(floor['rooms']) if v['scheduleKey']==key)
                original = floor['rooms'][index]
                newroom['id'] = original['id']
                newroom['notes'].append(r['reason'])
                floor['rooms'][index] = newroom
                replaced.append({'scheduleKey':key,'reason':r['reason'],'oldInputRoom':by_label[key]})
            else:
                floor['rooms'].append(newroom); added.append(key)
            room_checks.append({'room':key,'tracedAreaSqft':sqft,'printedAreaSqft':r['printedAreaSqft'],
                'relativeDifference':diff,'repairOfExistingRoom':replacing,'usedToSetScale':False})
        recovered = {r['scheduleKey'] for r in tf['rooms']}
        floor['unplaced'] = [r for r in floor['unplaced'] if r['scheduleKey'] not in recovered]
        floor['sources'].append({'source':source['id']})
        # The inherited polygons have one uniform similarity, preserving all
        # edge ratios. The single explicitly audited misidentified room is exempt.
        repairs = {r['scheduleKey'] for r in tf.get('repairs',[])}
        for old in base_floors[tf['id']]['rooms']:
            new = next(r for r in floor['rooms'] if r['id']==old['id'])
            assert new['label']==old['label'] and new['scheduleKey']==old['scheduleKey']
            if old['scheduleKey'] not in repairs and old['scheduleKey'] not in clips:
                assert new['footprint']==polygon(old['footprint'])
        reports.append({'floor':tf['id'],'source':source['id'],'metersPerReferencePixel':newscale,
            'sourceToCorrectedLocal':cnew,'sourceToOldLocal':cold,'uniformLinearCorrectionFactor':newscale/oldscale,
            'formula':'Corrected point = sourceToCorrectedLocal(inverse(sourceToOldLocal)(oldPoint)). Each map is x=a*u-b*v+tx; z=b*u+a*v+tz.',
            'registrationChecks':checks,'inheritedAreaChecks':old_checks,'newAreaChecks':room_checks,'roomIdentityRepairs':replaced,
            'inheritedBoundaryClips':tf.get('boundaryClips',[])})
        for index,first in enumerate(floor['rooms']):
            for second in floor['rooms'][index+1:]:
                a,b=first['footprint']['outer'],second['footprint']['outer']
                assert not any(inside(p,b) for p in a) and not any(inside(p,a) for p in b), ('Room overlap',first['label'],second['label'])
        from PIL import Image,ImageDraw
        image = Image.open(ROOT/source['localPath']).convert('RGBA').resize(tuple(source['referenceSize']))
        overlay = Image.new('RGBA',image.size);draw=ImageDraw.Draw(overlay)
        for r in floor['rooms']:
            if r['id'] not in {old['id'] for old in base_floors[tf['id']]['rooms']}:
                continue
            if r['scheduleKey'] in repairs:
                continue
            p=[tuple(inverse(x,cnew)) for x in r['footprint']['outer']]
            draw.polygon(p,fill=(0,150,60,18));draw.line(p+p[:1],fill=(0,130,50,220),width=2)
        for r in tf['rooms']+tf.get('repairs',[]):
            p=[tuple(x) for x in r['outer']];color=(255,120,0,255) if r in tf.get('repairs',[]) else (0,80,220,255)
            draw.polygon(p,fill=(*color[:3],35));draw.line(p+p[:1],fill=color,width=2)
        for p in core['controls']:
            x,y=p['source'];draw.ellipse((x-3,y-3,x+3,y+3),fill=(0,160,60,255))
        for p in core['holdouts']:
            x,y=p['source'];draw.ellipse((x-3,y-3,x+3,y+3),fill=(180,0,180,255))
        Image.alpha_composite(image,overlay).convert('RGB').save(ROOT/f'local/indoor-sources/HSS-{tf["id"]}-trace-review.png')
    for fid,original in base_floors.items():
        if fid not in ('L1','L2'):
            assert floors[fid]==original
    assert 'geo' not in layout
    layout['geometryStatus']='source-traced'
    layout['provenance'] += ' Public 2025/2024 FIS rasters supply seven missing classrooms and correct the 2333A/2333B boundary assignment. Lower-floor metric scales are repaired uniformly and aligned through shared elevator/stair geometry to the unchanged L4 core.'
    layout['coordinateSystem']['description']='Independent local meters in the inherited upper-floor frame. L1/L2 are registered to the unchanged L4 service core; campus registration remains unset.'
    layout['coordinateSystem']['northDeg']=None
    layout['coordinateSystem']['northNote']='True north is not established for the shared inherited upper-floor frame. L1/L2 use verified raster scales and service-core registration, whose rotation differs from page north. No campus orientation is asserted.'
    (ROOT/trace['outputLayout']).write_text(json.dumps(layout,separators=(',',':'))+'\n')
    report={'schemaVersion':1,'building':'HSS','output':trace['outputLayout'],'addedScheduleKeys':sorted(added),
        'correctedExistingRoom':'2333A','campusRegistration':False,'unchangedUpperFloorRoomCount':sum(len(f['rooms']) for f in base['floors'] if f['id'] not in ('L1','L2')),
        'floors':reports,'limitations':trace['limitations'],'inputHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in [TRACE,trace['baseLayout']]+[s['localPath'] for s in sources.values()]}}
    (ROOT/'data/indoor/HSS/public-fis-review.json').write_text(json.dumps(report,indent=2)+'\n')
    print('HSS:',', '.join(sorted(added)),'added; 2333A corrected; L1/L2 scale factors',*[round(r['uniformLinearCorrectionFactor'],5) for r in reports])


if __name__=='__main__':
    main()

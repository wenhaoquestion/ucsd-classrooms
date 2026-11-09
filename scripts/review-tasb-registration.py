#!/usr/bin/env python3
"""Verify TASB L2/L1 common frame using exact elevator and wall boundaries."""
import hashlib
import argparse
import json
import math
from pathlib import Path

import numpy as np

from tririga_registration import sample
from tririga_svg import parse_svg

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent/'artifacts/tririga-floorplans'


def edges(polygons):
    return [(a,b) for p in polygons for ring in [p['outer'],*p.get('holes',[])]
            for a,b in zip(ring,ring[1:]+ring[:1])]


def shared_edges(moving, fixed):
    """Exact collinear overlap, with only export decimal precision tolerance."""
    matches = []
    for a,b in edges(moving):
        ux,uy=b[0]-a[0],b[1]-a[1];length=math.hypot(ux,uy)
        if length<1:continue
        intervals=[]
        for c,d in edges(fixed):
            if (abs(ux*(c[1]-a[1])-uy*(c[0]-a[0]))/length>1e-4 or
                abs(ux*(d[1]-a[1])-uy*(d[0]-a[0]))/length>1e-4):continue
            start,end=sorted([((p[0]-a[0])*ux+(p[1]-a[1])*uy)/length for p in (c,d)])
            start,end=max(0,start),min(length,end)
            if end-start>1:intervals.append((start,end))
        merged=[]
        for start,end in sorted(intervals):
            if merged and start<=merged[-1][1]+1e-4:merged[-1][1]=max(merged[-1][1],end)
            else:merged.append([start,end])
        for start,end in merged:
            matches.append({'start':[a[0]+ux*start/length,a[1]+uy*start/length],
                            'end':[a[0]+ux*end/length,a[1]+uy*end/length],
                            'lengthSourceUnits':end-start})
    return sorted(matches,key=lambda x:x['lengthSourceUnits'],reverse=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review-config', type=Path, default=ROOT/'data/indoor/tririga/registration-review-config.json')
    parser.add_argument('--output', type=Path, default=ROOT/'data/indoor/tririga/registration-overrides.json')
    args = parser.parse_args()
    if not args.review_config.is_file():
        parser.error('Local reviewed registration configuration is required; authenticated source identifiers are not published with this repository.')
    config = json.loads(args.review_config.read_text(encoding='utf-8'))['TASB']
    index=json.loads((SOURCE/'index.json').read_text(encoding='utf-8'))
    rows={r['floor_record_id']:r for r in index['records'] if r.get('kind')=='floor' and r['building_record_id']==config['buildingRecordId']}
    fixed_id,moving_id=config['referenceFloorRecordId'],config['movingFloorRecordId']
    parsed={}
    for fid in (fixed_id,moving_id):
        r=rows[fid];path=SOURCE/r['svg_path']
        assert hashlib.sha256(path.read_bytes()).hexdigest()==r['sha256']
        parsed[fid]=parse_svg(path,fid,r['label_detail'])
    fixed,moving=parsed[fixed_id],parsed[moving_id]
    fe=next(s for s in fixed['spaces'] if s['record_id']==config['referenceElevatorRecordId'])
    me=next(s for s in moving['spaces'] if s['record_id']==config['movingElevatorRecordId'])
    assert fe['polygons']==me['polygons']
    fs=next(s for s in fixed['spaces'] if s['record_id']==config['referenceStairRecordId'])
    ms=next(s for s in moving['spaces'] if s['record_id']==config['movingStairRecordId'])
    stair_shared=shared_edges(ms['polygons'],fs['polygons'])
    gross_shared=shared_edges(moving['outline'],fixed['outline'])
    total=sum(x['lengthSourceUnits'] for x in gross_shared)
    anchor_points=np.asarray([p for x in gross_shared if x['lengthSourceUnits']>20 for p in (x['start'],x['end'])])
    spread=np.ptp(anchor_points,axis=0)
    assert sum(x['lengthSourceUnits'] for x in stair_shared)>350
    assert total>3000 and spread[0]>3500 and spread[1]>700
    assert len(gross_shared)>20
    row={'buildingRecordId':config['buildingRecordId'],'floorRecordId':moving_id,'referenceFloorRecordId':fixed_id,
         'matrix':[[1.,0.],[0.,1.]],'translation':[0.,0.],
         'svgSha256':rows[moving_id]['sha256'],'referenceSvgSha256':rows[fixed_id]['sha256'],
         'evidence':{'method':'exact-elevator-boundary-and-distributed-identical-gross-wall-segments',
             'elevator':{'movingRecordId':me['record_id'],'movingLabel':me['label'],'fixedRecordId':fe['record_id'],
                         'fixedLabel':fe['label'],'polygonExactlyEqual':True,'boundaryResidualSourceUnits':0},
             'stair':{'movingRecordId':ms['record_id'],'movingLabel':ms['label'],'fixedRecordId':fs['record_id'],
                      'fixedLabel':fs['label'],'sharedSegments':stair_shared},
             'sharedGrossWallLengthSourceUnits':total,'sharedGrossWallSegmentCount':len(gross_shared),
             'sharedGrossWallAnchorExtentSourceUnits':spread.tolist(),'longestSharedGrossWallSegments':gross_shared[:20],
             'collinearityToleranceSourceUnits':1e-4,
             'limitations':config['limitations']}}
    path=args.output
    document=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'schemaVersion':1,'entries':[]}
    document['entries']=[e for e in document['entries'] if not(e['buildingRecordId']==row['buildingRecordId'] and e['floorRecordId']==moving_id)]
    document['entries'].append(row);path.write_text(json.dumps(document,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'building':'TASB','floorRecordId':moving_id,'referenceFloorRecordId':fixed_id,
                      'sharedWallLength':total,'sharedWallExtent':spread.tolist(),
                      'sharedStairLength':sum(x['lengthSourceUnits'] for x in stair_shared)},indent=2))


if __name__=='__main__':main()

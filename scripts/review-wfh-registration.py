#!/usr/bin/env python3
"""Reproduce reviewed Wells Fargo Hall registration from three vertical services.

These explicit record correspondences correct cross-floor shaft renumbering;
they do not relax the generic registration gates. Source SHA-256 hashes and
all residuals are retained alongside the affine overrides consumed locally.
"""
import hashlib
import argparse
import json
import math
from pathlib import Path

import numpy as np

from tririga_registration import centroid, polygon_area, rotation, transform_polygons
from tririga_svg import parse_svg

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent/'artifacts/tririga-floorplans'


def bounds(polygon):
    points = np.asarray(polygon['outer'])
    return np.r_[points.min(axis=0), points.max(axis=0)]


def distance_to_ring(point, ring):
    a = np.asarray(ring); b = np.roll(a,-1,axis=0); vector = b-a
    t = np.clip(np.sum((point-a)*vector,axis=1)/np.maximum(np.sum(vector*vector,axis=1),1e-15),0,1)
    return float(np.min(np.linalg.norm(a+t[:,None]*vector-point,axis=1)))


def boundary_residual(first, second):
    return max(max(distance_to_ring(np.asarray(p),second['outer']) for p in first['outer']),
               max(distance_to_ring(np.asarray(p),first['outer']) for p in second['outer']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review-config', type=Path, default=ROOT/'data/indoor/tririga/registration-review-config.json')
    parser.add_argument('--output', type=Path, default=ROOT/'data/indoor/tririga/registration-overrides.json')
    args = parser.parse_args()
    if not args.review_config.is_file():
        parser.error('Local reviewed registration configuration is required; authenticated source identifiers are not published with this repository.')
    config = json.loads(args.review_config.read_text(encoding='utf-8'))['WFH']
    building = config['buildingRecordId']
    reference = config['referenceFloorRecordId']
    index = json.loads((SOURCE/'index.json').read_text(encoding='utf-8'))
    rows = {r['floor_record_id']:r for r in index['records'] if r.get('kind')=='floor' and r['building_record_id']==building}
    selected = {}
    for fid, labels in config['reviewedLabels'].items():
        row = rows[fid]; path = SOURCE/row['svg_path']
        assert hashlib.sha256(path.read_bytes()).hexdigest()==row['sha256']
        parsed = parse_svg(path,fid,row['label_detail'])
        spaces = []
        for label in labels:
            matches = [s for s in parsed['spaces'] if s['label']==label]
            assert len(matches)==1 and len(matches[0]['polygons'])==1
            spaces.append(matches[0])
        selected[fid] = spaces
    fixed = selected[reference]
    fixed_polys = [s['polygons'][0] for s in fixed]
    span = float(np.linalg.norm(centroid(fixed_polys[1])-centroid(fixed_polys[0])))
    entries = []
    for fid, spaces in selected.items():
        if fid==reference: continue
        polygons = [s['polygons'][0] for s in spaces]
        shift = centroid(fixed_polys[0])-centroid(polygons[0])
        moved = transform_polygons(polygons,np.eye(2),shift)
        elevator_error = boundary_residual(moved[0],fixed_polys[0])
        elevator_area_ratio = polygon_area(polygons[0])/polygon_area(fixed_polys[0])
        east_center_error = float(np.linalg.norm(centroid(moved[1])-centroid(fixed_polys[1])))
        east_boundary_error = boundary_residual(moved[1],fixed_polys[1])
        east_area_ratio = polygon_area(polygons[1])/polygon_area(fixed_polys[1])
        west_bounds, fixed_west_bounds = bounds(moved[2]), bounds(fixed_polys[2])
        # The upper west shaft extends farther south. Its two side lines and
        # north edge, not its area centroid, are the unchanged corroboration.
        west_edge_errors = np.abs((west_bounds-fixed_west_bounds)[[0,1,2]])
        alternatives = []
        for angle in (0,90,180,270):
            rot = rotation(angle)
            candidate_shift = centroid(fixed_polys[0])-centroid(polygons[0])@rot.T
            residual = float(np.linalg.norm(centroid(polygons[1])@rot.T+candidate_shift-centroid(fixed_polys[1])))
            alternatives.append({'rotationDeg':angle,'eastShaftCenterResidualSourceUnits':residual})
        assert elevator_error<.3 and .998<elevator_area_ratio<1.002
        assert east_center_error<3 and east_boundary_error<8 and 1.1<east_area_ratio<1.17
        assert max(west_edge_errors)<4 and span>1800
        assert all(a['eastShaftCenterResidualSourceUnits']>2000 for a in alternatives[1:])
        anchors = []
        for i, role in enumerate(('elevator','east shaft with renumbered wing prefix','west shaft with longer upper-level extent')):
            anchors.append({'role':role,'movingRecordId':spaces[i]['record_id'],'movingLabel':spaces[i]['label'],
                            'fixedRecordId':fixed[i]['record_id'],'fixedLabel':fixed[i]['label']})
        entries.append({'buildingRecordId':building,'floorRecordId':fid,'referenceFloorRecordId':reference,
                        'matrix':[[1.,0.],[0.,1.]],'translation':shift.tolist(),
                        'svgSha256':rows[fid]['sha256'],'referenceSvgSha256':rows[reference]['sha256'],
                        'evidence':{'method':'reviewed-elevator-shape-and-two-renumbered-shaft-boundaries',
                            'anchors':anchors,'elevatorMaximumBoundaryResidualSourceUnits':elevator_error,
                            'elevatorAreaRatio':elevator_area_ratio,'eastShaftCenterResidualSourceUnits':east_center_error,
                            'eastShaftMaximumBoundaryResidualSourceUnits':east_boundary_error,'eastShaftAreaRatio':east_area_ratio,
                            'elevatorToEastShaftSeparationSourceUnits':span,
                            'westShaftMatchingSideAndNorthEdgeResidualsSourceUnits':west_edge_errors.tolist(),
                            'cardinalAlternatives':alternatives,
                            'sourceFiles':[str((SOURCE/rows[fid]['svg_path']).resolve()),str((SOURCE/rows[reference]['svg_path']).resolve())],
                            'limitations':config['limitations']}})
    output = args.output
    existing=json.loads(output.read_text(encoding='utf-8'))['entries'] if output.exists() else []
    retained=[e for e in existing if e['buildingRecordId']!=building]
    output.write_text(json.dumps({'schemaVersion':1,'entries':retained+entries},indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'building':'WFH','referenceFloorRecordId':reference,'overrides':len(entries),
                      'elevatorMaxResidual':max(e['evidence']['elevatorMaximumBoundaryResidualSourceUnits'] for e in entries),
                      'eastShaftMaxCenterResidual':max(e['evidence']['eastShaftCenterResidualSourceUnits'] for e in entries)},indent=2))


if __name__=='__main__': main()

"""Evidence-gated rigid registration of floor CAD frames (never per-floor scaling).

Requires numpy/scipy, already used by the optional tracing tools. A candidate is
accepted only with repeated boundary segments or spatially separated service
cores. Every accepted transform carries its numeric residuals and anchor IDs.
"""
import math
import re
from itertools import combinations
from collections import Counter

import numpy as np
from scipy.spatial import cKDTree


def points(polygons):
    return np.asarray([p for poly in polygons for p in poly['outer']], dtype=float)


def bounds(polygons):
    p = points(polygons)
    return np.r_[p.min(axis=0), p.max(axis=0)]


def polygon_area(poly):
    def area(ring):
        p = np.asarray(ring)
        return abs(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - p[:, 1] * np.roll(p[:, 0], -1))) / 2
    return area(poly['outer']) - sum(area(h) for h in poly.get('holes', []))


def centroid(poly):
    p = np.asarray(poly['outer'])
    q = np.roll(p, -1, axis=0)
    cross = p[:, 0] * q[:, 1] - q[:, 0] * p[:, 1]
    return np.sum((p + q) * cross[:, None], axis=0) / (3 * cross.sum()) if abs(cross.sum()) > 1e-8 else p.mean(axis=0)


def sample(polygons, count=800):
    # Uniform by actual arclength. Vertex-count sampling overweights curved
    # columns and tiny islands, which may contain more vertices than the slab.
    maximum = max(polygon_area(p) for p in polygons)
    edges = [(np.asarray(a), np.asarray(b)) for poly in polygons if polygon_area(poly)>maximum*.01
             for ring in [poly['outer'], *poly.get('holes', [])]
             for a, b in zip(ring, ring[1:] + ring[:1])]
    lengths = np.asarray([np.linalg.norm(b - a) for a, b in edges])
    cumulative = np.r_[0., np.cumsum(lengths)]
    distances = np.linspace(0, cumulative[-1], count, endpoint=False)
    indices = np.minimum(np.searchsorted(cumulative, distances, side='right')-1, len(edges)-1)
    edge_array = np.asarray(edges)
    starts, ends = edge_array[indices, 0], edge_array[indices, 1]
    fractions = (distances-cumulative[indices])/np.maximum(lengths[indices], 1e-12)
    return starts+(ends-starts)*fractions[:,None]


def rotation(degrees):
    angle = math.radians(degrees)
    return np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])


def apply_point(point, matrix, shift):
    return (np.asarray(point) @ np.asarray(matrix).T + np.asarray(shift)).tolist()


def transform_polygons(polygons, matrix, shift, scale=1):
    return [{key: ([(np.asarray(p) @ matrix.T + shift).tolist() for p in value]
                   if key == 'outer' else [[(np.asarray(p) @ matrix.T + shift).tolist() for p in ring] for ring in value])
             for key, value in poly.items() if key in ('outer', 'holes')} for poly in polygons]


def cores(parsed):
    result = []
    for space in parsed['spaces']:
        match = re.match(r'^\((CE|CS)\)', space.get('label', ''))
        if match and space['polygons']:
            poly = max(space['polygons'], key=polygon_area)
            suffix = space['label'][len(match[0]):]
            signature = re.sub(r'^([A-Z]*-?)[B0-9]', r'\1', suffix)
            result.append({'id': space['record_id'], 'label': space['label'], 'kind': match[1], 'signature':signature,
                           'at': centroid(poly), 'area': polygon_area(poly)})
    return result


def candidate_angles(moving_cores, fixed_cores, span):
    """Bound rotation proposals to corroborated, unique named core pairs.

    Anonymous same-type cross products grow quadratically before even pairing
    the anchors. They also supply no identity evidence for a non-cardinal
    rotation. Keep the four cardinal alternatives, and let unique same-name
    pairs propose other angles. Nearby proposals use the longest baseline,
    which is least sensitive to differing stair-landing centroids.
    """
    moving_names = Counter((c['kind'], c['signature']) for c in moving_cores)
    fixed_names = Counter((c['kind'], c['signature']) for c in fixed_cores)
    fixed_by_name = {(c['kind'],c['signature']):c for c in fixed_cores}
    pairs = []
    for moving in moving_cores:
        key = moving['kind'], moving['signature']
        if moving_names[key] != 1 or fixed_names[key] != 1:
            continue
        fixed = fixed_by_name[key]
        if .6 < moving['area']/max(fixed['area'],1e-10) < 1.65:
            pairs.append((moving,fixed))
    proposals = []
    for (m1,f1),(m2,f2) in combinations(pairs,2):
        mv, fv = m2['at']-m1['at'], f2['at']-f1['at']
        ml, fl = np.linalg.norm(mv), np.linalg.norm(fv)
        if min(ml,fl)<span*.12 or not .97<ml/fl<1.03:
            continue
        angle = (math.degrees(math.atan2(fv[1],fv[0])-math.atan2(mv[1],mv[0]))+360)%360
        proposals.append((float(min(ml,fl)), angle))
    angles = [0.,90.,180.,270.]
    angular_distance = lambda a,b: abs((a-b+180)%360-180)
    # At 0.05 degrees the edge displacement is below 0.0009 of the span;
    # all final residual/ambiguity gates below remain unchanged.
    for _, angle in sorted(proposals, reverse=True):
        if min(angular_distance(angle,a) for a in angles) > .05:
            angles.append(round(angle,6))
    return sorted(angles)


def register(moving, fixed):
    """Return rigid moving->fixed frame and evidence; None means unestablished."""
    if not moving['outline'] or not fixed['outline']:
        return None
    ma, fa = sample(moving['outline']), sample(fixed['outline'])
    # Gross-area voids can legitimately change at different levels (auditoria,
    # atria and shafts). Compare the enclosing slab separately, corroborated by
    # an identified core; do not count matching outer walls as matching voids.
    mo = sample([{'outer': p['outer']} for p in moving['outline']])
    fo = sample([{'outer': p['outer']} for p in fixed['outline']])
    fotree = cKDTree(fo)
    span = np.linalg.norm(np.ptp(fa, axis=0))
    if span <= 0:
        return None
    # A large unit mismatch is never silently fixed by normalizing the floor.
    ratio = np.linalg.norm(np.ptp(ma, axis=0)) / span
    if ratio > 5 or ratio < .08:
        return None
    mc, fc = cores(moving), cores(fixed)
    moving_names = Counter((c['kind'], c['signature']) for c in mc)
    fixed_names = Counter((c['kind'], c['signature']) for c in fc)
    semantic = {(m['kind'], m['signature']) for m in mc} & {(f['kind'], f['signature']) for f in fc}
    def compatible(m, f):
        return m['kind'] == f['kind'] and ((m['kind'],m['signature']) not in semantic or m['signature'] == f['signature'])
    ftree = cKDTree(fa)
    candidates = []
    pairs = [(m,f) for m in mc for f in fc if compatible(m,f)
             and .6 < m['area']/max(f['area'],1e-10) < 1.65]
    options_by_moving = {m['id']:[f for moving_core,f in pairs if moving_core['id']==m['id']] for m in mc}
    angles = candidate_angles(mc,fc,span)
    for angle in angles:
        rot = rotation(angle)
        rotated = ma @ rot.T
        core_shifts = [f['at']-m['at']@rot.T for m,f in pairs if .65<m['area']/max(f['area'],1e-10)<1.55]
        shifts = [(s,True) for s in core_shifts]
        shifts.extend([(np.zeros(2),False), ((fa.min(axis=0)+fa.max(axis=0)-rotated.min(axis=0)-rotated.max(axis=0))/2,False)])
        seen = set()
        evaluated_shifts = []
        for shift, anchored in shifts:
            # Deduplicate candidates, then refine translation only on close walls.
            # A changed stair centroid a few source units away must not consume
            # the bucket containing an exact elevator-frame translation.
            ident = tuple(np.round(shift / max(span * .000001, 1e-9)))
            if ident in seen:
                continue
            seen.add(ident)
            original = shift.copy()
            # Core-center translations are evidence, not a starting point to
            # drift into a different best-fitting exterior wall. Only refine
            # the centroid/identity candidates; keep core candidates exact.
            for _ in range(0 if anchored else 8):
                dist, nearest = ftree.query(rotated + shift)
                near = dist < span * .025
                if near.sum() < 20:
                    break
                delta = np.median(fa[nearest[near]] - rotated[near] - shift, axis=0)
                shift += delta
                if np.linalg.norm(delta) < span * .00001:
                    break
            if np.linalg.norm(shift-original) > span*.07:
                continue
            # The two wall-refined seeds often converge to an already tested
            # core shift. Reuse that geometric solution without re-running four
            # boundary queries and every core assignment.
            if any(np.linalg.norm(shift-other)<span*1e-6 for other in evaluated_shifts):
                continue
            evaluated_shifts.append(shift.copy())
            transformed = rotated + shift
            md = ftree.query(transformed)[0] / span
            fd = cKDTree(transformed).query(fa)[0] / span
            boundary = min(float(np.mean(md < .007)), float(np.mean(fd < .007)))
            transformed_outer = mo @ rot.T + shift
            outer_md = fotree.query(transformed_outer)[0] / span
            outer_fd = cKDTree(transformed_outer).query(fo)[0] / span
            outer_boundary = min(float(np.mean(outer_md < .007)), float(np.mean(outer_fd < .007)))
            matches, used = [], set()
            for m in mc:
                options = [(np.linalg.norm(m['at'] @ rot.T + shift-f['at']) / span, f)
                           for f in options_by_moving[m['id']] if f['id'] not in used]
                if options:
                    distance, f = min(options, key=lambda pair: pair[0])
                    if distance < .009:
                        used.add(f['id'])
                        matches.append((m, f, float(distance)))
            separation = max((np.linalg.norm(a[0]['at']-b[0]['at'])/span for a in matches for b in matches), default=0)
            # One repeated core plus a near-identical outline also suffices.
            semantic_matches = [p for p in matches if p[0]['signature']==p[1]['signature']
                                and moving_names[(p[0]['kind'],p[0]['signature'])]==1
                                and fixed_names[(p[1]['kind'],p[1]['signature'])]==1]
            exact_elevators = [p for p in semantic_matches if p[0]['kind']=='CE' and p[2]<1e-5]
            elevator_separation = max((np.linalg.norm(a[0]['at']-b[0]['at'])/span
                                      for a in exact_elevators for b in exact_elevators),default=0.)
            exact_elevator_frame = len(exact_elevators)>=2 and elevator_separation>.025
            directional_boundary = max(float(np.mean(md < .007)), float(np.mean(fd < .007)))
            close_identified_cores = (len(semantic_matches)>=2 and separation>.025 and directional_boundary>.5
                                     and max(p[2] for p in semantic_matches)<.001)
            # Basement core envelopes include stair landings / elevator walls
            # differently. Two named cores plus >55% bidirectional wall agreement
            # corroborate their common frame despite shifted area centroids.
            changed_core_envelopes = (len(semantic_matches)>=2 and separation>.025 and boundary>.55
                                      and max(p[2] for p in semantic_matches)<.006)
            matching_slab_and_core = (outer_boundary>.95 and any(
                p[2]<.001 and .99<p[0]['area']/p[1]['area']<1.01 for p in semantic_matches))
            accepted = ((len(matches) >= 2 and separation > .12) or boundary >= .82 or close_identified_cores
                        or changed_core_envelopes or matching_slab_and_core)
            if not accepted:
                continue
            residual = float(np.mean(np.sort(np.r_[md, fd])[:max(1, int((len(md)+len(fd))*.65))]))
            score = boundary + min(len(matches), 5)*.12 + (outer_boundary*.15 if matching_slab_and_core else 0) - residual*3
            candidates.append((score, rot, shift.copy(), {'rotationDeg': angle, 'boundaryAgreement': round(boundary, 5),
                'outerBoundaryAgreement': round(outer_boundary, 5),
                'exactElevatorFrame': exact_elevator_frame,
                'exactElevatorAnchorCount':len(exact_elevators),
                'exactElevatorSeparationFraction':round(float(elevator_separation),6),
                'acceptanceEvidence': ('matching-slab-and-identical-core' if matching_slab_and_core else
                                       'near-exact-named-cores-and-shared-walls' if close_identified_cores else
                                       'named-core-envelopes-and-bidirectional-walls' if changed_core_envelopes else
                                       'separated-cores-or-repeated-boundary'),
                'trimmedBoundaryResidualFraction': round(residual, 6), 'coreSeparationFraction': round(float(separation), 5),
                'anchors': [{'moving': m['id'], 'fixed': f['id'], 'movingLabel': m['label'], 'fixedLabel': f['label'],
                             'residualFraction': round(d, 6)} for m, f, d in matches]}))
    if not candidates:
        return None
    # Unchanged, uniquely numbered elevator centers fix the CAD frame more
    # strongly than a changing slab perimeter. Do not rotate/translate those
    # exact vertical shafts merely to improve the fit to an upper-floor terrace.
    # This is a ranking rule only: every candidate already passed the same gates.
    candidates.sort(key=lambda c: (c[3]['exactElevatorFrame'],c[0]), reverse=True)
    best = candidates[0]
    alternatives = [c for c in candidates[1:]
                    if np.sqrt(np.mean(np.sum((ma@c[1].T+c[2]-(ma@best[1].T+best[2]))**2,axis=1)))>span*.03]
    alternatives = [c for c in alternatives if c[3]['exactElevatorFrame']==best[3]['exactElevatorFrame']]
    if alternatives and best[0]-alternatives[0][0] < .025:
        # Symmetric plans cannot establish a unique orientation from geometry.
        return None
    return {'matrix': best[1], 'shift': best[2], 'evidence': best[3]}

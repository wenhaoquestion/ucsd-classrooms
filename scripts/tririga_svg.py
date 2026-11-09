#!/usr/bin/env python3
"""Extract record-bound polygons from locally exported TRIRIGA SVG floor plans.

No viewport fit, floor centering, physical scale, or north rotation is applied.
All points are in the SVG's original user-coordinate frame after SVG transforms.
Only triSpaceLayer and triGrossAreaLayer establish room/floor geometry; drawing
furniture, title blocks, paper borders, and unbound wall strokes are excluded.

Usage: python scripts/tririga_svg.py plan.svg --floor-record-id 123 --output out.json
The module uses only the Python standard library. Curves are flattened at a
maximum local chord error of 0.25 source units; the source itself is retained.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

NUMBER = r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?"
IDENTITY = (1., 0., 0., 1., 0., 0.)


def numbers(value):
    return [float(x) for x in re.findall(NUMBER, value or "")]


def multiply(a, b):
    """SVG affine composition a @ b (b is applied first)."""
    return (a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
            a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
            a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5])


def transform_point(matrix, point):
    x, y = point
    return [matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]]


def parse_transform(value):
    matrix = IDENTITY
    for kind, arguments in re.findall(r"([A-Za-z]+)\s*\(([^)]*)\)", value or ""):
        args = numbers(arguments)
        if kind == "matrix" and len(args) == 6:
            part = tuple(args)
        elif kind == "translate" and len(args) in (1, 2):
            part = (1, 0, 0, 1, args[0], args[1] if len(args) == 2 else 0)
        elif kind == "scale" and len(args) in (1, 2):
            part = (args[0], 0, 0, args[-1], 0, 0)
        elif kind == "rotate" and len(args) in (1, 3):
            angle = math.radians(args[0]); c, s = math.cos(angle), math.sin(angle)
            part = (c, s, -s, c, 0, 0)
            if len(args) == 3:
                x, y = args[1:]
                part = multiply(multiply((1, 0, 0, 1, x, y), part), (1, 0, 0, 1, -x, -y))
        elif kind in ("skewX", "skewY") and len(args) == 1:
            t = math.tan(math.radians(args[0]))
            part = (1, 0, t, 1, 0, 0) if kind == "skewX" else (1, t, 0, 1, 0, 0)
        else:
            raise ValueError(f"Unsupported SVG transform: {kind}({arguments})")
        matrix = multiply(matrix, part)
    return matrix


def signed_area(ring):
    return sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(ring, ring[1:]+ring[:1])) / 2


def point_in_ring(point, ring):
    x, y = point; inside = False
    for a, b in zip(ring, ring[1:]+ring[:1]):
        if (a[1] > y) != (b[1] > y):
            if x < (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]) + a[0]:
                inside = not inside
    return inside


def polygon_area(polygon):
    return abs(signed_area(polygon['outer'])) - sum(abs(signed_area(h)) for h in polygon.get('holes', []))


def polygon_centroid(polygon):
    ring = polygon['outer']; area = signed_area(ring)
    if abs(area) < 1e-12:
        return [sum(p[i] for p in ring)/len(ring) for i in (0, 1)]
    return [sum((a[i]+b[i])*(a[0]*b[1]-b[0]*a[1])
                for a, b in zip(ring, ring[1:]+ring[:1]))/(6*area) for i in (0, 1)]


def ring_self_intersections(ring):
    """Nonadjacent edge intersections, including unsupported self-touch points."""
    if len(ring) < 3: return []
    extent = max(max(p[i] for p in ring)-min(p[i] for p in ring) for i in (0, 1))
    epsilon = max(1e-7, extent*1e-10)
    segments = sorted((min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1]), i, a, b)
                      for i, (a, b) in enumerate(zip(ring, ring[1:]+ring[:1])))
    active, intersections = [], []
    def cross(a, b, c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    def on(a, b, p):
        return (min(a[0], b[0])-epsilon <= p[0] <= max(a[0], b[0])+epsilon and
                min(a[1], b[1])-epsilon <= p[1] <= max(a[1], b[1])+epsilon and
                abs(cross(a, b, p)) <= epsilon*max(1, math.dist(a, b)))
    for segment in segments:
        left, right, low, high, i, a, b = segment
        active = [s for s in active if s[1]+epsilon >= left]
        for _, _, low2, high2, j, c, d in active:
            if abs(i-j) in (1, len(ring)-1) or high2+epsilon < low or high+epsilon < low2: continue
            ac, ad, ca, cb = cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
            if (ac*ad < 0 and ca*cb < 0) or on(a, b, c) or on(a, b, d) or on(c, d, a) or on(c, d, b):
                intersections.append([min(i, j), max(i, j)])
        active.append(segment)
    return sorted(intersections)


def polygon_issues(polygon):
    issues = []
    for i, ring in enumerate([polygon['outer']]+polygon.get('holes', [])):
        if len(ring) < 3 or abs(signed_area(ring)) < 1e-8: issues.append(f'ring {i} has no area')
        intersections = ring_self_intersections(ring)
        if intersections: issues.append(f'ring {i} has {len(intersections)} self intersections')
    for i, hole in enumerate(polygon.get('holes', [])):
        if not all(point_in_ring(p, polygon['outer']) for p in hole): issues.append(f'hole {i} is not strictly inside its outer ring')
    if polygon_area(polygon) <= 0: issues.append('polygon has nonpositive area')
    return issues


def _distance_to_line(p, a, b):
    if a == b:
        return math.dist(p, a)
    return abs((b[0]-a[0])*(a[1]-p[1])-(a[0]-p[0])*(b[1]-a[1])) / math.dist(a, b)


def _cubic(a, b, c, d, tolerance, depth=0):
    if depth >= 16 or max(_distance_to_line(b, a, d), _distance_to_line(c, a, d)) <= tolerance:
        return [d]
    mid = lambda p, q: [(p[0]+q[0])/2, (p[1]+q[1])/2]
    ab, bc, cd = mid(a, b), mid(b, c), mid(c, d)
    abc, bcd = mid(ab, bc), mid(bc, cd); center = mid(abc, bcd)
    return _cubic(a, ab, abc, center, tolerance, depth+1) + _cubic(center, bcd, cd, d, tolerance, depth+1)


def _arc(start, args, tolerance):
    rx, ry, rotation, large, sweep, x, y = args; end = [x, y]
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0 or start == end:
        return [end]
    phi = math.radians(rotation); co, si = math.cos(phi), math.sin(phi)
    dx, dy = (start[0]-x)/2, (start[1]-y)/2
    xp, yp = co*dx+si*dy, -si*dx+co*dy
    lam = xp*xp/(rx*rx)+yp*yp/(ry*ry)
    if lam > 1:
        rx *= math.sqrt(lam); ry *= math.sqrt(lam)
    numerator = max(0, rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)
    denominator = rx*rx*yp*yp+ry*ry*xp*xp
    factor = math.sqrt(numerator/denominator) if denominator else 0
    if bool(large) == bool(sweep): factor = -factor
    cxp, cyp = factor*rx*yp/ry, -factor*ry*xp/rx
    cx, cy = co*cxp-si*cyp+(start[0]+x)/2, si*cxp+co*cyp+(start[1]+y)/2
    angle = math.atan2((yp-cyp)/ry, (xp-cxp)/rx)
    delta = math.atan2((-yp-cyp)/ry, (-xp-cxp)/rx)-angle
    if sweep and delta < 0: delta += 2*math.pi
    if not sweep and delta > 0: delta -= 2*math.pi
    step = min(math.pi/24, 2*math.acos(max(-1, 1-tolerance/max(rx, ry))))
    count = max(1, math.ceil(abs(delta)/max(step, 1e-6)))
    points = [[cx+co*rx*math.cos(angle+delta*i/count)-si*ry*math.sin(angle+delta*i/count),
               cy+si*rx*math.cos(angle+delta*i/count)+co*ry*math.sin(angle+delta*i/count)] for i in range(1, count+1)]
    points[-1] = end
    return points


def path_rings(data, tolerance=0.25):
    """Flatten SVG path subpaths, rejecting open boundaries rather than closing them."""
    tokens = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|"+NUMBER, data or "")
    output, ring = [], []; current = [0., 0.]; first = None
    command = None; previous = None; control = None; i = 0
    counts = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7}
    while i < len(tokens):
        if tokens[i].isalpha():
            command = tokens[i]; i += 1
        if command is None: raise ValueError('SVG path is missing a command')
        upper, relative = command.upper(), command.islower()
        if upper == 'Z':
            if ring: output.append(ring)
            ring = []; current = list(first); previous = 'Z'; control = None; command = None
            continue
        count = counts[upper]
        if i+count > len(tokens) or any(t.isalpha() for t in tokens[i:i+count]):
            raise ValueError('Malformed SVG path arguments')
        args = [float(t) for t in tokens[i:i+count]]; i += count
        def point(offset):
            return [args[offset]+(current[0] if relative else 0), args[offset+1]+(current[1] if relative else 0)]
        if upper == 'M':
            if ring:
                if math.dist(ring[0], ring[-1]) > 1e-6: raise ValueError('Open path boundary')
                output.append(ring)
            current = point(0); first = current[:]; ring = [current[:]]
            command = 'l' if relative else 'L'
        elif upper in ('L', 'H', 'V'):
            end = point(0) if upper == 'L' else ([args[0]+(current[0] if relative else 0), current[1]] if upper == 'H' else [current[0], args[0]+(current[1] if relative else 0)])
            ring.append(end); current = end
        elif upper in ('C', 'S', 'Q', 'T'):
            reflected = [2*current[j]-control[j] for j in (0, 1)] if control is not None and previous in (('C', 'S') if upper == 'S' else ('Q', 'T')) else current[:]
            if upper == 'C': b, c, end = point(0), point(2), point(4); control = c
            elif upper == 'S': b, c, end = reflected, point(0), point(2); control = c
            else:
                q, end = (point(0), point(2)) if upper == 'Q' else (reflected, point(0))
                b = [current[j]+2*(q[j]-current[j])/3 for j in (0, 1)]
                c = [end[j]+2*(q[j]-end[j])/3 for j in (0, 1)]; control = q
            ring.extend(_cubic(current, b, c, end, tolerance)); current = end
        elif upper == 'A':
            end = point(5); args[5:7] = end
            ring.extend(_arc(current, args, tolerance)); current = end
        if upper not in ('C', 'S', 'Q', 'T'): control = None
        previous = upper
    if ring:
        if math.dist(ring[0], ring[-1]) > 1e-6: raise ValueError('Open path boundary')
        output.append(ring)
    return output


def _clean_ring(ring, epsilon):
    cleaned = []
    for p in ring:
        if not all(math.isfinite(v) for v in p): raise ValueError('Nonfinite polygon point')
        if not cleaned or math.dist(p, cleaned[-1]) > epsilon: cleaned.append(list(p))
    if len(cleaned) > 1 and math.dist(cleaned[0], cleaned[-1]) <= epsilon: cleaned.pop()
    # Remove only essentially collinear vertices, not an approximate simplification.
    changed = True
    while changed and len(cleaned) > 3:
        changed = False; result = []
        for i, p in enumerate(cleaned):
            a, b = cleaned[i-1], cleaned[(i+1)%len(cleaned)]
            if math.dist(a, b) <= epsilon or _distance_to_line(p, a, b) <= epsilon:
                changed = True
            else: result.append(p)
        cleaned = []
        for p in result:
            if not cleaned or math.dist(p, cleaned[-1]) > epsilon: cleaned.append(p)
        if len(cleaned) > 1 and math.dist(cleaned[0], cleaned[-1]) <= epsilon: cleaned.pop()
    return cleaned


def _split_bridges(ring, epsilon):
    """CAD polylines may encode holes/disconnected parts by doubled bridges."""
    if len(ring) < 3: return []
    stack, stack_keys, positions, loops = [], [], {}, []
    for p in ring+[ring[0]]:
        key = (round(p[0]/epsilon), round(p[1]/epsilon))
        # Decimal CAD coordinates and analytically noded crossings can differ
        # below source precision and straddle a quantization-cell boundary.
        nearby = [(key[0]+dx, key[1]+dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
        key = next((candidate for candidate in nearby if candidate in positions and math.dist(p, stack[positions[candidate]]) <= epsilon), key)
        if key in positions:
            at = positions[key]; loop = stack[at:]
            if len(loop) >= 3 and abs(signed_area(loop)) > epsilon*epsilon: loops.append(loop)
            for removed in stack_keys[at+1:]: positions.pop(removed, None)
            stack = stack[:at+1]; stack_keys = stack_keys[:at+1]
        else:
            positions[key] = len(stack); stack.append(p); stack_keys.append(key)
    return loops


def _node_ring(ring, epsilon):
    """Split edges at source crossings/touches before unthreading CAD bridges.

    CAD bridges sometimes join the middle of an existing edge rather than an
    explicit vertex. Noding preserves that exact location and allows the same
    loop-splitting operation; it does not buffer, hull, or move a room boundary.
    """
    additions = defaultdict(list)
    def add(index, p):
        a, b = ring[index], ring[(index+1)%len(ring)]
        length2 = sum((b[k]-a[k])**2 for k in (0, 1))
        if length2 == 0: return
        t = sum((p[k]-a[k])*(b[k]-a[k]) for k in (0, 1))/length2
        margin = epsilon/math.sqrt(length2)
        if margin < t < 1-margin: additions[index].append((t, list(p)))
    for i, j in ring_self_intersections(ring):
        a, b, c, d = ring[i], ring[(i+1)%len(ring)], ring[j], ring[(j+1)%len(ring)]
        ux, uy, vx, vy = b[0]-a[0], b[1]-a[1], d[0]-c[0], d[1]-c[1]
        determinant = ux*vy-uy*vx
        if abs(determinant) > 1e-12:
            t = ((c[0]-a[0])*vy-(c[1]-a[1])*vx)/determinant
            p = [a[0]+t*ux, a[1]+t*uy]
            add(i, p); add(j, p)
        else:
            for p in (c, d): add(i, p)
            for p in (a, b): add(j, p)
    output = []
    for i, p in enumerate(ring):
        output.append(p)
        output.extend(point for _, point in sorted(additions[i]))
    return output


def _interior_sample(ring):
    """A point just inside an edge, avoiding a centroid outside a concave ring."""
    sign = 1 if signed_area(ring) > 0 else -1
    extent = max(max(p[i] for p in ring)-min(p[i] for p in ring) for i in (0, 1))
    for a, b in zip(ring, ring[1:]+ring[:1]):
        length = math.dist(a, b)
        if length == 0: continue
        for distance in (extent*1e-7, extent*1e-5, min(length/10, extent*1e-3)):
            p = [(a[0]+b[0])/2-sign*(b[1]-a[1])*distance/length,
                 (a[1]+b[1])/2+sign*(b[0]-a[0])*distance/length]
            if point_in_ring(p, ring): return p
    return polygon_centroid({'outer': ring})


def rings_to_polygons(rings):
    """Retain nested voids and doubled-bridge parts; emit outer CCW, holes CW."""
    points = [p for ring in rings for p in ring]
    if not points: return []
    extent = max(max(p[i] for p in points)-min(p[i] for p in points) for i in (0, 1))
    # CAD curve endpoints can differ at 1e-5 source units. These microscopic
    # zero-area spurs are below the source's practical precision and would
    # become self-touching after runtime scaling. This is 2500 times smaller
    # than the curve tessellation tolerance, never a floor/room simplification.
    epsilon = max(1e-4, extent*1e-8)
    loops = []
    for ring in rings:
        ring = _clean_ring(ring, epsilon)
        ring = _node_ring(ring, epsilon)
        loops.extend(_split_bridges(ring, epsilon))
    unique = {}
    for ring in loops:
        # Unthreading a CAD bridge can expose an out-and-back tail which was
        # not consecutive in the original outline. Remove it after splitting.
        # Exported retraces can differ by ~0.001 source units; this 0.002-unit
        # cleanup remains 125 times smaller than curve tessellation tolerance.
        ring = _clean_ring(ring, max(epsilon, .002))
        if len(ring) < 3 or abs(signed_area(ring)) <= epsilon*epsilon: continue
        # Duplicate graphics layers can start rings at different vertices.
        keys = [tuple(round(v, 6) for v in p) for p in ring]
        at = min(range(len(keys)), key=keys.__getitem__)
        forward = keys[at:]+keys[:at]
        reverse = [forward[0]]+list(reversed(forward[1:]))
        unique[min(tuple(forward), tuple(reverse))] = ring
    loops = sorted(unique.values(), key=lambda r: abs(signed_area(r)), reverse=True)
    parents, depths = [], []
    for i, ring in enumerate(loops):
        sample = _interior_sample(ring)
        containers = [j for j in range(i) if point_in_ring(sample, loops[j])]
        parent = max(containers) if containers else None
        parents.append(parent); depths.append(depths[parent]+1 if parent is not None else 0)
    output, outer_indices = [], {}
    for i, ring in enumerate(loops):
        if depths[i] % 2 == 0:
            outer_indices[i] = len(output)
            output.append({'outer': ring if signed_area(ring) > 0 else list(reversed(ring))})
        else:
            polygon = output[outer_indices[parents[i]]]
            polygon.setdefault('holes', []).append(ring if signed_area(ring) < 0 else list(reversed(ring)))
    return output


def _element_rings(element, tolerance):
    tag = element.tag.rsplit('}', 1)[-1]
    if tag in ('polyline', 'polygon'):
        values = numbers(element.get('points'))
        if len(values) % 2: raise ValueError('Odd coordinate count')
        ring = [values[i:i+2] for i in range(0, len(values), 2)]
        if tag == 'polyline' and ring and math.dist(ring[0], ring[-1]) > 1e-4:
            raise ValueError('Open polyline boundary')
        return [ring]
    if tag == 'path': return path_rings(element.get('d'), tolerance)
    if tag == 'rect':
        x, y, w, h = [float(element.get(k, '0')) for k in ('x', 'y', 'width', 'height')]
        return [[[x, y], [x+w, y], [x+w, y+h], [x, y+h]]]
    if tag in ('circle', 'ellipse'):
        cx, cy = float(element.get('cx', '0')), float(element.get('cy', '0'))
        rx, ry = (float(element.get('r', '0')),)*2 if tag == 'circle' else (float(element.get('rx', '0')), float(element.get('ry', '0')))
        count = max(48, math.ceil(math.pi*2 / max(1e-5, 2*math.acos(max(-1, 1-tolerance/max(rx, ry))))))
        return [[[cx+rx*math.cos(i*2*math.pi/count), cy+ry*math.sin(i*2*math.pi/count)] for i in range(count)]]
    raise ValueError('Unsupported record-bound shape: '+tag)


def parse_svg(path, expected_floor_record_id=None, label_detail=None, curve_tolerance=0.25):
    """Return raw transformed rooms, floor polygons, label anchors, and evidence.

    `label_detail` may be the index record's label_detail dictionary. It is used
    only to corroborate/fill label text by record ID, never to invent geometry.
    """
    path = Path(path); data = path.read_bytes(); root = ET.fromstring(data)
    records = defaultdict(list); labels = defaultdict(list); warnings = []
    seen = set(); transforms = set(); counts = Counter(); gross_ids = set()

    def visit(element, parent_matrix=IDENTITY, layer=None, record_id=None):
        matrix = multiply(parent_matrix, parse_transform(element.get('transform')))
        own_id = element.get('id')
        if own_id in ('triSpaceLayer', 'triGrossAreaLayer', 'triMeasuredGrossAreaLayer', '==LabelsLayer', '_triLabelLayer', 'triLabelLayer'):
            layer = own_id
        record_id = element.get('tri-record-id', record_id)
        tag = element.tag.rsplit('}', 1)[-1]
        if layer in ('triSpaceLayer', 'triGrossAreaLayer') and record_id and tag not in ('g', 'svg'):
            try:
                rings = [[transform_point(matrix, p) for p in ring] for ring in _element_rings(element, curve_tolerance)]
                transforms.add(tuple(matrix))
                key = (layer, record_id, json.dumps(rings, separators=(',', ':')))
                if key not in seen:
                    seen.add(key); records[(layer, record_id)].extend(rings); counts[tag] += 1
                    if layer == 'triGrossAreaLayer': gross_ids.add(record_id)
            except ValueError as error:
                warnings.append({'record_id': record_id, 'layer': layer, 'reason': str(error), 'element': element.get('tri-element-name')})
        if layer in ('==LabelsLayer', '_triLabelLayer', 'triLabelLayer') and record_id and tag == 'text':
            text = ''.join(element.itertext()).strip() or element.get('text', '').strip()
            if text and text not in ('-', '<SPACE ROOM NAME>') and not re.fullmatch(r'<[^>]+>', text):
                x, y = numbers(element.get('x', '0')), numbers(element.get('y', '0'))
                labels[record_id].append({'text': text, 'at': transform_point(matrix, [x[0], y[0]])})
        for child in element: visit(child, matrix, layer, record_id)

    visit(root)
    if expected_floor_record_id is not None and str(expected_floor_record_id) not in gross_ids:
        raise ValueError(f'Expected floor record {expected_floor_record_id} is absent; gross records: {sorted(gross_ids)}')
    index_labels = (label_detail or {}).get('room_labels', {})
    spaces, rejected_spaces = [], []
    for (layer, record_id), rings in sorted(records.items()):
        if layer != 'triSpaceLayer': continue
        polygons = rings_to_polygons(rings)
        valid_polygons = []
        for polygon in polygons:
            issues = polygon_issues(polygon)
            if issues: warnings.append({'record_id': record_id, 'reason': 'Invalid source boundary omitted', 'issues': issues})
            else: valid_polygons.append(polygon)
        polygons = valid_polygons
        texts = list(dict.fromkeys(x['text'] for x in labels[record_id]))
        corroborating = index_labels.get(record_id, [])
        if texts and corroborating and texts != corroborating:
            warnings.append({'record_id': record_id, 'reason': 'SVG/index label text differs', 'svg_labels': texts, 'index_labels': corroborating})
        if not texts: texts = corroborating[:]
        if not polygons:
            warnings.append({'record_id': record_id, 'reason': 'No closed valid nonzero polygon'})
            rejected_spaces.append({'record_id': record_id, 'labels': texts, 'reason': 'No closed valid nonzero polygon'})
            continue
        item = {'record_id': record_id, 'label': texts[0] if texts else '', 'name': ' / '.join(texts[1:]) or None,
                'labels': texts, 'polygons': polygons, 'area_source_units': sum(polygon_area(p) for p in polygons)}
        if labels[record_id]: item['label_at'] = labels[record_id][0]['at']
        spaces.append(item)
    outline_rings = [ring for (layer, record_id), rings in records.items()
                     if layer == 'triGrossAreaLayer' and (expected_floor_record_id is None or record_id == str(expected_floor_record_id)) for ring in rings]
    outline = []
    for polygon in rings_to_polygons(outline_rings):
        issues = polygon_issues(polygon)
        if issues: warnings.append({'record_id': str(expected_floor_record_id), 'reason': 'Invalid source floor boundary omitted', 'issues': issues})
        else: outline.append(polygon)
    all_points = [p for polygon in outline for p in polygon['outer']]
    if not all_points: all_points = [p for space in spaces for polygon in space['polygons'] for p in polygon['outer']]
    bounds = [min(p[0] for p in all_points), min(p[1] for p in all_points), max(p[0] for p in all_points), max(p[1] for p in all_points)] if all_points else None
    return {'spaces': spaces, 'rejected_spaces': rejected_spaces, 'outline': outline, 'bounds': bounds, 'warnings': warnings,
            'evidence': {'svg_path': str(path.resolve()), 'sha256': hashlib.sha256(data).hexdigest(),
                         'gross_record_ids': sorted(gross_ids), 'view_box': numbers(root.get('viewBox')),
                         'coordinate_frame': 'SVG user coordinates after all ancestor and element transforms; viewport/viewBox is not fitted.',
                         'physical_unit': None, 'north_degrees': None,
                         'boundary_cumulative_matrices': [list(m) for m in sorted(transforms)],
                         'unique_boundary_elements': dict(counts),
                         'curve_tolerance_source_units': curve_tolerance,
                         'floor_boundary_layer': 'triGrossAreaLayer', 'room_boundary_layer': 'triSpaceLayer',
                         'label_binding': 'tri-record-id from label groups; no nearest-neighbor label matching',
                         'topology': 'Crossings/touches noded; repeated CAD bridges split into loops; nested loops retained as holes; duplicate display/interactive layers removed.',
                         'precision_cleanup': 'Collinear zero-area spurs and adjacent endpoints within max(0.0001, extent*1e-8) source units are removed; split-loop retrace spurs use 0.002 source units. No buffer or convex hull is used.'}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('svg', type=Path)
    parser.add_argument('--floor-record-id')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = parse_svg(args.svg, args.floor_record_id)
    encoded = json.dumps(result, ensure_ascii=False, indent=2)+'\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(encoded, encoding='utf-8')
    else: print(encoded)

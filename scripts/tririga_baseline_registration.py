"""Evidence-gated similarity registration into a retained Facilities frame.

This supplies an optional *building reference* transform. It must not be used
to resize every floor independently. Other floors should keep their CAD rigid
registration to that reference; source_scale_consistency reports unit conflicts.
The old frame is approximate, so this never establishes surveyed meters/north.
"""
import math
from collections import defaultdict
from itertools import combinations

import numpy as np

from tririga_registration import centroid, polygon_area


def _space_center(polygons):
    areas = np.asarray([polygon_area(p) for p in polygons])
    if not len(areas) or np.any(areas <= 0) or not np.all(np.isfinite(areas)):
        return None
    points = np.asarray([centroid(p) for p in polygons])
    return (points * areas[:, None]).sum(axis=0) / areas.sum(), float(areas.sum())


def _similarity(a, b, reflection=None):
    ac, bc = a - a.mean(axis=0), b - b.mean(axis=0)
    denominator = np.sum(ac * ac)
    if denominator < 1e-12:
        return None
    u, singular, vt = np.linalg.svd(ac.T @ bc)
    correction = np.eye(2)
    if reflection is not None and (np.linalg.det(u @ vt) < 0) != reflection:
        correction[1, 1] = -1
    matrix = (u @ correction @ vt).T
    scale = np.sum(singular * np.diag(correction)) / denominator
    if scale <= 0:
        return None
    matrix *= scale
    shift = b.mean(axis=0) - a.mean(axis=0) @ matrix.T
    return matrix, shift


def _noncollinear(a):
    if len(a) < 3:
        return False
    singular = np.linalg.svd(a - a.mean(axis=0), compute_uv=False)
    return singular[0] > 1e-10 and singular[1] / singular[0] > .03


def _robust_training_fit(a, b, span):
    candidates = []
    initial = _similarity(a, b)
    if initial:
        candidates.append(initial)
    pairs = list(combinations(range(len(a)), 2))
    # Deterministic bounded search; sampling depends only on sorted exact labels.
    stride = max(1, math.ceil(len(pairs) / 300))
    for i, j in pairs[::stride]:
        if np.linalg.norm(b[i] - b[j]) < span * .15:
            continue
        for reflection in (False, True):
            fit = _similarity(a[[i, j]], b[[i, j]], reflection)
            if fit:
                candidates.append(fit)
    best = None
    for matrix, shift in candidates:
        residuals = np.linalg.norm(a @ matrix.T + shift - b, axis=1) / span
        inliers = residuals <= .01
        if inliers.sum() < 3 or not _noncollinear(a[inliers]):
            continue
        score = (int(inliers.sum()), -float(np.mean(residuals[inliers])))
        if best is None or score > best[0]:
            best = (score, inliers)
    if best is None:
        return None
    inliers = best[1]
    result = _similarity(a[inliers], b[inliers])
    if result is None:
        return None
    return (*result, inliers)


def _fit_floor(source, old_floor):
    old = defaultdict(list)
    for room in old_floor.get('rooms', []):
        label = room.get('label', '')
        if label and not label.startswith('('):
            old[label].append(room)
    labels = sorted(k for k in source.keys() & old.keys() if len(source[k]) == len(old[k]) == 1)
    if len(labels) < 4:
        return None
    source_data = [_space_center(source[k][0]['polygons']) for k in labels]
    if any(s is None for s in source_data):
        return None
    a = np.asarray([s[0] for s in source_data])
    b = np.asarray([centroid(old[k][0]['footprint']) for k in labels])
    source_area = np.asarray([s[1] for s in source_data])
    old_area = np.asarray([polygon_area(old[k][0]['footprint']) for k in labels])
    if not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)) or np.any(old_area <= 0):
        return None
    if not _noncollinear(a) or not _noncollinear(b):
        return None
    # A moved historical room must not inflate the denominator and make every
    # residual look small. For larger inventories trim the extreme ten percent.
    span = float(np.linalg.norm(np.quantile(b, .9, axis=0) - np.quantile(b, .1, axis=0))) if len(labels) >= 8 else float(np.linalg.norm(np.ptp(b, axis=0)))
    # Labels at every fourth position are reserved before candidate fitting.
    holdout = np.asarray([i for i in range(len(labels)) if i % 4 == 0])
    train = np.asarray([i for i in range(len(labels)) if i % 4 != 0])
    if not _noncollinear(a[train]) or not _noncollinear(b[train]):
        return None
    fit = _robust_training_fit(a[train], b[train], span)
    if fit is None:
        return None
    matrix, shift, train_inliers = fit
    if np.mean(train_inliers) < .75:
        return None
    residuals = np.linalg.norm(a @ matrix.T + shift - b, axis=1) / span
    # Do not discard validation outliers after seeing their results.
    if float(np.max(residuals[holdout])) > .01:
        return None
    inliers = residuals <= .01
    if inliers.sum() < 4 or np.mean(inliers) < .75 or not _noncollinear(a[inliers]):
        return None
    determinant = float(np.linalg.det(matrix))
    ratios = old_area / (source_area * abs(determinant))
    median_ratio = float(np.median(ratios[inliers]))
    area_agreement = (ratios[inliers] >= .85) & (ratios[inliers] <= 1.15)
    if not .9 <= median_ratio <= 1.1 or np.mean(area_agreement) < .75:
        return None
    scale = math.sqrt(abs(determinant))
    evidence = {
        'method': 'unique-room-labels-into-retained-facilities-frame',
        'oldFloorId': old_floor['id'],
        'matchedLabels': labels,
        'inlierLabels': [k for k, keep in zip(labels, inliers) if keep],
        'excludedChangedLabels': [k for k, keep in zip(labels, inliers) if not keep],
        'matchedCount': len(labels), 'inlierCount': int(inliers.sum()),
        'inlierFraction': float(np.mean(inliers)),
        'matchedFractionOfSourceLabels': len(labels) / max(1, len(source)),
        'matchedFractionOfOldFloorLabels': len(labels) / max(1, len(old)),
        'meanResidualFraction': float(np.mean(residuals[inliers])),
        'maxResidualFraction': float(np.max(residuals[inliers])),
        'holdout': {'labels': [labels[i] for i in holdout], 'count': len(holdout),
                    'maxResidualFraction': float(np.max(residuals[holdout])),
                    'meanResidualFraction': float(np.mean(residuals[holdout])),
                    'thresholdFraction': .01},
        'medianAreaRatio': median_ratio,
        'areaAgreementFraction': float(np.mean(area_agreement)),
        'areaRatioP10P90': np.quantile(ratios[inliers], [.1, .9]).tolist(),
        'scale': scale,
        'rotationDeg': math.degrees(math.atan2(matrix[1, 0], matrix[0, 0])),
        'reflected': determinant < 0,
        'referenceSpan': span,
        'referenceSpanBasis': '10th-to-90th-percentile matched centers' if len(labels) >= 8 else 'matched-center extent',
        'limitations': [
            'Room geometry and relative building placement inherit the retained approximate Facilities frame; this is not an independent campus survey.',
            'The withheld-label check tests consistency with the old geometry; the old plans may share lineage with TRIRIGA.',
            'Use this as one source-building reference fit; do not independently resize every floor to its old layout.',
        ],
    }
    return {'matrix': matrix, 'shift': shift, 'oldFloorId': old_floor['id'], 'evidence': evidence}


def registration_to_baseline(parsed, old_layout, floor_hint=None):
    """Return reliable source->baseline similarity, or None when unestablished.

    ``floor_hint`` is an optional exact baseline floor ID. A match needs at least
    four unique non-service labels spread in two dimensions, >=75% geometric
    inliers, near-unit transformed area ratios, and independent heldout centroid
    error <=1% of the matched-room span. Duplicate labels are never guessed.
    """
    source = defaultdict(list)
    for space in parsed.get('spaces', []):
        label = space.get('label', '')
        if label and not label.startswith('(') and space.get('polygons'):
            source[label].append(space)
    fits = []
    for floor in old_layout.get('floors', []):
        if floor_hint is not None and floor['id'] != floor_hint:
            continue
        fit = _fit_floor(source, floor)
        if fit:
            fits.append(fit)
    if not fits:
        return None
    fits.sort(key=lambda f: (-f['evidence']['inlierCount'], f['evidence']['holdout']['maxResidualFraction']))
    if len(fits) > 1 and fits[1]['evidence']['inlierCount'] >= .9 * fits[0]['evidence']['inlierCount']:
        # Similar confidence on two floors is an identity ambiguity, not a tie
        # to resolve by selecting the slightly smaller floating-point residual.
        return None
    return fits[0]


def source_scale_consistency(reference, candidate, tolerance=.02):
    """Audit unit consistency; never mutate, average or apply either transform.

    Rotation differences are recorded but not gated: CAD floors can be rotated
    on their individual sheets, which the separate rigid-registration gate must
    establish. A scale conflict requires explicit normalization evidence.
    """
    reference_scale = math.sqrt(abs(float(np.linalg.det(reference['matrix']))))
    candidate_scale = math.sqrt(abs(float(np.linalg.det(candidate['matrix']))))
    if reference_scale <= 0 or not np.isfinite(reference_scale + candidate_scale):
        return {'consistent': False, 'reason': 'Nonfinite or zero source scale.'}
    ratio = candidate_scale / reference_scale
    return {'consistent': abs(ratio - 1) <= tolerance,
            'referenceScale': reference_scale, 'candidateScale': candidate_scale,
            'candidateToReferenceScaleRatio': ratio, 'relativeDifference': abs(ratio - 1),
            'tolerance': tolerance,
            'note': 'A ratio near 2 or 0.5 is an export-unit conflict, not permission to silently resize a floor.'}

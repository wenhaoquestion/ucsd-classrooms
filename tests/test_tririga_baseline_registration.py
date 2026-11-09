"""Run: python -m unittest discover -s tests -p test_tririga_baseline_registration.py"""
import copy
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from tririga_baseline_registration import registration_to_baseline, source_scale_consistency
from tririga_registration import transform_polygons


def rectangle(x, y, width=2, height=1):
    return {'outer': [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]}


def fixture(count=12):
    theta = .35
    matrix = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]]) * .0254
    shift = np.array([12., -9.])
    spaces, rooms = [], []
    for i in range(count):
        polygon = rectangle((i % 4) * 6, (i // 4) * 5, 2 + i * .04, 1 + i * .02)
        label = str(100 + i)
        spaces.append({'record_id': str(i), 'label': label, 'polygons': [polygon]})
        rooms.append({'id': label, 'label': label, 'footprint': transform_polygons([polygon], matrix, shift)[0]})
    return {'spaces': spaces}, {'floors': [{'id': 'L1', 'rooms': rooms}]}, matrix, shift


class BaselineRegistrationTests(unittest.TestCase):
    def test_recovers_similarity_and_independent_holdouts(self):
        parsed, old, matrix, shift = fixture()
        result = registration_to_baseline(parsed, old)
        self.assertIsNotNone(result)
        np.testing.assert_allclose(result['matrix'], matrix, atol=1e-10)
        np.testing.assert_allclose(result['shift'], shift, atol=1e-10)
        self.assertEqual(result['evidence']['holdout']['count'], 3)
        self.assertLess(result['evidence']['holdout']['maxResidualFraction'], 1e-10)
        self.assertAlmostEqual(result['evidence']['medianAreaRatio'], 1)

    def test_rejects_three_anchors_and_collinear_cloud(self):
        parsed, old, _, _ = fixture(3)
        self.assertIsNone(registration_to_baseline(parsed, old))
        parsed, old, _, _ = fixture(4)
        self.assertIsNone(registration_to_baseline(parsed, old))

    def test_four_spread_anchors_can_pass(self):
        parsed, old, matrix, shift = fixture(8)
        keep = [0, 1, 4, 5]
        parsed['spaces'] = [parsed['spaces'][i] for i in keep]
        old['floors'][0]['rooms'] = [old['floors'][0]['rooms'][i] for i in keep]
        result = registration_to_baseline(parsed, old)
        self.assertIsNotNone(result)
        self.assertEqual(result['evidence']['inlierCount'], 4)
        np.testing.assert_allclose(result['matrix'], matrix, atol=1e-10)
        np.testing.assert_allclose(result['shift'], shift, atol=1e-10)

    def test_service_labels_and_duplicates_are_not_anchors(self):
        parsed, old, _, _ = fixture(8)
        for i in range(5):
            parsed['spaces'][i]['label'] = '(MS)' + parsed['spaces'][i]['label']
        self.assertIsNone(registration_to_baseline(parsed, old))
        parsed, old, _, _ = fixture()
        parsed['spaces'].extend(copy.deepcopy(parsed['spaces']))
        self.assertIsNone(registration_to_baseline(parsed, old))

    def test_rejects_matching_centers_with_wrong_room_areas(self):
        parsed, old, _, _ = fixture()
        for room in old['floors'][0]['rooms']:
            p = np.asarray(room['footprint']['outer'])
            c = p.mean(axis=0)
            room['footprint']['outer'] = (c + (p - c) * 2).tolist()
        self.assertIsNone(registration_to_baseline(parsed, old))

    def test_changed_training_room_is_recorded_as_outlier(self):
        parsed, old, matrix, _ = fixture()
        old['floors'][0]['rooms'][5]['footprint']['outer'] = (np.asarray(old['floors'][0]['rooms'][5]['footprint']['outer']) + [2, 2]).tolist()
        result = registration_to_baseline(parsed, old)
        self.assertIsNotNone(result)
        self.assertIn('105', result['evidence']['excludedChangedLabels'])
        np.testing.assert_allclose(result['matrix'], matrix, atol=1e-10)

    def test_heldout_failure_is_not_hidden_as_outlier(self):
        parsed, old, _, _ = fixture()
        old['floors'][0]['rooms'][4]['footprint']['outer'] = (np.asarray(old['floors'][0]['rooms'][4]['footprint']['outer']) + [.5, .5]).tolist()
        self.assertIsNone(registration_to_baseline(parsed, old))

    def test_ambiguous_floor_requires_explicit_hint(self):
        parsed, old, _, _ = fixture()
        old['floors'].append(copy.deepcopy(old['floors'][0]))
        old['floors'][1]['id'] = 'L2'
        self.assertIsNone(registration_to_baseline(parsed, old))
        self.assertEqual(registration_to_baseline(parsed, old, 'L2')['oldFloorId'], 'L2')

    def test_scale_conflict_is_reported_not_normalized(self):
        parsed, old, _, _ = fixture()
        reference = registration_to_baseline(parsed, old)
        candidate = copy.deepcopy(reference)
        candidate['matrix'] *= 2
        result = source_scale_consistency(reference, candidate)
        self.assertFalse(result['consistent'])
        self.assertAlmostEqual(result['candidateToReferenceScaleRatio'], 2)
        self.assertTrue(source_scale_consistency(reference, reference)['consistent'])


if __name__ == '__main__':
    unittest.main()

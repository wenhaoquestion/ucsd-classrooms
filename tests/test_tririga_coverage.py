"""Run: python -m unittest discover -s tests -p test_tririga_coverage.py"""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('coverage_audit', Path(__file__).resolve().parents[1]/'scripts/audit-tririga-coverage.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def layout():
    return {'floors': [{'id': 'L1', 'rooms': [{'id': 'r1', 'floor': 'L1', 'label': '001', 'scheduleKey': '001',
            'footprint': {'outer': [[0, 0], [2, 0], [2, 1], [0, 1]]}}],
            'unplaced': [{'label': '2', 'scheduleKey': '2', 'basis': 'floor-listing'}]}],
            'scheduleAliases': [{'scheduleKey': 'AUD', 'room': 'r1'}],
            'knownUnmapped': [{'scheduleKey': 'UNK', 'reason': 'No source.'}]}


class CoverageTests(unittest.TestCase):
    def test_exact_keys_aliases_and_categories(self):
        index = audit.index_layout(layout())
        self.assertEqual(audit.classify(index, '001')['category'], 'placed')
        self.assertEqual(audit.classify(index, 'AUD')['roomId'], 'r1')
        self.assertEqual(audit.classify(index, '2')['category'], 'floorListed')
        self.assertTrue(audit.classify(index, 'UNK')['registered'])
        self.assertFalse(audit.classify(index, '1')['registered'])
        self.assertEqual(audit.classify(None, '001')['category'], 'no-layout')

    def test_printed_label_does_not_create_schedule_mapping(self):
        data = layout()
        data['floors'][0]['rooms'][0]['scheduleKey'] = None
        data['scheduleAliases'] = []
        self.assertFalse(audit.classify(audit.index_layout(data), '001')['registered'])

    def test_unknown_alias_and_duplicate_schedule_keys_fail(self):
        data = layout()
        data['scheduleAliases'][0]['room'] = 'absent'
        with self.assertRaises(ValueError):
            audit.index_layout(data)
        data = layout()
        duplicate = copy.deepcopy(data['floors'][0]['rooms'][0])
        duplicate['id'] = 'r2'
        data['floors'][0]['rooms'].append(duplicate)
        with self.assertRaises(ValueError):
            audit.index_layout(data)

    def test_lost_position_and_missing_record_are_separate(self):
        inventory = {'X': {'001': {'category': 'placed'}, '2': {'category': 'placed'}, 'GONE': {'category': 'unmapped'}}}
        result = audit.compare_inventory(inventory, {'X': audit.index_layout(layout())})
        self.assertEqual([r['key'] for r in result['lostPositionedKeys']], ['2'])
        self.assertEqual([r['key'] for r in result['missingRegisteredKeys']], ['GONE'])
        self.assertEqual(result['registeredKeys'], 2)

    def test_invalid_polygon_cannot_count_as_positioned(self):
        data = layout()
        data['floors'][0]['rooms'][0]['footprint']['outer'] = [[0, 0], [1, 1], [2, 2]]
        with self.assertRaises(ValueError):
            audit.index_layout(data)

    def test_source_records_are_distinct_from_display_floor_views(self):
        data = layout()
        data['sources'] = [{'id': 's', 'title': 'Source', 'tririga': {'floorRecordId': 'f', 'buildingRecordId': 'b', 'drawingId': 'd'}}]
        data['floors'][0]['sources'] = [{'source': 's'}]
        second = copy.deepcopy(data['floors'][0])
        second['id'] = 'L1M'
        data['floors'].append(second)
        records = audit.source_floor_records(data)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['displayFloorIds'], ['L1', 'L1M'])

    def test_partial_conversion_corrections_are_not_invented(self):
        self.assertEqual(audit.named_events(None, 'sourceUnitCorrection'), [])
        evidence = {'floors': [{'registration': {'sourceUnitCorrection': {'factor': .5}}}]}
        self.assertEqual(audit.named_events(evidence, 'sourceUnitCorrection'), [{'factor': .5}])


if __name__ == '__main__':
    unittest.main()

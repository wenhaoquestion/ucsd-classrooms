"""Conversion invariants; fixtures are synthetic, not authenticated drawings.

Run: python -m unittest discover -s tests -p test_tririga_svg.py
"""
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from tririga_svg import (parse_svg, parse_transform, path_rings, polygon_area,
                         polygon_issues, rings_to_polygons, transform_point)


class TririgaSvgTests(unittest.TestCase):
    def parse(self, content, **kwargs):
        data = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 -50 200 100">'+content+'</svg>').encode('utf-8')
        with patch.object(Path, 'read_bytes', return_value=data):
            return parse_svg(Path('synthetic.svg'), **kwargs)

    def test_svg_transform_order_and_rotation_center(self):
        matrix = parse_transform('translate(10 20) scale(2 3) rotate(90)')
        x, y = transform_point(matrix, [1, 0])
        self.assertAlmostEqual(x, 10); self.assertAlmostEqual(y, 23)
        x, y = transform_point(parse_transform('rotate(90 10 20)'), [11, 20])
        self.assertAlmostEqual(x, 10); self.assertAlmostEqual(y, 21)

    def test_nested_transform_and_record_bound_labels(self):
        result = self.parse('''<g transform="translate(10 20)"><g id="triSpaceLayer" transform="scale(2)">
          <polygon tri-record-id="101" points="0,0 5,0 5,5 0,5"/></g>
          <g id="==LabelsLayer" transform="scale(2)"><g tri-record-id="101"><text x="2" y="3">001A</text><text>-</text><text>Seminar</text></g></g></g>''')
        room = result['spaces'][0]
        self.assertEqual(room['label'], '001A'); self.assertEqual(room['name'], 'Seminar')
        self.assertEqual(room['label_at'], [14, 26])
        self.assertEqual(room['polygons'][0]['outer'][0], [10, 20])
        self.assertEqual(room['area_source_units'], 100)
        self.assertEqual(result['bounds'], [10, 20, 20, 30])

    def test_viewbox_is_not_used_to_recenter_or_scale(self):
        result = self.parse('<g id="triSpaceLayer"><polygon tri-record-id="1" points="500,600 510,600 510,610 500,610"/></g>')
        self.assertEqual(result['bounds'], [500, 600, 510, 610])
        self.assertIsNone(result['evidence']['physical_unit'])

    def test_duplicate_display_and_interactive_layers_are_one_space(self):
        geometry = '<g id="triSpaceLayer"><polyline tri-record-id="1" points="0,0 10,0 10,10 0,10 0,0"/></g>'
        result = self.parse(geometry+geometry)
        self.assertEqual(len(result['spaces']), 1)
        self.assertEqual(result['spaces'][0]['area_source_units'], 100)
        self.assertEqual(result['evidence']['unique_boundary_elements']['polyline'], 1)

    def test_floor_identity_rejects_wrong_gross_record(self):
        content = '<g id="triGrossAreaLayer"><polygon tri-record-id="900" points="0,0 10,0 10,10 0,10"/></g>'
        with self.assertRaisesRegex(ValueError, 'Expected floor record 901'):
            self.parse(content, expected_floor_record_id='901')
        self.assertEqual(len(self.parse(content, expected_floor_record_id='900')['outline']), 1)

    def test_no_nearest_label_matching_or_furniture_inclusion(self):
        result = self.parse('''<g id="A-WALL"><polygon tri-record-id="2" points="0,0 100,0 100,100 0,100"/></g>
          <g id="triSpaceLayer"><polygon tri-record-id="1" points="0,0 10,0 10,10 0,10"/></g>
          <g id="==LabelsLayer"><g tri-record-id="2"><text x="5" y="5">999</text></g></g>''')
        self.assertEqual(len(result['spaces']), 1)
        self.assertEqual(result['spaces'][0]['label'], '')
        self.assertEqual(result['spaces'][0]['area_source_units'], 100)

    def test_index_labels_fill_text_only_and_keep_leading_zero(self):
        result = self.parse('<g id="triSpaceLayer"><polygon tri-record-id="1" points="0,0 10,0 10,10 0,10"/></g>',
                            label_detail={'room_labels': {'1': ['001'], '2': ['999']}})
        self.assertEqual(result['spaces'][0]['label'], '001')
        self.assertEqual(len(result['spaces']), 1)

    def test_hole_and_nested_island_keep_area_and_topology(self):
        rings = [[[0,0],[10,0],[10,10],[0,10]], [[2,2],[8,2],[8,8],[2,8]], [[4,4],[6,4],[6,6],[4,6]]]
        polygons = rings_to_polygons(rings)
        self.assertEqual(len(polygons), 2)
        self.assertEqual(len(polygons[0]['holes']), 1)
        self.assertEqual(sum(polygon_area(p) for p in polygons), 68)
        self.assertTrue(all(not polygon_issues(p) for p in polygons))

    def test_cad_bridge_to_hole_is_not_filled(self):
        ring = [[0,0],[10,0],[10,10],[0,10],[0,0],[2,2],[2,8],[8,8],[8,2],[2,2],[0,0]]
        polygons = rings_to_polygons([ring])
        self.assertEqual(len(polygons), 1); self.assertEqual(polygon_area(polygons[0]), 64)
        self.assertFalse(polygon_issues(polygons[0]))

    def test_bridge_attaching_to_middle_of_edge_is_noded(self):
        ring = [[0,0],[10,0],[10,10],[0,10],[0,5],[3,5],[3,7],[5,7],[5,3],[3,3],[3,5],[0,5]]
        polygons = rings_to_polygons([ring])
        self.assertEqual(sum(polygon_area(p) for p in polygons), 92)
        self.assertTrue(all(not polygon_issues(p) for p in polygons))

    def test_crossed_path_is_split_without_hull_or_buffer(self):
        polygons = rings_to_polygons([[[0,0],[10,10],[0,10],[10,0]]])
        self.assertEqual(len(polygons), 2)
        self.assertAlmostEqual(sum(polygon_area(p) for p in polygons), 50)
        self.assertTrue(all(not polygon_issues(p) for p in polygons))

    def test_open_polyline_is_reported_instead_of_inventing_closing_wall(self):
        result = self.parse('<g id="triSpaceLayer"><polyline tri-record-id="1" points="0,0 10,0 10,10"/></g>')
        self.assertFalse(result['spaces'])
        self.assertIn('Open polyline', result['warnings'][0]['reason'])

    def test_relative_path_commands_and_curves(self):
        polygons = rings_to_polygons(path_rings('m 2 3 h 10 v 10 h -10 z'))
        self.assertEqual(polygon_area(polygons[0]), 100)
        curved = path_rings('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0 L 0 0 Z')
        self.assertGreater(len(curved[0]), 8)
        self.assertTrue(all(not polygon_issues(p) for p in rings_to_polygons(curved)))

    def test_arc_endpoint_and_area(self):
        ring = path_rings('M 10 0 A 10 10 0 1 1 -10 0 A 10 10 0 1 1 10 0 Z', .01)[0]
        polygons = rings_to_polygons([ring])
        self.assertLess(abs(polygon_area(polygons[0])-math.pi*100), .5)
        self.assertFalse(polygon_issues(polygons[0]))

    def test_numeric_zero_area_spur_does_not_become_a_runtime_crossing(self):
        ring = [[0,0],[10,0],[10,10],[5,10],[5.000002,8],[5,9],[0,9]]
        polygons = rings_to_polygons([ring])
        self.assertTrue(all(not polygon_issues(p) for p in polygons))
        self.assertTrue(all(not polygon_issues({'outer': [[x*.02,y*.02] for x,y in p['outer']]}) for p in polygons))

    def test_split_hole_retrace_tail_does_not_touch_outer_boundary(self):
        outer = [[0,0],[100,0],[100,100],[0,100]]
        hole = [[40,30],[40,10],[20,10],[20,40],[40,40],[40,30.0013],[100,30]]
        polygons = rings_to_polygons([outer,hole])
        self.assertEqual(len(polygons),1)
        self.assertEqual(len(polygons[0]['holes'][0]),4)
        self.assertAlmostEqual(polygon_area(polygons[0]),9400)
        self.assertFalse(polygon_issues(polygons[0]))


if __name__ == '__main__':
    unittest.main()

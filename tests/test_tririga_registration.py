"""Registration evidence tests use synthetic floor shapes only."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from tririga_registration import candidate_angles, cores, register, rotation, transform_polygons


def rectangle(x, y, width, height):
    return {'outer': [[x,y],[x+width,y],[x+width,y+height],[x,y+height]]}


def core(record, label, x, y):
    return {'record_id': record, 'label': label, 'polygons': [rectangle(x,y,10,10)]}


class RegistrationTests(unittest.TestCase):
    def test_same_slab_with_different_void_and_one_identified_core(self):
        fixed = {'outline': [{**rectangle(0,0,1000,600), 'holes': [rectangle(200,100,600,400)['outer']]}],
                 'spaces': [core('1','(CE)GA1001A',20,80)]}
        moving = {'outline': [rectangle(0,0,1000,600)], 'spaces': [core('2','(CE)GA2001A',20,80)]}
        fit = register(moving, fixed)
        self.assertIsNotNone(fit)
        self.assertAlmostEqual(fit['evidence']['rotationDeg'], 0)
        self.assertEqual(fit['evidence']['acceptanceEvidence'], 'matching-slab-and-identical-core')
        self.assertLess(np.linalg.norm(fit['shift']), 5)

    def test_smaller_upper_floor_keeps_two_exact_named_cores(self):
        fixed = {'outline': [rectangle(0,0,1000,1000)], 'spaces': [core('1','(CE)100A',50,80),core('2','(CS)100B',50,130)]}
        moving = {'outline': [rectangle(0,0,1000,400)], 'spaces': [core('3','(CE)200A',50,80),core('4','(CS)200B',50,130)]}
        fit = register(moving, fixed)
        self.assertIsNotNone(fit)
        self.assertAlmostEqual(fit['evidence']['rotationDeg'], 0)
        self.assertLess(np.linalg.norm(fit['shift']), 1)
        self.assertEqual(len(fit['evidence']['anchors']), 2)

    def test_symmetric_outline_without_cores_does_not_prove_orientation(self):
        floor = {'outline': [rectangle(0,0,1000,1000)], 'spaces': []}
        self.assertIsNone(register(floor, floor))

    def test_large_unit_mismatch_is_never_fitted_by_floor_scaling(self):
        fixed = {'outline': [rectangle(0,0,1000,600)], 'spaces': []}
        moving = {'outline': [rectangle(0,0,12000,7200)], 'spaces': []}
        self.assertIsNone(register(moving, fixed))

    def test_noncardinal_rotation_requires_unique_named_core_pairs(self):
        moving = {'spaces': [core('1','(CE)100A',20,30),core('2','(CS)100B',800,500)]}
        fixed = {'spaces': [core('3','(CE)299X',20,30),core('4','(CS)299Y',800,500)]}
        self.assertEqual(candidate_angles(cores(moving),cores(fixed),1200), [0.,90.,180.,270.])

    def test_unique_cores_recover_a_real_noncardinal_rotation(self):
        moving = {'outline': [{'outer': [[0,0],[1000,0],[1000,600],[700,600],[700,400],[0,400]]}],
                  'spaces': [core('1','(CE)100A',100,100),core('2','(CS)100B',850,450)]}
        rot, shift = rotation(37), np.asarray([40.,-25.])
        fixed = {'outline': transform_polygons(moving['outline'],rot,shift), 'spaces': []}
        for space in moving['spaces']:
            fixed['spaces'].append({**space,'record_id':'fixed-'+space['record_id'],
                'label':space['label'].replace('100','200'),
                'polygons':transform_polygons(space['polygons'],rot,shift)})
        fit = register(moving,fixed)
        self.assertIsNotNone(fit)
        self.assertAlmostEqual(fit['evidence']['rotationDeg'],37,places=5)
        self.assertLess(np.linalg.norm(fit['shift']-shift),1e-6)

    def test_changing_slab_cannot_pull_exact_elevator_frame(self):
        fixed={'outline':[rectangle(0,0,1000,600)],'spaces':[
            core('1','(CE)100A',100,100),core('2','(CE)100B',100,200),core('3','(CE)100C',850,300)]}
        moving={'outline':[rectangle(0,20,1000,600)],'spaces':[
            core('4','(CE)200A',100,100),core('5','(CE)200B',100,200),core('6','(CE)200C',850,300)]}
        fit=register(moving,fixed)
        self.assertIsNotNone(fit)
        self.assertTrue(fit['evidence']['exactElevatorFrame'])
        self.assertLess(np.linalg.norm(fit['shift']),1e-8)

    def test_nearby_stair_seed_does_not_suppress_exact_elevator_translation(self):
        fixed={'outline':[rectangle(0,0,1000,600)],'spaces':[
            core('1','(CS)100A',100,100),core('2','(CE)100B',200,100),core('3','(CE)100C',800,100)]}
        moving={'outline':[rectangle(0,0,1000,600)],'spaces':[
            core('4','(CS)200A',99.8,100),core('5','(CE)200B',200,100),core('6','(CE)200C',800,100)]}
        fit=register(moving,fixed)
        self.assertIsNotNone(fit)
        self.assertTrue(fit['evidence']['exactElevatorFrame'])
        self.assertLess(np.linalg.norm(fit['shift']),1e-8)


if __name__ == '__main__': unittest.main()

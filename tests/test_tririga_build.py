"""Semantic checks for source floor identities and unchanged schedule inventory."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
spec = importlib.util.spec_from_file_location('tririga_build',Path(__file__).resolve().parents[1]/'scripts/build-tririga-indoor.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SourceFloorSemantics(unittest.TestCase):
    def test_numpy_evidence_flags_remain_json_booleans(self):
        encoded=json.dumps({'exactElevators':np.bool_(True),'distance':np.float64(0)},default=builder.json_native)
        self.assertEqual(json.loads(encoded),{'exactElevators':True,'distance':0})

    def floor(self,name,ordinal='999'):
        return builder.level({'floor_name':name,'floor_record_id':'42','floor_level':ordinal})

    def test_ordinal_is_not_elevation(self):
        self.assertEqual(self.floor('First Floor','3'),('L1','1',0.))
        self.assertEqual(self.floor('Basement 2','1'),('B2','B2',-2.))

    def test_named_intermediate_levels_do_not_overlap_full_floor(self):
        self.assertEqual(self.floor('First Floor Mezzanine'),('L1M','1M',.5))
        self.assertEqual(self.floor('Second Partial Floor'),('L2P','2P',1.5))
        self.assertEqual(self.floor('Fourth Partial Floor'),('L4P','4P',3.5))
        self.assertEqual(self.floor('Mezzanine'),('M','M',-.5))

    def test_roof_records_remain_distinct(self):
        self.assertNotEqual(self.floor('Roof 1')[2],self.floor('Roof 2')[2])
        self.assertEqual(self.floor('Roof 2')[0],'R2')

    def test_unknown_level_is_not_guessed_from_sort_ordinal(self):
        self.assertIsNone(self.floor('Interstitial Floor','4')[2])

    def test_exact_keys_and_prior_aliases_are_counted(self):
        room={'id':'geometry','scheduleKey':'AUD'}
        floor={'id':'L1','rooms':[room],'unplaced':[{'scheduleKey':'010','basis':'floor-listing'}]}
        placed,unplaced,missing=builder.mapping_keys({'floors':[floor],
            'scheduleAliases':[{'scheduleKey':'A','room':'geometry'}],'knownUnmapped':[{'scheduleKey':'012','reason':'no source'}]})
        self.assertEqual(set(placed),{'AUD','A'})
        self.assertEqual(set(unplaced),{'010'})
        self.assertEqual(set(missing),{'012'})


if __name__=='__main__':
    unittest.main()

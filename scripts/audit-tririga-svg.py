#!/usr/bin/env python3
"""Audit parser coverage for every explicitly mapped local TRIRIGA floor."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from tririga_svg import parse_svg


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, default=root.parent/'artifacts/tririga-floorplans/index.json')
    parser.add_argument('--mapping', type=Path, default=root/'data/indoor/tririga/building-mapping.json')
    parser.add_argument('--output', type=Path, default=root/'data/indoor/tririga/svg-parser-audit.json')
    args = parser.parse_args()
    index_bytes = args.index.read_bytes(); mapping_bytes = args.mapping.read_bytes()
    index, mapping = json.loads(index_bytes), json.loads(mapping_bytes)
    ids = {f['id'] for entry in mapping['entries'] if entry['status']=='mapped'
           for source in entry['sourceBuildings'] for f in source['floors'] if f['status']=='exported'}
    rows = []
    for record in index['records']:
        if record.get('floor_record_id') not in ids: continue
        row = {'building': record['building_name'], 'floor': record['floor_name'],
               'floorRecordId': record['floor_record_id'], 'drawingId': record['drawing_id']}
        try:
            result = parse_svg(args.index.parent/record['svg_path'], record['floor_record_id'], record['label_detail'])
            row.update({'spaces': len(result['spaces']), 'rejectedSpaces': result['rejected_spaces'],
                        'outlineParts': len(result['outline']), 'warnings': result['warnings']})
        except (ValueError, OSError) as error:
            row['error'] = str(error)
        rows.append(row)
    report = {'schemaVersion': 1, 'sourceIndex': str(args.index.resolve()),
              'sourceIndexSha256': hashlib.sha256(index_bytes).hexdigest(),
              'mappingSha256': hashlib.sha256(mapping_bytes).hexdigest(),
              'parserSha256': hashlib.sha256((root/'scripts/tririga_svg.py').read_bytes()).hexdigest(),
              'floors': len(rows), 'spaces': sum(r.get('spaces', 0) for r in rows),
              'floorsWithWarnings': sum(bool(r.get('warnings') or r.get('error')) for r in rows),
              'warningReasons': dict(Counter(w['reason'] for r in rows for w in r.get('warnings', []))),
              'records': rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k != 'records'}, indent=2))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""List, verify, or re-acquire reviewed public FIS rasters at native resolution.

Only floor images already acquired through the official classroom viewer are
eligible. No credentials or discovery of protected endpoints are used. Pillow
is needed for download/assembly, but not for --list or --verify.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from io import BytesIO
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'data/indoor/research/public-fis-raster-sources.json'


def tile(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'UCSD-Classroom-Explorer-source-acquisition/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:
        if not response.headers.get_content_type().startswith('image/'):
            raise ValueError('Tile requires login or is unavailable; acquisition stopped.')
        body = response.read(2 * 1024 * 1024 + 1)
    if len(body) > 2 * 1024 * 1024 or not body.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Expected a PNG tile no larger than 2 MiB.')
    return body


def acquire(source, destination):
    from PIL import Image
    width, height = source['nativeImageSize']
    if width * height > 100_000_000:
        raise ValueError('Unexpected image dimensions; review the source catalog.')
    base = source['tileBase']
    if not base.startswith('https://facilities.ucsd.edu/tdb/Buildings/'):
        raise ValueError('Expected the reviewed official tile host.')
    level = source['zoom'] - 1
    # Verify access before requesting a grid. Login HTML must never become a PNG.
    first = tile(f'{base}_BASE/{level}/0/0.png')
    canvas = Image.new('RGBA', (width, height), 'white')
    for layer in source['layers']:
        def fetch(position):
            row, col = position
            body = first if layer == '_BASE' and row == col == 0 else tile(f'{base}{layer}/{level}/{row}/{col}.png')
            return row, col, body
        positions = [(row, col) for row in range((height + 255) // 256) for col in range((width + 255) // 256)]
        # Work in small batches: at most four in-flight requests even on failure.
        with ThreadPoolExecutor(max_workers=4) as pool:
            for offset in range(0, len(positions), 4):
                for row, col, body in pool.map(fetch, positions[offset:offset + 4]):
                    with Image.open(BytesIO(body)) as part:
                        canvas.alpha_composite(part.convert('RGBA'), (col * 256, row * 256))
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.part.png')
    canvas.convert('RGB').save(temporary)
    temporary.replace(destination)
    record = {'id': source['id'], 'url': source['url'], 'nativeImageSize': [width, height],
              'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
              'note': 'PNG encoding may differ from the browser assembly. Review pixel equivalence before changing an approved trace hash.'}
    destination.with_suffix('.acquisition.json').write_text(json.dumps(record, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--list', action='store_true')
    mode.add_argument('--verify', action='store_true', help='Verify acquired local PNG hashes without network')
    mode.add_argument('--download', action='store_true', help='Re-acquire selected public rasters into a separate directory')
    parser.add_argument('--ids', nargs='+')
    parser.add_argument('--output', type=Path, default=ROOT / 'local/indoor-sources/reacquired')
    args = parser.parse_args()
    sources = [s for s in json.loads(CATALOG.read_text())['sources'] if s.get('status') == 'raster-acquired']
    if args.ids:
        missing = set(args.ids) - {s['id'] for s in sources}
        if missing:
            parser.error('No acquired public raster for: ' + ', '.join(sorted(missing)))
        sources = [s for s in sources if s['id'] in args.ids]
    for source in sources:
        if args.list:
            print(source['id'], source['nativeImageSize'], source['url'])
        elif args.verify:
            path = ROOT / source['file']
            if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
                raise ValueError('Source changed: ' + str(path))
            print('VERIFIED', source['id'])
        else:
            destination = args.output / (source['id'] + '.png')
            if destination.exists():
                raise FileExistsError('Preserving existing source: ' + str(destination))
            acquire(source, destination)
            print('ACQUIRED', source['id'])


if __name__ == '__main__':
    main()

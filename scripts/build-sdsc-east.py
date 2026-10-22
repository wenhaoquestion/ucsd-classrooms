#!/usr/bin/env python3
"""Build the exact E129 room trace in an independent, explicitly relative frame."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
TRACE = ROOT / 'data/indoor/SDSC/east-e129-trace.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    trace = json.loads(TRACE.read_text())
    source = trace['source']
    pdf = ROOT / source['localFile']
    assert sha(pdf) == source['sha256'], 'Public source PDF hash changed'
    assert pdf.stat().st_size == source['bytes']
    assert sha(ROOT / trace['originalBase']) == trace['originalBaseSha256']
    native = ROOT / source['image']['localFile']
    with tempfile.TemporaryDirectory(prefix='sdsc-e1-') as tmp:
        prefix = str(Path(tmp) / 'image')
        subprocess.run(['pdfimages', '-f', str(source['pdfPage']), '-l', str(source['pdfPage']),
                        '-png', str(pdf), prefix], check=True, capture_output=True)
        matches = [p for p in Path(tmp).glob('image-*.png') if sha(p) == source['image']['sha256']]
        assert len(matches) == 1, 'Expected exactly one matching native E1 plan image'
        raw = matches[0].read_bytes()
        with Image.open(matches[0]) as image:
            assert list(image.size) == source['image']['imageSizePx']
        native.write_bytes(raw)
    transform = trace['transform']
    assert transform['units'] == 'relative' and transform['rotationDeg'] == 0

    def point(p):
        return [round((p[k] - transform['originPx'][k]) * transform['scale'], 6) for k in range(2)]

    traced = trace['room']
    polygon = {'outer': [point(p) for p in traced['outerPx']]}
    ref = {'source': source['id'], 'page': source['pdfPage'], 'region': 'East E1 south wing, exact room E129'}
    recent = trace['supportingSource']
    room = {
        'id': traced['id'], 'label': traced['label'], 'scheduleKey': traced['scheduleKey'],
        'floor': traced['floor'], 'type': 'classroom', 'footprint': polygon,
        'labelAt': point(traced['labelPx']),
        'confidence': {'location': 'traced', 'shape': 'traced', 'label': 'direct'},
        'sources': [ref, {'source': recent['id']}], 'notes': traced['boundaryNotes'],
    }
    floor = {
        'id': traced['floor'], 'label': 'East E1 · E129 only', 'shortLabel': 'E1',
        'vertical': {'baseElevation': 0, 'height': 3, 'estimated': True,
                     'note': 'Display placeholders in relative units; no measured floor height or vertical registration.'},
        'outline': [polygon], 'outlineConfidence': 'traced', 'rooms': [room],
        'unplaced': [], 'areas': [], 'features': [], 'sources': [ref],
        'transforms': [{'source': source['id'], 'imageSizePx': source['image']['imageSizePx'],
                        'originPx': transform['originPx'], 'rotationDeg': 0,
                        'scale': transform['scale'], 'note': transform['note']}],
        'notes': ['Only the room E129 extent is available in this layout; the floor outline is this room boundary, not the building exterior.'],
    }
    layout = {
        'schemaVersion': 1, 'building': 'SDSC', 'name': 'San Diego Supercomputer Center',
        'geometryStatus': 'source-traced',
        'provenance': 'Room E129 traced from the numbered East E1 plan on page 24 of the official public SDSC Emergency Action Plan, updated September 2025. Exact schedule identity corroborated by the Fall 2025 Registrar listing.',
        'coordinateSystem': {'units': 'relative', 'description': transform['note'],
                             'northDeg': None, 'northNote': 'The source image has no north arrow; true north and campus orientation are unknown.'},
        'sources': [{
            'id': source['id'], 'title': source['title'], 'url': source['url'], 'localFile': source['localFile'],
            'publisher': 'UC San Diego San Diego Supercomputer Center', 'building': 'SDSC',
            'floors': [traced['floor']], 'page': source['pdfPage'], 'revision': source['revision'],
            'accessed': source['acquiredAt'][:10], 'imageRef': 'Native 989 × 811 image on physical PDF page 24',
            'scale': 'No verified physical scale; relative source-image coordinates only.',
            'notes': ['Official public document; the cover revision is September 2025, independent of the PDF creation date.',
                      'Source SHA-256: ' + source['sha256'],
                      'The plan distinguishes E129 on E1 from EB129 on EB1; the 2010 seminar floor assignment is superseded.'],
        }, {
            'id': recent['id'], 'title': recent['title'], 'url': recent['url'],
            'publisher': 'UC San Diego Registrar', 'building': 'SDSC', 'floors': [traced['floor']],
            'accessed': recent['accessed'], 'revision': 'Fall Quarter 2025', 'notes': [recent['use']],
        }],
        'floors': [floor], 'knownUnmapped': [], 'notes': trace['limitations'],
    }
    overlay_path = ROOT / 'local/indoor-sources/SDSC-EAP-PUBLIC-E129-trace-review.png'
    image = Image.open(native).convert('RGBA')
    layer = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(layer)
    ring = [tuple(p) for p in traced['outerPx']]
    draw.polygon(ring, fill=(0, 80, 220, 40))
    draw.line(ring + ring[:1], fill=(0, 80, 220, 255), width=2)
    Image.alpha_composite(image, layer).convert('RGB').save(overlay_path)
    report = {
        'schemaVersion': 1, 'building': 'SDSC', 'output': trace['outputLayout'],
        'addedScheduleKeys': ['E129'], 'floor': traced['floor'], 'printedRoomLabel': 'E129',
        'sourceDocumentSha256': source['sha256'], 'sourcePage': source['pdfPage'],
        'nativeImageSha256': source['image']['sha256'], 'nativeImageSizePx': source['image']['imageSizePx'],
        'roomSourcePolygonPx': traced['outerPx'], 'traceTolerancePx': traced['traceTolerancePx'],
        'coordinateSystem': layout['coordinateSystem'], 'physicalScaleVerified': False,
        'campusRegistration': False, 'entireFloorMapped': False,
        'historicalFloorConflict': trace['floorIdentity']['historicalConflict'],
        'overlay': str(overlay_path.relative_to(ROOT)), 'limitations': trace['limitations'],
        'inputHashes': {str(TRACE.relative_to(ROOT)): sha(TRACE), trace['originalBase']: trace['originalBaseSha256']},
    }
    # Build all evidence and output in memory before changing runtime data.
    encoded = json.dumps(layout, separators=(',', ':'), ensure_ascii=False) + '\n'
    subprocess.run(['node', 'scripts/build-sdsc-floor-listing.mjs'], cwd=ROOT, check=True)
    (ROOT / trace['outputLayout']).write_text(encoded)
    (ROOT / 'data/indoor/SDSC/east-e129-review.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print('SDSC E129 mapped on East E1; one traced room, relative units, no campus registration.')


if __name__ == '__main__':
    main()

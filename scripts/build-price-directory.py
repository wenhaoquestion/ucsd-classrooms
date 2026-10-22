#!/usr/bin/env python3
"""Correct Price Theater's floor from the official directory; keep it unplaced."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = 'static/indoor/facilities/PRICE.json'
PDF = 'local/indoor-sources/PRICE-DIRECTORIES-SU26.pdf'
PHOTO = 'local/indoor-sources/PRICE-THEATER-PLAN.jpg'
OUTPUT = 'static/indoor/PRICE-combined.json'
URL = 'https://universitycenters.ucsd.edu/_files/visit-us-files/PC_Directories11X17SU26__FNL.pdf'
GUIDE = 'https://universitycenters.ucsd.edu/events-and-reservations/room-guide-pages/theater.html'


def main():
    base = json.loads((ROOT/BASE).read_text())
    layout = copy.deepcopy(base)
    text = subprocess.run(['pdftotext','-layout',str(ROOT/PDF),'-'],check=True,capture_output=True,text=True).stdout
    assert any('Price Center Theater ' in line and '1.402' in line for line in text.splitlines())
    assert 'Level 1' in text
    old = []
    for f in layout['floors']:
        old.extend({'floor':f['id'],**r} for r in f['unplaced'] if r['scheduleKey']=='THTRE')
        f['unplaced'] = [r for r in f['unplaced'] if r['scheduleKey']!='THTRE']
    assert len(old)==1 and old[0]['floor']=='L2' and old[0]['areaSqft']==3250
    target = next(f for f in layout['floors'] if f['id']=='L1')
    target['unplaced'].append({'label':'1.402','scheduleKey':'THTRE','basis':'floor-listing','areaSqft':4368})
    target['sources'].extend([{'source':'PRICE-DIRECTORY-SU26','page':1,'region':'Level 1 / 1.402'}, {'source':'PRICE-THEATER-ROOM-GUIDE'}])
    target.setdefault('notes',[]).append('Price Center Theater is room 1.402 on Level 1 in the official Summer 2026 directory and room guide. It remains unplaced: the directory is an undimensioned wayfinding diagram and the gallery image is an interior photograph. The 4368 ft² figure is published by University Centers; it is not a geometry-derived measurement.')
    pdf_hash = hashlib.sha256((ROOT/PDF).read_bytes()).hexdigest()
    layout['sources'].extend([
        {'id':'PRICE-DIRECTORY-SU26','title':'Price Center directory — Summer 2026','url':URL,'publisher':'UCSD University Centers',
         'building':'PRICE','floors':['L1','L2','L3','L4'],'page':1,'accessed':'2026-10-22',
         'notes':['Source SHA-256: '+pdf_hash,'Lists Price Center Theater as 1.402 and directly labels its Level 1 diagram. Diagram supplies wayfinding, not calibrated geometry.']},
        {'id':'PRICE-THEATER-ROOM-GUIDE','title':'University Centers — Theater room guide','url':GUIDE,'publisher':'UCSD University Centers',
         'building':'PRICE','floors':['L1'],'accessed':'2026-10-22',
         'notes':['Explicit location: Price Center West - Level 1. Published area: 4368 ft². Fixed capacity: 475. No dimensioned room drawing is provided.']}
    ])
    layout['provenance'] += ' Price Center Theater floor corrected to official Level 1 / room 1.402 using the 2026 University Centers directory and room guide; no room geometry was inferred.'
    assert layout['geo']==base['geo']
    for oldfloor,newfloor in zip(base['floors'],layout['floors']):
        assert newfloor['outline']==oldfloor['outline'] and newfloor['rooms']==oldfloor['rooms']
    (ROOT/OUTPUT).write_text(json.dumps(layout,separators=(',',':'))+'\n')
    report = {'schemaVersion':1,'building':'PRICE','output':OUTPUT,'status':'floor-corrected-room-remains-unplaced',
        'oldListing':old[0],'newListing':{'floor':'L1',**target['unplaced'][-1]},'addedGeometry':0,
        'directory':{'url':URL,'localPath':PDF,'sha256':pdf_hash,'page':1,'revision':'SU26','accessed':'2026-10-22T01:34:16.158Z'},
        'roomGuide':{'url':GUIDE,'checked':'2026-10-22','officialFloor':'Level 1','listedAreaSqft':4368,'fixedSeats':475},
        'galleryImage':{'url':'https://universitycenters.ucsd.edu/_images/reservation-images/room-guide-images/PCT_1.jpg','localPath':PHOTO,
            'sha256':hashlib.sha256((ROOT/PHOTO).read_bytes()).hexdigest(),'actualContent':'Interior photograph, despite gallery alt text Theater Layout. No room perimeter can be traced.'},
        'limitations':['The old import associated THTRE with L2 and 3250 square feet. The current directory and room guide both explicitly place the theater on L1. The 3250-versus-4368 area discrepancy is retained here for audit; no room geometry or scale is derived from either number.',
            'The four-floor directory is a schematic wayfinding plan with no dimensions or scale. No tracing or campus registration is claimed.',
            'Existing campus exterior polygons and all other floor data are retained unchanged. The theater remains unplaced and this update does not increase geometry coverage.'],
        'inputHashes':{BASE:hashlib.sha256((ROOT/BASE).read_bytes()).hexdigest()}}
    path = ROOT/'data/indoor/PRICE';path.mkdir(parents=True,exist_ok=True)
    (path/'directory-review.json').write_text(json.dumps(report,indent=2)+'\n')
    print('PRICE THTRE -> L1 / 1.402, remains unplaced; original geometry unchanged.')


if __name__=='__main__':
    main()

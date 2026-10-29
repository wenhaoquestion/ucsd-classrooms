# Indoor geometry and the 3D building explorer

Selecting a building that has an indoor layout opens a 3D explorer next to the
usual room list. The floors stack up from the ground (a quick fade for page
loads, back/forward and reduced motion). You can then inspect floors, find
classrooms, and select a room to see its schedule. This document covers where that geometry comes from,
how it's stored, and how to add another building.

**2026-10-21 acquisition update (Los Angeles; records use UTC):** see
[the Chinese acquisition and coverage report](indoor-acquisition.zh-CN.md) for
room-level changes, acquisition limits and all rebuild commands. The manifest
now has **30 reviewed supplements and 79 indoor building codes**.

Two coverage denominators are deliberately recorded separately:

| Inventory | Positioned keys | Total keys | Position gaps |
| --- | ---: | ---: | ---: |
| Original stored-layout inventory, before this work | 295 | 540 | 245 |
| The same original keys, after reviewed changes | 412 | 540 | 128 |
| Current stored inventory, including seven MYR-A and four BRF2 keys | 420 | 551 | 131 |
| FA26 application-feed snapshot | 361 | 461 | 100 |

The original 540-key inventory has gained 117 positioned keys, from 295 to 412.
The current stored inventory has 96 source-listed room keys without positions,
28 room-number-inferred keys and 7 wholly unmapped keys. Its 9,481 room
polygon records cover 329 floor records; 118 floors have no room polygons.
These are records across building-code views, not a count of distinct physical
rooms: MYR-A reuses 176 verified shapes also retained in the connected MAYER
view. Twenty-one known catalog codes still have no indoor JSON, including some
outdoor or historical locations. The floor count fell from 338 to 329 because
CALIT uses one auditorium floor instead of its eight-floor shell (minus seven),
BRF2 gained two source-listed levels with no outline (plus two), and SDSC
uses a single East E1 room view instead of its original five Central building
shells (minus four). The interim SDSC East B1 listing has been superseded.
Original CALIT and SDSC bases remain preserved separately; no classroom
geometry was removed.

The independent FA26 audit parses the same feed and parser as the application:
74 physical building codes, 361 placed keys (78.31%), 69 floor-listed,
23 floor-inferred, 6 unmapped in registered layouts and 2 without an indoor
file: TASB W1131/W1141. The original stored inventory omitted 13 active-term
keys; adding MYR-A's seven and BRF2's four leaves only those two outside the
stored denominator. Three BRF2 keys still lack positions, although two now
have explicit floor evidence. The inventory expansion did not remove any
existing classroom mapping. VAUGN 100 now has an officially
listed first-floor basis instead of room-number inference, without a new polygon.
Installed sign photographs similarly upgrade WFH 3N129/3W113 to source-listed
third-floor records; the undated photographs provide no classroom boundaries.
SDSC E129 now has a traced room boundary on `EAST-L1`, using PDF page 24
of the [official public SDSC emergency plan](https://business.sdsc.edu/assets/documents/sdsc_emergency_plan.pdf).
Its cover is updated September 2025; the drawing distinguishes E129 on E1
from EB129 on EB1 (PDF page 23), correcting the ambiguous 2010 B1 event
notices. The embedded drawing has no independently readable revision date.
Only E129 is modeled, in relative units with unknown north, physical scale
and campus registration. The floor outline is the room extent, not a complete
floor. The original five Central building shells are archived in
`data/indoor/SDSC/original-facilities-base.json` and are not mixed into the
independent East frame. A separate FA25 registrar record confirms the room
key; no FA26 key is added. See `data/indoor/SDSC/east-e129-review.json`.
The feed was scraped upstream on 2026-10-15 at 00:29 UTC and acquired locally
on 2026-10-22 at 01:39 UTC. It is a captured application feed, not a fresh
registrar scrape. See `data/indoor/research/active-term-coverage.json` and
`active-term-snapshot.json`; stored counts are in `data/indoor/coverage-current.json`.

The acquisition index contains **66 public original PDF/image files: 49 PDFs / 912
pages and 17 images (170,501,383 bytes)**. Separately, 20 public FIS floor-plan
PNGs were assembled at the dimensions and tile levels actually advertised by
the public viewer. Five HTML sources expose native normalized room vectors:
UNEXG L1, UNEXN L1, MCC L1, MCC L2 and BRF2 L4. They add ten classroom mappings
in four sources; MCC L2 contributes only a circulation polygon. Raster tiles
for these vector sources were not obtained. Counts, hashes and exact review
scope are in `acquisition-index.json`, `public-fis-raster-sources.json`,
`public-fis-raster-review.json` and `public-fis-vector-sources.json` under
`data/indoor/research/`. Downloaded documents and individual reviewed rooms
do not certify complete buildings or current renovations. Separately retained
auxiliary files total 90, with 89 distinct contents: 89 project photographs
(WFH signage 30, another WFH portfolio 22, DANCE 7 and GH signage 30) plus
one SDSC outdoor direction image. DANCE DS05/DS06 are identical. These
auxiliaries are separate from the public-plan index and are not floor plans.
One account-accessed May 2024 SDSC PDF (24 pages) is separately recorded in
`data/indoor/research/account-source-acquisition.json`; it provided independent
corroboration, while the newer public PDF is the sole rebuild and runtime
source. The private PDF is not served by the website or required to rebuild.

Identity repairs are part of the result. ASANT now identifies Asante Meeting
(CAAN 7025), separately from its former apartment input. MCC now identifies
Communication (CAAN 6614); two Cancer Center matches were removed before four
correct first-floor rooms were imported. Its intermediate corrected shell is
retained in `data/indoor/MCC/corrected-base.json`. LEDDN uses its independent
numbered auditorium instead of duplicated HSS office floors. Original
Facilities inputs remain available for audit.

CSB/SME/FAH/ASANT/SDSC use relative coordinates. GH/HSS/MANDE/MCGIL/MCC,
UNEXG/UNEXN, LEDDN, JEANN, YORK, BRF2 and CALIT have local metric coordinates without
`geo`. HSS and YORK now explicitly omit unsupported north angles; YORK retains
all relative room geometry while removing its unsupported campus placement.
FAH also sets north to unknown: both source arrows point page-up while matching
room walls requires about a 90-degree rotation between sources. Its notes now
correctly describe all three positioned classrooms.
Other retained campus placements remain approximate, with their source and
fit limits recorded per layout. MYR-A's seven exact FA26 mappings comprise six
existing Facilities polygons and a new room 5623 trace from Physics EAP page 37;
its fifth-floor outline covers only that reviewed room region.

CALIT 1511 uses an undated official QI event diagram. SEAW November 2006
page 7 explicitly identifies the Main Auditorium as room 1511, while current
public FIS metadata supplies its L1 membership, room number and 2,865 sq ft
area. Scale is fitted to that one area: the resulting area agreement is imposed,
not an independent validation. There is no reliable dimension or scale bar.
The historical identity reference does not establish present as-built accuracy.
Only the auditorium is modeled, with unknown north and no campus georeference;
the original eight-floor shell remains in `static/indoor/facilities/CALIT.json`.

Visible Firefox has verified COA 125 desktop 3D, rotation and floor switching
(six basement and eight first-floor classroom labels); MALK B91 mobile room
selection, 3D and schedule; MYR-A 5623 with PHYS 251; BRF2 4103 with MED 264/277
and preserved selection in List only; and CENTR 205 loading and floor selection.
The [browser record](../data/indoor/research/browser-verification.json) contains
screenshot paths/hashes, zero page errors, and a recorded Firefox viewport-change
drawing warning. These sampled checks supersede the earlier headless WebGL
limitation, not a visual review of every classroom.

The [final regression record](../data/indoor/research/resumed-validation.json)
includes the SDSC addition. `npm test` passed its three test bundles; direct
execution passed all 64 semantic tests (25 supplement, 36 indoor and 3 view
tests). Typecheck, lint, indoor validation and production build also passed.
Validation reports zero errors and 56 inherited-geometry warnings, with no
new warning from this increment. All 66 public originals, 90 auxiliary files
and one account-only research copy matched their recorded hashes; the 20 FIS
PNGs also passed file checks. The [independent integration review](../data/indoor/research/integration-review.json)
covered 27 supplements and resolved seven findings; BRF2 was developed
concurrently and then checked separately, including the complete test suite
and browser rendering. Additional visible checks verified CALIT on desktop
and mobile, and the floor-evidence descriptions for BRF2 1104/5A03. Those
checks used normal application requests. After a later refresh of the old QA
page stalled at Loading, a fresh QA tab replayed only the saved, identical
FA26 production-feed snapshot through a route handler; this was not a fresh
live-feed availability test. In that bounded replay, BRF2 L5 had no room
labels, switching back to L4 restored 21 labels including 4103, and the new
tab recorded zero errors and zero warnings. The earlier viewport warning
remains part of the earlier record.

The final SDSC check used normal network schedule loading, with no fixture,
in visible Firefox at 500×842 CSS pixels and DPR 1.2. E129's single-room 3D
outline appeared on East E1, with no FA26 classes as expected. Its source panel
linked the public September 2025 plan and exact Fall 2025 registrar records.
The visually reviewed screenshot is `/tmp/ucsd-sdsc-e129-public-source.png`;
the browser record preserves its hash and reports zero page errors and zero
console warnings for this check.

The 01:54 UTC Tririga check is historical: the account then had Home-only
navigation and an Open access request. The browser MCP was subsequently
restarted and lost SSO. Current authentication and permissions are not established;
no authorized Tririga floor-plan exports were obtained. With the user's
explicit authorization, a request email was sent to `omcp@ucsd.edu` on
2026-10-22 at 03:00:51 UTC (October 21, 20:00:51 in Los Angeles). Gmail
read-back confirmed SENT status, the recipient and the 10,944-byte
`remaining-floorplan-requests.csv` attachment. A university reply is awaited;
no new plans have been received, so the reported coverage and gaps are unchanged.

## Three levels of detail

Every building with a campus-map footprint gets a 3D view. The explorer uses
the best data available:

| Level | `geometryStatus` | Where it comes from | Published? |
| --- | --- | --- | --- |
| Rooms traced from public plans | `source-traced` | `static/indoor/<CODE>.json`, registered in the source or supplemental manifest | yes |
| Rooms from UCSD Facilities plans | `facilities-plan` | baseline `static/indoor/facilities/<CODE>.json` or a reviewed supplement | yes |
| Exterior shell | `exterior-shell` | generated in the browser from `static/campus/buildings.json` | yes |

- **Exterior shells** extrude the building's campus-map footprint parts. Floors
  are estimated from the roof height (about 4.2 m per story, at least as many
  as the room numbers imply), and a floor's outline only includes parts tall
  enough to reach it. Classrooms are *unplaced*: they are listed on the floor
  their number implies (`floorIdForRoomKey` in `src/lib/indoor/shell.ts`) and
  never drawn at a made-up position. Shells open in the exploded view, and
  each floor's tag counts its classrooms and how many are in use.
- **Unplaced rooms** (`IndoorFloor.unplaced`) record a room's floor without a
  position: from the room number (`basis: "room-number"`) or from a source's
  listing of the floor (`"floor-listing"`). The room list and 3D selection
  treat them like mapped rooms, except that they're never colored in 3D.
  A floor supported only by such listings may use `outline: []` with unknown
  outline confidence and no room, area or feature geometry. BRF2 L1/L5 use
  this form. The scene omits nonexistent floor geometry and retains valid
  camera bounds; the floor and room lists still identify the known level.
- **Campus context:** layouts with a `geo` placement show nearby campus
  buildings (within about 120 m) as faint blocks at their real relative
  elevations. EBU3B's placement was fitted to its campus-map footprint
  (overlap 0.83). The fit puts north about 50° from page-up, so the compass
  rose printed on the CSE maps (29.5°) looks inaccurate.

### Campus footprints

`npm run campus:build -- <footprints.json> <attributes.json>` converts UCSD's
public campus-map layers (behind https://campusmap.ucsd.edu) into
`static/campus/buildings.json` (585 footprint parts with ground and roof
elevations, in meters around a fixed campus origin; about 220 KB, fetched only
by the 3D view) and `src/lib/indoor/campusCodes.json` (registrar code → campus
building numbers, matched by the building's map point). The query URLs are at
the top of `scripts/build-campus.ts`. The explicit code mapping is retained in `campusCodes.json`; a footprint
match supplies exterior context, not a numbered indoor floor plan. TASB still
has no registered campus footprint.

### Facilities layouts and the public embed

The original converted files in `static/indoor/facilities/` register 77
building codes. `INDOOR_MANIFEST` merges original source traces, Facilities
baselines, then `SUPPLEMENTAL_LAYOUTS`, so a reviewed supplement takes final
precedence. A new file must be registered; keeping it on disk is insufficient.

The public [Classrooms directory](https://facilities.ucsd.edu/Classrooms/Default.htm)
links some classroom thumbnails to the embedded building viewer. A public
HTML response can contain the floor title, room IDs, labels and areas, actual
raster dimensions and tile levels, and sometimes a `polys` GeoJSON object.
Availability is checked per floor: a readable room listing does not guarantee
a usable image or room polygon. Login responses are recorded as unavailable;
unadvertised tile scales and authenticated routes are not guessed.

For a native vector import, convert normalized x/y to source pixels by
multiplying by the published width/height respectively, remove the repeated
closing vertex, preserve holes and exact room IDs, then apply one documented
scale/transform. Shared room-area agreement is
a consistency check. It cannot establish north, campus placement or surveyed
accuracy. MCC uses 52 first-floor area/polygon pairs to calibrate one scale;
its four exact schedule rooms agree within 0.061%, while the maximum over all
53 listed polygon pairs is 0.842%. MCC L2 has only corridor 253. UNEXG/N floor
patches likewise cover the published rooms without reconstructed exterior walls.
BRF2 uses 89 non-target area/polygon pairs; 4103 is a held-out check at
739.6959 sq ft against the published rounded 740 sq ft. An invalid
self-intersecting corridor is explicitly excluded, so its imported spaces
do not constitute a complete floor plan.

Raster supplements retain original PNG/HTML hashes, explicit pixel polygons,
registration controls, withheld checks, and area or dimension checks where
available. No room is stretched separately to force a listed area. COA's
125/127/B27 are explicit partitionable-room combinations supported by official
references; booking a combined key does not establish that every partition is
currently open. HSS corrects its lower-floor scales and a mislabeled 2333A
boundary. MCGIL and MANDE retain their mirrored local frames instead of
silently introducing an assumed campus orientation.

The original converter used room areas for metric scale and approximate
rotation, mirroring and translation against campus footprints. Some baseline
slabs represent unions of spaces, while empty floors copy another level or
use the campus outline. These inherited floor outlines can be approximate
context rather than verified floor envelopes. Public-source supplements
state when they preserve, replace or only partially extend such outlines.

The historical fetcher/converter and caches were kept in ignored
`local/fis-tools/` and `local/fis-cache/`; they are absent from this checkout.
Its old full-conversion command cannot currently reproduce those inputs.
The current supplemental builders and their retained source evidence are
separate, runnable workflows. Exact schedule keys and reviewed explicit
aliases govern runtime mapping; a similar room number or a large room alone
is insufficient evidence for a new mapping.

## Geisel Library study rooms

`GEISEL` isn't a registrar building: it has no classes, so its rooms are colored
by live LibCal reservations instead of schedules (`src/lib/library/geisel.ts`,
`worker/README.md`). The layout is `source-traced` and rebuilt with
`node scripts/build-geisel-indoor.mjs` from three inputs in `data/indoor/GEISEL/`:

- **`extrusion.json`:** the campus map's `Geisel_Extrusion` layer (accessed
  2026-10-28): one outline and elevation per floor, in feet. Floors 3-8 use these
  outlines directly; floor 3 is the plaza-level core plus the 20 tower columns.
- **`trace.json`:** measurements from the library's floor-map PDFs for floors
  1, 2, 5, 6 and 7, in PDF points, with each PDF's SHA-256.
  `scripts/trace-geisel-maps.py` suggests the blue room tiles, floor outlines and
  courtyards; room labels were read off the maps by hand.
- **`details-trace.json`:** 94 furniture footprints on floors 1–2, 51 named
  collection/study/service zones and 26 additional circulation markers, measured
  against the same PDF coordinate frames. Upper-floor maps locate collection and
  carrel zones but do not establish individual furniture positions. Furniture
  heights and stairs/elevator symbols are illustrative; zone borders are not walls.

The seven full-page WebP floor drawings use each source's existing transform,
clipped to the floor outline. Reproduce them with
`python3 scripts/render-geisel-plans.py /path/to/downloaded/maps` (Poppler and
Pillow; inputs named `floor1.pdf`, etc.). The script checks the recorded PDF
hashes. Drawings load only when a floor is selected, and only the current floor's
texture is retained on the GPU. **Floor map** toggles the drawing; **Top view**
looks down at that floor. The camera frames the selected floor's own bounds.
Geisel's plaza-level core and column footprints are extruded to show the tower
supports; these are simplified vertical prisms, not surveyed support profiles.

| What | Basis | Confidence |
| --- | --- | --- |
| Tower rooms (5-7) | Map tiles; the three maps share one print scale, and their outline boxes match the extrusion to within 0.5% in x and z | location `approximate`, shape `traced` |
| Floors 1-2 | Outline traced from the map; uniform scale makes its bounding box the area of the extrusion's (box-shaped) floor 1-2 footprint | `approximate` |
| Blocks on floors 1-2 | The maps draw 1040-1045, 2070-2072, 2096A-B and Service Hub 1-4 as single labeled blocks; they stay blocks, and the panel lists their rooms | `approximate` |
| Context | Other labeled blue spaces (e.g. Classroom 1, The Gallery) are unselectable rooms; unlabeled blue blocks are elevator/restroom cores; flat gray map areas are `not-detailed` | `approximate` |
| Orientation | The maps have no north arrow. Floors 1-2 put Geisel West on the left and East on the right, so every map is taken as north-up | assumption |

The two video conferencing booths are "outside room 2095" according to LibCal
but aren't on the maps; they're listed under floor 2 without a position.
Floors 4 and 8 have no bookable rooms.

## Original CSE source trace retained for audit

| Building | Floors | Rooms traced | Schedule rooms placed | Status |
| --- | --- | --- | --- | --- |
| EBU3B (CSE Building) | B, 1, 2, 3, 4 | 300 | 12 of 15 seen in FA25–FA26 | `source-traced` |

- **Placed:** B240, B250, B260, B270, 1202, 2109, 2154, 3109, 3219, 4140, 4217,
  4258.
- **Not placed:** 1113, 1117, 1124. The CSE Level 1 map details only the 12xx
  east wing. The west wing is a shaded area labeled "Warren College" with no
  rooms. These rooms stay in the room list under "Location not mapped yet", and
  their schedules work as usual.
- This table describes the original CSE trace in `SOURCE_LAYOUTS`. The active
  explorer uses `EBU3B-combined.json`, which adds its five basement/first-floor
  mappings to the Facilities baseline and retains the upper-level geometry.
  The current 30-supplement inventory and all-building coverage are summarized
  above; the source-only table is not the website-wide total.

### Sources (accessed 2026-10-19)

| ID | Source | Covers |
| --- | --- | --- |
| CSE-FLOORMAPS | [FloorMaps, Computer Science](https://cse.ucsd.edu/node/1529) (index page) | all levels |
| CSE-MAP-B | [Basement image (Part 11)](https://cse.ucsd.edu/sites/default/files/maps/260909_CSE_EBU3_ALLLEVELS_MVH_Part%2011.jpg) | B |
| CSE-MAP-L1 | [Level 1 image (Part 12_0)](https://cse.ucsd.edu/sites/default/files/maps/260909_CSE_EBU3_ALLLEVELS_MVH_Part%2012_0.jpg) | 1 |
| CSE-MAP-L2 | [Level 2 image (Part 13)](https://cse.ucsd.edu/sites/default/files/maps/260909_CSE_EBU3_ALLLEVELS_MVH_Part%2013.jpg) | 2 |
| CSE-MAP-L3 | [Level 3 image (Part 14)](https://cse.ucsd.edu/sites/default/files/maps/260909_CSE_EBU3_ALLLEVELS_MVH_Part%2014.jpg) | 3 |
| CSE-MAP-L4 | [Level 4 image (Part 15)](https://cse.ucsd.edu/sites/default/files/maps/260909_CSE_EBU3_ALLLEVELS_MVH_Part%2015.jpg) | 4 |
| CSE-RENOVATION | [2026 Renovation, Computer Science](https://cse.ucsd.edu/2026renovation) | context only |
| REGISTRAR-SCHEDULES | `classrooms-FA25/WI26/SP26/FA26.txt` from `sheeptester.github.io/uxdy/data/` | room keys only |

Image sizes and SHA-256 hashes are recorded in
`data/indoor/EBU3B/meta.json`, so a later re-trace can tell whether a map
changed. The images themselves are not committed.

### What the EBU3B geometry is, and isn't

- **Direct from the maps:** room numbers, which floor each room is on, and room
  names printed on the map (e.g. "Seminar Room", "CSE Data Center"). The room
  type comes from the map's color legend: offices, conference/seminar rooms, or
  labs/other.
- **Traced (manual interpretation):** room and floor outlines, followed along the
  colored fills of the maps. Relative positions follow the maps. Nothing is
  surveyed.
- **Approximate:** 50 rooms whose fills were broken up by text use convex hulls
  (36 of them are pale Level 1 offices). Two tiny rooms (1219, 1250) and 2242 are
  hand-placed rectangles. Stairs, elevators, restrooms and Doors 1–4 are placed
  at their icons or text labels.
- **Unknown:** metric scale (the maps have no scale bar), floor heights and
  elevations, the building's exterior, and the contents of the shaded west wing
  on B and Level 1. The units are `relative` (1 unit = 10 map pixels), and
  every floor is marked `vertical.estimated: true`.
- **Uncertain:**
  - North is about 29.5° clockwise from map-up; the N–S and W–E arms of the
    compass rose disagree by 3°.
  - The maps carry no date. The CSE renovation page says the first-floor east
    wing is being repositioned, so Level 1 may already be out of date.
  - B210 is labeled "CSE Data Center" and there is no B220. Neither appears in
    recent schedules, so neither is mapped to a schedule.
  - The registrar code is `EBU3B`, which matches the map title "BUILDING EBU3B";
    there is no `CSE` code in the schedules.

The explorer shows a short provenance note ("Traced from public floor maps")
that expands to these sources. Vertical spacing is described there as
illustrative.

## Coordinate convention

- Floor polygons use local `[x, z]` coordinates in `coordinateSystem.units`.
  `y` is vertical.
- Map pixels `(u, v)` (u right, v down) become local coordinates through the
  floor's `SourceTransform`:
  1. Translate by `-originPx`.
  2. Rotate clockwise on the page by `rotationDeg`.
  3. Multiply by `scale`.

  So map-down is local `+z`. See `pixelToLocal` in `src/lib/indoor/geometry.ts`.
- `coordinateSystem.northDeg` is the clockwise angle from map-up (local `-z`) to
  true north, or `null` if unknown.
- If a plan has no scale, use `units: "relative"` and describe what a unit is.
  Never invent meters.
- `vertical.baseElevation` and `vertical.height` are physical values, and may be
  estimated. The exploded view adds a display-only offset in the renderer
  (`EXPLODE_GAP`) that is never stored. Picking and labels use the displayed
  transforms.

## Schema

The schema is in `src/lib/indoor/schema.ts`, and the runtime files are in
`static/indoor/<CODE>.json`.

- **Building:** exact building code, `schemaVersion`, `geometryStatus`
  (`source-traced`, `facilities-plan`, `exterior-shell` or `schematic-demo`),
  provenance, coordinate system, sources,
  floors, `scheduleAliases`, and `knownUnmapped`.
- **Floor:** stable `id`, labels, vertical info, an `outline` of polygons
  (with holes), source transforms, rooms, `areas` (corridors,
  not-detailed regions, unlabeled rooms), `features` (stairs, elevators,
  entrances, restrooms), and sources. A source-listed floor without geometry
  may have an empty outline only with `outlineConfidence: "unknown"`, at least
  one `floor-listing` unplaced record, and no rooms, areas or features. The
  building must still contain at least one valid geometric floor.
- **Room:**
  - stable `id`, plus `label` and `name` as printed
  - exact `scheduleKey` (a string, so leading zeros and letters survive) or
    `null`
  - `type`, `floor`, `footprint`, `labelAt`
  - per-aspect `confidence` (location, shape, label), sources, and notes

Schedule keys match exactly. Alternate spellings must be listed in
`scheduleAliases`. The validator rejects ambiguous aliases and duplicate
assignments.

`npm run validate:indoor` and the runtime loader both check:

- malformed polygons: too few points, non-finite numbers, a repeated closing
  point, duplicate points, self-intersections, zero area, holes outside the
  polygon
- duplicate IDs, and missing or unknown source references
- rooms filed under the wrong floor
- floors out of elevation order
- schedule keys that are duplicated or ambiguous
- `knownUnmapped` keys that are actually mapped
- schematic data claiming `direct` confidence
- unsupported empty floors: missing floor-listing evidence, geometric content
  attached to an outline-free floor, or a building with no geometric floor

It also warns about rooms outside their floor outline and label anchors outside
their room.

## Workflow: adding a building

The helper scripts live in `tools/indoor-trace/`. They need Python 3 with
Pillow, NumPy and SciPy. They only *suggest* outlines; a person reads every room
number.

1. **Find a source.** Look for official floor plans, department maps, posted
   evacuation diagrams, or building directories. Record the URL, page or image,
   access date, orientation, scale and revision. A complete dimensioned seating
   drawing can support a room perimeter, as for GH 242 and JEANN. Building,
   floor, schedule identity and any placement within a larger plan still need
   separate evidence; a seating chart alone does not establish them.
2. **Get the images and check the frame.** Keep them outside the repo, e.g. a
   `local/indoor-sources/`, and record their hashes. If one transform will cover several
   floors, confirm that shared marks (north arrow, labels) land on the same
   pixels on every floor (`probe.py` prints colors and coordinates).
3. **Segment:** `python -I tools/indoor-trace/segment.py plan.jpg seg/L1.json seg/L1-overlay.png`.
   This finds regions filled with each legend color and the building outline.
   - `ERODE=4` splits rooms joined through door gaps.
   - `COLOR_office=r,g,b` overrides a legend color that was sampled badly.
   - Run `overlay.py` to draw region IDs.
4. **Label:** write `data/indoor/<CODE>/labels.json`, mapping each printed room
   number to region IDs. Use `splits` to cut merged regions at wall lines (read
   wall positions with `scan.py`), `manual` for rooms that weren't segmented,
   `hull` for ragged fills, and `ignore` for shading.
5. **Assemble and check:**
   `python -I tools/indoor-trace/assemble.py plans/ seg/ data/indoor/<CODE>/labels.json data/indoor/<CODE>/trace.json`.
   Then render `check.py` overlays and compare every label against the map.
6. **Describe:** write `data/indoor/<CODE>/meta.json` (see EBU3B's). It holds:
   - sources and the transform
   - floors and story height (mark heights `estimated`)
   - room names and type overrides
   - `scheduleKey` only for numbers that appear in schedule data **and** are
     printed identically on the map
   - features, `knownUnmapped` with reasons, and notes on anything uncertain
7. **Convert and validate:** `npm run indoor:build -- <CODE>` writes
   `static/indoor/<CODE>.json`. Add the building to `SOURCE_LAYOUTS` in
   `src/lib/indoor/manifest.ts`, then run `npm run validate:indoor` and
   `npm test`.
8. **Preview:** run `npm run dev`, open the building, and check each floor,
   label, and mapped room against the source. Use a browser with a working
   WebGL context for canvas and picking checks; a successful JSON load or
   fallback room list does not test 3D rendering.

Manual tracing straight into `trace.json` (pixel polygons) is fine for small
buildings. OCR can help read labels but isn't reliable enough to produce
geometry on its own.

### Schematic demos

If a building has no usable public plan, don't fabricate a layout. A clearly
labeled demo is allowed only if it:

- uses `geometryStatus: "schematic-demo"`
- lives in `static/indoor/schematic/`
- claims no `direct` confidence

The validator enforces all three, and the UI labels such demos "Schematic demo,
not the real layout". No demo is shipped today.

## Runtime architecture

| Concern | Where |
| --- | --- |
| Schema, geometry helpers, validation | `src/lib/indoor/{schema,geometry,validate}.ts` |
| Loading (on demand, cached, stale-safe) | `src/lib/indoor/{manifest,loader,useIndoorLayout}.ts` |
| Schedule ↔ room mapping, status | `src/lib/indoor/{roomMapping,roomStatus}.ts`, `src/lib/roomActivity.ts` |
| 3D scene, picking, labels | `src/explorer3d/IndoorScene.ts` (lazy chunk, three.js) |
| Shared WebGL context | `src/explorer3d/ExplorerRenderer.ts` |
| React UI and navigation | `src/components/explorer/BuildingExplorer.tsx`, `building/BuildingPanel.tsx`, `building/RoomList.tsx` |

Notes:

- three.js and the scene are split into `dist/chunks/IndoorScene-*.js` and load
  only when a mapped building opens. Check this with `npm run build`, which
  prints the bundle analysis.
- One WebGL context is shared by every scene. Each scene disposes its
  geometries, materials, textures, controls, listeners and labels.
  `window.__ucsdIndoorStats()` reports live renderer resources, for checking
  leaks.
- The shared canvas is moved into the open explorer's stage and sized to it.
  It's transparent; the stage's CSS gradient is the background.
- Rooms that can't be selected, and the floor areas, are merged into a few
  meshes per floor (EBU3B: about 60 GPU geometries instead of 630). Selectable
  rooms keep their own meshes so they can be colored and raised.
- Rendering happens on demand and stops when idle. Device pixel ratio is capped
  at 2, and the drawing buffer at about 3 megapixels.
- Touch taps that miss every room select the nearest selectable room within
  28 px.
- Room status comes from the schedules: class now, starting soon,
  available (no class listed now), no classes listed, or schedule unavailable.
  A generic-week view uses a neutral "has listed classes" color instead. Labels
  carry glyphs and the legend has text, so color is never the only cue. A
  missing schedule entry never means "available".
- URLs are unchanged (`?building=EBU3B&room=4140`). Floor, camera and hover
  state stay out of browser history. The 3D on/off choice is stored per browser.

## Known limitations and remaining sources

The [remaining floor-plan request CSV](../data/indoor/research/remaining-floorplan-requests.csv)
contains 64 request rows covering 133 distinct unresolved building/room keys:
the 131 stored gaps plus TASB's two keys from the active feed. This deduplicated
union is broader than the 100 active-FA26 gaps.

- Stored coverage still has 131 position gaps, including three newly inventoried
  BRF2 keys. Largest gaps include GH 17,
  PODEM 10, EBU2 seven, COA/MALK/WFH six each, ECKRT/RBC five each, and
  MCC/MCTF/MET/PACIF/VAUGN four each. Active-term counts use the separate
  captured-feed audit above; neither inventory is an all-term campus census.
- COA L2 and MALK upper-floor raster requests require login; PODEM has no
  usable public plan key from the inspected entry. GH L1 remains a high-value
  export target even after rooms 242/320/321 were recovered.
- PCYNH L2 advertises only a 260×195 image and no vectors. Gensler pages 103–104
  include an existing-plan scan with unreadable target numbers plus a readable
  proposed fit-out. Neither establishes 240/245 geometry. PRICE's public image
  is also too small; its Theater has a corrected source-listed floor, not an
  invented footprint.
- PFBH 003/005 and HDSI 123/336/355 retain historical-plan/area conflicts.
  SSRB 310 is not automatically the same as 310A/310B; YORK 4124 conflicts with
  the public fourth-floor drawing. Exact labels, adjacent labels and room
  boundaries must agree before these candidates become mappings.
- BRF2 (now Israni) has a fourth-floor public-vector source for 4103;
  1104 is source-listed on L1 and 5A03 on L5 using original event-organizer
  pages; both remain without positions. The L1/L5 records deliberately have
  empty outlines. Room 1102 remains unmapped. One self-intersecting corridor among the
  127 published polygons was excluded rather than repaired without evidence.
  Page 63 of a 168-page 2022 Senate proposal has an unreadable fifth-floor
  thumbnail, while the clearer designer drawing is explicitly third floor.
  Those historical sources do not supply the remaining room geometry, and
  departmental area is not classroom area. See `data/indoor/BRF2/source-review.json`
  and `fis-vector-review.json`.
- ECKRT's newly acquired architect images are an unnumbered interior
  axonometric and an exterior site diagram, not classroom plans. Later
  first-floor renovation records add a freshness concern; the five exact
  classroom keys remain unresolved. See `data/indoor/ECKRT/source-review.json`.
- SERF's official Astronomy and Astrophysics space policy links specific
  third- and fourth-floor PDFs revised 2023-09-15. Public access requires
  Google sign-in, and the user explicitly reported that their UCSD account
  also cannot open the file. This is an identified but inaccessible source,
  not a pending login or evidence of deletion; 329/383 remain unplaced.
  All eight pages of the newly acquired Bioengineering 2014 SERF emergency
  plan were rendered and reviewed. Pages 5–6 contain outdoor assembly/response
  maps; the document has no interior boundaries for these rooms.
- GH's 30 newly inspected MSI photographs include a real L2 evacuation plan,
  but its printed sheet occupies only about 230×180 source pixels and no
  higher-resolution image is declared. The readable physical directory
  corroborates 242 on both L2/L3 and 247/253/254 on L2; no new perimeter was
  inferred. DANCE's seven historical gallery images are photographs, with
  DS05/DS06 byte-identical. See their building-specific source reviews.
- The Great Hall source shows a usable curved auditorium and scale bar, but
  no numbered classroom or explicit floor. The FA26 feed contains no GREAT
  meeting records, so only a source review is retained. Downloaded design
  packages, exterior 3D models and outdoor assembly maps do not fill indoor
  schedule mappings by themselves.
- The official Physics EAP has 51 pages and a 2026 cover update. Only the
  explicitly documented room/floor portions are imported; the embedded legacy
  drawing dates are not established by the cover. Other source documents carry
  similar limits in their `geometryReview` entries.
- Floor heights, wall heights and exploded spacing are illustrative. Some
  slabs and campus fits are approximate; a good area check is not an as-built
  survey. Georegistration and north are omitted when not supported.
- Room-number floor inference has exceptions. A shell's floor suggestion is
  not evidence of a sourced indoor boundary or confirmed floor.
- Tririga had Home-only navigation and an Open request at the historical
  01:54 UTC observation. A later browser MCP restart lost the SSO session;
  current login and permission status are unknown. No authenticated exports
  were obtained, and the request's submitter is not established.

Use the [acquisition report](indoor-acquisition.zh-CN.md) for the full list of
source-specific builders and the authorized export workflow. The two primary
audit commands are:

```sh
python scripts/audit-indoor-coverage.py --manifest --output data/indoor/coverage-current.json
node scripts/audit-active-term-coverage.mjs
```

Use `python scripts/build-gh-fis.py` for GH's final combined file; it first
rebuilds the complete 242 footprint and then adds 320/321. It restores the
prior output and evidence files on failure; an induced interruption preserved
all three file hashes. The final FAH entry
`node scripts/build-fah-indoor.mjs` automatically chains the 1301 supplement and
restores the prior file on failure. MYR-A inventory is reproduced with
`node scripts/extract-myr-a-schedule.mjs`, followed by
`python scripts/build-myr-a-indoor.py`. BRF2 is reproduced with
`python scripts/supplement-brf2-vectors.py --review`; CALIT uses
`python scripts/build-calit-auditorium.py`. Restoring a legacy full converter must
preserve these reviewed identity repairs and final supplement precedence.

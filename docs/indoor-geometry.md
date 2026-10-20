# Indoor geometry and the 3D building explorer

Selecting a building that has an indoor layout opens a 3D explorer next to the
usual room list. The floors stack up from the ground (a quick fade for page
loads, back/forward and reduced motion). You can then inspect floors, find
classrooms, and select a room to see its schedule. This document covers where that geometry comes from,
how it's stored, and how to add another building.

## Three levels of detail

Every building with a campus-map footprint gets a 3D view. The explorer uses
the best data available:

| Level | `geometryStatus` | Where it comes from | Published? |
| --- | --- | --- | --- |
| Rooms traced from public plans | `source-traced` | `static/indoor/<CODE>.json`, listed in `SOURCE_LAYOUTS` | yes |
| Rooms from UCSD Facilities plans | `facilities-plan` | `static/indoor/facilities/<CODE>.json` | yes |
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
the top of `scripts/build-campus.ts`. 93 registrar codes match; of the
buildings with classes, only TASB (new) has no footprint yet.

### Facilities layouts

UCSD Facilities' building viewer (`facilities.ucsd.edu/Buildings/Viewer/`)
shows every floor with room outlines, room numbers, areas and room-use codes.
- Converted layouts are committed in `static/indoor/facilities/` and included
  in production builds. `index.json` registers 77 building codes in
  `FACILITIES_LAYOUTS`. The combined `INDOOR_MANIFEST` prefers these layouts
  over source-traced alternatives, matching the completed preview. The
  explorer labels them "UCSD Facilities floor plans".
- The fetch and conversion scripts, the cached pages and the code-to-building
  key table live in the git-ignored `local/fis-tools/` and `local/fis-cache/`.
  The fetcher is sequential with 4 s between requests and stops on any error.
  Re-run the conversion with
  `python -I local/fis-tools/convert.py local .` (from the repo root).
- Conversion scales each building from the official room areas (polygon area
  vs. listed square feet agree within about 1%), then fits rotation, mirroring
  and offset by maximizing overlap with the campus-map footprint. Below 0.45
  overlap, rooms are listed by floor instead of placed. About half of the
  floor pages have no room outlines; their rooms are listed by floor.
- Every space is kept so floors read as whole buildings: circulation `(C)` is
  floor surface; mechanical `(M)`, restrooms `(T…)`, custodial `(J)` and
  unlabeled shafts or stairs are low non-selectable volumes. Self-intersecting
  outlines are repaired by rasterizing and re-tracing them.
- Each floor's slab is the union of its spaces (0.25 m raster, closing
  wall-thickness gaps, keeping courtyards over 30 m² as holes), not the
  campus-map footprint, which often differs from the plan. A floor without room
  outlines copies the nearest planned floor's slab; the campus-map footprint
  is only used for buildings with no outlines at all.
- Matching schedule rooms to Facilities labels: exact first, then (only when
  unique in the building) leading zeros (`015` = 15), a one-letter prefix
  (Malk Hall's `E192`, EBU2's `L203`) or a floor-digit prefix on that floor
  (`1133` = 133). Building-code prefixes (`CT0125`) are stripped. "AUD"-style
  names map to the building's largest gathering room and are marked as an
  assumption; Price Center's THTRE uses the University Centers directory.
- Robinson (1, 2, 3), IGPP (Munk, 4000) and Mayer (Hall, Addition) combine
  several Facilities buildings, each fitted to its own footprint.
- Weak footprint fits still place rooms (relative positions come straight
  from the plan); only the neighboring buildings are left out.
- Rooms Facilities doesn't list fall back to the floor their number implies,
  creating an outline-only floor if needed.
- Result on 2026-10-19: of 540 scheduled rooms, 251 are placed with their
  real outline and 281 are on a known floor (218 from Facilities' floor
  listings, 63 from the room number). 8 named spaces (Mandell Weiss THEA,
  STUDI and SCENE, Robinson GARDN, CCC ARTSP, CNCB SEM, RVCOM C and FORML) have
  no public mapping. TASB has no campus footprint yet.

## What's mapped today

| Building | Floors | Rooms traced | Schedule rooms placed | Status |
| --- | --- | --- | --- | --- |
| EBU3B (CSE Building) | B, 1, 2, 3, 4 | 300 | 12 of 15 seen in FA25–FA26 | `source-traced` |

- **Placed:** B240, B250, B260, B270, 1202, 2109, 2154, 3109, 3219, 4140, 4217,
  4258.
- **Not placed:** 1113, 1117, 1124. The CSE Level 1 map details only the 12xx
  east wing. The west wing is a shaded area labeled "Warren College" with no
  rooms. These rooms stay in the room list under "Location not mapped yet", and
  their schedules work as usual.
- This table describes the original CSE trace retained in `SOURCE_LAYOUTS`.
  The active explorer uses Facilities layouts for the 77 codes listed in
  `static/indoor/facilities/index.json` (9,697 room records). Buildings without
  detailed layouts use an exterior shell when a campus footprint is available.

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
  (`source-traced` or `schematic-demo`), provenance, coordinate system, sources,
  floors, `scheduleAliases`, and `knownUnmapped`.
- **Floor:** stable `id`, labels, vertical info, an `outline` made of one or more
  polygons (with holes), source transforms, rooms, `areas` (corridors,
  not-detailed regions, unlabeled rooms), `features` (stairs, elevators,
  entrances, restrooms), and sources.
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

It also warns about rooms outside their floor outline and label anchors outside
their room.

## Workflow: adding a building

The helper scripts live in `tools/indoor-trace/`. They need Python 3 with
Pillow, NumPy and SciPy. They only *suggest* outlines; a person reads every room
number.

1. **Find a source.** Look for official floor plans, department maps, posted
   evacuation diagrams, or building directories. Record the URL, page or image,
   access date, orientation, scale and revision. Don't use seating charts for
   placement: they describe the inside of one room, not where it is.
2. **Get the images and check the frame.** Keep them outside the repo, e.g. a
   scratch folder, and record their hashes. If one transform will cover several
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
   label, and mapped room against the source.

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

## Known limitations

- Facilities layouts include both positioned rooms and floor-only listings;
  room-level coverage varies by building. Additional sources for tracing or
  cross-checking are UCSD EH&S emergency pre-plan sheets
  (vector PDFs with every room number and a north arrow) that departments
  re-host. Found so far (accessed 2026-10-19):
  - CSB: https://cogsci.ucsd.edu/_files/resources/Cognitive%20Science%20Building_11-8-18.pdf (all classrooms)
  - SME: https://www.structures.ucsd.edu/sites/default/files/2016-06/SME%20Emergency%20info.pdf (all classrooms)
  - PSB: https://pharmacy.ucsd.edu/sites/default/files/docs/administration/EAP%20SSPPS2024%20(1).pdf (pages 12–17)
  - EBU1, EBU2, PFBH: EH&S evacuation map sets linked from
    https://jacobsschool.ucsd.edu/facilities/emergency (all classrooms)
  - IGPP: https://igpp.ucsd.edu/system/files/2024-11/IGPP_Munk_Lab.pdf and IGPP_4000.pdf
  - SERF floors 1–2 (classrooms are on 3, not found):
    https://cer.ucsd.edu/_files/resources/eap
  - MCTF: architect space plans in a CEQA filing (SCH 2017061003)
  - Price Center: https://universitycenters.ucsd.edu/_files/visit-us-files/PC_Directories11X17SU26__FNL.pdf
    (schematic, all levels)

  Weaker leads: UC Regents design packages (FAH, MALK, PODEM, CTL, RWAC, MOS;
  no room numbers), DIB room-layout crops, and the RBC wayfinding map.
- Floor heights, wall heights and the exploded spacing are illustrative.
  Shell floor counts are estimates from the roof height.
- Room-number floor inference has exceptions (e.g. RBC's 1301 is building 1,
  floor 3), so shells say "probably" for those floors.
- The model doesn't claim to match the building's footprint on the campus map.

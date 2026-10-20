# UCSD Classroom Explorer

Explore UC San Diego classrooms, check scheduled availability, and browse campus buildings in 3D.

**[Open the website](https://wenhaoquestion.github.io/ucsd-classrooms/)** · **[Explore EBU3B in 3D](https://wenhaoquestion.github.io/ucsd-classrooms/?building=EBU3B)** · **[Indoor geometry documentation](docs/indoor-geometry.md)**

基于 UCSD 课程表的教室查询工具，支持校园地图、课程与教师搜索、3D 楼宇外观，以及 EBU3B（CSE）的室内浏览。

![UCSD classroom schedules and campus map](static/open-graph.png)

## Features

- **Campus map:** locate buildings by name or code and view building photos.
- **Classroom schedules:** see listed classes and find gaps at a selected date and time.
- **Course and instructor search:** look up meeting locations, course times, and instructor schedules.
- **Quarter calendar:** browse academic terms, week numbers, and dates. Times use Pacific Time regardless of your browser's time zone.
- **Shareable links:** link directly to buildings, rooms, courses, instructors, and dates.
- **3D building explorer:** inspect campus building exteriors, nearby buildings, floor controls, and classroom counts. Buildings with public room geometry, currently EBU3B, also support room selection and schedule activity colors.
- **EBU3B indoor map:** browse five levels with 300 traced rooms and open schedules for mapped classrooms.
- **Room-list fallback:** schedules remain accessible when 3D is disabled or WebGL is unavailable. The browser remembers your 3D preference.

## Try it

1. Open the [live website](https://wenhaoquestion.github.io/ucsd-classrooms/).
2. Select a date and time, then choose a building on the map or use search.
3. Select a room to inspect its schedule.
4. For the indoor explorer, open [EBU3B](https://wenhaoquestion.github.io/ucsd-classrooms/?building=EBU3B). Try a mapped room such as [4140](https://wenhaoquestion.github.io/ucsd-classrooms/?building=EBU3B&room=4140).

## Run locally

Requires **Node.js 22** and npm. Commands work on Windows, macOS, and Linux.

```sh
git clone https://github.com/wenhaoquestion/ucsd-classrooms.git
cd ucsd-classrooms
npm ci
npm run dev
```

Open **http://localhost:8000/**. Building photos are hosted on Imgur, so use `localhost` if images do not load on `127.0.0.1`.

```sh
# Create the production site in dist/
npm run build

# Run the same checks used before deployment
npm run typecheck
npm run lint -- src scripts tests
npm test
npm run validate:indoor

# Rebuild the EBU3B runtime layout from its source data
npm run indoor:build -- EBU3B

# Convert downloaded public campus-map layers into exterior geometry
npm run campus:build -- footprints.json attributes.json
```

## Deploy to GitHub Pages

The site is a static frontend; no application server or API key is required. It loads classroom schedules and building photos from external public sources.

The [deployment workflow](.github/workflows/gh-pages.yml) runs on pushes to `main` and can also be started manually from the repository's Actions tab. It installs locked dependencies, runs validation, builds `dist/`, and publishes that directory to GitHub Pages.

In **Settings → Pages → Build and deployment**, use **GitHub Actions** as the source. Once deployment succeeds, the site is available at:

**https://wenhaoquestion.github.io/ucsd-classrooms/**

When deploying a different fork, update the site URL in `scripts/build.mjs`, the preview image URL in `static/index.html`, and the repository links in this README, `package.json`, and `src/components/App.tsx`.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/components/` | React application, schedules, search, and explorer UI |
| `src/explorer3d/` | Three.js renderer, indoor scenes, and particles |
| `src/lib/indoor/` | Layout schema, loading, geometry validation, and schedule mapping |
| `data/indoor/EBU3B/` | Source metadata, room labels, and traced floor geometry |
| `static/indoor/` | Runtime layouts fetched when a mapped building opens |
| `static/campus/` | Public campus-map footprints and ground/roof elevations |
| `scripts/` | Cross-platform build and indoor-data tooling |
| `tools/indoor-trace/` | Python helpers for tracing public floor maps |
| `tests/` | Indoor geometry, room status, and navigation tests |
| `docs/indoor-geometry.md` | Sources, accuracy limits, schema, and mapping workflow |

The frontend uses **React 19, TypeScript, Three.js, and esbuild**. The 3D scene is loaded on demand so the initial page does not need to download Three.js.

## Data and coverage

- **Schedules:** fetched from [SheepTester's public classroom data](https://sheeptester.github.io/uxdy/data/) by academic term. This repository does not run the schedule scraper. The interface displays data refresh information; availability reflects listed classes, not live occupancy or room reservations.
- **Campus exteriors:** public campus-map data supplies 585 footprint parts and matches 93 registrar building codes. Exterior-only views estimate floor counts and group classrooms by their room numbers; they do not invent room positions. TASB currently has no matching footprint.
- **Published indoor coverage:** EBU3B is the only building with published room-level geometry: levels B, 1, 2, 3, and 4, with 300 traced rooms. Twelve of the fifteen room keys found in the sampled FA25–FA26 schedules are placed. Rooms 1113, 1117, and 1124 remain searchable in the room list because their locations are not detailed on the source plans.
- **Geometry:** traced from the CSE department's public floor maps. Relative positions follow those maps; dimensions, vertical spacing, and floor heights are illustrative. This is not a surveyed building model.
- **Local preview differences:** optional Facilities layouts under `static/indoor/local/` are for local testing only. They and the `local/` tools/cache are git-ignored, excluded from production builds, and disabled in the production bundle. A fresh clone or the live website uses public room layouts and exterior shells, so it may show less indoor detail than a local preview containing those files.

See [Indoor geometry and the 3D building explorer](docs/indoor-geometry.md) for source links, known gaps, and instructions for adding another building. The optional tracing helpers require Python 3, Pillow, NumPy, and SciPy; running the website does not.

## Credits and license

This project extends [SheepTester/ucsd-classrooms](https://github.com/SheepTester/ucsd-classrooms), originally created by Sean (SheepTester). Earlier history is in [SheepTester/uxdy/classrooms](https://github.com/SheepTester/uxdy/tree/main/classrooms). This fork adds the building explorer, campus exteriors, traced EBU3B data, supporting tools, tests, and deployment updates.

The campus map was prepared with [SheepTester's UCSD map tool](https://sheeptester.github.io/words-go-here/misc/ucsd-map.html). Indoor source plans are credited in the [geometry documentation](docs/indoor-geometry.md).

Code is distributed under the [MIT License](LICENSE), retaining the original copyright notice. External maps, photos, and datasets remain attributed to their respective sources.

// Build Geisel Library's study-room layout from the campus map's per-floor
// extrusion and the library's floor maps.
// Run: node scripts/build-geisel-indoor.mjs
//
// Outlines: floors 3-8 come straight from the Geisel extrusion. Floors 1-2 are
// traced from the library maps because the extrusion only has a box for them.
// Rooms: tower maps (5-7) are drawn at one shared print scale that matches the
// extrusion's tower floors to within 0.5%, so they are placed by their outline
// boxes. Floors 1-2 have no common scale with anything else; they are scaled so
// the plan's bounding box has the area of the extrusion's floor 1-2 box.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const extrusion = read("data/indoor/GEISEL/extrusion.json");
const trace = read("data/indoor/GEISEL/trace.json");

const FEET = 0.3048;
// Same projection as src/lib/indoor/campus.ts
const ORIGIN = [32.8801, -117.234];
const M_LAT = 110_574;
const M_LON = 111_320 * Math.cos((ORIGIN[0] * Math.PI) / 180);
const campus = ([lon, lat]) => [(lon - ORIGIN[1]) * M_LON, -(lat - ORIGIN[0]) * M_LAT];
const round = (n) => Math.round(n * 100) / 100;

/** Drops the closing point and vertices closer than `min` to the last kept one. */
function clean(ring, min = 0.3) {
  const out = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= min) {
      out.push(point);
    }
  }
  while (out.length > 3 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < min) {
    out.pop();
  }
  return out;
}

const bbox = (points) => {
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
};

const extruded = new Map(
  extrusion.floors.map((floor) => [`L${floor.floor}`, { ...floor, rings: floor.rings.map((r) => r.map(campus)) }])
);
// Local (0, 0) is the middle of the widest tower floor
const [x0, z0, x1, z1] = bbox(extruded.get("L6").rings[0]);
const center = [round((x0 + x1) / 2), round((z0 + z1) / 2)];
const local = ([x, z]) => [round(x - center[0]), round(z - center[1])];

const MAP_SOURCE = (id) => `GEISEL-MAP-${id}`;
const EXTRUSION = "GEISEL-EXTRUSION";
const LIBCAL = "LIBCAL-GEISEL";

/** Pixel -> local transform for a floor map, fitted to the extrusion's box. */
function fitMap(floorId, pdfBox, uniform) {
  const map = trace.maps[floorId];
  const [ex0, ez0, ex1, ez1] = bbox(extruded.get(floorId).rings[0].map(local));
  const [px0, py0, px1, py1] = pdfBox;
  const scale = uniform
    ? ((ex1 - ex0) / (px1 - px0) + (ez1 - ez0) / (py1 - py0)) / 2
    : Math.sqrt(((ex1 - ex0) * (ez1 - ez0)) / ((px1 - px0) * (py1 - py0)));
  const originPx = [
    (px0 + px1) / 2 - (ex0 + ex1) / 2 / scale,
    (py0 + py1) / 2 - (ez0 + ez1) / 2 / scale,
  ];
  return {
    transform: {
      source: MAP_SOURCE(floorId),
      imageSizePx: map.pageSize,
      originPx: originPx.map((n) => Math.round(n * 10) / 10),
      rotationDeg: 0,
      scale: Math.round(scale * 1e5) / 1e5,
      note: uniform
        ? "Tower maps share one print scale; the outline box is fitted to the campus-map extrusion of this floor (x and z scales agree within 0.5%)."
        : "No scale on the map. Uniform scale chosen so the plan's bounding box has the area of the extrusion's floor 1-2 box, centered on it; approximate.",
    },
    point: ([u, v]) => [round((u - originPx[0]) * scale), round((v - originPx[1]) * scale)],
  };
}

const floors = [];
for (const [index, floor] of extrusion.floors.entries()) {
  const id = `L${floor.floor}`;
  const next = extrusion.floors[index + 1];
  const base = floor.absoluteheight * FEET;
  const height = (next ? next.absoluteheight - floor.absoluteheight : floor.height) * FEET;
  const measured = trace.floors[id];
  const map = trace.maps[id];
  const fit = measured
    ? measured.outlinePx
      ? fitMap(id, bbox(measured.outlinePx), false)
      : fitMap(id, measured.outlineBoxPx, true)
    : null;
  if (measured && !map) {
    throw new Error(`${id}: measured without a map source`);
  }
  const mapRef = (region) => ({ source: MAP_SOURCE(id), page: 1, ...(region ? { region } : {}) });

  const outline = measured?.outlinePx
    ? [{ outer: clean(measured.outlinePx.map(fit.point)) }]
    : extruded.get(id).rings.map((ring) => ({ outer: clean(ring.map(local)) }));

  const rooms = (measured?.rooms ?? []).map((room) => {
    const bookable = room.group || !room.name;
    return {
      id: `${id}-${room.label.replace(/[^0-9A-Za-z]+/g, "-")}`,
      label: room.label,
      ...(room.name ? { name: room.name } : {}),
      scheduleKey: null,
      type: bookable ? "study-room" : "other",
      floor: id,
      footprint: { outer: clean(room.px.map(fit.point), 0.05) },
      confidence: {
        location: "approximate",
        shape: room.group ? "approximate" : "traced",
        label: "direct",
      },
      sources: [mapRef(room.group ? room.label : `Room ${room.label}`), ...(bookable ? [{ source: LIBCAL }] : [])],
      notes: [
        ...(room.note ? [room.note] : []),
        ...(room.group ? [] : ["Blue room tile on the library map; its size is the tile's, not a measured room."]),
      ],
    };
  });

  // Other named spaces on the map: shown for context, never bookable here
  for (const space of measured?.spaces ?? []) {
    rooms.push({
      id: `${id}-${space.label.replace(/[^0-9A-Za-z]+/g, "-")}`,
      label: space.label,
      ...(space.name ? { name: space.name } : {}),
      scheduleKey: null,
      type: "other",
      floor: id,
      footprint: { outer: clean(space.px.map(fit.point), 0.05) },
      confidence: { location: "approximate", shape: "approximate", label: "direct" },
      sources: [mapRef(space.label)],
    });
  }

  const areas = [
    ...(measured?.courtyardsPx ?? []).map((ring, i) => ({
      id: `${id}-courtyard-${i + 1}`,
      kind: "courtyard",
      label: "Inaccessible courtyard",
      footprint: { outer: clean(ring.map(fit.point)) },
      confidence: "approximate",
      sources: [mapRef("Inaccessible Courtyard")],
    })),
    // Elevator and restroom blocks, drawn blue without a room label
    ...(measured?.coresPx ?? []).map((ring, i) => ({
      id: `${id}-core-${i + 1}`,
      kind: "unlabeled-room",
      footprint: { outer: clean(ring.map(fit.point), 0.05) },
      confidence: "approximate",
      sources: [mapRef("elevator and restroom block")],
    })),
    ...(measured?.staffPx ?? []).map((ring, i) => ({
      id: `${id}-staff-${i + 1}`,
      kind: "not-detailed",
      footprint: { outer: clean(ring.map(fit.point)) },
      confidence: "approximate",
      sources: [mapRef("gray area without detail")],
      notes: ["Filled gray on the library map, which shows no rooms or labels here (not public library space)."],
    })),
  ];

  const features = [];
  if (measured?.entrancePx) {
    features.push({ id: `${id}-entrance`, kind: "entrance", label: "Main entrance", at: fit.point(measured.entrancePx),
      confidence: "approximate", sources: [mapRef("MAIN ENTRANCE")] });
  }
  for (const [i, at] of (measured?.stairsPx ?? []).entries()) {
    features.push({ id: `${id}-stairs-${i + 1}`, kind: "stairs", at: fit.point(at), confidence: "approximate", sources: [mapRef("stair symbol")] });
  }
  if (measured?.elevatorPx) {
    features.push({ id: `${id}-elevator`, kind: "elevator", at: fit.point(measured.elevatorPx), confidence: "approximate", sources: [mapRef("elevator symbol")] });
  }
  for (const [i, at] of (measured?.restroomsPx ?? []).entries()) {
    features.push({ id: `${id}-restroom-${i + 1}`, kind: "restroom", label: i ? "Inclusive restrooms" : "Restrooms", at: fit.point(at),
      confidence: "approximate", sources: [mapRef("restroom symbol")] });
  }

  floors.push({
    id,
    label: `Floor ${floor.floor}`,
    shortLabel: `${floor.floor}`,
    vertical: {
      baseElevation: round(base),
      height: round(height),
      estimated: false,
      note: "Floor elevations from the campus map's Geisel extrusion, converted from feet.",
    },
    outline,
    outlineConfidence: measured?.outlinePx ? "approximate" : "direct",
    ...(fit ? { transforms: [fit.transform] } : {}),
    rooms,
    ...(areas.length ? { areas } : {}),
    ...(features.length ? { features } : {}),
    sources: [{ source: EXTRUSION, region: floor.floorname }, ...(map ? [mapRef()] : [])],
    ...(id === "L3"
      ? { notes: ["The plaza-level pedestal: the central core and the 20 columns that carry the tower."] }
      : measured?.outlinePx
      ? { notes: ["Outline traced from the library map; the campus-map extrusion only has a box for this floor."] }
      : {}),
  });
}

const sources = [
  ...Object.entries(trace.maps).map(([id, map]) => ({
    id: MAP_SOURCE(id),
    title: `Geisel ${id.slice(1)}${["st", "nd", "rd"][Number(id.slice(1)) - 1] ?? "th"} floor map`,
    url: map.url,
    publisher: "UC San Diego Library",
    building: "GEISEL",
    floors: [id],
    page: 1,
    accessed: trace.accessed,
    orientation:
      "No north arrow. Floors 1-2 label Geisel West on the left and Geisel East on the right, so page-up is taken as north on every map.",
    scale: "No scale bar.",
    revision: map.modified,
    notes: [`Source SHA-256: ${map.sha256}`],
  })),
  {
    id: EXTRUSION,
    title: "Geisel_Extrusion (UC San Diego campus map)",
    url: "https://services9.arcgis.com/mXNwDpiENQiMIzRv/ArcGIS/rest/services/Geisel_Extrusion/FeatureServer",
    publisher: "UC San Diego",
    building: "GEISEL",
    floors: floors.map((floor) => floor.id),
    accessed: extrusion.accessed,
    orientation: "Geographic (WGS84).",
    scale: "Geographic; heights in feet.",
    notes: [extrusion.note],
  },
  {
    id: LIBCAL,
    title: "Geisel Library study room reservations (LibCal)",
    url: "https://ucsd.libcal.com/spaces?lid=11273",
    publisher: "UC San Diego Library",
    building: "GEISEL",
    floors: ["L1", "L2", "L5", "L6", "L7"],
    accessed: trace.accessed,
    notes: ["Room names, capacities and booking IDs; live availability is fetched separately."],
  },
];

const layout = {
  schemaVersion: 1,
  building: "GEISEL",
  name: "Geisel Library",
  geometryStatus: "source-traced",
  provenance:
    "Floor shapes and heights from the campus map's Geisel model; study rooms placed from the UC San Diego Library's floor maps. Bookings come live from the library's LibCal system.",
  coordinateSystem: {
    units: "meters",
    description: "Meters east (x) and south (z) of the middle of the 6th floor, aligned with the campus map.",
    northDeg: 0,
    northNote: "Outlines are geographic. Room positions assume the library maps are drawn north-up (see the map sources).",
  },
  sources,
  floors,
  knownUnmapped: [],
  notes: [
    "Floors 1-2 show study rooms as labeled blocks; individual rooms in a block are listed in the booking panel, not drawn.",
    "Floors 4 and 8 have no bookable rooms; their maps only show the central core.",
  ],
};

writeFileSync(new URL("static/indoor/GEISEL.json", root), JSON.stringify(layout) + "\n");
console.log(
  `GEISEL: ${floors.length} floors, ${floors.reduce((n, f) => n + f.rooms.length, 0)} rooms; tower scales ${floors
    .flatMap((f) => f.transforms ?? [])
    .map((t) => t.scale)
    .join(", ")}`
);

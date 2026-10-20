// Converts a pixel-space trace (data/indoor/<CODE>/trace.json, produced with
// the helpers in tools/indoor-trace/) plus hand-written metadata
// (data/indoor/<CODE>/meta.json) into the runtime layout at
// static/indoor/<CODE>.json, then validates it.
//
//   npm run indoor:build -- EBU3B
//
// See docs/indoor-geometry.md for the full workflow.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pixelToLocal, signedArea } from "../src/lib/indoor/geometry";
import {
  INDOOR_SCHEMA_VERSION,
  IndoorArea,
  IndoorBuilding,
  IndoorFeature,
  IndoorFloor,
  IndoorRoom,
  IndoorSource,
  Point2,
  RoomType,
  SourceTransform,
} from "../src/lib/indoor/schema";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";

type PixelRing = [number, number][];

type TraceFloor = {
  image: string;
  size: [number, number];
  outline: PixelRing[];
  shaded: PixelRing[];
  rooms: {
    label: string;
    kind: string;
    method: "trace" | "hull" | "manual";
    polygon: PixelRing;
    labelAt: [number, number];
  }[];
  unlabeledRegions: { id: number; kind: string; polygon: PixelRing }[];
};

type Meta = {
  building: string;
  name: string;
  geometryStatus: IndoorBuilding["geometryStatus"];
  provenance: string;
  transform: Omit<SourceTransform, "source" | "imageSizePx">;
  coordinateSystem: IndoorBuilding["coordinateSystem"];
  storyHeight: number;
  storyHeightNote: string;
  sources: IndoorSource[];
  floors: {
    id: string;
    label: string;
    shortLabel: string;
    trace: string;
    source: string;
    story: number;
  }[];
  legendTypes: Record<string, RoomType>;
  rooms: Record<string, { name?: string; type?: RoomType; scheduleKey?: string }>;
  scheduleKeyNote: string;
  notDetailed?: Record<string, string>;
  features?: Record<
    string,
    { kind: IndoorFeature["kind"]; at: [number, number]; label?: string; note?: string }[]
  >;
  knownUnmapped?: IndoorBuilding["knownUnmapped"];
  geo?: IndoorBuilding["geo"];
  notes?: string[];
};

/** Pixel area of a ring, used to drop specks of linework from the outline. */
const MIN_OUTLINE_PART_PX = 3000;

const code = process.argv[2];
if (!code) {
  console.error("usage: npm run indoor:build -- <BUILDING CODE>");
  process.exit(1);
}
const meta: Meta = JSON.parse(readFileSync(`data/indoor/${code}/meta.json`, "utf8"));
const trace: Record<string, TraceFloor> = JSON.parse(
  readFileSync(`data/indoor/${code}/trace.json`, "utf8")
);

function toLocalRing(ring: PixelRing): Point2[] {
  const points: Point2[] = [];
  for (const pixel of ring) {
    const point = pixelToLocal(pixel, meta.transform);
    const last = points[points.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) {
      points.push(point);
    }
  }
  const [first, last] = [points[0], points[points.length - 1]];
  if (points.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return points;
}

const floors: IndoorFloor[] = meta.floors.map((floorMeta): IndoorFloor => {
  const data = trace[floorMeta.trace];
  if (!data) {
    throw new Error(`trace.json has no floor ${floorMeta.trace}`);
  }
  const floorRef = { source: floorMeta.source };
  const rooms = data.rooms.map((room): IndoorRoom => {
    const override = meta.rooms[room.label] ?? {};
    const notes: string[] = [];
    if (room.method === "hull") {
      notes.push(
        "Outline is the convex hull of the traced fill, which text or pale coloring broke up. Approximate."
      );
    } else if (room.method === "manual") {
      notes.push("Hand-placed rectangle; the room's fill was too small to segment. Approximate.");
    }
    if (override.scheduleKey) {
      notes.push(meta.scheduleKeyNote);
    }
    return {
      id: `${code}-${room.label}`,
      label: room.label,
      ...(override.name ? { name: override.name } : {}),
      scheduleKey: override.scheduleKey ?? null,
      type: override.type ?? meta.legendTypes[room.kind] ?? "unknown",
      floor: floorMeta.id,
      footprint: { outer: toLocalRing(room.polygon) },
      labelAt: pixelToLocal(room.labelAt, meta.transform),
      confidence: {
        location: "traced",
        shape: room.method === "trace" ? "traced" : "approximate",
        label: "direct",
      },
      sources: override.scheduleKey
        ? [floorRef, { source: "REGISTRAR-SCHEDULES", note: "Schedule key" }]
        : [floorRef],
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
  const roomLabelPoints = data.rooms.map((room) => room.labelAt);
  const outline = data.outline
    .filter(
      (ring) =>
        Math.abs(signedArea(ring)) >= MIN_OUTLINE_PART_PX ||
        roomLabelPoints.some(
          ([x, y]) =>
            x >= Math.min(...ring.map((p) => p[0])) &&
            x <= Math.max(...ring.map((p) => p[0])) &&
            y >= Math.min(...ring.map((p) => p[1])) &&
            y <= Math.max(...ring.map((p) => p[1]))
        )
    )
    .map((ring) => ({ outer: toLocalRing(ring) }));
  const areas: IndoorArea[] = [
    ...data.shaded.map(
      (ring, i): IndoorArea => ({
        id: `${code}-${floorMeta.id}-not-detailed-${i + 1}`,
        kind: "not-detailed",
        label: "Not detailed on source map",
        footprint: { outer: toLocalRing(ring) },
        confidence: "traced",
        sources: [floorRef],
        notes: meta.notDetailed?.[floorMeta.id] ? [meta.notDetailed[floorMeta.id]] : [],
      })
    ),
    ...data.unlabeledRegions.map(
      (region): IndoorArea => ({
        id: `${code}-${floorMeta.id}-unlabeled-${region.id}`,
        kind: "unlabeled-room",
        footprint: { outer: toLocalRing(region.polygon) },
        confidence: "traced",
        sources: [floorRef],
        notes: ["A filled space on the map with no room number printed."],
      })
    ),
  ];
  const features = (meta.features?.[floorMeta.id] ?? []).map(
    (feature, i): IndoorFeature => ({
      id: `${code}-${floorMeta.id}-${feature.kind}-${i + 1}`,
      kind: feature.kind,
      ...(feature.label ? { label: feature.label } : {}),
      at: pixelToLocal(feature.at, meta.transform),
      confidence: "approximate",
      sources: [floorRef],
      ...(feature.note ? { notes: [feature.note] } : {}),
    })
  );
  return {
    id: floorMeta.id,
    label: floorMeta.label,
    shortLabel: floorMeta.shortLabel,
    vertical: {
      baseElevation: floorMeta.story * meta.storyHeight,
      height: meta.storyHeight,
      estimated: true,
      note: meta.storyHeightNote,
    },
    outline,
    outlineConfidence: "traced",
    transforms: [
      { source: floorMeta.source, imageSizePx: data.size, ...meta.transform },
    ],
    rooms,
    areas,
    features,
    sources: [floorRef, { source: "CSE-FLOORMAPS" }].filter(
      (ref) => meta.sources.some((source) => source.id === ref.source)
    ),
    ...(meta.notDetailed?.[floorMeta.id]
      ? { notes: [meta.notDetailed[floorMeta.id]] }
      : {}),
  };
});

const building: IndoorBuilding = {
  schemaVersion: INDOOR_SCHEMA_VERSION,
  building: meta.building,
  name: meta.name,
  geometryStatus: meta.geometryStatus,
  provenance: meta.provenance,
  coordinateSystem: meta.coordinateSystem,
  sources: meta.sources,
  floors,
  knownUnmapped: meta.knownUnmapped,
  geo: meta.geo,
  notes: meta.notes,
};

const { ok, issues } = validateIndoorBuilding(building, code);
for (const issue of issues) {
  console.log(`${issue.level.toUpperCase()} ${issue.path}: ${issue.message}`);
}
if (!ok) {
  console.error(`${code}: validation failed; nothing written.`);
  process.exit(1);
}
mkdirSync("static/indoor", { recursive: true });
writeFileSync(`static/indoor/${code}.json`, JSON.stringify(building));
const roomCount = floors.reduce((acc, floor) => acc + floor.rooms.length, 0);
console.log(
  `${code}: wrote static/indoor/${code}.json (${floors.length} floors, ${roomCount} rooms, ${issues.length} warnings)`
);

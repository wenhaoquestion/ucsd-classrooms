// Rebuild the reviewed FAH classroom supplement from retained pixel traces.
// Run: node scripts/build-fah-indoor.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const trace = read("data/indoor/FAH/trace.json");
const meta = read("data/indoor/FAH/meta.json");
const previous = read("static/indoor/facilities/FAH.json");
const original = new URL(trace.sourcePdf, root);
if (existsSync(original) && createHash("sha256").update(readFileSync(original)).digest("hex") !== trace.sourceSha256) {
  throw new Error("FAH PDF changed; review the source and pixel trace before rebuilding.");
}
const expected = new Set(previous.floors.flatMap((f) => [...f.rooms, ...(f.unplaced ?? [])]).flatMap((r) => r.scheduleKey ? [r.scheduleKey] : []));
const handled = new Set();
const round = (n) => Math.round(n * 1000) / 1000;
const floors = trace.floors.map((floor, index) => {
  const prior = previous.floors.find((f) => f.id === floor.id);
  if (!prior || prior.rooms.length) throw new Error(`FAH ${floor.id}: unexpected prior room geometry; preserve it before rebuilding.`);
  const originPx = [floor.anchorPx[0] + 23 / floor.scale, floor.anchorPx[1] - 7 / floor.scale];
  const point = ([x, z]) => [round((x - originPx[0]) * floor.scale), round((z - originPx[1]) * floor.scale)];
  const polygon = (p) => ({ outer: p.outer.map(point), ...(p.holes?.length ? { holes: p.holes.map((ring) => ring.map(point)) } : {}) });
  const ref = { source: meta.source.id, page: floor.page };
  const rooms = floor.rooms.map((room) => {
    if (!expected.has(room.label) || handled.has(room.label)) throw new Error(`Invalid FAH schedule key ${room.label}.`);
    handled.add(room.label);
    return { id: `FAH-${room.label}`, label: room.label, scheduleKey: room.label, type: "classroom", floor: floor.id,
      footprint: polygon({ outer: room.polygon }), labelAt: point(room.labelAt),
      confidence: { location: "traced", shape: "approximate", label: "direct" },
      sources: [ref, { source: "UCSD-FIS", note: "Exact schedule key and original floor listing" }], notes: [room.note] };
  });
  const unplaced = (prior.unplaced ?? []).filter((room) => !handled.has(room.scheduleKey));
  for (const room of unplaced) if (room.scheduleKey) handled.add(room.scheduleKey);
  return { id: floor.id, label: floor.label, shortLabel: floor.shortLabel,
    vertical: { baseElevation: index * 4.2, height: 4.2, estimated: true, note: "Illustrative spacing in relative units; floor elevations are not supplied by this source." },
    outline: floor.outline.map(polygon), outlineConfidence: "approximate",
    transforms: [{ source: meta.source.id, imageSizePx: trace.render.size, originPx, rotationDeg: 0, scale: floor.scale,
      note: "Approximate registration by matching common-core walls; no metric or campus placement claimed." }],
    rooms, unplaced, areas: [], features: [], sources: [ref, { source: "UCSD-FIS", note: "Preserved floor and unplaced-room inventory" }],
    notes: ["Only two exact first-floor classroom labels receive room polygons. Floor silhouette and open atria are simplified traces."] };
});
for (const floor of previous.floors) if (!floors.some((f) => f.id === floor.id)) throw new Error(`Would omit prior floor ${floor.id}.`);
for (const key of expected) if (!handled.has(key)) throw new Error(`Would omit prior FAH schedule key ${key}.`);
const building = { schemaVersion: 1, building: "FAH", name: meta.name, geometryStatus: "source-traced",
  provenance: "Two classroom positions and four floor silhouettes traced from UC San Diego EH&S plans. Room 1301 is listed on Level 1 but remains unplaced; floor alignment and heights are approximate.",
  coordinateSystem: { units: "relative", description: "First-floor reference: one unit per ten rendered pixels. Other pages are approximately aligned by common-core walls; these units are not meters.", northDeg: 0, northNote: "Printed north arrows point up." },
  sources: [meta.source, previous.sources.find((s) => s.id === "UCSD-FIS")], floors,
  knownUnmapped: previous.knownUnmapped ?? [], notes: meta.notes };
const outputUrl = new URL("static/indoor/FAH.json", root);
const savedOutput = existsSync(outputUrl) ? readFileSync(outputUrl) : undefined;
writeFileSync(outputUrl, JSON.stringify(building));
console.log(`FAH: 2 placed rooms, ${floors.flatMap((f) => f.unplaced).length} floor-only room, ${floors.length} retained floors.`);
// Keep the reviewed public-raster auditorium when rebuilding this older base.
// The Python entry point invokes this file with FAH_BASE_ONLY to avoid recursion.
if (!process.env.FAH_BASE_ONLY && existsSync(new URL("data/indoor/FAH/fis-1301-trace.json", root))) {
  const supplement = spawnSync("python", ["scripts/supplement-fah-1301.py", "--from-base"], {
    cwd: fileURLToPath(root), stdio: "inherit",
  });
  if (supplement.error || supplement.status !== 0) {
    // A missing ignored source raster must not discard an existing reviewed room.
    if (savedOutput) writeFileSync(outputUrl, savedOutput);
    if (supplement.error) throw supplement.error;
    throw new Error(`FAH 1301 supplement failed (${supplement.status}).`);
  }
}

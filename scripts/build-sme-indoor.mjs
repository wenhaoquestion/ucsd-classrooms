// Rebuild the reviewed SME trace without downloading or modifying its inputs.
// Run: node scripts/build-sme-indoor.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const trace = read("data/indoor/SME/trace.json");
const meta = read("data/indoor/SME/meta.json");
const previous = read("static/indoor/facilities/SME.json");
const original = new URL(trace.sourcePdf, root);
if (existsSync(original)) {
  const hash = createHash("sha256").update(readFileSync(original)).digest("hex");
  if (hash !== trace.sourceSha256) throw new Error("SME source PDF checksum changed; review the trace before rebuilding.");
}

const expected = new Set(previous.floors.flatMap((floor) =>
  [...floor.rooms, ...(floor.unplaced ?? [])].flatMap((room) => room.scheduleKey ? [room.scheduleKey] : [])
));
const placed = new Set();
const round = (n) => Math.round(n * 1000) / 1000;
const floors = trace.floors.map((floor, index) => {
  // Center the registered lab wing and eastern wing in one relative frame.
  const originPx = [floor.anchorPx[0] + 78 / floor.scale, floor.anchorPx[1] + 20 / floor.scale];
  const point = ([x, z]) => [round((x - originPx[0]) * floor.scale), round((z - originPx[1]) * floor.scale)];
  const ref = { source: meta.source.id, page: floor.page };
  return {
    id: floor.id, label: floor.label, shortLabel: floor.shortLabel,
    vertical: { baseElevation: (index - 1) * 4.2, height: 4.2, estimated: true,
      note: "Illustrative spacing in relative drawing units; floor elevations are not supplied by the PDF." },
    outline: floor.outline.map((ring) => ({ outer: ring.map(point) })),
    outlineConfidence: "approximate",
    transforms: [{ source: meta.source.id, imageSizePx: trace.render.size, originPx, rotationDeg: 0, scale: floor.scale,
      note: "Page-specific translation and scale registered by corresponding main lab-wing walls. Cross-floor alignment is approximate." }],
    rooms: floor.rooms.map((room) => {
      if (!expected.has(room.label)) throw new Error(`SME ${room.label} is not in the existing schedule-key inventory.`);
      if (placed.has(room.label)) throw new Error(`Duplicate SME schedule key ${room.label}.`);
      placed.add(room.label);
      return {
        id: `SME-${room.label}`, label: room.label, scheduleKey: room.label, type: "unknown", floor: floor.id,
        footprint: { outer: room.polygon.map(point) }, labelAt: point(room.labelAt),
        confidence: { location: "traced", shape: "approximate", label: "direct" },
        sources: [ref, { source: "SME-FIS-ROOM-LIST", note: "Schedule-key inventory and prior floor listing" }],
        notes: ["Visible room walls were manually traced from the PDF. Small door recesses and columns are simplified; curved walls use short straight segments.",
          "The source does not establish the current use of every scheduled room; room type is left unknown."],
      };
    }),
    unplaced: [], areas: [], features: [], sources: [ref],
    notes: ["Only scheduled rooms have interior polygons. Other spaces are represented by the approximate floor silhouette."]
  };
});
for (const key of expected) if (!placed.has(key)) throw new Error(`SME trace is missing prior schedule key ${key}.`);

const building = {
  schemaVersion: 1, building: "SME", name: meta.name, geometryStatus: "source-traced",
  provenance: "Classroom positions traced from UC San Diego EH&S floor plans dated July 2021. Room outlines are simplified; floor alignment and heights are approximate.",
  coordinateSystem: { units: "relative", description: "Upper-floor reference frame: approximately 1 unit per 10 rendered pixels. Individual page scales are normalized by corresponding lab-wing walls; these units are not meters.", northDeg: 0,
    northNote: "The north arrow printed on each plan points up." },
  sources: [meta.source, { id: "SME-FIS-ROOM-LIST", title: "UCSD Facilities SME room listings", url: "https://facilities.ucsd.edu/Buildings/Viewer/Default.htm?bkey=883",
    publisher: "UC San Diego Facilities", building: "SME", floors: floors.map((floor) => floor.id), accessed: "2026-10-19",
    notes: ["The existing Facilities layout supplies the exact schedule-room keys; its geometry is not reused."] }],
  floors, knownUnmapped: meta.knownUnmapped, notes: meta.notes
};
const output = new URL("static/indoor/SME.json", root);
writeFileSync(output, JSON.stringify(building));
console.log(`SME: ${placed.size} scheduled rooms on ${floors.length} floors written to ${fileURLToPath(output)}`);

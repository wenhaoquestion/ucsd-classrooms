// Rebuild the MCC identity correction; run from the repository root:
// npx esbuild scripts/correct-mcc-indoor.ts --bundle --platform=node --format=esm --outfile=.test-build/correct-mcc-indoor.mjs
// node .test-build/correct-mcc-indoor.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CampusData, lonLatToCampus } from "../src/lib/indoor/campus";
import { pointInPolygon } from "../src/lib/indoor/geometry";
import { IndoorBuilding, IndoorSource } from "../src/lib/indoor/schema";
import { buildExteriorShell } from "../src/lib/indoor/shell";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const originalPath = "static/indoor/facilities/MCC.json";
const campusPath = "static/campus/buildings.json";
const outputPath = "data/indoor/MCC/corrected-base.json";
const original: IndoorBuilding = read(originalPath);
const campus: CampusData = read(campusPath);
const metadata = read("src/lib/buildings.json");
const campusCodes = read("src/lib/indoor/campusCodes.json");
const name = "Media Center and Communication Building";
const keys = ["127", "133", "139", "140", "201", "221", "222", "250"];
const originalKeys = new Set(original.floors.flatMap((floor) =>
  [...floor.rooms, ...(floor.unplaced ?? [])].flatMap((room) => room.scheduleKey ? [room.scheduleKey] : [])
));
assert.deepEqual([...originalKeys].sort(), keys, "Review a changed MCC schedule inventory before rebuilding.");
assert.deepEqual(original.geo?.caans, ["6551"], "The retained original should be the rejected Cancer Center layout.");
assert.deepEqual(campusCodes.MCC, ["6614"]);
assert.equal(metadata.colleges.marshall.MCC.name, name);
assert.ok(!metadata.colleges.health?.MCC);

const parts = campus.buildings.filter((part) => part.caan === "6614");
assert.equal(parts.length, 1);
assert.equal(parts[0].name, "Communication");
const location: [number, number] = metadata.colleges.marshall.MCC.location;
const marker = lonLatToCampus(location[1], location[0]);
assert.ok(parts.some((part) => part.rings.some((ring) => pointInPolygon(marker, { outer: ring }))),
  "MCC marker must be inside the official Communication footprint.");

const sources: IndoorSource[] = [
  {
    id: "MCC-DEPARTMENT-CONTACT", title: "Department of Communication: Contact Us",
    url: "https://communication.ucsd.edu/about/contact.html", publisher: "UC San Diego Department of Communication",
    building: "MCC", floors: ["L1", "L2"], accessed: "2026-10-21",
    notes: ["Identifies MCC as Media Center and Communication Building and places the department on the west campus. Establishes building identity, not room geometry."],
  },
  {
    id: "MCC-FACILITY-ADDRESS", title: "Space Planning Live Density Program",
    url: "https://facilityservices.ucsd.edu/information/density.html", publisher: "UC San Diego Facility Services",
    building: "MCC", floors: ["L1", "L2"], accessed: "2026-10-21",
    notes: ["Lists Communication Building in Marshall at 3010 Exploration Drive, with the first and second floors. Does not provide classroom boundaries or measured floor heights."],
  },
  {
    id: "MCC-DEMOCRACY-LAB", title: "Democracy Lab facilities",
    url: "https://democracylab.ucsd.edu/facilities/democracy-lab", publisher: "UC San Diego Department of Communication",
    building: "MCC", floors: ["L2"], accessed: "2026-10-21",
    notes: ["Identifies Democracy Lab as MCC 250 and links access to the Communication building. Corroborates the schedule room and building; the second-floor assignment remains inferred from its number."],
  },
];
const layout = buildExteriorShell("MCC", name, campus, ["6614"], keys);
assert.ok(layout);
layout.provenance = "Exterior footprint and height from the official campus map for the Communication Building (CAAN 6614). No classroom geometry is available; room floors are inferred from their numbers and floor heights are estimated.";
layout.sources.push(...sources);
layout.geo!.note = "Official campus-map Communication footprint (CAAN 6614); no indoor plan or room registration is claimed.";
layout.notes = [
  "MCC in these course schedules refers to Media Center and Communication Building, not Moores Cancer Center.",
  "The retained Facilities input for CAAN 6551 / bkey 629 belongs to Cancer Center. Its B221 and 2250 polygons, all other room polygons, room areas and floor assignments are rejected for this schedule code.",
  "Only the eight exact schedule keys are retained from that input. All remain unplaced; no room areas are transferred.",
  "Both displayed floor outlines reuse the campus exterior footprint. They are not surveyed floor boundaries or an indoor floor plan.",
];
for (const floor of layout.floors) {
  floor.sources.push({ source: "MCC-FACILITY-ADDRESS", note: "Building identity and existence of this floor only; no room geometry." });
  floor.notes = ["Exterior outline repeated for orientation. Classroom positions are unknown; floor assignment is by room number only."];
}
assert.deepEqual(layout.floors.map((floor) => floor.id), ["L1", "L2"]);
assert.deepEqual(layout.floors.flatMap((floor) => floor.unplaced ?? []).map((room) => room.scheduleKey).sort(), keys);
assert.ok(layout.floors.every((floor) => floor.rooms.length === 0 && floor.vertical.estimated));
assert.ok(layout.floors.flatMap((floor) => floor.unplaced ?? []).every((room) => room.basis === "room-number" && room.areaSqft === undefined));
const validation = validateIndoorBuilding(layout, "MCC");
assert.ok(validation.ok, JSON.stringify(validation.issues));

const oldOrigin = original.geo!.origin;
const distanceMeters = Math.hypot(oldOrigin[0] - marker[0], oldOrigin[1] - marker[1]);
const audit = {
  schemaVersion: 1, building: "MCC", reviewed: "2026-10-21", output: outputPath,
  inputHashes: { [originalPath]: sha256(originalPath), [campusPath]: sha256(campusPath) },
  evidence: sources,
  rejected: {
    input: originalPath, name: original.name, caans: original.geo!.caans,
    source: original.sources.find((source) => source.id === "UCSD-FIS"),
    polygons: original.floors.reduce((count, floor) => count + floor.rooms.length, 0),
    scheduleMappings: original.floors.flatMap((floor) => floor.rooms.filter((room) => room.scheduleKey).map((room) => ({
      id: room.id, floor: floor.id, scheduleKey: room.scheduleKey, notes: room.notes,
    }))),
    retainedForAuditOnly: true,
  },
  corrected: { name, college: "marshall", caans: ["6614"], location, campusPoint: marker,
    sourceCampusParts: parts, distanceFromRejectedOriginMeters: Math.round(distanceMeters * 10) / 10,
    geometryStatus: layout.geometryStatus, placedScheduleKeys: 0, unplacedScheduleKeys: keys,
    floors: layout.floors.map((floor) => ({ id: floor.id, keys: floor.unplaced!.map((room) => room.scheduleKey) })),
    indoorGeometryAvailable: false, floorAssignments: "room-number inference", floorHeights: "estimated",
  },
  validation,
};
mkdirSync("data/indoor/MCC", { recursive: true });
writeFileSync(outputPath, JSON.stringify(layout, null, 2) + "\n");
writeFileSync("data/indoor/MCC/identity-correction.json", JSON.stringify(audit, null, 2) + "\n");
console.log(`MCC: corrected to Communication / CAAN 6614, ${Math.round(distanceMeters)} m from rejected Cancer Center; 0 placed, ${keys.length} unplaced; validation ${validation.ok ? "passed" : "failed"}.`);

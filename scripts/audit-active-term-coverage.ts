/** Full-term audit using the site's real schedule parser, aggregator and indoor index.
 * Run with: node scripts/audit-active-term-coverage.mjs
 * The original layout-key coverage baseline is deliberately not an input.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { coursesFromFile } from "../src/lib/coursesFromFile";
import { coursesToClassrooms } from "../src/lib/coursesToClassrooms";
import { CAMPUS_CODES, INDOOR_MANIFEST } from "../src/lib/indoor/manifest";
import { indexIndoorBuilding, roomForKey } from "../src/lib/indoor/roomMapping";
import { polygonArea } from "../src/lib/indoor/geometry";
import { floorIdForRoomKey } from "../src/lib/indoor/shell";
import { INSTRUCTIONAL_ROOM_TYPES, type IndoorBuilding } from "../src/lib/indoor/schema";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";
import buildingData from "../src/lib/buildings.json";

declare const __AUDIT_ROOT__: string;
const ROOT = __AUDIT_ROOT__;
const categories = ["placed", "floorListed", "floorInferred", "unmapped", "no-layout", "nonphysical"] as const;
type Category = typeof categories[number];
type Counts = Record<Category, number>;
type Snapshot = { schemaVersion: number; term: string; file: string; sourceUrl: string; downloadedAt: string; bytes: number; sha256: string; includeDateRange?: boolean; sourceDescription?: string };
type Usage = { building: string; key: string; records: number; kinds: Record<string, number>; courses: Set<string>; inRuntime: boolean; exclusionReason: string | null };
const emptyCounts = (): Counts => Object.fromEntries(categories.map(k => [k, 0])) as Counts;
const sha = (contents: Buffer | string) => createHash("sha256").update(contents).digest("hex");
const read = (file: string) => readFileSync(resolve(ROOT, file));
const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
function requireThat(test: unknown, message: string): asserts test {
  if (!test) throw new Error(message);
}

const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  requireThat(["--metadata", "--output"].includes(process.argv[i]) && process.argv[i + 1], "Usage: node scripts/audit-active-term-coverage.mjs [--metadata FILE] [--output FILE]");
  options.set(process.argv[i], process.argv[i + 1]);
}
const metadataFile = options.get("--metadata") ?? "data/indoor/research/active-term-snapshot.json";
const outputFile = options.get("--output") ?? "data/indoor/research/active-term-coverage.json";
const metadata = JSON.parse(read(metadataFile).toString()) as Snapshot;
requireThat(metadata.schemaVersion === 1 && metadata.term && metadata.sourceUrl && Number.isFinite(Date.parse(metadata.downloadedAt)), "Incomplete snapshot provenance metadata.");
const bytes = read(metadata.file);
requireThat(bytes.length === metadata.bytes && sha(bytes) === metadata.sha256, "Snapshot bytes/hash changed; supply reviewed acquisition metadata for this snapshot.");
const parsed = coursesFromFile(bytes.toString("utf8"), metadata.includeDateRange ?? false);
requireThat(Number.isFinite(parsed.scraped.getTime()), "Schedule parser returned invalid upstream scrape time.");
const runtime = coursesToClassrooms(parsed.courses);
const names = new Map(Object.values(buildingData.colleges).flatMap(college => Object.entries(college).map(([code, b]) => [code, b.name] as const)));
const usages = new Map<string, Map<string, Usage>>();
let recordCount = 0, recordsWithoutLocation = 0, runtimeRecordCount = 0;
const recordKinds: Record<string, number> = {};
const unspecifiedCourses = new Set<string>();
const excludedRecordReasons: Record<string, number> = {};
for (const course of parsed.courses) {
  for (const group of course.groups) {
    for (const meeting of [...group.sections, ...group.meetings, ...group.exams]) {
      recordCount++;
      recordKinds[meeting.kind] = (recordKinds[meeting.kind] ?? 0) + 1;
      const loc = meeting.location;
      if (!loc) {
        recordsWithoutLocation++;
        unspecifiedCourses.add(course.code);
        continue;
      }
      const exclusionReason = loc.building === "RCLAS" ? "remote-RCLAS" : !loc.building || !loc.room || loc.room === "TBA" ? "unspecified-building-or-room" : null;
      const isRuntime = Boolean(meeting.time && meeting.time.days.length && loc.building !== "RCLAS");
      if (isRuntime) runtimeRecordCount++;
      if (exclusionReason) excludedRecordReasons[exclusionReason] = (excludedRecordReasons[exclusionReason] ?? 0) + 1;
      if (!usages.has(loc.building)) usages.set(loc.building, new Map());
      const building = usages.get(loc.building)!;
      if (!building.has(loc.room)) building.set(loc.room, { building: loc.building, key: loc.room, records: 0, kinds: {}, courses: new Set(), inRuntime: false, exclusionReason });
      const usage = building.get(loc.room)!;
      usage.records++;
      usage.kinds[meeting.kind] = (usage.kinds[meeting.kind] ?? 0) + 1;
      usage.courses.add(course.code);
      usage.inRuntime ||= isRuntime;
    }
  }
}
// Independent consistency check against the site's real classroom aggregation.
const runtimePairs = Object.entries(runtime).flatMap(([b, rooms]) => Object.keys(rooms).map(k => JSON.stringify([b, k]))).sort();
const auditedRuntimePairs = [...usages.values()].flatMap(rooms => [...rooms.values()].filter(u => u.inRuntime).map(u => JSON.stringify([u.building, u.key]))).sort();
requireThat(JSON.stringify(runtimePairs) === JSON.stringify(auditedRuntimePairs), "Audit key extraction disagrees with coursesToClassrooms.");
requireThat(runtimeRecordCount === Object.values(runtime).flatMap(rooms => Object.values(rooms)).reduce((n, records) => n + records.length, 0), "Audit meeting count disagrees with coursesToClassrooms.");

const totals = emptyCounts(), runtimeTotals = emptyCounts();
const buildings = [];
const allCandidates = [];
const layoutHashes: Record<string, string> = {};
for (const code of sorted(usages.keys())) {
  const records = usages.get(code)!;
  const entry = INDOOR_MANIFEST[code];
  let layout: IndoorBuilding | null = null;
  let validationWarningCount = 0;
  const layoutErrors: string[] = [];
  let fileGeometryStatus: string | null = null;
  if (entry) {
    const file = `static/${entry.file}`;
    if (!existsSync(resolve(ROOT, file))) {
      layoutErrors.push("Registered layout file is missing.");
    } else {
      const raw = read(file);
      layoutHashes[file] = sha(raw);
      const data: unknown = JSON.parse(raw.toString());
      const validation = validateIndoorBuilding(data, code);
      layoutErrors.push(...validation.issues.filter(i => i.level === "error").map(i => `${i.path}: ${i.message}`));
      validationWarningCount = validation.issues.filter(i => i.level === "warning").length;
      fileGeometryStatus = (data as IndoorBuilding).geometryStatus;
      if (fileGeometryStatus !== entry.status) layoutErrors.push(`Runtime loader rejects manifest status ${entry.status} versus file status ${fileGeometryStatus}.`);
      if (layoutErrors.length === 0) layout = data as IndoorBuilding;
    }
  }
  const index = layout ? indexIndoorBuilding(layout) : null;
  const storedLayoutKeys = new Set([
    ...(index?.roomsByScheduleKey.keys() ?? []), ...(index?.unplacedByKey.keys() ?? []),
    ...(layout?.knownUnmapped?.map(r => r.scheduleKey) ?? []),
  ]);
  const counts = emptyCounts();
  const categoryKeys = Object.fromEntries(categories.map(k => [k, [] as string[]])) as Record<Category, string[]>;
  const keys = [];
  const candidates = [];
  for (const key of sorted(records.keys())) {
    const usage = records.get(key)!;
    const room = index?.roomsByScheduleKey.get(key);
    const unplaced = index?.unplacedByKey.get(key);
    const knownUnmapped = layout?.knownUnmapped?.find(r => r.scheduleKey === key);
    const category: Category = usage.exclusionReason ? "nonphysical" : !entry ? "no-layout" : room ? "placed" : unplaced ? unplaced.room.basis === "floor-listing" ? "floorListed" : "floorInferred" : "unmapped";
    totals[category]++; counts[category]++; categoryKeys[category].push(key);
    if (usage.inRuntime) runtimeTotals[category]++;
    const detail = {
      key, category, records: usage.records, recordKinds: usage.kinds,
      distinctCourses: usage.courses.size, courseExamples: sorted(usage.courses).slice(0, 4),
      appearsInRuntimeSchedule: usage.inRuntime,
      ...(room ? { floor: room.floor, geometryRoomId: room.id, geometryLabel: room.label, match: room.scheduleKey === key ? "scheduleKey" : "explicit-scheduleAlias" } : {}),
      ...(unplaced && !room ? { floor: unplaced.floor.id, basis: unplaced.room.basis, listedLabel: unplaced.room.label } : {}),
      ...(category === "unmapped" ? { reason: layoutErrors.length ? "The registered layout fails the runtime loader checks; no geometry or floor listing is counted." : knownUnmapped?.reason ?? "Active term key is absent from the layout's schedule mappings and floor listings." } : {}),
      ...(category === "no-layout" ? { reason: "No indoor file is registered for this building code.", campusShellAvailable: Object.hasOwn(CAMPUS_CODES, code), numberOnlyFloorHint: floorIdForRoomKey(key) } : {}),
      ...(usage.exclusionReason ? { reason: usage.exclusionReason } : {}),
    };
    keys.push(detail);
    if (index && !room && !usage.exclusionReason) {
      const matches = [...index.roomsById.values()].filter(r => r.label === key);
      const exactUnmapped = matches.filter(r => !index.scheduleKeyByRoomId.has(r.id));
      if (matches.length) {
        const candidate = {
          building: code, key, currentCategory: category,
          cause: exactUnmapped.length ? "Exact printed-label geometry exists, but its room has no scheduleKey or scheduleAlias. Coverage uses the explicit index rather than the room-label navigation fallback." : "Printed label matches geometry already mapped to another schedule key; an explicit reviewed alias is required.",
          uniqueUnmappedLabel: exactUnmapped.length === 1 && matches.length === 1,
          selectableViaRuntimeLabelFallback: Boolean(roomForKey(index, key)),
          candidates: matches.map(r => ({ id: r.id, label: r.label, floor: r.floor, type: r.type, existingScheduleKey: index.scheduleKeyByRoomId.get(r.id) ?? null,
            sameAsListedFloor: unplaced ? unplaced.floor.id === r.floor : null, instructionalType: INSTRUCTIONAL_ROOM_TYPES.has(r.type),
            confidence: r.confidence, polygonAreaSqft: layout!.coordinateSystem.units === "meters" ? Number((polygonArea(r.footprint)/.09290304).toFixed(2)) : null,
            sources: r.sources })),
          disposition: "Candidate only. No mapping was changed; verify room identity, current use and any listed-floor conflict before adding an exact key or alias.",
        };
        candidates.push(candidate); allCandidates.push(candidate);
      }
    }
  }
  buildings.push({ building: code, name: names.get(code) ?? (code === "RCLAS" ? "Remote classes" : layout?.name ?? null),
    layout: entry ? `static/${entry.file}` : null, layoutSha256: entry ? layoutHashes[`static/${entry.file}`] ?? null : null,
    geometryStatus: entry?.status ?? null, fileGeometryStatus, campusShellAvailable: Object.hasOwn(CAMPUS_CODES, code),
    validationWarningCount, layoutErrors, exactKeys: sorted(records.keys()), counts, categoryKeys, keys,
    keysAbsentFromRegisteredLayoutRecords: layoutErrors.length ? null : keys.filter(k => k.category !== "nonphysical" && !storedLayoutKeys.has(k.key)).map(k => k.key),
    existingGeometryCandidates: candidates });
}
const totalKeys = Object.values(totals).reduce((a, b) => a + b, 0);
const physicalKeys = totalKeys - totals.nonphysical;
const physicalBuildings = buildings.filter(b => b.keys.some(k => k.category !== "nonphysical"));
const runtimePhysicalKeys = Object.values(runtimeTotals).reduce((a, b) => a + b, 0) - runtimeTotals.nonphysical;
requireThat(totalKeys === [...usages.values()].reduce((n, rooms) => n + rooms.size, 0), "Coverage partition does not exhaust parsed location keys.");
requireThat(recordCount === recordsWithoutLocation + [...usages.values()].flatMap(r => [...r.values()]).reduce((n, u) => n + u.records, 0), "Meeting records were lost during grouping.");
const auditInputs = [metadataFile, "scripts/audit-active-term-coverage.ts", "scripts/audit-active-term-coverage.mjs", "src/lib/coursesFromFile.ts", "src/lib/coursesToClassrooms.ts", "src/lib/Day.ts", "src/lib/Time.ts", "src/lib/indoor/manifest.ts", "src/lib/indoor/roomMapping.ts", "src/lib/indoor/schema.ts", "src/lib/indoor/shell.ts", "src/lib/indoor/validate.ts", "src/lib/indoor/geometry.ts", "src/lib/buildings.json", "src/lib/indoor/campusCodes.json", "static/indoor/facilities/index.json"];
// Historical comparison only: baseline keys never define the active denominator.
const baselineFile = "data/indoor/coverage-baseline.json";
let baselineComparison = null;
if (existsSync(resolve(ROOT, baselineFile))) {
  const baseline = JSON.parse(read(baselineFile).toString()) as { buildingsByPositionGap: { building: string; unmappedKeys: Record<string, string>; floors: { placedKeys: string[]; positionGaps: { key: string }[] }[] }[] };
  const historicalKeys = new Set(baseline.buildingsByPositionGap.flatMap(b => [
    ...Object.keys(b.unmappedKeys), ...b.floors.flatMap(f => [...f.placedKeys, ...f.positionGaps.map(r => r.key)]),
  ].map(k => JSON.stringify([b.building, k]))));
  const absent = buildings.flatMap(b => b.keys.filter(k => k.category !== "nonphysical" && !historicalKeys.has(JSON.stringify([b.building, k.key]))).map(k => ({ building: b.building, key: k.key, currentCategory: k.category })));
  baselineComparison = { file: baselineFile, sha256: sha(read(baselineFile)), baselineRecordedKeys: historicalKeys.size, activePhysicalKeysAbsentFromBaseline: absent.length, absentKeys: absent,
    note: "Read-only historical comparison. These keys are included in the active denominator regardless of baseline membership." };
  auditInputs.push(baselineFile);
}
const report = {
  schemaVersion: 1, term: metadata.term, generatedAt: new Date().toISOString(),
  scope: "Every distinct building/room pair in the supplied term snapshot, including buildings with no indoor file; sections, additional meetings and exams are parsed by the production parser. This is independent of the old stored-layout-key denominator.",
  snapshot: { ...metadata, upstreamScrapedAt: parsed.scraped.toISOString() },
  methodology: {
    parser: "coursesFromFile", runtimeAggregationCrosscheck: "coursesToClassrooms", indoorMatching: "indexIndoorBuilding; exact scheduleKey and explicit scheduleAliases only",
    countUnit: "Unique (building, room key) pair, not section count, seat count or distinct physical polygon. Multiple exact schedule aliases can refer to one physical room.",
    categories: {
      placed: "An explicit runtime scheduleKey or alias resolves to a validated room polygon.",
      floorListed: "An unplaced record explicitly cites a source floor listing.",
      floorInferred: "An existing unplaced record infers the floor from the room number.",
      unmapped: "A registered indoor layout has neither an explicit polygon mapping nor an unplaced floor listing for the key, or fails runtime loading checks (errors are reported per building).",
      "no-layout": "The building has no registered indoor JSON. An exterior shell or room-number floor hint is not counted as an indoor plan.",
      nonphysical: "Remote RCLAS pairs or an explicitly missing building/room key; excluded from the physical-room denominator. Null TBA locations are reported as records separately because they supply no unique room key.",
    },
    allPhysicalLocationsIncludedEvenWithoutTime: true,
    runtimeScheduleSubset: "Separately counted using the unchanged site's aggregator, which excludes null locations, RCLAS, missing time and empty day lists.",
    candidatePolicy: "Exact printed-label matches are reported for review; no leading-zero, punctuation, building-alias or room-identity guesses are counted as placed.",
    limitations: ["This reflects the snapshot's upstream scrape time, not a fresh UCSD registrar scrape at audit execution.", "Room outlines may retain historical-source and geometric uncertainties documented in their layouts. Placed is a mapping category, not a surveyed-accuracy guarantee.", "A missing time does not erase a named physical classroom from the full snapshot audit; use runtimeScheduleSummary for the visible classroom schedule subset."],
  },
  summary: { courses: parsed.courses.length, meetingRecords: recordCount, recordKinds, locationBuildingCodes: buildings.length,
    physicalBuildingCodes: physicalBuildings.length, physicalBuildingsWithoutIndoorFile: physicalBuildings.filter(b => !b.layout).length,
    registeredBuildingsWithRuntimeErrors: buildings.filter(b => b.layoutErrors.length > 0).length,
    activePhysicalKeysAbsentFromRegisteredLayoutRecords: buildings.reduce((n, b) => n + (b.keysAbsentFromRegisteredLayoutRecords?.length ?? 0), 0),
    missingKeyComparisonUnavailableForBuildings: buildings.filter(b => b.keysAbsentFromRegisteredLayoutRecords === null).map(b => b.building),
    uniqueLocationKeys: totalKeys, physicalRoomKeys: physicalKeys, counts: totals,
    placedFractionOfPhysicalRoomKeys: physicalKeys ? totals.placed/physicalKeys : null,
    existingGeometryCandidateKeys: allCandidates.length,
    uniqueUnmappedLabelCandidateKeys: allCandidates.filter(c => c.uniqueUnmappedLabel).length },
  runtimeScheduleSummary: { meetingRecords: runtimeRecordCount, buildingCodes: Object.keys(runtime).length, uniqueLocationKeys: runtimePairs.length,
    physicalRoomKeys: runtimePhysicalKeys, counts: runtimeTotals, placedFractionOfPhysicalRoomKeys: runtimePhysicalKeys ? runtimeTotals.placed/runtimePhysicalKeys : null },
  nonphysical: { keyedCounts: totals.nonphysical, recordCountsByReason: excludedRecordReasons, recordsWithoutLocation,
    unspecifiedLocationCourseCount: unspecifiedCourses.size, unspecifiedLocationCourseExamples: sorted(unspecifiedCourses).slice(0, 8),
    note: "Null location means TBA/unspecified, not proof of online delivery. These records cannot define distinct room keys and are excluded from both physical and keyed coverage counts." },
  buildings, existingGeometryCandidates: allCandidates, comparisonToStoredBaseline: baselineComparison,
  manifestBuildingCodesWithoutTermLocations: sorted(Object.keys(INDOOR_MANIFEST).filter(code => !usages.has(code))),
  inputSha256: { ...Object.fromEntries(auditInputs.map(file => [file, sha(read(file))])), ...layoutHashes },
};
const output = resolve(ROOT, outputFile);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Runtime subset: ${runtimeTotals.placed}/${runtimePhysicalKeys} physical keys have explicit polygons.`);
console.log(`Wrote ${outputFile}`);
for (const candidate of allCandidates) console.log(`EXACT-LABEL CANDIDATE ${candidate.building} ${candidate.key}: ${candidate.candidates.map(c => `${c.id} (${c.floor}, ${c.type})`).join("; ")}`);

// Validates every runtime indoor layout in static/indoor/ and checks that the
// manifest in src/lib/indoor/manifest.ts lists exactly those files.
//
//   npm run validate:indoor
//   npm run validate:indoor -- --local   (also the local-only static/indoor/local/)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { INDOOR_MANIFEST } from "../src/lib/indoor/manifest";
import { indexIndoorBuilding } from "../src/lib/indoor/roomMapping";
import { IndoorBuilding } from "../src/lib/indoor/schema";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";
import buildingData from "../src/lib/buildings.json";

const knownBuildings = new Set(
  Object.values(buildingData.colleges).flatMap((college) => Object.keys(college))
);

let failed = false;
const fail = (message: string) => {
  console.error(`ERROR ${message}`);
  failed = true;
};

const files = new Set(
  ["static/indoor", "static/indoor/schematic"]
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => `${dir.replace(/^static\//, "")}/${name}`)
    )
);

for (const [code, entry] of Object.entries(INDOOR_MANIFEST)) {
  if (!knownBuildings.has(code)) {
    fail(`${code}: not a building code in buildings.json`);
  }
  if (!files.has(entry.file)) {
    fail(`${code}: manifest points to missing file static/${entry.file}`);
    continue;
  }
  files.delete(entry.file);
  if ((entry.status === "schematic-demo") !== entry.file.startsWith("indoor/schematic/")) {
    fail(`${code}: schematic demos must live in static/indoor/schematic/ (and only they)`);
  }
  const data: unknown = JSON.parse(readFileSync(`static/${entry.file}`, "utf8"));
  const { ok, issues } = validateIndoorBuilding(data, code);
  for (const issue of issues) {
    console.log(`${issue.level.toUpperCase()} ${code} ${issue.path}: ${issue.message}`);
  }
  if (!ok) {
    fail(`${code}: validation failed`);
    continue;
  }
  const layout = data as IndoorBuilding;
  if (layout.geometryStatus !== entry.status) {
    fail(`${code}: manifest says ${entry.status}, file says ${layout.geometryStatus}`);
  }
  const index = indexIndoorBuilding(layout);
  const rooms = index.roomsById.size;
  const mapped = index.roomsByScheduleKey.size;
  console.log(
    `${code}: ok (${layout.floors.length} floors, ${rooms} rooms, ${mapped} schedule keys mapped, ${
      layout.knownUnmapped?.length ?? 0
    } known unmapped)`
  );
}
for (const file of files) {
  fail(`static/${file} is not listed in the manifest`);
}

// Local-only layouts aren't in the manifest; they just have to be valid
const localDir = "static/indoor/local";
if (process.argv.includes("--local") && existsSync(localDir)) {
  for (const name of readdirSync(localDir).filter((name) => /^[A-Z0-9]+\.json$/.test(name))) {
    const code = name.slice(0, -5);
    const data: unknown = JSON.parse(readFileSync(`${localDir}/${name}`, "utf8"));
    const { ok, issues } = validateIndoorBuilding(data, code);
    const errors = issues.filter((issue) => issue.level === "error");
    for (const issue of errors.slice(0, 5)) {
      console.log(`ERROR ${code} ${issue.path}: ${issue.message}`);
    }
    if (!ok) {
      fail(`local ${code}: validation failed (${errors.length} errors)`);
      continue;
    }
    const index = indexIndoorBuilding(data as IndoorBuilding);
    console.log(
      `local ${code}: ok (${index.roomsById.size} rooms, ${index.roomsByScheduleKey.size} placed and ${
        index.unplacedByKey.size
      } unplaced schedule rooms, ${issues.length - errors.length} warnings)`
    );
  }
}
if (failed) {
  process.exit(1);
}

// Retired floor-listing enrichment: restore the preserved original base only.
// E129/B1 from 2010 was superseded by the 2024 and 2025 plans (E129/E1, EB129/EB1).
// Build the current independent room trace with: python scripts/build-sdsc-east.py
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function enrichSdscFloorListing() {
  const filename = "static/indoor/facilities/SDSC.json";
  const current = JSON.parse(readFileSync(filename, "utf8"));
  const originalBytes = readFileSync("data/indoor/SDSC/original-facilities-base.json");
  const original = JSON.parse(originalBytes.toString("utf8"));
  assert.equal(current.building, "SDSC");
  assert.deepEqual(current.floors.filter((floor) => !["EAST-B1", "EAST-L1"].includes(floor.id)), original.floors,
    "Unexpected new base geometry: do not overwrite without review");
  assert.deepEqual(current.geo, original.geo);
  assert.deepEqual(current.coordinateSystem, original.coordinateSystem);
  writeFileSync(filename, originalBytes);
  console.log("SDSC original five-floor base restored. Historical E129/B1 enrichment is retired; use build-sdsc-east.py for the current E1 room trace.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  enrichSdscFloorListing();
}

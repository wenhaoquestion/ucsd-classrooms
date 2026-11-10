import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isPublicStaticFile, readLocalIndoorManifest } from "../scripts/indoor-preview.mjs";
import { IndoorManifestEntry } from "../src/lib/indoor/manifest";
import { IndoorBuilding } from "../src/lib/indoor/schema";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";

// Keep esbuild's native executable external when the test suite itself bundles.
const { build } = createRequire(import.meta.url)("esbuild") as typeof import("esbuild");

type PreviewModule = typeof import("../src/lib/indoor/loader") & {
  INDOOR_MANIFEST: Record<string, IndoorManifestEntry>;
  hasIndoorLayout: (building: string) => boolean;
};

let moduleNumber = 0;
async function previewModule(entries: Record<string, IndoorManifestEntry>): Promise<PreviewModule> {
  const compiled = await build({
    stdin: {
      contents: 'export * from "./src/lib/indoor/loader"; export * from "./src/lib/indoor/manifest";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    define: { LOCAL_INDOOR_MANIFEST: JSON.stringify(entries) },
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}#${moduleNumber++}`);
}

function layout(code: string): IndoorBuilding {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  return {
    schemaVersion: 1, building: code, name: "Local preview fixture",
    geometryStatus: "facilities-plan", provenance: "Authenticated fixture",
    coordinateSystem: { units: "relative", description: "Fixture", northDeg: null },
    sources: [{
      id: "fixture", title: "Local SVG", building: code, floors: ["L1"],
      accessed: "2026-11-09", localFile: "D:/fixture.svg", access: "authenticated",
      tririga: { buildingRecordId: "1", floorRecordId: "2", drawingId: "3", svgSha256: "a".repeat(64) },
    }],
    floors: [{
      id: "L1", label: "Level 1", shortLabel: "1",
      vertical: { baseElevation: 0, height: 3, estimated: true },
      outline: [{ outer: square }], outlineConfidence: "direct", sources: [{ source: "fixture" }],
      rooms: [{
        id: "space-4", label: "101", scheduleKey: "101", type: "classroom", floor: "L1",
        footprint: { outer: square },
        confidence: { location: "direct", shape: "direct", label: "direct" },
        sources: [{ source: "fixture", region: "Space record 4" }],
      }],
    }],
  };
}

describe("authenticated local preview isolation", () => {
  it("excludes unpublished drafts but includes the approved TRIRIGA collection", () => {
    const root = process.cwd();
    for (const path of [
      "indoor/local/private.svg", "indoor/tririga-local", "indoor/tririga-local/TASB.json",
      "index.js", "index.css.map", "chunks",
    ]) assert.equal(isPublicStaticFile(join(root, "static", path), root), false, path);
    for (const path of ["indoor/layouts", "indoor/layouts/TASB.json", "indoor", "indoor/facilities/YORK.json", "indoor/GEISEL.json", "index.html"]) {
      assert.equal(isPublicStaticFile(join(root, "static", path), root), true, path);
    }
  });

  it("checks local index identities and prevents paths outside the preview directory", (t) => {
    const root = mkdtempSync(join(tmpdir(), "ucsd-indoor-preview-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(readLocalIndoorManifest(root), {});
    assert.throws(() => readLocalIndoorManifest(root, { required: true }), /Missing local indoor index/);
    const dir = join(root, "static/indoor/tririga-local");
    mkdirSync(dir, { recursive: true });
    const setIndex = (buildings: string[]) => writeFileSync(join(dir, "index.json"), JSON.stringify({ schemaVersion: 1, buildings }));
    writeFileSync(join(dir, "TASB.json"), "{}");
    setIndex(["TASB"]);
    assert.deepEqual(readLocalIndoorManifest(root), {
      TASB: { file: "indoor/tririga-local/TASB.json", status: "facilities-plan" },
    });
    for (const [codes, message] of [
      [["../TASB"], /Invalid local/], [["TASB", "TASB"], /Duplicate/],
      [["GEISEL"], /LibCal/], [["MISSING"], /missing file/],
    ] as const) {
      setIndex([...codes]);
      assert.throws(() => readLocalIndoorManifest(root), message);
    }
  });

  it("keeps the public manifest unchanged when no preview entries are compiled", async () => {
    const runtime = await previewModule({});
    assert.equal(runtime.INDOOR_MANIFEST.YORK.file, "indoor/layouts/YORK.json");
    assert.equal(runtime.INDOOR_MANIFEST.BSB.file, "indoor/layouts/BSB.json");
    assert.equal(runtime.INDOOR_MANIFEST.CSC.file, "indoor/layouts/CSC.json");
    assert.equal(Object.values(runtime.INDOOR_MANIFEST).filter((entry) => entry.file.startsWith("indoor/layouts/")).length, 85);
    assert.equal(runtime.INDOOR_MANIFEST.GEISEL.file, "indoor/GEISEL.json");
    assert.equal(runtime.hasIndoorLayout("LOCALTEST"), false);
    assert.equal(await runtime.loadIndoorLayout("LOCALTEST"), null);
  });

  it("lazily loads and caches a new local building while retaining room selection keys", async (t) => {
    const runtime = await previewModule({
      LOCALTEST: { file: "indoor/tririga-local/LOCALTEST.json", status: "facilities-plan" },
      YORK: { file: "indoor/tririga-local/YORK.json", status: "facilities-plan" },
    });
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://localhost:8000/" } });
    t.after(() => previousDocument ? Object.defineProperty(globalThis, "document", previousDocument) : Reflect.deleteProperty(globalThis, "document"));
    const requests: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: URL) => {
      requests.push(url.href);
      return new Response(JSON.stringify(layout("LOCALTEST")), { status: 200 });
    });
    assert.equal(runtime.hasIndoorLayout("LOCALTEST"), true);
    assert.equal(runtime.INDOOR_MANIFEST.YORK.file, "indoor/tririga-local/YORK.json");
    assert.equal(requests.length, 0);
    const first = runtime.loadIndoorLayout("LOCALTEST");
    assert.equal(runtime.loadIndoorLayout("LOCALTEST"), first);
    const index = await first;
    assert.equal(index?.roomsByScheduleKey.get("101")?.id, "space-4");
    assert.equal(index?.floorsById.get("L1")?.rooms[0].label, "101");
    assert.deepEqual(requests, ["http://localhost:8000/indoor/tririga-local/LOCALTEST.json"]);
  });

  it("evicts failed local requests so a later attempt can retry", async (t) => {
    const runtime = await previewModule({ LOCALTEST: { file: "indoor/tririga-local/LOCALTEST.json", status: "facilities-plan" } });
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://localhost:8000/" } });
    t.after(() => previousDocument ? Object.defineProperty(globalThis, "document", previousDocument) : Reflect.deleteProperty(globalThis, "document"));
    let count = 0;
    t.mock.method(globalThis, "fetch", async () => {
      count++;
      return count === 1 ? new Response("Unavailable", { status: 503 }) : new Response(JSON.stringify(layout("LOCALTEST")));
    });
    await assert.rejects(runtime.loadIndoorLayout("LOCALTEST"), /HTTP 503/);
    assert.equal((await runtime.loadIndoorLayout("LOCALTEST"))?.building.building, "LOCALTEST");
    assert.equal(count, 2);
  });

  it("validates exact authenticated source identity and rejects missing hashes", () => {
    const valid = layout("LOCALTEST");
    assert.equal(validateIndoorBuilding(valid).ok, true);
    const invalid = structuredClone(valid);
    invalid.sources[0].tririga!.svgSha256 = "unknown";
    assert.equal(validateIndoorBuilding(invalid).ok, false);
    const publicClaim = structuredClone(valid);
    publicClaim.sources[0].access = "public";
    assert.equal(validateIndoorBuilding(publicClaim).ok, false);
  });
});

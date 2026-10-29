import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { planUV } from "../src/explorer3d/planDrawing";
import { pixelToLocal } from "../src/lib/indoor/geometry";
import type { IndoorBuilding, IndoorFloor, Point2, SourceTransform } from "../src/lib/indoor/schema";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";

function fixture(): IndoorBuilding {
  return {
    schemaVersion: 1,
    building: "TEST",
    name: "Drawing fixture",
    geometryStatus: "source-traced",
    provenance: "Test floor plan.",
    coordinateSystem: { units: "meters", description: "Test coordinates", northDeg: null },
    sources: [{ id: "PLAN", title: "Floor plan", url: "https://example.com/plan.pdf", building: "TEST", floors: ["L1"], accessed: "2026-10-28" }],
    floors: [{
      id: "L1", label: "Floor 1", shortLabel: "1",
      vertical: { baseElevation: 0, height: 3, estimated: true },
      outline: [{ outer: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
      outlineConfidence: "traced",
      sources: [{ source: "PLAN" }],
      transforms: [{ source: "PLAN", imageSizePx: [100, 100], originPx: [0, 0], rotationDeg: 0, scale: 0.1 }],
      planDrawing: { source: "PLAN", url: "indoor/test.webp" },
      rooms: [],
      details: [{
        id: "table-1", kind: "table", confidence: "traced",
        footprint: { outer: [[2, 2], [4, 2], [4, 3], [2, 3]] },
        sources: [{ source: "PLAN" }],
      }],
    }],
  };
}

function expectInvalid(data: unknown, path: string): void {
  const result = validateIndoorBuilding(data);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.level === "error" && issue.path.includes(path)),
    JSON.stringify(result.issues));
}

describe("floor drawing alignment", () => {
  const transform: SourceTransform = {
    source: "PLAN", imageSizePx: [1200, 900], originPx: [325.5, 211.25], rotationDeg: 0, scale: 0.25,
  };

  it("maps the top and bottom of the page to vertically flipped texture coordinates", () => {
    const exact = { ...transform, originPx: [320, 210] as Point2 };
    assert.deepEqual(planUV(pixelToLocal([0, 0], exact), exact), [0, 1]);
    assert.deepEqual(planUV(pixelToLocal([1200, 900], exact), exact), [1, 0]);
  });

  it("inverts translated, scaled and rotated source coordinates", () => {
    const pixels: Point2[] = [[0, 0], [1200, 900], [325.5, 211.25], [892.75, 365.5]];
    for (const rotationDeg of [0, 90, -35, 37, 180]) {
      const rotated = { ...transform, rotationDeg };
      for (const pixel of pixels) {
        const uv = planUV(pixelToLocal(pixel, rotated), rotated);
        // pixelToLocal rounds local coordinates to 0.001 units.
        assert.ok(Math.abs(uv[0] - pixel[0] / 1200) < 0.00001, `${rotationDeg}: u`);
        assert.ok(Math.abs(uv[1] - (1 - pixel[1] / 900)) < 0.00001, `${rotationDeg}: v`);
      }
    }
  });
});

describe("optional floor drawings and furniture validation", () => {
  it("accepts sourced details and still accepts layouts without the optional fields", () => {
    const data = fixture();
    const result = validateIndoorBuilding(data);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    delete data.floors[0].planDrawing;
    delete data.floors[0].details;
    assert.equal(validateIndoorBuilding(data).ok, true);
  });

  const invalidTransforms: [string, (floor: IndoorFloor) => void][] = [
    ["missing transform", (floor) => { delete floor.transforms; }],
    ["missing dimensions", (floor) => { delete floor.transforms![0].imageSizePx; }],
    ["zero image width", (floor) => { floor.transforms![0].imageSizePx = [0, 100]; }],
    ["infinite image height", (floor) => { floor.transforms![0].imageSizePx = [100, Infinity]; }],
    ["nonfinite origin", (floor) => { floor.transforms![0].originPx = [NaN, 0]; }],
    ["nonfinite rotation", (floor) => { floor.transforms![0].rotationDeg = Infinity; }],
    ["nonfinite scale", (floor) => { floor.transforms![0].scale = Infinity; }],
    ["uncited source", (floor) => { floor.planDrawing!.source = "MISSING"; }],
    ["empty image URL", (floor) => { floor.planDrawing!.url = ""; }],
  ];
  for (const [name, change] of invalidTransforms) {
    it(`rejects a drawing with ${name}`, () => {
      const data = fixture();
      change(data.floors[0]);
      expectInvalid(data, "planDrawing");
    });
  }

  it("rejects zero scale before it can reach UV division", () => {
    const data = fixture();
    data.floors[0].transforms![0].scale = 0;
    expectInvalid(data, "scale");
  });

  it("rejects malformed details instead of passing them to the renderer", () => {
    const data = fixture();
    for (const details of [{}, [null], [{ ...data.floors[0].details![0], kind: "invented" }]]) {
      expectInvalid({ ...data, floors: [{ ...data.floors[0], details }] }, "details");
    }
  });

  it("requires a source and a valid footprint for each furniture object", () => {
    const data = fixture();
    data.floors[0].details![0].sources = [{ source: "MISSING" }];
    expectInvalid(data, "details[0].sources");
    data.floors[0].details![0].sources = [{ source: "PLAN" }];
    data.floors[0].details![0].footprint.outer = [[2, 2], [3, 3]];
    expectInvalid(data, "details[0].footprint");
  });
});

describe("published Geisel detail assets", () => {
  const data = JSON.parse(readFileSync("static/indoor/GEISEL.json", "utf8")) as IndoorBuilding;

  it("has a real WebP drawing and matching source transform for each mapped library plan", () => {
    for (const id of ["L1", "L2", "L4", "L5", "L6", "L7", "L8"]) {
      const floor = data.floors.find((floor) => floor.id === id)!;
      assert.ok(floor.planDrawing, `${id}: missing drawing`);
      const transform = floor.transforms?.find((transform) => transform.source === floor.planDrawing!.source);
      assert.ok(transform?.imageSizePx, `${id}: missing image transform`);
      const bytes = readFileSync(`static/${floor.planDrawing.url}`);
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF", id);
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP", id);
    }
  });

  it("keeps floor 3 free of unsourced drawings and furniture", () => {
    const floor = data.floors.find((floor) => floor.id === "L3")!;
    assert.equal(floor.planDrawing, undefined);
    assert.equal(floor.details?.length ?? 0, 0);
  });
});

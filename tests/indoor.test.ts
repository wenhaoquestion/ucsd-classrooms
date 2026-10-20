import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { RoomMeeting } from "../src/lib/coursesToClassrooms";
import { Day } from "../src/lib/Day";
import { CAMPUS_ORIGIN, CampusData, lonLatToCampus } from "../src/lib/indoor/campus";
import {
  pixelToLocal,
  pointInPolygon,
  selfIntersections,
} from "../src/lib/indoor/geometry";
import { SOURCE_LAYOUTS } from "../src/lib/indoor/manifest";
import {
  computeCoverage,
  indexIndoorBuilding,
  navigationKeyForRoom,
  roomForKey,
} from "../src/lib/indoor/roomMapping";
import { getRoomStatus } from "../src/lib/indoor/roomStatus";
import {
  INDOOR_SCHEMA_VERSION,
  IndoorBuilding,
  IndoorRoom,
} from "../src/lib/indoor/schema";
import { buildExteriorShell, floorIdForRoomKey } from "../src/lib/indoor/shell";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";
import { fromViewTerm } from "../src/lib/moment-context";
import { Time } from "../src/lib/Time";

function room(id: string, overrides: Partial<IndoorRoom> = {}): IndoorRoom {
  return {
    id,
    label: id,
    scheduleKey: null,
    type: "office",
    floor: "L1",
    footprint: {
      outer: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    },
    confidence: { location: "traced", shape: "traced", label: "direct" },
    sources: [{ source: "S1" }],
    ...overrides,
  };
}

function building(rooms: IndoorRoom[], overrides: Partial<IndoorBuilding> = {}): IndoorBuilding {
  return {
    schemaVersion: INDOOR_SCHEMA_VERSION,
    building: "TEST",
    name: "Test Building",
    geometryStatus: "source-traced",
    provenance: "Test fixture.",
    coordinateSystem: { units: "relative", description: "test", northDeg: null },
    sources: [
      {
        id: "S1",
        title: "Fixture plan",
        url: "https://example.com/plan.png",
        building: "TEST",
        floors: ["L1"],
        accessed: "2026-10-19",
      },
    ],
    floors: [
      {
        id: "L1",
        label: "Level 1",
        shortLabel: "1",
        vertical: { baseElevation: 0, height: 3, estimated: true },
        outline: [
          {
            outer: [
              [-1, -1],
              [10, -1],
              [10, 10],
              [-1, 10],
            ],
          },
        ],
        outlineConfidence: "traced",
        rooms,
        sources: [{ source: "S1" }],
      },
    ],
    ...overrides,
  };
}

const errors = (data: unknown) =>
  validateIndoorBuilding(data).issues.filter((issue) => issue.level === "error");

describe("validateIndoorBuilding", () => {
  it("accepts a well-formed layout", () => {
    const result = validateIndoorBuilding(building([room("A")]), "TEST");
    assert.equal(result.ok, true, JSON.stringify(result.issues));
  });

  it("rejects the wrong building and non-objects", () => {
    assert.equal(validateIndoorBuilding(building([room("A")]), "CSE").ok, false);
    assert.equal(validateIndoorBuilding(null).ok, false);
    assert.equal(validateIndoorBuilding({ schemaVersion: 99 }).ok, false);
  });

  it("detects duplicate IDs across rooms", () => {
    const issues = errors(building([room("A"), room("A")]));
    assert.ok(issues.some((issue) => issue.message.includes("Duplicate id A")));
  });

  it("detects malformed polygons", () => {
    const bowtie = room("A", {
      footprint: {
        outer: [
          [0, 0],
          [2, 2],
          [2, 0],
          [0, 2],
        ],
      },
    });
    assert.ok(errors(building([bowtie])).some((i) => i.message.includes("intersects itself")));
    const tooFew = room("B", { footprint: { outer: [[0, 0], [1, 1]] } });
    assert.ok(errors(building([tooFew])).some((i) => i.message.includes("at least 3")));
    const closed = room("C", {
      footprint: {
        outer: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      },
    });
    assert.ok(errors(building([closed])).some((i) => i.message.includes("repeat")));
    const nan = room("D", {
      footprint: {
        outer: [
          [0, 0],
          [1, Number.NaN],
          [1, 1],
        ],
      },
    });
    assert.ok(errors(building([nan])).some((i) => i.message.includes("finite")));
  });

  it("requires source references that exist", () => {
    assert.ok(
      errors(building([room("A", { sources: [] })])).some((i) =>
        i.message.includes("Missing source references")
      )
    );
    assert.ok(
      errors(building([room("A", { sources: [{ source: "NOPE" }] })])).some((i) =>
        i.message.includes("Unknown source NOPE")
      )
    );
  });

  it("detects duplicate and ambiguous schedule mappings", () => {
    const duplicate = building([
      room("A", { scheduleKey: "101" }),
      room("B", { scheduleKey: "101" }),
    ]);
    assert.ok(errors(duplicate).some((i) => i.message.includes("already assigned")));
    const ambiguous = building([room("A", { scheduleKey: "101" }), room("B")], {
      scheduleAliases: [{ scheduleKey: "101", room: "B", note: "test" }],
    });
    assert.ok(errors(ambiguous).some((i) => i.message.includes("Ambiguous")));
    const dangling = building([room("A")], {
      scheduleAliases: [{ scheduleKey: "101", room: "Z", note: "test" }],
    });
    assert.ok(errors(dangling).some((i) => i.message.includes("unknown room Z")));
  });

  it("rejects rooms listed under the wrong floor", () => {
    assert.ok(
      errors(building([room("A", { floor: "L2" })])).some((i) =>
        i.message.includes("listed under L1")
      )
    );
  });

  it("keeps schematic demos from claiming direct evidence", () => {
    const demo = building([room("A")], { geometryStatus: "schematic-demo" });
    assert.ok(errors(demo).some((i) => i.message.includes("Schematic demo")));
  });

  it("rejects 'unmapped' keys that are actually mapped", () => {
    const data = building([room("A", { scheduleKey: "101" })], {
      knownUnmapped: [{ scheduleKey: "101", reason: "test" }],
    });
    assert.ok(errors(data).some((i) => i.message.includes("listed as unmapped")));
  });
});

describe("room mapping", () => {
  const data = building(
    [
      room("G-0110", { label: "0110", scheduleKey: "0110", type: "classroom" }),
      room("G-B210", { label: "B210", scheduleKey: null, type: "computer-lab" }),
      room("G-1202", { label: "1202", scheduleKey: "1202", type: "conference" }),
      room("G-OFFICE", { label: "1300" }),
    ],
    { scheduleAliases: [{ scheduleKey: "1202A", room: "G-1202", note: "test alias" }] }
  );
  const index = indexIndoorBuilding(data);

  it("matches schedule keys exactly, preserving leading zeros", () => {
    assert.equal(roomForKey(index, "0110")?.id, "G-0110");
    assert.equal(roomForKey(index, "110"), null);
  });

  it("uses explicit aliases only", () => {
    assert.equal(roomForKey(index, "1202A")?.id, "G-1202");
    assert.equal(navigationKeyForRoom(index, index.roomsById.get("G-1202")!), "1202");
  });

  it("falls back to labels only for rooms without schedule keys", () => {
    assert.equal(roomForKey(index, "B210")?.id, "G-B210");
    assert.equal(navigationKeyForRoom(index, index.roomsById.get("G-B210")!), "B210");
  });

  it("partitions schedule rooms by coverage", () => {
    const coverage = computeCoverage(index, ["1202", "4140", "0110"]);
    assert.deepEqual(
      coverage.mapped.map(({ key }) => key),
      ["0110", "1202"]
    );
    assert.deepEqual(coverage.scheduleOnly, ["4140"]);
    // The instructional lab has no meetings; the office is not tracked
    assert.deepEqual(
      coverage.geometryOnly.map((r) => r.id),
      ["G-B210"]
    );
  });

  it("throws on ambiguous mappings", () => {
    const bad = building([room("A", { scheduleKey: "1" }), room("B")], {
      scheduleAliases: [{ scheduleKey: "1", room: "B", note: "" }],
    });
    assert.throws(() => indexIndoorBuilding(bad));
  });
});

describe("schedule-derived room status", () => {
  // Wednesday, October 14, 2026 (fall quarter)
  const date = Day.from(2026, 10, 14);
  const at = (time: string) =>
    fromViewTerm({ date, time: Time.parse24(time)! });
  const meeting = (start: string, end: string): RoomMeeting =>
    ({
      kind: "meeting",
      code: "A00",
      type: "LE",
      time: { days: [date.day], start: Time.parse24(start)!, end: Time.parse24(end)! },
      capacity: 100,
      course: "CSE 100",
      index: { group: 0, meeting: 0 },
      special: false,
    }) as RoomMeeting;
  const meetings = [meeting("10:00", "10:50")];

  it("reports a class in session", () => {
    assert.deepEqual(getRoomStatus(meetings, at("10:15"), "complete", true), {
      kind: "in-use",
      course: "CSE 100",
    });
  });

  it("reports a class starting soon", () => {
    assert.equal(getRoomStatus(meetings, at("09:55"), "complete", true).kind, "soon");
  });

  it("distinguishes no class now from no classes listed", () => {
    assert.equal(getRoomStatus(meetings, at("13:00"), "complete", true).kind, "no-class-now");
    assert.equal(getRoomStatus(undefined, at("13:00"), "complete", true).kind, "none-listed");
  });

  it("never treats missing data as availability", () => {
    assert.equal(getRoomStatus(undefined, at("13:00"), "partial", true).kind, "unknown");
    assert.equal(getRoomStatus(meetings, at("13:00"), "partial", true).kind, "unknown");
    assert.equal(getRoomStatus(undefined, at("13:00"), "unavailable", true).kind, "unknown");
  });

  it("uses a neutral status for a generic week", () => {
    const term = fromViewTerm({ year: 2026, season: "FA" });
    assert.equal(getRoomStatus(meetings, term, "complete", true).kind, "listed");
  });

  it("doesn't track rooms that aren't instructional", () => {
    assert.equal(getRoomStatus(undefined, at("10:15"), "complete", false).kind, "not-tracked");
  });
});

describe("geometry helpers", () => {
  it("converts pixels with the documented transform", () => {
    assert.deepEqual(pixelToLocal([110, 50], { originPx: [100, 40], rotationDeg: 0, scale: 0.1 }), [1, 1]);
    // 90 degrees clockwise on the page: right becomes down
    assert.deepEqual(pixelToLocal([10, 0], { originPx: [0, 0], rotationDeg: 90, scale: 1 }), [0, 10]);
  });

  it("finds self-intersections and point containment", () => {
    assert.equal(selfIntersections([[0, 0], [2, 0], [2, 2], [0, 2]]).length, 0);
    assert.ok(selfIntersections([[0, 0], [2, 2], [2, 0], [0, 2]]).length > 0);
    const square = { outer: [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][], holes: [[[1, 1], [3, 1], [3, 3], [1, 3]] as [number, number][]] };
    assert.equal(pointInPolygon([0.5, 0.5], square), true);
    assert.equal(pointInPolygon([2, 2], square), false);
  });
});

describe("EBU3B source-traced layout", () => {
  const file = SOURCE_LAYOUTS.EBU3B.file;
  const data = JSON.parse(readFileSync(`static/${file}`, "utf8")) as IndoorBuilding;

  it("validates without errors", () => {
    const result = validateIndoorBuilding(data, "EBU3B");
    assert.equal(result.ok, true, JSON.stringify(result.issues.slice(0, 5)));
  });

  it("places scheduled rooms on the floors their plans show", () => {
    const index = indexIndoorBuilding(data);
    const expected: Record<string, string> = {
      B240: "B",
      B250: "B",
      B260: "B",
      B270: "B",
      "1202": "L1",
      "2109": "L2",
      "2154": "L2",
      "3109": "L3",
      "3219": "L3",
      "4140": "L4",
      "4217": "L4",
      "4258": "L4",
    };
    for (const [key, floor] of Object.entries(expected)) {
      assert.equal(roomForKey(index, key)?.floor, floor, key);
    }
  });

  it("keeps rooms the plans don't show unmapped", () => {
    const index = indexIndoorBuilding(data);
    for (const key of ["1113", "1117", "1124"]) {
      assert.equal(roomForKey(index, key), null, key);
      assert.ok(data.knownUnmapped?.some((entry) => entry.scheduleKey === key));
    }
  });

  it("cites a public source for every floor and is not labeled as surveyed", () => {
    assert.equal(data.geometryStatus, "source-traced");
    assert.equal(data.coordinateSystem.units, "relative");
    for (const floor of data.floors) {
      assert.equal(floor.vertical.estimated, true);
      assert.ok(floor.sources.length > 0);
    }
  });
});

describe("exterior shells", () => {
  const square = (x: number, z: number, size: number): [number, number][] => [
    [x, z],
    [x + size, z],
    [x + size, z + size],
    [x, z + size],
  ];
  const campus: CampusData = {
    origin: CAMPUS_ORIGIN,
    source: "test, accessed 2026-10-19",
    buildings: [
      // A tall wing and a low wing of the same building, plus a neighbor
      { caan: "1", name: "Wing A", rings: [square(0, 0, 20)], base: 100, top: 117 },
      { caan: "1", name: "Wing B", rings: [square(20, 0, 10)], base: 100, top: 104.5 },
      { caan: "2", name: "Neighbor", rings: [square(100, 100, 10)], base: 90, top: 100 },
    ],
  };

  it("infers floors from room numbers", () => {
    assert.equal(floorIdForRoomKey("B240"), "B");
    assert.equal(floorIdForRoomKey("205"), "L2");
    assert.equal(floorIdForRoomKey("4140"), "L4");
    assert.equal(floorIdForRoomKey("330A"), "L3");
    assert.equal(floorIdForRoomKey("0935"), "L9");
    assert.equal(floorIdForRoomKey("1.402"), "L1");
    assert.equal(floorIdForRoomKey("1A18"), "L1");
    assert.equal(floorIdForRoomKey("AUD"), null);
    assert.equal(floorIdForRoomKey("0013"), null);
  });

  it("stacks estimated floors and puts upper floors only on tall parts", () => {
    const shell = buildExteriorShell("TEST", "Test Hall", campus, ["1"], ["B10", "105", "310"])!;
    assert.deepEqual(
      shell.floors.map((floor) => floor.id),
      ["B", "L1", "L2", "L3", "L4"]
    );
    assert.ok(shell.floors.every((floor) => floor.vertical.estimated && floor.rooms.length === 0));
    assert.equal(shell.floors.find((f) => f.id === "L1")!.outline.length, 2);
    assert.equal(shell.floors.find((f) => f.id === "L3")!.outline.length, 1);
    assert.equal(shell.geo?.groundElevation, 100);
    assert.equal(validateIndoorBuilding(shell, "TEST").ok, true);
  });

  it("lists rooms on their inferred floor without placing them", () => {
    const index = indexIndoorBuilding(
      buildExteriorShell("TEST", "Test Hall", campus, ["1"], ["105", "310", "AUD"])!
    );
    assert.equal(index.unplacedByKey.get("310")?.floor.id, "L3");
    assert.equal(index.unplacedByKey.get("105")?.room.basis, "room-number");
    const coverage = computeCoverage(index, ["105", "310", "AUD"]);
    assert.deepEqual(coverage.unplaced.map((entry) => entry.key), ["105", "310"]);
    assert.deepEqual(coverage.scheduleOnly, ["AUD"]);
  });

  it("returns null without footprints", () => {
    assert.equal(buildExteriorShell("TEST", "Test", campus, ["9"], []), null);
  });

  it("projects campus coordinates with north as -z", () => {
    const [x, z] = lonLatToCampus(CAMPUS_ORIGIN[1], CAMPUS_ORIGIN[0] + 0.001);
    assert.ok(Math.abs(x) < 1e-6);
    assert.ok(Math.abs(z + 110.574) < 0.01);
  });
});

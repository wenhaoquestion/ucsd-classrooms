import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { INDOOR_MANIFEST, SUPPLEMENTAL_LAYOUTS } from "../src/lib/indoor/manifest";
import { computeCoverage, indexIndoorBuilding } from "../src/lib/indoor/roomMapping";
import { IndoorBuilding } from "../src/lib/indoor/schema";

const read = (path: string): IndoorBuilding => JSON.parse(readFileSync(path, "utf8"));

describe("reviewed indoor supplements", () => {
  it("preserves every recorded schedule key exactly once in each supplemental layout", () => {
    const keys = (layout: IndoorBuilding) => [
      ...layout.floors.flatMap((floor) => [
        ...floor.rooms.map((room) => room.scheduleKey),
        ...(floor.unplaced ?? []).map((room) => room.scheduleKey),
      ]),
      ...(layout.scheduleAliases ?? []).map((alias) => alias.scheduleKey),
      ...(layout.knownUnmapped ?? []).map((room) => room.scheduleKey),
    ].filter((key): key is string => key !== null);
    for (const [code, entry] of Object.entries(SUPPLEMENTAL_LAYOUTS)) {
      const original: string[] = code === "BRF2" ? ["5A03", "1102", "1104", "4103"] : code === "MYR-A"
        ? JSON.parse(readFileSync("data/indoor/MYR-A/fa26-schedule.json", "utf8")).keys
        : keys(read(`static/indoor/facilities/${code}.json`));
      const current = keys(read(`static/${entry.file}`));
      assert.equal(new Set(current).size, current.length, `${code}: duplicate key`);
      assert.deepEqual(current.sort(), [...new Set(original)].sort(), `${code}: changed key inventory`);
    }
  });

  it("maps BRF2 4103 to the public fourth-floor polygon without fabricating other floors", () => {
    const layout = read(`static/${INDOOR_MANIFEST.BRF2.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(index.roomsByScheduleKey.get("4103")?.id, "L4-FIS-73656");
    assert.deepEqual(layout.floors.map(f => f.id), ["L1", "L4", "L5"]);
    assert.deepEqual(layout.knownUnmapped?.map(r => r.scheduleKey), ["1102"]);
    for (const [key, floorId] of [["1104", "L1"], ["5A03", "L5"]]) {
      const entry = index.unplacedByKey.get(key)!;
      assert.equal(entry.floor.id, floorId);
      assert.equal(entry.room.basis, "floor-listing");
      assert.deepEqual(entry.floor.outline, []);
      assert.deepEqual(entry.floor.rooms, []);
      assert.equal(index.roomsByScheduleKey.has(key), false);
    }
    assert.equal(layout.geo, undefined);
    assert.equal(layout.coordinateSystem.northDeg, null);
    assert.equal(index.roomsById.has("L4-FIS-87238"), false);
  });

  it("maps CALIT 1511 only to the reviewed auditorium in its independent coordinate frame", () => {
    const layout = read(`static/${INDOOR_MANIFEST.CALIT.file}`);
    const index = indexIndoorBuilding(layout);
    const room = index.roomsByScheduleKey.get("1511")!;
    assert.equal(room.floor, "L1");
    assert.equal(index.roomsById.size, 1);
    assert.equal(index.unplacedByKey.size, 0);
    assert.deepEqual(layout.floors.map(floor => floor.id), ["L1"]);
    assert.equal(layout.geo, undefined);
    assert.equal(layout.coordinateSystem.northDeg, null);
    assert.ok(room.sources.some(source => source.source === "CALIT-QI-EVENT-DIAGRAM"));
    assert.ok(room.sources.some(source => source.source === "CALIT-SEAW-NOV-2006" && source.page === 7));
  });

  it("locates SDSC E129 on East E1 without confusing it with basement EB129", () => {
    const layout = read(`static/${INDOOR_MANIFEST.SDSC.file}`);
    const index = indexIndoorBuilding(layout);
    const room = index.roomsByScheduleKey.get("E129")!;
    assert.equal(room.floor, "EAST-L1");
    assert.equal(index.roomsById.size, 1);
    assert.equal(index.unplacedByKey.size, 0);
    assert.equal(index.roomsByScheduleKey.has("EB129"), false);
    assert.deepEqual(layout.floors.map(floor => floor.id), ["EAST-L1"]);
    assert.equal(layout.coordinateSystem.units, "relative");
    assert.equal(layout.coordinateSystem.northDeg, null);
    assert.equal(layout.geo, undefined);
    assert.deepEqual(layout.floors[0].outline, [room.footprint]);
    assert.ok(room.sources.some(source => source.source === "SDSC-EAP-2025-PUBLIC" && source.page === 24));
    assert.equal(layout.sources.find(source => source.id === "SDSC-EAP-2025-PUBLIC")?.url,
      "https://business.sdsc.edu/assets/documents/sdsc_emergency_plan.pdf");
  });

  it("maps Malk prefix aliases to the reviewed basement and preserves its upper floors", () => {
    const base = read("static/indoor/facilities/MALK.json");
    const layout = read(`static/${INDOOR_MANIFEST.MALK.file}`);
    const index = indexIndoorBuilding(layout);
    for (const key of ["B90", "B91", "B92"]) {
      assert.equal(index.roomsByScheduleKey.get(key)?.floor, "B");
      assert.equal(index.unplacedByKey.has(key), false);
      assert.equal(index.roomsByScheduleKey.has(`E${key}`), false);
    }
    for (const floor of base.floors.filter((floor) => floor.id !== "B")) {
      assert.deepEqual(layout.floors.find((candidate) => candidate.id === floor.id), floor);
    }
  });

  it("keeps Coalition split classrooms as single scheduled rooms and leaves level two unresolved", () => {
    const layout = read(`static/${INDOOR_MANIFEST.COA.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(index.roomsByScheduleKey.size, 14);
    assert.equal(index.unplacedByKey.size, 6);
    for (const key of ["125", "127"]) assert.equal(index.roomsByScheduleKey.get(key)?.floor, "L1");
    assert.equal(index.roomsByScheduleKey.get("B27")?.floor, "B");
    for (const key of ["126", "128", "B28"]) assert.equal(index.roomsByScheduleKey.has(key), false);
    for (const room of index.unplacedByKey.values()) assert.equal(room.floor.id, "L2");
  });

  it("keeps Mandeville's two basement levels distinct and retains all original rooms", () => {
    const base = read("static/indoor/facilities/MANDE.json");
    const layout = read(`static/${INDOOR_MANIFEST.MANDE.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(index.roomsByScheduleKey.get("B104")?.floor, "B1");
    assert.equal(index.roomsByScheduleKey.get("B202")?.floor, "B2");
    assert.equal(index.roomsByScheduleKey.get("B206")?.floor, "B2");
    assert.equal(index.unplacedByKey.get("212")?.floor.id, "L2");
    for (const room of indexIndoorBuilding(base).roomsById.values()) assert.deepEqual(index.roomsById.get(room.id), room);
  });

  it("adds York 3010 without guessing the 4124A/B schedule crosswalk", () => {
    const layout = read(`static/${INDOOR_MANIFEST.YORK.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(layout.geo, undefined);
    assert.equal(layout.coordinateSystem.northDeg, null);
    assert.equal(index.roomsByScheduleKey.get("3010")?.floor, "L3");
    assert.equal(index.unplacedByKey.get("4124")?.floor.id, "L4");
    assert.equal(index.roomsByScheduleKey.has("4124"), false);
  });

  it("repairs HSS lower-floor scale and separates the two 2333 rooms without changing upper floors", () => {
    const base = read("static/indoor/facilities/HSS.json");
    const layout = read(`static/${INDOOR_MANIFEST.HSS.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(layout.coordinateSystem.northDeg, null);
    const a = index.roomsByScheduleKey.get("2333A")!;
    const b = index.roomsByScheduleKey.get("2333B")!;
    const area = (room: typeof a) => Math.abs(room.footprint.outer.reduce((sum, point, i, ring) => {
      const next = ring[(i + 1) % ring.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0)) / 2;
    assert.ok(area(a) > 25 && area(a) < 30);
    assert.ok(area(b) > 29 && area(b) < 34);
    assert.ok(a.labelAt && b.labelAt && Math.hypot(a.labelAt[0] - b.labelAt[0], a.labelAt[1] - b.labelAt[1]) > 4);
    for (const key of ["1106B", "1128A", "1330", "2025", "2152", "2305A", "2333B"]) {
      assert.ok(index.roomsByScheduleKey.has(key));
      assert.equal(index.unplacedByKey.has(key), false);
    }
    for (const floor of base.floors.filter((floor) => !["L1", "L2"].includes(floor.id))) {
      assert.deepEqual(layout.floors.find((candidate) => candidate.id === floor.id), floor);
    }
  });

  it("uses the actual Asante meeting venue instead of the apartment service room", () => {
    const base = read("static/indoor/facilities/ASANT.json");
    const layout = read(`static/${INDOOR_MANIFEST.ASANT.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(layout.coordinateSystem.units, "relative");
    assert.equal(layout.geo, undefined);
    assert.equal(layout.floors.length, 1);
    assert.equal(index.roomsByScheduleKey.size, 4);
    for (const key of ["123A", "123B", "123C", "123D"]) {
      const room = index.roomsByScheduleKey.get(key)!;
      assert.equal(room.id, `ASANT-MEETING-${key}`);
      assert.equal(room.type, "conference");
      assert.ok(room.sources.some((source) => source.source === "ASANT-IHOUSE-LAYOUT"));
      assert.equal(index.unplacedByKey.has(key), false);
    }
    assert.equal(base.floors.flatMap((floor) => floor.rooms).length, 15);
    for (const room of base.floors.flatMap((floor) => floor.rooms)) {
      assert.equal(index.roomsById.has(room.id), false);
    }
  });

  it("adds the six Mayer rooms while retaining original rooms and campus registration", () => {
    const base = read("static/indoor/facilities/MAYER.json");
    const layout = read(`static/${INDOOR_MANIFEST.MAYER.file}`);
    const index = indexIndoorBuilding(layout);
    assert.deepEqual(layout.geo, base.geo);
    for (const [floor, page, keys] of [
      ["L2", 25, ["2110", "2130", "2306", "2326"]],
      ["L4", 33, ["4322"]],
      ["L5", 37, ["5301"]],
    ] as const) {
      for (const key of keys) {
        const room = index.roomsByScheduleKey.get(key)!;
        assert.equal(room.floor, floor);
        assert.ok(room.sources.some((source) => source.source === "PHYSICS-EAP-2026" && source.page === page));
        assert.equal(index.unplacedByKey.has(key), false);
      }
    }
    for (const room of indexIndoorBuilding(base).roomsById.values()) {
      assert.deepEqual(index.roomsById.get(room.id), room);
    }
  });

  it("shows the Galbraith auditorium once and records that it spans two levels", () => {
    const layout = read(`static/${INDOOR_MANIFEST.GH.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(layout.geo, undefined);
    assert.equal(index.roomsByScheduleKey.size, 3);
    const room = index.roomsByScheduleKey.get("242")!;
    assert.equal(room.floor, "L3");
    assert.match(room.name ?? "", /spans Levels 2 and 3/);
    assert.equal(room.confidence.location, "approximate");
    assert.ok(room.sources.some((source) => source.source === "GH-242-SEATING-2016"));
    assert.equal(index.unplacedByKey.has("242"), false);
    assert.equal(index.unplacedByKey.size, 17);
    for (const key of ["320", "321"]) assert.equal(index.roomsByScheduleKey.get(key)?.floor, "L3");
    assert.deepEqual(layout.floors.map((floor) => floor.id), ["B", "L1", "L2", "L3"]);
  });

  it("keeps MCC classrooms out of the unrelated Cancer Center geometry", () => {
    const layout = read(`static/${INDOOR_MANIFEST.MCC.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(layout.geometryStatus, "facilities-plan");
    assert.equal(layout.name, "Media Center and Communication Building");
    assert.equal(index.roomsByScheduleKey.size, 4);
    assert.equal(layout.geo, undefined);
    for (const [key, id] of [["127", "11623"], ["133", "11627"], ["139", "11631"], ["140", "11632"]]) {
      assert.equal(index.roomsByScheduleKey.get(key)?.id, `L1-FIS-${id}`);
    }
    for (const key of ["201", "221", "222", "250"]) {
      assert.ok(index.unplacedByKey.has(key));
    }
    assert.equal(layout.floors.length, 2);
  });

  it("uses named auditorium crosswalks and keeps the Price Theater on its documented floor", () => {
    const led = indexIndoorBuilding(read(`static/${INDOOR_MANIFEST.LEDDN.file}`));
    const jeannieLayout = read(`static/${INDOOR_MANIFEST.JEANN.file}`);
    const jeannie = indexIndoorBuilding(jeannieLayout);
    const price = indexIndoorBuilding(read(`static/${INDOOR_MANIFEST.PRICE.file}`));
    assert.equal(led.roomsByScheduleKey.get("AUD")?.id, "L2-FIS-2024-2250");
    assert.equal(led.roomsById.size, 2);
    assert.equal(jeannie.roomsByScheduleKey.get("AUD")?.id, "L2-GA0205-SEATING-2021");
    assert.equal(jeannieLayout.coordinateSystem.northDeg, null);
    assert.equal(price.unplacedByKey.get("THTRE")?.floor.id, "L1");
    assert.equal(price.roomsByScheduleKey.has("THTRE"), false);
  });

  it("imports extension classroom vectors without inventing campus orientation", () => {
    for (const [code, pairs] of [
      ["UNEXG", [["123", "2207"], ["124", "2208"], ["125", "2209"]]],
      ["UNEXN", [["126", "25781"], ["127", "25782"]]],
    ] as const) {
      const layout = read(`static/${INDOOR_MANIFEST[code].file}`);
      const index = indexIndoorBuilding(layout);
      assert.equal(layout.geo, undefined);
      assert.equal(layout.coordinateSystem.northDeg, null);
      for (const [key, id] of pairs) {
        assert.equal(index.roomsByScheduleKey.get(key)?.id, `L1-FIS-VECTOR-${id}`);
        assert.equal(index.unplacedByKey.has(key), false);
      }
    }
  });

  it("adds SSRB labels from the third-floor source without guessing the partitioned room 310", () => {
    const base = read("static/indoor/facilities/SSRB.json");
    const layout = read(`static/${INDOOR_MANIFEST.SSRB.file}`);
    const index = indexIndoorBuilding(layout);
    for (const key of ["339", "340", "343A"]) {
      const room = index.roomsByScheduleKey.get(key)!;
      assert.equal(room.floor, "L3");
      assert.ok(room.sources.some((source) => source.source === "SSRB-EHS-2018" && source.page === 4));
      assert.equal(index.unplacedByKey.has(key), false);
    }
    assert.equal(index.roomsByScheduleKey.has("310"), false);
    assert.ok(index.unplacedByKey.has("310"));
    for (const floor of base.floors.filter((floor) => floor.id !== "L3")) {
      assert.deepEqual(layout.floors.find((candidate) => candidate.id === floor.id), floor);
    }
  });

  it("loads recovered CSE classrooms while preserving Facilities upper floors", () => {
    const base = read("static/indoor/facilities/EBU3B.json");
    const layout = read(`static/${INDOOR_MANIFEST.EBU3B.file}`);
    const index = indexIndoorBuilding(layout);
    const recovered = ["B240", "B250", "B260", "B270", "1202"];
    const unresolved = ["1113", "1117", "1124"];
    const coverage = computeCoverage(index, [...recovered, ...unresolved]);
    assert.equal(coverage.mapped.length, 5);
    assert.equal(coverage.unplaced.length, 3);
    assert.equal(coverage.scheduleOnly.length, 0);
    for (const { key, room } of coverage.mapped) {
      assert.equal(index.unplacedByKey.has(key), false);
      assert.equal(room.confidence.location, "approximate");
    }
    for (const floor of base.floors.filter((f) => !["B", "L1"].includes(f.id))) {
      assert.deepEqual(layout.floors.find((f) => f.id === floor.id), floor);
    }
    for (const room of indexIndoorBuilding(base).roomsByScheduleKey.values()) {
      assert.deepEqual(index.roomsById.get(room.id), room);
    }
  });

  it("maps VAF 218 to its existing polygon without also leaving a floor-only entry", () => {
    const index = indexIndoorBuilding(read(`static/${INDOOR_MANIFEST.VAF.file}`));
    assert.equal(index.roomsByScheduleKey.get("218")?.id, "L1-521-2261");
    assert.equal(index.unplacedByKey.has("218"), false);
  });

  it("maps all nine CSB classrooms to reviewed PDF pages without inventing a campus fit", () => {
    const layout = read(`static/${INDOOR_MANIFEST.CSB.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(layout.coordinateSystem.units, "relative");
    assert.equal(layout.geo, undefined);
    assert.equal(layout.geometryStatus, "source-traced");
    assert.equal(index.roomsByScheduleKey.size, 9);
    for (const [floor, page, keys] of [
      ["LL", 2, ["001", "002", "003", "004", "005"]],
      ["L1", 3, ["115", "180"]],
      ["L2", 4, ["272", "280"]],
    ] as const) {
      for (const key of keys) {
        const room = index.roomsByScheduleKey.get(key)!;
        assert.equal(room.floor, floor);
        assert.equal(room.label, key);
        assert.equal(room.confidence.location, "traced");
        assert.equal(room.confidence.shape, "approximate");
        assert.ok(room.sources.some((s) => s.source === "CSB-EHS-2018" && s.page === page));
        assert.equal(index.unplacedByKey.has(key), false);
      }
    }
    assert.ok(layout.sources.find((s) => s.id === "CSB-EHS-2018")?.imageRef?.includes(
      "b3169e5e2b721fbee95f3746f7485a60105bd7c355f0bb8178315d692fd57b5e"
    ));
  });

  it("maps thirteen SME classrooms to the correct source floors while retaining relative units", () => {
    const layout = read(`static/${INDOOR_MANIFEST.SME.file}`);
    const index = indexIndoorBuilding(layout);
    assert.equal(layout.coordinateSystem.units, "relative");
    assert.equal(layout.geo, undefined);
    assert.equal(layout.geometryStatus, "source-traced");
    assert.equal(index.roomsByScheduleKey.size, 13);
    for (const [floor, page, keys] of [
      ["L1", 3, ["102", "118", "141", "143", "145", "149"]],
      ["L2", 4, ["248"]],
      ["L3", 5, ["302", "304", "306", "313"]],
      ["L4", 6, ["411", "420"]],
    ] as const) {
      for (const key of keys) {
        const room = index.roomsByScheduleKey.get(key)!;
        assert.equal(room.floor, floor);
        assert.equal(room.label, key);
        assert.equal(room.confidence.location, "traced");
        assert.ok(room.sources.some((s) => s.source === "SME-EHS-2021" && s.page === page));
        assert.equal(index.unplacedByKey.has(key), false);
      }
    }
  });

  for (const [building, key, targetFloor, page] of [
    ["EBU1", "2315", "L2", 4],
    ["EBU2", "584", "L5", 7],
  ] as const) {
    it(`recovers ${building} ${key} while preserving existing rooms and other floors`, () => {
      const base = read(`static/indoor/facilities/${building}.json`);
      const layout = read(`static/${INDOOR_MANIFEST[building].file}`);
      const index = indexIndoorBuilding(layout);
      const room = index.roomsByScheduleKey.get(key)!;
      assert.equal(room.floor, targetFloor);
      assert.ok(room.sources.some((s) => s.source === `${building}-EHS-2021` && s.page === page));
      assert.equal(index.unplacedByKey.has(key), false);
      assert.deepEqual(layout.geo, base.geo);
      for (const floor of base.floors.filter((f) => f.id !== targetFloor)) {
        assert.deepEqual(layout.floors.find((f) => f.id === floor.id), floor);
      }
      for (const original of indexIndoorBuilding(base).roomsById.values()) {
        assert.deepEqual(index.roomsById.get(original.id), original);
      }
    });
  }

  it("maps only labeled FAH classrooms and retains all four floors", () => {
    const base = read("static/indoor/facilities/FAH.json");
    const layout = read(`static/${INDOOR_MANIFEST.FAH.file}`);
    const index = indexIndoorBuilding(layout);
    assert.deepEqual(layout.floors.map((f) => f.id), base.floors.map((f) => f.id));
    assert.equal(layout.coordinateSystem.units, "relative");
    assert.equal(layout.geo, undefined);
    for (const key of ["1101", "1450"]) {
      const room = index.roomsByScheduleKey.get(key)!;
      assert.equal(room.floor, "L1");
      assert.ok(room.sources.some((s) => s.source === "FAH-EHS-2025" && s.page === 2));
      assert.equal(index.unplacedByKey.has(key), false);
    }
    assert.equal(index.roomsByScheduleKey.get("1301")?.floor, "L1");
    assert.equal(index.unplacedByKey.has("1301"), false);
    assert.equal(index.roomsByScheduleKey.size, 3);
  });

  it("resolves reviewed Catalyst basement prefixes and keeps unsupported candidates unmapped", () => {
    const index = indexIndoorBuilding(read(`static/${INDOOR_MANIFEST.CTL.file}`));
    for (const key of ["B108", "B112"]) {
      const room = index.roomsByScheduleKey.get(key)!;
      assert.equal(room.floor, "B");
      assert.equal(room.label, key.slice(1));
      assert.equal(index.unplacedByKey.has(key), false);
    }
  });

  it("uses documentary floor evidence without fabricating room positions", () => {
    for (const [code, key, floor] of [
      ["EBU2", "305", "L3"], ["EBU2", "330A", "L3"],
      ["CCC", "ARTSP", "L2"],
      ["VAUGN", "100", "L1"],
      ["WFH", "3N129", "L3"], ["WFH", "3W113", "L3"],
    ]) {
      const index = indexIndoorBuilding(read(`static/${INDOOR_MANIFEST[code].file}`));
      assert.equal(index.roomsByScheduleKey.has(key), false);
      assert.equal(index.unplacedByKey.get(key)?.floor.id, floor);
      assert.equal(index.unplacedByKey.get(key)?.room.basis, "floor-listing");
      assert.ok(!index.building.knownUnmapped?.some((r) => r.scheduleKey === key));
    }
  });
});

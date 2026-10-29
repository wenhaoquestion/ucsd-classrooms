import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fetchGeiselDay, handleLibcalRequest } from "../worker/libcal";
import { Day } from "../src/lib/Day";
import { indexIndoorBuilding } from "../src/lib/indoor/roomMapping";
import { IndoorBuilding } from "../src/lib/indoor/schema";
import { validateIndoorBuilding } from "../src/lib/indoor/validate";
import {
  bookingUrl,
  describeStatus,
  GEISEL_SPACES,
  groupStatus,
  parseAvailability,
  Slot,
  SlotStatus,
  slotRuns,
  SPACES_BY_KEY,
  SPACES_BY_ROOM,
  spaceStatus,
} from "../src/lib/library/geisel";
import { Time } from "../src/lib/Time";
import { viewFromUrl, viewToUrl } from "../src/lib/View";

/** Like `Time.parse24`, but also accepts "24:00" (the end of the day). */
const t = (hhmm: string) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return Time.from(hour * 60 + minute);
};
const slots = (...list: [string, string, SlotStatus][]): Slot[] =>
  list.map(([start, end, status]) => ({ start: t(start), end: t(end), status }));

describe("Geisel study room catalog", () => {
  const layout = JSON.parse(readFileSync("static/indoor/GEISEL.json", "utf8")) as IndoorBuilding;

  it("is a valid indoor layout", () => {
    const { ok, issues } = validateIndoorBuilding(layout, "GEISEL");
    assert.ok(ok, JSON.stringify(issues));
  });

  it("places every bookable room in a geometry room on its own floor", () => {
    const index = indexIndoorBuilding(layout);
    for (const space of GEISEL_SPACES) {
      if (space.room === null) {
        continue;
      }
      const room = index.roomsById.get(space.room);
      assert.ok(room, `${space.key} -> missing ${space.room}`);
      assert.equal(room.floor, space.floor, space.key);
      assert.equal(room.type, "study-room", space.key);
    }
  });

  it("has a booking for every study-room shape, and unique keys and IDs", () => {
    const index = indexIndoorBuilding(layout);
    for (const room of index.roomsById.values()) {
      if (room.type === "study-room") {
        assert.ok(SPACES_BY_ROOM.has(room.id), room.id);
      }
    }
    assert.equal(SPACES_BY_KEY.size, GEISEL_SPACES.length);
    assert.equal(new Set(GEISEL_SPACES.map((space) => space.eid)).size, GEISEL_SPACES.length);
  });

  it("tower room tiles share one print scale", () => {
    const scales = layout.floors
      .filter((floor) => ["L5", "L6", "L7"].includes(floor.id))
      .map((floor) => floor.transforms![0].scale);
    assert.ok(Math.max(...scales) / Math.min(...scales) < 1.005, scales.join());
  });

  it("links to LibCal on the selected date", () => {
    const space = SPACES_BY_KEY.get("721")!;
    assert.equal(bookingUrl(space), "https://ucsd.libcal.com/space/103071");
    assert.equal(
      bookingUrl(space, Day.from(2026, 11, 2)),
      "https://ucsd.libcal.com/space/103071?date=2026-11-02"
    );
  });

  it("round-trips block keys through the URL", () => {
    (globalThis as unknown as { window: unknown }).window = {
      location: { pathname: "/", href: "https://example.test/" },
    };
    for (const room of ["1040–1045", "2096A", "HUB1"]) {
      const parsed = viewFromUrl(
        viewToUrl({ type: "building", building: "GEISEL", room, term: null }).href
      );
      assert.equal(parsed.type === "building" && parsed.room, room);
    }
  });
});

describe("study room status at a time", () => {
  const day = slots(
    ["10:00", "10:30", "free"],
    ["10:30", "11:00", "free"],
    ["11:00", "11:30", "booked"],
    ["11:30", "12:00", "booked"],
    ["12:00", "12:30", "free"],
    ["23:30", "24:00", "free"]
  );

  it("reports the end of a free run", () => {
    assert.deepEqual(spaceStatus(day, t("10:15")), { kind: "free", until: t("11:00") });
  });

  it("reports when a booking ends and the next free slot", () => {
    assert.deepEqual(spaceStatus(day, t("11:00")), {
      kind: "booked",
      until: t("12:00"),
      nextFree: t("12:00"),
    });
  });

  it("treats gaps, closed slots and missing rooms as not bookable", () => {
    assert.deepEqual(spaceStatus(day, t("09:00")), { kind: "closed", nextFree: t("10:00") });
    assert.deepEqual(spaceStatus(day, t("13:00")), { kind: "closed", nextFree: t("23:30") });
    assert.deepEqual(spaceStatus(undefined, t("13:00")), { kind: "closed", nextFree: null });
  });

  it("describes statuses, including free until midnight", () => {
    assert.equal(describeStatus(spaceStatus(day, t("10:00"))), "Free until 11:00 am");
    assert.equal(describeStatus(spaceStatus(day, t("23:45"))), "Free rest of day");
    assert.equal(describeStatus(spaceStatus(day, t("11:10"))), "Booked until 12:00 pm");
    assert.equal(describeStatus(spaceStatus(day, t("13:00"))), "Not bookable, free at 11:30 pm");
  });

  it("colors a block by its best room", () => {
    const free = spaceStatus(day, t("10:00"));
    const booked = spaceStatus(day, t("11:00"));
    const closed = spaceStatus(day, t("13:00"));
    assert.equal(groupStatus([booked, free]), "free");
    assert.equal(groupStatus([closed, booked]), "booked");
    assert.equal(groupStatus([closed]), "closed");
  });

  it("merges adjacent slots into runs without changing the input", () => {
    const runs = slotRuns(day);
    assert.deepEqual(
      runs.map((run) => [`${run.start.toString(true)}`, `${+run.end}`, run.status]),
      [
        ["10:00", `${11 * 60}`, "free"],
        ["11:00", `${12 * 60}`, "booked"],
        ["12:00", `${12 * 60 + 30}`, "free"],
        ["23:30", `${24 * 60}`, "free"],
      ]
    );
    assert.equal(+day[0].end, 10 * 60 + 30);
  });
});

describe("LibCal proxy", () => {
  const upstream = {
    windowEnd: false,
    slots: [
      { start: "2026-11-02 23:00:00", end: "2026-11-02 23:30:00", itemId: 103054, className: "s-lc-eq-checkout" },
      { start: "2026-11-02 07:30:00", end: "2026-11-02 08:00:00", itemId: 103054 },
      { start: "2026-11-02 23:30:00", end: "2026-11-03 00:00:00", itemId: 103054, className: "s-lc-eq-r-unavailable" },
      { start: "2026-11-03 00:00:00", end: "2026-11-03 00:30:00", itemId: 103054 },
    ],
  };

  it("asks LibCal for Geisel with its own referer, and trims the slots", async () => {
    let request: { url: string; init?: RequestInit } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      request = { url, init };
      return new Response(JSON.stringify(upstream));
    }) as typeof fetch;
    const day = await fetchGeiselDay("2026-11-02", fake);
    assert.equal(request!.url, "https://ucsd.libcal.com/spaces/availability/grid");
    const headers = request!.init!.headers as Record<string, string>;
    assert.match(headers.Referer, /^https:\/\/ucsd\.libcal\.com\//);
    const body = new URLSearchParams(String(request!.init!.body));
    assert.equal(body.get("lid"), "11273");
    assert.equal(body.get("start"), "2026-11-02");
    assert.equal(body.get("end"), "2026-11-03");
    assert.deepEqual(day.spaces["103054"], [
      ["07:30", "08:00", "free"],
      ["23:00", "23:30", "booked"],
      ["23:30", "24:00", "closed"],
    ]);

    const parsed = parseAvailability(day);
    assert.equal(parsed.date.toString(), "2026-11-02");
    assert.equal(+parsed.spaces.get(103054)![2].end, 24 * 60);
  });

  it("only serves valid, nearby dates with CORS headers", async () => {
    const fake = (async () => new Response(JSON.stringify(upstream))) as typeof fetch;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
      new Date()
    );
    const get = (query: string) =>
      handleLibcalRequest(new Request(`https://proxy.test/geisel?${query}`), "geisel", fake);
    const ok = (await get(`date=${today}`))!;
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal((await get("date=nope"))!.status, 400);
    assert.equal((await get("date=2001-01-01"))!.status, 400);
    assert.equal(
      await handleLibcalRequest(new Request("https://proxy.test/other"), "other", fake),
      null
    );
  });

  it("reports LibCal failures as a bad gateway", async () => {
    const fake = (async () => new Response("Forbidden", { status: 403 })) as typeof fetch;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
      new Date()
    );
    const response = (await handleLibcalRequest(
      new Request(`https://proxy.test/geisel?date=${today}`),
      "geisel",
      fake
    ))!;
    assert.equal(response.status, 502);
  });
});

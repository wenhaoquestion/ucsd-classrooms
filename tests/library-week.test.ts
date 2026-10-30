import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AvailabilityRange } from "../src/lib/availabilityRanges";
import { Day } from "../src/lib/Day";
import { Time } from "../src/lib/Time";
import {
  DayAvailability,
  GEISEL_SPACES,
  loadGeiselAvailability,
  Slot,
} from "../src/lib/library/geisel";
import { findWeekAvailability } from "../src/lib/library/weekAvailability";

const monday = Day.from(2026, 11, 2);
const fetchedAt = new Date("2026-10-29T16:00:00Z");
const range = (date = monday, start = 600, end = 660): AvailabilityRange =>
  ({ date, start: Time.from(start), end: Time.from(end) });
const slot = (start: number, end: number, status: Slot["status"] = "free"): Slot =>
  ({ start: Time.from(start), end: Time.from(end), status });
const day = (date = monday, spaces = new Map<number, Slot[]>(), windowEnd = false): DayAvailability =>
  ({ date, fetchedAt, spaces, windowEnd });

describe("weekly Geisel availability", () => {
  it("fetches unique dates concurrently while preserving range order", async () => {
    const ranges = [range(monday), range(monday.add(1)), range(Day.fromId(monday.id), 700, 720)];
    const calls: number[] = [];
    const pending = new Map<number, (value: DayAvailability) => void>();
    const result = findWeekAvailability(ranges, (date) => {
      calls.push(date.id);
      return new Promise((resolve) => pending.set(date.id, resolve));
    });
    await Promise.resolve();
    assert.deepEqual(calls, [monday.id, monday.add(1).id]);
    pending.get(monday.add(1).id)!(day(monday.add(1)));
    pending.get(monday.id)!(day(monday));
    assert.deepEqual((await result).map((entry) => entry.range), ranges);
  });

  it("requires free coverage of the entire interval, including missing-slot gaps", async () => {
    const [full, booked, gap, tooShort, closed] = GEISEL_SPACES;
    const spaces = new Map([
      [full.eid, [slot(600, 630), slot(630, 660)]],
      [booked.eid, [slot(600, 630), slot(630, 660, "booked")]],
      [gap.eid, [slot(600, 620), slot(630, 660)]],
      [tooShort.eid, [slot(600, 650)]],
      [closed.eid, [slot(600, 660, "closed")]],
    ]);
    const [result] = await findWeekAvailability([range()], async () => day(monday, spaces));
    assert.equal(result.state, "ready");
    assert.deepEqual(result.spaces.map((space) => space.key), [full.key]);
    assert.equal(result.fetchedAt, fetchedAt);
  });

  it("keeps successful dates when a different date fails", async () => {
    const [space] = GEISEL_SPACES;
    const ranges = [range(monday), range(monday.add(1)), range(monday.add(1), 700, 720)];
    const results = await findWeekAvailability(ranges, async (date) => {
      if (date.id !== monday.id) throw new Error("Library temporarily unavailable");
      return day(date, new Map([[space.eid, [slot(600, 660)]]]));
    });
    assert.equal(results[0].state, "ready");
    assert.deepEqual(results[0].spaces, [space]);
    for (const result of results.slice(1)) {
      assert.equal(result.state, "error");
      assert.match(result.error!, /temporarily unavailable/);
      assert.deepEqual(result.spaces, []);
    }
  });

  it("does not treat another date's free slots as a match", async () => {
    const [space] = GEISEL_SPACES;
    const [result] = await findWeekAvailability([range()], async () =>
      day(monday.add(1), new Map([[space.eid, [slot(600, 660)]]]))
    );
    assert.equal(result.state, "error");
    assert.deepEqual(result.spaces, []);
    assert.match(result.error!, /different date/);
  });

  it("distinguishes the booking window from a loaded day with no matches", async () => {
    const ranges = [range(monday), range(monday.add(1)), range(monday.add(2))];
    const [space] = GEISEL_SPACES;
    const results = await findWeekAvailability(ranges, async (date) =>
      date.id === monday.id ? day(date) :
        date.id === monday.add(1).id ? day(date, new Map([[space.eid, []]]), true) :
          day(date, new Map([[space.eid, [slot(600, 660)]]]), true)
    );
    assert.deepEqual(results.map((result) => result.state), ["ready", "window-end", "ready"]);
    assert.deepEqual(results[0].spaces, []);
    assert.deepEqual(results[1].spaces, []);
    assert.deepEqual(results[2].spaces, [space]);
  });

  it("validates all ranges before fetching", async () => {
    let calls = 0;
    for (const invalid of [range(monday, 660, 600), range(monday, 600, 600), range(monday, -1, 60), range(monday, 1400, 1500)]) {
      await assert.rejects(findWeekAvailability([range(), invalid], async (date) => {
        calls++;
        return day(date);
      }), RangeError);
    }
    assert.equal(calls, 0);
    assert.deepEqual(await findWeekAvailability([], async (date) => {
      calls++;
      return day(date);
    }), []);
    assert.equal(calls, 0);
  });

  it("reports an unconfigured proxy per range without rejecting the whole search", async () => {
    const results = await findWeekAvailability([range(), range(monday.add(1))]);
    assert.equal(results.length, 2);
    assert.ok(results.every((result) => result.state === "error" && result.spaces.length === 0));
    assert.match(results[0].error!, /isn't configured/);
  });
});

describe("shared Geisel day loader", () => {
  it("rejects mismatched responses without poisoning the cache, then shares a valid response", async (context) => {
    const names = ["LIBCAL_PROXY_URL", "document"] as const;
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, "LIBCAL_PROXY_URL", { configurable: true, value: "https://library.example/" });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "https://site.example/" } });
    context.after(() => names.forEach((name, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }));
    let calls = 0;
    const date = monday.add(10);
    context.mock.method(globalThis, "fetch", async (_url: URL, options?: RequestInit) => {
      calls++;
      assert.ok(options?.signal instanceof AbortSignal);
      return Response.json({ date: (calls === 1 ? date.add(1) : date).toString(), fetchedAt: fetchedAt.toISOString(), windowEnd: false, spaces: {} });
    });
    await assert.rejects(loadGeiselAvailability(date), /different date/);
    const [first, second] = await Promise.all([
      loadGeiselAvailability(date), loadGeiselAvailability(Day.fromId(date.id)),
    ]);
    assert.equal(first, second);
    assert.equal(first.date.id, date.id);
    assert.equal(calls, 2);
  });
});

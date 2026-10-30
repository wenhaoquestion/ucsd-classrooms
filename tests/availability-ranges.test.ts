import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRangeFree, validateWeekRange } from "../src/lib/availabilityRanges";
import { Day } from "../src/lib/Day";
import type { Slot, SlotStatus } from "../src/lib/library/geisel";
import { Time } from "../src/lib/Time";

const time = (hour: number, minute = 0) => new Time(hour, minute);
const slot = (start: number, end: number, status: SlotStatus = "free"): Slot => ({
  start: Time.from(start), end: Time.from(end), status,
});

describe("weekly availability range validation", () => {
  // The Sunday in this Pacific week is the daylight-saving transition.
  const now = { date: Day.from(2026, 10, 29), time: time(10, 30) };
  const range = (date: Day, start = time(12), end = time(13)) => ({ date, start, end });

  it("accepts remaining days through Sunday across the daylight-saving transition", () => {
    assert.equal(validateWeekRange(range(Day.from(2026, 11, 1)), now), null);
    assert.notEqual(validateWeekRange(range(Day.from(2026, 11, 2)), now), null);
    assert.notEqual(validateWeekRange(range(Day.from(2026, 10, 25)), now), null);
  });

  it("rejects past days and past starts but accepts the current minute", () => {
    assert.notEqual(validateWeekRange(range(now.date.add(-1)), now), null);
    assert.notEqual(validateWeekRange(range(now.date, time(10, 29), time(11)), now), null);
    assert.equal(validateWeekRange(range(now.date, time(10, 30), time(11)), now), null);
  });

  it("accepts midnight only as the end of a valid same-day range", () => {
    assert.equal(validateWeekRange(range(now.date, time(23), Time.from(1440)), now), null);
    assert.notEqual(validateWeekRange(range(now.date, time(24), time(24)), now), null);
    assert.notEqual(validateWeekRange(range(now.date, time(23), time(1)), now), null);
    assert.notEqual(validateWeekRange(range(now.date, time(12), time(12)), now), null);
  });

  it("rejects malformed dates and times", () => {
    assert.notEqual(validateWeekRange(range(new Day(new Date(NaN))), now), null);
    assert.notEqual(validateWeekRange(range(now.date, time(12, 60)), now), null);
    assert.notEqual(validateWeekRange(range(now.date, time(12, 0.5)), now), null);
    assert.notEqual(validateWeekRange(range(now.date, time(12), time(24, 1)), now), null);
  });

  it("keeps Monday–Sunday boundaries when the week crosses a year", () => {
    const yearEnd = { date: Day.from(2026, 12, 31), time: time(10) };
    assert.equal(validateWeekRange(range(Day.from(2027, 1, 3)), yearEnd), null);
    assert.notEqual(validateWeekRange(range(Day.from(2027, 1, 4)), yearEnd), null);
  });
});

describe("full-interval LibCal availability", () => {
  it("combines adjacent free slots without changing their input order", () => {
    const slots = [slot(630, 660), slot(600, 630)];
    assert.equal(isRangeFree(slots, time(10), time(11)), true);
    assert.deepEqual(slots.map((item) => +item.start), [630, 600]);
  });

  it("accepts a subrange and ignores reservations touching its endpoints", () => {
    const slots = [slot(540, 600, "booked"), slot(600, 660), slot(660, 720, "booked")];
    assert.equal(isRangeFree(slots, time(10), time(11)), true);
    assert.equal(isRangeFree(slots, time(10, 15), time(10, 45)), true);
    assert.equal(isRangeFree(slots, time(10), time(11, 1)), false);
  });

  it("does not treat absent data or any uncovered portion as available", () => {
    assert.equal(isRangeFree(undefined, time(10), time(11)), false);
    assert.equal(isRangeFree([], time(10), time(11)), false);
    assert.equal(isRangeFree([slot(601, 660)], time(10), time(11)), false);
    assert.equal(isRangeFree([slot(600, 659)], time(10), time(11)), false);
    assert.equal(isRangeFree([slot(600, 630), slot(631, 660)], time(10), time(11)), false);
  });

  it("rejects bookings and closures inside an otherwise free interval", () => {
    for (const status of ["booked", "closed"] as const) {
      assert.equal(isRangeFree([slot(600, 630), slot(630, 645, status), slot(645, 660)],
        time(10), time(11)), false);
    }
  });

  it("rejects overlapping evidence even when one free slot covers the whole range", () => {
    assert.equal(isRangeFree([slot(600, 660), slot(630, 645, "booked")], time(10), time(11)), false);
    assert.equal(isRangeFree([slot(600, 660), slot(630, 645)], time(10), time(11)), false);
    assert.equal(isRangeFree([slot(600, 660), slot(600, 660)], time(10), time(11)), false);
  });

  it("supports end-of-day slots and rejects invalid intervals or malformed source times", () => {
    assert.equal(isRangeFree([slot(1380, 1440)], time(23), time(24)), true);
    assert.equal(isRangeFree([slot(600, 660)], time(11), time(10)), false);
    assert.equal(isRangeFree([slot(600, 660)], time(10), time(10)), false);
    assert.equal(isRangeFree([slot(600, 600)], time(10), time(11)), false);
    assert.equal(isRangeFree([{ start: time(10), end: time(24, 1), status: "free" }],
      time(10), time(11)), false);
  });
});

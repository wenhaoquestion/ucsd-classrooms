import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCampusWeekAvailability, type CampusTermLoader } from "../src/lib/campusWeekAvailability";
import { Day } from "../src/lib/Day";
import type { Course, Exam, Meeting } from "../src/lib/section-types";
import { Time } from "../src/lib/Time";
import { getTermDays } from "../src/lib/terms";

const t = (minutes: number) => Time.from(minutes);
const range = (date: Day, start = 600, end = 660) => ({ date, start: t(start), end: t(end) });
const meeting = (room: string, start: number, end: number, days = [4]): Meeting => ({
  kind: "meeting", code: "A00", type: "LE", location: { building: "CENTR", room },
  time: { days, start: t(start), end: t(end) },
});
const exam = (room: string, date: Day): Exam => ({
  kind: "exam", type: "FI", date, location: { building: "CENTR", room },
  time: { days: [date.day], start: t(600), end: t(660) },
});
const course = (meetings: Meeting[], exams: Exam[] = []): Course => ({
  code: "TEST 1", title: "Availability test", groups: [{
    code: "A00", sectionTitle: null, sections: [], meetings, exams,
    instructors: [], coscheduled: [],
  }],
});
const loaderFor = (courses: Course[]): CampusTermLoader => (terms) => ({
  successes: terms.map((request) => ({ request, result: { courses, scraped: new Date(0) } })),
  errors: [],
});

describe("campus interval availability", () => {
  const thursday = Day.from(2026, 10, 29);

  it("checks the entire interval, including a meeting strictly inside it", async () => {
    const [result] = await findCampusWeekAvailability([range(thursday)], loaderFor([
      course([meeting("101", 615, 630), meeting("102", 700, 760)]),
    ]));
    assert.equal(result.state, "ready");
    assert.deepEqual(result.rooms, [{ building: "CENTR", room: "102" }]);
  });

  it("allows touching endpoints without applying the instant-view soon buffer", async () => {
    const [result] = await findCampusWeekAvailability([range(thursday, 595, 600)], loaderFor([
      course([meeting("101", 600, 660), meeting("102", 540, 595)]),
    ]));
    assert.equal(result.rooms.length, 2);
  });

  it("matches weekly weekdays and exam dates independently", async () => {
    const courses = [course([meeting("101", 600, 660, [5])], [exam("102", thursday.add(7))])];
    const results = await findCampusWeekAvailability([
      range(thursday), range(thursday.add(1)), range(thursday.add(7)),
    ], loaderFor(courses));
    assert.deepEqual(results.map((result) => result.rooms.map((room) => room.room)), [
      ["101", "102"], ["102"], ["101"],
    ]);
  });

  it("suppresses recurring lectures during finals while retaining dated exams", async () => {
    const date = getTermDays(2026, "FA").finals;
    const [result] = await findCampusWeekAvailability([range(date)], loaderFor([
      course([meeting("101", 600, 660, [date.day])], [exam("102", date)]),
    ]));
    assert.deepEqual(result.rooms.map((room) => room.room), ["101"]);
  });

  it("deduplicates term loads while returning separate results in requested order", async () => {
    let calls = 0;
    const loader: CampusTermLoader = (terms) => {
      calls++;
      return loaderFor([course([meeting("101", 600, 660)])])(terms);
    };
    const ranges = [range(thursday, 700, 760), range(thursday), range(thursday.add(1))];
    const results = await findCampusWeekAvailability(ranges, loader);
    assert.equal(calls, 1);
    assert.deepEqual(results.map((result) => result.range), ranges);
    assert.deepEqual(results.map((result) => result.rooms.length), [1, 0, 1]);
  });

  it("loads each date's term rather than reusing an unrelated selected term", async () => {
    const requested: string[] = [];
    const loader: CampusTermLoader = (terms) => {
      requested.push(...terms.map((term) => `${term.quarter}${term.year}`));
      return loaderFor([course([meeting("101", 700, 760)])])(terms);
    };
    const results = await findCampusWeekAvailability([
      range(thursday), range(Day.from(2027, 1, 12)),
    ], loader);
    assert.deepEqual(requested, ["FA2026", "WI2027"]);
    assert.ok(results.every((result) => result.state === "ready"));
  });

  it("never reports free rooms from incomplete or failed schedule data", async () => {
    const summer = Day.from(2026, 7, 7);
    const [partial] = await findCampusWeekAvailability([range(summer)], (terms) => ({
      successes: [{ request: terms[0], result: {
        courses: [course([meeting("101", 700, 760)])], scraped: new Date(0),
      } }],
      errors: [{ request: terms[1], type: "offline" }],
    }));
    assert.equal(partial.state, "error");
    assert.deepEqual(partial.rooms, []);
    const [missing] = await findCampusWeekAvailability([range(thursday)], () => ({ successes: [], errors: [] }));
    assert.equal(missing.state, "unavailable");
    const [failed] = await findCampusWeekAvailability([range(thursday)], () => { throw new Error("Offline"); });
    assert.equal(failed.state, "error");
  });

  it("does not present holidays or academic breaks as empty free classrooms", async () => {
    const loader: CampusTermLoader = () => { throw new Error("Should not load"); };
    const results = await findCampusWeekAvailability([
      range(Day.from(2026, 11, 26)), range(Day.from(2026, 12, 20)),
    ], loader);
    assert.ok(results.every((result) => result.state === "unavailable" && result.rooms.length === 0));
  });

  it("returns an error for a stalled host instead of blocking other space results", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = findCampusWeekAvailability([range(thursday)], () => new Promise(() => {}));
    context.mock.timers.tick(15_000);
    const [result] = await pending;
    assert.equal(result.state, "error");
    assert.deepEqual(result.rooms, []);
  });

  it("treats special summer meetings conservatively outside their retained date range", async () => {
    const summerCourse = course([meeting("101", 600, 660, [2])]);
    summerCourse.groups[0].dateRange = { start: Day.from(2026, 8, 1), end: Day.from(2026, 8, 31) };
    const [result] = await findCampusWeekAvailability([range(Day.from(2026, 7, 7))], loaderFor([summerCourse]));
    assert.equal(result.state, "ready");
    assert.deepEqual(result.rooms, []);
  });
});

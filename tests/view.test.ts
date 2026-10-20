import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Day } from "../src/lib/Day";
import { Time } from "../src/lib/Time";
import { viewFromUrl, viewToUrl, ViewWithTerm } from "../src/lib/View";

// viewToUrl builds on the current page URL
(globalThis as unknown as { window: unknown }).window = {
  location: {
    pathname: "/ucsd-classrooms/",
    href: "https://example.test/ucsd-classrooms/",
  },
};

describe("building/room URLs used by the 3D explorer", () => {
  it("round-trips building and room keys exactly as strings", () => {
    for (const room of ["B240", "0110", "1202", "2229A"]) {
      const view: ViewWithTerm = { type: "building", building: "EBU3B", room, term: null };
      const parsed = viewFromUrl(viewToUrl(view).href);
      assert.equal(parsed.type, "building");
      assert.equal(parsed.type === "building" && parsed.building, "EBU3B");
      assert.equal(parsed.type === "building" && parsed.room, room);
    }
  });

  it("keeps the selected date and time alongside the room", () => {
    const term = { date: Day.from(2026, 10, 14), time: Time.parse24("10:15")! };
    const url = viewToUrl({ type: "building", building: "EBU3B", room: "4140", term });
    assert.equal(
      url.search,
      "?term=2026-10-14T10.15&building=EBU3B&room=4140"
    );
    const parsed = viewFromUrl(url.href);
    assert.ok(parsed.term && "date" in parsed.term);
    assert.equal(parsed.term && "date" in parsed.term && parsed.term.date.id, term.date.id);
  });

  it("adds no viewer parameters (camera and floor stay out of history)", () => {
    const url = viewToUrl({ type: "building", building: "EBU3B", room: null, term: null });
    assert.deepEqual([...url.searchParams.keys()], ["building"]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchScore, normalize, prepare, roomMatches, splitRoomQuery } from "../src/lib/search";
import { search, SearchData } from "../src/components/search/SearchResults";
import { Course } from "../src/lib/section-types";

const score = (query: string, target: string) => matchScore(prepare(query), prepare(target)).score;
const course = (code: string, title: string): Course => ({ code, title, groups: [] });

describe("search matching", () => {
  it("normalizes case, punctuation, and letter/digit runs", () => {
    assert.equal(normalize("CSE100"), "cse 100");
    assert.equal(normalize("Peterson-Hall"), "peterson hall");
    assert.equal(normalize("Café"), "cafe");
  });

  it("ranks exact > prefix > reordered words > inside words > typos", () => {
    const exact = score("cse100", "CSE 100");
    const prefix = score("cse 1", "CSE 100");
    const reordered = score("smith john", "John Smith");
    const inside = score("biology", "Microbiology");
    const typo = score("galbrath", "Galbraith Hall");
    assert.equal(exact, 100);
    assert.ok(prefix >= 80 && prefix < exact);
    assert.ok(reordered >= 50 && reordered < prefix);
    assert.ok(inside > typo && inside < reordered);
    assert.ok(typo > 0);
  });

  it("matches building initials", () => {
    assert.equal(score("wlh", "Warren Lecture Hall"), 55);
    assert.equal(score("xyz", "Warren Lecture Hall"), 0);
  });

  it("highlights the matched part of the original text", () => {
    const { ranges } = matchScore(prepare("intro prog"), prepare("Intro to Programming"));
    assert.deepEqual(ranges, [{ start: 0, end: 5 }, { start: 9, end: 13 }]);
  });

  it("does not treat short words or numbers as typos", () => {
    assert.equal(score("cse 101", "CSE 110"), 0);
    assert.equal(score("abc", "abd"), 0);
  });

  it("splits room queries", () => {
    assert.deepEqual(splitRoomQuery("wlh2005"), { building: "wlh", room: "2005" });
    assert.deepEqual(splitRoomQuery("CENTR-1"), { building: "CENTR", room: "1" });
    assert.deepEqual(splitRoomQuery("warren lecture hall 21"), { building: "warren lecture hall", room: "21" });
    assert.deepEqual(splitRoomQuery("ebu3b b210"), { building: "ebu3b", room: "B210" });
    assert.equal(splitRoomQuery("2005"), null);
    assert.equal(splitRoomQuery("geisel"), null);
    assert.ok(roomMatches("0110", "110"));
    assert.ok(!roomMatches("1110", "0"));
  });
});

describe("search results", () => {
  const data: SearchData = {
    courses: [
      course("CSE 100", "Advanced Data Structures"),
      course("CSE 101", "Design & Analysis of Algorithm"),
      course("MATH 20A", "Calculus for Science & Engineering"),
    ],
    professors: [{ first: "John", last: "Smith" }],
    buildings: ["WLH", "CENTR", "GEISEL"],
    rooms: { WLH: ["2001", "2005", "2111"], CENTR: ["101", "115"], GEISEL: ["2070", "2071"] },
  };
  const run = (query: string) => {
    const index = {
      courses: data.courses.map((c) => ({ course: c, code: prepare(c.code), title: prepare(c.title) })),
      professors: data.professors.map((p) => ({ ...p, name: prepare(`${p.first} ${p.last}`) })),
      buildings: data.buildings.map((code) => ({ code, codePrep: prepare(code), name: prepare(code) })),
    };
    return search(index, data, query);
  };

  it("finds courses typed without a space", () => {
    assert.equal(run("cse100")[0].primary, "CSE 100");
  });

  it("puts rooms first for room queries", () => {
    const results = run("wlh2005");
    assert.equal(results[0].section, "Rooms");
    assert.equal(results[0].primary, "WLH 2005");
  });

  it("finds Geisel study rooms", () => {
    assert.deepEqual(run("geisel 207").filter((r) => r.section === "Rooms").map((r) => r.primary), ["GEISEL 2070", "GEISEL 2071"]);
  });

  it("finds professors in either name order", () => {
    assert.equal(run("smith j")[0].primary, "John Smith");
  });

  it("treats numbers before other words as complete", () => {
    assert.deepEqual(run("math20a").map((r) => r.primary), ["MATH 20A"]);
  });

  it("finds course titles by abbreviated words", () => {
    assert.equal(run("data struct")[0].primary, "Advanced Data Structures");
  });
});

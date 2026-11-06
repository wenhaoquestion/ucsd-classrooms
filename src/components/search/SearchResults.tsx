import { useMemo } from "react";
import { buildings } from "../../lib/buildings";
import { compareRoomNums } from "../../lib/compareRoomNums";
import {
  bestMatch,
  matchScore,
  prepare,
  Prepared,
  Range,
  rank,
  roomMatches,
  splitRoomQuery,
} from "../../lib/search";
import { Course } from "../../lib/section-types";
import { Term } from "../../lib/TermCache";
import { termName } from "../../lib/terms";
import { View } from "../../lib/View";
import { SearchResult } from "./SearchResult";

export type SearchData = {
  courses: Course[];
  professors: { first: string; last: string }[];
  buildings: string[];
  /** Room numbers by building code. */
  rooms: Record<string, string[]>;
  /** Display names for rooms that aren't plain numbers, e.g. Geisel's spaces. */
  roomTitles?: Record<string, string>;
};

/** A row in the results list. */
export type ResultItem = {
  key: string;
  section: "Rooms" | "Courses" | "Professors" | "Buildings";
  primary: string;
  secondary?: string;
  /** Which text is the code, for the narrow font. */
  primaryIsCode: boolean;
  ranges?: Range[];
  view: View;
  score: number;
  label: string;
};

type SearchIndex = {
  courses: { course: Course; code: Prepared; title: Prepared }[];
  professors: { first: string; last: string; name: Prepared }[];
  buildings: { code: string; codePrep: Prepared; name: Prepared }[];
};

const MAX_ROOMS = 6;

function buildIndex(data: SearchData): SearchIndex {
  return {
    courses: data.courses.map((course) => ({
      course,
      code: prepare(course.code),
      title: prepare(course.title),
    })),
    professors: data.professors.map(({ first, last }) => ({
      first,
      last,
      name: prepare(`${first} ${last}`),
    })),
    buildings: data.buildings.map((code) => ({
      code,
      codePrep: prepare(code),
      name: prepare(buildings[code]?.name ?? code),
    })),
  };
}

/** Rooms for queries like "centr 115", "CENTR-1", "wlh2005", or "geisel 2070". */
function searchRooms(index: SearchIndex, data: SearchData, query: string): ResultItem[] {
  const split = splitRoomQuery(query);
  if (!split) return [];
  const buildingQuery = prepare(split.building);
  const results: ResultItem[] = [];
  for (const building of index.buildings) {
    const rooms = data.rooms[building.code];
    if (!rooms) continue;
    const match = bestMatch(buildingQuery, [
      ["code", building.codePrep],
      ["name", building.name],
    ]);
    // Only confident building matches; typos would flood the list with rooms
    if (!match || match.score < 50) continue;
    for (const room of rooms) {
      if (!roomMatches(room, split.room)) continue;
      const exact = room.toUpperCase() === split.room;
      const title = data.roomTitles?.[`${building.code} ${room}`];
      results.push({
        key: `room\t${building.code}\t${room}`,
        section: "Rooms",
        primary: `${building.code} ${room}`,
        secondary: title
          ? `${title} · ${buildings[building.code]?.name ?? building.code}`
          : buildings[building.code]?.name ?? building.code,
        primaryIsCode: true,
        view: { type: "building", building: building.code, room },
        score: match.score * 0.9 + (exact ? 6 : 0),
        label: `${building.code} ${room}`,
      });
    }
  }
  const roomOf = (item: ResultItem) => (item.view.type === "building" && item.view.room) || "";
  return results
    .sort((a, b) => b.score - a.score || compareRoomNums(roomOf(a), roomOf(b)))
    .slice(0, MAX_ROOMS);
}

export function search(index: SearchIndex, data: SearchData, rawQuery: string): ResultItem[] {
  const query = prepare(rawQuery);
  if (query.tokens.length === 0) return [];

  const courses = rank(
    index.courses.flatMap(({ course, code, title }): ResultItem[] => {
      const match = bestMatch(query, [
        ["code", code],
        ["title", title],
      ]);
      if (!match) return [];
      const byCode = match.field === "code";
      return [
        {
          key: `course\t${course.code}`,
          section: "Courses",
          primary: byCode ? course.code : course.title,
          secondary: byCode ? course.title : course.code,
          primaryIsCode: byCode,
          ranges: match.ranges,
          view: { type: "course", course: course.code },
          score: match.score,
          label: course.code,
        },
      ];
    }),
    15
  );
  const professors = rank(
    index.professors.flatMap(({ first, last, name }): ResultItem[] => {
      const match = matchScore(query, name);
      if (match.score === 0) return [];
      return [
        {
          key: `professor\t${last}, ${first}`,
          section: "Professors",
          primary: name.text,
          primaryIsCode: false,
          ranges: match.ranges,
          view: { type: "professor", name: `${last}, ${first}` },
          score: match.score,
          label: name.text,
        },
      ];
    }),
    15
  );
  const buildingResults = rank(
    index.buildings.flatMap(({ code, codePrep, name }): ResultItem[] => {
      const match = bestMatch(query, [
        ["code", codePrep],
        ["name", name],
      ]);
      if (!match) return [];
      const byCode = match.field === "code";
      return [
        {
          key: `building\t${code}`,
          section: "Buildings",
          primary: byCode ? code : name.text,
          secondary: byCode ? name.text : code,
          primaryIsCode: byCode,
          ranges: match.ranges,
          view: { type: "building", building: code },
          // Exact building codes are what people mean by short queries
          score: match.score + (byCode && match.score === 100 ? 5 : 0),
          label: code,
        },
      ];
    }),
    15
  );
  const rooms = searchRooms(index, data, rawQuery);

  // Typo matches only fill in when nothing better was found
  const sections = [rooms, courses, buildingResults, professors];
  const best = Math.max(0, ...sections.flatMap((items) => items.map((item) => item.score)));
  const floor = best >= 30 ? 30 : 0;
  const trimmed = sections
    .map((items) => items.filter((item) => item.score >= floor))
    .filter((items) => items.length > 0);
  const maxSectionLength = trimmed.length >= 3 ? 5 : trimmed.length === 2 ? 7 : 12;
  // Sections with the strongest match come first
  return trimmed
    .map((items, order) => ({ items: items.slice(0, maxSectionLength), order }))
    .sort((a, b) => b.items[0].score - a.items[0].score || a.order - b.order)
    .flatMap(({ items }) => items);
}

export function useSearchIndex(data: SearchData): SearchIndex {
  return useMemo(() => buildIndex(data), [data]);
}

export type SearchResultsProps = {
  terms: Term[];
  query: string;
  data: SearchData;
  index: number | null;
  ongoingOnly: boolean;
  loadingCourses: boolean;
  onPick?: (item: ResultItem) => void;
};
export function SearchResults({
  terms,
  query,
  data,
  index,
  ongoingOnly,
  loadingCourses,
  onPick,
}: SearchResultsProps) {
  const searchIndex = useSearchIndex(data);
  const results = useMemo(
    () => search(searchIndex, data, query),
    [searchIndex, data, query]
  );
  const length = results.length;
  index = index === null || length === 0 ? -1 : ((index % length) + length) % length;
  if (length === 0) {
    if (query.trim() === "") {
      return null;
    }
    return (
      <p className="no-results" role="status">
        {loadingCourses
          ? "Loading courses and professors…"
          : ongoingOnly
          ? "No courses with ongoing lectures match your search."
          : `Nothing matches “${query.trim()}” in ${terms
              .map(({ year, quarter }) => termName(year, quarter))
              .join(" or ")}. Try a course code (CSE 100), a building (WLH), or a room (CENTR 115).`}
      </p>
    );
  }
  return (
    <div className="results" role="listbox" aria-label="Search results">
      {results.map((item, i) => (
        <SearchResultRow
          item={item}
          heading={i === 0 || results[i - 1].section !== item.section}
          selected={i === index}
          key={item.key}
          onPick={onPick}
        />
      ))}
      {loadingCourses && (
        <p className="results-loading" role="status">
          Loading courses and professors…
        </p>
      )}
    </div>
  );
}

export function SearchResultRow({
  item,
  heading,
  selected,
  onPick,
}: {
  item: ResultItem;
  heading: boolean;
  selected: boolean;
  onPick?: (item: ResultItem) => void;
}) {
  return (
    <>
      {heading && <h2 className="result-heading">{item.section}</h2>}
      <SearchResult
        name={item.primaryIsCode ? item.secondary : item.primary}
        code={item.primaryIsCode ? item.primary : item.secondary}
        primary={item.primaryIsCode ? "code" : "name"}
        ranges={item.ranges}
        selected={selected}
        view={item.view}
        onNavigate={() => onPick?.(item)}
      />
    </>
  );
}

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { isMeetingOngoing, useMoment } from "../../lib/moment-context";
import { Meeting, Section } from "../../lib/section-types";
import { Term } from "../../lib/TermCache";
import { ClearIcon } from "../icons/CloseIcon";
import { SearchIcon } from "../icons/SearchIcon";
import {
  ResultItem,
  SearchData,
  SearchResultRow,
  SearchResults,
} from "./SearchResults";

export type State =
  | { type: "unloaded" }
  | { type: "loading" }
  | {
      type: "loaded";
      termId: string;
      data: Omit<SearchData, "buildings" | "rooms">;
      offline: Term[];
    };

const RECENT_KEY = "ucsd-classrooms:recent-searches";
const MAX_RECENT = 6;
type Recent = Omit<ResultItem, "ranges" | "score">;

function loadRecent(): Recent[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is Recent =>
            item && typeof item.key === "string" && typeof item.primary === "string" && item.view
        )
      : [];
  } catch {
    return [];
  }
}

function saveRecent(items: Recent[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items));
  } catch {
    // Private browsing; recent searches just won't persist
  }
}

export type SearchBarProps = {
  state: State;
  terms: Term[];
  termId: string;
  buildings: string[];
  rooms: Record<string, string[]>;
  roomTitles?: Record<string, string>;
  showResults: boolean;
  onSearch: (showResults: boolean) => void;
  visible: boolean;
};
export function SearchBar({
  state,
  terms,
  termId,
  buildings,
  rooms,
  roomTitles,
  showResults,
  onSearch,
  visible,
}: SearchBarProps) {
  const moment = useMoment();
  const [query, setQuery] = useState("");
  // Typing stays responsive while results for large terms catch up
  const deferredQuery = useDeferredValue(query);
  const [index, setIndex] = useState(0);
  const [ongoingOnly, setOngoingOnly] = useState(false);
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<Recent[]>(loadRecent);
  const ref = useRef<HTMLInputElement>(null);

  const loaded = state.type === "loaded" && state.termId === termId;
  const loadingCourses = !loaded;
  const showRecent = focused && query === "" && recent.length > 0;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }
      if ((e.key === "/" || e.key === "s") && e.target === document.body) {
        ref.current?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const baseData = useMemo(
    (): SearchData => ({
      courses: state.type === "loaded" && loaded ? state.data.courses : [],
      professors: state.type === "loaded" && loaded ? state.data.professors : [],
      buildings,
      rooms,
      roomTitles,
    }),
    [state, loaded, buildings, rooms, roomTitles]
  );
  const ongoingData = useMemo(
    (): SearchData | null =>
      ongoingOnly
        ? {
            courses: baseData.courses.filter((course) =>
              course.groups.some((group) => {
                const test = (meeting: Meeting | Section) =>
                  (meeting.type === "LE" || meeting.type === "SE") &&
                  isMeetingOngoing(meeting, moment);
                return group.meetings.some(test) || group.sections.some(test);
              })
            ),
            professors: [],
            buildings: [],
            rooms: {},
          }
        : null,
    [ongoingOnly, baseData, moment]
  );
  const data = ongoingData ?? baseData;

  const remember = (item: ResultItem | Recent) => {
    const entry: Recent = {
      key: item.key,
      section: item.section,
      primary: item.primary,
      secondary: item.secondary,
      primaryIsCode: item.primaryIsCode,
      view: item.view,
      label: item.label,
    };
    setRecent((items) => {
      const next = [entry, ...items.filter((other) => other.key !== entry.key)].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
    ref.current?.blur();
  };

  const showingResults = showResults && query !== "";

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        // This sucks but I'm too lazy to think of a good React way to do
        // this
        const selected = e.currentTarget
          .closest(".search-wrapper")
          ?.querySelector(".result-selected");
        if (selected instanceof HTMLElement) {
          selected.click();
        }
      }}
      className={`search-wrapper ${visible ? "" : "hide-search"} ${
        showingResults ? "showing-results" : ""
      }`}
    >
      <label className="search-bar">
        <SearchIcon />
        <input
          type="search"
          enterKeyHint="go"
          id="search"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search courses, professors, buildings, and rooms."
          aria-expanded={showingResults || showRecent}
          title="Press '/' to jump to the search box."
          placeholder="Course, professor, building, or room"
          className="search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setIndex(0);
            onSearch(e.currentTarget.value.length > 0);
          }}
          onKeyDown={(e) => {
            if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) {
              return;
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              setIndex((index) => index + (e.key === "ArrowUp" ? -1 : 1));
              e.preventDefault();
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (query !== "") {
                setQuery("");
                setIndex(0);
                onSearch(false);
              } else {
                e.currentTarget.blur();
              }
            }
          }}
          onFocus={(e) => {
            setFocused(true);
            setIndex(0);
            onSearch(e.currentTarget.value.length > 0);
          }}
          onBlur={() => setFocused(false)}
          ref={ref}
        />
        {query.length > 0 && (
          <button
            className="icon-btn clear-btn"
            type="reset"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              onSearch(false);
              ref.current?.focus();
            }}
          >
            <ClearIcon />
          </button>
        )}
      </label>
      {showRecent && (
        // Keep focus in the box so the list doesn't vanish mid-click
        <div
          className="results"
          role="listbox"
          aria-label="Recent searches"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="result-heading result-heading-row">
            <h2 className="result-heading-text">Recent</h2>
            <button
              type="button"
              className="result-heading-action"
              onClick={() => {
                setRecent([]);
                saveRecent([]);
              }}
            >
              Clear
            </button>
          </div>
          {recent.map((item, i) => (
            <SearchResultRow
              key={item.key}
              item={{ ...item, score: 0 }}
              heading={false}
              selected={((index % recent.length) + recent.length) % recent.length === i}
              onPick={() => remember(item)}
            />
          ))}
        </div>
      )}
      {showResults && (
        <SearchResults
          terms={terms}
          query={deferredQuery}
          data={data}
          index={index}
          ongoingOnly={ongoingOnly}
          loadingCourses={loadingCourses}
          onPick={remember}
        />
      )}
      <label
        className={`ongoing-only ${
          showingResults && loaded ? "show-ongoing-only" : ""
        }`}
      >
        <input
          type="checkbox"
          checked={ongoingOnly}
          onChange={(e) => {
            setOngoingOnly(e.currentTarget.checked);
          }}
        />
        Only courses with a lecture now
      </label>
    </form>
  );
}

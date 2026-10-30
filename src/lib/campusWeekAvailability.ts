import type { AvailabilityRange } from "./availabilityRanges";
import { buildings } from "./buildings";
import { compareRoomNums } from "./compareRoomNums";
import { coursesToClassrooms, type TermBuildings } from "./coursesToClassrooms";
import { getHolidays } from "./holidays";
import { doesMeetingHappen, fromViewTerm } from "./moment-context";
import { TermCache, type Term, type TermResults } from "./TermCache";
import { getTerm, termCode, type CurrentTerm } from "./terms";

export type CampusAvailableRoom = { building: string; room: string };
export type CampusRangeAvailability = {
  range: AvailabilityRange;
  /** Rooms with no scheduled meeting overlapping this entire interval. */
  rooms: CampusAvailableRoom[];
  state: "ready" | "error" | "unavailable";
  error?: string;
};
export type CampusTermLoader = (terms: Term[]) => TermResults | Promise<TermResults>;

const termCache = new TermCache();
const defaultLoader: CampusTermLoader = (terms) => termCache.requestTerms(terms);
const LOAD_TIMEOUT_MS = 15_000;

/** Same term coverage as the main schedule, computed for each requested date. */
function termsForDate({ year, season, current }: CurrentTerm): Term[] {
  return [
    ...(current ? [{ year, quarter: season }] : []),
    ...(season === "S1" || season === "S2" || (season === "FA" && !current)
      ? [{ year, quarter: "S3" as const }]
      : []),
  ];
}

type LoadedSchedules =
  | { state: "ready"; buildings: TermBuildings }
  | { state: "error" | "unavailable"; error: string };

async function loadSchedules(terms: Term[], loader: CampusTermLoader): Promise<LoadedSchedules> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // TermCache does not expose cancellation. Bound the caller's wait so a
    // stalled campus host cannot also prevent library results from appearing.
    const result = await Promise.race([
      Promise.resolve().then(() => loader(terms)),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Schedule request timed out")), LOAD_TIMEOUT_MS);
      }),
    ]);
    // Absence is conclusive only when every required term loaded. Never show
    // partial results as free, including overlapping summer sessions.
    if (result.errors.some((error) => error.type === "offline")) {
      return { state: "error", error: "Some class schedules could not be loaded. Try again." };
    }
    if (result.errors.length || terms.some((term) => !result.successes.some(({ request }) =>
      request.year === term.year && request.quarter === term.quarter
    ))) {
      return { state: "unavailable", error: "Complete class schedules are not available for these dates." };
    }
    const mapped = coursesToClassrooms(result.successes.flatMap(({ result }) => result.courses));
    if (!Object.keys(mapped).length) {
      return { state: "unavailable", error: "No classroom schedule data is available for these dates." };
    }
    return { state: "ready", buildings: mapped };
  } catch {
    return { state: "error", error: "Class schedules could not be loaded. Try again." };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search each range independently using its date's complete term schedules.
 * Call validateWeekRange before submitting UI input. This function intentionally
 * does not read the UI's selected date or restrict historical test fixtures.
 * Results describe scheduled classes, never physical occupancy or door access.
 */
export async function findCampusWeekAvailability(
  ranges: readonly AvailabilityRange[],
  loader: CampusTermLoader = defaultLoader
): Promise<CampusRangeAvailability[]> {
  const requests = new Map<string, Promise<LoadedSchedules>>();
  return Promise.all(ranges.map(async (range): Promise<CampusRangeAvailability> => {
    const base = { range, rooms: [] };
    if (!range.date.valid || !Number.isFinite(+range.start) || !Number.isFinite(+range.end) ||
      +range.start < 0 || +range.start >= +range.end || +range.end > 1440) {
      return { ...base, state: "unavailable", error: "Choose a valid same-day time range." };
    }
    // Match the existing schedule UI's holiday behavior. An empty holiday
    // timetable does not establish that campus classrooms are accessible.
    if (getHolidays(range.date.year)[range.date.id]) {
      return { ...base, state: "unavailable", error: "Classroom availability is not shown on campus holidays." };
    }
    const terms = termsForDate(getTerm(range.date));
    if (!terms.length) {
      return { ...base, state: "unavailable", error: "Classroom schedules are not available during this academic break." };
    }
    const key = terms.map(({ year, quarter }) => termCode(year, quarter)).join(" ");
    let request = requests.get(key);
    if (!request) {
      request = loadSchedules(terms, loader);
      requests.set(key, request);
    }
    const schedules = await request;
    if (schedules.state !== "ready") {
      return { ...base, ...schedules };
    }
    const moment = fromViewTerm({ date: range.date, time: range.start });
    const rooms: CampusAvailableRoom[] = [];
    for (const [building, termRooms] of Object.entries(schedules.buildings)) {
      if (!buildings[building]) continue;
      for (const [room, meetings] of Object.entries(termRooms)) {
        const conflict = meetings.some((meeting) =>
          // The legacy room model retains only the special-session flag, not
          // its exact date range: treating those meetings conservatively as
          // recurring can exclude rooms, but cannot falsely mark them free.
          doesMeetingHappen(meeting, moment, range.date, meeting.special) &&
          meeting.time.start < range.end && range.start < meeting.time.end
        );
        if (!conflict) rooms.push({ building, room });
      }
    }
    rooms.sort((a, b) => a.building.localeCompare(b.building) || compareRoomNums(a.room, b.room));
    return { range, rooms, state: "ready" };
  }));
}

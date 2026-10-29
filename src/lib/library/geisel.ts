import { useEffect, useState } from "react";
import type { GeiselDay } from "../../../worker/libcal";
import { Day } from "../Day";
import { RoomStatusKind } from "../indoor/roomStatus";
import { Time } from "../Time";

/**
 * Geisel Library's bookable study rooms. Unlike registrar buildings, Geisel has
 * no classes; its rooms' status comes from reservations in the library's
 * LibCal system, fetched through a small proxy (worker/libcal.js) because
 * LibCal can't be read cross-origin.
 */
export const GEISEL = "GEISEL";

export function isLibrary(building: string): boolean {
  return building === GEISEL;
}

export type LibrarySpace = {
  /** Room key used in URLs (`?building=GEISEL&room=...`). */
  key: string;
  /** LibCal space ID. */
  eid: number;
  /** Display name. */
  title: string;
  capacity: number;
  /** Floor ID in `static/indoor/GEISEL.json`. */
  floor: string;
  /**
   * Geometry room: the room itself on floors 5-7, or the labeled block it's in
   * on floors 1-2. `null` if the library map doesn't show it.
   */
  room: string | null;
  note?: string;
};

const space = (
  key: string,
  eid: number,
  capacity: number,
  floor: string,
  room: string | null,
  title = `Room ${key}`,
  note?: string
): LibrarySpace => ({ key, eid, title, capacity, floor, room, ...(note ? { note } : {}) });

const tower = (floor: string, rooms: [key: string, eid: number, capacity?: number][]) =>
  rooms.map(([key, eid, capacity = 4]) => space(key, eid, capacity, floor, `${floor}-${key}`));

/** From https://ucsd.libcal.com/spaces?lid=11273, accessed 2026-10-28. */
export const GEISEL_SPACES: LibrarySpace[] = [
  space("1040", 102827, 5, "L1", "L1-1040-1045"),
  space("1041", 103886, 6, "L1", "L1-1040-1045"),
  space("1042", 103887, 6, "L1", "L1-1040-1045"),
  space("1043", 176274, 1, "L1", "L1-1040-1045", "Sensory Space (1043)"),
  space("1044", 213229, 8, "L1", "L1-1040-1045", "Student Community Space (1044)"),
  space("1045", 103888, 6, "L1", "L1-1040-1045"),
  space("2070", 103892, 4, "L2", "L2-2070-2072"),
  space("2071", 103893, 4, "L2", "L2-2070-2072"),
  space("2072", 103894, 8, "L2", "L2-2070-2072"),
  space("2096A", 102823, 6, "L2", "L2-2096A-B"),
  space("2096B", 103889, 6, "L2", "L2-2096A-B"),
  space("HUB1", 142340, 4, "L2", "L2-Hub-1-4", "Service Hub Room 1"),
  space("HUB3", 142341, 4, "L2", "L2-Hub-1-4", "Service Hub Room 3"),
  space("HUB4", 142342, 4, "L2", "L2-Hub-1-4", "Service Hub Room 4"),
  space("BOOTH1", 235437, 1, "L2", null, "Video Conferencing Booth 1", "Geisel 2 East, outside room 2095"),
  space("BOOTH2", 235438, 1, "L2", null, "Video Conferencing Booth 2", "Geisel 2 East, outside room 2095"),
  ...tower("L5", [["518", 103054], ["519", 103055], ["521", 103056], ["522", 103057]]),
  ...tower("L6", [
    ["618", 103058], ["619", 103059], ["620", 103060], ["622", 103061],
    ["623", 103062], ["624", 103063], ["625", 103064], ["626", 103065],
    ["627", 103066], ["629", 103067], ["630", 103068], ["631", 103069],
  ]),
  ...tower("L7", [
    ["718", 103070], ["719", 103073], ["720", 103074], ["721", 103071, 16],
    ["722", 103075], ["723", 81635], ["724", 81636],
  ]),
];

export const SPACES_BY_KEY = new Map(GEISEL_SPACES.map((space) => [space.key, space]));

/** Spaces in each geometry room (one for tower rooms, several for blocks). */
export const SPACES_BY_ROOM = new Map<string, LibrarySpace[]>();
for (const space of GEISEL_SPACES) {
  if (space.room) {
    SPACES_BY_ROOM.set(space.room, [...(SPACES_BY_ROOM.get(space.room) ?? []), space]);
  }
}

/** LibCal's page for a room, opened on `date`. Booking needs a UCSD login there. */
export function bookingUrl(space: LibrarySpace, date?: Day): string {
  return `https://ucsd.libcal.com/space/${space.eid}${date ? `?date=${date}` : ""}`;
}

export type SlotStatus = "free" | "booked" | "closed";
export type Slot = { start: Time; end: Time; status: SlotStatus };

export type DayAvailability = {
  date: Day;
  fetchedAt: Date;
  /** The date is at or past the end of LibCal's booking window. */
  windowEnd: boolean;
  /** Slots by LibCal space ID. Missing times aren't bookable. */
  spaces: Map<number, Slot[]>;
};

function parseTime(hhmm: string): Time {
  const [hour, minute] = hhmm.split(":").map(Number);
  // "24:00" is the end of the day
  return Time.from(hour * 60 + minute);
}

export function parseAvailability(data: GeiselDay): DayAvailability {
  const date = Day.parse(data.date);
  if (!date) {
    throw new TypeError(`Invalid date ${data.date}`);
  }
  return {
    date,
    fetchedAt: new Date(data.fetchedAt),
    windowEnd: data.windowEnd,
    spaces: new Map(
      Object.entries(data.spaces).map(([eid, slots]) => [
        Number(eid),
        slots.map(([start, end, status]) => ({
          start: parseTime(start),
          end: parseTime(end),
          status,
        })),
      ])
    ),
  };
}

export type SpaceStatus =
  /** Bookable now, until `until` (the end of the free run). */
  | { kind: "free"; until: Time }
  /** Reserved now, until `until`. */
  | { kind: "booked"; until: Time; nextFree: Time | null }
  /** Not bookable at this time (closed, or no slot), with the next free time. */
  | { kind: "closed"; nextFree: Time | null };

/** End of the run of slots with `status` that starts at `slots[from]`. */
function runEnd(slots: Slot[], from: number, status: SlotStatus): Time {
  let end = slots[from].end;
  for (let i = from + 1; i < slots.length; i++) {
    if (slots[i].status !== status || +slots[i].start !== +end) {
      break;
    }
    end = slots[i].end;
  }
  return end;
}

function nextFree(slots: Slot[], time: Time): Time | null {
  return slots.find((slot) => slot.status === "free" && slot.start >= time)?.start ?? null;
}

export function spaceStatus(slots: Slot[] | undefined, time: Time): SpaceStatus {
  if (!slots) {
    return { kind: "closed", nextFree: null };
  }
  const index = slots.findIndex((slot) => slot.start <= time && time < slot.end);
  const slot = slots[index];
  if (!slot || slot.status === "closed") {
    return { kind: "closed", nextFree: nextFree(slots, time) };
  }
  if (slot.status === "free") {
    return { kind: "free", until: runEnd(slots, index, "free") };
  }
  const until = runEnd(slots, index, "booked");
  return { kind: "booked", until, nextFree: nextFree(slots, until) };
}

/** A block's status: free if any room in it is free, else booked if any is. */
export function groupStatus(statuses: SpaceStatus[]): SpaceStatus["kind"] {
  return statuses.some((status) => status.kind === "free")
    ? "free"
    : statuses.some((status) => status.kind === "booked")
    ? "booked"
    : "closed";
}

/** Every space's status at `time`, by space key. */
export function spaceStatuses(data: DayAvailability, time: Time): Map<string, SpaceStatus> {
  return new Map(
    GEISEL_SPACES.map((space) => [space.key, spaceStatus(data.spaces.get(space.eid), time)])
  );
}

/** How a status colors a room in 3D. */
export const STATUS_KIND: Record<SpaceStatus["kind"], RoomStatusKind> = {
  free: "bookable",
  booked: "booked",
  closed: "closed",
};

/** Short description, e.g. "Free until 6:00 pm". */
export function describeStatus(status: SpaceStatus): string {
  if (status.kind === "free") {
    return +status.until >= 24 * 60 ? "Free rest of day" : `Free until ${status.until}`;
  }
  if (status.kind === "booked") {
    return +status.until >= 24 * 60 ? "Booked rest of day" : `Booked until ${status.until}`;
  }
  return status.nextFree ? `Not bookable, free at ${status.nextFree}` : "No free times left";
}

/** Consecutive slots with the same status, for a day timeline. */
export function slotRuns(slots: Slot[]): Slot[] {
  const runs: Slot[] = [];
  for (const slot of slots) {
    const last = runs[runs.length - 1];
    if (last && last.status === slot.status && +last.end === +slot.start) {
      last.end = slot.end;
    } else {
      runs.push({ ...slot });
    }
  }
  return runs;
}

declare const LIBCAL_PROXY_URL: string;

/** Base URL of the LibCal proxy, or `null` if this build has none. */
function proxyBase(): URL | null {
  const base = typeof LIBCAL_PROXY_URL === "string" ? LIBCAL_PROXY_URL : "";
  return base ? new URL(base.endsWith("/") ? base : `${base}/`, document.baseURI) : null;
}

/** Live data is cached this long, matching the proxy's cache. */
const REFRESH_MS = 60_000;
const cache = new Map<number, { at: number; promise: Promise<DayAvailability> }>();

function fetchAvailability(base: URL, date: Day): Promise<DayAvailability> {
  const cached = cache.get(date.id);
  if (cached && Date.now() - cached.at < REFRESH_MS) {
    return cached.promise;
  }
  const url = new URL("geisel", base);
  url.searchParams.set("date", date.toString());
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP ${response.status}`);
    }
    return parseAvailability((await response.json()) as GeiselDay);
  });
  cache.set(date.id, { at: Date.now(), promise });
  promise.catch(() => cache.delete(date.id));
  return promise;
}

export type AvailabilityState =
  | { type: "unconfigured" }
  | { type: "past" }
  | { type: "loading" }
  | { type: "ready"; data: DayAvailability }
  | { type: "error"; message: string };

/**
 * Live reservations for `date` (Pacific time), refreshed every minute while
 * `enabled`. Results for another date are never returned.
 */
export function useGeiselAvailability(date: Day, today: Day, enabled: boolean): AvailabilityState {
  const base = proxyBase();
  const baseHref = base?.href ?? null;
  const past = date.id < today.id;
  const [state, setState] = useState<{ date: number; state: AvailabilityState }>({
    date: date.id,
    state: { type: "loading" },
  });
  const dateId = date.id;
  useEffect(() => {
    if (!enabled || !baseHref || past) {
      return;
    }
    let current = true;
    const load = () =>
      fetchAvailability(new URL(baseHref), Day.fromId(dateId)).then(
        (data) => current && setState({ date: dateId, state: { type: "ready", data } }),
        (error: unknown) =>
          current &&
          // A failed refresh keeps the last data rather than blanking the map
          setState((previous) =>
            previous.date === dateId && previous.state.type === "ready"
              ? previous
              : {
                  date: dateId,
                  state: {
                    type: "error",
                    message: error instanceof Error ? error.message : String(error),
                  },
                }
          )
      );
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      current = false;
      clearInterval(interval);
    };
  }, [enabled, baseHref, past, dateId]);

  if (!baseHref) {
    return { type: "unconfigured" };
  }
  if (past) {
    return { type: "past" };
  }
  return state.date === date.id ? state.state : { type: "loading" };
}

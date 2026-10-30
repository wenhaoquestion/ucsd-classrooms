import { AvailabilityRange, isRangeFree } from "../availabilityRanges";
import { Day } from "../Day";
import {
  DayAvailability,
  GEISEL_SPACES,
  LibrarySpace,
  loadGeiselAvailability,
} from "./geisel";

export type WeekRangeResult = {
  range: AvailabilityRange;
  spaces: LibrarySpace[];
  state: "ready" | "error" | "window-end";
  fetchedAt?: Date;
  error?: string;
};

type DayResult = { data: DayAvailability } | { error: string };

/** Search each full interval; one failed day never hides another day's results. */
export async function findWeekAvailability(
  ranges: readonly AvailabilityRange[],
  fetchDay: (date: Day) => Promise<DayAvailability> = loadGeiselAvailability
): Promise<WeekRangeResult[]> {
  for (const { date, start, end } of ranges) {
    if (!date.valid || !Number.isInteger(date.id) ||
        !Number.isInteger(+start) || !Number.isInteger(+end) ||
        +start < 0 || +end > 24 * 60 || +start >= +end) {
      throw new RangeError("Choose a valid date and a time range that ends after it starts, within the same day.");
    }
  }

  const days = new Map<number, Promise<DayResult>>();
  for (const { date } of ranges) {
    if (days.has(date.id)) continue;
    // The promise boundary also captures a synchronous failure in a custom loader.
    days.set(date.id, Promise.resolve().then(() => fetchDay(date)).then((data): DayResult => {
      if (data.date.id !== date.id) {
        throw new Error("The library returned availability for a different date. Please try again.");
      }
      return { data };
    }).catch((error: unknown): DayResult => ({
      error: error instanceof Error ? error.message : "Could not load library availability. Please try again.",
    })));
  }

  return Promise.all(ranges.map(async (range): Promise<WeekRangeResult> => {
    const result = await days.get(range.date.id)!;
    if ("error" in result) {
      return { range, spaces: [], state: "error", error: result.error };
    }
    const { data } = result;
    if (data.windowEnd && [...data.spaces.values()].every((slots) => slots.length === 0)) {
      return { range, spaces: [], state: "window-end", fetchedAt: data.fetchedAt };
    }
    return {
      range,
      spaces: GEISEL_SPACES.filter((space) =>
        isRangeFree(data.spaces.get(space.eid), range.start, range.end)
      ),
      state: "ready",
      fetchedAt: data.fetchedAt,
    };
  }));
}

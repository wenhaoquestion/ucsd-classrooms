import type { Day } from "./Day";
import type { Time } from "./Time";
import type { Moment } from "./now";
import type { Slot } from "./library/geisel";

/** A same-day, half-open interval in UC San Diego's Pacific wall-clock time. */
export type AvailabilityRange = { date: Day; start: Time; end: Time };

function validTime(time: Time, allowMidnight: boolean): boolean {
  return (
    Number.isInteger(time.hour) &&
    Number.isInteger(time.minute) &&
    time.minute >= 0 &&
    time.minute < 60 &&
    time.hour >= 0 &&
    (time.hour < 24 || (allowMidnight && time.hour === 24 && time.minute === 0))
  );
}

/**
 * Validate a future interval in the Pacific week containing `now`. Pass the
 * result of now() rather than browser-local dates. Day arithmetic remains
 * correct across DST and year boundaries. An end of 24:00 means midnight at
 * the end of this date; a start of 24:00 and overnight intervals are invalid.
 */
export function validateWeekRange(range: AvailabilityRange, now: Moment): string | null {
  if (!range.date.valid || !Number.isInteger(range.date.id)) {
    return "Choose a valid date.";
  }
  if (!validTime(range.start, false) || !validTime(range.end, true)) {
    return "Choose valid start and end times.";
  }
  if (+range.end <= +range.start) {
    return "End time must be after start time on the same day.";
  }
  const monday = now.date.monday;
  if (range.date < monday || range.date > monday.add(6)) {
    return "Choose a day in the current week (Monday–Sunday).";
  }
  if (range.date < now.date || (+range.date === +now.date && range.start < now.time)) {
    return "Choose a start time that has not passed.";
  }
  return null;
}

/**
 * True only when free LibCal slots cover every minute of [start, end).
 * Missing data, gaps, closed/booked slots, and overlapping slots are not free.
 * Input order is irrelevant and inputs are never mutated. A slot may extend
 * beyond the requested range; touching endpoints do not overlap.
 */
export function isRangeFree(slots: Slot[] | undefined, start: Time, end: Time): boolean {
  if (!validTime(start, false) || !validTime(end, true) || +end <= +start || !slots?.length) {
    return false;
  }
  // Malformed upstream times must not turn an unverified interval into a match.
  if (slots.some((slot) =>
    !validTime(slot.start, false) || !validTime(slot.end, true) || +slot.end <= +slot.start
  )) {
    return false;
  }
  const relevant = slots
    .filter((slot) => slot.start < end && start < slot.end)
    .sort((a, b) => +a.start - +b.start || +a.end - +b.end);
  let coveredUntil = +start;
  let previousEnd: number | null = null;
  for (const slot of relevant) {
    if (
      slot.status !== "free" ||
      +slot.start > coveredUntil ||
      (previousEnd !== null && +slot.start < previousEnd)
    ) {
      return false;
    }
    coveredUntil = +slot.end;
    previousEnd = +slot.end;
  }
  return coveredUntil >= +end;
}

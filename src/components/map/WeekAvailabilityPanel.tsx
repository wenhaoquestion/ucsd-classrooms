import { useEffect, useRef, useState } from "react";
import { AvailabilityRange, validateWeekRange } from "../../lib/availabilityRanges";
import { buildings } from "../../lib/buildings";
import { CampusRangeAvailability, findCampusWeekAvailability } from "../../lib/campusWeekAvailability";
import { Day } from "../../lib/Day";
import { bookingUrl } from "../../lib/library/geisel";
import { findWeekAvailability, WeekRangeResult } from "../../lib/library/weekAvailability";
import { Moment, now } from "../../lib/now";
import { Time } from "../../lib/Time";
import { CloseIcon } from "../icons/CloseIcon";
import { Link } from "../Link";
import { WeekTimeCalendar } from "./WeekTimeCalendar";
import "./weekAvailability.css";

type Draft = { id: number; date: string; start: string; end: string };
type Results = { campus: CampusRangeAvailability[]; library: WeekRangeResult[]; checkedAt: Date };
const MAX_RANGES = 10;
const TIMES = Array.from({ length: 97 }, (_, i) => Time.from(i * 15));

function initialDraft(id: number, clock: Moment): Draft {
  let date = clock.date;
  let start = Math.ceil(+clock.time / 15) * 15;
  if (start > 23 * 60 && date.day !== 0) {
    date = date.add(1);
    start = 10 * 60;
  }
  start = Math.min(start, 23 * 60 + 45);
  return { id, date: date.toString(), start: Time.from(start).toString(true),
    end: Time.from(Math.min(start + 60, 1440)).toString(true) };
}

function parseDraft(draft: Draft): AvailabilityRange | null {
  const date = Day.parse(draft.date);
  const start = Time.parse24(draft.start);
  const end = draft.end === "24:00" ? Time.from(1440) : Time.parse24(draft.end);
  return date && date.toString() === draft.date && start && end ? { date, start, end } : null;
}

function rangeTitle(range: AvailabilityRange): string {
  const day = range.date.toString([], { weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${range.start}–${+range.end === 1440 ? "midnight" : range.end}`;
}

function RangeResults({ campus, library, expired }: {
  campus: CampusRangeAvailability;
  library: WeekRangeResult;
  expired: boolean;
}) {
  const [limit, setLimit] = useState(20);
  const range = campus.range;
  return (
    <section className="week-result" aria-label={rangeTitle(range)}>
      <h3>{rangeTitle(range)}</h3>
      {expired ? <p className="week-note">This time slot has started or passed. Choose a future slot to check again.</p> : <>
        <div className="week-result-counts">
          <span>{campus.state === "ready" ? `${campus.rooms.length} classrooms` : "Classrooms unavailable"}</span>
          <span>{library.state === "ready" ? `${library.spaces.length} Geisel rooms` : "Geisel unavailable"}</span>
        </div>
        <details className="week-source-results" open={library.state !== "ready" || library.spaces.length > 0}>
          <summary>Geisel · free for the whole slot</summary>
          {library.state === "error" ? <p className="week-note">{library.error}</p>
            : library.state === "window-end" ? <p className="week-note">Reservations have not opened for this date.</p>
            : library.spaces.length === 0 ? <p className="week-note">No room is bookable for this entire time slot.</p>
            : <ul className="week-room-list">{library.spaces.map((space) => (
              <li key={space.key}>
                <Link view={{ type: "building", building: "GEISEL", room: space.key }}
                  term={{ date: range.date, time: range.start }}>
                  <strong>{space.title}</strong><small>Floor {space.floor.slice(1)} · {space.capacity} seats</small>
                </Link>
                <a href={bookingUrl(space, range.date)} target="_blank" rel="noreferrer" className="week-book"
                  aria-label={`Book ${space.title} on ${rangeTitle(range)} in LibCal`}>Book ↗</a>
              </li>
            ))}</ul>}
        </details>
        <details className="week-source-results" open>
          <summary>Classrooms · no class scheduled during the slot</summary>
          {campus.state !== "ready" ? <p className="week-note">{campus.error ?? "Complete schedules are unavailable for this date."}</p>
            : campus.rooms.length === 0 ? <p className="week-note">No classroom has this entire time slot clear in the loaded schedules.</p>
            : <>
              <ul className="week-room-list">{campus.rooms.slice(0, limit).map(({ building, room }) => (
                <li key={`${building}/${room}`}>
                  <Link view={{ type: "building", building, room }} term={{ date: range.date, time: range.start }}>
                    <strong>{building} {room}</strong><small>{buildings[building]?.name}</small>
                  </Link>
                </li>
              ))}</ul>
              {limit < campus.rooms.length && <button type="button" className="week-secondary"
                onClick={() => setLimit((n) => n + 20)}>Show more ({campus.rooms.length - limit} remaining)</button>}
            </>}
        </details>
      </>}
    </section>
  );
}

export function WeekAvailabilityPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [clock, setClock] = useState(now);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const nextId = useRef(1);
  const requestVersion = useRef(0);
  const [submitted, setSubmitted] = useState<AvailabilityRange[] | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const week = clock.date.monday;
  const days = Array.from({ length: 7 }, (_, offset) => week.add(offset));
  const hasOldDates = drafts.some((draft) => !days.some((day) => day.toString() === draft.date));
  const activeDraft = drafts.find((draft) => draft.id === activeId);
  const calendarRanges = drafts.flatMap((draft, index) => {
    const range = parseDraft(draft);
    return range && range.start < range.end ? [{ id: draft.id, range, slot: index + 1 }] : [];
  });

  useEffect(() => {
    if (!open) return;
    setClock(now());
    const timer = setInterval(() => setClock(now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !submitted) {
      setLoading(false);
      return;
    }
    let current = true;
    let running = false;
    const search = async () => {
      if (running) return;
      // Once a requested slot passes, its old result must not remain a free-room claim.
      if (submitted.every((range) => validateWeekRange(range, now()) !== null)) {
        setLoading(false);
        return;
      }
      running = true;
      const version = requestVersion.current;
      setLoading(true);
      const [campus, library] = await Promise.all([
        findCampusWeekAvailability(submitted).catch((): CampusRangeAvailability[] =>
          submitted.map((range) => ({ range, rooms: [], state: "error", error: "Couldn't load classroom schedules. Try again." }))),
        findWeekAvailability(submitted).catch((): WeekRangeResult[] =>
          submitted.map((range) => ({ range, spaces: [], state: "error", error: "Couldn't load Geisel reservations. Try again." }))),
      ]);
      if (current && version === requestVersion.current) {
        setResults({ campus, library, checkedAt: new Date() });
        setLoading(false);
      }
      running = false;
    };
    void search();
    const timer = setInterval(() => void search(), 60_000);
    return () => { current = false; clearInterval(timer); };
  }, [open, submitted]);

  const invalidate = () => {
    // Cancel synchronously in input events, before React commits effect cleanup.
    requestVersion.current++;
    setSubmitted(null);
    setResults(null);
    setLoading(false);
    setError(null);
  };
  const edit = (id: number, patch: Partial<Draft>) => {
    invalidate();
    setDrafts((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  };
  const reset = () => {
    setClock(now());
    setDrafts([]);
    setActiveId(null);
    setCalendarVersion((version) => version + 1);
    invalidate();
  };
  const addRange = (range: AvailabilityRange) => {
    const issue = validateWeekRange(range, now());
    if (issue) { setError(issue); return; }
    const duplicate = drafts.find((draft) => draft.date === range.date.toString() &&
      draft.start === range.start.toString(true) && draft.end === range.end.toString(true));
    if (duplicate) { setActiveId(duplicate.id); return; }
    if (drafts.length >= MAX_RANGES) { setError("You can select up to 10 time slots. Remove a slot to add another."); return; }
    const id = nextId.current++;
    invalidate();
    setDrafts((rows) => [...rows, { id, date: range.date.toString(), start: range.start.toString(true), end: range.end.toString(true) }]);
    setActiveId(id);
  };
  const remove = (id: number) => {
    invalidate();
    setDrafts((rows) => rows.filter((row) => row.id !== id));
    if (activeId === id) setActiveId(drafts.find((row) => row.id !== id)?.id ?? null);
  };

  return (
    <aside id="week-availability-panel" className={`week-planner ${open ? "" : "week-planner-hidden"}`} aria-label="This week's free spaces"
      aria-hidden={!open} inert={!open}>
      <header className="free-rooms-header">
        <div><h2 className="free-rooms-title">Plan this week</h2>
          <p className="free-rooms-subtitle">{week.toString([], { month: "short", day: "numeric" })}–{week.add(6).toString([], { month: "short", day: "numeric" })} · San Diego time</p>
        </div>
        <button className="icon-btn free-rooms-close" onClick={() => { requestVersion.current++; onClose(); }} aria-label="Close weekly planner"><CloseIcon /></button>
      </header>
      <div className="week-scroll">
        <p className="week-intro">Pick your time on the calendar. Find classrooms and Geisel rooms free for each entire slot.</p>
        {hasOldDates && <p className="week-error" role="status">A new week has started. Clear all or choose dates in this week.</p>}
        <WeekTimeCalendar key={`${week.id}/${calendarVersion}`} days={days} clock={clock} ranges={calendarRanges} activeId={activeId}
          onSelect={addRange} onActivate={setActiveId} disabled={drafts.length >= MAX_RANGES} open={open} />
        <form className="week-form" onSubmit={(event) => {
          event.preventDefault();
          if (!drafts.length) { setError("Select a time slot on the calendar first."); return; }
          const current = now();
          const ranges: AvailabilityRange[] = [];
          for (const [i, draft] of drafts.entries()) {
            const range = parseDraft(draft);
            const issue = range ? validateWeekRange(range, current) : "Choose a valid date, start and end time.";
            if (issue) { setError(`Slot ${i + 1}: ${issue}`); return; }
            ranges.push(range!);
          }
          requestVersion.current++;
          setError(null); setResults(null); setSubmitted(ranges);
        }}>
          <div className="week-selection-heading">
            <h3>Selected times <span>{drafts.length}/{MAX_RANGES}</span></h3>
            {drafts.length > 0 && <button type="button" className="week-secondary" onClick={reset}>Clear all</button>}
          </div>
          {drafts.length === 0 ? <p className="week-empty">No times selected yet. Select a block on the calendar to get started.</p> :
            <ul className="week-selected-slots">{drafts.map((draft, i) => {
              const range = parseDraft(draft);
              return <li key={draft.id} data-color={i % 4} className={draft.id === activeId ? "week-selected-active" : ""}>
                <button type="button" className="week-selected-pick" onClick={() => setActiveId(draft.id)} aria-pressed={draft.id === activeId}>
                  <span className="week-slot-number">{i + 1}</span>
                  <span>{range ? rangeTitle(range) : `${draft.date} · ${draft.start}–${draft.end}`}</span>
                </button>
                <button type="button" className="week-selected-remove" aria-label={`Remove slot ${i + 1}`} onClick={() => remove(draft.id)}><CloseIcon /></button>
              </li>;
            })}</ul>}
          {activeDraft && <fieldset className="week-slot" key={activeDraft.id}>
            <legend>Adjust slot {drafts.indexOf(activeDraft) + 1}</legend>
            <div className="week-slot-date">
              <label><span>Day</span><select aria-label="Selected slot day" value={activeDraft.date}
                onChange={(event) => edit(activeDraft.id, { date: event.target.value })}>
                {!days.some((day) => day.toString() === activeDraft.date) && <option value={activeDraft.date} disabled>{activeDraft.date} · outside this week</option>}
                {days.map((day) => (
                  <option key={day.id} value={day.toString()} disabled={day < clock.date}>
                    {day.toString([], { weekday: "short", month: "short", day: "numeric" })}
                  </option>
                ))}
              </select></label>
            </div>
            <div className="week-times">{(["start", "end"] as const).map((field) => (
              <label key={field}><span>{field === "start" ? "Start" : "End"}</span>
                <select aria-label={`Selected slot ${field}`} value={activeDraft[field]}
                  onChange={(event) => edit(activeDraft.id, { [field]: event.target.value })}>
                  {(field === "start" ? TIMES.slice(0, -1) : TIMES.slice(1)).map((time) => <option key={+time} value={time.toString(true)}>
                    {+time === 1440 ? "Midnight (end of day)" : time.toString()}
                  </option>)}
                </select>
              </label>
            ))}</div>
          </fieldset>}
          <div className="week-edit-actions">
            <button type="button" className="week-secondary" disabled={drafts.length >= MAX_RANGES}
              onClick={() => {
                const draft = initialDraft(nextId.current++, now());
                invalidate(); setDrafts((rows) => [...rows, draft]); setActiveId(draft.id);
              }}>Enter a time manually</button>
            <span className="week-selection-note">15-minute steps · up to 10 slots</span>
          </div>
          {error && <p className="week-error" role="alert">{error}</p>}
          <button className="week-submit" type="submit" disabled={drafts.length === 0}>{results ? "Refresh availability" : `Find free spaces${drafts.length ? ` for ${drafts.length} slot${drafts.length === 1 ? "" : "s"}` : ""}`}</button>
        </form>
        <div className="week-progress" role="status" aria-live="polite">
          {loading ? "Checking classroom schedules and Geisel reservations…" : results ?
            `${results.campus.length} time slot${results.campus.length === 1 ? "" : "s"} checked at ${results.checkedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })} PT · refreshes every minute` : ""}
        </div>
        {results && <div className="week-results">{results.campus.map((campus, i) => (
          <RangeResults key={`${submitted?.map((r) => `${r.date}/${+r.start}/${+r.end}`).join(",")}:${i}`}
            campus={campus} library={results.library[i]} expired={validateWeekRange(campus.range, clock) !== null} />
        ))}</div>}
        <p className="week-note week-disclaimer">Classrooms: no scheduled classes; access and other events are not tracked.
          Geisel: live reservation availability. Choose the same time slot in LibCal to book; booking rules still apply.</p>
      </div>
    </aside>
  );
}

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { AvailabilityRange } from "../../lib/availabilityRanges";
import { Day } from "../../lib/Day";
import { Moment } from "../../lib/now";
import { Time } from "../../lib/Time";
import "./weekTimeCalendar.css";

export type CalendarRange = { id: number; range: AvailabilityRange; slot?: number };
type Cell = { day: number; minute: number };
/** A range being drawn or adjusted; `id` is set when it's an existing slot. */
type Preview = { id?: number; day: number; start: number; end: number };
type Gesture = {
  kind: "create" | "resize-start" | "resize-end" | "move";
  pointer: number;
  id?: number;
  day: number;
  /** Minute under the pointer when the gesture started. */
  anchor: number;
  start: number;
  end: number;
  x: number;
  y: number;
  moved: boolean;
};
type Props = {
  days: Day[];
  clock: Moment;
  ranges: CalendarRange[];
  activeId: number | null;
  onSelect: (range: AvailabilityRange) => void;
  onChange: (id: number, range: AvailabilityRange) => void;
  onRemove: (id: number) => void;
  onActivate: (id: number) => void;
  disabled: boolean;
  open: boolean;
};

const STEP = 15;
const DAY_END = 1440;
const DEFAULT_LENGTH = 60;
const MINUTES = Array.from({ length: DAY_END / STEP }, (_, index) => index * STEP);
const HOURS = Array.from({ length: 25 }, (_, index) => index * 60);
/** Pixels from the scroll area's edge where dragging scrolls it. */
const EDGE = 36;
const timeLabel = (minute: number) => minute === DAY_END ? "midnight" : Time.from(minute).toString();
/** "9 am" or "9:15 am", for labels inside narrow slots. */
const shortTime = (minute: number) => minute === DAY_END ? "12 am" : Time.from(minute).toString().replace(":00", "");
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** Give overlapping selections separate lanes so every block stays clickable. */
function rangeLanes(ranges: CalendarRange[]) {
  const sorted = [...ranges].sort((a, b) => +a.range.start - +b.range.start);
  const layout = new Map<number, { lane: number; total: number }>();
  let group: CalendarRange[] = [];
  let groupEnd = -1;
  const finish = () => {
    const ends: number[] = [];
    for (const item of group) {
      let lane = ends.findIndex((end) => end <= +item.range.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = +item.range.end;
      layout.set(item.id, { lane, total: 0 });
    }
    for (const item of group) layout.get(item.id)!.total = ends.length;
    group = [];
  };
  for (const item of sorted) {
    if (+item.range.start >= groupEnd) finish();
    group.push(item);
    groupEnd = Math.max(groupEnd, +item.range.end);
  }
  finish();
  return layout;
}

export function WeekTimeCalendar({ days, clock, ranges, activeId, onSelect, onChange, onRemove, onActivate, disabled, open }: Props) {
  const helpId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef("");
  const gesture = useRef<Gesture | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const swipe = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const ignoreClick = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mobileDay, setMobileDay] = useState(clock.date.id);
  const slide = useRef<1 | -1>(1);
  const [focus, setFocus] = useState<Cell>({ day: clock.date.id, minute: Math.min(1425, Math.ceil(+clock.time / STEP) * STEP) });
  const weekId = days[0]?.id;
  const active = ranges.find((item) => item.id === activeId);
  const activeDay = active?.range.date.id;
  const activeStart = active ? +active.range.start : undefined;
  const visibleDay = days.find((day) => day.id === mobileDay) ?? days.find((day) => day.id === clock.date.id) ?? days[0];
  const visibleDayId = visibleDay?.id;
  const clockDay = clock.date.id;
  const clockMinute = +clock.time;
  /** The earliest selectable start on a day, or null if the whole day has passed. */
  const firstMinute = (day: number) => day < clockDay ? null : day === clockDay ? Math.ceil(clockMinute / STEP) * STEP : 0;
  const isPast = (day: number, minute: number) => day < clockDay || (day === clockDay && minute < clockMinute);
  const fallbackFocus = { day: visibleDay?.id ?? clockDay,
    minute: visibleDay?.id === clockDay ? Math.min(1425, Math.ceil(clockMinute / STEP) * STEP) : 8 * 60 };
  const focused = days.some((day) => day.id === focus.day) && !isPast(focus.day, focus.minute) ? focus : fallbackFocus;

  const stopGesture = () => {
    gesture.current = null;
    setPreview(null);
  };

  useEffect(() => {
    if (!open) stopGesture();
  }, [open, weekId]);

  useEffect(() => {
    if (activeDay !== undefined) {
      setMobileDay(activeDay);
      setFocus({ day: activeDay, minute: activeStart ?? 8 * 60 });
    }
  }, [activeDay, activeStart]);

  useEffect(() => {
    if (!open) { scrollPosition.current = ""; return; }
    const key = `${weekId}/${visibleDayId}/${activeDay}/${activeStart}`;
    // Clock updates and drags must not snap a calendar the user has scrolled
    if (!scrollRef.current || scrollPosition.current === key || gesture.current) return;
    const selected = activeDay === visibleDayId ? activeStart : undefined;
    const minute = selected === undefined
      ? visibleDayId === clockDay ? Math.min(1425, Math.max(8 * 60, Math.ceil(clockMinute / STEP) * STEP)) : 8 * 60
      : Math.max(0, selected - 60);
    const body = scrollRef.current.querySelector<HTMLElement>(".week-calendar-body");
    if (body) {
      const top = minute / DAY_END * body.offsetHeight;
      // Only animate when switching to a slot; opening the panel jumps straight there
      if (scrollPosition.current) scrollRef.current.scrollTo({ top, behavior: "smooth" });
      else scrollRef.current.scrollTop = top;
      scrollPosition.current = key;
    }
  }, [open, weekId, visibleDayId, activeDay, activeStart, clockDay, clockMinute]);

  // On phones, slide the newly shown day in from the side it came from
  const shownDay = useRef(visibleDayId);
  useEffect(() => {
    if (shownDay.current === visibleDayId) return;
    shownDay.current = visibleDayId;
    const column = scrollRef.current?.querySelector<HTMLElement>(`[data-day-id="${visibleDayId}"]`);
    if (!column || !window.matchMedia("(max-width: 690px)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    column.animate([
      { transform: `translateX(${slide.current * 28}px)`, opacity: 0.2 },
      { transform: "none", opacity: 1 },
    ], { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [visibleDayId]);

  /** The day column and minute under a point, if any. */
  const hit = (x: number, y: number, lockDay?: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return null;
    let column: HTMLElement | null = null;
    if (lockDay !== undefined) {
      column = scroller.querySelector<HTMLElement>(`[data-day-id="${lockDay}"]`);
    } else {
      for (const element of scroller.querySelectorAll<HTMLElement>(".week-calendar-day")) {
        const bounds = element.getBoundingClientRect();
        if (bounds.width > 0 && x >= bounds.left && x < bounds.right) column = element;
      }
    }
    if (!column) return null;
    const bounds = column.getBoundingClientRect();
    const minute = clamp(Math.floor((y - bounds.top) / bounds.height * MINUTES.length) * STEP, 0, DAY_END - STEP);
    return { day: Number(column.dataset.dayId), minute };
  };

  /** Where the current gesture would put the range for a pointer position. */
  const gestureRange = (current: Gesture, x: number, y: number): Preview | null => {
    const point = hit(x, y, current.kind === "move" ? undefined : current.day);
    if (!point) return null;
    const first = firstMinute(point.day);
    if (first === null || first >= DAY_END) return null;
    const { minute } = point;
    switch (current.kind) {
      case "create": {
        const anchor = Math.max(current.anchor, first);
        const start = Math.max(first, Math.min(anchor, minute));
        return { day: current.day, start, end: Math.max(anchor, minute) + STEP };
      }
      case "resize-start":
        return { id: current.id, day: current.day, start: clamp(minute, first, current.end - STEP), end: current.end };
      case "resize-end":
        return { id: current.id, day: current.day, start: current.start, end: clamp(minute + STEP, current.start + STEP, DAY_END) };
      case "move": {
        const length = current.end - current.start;
        const start = clamp(current.start + minute - current.anchor, first, DAY_END - length);
        return start < first ? null : { id: current.id, day: point.day, start, end: start + length };
      }
    }
  };

  const updateGesture = (x: number, y: number) => {
    const current = gesture.current;
    if (!current) return;
    lastPointer.current = { x, y };
    if (!current.moved) {
      if (Math.hypot(x - current.x, y - current.y) < 4) return;
      current.moved = true;
    }
    const next = gestureRange(current, x, y);
    if (next) {
      setPreview((previous) => previous && previous.id === next.id && previous.day === next.day &&
        previous.start === next.start && previous.end === next.end ? previous : next);
    }
  };

  const finishGesture = () => {
    const current = gesture.current;
    if (!current) return;
    const result = current.moved ? gestureRange(current, lastPointer.current.x, lastPointer.current.y) : null;
    stopGesture();
    if (!current.moved) return;
    ignoreClick.current = true;
    if (!result) return;
    const date = days.find((day) => day.id === result.day);
    if (!date) return;
    const range = { date, start: Time.from(result.start), end: Time.from(result.end) };
    if (current.id === undefined) {
      if (!disabled) onSelect(range);
    } else if (result.day !== current.day || result.start !== current.start || result.end !== current.end) {
      onChange(current.id, range);
    }
  };

  // Follow the pointer anywhere on the page once a drag starts, and scroll
  // the calendar when it nears the top or bottom edge.
  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const scroller = scrollRef.current;
      if (scroller && gesture.current?.moved) {
        const bounds = scroller.getBoundingClientRect();
        const { x, y } = lastPointer.current;
        const speed = y < bounds.top + EDGE ? -(bounds.top + EDGE - y) : y > bounds.bottom - EDGE ? y - (bounds.bottom - EDGE) : 0;
        if (speed !== 0) {
          scroller.scrollTop += clamp(speed, -EDGE, EDGE) / 2.5;
          updateGesture(x, y);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointer !== event.pointerId) return;
      event.preventDefault();
      updateGesture(event.clientX, event.clientY);
    };
    const up = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointer !== event.pointerId) return;
      updateGesture(event.clientX, event.clientY);
      finishGesture();
    };
    const cancel = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointer === event.pointerId) stopGesture();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  });

  const begin = (event: PointerEvent, next: Omit<Gesture, "pointer" | "x" | "y" | "moved">) => {
    gesture.current = { ...next, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    lastPointer.current = { x: event.clientX, y: event.clientY };
  };

  const cellPointerDown = (event: PointerEvent<HTMLButtonElement>, day: Day, minute: number) => {
    ignoreClick.current = false;
    // Touch keeps native scrolling; a tap adds a slot and its handles adjust it
    if (event.pointerType !== "mouse" || event.button !== 0 || disabled || isPast(day.id, minute)) return;
    begin(event, { kind: "create", day: day.id, anchor: minute, start: minute, end: minute + STEP });
  };

  const eventPointerDown = (event: PointerEvent, item: CalendarRange, kind: Gesture["kind"]) => {
    ignoreClick.current = false;
    if (event.button !== 0) return;
    // Moving a whole block by touch would fight with scrolling; handles work
    if (kind === "move" && event.pointerType !== "mouse") return;
    event.stopPropagation();
    if (kind !== "move") event.preventDefault();
    const point = hit(event.clientX, event.clientY, item.range.date.id);
    begin(event, { kind, id: item.id, day: item.range.date.id, anchor: point?.minute ?? +item.range.start,
      start: +item.range.start, end: +item.range.end });
    if (kind !== "move") {
      // Show the handles' effect immediately, even before the pointer moves
      gesture.current!.moved = true;
      onActivate(item.id);
      setPreview({ id: item.id, day: item.range.date.id, start: +item.range.start, end: +item.range.end });
    }
  };

  const clickCell = (event: MouseEvent, day: Day, minute: number) => {
    if (ignoreClick.current) { ignoreClick.current = false; return; }
    if (isPast(day.id, minute)) return;
    setFocus({ day: day.id, minute });
    // Shift-click stretches the selected slot to this time
    if (event.shiftKey && active && active.range.date.id === day.id) {
      const start = Math.min(+active.range.start, minute);
      const end = Math.max(+active.range.end, minute + STEP);
      onChange(active.id, { date: day, start: Time.from(start), end: Time.from(end) });
      return;
    }
    if (disabled) return;
    onSelect({ date: day, start: Time.from(minute), end: Time.from(Math.min(DAY_END, minute + DEFAULT_LENGTH)) });
  };

  const keyCell = (event: KeyboardEvent<HTMLButtonElement>, day: Day, minute: number) => {
    ignoreClick.current = false;
    const dayIndex = days.findIndex((item) => item.id === day.id);
    const targetDay = event.key === "ArrowLeft" ? days[dayIndex - 1] : event.key === "ArrowRight" ? days[dayIndex + 1] : day;
    let targetMinute = minute;
    if (event.key === "ArrowUp") targetMinute -= STEP;
    else if (event.key === "ArrowDown") targetMinute += STEP;
    else if (event.key === "PageUp") targetMinute -= 60;
    else if (event.key === "PageDown") targetMinute += 60;
    else if (event.key === "Home") targetMinute = firstMinute(day.id) ?? 0;
    else if (event.key === "End") targetMinute = DAY_END - STEP;
    else if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    targetMinute = clamp(targetMinute, 0, DAY_END - STEP);
    if (!targetDay || isPast(targetDay.id, targetMinute)) return;
    showDay(targetDay);
    setFocus({ day: targetDay.id, minute: targetMinute });
    // A day can be hidden on mobile until the state update reaches the DOM.
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-day-id="${targetDay.id}"] [data-minute="${targetMinute}"]`
    )?.focus());
  };

  const keyEvent = (event: KeyboardEvent<HTMLButtonElement>, item: CalendarRange) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(item.id);
      return;
    }
    const step = event.key === "ArrowUp" ? -STEP : event.key === "ArrowDown" ? STEP : 0;
    if (step === 0) return;
    event.preventDefault();
    // Arrows move the slot; Shift+arrows change its end
    const start = +item.range.start;
    const end = +item.range.end;
    const first = firstMinute(item.range.date.id) ?? DAY_END;
    let nextStart = start;
    let nextEnd = end;
    if (event.shiftKey) {
      nextEnd = clamp(end + step, start + STEP, DAY_END);
    } else {
      nextStart = clamp(start + step, first, DAY_END - (end - start));
      nextEnd = nextStart + (end - start);
    }
    if (nextStart < first || (nextStart === start && nextEnd === end)) return;
    onChange(item.id, { date: item.range.date, start: Time.from(nextStart), end: Time.from(nextEnd) });
  };

  const showDay = (day: Day) => {
    if (day.id === visibleDay?.id) return;
    slide.current = visibleDay && day.id < visibleDay.id ? -1 : 1;
    setMobileDay(day.id);
  };
  const chooseDay = (day: Day) => {
    stopGesture();
    showDay(day);
    setFocus({ day: day.id, minute: day.id === clockDay ? Math.min(1425, Math.max(8 * 60, Math.ceil(clockMinute / STEP) * STEP)) : 8 * 60 });
  };

  // Phones show one day; swiping sideways changes it
  const bodyPointerDown = (event: PointerEvent) => {
    swipe.current = event.pointerType === "mouse" ? null : { pointer: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const bodyPointerUp = (event: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.pointer !== event.pointerId || gesture.current) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    ignoreClick.current = true;
    const index = days.findIndex((day) => day.id === visibleDay?.id);
    const target = days[index + (dx < 0 ? 1 : -1)];
    if (target && firstMinute(target.id) !== null) chooseDay(target);
  };

  const shown = ranges.map((item) => preview?.id === item.id
    ? { ...item, range: { date: Day.fromId(preview.day), start: Time.from(preview.start), end: Time.from(preview.end) } }
    : item);
  const newPreview = preview && preview.id === undefined ? preview : null;
  const adjusting = preview?.id !== undefined ? preview : null;
  const activeShown = shown.find((item) => item.id === activeId);

  return (
    <section className={`week-calendar ${dragging ? "week-calendar-dragging" : ""}`} aria-label="Select time slots on this week's calendar" aria-describedby={helpId}
      onKeyDown={(event) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); ignoreClick.current = true; stopGesture(); } }}>
      <div className="week-calendar-help" id={helpId}>
        <span className="week-calendar-desktop-help">Click to add an hour, or drag to choose a range. Drag a slot or its edges to adjust.</span>
        <span className="week-calendar-mobile-help">Tap a time to add an hour, then drag its edges to adjust. Swipe to change days.</span>
        <span className="week-calendar-zone">San Diego time</span>
      </div>
      <div className="week-calendar-mobile-days" aria-label="Choose calendar day">
        {days.map((day) => {
          const count = ranges.filter((item) => item.range.date.id === day.id).length;
          return <button type="button" key={day.id} aria-pressed={day.id === visibleDay?.id}
            disabled={day < clock.date} className={day.id === clockDay ? "calendar-today" : ""}
            onClick={() => chooseDay(day)} aria-label={`${day.toString([], { weekday: "long", month: "long", day: "numeric" })}${count ? `, ${count} slot${count === 1 ? "" : "s"}` : ""}`}>
            <span>{day.dayName("short")}</span><strong>{day.date}</strong>
            <i className="calendar-day-dots" aria-hidden="true">{Array.from({ length: Math.min(count, 3) }, (_, i) => <b key={i} />)}</i>
          </button>;
        })}
      </div>
      <div className="week-calendar-scroll" ref={scrollRef}>
        <div className="week-calendar-head" aria-hidden="true">
          <span className="week-calendar-zone">PT</span>
          {days.map((day) => <div key={day.id} className={`${day.id === clockDay ? "calendar-today" : ""} ${day < clock.date ? "calendar-past-day" : ""}`}>
            <span>{day.dayName("short")}</span><strong>{day.date}</strong>
          </div>)}
        </div>
        <div className="week-calendar-body" onPointerDown={bodyPointerDown} onPointerUp={bodyPointerUp}
          onPointerCancel={() => { swipe.current = null; }}>
          <div className="week-calendar-hours" aria-hidden="true">{HOURS.map((minute) => (
            <span key={minute} style={{ top: `${minute / DAY_END * 100}%` }}>{minute === DAY_END ? "12 am" : Time.from(minute).toString().replace(":00", "")}</span>
          ))}</div>
          {days.map((day) => {
            const dayRanges = shown.filter((item) => item.range.date.id === day.id);
            const lanes = rangeLanes(dayRanges);
            const draw = newPreview?.day === day.id ? newPreview : null;
            const visible = day.id === visibleDay?.id;
            return <div className={`week-calendar-day ${visible ? "calendar-day-visible" : ""}`}
              key={day.id}
              data-date={day.toString()} data-day-id={day.id} role="group" aria-label={day.toString([], { weekday: "long", month: "long", day: "numeric" })}>
              {MINUTES.map((minute) => <button type="button" key={minute} data-minute={minute}
                className={`week-calendar-cell ${minute % 60 === 0 ? "calendar-hour" : ""} ${isPast(day.id, minute) ? "calendar-past" : ""}`}
                disabled={isPast(day.id, minute)}
                tabIndex={focused.day === day.id && focused.minute === minute ? 0 : -1}
                aria-label={`${day.toString([], { weekday: "long", month: "short", day: "numeric" })}, ${timeLabel(minute)}. Add a 1-hour slot`}
                onFocus={() => setFocus({ day: day.id, minute })}
                onPointerDown={(event) => cellPointerDown(event, day, minute)}
                onKeyDown={(event) => keyCell(event, day, minute)}
                onClick={(event) => clickCell(event, day, minute)}>
                <span>{Time.from(minute).toString()}</span>
              </button>)}
              {dayRanges.map((item) => {
                const { lane, total } = lanes.get(item.id)!;
                const slot = item.slot ?? ranges.findIndex((candidate) => candidate.id === item.id) + 1;
                const start = +item.range.start;
                const end = +item.range.end;
                const label = `Slot ${slot}: ${timeLabel(start)}–${timeLabel(end)}`;
                const isActive = item.id === activeId;
                const compact = end - start <= 30;
                return <div key={item.id} data-color={(slot - 1) % 4}
                  className={`week-calendar-event ${isActive ? "calendar-event-active" : ""} ${adjusting?.id === item.id ? "calendar-event-adjusting" : ""} ${compact ? "calendar-event-compact" : ""}`}
                  style={{ top: `${start / DAY_END * 100}%`, height: `${(end - start) / DAY_END * 100}%`,
                    left: `calc(${lane / total * 100}% + 2px)`, width: `calc(${100 / total}% - 4px)` }}>
                  <button type="button" className="calendar-event-body" aria-label={`${label}, ${item.range.date.dayName()}. Arrow keys move it, Shift+arrows change its end, Delete removes it`}
                    title={label} aria-pressed={isActive}
                    onPointerDown={(event) => eventPointerDown(event, item, "move")}
                    onKeyDown={(event) => keyEvent(event, item)}
                    onClick={() => {
                      if (ignoreClick.current) { ignoreClick.current = false; return; }
                      stopGesture(); showDay(day); onActivate(item.id);
                    }}>
                    <strong>#{slot}</strong><span>{shortTime(start)}–{shortTime(end)}</span>
                  </button>
                  <span className="calendar-event-handle calendar-event-handle-start" aria-hidden="true"
                    onPointerDown={(event) => eventPointerDown(event, item, "resize-start")} />
                  <span className="calendar-event-handle calendar-event-handle-end" aria-hidden="true"
                    onPointerDown={(event) => eventPointerDown(event, item, "resize-end")} />
                </div>;
              })}
              {draw && <div className="week-calendar-preview" aria-hidden="true"
                style={{ top: `${draw.start / DAY_END * 100}%`, height: `${(draw.end - draw.start) / DAY_END * 100}%` }}>
                <span>{timeLabel(draw.start)}–{timeLabel(draw.end)}</span>
              </div>}
              {day.id === clockDay && <div className="week-calendar-now" aria-hidden="true" style={{ top: `${clockMinute / DAY_END * 100}%` }} />}
            </div>;
          })}
        </div>
      </div>
      <div className="week-calendar-status" role="status" aria-live="polite">
        {preview ? <span className="week-calendar-status-live">
          {Day.fromId(preview.day).dayName("short")} · {timeLabel(preview.start)}–{timeLabel(preview.end)} · <strong>{duration(preview.end - preview.start)}</strong>
        </span>
          : activeShown ? <>
            <span>Slot {activeShown.slot ?? ranges.indexOf(activeShown) + 1} · {activeShown.range.date.dayName("short")} {timeLabel(+activeShown.range.start)}–{timeLabel(+activeShown.range.end)} · {duration(+activeShown.range.end - +activeShown.range.start)}</span>
            <button type="button" onClick={() => onRemove(activeShown.id)}>Remove</button>
          </>
          : <span>{disabled ? "10 time slots selected. Remove one to add another." : "Add as many as 10 slots across the week."}</span>}
      </div>
    </section>
  );
}

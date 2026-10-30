import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AvailabilityRange } from "../../lib/availabilityRanges";
import { Day } from "../../lib/Day";
import { Moment } from "../../lib/now";
import { Time } from "../../lib/Time";
import "./weekTimeCalendar.css";

export type CalendarRange = { id: number; range: AvailabilityRange; slot?: number };
type Cell = { day: number; minute: number };
type Selection = { day: number; first: number; last: number };
type Drag = { day: number; first: number; last: number; y: number; pointer: number; moved: boolean };
type Props = {
  days: Day[];
  clock: Moment;
  ranges: CalendarRange[];
  activeId: number | null;
  onSelect: (range: AvailabilityRange) => void;
  onActivate: (id: number) => void;
  disabled: boolean;
  open: boolean;
};

const MINUTES = Array.from({ length: 96 }, (_, index) => index * 15);
const HOURS = Array.from({ length: 25 }, (_, index) => index * 60);
const timeLabel = (minute: number) => minute === 1440 ? "midnight" : Time.from(minute).toString();
const selectionBounds = ({ first, last }: Selection) => ({ start: Math.min(first, last), end: Math.max(first, last) + 15 });

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

export function WeekTimeCalendar({ days, clock, ranges, activeId, onSelect, onActivate, disabled, open }: Props) {
  const helpId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef("");
  const drag = useRef<Drag | null>(null);
  const ignoreClick = useRef(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mobileDay, setMobileDay] = useState(clock.date.id);
  const [focus, setFocus] = useState<Cell>({ day: clock.date.id, minute: Math.min(1425, Math.ceil(+clock.time / 15) * 15) });
  const weekId = days[0]?.id;
  const active = ranges.find((item) => item.id === activeId)?.range;
  const activeDay = active?.date.id;
  const activeStart = active ? +active.start : undefined;
  const visibleDay = days.find((day) => day.id === mobileDay) ?? days.find((day) => day.id === clock.date.id) ?? days[0];
  const visibleDayId = visibleDay?.id;
  const clockDay = clock.date.id;
  const clockMinute = +clock.time;
  const isPast = (day: number, minute: number) => day < clock.date.id || (day === clock.date.id && minute < +clock.time);
  const pending = open && !disabled && selection && days.some((day) => day.id === selection.day) &&
    !isPast(selection.day, Math.min(selection.first, selection.last)) ? selection : null;
  const fallbackFocus = { day: visibleDay?.id ?? clock.date.id,
    minute: visibleDay?.id === clock.date.id ? Math.min(1425, Math.ceil(+clock.time / 15) * 15) : 8 * 60 };
  const focused = days.some((day) => day.id === focus.day) && !isPast(focus.day, focus.minute) ? focus : fallbackFocus;

  useEffect(() => {
    if (!open || disabled) {
      drag.current = null;
      setSelection(null);
    }
  }, [open, disabled, weekId]);

  useEffect(() => {
    if (activeDay !== undefined) {
      setMobileDay(activeDay);
      setFocus({ day: activeDay, minute: activeStart ?? 8 * 60 });
    }
  }, [activeDay, activeStart]);

  useEffect(() => {
    if (!open) { scrollPosition.current = ""; return; }
    const key = `${weekId}/${visibleDayId}/${activeDay}/${activeStart}`;
    // Clock updates must not snap a calendar the user has already scrolled.
    if (!scrollRef.current || scrollPosition.current === key) return;
    const selected = activeDay === visibleDayId ? activeStart : undefined;
    const minute = selected === undefined
      ? visibleDayId === clockDay ? Math.min(1425, Math.max(8 * 60, Math.ceil(clockMinute / 15) * 15)) : 8 * 60
      : Math.max(0, selected - 30);
    const body = scrollRef.current.querySelector<HTMLElement>(".week-calendar-body");
    if (body) { scrollRef.current.scrollTop = minute / 1440 * body.offsetHeight; scrollPosition.current = key; }
  }, [open, weekId, visibleDayId, activeDay, activeStart, clockDay, clockMinute]);

  const clearSelection = () => { drag.current = null; setSelection(null); };
  const finishSelection = (next: Selection) => {
    const date = days.find((day) => day.id === next.day);
    const { start, end } = selectionBounds(next);
    clearSelection();
    if (!disabled && date && !isPast(date.id, start)) onSelect({ date, start: Time.from(start), end: Time.from(end) });
  };
  const clickCell = (day: Day, minute: number) => {
    if (ignoreClick.current) { ignoreClick.current = false; return; }
    if (disabled || isPast(day.id, minute)) return;
    setFocus({ day: day.id, minute });
    if (pending?.day === day.id) finishSelection({ ...pending, last: minute });
    else setSelection({ day: day.id, first: minute, last: minute });
  };
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, day: Day, minute: number) => {
    ignoreClick.current = false;
    // Native touch scrolling remains available; touch selects with two taps.
    if (event.pointerType !== "mouse" || event.button !== 0 || disabled || isPast(day.id, minute)) return;
    drag.current = { day: day.id, first: minute, last: minute, y: event.clientY, pointer: event.pointerId, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>, day: Day) => {
    const current = drag.current;
    const bounds = event.currentTarget.getBoundingClientRect();
    const minute = Math.max(0, Math.min(1425, Math.floor((event.clientY - bounds.top) / bounds.height * 96) * 15));
    if (isPast(day.id, minute)) return;
    if (!current) {
      if (event.pointerType === "mouse" && event.buttons === 0 && pending?.day === day.id && pending.last !== minute) {
        setSelection({ ...pending, last: minute });
      }
      return;
    }
    if (current.day !== day.id || current.pointer !== event.pointerId) return;
    if (Math.abs(event.clientY - current.y) >= 4 && minute !== current.first) current.moved = true;
    if (current.moved) {
      current.last = minute;
      setSelection({ day: current.day, first: current.first, last: minute });
    }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    if (current.moved) {
      ignoreClick.current = true;
      finishSelection({ day: current.day, first: current.first, last: current.last });
    }
  };
  const keyCell = (event: KeyboardEvent<HTMLButtonElement>, day: Day, minute: number) => {
    ignoreClick.current = false;
    const dayIndex = days.findIndex((item) => item.id === day.id);
    const targetDay = event.key === "ArrowLeft" ? days[dayIndex - 1] : event.key === "ArrowRight" ? days[dayIndex + 1] : day;
    let targetMinute = minute;
    if (event.key === "ArrowUp") targetMinute -= 15;
    else if (event.key === "ArrowDown") targetMinute += 15;
    else if (event.key === "Home") targetMinute = day.id === clock.date.id ? Math.ceil(+clock.time / 15) * 15 : 0;
    else if (event.key === "End") targetMinute = 1425;
    else if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (!targetDay || targetMinute < 0 || targetMinute > 1425 || isPast(targetDay.id, targetMinute)) return;
    setMobileDay(targetDay.id);
    setFocus({ day: targetDay.id, minute: targetMinute });
    // A day can be hidden on mobile until the state update reaches the DOM.
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${targetDay}"] [data-minute="${targetMinute}"]`
    )?.focus());
  };
  const chooseDay = (day: Day) => {
    clearSelection();
    setMobileDay(day.id);
    setFocus({ day: day.id, minute: day.id === clock.date.id ? Math.min(1425, Math.max(8 * 60, Math.ceil(+clock.time / 15) * 15)) : 8 * 60 });
  };

  return (
    <section className="week-calendar" aria-label="Select time slots on this week's calendar" aria-describedby={helpId}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); ignoreClick.current = true; clearSelection(); } }}>
      <div className="week-calendar-help" id={helpId}>
        <span className="week-calendar-desktop-help">Drag a range, or click its first and last 15-minute slots.</span>
        <span className="week-calendar-mobile-help">Choose a day. Tap the first and last 15-minute slots.</span>
        <span className="week-calendar-zone">San Diego time</span>
      </div>
      <div className="week-calendar-mobile-days" aria-label="Choose calendar day">
        {days.map((day) => <button type="button" key={day.id} aria-pressed={day.id === visibleDay?.id}
          disabled={day < clock.date} className={day.id === clock.date.id ? "calendar-today" : ""}
          onClick={() => chooseDay(day)} aria-label={day.toString([], { weekday: "long", month: "long", day: "numeric" })}>
          <span>{day.dayName("short")}</span><strong>{day.date}</strong>
        </button>)}
      </div>
      <div className="week-calendar-mobile-title">{visibleDay?.toString([], { weekday: "long", month: "short", day: "numeric" })}</div>
      <div className="week-calendar-scroll" ref={scrollRef}>
        <div className="week-calendar-head" aria-hidden="true">
          <span className="week-calendar-zone">PT</span>
          {days.map((day) => <div key={day.id} className={`${day.id === clock.date.id ? "calendar-today" : ""} ${day < clock.date ? "calendar-past-day" : ""}`}>
            <span>{day.dayName("short")}</span><strong>{day.date}</strong>
          </div>)}
        </div>
        <div className="week-calendar-body">
          <div className="week-calendar-hours" aria-hidden="true">{HOURS.map((minute) => (
            <span key={minute} style={{ top: `${minute / 1440 * 100}%` }}>{minute === 1440 ? "12 am" : Time.from(minute).toString().replace(":00", "")}</span>
          ))}</div>
          {days.map((day) => {
            const dayRanges = ranges.filter((item) => item.range.date.id === day.id);
            const lanes = rangeLanes(dayRanges);
            const preview = pending?.day === day.id ? selectionBounds(pending) : null;
            return <div className={`week-calendar-day ${day.id === visibleDay?.id ? "calendar-day-visible" : ""}`}
              data-date={day.toString()} key={day.id} role="group" aria-label={day.toString([], { weekday: "long", month: "long", day: "numeric" })}
              onPointerMove={(event) => pointerMove(event, day)} onPointerUp={pointerUp}
              onPointerCancel={(event) => {
                // Touch scrolling cancels its pointer stream, but must preserve
                // the first tap so the last slot can be chosen after scrolling.
                if (drag.current?.pointer === event.pointerId) { ignoreClick.current = true; clearSelection(); }
              }}
              onLostPointerCapture={() => { if (drag.current) clearSelection(); }}>
              {MINUTES.map((minute) => <button type="button" key={minute} data-minute={minute}
                className={`week-calendar-cell ${minute % 60 === 0 ? "calendar-hour" : ""} ${isPast(day.id, minute) ? "calendar-past" : ""}`}
                disabled={disabled || isPast(day.id, minute)}
                tabIndex={focused.day === day.id && focused.minute === minute ? 0 : -1}
                aria-label={`${day.toString([], { weekday: "long", month: "short", day: "numeric" })}, ${timeLabel(minute)}–${timeLabel(minute + 15)}`}
                title={`${timeLabel(minute)}–${timeLabel(minute + 15)}`}
                onFocus={() => setFocus({ day: day.id, minute })}
                onPointerDown={(event) => pointerDown(event, day, minute)}
                onKeyDown={(event) => keyCell(event, day, minute)}
                onClick={() => clickCell(day, minute)}>
                <span>{Time.from(minute).toString()}</span>
              </button>)}
              {dayRanges.map((item) => {
                const { lane, total } = lanes.get(item.id)!;
                const slot = item.slot ?? ranges.findIndex((candidate) => candidate.id === item.id) + 1;
                const label = `Slot ${slot}: ${timeLabel(+item.range.start)}–${timeLabel(+item.range.end)}`;
                return <button type="button" className={`week-calendar-event ${item.id === activeId ? "calendar-event-active" : ""}`}
                  key={item.id} data-color={(slot - 1) % 4} aria-label={`${label}, ${day.dayName()}. Edit time slot`} title={label}
                  aria-pressed={item.id === activeId}
                  style={{ top: `${+item.range.start / 1440 * 100}%`, height: `${(+item.range.end - +item.range.start) / 1440 * 100}%`,
                    left: `calc(${lane / total * 100}% + 3px)`, width: `calc(${100 / total}% - 6px)` }}
                  onClick={() => { clearSelection(); setMobileDay(day.id); onActivate(item.id); }}>
                  <strong>#{slot}</strong><span>{Time.from(+item.range.start).toString(true)}–{Time.from(+item.range.end).toString(true)}</span>
                </button>;
              })}
              {preview && <div className="week-calendar-preview" aria-hidden="true"
                style={{ top: `${preview.start / 1440 * 100}%`, height: `${(preview.end - preview.start) / 1440 * 100}%` }}>
                <span>{timeLabel(preview.start)}–{timeLabel(preview.end)}</span>
              </div>}
              {day.id === clock.date.id && <div className="week-calendar-now" aria-hidden="true" style={{ top: `${+clock.time / 1440 * 100}%` }} />}
            </div>;
          })}
        </div>
      </div>
      <div className="week-calendar-status" role="status" aria-live="polite">
        {pending ? <><span>{Day.fromId(pending.day).dayName("short")} · {timeLabel(selectionBounds(pending).start)}–{timeLabel(selectionBounds(pending).end)} · choose the last slot to finish</span>
          <button type="button" onClick={clearSelection}>Cancel</button></>
          : <span>{disabled ? "10 time slots selected. Remove one to add another." : "Select more time slots anywhere in the calendar."}</span>}
      </div>
    </section>
  );
}

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { Time } from "../../lib/Time";

/** Must match `--wheel-item` in styles.css. */
const ITEM_HEIGHT = 40;
/** Quiet time after the last scroll event before a wheel counts as settled. */
const SETTLE_MS = 110;

type WheelColumnProps = {
  label: string;
  options: string[];
  index: number;
  onChange: (index: number) => void;
};

/**
 * One vertical, snapping scroll wheel. Scrolling only commits a value once the
 * wheel settles, and only if the user moved it, so programmatic updates (e.g.
 * the clock ticking while "Use current time" is on) never feed back.
 */
function WheelColumn({ label, options, index, onChange }: WheelColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [centered, setCentered] = useState(index);
  /** The user scrolled, dragged, or clicked this wheel since it last settled. */
  const userIntent = useRef(false);
  const touching = useRef(false);
  const timer = useRef(0);
  const mounted = useRef(false);
  // Settling runs from a timer, so it reads the latest props through a ref
  const latest = useRef({ index, onChange });
  latest.current = { index, onChange };

  useEffect(() => {
    const wheel = ref.current;
    if (!wheel || userIntent.current) {
      return;
    }
    const top = index * ITEM_HEIGHT;
    if (Math.abs(wheel.scrollTop - top) > 1) {
      // Jump into place on first render; animate later changes
      wheel.scrollTo({ top, behavior: mounted.current ? "smooth" : "instant" });
    }
    mounted.current = true;
    setCentered(index);
  }, [index]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const settle = () => {
    const wheel = ref.current;
    if (!wheel || touching.current) {
      return;
    }
    const settled = Math.min(
      Math.max(Math.round(wheel.scrollTop / ITEM_HEIGHT), 0),
      options.length - 1
    );
    setCentered(settled);
    if (userIntent.current) {
      userIntent.current = false;
      if (settled !== latest.current.index) {
        latest.current.onChange(settled);
      }
    }
  };
  const scheduleSettle = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(settle, SETTLE_MS);
  };
  const markIntent = () => {
    userIntent.current = true;
  };

  const step = (target: number) => {
    const next = Math.min(Math.max(target, 0), options.length - 1);
    if (next !== index) {
      onChange(next);
    }
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      PageUp: index - 5,
      PageDown: index + 5,
      Home: 0,
      End: options.length - 1,
    };
    if (e.key in keys) {
      step(keys[e.key]);
      e.preventDefault();
    }
  };

  return (
    <div
      ref={ref}
      className="wheel"
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={options.length - 1}
      aria-valuenow={index}
      aria-valuetext={options[index]}
      onScroll={(e) => {
        const nearest = Math.round(e.currentTarget.scrollTop / ITEM_HEIGHT);
        if (nearest !== centered) {
          setCentered(nearest);
        }
        scheduleSettle();
      }}
      onWheel={markIntent}
      onPointerDown={markIntent}
      onTouchStart={() => {
        markIntent();
        touching.current = true;
      }}
      onTouchEnd={() => {
        touching.current = false;
        scheduleSettle();
      }}
      onTouchCancel={() => {
        touching.current = false;
        scheduleSettle();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="wheel-spacer" aria-hidden="true" />
      {options.map((option, i) => (
        <div
          key={option}
          className={`wheel-item ${i === centered ? "wheel-item-centered" : ""}`}
          aria-hidden="true"
          onClick={() => {
            markIntent();
            ref.current?.scrollTo({ top: i * ITEM_HEIGHT, behavior: "smooth" });
            scheduleSettle();
          }}
        >
          {option}
        </div>
      ))}
      <div className="wheel-spacer" aria-hidden="true" />
    </div>
  );
}

const HOURS = ["12", ...Array.from({ length: 11 }, (_, i) => `${i + 1}`)];
const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"));
const PERIODS = ["AM", "PM"];

export type TimeWheelProps = {
  time: Time;
  onTime: (time: Time) => void;
  /** Dimmed while following the clock. */
  live: boolean;
};

/** A 12-hour time picker made of three vertical scroll wheels. */
export function TimeWheel({ time, onTime, live }: TimeWheelProps) {
  const hour = time.hour % 12;
  const period = time.hour < 12 ? 0 : 1;
  return (
    <div className={`time-wheel ${live ? "time-wheel-live" : ""}`} role="group" aria-label="Time">
      <WheelColumn
        label="Hour"
        options={HOURS}
        index={hour}
        onChange={(hour) => onTime(new Time(hour + period * 12, time.minute))}
      />
      <span className="time-wheel-colon" aria-hidden="true">
        :
      </span>
      <WheelColumn
        label="Minute"
        options={MINUTES}
        index={time.minute}
        onChange={(minute) => onTime(new Time(time.hour, minute))}
      />
      <WheelColumn
        label="AM or PM"
        options={PERIODS}
        index={period}
        onChange={(period) => onTime(new Time(hour + period * 12, time.minute))}
      />
    </div>
  );
}

import { ReactNode, useState } from "react";
import { Day } from "../../lib/Day";
import { Time } from "../../lib/Time";
import { inPT } from "../../lib/now";
import { Calendar, ScrollMode } from "./Calendar";
import { TimeWheel } from "./TimeWheel";
import { useStableCallback } from "../../lib/useStable";

export type DateTimePanelProps = {
  date: Day;
  onDate: (date: Day) => void;
  time: Time;
  onTime: (customTime: Time) => void;
  useNow: boolean;
  onUseNow: (useNow: boolean) => void;
  visible: boolean;
  closeable: boolean;
  className: string;
  onClose: () => void;
  /** Quarter picker, shown under the date and time. */
  terms: ReactNode;
  /** Data freshness and credits, at the bottom. */
  footer: ReactNode;
};
export function DateTimePanel({
  date,
  onDate,
  time,
  onTime,
  useNow,
  onUseNow,
  visible,
  closeable,
  className,
  onClose,
  terms,
  footer,
}: DateTimePanelProps) {
  const [scrollMode, setScrollMode] = useState<ScrollMode>("init");

  const handleCalendarDate_s = useStableCallback((date: Day) => {
    onUseNow(false);
    onDate(date);
    setScrollMode("none");
  });

  return (
    <form
      className={`date-time-panel ${
        visible ? "" : "date-time-panel-hidden"
      } ${className} calendar-open`}
      onSubmit={(e) => {
        onClose();
        e.preventDefault();
      }}
    >
      <div className="date-time-header">
        <h2 className="panel-label">Show schedules for</h2>
        {closeable && (
          <button className="filled-icon-btn close-date-btn">Close</button>
        )}
      </div>
      <div className="date-time-flex">
        <label className="switch-label">
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={useNow}
            onChange={(e) => {
              onUseNow(e.currentTarget.checked);
              if (e.currentTarget.checked) {
                setScrollMode("date-edited");
              }
            }}
          />
          <span>
            Live
            <span className="tz-note">
              Follow the current time{inPT() ? "" : " in San Diego"}
            </span>
          </span>
        </label>
        {date.id !== Day.today().id && (
          <button
            type="button"
            className="today-btn"
            onClick={() => {
              onDate(Day.today());
              setScrollMode("date-edited");
            }}
          >
            Today
          </button>
        )}
      </div>
      <div className="date-time-fields">
        <label className="date-time-field">
          <span className="field-label">Date</span>
          <input
            type="date"
            name="date"
            value={date.toString()}
            onChange={(e) => {
              const date = Day.parse(e.currentTarget.value);
              if (date) {
                if (useNow) {
                  onUseNow(false);
                }
                onDate(date);
                setScrollMode("date-edited");
              }
            }}
            className="date-input"
          />
        </label>
        <div className="date-time-field">
          <span className="field-label">Time</span>
          <TimeWheel
            time={time}
            live={useNow}
            onTime={(time) => {
              if (useNow) {
                onUseNow(false);
              }
              onTime(time);
            }}
          />
        </div>
      </div>
      <div className="date-time-field date-time-terms">
        <span className="field-label">Quarter</span>
        {terms}
      </div>
      <Calendar
        date={date}
        onDate_s={handleCalendarDate_s}
        scrollMode={scrollMode}
        freeScroll={() => setScrollMode("none")}
      />
      <footer className="date-time-footer">{footer}</footer>
    </form>
  );
}

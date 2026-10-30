import { useMemo } from "react";
import { TermBuildings } from "../../lib/coursesToClassrooms";
import { useMoment } from "../../lib/moment-context";
import { termName } from "../../lib/terms";
import { CloseIcon } from "../icons/CloseIcon";
import { findFreeRooms } from "./FreeRoomsPanel";

const timeFormat = new Intl.DateTimeFormat([], { timeStyle: "short" });
const dateFormat = new Intl.DateTimeFormat([], {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export type MapChipsProps = {
  termBuildings?: TermBuildings;
  datePanelOpen: boolean;
  onOpenDatePanel: () => void;
  onUseNow: () => void;
  freeRoomsOpen: boolean;
  onToggleFreeRooms: () => void;
  weekPlannerOpen: boolean;
  onToggleWeekPlanner: () => void;
  visible: boolean;
};

/** Quick actions under the search bar: the schedule time and free rooms. */
export function MapChips({
  termBuildings,
  datePanelOpen,
  onOpenDatePanel,
  onUseNow,
  freeRoomsOpen,
  onToggleFreeRooms,
  weekPlannerOpen,
  onToggleWeekPlanner,
  visible,
}: MapChipsProps) {
  const moment = useMoment();
  const { date, time, type, currentTerm } = moment;
  const local = date.toLocal(time.hour, time.minute);

  const freeCount = useMemo(
    () =>
      termBuildings && type !== "term"
        ? findFreeRooms(termBuildings, moment, null).length
        : null,
    [termBuildings, type, moment]
  );

  return (
    <div
      className={`map-chips ${visible ? "" : "map-chips-hidden"}`}
      role="toolbar"
      aria-label="Schedule"
    >
      <div className={`chip-group ${type === "now" ? "" : "chip-group-custom"}`}>
        <button
          className={`chip ${datePanelOpen ? "chip-on" : ""}`}
          onClick={onOpenDatePanel}
          aria-expanded={datePanelOpen}
          title="Change the date, time, or quarter"
        >
          {type === "now" ? (
            <>
              <span className="live-dot" aria-hidden="true" />
              <span>
                Now<span className="chip-dim"> · {timeFormat.format(local)}</span>
              </span>
            </>
          ) : type === "date-time" ? (
            <span>
              {dateFormat.format(local)}
              <span className="chip-dim"> · {timeFormat.format(local)}</span>
            </span>
          ) : (
            <span>{termName(currentTerm.year, currentTerm.season)}</span>
          )}
          <svg viewBox="0 0 24 24" className="icon chip-caret" aria-hidden="true">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
        {type !== "now" && (
          <button
            className="chip chip-reset"
            onClick={onUseNow}
            aria-label="Back to the current time"
            title="Back to the current time"
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <button
        className={`chip ${freeRoomsOpen ? "chip-on" : ""}`}
        onClick={onToggleFreeRooms}
        aria-pressed={freeRoomsOpen}
        disabled={!termBuildings}
        title="Classrooms with no class listed at this time"
      >
        <svg viewBox="0 0 24 24" className="icon chip-icon" aria-hidden="true">
          <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm4.3 4.3 1.4 1.4-6.7 6.7-3.7-3.7 1.4-1.4 2.3 2.3z" />
        </svg>
        Free rooms
        {freeCount !== null && <span className="chip-count">{freeCount}</span>}
      </button>
      <button id="week-planner-toggle" className={`chip ${weekPlannerOpen ? "chip-on" : ""}`}
        onClick={onToggleWeekPlanner} aria-expanded={weekPlannerOpen} aria-controls="week-availability-panel"
        title="Find classrooms and Geisel rooms for multiple time slots this week">
        Plan this week
      </button>
    </div>
  );
}

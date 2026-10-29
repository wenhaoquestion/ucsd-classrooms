import { memo, useCallback } from "react";
import { BuildingDatum } from "../lib/buildings";
import { RoomMeeting } from "../lib/coursesToClassrooms";
import { isMeetingOngoing, useMoment } from "../lib/moment-context";
import { mapPoint } from "../lib/locations";
import { Link } from "./Link";

type BuildingButtonProps = {
  building: BuildingDatum;
  rooms: RoomMeeting[][];
  selected: boolean;
  scrollTarget: { init: boolean } | null;
  visible: boolean;
  /** Whether selecting opens the taller 3D explorer panel. */
  explorer: boolean;
  /** For the library: bookable rooms, and how many are free (if known). */
  studyRooms?: { total: number; free: number | null };
};

export const BuildingButton = memo(function BuildingButton({
  building,
  rooms,
  selected,
  scrollTarget,
  visible,
  explorer,
  studyRooms,
}: BuildingButtonProps) {
  const moment = useMoment();

  const college = building.college;

  const ref = useCallback(
    (button: HTMLAnchorElement | null) => {
      if (scrollTarget && button) {
        window.requestAnimationFrame(() => {
          const windowWidth = window.innerWidth;
          const windowHeight = window.innerHeight;
          // Center the building in the space the open panel leaves free
          const panel = document.querySelector(".building-panel");
          const panelHeight =
            scrollTarget.init || !panel
              ? 0
              : windowHeight - panel.getBoundingClientRect().top;
          const { left, top, width, height } = button.getBoundingClientRect();
          button.closest(".buildings")?.scrollBy({
            left: left + (-windowWidth + width) / 2,
            top: top + (-(windowHeight - panelHeight) + height) / 2,
            behavior: scrollTarget.init ? "auto" : "smooth",
          });
        });
      }
    },
    // `explorer` changes the panel's height
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollTarget, explorer]
  );

  const { x, y } = mapPoint(building.location);
  const inUse = studyRooms
    ? studyRooms.free
    : moment.type !== "term"
    ? rooms.filter((meetings) =>
        meetings.some((meeting) => isMeetingOngoing(meeting, moment))
      ).length
    : null;
  const total = studyRooms?.total ?? rooms.length;

  return (
    <Link
      view={{ type: "building", building: building.code }}
      className={`building-btn college-${college} ${
        selected ? "selected" : ""
      } ${visible ? "" : "building-btn-hidden"}`}
      style={{
        left: `calc(${x}px * var(--map-zoom))`,
        top: `calc(${y}px * var(--map-zoom))`,
      }}
      elemRef={ref}
      title={`${building.name}: ${
        studyRooms
          ? inUse !== null
            ? `${inUse} of ${total} study rooms free to book`
            : `${total} bookable study rooms`
          : inUse !== null
          ? `${inUse} of ${total} classrooms in use`
          : `${total} classrooms`
      }`}
    >
      {building.code}
      <span className="room-count">
        {inUse !== null ? (
          <>
            <span className="in-use">{inUse}</span>/{total}
          </>
        ) : (
          <span className="in-use">{total}</span>
        )}
      </span>
    </Link>
  );
});

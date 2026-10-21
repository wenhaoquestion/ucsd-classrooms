import { useMemo } from "react";
import { buildings } from "../../lib/buildings";
import { compareRoomNums } from "../../lib/compareRoomNums";
import { RoomMeeting, TermBuildings } from "../../lib/coursesToClassrooms";
import {
  distanceMeters,
  formatDistance,
  startLocating,
  useUserLocation,
  walkingMinutes,
} from "../../lib/geolocation";
import { doesMeetingHappen, TermMoment, useMoment } from "../../lib/moment-context";
import { getRoomActivity } from "../../lib/roomActivity";
import { CloseIcon } from "../icons/CloseIcon";
import { Link } from "../Link";

/** Gaps shorter than this aren't worth walking to. */
const MIN_FREE_MINUTES = 20;
const MAX_RESULTS = 30;

type FreeRoom = {
  building: string;
  room: string;
  /** Next listed class today, or null if there isn't one. */
  until: RoomMeeting | null;
  freeMinutes: number;
  distance: number | null;
};

function findFreeRooms(
  termBuildings: TermBuildings,
  moment: TermMoment,
  location: [number, number] | null
): FreeRoom[] {
  const now = +moment.time;
  const rooms: FreeRoom[] = [];
  for (const [code, termRooms] of Object.entries(termBuildings)) {
    const building = buildings[code];
    if (!building) {
      continue;
    }
    const distance = location ? distanceMeters(location, building.location) : null;
    for (const [room, meetings] of Object.entries(termRooms)) {
      if (getRoomActivity(meetings, moment).type !== "inactive") {
        continue;
      }
      let until: RoomMeeting | null = null;
      for (const meeting of meetings) {
        if (
          +meeting.time.start > now &&
          doesMeetingHappen(meeting, moment, moment.date, meeting.special) &&
          (!until || meeting.time.start < until.time.start)
        ) {
          until = meeting;
        }
      }
      const freeMinutes = until ? +until.time.start - now : 24 * 60 - now;
      if (freeMinutes >= MIN_FREE_MINUTES) {
        rooms.push({ building: code, room, until, freeMinutes, distance });
      }
    }
  }
  return rooms.sort(
    (a, b) =>
      (a.distance !== null && b.distance !== null ? a.distance - b.distance : 0) ||
      b.freeMinutes - a.freeMinutes ||
      a.building.localeCompare(b.building) ||
      compareRoomNums(a.room, b.room)
  );
}

export type FreeRoomsPanelProps = {
  termBuildings?: TermBuildings;
  open: boolean;
  onClose: () => void;
};

/** Classrooms with no class listed at the selected time, nearest first. */
export function FreeRoomsPanel({ termBuildings, open, onClose }: FreeRoomsPanelProps) {
  const moment = useMoment();
  const userLocation = useUserLocation();
  const location = userLocation.type === "located" ? userLocation.location : null;
  const datedMoment = moment.type !== "term";

  const rooms = useMemo(
    () =>
      open && termBuildings && datedMoment
        ? findFreeRooms(termBuildings, moment, location).slice(0, MAX_RESULTS)
        : [],
    [open, termBuildings, datedMoment, moment, location]
  );

  return (
    <aside
      className={`free-rooms ${open ? "" : "free-rooms-hidden"}`}
      aria-label="Free rooms"
      aria-hidden={!open}
      inert={!open}
    >
      <header className="free-rooms-header">
        <div>
          <h2 className="panel-label">Free rooms</h2>
          <p className="free-rooms-subtitle">
            {location ? "Nearest first" : "Longest gap first"} · no class listed for{" "}
            {MIN_FREE_MINUTES}+ min
          </p>
        </div>
        <button className="icon-btn free-rooms-close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>
      {!location && datedMoment && (
        <button
          className="free-rooms-locate"
          onClick={startLocating}
          disabled={userLocation.type === "locating"}
        >
          {userLocation.type === "locating"
            ? "Finding your location…"
            : userLocation.type === "error"
            ? `${userLocation.message} Try again`
            : "Sort by distance from me"}
        </button>
      )}
      {!datedMoment ? (
        <p className="free-rooms-empty">
          Pick a specific date and time to see which rooms are free.
        </p>
      ) : rooms.length === 0 ? (
        <p className="free-rooms-empty">No free rooms found for this time.</p>
      ) : (
        <ol className="free-rooms-list">
          {rooms.map(({ building, room, until, distance }) => (
            <li key={`${building} ${room}`}>
              <Link
                view={{ type: "building", building, room }}
                className="free-room"
              >
                <span className="free-room-name">
                  {building} {room}
                </span>
                <span className="free-room-until">
                  {until ? `Free until ${until.time.start}` : "Free for the rest of the day"}
                </span>
                {distance !== null && (
                  <span className="free-room-distance">
                    {formatDistance(distance)} · {walkingMinutes(distance)} min
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="free-rooms-disclaimer">
        From class schedules, not live occupancy. Rooms may be locked or booked
        for other events.
      </p>
    </aside>
  );
}

import { compareRoomNums } from "../../lib/compareRoomNums";
import { RoomMeeting } from "../../lib/coursesToClassrooms";
import { ROOM_STATUS_TEXT, RoomStatusKind } from "../../lib/indoor/roomStatus";
import { meetingTypes } from "../../lib/meeting-types";
import { useMoment } from "../../lib/moment-context";
import { getRoomActivity, nextMeetingToday } from "../../lib/roomActivity";
import { Link } from "../Link";

function FreeUntil({ meetings }: { meetings: RoomMeeting[] }) {
  const moment = useMoment();
  const next = nextMeetingToday(meetings, moment);
  return <>{next ? `Free until ${next.time.start}` : "Free rest of day"}</>;
}

/** A group of rooms, e.g. one floor when indoor geometry exists. */
export type RoomListSection = {
  id: string;
  title: string;
  note?: string;
  /** Room keys; keys without meetings show `emptyStatus`. */
  rooms: string[];
  emptyStatus?: RoomStatusKind;
};

export type RoomListProps = {
  building: string;
  rooms: Record<string, RoomMeeting[]>;
  sections?: RoomListSection[];
  /** Room highlighted from elsewhere (e.g. hovering it in the 3D view). */
  highlightedRoom?: string | null;
  onHoverRoom_s?: (room: string | null) => void;
  /** Only list rooms with classes this term but none at the selected time. */
  freeOnly?: boolean;
};
export function RoomList({
  building,
  rooms,
  sections,
  highlightedRoom = null,
  onHoverRoom_s,
  freeOnly = false,
}: RoomListProps) {
  const moment = useMoment();
  const isShown = (room: string) =>
    !freeOnly ||
    (!!rooms[room] && getRoomActivity(rooms[room], moment).type === "inactive");

  if (!sections && Object.keys(rooms).length === 0) {
    return (
      <div className="empty">
        <p>
          This building isn't used for any classes this week, as far as WebReg
          is concerned.
        </p>
      </div>
    );
  }

  const renderRoom = (room: string, emptyStatus?: RoomStatusKind) => {
    const meetings = rooms[room] ?? [];
    const hover = onHoverRoom_s
      ? {
          onMouseEnter: () => onHoverRoom_s(room),
          onMouseLeave: () => onHoverRoom_s(null),
          onFocus: () => onHoverRoom_s(room),
          onBlur: () => onHoverRoom_s(null),
        }
      : {};
    const highlighted = room === highlightedRoom ? "room-highlighted" : "";
    if (meetings.length === 0) {
      return (
        <Link
          key={room}
          view={{ type: "building", building, room }}
          className={`room unlisted ${highlighted}`}
          {...hover}
        >
          <div className="room-name">
            {building} {room}
          </div>
          <div className="current-meeting">
            {ROOM_STATUS_TEXT[emptyStatus ?? "none-listed"]}
          </div>
        </Link>
      );
    }
    const activity = getRoomActivity(meetings, moment);
    const activeMeeting = activity.type !== "inactive" ? activity.meeting : null;
    const soon = activity.type === "soon";
    return (
      <Link
        key={room}
        view={{ type: "building", building, room }}
        className={`room ${
          activeMeeting ? (soon ? "soon" : "active") : "inactive"
        } ${highlighted}`}
        {...hover}
      >
        <div className="room-name">
          {building} {room}
        </div>
        {moment.type !== "term" ? (
          <div className="current-meeting">
            {activeMeeting ? (
              <>
                {activeMeeting.course}{" "}
                {soon ? (
                  "soon"
                ) : (
                  <>
                    (
                    <abbr
                      title={`${
                        meetingTypes[activeMeeting.type]
                      } with up to ${activeMeeting.capacity} student${
                        activeMeeting.capacity === 1 ? "" : "s"
                      }`}
                    >
                      {activeMeeting.type}
                    </abbr>
                    )
                  </>
                )}
              </>
            ) : (
              <FreeUntil meetings={meetings} />
            )}
          </div>
        ) : null}
      </Link>
    );
  };

  const noneFree = (
    <div className="empty">
      <p>Every classroom here has a class now or soon.</p>
    </div>
  );

  if (sections) {
    const shown = sections
      .map((section) => ({ ...section, rooms: section.rooms.filter(isShown) }))
      .filter((section) => section.rooms.length > 0);
    if (shown.length === 0) {
      return noneFree;
    }
    return (
      <div className="room-list">
        {shown.map((section) => (
          <section className="room-section" key={section.id}>
            <h3 className="room-section-title">{section.title}</h3>
            {section.note && !freeOnly && (
              <p className="room-section-note">{section.note}</p>
            )}
            <div className="rooms">
              {[...section.rooms]
                .sort(compareRoomNums)
                .map((room) => renderRoom(room, section.emptyStatus))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const shown = Object.keys(rooms).filter(isShown);
  if (shown.length === 0) {
    return noneFree;
  }
  return (
    <div className="room-list">
      <div className="rooms">
        {shown
          // Can't pre-sort the rooms object entries because JS sorts numerical
          // properties differently
          .sort(compareRoomNums)
          .map((room) => renderRoom(room))}
      </div>
    </div>
  );
}

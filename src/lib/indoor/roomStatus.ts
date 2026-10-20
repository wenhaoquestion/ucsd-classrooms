import { RoomMeeting } from "../coursesToClassrooms";
import { TermMoment } from "../moment-context";
import { getRoomActivity } from "../roomActivity";
import { IndoorIndex } from "./roomMapping";
import { INSTRUCTIONAL_ROOM_TYPES } from "./schema";

/**
 * Schedule-derived status of a room at the selected moment. None of these
 * represent measured physical occupancy.
 */
export type RoomStatusKind =
  /** A listed class is scheduled at the selected time. */
  | "in-use"
  /** A listed class starts within a few minutes. */
  | "soon"
  /** The room has listed classes, but none at the selected time. */
  | "no-class-now"
  /** Generic-week view: the room has listed classes this term (neutral). */
  | "listed"
  /** Schedule data loaded, but lists no classes in this room. */
  | "none-listed"
  /** Schedule data didn't (fully) load, so nothing can be said. */
  | "unknown"
  /** Not an instructional room; schedules don't apply. */
  | "not-tracked";

export const ROOM_STATUS_TEXT: Record<RoomStatusKind, string> = {
  "in-use": "Class scheduled now",
  soon: "Class starts soon",
  "no-class-now": "No class listed now",
  listed: "Has listed classes",
  "none-listed": "No classes listed",
  unknown: "Schedule data unavailable",
  "not-tracked": "Not a scheduled room",
};

export type ScheduleAvailability =
  /** All requested terms loaded. */
  | "complete"
  /** Some terms failed to load, so absences are inconclusive. */
  | "partial"
  /** No schedule data. */
  | "unavailable";

export type RoomStatus = {
  kind: RoomStatusKind;
  /** The meeting behind `in-use`/`soon`. */
  course?: string;
};

export function getRoomStatus(
  meetings: RoomMeeting[] | undefined,
  moment: TermMoment,
  availability: ScheduleAvailability,
  instructional: boolean
): RoomStatus {
  if (availability === "unavailable") {
    return { kind: instructional ? "unknown" : "not-tracked" };
  }
  if (meetings && meetings.length > 0) {
    if (moment.type === "term") {
      return { kind: "listed" };
    }
    const activity = getRoomActivity(meetings, moment);
    if (activity.type === "active") {
      return { kind: "in-use", course: activity.meeting.course };
    }
    if (activity.type === "soon") {
      return { kind: "soon", course: activity.meeting.course };
    }
    // A missing term might have had a class here
    return { kind: availability === "partial" ? "unknown" : "no-class-now" };
  }
  if (!instructional) {
    return { kind: "not-tracked" };
  }
  return { kind: availability === "partial" ? "unknown" : "none-listed" };
}

/** Status for every geometry room, keyed by geometry room ID. */
export function getIndoorStatuses(
  index: IndoorIndex,
  rooms: Record<string, RoomMeeting[]>,
  moment: TermMoment,
  availability: ScheduleAvailability
): Map<string, RoomStatus> {
  const statuses = new Map<string, RoomStatus>();
  for (const room of index.roomsById.values()) {
    const key = index.scheduleKeyByRoomId.get(room.id);
    statuses.set(
      room.id,
      getRoomStatus(
        key !== undefined ? rooms[key] : undefined,
        moment,
        availability,
        key !== undefined || INSTRUCTIONAL_ROOM_TYPES.has(room.type)
      )
    );
  }
  return statuses;
}

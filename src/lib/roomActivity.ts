import { RoomMeeting } from "./coursesToClassrooms";
import { isMeetingOngoing, TermMoment } from "./moment-context";

/** Minutes before a meeting starts that the room is considered "soon" in use. */
export const SOON_MINUTES = 10;

export type RoomActivity =
  | { type: "active"; meeting: RoomMeeting }
  | { type: "soon"; meeting: RoomMeeting }
  | { type: "inactive" };

/**
 * What a room's listed meetings say about the selected moment. This is
 * schedule-derived, not measured occupancy: an "inactive" room only has no
 * class listed, and isn't necessarily open.
 */
export function getRoomActivity(
  meetings: RoomMeeting[],
  moment: TermMoment
): RoomActivity {
  const meeting = meetings.find((meeting) =>
    isMeetingOngoing(meeting, moment, SOON_MINUTES)
  );
  if (!meeting) {
    return { type: "inactive" };
  }
  return moment.time < meeting.time.start
    ? { type: "soon", meeting }
    : { type: "active", meeting };
}

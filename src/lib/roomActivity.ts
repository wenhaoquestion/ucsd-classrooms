import { RoomMeeting } from "./coursesToClassrooms";
import { doesMeetingHappen, isMeetingOngoing, TermMoment } from "./moment-context";

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

/** The room's next listed meeting later on the selected day, if any. */
export function nextMeetingToday(
  meetings: RoomMeeting[],
  moment: TermMoment
): RoomMeeting | null {
  let next: RoomMeeting | null = null;
  for (const meeting of meetings) {
    if (
      meeting.time.start > moment.time &&
      doesMeetingHappen(meeting, moment, moment.date, meeting.special) &&
      (!next || meeting.time.start < next.time.start)
    ) {
      next = meeting;
    }
  }
  return next;
}

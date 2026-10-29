import { useMemo, useState } from "react";
import { BuildingDatum } from "../../lib/buildings";
import { IndoorIndex, roomForKey } from "../../lib/indoor/roomMapping";
import { RoomStatusKind } from "../../lib/indoor/roomStatus";
import {
  AvailabilityState,
  bookingUrl,
  describeStatus,
  GEISEL_SPACES,
  groupStatus,
  LibrarySpace,
  slotRuns,
  SPACES_BY_KEY,
  SPACES_BY_ROOM,
  spaceStatuses,
  SpaceStatus,
  STATUS_KIND,
  useGeiselAvailability,
} from "../../lib/library/geisel";
import { useMoment } from "../../lib/moment-context";
import { now } from "../../lib/now";
import { BuildingActions } from "../building/BuildingActions";
import { BuildingHeader } from "../building/BuildingHeader";
import { ExplorerBooking } from "../explorer/BuildingExplorer";
import { Link } from "../Link";
import "./library.css";

const FLOOR_LABELS: Record<string, string> = {
  L1: "Floor 1 · West",
  L2: "Floor 2 · East and Service Hub",
  L5: "Floor 5",
  L6: "Floor 6",
  L7: "Floor 7",
};

export type GeiselBooking = {
  state: AvailabilityState | { type: "no-date" };
  /** Status of every space at the selected time, when live data is loaded. */
  statuses: Map<string, SpaceStatus> | null;
  explorer: ExplorerBooking;
};

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="icon library-external" aria-hidden="true">
      <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42L17.59 5H14zM5 5h6v2H6v11h11v-5h2v7H4V5z" />
    </svg>
  );
}

function BookLink({ space, primary = false }: { space: LibrarySpace; primary?: boolean }) {
  const moment = useMoment();
  return (
    <a
      className={`library-book ${primary ? "action-btn action-btn-primary" : ""}`}
      href={bookingUrl(space, moment.type === "term" ? undefined : moment.date)}
      target="_blank"
      rel="noreferrer"
      title={`Reserve ${space.title} on the library's LibCal (UCSD sign-in)`}
    >
      {primary ? `Reserve ${space.title}` : "Book"}
      <ExternalIcon />
    </a>
  );
}

/**
 * Live reservations for the selected date and time, shared by the room list
 * and the 3D view. `index` (Geisel's indoor layout) maps blocks of rooms.
 */
export function useGeiselBooking(index: IndoorIndex | null, enabled: boolean): GeiselBooking {
  const moment = useMoment();
  const today = now().date;
  const datePicked = moment.type !== "term";
  const live = useGeiselAvailability(moment.date, today, enabled && datePicked);
  const state = datePicked ? live : ({ type: "no-date" } as const);
  const data = state.type === "ready" ? state.data : null;
  const time = moment.time;
  const statuses = useMemo(() => (data ? spaceStatuses(data, time) : null), [data, time]);

  const explorer = useMemo((): ExplorerBooking => {
    const fallback: RoomStatusKind =
      state.type === "loading" || state.type === "error" ? "unknown" : "not-tracked";
    const roomStatuses = new Map<string, RoomStatusKind>();
    for (const [roomId, spaces] of SPACES_BY_ROOM) {
      roomStatuses.set(
        roomId,
        statuses
          ? STATUS_KIND[groupStatus(spaces.map((space) => statuses.get(space.key)!))]
          : fallback
      );
    }
    const booths = GEISEL_SPACES.filter((space) => !space.room);
    const freeBooths = booths.filter((space) => statuses?.get(space.key)?.kind === "free");
    const floorBadges = new Map([
      [
        "L2",
        `+${booths.length} booths${statuses ? ` (${freeBooths.length} free)` : ""}`,
      ],
    ]);
    const label = (roomId: string) => index?.roomsById.get(roomId)?.label ?? roomId;
    return {
      selectable: new Set(SPACES_BY_ROOM.keys()),
      statuses: roomStatuses,
      roomIdForKey: (key) =>
        key === null
          ? null
          : SPACES_BY_KEY.get(key)?.room ?? (index ? roomForKey(index, key)?.id ?? null : null),
      keyForRoom: (roomId) => {
        const spaces = SPACES_BY_ROOM.get(roomId) ?? [];
        return spaces.length === 1 ? spaces[0].key : label(roomId);
      },
      renderSelection: (roomId) => {
        const spaces = SPACES_BY_ROOM.get(roomId) ?? [];
        const floor = index?.floorsById.get(index.roomsById.get(roomId)?.floor ?? "")?.label;
        if (spaces.length === 1) {
          const [space] = spaces;
          const status = statuses?.get(space.key);
          return (
            <>
              <strong>{space.title}</strong> · {floor} · {space.capacity} seats
              {status ? ` · ${describeStatus(status)}` : ""}{" "}
              <BookLink space={space} />
            </>
          );
        }
        const free = spaces.filter((space) => statuses?.get(space.key)?.kind === "free");
        return (
          <>
            <strong>
              {index?.roomsById.get(roomId)?.name} {label(roomId)}
            </strong>{" "}
            · {floor} · {statuses ? `${free.length} of ${spaces.length} free` : `${spaces.length} rooms`}
            . Pick one in the list to book it.
          </>
        );
      },
      floorBadges,
      // Without live data, rooms aren't colored, so there's nothing to explain
      legend: statuses ? ["bookable", "booked", "closed"] : [],
      legendNote: statuses
        ? "Live reservations from the library's LibCal"
        : "Live reservations unavailable; rooms still link to LibCal",
      hint: "Tap a study room to see when it's free and book it.",
    };
  }, [index, statuses, state.type]);

  return { state, statuses, explorer };
}

function stateMessage(state: GeiselBooking["state"], date: string): string | null {
  switch (state.type) {
    case "ready":
      return state.data.windowEnd && state.data.spaces.size === 0
        ? `Reservations for ${date} haven't opened yet. LibCal books about two weeks ahead.`
        : null;
    case "loading":
      return "Loading live reservations…";
    case "error":
      return `Couldn't load live reservations (${state.message}). Each room still links to LibCal.`;
    case "past":
      return "Reservations aren't shown for past dates.";
    case "no-date":
      return "Pick a date and time to see which study rooms are free.";
    case "unconfigured":
      return "Live availability isn't set up for this copy of the site. Each room links to its LibCal page.";
  }
}

function SpaceCard({
  space,
  status,
  highlighted,
  onHoverRoom_s,
}: {
  space: LibrarySpace;
  status: SpaceStatus | undefined;
  highlighted: boolean;
  onHoverRoom_s: (room: string | null) => void;
}) {
  return (
    <div
      className={`room library-room ${status ? `library-${status.kind}` : ""} ${
        highlighted ? "room-highlighted" : ""
      }`}
      onMouseEnter={() => onHoverRoom_s(space.key)}
      onMouseLeave={() => onHoverRoom_s(null)}
    >
      <Link
        view={{ type: "building", building: "GEISEL", room: space.key }}
        className="library-room-main"
        onFocus={() => onHoverRoom_s(space.key)}
        onBlur={() => onHoverRoom_s(null)}
      >
        <div className="room-name">
          {space.title}
          <span className="library-capacity" title={`${space.capacity} seats`}>
            {space.capacity}
            <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z" />
            </svg>
          </span>
        </div>
        <div className="current-meeting">{status ? describeStatus(status) : space.note ?? " "}</div>
      </Link>
      <BookLink space={space} />
    </div>
  );
}

function DayTimeline({ space, booking }: { space: LibrarySpace; booking: GeiselBooking }) {
  const moment = useMoment();
  if (booking.state.type !== "ready") {
    return null;
  }
  const slots = booking.state.data.spaces.get(space.eid) ?? [];
  const runs = slotRuns(slots);
  if (runs.length === 0) {
    return <p className="library-timeline-empty">No bookable times on this day.</p>;
  }
  const url = bookingUrl(space, moment.date);
  return (
    <ol className="library-timeline" aria-label={`${space.title} on ${moment.date.toString([], { weekday: "long", month: "long", day: "numeric" })}`}>
      {runs.map((run) => {
        const current = run.start <= moment.time && moment.time < run.end;
        const text = run.status === "free" ? "Free" : run.status === "booked" ? "Booked" : "Not bookable";
        return (
          <li
            key={+run.start}
            className={`library-run library-${run.status === "free" ? "free" : run.status} ${
              current ? "library-run-current" : ""
            }`}
          >
            <span className="library-run-time">{run.start.formatRange(run.end)}</span>
            <span className="library-run-status">{text}</span>
            {run.status === "free" && (
              <a href={url} target="_blank" rel="noreferrer" className="library-run-book">
                Book
                <ExternalIcon />
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type LibraryPanelContentProps = {
  building: BuildingDatum;
  room: string | null;
  index: IndoorIndex | null;
  booking: GeiselBooking;
  explorerOpen: boolean;
  hoveredRoom: string | null;
  onHoverRoom_s: (room: string | null) => void;
  onExplorerEnabled_s: (enabled: boolean) => void;
};

/** Geisel's study rooms with live reservations, in place of a class schedule. */
export function LibraryPanelContent({
  building,
  room,
  index,
  booking,
  explorerOpen,
  hoveredRoom,
  onHoverRoom_s,
  onExplorerEnabled_s,
}: LibraryPanelContentProps) {
  const moment = useMoment();
  const [freeOnly, setFreeOnly] = useState(false);
  const { statuses } = booking;
  const freeCount = statuses
    ? [...statuses.values()].filter((status) => status.kind === "free").length
    : null;
  const message = stateMessage(booking.state, moment.date.toString([], { month: "long", day: "numeric" }));
  const notice = message && (
    <div className="room-notice library-notice" role="status">
      <p>{message}</p>
    </div>
  );
  const hoveredSpaces = new Set(
    hoveredRoom === null
      ? []
      : SPACES_BY_KEY.has(hoveredRoom)
      ? [hoveredRoom]
      : (SPACES_BY_ROOM.get(booking.explorer.roomIdForKey(hoveredRoom) ?? "") ?? []).map((s) => s.key)
  );
  const cards = (spaces: LibrarySpace[]) => (
    <div className="rooms library-rooms">
      {spaces.map((space) => (
        <SpaceCard
          key={space.key}
          space={space}
          status={statuses?.get(space.key)}
          highlighted={hoveredSpaces.has(space.key)}
          onHoverRoom_s={onHoverRoom_s}
        />
      ))}
    </div>
  );

  if (room) {
    const space = SPACES_BY_KEY.get(room);
    const geometry = index && !space ? roomForKey(index, room) : null;
    const block = geometry ? SPACES_BY_ROOM.get(geometry.id) : undefined;
    const floor = (id: string) => index?.floorsById.get(id)?.label ?? `Floor ${id.slice(1)}`;
    return (
      <>
        <BuildingHeader building={building} room={room} />
        <div className="library-detail">
          {notice}
          {space ? (
            <>
              <div className="room-notice">
                <p>
                  {floor(space.floor)} · {space.capacity} seat{space.capacity === 1 ? "" : "s"}
                  {space.note ? ` · ${space.note}` : ""}
                  {space.room && SPACES_BY_ROOM.get(space.room)!.length > 1
                    ? `. The library map shows it in the ${index?.roomsById.get(space.room)?.label ?? ""} block, not as its own room.`
                    : ""}
                </p>
                {statuses?.get(space.key) && (
                  <p className={`library-status library-${statuses.get(space.key)!.kind}`}>
                    {describeStatus(statuses.get(space.key)!)}
                  </p>
                )}
              </div>
              <div className="building-actions">
                <BookLink space={space} primary />
              </div>
              <DayTimeline space={space} booking={booking} />
              <p className="library-fineprint">
                Booking opens LibCal, where you sign in with your UCSD account.
                {booking.state.type === "ready" &&
                  ` Updated ${booking.state.data.fetchedAt.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}; refreshes every minute.`}
              </p>
            </>
          ) : block ? (
            <>
              <div className="room-notice">
                <p>
                  {geometry?.name} {geometry?.label} on {floor(geometry!.floor)}. The library map
                  draws these rooms as one block.
                </p>
              </div>
              {cards(block)}
            </>
          ) : (
            <div className="empty">
              <p>{index ? `${room} isn't a bookable room in Geisel.` : "Loading…"}</p>
            </div>
          )}
        </div>
      </>
    );
  }

  const shown = GEISEL_SPACES.filter(
    (space) => !freeOnly || !statuses || statuses.get(space.key)?.kind === "free"
  );
  const floors = [...new Set(shown.map((space) => space.floor))];
  return (
    <>
      <BuildingHeader building={building} room={null} />
      <BuildingActions
        building={building}
        freeCount={freeCount}
        freeOnly={freeOnly && freeCount !== null}
        onFreeOnly={setFreeOnly}
        explorerOpen={explorerOpen}
        onExplorerEnabled_s={onExplorerEnabled_s}
        freeTitle="Only show study rooms free to book now"
      />
      <div className="gradient gradient-sticky gradient-top" />
      {notice}
      {floors.length === 0 ? (
        <div className="empty">
          <p>No study room is free to book at this time.</p>
        </div>
      ) : (
        <div className="room-list">
          {floors.map((floor) => (
            <section className="room-section" key={floor}>
              <h3 className="room-section-title">{FLOOR_LABELS[floor] ?? floor}</h3>
              {cards(shown.filter((space) => space.floor === floor))}
            </section>
          ))}
        </div>
      )}
      <div className="gradient gradient-sticky gradient-bottom" />
    </>
  );
}

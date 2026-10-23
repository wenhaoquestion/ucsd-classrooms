import { PointerEvent, useContext, useMemo, useRef, useState } from "react";
import { BuildingDatum } from "../../lib/buildings";
import {
  directionsUrl,
  distanceMeters,
  useUserLocation,
  walkingMinutes,
} from "../../lib/geolocation";
import { getRoomActivity } from "../../lib/roomActivity";
import { RoomMeeting } from "../../lib/coursesToClassrooms";
import { hasIndoorLayout } from "../../lib/indoor/manifest";
import { computeCoverage, IndoorIndex, roomForKey } from "../../lib/indoor/roomMapping";
import { ScheduleAvailability } from "../../lib/indoor/roomStatus";
import { IndoorLayoutState, useIndoorLayout } from "../../lib/indoor/useIndoorLayout";
import { toViewTerm, useMoment } from "../../lib/moment-context";
import { useLast } from "../../lib/useLast";
import { useStableCallback } from "../../lib/useStable";
import { OnView } from "../../lib/View";
import { AbbrevHeading } from "../AbbrevHeading";
import { BuildingExplorer, ExplorerIntro } from "../explorer/BuildingExplorer";
import { BackIcon } from "../icons/BackIcon";
import { CloseIcon } from "../icons/CloseIcon";
import { Image } from "../Image";
import { Link, navigate } from "../Link";
import { closeBuildingBack } from "./backHandlers";
import { RoomList, RoomListSection } from "./RoomList";
import { RoomSchedule } from "./RoomSchedule";

/** How an unplaced room's floor is known, for notes. */
const UNPLACED_BASIS = {
  "room-number": "from the room number",
  "floor-listing": "from the floor's room listing",
};

/** Groups schedule rooms (and selectable mapped rooms) by floor. */
function indoorSections(
  index: IndoorIndex,
  rooms: Record<string, RoomMeeting[]>,
  availability: ScheduleAvailability
): RoomListSection[] {
  const coverage = computeCoverage(index, Object.keys(rooms));
  const byFloor = new Map<string, string[]>();
  const emptyByFloor = new Map<string, string[]>();
  const unplacedCount = new Map<string, number>();
  for (const { key, room } of coverage.mapped) {
    byFloor.set(room.floor, [...(byFloor.get(room.floor) ?? []), key]);
  }
  for (const { key, floor } of coverage.unplaced) {
    byFloor.set(floor.id, [...(byFloor.get(floor.id) ?? []), key]);
    unplacedCount.set(floor.id, (unplacedCount.get(floor.id) ?? 0) + 1);
  }
  for (const room of coverage.geometryOnly) {
    const key = index.scheduleKeyByRoomId.get(room.id) ?? room.label;
    emptyByFloor.set(room.floor, [...(emptyByFloor.get(room.floor) ?? []), key]);
  }
  const shell = index.building.geometryStatus === "exterior-shell";
  const sections: RoomListSection[] = [];
  for (const floor of index.building.floors) {
    const listed = byFloor.get(floor.id) ?? [];
    const empty = emptyByFloor.get(floor.id) ?? [];
    const unplaced = unplacedCount.get(floor.id) ?? 0;
    if (listed.length + empty.length > 0) {
      sections.push({
        id: floor.id,
        title: floor.label,
        // A shell has no room positions at all, which the 3D view already says
        note:
          unplaced > 0 && !shell
            ? `${unplaced === listed.length ? "These rooms aren't" : `${unplaced} of these rooms aren't`} placed on the floor plan.`
            : undefined,
        rooms: [...listed, ...empty],
        emptyStatus: availability === "complete" ? "none-listed" : "unknown",
      });
    }
  }
  if (coverage.scheduleOnly.length > 0) {
    sections.push({
      id: "unmapped",
      title: shell ? "Floor unknown" : "Location not mapped yet",
      note: shell
        ? "These room numbers don't say which floor they're on."
        : "These rooms are in the schedule, but no floor plan we have places them, so they aren't in the 3D view.",
      rooms: coverage.scheduleOnly,
    });
  }
  return sections;
}

type BuildingActionsProps = {
  building: BuildingDatum;
  /** Rooms with no class listed now, or null when not viewing a date. */
  freeCount: number | null;
  freeOnly: boolean;
  onFreeOnly: (freeOnly: boolean) => void;
  explorerOpen: boolean;
  onExplorerEnabled_s: (enabled: boolean) => void;
};

/** Directions, the free room filter, and the 3D/list switch. */
function BuildingActions({
  building,
  freeCount,
  freeOnly,
  onFreeOnly,
  explorerOpen,
  onExplorerEnabled_s,
}: BuildingActionsProps) {
  const userLocation = useUserLocation();
  const [latitude, longitude] = building.location;
  const placed = latitude !== 0 || longitude !== 0;
  const distance =
    placed && userLocation.type === "located"
      ? distanceMeters(userLocation.location, building.location)
      : null;
  return (
    <div className="building-actions">
      {placed && (
        <a
          className="action-btn action-btn-primary"
          href={directionsUrl(building.location)}
          target="_blank"
          rel="noreferrer"
          title="Walking directions in your maps app"
        >
          Directions
          {distance !== null && (
            <span className="action-btn-detail">{walkingMinutes(distance)} min</span>
          )}
          <svg viewBox="0 0 24 24" className="icon action-icon" aria-hidden="true">
            <path d="M7 7h10v10h-2V10.41l-8.29 8.3-1.42-1.42L13.59 9H7z" />
          </svg>
        </a>
      )}
      {freeCount !== null && (
        <button
          className={`action-btn ${freeOnly ? "action-btn-on" : ""}`}
          aria-pressed={freeOnly}
          onClick={() => onFreeOnly(!freeOnly)}
          title="Only show classrooms with no class listed now"
        >
          Free now
          <span className="action-count">{freeCount}</span>
        </button>
      )}
      {hasIndoorLayout(building.code) && (
        <div className="segmented" role="group" aria-label="Room view">
          <button
            className="segment"
            aria-pressed={!explorerOpen}
            onClick={() => onExplorerEnabled_s(false)}
          >
            List
          </button>
          <button
            className="segment"
            aria-pressed={explorerOpen}
            onClick={() => onExplorerEnabled_s(true)}
          >
            3D
          </button>
        </div>
      )}
    </div>
  );
}

type BuildingPanelContentProps = {
  building: BuildingDatum;
  room: string | null;
  rooms: Record<string, RoomMeeting[]>;
  availability: ScheduleAvailability;
  layout: IndoorLayoutState;
  explorerOpen: boolean;
  hoveredRoom: string | null;
  onHoverRoom_s: (room: string | null) => void;
  onExplorerEnabled_s: (enabled: boolean) => void;
};
function BuildingPanelContent({
  building,
  room,
  rooms,
  availability,
  layout,
  explorerOpen,
  hoveredRoom,
  onHoverRoom_s,
  onExplorerEnabled_s,
}: BuildingPanelContentProps) {
  const { code, images, college, name } = building;
  const lastRoom = useLast("", room);
  const moment = useMoment();
  const [freeOnly, setFreeOnly] = useState(false);
  const freeCount = useMemo(
    () =>
      moment.type === "term"
        ? null
        : Object.values(rooms).filter(
            (meetings) => getRoomActivity(meetings, moment).type === "inactive"
          ).length,
    [rooms, moment]
  );

  const imageUrl = images[0]?.url; // TODO: Compress

  const index = layout.type === "ready" ? layout.index : null;
  const sections = useMemo(
    () => (index ? indoorSections(index, rooms, availability) : undefined),
    [index, rooms, availability]
  );

  let roomNotice = null;
  let emptyMessage = null;
  const unplaced = room && index ? index.unplacedByKey.get(room) : undefined;
  if (unplaced) {
    roomNotice = (
      <p>
        {unplaced.room.basis === "room-number" ? "Probably on" : "On"} {unplaced.floor.label} (
        {UNPLACED_BASIS[unplaced.room.basis]}). Its position on the floor isn't mapped. Its
        schedule is below.
      </p>
    );
  } else if (room && index) {
    const geometryRoom = roomForKey(index, room);
    if (!geometryRoom) {
      roomNotice = (
        <p>
          This room's location inside {code} hasn't been mapped yet. Its schedule
          is below.
        </p>
      );
    } else if (!rooms[room]) {
      emptyMessage =
        availability === "complete"
          ? `No classes are listed for ${code} ${room} in the loaded schedules. That doesn't necessarily mean the room is open or available.`
          : `Some schedule data failed to load, so it's unknown whether classes meet in ${code} ${room}.`;
    }
  }
  if (room && availability === "partial" && rooms[room]) {
    roomNotice = (
      <>
        {roomNotice}
        <p>Some schedule data failed to load, so this schedule may be incomplete.</p>
      </>
    );
  }

  return (
    <>
      <header
        className={`building-name ${
          room ? "schedule-view" : "list-view"
        } college-${college}`}
      >
        {images.length > 0 && (
          <Image
            className="building-header-image"
            src={imageUrl}
            key={imageUrl}
          />
        )}
        <Link
          view={room ? { type: "building", building: code } : null}
          className="icon-btn back"
          aria-label="Back to room list"
          back={([previous]) => {
            // If the user just came from a room list then go back to it
            if (previous && previous.type === "building" && !previous.room) {
              return 0;
            } else {
              return null;
            }
          }}
        >
          <BackIcon />
        </Link>
        <AbbrevHeading
          heading="h2"
          abbrev={
            <span>
              {code} <span className="room-number">{lastRoom}</span>
            </span>
          }
        >
          {name}
        </AbbrevHeading>
        <Link
          view={{ type: "default" }}
          className="icon-btn close"
          aria-label="Close"
          back={closeBuildingBack(room)}
        >
          <CloseIcon />
        </Link>
      </header>
      {room ? (
        <RoomSchedule
          building={code}
          room={room}
          meetings={rooms[room] ?? []}
          notice={roomNotice}
          emptyMessage={emptyMessage}
        />
      ) : (
        <>
          <BuildingActions
            building={building}
            freeCount={freeCount}
            freeOnly={freeOnly && freeCount !== null}
            onFreeOnly={setFreeOnly}
            explorerOpen={explorerOpen}
            onExplorerEnabled_s={onExplorerEnabled_s}
          />
          <div className="gradient gradient-sticky gradient-top" />
          <RoomList
            building={code}
            rooms={rooms}
            sections={sections}
            freeOnly={freeOnly && freeCount !== null}
            highlightedRoom={hoveredRoom}
            onHoverRoom_s={index ? onHoverRoom_s : undefined}
          />
          {images.length > 0 ? (
            <div className="building-images">
              {images.map((image) => {
                const imageUrl = image.url; // TODO: Compress
                return (
                  <a
                    href={image.url}
                    className="building-image-link"
                    key={imageUrl}
                    target="_blank"
                  >
                    <Image
                      className="building-image"
                      src={imageUrl}
                      loading="lazy"
                      width={image.size[0]}
                      height={image.size[1]}
                    />
                  </a>
                );
              })}
            </div>
          ) : null}
          <div className="gradient gradient-sticky gradient-bottom" />
        </>
      )}
    </>
  );
}

export type BuildingPanelProps = {
  building: BuildingDatum;
  room: string | null;
  rooms: Record<string, RoomMeeting[]>;
  availability: ScheduleAvailability;
  visible: boolean;
  rightPanelOpen: boolean;
  explorerIntro: ExplorerIntro;
  explorerEnabled: boolean;
  onExplorerEnabled_s: (enabled: boolean) => void;
};
export function BuildingPanel({
  visible,
  rightPanelOpen,
  explorerIntro,
  explorerEnabled,
  onExplorerEnabled_s,
  ...props
}: BuildingPanelProps) {
  const code = props.building.code;
  const roomKeys = useMemo(() => Object.keys(props.rooms), [props.rooms]);
  const layout = useIndoorLayout(code, props.building.name, true, roomKeys);
  const explorerOpen = explorerEnabled && hasIndoorLayout(code);
  // Shared between the room list and the 3D view; keyed by room key
  const [hovered, setHovered] = useState<{ building: string; room: string | null }>({
    building: code,
    room: null,
  });
  const hoveredRoom = hovered.building === code ? hovered.room : null;
  const onHoverRoom_s = useStableCallback((room: string | null) =>
    setHovered({ building: code, room })
  );

  // On phones the panel is a bottom sheet: drag its handle up to expand it,
  // down to shrink or close it
  const moment = useMoment();
  const onView = useContext(OnView);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number; moved: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (!visible && expanded) {
    setExpanded(false);
  }
  const close = () =>
    navigate(onView, {
      view: { type: "default", term: toViewTerm(moment) },
      back: closeBuildingBack(props.room),
    });
  const endDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const panel = panelRef.current;
    const start = drag.current;
    drag.current = null;
    if (!panel || !start) {
      return;
    }
    panel.classList.remove("building-panel-dragging");
    panel.style.removeProperty("height");
    panel.style.removeProperty("transform");
    const dy = e.clientY - start.y;
    if (!start.moved) {
      setExpanded((expanded) => !expanded);
    } else if (dy < -40) {
      setExpanded(true);
    } else if (dy > start.height * 0.45) {
      close();
    } else if (dy > 60) {
      setExpanded(false);
    }
  };

  return (
    <div
      ref={panelRef}
      className={`building-panel ${visible ? "" : "building-panel-invisible"} ${
        rightPanelOpen ? "right-panel-open" : ""
      } ${explorerOpen ? "explorer-mode" : ""} ${
        expanded ? "building-panel-expanded" : ""
      }`}
    >
      <button
        className="sheet-handle"
        aria-label={expanded ? "Shrink panel" : "Expand panel"}
        aria-expanded={expanded}
        onPointerDown={(e) => {
          const panel = panelRef.current;
          if (!panel) {
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, height: panel.offsetHeight, moved: false };
          panel.classList.add("building-panel-dragging");
        }}
        onPointerMove={(e) => {
          const panel = panelRef.current;
          const start = drag.current;
          if (!panel || !start) {
            return;
          }
          const dy = e.clientY - start.y;
          if (Math.abs(dy) > 6) {
            start.moved = true;
          }
          if (dy < 0) {
            // Grow upwards, but not past the top of the screen
            panel.style.height = `${Math.min(start.height - dy, window.innerHeight - 24)}px`;
            panel.style.removeProperty("transform");
          } else {
            panel.style.removeProperty("height");
            panel.style.transform = `translateY(${dy}px)`;
          }
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // Pointer events handle taps; this keeps keyboard activation working
        onClick={(e) => {
          if (e.detail === 0) {
            setExpanded((expanded) => !expanded);
          }
        }}
      >
        <span className="sheet-handle-bar" />
      </button>
      {explorerOpen && (
        <BuildingExplorer
          // A new building gets a new scene; rooms in the same building reuse it
          key={code}
          building={props.building}
          room={props.room}
          rooms={props.rooms}
          availability={props.availability}
          layout={layout}
          active={visible}
          intro={explorerIntro}
          hoveredRoom={hoveredRoom}
          onHoverRoom_s={onHoverRoom_s}
          layoutKey={`${rightPanelOpen}`}
        />
      )}
      <div className="building-panel-content">
        <BuildingPanelContent
          // Force new elements (disable transition) when building changes
          key={code}
          // For some reason this needs to be after `key` or then Deno gets pissed
          // about `react` not existing.
          {...props}
          layout={layout}
          explorerOpen={explorerOpen}
          hoveredRoom={hoveredRoom}
          onHoverRoom_s={onHoverRoom_s}
          onExplorerEnabled_s={onExplorerEnabled_s}
        />
      </div>
    </div>
  );
}

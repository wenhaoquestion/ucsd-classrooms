import { ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  DisplayMode,
  IndoorScene,
  IntroMode,
} from "../../explorer3d/IndoorScene";
import { BuildingDatum } from "../../lib/buildings";
import { loadCampus } from "../../lib/indoor/campus";
import { RoomMeeting } from "../../lib/coursesToClassrooms";
import {
  IndoorIndex,
  navigationKeyForRoom,
  roomForKey,
} from "../../lib/indoor/roomMapping";
import {
  getIndoorStatuses,
  getRoomStatus,
  ROOM_STATUS_TEXT,
  RoomStatusKind,
  ScheduleAvailability,
} from "../../lib/indoor/roomStatus";
import { GeometryStatus, INSTRUCTIONAL_ROOM_TYPES } from "../../lib/indoor/schema";
import { IndoorLayoutState } from "../../lib/indoor/useIndoorLayout";
import { toViewTerm, useMoment } from "../../lib/moment-context";
import { useStableCallback } from "../../lib/useStable";
import { OnView } from "../../lib/View";
import { CloseIcon } from "../icons/CloseIcon";
import { Link, navigate } from "../Link";
import { closeBuildingBack } from "../building/backHandlers";
import "./explorer.css";

/** Same glyphs as the 3D labels (kept here so the main bundle doesn't import three.js). */
const STATUS_GLYPHS: Record<RoomStatusKind, string> = {
  "in-use": "●",
  soon: "◐",
  "no-class-now": "○",
  listed: "◆",
  "none-listed": "–",
  unknown: "?",
  "not-tracked": "",
  bookable: "○",
  booked: "●",
  closed: "–",
};

/** Short legend labels; the rest use the full status text. */
const LEGEND_TEXT: Partial<Record<RoomStatusKind, string>> = {
  "in-use": "In use",
  soon: "Starts soon",
  "no-class-now": "Free",
  "none-listed": "No classes",
};

export type ExplorerIntro = "rise" | "fade";

/**
 * Replaces the schedule-derived room states, for buildings whose rooms are
 * reserved rather than scheduled (Geisel's study rooms).
 */
export type ExplorerBooking = {
  /** Geometry rooms that can be selected. */
  selectable: ReadonlySet<string>;
  statuses: ReadonlyMap<string, RoomStatusKind>;
  /** Geometry room that shows a room key (a room, or the block it's in). */
  roomIdForKey: (key: string | null) => string | null;
  /** Room key to navigate to when a geometry room is picked. */
  keyForRoom: (roomId: string) => string;
  /** Selection bar content for a selected geometry room. */
  renderSelection: (roomId: string) => ReactNode;
  floorBadges: ReadonlyMap<string, string>;
  legend: readonly RoomStatusKind[];
  legendNote: string;
  hint: string;
};

const PROVENANCE_LABELS: Record<GeometryStatus, string> = {
  "source-traced": "Traced from floor maps",
  "facilities-plan": "UCSD Facilities floor plans",
  "exterior-shell": "Exterior only, from the campus map",
  "schematic-demo": "Schematic demo, not the real layout",
};

/** If the scene becomes ready this long after opening, just fade it in. */
const LATE_INTRO_MS = 1200;

type EngineState =
  | { type: "loading" }
  | { type: "ready"; scene: IndoorScene }
  | { type: "webgl-error"; message: string }
  | { type: "code-error" }
  | { type: "context-lost" };

function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export type BuildingExplorerProps = {
  building: BuildingDatum;
  room: string | null;
  rooms: Record<string, RoomMeeting[]>;
  availability: ScheduleAvailability;
  layout: IndoorLayoutState;
  /** Whether the panel is visible. */
  active: boolean;
  intro: ExplorerIntro;
  hoveredRoom: string | null;
  onHoverRoom_s: (room: string | null) => void;
  /** Bumped when surrounding layout moves the stage (e.g. side panel). */
  layoutKey: string;
  booking?: ExplorerBooking;
};

export function BuildingExplorer({
  building,
  room,
  rooms,
  availability,
  layout,
  active,
  intro,
  hoveredRoom,
  onHoverRoom_s,
  layoutKey,
  booking,
}: BuildingExplorerProps) {
  const moment = useMoment();
  const onView = useContext(OnView);
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<IndoorScene | null>(null);
  const [engine, setEngine] = useState<EngineState>({ type: "loading" });
  const [display, setDisplay] = useState<DisplayMode>({ floor: null, exploded: false });
  const [displayFor, setDisplayFor] = useState<IndoorIndex | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showViewTools, setShowViewTools] = useState(false);
  const [showFloorMap, setShowFloorMap] = useState(true);
  const activatedAt = useRef(0);
  /** Room most recently picked in 3D, so selecting it doesn't move the camera. */
  const pickedInScene = useRef<string | null>(null);

  const index: IndoorIndex | null = layout.type === "ready" ? layout.index : null;
  const shell = index?.building.geometryStatus === "exterior-shell";
  // Only exterior shells open exploded. Detailed buildings, including Geisel,
  // start stacked; subsequent choices persist for this loaded layout.
  if (index && index !== displayFor) {
    setDisplayFor(index);
    setDisplay({ floor: null, exploded: shell });
  }

  const scheduleSelectable = useMemo(() => {
    const ids = new Set<string>();
    if (index) {
      for (const geometryRoom of index.roomsById.values()) {
        if (
          index.scheduleKeyByRoomId.has(geometryRoom.id) ||
          INSTRUCTIONAL_ROOM_TYPES.has(geometryRoom.type)
        ) {
          ids.add(geometryRoom.id);
        }
      }
    }
    return ids;
  }, [index]);
  const selectable = booking?.selectable ?? scheduleSelectable;

  /** The geometry room that shows a room key. */
  const geometryFor = (key: string | null) => {
    if (!index) {
      return null;
    }
    if (booking) {
      const id = booking.roomIdForKey(key);
      return id ? index.roomsById.get(id) ?? null : null;
    }
    return roomForKey(index, key);
  };
  const selectedRoom = geometryFor(room);
  /** Rooms with a known floor but no position on it. */
  const unplaced = index && room ? index.unplacedByKey.get(room) : undefined;

  const handleSelect_s = useStableCallback((roomId: string) => {
    const geometryRoom = index?.roomsById.get(roomId);
    if (!index || !geometryRoom) {
      return;
    }
    pickedInScene.current = roomId;
    navigate(onView, {
      view: {
        type: "building",
        building: building.code,
        room: booking ? booking.keyForRoom(roomId) : navigationKeyForRoom(index, geometryRoom),
        term: toViewTerm(moment),
      },
    });
  });
  const handleHover_s = useStableCallback((roomId: string | null) => {
    const geometryRoom = roomId ? index?.roomsById.get(roomId) : null;
    onHoverRoom_s(
      index && geometryRoom
        ? booking
          ? booking.keyForRoom(geometryRoom.id)
          : navigationKeyForRoom(index, geometryRoom)
        : null
    );
  });
  const handleFloorTag_s = useStableCallback((floorId: string) => {
    setDisplay((display) => ({ ...display, floor: floorId }));
  });

  // Create the scene once the layout is loaded; three.js is loaded lazily
  useEffect(() => {
    const stage = stageRef.current;
    const labelLayer = labelsRef.current;
    if (!index || !stage || !labelLayer) {
      return;
    }
    let cancelled = false;
    let scene: IndoorScene | null = null;
    setEngine({ type: "loading" });
    import("../../explorer3d/IndoorScene").then(
      ({ createIndoorScene }) => {
        if (cancelled) {
          return;
        }
        try {
          scene = createIndoorScene({
            stage,
            labelLayer,
            layout: index.building,
            selectable,
            reducedMotion: prefersReducedMotion(),
            onSelect: handleSelect_s,
            onHover: handleHover_s,
            onFloorTag: handleFloorTag_s,
            onIntroEnd: () => setIntroDone(true),
            onContextChange: (lost) => {
              if (!cancelled && scene) {
                setEngine(lost ? { type: "context-lost" } : { type: "ready", scene });
              }
            },
          });
        } catch (error) {
          setEngine({ type: "webgl-error", message: String(error) });
          return;
        }
        sceneRef.current = scene;
        setEngine({ type: "ready", scene });
      },
      () => {
        if (!cancelled) {
          setEngine({ type: "code-error" });
        }
      }
    );
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [index, selectable, handleSelect_s, handleHover_s, handleFloorTag_s]);

  // A cached dynamic import can batch loading -> ready into one React commit.
  // Depend on the scene itself so every replacement is activated and configured.
  const readyScene = engine.type === "ready" ? engine.scene : null;

  // Neighboring buildings, for buildings placed on the campus map
  useEffect(() => {
    if (!readyScene || !index?.building.geo) {
      return;
    }
    let current = true;
    loadCampus().then(
      (campus) => {
        if (current) {
          readyScene.setContext(campus);
        }
      },
      () => {
        // Context is decoration; the model works without it
      }
    );
    return () => {
      current = false;
    };
  }, [readyScene, index]);

  // Unplaced classrooms can't be colored in 3D, so their floor's tag counts them
  const scheduleBadges = useMemo(() => {
    const badges = new Map<string, string>();
    if (!index || booking) {
      return badges;
    }
    const counts = new Map<string, { rooms: number; busy: number }>();
    for (const [key, meetings] of Object.entries(rooms)) {
      const floor = index.unplacedByKey.get(key)?.floor.id;
      if (!floor) {
        continue;
      }
      const count = counts.get(floor) ?? { rooms: 0, busy: 0 };
      count.rooms++;
      if (getRoomStatus(meetings, moment, availability, true).kind === "in-use") {
        count.busy++;
      }
      counts.set(floor, count);
    }
    for (const [floor, { rooms: total, busy }] of counts) {
      badges.set(
        floor,
        `${total}${shell ? "" : " unplaced"} classroom${total === 1 ? "" : "s"}${
          moment.type === "term" ? "" : busy > 0 ? ` · ● ${busy} in use` : " · ○ none in use"
        }`
      );
    }
    return badges;
  }, [shell, index, rooms, moment, availability, booking]);
  const floorBadges = booking?.floorBadges ?? scheduleBadges;
  useEffect(() => {
    if (readyScene) {
      readyScene.setFloorBadges(floorBadges);
    }
  }, [readyScene, floorBadges]);

  // Statuses follow the selected date/time
  const scheduleStatuses = useMemo(
    () =>
      index && !booking
        ? new Map(
            [...getIndoorStatuses(index, rooms, moment, availability)].map(
              ([id, status]) => [id, status.kind]
            )
          )
        : null,
    [index, rooms, moment, availability, booking]
  );
  const statuses = booking?.statuses ?? scheduleStatuses;
  useEffect(() => {
    if (readyScene && statuses) {
      readyScene.setStatuses(statuses);
    }
  }, [readyScene, statuses]);

  // Show/hide with the panel; (re)play the intro whenever it opens
  useEffect(() => {
    if (active) {
      activatedAt.current = performance.now();
    }
  }, [active]);
  useEffect(() => {
    const scene = readyScene;
    if (!scene) {
      return;
    }
    if (active) {
      const late = performance.now() - activatedAt.current > LATE_INTRO_MS;
      const mode: IntroMode = intro === "rise" && !late ? "rise" : "fade";
      setIntroDone(false);
      scene.activate(mode);
      return () => scene.deactivate();
    }
    // `intro` is read only when (re)activating, so it isn't a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyScene, active]);

  // A selected room's floor becomes the visible floor
  const selectedFloor = selectedRoom?.floor ?? unplaced?.floor.id ?? null;
  useEffect(() => {
    if (selectedFloor) {
      setDisplay((display) =>
        (display.exploded && display.floor === null) || display.floor === selectedFloor
          ? display
          : { ...display, floor: selectedFloor }
      );
    }
  }, [selectedFloor, index]);

  useEffect(() => {
    if (readyScene) {
      readyScene.setDisplay(display);
    }
  }, [readyScene, display]);

  useEffect(() => {
    if (readyScene) readyScene.setPlanVisible(showFloorMap);
  }, [readyScene, showFloorMap]);

  const selectedId = selectedRoom?.id ?? null;
  useEffect(() => {
    if (readyScene) {
      const picked = pickedInScene.current === selectedId;
      pickedInScene.current = null;
      readyScene.setSelected(selectedId, !picked);
    }
  }, [readyScene, selectedId]);

  const hoveredId = geometryFor(hoveredRoom)?.id ?? null;
  useEffect(() => {
    if (readyScene) {
      readyScene.setHovered(hoveredId);
    }
  }, [readyScene, hoveredId]);

  useEffect(() => {
    readyScene?.nudge();
  }, [layoutKey, readyScene]);

  const floors = index ? [...index.building.floors].reverse() : [];
  const reduceMotion = prefersReducedMotion();
  const message =
    layout.type === "error"
      ? `${layout.error.message} The room list still works.`
      : engine.type === "webgl-error"
      ? "The 3D view isn't available on this device or browser (WebGL couldn't start). The room list and schedules still work."
      : engine.type === "code-error"
      ? "The 3D viewer failed to load. Check your connection; the room list still works."
      : engine.type === "context-lost"
      ? "The 3D view was interrupted by the graphics driver. It will resume if the browser restores it; the room list still works."
      : null;
  const loading = !message && (layout.type === "loading" || engine.type === "loading");
  const unmappedRoom = room !== null && index && !selectedRoom && !unplaced ? room : null;
  const unmappedReason =
    unmappedRoom &&
    index?.building.knownUnmapped?.find((entry) => entry.scheduleKey === unmappedRoom)
      ?.reason;
  const statusSummary = selectedRoom && statuses?.get(selectedRoom.id);

  return (
    <section
      className={`explorer ${introDone || !active ? "explorer-intro-done" : ""}`}
      aria-label={`${building.code} indoor map`}
    >
      <header className="explorer-toolbar">
        <div className="explorer-title">
          <span className="explorer-code">{building.code}</span>
          <span className="explorer-name">{building.name}</span>
        </div>
        <Link
          view={{ type: "default" }}
          className="explorer-close"
          back={closeBuildingBack(room)}
          aria-label="Close building and return to map"
          title="Close"
        >
          <CloseIcon />
        </Link>
      </header>
      <div className="explorer-viewport">
        <div className={`explorer-stage${showFloorMap && display.floor && index?.floorsById.get(display.floor)?.planDrawing ? " explorer-with-plan" : ""}`} ref={stageRef}>
          <div className="explorer-labels" ref={labelsRef} />
        </div>
        {index && !message && (
          <div className="explorer-floors" role="group" aria-label="Floors">
            <button
              className="explorer-floor-btn"
              aria-pressed={display.floor === null}
              onClick={() => setDisplay((display) => ({ ...display, floor: null }))}
              title="Show all floors"
            >
              All
            </button>
            {floors.map((floor) => (
              <button
                key={floor.id}
                className="explorer-floor-btn"
                aria-pressed={display.floor === floor.id}
                aria-label={floor.label}
                title={floor.label}
                onClick={() =>
                  setDisplay((display) => ({ ...display, floor: floor.id }))
                }
              >
                {floor.shortLabel}
              </button>
            ))}
          </div>
        )}
        {index && !message && (
          <div className="explorer-view-controls" role="group" aria-label="View">
            {display.floor && index.floorsById.get(display.floor)?.planDrawing && (
              <>
                <button className="explorer-view-btn" aria-pressed={showFloorMap}
                  onClick={() => setShowFloorMap((shown) => !shown)}
                  title="Show the library's original floor map beneath the 3D details">
                  Floor map
                </button>
                <button className="explorer-view-btn" onClick={() => sceneRef.current?.topView()}
                  title="Look straight down at this floor">
                  Top view
                </button>
              </>
            )}
            <button
              className="explorer-view-btn explorer-explode-btn"
              aria-pressed={display.exploded}
              onClick={() =>
                setDisplay((display) => ({ ...display, exploded: !display.exploded }))
              }
              title="Separate floors vertically"
            >
              Exploded
            </button>
            {showViewTools && (
              <>
                <button
                  className="explorer-view-btn"
                  onClick={() => sceneRef.current?.rotate(-30)}
                  aria-label="Rotate left"
                  title="Rotate left"
                >
                  ⟲
                </button>
                <button
                  className="explorer-view-btn"
                  onClick={() => sceneRef.current?.rotate(30)}
                  aria-label="Rotate right"
                  title="Rotate right"
                >
                  ⟳
                </button>
                <button
                  className="explorer-view-btn"
                  onClick={() => sceneRef.current?.zoom(0.8)}
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  +
                </button>
                <button
                  className="explorer-view-btn"
                  onClick={() => sceneRef.current?.zoom(1.25)}
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  −
                </button>
              </>
            )}
            <button
              className="explorer-view-btn"
              onClick={() => sceneRef.current?.resetView()}
              title="Reset view"
            >
              Reset
            </button>
            <button
              className="explorer-view-btn"
              aria-expanded={showViewTools}
              aria-label={showViewTools ? "Fewer view controls" : "More view controls"}
              title={showViewTools ? "Fewer view controls" : "Rotate and zoom buttons"}
              onClick={() => setShowViewTools((show) => !show)}
            >
              {showViewTools ? "›" : "⋯"}
            </button>
          </div>
        )}
        {loading && (
          <p className="explorer-message explorer-loading" role="status">
            {reduceMotion ? "Loading indoor map…" : "Loading indoor map"}
          </p>
        )}
        {message && (
          <p className="explorer-message" role="alert">
            {message}
          </p>
        )}
        {!message && index && (
          <p className="explorer-selection" role="status" aria-live="polite">
            {unmappedRoom ? (
              <>
                <strong>
                  {building.code} {unmappedRoom}
                </strong>
                : indoor location not mapped yet.
                {unmappedReason ? ` ${unmappedReason}` : ""}
              </>
            ) : unplaced ? (
              <>
                <strong>
                  {building.code} {room}
                </strong>
                {` · ${unplaced.room.basis === "room-number" ? "probably " : ""}${
                  unplaced.floor.label
                }; position on the floor not mapped`}
              </>
            ) : selectedRoom && booking ? (
              booking.renderSelection(selectedRoom.id)
            ) : selectedRoom ? (
              <>
                <strong>
                  {building.code} {selectedRoom.label}
                </strong>
                {selectedRoom.name ? ` · ${selectedRoom.name}` : ""} ·{" "}
                {index.floorsById.get(selectedRoom.floor)?.label}
                {statusSummary ? ` · ${ROOM_STATUS_TEXT[statusSummary]}` : ""}
              </>
            ) : booking ? (
              booking.hint
            ) : shell ? (
              "Exterior from the campus map. Pick a floor or a room in the list."
            ) : (
              "Drag to rotate, pinch or scroll to zoom. Tap a room for its schedule."
            )}
          </p>
        )}
      </div>
      {index && !message && (
        <footer className="explorer-footer">
          {!shell && (
            <ul className="explorer-legend" aria-label="Room color legend">
              {(booking
                ? booking.legend
                : moment.type === "term"
                ? (["listed", "none-listed", "unknown"] as const)
                : availability === "complete"
                ? (["in-use", "soon", "no-class-now", "none-listed"] as const)
                : (["in-use", "soon", "no-class-now", "none-listed", "unknown"] as const)
              ).map((kind) => (
                <li key={kind} className="explorer-legend-item" data-status={kind}>
                  <span className="explorer-swatch" aria-hidden="true">
                    {STATUS_GLYPHS[kind]}
                  </span>
                  {LEGEND_TEXT[kind] ?? ROOM_STATUS_TEXT[kind]}
                </li>
              ))}
              <li className="explorer-legend-note">
                {booking ? booking.legendNote : "From class schedules, not live occupancy"}
              </li>
            </ul>
          )}
          <div className="explorer-provenance">
            <button
              className="explorer-text-btn"
              aria-expanded={showSources}
              onClick={() => setShowSources((show) => !show)}
            >
              {PROVENANCE_LABELS[index.building.geometryStatus]}
            </button>
            {showSources && (
              <div className="explorer-sources">
                <p>{index.building.provenance}</p>
                {index.building.geometryStatus === "source-traced" && (
                  <p>
                    {index.building.floors.some((floor) => floor.vertical.estimated)
                      ? "Some floor elevations and heights are estimated. "
                      : "Floor elevations and heights follow the cited sources. "}
                    Exploded spacing, room and furniture heights, and access symbols are illustrative.
                    {index.building.coordinateSystem.northDeg !== null &&
                      ` North is about ${index.building.coordinateSystem.northDeg}° clockwise from the top of the source maps.`}
                  </p>
                )}
                <ul>
                  {index.building.sources.map((source) => (
                    <li key={source.id}>
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noreferrer" className="link">
                          {source.title}
                        </a>
                      ) : (
                        <span>{source.title}</span>
                      )}{" "}
                      <span className="explorer-source-meta">
                        (accessed {source.accessed})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </footer>
      )}
    </section>
  );
}

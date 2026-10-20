import { useContext, useEffect, useMemo, useRef, useState } from "react";
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
};

export type ExplorerIntro = "rise" | "fade";

const PROVENANCE_LABELS: Record<GeometryStatus, string> = {
  "source-traced": "Traced from public floor maps",
  "facilities-plan": "UCSD Facilities floor plans",
  "exterior-shell": "Exterior only, from the campus map",
  "schematic-demo": "Schematic demo, not the real layout",
};

/** If the scene becomes ready this long after opening, just fade it in. */
const LATE_INTRO_MS = 1200;

type EngineState =
  | { type: "loading" }
  | { type: "ready" }
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
  onDisable_s: () => void;
  /** Bumped when surrounding layout moves the stage (e.g. side panel). */
  layoutKey: string;
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
  onDisable_s,
  layoutKey,
}: BuildingExplorerProps) {
  const moment = useMoment();
  const onView = useContext(OnView);
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<IndoorScene | null>(null);
  const [engine, setEngine] = useState<EngineState>({ type: "loading" });
  const [display, setDisplay] = useState<DisplayMode>({ floor: null, exploded: false });
  const [explodedFor, setExplodedFor] = useState<IndoorIndex | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const activatedAt = useRef(0);
  /** Room most recently picked in 3D, so selecting it doesn't move the camera. */
  const pickedInScene = useRef<string | null>(null);

  const index: IndoorIndex | null = layout.type === "ready" ? layout.index : null;
  const shell = index?.building.geometryStatus === "exterior-shell";
  // Shells open exploded: separated floors are what they show best
  if (shell && index !== explodedFor) {
    setExplodedFor(index);
    setDisplay((display) => ({ ...display, exploded: true }));
  }

  const selectable = useMemo(() => {
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

  const selectedRoom = index ? roomForKey(index, room) : null;
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
        room: navigationKeyForRoom(index, geometryRoom),
        term: toViewTerm(moment),
      },
    });
  });
  const handleHover_s = useStableCallback((roomId: string | null) => {
    const geometryRoom = roomId ? index?.roomsById.get(roomId) : null;
    onHoverRoom_s(index && geometryRoom ? navigationKeyForRoom(index, geometryRoom) : null);
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
            onContextChange: (lost) =>
              setEngine(lost ? { type: "context-lost" } : { type: "ready" }),
          });
        } catch (error) {
          setEngine({ type: "webgl-error", message: String(error) });
          return;
        }
        sceneRef.current = scene;
        setEngine({ type: "ready" });
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

  const sceneReady = engine.type === "ready";

  // Neighboring buildings, for buildings placed on the campus map
  useEffect(() => {
    if (!sceneReady || !index?.building.geo) {
      return;
    }
    let current = true;
    loadCampus().then(
      (campus) => {
        if (current) {
          sceneRef.current?.setContext(campus);
        }
      },
      () => {
        // Context is decoration; the model works without it
      }
    );
    return () => {
      current = false;
    };
  }, [sceneReady, index]);

  // Unplaced classrooms can't be colored in 3D, so their floor's tag counts them
  const floorBadges = useMemo(() => {
    const badges = new Map<string, string>();
    if (!index) {
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
  }, [shell, index, rooms, moment, availability]);
  useEffect(() => {
    if (sceneReady) {
      sceneRef.current?.setFloorBadges(floorBadges);
    }
  }, [sceneReady, floorBadges]);

  // Statuses follow the selected date/time
  const statuses = useMemo(
    () =>
      index
        ? new Map(
            [...getIndoorStatuses(index, rooms, moment, availability)].map(
              ([id, status]) => [id, status.kind]
            )
          )
        : null,
    [index, rooms, moment, availability]
  );
  useEffect(() => {
    if (sceneReady && statuses) {
      sceneRef.current?.setStatuses(statuses);
    }
  }, [sceneReady, statuses]);

  // Show/hide with the panel; (re)play the intro whenever it opens
  useEffect(() => {
    if (active) {
      activatedAt.current = performance.now();
    }
  }, [active]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!sceneReady || !scene) {
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
  }, [sceneReady, active]);

  // A selected room's floor becomes the visible floor
  const selectedFloor = selectedRoom?.floor ?? unplaced?.floor.id ?? null;
  useEffect(() => {
    if (selectedFloor) {
      setDisplay((display) =>
        display.exploded || display.floor === selectedFloor
          ? display
          : { ...display, floor: selectedFloor }
      );
    }
  }, [selectedFloor]);

  useEffect(() => {
    if (sceneReady) {
      sceneRef.current?.setDisplay(display);
    }
  }, [sceneReady, display]);

  const selectedId = selectedRoom?.id ?? null;
  useEffect(() => {
    if (sceneReady) {
      const picked = pickedInScene.current === selectedId;
      pickedInScene.current = null;
      sceneRef.current?.setSelected(selectedId, !picked);
    }
  }, [sceneReady, selectedId]);

  const hoveredId = (index && roomForKey(index, hoveredRoom)?.id) ?? null;
  useEffect(() => {
    if (sceneReady) {
      sceneRef.current?.setHovered(hoveredId);
    }
  }, [sceneReady, hoveredId]);

  useEffect(() => {
    sceneRef.current?.nudge();
  }, [layoutKey]);

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
        <button
          className="explorer-text-btn"
          onClick={onDisable_s}
          title="Hide the 3D view and use the room list"
        >
          List only
        </button>
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
        <div className="explorer-stage" ref={stageRef}>
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
            <button
              className="explorer-view-btn"
              onClick={() => sceneRef.current?.resetView()}
              title="Reset view"
            >
              Reset
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
            ) : selectedRoom ? (
              <>
                <strong>
                  {building.code} {selectedRoom.label}
                </strong>
                {selectedRoom.name ? ` · ${selectedRoom.name}` : ""} ·{" "}
                {index.floorsById.get(selectedRoom.floor)?.label}
                {statusSummary ? ` · ${ROOM_STATUS_TEXT[statusSummary]}` : ""}
              </>
            ) : shell ? (
              "Exterior from the campus map. Pick a floor or a room in the list."
            ) : (
              "Drag to orbit, scroll or pinch to zoom. Select a highlighted room to see its schedule."
            )}
          </p>
        )}
      </div>
      {index && !message && (
        <footer className="explorer-footer">
          {!shell && (
            <ul className="explorer-legend" aria-label="Room color legend">
              {(moment.type === "term"
                ? (["listed", "none-listed", "unknown"] as const)
                : (["in-use", "soon", "no-class-now", "none-listed", "unknown"] as const)
              ).map((kind) => (
                <li key={kind} className="explorer-legend-item" data-status={kind}>
                  <span className="explorer-swatch" aria-hidden="true">
                    {STATUS_GLYPHS[kind]}
                  </span>
                  {kind === "no-class-now" ? "Available (no class listed now)" : ROOM_STATUS_TEXT[kind]}
                </li>
              ))}
              <li className="explorer-legend-note">
                From class schedules, not live occupancy.
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
                    Floor heights and exact dimensions are not in the sources, so
                    vertical spacing is illustrative.
                    {index.building.coordinateSystem.northDeg !== null &&
                      ` North is about ${index.building.coordinateSystem.northDeg}° clockwise from the top of the source maps.`}
                  </p>
                )}
                <ul>
                  {index.building.sources
                    .filter((source) => source.url)
                    .map((source) => (
                      <li key={source.id}>
                        <a href={source.url} target="_blank" rel="noreferrer" className="link">
                          {source.title}
                        </a>{" "}
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

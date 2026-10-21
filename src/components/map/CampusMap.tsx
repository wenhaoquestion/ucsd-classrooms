import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildings } from "../../lib/buildings";
import { RoomMeeting, TermBuildings } from "../../lib/coursesToClassrooms";
import { startLocating, useUserLocation } from "../../lib/geolocation";
import { hasIndoorLayout } from "../../lib/indoor/manifest";
import {
  MAP_ZOOM,
  mapPoint,
  mapPosition,
  northeast,
  PADDING,
  southwest,
  ZOOM,
} from "../../lib/locations";
import { BuildingButton } from "../BuildingButton";

/** Unzoomed size of the scrollable map, in px. */
const MAP_WIDTH = northeast.x - southwest.x + PADDING.horizontal * 2;
const MAP_HEIGHT = southwest.y - northeast.y + PADDING.top + PADDING.bottom;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const BUTTON_ZOOM_STEP = 1.5;
const ZOOM_ANIMATION_MS = 220;
/** Mercator world width at the map's scale, used for meters per pixel. */
const WORLD_PX = 2 ** (8 + ZOOM) * MAP_ZOOM;
const EARTH_CIRCUMFERENCE_M = 40_075_016;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Zoom bands, so markers can simplify as they crowd together. */
function zoomBand(zoom: number): string {
  return zoom < 0.55 ? "far" : zoom < 0.85 ? "mid" : "near";
}

export type CampusMapProps = {
  termBuildings?: TermBuildings;
  selected: string | null;
  scrollTo: { building: string; init: boolean };
  explorerEnabled: boolean;
  freeRoomsOpen: boolean;
  onToggleFreeRooms: () => void;
};

export function CampusMap({
  termBuildings,
  selected,
  scrollTo,
  explorerEnabled,
  freeRoomsOpen,
  onToggleFreeRooms,
}: CampusMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  /** The live zoom, written straight to a CSS variable to keep gestures cheap. */
  const zoomRef = useRef(1);
  const animation = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(MIN_ZOOM);
  const userLocation = useUserLocation();
  const [followPending, setFollowPending] = useState(false);

  /**
   * Sets the zoom so that `content` (unzoomed map px) lands at `screen` (px
   * from the scroller's top left).
   */
  const applyZoom = (
    next: number,
    content: { x: number; y: number },
    screen: { x: number; y: number }
  ) => {
    const scroller = ref.current;
    if (!scroller) {
      return;
    }
    const fit = Math.min(scroller.clientWidth / MAP_WIDTH, scroller.clientHeight / MAP_HEIGHT);
    const zoom = clamp(next, Math.max(MIN_ZOOM, Math.min(fit, 1)), MAX_ZOOM);
    zoomRef.current = zoom;
    scroller.style.setProperty("--map-zoom", `${zoom}`);
    scroller.dataset.zoom = zoomBand(zoom);
    // Setting the scroll position forces layout at the new size
    scroller.scrollLeft = content.x * zoom - screen.x;
    scroller.scrollTop = content.y * zoom - screen.y;
    setZoom(zoom);
  };

  /** Zooms around a point on screen (client coordinates), keeping it fixed. */
  const zoomAt = (next: number, clientX?: number, clientY?: number) => {
    const scroller = ref.current;
    if (!scroller) {
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const screen = {
      x: clientX === undefined ? scroller.clientWidth / 2 : clientX - rect.left,
      y: clientY === undefined ? scroller.clientHeight / 2 : clientY - rect.top,
    };
    const zoom = zoomRef.current;
    const content = {
      x: (scroller.scrollLeft + screen.x) / zoom,
      y: (scroller.scrollTop + screen.y) / zoom,
    };
    applyZoom(next, content, screen);
  };

  const animateZoom = (factor: number, clientX?: number, clientY?: number) => {
    cancelAnimationFrame(animation.current);
    const from = zoomRef.current;
    const to = from * factor;
    if (prefersReducedMotion()) {
      zoomAt(to, clientX, clientY);
      return;
    }
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min((now - start) / ZOOM_ANIMATION_MS, 1);
      const eased = 1 - (1 - t) ** 3;
      // Interpolate in log space so zooming in and out feel symmetric
      zoomAt(from * (to / from) ** eased, clientX, clientY);
      if (t < 1) {
        animation.current = requestAnimationFrame(frame);
      }
    };
    animation.current = requestAnimationFrame(frame);
  };

  /** Scrolls so a map-space point is centered in the area above the panels. */
  const centerOn = (point: { x: number; y: number }) => {
    const scroller = ref.current;
    if (!scroller) {
      return;
    }
    const zoom = zoomRef.current;
    scroller.scrollTo({
      left: point.x * zoom - scroller.clientWidth / 2,
      top: point.y * zoom - scroller.clientHeight / 2,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  useLayoutEffect(() => {
    const scroller = ref.current;
    if (!scroller) {
      return;
    }
    scroller.style.setProperty("--map-zoom", "1");
    scroller.dataset.zoom = zoomBand(1);
    const updateMin = () =>
      setMinZoom(
        Math.max(
          MIN_ZOOM,
          Math.min(scroller.clientWidth / MAP_WIDTH, scroller.clientHeight / MAP_HEIGHT, 1)
        )
      );
    updateMin();
    const observer = new ResizeObserver(updateMin);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Pinch, trackpad pinch (ctrl + wheel), and Safari gesture events. These need
  // non-passive listeners to stop the browser zooming the whole page.
  useEffect(() => {
    const scroller = ref.current;
    if (!scroller) {
      return;
    }
    let pinch: {
      distance: number;
      zoom: number;
      content: { x: number; y: number };
    } | null = null;
    let gestureZoom = 1;
    const midpoint = (touches: TouchList) => {
      const rect = scroller.getBoundingClientRect();
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2 - rect.left,
        y: (touches[0].clientY + touches[1].clientY) / 2 - rect.top,
      };
    };
    const spread = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        cancelAnimationFrame(animation.current);
        const screen = midpoint(e.touches);
        const zoom = zoomRef.current;
        pinch = {
          distance: spread(e.touches) || 1,
          zoom,
          content: {
            x: (scroller.scrollLeft + screen.x) / zoom,
            y: (scroller.scrollTop + screen.y) / zoom,
          },
        };
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        // Keeps the point between the fingers under them, so this pans too
        applyZoom(
          (pinch.zoom * spread(e.touches)) / pinch.distance,
          pinch.content,
          midpoint(e.touches)
        );
      }
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinch = null;
      }
    };
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        cancelAnimationFrame(animation.current);
        zoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      }
    };
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      gestureZoom = zoomRef.current;
    };
    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      // iOS also fires touch events for the same pinch
      if (!pinch) {
        const gesture = e as GestureEvent;
        zoomAt(gestureZoom * gesture.scale, gesture.clientX, gesture.clientY);
      }
    };

    scroller.addEventListener("touchstart", handleTouchStart, { passive: true });
    scroller.addEventListener("touchmove", handleTouchMove, { passive: false });
    scroller.addEventListener("touchend", handleTouchEnd);
    scroller.addEventListener("touchcancel", handleTouchEnd);
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    scroller.addEventListener("gesturestart", handleGestureStart);
    scroller.addEventListener("gesturechange", handleGestureChange);
    return () => {
      scroller.removeEventListener("touchstart", handleTouchStart);
      scroller.removeEventListener("touchmove", handleTouchMove);
      scroller.removeEventListener("touchend", handleTouchEnd);
      scroller.removeEventListener("touchcancel", handleTouchEnd);
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("gesturestart", handleGestureStart);
      scroller.removeEventListener("gesturechange", handleGestureChange);
    };
    // The handlers only touch refs and stable state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const located = userLocation.type === "located" ? userLocation : null;
  const userPoint = located ? mapPoint(located.location) : null;
  const userOnMap =
    !!userPoint &&
    userPoint.x >= 0 &&
    userPoint.y >= 0 &&
    userPoint.x <= MAP_WIDTH &&
    userPoint.y <= MAP_HEIGHT;

  // Center on the first fix after the user asks to be located
  useEffect(() => {
    if (!followPending || !userPoint) {
      return;
    }
    setFollowPending(false);
    if (userOnMap) {
      centerOn(userPoint);
    }
    // centerOn only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followPending, userPoint?.x, userPoint?.y, userOnMap]);

  const roomsByBuilding = useMemo(() => {
    const rooms: Record<string, RoomMeeting[][]> = {};
    for (const [code, building] of Object.entries(termBuildings ?? {})) {
      rooms[code] = Object.values(building);
    }
    return rooms;
  }, [termBuildings]);

  const offCampus = !!located && !userOnMap;
  const metersPerPixel = located
    ? (EARTH_CIRCUMFERENCE_M * Math.cos((located.location[0] * Math.PI) / 180)) / WORLD_PX
    : 1;

  return (
    <>
      <div
        className="buildings"
        ref={ref}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest(".building-btn")) {
            animateZoom(BUTTON_ZOOM_STEP, e.clientX, e.clientY);
          }
        }}
      >
        <div
          className="scroll-area"
          style={{
            width: `calc(${MAP_WIDTH}px * var(--map-zoom))`,
            height: `calc(${MAP_HEIGHT}px * var(--map-zoom))`,
            backgroundSize: `calc(${mapPosition.width}px * var(--map-zoom))`,
            backgroundPosition: `calc(${mapPosition.x}px * var(--map-zoom)) calc(${mapPosition.y}px * var(--map-zoom))`,
          }}
        />
        {userPoint && userOnMap && (
          <div
            className="user-location"
            style={{
              left: `calc(${userPoint.x}px * var(--map-zoom))`,
              top: `calc(${userPoint.y}px * var(--map-zoom))`,
            }}
            aria-label="Your location"
            role="img"
          >
            <span
              className="user-location-accuracy"
              style={{
                width: `calc(${(2 * (located?.accuracy ?? 0)) / metersPerPixel}px * var(--map-zoom))`,
                height: `calc(${(2 * (located?.accuracy ?? 0)) / metersPerPixel}px * var(--map-zoom))`,
              }}
            />
          </div>
        )}
        {Object.values(buildings).map((building) => (
          <BuildingButton
            key={building.code}
            building={building}
            rooms={roomsByBuilding[building.code] ?? NO_ROOMS}
            selected={building.code === selected}
            scrollTarget={building.code === scrollTo.building ? scrollTo : null}
            visible={!!termBuildings && building.code in termBuildings}
            explorer={explorerEnabled && hasIndoorLayout(building.code)}
          />
        ))}
      </div>
      <div className="map-controls" role="toolbar" aria-label="Map">
        <div className="map-control-group">
          <button
            className="map-control"
            onClick={() => animateZoom(BUTTON_ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM - 0.001}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
              <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
            </svg>
          </button>
          <button
            className="map-control"
            onClick={() => animateZoom(1 / BUTTON_ZOOM_STEP)}
            disabled={zoom <= minZoom + 0.001}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
              <path d="M5 11h14v2H5z" />
            </svg>
          </button>
        </div>
        <button
          className={`map-control ${located ? "map-control-on" : ""}`}
          onClick={() => {
            if (userPoint && userOnMap) {
              centerOn(userPoint);
            } else {
              startLocating();
              setFollowPending(true);
            }
          }}
          aria-label="Show my location"
          title={
            userLocation.type === "error"
              ? userLocation.message
              : offCampus
              ? "You seem to be off campus"
              : "Show my location"
          }
        >
          <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
            <path d="M11 1h2v3.06A8 8 0 0 1 19.94 11H23v2h-3.06A8 8 0 0 1 13 19.94V23h-2v-3.06A8 8 0 0 1 4.06 13H1v-2h3.06A8 8 0 0 1 11 4.06zm1 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
          </svg>
          {userLocation.type === "locating" && <span className="map-control-busy" />}
        </button>
        <button
          className={`map-control map-control-text ${freeRoomsOpen ? "map-control-on" : ""}`}
          onClick={onToggleFreeRooms}
          aria-pressed={freeRoomsOpen}
          disabled={!termBuildings}
          title="Classrooms with no class listed right now"
        >
          Free rooms
        </button>
        {(userLocation.type === "error" || offCampus) && (
          <p className="map-control-note" role="status">
            {userLocation.type === "error"
              ? userLocation.message
              : "You seem to be off campus."}
          </p>
        )}
      </div>
    </>
  );
}

const NO_ROOMS: RoomMeeting[][] = [];

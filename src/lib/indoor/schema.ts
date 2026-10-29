/**
 * Indoor layout schema.
 *
 * This is deliberately separate from the schedule data (`TermBuildings`). An
 * indoor layout describes where rooms are inside a building, along with where
 * that information came from and how much of it is interpretation.
 *
 * Coordinate convention (see also docs/indoor-geometry.md):
 * - Floor polygons use local `[x, z]` coordinates in `coordinateSystem.units`.
 * - `y` is vertical elevation. Physical elevations live on the floor; the extra
 *   spacing in the exploded view is a display-only offset added by the
 *   renderer and is never stored here.
 * - Source image pixels `(u, v)` (u right, v down) are converted to local
 *   coordinates by the floor's `SourceTransform`: translate by `-originPx`,
 *   rotate by `rotationDeg` (clockwise on the page), then multiply by `scale`.
 *   Image "down" therefore maps to local +z, which is toward the viewer in the
 *   default three.js camera orientation.
 * - When a plan has no reliable scale, `units` is `"relative"` and 1 unit is
 *   an arbitrary, documented fraction of the plan, never an invented meter.
 */

export const INDOOR_SCHEMA_VERSION = 1;

/** `[x, z]` in local floor coordinates. */
export type Point2 = [x: number, z: number];
/** A closed ring; the last point should NOT repeat the first. */
export type Ring = Point2[];
export type Polygon = {
  outer: Ring;
  holes?: Ring[];
};

/**
 * How well a piece of information is supported.
 * - `direct`: read directly off a source (e.g. a room number printed on a
 *   plan).
 * - `traced`: manually traced from a source drawing; relationships are
 *   supported, exact dimensions are not surveyed.
 * - `approximate`: roughly placed or simplified from a source.
 * - `unknown`: not established by any source; a display placeholder.
 */
export type Confidence = "direct" | "traced" | "approximate" | "unknown";

/**
 * - `source-traced`: geometry was traced from cited source documents.
 * - `facilities-plan`: converted from UCSD Facilities floor plans. Published
 *   layouts live in `static/indoor/facilities/` and load on demand.
 * - `exterior-shell`: generated in the browser from the campus map's
 *   footprint and height. Floors are estimated and there are no rooms;
 *   classrooms are assigned to floors by room number only.
 * - `schematic-demo`: illustrative layout that does NOT represent real room
 *   locations. Must never be presented as a real building.
 */
export type GeometryStatus =
  | "source-traced"
  | "facilities-plan"
  | "exterior-shell"
  | "schematic-demo";

export const GEOMETRY_STATUSES: readonly GeometryStatus[] = [
  "source-traced",
  "facilities-plan",
  "exterior-shell",
  "schematic-demo",
];

export type RoomType =
  | "classroom"
  | "lecture-hall"
  | "computer-lab"
  | "lab"
  | "office"
  | "conference"
  /** A bookable library study room, or a labeled block of them. */
  | "study-room"
  | "restroom"
  | "service"
  | "other"
  | "unknown";

/**
 * Room types that are presumed to host scheduled classes even without a
 * schedule key. Other rooms (e.g. research labs or conference rooms) only get
 * schedule-derived status when a schedule key maps to them.
 */
export const INSTRUCTIONAL_ROOM_TYPES: ReadonlySet<RoomType> = new Set([
  "classroom",
  "lecture-hall",
  "computer-lab",
]);

export type IndoorSource = {
  /** Stable ID referenced by `SourceRef.source`, e.g. `"CSE-S1"`. */
  id: string;
  title: string;
  /** Public URL of the document or image. */
  url?: string;
  /** Repository-relative path, if a copy is kept locally. */
  localFile?: string;
  publisher?: string;
  /** Exact building code (as used by the schedule data). */
  building: string;
  /** Floor IDs (from this file) the source covers. */
  floors: string[];
  /** 1-based PDF page, if applicable. */
  page?: number;
  /** Image name / figure reference within the document, if applicable. */
  imageRef?: string;
  /** Date the source was actually accessed, `YYYY-MM-DD`. */
  accessed: string;
  /** What the source says about north, if anything. */
  orientation?: string;
  /** What the source says about scale, if anything. */
  scale?: string;
  /** Revision / publication date shown on the source, if any. */
  revision?: string;
  notes?: string[];
};

export type SourceRef = {
  source: string;
  page?: number;
  /** Free-form pointer into the source, e.g. "upper-left quadrant". */
  region?: string;
  note?: string;
};

/** How source image pixels were converted into local floor coordinates. */
export type SourceTransform = {
  source: string;
  /** Size of the image that was traced, in pixels. */
  imageSizePx?: [width: number, height: number];
  /** Pixel that becomes local (0, 0). */
  originPx: [u: number, v: number];
  /** Clockwise rotation applied on the page before scaling, in degrees. */
  rotationDeg: number;
  /** Local units per source pixel. */
  scale: number;
  note?: string;
};

export type CoordinateSystem = {
  units: "meters" | "feet" | "relative";
  /** Human-readable description of what one unit means. */
  description: string;
  /**
   * Clockwise angle in degrees from local -z ("up" on the traced plan) to true
   * north, or `null` if unknown.
   */
  northDeg: number | null;
  northNote?: string;
};

export type VerticalInfo = {
  /** Physical base elevation of the floor, in `units`. */
  baseElevation: number;
  /** Floor-to-floor height, in `units`. */
  height: number;
  /** `true` if elevations/heights are placeholders rather than sourced. */
  estimated: boolean;
  note?: string;
};

export type IndoorRoom = {
  /** Stable geometry ID, unique within the building. */
  id: string;
  /** Label as printed on the source, as a string (keep leading zeros). */
  label: string;
  /** Name printed on the source, e.g. "Seminar Room", if any. */
  name?: string;
  /**
   * Exact schedule room key (the room string in `TermBuildings`), or `null`
   * if this room is not known to appear in the schedules.
   */
  scheduleKey: string | null;
  type: RoomType;
  /** Must equal the ID of the floor that contains this room. */
  floor: string;
  footprint: Polygon;
  /** Preferred label anchor; defaults to the polygon's centroid. */
  labelAt?: Point2;
  confidence: {
    /** Where the room sits on the floor. */
    location: Confidence;
    /** The polygon's shape and size. */
    shape: Confidence;
    /** The room number / name. */
    label: Confidence;
  };
  sources: SourceRef[];
  notes?: string[];
};

/** Corridors, lobbies, and other shared circulation areas. */
export type IndoorArea = {
  id: string;
  /**
   * - `unlabeled-room`: an enclosed, filled space with no room number shown.
   * - `not-detailed`: part of the floor the source shows without any rooms.
   */
  kind:
    | "corridor"
    | "lobby"
    | "open"
    | "courtyard"
    | "unlabeled-room"
    | "not-detailed"
    | "unknown";
  label?: string;
  footprint: Polygon;
  confidence: Confidence;
  sources: SourceRef[];
  notes?: string[];
};

/** Point features that are visible in the sources. */
export type IndoorFeature = {
  id: string;
  kind: "stairs" | "elevator" | "entrance" | "restroom";
  label?: string;
  at: Point2;
  confidence: Confidence;
  sources: SourceRef[];
  notes?: string[];
};

/** Furniture footprints traced from a plan; rendered heights are illustrative. */
export type IndoorDetail = {
  id: string;
  kind: "shelf" | "table" | "computer" | "carrel";
  footprint: Polygon;
  confidence: Confidence;
  sources: SourceRef[];
  notes?: string[];
};

/** A room known to be on a floor whose position on it isn't mapped. */
export type UnplacedRoom = {
  label: string;
  /** Exact schedule room key, or `null` if it isn't in the schedules. */
  scheduleKey: string | null;
  /**
   * - `room-number`: the floor was inferred from the room number.
   * - `floor-listing`: a source lists the room on this floor.
   */
  basis: "room-number" | "floor-listing";
  /** Area in square feet, if a source gives it. */
  areaSqft?: number;
};

export type IndoorFloor = {
  /** Stable ID, unique within the building, e.g. `"L1"` or `"B"`. */
  id: string;
  /** Display label, e.g. "Level 1" or "Basement". */
  label: string;
  /** Compact label for floor buttons, e.g. "1" or "B". */
  shortLabel: string;
  vertical: VerticalInfo;
  /**
   * Floor boundary as one or more disconnected parts. Holes can represent
   * courtyards or light wells. An empty array records a floor established only
   * by sourced `floor-listing` entries in `unplaced`; its outline confidence
   * must be `unknown`, and it must have no rooms, areas or features. It stays
   * in the room index but has no 3D representation. At least one other floor
   * in the building must have a valid outline.
   */
  outline: Polygon[];
  outlineConfidence: Confidence;
  /** Floor-specific source transform(s). */
  transforms?: SourceTransform[];
  rooms: IndoorRoom[];
  /** Rooms on this floor without geometry. */
  unplaced?: UnplacedRoom[];
  areas?: IndoorArea[];
  features?: IndoorFeature[];
  details?: IndoorDetail[];
  /** Full-page image aligned by the transform for the same source. */
  planDrawing?: { url: string; source: string };
  sources: SourceRef[];
  notes?: string[];
};

/** Explicit mapping from an alternate schedule key to a geometry room. */
export type ScheduleAlias = {
  scheduleKey: string;
  room: string;
  note: string;
};

/**
 * Places local coordinates on the campus map (see `campus.ts`): a campus point
 * `c` maps to local `rotate(c - origin, rotationDeg) * unitsPerMeter`, where the
 * rotation is clockwise as seen from above.
 */
export type GeoPlacement = {
  /** Campus point (meters) that becomes local (0, 0). */
  origin: Point2;
  rotationDeg: number;
  unitsPerMeter: number;
  /** Ground elevation (m above sea level) that local y = 0 corresponds to. */
  groundElevation: number;
  /** Campus building numbers of this building's own footprint parts. */
  caans: string[];
  /** How the placement was determined, e.g. "fitted to campus footprint". */
  note: string;
};

export type IndoorBuilding = {
  schemaVersion: typeof INDOOR_SCHEMA_VERSION;
  /** Exact building code from `buildings.json`. */
  building: string;
  name: string;
  geometryStatus: GeometryStatus;
  /** One or two sentences shown in the UI describing provenance. */
  provenance: string;
  coordinateSystem: CoordinateSystem;
  sources: IndoorSource[];
  floors: IndoorFloor[];
  scheduleAliases?: ScheduleAlias[];
  /**
   * Schedule room keys known to exist in the building but not placed (e.g. the
   * floor plan for their level wasn't found), with an explanation.
   */
  knownUnmapped?: { scheduleKey: string; reason: string }[];
  /** Where the building sits on campus, for showing neighboring buildings. */
  geo?: GeoPlacement;
  notes?: string[];
};

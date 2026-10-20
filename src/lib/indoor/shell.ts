import { CampusBuilding, CampusData } from "./campus";
import { pointInRing, signedArea } from "./geometry";
import {
  INDOOR_SCHEMA_VERSION,
  IndoorBuilding,
  IndoorFloor,
  Point2,
  Polygon,
  Ring,
} from "./schema";

/** Typical floor-to-floor height used to estimate how many floors there are. */
const STORY_METERS = 4.2;

/**
 * The floor a room is probably on, from its number alone, or `null` if the
 * number doesn't follow a recognizable pattern (e.g. "AUD").
 *
 * - `B240` → basement
 * - `205`, `4140`, `330A` → first digit
 * - `0935` → second digit (4-digit numbers with a leading zero)
 * - `1.402` → digit before the dot (Price Center West)
 * - `1A18` → first digit (zone letter)
 */
export function floorIdForRoomKey(key: string): string | null {
  if (/^B/i.test(key)) {
    return "B";
  }
  const match =
    key.match(/^(\d)\.\d+/) ??
    key.match(/^0([1-9])\d{2}[A-Z]?$/) ??
    key.match(/^([1-9])\d{2,3}[A-Z]?$/) ??
    key.match(/^([1-9])[A-Z]\d{1,3}$/);
  return match ? `L${match[1]}` : null;
}

/** Splits rings into outer rings with their holes, using winding direction. */
export function toPolygons(rings: Ring[]): Polygon[] {
  if (rings.length === 0) {
    return [];
  }
  const largest = rings.reduce((a, b) =>
    Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b
  );
  const outerSign = Math.sign(signedArea(largest));
  const polygons: Polygon[] = rings
    .filter((ring) => Math.sign(signedArea(ring)) === outerSign)
    .map((outer) => ({ outer, holes: [] }));
  for (const ring of rings) {
    if (Math.sign(signedArea(ring)) !== outerSign) {
      const owner = polygons.find((polygon) => pointInRing(ring[0], polygon.outer));
      owner?.holes!.push(ring);
    }
  }
  return polygons;
}

/**
 * Builds an exterior-only layout for a building from its campus-map footprint
 * parts. Floors are evenly divided from the roof height (at least as many as
 * the room numbers imply), and each floor's outline only includes parts tall
 * enough to have that floor.
 */
export function buildExteriorShell(
  code: string,
  name: string,
  campus: CampusData,
  caans: readonly string[],
  roomKeys: readonly string[]
): IndoorBuilding | null {
  const parts = campus.buildings.filter(
    (building) => building.caan !== null && caans.includes(building.caan)
  );
  if (parts.length === 0) {
    return null;
  }
  const ground = Math.min(...parts.map((part) => part.base));
  const roof = Math.max(...parts.map((part) => part.top));

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    for (const ring of part.rings) {
      for (const [x, z] of ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
  }
  const origin: Point2 = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const localParts = parts.map((part) => ({
    part,
    polygons: toPolygons(
      part.rings.map((ring) =>
        ring.map(([x, z]): Point2 => [
          Math.round((x - origin[0]) * 10) / 10,
          Math.round((z - origin[1]) * 10) / 10,
        ])
      )
    ),
  }));

  const roomFloors = roomKeys.map(floorIdForRoomKey);
  const highestRoomFloor = Math.max(
    1,
    ...roomFloors.map((id) => (id && id !== "B" ? Number(id.slice(1)) : 1))
  );
  const aboveGround = Math.max(
    highestRoomFloor,
    Math.round((roof - ground) / STORY_METERS) || 1
  );
  const story = Math.min(Math.max((roof - ground) / aboveGround, 3), 6);
  const hasBasement = roomFloors.includes("B");

  const outlineAt = (height: number): Polygon[] => {
    const tallEnough = localParts.filter(({ part }) => part.top - ground >= height);
    const chosen = tallEnough.length > 0 ? tallEnough : [tallest(localParts)];
    return chosen.flatMap(({ polygons }) => polygons);
  };

  const floors: IndoorFloor[] = [];
  const floorBase = (elevation: number, id: string, label: string, shortLabel: string) => {
    floors.push({
      id,
      label,
      shortLabel,
      vertical: { baseElevation: elevation, height: story, estimated: true },
      outline: outlineAt(Math.max(elevation, 0) + story * 0.5),
      outlineConfidence: "approximate",
      rooms: [],
      unplaced: roomKeys
        .filter(
          (key) =>
            floorIdForRoomKey(key) === id ||
            // Rooms numbered just "1", "2", ... in a one-story building
            (aboveGround === 1 && id === "L1" && /^\d{1,2}$/.test(key))
        )
        .map((key) => ({ label: key, scheduleKey: key, basis: "room-number" as const })),
      sources: [{ source: "CAMPUS-MAP" }],
    });
  };
  if (hasBasement) {
    floorBase(-story, "B", "Basement", "B");
  }
  for (let level = 1; level <= aboveGround; level++) {
    floorBase((level - 1) * story, `L${level}`, `Level ${level}`, String(level));
  }

  const accessed = campus.source.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "2026-10-19";
  return {
    schemaVersion: INDOOR_SCHEMA_VERSION,
    building: code,
    name,
    geometryStatus: "exterior-shell",
    provenance:
      "Outline and height from the UC San Diego campus map. Floors are estimated from the height, and classrooms are placed on floors by room number only.",
    coordinateSystem: {
      units: "meters",
      description: "Meters from the center of the building's footprint.",
      northDeg: 0,
    },
    sources: [
      {
        id: "CAMPUS-MAP",
        title: "UC San Diego Campus Map, building footprints and heights",
        url: "https://campusmap.ucsd.edu/",
        publisher: "UC San Diego",
        building: code,
        floors: floors.map((floor) => floor.id),
        accessed,
      },
    ],
    floors,
    geo: {
      origin,
      rotationDeg: 0,
      unitsPerMeter: 1,
      groundElevation: ground,
      caans: [...caans],
      note: "Campus map footprint",
    },
  };
}

function tallest<T extends { part: CampusBuilding }>(parts: T[]): T {
  return parts.reduce((a, b) => (a.part.top >= b.part.top ? a : b));
}

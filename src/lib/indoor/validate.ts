import {
  distanceToRing,
  pointInRing,
  polygonArea,
  ringBounds,
  selfIntersections,
} from "./geometry";
import {
  Confidence,
  GEOMETRY_STATUSES,
  GeometryStatus,
  INDOOR_SCHEMA_VERSION,
  IndoorBuilding,
  Polygon,
  SourceRef,
} from "./schema";

export type IndoorIssue = {
  level: "error" | "warning";
  /** Dotted path into the document, e.g. `floors[1].rooms[3].footprint`. */
  path: string;
  message: string;
};

export type IndoorValidation = {
  /** `true` if there are no errors (warnings are allowed). */
  ok: boolean;
  issues: IndoorIssue[];
};

const CONFIDENCES: Confidence[] = ["direct", "traced", "approximate", "unknown"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an indoor layout. Accepts `unknown` so it can be used directly on
 * fetched JSON; structural problems are reported as errors rather than thrown.
 *
 * Geometry tolerances are relative to the floor's size, since traced plans
 * often use relative units.
 */
export function validateIndoorBuilding(
  data: unknown,
  expectedBuilding?: string
): IndoorValidation {
  const issues: IndoorIssue[] = [];
  const error = (path: string, message: string) =>
    issues.push({ level: "error", path, message });
  const warn = (path: string, message: string) =>
    issues.push({ level: "warning", path, message });

  if (!isRecord(data)) {
    error("", "Layout must be an object.");
    return { ok: false, issues };
  }
  const building = data as Partial<IndoorBuilding>;
  if (building.schemaVersion !== INDOOR_SCHEMA_VERSION) {
    error(
      "schemaVersion",
      `Expected schema version ${INDOOR_SCHEMA_VERSION}, got ${String(
        building.schemaVersion
      )}.`
    );
  }
  if (typeof building.building !== "string" || !building.building) {
    error("building", "Missing building code.");
  } else if (expectedBuilding && building.building !== expectedBuilding) {
    error(
      "building",
      `Layout is for ${building.building}, but was loaded for ${expectedBuilding}.`
    );
  }
  if (!GEOMETRY_STATUSES.includes(building.geometryStatus as GeometryStatus)) {
    error("geometryStatus", `Must be one of ${GEOMETRY_STATUSES.join(", ")}.`);
  }
  if (
    building.geometryStatus === "exterior-shell" &&
    building.floors?.some((floor) => floor.rooms?.length > 0)
  ) {
    error("floors", "Exterior shells must not contain rooms.");
  }
  if (building.geo !== undefined) {
    const geo = building.geo;
    if (
      !isRecord(geo) ||
      !Array.isArray(geo.origin) ||
      !geo.origin.every(Number.isFinite) ||
      !Number.isFinite(geo.rotationDeg) ||
      !(geo.unitsPerMeter > 0) ||
      !Number.isFinite(geo.groundElevation) ||
      !Array.isArray(geo.caans)
    ) {
      error("geo", "Invalid campus placement.");
    }
  }
  if (typeof building.provenance !== "string" || !building.provenance) {
    error("provenance", "Missing provenance summary.");
  }
  const units = building.coordinateSystem?.units;
  if (units !== "meters" && units !== "feet" && units !== "relative") {
    error("coordinateSystem.units", "Must be meters, feet, or relative.");
  }

  // Sources
  const sourceIds = new Set<string>();
  if (!Array.isArray(building.sources)) {
    error("sources", "Missing sources array.");
  } else {
    if (
      building.sources.length === 0 &&
      building.geometryStatus === "source-traced"
    ) {
      error("sources", "Source-traced layouts must cite at least one source.");
    }
    building.sources.forEach((source, i) => {
      const path = `sources[${i}]`;
      if (!isRecord(source) || typeof source.id !== "string") {
        error(path, "Source must have a string id.");
        return;
      }
      if (sourceIds.has(source.id)) {
        error(`${path}.id`, `Duplicate source id ${source.id}.`);
      }
      sourceIds.add(source.id);
      if (!source.title) {
        error(`${path}.title`, "Missing title.");
      }
      if (!source.url && !source.localFile) {
        error(path, "Source needs a url or localFile.");
      }
      if (typeof source.accessed !== "string" || !DATE_RE.test(source.accessed)) {
        error(`${path}.accessed`, "Access date must be YYYY-MM-DD.");
      }
      if (source.building !== building.building) {
        warn(
          `${path}.building`,
          `Source is labeled ${source.building}, not ${building.building}.`
        );
      }
    });
  }

  const checkRefs = (path: string, refs: unknown, required: boolean) => {
    if (!Array.isArray(refs) || refs.length === 0) {
      if (required) {
        error(path, "Missing source references.");
      }
      return;
    }
    (refs as SourceRef[]).forEach((ref, i) => {
      if (!isRecord(ref) || !sourceIds.has(ref.source as string)) {
        error(`${path}[${i}]`, `Unknown source ${String(ref?.source)}.`);
      }
    });
  };
  const sourcesRequired = building.geometryStatus === "source-traced";
  const checkConfidence = (path: string, value: unknown) => {
    if (!CONFIDENCES.includes(value as Confidence)) {
      error(path, `Confidence must be one of ${CONFIDENCES.join(", ")}.`);
    } else if (
      value === "direct" &&
      building.geometryStatus === "schematic-demo"
    ) {
      error(path, "Schematic demo data cannot claim direct confidence.");
    }
  };

  /** Returns a tolerance for boundary checks, or null if invalid. */
  const checkPolygon = (path: string, polygon: unknown): number | null => {
    if (!isRecord(polygon) || !Array.isArray(polygon.outer)) {
      error(path, "Polygon must have an outer ring.");
      return null;
    }
    const rings = [polygon.outer, ...((polygon.holes as unknown[]) ?? [])];
    let valid = true;
    rings.forEach((ring, r) => {
      const ringPath = r === 0 ? `${path}.outer` : `${path}.holes[${r - 1}]`;
      if (!Array.isArray(ring) || ring.length < 3) {
        error(ringPath, "Ring needs at least 3 points.");
        valid = false;
        return;
      }
      if (
        !ring.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((n) => typeof n === "number" && Number.isFinite(n))
        )
      ) {
        error(ringPath, "Every point must be a pair of finite numbers.");
        valid = false;
        return;
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) {
        error(ringPath, "Do not repeat the first point at the end of a ring.");
        valid = false;
      }
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a[0] === b[0] && a[1] === b[1]) {
          error(ringPath, `Duplicate consecutive point at index ${i}.`);
          valid = false;
        }
      }
      if (valid && selfIntersections(ring).length > 0) {
        error(ringPath, "Ring intersects itself.");
        valid = false;
      }
    });
    if (!valid) {
      return null;
    }
    const typed = polygon as Polygon;
    if (polygonArea(typed) <= 0) {
      error(path, "Polygon has no area.");
      return null;
    }
    for (const [h, hole] of (typed.holes ?? []).entries()) {
      if (!hole.every((point) => pointInRing(point, typed.outer))) {
        error(`${path}.holes[${h}]`, "Hole is not inside the outer ring.");
      }
    }
    const { minX, maxX, minZ, maxZ } = ringBounds(typed.outer);
    return Math.max(maxX - minX, maxZ - minZ) * 0.01;
  };

  // Floors
  const ids = new Map<string, string>();
  const claimId = (id: unknown, path: string) => {
    if (typeof id !== "string" || !id) {
      error(path, "Missing id.");
      return;
    }
    const existing = ids.get(id);
    if (existing) {
      error(path, `Duplicate id ${id} (also at ${existing}).`);
    } else {
      ids.set(id, path);
    }
  };
  const roomIds = new Set<string>();
  const scheduleKeys = new Map<string, string>();
  let hasValidOutline = false;
  if (!Array.isArray(building.floors) || building.floors.length === 0) {
    error("floors", "Layout needs at least one floor.");
  } else {
    const orders = building.floors.map((floor) => floor?.vertical?.baseElevation);
    building.floors.forEach((floor, f) => {
      const path = `floors[${f}]`;
      if (!isRecord(floor)) {
        error(path, "Floor must be an object.");
        return;
      }
      claimId(floor.id, `${path}.id`);
      if (!floor.label || !floor.shortLabel) {
        error(path, "Floor needs label and shortLabel.");
      }
      const v = floor.vertical;
      if (
        !isRecord(v) ||
        !Number.isFinite(v.baseElevation) ||
        !Number.isFinite(v.height) ||
        v.height <= 0 ||
        typeof v.estimated !== "boolean"
      ) {
        error(`${path}.vertical`, "Needs baseElevation, positive height, estimated.");
      }
      if (f > 0 && !((orders[f] ?? NaN) > (orders[f - 1] ?? NaN))) {
        error(
          `${path}.vertical.baseElevation`,
          "Floors must be listed bottom to top with increasing elevation."
        );
      }
      const listingOnly = Array.isArray(floor.outline) && floor.outline.length === 0;
      checkRefs(`${path}.sources`, floor.sources, sourcesRequired || listingOnly);
      checkConfidence(`${path}.outlineConfidence`, floor.outlineConfidence);
      let tolerance: number | null = null;
      if (!Array.isArray(floor.outline)) {
        error(`${path}.outline`, "Floor needs an outline array.");
      } else if (listingOnly) {
        if (floor.outlineConfidence !== "unknown") {
          error(`${path}.outlineConfidence`, "A floor without an outline must use unknown confidence.");
        }
        for (const field of ["rooms", "areas", "features"] as const) {
          if (floor[field] && floor[field].length > 0) {
            error(`${path}.${field}`, "A floor without an outline must not contain geometry.");
          }
        }
        if (!Array.isArray(floor.unplaced) || floor.unplaced.length === 0) {
          error(`${path}.unplaced`, "A floor without an outline needs sourced floor-listing rooms.");
        } else {
          floor.unplaced.forEach((room, r) => {
            if (
              !isRecord(room) ||
              room.basis !== "floor-listing" ||
              typeof room.label !== "string" ||
              !room.label ||
              (room.scheduleKey !== null &&
                (typeof room.scheduleKey !== "string" || !room.scheduleKey))
            ) {
              error(`${path}.unplaced[${r}]`, "A floor without an outline needs valid floor-listing rooms.");
            }
          });
        }
      } else {
        const tolerances = floor.outline.map((part, o) =>
          checkPolygon(`${path}.outline[${o}]`, part)
        );
        hasValidOutline ||= tolerances.some((value) => value !== null);
        tolerance = tolerances.includes(null)
          ? null
          : Math.max(...(tolerances as number[]));
      }
      for (const [t, transform] of (floor.transforms ?? []).entries()) {
        if (!sourceIds.has(transform.source)) {
          error(`${path}.transforms[${t}]`, `Unknown source ${transform.source}.`);
        }
        if (!(transform.scale > 0)) {
          error(`${path}.transforms[${t}].scale`, "Scale must be positive.");
        }
      }

      if (!Array.isArray(floor.rooms)) {
        error(`${path}.rooms`, "Missing rooms array.");
        return;
      }
      floor.rooms.forEach((room, r) => {
        const roomPath = `${path}.rooms[${r}]`;
        if (!isRecord(room)) {
          error(roomPath, "Room must be an object.");
          return;
        }
        claimId(room.id, `${roomPath}.id`);
        roomIds.add(room.id);
        if (typeof room.label !== "string" || !room.label) {
          error(`${roomPath}.label`, "Room label must be a non-empty string.");
        }
        if (room.floor !== floor.id) {
          error(
            `${roomPath}.floor`,
            `Room says floor ${room.floor} but is listed under ${floor.id}.`
          );
        }
        if (room.scheduleKey !== null) {
          if (typeof room.scheduleKey !== "string" || !room.scheduleKey) {
            error(
              `${roomPath}.scheduleKey`,
              "Schedule key must be a non-empty string (keep leading zeros) or null."
            );
          } else {
            const existing = scheduleKeys.get(room.scheduleKey);
            if (existing) {
              error(
                `${roomPath}.scheduleKey`,
                `Schedule key ${room.scheduleKey} is already assigned to ${existing}.`
              );
            } else {
              scheduleKeys.set(room.scheduleKey, room.id);
            }
          }
        }
        if (!isRecord(room.confidence)) {
          error(`${roomPath}.confidence`, "Missing confidence.");
        } else {
          checkConfidence(`${roomPath}.confidence.location`, room.confidence.location);
          checkConfidence(`${roomPath}.confidence.shape`, room.confidence.shape);
          checkConfidence(`${roomPath}.confidence.label`, room.confidence.label);
        }
        checkRefs(`${roomPath}.sources`, room.sources, sourcesRequired);
        const roomTolerance = checkPolygon(`${roomPath}.footprint`, room.footprint);
        if (roomTolerance !== null && tolerance !== null) {
          const outside = room.footprint.outer.filter(
            (point) =>
              !floor.outline.some(
                ({ outer }) =>
                  pointInRing(point, outer) ||
                  distanceToRing(point, outer) <= tolerance!
              )
          );
          if (outside.length > 0) {
            warn(
              `${roomPath}.footprint`,
              `${outside.length} point(s) fall outside the floor outline.`
            );
          }
        }
        if (room.labelAt && !pointInRing(room.labelAt, room.footprint?.outer ?? [])) {
          warn(`${roomPath}.labelAt`, "Label anchor is outside the room.");
        }
      });

      for (const [a, area] of (floor.areas ?? []).entries()) {
        const areaPath = `${path}.areas[${a}]`;
        claimId(area.id, `${areaPath}.id`);
        checkConfidence(`${areaPath}.confidence`, area.confidence);
        checkRefs(`${areaPath}.sources`, area.sources, sourcesRequired);
        checkPolygon(`${areaPath}.footprint`, area.footprint);
      }
      for (const [i, feature] of (floor.features ?? []).entries()) {
        const featurePath = `${path}.features[${i}]`;
        claimId(feature.id, `${featurePath}.id`);
        checkConfidence(`${featurePath}.confidence`, feature.confidence);
        checkRefs(`${featurePath}.sources`, feature.sources, sourcesRequired);
        if (
          !Array.isArray(feature.at) ||
          !feature.at.every((n) => Number.isFinite(n))
        ) {
          error(`${featurePath}.at`, "Feature needs a finite [x, z] point.");
        }
      }
    });
    if (!hasValidOutline) {
      error("floors", "Layout needs at least one floor with a valid outline polygon.");
    }
  }

  // Aliases
  for (const [a, alias] of (building.scheduleAliases ?? []).entries()) {
    const path = `scheduleAliases[${a}]`;
    if (!roomIds.has(alias.room)) {
      error(`${path}.room`, `Alias points to unknown room ${alias.room}.`);
      continue;
    }
    const existing = scheduleKeys.get(alias.scheduleKey);
    if (existing && existing !== alias.room) {
      error(
        `${path}.scheduleKey`,
        `Ambiguous: ${alias.scheduleKey} maps to both ${existing} and ${alias.room}.`
      );
    } else if (existing) {
      warn(`${path}.scheduleKey`, `Redundant alias for ${alias.scheduleKey}.`);
    } else {
      scheduleKeys.set(alias.scheduleKey, alias.room);
    }
  }
  for (const [u, unmapped] of (building.knownUnmapped ?? []).entries()) {
    if (scheduleKeys.has(unmapped.scheduleKey)) {
      error(
        `knownUnmapped[${u}]`,
        `${unmapped.scheduleKey} is listed as unmapped but is mapped to ${scheduleKeys.get(
          unmapped.scheduleKey
        )}.`
      );
    }
  }

  return { ok: !issues.some((issue) => issue.level === "error"), issues };
}

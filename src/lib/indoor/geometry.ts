import { Point2, Polygon, Ring, SourceTransform } from "./schema";

/** Signed area (positive for counterclockwise in x/z with z pointing down). */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

export function polygonArea(polygon: Polygon): number {
  return (
    Math.abs(signedArea(polygon.outer)) -
    (polygon.holes ?? []).reduce((acc, hole) => acc + Math.abs(signedArea(hole)), 0)
  );
}

/** Area-weighted centroid of a ring; falls back to the vertex mean. */
export function ringCentroid(ring: Ring): Point2 {
  const area = signedArea(ring);
  if (Math.abs(area) < 1e-9) {
    const n = ring.length || 1;
    return [
      ring.reduce((acc, [x]) => acc + x, 0) / n,
      ring.reduce((acc, [, z]) => acc + z, 0) / n,
    ];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const cross = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  return [cx / (6 * area), cz / (6 * area)];
}

/** Ray-casting point-in-ring test. Points on the boundary may go either way. */
export function pointInRing([x, z]: Point2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(point: Point2, polygon: Polygon): boolean {
  return (
    pointInRing(point, polygon.outer) &&
    !(polygon.holes ?? []).some((hole) => pointInRing(point, hole))
  );
}

/** Distance from a point to the closest edge of a ring. */
export function distanceToRing([x, z]: Point2, ring: Ring): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lengthSq = dx * dx + dz * dz;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / lengthSq));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)));
  }
  return best;
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return Math.abs(value) < 1e-12 ? 0 : value > 0 ? 1 : 2;
}

function onSegment(a: Point2, b: Point2, c: Point2): boolean {
  return (
    Math.min(a[0], c[0]) <= b[0] &&
    b[0] <= Math.max(a[0], c[0]) &&
    Math.min(a[1], c[1]) <= b[1] &&
    b[1] <= Math.max(a[1], c[1])
  );
}

export function segmentsIntersect(
  p1: Point2,
  q1: Point2,
  p2: Point2,
  q2: Point2
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  return (
    (o1 === 0 && onSegment(p1, p2, q1)) ||
    (o2 === 0 && onSegment(p1, q2, q1)) ||
    (o3 === 0 && onSegment(p2, p1, q2)) ||
    (o4 === 0 && onSegment(p2, q1, q2))
  );
}

/** Returns the index pairs of non-adjacent edges that intersect. */
export function selfIntersections(ring: Ring): [number, number][] {
  const found: [number, number][] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share a vertex, so skip them
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        continue;
      }
      if (
        segmentsIntersect(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])
      ) {
        found.push([i, j]);
      }
    }
  }
  return found;
}

export function ringBounds(ring: Ring): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  return {
    minX: Math.min(...ring.map(([x]) => x)),
    maxX: Math.max(...ring.map(([x]) => x)),
    minZ: Math.min(...ring.map(([, z]) => z)),
    maxZ: Math.max(...ring.map(([, z]) => z)),
  };
}

/**
 * Converts a source image pixel into local floor coordinates using the
 * convention documented in `schema.ts`.
 */
export function pixelToLocal(
  [u, v]: [number, number],
  transform: Pick<SourceTransform, "originPx" | "rotationDeg" | "scale">
): Point2 {
  const du = u - transform.originPx[0];
  const dv = v - transform.originPx[1];
  // Clockwise on the page (v points down) is a standard rotation in u/v
  const theta = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    round((du * cos - dv * sin) * transform.scale),
    round((du * sin + dv * cos) * transform.scale),
  ];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

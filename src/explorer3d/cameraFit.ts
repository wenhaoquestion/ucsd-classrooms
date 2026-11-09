type Point3 = readonly [number, number, number];

/** Fit all box corners in a perspective camera without changing its orientation. */
export function perspectiveFitDistance(
  min: Point3,
  max: Point3,
  target: Point3,
  direction: Point3,
  verticalFov: number,
  aspect: number,
  usableFraction = 0.9
): number {
  const length = Math.hypot(...direction);
  const d = direction.map((n) => n / length);
  const horizontalLength = Math.hypot(d[0], d[2]);
  const right = horizontalLength > 1e-8
    ? [d[2] / horizontalLength, 0, -d[0] / horizontalLength]
    : [1, 0, 0];
  const up = [
    d[1] * right[2] - d[2] * right[1],
    d[2] * right[0] - d[0] * right[2],
    d[0] * right[1] - d[1] * right[0],
  ];
  const vertical = Math.tan(verticalFov / 2) * usableFraction;
  const horizontal = vertical * aspect;
  let distance = 1e-4;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const p = [x - target[0], y - target[1], z - target[2]];
        const dot = (axis: number[]) => p.reduce((sum, n, i) => sum + n * axis[i], 0);
        // The closest corners have less depth than the target; include that
        // perspective offset instead of shrinking a bounding sphere by a guess.
        distance = Math.max(distance, dot(d) + Math.max(
          Math.abs(dot(right)) / horizontal,
          Math.abs(dot(up)) / vertical
        ));
      }
    }
  }
  return distance;
}

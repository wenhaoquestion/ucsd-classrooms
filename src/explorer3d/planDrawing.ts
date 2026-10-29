import { Point2, SourceTransform } from "../lib/indoor/schema";

/** Inverse of pixelToLocal, normalized for a full-page, vertically flipped texture. */
export function planUV([x, z]: Point2, transform: SourceTransform): Point2 {
  const angle = transform.rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const u = (x * cos + z * sin) / transform.scale + transform.originPx[0];
  const v = (-x * sin + z * cos) / transform.scale + transform.originPx[1];
  const [width, height] = transform.imageSizePx!;
  return [u / width, 1 - v / height];
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { perspectiveFitDistance } from "../src/explorer3d/cameraFit";

describe("perspective indoor camera framing", () => {
  for (const aspect of [840 / 650, 390 / 292, 0.65]) {
    for (const [name, min, max] of [
      ["wide exploded building", [-50, -4, -28], [50, 60, 28]],
      ["long isolated floor", [-50, 8, -12], [50, 12, 12]],
      ["tall building", [-20, 0, -20], [20, 120, 20]],
    ] as const) {
      it(`fits ${name} at aspect ${aspect.toFixed(2)} after reset and rotation`, () => {
        for (const azimuth of [28, 90, 163]) {
          const az = azimuth * Math.PI / 180;
          const el = 40 * Math.PI / 180;
          const direction = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
          const target = new Vector3(...min).add(new Vector3(...max)).multiplyScalar(0.5);
          const distance = perspectiveFitDistance(min, max, target.toArray(), direction.toArray(), Math.PI / 4, aspect);
          const camera = new PerspectiveCamera(45, aspect, 0.1, 10000);
          camera.position.copy(target).addScaledVector(direction, distance);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
            const projected = new Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(projected.x) <= 0.900001, `horizontal clipping: ${projected.x}`);
            assert.ok(Math.abs(projected.y) <= 0.900001, `vertical clipping: ${projected.y}`);
            assert.ok(projected.z > -1 && projected.z < 1);
          }
        }
      });
    }
  }
});

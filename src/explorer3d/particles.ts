import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";

/** A line segment in world space that particles can settle on. */
export type Segment = [ax: number, ay: number, az: number, bx: number, by: number, bz: number];

/** mulberry32: small deterministic PRNG so the same building assembles the same way. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(string: string): number {
  let hash = 2166136261;
  for (let i = 0; i < string.length; i++) {
    hash = Math.imul(hash ^ string.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

/**
 * Samples `count` points along `segments`, proportional to segment length, so
 * particles land on the same edges that the interactive model draws.
 */
export function sampleSegments(
  segments: Segment[],
  count: number,
  random: () => number
): Float32Array {
  const cumulative: number[] = [];
  let total = 0;
  for (const [ax, ay, az, bx, by, bz] of segments) {
    total += Math.hypot(bx - ax, by - ay, bz - az);
    cumulative.push(total);
  }
  const positions = new Float32Array(count * 3);
  if (total === 0) {
    return positions;
  }
  for (let i = 0; i < count; i++) {
    const target = random() * total;
    // Binary search for the segment containing `target`
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const [ax, ay, az, bx, by, bz] = segments[lo];
    const t = random();
    positions[i * 3] = ax + (bx - ax) * t;
    positions[i * 3 + 1] = ay + (by - ay) * t;
    positions[i * 3 + 2] = az + (bz - az) * t;
  }
  return positions;
}

const vertexShader = /* glsl */ `
  attribute vec3 aTarget;
  attribute vec3 aOffset;
  attribute float aDelay;
  attribute float aSeed;
  uniform float uTime;
  uniform float uFlight;
  uniform vec3 uAnchor;
  uniform vec3 uLift;
  uniform float uNoise;
  uniform float uSize;
  uniform float uFade;
  varying float vAlpha;

  float easeInOut(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
  }

  void main() {
    float t = clamp((uTime - aDelay) / uFlight, 0.0, 1.0);
    float e = easeInOut(t);
    vec3 start = uAnchor + aOffset;
    // Rise from the marker first, then curve into place (quadratic Bezier)
    vec3 control = start + uLift * (0.75 + aSeed * 0.5);
    vec3 a = mix(start, control, e);
    vec3 b = mix(control, aTarget, e);
    vec3 position = mix(a, b, e);
    float wobble = (1.0 - e) * e * 4.0;
    position += uNoise * wobble * vec3(
      sin(uTime * 5.0 + aSeed * 31.0),
      sin(uTime * 4.0 + aSeed * 17.0),
      cos(uTime * 6.0 + aSeed * 23.0)
    );
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * (1.0 + (1.0 - e) * 0.8);
    // Fade in quickly at spawn; the whole cloud fades out via uFade
    vAlpha = smoothstep(0.0, 0.08, uTime - aDelay + 0.08) * uFade * (0.55 + 0.45 * aSeed);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    gl_FragColor = vec4(uColor, vAlpha * (1.0 - d * 4.0));
  }
`;

export type ParticleCloud = {
  points: Points<BufferGeometry, ShaderMaterial>;
  /** Seconds after which every particle has arrived. */
  arrival: number;
  dispose(): void;
};

export type ParticleOptions = {
  targets: Float32Array;
  /** Lowest and highest target y, so lower floors assemble first. */
  minY: number;
  maxY: number;
  /** Radius of the starting cloud around the anchor, in world units. */
  spread: number;
  /** Direction and height particles rise before converging. */
  lift: Vector3;
  noise: number;
  pointSize: number;
  color: Color;
  flight: number;
  maxDelay: number;
  random: () => number;
};

export function createParticleCloud({
  targets,
  minY,
  maxY,
  spread,
  lift,
  noise,
  pointSize,
  color,
  flight,
  maxDelay,
  random,
}: ParticleOptions): ParticleCloud {
  const count = targets.length / 3;
  const offsets = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const seeds = new Float32Array(count);
  const range = Math.max(maxY - minY, 1e-6);
  for (let i = 0; i < count; i++) {
    // Uniform-ish point in a flattened sphere around the anchor
    const r = spread * Math.cbrt(random());
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    offsets[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    offsets[i * 3 + 1] = r * Math.cos(phi) * 0.5;
    offsets[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const height = (targets[i * 3 + 1] - minY) / range;
    delays[i] = maxDelay * (0.7 * height + 0.3 * random());
    seeds[i] = random();
  }
  const geometry = new BufferGeometry();
  // `position` is required by three.js for bounds; the shader uses aTarget
  geometry.setAttribute("position", new BufferAttribute(targets, 3));
  geometry.setAttribute("aTarget", new BufferAttribute(targets, 3));
  geometry.setAttribute("aOffset", new BufferAttribute(offsets, 3));
  geometry.setAttribute("aDelay", new BufferAttribute(delays, 1));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uFlight: { value: flight },
      uAnchor: { value: new Vector3() },
      uLift: { value: lift },
      uNoise: { value: noise },
      uSize: { value: pointSize },
      uFade: { value: 1 },
      uColor: { value: color },
    },
  });
  const points = new Points(geometry, material);
  // Particles travel outside the model's bounds
  points.frustumCulled = false;
  points.renderOrder = 10;
  return {
    points,
    arrival: maxDelay + flight,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Spherical,
  Texture,
  TextureLoader,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CampusData } from "../lib/indoor/campus";
import { ringCentroid } from "../lib/indoor/geometry";
import { toPolygons } from "../lib/indoor/shell";
import { RoomStatusKind } from "../lib/indoor/roomStatus";
import {
  IndoorArea,
  IndoorBuilding,
  IndoorFeature,
  IndoorFloor,
  IndoorRoom,
  Polygon,
} from "../lib/indoor/schema";
import {
  ExplorerRenderer,
  getExplorerRenderer,
  getRendererStats,
  RendererOwner,
} from "./ExplorerRenderer";
import { planUV } from "./planDrawing";
/** "rise": floors stack up from the ground; "fade": a quick fade-in. */
export type IntroMode = "rise" | "fade" | "none";

export type DisplayMode = {
  /** Isolated floor ID, or `null` for all floors. */
  floor: string | null;
  exploded: boolean;
};

export type IndoorSceneOptions = {
  /** Element that defines the viewport and receives pointer input. */
  stage: HTMLElement;
  /** Absolutely positioned layer inside `stage` for room labels. */
  labelLayer: HTMLElement;
  layout: IndoorBuilding;
  /** Rooms that can be selected (they have or may have schedules). */
  selectable: ReadonlySet<string>;
  reducedMotion: boolean;
  onSelect(roomId: string): void;
  onHover(roomId: string | null): void;
  onFloorTag(floorId: string): void;
  onIntroEnd(): void;
  onContextChange(lost: boolean): void;
};

/** Glyphs give a non-color cue for status on labels (mirrored in the legend). */
export const STATUS_GLYPHS: Record<RoomStatusKind, string> = {
  "in-use": "●",
  soon: "◐",
  "no-class-now": "○",
  listed: "◆",
  "none-listed": "–",
  unknown: "?",
  "not-tracked": "",
  bookable: "○",
  booked: "●",
  closed: "–",
};

type Palette = {
  background: Color;
  slab: Color;
  slabEdge: Color;
  area: Color;
  notDetailed: Color;
  room: Color;
  roomEdge: Color;
  selectedEdge: Color;
  beacon: Color;
  context: Color;
  contextEdge: Color;
  shadow: string;
  status: Record<RoomStatusKind, Color>;
};

const DARK: Palette = {
  background: new Color("#0f1a26"),
  slab: new Color("#40536a"),
  slabEdge: new Color("#9fb3cb"),
  area: new Color("#5d6b7c"),
  notDetailed: new Color("#4b5666"),
  room: new Color("#7f8fa3"),
  roomEdge: new Color("#b7c4d4"),
  selectedEdge: new Color("#ffffff"),
  beacon: new Color("#ffffff"),
  context: new Color("#4a5b70"),
  contextEdge: new Color("#7d8fa5"),
  shadow: "rgba(0, 0, 0, 0.55)",
  status: {
    "in-use": new Color("#35c95c"),
    soon: new Color("#f2c230"),
    "no-class-now": new Color("#4aa8ff"),
    listed: new Color("#8fb6e6"),
    "none-listed": new Color("#9eabba"),
    unknown: new Color("#a5a5a5"),
    "not-tracked": new Color("#7f8fa3"),
    bookable: new Color("#3ecf8e"),
    booked: new Color("#ff6b81"),
    closed: new Color("#6f7b8a"),
  },
};

const LIGHT: Palette = {
  background: new Color("#e4ebf1"),
  slab: new Color("#b8c6d4"),
  slabEdge: new Color("#4d6177"),
  area: new Color("#9aa8b8"),
  notDetailed: new Color("#a8b2be"),
  room: new Color("#c2ccd8"),
  roomEdge: new Color("#5b6e83"),
  selectedEdge: new Color("#0b1a2a"),
  beacon: new Color("#0b1a2a"),
  context: new Color("#c9d3dd"),
  contextEdge: new Color("#8a99aa"),
  shadow: "rgba(30, 50, 70, 0.35)",
  status: {
    "in-use": new Color("#14a03a"),
    soon: new Color("#d9a400"),
    "no-class-now": new Color("#1f7fe0"),
    listed: new Color("#5f8fc8"),
    "none-listed": new Color("#8d9aaa"),
    unknown: new Color("#8a8a8a"),
    "not-tracked": new Color("#c2ccd8"),
    bookable: new Color("#12a150"),
    booked: new Color("#d9364f"),
    closed: new Color("#9aa4b1"),
  },
};

const FOV = 32;
/** Fraction of a story that room volumes are extruded (a low cutaway). */
const ROOM_HEIGHT = 0.36;
const SELECTABLE_ROOM_HEIGHT = 0.5;
const SELECTED_ROOM_HEIGHT = 0.78;
const SLAB_THICKNESS = 0.07;
/** Exploded view adds this many stories of display-only gap per floor. */
const EXPLODE_GAP = 1.5;
const GHOST_PRESENCE = 0.16;
const TAP_SLOP_PX = 7;
const TAP_MAX_MS = 650;
/** Touch taps that miss every room select the nearest one within this distance. */
const TOUCH_PICK_PX = 28;
/** Each floor rises over this long, starting `RISE_STAGGER` after the one below. */
const RISE_FLOOR_S = 0.45;
const RISE_STAGGER = 0.09;
const FADE_INTRO_END = 0.25;
const TWEEN_MS = 450;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Shape in the extrusion plane; (x, -z) so that rotateX(-90deg) maps it back to (x, z). */
function polygonShape({ outer, holes = [] }: Polygon): Shape {
  const shape = new Shape(outer.map(([x, z]) => new Vector2(x, -z)));
  for (const hole of holes) {
    shape.holes.push(new Path(hole.map(([x, z]) => new Vector2(x, -z))));
  }
  return shape;
}

function extrude(polygon: Polygon, depth: number): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(polygonShape(polygon), {
    depth,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function flat(polygon: Polygon, y: number): ShapeGeometry {
  const geometry = new ShapeGeometry(polygonShape(polygon));
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

type Tween = {
  /** Starting a tween replaces any running tween with the same key. */
  key: string;
  from: number;
  to: number;
  start: number;
  duration: number;
  set(value: number): void;
};

type LabelEntry = {
  element: HTMLElement;
  /** Position within the owning floor group. */
  local: Vector3;
  floor: FloorVisual;
  priority: number;
  width: number;
  height: number;
  room?: RoomVisual;
  /** Only shown when this floor is isolated. */
  isolatedOnly: boolean;
};

type RoomVisual = {
  room: IndoorRoom;
  floor: FloorVisual;
  /**
   * Own meshes for selectable rooms only, so they can be colored and raised
   * individually. Other rooms are merged into their floor's context meshes.
   */
  fill: Mesh<BufferGeometry, MeshLambertMaterial> | null;
  edges: LineSegments<BufferGeometry, LineBasicMaterial> | null;
  baseHeight: number;
  height: number;
  selectable: boolean;
  status: RoomStatusKind;
  center: Vector3;
  label?: LabelEntry;
};

type FloorVisual = {
  floor: IndoorFloor;
  index: number;
  group: Group;
  slabMaterial: MeshLambertMaterial;
  slabEdgeMaterial: LineBasicMaterial;
  /** Materials that just fade with the floor; `userData.base` is full opacity. */
  fadeMaterials: Material[];
  /** Merged non-selectable rooms. */
  contextFill: MeshLambertMaterial;
  contextEdge: LineBasicMaterial;
  rooms: RoomVisual[];
  /** 1 = shown, GHOST_PRESENCE = context only, 0 = hidden. */
  presence: number;
  /** Intro progress for this floor (0 = not yet risen). */
  reveal: number;
  displayY: number;
  tag: LabelEntry;
  physicalY: number;
  drawing?: Mesh<BufferGeometry, MeshBasicMaterial>;
  drawingLoading?: boolean;
};

export class IndoorScene implements RendererOwner {
  #planVisible = true;
  readonly #options: IndoorSceneOptions;
  readonly #renderer: ExplorerRenderer;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(FOV, 1, 0.1, 2000);
  readonly #controls: OrbitControls;
  readonly #raycaster = new Raycaster();
  readonly #model = new Group();
  readonly #floors: FloorVisual[] = [];
  readonly #rooms = new Map<string, RoomVisual>();
  readonly #labels: LabelEntry[] = [];
  readonly #disposables: { dispose(): void }[] = [];
  readonly #beacon: Group;
  readonly #shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly #palette: Palette;
  readonly #storyHeight: number;
  readonly #resizeObserver: ResizeObserver;
  /** Half-extent of the footprint, for camera framing. */
  readonly #radius: number;
  readonly #center: Vector3;

  #display: DisplayMode = { floor: null, exploded: false };
  #selected: string | null = null;
  #hovered: string | null = null;
  #tweens: Tween[] = [];
  #frame = 0;
  #settleUntil = 0;
  #active = false;
  #disposed = false;
  #framed = false;
  #contextLost = false;
  #appearanceDirty = true;
  #labelsShown = false;
  #context: { fill: MeshLambertMaterial; edge: LineBasicMaterial } | null = null;
  #intro: { mode: IntroMode; start: number } | null = null;
  #rect = { left: 0, top: 0, width: 0, height: 0 };
  #pointer: {
    x: number;
    y: number;
    time: number;
    id: number;
    /** Element pressed; pointer capture retargets the later pointerup. */
    target: HTMLElement | null;
  } | null = null;
  #hoverQueued: { x: number; y: number } | null = null;

  constructor(options: IndoorSceneOptions) {
    this.#options = options;
    this.#renderer = getExplorerRenderer();
    this.#palette =
      window.matchMedia?.("(prefers-color-scheme: light)").matches ? LIGHT : DARK;
    // Sourced floor listings stay in the layout/index, but cannot produce a
    // slab, floor tag or other geometry without a real outline.
    const floors = options.layout.floors.filter((floor) => floor.outline.length > 0);
    this.#storyHeight = Math.max(
      ...floors.map((floor) => floor.vertical.height)
    );

    // Footprint bounds across all floors
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const floor of floors) {
      for (const part of floor.outline) {
        for (const [x, z] of part.outer) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    this.#center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.#radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;

    // Lights give the extruded rooms some shading for depth
    const hemisphere = new HemisphereLight(0xffffff, 0x445566, 2.2);
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.6, 1, 0.35);
    this.#scene.add(hemisphere, sun, this.#model);

    const minElevation = Math.min(
      ...options.layout.floors.map((f) => f.vertical.baseElevation)
    );
    floors.forEach((floor, index) => {
      this.#floors.push(
        this.#buildFloor(floor, index, floor.vertical.baseElevation - minElevation)
      );
    });

    // Soft contact shadow under the model ("floating" without real shadows)
    const shadowTexture = this.#makeShadowTexture();
    const shadowMaterial = new MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
    });
    this.#shadow = new Mesh(
      new PlaneGeometry((maxX - minX) * 1.35, (maxZ - minZ) * 1.35),
      shadowMaterial
    );
    this.#shadow.rotation.x = -Math.PI / 2;
    this.#shadow.position.set(this.#center.x, -this.#storyHeight * 0.9, this.#center.z);
    this.#shadow.renderOrder = -1;
    this.#model.add(this.#shadow);
    this.#track(this.#shadow.geometry, shadowMaterial, shadowTexture);

    // Selected-room marker: a thin post with a small cap
    this.#beacon = new Group();
    const beaconMaterial = new MeshBasicMaterial({
      color: this.#palette.beacon,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const post = new Mesh(
      new CylinderGeometry(0.06, 0.06, this.#storyHeight * 0.9, 8),
      beaconMaterial
    );
    post.position.y = this.#storyHeight * 0.45;
    const cap = new Mesh(new CylinderGeometry(0.32, 0.02, 0.5, 16), beaconMaterial);
    cap.position.y = this.#storyHeight * 0.9 + 0.25;
    this.#beacon.add(post, cap);
    this.#beacon.visible = false;
    this.#beacon.renderOrder = 1000;
    post.renderOrder = cap.renderOrder = 1000;
    this.#track(post.geometry, cap.geometry, beaconMaterial);

    this.#controls = new OrbitControls(this.#camera, options.stage);
    this.#controls.enableDamping = false;
    this.#controls.screenSpacePanning = true;
    this.#controls.maxPolarAngle = (82 * Math.PI) / 180;
    this.#controls.minDistance = this.#radius * 0.3;
    this.#controls.maxDistance = this.#radius * 5;
    this.#controls.addEventListener("change", this.#handleControlsChange);
    this.#controls.addEventListener("start", this.#handleControlsStart);

    this.#applyDisplayInstantly();
    this.#frameCamera(false, true);

    options.stage.addEventListener("pointerdown", this.#handlePointerDown);
    options.stage.addEventListener("pointermove", this.#handlePointerMove);
    options.stage.addEventListener("pointerup", this.#handlePointerUp);
    options.stage.addEventListener("pointercancel", this.#handlePointerCancel);
    options.stage.addEventListener("pointerleave", this.#handlePointerLeave);
    this.#resizeObserver = new ResizeObserver(() => this.#settle(100));
    this.#resizeObserver.observe(options.stage);

    // Measure every label once in one layout pass
    for (const label of this.#labels) {
      options.labelLayer.append(label.element);
    }
    for (const label of this.#labels) {
      label.width = label.element.offsetWidth;
      label.height = label.element.offsetHeight;
      label.element.classList.add("explorer-label-hidden");
    }

    (window as unknown as Record<string, unknown>).__ucsdIndoorStats =
      getRendererStats;
  }

  #track(...items: { dispose(): void }[]): void {
    this.#disposables.push(...items);
  }

  #makeShadowTexture(): Texture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
    gradient.addColorStop(0, this.#palette.shadow);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    return new CanvasTexture(canvas);
  }

  #makeLabel(
    text: string,
    className: string,
    floor: FloorVisual,
    local: Vector3,
    priority: number,
    isolatedOnly: boolean
  ): LabelEntry {
    const element = document.createElement("span");
    element.className = `explorer-label ${className}`;
    element.textContent = text;
    element.setAttribute("aria-hidden", "true");
    const entry: LabelEntry = {
      element,
      local,
      floor,
      priority,
      width: 0,
      height: 0,
      isolatedOnly,
    };
    this.#labels.push(entry);
    return entry;
  }

  #buildFloor(floor: IndoorFloor, index: number, physicalY: number): FloorVisual {
    const group = new Group();
    group.position.y = physicalY;
    this.#model.add(group);
    const palette = this.#palette;
    const h = floor.vertical.height;
    const order = index * 10;

    const slabMaterial = new MeshLambertMaterial({
      color: palette.slab,
      transparent: true,
      depthWrite: false,
    });
    slabMaterial.userData.base = 0.5;
    const slabEdgeMaterial = new LineBasicMaterial({
      color: palette.slabEdge,
      transparent: true,
      depthWrite: false,
    });
    slabEdgeMaterial.userData.base = 0.85;
    this.#track(slabMaterial, slabEdgeMaterial);
    const slabGeometries = floor.outline.map((part) => {
      const geometry = extrude(part, h * SLAB_THICKNESS);
      geometry.translate(0, -h * SLAB_THICKNESS, 0);
      return geometry;
    });
    const slabEdges = slabGeometries.map((geometry) => new EdgesGeometry(geometry, 30));
    const slab = new Mesh(this.#merge(slabGeometries), slabMaterial);
    slab.renderOrder = order;
    const edges = new LineSegments(this.#merge(slabEdges), slabEdgeMaterial);
    edges.renderOrder = order + 5;
    group.add(slab, edges);
    this.#track(slab.geometry, edges.geometry);

    const fadeMaterials: Material[] = [];
    const pedestal = this.#options.layout.building === "GEISEL" && floor.id === "L3";
    if (this.#options.layout.geometryStatus === "exterior-shell" || pedestal) {
      // No rooms: show the story as a glassy volume
      const wallGeometries = floor.outline.map((part) => extrude(part, h * 0.94));
      const wallEdges = wallGeometries.map((geometry) => new EdgesGeometry(geometry, 30));
      const wallMaterial = new MeshLambertMaterial({
        color: palette.room,
        transparent: true,
        depthWrite: false,
      });
      wallMaterial.userData.base = pedestal ? 0.65 : 0.22;
      const wallEdgeMaterial = new LineBasicMaterial({
        color: palette.roomEdge,
        transparent: true,
        depthWrite: false,
      });
      wallEdgeMaterial.userData.base = 0.55;
      const walls = new Mesh(this.#merge(wallGeometries), wallMaterial);
      walls.renderOrder = order + 2;
      const wallLines = new LineSegments(this.#merge(wallEdges), wallEdgeMaterial);
      wallLines.renderOrder = order + 3;
      group.add(walls, wallLines);
      fadeMaterials.push(wallMaterial, wallEdgeMaterial);
      this.#track(walls.geometry, wallLines.geometry, wallMaterial, wallEdgeMaterial);
    }

    const contextFill = new MeshLambertMaterial({
      color: palette.room,
      transparent: true,
      depthWrite: false,
    });
    const contextEdge = new LineBasicMaterial({
      color: palette.roomEdge,
      transparent: true,
      depthWrite: false,
    });
    this.#track(contextFill, contextEdge);

    const visual: FloorVisual = {
      floor,
      index,
      group,
      slabMaterial,
      slabEdgeMaterial,
      fadeMaterials,
      contextFill,
      contextEdge,
      rooms: [],
      presence: 1,
      reveal: 1,
      displayY: physicalY,
      physicalY,
      tag: undefined as unknown as LabelEntry,
    };

    // Enclosed spaces without a number read as rooms; other areas share flat meshes
    const contextFills: BufferGeometry[] = [];
    const contextEdges: BufferGeometry[] = [];
    const areaGroups = new Map<boolean, BufferGeometry[]>();
    for (const area of floor.areas ?? []) {
      if (area.kind === "unlabeled-room") {
        const geometry = extrude(area.footprint, h * ROOM_HEIGHT);
        contextFills.push(geometry);
        contextEdges.push(new EdgesGeometry(geometry, 25));
        continue;
      }
      const notDetailed = area.kind === "not-detailed";
      areaGroups.set(notDetailed, [
        ...(areaGroups.get(notDetailed) ?? []),
        flat(area.footprint, 0.01),
      ]);
      if (notDetailed) {
        const [x, z] = ringCentroid(area.footprint.outer);
        this.#makeLabel(
          "Not detailed on source map",
          "explorer-area-label",
          visual,
          new Vector3(x, 0.05, z),
          8,
          true
        );
      } else if (area.label && floor.planDrawing) {
        const [x, z] = ringCentroid(area.footprint.outer);
        this.#makeLabel(area.label, "explorer-area-label", visual,
          new Vector3(x, h * 0.08, z), 15, true);
      }
    }
    for (const [notDetailed, geometries] of areaGroups) {
      const material = new MeshBasicMaterial({
        color: notDetailed ? palette.notDetailed : palette.area,
        transparent: true,
        depthWrite: false,
      });
      material.userData.base = notDetailed ? 0.32 : 0.4;
      const mesh = new Mesh(this.#merge(geometries), material);
      mesh.renderOrder = order + 1;
      group.add(mesh);
      visual.fadeMaterials.push(material);
      this.#track(mesh.geometry, material);
    }

    // Rooms that can't be selected are context: one fill and one outline mesh
    for (const room of floor.rooms) {
      const geometry = this.#buildRoom(visual, room, order);
      if (geometry) {
        contextFills.push(geometry);
        contextEdges.push(new EdgesGeometry(geometry, 25));
      }
    }
    if (contextFills.length > 0) {
      const fill = new Mesh(this.#merge(contextFills), contextFill);
      fill.renderOrder = order + 2;
      const edges = new LineSegments(this.#merge(contextEdges), contextEdge);
      edges.renderOrder = order + 3;
      group.add(fill, edges);
      this.#track(fill.geometry, edges.geometry);
    }
    for (const feature of floor.features ?? []) {
      this.#buildFeature(visual, feature);
    }
    this.#buildDetails(visual, order);

    // Floor tag at the footprint's nearest-left corner
    let tagX = Infinity;
    let tagZ = -Infinity;
    for (const part of floor.outline) {
      for (const [x, z] of part.outer) {
        if (x - z < tagX - tagZ) {
          tagX = x;
          tagZ = z;
        }
      }
    }
    visual.tag = this.#makeLabel(
      floor.label,
      "explorer-floor-tag",
      visual,
      new Vector3(tagX, 0, tagZ),
      60,
      false
    );
    visual.tag.element.dataset.floorId = floor.id;
    return visual;
  }

  /** Merges geometries (disposing the inputs). */
  #merge(geometries: BufferGeometry[]): BufferGeometry {
    const merged =
      geometries.length === 1
        ? geometries[0]
        : mergeGeometries(geometries.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (geometries.length > 1) {
      for (const geometry of geometries) {
        geometry.dispose();
      }
    }
    return merged;
  }

  /**
   * Adds a room's label and, for selectable rooms, its own meshes. Returns the
   * geometry of a non-selectable room (at its final height) for merging.
   */
  #buildRoom(visual: FloorVisual, room: IndoorRoom, order: number): BufferGeometry | null {
    const selectable = this.#options.selectable.has(room.id);
    const h = visual.floor.vertical.height;
    const baseHeight = h * (selectable ? SELECTABLE_ROOM_HEIGHT : ROOM_HEIGHT);
    // Extrude to unit height and scale, so selection can raise the room cheaply
    const geometry = extrude(room.footprint, 1);
    let fill: RoomVisual["fill"] = null;
    let edges: RoomVisual["edges"] = null;
    if (selectable) {
      const material = new MeshLambertMaterial({
        color: this.#palette.room,
        transparent: true,
        depthWrite: false,
      });
      fill = new Mesh(geometry, material);
      fill.scale.y = baseHeight;
      fill.renderOrder = order + 4;
      fill.userData.roomId = room.id;
      const edgeGeometry = new EdgesGeometry(geometry, 25);
      const edgeMaterial = new LineBasicMaterial({
        color: this.#palette.roomEdge,
        transparent: true,
        depthWrite: false,
      });
      edges = new LineSegments(edgeGeometry, edgeMaterial);
      edges.scale.y = baseHeight;
      edges.renderOrder = order + 5;
      visual.group.add(fill, edges);
      this.#track(geometry, material, edgeGeometry, edgeMaterial);
    } else {
      geometry.scale(1, baseHeight, 1);
    }

    const [cx, cz] = room.labelAt ?? ringCentroid(room.footprint.outer);
    const roomVisual: RoomVisual = {
      room,
      floor: visual,
      fill,
      edges,
      baseHeight,
      height: baseHeight,
      selectable,
      status: "not-tracked",
      center: new Vector3(cx, 0, cz),
    };
    roomVisual.label = this.#makeLabel(
      room.label,
      selectable ? "explorer-room-label selectable" : "explorer-room-label",
      visual,
      new Vector3(cx, baseHeight, cz),
      selectable ? 50 : room.name ? 20 : 10,
      !selectable
    );
    roomVisual.label.room = roomVisual;
    roomVisual.label.element.dataset.roomId = room.id;
    visual.rooms.push(roomVisual);
    this.#rooms.set(room.id, roomVisual);
    return selectable ? null : geometry;
  }

  #buildFeature(visual: FloorVisual, feature: IndoorFeature): void {
    const detailed = !!visual.floor.planDrawing;
    const text =
      feature.kind === "elevator"
        ? "Elevator"
        : feature.kind === "restroom"
        ? "Restrooms"
        : feature.kind === "stairs"
        ? "Stairs"
        : feature.label ?? "Entrance";
    this.#makeLabel(
      feature.label ?? text,
      `explorer-feature-label feature-${feature.kind}`,
      visual,
      new Vector3(feature.at[0], detailed ? visual.floor.vertical.height * 0.2 : 0.05, feature.at[1]),
      detailed ? 25 : 5,
      true
    );
  }

  /** Low relief furniture and circulation symbols; heights are illustrative. */
  #buildDetails(visual: FloorVisual, order: number): void {
    if (!visual.floor.details?.length && !visual.floor.planDrawing) return;
    const h = visual.floor.vertical.height;
    const groups = new Map<string, BufferGeometry[]>();
    const add = (color: string, geometry: BufferGeometry) => {
      const list = groups.get(color) ?? [];
      list.push(geometry);
      groups.set(color, list);
    };
    const box = (x: number, y: number, z: number, w: number, height: number, d: number) =>
      new BoxGeometry(w, height, d).translate(x, y + height / 2, z);
    for (const detail of visual.floor.details ?? []) {
      const shelf = detail.kind === "shelf";
      const topY = h * (shelf ? 0.28 : 0.13);
      const [x, z] = ringCentroid(detail.footprint.outer);
      // Keep exact traced footprints for tops; a central pedestal avoids invented chair positions.
      add(shelf ? "#b9a17e" : "#e0c8a0", extrude(detail.footprint, h * 0.035).translate(0, topY, 0));
      if (shelf) {
        for (const level of [0.025, 0.11, 0.195]) {
          add("#789aab", extrude(detail.footprint, h * 0.065).translate(0, h * level, 0));
        }
      } else {
        add("#7c8794", box(x, 0.015, z, h * 0.065, topY, h * 0.065));
        if (detail.kind === "computer") {
          add("#456b84", box(x, topY, z, h * 0.18, h * 0.12, h * 0.035));
        }
      }
    }
    for (const feature of visual.floor.features ?? []) {
      const [x, z] = feature.at;
      const size = h * 0.38;
      if (feature.kind === "stairs") {
        for (let step = 0; step < 6; step++) {
          add("#98aabd", box(x, 0, z + (step - 2.5) * size / 6,
            size * 0.7, (step + 1) * h * 0.035, size / 6));
        }
      } else if (feature.kind === "elevator") {
        add("#7f99ae", box(x, 0, z, size, h * 0.32, size));
        for (const side of [-1, 1]) {
          add("#d4e1e8", box(x + side * size * 0.19, h * 0.025,
            z + size * 0.505, size * 0.34, h * 0.25, h * 0.015));
        }
      }
    }
    for (const [color, parts] of groups) {
      const geometry = this.#merge(parts);
      const material = new MeshLambertMaterial({ color, transparent: true, depthWrite: false });
      material.userData.base = 0.92;
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = order + 3;
      visual.group.add(mesh);
      visual.fadeMaterials.push(material);
      this.#track(geometry, material);
    }
  }

  /** Load only the selected floor's drawing. A failed image leaves the 3D model usable. */
  #loadDrawing(visual: FloorVisual): void {
    const drawing = visual.floor.planDrawing;
    const transform = visual.floor.transforms?.find((t) => t.source === drawing?.source);
    if (!drawing || !transform?.imageSizePx || visual.drawing || visual.drawingLoading) return;
    visual.drawingLoading = true;
    new TextureLoader().load(drawing.url, (texture) => {
      visual.drawingLoading = false;
      if (this.#disposed || this.#display.floor !== visual.floor.id) {
        texture.dispose();
        return;
      }
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.#renderer.renderer.capabilities.getMaxAnisotropy());
      const geometry = this.#merge(visual.floor.outline.map((part) => flat(part, 0.025)));
      const position = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      for (let i = 0; i < position.count; i++) {
        const [u, v] = planUV([position.getX(i), position.getZ(i)], transform);
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
      const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = visual.index * 10 + 1;
      visual.drawing = mesh;
      visual.group.add(mesh);
      this.#track(geometry, material, texture);
      this.#appearanceDirty = true;
      this.requestRender();
    }, undefined, () => { visual.drawingLoading = false; });
  }

  setPlanVisible(visible: boolean): void {
    this.#planVisible = visible;
    const floor = this.#floors.find((f) => f.floor.id === this.#display.floor);
    if (visible && floor) this.#loadDrawing(floor);
    this.#appearanceDirty = true;
    this.requestRender();
  }

  topView(): void {
    const { target, radius } = this.#viewTarget();
    const aspect = this.#rect.width / Math.max(1, this.#rect.height);
    const vertical = FOV * Math.PI / 360;
    const angle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
    const distance = radius / Math.sin(angle) * 1.05;
    this.#animateCamera(target.clone().add(new Vector3(0, distance, distance * 0.001)),
      target, !this.#options.reducedMotion);
  }

  // ---- Public API -------------------------------------------------------

  /** Shows the scene and plays the intro. Replaces any running intro. */
  activate(mode: IntroMode): void {
    if (this.#disposed) {
      return;
    }
    this.#renderer.acquire(this, this.#options.stage);
    this.#active = true;
    this.#finishIntro(false);
    if (!this.#framed && this.#updateViewport()) {
      // Frame once the stage has a real size
      this.#framed = true;
      this.#frameCamera(false, true);
    }
    const effective: IntroMode =
      this.#options.reducedMotion && mode === "rise" ? "fade" : mode;
    if (effective === "none") {
      this.#setReveal(() => 1);
      this.#setLabelsShown(true);
    } else {
      this.#setReveal(() => 0);
      this.#setLabelsShown(false);
      this.#intro = { mode: effective, start: performance.now() };
    }
    this.#appearanceDirty = true;
    this.#settle(300);
  }

  deactivate(): void {
    this.#active = false;
    this.#finishIntro(false);
    this.#hovered = null;
    this.#renderer.release(this);
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** Skips to the end of the intro (e.g. when the user starts interacting). */
  skipIntro(): void {
    if (this.#intro) {
      this.#finishIntro(true);
      this.requestRender();
    }
  }

  setDisplay(display: DisplayMode): void {
    const changedFloor = display.floor !== this.#display.floor;
    const changedExplode = display.exploded !== this.#display.exploded;
    if (!changedFloor && !changedExplode) {
      return;
    }
    this.#display = display;
    // Keep only one full-resolution drawing on the GPU, including after rapid floor changes.
    for (const floor of this.#floors) {
      const drawing = floor.drawing;
      if (drawing && floor.floor.id !== display.floor) {
        floor.group.remove(drawing);
        const resources = [drawing.geometry, drawing.material, drawing.material.map!];
        for (const resource of resources) {
          resource.dispose();
          const i = this.#disposables.indexOf(resource);
          if (i >= 0) this.#disposables.splice(i, 1);
        }
        floor.drawing = undefined;
      }
    }
    const selectedFloor = this.#floors.find((f) => f.floor.id === display.floor);
    if (this.#planVisible && selectedFloor) this.#loadDrawing(selectedFloor);
    this.#appearanceDirty = true;
    const instant = this.#options.reducedMotion;
    for (const floor of this.#floors) {
      const { y, presence } = this.#targetFor(floor);
      this.#tween(`y:${floor.floor.id}`, floor.displayY, y, instant, (value) => {
        floor.displayY = value;
        this.#placeFloor(floor);
      });
      this.#tween(`p:${floor.floor.id}`, floor.presence, presence, instant, (value) => {
        floor.presence = value;
        this.#appearanceDirty = true;
      });
    }
    this.#frameCamera(!instant, false);
    this.requestRender();
  }

  setSelected(roomId: string | null, focus: boolean): void {
    if (roomId === this.#selected) {
      return;
    }
    const previous = this.#selected ? this.#rooms.get(this.#selected) : null;
    this.#selected = roomId;
    const room = roomId ? this.#rooms.get(roomId) : null;
    const instant = this.#options.reducedMotion;
    if (previous?.fill) {
      this.#tween(`h:${previous.room.id}`, previous.height, previous.baseHeight, instant, (value) =>
        this.#setRoomHeight(previous, value)
      );
    }
    if (room) {
      if (room.fill) {
        const target = room.floor.floor.vertical.height * SELECTED_ROOM_HEIGHT;
        this.#tween(`h:${room.room.id}`, room.height, target, instant, (value) =>
          this.#setRoomHeight(room, value)
        );
      }
      room.floor.group.add(this.#beacon);
      this.#beacon.position.set(room.center.x, 0, room.center.z);
      this.#beacon.visible = true;
      if (focus) {
        this.#focusOn(room);
      }
    } else {
      this.#beacon.visible = false;
    }
    this.#appearanceDirty = true;
    this.requestRender();
  }

  setHovered(roomId: string | null): void {
    if (roomId !== this.#hovered) {
      this.#hovered = roomId;
      this.#appearanceDirty = true;
      this.requestRender();
    }
  }

  setStatuses(statuses: ReadonlyMap<string, RoomStatusKind>): void {
    for (const [id, room] of this.#rooms) {
      const status = statuses.get(id) ?? "not-tracked";
      if (room.status !== status) {
        room.status = status;
        if (room.label) {
          room.label.element.dataset.status = status;
          room.label.element.dataset.glyph = STATUS_GLYPHS[status];
        }
      }
    }
    this.#appearanceDirty = true;
    this.requestRender();
  }

  /** Shows text after each floor's tag, e.g. how many classrooms it has. */
  setFloorBadges(badges: ReadonlyMap<string, string>): void {
    for (const floor of this.#floors) {
      const badge = badges.get(floor.floor.id);
      const text = badge ? `${floor.floor.label} · ${badge}` : floor.floor.label;
      const { element } = floor.tag;
      if (element.textContent !== text) {
        element.textContent = text;
        floor.tag.width = element.offsetWidth;
        floor.tag.height = element.offsetHeight;
      }
    }
    this.requestRender();
  }

  /** Adds nearby campus buildings around the model (once), if it's placed on campus. */
  setContext(campus: CampusData): void {
    const geo = this.#options.layout.geo;
    if (!geo || this.#context || this.#disposed) {
      return;
    }
    const own = new Set(geo.caans);
    const angle = (geo.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const scale = geo.unitsPerMeter;
    const reach = Math.max(120, (this.#radius / scale) * 2.4);
    const fills: BufferGeometry[] = [];
    const edges: BufferGeometry[] = [];
    for (const building of campus.buildings) {
      if (building.caan && own.has(building.caan)) {
        continue;
      }
      const near = building.rings.some((ring) =>
        ring.some(([x, z]) => Math.hypot(x - geo.origin[0], z - geo.origin[1]) < reach)
      );
      if (!near) {
        continue;
      }
      const rings = building.rings.map((ring) =>
        ring.map(([x, z]): [number, number] => {
          const dx = x - geo.origin[0];
          const dz = z - geo.origin[1];
          return [(dx * cos - dz * sin) * scale, (dx * sin + dz * cos) * scale];
        })
      );
      const height = Math.max(building.top - building.base, 1) * scale;
      for (const polygon of toPolygons(rings)) {
        try {
          const geometry = extrude(polygon, height);
          geometry.translate(0, (building.base - geo.groundElevation) * scale, 0);
          fills.push(geometry);
          edges.push(new EdgesGeometry(geometry, 30));
        } catch {
          // Skip footprints three.js can't triangulate
        }
      }
    }
    if (fills.length === 0) {
      return;
    }
    const fill = new MeshLambertMaterial({
      color: this.#palette.context,
      transparent: true,
      depthWrite: false,
    });
    const edge = new LineBasicMaterial({
      color: this.#palette.contextEdge,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new Mesh(this.#merge(fills), fill);
    mesh.renderOrder = -2;
    const lines = new LineSegments(this.#merge(edges), edge);
    lines.renderOrder = -1;
    this.#model.add(mesh, lines);
    this.#track(mesh.geometry, lines.geometry, fill, edge);
    this.#context = { fill, edge };
    this.#appearanceDirty = true;
    this.requestRender();
  }

  resetView(): void {
    this.#frameCamera(!this.#options.reducedMotion, true);
  }

  rotate(degrees: number): void {
    const offset = this.#camera.position.clone().sub(this.#controls.target);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta += (degrees * Math.PI) / 180;
    offset.setFromSpherical(spherical);
    this.#animateCamera(
      this.#controls.target.clone().add(offset),
      this.#controls.target.clone(),
      !this.#options.reducedMotion
    );
  }

  zoom(factor: number): void {
    const offset = this.#camera.position.clone().sub(this.#controls.target);
    const length = Math.min(
      Math.max(offset.length() * factor, this.#controls.minDistance),
      this.#controls.maxDistance
    );
    offset.setLength(length);
    this.#animateCamera(
      this.#controls.target.clone().add(offset),
      this.#controls.target.clone(),
      !this.#options.reducedMotion
    );
  }

  /** Keeps rendering briefly, e.g. while a CSS transition moves the stage. */
  nudge(): void {
    this.#settle(450);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.deactivate();
    this.#disposed = true;
    const { stage, labelLayer } = this.#options;
    stage.removeEventListener("pointerdown", this.#handlePointerDown);
    stage.removeEventListener("pointermove", this.#handlePointerMove);
    stage.removeEventListener("pointerup", this.#handlePointerUp);
    stage.removeEventListener("pointercancel", this.#handlePointerCancel);
    stage.removeEventListener("pointerleave", this.#handlePointerLeave);
    this.#resizeObserver.disconnect();
    this.#controls.removeEventListener("change", this.#handleControlsChange);
    this.#controls.removeEventListener("start", this.#handleControlsStart);
    this.#controls.dispose();
    for (const item of this.#disposables) {
      item.dispose();
    }
    this.#disposables.length = 0;
    for (const label of this.#labels) {
      label.element.remove();
    }
    labelLayer.replaceChildren();
    this.#scene.clear();
  }

  // ---- RendererOwner ---------------------------------------------------

  onContextChange(lost: boolean): void {
    this.#contextLost = lost;
    this.#options.onContextChange(lost);
    if (!lost) {
      this.#appearanceDirty = true;
      this.requestRender();
    }
  }

  // ---- Rendering --------------------------------------------------------

  requestRender = (): void => {
    if (!this.#frame && this.#active && !this.#disposed) {
      this.#frame = requestAnimationFrame(this.#render);
    }
  };

  #settle(ms: number): void {
    this.#settleUntil = Math.max(this.#settleUntil, performance.now() + ms);
    this.requestRender();
  }

  #render = (now: number): void => {
    this.#frame = 0;
    if (!this.#active || this.#disposed || this.#contextLost) {
      return;
    }
    if (!this.#renderer.isOwner(this)) {
      return;
    }
    let animating = now < this.#settleUntil;
    animating = this.#stepTweens(now) || animating;
    animating = this.#stepIntro(now) || animating;
    if (this.#appearanceDirty) {
      this.#applyAppearance();
    }

    const visible = this.#updateViewport();
    this.#renderer.clear();
    if (visible) {
      this.#renderer.renderer.render(this.#scene, this.#camera);
      this.#updateLabels();
    }
    if (animating) {
      this.requestRender();
    }
  };

  /** Sizes the canvas and camera to the stage. Returns false if hidden. */
  #updateViewport(): boolean {
    const { stage } = this.#options;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width < 2 || height < 2) {
      return false;
    }
    const resized = this.#renderer.setSize(width, height);
    if (resized || this.#rect.width !== width || this.#rect.height !== height) {
      this.#rect = { left: 0, top: 0, width, height };
      this.#camera.aspect = width / height;
      this.#camera.updateProjectionMatrix();
    }
    return true;
  }

  #setReveal(reveal: (floor: FloorVisual) => number): void {
    for (const floor of this.#floors) {
      floor.reveal = reveal(floor);
      this.#placeFloor(floor);
    }
    this.#appearanceDirty = true;
  }

  /** Floors that haven't risen yet sit lower. */
  #placeFloor(floor: FloorVisual): void {
    floor.group.position.y = floor.displayY - (1 - floor.reveal) * this.#storyHeight * 0.9;
  }

  #applyAppearance(): void {
    this.#appearanceDirty = false;
    const palette = this.#palette;
    for (const floor of this.#floors) {
      const p = floor.presence;
      const reveal = floor.reveal;
      const shown = p > 0.001 && reveal > 0.001;
      floor.group.visible = shown;
      if (floor.drawing) {
        floor.drawing.visible = this.#planVisible && this.#display.floor === floor.floor.id;
        floor.drawing.material.opacity = 0.9 * p * reveal;
      }
      floor.slabMaterial.opacity = floor.slabMaterial.userData.base * p * reveal;
      floor.slabEdgeMaterial.opacity =
        floor.slabEdgeMaterial.userData.base * Math.max(p, p > 0 ? 0.35 : 0) * reveal;
      for (const material of floor.fadeMaterials) {
        material.opacity = material.userData.base * p * reveal;
      }
      // Room fills fade out faster than outlines when a floor is only context
      const fillPresence = smoothstep(GHOST_PRESENCE, 1, p);
      floor.contextFill.opacity = 0.3 * fillPresence * reveal;
      floor.contextEdge.opacity = 0.45 * Math.max(fillPresence, p * 0.6) * reveal;
      for (const room of floor.rooms) {
        if (!room.fill || !room.edges) {
          continue;
        }
        const selected = room.room.id === this.#selected;
        const hovered = room.room.id === this.#hovered;
        const tracked = room.status !== "not-tracked";
        const fill = room.fill.material;
        const edge = room.edges.material;
        fill.color.copy(tracked ? palette.status[room.status] : palette.room);
        if (selected || hovered) {
          fill.color.lerp(palette.selectedEdge, selected ? 0.18 : 0.1);
        }
        const baseFill = selected ? 0.95 : tracked ? 0.8 : 0.5;
        fill.opacity = baseFill * fillPresence * reveal;
        edge.color.copy(
          selected || hovered ? palette.selectedEdge : tracked ? palette.status[room.status] : palette.roomEdge
        );
        edge.opacity =
          (selected ? 1 : hovered ? 0.95 : tracked ? 0.9 : 0.45) *
          Math.max(fillPresence, p * 0.6) *
          reveal;
        room.fill.visible = shown && fillPresence > 0.01;
      }
    }
    const selectedFloor = this.#selected ? this.#rooms.get(this.#selected)?.floor : null;
    this.#beacon.visible = !!selectedFloor && selectedFloor.presence > 0.5;
    for (const child of this.#beacon.children as Mesh<BufferGeometry, MeshBasicMaterial>[]) {
      child.material.opacity = selectedFloor?.reveal ?? 0;
    }
    const groundReveal = this.#floors[0]?.reveal ?? 1;
    this.#shadow.material.opacity = groundReveal;
    if (this.#context) {
      // Neighbors recede further when a single floor is shown
      const dim = this.#display.floor ? 0.45 : 1;
      this.#context.fill.opacity = 0.32 * dim * groundReveal;
      this.#context.edge.opacity = 0.4 * dim * groundReveal;
    }
  }

  /** Whether every floor has finished its intro. */
  #fullyRevealed(): boolean {
    return this.#floors.every((floor) => floor.reveal > 0.99);
  }

  #updateLabels(): void {
    const show = this.#labelsShown && this.#fullyRevealed();
    const isolated = this.#display.floor;
    const stacked = !isolated && !this.#display.exploded;
    const projected = new Vector3();
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const candidates: { label: LabelEntry; x: number; y: number; priority: number }[] = [];
    const { width, height } = this.#rect;

    for (const label of this.#labels) {
      let visible = show && label.floor.presence > 0.95;
      const room = label.room;
      const isSelected = !!room && room.room.id === this.#selected;
      const isHovered = !!room && room.room.id === this.#hovered;
      if (visible) {
        if (label === label.floor.tag) {
          // Stacked floors' tags would pile up (shells have no room labels, so
          // collision avoidance is enough there); the floor buttons cover that view
          visible =
            this.#options.layout.geometryStatus === "exterior-shell"
              ? !isolated || isolated === label.floor.floor.id
              : !isolated && this.#display.exploded;
        } else if (label.isolatedOnly && !isSelected && !isHovered) {
          visible = isolated === label.floor.floor.id;
        } else if (stacked && !isSelected && !isHovered) {
          visible = false;
        }
      }
      if (!visible) {
        label.element.classList.add("explorer-label-hidden");
        continue;
      }
      projected
        .copy(label.local)
        .setY(room ? room.height + 0.05 : label.local.y)
        .add(label.floor.group.position);
      projected.project(this.#camera);
      if (projected.z > 1) {
        label.element.classList.add("explorer-label-hidden");
        continue;
      }
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      candidates.push({
        label,
        x,
        y,
        priority: isSelected ? 1000 : isHovered ? 900 : label.priority,
      });
    }
    candidates.sort((a, b) => b.priority - a.priority);
    for (const candidate of candidates) {
      const { label, y, priority } = candidate;
      const halfWidth = label.width / 2 + 2;
      // Floor tags are anchored at a corner that may be off-stage; keep them readable
      const x =
        label === label.floor.tag
          ? Math.min(Math.max(candidate.x, halfWidth + 4), width - halfWidth - 4)
          : candidate.x;
      const halfHeight = label.height / 2 + 1;
      const box = { x0: x - halfWidth, y0: y - halfHeight, x1: x + halfWidth, y1: y + halfHeight };
      const outside = box.x1 < 0 || box.y1 < 0 || box.x0 > width || box.y0 > height;
      const overlaps =
        priority < 900 &&
        placed.some(
          (other) =>
            box.x0 < other.x1 && box.x1 > other.x0 && box.y0 < other.y1 && box.y1 > other.y0
        );
      if (outside || overlaps) {
        label.element.classList.add("explorer-label-hidden");
        continue;
      }
      placed.push(box);
      const { element } = label;
      element.classList.remove("explorer-label-hidden");
      element.classList.toggle("selected", priority === 1000);
      element.classList.toggle("hovered", priority === 900);
      element.style.transform = `translate(${Math.round(x - label.width / 2)}px, ${Math.round(
        y - label.height / 2
      )}px)`;
    }
  }

  #setLabelsShown(shown: boolean): void {
    this.#labelsShown = shown;
    this.#options.labelLayer.classList.toggle("explorer-labels-shown", shown);
  }

  // ---- Animation --------------------------------------------------------

  #tween(
    key: string,
    from: number,
    to: number,
    instant: boolean,
    set: (value: number) => void
  ): void {
    this.#tweens = this.#tweens.filter((tween) => tween.key !== key);
    if (instant || from === to) {
      set(to);
      return;
    }
    this.#tweens.push({ key, from, to, start: performance.now(), duration: TWEEN_MS, set });
  }

  #stepTweens(now: number): boolean {
    if (this.#tweens.length === 0) {
      return false;
    }
    this.#tweens = this.#tweens.filter((tween) => {
      const t = Math.min((now - tween.start) / tween.duration, 1);
      tween.set(tween.from + (tween.to - tween.from) * easeInOut(t));
      return t < 1;
    });
    return true;
  }

  #stepIntro(now: number): boolean {
    const intro = this.#intro;
    if (!intro) {
      return false;
    }
    const t = (now - intro.start) / 1000;
    let end: number;
    if (intro.mode === "fade") {
      end = FADE_INTRO_END;
      const reveal = smoothstep(0, end, t);
      for (const floor of this.#floors) {
        floor.reveal = reveal;
      }
      this.#appearanceDirty = true;
    } else {
      // Floors rise in order from the bottom
      end = (this.#floors.length - 1) * RISE_STAGGER + RISE_FLOOR_S;
      this.#setReveal((floor) => {
        const start = floor.index * RISE_STAGGER;
        return easeInOut(Math.min(Math.max((t - start) / RISE_FLOOR_S, 0), 1));
      });
    }
    if (t >= end) {
      this.#finishIntro(true);
    }
    return true;
  }

  #finishIntro(notify: boolean): void {
    if (!this.#intro) {
      return;
    }
    this.#intro = null;
    this.#setReveal(() => 1);
    this.#setLabelsShown(true);
    if (notify) {
      this.#options.onIntroEnd();
    }
  }

  // ---- Camera -----------------------------------------------------------

  #targetFor(floor: FloorVisual): { y: number; presence: number } {
    const { floor: isolated, exploded } = this.#display;
    const y =
      floor.physicalY + (exploded ? floor.index * this.#storyHeight * EXPLODE_GAP : 0);
    if (!isolated) {
      return { y, presence: 1 };
    }
    const isolatedIndex = this.#floors.findIndex((f) => f.floor.id === isolated);
    return {
      y,
      presence:
        floor.floor.id === isolated ? 1 : floor.index < isolatedIndex ? GHOST_PRESENCE : 0,
    };
  }

  #applyDisplayInstantly(): void {
    for (const floor of this.#floors) {
      const { y, presence } = this.#targetFor(floor);
      floor.displayY = y;
      floor.group.position.y = y;
      floor.presence = presence;
    }
    this.#appearanceDirty = true;
  }

  /** Center and size of what should be in view for the current display mode. */
  #viewTarget(): { target: Vector3; radius: number } {
    const shown = this.#floors.filter((floor) => this.#targetFor(floor).presence === 1);
    if (shown.length === 0) {
      // Selecting a floor known only from listings leaves an empty scene. Keep
      // a finite camera frame so switching back to a mapped floor still works.
      return { target: this.#center.clone(), radius: this.#radius };
    }
    // Frame the selected floor's footprint, rather than the widest part of
    // the building. Geisel's upper tower floors are much smaller than its base.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const floor of shown) {
      const y = this.#targetFor(floor).y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + floor.floor.vertical.height);
      for (const part of floor.floor.outline) {
        for (const [x, z] of part.outer) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    const target = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    return { target, radius };
  }

  #frameCamera(animate: boolean, resetOrientation: boolean): void {
    const { target, radius } = this.#viewTarget();
    const aspect = this.#rect.width > 0 ? this.#rect.width / this.#rect.height : 1.4;
    const vertical = (FOV * Math.PI) / 360;
    const horizontal = Math.atan(Math.tan(vertical) * aspect);
    // A bounding sphere overstates wide, low buildings seen from above at an angle
    const distance = (radius / Math.sin(Math.min(vertical, horizontal))) * 0.74;
    let direction: Vector3;
    if (resetOrientation) {
      // Three-quarter view from the plan's lower right
      const azimuth = (28 * Math.PI) / 180;
      const elevation = (40 * Math.PI) / 180;
      direction = new Vector3(
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.cos(azimuth) * Math.cos(elevation)
      );
    } else {
      direction = this.#camera.position.clone().sub(this.#controls.target).normalize();
    }
    const position = target.clone().addScaledVector(direction, distance);
    this.#animateCamera(position, target, animate);
  }

  #focusOn(room: RoomVisual): void {
    const target = room.center.clone().setY(this.#targetFor(room.floor).y);
    // Pan halfway toward the room so it's in view without losing context
    const currentTarget = this.#controls.target.clone();
    const nextTarget = currentTarget.clone().lerp(target, 0.5);
    const position = this.#camera.position.clone().add(nextTarget.clone().sub(currentTarget));
    this.#animateCamera(position, nextTarget, !this.#options.reducedMotion);
  }

  #animateCamera(position: Vector3, target: Vector3, animate: boolean): void {
    const fromPosition = this.#camera.position.clone();
    const fromTarget = this.#controls.target.clone();
    const apply = (t: number) => {
      this.#camera.position.lerpVectors(fromPosition, position, t);
      this.#controls.target.lerpVectors(fromTarget, target, t);
      this.#camera.lookAt(this.#controls.target);
      this.#controls.update();
    };
    this.#tween("camera", 0, 1, !animate, apply);
    this.requestRender();
  }

  #setRoomHeight(room: RoomVisual, height: number): void {
    room.height = height;
    if (room.fill && room.edges) {
      room.fill.scale.y = height;
      room.edges.scale.y = height;
    }
    this.requestRender();
  }

  // ---- Input ------------------------------------------------------------

  #handleControlsChange = () => this.requestRender();

  #handleControlsStart = () => {
    // User input wins over programmatic camera moves
    this.#tweens = this.#tweens.filter((tween) => tween.key !== "camera");
  };

  #handlePointerDown = (event: PointerEvent) => {
    this.skipIntro();
    this.#pointer = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      id: event.pointerId,
      target: event.target as HTMLElement | null,
    };
  };

  #handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.buttons !== 0) {
      return;
    }
    const queued = this.#hoverQueued;
    this.#hoverQueued = { x: event.clientX, y: event.clientY };
    if (!queued) {
      requestAnimationFrame(() => {
        const point = this.#hoverQueued;
        this.#hoverQueued = null;
        if (point && !this.#disposed && this.#active) {
          const id = this.#pick(point.x, point.y, null);
          if (id !== this.#hovered) {
            this.setHovered(id);
            this.#options.onHover(id);
          }
          this.#options.stage.style.cursor = id ? "pointer" : "";
        }
      });
    }
  };

  #handlePointerUp = (event: PointerEvent) => {
    const down = this.#pointer;
    this.#pointer = null;
    if (!down || down.id !== event.pointerId) {
      return;
    }
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > TAP_SLOP_PX || performance.now() - down.time > TAP_MAX_MS) {
      return;
    }
    const target = down.target;
    const floorId = target?.closest<HTMLElement>("[data-floor-id]")?.dataset.floorId;
    if (floorId) {
      this.#options.onFloorTag(floorId);
      return;
    }
    const id =
      this.#pick(event.clientX, event.clientY, target) ??
      (event.pointerType === "mouse" ? null : this.#nearestRoom(event.clientX, event.clientY));
    if (id) {
      this.#options.onSelect(id);
    }
  };

  #handlePointerCancel = () => {
    this.#pointer = null;
  };

  #handlePointerLeave = () => {
    this.#options.stage.style.cursor = "";
    if (this.#hovered) {
      this.setHovered(null);
      this.#options.onHover(null);
    }
  };

  /** Returns the selectable room under a client point, if any. */
  #pick(clientX: number, clientY: number, target: HTMLElement | null): string | null {
    const labelRoom = target?.closest<HTMLElement>("[data-room-id]")?.dataset.roomId;
    if (labelRoom && this.#options.selectable.has(labelRoom)) {
      return labelRoom;
    }
    if (!this.#fullyRevealed()) {
      return null;
    }
    const rect = this.#options.stage.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.#scene.updateMatrixWorld();
    this.#camera.updateMatrixWorld();
    this.#raycaster.setFromCamera(ndc, this.#camera);
    const meshes: Object3D[] = [];
    for (const room of this.#rooms.values()) {
      if (room.fill && room.floor.presence > 0.9 && room.fill.visible) {
        meshes.push(room.fill);
      }
    }
    const [hit] = this.#raycaster.intersectObjects(meshes, false);
    return (hit?.object.userData.roomId as string | undefined) ?? null;
  }

  /** The selectable room whose center is closest to a client point, within reach of a finger. */
  #nearestRoom(clientX: number, clientY: number): string | null {
    if (!this.#fullyRevealed()) {
      return null;
    }
    const rect = this.#options.stage.getBoundingClientRect();
    const point = new Vector3();
    let best: string | null = null;
    let bestDistance = TOUCH_PICK_PX;
    for (const room of this.#rooms.values()) {
      if (!room.fill || room.floor.presence < 0.9) {
        continue;
      }
      point
        .copy(room.center)
        .setY(room.height)
        .add(room.floor.group.position)
        .project(this.#camera);
      const x = rect.left + ((point.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - point.y) / 2) * rect.height;
      const distance = Math.hypot(x - clientX, y - clientY);
      if (distance < bestDistance) {
        best = room.room.id;
        bestDistance = distance;
      }
    }
    return best;
  }
}

/** Throws if WebGL can't be initialized. */
export function createIndoorScene(options: IndoorSceneOptions): IndoorScene {
  return new IndoorScene(options);
}

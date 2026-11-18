import { buildings } from "../../lib/buildings";
import { loadCampus } from "../../lib/indoor/campus";
import campusCodes from "../../lib/indoor/campusCodes.json";

const portal = "https://admin-enterprise-gis.ucsd.edu/portal";
const sceneId = "af8fa76860bb42deb91fe57cc600ead5";
export const campusSceneUrl = `${portal}/home/webscene/viewer.html?webscene=${sceneId}`;
const sdkUrl = "https://js.arcgis.com/4.33/";
const identifiers: Record<string, string[]> = campusCodes;

type CameraOptions = {
  position: { latitude: number; longitude: number; z: number };
  heading: number;
  tilt: number;
  fov: number;
};
type Camera = object;
type WebScene = { load(): Promise<unknown>; destroy(): void; basemap: object };
type SceneView = {
  when(): Promise<unknown>;
  goTo(camera: Camera, options: { animate: boolean }): Promise<unknown>;
  destroy(): void;
  fatalError: unknown;
  ui: { move(name: string, position: string): void };
};
type Modules = [
  new (options: { portalItem: { id: string; portal: { url: string } } }) => WebScene,
  new (options: {
    container: HTMLElement;
    map: WebScene;
    camera: Camera;
    viewingMode: "global";
    qualityProfile: "high";
    ui: { components: string[] };
  }) => SceneView,
  new (options: CameraOptions) => Camera,
  { watch<T>(value: () => T, notify: (value: T) => void): { remove(): void } },
  new (options: { baseLayers: object[] }) => object,
  new (options: { url: string }) => object,
];
type AmdWindow = {
  require?: (paths: string[], ready: (...modules: Modules) => void, error: (error: unknown) => void) => void;
};

let sdk: Promise<Modules> | undefined;
function loadSdk() {
  return sdk ??= new Promise<Modules>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = sdkUrl + "esri/themes/light/main.css";
    const script = document.createElement("script");
    script.src = sdkUrl;
    const fail = () => {
      clearTimeout(timeout);
      css.remove();
      script.remove();
      reject(new Error("The 3D map engine could not load."));
    };
    const timeout = window.setTimeout(fail, 30_000);
    script.onerror = fail;
    script.onload = () => {
      const amd = (window as unknown as AmdWindow).require;
      if (!amd) {
        fail();
        return;
      }
      amd([
        "esri/WebScene", "esri/views/SceneView", "esri/Camera",
        "esri/core/reactiveUtils", "esri/Basemap", "esri/layers/TileLayer",
      ], (...modules) => {
        clearTimeout(timeout);
        resolve(modules);
      }, fail);
    };
    document.head.append(css, script);
  }).catch((error: unknown) => {
    sdk = undefined;
    throw error;
  });
}

export type CampusPosition = {
  name: string;
  latitude: number;
  longitude: number;
  ground: number;
  height: number;
};

export async function campusPosition(code: string | null): Promise<CampusPosition | null> {
  const building = code ? buildings[code] : undefined;
  if (!code || !building) return null;
  const ids = identifiers[code] ?? [];
  const parts = (await loadCampus().catch(() => null))?.buildings.filter(
    (part) => part.caan !== null && ids.includes(part.caan)
  ) ?? [];
  const ground = parts.length ? Math.min(...parts.map((part) => part.base)) : 105;
  const height = parts.length ? Math.max(...parts.map((part) => part.top)) - ground : 16;
  return {
    name: parts.find((part) => part.name)?.name ?? building.name,
    latitude: building.location[0],
    longitude: building.location[1],
    ground, height,
  };
}

function cameraOptions(container: HTMLElement, place: CampusPosition | null): CameraOptions {
  const { latitude, longitude, ground, height } = place ??
    { latitude: 32.879, longitude: -117.2378, ground: 85, height: 0 };
  const heading = place?.name === "Warren Lecture Hall" ? 135 : place ? 325 : 355;
  const tilt = place ? 58 : 22;
  const fov = 55;
  const pixelsWide = Math.max(1, container.clientWidth);
  const pixelsHigh = Math.max(1, container.clientHeight);
  const diagonal = Math.hypot(pixelsWide, pixelsHigh);
  const distance = place ? 135 : Math.max(4400 / pixelsWide, 4050 / pixelsHigh) *
    diagonal / (2 * Math.tan(fov * Math.PI / 360));
  const radians = Math.PI / 180;
  const horizontal = distance * Math.sin(tilt * radians);
  return {
    position: {
      latitude: latitude - horizontal * Math.cos(heading * radians) / 110574,
      longitude: longitude - horizontal * Math.sin(heading * radians) /
        (111320 * Math.cos(latitude * radians)),
      z: ground + height * .4 + distance * Math.cos(tilt * radians),
    },
    heading, tilt, fov,
  };
}

export type CampusScene = { focus(place: CampusPosition | null): void };

export async function openCampusScene(
  container: HTMLElement,
  initialPlace: CampusPosition | null,
  signal: AbortSignal,
  onError: () => void
): Promise<CampusScene> {
  const [WebScene, SceneView, Camera, reactive, Basemap, TileLayer] = await loadSdk();
  signal.throwIfAborted();
  const map = new WebScene({ portalItem: { id: sceneId, portal: { url: portal } } });
  let view: SceneView | undefined;
  let watch: { remove(): void } | undefined;
  const dispose = () => {
    watch?.remove();
    if (view) view.destroy();
    else map.destroy();
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await map.load();
    signal.throwIfAborted();
    map.basemap = new Basemap({ baseLayers: [
      new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" }),
    ] });
    const sceneView = view = new SceneView({
      container, map, camera: new Camera(cameraOptions(container, initialPlace)),
      viewingMode: "global", qualityProfile: "high",
      ui: { components: ["attribution", "compass", "navigation-toggle", "zoom"] },
    });
    await sceneView.when();
    signal.throwIfAborted();
    sceneView.ui.move("compass", "bottom-right");
    sceneView.ui.move("navigation-toggle", "bottom-right");
    sceneView.ui.move("zoom", "bottom-right");
    watch = reactive.watch(() => sceneView.fatalError, (error) => {
      if (error) onError();
    });
    return {
      focus(place) {
        if (!signal.aborted) void sceneView.goTo(new Camera(cameraOptions(container, place)), { animate: false }).catch(() => {});
      },
    };
  } catch (error) {
    if (!signal.aborted) {
      signal.removeEventListener("abort", dispose);
      dispose();
    }
    throw error;
  }
}

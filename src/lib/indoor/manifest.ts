import campusCodes from "./campusCodes.json";
import facilitiesIndex from "../../../static/indoor/facilities/index.json";
import { GeometryStatus } from "./schema";

export type IndoorManifestEntry = {
  /** Path relative to the site root, fetched on demand. */
  file: string;
  status: GeometryStatus;
};

/**
 * Buildings with indoor layouts. Kept in the main bundle (it's tiny) so the UI
 * knows which buildings have an explorer before fetching anything. Schematic
 * demos, if ever added, must use `status: "schematic-demo"` and live under
 * `indoor/schematic/` so they stay separate from source-traced data.
 *
 * `npm run validate:indoor` checks that this list matches `static/indoor/`.
 */
export const SOURCE_LAYOUTS: Record<string, IndoorManifestEntry> = {
  EBU3B: { file: "indoor/EBU3B.json", status: "source-traced" },
};

export const FACILITIES_LAYOUTS: Record<string, IndoorManifestEntry> =
  Object.fromEntries(
    facilitiesIndex.buildings.map((code) => [
      code,
      { file: `indoor/facilities/${code}.json`, status: "facilities-plan" },
    ])
  );

/** Facilities layouts take precedence, matching the completed local preview. */
export const INDOOR_MANIFEST: Record<string, IndoorManifestEntry> = {
  ...SOURCE_LAYOUTS,
  ...FACILITIES_LAYOUTS,
};

/** Campus-map building numbers for each registrar code (`npm run campus:build`). */
export const CAMPUS_CODES: Record<string, string[]> = campusCodes;

/** Whether the building has any 3D view: a detailed layout or at least an exterior shell. */
export function hasIndoorLayout(building: string): boolean {
  return (
    Object.hasOwn(INDOOR_MANIFEST, building) || Object.hasOwn(CAMPUS_CODES, building)
  );
}

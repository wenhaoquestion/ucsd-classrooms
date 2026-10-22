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

/** Reviewed supplements fill source gaps without changing the original inputs. */
export const SUPPLEMENTAL_LAYOUTS: Record<string, IndoorManifestEntry> = {
  ASANT: { file: "indoor/ASANT-meeting.json", status: "source-traced" },
  BRF2: { file: "indoor/BRF2-combined.json", status: "facilities-plan" },
  CALIT: { file: "indoor/CALIT-combined.json", status: "source-traced" },
  CENTR: { file: "indoor/CENTR-combined.json", status: "source-traced" },
  COA: { file: "indoor/COA-combined.json", status: "source-traced" },
  CSB: { file: "indoor/CSB-combined.json", status: "source-traced" },
  EBU1: { file: "indoor/EBU1-combined.json", status: "facilities-plan" },
  EBU2: { file: "indoor/EBU2-combined.json", status: "facilities-plan" },
  EBU3B: { file: "indoor/EBU3B-combined.json", status: "facilities-plan" },
  FAH: { file: "indoor/FAH.json", status: "source-traced" },
  GH: { file: "indoor/GH-combined.json", status: "source-traced" },
  HSS: { file: "indoor/HSS-combined.json", status: "source-traced" },
  JEANN: { file: "indoor/JEANN-combined.json", status: "source-traced" },
  LEDDN: { file: "indoor/LEDDN-combined.json", status: "source-traced" },
  MALK: { file: "indoor/MALK-combined.json", status: "facilities-plan" },
  MANDE: { file: "indoor/MANDE-combined.json", status: "facilities-plan" },
  MAYER: { file: "indoor/MAYER-combined.json", status: "facilities-plan" },
  MCC: { file: "indoor/MCC-combined.json", status: "facilities-plan" },
  MCGIL: { file: "indoor/MCGIL-combined.json", status: "source-traced" },
  MOS: { file: "indoor/MOS-combined.json", status: "source-traced" },
  "MYR-A": { file: "indoor/MYR-A.json", status: "facilities-plan" },
  PRICE: { file: "indoor/PRICE-combined.json", status: "facilities-plan" },
  SDSC: { file: "indoor/SDSC-combined.json", status: "source-traced" },
  SME: { file: "indoor/SME.json", status: "source-traced" },
  SOLIS: { file: "indoor/SOLIS-combined.json", status: "source-traced" },
  SSB: { file: "indoor/SSB-combined.json", status: "facilities-plan" },
  SSRB: { file: "indoor/SSRB-combined.json", status: "facilities-plan" },
  UNEXG: { file: "indoor/UNEXG-combined.json", status: "facilities-plan" },
  UNEXN: { file: "indoor/UNEXN-combined.json", status: "facilities-plan" },
  YORK: { file: "indoor/YORK-combined.json", status: "facilities-plan" },
};

/** Reviewed supplements take precedence over Facilities and original traces. */
export const INDOOR_MANIFEST: Record<string, IndoorManifestEntry> = {
  ...SOURCE_LAYOUTS,
  ...FACILITIES_LAYOUTS,
  ...SUPPLEMENTAL_LAYOUTS,
};

/** Campus-map building numbers for each registrar code (`npm run campus:build`). */
export const CAMPUS_CODES: Record<string, string[]> = campusCodes;

/** Whether the building has any 3D view: a detailed layout or at least an exterior shell. */
export function hasIndoorLayout(building: string): boolean {
  return (
    Object.hasOwn(INDOOR_MANIFEST, building) || Object.hasOwn(CAMPUS_CODES, building)
  );
}

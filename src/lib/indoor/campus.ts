import { Point2, Ring } from "./schema";

/**
 * Campus coordinates: meters east (`x`) and south (`z`) of a fixed origin near
 * the middle of campus, so north is local -z like on the source plans. An
 * equirectangular projection is accurate to well under a meter at this size.
 */
export const CAMPUS_ORIGIN: [lat: number, lon: number] = [32.8801, -117.234];

const METERS_PER_DEGREE_LAT = 110_574;
const METERS_PER_DEGREE_LON =
  111_320 * Math.cos((CAMPUS_ORIGIN[0] * Math.PI) / 180);

export function lonLatToCampus(lon: number, lat: number): Point2 {
  return [
    (lon - CAMPUS_ORIGIN[1]) * METERS_PER_DEGREE_LON,
    -(lat - CAMPUS_ORIGIN[0]) * METERS_PER_DEGREE_LAT,
  ];
}

/** One building part from the campus map (a building can have several). */
export type CampusBuilding = {
  /** UCSD building number (CAAN), or `null` for unnumbered structures. */
  caan: string | null;
  name: string | null;
  /** Outer rings and holes, in campus meters. */
  rings: Ring[];
  /** Ground and roof elevations above sea level, in meters. */
  base: number;
  top: number;
};

export type CampusData = {
  origin: [lat: number, lon: number];
  source: string;
  buildings: CampusBuilding[];
};

let campus: Promise<CampusData> | null = null;

/** Fetches the campus footprints once. Failures are retried on the next call. */
export function loadCampus(): Promise<CampusData> {
  if (!campus) {
    campus = fetch(new URL("campus/buildings.json", document.baseURI)).then(
      (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<CampusData>;
      }
    );
    campus.catch(() => {
      campus = null;
    });
  }
  return campus;
}

// Converts UCSD's public campus-map building layers into the campus context
// used by the 3D explorer: exterior footprints with ground and roof
// elevations, in meters around a fixed campus origin.
//
//   npm run campus:build -- <footprints.json> <attributes.json>
//
// Inputs (ArcGIS REST query results, f=json, outSR=4326):
//   footprints: .../Campus_Buildings_3D_Object/FeatureServer/0/query?where=1%3D1&outFields=*&returnZ=true&outSR=4326&f=json
//   attributes: .../mostUniBuildings/FeatureServer/0/query?where=1%3D1&outFields=CAAN,Name,Common_Nam&returnGeometry=false&f=json
// both under https://services9.arcgis.com/mXNwDpiENQiMIzRv/arcgis/rest/services
// (the layers behind https://campusmap.ucsd.edu). See docs/indoor-geometry.md.
//
// Outputs:
//   static/campus/buildings.json   every footprint (fetched by the 3D chunk)
//   src/lib/indoor/campusCodes.json  registrar code -> CAAN(s) (main bundle)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  CAMPUS_ORIGIN,
  CampusBuilding,
  CampusData,
  lonLatToCampus,
} from "../src/lib/indoor/campus";
import { pointInPolygon } from "../src/lib/indoor/geometry";
import { Point2, Ring } from "../src/lib/indoor/schema";

type ArcGisFeature = {
  attributes: Record<string, string | number | null>;
  geometry?: { rings: [number, number, number?][][] };
};

const FEET = 0.3048;

/** Codes whose point misses every footprint, or that span several buildings. */
const EXTRA_CAANS: Record<string, string[]> = {
  // Registrar codes covering several campus buildings
  RBC: ["6152", "6177", "6181"], // Robinson 1, 2, 3
  IGPP: ["6354", "6319"], // IGPP Munk Laboratory, IGPP 4000
  MAYER: ["6352", "6264"], // Mayer Hall, Mayer Hall Addition
};

/** Official venue identity takes precedence over nearby housing footprints. */
const REVIEWED_CAANS: Record<string, string[]> = {
  // I-House's 123A–D floor plan identifies Asante Meeting, not Asante W housing.
  // Source and corrected map point: data/indoor/ASANT/meeting-trace.json.
  ASANT: ["7025"],
};

const [footprintsPath, attributesPath] = process.argv.slice(2);
if (!footprintsPath || !attributesPath) {
  console.error("Usage: npm run campus:build -- <footprints.json> <attributes.json>");
  process.exit(1);
}
const footprints: ArcGisFeature[] = JSON.parse(readFileSync(footprintsPath, "utf8")).features;
const attributes: ArcGisFeature[] = JSON.parse(readFileSync(attributesPath, "utf8")).features;

const names = new Map<string, string>();
for (const { attributes: a } of attributes) {
  const caan = String(a.CAAN ?? "").trim();
  if (caan && !names.has(caan)) {
    names.set(caan, String(a.Common_Nam || a.Name || "").trim());
  }
}

/** Drops points closer than `tolerance` to the line through their neighbors. */
function simplify(ring: Ring, tolerance: number): Ring {
  let points = ring;
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    const kept: Ring = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, az] = points[(i + points.length - 1) % points.length];
      const [bx, bz] = points[i];
      const [cx, cz] = points[(i + 1) % points.length];
      const length = Math.hypot(cx - ax, cz - az);
      const distance =
        length === 0
          ? Math.hypot(bx - ax, bz - az)
          : Math.abs((cx - ax) * (az - bz) - (ax - bx) * (cz - az)) / length;
      if (distance < tolerance && points.length - (i - kept.length) > 3) {
        changed = true;
        continue;
      }
      kept.push(points[i]);
    }
    points = kept;
  }
  return points;
}

const round = (value: number) => Math.round(value * 10) / 10;

const buildings: CampusBuilding[] = [];
for (const feature of footprints) {
  const caan = String(feature.attributes.caantext ?? "").trim();
  const rings = feature.geometry?.rings ?? [];
  if (rings.length === 0) {
    continue;
  }
  let minZ = Infinity;
  let maxZ = -Infinity;
  const local: Ring[] = [];
  for (const ring of rings) {
    const points: Ring = [];
    for (const [lon, lat, z = 0] of ring) {
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      const [x, zLocal] = lonLatToCampus(lon, lat);
      points.push([round(x), round(zLocal)]);
    }
    // ArcGIS rings repeat their first point
    const [fx, fz] = points[0];
    const [lx, lz] = points[points.length - 1];
    if (fx === lx && fz === lz) {
      points.pop();
    }
    const simplified = simplify(points, 0.25);
    if (simplified.length >= 3) {
      local.push(simplified);
    }
  }
  if (local.length === 0) {
    continue;
  }
  buildings.push({
    caan: caan || null,
    name: (caan && names.get(caan)) || null,
    // ArcGIS outer rings are clockwise and holes counterclockwise (in lon/lat)
    rings: local,
    base: round(minZ * FEET),
    top: round(maxZ * FEET),
  });
}

// Registrar codes -> CAAN, by the building's map point
const buildingsJson = JSON.parse(readFileSync("src/lib/buildings.json", "utf8"));
const codes: Record<string, string[]> = {};
const unmatched: string[] = [];
for (const college of Object.values(buildingsJson.colleges) as Record<
  string,
  { location: [number, number] }
>[]) {
  for (const [code, { location }] of Object.entries(college)) {
    if (REVIEWED_CAANS[code]) {
      codes[code] = [...REVIEWED_CAANS[code]];
      continue;
    }
    const point: Point2 = lonLatToCampus(location[1], location[0]);
    const hits = new Set<string>();
    let nearest: { caan: string; distance: number } | null = null;
    for (const building of buildings) {
      if (!building.caan) {
        continue;
      }
      for (const ring of building.rings) {
        if (pointInPolygon(point, { outer: ring })) {
          hits.add(building.caan);
        }
        for (const [x, z] of ring) {
          const distance = Math.hypot(x - point[0], z - point[1]);
          if (!nearest || distance < nearest.distance) {
            nearest = { caan: building.caan, distance };
          }
        }
      }
    }
    if (hits.size === 0 && nearest && nearest.distance < 25) {
      hits.add(nearest.caan);
    }
    for (const caan of EXTRA_CAANS[code] ?? []) {
      hits.add(caan);
    }
    if (hits.size > 0) {
      codes[code] = [...hits].sort();
    } else {
      unmatched.push(code);
    }
  }
}

const data: CampusData = {
  origin: CAMPUS_ORIGIN,
  source:
    "UC San Diego Campus Map building extrusions (services9.arcgis.com/mXNwDpiENQiMIzRv, Campus_Buildings_3D_Object), accessed " +
    new Date().toISOString().slice(0, 10),
  buildings,
};
mkdirSync("static/campus", { recursive: true });
writeFileSync("static/campus/buildings.json", JSON.stringify(data));
writeFileSync(
  "src/lib/indoor/campusCodes.json",
  JSON.stringify(codes, Object.keys(codes).sort(), 1) + "\n"
);
console.log(
  `${buildings.length} footprints; ${Object.keys(codes).length} building codes matched` +
    (unmatched.length ? `; unmatched: ${unmatched.join(", ")}` : "")
);

// Reapply individually reviewed room evidence after rebuilding Facilities data.
// Run from the repository root: node scripts/enrich-indoor-metadata.mjs
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const read = (code) => JSON.parse(readFileSync(`static/indoor/facilities/${code}.json`, "utf8"));
const write = (data) => writeFileSync(`static/indoor/facilities/${data.building}.json`, JSON.stringify(data) + "\n");
const addNote = (object, note) => {
  object.notes ??= [];
  if (!object.notes.includes(note)) object.notes.push(note);
};

// An exact label alone is insufficient: also check the same floor, unique
// geometry, non-service use, and the independently listed room area.
const vaf = read("VAF");
const matches = vaf.floors.flatMap((floor) => floor.rooms
  .filter((room) => room.label === "218")
  .map((room) => ({ floor, room })));
assert.equal(matches.length, 1, "VAF 218 must be unique");
const { floor, room } = matches[0];
assert.equal(floor.id, "L1");
assert.equal(room.id, "L1-521-2261");
assert.ok(!["service", "restroom"].includes(room.type));
assert.ok(room.scheduleKey === null || room.scheduleKey === "218");
const ringArea = (ring) => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;
const areaSqft = (ringArea(room.footprint.outer) - (room.footprint.holes ?? []).reduce((a, h) => a + ringArea(h), 0)) / 0.09290304;
assert.ok(Math.abs(areaSqft / 1089 - 1) < 0.01, "VAF 218 polygon must agree with its 1089 sq ft listing");
const listing = floor.unplaced?.find((r) => r.scheduleKey === "218");
if (listing) {
  assert.equal(listing.basis, "floor-listing");
  assert.equal(listing.areaSqft, 1089);
}
room.scheduleKey = "218";
floor.unplaced = (floor.unplaced ?? []).filter((r) => r.scheduleKey !== "218");
addNote(room, "Schedule key 218 linked on 2026-10-21: unique printed label on the same Facilities floor; polygon area 1090.16 sq ft agrees with the 1089 sq ft floor listing within 0.11%. Existing approximate location confidence is retained.");
write(vaf);

// The EH&S PDF explicitly labels these rooms on physical PDF page 4.
// Its text supports floor membership, but no room polygons were traced.
const csb = read("CSB");
const sourceId = "CSB-EHS-2018";
const evidence = [
  { floor: "LL", page: 2, keys: ["001", "002", "003", "004", "005"] },
  { floor: "L1", page: 3, keys: ["115", "180"] },
  { floor: "L2", page: 4, keys: ["272", "280"] },
];
if (!csb.sources.some((source) => source.id === sourceId)) csb.sources.push({
  id: sourceId,
  title: "Cognitive Science Building emergency floor plans",
  url: "https://cogsci.ucsd.edu/_files/resources/Cognitive%20Science%20Building_11-8-18.pdf",
  publisher: "UC San Diego EH&S / Department of Cognitive Science",
  building: "CSB",
  floors: evidence.map((e) => e.floor),
  accessed: "2026-10-21",
  revision: "04/11/18 printed on plans; filename is 11-8-18",
  notes: ["PDF text verifies room labels and floors. Plan imagery was not available for tracing in this session; no geometry is claimed. The source is historical and may predate alterations."],
});
for (const item of evidence) {
  const target = csb.floors.find((f) => f.id === item.floor);
  assert.ok(target, `Missing CSB floor ${item.floor}`);
  for (const key of item.keys) {
    const entry = target.unplaced?.find((r) => r.scheduleKey === key);
    assert.ok(entry, `Missing CSB listing ${key}`);
    entry.basis = "floor-listing";
  }
  if (!target.sources.some((s) => s.source === sourceId)) target.sources.push({
    source: sourceId, page: item.page,
    note: `Printed room labels ${item.keys.join(", ")} corroborate this floor; outline remains approximate.`,
  });
}
addNote(csb, "2026-10-21: EH&S PDF corroborates the nine classroom floor assignments; 272 and 280 now use floor-listing evidence instead of room-number inference. Room positions remain unplaced.");
write(csb);

const ebu2 = read("EBU2");
const engineeringSource = "EBU2-EHS-2021";
if (!ebu2.sources.some((s) => s.id === engineeringSource)) ebu2.sources.push({
  id: engineeringSource,
  title: "Engineering Building Unit 2 emergency floor plans",
  url: "https://drive.google.com/file/d/1BDYqGwk89tMSmBlxhWRuy414a6AdPYau/view",
  publisher: "UC San Diego EH&S / Jacobs School of Engineering",
  building: "EBU2", floors: ["L3"], accessed: "2026-10-21", revision: "2021-06-29",
  notes: ["Public evacuation PDF linked through the Jacobs School building information sheet. Physical PDF page 5 explicitly labels 305 and 330A on the third floor; text supports floors only."],
});
const thirdFloor = ebu2.floors.find((f) => f.id === "L3");
assert.ok(thirdFloor);
for (const key of ["305", "330A"]) {
  const entry = thirdFloor.unplaced?.find((r) => r.scheduleKey === key);
  assert.ok(entry, `Missing EBU2 ${key}`);
  entry.basis = "floor-listing";
}
if (!thirdFloor.sources.some((s) => s.source === engineeringSource)) thirdFloor.sources.push({
  source: engineeringSource, page: 5, note: "305 and 330A are printed on the third-floor plan; no room polygons extracted.",
});
write(ebu2);

const sme = read("SME");
const smeSource = "SME-EHS-2021";
if (!sme.sources.some((s) => s.id === smeSource)) sme.sources.push({
  id: smeSource, title: "Structural and Materials Engineering emergency floor plans",
  url: "https://drive.google.com/file/d/15_SRb9XB9o_4e6YpUPHiNpwfiwZLjYmF/view",
  publisher: "UC San Diego EH&S / Jacobs School of Engineering", building: "SME",
  floors: ["L2"], accessed: "2026-10-21", revision: "2021-07-28",
  notes: ["Physical PDF page 4 labels 248 on the second floor. Floor evidence only; no geometry extracted."],
});
const smeFloor = sme.floors.find((f) => f.id === "L2");
assert.ok(smeFloor);
const sme248 = smeFloor.unplaced?.find((r) => r.scheduleKey === "248");
assert.ok(sme248);
sme248.basis = "floor-listing";
if (!smeFloor.sources.some((s) => s.source === smeSource)) smeFloor.sources.push({ source: smeSource, page: 4 });
write(sme);

const ctl = read("CTL");
const ctlFloor = ctl.floors.find((f) => f.id === "B");
assert.ok(ctlFloor);
const ctlSources = [
  { id: "CAT-108-2023", title: "CAT 125 syllabus: CAT Lab (Catalyst 108)", url: "https://sixth.ucsd.edu/_files/cat/2023-2024/fall/cat-125/fall-2023-cat-125-irwin.pdf" },
  { id: "CAT-B108-2022", title: "CAT 2 syllabus: CTL B108", url: "https://sixth.ucsd.edu/_files/cat/2021-2022/winter/cat-2/winter-2022-cat-2-marchisotto.pdf" },
  { id: "CAT-B112-2025", title: "CAT 125 syllabus: Catalyst B112", url: "https://sixth.ucsd.edu/_files/cat/2024-2025/winter/cat-125/winter-2025-cat-125-vanderschuit.pdf" },
];
for (const source of ctlSources) {
  if (!ctl.sources.some((s) => s.id === source.id)) ctl.sources.push({
    ...source, publisher: "UC San Diego Sixth College", building: "CTL", floors: ["B"], accessed: "2026-10-21",
    notes: ["Corroborates the classroom name/number. Position comes from the existing Facilities basement polygon; the syllabus is not a floor plan."],
  });
}
for (const match of [
  { key: "B108", label: "108", id: "B-1001808-111497", sqft: 783, refs: [{ source: "CAT-108-2023", page: 1 }, { source: "CAT-B108-2022", page: 7 }] },
  { key: "B112", label: "112", id: "B-1001808-111492", sqft: 445, refs: [{ source: "CAT-B112-2025", page: 1 }] },
]) {
  const candidates = ctlFloor.rooms.filter((r) => r.label === match.label);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.id, match.id);
  assert.ok(candidate.scheduleKey === null || candidate.scheduleKey === match.key);
  assert.ok(!["service", "restroom"].includes(candidate.type));
  const sqft = (ringArea(candidate.footprint.outer) - (candidate.footprint.holes ?? []).reduce((a, h) => a + ringArea(h), 0)) / 0.09290304;
  assert.ok(Math.abs(sqft / match.sqft - 1) < 0.01);
  candidate.scheduleKey = match.key;
  for (const ref of match.refs) {
    if (!candidate.sources.some((s) => s.source === ref.source)) candidate.sources.push(ref);
  }
  addNote(candidate, `Reviewed basement-prefix mapping on 2026-10-21: schedule ${match.key} corresponds to unique Facilities label ${match.label} on floor B. Official CAT syllabi corroborate the classroom name; original approximate location confidence is retained.`);
  ctlFloor.unplaced = (ctlFloor.unplaced ?? []).filter((r) => r.scheduleKey !== match.key);
}
write(ctl);

const ccc = read("CCC");
for (const source of [
  { id: "CCC-DIRECTIONS", title: "Cross-Cultural Center directions", url: "https://ccc.ucsd.edu/about-us/directions.html" },
  { id: "CCC-ROOMS", title: "Cross-Cultural Center room descriptions: ArtSpace", url: "https://ccc.ucsd.edu/reserve-a-room/room-descriptions.html" },
]) {
  if (!ccc.sources.some((s) => s.id === source.id)) ccc.sources.push({
    ...source, publisher: "UC San Diego Cross-Cultural Center", building: "CCC", floors: ["L2"], accessed: "2026-10-21",
  });
}
const cccFloor = ccc.floors.find((f) => f.id === "L2");
assert.ok(cccFloor);
cccFloor.unplaced ??= [];
if (!cccFloor.unplaced.some((r) => r.scheduleKey === "ARTSP")) cccFloor.unplaced.push({
  label: "ArtSpace", scheduleKey: "ARTSP", basis: "floor-listing",
});
for (const id of ["CCC-DIRECTIONS", "CCC-ROOMS"]) {
  if (!cccFloor.sources.some((s) => s.source === id)) cccFloor.sources.push({ source: id });
}
addNote(cccFloor, "ArtSpace floor assignment combines the official room directory (ArtSpace is a CCC room) with official directions (CCC is on Price Center East floor 2). No numbered-room equivalence or polygon has been established.");
ccc.knownUnmapped = (ccc.knownUnmapped ?? []).filter((r) => r.scheduleKey !== "ARTSP");
write(ccc);

const vaugn = read("VAUGN");
const vaugnFloor = vaugn.floors.find((f) => f.id === "L1");
const vaugn100 = vaugnFloor?.unplaced?.find((r) => r.scheduleKey === "100");
assert.ok(vaugnFloor && vaugn100, "Expected existing Vaughan 100 floor-only record");
const vaugnSource = "VAUGN-SCRIPPS-WAYFINDING";
if (!vaugn.sources.some((s) => s.id === vaugnSource)) vaugn.sources.push({
  id: vaugnSource, title: "Scripps Benthic Invertebrate Collection: visiting directions",
  url: "https://scripps.ucsd.edu/benthic-invertebrate-collection/contact-us",
  publisher: "UC San Diego Scripps Institution of Oceanography", building: "VAUGN",
  floors: ["L1"], accessed: "2026-10-22",
  notes: ["Official directions identify the first-floor south entrance near VH100. This supports floor membership only; no room boundary or coordinate is provided."],
});
vaugn100.basis = "floor-listing";
if (!vaugnFloor.sources.some((s) => s.source === vaugnSource)) vaugnFloor.sources.push({ source: vaugnSource });
addNote(vaugnFloor, "VH100 is near the first-floor south entrance in official Scripps visiting directions. Room 100 remains unplaced; no doorway position or room shape is inferred.");
write(vaugn);
console.log("VAF 218 + CTL B108/B112: linked existing geometry. CSB/EBU2/SME/CCC/VAUGN: corroborated floors only.");

// WFH sign photographs corroborate two floor assignments, not room positions.
// Keep this block self-contained so it can be reapplied without rewriting other buildings.
{
  const wfh = read("WFH");
  const thirdFloor = wfh.floors.find((floor) => floor.id === "L3");
  assert.ok(thirdFloor, "Expected WFH third-floor listing");
  for (const evidence of [
    {
      key: "3N129", image: "22",
      sha256: "6a79dcc10a34be4bb9ac1205dc133dcdfaea481187e47266644a99240461a965",
      finding: "The physical sign reads THIRD FLOOR and includes classroom 3N129.",
    },
    {
      key: "3W113", image: "19",
      sha256: "f619022563a75204753961cbcf5f0bd5a3c2a363d55659411d5956c49fa22772",
      finding: "The directory's third-floor panel lists CONFERENCE ROOM 3W113.",
    },
  ]) {
    const entry = thirdFloor.unplaced?.find((room) => room.scheduleKey === evidence.key);
    assert.ok(entry, `Expected existing WFH ${evidence.key} unplaced entry`);
    assert.ok(["room-number", "floor-listing"].includes(entry.basis));
    entry.basis = "floor-listing";
    const sourceId = `WFH-CLEAR-RS-${evidence.image}`;
    if (!wfh.sources.some((source) => source.id === sourceId)) wfh.sources.push({
      id: sourceId,
      title: `Rady School installed wayfinding photograph RS-${evidence.image}`,
      url: `https://clearsigns-2.com/media/website/images/showcases/rady/RS-${evidence.image}.jpg`,
      localFile: `local/indoor-sources/WFH-CLEAR-RS-${evidence.image}.jpg`,
      publisher: "Clear Sign & Design, original sign contractor",
      building: "WFH", floors: ["L3"], accessed: "2026-10-22",
      notes: [
        evidence.finding,
        `Retained original SHA-256: ${evidence.sha256}.`,
        "No photograph capture date or plan revision date is provided. This sign corroborates the listed floor only; present partitions and room position are not established.",
      ],
    });
    if (!thirdFloor.sources.some((ref) => ref.source === sourceId)) thirdFloor.sources.push({
      source: sourceId, region: "Third-floor wayfinding panel", note: evidence.finding,
    });
  }
  addNote(thirdFloor, "2026-10-22: Installed wayfinding photographs independently corroborate 3N129 and 3W113 on the third floor. Both remain unplaced; the photographs add no room outlines or coordinates, and have no stated capture or revision date.");
  write(wfh);
  console.log("WFH 3N129/3W113: corroborated third floor from installed signs; positions remain unplaced.");
}


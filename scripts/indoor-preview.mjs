import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Read only the small local index; detailed layouts are still fetched on demand. */
export function readLocalIndoorManifest(root, { required = false, directory = "tririga-local" } = {}) {
  const path = join(root, "static", "indoor", directory, "index.json");
  if (!existsSync(path)) {
    if (required) throw new Error(`Missing local indoor index: ${path}`);
    return {};
  }
  const index = JSON.parse(readFileSync(path, "utf8"));
  if (index.schemaVersion !== 1 || !Array.isArray(index.buildings)) {
    throw new Error("Local indoor index needs schemaVersion: 1 and a buildings array.");
  }
  const entries = {};
  for (const code of index.buildings) {
    if (typeof code !== "string" || !/^[A-Z][A-Z0-9-]*$/.test(code)) {
      throw new Error(`Invalid local indoor building code: ${String(code)}`);
    }
    if (code === "GEISEL") {
      throw new Error("GEISEL must retain its library layout and LibCal room mapping.");
    }
    if (Object.hasOwn(entries, code)) {
      throw new Error(`Duplicate local indoor building code: ${code}`);
    }
    const file = `indoor/${directory}/${code}.json`;
    if (!existsSync(join(root, "static", file))) {
      throw new Error(`Local indoor index points to missing file: ${file}`);
    }
    entries[code] = { file, status: "facilities-plan" };
  }
  return entries;
}

/** Only display assets are public; acquisition data stays excluded. */
export function isPublicStaticFile(source, root) {
  const path = relative(join(root, "static"), source).replaceAll("\\", "/");
  return !/^indoor\/(?:local|tririga-local)(?:\/|$)/.test(path) &&
    !/(^|\/)(index\.(js|css)(\.map)?|chunks|map-[A-Z0-9]+\.webp|material-.*-[A-Z0-9]+\.svg)$/.test(path);
}

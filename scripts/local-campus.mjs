import { createReadStream, existsSync, realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const prefix = "/campus-offline/";
const assets = /^(?:index\.html|imagery\/[a-z0-9-]+\.jpg|survey\/[a-zA-Z0-9]+\/(?:clip\.png|\d+\.(?:mesh|jpg)))$/;
const contentTypes = {
  html: "text/html; charset=utf-8",
  jpg: "image/jpeg",
  mesh: "application/octet-stream",
  png: "image/png",
};

export function localCampusDirectory(repository) {
  const configured = process.env.UCSD_OFFLINE_MAP_DIR;
  const directory = resolve(repository, configured || "../UCSD-Offline-3D");
  if (existsSync(join(directory, "index.html")) && existsSync(join(directory, "survey.json"))) {
    return realpathSync(directory);
  }
  if (configured) throw new Error(`Offline campus package is missing index.html or survey.json in ${directory}`);
  return null;
}

export async function serveLocalCampus(directory, pathname, req, res) {
  if (!directory || !pathname.startsWith(prefix)) return false;
  const file = pathname.slice(prefix.length) || "index.html";
  try {
    if (!assets.test(file) || !["GET", "HEAD"].includes(req.method)) throw new Error();
    const path = await realpath(join(directory, file));
    const localPath = relative(directory, path);
    if (isAbsolute(localPath) || localPath.startsWith("..")) throw new Error();
    const { size } = await stat(path);
    const type = contentTypes[file.split(".").at(-1)];
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": size,
      "Cache-Control": file === "index.html" ? "no-cache" : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else {
      const stream = createReadStream(path);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    }
  } catch {
    res.writeHead(404).end("Offline campus asset not found");
  }
  return true;
}

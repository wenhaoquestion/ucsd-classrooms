// Cross-platform build/dev script (the previous npm scripts relied on `cp`,
// `find`, and `sed`, which don't exist in cmd.exe on Windows).
//
//   node scripts/build.mjs          Builds to dist/
//   node scripts/build.mjs --serve  Serves static/ on http://localhost:8000/
//
// Geisel study room availability comes from a small LibCal proxy
// (worker/libcal.js). The dev server answers it at /libcal/; production builds
// use the deployed Worker named by the LIBCAL_PROXY_URL environment variable,
// and show rooms without live availability if it isn't set.
//
// The bundle is emitted as ES modules with code splitting so the 3D building
// explorer (three.js) is only downloaded when a building with indoor geometry
// is opened.

import * as esbuild from "esbuild";
import { cpSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { handleLibcalRequest } from "../worker/libcal.js";

// Paths below are relative to the repository root, wherever this is run from.
// esbuild's service process keeps the cwd it was spawned with, so it also needs
// `absWorkingDir`; `chdir` alone isn't enough.
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);

const serve = process.argv.includes("--serve");
const SITE = "https://wenhaoquestion.github.io/ucsd-classrooms/";

/** @type {esbuild.BuildOptions} */
const options = {
  absWorkingDir: root,
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  loader: { ".webp": "file", ".svg": "file" },
  outdir: serve ? "static" : "dist",
  metafile: !serve,
  define: {
    LIBCAL_PROXY_URL: JSON.stringify(
      process.env.LIBCAL_PROXY_URL ?? (serve ? "libcal/" : "")
    ),
  },
};

if (serve) {
  // Served from memory; nothing is written into static/
  const context = await esbuild.context({ ...options, sourcemap: true, write: false });
  const esbuildServer = await context.serve({
    servedir: join(root, "static"),
    host: "127.0.0.1",
    port: 8001,
  });
  // A thin front server so /libcal/ can be answered without the Worker
  createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/libcal/")) {
      const response = await handleLibcalRequest(
        new Request(url, { method: req.method }),
        url.pathname.slice("/libcal/".length)
      );
      res.writeHead(response?.status ?? 404, Object.fromEntries(response?.headers ?? []));
      res.end(response ? await response.text() : "Not found");
      return;
    }
    const proxy = httpRequest(
      {
        host: esbuildServer.hosts[0],
        port: esbuildServer.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      }
    );
    proxy.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(proxy);
  }).listen(8000, () => console.log("Serving on http://localhost:8000/"));
} else {
  rmSync("dist", { recursive: true, force: true });
  cpSync("static", "dist", {
    recursive: true,
    filter: (source) =>
      !/(^|[\\/])(index\.(js|css)(\.map)?|chunks|map-[A-Z0-9]+\.webp|material-.*-[A-Z0-9]+\.svg)$/.test(source),
  });
  const result = await esbuild.build({ ...options, minify: true });
  console.log(
    await esbuild.analyzeMetafile(result.metafile, { verbose: false })
  );

  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files.push(SITE + relative("dist", path).split("\\").join("/"));
      }
    }
  };
  walk("dist");
  writeFileSync("dist/sitemap.txt", files.join("\n") + "\n");
}

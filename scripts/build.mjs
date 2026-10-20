// Cross-platform build/dev script (the previous npm scripts relied on `cp`,
// `find`, and `sed`, which don't exist in cmd.exe on Windows).
//
//   node scripts/build.mjs          Builds to dist/
//   node scripts/build.mjs --serve  Serves static/ on http://localhost:8000/
//
// The bundle is emitted as ES modules with code splitting so the 3D building
// explorer (three.js) is only downloaded when a building with indoor geometry
// is opened.

import * as esbuild from "esbuild";
import { cpSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
  // Local-only indoor layouts (static/indoor/local/) load in dev builds only
  define: { __LOCAL_INDOOR__: String(serve) },
};

if (serve) {
  // Served from memory; nothing is written into static/
  const context = await esbuild.context({ ...options, sourcemap: true, write: false });
  const { port } = await context.serve({ servedir: join(root, "static"), port: 8000 });
  console.log(`Serving on http://localhost:${port}/`);
} else {
  rmSync("dist", { recursive: true, force: true });
  // static/indoor/local/ holds local-testing data that must never be published
  const localData = join("static", "indoor", "local");
  cpSync("static", "dist", {
    recursive: true,
    filter: (source) =>
      !source.startsWith(localData) &&
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

import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const site = new URL(process.argv[2] ?? "https://wenhaoquestion.github.io/ucsd-classrooms/");
const revision = process.env.GITHUB_SHA;
if (!revision) throw new Error("GITHUB_SHA is required to verify the published revision.");
const deadline = Date.now() + 300_000;
let failure;

async function read(path) {
  const url = new URL(path, site);
  url.searchParams.set("verify", `${revision}-${Date.now()}`);
  const response = await fetch(url, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

do {
  try {
    const deployment = JSON.parse((await read("deployment.json")).toString("utf8"));
    if (deployment.revision !== revision) throw new Error("The live site still serves a different revision.");
    const files = ["index.js", "indoor/layouts/MAYER.json"];
    if (process.env.VERIFY_SCHEDULES === "1") {
      files.push("schedules/classrooms-FA26.txt", "schedules/classrooms-FA26-full.txt");
    }
    for (const file of files) {
      const content = await read(file);
      const actual = createHash("sha256").update(content).digest("hex");
      if (actual !== deployment.assets?.[file]) throw new Error(`${file}: published bytes do not match this release.`);
    }
    console.log(`Verified published revision ${revision}: ${files.join(", ")}.`);
    process.exit(0);
  } catch (error) {
    failure = error;
    console.log(`Waiting for the published site: ${error.message}`);
    if (Date.now() < deadline) await setTimeout(15_000);
  }
} while (Date.now() < deadline);

throw failure;

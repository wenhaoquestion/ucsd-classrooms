import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coursesFromFile } from "../src/lib/coursesFromFile";
import { coursesToClassrooms } from "../src/lib/coursesToClassrooms";

const [directory, ...terms] = process.argv.slice(2);
if (!directory || terms.length === 0) {
  throw new Error("Usage: validate-schedules <directory> <term> [term...]");
}

for (const term of terms) {
  const read = (suffix: string) => {
    const file = join(directory, `classrooms-${term}${suffix}.txt`);
    const content = readFileSync(file, "utf8");
    if (!/^V[34]\d{13}\r?\n/.test(content)) {
      throw new Error(`${file}: missing schedule format and scrape timestamp.`);
    }
    const parsed = coursesFromFile(content, term.startsWith("S3"));
    console.log(`${file}: ${parsed.courses.length} courses (${parsed.scraped.toISOString()})`);
    return parsed;
  };
  const abridged = read("");
  const full = read("-full");
  if (+abridged.scraped !== +full.scraped) {
    throw new Error(`${term}: the two files describe different snapshots.`);
  }
  if (full.courses.length === 0) {
    throw new Error(`${term}: the full schedule contains no courses.`);
  }
  if (Object.keys(coursesToClassrooms(abridged.courses)).length === 0 &&
      Object.keys(coursesToClassrooms(full.courses)).length > 0) {
    throw new Error(`${term}: classroom meetings are missing from the abridged schedule.`);
  }
}

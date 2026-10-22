// Extract reviewed MYR-A keys with the same parser the website uses.
import { build } from "esbuild";

const code = String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { coursesFromFile } from './src/lib/coursesFromFile';
const path = 'local/indoor-sources/classrooms-FA26.txt';
const text = readFileSync(path, 'utf8');
const sha256 = createHash('sha256').update(text).digest('hex');
if (sha256 !== 'b485329436badb02834df241fd81ea48d9ec9e0f2edef106cb11d7f56d43453b') {
  throw new Error('FA26 source changed; review the exact schedule inventory again.');
}
const term = coursesFromFile(text);
const meetings = [];
for (const course of term.courses) {
  for (const group of course.groups) {
    for (const meeting of [...group.sections, ...group.meetings, ...group.exams]) {
      if (meeting.location?.building === 'MYR-A') {
        meetings.push({ scheduleKey: meeting.location.room, course: course.code,
                        meetingType: meeting.type, kind: meeting.kind });
      }
    }
  }
}
const keys = [...new Set(meetings.map(r => r.scheduleKey))].sort();
if (JSON.stringify(keys) !== JSON.stringify(['2544','2574','2702','2722','3544','4623','5623'])) {
  throw new Error('Unexpected schedule keys; manual geometry review required.');
}
const evidence = {
  schemaVersion: 1, building: 'MYR-A', term: 'FA26',
  source: {
    url: 'https://sheeptester.github.io/uxdy/data/classrooms-FA26.txt',
    localPath: path, sha256, acquiredAt: '2026-10-22T01:39:35.656Z',
    scrapedAt: term.scraped.toISOString(),
    note: 'The website schedule feed is a third-party scrape, not an official geometry source. Only exact building and room keys are taken from it.',
  },
  parser: 'src/lib/coursesFromFile.ts',
  reproduce: 'node scripts/extract-myr-a-schedule.mjs',
  keys, meetingRecordCount: meetings.length, meetings,
};
writeFileSync('data/indoor/MYR-A/fa26-schedule.json', JSON.stringify(evidence, null, 2) + '\n');
console.log('MYR-A FA26: ' + keys.join(', ') + '; ' + meetings.length + ' meeting records.');
`;
const result = await build({
  stdin: { contents: code, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

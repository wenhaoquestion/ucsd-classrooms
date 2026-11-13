import { coursesToFile } from './courses-to-file.ts'
import { getCourses } from './scrape.ts'

const [term] = Deno.args
if (!/^(FA|WI|SP|S[123]|SU)\d{2}$/.test(term ?? '')) {
  throw new Error('Specify a term such as FA26, WI27, or S127.')
}

const result = await getCourses(term, true)
if (result.courses.length === 0) {
  throw new Error(`UCSD returned no courses for ${term}.`)
}

const base = `output/classrooms-${term}`
const includeDateRange = term.startsWith('S3')
const abridged = coursesToFile(result, true, includeDateRange)
const full = coursesToFile(result, false, includeDateRange)

await Deno.mkdir('output', { recursive: true })
await Deno.writeTextFile(`${base}.txt`, abridged)
await Deno.writeTextFile(`${base}-full.txt`, full)
console.log(`Generated both ${term} schedule files from ${result.courses.length} source courses.`)

/**
 * Search scoring shared by the search bar. Matching is forgiving about the
 * ways people type codes and names:
 *
 * - case, accents, and punctuation are ignored ("Peterson-Hall" = "peterson hall")
 * - letters and digits split into words ("cse100" = "CSE 100", "wlh2005" = "WLH 2005")
 * - words can be abbreviated and reordered ("intro prog", "smith john")
 * - building initials work ("wlh" finds Warren Lecture Hall)
 * - a single typo in a longer word is tolerated ("galbrath", "pricee")
 */

export type Range = { start: number; end: number };
export type Match = { score: number; ranges: Range[] };

type Token = { text: string; start: number; end: number };

/** Lowercases and strips accents while keeping one character per input character. */
function fold(string: string): string {
  let out = "";
  for (const char of string) {
    const base = char.normalize("NFD")[0].toLowerCase();
    // Astral characters are two code units; keep offsets aligned with the input
    out += char.length === 2 ? base.padEnd(2, " ") : base;
  }
  return out;
}

/** Words in `string`, splitting letters from digits ("CSE100" -> cse, 100). */
export function tokenize(string: string): Token[] {
  const tokens: Token[] = [];
  for (const match of fold(string).matchAll(/[a-z]+|\d+/g)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Normalized form used for whole-string comparisons. */
export function normalize(string: string): string {
  return tokenize(string)
    .map((token) => token.text)
    .join(" ");
}

/** Whether `a` is within one edit (insert, delete, substitute, swap) of `b`. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return Math.abs(a.length - b.length) <= 1;
  if (a.length === b.length) {
    const rest = a.slice(i + 1) === b.slice(i + 1);
    const swap = a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    return rest || swap;
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** A query word that has a typo: compares against the target word, or its start. */
function fuzzyWord(query: string, word: string): boolean {
  if (query.length < 4 || /\d/.test(query)) return false;
  return (
    withinOneEdit(query, word) ||
    (word.length > query.length && withinOneEdit(query, word.slice(0, query.length)))
  );
}

export type Prepared = { text: string; tokens: Token[]; normalized: string };

export function prepare(text: string): Prepared {
  const tokens = tokenize(text);
  return { text, tokens, normalized: tokens.map((token) => token.text).join(" ") };
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

/**
 * Scores how well `query` matches `target`; 0 means no match. Higher is
 * better: exact (100) > starts with (80+) > words in order (60+) > initials
 * (55) > words in any order (50+) > inside words (30) > typo (15).
 */
export function matchScore(query: Prepared, target: Prepared): Match {
  const q = query.tokens;
  const t = target.tokens;
  if (q.length === 0 || t.length === 0) return { score: 0, ranges: [] };

  if (query.normalized === target.normalized) {
    return { score: 100, ranges: [{ start: t[0].start, end: t[t.length - 1].end }] };
  }

  // Every query word must start a different target word. Whole-word matches
  // are preferred, then the next word after the previous match.
  const used = new Set<number>();
  const ranges: Range[] = [];
  let inOrder = true;
  let previous = -1;
  let complete = 0;
  const pick = (test: (text: string) => boolean) => {
    let first = -1;
    for (let ti = 0; ti < t.length; ti++) {
      if (used.has(ti) || !test(t[ti].text)) continue;
      if (ti > previous) return ti;
      if (first < 0) first = ti;
    }
    return first;
  };
  for (const [qi, { text: word }] of q.entries()) {
    let found = pick((text) => text === word);
    // Abbreviated words are fine ("intro prog"), but a number before other
    // words is complete: "math 20a" shouldn't find MATH 200A
    const prefixOk = qi === q.length - 1 || !/^\d/.test(word);
    if (found < 0 && prefixOk) found = pick((text) => text.startsWith(word));
    if (found < 0) break;
    // The last word may still be being typed, so a prefix counts as complete
    if (t[found].text === word || qi === q.length - 1) complete++;
    if (found < previous) inOrder = false;
    previous = found;
    used.add(found);
    ranges.push({ start: t[found].start, end: t[found].start + word.length });
  }
  if (ranges.length === q.length) {
    // Bonuses: matches the start of the name, and fewer leftover words
    const leading = used.has(0) ? 10 : 0;
    const coverage = (q.length / t.length) * 8;
    const whole = complete === q.length ? 2 : 0;
    if (inOrder && used.has(0) && [...used].every((ti) => ti < q.length)) {
      return { score: 80 + coverage + whole, ranges: merge(ranges) };
    }
    return {
      score: (inOrder ? 60 : 50) + leading / 2 + coverage + whole,
      ranges: merge(ranges),
    };
  }

  // Initials, e.g. "wlh" for Warren Lecture Hall or "ebu" for Engineering Building Unit
  if (q.length === 1 && q[0].text.length >= 2 && /^[a-z]+$/.test(q[0].text)) {
    const initials = t.filter((token) => /^[a-z]/.test(token.text));
    if (initials.map((token) => token.text[0]).join("").startsWith(q[0].text)) {
      return {
        score: 55,
        ranges: initials.slice(0, q[0].text.length).map((token) => ({ start: token.start, end: token.start + 1 })),
      };
    }
  }

  // Inside words, e.g. "biology" in "Microbiology"
  const inside: Range[] = [];
  for (const word of q) {
    if (word.text.length < 3) {
      inside.length = 0;
      break;
    }
    const token = t.find((token) => token.text.includes(word.text));
    if (!token) {
      inside.length = 0;
      break;
    }
    const offset = token.start + token.text.indexOf(word.text);
    inside.push({ start: offset, end: offset + word.text.length });
  }
  if (inside.length === q.length) return { score: 30, ranges: merge(inside) };

  // One typo per word
  const fuzzy: Range[] = [];
  const fuzzyUsed = new Set<number>();
  for (const word of q) {
    const ti = t.findIndex(
      (token, i) => !fuzzyUsed.has(i) && (token.text.startsWith(word.text) || fuzzyWord(word.text, token.text))
    );
    if (ti < 0) return { score: 0, ranges: [] };
    fuzzyUsed.add(ti);
    fuzzy.push({ start: t[ti].start, end: t[ti].end });
  }
  return { score: 15, ranges: merge(fuzzy) };
}

/** Best of several fields, e.g. a course's code and title. Earlier fields win ties. */
export function bestMatch<T extends string>(
  query: Prepared,
  fields: [field: T, target: Prepared][]
): (Match & { field: T }) | null {
  let best: (Match & { field: T }) | null = null;
  for (const [field, target] of fields) {
    const match = matchScore(query, target);
    if (match.score > 0 && (!best || match.score > best.score)) best = { ...match, field };
  }
  return best;
}

/** Sorts by score, then shorter (more specific) text, then alphabetically. */
export function rank<T extends { score: number; label: string }>(items: T[], limit: number): T[] {
  return items
    .sort((a, b) => b.score - a.score || a.label.length - b.label.length || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Splits a room query into a building part and a room number, e.g.
 * "wlh2005" -> ["wlh", "2005"], "warren lecture hall 21" -> ["warren lecture
 * hall", "21"], "CENTR-1" -> ["centr", "1"]. Returns null if the query has no
 * room number at the end.
 */
export function splitRoomQuery(query: string): { building: string; room: string } | null {
  const trimmed = query.trim();
  // "ebu3b b210", "CENTR-1": a separator allows letters before the number
  const match =
    trimmed.match(/^(.*[a-z0-9])[\s\-_.#]+([a-z]?\d[\da-z]*)$/i) ??
    // "wlh2005": glued on, the room starts at the first digit
    trimmed.match(/^(.*[a-z])(\d[\da-z]*)$/i);
  if (!match || !/[a-z]/i.test(match[1])) return null;
  return { building: match[1], room: match[2].toUpperCase() };
}

/** Room keys that start with `room`, ignoring leading zeros and punctuation. */
export function roomMatches(key: string, room: string): boolean {
  const clean = key.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const unpadded = room.replace(/^0+/, "");
  return clean.startsWith(room) || (unpadded !== "" && clean.replace(/^0+/, "").startsWith(unpadded));
}

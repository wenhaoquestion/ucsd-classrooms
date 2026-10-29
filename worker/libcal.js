// Geisel study room availability from the library's LibCal booking system.
//
// LibCal's availability grid only answers requests whose Referer is LibCal
// itself and sends no CORS headers, so a browser on another site can't read it.
// This module does the request server-side. It is shared by the Cloudflare
// Worker (worker/index.js) and the local dev server (scripts/build.mjs).
//
//   GET <base>/geisel?date=YYYY-MM-DD
//   -> { date, fetchedAt, windowEnd, spaces: { [eid]: [[start, end, status]] } }
//
// Times are "HH:MM" in Pacific time (LibCal's own); an end at midnight is
// "24:00". `status` is "free", "booked" or "closed". Times with no slot at all
// aren't bookable (the library is closed or the slot has passed).

const LIBCAL = "https://ucsd.libcal.com";
/** Geisel Library's LibCal location. Only this location is proxied. */
const GEISEL_LID = "11273";
/** How far ahead and back a date may be, so this can't be used to crawl LibCal. */
const MAX_DAYS_AHEAD = 31;
const MAX_DAYS_BACK = 1;
export const CACHE_SECONDS = 60;

const CLASS_STATUS = {
  "s-lc-eq-checkout": "booked",
  "s-lc-eq-r-unavailable": "closed",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** "2026-10-29 07:30:00" -> "07:30" on `date`, "24:00" for the next midnight. */
function slotTime(stamp, date) {
  const [day, time] = stamp.split(" ");
  const hhmm = time.slice(0, 5);
  return day === date ? hhmm : hhmm === "00:00" ? "24:00" : null;
}

/** Fetches one day of Geisel availability, trimmed to what the site needs. */
export async function fetchGeiselDay(date, fetchImpl = fetch) {
  const response = await fetchImpl(`${LIBCAL}/spaces/availability/grid`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `${LIBCAL}/spaces?lid=${GEISEL_LID}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams({
      lid: GEISEL_LID,
      gid: "0",
      eid: "-1",
      seat: "0",
      seatId: "0",
      zone: "0",
      start: date,
      end: addDays(date, 1),
      pageIndex: "0",
      pageSize: "100",
    }),
  });
  if (!response.ok) {
    throw new Error(`LibCal responded with HTTP ${response.status}`);
  }
  const data = await response.json();
  const spaces = {};
  for (const slot of data.slots ?? []) {
    const start = slotTime(slot.start, date);
    const end = slotTime(slot.end, date);
    if (start === null || end === null) {
      continue;
    }
    (spaces[slot.itemId] ??= []).push([start, end, CLASS_STATUS[slot.className] ?? "free"]);
  }
  for (const slots of Object.values(spaces)) {
    slots.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return {
    date,
    fetchedAt: new Date().toISOString(),
    windowEnd: data.windowEnd === true,
    spaces,
  };
}

/** Today's date in Pacific time, as LibCal sees it. */
function pacificToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

/**
 * Handles a request under the proxy's base path. `path` is the part after the
 * base, e.g. "geisel". Returns null for paths this module doesn't serve.
 */
export async function handleLibcalRequest(request, path, fetchImpl = fetch) {
  if (path !== "geisel") {
    return null;
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return json({ error: "Expected ?date=YYYY-MM-DD" }, 400);
  }
  const today = pacificToday();
  if (date < addDays(today, -MAX_DAYS_BACK) || date > addDays(today, MAX_DAYS_AHEAD)) {
    return json({ error: "Date out of range" }, 400);
  }
  try {
    return json(await fetchGeiselDay(date, fetchImpl), 200, {
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    });
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error) }, 502);
  }
}

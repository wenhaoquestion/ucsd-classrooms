# LibCal proxy for Geisel study rooms

The site shows which Geisel Library study rooms are free using the library's
LibCal booking system. LibCal only answers availability requests whose
`Referer` is LibCal itself and sends no CORS headers, so a page on GitHub Pages
can't read it directly. This Cloudflare Worker makes that one request
server-side and returns a small JSON summary with `Access-Control-Allow-Origin: *`.

- It only serves Geisel (LibCal location 11273), for dates from yesterday to 31
  days ahead, so it can't be used as a general proxy.
- Responses are cached at Cloudflare's edge for 60 seconds, so all visitors
  looking at the same day share one LibCal request per minute.
- It only reads availability. Booking happens on LibCal itself, after the user
  signs in with their UCSD account.

`npm run dev` doesn't need the Worker: the dev server answers the same route at
`http://localhost:8000/libcal/geisel?date=YYYY-MM-DD` using the same code
(`libcal.js`).

## Deploy

The deployed Worker is `https://ucsd-classrooms-libcal.wenhaoquestion.workers.dev`.
The GitHub Pages workflow uses this URL by default; a repository variable
`LIBCAL_PROXY_URL` overrides it. The Worker was deployed through the Cloudflare
API on 2026-10-28 and its workers.dev route is enabled. A new workers.dev
subdomain can take a while to get its HTTPS certificate; until then HTTPS
requests fail the TLS handshake, and the site shows rooms without live colors.

You need a free Cloudflare account.

```sh
cd worker
npx wrangler login
npx wrangler deploy
```

Wrangler prints the Worker's URL, e.g.
`https://ucsd-classrooms-libcal.<your-subdomain>.workers.dev`. Check it:

```sh
curl "https://ucsd-classrooms-libcal.<your-subdomain>.workers.dev/geisel?date=$(date +%F)"
```

Then point the site at it. In the GitHub repository, open **Settings → Secrets
and variables → Actions → Variables** and add a repository variable
`LIBCAL_PROXY_URL` with the Worker URL. The next Pages deployment picks it up.

For a local production build: `LIBCAL_PROXY_URL=https://… npm run build`.

Without `LIBCAL_PROXY_URL`, the site still shows Geisel's rooms in 3D and links
each one to its LibCal page; it just doesn't color rooms by availability.

## Response

`GET /geisel?date=2026-11-02`

```json
{
  "date": "2026-11-02",
  "fetchedAt": "2026-11-01T18:04:11.000Z",
  "windowEnd": false,
  "spaces": {
    "103054": [["07:30", "08:00", "free"], ["08:00", "08:30", "booked"]]
  }
}
```

Keys are LibCal space IDs (`eid`, listed in `src/lib/library/geisel.ts`). Times
are Pacific; an end at midnight is `"24:00"`. Times with no slot aren't bookable.
`windowEnd` is true at or beyond the end of LibCal's booking window (about two
weeks ahead).

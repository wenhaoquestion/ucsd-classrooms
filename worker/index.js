// Cloudflare Worker that serves Geisel study room availability to the site.
// Deploy: cd worker && npx wrangler deploy
// Then set the repository variable LIBCAL_PROXY_URL to the Worker's URL (see
// worker/README.md); the GitHub Pages build reads it.
import { CACHE_SECONDS, handleLibcalRequest } from "./libcal.js";

export default {
  async fetch(request, _env, ctx) {
    const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
    // Everyone viewing the same day shares one LibCal request per minute
    const cache = caches.default;
    if (request.method === "GET") {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
    }
    const response = await handleLibcalRequest(request, path);
    if (!response) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method === "GET" && response.ok) {
      response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
      ctx.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  },
};

/**
 * The service worker, served at /sw.js.
 *
 * Generated here rather than kept as a file in /public so that the version is
 * stamped at build time. Each deploy therefore ships a byte-different worker,
 * which is what makes the browser install it and refresh the offline copy --
 * a hand-maintained version number is exactly the thing someone forgets.
 */
export const dynamic = "force-static";

const BUILD =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  new Date().toISOString();

/** Every page of the app. All static, so one cached copy serves every document. */
// Every route the app can reach. A page left out of this list 404s with no
// signal, and working offline is the whole point -- so this list is the first
// thing to change when a route is added.
const PAGES = ["/"];

function worker(build: string) {
  return `
const VERSION = ${JSON.stringify(build)};
const CACHE = "pangolin-" + VERSION;
const PAGES = ${JSON.stringify(PAGES)};

// Pull every hashed asset a page references out of its HTML, including chunks
// named only inside the inline router payload, so pages that have never been
// opened still work offline.
const ASSET = /\\/_next\\/static\\/[^"'\\s)\\\\]+/g;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const assets = new Set(["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]);
      for (const page of PAGES) {
        const response = await fetch(page, { cache: "reload" });
        if (!response.ok) throw new Error("precache failed for " + page);
        const html = await response.clone().text();
        for (const match of html.match(ASSET) || []) assets.add(match);
        await cache.put(page, response);
      }
      await Promise.all(
        [...assets].map((url) =>
          fetch(url).then((r) => (r.ok ? cache.put(url, r) : undefined)).catch(() => undefined)
        )
      );
    })()
  );
  // Deliberately no automatic skipWaiting(). A page already open is running the
  // previous build's JavaScript; swapping the worker and deleting its cache
  // underneath it would 404 the chunks it still loads lazily. The page asks
  // instead (see the message handler below) and reloads itself straight after.
});

// Sent by the "Update ready" prompt. The page reloads the moment this worker
// takes control, so nothing keeps running on the old build's code.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("pangolin-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Router data fetches: leave alone. Offline they fail, and the Next router
  // responds to a failed fetch with a full page load -- which is served below.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  // Hashed build assets never change under the same name: cache first. This is
  // also how lazily-loaded code (the QR reader) becomes available offline: it
  // isn't in any page's HTML, so it's cached the first time it is used.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetchAndStore(request))
    );
    return;
  }

  if (request.mode === "navigate") {
    // One page serves every screen (they live in the #hash), so there is one cache key.
    const key = url.pathname;
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          // Network first so a connected user always gets the latest build, but
          // give up quickly: on a weak signal a spinner is worse than the cache.
          const response = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 3500)),
          ]);
          if (response.ok && PAGES.includes(key)) cache.put(key, response.clone());
          return response;
        } catch {
          return (await cache.match(key)) || (await cache.match("/")) || Response.error();
        }
      })()
    );
    return;
  }

  // Icons, manifest and the like: answer from cache, refresh in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetchAndStore(request).catch(() => hit || Response.error());
      return hit || network;
    })
  );
});

// Clone BEFORE handing the response back. Cloning later, inside the
// caches.open() callback, races the page reading the body -- once it has been
// read, clone() throws, the failure is swallowed, and nothing is ever cached.
async function fetchAndStore(request) {
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
  }
  return response;
}
`;
}

export function GET() {
  return new Response(worker(BUILD), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // The browser must always check for a newer worker; that check is the
      // whole update mechanism.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

/*
  sw.js — TES Pro Service Worker (Safe Minimal Version)
  -------------------------------------------------------
  Root cause of original errors:
    • Multiple respondWith() calls on the same fetch event
    • Response.clone() called after body already consumed
    • Caching Firebase SDK responses that can't be cloned

  Fix approach:
    • Only intercept requests we own (same origin, non-Firebase)
    • Never clone a response more than once
    • Skip all external/CDN requests entirely
    • Use a try/catch around every cache operation
    • One and only one respondWith() path per request
*/

const CACHE_NAME = 'tes-pro-v4';

// Files to pre-cache on install
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase.js'
];

// ── Install ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails silently on individual miss — safe for GitHub Pages
      return cache.addAll(PRECACHE).catch((err) => {
        console.warn('[SW] Pre-cache partial failure (non-fatal):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────
// CRITICAL RULES to prevent the original errors:
//   1. Only ONE respondWith() per event — achieved by returning early
//   2. Never intercept non-GET requests
//   3. Never intercept cross-origin requests (Firebase, CDN, Paystack)
//   4. Clone the response BEFORE putting it in cache
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ── Rule 1: Only handle GET ───────────────────────
  if (req.method !== 'GET') return;

  // ── Rule 2: Skip all cross-origin requests ────────
  // This covers: Firebase, Paystack, Google Fonts, CDN scripts
  // These cannot be safely cloned and cause the original errors
  if (url.origin !== self.location.origin) return;

  // ── Rule 3: Skip chrome-extension and data URIs ───
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'data:') return;

  // ── Rule 4: Network-first for HTML navigation ─────
  // Ensures users always get fresh HTML on reload
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          // Cache a clone, return original
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback: serve cached index.html
          return caches.match('./index.html');
        })
    );
    return;
  }

  // ── Rule 5: Cache-first for same-origin assets ────
  // (CSS, JS, images from our own domain)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      // Not in cache — fetch from network
      return fetch(req).then((networkResponse) => {
        // Only cache successful responses
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        // Clone BEFORE caching — original goes to browser, clone to cache
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        return networkResponse;
      }).catch(() => {
        // Network failed and no cache — return nothing (browser shows its error)
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

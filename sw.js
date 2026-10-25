// =====================================================================
// sw.js  -  Service Worker (makes Shadow an installable PWA)
// ---------------------------------------------------------------------
// A service worker is a small script the browser runs in the background.
// Here it saves ("caches") the app's own files, so the app opens instantly
// and even opens with no internet. (Talking to the AI still needs internet,
// unless you use Ollama on your own computer.)
// Change CACHE_NAME whenever you change the files, so users get the update.
// =====================================================================
const CACHE_NAME = "shadow-v1.0.0";
const APP_FILES = [
  "./", "index.html", "css/style.css", "manifest.webmanifest",
  "js/app.js", "js/agent.js", "js/llm.js", "js/tools.js", "js/memory.js", "js/settings.js", "js/voice.js",
  "icons/icon-192.png", "icons/icon-512.png",
];

// Install: download and store the app files.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_FILES)));
  self.skipWaiting();
});

// Activate: delete caches from older versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Fetch: our own files -> network first (fresh), cache if offline.
// Requests to other sites (Gemini, weather...) are never cached.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); return res; })
      .catch(() => caches.match(event.request))
  );
});

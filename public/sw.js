// Service worker for the parents' home-screen app. It only handles the family schedule
// page and the files that page needs; every other request goes to the network untouched.
// The last successfully loaded schedule is kept so it can still be read without a signal,
// and is discarded on sign-out or when the server says the session has ended.
const CACHE = 'family-app-v1';
const SCHEDULE_PATH = '/my-family';
const ASSETS = [
  '/styles.css',
  '/page-styles/family-schedule.css',
  '/st-matthew-logo.png',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('family-app-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const forgetSchedule = () => caches.open(CACHE).then((cache) => cache.delete(SCHEDULE_PATH));

const offlineResponse = () => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Offline</title><body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">'
  + '<p>You’re offline. Connect to the internet to open your family’s schedule.</p>'
  + '<p>Estás sin conexión. Conéctate a internet para abrir el horario de tu familia.</p></body>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);

async function scheduleNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.redirected || !response.ok) {
      await forgetSchedule();
    } else {
      const copy = response.clone();
      await caches.open(CACHE).then((cache) => cache.put(SCHEDULE_PATH, copy));
    }
    return response;
  } catch (error) {
    return (await caches.match(SCHEDULE_PATH)) || offlineResponse();
  }
}

async function assetNetworkFirst(request, path) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(path, copy));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(path);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === SCHEDULE_PATH && request.mode === 'navigate') {
    event.respondWith(scheduleNetworkFirst(request));
  } else if (url.pathname === '/logout') {
    event.respondWith(forgetSchedule().then(() => fetch(request)));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(assetNetworkFirst(request, url.pathname));
  }
});

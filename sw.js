const CACHE_NAME = 'ankang-bp-v1.4.0'
const APP_ASSETS = [
  './',
  './index.html',
  './app-logic.js',
  './manifest.json',
  './icon.svg',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        const copy = response.clone()
        if (response.ok && new URL(request.url).origin === location.origin) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      }).catch(() => caches.match('./index.html'))
    }),
  )
})

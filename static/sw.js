// Service Worker for Offline Support
const CACHE_NAME = 'field-app-v1';
const TILE_CACHE = 'map-tiles-v1';
const DATA_CACHE = 'project-data-v1';

// Core app files to cache
const APP_FILES = [
  '/',
  '/login',
  '/static/css/style.css',
  '/static/js/visit.js',
  '/static/js/offline.js',
  '/static/manifest.json',
  // Leaflet CDN
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install - cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(APP_FILES);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key !== TILE_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Handle map tile requests - cache them
  if (url.hostname.includes('tile.openstreetmap.org') || 
      url.hostname.includes('arcgisonline.com') ||
      url.hostname.includes('server.arcgisonline.com')) {
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          return fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          }).catch(() => {
            // Return placeholder for missing tiles
            return new Response('', { status: 404 });
          });
        });
      })
    );
    return;
  }
  
  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache GET responses
          if (event.request.method === 'GET' && response.ok) {
            const cloned = response.clone();
            caches.open(DATA_CACHE).then((cache) => {
              cache.put(event.request, cloned);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline - try cache
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return new Response(JSON.stringify({ offline: true, error: 'No connection' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }
  
  // Handle other requests - cache first, network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok && event.request.method === 'GET') {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cloned);
          });
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (event.request.headers.get('Accept')?.includes('text/html')) {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Handle sync when back online
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);
  if (event.tag === 'sync-data') {
    event.waitUntil(syncOfflineData());
  }
});

// Message handler for manual sync trigger
self.addEventListener('message', (event) => {
  if (event.data === 'sync-now') {
    syncOfflineData();
  }
  if (event.data.type === 'cache-tiles') {
    cacheTilesForArea(event.data.bounds, event.data.zoom);
  }
});

// Sync offline data to server
async function syncOfflineData() {
  console.log('[SW] Syncing offline data...');
  // This broadcasts to all clients to trigger their sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'do-sync' });
  });
}

// Cache tiles for a specific area
async function cacheTilesForArea(bounds, maxZoom) {
  const cache = await caches.open(TILE_CACHE);
  const tileUrls = getTileUrls(bounds, maxZoom);
  
  let cached = 0;
  for (const url of tileUrls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        cached++;
      }
    } catch (e) {
      console.log('[SW] Failed to cache tile:', url);
    }
  }
  
  // Notify client of progress
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'tiles-cached', count: cached, total: tileUrls.length });
  });
}

// Calculate tile URLs for bounds
function getTileUrls(bounds, maxZoom) {
  const urls = [];
  const baseUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
  
  for (let z = 14; z <= maxZoom; z++) {
    const minTile = latLngToTile(bounds.south, bounds.west, z);
    const maxTile = latLngToTile(bounds.north, bounds.east, z);
    
    for (let x = minTile.x; x <= maxTile.x; x++) {
      for (let y = maxTile.y; y <= minTile.y; y++) {
        urls.push(`${baseUrl}/${z}/${y}/${x}`);
      }
    }
  }
  
  return urls;
}

function latLngToTile(lat, lng, zoom) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y };
}

// Offline Storage and Sync Manager
const DB_NAME = 'field-app-db';
const DB_VERSION = 1;

let db = null;

// Initialize IndexedDB
async function initOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      console.log('[Offline] Database ready');
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      
      // Projects store
      if (!database.objectStoreNames.contains('projects')) {
        const projectStore = database.createObjectStore('projects', { keyPath: 'id' });
        projectStore.createIndex('synced', 'synced', { unique: false });
      }
      
      // GPS points store
      if (!database.objectStoreNames.contains('gps_points')) {
        const gpsStore = database.createObjectStore('gps_points', { keyPath: 'localId', autoIncrement: true });
        gpsStore.createIndex('project_id', 'project_id', { unique: false });
        gpsStore.createIndex('synced', 'synced', { unique: false });
      }
      
      // Photos store
      if (!database.objectStoreNames.contains('photos')) {
        const photoStore = database.createObjectStore('photos', { keyPath: 'localId', autoIncrement: true });
        photoStore.createIndex('project_id', 'project_id', { unique: false });
        photoStore.createIndex('synced', 'synced', { unique: false });
      }
      
      // Sync queue
      if (!database.objectStoreNames.contains('sync_queue')) {
        const syncStore = database.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      // Cached boundaries
      if (!database.objectStoreNames.contains('boundaries')) {
        database.createObjectStore('boundaries', { keyPath: 'parcel_id' });
      }
    };
  });
}

// Check online status
function isOnline() {
  return navigator.onLine;
}

// Save project locally
async function saveProjectLocal(project) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    project.synced = false;
    project.lastModified = Date.now();
    store.put(project);
    tx.oncomplete = () => resolve(project);
    tx.onerror = () => reject(tx.error);
  });
}

// Get project from local storage
async function getProjectLocal(projectId) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const request = store.get(projectId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get all local projects
async function getAllProjectsLocal() {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Save GPS point locally
async function saveGPSPointLocal(projectId, point) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_points', 'readwrite');
    const store = tx.objectStore('gps_points');
    const data = {
      ...point,
      project_id: projectId,
      synced: false,
      timestamp: Date.now()
    };
    const request = store.add(data);
    request.onsuccess = () => resolve(data);
    request.onerror = () => reject(request.error);
  });
}

// Get GPS points for project
async function getGPSPointsLocal(projectId) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('gps_points', 'readonly');
    const store = tx.objectStore('gps_points');
    const index = store.index('project_id');
    const request = index.getAll(projectId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Save photo locally
async function savePhotoLocal(projectId, photoData, label) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const data = {
      project_id: projectId,
      data: photoData,
      label: label,
      synced: false,
      timestamp: Date.now()
    };
    const request = store.add(data);
    request.onsuccess = () => resolve(data);
    request.onerror = () => reject(request.error);
  });
}

// Get photos for project
async function getPhotosLocal(projectId) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const index = store.index('project_id');
    const request = index.getAll(projectId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Save parcel boundary for offline use
async function saveBoundaryLocal(parcelId, boundaryData) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('boundaries', 'readwrite');
    const store = tx.objectStore('boundaries');
    store.put({ parcel_id: parcelId, data: boundaryData, cached: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Get cached boundary
async function getBoundaryLocal(parcelId) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('boundaries', 'readonly');
    const store = tx.objectStore('boundaries');
    const request = store.get(parcelId);
    request.onsuccess = () => resolve(request.result?.data);
    request.onerror = () => reject(request.error);
  });
}

// Add to sync queue
async function addToSyncQueue(action, endpoint, data) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');
    store.add({
      action: action,
      endpoint: endpoint,
      data: data,
      timestamp: Date.now(),
      attempts: 0
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Get pending sync items
async function getPendingSyncs() {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sync_queue', 'readonly');
    const store = tx.objectStore('sync_queue');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Remove from sync queue
async function removeFromSyncQueue(id) {
  if (!db) await initOfflineDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Sync all pending data
async function syncPendingData() {
  if (!isOnline()) {
    console.log('[Offline] Still offline, skipping sync');
    return { synced: 0, failed: 0 };
  }
  
  const pending = await getPendingSyncs();
  let synced = 0;
  let failed = 0;
  
  for (const item of pending) {
    try {
      const response = await fetch(item.endpoint, {
        method: item.action,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.data)
      });
      
      if (response.ok) {
        await removeFromSyncQueue(item.id);
        synced++;
      } else {
        failed++;
      }
    } catch (e) {
      console.log('[Offline] Sync failed for item:', item.id);
      failed++;
    }
  }
  
  console.log(`[Offline] Sync complete: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

// Download project for offline use
async function downloadProjectForOffline(projectId) {
  const statusEl = document.getElementById('offline-status');
  if (statusEl) statusEl.textContent = 'Downloading project data...';
  
  try {
    // Fetch project data
    const response = await fetch(`/api/projects/${projectId}`);
    const project = await response.json();
    
    // Save to IndexedDB
    await saveProjectLocal(project);
    
    // Cache the parcel boundary
    if (project.property?.parcel_id) {
      if (statusEl) statusEl.textContent = 'Caching parcel boundary...';
      const boundaryUrl = `https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Parcels_with_Owner_Info_1/FeatureServer/0/query?where=parcel_id='${project.property.parcel_id}'&outFields=*&f=geojson`;
      
      try {
        const boundaryResp = await fetch(boundaryUrl);
        const boundaryData = await boundaryResp.json();
        await saveBoundaryLocal(project.property.parcel_id, boundaryData);
      } catch (e) {
        console.log('[Offline] Could not cache boundary:', e);
      }
    }
    
    // Cache map tiles for the area
    if (project.property?.center_lat && project.property?.center_lon) {
      if (statusEl) statusEl.textContent = 'Caching map tiles...';
      
      const lat = project.property.center_lat;
      const lon = project.property.center_lon;
      const buffer = 0.01; // About 1km buffer
      
      const bounds = {
        north: lat + buffer,
        south: lat - buffer,
        east: lon + buffer,
        west: lon - buffer
      };
      
      // Tell service worker to cache tiles
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'cache-tiles',
          bounds: bounds,
          zoom: 18
        });
      }
    }
    
    if (statusEl) statusEl.textContent = '✓ Ready for offline use';
    setTimeout(() => {
      if (statusEl) statusEl.textContent = '';
    }, 3000);
    
    return true;
  } catch (e) {
    console.error('[Offline] Download failed:', e);
    if (statusEl) statusEl.textContent = '✗ Download failed';
    return false;
  }
}

// Get unsynced count
async function getUnsyncedCount() {
  const pending = await getPendingSyncs();
  return pending.length;
}

// Listen for online/offline events
window.addEventListener('online', async () => {
  console.log('[Offline] Back online - starting sync');
  showToast('Back online - syncing data...');
  const result = await syncPendingData();
  if (result.synced > 0) {
    showToast(`Synced ${result.synced} items`);
  }
});

window.addEventListener('offline', () => {
  console.log('[Offline] Gone offline');
  showToast('Offline mode - data will sync when connected');
});

// Listen for service worker messages
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'do-sync') {
      syncPendingData();
    }
    if (event.data.type === 'tiles-cached') {
      console.log(`[Offline] Cached ${event.data.count}/${event.data.total} map tiles`);
    }
  });
}

// Simple toast notification
function showToast(message) {
  let toast = document.getElementById('offline-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'offline-toast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a2744;color:white;padding:12px 24px;border-radius:8px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initOfflineDB();
});

// Export functions
window.OfflineManager = {
  isOnline,
  saveProjectLocal,
  getProjectLocal,
  getAllProjectsLocal,
  saveGPSPointLocal,
  getGPSPointsLocal,
  savePhotoLocal,
  getPhotosLocal,
  saveBoundaryLocal,
  getBoundaryLocal,
  addToSyncQueue,
  syncPendingData,
  downloadProjectForOffline,
  getUnsyncedCount
};

/**
 * Field App - Site Visit JavaScript
 */

let projectId = null;
let projectData = null;
let currentGPS = null;
let watchId = null;
let pendingGPSLabel = null;
let isOffline = !navigator.onLine;

// Track online/offline status
window.addEventListener('online', () => { 
    isOffline = false; 
    updateOfflineUI();
    // Sync pending data
    if (window.OfflineManager) {
        window.OfflineManager.syncPendingData();
    }
});
window.addEventListener('offline', () => { 
    isOffline = true; 
    updateOfflineUI();
});

// Update offline UI indicator
async function updateOfflineUI() {
    const bar = document.getElementById('offline-bar');
    const pendingEl = document.getElementById('pending-sync');
    
    if (!bar) return;
    
    if (!navigator.onLine) {
        bar.style.display = 'flex';
        if (window.OfflineManager) {
            const count = await window.OfflineManager.getUnsyncedCount();
            pendingEl.textContent = `${count} pending`;
        }
    } else {
        if (window.OfflineManager) {
            const count = await window.OfflineManager.getUnsyncedCount();
            if (count > 0) {
                bar.style.display = 'flex';
                bar.classList.add('syncing');
                bar.querySelector('span').textContent = '🔄 Syncing...';
                pendingEl.textContent = `${count} items`;
            } else {
                bar.style.display = 'none';
            }
        } else {
            bar.style.display = 'none';
        }
    }
}

// Initialize visit page
async function initVisit(id) {
    projectId = id;
    
    // Start GPS tracking
    startGPSTracking();
    
    // Load project data
    await loadProject();
    
    // Setup event listeners
    setupEventListeners();
    
    // Load saved state from localStorage
    loadLocalState();
    
    // Update offline status
    updateOfflineUI();;
}

// Load project data - with offline fallback
async function loadProject() {
    try {
        // Try online first
        if (navigator.onLine) {
            const response = await fetch(`/api/projects/${projectId}`);
            if (response.ok) {
                projectData = await response.json();
                // Cache for offline
                if (window.OfflineManager) {
                    await window.OfflineManager.saveProjectLocal(projectData);
                }
            } else {
                throw new Error('Server error');
            }
        } else {
            throw new Error('Offline');
        }
    } catch (error) {
        console.log('Loading from offline cache...');
        // Try offline cache
        if (window.OfflineManager) {
            projectData = await window.OfflineManager.getProjectLocal(projectId);
            if (projectData) {
                console.log('Loaded from offline cache');
            }
        }
    }
    
    if (!projectData) {
        console.error('Could not load project');
        alert('Error loading project data');
        return;
    }
    
    // Update UI with project data
    document.getElementById('property-address').textContent = 
        projectData.property?.address || 'Unknown Address';
    document.getElementById('client-name').textContent = 
        projectData.property?.client || '-';
    document.getElementById('parcel-id').textContent = 
        projectData.property?.parcel_id || '-';
    document.getElementById('acres').textContent = 
        projectData.property?.acres ? `${projectData.property.acres} acres` : '-';
    
    // Load GPS points
    updateGPSList();
    
    // Load photos
    updatePhotosList();
    
    // Load notes
    if (projectData.notes) {
        const notes = projectData.notes;
        document.getElementById('notes-concerns').value = notes.concerns || '';
        document.getElementById('notes-findings').value = notes.findings || '';
        document.getElementById('notes-recommendations').value = notes.recommendations || '';
    }
    
    // Restore checklist state
    restoreChecklistState();
}

// GPS Tracking - iOS Optimized
function startGPSTracking() {
    const statusBar = document.getElementById('gps-status');
    const coordsEl = document.getElementById('gps-coords');
    
    if (!('geolocation' in navigator)) {
        coordsEl.textContent = 'GPS not supported';
        statusBar.classList.add('error');
        return;
    }
    
    // Show searching state
    statusBar.classList.add('searching');
    coordsEl.textContent = 'Getting location...';
    
    // iOS requires user interaction for first GPS request
    // Use getCurrentPosition first, then watchPosition for updates
    const gpsOptions = {
        enableHighAccuracy: true,
        timeout: 30000,  // iOS can be slow, give it time
        maximumAge: 10000
    };
    
    // Initial position request
    navigator.geolocation.getCurrentPosition(
        (position) => {
            handleGPSSuccess(position);
            // Now start watching for updates
            startGPSWatch(gpsOptions);
        },
        (error) => {
            handleGPSError(error);
            // Still try to watch - user might grant permission later
            startGPSWatch(gpsOptions);
        },
        gpsOptions
    );
}

function startGPSWatch(options) {
    watchId = navigator.geolocation.watchPosition(
        handleGPSSuccess,
        handleGPSError,
        options
    );
}

function handleGPSSuccess(position) {
    currentGPS = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: new Date().toISOString()
    };
    
    updateGPSStatus(currentGPS);
}

function handleGPSError(error) {
    console.error('GPS Error:', error.code, error.message);
    
    const statusBar = document.getElementById('gps-status');
    const coordsEl = document.getElementById('gps-coords');
    
    statusBar.classList.remove('searching');
    statusBar.classList.add('error');
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            coordsEl.textContent = 'Location access denied';
            // Show iOS-specific help
            if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                alert('Please enable Location Services:\\n\\nSettings → Privacy → Location Services → Safari → While Using');
            }
            break;
        case error.POSITION_UNAVAILABLE:
            coordsEl.textContent = 'Location unavailable';
            break;
        case error.TIMEOUT:
            coordsEl.textContent = 'Location timeout - retrying...';
            break;
        default:
            coordsEl.textContent = 'GPS error';
    }
}

function updateGPSStatus(gps) {
    const statusBar = document.getElementById('gps-status');
    const coordsEl = document.getElementById('gps-coords');
    const elevEl = document.getElementById('gps-elevation');
    const accEl = document.getElementById('gps-accuracy');
    
    statusBar.classList.remove('searching', 'error');
    
    coordsEl.textContent = `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
    
    // Display elevation in feet (GPS returns meters)
    if (gps.altitude !== null && gps.altitude !== undefined) {
        const elevFeet = Math.round(gps.altitude * 3.28084);
        elevEl.textContent = `⛰️ ${elevFeet.toLocaleString()} ft`;
    } else {
        elevEl.textContent = '⛰️ --';
    }
    
    accEl.textContent = `±${Math.round(gps.accuracy)}m`;
    
    // Color code by accuracy using CSS classes
    statusBar.className = 'gps-status';
    if (gps.accuracy < 10) {
        // Excellent - green
        statusBar.style.background = 'var(--color-success)';
    } else if (gps.accuracy < 30) {
        // Good - yellow
        statusBar.style.background = 'var(--color-warning)';
    } else {
        // Poor - still usable
        statusBar.style.background = 'var(--color-primary)';
    }
}

// Capture GPS Point
function captureGPS(label) {
    pendingGPSLabel = label;
    
    const modal = document.getElementById('gps-modal');
    const statusEl = document.getElementById('gps-modal-status');
    const labelInput = document.getElementById('gps-label');
    const latInput = document.getElementById('gps-lat');
    const lonInput = document.getElementById('gps-lon');
    const elevInput = document.getElementById('gps-elev');
    const accInput = document.getElementById('gps-acc');
    const saveBtn = document.getElementById('save-gps-btn');
    
    // Set default label
    const labelMap = {
        'driveway_entry': 'Driveway Entry',
        'corner_ne': 'Corner NE',
        'corner_se': 'Corner SE',
        'corner_sw': 'Corner SW',
        'corner_nw': 'Corner NW',
        'house_location': '🏠 House Location',
        'septic_tank': '🚽 Septic Tank',
        'leach_field': '🌿 Leach Field',
        'soil_pit': '🕳️ Soil Pit',
        'well_location': '💧 Well',
        'power_pole': '⚡ Power Pole',
        'custom': ''
    };
    
    labelInput.value = labelMap[label] || label;
    
    modal.classList.add('active');
    
    if (currentGPS) {
        statusEl.textContent = '✅ GPS Ready';
        statusEl.className = 'gps-modal-status success';
        latInput.value = currentGPS.lat.toFixed(6);
        lonInput.value = currentGPS.lon.toFixed(6);
        
        // Show elevation in feet
        if (currentGPS.altitude !== null && currentGPS.altitude !== undefined) {
            const elevFeet = Math.round(currentGPS.altitude * 3.28084);
            elevInput.value = `${elevFeet.toLocaleString()} ft (±${Math.round(currentGPS.altitudeAccuracy || 0)}m)`;
        } else {
            elevInput.value = 'Not available';
        }
        
        accInput.value = `±${Math.round(currentGPS.accuracy)}m`;
        saveBtn.disabled = false;
    } else {
        statusEl.textContent = '📍 Getting location...';
        statusEl.className = 'gps-modal-status';
        latInput.value = '';
        lonInput.value = '';
        elevInput.value = '';
        accInput.value = '';
        saveBtn.disabled = true;
        
        // Try to get fresh position
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentGPS = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    altitude: position.coords.altitude,
                    altitudeAccuracy: position.coords.altitudeAccuracy,
                    timestamp: new Date().toISOString()
                };
                
                statusEl.textContent = '✅ GPS Ready';
                statusEl.className = 'gps-modal-status success';
                latInput.value = currentGPS.lat.toFixed(6);
                lonInput.value = currentGPS.lon.toFixed(6);
                
                // Show elevation in feet
                if (currentGPS.altitude !== null && currentGPS.altitude !== undefined) {
                    const elevFeet = Math.round(currentGPS.altitude * 3.28084);
                    elevInput.value = `${elevFeet.toLocaleString()} ft`;
                } else {
                    elevInput.value = 'Not available';
                }
                
                accInput.value = `±${Math.round(currentGPS.accuracy)}m`;
                saveBtn.disabled = false;
            },
            (error) => {
                statusEl.textContent = '❌ GPS Failed - Try again';
                statusEl.className = 'gps-modal-status error';
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    }
}

function closeGPSModal() {
    document.getElementById('gps-modal').classList.remove('active');
    pendingGPSLabel = null;
}

async function saveGPSPoint() {
    const label = document.getElementById('gps-label').value;
    const lat = parseFloat(document.getElementById('gps-lat').value);
    const lon = parseFloat(document.getElementById('gps-lon').value);
    
    if (!label || isNaN(lat) || isNaN(lon)) {
        alert('Please enter a label and ensure GPS is ready');
        return;
    }
    
    // Calculate elevation in feet from meters
    const altitudeMeters = currentGPS?.altitude;
    const elevationFeet = (altitudeMeters !== null && altitudeMeters !== undefined) 
        ? Math.round(altitudeMeters * 3.28084) 
        : null;
    
    const point = {
        label: label,
        lat: lat,
        lon: lon,
        altitude_m: altitudeMeters,
        elevation_ft: elevationFeet,
        altitude_accuracy: currentGPS?.altitudeAccuracy || null,
        accuracy: currentGPS?.accuracy || null,
        type: pendingGPSLabel,
        timestamp: new Date().toISOString()
    };
    
    try {
        if (navigator.onLine) {
            // Save to server
            await fetch(`/api/projects/${projectId}/gps`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(point)
            });
        } else {
            // Offline - save locally and queue for sync
            if (window.OfflineManager) {
                await window.OfflineManager.saveGPSPointLocal(projectId, point);
                await window.OfflineManager.addToSyncQueue('POST', `/api/projects/${projectId}/gps`, point);
            }
        }
        
        // Update local data
        if (!projectData.gps_points) projectData.gps_points = [];
        projectData.gps_points.push(point);
        
        // Update UI
        updateGPSList();
        
        // Close modal
        closeGPSModal();
        
        // Show confirmation
        showToast(`📍 ${label} saved!` + (navigator.onLine ? '' : ' (offline)'));
        
    } catch (error) {
        console.error('Error saving GPS point:', error);
        // Try offline save as fallback
        if (window.OfflineManager) {
            await window.OfflineManager.saveGPSPointLocal(projectId, point);
            await window.OfflineManager.addToSyncQueue('POST', `/api/projects/${projectId}/gps`, point);
            if (!projectData.gps_points) projectData.gps_points = [];
            projectData.gps_points.push(point);
            updateGPSList();
            closeGPSModal();
            showToast(`📍 ${label} saved offline - will sync later`);
        } else {
            alert('Error saving GPS point');
        }
    }
}

function updateGPSList() {
    const container = document.getElementById('gps-points-list');
    
    if (!projectData.gps_points || projectData.gps_points.length === 0) {
        container.innerHTML = '<p class="empty-state">No GPS points captured yet</p>';
        return;
    }
    
    container.innerHTML = projectData.gps_points.map((p, i) => {
        const elevText = p.elevation_ft ? `⛰️ ${p.elevation_ft.toLocaleString()} ft` : '';
        return `
            <div class="gps-point-item">
                <div class="gps-point-label">${p.label}</div>
                <div class="gps-point-coords">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</div>
                ${elevText ? `<div class="gps-point-elev">${elevText}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Tab Navigation
function setupEventListeners() {
    console.log('Setting up event listeners...');
    // Tab buttons
    const tabBtns = document.querySelectorAll('.tab-btn');
    console.log('Found tab buttons:', tabBtns.length);
    
    tabBtns.forEach(btn => {
        console.log('Adding listener to tab:', btn.dataset.tab);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tab = btn.dataset.tab;
            console.log('Tab clicked:', tab);
            
            // Update buttons
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update panels
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById(`tab-${tab}`);
            console.log('Panel found:', panel ? 'yes' : 'no');
            if (panel) panel.classList.add('active');
            
            // Initialize map when map tab is shown (Leaflet needs visible container)
            if (tab === 'map') {
                console.log('Initializing map...');
                setTimeout(() => {
                    initMap();
                    if (siteMap) {
                        siteMap.invalidateSize();
                    }
                }, 100);
            }
        });
    });
    
    // Checkbox changes
    document.querySelectorAll('.check-item input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            saveLocalState();
            updateSectionStatus(cb.dataset.section);
        });
    });
    
    // Button options
    document.querySelectorAll('.btn-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const field = btn.dataset.field;
            const value = btn.dataset.value;
            
            // Toggle active state within group
            btn.parentElement.querySelectorAll('.btn-option').forEach(b => {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            
            // Save state
            saveFieldValue(field, value);
        });
    });
    
    // Camera input
    document.getElementById('camera-input')?.addEventListener('change', handlePhotoCapture);
}

// Section toggle
function toggleSection(sectionId) {
    const body = document.getElementById(`section-${sectionId}`);
    body.classList.toggle('collapsed');
}

// Update section status
function updateSectionStatus(section) {
    const checkboxes = document.querySelectorAll(`input[data-section="${section}"]`);
    const checked = document.querySelectorAll(`input[data-section="${section}"]:checked`);
    
    const statusEl = document.getElementById(`status-${section}`);
    if (statusEl) {
        statusEl.textContent = `${checked.length}/${checkboxes.length}`;
    }
}

// Local storage for offline support
function saveLocalState() {
    const state = {
        checkboxes: {},
        fields: {},
        options: {}
    };
    
    // Save checkbox states
    document.querySelectorAll('.check-item input[type="checkbox"]').forEach(cb => {
        const key = `${cb.dataset.section}_${cb.dataset.item}`;
        state.checkboxes[key] = cb.checked;
    });
    
    // Save text inputs
    document.querySelectorAll('input[type="text"], input[type="number"], input[type="time"], select, textarea').forEach(input => {
        if (input.id) {
            state.fields[input.id] = input.value;
        }
    });
    
    // Save button options
    document.querySelectorAll('.btn-option.active').forEach(btn => {
        state.options[btn.dataset.field] = btn.dataset.value;
    });
    
    localStorage.setItem(`visit_${projectId}`, JSON.stringify(state));
}

function loadLocalState() {
    const saved = localStorage.getItem(`visit_${projectId}`);
    if (!saved) return;
    
    const state = JSON.parse(saved);
    
    // Restore checkboxes
    if (state.checkboxes) {
        Object.entries(state.checkboxes).forEach(([key, checked]) => {
            const [section, item] = key.split('_');
            const cb = document.querySelector(`input[data-section="${section}"][data-item="${item}"]`);
            if (cb) {
                cb.checked = checked;
            }
        });
    }
    
    // Restore text fields
    if (state.fields) {
        Object.entries(state.fields).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.value = value;
        });
    }
    
    // Restore button options
    if (state.options) {
        Object.entries(state.options).forEach(([field, value]) => {
            const btn = document.querySelector(`.btn-option[data-field="${field}"][data-value="${value}"]`);
            if (btn) btn.classList.add('active');
        });
    }
    
    // Update all section statuses
    ['arrival', 'access', 'corners', 'buildsite', 'septic', 'soils', 'well', 'utilities', 'assessment'].forEach(section => {
        updateSectionStatus(section);
    });
}

function restoreChecklistState() {
    loadLocalState();
}

function saveFieldValue(field, value) {
    saveLocalState();
}

// Photo capture - iOS optimized with compression
function capturePhoto() {
    const input = document.getElementById('camera-input');
    input.click();
}

// Compress image for faster upload and storage
function compressImage(file, maxWidth = 1600, quality = 0.8) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Scale down if too large
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to compressed JPEG
                const compressedData = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedData);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handlePhotoCapture(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const label = document.getElementById('photo-label').value;
    
    // Show loading state
    showToast('📷 Processing photo...');
    
    try {
        // Compress the image (iPhone photos are 12MP+)
        const photoData = await compressImage(file, 1600, 0.8);
        
        if (navigator.onLine) {
            const response = await fetch(`/api/projects/${projectId}/photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    photo: photoData,
                    label: label,
                    gps: currentGPS,
                    timestamp: new Date().toISOString()
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Update local data
                if (!projectData.photos) projectData.photos = [];
                projectData.photos.push({
                    id: result.photo_id,
                    label: label,
                    data: photoData
                });
                
                updatePhotosList();
                showToast(`✅ ${label} photo saved!`);
            } else {
                throw new Error(result.error || 'Upload failed');
            }
        } else {
            // Offline - save locally and queue
            if (window.OfflineManager) {
                await window.OfflineManager.savePhotoLocal(projectId, photoData, label);
                await window.OfflineManager.addToSyncQueue('POST', `/api/projects/${projectId}/photo`, {
                    photo: photoData,
                    label: label,
                    gps: currentGPS,
                    timestamp: new Date().toISOString()
                });
            }
            
            if (!projectData.photos) projectData.photos = [];
            projectData.photos.push({
                id: Date.now(),
                label: label,
                data: photoData
            });
            
            updatePhotosList();
            showToast(`✅ ${label} saved offline - will sync later`);
        }
    } catch (error) {
        console.error('Error saving photo:', error);
        // Try offline fallback
        if (window.OfflineManager) {
            const photoData = await compressImage(file, 1600, 0.8);
            await window.OfflineManager.savePhotoLocal(projectId, photoData, label);
            await window.OfflineManager.addToSyncQueue('POST', `/api/projects/${projectId}/photo`, {
                photo: photoData,
                label: label,
                gps: currentGPS,
                timestamp: new Date().toISOString()
            });
            if (!projectData.photos) projectData.photos = [];
            projectData.photos.push({ id: Date.now(), label: label, data: photoData });
            updatePhotosList();
            showToast(`✅ ${label} saved offline`);
        } else {
            showToast('❌ Error saving photo');
        }
    }
    
    // Reset input for next photo
    event.target.value = '';
}

function updatePhotosList() {
    const container = document.getElementById('photos-list');
    
    if (!projectData.photos || projectData.photos.length === 0) {
        container.innerHTML = '<p class="empty-state">No photos captured yet</p>';
        return;
    }
    
    container.innerHTML = projectData.photos.map(p => `
        <div class="photo-item">
            <img src="${p.data || `/photos/${p.filename}`}" alt="${p.label}">
            <div class="photo-item-label">${p.label}</div>
        </div>
    `).join('');
}

// Save notes
async function saveNotes() {
    const notes = {
        concerns: document.getElementById('notes-concerns').value,
        findings: document.getElementById('notes-findings').value,
        recommendations: document.getElementById('notes-recommendations').value
    };
    
    projectData.notes = notes;
    
    try {
        if (navigator.onLine) {
            await fetch(`/api/projects/${projectId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(projectData)
            });
        } else {
            // Offline - save locally and queue
            if (window.OfflineManager) {
                await window.OfflineManager.saveProjectLocal(projectData);
                await window.OfflineManager.addToSyncQueue('PUT', `/api/projects/${projectId}`, projectData);
            }
        }
        
        showToast('📝 Notes saved!' + (navigator.onLine ? '' : ' (offline)'));
    } catch (error) {
        console.error('Error saving notes:', error);
        // Fallback to offline
        if (window.OfflineManager) {
            await window.OfflineManager.saveProjectLocal(projectData);
            await window.OfflineManager.addToSyncQueue('PUT', `/api/projects/${projectId}`, projectData);
            showToast('📝 Notes saved offline');
        } else {
            alert('Error saving notes');
        }
    }
}

// Save progress
async function saveProgress() {
    saveLocalState();
    
    try {
        await fetch(`/api/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectData)
        });
        
        showToast('💾 Progress saved!');
    } catch (error) {
        console.error('Error saving progress:', error);
        alert('Error saving progress');
    }
}

// Complete visit
async function completeVisit() {
    if (!confirm('Mark this site visit as complete?')) return;
    
    projectData.status = 'complete';
    projectData.completed = new Date().toISOString();
    
    try {
        await fetch(`/api/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectData)
        });
        
        alert('✅ Visit completed! Data saved.');
        window.location.href = '/';
        
    } catch (error) {
        console.error('Error completing visit:', error);
        alert('Error completing visit');
    }
}

// Toast notification - iOS safe area aware
function showToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.cssText = `
        position: fixed;
        bottom: calc(90px + env(safe-area-inset-bottom, 0px));
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-bg-alt, #1e293b);
        color: var(--color-text, white);
        padding: 14px 24px;
        border-radius: 12px;
        z-index: 9999;
        font-weight: 500;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        border: 1px solid var(--color-border, rgba(255,255,255,0.1));
        animation: toastSlide 2.5s ease-in-out forwards;
        max-width: 90%;
        text-align: center;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 2500);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes toastSlide {
        0% { 
            opacity: 0; 
            transform: translateX(-50%) translateY(20px);
        }
        15%, 85% { 
            opacity: 1; 
            transform: translateX(-50%) translateY(0);
        }
        100% { 
            opacity: 0; 
            transform: translateX(-50%) translateY(-10px);
        }
    }
`;
document.head.appendChild(style);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
    saveLocalState();
});

// ===== LEAFLET MAP =====
let siteMap = null;
let userMarker = null;
let parcelLayer = null;
let setbackLayer = null;
let pinsLayer = null;
let wellCirclesLayer = null;
let parcelVisible = true;
let setbackVisible = true;

// Initialize the map
function initMap() {
    if (siteMap) return; // Already initialized
    
    // Default to property center or Colorado
    const defaultCenter = [39.160840, -104.932185]; // Rodrigo's property
    
    siteMap = L.map('site-map', {
        center: defaultCenter,
        zoom: 17,
        zoomControl: true,
        attributionControl: false
    });
    
    // Add satellite imagery layer (Esri)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    }).addTo(siteMap);
    
    // Add labels overlay
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        opacity: 0.8
    }).addTo(siteMap);
    
    // Create layer groups
    pinsLayer = L.layerGroup().addTo(siteMap);
    wellCirclesLayer = L.layerGroup().addTo(siteMap);

    // Load parcel boundary
    loadParcelBoundary();
    
    // Add existing GPS points as pins
    updateMapPins();
    
    // Add user location marker
    if (currentGPS) {
        updateUserMarker(currentGPS);
    }
    
    // Click to drop pin
    siteMap.on('click', function(e) {
        showPinPopup(e.latlng);
    });
}

// Load parcel boundary from Colorado GIS
async function loadParcelBoundary() {
    if (!projectData?.property?.parcel_id) {
        console.log('No parcel ID available');
        return;
    }
    
    const parcelId = projectData.property.parcel_id;
    
    try {
        // Query Colorado GIS for parcel geometry
        const url = `https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0/query?where=PARCEL_ID='${parcelId}'&outFields=*&returnGeometry=true&f=geojson`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            // Add parcel polygon
            parcelLayer = L.geoJSON(data, {
                style: {
                    color: '#f59e0b',
                    weight: 3,
                    fillColor: '#f59e0b',
                    fillOpacity: 0.15,
                    dashArray: '5, 5'
                }
            }).addTo(siteMap);
            
            // Fit map to parcel bounds
            siteMap.fitBounds(parcelLayer.getBounds(), { padding: [30, 30] });
            
            // Create 10ft setback buffer (inner line)
            createSetbackBuffer(data.features[0]);
            
            console.log('Parcel boundary loaded');
        } else {
            console.log('No parcel geometry found');
        }
    } catch (error) {
        console.error('Error loading parcel:', error);
    }
}

// Create 10ft setback buffer inside parcel
function createSetbackBuffer(feature) {
    if (!feature || !feature.geometry) return;
    
    // 10 feet in degrees (approximate at Colorado latitude)
    // 1 degree latitude ≈ 364,000 feet
    // 1 degree longitude ≈ 288,000 feet at 39°N
    const feetToDegreesLat = 10 / 364000;
    const feetToDegreesLon = 10 / 288000;
    
    try {
        // Get coordinates from the geometry
        const coords = feature.geometry.coordinates[0];
        if (!coords || coords.length < 3) return;
        
        // Calculate centroid for shrinking direction
        let centroidLat = 0, centroidLon = 0;
        coords.forEach(c => {
            centroidLon += c[0];
            centroidLat += c[1];
        });
        centroidLon /= coords.length;
        centroidLat /= coords.length;
        
        // Shrink each point toward centroid by ~10ft
        const bufferCoords = coords.map(c => {
            const lon = c[0];
            const lat = c[1];
            
            // Direction to centroid
            const dLon = centroidLon - lon;
            const dLat = centroidLat - lat;
            const dist = Math.sqrt(dLon * dLon + dLat * dLat);
            
            if (dist === 0) return [lon, lat];
            
            // Move ~10ft toward centroid
            const moveLon = (dLon / dist) * feetToDegreesLon;
            const moveLat = (dLat / dist) * feetToDegreesLat;
            
            return [lon + moveLon, lat + moveLat];
        });
        
        // Create the setback polygon
        const setbackGeoJSON = {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [bufferCoords]
            }
        };
        
        setbackLayer = L.geoJSON(setbackGeoJSON, {
            style: {
                color: '#ef4444',  // Red
                weight: 2,
                fillOpacity: 0,
                dashArray: '3, 6'
            }
        }).addTo(siteMap);
        
        console.log('10ft setback buffer created');
        
    } catch (error) {
        console.error('Error creating setback buffer:', error);
    }
}

// Update user position marker
function updateUserMarker(gps) {
    if (!siteMap) return;
    
    const latlng = [gps.lat, gps.lon];
    
    if (userMarker) {
        userMarker.setLatLng(latlng);
    } else {
        // Create custom pulsing marker
        const pulseIcon = L.divIcon({
            className: 'pulse-marker',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        
        userMarker = L.marker(latlng, { 
            icon: pulseIcon,
            zIndexOffset: 1000
        }).addTo(siteMap);
        
        userMarker.bindPopup(`
            <div style="text-align:center">
                <strong>📍 You are here</strong><br>
                <small>${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}</small><br>
                ${gps.altitude ? `<small>⛰️ ${Math.round(gps.altitude * 3.28084).toLocaleString()} ft</small>` : ''}
            </div>
        `);
    }
}

// Center map on user
function centerOnMe() {
    if (currentGPS && siteMap) {
        siteMap.setView([currentGPS.lat, currentGPS.lon], 18);
        showToast('🎯 Centered on your location');
    } else {
        showToast('⏳ Waiting for GPS...');
    }
}

// Toggle parcel visibility
function toggleParcel() {
    if (!parcelLayer) {
        showToast('No parcel boundary loaded');
        return;
    }
    
    if (parcelVisible) {
        siteMap.removeLayer(parcelLayer);
        parcelVisible = false;
        showToast('Parcel hidden');
    } else {
        parcelLayer.addTo(siteMap);
        parcelVisible = true;
        showToast('Parcel shown');
    }
}

// Drop pin at current location
function dropPinAtLocation() {
    if (!currentGPS) {
        showToast('⏳ Waiting for GPS...');
        return;
    }
    
    showPinPopup(L.latLng(currentGPS.lat, currentGPS.lon), currentGPS);
}

// Show popup to label pin
function showPinPopup(latlng, gpsData = null) {
    const elevFeet = gpsData?.altitude 
        ? Math.round(gpsData.altitude * 3.28084).toLocaleString() 
        : null;
    
    const popup = L.popup({ maxWidth: 280 })
        .setLatLng(latlng)
        .setContent(`
            <div class="pin-popup">
                <div class="pin-quick-btns">
                    <button class="pin-quick" onclick="quickSavePin('Well', ${latlng.lat}, ${latlng.lng}, ${gpsData?.altitude || 'null'})">💧 Well</button>
                    <button class="pin-quick" onclick="quickSavePin('STA', ${latlng.lat}, ${latlng.lng}, ${gpsData?.altitude || 'null'})">🚽 STA</button>
                    <button class="pin-quick" onclick="quickSavePin('House', ${latlng.lat}, ${latlng.lng}, ${gpsData?.altitude || 'null'})">🏠 House</button>
                </div>
                <div class="pin-quick-btns">
                    <button class="pin-quick" onclick="quickSavePin('Power', ${latlng.lat}, ${latlng.lng}, ${gpsData?.altitude || 'null'})">⚡ Power</button>
                    <button class="pin-quick" onclick="quickSavePin('Driveway', ${latlng.lat}, ${latlng.lng}, ${gpsData?.altitude || 'null'})">🚧 Driveway</button>
                    <button class="pin-quick" onclick="quickSavePin('Corner', ${latlng.lat}, ${latlng.lng}, ${gpsData?.altitude || 'null'})">🚩 Corner</button>
                </div>
                <input type="text" id="pin-label" placeholder="Or type custom label...">
                <div style="font-size: 11px; color: #888; margin-bottom: 8px;">
                    ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}
                    ${elevFeet ? `<br>⛰️ ${elevFeet} ft` : ''}
                </div>
                <button onclick="savePinFromPopup(${latlng.lat}, ${latlng.lng}, ${gpsData?.altitude || 'null'})">
                    📍 Save Pin
                </button>
            </div>
        `)
        .openOn(siteMap);
}

// Quick save with preset label
function quickSavePin(label, lat, lng, altitude) {
    document.getElementById('pin-label').value = label;
    savePinFromPopup(lat, lng, altitude);
}

// Save pin from popup
async function savePinFromPopup(lat, lng, altitude) {
    const labelInput = document.getElementById('pin-label');
    const label = labelInput?.value || 'Marker';
    
    const elevFeet = altitude ? Math.round(altitude * 3.28084) : null;
    
    const point = {
        label: label,
        lat: lat,
        lon: lng,
        altitude_m: altitude,
        elevation_ft: elevFeet,
        accuracy: currentGPS?.accuracy || null,
        type: 'map_pin',
        timestamp: new Date().toISOString()
    };
    
    try {
        // Save to server
        await fetch(`/api/projects/${projectId}/gps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(point)
        });
        
        // Update local data
        if (!projectData.gps_points) projectData.gps_points = [];
        projectData.gps_points.push(point);
        
        // Update map and GPS list
        updateMapPins();
        updateGPSList();
        
        // Draw 100ft circle for Well pins
        if (label.toLowerCase() === 'well') {
            drawWellCircle(lat, lng);
        }
        
        // Draw 50ft circle for House pins (well setback)
        if (label.toLowerCase() === 'house') {
            drawHouseCircle(lat, lng);
        }
        
        // Draw 10ft circle for STA pins (house setback per Reg 43)
        if (label.toLowerCase() === 'sta') {
            drawSTACircle(lat, lng);
        }
        
        // Close popup
        siteMap.closePopup();
        
        showToast(`📍 ${label} saved!`);
        
    } catch (error) {
        console.error('Error saving pin:', error);
        showToast('❌ Error saving pin');
    }
}

// Draw 100ft radius circle around a well
function drawWellCircle(lat, lng) {
    if (!siteMap || !wellCirclesLayer) return;
    
    // 100 feet = 30.48 meters
    const radiusMeters = 30.48;
    
    const circle = L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#3b82f6',  // Blue
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.1,
        dashArray: '4, 4'
    });
    
    circle.bindPopup(`<b>100ft Well Setback</b><br>STA must be outside this circle`);
    wellCirclesLayer.addLayer(circle);
    
    showToast('💧 100ft well setback drawn');
}

// Draw 50ft radius circle around house (well protection zone)
function drawHouseCircle(lat, lng) {
    if (!siteMap || !wellCirclesLayer) return;
    
    // 50 feet = 15.24 meters (well must be 50ft from house sewer)
    const radiusMeters = 15.24;
    
    const circle = L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#22c55e',  // Green
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.1,
        dashArray: '4, 4'
    });
    
    circle.bindPopup(`<b>50ft House Zone</b><br>Well should be outside this area`);
    wellCirclesLayer.addLayer(circle);
    
    showToast('🏠 50ft house zone drawn');
}

// Draw 10ft radius circle around STA (Reg 43 min from dwelling)
function drawSTACircle(lat, lng) {
    if (!siteMap || !wellCirclesLayer) return;
    
    // 10 feet = 3.048 meters (min distance to dwelling per Reg 43)
    const radiusMeters = 3.048;
    
    const circle = L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#a855f7',  // Purple
        weight: 2,
        fillColor: '#a855f7',
        fillOpacity: 0.15,
        dashArray: '4, 4'
    });
    
    circle.bindPopup(`<b>10ft STA Buffer</b><br>Min distance to dwelling (Reg 43)`);
    wellCirclesLayer.addLayer(circle);
    
    showToast('🚽 10ft STA buffer drawn');
}

// Update map pins from GPS points
function updateMapPins() {
    if (!siteMap || !pinsLayer) return;
    
    pinsLayer.clearLayers();
    
    if (!projectData?.gps_points) return;
    
    projectData.gps_points.forEach(point => {
        // Choose icon based on pin type
        let iconHtml = '';
        const label = point.label?.toLowerCase() || '';
        
        if (label === 'power') {
            iconHtml = `<div style="
                background: #fbbf24;
                width: 20px;
                height: 20px;
                border-radius: 4px;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
            ">⚡</div>`;
        } else if (label === 'driveway') {
            iconHtml = `<div style="
                background: #6b7280;
                width: 20px;
                height: 20px;
                border-radius: 4px;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
            ">🚧</div>`;
        } else if (label === 'well') {
            iconHtml = `<div style="
                background: #3b82f6;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
            ">💧</div>`;
        } else if (label === 'sta') {
            iconHtml = `<div style="
                background: #a855f7;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
            ">🚽</div>`;
        } else if (label === 'house') {
            iconHtml = `<div style="
                background: #22c55e;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
            ">🏠</div>`;
        } else {
            iconHtml = `<div style="
                background: #ef4444;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            "></div>`;
        }
        
        const marker = L.marker([point.lat, point.lon], {
            icon: L.divIcon({
                className: 'pin-marker',
                html: iconHtml,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        });
        
        const elevText = point.elevation_ft 
            ? `<br>⛰️ ${point.elevation_ft.toLocaleString()} ft` 
            : '';
        
        marker.bindPopup(`
            <div style="text-align:center">
                <strong>${point.label}</strong><br>
                <small>${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}</small>
                ${elevText}
            </div>
        `);
        
        pinsLayer.addLayer(marker);
        
        // Draw circles for special pin types
        if (label === 'well') {
            drawWellCircle(point.lat, point.lon);
        } else if (label === 'house') {
            drawHouseCircle(point.lat, point.lon);
        } else if (label === 'sta') {
            drawSTACircle(point.lat, point.lon);
        }
    });
}

// Override updateGPSStatus to also update map
const originalUpdateGPSStatus = updateGPSStatus;
updateGPSStatus = function(gps) {
    originalUpdateGPSStatus(gps);
    updateUserMarker(gps);
};

// Initialize map when tab is shown
document.addEventListener('DOMContentLoaded', () => {
    const mapTab = document.querySelector('[data-tab="map"]');
    if (mapTab) {
        mapTab.addEventListener('click', () => {
            setTimeout(initMap, 100);
        });
    }
});

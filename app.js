// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONFIGURATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const API = 'http://localhost:5000/api';
const NOMINATIM_API = 'https://nominatim.openstreetmap.org';

// â”€â”€ STATE â”€â”€
let selectedAlgo = 'dijkstra';
let selectedMultiRouteIdx = 0;
let meshTrafficIntensity = 0.35;
let meshSeed = 424242;
let meshPatternMode = 'radial';
let meshResolutionFactor = 1.0;
let currentHexEdgeMeters = 75;
let hexCells = [];
let hexCellById = new Map();
let hexLayer;
let activeHexRoute = [];
let meshRenderVersion = 0;
let meshRefreshTimer = null;
let meshViewportKey = '';
let hexCanvasRenderer = null;

// â”€â”€ MAP â”€â”€
let map;
let nodeMarkers = {};
let edgeLines = [];
let bounds;
let globeViewer = null;
let globeMode = false;
let latestRouteCoords = [];
let globeAutoRotate = false;
let globeTickHandler = null;
let globeNightMode = true;
let globeRouteDataSource = null;
let globeMeshDataSource = null;
let globeMeshRefreshTimer = null;
let globeMeshLodKey = '';
let globeFallbackLock = false;
let globeGuardsBound = false;
const INDIA_FOCUS = {
  lon: 78.9629,
  lat: 22.5937,
  height: 9000000,
  heading: 0,
  pitch: -90,
  roll: 0
};

const HEX_EDGE_MIN_METERS = 50;
const HEX_EDGE_MAX_METERS = 100;
const HEX_GEO_HEIGHT_MIN_METERS = 50;
const HEX_GEO_HEIGHT_MAX_METERS = 100;
const HEX_INTERACTION_DEBOUNCE_MS = 140;

const DEVICE_MEMORY_GB = (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number')
  ? navigator.deviceMemory
  : 4;

const GPU_ACCEL_AVAILABLE = (() => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch (_) {
    return false;
  }
})();

const HIGH_VRAM_HINT = GPU_ACCEL_AVAILABLE && DEVICE_MEMORY_GB >= 8;
const HEX_CELL_BUDGET_2D = HIGH_VRAM_HINT ? 6500 : 4500;
const HEX_CELL_BUDGET_3D = HIGH_VRAM_HINT ? 2800 : 1800;
const HEX_DENSITY_FETCH_BATCH = HIGH_VRAM_HINT ? 1800 : 1200;
const HEX_RENDER_CHUNK_CPU = 120;
const HEX_RENDER_CHUNK_GPU = HIGH_VRAM_HINT ? 420 : 260;
const DEFAULT_VIEW_MODE = '2d';
const GLOBE_ROUTE_MAX_POINTS = 260;
const GLOBE_MESH_REFRESH_DEBOUNCE_MS = 220;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INIT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.addEventListener('DOMContentLoaded', async () => {
  await loadMeshConfigFromServer();
  initMap();
  setAlgo(selectedAlgo);
  bindGlobeRuntimeGuards();
  if (DEFAULT_VIEW_MODE === '3d') {
    const started3D = enable3DFirstView();
    if (!started3D) {
      showToast('3D startup failed. Running in 2D fallback mode.', 'warn');
    }
  } else {
    showToast('2D default mode enabled for stable submission. Use 3D button if needed.', 'info');
  }
});

async function loadMeshConfigFromServer() {
  try {
    const res = await fetch(`${API}/mesh/config`);
    const cfg = await res.json();
    if (typeof cfg.intensity === 'number') meshTrafficIntensity = cfg.intensity;
    if (typeof cfg.seed === 'number') meshSeed = cfg.seed;
    if (typeof cfg.pattern_mode === 'string') meshPatternMode = cfg.pattern_mode;
    if (typeof cfg.refinement_factor === 'number') meshResolutionFactor = cfg.refinement_factor;
    const slider = document.getElementById('traffic-slider');
    const val = document.getElementById('traffic-val');
    if (slider && val) {
      const pct = Math.round(meshTrafficIntensity * 100);
      slider.value = String(pct);
      val.textContent = `${pct}%`;
    }
    syncSyntheticControlFields();
  } catch (_) {
    // Keep local defaults if backend mesh config is unavailable.
  }
}

function syncSyntheticControlFields() {
  const seedInput = document.getElementById('mesh-seed-input');
  const refineSlider = document.getElementById('mesh-refine-slider');
  const refineVal = document.getElementById('mesh-refine-val');
  const patternSelect = document.getElementById('mesh-pattern-mode');

  if (seedInput) seedInput.value = String(Math.trunc(meshSeed));
  if (refineSlider) refineSlider.value = String(Math.round(meshResolutionFactor * 100));
  if (refineVal) refineVal.textContent = `${currentHexEdgeMeters.toFixed(0)}m`;
  if (patternSelect) patternSelect.value = meshPatternMode;
}

async function persistMeshConfig(extra = {}) {
  const body = {
    seed: Math.trunc(meshSeed),
    intensity: meshTrafficIntensity,
    pattern_mode: meshPatternMode,
    refinement_factor: meshResolutionFactor,
    ...extra
  };

  const res = await fetch(`${API}/mesh/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const cfg = await res.json();

  if (typeof cfg.seed === 'number') meshSeed = cfg.seed;
  if (typeof cfg.intensity === 'number') meshTrafficIntensity = cfg.intensity;
  if (typeof cfg.pattern_mode === 'string') meshPatternMode = cfg.pattern_mode;
  if (typeof cfg.refinement_factor === 'number') meshResolutionFactor = cfg.refinement_factor;

  syncSyntheticControlFields();
}

function resetHexMeshViewportKey() {
  meshViewportKey = '';
}

function getHexMeshViewportKey(boundsObj, zoom) {
  return [
    zoom.toFixed(2),
    boundsObj.getSouth().toFixed(4),
    boundsObj.getWest().toFixed(4),
    boundsObj.getNorth().toFixed(4),
    boundsObj.getEast().toFixed(4),
    meshResolutionFactor.toFixed(3),
    meshTrafficIntensity.toFixed(3),
    meshPatternMode,
    globeMode ? 'g1' : 'g0'
  ].join('|');
}

function queueHexMeshRefresh(reason = 'interaction', { immediate = false, force = false } = {}) {
  if (!map || !hexLayer) return;

  if (meshRefreshTimer) {
    clearTimeout(meshRefreshTimer);
  }

  const delayMs = immediate ? 0 : HEX_INTERACTION_DEBOUNCE_MS;
  meshRefreshTimer = setTimeout(() => {
    meshRefreshTimer = null;
    refreshHexMesh({ force, reason }).catch(() => {
      // Keep UI responsive even if a refresh cycle fails.
    });
  }, delayMs);
}

function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function getHexRenderChunkSize() {
  return GPU_ACCEL_AVAILABLE ? HEX_RENDER_CHUNK_GPU : HEX_RENDER_CHUNK_CPU;
}

function isGlobeErrorPayload(payload) {
  const msg = String(payload || '').toLowerCase();
  return msg.includes('cesium') ||
    msg.includes('webgl') ||
    msg.includes('context') ||
    msg.includes('globe') ||
    msg.includes('terrain') ||
    msg.includes('imagery');
}

function switchTo2DFallback(reason) {
  const canvasArea = document.querySelector('.canvas-area');
  const mapDiv = document.getElementById('map');
  const globeDiv = document.getElementById('globe3d');
  const globeBtn = document.getElementById('globe-btn');

  globeMode = false;
  if (globeDiv) globeDiv.style.display = 'none';
  if (mapDiv) mapDiv.style.display = 'block';
  if (canvasArea) canvasArea.classList.remove('globe-mode');
  if (globeBtn) globeBtn.textContent = '3D';
  setStationaryGlobeControlState(false);

  if (map) {
    map.invalidateSize();
    resetView();
  }
  resetHexMeshViewportKey();
  queueHexMeshRefresh('3d-fallback', { immediate: true, force: true });
  showToast(`3D unavailable (${reason}). Switched to 2D.`, 'warn');
}

function handleGlobeFailure(reason, error) {
  if (error) {
    console.error(`[3D Globe] ${reason}`, error);
  }

  if (globeFallbackLock) return;
  globeFallbackLock = true;
  switchTo2DFallback(reason);

  setTimeout(() => {
    globeFallbackLock = false;
  }, 400);
}

function bindGlobeRuntimeGuards() {
  if (globeGuardsBound) return;
  globeGuardsBound = true;

  window.addEventListener('error', event => {
    if (!globeMode) return;
    const msg = `${event?.message || ''} ${event?.filename || ''}`;
    if (isGlobeErrorPayload(msg)) {
      handleGlobeFailure('runtime error', event?.error || event);
    }
  });

  window.addEventListener('unhandledrejection', event => {
    if (!globeMode) return;
    const msg = String(event?.reason?.message || event?.reason || '');
    if (isGlobeErrorPayload(msg)) {
      handleGlobeFailure('runtime rejection', event?.reason);
    }
  });
}

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    preferCanvas: true,
    worldCopyJump: true
  }).setView([20, 0], 2);
  const onlineTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 20
  }).addTo(map);

  const offlineGrid = L.gridLayer({ attribution: 'Offline grid layer' });

  offlineGrid.createTile = function(coords) {
    const tile = document.createElement('canvas');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;

    const ctx = tile.getContext('2d');
    ctx.fillStyle = '#0f1218';
    ctx.fillRect(0, 0, size.x, size.y);
    ctx.strokeStyle = 'rgba(124, 244, 160, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, size.x, size.y);
    ctx.fillStyle = 'rgba(107, 122, 144, 0.65)';
    ctx.font = '12px monospace';
    ctx.fillText(`z${coords.z} x${coords.x} y${coords.y}`, 10, 20);
    return tile;
  };

  onlineTiles.on('tileerror', () => {
    if (!map.hasLayer(offlineGrid)) {
      offlineGrid.addTo(map);
      showToast('Offline tile mode enabled', 'warn');
    }
  });

  hexCanvasRenderer = L.canvas({ padding: 0.12 });
  hexLayer = L.layerGroup().addTo(map);
  queueHexMeshRefresh('initial-load', { immediate: true, force: true });

  map.on('movestart zoomstart', () => {
    meshRenderVersion += 1;
  });

  map.on('zoomend moveend resize', () => {
    queueHexMeshRefresh('viewport-change');
  });

  setTimeout(() => {
    map.invalidateSize();
    queueHexMeshRefresh('post-layout', { immediate: true });
  }, 0);
}

function initGlobeViewer() {
  if (globeViewer) return true;
  if (typeof Cesium === 'undefined') return false;

  try {
    globeViewer = new Cesium.Viewer('globe3d', {
      imageryProvider: new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri World Imagery'
      }),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      timeline: false,
      animation: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      scene3DOnly: true
    });

    globeViewer.resolutionScale = HIGH_VRAM_HINT ? 0.9 : 0.7;

    globeViewer.scene.globe.enableLighting = true;
    globeViewer.scene.globe.showGroundAtmosphere = true;
    globeViewer.scene.skyAtmosphere.show = true;
    globeViewer.scene.moon.show = true;
    globeViewer.scene.backgroundColor = Cesium.Color.BLACK;
    globeViewer.scene.globe.baseColor = Cesium.Color.BLACK;

    globeViewer.scene.globe.atmosphereHueShift = 0.0;
    globeViewer.scene.globe.atmosphereSaturationShift = 0.08;
    globeViewer.scene.globe.atmosphereBrightnessShift = -0.03;

    globeViewer.clock.multiplier = 1200;
    globeViewer.clock.shouldAnimate = true;

    globeViewer.scene.fxaa = true;
    globeViewer.scene.postProcessStages.fxaa.enabled = true;

    const bloom = globeViewer.scene.postProcessStages.bloom;
    bloom.enabled = HIGH_VRAM_HINT;
    bloom.uniforms.glowOnly = false;
    bloom.uniforms.contrast = 128;
    bloom.uniforms.brightness = -0.2;
    bloom.uniforms.delta = 1.0;
    bloom.uniforms.sigma = 2.2;
    bloom.uniforms.stepSize = 1.0;

    globeTickHandler = function() {
      if (!globeAutoRotate) return;
      globeViewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00035);
    };
    globeViewer.clock.onTick.addEventListener(globeTickHandler);

    const ctrl = globeViewer.scene.screenSpaceCameraController;
    ctrl.enableRotate = false;
    ctrl.enableTranslate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableLook = false;
    ctrl.inertiaSpin = 0;
    ctrl.inertiaTranslate = 0;
    ctrl.inertiaZoom = 0;

    const canvas = globeViewer.scene?.canvas;
    if (canvas) {
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        handleGlobeFailure('webgl context lost', event);
      }, { passive: false });
    }

    globeRouteDataSource = new Cesium.CustomDataSource('route-overlay');
    globeMeshDataSource = new Cesium.CustomDataSource('hex-mesh-overlay');
    globeViewer.dataSources.add(globeMeshDataSource);
    globeViewer.dataSources.add(globeRouteDataSource);

    setGlobeIndiaStationaryView();

    globeViewer.camera.percentageChanged = 0.05;
    globeViewer.camera.changed.addEventListener(() => {
      scheduleGlobeMeshRefresh();
    });

    window.addEventListener('resize', () => {
      if (!globeViewer) return;
      globeViewer.resize();
      globeViewer.scene.requestRender();
    });

    return true;
  } catch (error) {
    handleGlobeFailure('viewer initialization failed', error);
    globeViewer = null;
    globeRouteDataSource = null;
    globeMeshDataSource = null;
    return false;
  }
}

function setGlobeIndiaStationaryView() {
  if (!globeViewer || typeof Cesium === 'undefined') return;
  globeViewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(INDIA_FOCUS.lon, INDIA_FOCUS.lat, INDIA_FOCUS.height),
    orientation: {
      heading: Cesium.Math.toRadians(INDIA_FOCUS.heading),
      pitch: Cesium.Math.toRadians(INDIA_FOCUS.pitch),
      roll: Cesium.Math.toRadians(INDIA_FOCUS.roll)
    }
  });
}

function setStationaryGlobeControlState(isLocked3D) {
  const canvasArea = document.querySelector('.canvas-area');
  const rotateBtn = document.getElementById('rotate-btn');
  const flyBtn = document.getElementById('fly-btn');

  if (canvasArea) {
    canvasArea.classList.toggle('locked-globe-controls', Boolean(isLocked3D));
  }

  for (const btn of [rotateBtn, flyBtn]) {
    if (!btn) continue;
    btn.classList.toggle('hidden-locked', Boolean(isLocked3D));
    btn.disabled = Boolean(isLocked3D);
    btn.setAttribute('aria-hidden', isLocked3D ? 'true' : 'false');
    btn.setAttribute('tabindex', isLocked3D ? '-1' : '0');
  }
}

function enable3DFirstView() {
  if (globeMode) return true;

  try {
    toggleGlobeMode();
    if (globeMode) {
      showToast('3D globe mode enabled', 'success');
      return true;
    }
  } catch (error) {
    handleGlobeFailure('startup initialization failed', error);
  }

  return false;
}

function renderGlobeRoute() {
  if (!globeViewer || !globeRouteDataSource) return;

  try {
    const routeEntities = globeRouteDataSource.entities;
    routeEntities.removeAll();

    if (!latestRouteCoords.length) {
      setGlobeIndiaStationaryView();
      return;
    }

    let sampledCoords = latestRouteCoords;
    if (sampledCoords.length > GLOBE_ROUTE_MAX_POINTS) {
      const stride = Math.ceil(sampledCoords.length / GLOBE_ROUTE_MAX_POINTS);
      const reduced = [];
      for (let i = 0; i < sampledCoords.length; i += stride) {
        reduced.push(sampledCoords[i]);
      }
      const last = sampledCoords[sampledCoords.length - 1];
      const tail = reduced[reduced.length - 1];
      if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) {
        reduced.push(last);
      }
      sampledCoords = reduced;
    }

    const polylinePositions = sampledCoords.map(c => Cesium.Cartesian3.fromDegrees(c[1], c[0], 12000));

    const arcDegrees = [];
    const arcPeak = 90000;
    const arcBase = 14000;
    const maxIndex = Math.max(1, sampledCoords.length - 1);
    for (let i = 0; i < sampledCoords.length; i++) {
      const ratio = i / maxIndex;
      const arcHeight = arcBase + Math.sin(ratio * Math.PI) * arcPeak;
      arcDegrees.push(sampledCoords[i][1], sampledCoords[i][0], arcHeight);
    }

    routeEntities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(arcDegrees),
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.14,
          taperPower: 0.5,
          color: Cesium.Color.fromCssColorString('#52c7ff')
        })
      }
    });

    routeEntities.add({
      polyline: {
        positions: polylinePositions,
        width: 1.5,
        material: Cesium.Color.WHITE.withAlpha(0.55)
      }
    });

    const start = sampledCoords[0];
    const end = sampledCoords[sampledCoords.length - 1];

    routeEntities.add({
      position: Cesium.Cartesian3.fromDegrees(start[1], start[0], 30000),
      point: { pixelSize: 10, color: Cesium.Color.LIME },
      label: {
        text: 'START',
        font: '12px monospace',
        fillColor: Cesium.Color.LIME,
        pixelOffset: new Cesium.Cartesian2(0, -18)
      }
    });

    routeEntities.add({
      position: Cesium.Cartesian3.fromDegrees(end[1], end[0], 30000),
      point: { pixelSize: 10, color: Cesium.Color.ORANGE },
      label: {
        text: 'DEST',
        font: '12px monospace',
        fillColor: Cesium.Color.ORANGE,
        pixelOffset: new Cesium.Cartesian2(0, -18)
      }
    });

    setGlobeIndiaStationaryView();
  } catch (error) {
    handleGlobeFailure('route overlay render failed', error);
  }
}

function getGlobeMeshLodParams(cameraHeightMeters) {
  if (cameraHeightMeters > 20000000) {
    return { stride: 10, maxCells: 700, detail: 'far' };
  }
  if (cameraHeightMeters > 9000000) {
    return { stride: 7, maxCells: 1300, detail: 'mid-far' };
  }
  if (cameraHeightMeters > 3500000) {
    return { stride: 5, maxCells: 2000, detail: 'mid' };
  }
  if (cameraHeightMeters > 1400000) {
    return { stride: 3, maxCells: 2800, detail: 'near' };
  }
  return { stride: 2, maxCells: 3600, detail: 'close' };
}

function scheduleGlobeMeshRefresh(force = false) {
  if (!globeMode || !globeViewer || !globeMeshDataSource) return;

  if (force) {
    if (globeMeshRefreshTimer) {
      clearTimeout(globeMeshRefreshTimer);
      globeMeshRefreshTimer = null;
    }
    try {
      renderGlobeHexMesh(true);
    } catch (error) {
      handleGlobeFailure('mesh refresh failed', error);
    }
    return;
  }

  if (globeMeshRefreshTimer) return;
  globeMeshRefreshTimer = setTimeout(() => {
    globeMeshRefreshTimer = null;
    try {
      renderGlobeHexMesh(false);
    } catch (error) {
      handleGlobeFailure('mesh refresh failed', error);
    }
  }, GLOBE_MESH_REFRESH_DEBOUNCE_MS);
}

function renderGlobeHexMesh(force = false) {
  if (!globeViewer || !globeMeshDataSource) return;

  try {
    const meshEntities = globeMeshDataSource.entities;
    if (!hexCells.length) {
      meshEntities.removeAll();
      globeMeshLodKey = '';
      return;
    }

    const cameraHeight = globeViewer.camera.positionCartographic?.height || 5000000;
    const lod = getGlobeMeshLodParams(cameraHeight);
    const key = `${lod.stride}:${lod.maxCells}:${lod.detail}:${hexCells.length}:${activeHexRoute.length}`;
    if (!force && key === globeMeshLodKey) return;
    globeMeshLodKey = key;

    meshEntities.removeAll();

    const onPath = new Set(activeHexRoute);
    let rendered = 0;

    for (const cell of hexCells) {
      const isRouteCell = onPath.has(cell.id);
      if (!isRouteCell) {
        const rank = Math.abs(cell.row) + Math.abs(cell.col);
        if ((rank % lod.stride) !== 0) continue;
      }
      if (!isRouteCell && rendered >= lod.maxCells) continue;

      const density = typeof cell.simulatedDensity === 'number' ? cell.simulatedDensity : cell.density;
      const geoHeightMeters = typeof cell.geoHeightMeters === 'number'
        ? cell.geoHeightMeters
        : (HEX_GEO_HEIGHT_MIN_METERS + (density * (HEX_GEO_HEIGHT_MAX_METERS - HEX_GEO_HEIGHT_MIN_METERS)));
      const fillRed = Math.round(120 + density * 120);
      const fillGreen = Math.round(210 - density * 90);
      const fillBlue = Math.round(240 - density * 160);
      const fillAlpha = Math.round((isRouteCell ? 0.36 : (0.07 + density * 0.22)) * 255);
      const lineAlpha = Math.round((isRouteCell ? 0.9 : (0.16 + density * 0.30)) * 255);

      const vertices = buildHexVertices(cell.lat, cell.lon, currentHexEdgeMeters / 111320, currentHexEdgeMeters / (111320 * Math.max(0.2, Math.cos(cell.lat * Math.PI / 180))));
      const lonLat = [];
      for (const vertex of vertices) {
        lonLat.push(vertex[1], vertex[0]);
      }

      meshEntities.add({
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(lonLat),
          height: isRouteCell ? HEX_GEO_HEIGHT_MAX_METERS : geoHeightMeters,
          material: Cesium.Color.fromBytes(fillRed, fillGreen, fillBlue, fillAlpha),
          outline: true,
          outlineColor: isRouteCell
            ? Cesium.Color.fromBytes(0, 0, 0, lineAlpha)
            : Cesium.Color.fromBytes(255, 255, 255, lineAlpha)
        }
      });

      rendered += 1;
    }
  } catch (error) {
    handleGlobeFailure('mesh render failed', error);
  }
}

function toggleGlobeMode() {
  const canvasArea = document.querySelector('.canvas-area');
  const mapDiv = document.getElementById('map');
  const globeDiv = document.getElementById('globe3d');
  const globeBtn = document.getElementById('globe-btn');

  globeMode = !globeMode;

  if (globeMode) {
    if (typeof Cesium === 'undefined') {
      handleGlobeFailure('library not loaded');
      return;
    }

    globeDiv.style.display = 'block';
    mapDiv.style.display = 'none';
    if (canvasArea) canvasArea.classList.add('globe-mode');

    const viewerReady = initGlobeViewer();
    if (!viewerReady || !globeViewer) {
      handleGlobeFailure('viewer initialization failed');
      return;
    }
    if (globeBtn) globeBtn.textContent = '2D';
    globeAutoRotate = false;
    const rotateBtn = document.getElementById('rotate-btn');
    if (rotateBtn) rotateBtn.classList.remove('active');
    setStationaryGlobeControlState(true);

    // Globe container was hidden in 2D mode; force Cesium to recalc viewport.
    setTimeout(() => {
      try {
        if (!globeViewer) throw new Error('viewer missing after initialization');
        globeViewer.resize();
        setGlobeIndiaStationaryView();
        renderGlobeRoute();
        scheduleGlobeMeshRefresh(true);
        globeViewer.scene.requestRender();
      } catch (error) {
        handleGlobeFailure('post-initialization render failed', error);
      }
    }, 0);
  } else {
    globeDiv.style.display = 'none';
    mapDiv.style.display = 'block';
    if (canvasArea) canvasArea.classList.remove('globe-mode');
    if (globeBtn) globeBtn.textContent = '3D';
    setStationaryGlobeControlState(false);
    map.invalidateSize();
    resetView();
    resetHexMeshViewportKey();
    queueHexMeshRefresh('return-2d', { immediate: true, force: true });
  }
}

function toggleGlobeRotate() {
  globeAutoRotate = false;
  const btn = document.getElementById('rotate-btn');
  if (btn) btn.classList.remove('active');
  if (globeMode) showToast('Globe is locked in stationary India view.', 'info');
}

function toggleGlobeLighting() {
  if (!globeViewer) {
    const ready = initGlobeViewer();
    if (!ready || !globeViewer) {
      handleGlobeFailure('lighting controller unavailable');
      return;
    }
  }
  globeNightMode = !globeNightMode;
  globeViewer.scene.globe.enableLighting = globeNightMode;
  const btn = document.getElementById('light-btn');
  if (btn) {
    btn.classList.toggle('active', globeNightMode);
    btn.textContent = globeNightMode ? 'NITE' : 'DAY';
  }
}

function startRouteFlythrough() {
  if (globeMode) {
    showToast('Flythrough is disabled while globe is stationary.', 'info');
    return;
  }

  if (!globeViewer || !latestRouteCoords.length) {
    showToast('No route available for flythrough.', 'warn');
    return;
  }

  const step = Math.max(1, Math.floor(latestRouteCoords.length / 8));
  const samples = [];
  for (let i = 0; i < latestRouteCoords.length; i += step) {
    samples.push(latestRouteCoords[i]);
  }
  if (samples[samples.length - 1] !== latestRouteCoords[latestRouteCoords.length - 1]) {
    samples.push(latestRouteCoords[latestRouteCoords.length - 1]);
  }

  let idx = 0;
  const flyNext = () => {
    if (idx >= samples.length) return;
    const p = samples[idx];
    globeViewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(p[1], p[0], 1600000),
      orientation: {
        heading: globeViewer.camera.heading,
        pitch: Cesium.Math.toRadians(-45),
        roll: 0
      },
      duration: 0.9,
      complete: () => {
        idx += 1;
        flyNext();
      }
    });
  };

  flyNext();
}

function fract(v) {
  return v - Math.floor(v);
}

function getHexSizeDegForZoom(zoom) {
  const centerLat = map ? map.getCenter().lat : 0;

  // Keep world-zoom meshes coarse and gradually refine as user zooms in.
  // This prevents generating millions of cells at low zoom levels.
  let baseMeters;
  if (zoom <= 2) baseMeters = 300000;
  else if (zoom <= 3) baseMeters = 180000;
  else if (zoom <= 4) baseMeters = 120000;
  else if (zoom <= 5) baseMeters = 80000;
  else if (zoom <= 6) baseMeters = 50000;
  else if (zoom <= 7) baseMeters = 30000;
  else if (zoom <= 8) baseMeters = 20000;
  else if (zoom <= 9) baseMeters = 12000;
  else if (zoom <= 10) baseMeters = 7000;
  else if (zoom <= 11) baseMeters = 4000;
  else if (zoom <= 12) baseMeters = 2400;
  else if (zoom <= 13) baseMeters = 1400;
  else if (zoom <= 14) baseMeters = 800;
  else if (zoom <= 15) baseMeters = 450;
  else if (zoom <= 16) baseMeters = 250;
  else if (zoom <= 17) baseMeters = 140;
  else baseMeters = 90;

  // Higher refinement factor creates smaller cells, but never below safety floor.
  const refinedMeters = Math.max(HEX_EDGE_MIN_METERS, baseMeters / Math.max(0.6, meshResolutionFactor));
  currentHexEdgeMeters = refinedMeters;

  const metersPerDegreeLat = 111320;
  const latAdjust = Math.max(0.2, Math.cos(centerLat * Math.PI / 180));
  const metersPerDegreeLon = metersPerDegreeLat * latAdjust;

  const radiusLat = refinedMeters / metersPerDegreeLat;
  const radiusLon = refinedMeters / metersPerDegreeLon;
  return { radiusLat, radiusLon, edgeMeters: refinedMeters };
}

function computeHexDensityLocal(row, col) {
  const noise1 = fract(Math.sin(row * 12.9898 + col * 78.233 + meshSeed * 0.001) * 43758.5453);
  const noise2 = fract(Math.sin((row + 17) * 24.132 + (col - 9) * 53.771 + meshSeed * 0.0007) * 12731.743);
  const blended = (noise1 * 0.65) + (noise2 * 0.35);
  const density = Math.min(1, Math.max(0, blended * (0.45 + meshTrafficIntensity * 1.35)));
  return density;
}

function simulateHexCellMetrics(row, col, densityOverride) {
  const density = typeof densityOverride === 'number'
    ? Math.max(0, Math.min(1, densityOverride))
    : computeHexDensityLocal(row, col);
  const geoHeightMeters = HEX_GEO_HEIGHT_MIN_METERS + (density * (HEX_GEO_HEIGHT_MAX_METERS - HEX_GEO_HEIGHT_MIN_METERS));
  return { density, geoHeightMeters };
}

async function fetchMeshDensitiesBatch(cells, zoomLevel, edgeMeters) {
  try {
    const res = await fetch(`${API}/mesh/density`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cells,
        zoom_level: zoomLevel,
        edge_meters: edgeMeters
      })
    });
    const payload = await res.json();
    if (typeof payload.intensity === 'number') meshTrafficIntensity = payload.intensity;
    if (typeof payload.seed === 'number') meshSeed = payload.seed;
    if (typeof payload.pattern_mode === 'string') meshPatternMode = payload.pattern_mode;
    if (typeof payload.refinement_factor === 'number') meshResolutionFactor = payload.refinement_factor;
    syncSyntheticControlFields();

    const mapByKey = new Map();
    for (const d of payload.densities || []) {
      mapByKey.set(`${d.row}:${d.col}`, d.density);
    }
    return mapByKey;
  } catch (_) {
    return null;
  }
}

async function fetchMeshDensities(cells, zoomLevel, edgeMeters) {
  if (!Array.isArray(cells) || !cells.length) return new Map();

  if (cells.length <= HEX_DENSITY_FETCH_BATCH) {
    return fetchMeshDensitiesBatch(cells, zoomLevel, edgeMeters);
  }

  const merged = new Map();
  for (let i = 0; i < cells.length; i += HEX_DENSITY_FETCH_BATCH) {
    const chunk = cells.slice(i, i + HEX_DENSITY_FETCH_BATCH);
    const part = await fetchMeshDensitiesBatch(chunk, zoomLevel, edgeMeters);
    if (!part) continue;
    for (const [key, value] of part.entries()) merged.set(key, value);
  }

  return merged.size ? merged : null;
}

function buildHexVertices(centerLat, centerLon, radiusLat, radiusLon) {
  const vertices = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i) - 30) * Math.PI / 180;
    vertices.push([
      centerLat + radiusLat * Math.sin(angle),
      centerLon + radiusLon * Math.cos(angle)
    ]);
  }
  return vertices;
}

function getNeighborDeltas(isOddRow) {
  if (isOddRow) {
    return [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];
  }
  return [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
}

async function refreshHexMesh(options = {}) {
  if (!map || !hexLayer) return;

  const force = Boolean(options.force);
  const zoom = map.getZoom();
  const b = map.getBounds();
  const viewportKey = getHexMeshViewportKey(b, zoom);

  if (!force && viewportKey === meshViewportKey) return;
  meshViewportKey = viewportKey;

  const renderToken = ++meshRenderVersion;
  hexLayer.clearLayers();
  hexCells = [];
  hexCellById = new Map();
  if (globeMeshDataSource) {
    globeMeshDataSource.entities.removeAll();
    globeMeshLodKey = '';
  }

  const size = getHexSizeDegForZoom(zoom);
  const radiusLat = size.radiusLat;
  const radiusLon = size.radiusLon;

  const stepX = Math.sqrt(3) * radiusLon;
  const stepY = 1.5 * radiusLat;
  const latPadding = radiusLat * 1.25;
  const lonPadding = radiusLon * 1.25;

  // Build only for visible viewport plus a thin ring to avoid edge pop-in.
  const rowStart = Math.floor((b.getSouth() - latPadding) / stepY);
  const rowEnd = Math.ceil((b.getNorth() + latPadding) / stepY);

  const rowCount = Math.max(1, rowEnd - rowStart + 1);
  const approxColCount = Math.max(1, Math.ceil(((b.getEast() - b.getWest()) + (2 * lonPadding)) / stepX));
  const estimatedCells = rowCount * approxColCount;
  const budget = globeMode ? HEX_CELL_BUDGET_3D : HEX_CELL_BUDGET_2D;
  const stride = Math.max(1, Math.ceil(Math.sqrt(estimatedCells / budget)));

  const skeletonCells = [];

  for (let row = rowStart; row <= rowEnd; row += stride) {
    const centerY = row * stepY;
    const offsetX = (row & 1) ? (stepX / 2) : 0;
    const colStart = Math.floor((b.getWest() - lonPadding - offsetX) / stepX);
    const colEnd = Math.ceil((b.getEast() + lonPadding - offsetX) / stepX);

    for (let col = colStart; col <= colEnd; col += stride) {
      const centerX = col * stepX + offsetX;
      const id = `${row}:${col}`;
      skeletonCells.push({
        id,
        row,
        col,
        lat: centerY,
        lon: centerX
      });
    }
  }

  if (!skeletonCells.length) {
    scheduleGlobeMeshRefresh(true);
    return;
  }

  const densityMap = await fetchMeshDensities(
    skeletonCells.map(c => ({ row: c.row, col: c.col })),
    zoom,
    size.edgeMeters
  );
  if (renderToken !== meshRenderVersion) return;

  const clickEnabled = skeletonCells.length <= 2600;
  const chunkSize = getHexRenderChunkSize();

  for (let i = 0; i < skeletonCells.length; i += chunkSize) {
    if (renderToken !== meshRenderVersion) return;

    const end = Math.min(i + chunkSize, skeletonCells.length);
    for (let j = i; j < end; j++) {
      const c = skeletonCells[j];
      const simulated = simulateHexCellMetrics(c.row, c.col, densityMap ? densityMap.get(c.id) : undefined);
      const density = simulated.density;
      const lineOpacity = 0.08 + (density * 0.24);
      const fillOpacity = 0.025 + (density * 0.10);
      const fillRed = Math.round(120 + density * 120);
      const fillGreen = Math.round(210 - density * 90);
      const fillBlue = Math.round(240 - density * 160);

      const polygonOpts = {
        color: `rgba(255,255,255,${lineOpacity.toFixed(3)})`,
        weight: 1,
        fillColor: `rgb(${fillRed},${fillGreen},${fillBlue})`,
        fillOpacity: fillOpacity
      };
      if (hexCanvasRenderer) polygonOpts.renderer = hexCanvasRenderer;

      const polygon = L.polygon(buildHexVertices(c.lat, c.lon, radiusLat, radiusLon), polygonOpts).addTo(hexLayer);

      if (clickEnabled) {
        polygon.on('click', () => {
          const trafficPercent = Math.round(density * 100);
          showToast(`Hex density: ${trafficPercent}% | height: ${Math.round(simulated.geoHeightMeters)}m`, 'info');
        });
      }

      const cell = {
        id: c.id,
        row: c.row,
        col: c.col,
        lat: c.lat,
        lon: c.lon,
        density,
        simulatedDensity: density,
        geoHeightMeters: simulated.geoHeightMeters,
        neighbors: [],
        layer: polygon
      };

      hexCells.push(cell);
      hexCellById.set(c.id, cell);
    }

    if (end < skeletonCells.length) {
      await nextFrame();
    }
  }

  for (const cell of hexCells) {
    const deltas = getNeighborDeltas(Boolean(cell.row & 1));
    for (const [dr, dc] of deltas) {
      const nId = `${cell.row + dr}:${cell.col + dc}`;
      if (hexCellById.has(nId)) cell.neighbors.push(nId);
    }
  }

  highlightHexRoute(activeHexRoute);
  scheduleGlobeMeshRefresh(true);
}

function setHexResolution(rawValue) {
  const pct = Number(rawValue);
  meshResolutionFactor = Math.max(0.6, Math.min(1.8, pct / 100));
  const val = document.getElementById('mesh-refine-val');
  if (val) {
    const preview = getHexSizeDegForZoom(map ? map.getZoom() : 2).edgeMeters;
    val.textContent = `${preview.toFixed(0)}m`;
  }
  resetHexMeshViewportKey();
  queueHexMeshRefresh('refinement-slider', { force: true });
}

function setHexRefinement(rawValue) {
  setHexResolution(rawValue);
}

async function applySyntheticDesignControls() {
  try {
    const seedInput = document.getElementById('mesh-seed-input');
    const refineSlider = document.getElementById('mesh-refine-slider');
    const patternSelect = document.getElementById('mesh-pattern-mode');

    if (seedInput && seedInput.value.trim()) {
      meshSeed = Math.max(1, Number(seedInput.value));
    }
    if (refineSlider) {
      meshResolutionFactor = Math.max(0.6, Math.min(1.8, Number(refineSlider.value) / 100));
    }
    if (patternSelect) {
      meshPatternMode = patternSelect.value;
    }

    await persistMeshConfig();
    resetHexMeshViewportKey();
    await refreshHexMesh({ force: true, reason: 'design-controls' });
    showToast('Synthetic design controls applied', 'success');
  } catch (e) {
    showToast(`Failed to apply design controls: ${e.message}`, 'error');
  }
}

async function regenerateSyntheticSeed() {
  meshSeed = Math.floor(Math.random() * 999999) + 1;
  syncSyntheticControlFields();
  await applySyntheticDesignControls();
}

function findNearestHexCell(lat, lon) {
  if (!hexCells.length) return null;
  let best = null;
  let minDist = Infinity;
  for (const c of hexCells) {
    const d = haversineDist(lat, lon, c.lat, c.lon);
    if (d < minDist) {
      minDist = d;
      best = c;
    }
  }
  return best;
}

function reconstructHexPath(prev, srcId, dstId) {
  const path = [];
  let cur = dstId;
  while (cur) {
    path.unshift(cur);
    if (cur === srcId) break;
    cur = prev[cur] || null;
  }
  if (!path.length || path[0] !== srcId) return [];
  return path;
}

function getHexHopCost(fromCell, toCell, cellPenalty = {}) {
  const hopKm = haversineDist(fromCell.lat, fromCell.lon, toCell.lat, toCell.lon);
  const penalty = cellPenalty[toCell.id] || 0;
  const density = typeof toCell.simulatedDensity === 'number' ? toCell.simulatedDensity : toCell.density;
  const trafficCost = 1 + (density * 2.6) + (penalty * 0.9);
  return {
    hopKm,
    weighted: hopKm * trafficCost
  };
}

function summarizeHexPath(pathIds) {
  let weightedDistance = 0;
  let rawDistance = 0;
  let avgDensity = 0;

  if (pathIds.length > 1) {
    for (let i = 0; i < pathIds.length - 1; i++) {
      const a = hexCellById.get(pathIds[i]);
      const b = hexCellById.get(pathIds[i + 1]);
      if (!a || !b) continue;
      const hop = getHexHopCost(a, b);
      rawDistance += hop.hopKm;
      weightedDistance += hop.weighted;
      avgDensity += typeof b.simulatedDensity === 'number' ? b.simulatedDensity : b.density;
    }
    avgDensity = avgDensity / (pathIds.length - 1);
  }

  return { weightedDistance, rawDistance, avgDensity };
}

function runHexPathSearch(srcCell, dstCell, algorithm, cellPenalty = {}) {
  const start = performance.now();
  const algo = (algorithm || 'dijkstra').toLowerCase();

  const prev = {};
  const visited = new Set();
  const visitedOrder = [];
  const heuristic = (a, b) => haversineDist(a.lat, a.lon, b.lat, b.lon);

  if (algo === 'bfs' || algo === 'dfs') {
    const seen = new Set([srcCell.id]);
    const frontier = [srcCell.id];

    while (frontier.length) {
      const currentId = algo === 'bfs' ? frontier.shift() : frontier.pop();
      if (!currentId || visited.has(currentId)) continue;

      visited.add(currentId);
      visitedOrder.push(currentId);

      if (currentId === dstCell.id) break;

      const current = hexCellById.get(currentId);
      if (!current) continue;

      const neighbors = current.neighbors
        .filter(id => !seen.has(id))
        .sort((a, b) => {
          const ca = hexCellById.get(a);
          const cb = hexCellById.get(b);
          if (!ca || !cb) return 0;
          return (ca.density + (cellPenalty[a] || 0)) - (cb.density + (cellPenalty[b] || 0));
        });

      const ordered = algo === 'dfs' ? [...neighbors].reverse() : neighbors;
      for (const nId of ordered) {
        seen.add(nId);
        if (prev[nId] === undefined) prev[nId] = currentId;
        frontier.push(nId);
      }
    }

    const pathIds = reconstructHexPath(prev, srcCell.id, dstCell.id);
    const computationMs = performance.now() - start;
    const summary = summarizeHexPath(pathIds);

    return {
      found: pathIds.length > 0,
      pathIds,
      weightedDistance: summary.weightedDistance,
      rawDistance: summary.rawDistance,
      avgDensity: summary.avgDensity,
      computationMs,
      visitedCount: visitedOrder.length,
      visitedOrder,
      algorithm: algo
    };
  }

  const dist = {};
  for (const c of hexCells) dist[c.id] = Infinity;
  dist[srcCell.id] = 0;

  const open = [{ id: srcCell.id, g: 0, f: 0 }];

  while (open.length) {
    open.sort((x, y) => x.f - y.f);
    const current = open.shift();
    if (!current || visited.has(current.id)) continue;

    visited.add(current.id);
    visitedOrder.push(current.id);

    if (current.id === dstCell.id) break;

    const cell = hexCellById.get(current.id);
    if (!cell) continue;

    for (const nId of cell.neighbors) {
      if (visited.has(nId)) continue;
      const neighbor = hexCellById.get(nId);
      if (!neighbor) continue;

      const hop = getHexHopCost(cell, neighbor, cellPenalty);
      const nextG = dist[current.id] + hop.weighted;

      if (nextG < dist[nId]) {
        dist[nId] = nextG;
        prev[nId] = current.id;

        const h = algo === 'astar' ? heuristic(neighbor, dstCell) : 0;
        open.push({ id: nId, g: nextG, f: nextG + h });
      }
    }
  }

  const pathIds = reconstructHexPath(prev, srcCell.id, dstCell.id);
  const computationMs = performance.now() - start;
  const summary = summarizeHexPath(pathIds);

  return {
    found: pathIds.length > 0,
    pathIds,
    weightedDistance: summary.weightedDistance,
    rawDistance: summary.rawDistance,
    avgDensity: summary.avgDensity,
    computationMs,
    visitedCount: visitedOrder.length,
    visitedOrder,
    algorithm: algo
  };
}

function highlightHexRoute(pathIds) {
  activeHexRoute = Array.isArray(pathIds) ? pathIds : [];
  if (!hexCells.length) return;

  const onPath = new Set(activeHexRoute);
  for (const cell of hexCells) {
    if (!cell.layer) continue;
    if (onPath.has(cell.id)) {
      cell.layer.setStyle({
        color: 'rgba(0,0,0,0.85)',
        weight: 2,
        fillOpacity: 0.25
      });
    } else {
      const density = cell.density;
      cell.layer.setStyle({
        color: `rgba(255,255,255,${(0.08 + (density * 0.24)).toFixed(3)})`,
        weight: 1,
        fillOpacity: 0.025 + (density * 0.10)
      });
    }
  }

  scheduleGlobeMeshRefresh(true);
}

function hashTextToUnit(text) {
  let hash = 2166136261;
  const str = String(text || '');
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function syntheticGeocodeFallback(query) {
  const lat = -45 + (hashTextToUnit(`${query}|lat`) * 90);
  const lon = -170 + (hashTextToUnit(`${query}|lon`) * 340);
  return {
    lat,
    lon,
    name: query,
    label: `${query} (synthetic)`,
    display_name: `${query} (synthetic fallback)`
  };
}

async function geocodeLocation(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Please provide a valid location');

  try {
    const url = `${NOMINATIM_API}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      return syntheticGeocodeFallback(q);
    }

    const matches = await res.json();
    if (!Array.isArray(matches) || !matches.length) {
      return syntheticGeocodeFallback(q);
    }

    const best = matches[0];
    return {
      lat: Number(best.lat),
      lon: Number(best.lon),
      name: best.name || q,
      label: best.display_name ? best.display_name.split(',')[0] : q,
      display_name: best.display_name || q,
      raw: best
    };
  } catch (_) {
    return syntheticGeocodeFallback(q);
  }
}

function drawHexRoute(srcGeo, dstGeo, routeResult) {
  for (let e of edgeLines) map.removeLayer(e);
  for (let id in nodeMarkers) map.removeLayer(nodeMarkers[id]);
  edgeLines = [];
  nodeMarkers = {};
  bounds = L.latLngBounds();

  const coords = [[srcGeo.lat, srcGeo.lon]];
  for (const id of routeResult.pathIds) {
    const cell = hexCellById.get(id);
    if (cell) coords.push([cell.lat, cell.lon]);
  }
  coords.push([dstGeo.lat, dstGeo.lon]);
  latestRouteCoords = coords;

  coords.forEach(c => bounds.extend(c));

  edgeLines.push(L.polyline(coords, { color: '#ffffff', weight: 10, opacity: 0.55 }).addTo(map));
  edgeLines.push(L.polyline(coords, { color: '#000000', weight: 5, opacity: 0.95 }).addTo(map));

  const sM = L.circleMarker([srcGeo.lat, srcGeo.lon], {
    radius: 7, fillColor: 'rgba(124,244,160,0.8)', color: '#7cf4a0', weight: 2, fillOpacity: 1
  }).addTo(map);
  sM.bindTooltip(`<b>Source</b><br>${srcGeo.label}`, { direction: 'top' }).openTooltip();
  nodeMarkers['src'] = sM;

  const dM = L.circleMarker([dstGeo.lat, dstGeo.lon], {
    radius: 7, fillColor: 'rgba(255,107,53,0.8)', color: '#ff6b35', weight: 2, fillOpacity: 1
  }).addTo(map);
  dM.bindTooltip(`<b>Dest</b><br>${dstGeo.label}`, { direction: 'top' }).openTooltip();
  nodeMarkers['dst'] = dM;

  if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
  if (globeMode) renderGlobeRoute();
}

function renderHexRouteResult(srcGeo, dstGeo, routeResult, algo) {
  const resultEl = document.getElementById('route-result');
  if (!routeResult.found) {
    resultEl.innerHTML = `<div class="result-card error"><div class="badge badge-danger">NO PATH FOUND</div><p style="margin-top:10px;font-size:13px;color:var(--muted)">No valid hex path was found between these locations.</p></div>`;
    return;
  }

  const labels = {
    dijkstra: 'Dijkstra',
    astar: 'A*',
    bfs: 'BFT',
    dfs: 'DFT'
  };
  const estMin = (routeResult.weightedDistance / 42) * 60;
  resultEl.innerHTML = `<div class="result-card success">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span class="badge badge-success">${labels[algo] || 'Route'} Â· HEX TRAFFIC ROUTING</span>
      <span style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">${routeResult.computationMs.toFixed(3)}ms</span>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-label">Geo Distance</div><div class="stat-value">${routeResult.rawDistance.toFixed(1)}<span class="stat-unit"> km</span></div></div>
      <div class="stat"><div class="stat-label">Traffic-Weighted</div><div class="stat-value">${routeResult.weightedDistance.toFixed(1)}<span class="stat-unit"> cost-km</span></div></div>
      <div class="stat"><div class="stat-label">Hex Hops</div><div class="stat-value">${Math.max(0, routeResult.pathIds.length - 1)}</div></div>
      <div class="stat"><div class="stat-label">Est. Time</div><div class="stat-value">${Math.round(estMin)}<span class="stat-unit"> min</span></div></div>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--muted);line-height:1.6">
      Route computed on dynamic honeycomb mesh from <b>${srcGeo.label}</b> to <b>${dstGeo.label}</b>.
      Hex size shrinks continuously as you zoom in; darker/warmer hexes imply higher traffic penalty.
    </div>
  </div>`;
}


function zoomIn() {
  if (globeMode && globeViewer) {
    showToast('Zoom is disabled in stationary globe mode.', 'info');
    return;
  }
  map.zoomIn();
}

function zoomOut() {
  if (globeMode && globeViewer) {
    showToast('Zoom is disabled in stationary globe mode.', 'info');
    return;
  }
  map.zoomOut();
}

function resetView() {
  if (globeMode && globeViewer) {
    setGlobeIndiaStationaryView();
    return;
  }
  if(bounds && bounds.isValid()) map.fitBounds(bounds, {padding: [50, 50]});
}
let animationPaused = false;
function toggleAnimation() {
  animationPaused = !animationPaused;
  const btn = document.getElementById('anim-btn');
  btn.textContent = animationPaused ? 'â–¶' : 'â¸';
  btn.style.color = animationPaused ? 'var(--accent3)' : 'var(--text)';
  if (!animationPaused) {
    // Resume is handled naturally by the loop checking animationPaused
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ROUTE FINDING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const ALGO_DESCRIPTIONS = {
  dijkstra: 'Weighted shortest path on the hex-density traffic mesh (best for optimal traffic-aware route).',
  astar:    'Heuristic-guided weighted search on the same hex-density mesh (often faster than Dijkstra).',
  bfs:      'Breadth-first traversal over hex cells with density-aware neighbor ordering.',
  dfs:      'Depth-first traversal over hex cells with density-aware neighbor ordering.'
};

function setAlgo(algo) {
  selectedAlgo = algo;
  ['btn-dijk','btn-astar','btn-bfs','btn-dfs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const btnMap = { dijkstra:'btn-dijk', astar:'btn-astar', bfs:'btn-bfs', dfs:'btn-dfs' };
  const btn = document.getElementById(btnMap[algo]);
  if (btn) btn.classList.add('active');
  const desc = document.getElementById('algo-desc');
  if (desc) desc.textContent = ALGO_DESCRIPTIONS[algo] || '';
  const findText = document.getElementById('find-btn-text');
  if (findText) findText.textContent = 'FIND PATH';
}

async function ensureMeshAroundEndpoints(srcGeo, dstGeo, reason = 'route') {
  if (!map) return;

  const routeBounds = L.latLngBounds([
    [Number(srcGeo.lat), Number(srcGeo.lon)],
    [Number(dstGeo.lat), Number(dstGeo.lon)]
  ]);

  if (routeBounds.isValid()) {
    map.fitBounds(routeBounds.pad(0.45), {
      padding: [60, 60],
      animate: false,
      maxZoom: 9
    });
  }

  await refreshHexMesh({ force: true, reason });
}

async function findRoute() {
  const src = document.getElementById('src-select').value.trim();
  const dst = document.getElementById('dst-select').value.trim();
  if (!src || !dst) { showToast('Please enter both locations', 'error'); return; }

  setLoading('find-btn', 'find-btn-text', true, 'SEARCHING HEX-DENSITY ROUTE...');

  try {
    highlightHexRoute([]);

    const [srcGeo, dstGeo] = await Promise.all([
      geocodeLocation(src),
      geocodeLocation(dst)
    ]);

    await ensureMeshAroundEndpoints(srcGeo, dstGeo, 'route-find');

    const srcCell = findNearestHexCell(srcGeo.lat, srcGeo.lon);
    const dstCell = findNearestHexCell(dstGeo.lat, dstGeo.lon);

    if (!srcCell || !dstCell) {
      throw new Error('Could not map locations into the current hex-density mesh.');
    }
    if (srcCell.id === dstCell.id) {
      throw new Error('Both locations map to the same hex cell. Try more distant inputs.');
    }

    const routeResult = runHexPathSearch(srcCell, dstCell, selectedAlgo);
    renderHexRouteResult(srcGeo, dstGeo, routeResult, selectedAlgo);

    if (!routeResult.found) {
      showToast('No density-aware path found between these points.', 'warn');
      return;
    }

    highlightHexRoute(routeResult.pathIds);
    drawHexRoute(srcGeo, dstGeo, routeResult);

    showToast(`${(selectedAlgo || 'route').toUpperCase()} route computed on hex-density mesh.`, 'success');

  } catch(e) {
    document.getElementById('route-result').innerHTML = `<div class="result-card error"><div class="badge badge-danger">ERROR</div><p style="margin-top:10px;font-size:13px;color:var(--muted)">${e.message}</p></div>`;
  } finally {
    setLoading('find-btn', 'find-btn-text', false, 'FIND PATH');
  }
}

// Haversine distance in km between two lat/lon pairs
function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Legacy traversal methods were replaced by unified hex-density routing.

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMPARE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•


async function compareAlgos() {
  const src = document.getElementById('cmp-src').value.trim();
  const dst = document.getElementById('cmp-dst').value.trim();
  if (!src || !dst) { showToast('Enter source and destination', 'error'); return; }

  document.getElementById('compare-result').innerHTML =
    `<div class="empty-state"><div class="empty-state-icon pulse">âš™ï¸</div><div class="empty-state-text">Creating synthetic routing designâ€¦</div></div>`;

  try {
    const [srcGeo, dstGeo] = await Promise.all([
      geocodeLocation(src),
      geocodeLocation(dst)
    ]);

    await ensureMeshAroundEndpoints(srcGeo, dstGeo, 'compare');

    const srcCell = findNearestHexCell(srcGeo.lat, srcGeo.lon);
    const dstCell = findNearestHexCell(dstGeo.lat, dstGeo.lon);
    if (!srcCell || !dstCell) throw new Error('Could not map locations into the synthetic mesh.');
    if (srcCell.id === dstCell.id) throw new Error('Both locations map to the same hex cell. Try different inputs.');

    document.getElementById('compare-result').innerHTML =
      `<div class="empty-state"><div class="empty-state-icon pulse">âš™ï¸</div><div class="empty-state-text">Running all 4 hex algorithmsâ€¦</div></div>`;

    const cmpData = {
      dijkstra: runHexPathSearch(srcCell, dstCell, 'dijkstra'),
      astar: runHexPathSearch(srcCell, dstCell, 'astar'),
      bfs: runHexPathSearch(srcCell, dstCell, 'bfs'),
      dfs: runHexPathSearch(srcCell, dstCell, 'dfs')
    };

    const bestPath = ['dijkstra', 'astar', 'bfs', 'dfs']
      .map(k => cmpData[k])
      .filter(r => r.found)
      .sort((a, b) => a.weightedDistance - b.weightedDistance)[0];

    if (bestPath) {
      highlightHexRoute(bestPath.pathIds);
      drawHexRoute(srcGeo, dstGeo, bestPath);
    }

    // Render 4-column comparison
    const algos = [
      { key: 'dijkstra', label: 'Dijkstra',  color: 'var(--accent)',  note: 'Weighted shortest path on mesh' },
      { key: 'astar',    label: 'A* Star',   color: 'var(--accent4)', note: 'Weighted + heuristic guidance' },
      { key: 'bfs',      label: 'BFT',       color: '#7cf4a0',        note: 'Breadth-first with density ordering' },
      { key: 'dfs',      label: 'DFT',       color: '#ffd166',        note: 'Depth-first with density ordering' },
    ];

    const bestVisited = Math.min(...algos.map(a => cmpData[a.key]?.visitedCount ?? Infinity));

    const cols = algos.map(a => {
      const d = cmpData[a.key] || {};
      const isBest = d.visitedCount === bestVisited;
      return `<div class="compare-item" style="border-color:${isBest ? a.color : 'var(--border)'}">
        <div class="compare-algo" style="color:${a.color}">${a.label}${isBest ? ' &#11088;' : ''}</div>
        <div style="font-size:9px;color:var(--muted);margin-bottom:8px">${a.note}</div>
        <div class="compare-stat"><div class="compare-stat-label">Distance</div>
          <div class="compare-stat-val" style="color:${a.color}">${d.found ? d.rawDistance.toFixed(1) + ' km' : 'No path'}</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Weighted Cost</div>
          <div class="compare-stat-val">${d.found ? d.weightedDistance.toFixed(1) : 'â€”'}</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Nodes Visited</div>
          <div class="compare-stat-val">${d.visitedCount ?? 'â€”'}</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Compute Time</div>
          <div class="compare-stat-val">${d.computationMs?.toFixed(2) ?? 'â€”'}ms</div></div>
        <div class="compare-stat"><div class="compare-stat-label">Hops</div>
          <div class="compare-stat-val">${d.pathIds?.length ? d.pathIds.length - 1 : 'â€”'}</div></div>
      </div>`;
    }).join('');

    document.getElementById('compare-result').innerHTML = `<div class="result-card success">
      <div class="badge badge-success" style="margin-bottom:12px">â­ = fewest nodes explored</div>
      <div class="compare-row" style="grid-template-columns:1fr 1fr;gap:8px;display:grid">${cols}</div>
      <div style="margin-top:12px;font-size:11px;color:var(--muted);padding:10px;background:var(--surface3);border-radius:8px;border:1px solid var(--border);line-height:1.7">
        ðŸ’¡ All algorithms now run on synthetic honeycomb traffic design with no external API dependency.
      </div>
    </div>`;

  } catch(e) {
    document.getElementById('compare-result').innerHTML =
      `<div class="result-card error"><div class="badge badge-danger">ERROR</div><p style="margin-top:8px;font-size:12px;color:var(--muted)">${e.message}</p></div>`;
  }
}

let multiHexRoutes = [];

async function findMultiRoute() {
  const src = document.getElementById('multi-src').value.trim();
  const dst = document.getElementById('multi-dst').value.trim();
  const k   = parseInt(document.getElementById('multi-k').value) || 3;
  if (!src || !dst) { showToast('Enter source and destination', 'error'); return; }

  document.getElementById('multi-result').innerHTML =
    `<div class="empty-state"><div class="empty-state-icon pulse">ðŸ”</div><div class="empty-state-text">Searching alternative routesâ€¦</div></div>`;

  try {
    const [srcGeo, dstGeo] = await Promise.all([
      geocodeLocation(src),
      geocodeLocation(dst)
    ]);

    await ensureMeshAroundEndpoints(srcGeo, dstGeo, 'multi-route');

    const srcCell = findNearestHexCell(srcGeo.lat, srcGeo.lon);
    const dstCell = findNearestHexCell(dstGeo.lat, dstGeo.lon);
    if (!srcCell || !dstCell) throw new Error('Could not map locations into the synthetic mesh.');

    const algoCycle = ['dijkstra', 'astar', 'bfs', 'dfs'];
    const cellPenalty = {};
    const signatures = new Set();
    const routes = [];

    let attempt = 0;
    while (routes.length < k && attempt < k * 6) {
      const algo = algoCycle[attempt % algoCycle.length];
      const route = runHexPathSearch(srcCell, dstCell, algo, cellPenalty);
      attempt += 1;

      if (!route.found || !route.pathIds.length) continue;
      const sig = route.pathIds.join('|');
      if (signatures.has(sig)) {
        for (const id of route.pathIds.slice(1, -1)) {
          cellPenalty[id] = (cellPenalty[id] || 0) + 0.35;
        }
        continue;
      }

      signatures.add(sig);
      routes.push({
        pathIds: route.pathIds,
        dist: route.rawDistance.toFixed(1),
        time: Math.round((route.weightedDistance / 42) * 60),
        weighted: route.weightedDistance,
        algo,
        label: `${algo.toUpperCase()} Route #${routes.length + 1}`,
        srcGeo,
        dstGeo
      });

      for (const id of route.pathIds.slice(1, -1)) {
        cellPenalty[id] = (cellPenalty[id] || 0) + 0.85;
      }
    }

    if (!routes.length) throw new Error('No synthetic alternatives found.');
    multiHexRoutes = routes;

    selectedMultiRouteIdx = 0;
    renderMultiRoutes();
  } catch(e) {
    document.getElementById('multi-result').innerHTML =
      `<div class="result-card error"><div class="badge badge-danger">ERROR</div><p style="margin-top:10px;font-size:12px;color:var(--muted)">${e.message}</p></div>`;
  }
}

// Draws all routes on map â€” selected route is bold black, others are grey
function drawAllMultiRoutes() {
  for (let e of edgeLines) map.removeLayer(e);
  for (let id in nodeMarkers) map.removeLayer(nodeMarkers[id]);
  edgeLines = []; nodeMarkers = {}; bounds = L.latLngBounds();

  multiHexRoutes.forEach((r, i) => {
    const isSelected = i === selectedMultiRouteIdx;
    const coords = [[r.srcGeo.lat, r.srcGeo.lon]];
    for (const id of r.pathIds) {
      const cell = hexCellById.get(id);
      if (cell) coords.push([cell.lat, cell.lon]);
    }
    coords.push([r.dstGeo.lat, r.dstGeo.lon]);
    coords.forEach(c => bounds.extend(c));

    if (isSelected) {
      latestRouteCoords = coords;
      edgeLines.push(L.polyline(coords, { color: '#ffffff', weight: 12, opacity: 0.5 }).addTo(map));
      edgeLines.push(L.polyline(coords, { color: '#000000', weight: 6,  opacity: 1.0 }).addTo(map));
      highlightHexRoute(r.pathIds);
    } else {
      edgeLines.push(L.polyline(coords, { color: '#888888', weight: 4,  opacity: 0.5, dashArray: '6,4' }).addTo(map));
    }
  });

  // Source & destination markers (from selected route)
  if (multiHexRoutes.length > 0) {
    const sel = multiHexRoutes[selectedMultiRouteIdx];
    const srcCoord = [sel.srcGeo.lat, sel.srcGeo.lon];
    const dstCoord = [sel.dstGeo.lat, sel.dstGeo.lon];
    bounds.extend(srcCoord); bounds.extend(dstCoord);

    const sM = L.circleMarker(srcCoord, { radius: 9, fillColor: 'rgba(124,244,160,0.9)', color: '#7cf4a0', weight: 2, fillOpacity: 1 }).addTo(map);
    sM.bindTooltip(`<b>Source</b><br>${sel.srcGeo.label}`, { permanent: true, direction: 'top' });
    nodeMarkers['src'] = sM;

    const dM = L.circleMarker(dstCoord, { radius: 9, fillColor: 'rgba(255,107,53,0.9)', color: '#ff6b35', weight: 2, fillOpacity: 1 }).addTo(map);
    dM.bindTooltip(`<b>Dest</b><br>${sel.dstGeo.label}`, { permanent: true, direction: 'top' });
    nodeMarkers['dst'] = dM;
  }

  if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60] });
  if (globeMode) renderGlobeRoute();
}

function renderMultiRoutes() {
  const html = multiHexRoutes.map((r, i) => {
    const isSelected = i === selectedMultiRouteIdx;
    const distLabel  = `${r.dist} km`;
    const timeLabel  = `â± ${r.time} min Â· ${r.algo.toUpperCase()}`;
    return `<div class="route-option ${isSelected ? 'selected' : ''}" onclick="selectMultiRoute(${i})">
      <div class="route-option-header">
        <span class="route-rank">${r.label}</span>
        <span class="route-dist">${distLabel}</span>
      </div>
      <div style="margin-top:5px;font-size:11px;color:var(--muted);font-family:var(--font-mono)">${timeLabel}</div>
    </div>`;
  }).join('');

  document.getElementById('multi-result').innerHTML = `<div style="margin-top:8px">${html}
    <p style="font-size:11px;color:var(--muted);margin-top:10px;padding:8px;background:var(--surface3);border-radius:8px;border:1px solid var(--border)">
      ðŸ’¡ Alternatives are generated synthetically by re-running hex search with progressive density penalties.
    </p>
  </div>`;

  drawAllMultiRoutes();
}

function selectMultiRoute(idx) {
  selectedMultiRouteIdx = idx;
  renderMultiRoutes();
}


async function loadHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="empty-state-text pulse">Loading history...</div>';
  try {
    const res = await fetch(`${API}/history`);
    const data = await res.json();
    if (!data.history || data.history.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">ðŸ“œ</div><div class="empty-state-text">No route history yet.</div></div>';
      return;
    }
    container.innerHTML = data.history.map(item => `
      <div class="history-item" onclick="loadHistoryItem('${item.timestamp}')">
        <div class="history-route">${item.source} &rarr; ${item.destination}</div>
        <div class="history-meta">${item.algorithm} Â· ${item.total_distance} km Â· ${item.timestamp}</div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = `<div class="empty-state-text error">${e.message}</div>`;
  }
}

async function simulateTraffic() {
  const intensity = document.getElementById('traffic-slider').value / 100;
  try {
    const res = await fetch(`${API}/traffic/simulate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ intensity })
    });
    const data = await res.json();

    if (data.mesh) {
      meshTrafficIntensity = typeof data.mesh.intensity === 'number' ? data.mesh.intensity : intensity;
      if (typeof data.mesh.seed === 'number') meshSeed = data.mesh.seed;
      if (typeof data.mesh.pattern_mode === 'string') meshPatternMode = data.mesh.pattern_mode;
      if (typeof data.mesh.refinement_factor === 'number') meshResolutionFactor = data.mesh.refinement_factor;
    } else {
      meshTrafficIntensity = intensity;
    }

    const val = document.getElementById('traffic-val');
    if (val) val.textContent = `${Math.round(meshTrafficIntensity * 100)}%`;
    syncSyntheticControlFields();

    resetHexMeshViewportKey();
    await refreshHexMesh({ force: true, reason: 'traffic-simulate' });
    showToast('ðŸš¦ Traffic simulation applied with persisted mesh density profile', 'success');
  } catch(e) {
    showToast(`Traffic simulation failed: ${e.message}`, 'error');
  }
}

async function blockRoad() {
  const from = document.getElementById('block-from').value.trim();
  const to = document.getElementById('block-to').value.trim();
  if (!from || !to) { showToast('Enter both cities to block', 'error'); return; }
  try {
    const res = await fetch(`${API}/block`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ from, to })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    showToast(`ðŸš§ Road ${from} <-> ${to} blocked`, 'warn');
  } catch(e) {
    showToast(`Block failed: ${e.message}`, 'error');
  }
}

async function clearHistory() {
  try {
    await fetch(`${API}/history/clear`, { method: 'POST' });
    loadHistory();
    showToast('History cleared', 'info');
  } catch(e) { showToast('Clear failed', 'error'); }
}

async function resetConditions() {
  try {
    meshTrafficIntensity = 0.35;
    activeHexRoute = [];

    const resetRes = await fetch(`${API}/traffic/reset`, { method: 'POST' });
    const resetData = await resetRes.json();

    if (resetData.mesh) {
      meshTrafficIntensity = typeof resetData.mesh.intensity === 'number' ? resetData.mesh.intensity : 0.35;
      if (typeof resetData.mesh.seed === 'number') meshSeed = resetData.mesh.seed;
      if (typeof resetData.mesh.pattern_mode === 'string') meshPatternMode = resetData.mesh.pattern_mode;
      if (typeof resetData.mesh.refinement_factor === 'number') meshResolutionFactor = resetData.mesh.refinement_factor;
    }

    const slider = document.getElementById('traffic-slider');
    const val = document.getElementById('traffic-val');
    if (slider && val) {
      const pct = Math.round(meshTrafficIntensity * 100);
      slider.value = String(pct);
      val.textContent = `${pct}%`;
    }
    syncSyntheticControlFields();

    resetHexMeshViewportKey();
    await refreshHexMesh({ force: true, reason: 'traffic-reset' });
    showToast('â†º Network conditions reset to normal', 'success');
  } catch(e) { showToast('Reset failed', 'error'); }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UI HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function showSection(name) {
  ['route','compare','multi','traffic','history'].forEach(s => {
    document.getElementById(`section-${s}`).classList.toggle('active', s===name);
  });
  document.querySelectorAll('.nav-btn').forEach((b,i) => {
    b.classList.toggle('active', ['route','compare','multi','traffic','history'][i]===name);
  });
  if (name === 'history') loadHistory();
}

function setLoading(btnId, textId, loading, text) {
  const btn = document.getElementById(btnId);
  const span = document.getElementById(textId);
  btn.disabled = loading;
  span.innerHTML = loading ? `<span class="loading-spinner"></span>${text}` : text;
}

function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.style.whiteSpace = 'pre-line';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}


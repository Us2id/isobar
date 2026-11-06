// The optional 3D globe. Layers written for the flat map also run here. They ask the map for a small
// part of Leaflet's interface, and this file provides that part on top of MapLibre's globe view. Only
// their drawing differs, and that lives in globe-layers.js.
import { adaptStyle } from './basemap.js';
import { BASEMAP_ATTRIBUTION, BASEMAP_STYLE } from './config.js';
import { el } from './dom.js';
import { paintTile } from './field-paint.js';
import { diskRadius, globeStyle, slotId, toFlatZoom, toGlobeZoom } from './globe-helpers.js';
import { encodePng } from './png.js';

const STYLE_TIMEOUT_MS = 15_000;
const SLOW_MS = 8_000;
const TILE_RETRY_MS = 1500;
const CREDIT_PREFIX = '<a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a>';
const CHANGE_MS = 400;
const FLIGHT_MS = 1500;

// ---- Tiles fetched through the page, with one retry ----
// NASA and NOAA sometimes fail a tile and serve it fine a moment later. Tiles they have no image for
// come back as nothing, rather than as an error on the whole layer.
const TILE_SCHEME = 'isobar-tile';
const CLEAR_WHITE_SCHEME = 'isobar-clear-white';
const CLOUD_SCHEME = 'isobar-clouds';
const GOES_CLOUD_SCHEME = 'isobar-goes-clouds';
const FIELD_SCHEME = 'isobar-field';
const EMPTY_TILE = encodePng(new Uint8Array(4), 1, 1);
const WHITE = 245;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function fetchTile(url, signal) {
  const address = url.replace(/^[a-z-]+:/, 'https:');
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await wait(TILE_RETRY_MS);
    try {
      const response = await fetch(address, { signal });
      if (response.ok) return await response.arrayBuffer();
      if (response.status === 404 && attempt > 0) return null;
      failure = Object.assign(new Error(`Tile returned ${response.status}`), { status: response.status });
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = error;
    }
  }
  throw failure;
}

const emptyTile = () => ({ data: EMPTY_TILE.slice().buffer });
const loadTile = async ({ url }, { signal }) => {
  const data = await fetchTile(url, signal);
  return data ? { data } : emptyTile();
};

// Decodes a tile, lets `adjust` change its pixels, and packs it up again. Only for layers whose
// looks need it, because this takes far longer than handing the image straight to the map.
async function adjustTile(url, signal, adjust) {
  const bytes = await fetchTile(url, signal);
  if (!bytes) return emptyTile();
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  adjust(data);
  return { data: encodePng(data, canvas.width, canvas.height).buffer };
}

// For services that paint "nothing to report" in plain white, which glares on a dark map.
const clearWhite = (data) => {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > WHITE && data[i + 1] > WHITE && data[i + 2] > WHITE) data[i + 3] = 0;
  }
};

// Infrared satellite images are grey, with bright cloud over a dark Earth. The flat map blends them
// with the page using a CSS filter. The globe can't, so here brightness becomes transparency, with the
// same curve. GOES images run brighter than the world mosaic, so they're first brought into line.
const cloudsOnly = (brighter) => (data) => {
  for (let i = 0; i < data.length; i += 4) {
    const shade = brighter ? 1.31 * data[i] - 70 : data[i];
    const level = (shade - 116) * 1.42;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = Math.min(data[i + 3], Math.max(0, Math.min(255, level)));
  }
};

// ---- Forecast fields, painted into tiles on request ----
const paintedFields = new Map();
let fieldSerial = 0;
let paintTurn = Promise.resolve();

export function addPaintedField(grid, lookup, nearest) {
  const key = `field${++fieldSerial}`;
  paintedFields.set(key, { grid, lookup, nearest });
  return key;
}

export const removePaintedField = (key) => paintedFields.delete(key);

async function loadFieldTile({ url }, { signal }) {
  // One tile per turn of the event loop, so painting never freezes the page.
  paintTurn = paintTurn.then(() => wait(0));
  await paintTurn;
  if (signal?.aborted) throw new DOMException('Tile no longer needed', 'AbortError');
  const [, key, z, x, y] = url.match(/^[a-z-]+:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
  const field = paintedFields.get(key);
  if (!field) return emptyTile();
  // Above zoom 6 the grid is far coarser than the screen, so a smaller tile looks the same.
  const size = Number(z) >= 6 ? 128 : 256;
  const rgba = new Uint8ClampedArray(size * size * 4);
  paintTile(rgba, size, { x: Number(x), y: Number(y), z: Number(z) }, field.grid, field.grid.values, field.lookup, field.nearest);
  return { data: encodePng(rgba, size, size).buffer };
}

export const fieldTemplate = (key) => `${FIELD_SCHEME}://${key}/{z}/{x}/{y}`;
export const tileTemplate = (url) => url.replace(/^https:/, `${TILE_SCHEME}:`);
export const clearWhiteTemplate = (url) => url.replace(/^https:/, `${CLEAR_WHITE_SCHEME}:`);
export const cloudTemplate = (url, isGoes) => url.replace(/^https:/, `${isGoes ? GOES_CLOUD_SCHEME : CLOUD_SCHEME}:`);

let protocolsAdded = false;
function addProtocols() {
  if (protocolsAdded) return;
  protocolsAdded = true;
  maplibregl.addProtocol(TILE_SCHEME, loadTile);
  maplibregl.addProtocol(CLEAR_WHITE_SCHEME, ({ url }, { signal }) => adjustTile(url, signal, clearWhite));
  maplibregl.addProtocol(CLOUD_SCHEME, ({ url }, { signal }) => adjustTile(url, signal, cloudsOnly(false)));
  maplibregl.addProtocol(GOES_CLOUD_SCHEME, ({ url }, { signal }) => adjustTile(url, signal, cloudsOnly(true)));
  maplibregl.addProtocol(FIELD_SCHEME, loadFieldTile);
}

// ---- A tile layer with the part of Leaflet's interface the layers use ----
class Emitter {
  handlers = new Map();

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return this;
  }

  once(type, handler) {
    const wrapped = (event) => {
      this.off(type, wrapped);
      handler(event);
    };
    return this.on(type, wrapped);
  }

  off(type, handler) {
    this.handlers.get(type)?.delete(handler);
    return this;
  }

  fire(type, event = {}) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event);
  }
}

let serial = 0;

export class GlobeTiles extends Emitter {
  constructor(template, { tileSize = 256, maxzoom = 22, bounds, pane, opacity = 1, attribution } = {}) {
    super();
    Object.assign(this, { template: tileTemplate(template), tileSize, maxzoom, bounds, pane, opacity, attribution });
    this.shown = null;
    this.coming = null;
    this.removed = false;
  }

  addTo(globe) {
    this.globe = globe;
    if (this.attribution) globe.attributionControl.addAttribution(this.attribution);
    globe.whenReady(() => {
      if (!this.removed) this.load();
    });
    return this;
  }

  // New tiles load out of sight and swap in once ready, so the layer never blinks.
  load() {
    const { map } = this.globe;
    const id = `tiles-${++serial}`;
    this.fire('loading');
    map.addSource(id, {
      type: 'raster',
      tiles: [this.template],
      tileSize: this.tileSize,
      maxzoom: this.maxzoom,
      ...(this.bounds ? { bounds: this.bounds } : {}),
    });
    map.addLayer({
      id,
      type: 'raster',
      source: id,
      paint: { 'raster-opacity': this.shown ? 0 : this.opacity, 'raster-fade-duration': 0 },
    }, slotId(this.pane));
    this.globe.watchTiles(id, this);
    if (this.coming) this.drop(this.coming);
    if (this.shown) this.coming = id;
    else this.shown = id;
    this.pendingLoad = true;
  }

  drop(id) {
    const { map } = this.globe;
    this.globe.unwatchTiles(id);
    map.removeLayer(id);
    map.removeSource(id);
  }

  // From the map: one tile arrived or failed, or everything on screen is done.
  tileArrived(id) {
    this.fire('tileload', { tile: {} });
    this.checkDone(id);
  }

  tileFailed(id) {
    this.fire('tileerror', { tile: {} });
    this.checkDone(id);
  }

  checkDone(id, idle = false) {
    if (!idle && !this.globe.map.isSourceLoaded(id)) return;
    if (id === this.coming) {
      this.globe.map.setPaintProperty(id, 'raster-opacity', this.opacity);
      this.drop(this.shown);
      this.shown = id;
      this.coming = null;
    }
    if (id !== this.shown || (!this.pendingLoad && idle)) return;
    this.pendingLoad = false;
    this.fire('load');
  }

  setUrl(template) {
    this.template = tileTemplate(template);
    this.globe.whenReady(() => {
      if (!this.removed) this.load();
    });
    return this;
  }

  redraw() {
    return this.setUrl(this.template);
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    if (this.shown) this.globe.map.setPaintProperty(this.shown, 'raster-opacity', opacity);
    return this;
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    if (this.attribution) this.globe.attributionControl.removeAttribution(this.attribution);
    if (!this.globe.alive) return;
    if (this.coming) this.drop(this.coming);
    if (this.shown) this.drop(this.shown);
  }
}

// ---- Shapes from GeoJSON, drawn by one or more style layers ----
export class GlobeFeatures {
  constructor(globe, { pane, data, layers, onClick }) {
    this.globe = globe;
    this.removed = false;
    this.layerIds = [];
    globe.whenReady(() => {
      if (this.removed) return;
      this.sourceId = `features-${++serial}`;
      globe.map.addSource(this.sourceId, { type: 'geojson', data });
      layers.forEach((spec, index) => {
        const id = `${this.sourceId}-${index}`;
        globe.map.addLayer({ ...spec, id, source: this.sourceId }, slotId(pane));
        this.layerIds.push(id);
        if (onClick) globe.clickable.set(id, onClick);
      });
    });
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    const { globe } = this;
    if (!globe.alive || !this.sourceId) return;
    for (const id of this.layerIds) {
      globe.clickable.delete(id);
      globe.map.removeLayer(id);
    }
    globe.map.removeSource(this.sourceId);
  }
}

// ---- Things with their own page element, like cyclone and pressure marks ----
export class GlobeMarkers {
  constructor(globe, items) {
    this.markers = items.map(({ lat, lng, element, popup }) => {
      if (popup) {
        element.addEventListener('click', () => globe.openPopup(lat, lng, popup()));
      }
      return new maplibregl.Marker({ element, anchor: 'center', opacityWhenCovered: '0' }).setLngLat([lng, lat]).addTo(globe.map);
    });
  }

  remove() {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }
}

// ---- The globe itself ----
export class GlobeMap {
  // Fetches the map style first, so a failure here leaves the flat map untouched.
  static async create(container, position, callbacks) {
    const response = await fetch(BASEMAP_STYLE, { signal: AbortSignal.timeout(STYLE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Base map style returned ${response.status}`);
    const style = globeStyle(adaptStyle(await response.json()));
    return new GlobeMap(container, style, position, callbacks);
  }

  constructor(container, style, { lat, lng, zoom, clearOf }, { onClick, onPointer, onDragStart, onSlow, onUnavailable, onLoaded }) {
    addProtocols();
    this.container = container;
    // Keeps the Earth centered in the space left beside the layer panel.
    this.clearOf = { top: 0, bottom: 0, left: 0, right: 0, ...clearOf };
    this.alive = true;
    this.isReady = false;
    this.goingToZoom = null;
    this.queue = [];
    this.tileOwners = new Map();
    this.clickable = new Map();
    this.credits = new Map();
    container.hidden = false;
    this.map = new maplibregl.Map({
      container,
      style,
      center: [lng, lat],
      zoom,
      minZoom: 0,
      maxZoom: 10,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    const { map } = this;
    map.setPadding(this.clearOf);
    // North stays up, as on the flat map. Dragging turns the Earth, and that's all anyone needs.
    map.dragRotate.disable();
    map.keyboard.disableRotation();
    map.touchZoomRotate.disableRotation();
    this.creditBox = el('div', { class: 'maplibregl-ctrl globe-credits' });
    map.addControl({ onAdd: () => this.creditBox, onRemove: () => this.creditBox.remove() }, 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.renderCredits();

    // A soft glow behind the Earth, instead of an atmosphere drawn over the data.
    this.glow = el('div', { class: 'globe-glow' });
    container.prepend(this.glow);
    const placeGlow = () => {
      const radius = diskRadius(map.getZoom(), map.getCenter().lat, container.clientHeight);
      const { x, y } = map.project(map.getCenter());
      Object.assign(this.glow.style, { left: `${x - radius}px`, top: `${y - radius}px`, width: `${radius * 2}px`, height: `${radius * 2}px` });
    };
    placeGlow();
    map.on('move', placeGlow);
    map.on('resize', placeGlow);

    map.once('style.load', () => {
      this.isReady = true;
      for (const task of this.queue) task();
      this.queue = [];
    });

    // Tile events go to whichever layer owns that source.
    map.on('sourcedata', (event) => {
      if (event.tile && event.tile.state === 'loaded') this.tileOwners.get(event.sourceId)?.tileArrived(event.sourceId);
    });
    map.on('idle', () => {
      for (const [id, owner] of [...this.tileOwners]) owner.checkDone(id, true);
    });

    // A long first load gets a message, because a blank Earth looks broken. So does a real failure.
    let failedSinceIdle = false;
    let settled = false;
    const slowTimer = setTimeout(() => {
      if (!settled && !failedSinceIdle) onSlow();
    }, SLOW_MS);
    map.on('error', (event) => {
      const owner = this.tileOwners.get(event.sourceId);
      if (owner) {
        owner.tileFailed(event.sourceId);
        return;
      }
      failedSinceIdle = true;
      onUnavailable();
    });
    map.on('idle', () => {
      settled = true;
      clearTimeout(slowTimer);
      if (!failedSinceIdle) onLoaded();
      failedSinceIdle = false;
    });
    this.stopSlowTimer = () => clearTimeout(slowTimer);

    map.on('moveend', () => { this.goingToZoom = null; });

    map.on('click', (event) => {
      if (event.originalEvent.target.closest?.('.maplibregl-marker')) return;
      this.closePopup();
      const hit = this.featureAt(event.point);
      if (hit) {
        this.clickable.get(hit.layer.id)(hit, event.lngLat);
        return;
      }
      if (this.isOnEarth(event.point)) onClick(event.lngLat.wrap());
    });
    let pointerQueued = null;
    map.on('mousemove', (event) => {
      if (pointerQueued === null) requestAnimationFrame(() => {
        const { point, lngLat } = pointerQueued;
        pointerQueued = null;
        if (!this.alive) return;
        map.getCanvas().style.cursor = this.featureAt(point) ? 'pointer' : '';
        onPointer(this.isOnEarth(point) ? lngLat.wrap() : null);
      });
      pointerQueued = event;
    });
    map.on('mouseout', () => onPointer(null));
    map.on('dragstart', onDragStart);
    // Keyboard users can move with the arrow keys and press Enter for the spot at the center.
    map.getCanvas().addEventListener('keydown', (event) => {
      if (event.key === 'Enter') onClick(map.getCenter());
    });
    map.getCanvas().setAttribute('aria-label', 'Weather globe. Use the arrow keys to turn it and Enter for a forecast at the center.');
  }

  featureAt(point) {
    if (this.clickable.size === 0) return null;
    return this.map.queryRenderedFeatures(point, { layers: [...this.clickable.keys()] })[0] ?? null;
  }

  isOnEarth(point) {
    return this.map.transform.isPointOnMapSurface?.(point) ?? true;
  }

  whenReady(task) {
    if (this.isReady) task();
    else this.queue.push(task);
  }

  watchTiles(id, owner) {
    this.tileOwners.set(id, owner);
  }

  unwatchTiles(id) {
    this.tileOwners.delete(id);
  }

  // ---- The part of Leaflet's map interface the layers use ----
  attributionControl = {
    addAttribution: (text) => {
      this.credits.set(text, (this.credits.get(text) ?? 0) + 1);
      this.renderCredits();
    },
    removeAttribution: (text) => {
      const count = (this.credits.get(text) ?? 0) - 1;
      if (count > 0) this.credits.set(text, count);
      else this.credits.delete(text);
      this.renderCredits();
    },
  };

  // Every credit is a fixed string from this site's own code, so it can safely hold links.
  renderCredits() {
    this.creditBox.innerHTML = `${CREDIT_PREFIX} | ${[BASEMAP_ATTRIBUTION, ...this.credits.keys()].join(', ')}`;
  }

  getBounds() {
    return this.map.getBounds();
  }

  getZoom() {
    return toFlatZoom(this.map.getZoom());
  }

  getSize() {
    return { x: this.container.clientWidth, y: this.container.clientHeight };
  }

  on(type, handler) {
    this.map.on(type, handler);
    return this;
  }

  once(type, handler) {
    this.map.once(type, handler);
    return this;
  }

  off(type, handler) {
    this.map.off(type, handler);
    return this;
  }

  removeLayer(layer) {
    layer.remove();
  }

  // ---- What the rest of the page asks of either kind of map ----
  position() {
    const { lat, lng } = this.map.getCenter();
    return { lat, lng, zoom: this.getZoom() };
  }

  goTo(lat, lng, minZoom) {
    const zoom = Math.max(this.map.getZoom(), toGlobeZoom(minZoom));
    this.map.flyTo({ center: [lng, lat], zoom, speed: 1.6 });
    this.goingToZoom = zoom;
  }

  setSpot(lat, lng) {
    if (this.spot) {
      this.spot.setLngLat([lng, lat]);
      return;
    }
    this.spot = new maplibregl.Marker({ element: el('div', { class: 'spot-marker globe-spot' }), anchor: 'center', opacityWhenCovered: '0' })
      .setLngLat([lng, lat])
      .addTo(this.map);
  }

  clearSpot() {
    this.spot?.remove();
    this.spot = null;
    if (this.padded) {
      this.padded = false;
      this.map.easeTo({ padding: this.clearOf, duration: CHANGE_MS });
    }
  }

  // Turns the globe so a spot shows clear of the forecast strip and the layer panel.
  keepSpotInView(lat, lng, { top, bottom }) {
    this.padded = true;
    const padding = { ...this.clearOf, top: Math.max(top, this.clearOf.top), bottom: Math.max(bottom, this.clearOf.bottom) };
    // This can interrupt a flight to a searched place, which mustn't lose the zoom it was heading for.
    const zoom = this.goingToZoom;
    this.map.easeTo({ center: [lng, lat], zoom: zoom ?? this.map.getZoom(), padding, duration: zoom === null ? CHANGE_MS : FLIGHT_MS });
    this.goingToZoom = zoom;
  }

  openPopup(lat, lng, content) {
    this.closePopup();
    // The click that opens a popup also reaches the map, so the map's own closing rule stays off.
    this.popup = new maplibregl.Popup({ maxWidth: '320px', closeOnClick: false }).setLngLat([lng, lat]).setDOMContent(content).addTo(this.map);
  }

  closePopup() {
    this.popup?.remove();
    this.popup = null;
  }

  focus() {
    this.map.getCanvas().focus({ preventScroll: true });
  }

  remove() {
    this.alive = false;
    this.stopSlowTimer();
    this.closePopup();
    this.map.remove();
    this.container.replaceChildren();
    this.container.hidden = true;
  }
}

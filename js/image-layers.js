// Layers that arrive as finished map images: NASA GIBS, NOAA map services and RainViewer.
import { chooseGibsTime, dayBefore, describeGibsTime, isDailyStamp } from './gibs-day.js';
import { repeatWhileVisible } from './schedule.js';

const CHECK_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;
export const NOAA_SERVICES = 'https://mapservices.weather.noaa.gov';
const GIBS = 'https://gibs.earthdata.nasa.gov';
const FAILED = "Can't load this layer. Retrying.";
const TILE_RETRY_MS = 1500;
const ZOOM_IN = 'Zoom in to see this layer.';

// Watches a tile layer's loads, so a dead service shows as an error. NASA and NOAA sometimes fail a
// tile and serve it fine a moment later, so each tile gets one retry before it counts as failed.
// Tiles drawn on a canvas handle their own retry.
function watchTiles(layer, onResult) {
  const retried = new WeakSet();
  let loaded = 0;
  let failed = 0;
  layer.on('loading', () => {
    loaded = 0;
    failed = 0;
  });
  layer.on('tileload', () => { loaded += 1; });
  layer.on('tileerror', ({ tile, coords }) => {
    if (tile.tagName === 'IMG' && !retried.has(tile)) {
      retried.add(tile);
      setTimeout(() => { tile.src = layer.getTileUrl(coords); }, TILE_RETRY_MS);
    } else {
      failed += 1;
    }
  });
  layer.on('load', () => {
    if (loaded > 0 || failed > 0) onResult(loaded, failed);
  });
}

class TileLayerBase {
  constructor(map, entry, { onStatus, pane, opacity, attribution }) {
    Object.assign(this, { map, entry, onStatus, pane, attribution });
    this.opacity = opacity;
    this.layer = null;
    this.active = false;
  }

  start() {
    this.active = true;
    this.onStatus({ state: 'loading' });
    this.stopLoop = repeatWhileVisible(() => this.check(), { intervalMs: this.checkMs ?? CHECK_MS, retryMs: RETRY_MS });
  }

  show() {
    this.layer = this.makeLayer();
    watchTiles(this.layer, (loaded, failed) => {
      if (!this.active) return;
      clearTimeout(this.retryTimer);
      if (failed > 0 && loaded === 0) {
        this.onStatus({ state: 'error', message: FAILED });
        this.retryTimer = setTimeout(() => this.layer?.redraw(), RETRY_MS);
      } else {
        this.onLoaded();
      }
    });
    this.layer.addTo(this.map);
  }

  stop() {
    this.active = false;
    clearTimeout(this.retryTimer);
    this.stopLoop?.();
    if (this.layer) this.map.removeLayer(this.layer);
    this.layer = null;
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    this.layer?.setOpacity(opacity);
  }

  update() {}

  onLoaded() {
    this.onStatus({ state: 'ok', checkedAt: Date.now() });
  }

  at() {
    return NaN;
  }
}

// NASA tiles. A small tile comes first, because its response says how new the layer really is.
export class GibsLayer extends TileLayerBase {
  checkMs = 10 * 60_000;

  template(time) {
    const { layer, level, ext } = this.entry;
    return `${GIBS}/wmts/epsg3857/best/${layer}/default/${time}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;
  }

  makeLayer() {
    return L.tileLayer(this.template(this.time), {
      pane: this.pane,
      opacity: this.opacity,
      maxNativeZoom: this.entry.level,
      bounds: this.entry.bounds,
      attribution: this.attribution,
      updateWhenZooming: false,
      keepBuffer: 1,
    });
  }

  onLoaded() {
    if (this.dateText) this.onStatus({ state: 'ok', note: this.dateText });
    else this.onStatus({ state: 'ok', checkedAt: Date.now() });
  }

  // The time NASA's own response gives for a request.
  async actualTime(time) {
    const url = this.template(time).replace('{z}', '0').replace('{y}', '0').replace('{x}', '0');
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`NASA returned ${response.status}`);
        return response.headers.get('layer-time-actual');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async newest() {
    const newest = await this.actualTime('default');
    if (!isDailyStamp(newest)) return chooseGibsTime(newest);
    if (newest !== this.knownNewest) {
      this.knownPrevious = await this.actualTime(dayBefore(newest)).catch(() => null);
      this.knownNewest = newest;
    }
    return chooseGibsTime(newest, this.knownPrevious);
  }

  async check() {
    if (this.entry.timeless) {
      this.time = 'default';
      if (!this.layer) this.show();
      return;
    }
    let chosen;
    try {
      chosen = await this.newest();
    } catch (error) {
      // The picture may still load even though the date check failed.
      if (this.active && !this.layer) {
        this.time = 'default';
        this.show();
      }
      throw error;
    }
    if (!this.active) return;
    this.dateText = describeGibsTime(chosen);
    if (!this.layer) {
      this.time = chosen.time;
      this.show();
    } else if (chosen.time !== this.time) {
      this.time = chosen.time;
      this.layer.setUrl(this.template(this.time));
    } else {
      this.onLoaded();
    }
  }
}

// NOAA ArcGIS services draw any rectangle on request, so each tile asks for its own.
const ArcgisTiles = L.TileLayer.extend({
  initialize(baseUrl, options) {
    L.TileLayer.prototype.initialize.call(this, baseUrl, options);
    this.baseUrl = baseUrl;
  },
  getTileUrl(coords) {
    const bounds = this._tileCoordsToBounds(coords);
    const crs = L.CRS.EPSG3857;
    const sw = crs.project(bounds.getSouthWest());
    const ne = crs.project(bounds.getNorthEast());
    const size = this.getTileSize();
    const params = new URLSearchParams({
      bbox: `${sw.x},${sw.y},${ne.x},${ne.y}`,
      bboxSR: '3857',
      imageSR: '3857',
      size: `${size.x},${size.y}`,
      format: this.options.image ? 'png' : 'png32',
      transparent: 'true',
      f: 'image',
    });
    if (this.options.show) params.set('layers', `show:${this.options.show.join(',')}`);
    return `${this.baseUrl}${this.options.image ? '/exportImage' : '/export'}?${params}`;
  },
});

// For services that paint "nothing to report" in plain white, which glares on a dark map.
const WHITE = 245;
const ClearWhiteTiles = ArcgisTiles.extend({
  createTile(coords, done) {
    const canvas = document.createElement('canvas');
    const size = this.getTileSize();
    canvas.width = size.x;
    canvas.height = size.y;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, size.x, size.y);
      const { data } = pixels;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > WHITE && data[i + 1] > WHITE && data[i + 2] > WHITE) data[i + 3] = 0;
      }
      context.putImageData(pixels, 0, 0);
      done(null, canvas);
    };
    const load = () => { image.src = this.getTileUrl(coords); };
    let retried = false;
    image.onerror = (error) => {
      if (retried) {
        done(error, canvas);
      } else {
        retried = true;
        setTimeout(load, TILE_RETRY_MS);
      }
    };
    load();
    return canvas;
  },
});

export class ArcgisLayer extends TileLayerBase {
  start() {
    super.start();
    if (!this.entry.minZoom) return;
    this.onZoom = () => this.onLoaded();
    this.map.on('zoomend', this.onZoom);
  }

  stop() {
    super.stop();
    if (this.onZoom) this.map.off('zoomend', this.onZoom);
  }

  onLoaded() {
    if (this.map.getZoom() < this.entry.minZoom) this.onStatus({ state: 'ok', note: ZOOM_IN });
    else super.onLoaded();
  }

  makeLayer() {
    const Tiles = this.entry.clearWhite ? ClearWhiteTiles : ArcgisTiles;
    return new Tiles(`${NOAA_SERVICES}/${this.entry.service}`, {
      pane: this.pane,
      opacity: this.opacity,
      tileSize: 512,
      show: this.entry.show,
      image: this.entry.image,
      attribution: this.attribution,
      updateWhenZooming: false,
      keepBuffer: 0,
    });
  }

  async check() {
    if (this.layer) this.layer.redraw();
    else this.show();
  }
}

// NOAA ArcGIS services can describe their own color keys.
export async function loadArcgisLegend(entry) {
  if (entry.image) return [];
  const response = await fetch(`${NOAA_SERVICES}/${entry.service}/legend?f=json`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return [];
  const { layers = [] } = await response.json();
  const chosen = entry.show ? layers.filter((layer) => entry.show.includes(layer.layerId)) : layers;
  const rows = chosen.flatMap((layer) => layer.legend ?? []).filter((row) => row.label && row.imageData);
  const seen = new Set();
  return rows.filter((row) => (seen.has(row.label) ? false : seen.add(row.label))).slice(0, 14)
    .map((row) => ({ label: row.label, image: `data:${row.contentType};base64,${row.imageData}` }));
}

export const gibsLegendUrl = (entry) => (entry.legend ? `${GIBS}/legends/${entry.legend}` : null);

// World radar from RainViewer. Free plan: zoom 7 at most, one color scheme and 100 requests a
// minute per visitor, so the loop uses every other frame and stops when the map moves.
const RAINVIEWER_MAPS = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_CHECK_MS = 5 * 60_000;
const LOOP_STEP_MS = 650;
const LOOP_PAUSE_FRAMES = 4;

export class RainViewerLayer {
  constructor(map, { onStatus, onLoopChange, pane, opacity, attribution }) {
    Object.assign(this, { map, onStatus, onLoopChange, pane, opacity, attribution });
    this.frame = null;
    this.path = null;
    this.maps = null;
    this.loop = null;
    this.stopOnMove = () => this.stopLoopPlayback();
  }

  start() {
    this.active = true;
    this.onStatus({ state: 'loading' });
    this.stopLoop = repeatWhileVisible(() => this.check(), { intervalMs: RAINVIEWER_CHECK_MS, retryMs: 2 * 60_000 });
  }

  stop() {
    this.active = false;
    this.stopLoopPlayback();
    this.stopLoop?.();
    if (this.frame) this.map.removeLayer(this.frame);
    this.frame = null;
    this.path = null;
  }

  tileUrl(path) {
    return `${this.maps.host}${path}/512/{z}/{x}/{y}/2/1_1.png`;
  }

  tileLayer(path, opacity) {
    return L.tileLayer(this.tileUrl(path), {
      pane: this.pane,
      opacity,
      tileSize: 512,
      zoomOffset: -1,
      maxNativeZoom: 8, // zoom 7 tiles once the 512-pixel offset is applied
      attribution: this.attribution,
      updateWhenZooming: false,
      keepBuffer: 0,
    });
  }

  async check() {
    try {
      const response = await fetch(RAINVIEWER_MAPS, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`RainViewer returned ${response.status}`);
      this.maps = await response.json();
    } catch (error) {
      if (this.active) this.onStatus({ state: 'error', message: "Can't reach RainViewer. Retrying.", dataTime: this.time });
      throw error;
    }
    const latest = this.maps.radar?.past?.at(-1);
    if (!this.active || !latest) return;
    if (latest.path !== this.path && !this.loop) {
      this.path = latest.path;
      this.time = latest.time * 1000;
      this.showLatest();
    }
    this.onStatus({ state: 'ok', dataTime: this.time, staleAfterMs: 40 * 60_000 });
  }

  showLatest() {
    const next = this.tileLayer(this.path, 0);
    next.once('load', () => setTimeout(() => {
      if (!this.active) {
        this.map.removeLayer(next);
        return;
      }
      next.setOpacity(this.opacity);
      if (this.frame && this.frame !== next) this.map.removeLayer(this.frame);
      this.frame = next;
    }));
    next.addTo(this.map);
  }

  get isPlaying() {
    return Boolean(this.loop);
  }

  // Steps through the past two hours, holding a moment on the newest frame.
  playLoop() {
    if (this.loop || !this.maps || !this.active) return;
    const past = this.maps.radar.past;
    const chosen = past.filter((_, index) => (past.length - 1 - index) % 2 === 0);
    const frames = chosen.map(({ path, time }) => ({ time: time * 1000, layer: this.tileLayer(path, 0).addTo(this.map) }));
    if (this.frame) this.frame.setOpacity(0);
    let index = -1;
    let hold = 0;
    this.loop = {
      frames,
      timer: setInterval(() => {
        if (document.hidden) return;
        if (index === frames.length - 1 && hold < LOOP_PAUSE_FRAMES) {
          hold += 1;
          return;
        }
        hold = 0;
        if (index >= 0) frames[index].layer.setOpacity(0);
        index = (index + 1) % frames.length;
        frames[index].layer.setOpacity(this.opacity);
        this.onStatus({ state: 'ok', note: `Showing ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(frames[index].time)}` });
      }, LOOP_STEP_MS),
    };
    this.map.once('movestart', this.stopOnMove);
    this.onLoopChange?.(true);
  }

  stopLoopPlayback() {
    if (!this.loop) return;
    clearInterval(this.loop.timer);
    for (const { layer } of this.loop.frames) this.map.removeLayer(layer);
    this.loop = null;
    this.map.off('movestart', this.stopOnMove);
    if (this.frame) this.frame.setOpacity(this.opacity);
    if (this.active) this.onStatus({ state: 'ok', dataTime: this.time, staleAfterMs: 40 * 60_000 });
    this.onLoopChange?.(false);
  }
}

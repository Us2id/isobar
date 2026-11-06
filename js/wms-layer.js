// A map layer made of images from a NOAA map service, kept current on its own.
// Many layers cover several separate areas (the lower 48, Alaska, Hawaii...). Each area is a
// "part" that only asks for data while it is on screen.
import { fetchLatestTime } from './capabilities.js';
import { boxTouchesView, leafletBounds } from './geo.js';
import { repeatWhileVisible } from './schedule.js';
import { mergeStatuses } from './status.js';

const FRAME_TIMEOUT_MS = 30_000;
const CANT_REACH = "Can't reach NOAA. Retrying.";

const viewOf = (map) => {
  const bounds = map.getBounds();
  return { west: bounds.getWest(), east: bounds.getEast(), south: bounds.getSouth(), north: bounds.getNorth() };
};

class Part {
  constructor(owner, spec, zIndex) {
    this.owner = owner;
    this.spec = spec;
    this.zIndex = zIndex;
    this.status = { state: 'loading' };
    this.frame = null;
    this.pending = null;
    this.time = null;
    this.token = 0;
    this.stopLoop = null;
  }

  get inView() {
    return boxTouchesView(this.spec.box, viewOf(this.owner.map));
  }

  resume() {
    if (this.stopLoop) return;
    const { refreshMs, retryMs } = this.owner.options;
    this.stopLoop = repeatWhileVisible(() => this.refresh(), { intervalMs: refreshMs, retryMs });
  }

  pause() {
    this.stopLoop?.();
    this.stopLoop = null;
  }

  remove() {
    this.pause();
    this.token += 1;
    const { map } = this.owner;
    if (this.pending) map.removeLayer(this.pending);
    if (this.frame) map.removeLayer(this.frame);
    this.pending = null;
    this.frame = null;
    this.time = null;
    this.status = { state: 'loading' };
  }

  async refresh() {
    const { spec, owner } = this;
    const token = ++this.token;
    const lastData = this.time ? Date.parse(this.time) : undefined;
    try {
      const time = spec.capabilitiesUrl ? await fetchLatestTime(spec.capabilitiesUrl, spec.layer) : null;
      if (token !== this.token) return;
      if (!this.frame || !spec.capabilitiesUrl || time !== this.time) {
        await this.showFrame(time, token);
        if (token !== this.token) return;
        this.time = time;
      }
      this.status = spec.capabilitiesUrl
        ? { state: 'ok', dataTime: Date.parse(time), staleAfterMs: spec.staleAfterMs ?? owner.options.staleAfterMs }
        : { state: 'ok', checkedAt: Date.now() };
      owner.report();
    } catch (error) {
      if (token !== this.token) return;
      this.status = { state: 'error', message: CANT_REACH, dataTime: lastData };
      owner.report();
      throw error;
    }
  }

  // Loads the new image set out of sight and swaps it in once ready, so the layer never blinks.
  showFrame(time, token) {
    const { map, options } = this.owner;
    return new Promise((resolve, reject) => {
      const next = this.owner.makeFrame(this.spec, time, this.zIndex);
      let loaded = 0;
      let failed = 0;
      let settled = false;
      next.on('tileload', () => { loaded += 1; });
      next.on('tileerror', () => { failed += 1; });
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending = null;
        if (token !== this.token) {
          map.removeLayer(next);
          resolve();
          return;
        }
        if (failed > 0 && loaded === 0) {
          map.removeLayer(next);
          reject(new Error('Every image request failed'));
          return;
        }
        next.setOpacity(options.opacity);
        if (this.frame) map.removeLayer(this.frame);
        this.frame = next;
        resolve();
      };
      const timer = setTimeout(settle, FRAME_TIMEOUT_MS);
      // Leaflet still uses the layer right after firing 'load', so it can't be removed during it.
      next.on('load', () => setTimeout(settle));
      this.pending = next;
      next.addTo(map);
    });
  }
}

export class WmsLayer {
  constructor(map, options, onStatus) {
    this.map = map;
    this.options = options;
    this.onStatus = onStatus;
    this.parts = options.parts.map((spec, index) => new Part(this, spec, index + 1));
    this.active = false;
    this.sync = this.sync.bind(this);
  }

  // One image set for a part, not yet on the map and not yet visible.
  makeFrame(spec, time, zIndex) {
    const { options } = this;
    return L.tileLayer.wms(spec.url, {
      layers: spec.layer,
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      crs: L.CRS.EPSG3857,
      tileSize: 512,
      pane: spec.pane ?? options.pane,
      zIndex,
      opacity: 0,
      bounds: leafletBounds(spec.box),
      attribution: options.attribution,
      updateWhenZooming: false,
      keepBuffer: 1,
      ...(time ? { time } : {}),
    });
  }

  start() {
    this.active = true;
    this.map.on('moveend', this.sync);
    this.onStatus({ state: 'loading' });
    this.sync();
  }

  stop() {
    this.active = false;
    this.map.off('moveend', this.sync);
    this.parts.forEach((part) => part.remove());
  }

  sync() {
    if (!this.active) return;
    for (const part of this.parts) {
      if (part.inView) part.resume();
      else part.pause();
    }
    this.report();
  }

  report() {
    if (!this.active) return;
    const { statusOrder, merge, outsideMessage } = this.options;
    const ordered = statusOrder
      ? statusOrder.map((id) => this.parts.find((part) => part.spec.id === id))
      : this.parts;
    const visible = ordered.filter((part) => part.inView).map((part) => part.status);
    this.onStatus(mergeStatuses(visible, merge, outsideMessage));
  }
}

// Colors the map from a forecast field, and answers "what's the value here?".
import { sourceFor, usesFallback } from './catalog/fields.js';
import { paintTile } from './field-paint.js';
import { sampleGrid } from './grid-math.js';
import { buildLookup } from './palettes.js';
import { repeatWhileVisible } from './schedule.js';

const CHECK_MS = 15 * 60_000;
const RETRY_MS = 3 * 60_000;
const CANT_REACH = "Can't load this layer. Retrying.";

const PaintedLayer = L.GridLayer.extend({
  initialize(grid, values, lookup, nearest, options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this.setData(grid, values, lookup, nearest);
  },
  setData(grid, values, lookup, nearest) {
    this.grid = grid;
    this.values = values;
    this.lookup = lookup;
    this.nearest = nearest;
  },
  createTile(coords) {
    // Above zoom 6 the grid is far coarser than the screen, so a smaller canvas looks the same.
    const size = coords.z >= 6 ? 128 : 256;
    const tile = L.DomUtil.create('canvas', 'leaflet-tile');
    tile.width = size;
    tile.height = size;
    const context = tile.getContext('2d');
    const image = context.createImageData(size, size);
    paintTile(image.data, size, coords, this.grid, this.values, this.lookup, this.nearest);
    context.putImageData(image, 0, 0);
    return tile;
  },
});

export class FieldLayer {
  constructor(map, service, entry, { getModel, getTime, onStatus, pane, opacity, attribution }) {
    Object.assign(this, { map, service, entry, getModel, getTime, onStatus, pane, attribution });
    this.opacity = opacity;
    this.lookup = buildLookup(entry.ramp);
    this.layer = null;
    this.result = null;
    this.active = false;
    this.token = 0;
  }

  get label() {
    return this.result ? `${this.result.product}` : '';
  }

  start() {
    this.active = true;
    this.map.attributionControl.addAttribution(this.attribution);
    this.onStatus({ state: 'loading' });
    this.stopLoop = repeatWhileVisible(() => this.refresh(), { intervalMs: CHECK_MS, retryMs: RETRY_MS });
  }

  stop() {
    this.active = false;
    this.token += 1;
    this.stopLoop?.();
    this.map.attributionControl.removeAttribution(this.attribution);
    if (this.layer) this.map.removeLayer(this.layer);
    this.layer = null;
    this.result = null;
  }

  // The chosen time or model changed.
  update() {
    if (!this.active) return;
    this.refresh().catch(() => {});
  }

  async refresh() {
    const token = ++this.token;
    if (!this.result) this.onStatus({ state: 'loading' });
    try {
      const result = await this.service.load(this.entry.id, this.getModel(), this.getTime());
      if (token !== this.token) return;
      if (result !== this.result) {
        this.result = result;
        this.draw();
      }
      const model = this.getModel();
      this.onStatus({
        state: 'ok',
        validTime: result.validTime,
        note: usesFallback(this.entry, model) ? 'Only available from GFS' : null,
        source: sourceFor(this.entry, model).product,
      });
    } catch (error) {
      if (token !== this.token) return;
      const tooFar = /covers this time/.test(error.message);
      this.onStatus({ state: 'error', message: tooFar ? 'This forecast ends sooner. Pick an earlier time.' : CANT_REACH, dataTime: this.result?.validTime });
      throw error;
    }
  }

  draw() {
    const { grid } = this.result;
    if (this.layer) {
      this.layer.setData(grid, grid.values, this.lookup, this.entry.nearest);
      this.layer.redraw();
      return;
    }
    this.layer = new PaintedLayer(grid, grid.values, this.lookup, this.entry.nearest, {
      pane: this.pane,
      opacity: this.opacity,
      updateWhenZooming: false,
      keepBuffer: 1,
    });
    this.layer.addTo(this.map);
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    this.layer?.setOpacity(opacity);
  }

  // NaN where there's no value, or while loading.
  at(lat, lng) {
    if (!this.active || !this.result) return NaN;
    const { grid } = this.result;
    return sampleGrid(grid, grid.values, lat, lng);
  }
}

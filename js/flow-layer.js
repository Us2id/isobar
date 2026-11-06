// Moving lines that follow a vector field: wind, or ocean currents. The lines move through one
// forecast time and are sped up so they can be seen. leaflet-velocity draws them.
import { fromDegrees, sampleGrid } from './grid-math.js';
import { repeatWhileVisible } from './schedule.js';

const CHECK_MS = 15 * 60_000;
const RETRY_MS = 3 * 60_000;
const CANT_REACH = "Can't load this layer. Retrying.";

// leaflet-velocity draws every value it gets, so gaps (land, for currents) become still water.
const withoutGaps = (values) => {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] === values[i] ? values[i] : 0;
  return out;
};

export class FlowLayer {
  constructor(map, service, { fieldId, getModel, getTime, onStatus, pane, attribution, style, thin = 2 }) {
    Object.assign(this, { map, service, fieldId, getModel, getTime, onStatus, pane, attribution, style, thin });
    this.active = false;
    this.layer = null;
    this.result = null;
    this.token = 0;
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
    this.detach();
    this.result = null;
  }

  // The chosen time, model or height changed.
  update(changes = {}) {
    Object.assign(this, changes);
    if (this.active) this.refresh().catch(() => {});
  }

  // Line settings changed. The animation restarts with them.
  setStyle(style) {
    Object.assign(this.style, style);
    if (this.layer) {
      this.detach();
      this.attach();
    }
  }

  async refresh() {
    const token = ++this.token;
    try {
      const result = await this.service.load(this.fieldId, this.getModel(), this.getTime(), this.thin);
      if (token !== this.token) return;
      if (result !== this.result) {
        this.result = result;
        if (this.layer) this.layer.setData(this.velocityData());
        else this.attach();
      }
      this.onStatus({ state: 'ok', validTime: result.validTime, source: result.product });
    } catch (error) {
      if (token !== this.token) return;
      const tooFar = /covers this time/.test(error.message);
      this.onStatus({ state: 'error', message: tooFar ? 'This forecast ends sooner. Pick an earlier time.' : CANT_REACH, dataTime: this.result?.validTime });
      throw error;
    }
  }

  // The layout leaflet-velocity expects, which matches the grib2json tool's output.
  velocityData() {
    const { grid, run, forecastHour } = this.result;
    const header = {
      parameterCategory: 2,
      parameterNumber: 2,
      nx: grid.nx,
      ny: grid.ny,
      lo1: grid.lo1,
      la1: grid.la1,
      lo2: grid.lo1 + (grid.nx - 1) * grid.dx,
      la2: grid.la1 - (grid.ny - 1) * grid.dy,
      dx: grid.dx,
      dy: grid.dy,
      refTime: new Date(run).toISOString(),
      forecastTime: forecastHour,
    };
    return [
      { header, data: withoutGaps(grid.u) },
      { header: { ...header, parameterNumber: 3 }, data: withoutGaps(grid.v) },
    ];
  }

  attach() {
    const { x, y } = this.map.getSize();
    const { density, maxParticles, trail, ...options } = this.style;
    this.layer = L.velocityLayer({
      data: this.velocityData(),
      displayValues: false,
      paneName: this.pane,
      minVelocity: 0,
      particleAge: 60,
      particleMultiplier: Math.min(density, maxParticles / (x * y)),
      ...options,
    });
    // This setting is only read from setOptions, on an object the layer creates once it's on the map.
    const createWindy = this.layer._initWindy;
    this.layer._initWindy = function initWindy(self) {
      createWindy.call(this, self);
      this._windy.setOptions({ opacity: trail });
    };
    this.layer.addTo(this.map);
  }

  detach() {
    if (!this.layer) return;
    const { layer, map } = this;
    const windy = layer._windy;
    const canvas = layer._canvasLayer;
    map.removeLayer(layer);
    // A redraw may still be queued for the next frame, and it would fail on the removed layer.
    if (canvas?._frame) {
      L.Util.cancelAnimFrame(canvas._frame);
      canvas._frame = null;
    }
    // leaflet-velocity 2.1.4 never removes these listeners, and each one keeps a full copy of
    // the grid in memory. Without this, turning a layer off and on leaks tens of MB each time.
    if (windy) {
      map.off('dragstart', windy.stop);
      map.off('zoomstart', windy.stop);
      map.off('dragend', layer._clearAndRestart);
      map.off('zoomend', layer._clearAndRestart);
      map.off('resize', layer._clearWind);
    }
    this.layer = null;
  }

  // Speed in m/s and where it's coming from, for the readout. Null when off or loading.
  at(lat, lng) {
    if (!this.active || !this.result) return null;
    const { grid } = this.result;
    const u = sampleGrid(grid, grid.u, lat, lng);
    const v = sampleGrid(grid, grid.v, lat, lng);
    if (u !== u || v !== v) return null;
    return { speed: Math.hypot(u, v), fromDegrees: fromDegrees(u, v) };
  }
}

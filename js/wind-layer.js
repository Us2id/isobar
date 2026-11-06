// The animated wind. The worker fetches NOAA's forecast, and leaflet-velocity draws lines that
// follow it. The lines move through one hourly forecast and are sped up so they can be seen.
import { WIND } from './config.js';
import { repeatWhileVisible } from './schedule.js';
import { gfsCandidates, windAt } from './wind-grid.js';

const CANT_REACH = "Can't reach NOAA. Retrying.";
const DOWNLOAD_TIMEOUT_MS = 150_000;

export class WindLayer {
  constructor(map, onStatus) {
    this.map = map;
    this.onStatus = onStatus;
    this.active = false;
    this.layer = null;
    this.result = null;
    this.worker = null;
    this.downloading = null;
  }

  start() {
    this.active = true;
    this.map.attributionControl.addAttribution(WIND.attribution);
    this.onStatus(this.result ? { state: 'ok', validTime: this.result.validTime } : { state: 'loading' });
    if (this.result) this.attach();
    this.stopLoop = repeatWhileVisible(() => this.check(), { intervalMs: WIND.checkMs, retryMs: WIND.retryMs });
  }

  stop() {
    this.active = false;
    this.stopLoop?.();
    this.map.attributionControl.removeAttribution(WIND.attribution);
    this.detach();
  }

  // Wind at a map position, for the hover readout. Null when the layer is off or still loading.
  at(lat, lng) {
    return this.active && this.result ? windAt(this.result.grid, lat, lng) : null;
  }

  async check() {
    const wanted = gfsCandidates(Date.now(), 1)[0].validTime;
    if (this.result?.validTime === wanted) return;
    try {
      this.downloading ??= this.download().finally(() => { this.downloading = null; });
      this.result = await this.downloading;
    } catch (error) {
      if (this.active) {
        this.onStatus({ state: 'error', message: CANT_REACH, dataTime: this.result?.validTime });
      }
      throw error;
    }
    if (!this.active) return;
    if (this.layer) this.layer.setData(this.velocityData());
    else this.attach();
    this.onStatus({ state: 'ok', validTime: this.result.validTime });
  }

  download() {
    return new Promise((resolve, reject) => {
      this.worker ??= new Worker(new URL('./wind-worker.js', import.meta.url), { type: 'module' });
      const worker = this.worker;
      const discardWorker = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      const timer = setTimeout(() => {
        discardWorker();
        reject(new Error('Wind download timed out'));
      }, DOWNLOAD_TIMEOUT_MS);
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        if (data.ok) resolve(data);
        else reject(new Error(data.message));
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        discardWorker();
        reject(new Error(event.message || 'Wind worker failed'));
      };
      worker.postMessage('load');
    });
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
      lo2: 360 - grid.dx,
      la2: -90,
      dx: grid.dx,
      dy: grid.dy,
      refTime: new Date(run).toISOString(),
      forecastTime: forecastHour,
    };
    return [
      { header, data: grid.u },
      { header: { ...header, parameterNumber: 3 }, data: grid.v },
    ];
  }

  attach() {
    const { x, y } = this.map.getSize();
    this.layer = L.velocityLayer({
      data: this.velocityData(),
      displayValues: false,
      paneName: WIND.pane,
      minVelocity: 0,
      maxVelocity: WIND.maxSpeedMs,
      colorScale: WIND.colors,
      velocityScale: 0.006,
      // Very large screens would otherwise draw more lines than a typical computer keeps smooth.
      particleMultiplier: Math.min(WIND.particlesPerPixel, WIND.maxParticles / (x * y)),
      particleAge: 60,
      lineWidth: 1,
      frameRate: 25,
    });
    // This setting is only read from setOptions, on an object the layer creates once it's on the map.
    const createWindy = this.layer._initWindy;
    this.layer._initWindy = function initWindy(self) {
      createWindy.call(this, self);
      this._windy.setOptions({ opacity: WIND.trailStrength });
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
    // the wind grid in memory. Without this, turning wind off and on leaks tens of MB each time.
    if (windy) {
      map.off('dragstart', windy.stop);
      map.off('zoomstart', windy.stop);
      map.off('dragend', layer._clearAndRestart);
      map.off('zoomend', layer._clearAndRestart);
      map.off('resize', layer._clearWind);
    }
    this.layer = null;
  }
}

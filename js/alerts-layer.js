// Alerts come from two places. NOAA's alert map shows every active watch and warning, including
// the county-wide ones that have no shape of their own in the alert feed. Fast-moving storm
// warnings are also fetched directly and drawn on top, because they matter most and change fastest.
import { ALERT_MAP, NWS_API, STORM_WARNINGS } from './config.js';
import { repeatWhileVisible } from './schedule.js';
import { WmsLayer } from './wms-layer.js';

const stormUrl = () => {
  const events = Object.keys(STORM_WARNINGS.colors).map(encodeURIComponent).join(',');
  return `${NWS_API}/alerts/active?status=actual&event=${events}`;
};

export const stormNote = (count) => {
  if (count === 0) return 'No storm warnings';
  return count === 1 ? '1 storm warning' : `${count} storm warnings`;
};

export class AlertsLayer {
  constructor(map, onStatus) {
    this.map = map;
    this.onStatus = onStatus;
    this.active = false;
    this.mapLayer = new WmsLayer(map, ALERT_MAP, (status) => {
      const cameIntoCoverage = this.mapStatus.state === 'outside' && status.state !== 'outside';
      this.mapStatus = status;
      this.report();
      // The map may have just moved into coverage, and the next timed check could be a minute away.
      if (cameIntoCoverage && this.stormCount === null) this.loadStorms().catch(() => {});
    });
    this.renderer = L.svg({ pane: 'storms' });
    this.reset();
  }

  reset() {
    this.mapStatus = { state: 'loading' };
    this.stormCount = null;
    this.stormsFailed = false;
    this.checkedAt = null;
    this.drawn = null;
  }

  start() {
    this.active = true;
    this.mapLayer.start();
    this.stopLoop = repeatWhileVisible(() => this.loadStorms(), {
      intervalMs: STORM_WARNINGS.refreshMs,
      retryMs: STORM_WARNINGS.retryMs,
    });
  }

  stop() {
    this.active = false;
    this.stopLoop?.();
    this.mapLayer.stop();
    if (this.drawn) this.map.removeLayer(this.drawn);
    this.reset();
  }

  async loadStorms() {
    if (this.mapStatus.state === 'outside') return;
    try {
      const response = await fetch(stormUrl(), { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Alert feed returned ${response.status}`);
      const { features } = await response.json();
      if (!this.active) return;
      this.draw(features);
      this.stormCount = features.length;
      this.stormsFailed = false;
      this.checkedAt = Date.now();
    } catch (error) {
      if (!this.active) return;
      this.stormsFailed = true;
      this.report();
      throw error;
    }
    this.report();
  }

  draw(features) {
    const shaped = features.filter((feature) => feature.geometry);
    const shared = { renderer: this.renderer, interactive: false };
    const colorOf = (feature) => STORM_WARNINGS.colors[feature.properties.event] ?? '#ffffff';
    const group = L.layerGroup([
      // A dark outline under each shape keeps it readable over any map color.
      L.geoJSON(shaped, { ...shared, style: () => ({ color: '#07101c', weight: 4.5, opacity: 0.85, fill: false }) }),
      L.geoJSON(shaped, {
        ...shared,
        style: (feature) => ({ color: colorOf(feature), weight: 2, opacity: 1, fillColor: colorOf(feature), fillOpacity: 0.22 }),
      }),
    ]);
    if (this.drawn) this.map.removeLayer(this.drawn);
    group.addTo(this.map);
    this.drawn = group;
  }

  report() {
    if (!this.active) return;
    const { mapStatus: status } = this;
    if (status.state === 'outside') this.onStatus(status);
    else if (status.state === 'error') this.onStatus({ state: 'error', message: "Can't load the alert map. Retrying." });
    else if (this.stormsFailed) this.onStatus({ state: 'error', message: "Can't load storm warnings. Retrying." });
    else if (status.state === 'loading' || this.stormCount === null) this.onStatus({ state: 'loading' });
    else this.onStatus({ state: 'ok', checkedAt: Math.min(this.checkedAt, status.checkedAt), note: stormNote(this.stormCount) });
  }
}

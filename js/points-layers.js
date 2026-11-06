// Layers of things at places: tropical cyclones, airport weather reports and natural events.
import { el } from './dom.js';
import { boxTouchesView } from './geo.js';
import { repeatWhileVisible } from './schedule.js';
import { describeWind, formatValue } from './units.js';

const viewOf = (map) => {
  const bounds = map.getBounds();
  return { west: bounds.getWest(), east: bounds.getEast(), south: bounds.getSouth(), north: bounds.getNorth() };
};

// ---- Tropical cyclones, from GDACS ----
const GDACS_LIST = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red&pageSize=30';
const SWATH_COLORS = { Poly_Green: '#7fd35a', Poly_Orange: '#f7963b', Poly_Red: '#e0342b' };

export class CycloneLayer {
  constructor(map, { onStatus, onStorms, pane, attribution }) {
    Object.assign(this, { map, onStatus, onStorms, pane, attribution });
    this.group = null;
    this.storms = [];
  }

  start() {
    this.active = true;
    this.map.attributionControl.addAttribution(this.attribution);
    this.onStatus({ state: 'loading' });
    this.stopLoop = repeatWhileVisible(() => this.refresh(), { intervalMs: 30 * 60_000, retryMs: 5 * 60_000 });
  }

  stop() {
    this.active = false;
    this.stopLoop?.();
    this.map.attributionControl.removeAttribution(this.attribution);
    if (this.group) this.map.removeLayer(this.group);
    this.group = null;
    this.onStorms([]);
  }

  async refresh() {
    try {
      const response = await fetch(GDACS_LIST, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`GDACS returned ${response.status}`);
      const { features = [] } = await response.json();
      const current = features.filter((feature) => String(feature.properties.iscurrent).toLowerCase() === 'true');
      // GDACS guards its shapes with a bot check that some browsers, Safari among them, can't pass
      // from a page. The storms still show then, just without their tracks.
      const paths = await Promise.all(current.map((storm) => fetch(storm.properties.url.geometry, { signal: AbortSignal.timeout(30_000) })
        .then((reply) => (reply.ok ? reply.json() : null))
        .catch(() => null)));
      if (!this.active) return;
      this.draw(current, paths.map((path) => path ?? { features: [] }));
      const count = current.length;
      const noTracks = count > 0 && paths.every((path) => path === null);
      this.onStatus({
        state: 'ok',
        checkedAt: Date.now(),
        note: `${count === 0 ? 'No active cyclones' : count === 1 ? '1 active cyclone' : `${count} active cyclones`}${noTracks ? ', tracks unavailable here' : ''}`,
      });
    } catch (error) {
      if (this.active) this.onStatus({ state: 'error', message: "Can't reach GDACS. Retrying." });
      throw error;
    }
  }

  // One storm's position, popup, wind areas and track, in plain terms.
  describe(storm, path) {
    const { name, alertlevel: level, severitydata: severity, country } = storm.properties;
    const [lng, lat] = storm.geometry.coordinates;
    const swaths = [];
    const tracks = [];
    for (const part of path.features ?? []) {
      const { Class: kind, polygonlabel: label, forecast } = part.properties;
      const type = part.geometry?.type;
      // GDACS also sends one shape per forecast time. The overall wind swaths are clearer.
      if ((type === 'Polygon' || type === 'MultiPolygon') && SWATH_COLORS[kind] && /km\/h$/.test(label ?? '')) {
        swaths.push({ part, color: SWATH_COLORS[kind] });
      } else if (type === 'LineString' && /^Line_/.test(kind ?? '')) {
        tracks.push({ part, ahead: String(forecast).toLowerCase() === 'true' });
      }
    }
    const popup = () => el('div', { class: 'map-popup' },
      el('strong', { text: name }),
      el('p', { text: severity?.severitytext ?? 'Tropical cyclone' }),
      country ? el('p', { text: `Near ${country}` }) : null,
      el('p', { class: 'popup-note', text: 'The line is its track, dashed where forecast. Shading shows wind of 60, 90 and 120 km/h. From GDACS.' }),
    );
    return { name, lat, lng, level: String(level).toLowerCase(), popup, swaths, tracks };
  }

  draw(storms, paths) {
    const described = storms.map((storm, index) => this.describe(storm, paths[index]));
    this.renderer ??= L.svg({ pane: this.pane });
    const layers = [];
    for (const { name, lat, lng, level, popup, swaths, tracks } of described) {
      for (const { part, color } of swaths) {
        layers.push(L.geoJSON(part, { renderer: this.renderer, interactive: false, style: () => ({ color, weight: 1, opacity: 0.8, fillColor: color, fillOpacity: 0.16 }) }));
      }
      for (const { part, ahead } of tracks) {
        layers.push(L.geoJSON(part, { renderer: this.renderer, interactive: false, style: () => ({ color: '#ffffff', weight: 1.6, opacity: 0.9, dashArray: ahead ? '4 5' : null }) }));
      }
      layers.push(L.marker([lat, lng], {
        pane: this.pane,
        icon: L.divIcon({ className: `cyclone-mark cyclone-${level}`, iconSize: [26, 26] }),
        title: name,
      }).bindPopup(popup));
    }
    const next = L.layerGroup(layers).addTo(this.map);
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
    this.reportStorms(described);
  }

  reportStorms(described) {
    this.storms = described.map(({ name, lat, lng }) => ({ name, lat, lng }));
    this.onStorms(this.storms);
  }
}

// ---- Airport weather reports, from Iowa Environmental Mesonet ----
const IEM = 'https://mesonet.agron.iastate.edu';
const MIN_ZOOM = 4;
const MAX_NETWORKS = 8;

export function flightCategory(props) {
  const visibility = props.vsby;
  const ceilings = [1, 2, 3, 4]
    .filter((n) => ['BKN', 'OVC', 'VV'].includes(props[`skyc${n}`]))
    .map((n) => props[`skyl${n}`])
    .filter((height) => height != null);
  const ceiling = ceilings.length ? Math.min(...ceilings) : Infinity;
  if ((visibility != null && visibility < 1) || ceiling < 500) return 'LIFR';
  if ((visibility != null && visibility < 3) || ceiling < 1000) return 'IFR';
  if ((visibility != null && visibility <= 5) || ceiling <= 3000) return 'MVFR';
  return 'VFR';
}

const CATEGORY_COLORS = { VFR: '#3fd06a', MVFR: '#4f9dff', IFR: '#ff5c5c', LIFR: '#ff5cf0' };
const fToC = (f) => ((f - 32) * 5) / 9;
const knotsToMs = (knots) => knots * 0.514444;

export class AirportLayer {
  constructor(map, { onStatus, pane, attribution, getSystem, onForecast }) {
    Object.assign(this, { map, onStatus, pane, attribution, getSystem, onForecast });
    this.group = null;
    this.networks = null;
    this.loaded = new Map();
    this.refreshSoon = this.refreshSoon.bind(this);
  }

  start() {
    this.active = true;
    this.map.attributionControl.addAttribution(this.attribution);
    this.map.on('moveend', this.refreshSoon);
    this.onStatus({ state: 'loading' });
    this.stopLoop = repeatWhileVisible(() => this.refresh(), { intervalMs: 10 * 60_000, retryMs: 3 * 60_000 });
  }

  stop() {
    this.active = false;
    this.stopLoop?.();
    this.map.off('moveend', this.refreshSoon);
    this.map.attributionControl.removeAttribution(this.attribution);
    clearTimeout(this.timer);
    if (this.group) this.map.removeLayer(this.group);
    this.group = null;
    this.loaded.clear();
  }

  refreshSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh().catch(() => {}), 500);
  }

  async ensureNetworks() {
    if (this.networks) return;
    const response = await fetch(`${IEM}/geojson/networks.geojson`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`IEM returned ${response.status}`);
    const { features } = await response.json();
    this.networks = features.filter((feature) => /_ASOS$/.test(feature.id) && feature.geometry).map((feature) => {
      const ring = feature.geometry.coordinates[0];
      const lngs = ring.map((point) => point[0]);
      const lats = ring.map((point) => point[1]);
      return { id: feature.id, box: { west: Math.min(...lngs), east: Math.max(...lngs), south: Math.min(...lats), north: Math.max(...lats) } };
    });
  }

  async refresh() {
    if (!this.active) return;
    try {
      await this.ensureNetworks();
      if (this.map.getZoom() < MIN_ZOOM) {
        this.onStatus({ state: 'outside', message: 'Zoom in to see airports.' });
        return;
      }
      const view = viewOf(this.map);
      const visible = this.networks.filter((network) => boxTouchesView(network.box, view));
      if (visible.length > MAX_NETWORKS * 4) {
        this.onStatus({ state: 'outside', message: 'Zoom in to see airports.' });
        return;
      }
      const stale = Date.now() - 10 * 60_000;
      const wanted = visible.filter((network) => (this.loaded.get(network.id)?.at ?? 0) < stale).slice(0, MAX_NETWORKS);
      await Promise.all(wanted.map(async (network) => {
        const response = await fetch(`${IEM}/api/1/currents.geojson?network=${network.id}`, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`IEM returned ${response.status}`);
        const { features = [] } = await response.json();
        this.loaded.set(network.id, { at: Date.now(), features });
      }));
      if (!this.active) return;
      this.draw(visible);
      const missing = visible.some((network) => !this.loaded.has(network.id));
      if (missing) this.refreshSoon();
      this.onStatus({ state: 'ok', checkedAt: Date.now() });
    } catch (error) {
      if (this.active) this.onStatus({ state: 'error', message: "Can't reach the airport feed. Retrying." });
      throw error;
    }
  }

  // The stations with a report in these networks.
  stationsIn(networks) {
    const stations = [];
    for (const network of networks) {
      for (const feature of this.loaded.get(network.id)?.features ?? []) {
        if (!feature.geometry || feature.properties.tmpf == null) continue;
        const [lng, lat] = feature.geometry.coordinates;
        const category = flightCategory(feature.properties);
        stations.push({ lat, lng, props: feature.properties, category, color: CATEGORY_COLORS[category] });
      }
    }
    return stations;
  }

  draw(networks) {
    this.renderer ??= L.canvas({ pane: this.pane, padding: 0.2 });
    const markers = this.stationsIn(networks).map(({ lat, lng, props, category, color }) => {
      const marker = L.circleMarker([lat, lng], {
        renderer: this.renderer,
        radius: 4.5,
        color: '#07101c',
        weight: 1,
        fillColor: color,
        fillOpacity: 1,
      });
      marker.bindPopup(() => this.popup(props, category, lat, lng), { pane: 'popupPane' });
      return marker;
    });
    const next = L.layerGroup(markers).addTo(this.map);
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
  }

  popup(props, category, lat, lng) {
    const system = this.getSystem();
    const row = (label, value) => (value == null ? null : el('div', { class: 'popup-row' }, el('span', { text: label }), el('span', { text: value })));
    const when = props.utc_valid ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(props.utc_valid)) : null;
    return el('div', { class: 'map-popup' },
      el('strong', { text: `${props.name ?? props.station} (${props.station})` }),
      row('Flight rules', category),
      row('Temperature', props.tmpf == null ? null : formatValue(fToC(props.tmpf), 'temp', system)),
      row('Dew point', props.dwpf == null ? null : formatValue(fToC(props.dwpf), 'temp', system)),
      row('Humidity', props.relh == null ? null : `${Math.round(props.relh)}%`),
      row('Wind', props.sknt == null ? null : describeWind(knotsToMs(props.sknt), props.drct, system).replace(/^Wind /, '')),
      row('Visibility', props.vsby == null ? null : formatValue(props.vsby * 1.60934, 'distance', system)),
      row('Altimeter', props.alti == null ? null : formatValue(props.alti * 33.8639, 'pressure', system)),
      row('Reported', when),
      props.raw ? el('p', { class: 'popup-raw', text: props.raw }) : null,
      el('button', { type: 'button', class: 'text-button', text: 'Open forecast here', onClick: () => this.onForecast({ lat, lng }) }),
    );
  }
}

// ---- Natural events, from NASA EONET ----
const EONET = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=500';
const EVENT_COLORS = { wildfires: '#ff6a2b', volcanoes: '#ff3b3b', severeStorms: '#c77dff', floods: '#4f9dff', seaLakeIce: '#cfe6ff', earthquakes: '#ffd84a', landslides: '#b98a46', drought: '#d9b36a', dustHaze: '#d9c27a', manmade: '#ffffff', snow: '#ffffff', tempExtremes: '#ff9c8f', waterColor: '#3fd0c0' };

export class EventLayer {
  constructor(map, { onStatus, pane, attribution }) {
    Object.assign(this, { map, onStatus, pane, attribution });
    this.group = null;
  }

  start() {
    this.active = true;
    this.map.attributionControl.addAttribution(this.attribution);
    this.onStatus({ state: 'loading' });
    this.stopLoop = repeatWhileVisible(() => this.refresh(), { intervalMs: 60 * 60_000, retryMs: 5 * 60_000 });
  }

  stop() {
    this.active = false;
    this.stopLoop?.();
    this.map.attributionControl.removeAttribution(this.attribution);
    if (this.group) this.map.removeLayer(this.group);
    this.group = null;
  }

  async refresh() {
    try {
      const response = await fetch(EONET, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`NASA returned ${response.status}`);
      const { events = [] } = await response.json();
      if (!this.active) return;
      this.draw(this.pointsFrom(events));
      this.onStatus({ state: 'ok', checkedAt: Date.now(), note: `${events.length} open events` });
    } catch (error) {
      if (this.active) this.onStatus({ state: 'error', message: "Can't reach NASA EONET. Retrying." });
      throw error;
    }
  }

  // Each event's newest position, color and popup.
  pointsFrom(events) {
    const points = [];
    for (const event of events) {
      const latest = event.geometry?.at(-1);
      if (!latest) continue;
      const point = latest.type === 'Point' ? latest.coordinates : latest.coordinates?.[0]?.[0];
      if (!point) continue;
      const category = event.categories?.[0];
      points.push({
        lat: point[1],
        lng: point[0],
        color: EVENT_COLORS[category?.id] ?? '#ffffff',
        popup: () => el('div', { class: 'map-popup' },
          el('strong', { text: event.title }),
          el('p', { text: category?.title ?? 'Natural event' }),
          el('p', { class: 'popup-note', text: `Last update ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(latest.date))}. From NASA EONET.` }),
        ),
      });
    }
    return points;
  }

  draw(points) {
    this.renderer ??= L.canvas({ pane: this.pane, padding: 0.2 });
    const markers = points.map(({ lat, lng, color, popup }) => L.circleMarker([lat, lng], {
      renderer: this.renderer,
      radius: 5,
      color: '#07101c',
      weight: 1,
      fillColor: color,
      fillOpacity: 0.95,
    }).bindPopup(popup));
    const next = L.layerGroup(markers).addTo(this.map);
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
  }
}

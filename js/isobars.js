// Lines of equal pressure with H and L marks, drawn from the forecast pressure field.
import { repeatWhileVisible } from './schedule.js';

const INTERVAL_HPA = 4;
const THIN = 4; // 1° is plenty for smooth lines, and far quicker to trace
const CHECK_MS = 15 * 60_000;
const RETRY_MS = 3 * 60_000;

// Marching squares: for one contour level, the line pieces crossing each grid cell.
export function contourSegments(grid, values, level) {
  const { nx, ny, dx, dy, la1, lo1 } = grid;
  const segments = [];
  const at = (j, i) => values[j * nx + i];
  const lngOf = (i) => {
    const lng = lo1 + i * dx;
    return lng > 180 ? lng - 360 : lng;
  };
  const between = (a, b) => (level - a) / (b - a);
  for (let j = 0; j < ny - 1; j++) {
    const lat0 = la1 - j * dy;
    const lat1 = lat0 - dy;
    for (let i = 0; i < nx; i++) {
      const next = (i + 1) % nx;
      const a = at(j, i);
      const b = at(j, next);
      const c = at(j + 1, next);
      const d = at(j + 1, i);
      if (a !== a || b !== b || c !== c || d !== d) continue;
      const lng0 = lngOf(i);
      const lng1 = lng0 + dx;
      const crossings = [];
      if ((a < level) !== (b < level)) crossings.push([lat0, lng0 + between(a, b) * dx]);
      if ((b < level) !== (c < level)) crossings.push([lat0 - between(b, c) * dy, lng1]);
      if ((d < level) !== (c < level)) crossings.push([lat1, lng0 + between(d, c) * dx]);
      if ((a < level) !== (d < level)) crossings.push([lat0 - between(a, d) * dy, lng0]);
      if (crossings.length === 2) segments.push(crossings);
      else if (crossings.length === 4) segments.push([crossings[0], crossings[1]], [crossings[2], crossings[3]]);
    }
  }
  return segments;
}

// The strongest highs and lows: grid points that top every neighbour within `radius` cells.
export function pressureCenters(grid, values, radius = 8) {
  const { nx, ny, dx, dy, la1, lo1 } = grid;
  const centers = [];
  for (let j = radius; j < ny - radius; j++) {
    for (let i = 0; i < nx; i++) {
      const value = values[j * nx + i];
      if (value !== value) continue;
      let highest = true;
      let lowest = true;
      for (let b = -radius; b <= radius && (highest || lowest); b++) {
        for (let a = -radius; a <= radius; a++) {
          if (a === 0 && b === 0) continue;
          const other = values[(j + b) * nx + ((i + a + nx) % nx)];
          if (other >= value) highest = false;
          if (other <= value) lowest = false;
        }
      }
      const lat = la1 - j * dy;
      const lngRaw = lo1 + i * dx;
      const lng = lngRaw > 180 ? lngRaw - 360 : lngRaw;
      if (highest && value >= 1016) centers.push({ lat, lng, value, kind: 'H' });
      if (lowest && value <= 1008) centers.push({ lat, lng, value, kind: 'L' });
    }
  }
  return centers;
}

export class IsobarLayer {
  constructor(map, service, { getModel, getTime, onStatus, pane, attribution }) {
    Object.assign(this, { map, service, getModel, getTime, onStatus, pane, attribution });
    this.group = null;
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
    if (this.group) this.map.removeLayer(this.group);
    this.group = null;
    this.result = null;
  }

  update() {
    if (this.active) this.refresh().catch(() => {});
  }

  async refresh() {
    const token = ++this.token;
    try {
      const result = await this.service.load('mslp', this.getModel(), this.getTime(), THIN);
      if (token !== this.token) return;
      if (result !== this.result) {
        this.result = result;
        this.draw();
      }
      this.onStatus({ state: 'ok', validTime: result.validTime, source: result.product });
    } catch (error) {
      if (token !== this.token) return;
      this.onStatus({ state: 'error', message: "Can't load pressure data. Retrying.", dataTime: this.result?.validTime });
      throw error;
    }
  }

  // The pressure lines and marks for the current field, in plain numbers.
  shapes() {
    const { grid } = this.result;
    const { values } = grid;
    let low = Infinity;
    let high = -Infinity;
    for (const value of values) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
    const lines = [];
    for (let level = Math.ceil(low / INTERVAL_HPA) * INTERVAL_HPA; level <= high; level += INTERVAL_HPA) {
      const segments = contourSegments(grid, values, level);
      if (segments.length > 0) lines.push({ major: level % 20 === 0, segments });
    }
    return { lines, centers: pressureCenters(grid, values) };
  }

  draw() {
    const { lines, centers } = this.shapes();
    this.renderer ??= L.canvas({ pane: this.pane, padding: 0.3 });
    const layers = [];
    const shifted = (segments, by) => segments.map((segment) => segment.map(([lat, lng]) => [lat, lng + by]));
    for (const { major, segments } of lines) {
      for (const by of [-360, 0, 360]) {
        layers.push(L.polyline(shifted(segments, by), {
          renderer: this.renderer,
          interactive: false,
          color: major ? '#ffffff' : '#dbe7f0',
          opacity: major ? 0.8 : 0.5,
          weight: major ? 1.4 : 0.8,
          smoothFactor: 1,
        }));
      }
    }
    for (const center of centers) {
      layers.push(L.marker([center.lat, center.lng], {
        pane: this.pane,
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: `pressure-mark pressure-${center.kind}`,
          html: `<b>${center.kind}</b><span>${Math.round(center.value)}</span>`,
          iconSize: [44, 36],
        }),
      }));
    }
    const next = L.layerGroup(layers).addTo(this.map);
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
  }
}

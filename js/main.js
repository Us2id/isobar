import { AlertsLayer } from './alerts-layer.js';
import { addBasemap } from './basemap.js';
import { LEGENDS, LIGHTNING, OPENING_BOUNDS, PANE_ORDER, RADAR, SATELLITE, WIND } from './config.js';
import { el } from './dom.js';
import { describeStatus } from './status.js';
import { load, save } from './store.js';
import { ForecastStrip } from './strip.js';
import { defaultSystem, describeWind, fullSpeed, SYSTEMS } from './units.js';
import { wrapLongitude } from './geo.js';
import { WindLayer } from './wind-layer.js';
import { WmsLayer } from './wms-layer.js';

const STATUS_TICK_MS = 30_000;
const byId = (id) => document.getElementById(id);

// Map
const map = L.map('map', {
  zoomControl: false,
  minZoom: 2,
  maxZoom: 11,
  worldCopyJump: true,
});
map.fitBounds(OPENING_BOUNDS, { animate: false });
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
L.control.zoom({ position: 'bottomright' }).addTo(map);
PANE_ORDER.forEach((name, index) => {
  const pane = map.createPane(name);
  pane.style.zIndex = 300 + index * 10;
  pane.style.pointerEvents = 'none';
});

const notice = byId('notice');
addBasemap(map, {
  onUnavailable: () => {
    notice.textContent = "The base map didn't fully load. Weather layers still work.";
    notice.hidden = false;
  },
  onLoaded: () => { notice.hidden = true; },
});

// Preferences
const savedUnits = load('units');
let system = SYSTEMS[savedUnits] ? savedUnits : defaultSystem(navigator.language);
const prefersStillness = matchMedia('(prefers-reduced-motion: reduce)').matches;
const savedLayers = load('layers');
const enabled = new Set(Array.isArray(savedLayers) ? savedLayers : prefersStillness ? ['radar'] : ['wind', 'radar']);

// Layers
const rows = new Map();
const statuses = new Map();

const renderStatus = (id) => {
  const row = rows.get(id);
  if (!enabled.has(id)) {
    row.status.textContent = '';
    row.status.className = 'layer-status';
    return;
  }
  const { text, tone } = describeStatus(statuses.get(id));
  row.status.textContent = text;
  row.status.className = `layer-status tone-${tone}`;
};

const statusListener = (id) => (status) => {
  statuses.set(id, status);
  renderStatus(id);
};

const windController = new WindLayer(map, statusListener('wind'));
const definitions = [
  { id: 'wind', name: 'Wind flow', controller: windController },
  { id: 'radar', name: 'Radar', controller: new WmsLayer(map, RADAR, statusListener('radar')) },
  { id: 'lightning', name: 'Lightning', controller: new WmsLayer(map, LIGHTNING, statusListener('lightning')) },
  { id: 'satellite', name: 'Satellite', controller: new WmsLayer(map, SATELLITE, statusListener('satellite')) },
  { id: 'alerts', name: 'Alerts', controller: new AlertsLayer(map, statusListener('alerts')) },
];

const legendFor = (id) => {
  if (id === 'wind') {
    return { stops: WIND.colors, low: 'Calm', high: `${fullSpeed(WIND.maxSpeedMs, system)}+` };
  }
  return LEGENDS[id];
};

const renderLegend = (id) => {
  const { legend } = rows.get(id);
  const { stops, low, high, note } = legendFor(id);
  if (note) {
    legend.replaceChildren(el('span', { class: 'legend-note', text: note }));
    return;
  }
  const bar = el('span', { class: 'legend-bar' });
  bar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
  legend.replaceChildren(bar, el('span', { class: 'legend-ends' }, el('span', { text: low }), el('span', { text: high })));
};

const setLayer = (id, on) => {
  const row = rows.get(id);
  const definition = definitions.find((item) => item.id === id);
  row.button.setAttribute('aria-pressed', String(on));
  if (on) {
    enabled.add(id);
    definition.controller.start();
  } else {
    enabled.delete(id);
    definition.controller.stop();
  }
  renderStatus(id);
  if (id === 'wind' && !on) readout.hidden = true;
  save('layers', [...enabled]);
};

const list = byId('layer-list');
for (const { id, name } of definitions) {
  const status = el('span', { class: 'layer-status' });
  const legend = el('span', { class: 'legend' });
  const button = el('button', {
    type: 'button',
    class: 'layer-toggle',
    'aria-pressed': 'false',
    onClick: () => setLayer(id, button.getAttribute('aria-pressed') !== 'true'),
  },
    el('span', { class: 'lamp', 'aria-hidden': 'true' }),
    el('span', { class: 'layer-name', text: name }),
    status,
    legend,
  );
  list.append(el('li', { class: 'layer-item' }, button));
  rows.set(id, { button, status, legend });
  renderLegend(id);
}

// Keep the "2 min old" labels moving between data updates.
setInterval(() => {
  if (!document.hidden) rows.forEach((_, id) => renderStatus(id));
}, STATUS_TICK_MS);

// Forecast strip
let spot = null;
let followSpot = false;
const hint = byId('hint');
map.on('dragstart', () => { followSpot = false; });

const keepSpotInView = () => {
  if (!spot || !followSpot) return;
  const stripHeight = byId('strip').offsetHeight;
  const railHeight = matchMedia('(max-width: 640px)').matches ? byId('rail').offsetHeight : 0;
  map.panInside(spot.getLatLng(), {
    paddingTopLeft: [20, railHeight + 20],
    paddingBottomRight: [20, stripHeight + 24],
  });
};

const strip = new ForecastStrip(byId('strip'), {
  getSystem: () => system,
  onOpened: keepSpotInView,
  onClosed: () => {
    if (spot) map.removeLayer(spot);
    spot = null;
    map.getContainer().focus({ preventScroll: true });
  },
});

const openForecast = (latlng) => {
  const point = { lat: latlng.lat, lng: wrapLongitude(latlng.lng) };
  if (spot) spot.setLatLng(latlng);
  else {
    spot = L.marker(latlng, {
      icon: L.divIcon({ className: 'spot-marker', iconSize: [24, 24] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
  }
  followSpot = true;
  hint.hidden = true;
  save('hintDismissed', true);
  strip.open(point);
};

map.on('click', (event) => openForecast(event.latlng));
// Keyboard users can pan with the arrow keys and press Enter for the spot at the map's center.
map.on('keypress', ({ originalEvent }) => {
  if (originalEvent.key === 'Enter' && document.activeElement === map.getContainer()) openForecast(map.getCenter());
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && strip.isOpen && !byId('about').open) strip.close();
});
hint.hidden = load('hintDismissed', false);

// Wind readout under the pointer
const readout = byId('readout');
let readoutQueued = null;
// A tap also sends a mouse event, which would leave a stale reading on phones.
if (matchMedia('(hover: hover)').matches) {
  map.on('mousemove', ({ latlng }) => {
    if (readoutQueued === null) requestAnimationFrame(() => {
      const wind = windController.at(readoutQueued.lat, readoutQueued.lng);
      readoutQueued = null;
      readout.hidden = !wind;
      if (wind) readout.textContent = describeWind(wind.speed, wind.fromDegrees, system);
    });
    readoutQueued = latlng;
  });
  map.on('mouseout', () => { readout.hidden = true; });
}

// Units
const unitButtons = [...document.querySelectorAll('[data-units]')];
const applyUnits = () => {
  for (const button of unitButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.units === system));
    button.textContent = `°${SYSTEMS[button.dataset.units].tempUnit}`;
  }
  rows.forEach((_, id) => renderLegend(id));
  strip.refresh();
};
for (const button of unitButtons) {
  button.addEventListener('click', () => {
    system = button.dataset.units;
    save('units', system);
    applyUnits();
  });
}
applyUnits();

// About
byId('about-open').addEventListener('click', () => byId('about').showModal());
byId('about-close').addEventListener('click', () => byId('about').close());

// Start whatever was on last time.
const remembered = new Set(enabled);
enabled.clear();
for (const { id } of definitions) {
  if (remembered.has(id)) setLayer(id, true);
}

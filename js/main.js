import { AlertsLayer } from './alerts-layer.js';
import { addBasemap, canDrawBasemap } from './basemap.js';
import { FIELDS, FLOW_LEVELS } from './catalog/fields.js';
import { IMAGERY } from './catalog/imagery.js';
import {
  CURRENTS, FIELD_GROUPS, LEGENDS, LIGHTNING, MODELS, openingView, PANE_ORDER, RADAR, radarProductConfig, SATELLITE, WIND, wmsImageConfig,
} from './config.js';
import { el } from './dom.js';
import { FieldLayer } from './field-layer.js';
import { FlowLayer } from './flow-layer.js';
import { wrapLongitude } from './geo.js';
import { GlobeMap } from './globe.js';
import { fitGlobeZoom } from './globe-helpers.js';
import {
  GlobeAirportLayer, GlobeAlertsLayer, GlobeArcgisLayer, GlobeCycloneLayer, GlobeEventLayer, GlobeFieldLayer, GlobeFlowLayer,
  GlobeGibsLayer, GlobeIsobarLayer, GlobeRainViewerLayer, GlobeWmsLayer,
} from './globe-layers.js';
import { GridService } from './grid-service.js';
import { ArcgisLayer, GibsLayer, RainViewerLayer } from './image-layers.js';
import { IsobarLayer } from './isobars.js';
import { Panel } from './panel.js';
import { AirportLayer, CycloneLayer, EventLayer } from './points-layers.js';
import { PlaceSearch } from './search.js';
import { load, save } from './store.js';
import { ForecastStrip } from './strip.js';
import { Timeline } from './timeline.js';
import { defaultSystem, describeWind, formatValue, fullSpeed, SYSTEMS } from './units.js';
import { WmsLayer } from './wms-layer.js';

const STATUS_TICK_MS = 30_000;
const DEFAULT_FILL_OPACITY = 0.72;
const byId = (id) => document.getElementById(id);

// ---- Map ----
const map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 11, worldCopyJump: true });
const opening = openingView(Intl.DateTimeFormat().resolvedOptions().timeZone, -new Date().getTimezoneOffset());
if (opening.bounds) map.fitBounds(opening.bounds, { animate: false });
else map.setView(opening.center, opening.zoom, { animate: false });
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
L.control.zoom({ position: 'bottomright' }).addTo(map);
PANE_ORDER.forEach((name, index) => {
  const pane = map.createPane(name);
  pane.style.zIndex = 300 + index * 5;
  pane.style.pointerEvents = name === 'clickable' ? 'auto' : 'none';
});

// Keeps the time bar and legend clear of the map credits, which grow with the layers that are on.
// Whichever kind of map is showing owns the credits, and the hidden one measures zero.
const creditWatcher = new ResizeObserver(([{ target }]) => {
  if (target.offsetHeight > 0) document.documentElement.style.setProperty('--credit-height', `${target.offsetHeight}px`);
});
creditWatcher.observe(map.attributionControl.getContainer());

const notice = byId('notice');
const baseMapMessages = {
  onUnavailable: () => {
    notice.textContent = "The base map didn't fully load. Weather layers still work.";
    notice.hidden = false;
  },
  onSlow: () => {
    notice.textContent = 'The base map is slow to load. Weather layers still work.';
    notice.hidden = false;
  },
  onLoaded: () => { notice.hidden = true; },
};
let flatBasemap = null;
const startFlatBasemap = () => { flatBasemap = addBasemap(map, { labelsPane: 'labels', ...baseMapMessages }); };

// ---- Preferences ----
const savedUnits = load('units');
let system = SYSTEMS[savedUnits] ? savedUnits : defaultSystem(navigator.language);
const savedModel = load('model');
let model = MODELS.some((item) => item.id === savedModel) ? savedModel : 'gfs';
const prefersStillness = matchMedia('(prefers-reduced-motion: reduce)').matches;
const savedLayers = load('layers');
const enabled = new Set(Array.isArray(savedLayers) ? savedLayers : prefersStillness ? [opening.radar] : ['wind', opening.radar]);
const windStyle = { ...WIND.style, ...(load('windStyle') ?? {}) };
let windLevel = load('windLevel') ?? 'flow10';
if (!FLOW_LEVELS.some((level) => level.id === windLevel)) windLevel = 'flow10';
let fillOpacity = load('fillOpacity') ?? DEFAULT_FILL_OPACITY;

// ---- Time ----
const service = new GridService();
let fill = null;
let fillId = null;
const timeline = new Timeline(byId('timeline'), {
  onChange: () => updateTimedLayers(),
  isBusy: () => service.inFlight.size > 0,
});
const getTime = () => timeline.time();
const getModel = () => model;

// ---- Overlays ----
let panel = null;
const statusFor = (id) => (status) => panel?.setStatus(id, status);
const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

const stormBox = el('div', { class: 'storm-list' });
const showStorms = (storms) => {
  stormBox.replaceChildren(...storms.map((storm) => el('button', {
    type: 'button',
    class: 'text-button',
    text: storm.name,
    onClick: () => {
      view.goTo(storm.lat, storm.lng, 5);
      panel.closeOnPhone();
    },
  })));
};

const windExtras = () => {
  const level = el('select', {
    'aria-label': 'Height of the wind lines',
    onChange: (event) => {
      windLevel = event.target.value;
      save('windLevel', windLevel);
      controllers.wind.update({ fieldId: windLevel });
    },
  }, ...FLOW_LEVELS.map(({ id, name }) => el('option', { value: id, text: name })));
  level.value = windLevel;
  const slider = (label, key, min, max, fromStyle, toStyle) => {
    const input = el('input', {
      type: 'range',
      min,
      max,
      step: 1,
      value: String(fromStyle(windStyle[key])),
      'aria-label': label,
      onChange: (event) => {
        windStyle[key] = toStyle(Number(event.target.value));
        save('windStyle', windStyle);
        controllers.wind.setStyle({ [key]: windStyle[key] });
      },
    });
    return el('label', { class: 'mini-control' }, el('span', { text: label }), input);
  };
  return el('details', {},
    el('summary', { text: 'Wind settings' }),
    el('label', { class: 'mini-control' }, el('span', { text: 'Height' }), level),
    slider('Line speed', 'velocityScale', 2, 20, (x) => x * 1000, (x) => x / 1000),
    slider('Line count', 'density', 2, 12, (x) => Math.round(x * 1000), (x) => x / 1000),
    slider('Trail length', 'trail', 88, 98, (x) => x * 100, (x) => x / 100),
  );
};

const radarLoopButton = el('button', {
  type: 'button',
  class: 'text-button',
  text: 'Play the last 2 hours',
  onClick: () => (controllers.worldradar.isPlaying ? controllers.worldradar.stopLoopPlayback() : controllers.worldradar.playLoop()),
});

// The same layers draw on the flat map or the globe. These are the classes for each.
const FLAT_LAYERS = {
  AirportLayer, AlertsLayer, ArcgisLayer, CycloneLayer, EventLayer, FieldLayer, FlowLayer, GibsLayer, IsobarLayer, RainViewerLayer, WmsLayer,
};
const GLOBE_LAYERS = {
  AirportLayer: GlobeAirportLayer,
  AlertsLayer: GlobeAlertsLayer,
  ArcgisLayer: GlobeArcgisLayer,
  CycloneLayer: GlobeCycloneLayer,
  EventLayer: GlobeEventLayer,
  FieldLayer: GlobeFieldLayer,
  FlowLayer: GlobeFlowLayer,
  GibsLayer: GlobeGibsLayer,
  IsobarLayer: GlobeIsobarLayer,
  RainViewerLayer: GlobeRainViewerLayer,
  WmsLayer: GlobeWmsLayer,
};

function makeControllers(target, kinds) {
  return {
    wind: new kinds.FlowLayer(target, service, { fieldId: windLevel, getModel, getTime, onStatus: statusFor('wind'), pane: 'wind', attribution: WIND.attribution, style: windStyle }),
    radar: new kinds.WmsLayer(target, RADAR, statusFor('radar')),
    worldradar: new kinds.RainViewerLayer(target, {
      onStatus: statusFor('worldradar'),
      onLoopChange: (playing) => { radarLoopButton.textContent = playing ? 'Stop the loop' : 'Play the last 2 hours'; },
      pane: 'worldradar',
      opacity: 0.85,
      attribution: link('https://www.rainviewer.com/', 'Weather data by RainViewer'),
    }),
    lightning: new kinds.WmsLayer(target, LIGHTNING, statusFor('lightning')),
    satellite: new kinds.WmsLayer(target, SATELLITE, statusFor('satellite')),
    alerts: new kinds.AlertsLayer(target, statusFor('alerts')),
    cyclones: new kinds.CycloneLayer(target, { onStatus: statusFor('cyclones'), onStorms: showStorms, pane: 'clickable', attribution: `Cyclones: ${link('https://www.gdacs.org/', 'GDACS')}` }),
    isobars: new kinds.IsobarLayer(target, service, { getModel, getTime, onStatus: statusFor('isobars'), pane: 'isobars', attribution: WIND.attribution }),
    currents: new kinds.FlowLayer(target, service, { fieldId: 'currents', getModel, getTime, onStatus: statusFor('currents'), pane: 'currents', attribution: CURRENTS.attribution, style: { ...CURRENTS.style }, thin: 1 }),
    airports: new kinds.AirportLayer(target, {
      onStatus: statusFor('airports'),
      pane: 'clickable',
      attribution: `Airports: ${link('https://mesonet.agron.iastate.edu/', 'Iowa Environmental Mesonet')}`,
      getSystem: () => system,
      onForecast: (point) => {
        view.closePopup();
        openForecast(point);
      },
    }),
    events: new kinds.EventLayer(target, { onStatus: statusFor('events'), pane: 'clickable', attribution: `Events: ${link('https://eonet.gsfc.nasa.gov/', 'NASA EONET')}` }),
  };
}

const overlayDefinitions = [
  { id: 'wind', name: 'Wind flow', timed: true, legend: (units) => ({ stops: WIND.style.colorScale, low: 'Calm', high: `${fullSpeed(WIND.style.maxVelocity, units)}+` }), extras: windExtras },
  { id: 'radar', name: 'Radar (US)', legend: LEGENDS.radar },
  { id: 'worldradar', name: 'Radar (world)', legend: LEGENDS.worldradar, extras: () => radarLoopButton },
  { id: 'lightning', name: 'Lightning', legend: LEGENDS.lightning },
  { id: 'satellite', name: 'Satellite', legend: LEGENDS.satellite },
  { id: 'alerts', name: 'Alerts', hint: LEGENDS.alerts.note },
  { id: 'cyclones', name: 'Tropical cyclones', hint: LEGENDS.cyclones.note, extras: () => stormBox },
  { id: 'isobars', name: 'Pressure lines', timed: true, hint: LEGENDS.isobars.note },
  { id: 'currents', name: 'Ocean currents', timed: true, legend: LEGENDS.currents },
  { id: 'airports', name: 'Airports', legend: LEGENDS.airports },
  { id: 'events', name: 'Fires and natural events', hint: LEGENDS.events.note },
];

// The kind of map showing now, and its layers.
let viewMode = 'flat';
let layerKinds = FLAT_LAYERS;
let layerTarget = map;
let controllers = makeControllers(layerTarget, layerKinds);

// ---- Color the map: one at a time ----
const fieldCredit = `Forecasts: ${link('https://www.nco.ncep.noaa.gov/', 'NOAA')}, ${link('https://www.ecmwf.int/en/forecasts/datasets/open-data', 'ECMWF')}`;
const fills = [...FIELDS, ...IMAGERY];
const fillById = new Map(fills.map((entry) => [entry.id, entry]));
const hasValues = (entry) => Boolean(entry?.ramp);

function wmsFill(config, entry) {
  const layer = new layerKinds.WmsLayer(layerTarget, { ...config, pane: 'fill', opacity: fillOpacity }, statusFor(entry.id));
  layer.setOpacity = (opacity) => {
    layer.options.opacity = opacity;
    for (const part of layer.parts) part.frame?.setOpacity(opacity);
  };
  layer.at = () => NaN;
  layer.update = () => {};
  return layer;
}

function makeFillController(entry) {
  const shared = { onStatus: statusFor(entry.id), pane: 'fill', opacity: fillOpacity };
  if (entry.kind === 'gibs') return new layerKinds.GibsLayer(layerTarget, entry, { ...shared, attribution: link('https://earthdata.nasa.gov/gibs', 'NASA GIBS') });
  if (entry.kind === 'arcgis') return new layerKinds.ArcgisLayer(layerTarget, entry, { ...shared, attribution: link('https://www.weather.gov/', 'NOAA/NWS') });
  if (entry.kind === 'wms') return wmsFill(wmsImageConfig(entry), entry);
  if (entry.kind === 'radarProduct') return wmsFill(radarProductConfig(entry), entry);
  return new layerKinds.FieldLayer(layerTarget, service, entry, { ...shared, getModel, getTime, attribution: fieldCredit });
}

function setFill(id) {
  if (fill) {
    fill.stop();
    fill = null;
  }
  const entry = id ? fillById.get(id) : null;
  fillId = entry ? id : null;
  save('fill', fillId);
  panel.setActiveFill(entry ?? null, { opacity: fillOpacity });
  if (entry) {
    fill = makeFillController(entry);
    fill.start();
    panel.closeOnPhone();
  }
  refreshTimelineVisibility();
  refreshReadout();
}

// ---- Layer switching ----
function setOverlay(id, on) {
  panel.setOverlayOn(id, on);
  if (on) {
    enabled.add(id);
    controllers[id].start();
  } else {
    enabled.delete(id);
    controllers[id].stop();
    panel.setStatus(id, undefined);
  }
  save('layers', [...enabled]);
  refreshTimelineVisibility();
  if (!on) refreshReadout();
}

function refreshTimelineVisibility() {
  const timedOverlay = overlayDefinitions.some((item) => item.timed && enabled.has(item.id));
  timeline.setVisible(timedOverlay || fill instanceof FieldLayer);
}

function updateTimedLayers() {
  for (const { timed, id } of overlayDefinitions) {
    if (timed && enabled.has(id)) controllers[id].update();
  }
  fill?.update();
}

panel = new Panel({
  overlays: overlayDefinitions,
  groups: FIELD_GROUPS,
  fills,
  models: MODELS,
  pinned: Array.isArray(load('pinned')) ? load('pinned') : [],
  getSystem: () => system,
  onOverlay: setOverlay,
  onFill: (id) => setFill(id === fillId ? null : id),
  onClearFill: () => setFill(null),
  onOpacity: (opacity) => {
    fillOpacity = opacity;
    save('fillOpacity', opacity);
    fill?.setOpacity(opacity);
  },
  onModel: (id) => {
    model = id;
    save('model', model);
    updateTimedLayers();
  },
  onPinned: (ids) => save('pinned', ids),
});
panel.setModel(model);

// Keep the "2 min old" labels moving between data updates.
setInterval(() => {
  if (!document.hidden) panel.refreshStatuses();
}, STATUS_TICK_MS);

// ---- Forecast strip ----
let spot = null;
let followSpot = false;
const hint = byId('hint');

const keepSpotInView = () => {
  if (!spot || !followSpot) return;
  const stripHeight = byId('strip').offsetHeight;
  const railHeight = matchMedia('(max-width: 640px)').matches ? byId('rail').offsetHeight : 0;
  view.keepSpotInView(spot.lat, spot.lng, { top: railHeight, bottom: stripHeight });
};

// The active color layer's value at a spot, for the forecast strip and the readout.
function mapValueAt(lat, lng) {
  if (!fill || !hasValues(fill.entry)) return null;
  const value = fill.at(lat, lng);
  if (value !== value) return null;
  const { name, unit, categories } = fill.entry;
  return `${name}: ${formatValue(value, unit, system, categories)}`;
}

let search = null;
const strip = new ForecastStrip(byId('strip'), {
  getSystem: () => system,
  getMapValue: mapValueAt,
  onOpened: keepSpotInView,
  onClosed: () => {
    view.clearSpot();
    spot = null;
    view.focus();
  },
  isSaved: (place) => search.isSaved(place),
  onToggleSaved: (place) => search.toggleSaved(place),
});

function openForecast(where, name) {
  const point = { lat: where.lat, lng: wrapLongitude(where.lng), name };
  spot = { lat: where.lat, lng: where.lng };
  view.setSpot(spot.lat, spot.lng);
  followSpot = true;
  hint.hidden = true;
  save('hintDismissed', true);
  strip.open(point);
}

const onMapClick = (where) => {
  openForecast(where);
  panel.closeOnPhone();
};

// What the rest of the page asks of the flat map. The globe answers the same questions.
let flatSpot = null;
const flatView = {
  position() {
    const { lat, lng } = map.getCenter();
    return { lat, lng, zoom: map.getZoom() };
  },
  goTo(lat, lng, minZoom) {
    map.setView([lat, lng], Math.max(map.getZoom(), minZoom));
  },
  setSpot(lat, lng) {
    if (flatSpot) {
      flatSpot.setLatLng([lat, lng]);
      return;
    }
    flatSpot = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'spot-marker', iconSize: [24, 24] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
  },
  clearSpot() {
    if (flatSpot) map.removeLayer(flatSpot);
    flatSpot = null;
  },
  keepSpotInView(lat, lng, { top, bottom }) {
    map.panInside([lat, lng], { paddingTopLeft: [20, top + 20], paddingBottomRight: [20, bottom + 60] });
  },
  closePopup: () => map.closePopup(),
  focus: () => map.getContainer().focus({ preventScroll: true }),
};
let view = flatView;

map.on('dragstart', () => { followSpot = false; });
map.on('click', (event) => onMapClick(event.latlng));
// Keyboard users can pan with the arrow keys and press Enter for the spot at the map's center.
map.on('keypress', ({ originalEvent }) => {
  if (originalEvent.key === 'Enter' && document.activeElement === map.getContainer()) openForecast(map.getCenter());
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && strip.isOpen && !byId('about').open) strip.close();
});
hint.hidden = load('hintDismissed', false);

// ---- Finding a place ----
search = new PlaceSearch({
  input: byId('place-input'),
  list: byId('place-results'),
  onPick: (place) => {
    view.goTo(place.lat, place.lng, 7);
    panel.closeOnPhone();
    openForecast({ lat: place.lat, lng: place.lng }, place.name);
  },
});

const showNotice = (text) => {
  notice.textContent = text;
  notice.hidden = false;
  setTimeout(() => { notice.hidden = true; }, 6000);
};

byId('locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    showNotice("This browser can't share your location.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      view.goTo(coords.latitude, coords.longitude, 8);
      openForecast({ lat: coords.latitude, lng: coords.longitude });
    },
    () => showNotice("Couldn't get your location. Search for a place instead."),
    { timeout: 10_000 },
  );
});

// ---- Readout under the pointer ----
const readout = byId('readout');
let pointer = null;
let readoutQueued = false;

function refreshReadout() {
  if (!pointer) {
    readout.hidden = true;
    return;
  }
  const lines = [];
  const value = mapValueAt(pointer.lat, pointer.lng);
  if (value) lines.push(value);
  const wind = controllers.wind.at(pointer.lat, pointer.lng);
  if (wind) lines.push(describeWind(wind.speed, wind.fromDegrees, system));
  const current = controllers.currents.at(pointer.lat, pointer.lng);
  if (current && current.speed > 0) lines.push(`Current ${current.speed.toFixed(2)} m/s`);
  readout.hidden = lines.length === 0;
  readout.replaceChildren(...lines.map((line) => el('span', { text: line })));
}

const canHover = matchMedia('(hover: hover)').matches;
const onPointerMoved = (where) => {
  // A tap also sends a mouse event, which would leave a stale reading on phones.
  if (!canHover) return;
  pointer = where;
  if (!where) {
    readout.hidden = true;
    return;
  }
  if (readoutQueued) return;
  readoutQueued = true;
  requestAnimationFrame(() => {
    readoutQueued = false;
    refreshReadout();
  });
};
map.on('mousemove', ({ latlng }) => onPointerMoved(latlng));
map.on('mouseout', () => onPointerMoved(null));

// ---- Units ----
const unitButtons = [...document.querySelectorAll('[data-units]')];
const applyUnits = () => {
  for (const button of unitButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.units === system));
    button.textContent = `°${SYSTEMS[button.dataset.units].tempUnit}`;
  }
  panel.refreshLegends();
  strip.refresh();
  refreshReadout();
};
for (const button of unitButtons) {
  button.addEventListener('click', () => {
    system = button.dataset.units;
    save('units', system);
    applyUnits();
  });
}
applyUnits();

// ---- About ----
byId('about-open').addEventListener('click', () => byId('about').showModal());
byId('about-close').addEventListener('click', () => byId('about').close());
byId('layer-count').textContent = String(fills.length + overlayDefinitions.length);

// ---- Flat map or globe ----
const flatContainer = byId('map');
const globeContainer = byId('globe');
const viewToggle = byId('view-toggle');
let globe = null;

const openGlobe = (lat, lng) => {
  // On a phone the panel sits across the top and folds away, so the Earth stays centered.
  const onPhone = matchMedia('(max-width: 640px)').matches;
  const left = onPhone ? 0 : byId('rail').getBoundingClientRect().right;
  return GlobeMap.create(globeContainer, {
    lat,
    lng,
    zoom: fitGlobeZoom(innerWidth - left, innerHeight, lat),
    clearOf: { left },
  }, globeCallbacks);
};

const globeCallbacks = {
  onClick: onMapClick,
  onPointer: onPointerMoved,
  onDragStart: () => { followSpot = false; },
  ...baseMapMessages,
};

const showToggle = () => {
  viewToggle.textContent = viewMode === 'globe' ? 'Flat map' : '3D globe';
  viewToggle.setAttribute('aria-pressed', String(viewMode === 'globe'));
};

// Each kind of map holds a lot of memory, which matters most on phones, so only one exists at a time.
function useGlobe(next) {
  globe = next;
  flatContainer.hidden = true;
  flatBasemap?.then((basemap) => basemap?.remove());
  flatBasemap = null;
  view = next;
  viewMode = 'globe';
  layerKinds = GLOBE_LAYERS;
  layerTarget = next;
  creditWatcher.observe(next.creditBox);
}

function useFlat({ lat, lng, zoom }) {
  if (globe) {
    creditWatcher.unobserve(globe.creditBox);
    globe.remove();
    globe = null;
  }
  flatContainer.hidden = false;
  map.invalidateSize({ animate: false });
  map.setView([lat, lng], Math.min(Math.max(Math.round(zoom), map.getMinZoom()), map.getMaxZoom()), { animate: false });
  startFlatBasemap();
  view = flatView;
  viewMode = 'flat';
  layerKinds = FLAT_LAYERS;
  layerTarget = map;
}

function stopAllLayers() {
  for (const id of enabled) {
    controllers[id].stop();
    panel.setStatus(id, undefined);
  }
  fill?.stop();
  fill = null;
  view.closePopup();
  view.clearSpot();
  pointer = null;
  readout.hidden = true;
}

function startAllLayers() {
  controllers = makeControllers(layerTarget, layerKinds);
  for (const id of enabled) controllers[id].start();
  const entry = fillId ? fillById.get(fillId) : null;
  if (entry) {
    fill = makeFillController(entry);
    fill.start();
  }
  if (spot) view.setSpot(spot.lat, spot.lng);
  refreshTimelineVisibility();
}

async function switchView(mode) {
  if (mode === viewMode) return;
  viewToggle.disabled = true;
  const { lat, lng, zoom } = view.position();
  try {
    if (mode === 'globe') {
      const next = await openGlobe(lat, lng);
      stopAllLayers();
      useGlobe(next);
    } else {
      stopAllLayers();
      useFlat({ lat, lng, zoom: Math.max(zoom, 3) });
    }
    save('view', viewMode);
    startAllLayers();
  } catch {
    globeContainer.hidden = true;
    showNotice("Can't load the globe right now. The flat map still works.");
  }
  viewToggle.disabled = false;
  showToggle();
}

if (canDrawBasemap()) {
  viewToggle.hidden = false;
  viewToggle.addEventListener('click', () => switchView(viewMode === 'globe' ? 'flat' : 'globe'));
}

// ---- Start whatever was on last time ----
// The globe is where visitors land, unless they last chose the flat map.
let openedOnGlobe = false;
if (load('view') !== 'flat' && canDrawBasemap()) {
  const { lat, lng } = map.getCenter();
  try {
    useGlobe(await openGlobe(lat, lng));
    controllers = makeControllers(layerTarget, layerKinds);
    openedOnGlobe = true;
  } catch {
    globeContainer.hidden = true;
    flatContainer.hidden = false;
  }
}
if (!openedOnGlobe) startFlatBasemap();
showToggle();

const remembered = new Set(enabled);
enabled.clear();
for (const { id } of overlayDefinitions) {
  if (remembered.has(id)) setOverlay(id, true);
}
const savedFill = load('fill');
if (savedFill && fillById.has(savedFill)) setFill(savedFill);
else panel.setActiveFill(null, {});
refreshTimelineVisibility();

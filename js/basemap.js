// The base map is OpenFreeMap's blue "fiord" style, adapted in four ways. A layer missing from
// these tables or the style is simply skipped, so a change on their side can't break the map.
import { BASEMAP_ATTRIBUTION, BASEMAP_STYLE } from './config.js';

// Darkened to a night chart so weather colors stand out.
const LAND = '#1f2e45';
const WATER = '#101d31';

const COLOR_OVERRIDES = {
  background: { 'background-color': LAND },
  water: { 'fill-color': WATER },
  waterway: { 'line-color': WATER },
  road_area_pier: { 'fill-color': LAND },
  road_pier: { 'line-color': LAND },
};

// Place names in Latin script only. The original also shows each place's local script, which
// clutters a weather map and downloads about 1 MB of extra fonts when viewing much of the world.
const LATIN_NAME = ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];

const showsLocalScript = (textField) => JSON.stringify(textField ?? '').includes('name:nonlatin');

// Names sit on top of any color a weather layer can be, so they get strong contrast.
const LABEL_PAINT = { 'text-color': '#f4f8fb', 'text-halo-color': 'rgba(10, 20, 36, 0.9)', 'text-halo-width': 1.4, 'text-halo-blur': 0.3 };

// Which place names show at which zoom. The style shows every name its tiles hold, which covers a
// fifth of the screen with text when a continent is in view. Each row here is one kind of place,
// the rank range it covers (lower ranks are bigger places) and the zoom it appears at. Later rows
// win when names collide, so countries beat states, which beat cities. Zooms are the style's,
// where 0 shows the whole world and each step doubles the scale.
export const PLACE_LADDER = [
  { id: 'other', like: 'place_other', classes: ['hamlet', 'isolated_dwelling', 'neighbourhood'], from: 12, to: 14, padding: 6 },
  { id: 'suburb', like: 'place_suburb', classes: ['suburb'], from: 11, to: 15, padding: 6 },
  { id: 'village', like: 'place_village', classes: ['village'], from: 9.5, to: 14, padding: 8 },
  { id: 'town', like: 'place_town', classes: ['town'], from: 7.5, to: 15, padding: 8 },
  { id: 'city-small', like: 'place_city', classes: ['city'], ranks: [6, 99], from: 7, to: 14, padding: 8 },
  { id: 'city-5', like: 'place_city', classes: ['city'], ranks: [5, 5], from: 6, to: 14, padding: 8 },
  { id: 'city-4', like: 'place_city', classes: ['city'], ranks: [4, 4], from: 5.5, to: 14, padding: 8 },
  { id: 'city-3', like: 'place_city', classes: ['city'], ranks: [3, 3], from: 4.5, to: 14, padding: 8 },
  { id: 'city-capital', like: 'place_city', classes: ['city'], capital: 2, from: 3.5, to: 14, padding: 8 },
  { id: 'city-2', like: 'place_city_large', classes: ['city'], ranks: [2, 2], from: 3.5, to: 12, padding: 8 },
  { id: 'city-1', like: 'place_city_large', classes: ['city'], ranks: [1, 1], from: 3, to: 12, padding: 8 },
  { id: 'state-tiny', like: 'place_state', classes: ['state'], ranks: [5, 99], from: 6, to: 10, padding: 12 },
  { id: 'state-small', like: 'place_state', classes: ['state'], ranks: [4, 4], from: 5, to: 10, padding: 12 },
  { id: 'state-minor', like: 'place_state', classes: ['state'], ranks: [3, 3], from: 4.5, to: 10, padding: 12 },
  { id: 'state-major', like: 'place_state', classes: ['state'], ranks: [1, 2], from: 4, to: 10, padding: 12 },
  { id: 'country-small', like: 'place_country_minor', classes: ['country'], ranks: [3, 99], from: 4, to: 9, padding: 14 },
  { id: 'country-minor', like: 'place_country_minor', classes: ['country'], ranks: [2, 2], from: 2.5, to: 8, padding: 14 },
  { id: 'country-major', like: 'place_country_major', classes: ['country'], ranks: [0, 1], from: 0, to: 7, padding: 14 },
  { id: 'continent', like: 'place_continent', classes: ['continent'], from: 0, to: 2, padding: 14 },
];

const PLACE_LAYERS = /^place_/;

// Replaces the style's place layers with the ladder above. Each new layer borrows its look from the
// original it is most like, so fonts and sizes stay the designer's.
export function tunePlaceLabels(style) {
  const originals = new Map(style.layers.filter((layer) => PLACE_LAYERS.test(layer.id)).map((layer) => [layer.id, layer]));
  const firstPlace = style.layers.findIndex((layer) => PLACE_LAYERS.test(layer.id));
  if (firstPlace < 0) return style;
  const tiers = [];
  for (const tier of PLACE_LADDER) {
    const like = originals.get(tier.like);
    if (!like) continue;
    const conditions = [
      ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
      ['match', ['get', 'class'], tier.classes, true, false],
    ];
    if (tier.ranks) conditions.push(['>=', ['get', 'rank'], tier.ranks[0]], ['<=', ['get', 'rank'], tier.ranks[1]]);
    if (tier.capital) conditions.push(['==', ['get', 'capital'], tier.capital]);
    tiers.push({
      ...like,
      id: `place-${tier.id}`,
      minzoom: tier.from,
      maxzoom: tier.to,
      filter: ['all', ...conditions],
      layout: { ...like.layout, 'text-padding': tier.padding },
    });
  }
  const others = style.layers.filter((layer) => !PLACE_LAYERS.test(layer.id));
  const before = style.layers.slice(0, firstPlace).filter((layer) => !PLACE_LAYERS.test(layer.id));
  return { ...style, layers: [...before, ...tiers, ...others.slice(before.length)] };
}

export function adaptStyle(style) {
  const tuned = tunePlaceLabels(style);
  for (const layer of tuned.layers) {
    const colors = COLOR_OVERRIDES[layer.id];
    if (colors) layer.paint = { ...layer.paint, ...colors };
    if (layer.type === 'symbol') layer.paint = { ...layer.paint, ...LABEL_PAINT };
    if (showsLocalScript(layer.layout?.['text-field'])) layer.layout = { ...layer.layout, 'text-field': LATIN_NAME };
  }
  return tuned;
}

// Names and borders go in a second copy of the map above the weather colors, so a full-map layer
// doesn't hide them. The ground stays underneath, showing through wherever a layer is clear.
export const onTop = (layer) => layer.type === 'symbol' || layer['source-layer'] === 'boundary';

export function splitStyle(style) {
  const copy = structuredClone(style);
  return {
    ground: { ...style, layers: style.layers.filter((layer) => !onTop(layer)) },
    labels: { ...copy, layers: copy.layers.filter(onTop) },
  };
}

const STYLE_TIMEOUT_MS = 15_000;
const SLOW_MS = 8_000;

export const canDrawBasemap = () => {
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
};

export async function addBasemap(map, { labelsPane, onUnavailable, onSlow, onLoaded }) {
  // The map library needs WebGL, and adding it without WebGL leaves errors on every map move.
  if (!canDrawBasemap()) {
    onUnavailable();
    return null;
  }
  try {
    const response = await fetch(BASEMAP_STYLE, { signal: AbortSignal.timeout(STYLE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Base map style returned ${response.status}`);
    const { ground, labels } = splitStyle(adaptStyle(await response.json()));
    // The credit goes up with the map, rather than when its first tiles finish.
    const groundLayer = L.maplibreGL({ style: ground, attributionControl: { customAttribution: BASEMAP_ATTRIBUTION } }).addTo(map);
    const labelsLayer = L.maplibreGL({ style: labels, pane: labelsPane, attributionControl: false }).addTo(map);
    const groundMap = groundLayer.getMaplibreMap();
    const labelsMap = labelsLayer.getMaplibreMap();

    // Tile connections can stall for 40 s or more, leaving a blank map that looks broken, so a long
    // first load gets a message. Only a real failure gets the other message. Either one clears the
    // next time everything on screen has drawn without a failure.
    const notReady = new Set([groundMap, labelsMap]);
    const failing = new Set();
    const slowTimer = setTimeout(() => {
      if (notReady.size > 0 && failing.size === 0) onSlow();
    }, SLOW_MS);
    for (const glMap of notReady) {
      let failedSinceIdle = false;
      glMap.on('error', () => {
        failedSinceIdle = true;
        failing.add(glMap);
        onUnavailable();
      });
      glMap.on('idle', () => {
        notReady.delete(glMap);
        if (!failedSinceIdle) failing.delete(glMap);
        failedSinceIdle = false;
        if (notReady.size === 0) clearTimeout(slowTimer);
        if (notReady.size === 0 && failing.size === 0) onLoaded();
      });
    }
    return {
      remove() {
        clearTimeout(slowTimer);
        map.removeLayer(groundLayer);
        map.removeLayer(labelsLayer);
      },
    };
  } catch {
    onUnavailable();
    return null;
  }
}

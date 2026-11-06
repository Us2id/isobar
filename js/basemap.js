// The base map is OpenFreeMap's blue "fiord" style, adapted in two ways. A layer missing from
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

export function adaptStyle(style) {
  for (const layer of style.layers) {
    const colors = COLOR_OVERRIDES[layer.id];
    if (colors) layer.paint = { ...layer.paint, ...colors };
    if (showsLocalScript(layer.layout?.['text-field'])) layer.layout['text-field'] = LATIN_NAME;
  }
  return style;
}

const STYLE_TIMEOUT_MS = 15_000;

const canDrawBasemap = () => {
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
};

export async function addBasemap(map, { onUnavailable, onLoaded }) {
  // The map library needs WebGL, and adding it without WebGL leaves errors on every map move.
  if (!canDrawBasemap()) {
    onUnavailable();
    return;
  }
  try {
    const response = await fetch(BASEMAP_STYLE, { signal: AbortSignal.timeout(STYLE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Base map style returned ${response.status}`);
    const style = adaptStyle(await response.json());
    const glMap = L.maplibreGL({ style, attribution: BASEMAP_ATTRIBUTION }).addTo(map).getMaplibreMap();
    // A slow connection only means the map fills in late. Only a real failure gets a message,
    // and the message clears the next time everything on screen draws without one.
    let failedSinceIdle = false;
    glMap.on('error', () => {
      failedSinceIdle = true;
      onUnavailable();
    });
    glMap.on('idle', () => {
      if (!failedSinceIdle) onLoaded();
      failedSinceIdle = false;
    });
  } catch {
    onUnavailable();
  }
}

// Every outside service the site talks to, and how often it asks. Change data sources here.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const OPENGEO = 'https://opengeo.ncep.noaa.gov/geoserver';
const NOWCOAST = 'https://nowcoast.noaa.gov/geoserver';

export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/fiord';
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a>, data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const NWS_API = 'https://api.weather.gov';
export const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast';

// Where the National Weather Service might have a forecast. Generous on purpose: NWS answers
// "not mine" for parts of Canada and Mexico, and the site then falls back to Open-Meteo.
export const NWS_COVERAGE = [
  { west: -180, east: -60, south: 15, north: 72 }, // Lower 48, Alaska, Hawaii, Puerto Rico
  { west: 170, east: 180, south: 50, north: 56 }, // Western Aleutians
  { west: 140, east: 150, south: 10, north: 21 }, // Guam and the Northern Marianas
  { west: -172, east: -168, south: -16, north: -13 }, // American Samoa
];

// The lower 48 states, used for the opening view.
export const OPENING_BOUNDS = [[24, -125], [50, -66]];

// Lower layers first. Each gets its own map pane so the stacking never depends on load order.
export const PANE_ORDER = ['satelliteWorld', 'satelliteGoes', 'alerts', 'radar', 'lightning', 'storms', 'wind'];

const capabilities = (service) => `${service}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;

const radarRegion = (workspace, layer, box) => ({
  id: workspace,
  url: `${OPENGEO}/${workspace}/${layer}/ows`,
  capabilitiesUrl: capabilities(`${OPENGEO}/${workspace}/${layer}`),
  layer,
  box,
});

export const RADAR = {
  pane: 'radar',
  opacity: 0.85,
  refreshMs: 2 * MINUTE,
  retryMs: MINUTE,
  staleAfterMs: 20 * MINUTE,
  merge: 'oldest',
  attribution: 'Radar: <a href="https://www.weather.gov/">NOAA/NWS</a>',
  outsideMessage: 'US only. Move the map to see it.',
  parts: [
    radarRegion('conus', 'conus_bref_qcd', { west: -130, east: -60, south: 20, north: 55 }),
    radarRegion('alaska', 'alaska_bref_qcd', { west: -176, east: -126, south: 50, north: 72 }),
    radarRegion('hawaii', 'hawaii_bref_qcd', { west: -164, east: -151, south: 15, north: 26 }),
    radarRegion('carib', 'carib_bref_qcd', { west: -90, east: -60, south: 10, north: 25 }),
    radarRegion('guam', 'guam_bref_qcd', { west: 140, east: 150, south: 9, north: 18 }),
  ],
};

const satelliteService = `${NOWCOAST}/observations/satellite`;
const satellitePart = (id, pane, layer, box, staleAfterMs) => ({
  id,
  pane,
  url: `${satelliteService}/ows`,
  capabilitiesUrl: capabilities(`${satelliteService}/${layer}`),
  layer,
  box,
  staleAfterMs,
});

export const SATELLITE = {
  opacity: 0.9,
  refreshMs: 5 * MINUTE,
  retryMs: 2 * MINUTE,
  merge: 'first',
  attribution: 'Satellite: <a href="https://nowcoast.noaa.gov/">NOAA nowCOAST</a>',
  outsideMessage: 'No imagery this close to the poles.',
  // Listed lowest first. GOES updates every 5 minutes but stops at 50.5°N, so the hourly
  // world mosaic sits underneath it and fills everything else.
  parts: [
    satellitePart('global', 'satelliteWorld', 'global_longwave_imagery_mosaic', { west: -180, east: 180, south: -72.7, north: 72.7 }, 6 * HOUR),
    satellitePart('goes', 'satelliteGoes', 'goes_longwave_imagery', { west: -179.5, east: -50.75, south: 10.9, north: 50.55 }, 40 * MINUTE),
  ],
  // When several parts are in view, the age shown is the one most people are looking at.
  statusOrder: ['goes', 'global'],
};

const lightningService = `${NOWCOAST}/observations/lightning_detection`;

export const LIGHTNING = {
  pane: 'lightning',
  opacity: 1,
  refreshMs: 5 * MINUTE,
  retryMs: 2 * MINUTE,
  staleAfterMs: 60 * MINUTE,
  merge: 'oldest',
  attribution: 'Lightning: <a href="https://nowcoast.noaa.gov/">NOAA nowCOAST</a>',
  outsideMessage: 'Covers the Americas and the Pacific. Move the map to see it.',
  parts: [{
    id: 'lightning',
    url: `${lightningService}/ows`,
    capabilitiesUrl: capabilities(`${lightningService}/ldn_lightning_strike_density`),
    layer: 'ldn_lightning_strike_density',
    // The service's stated coverage crosses the date line, so it takes two boxes.
    box: [
      { west: -180, east: 0, south: -25, north: 80 },
      { west: 110, east: 180, south: -25, north: 80 },
    ],
  }],
};

// The whole-US alert picture. This service has no time list, so the site simply reloads it.
export const ALERT_MAP = {
  pane: 'alerts',
  opacity: 0.65,
  refreshMs: 5 * MINUTE,
  retryMs: 2 * MINUTE,
  merge: 'oldest',
  attribution: 'Alerts: <a href="https://www.weather.gov/">NOAA/NWS</a>',
  outsideMessage: 'US only. Move the map to see it.',
  parts: [{
    id: 'alerts',
    url: `${NOWCOAST}/hazards/alerts/ows`,
    layer: 'watches_warnings_advisories',
    box: [
      { west: -180, east: -60, south: 10, north: 72 },
      { west: 130, east: 180, south: -20, north: 25 },
    ],
  }],
};

// Fast-moving storm warnings are fetched on their own and drawn crisply on top.
// Colors are the ones weather.gov uses.
export const STORM_WARNINGS = {
  refreshMs: MINUTE,
  retryMs: MINUTE,
  colors: {
    'Tornado Warning': '#ff0000',
    'Extreme Wind Warning': '#ff8c00',
    'Severe Thunderstorm Warning': '#ffa500',
    'Flash Flood Warning': '#ff2f55',
    'Snow Squall Warning': '#c71585',
    'Dust Storm Warning': '#ffe4c4',
    'Special Marine Warning': '#ffa500',
  },
};

export const WIND = {
  pane: 'wind',
  checkMs: 15 * MINUTE,
  retryMs: 3 * MINUTE,
  attribution: 'Wind: <a href="https://www.ncei.noaa.gov/products/weather-climate-models/global-forecast">NOAA GFS</a>',
  maxParticles: 6000,
  particlesPerPixel: 1 / 200,
  // Colors run from calm to this speed (m/s). Faster wind keeps the last color.
  maxSpeedMs: 20,
  // How much of each line survives from one frame to the next. Higher means longer trails, but
  // near 1 the faint ends never fully fade and build up into a haze over the map.
  trailStrength: 0.95,
  colors: ['#a9cfe6', '#c9dfee', '#e6f0f7', '#fdebc8', '#fdd49e', '#fdbb84', '#fc8d59', '#ef6548', '#e0301e', '#c00018'],
};

export const LEGENDS = {
  radar: {
    stops: ['#6d7dab', '#4e7eb2', '#5cb5c6', '#52d6a2', '#15d622', '#0b840e', '#b5ba03', '#ffdd00', '#ff9000', '#ff2a00', '#b00020', '#ff00ff'],
    low: 'Light',
    high: 'Extreme',
  },
  lightning: {
    stops: ['#ffffcc', '#ffec78', '#ffd600', '#ffa400', '#ff7800', '#ff4500', '#ff0000', '#bc0025', '#cc0066', '#ff00ff'],
    low: 'Few strikes',
    high: 'Many',
  },
  satellite: {
    stops: ['#2a3a4d', '#7f8b97', '#ffffff'],
    low: 'Clear or low cloud',
    high: 'Tall',
  },
  alerts: { note: 'Colors match weather.gov. Click an area for details.' },
};

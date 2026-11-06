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
const US_BOUNDS = [[24, -125], [50, -66]];

// Where a map a visitor hasn't moved yet opens: their part of the world, judged from the device's
// time zone, so it needs no location permission and sends nothing anywhere.
const REGION_LATITUDE = { Africa: 5, America: 25, Antarctica: -70, Arctic: 75, Asia: 25, Atlantic: 35, Australia: -28, Europe: 48, Indian: -5, Pacific: -10 };
const SOUTH_AMERICA = /^America\/(Sao_Paulo|Argentina|Santiago|Montevideo|Asuncion|Lima|La_Paz|Bogota|Caracas|Guayaquil|Manaus)/;

export function openingView(timeZone, utcOffsetMinutes) {
  const zone = timeZone ?? '';
  const inUs = /^America\/(New_York|Detroit|Chicago|Denver|Phoenix|Los_Angeles|Boise|Indiana|Kentucky|Menominee|North_Dakota)/.test(zone) || zone.startsWith('US/');
  if (inUs) return { bounds: US_BOUNDS, radar: 'radar' };
  const latitude = SOUTH_AMERICA.test(zone) ? -18 : REGION_LATITUDE[zone.split('/')[0]] ?? 20;
  const longitude = Math.max(-170, Math.min(170, (utcOffsetMinutes / 60) * 15));
  return { center: [latitude, longitude], zoom: 4, radar: 'worldradar' };
}

// Lower layers first. Each gets its own map pane so the stacking never depends on load order.
export const PANE_ORDER = ['satelliteWorld', 'satelliteGoes', 'fill', 'alerts', 'worldradar', 'radar', 'lightning', 'labels', 'isobars', 'storms', 'currents', 'wind', 'clickable'];

export const MODELS = [
  { id: 'gfs', name: 'GFS (NOAA), hourly' },
  { id: 'ecmwf', name: 'IFS (ECMWF), 3-hourly' },
  { id: 'aifs', name: 'AIFS (ECMWF AI), 6-hourly' },
];

export const FIELD_GROUPS = [
  { id: 'temperature', name: 'Temperature' },
  { id: 'rain', name: 'Rain and snow' },
  { id: 'wind', name: 'Wind' },
  { id: 'clouds', name: 'Clouds and visibility' },
  { id: 'humidity', name: 'Humidity' },
  { id: 'pressure', name: 'Pressure' },
  { id: 'storms', name: 'Storm ingredients' },
  { id: 'farming', name: 'Soil and farming' },
  { id: 'sun', name: 'Sun and energy' },
  { id: 'air', name: 'Air quality' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'views', name: 'Satellite views' },
  { id: 'us', name: 'US forecasts and outlooks' },
  { id: 'land', name: 'Land and people' },
];

const capabilities = (service) => `${service}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;

const radarRegion = (workspace, layer, box) => ({
  id: workspace,
  url: `${OPENGEO}/${workspace}/${layer}/ows`,
  capabilitiesUrl: capabilities(`${OPENGEO}/${workspace}/${layer}`),
  layer,
  box,
});

const RADAR_REGIONS = [
  ['conus', { west: -130, east: -60, south: 20, north: 55 }],
  ['alaska', { west: -176, east: -126, south: 50, north: 72 }],
  ['hawaii', { west: -164, east: -151, south: 15, north: 26 }],
  ['carib', { west: -90, east: -60, south: 10, north: 25 }],
  ['guam', { west: 140, east: 150, south: 9, north: 18 }],
];
const radarParts = (suffix) => RADAR_REGIONS.map(([workspace, box]) => radarRegion(workspace, `${workspace}_${suffix}`, box));

export const RADAR = {
  pane: 'radar',
  opacity: 0.85,
  refreshMs: 2 * MINUTE,
  retryMs: MINUTE,
  staleAfterMs: 20 * MINUTE,
  merge: 'oldest',
  attribution: 'Radar: <a href="https://www.weather.gov/">NOAA/NWS</a>',
  outsideMessage: 'US only. Move the map to see it.',
  parts: radarParts('bref_qcd'),
};

// The other radar products use the same regions, shown as a "color the map" layer.
export const radarProductConfig = (entry) => ({
  ...RADAR,
  attribution: `${entry.name}: <a href="https://www.weather.gov/" target="_blank" rel="noopener">NOAA/NWS</a>`,
  parts: radarParts(entry.suffix),
});

const WORLD_BOX = { west: -180, east: 180, south: -85, north: 85 };

// Extra NOAA nowCOAST satellite views.
export const wmsImageConfig = (entry) => ({
  refreshMs: 5 * MINUTE,
  retryMs: 2 * MINUTE,
  staleAfterMs: (entry.stale ?? 60) * MINUTE,
  merge: 'oldest',
  attribution: `<a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener">NOAA nowCOAST</a>`,
  outsideMessage: 'No coverage here. Move the map to see it.',
  parts: [{
    id: entry.id,
    url: `${NOWCOAST}/${entry.service}/ows`,
    capabilitiesUrl: capabilities(`${NOWCOAST}/${entry.service}/${entry.layer}`),
    layer: entry.layer,
    box: WORLD_BOX,
  }],
});

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
  attribution: 'Forecasts: <a href="https://www.nco.ncep.noaa.gov/" target="_blank" rel="noopener">NOAA</a>, <a href="https://www.ecmwf.int/en/forecasts/datasets/open-data" target="_blank" rel="noopener">ECMWF</a>',
  style: {
    maxParticles: 6000,
    density: 1 / 200,
    // Colors run from calm to this speed (m/s). Faster wind keeps the last color.
    maxVelocity: 20,
    velocityScale: 0.006,
    lineWidth: 1,
    frameRate: 25,
    // How much of each line survives from one frame to the next. Higher means longer trails, but
    // near 1 the faint ends never fully fade and build up into a haze over the map.
    trail: 0.95,
    colorScale: ['#a9cfe6', '#c9dfee', '#e6f0f7', '#fdebc8', '#fdd49e', '#fdbb84', '#fc8d59', '#ef6548', '#e0301e', '#c00018'],
  },
};

// Many small steps so the first one, which is clear, only hides still water. Land reads as zero
// speed and shouldn't show.
const CURRENT_COLORS = ['rgba(0,0,0,0)'];
for (let i = 0; i < 39; i++) {
  const stops = ['#7ff0e0', '#b7f5c0', '#f7f08a', '#fba35a', '#e0342b'];
  CURRENT_COLORS.push(stops[Math.min(Math.floor(i / 8), stops.length - 1)]);
}

export const CURRENTS = {
  attribution: 'Currents: <a href="https://www.ncei.noaa.gov/products/weather-climate-models/climate-forecast-system" target="_blank" rel="noopener">NOAA CFS</a>',
  style: {
    maxParticles: 6000,
    density: 1 / 150,
    maxVelocity: 1,
    velocityScale: 0.2,
    lineWidth: 1.2,
    frameRate: 25,
    trail: 0.96,
    colorScale: CURRENT_COLORS,
  },
};

export const LEGENDS = {
  worldradar: {
    // RainViewer's published Universal Blue colors from 15 to 60 dBZ. Snow is drawn in paler blues.
    stops: ['#88ddee', '#00a3e0', '#0077aa', '#005588', '#ffee00', '#ffaa00', '#ff4400', '#c10000', '#ffaaff', '#ff77ff'],
    low: 'Light',
    high: 'Extreme',
  },
  currents: {
    stops: ['#7ff0e0', '#b7f5c0', '#f7f08a', '#fba35a', '#e0342b'],
    low: 'Slow',
    high: '1 m/s+',
  },
  airports: {
    stops: ['#3fd06a', '#3fd06a', '#4f9dff', '#4f9dff', '#ff5c5c', '#ff5c5c', '#ff5cf0', '#ff5cf0'],
    low: 'Good flying weather',
    high: 'Poor',
  },
  cyclones: { note: 'Dashed line is the forecast track. Shading shows wind of 60, 90 and 120 km/h.' },
  isobars: { note: 'Lines every 4 hPa. Close lines mean strong wind.' },
  events: { note: 'Open wildfires, storms, volcanoes and more, from NASA.' },
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

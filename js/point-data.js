// Extra readings for one spot from Open-Meteo: soil, air, sea, rivers and other forecast models.
// Its free API allows non-commercial use with a link to Open-Meteo beside the data.
import { el } from './dom.js';
import { formatValue } from './units.js';

const HOUR = 3_600_000;
const TIMEOUT_MS = 20_000;
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const FLOOD = 'https://flood-api.open-meteo.com/v1/flood';

const literal = (u, dp = 0) => ({ u, dp });
const percentOf = (x) => x * 100;
const metresToKm = (m) => m / 1000;
const metresToCm = (m) => m * 100;
const secondsToMinutes = (s) => s / 60;

// Each row: [label, API variable, unit, optional conversion to the unit's stored form]
export const SECTIONS = {
  weather: {
    label: 'More weather',
    url: FORECAST,
    params: { wind_speed_unit: 'ms' },
    rows: [
      ['Feels like', 'apparent_temperature', 'temp'],
      ['Humidity', 'relative_humidity_2m', 'percent'],
      ['Dew point', 'dew_point_2m', 'temp'],
      ['Sea level pressure', 'pressure_msl', 'pressure'],
      ['Surface pressure', 'surface_pressure', 'pressure'],
      ['Cloud cover', 'cloud_cover', 'percent'],
      ['Low cloud', 'cloud_cover_low', 'percent'],
      ['Middle cloud', 'cloud_cover_mid', 'percent'],
      ['High cloud', 'cloud_cover_high', 'percent'],
      ['Visibility', 'visibility', 'distance', metresToKm],
      ['Rain', 'rain', 'depth'],
      ['Showers', 'showers', 'depth'],
      ['Snowfall', 'snowfall', 'depthCm'],
      ['Snow depth', 'snow_depth', 'depthCm', metresToCm],
      ['Wind gusts', 'wind_gusts_10m', 'speed'],
      ['Wind at 80 m', 'wind_speed_80m', 'speed'],
      ['Wind at 120 m', 'wind_speed_120m', 'speed'],
      ['Wind at 180 m', 'wind_speed_180m', 'speed'],
      ['Freezing level', 'freezing_level_height', 'height'],
      ['CAPE (storm fuel)', 'cape', 'energy'],
      ['Sunlight', 'shortwave_radiation', 'flux'],
      ['Direct sunlight', 'direct_radiation', 'flux'],
      ['Diffuse sunlight', 'diffuse_radiation', 'flux'],
      ['Sunshine', 'sunshine_duration', literal('min'), secondsToMinutes],
      ['UV index', 'uv_index', literal('', 1)],
    ],
  },
  soil: {
    label: 'Soil and farming',
    url: FORECAST,
    rows: [
      ['Evapotranspiration (per hour)', 'evapotranspiration', 'depth'],
      ['Reference ET0 (per hour)', 'et0_fao_evapotranspiration', 'depth'],
      ['Vapor pressure deficit', 'vapour_pressure_deficit', literal('kPa', 2)],
      ['Soil moisture, 0–1 cm', 'soil_moisture_0_to_1cm', 'percent', percentOf],
      ['Soil moisture, 1–3 cm', 'soil_moisture_1_to_3cm', 'percent', percentOf],
      ['Soil moisture, 3–9 cm', 'soil_moisture_3_to_9cm', 'percent', percentOf],
      ['Soil moisture, 9–27 cm', 'soil_moisture_9_to_27cm', 'percent', percentOf],
      ['Soil moisture, 27–81 cm', 'soil_moisture_27_to_81cm', 'percent', percentOf],
      ['Soil temperature, surface', 'soil_temperature_0cm', 'temp'],
      ['Soil temperature, 6 cm', 'soil_temperature_6cm', 'temp'],
      ['Soil temperature, 18 cm', 'soil_temperature_18cm', 'temp'],
      ['Soil temperature, 54 cm', 'soil_temperature_54cm', 'temp'],
    ],
  },
  air: {
    label: 'Air quality',
    url: AIR,
    rows: [
      ['US air quality index', 'us_aqi', 'aqi'],
      ['European air quality index', 'european_aqi', 'aqi'],
      ['PM2.5', 'pm2_5', 'micrograms'],
      ['PM10', 'pm10', 'micrograms'],
      ['Ozone', 'ozone', 'micrograms'],
      ['Nitrogen dioxide', 'nitrogen_dioxide', 'micrograms'],
      ['Sulfur dioxide', 'sulphur_dioxide', 'micrograms'],
      ['Carbon monoxide', 'carbon_monoxide', 'micrograms'],
      ['Dust', 'dust', 'micrograms'],
      ['Haze (aerosol optical depth)', 'aerosol_optical_depth', literal('', 2)],
      ['UV index', 'uv_index', literal('', 1)],
    ],
  },
  sea: {
    label: 'Sea and rivers',
    url: MARINE,
    emptyNote: 'No sea data for this spot. It may be too far inland.',
    rows: [
      ['Wave height', 'wave_height', 'heightSmall'],
      ['Wave period', 'wave_period', literal('s', 0)],
      ['Wave direction', 'wave_direction', 'direction'],
      ['Wind wave height', 'wind_wave_height', 'heightSmall'],
      ['Swell height', 'swell_wave_height', 'heightSmall'],
      ['Swell period', 'swell_wave_period', literal('s', 0)],
      ['Sea temperature', 'sea_surface_temperature', 'temp'],
      ['Current speed', 'ocean_current_velocity', literal('km/h', 1)],
      ['Current heading', 'ocean_current_direction', literal('°', 0)],
      ['Sea level', 'sea_level_height_msl', 'heightSmall'],
    ],
  },
};

async function getJson(url, params, signal) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${url}?${query}`, {
    signal: AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : signal,
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

// The value for this hour, and the lowest and highest over the next 24 hours.
export function summarize(times, values, convert, now = Date.now()) {
  const start = times.findIndex((time) => time * 1000 + HOUR > now);
  if (start < 0) return null;
  const window = values.slice(start, start + 24).filter((value) => value != null).map(convert ?? ((x) => x));
  if (window.length === 0) return null;
  const current = values[start];
  return {
    now: current == null ? null : (convert ?? ((x) => x))(current),
    low: Math.min(...window),
    high: Math.max(...window),
  };
}

export async function loadSection(id, lat, lng, signal) {
  const section = SECTIONS[id];
  const data = await getJson(section.url, {
    latitude: lat,
    longitude: lng,
    hourly: section.rows.map((row) => row[1]).join(','),
    timeformat: 'unixtime',
    forecast_days: 2,
    ...section.params,
  }, signal);
  const rows = section.rows.map(([label, variable, unit, convert]) => ({
    label,
    unit,
    ...(summarize(data.hourly.time, data.hourly[variable] ?? [], convert) ?? {}),
  })).filter((row) => row.now !== undefined);
  let river = null;
  if (id === 'sea') {
    river = await getJson(FLOOD, {
      latitude: lat, longitude: lng, daily: 'river_discharge,river_discharge_max', forecast_days: 7, timeformat: 'unixtime',
    }, signal).catch(() => null);
  }
  return { rows, river };
}

export function renderSection(box, id, { rows, river }, system) {
  const section = SECTIONS[id];
  const show = (value, unit) => (value == null ? 'Not available' : formatValue(value, unit, system));
  const body = rows.map(({ label, unit, now, low, high }) => el('tr', {},
    el('th', { scope: 'row', text: label }),
    el('td', { text: show(now, unit) }),
    el('td', { text: unit === 'direction' || low === undefined ? '' : `${show(low, unit)} to ${show(high, unit)}` }),
  ));
  const parts = [];
  if (rows.length === 0) {
    parts.push(el('p', { class: 'alerts-note', text: section.emptyNote ?? 'No readings for this spot.' }));
  } else {
    parts.push(el('table', { class: 'reading-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Reading' }), el('th', { scope: 'col', text: 'This hour' }), el('th', { scope: 'col', text: 'Next 24 hours' }))),
      el('tbody', {}, ...body),
    ));
  }
  if (river?.daily?.river_discharge?.some((value) => value != null)) {
    const flows = river.daily.river_discharge.filter((value) => value != null);
    parts.push(el('p', { class: 'reading-note', text: `Nearest river flow: ${flows[0].toFixed(flows[0] < 10 ? 1 : 0)} m³/s today, up to ${Math.max(...flows).toFixed(flows[0] < 10 ? 1 : 0)} m³/s this week (GloFAS).` }));
  }
  parts.push(el('p', { class: 'reading-note' }, el('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener', text: 'Weather data by Open-Meteo.com' }), '.'));
  box.replaceChildren(...parts);
}

// ---- Comparing forecast models ----
export const COMPARED_MODELS = [
  ['gfs_global', 'GFS (NOAA, US)'],
  ['ecmwf_ifs025', 'IFS (ECMWF, Europe)'],
  ['ecmwf_aifs025_single', 'AIFS (ECMWF, AI model)'],
  ['icon_global', 'ICON (DWD, Germany)'],
  ['ukmo_global_deterministic_10km', 'UKMO (Met Office, UK)'],
  ['jma_gsm', 'GSM (JMA, Japan)'],
  ['gem_global', 'GEM (Canada)'],
  ['meteofrance_arpege_world', 'ARPEGE (France)'],
];
const COMPARE_COLORS = ['#5b2a9d', '#c5221f', '#0b7a75', '#c26a00', '#2f7fc1', '#7a4a20', '#3f8f3f', '#b0468f'];

export async function loadComparison(lat, lng, signal) {
  const data = await getJson(FORECAST, {
    latitude: lat,
    longitude: lng,
    hourly: 'temperature_2m,precipitation,wind_speed_10m',
    models: COMPARED_MODELS.map(([id]) => id).join(','),
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
    forecast_days: 3,
    timezone: 'auto',
  }, signal);
  const start = data.hourly.time.findIndex((time) => time * 1000 + HOUR > Date.now());
  const pick = (name, id) => (data.hourly[`${name}_${id}`] ?? []).slice(start, start + 48);
  const models = COMPARED_MODELS.map(([id, name], index) => {
    const temps = pick('temperature_2m', id);
    const rain = pick('precipitation', id).slice(0, 24).filter((value) => value != null);
    const wind = pick('wind_speed_10m', id).slice(0, 24).filter((value) => value != null);
    const day = temps.slice(0, 24).filter((value) => value != null);
    return {
      id,
      name,
      color: COMPARE_COLORS[index],
      temps,
      high: day.length ? Math.max(...day) : null,
      low: day.length ? Math.min(...day) : null,
      rain: rain.length ? rain.reduce((sum, value) => sum + value, 0) : null,
      wind: wind.length ? Math.max(...wind) : null,
    };
  }).filter((model) => model.high !== null);
  return { models, times: data.hourly.time.slice(start, start + 48).map((time) => time * 1000), timeZone: data.timezone };
}

const svgElement = (tag, props = {}) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(props)) node.setAttribute(key, value);
  return node;
};

function comparisonChart(models, system, width) {
  const height = 130;
  const left = 34;
  const convert = (c) => (system === 'imperial' ? (c * 9) / 5 + 32 : c);
  const all = models.flatMap((model) => model.temps.filter((value) => value != null).map(convert));
  const low = Math.floor(Math.min(...all));
  const high = Math.ceil(Math.max(...all));
  const span = Math.max(high - low, 1);
  const x = (i) => left + (i / 47) * (width - left - 6);
  const y = (value) => height - 8 - ((value - low) / span) * (height - 16);
  const chart = svgElement('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Temperature over the next 48 hours from each forecast model' });
  for (const value of [low, Math.round((low + high) / 2), high]) {
    const line = svgElement('line', { x1: left, x2: width - 6, y1: y(value), y2: y(value), class: 'm-grid' });
    const label = svgElement('text', { x: left - 5, y: y(value) + 4, class: 'm-tick' });
    label.textContent = `${value}°`;
    chart.append(line, label);
  }
  for (const model of models) {
    const points = model.temps.map((value, i) => (value == null ? null : `${x(i).toFixed(1)},${y(convert(value)).toFixed(1)}`)).filter(Boolean).join(' ');
    chart.append(svgElement('polyline', { points, fill: 'none', stroke: model.color, 'stroke-width': 1.6 }));
  }
  return chart;
}

export function renderComparison(box, { models }, system) {
  if (models.length === 0) {
    box.replaceChildren(el('p', { class: 'alerts-note', text: 'No model data for this spot.' }));
    return;
  }
  const temp = (value) => (value == null ? 'Not available' : formatValue(value, 'temp', system));
  const highs = models.map((model) => model.high);
  const rains = models.map((model) => model.rain).filter((value) => value != null);
  const spreadC = Math.max(...highs) - Math.min(...highs);
  const spread = system === 'imperial' ? `${Math.round((spreadC * 9) / 5)}°F` : `${Math.round(spreadC)}°C`;
  const rainText = rains.length === 0 || Math.max(...rains) < 0.1
    ? ' and all expect almost no rain'
    : `, and from ${formatValue(Math.min(...rains), 'depth', system)} to ${formatValue(Math.max(...rains), 'depth', system)} of rain`;
  const rows = models.map((model) => {
    const swatch = el('span', { class: 'legend-swatch' });
    swatch.style.background = model.color;
    return el('tr', {},
      el('th', { scope: 'row' }, swatch, ` ${model.name}`),
      el('td', { text: `${temp(model.high)} / ${temp(model.low)}` }),
      el('td', { text: model.rain == null ? 'Not available' : formatValue(model.rain, 'depth', system) }),
      el('td', { text: model.wind == null ? 'Not available' : formatValue(model.wind, 'speed', system) }),
    );
  });
  const chartBox = el('div', { class: 'compare-chart' });
  box.replaceChildren(
    el('p', { class: 'reading-note', text: `Models differ by ${spread} on the high${rainText}. The closer they agree, the more you can trust the forecast.` }),
    chartBox,
    el('table', { class: 'reading-table compare-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Next 24 hours' }), el('th', { scope: 'col', text: 'High / low' }), el('th', { scope: 'col', text: 'Rain and snow' }), el('th', { scope: 'col', text: 'Top wind' }))),
      el('tbody', {}, ...rows),
    ),
    el('p', { class: 'reading-note' }, el('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener', text: 'Weather data by Open-Meteo.com' }), '.'),
  );
  chartBox.append(comparisonChart(models, system, Math.max(320, box.clientWidth || 640)));
}

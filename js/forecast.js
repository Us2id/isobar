// Fetches a forecast for one spot and puts it in one shape, whichever service it came from.
// Inside the US that is the National Weather Service. Elsewhere, or when NWS is down, Open-Meteo.
import { NWS_API, NWS_COVERAGE, OPEN_METEO_API } from './config.js';
import { pointInBoxes } from './geo.js';
import { compassToDegrees } from './units.js';
import { formatCoordinates, formatWeekday } from './format.js';

const TIMEOUT_MS = 20_000;
const HOUR = 3_600_000;

export class ServiceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function withTimeout(signal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!signal) return timeout;
  return AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;
}

async function getJson(url, { signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal: withTimeout(signal) });
  if (!response.ok) throw new ServiceError(`${url} returned ${response.status}`, response.status);
  return response.json();
}

// NWS forecast endpoints fail now and then and work on the next try, so give them one retry.
async function getJsonWithRetry(url, options) {
  try {
    return await getJson(url, options);
  } catch (error) {
    if (options?.signal?.aborted || (error.status && error.status < 500)) throw error;
    return getJson(url, options);
  }
}

const fToC = (f) => ((f - 32) * 5) / 9;

// NWS writes "Mostly Sunny". Open-Meteo's words and the rest of the page use sentence case.
const sentenceCase = (text) => {
  const lower = String(text ?? 'Not available').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};
const mphToMs = (mph) => mph * 0.44704;

// "5 mph" or "5 to 10 mph". The higher number is what someone outdoors should plan for.
export function parseNwsWindSpeed(text) {
  const numbers = String(text ?? '').match(/\d+/g);
  return numbers ? mphToMs(Math.max(...numbers.map(Number))) : null;
}

export function nwsHours(periods) {
  return periods.map((period) => ({
    start: Date.parse(period.startTime),
    end: Date.parse(period.endTime),
    tempC: period.temperatureUnit === 'F' ? fToC(period.temperature) : period.temperature,
    rainPercent: period.probabilityOfPrecipitation?.value ?? 0,
    windMs: parseNwsWindSpeed(period.windSpeed),
    windFromDegrees: compassToDegrees(period.windDirection),
    summary: sentenceCase(period.shortForecast),
    isDay: period.isDaytime,
  }));
}

// NWS lists days and nights separately. Each row pairs a day with the night after it.
export function nwsDays(periods) {
  const rows = [];
  for (const period of periods) {
    const tempC = period.temperatureUnit === 'F' ? fToC(period.temperature) : period.temperature;
    if (period.isDaytime) {
      rows.push({ label: period.name, highC: tempC, lowC: null, summary: sentenceCase(period.shortForecast) });
    } else if (rows.length > 0 && rows.at(-1).lowC === null && rows.at(-1).highC !== null) {
      rows.at(-1).lowC = tempC;
    } else {
      rows.push({ label: period.name, highC: null, lowC: tempC, summary: sentenceCase(period.shortForecast) });
    }
  }
  return rows.slice(0, 7);
}

const WMO_SUMMARIES = new Map([
  [[0], 'Clear'], [[1], 'Mostly clear'], [[2], 'Partly cloudy'], [[3], 'Cloudy'],
  [[45, 48], 'Fog'],
  [[51, 53, 55], 'Drizzle'], [[56, 57], 'Freezing drizzle'],
  [[61], 'Light rain'], [[63], 'Rain'], [[65], 'Heavy rain'], [[66, 67], 'Freezing rain'],
  [[71], 'Light snow'], [[73], 'Snow'], [[75], 'Heavy snow'], [[77], 'Snow grains'],
  [[80], 'Light showers'], [[81], 'Showers'], [[82], 'Heavy showers'], [[85, 86], 'Snow showers'],
  [[95], 'Thunderstorms'], [[96, 99], 'Thunderstorms with hail'],
]);

export function wmoSummary(code) {
  for (const [codes, summary] of WMO_SUMMARIES) if (codes.includes(code)) return summary;
  return 'Not available';
}

export function openMeteoHours(hourly) {
  return hourly.time.map((time, i) => ({
    start: time * 1000,
    end: time * 1000 + HOUR,
    tempC: hourly.temperature_2m[i],
    rainPercent: hourly.precipitation_probability[i] ?? 0,
    windMs: hourly.wind_speed_10m[i],
    windFromDegrees: hourly.wind_direction_10m[i],
    summary: wmoSummary(hourly.weather_code[i]),
    isDay: hourly.is_day[i] === 1,
  }));
}

export function openMeteoDays(daily, timeZone) {
  return daily.time.map((time, i) => ({
    label: i === 0 ? 'Today' : formatWeekday(time * 1000, { timeZone }),
    highC: daily.temperature_2m_max[i],
    lowC: daily.temperature_2m_min[i],
    summary: wmoSummary(daily.weather_code[i]),
  }));
}

const upcoming = (hours, now, count = 48) => hours.filter((hour) => hour.end > now).slice(0, count);

async function loadFromNws(lat, lng, now, options) {
  const point = await getJson(`${NWS_API}/points/${lat},${lng}`, options);
  const { forecast, forecastHourly, timeZone, relativeLocation } = point.properties;
  if (!forecast || !forecastHourly) throw new ServiceError('NWS has no forecast for this point', 404);
  const [hourly, daily] = await Promise.all([
    getJsonWithRetry(forecastHourly, options),
    getJsonWithRetry(forecast, options),
  ]);
  const town = relativeLocation?.properties;
  return {
    source: 'nws',
    place: town ? `Near ${town.city}, ${town.state}` : formatCoordinates(lat, lng),
    timeZone,
    hours: upcoming(nwsHours(hourly.properties.periods), now),
    days: nwsDays(daily.properties.periods),
    issuedAt: Date.parse(hourly.properties.updateTime) || null,
    link: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lng}`,
  };
}

async function loadFromOpenMeteo(lat, lng, now, options) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    wind_speed_unit: 'ms',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: 7,
  });
  const data = await getJson(`${OPEN_METEO_API}?${params}`, options);
  return {
    source: 'open-meteo',
    place: formatCoordinates(lat, lng),
    timeZone: data.timezone,
    hours: upcoming(openMeteoHours(data.hourly), now),
    days: openMeteoDays(data.daily, data.timezone),
    issuedAt: null,
    link: 'https://open-meteo.com/',
  };
}

// NWS rejects more than four decimal places, and a tenth of a kilometre is plenty.
export const roundCoordinate = (value) => Number(value.toFixed(4));

export async function loadForecast(lat, lng, { signal, fetchImpl = fetch, now = Date.now() } = {}) {
  const options = { signal, fetchImpl };
  const latitude = roundCoordinate(lat);
  const longitude = roundCoordinate(lng);
  if (!pointInBoxes(NWS_COVERAGE, latitude, longitude)) {
    return { ...(await loadFromOpenMeteo(latitude, longitude, now, options)), nwsFailed: false };
  }
  try {
    return await loadFromNws(latitude, longitude, now, options);
  } catch (error) {
    if (signal?.aborted) throw error;
    const forecast = await loadFromOpenMeteo(latitude, longitude, now, options);
    // A 404 only means the spot is outside the US. Anything else means NWS itself had a problem.
    return { ...forecast, nwsFailed: error.status !== 404 };
  }
}

const SEVERITY_ORDER = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];
const severityRank = (alert) => {
  const rank = SEVERITY_ORDER.indexOf(alert.severity);
  return rank < 0 ? SEVERITY_ORDER.length : rank;
};

// NWS wraps its text at about 70 characters. Keep the paragraph breaks and drop the rest.
export const tidyAlertText = (text) => (text ?? '').trim().split(/\n{2,}/).map((part) => part.replace(/\n/g, ' ')).join('\n\n');

export function normalizeAlerts(features) {
  return features
    .map(({ properties: p }) => ({
      id: p.id,
      event: p.event,
      severity: p.severity ?? 'Unknown',
      headline: p.headline ?? p.event,
      area: p.areaDesc,
      until: Date.parse(p.ends ?? p.expires) || null,
      description: tidyAlertText(p.description),
      instruction: tidyAlertText(p.instruction),
    }))
    .sort((a, b) => severityRank(a) - severityRank(b));
}

// Outcomes: 'ready', 'notCovered' (NWS doesn't serve this spot) or 'failed' (we couldn't check).
// 'failed' must never be shown as "no alerts": nobody should read an outage as an all-clear.
export async function loadAlertsAt(lat, lng, { signal, fetchImpl = fetch } = {}) {
  if (!pointInBoxes(NWS_COVERAGE, lat, lng)) return { state: 'notCovered', alerts: [] };
  const url = `${NWS_API}/alerts/active?status=actual&point=${roundCoordinate(lat)},${roundCoordinate(lng)}`;
  try {
    const data = await getJson(url, { signal, fetchImpl });
    return { state: 'ready', alerts: normalizeAlerts(data.features) };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.status === 400 || error.status === 404) return { state: 'notCovered', alerts: [] };
    return { state: 'failed', alerts: [] };
  }
}

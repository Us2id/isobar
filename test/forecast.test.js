import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  loadAlertsAt, loadForecast, normalizeAlerts, nwsDays, nwsHours, openMeteoDays, openMeteoHours,
  parseNwsWindSpeed, roundCoordinate, tidyAlertText, wmoSummary,
} from '../js/forecast.js';
import { compassToDegrees, defaultSystem, degreesToCompass, describeWind, fullSpeed, fullTemp } from '../js/units.js';

const near = (actual, expected, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} vs ${expected}`);

test('reads NWS wind text', () => {
  near(parseNwsWindSpeed('10 mph'), 4.47);
  near(parseNwsWindSpeed('5 to 10 mph'), 4.47);
  assert.equal(parseNwsWindSpeed(''), null);
  assert.equal(parseNwsWindSpeed(undefined), null);
});

const HOUR_PERIOD = {
  startTime: '2026-11-06T07:00:00-06:00',
  endTime: '2026-11-06T08:00:00-06:00',
  isDaytime: true,
  temperature: 35,
  temperatureUnit: 'F',
  probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 5 },
  windSpeed: '5 mph',
  windDirection: 'NW',
  shortForecast: 'Cloudy',
};

test('turns an NWS hour into the common shape', () => {
  const [hour] = nwsHours([HOUR_PERIOD]);
  assert.equal(hour.start, Date.UTC(2026, 10, 6, 13));
  assert.equal(hour.end, Date.UTC(2026, 10, 6, 14));
  near(hour.tempC, 1.67);
  assert.equal(hour.rainPercent, 5);
  near(hour.windMs, 2.24);
  assert.equal(hour.windFromDegrees, 315);
  assert.equal(hour.summary, 'Cloudy');
  assert.equal(hour.isDay, true);
});

test('treats a missing rain chance as zero and an unknown direction as unknown', () => {
  const [hour] = nwsHours([{ ...HOUR_PERIOD, probabilityOfPrecipitation: { value: null }, windDirection: 'VRB' }]);
  assert.equal(hour.rainPercent, 0);
  assert.equal(hour.windFromDegrees, null);
});

const period = (name, isDaytime, temperature, shortForecast = 'Clear') => ({ name, isDaytime, temperature, temperatureUnit: 'F', shortForecast });

test('pairs NWS days with the night after them', () => {
  const rows = nwsDays([
    period('Today', true, 50, 'Mostly Cloudy'),
    period('Tonight', false, 32),
    period('Saturday', true, 60, 'Sunny'),
    period('Saturday Night', false, 39),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, 'Today');
  near(rows[0].highC, 10);
  near(rows[0].lowC, 0);
  assert.equal(rows[0].summary, 'Mostly cloudy');
  assert.equal(rows[1].label, 'Saturday');
});

test('handles an NWS forecast that starts at night', () => {
  const rows = nwsDays([period('Tonight', false, 32), period('Saturday', true, 60), period('Saturday Night', false, 39)]);
  assert.equal(rows[0].label, 'Tonight');
  assert.equal(rows[0].highC, null);
  near(rows[0].lowC, 0);
  assert.equal(rows[1].label, 'Saturday');
  assert.ok(rows[1].lowC !== null);
});

test('shows at most seven days', () => {
  const periods = [];
  for (let i = 0; i < 14; i++) periods.push(period(`Day ${i}`, i % 2 === 0, 50));
  assert.equal(nwsDays(periods).length, 7);
});

const OPEN_METEO = {
  timezone: 'Asia/Kolkata',
  hourly: {
    time: [1793903400, 1793907000],
    temperature_2m: [29.1, 28.8],
    precipitation_probability: [10, null],
    wind_speed_10m: [2.17, 1.85],
    wind_direction_10m: [345, 358],
    weather_code: [0, 61],
    is_day: [0, 1],
  },
  daily: {
    time: [1793903400, 1793989800],
    weather_code: [3, 95],
    temperature_2m_max: [36.1, 35],
    temperature_2m_min: [26.4, 26.2],
  },
};

test('turns Open-Meteo data into the common shape', () => {
  const hours = openMeteoHours(OPEN_METEO.hourly);
  assert.equal(hours[0].start, 1793903400000);
  assert.equal(hours[0].end, 1793907000000);
  assert.equal(hours[0].tempC, 29.1);
  assert.equal(hours[0].summary, 'Clear');
  assert.equal(hours[0].isDay, false);
  assert.equal(hours[1].rainPercent, 0);
  assert.equal(hours[1].summary, 'Light rain');
  assert.equal(hours[1].isDay, true);
  const days = openMeteoDays(OPEN_METEO.daily, 'Asia/Kolkata');
  assert.equal(days[0].label, 'Today');
  assert.equal(days[0].highC, 36.1);
  assert.equal(days[1].summary, 'Thunderstorms');
  assert.equal(days[1].label.length > 0, true);
});

test('names weather codes, with a safe answer for unknown ones', () => {
  assert.equal(wmoSummary(0), 'Clear');
  assert.equal(wmoSummary(96), 'Thunderstorms with hail');
  assert.equal(wmoSummary(1234), 'Not available');
});

test('rounds coordinates to what NWS accepts', () => {
  assert.equal(roundCoordinate(39.745612), 39.7456);
  assert.equal(roundCoordinate(39.70001), 39.7);
  assert.equal(`${roundCoordinate(-97.08)}`, '-97.08');
});

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const [pattern, reply] of routes) {
      if (url.includes(pattern)) return typeof reply === 'function' ? reply(url) : reply;
    }
    throw new Error(`unexpected request: ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const POINT = json({
  properties: {
    forecast: 'https://nws.test/forecast',
    forecastHourly: 'https://nws.test/forecast/hourly',
    timeZone: 'America/Chicago',
    relativeLocation: { properties: { city: 'Linn', state: 'KS' } },
  },
});
const HOURLY = json({ properties: { updateTime: '2026-11-06T10:52:02+00:00', periods: [HOUR_PERIOD] } });
const DAILY = json({ properties: { periods: [period('Today', true, 50)] } });
const METEO = json(OPEN_METEO);
const NOW = Date.UTC(2026, 10, 6, 13, 30);

test('uses the National Weather Service inside the US', async () => {
  const fetchImpl = stubFetch([['/points/', POINT], ['/hourly', HOURLY], ['/forecast', DAILY]]);
  const result = await loadForecast(39.74561, -97.08921, { fetchImpl, now: NOW });
  assert.equal(result.source, 'nws');
  assert.equal(result.place, 'Near Linn, KS');
  assert.equal(result.timeZone, 'America/Chicago');
  assert.equal(result.hours.length, 1);
  assert.equal(result.days.length, 1);
  assert.equal(result.issuedAt, Date.UTC(2026, 10, 6, 10, 52, 2));
  assert.equal(result.link, 'https://forecast.weather.gov/MapClick.php?lat=39.7456&lon=-97.0892');
  assert.ok(fetchImpl.calls[0].endsWith('/points/39.7456,-97.0892'));
});

test('goes straight to Open-Meteo far outside the US', async () => {
  const fetchImpl = stubFetch([['open-meteo', METEO]]);
  const result = await loadForecast(19.07, 72.87, { fetchImpl, now: 1793903400000 });
  assert.equal(result.source, 'open-meteo');
  assert.equal(result.place, '19.07°N, 72.87°E');
  assert.equal(result.timeZone, 'Asia/Kolkata');
  assert.equal(result.nwsFailed, false);
  assert.equal(fetchImpl.calls.length, 1, 'NWS is not asked about places it cannot cover');
  const request = new URL(fetchImpl.calls[0]);
  assert.equal(request.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(request.searchParams.get('timezone'), 'auto');
});

test('treats a "not mine" answer from NWS near the US as normal, not a failure', async () => {
  const fetchImpl = stubFetch([['/points/', json({}, 404)], ['open-meteo', METEO]]);
  const result = await loadForecast(19.43, -99.13, { fetchImpl, now: 1793903400000 });
  assert.equal(result.source, 'open-meteo');
  assert.equal(result.nwsFailed, false);
});

test('falls back to Open-Meteo when NWS is down, and says so', async () => {
  const fetchImpl = stubFetch([['/points/', json({}, 500)], ['open-meteo', METEO]]);
  const result = await loadForecast(39.7, -97.1, { fetchImpl, now: 1793903400000 });
  assert.equal(result.source, 'open-meteo');
  assert.equal(result.nwsFailed, true);
});

test('retries a flaky NWS forecast once before giving up on it', async () => {
  let attempts = 0;
  const flaky = () => {
    attempts += 1;
    return attempts === 1 ? json({}, 500) : HOURLY;
  };
  const fetchImpl = stubFetch([['/points/', POINT], ['/hourly', flaky], ['/forecast', DAILY]]);
  const result = await loadForecast(39.7, -97.1, { fetchImpl, now: NOW });
  assert.equal(result.source, 'nws');
  assert.equal(attempts, 2);
});

test('handles a point NWS knows but has no town or forecast for', async () => {
  const noTown = json({ properties: { forecast: 'https://nws.test/forecast', forecastHourly: 'https://nws.test/forecast/hourly', timeZone: 'UTC', relativeLocation: null } });
  const withoutTown = await loadForecast(30.5, -80.5, { fetchImpl: stubFetch([['/points/', noTown], ['/hourly', HOURLY], ['/forecast', DAILY]]), now: NOW });
  assert.equal(withoutTown.place, '30.50°N, 80.50°W');

  const noForecast = json({ properties: { forecast: null, forecastHourly: null, timeZone: 'UTC', relativeLocation: null } });
  const fetchImpl = stubFetch([['open-meteo', METEO], ['/points/', noForecast]]);
  const fallback = await loadForecast(30.5, -80.5, { fetchImpl, now: 1793903400000 });
  assert.equal(fallback.source, 'open-meteo');
  assert.equal(fallback.nwsFailed, false);
});

test('falls back when an NWS forecast keeps failing', async () => {
  const fetchImpl = stubFetch([['open-meteo', METEO], ['/points/', POINT], ['/hourly', json({}, 503)], ['/forecast', DAILY]]);
  const result = await loadForecast(39.7, -97.1, { fetchImpl, now: 1793903400000 });
  assert.equal(result.source, 'open-meteo');
  assert.equal(result.nwsFailed, true);
});

test('fails when both services are down', async () => {
  const fetchImpl = stubFetch([['/points/', json({}, 500)], ['open-meteo', json({}, 500)]]);
  await assert.rejects(loadForecast(39.7, -97.1, { fetchImpl }));
});

test('does not try the fallback once the visitor has moved on', async () => {
  const controller = new AbortController();
  const fetchImpl = stubFetch([['/points/', () => {
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  }]]);
  await assert.rejects(loadForecast(39.7, -97.1, { fetchImpl, signal: controller.signal }));
  assert.equal(fetchImpl.calls.length, 1);
});

test('drops hours that have already passed and keeps 48', async () => {
  const start = Date.UTC(2026, 10, 6, 10);
  const periods = Array.from({ length: 100 }, (_, i) => ({
    ...HOUR_PERIOD,
    startTime: new Date(start + i * 3_600_000).toISOString(),
    endTime: new Date(start + (i + 1) * 3_600_000).toISOString(),
  }));
  const hourly = json({ properties: { updateTime: 'x', periods } });
  const fetchImpl = stubFetch([['/points/', POINT], ['/hourly', hourly], ['/forecast', DAILY]]);
  const result = await loadForecast(39.7, -97.1, { fetchImpl, now: Date.UTC(2026, 10, 6, 13, 30) });
  assert.equal(result.hours.length, 48);
  assert.equal(result.hours[0].start, Date.UTC(2026, 10, 6, 13));
  assert.equal(result.issuedAt, null, 'an unreadable time is left out, not shown wrong');
});

test('joins wrapped alert text but keeps paragraphs', () => {
  assert.equal(tidyAlertText('\nFirst line\nsame sentence.\n\nNext paragraph.\n'), 'First line same sentence.\n\nNext paragraph.');
  assert.equal(tidyAlertText(null), '');
});

test('sorts alerts with the most severe first', () => {
  const feature = (event, severity, extra = {}) => ({ properties: { id: event, event, severity, areaDesc: 'A', expires: '2026-11-06T18:00:00Z', ...extra } });
  const alerts = normalizeAlerts([
    feature('Frost Advisory', 'Minor'),
    feature('Tornado Warning', 'Extreme', { ends: '2026-11-06T14:00:00Z', headline: 'Take cover' }),
    feature('Odd', 'Bizarre'),
    feature('Wind Advisory', 'Moderate'),
  ]);
  assert.deepEqual(alerts.map((alert) => alert.event), ['Tornado Warning', 'Wind Advisory', 'Frost Advisory', 'Odd']);
  assert.equal(alerts[0].until, Date.UTC(2026, 10, 6, 14), 'uses the end time when there is one');
  assert.equal(alerts[0].headline, 'Take cover');
  assert.equal(alerts[1].until, Date.UTC(2026, 10, 6, 18), 'otherwise uses the expiry');
  assert.equal(alerts[1].headline, 'Wind Advisory');
  assert.equal(normalizeAlerts([{ properties: { event: 'X' } }])[0].severity, 'Unknown');
});

test('tells "no alerts", "not covered" and "could not check" apart', async () => {
  const replyWith = (reply) => stubFetch([['/alerts/', reply]]);
  const none = await loadAlertsAt(39.7, -97.1, { fetchImpl: replyWith(json({ features: [] })) });
  assert.deepEqual(none, { state: 'ready', alerts: [] });
  const nearby = await loadAlertsAt(49.15, -60.71, { fetchImpl: replyWith(json({}, 400)) });
  assert.equal(nearby.state, 'notCovered');
  const abroad = await loadAlertsAt(19.07, 72.87, { fetchImpl: async () => assert.fail('should not ask NWS') });
  assert.equal(abroad.state, 'notCovered');
  const outage = await loadAlertsAt(39.7, -97.1, { fetchImpl: replyWith(json({}, 503)) });
  assert.equal(outage.state, 'failed');
  const offline = await loadAlertsAt(39.7, -97.1, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(offline.state, 'failed');
});

test('only asks for real alerts, not tests', async () => {
  const fetchImpl = stubFetch([['/alerts/', json({ features: [] })]]);
  await loadAlertsAt(39.74561, -97.08921, { fetchImpl });
  assert.ok(fetchImpl.calls[0].endsWith('/alerts/active?status=actual&point=39.7456,-97.0892'));
});

test('converts units for display', () => {
  assert.equal(fullTemp(0, 'imperial'), '32°F');
  assert.equal(fullTemp(21.4, 'metric'), '21°C');
  assert.equal(fullTemp(((35 - 32) * 5) / 9, 'imperial'), '35°F', 'a Fahrenheit forecast survives the round trip');
  assert.equal(fullSpeed(10, 'imperial'), '22 mph');
  assert.equal(fullSpeed(10, 'metric'), '36 km/h');
});

test('picks units from the browser language', () => {
  assert.equal(defaultSystem('en-US'), 'imperial');
  assert.equal(defaultSystem('en-IN'), 'metric');
  assert.equal(defaultSystem(undefined), 'metric');
});

test('names compass points both ways', () => {
  assert.equal(degreesToCompass(0), 'N');
  assert.equal(degreesToCompass(359), 'N');
  assert.equal(degreesToCompass(-45), 'NW');
  assert.equal(degreesToCompass(22.5), 'NNE');
  assert.equal(degreesToCompass(270), 'W');
  assert.equal(compassToDegrees('SW'), 225);
  assert.equal(compassToDegrees('VRB'), null);
});

test('describes wind in words', () => {
  assert.equal(describeWind(10, 270, 'imperial'), 'Wind from W at 22 mph');
  assert.equal(describeWind(10, null, 'metric'), 'Wind at 36 km/h');
  assert.equal(describeWind(0.1, 90, 'metric'), 'Calm');
  assert.equal(describeWind(null, null, 'metric'), 'Wind not available');
});

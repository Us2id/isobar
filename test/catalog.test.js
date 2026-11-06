import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aqiFromPm25, FIELDS, fieldById, FLOW_LEVELS, referenceEvapotranspiration, saturationVaporPressure, sourceFor, usesFallback, wetBulb } from '../js/catalog/fields.js';
import { IMAGERY } from '../js/catalog/imagery.js';
import { FIELD_GROUPS, MODELS, openingView, PANE_ORDER } from '../js/config.js';
import { contourSegments, pressureCenters } from '../js/isobars.js';
import { buildLookup, legendGradient, legendLabels, RAMPS } from '../js/palettes.js';
import { PRODUCTS } from '../js/sources.js';
import { flightCategory } from '../js/points-layers.js';
import { formatNumber, formatValue, SYSTEMS, unitLabel } from '../js/units.js';
import { paintTile, tileLatitudes, tileLongitudes } from '../js/field-paint.js';
import { adaptStyle, PLACE_LADDER, splitStyle, tunePlaceLabels } from '../js/basemap.js';
import { chooseGibsTime, dayBefore, describeGibsTime, isDailyStamp } from '../js/gibs-day.js';
import { geocoderResults, parseCoordinates } from '../js/search.js';
import { describeOffset, timelineSteps } from '../js/timeline.js';
import { summarize, SECTIONS } from '../js/point-data.js';

const groupIds = new Set(FIELD_GROUPS.map((group) => group.id));
const noaaLevel = /./;

test('every layer has what the panel needs', () => {
  const ids = new Set();
  for (const entry of [...FIELDS, ...IMAGERY]) {
    assert.ok(entry.id, 'has an id');
    assert.ok(!ids.has(entry.id), `${entry.id} is unique`);
    ids.add(entry.id);
    assert.ok(groupIds.has(entry.group), `${entry.id} is in a known group`);
    assert.ok(entry.name.length > 2, `${entry.id} has a name`);
    assert.ok(entry.about.length > 8, `${entry.id} explains itself`);
  }
});

test('every forecast field has a valid source and color ramp', () => {
  for (const entry of FIELDS) {
    assert.ok(entry.ramp?.stops?.length >= 2, `${entry.id} has a ramp`);
    assert.ok(entry.unit, `${entry.id} has a unit`);
    if (entry.unit !== 'category') for (const system of Object.keys(SYSTEMS)) assert.equal(typeof formatValue(entry.ramp.stops[0][0], entry.unit, system), 'string');
    const sources = Object.entries(entry.sources);
    assert.ok(sources.length > 0, `${entry.id} has a source`);
    for (const [model, source] of sources) {
      assert.ok(['default', 'gfs', 'ecmwf', 'aifs'].includes(model), `${entry.id}: ${model}`);
      assert.ok(PRODUCTS[source.product], `${entry.id} uses a known product`);
      assert.equal(typeof source.value, 'function');
      assert.ok(source.fields.length > 0);
      assert.ok(source.value.length <= source.fields.length || source.value.length === 0, `${entry.id}: formula takes at most ${source.fields.length} inputs`);
      for (const field of source.fields) assert.ok(field.v ? noaaLevel.test(field.l) : field.p, `${entry.id} names its field`);
    }
    const values = entry.ramp.stops.map((stop) => stop[0]);
    for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1], `${entry.id}: ramp stops rise`);
  }
});

test('ramps build lookups and legends', () => {
  for (const [name, ramp] of Object.entries(RAMPS)) {
    const lookup = buildLookup(ramp);
    assert.equal(lookup.rgba.length, lookup.size * 4, name);
    assert.match(legendGradient(ramp), /^linear-gradient/);
    for (const { position } of legendLabels(ramp)) assert.ok(position >= 0 && position <= 100, name);
  }
});

test('a lookup reproduces its stops, and clear stops are clear', () => {
  const lookup = buildLookup({ stops: [[0, '#000000', 0], [10, '#ff0000']] }, 11);
  const at = (slot) => [...lookup.rgba.slice(slot * 4, slot * 4 + 4)];
  assert.deepEqual(at(0), [0, 0, 0, 0]);
  assert.deepEqual(at(10), [255, 0, 0, 255]);
  assert.deepEqual(at(5).map(Math.round), [128, 0, 0, 128]);
});

test('discrete ramps have hard edges', () => {
  const lookup = buildLookup(RAMPS.ptype);
  const color = (value) => [...lookup.rgba.slice(Math.round((value - lookup.min) * lookup.scale) * 4, Math.round((value - lookup.min) * lookup.scale) * 4 + 4)];
  assert.equal(color(0)[3], 0, 'none is clear');
  assert.deepEqual(color(1), [0x3f, 0xae, 0x5a, 255]);
  assert.deepEqual(color(2), [0x6a, 0xa8, 0xff, 255]);
  assert.deepEqual(color(4), [0xff, 0xb3, 0x47, 255]);
});

test('every image layer is built right', () => {
  for (const entry of IMAGERY) {
    assert.ok(['gibs', 'arcgis', 'wms', 'radarProduct'].includes(entry.kind), entry.id);
    if (entry.kind === 'gibs') {
      assert.ok(entry.level >= 6 && entry.level <= 13, `${entry.id} has a zoom level`);
      assert.ok(['png', 'jpg'].includes(entry.ext), entry.id);
    }
    if (entry.kind === 'arcgis') assert.match(entry.service, /(MapServer|ImageServer)$/, entry.id);
  }
});

test('the panes for each layer exist', () => {
  for (const pane of ['satelliteWorld', 'satelliteGoes', 'fill', 'alerts', 'radar', 'lightning', 'isobars', 'storms', 'wind', 'currents', 'worldradar', 'clickable']) assert.ok(PANE_ORDER.includes(pane), pane);
});

test('every model on offer has flow levels and core layers', () => {
  for (const { id } of MODELS) {
    for (const level of FLOW_LEVELS) assert.ok(fieldById(level.id).sources[id], `${level.id} from ${id}`);
    for (const core of ['t2m', 'mslp', 'w10', 'rain24']) assert.ok(fieldById(core).sources[id], `${core} from ${id}`);
  }
});

test('asks for the chosen model, falling back to GFS when a field has no such source', () => {
  const both = fieldById('t2m');
  assert.equal(sourceFor(both, 'ecmwf').product, 'ecmwf');
  assert.equal(usesFallback(both, 'ecmwf'), false);
  const gfsOnly = fieldById('feels');
  assert.equal(sourceFor(gfsOnly, 'ecmwf').product, 'gfs');
  assert.equal(usesFallback(gfsOnly, 'ecmwf'), true);
  const shared = fieldById('waveheight');
  assert.equal(sourceFor(shared, 'ecmwf').product, 'wave');
  assert.equal(usesFallback(shared, 'ecmwf'), false, 'a layer with one source for everyone is not a fallback');
});

test('computes the formulas behind derived fields', () => {
  assert.ok(Math.abs(saturationVaporPressure(20) - 2.338) < 0.01);
  assert.ok(Math.abs(wetBulb(293.15, 50) - 13.7) < 0.3, 'Stull: 20°C at 50% is about 13.7°C');
  assert.equal(aqiFromPm25(0), 0);
  assert.equal(aqiFromPm25(9), 50);
  assert.ok(Math.abs(aqiFromPm25(35.4) - 100) < 0.01);
  assert.ok(Math.abs(aqiFromPm25(55.4) - 150) < 0.01);
  assert.equal(aqiFromPm25(1000), 500);
  assert.ok(Number.isNaN(aqiFromPm25(NaN)));
});

test('reference evapotranspiration matches a hand calculation', () => {
  // FAO-56 worked example 19: 38°C, 52% humidity (es 6.625, ea 3.445 kPa), u2 = 3.3 m/s, Rn = 1.749 MJ/m²/h,
  // sea-level-ish pressure, gives about 0.63 mm/h, or 15 mm/day at that rate.
  const dewK = 273.15 + 26.3; // ea of about 3.42 kPa
  const netWatts = 1.749 / 0.0036;
  const rate = referenceEvapotranspiration(311.15, dewK, 3.3 / 0.748, 0, 101_300, netWatts, 0, 0, 0);
  assert.ok(rate > 13 && rate < 17, `got ${rate} mm/day`);
  assert.equal(referenceEvapotranspiration(283.15, 283.15, 0, 0, 101_300, 0, 0, 200, 300), 0, 'no drying at night in still, saturated air');
});

test('formats values in both unit systems', () => {
  assert.equal(formatValue(20, 'temp', 'metric'), '20°C');
  assert.equal(formatValue(20, 'temp', 'imperial'), '68°F');
  assert.equal(formatValue(10, 'speed', 'metric'), '36 km/h');
  assert.equal(formatValue(25.4, 'depth', 'imperial'), '1 in');
  assert.equal(formatValue(2.5, 'rate', 'metric'), '2.5 mm/h');
  assert.equal(formatValue(1013, 'pressure', 'metric'), '1013 hPa');
  assert.equal(formatValue(1013, 'pressure', 'imperial'), '29.91 inHg');
  assert.equal(formatValue(42, 'percent', 'metric'), '42%');
  assert.equal(formatValue(270, 'direction', 'metric'), 'from W (270°)');
  assert.equal(formatValue(2, 'category', 'metric', ['None', 'Rain', 'Snow']), 'Snow');
  assert.equal(formatValue(55, { u: 'DU', dp: 0 }, 'metric'), '55 DU');
  assert.equal(formatValue(0.42, { u: '', dp: 2 }, 'metric'), '0.42');
  assert.equal(formatNumber(1200.4, 'height', 'imperial'), '3938');
  assert.equal(formatValue(-0.3, 'temp', 'metric'), '0°C', 'never "-0"');
  assert.equal(formatValue(-1.4, 'temp', 'metric'), '-1°C');
  assert.equal(unitLabel('temp', 'imperial'), '°F');
  assert.equal(unitLabel('direction', 'metric'), '');
});

test('finds map pixels in the right place', () => {
  const lats = tileLatitudes(0, 0, 256);
  assert.ok(lats[0] > 84.9 && lats[0] < 85.06);
  assert.ok(Math.abs(lats[127] + lats[128]) < 1e-9, 'symmetrical about the equator');
  const lngs = tileLongitudes(1, 1, 2);
  assert.equal(lngs[0], 45);
  assert.equal(lngs[1], 135);
});

test('paints the color for each value, and leaves gaps clear', () => {
  const grid = { nx: 4, ny: 2, dx: 90, dy: 170, la1: 85, lo1: 0 };
  const values = new Float32Array(8).fill(10);
  values[0] = NaN;
  values[1] = NaN;
  values[3] = NaN;
  values[4] = NaN;
  values[5] = NaN;
  values[7] = NaN;
  const lookup = buildLookup({ stops: [[0, '#000000'], [10, '#ff0000']] });
  const rgba = new Uint8ClampedArray(16 * 16 * 4);
  paintTile(rgba, 16, { x: 0, y: 0, z: 0 }, grid, values, lookup);
  let painted = 0;
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 255) {
      painted += 1;
      assert.equal(rgba[i - 3], 255, 'painted pixels are the color for 10');
    } else clear += 1;
  }
  assert.ok(painted > 0 && clear > 0);
});

test('traces contour lines where a field crosses the level', () => {
  const grid = { nx: 4, ny: 2, dx: 1, dy: 1, la1: 1, lo1: 0 };
  const values = Float32Array.from([0, 10, 10, 0, 0, 10, 10, 0]);
  const segments = contourSegments(grid, values, 5);
  assert.ok(segments.length >= 2);
  for (const segment of segments) {
    assert.equal(segment.length, 2);
    for (const [lat, lng] of segment) {
      assert.ok(lat >= 0 && lat <= 1);
      assert.ok(Math.abs(lng - 0.5) < 1e-9 || Math.abs(lng - 2.5) < 1e-9, `crosses halfway: ${lng}`);
    }
  }
  assert.deepEqual(contourSegments(grid, values, 50), []);
});

test('finds pressure highs and lows', () => {
  const nx = 40;
  const ny = 30;
  const values = new Float32Array(nx * ny).fill(1012);
  values[15 * nx + 10] = 1030;
  values[15 * nx + 30] = 985;
  const centers = pressureCenters({ nx, ny, dx: 1, dy: 1, la1: 15, lo1: 0 }, values);
  assert.equal(centers.length, 2);
  const high = centers.find((center) => center.kind === 'H');
  const low = centers.find((center) => center.kind === 'L');
  assert.equal(high.value, 1030);
  assert.equal(high.lat, 0);
  assert.equal(high.lng, 10);
  assert.equal(low.value, 985);
  assert.equal(low.lng, 30);
});

test('works out flight rules from visibility and cloud ceiling', () => {
  assert.equal(flightCategory({ vsby: 10, skyc1: 'FEW', skyl1: 3000 }), 'VFR');
  assert.equal(flightCategory({ vsby: 4 }), 'MVFR');
  assert.equal(flightCategory({ vsby: 10, skyc1: 'BKN', skyl1: 2500 }), 'MVFR');
  assert.equal(flightCategory({ vsby: 2 }), 'IFR');
  assert.equal(flightCategory({ vsby: 10, skyc1: 'SCT', skyl1: 800, skyc2: 'OVC', skyl2: 900 }), 'IFR');
  assert.equal(flightCategory({ vsby: 0.5 }), 'LIFR');
  assert.equal(flightCategory({ vsby: 10, skyc1: 'VV', skyl1: 300 }), 'LIFR');
  assert.equal(flightCategory({}), 'VFR', 'no bad news reported');
});

test('understands typed coordinates, and rejects anything else', () => {
  assert.deepEqual(parseCoordinates('19.07, 72.87'), { lat: 19.07, lng: 72.87, name: '19.07°N, 72.87°E', detail: 'Coordinates' });
  assert.equal(parseCoordinates('-33.5 -70.6').lat, -33.5);
  assert.equal(parseCoordinates('95, 10'), null);
  assert.equal(parseCoordinates('10, 200'), null);
  assert.equal(parseCoordinates('Mumbai'), null);
});

test('describes search results in plain words', () => {
  const [airport] = geocoderResults([{ latitude: 40.6, longitude: -73.8, name: 'JFK', feature_code: 'AIRP', admin1: 'New York', country: 'United States' }]);
  assert.equal(airport.detail, 'Airport, New York, United States');
  assert.deepEqual(geocoderResults(undefined), []);
});

test('offers time steps the way NOAA spaces its files', () => {
  const steps = timelineSteps();
  assert.equal(steps[0], 0);
  assert.equal(steps[120], 120);
  assert.equal(steps[121], 123);
  assert.equal(steps.at(-1), 384);
  assert.equal(describeOffset(0), 'Now');
  assert.equal(describeOffset(1), 'In 1 hour');
  assert.equal(describeOffset(18), 'In 18 hours');
  assert.equal(describeOffset(96), 'In 4 days');
});

test('summarizes a reading for this hour and the next day', () => {
  const start = 1_800_000_000;
  const times = Array.from({ length: 48 }, (_, i) => start + i * 3600);
  const values = times.map((_, i) => i);
  const result = summarize(times, values, (x) => x * 10, (start + 5.5 * 3600) * 1000);
  assert.deepEqual(result, { now: 50, low: 50, high: 280 });
  assert.equal(summarize(times, new Array(48).fill(null), null, start * 1000), null, 'no readings means nothing to show');
});

test('every point reading names a unit that can be shown', () => {
  for (const section of Object.values(SECTIONS)) {
    for (const [label, variable, unit] of section.rows) {
      assert.ok(label && variable);
      assert.equal(typeof formatValue(1, unit, 'metric'), 'string', label);
    }
  }
});

test('NASA layers that come out often show the image before the newest', () => {
  const now = Date.UTC(2026, 10, 6, 15, 30);
  const time = (newest, previous) => chooseGibsTime(newest, previous, now).time;
  assert.equal(time('2026-11-06T00:00:00Z', '2026-11-05T00:00:00Z'), '2026-11-05', 'today is still filling in');
  assert.equal(time('2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z'), '2026-11-01', 'a slow daily layer is the same');
  assert.equal(time('2026-10-28T00:00:00Z', '2026-10-24T00:00:00Z'), '2026-10-24', 'a 4-day layer is the same');
  assert.equal(time('2026-08-01T00:00:00Z', '2026-07-01T00:00:00Z'), '2026-08-01', 'a monthly layer keeps its newest');
  assert.equal(time('2026-11-06T00:00:00Z', null), '2026-11-05', 'with no answer about the day before, today still is not used');
  assert.equal(time('2026-11-03T00:00:00Z', null), '2026-11-03');
  assert.equal(time('2026-11-06T14:30:00Z'), '2026-11-06T14:30:00Z', 'layers that update during the day pin the exact time');
  assert.equal(time(null), 'default');
  assert.equal(time('1999-01-01T00:00:00Z'), 'default', 'a placeholder date means the layer has no date');
  assert.equal(describeGibsTime(chooseGibsTime(null, null, now)), null);
  assert.match(describeGibsTime(chooseGibsTime('2026-11-06T00:00:00Z', '2026-11-05T00:00:00Z', now)), /Image from .*5/);
  assert.equal(isDailyStamp('2026-11-06T00:00:00Z'), true);
  assert.equal(isDailyStamp('2026-11-06T13:11:52Z'), false);
  assert.equal(isDailyStamp(null), false);
  assert.equal(dayBefore('2026-11-01T00:00:00Z'), '2026-10-31');
});

test('names and borders go above the weather, and the ground stays below', () => {
  const style = {
    version: 8,
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill', 'source-layer': 'water' },
      { id: 'road', type: 'line', 'source-layer': 'transportation' },
      { id: 'border', type: 'line', 'source-layer': 'boundary' },
      { id: 'city', type: 'symbol', 'source-layer': 'place' },
    ],
  };
  const { ground, labels } = splitStyle(style);
  assert.deepEqual(ground.layers.map((layer) => layer.id), ['background', 'water', 'road']);
  assert.deepEqual(labels.layers.map((layer) => layer.id), ['border', 'city']);
  assert.deepEqual(labels.sources, style.sources);
  assert.notEqual(labels.sources, ground.sources, 'each copy of the map owns its own style');
});

test('opens on the visitor\'s part of the world, with the radar that covers it', () => {
  const india = openingView('Asia/Kolkata', 330);
  assert.equal(india.radar, 'worldradar');
  assert.deepEqual(india.center, [25, 82.5]);
  assert.equal(openingView('Europe/Paris', 60).center[0], 48);
  assert.equal(openingView('Australia/Sydney', 660).center[0], -28);
  assert.equal(openingView('America/Sao_Paulo', -180).radar, 'worldradar', 'Brazil is outside US radar');
  assert.equal(openingView('America/Sao_Paulo', -180).center[0], -18);
  assert.equal(openingView('America/Toronto', -300).center[0], 25);
  assert.equal(openingView('Pacific/Auckland', 780).center[1], 170, 'stays on the map');
  const newYork = openingView('America/New_York', -300);
  assert.equal(newYork.radar, 'radar');
  assert.ok(newYork.bounds);
  assert.ok(openingView('America/Indiana/Knox', -360).bounds);
  assert.equal(openingView(undefined, 0).radar, 'worldradar', 'an unknown zone still opens somewhere sensible');
});

const PLACE_STYLE = {
  version: 8,
  sources: { openmaptiles: { type: 'vector' } },
  layers: [
    { id: 'water', type: 'fill', 'source-layer': 'water' },
    { id: 'water_name', type: 'symbol', 'source-layer': 'water_name', layout: { 'text-field': ['get', 'name'] } },
    { id: 'place_other', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 10 } },
    { id: 'place_town', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 10 } },
    { id: 'place_city', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 10 }, paint: { 'text-color': 'red' } },
    { id: 'place_city_large', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 14 } },
    { id: 'place_state', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 10 } },
    { id: 'place_country_minor', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 11 } },
    { id: 'place_country_major', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 12 } },
    { id: 'place_continent', type: 'symbol', 'source-layer': 'place', layout: { 'text-size': 12 } },
    { id: 'boundary', type: 'line', 'source-layer': 'boundary' },
  ],
};

test('place names follow the ladder: countries first, then states, then cities, then towns', () => {
  const { layers } = tunePlaceLabels(PLACE_STYLE);
  const ids = layers.map((layer) => layer.id);
  assert.deepEqual(ids.slice(0, 2), ['water', 'water_name'], 'layers before the names stay put');
  assert.equal(ids.at(-1), 'boundary', 'layers after them too');
  assert.ok(!ids.some((id) => id.startsWith('place_')), 'the originals are replaced');
  const by = Object.fromEntries(layers.map((layer) => [layer.id, layer]));
  assert.equal(by['place-country-major'].minzoom, 0);
  assert.ok(by['place-state-major'].minzoom >= 4, 'no state names while a continent is in view');
  assert.ok(by['place-city-1'].minzoom >= 3);
  assert.ok(by['place-town'].minzoom >= 7);
  assert.ok(by['place-village'] === undefined, 'a tier whose original is missing is skipped');
  assert.ok(ids.indexOf('place-city-1') < ids.indexOf('place-state-major'), 'states beat cities when names collide');
  assert.ok(ids.indexOf('place-state-major') < ids.indexOf('place-country-major'), 'countries beat states');
  assert.deepEqual(by['place-city-3'].filter, ['all', ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false], ['match', ['get', 'class'], ['city'], true, false], ['>=', ['get', 'rank'], 3], ['<=', ['get', 'rank'], 3]]);
  assert.deepEqual(by['place-city-capital'].filter.at(-1), ['==', ['get', 'capital'], 2], 'national capitals show early whatever their size');
  assert.equal(by['place-city-3'].layout['text-size'], 10, 'borrows the look of the original');
  assert.equal(by['place-city-3'].paint['text-color'], 'red');
  assert.equal(by['place-city-1'].layout['text-size'], 14);
  assert.equal(by['place-country-major'].layout['text-padding'], 14, 'big names keep room around them');
});

test('each kind of place appears no earlier than the kind above it', () => {
  const first = (prefix) => Math.min(...PLACE_LADDER.filter((tier) => tier.id.startsWith(prefix)).map((tier) => tier.from));
  assert.ok(first('country') <= first('state'));
  assert.ok(first('state') <= first('city-3'));
  assert.ok(first('city') <= first('town'));
  assert.ok(first('town') <= first('village'));
  assert.ok(first('village') <= first('other'));
});

test('the adapted style keeps the ladder and the label colors', () => {
  const style = adaptStyle(structuredClone(PLACE_STYLE));
  const city = style.layers.find((layer) => layer.id === 'place-city-1');
  assert.equal(city.paint['text-halo-width'], 1.4);
  assert.equal(style.layers.find((layer) => layer.id === 'water').paint['fill-color'], '#101d31');
  assert.ok(style.layers.some((layer) => layer.id === 'place-continent'));
});

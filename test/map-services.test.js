import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchLatestTime, latestTimeIn } from '../js/capabilities.js';
import { NWS_COVERAGE } from '../js/config.js';
import { boxTouchesView, leafletBounds, pointInBoxes, wrapLongitude } from '../js/geo.js';

const CAPABILITIES = `<WMS_Capabilities><Service><Name>WMS</Name></Service><Capability><Layer><Title>Root</Title>
  <Layer queryable="1"><Name>other_layer</Name><Dimension name="time" default="2020-01-01T00:00:00Z" units="ISO8601">2020-01-01T00:00:00.000Z</Dimension></Layer>
  <Layer queryable="1"><Name>conus_bref_qcd</Name><Title>x</Title>
    <Dimension name="elevation" default="0">0</Dimension>
    <Dimension name="time" default="2026-11-06T13:02:07Z" units="ISO8601">2026-11-06T12:58:10.000Z,2026-11-06T13:02:07.000Z</Dimension>
  </Layer>
  <Layer><Name>timeless</Name></Layer>
</Layer></Capability></WMS_Capabilities>`;

test('finds the newest time for the right layer', () => {
  assert.equal(latestTimeIn(CAPABILITIES, 'conus_bref_qcd'), '2026-11-06T13:02:07Z');
  assert.equal(latestTimeIn(CAPABILITIES, 'other_layer'), '2020-01-01T00:00:00Z');
});

test('fails clearly when a layer or its time is missing', () => {
  assert.throws(() => latestTimeIn(CAPABILITIES, 'nope'), /not listed/);
  assert.throws(() => latestTimeIn(CAPABILITIES, 'timeless'), /no usable time/);
  assert.throws(() => latestTimeIn('<Name>x</Name><Dimension name="time" default="current">', 'x'), /no usable time/);
});

test('reports a failing map service as an error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(fetchLatestTime('https://example.test', 'x', { fetchImpl }), /503/);
});

const CONUS = { west: -130, east: -60, south: 20, north: 55 };
const GUAM = { west: 140, east: 150, south: 9, north: 18 };

test('knows when a coverage box is on screen', () => {
  assert.equal(boxTouchesView(CONUS, { west: -100, east: -90, south: 30, north: 40 }), true);
  assert.equal(boxTouchesView(CONUS, { west: 60, east: 90, south: 10, north: 30 }), false);
  assert.equal(boxTouchesView(CONUS, { west: -100, east: -90, south: 56, north: 70 }), false);
});

test('sees boxes across the date line when the view runs past 180 degrees', () => {
  assert.equal(boxTouchesView(GUAM, { west: -220, east: -160, south: 0, north: 30 }), true);
  assert.equal(boxTouchesView(CONUS, { west: 200, east: 260, south: 30, north: 40 }), true);
});

test('accepts several boxes for one layer', () => {
  const lightning = [{ west: -180, east: 0, south: -25, north: 80 }, { west: 110, east: 180, south: -25, north: 80 }];
  assert.equal(boxTouchesView(lightning, { west: 120, east: 130, south: 0, north: 10 }), true);
  assert.equal(boxTouchesView(lightning, { west: 30, east: 90, south: 0, north: 10 }), false);
});

test('covers every part of the US when deciding whether to ask NWS', () => {
  const places = {
    Kansas: [39, -97], Anchorage: [61.2, -149.9], Attu: [52.9, 173.1], Honolulu: [21.3, -157.9],
    'San Juan': [18.4, -66.1], 'St Thomas': [18.3, -64.9], Guam: [13.4, 144.8], Saipan: [15.2, 145.7],
    'Pago Pago': [-14.3, -170.7], 'Key West': [24.6, -81.8], Utqiagvik: [71.3, -156.8], Maine: [45, -68],
  };
  for (const [name, [lat, lng]] of Object.entries(places)) assert.ok(pointInBoxes(NWS_COVERAGE, lat, lng), name);
  assert.equal(pointInBoxes(NWS_COVERAGE, 19.07, 72.87), false);
  assert.equal(pointInBoxes(NWS_COVERAGE, 51.5, -0.1), false);
  assert.equal(pointInBoxes(NWS_COVERAGE, -33.9, 151.2), false);
});

test('wraps longitudes into the usual range', () => {
  assert.equal(wrapLongitude(190), -170);
  assert.equal(wrapLongitude(-190), 170);
  assert.equal(wrapLongitude(-97), -97);
  assert.equal(wrapLongitude(180), -180);
});

test('only limits tile loading for a single regional box', () => {
  assert.deepEqual(leafletBounds(CONUS), [[20, -130], [55, -60]]);
  assert.equal(leafletBounds([CONUS, GUAM]), undefined);
  assert.equal(leafletBounds({ west: -180, east: 180, south: -70, north: 70 }), undefined);
});

test('adapts the base map without disturbing anything else', async () => {
  const { adaptStyle } = await import('../js/basemap.js');
  const twoScripts = ['case', ['has', 'name:nonlatin'], ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']], ['get', 'name']];
  const style = {
    layers: [
      { id: 'background', paint: { 'background-color': '#45516E' } },
      { id: 'water', paint: { 'fill-color': '#38435C', 'fill-opacity': 0.5 } },
      { id: 'place_city', paint: { 'text-color': 'white' }, layout: { 'text-field': twoScripts, 'text-size': 12 } },
      { id: 'highway_ref', layout: { 'text-field': ['to-string', ['get', 'ref']] } },
      { id: 'boundary', type: 'line' },
    ],
  };
  const [background, water, city, road, boundary] = adaptStyle(style).layers;
  assert.notEqual(background.paint['background-color'], '#45516E');
  assert.notEqual(water.paint['fill-color'], '#38435C');
  assert.equal(water.paint['fill-opacity'], 0.5);
  assert.deepEqual(city.paint, { 'text-color': 'white' });
  assert.equal(city.layout['text-size'], 12);
  assert.ok(!JSON.stringify(city.layout['text-field']).includes('nonlatin'));
  assert.deepEqual(road.layout['text-field'], ['to-string', ['get', 'ref']]);
  assert.deepEqual(boundary, { id: 'boundary', type: 'line' });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import {
  arcgisTemplate, boundsFromCorners, colorSlot, contourFeatures, degreesPerUnit, diskRadius, fitGlobeZoom, globeStyle, moveParticle, pointFeatures,
  randomPlace, slotId, sourceBounds, toFlatZoom, toGlobeZoom, wmsTemplate,
} from '../js/globe-helpers.js';
import { encodePng } from '../js/png.js';

function readPng(png) {
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = new Map();
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.slice(at + 4, at + 8));
    chunks.set(type, png.slice(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return chunks;
}

test('makes a valid PNG that holds the same pixels', () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 6]);
  const chunks = readPng(encodePng(rgba, 2, 2));
  const header = chunks.get('IHDR');
  assert.equal(new DataView(header.buffer).getUint32(0), 2);
  assert.equal(new DataView(header.buffer).getUint32(4), 2);
  assert.deepEqual([...header.slice(8)], [8, 6, 0, 0, 0]);
  assert.ok(chunks.has('IEND'));
  const raw = inflateSync(chunks.get('IDAT'));
  assert.deepEqual([...raw], [0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 255, 0, 9, 8, 7, 6]);
});

test('a PNG too large for one stored block still decodes, and its checksums are right', () => {
  const size = 256;
  const rgba = new Uint8Array(size * size * 4).map((_, i) => (i * 7) % 251);
  const png = encodePng(rgba, size, size);
  const raw = inflateSync(readPng(png).get('IDAT'));
  assert.equal(raw.length, (size * 4 + 1) * size);
  assert.equal(raw[0], 0, 'rows start with no filter');
  assert.equal(raw[size * 4 + 2], rgba[size * 4]);
  assert.equal(raw.at(-1), rgba.at(-1));
  // PNG chunk checksums, compared with a direct calculation.
  const crc = (bytes) => {
    let c = -1;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ -1) >>> 0;
  };
  const end = png.length;
  assert.equal(new DataView(png.buffer).getUint32(end - 4), crc(png.slice(end - 8, end - 4)));
});

test('the same scale is one zoom number lower on the globe', () => {
  assert.equal(toGlobeZoom(5), 4);
  assert.equal(toFlatZoom(4), 5);
});

test('the whole Earth fits in the window when switching to the globe', () => {
  for (const [width, height, lat] of [[1440, 813, 25], [390, 844, 25], [1280, 720, 60], [800, 1200, -30]]) {
    const zoom = fitGlobeZoom(width, height, lat);
    const disk = diskRadius(zoom, lat, height);
    assert.ok(Math.abs(disk * 2 - Math.min(width, height) * 0.86) < 1, `${width}x${height}: ${disk * 2}`);
  }
  // Measured on screen in Chrome: zoom 1.93 at 25°N in an 813-pixel window gave a 548-pixel disk.
  assert.ok(Math.abs(diskRadius(1.93, 25, 813) * 2 - 548) < 3);
});

test('never asks for a zoom below the minimum', () => {
  assert.equal(fitGlobeZoom(20, 20), 0);
});

test('keeps layers in the same order as the flat map', () => {
  const style = {
    version: 8,
    layers: [
      { id: 'water', type: 'fill' },
      { id: 'border', type: 'line', 'source-layer': 'boundary' },
      { id: 'city', type: 'symbol' },
    ],
  };
  const { layers, projection } = globeStyle(style, ['fill', 'radar', 'labels', 'wind']);
  assert.deepEqual(projection, { type: 'globe' });
  assert.deepEqual(layers.map((layer) => layer.id), ['water', slotId('fill'), slotId('radar'), 'border', 'city', slotId('wind')]);
  assert.equal(layers.find((layer) => layer.id === slotId('fill')).layout.visibility, 'none');
});

test('builds tile addresses the map library can fill in', () => {
  const wms = wmsTemplate('https://example.test/ows', 'a_b', '2026-11-06T10:00:00Z');
  assert.ok(wms.includes('bbox={bbox-epsg-3857}'));
  assert.ok(wms.includes('crs=EPSG:3857'));
  assert.ok(wms.includes('time=2026-11-06T10%3A00%3A00Z'));
  assert.ok(!wmsTemplate('https://example.test/ows', 'a_b').includes('time='));
  assert.equal(
    arcgisTemplate('https://example.test/MapServer', { show: [1, 2] }),
    'https://example.test/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&f=image&layers=show:1,2',
  );
  assert.ok(arcgisTemplate('https://example.test/ImageServer', { image: true }).includes('/exportImage?'));
});

test('limits tiles to a single box, and asks everywhere otherwise', () => {
  assert.deepEqual(sourceBounds({ west: -130, east: -60, south: 20, north: 55 }), [-130, 20, -60, 55]);
  assert.equal(sourceBounds([{ west: 0 }, { west: 1 }]), undefined);
  assert.equal(sourceBounds({ west: -180, east: 180, south: -70, north: 70 }), undefined);
  assert.equal(sourceBounds(undefined), undefined);
  assert.deepEqual(boundsFromCorners([[-60, -180], [85, 180]]), [-180, -60, 180, 85]);
  assert.equal(boundsFromCorners(undefined), undefined);
});

test('turns contour lines and points into map shapes', () => {
  const lines = contourFeatures([{ major: true, segments: [[[10, 20], [11, 21]]] }]);
  assert.deepEqual(lines.features[0].geometry.coordinates, [[[20, 10], [21, 11]]], 'longitude comes first');
  assert.equal(lines.features[0].properties.color, '#ffffff');
  const points = pointFeatures([{ lat: 1, lng: 2, color: 'red' }, { lat: 3, lng: 4, color: 'blue' }]);
  assert.deepEqual(points.features[1].geometry.coordinates, [4, 3]);
  assert.equal(points.features[1].properties.index, 1, 'a click can find the original');
});

test('moves a line with the wind, in the right direction', () => {
  const degrees = 0.01;
  assert.deepEqual(moveParticle(0, 0, 0, 10, degrees), [0.1, 0], 'a south wind pushes north');
  assert.deepEqual(moveParticle(0, 0, 10, 0, degrees), [0, 0.1], 'a west wind pushes east');
  const [, far] = moveParticle(60, 0, 10, 0, degrees);
  assert.ok(Math.abs(far - 0.2) < 1e-9, 'a degree of longitude is shorter near the poles, so the same wind covers more of them');
  assert.ok(moveParticle(0, 179.99, 10, 0, degrees)[1] < -179, 'crosses the date line');
  assert.ok(moveParticle(0, -179.99, -10, 0, degrees)[1] > 179, 'crosses it going west');
});

test('lines keep the same speed on screen at any zoom', () => {
  assert.equal(degreesPerUnit(0.006, 2) / degreesPerUnit(0.006, 3), 2);
  // 10 m/s at the default line speed, in pixels per frame at the equator.
  const pixels = 10 * degreesPerUnit(0.006, 2) * ((512 * 2 ** 2) / 360);
  assert.ok(Math.abs(pixels - 1.2) < 1e-9);
});

test('new lines spread evenly over the Earth rather than crowding at the poles', () => {
  let seed = 1;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let tropics = 0;
  const count = 20000;
  for (let i = 0; i < count; i++) {
    const [lat, lng] = randomPlace(-85, 85, -180, 180, random);
    assert.ok(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180);
    if (Math.abs(lat) < 30) tropics += 1;
  }
  // Half the Earth's surface lies within 30° of the equator.
  assert.ok(Math.abs(tropics / count - 0.5) < 0.02, `${tropics / count}`);
  const [, wrapped] = randomPlace(0, 1, 170, 200, () => 0.9);
  assert.ok(wrapped < 0, 'a box past the date line wraps');
});

test('picks a color by speed, and the fastest color for anything faster', () => {
  assert.equal(colorSlot(0, 20, 10), 0);
  assert.equal(colorSlot(10, 20, 10), 5);
  assert.equal(colorSlot(19.9, 20, 10), 9);
  assert.equal(colorSlot(50, 20, 10), 9);
});

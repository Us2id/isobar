import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byteRange, gfsCandidates, thinGrid, windAt, windFromDegrees } from '../js/wind-grid.js';

test('picks the newest GFS run that should exist and the forecast hour nearest now', () => {
  const now = Date.UTC(2026, 10, 6, 12, 42);
  const [first, second] = gfsCandidates(now);
  assert.equal(first.forecastHour, 7);
  assert.equal(first.validTime, Date.UTC(2026, 10, 6, 13));
  assert.equal(first.url, 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261106/06/atmos/gfs.t06z.pgrb2.0p25.f007');
  assert.equal(second.forecastHour, 13);
  assert.match(second.url, /gfs\.20261106\/00\/atmos\/gfs\.t00z\.pgrb2\.0p25\.f013$/);
  assert.equal(second.validTime, first.validTime, 'every fallback should still describe the same hour');
});

test('rolls back across midnight for the run date', () => {
  const [first] = gfsCandidates(Date.UTC(2026, 0, 1, 3, 0));
  assert.match(first.url, /gfs\.20251231\/18\/atmos\/gfs\.t18z\.pgrb2\.0p25\.f009$/);
});

test('moves to the next run only once it should have appeared', () => {
  assert.equal(gfsCandidates(Date.UTC(2026, 10, 6, 15, 59))[0].run, Date.UTC(2026, 10, 6, 6));
  assert.equal(gfsCandidates(Date.UTC(2026, 10, 6, 16, 0))[0].run, Date.UTC(2026, 10, 6, 12));
});

const INDEX = [
  '587:421000000:d=2026110606:TMP:2 m above ground:6 hour fcst:',
  '588:422315479:d=2026110606:UGRD:10 m above ground:6 hour fcst:',
  '589:423275050:d=2026110606:VGRD:10 m above ground:6 hour fcst:',
  '590:424213284:d=2026110606:UGRD:20 m above ground:6 hour fcst:',
].join('\n');

test('finds a field\'s byte range from the index, ending before the next field', () => {
  assert.deepEqual(byteRange(INDEX, 'UGRD'), [422315479, 423275049]);
  assert.deepEqual(byteRange(`${INDEX}\n`, 'VGRD'), [423275050, 424213283]);
});

test('complains when a field is missing, or last with no way to know where it ends', () => {
  assert.throws(() => byteRange(INDEX, 'PRES'), /not in the index/);
  assert.throws(() => byteRange(INDEX, 'UGRD', '20 m above ground'), /not in the index/);
});

test('thins a global grid and keeps both poles', () => {
  const nx = 8;
  const ny = 5;
  const values = Float32Array.from({ length: nx * ny }, (_, i) => i);
  const thin = thinGrid({ nx, ny, dx: 0.25, dy: 0.25, la1: 90, lo1: 0, values }, 2);
  assert.equal(thin.nx, 4);
  assert.equal(thin.ny, 3);
  assert.equal(thin.dx, 0.5);
  assert.deepEqual([...thin.values.slice(0, 4)], [0, 2, 4, 6]);
  assert.equal(thin.values[4], 16, 'second kept row starts two rows down');
  assert.equal(thin.values[8], 32, 'last row is the south pole row');
});

test('wind direction is where the wind comes from', () => {
  assert.equal(windFromDegrees(0, -5), 0);
  assert.equal(windFromDegrees(5, 0), 270);
  assert.equal(windFromDegrees(0, 5), 180);
  assert.equal(windFromDegrees(-5, 0), 90);
});

const GRID = {
  nx: 4, ny: 3, dx: 90, dy: 45, la1: 45, lo1: 0,
  u: Float32Array.from([0, 4, 0, 0, 0, 8, 0, 0, 0, 0, 0, 2]),
  v: new Float32Array(12),
};

test('reads wind exactly on a grid point', () => {
  const wind = windAt(GRID, 0, 90);
  assert.equal(wind.u, 8);
  assert.equal(wind.speed, 8);
  assert.equal(wind.fromDegrees, 270);
});

test('blends between grid points', () => {
  assert.equal(windAt(GRID, 45, 45).u, 2);
  assert.equal(windAt(GRID, 22.5, 90).u, 6);
});

test('wraps across the date line and accepts negative longitudes', () => {
  assert.equal(windAt(GRID, -45, -90).u, 2);
  assert.equal(windAt(GRID, -45, 315).u, 1, 'halfway from the last column back to the first');
  assert.equal(windAt(GRID, -45, -45).u, 1);
});

test('returns nothing off the top or bottom of the grid', () => {
  assert.equal(windAt(GRID, 46, 0), null);
  assert.equal(windAt(GRID, -46, 0), null);
});

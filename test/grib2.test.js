import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeGrib2 } from '../js/grib2.js';
import { complexPacked, simplePacked } from './helpers/grib-encode.js';

const closeTo = (actual, expected, tolerance = 1e-3) => {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => assert.ok(Math.abs(actual[i] - value) < tolerance, `value ${i}: ${actual[i]} vs ${value}`));
};

test('reads simple packing with scaling, as HRRR wind uses', () => {
  const grid = { nx: 3, ny: 2, la1: 21, lo1: 238, lov: 262.5, dx: 3000, dy: 3000, lat0: 38.5 };
  const ints = [0, 1, 2, 511, 512, 1023];
  const bytes = simplePacked(grid, ints, { reference: -5, binaryScale: -2, decimalScale: 1, lambert: true });
  const field = decodeGrib2(bytes);
  assert.equal(field.template3, 30);
  assert.equal(field.template5, 0);
  assert.equal(field.gridRelative, true);
  assert.equal(field.nx, 3);
  assert.equal(field.lov, 262.5);
  assert.equal(field.dx, 3000);
  assert.equal(field.lat0, 38.5);
  closeTo(field.values, ints.map((x) => (-5 + x * 0.25) / 10));
});

test('reads complex packing with second-order differences, as GFS wind uses', () => {
  const ints = [100, 103, 101, 98, 110, 120, 119, 119, 119, 150];
  const bytes = complexPacked({ nx: 5, ny: 2, la1: 90, lo1: 0, dx: 0.25, dy: 0.25 }, ints, { groups: [4, 3, 3] });
  const field = decodeGrib2(bytes);
  assert.equal(field.template3, 0);
  assert.equal(field.template5, 3);
  assert.equal(field.gridRelative, false);
  assert.equal(field.la1, 90);
  assert.equal(field.dx, 0.25);
  closeTo(field.values, ints);
});

test('reads first-order differences, negative starting values and scaling', () => {
  const ints = [-40, -35, -35, -60, -2, 7];
  const bytes = complexPacked({ nx: 3, ny: 2 }, ints, { order: 1, groups: [3, 3], reference: 2, binaryScale: 1, decimalScale: 2 });
  closeTo(decodeGrib2(bytes).values, ints.map((x) => (2 + x * 2) / 100));
});

test('reads a group where every value is the same, which takes no bits', () => {
  const ints = [5, 5, 5, 5, 5, 5, 9, 2];
  closeTo(decodeGrib2(complexPacked({ nx: 4, ny: 2 }, ints, { groups: [6, 2] })).values, ints);
});

test('puts values back on the full grid using a bitmap, with gaps as NaN', () => {
  // Five points, of which the second and fifth have no data.
  const bytes = simplePacked({ nx: 5, ny: 1 }, [10, 20, 30], { bits: 8, bitmapBits: [1, 0, 1, 1, 0] });
  const field = decodeGrib2(bytes);
  assert.equal(field.values.length, 5);
  assert.deepEqual([...field.values].map((v) => (Number.isNaN(v) ? null : v)), [10, null, 20, 30, null]);
});

test('reads complex packing under a bitmap, as GFS soil and wave fields use', () => {
  const ints = [100, 103, 101, 98, 110, 120];
  const bytes = complexPacked({ nx: 4, ny: 2 }, ints, { groups: [3, 3], bitmapBits: [1, 1, 0, 1, 1, 1, 0, 1] });
  const values = [...decodeGrib2(bytes).values];
  assert.deepEqual(values.map((v) => (Number.isNaN(v) ? null : v)), [100, 103, null, 101, 98, 110, null, 120]);
});

test('skips missing values when undoing the differencing', () => {
  // Every null is marked inside the packed data rather than in a bitmap.
  const series = [100, null, 103, 101, null, null, 98, 110];
  const bytes = complexPacked({ nx: 4, ny: 2 }, series, { order: 2, groups: [8], missingManagement: 1 });
  const values = [...decodeGrib2(bytes).values];
  assert.deepEqual(values.map((v) => (Number.isNaN(v) ? null : v)), series);
});

test('reads a whole group marked missing, which takes no bits', () => {
  const series = [5, 6, 7, null, null, null, 9, 12];
  const bytes = complexPacked({ nx: 4, ny: 2 }, series, { order: 1, groups: [3, 3, 2], missingManagement: 1 });
  const values = [...decodeGrib2(bytes).values];
  assert.deepEqual(values.map((v) => (Number.isNaN(v) ? null : v)), series);
});

test('refuses formats it cannot read instead of returning wrong numbers', () => {
  const grid = { nx: 2, ny: 1, la1: 0, lo1: 0, lov: 0, dx: 1, dy: 1, lat0: 0 };
  assert.throws(() => decodeGrib2(simplePacked(grid, [1, 2], { lambert: true, bitmap: 254 })), /bitmap/);
  const managed = complexPacked({ nx: 2, ny: 2 }, [1, 2, 3, 4], { groups: [2, 2], missingManagement: 3 });
  assert.throws(() => decodeGrib2(managed), /missing-value/);
});

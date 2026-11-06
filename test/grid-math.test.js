import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromDegrees, isGlobal, northUp, sampleGrid, thinGrid } from '../js/grid-math.js';

const GRID = { nx: 4, ny: 3, dx: 90, dy: 45, la1: 45, lo1: 0 };
const VALUES = Float32Array.from([0, 4, 0, 0, 0, 8, 0, 0, 0, 0, 0, 2]);

test('reads a value exactly on a grid point', () => {
  assert.equal(sampleGrid(GRID, VALUES, 0, 90), 8);
});

test('blends between grid points', () => {
  assert.equal(sampleGrid(GRID, VALUES, 45, 45), 2);
  assert.equal(sampleGrid(GRID, VALUES, 22.5, 90), 6);
});

test('wraps across the date line and accepts negative longitudes', () => {
  assert.equal(sampleGrid(GRID, VALUES, -45, -90), 2);
  assert.equal(sampleGrid(GRID, VALUES, -45, 315), 1);
  assert.equal(sampleGrid(GRID, VALUES, -45, -45), 1);
});

test('returns NaN off the grid', () => {
  assert.ok(Number.isNaN(sampleGrid(GRID, VALUES, 46, 0)));
  assert.ok(Number.isNaN(sampleGrid(GRID, VALUES, -46, 0)));
});

test('leaves points with no data out of the blend, so coasts stay clean', () => {
  const values = Float32Array.from([10, NaN, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0]);
  const grid = { nx: 4, ny: 3, dx: 1, dy: 1, la1: 2, lo1: 0 };
  assert.equal(sampleGrid(grid, values, 1.5, 0.5), 10, 'three good corners out of four');
  assert.ok(Number.isNaN(sampleGrid(grid, Float32Array.from([NaN, NaN, 0, 0, NaN, 10, 0, 0, 0, 0, 0, 0]), 1.75, 0.25)), 'mostly missing stays missing');
});

test('does not wrap a grid that stops short of the whole world', () => {
  const regional = { nx: 3, ny: 2, dx: 1, dy: 1, la1: 1, lo1: 10 };
  assert.equal(isGlobal(regional), false);
  assert.equal(isGlobal({ nx: 1440, dx: 0.25 }), true);
  assert.ok(Number.isNaN(sampleGrid(regional, new Float32Array(6), 0.5, 20)));
  assert.equal(sampleGrid(regional, new Float32Array(6).fill(3), 0.5, 11), 3);
});

test('thins a grid and keeps both poles', () => {
  const field = { nx: 8, ny: 5, dx: 0.25, dy: 0.25, la1: 90, lo1: 0, values: Float32Array.from({ length: 40 }, (_, i) => i) };
  const thin = thinGrid(field, 2);
  assert.equal(thin.nx, 4);
  assert.equal(thin.ny, 3);
  assert.equal(thin.dx, 0.5);
  assert.deepEqual([...thin.values.slice(0, 4)], [0, 2, 4, 6]);
  assert.equal(thin.values[4], 16);
  assert.equal(thin.values[8], 32);
  assert.equal(thinGrid(field, 1), field, 'a step of 1 changes nothing');
});

test('flips a grid that runs south to north', () => {
  const south = { nx: 2, ny: 2, dx: 1, dy: 1, la1: 10, lo1: 0, scan: 0x40, values: Float32Array.from([1, 2, 3, 4]) };
  const flipped = northUp(south);
  assert.deepEqual([...flipped.values], [3, 4, 1, 2]);
  assert.equal(flipped.la1, 11);
  const already = { ...south, scan: 0 };
  assert.equal(northUp(already), already);
});

test('wind direction is where it comes from', () => {
  assert.equal(fromDegrees(0, -5), 0);
  assert.equal(fromDegrees(5, 0), 270);
  assert.equal(fromDegrees(0, 5), 180);
  assert.equal(fromDegrees(-5, 0), 90);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeAec } from '../js/aec.js';
import { decodeGrib2 } from '../js/grib2.js';

class Bits {
  constructor() { this.bytes = []; this.count = 0; }
  push(value, width) {
    for (let bit = width - 1; bit >= 0; bit--) {
      if (this.count % 8 === 0) this.bytes.push(0);
      const on = Math.floor(value / 2 ** bit) % 2;
      this.bytes[this.bytes.length - 1] |= on << (7 - (this.count % 8));
      this.count += 1;
    }
  }
  unary(zeros) { this.push(0, zeros); this.push(1, 1); }
  bytesOut() { return Uint8Array.from(this.bytes); }
}

const options = { bits: 8, blockSize: 8, rsi: 4, flags: 0 };

test('reads an uncompressed block', () => {
  const bits = new Bits();
  bits.push(7, 3); // all ones means no compression
  const samples = [10, 20, 30, 40, 50, 60, 70, 80];
  samples.forEach((sample) => bits.push(sample, 8));
  assert.deepEqual([...decodeAec(bits.bytesOut(), { ...options, count: 8 })], samples);
});

test('reads a split-sample block: unary high parts, then low bits', () => {
  const bits = new Bits();
  bits.push(3, 3); // id 3 means k = 2
  const samples = [5, 0, 7, 12, 3, 9, 1, 14];
  samples.forEach((sample) => bits.unary(sample >> 2));
  samples.forEach((sample) => bits.push(sample & 3, 2));
  assert.deepEqual([...decodeAec(bits.bytesOut(), { ...options, count: 8 })], samples);
});

test('reads a split-sample block with no low bits', () => {
  const bits = new Bits();
  bits.push(1, 3); // id 1 means k = 0
  const samples = [0, 1, 2, 3, 0, 1, 2, 3];
  samples.forEach((sample) => bits.unary(sample));
  assert.deepEqual([...decodeAec(bits.bytesOut(), { ...options, count: 8 })], samples);
});

test('reads zero blocks, including the one that runs to a segment boundary', () => {
  const bits = new Bits();
  bits.push(0, 3); // low entropy
  bits.push(0, 1); // zero block
  bits.unary(1); // two zero blocks
  bits.push(7, 3);
  for (let i = 0; i < 8; i++) bits.push(i + 1, 8);
  const decoded = [...decodeAec(bits.bytesOut(), { ...options, rsi: 8, count: 24 })];
  assert.deepEqual(decoded.slice(0, 16), new Array(16).fill(0));
  assert.deepEqual(decoded.slice(16), [1, 2, 3, 4, 5, 6, 7, 8]);

  const rest = new Bits();
  rest.push(0, 3);
  rest.push(0, 1);
  rest.unary(4); // the "rest of the segment" code
  assert.deepEqual([...decodeAec(rest.bytesOut(), { ...options, rsi: 3, count: 24 })], new Array(24).fill(0));
});

test('reads a second-extension block of paired values', () => {
  const bits = new Bits();
  bits.push(0, 3);
  bits.push(1, 1); // second extension
  // Each pair (a, b) is coded as b + (a + b)(a + b + 1) / 2.
  const pairs = [[0, 0], [1, 0], [0, 1], [2, 1]];
  pairs.forEach(([a, b]) => bits.unary(b + ((a + b) * (a + b + 1)) / 2));
  assert.deepEqual([...decodeAec(bits.bytesOut(), { ...options, count: 8 })], pairs.flat());
});

test('undoes the unit-delay preprocessing, starting from a reference sample', () => {
  // Reference 100, then residuals: +2 (d=4), -1 (d=1), 0 (d=0), +3 (d=6), -2 (d=3), +1 (d=2), 0 (d=0)
  const bits = new Bits();
  bits.push(1, 3); // k = 0
  bits.push(100, 8); // the reference comes right after the id
  [4, 1, 0, 6, 3, 2, 0].forEach((d) => bits.unary(d));
  const decoded = [...decodeAec(bits.bytesOut(), { ...options, flags: 8, count: 8 })];
  assert.deepEqual(decoded, [100, 102, 101, 101, 104, 102, 103, 103]);
});

test('takes a large residual relative to the nearer limit of the range', () => {
  // Near 0, a residual too big to be a signed step means the value itself.
  const low = new Bits();
  low.push(7, 3);
  [2, 50, 0, 0, 0, 0, 0, 0].forEach((sample) => low.push(sample, 8));
  assert.equal(decodeAec(low.bytesOut(), { ...options, flags: 8, count: 8 })[1], 50);
  // Near the top of the range it counts down from the maximum.
  const high = new Bits();
  high.push(7, 3);
  [250, 50, 0, 0, 0, 0, 0, 0].forEach((sample) => high.push(sample, 8));
  assert.equal(decodeAec(high.bytesOut(), { ...options, flags: 8, count: 8 })[1], 205);
});

test('starts a fresh reference at each new segment', () => {
  const bits = new Bits();
  for (const reference of [10, 200]) {
    bits.push(1, 3);
    bits.push(reference, 8);
    [2, 0, 0, 0, 0, 0, 0].forEach((d) => bits.unary(d));
  }
  const decoded = [...decodeAec(bits.bytesOut(), { ...options, rsi: 1, flags: 8, count: 16 })];
  assert.equal(decoded[0], 10);
  assert.equal(decoded[1], 11);
  assert.equal(decoded[8], 200);
  assert.equal(decoded[9], 201);
});

test('stops cleanly on damaged data rather than running forever', () => {
  const bits = new Bits();
  bits.push(1, 3);
  assert.throws(() => decodeAec(bits.bytesOut(), { ...options, count: 8 }), /ended early/);
});

test('reads template 5.42 inside a GRIB2 message', () => {
  const packed = new Bits();
  packed.push(1, 3);
  packed.push(100, 8);
  [4, 1, 0, 6, 3, 2, 0].forEach((d) => packed.unary(d));
  const data = [...packed.bytesOut()];
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const section = (n, body) => [...u32(body.length + 5), n, ...body];
  const grid = new Array(67).fill(0);
  const put = (at, bytes) => bytes.forEach((byte, i) => { grid[at - 5 + i] = byte; });
  put(6, u32(8));
  put(30, u32(4));
  put(34, u32(2));
  put(50, u32(0));
  put(46, u32(90_000_000));
  put(63, u32(1_000_000));
  put(67, u32(1_000_000));
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, 200);
  const s5 = [...u32(8), 0, 42, ...new Uint8Array(view.buffer), 0x80, 1, 0, 1, 8, 0, 8, 8, 0, 4];
  const bytes = Uint8Array.from([
    71, 82, 73, 66, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0,
    ...section(1, new Array(16).fill(0)), ...section(3, grid), ...section(4, new Array(29).fill(0)),
    ...section(5, s5), ...section(6, [255]), ...section(7, data), 55, 55, 55, 55,
  ]);
  const field = decodeGrib2(bytes);
  assert.equal(field.template5, 42);
  // value = (200 + x / 2) / 10
  assert.deepEqual([...field.values].map((v) => Number(v.toFixed(3))), [100, 102, 101, 101, 104, 102, 103, 103].map((x) => (200 + x / 2) / 10).map((v) => Number(v.toFixed(3))));
});

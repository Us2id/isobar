// Reads one GRIB2 message: grid templates 3.0 and 3.30, data templates 5.0, 5.3, 5.40 (JPEG 2000)
// and 5.42 (CCSDS), with or without a bitmap. That covers the NOAA and ECMWF fields this site uses.
// Anything else throws rather than returning wrong numbers. Points with no data (land in an ocean
// field, say) come back as NaN.
import { decodeAec } from './aec.js';

const u16 = (a, o) => (a[o] << 8) | a[o + 1];
const u32 = (a, o) => a[o] * 16777216 + ((a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]);
const sm = (a, o, n) => {
  let v = a[o] & 0x7f;
  for (let i = 1; i < n; i++) v = v * 256 + a[o + i];
  return a[o] & 0x80 ? -v : v;
};

function bitReader(d) {
  return (pos, n) => {
    if (n === 0) return 0;
    let i = pos >>> 3;
    const off = pos & 7;
    const avail = 8 - off;
    const b = d[i++] & (0xff >>> off);
    if (n <= avail) return b >>> (avail - n);
    let v = b;
    let need = n - avail;
    while (need >= 8) {
      v = v * 256 + d[i++];
      need -= 8;
    }
    if (need > 0) v = v * (1 << need) + (d[i] >>> (8 - need));
    return v;
  };
}

function readGrid(s3) {
  const grid = { template3: u16(s3, 12), nx: u32(s3, 30), ny: u32(s3, 34) };
  if (grid.template3 === 0) {
    Object.assign(grid, {
      la1: sm(s3, 46, 4) / 1e6,
      lo1: sm(s3, 50, 4) / 1e6,
      flags: s3[54],
      dx: u32(s3, 63) / 1e6,
      dy: u32(s3, 67) / 1e6,
      scan: s3[71],
    });
  } else if (grid.template3 === 30) {
    Object.assign(grid, {
      la1: sm(s3, 38, 4) / 1e6,
      lo1: sm(s3, 42, 4) / 1e6,
      flags: s3[46],
      lov: sm(s3, 51, 4) / 1e6,
      dx: sm(s3, 55, 4) / 1e3,
      dy: sm(s3, 59, 4) / 1e3,
      scan: s3[64],
      lat0: sm(s3, 65, 4) / 1e6,
    });
  } else {
    throw new Error(`grid template ${grid.template3}`);
  }
  grid.gridRelative = Boolean(grid.flags & 8);
  return grid;
}

function unpackSimple(d, count, bits, reference, binaryScale, decimalScale) {
  const rd = bitReader(d);
  const out = new Float32Array(count);
  for (let i = 0, pos = 0; i < count; i++, pos += bits) out[i] = (reference + rd(pos, bits) * binaryScale) / decimalScale;
  return out;
}

// Template 5.3 stores values as differences from their neighbours, in groups of varying bit
// widths. Missing-value management marks gaps with all-ones values, which differencing skips.
function unpackComplex(d, s5, count, bits, reference, binaryScale, decimalScale) {
  const rd = bitReader(d);
  const management = s5[22];
  if (management > 2) throw new Error(`missing-value management ${management}`);
  const groupCount = u32(s5, 31);
  const widthRef = s5[35];
  const widthBits = s5[36];
  const lengthRef = u32(s5, 37);
  const lengthStep = s5[41];
  const lastLength = u32(s5, 42);
  const lengthBits = s5[46];
  const order = s5[47];
  const extra = s5[48];
  if (order !== 1 && order !== 2) throw new Error(`spatial differencing order ${order}`);

  const first = sm(d, 0, extra);
  let offset = extra;
  let second = 0;
  if (order === 2) {
    second = sm(d, offset, extra);
    offset += extra;
  }
  const minimum = sm(d, offset, extra);
  offset += extra;

  let pos = offset * 8;
  const align = () => { pos = ((pos + 7) >>> 3) << 3; };
  const refs = new Int32Array(groupCount);
  const widths = new Int32Array(groupCount);
  const lengths = new Int32Array(groupCount);
  for (let g = 0; g < groupCount; g++, pos += bits) refs[g] = rd(pos, bits);
  align();
  for (let g = 0; g < groupCount; g++, pos += widthBits) widths[g] = widthRef + rd(pos, widthBits);
  align();
  for (let g = 0; g < groupCount; g++, pos += lengthBits) lengths[g] = lengthRef + rd(pos, lengthBits) * lengthStep;
  align();
  lengths[groupCount - 1] = lastLength;

  const values = new Int32Array(count);
  const missing = management ? new Uint8Array(count) : null;
  const refAllOnes = 2 ** bits - 1;
  let n = 0;
  for (let g = 0; g < groupCount; g++) {
    const ref = refs[g];
    const width = widths[g];
    const length = lengths[g];
    if (width === 0) {
      const gap = management && (ref === refAllOnes || (management === 2 && ref === refAllOnes - 1));
      if (gap) missing.fill(1, n, n + length);
      else values.fill(ref, n, n + length);
      n += length;
    } else {
      const allOnes = 2 ** width - 1;
      for (let i = 0; i < length; i++, pos += width, n++) {
        const raw = rd(pos, width);
        if (management && (raw === allOnes || (management === 2 && raw === allOnes - 1))) missing[n] = 1;
        else values[n] = ref + raw;
      }
    }
  }
  if (n !== count) throw new Error(`group lengths sum to ${n}, expected ${count}`);

  // Undo the differencing over the points that have data, in order.
  let seen = 0;
  let previous = 0;
  let beforePrevious = 0;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (missing && missing[i]) {
      out[i] = NaN;
      continue;
    }
    let x;
    if (seen === 0) x = first;
    else if (seen === 1 && order === 2) x = second;
    else if (order === 1) x = values[i] + minimum + previous;
    else x = values[i] + minimum + 2 * previous - beforePrevious;
    beforePrevious = previous;
    previous = x;
    seen += 1;
    out[i] = (reference + x * binaryScale) / decimalScale;
  }
  return out;
}

// How the data is packed, so a caller can load the JPEG 2000 decoder only when it's needed.
export function dataTemplate(bytes) {
  let p = 16;
  while (p < bytes.length) {
    const length = u32(bytes, p);
    if (bytes[p + 4] === 5) return u16(bytes, p + 9);
    p += length;
  }
  throw new Error('No data section found');
}

function fromIntegers(integers, count, reference, binaryScale, decimalScale) {
  if (integers.length < count) throw new Error(`Got ${integers.length} values, expected ${count}`);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = (reference + integers[i] * binaryScale) / decimalScale;
  return out;
}

export function decodeGrib2(bytes, { jpeg2000 } = {}) {
  const sec = {};
  let p = 16;
  while (!(bytes[p] === 55 && bytes[p + 1] === 55 && bytes[p + 2] === 55 && bytes[p + 3] === 55)) {
    const length = u32(bytes, p);
    sec[bytes[p + 4]] = bytes.subarray(p, p + length);
    p += length;
  }
  const s5 = sec[5];
  const s6 = sec[6];
  const d = sec[7].subarray(5);
  const grid = readGrid(sec[3]);
  const total = grid.nx * grid.ny;

  const count = u32(s5, 5);
  const t5 = u16(s5, 9);
  const reference = new DataView(s5.buffer, s5.byteOffset + 11, 4).getFloat32(0);
  const binaryScale = 2 ** sm(s5, 15, 2);
  const decimalScale = 10 ** sm(s5, 17, 2);
  const bits = s5[19];

  let unpacked;
  if (t5 === 0) unpacked = unpackSimple(d, count, bits, reference, binaryScale, decimalScale);
  else if (t5 === 3) unpacked = unpackComplex(d, s5, count, bits, reference, binaryScale, decimalScale);
  else if (t5 === 40 || t5 === 42) {
    if (bits === 0 || d.length === 0) {
      unpacked = new Float32Array(count).fill(reference / decimalScale);
    } else if (t5 === 40) {
      if (!jpeg2000) throw new Error('This field needs the JPEG 2000 decoder');
      unpacked = fromIntegers(jpeg2000(d), count, reference, binaryScale, decimalScale);
    } else {
      const integers = decodeAec(d, { bits, flags: s5[21], blockSize: s5[22], rsi: u16(s5, 23), count });
      unpacked = fromIntegers(integers, count, reference, binaryScale, decimalScale);
    }
  } else throw new Error(`data template ${t5}`);

  const indicator = s6[5];
  let values = unpacked;
  if (indicator === 0) {
    const map = s6.subarray(6);
    values = new Float32Array(total).fill(NaN);
    let next = 0;
    for (let i = 0; i < total; i++) {
      if (map[i >>> 3] & (0x80 >>> (i & 7))) values[i] = unpacked[next++];
    }
    if (next !== count) throw new Error(`bitmap has ${next} points, expected ${count}`);
  } else if (indicator !== 255) {
    throw new Error(`bitmap indicator ${indicator}`);
  }
  return { ...grid, template5: t5, npts: total, values };
}

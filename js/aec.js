// CCSDS 121.0 "Adaptive Entropy Coding", the compression in GRIB2 data template 5.42. ECMWF uses
// it for its open data. Follows the CCSDS standard's block types and unit-delay preprocessing.
const PREPROCESS = 8;
const RESTRICTED = 16;
const PAD_RSI = 32;
const ROS = 5;

const SECOND_EXTENSION = (() => {
  const table = [];
  for (let i = 0, k = 0; i < 13; i++) {
    const start = k;
    for (let j = 0; j <= i; j++, k++) {
      table[2 * k] = i;
      table[2 * k + 1] = start;
    }
  }
  return table;
})();

function idLength(bits, flags) {
  if (bits > 16) return 5;
  if (bits > 8) return 4;
  if (flags & RESTRICTED && bits <= 4) return bits <= 2 ? 1 : 2;
  return 3;
}

export function decodeAec(data, { bits, blockSize, rsi, flags, count }) {
  const idBits = idLength(bits, flags);
  const uncompressed = 2 ** idBits - 1;
  const preprocess = Boolean(flags & PREPROCESS);
  const intervalSamples = rsi * blockSize;
  const out = new Float64Array(count + intervalSamples);
  let pos = 0;

  const read = (n) => {
    let i = pos >>> 3;
    const off = pos & 7;
    pos += n;
    const avail = 8 - off;
    const first = data[i++] & (0xff >>> off);
    if (n <= avail) return first >>> (avail - n);
    let v = first;
    let need = n - avail;
    while (need >= 8) {
      v = v * 256 + data[i++];
      need -= 8;
    }
    if (need > 0) v = v * (1 << need) + (data[i] >>> (8 - need));
    return v;
  };
  // A run of zeros ended by a one. Its length is the value.
  const readUnary = () => {
    let zeros = 0;
    for (;;) {
      const i = pos >>> 3;
      if (i >= data.length) throw new Error('Compressed data ended early');
      const off = pos & 7;
      const masked = data[i] & (0xff >>> off);
      if (masked === 0) {
        zeros += 8 - off;
        pos += 8 - off;
      } else {
        const run = Math.clz32(masked) - 24 - off;
        zeros += run;
        pos += run + 1;
        return zeros;
      }
    }
  };

  let n = 0;
  while (n < count) {
    const start = n;
    let needReference = preprocess;
    while (n - start < intervalSamples && n < count) {
      const reference = needReference ? 1 : 0;
      needReference = false;
      const id = read(idBits);
      if (id === uncompressed) {
        for (let i = 0; i < blockSize; i++) out[n++] = read(bits);
      } else if (id === 0) {
        const secondExtension = read(1) === 1;
        if (reference) out[n++] = read(bits);
        if (secondExtension) {
          let i = reference;
          while (i < blockSize) {
            const m = readUnary();
            if (2 * m + 1 >= SECOND_EXTENSION.length) throw new Error('Invalid compressed block');
            const low = m - SECOND_EXTENSION[2 * m + 1];
            if ((i & 1) === 0) {
              out[n++] = SECOND_EXTENSION[2 * m] - low;
              i += 1;
            }
            out[n++] = low;
            i += 1;
          }
        } else {
          let zeroBlocks = readUnary() + 1;
          if (zeroBlocks === ROS) {
            const used = Math.floor((n - start) / blockSize);
            zeroBlocks = Math.min(rsi - used, 64 - (used % 64));
          } else if (zeroBlocks > ROS) {
            zeroBlocks -= 1;
          }
          n += zeroBlocks * blockSize - reference; // already zero
        }
      } else {
        const k = id - 1;
        if (reference) out[n++] = read(bits);
        const samples = blockSize - reference;
        const first = n;
        const scale = 2 ** k;
        for (let i = 0; i < samples; i++) out[n++] = readUnary() * scale;
        if (k > 0) for (let i = 0; i < samples; i++) out[first + i] += read(k);
      }
    }
    if (flags & PAD_RSI) pos = ((pos + 7) >>> 3) << 3;
  }

  const result = new Float64Array(count);
  if (!preprocess) {
    result.set(out.subarray(0, count));
    return result;
  }
  const xmax = 2 ** bits - 1;
  const middle = Math.floor(xmax / 2) + 1;
  let x = 0;
  for (let i = 0; i < count; i++) {
    const d = out[i];
    if (i % intervalSamples === 0) {
      x = d;
    } else {
      const half = Math.ceil(d / 2);
      const odd = d % 2 === 1;
      const room = x < middle ? x : xmax - x;
      if (half <= room) x = odd ? x - half : x + half;
      else x = x < middle ? d : xmax - d;
    }
    result[i] = x;
  }
  return result;
}

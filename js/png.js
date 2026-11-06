// Turns raw pixels into a PNG file. Nothing is compressed, so the file is big but quick to make, and
// these files only go straight back to the map on the same page. No browser APIs, so the tests can
// run it.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_STORED_BLOCK = 65535;

export function encodePng(rgba, width, height) {
  const rowBytes = width * 4 + 1;
  const rawSize = rowBytes * height;
  const blocks = Math.ceil(rawSize / MAX_STORED_BLOCK) || 1;
  // zlib wrapper: 2 header bytes, 5 bytes before each stored block, 4 checksum bytes.
  const idatSize = 2 + blocks * 5 + rawSize + 4;
  const png = new Uint8Array(SIGNATURE.length + (12 + 13) + (12 + idatSize) + 12);
  const view = new DataView(png.buffer);
  let at = 0;
  png.set(SIGNATURE, at);
  at += SIGNATURE.length;

  const beginChunk = (type, length) => {
    view.setUint32(at, length);
    at += 4;
    for (let i = 0; i < 4; i++) png[at++] = type.charCodeAt(i);
    return at - 4;
  };
  const endChunk = (start) => {
    view.setUint32(at, crc32(png, start, at));
    at += 4;
  };

  let start = beginChunk('IHDR', 13);
  view.setUint32(at, width);
  view.setUint32(at + 4, height);
  png.set([8, 6, 0, 0, 0], at + 8); // 8 bits per channel, RGBA
  at += 13;
  endChunk(start);

  start = beginChunk('IDAT', idatSize);
  png[at++] = 0x78;
  png[at++] = 0x01;
  let a = 1;
  let b = 0;
  let written = 0;
  let left = 0;
  for (let row = 0; row < height; row++) {
    for (let i = -1; i < rowBytes - 1; i++) {
      if (left === 0) {
        left = Math.min(MAX_STORED_BLOCK, rawSize - written);
        png[at++] = written + left >= rawSize ? 1 : 0;
        png[at++] = left & 0xff;
        png[at++] = left >>> 8;
        png[at++] = ~left & 0xff;
        png[at++] = (~left >>> 8) & 0xff;
      }
      // Each row starts with a filter byte of 0, which means "no filter".
      const value = i < 0 ? 0 : rgba[row * width * 4 + i];
      png[at++] = value;
      a += value;
      if (a >= 65521) a -= 65521;
      b += a;
      if (b >= 65521) b -= 65521;
      written += 1;
      left -= 1;
    }
  }
  view.setUint32(at, ((b << 16) | a) >>> 0);
  at += 4;
  endChunk(start);

  start = beginChunk('IEND', 0);
  endChunk(start);
  return png;
}

// Builds small GRIB2 messages for the decoder tests, including the packing NOAA actually uses.
const u32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const sm32 = (value) => {
  const bytes = u32(Math.abs(value));
  if (value < 0) bytes[0] |= 0x80;
  return bytes;
};
const smN = (value, length) => {
  const bytes = [];
  let rest = Math.abs(value);
  for (let i = 0; i < length; i++) {
    bytes.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  }
  if (value < 0) bytes[0] |= 0x80;
  return bytes;
};
const float32 = (value) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return [...new Uint8Array(view.buffer)];
};

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
  align() { while (this.count % 8 !== 0) this.push(0, 1); }
}

const widthFor = (max) => (max === 0 ? 0 : Math.floor(Math.log2(max)) + 1);

function section(number, body) {
  return [...u32(body.length + 5), number, ...body];
}

function latLonGrid({ nx, ny, la1 = 90, lo1 = 0, dx = 1, dy = 1, gridRelative = false }) {
  const body = new Array(72 - 5).fill(0);
  const put = (offset, bytes) => bytes.forEach((byte, i) => { body[offset - 5 + i] = byte; });
  put(6, u32(nx * ny));
  put(12, [0, 0]);
  put(30, u32(nx));
  put(34, u32(ny));
  put(46, sm32(Math.round(la1 * 1e6)));
  put(50, sm32(Math.round(lo1 * 1e6)));
  put(54, [0x30 | (gridRelative ? 8 : 0)]);
  put(63, u32(Math.round(dx * 1e6)));
  put(67, u32(Math.round(dy * 1e6)));
  return section(3, body);
}

function lambertGrid({ nx, ny, la1, lo1, lov, dx, dy, lat0, gridRelative = true }) {
  const body = new Array(81 - 5).fill(0);
  const put = (offset, bytes) => bytes.forEach((byte, i) => { body[offset - 5 + i] = byte; });
  put(6, u32(nx * ny));
  put(12, [0, 30]);
  put(30, u32(nx));
  put(34, u32(ny));
  put(38, sm32(Math.round(la1 * 1e6)));
  put(42, sm32(Math.round(lo1 * 1e6)));
  put(46, [gridRelative ? 8 : 0]);
  put(51, sm32(Math.round(lov * 1e6)));
  put(55, sm32(Math.round(dx * 1e3)));
  put(59, sm32(Math.round(dy * 1e3)));
  put(65, sm32(Math.round(lat0 * 1e6)));
  return section(3, body);
}

function assemble(gridSection, dataRepresentation, data, { bitmap = 255 } = {}) {
  const parts = [
    ...[71, 82, 73, 66, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
    ...section(1, new Array(16).fill(0)),
    ...gridSection,
    ...section(4, new Array(29).fill(0)),
    ...dataRepresentation,
    ...section(6, [bitmap]),
    ...section(7, data),
    55, 55, 55, 55,
  ];
  return Uint8Array.from(parts);
}

// Data template 5.0: every value at the same width.
export function simplePacked(grid, ints, { reference = 0, binaryScale = 0, decimalScale = 0, bits = 10, lambert = false, bitmap } = {}) {
  const packed = new Bits();
  ints.forEach((value) => packed.push(value, bits));
  const body = [
    ...u32(ints.length), 0, 0,
    ...float32(reference), ...smN(binaryScale, 2), ...smN(decimalScale, 2), bits, 0,
  ];
  return assemble(lambert ? lambertGrid(grid) : latLonGrid(grid), section(5, body), packed.bytes, { bitmap });
}

// Data template 5.3: groups of values, stored as differences from their neighbours.
export function complexPacked(grid, ints, { order = 2, groups = [2, 3], reference = 0, binaryScale = 0, decimalScale = 0, missingManagement = 0 } = {}) {
  const differences = ints.map((value, i) => {
    if (i < order) return 0;
    return order === 1 ? value - ints[i - 1] : value - 2 * ints[i - 1] + ints[i - 2];
  });
  const minimum = Math.min(...differences.slice(order));
  const shifted = differences.map((value, i) => (i < order ? 0 : value - minimum));

  let start = 0;
  const groupInfo = groups.map((length) => {
    const members = shifted.slice(start, start + length);
    start += length;
    const low = Math.min(...members);
    return { low, width: widthFor(Math.max(...members) - low), length, members };
  });

  const referenceBits = Math.max(1, widthFor(Math.max(...groupInfo.map((group) => group.low))));
  const widthBits = Math.max(1, widthFor(Math.max(...groupInfo.map((group) => group.width))));
  const lengthBits = Math.max(1, widthFor(Math.max(...groups)));
  const extraOctets = 2;

  const packed = new Bits();
  const extras = order === 2 ? [ints[0], ints[1], minimum] : [ints[0], minimum];
  extras.forEach((value) => smN(value, extraOctets).forEach((byte) => packed.push(byte, 8)));
  groupInfo.forEach((group) => packed.push(group.low, referenceBits));
  packed.align();
  groupInfo.forEach((group) => packed.push(group.width, widthBits));
  packed.align();
  groupInfo.forEach((group) => packed.push(group.length, lengthBits));
  packed.align();
  groupInfo.forEach((group) => group.members.forEach((member) => packed.push(member - group.low, group.width)));

  const body = [
    ...u32(ints.length), 0, 3,
    ...float32(reference), ...smN(binaryScale, 2), ...smN(decimalScale, 2), referenceBits, 0,
    1, missingManagement, ...u32(0), ...u32(0),
    ...u32(groups.length), 0, widthBits,
    ...u32(0), 1, ...u32(groups.at(-1)), lengthBits,
    order, extraOctets,
  ];
  return assemble(latLonGrid(grid), section(5, body), packed.bytes);
}

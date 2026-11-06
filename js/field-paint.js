// Turns a grid of values into the pixels of one map tile. No browser APIs, so the tests can run it.
import { sampleGrid } from './grid-math.js';

const MERCATOR_LIMIT = Math.PI;

export function tileLatitudes(y, z, size) {
  const lats = new Float64Array(size);
  const world = 2 ** z;
  for (let row = 0; row < size; row++) {
    const fraction = (y + (row + 0.5) / size) / world;
    lats[row] = (Math.atan(Math.sinh(MERCATOR_LIMIT * (1 - 2 * fraction))) * 180) / Math.PI;
  }
  return lats;
}

export function tileLongitudes(x, z, size) {
  const lngs = new Float64Array(size);
  const world = 2 ** z;
  for (let column = 0; column < size; column++) lngs[column] = ((x + (column + 0.5) / size) / world) * 360 - 180;
  return lngs;
}

// Fills an RGBA pixel array for one map tile. Pixels with no data stay transparent.
export function paintTile(rgba, size, { x, y, z }, grid, values, lookup, nearest = false) {
  const lats = tileLatitudes(y, z, size);
  const lngs = tileLongitudes(x, z, size);
  const { min, max, scale, rgba: table } = lookup;
  const last = lookup.size - 1;
  let out = 0;
  for (let row = 0; row < size; row++) {
    const lat = lats[row];
    for (let column = 0; column < size; column++, out += 4) {
      let value;
      if (nearest) {
        const j = Math.round((grid.la1 - lat) / grid.dy);
        const i = Math.round((((lngs[column] - grid.lo1) % 360 + 360) % 360) / grid.dx) % grid.nx;
        value = j >= 0 && j < grid.ny ? values[j * grid.nx + i] : NaN;
      } else {
        value = sampleGrid(grid, values, lat, lngs[column]);
      }
      if (value !== value) continue;
      const clamped = value < min ? min : value > max ? max : value;
      const slot = Math.round((clamped - min) * scale);
      const at = (slot > last ? last : slot) * 4;
      rgba[out] = table[at];
      rgba[out + 1] = table[at + 1];
      rgba[out + 2] = table[at + 2];
      rgba[out + 3] = table[at + 3];
    }
  }
}

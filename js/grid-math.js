// Working with decoded grids: keeping them north-up, thinning them and reading values from them.
// No browser APIs, so it runs in the worker, on the page and in the tests.

// Grids usually run north to south. A few run south to north, and this flips those to match.
export function northUp(field) {
  if (!(field.scan & 0x40)) return field;
  const { nx, ny, values } = field;
  const flipped = new Float32Array(values.length);
  for (let j = 0; j < ny; j++) flipped.set(values.subarray(j * nx, (j + 1) * nx), (ny - 1 - j) * nx);
  return { ...field, values: flipped, la1: field.la1 + (ny - 1) * field.dy, scan: field.scan & ~0x40 };
}

// Keeps every step-th point. An animation looks the same with far fewer, and each costs memory.
export function thinGrid(field, step) {
  if (step === 1) return field;
  const nx = Math.floor(field.nx / step);
  const ny = Math.floor((field.ny - 1) / step) + 1;
  const values = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) values[j * nx + i] = field.values[j * step * field.nx + i * step];
  }
  return { ...field, nx, ny, dx: field.dx * step, dy: field.dy * step, values };
}

export const isGlobal = (grid) => grid.nx * grid.dx >= 359.9;

// A value at a point, blended from the four surrounding grid points. Points with no data are
// left out of the blend, so coasts stay clean. NaN off the grid or where there's no data at all.
export function sampleGrid(grid, values, lat, lng) {
  const j = (grid.la1 - lat) / grid.dy;
  if (j < 0 || j > grid.ny - 1) return NaN;
  const offset = ((lng - grid.lo1) % 360 + 360) % 360;
  const i = offset / grid.dx;
  const global = isGlobal(grid);
  if (!global && i > grid.nx - 1) return NaN;
  const i0 = Math.floor(i);
  const i1 = global ? (i0 + 1) % grid.nx : Math.min(i0 + 1, grid.nx - 1);
  const j0 = Math.floor(j);
  const j1 = Math.min(j0 + 1, grid.ny - 1);
  const fi = i - i0;
  const fj = j - j0;
  const a = values[j0 * grid.nx + (i0 % grid.nx)];
  const b = values[j0 * grid.nx + i1];
  const c = values[j1 * grid.nx + (i0 % grid.nx)];
  const d = values[j1 * grid.nx + i1];
  const wa = (1 - fi) * (1 - fj);
  const wb = fi * (1 - fj);
  const wc = (1 - fi) * fj;
  const wd = fi * fj;
  if (a === a && b === b && c === c && d === d) return a * wa + b * wb + c * wc + d * wd;
  let sum = 0;
  let weight = 0;
  if (a === a) { sum += a * wa; weight += wa; }
  if (b === b) { sum += b * wb; weight += wb; }
  if (c === c) { sum += c * wc; weight += wc; }
  if (d === d) { sum += d * wd; weight += wd; }
  return weight > 0.5 ? sum / weight : NaN;
}

export const fromDegrees = (u, v) => ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;

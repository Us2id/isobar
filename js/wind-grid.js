// Finding, slicing and reading NOAA's global wind grid. No browser APIs here, so it runs in the
// wind worker, on the page, and in the tests.
const HOUR = 3_600_000;
const SIX_HOURS = 6 * HOUR;
const GFS_BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';

// GFS runs start every 6 hours and take roughly 4 hours to appear. Each candidate is the
// forecast hour closest to now within that run. Newest first, older runs are fallbacks.
export function gfsCandidates(nowMs, count = 4) {
  const candidates = [];
  let run = Math.floor((nowMs - 4 * HOUR) / SIX_HOURS) * SIX_HOURS;
  for (let i = 0; i < count; i++, run -= SIX_HOURS) {
    const date = new Date(run);
    const day = date.toISOString().slice(0, 10).replace(/-/g, '');
    const cycle = String(date.getUTCHours()).padStart(2, '0');
    const forecastHour = Math.round((nowMs - run) / HOUR);
    const hour = String(forecastHour).padStart(3, '0');
    candidates.push({
      run,
      forecastHour,
      validTime: run + forecastHour * HOUR,
      url: `${GFS_BUCKET}/gfs.${day}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.0p25.f${hour}`,
    });
  }
  return candidates;
}

// A GRIB file is hundreds of MB. Its .idx file says where each field starts, so the site can
// download just the two wind fields. A field ends one byte before the next one starts.
export function byteRange(idxText, variable, level = '10 m above ground') {
  const lines = idxText.trim().split('\n');
  const index = lines.findIndex((line) => {
    const parts = line.split(':');
    return parts[3] === variable && parts[4] === level;
  });
  if (index < 0 || index + 1 >= lines.length) throw new Error(`${variable} at ${level} is not in the index`);
  return [Number(lines[index].split(':')[1]), Number(lines[index + 1].split(':')[1]) - 1];
}

// Keeps every step-th point. The animation looks the same with far fewer points, and each one
// costs memory on the page.
export function thinGrid(field, step) {
  const nx = Math.floor(field.nx / step);
  const ny = Math.floor((field.ny - 1) / step) + 1;
  const values = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) values[j * nx + i] = field.values[j * step * field.nx + i * step];
  }
  return { nx, ny, dx: field.dx * step, dy: field.dy * step, la1: field.la1, lo1: field.lo1, values };
}

export const windFromDegrees = (u, v) => ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;

// Wind at a point, blended from the four surrounding grid points. Null off the grid.
export function windAt(grid, lat, lng) {
  const j = (grid.la1 - lat) / grid.dy;
  if (j < 0 || j > grid.ny - 1) return null;
  const i = (((lng - grid.lo1) % 360) + 360) % 360 / grid.dx;
  const i0 = Math.floor(i) % grid.nx;
  const i1 = (i0 + 1) % grid.nx;
  const j0 = Math.floor(j);
  const j1 = Math.min(j0 + 1, grid.ny - 1);
  const fi = i - Math.floor(i);
  const fj = j - j0;
  const blend = (field) => {
    const top = field[j0 * grid.nx + i0] * (1 - fi) + field[j0 * grid.nx + i1] * fi;
    const bottom = field[j1 * grid.nx + i0] * (1 - fi) + field[j1 * grid.nx + i1] * fi;
    return top * (1 - fj) + bottom * fj;
  };
  const u = blend(grid.u);
  const v = blend(grid.v);
  return { u, v, speed: Math.hypot(u, v), fromDegrees: windFromDegrees(u, v) };
}

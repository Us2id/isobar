// Downloads and unpacks the wind off the main thread, so the page never freezes while it happens.
import { decodeGrib2 } from './grib2.js';
import { byteRange, gfsCandidates, thinGrid } from './wind-grid.js';

const TIMEOUT_MS = 60_000;
const THIN_STEP = 2; // 0.25° to 0.5°

async function findRun(now) {
  for (const candidate of gfsCandidates(now)) {
    const response = await fetch(`${candidate.url}.idx`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
    if (response?.ok) return { ...candidate, index: await response.text() };
  }
  throw new Error('No recent GFS run was found');
}

async function fetchField(url, [start, end]) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 206) throw new Error(`Expected part of the file, got HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

self.onmessage = async () => {
  try {
    const run = await findRun(Date.now());
    const [uBytes, vBytes] = await Promise.all([
      fetchField(run.url, byteRange(run.index, 'UGRD')),
      fetchField(run.url, byteRange(run.index, 'VGRD')),
    ]);
    const uField = decodeGrib2(uBytes);
    const vField = decodeGrib2(vBytes);
    if (uField.gridRelative || vField.gridRelative) throw new Error('Expected earth-relative winds');
    const u = thinGrid(uField, THIN_STEP);
    const v = thinGrid(vField, THIN_STEP);
    self.postMessage(
      {
        ok: true,
        run: run.run,
        forecastHour: run.forecastHour,
        validTime: run.validTime,
        grid: { nx: u.nx, ny: u.ny, dx: u.dx, dy: u.dy, la1: u.la1, lo1: u.lo1, u: u.values, v: v.values },
      },
      [u.values.buffer, v.values.buffer],
    );
  } catch (error) {
    self.postMessage({ ok: false, message: String(error?.message ?? error) });
  }
};

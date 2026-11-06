// Downloads and unpacks forecast fields off the main thread, so the page never freezes.
import { fieldById, sourceFor } from './catalog/fields.js';
import { dataTemplate, decodeGrib2 } from './grib2.js';
import { loadJpeg2000 } from './jpeg2000.js';
import { northUp, thinGrid } from './grid-math.js';
import { candidates, fieldHour, PRODUCTS } from './sources.js';

const TIMEOUT_MS = 60_000;
const indexes = new Map();

async function getIndex(product, url) {
  const address = product.indexUrl(url);
  if (!indexes.has(address)) {
    const response = await fetch(address, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Index returned ${response.status}`);
    if (indexes.size > 40) indexes.clear();
    indexes.set(address, product.parseIndex(await response.text()));
  }
  return indexes.get(address);
}

async function fetchField(url, entry) {
  const range = `bytes=${entry.start}-${entry.end ?? ''}`;
  // Skips the browser's cache, which handles part-of-a-file requests badly. Chrome held parallel
  // parts of one NOAA file for up to 30 s, and hung on every other part from ECMWF. Without it they
  // take under a second. GridService keeps recent results in memory instead. Tested 2026-11-06.
  const response = await fetch(url, { headers: { Range: range }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== 206) throw new Error(`Expected part of the file, got HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const jpeg2000 = dataTemplate(bytes) === 40 ? await loadJpeg2000() : undefined;
  return northUp(decodeGrib2(bytes, { jpeg2000 }));
}

// Tries one run. Throws if any file or field isn't there yet, so the next run gets its turn.
async function fromRun(product, fields, candidate) {
  const located = await Promise.all(fields.map(async (field) => {
    const url = product.fileUrl(candidate.run, fieldHour(product, candidate.hour, field));
    const entries = await getIndex(product, url);
    const entry = product.findField(entries, field);
    if (!entry) throw new Error(`${JSON.stringify(field)} is not in the index`);
    return { url, entry };
  }));
  return Promise.all(located.map(({ url, entry }) => fetchField(url, entry)));
}

export async function loadFields(source, wantedTime) {
  const product = PRODUCTS[source.product];
  let lastError = new Error('No forecast run covers this time');
  for (const candidate of candidates(product, wantedTime)) {
    try {
      const grids = await fromRun(product, source.fields, candidate);
      return { candidate, grids };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Runs a field's formula over every grid point. Each input's missing points stay missing.
export function combine(value, grids) {
  const inputs = grids.map((grid) => grid.values);
  const size = inputs[0].length;
  const out = new Float32Array(size);
  if (inputs.length === 1) {
    const [a] = inputs;
    for (let i = 0; i < size; i++) out[i] = value(a[i]);
  } else if (inputs.length === 2) {
    const [a, b] = inputs;
    for (let i = 0; i < size; i++) out[i] = value(a[i], b[i]);
  } else {
    const args = new Array(inputs.length);
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < inputs.length; k++) args[k] = inputs[k][i];
      out[i] = value(...args);
    }
  }
  return out;
}

function shape(grid) {
  return { nx: grid.nx, ny: grid.ny, dx: grid.dx, dy: grid.dy, la1: grid.la1, lo1: grid.lo1 };
}

self.onmessage = async ({ data: { id, fieldId, model, time, thin = 1 } }) => {
  try {
    const entry = fieldById(fieldId);
    const source = sourceFor(entry, model);
    if (!source) throw new Error(`${fieldId} is not available from ${model}`);
    const { candidate, grids } = await loadFields(source, time);
    const meta = {
      run: candidate.run,
      forecastHour: candidate.hour,
      validTime: candidate.validTime,
      product: source.product,
    };
    if (entry.vector) {
      const u = thinGrid(grids[0], thin);
      const v = thinGrid(grids[1], thin);
      self.postMessage({ id, ok: true, ...meta, grid: { ...shape(u), u: u.values, v: v.values } }, [u.values.buffer, v.values.buffer]);
      return;
    }
    const values = combine(source.value, grids);
    const thinned = thinGrid({ ...grids[0], values }, thin);
    self.postMessage({ id, ok: true, ...meta, grid: { ...shape(thinned), values: thinned.values } }, [thinned.values.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, message: String(error?.message ?? error) });
  }
};

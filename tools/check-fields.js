// Downloads every field in the catalog from NOAA and ECMWF and checks its values look right.
// Run this when something looks off, or to find out whether a source changed its files:
//   node tools/check-fields.js              every field, every model
//   node tools/check-fields.js soil rain    only ids containing these words
// It downloads a lot (about 300 MB), so it isn't part of `npm test`.
import { fieldById, FIELDS } from '../js/catalog/fields.js';
import { dataTemplate, decodeGrib2 } from '../js/grib2.js';
import { loadJpeg2000 } from '../js/jpeg2000.js';
import { northUp } from '../js/grid-math.js';
import { candidates, fieldHour, PRODUCTS } from '../js/sources.js';

const indexes = new Map();
async function getIndex(product, url) {
  const address = product.indexUrl(url);
  if (!indexes.has(address)) {
    const response = await fetch(address);
    if (!response.ok) throw new Error(`index ${response.status}`);
    indexes.set(address, product.parseIndex(await response.text()));
  }
  return indexes.get(address);
}

async function loadGrid(product, candidate, field) {
  const url = product.fileUrl(candidate.run, fieldHour(product, candidate.hour, field));
  const entries = await getIndex(product, url);
  const entry = product.findField(entries, field);
  if (!entry) throw new Error(`not in index: ${JSON.stringify(field)}`);
  const response = await fetch(url, { headers: { Range: `bytes=${entry.start}-${entry.end ?? ''}` } });
  if (response.status !== 206) throw new Error(`data ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const jpeg2000 = dataTemplate(bytes) === 40 ? await loadJpeg2000() : undefined;
  return { grid: northUp(decodeGrib2(bytes, { jpeg2000 })), size: bytes.length };
}

function statistics(values) {
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let good = 0;
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (x === x) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      sum += x;
      good += 1;
    }
  }
  return { lo, hi, mean: sum / good, filled: good / values.length };
}

const round = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toPrecision(2));

async function checkSource(entry, model, source) {
  const product = PRODUCTS[source.product];
  const wanted = Date.now();
  let lastError = null;
  for (const candidate of candidates(product, wanted)) {
    try {
      const loaded = await Promise.all(source.fields.map((field) => loadGrid(product, candidate, field)));
      const grids = loaded.map((item) => item.grid);
      const size = loaded.reduce((sum, item) => sum + item.size, 0);
      const inputs = grids.map((grid) => grid.values);
      const count = inputs[0].length;
      const out = new Float32Array(count);
      const args = new Array(inputs.length);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < inputs.length; k++) args[k] = inputs[k][i];
        out[i] = source.value(...args);
      }
      const { lo, hi, mean, filled } = statistics(out);
      const stops = entry.ramp?.stops?.map((stop) => stop[0]);
      const min = stops ? stops[0] : -Infinity;
      const max = stops ? stops.at(-1) : Infinity;
      const span = max - min;
      const odd = [];
      if (filled === 0) odd.push('EMPTY');
      if (stops && (hi < min || lo > max)) odd.push('OUTSIDE RAMP');
      if (stops && (hi - lo) < span * 0.02) odd.push('FLAT');
      if (stops && (hi > max + span * 3 || lo < min - span * 3)) odd.push('FAR OUTSIDE RAMP');
      const grid = grids[0];
      console.log(`${odd.length ? '!!' : 'ok'} ${entry.id.padEnd(15)} ${model.padEnd(7)} f${String(candidate.hour).padStart(3, '0')} ${grid.nx}x${grid.ny} ${String(Math.round(size / 1024)).padStart(5)}KB  lo ${round(lo).padStart(8)}  mean ${round(mean).padStart(8)}  hi ${round(hi).padStart(8)}  filled ${(filled * 100).toFixed(0).padStart(3)}%  ramp ${min}..${max} ${odd.join(' ')}`);
      return odd.length === 0;
    } catch (error) {
      lastError = error;
    }
  }
  console.log(`XX ${entry.id.padEnd(15)} ${model.padEnd(7)} ${lastError?.message}`);
  return false;
}

const words = process.argv.slice(2);
const chosen = FIELDS.filter((entry) => words.length === 0 || words.some((word) => entry.id.includes(word)));
const flowIds = ['flow10', 'flow100', 'flow925', 'flow850', 'flow700', 'flow600', 'flow500', 'flow300', 'currents'].filter((id) => words.length === 0 || words.some((word) => id.includes(word)));
const flows = flowIds.map((id) => fieldById(id));
let passed = 0;
let total = 0;
for (const entry of [...chosen, ...flows]) {
  for (const [model, source] of Object.entries(entry.sources)) {
    total += 1;
    const useSource = entry.vector ? { ...source, value: Math.hypot } : source;
    const shown = entry.vector ? { ...entry, ramp: null } : entry;
    if (await checkSource(shown, model, useSource)) passed += 1;
  }
}
console.log(`\n${passed} of ${total} sources passed`);

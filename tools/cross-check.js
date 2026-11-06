// Compares our decoded forecast values with Open-Meteo's copy of the same model at a few places.
// A catalog entry that reads the wrong file, level or unit shows up here even when its range looks fine.
//   node tools/cross-check.js
// A few misses are normal. Open-Meteo adjusts for elevation and can use a different grid or an
// older run, so coasts and mountains differ most, and its wave model isn't GFS Wave. Look for a whole
// row that's off, which means a wrong field or unit, rather than one city.
import { fieldById, sourceFor } from '../js/catalog/fields.js';
import { dataTemplate, decodeGrib2 } from '../js/grib2.js';
import { northUp, sampleGrid } from '../js/grid-math.js';
import { loadJpeg2000 } from '../js/jpeg2000.js';
import { candidates, fieldHour, PRODUCTS } from '../js/sources.js';

const PLACES = [
  ['Mumbai', 19.08, 72.88],
  ['Denver', 39.74, -104.99],
  ['Sao Paulo', -23.55, -46.63],
  ['Nairobi', -1.29, 36.82],
  ['Moscow', 55.75, 37.62],
  ['Sydney', -33.87, 151.21],
];

const SEA_PLACES = [
  ['Arabian Sea', 15, 65],
  ['North Atlantic', 45, -30],
  ['South Pacific', -30, -120],
  ['Southern Ocean', -50, 80],
];

// [our field id, Open-Meteo variable, how to convert theirs to ours, allowed difference]
const LAND_CHECKS = [
  ['t2m', 'temperature_2m', (x) => x, 3],
  ['dew', 'dew_point_2m', (x) => x, 4],
  ['rh', 'relative_humidity_2m', (x) => x, 20],
  ['mslp', 'pressure_msl', (x) => x, 3],
  ['ps', 'surface_pressure', (x) => x, 15],
  ['w10', 'wind_speed_10m', (x) => x / 3.6, 3],
  ['gust', 'wind_gusts_10m', (x) => x / 3.6, 6],
  ['tcc', 'cloud_cover', (x) => x, 60],
  ['soil0-10', 'soil_moisture_0_to_10cm', (x) => x * 100, 8],
  ['soilt0-10', 'soil_temperature_0_to_10cm', (x) => x, 5],
];

const SEA_CHECKS = [
  ['waveheight', 'wave_height', (x) => x, 1.2],
  ['waveperiod', 'wave_period', (x) => x, 4],
  ['sst', 'sea_surface_temperature', (x) => x, 2.5],
];

const AIR_CHECKS = [['pm25', 'pm2_5', (x) => x, 40]];

async function ourGrid(entry, model, time) {
  const source = sourceFor(entry, model);
  const product = PRODUCTS[source.product];
  let lastError;
  for (const candidate of candidates(product, time)) {
    try {
      const grids = await Promise.all(source.fields.map(async (field) => {
        const url = product.fileUrl(candidate.run, fieldHour(product, candidate.hour, field));
        const index = product.parseIndex(await (await fetch(product.indexUrl(url))).text());
        const found = product.findField(index, field);
        if (!found) throw new Error('field not in index');
        const response = await fetch(url, { headers: { Range: `bytes=${found.start}-${found.end ?? ''}` } });
        if (response.status !== 206) throw new Error(`data ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return northUp(decodeGrib2(bytes, { jpeg2000: dataTemplate(bytes) === 40 ? await loadJpeg2000() : undefined }));
      }));
      const first = grids[0];
      const inputs = grids.map((grid) => grid.values);
      const out = new Float32Array(inputs[0].length);
      const args = new Array(inputs.length);
      for (let i = 0; i < out.length; i++) {
        for (let k = 0; k < inputs.length; k++) args[k] = inputs[k][i];
        out[i] = source.value(...args);
      }
      return { grid: first, values: out, validTime: candidate.validTime, hour: candidate.hour };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function theirValues(base, model, variables, places, time) {
  const params = new URLSearchParams({
    latitude: places.map((place) => place[1]).join(','),
    longitude: places.map((place) => place[2]).join(','),
    hourly: variables.join(','),
    timeformat: 'unixtime',
    forecast_days: '2',
    past_days: '1',
    ...(model ? { models: model } : {}),
  });
  const response = await fetch(`${base}?${params}`);
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return (Array.isArray(body) ? body : [body]).map((place) => {
    const at = place.hourly.time.findIndex((t) => t * 1000 >= time);
    return Object.fromEntries(variables.map((variable) => [variable, place.hourly[variable]?.[at]]));
  });
}

async function run(title, base, omModel, ourModel, checks, places) {
  console.log(`\n${title}`);
  const time = Date.now() + 2 * 3_600_000;
  const grids = new Map();
  for (const [id] of checks) grids.set(id, await ourGrid(fieldById(id), ourModel, time));
  const stamp = grids.get(checks[0][0]).validTime;
  const theirs = await theirValues(base, omModel, checks.map((check) => check[1]), places, stamp);
  let bad = 0;
  let total = 0;
  for (const [id, variable, convert, allowed] of checks) {
    const { grid, values } = grids.get(id);
    const row = places.map(([, lat, lng], index) => {
      const ours = sampleGrid(grid, values, lat, lng);
      const raw = theirs[index][variable];
      if (raw == null || ours !== ours) return '   -- ';
      const theirValue = convert(raw);
      const gap = Math.abs(ours - theirValue);
      total += 1;
      if (gap > allowed) bad += 1;
      return `${gap > allowed ? '!' : ' '}${ours.toFixed(1)}/${theirValue.toFixed(1)}`;
    });
    console.log(`${id.padEnd(16)} ${row.map((cell) => cell.padStart(14)).join('')}`);
  }
  console.log(`${total - bad} of ${total} within tolerance (ours/theirs)`);
  return bad;
}

const failures = [
  await run('GFS against Open-Meteo gfs_global', 'https://api.open-meteo.com/v1/forecast', 'gfs_global', 'gfs', LAND_CHECKS, PLACES),
  await run('ECMWF IFS against Open-Meteo ecmwf_ifs025', 'https://api.open-meteo.com/v1/forecast', 'ecmwf_ifs025', 'ecmwf', LAND_CHECKS.filter(([id]) => !id.startsWith('soil')), PLACES),
  await run('Sea against Open-Meteo marine', 'https://marine-api.open-meteo.com/v1/marine', null, 'gfs', SEA_CHECKS, SEA_PLACES),
  await run('Aerosols against Open-Meteo air quality (a different model, CAMS, so loose)', 'https://air-quality-api.open-meteo.com/v1/air-quality', null, 'gfs', AIR_CHECKS, PLACES),
].reduce((sum, count) => sum + count, 0);
console.log(failures === 0 ? '\nAll within tolerance.' : `\n${failures} values out of tolerance. Look at those rows.`);

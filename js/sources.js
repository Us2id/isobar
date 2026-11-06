// Where each forecast product's files live, and how to find one field inside them. No browser
// APIs here, so it runs in the data worker, on the page and in the tests.
const HOUR = 3_600_000;

const pad = (value, width) => String(value).padStart(width, '0');
const yyyymmdd = (time) => new Date(time).toISOString().slice(0, 10).replace(/-/g, '');
const cycleOf = (time) => pad(new Date(time).getUTCHours(), 2);
const yyyymmddhh = (time) => `${yyyymmdd(time)}${cycleOf(time)}`;

const hourlyThenThreeHourly = (hours) => (hours <= 120 ? Math.round(hours) : 120 + Math.round((hours - 120) / 3) * 3);
const everyHours = (step) => (hours) => Math.round(hours / step) * step;

// NOAA's index files are one line per field: number:offset:date:VARIABLE:LEVEL:TIME:extra
export function parseNoaaIndex(text) {
  const rows = text.trim().split('\n').map((line) => line.split(':'));
  return rows.map((parts, i) => ({
    start: Number(parts[1]),
    end: i + 1 < rows.length ? Number(rows[i + 1][1]) - 1 : null,
    variable: parts[3],
    level: parts[4],
    time: parts[5],
    extra: parts.slice(6).join(':'),
  }));
}

const TIME_KINDS = {
  inst: /^(\d+ hour fcst|anl)$/,
  ave: /^\d+-\d+ hour ave fcst$/,
  acc: /^\d+-\d+ hour acc fcst$/,
  total: /^0-\d+ hour acc fcst$/,
  max: /^\d+-\d+ hour max fcst$/,
  min: /^\d+-\d+ hour min fcst$/,
};

export function findNoaaField(entries, { v, l, t, x }) {
  const pattern = t ? TIME_KINDS[t] : null;
  const matches = entries.filter((entry) => entry.variable === v && entry.level === l
    && (!pattern || pattern.test(entry.time))
    && (!x || entry.extra.includes(x)));
  if (matches.length === 0) return null;
  // With no time kind asked for, prefer the instant value over an average.
  return matches.find((entry) => TIME_KINDS.inst.test(entry.time)) ?? matches[0];
}

// ECMWF's index files are one JSON object per line.
export function parseEcmwfIndex(text) {
  return text.trim().split('\n').map((line) => {
    const row = JSON.parse(line);
    return { start: row._offset, end: row._offset + row._length - 1, param: row.param, levelist: row.levelist ?? null };
  });
}

export function findEcmwfField(entries, { p, lev }) {
  return entries.find((entry) => entry.param === p && (lev === undefined || entry.levelist === String(lev))) ?? null;
}

const noaa = { indexUrl: (url) => `${url}.idx`, parseIndex: parseNoaaIndex, findField: findNoaaField };
const ecmwf = {
  indexUrl: (url) => url.replace(/\.grib2$/, '.index'),
  parseIndex: parseEcmwfIndex,
  findField: findEcmwfField,
};

const NOAA_GFS = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
const ECMWF_DATA = 'https://data.ecmwf.int/forecasts';

export const PRODUCTS = {
  gfs: {
    ...noaa,
    label: 'NOAA GFS',
    cycleHours: 6,
    delayHours: 4,
    maxHours: 384,
    step: hourlyThenThreeHourly,
    fileUrl: (run, hour) => {
      const cycle = cycleOf(run);
      return `${NOAA_GFS}/gfs.${yyyymmdd(run)}/${cycle}/atmos/gfs.t${cycle}z.pgrb2.0p25.f${pad(hour, 3)}`;
    },
  },
  wave: {
    ...noaa,
    label: 'NOAA GFS Wave',
    cycleHours: 6,
    delayHours: 5,
    maxHours: 384,
    step: hourlyThenThreeHourly,
    fileUrl: (run, hour) => {
      const cycle = cycleOf(run);
      return `${NOAA_GFS}/gfs.${yyyymmdd(run)}/${cycle}/wave/gridded/gfswave.t${cycle}z.global.0p25.f${pad(hour, 3)}.grib2`;
    },
  },
  gefs: {
    ...noaa,
    label: 'NOAA GEFS Aerosols',
    cycleHours: 6,
    delayHours: 8,
    maxHours: 120,
    step: everyHours(3),
    fileUrl: (run, hour) => {
      const cycle = cycleOf(run);
      return `https://noaa-gefs-pds.s3.amazonaws.com/gefs.${yyyymmdd(run)}/${cycle}/chem/pgrb2ap25/gefs.chem.t${cycle}z.a2d_0p25.f${pad(hour, 3)}.grib2`;
    },
  },
  cfs: {
    ...noaa,
    label: 'NOAA CFS Ocean',
    cycleHours: 6,
    delayHours: 14,
    maxHours: 384,
    minHours: 6,
    step: everyHours(6),
    fileUrl: (run, hour) => {
      const cycle = cycleOf(run);
      const valid = yyyymmddhh(run + hour * HOUR);
      return `https://noaa-cfs-pds.s3.amazonaws.com/cfs.${yyyymmdd(run)}/${cycle}/6hrly_grib_01/ocnf${valid}.01.${yyyymmddhh(run)}.grb2`;
    },
  },
  ecmwf: {
    ...ecmwf,
    label: 'ECMWF IFS',
    cycleHours: 12,
    delayHours: 8,
    maxHours: 144,
    step: everyHours(3),
    fileUrl: (run, hour) => `${ECMWF_DATA}/${yyyymmdd(run)}/${cycleOf(run)}z/ifs/0p25/oper/${yyyymmddhh(run)}0000-${hour}h-oper-fc.grib2`,
  },
  aifs: {
    ...ecmwf,
    label: 'ECMWF AIFS',
    cycleHours: 6,
    delayHours: 7,
    maxHours: 360,
    step: everyHours(6),
    fileUrl: (run, hour) => `${ECMWF_DATA}/${yyyymmdd(run)}/${cycleOf(run)}z/aifs-single/0p25/oper/${yyyymmddhh(run)}0000-${hour}h-oper-fc.grib2`,
  },
};

// Runs to try for a wanted time, newest first. Each candidate is that run's forecast hour nearest
// the wanted time. Older runs are fallbacks for when a file hasn't appeared yet.
export function candidates(product, wantedTime, now = Date.now(), count = 4) {
  const cycle = product.cycleHours * HOUR;
  const minHours = product.minHours ?? 0;
  const list = [];
  let run = Math.floor((now - product.delayHours * HOUR) / cycle) * cycle;
  for (let i = 0; i < count; i++, run -= cycle) {
    const hour = product.step(Math.max(minHours, (wantedTime - run) / HOUR));
    if (hour < minHours || hour > product.maxHours) continue;
    list.push({ run, hour, validTime: run + hour * HOUR });
  }
  return list;
}

// The forecast hour a field actually reads, given its run's hour and any offset it asks for.
//   lead: this many hours later (used for "the next 24 hours" totals)
//   nextSix: the k-th 6-hourly file after this hour (used for daily highs and lows)
export function fieldHour(product, hour, field) {
  if (field.nextSix !== undefined) return (Math.floor(hour / 6) + 1 + field.nextSix) * 6;
  return product.step(hour + (field.lead ?? 0));
}

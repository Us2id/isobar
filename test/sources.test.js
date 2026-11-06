import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidates, fieldHour, findEcmwfField, findNoaaField, parseEcmwfIndex, parseNoaaIndex, PRODUCTS } from '../js/sources.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 6, 12, 42);

test('picks the newest GFS run that should exist and the forecast hour nearest the wanted time', () => {
  const [first, second] = candidates(PRODUCTS.gfs, Date.UTC(2026, 10, 6, 13), NOW);
  assert.equal(first.hour, 7);
  assert.equal(first.validTime, Date.UTC(2026, 10, 6, 13));
  assert.equal(PRODUCTS.gfs.fileUrl(first.run, first.hour), 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261106/06/atmos/gfs.t06z.pgrb2.0p25.f007');
  assert.equal(second.hour, 13);
  assert.equal(second.validTime, first.validTime, 'an older run still describes the same hour');
});

test('rolls back across midnight for the run date', () => {
  const now = Date.UTC(2026, 0, 1, 3);
  const [first] = candidates(PRODUCTS.gfs, now, now);
  assert.match(PRODUCTS.gfs.fileUrl(first.run, first.hour), /gfs\.20251231\/18\/atmos\/gfs\.t18z\.pgrb2\.0p25\.f009$/);
});

test('moves to the next GFS run only once it should have appeared', () => {
  assert.equal(candidates(PRODUCTS.gfs, NOW, Date.UTC(2026, 10, 6, 15, 59))[0].run, Date.UTC(2026, 10, 6, 6));
  assert.equal(candidates(PRODUCTS.gfs, NOW, Date.UTC(2026, 10, 6, 16, 0))[0].run, Date.UTC(2026, 10, 6, 12));
});

test('GFS files are hourly to 5 days, then 3-hourly', () => {
  assert.equal(PRODUCTS.gfs.step(119.6), 120);
  assert.equal(PRODUCTS.gfs.step(121), 120);
  assert.equal(PRODUCTS.gfs.step(122), 123);
  assert.equal(PRODUCTS.gfs.step(7.4), 7);
});

test('each product rounds to the times it actually has', () => {
  assert.equal(PRODUCTS.gefs.step(8), 9);
  assert.equal(PRODUCTS.cfs.step(10), 12);
  assert.equal(PRODUCTS.ecmwf.step(14), 15);
  assert.equal(PRODUCTS.aifs.step(14), 12);
});

test('builds the right file names for every product', () => {
  const run = Date.UTC(2026, 10, 6, 6);
  assert.equal(PRODUCTS.wave.fileUrl(run, 9), 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261106/06/wave/gridded/gfswave.t06z.global.0p25.f009.grib2');
  assert.equal(PRODUCTS.gefs.fileUrl(run, 9), 'https://noaa-gefs-pds.s3.amazonaws.com/gefs.20261106/06/chem/pgrb2ap25/gefs.chem.t06z.a2d_0p25.f009.grib2');
  assert.equal(PRODUCTS.cfs.fileUrl(run, 18), 'https://noaa-cfs-pds.s3.amazonaws.com/cfs.20261106/06/6hrly_grib_01/ocnf2026110700.01.2026110606.grb2');
  const ecmwfRun = Date.UTC(2026, 10, 6, 0);
  assert.equal(PRODUCTS.ecmwf.fileUrl(ecmwfRun, 12), 'https://data.ecmwf.int/forecasts/20261106/00z/ifs/0p25/oper/20261106000000-12h-oper-fc.grib2');
  assert.equal(PRODUCTS.ecmwf.indexUrl('a/b-12h-oper-fc.grib2'), 'a/b-12h-oper-fc.index');
  assert.equal(PRODUCTS.aifs.fileUrl(ecmwfRun, 6), 'https://data.ecmwf.int/forecasts/20261106/00z/aifs-single/0p25/oper/20261106000000-6h-oper-fc.grib2');
});

test('reports nothing for times beyond a forecast', () => {
  assert.deepEqual(candidates(PRODUCTS.ecmwf, NOW + 400 * HOUR, NOW), []);
  assert.ok(candidates(PRODUCTS.gfs, NOW + 300 * HOUR, NOW).length > 0);
});

const NOAA_INDEX = [
  '587:100:d=2026110606:TMP:2 m above ground:6 hour fcst:',
  '588:200:d=2026110606:UGRD:10 m above ground:6 hour fcst:',
  '589:300:d=2026110606:APCP:surface:0-7 hour acc fcst:',
  '590:400:d=2026110606:APCP:surface:6-7 hour acc fcst:',
  '591:500:d=2026110606:TCDC:entire atmosphere:6-7 hour ave fcst:',
  '592:600:d=2026110606:TCDC:entire atmosphere:7 hour fcst:',
  '593:700:d=2026110606:PMTF:surface:24 hour fcst:aerosol=Dust dry:aerosol_size<2.5e-06',
  '594:800:d=2026110606:PMTF:surface:24 hour fcst:aerosol=Total aerosol:aerosol_size<2.5e-06',
].join('\n');

test('reads NOAA index lines, with each field ending before the next starts', () => {
  const entries = parseNoaaIndex(NOAA_INDEX);
  assert.equal(entries[0].start, 100);
  assert.equal(entries[0].end, 199);
  assert.equal(entries.at(-1).end, null, 'the last field runs to the end of the file');
  assert.equal(entries[6].extra, 'aerosol=Dust dry:aerosol_size<2.5e-06');
});

test('tells apart totals, averages and instant values', () => {
  const entries = parseNoaaIndex(NOAA_INDEX);
  assert.equal(findNoaaField(entries, { v: 'APCP', l: 'surface', t: 'total' }).start, 300);
  assert.equal(findNoaaField(entries, { v: 'APCP', l: 'surface', t: 'acc' }).start, 300, 'a total also counts as an accumulation');
  assert.equal(findNoaaField(entries, { v: 'TCDC', l: 'entire atmosphere', t: 'ave' }).start, 500);
  assert.equal(findNoaaField(entries, { v: 'TCDC', l: 'entire atmosphere', t: 'inst' }).start, 600);
  assert.equal(findNoaaField(entries, { v: 'TCDC', l: 'entire atmosphere' }).start, 600, 'with no kind asked for, the instant value wins');
  assert.equal(findNoaaField(entries, { v: 'TMP', l: '2 m above ground' }).start, 100);
  assert.equal(findNoaaField(entries, { v: 'TMP', l: 'surface' }), null);
});

test('can pick a field by its extra description', () => {
  const entries = parseNoaaIndex(NOAA_INDEX);
  assert.equal(findNoaaField(entries, { v: 'PMTF', l: 'surface', x: 'aerosol=Total aerosol' }).start, 800);
  assert.equal(findNoaaField(entries, { v: 'PMTF', l: 'surface', x: 'aerosol=Dust dry' }).start, 700);
});

test('reads ECMWF index lines', () => {
  const text = [
    '{"param":"2t","levtype":"sfc","_offset":0,"_length":100}',
    '{"param":"t","levtype":"pl","levelist":"850","_offset":100,"_length":50}',
    '{"param":"t","levtype":"pl","levelist":"500","_offset":150,"_length":50}',
    '{"param":"vsw","levtype":"sol","levelist":"1","_offset":200,"_length":25}',
  ].join('\n');
  const entries = parseEcmwfIndex(text);
  assert.deepEqual(findEcmwfField(entries, { p: '2t' }), { start: 0, end: 99, param: '2t', levelist: null });
  assert.equal(findEcmwfField(entries, { p: 't', lev: 500 }).start, 150);
  assert.equal(findEcmwfField(entries, { p: 'vsw', lev: 1 }).end, 224);
  assert.equal(findEcmwfField(entries, { p: 't', lev: 700 }), null);
});

test('works out which file an offset field reads', () => {
  const { gfs, ecmwf } = PRODUCTS;
  assert.equal(fieldHour(gfs, 9, {}), 9);
  assert.equal(fieldHour(gfs, 9, { lead: 24 }), 33);
  assert.equal(fieldHour(ecmwf, 15, { lead: 6 }), 21);
  assert.equal(fieldHour(gfs, 9, { nextSix: 0 }), 12);
  assert.equal(fieldHour(gfs, 9, { nextSix: 3 }), 30);
  assert.equal(fieldHour(gfs, 12, { nextSix: 0 }), 18, 'starts with the next full 6-hour period');
});

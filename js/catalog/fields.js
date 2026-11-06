// Every map layer computed from forecast files. Each entry says which fields to download and the
// formula that turns them into the value shown. Add a parameter by adding one line here.
// `tools/check-fields.js` downloads every entry and checks its values are plausible.
import { RAMPS } from '../palettes.js';

const toC = (k) => k - 273.15;
const toHpa = (pa) => pa / 100;
const hypot = (u, v) => Math.hypot(u, v);
const asIs = (x) => x;
const toPercent = (x) => x * 100;
const perSecondToPerHour = (rate) => rate * 3600;
// Evaporating 1 kg of water takes 2.45 MJ, so 1 W/m² evaporates 0.03527 mm a day.
const wattsToMmPerDay = (watts) => watts * 0.03527;

// Saturation vapor pressure in kPa at a temperature in °C (FAO-56).
export const saturationVaporPressure = (c) => 0.6108 * Math.exp((17.27 * c) / (c + 237.3));

// Reference evapotranspiration for short grass (FAO-56 Penman-Monteith, hourly form), as mm/day.
export function referenceEvapotranspiration(tempK, dewK, u10, v10, pressurePa, swDown, swUp, lwDown, lwUp) {
  const t = toC(tempK);
  const es = saturationVaporPressure(t);
  const ea = saturationVaporPressure(toC(dewK));
  const delta = (4098 * es) / (t + 237.3) ** 2;
  const gamma = 0.000665 * (pressurePa / 1000);
  const u2 = Math.hypot(u10, v10) * 0.748; // 10 m wind brought down to 2 m
  const netWatts = swDown - swUp + lwDown - lwUp;
  const net = netWatts * 0.0036; // MJ/m²/hour
  const ground = net > 0 ? 0.1 * net : 0.5 * net;
  const perHour = (0.408 * delta * (net - ground) + gamma * (37 / (t + 273)) * u2 * Math.max(es - ea, 0))
    / (delta + gamma * (1 + 0.34 * u2));
  return Math.max(perHour, 0) * 24;
}

// US EPA 2024 breakpoints. PM2.5 alone, so this is an estimate of the full index.
const AQI_BREAKS = [[0, 9, 0, 50], [9, 35.4, 50, 100], [35.4, 55.4, 100, 150], [55.4, 125.4, 150, 200], [125.4, 225.4, 200, 300], [225.4, 325.4, 300, 500]];
export function aqiFromPm25(pm) {
  if (Number.isNaN(pm)) return NaN;
  const band = AQI_BREAKS.find(([, high]) => pm <= high) ?? AQI_BREAKS.at(-1);
  const [lowC, highC, lowI, highI] = band;
  return Math.min(lowI + ((Math.max(pm, 0) - lowC) * (highI - lowI)) / (highC - lowC), 500);
}

export function wetBulb(tempK, rh) {
  const t = toC(tempK);
  return t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(t + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) - 4.686035;
}

// One source per model. `default` is used whichever model is chosen.
const fromProduct = (product) => (fields, value = asIs) => ({ product, fields, value });
const gfsSource = fromProduct('gfs');
const ifsSource = fromProduct('ecmwf');
const aifsSource = fromProduct('aifs');
const noaaField = (v, l, t) => ({ v, l, ...(t ? { t } : {}) });
const ecmwfField = (p, lev) => ({ p, ...(lev === undefined ? {} : { lev }) });

export const FIELDS = [];
const add = (id, group, name, unit, ramp, about, sources, extra = {}) => {
  FIELDS.push({ id, group, name, unit, ramp: RAMPS[ramp] ?? ramp, about, sources, ...extra });
};

// Shorthand for a field that's a single NOAA GFS value, with ECMWF equivalents where they exist.
const gfs = (v, l, t, value) => gfsSource([noaaField(v, l, t)], value);
const ifs = (p, lev, value) => ifsSource([ecmwfField(p, lev)], value);
const aifs = (p, lev, value) => aifsSource([ecmwfField(p, lev)], value);
const fromAll = (gfsField, ecmwfParam, lev, value) => ({
  gfs: gfs(gfsField[0], gfsField[1], gfsField[2], value),
  ecmwf: ifs(ecmwfParam, lev, value),
  aifs: aifs(ecmwfParam, lev, value),
});

// ---- Temperature ----
const T = 'temperature';
add('t2m', T, 'Air temperature', 'temp', 'temp', 'Air temperature 2 m above the ground.', fromAll(['TMP', '2 m above ground'], '2t', undefined, toC));
add('feels', T, 'Feels like', 'temp', 'temp', 'How warm or cold it feels once wind and humidity are counted.', { gfs: gfs('APTMP', '2 m above ground', null, toC) });
add('dew', T, 'Dew point', 'temp', 'temp', 'The temperature at which dew forms. Above about 20°C feels muggy.', fromAll(['DPT', '2 m above ground'], '2d', undefined, toC));
add('wetbulb', T, 'Wet-bulb temperature', 'temp', 'temp', 'How well sweat can cool a body. Sustained values above about 31°C are dangerous.', { gfs: gfsSource([noaaField('TMP', '2 m above ground'), noaaField('RH', '2 m above ground')], wetBulb) });
add('tmax', T, 'High, last few hours', 'temp', 'temp', 'Highest air temperature in the current 6-hour forecast period.', { gfs: gfs('TMAX', '2 m above ground', 'max', toC) });
add('tmin', T, 'Low, last few hours', 'temp', 'temp', 'Lowest air temperature in the current 6-hour forecast period.', { gfs: gfs('TMIN', '2 m above ground', 'min', toC) });
add('skin', T, 'Ground and sea surface', 'temp', 'temp', 'Temperature of the surface itself, which can differ a lot from the air above.', { gfs: gfs('TMP', 'surface', null, toC), ecmwf: ifs('skt', undefined, toC), aifs: aifs('skt', undefined, toC) });
for (const [mb, height] of [[925, '800 m'], [850, '1,500 m'], [700, '3,000 m'], [500, '5,500 m'], [300, '9,000 m']]) {
  add(`t${mb}`, T, `Temperature at ${mb} hPa`, 'temp', 'tempUpper', `Air temperature about ${height} up.`, fromAll(['TMP', `${mb} mb`], 't', mb, toC));
}
add('freezing', T, 'Freezing level', 'height', 'freezing', 'The height where the air reaches 0°C. Snow usually melts below it.', { gfs: gfs('HGT', '0C isotherm') });
add('ttrop', T, 'Temperature at the tropopause', 'temp', 'tempUpper', 'Air temperature at the top of the weather layer, around 10 to 17 km up.', { gfs: gfs('TMP', 'tropopause', null, toC) });

// ---- Rain and snow ----
const R = 'rain';
add('rate', R, 'Rain and snow now', 'rate', 'rate', 'Forecast rain and snow falling at this hour, as a rate.', { gfs: gfs('PRATE', 'surface', 'inst', perSecondToPerHour), ecmwf: ifs('tprate', undefined, perSecondToPerHour) });
add('showers', R, 'Showers and storms now', 'rate', 'rate', 'The part of the rain coming from showers and thunderstorms.', { gfs: gfs('CPRAT', 'surface', 'inst', perSecondToPerHour) });
for (const [hours, label] of [[6, 'next 6 hours'], [24, 'next 24 hours'], [72, 'next 3 days'], [168, 'next 7 days']]) {
  const gfsTotal = gfsSource([{ ...noaaField('APCP', 'surface', 'total'), lead: hours }, noaaField('APCP', 'surface', 'total')], (later, now) => Math.max(later - now, 0));
  const sources = { gfs: gfsTotal };
  if (hours <= 72) sources.ecmwf = ifsSource([{ ...ecmwfField('tp'), lead: hours }, ecmwfField('tp')], (later, now) => Math.max(later - now, 0) * 1000);
  if (hours <= 72 && hours >= 24) sources.aifs = aifsSource([{ ...ecmwfField('tp'), lead: hours }, ecmwfField('tp')], (later, now) => Math.max(later - now, 0));
  add(`rain${hours}`, R, `Total rain and snow, ${label}`, 'depth', 'total', `All the rain and melted snow forecast over the ${label}.`, sources);
}
add('ptype', R, 'Rain or snow', 'category', 'ptype', 'What kind of precipitation is forecast to be falling.', {
  gfs: gfsSource(['CRAIN', 'CSNOW', 'CFRZR', 'CICEP'].map((v) => noaaField(v, 'surface', 'inst')), (rain, snow, freezing, ice) => {
    if (freezing > 0.5) return 3;
    if (ice > 0.5) return 4;
    if (snow > 0.5) return 2;
    if (rain > 0.5) return 1;
    return 0;
  }),
}, { nearest: true, categories: ['None', 'Rain', 'Snow', 'Freezing rain', 'Ice pellets'] });
add('frozen', R, 'Share falling as snow', 'percent', 'frozen', 'Of what is falling, the share that is frozen.', { gfs: gfs('CPOFP', 'surface', null, (x) => (x < 0 ? NaN : x)) });
add('radar', R, 'Forecast radar', 'dbz', 'radar', 'What radar would show if the forecast comes true. Works anywhere in the world.', { gfs: gfs('REFC', 'entire atmosphere') });
add('thunder', R, 'Thunderstorm cells', 'dbz', 'thunder', 'Only the strongest forecast radar echoes, which mostly mean thunderstorms.', { gfs: gfs('REFC', 'entire atmosphere') });
add('pwat', R, 'Water in the air column', 'depth', 'pwat', 'All the water vapor above a spot, if it were rained out at once.', { gfs: gfs('PWAT', 'entire atmosphere (considered as a single layer)'), ecmwf: ifs('tcwv'), aifs: aifs('tcw') });
add('snowdepth', R, 'Snow depth', 'depthCm', 'snow', 'Depth of snow on the ground.', { gfs: gfs('SNOD', 'surface', null, (m) => m * 100) });
add('snowwater', R, 'Water in the snow', 'depth', 'snowwater', 'How much water the snow on the ground holds.', { gfs: gfs('WEASD', 'surface') });

// ---- Wind ----
const W = 'wind';
const speedAt = (level) => gfsSource([noaaField('UGRD', level), noaaField('VGRD', level)], hypot);
const speedEcmwf = (source, u, v, lev) => source([ecmwfField(u, lev), ecmwfField(v, lev)], hypot);
add('w10', W, 'Wind speed, 10 m', 'speed', 'speed', 'Wind at the height of a weather station.', { gfs: speedAt('10 m above ground'), ecmwf: speedEcmwf(ifsSource, '10u', '10v'), aifs: speedEcmwf(aifsSource, '10u', '10v') });
add('gust', W, 'Wind gusts', 'speed', 'speed', 'The strongest short bursts of wind.', { gfs: gfs('GUST', 'surface'), ecmwf: ifs('10fg') });
for (const metres of [30, 50, 80]) add(`w${metres}`, W, `Wind speed, ${metres} m`, 'speed', 'speed', `Wind ${metres} m above the ground.`, { gfs: speedAt(`${metres} m above ground`) });
add('w100', W, 'Wind speed, 100 m', 'speed', 'speed', 'Wind at about the height of a wind turbine.', { gfs: speedAt('100 m above ground'), ecmwf: speedEcmwf(ifsSource, '100u', '100v'), aifs: speedEcmwf(aifsSource, '100u', '100v') });
for (const [mb, height] of [[925, '800 m'], [850, '1,500 m'], [700, '3,000 m'], [600, '4,200 m'], [500, '5,500 m'], [300, '9,000 m'], [250, '10,500 m'], [200, '12,000 m']]) {
  const sources = { gfs: speedAt(`${mb} mb`), ecmwf: speedEcmwf(ifsSource, 'u', 'v', mb), aifs: speedEcmwf(aifsSource, 'u', 'v', mb) };
  add(`w${mb}`, W, `Wind speed at ${mb} hPa`, 'speed', 'speedUpper', `Wind about ${height} up.${mb <= 300 ? ' The jet stream shows up here.' : ''}`, sources);
}
add('wpbl', W, 'Wind in the lowest layer', 'speed', 'speed', 'Average wind through the mixed layer of air next to the ground.', { gfs: speedAt('planetary boundary layer') });
add('wmax', W, 'Strongest wind aloft', 'speed', 'speedUpper', 'The fastest wind anywhere above this spot.', { gfs: speedAt('max wind') });
add('windpower', W, 'Wind power, 100 m', { u: 'W/m²', dp: 0 }, 'windpower', 'Energy in the wind a turbine could catch, before any losses.', { gfs: gfsSource([noaaField('UGRD', '100 m above ground'), noaaField('VGRD', '100 m above ground')], (u, v) => 0.5 * 1.225 * Math.hypot(u, v) ** 3) });
add('vvel', W, 'Rising and sinking air', { u: 'Pa/s', dp: 1 }, 'vvel', 'At 500 hPa. Negative numbers mean rising air, which builds clouds and rain.', { gfs: gfs('VVEL', '500 mb') });
add('vort', W, 'Spin in the air', { u: '×10⁻⁵/s', dp: 0 }, 'vort', 'Absolute vorticity at 500 hPa. High values mark storm systems.', { gfs: gfs('ABSV', '500 mb', null, (x) => x * 1e5) });
add('shear', W, 'Wind shear at the tropopause', { u: '/s', dp: 4 }, 'shear', 'How fast wind changes with height near the top of the weather layer.', { gfs: gfs('VWSH', 'tropopause') });
add('ventilation', W, 'Smoke clearing rate', { u: 'm²/s', dp: 0 }, 'ventilation', 'How well air carries smoke and pollution away. Low values trap it.', { gfs: gfs('VRATE', 'planetary boundary layer') });

// ---- Clouds and visibility ----
const C = 'clouds';
// ECMWF's IFS gives cloud cover as a fraction, while its AIFS gives a percentage.
add('tcc', C, 'Cloud cover', 'percent', 'cloud', 'Share of the sky covered by cloud at any height.', { gfs: gfs('TCDC', 'entire atmosphere', 'inst'), ecmwf: ifs('tcc', undefined, toPercent), aifs: aifs('tcc') });
add('lcc', C, 'Low cloud', 'percent', 'cloud', 'Cloud below about 2 km.', { gfs: gfs('LCDC', 'low cloud layer', 'inst'), ecmwf: ifs('lcc', undefined, toPercent), aifs: aifs('lcc') });
add('mcc', C, 'Middle cloud', 'percent', 'cloud', 'Cloud between about 2 and 6 km.', { gfs: gfs('MCDC', 'middle cloud layer', 'inst'), ecmwf: ifs('mcc', undefined, toPercent), aifs: aifs('mcc') });
add('hcc', C, 'High cloud', 'percent', 'cloud', 'Thin, icy cloud above about 6 km.', { gfs: gfs('HCDC', 'high cloud layer', 'inst'), ecmwf: ifs('hcc', undefined, toPercent), aifs: aifs('hcc') });
add('stormcloud', C, 'Storm cloud', 'percent', 'cloud', 'Cloud from showers and thunderstorms.', { gfs: gfs('TCDC', 'convective cloud layer') });
add('vis', C, 'Visibility', 'distance', 'visibility', 'How far you could see at ground level.', { gfs: gfs('VIS', 'surface', null, (m) => m / 1000) });
add('ceiling', C, 'Cloud ceiling', 'height', 'ceiling', 'Height of the lowest solid cloud deck. Blank means no ceiling.', { gfs: gfs('HGT', 'cloud ceiling', null, (m) => (m > 19000 ? NaN : m)) });
add('cloudwater', C, 'Water in clouds', 'depth', 'cloudwater', 'All the liquid and ice held in clouds above this spot.', { gfs: gfs('CWAT', 'entire atmosphere (considered as a single layer)') });
add('cloudtop', C, 'Cloud top temperature', 'temp', 'tempUpper', 'Average for high cloud. Colder tops mean taller clouds.', { gfs: gfs('TMP', 'high cloud top level', 'ave', toC) });

// ---- Humidity ----
const H = 'humidity';
const rhFromDew = (t, d) => Math.min(100, (100 * saturationVaporPressure(toC(d))) / saturationVaporPressure(toC(t)));
add('rh', H, 'Relative humidity', 'percent', 'humidity', 'How close the air is to saturated, 2 m above the ground.', { gfs: gfs('RH', '2 m above ground'), ecmwf: ifsSource([ecmwfField('2t'), ecmwfField('2d')], rhFromDew), aifs: aifsSource([ecmwfField('2t'), ecmwfField('2d')], rhFromDew) });
add('sh', H, 'Specific humidity', { u: 'g/kg', dp: 1 }, 'specific', 'Actual water vapor in the air, 2 m above the ground.', { gfs: gfs('SPFH', '2 m above ground', null, (x) => x * 1000) });
add('vpd', H, 'Vapor pressure deficit', { u: 'kPa', dp: 2 }, 'vpd', 'How strongly the air pulls water from plants and soil. High values stress crops.', {
  gfs: gfsSource([noaaField('TMP', '2 m above ground'), noaaField('RH', '2 m above ground')], (t, rh) => saturationVaporPressure(toC(t)) * (1 - rh / 100)),
});
for (const [mb, height] of [[850, '1,500 m'], [700, '3,000 m'], [500, '5,500 m']]) {
  const clamp = (x) => Math.min(100, Math.max(0, x)); // ECMWF's values can overshoot slightly
  add(`rh${mb}`, H, `Humidity at ${mb} hPa`, 'percent', 'humidity', `Relative humidity about ${height} up.`, { gfs: gfs('RH', `${mb} mb`), ecmwf: ifs('r', mb, clamp) });
}
add('rhcol', H, 'Humidity, whole atmosphere', 'percent', 'humidity', 'Relative humidity averaged through the full height of the air.', { gfs: gfs('RH', 'entire atmosphere (considered as a single layer)') });

// ---- Pressure ----
const P = 'pressure';
add('mslp', P, 'Sea level pressure', 'pressure', 'pressure', 'Air pressure adjusted to sea level. Lows bring storms, highs bring calm.', fromAll(['PRMSL', 'mean sea level'], 'msl', undefined, toHpa));
add('ps', P, 'Surface pressure', 'pressure', 'surfacePressure', 'Actual air pressure at the ground, which falls with height.', fromAll(['PRES', 'surface'], 'sp', undefined, toHpa));
for (const [mb, ramp] of [[850, 'height850'], [700, 'height700'], [500, 'height500'], [300, 'height300']]) {
  add(`z${mb}`, P, `Height of ${mb} hPa`, { u: 'm', dp: 0 }, ramp, 'Where this pressure sits above sea level. Forecasters read it to see steering patterns.', fromAll(['HGT', `${mb} mb`], 'gh', mb));
}
add('ztrop', P, 'Tropopause height', 'height', 'tropopause', 'The top of the layer where weather happens.', { gfs: gfs('HGT', 'tropopause') });

// ---- Storm ingredients ----
const S = 'storms';
add('cape', S, 'CAPE (storm fuel)', 'energy', 'cape', 'Energy available to rising air. More means stronger possible storms.', { gfs: gfs('CAPE', 'surface'), ecmwf: ifs('mucape') });
add('cape255', S, 'Most-unstable CAPE', 'energy', 'cape', 'The same measure, using the most unstable air in the lowest layer.', { gfs: gfs('CAPE', '255-0 mb above ground') });
add('cin', S, 'CIN (storm lid)', 'energy', 'cin', 'Energy holding storms back. Strong lids can delay storms, then release them violently.', { gfs: gfs('CIN', 'surface') });
add('li', S, 'Lifted index', { u: '°C', dp: 0 }, 'lifted', 'A quick stability check. Below zero is unstable, below -6 very unstable.', { gfs: gfs('LFTX', 'surface') });
add('li4', S, 'Best lifted index', { u: '°C', dp: 0 }, 'lifted', 'Lifted index from the most unstable of the lowest four air layers.', { gfs: gfs('4LFTX', 'surface') });
add('helicity', S, 'Storm rotation potential', { u: 'm²/s²', dp: 0 }, 'helicity', 'Storm-relative helicity, 0 to 3 km. High values favor rotating storms.', { gfs: gfs('HLCY', '3000-0 m above ground') });
add('haines', S, 'Fire weather index', { u: '', dp: 0 }, 'haines', 'Haines index. From 2 to 6, higher means large fires can grow more explosively.', { gfs: gfs('HINDEX', 'surface') });

// ---- Soil and farming ----
const F = 'farming';
const soilDepths = [['0-0.1 m below ground', '0–10 cm', '0-10'], ['0.1-0.4 m below ground', '10–40 cm', '10-40'], ['0.4-1 m below ground', '40–100 cm', '40-100'], ['1-2 m below ground', '100–200 cm', '100-200']];
for (const [level, label, id] of soilDepths) {
  add(`soil${id}`, F, `Soil moisture, ${label}`, 'percent', 'soilMoisture', `Share of the soil volume filled with water, ${label} down.`, { default: gfs('SOILW', level, null, toPercent) });
}
for (const [level, label] of [[1, '0–7 cm'], [2, '7–28 cm'], [3, '28–100 cm'], [4, '100–289 cm']]) {
  add(`soilec${level}`, F, `Soil moisture, ${label} (ECMWF)`, 'percent', 'soilMoisture', `Share of the soil volume filled with water, ${label} down.`, { default: ifs('vsw', level, (x) => (x <= 0 ? NaN : x * 100)) });
}
add('soilliquid', F, 'Unfrozen soil water, 0–10 cm', 'percent', 'soilMoisture', 'Like soil moisture, but counting only water that has not frozen.', { default: gfs('SOILL', '0-0.1 m below ground', null, toPercent) });
add('plantwater', F, 'Water available to plants', 'percent', 'plantWater', 'Topsoil water plants can use: 0% is wilting point, 100% is field capacity.', {
  default: gfsSource([noaaField('SOILW', '0-0.1 m below ground'), noaaField('WILT', 'surface'), noaaField('FLDCP', 'surface')], (soil, wilt, full) => Math.min(100, Math.max(0, ((soil - wilt) / (full - wilt)) * 100))),
});
for (const [level, label, id] of soilDepths) {
  add(`soilt${id}`, F, `Soil temperature, ${label}`, 'temp', 'soilTemp', `Temperature of the soil ${label} down. It matters for planting and germination.`, { default: gfs('TSOIL', level, null, toC) });
}
for (const [level, label] of [[1, '0–7 cm'], [2, '7–28 cm'], [3, '28–100 cm'], [4, '100–289 cm']]) {
  add(`soiltec${level}`, F, `Soil temperature, ${label} (ECMWF)`, 'temp', 'soilTemp', `Temperature of the soil ${label} down.`, { default: ifsSource([ecmwfField('sot', level), ecmwfField('lsm')], (t, land) => (land < 0.5 ? NaN : toC(t))) });
}
add('et0', F, 'Reference evapotranspiration', 'perDay', 'evap', 'How much water short grass would lose (FAO-56 ET0), at this hour\'s rate. Used to plan irrigation.', {
  default: gfsSource([
    noaaField('TMP', '2 m above ground'), noaaField('DPT', '2 m above ground'),
    noaaField('UGRD', '10 m above ground'), noaaField('VGRD', '10 m above ground'), noaaField('PRES', 'surface'),
    noaaField('DSWRF', 'surface', 'ave'), noaaField('USWRF', 'surface', 'ave'), noaaField('DLWRF', 'surface', 'ave'), noaaField('ULWRF', 'surface', 'ave'),
  ], referenceEvapotranspiration),
});
add('et', F, 'Evapotranspiration', 'perDay', 'evap', 'Water the model says is leaving the land and sea, at the recent rate. Counts soil, plants and open water.', { default: gfs('LHTFL', 'surface', 'ave', wattsToMmPerDay) });
add('pet', F, 'Potential evaporation', 'perDay', 'potentialEvap', 'Water that would evaporate if the ground stayed wet.', { default: gfs('PEVPR', 'surface', null, wattsToMmPerDay) });
add('gdd', F, 'Growing degree days', { u: '°C days', dp: 0 }, 'gdd', 'Heat for crop growth over the next 24 hours: average of high and low, minus 10°C.', {
  default: gfsSource(
    [...[0, 1, 2, 3].map((k) => ({ ...noaaField('TMAX', '2 m above ground', 'max'), nextSix: k })), ...[0, 1, 2, 3].map((k) => ({ ...noaaField('TMIN', '2 m above ground', 'min'), nextSix: k }))],
    (a, b, c, d, e, f, g, h) => Math.max(0, (Math.max(a, b, c, d) + Math.min(e, f, g, h)) / 2 - 273.15 - 10),
  ),
});
add('runoff', F, 'Water runoff', 'depth', 'runoff', 'Water running off the land in the current forecast period.', { default: gfs('WATR', 'surface', 'acc') });
add('canopy', F, 'Water on plants', 'depth', 'canopy', 'Rain and dew held on leaves.', { default: gfs('CNWAT', 'surface') });
add('veg', F, 'Vegetation cover', 'percent', 'vegetation', 'Share of the ground covered by green plants.', { default: gfs('VEG', 'surface') });

// ---- Sun and energy ----
const E = 'sun';
add('solar', E, 'Sunlight at the ground', 'flux', 'solar', 'Incoming sunlight, averaged over recent hours. Drives solar power.', { gfs: gfs('DSWRF', 'surface', 'ave') });
add('reflected', E, 'Sunlight reflected', 'flux', 'solar', 'Sunlight bounced back up by snow, sand and other bright ground.', { default: gfs('USWRF', 'surface', 'ave') });
add('lwdown', E, 'Heat from the sky', 'flux', 'longwave', 'Infrared heat coming down from clouds and air.', { default: gfs('DLWRF', 'surface', 'ave') });
add('lwup', E, 'Heat from the ground', 'flux', 'longwave', 'Infrared heat rising from the surface.', { default: gfs('ULWRF', 'surface', 'ave') });
add('olr', E, 'Heat escaping to space', 'flux', 'olr', 'Infrared heat leaving the top of the atmosphere. Low values mark tall clouds.', { default: gfs('ULWRF', 'top of atmosphere', 'ave') });
add('net', E, 'Net energy at the ground', 'flux', 'netFlux', 'All sunlight and infrared in, minus all going out.', {
  default: gfsSource([noaaField('DSWRF', 'surface', 'ave'), noaaField('USWRF', 'surface', 'ave'), noaaField('DLWRF', 'surface', 'ave'), noaaField('ULWRF', 'surface', 'ave')], (a, b, c, d) => a - b + c - d),
});
add('latent', E, 'Heat used to evaporate water', 'flux', 'netFlux', 'Latent heat flux. The energy behind evapotranspiration.', { default: gfs('LHTFL', 'surface', 'ave') });
add('sensible', E, 'Heat warming the air', 'flux', 'netFlux', 'Sensible heat flux from the ground into the air.', { default: gfs('SHTFL', 'surface', 'ave') });
add('groundheat', E, 'Heat going into the ground', 'flux', 'netFlux', 'Ground heat flux.', { default: gfs('GFLUX', 'surface', 'ave') });
add('sunshine', E, 'Sunshine this hour', { u: 'min', dp: 0 }, 'sunshine', 'Minutes of bright sunshine in the last hour.', { default: gfs('SUNSD', 'surface', null, (s) => s / 60) });
add('albedo', E, 'Ground brightness (albedo)', 'percent', 'albedo', 'Share of sunlight the ground reflects. Only shown where the sun is up.', { default: gfs('ALBDO', 'surface', 'ave') });
add('ozone', E, 'Ozone layer', { u: 'DU', dp: 0 }, 'ozone', 'Total ozone above this spot. Below 220 is an ozone hole.', { default: gfs('TOZNE', 'entire atmosphere (considered as a single layer)') });
add('pbl', E, 'Mixed layer height', 'height', 'pbl', 'How deep the air stirred up by the ground is. Pollution mixes through it.', { default: gfs('HPBL', 'surface') });

// ---- Air quality ----
const A = 'air';
const gefs = (v, l, x, value) => fromProduct('gefs')([{ ...noaaField(v, l), x }], value);
add('aqi', A, 'Air quality index', 'aqi', 'aqi', 'US AQI estimated from forecast PM2.5 alone, so it can miss ozone and other pollution.', { default: gefs('PMTF', 'surface', 'aerosol=Total aerosol', aqiFromPm25) });
add('pm25', A, 'PM2.5', 'micrograms', 'pm25', 'Fine particles from smoke, dust and pollution that reach deep into the lungs.', { default: gefs('PMTF', 'surface', 'aerosol=Total aerosol') });
add('pm10', A, 'PM10', 'micrograms', 'pm10', 'Coarser particles such as dust and pollen.', { default: gefs('PMTC', 'surface', 'aerosol=Total aerosol') });
add('dustpm', A, 'Dust near the ground', 'micrograms', 'pm25', 'The dust part of PM2.5.', { default: gefs('PMTF', 'surface', 'aerosol=Dust dry') });
add('saltpm', A, 'Sea salt near the ground', 'micrograms', 'pm25', 'The sea salt part of PM2.5.', { default: gefs('PMTF', 'surface', 'aerosol=Sea salt dry') });
add('aod', A, 'Haze (aerosol optical depth)', { u: '', dp: 2 }, 'aod', 'How much smoke, dust and pollution dim the sun.', { default: gefs('AOTK', 'entire atmosphere', 'aerosol=Total aerosol') });
for (const [id, kind, name] of [['dustcol', 'Dust dry', 'Dust in the air column'], ['carbon', 'Black carbon dry', 'Soot in the air column'], ['organic', 'Particulate organic matter', 'Smoke particles in the air column'], ['sulfate', 'Sulphate dry', 'Sulfate in the air column']]) {
  add(id, A, name, { u: 'mg/m²', dp: 1 }, 'column', `Total ${kind.replace(' dry', '').toLowerCase()} from the ground to the top of the air.`, { default: gefs('COLMD', 'entire atmosphere', `aerosol=${kind}`, (x) => x * 1e6) });
}

// ---- Ocean ----
const O = 'ocean';
const wave = (v, l, value) => fromProduct('wave')([noaaField(v, l)], value);
const cfs = (v, l, value) => fromProduct('cfs')([noaaField(v, l)], value);
add('waveheight', O, 'Wave height', 'heightSmall', 'waves', 'Average height of the largest third of waves, including swell.', { default: wave('HTSGW', 'surface') });
add('waveperiod', O, 'Wave period', { u: 's', dp: 0 }, 'wavePeriod', 'Seconds between wave crests. Longer periods carry more energy.', { default: wave('PERPW', 'surface') });
add('wavedir', O, 'Wave direction', 'direction', 'direction', 'The direction the main waves are coming from.', { default: wave('DIRPW', 'surface') });
add('windwave', O, 'Wind wave height', 'heightSmall', 'waves', 'Waves raised by local wind.', { default: wave('WVHGT', 'surface') });
add('windwaveperiod', O, 'Wind wave period', { u: 's', dp: 0 }, 'wavePeriod', 'Seconds between wind-raised wave crests.', { default: wave('WVPER', 'surface') });
add('swell', O, 'Swell height', 'heightSmall', 'waves', 'Long waves from distant storms.', { default: wave('SWELL', '1 in sequence') });
add('swellperiod', O, 'Swell period', { u: 's', dp: 0 }, 'wavePeriod', 'Seconds between swell crests.', { default: wave('SWPER', '1 in sequence') });
add('swelldir', O, 'Swell direction', 'direction', 'direction', 'The direction the main swell is coming from.', { default: wave('SWDIR', '1 in sequence') });
// Sea water freezes near -2°C, so anything colder is the top of the sea ice rather than water.
add('sst', O, 'Sea surface temperature', 'temp', 'sst', 'Water temperature at the surface. Land and sea ice are left blank.', { default: gfsSource([noaaField('TMP', 'surface'), noaaField('LAND', 'surface')], (t, land) => (land > 0.5 || toC(t) < -2 ? NaN : toC(t))) });
add('seatemp', O, 'Sea temperature, 5 m down', 'temp', 'sst', 'Water temperature just under the surface, from NOAA\'s ocean model.', { default: cfs('POT', '5 m below sea level', toC) });
add('salinity', O, 'Salinity', { u: 'psu', dp: 1 }, 'salinity', 'How salty the water is, 5 m down.', { default: cfs('SALTY', '5 m below sea level', (x) => (x < 1 ? x * 1000 : x)) });
add('currentspeed', O, 'Ocean current speed', { u: 'm/s', dp: 2 }, 'current', 'How fast the water moves, 5 m down. Turn on Ocean currents to see the flow.', { default: fromProduct('cfs')([noaaField('UOGRD', '5 m below sea level'), noaaField('VOGRD', '5 m below sea level')], hypot) });
add('seaheight', O, 'Sea surface height', { u: 'cm', dp: 0 }, 'seaHeight', 'How far the sea sits above or below normal. Warm eddies show up as highs.', { default: cfs('SSHG', 'surface', (m) => m * 100) });
// NOAA stores this relative to absolute zero. 335 is about what 300 m of water at 0°C holds.
add('oceanheat', O, 'Ocean heat, top 300 m', { u: '×10⁹ J/m²', dp: 0 }, 'oceanHeat', 'Heat stored in the top 300 m, above that of water at 0°C. Hurricanes feed on it.', { default: cfs('OHC', '0-300 m ocean layer', (x) => x / 1e9 - 335) });
add('mixedlayer', O, 'Mixed layer depth', 'height', 'mixedLayer', 'How deep wind and waves stir the surface water.', { default: cfs('DBSS', 'bottom of ocean mixed layer') });
add('seaice', O, 'Sea ice cover', 'percent', 'seaIce', 'Share of the sea covered by ice.', { default: gfs('ICEC', 'surface', null, (x) => (x <= 0 ? NaN : x * 100)) });
add('icethick', O, 'Sea ice thickness', 'heightSmall', 'iceThick', 'Average thickness of the ice.', { default: gfs('ICETK', 'surface', null, (x) => (x <= 0 ? NaN : x)) });

// Vector fields drawn as moving lines rather than color. These aren't listed with the others.
const flows = [];
const flow = (id, name, sources) => flows.push({ id, name, vector: true, sources });
flow('flow10', '10 m', { gfs: gfsSource([noaaField('UGRD', '10 m above ground'), noaaField('VGRD', '10 m above ground')]), ecmwf: ifsSource([ecmwfField('10u'), ecmwfField('10v')]), aifs: aifsSource([ecmwfField('10u'), ecmwfField('10v')]) });
flow('flow100', '100 m', { gfs: gfsSource([noaaField('UGRD', '100 m above ground'), noaaField('VGRD', '100 m above ground')]), ecmwf: ifsSource([ecmwfField('100u'), ecmwfField('100v')]), aifs: aifsSource([ecmwfField('100u'), ecmwfField('100v')]) });
for (const mb of [925, 850, 700, 600, 500, 300]) {
  flow(`flow${mb}`, `${mb} hPa`, { gfs: gfsSource([noaaField('UGRD', `${mb} mb`), noaaField('VGRD', `${mb} mb`)]), ecmwf: ifsSource([ecmwfField('u', mb), ecmwfField('v', mb)]), aifs: aifsSource([ecmwfField('u', mb), ecmwfField('v', mb)]) });
}
flow('currents', 'Ocean currents', { default: fromProduct('cfs')([noaaField('UOGRD', '5 m below sea level'), noaaField('VOGRD', '5 m below sea level')]) });
export const FLOW_LEVELS = flows.filter((entry) => entry.id !== 'currents').map(({ id, name }) => ({ id, name }));

// Pressure for the isobar lines. Not listed separately: it's the same data as sea level pressure.
const byId = new Map([...FIELDS, ...flows].map((entry) => [entry.id, entry]));
export const fieldById = (id) => {
  const entry = byId.get(id);
  if (!entry) throw new Error(`Unknown field ${id}`);
  return entry;
};

// The model's own source when it has one, otherwise the shared or GFS source.
export const sourceFor = (entry, model) => entry.sources[model] ?? entry.sources.default ?? entry.sources.gfs;
export const usesFallback = (entry, model) => !entry.sources[model] && !entry.sources.default && model !== 'gfs';

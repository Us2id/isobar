// Everything is stored in Celsius and metres per second, and converted only for display.
export const SYSTEMS = {
  imperial: { tempUnit: 'F', speedUnit: 'mph', perMs: 2.23694 },
  metric: { tempUnit: 'C', speedUnit: 'km/h', perMs: 3.6 },
};

export const defaultSystem = (language = '') => (/^en-US/i.test(language) ? 'imperial' : 'metric');

export const tempIn = (celsius, system) => (system === 'imperial' ? (celsius * 9) / 5 + 32 : celsius);
export const shortTemp = (celsius, system) => `${Math.round(tempIn(celsius, system))}°`;
export const fullTemp = (celsius, system) => `${shortTemp(celsius, system)}${SYSTEMS[system].tempUnit}`;

export const speedIn = (ms, system) => ms * SYSTEMS[system].perMs;
export const fullSpeed = (ms, system) => `${Math.round(speedIn(ms, system))} ${SYSTEMS[system].speedUnit}`;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const degreesToCompass = (degrees) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];

export function compassToDegrees(name) {
  const index = COMPASS.indexOf(name);
  return index < 0 ? null : index * 22.5;
}

export function describeWind(ms, fromDegrees, system) {
  if (ms == null) return 'Wind not available';
  if (Math.round(speedIn(ms, system)) === 0) return 'Calm';
  const direction = fromDegrees == null ? '' : ` from ${degreesToCompass(fromDegrees)}`;
  return `Wind${direction} at ${fullSpeed(ms, system)}`;
}

// How each kind of value is shown, as [unit, decimals, convert from the stored unit].
const same = (x) => x;
const toInches = (mm) => mm / 25.4;
const KINDS = {
  temp: { metric: ['°C', 0, same], imperial: ['°F', 0, (c) => (c * 9) / 5 + 32] },
  speed: { metric: ['km/h', 0, (ms) => ms * 3.6], imperial: ['mph', 0, (ms) => ms * 2.23694] },
  rate: { metric: ['mm/h', 1, same], imperial: ['in/h', 2, toInches] },
  depth: { metric: ['mm', 1, same], imperial: ['in', 2, toInches] },
  depthCm: { metric: ['cm', 0, same], imperial: ['in', 1, (cm) => cm / 2.54] },
  perDay: { metric: ['mm/day', 1, same], imperial: ['in/day', 2, toInches] },
  pressure: { metric: ['hPa', 0, same], imperial: ['inHg', 2, (hpa) => hpa * 0.02953] },
  height: { metric: ['m', 0, same], imperial: ['ft', 0, (m) => m * 3.28084] },
  heightSmall: { metric: ['m', 1, same], imperial: ['ft', 1, (m) => m * 3.28084] },
  distance: { metric: ['km', 1, same], imperial: ['mi', 1, (km) => km * 0.621371] },
  percent: ['%', 0],
  flux: ['W/m²', 0],
  energy: ['J/kg', 0],
  dbz: ['dBZ', 0],
  micrograms: ['µg/m³', 0],
  aqi: ['', 0],
};

function resolve(unit, system) {
  if (typeof unit === 'object') return [unit.u, unit.dp, same];
  const kind = KINDS[unit];
  if (!kind) throw new Error(`Unknown unit ${unit}`);
  return Array.isArray(kind) ? [kind[0], kind[1], same] : kind[system];
}

export const unitLabel = (unit, system) => {
  if (unit === 'direction' || unit === 'category') return '';
  return resolve(unit, system)[0];
};

// A bare number in the display unit, for legend ticks.
export function formatNumber(value, unit, system) {
  if (unit === 'direction') return `${Math.round(value)}°`;
  if (unit === 'category') return '';
  const [, decimals, convert] = resolve(unit, system);
  const shown = convert(value);
  // A value just under zero would otherwise round to "-0".
  return shown.toFixed(Math.abs(shown) >= 100 ? 0 : decimals).replace(/\.0+$/, '').replace(/^-0$/, '0');
}

// A value with its unit, for readouts.
export function formatValue(value, unit, system, categories) {
  if (unit === 'direction') return `from ${degreesToCompass(value)} (${Math.round(value)}°)`;
  if (unit === 'category') return categories?.[Math.round(value)] ?? '';
  const [label] = resolve(unit, system);
  const number = formatNumber(value, unit, system);
  if (!label) return number;
  return /^[°%]/.test(label) ? `${number}${label}` : `${number} ${label}`;
}

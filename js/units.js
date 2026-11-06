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

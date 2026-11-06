const MINUTE = 60_000;

export function formatAge(ms) {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return 'Under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export const formatClock = (time, { timeZone, locale } = {}) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(time);

export const formatHour = (time, { timeZone, locale } = {}) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone }).format(time);

export const formatWeekday = (time, { timeZone, locale, style = 'long' } = {}) =>
  new Intl.DateTimeFormat(locale, { weekday: style, timeZone }).format(time);

// Just the hour when it's today, with the weekday otherwise.
export function formatForecastTime(time, now, { timeZone, locale } = {}) {
  const day = (t) => new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(t);
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(time);
  if (day(time) === day(now)) return clock;
  return `${new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(time)} ${clock}`;
}

export function hourInZone(time, timeZone) {
  const text = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(time);
  return Number(text);
}

export function formatCoordinates(lat, lng) {
  const part = (value, positive, negative) => `${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;
  return `${part(lat, 'N', 'S')}, ${part(lng, 'E', 'W')}`;
}

import { formatAge, formatClock, formatForecastTime } from './format.js';

// Turns a layer's status into the words shown beside it.
// `tone` is 'normal', 'warn' (working but out of date) or 'error' (not working).
export function describeStatus(status, now = Date.now(), options = {}) {
  switch (status?.state) {
    case 'loading':
      return { text: 'Loading', tone: 'normal' };
    case 'outside':
      return { text: status.message, tone: 'normal' };
    case 'error': {
      const shown = status.dataTime ? ` Showing ${formatClock(status.dataTime, options)}.` : '';
      return { text: `${status.message}${shown}`, tone: 'error' };
    }
    case 'ok':
      if (status.validTime) {
        const when = formatForecastTime(status.validTime, now, options);
        return { text: status.note ? `Forecast for ${when}. ${status.note}.` : `Forecast for ${when}`, tone: 'normal' };
      }
      if (status.note && !status.checkedAt) return { text: status.note, tone: 'normal' };
      if (status.dataTime) {
        const age = now - status.dataTime;
        if (status.staleAfterMs && age > status.staleAfterMs) {
          return { text: `${formatAge(age)} old. NOAA may be delayed.`, tone: 'warn' };
        }
        return { text: `${formatAge(age)} old`, tone: 'normal' };
      }
      if (status.checkedAt) {
        const note = status.note ? `${status.note}. ` : '';
        return { text: `${note}Checked ${formatAge(now - status.checkedAt).toLowerCase()} ago`, tone: 'normal' };
      }
      return { text: 'On', tone: 'normal' };
    default:
      return { text: '', tone: 'normal' };
  }
}

// Combines the status of each coverage area currently on screen into one.
//   'oldest' shows the oldest data, so the age is never better than the worst area on screen.
//   'first'  shows the first area listed that has data.
export function mergeStatuses(statuses, mode, outsideMessage) {
  if (statuses.length === 0) return { state: 'outside', message: outsideMessage };
  // One area failing while another works is still a problem the visitor should see.
  const failure = statuses.find((status) => status.state === 'error');
  if (failure) return failure;
  const working = statuses.filter((status) => status.state === 'ok');
  if (working.length === 0) return { state: 'loading' };
  if (mode === 'first') return working[0];
  return working.reduce((oldest, status) => ((status.dataTime ?? Infinity) < (oldest.dataTime ?? Infinity) ? status : oldest));
}

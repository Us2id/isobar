// Which picture to ask NASA for, given the times it reports for a layer.
const DAY_MS = 86_400_000;
const SETTLED_WITHIN_MS = 8 * DAY_MS;

const parse = (text) => {
  const stamp = new Date(text ?? NaN).getTime();
  // Layers with no real date report a placeholder year.
  return Number.isNaN(stamp) || new Date(stamp).getUTCFullYear() <= 2000 ? null : stamp;
};

// Layers stamped at midnight come out once a day or less often. The rest update through the day.
export const isDailyStamp = (text) => {
  const stamp = parse(text);
  return stamp !== null && stamp % DAY_MS === 0;
};

// The date to ask for when looking for the image before the newest. NASA answers with the start
// of the period holding that date, which shows how often the layer comes out.
export const dayBefore = (text) => new Date(parse(text) - DAY_MS).toISOString().slice(0, 10);

// A layer's newest image is still being built: it can have wide holes, and its tiles have come back
// as garbage or changed between requests. So layers that come out often show the image before it.
// Monthly layers keep their newest, which would otherwise be a month behind and has long settled.
// Layers that update through the day are pinned to their exact time, so a newer image reloads.
export function chooseGibsTime(newest, previous, now = Date.now()) {
  const stamp = parse(newest);
  if (stamp === null) return { time: 'default', date: null, daily: false };
  if (stamp % DAY_MS !== 0) return { time: new Date(stamp).toISOString().replace('.000Z', 'Z'), date: new Date(stamp), daily: false };
  const before = parse(previous);
  const settled = before !== null && stamp - before <= SETTLED_WITHIN_MS ? before : stamp;
  const lastFinishedDay = now - (now % DAY_MS) - DAY_MS;
  const day = Math.min(settled, lastFinishedDay);
  return { time: new Date(day).toISOString().slice(0, 10), date: new Date(day), daily: true };
}

export function describeGibsTime({ date, daily }) {
  if (!date) return null;
  const options = daily
    ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return `Image from ${new Intl.DateTimeFormat(undefined, options).format(date)}`;
}

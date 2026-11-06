// Draws the forecast the way a recording instrument would: one continuous temperature trace on
// chart paper, with rain chances below it and wind arrows along the bottom.
import { svg } from './dom.js';
import { formatHour, formatWeekday, hourInZone } from './format.js';
import { SYSTEMS, speedIn, tempIn, shortTemp } from './units.js';

const AXIS_WIDTH = 40;
const DAY_ROW = 20;
const PLOT_HEIGHT = 130;
const WIND_ROW = 42;
const HOUR_ROW = 18;
const MIN_PX_PER_HOUR = 14;
const ARROW = 'M0-8 L5 1 L1.200 0 L1.200 8 L-1.200 8 L-1.200 0 L-5 1 Z';

export function temperatureTicks(values) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1);
  const step = [1, 2, 5, 10, 20].find((candidate) => span / candidate <= 4) ?? 50;
  const first = Math.floor(low / step) * step;
  const last = Math.ceil(high / step) * step;
  const ticks = [];
  for (let tick = first; tick <= last; tick += step) ticks.push(tick);
  if (ticks.length < 2) ticks.push(first + step);
  return ticks;
}

// Works out where everything goes, without touching the page.
export function meteogramModel(hours, { system, timeZone, locale, pxPerHour }) {
  const plotTop = DAY_ROW;
  const plotBottom = DAY_ROW + PLOT_HEIGHT;
  const width = AXIS_WIDTH + hours.length * pxPerHour;
  const height = plotBottom + WIND_ROW + HOUR_ROW;
  const centerX = (i) => AXIS_WIDTH + (i + 0.5) * pxPerHour;

  const temps = hours.map((hour) => tempIn(hour.tempC, system));
  const ticks = temperatureTicks(temps);
  const low = ticks[0];
  const high = ticks.at(-1);
  // A little room inside the plot, so the trace and its labels don't touch the edges.
  const y = (temp) => plotBottom - 14 - ((temp - low) / (high - low)) * (PLOT_HEIGHT - 28);

  const trace = temps.map((temp, i) => `${i ? 'L' : 'M'}${centerX(i).toFixed(1)} ${y(temp).toFixed(1)}`).join(' ');

  const rainBars = hours.flatMap((hour, i) => {
    if (hour.rainPercent <= 0) return [];
    const barHeight = (hour.rainPercent / 100) * (PLOT_HEIGHT * 0.5);
    return [{ x: AXIS_WIDTH + i * pxPerHour + 1, y: plotBottom - barHeight, width: Math.max(pxPerHour - 2, 1), height: barHeight }];
  });

  const nights = [];
  hours.forEach((hour, i) => {
    if (hour.isDay) return;
    const previous = nights.at(-1);
    if (previous && previous.end === i) {
      previous.end = i + 1;
    } else {
      nights.push({ start: i, end: i + 1 });
    }
  });

  const localHours = hours.map((hour) => hourInZone(hour.start, timeZone));
  const midnights = localHours.flatMap((hour, i) => (hour === 0 && i > 0 ? [i] : []));
  const days = midnights.map((i) => ({
    x: AXIS_WIDTH + i * pxPerHour,
    label: formatWeekday(hours[i].start, { timeZone, locale, style: 'short' }),
  }));
  // Name the first stretch too, unless the first midnight is too close to leave room for it.
  if (midnights.length === 0 || midnights[0] * pxPerHour > 56) {
    days.unshift({ x: AXIS_WIDTH, label: 'Today' });
  }

  const labelEvery = pxPerHour >= 18 ? 3 : 6;
  const labelled = localHours.flatMap((hour, i) => (hour % labelEvery === 0 ? [i] : []));
  const hourLabels = labelled.map((i) => ({ x: centerX(i), text: formatHour(hours[i].start, { timeZone, locale }) }));

  const winds = localHours.flatMap((hour, i) => {
    const { windMs, windFromDegrees } = hours[i];
    if (hour % 3 !== 0 || windMs == null) return [];
    return [{
      x: centerX(i),
      // Arrows point the way the air is going, which is opposite to where wind is "from".
      rotation: windFromDegrees == null ? null : (windFromDegrees + 180) % 360,
      speed: Math.round(speedIn(windMs, system)),
    }];
  });

  const hottest = temps.indexOf(Math.max(...temps));
  const coldest = temps.indexOf(Math.min(...temps));
  const extremes = hottest === coldest ? [] : [
    { x: centerX(hottest), y: y(temps[hottest]) - 8, text: shortTemp(hours[hottest].tempC, system) },
    { x: centerX(coldest), y: y(temps[coldest]) + 16, text: shortTemp(hours[coldest].tempC, system) },
  ];

  return {
    width,
    height,
    plotTop,
    plotBottom,
    axisWidth: AXIS_WIDTH,
    pxPerHour,
    ticks: ticks.map((value) => ({ value, y: y(value) })),
    trace,
    rainBars,
    nights: nights.map(({ start, end }) => ({ x: AXIS_WIDTH + start * pxPerHour, width: (end - start) * pxPerHour })),
    days,
    midnights: midnights.map((i) => AXIS_WIDTH + i * pxPerHour),
    hourLabels,
    winds,
    extremes,
    tempUnit: `°${SYSTEMS[system].tempUnit}`,
    speedUnit: SYSTEMS[system].speedUnit,
  };
}

export function meteogramSummary(hours, system) {
  const temps = hours.map((hour) => hour.tempC);
  const rain = Math.max(...hours.map((hour) => hour.rainPercent));
  return `Next ${hours.length} hours: temperature from ${shortTemp(Math.min(...temps), system)} to ${shortTemp(Math.max(...temps), system)}, with up to a ${rain} percent chance of rain or snow.`;
}

const line = (x1, y1, x2, y2, className) => svg('line', { x1, y1, x2, y2, class: className });
const text = (x, y, content, className) => svg('text', { x, y, class: className, text: content });

// Replaces the contents of `container` with the chart, and reports the hour under the pointer.
export function drawMeteogram(container, hours, { system, timeZone, onHover }) {
  const available = container.clientWidth - AXIS_WIDTH;
  const pxPerHour = Math.max(MIN_PX_PER_HOUR, available / hours.length);
  const model = meteogramModel(hours, { system, timeZone, pxPerHour });
  const { width, height, plotTop, plotBottom, axisWidth } = model;

  const cursor = line(0, plotTop, 0, plotBottom + WIND_ROW, 'm-cursor');
  cursor.setAttribute('visibility', 'hidden');

  const chart = svg('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': meteogramSummary(hours, system),
  },
    ...model.nights.map((night) => svg('rect', { x: night.x, y: plotTop, width: night.width, height: plotBottom - plotTop, class: 'm-night' })),
    ...model.ticks.flatMap((tick) => [
      line(axisWidth, tick.y, width, tick.y, 'm-grid'),
      text(axisWidth - 6, tick.y + 4, String(tick.value), 'm-tick'),
    ]),
    text(axisWidth - 6, 13, model.tempUnit, 'm-tick'),
    ...model.hourLabels.map((label) => line(label.x, plotTop, label.x, plotBottom, 'm-grid')),
    ...model.midnights.map((x) => line(x, 0, x, height - HOUR_ROW, 'm-midnight')),
    ...model.rainBars.map((bar) => svg('rect', { x: bar.x, y: bar.y, width: bar.width, height: bar.height, class: 'm-rain' })),
    svg('path', { d: model.trace, class: 'm-trace' }),
    ...model.extremes.map((extreme) => text(extreme.x, extreme.y, extreme.text, 'm-extreme')),
    ...model.days.map((day) => text(day.x + 5, 13, day.label, 'm-day')),
    ...model.winds.flatMap((wind) => [
      wind.rotation === null ? null : svg('path', { d: ARROW, class: 'm-arrow', transform: `translate(${wind.x} ${plotBottom + 13}) rotate(${wind.rotation})` }),
      text(wind.x, plotBottom + 36, String(wind.speed), 'm-speed'),
    ]),
    text(axisWidth - 6, plotBottom + 36, model.speedUnit, 'm-tick'),
    ...model.hourLabels.map((label) => text(label.x, height - 4, label.text, 'm-hour')),
    cursor,
  );

  const pointAt = (event) => {
    const box = chart.getBoundingClientRect();
    const i = Math.floor((event.clientX - box.left - axisWidth) / pxPerHour);
    if (i < 0 || i >= hours.length) return null;
    return i;
  };
  const show = (event) => {
    const i = pointAt(event);
    if (i === null) {
      cursor.setAttribute('visibility', 'hidden');
      onHover?.(null);
      return;
    }
    const x = axisWidth + (i + 0.5) * pxPerHour;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
    cursor.setAttribute('visibility', 'visible');
    onHover?.(hours[i]);
  };
  chart.addEventListener('pointermove', show);
  chart.addEventListener('pointerdown', show);
  chart.addEventListener('pointerleave', () => {
    cursor.setAttribute('visibility', 'hidden');
    onHover?.(null);
  });

  container.replaceChildren(chart);
}

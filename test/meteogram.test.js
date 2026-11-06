import assert from 'node:assert/strict';
import { test } from 'node:test';
import { meteogramModel, meteogramSummary, temperatureTicks } from '../js/meteogram.js';

const START = Date.UTC(2026, 11, 6, 18); // 18:00 UTC, which is noon in Chicago in December
const hour = (i, overrides = {}) => ({
  start: START + i * 3_600_000,
  end: START + (i + 1) * 3_600_000,
  tempC: 10,
  rainPercent: 0,
  windMs: 5,
  windFromDegrees: 270,
  summary: 'Clear',
  isDay: true,
  ...overrides,
});
const OPTIONS = { system: 'metric', timeZone: 'America/Chicago', locale: 'en-US', pxPerHour: 20 };
const hours = (count, make = () => ({})) => Array.from({ length: count }, (_, i) => hour(i, make(i)));

test('picks round temperature ticks that enclose the data', () => {
  assert.deepEqual(temperatureTicks([41, 58]), [40, 45, 50, 55, 60]);
  assert.deepEqual(temperatureTicks([1.5, 2.5]), [1, 2, 3]);
  assert.deepEqual(temperatureTicks([-3, 4]), [-4, -2, 0, 2, 4]);
  assert.deepEqual(temperatureTicks([20, 20]), [20, 21]);
  assert.deepEqual(temperatureTicks([-60, 60]), [-100, -50, 0, 50, 100]);
});

test('sizes the chart from the hours shown', () => {
  const model = meteogramModel(hours(48), OPTIONS);
  assert.equal(model.width, 40 + 48 * 20);
  assert.ok(model.height > model.plotBottom);
});

test('draws hotter temperatures higher up', () => {
  const model = meteogramModel(hours(3, (i) => ({ tempC: [0, 10, 20][i] })), OPTIONS);
  const ys = [...model.trace.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]));
  assert.equal(ys.length, 3);
  assert.ok(ys[0] > ys[1] && ys[1] > ys[2]);
  ys.forEach((y) => assert.ok(y >= model.plotTop && y <= model.plotBottom));
});

test('uses the chosen units for the temperature scale', () => {
  const data = hours(2, (i) => ({ tempC: [0, 10][i] }));
  const metric = meteogramModel(data, OPTIONS);
  const imperial = meteogramModel(data, { ...OPTIONS, system: 'imperial' });
  assert.equal(metric.tempUnit, '°C');
  assert.equal(imperial.tempUnit, '°F');
  assert.equal(metric.speedUnit, 'km/h');
  assert.equal(imperial.speedUnit, 'mph');
  assert.ok(metric.ticks.some((tick) => tick.value === 0));
  assert.ok(imperial.ticks.some((tick) => tick.value === 30));
});

test('draws rain bars only where there is a chance, in proportion', () => {
  const model = meteogramModel(hours(4, (i) => ({ rainPercent: [0, 50, 100, 0][i] })), OPTIONS);
  assert.equal(model.rainBars.length, 2);
  assert.equal(model.rainBars[1].height, model.rainBars[0].height * 2);
  model.rainBars.forEach((bar) => assert.equal(bar.y + bar.height, model.plotBottom));
});

test('joins consecutive night hours into one band', () => {
  const model = meteogramModel(hours(6, (i) => ({ isDay: i < 1 || i > 3 })), OPTIONS);
  assert.deepEqual(model.nights, [{ x: 40 + 20, width: 60 }]);
});

test('marks midnights in the location\'s own time zone, and names the first stretch', () => {
  const model = meteogramModel(hours(24), OPTIONS);
  assert.deepEqual(model.midnights, [40 + 12 * 20]);
  assert.deepEqual(model.days.map((day) => day.label), ['Today', 'Mon']);
});

test('leaves out "Today" when the first midnight is too close for it', () => {
  const model = meteogramModel(hours(30), { ...OPTIONS, timeZone: 'Asia/Kolkata' });
  // 18:00 UTC is 23:30 in Kolkata, so midnight is the next column.
  assert.deepEqual(model.days.map((day) => day.label), ['Mon', 'Tue']);
});

test('labels hours less often when the chart is tight', () => {
  const wide = meteogramModel(hours(24), OPTIONS);
  const tight = meteogramModel(hours(24), { ...OPTIONS, pxPerHour: 14 });
  assert.equal(wide.hourLabels.length, 8);
  assert.equal(tight.hourLabels.length, 4);
  assert.equal(wide.hourLabels[0].text.replace(/\s/g, ' '), '12 PM');
});

test('points arrows the way the air is moving', () => {
  const model = meteogramModel(hours(4, () => ({ windFromDegrees: 270, windMs: 10 })), OPTIONS);
  assert.equal(model.winds[0].rotation, 90, 'wind from the west blows toward the east');
  assert.equal(model.winds[0].speed, 36);
});

test('keeps the speed but draws no arrow for variable wind, and skips unknown wind', () => {
  const model = meteogramModel(hours(4, (i) => (i === 0 ? { windFromDegrees: null } : { windMs: null })), OPTIONS);
  assert.equal(model.winds.length, 1);
  assert.equal(model.winds[0].rotation, null);
  assert.equal(model.winds[0].speed, 18);
});

test('labels the warmest and coolest hours', () => {
  const model = meteogramModel(hours(3, (i) => ({ tempC: [5, 12, -2][i] })), OPTIONS);
  assert.deepEqual(model.extremes.map((extreme) => extreme.text), ['12°', '-2°']);
});

test('adds no extreme labels to a flat line', () => {
  assert.deepEqual(meteogramModel(hours(3), OPTIONS).extremes, []);
});

test('summarizes the chart for screen readers', () => {
  const data = hours(3, (i) => ({ tempC: [5, 12, -2][i], rainPercent: [0, 30, 10][i] }));
  assert.equal(meteogramSummary(data, 'metric'), 'Next 3 hours: temperature from -2° to 12°, with up to a 30 percent chance of rain or snow.');
});

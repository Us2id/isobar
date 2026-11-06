import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAge, formatCoordinates, hourInZone } from '../js/format.js';
import { describeStatus, mergeStatuses } from '../js/status.js';
import { stormNote } from '../js/alerts-layer.js';

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 6, 13, 0);
const options = { timeZone: 'UTC', locale: 'en-US' };

test('formats ages in plain words', () => {
  assert.equal(formatAge(20_000), 'Under 1 min');
  assert.equal(formatAge(-5000), 'Under 1 min', 'a clock slightly ahead of NOAA should not show a negative age');
  assert.equal(formatAge(2 * MINUTE), '2 min');
  assert.equal(formatAge(60 * MINUTE), '1 hr');
  assert.equal(formatAge(64 * MINUTE), '1 hr 4 min');
});

test('describes fresh data by its age', () => {
  assert.deepEqual(describeStatus({ state: 'ok', dataTime: NOW - 2 * MINUTE, staleAfterMs: 20 * MINUTE }, NOW), { text: '2 min old', tone: 'normal' });
});

test('warns when data is older than it should be', () => {
  assert.deepEqual(describeStatus({ state: 'ok', dataTime: NOW - 41 * MINUTE, staleAfterMs: 20 * MINUTE }, NOW), { text: '41 min old. NOAA may be delayed.', tone: 'warn' });
});

test('describes forecast layers by the hour they show', () => {
  assert.equal(describeStatus({ state: 'ok', validTime: NOW }, NOW, options).text.replace(/\s/g, ' '), 'Forecast for 1:00 PM');
});

test('describes layers with no data time by when they were checked', () => {
  const status = { state: 'ok', checkedAt: NOW - 3 * MINUTE, note: '2 storm warnings' };
  assert.equal(describeStatus(status, NOW).text, '2 storm warnings. Checked 3 min ago');
  assert.equal(describeStatus({ state: 'ok', checkedAt: NOW - 1000 }, NOW).text, 'Checked under 1 min ago');
});

test('says what failed and what is still on screen', () => {
  const status = { state: 'error', message: "Can't reach NOAA. Retrying.", dataTime: NOW };
  const { text, tone } = describeStatus(status, NOW, options);
  assert.equal(tone, 'error');
  assert.equal(text.replace(/\s/g, ' '), "Can't reach NOAA. Retrying. Showing 1:00 PM.");
  assert.equal(describeStatus({ state: 'error', message: 'Nope.' }, NOW).text, 'Nope.');
});

test('passes through outside-coverage messages and handles no status', () => {
  assert.equal(describeStatus({ state: 'outside', message: 'US only.' }).text, 'US only.');
  assert.equal(describeStatus(undefined).text, '');
  assert.equal(describeStatus({ state: 'loading' }).text, 'Loading');
});

const ok = (dataTime) => ({ state: 'ok', dataTime });

test('reports coverage areas on screen, or says there are none', () => {
  assert.deepEqual(mergeStatuses([], 'oldest', 'US only.'), { state: 'outside', message: 'US only.' });
});

test('shows the oldest area, so age is never flattered', () => {
  assert.equal(mergeStatuses([ok(300), ok(100), ok(200)], 'oldest').dataTime, 100);
});

test('can prefer the first listed area', () => {
  assert.equal(mergeStatuses([ok(300), ok(100)], 'first').dataTime, 300);
});

test('stays loading until something is ready', () => {
  assert.deepEqual(mergeStatuses([{ state: 'loading' }, { state: 'loading' }], 'oldest'), { state: 'loading' });
});

test('shows a failure even when another area works', () => {
  const failed = { state: 'error', message: 'Nope.' };
  assert.equal(mergeStatuses([ok(100), failed], 'oldest'), failed);
  assert.equal(mergeStatuses([failed, failed], 'oldest'), failed);
  assert.equal(mergeStatuses([failed, { state: 'loading' }], 'oldest'), failed);
});

test('counts storm warnings in words', () => {
  assert.equal(stormNote(0), 'No storm warnings');
  assert.equal(stormNote(1), '1 storm warning');
  assert.equal(stormNote(3), '3 storm warnings');
});

test('formats coordinates with hemispheres', () => {
  assert.equal(formatCoordinates(19.07, 72.87), '19.07°N, 72.87°E');
  assert.equal(formatCoordinates(-33.5, -70.61), '33.50°S, 70.61°W');
});

test('reads the local hour in any time zone, with midnight as 0', () => {
  assert.equal(hourInZone(Date.UTC(2026, 10, 6, 6), 'America/Chicago'), 0);
  assert.equal(hourInZone(Date.UTC(2026, 10, 6, 18, 30), 'Asia/Kolkata'), 0);
  assert.equal(hourInZone(Date.UTC(2026, 10, 6, 13), 'UTC'), 13);
});

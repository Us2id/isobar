import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { repeatWhileVisible } from '../js/schedule.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fakePage() {
  let hidden = false;
  const listeners = new Set();
  return {
    isHidden: () => hidden,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setHidden(value) {
      hidden = value;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

const options = (page) => ({ intervalMs: 1000, retryMs: 100, jitter: 0, page });

test('runs at once, then on every interval', async () => {
  const task = mock.fn(async () => {});
  const stop = repeatWhileVisible(task, options(fakePage()));
  await settle();
  assert.equal(task.mock.callCount(), 1);
  mock.timers.tick(999);
  await settle();
  assert.equal(task.mock.callCount(), 1);
  mock.timers.tick(1);
  await settle();
  assert.equal(task.mock.callCount(), 2);
  stop();
});

test('asks nothing while the tab is hidden, and catches up when it returns', async () => {
  const page = fakePage();
  const task = mock.fn(async () => {});
  const stop = repeatWhileVisible(task, options(page));
  await settle();
  page.setHidden(true);
  for (let i = 0; i < 5; i++) {
    mock.timers.tick(1000);
    await settle();
  }
  assert.equal(task.mock.callCount(), 1);
  page.setHidden(false);
  await settle();
  assert.equal(task.mock.callCount(), 2);
  mock.timers.tick(1000);
  await settle();
  assert.equal(task.mock.callCount(), 3, 'the normal rhythm resumes');
  stop();
});

test('does not run extra when a tab returns before anything was due', async () => {
  const page = fakePage();
  const task = mock.fn(async () => {});
  const stop = repeatWhileVisible(task, options(page));
  await settle();
  page.setHidden(true);
  page.setHidden(false);
  await settle();
  assert.equal(task.mock.callCount(), 1);
  stop();
});

test('retries sooner after a failure, then returns to the normal interval', async () => {
  let shouldFail = true;
  const task = mock.fn(async () => {
    if (shouldFail) throw new Error('boom');
  });
  const stop = repeatWhileVisible(task, options(fakePage()));
  await settle();
  mock.timers.tick(100);
  await settle();
  assert.equal(task.mock.callCount(), 2);
  shouldFail = false;
  mock.timers.tick(100);
  await settle();
  assert.equal(task.mock.callCount(), 3);
  mock.timers.tick(100);
  await settle();
  assert.equal(task.mock.callCount(), 3, 'a success goes back to the long interval');
  stop();
});

test('never overlaps a slow task', async () => {
  let finish;
  const task = mock.fn(() => new Promise((resolve) => { finish = resolve; }));
  const stop = repeatWhileVisible(task, options(fakePage()));
  await settle();
  mock.timers.tick(5000);
  await settle();
  assert.equal(task.mock.callCount(), 1);
  finish();
  await settle();
  mock.timers.tick(1000);
  await settle();
  assert.equal(task.mock.callCount(), 2);
  stop();
});

test('stopping cancels everything, even if a task is still running', async () => {
  const page = fakePage();
  let finish;
  const task = mock.fn(() => new Promise((resolve) => { finish = resolve; }));
  const stop = repeatWhileVisible(task, options(page));
  await settle();
  stop();
  finish();
  await settle();
  mock.timers.tick(10000);
  await settle();
  assert.equal(task.mock.callCount(), 1);
  assert.equal(page.listenerCount(), 0);
});

test('spreads requests out by up to the jitter amount', async () => {
  const task = mock.fn(async () => {});
  const stop = repeatWhileVisible(task, { ...options(fakePage()), jitter: 0.1, random: () => 1 });
  await settle();
  mock.timers.tick(1099);
  await settle();
  assert.equal(task.mock.callCount(), 1);
  mock.timers.tick(1);
  await settle();
  assert.equal(task.mock.callCount(), 2);
  stop();
});

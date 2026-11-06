const browserPage = () => ({
  isHidden: () => document.hidden,
  onChange: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
});

// Runs `task` now, then again after each interval, so an open tab stays current on its own.
// Nothing runs while the tab is hidden: public services don't get asked for data nobody is
// looking at. A task that throws is retried sooner. Returns a function that stops the loop.
export function repeatWhileVisible(task, { intervalMs, retryMs = intervalMs, jitter = 0.1, page = browserPage(), random = Math.random }) {
  let stopped = false;
  let timer = null;
  let running = false;
  let dueWhileHidden = false;

  const schedule = (delay) => {
    // Spread requests out so visitors who opened the page together don't all ask at the same second.
    const spread = delay * jitter * (random() * 2 - 1);
    timer = setTimeout(tick, delay + spread);
  };

  const tick = async () => {
    timer = null;
    if (stopped || running) return;
    if (page.isHidden()) {
      dueWhileHidden = true;
      return;
    }
    running = true;
    let delay = intervalMs;
    try {
      await task();
    } catch {
      delay = retryMs;
    }
    running = false;
    if (!stopped) schedule(delay);
  };

  const removeListener = page.onChange(() => {
    if (!page.isHidden() && dueWhileHidden) {
      dueWhileHidden = false;
      tick();
    }
  });

  tick();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    removeListener();
  };
}

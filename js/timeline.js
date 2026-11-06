// The forecast time control: now, or any hour out to 16 days. Hourly at first, then 3-hourly,
// which is how NOAA's files are spaced.
import { formatForecastTime } from './format.js';

const HOUR = 3_600_000;
const MAX_HOURS = 384;
const SETTLE_MS = 250;
const PLAY_MS = 1400;

export const timelineSteps = () => {
  const steps = [];
  for (let hours = 0; hours <= 120; hours += 1) steps.push(hours);
  for (let hours = 123; hours <= MAX_HOURS; hours += 3) steps.push(hours);
  return steps;
};

export function describeOffset(hours) {
  if (hours === 0) return 'Now';
  if (hours < 48) return `In ${hours} hour${hours === 1 ? '' : 's'}`;
  return `In ${Math.round(hours / 24)} days`;
}

export class Timeline {
  constructor(root, { onChange, isBusy }) {
    Object.assign(this, { root, onChange, isBusy });
    this.steps = timelineSteps();
    this.index = 0;
    this.playing = null;
    this.range = root.querySelector('input');
    this.label = root.querySelector('output');
    this.playButton = root.querySelector('[data-action=play]');
    this.nowButton = root.querySelector('[data-action=now]');
    this.range.max = String(this.steps.length - 1);
    this.range.addEventListener('input', () => {
      this.stop();
      this.setIndex(Number(this.range.value));
    });
    this.playButton.addEventListener('click', () => (this.playing ? this.stop() : this.play()));
    this.nowButton.addEventListener('click', () => {
      this.stop();
      this.range.value = '0';
      this.setIndex(0);
    });
    this.render();
  }

  // What time layers should show, in ms. At "now" this moves on with the clock.
  time() {
    return Math.round(Date.now() / HOUR) * HOUR + this.steps[this.index] * HOUR;
  }

  setVisible(visible) {
    this.root.hidden = !visible;
    document.body.classList.toggle('has-timeline', visible);
    if (!visible) this.stop();
  }

  setIndex(index) {
    this.index = index;
    this.render();
    clearTimeout(this.settle);
    this.settle = setTimeout(() => this.onChange(), SETTLE_MS);
  }

  play() {
    this.playButton.textContent = 'Pause';
    this.playing = setInterval(() => {
      if (document.hidden || this.isBusy()) return;
      const next = this.index + 1 >= this.steps.length ? 0 : this.index + 1;
      this.range.value = String(next);
      this.index = next;
      this.render();
      this.onChange();
    }, PLAY_MS);
  }

  stop() {
    if (!this.playing) return;
    clearInterval(this.playing);
    this.playing = null;
    this.playButton.textContent = 'Play';
  }

  render() {
    const hours = this.steps[this.index];
    const when = hours === 0 ? '' : `, ${formatForecastTime(this.time(), Date.now())}`;
    this.label.textContent = `${describeOffset(hours)}${when}`;
    this.nowButton.hidden = hours === 0;
  }
}

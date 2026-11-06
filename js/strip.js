// The chart-paper strip that opens when someone picks a spot on the map.
import { el } from './dom.js';
import { loadAlertsAt, loadForecast } from './forecast.js';
import { formatClock, formatCoordinates } from './format.js';
import { drawMeteogram } from './meteogram.js';
import { describeWind, fullTemp, shortTemp } from './units.js';

const byId = (id) => document.getElementById(id);

export class ForecastStrip {
  constructor(root, { getSystem, onOpened, onClosed }) {
    this.root = root;
    this.getSystem = getSystem;
    this.onOpened = onOpened;
    this.onClosed = onClosed;
    this.point = null;
    this.forecast = { state: 'idle' };
    this.alerts = { state: 'idle' };
    this.place = byId('strip-place');
    this.now = byId('strip-now');
    this.alertsBox = byId('strip-alerts');
    this.chart = byId('strip-chart');
    this.key = byId('chart-key');
    this.readout = byId('chart-readout');
    this.days = byId('strip-days');
    this.source = byId('strip-source');
    byId('strip-close').addEventListener('click', () => this.close());

    new ResizeObserver(() => {
      this.publishHeight();
      this.drawChart();
    }).observe(this.root);
  }

  // The map's own controls sit above the strip, so the page needs to know how tall it is.
  publishHeight() {
    const height = this.root.hidden ? 0 : this.root.offsetHeight;
    document.documentElement.style.setProperty('--strip-height', `${height}px`);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  async open({ lat, lng }) {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.point = { lat, lng };
    this.forecast = { state: 'loading' };
    this.alerts = { state: 'loading' };
    const wasOpen = this.isOpen;
    this.root.hidden = false;
    if (!wasOpen) this.root.classList.add('rising');
    this.render();
    this.root.focus({ preventScroll: true });
    this.root.scrollTop = 0;
    this.onOpened?.();

    // Picking another spot cancels this request, and its late answers must not overwrite the new one.
    const { signal } = request;
    const whenCurrent = (apply) => (value) => {
      if (this.request !== request) return;
      apply(value);
      this.render();
      this.onOpened?.();
    };
    await Promise.all([
      loadForecast(lat, lng, { signal }).then(
        whenCurrent((data) => { this.forecast = { state: 'ready', data }; }),
        whenCurrent(() => { this.forecast = { state: 'failed' }; }),
      ),
      loadAlertsAt(lat, lng, { signal }).then(
        whenCurrent((result) => { this.alerts = result; }),
        whenCurrent(() => { this.alerts = { state: 'failed', alerts: [] }; }),
      ),
    ]);
  }

  close() {
    this.request?.abort();
    this.request = null;
    this.root.hidden = true;
    this.root.classList.remove('rising');
    this.publishHeight();
    this.onClosed?.();
  }

  // Called when the temperature and speed units change.
  refresh() {
    if (this.isOpen) this.render();
  }

  render() {
    this.renderHead();
    this.renderAlerts();
    this.renderDays();
    this.renderSource();
    this.drawChart();
  }

  renderHead() {
    const { lat, lng } = this.point;
    const { state, data } = this.forecast;
    const system = this.getSystem();
    this.place.textContent = data && state === 'ready' ? data.place : formatCoordinates(lat, lng);
    if (state === 'loading') {
      this.now.replaceChildren('Loading forecast');
    } else if (state === 'failed') {
      this.now.replaceChildren(
        "This forecast didn't load. ",
        el('button', { type: 'button', class: 'text-button', text: 'Try again', onClick: () => this.open(this.point) }),
      );
    } else if (data.hours.length > 0) {
      const hour = data.hours[0];
      this.now.replaceChildren(`This hour: ${fullTemp(hour.tempC, system)}, ${hour.summary.toLowerCase()}. ${describeWind(hour.windMs, hour.windFromDegrees, system)}.`);
    } else {
      this.now.replaceChildren('No hourly forecast is available for this spot.');
    }
  }

  renderAlerts() {
    const { state, alerts } = this.alerts;
    const box = this.alertsBox;
    const timeZone = this.forecast.data?.timeZone;
    const quiet = (text) => box.replaceChildren(el('p', { class: 'alerts-note', text }));
    if (state === 'loading') {
      quiet('Checking alerts');
    } else if (state === 'failed') {
      box.replaceChildren(el('p', { class: 'alerts-note alerts-failed' },
        "Couldn't check alerts for this spot. ",
        el('a', { href: 'https://www.weather.gov/', target: '_blank', rel: 'noopener', text: 'See weather.gov' }),
        ' for official warnings.',
      ));
    } else if (state === 'notCovered') {
      quiet('Official alerts cover the US and nearby waters only.');
    } else if (alerts.length === 0) {
      quiet('No active alerts here.');
    } else {
      box.replaceChildren(el('ul', { class: 'alert-list' }, ...alerts.map((alert) => el('li', {},
        el('details', { class: `alert alert-${alert.severity.toLowerCase()}` },
          el('summary', {},
            el('strong', { text: alert.event }),
            alert.until ? ` until ${formatClock(alert.until, { timeZone })}` : null,
          ),
          el('p', { class: 'alert-text', text: alert.description }),
          alert.instruction ? el('p', { class: 'alert-text', text: alert.instruction }) : null,
          el('p', { class: 'alert-area', text: `Area: ${alert.area}` }),
        ),
      ))));
    }
  }

  renderDays() {
    const { state, data } = this.forecast;
    const system = this.getSystem();
    if (state !== 'ready') {
      this.days.replaceChildren();
      return;
    }
    const temps = (day) => [
      day.highC === null ? '' : shortTemp(day.highC, system),
      day.lowC === null ? '' : shortTemp(day.lowC, system),
    ].filter(Boolean).join(' / ');
    this.days.replaceChildren(...data.days.map((day) => el('li', { class: 'day' },
      el('span', { class: 'day-name', text: day.label }),
      el('span', { class: 'day-summary', text: day.summary }),
      el('span', { class: 'day-temps', text: temps(day) }),
    )));
  }

  renderSource() {
    const { state, data } = this.forecast;
    if (state !== 'ready') {
      this.source.replaceChildren();
      return;
    }
    const timeZone = data.timeZone;
    const official = ' Not an official source. For warnings you can act on, use weather.gov.';
    if (data.source === 'nws') {
      const issued = data.issuedAt ? `, issued ${formatClock(data.issuedAt, { timeZone })}` : '';
      this.source.replaceChildren(
        `Forecast from the National Weather Service${issued}. `,
        el('a', { href: data.link, target: '_blank', rel: 'noopener', text: 'Open on weather.gov' }),
        `.${official}`,
      );
    } else {
      this.source.replaceChildren(
        data.nwsFailed ? "The National Weather Service didn't respond, so this comes from another source. " : '',
        el('a', { href: data.link, target: '_blank', rel: 'noopener', text: 'Weather data by Open-Meteo.com' }),
        `.${official}`,
      );
    }
  }

  drawChart() {
    if (!this.isOpen) return;
    const { state, data } = this.forecast;
    this.showReadout(null);
    if (state !== 'ready' || data.hours.length === 0) {
      this.chart.replaceChildren();
      this.key.hidden = true;
      return;
    }
    this.key.hidden = false;
    drawMeteogram(this.chart, data.hours, {
      system: this.getSystem(),
      timeZone: data.timeZone,
      onHover: (hour) => this.showReadout(hour),
    });
  }

  showReadout(hour) {
    if (!hour) {
      this.readout.hidden = true;
      this.key.classList.remove('is-covered');
      return;
    }
    const system = this.getSystem();
    const { timeZone } = this.forecast.data;
    this.readout.hidden = false;
    this.key.classList.add('is-covered');
    this.readout.textContent = `${formatClock(hour.start, { timeZone })}: ${fullTemp(hour.tempC, system)}, ${hour.rainPercent}% chance of rain or snow. ${describeWind(hour.windMs, hour.windFromDegrees, system)}. ${hour.summary}.`;
  }
}

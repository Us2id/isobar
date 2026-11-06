// The layer panel: overlays that stack, one "color the map" layer at a time, and finding them.
import { el } from './dom.js';
import { legendGradient, legendLabels } from './palettes.js';
import { describeStatus } from './status.js';
import { formatNumber, unitLabel } from './units.js';
import { gibsLegendUrl, loadArcgisLegend } from './image-layers.js';

const byId = (id) => document.getElementById(id);

export class Panel {
  constructor({ overlays, groups, fills, models, getSystem, onOverlay, onFill, onClearFill, onOpacity, onModel, pinned, onPinned }) {
    Object.assign(this, { overlays, groups, fills, getSystem, onOverlay, onFill, onClearFill, onOpacity, onPinned });
    this.pinned = new Set(pinned);
    this.rows = new Map();
    this.fillItems = new Map();
    this.activeFill = null;
    this.status = new Map();
    this.overlayList = byId('layer-list');
    this.fillActive = byId('fill-active');
    this.fillGroups = byId('fill-groups');
    this.filterInput = byId('layer-filter');
    this.filterEmpty = byId('filter-empty');

    for (const overlay of overlays) this.addOverlayRow(overlay);
    this.renderFillGroups();

    this.filterInput.addEventListener('input', () => this.applyFilter());

    const select = byId('model-select');
    select.replaceChildren(...models.map(({ id, name }) => el('option', { value: id, text: name })));
    select.addEventListener('change', () => onModel(select.value));
    this.modelSelect = select;

    byId('layers-toggle').addEventListener('click', () => {
      const open = document.body.classList.toggle('layers-open');
      byId('layers-toggle').setAttribute('aria-expanded', String(open));
    });
  }

  setModel(model) {
    this.modelSelect.value = model;
  }

  closeOnPhone() {
    document.body.classList.remove('layers-open');
    byId('layers-toggle').setAttribute('aria-expanded', 'false');
  }

  addOverlayRow({ id, name, legend, hint, extras }) {
    const status = el('span', { class: 'layer-status' });
    const legendBox = el('span', { class: 'legend' });
    const button = el('button', {
      type: 'button',
      class: 'layer-toggle',
      'aria-pressed': 'false',
      onClick: () => this.onOverlay(id, button.getAttribute('aria-pressed') !== 'true'),
    },
      el('span', { class: 'lamp', 'aria-hidden': 'true' }),
      el('span', { class: 'layer-name', text: name }),
      status,
      legendBox,
    );
    const extra = extras ? extras() : null;
    if (extra) extra.classList.add('row-extra');
    const item = el('li', { class: 'layer-item' }, button, extra);
    this.overlayList.append(item);
    this.rows.set(id, { button, status, legendBox, item, legend, hint, extra });
    this.renderOverlayLegend(id);
  }

  renderOverlayLegend(id) {
    const { legend, legendBox, hint } = this.rows.get(id);
    const content = typeof legend === 'function' ? legend(this.getSystem()) : legend;
    if (content) {
      const bar = el('span', { class: 'legend-bar' });
      bar.style.background = `linear-gradient(to right, ${content.stops.join(', ')})`;
      legendBox.replaceChildren(bar, el('span', { class: 'legend-ends' }, el('span', { text: content.low }), el('span', { text: content.high })));
    } else if (hint) {
      legendBox.replaceChildren(el('span', { class: 'legend-note', text: hint }));
    }
  }

  setOverlayOn(id, on) {
    const row = this.rows.get(id);
    row.button.setAttribute('aria-pressed', String(on));
    row.item.classList.toggle('is-on', on);
    this.renderStatus(id);
  }

  setStatus(id, status) {
    this.status.set(id, status);
    this.renderStatus(id);
  }

  renderStatus(id) {
    const row = this.rows.get(id);
    if (row) {
      const on = row.button.getAttribute('aria-pressed') === 'true';
      const { text, tone } = on ? describeStatus(this.status.get(id)) : { text: '', tone: 'normal' };
      row.status.textContent = text;
      row.status.className = `layer-status tone-${tone}`;
    }
    if (this.activeFill?.id === id) {
      const { text, tone } = describeStatus(this.status.get(id));
      const line = this.fillActive.querySelector('.layer-status');
      if (line) {
        line.textContent = text;
        line.className = `layer-status tone-${tone}`;
      }
    }
  }

  refreshStatuses() {
    for (const id of this.rows.keys()) this.renderStatus(id);
    if (this.activeFill) this.renderStatus(this.activeFill.id);
  }

  // Units changed.
  refreshLegends() {
    for (const id of this.rows.keys()) this.renderOverlayLegend(id);
    if (this.activeFill) this.renderActive();
  }

  renderFillGroups() {
    this.fillItems.clear();
    const lists = new Map();
    const pinnedEntries = this.fills.filter((entry) => this.pinned.has(entry.id));
    const sections = [
      ...(pinnedEntries.length ? [{ id: 'pinned', name: 'Pinned', entries: pinnedEntries }] : []),
      ...this.groups.map((group) => ({ ...group, entries: this.fills.filter((entry) => entry.group === group.id) })),
    ];
    const nodes = sections.filter((section) => section.entries.length > 0).map((section) => {
      const items = section.entries.map((entry) => this.fillRow(entry));
      const list = el('ul', { class: 'fill-list' }, ...items);
      const details = el('details', { class: 'fill-group', 'data-group': section.id, open: section.id === 'pinned' },
        el('summary', {}, el('span', { text: section.name }), el('span', { class: 'fill-count', text: String(section.entries.length) })),
        list,
      );
      lists.set(section.id, details);
      return details;
    });
    this.fillGroups.replaceChildren(...nodes);
    this.markActiveFill();
    this.applyFilter();
  }

  fillRow(entry) {
    const pressedStar = this.pinned.has(entry.id);
    const pick = el('button', {
      type: 'button',
      class: 'fill-item',
      'aria-pressed': 'false',
      'data-fill': entry.id,
      title: entry.about,
      text: entry.name,
      onClick: () => this.onFill(entry.id),
    });
    const star = el('button', {
      type: 'button',
      class: 'pin-button',
      'aria-pressed': String(pressedStar),
      'aria-label': `${pressedStar ? 'Unpin' : 'Pin'} ${entry.name}`,
      title: pressedStar ? 'Unpin' : 'Pin to the top',
      text: pressedStar ? '★' : '☆',
      onClick: () => {
        if (this.pinned.has(entry.id)) this.pinned.delete(entry.id);
        else this.pinned.add(entry.id);
        this.onPinned([...this.pinned]);
        this.renderFillGroups();
      },
    });
    const row = el('li', { class: 'fill-row', 'data-search': `${entry.name} ${entry.about} ${entry.source ?? ''}`.toLowerCase() }, pick, star);
    const known = this.fillItems.get(entry.id) ?? [];
    known.push(pick);
    this.fillItems.set(entry.id, known);
    return row;
  }

  applyFilter() {
    const query = this.filterInput.value.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const group of this.fillGroups.querySelectorAll('.fill-group')) {
      let visible = 0;
      for (const row of group.querySelectorAll('.fill-row')) {
        const match = words.every((word) => row.dataset.search.includes(word));
        row.hidden = !match;
        if (match) visible += 1;
      }
      group.hidden = visible === 0;
      if (words.length) group.open = true;
      else if (group.dataset.group !== 'pinned') group.open = false;
      shown += visible;
    }
    this.filterEmpty.hidden = shown > 0;
  }

  markActiveFill() {
    for (const [id, buttons] of this.fillItems) {
      for (const button of buttons) button.setAttribute('aria-pressed', String(this.activeFill?.id === id));
    }
  }

  setActiveFill(entry, { opacity, supportsValues }) {
    this.activeFill = entry;
    this.activeOpacity = opacity;
    this.activeSupportsValues = supportsValues;
    this.markActiveFill();
    this.renderActive();
    document.body.classList.toggle('has-fill', Boolean(entry));
  }

  renderActive() {
    const entry = this.activeFill;
    if (!entry) {
      this.fillActive.replaceChildren();
      this.fillActive.hidden = true;
      return;
    }
    this.fillActive.hidden = false;
    const slider = el('input', {
      type: 'range', min: '20', max: '100', value: String(Math.round(this.activeOpacity * 100)),
      'aria-label': `Opacity of ${entry.name}`,
      onInput: (event) => this.onOpacity(Number(event.target.value) / 100),
    });
    this.fillActive.replaceChildren(
      el('div', { class: 'fill-head' },
        el('strong', { text: entry.name }),
        el('button', { type: 'button', class: 'quiet-button', text: 'Clear', onClick: () => this.onClearFill() }),
      ),
      el('p', { class: 'layer-status' }),
      this.buildLegend(entry),
      el('p', { class: 'fill-about', text: entry.about }),
      el('label', { class: 'opacity-control' }, el('span', { text: 'Opacity' }), slider),
    );
    this.renderStatus(entry.id);
  }

  buildLegend(entry) {
    const system = this.getSystem();
    if (entry.categories) {
      return el('div', { class: 'legend-categories' }, ...entry.categories.slice(1).map((label, index) => {
        const swatch = el('span', { class: 'legend-swatch' });
        swatch.style.background = entry.ramp.stops[index + 1][1];
        return el('span', { class: 'legend-category' }, swatch, label);
      }));
    }
    if (entry.ramp) {
      const unit = unitLabel(entry.unit, system);
      const bar = el('span', { class: 'legend-bar' });
      bar.style.background = legendGradient(entry.ramp);
      const ticks = el('span', { class: 'legend-ticks' }, ...legendLabels(entry.ramp).map(({ value, position }) => {
        const tick = el('span', { text: formatNumber(value, entry.unit, system) });
        tick.style.left = `${position}%`;
        return tick;
      }));
      return el('div', { class: 'legend-block' }, bar, ticks, unit ? el('span', { class: 'legend-unit', text: unit }) : null);
    }
    if (entry.kind === 'gibs') {
      const url = gibsLegendUrl(entry);
      return url ? el('img', { class: 'legend-image', src: url, alt: `Color key for ${entry.name}`, loading: 'lazy' }) : el('div', { class: 'legend-block' });
    }
    if (entry.kind === 'arcgis') {
      const box = el('div', { class: 'legend-swatches' });
      loadArcgisLegend(entry).then((rows) => {
        if (this.activeFill !== entry) return;
        box.replaceChildren(...rows.map(({ label, image }) => el('span', { class: 'legend-category' }, el('img', { src: image, alt: '' }), label)));
      }).catch(() => {});
      return box;
    }
    return el('div', { class: 'legend-block' });
  }
}

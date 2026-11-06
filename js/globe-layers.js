// The flat map's layers, drawing on the globe instead. Fetching data, checking for updates and
// reporting status all stay in the original classes. Only the drawing is replaced here.
import { AlertsLayer, stormColor } from './alerts-layer.js';
import { ALERT_MAP } from './config.js';
import { el } from './dom.js';
import { FieldLayer } from './field-layer.js';
import { FlowLayer } from './flow-layer.js';
import { addPaintedField, clearWhiteTemplate, cloudTemplate, fieldTemplate, GlobeFeatures, GlobeMarkers, GlobeTiles, removePaintedField } from './globe.js';
import { GlobeParticles } from './globe-flow.js';
import { arcgisTemplate, boundsFromCorners, contourFeatures, pointFeatures, sourceBounds, wmsTemplate } from './globe-helpers.js';
import { ArcgisLayer, GibsLayer, NOAA_SERVICES, RainViewerLayer } from './image-layers.js';
import { IsobarLayer } from './isobars.js';
import { AirportLayer, CycloneLayer, EventLayer } from './points-layers.js';
import { WmsLayer } from './wms-layer.js';

const FIELD_MAX_ZOOM = 6;

export class GlobeFieldLayer extends FieldLayer {
  // Each new forecast time gets its own tiles. The old ones are forgotten once the new ones show.
  draw() {
    const { grid } = this.result;
    const key = addPaintedField(grid, this.lookup, this.entry.nearest);
    if (this.oldKey) removePaintedField(this.oldKey);
    this.oldKey = this.key;
    this.key = key;
    if (this.layer) {
      this.layer.setUrl(fieldTemplate(key));
    } else {
      this.layer = new GlobeTiles(fieldTemplate(key), { tileSize: 256, maxzoom: FIELD_MAX_ZOOM, pane: this.pane, opacity: this.opacity }).addTo(this.map);
    }
  }

  stop() {
    super.stop();
    if (this.key) removePaintedField(this.key);
    if (this.oldKey) removePaintedField(this.oldKey);
    this.key = null;
    this.oldKey = null;
  }
}

export class GlobeFlowLayer extends FlowLayer {
  velocityData() {
    return this.result.grid;
  }

  attach() {
    this.layer = new GlobeParticles(this.map, this.result.grid, this.style);
  }

  detach() {
    this.layer?.remove();
    this.layer = null;
  }
}

export class GlobeWmsLayer extends WmsLayer {
  makeFrame(spec, time) {
    const { options } = this;
    const pane = spec.pane ?? options.pane;
    const url = wmsTemplate(spec.url, spec.layer, time);
    // Infrared satellite images need their dark background removed. See cloudsOnly in globe.js.
    const isSatellite = pane === 'satelliteWorld' || pane === 'satelliteGoes';
    return new GlobeTiles(isSatellite ? cloudTemplate(url, pane === 'satelliteGoes') : url, {
      tileSize: 512,
      bounds: sourceBounds(spec.box),
      pane,
      opacity: 0,
      attribution: options.attribution,
    });
  }
}

export class GlobeGibsLayer extends GibsLayer {
  makeLayer() {
    const { level, bounds } = this.entry;
    return new GlobeTiles(this.template(this.time), {
      tileSize: 256,
      maxzoom: level,
      bounds: boundsFromCorners(bounds),
      pane: this.pane,
      opacity: this.opacity,
      attribution: this.attribution,
    });
  }
}

export class GlobeArcgisLayer extends ArcgisLayer {
  makeLayer() {
    const { service, image, show, clearWhite } = this.entry;
    const url = arcgisTemplate(`${NOAA_SERVICES}/${service}`, { image, show });
    return new GlobeTiles(clearWhite ? clearWhiteTemplate(url) : url, {
      tileSize: 512,
      pane: this.pane,
      opacity: this.opacity,
      attribution: this.attribution,
    });
  }
}

export class GlobeRainViewerLayer extends RainViewerLayer {
  tileLayer(path, opacity) {
    return new GlobeTiles(this.tileUrl(path), {
      tileSize: 512,
      maxzoom: 7,
      pane: this.pane,
      opacity,
      attribution: this.attribution,
    });
  }
}

export class GlobeAlertsLayer extends AlertsLayer {
  makeMapLayer(onStatus) {
    return new GlobeWmsLayer(this.map, ALERT_MAP, onStatus);
  }

  draw(features) {
    const shaped = features.filter((feature) => feature.geometry).map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: { color: stormColor(feature) },
    }));
    const next = new GlobeFeatures(this.map, {
      pane: 'storms',
      data: { type: 'FeatureCollection', features: shaped },
      layers: [
        { type: 'fill', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } },
        // A dark outline under each shape keeps it readable over any map color.
        { type: 'line', paint: { 'line-color': '#07101c', 'line-width': 4.5, 'line-opacity': 0.85 } },
        { type: 'line', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } },
      ],
    });
    if (this.drawn) this.map.removeLayer(this.drawn);
    this.drawn = next;
  }
}

export class GlobeIsobarLayer extends IsobarLayer {
  draw() {
    const { lines, centers } = this.shapes();
    const next = {
      shapes: new GlobeFeatures(this.map, {
        pane: this.pane,
        data: contourFeatures(lines),
        layers: [{ type: 'line', paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'opacity'], 'line-width': ['get', 'width'] } }],
      }),
      marks: new GlobeMarkers(this.map, centers.map(({ lat, lng, value, kind }) => ({
        lat,
        lng,
        element: el('div', { class: `pressure-mark pressure-${kind} globe-mark` }, el('b', { text: kind }), el('span', { text: String(Math.round(value)) })),
      }))),
      remove() {
        this.shapes.remove();
        this.marks.remove();
      },
    };
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
  }
}

export class GlobeCycloneLayer extends CycloneLayer {
  draw(storms, paths) {
    const described = storms.map((storm, index) => this.describe(storm, paths[index]));
    const features = described.flatMap(({ swaths, tracks }) => [
      ...swaths.map(({ part, color }) => ({ type: 'Feature', geometry: part.geometry, properties: { color } })),
      ...tracks.map(({ part, ahead }) => ({ type: 'Feature', geometry: part.geometry, properties: { ahead } })),
    ]);
    const isArea = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
    const isTrack = (ahead) => ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'ahead'], ahead]];
    const next = {
      shapes: new GlobeFeatures(this.map, {
        pane: 'storms',
        data: { type: 'FeatureCollection', features },
        layers: [
          { type: 'fill', filter: isArea, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 } },
          { type: 'line', filter: isArea, paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.8 } },
          { type: 'line', filter: isTrack(false), paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.9 } },
          { type: 'line', filter: isTrack(true), paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.9, 'line-dasharray': [2.5, 3] } },
        ],
      }),
      marks: new GlobeMarkers(this.map, described.map(({ name, lat, lng, level, popup }) => ({
        lat,
        lng,
        popup,
        element: el('button', { type: 'button', class: `cyclone-mark cyclone-${level} globe-cyclone`, title: name, 'aria-label': name }),
      }))),
      remove() {
        this.shapes.remove();
        this.marks.remove();
      },
    };
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
    this.reportStorms(described);
  }
}

const circles = (radius, opacity) => [{
  type: 'circle',
  paint: {
    'circle-radius': radius,
    'circle-color': ['get', 'color'],
    'circle-opacity': opacity,
    'circle-stroke-color': '#07101c',
    'circle-stroke-width': 1,
  },
}];

export class GlobeAirportLayer extends AirportLayer {
  draw(networks) {
    const stations = this.stationsIn(networks);
    const next = new GlobeFeatures(this.map, {
      pane: this.pane,
      data: pointFeatures(stations),
      layers: circles(4.5, 1),
      onClick: (hit) => {
        const { lat, lng, props, category } = stations[hit.properties.index];
        this.map.openPopup(lat, lng, this.popup(props, category, lat, lng));
      },
    });
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
  }
}

export class GlobeEventLayer extends EventLayer {
  draw(points) {
    const next = new GlobeFeatures(this.map, {
      pane: this.pane,
      data: pointFeatures(points),
      layers: circles(5, 0.95),
      onClick: (hit) => {
        const { lat, lng, popup } = points[hit.properties.index];
        this.map.openPopup(lat, lng, popup());
      },
    });
    if (this.group) this.map.removeLayer(this.group);
    this.group = next;
  }
}

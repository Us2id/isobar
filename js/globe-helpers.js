// The parts of the globe that are plain arithmetic and text. No browser APIs, so the tests can run them.
import { onTop } from './basemap.js';
import { PANE_ORDER } from './config.js';

const WORLD_TILE = 512;
const RADIANS = Math.PI / 180;

// The flat map's zoom counts 256-pixel tiles and the globe's counts 512, so the same scale on the
// globe is one number lower.
export const toGlobeZoom = (flatZoom) => flatZoom - 1;
export const toFlatZoom = (globeZoom) => globeZoom + 1;

// The camera sits one and a half window heights from the near side of the Earth. That's MapLibre's
// default field of view, and it decides how large the round Earth looks on screen.
const CAMERA_HEIGHTS = 1.5;

// The Earth's true radius in pixels at a zoom. It grows with the latitude at the center of the view.
const trueRadius = (globeZoom, latitude) => (WORLD_TILE * 2 ** globeZoom) / (2 * Math.PI * Math.cos(Math.min(Math.abs(latitude), 85) * RADIANS));

// How large the Earth's disk looks on screen, seen in perspective from the camera.
export function diskRadius(globeZoom, latitude, height) {
  const radius = trueRadius(globeZoom, latitude);
  const distance = CAMERA_HEIGHTS * height;
  return (distance * radius) / Math.sqrt(distance * distance + 2 * distance * radius);
}

// The zoom at which the whole disk fits in the window, leaving room around it.
export function fitGlobeZoom(width, height, latitude = 0, share = 0.86) {
  const disk = (Math.min(width, height) * share) / 2;
  const distance = CAMERA_HEIGHTS * height;
  const radius = (disk * disk + disk * Math.sqrt(disk * disk + distance * distance)) / distance;
  const cosine = Math.cos(Math.min(Math.abs(latitude), 85) * RADIANS);
  return Math.max(0, Math.log2((2 * Math.PI * radius * cosine) / WORLD_TILE));
}

export const slotId = (pane) => `slot-${pane}`;

// The flat map keeps its layers in separate panes. The globe draws everything in one place, so
// empty marker layers hold the same order, and a new layer goes in just below its pane's marker.
export function globeStyle(style, panes = PANE_ORDER) {
  const marker = (pane) => ({ id: slotId(pane), type: 'background', layout: { visibility: 'none' } });
  const split = panes.indexOf('labels');
  return {
    ...style,
    projection: { type: 'globe' },
    // No atmosphere: MapLibre's draws a pale haze over the Earth, which falsifies every data color.
    sky: { 'atmosphere-blend': 0 },
    layers: [
      ...style.layers.filter((layer) => !onTop(layer)),
      ...panes.slice(0, split).map(marker),
      ...style.layers.filter(onTop),
      ...panes.slice(split + 1).map(marker),
    ],
  };
}

// ---- Tile addresses ----
export function wmsTemplate(url, layer, time) {
  const stamp = time ? `&time=${encodeURIComponent(time)}` : '';
  return `${url}?service=WMS&request=GetMap&version=1.3.0&layers=${encodeURIComponent(layer)}&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=512&height=512&bbox={bbox-epsg-3857}${stamp}`;
}

export function arcgisTemplate(serviceUrl, { image = false, show = null } = {}) {
  const layers = show ? `&layers=show:${show.join(',')}` : '';
  return `${serviceUrl}/${image ? 'exportImage' : 'export'}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=${image ? 'png' : 'png32'}&transparent=true&f=image${layers}`;
}

// A box limiting where a layer asks for tiles. Layers covering several boxes ask everywhere.
export function sourceBounds(boxes) {
  if (!boxes || Array.isArray(boxes) || boxes.west <= -180) return undefined;
  return [boxes.west, boxes.south, boxes.east, boxes.north];
}

// The same limit, from the [[south, west], [north, east]] form the catalog uses.
export const boundsFromCorners = (corners) => (corners ? [corners[0][1], corners[0][0], corners[1][1], corners[1][0]] : undefined);

// ---- Shapes ----
export function contourFeatures(lines) {
  return {
    type: 'FeatureCollection',
    features: lines.map(({ major, segments }) => ({
      type: 'Feature',
      properties: { color: major ? '#ffffff' : '#dbe7f0', opacity: major ? 0.8 : 0.5, width: major ? 1.4 : 0.8 },
      geometry: {
        type: 'MultiLineString',
        coordinates: segments.map((segment) => segment.map(([lat, lng]) => [lng, lat])),
      },
    })),
  };
}

export function pointFeatures(points) {
  return {
    type: 'FeatureCollection',
    features: points.map(({ lat, lng, color }, index) => ({
      type: 'Feature',
      properties: { index, color },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })),
  };
}

// ---- Moving lines ----
// At the default line speed, wind of 10 m/s moves about 1.2 pixels per frame.
const PIXELS_PER_UNIT = 20;

export const degreesPerUnit = (velocityScale, globeZoom) => (velocityScale * PIXELS_PER_UNIT * 360) / (WORLD_TILE * 2 ** globeZoom);

export function moveParticle(lat, lng, u, v, degrees) {
  const stretch = Math.max(Math.cos(lat * RADIANS), 0.05);
  const nextLng = lng + (u * degrees) / stretch;
  return [lat + v * degrees, nextLng > 180 ? nextLng - 360 : nextLng < -180 ? nextLng + 360 : nextLng];
}

// A random place in a lat/long box. Choosing the sine of the latitude evenly keeps the points evenly
// spread over the Earth, rather than crowded toward the poles.
export function randomPlace(south, north, west, east, random = Math.random) {
  const low = Math.sin(south * RADIANS);
  const high = Math.sin(north * RADIANS);
  const lat = Math.asin(low + random() * (high - low)) / RADIANS;
  const lng = west + random() * (east - west);
  return [lat, ((((lng + 180) % 360) + 360) % 360) - 180];
}

export const colorSlot = (speed, maxVelocity, count) => Math.min(count - 1, Math.floor((speed / maxVelocity) * count));

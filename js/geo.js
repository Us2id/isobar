// Coverage areas are plain boxes in degrees. A map view can run past ±180° when the map wraps
// around the world, so views are compared against each box and its copies one world away.
const asList = (boxes) => (Array.isArray(boxes) ? boxes : [boxes]);

export function boxTouchesView(boxes, view) {
  return asList(boxes).some((box) => {
    if (box.north < view.south || box.south > view.north) return false;
    return [-360, 0, 360].some((shift) => box.west + shift <= view.east && box.east + shift >= view.west);
  });
}

export const pointInBoxes = (boxes, lat, lng) =>
  asList(boxes).some((box) => lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east);

export const wrapLongitude = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

// Leaflet can only limit a tile layer to one rectangle, so a layer covering two boxes loads everywhere.
export function leafletBounds(boxes) {
  if (Array.isArray(boxes) || boxes.west <= -180) return undefined;
  return [[boxes.south, boxes.west], [boxes.north, boxes.east]];
}

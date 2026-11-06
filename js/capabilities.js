// NOAA's map services list the newest image time in their capabilities document. Requesting
// that exact time means the site reloads tiles only when a new image exists, and every visitor
// asks for the same URLs, which NOAA's cache can then serve.
export function latestTimeIn(xml, layerName) {
  const start = xml.indexOf(`<Name>${layerName}</Name>`);
  if (start < 0) throw new Error(`${layerName} is not listed by the map service`);
  const dimension = xml.slice(start).match(/<Dimension\b[^>]*\bname="time"[^>]*>/);
  const value = dimension && dimension[0].match(/\bdefault="([^"]+)"/);
  if (!value || Number.isNaN(Date.parse(value[1]))) {
    throw new Error(`${layerName} has no usable time`);
  }
  return value[1];
}

export async function fetchLatestTime(url, layerName, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Map service returned ${response.status}`);
  return latestTimeIn(await response.text(), layerName);
}

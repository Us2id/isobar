# Isobar

A free, open-source live weather map of the whole world. It has animated wind and ocean currents, radar, satellite views, cyclones, airports and hundreds of forecast and measurement layers: temperature, rain, soil moisture, evapotranspiration, air quality, waves and more. Click anywhere for a forecast.

**Live site: <https://us2id.github.io/isobar/>**

It's a static site with no server and no database. Each visitor's browser fetches the latest data directly from the public services below and keeps checking while the page is open, so nothing has to be loaded by hand and hosting costs nothing.

## What's on the map

The map opens as a 3D globe. A button switches to a flat map and back, and every layer works on both. Overlays can be combined, and one layer at a time can color the whole map.

| Overlay | Source | Coverage |
|---|---|---|
| Wind flow, at 8 heights | NOAA GFS or ECMWF | World |
| Radar (US) | [NWS MRMS](https://opengeo.ncep.noaa.gov/geoserver/www/index.html) | US |
| Radar (world), with a 2-hour loop | [RainViewer](https://www.rainviewer.com/), up to zoom 7 | Wherever radars report |
| Lightning | [NOAA nowCOAST](https://nowcoast.noaa.gov/) | Americas and Pacific |
| Satellite | NOAA nowCOAST | World |
| Alerts | nowCOAST and [api.weather.gov](https://www.weather.gov/documentation/services-web-api) | US |
| Tropical cyclones | [GDACS](https://www.gdacs.org/) | World |
| Pressure lines | NOAA GFS or ECMWF | World |
| Ocean currents | NOAA CFS, 1° | World |
| Airports and flight rules | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) METAR | World |
| Fires and natural events | [NASA EONET](https://eonet.gsfc.nasa.gov/) | World |

The color layers come from two kinds of source:

- **Forecast fields**, read value by value in the browser, so the map can show a number under the cursor and move through time up to 16 days ahead: [NOAA GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/), GFS Wave, GEFS Aerosols and CFS Ocean, and [ECMWF IFS and AIFS open data](https://www.ecmwf.int/en/forecasts/datasets/open-data). Reference evapotranspiration (FAO-56) and growing degree days are computed from those fields.
- **Finished images**: [NASA GIBS](https://earthdata.nasa.gov/gibs) satellite products, and NOAA's outlooks, hazards, rainfall and river services. These can't show a number under the cursor.

Clicking the map shows the next 48 hours and 7 days from the National Weather Service inside the US, and from [Open-Meteo](https://open-meteo.com/) elsewhere or when NWS is down, with any active alerts for that spot. Tabs add more weather, soil and farming, air quality, sea and rivers, and a comparison of 8 forecast models.

The moving lines follow the forecast and are sped up so you can see them. They don't show the air or water moving live.

Place names come in by importance as you zoom: major countries first, then smaller countries and capitals, then states, then cities by size, then towns and villages. `PLACE_LADDER` in `js/basemap.js` holds the zoom for each kind, and `npm run labels` (see below) measures how much of the screen they cover.

Tested in Chrome, in WebKit (the engine behind Safari) and in Chrome on an Android phone emulator. Two things differ in Safari: cyclone tracks don't load, because GDACS's bot check blocks the request, so the layer says "tracks unavailable here" and still shows the storms; and the wind lines run at 30 frames a second on the flat map rather than 60.

**Isobar is not an official source.** Forecast values are model output and can be wrong, late or missing. For warnings you can act on, use [weather.gov](https://www.weather.gov/) or your national weather service.

## Run it

You need any local web server, because browsers won't load JavaScript modules from a plain file. There's nothing to install.

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Test it

The tests need Node 22 or newer, with no packages to install.

```sh
npm test
```

They cover the data handling: the GRIB decoders, picking the newest run, the layer catalog and its formulas, forecast and alert parsing, fallbacks, scheduling and the chart's layout. Drawing on the map isn't covered, so check that in a browser after changing it.

Two more tools download real data, so they aren't part of `npm test`:

```sh
npm run check-fields    # is every forecast layer's data there, and in a sensible range? (about 300 MB)
npm run cross-check     # do our values match Open-Meteo's copy of the same models?
```

Run them when something looks off, or to find out whether a source changed its files. Add words after `npm run check-fields --` to check only the layers whose ids contain them.

The label measurement counts the names on screen and the share of the screen they cover at each zoom, over four parts of the world; it was 22% at continent scale before the ladder and is 8% or less now.

## Publish it on GitHub Pages

1. Push this folder to a public GitHub repository.
2. In the repository, open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`.

The site appears at `https://<your-username>.github.io/<repository>/`. Every later push to `main` updates it. Weather data goes straight from its source to each visitor, so it doesn't count toward GitHub's limits.

## How it's organized

There's no framework and no build step. What's in `js/` is exactly what the browser runs.

| File | What it does |
|---|---|
| `catalog/fields.js` | Every forecast layer: its files, formula, unit and colors. Add a layer by adding a line. |
| `catalog/imagery.js` | Every NASA and NOAA image layer. Also one line each. |
| `config.js` | Overlay sources, refresh intervals and legends. |
| `main.js` | Connects the map, layers, controls and forecast strip. |
| `sources.js` | Where each model's files live, which run to use, and how to read their indexes. |
| `grid-worker.js`, `grid-service.js` | Download and unpack fields off the main thread, using HTTP range requests so only the needed part of each file comes down. |
| `grib2.js`, `aec.js`, `jpeg2000.js` | Read GRIB2 in the browser, including ECMWF's CCSDS packing and NOAA's JPEG 2000. |
| `field-layer.js`, `field-paint.js`, `palettes.js` | Paint a field onto map tiles. |
| `flow-layer.js`, `isobars.js`, `points-layers.js` | Moving lines, pressure lines, cyclones, airports and events. |
| `image-layers.js`, `gibs-day.js`, `wms-layer.js` | Layers that arrive as finished images. |
| `basemap.js` | The base map's colors, Latin-only names and the place-name ladder. |
| `globe.js`, `globe-layers.js`, `globe-flow.js`, `globe-helpers.js`, `png.js` | The 3D globe: MapLibre's globe view, with every layer above drawn on it. Only the drawing differs; data, timing and status are shared with the flat map. |
| `panel.js`, `timeline.js`, `search.js` | The layer list, the time bar and place search. |
| `forecast.js`, `point-data.js`, `strip.js`, `meteogram.js` | Everything for a clicked point. |
| `schedule.js` | Repeats a task while the tab is visible and retries after failures. Hidden tabs ask for nothing. |

## Data and credits

- NOAA, NWS and NASA data is public domain. Please keep the credit lines and don't make this look like an official site.
- [ECMWF open data](https://www.ecmwf.int/en/forecasts/datasets/open-data) is CC BY 4.0.
- [RainViewer](https://www.rainviewer.com/api.html)'s free API is for personal, educational and small community use, and requires the "Weather data by RainViewer" credit beside its data. It's limited to zoom 7 and 100 requests a minute for each visitor.
- [Open-Meteo](https://open-meteo.com/) data is CC BY 4.0, and its free API is for non-commercial use, under 10,000 calls a day. Keep the "Weather data by Open-Meteo.com" link beside its data.
- [GDACS](https://www.gdacs.org/) cyclone data and [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) airport data are credited on the map while those layers are on.
- The base map is [OpenFreeMap](https://openfreemap.org/) with [OpenMapTiles](https://www.openmaptiles.org/) and [OpenStreetMap](https://www.openstreetmap.org/copyright) data, drawn by [MapLibre GL](https://maplibre.org/) on the globe and through [Leaflet](https://leafletjs.com/) on the flat map. Keep their credits.
- The bundled libraries and font are listed in [vendor/README.md](vendor/README.md).

## License

[MIT](LICENSE) for the code in this repository. The files in `vendor/` keep their own licenses.

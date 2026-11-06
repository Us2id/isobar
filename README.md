# Isobar

A free, open-source live weather map. Animated wind, radar, satellite, lightning and alerts, built on public NOAA data. Click anywhere for a forecast.

**Live site: <https://us2id.github.io/isobar/>**

It's a static site with no server and no database. Each visitor's browser fetches the latest data directly from NOAA and keeps checking while the page is open, so nothing has to be loaded by hand and hosting costs nothing.

## Layers

| Layer | Source | Coverage | Typical age | Checked every |
|---|---|---|---|---|
| Wind flow | [NOAA GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/) forecast, 0.25° thinned to 0.5° | World | Forecast for the current hour | 15 min |
| Radar | [NWS MRMS](https://opengeo.ncep.noaa.gov/geoserver/www/index.html) | US states and territories | About 2–5 min | 2 min |
| Lightning | [NOAA nowCOAST](https://nowcoast.noaa.gov/) strike density | Americas and Pacific | About 15–30 min | 5 min |
| Satellite | NOAA nowCOAST infrared: GOES, plus an hourly world mosaic | World | GOES about 10 min, mosaic up to a few hours | 5 min |
| Alerts | NOAA nowCOAST map, plus [api.weather.gov](https://www.weather.gov/documentation/services-web-api) for storm warnings | US | About 2 min | 5 min for the map, 1 min for storm warnings |

Clicking the map shows the next 48 hours and 7 days from the National Weather Service inside the US, and from [Open-Meteo](https://open-meteo.com/) elsewhere or when NWS is down, along with any active alerts for that spot.

The wind lines follow the forecast and are sped up so you can see them. They don't show the air moving live.

**Isobar is not an official source.** Data can be late or missing. For warnings you can act on, use [weather.gov](https://www.weather.gov/).

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

They cover the data handling: the GRIB decoder, picking the newest NOAA run, forecast and alert parsing, fallbacks, scheduling and the chart's layout. Drawing on the map isn't covered, so check that in a browser after changing it.

## Publish it on GitHub Pages

1. Push this folder to a public GitHub repository.
2. In the repository, open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`.

The site appears at `https://<your-username>.github.io/<repository>/`. Every later push to `main` updates it. Weather data goes straight from NOAA to each visitor, so it doesn't count toward GitHub's limits.

## How it's organized

There's no framework and no build step. What's in `js/` is exactly what the browser runs.

| File | What it does |
|---|---|
| `config.js` | Every data source, refresh interval and color. Start here to change a layer. |
| `main.js` | Connects the map, layers, controls and forecast strip. |
| `wms-layer.js` | Image layers from NOAA's map services. Only reloads when a newer image exists, and swaps it in without a blink. |
| `alerts-layer.js` | The alert map plus directly fetched storm warnings. |
| `wind-layer.js`, `wind-worker.js` | Downloads wind off the main thread and draws it with leaflet-velocity. |
| `grib2.js`, `wind-grid.js` | Reads NOAA's GRIB2 files in the browser. Only the two wind fields are downloaded, about 1.9 MB, using HTTP range requests. |
| `forecast.js` | NWS and Open-Meteo forecasts and alerts, all in one shape. |
| `strip.js`, `meteogram.js` | The forecast strip and its chart. |
| `schedule.js` | Repeats a task while the tab is visible and retries after failures. Hidden tabs ask for nothing. |

## Data and credits

- NOAA and NWS data is public domain. Please keep the credit line and don't make it look like an official NOAA site.
- [Open-Meteo](https://open-meteo.com/) data is CC BY 4.0, and its free API is for non-commercial use, under 10,000 calls a day. Keep the "Weather data by Open-Meteo.com" link beside its data.
- The base map is [OpenFreeMap](https://openfreemap.org/) with [OpenMapTiles](https://www.openmaptiles.org/) and [OpenStreetMap](https://www.openstreetmap.org/copyright) data. Keep their credits.
- The bundled libraries and font are listed in [vendor/README.md](vendor/README.md).

## License

[MIT](LICENSE) for the code in this repository. The files in `vendor/` keep their own licenses.

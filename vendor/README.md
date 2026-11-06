# Third-party files

These are unmodified copies from npm, kept in the repo so the site has no build step and doesn't depend on a CDN. Each folder keeps its license.

| Folder | Package | Version | License |
|---|---|---|---|
| `leaflet` | [leaflet](https://leafletjs.com) | 1.9.4 | BSD-2-Clause |
| `maplibre-gl` | [maplibre-gl](https://maplibre.org) | 5.24.0 | BSD-3-Clause |
| `maplibre-gl-leaflet` | [@maplibre/maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) | 0.1.4 | ISC |
| `leaflet-velocity` | [leaflet-velocity](https://github.com/onaci/leaflet-velocity) | 2.1.4 | CSIRO BSD/MIT-style, see its `LICENSE.md` |
| `fonts` | [@fontsource/b612](https://fontsource.org/fonts/b612) | 5.3.0 | SIL Open Font License 1.1 |

MapLibre stays on version 5 because version 6 no longer ships the single browser script that `maplibre-gl-leaflet` needs.

`js/wind-layer.js` reaches into two private parts of `leaflet-velocity` 2.1.4 to fix a memory leak and set the trail length. Check those when upgrading it.

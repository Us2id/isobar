# Third-party files

These are copies from npm, kept in the repo so the site has no build step and doesn't depend on a CDN. Each folder keeps its license. Only `jpx` is modified, as described below.

| Folder | Package | Version | License |
|---|---|---|---|
| `leaflet` | [leaflet](https://leafletjs.com) | 1.9.4 | BSD-2-Clause |
| `maplibre-gl` | [maplibre-gl](https://maplibre.org) | 5.24.0 | BSD-3-Clause |
| `maplibre-gl-leaflet` | [@maplibre/maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) | 0.1.4 | ISC |
| `leaflet-velocity` | [leaflet-velocity](https://github.com/onaci/leaflet-velocity) | 2.1.4 | CSIRO BSD/MIT-style, see its `LICENSE.md` |
| `fonts` | [@fontsource/b612](https://fontsource.org/fonts/b612) | 5.3.0 | SIL Open Font License 1.1 |
| `jpx` | [jpeg2000](https://www.npmjs.com/package/jpeg2000), from Mozilla's pdf.js | 1.1.1 | Apache-2.0, modified |

MapLibre stays on version 5 because version 6 no longer ships the single browser script that `maplibre-gl-leaflet` needs.

`js/flow-layer.js` reaches into two private parts of `leaflet-velocity` 2.1.4 to fix a memory leak and set the trail length. Check those when upgrading it.

`jpx` reads the JPEG 2000 data inside NOAA's wave and ocean files. Its files were changed in three ways: they became ES modules, the Node helpers came out, and it now returns full-precision `Int32Array` values, because GRIB data needs more than the 8 bits an image does. An OpenJPEG WebAssembly build was tried first and rejected: its wrapper cuts the image width to 16 bits, which breaks on grids of more than 65,535 values packed as one row.

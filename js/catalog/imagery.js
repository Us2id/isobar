// Map layers that arrive as finished images from NASA and NOAA. These can't be read value by
// value, but they cover things no forecast file has. Add one by adding a line here.
export const IMAGERY = [];

const LAND_ONLY = [[-60, -180], [85, 180]];
// `timeless` is for maps that don't change day to day, like elevation. `bounds` keeps a layer from
// asking for tiles where it has no data, which can come back as garbage.
const nasa = (id, group, name, about, level, { ext = 'png', legend = null, timeless = false, bounds } = {}) => {
  IMAGERY.push({ kind: 'gibs', id: `nasa-${id}`, layer: id, group, name, about, level, ext, legend, timeless, bounds, source: 'NASA GIBS' });
};
// `minZoom` is for services that draw nothing when zoomed further out. `clearWhite` hides the
// plain white some services use for "nothing to report".
const noaa = (id, group, name, about, service, show, { image = false, minZoom = 0, clearWhite = false } = {}) => {
  IMAGERY.push({ kind: 'arcgis', id, group, name, about, service, show, image, minZoom, clearWhite, source: 'NOAA/NWS' });
};
const nowcoastWms = (id, group, name, about, service, layer, stale) => {
  IMAGERY.push({ kind: 'wms', id, group, name, about, service, layer, stale, source: 'NOAA nowCOAST' });
};
const radarProduct = (id, group, name, about, suffix) => {
  IMAGERY.push({ kind: 'radarProduct', id, group, name, about, suffix, source: 'NOAA/NWS' });
};

// ---- Satellite views ----
const V = 'views';
nowcoastWms('sat-visible', V, 'Visible satellite (North America)', 'Sunlit cloud as a camera would see it. Black at night. Updates about every 5 minutes.', 'observations/satellite', 'goes_visible_imagery', 40);
nowcoastWms('sat-shortwave', V, 'Shortwave infrared (North America)', 'Picks out fog and low cloud at night, and hot spots from fires.', 'observations/satellite', 'goes_shortwave_imagery', 40);
nowcoastWms('sat-vapor', V, 'Water vapor satellite (North America)', 'Moisture in the upper air, including where there is no cloud.', 'observations/satellite', 'goes_water_vapor_imagery', 40);
nowcoastWms('sat-snowice', V, 'Snow and ice satellite (North America)', 'Tells snow and ice apart from cloud.', 'observations/satellite', 'goes_snow_ice_imagery', 40);
nowcoastWms('sat-vapor-world', V, 'Water vapor satellite (world)', 'Worldwide moisture picture, updated hourly.', 'observations/satellite', 'global_water_vapor_imagery_mosaic', 360);
nowcoastWms('sat-visible-world', V, 'Visible satellite (world)', 'Worldwide cloud in visible light, updated hourly. Dark where it is night.', 'observations/satellite', 'global_visible_imagery_mosaic', 360);
nasa('GOES-East_ABI_GeoColor', V, 'True color, Americas (GOES East)', 'Color image of the eastern Americas and Atlantic, updated through the day.', 7);
nasa('GOES-West_ABI_GeoColor', V, 'True color, Pacific (GOES West)', 'Color image of the western Americas and Pacific, updated through the day.', 7);
nasa('MODIS_Aqua_CorrectedReflectance_TrueColor', V, 'True color, world (Aqua)', 'A photo-like view of Earth from the last full day. Thin gaps between orbits are normal.', 9, { ext: 'jpg' });
nasa('MODIS_Terra_CorrectedReflectance_TrueColor', V, 'True color, world (Terra)', 'A second daily photo-like view, taken in the morning.', 9, { ext: 'jpg' });
nasa('VIIRS_NOAA20_CorrectedReflectance_TrueColor', V, 'True color, world (NOAA-20)', 'A sharper daily photo-like view.', 9, { ext: 'jpg' });
nasa('VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance', V, 'Earth at night', 'City lights, fires and moonlit cloud from a recent night.', 8, { legend: 'VIIRS_DayNightBand_At_Sensor_Radiance_H.svg' });
nasa('GOES-East_ABI_Air_Mass', V, 'Air masses, Americas', 'False color showing warm, cold and dry air. Red marks dry air sinking from high up.', 6);
nasa('GOES-West_ABI_Air_Mass', V, 'Air masses, Pacific', 'False color showing warm, cold and dry air.', 6);
nasa('Himawari_AHI_Air_Mass', V, 'Air masses, Asia and Australia', 'False color showing warm, cold and dry air, from Himawari.', 6);
nasa('GOES-East_ABI_Dust', V, 'Dust, Americas', 'False color that makes airborne dust stand out in pink.', 7);
nasa('GOES-West_ABI_Dust', V, 'Dust, Pacific', 'False color that makes airborne dust stand out in pink.', 7);
nasa('GOES-East_ABI_FireTemp', V, 'Fire temperature, Americas', 'False color that shows active fires as bright spots.', 7);
nasa('GOES-West_ABI_FireTemp', V, 'Fire temperature, Pacific', 'False color that shows active fires as bright spots.', 7);

// ---- Temperature ----
const T = 'temperature';
nasa('MODIS_Aqua_Land_Surface_Temp_Day', T, 'Land surface temperature, day (NASA)', 'How hot the ground measured from orbit. Cloud leaves gaps.', 7, { legend: 'MODIS_Land_Surface_Temp_H.svg' });
nasa('MODIS_Aqua_Land_Surface_Temp_Night', T, 'Land surface temperature, night (NASA)', 'How cool the ground measured from orbit at night.', 7, { legend: 'MODIS_Land_Surface_Temp_H.svg' });
nasa('AIRS_L2_Surface_Air_Temperature_Day', T, 'Surface air temperature (NASA AIRS)', 'Air temperature measured by satellite rather than a model.', 6, { legend: 'AIRS_Temperature_H.svg' });

// ---- Rain and snow ----
const R = 'rain';
nasa('IMERG_Precipitation_Rate_30min', R, 'Observed rain, world (NASA IMERG)', 'Rain measured by a fleet of satellites, averaged over 30 minutes. A few hours behind.', 6, { legend: 'GPM_Precipitation_Rate_H.svg' });
nasa('IMERG_Precipitation_Rate', R, 'Observed rain, daily (NASA IMERG)', 'A longer-delay, more careful version of the same rain estimate.', 6, { legend: 'GPM_Precipitation_Rate_H.svg' });
nasa('MODIS_Aqua_NDSI_Snow_Cover', R, 'Snow on the ground (NASA)', 'Where satellites saw snow on the last full day. Cloud leaves gaps.', 8, { legend: 'MODIS_NDSI_Snow_Cover_H.svg' });
nasa('SMAP_L4_Snow_Mass', R, 'Snow mass (NASA SMAP)', 'Water held in snow, from a satellite-guided model.', 6, { legend: 'SMAP_Snow_Mass_H.svg' });
radarProduct('radar-type', R, 'Rain or snow on radar (US)', 'What radar sees falling right now: rain, snow, hail or a mix.', 'pcpn_typ');
radarProduct('radar-composite', R, 'Composite radar (US)', 'The strongest echo at any height, which can catch storms the base scan misses.', 'cref_qcd');
radarProduct('radar-tops', R, 'Storm tops on radar (US)', 'How high storm echoes reach. Taller usually means stronger.', 'neet_v18');
for (const [id, name, layer] of [['1', 'last hour', 8], ['6', 'last 6 hours', 20], ['24', 'last 24 hours', 28], ['72', 'last 3 days', 40]]) {
  noaa(`qpe-${id}`, R, `Observed rain, ${name} (US)`, `Rain measured by radar and gauges over the ${name}. Gray means a region hasn't reported yet.`, 'raster/rest/services/obs/rfc_qpe/MapServer', [layer]);
}
noaa('precip-anomaly', R, 'Rain vs normal, next week (world)', 'Forecast rain compared with what is normal for the time of year.', 'raster/rest/services/climate/cpc_gfs_precip_anom/MapServer', [3], { clearWhite: true });

// ---- Clouds ----
const C = 'clouds';
nasa('MODIS_Aqua_Cloud_Fraction_Day', C, 'Cloud fraction (NASA)', 'Cloud cover measured from orbit, by day.', 6, { legend: 'MODIS_Cloud_Fraction_H.svg' });
nasa('MODIS_Aqua_Cloud_Top_Height_Day', C, 'Cloud top height (NASA)', 'How high cloud tops reach, measured from orbit.', 6, { legend: 'MODIS_VIIRS_Cloud_Top_Height_H.svg' });
nasa('MODIS_Aqua_Cloud_Top_Temp_Day', C, 'Cloud top temperature (NASA)', 'How cold cloud tops are, measured from orbit.', 6, { legend: 'MODIS_Cloud_Top_Temp_H.svg' });

// ---- Humidity ----
const H = 'humidity';
nasa('AIRS_L2_Surface_Relative_Humidity_Day', H, 'Surface humidity (NASA AIRS)', 'Relative humidity measured by satellite rather than a model.', 6, { legend: 'AIRS_RelativeHumidity_H.svg' });
nasa('MODIS_Aqua_Water_Vapor_5km_Day', H, 'Water vapor (NASA)', 'Water vapor in the air column, measured from orbit.', 6, { legend: 'MODIS_Water_Vapor_H.svg' });

// ---- Soil and farming ----
const F = 'farming';
nasa('SMAP_L4_Analyzed_Surface_Soil_Moisture', F, 'Surface soil moisture (NASA SMAP)', 'Top 5 cm, from a satellite that senses soil water directly, a few days behind.', 6, { legend: 'SMAP_Analyzed_Soil_Moisture_H.svg' });
nasa('SMAP_L4_Analyzed_Root_Zone_Soil_Moisture', F, 'Root zone soil moisture (NASA SMAP)', 'Top 1 m, where most crop roots are.', 6, { legend: 'SMAP_Analyzed_Soil_Moisture_H.svg' });
nasa('SMAP_L3_Passive_Day_Soil_Moisture', F, 'Measured soil moisture (NASA SMAP)', 'Direct satellite measurement with no model, so orbit gaps show.', 6, { legend: 'SMAP_Soil_Moisture_H.svg' });
nasa('SMAP_L4_Soil_Temperature_Layer_1', F, 'Surface soil temperature (NASA SMAP)', 'Soil temperature from a satellite-guided model.', 6, { legend: 'SMAP_Soil_Temperature_Layer_H.svg' });
nasa('SMAP_L3_Passive_Day_Freeze_Thaw', F, 'Frozen or thawed ground (NASA SMAP)', 'Whether the ground surface is frozen.', 6, { legend: 'SMAP_Freeze_Thaw_H.svg' });
nasa('MERRA2_Evaporation_Land_Monthly', F, 'Evapotranspiration, monthly (NASA)', 'Average water lost from land last month, from NASA\'s MERRA-2 reanalysis.', 6, { legend: 'MERRA2_Evaporation_Land_Monthly_H.svg' });
nasa('MERRA2_Soil_Water_Root_Zone_Monthly', F, 'Root zone water, monthly (NASA)', 'Average root zone water last month, from NASA\'s MERRA-2 reanalysis.', 6, { legend: 'MERRA2_Soil_Water_Root_Zone_Monthly_H.svg' });
nasa('GLDAS_Underground_Soil_Moisture_Monthly', F, 'Soil moisture, monthly (NASA GLDAS)', 'Average topsoil moisture from NASA\'s global land model.', 6, { legend: 'GLDAS_Underground_Soil_Moisture_Monthly_H.svg' });
nasa('VIIRS_SNPP_L3_NDVI_16Day', F, 'Greenness (NDVI)', 'How green and healthy plants look from orbit, over 16 days.', 8, { legend: 'MODIS_L3_NDVI_H.svg' });
nasa('MODIS_Aqua_L3_EVI_16Day', F, 'Vegetation index (EVI)', 'A second greenness measure that works better in dense forest.', 9, { legend: 'MODIS_L3_EVI_H.svg' });
nasa('MODIS_Combined_L4_LAI_4Day', F, 'Leaf area index', 'Leaf area per unit of ground, over 4 days.', 8, { bounds: LAND_ONLY, legend: 'MODIS_Leaf_Area_Index_H.svg' });
nasa('MODIS_Combined_L4_FPAR_4Day', F, 'Sunlight used by plants (FPAR)', 'Share of usable sunlight plants absorb, over 4 days.', 8, { bounds: LAND_ONLY, legend: 'MODIS_FPAR_H.svg' });
nasa('MODIS_Combined_Flood_2-Day', F, 'Floods from orbit (NASA)', 'Unusual surface water seen over two days. Gray means too little clear view, and cloud shadows can cause false marks.', 9, { legend: 'MODIS_Flood_H.svg' });
noaa('nwm-soil', F, 'Soil moisture, 1 km (US)', 'National Water Model near-surface soil saturation.', 'raster/rest/services/obs/NWM_Land_Analysis/MapServer', [3, 7, 11, 15], { minZoom: 4 });
noaa('snow-depth-us', F, 'Snow depth analysis (US)', 'NOAA NOHRSC snow depth.', 'raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer', [3], { minZoom: 4 });
noaa('snow-water-us', F, 'Snow water analysis (US)', 'NOAA NOHRSC water held in snow.', 'raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer', [7], { minZoom: 4 });

// ---- Sun and energy ----
const E = 'sun';
nasa('OMI_UV_Index', E, 'UV index (NASA OMI)', 'Sunburn strength at local noon, measured from orbit.', 6, { legend: 'OMI_UV_Index_H.svg' });
nasa('OMPS_Ozone_Total_Column', E, 'Ozone layer (NASA OMPS)', 'Total ozone measured from orbit.', 6, { legend: 'OMPS_Ozone_Total_Column_H.svg' });
nasa('MODIS_Combined_L3_White_Sky_Albedo_Daily', E, 'Ground brightness (NASA)', 'How much sunlight the land reflects, measured from orbit.', 8, { legend: 'MODIS_Combined_Albedo_Daily_H.svg' });

// ---- Air quality ----
const A = 'air';
nasa('OMI_Nitrogen_Dioxide_Tropo_Column', A, 'Nitrogen dioxide, world (NASA OMI)', 'NO2 from traffic, power plants and industry, measured from orbit, a few days behind.', 6, { legend: 'OMI_Nitrogen_Dioxide_Tropo_Column_H.svg' });
nasa('OMI_SO2_Planetary_Boundary_Layer', A, 'Sulfur dioxide (NASA OMI)', 'SO2 near the ground from volcanoes and power plants.', 6, { legend: 'OMI_SO2_Planetary_Boundary_Layer_H.svg' });
nasa('AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day', A, 'Carbon monoxide (NASA AIRS)', 'CO in the mid-atmosphere, from fires and fuel burning.', 6, { legend: 'AIRS_Carbon_Monoxide_Volume_Mixing_Ratio_H.svg' });
nasa('MODIS_Combined_Value_Added_AOD', A, 'Haze measured from orbit (NASA)', 'Aerosol optical depth combined from two satellites.', 6, { legend: 'MODIS_Combined_Value_Added_AOD_H.svg' });
nasa('OMPS_Aerosol_Index', A, 'Smoke and dust index (NASA OMPS)', 'Highlights smoke and dust plumes, even over cloud.', 6, { legend: 'OMPS_Aerosol_Index_H.svg' });
nasa('MERRA2_Dust_Surface_Mass_Concentration_PM25_Monthly', A, 'Dust PM2.5, monthly (NASA)', 'Average dust near the ground last month, from NASA\'s MERRA-2 reanalysis.', 6, { legend: 'MERRA2_Dust_Surface_Mass_Concentration_PM25_Monthly_H.svg' });
for (const [id, name, service, about] of [
  ['us-ozone', 'Ozone forecast (US)', 'ndgd_ozone_1hr_avg_time_bc', 'NOAA air quality model, 1-hour average ground-level ozone.'],
  ['us-pm25', 'PM2.5 forecast (US)', 'ndgd_apm25_hr01_bc', 'NOAA air quality model, hourly fine particles.'],
  ['us-smoke', 'Smoke forecast (US)', 'ndgd_smoke_sfc_1hr_avg_time', 'NOAA smoke model, near the ground.'],
  ['us-dust', 'Dust forecast (US)', 'ndgd_dust_sfc_time', 'NOAA dust model, near the ground.'],
]) {
  noaa(id, A, name, about, `raster/rest/services/air_quality/${service}/ImageServer`, null, { image: true });
}

// ---- Ocean ----
const O = 'ocean';
nasa('GHRSST_L4_MUR_Sea_Surface_Temperature', O, 'Sea surface temperature, 1 km (NASA MUR)', 'High-resolution blend of satellites and buoys, a day behind.', 7, { legend: 'GHRSST_Sea_Surface_Temperature_H.svg' });
nasa('GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', O, 'Sea temperature vs normal (NASA)', 'How much warmer or cooler the sea is than normal.', 7, { legend: 'GHRSST_Sea_Surface_Temperature_Anomalies_H.svg' });
nasa('SMAP_L3_Sea_Surface_Salinity_CAP_Monthly', O, 'Salinity, monthly (NASA SMAP)', 'Sea surface saltiness measured from orbit.', 6, { legend: 'SMAP_Sea_Surface_Salinity_H.svg' });
nasa('GHRSST_L4_MUR_Sea_Ice_Concentration', O, 'Sea ice, measured (NASA)', 'Ice cover measured from orbit, a day behind.', 7, { legend: 'GHRSST_Sea_Ice_Concentration_H.svg' });
nasa('MODIS_Aqua_L2_Chlorophyll_A', O, 'Chlorophyll (NASA)', 'Green ocean plants. Blooms show up here.', 7, { legend: 'MODIS_Chlorophyll_H.svg' });

// ---- US forecasts and outlooks ----
const U = 'us';
const OUTLOOKS = 'vector/rest/services/outlooks';
for (const [day, layer] of [[1, 1], [2, 9], [3, 17]]) {
  noaa(`spc-day${day}`, U, `Severe storm outlook, day ${day}`, 'Storm Prediction Center risk categories, from marginal to high.', `${OUTLOOKS}/SPC_wx_outlks/MapServer`, [layer]);
}
noaa('spc-tornado', U, 'Tornado risk, today', 'Storm Prediction Center chance of a tornado nearby.', `${OUTLOOKS}/SPC_wx_outlks/MapServer`, [3]);
noaa('spc-hail', U, 'Large hail risk, today', 'Storm Prediction Center chance of large hail nearby.', `${OUTLOOKS}/SPC_wx_outlks/MapServer`, [5]);
noaa('spc-wind', U, 'Damaging wind risk, today', 'Storm Prediction Center chance of damaging wind nearby.', `${OUTLOOKS}/SPC_wx_outlks/MapServer`, [7]);
noaa('fire-day1', U, 'Fire weather outlook, today', 'Storm Prediction Center critical fire weather areas.', 'vector/rest/services/fire_weather/SPC_firewx/MapServer', [1]);
noaa('fire-day2', U, 'Fire weather outlook, tomorrow', 'Storm Prediction Center critical fire weather areas.', 'vector/rest/services/fire_weather/SPC_firewx/MapServer', [4]);
noaa('qpf-day1', U, 'Official rain forecast, day 1', 'Weather Prediction Center rain totals.', 'vector/rest/services/precip/wpc_qpf/MapServer', [1]);
noaa('qpf-3day', U, 'Official rain forecast, 3 days', 'Weather Prediction Center rain totals.', 'vector/rest/services/precip/wpc_qpf/MapServer', [9]);
noaa('qpf-7day', U, 'Official rain forecast, 7 days', 'Weather Prediction Center rain totals.', 'vector/rest/services/precip/wpc_qpf/MapServer', [11]);
noaa('excessive-rain', U, 'Flash flood rain risk, today', 'Weather Prediction Center excessive rainfall outlook.', 'vector/rest/services/hazards/wpc_precip_hazards/MapServer', [0]);
noaa('excessive-rain-2', U, 'Flash flood rain risk, tomorrow', 'Weather Prediction Center excessive rainfall outlook.', 'vector/rest/services/hazards/wpc_precip_hazards/MapServer', [1]);
noaa('winter-impact', U, 'Winter storm impact, today', 'Weather Prediction Center winter storm severity index.', `${OUTLOOKS}/wpc_wssi/MapServer`, [1]);
noaa('winter-impact-3', U, 'Winter storm impact, 3 days', 'Weather Prediction Center winter storm severity index.', `${OUTLOOKS}/wpc_wssi/MapServer`, [4]);
noaa('snow-4in', U, 'Chance of 4 inches of snow, today', 'Weather Prediction Center probability.', 'vector/rest/services/precip/wpc_prob_winter_precip/MapServer', [1]);
noaa('temp-6-10', U, 'Temperature outlook, 6 to 10 days', 'Climate Prediction Center odds of warmer or cooler than normal.', `${OUTLOOKS}/cpc_6_10_day_outlk/MapServer`, [0]);
noaa('rain-6-10', U, 'Rain outlook, 6 to 10 days', 'Climate Prediction Center odds of wetter or drier than normal.', `${OUTLOOKS}/cpc_6_10_day_outlk/MapServer`, [1]);
noaa('temp-8-14', U, 'Temperature outlook, 8 to 14 days', 'Climate Prediction Center odds of warmer or cooler than normal.', `${OUTLOOKS}/cpc_8_14_day_outlk/MapServer`, [0]);
noaa('rain-8-14', U, 'Rain outlook, 8 to 14 days', 'Climate Prediction Center odds of wetter or drier than normal.', `${OUTLOOKS}/cpc_8_14_day_outlk/MapServer`, [1]);
noaa('temp-month', U, 'Temperature outlook, next month', 'Climate Prediction Center monthly outlook.', `${OUTLOOKS}/cpc_mthly_temp_outlk/MapServer`, null);
noaa('rain-month', U, 'Rain outlook, next month', 'Climate Prediction Center monthly outlook.', `${OUTLOOKS}/cpc_mthly_precip_outlk/MapServer`, null);
noaa('temp-season', U, 'Temperature outlook, next season', 'Climate Prediction Center seasonal outlook.', `${OUTLOOKS}/cpc_sea_temp_outlk/MapServer`, null);
noaa('rain-season', U, 'Rain outlook, next season', 'Climate Prediction Center seasonal outlook.', `${OUTLOOKS}/cpc_sea_precip_outlk/MapServer`, null);
noaa('drought-month', U, 'Drought outlook, next month', 'Climate Prediction Center monthly drought outlook.', `${OUTLOOKS}/cpc_drought_outlk/MapServer`, [1]);
noaa('drought-season', U, 'Drought outlook, next season', 'Climate Prediction Center seasonal drought outlook.', `${OUTLOOKS}/cpc_drought_outlk/MapServer`, [4]);
noaa('hazards-temp', U, 'Heat and cold hazards, 3 to 7 days', 'Climate Prediction Center weather hazards outlook.', 'vector/rest/services/hazards/cpc_weather_hazards/MapServer', [1]);
noaa('hazards-rain', U, 'Heavy rain and snow hazards, 3 to 7 days', 'Climate Prediction Center weather hazards outlook.', 'vector/rest/services/hazards/cpc_weather_hazards/MapServer', [4]);
noaa('river-flood', U, 'River flood outlook', 'Areas with significant river flooding expected in the next 5 days.', `${OUTLOOKS}/sig_riv_fld_outlk/MapServer`, [0], { minZoom: 4 });
noaa('streamflow', U, 'Streamflow now', 'National Water Model flow in streams. Zoom in for smaller rivers.', 'vector/rest/services/obs/NWM_Stream_Analysis/MapServer', [1, 2, 3, 4, 5]);
noaa('flood-guidance', U, 'Rain needed to flood, 1 hour', 'River Forecast Center flash flood guidance. Low numbers flood easily.', 'raster/rest/services/precip/rfc_gridded_ffg/MapServer', [3]);
noaa('storm-reports', U, 'Storm reports, last 24 hours', 'Tornado, hail and wind damage reported to the National Weather Service.', 'vector/rest/services/obs/nws_local_storm_reports/MapServer', [0]);
noaa('forecast-chart', U, 'National forecast chart, today', 'Weather Prediction Center fronts, rain and snow areas, and highs and lows.', `${OUTLOOKS}/natl_fcst_wx_chart/MapServer`, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

// ---- Land and people ----
const L = 'land';
nasa('BlueMarble_ShadedRelief_Bathymetry', L, 'Blue Marble', 'NASA\'s cloud-free Earth, with mountains and sea floor.', 8, { ext: 'jpg' });
nasa('SRTM_Color_Index', L, 'Elevation', 'Height of the land, from a space shuttle radar survey.', 12, { legend: 'SRTM_Color_Index_H.svg', timeless: true });
nasa('GPW_Population_Density_2020', L, 'Population density', 'Where people live, from NASA SEDAC (2020).', 7, { legend: 'GPW_Population_Density_2020_H.svg', timeless: true });

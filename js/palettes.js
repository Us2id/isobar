// Color ramps. Each stop is [value, color] or [value, color, opacity], in the layer's own units.
// `labels` picks which stops are named on the legend; by default it's the ends and the middle.
const clear = (value, color) => [value, color, 0];

const TEMP_STOPS = [[-50, '#2c0f63'], [-30, '#3b3bd1'], [-15, '#2f86e6'], [0, '#7fdcf0'], [10, '#8fe39a'], [20, '#f3e96b'], [30, '#f7a13b'], [40, '#e0342b'], [50, '#7a0e2a']];
const SPEED_STOPS = [[0, '#20345c'], [3, '#2f6fb8'], [6, '#2fb0a8'], [10, '#7fd35a'], [15, '#f0e04a'], [20, '#f7963b'], [30, '#e0342b'], [45, '#a01f7a'], [70, '#f5e6f0']];
const HEIGHT_STOPS = (low, mid, high) => [[low, '#5a1f8a'], [(low + mid) / 2, '#2f5fd0'], [mid, '#4fc3e0'], [(mid + high) / 2, '#f3e96b'], [high, '#e0542b']];

export const RAMPS = {
  temp: { stops: TEMP_STOPS },
  tempUpper: { stops: [[-75, '#2c0f63'], [-55, '#3b3bd1'], [-35, '#2f86e6'], [-15, '#7fdcf0'], [0, '#8fe39a'], [10, '#f3e96b'], [20, '#f7a13b'], [30, '#e0342b']] },
  soilTemp: { stops: [[-30, '#3b3bd1'], [-10, '#2f86e6'], [0, '#7fdcf0'], [8, '#8fe39a'], [15, '#d7e36b'], [25, '#f7a13b'], [35, '#e0342b'], [45, '#7a0e2a']] },
  sst: { stops: [[-2, '#3b3bd1'], [5, '#2f86e6'], [12, '#3fc4d0'], [18, '#8fe39a'], [24, '#f3e96b'], [28, '#f7a13b'], [31, '#e0342b'], [35, '#7a0e2a']] },
  freezing: { stops: [[0, '#2f5fd0'], [1000, '#4fc3e0'], [2500, '#8fe39a'], [4000, '#f3e96b'], [5500, '#f7963b']] },
  rate: { stops: [clear(0.05, '#7fc8ff'), [0.3, '#7fc8ff', 0.8], [1, '#2f86e6'], [3, '#1f5fd0'], [6, '#3a2fb8'], [12, '#a12fb8'], [25, '#e0342b'], [50, '#ffd84a']] },
  total: { stops: [clear(0.2, '#a7d8f5'), [1, '#a7d8f5', 0.8], [5, '#55aee8'], [10, '#2f7fd6'], [25, '#2f4fc8'], [50, '#7a2fc0'], [100, '#d02f8a'], [200, '#e0342b'], [400, '#ffd84a']] },
  ptype: { discrete: true, stops: [clear(0, '#000000'), [1, '#3fae5a'], [2, '#6aa8ff'], [3, '#ff5f9e'], [4, '#ffb347']] },
  frozen: { stops: [clear(0, '#3fae5a'), [1, '#3fae5a', 0.6], [50, '#b98cff'], [100, '#6aa8ff']] },
  radar: { stops: [clear(5, '#6d7dab'), [10, '#6d7dab', 0.7], [20, '#5cb5c6'], [30, '#15d622'], [40, '#b5ba03'], [45, '#ffdd00'], [50, '#ff9000'], [55, '#ff2a00'], [60, '#b00020'], [70, '#ff00ff']] },
  thunder: { stops: [clear(34, '#ffdd00'), [36, '#ffdd00'], [45, '#ff9000'], [50, '#ff2a00'], [55, '#b00020'], [65, '#ff00ff']] },
  pwat: { stops: [[0, '#8a5a2b'], [10, '#d9c27a'], [25, '#8fe39a'], [40, '#3fa7c4'], [55, '#2f5fd0'], [70, '#7a2fc0']] },
  snow: { stops: [clear(0.5, '#cfe6ff'), [1, '#cfe6ff', 0.7], [10, '#8fbcf7'], [30, '#5a7fe0'], [100, '#7a3fc0'], [300, '#d07ac0'], [1000, '#ffffff']] },
  snowwater: { stops: [clear(0.5, '#cfe6ff'), [2, '#cfe6ff', 0.7], [20, '#8fbcf7'], [60, '#5a7fe0'], [200, '#7a3fc0'], [500, '#ffffff']] },
  speed: { stops: SPEED_STOPS },
  speedUpper: { stops: [[0, '#20345c'], [10, '#2f6fb8'], [20, '#2fb0a8'], [30, '#7fd35a'], [45, '#f0e04a'], [60, '#f7963b'], [80, '#e0342b'], [100, '#a01f7a'], [130, '#f5e6f0']] },
  windpower: { stops: [clear(10, '#2f6fb8'), [50, '#2f6fb8', 0.8], [200, '#2fb0a8'], [500, '#7fd35a'], [1000, '#f0e04a'], [2000, '#f7963b'], [4000, '#e0342b']] },
  vvel: { stops: [[-2, '#2f5fd0'], [-0.5, '#4fc3e0'], [-0.1, '#d9edf5', 0.3], clear(0, '#ffffff'), [0.1, '#f7e0c8', 0.3], [0.5, '#f7a13b'], [2, '#e0342b']], labels: [-2, 0, 2] },
  vort: { stops: [[-40, '#2f5fd0'], [-10, '#9fd3f0', 0.6], clear(0, '#ffffff'), [10, '#f7d08a', 0.6], [25, '#f7963b'], [50, '#e0342b']], labels: [-40, 0, 50] },
  shear: { stops: [clear(0, '#2f6fb8'), [0.002, '#2f6fb8', 0.7], [0.006, '#2fb0a8'], [0.012, '#f0e04a'], [0.02, '#f7963b'], [0.03, '#e0342b']] },
  ventilation: { stops: [[0, '#7a0e2a'], [2000, '#e0342b'], [6000, '#f7a13b'], [15000, '#f3e96b'], [40000, '#8fe39a'], [100000, '#2fb0a8']] },
  cloud: { stops: [clear(5, '#ffffff'), [30, '#ffffff', 0.3], [60, '#e6edf3', 0.6], [85, '#e6edf3', 0.85], [100, '#f5f8fa', 0.95]] },
  visibility: { stops: [[0, '#b00020'], [1, '#f7963b'], [5, '#f3e96b'], [10, '#8fe39a'], [15, '#2f6fb8', 0.5], clear(24, '#2f6fb8')] },
  ceiling: { stops: [[0, '#b00020'], [300, '#f7963b'], [1000, '#f3e96b'], [3000, '#8fe39a'], [8000, '#4fc3e0'], [15000, '#2f6fb8', 0.5]] },
  cloudwater: { stops: [clear(0.01, '#ffffff'), [0.1, '#ffffff', 0.4], [0.5, '#c9dcec', 0.7], [1.5, '#8fbcf7'], [4, '#5a7fe0']] },
  humidity: { stops: [[0, '#8a5a2b'], [25, '#c9a35a'], [50, '#e6e08a'], [70, '#7fd18a'], [85, '#3fa7c4'], [100, '#1f4fa8']] },
  specific: { stops: [[0, '#2c2a5e'], [3, '#2f6fb8'], [7, '#2fb0a8'], [12, '#7fd35a'], [18, '#f0e04a'], [25, '#f7963b']] },
  vpd: { stops: [[0, '#2f6fb8'], [0.5, '#2fb0a8'], [1, '#8fe39a'], [2, '#f3e96b'], [3.5, '#f7963b'], [6, '#e0342b']] },
  pressure: { stops: [[960, '#5a1f8a'], [980, '#2f5fd0'], [1000, '#4fc3e0'], [1013, '#e8f2e0'], [1025, '#f7c35a'], [1040, '#e0542b']], labels: [960, 1013, 1040] },
  surfacePressure: { stops: [[500, '#5a3f2a'], [700, '#8a6a3a'], [850, '#b8a060'], [950, '#7fc08a'], [1013, '#3fa7c4'], [1040, '#2f5fd0']] },
  height850: { stops: HEIGHT_STOPS(1200, 1450, 1650) },
  height700: { stops: HEIGHT_STOPS(2700, 3000, 3250) },
  height500: { stops: HEIGHT_STOPS(4800, 5500, 6000) },
  height300: { stops: HEIGHT_STOPS(8200, 9200, 10000) },
  tropopause: { stops: [[6000, '#5a1f8a'], [9000, '#2f5fd0'], [12000, '#4fc3e0'], [15000, '#f3e96b'], [18000, '#e0542b']] },
  cape: { stops: [clear(50, '#7fd35a'), [150, '#7fd35a', 0.7], [500, '#f0e04a'], [1000, '#f7963b'], [2000, '#e0342b'], [3500, '#a01f7a'], [6000, '#f5e6f0']] },
  cin: { stops: [[-500, '#5a1f8a'], [-200, '#a12fb8'], [-100, '#e0342b'], [-50, '#f7963b'], [-10, '#f0e04a', 0.5], clear(0, '#f0e04a')] },
  lifted: { stops: [[-12, '#a01f7a'], [-8, '#e0342b'], [-4, '#f7963b'], [-1, '#f0e04a'], [0, '#f0e04a', 0.2], clear(2, '#2f6fb8'), [10, '#2f6fb8', 0.6]], labels: [-12, 0, 10] },
  helicity: { stops: [clear(25, '#7fd35a'), [75, '#7fd35a', 0.7], [150, '#f0e04a'], [300, '#f7963b'], [500, '#e0342b'], [800, '#a01f7a']] },
  haines: { stops: [[2, '#2f6fb8', 0.5], [3, '#2fb0a8'], [4, '#f0e04a'], [5, '#f7963b'], [6, '#e0342b']] },
  soilMoisture: { stops: [[2, '#7a4a20'], [10, '#b98a46'], [20, '#e6d48a'], [30, '#7fd18a'], [40, '#2fb0a8'], [50, '#2f5fd0']] },
  plantWater: { stops: [[0, '#7a2a14'], [25, '#d0813a'], [50, '#e6d48a'], [75, '#7fd18a'], [100, '#2f7fd6']] },
  evap: { stops: [clear(0, '#f3e96b'), [0.2, '#f3e96b', 0.4], [1, '#c9df6a'], [2.5, '#6ec66a'], [4, '#2fb0a8'], [6, '#2f6fb8'], [10, '#5a2fb8'], [16, '#d02f8a']] },
  potentialEvap: { stops: [clear(0, '#f3e96b'), [1, '#f3e96b', 0.5], [3, '#c9df6a'], [6, '#2fb0a8'], [10, '#2f6fb8'], [16, '#5a2fb8'], [30, '#d02f8a']] },
  gdd: { stops: [clear(0, '#8fe39a'), [1, '#8fe39a', 0.5], [5, '#c9df6a'], [10, '#f3e96b'], [15, '#f7a13b'], [20, '#e0342b'], [30, '#7a0e2a']] },
  runoff: { stops: [clear(0.05, '#7fc8ff'), [0.5, '#7fc8ff', 0.7], [2, '#2f86e6'], [5, '#3a2fb8'], [15, '#a12fb8'], [40, '#e0342b']] },
  canopy: { stops: [clear(0.01, '#8fe39a'), [0.1, '#8fe39a', 0.6], [0.3, '#2fb0a8'], [0.6, '#2f6fb8'], [1, '#5a2fb8']] },
  vegetation: { stops: [clear(1, '#c9df6a'), [10, '#c9df6a', 0.6], [30, '#8fc65a'], [60, '#3fa24a'], [90, '#0f6a2e']] },
  solar: { stops: [clear(1, '#3a2a14'), [50, '#7a4a20', 0.6], [200, '#c9862a'], [400, '#f0b83a'], [700, '#ffe46a'], [1000, '#fff8d0']] },
  longwave: { stops: [[100, '#2c2a5e'], [200, '#2f6fb8'], [300, '#2fb0a8'], [400, '#f0e04a'], [500, '#f7963b'], [600, '#e0342b']] },
  olr: { stops: [[80, '#ffffff'], [140, '#c9dcec'], [200, '#5a7fe0'], [250, '#2fb0a8'], [290, '#f0e04a'], [340, '#e0342b']] },
  netFlux: { stops: [[-200, '#2f5fd0'], [-50, '#9fd3f0', 0.6], clear(0, '#ffffff'), [50, '#f7d08a', 0.6], [200, '#f7963b'], [500, '#e0342b'], [800, '#7a0e2a']], labels: [-200, 0, 800] },
  sunshine: { stops: [clear(1, '#ffe46a'), [10, '#ffe46a', 0.5], [30, '#ffd23a'], [60, '#ffb020']] },
  albedo: { stops: [[0, '#14283c'], [15, '#3a5a6a'], [30, '#8a9a7a'], [50, '#c9c9b0'], [80, '#ffffff']] },
  ozone: { stops: [[100, '#5a1f8a'], [220, '#e0342b'], [280, '#f7963b'], [320, '#f3e96b'], [380, '#7fd18a'], [480, '#2f5fd0']] },
  pbl: { stops: [[0, '#14283c'], [300, '#2f6fb8'], [800, '#2fb0a8'], [1500, '#c9df6a'], [2500, '#f7a13b'], [4000, '#e0342b']] },
  aqi: { stops: [[0, '#3fae5a'], [50, '#3fae5a'], [51, '#f3e03a'], [100, '#f3e03a'], [101, '#f7963b'], [150, '#f7963b'], [151, '#e0342b'], [200, '#e0342b'], [201, '#8a3fa8'], [300, '#8a3fa8'], [301, '#7a0e2a'], [500, '#7a0e2a']], labels: [0, 51, 101, 151, 201, 301] },
  pm25: { stops: [clear(1, '#3fae5a'), [5, '#3fae5a', 0.5], [12, '#c9df3a'], [35, '#f7963b'], [55, '#e0342b'], [150, '#8a3fa8'], [300, '#7a0e2a']] },
  pm10: { stops: [clear(2, '#3fae5a'), [10, '#3fae5a', 0.5], [50, '#c9df3a'], [100, '#f7963b'], [250, '#e0342b'], [500, '#8a3fa8'], [1000, '#7a0e2a']] },
  aod: { stops: [clear(0.05, '#f3e96b'), [0.1, '#f3e96b', 0.5], [0.3, '#f7c23a'], [0.6, '#f7963b'], [1, '#e0342b'], [2, '#7a0e2a']] },
  column: { stops: [clear(0.1, '#f3e96b'), [1, '#f3e96b', 0.5], [5, '#f7c23a'], [20, '#f7963b'], [100, '#e0342b'], [500, '#7a0e2a']] },
  waves: { stops: [[0, '#14283c'], [0.5, '#2f6fb8'], [1, '#2fb0a8'], [2, '#7fd35a'], [3.5, '#f0e04a'], [5, '#f7963b'], [8, '#e0342b'], [12, '#a01f7a'], [16, '#f5e6f0']] },
  wavePeriod: { stops: [[0, '#14283c'], [4, '#2f6fb8'], [8, '#2fb0a8'], [12, '#7fd35a'], [16, '#f0e04a'], [20, '#f7963b'], [25, '#e0342b']] },
  direction: { stops: [[0, '#e0342b'], [90, '#f0e04a'], [180, '#2fb0a8'], [270, '#2f5fd0'], [360, '#e0342b']], labels: [0, 90, 180, 270, 360] },
  salinity: { stops: [[25, '#5a3fa8'], [30, '#2f6fb8'], [33, '#2fb0a8'], [35, '#8fe39a'], [36.5, '#f0e04a'], [38, '#f7963b'], [40, '#e0342b']], labels: [25, 35, 40] },
  current: { stops: [clear(0, '#14283c'), [0.05, '#2f6fb8', 0.6], [0.2, '#2fb0a8'], [0.5, '#7fd35a'], [1, '#f0e04a'], [1.5, '#f7963b'], [2.5, '#e0342b']] },
  seaHeight: { stops: [[-150, '#5a1f8a'], [-50, '#2f5fd0'], [0, '#7fdcf0'], [50, '#f3e96b'], [100, '#f7963b'], [150, '#e0342b']], labels: [-150, 0, 150] },
  oceanHeat: { stops: [[0, '#2f5fd0'], [6, '#4fc3e0'], [12, '#8fe39a'], [20, '#f3e96b'], [26, '#f7963b'], [34, '#e0342b']] },
  mixedLayer: { stops: [[0, '#d0e4f5'], [25, '#7fc0e0'], [75, '#2f86c6'], [150, '#2f5fb0'], [300, '#3a2f8a'], [600, '#1a0f4a']] },
  seaIce: { stops: [[1, '#cfe6ff', 0.3], [30, '#cfe6ff', 0.6], [70, '#e6f2ff'], [100, '#ffffff']] },
  iceThick: { stops: [[0.05, '#cfe6ff', 0.4], [0.5, '#8fbcf7'], [1.5, '#5a7fe0'], [3, '#7a3fc0'], [5, '#ffffff']] },
};

const channel = (hex, start) => parseInt(hex.slice(start, start + 2), 16);

// Turns a ramp into a lookup table so painting a pixel is a single array read.
export function buildLookup(ramp, size = 1024) {
  const stops = ramp.stops.map(([value, color, opacity = 1]) => ({
    value,
    r: channel(color, 1),
    g: channel(color, 3),
    b: channel(color, 5),
    a: opacity * 255,
  }));
  const min = stops[0].value;
  const max = stops.at(-1).value;
  const rgba = new Uint8ClampedArray(size * 4);
  let segment = 0;
  for (let i = 0; i < size; i++) {
    const value = min + ((max - min) * i) / (size - 1);
    while (segment < stops.length - 2 && value > stops[segment + 1].value) segment += 1;
    const from = stops[segment];
    const to = stops[segment + 1];
    const t = ramp.discrete ? 0 : Math.max(0, Math.min(1, (value - from.value) / (to.value - from.value || 1)));
    const pick = ramp.discrete && value >= to.value ? to : from;
    const [r, g, b, a] = ramp.discrete
      ? [pick.r, pick.g, pick.b, pick.a]
      : [from.r + (to.r - from.r) * t, from.g + (to.g - from.g) * t, from.b + (to.b - from.b) * t, from.a + (to.a - from.a) * t];
    rgba.set([r, g, b, a], i * 4);
  }
  return { min, max, size, rgba, scale: (size - 1) / (max - min) };
}

// A CSS gradient with evenly spaced stops, so narrow value ranges still show on the legend.
export function legendGradient(ramp) {
  const parts = ramp.stops.map(([, color, opacity = 1]) => {
    const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
    return `${color}${alpha}`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

// Which stop values to name on the legend, each with its position along the bar.
export function legendLabels(ramp) {
  const values = ramp.stops.map(([value]) => value);
  const chosen = ramp.labels ?? [values[0], values[Math.floor((values.length - 1) / 2)], values.at(-1)];
  return chosen.map((value) => {
    const index = values.findIndex((stop) => stop >= value);
    return { value, position: (Math.max(index, 0) / (values.length - 1)) * 100 };
  });
}

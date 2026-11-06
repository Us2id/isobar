// Moving lines on the globe. leaflet-velocity only knows a flat map, so here each line's position
// is kept in latitude and longitude, and turned into a screen position every frame.
import { colorSlot, degreesPerUnit, moveParticle, randomPlace } from './globe-helpers.js';
import { sampleGrid } from './grid-math.js';

const MAX_AGE_FRAMES = 90;
// Asking where a point falls on a globe takes longer than on a flat map, so it draws fewer lines.
const COUNT_SHARE = 0.6;
const MAX_PIXEL_RATIO = 2;
const FRAME_MS = 16.7;
const STRONG_FADE_EVERY = 8;
const STRONG_FADE = 0.85;

export class GlobeParticles {
  constructor(globe, grid, style) {
    this.globe = globe;
    this.grid = grid;
    this.style = style;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'globe-flow';
    globe.map.getCanvasContainer().append(this.canvas);
    this.context = this.canvas.getContext('2d');
    this.particles = [];
    this.moving = false;
    this.lastFrame = 0;
    this.fades = 0;
    // Trails drawn before a move no longer match the Earth, so they go.
    this.onMoveStart = () => {
      this.moving = true;
      this.clear();
    };
    this.onMoveEnd = () => {
      this.moving = false;
      this.clear();
      this.fit();
    };
    this.onResize = () => this.fit();
    globe.map.on('movestart', this.onMoveStart);
    globe.map.on('moveend', this.onMoveEnd);
    globe.map.on('resize', this.onResize);
    this.fit();
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }

  setData(grid) {
    this.grid = grid;
  }

  clear() {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  measureView() {
    const bounds = this.globe.map.getBounds();
    this.visibleBox = {
      south: Math.max(bounds.getSouth(), -85),
      north: Math.min(bounds.getNorth(), 85),
      west: bounds.getWest(),
      east: bounds.getEast(),
    };
  }

  // Matches the canvas to the window, and the number of lines to the window's size.
  fit() {
    this.measureView();
    const { clientWidth: width, clientHeight: height } = this.globe.container;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    this.width = width;
    this.height = height;
    const wanted = Math.min(this.style.maxParticles, Math.round(width * height * this.style.density * COUNT_SHARE));
    while (this.particles.length < wanted) this.particles.push(this.newParticle());
    this.particles.length = wanted;
  }

  isVisible(lat, lng) {
    const { transform } = this.globe.map;
    return !transform.isLocationOccluded({ lat, lng });
  }

  // A new line somewhere that can be seen. After a few misses it waits and tries again next frame.
  newParticle() {
    const { south, north, west, east } = this.visibleBox;
    for (let attempt = 0; attempt < 6; attempt++) {
      const [lat, lng] = randomPlace(south, north, west, east);
      if (this.isVisible(lat, lng)) {
        return { lat, lng, age: Math.floor(Math.random() * MAX_AGE_FRAMES), x: null, y: null };
      }
    }
    return { lat: 0, lng: 0, age: MAX_AGE_FRAMES, x: null, y: null };
  }

  sendToNewPlace(particle) {
    Object.assign(particle, this.newParticle());
    particle.age = 0;
  }

  animate(now) {
    this.frame = requestAnimationFrame(this.animate);
    const { frameRate = 25, trail } = this.style;
    // The lines stay smooth while the globe is turning, and rest at the normal rate otherwise.
    if (!this.moving && now - this.lastFrame < 1000 / frameRate) return;
    const frames = Math.min(now - this.lastFrame, 100) / FRAME_MS;
    this.lastFrame = now;
    this.drawFrame(frames, trail);
  }

  drawFrame(frames, trail) {
    const { context, grid, globe, width, height, style } = this;
    const { map } = globe;
    if (this.moving) {
      this.measureView();
      this.clear();
    } else {
      // Fading what's there leaves the trail behind each line. Colors are stored as whole numbers,
      // so a small fade never takes the faintest pixels to nothing, and on dark space they'd stay as
      // ghost lines. A stronger fade now and then clears them.
      this.fades += 1;
      context.globalCompositeOperation = 'destination-in';
      context.fillStyle = `rgba(0, 0, 0, ${this.fades % STRONG_FADE_EVERY === 0 ? trail * STRONG_FADE : trail})`;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';
    }
    const degrees = degreesPerUnit(style.velocityScale, map.getZoom()) * frames;
    const colors = style.colorScale;
    const paths = colors.map(() => new Path2D());
    for (const particle of this.particles) {
      particle.age += 1;
      if (particle.age > MAX_AGE_FRAMES) {
        this.sendToNewPlace(particle);
        continue;
      }
      const u = sampleGrid(grid, grid.u, particle.lat, particle.lng);
      const v = sampleGrid(grid, grid.v, particle.lat, particle.lng);
      if (u !== u || v !== v) {
        this.sendToNewPlace(particle);
        continue;
      }
      if (this.moving || particle.x === null) {
        const before = map.project([particle.lng, particle.lat]);
        particle.x = before.x;
        particle.y = before.y;
      }
      const [lat, lng] = moveParticle(particle.lat, particle.lng, u, v, degrees);
      if (Math.abs(lat) > 85 || !this.isVisible(lat, lng)) {
        this.sendToNewPlace(particle);
        continue;
      }
      const { x, y } = map.project([lng, lat]);
      if (x < 0 || y < 0 || x > width || y > height) {
        this.sendToNewPlace(particle);
        continue;
      }
      const path = paths[colorSlot(Math.hypot(u, v), style.maxVelocity, colors.length)];
      path.moveTo(particle.x, particle.y);
      path.lineTo(x, y);
      particle.lat = lat;
      particle.lng = lng;
      particle.x = x;
      particle.y = y;
    }
    context.lineWidth = style.lineWidth ?? 1;
    colors.forEach((color, index) => {
      context.strokeStyle = color;
      context.stroke(paths[index]);
    });
  }

  remove() {
    cancelAnimationFrame(this.frame);
    const { map } = this.globe;
    if (this.globe.alive) {
      map.off('movestart', this.onMoveStart);
      map.off('moveend', this.onMoveEnd);
      map.off('resize', this.onResize);
    }
    this.canvas.remove();
  }
}

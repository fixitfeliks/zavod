// CONEY — the far distance and the evening. Everything beyond the OSM plan, built from real geography (lat/lon projected into
// the map frame, see qa/tools/osm-coney.py): south Brooklyn's low-rise sprawl (instanced row-house strips + 6-storey walk-ups +
// the Brighton / Trump Village / Warbasse towers, flat tar/silver roofs, water tanks, street trees, a land shader that draws the
// street grid), Coney Island Creek + the Belt Parkway, Gravesend Bay, the Verrazzano-Narrows bridge (6.4 km WNW), Staten
// Island's hills, Bayonne / Jersey City, Lower Manhattan + Midtown (One WTC, the Empire State, 432 Park, Central Park Tower,
// Chrysler, One Vanderbilt, Hudson Yards …) 15–21 km NNW behind downtown Brooklyn, Rockaway / Breezy Point, Sandy Hook and
// the Highlands, the open ocean to a curved horizon with ships.
//
// Rendering: anything past ~2.3 km is a "far layer": opaque, no depth write/test, drawn first in painter's order (renderOrder),
// its vertices pulled inside the camera far plane along their view rays (screen position unchanged) and dropped for the
// earth's curvature; the real scene then draws over it. Within far layers every mesh is pre-sorted far → near from building 2,
// so it self-occludes correctly from anywhere on the map. The near ring (≤ 2.3 km) is ordinary depth-tested geometry. All
// materials share one set of uniforms (sun, sky ambient, haze) driven by the day → night cycle below.
//
// Day → night: golden hour → sunset → dusk → night over 20 min of wall-clock time (phase from Date.now(), so every online client
// sees the same sky), 8 min of night, 2 min back. Sun (ctx.lights.key) sinks in the west behind the bridge, then the moon takes
// the key light; hemi/fill, a procedural sky dome (the HDRI's clouds re-lit), fog, exposure and IBL follow. At night: lit
// windows (sprawl, skyline, the Luna towers), sodium street grid, lamp globes + light pools, the rides' bulbs (wheel, parachute
// tower, coasters), the bridge necklace, aviation lights, parkway traffic, and fireworks over the beach every 20 s.
// ?time=golden|sunset|dusk|night|<0..1> freezes the phase for QA. Owned by: CONEY horizon agent.
import * as THREE from 'three';
import { OSM } from './osm.js';
import { YARD } from './yard.js';
import { inCreek } from './realism.js';
import { EAST_TOWER } from './mats.js';
import { inS2, buildS2, S2_WIN } from './shellrd.js';

const D2R = Math.PI / 180;
const LAT0 = 40.5745, LON0 = -73.98, KX = 111320 * Math.cos(LAT0 * D2R), KY = 110540, CT = Math.cos(8.33 * D2R), ST_ = Math.sin(8.33 * D2R);
/** lat/lon → map frame (x east-ish, z south-ish), same projection as qa/tools/osm-coney.py */
export function geo(lat, lon) { const x = (lon - LON0) * KX, z = -(lat - LAT0) * KY; return [x * CT - z * ST_, x * ST_ + z * CT]; }
const poly = (ll) => ll.map(([a, b]) => geo(a, b));

const P0 = [163, -445];                    // building 2: far layers are sorted for this eye point
const NEAR_C = [0, -250], NEAR_R = 2300;   // depth-tested ring
const FAR_R = 3200, CAM_FAR = 3500;        // far layers squeezed inside this radius; camera far plane
const EXCL = { x0: -1000, x1: 900, z0: -1000, z1: 412 };   // the OSM scene's own ground / beach
const inRect = (x, z, m = 0) => x > EXCL.x0 - m && x < EXCL.x1 + m && z > EXCL.z0 - m && z < EXCL.z1 + m;
// inside the scene's ground rect, the OSM plan only reaches so far north: per 20 m column, the northmost mapped feature
const ZCUT = (() => { const n = Math.ceil((EXCL.x1 - EXCL.x0) / 20), a = new Float32Array(n).fill(-1e9); const mark = (x, z) => { const i = Math.floor((x - EXCL.x0) / 20); for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n) a[k] = Math.max(a[k], -z); };
  for (const b of OSM.b) for (const [x, z] of b.p) mark(x, z);
  for (const k of ['l', 'pk', 'pt']) for (const q of OSM[k] || []) for (const [x, z] of (q.p || q)) mark(x, z);
  return (x) => { const i = Math.floor((x - EXCL.x0) / 20); return i >= 0 && i < n ? Math.min(-a[i] - 30, -150) : -1e9; }; })();
// the Brighton Beach strip (coney/brighton.js builds it, walkable): no sprawl, towers or land tiles in it
const CORR = { x0: 880, x1: 2420, z0: -100, z1: 470 };
const inCorr = (x, z, m = 0) => x > CORR.x0 - m && x < CORR.x1 + m && z > CORR.z0 - m && z < CORR.z1 + m;
// Coney Island Yard (coney/yard.js lays it out past the OSM plan): ballast and laid-up trains, no houses
const inYard = (x, z, m = 0) => x > YARD.x0 - m && x < YARD.x1 + m && z > YARD.z0 - m && z < YARD.z1 + m;
const inExcl = (x, z, m = 0) => (inRect(x, z, m) && !(z < ZCUT(x) - m)) || inCorr(x, z, m) || inYard(x, z, m) || inCreek(x, z, m);   // + Coney Island Creek and its field (coney/realism.js)
// OSM streets inside the rect (the scene draws them): sprawl boxes keep off them
const ROADS = []; for (const r of OSM.r) for (let i = 0; i + 1 < r.p.length; i++) { const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1]; ROADS.push({ ax, az, bx, bz, w: r.w / 2 + 3, x0: Math.min(ax, bx) - r.w, x1: Math.max(ax, bx) + r.w, z0: Math.min(az, bz) - r.w, z1: Math.max(az, bz) + r.w }); }
function onRoad(x0, z0, x1, z1) {
  if (!inRect((x0 + x1) / 2, (z0 + z1) / 2, 60)) return false;
  for (const r of ROADS) { if (r.x1 < x0 || r.x0 > x1 || r.z1 < z0 || r.z0 > z1) continue;
    // segment vs (expanded) box: sample the segment
    const L = Math.hypot(r.bx - r.ax, r.bz - r.az); for (let t = 0; t <= L; t += 4) { const x = r.ax + (r.bx - r.ax) * t / L, z = r.az + (r.bz - r.az) * t / L; if (x > x0 - r.w && x < x1 + r.w && z > z0 - r.w && z < z1 + r.w) return true; } }
  return false;
}

// ---- geography (rough coastlines, lat/lon) ------------------------------------------------------------------------------
const LAND = {
  brooklyn: poly([[40.5764, -74.0118], [40.5742, -74.0060], [40.5730, -73.9990], [40.5724, -73.9900], [40.5722, -73.9800], [40.5730, -73.9700], [40.5738, -73.9620], [40.5752, -73.9500], [40.5768, -73.9400], [40.5790, -73.9345], [40.5818, -73.9380], [40.5838, -73.9300], [40.5830, -73.9150], [40.5842, -73.9000], [40.5815, -73.8870], [40.6000, -73.8850], [40.6150, -73.8950], [40.6250, -73.8800], [40.6350, -73.8750], [40.6450, -73.8500], [40.6550, -73.8250], [40.6620, -73.7800], [40.8100, -73.7800], [40.8100, -73.9150], [40.7700, -73.9350], [40.7450, -73.9600], [40.7300, -73.9620], [40.7100, -73.9680], [40.7020, -73.9750], [40.7040, -73.9900], [40.6980, -73.9990], [40.6850, -74.0060], [40.6760, -74.0180], [40.6650, -74.0150], [40.6550, -74.0220], [40.6450, -74.0270], [40.6360, -74.0370], [40.6250, -74.0420], [40.6120, -74.0400], [40.6060, -74.0300], [40.5990, -74.0180], [40.5930, -74.0080], [40.5870, -74.0015], [40.5832, -74.0020], [40.5812, -74.0075], [40.5795, -74.0112]]),
  rockaway: poly([[40.5552, -73.9440], [40.5575, -73.9200], [40.5650, -73.8700], [40.5760, -73.8200], [40.5840, -73.7500], [40.5960, -73.7500], [40.5890, -73.8200], [40.5760, -73.8800], [40.5680, -73.9200], [40.5610, -73.9400]]),
  staten: poly([[40.6440, -74.0730], [40.6300, -74.0730], [40.6150, -74.0680], [40.6050, -74.0560], [40.5960, -74.0600], [40.5850, -74.0680], [40.5720, -74.0860], [40.5580, -74.1030], [40.5420, -74.1250], [40.5300, -74.1550], [40.5150, -74.1950], [40.5000, -74.2470], [40.5100, -74.2550], [40.5500, -74.2200], [40.5900, -74.2050], [40.6250, -74.2000], [40.6400, -74.1800], [40.6450, -74.1300], [40.6420, -74.1000]]),
  jersey: poly([[40.6480, -74.0850], [40.6600, -74.0700], [40.6800, -74.0500], [40.7000, -74.0420], [40.7150, -74.0330], [40.7350, -74.0280], [40.7600, -74.0220], [40.8300, -73.9750], [40.9000, -73.9400], [40.9000, -74.3000], [40.6500, -74.3000], [40.6480, -74.1500], [40.6520, -74.1150]]),
  manhattan: poly([[40.7010, -74.0150], [40.7090, -73.9780], [40.7280, -73.9710], [40.7450, -73.9710], [40.7560, -73.9600], [40.7750, -73.9430], [40.8000, -73.9280], [40.8350, -73.9330], [40.8700, -73.9100], [40.8750, -73.9250], [40.8200, -73.9600], [40.8000, -73.9720], [40.7750, -73.9930], [40.7500, -74.0100], [40.7250, -74.0130], [40.7100, -74.0180]]),
  bronx: poly([[40.8000, -73.9250], [40.8150, -73.9300], [40.8700, -73.9100], [40.9100, -73.9100], [40.9100, -73.7800], [40.8100, -73.7800], [40.8100, -73.9150]]),
  hook: poly([[40.4720, -74.0120], [40.4640, -73.9980], [40.4300, -73.9860], [40.4000, -73.9800], [40.3300, -73.9750], [40.2600, -73.9900], [40.2600, -74.3000], [40.4500, -74.3000], [40.4550, -74.1500], [40.4400, -74.0700], [40.4150, -74.0200], [40.4200, -74.0000], [40.4500, -74.0050]]),
};
const HILLS = [[40.597, -74.117, 125, 1600], [40.618, -74.093, 100, 1000], [40.608, -74.065, 40, 700], [40.578, -74.139, 75, 1300], [40.556, -74.160, 40, 2000], [40.405, -74.005, 80, 2200], [40.410, -74.055, 70, 2600], [40.395, -74.110, 50, 3000], [40.660, -73.980, 40, 2400], [40.690, -74.070, 25, 3000], [40.790, -73.990, 70, 3500], [40.850, -73.960, 90, 3500], [40.720, -74.110, 30, 5000]].map(([a, b, h, s]) => { const [x, z] = geo(a, b); return { x, z, h, s }; });
const PARKS = [[40.6602, -73.9690, 900], [40.6520, -73.9900, 700], [40.6000, -73.9250, 700], [40.6150, -74.0200, 450], [40.5875, -74.0000, 300], [40.5900, -73.8930, 900], [40.5970, -74.1150, 1400], [40.5550, -74.1400, 1200], [40.6020, -73.9750, 250], [40.6330, -73.8970, 800]].map(([a, b, r]) => { const [x, z] = geo(a, b); return { x, z, r }; });
function pip(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
const LAND_LIST = Object.values(LAND);
const LAND_BB = LAND_LIST.map((p) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; });
function isLand(x, z) { for (let i = 0; i < LAND_LIST.length; i++) { const b = LAND_BB[i]; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue; if (pip(x, z, LAND_LIST[i])) return i + 1; } return 0; }
function height(x, z) { let h = 0; for (const q of HILLS) { const d2 = (x - q.x) ** 2 + (z - q.z) ** 2; h += q.h * Math.exp(-d2 / (2 * q.s * q.s)); } return h; }
const parkAt = (x, z) => PARKS.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r);

// small seeded rng (the shared world.R must not be consumed: later builders' layouts depend on its sequence)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (i, j = 0) => { let h = (i * 374761393 + j * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---- shared uniforms + GLSL --------------------------------------------------------------------------------------------
const U = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uAmbSky: { value: new THREE.Color() }, uAmbGnd: { value: new THREE.Color() },
  uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.0003 }, uFarL: { value: 30000 }, uNight: { value: 0 }, uTime: { value: 0 }, uPx: { value: 800 }, uLamp: { value: 0 },
};
const HEAD = /* glsl */`
uniform vec3 uSunDir, uSunCol, uAmbSky, uAmbGnd, uFogCol; uniform float uFogD, uFarL, uNight, uTime, uLamp;
float hazeF(float d) { float n = min(d, 3000.0) * uFogD; return 1.0 - exp(-n * n) * exp(-max(d - 3000.0, 0.0) / uFarL); }
vec3 shade(vec3 alb, vec3 n) { float nl = max(dot(n, uSunDir), 0.0); vec3 amb = mix(uAmbGnd, uAmbSky, n.y * 0.5 + 0.5); return alb * (uSunCol * nl + amb) * 0.3183; }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
const VFAR = /* glsl */`
vec4 farProj(vec4 w) {
#ifdef FAR
  vec2 q = w.xz - cameraPosition.xz; w.y -= dot(q, q) * 6.7e-8;
  vec4 mv = viewMatrix * w; float r = length(mv.xyz); if (r > ${FAR_R.toFixed(1)}) mv.xyz *= ${FAR_R.toFixed(1)} / r;
#else
  vec4 mv = viewMatrix * w;
#endif
  return projectionMatrix * mv;
}`;
const OUT = /* glsl */`
#include <tonemapping_fragment>
#include <colorspace_fragment>`;
let ORDER = -990;
function mat(vert, frag, { far = false, uniforms = {}, defines = {}, order = null, ...rest } = {}) {
  const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...uniforms }, vertexShader: HEAD + VFAR + vert, fragmentShader: HEAD + frag, defines: { ...(far ? { FAR: 1 } : {}), ...defines }, fog: false, ...rest });
  if (far) { m.depthTest = false; m.depthWrite = false; }
  return m;
}
function addMesh(world, geo, m, { far = false, order, name, instanced = null } = {}) {
  const mesh = instanced || new THREE.Mesh(geo, m); mesh.name = 'horizon:' + name; mesh.frustumCulled = !far; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  mesh.renderOrder = far ? (order ?? ORDER++) : (order ?? 0); world.scene.add(mesh); return mesh;
}

// ---- textures ------------------------------------------------------------------------------------------------------------
const cnv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
function dataTex(c, alphaFn, srgb = true) {
  const g = c.getContext('2d'), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  if (alphaFn) for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) d[(y * c.width + x) * 4 + 3] = alphaFn(x, y);
  const t = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), c.width, c.height, THREE.RGBAFormat); t.flipY = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
/** row-house / walk-up facade: 12 x 12 m tile (4 window columns x 4 storeys), greyscale wall (tinted per building), alpha = window glass */
function facadeTex(R) {
  const S = 256, [c, g] = cnv(S, S), m = S / 12, mask = new Uint8Array(S * S);
  g.fillStyle = '#c9c4bc'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) { const v = 170 + R() * 60; g.fillStyle = `rgba(${v},${v - 6},${v - 12},0.35)`; g.fillRect(R() * S, R() * S, 3 + R() * 6, 1.5); }
  for (let f = 0; f < 4; f++) {
    const yTop = S - (f + 1) * 3 * m;   // canvas y of this storey's top (row 0 = ground floor at the bottom)
    g.fillStyle = 'rgba(60,50,45,0.35)'; g.fillRect(0, yTop, S, 0.18 * m);   // floor line / cornice shadow
    for (let k = 0; k < 4; k++) {
      const cx = (k + 0.5) * 3 * m; let w = 1.15 * m, h = 1.55 * m, y0 = yTop + 0.75 * m;
      if (f === 0 && k % 2 === 0) { g.fillStyle = '#3b2e27'; g.fillRect(cx - 0.55 * m, S - 2.3 * m, 1.1 * m, 2.3 * m); g.fillStyle = '#9a948c'; g.fillRect(cx - 0.9 * m, S - 0.35 * m, 1.8 * m, 0.35 * m); continue; }
      g.fillStyle = '#f2efe8'; g.fillRect(cx - w / 2 - 0.08 * m, y0 - 0.08 * m, w + 0.16 * m, h + 0.16 * m);
      const gr = g.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, '#6d7c89'); gr.addColorStop(1, '#262d33'); g.fillStyle = gr; g.fillRect(cx - w / 2, y0, w, h);
      if (R() < 0.4) { g.fillStyle = R() < 0.5 ? '#d8d0bc' : '#b09a7a'; g.fillRect(cx - w / 2, y0, w, h * (0.3 + R() * 0.5)); }
      g.fillStyle = '#dcd9d2'; g.fillRect(cx - w / 2, y0 + h * 0.48, w, 0.06 * m);
      for (let y = Math.floor(y0); y < y0 + h; y++) for (let x = Math.floor(cx - w / 2); x < cx + w / 2; x++) mask[y * S + x] = 255;
    }
  }
  g.fillStyle = '#8c8680'; g.fillRect(0, 0, S, 0.25 * m);
  return dataTex(c, (x, y) => mask[y * S + x]);
}
function treeTex(R) {
  const S = 128, [c, g] = cnv(S, S); g.clearRect(0, 0, S, S);
  g.fillStyle = '#4a3a2a'; g.fillRect(S / 2 - 3, S * 0.55, 6, S * 0.45);
  for (let i = 0; i < 90; i++) { const a = R() * 6.28, r = R() * S * 0.36, x = S / 2 + Math.cos(a) * r, y = S * 0.42 + Math.sin(a) * r * 0.85; const v = R(); g.fillStyle = `rgb(${50 + v * 40 | 0},${75 + v * 50 | 0},${35 + v * 20 | 0})`; g.beginPath(); g.arc(x, y, 6 + R() * 9, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// =========================================================================================================================
export function buildHorizon(world) {
  const { ctx, scene } = world; const R = rng(90210);
  if (ctx.qs?.get?.('horizon') === '0') return null;   // QA: A/B the cost
  const t0 = performance.now();
  ctx.camera.far = CAM_FAR; ctx.camera.updateProjectionMatrix();
  const stats = { dc: 0, tris: 0 }; const count = (m) => { stats.dc++; const g = m.geometry; stats.tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); };
  const texF = facadeTex(R);

  const ocean = buildOcean(world); count(ocean);
  const land = buildLand(world, R); land.forEach(count);
  const sprawl = buildSprawl(world, R, texF); sprawl.meshes.forEach(count);
  if (sprawl.s2.length && world.mats) try { const s = buildS2(world, world.mats, sprawl.s2, sprawl.tints); console.info(`[horizon] S2 Shell Rd: ${s.boxes} boxes on the facade kit, ${s.shops} taxpayers`); } catch (e) { console.warn('[horizon] S2', e); }
  const sky = buildSkyline(world, R); sky.meshes.forEach(count);
  // lights sample the rides' struts and the scene's lamp meshes: those are built after us (landmarks, park), so defer to frame 1
  // (or at the pre-warm, whichever comes first: on phones / the headset the pre-warm frees those meshes' vertex arrays before frame 1)
  let lightsDone = false; const lights = () => { if (lightsDone) return; lightsDone = true; try { const L = buildLights(world, R, sprawl, sky); L.forEach(count); cyc.lights = L; console.info(`[horizon] lights: ${stats.dc} draws total`); } catch (e) { console.warn('[horizon] lights', e); } }; world.updaters.push(lights); ctx.bus?.on?.('prewarm', lights);
  const fw = buildFireworks(world); count(fw.mesh);
  const cyc = buildCycle(world, fw);
  world.W.horizon = { stats, cycle: cyc, fireworks: fw, sprawl };
  console.info(`[horizon] ${stats.dc} draws · ${(stats.tris / 1000).toFixed(0)}k tris · ${sprawl.n} sprawl boxes · ${(performance.now() - t0).toFixed(0)} ms`);
  return stats;
}

// ---- ocean: a 90 km disc beyond the scene's ocean plane, curving under the horizon -----------------------------------------
function buildOcean(world) {
  const segR = 48, segA = 96, pos = [], idx = [];
  const rs = []; for (let i = 0; i <= segR; i++) rs.push(i === 0 ? 0 : 400 * Math.pow(45000 / 400, (i - 1) / (segR - 1)));
  for (let i = 0; i <= segR; i++) for (let j = 0; j <= segA; j++) { const a = j / segA * Math.PI * 2; pos.push(P0[0] + Math.cos(a) * rs[i], -2.4, P0[1] + Math.sin(a) * rs[i]); }
  // painter's order inside the disc: outer rings first
  for (let i = segR - 1; i >= 0; i--) for (let j = 0; j < segA; j++) { const a = i * (segA + 1) + j, b = a + 1, c2 = a + segA + 1, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = mat(/* glsl */`
    varying vec3 vW; varying float vD;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w); }`, /* glsl */`
    uniform vec3 uSky, uHorizon, uGlow; varying vec3 vW; varying float vD;
    void main() {
      vec3 v = normalize(vW - cameraPosition); vec3 r = reflect(v, vec3(0.0, 1.0, 0.0));
      float fres = 0.02 + 0.98 * pow(1.0 - max(-v.y, 0.0), 5.0);
      // wave-scale sparkle: cheap noise normal tilt, fading out with distance
      vec2 q = vW.xz * 0.05 + vec2(uTime * 0.05, uTime * 0.03); float nz = h12(floor(q * 4.0)) - 0.5;
      vec3 skyc = mix(uHorizon, uSky, clamp(r.y * 4.0 + nz * 0.15 * exp(-vD / 4000.0), 0.0, 1.0));
      vec3 sd = normalize(vec3(uSunDir.x, 0.0, uSunDir.z)); float s = max(dot(normalize(vec3(r.x, 0.0, r.z)), sd), 0.0);
      float glint = pow(s, 90.0) * smoothstep(0.0, 0.08, uSunDir.y + 0.02) * (0.6 + 0.8 * h12(floor(vW.xz * 0.3 + uTime)));
      vec3 deep = vec3(0.018, 0.045, 0.06) * (uAmbSky + uSunCol * 0.15);
      vec3 col = mix(deep, skyc, fres) + uGlow * glint * 1.8;
      col = mix(col, uFogCol, hazeF(vD) * 0.85);
      gl_FragColor = vec4(col, 1.0);${OUT}
    }`, { far: true, uniforms: { uSky: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() } } });
  U.uSkyRef = m.uniforms.uSky; U.uHorizonRef = m.uniforms.uHorizon; U.uGlowRef = m.uniforms.uGlow;
  return addMesh(world, g, m, { far: true, order: -995, name: 'ocean' });
}

// ---- land: quadtree cells clipped to the coastlines (finer near the shore), heightfield hills; far layer sorted far → near,
// near ring depth-tested. The shader draws the street grid (250 x 80 m blocks, same as the sprawl), parks, sodium light at night.
const landVert = /* glsl */`
  attribute float aKind; varying vec3 vW, vN; varying float vKind, vD;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vKind = aKind; vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w); }`;
const landFrag = /* glsl */`
  varying vec3 vW, vN; varying float vKind, vD;
  float band(float x, float period, float w) {   // 1 inside a street band of width w, antialiased, averaging out when sub-pixel
    float fw = fwidth(x); float f = abs(fract(x / period + 0.5) - 0.5) * period;
    float m = 1.0 - smoothstep(w * 0.5 - fw, w * 0.5 + fw, f);
    return mix(m, w / period, smoothstep(period * 0.15, period * 0.6, fw));
  }
  void main() {
    vec3 n = normalize(vN); vec3 alb; vec3 emi = vec3(0.0);
    vec2 cell = floor(vec2(vW.x / 250.0, vW.z / 80.0)); float hr = h12(cell);
    float fine = h12(floor(vW.xz / 7.0)); float fw = fwidth(vW.x / 7.0); fine = mix(fine, 0.5, smoothstep(0.3, 1.0, fw));
    if (vKind < 0.5) {            // urban: roofs + yards between streets
      float av = band(vW.x, 250.0, 26.0), st = band(vW.z, 80.0, 18.0), street = max(av, st);
      vec3 blockc = mix(vec3(0.34, 0.33, 0.31), vec3(0.42, 0.40, 0.36), hr) * (0.8 + 0.4 * fine);
      blockc = mix(blockc, vec3(0.24, 0.29, 0.18), 0.25 * step(0.5, fine));
      alb = mix(blockc, vec3(0.13, 0.13, 0.135), street);
      float sod = street * (0.75 + 0.25 * fine);
      emi = vec3(1.0, 0.5, 0.16) * sod * 0.045 * uLamp + vec3(1.0, 0.8, 0.5) * step(0.93, fine) * (1.0 - street) * 0.03 * uNight;
    } else if (vKind < 1.5) {     // parks / woods
      alb = mix(vec3(0.12, 0.17, 0.08), vec3(0.2, 0.25, 0.12), fine);
    } else if (vKind < 2.5) {     // sand
      alb = vec3(0.62, 0.56, 0.45) * (0.9 + 0.2 * fine);
    } else {                      // industrial / docks
      alb = mix(vec3(0.38, 0.37, 0.35), vec3(0.3, 0.28, 0.27), fine);
    }
    vec3 col = shade(alb, n) + emi;
    float hz = hazeF(vD); col = mix(col, uFogCol, hz) + emi * hz * 0.5;
    gl_FragColor = vec4(col, 1.0);${OUT}
  }`;
function buildLand(world) {
  const far = { pos: [], nor: [], kind: [], cells: [] }, near = { pos: [], nor: [], kind: [], cells: [] };
  const kindAt = (x, z, li) => { if (li === 7) return z < geo(40.44, -74)[1] ? 1 : (height(x, z) > 20 ? 1 : 2); if (li === 3 && height(x, z) > 55) return 1; if (parkAt(x, z)) return 1; return 0; };
  const minSize = (d) => d < 3000 ? 40 : d < 9000 ? 80 : d < 20000 ? 240 : 720;
  const emit = (x, z, s, li) => {
    const cx = x + s / 2, cz = z + s / 2; const dN = Math.hypot(cx - NEAR_C[0], cz - NEAR_C[1]);
    const T = dN < NEAR_R ? near : far; const k = (li === 1 && cz > 150) ? 2 : kindAt(cx, cz, li);
    T.cells.push({ x, z, s, k, d: Math.hypot(cx - P0[0], cz - P0[1]) });
  };
  const rec = (x, z, s) => {
    const cx = x + s / 2, cz = z + s / 2, d = Math.hypot(cx - P0[0], cz - P0[1]);
    if (s > 200 && (Math.max(Math.abs(cx - NEAR_C[0]) - s / 2, 0) ** 2 + Math.max(Math.abs(cz - NEAR_C[1]) - s / 2, 0) ** 2 < NEAR_R * NEAR_R) && s > 100) { const h = s / 2; rec(x, z, h); rec(x + h, z, h); rec(x, z + h, h); rec(x + h, z + h, h); return; }
    const ex = [inRect(x, z) || inCorr(x, z), inRect(x + s, z) || inCorr(x + s, z), inRect(x, z + s) || inCorr(x, z + s), inRect(x + s, z + s) || inCorr(x + s, z + s)]; if (ex.every(Boolean)) return;
    if (ex.some(Boolean) && s > 50) { const h = s / 2; rec(x, z, h); rec(x + h, z, h); rec(x, z + h, h); rec(x + h, z + h, h); return; }
    const pts = [[x, z], [x + s, z], [x, z + s], [x + s, z + s], [cx, cz]]; const ls = pts.map(([a, b]) => isLand(a, b));
    const all = ls.every((v) => v === ls[4] && v), none = ls.every((v) => !v);
    if (none && s <= 1500) return;
    if (!all && s > minSize(d)) { const h = s / 2; rec(x, z, h); rec(x + h, z, h); rec(x, z + h, h); rec(x + h, z + h, h); return; }
    if (ls[4] || (s <= minSize(d) && ls.filter(Boolean).length >= 3)) emit(x, z, s, ls[4] || ls.find(Boolean));
  };
  const S0 = 5760; for (let gx = -12; gx < 12; gx++) for (let gz = -12; gz < 12; gz++) { const x = P0[0] + gx * S0, z = P0[1] + gz * S0; if (Math.hypot(x + S0 / 2 - P0[0], z + S0 / 2 - P0[1]) > 62000) continue; rec(x, z, S0); }
  const out = [];
  for (const [T, isFar] of [[far, true], [near, false]]) {
    if (isFar) T.cells.sort((a, b) => b.d - a.d);
    const pos = [], nor = [], kind = [];
    const nrm = (x, z) => { const e = 30, hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e); const v = new THREE.Vector3(-hx, 2 * e, -hz).normalize(); return [v.x, v.y, v.z]; };
    for (const c of T.cells) {
      const q = [[c.x, c.z], [c.x, c.z + c.s], [c.x + c.s, c.z], [c.x + c.s, c.z + c.s]];
      const Y = (x, z) => isFar ? Math.max(0, height(x, z)) : (c.k === 2 ? -1.35 : -0.03);
      for (const i of [0, 1, 2, 2, 1, 3]) { const [x, z] = q[i]; pos.push(x, Y(x, z), z); nor.push(...nrm(x, z)); kind.push(c.k); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    g.computeBoundingSphere();
    const m = mat(landVert, landFrag, { far: isFar });
    out.push(addMesh(world, g, m, { far: isFar, order: isFar ? -990 : 0, name: isFar ? 'landFar' : 'landNear' }));
  }
  // Coney Island Creek + the Belt Parkway as ribbons on the near ground (depth-tested)
  const creek = poly([[40.5822, -74.0065], [40.5810, -74.0020], [40.5800, -73.9980], [40.5798, -73.9940], [40.5805, -73.9905], [40.5822, -73.9868]]);
  const belt = poly([[40.6130, -74.0395], [40.6060, -74.0300], [40.5990, -74.0185], [40.5930, -74.0085], [40.5880, -74.0030], [40.5858, -73.9960], [40.5852, -73.9870], [40.5856, -73.9760], [40.5858, -73.9680], [40.5852, -73.9590], [40.5845, -73.9450], [40.5842, -73.9300], [40.5838, -73.9150], [40.5848, -73.9000]]);
  const ribbon = (pts, w, y) => { const p = []; for (let i = 0; i + 1 < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), nx = -dz / L * w / 2, nz = dx / L * w / 2; p.push(ax - nx, y, az - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, bx - nx, y, bz - nz, ax + nx, y, az + nz, bx + nx, y, bz + nz); } return p; };
  const rib = new THREE.BufferGeometry(); const rp = [...ribbon(creek, 70, 0.08), ...ribbon(belt, 38, 0.1)]; const rk = [];
  for (let i = 0; i < ribbon(creek, 70, 0).length / 3; i++) rk.push(0); for (let i = 0; i < ribbon(belt, 38, 0).length / 3; i++) rk.push(1);
  rib.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rib.setAttribute('aKind', new THREE.Float32BufferAttribute(rk, 1)); rib.computeBoundingSphere();
  const rm = mat(/* glsl */`attribute float aKind; varying vec3 vW; varying float vK, vD; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vK = aKind; vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w); }`, /* glsl */`
    uniform vec3 uSkyC; varying vec3 vW; varying float vK, vD;
    void main() { vec3 col;
      if (vK < 0.5) col = mix(vec3(0.03, 0.05, 0.05) * (uAmbSky + uSunCol * 0.2), uSkyC, 0.35);
      else { float lane = step(0.93, fract(vW.x / 6.0)) * 0.0; col = shade(vec3(0.16, 0.16, 0.17), vec3(0.0, 1.0, 0.0)) + vec3(1.0, 0.6, 0.25) * 0.05 * uLamp; }
      col = mix(col, uFogCol, hazeF(vD)); gl_FragColor = vec4(col, 1.0);${OUT} }`, { uniforms: { uSkyC: { value: new THREE.Color(0x8a9aa8) } } });
  rm.polygonOffset = true; rm.polygonOffsetFactor = -2; rm.polygonOffsetUnits = -2; U.uCreekSky = rm.uniforms.uSkyC;
  out.push(addMesh(world, rib, rm, { name: 'creekBelt' }));
  world.W.horizonBelt = belt;
  return out;
}

// ---- sprawl: row-house strips / walk-ups / towers on the 250 x 80 m frame grid, near ring (depth) + far (painter's) ------------
const boxVert = /* glsl */`
  attribute vec3 aTint; attribute float aSeed; varying vec3 vW, vN, vTint; varying float vSeed, vD, vBase; varying vec2 vEdge;
  void main() {
    vEdge = (0.5 - abs(position.xz)) * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));   // metres in from the roof edge
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal); vTint = aTint; vSeed = aSeed;
    vBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y; vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w);
  }`;
const boxFrag = /* glsl */`
  uniform sampler2D tFac; varying vec3 vW, vN, vTint; varying float vSeed, vD, vBase; varying vec2 vEdge;
  void main() {
    vec3 n = normalize(vN); vec3 alb; vec3 emi = vec3(0.0);
    if (vSeed < -0.5) alb = vSeed < -1.5 ? vTint * 0.85 : vec3(0.6, 0.61, 0.6) * (n.y > 0.5 ? 1.1 : 0.9);   // roof kit: stair bulkhead (brick) / HVAC (galvanised)
    else if (n.y > 0.5) {   // flat roof: tar, silver coating or gravel ballast per building; coping on the parapet, its shadow line inside
      float k = fract(vSeed * 13.7), e = min(vEdge.x, vEdge.y);
      alb = k < 0.45 ? vec3(0.27, 0.27, 0.28) : k < 0.8 ? vec3(0.55, 0.56, 0.56) : vec3(0.43, 0.41, 0.38);
      float blot = h12(floor(vW.xz / 2.5) + vSeed * 9.0); blot = mix(blot, 0.5, smoothstep(0.3, 1.0, length(fwidth(vW.xz / 2.5)))); alb *= 0.94 + 0.1 * blot;
      float fe = fwidth(e); alb = mix(mix(vTint, vec3(0.62, 0.6, 0.56), 0.5) * 0.8, mix(alb * 0.72, alb, smoothstep(0.9 - fe, 0.9 + fe, e)), smoothstep(0.35 - fe, 0.35 + fe, e));
    } else {
      vec2 uv = vec2((abs(n.x) > 0.5 ? vW.z : vW.x) / 12.0 + vSeed * 7.0, (vW.y - vBase) / 12.0);
      vec4 f = texture2D(tFac, uv); alb = f.rgb * vTint;
      float bottom = smoothstep(0.0, 1.2, vW.y - vBase); alb *= 0.75 + 0.25 * bottom;
      vec2 wc = floor(uv * 4.0); float lit = step(h12(wc + vSeed * 17.0), 0.34) * (0.6 + 0.4 * h12(wc.yx + 3.0));
      float fw = length(fwidth(uv * 4.0)); lit = mix(lit, 0.13, smoothstep(0.35, 0.9, fw));
      emi = vec3(1.0, 0.72, 0.42) * f.a * lit * uNight * 1.4;
    }
    vec3 col = shade(alb, n);
    float hz = hazeF(vD); col = mix(col, uFogCol, hz) + emi * (1.0 - hz * 0.6);
    gl_FragColor = vec4(col, 1.0);${OUT}
  }`;
function buildSprawl(world, R, texF) {
  const TINTS = [[0.78, 0.42, 0.32], [0.72, 0.5, 0.38], [0.86, 0.78, 0.66], [0.92, 0.9, 0.86], [0.66, 0.36, 0.28], [0.8, 0.68, 0.52], [0.7, 0.72, 0.74], [0.9, 0.84, 0.72]];
  const near = [], far = [], tanks = [], trees = [];
  const bad = (x0, z0, x1, z1) => onRoad(x0, z0, x1, z1) || inExcl(x0, z0, 6) || inExcl(x1, z1, 6) || inExcl(x0, z1, 6) || inExcl(x1, z0, 6) || inExcl((x0 + x1) / 2, (z0 + z1) / 2, 6);
  const put = (list, x0, z0, x1, z1, h, tint, seed) => { if (bad(x0, z0, x1, z1)) { const o = [8, -8, 16, -16, 26, -26].find((dz) => !bad(x0, z0 + dz, x1, z1 + dz)); if (o === undefined) return null; z0 += o; z1 += o; } const e = { x0, z0, x1, z1, h, tint, seed, d: Math.hypot((x0 + x1) / 2 - P0[0], (z0 + z1) / 2 - P0[1]) }; list.push(e); return e; };
  // known tower groups (lat, lon, count, floors)
  const TOWERS = [[40.5795, -73.9695, 7, 23], [40.5818, -73.9655, 5, 22], [40.5772, -73.9560, 4, 15], [40.5790, -73.9745, 3, 18], [40.5955, -74.0010, 3, 20], [40.5835, -73.9550, 3, 20], [40.5870, -73.9635, 2, 17], [40.5800, -73.9460, 2, 14], [40.6060, -73.9780, 2, 16], [40.5960, -73.9580, 3, 21], [40.5920, -73.9440, 2, 18], [40.6100, -73.9600, 3, 14], [40.5835, -73.9380, 3, 16]];
  const towerSpots = [];
  for (const [la, lo, n, fl] of TOWERS) { const [cx, cz] = geo(la, lo); for (let k = 0; k < n; k++) { const x = cx + (k % 3) * 70 - 70 + (R() - 0.5) * 20, z = cz + Math.floor(k / 3) * 70 - 35 + (R() - 0.5) * 20; if (inExcl(x, z, 20) || !isLand(x, z)) continue; towerSpots.push([x, z]); const T = Math.hypot(x - NEAR_C[0], z - NEAR_C[1]) < NEAR_R ? near : far; const w = 22 + R() * 10, d = 16 + R() * 8; put(T, x - w / 2, z - d / 2, x + w / 2, z + d / 2, fl * 2.9, TINTS[(R() * 3) | 0], R()); tanks.push([x + w * 0.2, z, fl * 2.9]); } }
  const nearTower = (x, z) => towerSpots.some(([a, b]) => Math.abs(a - x) < 60 && Math.abs(b - z) < 45);
  const BX = 250, BZ = 80, AV = 26, SW = 18;
  for (let i = -48; i <= 48; i++) for (let j = -150; j <= 40; j++) {
    const x0 = i * BX + AV / 2, x1 = (i + 1) * BX - AV / 2, z0 = j * BZ + SW / 2, z1 = (j + 1) * BZ - SW / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const d = Math.hypot(cx - P0[0], cz - P0[1]); if (d > 12500) continue;
    if (inExcl(x0, z0, 10) && inExcl(x1, z1, 10) && inExcl(x0, z1, 10) && inExcl(x1, z0, 10)) continue;
    const li = isLand(cx, cz); if (li !== 1 && li !== 2) continue;   // brooklyn / rockaway blocks only (the rest is skyline or hills)
    if (!isLand(x0, cz) || !isLand(x1, cz) || parkAt(cx, cz)) continue;
    const isNear = Math.hypot(cx - NEAR_C[0], cz - NEAR_C[1]) < NEAR_R; const T = isNear ? near : far; const hr = hash(i, j);
    if (nearTower(cx, cz)) continue;
    if (d > 6500) { const h = 8 + hash(j, i) * 7 + (hash(i + 7, j) < 0.1 ? 8 : 0); put(T, x0 + 4, z0 + 3, x1 - 4, z1 - 3, h, TINTS[(hr * TINTS.length) | 0], hr); continue; }
    if (!isNear) { for (const [sz0, sz1] of [[z0 + 1.5, z0 + 17.5], [z1 - 17.5, z1 - 1.5]]) { const hh = 7.5 + hash(i, j * 2 + (sz0 > cz)) * 4; put(T, x0 + 1, sz0, x0 + 40, sz1, hh + 8 * (hash(j, i) < 0.5), TINTS[(hash(i, j + 5) * 8) | 0], R()); put(T, x0 + 40, sz0, x1 - 40, sz1, hh, TINTS[(hash(i + 1, j) * 8) | 0], R()); put(T, x1 - 40, sz0, x1 - 1, sz1, hh + 8 * (hash(j, i + 3) < 0.5), TINTS[(hash(i, j + 9) * 8) | 0], R()); } continue; }
    // two strips of attached houses facing the streets, split into runs of 3-8 houses with varied heights; walk-ups on the avenue ends
    for (const [sz0, sz1] of [[z0 + 1.5, z0 + 17.5], [z1 - 17.5, z1 - 1.5]]) {
      let x = x0 + 1;
      while (x < x1 - 4) {
        const avEnd = x < x0 + 30 || x > x1 - 60; const walk = avEnd && hash(i * 3 + (sz0 > cz), j) < 0.55;
        const len = walk ? 26 + R() * 14 : Math.min(x1 - 1 - x, 18 + R() * 30); const h = walk ? 16 + R() * 5 : 7.5 + R() * 3.5 + (R() < 0.15 ? 3 : 0);
        const dz = walk ? 4 : 0;
        const b = put(T, x, sz0 - (sz0 < cz ? 0 : dz), x + len - 0.3, sz1 + (sz0 < cz ? dz : 0), h, TINTS[(R() * TINTS.length) | 0], R());
        if (b && walk && isNear) tanks.push([b.x0 + (b.x1 - b.x0) * (0.3 + R() * 0.4), (b.z0 + b.z1) / 2, h]);   // on the roof put() actually kept (it can shift or drop the block)
        x += len;
      }
    }
    if (isNear) for (let x = x0 + 6; x < x1; x += 14 + R() * 10) for (const z of [z0 - 3.2, z1 + 3.2]) if (R() < 0.75 && !onRoad(x - 1, z - 1, x + 1, z + 1)) trees.push([x, z, 0.8 + R() * 0.5]);
  }
  // roof kit on the near ring's flat roofs: HVAC boxes and a stair bulkhead, as more instances of the same box (aSeed < 0 tells
  // the shader; no extra draw call). Phones get it only close in.
  const kit = []; { const KIT_R = world.ctx.lite ? 700 : 1300;
    for (const b of near) { const w = b.x1 - b.x0, d = b.z1 - b.z0; if (w < 8 || d < 8 || b.d > KIT_R) continue;
      const n = 1 + (R() < 0.5 ? 1 : 0); for (let k = 0; k < n; k++) { const s = 1.6 + R() * 1.2, x = b.x0 + 1.5 + R() * (w - 3 - s), z = b.z0 + 1.5 + R() * (d - 3 - s); kit.push({ x0: x, x1: x + s, z0: z, z1: z + s * 0.7, y0: b.h, h: 0.9 + R() * 0.6, tint: b.tint, seed: -1 }); }
      if (R() < (b.h > 14 ? 0.6 : 0.25)) { const x = b.x0 + 2 + R() * (w - 6.4), z = b.z0 + 2 + R() * (d - 6.4); kit.push({ x0: x, x1: x + 2.4, z0: z, z1: z + 2.4, y0: b.h, h: 2.5, tint: b.tint, seed: -2 }); } }
  }
  // near: unsorted, depth-tested. far: sorted far → near for painter's order
  far.sort((a, b) => b.d - a.d);
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0); box.deleteAttribute('uv');
  { const nz = box.attributes.normal; const keep = []; const idx = box.index.array; for (let t = 0; t < idx.length; t += 3) if (nz.getY(idx[t]) > -0.5) keep.push(idx[t], idx[t + 1], idx[t + 2]); box.setIndex(keep); }   // no bottoms
  const meshes = [];
  const inst = (list, isFar, name) => {
    const m = mat(boxVert, boxFrag, { far: isFar, uniforms: { tFac: { value: texF } } });
    const im = new THREE.InstancedMesh(box, m, list.length); const tint = new Float32Array(list.length * 3), seed = new Float32Array(list.length); const M4 = new THREE.Matrix4();
    list.forEach((b, k) => { M4.makeScale(b.x1 - b.x0, b.h, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, b.y0 || 0, (b.z0 + b.z1) / 2); im.setMatrixAt(k, M4); tint.set(b.tint, k * 3); seed[k] = b.seed; });
    const g = box.clone(); g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3)); g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1)); im.geometry = g;
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); meshes.push(addMesh(world, null, m, { far: isFar, order: isFar ? -985 : 0, name, instanced: im }));
  };
  // S2 (north of Neptune Av, east of Shell Rd): those boxes are built on the facade kit instead (coney/shellrd.js), after all the
  // R() draws above so the rest of the sprawl, its roof kit and the lamps (from the full near list) lay out exactly as before
  const s2 = near.filter((b) => inS2((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)), s2Set = new Set(s2);
  inst(near.filter((b) => !s2Set.has(b)).concat(kit), false, 'sprawlNear'); inst(far, true, 'sprawlFar');
  // water tanks on the walk-ups and towers (near ring): wooden barrel + conical cap on a steel stand
  if (tanks.length) {
    const parts = [new THREE.CylinderGeometry(1.5, 1.5, 3.2, 10, 1, true).translate(0, 3.6, 0), new THREE.ConeGeometry(1.7, 1.2, 10).translate(0, 5.8, 0), new THREE.BoxGeometry(2.4, 2.0, 2.4).translate(0, 1.0, 0)];
    const g = mergeSimple(parts);
    const m = mat(/* glsl */`varying vec3 vN, vW; varying float vD; void main() { vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal); vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w); }`,
      /* glsl */`varying vec3 vN, vW; varying float vD; void main() { vec3 n = normalize(vN); float y = fract(vW.y); vec3 alb = vW.y - floor(vW.y / 100.0) * 100.0 > 0.0 ? vec3(0.36, 0.28, 0.22) : vec3(0.2); vec3 col = shade(alb * (0.85 + 0.15 * step(0.5, fract(atan(n.z, n.x) * 3.0))), n); col = mix(col, uFogCol, hazeF(vD)); gl_FragColor = vec4(col, 1.0);${OUT} }`);
    const im = new THREE.InstancedMesh(g, m, tanks.length); const M4 = new THREE.Matrix4();
    tanks.forEach(([x, z, h], k) => { M4.makeTranslation(x, h, z); im.setMatrixAt(k, M4); }); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    meshes.push(addMesh(world, null, m, { name: 'tanks', instanced: im }));
  }
  // street trees (near ring): two crossed cards
  if (trees.length) {
    const tex = treeTex(R); const a = new THREE.PlaneGeometry(7, 8).translate(0, 4, 0), b = a.clone().rotateY(Math.PI / 2);
    const g = mergeSimple([a, b]);
    const m = mat(/* glsl */`varying vec2 vUv; varying float vD; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w); }`,
      /* glsl */`uniform sampler2D tMap; varying vec2 vUv; varying float vD; varying vec3 vW; void main() { vec4 t = texture2D(tMap, vUv); if (t.a < 0.5) discard; vec3 col = shade(t.rgb * vec3(0.9, 1.0, 0.85), vec3(0.0, 1.0, 0.0)) * 0.9; col = mix(col, uFogCol, hazeF(vD)); gl_FragColor = vec4(col, 1.0);${OUT} }`,
      { uniforms: { tMap: { value: tex } }, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(g, m, trees.length); const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    trees.forEach(([x, z, sc], k) => { q.setFromAxisAngle(up, R() * 3); s.setScalar(sc); p.set(x, 0, z); M4.compose(p, q, s); im.setMatrixAt(k, M4); }); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    meshes.push(addMesh(world, null, m, { name: 'trees', instanced: im }));
  }
  return { meshes, n: near.length + far.length, near, far, towers: towerSpots, s2, tints: TINTS };
}
function mergeSimple(list) {
  const pos = [], nor = [], uv = [];
  for (let g of list) { if (g.index) g = g.toNonIndexed(); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); if (g.attributes.uv) uv.push(...g.attributes.uv.array); else for (let i = 0; i < g.attributes.position.count; i++) uv.push(0, 0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g;
}

// ---- skyline: Manhattan, Jersey City, downtown Brooklyn, LIC + the Verrazzano-Narrows bridge + ships — one merged mesh, objects
// sorted far → near (painter's), per-vertex albedo, night window density and a "crown" flag (lit tops)
function buildSkyline(world, R) {
  const objs = [];
  const obj = (x, z) => { const o = { x, z, p: [], n: [], c: [], l: [] }; objs.push(o); return o; };
  const quad = (o, a, b, c, d, col, lit) => { const e1 = new THREE.Vector3().subVectors(b, a), e2 = new THREE.Vector3().subVectors(d, a), n = new THREE.Vector3().crossVectors(e1, e2).normalize(); for (const v of [a, b, c, a, c, d]) { o.p.push(v.x, v.y, v.z); o.n.push(n.x, n.y, n.z); o.c.push(...col); o.l.push(lit); } };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  /** prism between two horizontal polygons (same vertex count, CCW seen from above) */
  const prism = (o, bot, top, col, lit, capLit = null) => {
    const n = bot.length;
    let ar = 0; for (let i = 0; i < n; i++) { const a = bot[i], b = bot[(i + 1) % n]; ar += a.x * b.z - b.x * a.z; }
    if (ar > 0) { bot = [...bot].reverse(); top = [...top].reverse(); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; quad(o, bot[i], bot[j], top[j], top[i], col, lit); }
    const cc = top.reduce((s, v) => s.add(v), V3(0, 0, 0)).multiplyScalar(1 / n); for (let i = 0; i < n; i++) { const j = (i + 1) % n; quad(o, top[j], cc, cc, top[i], col, capLit ?? lit); }
  };
  const rect = (cx, cz, w, d, y, rot = 0) => { const c = Math.cos(rot), s = Math.sin(rot); return [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2]].map(([a, b]) => V3(cx + a * c - b * s, y, cz + a * s + b * c)); };
  const tower = (o, cx, cz, w, d, y0, y1, col, lit, rot = 0, taper = 1, capLit = null) => prism(o, rect(cx, cz, w, d, y0, rot), rect(cx, cz, w * taper, d * taper, y1, rot), col, lit, capLit);
  const GLASS = [[0.42, 0.5, 0.58], [0.5, 0.56, 0.62], [0.36, 0.42, 0.48], [0.58, 0.62, 0.66]], STONE = [[0.66, 0.62, 0.55], [0.58, 0.52, 0.46], [0.7, 0.68, 0.64], [0.5, 0.44, 0.4]];
  const pick = (r) => (r < 0.55 ? GLASS : STONE)[(r * 97 | 0) % 4];
  const ROT = -29 * D2R + 8.33 * D2R;   // Manhattan's street grid (29° east of true north) in the map frame
  const cluster = (la, lo, rad, n, h0, h1, rot = ROT, pow = 2) => { const [cx, cz] = geo(la, lo); for (let k = 0; k < n; k++) { const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rad; const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.7; const f = 1 - r / rad; const h = h0 + (h1 - h0) * Math.pow(R(), pow) * (0.5 + 0.5 * f); const w = 22 + R() * 30, d = 20 + R() * 25; const o = obj(x, z); const r2 = R(); tower(o, x, z, w, d, 0, h, pick(r2), 0.25 + R() * 0.3, rot); if (h > 150 && R() < 0.5) tower(o, x, z, w * 0.7, d * 0.7, h, h + 8 + R() * 25, pick(r2), 0.2, rot); } };
  // Manhattan
  cluster(40.7075, -74.0105, 650, 70, 70, 260);             // Financial District
  cluster(40.7200, -74.0050, 900, 60, 25, 90);              // Tribeca / SoHo / Village low
  cluster(40.7350, -73.9950, 1200, 70, 25, 110);            // Chelsea / Flatiron / Union Sq
  cluster(40.7560, -73.9830, 1100, 160, 80, 300, ROT, 1.6); // Midtown
  cluster(40.7520, -74.0000, 450, 16, 120, 300);            // Hudson Yards / Manhattan West
  cluster(40.7750, -73.9600, 1300, 60, 40, 160);            // Upper East Side
  cluster(40.7800, -73.9800, 1100, 50, 40, 140);            // Upper West Side
  cluster(40.8100, -73.9500, 1500, 40, 25, 80);             // Harlem
  cluster(40.7200, -74.0350, 600, 32, 60, 230);             // Jersey City waterfront
  cluster(40.7450, -74.0290, 700, 22, 25, 70);              // Hoboken
  cluster(40.6920, -73.9860, 500, 32, 60, 200);             // downtown Brooklyn
  cluster(40.7470, -73.9450, 500, 18, 60, 220);             // Long Island City
  cluster(40.6520, -74.0850, 1500, 18, 20, 60);             // Bayonne
  // landmarks (lat, lon) — heights to roof / spire
  const L = (la, lo) => geo(la, lo);
  { const [x, z] = L(40.7127, -74.0134); const o = obj(x, z); const b = rect(x, z, 61, 61, 0, ROT), mid = rect(x, z, 61, 61, 57, ROT); tower(o, x, z, 61, 61, 0, 57, [0.55, 0.6, 0.66], 0.3, ROT);
    const top = rect(x, z, 43, 43, 417, ROT + Math.PI / 4); prism(o, mid, top.slice(0, 4), [0.6, 0.68, 0.76], 0.35, 0.1);   // One WTC: chamfered taper, square rotated 45°
    tower(o, x, z, 3, 3, 417, 541, [0.85, 0.85, 0.85], 3, ROT, 0.4); o.crownY = 417; }
  { const [x, z] = L(40.7484, -73.9857); const o = obj(x, z); const c = [0.62, 0.6, 0.55];   // Empire State
    tower(o, x, z, 130, 60, 0, 25, c, 0.3, ROT); tower(o, x, z, 90, 52, 25, 80, c, 0.35, ROT); tower(o, x, z, 60, 46, 80, 265, c, 0.4, ROT); tower(o, x, z, 44, 36, 265, 320, c, 0.4, ROT); tower(o, x, z, 30, 26, 320, 373, c, 0.5, ROT, 0.9, 2);
    tower(o, x, z, 14, 14, 373, 390, [0.8, 0.8, 0.75], 2, ROT, 0.8); tower(o, x, z, 5, 5, 390, 443, [0.7, 0.7, 0.7], 1.5, ROT, 0.2); }
  { const [x, z] = L(40.7516, -73.9755); const o = obj(x, z); const c = [0.72, 0.72, 0.7];   // Chrysler: stepped crown + needle
    tower(o, x, z, 60, 50, 0, 60, c, 0.35, ROT); tower(o, x, z, 42, 42, 60, 240, c, 0.35, ROT);
    for (let k = 0; k < 6; k++) tower(o, x, z, 40 - k * 6, 40 - k * 6, 240 + k * 9, 249 + k * 9, [0.86, 0.86, 0.84], 3, ROT, 0.9);
    tower(o, x, z, 4, 4, 294, 319, [0.8, 0.8, 0.8], 2, ROT, 0.1); }
  const slim = (la, lo, w, d, h, col, lit = 0.3, spire = 0, taper = 1) => { const [x, z] = L(la, lo); const o = obj(x, z); tower(o, x, z, w, d, 0, h, col, lit, ROT, taper); if (spire) tower(o, x, z, 4, 4, h, h + spire, [0.8, 0.8, 0.8], 1, ROT, 0.2); return o; };
  slim(40.7616, -73.9719, 29, 29, 426, [0.78, 0.78, 0.76], 0.45);        // 432 Park
  slim(40.7663, -73.9810, 60, 42, 472, [0.5, 0.58, 0.66], 0.35);         // Central Park Tower
  slim(40.7646, -73.9775, 18, 60, 435, [0.62, 0.6, 0.56], 0.35, 0, 0.75); // 111 W 57th (tapering)
  slim(40.7530, -73.9786, 70, 55, 390, [0.56, 0.62, 0.68], 0.4, 37, 0.55); // One Vanderbilt
  slim(40.7539, -74.0011, 60, 50, 387, [0.52, 0.6, 0.66], 0.35);         // 30 Hudson Yards
  slim(40.7555, -73.9845, 50, 50, 288, [0.6, 0.66, 0.7], 0.35, 78, 0.8);   // Bank of America Tower
  slim(40.7565, -73.9900, 55, 45, 228, [0.62, 0.64, 0.66], 0.35, 91);     // NY Times
  slim(40.7617, -73.9777, 40, 40, 320, [0.36, 0.38, 0.4], 0.35);          // 53W53
  slim(40.7143, -74.0097, 50, 50, 297, [0.4, 0.44, 0.5], 0.35);           // 3 WTC
  slim(40.7101, -74.0120, 55, 55, 297, [0.5, 0.56, 0.62], 0.35);          // 4 WTC
  slim(40.7059, -74.0086, 40, 40, 283, [0.42, 0.46, 0.5], 0.3, 0);        // 40 Wall St-ish
  slim(40.6904, -73.9832, 36, 36, 327, [0.3, 0.3, 0.32], 0.35);           // The Brooklyn Tower
  slim(40.7170, -74.0375, 40, 40, 272, [0.66, 0.68, 0.7], 0.35);         // Jersey City 99 Hudson
  slim(40.7472, -73.9430, 36, 36, 237, [0.6, 0.64, 0.68], 0.35);          // LIC Skyline Tower
  // ---- the Verrazzano-Narrows bridge: two 211 m towers 1298 m apart, deck at ~69 m, side spans to anchorages, approaches
  const A = V3(...(() => { const [x, z] = geo(40.6084, -74.0381); return [x, 0, z]; })()), B = V3(...(() => { const [x, z] = geo(40.6032, -74.0520); return [x, 0, z]; })());
  const mid = A.clone().add(B).multiplyScalar(0.5), ax = B.clone().sub(A).setY(0).normalize(), sd = V3(-ax.z, 0, ax.x);
  const TA = mid.clone().addScaledVector(ax, -649), TB = mid.clone().addScaledVector(ax, 649);
  const BR = [0.58, 0.62, 0.6], brot = Math.atan2(ax.z, ax.x);
  const deckY = (t) => 62 + 10 * (1 - t * t);   // t: -1..1 along the main span
  const bridgeCables = [], bridgeLights = [];
  for (const T of [TA, TB]) {
    const o = obj(T.x, T.z);
    for (const s of [-1, 1]) { const c = T.clone().addScaledVector(sd, s * 19); tower(o, c.x, c.z, 11, 9, 0, 211, BR, 0, brot, 0.75); }
    for (const [y0, y1] of [[60, 66], [128, 134], [196, 206]]) tower(o, T.x, T.z, 8, 40, y0, y1, BR, 0, brot);
    tower(o, T.x, T.z, 30, 60, -3, 4, [0.4, 0.4, 0.38], 0, brot);
  }
  const segs = 26; const pts = (u) => mid.clone().addScaledVector(ax, u);
  for (let k = 0; k < segs; k++) {   // main span deck (arched), then side spans
    const u0 = -649 + 1298 * k / segs, u1 = -649 + 1298 * (k + 1) / segs; const p0 = pts(u0), p1 = pts(u1); const o = obj((p0.x + p1.x) / 2, (p0.z + p1.z) / 2);
    const y0 = deckY(u0 / 649), y1 = deckY(u1 / 649); const bb = [p0.clone().addScaledVector(sd, -16), p0.clone().addScaledVector(sd, 16), p1.clone().addScaledVector(sd, 16), p1.clone().addScaledVector(sd, -16)];
    const lo = bb.map((v, i) => V3(v.x, (i < 2 ? y0 : y1) - 8, v.z)), hi = bb.map((v, i) => V3(v.x, (i < 2 ? y0 : y1), v.z)); prism(o, lo, hi, [0.5, 0.54, 0.52], 0);
  }
  for (const s of [-1, 1]) for (let k = 0; k < 8; k++) {   // side spans + approach viaducts sloping down
    const u0 = s * (649 + k * 120), u1 = s * (649 + (k + 1) * 120); const p0 = pts(u0), p1 = pts(u1); const o = obj((p0.x + p1.x) / 2, (p0.z + p1.z) / 2);
    const y = (u) => { const e = Math.abs(u) - 649; return e < 370 ? 62 - e * 0.02 : Math.max(8, 55 - (e - 370) * 0.08); };
    const bb = [p0.clone().addScaledVector(sd, -16), p0.clone().addScaledVector(sd, 16), p1.clone().addScaledVector(sd, 16), p1.clone().addScaledVector(sd, -16)];
    prism(o, bb.map((v, i) => V3(v.x, (i < 2 ? y(u0) : y(u1)) - 6, v.z)), bb.map((v, i) => V3(v.x, (i < 2 ? y(u0) : y(u1)), v.z)), [0.5, 0.54, 0.52], 0);
    if (k % 2 === 1) tower(o, p1.x, p1.z, 30, 8, 0, y(u1) - 6, [0.45, 0.45, 0.43], 0, brot);
    if (k === 3) tower(o, p1.x, p1.z, 50, 60, 0, 30, [0.5, 0.48, 0.45], 0, brot);   // anchorage
  }
  // main cables (4, two per side) + suspenders as 1-px lines; the "necklace" bulbs along the cables
  for (const s of [-1, 1]) {
    const cab = (u) => { const t = u / 649; if (Math.abs(t) <= 1) return 211 - (211 - 76) * (1 - t * t); const e = (Math.abs(u) - 649) / 370; return 211 - (211 - 60) * Math.min(1, e) * (2 - Math.min(1, e)) * 0.95; };
    let prev = null;
    for (let u = -1019; u <= 1019; u += 18) { const p = pts(u).addScaledVector(sd, s * 17); const y = cab(u); const v = V3(p.x, y, p.z); if (prev) bridgeCables.push(prev, v); prev = v;
      if (Math.abs(u) < 649) { const dy = deckY(u / 649); if (y - dy > 3) bridgeCables.push(V3(p.x, y, p.z), V3(p.x, dy, p.z)); }
      if (Math.abs(u) <= 1019 && (Math.round(u / 18) % 2 === 0)) bridgeLights.push([p.x, y + 0.5, p.z]); }
  }
  for (const T of [TA, TB]) for (const s of [-1, 1]) { const c = T.clone().addScaledVector(sd, s * 19); bridgeLights.push([c.x, 214, c.z, 1]); }
  // ---- ships: container ship + tankers at the Gravesend Bay anchorage / Ambrose approach / open ocean
  const ship = (la, lo, len, heading, kind) => { const [x, z] = geo(la, lo); const o = obj(x, z); const hull = kind === 'box' ? [0.18, 0.2, 0.24] : [0.35, 0.12, 0.1];
    tower(o, x, z, len, len * 0.14, -2, 9, hull, 0, heading); tower(o, x, z, len * 0.98, len * 0.13, 9, 10.5, [0.3, 0.28, 0.26], 0, heading);
    const fwd = V3(Math.cos(heading), 0, Math.sin(heading));
    if (kind === 'box') for (let k = -4; k <= 3; k++) { const c = V3(x, 0, z).addScaledVector(fwd, k * len * 0.1); tower(o, c.x, c.z, len * 0.085, len * 0.125, 10.5, 10.5 + 8 + (k & 1) * 3, [[0.55, 0.2, 0.16], [0.2, 0.35, 0.55], [0.6, 0.55, 0.45], [0.25, 0.45, 0.3]][(k + 8) % 4], 0, heading); }
    const st = V3(x, 0, z).addScaledVector(fwd, -len * 0.42); tower(o, st.x, st.z, len * 0.08, len * 0.12, 10.5, 30, [0.86, 0.86, 0.84], 1.2, heading); tower(o, st.x, st.z, len * 0.03, len * 0.03, 30, 40, [0.3, 0.3, 0.3], 0, heading);
    o.lights = [[st.x, 41, st.z], [x + fwd.x * len * 0.48, 16, z + fwd.z * len * 0.48]]; };
  ship(40.5850, -74.0350, 230, 20 * D2R, 'box');
  ship(40.5780, -74.0520, 180, -35 * D2R, 'tank');
  ship(40.5620, -74.0250, 200, 60 * D2R, 'tank');
  ship(40.5300, -73.9600, 280, 5 * D2R, 'box');
  ship(40.5000, -73.9100, 190, -10 * D2R, 'tank');
  ship(40.5450, -74.0900, 160, 40 * D2R, 'box');
  // ---- merge far → near
  for (const o of objs) o.d = Math.hypot(o.x - P0[0], o.z - P0[1]);
  objs.sort((a, b) => b.d - a.d);
  const pos = [], nor = [], col = [], lit = [];
  for (const o of objs) { pos.push(...o.p); nor.push(...o.n); col.push(...o.c); lit.push(...o.l); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aLit', new THREE.Float32BufferAttribute(lit, 1));
  const m = mat(/* glsl */`
    attribute vec3 aCol; attribute float aLit; varying vec3 vCol, vN, vW; varying float vLit, vD;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vCol = aCol; vLit = aLit; vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w); }`, /* glsl */`
    varying vec3 vCol, vN, vW; varying float vLit, vD;
    void main() {
      vec3 n = normalize(vN); vec3 col = shade(vCol, n);
      // sky reflection on the glass faces (the evening towers pick up the western glow)
      col += vCol * uAmbSky * 0.12 * max(n.y + 0.3, 0.0);
      vec3 emi = vec3(0.0);
      if (vLit > 0.0 && vLit < 1.0) { float band = h12(floor(vec2(vW.y / 9.0, (vW.x + vW.z) / 14.0))); emi = vec3(1.0, 0.78, 0.5) * vLit * (0.4 + 0.9 * band) * uNight * 1.3; }
      else if (vLit >= 1.0) emi = (vLit > 2.5 ? vec3(0.95, 0.95, 1.0) : vLit > 1.8 ? vec3(0.9, 0.95, 1.0) : vec3(1.0, 0.9, 0.7)) * uNight * 2.5;
      float hz = hazeF(vD); col = mix(col, uFogCol, hz) + emi * (1.0 - hz * 0.55);
      gl_FragColor = vec4(col, 1.0);${OUT}
    }`, { far: true });
  const mesh = addMesh(world, g, m, { far: true, order: -980, name: 'skyline' });
  const lg = new THREE.BufferGeometry().setFromPoints(bridgeCables);
  const lm = mat(/* glsl */`varying float vD; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vD = distance(w.xyz, cameraPosition); gl_Position = farProj(w); }`,
    /* glsl */`varying float vD; void main() { vec3 col = shade(vec3(0.5, 0.52, 0.5), vec3(0.0, 1.0, 0.0)); col = mix(col, uFogCol, hazeF(vD) * 0.9); gl_FragColor = vec4(col, 1.0);${OUT} }`, { far: true });
  const lines = new THREE.LineSegments(lg, lm); addMesh(world, null, lm, { far: true, order: -979, name: 'bridgeCables', instanced: lines });
  // aviation / crown lights for the tall ones, ship lights
  const air = []; for (const o of objs) { if (o.lights) air.push(...o.lights.map((p) => [...p, 2])); }
  for (const [la, lo, h] of [[40.7127, -74.0134, 541], [40.7484, -73.9857, 443], [40.7616, -73.9719, 426], [40.7663, -73.9810, 472], [40.7646, -73.9775, 435], [40.7530, -73.9786, 427], [40.7539, -74.0011, 387], [40.6904, -73.9832, 327], [40.7555, -73.9845, 366]]) { const [x, z] = geo(la, lo); air.push([x, h + 2, z, 3]); }
  return { meshes: [mesh, lines], bridgeLights, air };
}

// ---- lights: glow points (far: necklace / aviation / ships; near: lamps, the rides, parkway traffic), light pools under lamps
const ptsVert = /* glsl */`
  attribute vec3 aCol; attribute float aSize, aPh; uniform float uPx, uMin, uI; varying vec3 vC; varying float vA;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0); float d = distance(w.xyz, cameraPosition);
#ifdef TRAFFIC
    // aPh = segment-local phase; position = segment start, aCol.x/z hijacked? no: traffic uses aDir attribute
#endif
    gl_Position = farProj(w);
    float px = aSize * uPx / max(d, 1.0); gl_PointSize = clamp(px, uMin, 64.0);
    float tw = aPh < 0.0 ? 1.0 : 0.65 + 0.35 * sin(uTime * (2.0 + fract(aPh * 7.3) * 3.0) + aPh * 40.0);
#ifdef CHASE
    tw = 0.25 + 0.75 * step(0.5, fract(aPh * 3.0 - uTime * 0.8));
#endif
    vC = aCol * tw; vA = uI * uNight * clamp(px / uMin, 0.35, 1.0) * (1.0 - hazeF(d) * 0.75);
  }`;
const ptsFrag = /* glsl */`
  varying vec3 vC; varying float vA;
  void main() { vec2 q = gl_PointCoord - 0.5; float r = dot(q, q) * 4.0; float a = (exp(-r * 6.0) + 0.3 * exp(-r * 2.2)) * (1.0 - smoothstep(0.55, 1.0, r)); if (a < 0.005) discard; gl_FragColor = vec4(vC * a * vA, 1.0); }`;
function points(world, list, { far = false, order, name, size = 1, min = 2, I = 1, chase = false, parent = null }) {
  const pos = [], col = [], sz = [], ph = [];
  for (const q of list) { pos.push(q[0], q[1], q[2]); col.push(...(q[3] || [1, 0.85, 0.6])); sz.push((q[4] ?? 1) * size); ph.push(q[5] ?? Math.random()); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1)); g.computeBoundingSphere();
  const m = mat(ptsVert, ptsFrag, { far, uniforms: { uMin: { value: min }, uI: { value: I } }, defines: chase ? { CHASE: 1 } : {}, transparent: !far, depthWrite: false, blending: THREE.AdditiveBlending });
  if (far) m.depthTest = false;
  const p = new THREE.Points(g, m); p.name = 'horizon:' + name; p.frustumCulled = false; p.renderOrder = order ?? (far ? -970 : 5);
  (parent || world.scene).add(p); return p;
}
function buildLights(world, R, sprawl, sky) {
  const { scene } = world; const M = world.mats || {}; const out = [];
  const warm = [1, 0.78, 0.5], cool = [0.85, 0.9, 1];
  // far: bridge necklace (cool white), aviation reds, crown lights, ship deck lights
  out.push(points(world, [...sky.bridgeLights.map(([x, y, z, t]) => [x, y, z, t ? [1, 0.15, 0.1] : [0.95, 0.95, 1], 2.4, -1]), ...sky.air.map(([x, y, z, t]) => [x, y, z, t === 3 ? [1, 0.2, 0.12] : [1, 0.85, 0.6], 5])], { far: true, name: 'farLights', size: 1.4, min: 1.6, I: 1.3 }));
  // near sprawl: a few street lamps per block front + tower windows are in the shader
  const lamps = []; for (const b of sprawl.near) if (R() < 0.35) lamps.push([b.x0 + (b.x1 - b.x0) * R(), 7, (b.z0 + b.z1) / 2 + ((b.z0 + b.z1) / 2 > 0 ? 1 : -1) * 0, [1, 0.62, 0.3], 3]);
  // the scene's own lamps: globe / lens / bulb meshes → cluster centres
  const lampMats = new Set([M.lampLens, M.lampHead].filter(Boolean)); const bulbMat = M.bulb;
  const cl = new Map(); const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !lampMats.has(o.material)) return; const p = o.geometry.attributes.position; o.updateWorldMatrix(true, false);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y < 4) continue; const k = Math.round(v.x / 1.2) + ',' + Math.round(v.z / 1.2) + ',' + Math.round(v.y / 2); const c = cl.get(k); if (c) { c[0] += v.x; c[1] += v.y; c[2] += v.z; c[3]++; } else cl.set(k, [v.x, v.y, v.z, 1]); }
  });
  const sceneLamps = []; for (const [x, y, z, n] of cl.values()) sceneLamps.push([x / n, y / n - 0.2, z / n]);
  const lampDedup = []; for (const p of sceneLamps) if (!lampDedup.some((q) => Math.abs(q[0] - p[0]) < 1 && Math.abs(q[2] - p[2]) < 1 && Math.abs(q[1] - p[1]) < 1.5)) lampDedup.push(p);
  // the Luna towers' entrance canopies (downlights under the steel canopy, a pool on the path)
  for (const [x, y, z] of world.W.extraLamps || []) lampDedup.push([x, y - 0.2, z]);   // Brighton Beach Av's lamps (its own materials)
  for (const t of world.lunaTowers || []) for (const d of t.lobby.doors) { const o = d.outside.clone().sub(d.plane).setY(0).normalize(); lampDedup.push([d.plane.x + o.x * 3.2, 2.9, d.plane.z + o.z * 3.2]); }
  out.push(points(world, [...lamps, ...lampDedup.map(([x, y, z]) => [x, y, z, [1, 0.82, 0.55], 1.2, -1])], { name: 'lamps', size: 1.6, min: 1.5, I: 1.2 }));
  // light pools on the ground under the scene's lamps (additive discs)
  if (lampDedup.length) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({ uniforms: { uNight: U.uLamp }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uNight; varying vec2 vUv; void main() { float r = length(vUv - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.2); gl_FragColor = vec4(vec3(1.0, 0.7, 0.38) * a * uNight * 0.22, 1.0); }' });
    const im = new THREE.InstancedMesh(g, m, lampDedup.length); const M4 = new THREE.Matrix4();
    const gh = world.W.groundHeight || (() => 0);
    lampDedup.forEach(([x, y, z], k) => { const gy = Math.max(gh(x, z), y > 9 ? 0 : 0); M4.makeScale(16, 1, 16).setPosition(x, gy + 0.06, z); im.setMatrixAt(k, M4); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); out.push(addMesh(world, null, m, { name: 'lampPools', order: 4, instanced: im }));
  }
  // the rides: bulbs along the wheel's rim + spokes (child of the turning wheel), the parachute tower lattice + crown, the coasters' rails
  const strutPts = (im, step, maxN, colFn, yMin = 2) => {
    const res = []; const m4 = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let k = 0; k < im.count && res.length < maxN; k++) { im.getMatrixAt(k, m4); a.set(0, -0.5, 0).applyMatrix4(m4); b.set(0, 0.5, 0).applyMatrix4(m4); const L = a.distanceTo(b); const n = Math.max(1, Math.round(L / step)); for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); if (p.y < yMin) continue; res.push([p.x, p.y, p.z, colFn(p, k, i), 1, (k * 0.13 + i * 0.07) % 1]); } }
    return res;
  };
  let pink = null, green = null, pj = null, rails = [];
  scene.traverse((o) => { if (!o.isInstancedMesh) return; if (o.name === 'wheelPink') pink = o; else if (o.name === 'wheelGreen') green = o; else if (o.name === 'pjLattice') pj = o; else if (o.name === 'coasterRail' || o.name === 'steelTrack') rails.push(o); });
  const WC = [[1, 0.25, 0.3], [0.3, 1, 0.45], [1, 0.9, 0.5], [0.4, 0.6, 1]];
  if (pink) { const list = [...strutPts(pink, 1.4, 1200, (p, k) => WC[k % 4], -99), ...(green ? strutPts(green, 2.2, 700, () => [1, 0.85, 0.55], -99) : [])]; out.push(points(world, list, { name: 'wheelBulbs', size: 0.9, min: 1.3, I: 1.4, parent: pink.parent, chase: true })); }
  if (pj) { const list = strutPts(pj, 3.5, 1500, (p) => p.y > 62 ? [1, 0.35, 0.25] : [1, 0.85, 0.6], 8).filter((q, i) => q[1] > 60 || i % 2 === 0); out.push(points(world, list, { name: 'pjBulbs', size: 0.9, min: 1.3, I: 1.2 })); }
  for (const r of rails) out.push(points(world, strutPts(r, 3, 900, () => [1, 0.88, 0.62], 1), { name: 'railBulbs', size: 0.7, min: 1.2, I: 1.0 }));
  // Belt Parkway traffic: head / tail lights drifting along the ribbon
  const belt = world.W.horizonBelt; if (belt) {
    const tr = []; for (let i = 0; i + 1 < belt.length; i++) { const [ax, az] = belt[i], [bx, bz] = belt[i + 1]; const L = Math.hypot(bx - ax, bz - az); const nx = -(bz - az) / L, nz = (bx - ax) / L; for (let s = 0; s < L; s += 24) for (const side of [-1, 1]) if (R() < 0.6) { const t = s / L; tr.push([ax + (bx - ax) * t + nx * side * 7, 0.9, az + (bz - az) * t + nz * side * 7, side > 0 ? [1, 0.95, 0.85] : [1, 0.12, 0.08], 1, R()]); } }
    out.push(points(world, tr, { name: 'traffic', size: 1.1, min: 1.2, I: 0.9 }));
  }
  // flat-ride / sign bulbs already in the scene: brighter at night (handled in the cycle via M.bulb)
  return out;
}

// ---- fireworks over the beach: a salvo every 20 s, deterministic from wall-clock time (every client sees the same shells) ------
function buildFireworks(world) {
  const SLOTS = 8, N = 600; const pos = [], dir = [], slot = [], kk = [];
  const r = rng(7);
  for (let s = 0; s < SLOTS; s++) for (let i = 0; i < N; i++) { let x, y, z; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.05); const l = Math.hypot(x, y, z); const sp = 0.85 + r() * 0.15; dir.push(x / l * sp, y / l * sp, z / l * sp); pos.push(0, 0, 0); slot.push(s); kk.push(r()); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3)); g.setAttribute('aSlot', new THREE.Float32BufferAttribute(slot, 1)); g.setAttribute('aK', new THREE.Float32BufferAttribute(kk, 1));
  const uS = { value: Array.from({ length: SLOTS }, () => new THREE.Vector4(0, 0, 0, -1)) }, uC = { value: Array.from({ length: SLOTS }, () => new THREE.Vector4(1, 1, 1, 0)) }, uB = { value: Array.from({ length: SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) };
  const m = mat(/* glsl */`
    uniform vec4 uS[${SLOTS}], uC[${SLOTS}], uB[${SLOTS}]; uniform float uPx;
    attribute vec3 aDir; attribute float aSlot, aK; varying vec3 vC; varying float vA;
    void main() {
      int s = int(aSlot + 0.5); vec4 S = uS[s], C = uC[s], B = uB[s];   // S: burst point + age · C: rgb + type · B: launch point + radius
      float age = S.w; vec3 p; float a = 0.0; float size = 2.2;
      if (age < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vC = vec3(0.0); return; }
      float tl = 1.6;
      if (age < tl) {                       // rising shell: a short comet of the first ~6% particles
        if (aK > 0.06) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vC = vec3(0.0); return; }
        float u = age / tl; float lag = aK * 2.5; vec3 base = B.xyz; float k = clamp((age - lag * 0.1) / tl, 0.0, 1.0); k = 1.0 - (1.0 - k) * (1.0 - k);
        p = mix(base, S.xyz, k); a = (1.0 - aK * 12.0) * 0.9; size = 1.6; vC = vec3(1.0, 0.75, 0.4);
      } else {
        float t = age - tl; float type = C.w; vec3 d = aDir;
        if (type > 1.5 && type < 2.5) { d = normalize(vec3(aDir.x, aDir.y * 0.12, aDir.z)) * length(aDir); }   // ring
        float drag = type > 2.5 ? 1.2 : 1.9; float rad = B.w;
        p = S.xyz + d * rad * (1.0 - exp(-t * drag)) + vec3(0.0, -1.0, 0.0) * (type > 2.5 ? 9.0 : 5.0) * t * t * 0.5;
        float life = type > 2.5 ? 4.6 : 3.0 + aK * 0.8; float f = clamp(1.0 - t / life, 0.0, 1.0);
        a = f * f * (0.55 + 0.45 * step(0.5, fract(t * 9.0 + aK * 5.0)));
        vec3 col = C.rgb; if (type > 3.5) col = mix(C.rgb, vec3(0.9, 0.95, 1.0), step(0.5, aK));   // two-colour peony
        vC = mix(vec3(1.0, 0.95, 0.85), col, smoothstep(0.0, 0.15, t)) * (1.6 + 3.0 * exp(-t * 6.0));
        size = 4.2 * (0.6 + 0.6 * f);
      }
      vec4 w = modelMatrix * vec4(p, 1.0); float dist = distance(w.xyz, cameraPosition);
      gl_Position = projectionMatrix * viewMatrix * w; float px = size * uPx / max(dist, 1.0); gl_PointSize = clamp(px, 1.5, 48.0);
      vA = a * clamp(px / 1.5, 0.4, 1.0) * (1.0 - hazeF(dist) * 0.5);
    }`, ptsFrag, { uniforms: { uS, uC, uB }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Points(g, m); mesh.name = 'horizon:fireworks'; mesh.frustumCulled = false; mesh.renderOrder = 6; world.scene.add(mesh);
  const PAL = [[1, 0.25, 0.2], [0.3, 0.6, 1], [1, 0.8, 0.3], [0.4, 1, 0.5], [1, 0.4, 0.9], [1, 1, 1], [1, 0.55, 0.15], [0.6, 0.4, 1]];
  const PERIOD = 20, SHELLS = 6, OFFS = [0, 0.8, 1.5, 2.6, 3.3, 4.4];
  const flash = new THREE.Color(); let flashK = 0;
  /** t = wall-clock seconds (double, from Date.now()), on = 0..1 */
  const update = (t, on) => {
    t += fwApi.offset; const k = Math.floor(t / PERIOD); let s = 0; flashK = 0; flash.setRGB(0, 0, 0);
    for (const show of [k - 1, k]) for (let i = 0; i < SHELLS && s < SLOTS; i++) {
      const start = show * PERIOD + OFFS[i] + hash(show, i) * 0.6, age = t - start; if (age < 0 || age > 8 || on < 0.5) continue;
      const hx = hash(show * 7 + i, 11), hz = hash(show * 13 + i, 5), hy = hash(show, i * 3 + 1), ht = hash(show + 3, i + 9);
      const bx = -140 + hx * 280, bz = 350 + hz * 50, by = 120 + hy * 70; const type = ht < 0.4 ? 1 : ht < 0.55 ? 2 : ht < 0.78 ? 3 : 4;
      const c = type === 3 ? [1, 0.75, 0.35] : PAL[(hash(show, i + 20) * PAL.length) | 0];
      uS.value[s].set(bx, by, bz, age); uC.value[s].set(c[0], c[1], c[2], type); uB.value[s].set(bx - 10 + hx * 20, 0, 368, type === 3 ? 75 : 55 + hy * 30);
      if (age > 1.6 && age < 2.6) { const f = Math.exp(-(age - 1.6) * 4); flash.r += c[0] * f; flash.g += c[1] * f; flash.b += c[2] * f; flashK += f; }
      s++;
    }
    mesh.visible = s > 0;
    for (; s < SLOTS; s++) uS.value[s].w = -1;
  };
  const fwApi = { mesh, update, flash, offset: 0, get flashK() { return flashK; },
    /** QA: shift the show so a salvo is `sec` seconds old right now */ qaAt(sec = 3.2) { const t = Date.now() / 1000; fwApi.offset = (sec - (t % PERIOD) + PERIOD) % PERIOD; } };
  return fwApi;
}

// ---- the sky dome: gradient + sun glow + the HDRI's clouds re-lit for the hour + stars + moon ---------------------------------
function buildSkyDome(world) {
  const u = { uSky: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uDisc: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3(0.5, 0.5, 0.6).normalize() },
    uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() }, tSky: { value: null }, uRot: { value: 0 }, uHasSky: { value: 0 }, uCityGlow: { value: new THREE.Color(0x000000) } };
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, uniforms: { ...U, ...u },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: HEAD + /* glsl */`
      uniform vec3 uSky, uHorizon, uGlow, uDisc, uMoonDir, uCloudLit, uCloudDark, uCityGlow; uniform sampler2D tSky; uniform float uRot, uHasSky; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir); float e = d.y;
        float t = pow(1.0 - clamp(e, 0.0, 1.0), 4.0);
        vec3 col = mix(uSky, uHorizon, t);
        float sd = max(dot(d, uSunDir), 0.0); float az = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0);
        col += uGlow * (pow(sd, 6.0) * 0.55 + pow(sd, 60.0) * 0.9) + uGlow * pow(az, 3.0) * t * 0.35;
        col += uDisc * smoothstep(0.99965, 0.9999, sd);
        // city glow on the northern horizon at night (Manhattan / Brooklyn light dome)
        col += uCityGlow * pow(max(-d.z * 0.9 + 0.1, 0.0), 1.5) * pow(1.0 - clamp(e, 0.0, 1.0), 10.0);
        if (uHasSky > 0.5 && e > -0.03) {
          float c = cos(uRot), s = sin(uRot); vec3 r = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
          vec2 uv = vec2(atan(r.z, r.x) * 0.15915494 + 0.5, asin(clamp(r.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          vec3 h = texture2D(tSky, uv).rgb; float mx = max(max(h.r, h.g), h.b), mn = min(min(h.r, h.g), h.b);
          float cl = smoothstep(0.62, 0.86, mn / max(mx, 1e-4)) * smoothstep(-0.01, 0.06, e) * step(mx, 6.0);
          float lum = clamp(dot(h, vec3(0.3, 0.5, 0.2)) / 2.2, 0.0, 1.0);
          vec3 cc = mix(uCloudDark, uCloudLit, smoothstep(0.1, 0.9, lum)) + uGlow * pow(sd, 3.0) * 0.9 * lum;
          col = mix(col, cc, cl * 0.9);
        }
        if (uNight > 0.01 && e > 0.0) {
          vec3 p = floor(d * 420.0); float hs = h12(p.xy + p.z * 17.31);
          float star = step(0.9975, hs) * (0.5 + 0.5 * sin(uTime * (1.5 + hs * 4.0) + hs * 60.0));
          col += vec3(0.85, 0.9, 1.0) * star * uNight * smoothstep(0.02, 0.25, e) * 1.2;
          float md = dot(d, uMoonDir); col += uNight * (vec3(1.1, 1.08, 1.0) * smoothstep(0.99988, 0.99993, md) * 4.0 + vec3(0.1, 0.12, 0.17) * pow(max(md, 0.0), 2500.0) + vec3(0.03, 0.035, 0.05) * pow(max(md, 0.0), 60.0));
        }
        col = mix(col, uFogCol, smoothstep(0.015, -0.02, e));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), m); dome.name = 'horizon:sky'; dome.frustumCulled = false; dome.renderOrder = -1001;
  dome.onBeforeRender = (r, s, cam) => { dome.position.copy(cam.getWorldPosition(_v)); dome.updateMatrixWorld(); };
  world.scene.add(dome); return { dome, u };
}
const _v = new THREE.Vector3();

// ---- the cycle -------------------------------------------------------------------------------------------------------------
// keyframes: s = 0 golden hour · 0.3 sunset · 0.5 dusk · 0.72 blue hour · 1 night
const KEYS = [
  { s: 0.00, el: 9, key: 7.5, keyC: 0xffd29a, hS: 0xa4b6d6, hG: 0x7a6650, hI: 0.72, fill: 0.3, zen: 0x4f7fc0, hor: 0xf1cfa8, glow: 0xffa860, disc: 0xfff0c0, fog: 0xdcc6b0, fogD: 0.00028, exp: 0.92, env: 0.6, cL: 0xfff0dc, cD: 0x9aa0b5, night: 0, lamp: 0, city: 0x000000 },
  { s: 0.30, el: 0.6, key: 2.0, keyC: 0xff9a55, hS: 0x8a98c0, hG: 0x5a4a44, hI: 0.5, fill: 0.2, zen: 0x3d63a8, hor: 0xf0a878, glow: 0xff7a40, disc: 0xffb070, fog: 0xcfa592, fogD: 0.0003, exp: 0.95, env: 0.35, cL: 0xffae88, cD: 0x7a7090, night: 0.05, lamp: 0.25, city: 0x000000 },
  { s: 0.50, el: -4, key: 0.03, keyC: 0xc08070, hS: 0x5c6a98, hG: 0x30303a, hI: 0.42, fill: 0.12, zen: 0x1e3170, hor: 0xc07f7c, glow: 0xc85a48, disc: 0x000000, fog: 0x86788a, fogD: 0.00032, exp: 1.05, env: 0.07, cL: 0xd08478, cD: 0x4a4a66, night: 0.45, lamp: 0.85, city: 0x100808 },
  { s: 0.72, el: -9, key: 0.3, keyC: 0x8fa0d0, hS: 0x34426e, hG: 0x181a22, hI: 0.4, fill: 0.06, zen: 0x0c1638, hor: 0x383c60, glow: 0x5a3848, disc: 0x000000, fog: 0x2a2c40, fogD: 0.00033, exp: 1.18, env: 0.025, cL: 0x5a5470, cD: 0x1c1e2c, night: 0.85, lamp: 1, city: 0x2a1a10 },
  { s: 1.00, el: -16, key: 0.4, keyC: 0x9fb2e0, hS: 0x2a3658, hG: 0x121318, hI: 0.42, fill: 0.05, zen: 0x040816, hor: 0x1c2036, glow: 0x000000, disc: 0x000000, fog: 0x15171f, fogD: 0.00032, exp: 1.3, env: 0.012, cL: 0x3c3444, cD: 0x101218, night: 1, lamp: 1, city: 0x33200e },
].map((k) => { const o = { ...k }; for (const c of ['keyC', 'hS', 'hG', 'zen', 'hor', 'glow', 'disc', 'fog', 'cL', 'cD', 'city']) o[c] = new THREE.Color(k[c]); return o; });
const CYCLE = 30 * 60, RUN = 20 * 60, HOLD = 8 * 60;
/** evening phase 0..1 from wall-clock time: 20 min golden → night, 8 min night, 2 min back */
export function phaseAt(ms) { const t = (ms / 1000) % CYCLE; if (t < RUN) return t / RUN; if (t < RUN + HOLD) return 1; return 1 - (t - RUN - HOLD) / (CYCLE - RUN - HOLD); }

// time-of-day chooser (bottom-right): Day / Dusk / Night / Cycle, remembered per device; default Day (night was too dark to play)
const TOD = { day: 0, dusk: 0.5, night: 1, cycle: null };
function pickFixed() { let v = 'day'; try { v = localStorage.getItem('zavod.tod') || 'day'; } catch {} return v in TOD ? TOD[v] : 0; }
function todUI(world) {   // lives in Settings → World → Time of day (hud.js reads world.W.tod)
  const cur = () => { try { return localStorage.getItem('zavod.tod') || 'day'; } catch { return 'day'; } };
  world.W.tod = { options: Object.keys(TOD), get: cur, set: (k) => { try { localStorage.setItem('zavod.tod', k); } catch {} } };
}
function buildCycle(world, fw) {
  todUI(world);
  const { ctx, scene } = world; const M = world.mats || {};
  const q = ctx.qs?.get?.('time'); const FIX = { golden: 0, sunset: 0.3, dusk: 0.5, blue: 0.72, night: 1 };
  const fixed = q == null ? null : (q in FIX ? FIX[q] : (isFinite(+q) ? Math.max(0, Math.min(1, +q)) : null));
  const sky = buildSkyDome(world);
  // coney fog: keep the scene's FogExp2 but drive density/colour from here (the map now needs to see 3 km)
  if (!scene.fog || !scene.fog.isFogExp2) scene.fog = new THREE.FogExp2(0xcdd8e3, 0.0003);
  // hide the shared HDRI haze dome as soon as it exists (ours replaces it) but borrow its HDRI for the clouds
  const grabHaze = () => { const d = scene.getObjectByName('hazeSky'); if (!d) return false; d.visible = false; sky.u.tSky.value = d.material.uniforms.tSky.value; sky.u.uRot.value = d.material.uniforms.uRot.value; sky.u.uHasSky.value = 1; return true; };
  let haveHaze = grabHaze(); ctx.bus?.on?.('skyReady', () => { haveHaze = grabHaze(); });
  // night-boosted emissives: base intensity → x(1 + k * night)
  const boost = [['lampLens', 10], ['lampHead', 8], ['bulb', 2.5], ['glassLit', 3], ['shopInterior', 3], ['elSoffit', 0.6], ['ssBanner', 2], ['ssFrieze', 2], ['hLobbyCeil', 0.4], ['hIndicator', 0.5], ['hButton', 0.3]].map(([k, f]) => M[k] && { m: M[k], e0: M[k].emissiveIntensity, f }).filter(Boolean);
  if (M.lampHead && M.lampHead.emissive && M.lampHead.emissive.getHex() === 0) { M.lampHead.emissive.set(0xffe0b0); boost.find((b) => b.m === M.lampHead).e0 = 0.05; }
  // unlit (MeshBasic) surf foam would glow white at night: dim it with the light level
  const foam = []; scene.traverse((o) => { if (o.isMesh && /^surf\d$/.test(o.name) && o.material?.color) foam.push({ m: o.material, c0: o.material.color.clone() }); });
  const nightWin = ['hBrickWin', 'hCreamWin', 'hBrickTop', ...Object.values(EAST_TOWER), ...S2_WIN].map((k) => M[k]).filter((m) => m && m.emissiveMap);
  const moonDir = new THREE.Vector3(0.55, 0.55, 0.62).normalize(); sky.u.uMoonDir.value.copy(moonDir);
  const sunH = new THREE.Vector3(-0.989, 0, -0.145);    // due west in the map frame (the sun sets behind the Narrows)
  const tmp = {}; const lerpKeys = (s) => { let i = 0; while (i < KEYS.length - 2 && s > KEYS[i + 1].s) i++; const a = KEYS[i], b = KEYS[i + 1]; const f = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))); for (const k in a) { if (k === 's') continue; if (a[k].isColor) (tmp[k] || (tmp[k] = new THREE.Color())).copy(a[k]).lerp(b[k], f); else tmp[k] = a[k] + (b[k] - a[k]) * f; } return tmp; };
  const dir = new THREE.Vector3(), c3 = new THREE.Color(), size = new THREE.Vector2();
  let last = -1;
  const state = { s: 0, fixed };
  const upd = (dt) => {
    const now = Date.now(); const s = fixed ?? pickFixed() ?? phaseAt(now); state.s = s;
    const K = lerpKeys(s);
    U.uTime.value = (now / 1000) % 3600;
    const el = K.el * D2R; const sunDir = new THREE.Vector3(sunH.x * Math.cos(el), Math.sin(el), sunH.z * Math.cos(el)).normalize();
    const useMoon = s > 0.5; dir.copy(useMoon ? moonDir : sunDir);
    // key light (ctx.lights.key follows the player's shadow box, set up by sbu/sky.js): re-aim + recolour
    const key = ctx.lights?.key; if (key) { key.intensity = K.key; key.color.copy(K.keyC); key.position.copy(key.target.position).addScaledVector(dir, 420); }
    const hemi = ctx.lights?.hemi; if (hemi) { hemi.color.copy(K.hS); hemi.groundColor.copy(K.hG); hemi.intensity = K.hI; }
    const fill = ctx.lights?.fill; if (fill) { fill.intensity = K.fill; fill.color.copy(K.hS); }
    // fireworks: flash the ambient with the burst colour
    fw?.update(now / 1000, K.night);
    if (hemi && fw && fw.flashK > 0.01) { c3.copy(fw.flash).multiplyScalar(0.25 / Math.max(1, fw.flashK)); hemi.color.add(c3.multiplyScalar(K.night * 2)); hemi.intensity += 0.25 * K.night * Math.min(1, fw.flashK); }
    scene.fog.color.copy(K.fog); scene.fog.density = K.fogD; if (scene.background?.isColor) scene.background.copy(K.fog); else scene.background = K.fog.clone();
    ctx.renderer.toneMappingExposure = K.exp; scene.environmentIntensity = K.env;
    // shared shader uniforms
    U.uSunDir.value.copy(dir); U.uSunCol.value.copy(K.keyC).multiplyScalar(K.key);
    U.uAmbSky.value.copy(K.hS).multiplyScalar(K.hI * 3.14159 + K.env * 1.2); U.uAmbGnd.value.copy(K.hG).multiplyScalar(K.hI * 3.14159 + K.env * 0.6);
    U.uFogCol.value.copy(K.fog); U.uFogD.value = K.fogD; U.uNight.value = K.night; U.uLamp.value = K.lamp; world.W.night = K.night; world.W.lampK = K.lamp;
    ctx.renderer.getDrawingBufferSize(size); U.uPx.value = size.y / (2 * Math.tan((ctx.camera.fov || 70) * D2R / 2));
    // sky dome + ocean
    sky.u.uSky.value.copy(K.zen); sky.u.uHorizon.value.copy(K.hor); sky.u.uGlow.value.copy(K.glow).multiplyScalar(Math.max(0, 1 - Math.max(0, s - 0.55) * 3)); sky.u.uDisc.value.copy(K.disc).multiplyScalar(8);
    sky.u.uCloudLit.value.copy(K.cL); sky.u.uCloudDark.value.copy(K.cD); sky.u.uCityGlow.value.copy(K.city);
    U.uSunDir.value.copy(dir);
    sky.dome.material.uniforms.uSunDir.value = sunDir;   // the dome's glow follows the real sun even after the moon takes the key light
    if (U.uSkyRef) { U.uSkyRef.value.copy(K.zen); U.uHorizonRef.value.copy(K.hor); U.uGlowRef.value.copy(K.glow).multiplyScalar(s < 0.45 ? 1 : 0); }
    if (U.uCreekSky) U.uCreekSky.value.copy(K.hor).lerp(K.zen, 0.4);
    // night emissives
    if (Math.abs(s - last) > 0.002) { last = s;
      for (const b of boost) b.m.emissiveIntensity = b.e0 * (1 + b.f * K.lamp);
      for (const g of world.W.nightGlow || []) g.m.emissiveIntensity = g.e0 * (1 + g.f * K.lamp);   // shop signs, windows, billboards (fronts.js, brighton.js …)
      for (const m of nightWin) m.emissiveIntensity = 0.9 * K.night;
      for (const f of foam) f.m.color.copy(f.c0).multiplyScalar(1 - 0.88 * K.night).lerp(K.hor, 0.15);
    }
    if (!haveHaze) haveHaze = grabHaze();
    if (state.lights) for (const m of state.lights) if (m.isPoints || m.name === 'horizon:lampPools') m.visible = K.lamp > 0.02 || K.night > 0.02;
  };
  const sunDirOwn = { value: new THREE.Vector3() }; sky.dome.material.uniforms.uSunDir = sunDirOwn;
  upd(0); world.updaters.push(upd);
  return state;
}

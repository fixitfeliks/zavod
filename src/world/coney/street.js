// CONEY street kit, second pass (after traffic, which it reads): what the Street View of Surf / Mermaid / Stillwell / W 12th /
// W 8th has and the map didn't —
//  · traffic signals at every signalised junction: a yellow three-lamp head on a mast arm over each approach plus a pedestrian
//    head (orange hand / white walking man) on every pole, lit from the same wall-clock phases the cars obey (traffic.js W.signals);
//  · wooden utility poles with cross-arms and sagging wires along Mermaid, Neptune and the side streets north of Surf;
//  · NYC litter baskets at the corners, recycling bins and concrete planters on Surf, yellow bollards, orange barrels on Mermaid;
//  · cars parked along both kerbs of Surf Ave (the parking lane outside the traffic lanes);
//  · the vendor tables under the el at Stillwell & Mermaid (umbrellas, phone cases, toys, water), with sellers (folk.js).
// Instanced or merged per material; posts, poles, bins, stalls and the parked cars get colliders. CONEY agent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OSM, PLAY } from './osm.js';
import { BW } from './shore.js';
import { BUS_STOPS, laneOff } from './traffic.js';
import { streetAt } from './fronts.js';
import { placeCars, parkedCarBoxes, parkMix } from '../carkit.js';
import { addFolkSpots } from './folk.js';
import { STREET_NAMES } from './streetnames.js';
import { Batch, boxGeo } from '../sbu/geo.js';
import { BRI } from './brighton.js';
import { AVE8 } from './tavern.js';

const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)); return Math.hypot(a[0] + t * dx - x, a[1] + t * dz - z); };
const inRoad = (x, z, pad = 0.3) => OSM.r.some((r) => { for (let i = 0; i + 1 < r.p.length; i++) if (segD(x, z, r.p[i], r.p[i + 1]) < r.w / 2 + pad) return true; return false; });
/** walk a polyline every `step` m: fn(x, z, ux, uz) */
function walkLine(p, step, fn, start = step / 2) { let carry = start; for (let i = 0; i + 1 < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue; const ux = (bx - ax) / L, uz = (bz - az) / L; let d = carry; while (d < L) { fn(ax + ux * d, az + uz * d, ux, uz); d += step; } carry = d - L; } }
const inMap = (x, z) => x > PLAY.x0 + 3 && x < PLAY.x1 - 3 && z > -556 && z < BW.z0 - 3;

// ---- NYC cobra-head street lights on every street (Surf Ave has its own in city.js): galvanised pole on the kerb, the curved
// outreach arm over the road, the flat head with its lens; ~30 m apart, staggered sides. Built before horizon.js, which finds
// the lenses and lights them (glow + a pool on the street) at night.
export function buildStreetLights(world, M) {
  const { ctx } = world, lite = !!ctx.lite, K = new Batch(world, M, 'streetLights'); let n = 0;
  const blocked = (x, z, rad = 0.5) => ctx.colliders.some((b) => x > b.min.x - rad && x < b.max.x + rad && z > b.min.z - rad && z < b.max.z + rad && b.max.y > 0.2 && b.min.y < 2.5);
  const ends = OSM.r.filter((r) => r.w >= 9).flatMap((r) => [r.p[0], r.p[r.p.length - 1]]), nearJ = (x, z) => ends.some(([a, b]) => Math.hypot(a - x, b - z) < 9);
  for (const r of OSM.r) {
    if (r.w < 9 || r.w >= 20 || r.busLoop || !r.p.some(([x, z]) => inMap(x, z))) continue;
    let k = 0;
    walkLine(r.p, lite ? 38 : 30, (x, z, ux, uz) => { const sd = k++ % 2 ? 1 : -1, off = r.w / 2 + 0.6, px = x - uz * sd * off, pz = z + ux * sd * off;
      if (!inMap(px, pz) || nearJ(x, z) || blocked(px, pz, 0.4) || inRoad(px, pz, 0.15)) return;
      const ax = uz * sd, az = -ux * sd, a = Math.atan2(-az, ax);   // the arm reaches back over the road
      const pole = new THREE.CylinderGeometry(0.085, 0.14, 9, lite ? 6 : 10); pole.translate(px, 4.5, pz); K.add('galv', pole); K.add('galv', boxGeo([px - 0.2, 0, pz - 0.2], [px + 0.2, 0.45, pz + 0.2]));
      const arm = (x0, y0, x1, y1, t) => { const L = Math.hypot(x1 - x0, y1 - y0); const g = new THREE.BoxGeometry(L, t, t); g.rotateZ(Math.atan2(y1 - y0, x1 - x0)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0); g.rotateY(a); g.translate(px, 0, pz); K.add('galv', g); };
      arm(0, 8.55, 0.9, 9.05, 0.09); arm(0.85, 9.03, 2.2, 9.28, 0.08); arm(2.15, 9.27, 2.9, 9.32, 0.07);
      const hd = new THREE.BoxGeometry(0.95, 0.2, 0.38); hd.translate(3.2, 9.3, 0); hd.rotateY(a); hd.translate(px, 0, pz); K.add('galv', hd);
      const ln = new THREE.BoxGeometry(0.7, 0.04, 0.28); ln.translate(3.22, 9.18, 0); ln.rotateY(a); ln.translate(px, 0, pz); K.add('lampLens', ln, { uv: false });
      world.box([px - 0.18, 0, pz - 0.18], [px + 0.18, 9, pz + 0.18]); n++; });
  }
  K.flush({ shadow: !lite });
  console.log('[street] street lights', n);
  return n;
}

/** the street a junction's arm runs along: the nearest named OSM street pointing the same way */
function nameAt(x, z, dx, dz) {
  let best = null, bd = 14;
  for (const r of STREET_NAMES) for (let i = 0; i + 1 < r.p.length; i++) { const a = r.p[i], b = r.p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue;
    if (Math.abs(((b[0] - a[0]) * dx + (b[1] - a[1]) * dz) / L) < 0.8) continue; const d = segD(x, z, a, b); if (d < bd) { bd = d; best = r.n; } }
  return best;
}
/** the green blade: white letters, a thin white border, both sides (one atlas cell per name) */
function bladeAtlas(names, lite) {
  const CW = 512, CH = 96, COLS = 4, rows = Math.max(1, Math.ceil(names.length / COLS)), k = lite ? 0.5 : 1;
  const c = document.createElement('canvas'); c.width = CW * COLS * k; c.height = CH * rows * k; const g = c.getContext('2d'); g.scale(k, k); const uv = new Map();
  names.forEach((n, i) => { const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH; g.fillStyle = '#0b6b3a'; g.fillRect(x, y, CW, CH); g.strokeStyle = '#f2f2ea'; g.lineWidth = 5; g.strokeRect(x + 6, y + 6, CW - 12, CH - 12);
    g.fillStyle = '#f7f7f0'; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 62; g.font = `600 ${fs}px "Highway Gothic", "Helvetica Neue", Arial, sans-serif`; const w = g.measureText(n).width; if (w > CW - 40) { fs *= (CW - 40) / w; g.font = `600 ${fs}px "Helvetica Neue", Arial, sans-serif`; }
    g.fillText(n, x + CW / 2, y + CH / 2 + 3); uv.set(n, [(x + 2) / (CW * COLS), 1 - (y + CH - 2) / (CH * rows), (CW - 4) / (CW * COLS), (CH - 4) / (CH * rows)]); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return { t, uv };
}
function stopTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  const oct = (cx, cy, r, f) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fillStyle = f; g.fill(); };
  oct(64, 64, 63, '#f4f4f0'); oct(64, 64, 57, '#c8102e'); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 40px "Highway Gothic", Arial, sans-serif'; g.fillText('STOP', 64, 66);
  g.fillStyle = '#f4f4f0'; g.fillRect(132, 34, 120, 60); g.fillStyle = '#c8102e'; g.fillRect(138, 40, 108, 48); g.fillStyle = '#fff'; g.font = '700 30px Arial, sans-serif'; g.fillText('ALL WAY', 192, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---- Brighton Beach Av (its own strip, not in the OSM street set): signals at every cross street on their own wall-clock
// phase, pedestrian heads, the green name blades, corner baskets, litter along the kerbs, and people on both sidewalks
/** the phase a lamp shows: the traffic system's signals, or Brighton's own (same 34 s cycle: the avenue, then the cross street) */
const sigState = (L, now = Date.now()) => { if (!L.j.br) return L.j.n && globalThis.__zvSignals ? globalThis.__zvSignals.state(L.j, L.hx, L.hz, now) : 'R';
  const t = ((now / 1000 + L.j.off) % 34 + 34) % 34, g = Math.abs(L.hx) > 0.7 ? 0 : 1; return g === 0 ? (t < 14 ? 'G' : t < 17 ? 'Y' : 'R') : (t >= 18 && t < 30 ? 'G' : t >= 30 && t < 33 ? 'Y' : 'R'); };
function avenueKit(world, A, put, solid, lamps, blades, basket) {
  const { W, ctx } = world, lite = !!ctx.lite;
  let seed = A.seed || 31337; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const zN = A.ZC - A.HALF - 0.9, zS = A.ZC + A.HALF + 0.9, y = A.SW;
  const cyl = (r0, r1, h) => new THREE.CylinderGeometry(r1, r0, h, 8).translate(0, h / 2, 0);
  const head = (x, hy, z, ry, j, hx, hz) => { put(new THREE.BoxGeometry(0.42, 1.12, 0.3).translate(0, 0.56, 0), 0xd8a81a, x, hy, z, ry); ['R', 'Y', 'G'].forEach((k, i) => lamps.push({ j, hx, hz, k, x: x + Math.sin(ry) * 0.16, y: hy + 0.88 - i * 0.34, z: z + Math.cos(ry) * 0.16, ry })); };
  const ped = (px, pz, ry, j, hx, hz) => { put(new THREE.BoxGeometry(0.4, 0.75, 0.3).translate(0, 0.37, 0), 0xd8a81a, px, y + 2.0, pz, ry);
    lamps.push({ j, hx, hz, k: 'hand', x: px + Math.sin(ry) * 0.16, y: y + 2.55, z: pz + Math.cos(ry) * 0.16, ry }, { j, hx, hz, k: 'man', x: px + Math.sin(ry) * 0.16, y: y + 2.2, z: pz + Math.cos(ry) * 0.16, ry }); };
  for (const [ci, c] of A.cross.entries()) {
    const j = { x: c.x, z: A.ZC, br: true, off: ((ci + 1) * 7.3 + (A.seed || 0)) % 34 }, xw = c.x - A.CW - 1.2, xe = c.x + A.CW + 1.2;
    const corners = A.fourWay ? [[xw, zN], [xe, zN], [xw, zS], [xe, zS]] : [[xw, zS], [xe, zS], [xe, zN]];
    for (const [px, pz] of corners) { put(cyl(0.16, 0.12, 6.0), 0x6b6f75, px, y, pz); solid(px, pz, 0.25, 6); basket.push([px + (px > c.x ? 1.3 : -1.3), pz]); ped(px, pz, px > c.x ? -Math.PI / 2 : Math.PI / 2, j, 0, 1); }
    head(xe, y + 4.6, zN - 0.3, Math.PI / 2, j, -1, 0);    // westbound (the north kerb) — faces east
    head(xw, y + 4.6, zS + 0.3, -Math.PI / 2, j, 1, 0);    // eastbound — faces west
    head(xe, y + 2.9, zS + 0.3, 0, j, 0, -1);              // up the cross street from the south — faces south
    if (A.fourWay) head(xw, y + 2.9, zN - 0.3, Math.PI, j, 0, 1);   // down it from the north — faces north
    blades.push({ x: xe, z: zN, y: y + 3.6, ry: Math.PI, n: A.ave }, { x: xe, z: zN, y: y + 3.32, ry: Math.PI / 2, n: c.name });
  }
  for (let k = 0; k < (lite ? A.litter / 2.5 : A.litter); k++) { const x = A.X0 + R() * (A.X1 - A.X0), z = R() < 0.5 ? A.ZC - A.HALF + 0.3 + R() * 0.4 : A.ZC + A.HALF - 0.3 - R() * 0.4; (W.extraLitter || (W.extraLitter = [])).push([x, z, R() * 6.28, 0.2 + R() * 0.25, (R() * 4) | 0]); }
  const spots = []; for (let x = A.X0 + 6; x < A.X1 - 6; x += lite ? 22 : A.step) for (const z of [A.ZC - A.HALF - 2.6, A.ZC + A.HALF + 2.6]) { if (R() < 0.45) continue; if (A.cross.some((c) => Math.abs(c.x - x) < A.CW + 2 && (A.fourWay || z > A.ZC))) continue;
    const r = R(), walk = R() < 0.65; spots.push({ x: x + (R() - 0.5) * 4, y, z: z + (R() - 0.5) * 1.6, ry: walk ? (R() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : R() * 6.28, pose: walk ? 'walk' : R() < 0.5 ? 'phone' : 'stand', zone: 'town', arch: r < A.elders ? 'elder' : r < A.elders + 0.1 ? 'tourist' : r < A.elders + 0.17 ? 'kid' : undefined, s: r >= A.elders + 0.1 && r < A.elders + 0.17 ? 0.66 : undefined }); }
  return spots;
}
function zoneKits(world, put, solid, lamps, blades, basket) {
  const { W } = world, spots = [];
  if (W.brighton) spots.push(...avenueKit(world, { ...BRI, cross: BRI.CROSS.map((c) => ({ x: c.x, name: `Brighton ${c.n} St` })), ave: 'Brighton Beach Av', fourWay: false, litter: 220, step: 9, elders: 0.35, seed: 31337 }, put, solid, lamps, blades, basket));
  if (W.tavern) spots.push(...avenueKit(world, { ...AVE8, ave: '8 Av', fourWay: true, litter: 90, step: 6, elders: 0.25, seed: 8008 }, put, solid, lamps, blades, basket));
  return spots;
}

export function buildStreet(world) {
  globalThis.__zvSignals = world.W.signals;
  const { scene, ctx, W } = world, lite = !!ctx.lite; let seed = 77213; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blocked = (x, z, rad = 0.5) => ctx.colliders.some((b) => x > b.min.x - rad && x < b.max.x + rad && z > b.min.z - rad && z < b.max.z + rad && b.max.y > 0.2 && b.min.y < 2.5);
  const col = [], st = { heads: 0, poles: 0, bins: 0, cars: 0, stalls: 0, crossers: 0 };
  const _c = new THREE.Color();
  const put = (g, color, x, y, z, ry = 0) => { if (g.index) g = g.toNonIndexed(); g.deleteAttribute('uv'); if (ry) g.rotateY(ry); g.translate(x, y, z); const n = g.attributes.position.count, a = new Float32Array(n * 3); _c.set(color); for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); col.push(g); return g; };
  const cyl = (r0, r1, h, seg = 10) => new THREE.CylinderGeometry(r1, r0, h, seg).translate(0, h / 2, 0);
  const boxG = (sx, sy, sz, y = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2 + y, 0);
  const solid = (x, z, r, h) => world.box([x - r, 0, z - r], [x + r, h, z + r]);

  // ---- traffic signals ----------------------------------------------------------------------------------------------------
  const lamps = [], heads = [], crossers = [], cornerBins = [];   // lamps: { j, hx, hz, kind: 'R'|'Y'|'G'|'hand'|'man', i }
  for (const j of W.signals?.list || []) {
    if (!inMap(j.x, j.z)) continue;
    const ways = [];   // one per distinct direction out of the junction
    for (const e of j.ways) if (!ways.some((q) => q.dx * e.dx + q.dz * e.dz > 0.9)) ways.push(e);
    for (const e of ways) {
      const hx = -e.dx, hz = -e.dz, rx = -hz, rz = hx;   // traffic arriving from this street heads (hx, hz); its right-hand side
      const other = Math.max(10, ...ways.filter((q) => Math.abs(q.dx * e.dx + q.dz * e.dz) < 0.5).map((q) => q.w));
      const px = j.x + e.dx * (other / 2 + 1.4) + rx * (e.w / 2 + 1.1), pz = j.z + e.dz * (other / 2 + 1.4) + rz * (e.w / 2 + 1.1);
      if (inRoad(px, pz, 0.2)) continue;
      const ry = Math.atan2(e.dx, e.dz);   // faces back up the street, at the cars coming in
      put(cyl(0.16, 0.12, 6.4, 10), 0x6b6f75, px, 0, pz); put(cyl(0.3, 0.3, 0.45, 10), 0x6b6f75, px, 0, pz); solid(px, pz, 0.25, 6);
      { const bx = px + e.dx * 1.3, bz = pz + e.dz * 1.3; if (!blocked(bx, bz, 0.3) && !inRoad(bx, bz, 0.1)) { cornerBins.push([bx, bz]); solid(bx, bz, 0.32, 0.9); } }   // the corner basket by the crossing signal
      const reach = Math.min(e.w * 0.62, 9), ax = px - rx * reach, az = pz - rz * reach;
      { const L = reach, g = new THREE.BoxGeometry(0.12, 0.14, L); g.deleteAttribute('uv'); g.rotateY(Math.atan2(-rx, -rz)); g.translate(px - rx * L / 2, 6.1, pz - rz * L / 2); put(g, 0x6b6f75, 0, 0, 0); }
      { const L = 3, g = new THREE.BoxGeometry(0.06, 0.06, Math.hypot(L, 1.4)); g.deleteAttribute('uv'); g.rotateX(Math.atan2(1.4, L)); g.rotateY(Math.atan2(-rx, -rz)); g.translate(px - rx * L / 2, 6.8, pz - rz * L / 2); put(g, 0x6b6f75, 0, 0, 0); }
      // vehicle heads: one on the arm over the lanes, one on the pole for the near side
      for (const [x, y, z] of (lite ? [[ax + rx * 0.3, 5.0, az + rz * 0.3]] : [[ax + rx * 0.3, 5.0, az + rz * 0.3], [px + e.dx * 0.25, 2.9, pz + e.dz * 0.25]])) {
        put(boxG(0.42, 1.12, 0.3), 0xd8a81a, x, y, z, ry); heads.push([x, y, z]);
        ['R', 'Y', 'G'].forEach((k, i) => { const ly = y + 0.88 - i * 0.34; put(boxG(0.36, 0.05, 0.22), 0x2a2a20, x + e.dx * 0.2, ly + 0.13, z + e.dz * 0.2, ry); lamps.push({ j, hx, hz, k, x: x + e.dx * 0.16, y: ly, z: z + e.dz * 0.16, ry }); });
        st.heads++;
      }
      // the pedestrian head, facing across the street the crosswalk spans (people at the far kerb read it)
      { const x = px - rx * 0.25, z = pz - rz * 0.25, y = 2.3, pry = Math.atan2(-rx, -rz); put(boxG(0.4, 0.75, 0.3), 0xd8a81a, x, y, z, pry);
        lamps.push({ j, hx: rx, hz: rz, k: 'hand', x: x - rx * 0.16, y: y + 0.55, z: z - rz * 0.16, ry: pry }, { j, hx: rx, hz: rz, k: 'man', x: x - rx * 0.16, y: y + 0.2, z: z - rz * 0.16, ry: pry }); }
      // the crosswalk across this street (where the walkers wait), and two people to use it
      const cx = j.x + e.dx * (other / 2 + 2.6), cz = j.z + e.dz * (other / 2 + 2.6), half = e.w / 2 + 1.2;
      if (!inRoad(cx + rx * half, cz + rz * half, 0) && !inRoad(cx - rx * half, cz - rz * half, 0)) {
        for (const sgn of [1, -1]) { const x0 = cx + rx * half * sgn, z0 = cz + rz * half * sgn, x1 = cx - rx * half * sgn, z1 = cz - rz * half * sgn;
          crossers.push({ x: x0, y: 0, z: z0, ry: Math.atan2(x1 - x0, z1 - z0), pose: 'walk', zone: 'cross', cross: { j, hx: -rx * sgn, hz: -rz * sgn, leg: { ax: x0, az: z0, bx: x1, bz: z1, yaw: Math.atan2(x1 - x0, z1 - z0) } } }); }
      }
    }
  }
  // ---- stop signs (the minor street's approaches; ALL WAY where equals meet) and green name blades on a corner of every junction ----
  const stops = [], blades = [];
  const brSpots = zoneKits(world, put, solid, lamps, blades, cornerBins);
  for (const j of W.junctions || []) {
    if (!inMap(j.x, j.z)) continue;
    const ways = []; for (const e of j.ways) if (!ways.some((q) => q.dx * e.dx + q.dz * e.dz > 0.9)) ways.push(e);
    if (j.ctrl === 'stop') { const allWay = ways.every((e) => e.w >= j.maxW - 0.5);
      for (const e of ways) { if (!allWay && e.w >= j.maxW - 0.5) continue; const hx = -e.dx, hz = -e.dz, rx = -hz, rz = hx, other = Math.max(8, ...ways.filter((q) => Math.abs(q.dx * e.dx + q.dz * e.dz) < 0.5).map((q) => q.w));
        const px = j.x + e.dx * (other / 2 + 1.2) + rx * (e.w / 2 + 0.7), pz = j.z + e.dz * (other / 2 + 1.2) + rz * (e.w / 2 + 0.7); if (blocked(px, pz, 0.2) || inRoad(px, pz, 0.1)) continue;
        put(cyl(0.035, 0.035, 2.6, 6), 0x8a8f94, px, 0, pz); solid(px, pz, 0.06, 2.6); stops.push({ x: px, z: pz, ry: Math.atan2(e.dx, e.dz), all: allWay }); } }
    // the name blades: two perpendicular streets, one corner (the first that's on the pavement)
    const a = ways[0], b = ways.find((q) => Math.abs(q.dx * a.dx + q.dz * a.dz) < 0.5); if (!a || !b) continue;
    const na = nameAt(j.x + a.dx * 12, j.z + a.dz * 12, a.dx, a.dz), nb = nameAt(j.x + b.dx * 12, j.z + b.dz * 12, b.dx, b.dz); if (!na && !nb) continue;
    for (const [sa, sb] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const px = j.x + a.dx * sa * (b.w / 2 + 1.0) + b.dx * sb * (a.w / 2 + 1.0), pz = j.z + a.dz * sa * (b.w / 2 + 1.0) + b.dz * sb * (a.w / 2 + 1.0);
      if (blocked(px, pz, 0.2) || inRoad(px, pz, 0.1)) continue;
      put(cyl(0.05, 0.05, 3.5, 6), 0x5f6468, px, 0, pz); solid(px, pz, 0.07, 3.5);
      if (na) blades.push({ x: px, z: pz, y: 3.3, ry: Math.atan2(a.dx, a.dz) + Math.PI / 2, n: na }); if (nb) blades.push({ x: px, z: pz, y: 3.02, ry: Math.atan2(b.dx, b.dz) + Math.PI / 2, n: nb }); break; }
  }
  if (stops.length) { const t = stopTex(), oct = [], plate = [];
    for (const q of stops) { const g = new THREE.PlaneGeometry(0.76, 0.76); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setX(i, u.getX(i) * 0.5); g.rotateY(q.ry); g.translate(q.x + Math.sin(q.ry) * 0.05, 2.2, q.z + Math.cos(q.ry) * 0.05); oct.push(g);
      if (q.all) { const p = new THREE.PlaneGeometry(0.5, 0.25); const v = p.attributes.uv; for (let i = 0; i < v.count; i++) v.setXY(i, 0.5 + v.getX(i) * 0.5, 0.25 + v.getY(i) * 0.5); p.rotateY(q.ry); p.translate(q.x + Math.sin(q.ry) * 0.05, 1.68, q.z + Math.cos(q.ry) * 0.05); plate.push(p); } }
    const me = new THREE.Mesh(mergeGeometries([...oct, ...plate], false), new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, transparent: false, roughness: 0.5, side: THREE.DoubleSide })); me.name = 'street:stops'; scene.add(me); }
  if (blades.length) { const A = bladeAtlas([...new Set(blades.map((q) => q.n))], lite), gs = [];
    for (const q of blades) { const [u0, v0, du, dv] = A.uv.get(q.n); for (const side of [0, Math.PI]) { const g = new THREE.PlaneGeometry(1.6, 0.3); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u0 + u.getX(i) * du, v0 + u.getY(i) * dv); g.translate(0, 0, 0.018); g.rotateY(q.ry + side); g.translate(q.x, q.y, q.z); gs.push(g); }
      put(new THREE.BoxGeometry(1.62, 0.32, 0.03), 0x0b6b3a, q.x, q.y - 0.16, q.z, q.ry); }
    const me = new THREE.Mesh(mergeGeometries(gs, false), new THREE.MeshStandardMaterial({ map: A.t, roughness: 0.45, metalness: 0.1 })); me.name = 'street:names'; scene.add(me); }
  st.stops = stops.length; st.blades = blades.length;

  // lamp faces: one instanced disc each, colour = lit or dim, updated four times a second from the signal phase
  let lampIM = null;
  if (lamps.length) {
    const g = new THREE.CircleGeometry(0.13, 14); lampIM = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ toneMapped: false }), lamps.length); lampIM.name = 'street:lamps';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    lamps.forEach((L, i) => { e.set(0, L.ry, 0); q.setFromEuler(e); lampIM.setMatrixAt(i, m.compose(new THREE.Vector3(L.x, L.y, L.z), q, L.k === 'hand' || L.k === 'man' ? new THREE.Vector3(1.2, 1, 1) : one)); lampIM.setColorAt(i, _c.set(0x222222)); });
    scene.add(lampIM);
    const LIT = { R: 0xff2a1a, Y: 0xffb21a, G: 0x2affa0, hand: 0xff7a1a, man: 0xf2f6ff }, DIM = { R: 0x3a0e0a, Y: 0x3a2a0a, G: 0x0a2a1a, hand: 0x2a1a0a, man: 0x22252a };
    let t = 0; world.updaters.push((dt) => { t -= dt; if (t > 0) return; t = 0.25; const now = Date.now(), blink = Math.floor(now / 500) % 2 === 0;
      lamps.forEach((L, i) => { const s = sigState(L, now); let on;
        if (L.k === 'hand') on = s !== 'G' && (s !== 'Y' || blink); else if (L.k === 'man') on = s === 'G'; else on = s === L.k;
        lampIM.setColorAt(i, _c.set(on ? LIT[L.k] : DIM[L.k])); });
      lampIM.instanceColor.needsUpdate = true; });
  }

  // ---- along the streets: poles + wires, bins, planters, bollards, barrels ----------------------------------------------------
  const wires = [], basket = [], recyc = [], planter = [], bollard = [], barrel = [];
  const corners = (x, z) => W.signals?.list?.some((j) => Math.hypot(j.x - x, j.z - z) < 22);
  for (const r of OSM.r) {
    if (r.w < 9 || !r.p.some(([x, z]) => inMap(x, z))) continue;
    const mid = r.p[Math.floor(r.p.length / 2)], kind = streetAt(mid[0], mid[1]);
    const side = (x, z, ux, uz, s, off) => [x - uz * s * off, z + ux * s * off];
    // utility poles: one side, ~34 m apart, three wires sagging between them (Mermaid, Neptune, the side streets)
    if (kind === 'mermaid' || kind === 'neptune' || kind === 'w12' || kind === 'w8' || kind === 'side') {
      let prev = null; const s = r.p[0][0] < r.p[r.p.length - 1][0] ? 1 : -1;
      walkLine(r.p, 34, (x, z, ux, uz) => { const [px, pz] = side(x, z, ux, uz, s, r.w / 2 + 0.7); if (!inMap(px, pz) || blocked(px, pz, 0.6) || inRoad(px, pz, 0.2)) { prev = null; return; }
        put(cyl(0.17, 0.13, 11.5, 8), 0x5a4632, px, 0, pz); solid(px, pz, 0.2, 11);
        const g = new THREE.BoxGeometry(2.4, 0.12, 0.12); g.rotateY(Math.atan2(ux, uz) + Math.PI / 2); put(g, 0x5a4632, px, 10.6, pz);
        const arms = [-1.05, 0, 1.05].map((k) => [px + (-uz) * k * -1, 10.75, pz + ux * k * -1]);
        for (const [ax, ay, az] of arms) put(cyl(0.05, 0.04, 0.16, 6), 0x9aa0a0, ax, ay - 0.05, az);
        if (R() < 0.35) put(cyl(0.28, 0.28, 0.9, 10), 0x6a6e72, px - uz * s * 0.35, 8.6, pz + ux * s * 0.35);   // a transformer can
        if (prev) for (let k = 0; k < 3; k++) wires.push([prev[k], arms[k]]);
        prev = arms; st.poles++; });
    }
    // bins + planters + bollards
    walkLine(r.p, kind === 'surf' ? 28 : 46, (x, z, ux, uz) => {
      for (const s of [1, -1]) {
        const [bx, bz] = side(x, z, ux, uz, s, r.w / 2 + 1.0); if (!inMap(bx, bz) || blocked(bx, bz, 0.5) || inRoad(bx, bz, 0.2)) continue;
        const k = R();
        if (kind === 'surf' && k < 0.35) { planter.push([bx, bz]); solid(bx, bz, 0.55, 0.6); }
        else if (kind === 'surf' && k < 0.55) { recyc.push([bx - ux * 0.35, bz - uz * 0.35, 0x2a8a3a]); recyc.push([bx + ux * 0.35, bz + uz * 0.35, 0x1f5fae]); solid(bx, bz, 0.7, 1.0); }
        else if (k < 0.85) { basket.push([bx, bz]); solid(bx, bz, 0.32, 0.9); }
      }
    }, 9);
    if (kind === 'surf') walkLine(r.p, 3, (x, z, ux, uz) => { if (!corners(x, z)) return; for (const s of [1, -1]) { const [bx, bz] = side(x, z, ux, uz, s, r.w / 2 + 0.45); if (inMap(bx, bz) && !blocked(bx, bz, 0.3) && !inRoad(bx, bz, 0.1)) { bollard.push([bx, bz]); solid(bx, bz, 0.12, 1); } } });
    if (kind === 'mermaid') { let n = 0; walkLine(r.p, 3.2, (x, z, ux, uz) => { if (n > 14 || !inMap(x, z) || x > -130 || x < -200) return; const [bx, bz] = side(x, z, ux, uz, 1, r.w / 2 - 1.0); if (!blocked(bx, bz, 0.3)) { barrel.push([bx, bz]); solid(bx, bz, 0.32, 1.1); n++; } }); }
  }
  // NYC litter basket: a dark green wire can (lattice texture), a rim; recycling: grey can, coloured lid; planters; bollards; barrels
  const inst = (geo, mat, list, colorOf) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4();
    list.forEach((p, i) => { im.setMatrixAt(i, m.makeTranslation(p[0], 0, p[1])); if (colorOf) im.setColorAt(i, _c.set(colorOf(p))); }); im.castShadow = !lite; im.receiveShadow = true; scene.add(im); st.bins += list.length; return im; };
  const wireTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.clearRect(0, 0, 64, 64); g.strokeStyle = '#2f4a36'; g.lineWidth = 3;
    for (let i = -64; i < 128; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 2); return t; })();
  basket.push(...cornerBins);
  inst(new THREE.CylinderGeometry(0.31, 0.27, 0.9, 14, 1, true).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ map: wireTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }), basket);
  inst(new THREE.TorusGeometry(0.31, 0.025, 6, 16).rotateX(Math.PI / 2).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color: 0x2f4a36, roughness: 0.5, metalness: 0.5 }), basket);
  inst(new THREE.CylinderGeometry(0.27, 0.25, 0.95, 12).translate(0, 0.475, 0), new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.45, metalness: 0.6 }), recyc.map((p) => [p[0], p[1]]));
  inst(new THREE.CylinderGeometry(0.29, 0.29, 0.07, 12).translate(0, 0.98, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), recyc, (p) => p[2]);
  inst(new THREE.CylinderGeometry(0.55, 0.48, 0.6, 14).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: 0xb3ada2, roughness: 0.95 }), planter);
  inst(new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.75, 1).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.95, flatShading: true }), planter);
  inst(new THREE.CylinderGeometry(0.11, 0.11, 0.95, 10).translate(0, 0.475, 0), new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.5 }), bollard);
  { const parts = [[0, 0.22, 0xf06a1a], [0.22, 0.34, 0xf4f4f0], [0.34, 0.56, 0xf06a1a], [0.56, 0.68, 0xf4f4f0], [0.68, 0.95, 0xf06a1a]].map(([y0, y1, c]) => { const g = new THREE.CylinderGeometry(0.3, 0.32, y1 - y0, 12).translate(0, (y0 + y1) / 2, 0).toNonIndexed(); g.deleteAttribute('uv'); const n = g.attributes.position.count, a = new Float32Array(n * 3); _c.set(c); for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; });
    inst(mergeGeometries(parts, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), barrel); }
  // the wires: three per span, a catenary-ish sag sampled as line segments
  if (wires.length) { const pos = []; for (const [a, b] of wires) { const n = 8, sag = 0.35 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.012; for (let i = 0; i < n; i++) { for (const k of [i, i + 1]) { const t = k / n; pos.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t); } } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); const L = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x15161a })); L.name = 'street:wires'; scene.add(L); }

  // ---- the vendor tables under the el at Stillwell & Mermaid ------------------------------------------------------------------
  const stalls = [], sellers = [];
  { const sv = OSM.r.filter((r) => r.w >= 9 && streetAt(r.p[0][0], r.p[0][1]) === 'stillwell').flatMap((r) => r.p).filter(([x, z]) => z < -230 && z > -340);
    const sw = OSM.r.find((r) => r.w >= 9 && streetAt(r.p[0][0], r.p[0][1]) === 'stillwell')?.w || 14;
    if (sv.length) { const x = sv.reduce((a, p) => a + p[0], 0) / sv.length + sw / 2 + 2.6;
      for (let z = -330; z < -240; z += 6.5) { if (blocked(x, z, 1.2) || inRoad(x, z, 0.4) || R() < 0.15) continue; stalls.push([x, z]); } } }
  const goods = [0xff4fa0, 0x2fb0ff, 0xffd23a, 0x6ad06a, 0xff7a1a, 0xffffff, 0x9a5ae0, 0xe82a2a];
  for (const [x, z] of stalls) {
    put(boxG(2.2, 0.06, 0.9, 0.78), 0xe8e4da, x, 0, z); for (const [dx, dz] of [[-1, -0.38], [1, -0.38], [-1, 0.38], [1, 0.38]]) put(boxG(0.05, 0.78, 0.05), 0x777b80, x + dx, 0, z + dz);
    for (let i = 0; i < 9; i++) { const c = goods[(R() * goods.length) | 0]; put(boxG(0.18 + R() * 0.12, 0.08 + R() * 0.2, 0.16 + R() * 0.1, 0.84), c, x - 0.9 + (i % 5) * 0.42, 0, z - 0.25 + Math.floor(i / 5) * 0.4); }
    put(boxG(0.05, 1.7, 0.05, 0.84), 0x777b80, x + 0.3, 0, z + 0.55); for (let k = 0; k < 6; k++) put(boxG(0.5, 0.14, 0.03, 1.2 + k * 0.2), goods[(k + stalls.length) % goods.length], x + 0.3, 0, z + 0.58);   // a rack of phone cases
    put(cyl(0.025, 0.025, 2.3, 6), 0x777b80, x - 0.6, 0, z); { const g = new THREE.ConeGeometry(1.3, 0.5, 8, 1, true); g.translate(0, 2.35, 0); put(g, R() < 0.5 ? 0xe84a6a : 0x2a62c8, x - 0.6, 0, z); }
    world.box([x - 1.15, 0, z - 0.5], [x + 1.15, 1.0, z + 0.5]); st.stalls++;
    sellers.push({ x: x + 1.5, y: 0, z: z + (R() - 0.5), ry: -Math.PI / 2, pose: 'stand', zone: 'vendor' });
  }
  W.stalls = stalls;

  // ---- cars parked along both kerbs of Surf Ave -----------------------------------------------------------------------------
  const cars = [], KIND = parkMix(ctx, ['sedan', 'sedan', 'sedan', 'e34', 'suv', 'sedan', 'suv', 'hatch', 'van', 'sedan', 'coupe', 'muscle', 'e34', 'sedan', 'sedan']), off = Math.min(laneOff(22, 1) + 3.5, 8.8);   // the sedan is Surf Ave's primary car
  const mouths = OSM.r.filter((r) => r.w >= 6 && r.w < 20).flatMap((r) => [r.p[0], r.p[r.p.length - 1]]);
  for (const r of OSM.r) { const nep = r.w >= 14 && r.w < 20 && streetAt(r.p[0][0], r.p[0][1]) === 'neptune'; if (r.w < 20 && !nep) continue; const o = nep ? r.w / 2 - 1.3 : off;   // Surf Ave and Neptune Ave
    walkLine(r.p, 6.4, (x, z, ux, uz) => { for (const s of [1, -1]) {
      if (R() < (nep ? 0.2 : 0.38)) continue; const cx = x - uz * s * o, cz = z + ux * s * o;
      if (!inMap(cx, cz) || corners(cx, cz) || mouths.some(([mx, mz]) => Math.hypot(mx - cx, mz - cz) < 15) || BUS_STOPS.some((b) => Math.hypot(b[1] - cx, b[2] - cz) < 20) || blocked(cx, cz, 1.2)) continue;
      cars.push({ x: cx, z: cz, ry: Math.atan2(ux, uz) - Math.PI / 2 + (s > 0 ? 0 : Math.PI), kind: KIND(R) }); } }, 4); }
  if (cars.length) { placeCars(world, cars, { raycast: false }); for (const c of cars) parkedCarBoxes(world, c); st.cars = cars.length; }

  if (col.length) { const me = new THREE.Mesh(mergeGeometries(col, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 })); me.name = 'street:kit'; me.castShadow = !lite; me.receiveShadow = true; scene.add(me); }
  // the walkers that wait for the WALK and the people behind the tables
  st.crossers = crossers.length; try { addFolkSpots(world, [...crossers, ...sellers, ...(W.schoolKids || []), ...brSpots, ...(W.nightSpots || [])]); } catch (e) { console.warn('[street] folk', e); }
  console.log('[street]', st.stops, 'stop signs ·', st.blades, 'name blades ·', st.heads, 'signal heads ·', st.poles, 'utility poles ·', st.bins, 'bins / planters / bollards / barrels ·', st.cars, 'parked on Surf ·', st.stalls, 'vendor tables ·', st.crossers, 'crosswalk walkers');
  W.street = st;
  if (typeof window !== 'undefined' && window.__game) window.__game.street = { stats: () => ({ ...st }), lamps: () => lamps.map((L) => ({ k: L.k, s: sigState(L), br: !!L.j.br })), heads: () => heads.slice(), stalls: () => stalls.slice() };
  return st;
}

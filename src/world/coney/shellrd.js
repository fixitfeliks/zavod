// CONEY S2: the blocks round the F el's Neptune Av station (Shell Rd, Neptune Av, W 8 St to W 5 St, up toward the Belt and the
// creek), built from the real OpenStreetMap footprints and heights in osm-neptune.js (tools/import-osm-area.mjs) instead of
// horizon.js's generic sprawl boxes, which sat on the real streets and the el. Most of the area is parking lots in reality, so
// most of it stays open. Walls on the facade kit (mats.js brickFacadeKit / eastTowerMats, no new tile): the tall apartment
// slabs in brick or white, taxpayers with storefront glass, mullions and sign boards on the faces that look onto a street,
// plain painted / concrete walls on the sheds, the garage and the plant. Roofs: parapet cap, tar / membrane / gravel / white
// deck, HVAC, a stair bulkhead (roofKit) and water tanks on some taller ones. Every rect is trimmed back off the OSM streets
// (and their kerbs) and the el, so nothing stands on a road or in the train's way; colliders are small AABB cells round each
// rect's walls (the footprints here are turned ~13 deg off the frame, one AABB would bulge onto the sidewalk). Built after
// housing.js with local PRNGs only (never world.R). The OSM buildings osm.js already has here are left to city.js.
import * as THREE from 'three';
import { Batch } from '../sbu/geo.js';
import { roofKit } from '../sbu/buildings.js';
import { brickFacadeKit, eastTowerMats, facadeBoxUV, boxFaces, metreUV, FAC, EAST_WHITE } from './mats.js';
import { OSM } from './osm.js';
import { NEPTUNE, NEPTUNE_BBOX as BB } from './osm-neptune.js';
import { decompose, footprintAngle, segDist, cen, bbox, pip } from '../osmkit.js';

/** inside the imported area: horizon.js leaves its sprawl boxes, roof tanks, lamps and street trees out of it */
export const inS2 = (x, z) => x > BB.x0 && x < BB.x1 && z > BB.z0 && z < BB.z1;
/** an outline whose building:part pieces (osm-neptune.js pt) stand in for it: city.js builds an osm.js one invisibly */
export const s2Parts = (b) => { const [x, z] = cen(b.p); return inS2(x, z) && NEPTUNE.pt.some((q) => pip(...cen(q.p), b.p)); };
const EL_SEGS = OSM.rl.filter((l) => l.el).flatMap((l) => l.p.slice(1).map((q, i) => [l.p[i], q]));
const EL_SPRAWL = 9;   // m: no sprawl box (anywhere) within this of an elevated track centreline
/** a sprawl box that reaches the el: the train would run through it */
export function onEl(x0, z0, x1, z1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.hypot(x1 - x0, z1 - z0) / 2 + EL_SPRAWL;
  for (const [a, b] of EL_SEGS) { if (Math.min(a[0], b[0]) > cx + r || Math.max(a[0], b[0]) < cx - r || Math.min(a[1], b[1]) > cz + r || Math.max(a[1], b[1]) < cz - r) continue;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t <= L; t += 2) { const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L; if (x > x0 - EL_SPRAWL && x < x1 + EL_SPRAWL && z > z0 - EL_SPRAWL && z < z1 + EL_SPRAWL) return true; } }
  return false;
}

const GF = 3.6, GLASS_Y0 = 0.35, GLASS_Y1 = 2.75, SIGN_Y0 = 2.85, SIGN_Y1 = 3.45, UNIT = 7, MULL = 2.4;   // m: the taxpayer's shop storey
const FRONT_D = 24, FRONT_PROBE = 4, FRONT_MIN_W = 9;   // m: a face within FRONT_D of a street (>= FRONT_MIN_W wide) that faces it is a shopfront
const KERB_KEEP = 2.0, EL_KEEP = 10.0;   // m: walls stay this far past a street's kerb line / an el track centreline (the far platform's back edge is ~9 m out)
const MIN_RECT = 3, CELL = 2.0, DUP_R = 8, TALL = 20, TANK_H = 15;   // m: thinnest rect kept, collider cell, osm.js duplicate radius, slab height, tank height
const SIGN_CELLS = [11, 9, 10, 15, 13, 6, 5];   // mats.js SIGNS: PIZZA, BAR & GRILL, RESTAURANT, SEAFOOD, TACOS, COLD BEER, ICE CREAM
const FASCIA = ['fascia7', 'fascia5', 'fascia2'];   // plain sign bands: black, cream, blue
// painted masonry for the taxpayers' upper floors: the kit's light brick diffuse (eastWhite) under a paint colour, one material each
const PAINT = { s2Cream: 0xf0dcb8, s2Grey: 0xc6cac8, s2Salmon: 0xe6bca2 };
const STUCCO = { s2Base0: 0xe4d8c0, s2Base1: 0xbfc3bf };   // the shop storey: painted brick (paintWall stucco over the courses normal)
export const S2_WIN = Object.keys(PAINT);   // horizon.js lights these windows at night with the S1 keys
const ROOF = { tar: 'steelDark', membrane: 'roofMetal', gravel: 'roof', white: 'concrete', red: 'brickRed' };   // decks: all already loaded
// per building, from the reference aerial (by footprint centroid, nearest within LOOK_R): k wall kind, w wall key, r roof deck.
// kinds: slab (kit windows all the way up), shop (shop storey + painted flats), plain (no windows: sheds, plant, garage),
// glass (dark curtain wall with light slab edges every storey)
const LOOK_R = 10;
const LOOKS = [
  [669, -676, 'slab', 'eastRust', 'tar'], [765, -643, 'slab', 'eastRust', 'tar'],   // the two cross-plan towers: red-brown brick, dark roofs
  [484, -651, 'slab', 'eastWhite', 'white'], [462, -585, 'slab', 'eastWhite', 'membrane'],   // the newer mid-rises on Shell Rd: white, light roofs
  [469, -739, 'slab', 'eastBuff', 'white'], [455, -725, 'slab', 'eastBuff', 'membrane'], [440, -718, 'plain', 'precast', 'membrane'],   // the offices by the creek
  [478, -750, 'plain', 'concreteGrey', 'membrane'], [517, -778, 'shop', 's2Grey', 'white'],
  [529, -593, 'plain', 's2Base1', 'tar'], [516, -564, 'plain', 'concreteGrey', 'tar'],   // the long low building beside the el, its shed
  [627, -769, 'plain', 'concreteGrey', 'white'],   // the plant: white deck, cooling units
  [724, -686, 'plain', 's2Base0', 'red'], [736, -680, 'plain', 's2Base0', 'red'],   // the pavilions between the towers: red roofs
  [729, -536, 'shop', 's2Cream', 'tar'], [754, -538, 'shop', 's2Grey', 'tar'],   // the supermarket strip on Neptune Av
  [786, -773, 'slab', 'eastBuff', 'gravel'],   // the school: buff brick
  [549, -469, 'glass', 'glassDark', 'white'], [596, -474, 'glass', 'glassDark', 'white'], [635, -452, 'glass', 'glassDark', 'white'],   // the three new towers on Neptune Av: dark glass, white roofs
  [588, -455, 'plain', 'precast', 'white'],   // their podium: a parking deck on the roof
];
function lookFor(b, cx, cz) {
  let best = null, bd = LOOK_R; for (const L of LOOKS) { const d = Math.hypot(L[0] - cx, L[1] - cz); if (d < bd) { bd = d; best = L; } }
  if (best) return { k: best[2], w: best[3], r: ROOF[best[4]] };
  const shopish = /^(retail|commercial|supermarket|kiosk)$/.test(b.t) || /^shop:|^amenity:(fast_food|restaurant|cafe|bar|pharmacy|bank)/.test(b.u || '');
  if (shopish && b.h < TALL) return { k: 'shop', w: 's2Cream', r: ROOF.tar };
  if (b.h >= TALL || /^(apartments|residential|office|school|hospital|hotel)$/.test(b.t)) return { k: 'slab', w: b.h >= TALL ? 'eastBrown' : 'eastBuff', r: ROOF.gravel };
  return { k: 'plain', w: 'concreteGrey', r: ROOF.membrane };
}
const hash = (x, z, s = 0) => ((Math.sin((x + 1000 + s * 37.1) * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const roofRng = (cx, cz) => mulberry32((Math.round(cx * 97.13) ^ Math.round(cz * 193.71) ^ 0x9e3779b9) | 0);

function s2Mats(world, M) {
  const E = eastTowerMats(world, M); if (M.s2Cream) return E;
  const kit = brickFacadeKit(world), reg = (key, mat) => { mat.name = key; M[key] = mat; M.surface[key] = 'concrete'; M.uvScale[key] = 1; };
  for (const [k, c] of Object.entries(PAINT)) reg(k, kit.mat('eastWhite', EAST_WHITE, {}, { color: c }));
  for (const [k, c] of Object.entries(STUCCO)) reg(k, new THREE.MeshStandardMaterial({ map: M.paintWall0.map, normalMap: kit.normalPlain, normalScale: new THREE.Vector2(0.7, 0.7), color: c, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 }));
  return E;
}

/** a +z plane moved onto face f (0 +x, 1 -x, 4 +z, 5 -z) of the box, `off` proud, UVs in atlas rect [u0, v0, du, dv] */
function facePlane(f, b, a0, a1, y0, y1, off, rect) {
  const g = new THREE.PlaneGeometry(a1 - a0, y1 - y0), uv = g.attributes.uv;
  if (rect) for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * rect[2], rect[1] + uv.getY(i) * rect[3]);
  const am = (a0 + a1) / 2, ym = (y0 + y1) / 2;
  if (f === 4) g.translate(am, ym, b.z1 + off); else if (f === 5) g.rotateY(Math.PI).translate(am, ym, b.z0 - off);
  else if (f === 0) g.rotateY(Math.PI / 2).translate(b.x1 + off, ym, am); else g.rotateY(-Math.PI / 2).translate(b.x0 - off, ym, am);
  return g;
}
/** an axis box hugging face f from a0..a1 along it, y0..y1, from `n0` to `n1` proud of the wall */
function faceBox(B, key, f, b, a0, a1, y0, y1, n0, n1) {
  const alongX = f === 4 || f === 5, s = f === 0 || f === 4 ? 1 : -1, c = f === 0 ? b.x1 : f === 1 ? b.x0 : f === 4 ? b.z1 : b.z0;
  const p = [c + s * n0, c + s * n1].sort((m, n) => m - n);
  B.box(key, alongX ? [a0, y0, p[0]] : [p[0], y0, a0], alongX ? [a1, y1, p[1]] : [p[1], y1, a1], { collide: false });
}
/** the kit wall (windows) on the four sides of b from y0 up to h, tile offset by whole bays / storeys from the centroid */
function kitWall(B, key, b, y0, h, k) {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, hh = h - y0, du = ((k * 64) | 0) % FAC.TB / FAC.TB, dv = ((k * 997) | 0) % FAC.TF / FAC.TF;
  const g = boxFaces(facadeBoxUV(new THREE.BoxGeometry(w, hh, d), w, hh, d), [0, 1, 4, 5]), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  g.translate((b.x0 + b.x1) / 2, y0 + hh / 2, (b.z0 + b.z1) / 2); B.add(key, g, { uv: false });
}
/** plain painted / concrete walls (no windows), metre UVs so party walls tile on */
function plainWall(B, key, b, y0, h) {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, g = boxFaces(new THREE.BoxGeometry(w, h - y0, d), [0, 1, 4, 5]);
  g.translate((b.x0 + b.x1) / 2, y0 + (h - y0) / 2, (b.z0 + b.z1) / 2); if (M_KIT.has(key)) B.add(key, metreUV(g), { uv: false }); else B.add(key, g);
}
const M_KIT = new Set([...Object.keys(PAINT), ...Object.keys(STUCCO)]);

/** a wooden-barrel water tank on a steel stand, roof-mounted: existing materials only (steelDark, planksDark) */
function s2Tank(B, cx, cz, y0, R) {
  const lx = 1.2 + R() * 0.3;
  for (const [dx, dz] of [[-lx, -lx], [lx, -lx], [-lx, lx], [lx, lx]]) B.cyl('steelDark', cx + dx, cz + dz, y0, y0 + 1.6, 0.08, 6);
  B.box('steelDark', [cx - lx - 0.1, y0 + 1.55, cz - lx - 0.1], [cx + lx + 0.1, y0 + 1.7, cz + lx + 0.1], { collide: false });   // brace plate
  B.cyl('planksDark', cx, cz, y0 + 1.7, y0 + 3.5, 1.1, 10);   // barrel
  for (const hy of [y0 + 2.1, y0 + 2.9]) B.cyl('steelDark', cx, cz, hy, hy + 0.08, 1.13, 10);   // hoop bands
  B.add('steelDark', new THREE.ConeGeometry(1.2, 0.9, 10).translate(cx, y0 + 3.95, cz), { uv: false });   // conical cap
}

/** pull the side of r that loses least back off every obstacle point [x, z, clearance] in reach (local frame); false: too thin */
function trim(r, pts) {
  for (const [x, z, c] of pts) { if (x < r.x0 - c || x > r.x1 + c || z < r.z0 - c || z > r.z1 + c) continue;
    const [k, v] = [['x1', x - c, r.x1 - x + c], ['x0', x + c, x + c - r.x0], ['z1', z - c, r.z1 - z + c], ['z0', z + c, z + c - r.z0]].sort((m, n) => m[2] - n[2])[0]; r[k] = v; }
  return r.x1 - r.x0 >= MIN_RECT && r.z1 - r.z0 >= MIN_RECT;
}
const ROAD_SEGS = OSM.r.flatMap((r) => r.p.slice(1).map((q, i) => [r.p[i], q, r.w]));
const STREETS = OSM.r.filter((r) => r.w >= FRONT_MIN_W);

/** the real buildings of osm-neptune.js; returns counts for the log */
export function buildS2(world, M) {
  const E = s2Mats(world, M), quiet = { ...world, box: () => null, walkable: () => null, cover: () => {} }, B = new Batch(quiet, M, 'shellRd');
  for (const bx of world.W.s2Unseen || []) { bx.min.set(0, -9999, 0); bx.max.set(0.001, -9998, 0.001); }   // city.js's stand-in outline colliders (as vehicles.js parks a box)
  const known = OSM.b.map((b) => cen(b.p)), out = { buildings: 0, rects: 0, trimmed: 0, dropped: 0, shops: 0, cells: 0 };
  for (const b of [...NEPTUNE.b, ...NEPTUNE.pt.map((q) => ({ ...q, part: true }))]) {
    const [ox, oz] = cen(b.p); if (!b.part && (known.some(([x, z]) => Math.hypot(x - ox, z - oz) < DUP_R) || s2Parts(b))) continue;   // osm.js has it (city.js builds it) / its parts stand in
    const look = lookFor(b, ox, oz), R = roofRng(ox, oz), k = hash(ox, oz), h = Math.max(3, b.h), y0 = b.mh || 0;
    // the footprint's own frame (as osmkit.footprint turns it): obstacles into it, faces and cells back out of it
    const ang = footprintAngle(b.p), rot = Math.abs(ang) >= 0.07 ? ang : 0, cl = Math.cos(-rot), sl = Math.sin(-rot), cw = Math.cos(rot), sw = Math.sin(rot);
    const toLocal = (x, z) => [ox + (x - ox) * cl - (z - oz) * sl, oz + (x - ox) * sl + (z - oz) * cl], toWorld = (x, z) => [ox + (x - ox) * cw - (z - oz) * sw, oz + (x - ox) * sw + (z - oz) * cw];
    const q = bbox(b.p), pts = [], reach = 30;
    const sample = (a, c, clr) => { if (Math.max(a[0], c[0]) < q.x0 - reach || Math.min(a[0], c[0]) > q.x1 + reach || Math.max(a[1], c[1]) < q.z0 - reach || Math.min(a[1], c[1]) > q.z1 + reach) return;
      const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.5); for (let i = 0; i <= n; i++) pts.push([...toLocal(a[0] + (c[0] - a[0]) * i / n, a[1] + (c[1] - a[1]) * i / n), clr]); };
    for (const [a, c, w] of ROAD_SEGS) sample(a, c, w / 2 + KERB_KEEP);
    for (const [a, c] of EL_SEGS) sample(a, c, EL_KEEP);
    const kept = [];
    for (const r0 of decompose(b.p.map(([x, z]) => toLocal(x, z)))) {
      const r = { ...r0 }; if (!trim(r, pts)) { out.dropped++; continue; }
      if (r.x0 !== r0.x0 || r.x1 !== r0.x1 || r.z0 !== r0.z0 || r.z1 !== r0.z1) out.trimmed++;
      kept.push(r); out.rects++;
    }
    if (!kept.length) continue;
    out.buildings++;
    // build every kept rect into a scratch batch in the local frame, then rotate it into place (as osmkit.footprint does)
    const L = rot ? new Batch(quiet, M, 'shellRdRot') : B;
    const shared = (x, z, self) => kept.some((o) => o !== self && x > o.x0 - 0.3 && x < o.x1 + 0.3 && z > o.z0 - 0.3 && z < o.z1 + 0.3);
    const streetD = (x, z) => { let d = 1e9; for (const s of STREETS) d = Math.min(d, segDist(x, z, s.p)); return d; };
    for (const r of kept) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      if (look.k === 'shop') {
        const fronts = [];
        for (const [f, x, z, nx, nz] of [[0, r.x1, cz, 1, 0], [1, r.x0, cz, -1, 0], [4, cx, r.z1, 0, 1], [5, cx, r.z0, 0, -1]]) {
          if (shared(x + nx, z + nz, r)) continue;
          const d = streetD(...toWorld(x, z)); if (d < FRONT_D && streetD(...toWorld(x + nx * FRONT_PROBE, z + nz * FRONT_PROBE)) < d - 1) fronts.push(f); }
        const base = Object.keys(STUCCO)[(hash(ox, oz, 2) * 2) | 0];
        plainWall(L, base, r, 0, Math.min(GF, h));
        if (h > GF + 0.5) kitWall(L, look.w, r, GF, h, k);
        if (fronts.length) out.shops++;
        for (const f of fronts) {
          const a0 = f === 4 || f === 5 ? r.x0 : r.z0, a1 = f === 4 || f === 5 ? r.x1 : r.z1, n = Math.max(1, Math.round((a1 - a0) / UNIT)), uw = (a1 - a0) / n;
          faceBox(L, 'corniceDark', f, r, a0, a1, GF - 0.12, GF + 0.06, 0, 0.22);   // the steel lintel over the shops
          for (let u = 0; u < n; u++) {
            const u0 = a0 + u * uw + 0.35, u1 = a0 + (u + 1) * uw - 0.35, ku = hash(ox + u * 3.1, oz, 3);
            faceBox(L, 'glassDark', f, r, u0, u1, GLASS_Y0, GLASS_Y1, 0, 0.04);
            const m = Math.max(1, Math.round((u1 - u0) / MULL)); for (let i = 0; i <= m; i++) { const a = u0 + (u1 - u0) * i / m; faceBox(L, 'steelDark', f, r, a - 0.05, a + 0.05, GLASS_Y0, GLASS_Y1, 0, 0.08); }
            faceBox(L, 'steelDark', f, r, u0, u1, 1.0, 1.08, 0, 0.08);   // transom bar
            if (ku < 0.62) L.add('signAtlas', facePlane(f, r, u0, u1, SIGN_Y0, SIGN_Y1, 0.06, M.signCell(SIGN_CELLS[(ku * 97 | 0) % SIGN_CELLS.length])), { uv: false });
            else faceBox(L, FASCIA[(ku * 31 | 0) % FASCIA.length], f, r, u0, u1, SIGN_Y0, SIGN_Y1, 0, 0.06);
          }
        }
      } else if (look.k === 'slab') {
        const key = E[look.w] || look.w; kitWall(L, key, r, 0, h, k);
        if (h > 9 && look.w !== 'eastWhite') for (const f of [0, 1, 4, 5]) { const a0 = f === 4 || f === 5 ? r.x0 : r.z0, a1 = f === 4 || f === 5 ? r.x1 : r.z1; faceBox(L, look.w === 'eastRust' ? 'cornice' : 'corniceDark', f, r, a0 - 0.25, a1 + 0.25, h - 0.55, h - 0.15, 0, 0.25); }   // stone / pressed-metal cornice
      } else if (look.k === 'glass') {
        plainWall(L, look.w, r, y0, h);
        for (let y = y0 + FAC.FL; y < h - 1; y += FAC.FL) for (const f of [0, 1, 4, 5]) { const a0 = f === 4 || f === 5 ? r.x0 : r.z0, a1 = f === 4 || f === 5 ? r.x1 : r.z1; faceBox(L, 'concrete', f, r, a0, a1, y - 0.18, y + 0.18, 0, 0.12); }   // slab edges
      } else plainWall(L, look.w, r, y0, h);
      roofKit(L, r.x0, r.z0, r.x1, r.z1, h, look.r, R, look.k === 'plain' && h < 6 ? 1 : 1 + Math.floor(R() * 3));
      if (look.k === 'slab' && h >= TANK_H && h < 40 && r.x1 - r.x0 > 8 && r.z1 - r.z0 > 8 && R() < 0.35) s2Tank(L, cx + (R() - 0.5) * 2, cz + (R() - 0.5) * 2, h + 0.3, R);
      // colliders: one AABB on an aligned rect; on a turned one, CELL-sized cells round its walls, each AABB bulging < 0.5 m
      if (!rot) { world.box([r.x0, y0, r.z0], [r.x1, h, r.z1]); out.cells++; continue; }
      const ring = []; const nx = Math.max(1, Math.round((r.x1 - r.x0) / CELL)), nz = Math.max(1, Math.round((r.z1 - r.z0) / CELL)), sx = (r.x1 - r.x0) / nx, sz = (r.z1 - r.z0) / nz;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) ring.push([r.x0 + i * sx, r.z0 + j * sz]);
      for (const [x0, z0] of ring) { const c = [[x0, z0], [x0 + sx, z0], [x0, z0 + sz], [x0 + sx, z0 + sz]].map(([x, z]) => toWorld(x, z));
        const bx = world.box([Math.min(...c.map((p) => p[0])), y0, Math.min(...c.map((p) => p[1]))], [Math.max(...c.map((p) => p[0])), h, Math.max(...c.map((p) => p[1]))]);
        if (bx) bx.quad = [0, 1, 3, 2].map((i) => c[i]); out.cells++; }
    }
    if (rot) L.moveInto(B, new THREE.Matrix4().makeTranslation(ox, 0, oz).multiply(new THREE.Matrix4().makeRotationY(-rot)).multiply(new THREE.Matrix4().makeTranslation(-ox, 0, -oz)));
  }
  B.flush();
  return out;
}

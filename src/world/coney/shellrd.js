// CONEY S2: the few blocks north of Neptune Av and east of Shell Rd, round the F el and the Neptune Av station (to about W 5 St
// and three short blocks up; further east toward Ocean Pkwy is a later section). OSM maps no buildings there, so horizon.js's sprawl fills them with instanced tinted boxes on a 256 px
// tile; inside S2 those boxes are built on the facade kit instead (mats.js brickFacadeKit): the rowhouses and walk-ups in
// running-bond brick (the S1 tower keys, no new tile), and the ones fronting Shell Rd / Neptune Av as taxpayers, painted
// masonry over the kit's brick normal map with storefront glass, mullions and sign boards at street level. Same footprints and
// heights as the sprawl boxes; visual only (no colliders, as before), own hash only (never world.R).
import * as THREE from 'three';
import { Batch } from '../sbu/geo.js';
import { roofKit } from '../sbu/buildings.js';
import { brickFacadeKit, eastTowerMats, facadeBoxUV, boxFaces, metreUV, FAC, EAST_WHITE } from './mats.js';
import { STREET_NAMES } from './streetnames.js';
import { segDist } from '../osmkit.js';

const lines = (n) => STREET_NAMES.filter((s) => s.n === n).map((s) => s.p);
const SHELL = lines('Shell Rd'), NEPTUNE = lines('Neptune Av');
/** every value polyline set L takes on axis b where axis a equals v (a/b: 0 = x, 1 = z) */
const cuts = (L, a, b, v) => { const out = []; for (const p of L) for (let i = 0; i + 1 < p.length; i++) { const u0 = p[i][a], u1 = p[i + 1][a]; if (u0 !== u1 && (v - u0) * (v - u1) <= 0) out.push(p[i][b] + (p[i + 1][b] - p[i][b]) * (v - u0) / (u1 - u0)); } return out; };
export const S2 = { x0: 400, x1: 760, z0: -760, z1: -460 };   // x1: about W 5 St; z0: three short blocks north of Neptune Av
const S2_KERB = 8;   // m: keep this far off the bounding streets' centrelines
/** north of Neptune Av and east of Shell Rd, inside S2 (by a box's centroid) */
export function inS2(x, z) {
  if (x < S2.x0 || x > S2.x1 || z < S2.z0 || z > S2.z1) return false;
  const nz = cuts(NEPTUNE, 0, 1, x); if (!nz.length || z > Math.min(...nz) - S2_KERB) return false;
  const sx = cuts(SHELL, 1, 0, z); return sx.length > 0 && x > Math.max(...sx) + S2_KERB;
}

const GF = 3.6, GLASS_Y0 = 0.35, GLASS_Y1 = 2.75, SIGN_Y0 = 2.85, SIGN_Y1 = 3.45, UNIT = 7, MULL = 2.4;   // m: the taxpayer's shop storey
const PAINT_H = 15;   // m: lower than this, a shop building is a painted taxpayer
const FRONT_D = 28, FRONT_PROBE = 4;   // m: a face within this of Shell Rd / Neptune Av that faces it is a shopfront
const SIGN_CELLS = [11, 9, 10, 15, 13, 6, 5];   // mats.js SIGNS: PIZZA, BAR & GRILL, RESTAURANT, SEAFOOD, TACOS, COLD BEER, ICE CREAM
const FASCIA = ['fascia7', 'fascia5', 'fascia2'];   // plain sign bands: black, cream, blue
// painted masonry for the taxpayers' upper floors: the kit's light brick diffuse (eastWhite) under a paint colour, one material each
const PAINT = { s2Cream: 0xf0dcb8, s2Grey: 0xc6cac8, s2Salmon: 0xe6bca2 };
const STUCCO = { s2Base0: 0xe4d8c0, s2Base1: 0xbfc3bf };   // the shop storey: painted brick (paintWall stucco over the courses normal)
export const S2_WIN = Object.keys(PAINT);   // horizon.js lights these windows at night with the S1 keys
// sprawl tint index (horizon.js TINTS) -> brick look: reds, brown, buffs, white, grey (painted), cream
const TINT_LOOK = ['brickRust', 'brickStaller', 'brickBuff', 'concreteWhite', 'brickRust', 'brickBuff', 's2Grey', 'brickBuff'];
const hash = (x, z, s = 0) => ((Math.sin((x + 1000 + s * 37.1) * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;

function s2Mats(world, M) {
  const E = eastTowerMats(world, M); if (M.s2Cream) return E;
  const kit = brickFacadeKit(world), reg = (key, mat) => { mat.name = key; M[key] = mat; M.surface[key] = 'concrete'; M.uvScale[key] = 1; };
  for (const [k, c] of Object.entries(PAINT)) reg(k, kit.mat('eastWhite', EAST_WHITE, {}, { color: c }));
  for (const [k, c] of Object.entries(STUCCO)) reg(k, new THREE.MeshStandardMaterial({ map: M.paintWall0.map, normalMap: kit.normalPlain, normalScale: new THREE.Vector2(0.7, 0.7), color: c, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 }));
  return E;
}

/** the sprawl's tint index for a box (horizon.js stores the RGB triple) */
function tintIndex(T, tint) { let best = 0, bd = 1e9; T.forEach((t, i) => { const d = (t[0] - tint[0]) ** 2 + (t[1] - tint[1]) ** 2 + (t[2] - tint[2]) ** 2; if (d < bd) { bd = d; best = i; } }); return best; }

/** a +z plane w x h moved onto face f (0 +x, 1 -x, 4 +z, 5 -z) of the box, `off` proud, UVs in atlas rect [u0, v0, du, dv] */
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

/** the kit wall (windows) on the four sides of b from y0 up, tile offset by whole bays / storeys from the centroid */
function kitWall(B, key, b, y0, k) {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.h - y0, du = ((k * 64) | 0) % FAC.TB / FAC.TB, dv = ((k * 997) | 0) % FAC.TF / FAC.TF;
  const g = boxFaces(facadeBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d), [0, 1, 4, 5]), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  g.translate((b.x0 + b.x1) / 2, y0 + h / 2, (b.z0 + b.z1) / 2); B.add(key, g, { uv: false });
}

/** the faces of b that look onto Shell Rd or Neptune Av from within FRONT_D */
function shopFaces(b) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, out = [];
  const near = (x, z) => Math.min(...SHELL.map((p) => segDist(x, z, p)), ...NEPTUNE.map((p) => segDist(x, z, p)));
  for (const [f, x, z, nx, nz] of [[0, b.x1, cz, 1, 0], [1, b.x0, cz, -1, 0], [4, cx, b.z1, 0, 1], [5, cx, b.z0, 0, -1]]) {
    const d = near(x, z); if (d < FRONT_D && near(x + nx * FRONT_PROBE, z + nz * FRONT_PROBE) < d - 1) out.push(f); }
  return out;
}

// roof kit: local PRNG only (mulberry32 seeded from the centroid), never world.R: shellrd.js's own hash rule applies to roofs too.
const ROOF_LOOKS = ['steelDark', 'roofMetal', 'roof'];   // dark tar, grey membrane, gravel ballast: all already loaded by sbu/mats.js, no new textures
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const roofRng = (cx, cz) => mulberry32((Math.round(cx * 97.13) ^ Math.round(cz * 193.71) ^ 0x9e3779b9) | 0);

/** a wooden-barrel water tank on a steel stand, roof-mounted: existing materials only (steelDark, planksDark), collide:false */
function s2Tank(B, cx, cz, y0, R) {
  const lx = 1.2 + R() * 0.3;
  for (const [dx, dz] of [[-lx, -lx], [lx, -lx], [-lx, lx], [lx, lx]]) B.cyl('steelDark', cx + dx, cz + dz, y0, y0 + 1.6, 0.08, 6);
  B.box('steelDark', [cx - lx - 0.1, y0 + 1.55, cz - lx - 0.1], [cx + lx + 0.1, y0 + 1.7, cz + lx + 0.1], { collide: false });   // brace plate
  B.cyl('planksDark', cx, cz, y0 + 1.7, y0 + 3.5, 1.1, 10);   // barrel
  for (const hy of [y0 + 2.1, y0 + 2.9]) B.cyl('steelDark', cx, cz, hy, hy + 0.08, 1.13, 10);   // hoop bands
  B.add('steelDark', new THREE.ConeGeometry(1.2, 0.9, 10).translate(cx, y0 + 3.95, cz), { uv: false });   // conical cap
}

/** parapet cap + a hashed dark-tar / grey-membrane / gravel deck, HVAC units and a stair bulkhead (roofKit, sbu/buildings.js),
 *  and on ~1 in 4 of the taller walk-ups a water tank. R is a fresh mulberry32 per building, seeded from its centroid. */
function s2Roof(B, b) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, R = roofRng(cx, cz);
  const k = R(), look = ROOF_LOOKS[k < 0.4 ? 0 : k < 0.75 ? 1 : 2];
  roofKit(B, b.x0, b.z0, b.x1, b.z1, b.h, look, R, 1 + Math.floor(R() * 3));
  if (b.h >= PAINT_H && b.x1 - b.x0 > 8 && b.z1 - b.z0 > 8 && R() < 0.25) s2Tank(B, cx + (R() - 0.5) * 2, cz + (R() - 0.5) * 2, b.h + 0.3, R);
}

/** the S2 boxes (horizon.js sprawl entries {x0, z0, x1, z1, h, tint}) on the facade kit; T: the sprawl's tint table */
export function buildS2(world, M, boxes, T) {
  const E = s2Mats(world, M), B = new Batch(world, M, 'shellRd');
  let shops = 0;
  for (const b of boxes) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, k = hash(cx, cz), w = b.x1 - b.x0, d = b.z1 - b.z0;
    const fronts = w > 5 && d > 5 ? shopFaces(b) : [], look = TINT_LOOK[tintIndex(T, b.tint)];
    if (fronts.length) {   // shops on the ground floor: painted flats above on a low taxpayer, the brick on a walk-up
      shops++;
      const paint = b.h < PAINT_H ? S2_WIN[(hash(cx, cz, 1) * S2_WIN.length) | 0] : E[look] || look, base = Object.keys(STUCCO)[(hash(cx, cz, 2) * 2) | 0];
      const g = boxFaces(new THREE.BoxGeometry(w, GF, d), [0, 1, 4, 5]); g.translate(cx, GF / 2, cz); B.add(base, metreUV(g), { uv: false });
      kitWall(B, paint, b, GF, k);
      for (const f of fronts) {
        const a0 = f === 4 || f === 5 ? b.x0 : b.z0, a1 = f === 4 || f === 5 ? b.x1 : b.z1, n = Math.max(1, Math.round((a1 - a0) / UNIT)), uw = (a1 - a0) / n;
        faceBox(B, 'corniceDark', f, b, a0, a1, GF - 0.12, GF + 0.06, 0, 0.22);   // the steel lintel over the shops
        for (let u = 0; u < n; u++) {
          const u0 = a0 + u * uw + 0.35, u1 = a0 + (u + 1) * uw - 0.35, ku = hash(cx + u * 3.1, cz, 3);
          faceBox(B, 'glassDark', f, b, u0, u1, GLASS_Y0, GLASS_Y1, 0, 0.04);
          const m = Math.max(1, Math.round((u1 - u0) / MULL)); for (let i = 0; i <= m; i++) { const a = u0 + (u1 - u0) * i / m; faceBox(B, 'steelDark', f, b, a - 0.05, a + 0.05, GLASS_Y0, GLASS_Y1, 0, 0.08); }
          faceBox(B, 'steelDark', f, b, u0, u1, 1.0, 1.08, 0, 0.08);   // transom bar
          if (ku < 0.62) B.add('signAtlas', facePlane(f, b, u0, u1, SIGN_Y0, SIGN_Y1, 0.06, M.signCell(SIGN_CELLS[(ku * 97 | 0) % SIGN_CELLS.length])), { uv: false });
          else faceBox(B, FASCIA[(ku * 31 | 0) % FASCIA.length], f, b, u0, u1, SIGN_Y0, SIGN_Y1, 0, 0.06);
        }
      }
    } else {   // rowhouse strips and walk-ups: the S1 brick, by the sprawl's tint
      kitWall(B, E[look] || look, b, 0, k);
      if (b.h > 9 && look !== 'concreteWhite') for (const f of [0, 1, 4, 5]) { const a0 = f === 4 || f === 5 ? b.x0 : b.z0, a1 = f === 4 || f === 5 ? b.x1 : b.z1; faceBox(B, look === 'brickRust' ? 'cornice' : 'corniceDark', f, b, a0 - 0.25, a1 + 0.25, b.h - 0.55, b.h - 0.15, 0, 0.25); }   // pressed-metal / stone cornice
    }
    s2Roof(B, b);
  }
  B.flush();
  return { boxes: boxes.length, shops };
}

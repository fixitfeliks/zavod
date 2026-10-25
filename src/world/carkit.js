// Shared car kit (sedan / cab / hatch / suv / e34 / van, the sports and Soviet kinds; see KINDS). Owned by: main (integration); used by wsp, terminal, sbu.
// The old cars were extruded side profiles: slab sides, square section, glass as a separate band — a PS1 read up close.
// These are lofted: ~40 cross-sections along the length, each a rounded section with tumblehome (the greenhouse leans
// in), plan-view taper at nose and tail, real wheel arches cut into the sills, a greenhouse with A/B/C pillars, and
// separate slots for glass / tyres / rims / trim / lamps / plates so each map instances them with its own materials.
// Car frame: +x = front, y up (ground 0), z = width. Returns { geos: {paint, glass, rubber, rim, trim, lampW, lampR, plate}, len, w, h }.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hasCarModel, instanceCarModel, kitModelPending, onCarModel } from './carmodels.js';

const KINDS = {
  //         len   w     clear belt  roof  hood   nose(x of windshield base, top), rear(top, base), wheel x, B-pillar x, tail height
  sedan: { len: 4.75, w: 1.82, clr: 0.19, belt: 0.95, roof: 1.44, hood: 0.86, ws: [1.02, 0.05], rs: [-0.55, -1.5], wheels: [1.43, -1.4], b: [0.02], trunk: 1.0 },   // modern Camry-style: fast windshield, sloped backlight, short deck
  cab:   { len: 4.9, w: 1.84, clr: 0.2, belt: 0.95, roof: 1.5, hood: 0.88, ws: [0.86, 0.22], rs: [-0.92, -1.38], wheels: [1.47, -1.45], b: [0.0], trunk: 1.0, sign: true },   // Crown Vic-style formal roof, long trunk
  hatch: { len: 4.2, w: 1.76, clr: 0.19, belt: 0.95, roof: 1.46, hood: 0.84, ws: [0.9, 0.18], rs: [-1.25, -1.85], wheels: [1.3, -1.28], b: [0.1], trunk: 1.0 },
  suv:   { len: 4.8, w: 1.92, clr: 0.28, belt: 1.13, roof: 1.78, hood: 1.06, ws: [1.1, 0.42], rs: [-2.02, -2.2], wheels: [1.47, -1.44], b: [0.2, -0.95], trunk: 1.14, square: true, rack: true, clad: true },   // two-box, upright tail, roof rack, black arch cladding
  // BMW E34 (4.72 x 1.75 m, 2.76 m wheelbase): long hood, short overhangs, upright thin-pillared glasshouse with the Hofmeister
  // kink, flat upright trunk; shark nose with twin kidneys and quad round lamps under the hood's lip (kidney: the E34 extras)
  e34:   { len: 4.72, w: 1.75, clr: 0.17, belt: 0.86, roof: 1.42, hood: 0.82, ws: [0.76, 0.16], rs: [-1.0, -1.42], wheels: [1.44, -1.32], b: [-0.2], trunk: 0.9, square: true, kidney: true },
  coupe: { len: 4.45, w: 1.94, clr: 0.14, belt: 0.78, roof: 1.22, hood: 0.72, ws: [0.55, -0.35], rs: [-0.95, -1.7], wheels: [1.33, -1.3], b: [-0.35], trunk: 0.84, sport: true, eye: { x: 0.05, y: 1.02, z: -0.36 } },   // mid-engine supercar (Ferrari model: cockpit ahead of the engine)
  muscle: { len: 4.8, w: 1.9, clr: 0.16, belt: 0.86, roof: 1.33, hood: 0.84, ws: [0.75, -0.1], rs: [-0.75, -1.6], wheels: [1.45, -1.4], b: [-0.1], trunk: 0.88, sport: true },   // Camaro-ish
  // Soviet classics: boxy three-box sedans, narrow track, chrome bumpers
  lada: { len: 4.12, w: 1.62, clr: 0.17, belt: 0.92, roof: 1.44, hood: 0.86, ws: [0.62, 0.12], rs: [-0.74, -1.22], wheels: [1.21, -1.21], b: [-0.2], trunk: 0.9, boxy: true },
  volga: { len: 4.73, w: 1.8, clr: 0.18, belt: 0.93, roof: 1.48, hood: 0.88, ws: [0.8, 0.24], rs: [-0.95, -1.45], wheels: [1.4, -1.4], b: [-0.2], trunk: 0.93, boxy: true },
  moskvich: { len: 4.1, w: 1.55, clr: 0.18, belt: 0.93, roof: 1.45, hood: 0.87, ws: [0.6, 0.1], rs: [-0.7, -1.2], wheels: [1.2, -1.2], b: [-0.2], trunk: 0.92, boxy: true },
  van:   { len: 5.2, w: 1.98, clr: 0.24, belt: 1.12, roof: 2.08, hood: 1.02, ws: [1.72, 1.2], rs: [-2.5, -2.58], wheels: [1.68, -1.72], b: [0.7], trunk: 1.12, panel: true },
  // Real-model kinds (see carmodels.js KIT): procedural specs below are only the fallback body shown before each
  // model loads, or for good if it fails to - so they just need to be a plausible stand-in at the model's own length.
  'bmw-m4': { len: 4.06, w: 1.68, clr: 0.16, belt: 0.84, roof: 1.3, hood: 0.78, ws: [0.65, -0.1], rs: [-0.8, -1.5], wheels: [1.35, -1.3], b: [-0.1], trunk: 0.88, sport: true },
};
for (const k of ['cab', 'van', 'lada', 'volga', 'moskvich']) KINDS[k].rimStyle = 'steel';   // fleet / Soviet: steel wheels, hubcaps
for (const k of ['coupe', 'muscle', 'suv', 'bmw-m4']) KINDS[k].rimStyle = 'multi';
export const CAR_KINDS = Object.keys(KINDS);
const ARCH_GAP = 0.07, WHEEL_INSET = 0.13;   // arch radius over the tyre's; tyre centre in from the body side
const tyreR = (K) => (K.clr > 0.25 ? 0.37 : 0.345);
const isLite = () => typeof window !== 'undefined' && !!window.__zavodLite;
/** Coney's parked mix: real models (not a procedural body) are the primary cars - the sedan pool (Sloyd sedan, BMW
 *  M4) together about 9 in 18 (~50%); two E34s in 18 (~11%). Phones swap the muscle car for a sedan, so the E34
 *  costs no extra kind (each kind in a placeCars call is its own set of instanced draws). pick(R) draws one kind. */
const PARK_MIX = ['sedan', 'sedan', 'bmw-m4', 'e34', 'suv', 'hatch', 'sedan', 'van', 'cab', 'coupe', 'muscle', 'sedan', 'bmw-m4', 'e34', 'suv', 'hatch', 'sedan', 'sedan'];
export function parkMix(ctx, mix = PARK_MIX) { const m = mix.map((k) => (ctx?.lite && k === 'muscle' ? 'sedan' : k)); return (R) => m[(R() * m.length) | 0]; }
export function carSpec(kind) { return KINDS[kind]; }

// plan-view half width at x: boxy / square bodies keep square corners, the rest taper at nose and tail
const halfWOf = (K) => { const HW = K.w / 2, xf = K.len / 2, xr = -xf; return (x) => { const u = x > 0 ? x / xf : x / xr; return K.boxy || K.square ? HW * (1 - 0.04 * Math.pow(u, 12)) : HW * (1 - 0.1 * Math.pow(u, 6)); }; };
const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

// The plate material's texture is a small atlas (plateTex): the NY plate on top; chrome, an amber lens and the BMW roundel below.
// The E34's brightwork rides the plate slot, so it costs no draw call. Geometry with no uv samples (0, 0): chrome.
const ATLAS = { plate: [0, 0.505, 1, 0.995], chrome: [0.02, 0.02, 0.22, 0.47], amber: [0.28, 0.03, 0.47, 0.22], roundel: [0.5, 0, 1, 0.5] };
function atlas(g, [u0, v0, u1, v1]) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i)); return g; }
// Panel seams: door shut lines, handles and the shoulder crease are drawn in one shared texture (seamTex) instead of geometry.
// seamUV maps each kind's side faces onto it: x through its C / B / A shut lines to fixed u (SEAM_U), y from above the sill to
// the belt to SEAM_V; every other face (hood, roof, ends) samples the blank margin.
const SEAM_U = [0.02, 0.25, 0.5, 0.75, 0.98], SEAM_V = [0.1, 0.9], SEAM_BLANK = [0.01, 0.99], SEAM_SIDE = 0.5, SEAM_BUMP = 1.5;   // SEAM_SIDE: |normal.z| above which a face is a side panel; SEAM_BUMP: desktop bump depth of the lines
/** glass panes: a planar uv over the pane's own bounds (x / y for side glass, z / y for the windshield and backlight) for the crack map */
function planarUV(g, end) {
  g.computeBoundingBox(); const b = g.boundingBox, p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const a = end ? (p.getZ(i) - b.min.z) / (b.max.z - b.min.z || 1) : (p.getX(i) - b.min.x) / (b.max.x - b.min.x || 1); uv[i * 2] = a; uv[i * 2 + 1] = (p.getY(i) - b.min.y) / (b.max.y - b.min.y || 1); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function seamUV(K, g) {
  const xf = K.len / 2, X = [-xf, K.rs[1] + 0.35, K.b[0], K.ws[0] - 0.08, xf], y0 = K.clr + 0.1;
  const u = (x) => { let i = 1; while (i < X.length - 1 && x > X[i]) i++; return SEAM_U[i - 1] + (SEAM_U[i] - SEAM_U[i - 1]) * (x - X[i - 1]) / (X[i] - X[i - 1]); };
  const v = (y) => SEAM_V[0] + (SEAM_V[1] - SEAM_V[0]) * (y - y0) / (K.belt - y0);
  const p = g.attributes.position.array, uv = new Float32Array(p.length / 3 * 2);
  for (let t = 0; t < p.length; t += 9) {   // per triangle (non-indexed), so a face never straddles the two mappings
    const ax = p[t + 3] - p[t], ay = p[t + 4] - p[t + 1], az = p[t + 5] - p[t + 2], bx = p[t + 6] - p[t], by = p[t + 7] - p[t + 1], bz = p[t + 8] - p[t + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, side = Math.abs(nz) > SEAM_SIDE * Math.hypot(nx, ny, nz);
    for (let k = 0; k < 3; k++) { const o = (t / 3 + k) * 2, q = t + k * 3; uv[o] = side ? u(p[q]) : SEAM_BLANK[0]; uv[o + 1] = side ? v(p[q + 1]) : SEAM_BLANK[1]; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function carGeometries(kind = 'sedan', { wheels = true, panels = false } = {}) {
  const K = KINDS[kind]; const L = K.len, HW = K.w / 2, xf = L / 2, xr = -L / 2;
  const NS = 44;                       // stations along the length (22 read faceted up close)
  const xs = []; for (let i = 0; i <= NS; i++) { const t = i / NS; xs.push(xr + (xf - xr) * (0.5 - 0.5 * Math.cos(Math.PI * t))); } // denser at the ends
  const [wsBase, wsTop] = K.ws, [rsTop, rsBase] = K.rs;
  const wheelR = tyreR(K), archY = wheelR, archR = wheelR + ARCH_GAP;   // the arch is concentric with the wheel, a few cm of gap over the tyre
  // side profile
  const beltAt = (x) => { // top of the lower body: hood at the front, rising to the belt at the windshield base, trunk deck behind
    if (x > wsBase) return K.hood + (K.belt - K.hood) * (1 - smooth(wsBase, xf, x)) - (K.kidney ? 0.04 : 0.12) * smooth(xf - 0.35, xf, x);   // E34: shark nose, the hood runs out flat over the lamps
    if (x < rsBase) return K.trunk - 0.1 * smooth(xr + 0.3, xr, x);
    return K.belt;
  };
  const roofAt = (x) => { // greenhouse top; equals the belt outside [rsBase, wsBase]
    if (x >= wsBase || x <= rsBase) return beltAt(x);
    const b = beltAt(x);
    if (x > wsTop) return b + (K.roof - b) * Math.pow((wsBase - x) / (wsBase - wsTop), 0.8);
    if (x < rsTop) return b + (K.roof - b) * Math.pow((x - rsBase) / (rsTop - rsBase), 0.75);
    return K.roof + 0.02 * Math.cos(((x - (wsTop + rsTop) / 2) / (wsTop - rsTop)) * Math.PI);
  };
  const bottomAt = (x) => { let y = K.clr + 0.02; for (const wx of K.wheels) { const d = Math.abs(x - wx); if (d < archR) y = Math.max(y, archY + Math.sqrt(archR * archR - d * d) * 0.98); } return y; };
  const halfW = halfWOf(K);
  // cross-section ring: [z/halfW, y-param] from bottom-right around the top to bottom-left.
  // y-param: 'b' bottom, 'r' rocker, 's' shoulder, 'e' belt edge, 'g' glass (lerp belt→roof), 'R' roof edge, 'C' roof centre
  const ring = [[0.86, 'b'], [0.985, 'r'], [1.0, 's'], [0.975, 'e'], [0.9, 'g1'], [0.8, 'g2'], [0.74, 'R'], [0.4, 'C'], [0.0, 'C0']];
  const RN = ring.length; const full = []; for (let i = 0; i < RN; i++) full.push([ring[i][0], ring[i][1]]); for (let i = RN - 2; i >= 0; i--) full.push([-ring[i][0], ring[i][1]]);
  const M = full.length;
  const pos = [], floorPos = [];   // floorPos: the 'b' corners per station at sill height (the floor ignores the arches)
  for (const x of xs) {
    const hw = halfW(x), b = bottomAt(x), be = beltAt(x), ro = roofAt(x), inGH = ro > be + 0.02;
    const tumble = inGH ? 1 : 0;
    for (const [zk, k] of full) {
      let y, z = zk * hw;
      switch (k) {
        case 'b': y = b; break;
        case 'r': y = b + 0.1; break;
        case 's': y = be - 0.1; z *= 1.0; break;
        case 'e': y = be; break;
        case 'g1': y = be + (ro - be) * 0.35; z = Math.sign(zk) * hw * (0.975 - 0.07 * tumble); break;
        case 'g2': y = be + (ro - be) * 0.82; z = Math.sign(zk) * hw * (0.975 - 0.16 * tumble); break;
        case 'R': y = ro; z = Math.sign(zk) * hw * (0.975 - 0.24 * tumble); break;
        case 'C': y = ro + 0.025 * tumble + 0.03 * (1 - tumble); z = Math.sign(zk) * hw * 0.42; break;
        case 'C0': y = ro + 0.03 * tumble + 0.035 * (1 - tumble); z = 0; break;
      }
      if (!inGH && (k === 'g1' || k === 'g2' || k === 'R')) { y = be + (k === 'g1' ? 0.008 : k === 'g2' ? 0.016 : 0.022); z = Math.sign(zk) * hw * (k === 'g1' ? 0.955 : k === 'g2' ? 0.9 : 0.8); }
      // nose/tail round-over in elevation: pull the extreme stations' top in and down
      const endK = Math.max(smooth(xf - 0.12, xf, x), smooth(xr + 0.12, xr, x)), pull = K.kidney ? 0.12 : 0.35;   // E34: a tall flat nose and tail
      if (endK > 0) { y = y - (y - (b + be) / 2) * pull * endK; z *= 1 - 0.12 * endK; }
      if (k === 'b') { const b0 = K.clr + 0.02; floorPos.push(x, endK > 0 ? b0 - (b0 - (b0 + be) / 2) * pull * endK : b0, z); }
      pos.push(x, y, z);
    }
  }
  const idxPaint = [], idxGlass = [], idxDark = [];   // idxDark: the rocker cladding and the window seals (trim slot)
  const segOf = (j) => { const k = full[j][1], k2 = full[(j + 1) % M][1]; return k + '>' + k2; };
  const glassSide = new Set(['e>g1', 'g1>g2', 'g2>R', 'R>g2', 'g2>g1', 'g1>e']);
  const glassTop = new Set(['R>C', 'C>C0', 'C0>C', 'C>R']);
  // E34: glazed down to the belt, and the Hofmeister kink: the C-pillar's foot sweeps forward, each side band ending further forward the lower it is
  const kink = K.kidney ? { 'g2>R': 0, 'R>g2': 0, 'g1>g2': 0.07, 'g2>g1': 0.07, 'e>g1': 0.17, 'g1>e': 0.17 } : null;
  const pillar = (x) => { const bs = K.b; for (const bx of bs) if (Math.abs(x - bx) < 0.07) return true; return x > wsBase - 0.12 || x < rsBase + 0.1 || (x > wsTop - 0.02 && x < wsTop + 0.12) || (x < rsTop + 0.02 && x > rsTop - 0.14); };
  // panels (driven cars: vehicledamage.js dents, hangs and drops them; doors open): the loft's quads sorted into hood, trunk, front
  // fenders, doors and the glass panes by where they sit; the shared geometry (parked / traffic) keeps one paint and one glass
  const PN = panels ? {} : null, SIDE = new Set(['b>r', 'r>s', 's>e', 'e>s', 's>r', 'r>b']), shutA = wsBase - 0.08, shutC = rsBase + 0.35, bx0 = K.b[0];
  const panelOf = (xm, inGH, s, g, zs) => {
    const sd = zs > 0 ? 'R' : 'L', side = SIDE.has(s);
    if (g) return glassTop.has(s) ? (xm > 0 ? 'glassW' : 'glassB') : 'glass' + (xm > bx0 || K.sport ? 'F' : 'R') + sd;
    if (!side && !inGH && xm > wsBase && xm < xf - 0.1) return 'hood';
    if (!side && !inGH && xm < rsBase && xm > xr + 0.1 && !K.panel && !K.square) return 'trunk';
    if (!side) return null;
    if (xm > shutA + 0.03 && xm < xf - 0.18 && s !== 'b>r' && s !== 'r>b') return 'fender' + sd;
    if (xm > (K.sport ? shutC : bx0) + 0.02 && xm < shutA - 0.02) return 'doorF' + sd;
    if (!K.sport && !K.panel && xm > shutC + 0.02 && xm < bx0 - 0.02) return 'doorR' + sd;
    return null;
  };
  if (PN) for (const n of ['hood', 'trunk', 'fenderL', 'fenderR', 'doorFL', 'doorFR', 'doorRL', 'doorRR', 'glassW', 'glassB', 'glassFL', 'glassFR', 'glassRL', 'glassRR']) PN[n] = [];
  for (let i = 0; i < NS; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2, inGH = roofAt(xm) > beltAt(xm) + 0.05;
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = a + 1, c = a + M, d = c + 1;
      const s = segOf(j);
      let g = false;
      if (inGH && glassSide.has(s) && (kink || (s !== 'e>g1' && s !== 'g1>e')) && !pillar(xm) && !(K.panel && xm < K.b[0] - 0.1)) g = true;   // side windows (panel van: blind rear)
      if (g && kink && kink[s] != null && xm < rsTop + 0.02 + kink[s]) g = false;
      if (inGH && glassTop.has(s) && (xm > wsTop + 0.05 || (xm < rsTop - 0.05 && !K.panel))) g = true;                         // windshield / backlight
      // dark rocker along the sills (grounds the body, reads lower) and a black seal under the side glass: the belt line
      const dark = (!K.boxy && (s === 'b>r' || s === 'r>b')) || (!kink && !g && inGH && (s === 'e>g1' || s === 'g1>e') && !pillar(xm));
      const pn = PN && !dark ? panelOf(xm, inGH, s, g, full[j][0] + full[j + 1][0]) : null;
      (pn ? PN[pn] : g ? idxGlass : dark ? idxDark : idxPaint).push(a, c, b, b, c, d);
    }
  }
  // end caps (fan)
  // (the ring is open across the bottom: the fan's last triangle closes the nose / tail down to the sill chord)
  // each triangle is wound to face out along the car (dir -1 tail, +1 nose); a fixed winding left the tail panel facing in
  const capFan = (st, dir) => { const base = st * M; const cx = pos.length / 3; let sy = 0; for (let j = 0; j < M; j++) sy += pos[(base + j) * 3 + 1]; sy /= M; pos.push(xs[st], sy, 0);
    const P = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), n = new THREE.Vector3();
    for (let j = 0; j < M; j++) { const a = base + j, b = base + (j + 1) % M, o = P(cx); n.subVectors(P(a), o).cross(new THREE.Vector3().subVectors(P(b), o)); n.x * dir >= 0 ? idxPaint.push(cx, a, b) : idxPaint.push(cx, b, a); } };
  capFan(0, -1); capFan(NS, 1);
  const mk = (idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g.toNonIndexed(); };
  const paint = mk(idxPaint), glass = mk(idxGlass), darkSkin = mk(idxDark);
  // the glass shares the body's edges exactly: pushing it in (for a frame line) opened a crack all round every window

  const parts = { rubber: [], rim: [], trim: [darkSkin], lampW: [], lampR: [], plate: [], paintX: [], caliper: [] }, bumpers = { bumperF: [], bumperR: [] };
  const box = (arr, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); arr.push(g); return g; };
  // closed underside + wheel wells. The loft is a shell open at the bottom and its inside faces are culled, so anything that
  // looked in (into an arch, under a sill, through the nose cap) saw straight through the car. Floor: both windings (dark
  // from below, and the cabin floor from inside). Each well: a liner strip over the arch and down its two legs to the floor,
  // and an inboard wall (the arch shape), both wound both ways, so an arch reads as a dark pocket from outside and a hump inside.
  { const T = [], orient = (a, b, c, toward) => { const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)), m = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3); return n.dot(toward(m)) >= 0 ? [a, b, c] : [a, c, b]; };
    const tri = (a, b, c, toward) => { for (const v of orient(a, b, c, toward)) T.push(v.x, v.y, v.z); }, V = (i) => new THREE.Vector3(floorPos[i * 3], floorPos[i * 3 + 1], floorPos[i * 3 + 2]);
    const down = () => new THREE.Vector3(0, -1, 0), up = () => new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < NS; i++) { const a = V(i * 2), b = V(i * 2 + 1), c = V(i * 2 + 2), d = V(i * 2 + 3); for (const f of [down, up]) { tri(a, b, c, f); tri(b, d, c, f); } }
    const y0 = K.clr + 0.02, ARC = 12;
    for (const wx of K.wheels) for (const sz of [1, -1]) {
      const zo = sz * (halfW(wx) + 0.01), zi = sz * (halfW(wx) - 0.36);   // outer edge just past the skin; inboard wall behind the tyre
      const prof = [new THREE.Vector2(wx + archR, y0)]; for (let k = 0; k <= ARC; k++) { const a = k / ARC * Math.PI; prof.push(new THREE.Vector2(wx + Math.cos(a) * archR, archY + Math.sin(a) * archR * 0.98)); } prof.push(new THREE.Vector2(wx - archR, y0));
      for (let k = 0; k < prof.length - 1; k++) { const p = prof[k], q = prof[k + 1], P = (v, z) => new THREE.Vector3(v.x, v.y, z), inward = (m) => new THREE.Vector3(wx - m.x, archY - m.y, 0);
        const a = P(p, zo), b = P(q, zo), c = P(p, zi), d = P(q, zi), outward = (m) => inward(m).negate(); for (const f of [inward, outward]) { tri(a, b, c, f); tri(b, d, c, f); } }
      const ctr = new THREE.Vector3(wx, (y0 + archY) / 2, zi), out = () => new THREE.Vector3(0, 0, sz), inn = () => new THREE.Vector3(0, 0, -sz);
      for (let k = 0; k < prof.length - 1; k++) for (const f of [out, inn]) tri(ctr, new THREE.Vector3(prof[k].x, prof[k].y, zi), new THREE.Vector3(prof[k + 1].x, prof[k + 1].y, zi), f);   // both ways: the cabin sees the arch humps
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(T, 3)); g.computeVertexNormals(); parts.trim.push(g); }
  // wheels: the shared wheel (wheelGeometry: lathed tyre, the kind's rim style, dark disc) per corner, calipers fixed behind the spokes
  if (wheels) { const W = wheelGeometry(wheelR, K.rimStyle);
    for (const wx of K.wheels) for (const sz of [1, -1]) {
      const zc = sz * (halfW(wx) - WHEEL_INSET), place = (g) => { g = g.clone(); if (sz < 0) g.rotateY(Math.PI); g.translate(wx, wheelR, zc); return g; };
      parts.rubber.push(place(W.rubber)); parts.rim.push(place(W.rim)); parts.trim.push(place(W.trim)); parts.caliper.push(place(caliperGeometry(wheelR, (wx > 0 ? 1 : -1) * sz)));
    } }   // traffic: the wheels are separate instances that spin (wheelInstances)
  // lamps: headlamps wrap the nose corners, tail lamps across the tail corners
  const hlY = K.hood - (K.kidney ? 0.165 : 0.13), tlY = K.trunk - (K.kidney ? 0.16 : 0.12);
  for (const sz of [1, -1]) {
    if (K.kidney) {   // E34: two round lamps a side in the black nose band (below), an amber corner lamp wrapping round, wide tail clusters
      for (const lz of [0.32, 0.53]) { const l = new THREE.CylinderGeometry(0.072, 0.072, 0.03, 16); l.rotateZ(Math.PI / 2); l.translate(xf + 0.02, hlY, sz * lz); parts.lampW.push(l); }
      atlas(box(parts.plate, 0.03, 0.11, 0.1, xf + 0.008, hlY, sz * 0.66, 0, sz * 0.4), ATLAS.amber);
      box(parts.lampR, 0.035, 0.13, 0.46, xr - 0.006, tlY, sz * (halfW(xr + 0.1) - 0.26), 0, -sz * 0.06);   // proud of the flat tail panel
      atlas(box(parts.plate, 0.036, 0.04, 0.3, xr - 0.01, tlY - 0.045, sz * (halfW(xr + 0.1) - 0.29), 0, -sz * 0.06), ATLAS.amber);   // indicator strip under the red
    } else {
      const hz = sz * (halfW(xf - 0.1) - 0.3);
      box(parts.trim, 0.05, 0.13, 0.42, xf - 0.045, hlY, hz, 0, sz * 0.22);   // dark housing: the lens reads as a cluster, not a sticker
      box(parts.lampW, 0.05, 0.09, 0.36, xf - 0.035, hlY, hz, 0, sz * 0.22);
      box(parts.lampW, 0.03, 0.018, 0.34, xf - 0.02, hlY - 0.075, hz, 0, sz * 0.22);   // DRL strip
      const tz = sz * (halfW(xr + 0.1) - 0.27);
      box(parts.trim, 0.04, 0.11, 0.42, xr + 0.04, tlY, tz, 0, -sz * 0.18);
      box(parts.lampR, 0.035, 0.08, 0.36, xr + 0.03, tlY, tz, 0, -sz * 0.18);
      box(parts.lampW, 0.036, 0.03, 0.1, xr + 0.03, tlY - 0.02, tz - sz * 0.08, 0, -sz * 0.18);   // reversing lamp
    }
    // mirrors (paint) on a dark stalk
    const mx = wsBase - 0.2; box(parts.paintX, 0.1, 0.12, 0.2, mx, K.belt + 0.08, sz * (HW + 0.1)); box(parts.trim, 0.05, 0.04, 0.12, mx, K.belt + 0.04, sz * (HW + 0.02));
    // door handles, shut lines and the shoulder crease are in the paint's seam texture (seamUV / seamTex), not geometry
    // black window surround / B-pillar applique
    for (const bx of K.b) box(parts.trim, 0.12, (roofAt(bx) - K.belt) * 0.8, 0.012, bx, (roofAt(bx) + K.belt) / 2, sz * (halfW(bx) * 0.88 + 0.004), sz * 0.14);
  }
  // wheel-arch flares (black cladding on the SUV), the drip rail round the glasshouse, bumpers, kind extras
  for (const wx of K.wheels) for (const sz of [1, -1]) { const f = new THREE.TorusGeometry(archR + 0.012, K.clad ? 0.05 : 0.03, 5, 14, Math.PI); f.scale(1, 1, 0.7); f.translate(wx, archY, sz * (halfW(wx) - 0.006)); (K.clad ? parts.trim : parts.paintX).push(f); }
  { const T = [], tri = (a, b, c, o) => { const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)), m = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3).sub(o); for (const v of n.dot(m) >= 0 ? [a, b, c] : [a, c, b]) T.push(v.x, v.y, v.z); };
    // strip: rows of 3-point profiles along x, swept into an open ridge, wound both ways (seen through the glass from the cabin too)
    const strip = (rows) => { for (let i = 0; i < rows.length - 1; i++) { const A = rows[i], B = rows[i + 1]; for (let k = 0; k < 2; k++) for (const s of [1, -1]) { const o = new THREE.Vector3().subVectors(A[k + 1], A[k]).cross(new THREE.Vector3().subVectors(B[k], A[k])).multiplyScalar(-1e3 * s).add(A[k]); tri(A[k], B[k], A[k + 1], o); tri(B[k], B[k + 1], A[k + 1], o); } } };
    const flush = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(T.splice(0), 3)); g.computeVertexNormals(); return g; };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const jR = full.findIndex((r) => r[1] === 'R'), jG = full.findIndex((r) => r[1] === 'g2');   // +z side; the -z side mirrors
    for (const [jr, jg] of [[jR, jG], [M - 1 - jR, M - 1 - jG]]) {   // drip rail / dark window frame along the roof edge, A to C pillar
      const rows = []; xs.forEach((x, i) => { if (roofAt(x) <= beltAt(x) + 0.05) return; const P = (j) => V(pos[(i * M + j) * 3], pos[(i * M + j) * 3 + 1], pos[(i * M + j) * 3 + 2]), r = P(jr), g = P(jg), mid = r.clone().lerp(g, 0.14);
        mid.z += Math.sign(r.z) * 0.008; rows.push([r.clone().lerp(V(r.x, r.y + 0.02, r.z * 0.97), 0.5), mid, r.clone().lerp(g, 0.28)]); });
      strip(rows); }
    if (K.kidney) {   // E34 chrome window line: the drip rail above plus a sill moulding along the belt under the glass (uv 0 = the atlas chrome)
      const jE = full.findIndex((r) => r[1] === 'e'), jG1 = full.findIndex((r) => r[1] === 'g1');
      for (const [je, jg] of [[jE, jG1], [M - 1 - jE, M - 1 - jG1]]) {
        const rows = []; xs.forEach((x, i) => { if (roofAt(x) <= beltAt(x) + 0.05 || x > wsBase - 0.1 || x < rsTop + 0.02) return; const P = (j) => V(pos[(i * M + j) * 3], pos[(i * M + j) * 3 + 1], pos[(i * M + j) * 3 + 2]), e = P(je), gp = P(jg);
          rows.push([e.clone().lerp(gp, 0.12), V(e.x, e.y + 0.006, e.z + Math.sign(e.z) * 0.008), V(e.x, e.y - 0.014, e.z)]); });
        strip(rows); }
      parts.plate.push(flush());
    } else parts.trim.push(flush()); }
  const bw = 2 * halfW(xf - 0.08) * 0.96, bwr = 2 * halfW(xr + 0.08) * 0.96;
  if (!K.boxy) {   // bumpers: a full-width bar wrapping the nose / tail, body colour (black plastic on the SUV), lower intake in it
    const bm = K.clad || K.kidney ? parts.trim : parts.paintX, fy = K.clr + (K.kidney ? 0.28 : 0.33);   // E34: dark bumpers, set low under the nose band
    const bp = (n) => (PN && bm === parts.paintX ? bumpers[n] : bm);   // panels: the painted bumpers come off on their own
    box(bp('bumperF'), 0.12, 0.2, bw, xf - 0.02, fy, 0); box(bp('bumperR'), 0.12, 0.22, bwr, xr + 0.02, K.clr + 0.34, 0);
    box(parts.trim, 0.02, 0.08, K.w * 0.46, xf + 0.045, fy - 0.04, 0);
    if (K.kidney) for (const [x, y, w] of [[xf + 0.042, fy + 0.06, bw], [xr - 0.042, K.clr + 0.41, bwr]]) atlas(box(parts.plate, 0.012, 0.022, w * 0.98, x, y, 0), ATLAS.chrome);   // chrome rub strip
    if (K.clad) { box(parts.rim, 0.05, 0.07, K.w * 0.5, xf + 0.03, K.clr + 0.17, 0); box(parts.rim, 0.05, 0.07, K.w * 0.5, xr - 0.03, K.clr + 0.17, 0); }   // skid plates
  }
  if (K.kidney) {   // E34 face: black band across the nose under the hood's lip (body colour, overhanging the lamps), twin chrome kidneys, roundels
    const nw = 2 * halfW(xf) * 0.86;   // the nose cap is pulled in 12% at the very front
    box(parts.trim, 0.03, 0.2, nw, xf + 0.004, hlY, 0);
    box(parts.paintX, 0.1, 0.035, nw * 0.99, xf - 0.015, hlY + 0.118, 0, 0, 0, -0.12);
    for (const kz of [0.1, -0.1]) { atlas(box(parts.plate, 0.03, 0.21, 0.15, xf + 0.022, hlY - 0.005, kz), ATLAS.chrome); box(parts.trim, 0.03, 0.175, 0.118, xf + 0.03, hlY - 0.005, kz);
      for (const d of [-0.035, 0, 0.035]) atlas(box(parts.plate, 0.01, 0.17, 0.008, xf + 0.047, hlY - 0.005, kz + d), ATLAS.chrome); }
    const hx = xf - 0.16, slope = (beltAt(hx - 0.05) - beltAt(hx + 0.05)) / 0.1, disc = (r) => new THREE.CylinderGeometry(r, r, 0.006, 20);
    let g = disc(0.04); g.rotateZ(-Math.atan(slope)); g.translate(hx, beltAt(hx) + 0.035 + 0.004, 0); parts.plate.push(atlas(g, ATLAS.roundel));   // hood (on the crown)
    g = disc(0.038); g.rotateZ(Math.PI / 2); g.translate(xr - 0.006, tlY - 0.11, 0); parts.plate.push(atlas(g, ATLAS.roundel));   // trunk lid
  }
  else box(parts.trim, 0.05, 0.16, K.w * 0.5, xf - 0.02, hlY - 0.02, 0);   // grille
  if (K.kidney || K.sign) for (const sz of [1, -1]) box(parts.trim, Math.abs(K.wheels[0] - K.wheels[1]) - 2 * archR - 0.12, 0.045, 0.02, (K.wheels[0] + K.wheels[1]) / 2, K.clr + 0.33, sz * (halfW(0) + 0.006));   // side rub strips
  if (K.rack) { const rx = (wsTop + rsTop) / 2, rl = wsTop - rsTop + 0.3;
    for (const sz of [1, -1]) { box(parts.trim, rl, 0.035, 0.04, rx, K.roof + 0.085, sz * HW * 0.62); for (const fx of [rx - rl / 2 + 0.06, rx + rl / 2 - 0.06]) box(parts.trim, 0.07, 0.07, 0.05, fx, K.roof + 0.045, sz * HW * 0.62); }
    for (const cx of [rx - rl * 0.28, rx + rl * 0.22]) box(parts.rim, 0.04, 0.025, HW * 1.3, cx, K.roof + 0.11, 0); }   // roof rails + crossbars
  // lower intake, bumpers' dark lower lip, plates
  box(parts.trim, 0.06, 0.1, K.w * 0.78, xf - 0.04, K.clr + 0.16, 0);
  box(parts.trim, 0.06, 0.1, K.w * 0.8, xr + 0.04, K.clr + 0.16, 0);
  if (K.boxy) { box(parts.rim, 0.07, 0.09, K.w * 0.98, xf + 0.02, K.clr + 0.3, 0); box(parts.rim, 0.07, 0.09, K.w * 0.98, xr - 0.02, K.clr + 0.34, 0); box(parts.rim, 0.03, 0.14, K.w * 0.52, xf - 0.01, hlY - 0.01, 0); }   // chrome bumpers + grille
  else box(parts.lampR, 0.02, 0.022, K.w * 0.55, xr + 0.012, tlY + 0.045, 0);   // light bar across the tail
  if (K.sport) { box(parts.trim, 0.3, 0.03, K.w * 0.82, xr + 0.25, K.trunk + 0.09, 0); box(parts.trim, 0.04, 0.09, 0.05, xr + 0.3, K.trunk + 0.04, 0.55); box(parts.trim, 0.04, 0.09, 0.05, xr + 0.3, K.trunk + 0.04, -0.55); }   // spoiler
  atlas(box(parts.plate, 0.012, 0.11, 0.36, K.boxy ? xf + 0.005 : xf + 0.062, K.clr + 0.3, 0), ATLAS.plate);   // kit bumpers stand 4 cm proud of the nose
  atlas(box(parts.plate, 0.012, 0.11, 0.36, xr - 0.005, tlY - 0.2, 0), ATLAS.plate);
  if (K.sign) { box(parts.trim, 0.2, 0.05, 0.5, 0.1, K.roof + 0.03, 0); box(parts.lampW, 0.16, 0.16, 0.48, 0.1, K.roof + 0.13, 0); }
  const merge = (arr) => arr.length ? mergeGeometries(arr.map(g => g.index ? g.toNonIndexed() : g).map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }), false) : null;
  // paint: uv into the seam texture (the paintX extras get uv 0: its blank margin); glass: a zero uv so materials with maps do not break
  seamUV(K, paint); glass.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(glass.attributes.position.count * 2), 2));
  let panelGeos = null;
  if (PN) { panelGeos = {}; for (const [n, idx] of Object.entries(PN)) { if (!idx.length) continue; const g = mk(idx); if (n.startsWith('glass')) planarUV(g, n === 'glassW' || n === 'glassB'); else seamUV(K, g); panelGeos[n] = g; }
    for (const [n, arr] of Object.entries(bumpers)) if (arr.length) panelGeos[n] = merge(arr); }
  const paintAll = merge([paint, ...parts.paintX]); paintAll.userData.darkSkin = darkSkin;   // carInterior lines the cabin with both
  return {
    geos: { paint: paintAll, glass, rubber: merge(parts.rubber), rim: merge(parts.rim), trim: merge(parts.trim), lampW: merge(parts.lampW), lampR: merge(parts.lampR), plate: merge(parts.plate), caliper: merge(parts.caliper), shadow: (() => { const g = new THREE.PlaneGeometry(L * 1.08, K.w * 1.25); g.rotateX(-Math.PI / 2); g.translate(0, 0.012, 0); return g; })() },
    len: L, w: K.w + 0.2, h: K.roof,
    panels: panelGeos, hinges: { F: shutA, R: bx0 - 0.03, z: (x) => halfW(x) },   // door hinge lines (kit x) and the body's half width there
  };
}

// ---- wheels (GTA-style): a lathed radial tyre (rounded sidewalls, a flat tread band carrying the tread / lettering texture,
// tyreTex), a rim style per kind (KINDS.rimStyle: 'alloy5' five tapered spokes, 'multi' ten thin ones, 'steel' a dished steel
// wheel under a chrome hubcap), lug nuts, a dark brake disc behind the spokes; calipers are separate (they don't turn).
const TYRE_W = 0.115, RIM_K = 0.7, REF_R = 0.345;   // half tread width (m); rim radius / tyre radius (17-18" look); wheelInstances' base radius
const WGEO = new Map();
/** one wheel at the origin (axle along z, outer face toward +z) of tyre radius r, split per material slot { rubber, rim, trim }.
 *  Cached per (r, style): every user shares it (read-only). Rotate pi about y for the left side; spin it about z. */
export function wheelGeometry(r = REF_R, style = 'alloy5') {
  const key = r.toFixed(3) + style; if (WGEO.has(key)) return WGEO.get(key);
  const rr = r * RIM_K, seg = isLite() ? 16 : 24, W = TYRE_W;
  // profile from the inner bead round the tread to the outer bead: radius, axial (+ = outer face)
  const prof = [[rr - 0.004, -W + 0.012], [rr + 0.012, -W - 0.002], [r - 0.06, -W - 0.006], [r - 0.028, -W + 0.004], [r - 0.009, -W + 0.022], [r, -W + 0.045], [r + 0.002, 0], [r, W - 0.045], [r - 0.009, W - 0.022], [r - 0.028, W - 0.004], [r - 0.06, W + 0.006], [rr + 0.012, W + 0.002], [rr - 0.004, W - 0.012]];
  const tyre = new THREE.LatheGeometry(prof.map(([a, y]) => new THREE.Vector2(a, y)), seg); tyre.rotateX(Math.PI / 2);
  { const uv = tyre.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3); }   // the texture repeats 3x round the tyre
  const rim = [], trim = [], cyl = (rad, h, z, s = 16, open = false) => { const g = new THREE.CylinderGeometry(rad, rad, h, s, 1, open); g.rotateX(Math.PI / 2); g.translate(0, 0, z); return g; };
  trim.push(cyl(rr - 0.006, 0.19, 0.0, seg, true));                                      // barrel (inside the tyre)
  { const g = cyl(rr - 0.006, 0.19, 0.0, seg, true); g.scale(-1, 1, 1); const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); trim.push(g); }   // its inside (mirrored: wound the other way): seen looking into the wheel from above, the open barrel was a hole
  { const g = new THREE.TorusGeometry(rr - 0.004, 0.011, 6, seg); g.translate(0, 0, W - 0.01); rim.push(g); }   // polished outer lip
  trim.push(cyl(rr - 0.045, 0.024, 0.02, 24));                                            // brake disc: dark, behind the spokes
  trim.push(cyl(rr * 0.42, 0.04, 0.035, 16));                                             // disc hat
  trim.push(cyl(rr + 0.01, 0.01, W - 0.062, seg));                                       // dark wall right behind the spokes (reads as the disc in shadow): the open barrel is one-sided, without it you saw through the wheel
  if (style === 'steel') {   // dished steel wheel + chrome hubcap
    trim.push(cyl(rr - 0.01, 0.02, W - 0.045, seg)); rim.push(cyl(rr * 0.78, 0.016, W - 0.022, seg)); rim.push(cyl(rr * 0.3, 0.02, W - 0.006, 16));   // the steel face; hubcap; its centre boss
  } else {
    const n = style === 'multi' ? 10 : 5, w0 = style === 'multi' ? 0.024 : 0.055, w1 = style === 'multi' ? 0.018 : 0.034, len = rr - 0.055;
    for (let k = 0; k < n; k++) {   // tapered spoke from the hub to the lip, its outer end set back (a concave face)
      const sh = new THREE.Shape(); sh.moveTo(0, -w0 / 2); sh.lineTo(len, -w1 / 2); sh.lineTo(len, w1 / 2); sh.lineTo(0, w0 / 2); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: false });
      g.rotateY(0.12); g.translate(0.045, 0, W - 0.05); g.rotateZ(k / n * Math.PI * 2); rim.push(g);
    }
    rim.push(cyl(0.062, 0.03, W - 0.03, 20));                                             // hub boss
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + 0.6, g = cyl(0.009, 0.02, W - 0.01, 6); g.translate(Math.cos(a) * 0.042, Math.sin(a) * 0.042, 0); trim.push(g); }   // lug nuts
    trim.push(cyl(0.026, 0.012, W - 0.008, 12));                                          // centre cap
  }
  const m = (arr) => mergeGeometries(arr.map((g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }), false);
  const out = { rubber: m([tyre]), rim: m(rim), trim: m(trim) }; WGEO.set(key, out); return out;
}
/** a brake caliper in the wheel's frame, on the disc on the side `dir` (+1: toward -x, the trailing side of a front wheel) */
export function caliperGeometry(r = REF_R, dir = 1) { const g = new THREE.BoxGeometry(0.11, 0.15, 0.055); g.translate(-dir * r * RIM_K * 0.62, r * RIM_K * 0.25, 0.04); return g; }
/** instanced kit wheels for a crowd of cars (one draw per material slot, `count` wheels): set(i, carMatrix, wheel from
 *  wheelLayout, spin (radians rolled), steer (+ = right, fronts only), tyre radius), then commit() once a frame */
export function wheelInstances(parent, count, name = 'wheels', shadows = false, style = 'alloy5') {
  const wg = wheelGeometry(REF_R, style), CM = carMaterials(), UP = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const ims = ['rubber', 'rim', 'trim'].map((slot) => { const im = new THREE.InstancedMesh(wg[slot], CM[slot], count); im.name = `${name}:${slot}`; im.frustumCulled = false; im.castShadow = shadows && slot === 'rubber'; parent.add(im); return im; });
  return {
    set(i, base, w, spin, steer = 0, r = REF_R) { q.setFromAxisAngle(UP, (w.x > 0 ? -steer : 0) + (w.side < 0 ? Math.PI : 0)); q2.setFromAxisAngle(ZAX, w.side > 0 ? -spin : spin); q.multiply(q2);
      const k = r / REF_R; sc.set(k, k, 1); m.compose(v.set(w.x, w.y, w.z), q, sc).premultiply(base); for (const im of ims) im.setMatrixAt(i, m); },
    commit() { for (const im of ims) im.instanceMatrix.needsUpdate = true; },
  };
}
/** wheel centres of a kind in the kit frame: [{ x, y, z, side }] (side +1 = +z / right), the tyre radius and the rim style */
export function wheelLayout(kind = 'sedan') {
  const K = KINDS[kind] || KINDS.sedan, r = tyreR(K);
  const halfW = halfWOf(K);
  const out = []; for (const wx of K.wheels) for (const sz of [1, -1]) out.push({ x: wx, y: r, z: sz * (halfW(wx) - WHEEL_INSET), side: sz });
  return { r, wheels: out, style: K.rimStyle || 'alloy5' };
}
function shadowTex() {   // soft contact shadow under the car (ambient occlusion on the road)
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 32, 4, 64, 32, 62); gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.scale(1, 0.55); g.fillStyle = gr; g.fillRect(0, 0, 128, 117); g.restore(); const t = new THREE.CanvasTexture(c); return t;
}
function plateTex() {   // the plate atlas (ATLAS): New York 'Excelsior' plate (gold, navy lettering) on top; chrome, amber, the BMW roundel below
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  const ch = g.createLinearGradient(0, 128, 0, 256); for (const [o, col] of [[0, '#f4f6f8'], [0.3, '#9aa1a8'], [0.5, '#5d646b'], [0.62, '#d8dde2'], [1, '#7c838a']]) ch.addColorStop(o, col);
  g.fillStyle = ch; g.fillRect(0, 128, 128, 128);   // chrome: a bright sky / dark horizon / ground band, read as a reflection
  const am = g.createLinearGradient(0, 192, 0, 256); am.addColorStop(0, '#ffb43a'); am.addColorStop(1, '#d86a06'); g.fillStyle = am; g.fillRect(64, 192, 64, 64);
  { const cx = 192, cy = 192; g.fillStyle = '#c9ced3'; g.beginPath(); g.arc(cx, cy, 63, 0, Math.PI * 2); g.fill(); g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(cx, cy, 59, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8eaec'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [['B', -0.62], ['M', 0], ['W', 0.62]].forEach(([l, a]) => { g.save(); g.translate(cx + Math.sin(a) * 47, cy - Math.cos(a) * 47); g.rotate(a); g.fillText(l, 0, 0); g.restore(); });
    g.fillStyle = '#c9ced3'; g.beginPath(); g.arc(cx, cy, 37, 0, Math.PI * 2); g.fill();
    for (let q = 0; q < 4; q++) { g.fillStyle = q % 2 ? '#f4f6f8' : '#1c69d4'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 34, -Math.PI / 2 + q * Math.PI / 2, q * Math.PI / 2); g.fill(); } }
  g.textBaseline = 'alphabetic'; g.fillStyle = '#f1c83a'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#12264f'; g.fillRect(0, 0, 256, 26); g.fillRect(0, 110, 256, 18);
  g.fillStyle = '#f1c83a'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.fillText('NEW YORK', 128, 20); g.font = 'bold 13px Arial'; g.fillText('EXCELSIOR', 128, 124);
  g.fillStyle = '#12264f'; g.font = 'bold 54px Arial'; const L = 'ABCDEFGHJKLMNPRSTUVWXYZ'; let s = ''; for (let i = 0; i < 3; i++) s += L[(Math.random() * L.length) | 0]; s += '-'; for (let i = 0; i < 4; i++) s += (Math.random() * 10) | 0; g.fillText(s, 128, 88);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function seamTex() {   // the paint's panel detail (seamUV): white = bare paint; shut lines, handle recesses and the crease's shade darken it
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), X = (u) => u * W, Y = (v) => (1 - v) * H;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d4d4d4'; g.fillRect(X(0.04), Y(0.705), X(0.92), 2);   // shoulder crease: the shaded underside of the ridge
  g.strokeStyle = '#3c3c3c'; g.lineWidth = 1.5; g.beginPath();
  for (const [u, v0] of [[SEAM_U[1], 0.3], [SEAM_U[2], 0.14], [SEAM_U[3], 0.14]]) { g.moveTo(X(u), Y(v0)); g.lineTo(X(u), Y(SEAM_V[1])); }   // C (stops over the rear arch) / B / A shut lines
  g.moveTo(X(SEAM_U[1]), Y(0.14)); g.lineTo(X(SEAM_U[3]), Y(0.14)); g.stroke();   // door bottoms
  for (const u of [0.31, 0.56]) { g.fillStyle = '#4e4e4e'; g.fillRect(X(u) - 7, Y(0.77) - 3, 14, 5); g.fillStyle = '#a8a8a8'; g.fillRect(X(u) - 6, Y(0.77) + 2, 12, 1); }   // handle recesses (near each door's rear edge), lit lower lip
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// the tyre's texture (wheelGeometry's uv: u round the tyre, 3 repeats; v along the profile, inner bead 0 to outer bead 1): a
// directional tread with three grooves and sipes on the tread band, raised lettering on the outer sidewall. Colours are final (the
// material is white); the same canvas is the desktop bump.
const TYRE_V = { tread: [0.333, 0.667], letters: 0.83 }, TYRE_FLAT = 0x151515;   // TYRE_FLAT: the tyre colour where there is no texture (phones' dark slot)
function tyreTex() {
  const W = 512, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), Y = (v) => (1 - v) * H;
  g.fillStyle = '#1e1e1e'; g.fillRect(0, 0, W, H);
  const t0 = Y(TYRE_V.tread[1]), t1 = Y(TYRE_V.tread[0]); g.fillStyle = '#1a1a1a'; g.fillRect(0, t0, W, t1 - t0);
  g.strokeStyle = '#070707'; g.lineWidth = 3; for (const v of [0.43, 0.5, 0.57]) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke(); }
  g.lineWidth = 2; for (let x = 0; x < W; x += 9) { g.beginPath(); g.moveTo(x, t0 + 2); g.lineTo(x + 6, Y(0.45)); g.moveTo(x + 6, Y(0.55)); g.lineTo(x, t1 - 2); g.stroke(); }   // V sipes
  g.fillStyle = '#5c5c5c'; g.font = 'bold 13px Arial'; g.textBaseline = 'middle'; g.fillText('ZAVOD  SPORT  225/45 ZR17  94W', 16, Y(TYRE_V.letters)); g.fillText('RADIAL TUBELESS', 330, Y(TYRE_V.letters));
  g.strokeStyle = '#2c2c2c'; g.lineWidth = 1; for (const v of [0.76, 0.9]) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke(); }   // sidewall rings
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
/** Default materials for the kit (maps may substitute their own). Paint is white so instanceColor tints it. */
let MATS = null;
export function carMaterials() {
  if (MATS) return MATS;
  const seams = seamTex();
  MATS = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.45, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 0.9, map: seams, bumpMap: seams, bumpScale: SEAM_BUMP }),
    // tinted glass: a dark green-grey body (pure black read as a hole), a sharp mirror reflection dimmed and cooled by the tint (one specular layer: a clearcoat on top
    // of a high-ior base doubled the sky and washed the side windows out to white at a glance)
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1215, roughness: 0.015, metalness: 0.0, ior: 1.5, specularIntensity: 1, specularColor: 0xb4c2cc, envMapIntensity: 1.0 }),
    rubber: (() => { const t = tyreTex(), m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.9, ...(isLite() ? {} : { bumpMap: t, bumpScale: 1.2 }) }); m.userData.flat = TYRE_FLAT; return m; })(),
    rim: new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.35, metalness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.6, metalness: 0.2 }),
    lampW: new THREE.MeshStandardMaterial({ color: 0xd9e0e4, roughness: 0.1, metalness: 0.3, emissive: 0x3a4044 }),
    lampR: new THREE.MeshStandardMaterial({ color: 0x8a0e0e, roughness: 0.2, emissive: 0x300404 }),
    plate: new THREE.MeshStandardMaterial({ map: plateTex(), roughness: 0.45 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.4, metalness: 0.3 }),
    shadow: new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, opacity: 0.85 }),
  };
  MATS.lampW.emissive.setHex(0x8a9298); MATS.lampR.emissive.setHex(0x6a0808);
  MATS.glassSee = new THREE.MeshPhysicalMaterial({ color: 0x0f1a1d, roughness: 0.015, transparent: true, opacity: 0.72, depthWrite: false, ior: 1.5, specularIntensity: 1, specularColor: 0xb4c2cc, envMapIntensity: 1.2 });   // driven cars: see who's inside
  if (typeof window !== 'undefined' && window.__zavodLite) { for (const k of ['paint', 'glass', 'glassSee']) { const o = MATS[k]; const n = new THREE.MeshStandardMaterial({ color: o.color, roughness: o.roughness, metalness: o.metalness, transparent: o.transparent, opacity: o.opacity, depthWrite: o.depthWrite, map: o.map }); MATS[k] = n; } }   // phones: no clearcoat, no bump (the seams stay in the map)
  for (const k in MATS) MATS[k].name = 'car_' + k;
  return MATS;
}
export const CAR_COLORS = [0x1a1a1c, 0x9a9ea3, 0x5f656b, 0x22305c, 0x6a1c1c, 0xb4b2ab, 0x33383c, 0x16181a, 0x7b8086, 0x1a4433, 0x4a4036, 0x2d4a55, 0xd8d6cf, 0x0f1e3a].map(c => new THREE.Color(c));
// the sloyd sedan model is one merged, textured mesh (wheels and all): tinting it with the full CAR_COLORS hue range would
// discolour the tyres, rims and glass along with the paint. A small near-neutral multiply palette instead, white to near
// black, reads as red / maroon / silver / charcoal without shifting the baked texture's other materials off-hue.
export const SLOYD_SEDAN_COLORS = [0xffffff, 0xd9d6ce, 0xaba79d, 0x6e6a63, 0x37332f].map(c => new THREE.Color(c));

// phones: a parked row's tyres, dark trim and calipers become one vertex-coloured slot ('dark'), one draw call per kind per row
// instead of three (~30 fewer in a street view). All three are near-black or tiny, so the shared roughness doesn't show.
const DARK_SLOTS = ['rubber', 'trim', 'caliper'];
let DARK = null;
const darkMat = () => DARK || (DARK = new THREE.MeshStandardMaterial({ name: 'car_dark', vertexColors: true, roughness: 0.85, metalness: 0.15 }));
/** One read-only set of carGeometries(kind) per kind for every user that only instances it (parked cars, the Uber): a sedan's
 *  geometry is a few MB, building it again per user doubled that. Callers that transform geometry use carGeometries(). */
const _shared = new Map();
export function sharedCarGeometries(kind) { let k = _shared.get(kind); if (!k) _shared.set(kind, (k = carGeometries(kind))); return k; }
function parkedGeos(ctx, kind) {
  const G = { ...sharedCarGeometries(kind).geos }; if (!ctx?.lite) return G;
  const CM = carMaterials(), parts = [];
  for (const s of DARK_SLOTS) { const g0 = G[s]; delete G[s]; if (!g0) continue; const g = g0.index ? g0.toNonIndexed() : g0.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const c = CM[s].userData.flat != null ? new THREE.Color(CM[s].userData.flat) : CM[s].color, n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g); }
  if (parts.length) G.dark = mergeGeometries(parts);
  return G;
}

/** Instances parked cars: list of { x, y?, z, ry, kind, color? } → one InstancedMesh per kind × slot. No colliders (callers add them). */
export function placeCars(world, list, { raycast = true } = {}) {
  const { scene, ctx, R } = world; const CM = carMaterials();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const reg = world.parkedCars || (world.parkedCars = []);
  if (world.W && !world.W.parkedCars) world.W.parkedCars = reg;   // vehicles.js reads ctx.world.parkedCars (touch STEAL button)
  if (world.W && !world.W.carLampsGlow) { world.W.carLampsGlow = true; const g = world.W.nightGlow || (world.W.nightGlow = []); g.push({ m: CM.lampW, e0: CM.lampW.emissiveIntensity, f: 1.5 }, { m: CM.lampR, e0: CM.lampR.emissiveIntensity, f: 2.5 }); }   // kit lamps brighten after dark (coney horizon.js drives nightGlow)
  for (const c of list) { c.refs = []; if (c.color == null) c.color = null; reg.push(c); }
  for (const kind of CAR_KINDS) {
    const P = list.filter((c) => c.kind === kind); if (!P.length) continue;
    if (hasCarModel(kind) || kitModelPending(kind, ctx)) {   // a real model (or one on its way): the kit body far / until it loads, the model near
      const T = P.map((c) => m4.compose(p.set(c.x, c.y || 0, c.z), q.setFromAxisAngle(up, c.ry || 0), one).clone());
      const cols = P.map((c) => { const col = c.color != null ? new THREE.Color(c.color) : kind === 'coupe' ? new THREE.Color([0xb3120f, 0xe8b400, 0xf2f2f0, 0x111214, 0x1f4fb8, 0xb3120f][(Math.random() * 6) | 0]) : kind === 'cab' ? new THREE.Color(0xf2b820) : kind === 'sedan' ? SLOYD_SEDAN_COLORS[((R ? R() : Math.random()) * SLOYD_SEDAN_COLORS.length) | 0] : CAR_COLORS[((R ? R() : Math.random()) * CAR_COLORS.length) | 0]; c.color = col.getHex(); return col; });
      const G = parkedGeos(ctx, kind), lo = [];
      for (const slot of Object.keys(G)) { if (!G[slot]) continue;
        const im = new THREE.InstancedMesh(G[slot], slot === 'dark' ? darkMat() : CM[slot], P.length); im.name = `cars:${kind}:lo:${slot}`;
        P.forEach((c, i) => { im.setMatrixAt(i, T[i]); if (slot === 'paint') im.setColorAt(i, cols[i]); });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = slot === 'paint'; im.receiveShadow = true; im.userData.surface = 'metal'; scene.add(im); lo.push(im);
        if (raycast && (slot === 'paint' || slot === 'glass')) ctx.raycastTargets.push(im); }
      P.forEach((c, i) => { for (const im of lo) c.refs.push({ im, i }); });
      const L = { P, T, cols, hi: [], lo, cur: '', hiShown: false };
      // LOD: only the nearest few get the model (the Ferrari is ~450k triangles); the rest wear the kit's light body
      const up2 = (k) => { if (k !== kind || L.hi.length) return; const ims = instanceCarModel(kind, T, cols, scene, lodMax(ctx)) || [];
        L.hi = ims.map((im) => ({ im, per: im.userData.per || 1, W: im.userData.W || null, local: im.userData.local }));
        for (const h of L.hi) h.im.count = Math.min(1, P.length) * h.per;   // one car until the first LOD pass: the boot pre-warm still compiles its shaders
        L.cur = ''; };
      if (hasCarModel(kind)) up2(kind); else onCarModel(up2);
      carLod(world, L);
      continue;
    }
    const G = parkedGeos(ctx, kind);
    for (const slot of Object.keys(G)) {
      if (!G[slot]) continue;
      const im = new THREE.InstancedMesh(G[slot], slot === 'dark' ? darkMat() : CM[slot], P.length); im.name = `cars:${kind}:${slot}`;
      P.forEach((c, i) => { q.setFromAxisAngle(up, c.ry || 0); p.set(c.x, c.y || 0, c.z); im.setMatrixAt(i, m4.compose(p, q, one)); c.refs.push({ im, i }); if (slot === 'paint') { const col = c.color != null ? new THREE.Color(c.color) : (kind === 'cab' ? new THREE.Color(0xf2b820) : kind === 'sedan' ? SLOYD_SEDAN_COLORS[((R ? R() : Math.random()) * SLOYD_SEDAN_COLORS.length) | 0] : CAR_COLORS[((R ? R() : Math.random()) * CAR_COLORS.length) | 0]); c.color = col.getHex(); im.setColorAt(i, col); } });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = slot === 'paint'; im.receiveShadow = true; im.userData.surface = 'metal'; scene.add(im);
      if (raycast && (slot === 'paint' || slot === 'glass')) ctx.raycastTargets.push(im);
    }
  }
}

// parked real-model cars: every ~0.3 s the nearest few (in range) get the full model, packed into the first instances (count =
// how many, hidden when none: a zero-count part still costs a draw call), and their light kit body is hidden; stolen ones (gone) get neither
const LOD_ZERO = new THREE.Matrix4().makeScale(0, 0, 0), _lm = new THREE.Matrix4();
const lodMax = (ctx) => (ctx?.lite ? 5 : 12);   // parked cars that wear the full model at once
function carLod(world, L) {
  const lists = world.carLods || (world.carLods = []); lists.push(L);
  if (lists.length > 1) return;
  const ctx = world.ctx, R2 = (ctx.lite ? 30 : 45) ** 2, MAX = lodMax(ctx); let t = 0;
  world.updaters.push((dt) => {
    t -= dt; if (t > 0) return; t = 0.3; const cam = ctx.camera?.position; if (!cam) return;
    for (const L of world.carLods) {
      const near = []; L.P.forEach((c, i) => { if (c.gone) return; const d = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2; if (d < R2) near.push([d, i]); });
      near.sort((a, b) => a[0] - b[0]); const pick = near.slice(0, MAX).map((n) => n[1]), key = pick.join(',') + '|' + L.P.filter((c) => c.gone).length;
      if (key === L.cur) continue; L.cur = key; const set = new Set(L.hi.length ? pick : []);   // no model yet: every car keeps its kit body
      // the hi-tier (model) body is a shared InstancedMesh, not one mesh per car: it only needs to be in ctx.raycastTargets
      // while it's actually showing a car (count > 0), else bullets at a near sedan's old spot would never reach it
      const hiShown = L.hi.length > 0 && pick.length > 0;
      if (hiShown && !L.hiShown) for (const h of L.hi) ctx.raycastTargets.push(h.im);
      else if (!hiShown && L.hiShown) for (const h of L.hi) { const k = ctx.raycastTargets.indexOf(h.im); if (k > -1) ctx.raycastTargets.splice(k, 1); }
      L.hiShown = hiShown;
      for (const h of L.hi) { const n = h.per; pick.forEach((i, j) => { if (h.W) for (let k = 0; k < n; k++) h.im.setMatrixAt(j * n + k, _lm.multiplyMatrices(L.T[i], h.W[k])); else h.im.setMatrixAt(j, h.local ? _lm.multiplyMatrices(L.T[i], h.local) : L.T[i]); if (h.im.instanceColor) h.im.setColorAt(j, L.cols[i]); }); h.im.count = pick.length * n; h.im.visible = pick.length > 0; h.im.instanceMatrix.needsUpdate = true; if (h.im.instanceColor) h.im.instanceColor.needsUpdate = true; }
      for (const im of L.lo) { L.P.forEach((c, i) => im.setMatrixAt(i, c.gone || set.has(i) ? LOD_ZERO : L.T[i])); im.instanceMatrix.needsUpdate = true; im.boundingSphere = null; }
    }
  });
}

/**
 * Colliders for a parked car that match its body (a 3.2 m square let you walk into the nose and bumped you off thin air at
 * the doors): one exact box when it sits square to the grid, else a row of small AABB cells along its length (colliders are
 * axis-aligned; rotated things are built from cells). Sets c.boxes; c.box stays the first for older callers.
 */
export function parkedCarBoxes(world, c) {
  const K = KINDS[c.kind] || KINDS.sedan, L = K.len / 2, W = K.w / 2, y = c.y || 0, H = y + K.roof;
  const fx = Math.cos(c.ry || 0), fz = -Math.sin(c.ry || 0), ax = Math.abs(fx), az = Math.abs(fz);
  if (Math.min(ax, az) < 0.06) { const hx = ax > az ? L : W, hz = ax > az ? W : L; c.boxes = [world.box([c.x - hx, y, c.z - hz], [c.x + hx, H, c.z + hz])]; }
  else {
    const r = W * 0.9, n = Math.max(2, Math.ceil((L - r) / (r * 0.6)) + 1), e = r * (ax + az) * 0.85;   // 0.85: the cell corners stick out past the paint
    c.boxes = []; for (let k = 0; k < n; k++) { const t = -(L - r) + 2 * (L - r) * k / (n - 1), cx = c.x + fx * t, cz = c.z + fz * t; c.boxes.push(world.box([cx - e, y, cz - e], [cx + e, H, cz + e])); }
  }
  c.box = c.boxes[0]; return c.boxes;
}
/** A parked car's colliders (parkedCarBoxes, or the single box older maps set). */
export const carBoxes = (c) => c.boxes || (c.box ? [c.box] : []);
/** Take a parked car's colliders out of the world (stolen / cleared for a scene). */
export function dropParkedCarBoxes(ctx, c) { for (const b of carBoxes(c)) { const k = ctx.colliders.indexOf(b); if (k > -1) ctx.colliders.splice(k, 1); } }

/** Remove one parked car from its instanced meshes (hangout: stolen). */
export function hideParkedCar(c) { const z = new THREE.Matrix4().makeScale(0, 0, 0); for (const { im, i } of c.refs || []) { im.setMatrixAt(i, z); im.instanceMatrix.needsUpdate = true; } c.gone = true; }

/**
 * Driver's-eye point for a kind, in the kit frame (+x front, y up, z right-hand = passenger side): the eye sits ~0.42 m behind
 * the top edge of the windshield, ~0.28 m under the roof, on the left (US driver) seat. vehicles.js places its camera here.
 */
export function carEye(kind = 'sedan') {
  const K = KINDS[kind] || KINDS.sedan;
  if (K.eye) return { ...K.eye };   // real models: the driver's seat of that model
  return { x: K.ws[1] - 0.46, y: K.roof - 0.25, z: -K.w / 2 * 0.4 };
}

/**
 * Cabin for a drivable car (kit frame, same as carGeometries): the inside of the body shell (paint geometry rendered BackSide
 * in a dark trim colour → roof liner, pillars, door cards), a faint tint on the inside of the glass, dashboard with an
 * instrument binnacle (lit gauges), steering wheel on a column (returns `wheel`: rotate wheel.rotation.x to steer), seats,
 * centre console and a rear-view mirror. Opaque exterior glass hides all of it from outside. No colliders / raycast.
 * Returns { group, wheel, seatMat } (seatMat: the seats' shared material, for callers that add or move seats).
 */
export function carInterior(kind = 'sedan', geos = null) {
  const K = KINDS[kind] || KINDS.sedan; const G = geos || carGeometries(kind).geos; const HW = K.w / 2;
  const I = interiorMats();
  const g = new THREE.Group(); g.name = 'carInterior';
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = false; m.receiveShadow = true; parent.add(m); return m; };
  add(G.paint, I.shell); if (G.paint.userData.darkSkin) add(G.paint.userData.darkSkin, I.shell); add(G.glass, I.glassIn);
  const eye = carEye(kind), [wsBase, wsTop] = K.ws;
  // dashboard: from under the windshield base back to ~0.5 m ahead of the eye, top just above the belt line
  const dx0 = eye.x + 0.52, dx1 = wsBase + 0.05, dTop = K.belt - 0.03;   // top below the belt so the hood shows over it
  add(new THREE.BoxGeometry(dx1 - dx0, 0.36, K.w * 0.9), I.dash, (dx0 + dx1) / 2, dTop - 0.18, 0);
  add(new THREE.BoxGeometry(0.2, 0.05, K.w * 0.88), I.dash, dx0 + 0.02, dTop - 0.21, 0, 0, 0, 0.5);          // lower lip, rounded read
  // binnacle hood + gauges in front of the driver: speedo and tach dials (gaugeTex) with live needles (returned: vehicles.js turns them)
  add(new THREE.BoxGeometry(0.2, 0.16, 0.36), I.dash, dx0 + 0.04, dTop + 0.04, eye.z);   // tall enough that the dials show through the top of the wheel
  const GW = 0.3, GH = 0.1125, gx = dx0 - 0.064, gy = dTop + 0.03;
  add(new THREE.PlaneGeometry(GW, GH), I.gauge, gx, gy, eye.z, 0, -Math.PI / 2, 0);
  const needles = {}; for (const [n, u] of [['speed', GAUGE_U[0]], ['rpm', GAUGE_U[1]]]) { const ng = new THREE.BoxGeometry(0.003, GH * 0.36, 0.004); ng.translate(0, GH * 0.16, 0);
    const piv = new THREE.Group(); piv.position.set(gx - 0.004, gy - GH * 0.03, eye.z + (u - 0.5) * GW); g.add(piv); add(ng, I.needle, 0, 0, 0, 0, 0, 0, piv); piv.rotation.x = NEEDLE_REST; needles[n] = piv; }
  // centre stack + console
  add(new THREE.BoxGeometry(0.16, 0.3, 0.3), I.trim, dx0 - 0.05, dTop - 0.25, 0);
  add(new THREE.PlaneGeometry(0.18, 0.1), I.screen, dx0 - 0.135, dTop - 0.12, 0, 0, -Math.PI / 2, 0);
  add(new THREE.BoxGeometry(0.9, 0.22, 0.24), I.trim, eye.x - 0.1, K.clr + 0.35, 0);
  // front seats: a contoured cushion with side bolsters, a bolstered back and a headrest on posts (three meshes a seat: uber.js
  // slides the passenger's by geometry.parameters.height, kept on the merged geometries)
  const S = seatGeos(isLite());
  for (const sz of [eye.z, -eye.z]) {
    add(S.base, I.seat, eye.x - 0.02, K.clr + 0.25, sz);
    add(S.back, I.seat, eye.x - 0.36, K.clr + 0.72, sz, 0, 0, 0.2);
    add(S.rest, I.seat, eye.x - 0.44, K.clr + 1.14, sz, 0, 0, 0.2);
  }
  // steering wheel on a raked column
  const col = new THREE.Group(); col.position.set(eye.x + 0.43, eye.y - 0.27, eye.z); col.rotation.z = -0.42; g.add(col);   // tilt: top leans toward the driver; high enough that the top of the rim shows looking ahead
  const wheel = new THREE.Group(); col.add(wheel);
  const rim = new THREE.TorusGeometry(0.18, 0.02, 8, 28); rim.rotateY(Math.PI / 2); add(rim, I.wheel, 0, 0, 0, 0, 0, 0, wheel);
  for (const a of [0, Math.PI * 0.62, -Math.PI * 0.62]) { const sp = new THREE.BoxGeometry(0.02, 0.17, 0.03); sp.translate(0, -0.085, 0); add(sp, I.wheel, 0, 0, 0, a, 0, 0, wheel); }
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), I.wheel, 0.01, 0, 0, 0, 0, Math.PI / 2, wheel);
  add(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 8), I.trim, 0.18, 0, 0, 0, 0, Math.PI / 2, col);
  // rear bench: two contoured places with headrests
  { const rx = eye.x - 1.05; if (rx - 0.3 > K.rs[1]) { add(new THREE.BoxGeometry(0.5, 0.14, K.w * 0.78), I.seat, rx, K.clr + 0.3, 0); add(new THREE.BoxGeometry(0.12, 0.62, K.w * 0.78), I.seat, rx - 0.3, K.clr + 0.66, 0, 0, 0, 0.22);
    for (const z of [0.4, -0.4]) add(S.rest, I.seat, rx - 0.38, K.clr + 1.02, z, 0, 0, 0.22); } }
  // door cards, one per door (returned: a driven car's front cards swing with their doors): the card, an armrest with a pull, a map pocket, a chrome handle
  const hx = { F: [K.b[0] + 0.03, K.ws[0] - 0.1], R: [K.rs[1] + 0.37, K.b[0] - 0.03] }, doorCards = {};
  for (const sz of [1, -1]) { const zc = sz * (HW - 0.09), sd = sz > 0 ? 'R' : 'L';
    for (const d of K.sport || K.panel ? ['F'] : ['F', 'R']) { const [x0, x1] = d === 'F' && K.sport ? [K.rs[1] + 0.37, hx.F[1]] : hx[d], L = x1 - x0, xm = (x0 + x1) / 2; if (L < 0.3) continue;
      const card = new THREE.Group(); card.name = 'doorCard' + d + sd; g.add(card);
      add(doorCardGeo(L, sz), I.door, xm, K.clr + 0.55, zc, 0, 0, 0, card);
      add(new THREE.BoxGeometry(0.06, 0.025, 0.02), I.chrome, x1 - 0.18, K.clr + 0.78, zc - sz * 0.03, 0, 0, 0, card);   // the inside handle
      doorCards[d + sd] = card; }
    add(new THREE.BoxGeometry(0.16, 0.02, 0.36), I.visor, wsTop - 0.14, K.roof - 0.035, sz * 0.42); }   // visors folded up flat to the roof
  add(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 8), I.trim, eye.x + 0.15, K.clr + 0.55, 0);
  add(new THREE.SphereGeometry(0.035, 10, 8), I.chrome, eye.x + 0.15, K.clr + 0.65, 0);
  for (const dz of [-0.06, 0.06]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), I.dash, eye.x - 0.1, K.clr + 0.47, dz);
  // rear-view mirror
  add(new THREE.BoxGeometry(0.03, 0.07, 0.24), I.trim, wsTop - 0.04, K.roof - 0.12, 0);
  add(new THREE.BoxGeometry(0.004, 0.055, 0.22), I.mirror, wsTop - 0.058, K.roof - 0.12, 0);
  // panels (a driven car's split body): their inside faces too, each returned so it moves with its panel
  const panelShells = {}; for (const [n, pg] of Object.entries(G.panels || {})) if (!n.startsWith('glass') && !n.startsWith('bumper')) panelShells[n] = add(pg, I.shell);
  return { group: g, wheel, seatMat: I.seat, needles, doorCards, panelShells };
}
let IMATS = null;
// the cluster: two dials (speedo, tach) at GAUGE_U across the face, fuel / temp bars between; the needles are meshes (carInterior),
// swept from NEEDLE_REST (0) clockwise through NEEDLE_SWEEP at full scale
const GAUGE_U = [0.27, 0.73], NEEDLE_REST = 2.3, NEEDLE_SWEEP = 4.6, PAX_BACK_H = 0.7, PAX_REST_H = 0.18;
export const gaugeNeedle = (k) => NEEDLE_REST - NEEDLE_SWEEP * Math.min(1, Math.max(0, k));
function gaugeTex() {
  const W = 256, H = 96, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#040405'; g.fillRect(0, 0, W, H);
  const R = 40, cy = H / 2 + 2;
  GAUGE_U.forEach((u, k) => { const cx = u * W;
    g.strokeStyle = '#9aa0a6'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, R + 3, 0, Math.PI * 2); g.stroke();   // chrome ring
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5, n = k ? 8 : 16;
    for (let i = 0; i <= n; i++) { const a = a0 + i / n * span, big = i % 2 === 0, red = k && i >= 6; g.strokeStyle = red ? '#ff3b2a' : '#e8e2d4'; g.lineWidth = big ? 2 : 1;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - (big ? 8 : 5)), cy + Math.sin(a) * (R - (big ? 8 : 5))); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
      if (big) { g.fillStyle = '#e8e2d4'; g.font = '8px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(k ? i : i * 10), cx + Math.cos(a) * (R - 15), cy + Math.sin(a) * (R - 15)); } }
    g.fillStyle = '#ff7a1a'; g.font = 'bold 7px Arial'; g.fillText(k ? 'x1000 RPM' : 'MPH', cx, cy + 20); });
  g.fillStyle = '#e8e2d4'; for (const [y, f] of [[30, 0.7], [62, 0.45]]) { g.fillRect(W / 2 - 14, y, 28, 1); g.fillStyle = '#ff7a1a'; g.fillRect(W / 2 - 14, y - 5, 28 * f, 4); g.fillStyle = '#e8e2d4'; }   // fuel / temp
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** shaped front seat (one geometry per part, cached): base = cushion + side bolsters, back = squab + wings, rest = headrest + posts */
let SEATG = null;
function seatGeos(lite) {
  if (SEATG) return SEATG;
  const rb = (w, h, d, x, y, z, rx = 0) => { const g = lite ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.35); if (rx) g.rotateX(rx); g.translate(x, y, z); return g.index ? g.toNonIndexed() : g; };
  const m = (arr) => { const g = mergeGeometries(arr.map((q) => { for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); return q; }), false); return g; };
  const base = m([rb(0.5, 0.12, 0.42, 0, 0.06, 0), rb(0.46, 0.09, 0.07, 0, 0.12, 0.215, -0.35), rb(0.46, 0.09, 0.07, 0, 0.12, -0.215, 0.35), rb(0.14, 0.1, 0.4, 0.21, 0.09, 0)]);
  const back = m([rb(0.11, PAX_BACK_H * 0.92, 0.4, 0, 0, 0), rb(0.13, PAX_BACK_H * 0.75, 0.07, 0.03, -0.03, 0.215, 0.3), rb(0.13, PAX_BACK_H * 0.75, 0.07, 0.03, -0.03, -0.215, -0.3)]); back.parameters = { height: PAX_BACK_H };
  const rest = m([rb(0.1, PAX_REST_H, 0.26, 0, 0.02, 0), rb(0.012, 0.08, 0.012, 0.01, -0.1, 0.07), rb(0.012, 0.08, 0.012, 0.01, -0.1, -0.07)]); rest.parameters = { height: PAX_REST_H };
  return (SEATG = { base, back, rest });
}
/** a door card L long (kit x) on side sz: the card, a bulging armrest along it, a map pocket low at the front */
function doorCardGeo(L, sz) {
  const p = [], b = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); p.push(g.toNonIndexed()); };
  b(L, 0.55, 0.05, 0, 0, 0); b(L * 0.6, 0.05, 0.11, -L * 0.1, 0.1, -sz * 0.05); b(L * 0.5, 0.12, 0.04, L * 0.15, -0.18, -sz * 0.04); b(L * 0.98, 0.03, 0.07, 0, 0.27, -sz * 0.02);
  for (const g of p) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return mergeGeometries(p, false);
}
function interiorMats() {
  if (IMATS) return IMATS;
  IMATS = {
    shell: new THREE.MeshStandardMaterial({ color: 0x5b5853, roughness: 0.9, side: THREE.BackSide }),
    glassIn: new THREE.MeshPhysicalMaterial({ color: 0x8fa3ad, roughness: 0.05, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.BackSide, envMapIntensity: 0.6 }),
    dash: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.55, metalness: 0.2 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x3b3029, roughness: 0.8 }),   // worn brown leather
    wheel: new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.5 }),
    gauge: (() => { const t = gaugeTex(); return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, roughness: 0.4 }); })(),
    door: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.85 }), visor: new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.95 }), chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.15, metalness: 1 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x2a5f9a, emissiveIntensity: 0.25, roughness: 0.3 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xaab4bc, roughness: 0.05, metalness: 1 }),
    needle: new THREE.MeshBasicMaterial({ color: 0xff6a12 }),
  };
  return IMATS;
}

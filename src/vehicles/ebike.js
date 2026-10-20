// Procedural e-bike meshes: a delivery e-bike (insulated food box on a rear rack, fat tyres, phone mount) and a Citi Bike-style
// step-through e-bike (blue frame, fat battery down tube, front carrier). Shared helpers for the other two-wheelers live here too
// (scooter.js): lathed tyres wearing the car kit's tread texture (carkit.js, PR #183), a spoked wheel disc (one alpha-tested canvas
// texture: rim, 32 laced spokes, hub), and a seated rider posed by two-bone IK onto the saddle, grips and pedals.
// Cheap and shared: geometry/materials cached once per variant, cloned per instance only by transform (same convention as
// bike.js). Local space: forward = -Z, up = +Y, right = +X, wheels on y=0. Owned by: VEHICLES agent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { carMaterials } from '../world/carkit.js';

export const WHEEL_R = 0.3;
export const WHEELBASE = 1.15;
export const FRONT_Z = -0.58, REAR_Z = 0.58;
const BB = [0.05, 0.27];   // bottom bracket (z, y)
const CRANK = 0.165;

let MATS = null;
function ebikeMaterials() {
  if (MATS) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    citi: std({ color: 0x1665b4, roughness: 0.32, metalness: 0.35 }),       // Citi Bike blue
    delivery: std({ color: 0x1c1d1f, roughness: 0.55, metalness: 0.3 }),
    dark: std({ color: 0x18191b, roughness: 0.72, metalness: 0.12 }),        // saddle, grips, battery case, pedals, carrier, chain guard
    chrome: std({ color: 0xcfd4d8, roughness: 0.25, metalness: 0.9 }),
    box: std({ color: 0xc8372d, roughness: 0.62, metalness: 0.05 }),         // insulated food box
    lens: std({ color: 0xfff4dc, emissive: 0xfff0c8, emissiveIntensity: 0.12, roughness: 0.3 }),
  };
  for (const k in MATS) MATS[k].name = 'ebike_' + k;
  return MATS;
}

// ---- shared geometry helpers (scooter.js imports these) ----------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
export function put(list, geo, x, y, z, rot = null, sx = 1, sy = 1, sz = 1) {
  const g = geo.clone(); _q.setFromEuler(rot || new THREE.Euler()); _p.set(x, y, z); _s.set(sx, sy, sz);
  g.applyMatrix4(_m.compose(_p, _q, _s)); list.push(g); return g;
}
export function tube(list, ax, ay, az, bx, by, bz, r, seg = 8, r1 = r) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a), l = d.length();
  const g = new THREE.CylinderGeometry(r1, r, l, seg, 1);
  _q.setFromUnitVectors(UP, d.normalize()); _p.copy(a).add(b).multiplyScalar(0.5); _s.set(1, 1, 1);
  g.applyMatrix4(_m.compose(_p, _q, _s)); list.push(g); return g;
}
/** a smooth bent tube through points [[x, y, z], ...] (Catmull-Rom) */
export function bent(list, pts, r, seg = 8, n = 16) {
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n, r, seg, false); list.push(g); return g;
}
function norm(g) { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }
export function merged(list) { const g = mergeGeometries(list.map(norm), false); for (const x of list) x.dispose(); return g; }

/** a lathed bicycle / scooter tyre round the x axle: outer radius r, section height t, half width hw. Its UVs follow carkit's
 *  wheelGeometry (u round the tyre, v across the profile with the tread band in the middle), so it wears the shared tyre
 *  material (carMaterials().rubber: tread grooves, sipes, sidewall rings). */
export function tyreGeometry(r, t, hw, seg = 28, reps = 1) {
  const prof = [[r - t, -hw * 0.55], [r - t * 0.7, -hw], [r - t * 0.3, -hw * 0.98], [r - t * 0.08, -hw * 0.7], [r, -hw * 0.25], [r + 0.002, 0], [r, hw * 0.25], [r - t * 0.08, hw * 0.7], [r - t * 0.3, hw * 0.98], [r - t * 0.7, hw], [r - t, hw * 0.55]];
  const g = new THREE.LatheGeometry(prof.map(([a, y]) => new THREE.Vector2(a, y)), seg); g.rotateZ(Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * reps);
  return g;
}
export function tyreMaterial() { return carMaterials().rubber; }

// spoked wheel: one alpha-tested canvas (rim band, 32 tangent-laced spokes, hub flange, axle nut); the centre texel is solid
// silver, so the rim barrel and hub geometry sample it too (one mesh, one draw per wheel)
let SPOKE_MAT = null;
function spokeMaterial(lite) {
  if (SPOKE_MAT) return SPOKE_MAT;
  const S = lite ? 128 : 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), C = S / 2, R = S / 2 - 1;
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#c9ced3'; g.lineWidth = R * 0.12; g.beginPath(); g.arc(C, C, R * 0.93, 0, 7); g.stroke();   // rim band
  g.strokeStyle = '#7d8388'; g.lineWidth = Math.max(1, R * 0.02); g.beginPath(); g.arc(C, C, R * 0.865, 0, 7); g.stroke();   // its inner edge
  g.strokeStyle = '#b8bec4'; g.lineWidth = Math.max(1.1, S / 190);
  for (let k = 0; k < 32; k++) {   // tangent lacing: each spoke leaves the flange off-radial and crosses its neighbours
    const a = k / 32 * Math.PI * 2, h = R * 0.13, s = (k % 2 ? 1 : -1) * 0.55, b = a + s * 0.9;
    g.beginPath(); g.moveTo(C + Math.cos(a + s) * h, C + Math.sin(a + s) * h); g.lineTo(C + Math.cos(b) * R * 0.87, C + Math.sin(b) * R * 0.87); g.stroke();
  }
  g.fillStyle = '#c9ced3'; g.beginPath(); g.arc(C, C, R * 0.15, 0, 7); g.fill();   // hub flange
  g.fillStyle = '#9da3a8'; g.beginPath(); g.arc(C, C, R * 0.07, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  SPOKE_MAT = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.3, metalness: 0.75, name: 'ebike_spokes' });
  return SPOKE_MAT;
}
/** a spoked wheel (rim band + spoke disc + hub barrel) round the x axle, rim radius rr, rim width w */
function spokeGeometry(rr, w, seg) {
  const parts = [];
  const disc = new THREE.CircleGeometry(rr, seg); disc.rotateY(Math.PI / 2); parts.push(disc);
  const solid = (g) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5); parts.push(g); };
  { const g = new THREE.CylinderGeometry(rr, rr, w, seg, 1, true); g.rotateZ(Math.PI / 2); solid(g); }
  { const g = new THREE.CylinderGeometry(0.022, 0.022, 0.11, 10); g.rotateZ(Math.PI / 2); solid(g); }
  return merged(parts);
}

// ---- the seated rider (shared with the moped) ---------------------------------------------------------------------------
const V3 = (a) => new THREE.Vector3(...a);
/** knee / elbow of a two-bone limb from a to c (bone lengths l1, l2), bending toward `pole` */
export function joint(a, c, l1, l2, pole) {
  const A = V3(a), Cc = V3(c), dir = Cc.clone().sub(A); let d = dir.length(); dir.divideScalar(d); d = Math.min(d, l1 + l2 - 0.005);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = V3(pole); p.addScaledVector(dir, -p.dot(dir)).normalize();
  return A.addScaledVector(dir, x).addScaledVector(p, h).toArray();
}
const RIDERS = new Map();
/**
 * A rider seated on a two-wheeler, posed onto its contact points: o = { hip: [y, z] (hip joint), lean (rad forward), grip: [x, y, z]
 * (right grip; mirrored), footR / footL: [x, y, z] (ankles), colors: { top, legs, shoes, skin, hair }, helmet }. Merged per material,
 * cached per `key`; returns a fresh Group sharing the geometry.
 */
export function seatedRider(key, o) {
  let R = RIDERS.get(key);
  if (!R) {
    const J = [], D = [], K = [], H = [], X = [];
    const limb = (list, a, b, r0, r1 = r0) => { tube(list, ...a, ...b, r0, 9, r1); const j = new THREE.SphereGeometry(r1 * 1.04, 9, 6); j.translate(...b); list.push(j); };
    const [hy, hz] = o.hip, lean = o.lean || 0.3, TL = 0.5, sh = [0, hy + Math.cos(lean) * TL, hz - Math.sin(lean) * TL];
    put(D, new THREE.SphereGeometry(0.5, 12, 8), 0, hy + 0.01, hz + 0.02, new THREE.Euler(-lean * 0.5, 0, 0), 0.34, 0.22, 0.3);   // seat / pelvis
    put(J, new THREE.SphereGeometry(0.5, 14, 10), 0, (hy + sh[1]) / 2 + 0.04, (hz + sh[2]) / 2, new THREE.Euler(-lean, 0, 0), 0.38, 0.66, 0.25);   // torso
    const neck = [0, sh[1] + 0.09, sh[2] - 0.03]; limb(J, [0, sh[1] - 0.02, sh[2]], neck, 0.06);
    put(H, new THREE.SphereGeometry(0.115, 14, 10), neck[0], neck[1] + 0.12, neck[2] - 0.02, null, 0.92, 1.05, 1.0);   // head
    if (o.helmet) put(X, new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, neck[1] + 0.14, neck[2] - 0.01, new THREE.Euler(0.15, 0, 0), 1, 1.0, 1.15);
    else put(X, new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), 0, neck[1] + 0.13, neck[2], new THREE.Euler(0.35, 0, 0), 0.95, 1, 1.05);   // hair
    for (const s of [-1, 1]) {
      const S = [s * 0.19, sh[1] - 0.04, sh[2]], G = [s * o.grip[0], o.grip[1], o.grip[2]];
      const E = joint(S, G, 0.31, 0.29, [s * 0.8, -0.4, 0.5]); limb(J, S, E, 0.055, 0.047); limb(J, E, G, 0.046, 0.04);
      put(H, new THREE.SphereGeometry(0.045, 8, 6), G[0], G[1] + 0.01, G[2]);   // hand on the grip
      const foot = s > 0 ? o.footR : o.footL, P = [s * 0.1, hy, hz], F = [foot[0], foot[1], foot[2]];
      const Kn = joint(P, F, 0.45, 0.44, [s * 0.15, 0.5, -1]); limb(D, P, Kn, 0.08, 0.062); limb(D, Kn, F, 0.058, 0.046);
      put(K, new THREE.BoxGeometry(0.095, 0.075, 0.25), F[0], F[1] - 0.05, F[2] - 0.05);   // shoe on the pedal / floorboard
    }
    const c = o.colors, M = (hex, r = 0.85) => new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: 0.02 });
    R = [[merged(J), M(c.top)], [merged(D), M(c.legs, 0.9)], [merged(K), M(c.shoes, 0.6)], [merged(H), M(c.skin, 0.75)], [merged(X), M(c.hair, o.helmet ? 0.3 : 0.9)]];
    RIDERS.set(key, R);
  }
  const g = new THREE.Group(); g.name = 'rider:' + key;
  for (const [geo, mat] of R) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); }
  return g;
}
/** the e-bike rider: seated on the saddle, hands on the grips, feet on the pedals (right crank forward) */
export function buildCyclist(variant = 'citibike') {
  const del = variant === 'delivery', gx = del ? 0.31 : 0.29, gz = del ? -0.43 : -0.36;
  const a = 0.35, pr = [0.14, BB[1] - Math.sin(a) * CRANK + 0.075, BB[0] - Math.cos(a) * CRANK], pl = [-0.14, BB[1] + Math.sin(a) * CRANK + 0.075, BB[0] + Math.cos(a) * CRANK];
  return seatedRider('cyclist-' + variant, { hip: [0.98, 0.19], lean: del ? 0.42 : 0.3, grip: [gx, 1.02, gz], footR: pr, footL: pl, helmet: del,
    colors: del ? { top: 0x2b4a3a, legs: 0x1e2024, shoes: 0x111111, skin: 0x9a6a48, hair: 0x101214 } : { top: 0x6b7a8c, legs: 0x2c3442, shoes: 0xe6e6e6, skin: 0xd2a07c, hair: 0x3a2618 } });
}

// ---- the bike --------------------------------------------------------------------------------------------------------------
let GEO = {};
function geometries(variant, lite) {
  if (GEO[variant]) return GEO[variant];
  const del = variant === 'delivery', F = [], D = [], C = [], A = [];   // frame paint, dark parts, chrome, accent (food box)
  const tr = del ? 0.024 : 0.021, seg = lite ? 6 : 10;
  const head0 = [0, 0.62, -0.47], head1 = [0, 0.75, -0.505];   // head tube bottom / top (~70 deg head angle)
  // step-through frame: one swept down tube from the head tube down to the bottom bracket, the fat battery along it
  bent(F, [head0, [0, 0.5, -0.36], [0, 0.34, -0.17], [0, BB[1] + 0.02, BB[0] - 0.06], [0, BB[1], BB[0]]], del ? 0.03 : 0.028, seg, lite ? 10 : 18);
  { const b = new THREE.CapsuleGeometry(del ? 0.05 : 0.056, 0.3, 4, lite ? 8 : 12); const d = new THREE.Vector3(0, 0.34 - 0.55, -0.17 + 0.41).normalize();
    b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d)); b.scale(0.85, 1, 1); b.translate(0, 0.45, -0.3); (del ? D : F).push(b);
    const s = new THREE.CapsuleGeometry(0.03, 0.22, 3, 8); s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d)); s.translate(0.04, 0.46, -0.29); D.push(s); }   // battery + its dark side cover
  tube(F, ...head0, ...head1, 0.034, seg);                                                         // head tube
  tube(F, 0, BB[1], BB[0], 0, 0.74, 0.18, tr + 0.004, seg);                                        // seat tube
  for (const s of [-1, 1]) { tube(F, s * 0.03, BB[1], BB[0], s * 0.065, WHEEL_R, REAR_Z, tr * 0.7, seg); tube(F, s * 0.02, 0.66, 0.16, s * 0.065, WHEEL_R, REAR_Z, tr * 0.65, seg); }   // chain stays, seat stays
  for (const s of [-1, 1]) tube(F, s * 0.06, WHEEL_R, FRONT_Z, s * 0.03, head0[1] - 0.02, head0[2] + 0.005, tr * 0.8, seg, tr * 0.95);   // fork legs
  put(F, new THREE.CylinderGeometry(0.05, 0.045, 0.05, seg), ...head0, new THREE.Euler(-0.33, 0, 0)); // fork crown
  // fenders: a painted strip arcing over each tyre
  for (const [z, a0, len] of [[FRONT_Z, 0.9, 1.9], [REAR_Z, -0.25, 2.05]]) { const g = new THREE.CylinderGeometry(WHEEL_R + 0.04, WHEEL_R + 0.04, del ? 0.08 : 0.06, lite ? 12 : 20, 1, true, a0, len); g.rotateZ(Math.PI / 2); g.translate(0, WHEEL_R, z); F.push(g); F.push(g.clone().scale(0.995, 0.995, 0.995)); }
  // drivetrain: chainring, cranks, pedals, the chain guard over the top run, the rear hub motor
  put(C, new THREE.TorusGeometry(0.09, 0.008, 5, 22), 0.07, BB[1], BB[0], new THREE.Euler(0, Math.PI / 2, 0));
  put(D, new THREE.CylinderGeometry(0.08, 0.08, 0.012, 18), 0.07, BB[1], BB[0], new THREE.Euler(0, 0, Math.PI / 2));
  { const a = 0.35, pr = [BB[0] - Math.cos(a) * CRANK, BB[1] - Math.sin(a) * CRANK], pl = [BB[0] + Math.cos(a) * CRANK, BB[1] + Math.sin(a) * CRANK];
    tube(C, 0.09, BB[1], BB[0], 0.09, pr[1], pr[0], 0.011, 6); tube(C, -0.09, BB[1], BB[0], -0.09, pl[1], pl[0], 0.011, 6); tube(C, -0.1, BB[1], BB[0], 0.1, BB[1], BB[0], 0.018, 8);
    put(D, new THREE.BoxGeometry(0.1, 0.022, 0.075), 0.15, pr[1], pr[0]); put(D, new THREE.BoxGeometry(0.1, 0.022, 0.075), -0.15, pl[1], pl[0]); }
  { const s = new THREE.Shape(), L = REAR_Z - BB[0] + 0.1, h = 0.05; s.moveTo(0, -h); s.lineTo(L, -h * 0.55); s.absarc(L, 0, h * 0.55, -Math.PI / 2, Math.PI / 2, false); s.lineTo(0, h); s.absarc(0, 0, h, Math.PI / 2, Math.PI * 1.5, false);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 6 }); g.rotateY(-Math.PI / 2); const ang = Math.atan2(WHEEL_R - BB[1], REAR_Z - BB[0]); g.rotateX(ang); g.translate(0.105, BB[1] + 0.035, BB[0]); D.push(g); }   // chain guard
  put(D, new THREE.CylinderGeometry(0.075, 0.075, 0.07, 16), 0, WHEEL_R, REAR_Z, new THREE.Euler(0, 0, Math.PI / 2));   // hub motor (doesn't need to spin)
  tube(C, -0.05, 0.25, 0.2, -0.13, 0.05, 0.35, 0.011, 6);                                             // kickstand, down
  // seat post + saddle
  tube(C, 0, 0.72, 0.175, 0, 0.88, 0.215, 0.014, 8);
  put(D, new THREE.SphereGeometry(0.5, 14, 8), 0, 0.905, 0.22, new THREE.Euler(0.05, 0, 0), 0.2, 0.065, 0.27);   // saddle, wide rear
  put(D, new THREE.SphereGeometry(0.5, 12, 8), 0, 0.91, 0.14, new THREE.Euler(0.05, 0, 0), 0.08, 0.05, 0.22);    // its nose
  // steerer, stem and bars, grips, the bell / phone mount
  tube(C, ...head1, 0, 0.98, -0.53, 0.016, 8);
  if (del) { tube(C, -0.33, 0.99, -0.5, 0.33, 0.99, -0.5, 0.012, 8); for (const s of [-1, 1]) { tube(D, s * 0.24, 0.99, -0.5, s * 0.345, 0.99, -0.5, 0.019, 10); tube(D, s * 0.2, 1.0, -0.51, s * 0.27, 0.98, -0.6, 0.006, 5); } }
  else { bent(C, [[-0.29, 1.02, -0.36], [-0.21, 1.0, -0.43], [-0.08, 0.985, -0.53], [0.08, 0.985, -0.53], [0.21, 1.0, -0.43], [0.29, 1.02, -0.36]], 0.012, 8, 16);
    for (const s of [-1, 1]) { tube(D, s * 0.23, 1.012, -0.4, s * 0.33, 1.025, -0.33, 0.019, 10); tube(D, s * 0.17, 1.0, -0.47, s * 0.23, 0.99, -0.54, 0.006, 5); } }   // grips, brake levers
  if (del) { tube(D, 0, 0.99, -0.5, 0, 1.06, -0.47, 0.01, 6); put(D, new THREE.BoxGeometry(0.085, 0.16, 0.014), 0, 1.11, -0.46, new THREE.Euler(-0.55, 0, 0)); put(C, new THREE.BoxGeometry(0.075, 0.14, 0.004), 0, 1.112, -0.453, new THREE.Euler(-0.55, 0, 0));
    tube(D, 0, 0.99, -0.53, 0, 0.95, -0.57, 0.008, 5); put(D, new THREE.CylinderGeometry(0.04, 0.032, 0.06, 12), 0, 0.95, -0.575, new THREE.Euler(Math.PI / 2, 0, 0)); }   // phone mount + phone, bar lamp   // phone mount + phone
  else put(C, new THREE.CylinderGeometry(0.025, 0.028, 0.02, 12), -0.12, 1.0, -0.5);   // bell
  if (del) {
    // rear rack: side rails, struts to the hub, a deck; the insulated food box strapped on top
    for (const s of [-1, 1]) { tube(C, s * 0.09, 0.74, 0.14, s * 0.09, 0.74, 0.8, 0.01, 6); tube(C, s * 0.09, 0.74, 0.74, s * 0.07, WHEEL_R, REAR_Z, 0.009, 6); tube(C, s * 0.09, 0.74, 0.14, s * 0.03, 0.66, 0.16, 0.009, 6); }
    put(D, new THREE.BoxGeometry(0.2, 0.012, 0.64), 0, 0.75, 0.47);
    put(A, new RoundedBoxGeometry(0.44, 0.42, 0.42, 2, 0.035), 0, 0.97, 0.56);
    put(D, new RoundedBoxGeometry(0.452, 0.06, 0.432, 2, 0.02), 0, 1.13, 0.56);   // lid seam band
    for (const s of [-1, 1]) put(C, new THREE.BoxGeometry(0.004, 0.035, 0.36), s * 0.222, 0.94, 0.56);   // reflective strips
    put(C, new THREE.BoxGeometry(0.36, 0.035, 0.004), 0, 0.94, 0.772);
    for (const s of [-1, 1]) put(D, new THREE.BoxGeometry(0.03, 0.43, 0.444), s * 0.12, 0.97, 0.56);   // straps
  } else {
    // Citi Bike front carrier: a dark tray on the head tube with rails, struts down to the fork ends, a blue front plate
    put(D, new THREE.BoxGeometry(0.36, 0.012, 0.3), 0, 0.84, -0.76);
    for (const [x0, z0, x1, z1] of [[-0.18, -0.61, 0.18, -0.61], [-0.18, -0.91, 0.18, -0.91], [-0.18, -0.61, -0.18, -0.91], [0.18, -0.61, 0.18, -0.91]]) tube(D, x0, 0.93, z0, x1, 0.93, z1, 0.009, 6);
    for (const [x, z] of [[-0.18, -0.61], [0.18, -0.61], [-0.18, -0.91], [0.18, -0.91]]) tube(D, x, 0.84, z, x, 0.93, z, 0.008, 5);
    for (const s of [-1, 1]) tube(D, s * 0.12, 0.835, -0.86, s * 0.065, WHEEL_R + 0.02, FRONT_Z - 0.01, 0.01, 6);
    tube(D, 0, 0.84, -0.62, ...head1, 0.014, 6);
    put(F, new THREE.BoxGeometry(0.3, 0.075, 0.012), 0, 0.89, -0.917);
    put(D, new THREE.BoxGeometry(0.09, 0.05, 0.05), 0, 0.81, -0.92);   // lamp housing under the plate
  }
  const tyre = tyreGeometry(WHEEL_R, del ? 0.05 : 0.036, del ? 0.03 : 0.019, lite ? 18 : 30);
  const spokes = spokeGeometry(WHEEL_R - (del ? 0.045 : 0.032), del ? 0.034 : 0.022, lite ? 14 : 24);
  return (GEO[variant] = { frame: merged(F), dark: merged(D), chrome: merged(C), accent: A.length ? merged(A) : null, tyre, spokes, lensY: del ? 0.95 : 0.81, lensZ: del ? -0.6 : -0.947 });
}

/** Builds one e-bike. Returns { group, body, fork, wheelF, wheelR, headlight, lens, meshes, variant } - the same shape as
 *  bike.js's buildBike(), so vehicles.js drives a stolen one with the same spec-driven physics + chase-cam rider. */
export function buildEbike(ctx, variant = 'citibike') {
  const lite = !!ctx?.lite, M = ebikeMaterials(), G = geometries(variant, lite), SM = spokeMaterial(lite), TM = tyreMaterial();
  const group = new THREE.Group(); group.name = 'ebike:' + variant;
  const body = new THREE.Group(); group.add(body);
  const meshes = [];
  const mk = (geo, mat, parent, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow && !lite; m.receiveShadow = true; m.userData.surface = 'metal'; m.userData.noDent = true; parent.add(m); meshes.push(m); return m; };
  mk(G.frame, variant === 'delivery' ? M.delivery : M.citi, body);
  mk(G.dark, M.dark, body);
  mk(G.chrome, M.chrome, body, false);
  if (G.accent) mk(G.accent, M.box, body);
  const wheelR = new THREE.Group(); wheelR.position.set(0, WHEEL_R, REAR_Z); body.add(wheelR);
  mk(G.tyre, TM, wheelR); mk(G.spokes, SM, wheelR, false);
  // fork pivot sits right at the front hub (the fork legs stay on the frame), so steering spins the wheel in place
  const fork = new THREE.Group(); fork.position.set(0, WHEEL_R, FRONT_Z); body.add(fork);
  const wheelF = fork;   // vehicles.js rotates wheelF.rotation.x for roll and fork.rotation.y for steer; sharing the group is fine here
  mk(G.tyre, TM, wheelF); mk(G.spokes, SM, wheelF, false);
  const lens = mk(new THREE.CircleGeometry(0.03, 12), M.lens.clone(), body, false); lens.position.set(0, G.lensY, G.lensZ - 0.002); lens.rotation.y = Math.PI;
  const headlight = new THREE.SpotLight(0xfff1cf, 0, 20, 0.55, 0.5, 1.2);
  headlight.position.set(0, G.lensY, G.lensZ - 0.02); headlight.target.position.set(0, 0.4, FRONT_Z - 8); headlight.castShadow = false; headlight.visible = false;
  body.add(headlight); body.add(headlight.target);
  return { group, body, fork, wheelF, wheelR, headlight, lens, meshes, variant };
}

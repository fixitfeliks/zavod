// Procedural police/military motorcycle mesh. Owned by: VEHICLES agent.
// Local space: forward = -Z, up = +Y, wheels on y=0. ~3k tris. Static parts merged per material (paint / chrome / rubber / glass).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WHEEL_R = 0.33;   // tyre outer radius
export const WHEELBASE = 1.5;
export const FRONT_Z = -0.75, REAR_Z = 0.75;

let MATS = null;
export function bikeMaterials() {
  if (MATS) return MATS;
  MATS = {
    paint: new THREE.MeshStandardMaterial({ color: 0x2b332e, roughness: 0.55, metalness: 0.35 }),           // dark matte olive-black
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.18, metalness: 1.0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95, metalness: 0.0 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2a2521, roughness: 0.7, metalness: 0.05 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0c8, emissiveIntensity: 0.15, roughness: 0.25, metalness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a0a0a, emissive: 0xff1a0a, emissiveIntensity: 0.6, roughness: 0.3 }),
  };
  return MATS;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
/** Push a transformed copy of geo into list. rot = Euler or null. */
function put(list, geo, x, y, z, rot = null, sx = 1, sy = 1, sz = 1) {
  const g = geo.clone();
  _q.setFromEuler(rot || new THREE.Euler()); _p.set(x, y, z); _s.set(sx, sy, sz);
  g.applyMatrix4(_m.compose(_p, _q, _s)); list.push(g);
}
/** Tube between two points (cylinder). */
function tube(list, ax, ay, az, bx, by, bz, r, seg = 8) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a), l = d.length();
  const g = new THREE.CylinderGeometry(r, r, l, seg, 1);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); _p.copy(a).add(b).multiplyScalar(0.5); _s.set(1, 1, 1);
  g.applyMatrix4(_m.compose(_p, _q, _s)); list.push(g);
}
function merged(list) { const g = mergeGeometries(list, false); for (const x of list) x.dispose(); return g; }
const E = (x = 0, y = 0, z = 0) => new THREE.Euler(x, y, z);

let GEO = null;
function geometries() {
  if (GEO) return GEO;
  const P = [], C = [], R = [];
  // ---- frame (paint): backbone, downtubes, swingarm, subframe ----
  tube(P, -0.45, 0.62, 0.62, 0.20, 0.86, -0.05, 0.028);   // backbone (seat → steering head)
  tube(P, 0.20, 0.86, -0.05, 0.02, 0.50, -0.52, 0.028);   // downtube to steering head area (front)
  tube(P, -0.02, 0.30, -0.30, 0.02, 0.50, -0.52, 0.026);
  tube(P, -0.02, 0.30, -0.30, 0.02, 0.30, 0.55, 0.026);   // lower rail under engine
  tube(P, 0.02, 0.30, 0.55, -0.45, 0.62, 0.62, 0.026);    // rear upright
  tube(P, -0.45, 0.62, 0.62, -0.55, 0.30, 0.55, 0.024);
  for (const sx of [-0.09, 0.09]) { tube(P, sx, 0.31, 0.45, sx, 0.33, REAR_Z, 0.02); }           // swingarm
  for (const sx of [-0.12, 0.12]) { tube(P, sx, 0.34, 0.50, sx, 0.72, 0.30, 0.016); }            // shock mounts
  // engine block + cylinder heads (paint, boxy)
  put(P, new THREE.BoxGeometry(0.34, 0.30, 0.44), 0, 0.42, 0.02);
  put(P, new THREE.CylinderGeometry(0.11, 0.11, 0.30, 12), -0.02, 0.50, -0.20, E(0.9, 0, 0));
  put(P, new THREE.CylinderGeometry(0.11, 0.11, 0.30, 12), -0.02, 0.50, 0.16, E(-0.9, 0, 0));
  // tank (rounded box via scaled sphere + box)
  put(P, new THREE.SphereGeometry(0.5, 14, 10), 0, 0.85, -0.12, null, 0.36, 0.22, 0.62);
  put(P, new THREE.BoxGeometry(0.30, 0.16, 0.50), 0, 0.80, -0.10);
  // rear fender + tail unit
  put(P, new THREE.CylinderGeometry(0.40, 0.40, 0.18, 22, 1, true, Math.PI * 0.08, Math.PI * 0.84), 0, 0.02 + WHEEL_R, REAR_Z, E(0, 0, Math.PI / 2));
  put(P, new THREE.BoxGeometry(0.26, 0.10, 0.36), 0, 0.78, 0.68);
  // front fender (on fork assembly → separate list F)
  // panniers (hard cases) + racks
  for (const sx of [-1, 1]) {
    put(P, new THREE.BoxGeometry(0.15, 0.30, 0.42), sx * 0.33, 0.76, 0.58);
    tube(P, sx * 0.30, 0.60, 0.36, sx * 0.30, 0.60, 0.82, 0.012); tube(P, sx * 0.30, 0.92, 0.36, sx * 0.30, 0.92, 0.82, 0.012);
  }
  // side panels
  for (const sx of [-1, 1]) put(P, new THREE.BoxGeometry(0.03, 0.18, 0.30), sx * 0.19, 0.62, 0.30, E(0, 0, 0));
  // ---- rubber: seat, grips, footpegs, pillion ----
  const RB = [];
  put(RB, new THREE.BoxGeometry(0.30, 0.09, 0.62), 0, 0.90, 0.32);
  put(RB, new THREE.BoxGeometry(0.24, 0.05, 0.16), 0, 0.90, 0.68);
  for (const sx of [-1, 1]) { put(RB, new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), sx * 0.24, 0.30, 0.10, E(0, 0, Math.PI / 2)); }
  // ---- chrome: exhaust, shocks, mirrors stems, headers, rear rack, bars ----
  for (const sx of [-1, 1]) {
    tube(C, sx * 0.10, 0.36, -0.22, sx * 0.20, 0.22, 0.10, 0.028);           // headers
    tube(C, sx * 0.20, 0.22, 0.10, sx * 0.23, 0.30, 0.95, 0.045);            // mufflers
    put(C, new THREE.CylinderGeometry(0.048, 0.03, 0.06, 10), sx * 0.23, 0.30, 0.97, E(Math.PI / 2, 0, 0));
    tube(C, sx * 0.12, 0.36, 0.52, sx * 0.12, 0.70, 0.34, 0.018);            // rear shocks
    put(C, new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), sx * 0.12, 0.60, 0.40, E(0.42, 0, 0));
  }
  tube(C, -0.14, 0.99, 0.66, 0.14, 0.99, 0.66, 0.012); tube(C, -0.14, 0.99, 0.60, -0.14, 0.99, 0.80, 0.01); tube(C, 0.14, 0.99, 0.60, 0.14, 0.99, 0.80, 0.01); // rear rack
  put(C, new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10), 0, 0.72, 0.06, E(0, 0, Math.PI / 2)); // gearbox/clutch cover
  put(C, new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), 0.20, 0.44, 0.05, E(0, 0, Math.PI / 2)); // clutch cover
  put(C, new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14), -0.20, 0.44, -0.02, E(0, 0, Math.PI / 2));
  // ---- front fork assembly (steers): forks, triple tree, bars, headlight shell, mirrors, front fender ----
  const FP = [], FC = [], FR = [];
  const rake = 0.45; // radians from vertical
  for (const sx of [-1, 1]) {
    const x = sx * 0.13;
    tube(FC, x, 0.98, 0.02, x, 0.33 + Math.tan(rake) * 0.0, -0.75 + 0.36 * Math.tan(rake) - 0.05, 0.02);   // stanchions (approx along the rake)
    tube(FC, x, 0.62, -0.51, x, 0.34, -0.74, 0.03);           // lower legs
  }
  put(FP, new THREE.BoxGeometry(0.34, 0.05, 0.14), 0, 0.98, 0.0, E(-rake, 0, 0));  // top triple tree
  put(FP, new THREE.BoxGeometry(0.34, 0.05, 0.14), 0, 0.78, -0.16, E(-rake, 0, 0));
  tube(FC, -0.36, 1.06, -0.10, 0.36, 1.06, -0.10, 0.014);                    // handlebar
  tube(FC, -0.36, 1.06, -0.10, -0.42, 1.08, 0.10, 0.014); tube(FC, 0.36, 1.06, -0.10, 0.42, 1.08, 0.10, 0.014);
  for (const sx of [-1, 1]) {
    put(FR, new THREE.CylinderGeometry(0.02, 0.02, 0.13, 8), sx * 0.40, 1.075, 0.04, E(Math.PI / 2 - 0.3, 0, 0)); // grips
    tube(FC, sx * 0.30, 1.08, -0.06, sx * 0.44, 1.26, -0.10, 0.007);        // mirror stems (short)
    put(FP, new THREE.BoxGeometry(0.12, 0.075, 0.018), sx * 0.45, 1.27, -0.10, E(0.08, sx * 0.3, 0));
    put(FC, new THREE.BoxGeometry(0.10, 0.06, 0.004), sx * 0.45 - Math.sin(sx * 0.3) * 0.011, 1.27, -0.10 + Math.cos(sx * 0.3) * 0.011, E(0.08, sx * 0.3, 0)); // glass
  }
  put(FP, new THREE.CylinderGeometry(0.115, 0.09, 0.16, 16), 0, 0.86, -0.46, E(Math.PI / 2, 0, 0));  // headlight shell
  put(FC, new THREE.TorusGeometry(0.112, 0.01, 6, 20), 0, 0.86, -0.54);                             // headlight bezel
  put(FP, new THREE.BoxGeometry(0.20, 0.06, 0.12), 0, 1.02, -0.30);                                // instrument pod
  put(FP, new THREE.CylinderGeometry(0.40, 0.40, 0.16, 22, 1, true, Math.PI * 0.12, Math.PI * 0.76), 0, 0.02 + WHEEL_R, FRONT_Z, E(0, 0, Math.PI / 2)); // front fender
  // ---- wheels ----
  const tyre = new THREE.TorusGeometry(WHEEL_R - 0.06, 0.06, 8, 26); tyre.rotateY(Math.PI / 2);
  const WC = [];
  put(WC, new THREE.CylinderGeometry(WHEEL_R - 0.065, WHEEL_R - 0.065, 0.05, 26, 1, true), 0, 0, 0, E(0, 0, Math.PI / 2)); // rim
  put(WC, new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), 0, 0, 0, E(0, 0, Math.PI / 2));                                 // hub
  put(WC, new THREE.CylinderGeometry(0.13, 0.13, 0.012, 20), 0.07, 0, 0, E(0, 0, Math.PI / 2));                              // brake disc
  const spoke = new THREE.BoxGeometry(0.008, WHEEL_R - 0.07, 0.008);
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; const sx = (i % 2 ? 0.03 : -0.03); put(WC, spoke, sx, Math.cos(a) * (WHEEL_R - 0.07) / 2, Math.sin(a) * (WHEEL_R - 0.07) / 2, E(a, 0, 0)); }
  const wheelChrome = merged(WC);
  GEO = {
    paint: merged(P), chrome: merged(C), rubber: merged(RB),
    forkPaint: merged(FP), forkChrome: merged(FC), forkRubber: merged(FR),
    tyre, wheelChrome,
    lens: new THREE.CircleGeometry(0.10, 20),
    tail: new THREE.BoxGeometry(0.16, 0.06, 0.02),
  };
  return GEO;
}

/** Builds one bike. Returns { group, fork, wheelF, wheelR, headlight, body }. All meshes have userData.surface='metal'. */
export function buildBike(ctx) {
  const M = bikeMaterials(), G = geometries();
  const group = new THREE.Group(); group.name = 'bike';
  const body = new THREE.Group(); group.add(body);            // leans (roll) and bobs (suspension)
  const meshes = [];
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.userData.surface = 'metal'; parent.add(m); meshes.push(m); return m; };
  mk(G.paint, M.paint, body); mk(G.chrome, M.chrome, body); mk(G.rubber, M.trim, body);
  const tail = mk(G.tail, M.tail, body); tail.position.set(0, 0.80, 0.865); tail.castShadow = false;
  // rear wheel
  const wheelR = new THREE.Group(); wheelR.position.set(0, WHEEL_R, REAR_Z); body.add(wheelR);
  mk(G.tyre, M.rubber, wheelR).userData.noDent = true; mk(G.wheelChrome, M.chrome, wheelR).userData.noDent = true;
  // fork assembly pivots at the steering head (raked)
  const PIV = new THREE.Vector3(0, 0.9, -0.08);
  const fork = new THREE.Group(); fork.position.copy(PIV); body.add(fork);       // steering pivot (rotate fork.rotation.y)
  const fi = new THREE.Group(); fi.position.copy(PIV).negate(); fork.add(fi);
  mk(G.forkPaint, M.paint, fi); mk(G.forkChrome, M.chrome, fi); mk(G.forkRubber, M.trim, fi);
  const lens = mk(G.lens, M.lens.clone(), fi); lens.position.set(0, 0.86, -0.545); lens.rotation.y = Math.PI; lens.castShadow = false; lens.userData.noDent = true;
  const wheelF = new THREE.Group(); wheelF.position.set(0, WHEEL_R, FRONT_Z); fi.add(wheelF);
  mk(G.tyre, M.rubber, wheelF).userData.noDent = true; mk(G.wheelChrome, M.chrome, wheelF).userData.noDent = true;
  // headlight (only on while mounted)
  const headlight = new THREE.SpotLight(0xfff1cf, 0, 45, 0.48, 0.55, 1.2);
  headlight.position.set(0, 0.86, -0.56); headlight.target.position.set(0, 0.35, -12); headlight.castShadow = false; headlight.visible = false;
  fi.add(headlight); fi.add(headlight.target);
  return { group, body, fork, wheelF, wheelR, headlight, lens, meshes };
}

/**
 * Seated rider for the third-person chase view of your own bike (bike local frame: forward -Z, seat top ~0.95 m).
 * Jacket, jeans, boots, gloves, full-face helmet with a dark visor. ~1.2k tris, one merged mesh per material. Not a raycast target.
 */
let RIDER = null;
export function buildRider() {
  if (!RIDER) {
    const J = [], D = [], K = [], H = [], V = [];
    const limb = (list, a, b, r0, r1 = r0) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), l = d.length(); const g = new THREE.CylinderGeometry(r1, r0, l, 10, 1); g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1))); list.push(g); const j = new THREE.SphereGeometry(r1 * 1.02, 10, 6); j.translate(...b); list.push(j); };
    // torso: hips on the seat, leaning ~25° toward the bars
    put(J, new THREE.SphereGeometry(0.5, 14, 10), 0, 1.3, 0.24, E(-0.42, 0, 0), 0.38, 0.62, 0.26);
    put(D, new THREE.SphereGeometry(0.5, 12, 8), 0, 1.02, 0.34, null, 0.34, 0.2, 0.3);
    limb(J, [0, 1.52, 0.14], [0, 1.6, 0.1], 0.06);                                        // neck
    for (const s of [-1, 1]) {
      limb(J, [s * 0.18, 1.48, 0.16], [s * 0.3, 1.24, 0.02], 0.055, 0.05);                // upper arm
      limb(J, [s * 0.3, 1.24, 0.02], [s * 0.39, 1.09, 0.04], 0.048, 0.042);               // forearm to grip
      put(K, new THREE.SphereGeometry(0.05, 8, 6), s * 0.4, 1.08, 0.04);                     // glove
      limb(D, [s * 0.11, 1.0, 0.34], [s * 0.2, 0.84, -0.06], 0.08, 0.065);                // thigh forward to the tank
      limb(D, [s * 0.2, 0.84, -0.06], [s * 0.24, 0.36, 0.08], 0.06, 0.05);                // shin down to the peg
      put(K, new THREE.BoxGeometry(0.1, 0.1, 0.26), s * 0.24, 0.33, 0.04);                   // boot
    }
    put(H, new THREE.SphereGeometry(0.15, 16, 12), 0, 1.72, 0.08, null, 1, 1.05, 1.1);    // helmet
    put(V, new THREE.SphereGeometry(0.152, 14, 8, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.26), 0, 1.72, 0.08, E(0, -Math.PI / 2, 0), 1, 1.05, 1.1); // visor band (front)
    const mats = { J: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7, metalness: 0.05 }), D: new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.9 }), K: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }), H: new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.25, metalness: 0.3 }), V: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.05, metalness: 0.6 }) };
    RIDER = [[merged(J), mats.J], [merged(D), mats.D], [merged(K), mats.K], [merged(H), mats.H], [merged(V), mats.V]];
  }
  const g = new THREE.Group(); g.name = 'rider';
  for (const [geo, mat] of RIDER) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); }
  return g;
}

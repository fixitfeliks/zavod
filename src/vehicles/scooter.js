// Procedural kick scooter + Vespa-style moped meshes, left over from #187's e-bikes: same cheap convention (geometry/
// materials cached once per variant, cloned per instance only by transform). Local space: forward = -Z, up = +Y, wheels on
// y=0. Owned by: VEHICLES agent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// kick scooter: tiny wheels, a deck you stand on, a single steering column
export const KICK_WHEEL_R = 0.09, KICK_WHEELBASE = 0.78, KICK_FRONT_Z = -0.42, KICK_REAR_Z = 0.36;
// moped (Vespa-like): bigger wheels, a step-through shell, a seat
export const MOPED_WHEEL_R = 0.24, MOPED_WHEELBASE = 1.22, MOPED_FRONT_Z = -0.62, MOPED_REAR_Z = 0.6;

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    kickDeck: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.5 }),
    kickBar: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.85 }),
    mopedShell: new THREE.MeshStandardMaterial({ color: 0xd8c43a, roughness: 0.35, metalness: 0.25 }),   // cream/mustard Vespa paint
    mopedTrim: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.4, metalness: 0.1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.2, metalness: 0.95 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.7 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0c8, emissiveIntensity: 0.12, roughness: 0.3 }),
  };
  return MATS;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
function put(list, geo, x, y, z, rot = null, sx = 1, sy = 1, sz = 1) {
  const g = geo.clone(); _q.setFromEuler(rot || new THREE.Euler()); _p.set(x, y, z); _s.set(sx, sy, sz);
  g.applyMatrix4(_m.compose(_p, _q, _s)); list.push(g);
}
function tube(list, ax, ay, az, bx, by, bz, r, seg = 6) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a), l = d.length();
  const g = new THREE.CylinderGeometry(r, r, l, seg, 1);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); _p.copy(a).add(b).multiplyScalar(0.5); _s.set(1, 1, 1);
  g.applyMatrix4(_m.compose(_p, _q, _s)); list.push(g);
}
function merged(list) { const g = mergeGeometries(list, false); for (const x of list) x.dispose(); return g; }

let GEO = {};
function geometries(variant) {
  if (GEO[variant]) return GEO[variant];
  const F = [], RB = [], C = [];
  if (variant === 'moped') {
    // step-through shell: front leg shield, floorboard, rear body hump over the engine, round headlight nacelle
    put(F, new THREE.BoxGeometry(0.4, 0.62, 0.1), 0, 0.56, MOPED_FRONT_Z + 0.08);                     // leg shield
    put(F, new THREE.BoxGeometry(0.34, 0.06, 0.9), 0, 0.3, 0.02);                                      // floorboard
    put(F, new THREE.BoxGeometry(0.46, 0.4, 0.62), 0, 0.5, MOPED_REAR_Z - 0.18);                        // rear body hump
    tube(F, 0, 0.56, MOPED_FRONT_Z + 0.08, 0, 0.9, MOPED_FRONT_Z + 0.05, 0.022);                        // steering column
    tube(C, -0.21, 0.98, MOPED_FRONT_Z + 0.08, 0.21, 0.98, MOPED_FRONT_Z + 0.08, 0.016);                 // handlebar
    put(C, new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12), 0, 0.62, MOPED_FRONT_Z - 0.02, new THREE.Euler(Math.PI / 2, 0, 0));   // headlight nacelle
    put(RB, new THREE.BoxGeometry(0.3, 0.1, 0.46), 0, 0.72, 0.1);                                        // bench seat
  } else {
    // kick scooter: a flat deck, a single steering column, a folding-style handlebar
    put(F, new THREE.BoxGeometry(0.16, 0.03, KICK_WHEELBASE - 0.1), 0, 0.14, (KICK_FRONT_Z + KICK_REAR_Z) / 2);   // deck
    tube(F, 0, 0.14, KICK_FRONT_Z + 0.06, 0, 1.02, KICK_FRONT_Z + 0.02, 0.016);                            // steering column
    tube(C, -0.19, 1.04, KICK_FRONT_Z + 0.02, 0.19, 1.04, KICK_FRONT_Z + 0.02, 0.013);                     // handlebar
    tube(F, 0, 0.1, KICK_REAR_Z - 0.08, 0, 0.14, KICK_REAR_Z, 0.018);                                      // rear fender stem (also the brake)
  }
  const wr = variant === 'moped' ? MOPED_WHEEL_R : KICK_WHEEL_R;
  const tyre = new THREE.TorusGeometry(wr - (variant === 'moped' ? 0.045 : 0.018), variant === 'moped' ? 0.045 : 0.022, 6, 16); tyre.rotateY(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(wr - (variant === 'moped' ? 0.06 : 0.03), wr - (variant === 'moped' ? 0.06 : 0.03), 0.025, 14, 1, true); rim.rotateZ(Math.PI / 2);
  const lens = new THREE.CircleGeometry(variant === 'moped' ? 0.07 : 0.03, 10);
  return (GEO[variant] = { frame: merged(F), seat: RB.length ? merged(RB) : null, fittings: merged(C), tyre, rim, lens });
}

/** Builds one scooter/moped. Returns the same shape as bike.js's buildBike() / ebike.js's buildEbike() (group, body, fork,
 *  wheelF, wheelR, headlight, lens, meshes, variant) so vehicles.js drives a stolen one through the same spec-driven physics. */
export function buildScooter(ctx, variant = 'kick') {
  const M = mats(), G = geometries(variant), wr = variant === 'moped' ? MOPED_WHEEL_R : KICK_WHEEL_R;
  const frontZ = variant === 'moped' ? MOPED_FRONT_Z : KICK_FRONT_Z, rearZ = variant === 'moped' ? MOPED_REAR_Z : KICK_REAR_Z;
  const group = new THREE.Group(); group.name = 'scooter:' + variant;
  const body = new THREE.Group(); group.add(body);
  const meshes = [];
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.userData.surface = 'metal'; m.userData.noDent = true; parent.add(m); meshes.push(m); return m; };
  mk(G.frame, variant === 'moped' ? M.mopedShell : M.kickDeck, body);
  if (G.seat) mk(G.seat, M.seat, body);
  mk(G.fittings, variant === 'moped' ? M.mopedTrim : M.kickBar, body);
  const wheelR = new THREE.Group(); wheelR.position.set(0, wr, rearZ); body.add(wheelR);
  mk(G.tyre, M.rubber, wheelR); mk(G.rim, M.chrome, wheelR);
  // fork pivot sits right at the front hub (cheap: no separate fork geometry), so steering spins the wheel in place
  const fork = new THREE.Group(); fork.position.set(0, wr, frontZ); body.add(fork);
  const wheelF = fork;   // vehicles.js rotates wheelF.rotation.x for roll and fork.rotation.y for steer; sharing the group is fine here
  mk(G.tyre, M.rubber, wheelF); mk(G.rim, M.chrome, wheelF);
  const lensY = variant === 'moped' ? 0.62 : 1.02;
  const lens = mk(G.lens, M.lens.clone(), body); lens.position.set(0, lensY, frontZ - 0.01); lens.rotation.y = Math.PI; lens.castShadow = false;
  const headlight = new THREE.SpotLight(0xfff1cf, 0, 16, 0.55, 0.5, 1.2);
  headlight.position.set(0, lensY, frontZ - 0.02); headlight.target.position.set(0, 0.3, frontZ - 6); headlight.castShadow = false; headlight.visible = false;
  body.add(headlight); body.add(headlight.target);
  return { group, body, fork, wheelF, wheelR, headlight, lens, meshes, variant };
}

/**
 * Standing rider for a kick scooter's third-person chase view: one foot on the deck, hands down on the bars, a casual
 * stance (no helmet). Cheap: ~500 tris, one merged mesh per material, cached once like bike.js's buildRider().
 */
let STANDER = null;
export function buildStandingRider() {
  if (!STANDER) {
    const J = [], D = [], K = [], H = [];
    const limb = (list, a, b, r0, r1 = r0) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), l = d.length(); const g = new THREE.CylinderGeometry(r1, r0, l, 8, 1); g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1))); list.push(g); const j = new THREE.SphereGeometry(r1 * 1.02, 8, 6); j.translate(...b); list.push(j); };
    // torso: standing upright on the deck, a slight forward lean toward the bars
    put(J, new THREE.SphereGeometry(0.42, 12, 8), 0, 1.45, -0.02, new THREE.Euler(-0.14, 0, 0), 0.4, 0.68, 0.3);
    put(D, new THREE.SphereGeometry(0.4, 10, 8), 0, 1.08, 0, null, 0.36, 0.22, 0.3);
    limb(J, [0, 1.76, -0.02], [0, 1.82, -0.06], 0.07);                                           // neck
    for (const s of [-1, 1]) {
      limb(J, [s * 0.2, 1.68, -0.02], [s * 0.26, 1.3, -0.18], 0.06, 0.05);                        // upper arm, reaching forward
      limb(J, [s * 0.26, 1.3, -0.18], [s * 0.22, 1.08, -0.4], 0.05, 0.042);                        // forearm down to the bar
      put(K, new THREE.SphereGeometry(0.055, 8, 6), s * 0.21, 1.06, -0.41);                           // glove on the grip
      limb(D, [s * 0.1, 0.92, 0], [s * 0.1, 0.46, 0.02], 0.085, 0.07);                             // thigh, straight (standing)
      limb(D, [s * 0.1, 0.46, 0.02], [s * 0.1, 0.14, 0.08], 0.062, 0.05);                          // shin down to the deck
      put(K, new THREE.BoxGeometry(0.1, 0.08, 0.24), s * 0.1, 0.13, 0.1);                             // shoe, forward on the deck
    }
    put(H, new THREE.SphereGeometry(0.17, 14, 10), 0, 1.98, -0.03);                                  // bare head, casual (no helmet)
    const mats2 = { J: new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.8, metalness: 0.02 }), D: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 }), K: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }), H: new THREE.MeshStandardMaterial({ color: 0xc8906a, roughness: 0.75 }) };
    STANDER = [[merged(J), mats2.J], [merged(D), mats2.D], [merged(K), mats2.K], [merged(H), mats2.H]];
  }
  const g = new THREE.Group(); g.name = 'rider:standing';
  for (const [geo, mat] of STANDER) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); }
  return g;
}

// Procedural e-bike meshes: a delivery e-bike (rear cargo box) and a Citi Bike-style e-bike (blue frame, front basket).
// Cheap and shared: geometry/materials cached once per variant, cloned per instance only by transform (same convention as
// bike.js). Local space: forward = -Z, up = +Y, wheels on y=0. Owned by: VEHICLES agent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WHEEL_R = 0.3;
export const WHEELBASE = 1.15;
export const FRONT_Z = -0.58, REAR_Z = 0.58;

let MATS = null;
function ebikeMaterials() {
  if (MATS) return MATS;
  MATS = {
    citi: new THREE.MeshStandardMaterial({ color: 0x1f6fb2, roughness: 0.4, metalness: 0.45 }),
    delivery: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.55, metalness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.25, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    box: new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6, metalness: 0.1 }),
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
  // frame: down tube, seat tube, top tube, chain stay, head tube, battery box (the e-bike tell)
  tube(F, 0, 0.5, -0.05, 0, 0.42, REAR_Z - 0.1, 0.022);
  tube(F, -0.02, 0.78, 0.10, 0, 0.42, REAR_Z - 0.1, 0.02);
  tube(F, -0.02, 0.78, 0.10, 0, 0.5, -0.05, 0.02);
  tube(F, 0, 0.42, REAR_Z - 0.1, 0, WHEEL_R, REAR_Z, 0.018);
  tube(F, 0, 0.5, -0.05, 0, WHEEL_R, FRONT_Z, 0.018);
  put(F, new THREE.BoxGeometry(0.22, 0.3, 0.15), 0, 0.5, 0.22);
  put(RB, new THREE.BoxGeometry(0.16, 0.06, 0.3), 0, 0.84, 0.14);   // seat
  tube(C, -0.19, 0.95, FRONT_Z + 0.02, 0.19, 0.95, FRONT_Z + 0.02, 0.014);   // handlebar
  tube(C, 0, 0.5, -0.05, 0, 0.95, FRONT_Z + 0.02, 0.016);                    // stem/steerer
  if (variant === 'delivery') put(F, new THREE.BoxGeometry(0.42, 0.42, 0.46), 0, 0.68, REAR_Z + 0.42);   // rear cargo box
  else put(C, new THREE.BoxGeometry(0.28, 0.17, 0.22), 0, 0.72, FRONT_Z - 0.16);   // front basket (citibike)
  const tyre = new THREE.TorusGeometry(WHEEL_R - 0.045, 0.045, 6, 18); tyre.rotateY(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(WHEEL_R - 0.06, WHEEL_R - 0.06, 0.03, 18, 1, true); rim.rotateZ(Math.PI / 2);
  return (GEO[variant] = { frame: merged(F), seat: merged(RB), fittings: merged(C), tyre, rim });
}

/** Builds one e-bike. Returns { group, body, fork, wheelF, wheelR, headlight, lens, meshes, variant } - the same shape as
 *  bike.js's buildBike(), so vehicles.js drives a stolen one with the same spec-driven physics + chase-cam rider. */
export function buildEbike(ctx, variant = 'citibike') {
  const M = ebikeMaterials(), G = geometries(variant);
  const group = new THREE.Group(); group.name = 'ebike:' + variant;
  const body = new THREE.Group(); group.add(body);
  const meshes = [];
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.userData.surface = 'metal'; m.userData.noDent = true; parent.add(m); meshes.push(m); return m; };
  mk(G.frame, variant === 'delivery' ? M.delivery : M.citi, body);
  mk(G.seat, M.rubber, body);
  mk(G.fittings, variant === 'delivery' ? M.box : M.chrome, body);
  const wheelR = new THREE.Group(); wheelR.position.set(0, WHEEL_R, REAR_Z); body.add(wheelR);
  mk(G.tyre, M.rubber, wheelR); mk(G.rim, M.chrome, wheelR);
  // fork pivot sits right at the front hub (cheap: no separate fork geometry), so steering spins the wheel in place
  const fork = new THREE.Group(); fork.position.set(0, WHEEL_R, FRONT_Z); body.add(fork);
  const wheelF = fork;   // vehicles.js rotates wheelF.rotation.x for roll and fork.rotation.y for steer; sharing the group is fine here
  mk(G.tyre, M.rubber, wheelF); mk(G.rim, M.chrome, wheelF);
  const lens = mk(new THREE.CircleGeometry(0.06, 12), M.lens.clone(), body); lens.position.set(0, 0.86, FRONT_Z - 0.01); lens.rotation.y = Math.PI; lens.castShadow = false;
  const headlight = new THREE.SpotLight(0xfff1cf, 0, 20, 0.55, 0.5, 1.2);
  headlight.position.set(0, 0.86, FRONT_Z - 0.02); headlight.target.position.set(0, 0.4, FRONT_Z - 8); headlight.castShadow = false; headlight.visible = false;
  body.add(headlight); body.add(headlight.target);
  return { group, body, fork, wheelF, wheelR, headlight, lens, meshes, variant };
}

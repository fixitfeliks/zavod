// Procedural kick scooter + Vespa-style moped meshes, left over from #187's e-bikes: same cheap convention (geometry/
// materials cached once per variant, cloned per instance only by transform) and the same shared parts (ebike.js: lathed tyres
// on the car kit's tread texture, the seated rider). Local space: forward = -Z, up = +Y, right = +X, wheels on y=0.
// Kick scooter: a slim deck with grip tape, a folding stem, a T-bar with grips, small solid wheels, a rear fender brake, a stem
// light. Moped: a smooth lathed steel body (rear cowl, curved leg shield, front mudguard, the handlebar headset carrying the
// round headlamp), a floorboard, a bench seat, chrome trim and mirrors, small wheels on painted hubs; one of a few two-tone
// paint schemes per build (shared materials, picked round-robin). Owned by: VEHICLES agent.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { put, tube, bent, merged, tyreGeometry, tyreMaterial, seatedRider, joint } from './ebike.js';

// kick scooter: tiny wheels, a deck you stand on, a single steering column
export const KICK_WHEEL_R = 0.09, KICK_WHEELBASE = 0.78, KICK_FRONT_Z = -0.42, KICK_REAR_Z = 0.36;
// moped (Vespa-like): bigger wheels, a step-through shell, a seat
export const MOPED_WHEEL_R = 0.24, MOPED_WHEELBASE = 1.22, MOPED_FRONT_Z = -0.62, MOPED_REAR_Z = 0.6;
const DECK_Y = 0.155;   // kick scooter deck top
const PAINTS = [[0x8fcfbd, 0xefe8d6], [0xb3261e, 0xefe8d6], [0xd9b43a, null], [0x2f4f7a, 0xe9e6de]];   // [body, second tone or null (one colour)]

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    kickDeck: std({ color: 0x3a3d41, roughness: 0.45, metalness: 0.6 }),     // anodised aluminium
    kickBar: std({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.85 }),
    dark: std({ color: 0x141516, roughness: 0.85, metalness: 0.05 }),         // grip tape, grips, fender, seat, rubber strips
    chrome: std({ color: 0xdfe3e6, roughness: 0.12, metalness: 1.0 }),
    lens: std({ color: 0xfff4dc, emissive: 0xfff0c8, emissiveIntensity: 0.12, roughness: 0.3 }),
    paints: PAINTS.map(([a, b]) => { const body = std({ color: a, roughness: 0.28, metalness: 0.35, side: THREE.DoubleSide }); return [body, b === null ? body : std({ color: b, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide })]; }),
  };
  for (const k in MATS) if (MATS[k].isMaterial) MATS[k].name = 'scooter_' + k;
  return MATS;
}
let paintN = 0;

const rrect = (w, l, r) => { const s = new THREE.Shape(), x = w / 2, z = l / 2; s.moveTo(-x + r, -z); s.lineTo(x - r, -z); s.quadraticCurveTo(x, -z, x, -z + r); s.lineTo(x, z - r); s.quadraticCurveTo(x, z, x - r, z); s.lineTo(-x + r, z); s.quadraticCurveTo(-x, z, -x, z - r); s.lineTo(-x, -z + r); s.quadraticCurveTo(-x, -z, -x + r, -z); return s; };
/** a hub disc (rim face + boss + nuts) round the x axle, both faces */
function hubGeometry(rr, w, boss, seg) {
  const L = [];
  put(L, new THREE.CylinderGeometry(rr, rr, w, seg), 0, 0, 0, new THREE.Euler(0, 0, Math.PI / 2));
  for (const s of [-1, 1]) { put(L, new THREE.CylinderGeometry(boss, boss * 1.15, 0.03, 14), s * (w / 2 + 0.012), 0, 0, new THREE.Euler(0, 0, s * Math.PI / 2));
    if (rr > 0.1) for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; put(L, new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6), s * (w / 2 + 0.005), Math.cos(a) * boss * 1.6, Math.sin(a) * boss * 1.6, new THREE.Euler(0, 0, Math.PI / 2)); } }
  return merged(L);
}

let GEO = {};
function geometries(variant, lite) {
  const key = variant + (lite ? ':lite' : ''); if (GEO[key]) return GEO[key];
  const P = [], T = [], D = [], C = [], B = [], seg = lite ? 8 : 14;   // paint, second tone, dark, chrome, bare metal (deck / bars)
  let tyre, hub, lens;
  if (variant === 'moped') {
    const fz = MOPED_FRONT_Z, rz = MOPED_REAR_Z, wr = MOPED_WHEEL_R;
    // rear cowl: one lathed pear-shaped shell over the engine and the rear wheel, flattened sideways
    { const prof = [[0.0, 0.0], [0.08, 0.01], [0.16, 0.06], [0.215, 0.16], [0.24, 0.32], [0.238, 0.46], [0.215, 0.6], [0.16, 0.72], [0.08, 0.79], [0.0, 0.81]];
      const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), lite ? 14 : 24); g.rotateX(Math.PI / 2); g.scale(0.86, 0.92, 1); g.translate(0, 0.53, -0.02); P.push(g); }
    // the spine under the seat joining it to the leg shield, the floorboard, its rubber strips
    put(P, new RoundedBoxGeometry(0.2, 0.2, 0.5, 2, 0.06), 0, 0.37, -0.22);
    put(T, new RoundedBoxGeometry(0.36, 0.05, 0.6, 2, 0.02), 0, 0.29, -0.2);
    for (const x of [-0.12, -0.06, 0.06, 0.12]) put(D, new THREE.BoxGeometry(0.025, 0.012, 0.5), x, 0.318, -0.2);
    // leg shield: a curved panel (a slice of a cone round a vertical axis behind it), its inner face the second tone
    { const g = new THREE.CylinderGeometry(0.29, 0.34, 0.64, lite ? 10 : 18, 1, true, Math.PI - 0.8, 1.6); g.translate(0, 0.62, -0.2); P.push(g);
      const h = new THREE.CylinderGeometry(0.283, 0.333, 0.62, lite ? 10 : 18, 1, true, Math.PI - 0.78, 1.56); h.translate(0, 0.62, -0.2); T.push(h);
      const edge = []; for (let k = 0; k <= 8; k++) { const a = Math.PI - 0.8 + k * 0.2; edge.push([Math.sin(a) * 0.292, 0.94, -0.2 + Math.cos(a) * 0.292]); } bent(C, edge, 0.01, 5, 12); }   // chrome edge along the top
    // the horn cast (the "tie") down the shield's front, the front mudguard over the wheel
    put(P, new THREE.CapsuleGeometry(0.035, 0.28, 3, 8), 0, 0.68, -0.535, new THREE.Euler(0.1, 0, 0), 1.2, 1, 0.7);
    put(C, new THREE.BoxGeometry(0.03, 0.12, 0.012), 0, 0.72, -0.565, new THREE.Euler(0.1, 0, 0));
    { const g = new THREE.CylinderGeometry(wr + 0.045, wr + 0.045, 0.15, lite ? 10 : 16, 1, true, 0.9, 1.5); g.rotateZ(Math.PI / 2); g.translate(0, wr, fz); P.push(g); }
    // front fork (single trailing link), the steering column behind the shield, the headset on the bars with the round lamp
    tube(D, 0.06, wr, fz, 0.05, 0.6, fz + 0.1, 0.022, 8); tube(D, 0, 0.6, fz + 0.12, 0, 0.98, fz + 0.16, 0.03, 8);
    put(P, new THREE.CapsuleGeometry(0.065, 0.26, 4, lite ? 10 : 14), 0, 1.0, fz + 0.16, new THREE.Euler(0, 0, Math.PI / 2), 1, 1, 1.15);
    put(T, new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.04, fz + 0.17, null, 1.6, 0.55, 1.1);   // headset top cap
    put(C, new THREE.TorusGeometry(0.06, 0.012, 6, 18), 0, 1.0, fz + 0.075);   // lamp bezel
    for (const s of [-1, 1]) { tube(C, s * 0.16, 1.0, fz + 0.17, s * 0.27, 1.0, fz + 0.2, 0.013, 6); tube(D, s * 0.25, 1.0, fz + 0.2, s * 0.35, 1.0, fz + 0.22, 0.02, 10);   // bars, grips
      tube(C, s * 0.2, 1.03, fz + 0.18, s * 0.27, 1.25, fz + 0.18, 0.007, 5); put(C, new THREE.CylinderGeometry(0.045, 0.045, 0.012, 14), s * 0.28, 1.27, fz + 0.18, new THREE.Euler(Math.PI / 2, 0, 0));   // mirrors on stalks
      tube(D, s * 0.19, 1.0, fz + 0.15, s * 0.25, 0.99, fz + 0.08, 0.006, 5); }   // levers
    // bench seat, the chrome grab rail behind it, side trim strips along the cowl, exhaust
    put(D, new THREE.CapsuleGeometry(0.1, 0.4, 4, lite ? 10 : 14), 0, 0.79, 0.3, new THREE.Euler(Math.PI / 2, 0, 0), 1.25, 1, 0.55);
    put(T, new RoundedBoxGeometry(0.24, 0.04, 0.6, 2, 0.015), 0, 0.735, 0.3);   // seat base band
    bent(C, [[-0.11, 0.75, 0.58], [-0.12, 0.8, 0.7], [0, 0.82, 0.77], [0.12, 0.8, 0.7], [0.11, 0.75, 0.58]], 0.01, 6, 12);
    for (const s of [-1, 1]) bent(C, [[s * 0.18, 0.4, 0.08], [s * 0.205, 0.45, 0.3], [s * 0.2, 0.5, 0.55]], 0.008, 5, 10);
    tube(C, 0.17, 0.3, 0.45, 0.2, 0.33, 0.78, 0.05, 10); put(D, new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), 0.2, 0.33, 0.8, new THREE.Euler(Math.PI / 2, 0, 0));
    put(C, new THREE.BoxGeometry(0.2, 0.06, 0.01), 0, 0.58, 0.79);   // plate holder
    tube(D, -0.05, 0.3, 0.05, -0.15, 0.04, 0.12, 0.01, 6);   // side stand
    tyre = tyreGeometry(wr, 0.075, 0.05, lite ? 18 : 28, 1); hub = hubGeometry(wr - 0.07, 0.09, 0.045, lite ? 12 : 20);
    lens = new THREE.CircleGeometry(0.052, 16);
  } else {
    const fz = KICK_FRONT_Z, rz = KICK_REAR_Z, wr = KICK_WHEEL_R;
    // deck: a rounded aluminium plank, grip tape on top; the neck rising to the head tube; the rear fender brake
    { const g = new THREE.ExtrudeGeometry(rrect(0.15, 0.56, 0.05), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 }); g.rotateX(Math.PI / 2); g.translate(0, DECK_Y, -0.01); B.push(g);
      const t = new THREE.ShapeGeometry(rrect(0.13, 0.5, 0.04), 4); t.rotateX(-Math.PI / 2); t.translate(0, DECK_Y + 0.0045, -0.01); D.push(t); }
    bent(B, [[0, DECK_Y - 0.02, -0.26], [0, DECK_Y + 0.01, -0.33], [0, 0.24, -0.37]], 0.022, 8, 8);
    tube(B, 0, 0.21, -0.375, 0, 0.36, -0.385, 0.026, 10);                                   // head tube
    for (const s of [-1, 1]) tube(B, s * 0.025, 0.23, fz + 0.04, s * 0.025, wr, fz, 0.011, 6);   // fork
    put(D, new THREE.CylinderGeometry(0.034, 0.034, 0.07, 10), 0, 0.42, -0.385);           // folding clamp
    put(D, new THREE.BoxGeometry(0.06, 0.03, 0.05), 0, 0.42, -0.355);                       // its lever
    tube(B, 0, 0.36, -0.385, 0, 1.0, -0.37, 0.016, 10);                                    // stem
    tube(B, -0.2, 1.02, -0.37, 0.2, 1.02, -0.37, 0.012, 8); put(B, new THREE.SphereGeometry(0.02, 8, 6), 0, 1.02, -0.37);   // T-bar
    for (const s of [-1, 1]) tube(D, s * 0.12, 1.02, -0.37, s * 0.215, 1.02, -0.37, 0.018, 10);   // grips
    put(D, new THREE.BoxGeometry(0.045, 0.035, 0.04), 0, 0.93, -0.395);                     // stem light housing
    { const g = new THREE.CylinderGeometry(wr + 0.015, wr + 0.015, 0.05, 10, 1, true, -0.2, 1.6); g.rotateZ(Math.PI / 2); g.translate(0, wr, rz); D.push(g); D.push(g.clone().scale(0.99, 0.99, 0.99)); }   // fender brake
    tube(B, 0.05, DECK_Y - 0.02, 0.24, 0.03, wr, rz, 0.01, 6); tube(B, -0.05, DECK_Y - 0.02, 0.24, -0.03, wr, rz, 0.01, 6);   // rear dropouts
    tube(B, -0.075, DECK_Y - 0.02, 0.05, -0.14, 0.01, 0.12, 0.006, 5);                     // kickstand
    tyre = tyreGeometry(wr, 0.03, 0.017, lite ? 14 : 22, 1); hub = hubGeometry(wr - 0.03, 0.03, 0.016, lite ? 10 : 16);
    lens = new THREE.CircleGeometry(0.016, 10);
  }
  return (GEO[key] = { paint: P.length ? merged(P) : null, tone: T.length ? merged(T) : null, dark: merged(D), chrome: C.length ? merged(C) : null, bare: B.length ? merged(B) : null, tyre, hub, lens });
}

/** Builds one scooter/moped. Returns the same shape as bike.js's buildBike() / ebike.js's buildEbike() (group, body, fork,
 *  wheelF, wheelR, headlight, lens, meshes, variant) so vehicles.js drives a stolen one through the same spec-driven physics. */
export function buildScooter(ctx, variant = 'kick') {
  const lite = !!ctx?.lite, M = mats(), G = geometries(variant, lite), moped = variant === 'moped', wr = moped ? MOPED_WHEEL_R : KICK_WHEEL_R;
  const frontZ = moped ? MOPED_FRONT_Z : KICK_FRONT_Z, rearZ = moped ? MOPED_REAR_Z : KICK_REAR_Z;
  const group = new THREE.Group(); group.name = 'scooter:' + variant;
  const body = new THREE.Group(); group.add(body);
  const meshes = [];
  const mk = (geo, mat, parent, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow && !lite; m.receiveShadow = true; m.userData.surface = 'metal'; m.userData.noDent = true; parent.add(m); meshes.push(m); return m; };
  const [paint, tone] = M.paints[paintN++ % M.paints.length];
  if (G.paint) mk(G.paint, paint, body);
  if (G.tone) mk(G.tone, tone, body);
  mk(G.dark, M.dark, body);
  if (G.chrome) mk(G.chrome, M.chrome, body, false);
  if (G.bare) mk(G.bare, M.kickDeck, body);
  const hubMat = moped ? tone : M.kickBar;   // Vespa hubs in the second tone; a kick scooter's in bare alloy
  const wheelR = new THREE.Group(); wheelR.position.set(0, wr, rearZ); body.add(wheelR);
  mk(G.tyre, tyreMaterial(), wheelR); mk(G.hub, hubMat, wheelR, false);
  // fork pivot sits right at the front hub (the fork legs stay on the frame), so steering spins the wheel in place
  const fork = new THREE.Group(); fork.position.set(0, wr, frontZ); body.add(fork);
  const wheelF = fork;   // vehicles.js rotates wheelF.rotation.x for roll and fork.rotation.y for steer; sharing the group is fine here
  mk(G.tyre, tyreMaterial(), wheelF); mk(G.hub, hubMat, wheelF, false);
  const lensY = moped ? 1.0 : 0.93, lensZ = moped ? frontZ + 0.068 : -0.418;
  const lens = mk(G.lens, M.lens.clone(), body, false); lens.position.set(0, lensY, lensZ); lens.rotation.y = Math.PI;
  const headlight = new THREE.SpotLight(0xfff1cf, 0, 16, 0.55, 0.5, 1.2);
  headlight.position.set(0, lensY, lensZ - 0.02); headlight.target.position.set(0, 0.3, frontZ - 6); headlight.castShadow = false; headlight.visible = false;
  body.add(headlight); body.add(headlight.target);
  return { group, body, fork, wheelF, wheelR, headlight, lens, meshes, variant };
}

/** the moped rider: seated toward the front of the bench, feet flat on the floorboard, hands on the grips */
export function buildMopedRider() {
  return seatedRider('moped', { hip: [0.86, 0.16], lean: 0.2, grip: [0.31, 1.0, MOPED_FRONT_Z + 0.21], footR: [0.12, 0.4, -0.24], footL: [-0.12, 0.4, -0.2], helmet: true,
    colors: { top: 0x7a3b2e, legs: 0x2d3440, shoes: 0x3a2a1e, skin: 0xc8906a, hair: 0xe8e4da } });
}

/**
 * Standing rider for a kick scooter's third-person chase view: feet one behind the other on the deck (left foot forward), hands on
 * the T-bar grips, a casual stance (no helmet). Cheap: one merged mesh per material, cached once like bike.js's buildRider().
 */
let STANDER = null;
export function buildStandingRider() {
  if (!STANDER) {
    const J = [], D = [], K = [], H = [];
    const limb = (list, a, b, r0, r1 = r0) => { tube(list, ...a, ...b, r0, 8, r1); const j = new THREE.SphereGeometry(r1 * 1.02, 8, 6); j.translate(...b); list.push(j); };
    // torso: standing upright on the deck, a slight forward lean toward the bars
    put(J, new THREE.SphereGeometry(0.42, 12, 8), 0, 1.45, -0.02, new THREE.Euler(-0.14, 0, 0), 0.4, 0.68, 0.3);
    put(D, new THREE.SphereGeometry(0.4, 10, 8), 0, 1.08, 0.01, null, 0.36, 0.22, 0.3);
    limb(J, [0, 1.76, -0.02], [0, 1.82, -0.06], 0.07);                                           // neck
    for (const s of [-1, 1]) {
      const S = [s * 0.2, 1.68, -0.02], G = [s * 0.17, 1.03, -0.37], E = joint(S, G, 0.33, 0.3, [s, -0.3, 0.6]);
      limb(J, S, E, 0.06, 0.05); limb(J, E, G, 0.05, 0.042);                                      // arms down to the T-bar
      put(K, new THREE.SphereGeometry(0.05, 8, 6), G[0], G[1] + 0.005, G[2]);                     // glove on the grip
      const hip = [s * 0.1, 0.96, 0.02], foot = s < 0 ? [-0.03, DECK_Y + 0.07, -0.12] : [0.035, DECK_Y + 0.07, 0.15], Kn = joint(hip, foot, 0.45, 0.44, [s * 0.2, 0.3, -1]);
      limb(D, hip, Kn, 0.085, 0.065); limb(D, Kn, foot, 0.06, 0.048);                             // legs, knees soft
      put(K, new THREE.BoxGeometry(0.095, 0.07, 0.25), foot[0], DECK_Y + 0.035, foot[2] - 0.05, new THREE.Euler(0, s < 0 ? 0 : -0.45, 0));   // shoes: front foot straight, back foot turned out
    }
    put(H, new THREE.SphereGeometry(0.125, 14, 10), 0, 1.95, -0.04, null, 0.92, 1.05, 1); put(H, new THREE.SphereGeometry(0.132, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), 0, 1.96, -0.03, new THREE.Euler(0.35, 0, 0), 0.95, 1, 1.05);                                 // bare head, casual (no helmet)
    const mats2 = { J: new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.8, metalness: 0.02 }), D: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 }), K: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }), H: new THREE.MeshStandardMaterial({ color: 0xc8906a, roughness: 0.75 }) };
    STANDER = [[merged(J), mats2.J], [merged(D), mats2.D], [merged(K), mats2.K], [merged(H), mats2.H]];
  }
  const g = new THREE.Group(); g.name = 'rider:standing';
  for (const [geo, mat] of STANDER) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); }
  return g;
}

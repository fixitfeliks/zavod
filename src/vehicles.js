// Rideable vehicles: motorcycles + drivable cars (stolen off the kerb in hangout mode). Owned by: VEHICLES agent. See CONTRACT.md "Vehicles".
// Runs BEFORE player: while ctx.player.mounted is set this module drives player position/yaw/pitch and the camera.
// Physics: arcade single-track model shared by bikes and cars (per-spec tuning), variable sub-steps ≤ 1/120 s so handling is
// identical at 30/60/120 fps; tyre grip as lateral-slip decay (handbrake drops rear grip → slides), surface grip (sand),
// ground follow with ramp launch, circle-vs-AABB collisions. Cameras: first person (driver's seat / on the bike) and a
// third-person chase cam (V key / CAM button) with wall avoidance. Running people over: ctx.ai.damage for local soldiers,
// bus 'vehicleHit' {peerId, speed, damage, point} for remote players (net.js turns it into a hit).
import { damageHit, damageShot, crashFx, updateDamage, isWrecked, damageState, toggleWindow, windowOpen, swingDoor, qaSmokeActive, hitPane, detach } from './vehicledamage.js';
import * as THREE from 'three';
import { buildBike, buildRider, WHEEL_R, WHEELBASE, FRONT_Z, REAR_Z } from './vehicles/bike.js';
import { buildEbike, buildCyclist } from './vehicles/ebike.js';
import { buildScooter, buildStandingRider, buildMopedRider } from './vehicles/scooter.js';
import { buildJetski } from './vehicles/jetski.js';
import { createWaterFX } from './vehicles/waterfx.js';
import { BoxGrid, resolveCircle, rectBlocked, segmentHit } from './vehicles/collide.js';
import { carGeometries, carMaterials, carSpec, carEye, carInterior, wheelGeometry, wheelLayout, caliperGeometry, hideParkedCar, dropParkedCarBoxes, carBoxes, gaugeNeedle } from './world/carkit.js';
import { hasCarModel, carModel, isKitModel } from './world/carmodels.js';
import { buildBus, BUS } from './vehicles/bus.js';
import { BRI } from './world/coney/brighton.js';
import { kit as hangkitKit } from './world/hangkit.js';

const DEG = Math.PI / 180;
const LOOK_PITCH = 35 * DEG, LEAN_MAX = 12 * DEG;
const VR_LEAN_MAX = 5 * DEG;   // VR: the bike you sit on (and the bars in your hands) leans at most this far; the view never rolls
const CAM_PROBE = 0.4, TOUCH_CRUISE = 0.45;
const CHASE_DIP_ACC = 10, CHASE_DIP_H = 0.15, CHASE_DIP_LOOK = 0.4;   // chase cam: nose-down dip on hard braking, a lift on launch (m per 10 m/s^2 of aLong, capped)   // chase cam side-ray half spacing (m); car throttle while steering on the stick
const FOV_KICK = 9, BOUNCE = 0.28, HIT_LOSS = 0.55, GRAV = 17, MAX_STEP = 1 / 120;
const BIKE_EJECT_VN = 8;   // m/s closing speed into a crash that throws the rider off a motorcycle / e-bike
// ---- per-vehicle handling + rider geometry ----
// accel: launch acceleration (v = max·tanh(a·t/max)); brake/hard: service brake / handbrake decel; grip: lateral slip decay /s
// (hardGrip while the handbrake is on); latG: cornering limit in g (caps steering angle with speed); circles: collision circles
// along the body (local z, - = front); band: collide with boxes whose top is above pos.y+band (lower ones are driven over);
// eyeH/eyeBack/eyeSide: first-person eye above the ground / behind centre / right of centre; reach: mount distance from the body.
const BIKE_SPEC = {
  car: false, kind: 'bike', max: 22, revMax: 4.5, accel: 9.5, brake: 11, hard: 17, hardYaw: 0.9, grip: 16, hardGrip: 4, latG: 1.25, steerLow: 0.42,
  wheelbase: WHEELBASE, circles: [FRONT_Z, REAR_Z], bodyR: 0.42, band: 0.5, stepUp: 0.5, h: 1.25, leanK: 1,
  eyeH: 1.43, eyeBack: 0.34, eyeSide: 0, reach: 1.2, hx: 0.45, hz: 1.05, boxH: 1.1, lookYaw: 60 * DEG,
  chaseD: 4.4, chaseH: 0.32, chaseLook: 1.45, hitMul: 8, hitSlow: 0.75, engineBrake: 0.6,
};
// e-bikes (delivery cargo bike / Citi Bike-style): the same arcade single-track model as BIKE_SPEC, tuned down (lower top
// speed + gentler accel, a real throttle-limited e-bike, not a motorcycle) and lighter still (mass < MASS_BIKE below).
const EBIKE_BASE = {
  car: false, kind: 'ebike', max: 11, revMax: 3, accel: 5, brake: 8, hard: 10, hardYaw: 0.7, grip: 14, hardGrip: 5, latG: 1.1, steerLow: 0.5,
  wheelbase: 1.15, circles: [-0.58, 0.58], bodyR: 0.36, band: 0.45, stepUp: 0.4, h: 1.05, leanK: 0.9,
  eyeH: 1.28, eyeBack: 0.28, eyeSide: 0, reach: 1.1, hx: 0.4, hz: 0.9, boxH: 1.0, lookYaw: 60 * DEG,
  chaseD: 4.0, chaseH: 0.3, chaseLook: 1.3, hitMul: 5, hitSlow: 0.8, engineBrake: 0.8, mass: 120,
};
const EBIKE_CITI_SPEC = { ...EBIKE_BASE, kind: 'ebike_citi' };
const EBIKE_DELIVERY_SPEC = { ...EBIKE_BASE, kind: 'ebike_delivery', max: 10, accel: 4.3, mass: 150 };
// kick scooter: slow, twitchy, a standing rider (reach is short - it's barely bigger than the deck). Vespa-like moped: a real
// seated step-through, quicker than the e-bikes but still well under a motorcycle.
const SCOOTER_KICK_SPEC = {
  car: false, kind: 'scooter_kick', max: 6, revMax: 2, accel: 3, brake: 6, hard: 7, hardYaw: 0.55, grip: 11, hardGrip: 4, latG: 0.9, steerLow: 0.6,
  wheelbase: 0.78, circles: [-0.42, 0.36], bodyR: 0.22, band: 0.3, stepUp: 0.3, h: 0.7, leanK: 0.7,
  eyeH: 1.1, eyeBack: 0.2, eyeSide: 0, reach: 0.9, hx: 0.3, hz: 0.6, boxH: 0.75, lookYaw: 55 * DEG,
  chaseD: 3.4, chaseH: 0.26, chaseLook: 1.1, hitMul: 4, hitSlow: 0.85, engineBrake: 0.9, mass: 90,
};
const SCOOTER_MOPED_SPEC = {
  car: false, kind: 'scooter_moped', max: 14, revMax: 3.2, accel: 5.5, brake: 8.5, hard: 10, hardYaw: 0.7, grip: 13, hardGrip: 4.5, latG: 1.05, steerLow: 0.5,
  wheelbase: 1.22, circles: [-0.62, 0.6], bodyR: 0.34, band: 0.42, stepUp: 0.4, h: 1.0, leanK: 0.95,
  eyeH: 1.2, eyeBack: 0.26, eyeSide: 0, reach: 1.1, hx: 0.42, hz: 0.92, boxH: 1.0, lookYaw: 60 * DEG,
  chaseD: 3.9, chaseH: 0.3, chaseLook: 1.25, hitMul: 5, hitSlow: 0.8, engineBrake: 0.85, mass: 115,
};
// jet ski: bike-style lean + throttle + Space charge-jump, but floats on the ocean's waveHeight (buoyancy spring), jet-thrust
// steering (little bite off the throttle), slides like a boat, stalls when the intake runs out of water (beached).
const JETSKI_SPEC = {
  car: false, kind: 'jetski', water: true, max: 21, revMax: 3.5, accel: 8.5, brake: 7, hard: 0, hardYaw: 0, grip: 2.6, hardGrip: 1, latG: 0.95, steerLow: 0.5,
  wheelbase: 1.6, circles: [-0.95, 0, 0.95], bodyR: 0.55, band: 0.2, stepUp: 0.3, h: 1.3, leanK: 1.5,
  eyeH: 1.45, eyeBack: 0.45, eyeSide: 0, reach: 1.6, hx: 0.6, hz: 1.6, boxH: 1.0, lookYaw: 70 * DEG,
  chaseD: 5.2, chaseH: 0.3, chaseLook: 1.3, hitMul: 7, hitSlow: 0.75, engineBrake: 0, draft: 0.12,
};
// cars (qa/drive-feel-test.mjs holds the arcade targets): ~5 s to 60 mph, ~80 mph top, 60-0 in ~35 m, a handbrake slide that
// holds ~50 deg and keeps some pace. aero: v² drag coefficient (bikes 0.0024); steerIn/steerOut: steering filter rate at rest
// (steerIn eases to steerInHi at top speed so the lock comes on gently on the motorway); wallMu: friction along a wall per unit of
// impact speed (a glance slides, a head-on stops); climb: fastest kerb / step rise (m/s) at walking pace.
const CAR_BASE = {
  car: true, max: 37, revMax: 7, accel: 7.6, brake: 9.4, hard: 1.6, hardYaw: 0.5, grip: 13, hardGrip: 2.1, latG: 1.05, steerLow: 0.6,
  aero: 0.0008, steerIn: 13, steerInHi: 8, steerOut: 11, wallMu: 0.3, climb: 3.5,
  band: 0.28, stepUp: 0.36, leanK: -0.2, lookYaw: 110 * DEG, chaseD: 6.8, chaseH: 0.3, chaseLook: 1.6, hitMul: 12, hitSlow: 0.9, engineBrake: 1.4,
};
const CAR_SPECS = {};
// a hijacked MTA bus: slow, heavy, wide; the driver sits high up front on the left
const BUS_SPEC = { ...CAR_BASE, kind: 'bus', max: 17, revMax: 4, accel: 3.2, brake: 7, hard: 4, hardYaw: 0.5, grip: 9, hardGrip: 2, latG: 0.6, steerLow: 0.62, steerIn: 6, steerInHi: 4, steerOut: 7, climb: 2.5,
  wheelbase: BUS.axleF - BUS.axleR, circles: [-4.7, -1.6, 1.6, 4.7], bodyR: 1.28, h: 3.2, eyeH: BUS.eye.y, eyeBack: -BUS.eye.x, eyeSide: BUS.eye.z, reach: 1.9,
  hx: BUS.w / 2, hz: BUS.len / 2, boxH: 3.2, chaseD: 15, chaseH: 0.32, chaseLook: 2.9, hitMul: 18, hitSlow: 0.95, engineBrake: 1.0 };
function carSpecFor(kind) {
  if (kind === 'bus') return BUS_SPEC;
  if (CAR_SPECS[kind]) return CAR_SPECS[kind];
  const K = carSpec(kind) || carSpec('sedan'), hw = K.w / 2, hl = K.len / 2, e = carEye(kind);
  return (CAR_SPECS[kind] = { ...CAR_BASE, kind, wheelbase: K.wheels[0] - K.wheels[1], circles: [-(hl - hw), 0, hl - hw], bodyR: hw, h: K.roof,
    eyeH: e.y, eyeBack: -e.x, eyeSide: e.z, reach: 1.4, hx: hw + 0.05, hz: hl, boxH: K.roof, ...(K.sport ? { max: 46, accel: 10.5, grip: 15, latG: 1.25, revMax: 8.5 } : {}) });   // sports cars: faster, grippier
}
// surfaces: sand is slow + slippery, grass/dirt a little
const SURF = { hard: { max: 1, accel: 1, grip: 1, drag: 0, rumble: 0 }, soft: { max: 0.8, accel: 0.85, grip: 0.75, drag: 0.8, rumble: 0.3 }, sand: { max: 0.5, accel: 0.7, grip: 0.45, drag: 2.2, rumble: 1 } };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _res = { x: 0, z: 0, nx: 0, nz: 0, depth: 0, hit: false };

let C = null; // ctx
const SAFE_GRID_CELL = 8;   // m
const S = {
  grid: new BoxGrid(4), bikes: [], mounted: null, api: null,
  // rider view
  lookYaw: 0, lookPitch: 0, wroteYaw: 0, wrotePitch: 0, idleT: 0, roll: 0, vib: 0, fovBase: 75, fovWritten: -1, prevSlot: null, mountT: 0,
  toastT: 0, revT: 0, qa: null, uiMount: false,
  chase: false, chaseYaw: 0, chaseY: 0, chaseD: 0, vmHidden: false, hits: new Map(), ui: null,
};

function groundY(x, z) { const g = C.world?.groundHeight; return g ? g(x, z) : 0; }
/** Floor under (x,z) for something currently at height yRef: highest of world.groundHeight / collider tops that is ≤ yRef+stepUp; keeps yRef when nothing qualifies (multi-level maps whose groundHeight reports the level above). */
function floorAt(x, z, yRef, skip = null, stepUp = 0.5) {
  let best = -Infinity; const gy = groundY(x, z); if (gy <= yRef + stepUp) best = gy;
  const boxes = S.grid.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
  for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; if (b === skip) continue; if (b.min.x > x + 0.3 || b.max.x < x - 0.3 || b.min.z > z + 0.3 || b.max.z < z - 0.3) continue; const t = b.max.y; if (t <= yRef + stepUp && t > best && b.min.y < t) best = t; }
  return best === -Infinity ? yRef : best;
}
/** the bounds that apply at (x, z): an extra zone's rect (coney's Belt Parkway) when inside one, else the map's */
/** inside the play area (the map plus its extra zones, seams included: world.js playClamp), `pad` in from the outer edge */
function inBounds(x, z, pad = 1) { const W = C.world; if (!W?.playClamp) return true; const [cx, cz] = W.playClamp(x, z, pad); return cx === x && cz === z; }

function baseState(x, z, yaw, yRef) {
  const y = floorAt(x, z, yRef);
  return { home: { x, z, yaw, y }, pos: new THREE.Vector3(x, y, z), vy: 0, air: false, heading: yaw, vel: new THREE.Vector3(), speed: 0, fwdSpeed: 0,
    steer: 0, lean: 0, susp: 0, suspV: 0, spin: 0, skid: 0, throttle: 0, brakeK: 0, parked: true, box: new THREE.Box3(), hitT: 0,
    tPitch: 0, tRoll: 0, aLong: 0, surf: SURF.hard, surfT: 0, groundVy: 0 };
}

// ---------- bike object ----------
function makeBike(x, z, yaw, yRef = 0) {
  const parts = buildBike(C);
  const bike = { ...parts, ...baseState(x, z, yaw, yRef), spec: BIKE_SPEC, rider: null };
  bike.group.position.copy(bike.pos); bike.group.rotation.y = yaw;
  for (const m of bike.meshes) { m.userData.vehicle = bike; C.raycastTargets.push(m); }
  C.scene.add(bike.group);
  parkBox(bike); C.colliders.push(bike.box);
  S.bikes.push(bike);
  return bike;
}
/** A stealable e-bike parked at (x, z): a Citi Bike-style dock bike or a delivery cargo bike. Rides through the same
 *  spec-driven physics as a motorcycle (mount()/dismount()/stepVeh don't care which non-car spec they're driving). */
function makeEbike(x, z, yaw, variant = 'citibike', yRef = 0) {
  const parts = buildEbike(C, variant), spec = variant === 'delivery' ? EBIKE_DELIVERY_SPEC : EBIKE_CITI_SPEC;
  const bike = { ...parts, ...baseState(x, z, yaw, yRef), spec, mass: spec.mass, rider: null };
  bike.group.position.copy(bike.pos); bike.group.rotation.y = yaw;
  for (const m of bike.meshes) { m.userData.vehicle = bike; C.raycastTargets.push(m); }
  C.scene.add(bike.group);
  parkBox(bike);   // not pushed into C.colliders: a small parked dock bike, dropped near a spawn, shouldn't ever block the map's
  // broader pathing/placement checks (OSM footpaths, patrol routes) - other vehicles can roll through a parked one, same as before it existed
  S.bikes.push(bike);
  return bike;
}
/** A stealable scooter parked at (x, z): a kick scooter or a Vespa-like moped. Rides through the same spec-driven physics
 *  as a motorcycle / e-bike (mount()/dismount()/stepVeh don't care which non-car spec they're driving). */
function makeScooter(x, z, yaw, variant = 'kick', yRef = 0) {
  const parts = buildScooter(C, variant), spec = variant === 'moped' ? SCOOTER_MOPED_SPEC : SCOOTER_KICK_SPEC;
  const bike = { ...parts, ...baseState(x, z, yaw, yRef), spec, mass: spec.mass, rider: null };
  bike.group.position.copy(bike.pos); bike.group.rotation.y = yaw;
  for (const m of bike.meshes) { m.userData.vehicle = bike; C.raycastTargets.push(m); }
  C.scene.add(bike.group);
  parkBox(bike);   // not pushed into C.colliders, same as a parked dock e-bike: a scooter on the sidewalk shouldn't block the
  // map's broader pathing/placement checks - other vehicles can roll through a parked one
  S.bikes.push(bike);
  return bike;
}
/** A jet ski floating at (x, z) (moored in the shallows / off the pier). */
function makeJetski(x, z, yaw, i = 0) {
  const parts = buildJetski(C, null, i), O = C.world?.ocean;
  const y = O ? O.waveHeight(x, z) - JETSKI_SPEC.draft : 0;
  const ski = { ...parts, ...baseState(x, z, yaw, y), spec: JETSKI_SPEC, rider: null };
  ski.pos.y = y; ski.home.y = y;
  ski.group.position.copy(ski.pos); ski.group.rotation.y = yaw;
  for (const m of ski.meshes) { m.userData.vehicle = ski; C.raycastTargets.push(m); }
  C.scene.add(ski.group); parkBox(ski); C.colliders.push(ski.box); S.bikes.push(ski);
  return ski;
}
/** A drivable car from the shared car kit (geometry faces +x in the kit; vehicles face -z, so the kit is turned +90 deg).
 *  wantPanels: false for a car that starts live but isn't being driven or damaged yet (hangout's red car, the Soviet
 *  classics parked by it) - cheap, merged body like a parked/traffic car; ensurePanels() splits it the first time it's
 *  actually driven or hit, same as a promoted parked car. */
function makeCar(x, z, yaw, kind = 'sedan', color = 0x22305c, yRef = 0, wantPanels = true) {
  if (!carSpec(kind) && kind !== 'bus') kind = 'sedan';
  const CM = carMaterials();
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const kit = new THREE.Group(); kit.rotation.y = Math.PI / 2; body.add(kit);     // kit frame (+x front) → vehicle frame (-z front)
  const meshes = []; const paint = CM.paint.clone(); paint.color = new THREE.Color(color);
  const lampR = CM.lampR.clone(), lampW = CM.lampW.clone(); lampR.emissive = new THREE.Color(0xff1a0a); lampR.emissiveIntensity = 0.08; lampW.emissive = new THREE.Color(0xfff0d0); lampW.emissiveIntensity = 0.05;
  // glass cloned per car (not the shared kit material): the hotbox haze tints one car's own windows milky from the outside
  // without fogging every other car sharing the same base material
  const mat = { paint, lampR, lampW, glass: (CM.glassSee || CM.glass).clone() };   // see-through: the cabin (and whoever's in it) shows
  let tyreR = 0.33, cab, wheels = null, busKit = null, panels = null, panes = null, geos = null, bodyMesh = null;
  if (kind === 'bus') { const B = buildBus({ sign: 'NOT IN SERVICE', lite: !!C.lite }); busKit = B; kit.add(B.group); for (const m of B.meshes) if (m.parent !== B.interior) meshes.push(m); cab = { wheel: new THREE.Group() }; }
  else if (hasCarModel(kind) && !isKitModel(kind)) { const mdl = carModel(kind, color); kit.add(mdl); mdl.traverse((o) => { if (o.isMesh && o.name !== 'aoShadow') meshes.push(o); }); cab = { wheel: new THREE.Group() }; }   // a real model (with its own cabin); the street models (KIT) go live as the carkit build, panels and all
  else { const kitG = carGeometries(kind, { wheels: false, panels: wantPanels }), panelGeos = kitG.panels || {}; geos = kitG.geos;
    bodyMesh = {};
    for (const [slot, g] of Object.entries(geos)) { if (!g) continue; const m = new THREE.Mesh(g, mat[slot] || CM[slot]); m.castShadow = slot === 'paint'; m.receiveShadow = true; m.userData.surface = 'metal'; if (slot === 'glass') m.userData.noDent = true; kit.add(m); meshes.push(m); if (slot === 'paint' || slot === 'glass') bodyMesh[slot] = m; }
    cab = carInterior(kind, geos); kit.add(cab.group);
    if (wantPanels) {
      // the split body (vehicledamage.js): each panel / pane on a pivot at its hinge, so it can hang, swing ajar or come off
      panels = {}; panes = {};
      for (const [n, g] of Object.entries(panelGeos)) { const glass = n.startsWith('glass'); g.computeBoundingBox(); const bb = g.boundingBox, ctr = bb.getCenter(new THREE.Vector3());
        const hinge = n.startsWith('door') ? new THREE.Vector3(bb.max.x, ctr.y, ctr.z) : n === 'hood' ? new THREE.Vector3(bb.min.x, bb.max.y, 0) : n === 'trunk' ? new THREE.Vector3(bb.max.x, bb.max.y, 0) : ctr.clone();
        const doorOf = glass && /^glass[FR][LR]$/.test(n) ? 'door' + n.slice(5) : null, host = doorOf && panels[doorOf] ? panels[doorOf].pivot : null;
        let pivot = host; if (!pivot) { pivot = new THREE.Group(); pivot.position.copy(hinge); pivot.userData.home = hinge.clone(); kit.add(pivot); }
        const m = new THREE.Mesh(g, glass ? mat.glass : paint); m.position.copy(pivot.userData.home).negate(); m.castShadow = !glass; m.receiveShadow = true; m.userData.surface = glass ? 'glass' : 'metal'; pivot.add(m); meshes.push(m);
        if (glass) { m.userData.pane = true; panes[n] = { mesh: m, ctr, state: 0 }; if (doorOf && panels[doorOf]) (panels[doorOf].glass ||= []).push(n); }
        else { const shell = cab.panelShells?.[n]; if (shell) { shell.removeFromParent(); shell.position.copy(m.position); pivot.add(shell); }
          panels[n] = { mesh: m, shell, pivot, ctr, state: 0 }; } }
    }
    // the wheels: their own meshes on pivots (kit frame), so they roll with the distance driven and the fronts steer (visuals()); the calipers stay put on the pivot
    const lay = wheelLayout(kind), wg = wheelGeometry(lay.r, lay.style); tyreR = lay.r;
    wheels = lay.wheels.map((w) => { const pivot = new THREE.Group(); pivot.position.set(w.x, w.y, w.z); kit.add(pivot); const flip = new THREE.Group(); if (w.side < 0) flip.rotation.y = Math.PI; pivot.add(flip);
      const spin = new THREE.Group(); flip.add(spin); for (const slot of ['rubber', 'rim', 'trim']) { const m = new THREE.Mesh(wg[slot], CM[slot]); m.castShadow = slot === 'rubber'; m.userData.surface = 'metal'; m.userData.noDent = true; spin.add(m); meshes.push(m); }
      const cal = new THREE.Mesh(caliperGeometry(lay.r, w.x > 0 ? 1 : -1), CM.caliper); cal.userData.noDent = true; flip.add(cal);
      return { pivot, spin, front: w.x > 0, side: w.side }; }); }
  const sp = carSpecFor(kind);
  // the bus and the real models have no wheel of ours in their cabin: an invisible one where the driver's hands go (VR grabs it:
  // src/vr/physical.js), turning about the car's forward axis like the procedural ones turn about their column
  if (!cab.wheel.parent) { const col = new THREE.Group(); col.rotation.y = Math.PI / 2; col.position.set(sp.eyeSide, sp.eyeH - 0.42, sp.eyeBack - 0.42); body.add(col); col.add(cab.wheel); }
  const headlight = new THREE.SpotLight(0xfff2d8, 0, 55, 0.5, 0.5, 1.4); headlight.position.set(0, 0.8, -sp.hz + 0.1); headlight.target.position.set(0, 0, -16); group.add(headlight); group.add(headlight.target); headlight.visible = false;
  const lens = { material: lampW };
  const dummy = new THREE.Group();
  const car = { group, body, fork: dummy, wheelF: dummy, wheelR: dummy, carWheels: wheels, busKit, headlight, lens, lampR, meshes, kind, color, steerWheel: cab.wheel, cabin: cab.group || null, kit, panels, panes, tyreR, needles: cab.needles || null, mass: massOf(kind), bodyMesh, mat, ...baseState(x, z, yaw, yRef), spec: sp };
  group.position.copy(car.pos); group.rotation.y = yaw;
  for (const m of meshes) { m.userData.vehicle = car; C.raycastTargets.push(m); }
  C.scene.add(group); parkBox(car); C.colliders.push(car.box); S.bikes.push(car); rebuildGrids();
  return car;
}
/** split a live car's merged body into panels the first time it's driven or damaged (mount() / onShot() / shove() call this):
 *  swaps the merged paint/glass for the panel-geometry remainder and adds the hood/trunk/fender/door/bumper pivots and panes.
 *  No-op once split, and for the bus / a real model (no kit panels to begin with). */
function ensurePanels(car) {
  if (!car || car.panels || !car.bodyMesh || !car.kit) return;
  const kitG = carGeometries(car.kind, { wheels: false, panels: true }), panelGeos = kitG.panels || {};
  if (!Object.keys(panelGeos).length) return;
  for (const slot of ['paint', 'glass']) {
    const old = car.bodyMesh[slot], g = kitG.geos[slot]; if (!old || !g) continue;
    old.removeFromParent(); const mi = car.meshes.indexOf(old); if (mi > -1) car.meshes.splice(mi, 1); const ri = C.raycastTargets.indexOf(old); if (ri > -1) C.raycastTargets.splice(ri, 1);
    const m = new THREE.Mesh(g, car.mat[slot] || car.mat.paint); m.castShadow = slot === 'paint'; m.receiveShadow = true; m.userData.surface = 'metal'; m.userData.vehicle = car; if (slot === 'glass') m.userData.noDent = true;
    car.kit.add(m); car.meshes.push(m); car.bodyMesh[slot] = m; C.raycastTargets.push(m);
  }
  const panels = {}, panes = {};
  for (const [n, g] of Object.entries(panelGeos)) { const glass = n.startsWith('glass'); g.computeBoundingBox(); const bb = g.boundingBox, ctr = bb.getCenter(new THREE.Vector3());
    const hinge = n.startsWith('door') ? new THREE.Vector3(bb.max.x, ctr.y, ctr.z) : n === 'hood' ? new THREE.Vector3(bb.min.x, bb.max.y, 0) : n === 'trunk' ? new THREE.Vector3(bb.max.x, bb.max.y, 0) : ctr.clone();
    const doorOf = glass && /^glass[FR][LR]$/.test(n) ? 'door' + n.slice(5) : null, host = doorOf && panels[doorOf] ? panels[doorOf].pivot : null;
    let pivot = host; if (!pivot) { pivot = new THREE.Group(); pivot.position.copy(hinge); pivot.userData.home = hinge.clone(); car.kit.add(pivot); }
    const m = new THREE.Mesh(g, glass ? car.mat.glass : car.mat.paint); m.position.copy(pivot.userData.home).negate(); m.castShadow = !glass; m.receiveShadow = true; m.userData.surface = glass ? 'glass' : 'metal'; m.userData.vehicle = car; pivot.add(m); car.meshes.push(m); C.raycastTargets.push(m);
    if (glass) { m.userData.pane = true; panes[n] = { mesh: m, ctr, state: 0 }; if (doorOf && panels[doorOf]) (panels[doorOf].glass ||= []).push(n); }
    else panels[n] = { mesh: m, shell: null, pivot, ctr, state: 0 }; }
  car.panels = panels; car.panes = panes;
}
function parkBox(v) {
  const c = Math.cos(v.heading), s = Math.sin(v.heading), sp = v.spec;
  const hx = Math.abs(c) * sp.hx + Math.abs(s) * sp.hz, hz = Math.abs(s) * sp.hx + Math.abs(c) * sp.hz;
  v.box.min.set(v.pos.x - hx, v.pos.y, v.pos.z - hz); v.box.max.set(v.pos.x + hx, v.pos.y + sp.boxH, v.pos.z + hz);
}
function unparkBox(v) { v.box.min.set(0, -9999, 0); v.box.max.set(0.001, -9998, 0.001); rebuildGrids(); }
function rebuildGrids() { S.grid.build(C.colliders); try { C.player?.rebuildColliders?.(); } catch {} }
let _nb = null;
/** small nitro gauge above the ammo counter while driving */
function nitroBar(f, on) {
  if (!_nb) { _nb = document.createElement('div'); _nb.style.cssText = 'position:fixed;right:24px;bottom:120px;width:120px;height:6px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);z-index:40;pointer-events:none'; _nb.innerHTML = '<i style="display:block;height:100%;background:#4fc3ff"></i><b style="position:absolute;right:0;top:-15px;font:700 10px Barlow Condensed,Arial;letter-spacing:.2em;color:#cfe3ff">NITRO</b>'; document.body.appendChild(_nb); }
  _nb.style.display = S.mounted ? 'block' : 'none'; const i = _nb.firstChild; i.style.width = `${Math.round(f * 100)}%`; i.style.background = on > 0.3 ? '#ffb24a' : '#4fc3ff';
}
function fwdOf(h, out) { return out.set(-Math.sin(h), 0, -Math.cos(h)); }
let _haze = null;
/** cheap screen-space haze while you're hotboxing: a flat light-grey div over everything (same trick as hangkit.js's high/
 *  drunk cv.style.filter, but a plain overlay reads better for smoke than a CSS filter would), opacity tracking car.haze. */
function hazeOverlay(level) {
  if (!_haze) { _haze = document.createElement('div'); _haze.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;background:#dcdcd6;display:none'; document.body.appendChild(_haze); }
  if (level > 0.015) { _haze.style.display = 'block'; _haze.style.opacity = Math.min(0.85, 0.08 + level).toFixed(3); } else _haze.style.display = 'none';
}

// ---------- placement ----------
function spotFree(x, z, yRef = 0, ignoreBox = null) {
  if (!inBounds(x, z, 2.5)) return false;
  const y = floorAt(x, z, yRef);
  if (Math.abs(y - yRef) > 0.02) return false; // same level as the spawn it belongs to (not on rails / kerbs / steps)
  if (rectBlocked(S.grid, x - 1.6, z - 1.6, x + 1.6, z + 1.6, y + 0.15, y + 1.6, ignoreBox)) return false;
  for (const b of S.bikes) if (Math.hypot(b.pos.x - x, b.pos.z - z) < 3.2) return false;
  for (const s of C.world?.playerSpawns || []) if (Math.hypot(s.x - x, s.z - z) < 1.8) return false;
  return true;
}
function placeBikes() {
  const W = C.world; S.grid.build(C.colliders);
  const spots = Array.isArray(W?.vehicleSpots) ? W.vehicleSpots : null;
  if (spots && spots.length) { for (const s of spots.slice(0, W.vehicleMax || 5)) makeBike(s.x, s.z, s.yaw ?? 0, s.y ?? 0); if (S.bikes.length >= 3) return placeExtras(); }   // maps may raise the cap via W.vehicleMax
  const spawns = (W?.playerSpawns?.length ? W.playerSpawns : [new THREE.Vector3(0, 0, 0)]);
  const want = 5, R = C.rng, MIN_APART = 25;
  // candidates = every walkable anchor the map exposes (player spawns, enemy spawns, cover points) → bikes dispersed over the whole map
  const anchors = [...spawns, ...(W?.enemySpawns || []), ...((W?.coverPoints || []).map(c => c.position))].filter(v => v && Math.abs(v.y || 0) < 0.15);
  const farFromBikes = (x, z) => S.bikes.every(b => Math.hypot(b.group.position.x - x, b.group.position.z - z) >= MIN_APART);
  const tryAt = (ax, az, ay) => { for (let k = 0; k < 12; k++) { const a = R() * Math.PI * 2, d = 2 + R() * 4; const x = ax + Math.cos(a) * d, z = az + Math.sin(a) * d; if (!spotFree(x, z, ay) || !farFromBikes(x, z)) continue; const cx = W?.bounds ? (W.bounds.min.x + W.bounds.max.x) / 2 : 0, cz = W?.bounds ? (W.bounds.min.z + W.bounds.max.z) / 2 : 0; makeBike(x, z, Math.atan2(-(cx - x), -(cz - z)) + (R() - 0.5) * 0.9, ay || 0); return true; } return false; };
  const s0 = spawns[Math.floor(R() * spawns.length)]; tryAt(s0.x, s0.z, s0.y);
  const pool = anchors.slice().sort(() => R() - 0.5);
  let tries = 0;
  while (S.bikes.length < want && tries++ < 300 && pool.length) {
    let best = null, bd = -1; for (const a of pool) { let d = Infinity; for (const b of S.bikes) d = Math.min(d, Math.hypot(b.group.position.x - a.x, b.group.position.z - a.z)); if (d > bd) { bd = d; best = a; } }
    if (!best) break; pool.splice(pool.indexOf(best), 1); if (bd < MIN_APART) continue; tryAt(best.x, best.z, best.y);
  }
  for (let d = 3; S.bikes.length < 3 && d < 30; d += 1.5) for (let i = 0; i < 16 && S.bikes.length < 3; i++) { const a = i / 16 * Math.PI * 2; const x = s0.x + Math.cos(a) * d, z = s0.z + Math.sin(a) * d; if (spotFree(x, z, s0.y)) makeBike(x, z, a, s0.y || 0); }
  placeExtras();
}
function placeExtras() { placeJetskis(); placeEbikes(); placeScooters(); }
/** A couple of stealable kick scooters and Vespa-like mopeds, dropped on sidewalks / kerbs near the player's spawn (Coney)
 *  and near Brighton Beach Ave (BRI: the avenue's layout, imported from the map so a sidewalk-side anchor is cheap to pick
 *  without re-deriving it here) - both kinds show up in both areas, same loose scatter as placeEbikes(). */
function placeScooters() {
  const W = C.world; if (W?.mapId !== 'coney') return;
  const R = C.rng || Math.random;
  const spawns = (W?.playerSpawns?.length ? W.playerSpawns : [new THREE.Vector3(0, 0, 0)]);
  const s0 = spawns[Math.floor(R() * spawns.length)];
  const brX = BRI.X0 + R() * (BRI.X1 - BRI.X0), brZ = BRI.ZC + (R() < 0.5 ? -1 : 1) * (BRI.HALF + BRI.SWK * 0.5);
  const areas = [
    { x: s0.x, z: s0.z, y: s0.y || 0, want: [['kick', 2], ['moped', 1]] },
    { x: brX, z: brZ, y: groundY(brX, brZ), want: [['kick', 1], ['moped', 2]] },
  ];
  for (const area of areas) for (const [variant, n] of area.want) for (let i = 0; i < n; i++) {
    for (let k = 0; k < 16; k++) {
      const a = R() * Math.PI * 2, d = 3 + R() * 10, x = area.x + Math.cos(a) * d, z = area.z + Math.sin(a) * d;
      if (!spotFree(x, z, area.y)) continue;
      makeScooter(x, z, a, variant, area.y); break;
    }
  }
}
/** A couple of stealable e-bikes dropped near the player's spawn (a Citi Bike-style dock bike, a delivery cargo bike):
 *  cheap decoration + one more vehicle to steal, not tied to any particular map's vehicleSpots. */
function placeEbikes() {
  const W = C.world; if (W?.mapId !== 'coney') return;   // dock e-bikes are a NYC/Coney thing; other maps keep their plain motorcycle count
  const spawns = (W?.playerSpawns?.length ? W.playerSpawns : [new THREE.Vector3(0, 0, 0)]);
  const R = C.rng || Math.random, s0 = spawns[Math.floor(R() * spawns.length)];
  for (const [variant, n] of [['citibike', 2], ['delivery', 1]]) for (let i = 0; i < n; i++) {
    for (let k = 0; k < 16; k++) {
      const a = R() * Math.PI * 2, d = 4 + R() * 10, x = s0.x + Math.cos(a) * d, z = s0.z + Math.sin(a) * d;
      if (!spotFree(x, z, s0.y || 0)) continue;
      makeEbike(x, z, a, variant, s0.y || 0); break;
    }
  }
}

function placeJetskis() { const L = C.world?.jetskiSpots; if (!C.world?.ocean || !Array.isArray(L)) return; L.forEach((s, i) => makeJetski(s.x, s.z, s.yaw ?? Math.PI, i)); }

// ---------- mount / dismount ----------
/** the driver's own side (carEye's z sign: negative = the US driver's seat, left side) */
function driverSide(bike) { return bike.spec.eyeSide < 0 ? 'L' : 'R'; }
function driverPane(bike) { return 'glassF' + driverSide(bike); }
function driverDoor(bike) { return 'doorF' + driverSide(bike); }
function setRaycastable(v, on) {
  const T = C.raycastTargets;
  for (const m of v.meshes) { const i = T.indexOf(m); if (on && i < 0) T.push(m); else if (!on && i > -1) T.splice(i, 1); }
}
function mount(bike) {
  const p = C.player; if (!bike || !p || S.mounted || p.mounted || isWrecked(bike)) return false;
  S.mounted = bike; p.mounted = bike; bike.parked = false; unparkBox(bike);
  if (bike.spec.car) { ensurePanels(bike); swingDoor(bike, driverDoor(bike)); }   // driving it: splits the body into damageable panels if it started merged (hangout's red car, Soviet classics); a short hinge pulse as you get in
  setRaycastable(bike, false);   // your own vehicle never eats your bullets (chase cam rays pass through it)
  bike.headlight.visible = true; bike.headlight.intensity = 260; bike.lens.material.emissiveIntensity = bike.spec.car ? 1.2 : 3.5;
  S.lookYaw = clamp(wrap(p.yaw - bike.heading), -bike.spec.lookYaw, bike.spec.lookYaw); S.lookPitch = clamp(p.pitch, -LOOK_PITCH, LOOK_PITCH);
  S.idleT = 0; S.roll = 0; S.mountT = 0; S.vib = 0; S.chaseDip = 0; S.chaseYaw = bike.heading; S.chaseY = bike.pos.y; S.chaseD = bike.spec.chaseD;
  S.fovBase = C.settings.fov; S.fovWritten = -1;
  if (S.chase) setChase(true);
  const w = C.weapons; S.prevSlot = null;
  if (w?.swap) { const cur = w.current?.slot ?? w.slot ?? 0; if (cur !== 1) { try { if (w.swap(1)) S.prevSlot = cur; } catch {} } }
  try { C.audio?.play?.('bike_idle', { position: bike.pos, volume: 0.6 }); } catch {}
  C.bus.emit('vehicle', { stage: 'mount', bike });
  C.hud?.toast?.(bike.spec.car ? 'F — GET OUT · W/S GAS/BRAKE · A/D STEER · SPACE HANDBRAKE · V CAMERA · O WINDOW' : bike.spec.water ? 'F — GET OFF · W THROTTLE · S BRAKE/REVERSE · A/D STEER · SPACE (HOLD) JUMP · V CAMERA' : 'F — DISMOUNT · W/S THROTTLE · SPACE BRAKE · V CAMERA', 2600);
  if (bike.spec.water) { fx().engine(true); }
  applyView(0);
  return true;
}
function dismount() {
  if (_nb) _nb.style.display = 'none';
  const bike = S.mounted, p = C.player; if (!bike || !p) return false;
  const sp = bike.spec;
  fwdOf(bike.heading, _f); _r.set(-_f.z, 0, _f.x);
  const y = bike.pos.y; let placed = false;
  parkBox(bike); rebuildGrids();   // park first so the exit spot is checked against the vehicle's own box too
  // door side first (left), then right, behind, front
  const sx0 = sp.hx + (sp.car ? 0.85 : 0.55), sz0 = sp.hz + 0.7;
  const cands = [[-sx0, sp.car ? -0.3 : 0], [sx0, 0], [0, sz0], [0, -sz0], [-sx0, sz0 * 0.6], [sx0, sz0 * 0.6], [-sx0 - 0.8, 0], [sx0 + 0.8, 0]];
  for (const [sx, sz] of cands) {
    const x = bike.pos.x + _r.x * sx - _f.x * sz, z = bike.pos.z + _r.z * sx - _f.z * sz;
    if (!inBounds(x, z, 0.6)) continue;
    const gy = floorAt(x, z, bike.pos.y, bike.box);
    if (rectBlocked(S.grid, x - 0.4, z - 0.4, x + 0.4, z + 0.4, gy + 0.05, gy + 1.75, null)) continue;
    p.teleport(x, gy, z, bike.heading + S.lookYaw, S.lookPitch); placed = true; break;
  }
  if (!placed) p.teleport(bike.pos.x - _r.x * sx0, y, bike.pos.z - _r.z * sx0, bike.heading + S.lookYaw, S.lookPitch);
  if (sp.water) {
    fx().stop();
    const O = C.world?.ocean, pp = p.position, B = C.world?.bounds;
    if (O && (O.waveHeight(pp.x, pp.z) - pp.y > 1.2 || (B && pp.z > B.max.z - 1))) {   // out of your depth: swim to the nearest beach
      const bx = B ? clamp(pp.x, B.min.x + 3, B.max.x - 3) : pp.x, bz = O.shoreZ(bx) - 3;
      p.teleport(bx, groundY(bx, bz), bz, bike.heading + S.lookYaw, 0); C.hud?.toast?.('SWAM ASHORE', 1600);
    }
  }
  if (sp.car) swingDoor(bike, driverDoor(bike));   // a short hinge pulse as you get out
  p.mounted = null; S.mounted = null;
  if (S.qa) { const q = S.qa; S.qa = null; q.res(false); }   // a crash can force a dismount mid qaDrive (bikeCrash → ejectRider): resolve it, don't hang the caller
  bike.vel.set(0, 0, 0); bike.speed = bike.fwdSpeed = 0; bike.throttle = 0; bike.vy = 0; bike.air = false; bike.parked = true;
  setRaycastable(bike, true);
  bike.headlight.visible = false; bike.headlight.intensity = 0; bike.lens.material.emissiveIntensity = sp.car ? 0.05 : 0.15; if (bike.lampR) bike.lampR.emissiveIntensity = 0.08;
  bike.body.rotation.set(0, 0, 0); bike.body.position.y = 0; bike.lean = 0; bike.tPitch = bike.tRoll = 0; bike.group.rotation.set(0, bike.heading, 0);
  if (bike.rider) bike.rider.visible = false;
  showViewmodel(true);
  if (S.fovWritten > 0 && Math.abs(C.settings.fov - S.fovWritten) < 1e-6) C.settings.fov = S.fovBase; S.fovWritten = -1;
  const w = C.weapons; if (S.prevSlot != null && w?.swap) { try { w.swap(S.prevSlot); } catch {} } S.prevSlot = null;
  C.bus.emit('vehicle', { stage: 'dismount', bike });
  return true;
}
function showViewmodel(on) {
  const vm = C.weapons?.viewmodel; if (!vm) return;
  if (!on) { if (vm.visible) { vm.visible = false; S.vmHidden = true; } }
  else if (S.vmHidden) { vm.visible = true; S.vmHidden = false; }
}

// ---------- physics ----------
function surfaceUnder(v) {
  const W = C.world; let s = 'concrete';
  try { s = W?.surfaceAt?.(v.pos) || s; } catch {}
  if (s === 'sand' || s === 'water' || (s === 'ground' && W?.mapId === 'coney')) return SURF.sand;   // coney: 'ground' = the beach; water: wading (world/maps/maplab.js)
  if (s === 'grass' || s === 'lawn' || s === 'dirt' || s === 'mud' || s === 'gravel') return SURF.soft;
  return SURF.hard;
}
/** One frame of physics, sub-stepped so every step is ≤ 1/120 s (same handling at any frame rate). */
/** push your vehicle out of friends' vehicles (their last networked pose): circles along each body, a soft bounce on contact */
function remoteBump(v) {
  const net = C.net; if (!net?.list || v.spec.water) return; const sp = v.spec, fx = -Math.sin(v.heading), fz = -Math.cos(v.heading);
  for (const id of net.list()) { const q = net.peer(id); if (!q?.veh || q.veh.k === 'pass' || !q.pos || Math.abs(q.pos.y - v.pos.y) > 2.5) continue;
    const dx0 = q.pos.x - v.pos.x, dz0 = q.pos.z - v.pos.z; if (dx0 * dx0 + dz0 * dz0 > 100) continue;
    const os = q.veh.k === 'bike' ? BIKE_SPEC : q.veh.k === 'jetski' ? JETSKI_SPEC : carSpecFor(q.veh.k), ox = -Math.sin(q.heading), oz = -Math.cos(q.heading);
    for (const a of sp.circles) for (const b of os.circles) {
      const ax = v.pos.x - fx * a, az = v.pos.z - fz * a, bx = q.pos.x - ox * b, bz = q.pos.z - oz * b, dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), r = sp.bodyR + os.bodyR;
      if (d >= r || d < 1e-4) continue; const nx = dx / d, nz = dz / d, push = r - d; v.pos.x += nx * push; v.pos.z += nz * push;
      const vn = v.vel.x * nx + v.vel.z * nz; if (vn < 0) { v.vel.x -= 1.5 * vn * nx; v.vel.z -= 1.5 * vn * nz; v.vel.multiplyScalar(0.8); v.hitT = Math.max(v.hitT, 0.15); } } }
}
// ---------- car vs car: momentum by mass, the other car shoved / spun, damage on both ----------
// kg: a hit shares speed by mass (a bus barely notices a sedan; a Lada bounces off an SUV)
const MASS = { bus: 12000, van: 2400, suv: 2100, muscle: 1650, coupe: 1400, volga: 1450, lada: 1050, moskvich: 1000 }, MASS_CAR = 1500, MASS_BIKE = 230;
const massOf = (kind) => MASS[kind] || MASS_CAR;
const SPEEDO_MAX = 71, GEAR_SPAN = 9;   // m/s at the end of the 160 mph dial; m/s of road speed per gear for the tach
const SHOVE_E = 0.15, SPIN_K = 0.9, SLIDE_DECEL = 6.5, SPIN_DAMP = 2.5, PROMOTE_MAX = 4, PROMOTE_MAX_LITE = 2;   // restitution car on car; yaw from an off-centre hit; a shoved car's tyre scrub (m/s²) and spin decay; parked cars made live at once
/** who owns a collider box: a vehicle of ours ({ veh }) or a parked kit car ({ parked }), rebuilt when either list changes */
function ownerOf(box) {
  const list = C.world?.parkedCars || [], key = S.bikes.length * 100003 + list.length;
  if (S.ownKey !== key || !S.owners) { S.ownKey = key; S.owners = new Map(); for (const b of S.bikes) if (b.spec.car) S.owners.set(b.box, { veh: b }); for (const c of list) if (!c.gone) for (const bx of carBoxes(c)) S.owners.set(bx, { parked: c }); }
  return S.owners.get(box) || null;
}
/** a parked kit car (instanced) becomes a live car of ours where it stands: it can be shoved, dented, shot apart. Capped (oldest
 *  untouched ones are not reverted: a live car stays live). Local only: friends keep seeing it parked. */
function promote(c) {
  if (c.gone || c.live) return c.live || null; if ((S.promoted || 0) >= (C.lite ? PROMOTE_MAX_LITE : PROMOTE_MAX)) return null;
  S.promoted = (S.promoted || 0) + 1; hideParkedCar(c); dropParkedCarBoxes(C, c);
  const car = makeCar(c.x, c.z, (c.ry || 0) - Math.PI / 2, carSpec(c.kind) ? c.kind : 'sedan', c.color ?? 0x22305c, c.y || 0); c.live = car; S.owners = null; return car;
}
/** my car hit a box that is a car: the wall response already ran; give the speed back by mass and push the other one */
function shove(v, hitN, vn) {
  const o = ownerOf(hitN.box); if (!o) return; const other = o.veh || promote(o.parked); if (!other || other === v) return;
  const mA = v.mass || (v.spec.car ? MASS_CAR : MASS_BIKE), mB = other.mass || MASS_CAR, k = mA / (mA + mB), nx = hitN.nx, nz = hitN.nz;
  const cur = v.vel.x * nx + v.vel.z * nz, want = vn * k - vn * SHOVE_E * (1 - k); v.vel.x += nx * (want - cur); v.vel.z += nz * (want - cur);   // I keep the common speed (a light car bounces off a heavy one)
  const dv = -vn * k * (1 + SHOVE_E); other.vel.x -= nx * dv; other.vel.z -= nz * dv;
  // an off-centre hit spins it: lever arm of the contact about its centre, across the push
  const rx = hitN.px - other.pos.x, rz = hitN.pz - other.pos.z; other.spinV = (other.spinV || 0) + SPIN_K * (rx * -nz - rz * -nx) * dv / Math.max(1, other.spec.hz * other.spec.hz) * 0.5;
  if (other.parked) { other.sliding = true; }
  const now = performance.now(); if (now - (other.crashT || 0) > 400 && dv > 1.5) { other.crashT = now; try { ensurePanels(other); damageHit(C, other, dv * 1.6, _v.set(hitN.px, other.pos.y + 0.6, hitN.pz).clone(), new THREE.Vector3(-nx, 0, -nz)); } catch (e) { console.warn('[vehicles] damage other', e); } }
}
/** a shoved car with nobody in it: slides on scrubbing tyres, spins down, stops against walls; back into the grid when it stops */
function slide(v, dt) {
  const sp = v.spec, s = Math.hypot(v.vel.x, v.vel.z);
  if (s < 0.05 && Math.abs(v.spinV || 0) < 0.02) { v.sliding = false; v.vel.set(0, 0, 0); v.spinV = 0; v.speed = 0; parkBox(v); rebuildGrids(); S.owners = null; return; }
  const d = Math.min(s, SLIDE_DECEL * dt); if (s > 0) v.vel.multiplyScalar((s - d) / s);
  v.heading += (v.spinV || 0) * dt; v.spinV = (v.spinV || 0) * Math.exp(-SPIN_DAMP * dt);
  fwdOf(v.heading, _f); let px = v.pos.x + v.vel.x * dt, pz = v.pos.z + v.vel.z * dt;
  for (const az of sp.circles) { const ax = px - _f.x * az, azz = pz - _f.z * az; if (resolveCircle(S.grid, ax, azz, sp.bodyR, v.pos.y + sp.band, v.pos.y + sp.h, v.box, _res)) { px += _res.x - ax; pz += _res.z - azz; const vn = v.vel.x * _res.nx + v.vel.z * _res.nz; if (vn < 0) { v.vel.x -= _res.nx * vn * 1.2; v.vel.z -= _res.nz * vn * 1.2; } } }
  v.pos.x = px; v.pos.z = pz; v.speed = Math.hypot(v.vel.x, v.vel.z); parkBox(v);
  v.group.position.copy(v.pos); v.group.rotation.set(0, v.heading, 0);
}
/** an AI car (traffic.js, belt.js, cops: they resolve their own push) hit the car I'm driving: crunch, sparks, shake, damage */
function aiHit(other, { nx = 0, nz = 0, vn = 0 } = {}) {
  const v = S.mounted; if (!v?.spec.car || -vn < 1.5) return; const now = performance.now(); if (now - (v.crashT || 0) < 400) return; v.crashT = now;
  const k = clamp(-vn / 16, 0, 1), px = v.pos.x - nx * v.spec.hx, pz = v.pos.z - nz * v.spec.hx, at = new THREE.Vector3(px, v.pos.y + 0.6, pz);
  crunch(v, at, k); try { damageHit(C, v, -vn * (other?.bus ? 1.6 : 1), at, new THREE.Vector3(nx, 0, nz)); } catch (e) { console.warn('[vehicles] damage', e); }
}
/** the feel of a crash: crunch by impact speed, sparks + bits, a camera jolt and shake */
function crunch(v, at, k) {
  try { C.audio?.play?.('impact', { position: at, volume: 0.6 + k }); } catch {} try { C.audio?.play?.('impact_metal', { position: at, volume: 0.4 + k }); } catch {}
  if (k > 0.45) try { C.audio?.play?.('glass', { position: at, volume: k }); } catch {}
  try { crashFx(C, at, k, v.vel); } catch {}
  if (v === S.mounted) { const p = C.player; if (p) { p.pitch += (Math.random() - 0.3) * 0.14 * k; p.yaw += (Math.random() - 0.5) * 0.12 * k; } v.hitT = Math.max(v.hitT || 0, 0.25 + 0.45 * k); }
  v.suspV -= 2 * k;
}
/** a bullet hit something ('impact' from weapons.js): a car of ours, or a parked kit car (made live, then hit) */
function onShot(e) {
  const o = e?.object; if (!o || !e.point || !e.normal) return; const dir = e.dir || new THREE.Vector3();
  const veh = o.userData?.vehicle; if (veh?.spec?.car) { ensurePanels(veh); return damageShot(C, veh, o, e.point, e.normal, dir, e.damage); }
  if (!o.isInstancedMesh || e.instanceId == null || !/^cars:/.test(o.name)) return;
  const list = C.world?.parkedCars || []; if (S.refKey !== list.length) { S.refKey = list.length; S.byRef = new Map(); for (const c of list) for (const r of c.refs || []) S.byRef.set(r.im.uuid + ':' + r.i, c); }
  const c = S.byRef.get(o.uuid + ':' + e.instanceId); if (!c) return; const car = promote(c); if (!car) return;
  car.group.updateMatrixWorld(true); damageShot(C, car, /:glass$/.test(o.name) ? 'glass' : null, e.point, e.normal, dir, e.damage);
}
/** coney's parked cars aren't raycast targets (instanced, too many): a shot from you is tested against their boxes here (ray
 *  in each car's own frame), and the first one in front of whatever the bullet hit goes live and takes it */
const SHOT_RANGE = 80, _ray = new THREE.Raycaster();
function onPlayerShot(e) {
  if (e?.who !== 'player' || e.melee || !e.origin || !e.dir) return; const o = e.origin, d = e.dir, far = e.hit ? o.distanceTo(e.hit) : SHOT_RANGE;
  let best = null, bt = far;
  for (const c of C.world?.parkedCars || []) { if (c.gone || c.live || !c.kind) continue; const dx = c.x - o.x, dz = c.z - o.z; if (dx * dx + dz * dz > SHOT_RANGE * SHOT_RANGE) continue;
    const K = carSpec(c.kind) || carSpec('sedan'), cs = Math.cos(c.ry || 0), sn = Math.sin(c.ry || 0);
    const lx = (o.x - c.x) * cs - (o.z - c.z) * sn, lz = (o.x - c.x) * sn + (o.z - c.z) * cs, ly = o.y - (c.y || 0), ux = d.x * cs - d.z * sn, uz = d.x * sn + d.z * cs, uy = d.y;   // into the kit frame
    let t0 = 0, t1 = bt; for (const [p, u, h0, h1] of [[lx, ux, -K.len / 2, K.len / 2], [ly, uy, K.clr, K.roof], [lz, uz, -K.w / 2, K.w / 2]]) { if (Math.abs(u) < 1e-9) { if (p < h0 || p > h1) { t0 = 1e9; break; } continue; } let a = (h0 - p) / u, b = (h1 - p) / u; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) break; }
    if (t0 <= t1 && t0 < bt) { bt = t0; best = c; } }
  if (!best) return; const car = promote(best); if (!car) return; car.group.updateMatrixWorld(true);
  _ray.set(o, d); _ray.far = far + 1; const h = _ray.intersectObjects(car.meshes.filter((m) => m.visible), false)[0]; if (!h) return;
  const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : d.clone().negate(); if (n.dot(d) > 0) n.negate();
  damageShot(C, car, h.object, h.point, n, d, C.weapons?.spec?.damage ?? 30);
}
/** a mounted motorcycle / e-bike crashed into a car or a wall: its own damage + smoke (vehicledamage.js, BIKE_HP), crunch/sparks,
 *  and on a hard enough hit the rider is thrown clear (dismount + a knockback that feeds the player's own fall-damage path). */
function bikeCrash(v, hitN, vn, severity, hitCar) {
  const at = new THREE.Vector3(hitN.px, v.pos.y + 0.55, hitN.pz);
  if (severity > 0.12) { crunch(v, at, severity); try { damageHit(C, v, -vn, at, new THREE.Vector3(hitN.nx, 0, hitN.nz)); } catch (e) { console.warn('[vehicles] bike damage', e); } }
  if (hitCar && -vn > BIKE_EJECT_VN) ejectRider(v, hitN.nx, hitN.nz, -vn);   // thrown off hitting a car, not every wall clip
}
/** throws the rider off a crashing bike: a normal dismount (safe spot found beside it), then a knockback velocity so the
 *  player's own gravity + landing fall-damage (player.js) does the rest - no separate ragdoll needed. */
function ejectRider(v, nx, nz, speed) {
  if (v !== S.mounted) return; const p = C.player; if (!p) return;
  dismount();
  const k = clamp(speed * 0.55, 4, 14);
  p.velocity.set(nx * k, Math.max(4, k * 0.4), nz * k); p.onGround = false;
  try { C.hud?.toast?.('THROWN OFF', 1600); } catch {}
  try { C.audio?.play?.('impact', { position: v.pos, volume: 1 }); } catch {}
}
function simulate(v, dt, thr, brk, hard, steer) {
  const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6)), h = dt / n;
  v.surfT -= dt; if (v.surfT <= 0) { v.surfT = 0.1; v.surf = surfaceUnder(v); }
  if (v.spec.water && C.world?.ocean) { for (let i = 0; i < n; i++) stepWater(v, h, thr, brk, steer); visualsWater(v, dt); return; }
  for (let i = 0; i < n; i++) stepVeh(v, h, thr, brk, hard, steer);
  visuals(v, dt, thr, brk, hard);
}
function stepVeh(v, dt, thr, brk, hard, steer) {
  const p = v.pos, vel = v.vel, sp = v.spec, sf = v.surf || SURF.hard;
  fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x);
  let fs = vel.x * _f.x + vel.z * _f.z, ls = vel.x * _r.x + vel.z * _r.z;
  const nb = v.boost || 0, fs0 = fs, max = sp.max * sf.max * (1 + 0.45 * nb), grounded = !v.air;   // nitro: +45 % top speed, +80 % pull
  v.throttle = damp(v.throttle, thr, 10, dt);
  if (grounded) {
    if (thr > 0 && fs >= -0.5) { const k = clamp(fs / max, 0, 1); fs += sp.accel * sf.accel * (1 + 0.8 * nb) * thr * (1 - k * k) * dt; }
    if (thr > 0 && fs < -0.5) fs = Math.min(0, fs + sp.brake * thr * dt);                        // throttle while rolling back = brake
    if (brk > 0) { if (fs > 0.3) fs = Math.max(0, fs - sp.brake * brk * dt); else if (thr === 0) fs = Math.max(-sp.revMax, fs - sp.accel * 0.5 * brk * dt); }
    if (hard) { const d = sp.hard * dt; fs = fs > 0 ? Math.max(0, fs - d) : Math.min(0, fs + d); }
    // passive: air drag + rolling resistance (+ surface drag, + engine braking off-throttle)
    fs -= fs * Math.abs(fs) * (sp.aero ?? 0.0024) * dt;
    const rf = (0.5 + sf.drag + (thr === 0 && brk === 0 && !hard ? sp.engineBrake : 0)) * dt; fs -= Math.sign(fs) * Math.min(Math.abs(fs), rf);
    if (fs > max) fs = damp(fs, max, 1.2, dt);   // entering sand at speed bleeds off instead of hitting a wall
  }
  fs = clamp(fs, -sp.revMax, sp.max * 1.05 * (1 + 0.45 * nb));
  // steering: the angle is capped by the cornering limit at this speed (so it's twitch-free at 30 m/s, tight at walking pace)
  const af = Math.abs(fs);
  const sliding = hard && af > 3 && grounded;
  v.skid = damp(v.skid, sliding ? 1 : 0, sliding ? 6 : 3, dt);
  const latMax = sp.latG * 9.81 * sf.grip * (1 + 1.5 * v.skid);
  let steerMax = sp.steerLow; if (af > 1) steerMax = Math.min(steerMax, Math.atan(latMax * sp.wheelbase / (af * af)));
  const steerRate = !sp.car ? (steer !== 0 ? 6 : 8) : steer !== 0 ? sp.steerIn + (sp.steerInHi - sp.steerIn) * clamp(af / sp.max, 0, 1) : sp.steerOut;
  v.steer = damp(v.steer, steer * Math.max(0.02, steerMax), steerRate, dt);
  // yaw (bicycle model; reverse steers the other way like a real vehicle); handbrake → rear steps out
  let yawRate = (grounded && af > 0.05) ? -fs / sp.wheelbase * Math.tan(v.steer) : 0;
  yawRate *= 1 + sp.hardYaw * v.skid;
  // world velocity from the old frame, then rotate the chassis under it: the lateral part is the tyre slip
  const wx = _f.x * fs + _r.x * ls, wz = _f.z * fs + _r.z * ls;
  v.heading += yawRate * dt;
  fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x);
  fs = wx * _f.x + wz * _f.z; ls = wx * _r.x + wz * _r.z;
  const grip = grounded ? (sp.grip * sf.grip * (1 - v.skid) + sp.hardGrip * v.skid) : 0.2;
  ls *= Math.exp(-grip * dt);
  vel.set(_f.x * fs + _r.x * ls, 0, _f.z * fs + _r.z * ls);
  // integrate + collide (circles along the body) with slide, speed loss, small bounce
  let px = p.x + vel.x * dt, pz = p.z + vel.z * dt, hitN = null;
  const y0 = p.y + sp.band, y1 = p.y + sp.h;
  for (let i = 0; i < sp.circles.length; i++) {
    const az = sp.circles[i]; const ax = px - _f.x * az, azz = pz - _f.z * az;
    if (resolveCircle(S.grid, ax, azz, sp.bodyR, y0, y1, v.box, _res)) { px += _res.x - ax; pz += _res.z - azz; if (!hitN || _res.depth > hitN.depth) hitN = { nx: _res.nx, nz: _res.nz, depth: _res.depth, box: _res.box, px: _res.x - _res.nx * sp.bodyR, pz: _res.z - _res.nz * sp.bodyR }; }
    const mx = px - _f.x * az, mz = pz - _f.z * az;
    const meshHit = C.meshCollision?.resolveVehicleCircle(mx, mz, sp.bodyR, y0, y1);   // maps built from real geometry (world/meshcollide.js)
    if (meshHit) { px += meshHit.x - mx; pz += meshHit.z - mz; if (!hitN || meshHit.depth > hitN.depth) hitN = { ...meshHit, px: meshHit.x - meshHit.nx * sp.bodyR, pz: meshHit.z - meshHit.nz * sp.bodyR }; }
  }
  if (hitN) {
    const vn = vel.x * hitN.nx + vel.z * hitN.nz;
    if (vn < 0) {
      const severity = clamp(-vn / 8, 0, 1);
      if (sp.car) {
        // cars: the wall takes the normal part (small bounce, less the harder the hit) and rubs the tangential part in proportion
        // to the impact, so a glance scrapes along the wall at most of its speed and only a square hit stops it dead
        const tx = vel.x - hitN.nx * vn, tz = vel.z - hitN.nz * vn, vt = Math.hypot(tx, tz), keep = vt > 1e-4 ? Math.max(0, 1 - sp.wallMu * -vn / vt) : 0;
        const e = BOUNCE * (1 - 0.6 * severity);
        vel.set(tx * keep - hitN.nx * vn * e, 0, tz * keep - hitN.nz * vn * e);
        // swing the nose along the wall (the way it's sliding), not into it or off it
        if (fs > 2 && vt * keep > 2) { const along = Math.atan2(-tx, -tz), d = wrap(along - v.heading); if (Math.abs(d) < Math.PI / 2) v.heading += d * clamp(0.6 * severity, 0, 0.12); }
      } else {
        vel.x -= hitN.nx * vn * (1 + BOUNCE); vel.z -= hitN.nz * vn * (1 + BOUNCE);
        vel.multiplyScalar(1 - HIT_LOSS * severity);
        const away = Math.atan2(-hitN.nx, -hitN.nz); v.heading += wrap(away - v.heading) * 0.15 * severity;
      }
      v.suspV -= 1.5 * severity; v.hitT = Math.max(v.hitT, 0.25 * severity + 0.05);
      v.lastHit = { x: hitN.px, z: hitN.pz, nx: hitN.nx, nz: hitN.nz, t: performance.now() };   // where it hit, for the crash damage + sparks (update)
      const hitCar = hitN.box && !!ownerOf(hitN.box);   // read before shove() can promote() the parked car it hit (that drops + replaces its box)
      if (hitN.box && v === S.mounted) shove(v, hitN, vn);   // #183's mass system: a bike (MASS_BIKE fallback) gets shoved hard by a car, barely nudges it
      if (severity > 0.25 && v === S.mounted) { try { C.audio?.play?.('impact', { position: p, volume: severity }); } catch {} }
      if (!sp.car && v === S.mounted) bikeCrash(v, hitN, vn, severity, hitCar);   // motorcycle / e-bike: its own damage + smoke, and a hard enough hit into a car throws the rider
    }
  }
  // the play area's outer edge (seams between the map and its zones are open): put back inside, bounce off it
  if (C.world?.playClamp) { const [cx, cz] = C.world.playClamp(px, pz, 1.2);
    if (cx !== px) { if ((cx - px) * vel.x < 0) { vel.x = -vel.x * BOUNCE; vel.z *= 0.6; } px = cx; }
    if (cz !== pz) { if ((cz - pz) * vel.z < 0) { vel.z = -vel.z * BOUNCE; vel.x *= 0.6; } pz = cz; } }
  p.x = px; p.z = pz;
  // ground: climb kerbs smoothly, stick to downhill slopes, leave the ground off a crest/ledge (keeping the ramp's vertical speed)
  const gy = floorAt(px, pz, p.y, v.box, sp.stepUp), dy = gy - p.y, y00 = p.y;
  if (!v.air) {
    if (dy >= 0) { p.y = dy > 0.03 ? damp(p.y, gy, 22, dt) : gy; if (sp.climb) p.y = Math.min(p.y, y00 + Math.max(sp.climb, Math.abs(fs) * 0.3) * dt); if (dy > 0.03) v.suspV -= dy * 2.5; }   // cars: a kerb rolls up, it doesn't pop
    else if (dy > -Math.max(0.04, Math.abs(fs) * dt * 0.35) && v.groundVy > -2.5 * Math.max(1, Math.abs(fs) / 10)) p.y = gy;
    else { v.air = true; v.vy = Math.max(0, v.groundVy) * 0.9; }
    if (!v.air) v.groundVy = damp(v.groundVy, (p.y - y00) / dt, 12, dt);
  }
  if (v.air) {
    v.vy -= GRAV * dt; p.y += v.vy * dt;
    if (p.y <= gy) { v.suspV += v.vy * 0.25; p.y = gy; v.vy = 0; v.air = false; v.groundVy = 0; if (v === S.mounted && v.suspV < -2) try { C.audio?.play?.('impact', { position: p, volume: 0.3 }); } catch {} }
  }
  fwdOf(v.heading, _f);
  const fsN = vel.x * _f.x + vel.z * _f.z; v.fwdSpeed = fsN; v.speed = vel.length();
  v.aLong = damp(v.aLong, (fsN - fs0) / dt, 8, dt);
  v.yawRate = yawRate;
  // suspension spring, excited by throttle/brake + surface rumble
  const kS = 90, cS = 9;
  v.suspV += (-kS * v.susp - cS * v.suspV) * dt - (thr - brk - (hard ? 1.4 : 0)) * 0.5 * dt * Math.min(1, Math.abs(fsN) / 6 + 0.3);
  if (sf.rumble && Math.abs(fsN) > 1) { v.rumbleN = damp(v.rumbleN || 0, Math.random() - 0.5, 7, dt); v.suspV += v.rumbleN * sf.rumble * Math.min(1, Math.abs(fsN) / 8) * 30 * dt; }   // low-passed: rough ground rolls, it doesn't buzz
  v.susp += v.suspV * dt; v.susp = clamp(v.susp, -0.09, 0.06);
  v.spin += fsN / WHEEL_R * dt;
  v.hitT = Math.max(0, v.hitT - dt);
}
// ---------- jet ski on the ocean ----------
const WATER_BOX = { x0: -985, x1: 2360, z0: 163, z1: 900 };   // east to Brighton 14th (coney/brighton.js)
/** One water sub-step: jet thrust (only while the intake is wet), hull drag, jet steering, boat-like slide, buoyancy on the
 *  swell (spring, but it can't pull the hull down faster than gravity → it leaves the crest at speed), beaching on sand. */
function stepWater(v, dt, thr, brk, steer) {
  const O = C.world.ocean, p = v.pos, vel = v.vel, sp = v.spec;
  fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x);
  let fs = vel.x * _f.x + vel.z * _f.z, ls = vel.x * _r.x + vel.z * _r.z; const fs0 = fs;
  const wy = O.waveHeight(p.x, p.z), gy = groundY(p.x, p.z), depth = wy - gy;
  const hullIn = !v.air && p.y < wy + 0.12, intake = hullIn && depth > 0.25, beached = depth < 0.2 && p.y <= gy + 0.14;
  v.wet = hullIn; v.beached = beached; v.depth = depth;
  const nb = v.boost || 0, max = sp.max * (1 + 0.35 * nb);
  v.throttle = damp(v.throttle, thr, 6, dt);
  if (intake) {
    if (thr > 0 && fs >= -0.5) { const k = clamp(fs / max, 0, 1); fs += sp.accel * (1 + 0.6 * nb) * thr * (1 - k * k) * dt; }
    if (thr > 0 && fs < -0.5) fs = Math.min(0, fs + sp.brake * thr * dt);
    if (brk > 0) fs = fs > 0.3 ? Math.max(0, fs - sp.brake * brk * dt) : Math.max(-sp.revMax, fs - sp.accel * 0.4 * brk * dt);   // reverse bucket
  }
  if (hullIn || beached) { fs -= fs * Math.abs(fs) * 0.0045 * dt; fs -= Math.sign(fs) * Math.min(Math.abs(fs), (0.3 + (thr === 0 ? 1.1 : 0)) * dt); }
  if (beached) { fs -= Math.sign(fs) * Math.min(Math.abs(fs), 14 * dt); ls *= Math.exp(-7 * dt); }
  const af = Math.abs(fs), thrK = intake ? clamp(0.2 + 0.8 * v.throttle + 0.3 * brk, 0, 1) : 0;
  v.steer = damp(v.steer, steer * sp.steerLow, steer !== 0 ? 6 : 8, dt);
  let yawRate = 0;
  if (hullIn && !beached) { const rate = Math.min(1.9, sp.latG * 9.81 / Math.max(af, 2.5)) * clamp(af / 1.5 + 0.35 * thrK, 0, 1); yawRate = -(v.steer / sp.steerLow) * rate * (0.25 + 0.75 * thrK) * (fs < -0.3 ? -1 : 1); }
  const wx = _f.x * fs + _r.x * ls, wz = _f.z * fs + _r.z * ls;
  v.heading += yawRate * dt;
  fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x);
  fs = wx * _f.x + wz * _f.z; ls = wx * _r.x + wz * _r.z;
  const grip = hullIn ? sp.grip * (0.6 + 0.8 * thrK) + (af < 3 ? 2 : 0) : 0.15;
  ls *= Math.exp(-grip * dt);
  v.skid = damp(v.skid, clamp(Math.abs(ls) / 4, 0, 1), 5, dt);
  vel.set(_f.x * fs + _r.x * ls, 0, _f.z * fs + _r.z * ls);
  let px = p.x + vel.x * dt, pz = p.z + vel.z * dt, hitN = null;
  const y0 = p.y + sp.band, y1 = p.y + sp.h;
  for (let i = 0; i < sp.circles.length; i++) {
    const az = sp.circles[i]; const ax = px - _f.x * az, azz = pz - _f.z * az;
    if (resolveCircle(S.grid, ax, azz, sp.bodyR, y0, y1, v.box, _res)) { px += _res.x - ax; pz += _res.z - azz; if (!hitN || _res.depth > hitN.depth) hitN = { nx: _res.nx, nz: _res.nz, depth: _res.depth }; }
  }
  if (hitN) { const vn = vel.x * hitN.nx + vel.z * hitN.nz; if (vn < 0) { const sev = clamp(-vn / 8, 0, 1); vel.x -= hitN.nx * vn * (1 + BOUNCE); vel.z -= hitN.nz * vn * (1 + BOUNCE); vel.multiplyScalar(1 - HIT_LOSS * sev); v.hitT = Math.max(v.hitT, 0.25 * sev + 0.05); if (sev > 0.25 && v === S.mounted) { try { C.audio?.play?.('impact', { position: p, volume: sev }); } catch {} } } }
  // the dry beach: a hull can skid a little way up the wet sand, never across the beach
  const dN = O.waveHeight(px, pz) - groundY(px, pz);
  if (dN < -0.1 && dN < depth - 0.004) { px = p.x; pz = p.z; vel.multiplyScalar(Math.exp(-10 * dt)); }
  if (px < WATER_BOX.x0) { px = WATER_BOX.x0; vel.x = Math.abs(vel.x) * BOUNCE; } if (px > WATER_BOX.x1) { px = WATER_BOX.x1; vel.x = -Math.abs(vel.x) * BOUNCE; }
  if (pz < WATER_BOX.z0) { pz = WATER_BOX.z0; vel.z = Math.abs(vel.z) * BOUNCE; } if (pz > WATER_BOX.z1) { pz = WATER_BOX.z1; vel.z = -Math.abs(vel.z) * BOUNCE; }
  p.x = px; p.z = pz;
  // buoyancy: ride the surface (a little higher when planing), rest on the sand when beached
  const wy2 = O.waveHeight(px, pz), gy2 = groundY(px, pz), planing = clamp((Math.abs(fs) - 4) / 10, 0, 1);
  const rest = Math.max(wy2 - sp.draft + 0.08 * planing, gy2 + 0.06);
  v.surfY = wy2;
  if (v.air) {
    v.vy -= GRAV * dt; p.y += v.vy * dt;
    if (p.y <= rest) { const k = clamp(-v.vy / 6, 0, 1.5); v.splash = Math.max(v.splash || 0, k); v.suspV += v.vy * 0.2; p.y = rest; v.vy = -v.vy * 0.1; v.air = false; vel.multiplyScalar(1 - 0.12 * Math.min(1, k)); }
  } else {
    const acc = 75 * (rest - p.y) - 10 * v.vy; v.vy += Math.max(-GRAV, acc) * dt; p.y += v.vy * dt;
    if (p.y > wy2 + 0.28 && v.vy > 0.5) v.air = true;                         // launched off a crest / a breaking face
    if (p.y < gy2 + 0.06) { p.y = gy2 + 0.06; v.vy = Math.max(0, v.vy); }
  }
  fwdOf(v.heading, _f);
  const fsN = vel.x * _f.x + vel.z * _f.z; v.fwdSpeed = fsN; v.speed = vel.length();
  v.aLong = damp(v.aLong, (fsN - fs0) / dt, 8, dt); v.yawRate = yawRate;
  v.suspV += (-60 * v.susp - 8 * v.suspV) * dt; v.susp = clamp(v.susp + v.suspV * dt, -0.1, 0.08);
  v.hitT = Math.max(0, v.hitT - dt);
}
/** pitch / roll from the swell under bow, stern and both sides + bow-up under throttle + lean into the turn */
function visualsWater(v, dt) {
  const O = C.world.ocean, sp = v.spec, p = v.pos;
  fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x);
  const leanT = clamp(-((v.yawRate || 0) * v.fwdSpeed) / 9.81, -1, 1) * LEAN_MAX * 1.8;
  v.lean = damp(v.lean, clamp(leanT, -LEAN_MAX * 2, LEAN_MAX * 2) * (v.wet ? 1 : 0.4), 5, dt);
  let tp = v.tPitch, tr = 0;
  if (v.air) tp = damp(v.tPitch, clamp(v.vy * 0.05, -0.35, 0.3), 2.5, dt);
  else {
    const L = 1.3, Wd = 0.55, g = (x, z) => Math.max(O.waveHeight(x, z), groundY(x, z));
    const yf = g(p.x + _f.x * L, p.z + _f.z * L), yb = g(p.x - _f.x * L, p.z - _f.z * L), yr = g(p.x + _r.x * Wd, p.z + _r.z * Wd), yl = g(p.x - _r.x * Wd, p.z - _r.z * Wd);
    const af = Math.abs(v.fwdSpeed), hump = Math.exp(-(((af - 6) / 4) ** 2));
    tp = Math.atan2(yf - yb, 2 * L) + (v.beached ? 0 : 0.11 * v.throttle * hump + 0.025 * clamp((af - 6) / 8, 0, 1)); tr = Math.atan2(yr - yl, 2 * Wd);
  }
  v.tPitch = damp(v.tPitch, clamp(tp, -0.5, 0.5), 8, dt); v.tRoll = damp(v.tRoll, clamp(tr, -0.4, 0.4), 8, dt);
  v.group.position.copy(p); v.group.rotation.set(0, v.heading, 0);
  v.body.position.y = v.susp; v.body.rotation.set(v.tPitch - v.suspV * 0.03, 0, -v.lean + v.tRoll, 'YXZ');
  v.fork.rotation.y = -v.steer * 1.1;
}

/** Per-frame visual pose: lean / body roll, terrain pitch+roll, suspension, fork + wheels, steering wheel, lights. */
function visuals(v, dt, thr, brk, hard) {
  const sp = v.spec, p = v.pos;
  fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x);
  // lean (bikes lean in, cars roll out a little) from lateral acceleration, plus counter-lean from a slide
  const leanT = clamp(-((v.yawRate || 0) * v.fwdSpeed) / 9.81, -1, 1) * LEAN_MAX * 1.35 + v.skid * v.steer * 0.35;
  const leanLim = C.xr?.presenting && v === S.mounted && !sp.car ? VR_LEAN_MAX : LEAN_MAX * 1.4 * Math.abs(sp.leanK);
  v.lean = damp(v.lean, clamp(leanT * sp.leanK, -leanLim, leanLim), 7, dt);
  // terrain under the axles / sides
  const hw = sp.wheelbase / 2, yf = floorAt(p.x + _f.x * hw, p.z + _f.z * hw, p.y + 0.2, v.box, sp.stepUp), yr = floorAt(p.x - _f.x * hw, p.z - _f.z * hw, p.y + 0.2, v.box, sp.stepUp);
  let tp = v.air ? v.tPitch : Math.atan2(yf - yr, sp.wheelbase), tr = 0;
  if (sp.car && !v.air) { const yR = floorAt(p.x + _r.x * sp.hx, p.z + _r.z * sp.hx, p.y + 0.2, v.box, sp.stepUp), yL = floorAt(p.x - _r.x * sp.hx, p.z - _r.z * sp.hx, p.y + 0.2, v.box, sp.stepUp); tr = Math.atan2(yR - yL, sp.hx * 2); }
  if (v.air) tp = damp(v.tPitch, clamp(v.vy * 0.03, -0.3, 0.2), 2, dt);
  v.tPitch = damp(v.tPitch, clamp(tp, -0.5, 0.5), 12, dt); v.tRoll = damp(v.tRoll, clamp(tr, -0.35, 0.35), 12, dt);
  v.group.position.copy(p); v.group.rotation.set(0, v.heading, 0);
  const squat = sp.car ? clamp(v.aLong * 0.0035, -0.05, 0.035) : 0;
  v.body.position.y = v.susp; v.body.rotation.set(v.tPitch - v.suspV * 0.04 + squat, 0, -v.lean + v.tRoll, 'YXZ');
  v.fork.rotation.y = -v.steer * 0.85; v.wheelF.rotation.x = -v.spin; v.wheelR.rotation.x = -v.spin;
  if (v.carWheels) for (const w of v.carWheels) { w.spin.rotation.z = (w.side > 0 ? -1 : 1) * v.spin * WHEEL_R / (v.tyreR || 0.33); if (w.front) w.pivot.rotation.y = -v.steer * 0.55; }   // cars: roll + steer
  if (v.busKit) v.busKit.roll(v.spin * WHEEL_R / 0.5, -v.steer * 0.45);
  if (v.steerWheel) v.steerWheel.rotation.x = clamp(v.steer * 4.5, -2.6, 2.6);
  if (v.needles) { v.needles.speed.rotation.x = gaugeNeedle(Math.abs(v.fwdSpeed) / SPEEDO_MAX); v.needles.rpm.rotation.x = gaugeNeedle(0.12 + 0.55 * v.throttle + 0.3 * ((Math.abs(v.fwdSpeed) % GEAR_SPAN) / GEAR_SPAN)); }   // the dash: speedo, and a tach that climbs through each gear
  v.brakeK = damp(v.brakeK, (brk > 0 && v.fwdSpeed > 0.3) || hard ? 1 : 0, 20, dt);
  if (v.lampR) v.lampR.emissiveIntensity = 0.45 + 2.2 * v.brakeK;
}

// ---------- running people over ----------
const _hp = new THREE.Vector3();
function runOver(v, dt) {
  const sp = v.spec, spd = v.speed; if (spd < 3.5) return;
  const now = C.time?.elapsed ?? performance.now() / 1000;
  fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x);
  const px = v.pos.x, pz = v.pos.z, reach = Math.max(sp.hx, sp.hz) + 1.2;
  const hitAt = (x, y, z, pad) => {
    const dx = x - px, dz = z - pz; if (dx * dx + dz * dz > reach * reach || Math.abs(y - v.pos.y) > 2) return 0;
    const lz = dx * _f.x + dz * _f.z, lx = dx * _r.x + dz * _r.z;
    if (Math.abs(lx) > sp.hx + pad || Math.abs(lz) > sp.hz + pad) return 0;
    const len = Math.hypot(dx, dz) || 1; const closing = (v.vel.x * dx + v.vel.z * dz) / len;   // speed toward them
    return closing > 2.5 ? Math.max(closing, spd * 0.6) : 0;
  };
  const soldiers = C.ai?.soldiers;
  if (soldiers && C.ai.damage) for (const s of soldiers) {
    if (!s || s.dead || !s.position) continue;
    const k = hitAt(s.position.x, s.position.y, s.position.z, 0.35); if (!k) continue;
    if ((S.hits.get(s) || -9) > now - 0.6) continue; S.hits.set(s, now);
    const dmg = Math.round(k * sp.hitMul);
    try { C.ai.damage(s, dmg, s.position.clone().setY(s.position.y + 1)); } catch (e) { console.error('[vehicles] ai.damage', e); }
    try { C.hud?.hitmarker?.(!!s.dead); } catch {}
    try { C.audio?.play?.('impact', { position: s.position, volume: 0.8 }); } catch {}
    v.vel.multiplyScalar(sp.hitSlow); v.suspV -= 0.8; v.hitT = Math.max(v.hitT, 0.12);
  }
  // chill-mode people (vendors, crews, beachgoers, babushkas…): anything with a hitbox that takes hits (userData.onHit) gets run down
  if (!S.hitboxT || now - S.hitboxT > 1) { S.hitboxT = now; S.hitboxes = (C.raycastTargets || []).filter((m) => m?.userData?.onHit && !m.userData.soldier && !m.userData.remote && !m.userData.traffic); }
  for (const hb of S.hitboxes || []) {
    if (!hb.parent) continue; hb.getWorldPosition(_hp); const k = hitAt(_hp.x, _hp.y - 0.9, _hp.z, 0.35); if (!k) continue;
    if ((S.hits.get(hb) || -9) > now - 0.8) continue; S.hits.set(hb, now);
    try { hb.userData.onHit(Math.round(k * sp.hitMul * 1.4), false, _hp.clone()); } catch (e) { console.warn('[vehicles] run over', e); }
    try { C.audio?.play?.('impact', { position: _hp, volume: 0.9 }); } catch {}
    v.vel.multiplyScalar(sp.hitSlow); v.suspV -= 0.6; v.hitT = Math.max(v.hitT, 0.12);
  }
  const net = C.net; if (!net?.list || !net.peer) return;
  let ids; try { ids = net.list(); } catch { return; }
  for (const id of ids) {
    const q = net.peer(id); if (!q || q.dead || q.veh || !q.pos) continue;   // people in cars / on bikes aren't pedestrians
    const k = hitAt(q.pos.x, q.pos.y, q.pos.z, 0.4); if (!k) continue;
    if ((S.hits.get(id) || -9) > now - 1) continue; S.hits.set(id, now);
    const dmg = Math.round(k * sp.hitMul);
    C.bus.emit('vehicleHit', { peerId: id, speed: +k.toFixed(2), damage: dmg, point: [q.pos.x, q.pos.y + 1, q.pos.z], car: !!sp.car });
    try { C.hud?.hitmarker?.(dmg >= 100); } catch {}
    v.vel.multiplyScalar(sp.hitSlow); v.hitT = Math.max(v.hitT, 0.12);
  }
}

// ---------- rider (player + camera) ----------
function applyView(dt) {
  const bike = S.mounted, p = C.player; if (!bike || !p) return;
  const sp = bike.spec;
  fwdOf(bike.heading, _f); _r.set(-_f.z, 0, _f.x);
  const leanS = Math.sin(bike.lean);
  // player capsule sits in the seat (feet at seat height so the hitbox spans the rider)
  const seatY = sp.car ? 0.3 : 0.47;
  p.position.set(bike.pos.x + _r.x * (leanS * 0.4 + (sp.car ? sp.eyeSide : 0)), bike.pos.y + seatY + bike.susp, bike.pos.z + _r.z * (leanS * 0.4 + (sp.car ? sp.eyeSide : 0)));
  p.velocity.set(0, 0, 0); p.onGround = true; p.height = 1.7;
  if (C.xr?.presenting && S.chase) setChase(false);   // VR: you ARE the rider (the chase cam's rider model sat around your head)
  if (bike.rider) bike.rider.visible = S.chase;
  showViewmodel(!S.chase);
  if (S.chase) return applyChase(bike, dt);
  const eyeH = bike.pos.y + sp.eyeH + bike.susp * 1.2;
  // engine buzz: frequency capped ~10 Hz — the old rpm-linear phase hit 35+ Hz at speed, aliased at 60 fps into random jolts ("the bike is bumpy")
  const rpm = 8 + Math.abs(bike.fwdSpeed) * 2.2 + bike.throttle * 6; S.vib += (dt || 0) * Math.min(rpm, 30) * 1.2;
  const vibA = (sp.car ? 0.4 : 1) * (0.0012 + bike.throttle * 0.0018 + Math.min(1, Math.abs(bike.fwdSpeed) / 12) * 0.0012) + bike.hitT * 0.035 + (bike.surf?.rumble || 0) * 0.002;
  const vx = Math.sin(S.vib * 1.7) * vibA, vy = Math.sin(S.vib) * vibA * 0.8;
  const H = sp.eyeH;
  _v.set(bike.pos.x, eyeH, bike.pos.z).addScaledVector(_f, -sp.eyeBack).addScaledVector(_r, leanS * H * 0.85 + vx + sp.eyeSide);
  _v.y -= (1 - Math.cos(bike.lean)) * H; _v.y += vy;
  // body pitch moves the eye (seat is behind the axle midpoint on bikes, near it in cars)
  _v.y += Math.sin(bike.tPitch) * (-sp.eyeBack);
  const rollT = C.xr?.presenting ? 0 : sp.car ? (bike.tRoll * 0.9 - bike.lean * 0.5) : (-bike.lean * 0.8 + bike.skid * bike.steer * 0.15);
  S.roll = damp(S.roll, rollT, 10, dt || 1);
  const yaw = bike.heading + S.lookYaw;
  const pitch = clamp(S.lookPitch + bike.tPitch * 0.9 - bike.suspV * 0.03 + Math.sin(S.vib * 0.9) * vibA * 0.5, -LOOK_PITCH - 0.5, LOOK_PITCH + 0.5);
  p.yaw = yaw; p.pitch = pitch; S.wroteYaw = yaw; S.wrotePitch = pitch;
  const cam = C.camera; if (cam) { cam.position.copy(_v); cam.rotation.set(pitch, yaw, S.roll); p.cameraPosition?.copy(_v); }
}
/** Third-person chase camera: trails the heading with a little lag, orbits with free-look, pulls in in front of walls. */
function applyChase(v, dt) {
  const sp = v.spec, p = C.player, cam = C.camera;
  const k = dt || 1;
  // follow the direction of travel when reversing slowly so the view doesn't swing around
  S.chaseYaw = S.chaseYaw + wrap(v.heading - S.chaseYaw) * (1 - Math.exp(-(sp.car ? 4 : 5) * k));
  S.chaseY = damp(S.chaseY, v.pos.y, 8, k);
  const tx = v.pos.x, ty = S.chaseY + sp.chaseLook, tz = v.pos.z;
  const yaw = S.chaseYaw + S.lookYaw;
  const elev = clamp(sp.chaseH - S.lookPitch * 0.8, -0.05, 1.2);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const D = sp.chaseD * (1 + clamp(v.speed / sp.max, 0, 1) * 0.12);
  const cx = tx - fx * Math.cos(elev) * D, cy = ty + Math.sin(elev) * D, cz = tz - fz * Math.cos(elev) * D;
  // cars: two more rays parallel to the centre one, a near plane's half width either side (they start inside the car's own
  // footprint), so a wall running just beside the camera's line pulls it in short of the wall instead of letting it scrape
  const sx = -fz * CAM_PROBE, sz = fx * CAM_PROBE;
  let t = segmentHit(S.grid, tx, ty, tz, cx, cy, cz, v.box, v.pos.y + 0.25);
  if (sp.car) t = Math.min(t, segmentHit(S.grid, tx + sx, ty, tz + sz, cx + sx, cy, cz + sz, v.box, v.pos.y + 0.25), segmentHit(S.grid, tx - sx, ty, tz - sz, cx - sx, cy, cz - sz, v.box, v.pos.y + 0.25));
  const want = Math.max(1.2, t * D - 0.3);
  S.chaseD = want < S.chaseD ? want : damp(S.chaseD, want, 3, k);   // snap in, ease out
  const d = S.chaseD;
  _v.set(tx - fx * Math.cos(elev) * d, ty + Math.sin(elev) * d, tz - fz * Math.cos(elev) * d);
  // weight transfer: the camera dips with the nose under hard braking and rises a touch as the car squats on launch
  S.chaseDip = damp(S.chaseDip || 0, sp.car ? clamp(v.aLong / CHASE_DIP_ACC, -1, 0.6) : 0, 5, k); _v.y += S.chaseDip * CHASE_DIP_H;
  { let gy = groundY(_v.x, _v.z); if (v.spec.water && C.world?.ocean) gy = Math.max(gy, C.world.ocean.waveHeight(_v.x, _v.z)); if (_v.y < gy + 0.4) _v.y = gy + 0.4; }
  const shake = v.hitT * 0.15;
  if (shake) { _v.x += (Math.random() - 0.5) * shake; _v.y += (Math.random() - 0.5) * shake; }
  // aim a little above and ahead of the vehicle so the crosshair sits over the roof, not on it
  const lx = tx + fx * 4 - _v.x, ly = ty + 0.1 + S.chaseDip * CHASE_DIP_LOOK - _v.y, lz = tz + fz * 4 - _v.z;
  const cyaw = Math.atan2(-lx, -lz), cpitch = Math.atan2(ly, Math.hypot(lx, lz));
  p.yaw = cyaw; p.pitch = cpitch; S.wroteYaw = cyaw; S.wrotePitch = cpitch;
  S.roll = damp(S.roll, 0, 8, k);
  if (cam) { cam.position.copy(_v); cam.rotation.set(cpitch, cyaw, 0); p.cameraPosition?.copy(_v); }
}
function setChase(on) {
  S.chase = !!on;
  const v = S.mounted;
  if (v) { S.chaseYaw = v.heading; S.chaseY = v.pos.y; S.chaseD = v.spec.chaseD; if (S.chase && !v.spec.car && !v.rider) { v.rider = v.spec.kind === 'scooter_kick' ? buildStandingRider() : v.spec.kind === 'scooter_moped' ? buildMopedRider() : v.spec.kind.startsWith('ebike_') ? buildCyclist(v.variant) : buildRider(); v.body.add(v.rider); if (v.spec.water) v.rider.position.set(0, -0.22, 0.12); } }
  S.lookYaw = 0; S.lookPitch = 0;
  if (S.ui) S.ui.cam.classList.toggle('on', S.chase);
  return S.chase;
}

/** Nearest vehicle whose body is within its reach of the player (distance to the footprint, not the centre). */
function nearestBike() {
  const p = C.player; if (!p) return null; let best = null, bd = Infinity;
  for (const b of S.bikes) {
    if (b === S.mounted) continue;
    const sp = b.spec, dx = p.position.x - b.pos.x, dz = p.position.z - b.pos.z;
    if (Math.abs(p.position.y - b.pos.y) > (sp.water ? 3.2 : 1.6)) continue;   // jet skis: hop down off the pier / wade out
    const c = Math.cos(b.heading), s = Math.sin(b.heading);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;   // into the vehicle frame (right, back)
    const d = Math.hypot(Math.max(0, Math.abs(lx) - sp.hx), Math.max(0, Math.abs(lz) - sp.hz));
    if (d < sp.reach && d < bd) { bd = d; best = b; }
  }
  return best;
}
function nearParked() {
  if (typeof window === 'undefined' || !window.__game?.hangout) return null;   // stealing parked cars = hangout mode only
  const list = C.world?.parkedCars, p = C.player?.position; if (!list || !p) return null;
  for (const c of list) if (!c.gone && Math.hypot(c.x - p.x, c.z - p.z) < 3.0 && Math.abs((c.y || 0) - p.y) < 1.5) return c;
  return null;
}

// ---------- touch UI: ENTER / EXIT and CAMERA buttons (touch.js reads nearBike/mounted for its own button; we hide that one while ours shows) ----------
function buildUI(ctx) {
  if (!ctx.isTouch || typeof document === 'undefined') return;
  const st = document.createElement('style');
  st.textContent = `#vehui{position:fixed;inset:0;pointer-events:none;z-index:31;font-family:"Barlow Condensed","Arial Narrow",system-ui,sans-serif}
#vehui .vb{position:absolute;display:none;align-items:center;justify-content:center;pointer-events:auto;border-radius:24px;border:2px solid #e9a23b;background:rgba(233,162,59,.42);color:#fff;font-weight:700;letter-spacing:.1em;font-size:15px;text-shadow:0 1px 2px #000;-webkit-user-select:none;user-select:none;touch-action:none}
#vehui .vb.show{display:flex}#vehui .vb.down{background:rgba(233,162,59,.8);transform:scale(.94)}
#vehui .enter{left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);width:128px;height:50px;margin-left:-64px}
#vehui .cam{left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);width:64px;height:50px;margin-left:76px;background:rgba(10,14,20,.5);border-color:rgba(255,255,255,.45);font-size:13px}
/* landscape, driving a car: centre-bottom is a stretch for one thumb on a wide phone, and the bottom-right corner is free
   once FIRE etc. hide (touch.js .stow) - a bike keeps those buttons live for drive-by shooting, so it keeps the centre spot */
@media (orientation:landscape){#vehui.car .enter{left:auto;right:calc(env(safe-area-inset-right,0px) + 20px);bottom:calc(env(safe-area-inset-bottom,0px) + 20px);margin-left:0}
#vehui.car .cam{left:auto;right:calc(env(safe-area-inset-right,0px) + 20px);bottom:calc(env(safe-area-inset-bottom,0px) + 78px);margin-left:0}}
#vehui .cam.on{background:rgba(233,162,59,.42);border-color:#e9a23b}
#touch .act.vhdup{display:none!important}`;
  document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'vehui'; root.innerHTML = '<div class="vb enter">ENTER</div><div class="vb cam">CAM</div>'; document.body.appendChild(root);
  const enter = root.querySelector('.enter'), cam = root.querySelector('.cam');
  const tap = (el, fn) => el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); setTimeout(() => el.classList.remove('down'), 120); fn(); }, { passive: false });
  tap(enter, () => { ctx.input.pressed.add('KeyF'); S.uiMount = true; });
  tap(cam, () => setChase(!S.chase));
  enter.addEventListener('click', () => { ctx.input.pressed.add('KeyF'); S.uiMount = true; }); cam.addEventListener('click', () => setChase(!S.chase));
  S.ui = { root, enter, cam, label: '', act: null };
}
function updateUI(ctx) {
  const U = S.ui; if (!U) return;
  const p = ctx.player, playing = ctx.state === 'playing' && p && !p.dead;
  let label = '';
  if (playing) {
    if (S.mounted) label = S.mounted.spec.car ? 'EXIT' : 'GET OFF';
    else if (!p.mounted) { const b = S.api.nearBike; if (b) label = b.spec.car ? 'ENTER' : 'RIDE'; else if (nearParked()) label = 'STEAL'; }
  }
  if (label !== U.label) { U.label = label; U.enter.textContent = label; U.enter.classList.toggle('show', !!label); }
  U.cam.classList.toggle('show', playing && !!S.mounted); U.cam.classList.toggle('on', S.chase);
  U.root.classList.toggle('car', !!(S.mounted?.spec?.car || (!S.mounted && S.api.nearBike?.spec?.car)));   // landscape: a car's ENTER/CAM can move to the bottom-right corner (FIRE etc. are stowed); a bike's can't - it keeps its own

  // touch.js' contextual button duplicates ours for RIDE / GET OFF — hide it then (it still shows TAKE for weapon pickups)
  const act = U.act || (U.act = document.querySelector('#touch .act'));
  if (act) { const t = act.textContent || ''; act.classList.toggle('vhdup', !!label && (t === 'RIDE' || t === 'GET OFF') && (!!S.mounted || !!S.api.nearBike)); }
}

let _fx = null; const fx = () => _fx || (_fx = createWaterFX(C));
/** moored / abandoned jet skis ride the swell; spray + wake + engine for the one you're on */
function waterFrame(dt) {
  const O = C.world?.ocean; if (!O || dt <= 0) return;
  for (const v of S.bikes) {
    if (!v.spec.water || v === S.mounted) continue;
    const wy = O.waveHeight(v.pos.x, v.pos.z), rest = Math.max(wy - v.spec.draft, groundY(v.pos.x, v.pos.z) + 0.06);
    v.pos.y = damp(v.pos.y, rest, 6, dt); v.wet = true; v.air = false; v.throttle = 0; v.fwdSpeed = v.speed = 0; v.yawRate = 0; visualsWater(v, dt);
  }
  const m = S.mounted;
  if (m?.spec.water) { fx().ride(m, dt); if (m.splash > 0.15) { fx().burst(m, m.splash); try { C.audio?.play?.('impact_water', { position: m.pos, volume: Math.min(1.2, m.splash) }); } catch {} } m.splash = 0; }
  if (_fx) _fx.update(dt);
}

// ---------- module ----------
export async function init(ctx) {
  C = ctx;
  if (ctx.safeMode) S.grid = new BoxGrid(SAFE_GRID_CELL);   // safe mode (ctx.js): coarser cells, fewer grid entries over ~70k colliders
  try { placeBikes(); } catch (e) { console.error('[vehicles] placement failed', e); }
  ctx.bus.on('ui:mount', () => { S.uiMount = true; });
  ctx.bus.on('impact', (e) => { try { onShot(e); } catch (err) { console.warn('[vehicles] shot', err); } });   // bullets into cars: holes, glass, panels
  ctx.bus.on('shot', (e) => { try { onPlayerShot(e); } catch (err) { console.warn('[vehicles] shot', err); } });
  try { buildUI(ctx); } catch (e) { console.warn('[vehicles] ui', e); }
  S.chase = !!ctx.isTouch && ctx.qs?.get?.('chase') !== '0';   // phones start in the chase cam (small screen, cabin view is cramped); V / CAM toggles
  const api = {
    list: S.bikes, get mounted() { return S.mounted; }, nearBike: null,
    mount: (bike) => mount(bike || nearestBike()), dismount,
    /** Third-person chase camera (V key / CAM button on touch). */
    get chase() { return S.chase; }, set chase(v) { setChase(v); }, toggleCamera: () => setChase(!S.chase),
    /** Touch hook: tap = the same as pressing F (enter / exit / steal). */
    use: () => { S.uiMount = true; },
    /** an AI car hit the car you drive (traffic.js etc. resolve the push): other = the AI car, { nx, nz } from it to you, vn the closing speed (< 0) */
    hit: (other, impulse) => aiHit(other, impulse),
    /** qa: damage of a car (or the one you drive), make a parked car live */
    qaDamage: (b) => damageState(b || S.mounted), qaPromote: (c) => promote(c), qaSmokeActive: () => qaSmokeActive(),
    /** qa: force a pane/panel state directly (friend-car-test: deterministic damage sync, no aiming) */
    qaHitPane: (name, n = 1, b = S.mounted) => hitPane(C, b, name, n), qaDetachPanel: (name, b = S.mounted) => detach(C, b, name),
    /** windows: the driver's own side pane by default; name picks any pane (qa, or a future passenger seat) */
    driverPane: (b) => driverPane(b || S.mounted), driverDoor: (b) => driverDoor(b || S.mounted),
    qaWindow(name, b = S.mounted) { return toggleWindow(b, name || driverPane(b)); },
    qaWindowOpen(name, b = S.mounted) { return windowOpen(b, name || driverPane(b)); },
    qaSwingDoor(name, b = S.mounted) { return swingDoor(b, name || driverDoor(b)); },
    dismount: () => dismount(),
    spawnCar: (x, z, yaw, kind, color, y, panels) => makeCar(x, z, yaw, kind, color, y ?? ctx.player?.position.y ?? 0, panels ?? true),
    qaSpawn(x, z, yaw = 0, y = ctx.player?.position.y ?? 0) { S.grid.sync(ctx.colliders); const b = makeBike(x, z, yaw, y); S.grid.build(ctx.colliders); ctx.player?.rebuildColliders?.(); return b; },
    qaSpawnEbike(x, z, yaw = 0, variant = 'citibike', y = ctx.player?.position.y ?? 0) { S.grid.sync(ctx.colliders); const b = makeEbike(x, z, yaw, variant, y); S.grid.build(ctx.colliders); ctx.player?.rebuildColliders?.(); return b; },
    qaSpawnScooter(x, z, yaw = 0, variant = 'kick', y = ctx.player?.position.y ?? 0) { S.grid.sync(ctx.colliders); const b = makeScooter(x, z, yaw, variant, y); S.grid.build(ctx.colliders); ctx.player?.rebuildColliders?.(); return b; },
    qaMount() { const b = nearestBike(); if (!b) return false; return mount(b); },
    /** jet skis: list + stand next to one (from the beach side) */
    get jetskis() { return S.bikes.filter((b) => b.spec.water); },
    qaJetskis() { return S.bikes.filter((b) => b.spec.water).map((b) => ({ x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), heading: +b.heading.toFixed(3), mounted: b === S.mounted })); },
    qaFx() { return _fx ? { spray: _fx.pts.visible, wake: _fx.wake.visible } : null; },
    /** Drive with fixed inputs for `seconds`; resolves when done. throttle: -1..1 (negative = brake/reverse), steer: -1..1 (+ = right), opts {hard} */
    qaJump(charge = 0.6) { const b = S.mounted; if (!b || b.spec?.car || b.air) return false; b.air = true; b.vy = 4.2 + 3.8 * Math.min(1, charge / 0.6) + Math.min(1, Math.abs(b.fwdSpeed || 0) / 22) * 1.8; return true; },
    qaDrive(throttle = 1, steer = 0, seconds = 3, opts = {}) { if (!S.mounted) api.qaMount(); if (!S.mounted) return Promise.resolve(false); if (S.qa) S.qa.res(false); return new Promise((res) => { S.qa = { thr: throttle, steer, t: seconds, hard: !!opts.hard, res }; }); },
    qaState() { const b = S.mounted; return b ? { x: b.pos.x, y: b.pos.y, z: b.pos.z, heading: b.heading, speed: b.speed, fwd: b.fwdSpeed, lean: b.lean, steer: b.steer, skid: b.skid, air: b.air, surf: Object.keys(SURF).find((k) => SURF[k] === b.surf), car: !!b.spec.car, chase: S.chase, kind: b.spec.kind, pitch: b.tPitch, roll: b.tRoll, water: b.surfY ?? null, depth: b.depth ?? null, beached: !!b.beached } : null; },
    /** Driving-feel lab (qa/drive-feel-test.mjs): drive the mounted vehicle step by step in a sealed world of test boxes only
     *  (flat ground at y, hard surface), with the chase camera + speed FOV running, then put everything back. */
    qaTouch: (ax, ay, car = true, fwd = 0) => touchDrive(ax, ay, car, fwd),
    qaLab: {
      begin(boxes = [], x, z, heading = 0, speed = 0, ground = []) { const v = S.mounted; if (!v) return false;
        S.lab = { grid: S.grid, chase: S.chase, fov: C.settings.fov, fovBase: S.fovBase, fovWritten: S.fovWritten, pos: v.pos.clone(), heading: v.heading, gh: C.world.groundHeight, clamp: C.world.playClamp, surfaceAt: C.world.surfaceAt };
        const g = new BoxGrid(4); g.build(boxes.map((b) => new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])))); S.grid = g;
        C.world.groundHeight = (gx, gz) => { let h = 0; for (const r of ground) if (gx >= r[0] && gx <= r[2] && gz >= r[1] && gz <= r[3]) h = Math.max(h, r[4]); return h; };   // ground: [x0, z0, x1, z1, height] kerb / pavement slabs
        C.world.playClamp = null; C.world.surfaceAt = () => 'concrete';   // was swallowed by the comment above: the lab ran on whatever surface the spawn had
        v.pos.set(x, 0, z); v.heading = heading; fwdOf(heading, _f); v.vel.copy(_f).multiplyScalar(speed); v.fwdSpeed = v.speed = speed;
        Object.assign(v, { steer: 0, skid: 0, vy: 0, air: false, susp: 0, suspV: 0, throttle: 0, groundVy: 0, aLong: 0, yawRate: 0, boost: 0, hitT: 0, surf: SURF.hard, surfT: 0 });
        setChase(true); S.chaseYaw = heading; S.chaseY = 0; S.lookYaw = S.lookPitch = 0; S.idleT = 99; S.fovBase = S.lab.fov; S.fovWritten = -1; return true; },
      step(dt, thr = 0, brk = 0, hard = false, steer = 0) { const v = S.mounted; if (!v || !S.lab) return null;
        simulate(v, dt, thr, brk, hard, steer); speedFov(v); applyView(dt);
        fwdOf(v.heading, _f); _r.set(-_f.z, 0, _f.x); const cam = C.camera.position;
        return { x: v.pos.x, y: v.pos.y, z: v.pos.z, heading: v.heading, fwd: v.fwdSpeed, lat: v.vel.x * _r.x + v.vel.z * _r.z, speed: v.speed, yawRate: v.yawRate, steer: v.steer, skid: v.skid, air: v.air, roll: v.lean + v.tRoll,
          camYaw: Math.atan2(v.pos.x - cam.x, v.pos.z - cam.z) + Math.PI, camDist: Math.hypot(cam.x - v.pos.x, cam.z - v.pos.z), camY: cam.y - v.pos.y, camX: cam.x, camZ: cam.z, fov: C.settings.fov }; },
      end() { const v = S.mounted, L = S.lab; if (!L) return; S.grid = L.grid; C.world.groundHeight = L.gh; C.world.playClamp = L.clamp; C.world.surfaceAt = L.surfaceAt;
        if (v) { v.pos.copy(L.pos); v.heading = L.heading; v.vel.set(0, 0, 0); v.speed = v.fwdSpeed = 0; }
        C.settings.fov = L.fov; S.fovBase = L.fovBase; S.fovWritten = L.fovWritten; setChase(L.chase); S.lab = null; },
    },
    /** Deterministic replay at a fixed frame rate from the current state (restored afterwards): {fps, seconds, thr, steer, hard} → end pose + max per-frame pos jerk. */
    qaSim({ fps = 60, seconds = 3, thr = 1, steer = 0, hard = false } = {}) {
      const v = S.mounted; if (!v) return null;
      const save = { pos: v.pos.clone(), vel: v.vel.clone(), heading: v.heading, steer: v.steer, skid: v.skid, vy: v.vy, air: v.air, susp: v.susp, suspV: v.suspV, throttle: v.throttle, groundVy: v.groundVy, aLong: v.aLong };
      const dt = 1 / fps, n = Math.round(seconds * fps); let prev = null, prev2 = null, jerk = 0, ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i < n; i++) {
        simulate(v, dt, Math.max(0, thr), Math.max(0, -thr), hard, steer);
        const cur = v.pos.clone(); ymin = Math.min(ymin, cur.y); ymax = Math.max(ymax, cur.y);
        if (prev && prev2) { const a = cur.clone().sub(prev).sub(prev.clone().sub(prev2)).length() / (dt * dt); jerk = Math.max(jerk, a); }
        prev2 = prev; prev = cur;
      }
      const out = { x: +v.pos.x.toFixed(3), y: +v.pos.y.toFixed(3), z: +v.pos.z.toFixed(3), heading: +v.heading.toFixed(4), speed: +v.speed.toFixed(3), maxAccel: +jerk.toFixed(2), ymin: +ymin.toFixed(3), ymax: +ymax.toFixed(3) };
      Object.assign(v, { heading: save.heading, steer: save.steer, skid: save.skid, vy: save.vy, air: save.air, susp: save.susp, suspV: save.suspV, throttle: save.throttle, groundVy: save.groundVy, aLong: save.aLong }); v.pos.copy(save.pos); v.vel.copy(save.vel);
      visuals(v, 0.016, 0, 0, false); applyView(0);
      return out;
    },
  };
  S.api = api; return api;
}

/** Touch stick → {steer, thr, brake}: up = gas, down = brake / reverse, sideways = steer. Cars get a softer centre (fine
 *  corrections at speed) and cruise throttle while the stick is held sideways and rolling forward, so steering never coasts you
 *  to a stop; bikes keep their own curve. */
function touchDrive(ax, ay, car, fwd) {
  const dz = car ? 0.1 : 0.12, span = car ? 0.72 : 0.7, curve = car ? 1.6 : 1.2;
  const steer = Math.abs(ax) > dz ? Math.sign(ax) * clamp((Math.abs(ax) - dz) / span, 0, 1) ** curve : 0;
  let thr = ay < -0.15 ? clamp((-ay - 0.15) / 0.55, 0, 1) : 0; const brake = ay > 0.2 ? clamp((ay - 0.2) / 0.55, 0, 1) : 0;
  if (car && !brake && Math.abs(ax) > 0.3 && fwd > 1) thr = Math.max(thr, TOUCH_CRUISE);
  return { steer, thr, brake };
}
/** speed FOV kick: written through settings.fov so weapons' ADS fov logic composes with it */
function speedFov(bike) {
  if (S.fovWritten > 0 && Math.abs(C.settings.fov - S.fovWritten) > 1e-6) S.fovBase = C.settings.fov; // user moved the slider while riding
  const kick = FOV_KICK * clamp(Math.abs(bike.fwdSpeed) / bike.spec.max, 0, 1.4) ** 1.3 + (bike.boost || 0) * 8;
  S.fovWritten = S.fovBase + kick; C.settings.fov = S.fovWritten;
}
// a parked car's cabin (~20 meshes, carkit.js carInterior) only draws within CABIN_LOD m: past that the tinted glass hides it anyway
const CABIN_LOD = 35;
function cabinLod(ctx) { const cam = ctx.camera?.position; if (!cam) return; for (const v of S.bikes) if (v.cabin) v.cabin.visible = v === S.mounted || Math.hypot(v.pos.x - cam.x, v.pos.z - cam.z) < CABIN_LOD; }
export function update(dt, ctx) {
  for (const b of S.bikes) if (b.sliding && b !== S.mounted && dt > 0) slide(b, Math.min(dt, 0.05));
  try { updateDamage(ctx, S.bikes, dt); } catch (e) { if (!S.dmgErr) { S.dmgErr = 1; console.error('[vehicles] damage', e); } }
  const p = ctx.player; if (!p) return;
  // riding along in a friend's car (hangkit.js: not driving ourselves, not the Uber which has its own haze path): the
  // driver owns the real car and reports its haze on the wire (net.js vi.s) - we just paint the same overlay they'd see
  let haze = S.mounted?.spec?.car ? (S.mounted.haze || 0) : 0;
  if (!haze && p.mounted?.passenger && !p.mounted.uber) { const V = hangkitKit(), q = V?.passenger && ctx.net?.peer?.(V.passenger.id); if (q?.veh?.s) haze = q.veh.s; }
  hazeOverlay(haze);
  const input = ctx.input;
  cabinLod(ctx);
  S.grid.sync(ctx.colliders);
  try { waterFrame(dt); } catch (e) { if (!S.wErr) { S.wErr = 1; console.warn('[vehicles] water', e); } }
  const playing = ctx.state === 'playing' && !p.dead;
  if (S.mounted && p.dead) { dismount(); updateUI(ctx); return; }
  // F is only consumed when it means something to us (mounted, or a vehicle in reach that is closer than a weapon pickup) — ai.js / hangout read it after us
  const fHeld = playing && (input.pressed?.has?.('KeyF') || S.uiMount); S.uiMount = false;
  if (playing && input.pressed?.has?.('KeyV') && S.mounted) { input.pressed.delete('KeyV'); setChase(!S.chase); }
  if (!S.mounted) {
    const b = p.mounted ? null : nearestBike(); S.api.nearBike = b;
    if (b && playing) {
      const dBike = Math.hypot(b.pos.x - p.position.x, b.pos.z - p.position.z) - Math.max(b.spec.hx, b.spec.hz) * 0.5;
      const dGun = ctx.ai?.nearPickupDist; const gunWins = typeof dGun === 'number' && dGun < dBike;
      // a friend's car closer than this one: F hops in with them (hangkit), it doesn't steal the car parked behind them
      let dFriend = Infinity; const net = ctx.net; if (net?.list) for (const id of net.list()) { const q = net.peer(id); if (q?.veh && q.veh.k !== 'pass' && q.pos) dFriend = Math.min(dFriend, Math.hypot(q.pos.x - p.position.x, q.pos.z - p.position.z)); }
      const dUber = ctx.uber?.boardDist?.(p.position) ?? Infinity;   // a waiting Uber (coney/uber.js) at the kerb wins the same way
      const friendWins = Math.min(dFriend, dUber) < 3.8 && Math.min(dFriend, dUber) < dBike + 0.5;
      if (!gunWins && !friendWins) { S.toastT -= dt; if (S.toastT <= 0) { S.toastT = 0.35; ctx.hud?.toast?.(b.spec.car ? 'F — DRIVE' : 'F — RIDE', 600); } if (fHeld) { input.pressed?.delete?.('KeyF'); mount(b); } }
    }
    updateUI(ctx);
    return;
  }
  S.api.nearBike = null;
  if (fHeld) { input.pressed?.delete?.('KeyF'); dismount(); updateUI(ctx); return; }
  updateUI(ctx);
  if (dt <= 0) { applyView(0); return; }
  const bike = S.mounted, sp = bike.spec;
  if (sp.car && playing && input.pressed?.has?.('KeyO')) { input.pressed.delete('KeyO'); const t = toggleWindow(bike, driverPane(bike)); if (t != null) ctx.hud?.toast?.(t ? 'Window down' : 'Window up', 900); }
  // read look deltas the player applied after our last write (mouse + recoil) into the free-look offset
  S.lookYaw += wrap(p.yaw - S.wroteYaw); S.lookPitch += p.pitch - S.wrotePitch;
  S.mountT += dt;
  const moved = Math.abs(input.mouse?.dx || 0) + Math.abs(input.mouse?.dy || 0) > 0.5;
  S.idleT = moved ? 0 : S.idleT + dt;
  const lim = S.chase ? Math.PI : sp.lookYaw;
  S.lookYaw = S.chase ? wrap(S.lookYaw) : clamp(S.lookYaw, -lim, lim); S.lookPitch = clamp(S.lookPitch, -LOOK_PITCH, LOOK_PITCH);
  if (S.idleT > (S.chase ? 1.2 : 0.6)) { S.lookYaw = damp(S.lookYaw, 0, S.chase ? 2 : 3.5, dt); S.lookPitch = damp(S.lookPitch, 0, 2.5, dt); }
  // inputs: keyboard, or the touch stick (analog: up = gas, down = brake/reverse, sideways = steer)
  let thr = 0, brake = 0, hard = false, steer = 0;
  if (S.qa) { const q = S.qa; thr = Math.max(0, q.thr); brake = Math.max(0, -q.thr); hard = q.hard; steer = q.steer; q.t -= dt; if (q.t <= 0) { S.qa = null; q.res(); } }
  else if (ctx.state === 'playing') {
    const key = (c) => input.down ? input.down(c) : input.keys?.has?.(c);
    thr = key('KeyW') || key('ArrowUp') ? 1 : 0; brake = key('KeyS') || key('ArrowDown') ? 1 : 0; hard = !!input.jump;
    steer = (key('KeyD') || key('ArrowRight') ? 1 : 0) - (key('KeyA') || key('ArrowLeft') ? 1 : 0);
    const ax = input.touch?.axis?.x || 0, ay = input.touch?.axis?.y || 0;
    if (ax || ay) { const t = touchDrive(ax, ay, sp.car, bike.fwdSpeed); if (t.steer) steer = t.steer; thr = Math.max(thr, t.thr); brake = Math.max(brake, t.brake); }
    // VR: your hands on the wheel / the bars (src/vr/physical.js) steer, and with tracked hands push / pull is gas / brake
    if (input.xrSteer != null) steer = clamp(input.xrSteer, -1, 1);
    if (input.xrThrottle != null) { const t = input.xrThrottle; if (t > 0) thr = Math.max(thr, t); else if (t < 0) brake = Math.max(brake, -t); }
    // nitro: hold Shift with the gas down (phones: stick pushed all the way up) — ~4 s of boost, refills in ~12 s
    const want = ((key('ShiftLeft') || key('ShiftRight')) && thr > 0.3) || ay < -0.92;
    S.nitro = S.nitro ?? 1;
    if (want && S.nitro > 0.02) { S.nitro = Math.max(0, S.nitro - dt / 4); bike.boost = damp(bike.boost || 0, 1, 8, dt); if (!S.nitroOn) { S.nitroOn = true; ctx.hud?.toast?.('NITRO', 700); } }
    else { S.nitro = Math.min(1, S.nitro + dt / 12); bike.boost = damp(bike.boost || 0, 0, 5, dt); S.nitroOn = false; }
    nitroBar(S.nitro, bike.boost);
    if (!bike.spec?.car) {   // bikes: Space jumps — hold to load the suspension, release to hop (higher with speed)
      if (hard && !bike.air) { bike.jumpCharge = Math.min(0.6, (bike.jumpCharge || 0) + dt); bike.suspV -= dt * 3; }
      else if (!hard && bike.jumpCharge > 0) { if (!bike.air) { const k = bike.jumpCharge / 0.6; bike.air = true; bike.vy = 4.2 + 3.8 * k + Math.min(1, Math.abs(bike.fwdSpeed || 0) / 22) * 1.8; bike.groundVy = 0; try { ctx.audio?.play?.('impact', { position: bike.pos, volume: 0.25 }); } catch {} } bike.jumpCharge = 0; }
      hard = false;
    }
  }
  simulate(bike, dt, thr, brake, hard, steer);
  remoteBump(bike);   // friends' cars are solid to yours (each client drives its own; this keeps them from passing through each other)
  runOver(bike, dt);
  { const drop = (bike.lastSpd ?? bike.speed) - bike.speed; bike.lastSpd = bike.speed;   // a crash: lost a lot of speed in one frame against something solid
    if (drop > 6 && !bike.air && performance.now() - (bike.crashT || 0) > 600) { bike.crashT = performance.now(); const k = Math.min(1, drop / 20), H = bike.lastHit && performance.now() - bike.lastHit.t < 200 ? bike.lastHit : null;
      const at = H ? new THREE.Vector3(H.x, bike.pos.y + 0.6, H.z) : bike.pos.clone().setY(bike.pos.y + 0.6);
      crunch(bike, at, k);
      if (!bike.spec.car && drop > 12) C.hud?.toast?.('*CRUNCH* …you ate the bumper', 1400);
      if (bike.spec.car) try { damageHit(C, bike, drop, H ? at : null, H ? new THREE.Vector3(H.nx, 0, H.nz) : null); } catch (e) { console.warn('[vehicles] damage', e); } } }   // dents, panels, glass, lights out, smoke, fire, boom (vehicledamage.js)
  speedFov(bike);
  S.revT -= dt;
  if (thr > 0 && S.revT <= 0) { S.revT = 1.6; if (!sp.car) try { ctx.audio?.play?.('bike_rev', { position: bike.pos, volume: 0.5 + 0.5 * clamp(bike.speed / sp.max, 0, 1) }); } catch {} }
  applyView(dt);
}

export function reset(ctx) {
  if (S.mounted) dismount();
  for (const b of S.bikes) {
    b.pos.set(b.home.x, b.home.y, b.home.z); b.vy = 0; b.air = false; b.heading = b.home.yaw; b.vel.set(0, 0, 0); b.speed = b.fwdSpeed = 0; b.steer = b.lean = b.susp = b.suspV = b.skid = b.tPitch = b.tRoll = 0;
    b.group.position.copy(b.pos); b.group.rotation.set(0, b.heading, 0); b.body.position.y = 0; b.body.rotation.set(0, 0, 0); b.fork.rotation.y = 0; b.parked = true; parkBox(b);
  }
  rebuildGrids(); S.qa = null; S.lookYaw = S.lookPitch = 0; S.hits.clear();
}

// Car damage (GTA style) for every drivable car (driven, stolen, a parked car that got rammed or shot: vehicles.js promotes it).
// Health HP; a crash costs 6·(speed lost)² (≤ HIT_MAX a hit) at the point it hit. Visible damage, all pooled and capped:
// - dents: the body's vertices pushed in round the impact (desktop; phones darken the panel instead), the geometry cloned on the first one
// - panels (carkit panels: hood, trunk, front fenders, doors, bumpers) take the hit near them: dented, then hanging (a bumper drops an
//   end, the hood pops, a door swings ajar), then off as a tumbling piece that lands and despawns (MAX_DEBRIS, phones 2)
// - glass panes crack (a spidered map) then shatter into falling shards and are gone
// - bullet holes: decals on the body (one InstancedMesh a car, capped), glass cracks under fire
// - lamps go out once that end has taken LIGHTS_AT; white smoke under 40 %, black smoke and fire under 15 %, at 0 a fuse, an
//   explosion ('explosion' on the bus: the audio and blast damage already listen) and a charred wreck put back as new a minute later
// - sparks and glass bits at a crash (one pooled sprite set: nothing when no car is hurt)
import * as THREE from 'three';
import { carMaterials } from './world/carkit.js';

const HP = 2500, SMOKE_AT = 1000, FIRE_AT = 375, FUSE = 4, WRECK_T = 60, HIT_MAX = 400, LIGHTS_AT = 300;
const BIKE_HP = 900;   // a motorcycle/e-bike's own hp (cars use HP above): high enough that one hard hit (capped at HIT_MAX) damages
// and smokes it without instantly maxing the fuse/explosion path that vehicledamage.js already runs for a wrecked car
// smoke/fire/lights fire at the same fractions of whichever max applies
const SMOKE_FRAC = SMOKE_AT / HP, FIRE_FRAC = FIRE_AT / HP, LIGHTS_FRAC = LIGHTS_AT / HP;
const WIN_T = 0.3, WIN_DROP = 0.42;   // window roll: seconds to fully travel, metres it slides down into the door
const DOOR_SWING = 0.5, DOOR_OPEN_T = 0.22, DOOR_HOLD_T = 0.35, DOOR_CLOSE_T = 0.45;   // a short hinge pulse on entry / exit
const PANEL_HP = 260, HANG_AT = 0.45, BULLET_PANEL = 14, BULLET_HP = 12, PANE_CRACK = 1, PANE_SHATTER = 3, CRASH_PANE = 90;   // panel health, the fraction left when it hangs; a bullet's share; hits to crack / shatter a pane; crash damage that breaks glass near it
const HOLES = 24, HOLES_LITE = 8, MAX_DEBRIS = 6, MAX_DEBRIS_LITE = 2, DEBRIS_T = 20, SHARDS = 120, SHARDS_PER = 14, PANEL_R = 1.25;   // decal / debris / shard caps; debris lifetime (s); crash reach to a panel's centre (m)
let POOL = null, CHAR = null, DARK = null, HOLE_MAT = null, CRACK_MAT = null, SHARD_IM = null;
const SHARD_LIST = [], DEBRIS = [], _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _z = new THREE.Vector3(0, 0, 1);
const lite = (C) => !!C?.lite;
function pool(scene) {
  if (POOL) return POOL; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); POOL = [];
  for (let i = 0; i < 48; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; s.userData.t = 1e9; scene.add(s); POOL.push(s); }
  return POOL;
}
const PUFF = { fire: { life: 0.35, s0: 0.9, ds: -0.5, a: 0.9, col: 0xff8a2a, add: true, vy: 1.6 }, black: { life: 2.2, s0: 0.6, ds: 2.2, a: 0.55, col: 0x1a1a1a, vy: 1.1 }, white: { life: 2.2, s0: 0.6, ds: 2.2, a: 0.55, col: 0xd8d8d8, vy: 1.1 },
  spark: { life: 0.45, s0: 0.12, ds: -0.1, a: 1, col: 0xffc060, add: true, vy: 2.5, g: 14, spread: 7 }, dust: { life: 0.9, s0: 0.4, ds: 1.4, a: 0.35, col: 0x9a948a, vy: 0.6 } };
function puff(scene, pos, kind, vel = null) {
  const P = pool(scene), s = P.find((q) => !q.visible) || P[0], K = PUFF[kind]; s.visible = true; s.position.copy(pos);
  const sp = K.spread || 0.4; s.userData = { t: 0, life: K.life * (0.7 + Math.random() * 0.6), kind, v: new THREE.Vector3((Math.random() - 0.5) * sp, K.vy * (0.5 + Math.random()), (Math.random() - 0.5) * sp) };
  if (vel) s.userData.v.addScaledVector(vel, 0.4);
  s.material.color.set(K.col); s.material.blending = K.add ? THREE.AdditiveBlending : THREE.NormalBlending; s.scale.setScalar(K.s0);
}
const ends = (bike) => { const m = bike.group; m.updateMatrixWorld(); return m; };

// ---- per-car damage state: the panels / panes vehicles.js split out (bike.panels: { name: { mesh, shell?, pivot?, kind } }) ----
function holes(C, b) {
  if (b.holes) return b.holes; if (!b.kit) return null;
  if (!HOLE_MAT) HOLE_MAT = new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const g = new THREE.PlaneGeometry(0.07, 0.07), im = new THREE.InstancedMesh(g, HOLE_MAT, lite(C) ? HOLES_LITE : HOLES); im.count = 0; im.frustumCulled = false; im.name = 'carHoles';
  b.kit.add(im); b.holes = { im, n: 0 }; return b.holes;
}
function holeTex() {   // a bullet hole: dark puncture, a bright chipped-paint ring, a faint scorch
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  let gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(10,10,10,1)'); gr.addColorStop(0.22, 'rgba(15,15,15,1)'); gr.addColorStop(0.3, 'rgba(200,200,200,0.95)'); gr.addColorStop(0.45, 'rgba(120,120,120,0.6)'); gr.addColorStop(1, 'rgba(40,40,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function crackTex() {   // spidered safety glass on the tint colour: radial cracks from a few impact points and rings between them
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#0f1a1d'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(225,235,240,0.85)'; g.lineWidth = 1;
  for (const [cx, cy] of [[90, 120], [180, 80], [150, 190]]) { const n = 11 + ((cx * 7) % 5);
    for (let i = 0; i < n; i++) { let a = i / n * Math.PI * 2 + (cx % 3) * 0.2, x = cx, y = cy; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { a += Math.sin(cx + i * 3.1 + k) * 0.25; x += Math.cos(a) * 18; y += Math.sin(a) * 18; g.lineTo(x, y); } g.stroke(); }
    for (const r of [12, 26, 44]) { g.beginPath(); for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2, rr = r * (0.85 + 0.3 * Math.abs(Math.sin(i * 2.3 + cx))); i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.stroke(); }
    g.fillStyle = 'rgba(240,245,248,0.9)'; g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function crackMat() { return CRACK_MAT || (CRACK_MAT = new THREE.MeshStandardMaterial({ name: 'car_glassCracked', map: crackTex(), roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88, depthWrite: false })); }
function shards(scene) {
  if (SHARD_IM) return SHARD_IM; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.07, 0.02, 0, 0.02, 0.08, 0], 3)); g.computeVertexNormals();
  SHARD_IM = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xb8c8cf, roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), SHARDS); SHARD_IM.count = 0; SHARD_IM.frustumCulled = false; SHARD_IM.name = 'carShards'; scene.add(SHARD_IM); return SHARD_IM;
}
function spawnShards(C, at, vel, n = SHARDS_PER) {
  shards(C.scene); for (let k = 0; k < (lite(C) ? n >> 1 : n); k++) { if (SHARD_LIST.length >= SHARDS) SHARD_LIST.shift();
    SHARD_LIST.push({ p: at.clone().add(_v.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.5)), v: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3).addScaledVector(vel || _v.set(0, 0, 0), 0.5), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), t: 0 }); }
}
/** a pane: cracked (hits >= PANE_CRACK), then shattered (>= PANE_SHATTER: hidden, shards fall, the window is open) */
function hitPane(C, b, name, n = 1) {
  const P = b.panes?.[name]; if (!P || P.state === 2) return; P.hits = (P.hits || 0) + n;
  if (P.hits >= PANE_SHATTER) { P.state = 2; P.mesh.visible = false; P.mesh.geometry.computeBoundingBox(); const ctr = P.mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(P.mesh.matrixWorld);
    spawnShards(C, ctr, b.vel); try { C.audio?.play?.('glass', { position: ctr, volume: 1 }); } catch {} }
  else if (P.hits >= PANE_CRACK && P.state === 0) { P.state = 1; P.mat0 = P.mesh.material; P.mesh.material = crackMat(); try { C.audio?.play?.('glass', { position: b.pos, volume: 0.45 }); } catch {} }
}
/** a panel: dent → hang (HANG_AT of its health left) → off (debris). Panels on phones go dark instead of denting. */
function hitPanel(C, b, name, dmg) {
  const P = b.panels?.[name]; if (!P || P.state === 3) return; P.hp = (P.hp ?? PANEL_HP) - dmg;
  if (lite(C) && P.hp < PANEL_HP * 0.8 && !P.dark) { P.dark = true; for (const m of [P.mesh]) { m.userData.mat0 = m.material; const d = m.material.clone(); d.color.multiplyScalar(0.55); d.roughness = 0.75; m.material = d; } }
  if (P.hp <= 0) return detach(C, b, name);
  if (P.hp < PANEL_HP * HANG_AT && P.state < 2) { P.state = 2; hang(P, name); }
  else if (P.state < 1) P.state = 1;
}
function hang(P, name) {
  const piv = P.pivot; if (!piv) return;
  if (name.startsWith('bumper')) { piv.rotation.x = (Math.random() < 0.5 ? 1 : -1) * 0.12; piv.position.y -= 0.06; }          // one end drops
  else if (name === 'hood') piv.rotation.z = 0.12;                                                                                  // popped at the latch
  else if (name === 'trunk') piv.rotation.z = -0.1;
  else if (name.startsWith('door')) { P.ajar = 0.32; piv.rotation.y = (name.endsWith('R') ? 1 : -1) * P.ajar; piv.rotation.x = (name.endsWith('R') ? -1 : 1) * 0.04; }   // sprung, sagging on its hinge
  else if (name.startsWith('fender')) { piv.rotation.x = (name.endsWith('R') ? 1 : -1) * 0.06; piv.position.y -= 0.03; }
}
function detach(C, b, name) {
  const P = b.panels[name]; P.state = 3; const m = P.mesh; m.updateMatrixWorld(true);
  const max = lite(C) ? MAX_DEBRIS_LITE : MAX_DEBRIS; while (DEBRIS.length >= max) dropDebris(DEBRIS[0]);
  m.geometry.computeBoundingBox(); const ctr = m.geometry.boundingBox.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(), piece = new THREE.Mesh(m.geometry, m.material); piece.position.copy(ctr).negate(); holder.add(piece); piece.castShadow = true;
  m.matrixWorld.decompose(holder.position, holder.quaternion, _s); holder.position.copy(ctr.clone().applyMatrix4(m.matrixWorld)); C.scene.add(holder);
  const out = holder.position.clone().sub(b.pos).setY(0).normalize();
  DEBRIS.push({ g: holder, v: b.vel.clone().multiplyScalar(0.8).addScaledVector(out, 2.5).setY(2 + Math.random() * 1.5), w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6), t: 0, rest: false });
  m.visible = false; if (P.shell) P.shell.visible = false; if (P.glass) for (const g of P.glass) hitPane(C, b, g, PANE_SHATTER);
  try { C.audio?.play?.('impact_metal', { position: holder.position, volume: 1 }); } catch {}
}
function dropDebris(d) { d.g.removeFromParent(); DEBRIS.splice(DEBRIS.indexOf(d), 1); }

/** Roll a side window up/down (panes glassFL / glassFR / glassRL / glassRR). A shattered pane (#183) is already open and
 *  can't be rolled either way. Returns the new target (0 up, 1 down) or null if that car has no such window. */
export function toggleWindow(car, name) {
  const P = car?.panes?.[name]; if (!P || P.state === 2) return null;
  if (P.y0 == null) P.y0 = P.mesh.position.y;
  P.winT = P.winT ? 0 : 1; return P.winT;
}
/** Is a window open enough to shoot or lean through: fully down, or already shattered. */
export function windowOpen(car, name) {
  const P = car?.panes?.[name]; if (!P) return true;   // no split panes (a merged/parked body): nothing to gate
  return P.state === 2 || (P.win || 0) > 0.5;
}
/** A short hinge pulse on a door panel's pivot when someone gets in or out. A no-op once the door is hanging / off (#183). */
export function swingDoor(car, name) {
  const P = car?.panels?.[name]; if (!P || !name.startsWith('door') || P.state >= 2) return;
  P.doorT = 0;
}
/** per frame, every car: ease window panes toward their rolled target, and run any door-swing pulse */
function updateInterop(bikes, dt) {
  for (const b of bikes) {
    if (!b.spec?.car) continue;
    if (b.panes) for (const P of Object.values(b.panes)) {
      if (P.winT == null) continue;
      if (P.y0 == null) P.y0 = P.mesh.position.y;
      const cur = P.win || 0, d = P.winT - cur;
      if (Math.abs(d) > 1e-4) P.win = Math.max(0, Math.min(1, cur + Math.sign(d) * Math.min(Math.abs(d), dt / WIN_T)));
      P.mesh.position.y = P.y0 - WIN_DROP * (P.win || 0);
    }
    if (b.panels) for (const [n, P] of Object.entries(b.panels)) {
      if (P.doorT == null) continue;
      if (P.state >= 2) { P.doorT = null; continue; }   // it came off / is hanging: the crash animation owns the pivot now
      P.doorT += dt; const sign = n.endsWith('R') ? 1 : -1; let k;
      if (P.doorT < DOOR_OPEN_T) k = P.doorT / DOOR_OPEN_T;
      else if (P.doorT < DOOR_OPEN_T + DOOR_HOLD_T) k = 1;
      else if (P.doorT < DOOR_OPEN_T + DOOR_HOLD_T + DOOR_CLOSE_T) k = 1 - (P.doorT - DOOR_OPEN_T - DOOR_HOLD_T) / DOOR_CLOSE_T;
      else { P.pivot.rotation.y = 0; P.doorT = null; continue; }
      P.pivot.rotation.y = sign * DOOR_SWING * k;
    }
  }
}

/** a crash: speed lost in one frame. `at` (world point) / `dir` (world, the push into the car) when known. Returns the damage dealt.
 *  Cars and bikes (motorcycles, e-bikes) share this: a bike just has a lower hp pool (BIKE_HP) and no panels/panes. */
export function damageHit(C, bike, drop, at = null, dir = null) {
  if (!bike || bike.wrecked) return 0;
  if (bike.hp == null) bike.hp = bike.hp0 = bike.spec?.car ? HP : BIKE_HP;
  const dmg = Math.min(HIT_MAX, 6 * drop * drop); bike.hp = Math.max(0, bike.hp - dmg);
  const g = ends(bike), inv = new THREE.Matrix4().copy((bike.kit || g).matrixWorld).invert();
  // where it hit, in the kit frame (+x front): the given point, else the end that was leading
  let local;
  if (at) local = at.clone().applyMatrix4(inv); else { const front = (bike.fwdSpeed ?? bike.speed ?? 0) >= 0; local = new THREE.Vector3(front ? 2.3 : -2.3, 0.7, (Math.random() - 0.5) * 1.2); }
  const front = local.x >= 0; if (front) bike.dmgF = (bike.dmgF || 0) + dmg; else bike.dmgR = (bike.dmgR || 0) + dmg;
  const push = dir ? dir.clone().transformDirection(inv) : new THREE.Vector3(front ? -1 : 1, 0, 0);
  if (!lite(C)) dent(bike, local, push, Math.min(0.18, drop * 0.012));
  for (const [n, P] of Object.entries(bike.panels || {})) { const d = P.ctr.distanceTo(local); if (d < PANEL_R) hitPanel(C, bike, n, dmg * (1.6 - d / PANEL_R)); }
  if (dmg > CRASH_PANE) for (const [n, P] of Object.entries(bike.panes || {})) if (P.ctr.distanceTo(local) < PANEL_R) hitPane(C, bike, n, dmg > HIT_MAX * 0.7 ? PANE_SHATTER : 1);
  if ((front ? bike.dmgF : bike.dmgR) > (bike.hp0 ?? HP) * LIGHTS_FRAC) lightsOut(bike, front);
  if (bike.hp <= 0 && bike.fuse == null) { bike.fuse = FUSE; C.hud?.toast?.('It\'s going to blow - get out!', 2200); }
  return dmg;
}
/** a bullet into a car: `obj` the mesh it hit, point / normal / dir in world space */
export function damageShot(C, b, obj, point, normal, dir, dmg = 30) {
  if (!b?.spec?.car || b.wrecked || !b.kit) return;
  if (b.hp == null) b.hp = HP; b.hp = Math.max(0, b.hp - BULLET_HP * dmg / 30);
  const inv = new THREE.Matrix4().copy(b.kit.matrixWorld).invert(), local = point.clone().applyMatrix4(inv), n = normal.clone().transformDirection(inv);
  const PN = Object.entries(b.panes || {}), pane = obj === 'glass' ? PN.sort((a, c) => a[1].ctr.distanceTo(local) - c[1].ctr.distanceTo(local))[0] : PN.find(([, P]) => P.mesh === obj);   // 'glass': a parked car's glass slot, the nearest pane
  if (pane) { hitPane(C, b, pane[0]); return; }
  const H = holes(C, b); if (H) { _q.setFromUnitVectors(_z, n); _m.compose(_v.copy(local).addScaledVector(n, 0.004), _q, _s.set(0.7 + Math.random() * 0.6, 0.7 + Math.random() * 0.6, 1)); H.im.setMatrixAt(H.n % H.im.instanceMatrix.count, _m); H.n++; H.im.count = Math.min(H.n, H.im.instanceMatrix.count); H.im.instanceMatrix.needsUpdate = true; }
  for (const [nm, P] of Object.entries(b.panels || {})) if (P.mesh === obj || P.ctr.distanceTo(local) < 0.5) { hitPanel(C, b, nm, BULLET_PANEL); break; }
  if (local.x > 1.6 && b.hp < HP * 0.6 && Math.random() < 0.15) lightsOut(b, true);
  if (b.hp <= 0 && b.fuse == null) { b.fuse = FUSE; }
}
/** sparks + bits at a crash point (world), `k` 0..1 how hard */
export function crashFx(C, at, k, vel = null) {
  const n = Math.round(4 + k * (lite(C) ? 6 : 14)); for (let i = 0; i < n; i++) puff(C.scene, at, 'spark', vel);
  if (k > 0.3) { puff(C.scene, at, 'dust'); if (k > 0.55) spawnShards(C, at, vel, 6); }
}
function dent(bike, local, push, depth) {
  if (depth < 0.01) return; const CM = carMaterials(), kit = bike.kit || ends(bike); kit.updateMatrixWorld(true);
  const hitW = local.clone().applyMatrix4(kit.matrixWorld);
  for (const m of bike.meshes || []) {
    if (!m.isMesh || !m.visible || !m.geometry?.attributes?.position?.array || m.material === CM.glass || m.material === CM.glassSee || m.userData.pane || m.userData.noDent || m.geometry.attributes.position.count > 40000) continue;
    if (!m.userData.dented) { m.userData.origGeo = m.geometry; m.geometry = m.geometry.clone(); m.userData.dented = true; }
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert(), lp = hitW.clone().applyMatrix4(inv), pd = push.clone().transformDirection(new THREE.Matrix4().copy(inv).multiply(kit.matrixWorld)), p = m.geometry.attributes.position, v = new THREE.Vector3(); let touched = false;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = v.distanceTo(lp); if (d > 0.9) continue; const k = (1 - d / 0.9) * depth * (0.7 + 0.6 * Math.sin(i * 12.9898) ** 2); v.addScaledVector(pd, k); v.y -= k * 0.25; p.setXYZ(i, v.x, v.y, v.z); touched = true; }   // a little noise: a crumple, not a smooth dish
    if (touched) { p.needsUpdate = true; m.geometry.computeVertexNormals(); }
  }

}
function lightsOut(bike, front) {
  const CM = carMaterials(); if (!DARK) DARK = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4 });
  for (const m of bike.meshes || []) if (m.material === (front ? CM.lampW : CM.lampR) || m.material === (front ? bike.lens?.material : bike.lampR)) { if (m.userData.lampMat) continue; m.userData.lampMat = m.material; m.material = DARK; if (front && bike.headlight) bike.headlight.intensity = 0; }
  if (front) bike.lightsOut = true;
}
function charred(bike) {
  if (!CHAR) CHAR = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.2 }); const CM = carMaterials();
  bike.origMat = new Map(); for (const m of bike.meshes || []) { bike.origMat.set(m, m.material); if (m.material !== CM.glass) m.material = CHAR; }
}

/** per frame for every hurt car: smoke, fire, the fuse, the wreck coming back; debris, shards and sparks */
export function updateDamage(C, bikes, dt) {
  updateInterop(bikes, dt);
  const scene = C.scene; let any = false;
  for (const b of bikes) {
    const max0 = b.hp0 ?? HP, smokeAt = max0 * SMOKE_FRAC, fireAt = max0 * FIRE_FRAC;
    if (b.hp == null || b.hp >= smokeAt && b.fuse == null && !b.wrecked) continue; any = true;
    const g = ends(b), hoodLocal = b.spec?.car ? new THREE.Vector3(1.6, 1.1, 0) : new THREE.Vector3(0, 1, -0.3);
    const hood = hoodLocal.applyMatrix4((b.kit || g).matrixWorld);
    b.smokeT = (b.smokeT || 0) - dt;
    if (b.smokeT <= 0) { b.smokeT = b.wrecked ? 0.5 : 0.25; puff(scene, hood, b.hp < fireAt ? 'black' : 'white'); if (b.hp < fireAt && !b.wreckDone) puff(scene, hood.clone().add(new THREE.Vector3(0, -0.2, 0)), 'fire'); }
    if (b.fuse != null && !b.wrecked) { b.fuse -= dt; if (b.fuse <= 0) {
      b.wrecked = true; b.wreckT = WRECK_T; b.fuse = null; charred(b); try { C.bus.emit('explosion', { position: b.pos.clone().setY(1), radius: 6 }); } catch {}
      for (let k = 0; k < 6; k++) puff(scene, hood.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2)), 'fire');
      for (const n of Object.keys(b.panes || {})) hitPane(C, b, n, PANE_SHATTER); for (const n of ['hood', 'doorFL', 'bumperF']) if (b.panels?.[n] && Math.random() < 0.7) detach(C, b, n);
      if (C.vehicles?.mounted === b) try { C.vehicles.dismount(); } catch {} } }
    if (b.wrecked) { b.wreckT -= dt; const P = C.player?.position; if (b.wreckT <= 0 && P && Math.hypot(P.x - b.pos.x, P.z - b.pos.z) > 60) restore(b); }
  }
  if (POOL) for (const s of POOL) { if (!s.visible) continue; const u = s.userData, K = PUFF[u.kind]; u.t += dt; if (u.t > u.life) { s.visible = false; continue; } const k = u.t / u.life;
    if (K.g) u.v.y -= K.g * dt; s.position.addScaledVector(u.v, dt); s.scale.setScalar(Math.max(0.02, K.s0 + k * K.ds)); s.material.opacity = K.a * (1 - k); }
  for (let i = DEBRIS.length - 1; i >= 0; i--) { const d = DEBRIS[i]; d.t += dt; if (d.t > DEBRIS_T) { dropDebris(d); continue; } if (d.rest) continue; any = true;
    d.v.y -= 17 * dt; d.g.position.addScaledVector(d.v, dt); d.g.rotation.x += d.w.x * dt; d.g.rotation.y += d.w.y * dt; d.g.rotation.z += d.w.z * dt;
    const gy = (C.world?.groundHeight?.(d.g.position.x, d.g.position.z) ?? 0) + 0.06;
    if (d.g.position.y < gy) { d.g.position.y = gy; if (Math.abs(d.v.y) > 1.2) { d.v.y = -d.v.y * 0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5); try { C.audio?.play?.('impact_metal', { position: d.g.position, volume: 0.4 }); } catch {} } else { d.rest = true; d.g.rotation.x = Math.round(d.g.rotation.x / Math.PI) * Math.PI; d.g.rotation.z = Math.round(d.g.rotation.z / Math.PI) * Math.PI; } } }   // settles flat
  if (SHARD_IM && SHARD_LIST.length) { any = true; let n = 0; for (let i = SHARD_LIST.length - 1; i >= 0; i--) { const s = SHARD_LIST[i]; s.t += dt; if (s.t > 2.5) { SHARD_LIST.splice(i, 1); continue; }
      s.v.y -= 17 * dt; s.p.addScaledVector(s.v, dt); const gy = (C.world?.groundHeight?.(s.p.x, s.p.z) ?? 0) + 0.01; if (s.p.y < gy) { s.p.y = gy; s.v.set(0, 0, 0); } else { s.r.x += dt * 9; s.r.y += dt * 7; }
      _q.setFromEuler(s.r); _m.compose(s.p, _q, _s.set(1, 1, 1)); SHARD_IM.setMatrixAt(n++, _m); }
    SHARD_IM.count = n; SHARD_IM.instanceMatrix.needsUpdate = true; } else if (SHARD_IM) SHARD_IM.count = 0;
  return any;
}
function restore(b) {
  if (b.origMat) for (const [m, mat] of b.origMat) m.material = mat; b.origMat = null;
  b.hp = null; b.dmgF = b.dmgR = 0; b.wrecked = false; b.fuse = null; b.smokeT = 0; b.lightsOut = false;
  for (const m of b.meshes || []) { if (m.userData.lampMat) { m.material = m.userData.lampMat; m.userData.lampMat = null; } if (m.userData.mat0) { m.material = m.userData.mat0; m.userData.mat0 = null; } if (m.userData.origGeo) { m.geometry.dispose(); m.geometry = m.userData.origGeo; m.userData.origGeo = null; m.userData.dented = false; } }   // as new: lamps, body
  for (const P of Object.values(b.panels || {})) { P.hp = PANEL_HP; P.state = 0; P.dark = false; P.mesh.visible = true; if (P.shell) P.shell.visible = true; if (P.pivot) { P.pivot.rotation.set(0, 0, 0); P.pivot.position.copy(P.pivot.userData.home); } P.ajar = 0; }
  for (const P of Object.values(b.panes || {})) { P.hits = 0; if (P.state === 1) P.mesh.material = P.mat0; P.state = 0; P.mesh.visible = true; }
  if (b.holes) { b.holes.n = 0; b.holes.im.count = 0; }
}
export const isWrecked = (b) => !!b?.wrecked;
/** test hooks (qa): a car's damage at a glance */
export function damageState(b) {
  if (!b) return null; const pan = {}, pn = {}; for (const [n, P] of Object.entries(b.panels || {})) pan[n] = P.state; for (const [n, P] of Object.entries(b.panes || {})) pn[n] = P.state === 2 || (P.win || 0) > 0.5 ? 'down' : P.state;
  return { hp: b.hp ?? HP, panels: pan, panes: pn, holes: b.holes?.im.count || 0, debris: DEBRIS.length, shards: SHARD_LIST.length, lightsOut: !!b.lightsOut };
}

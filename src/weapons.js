// Weapons: arsenal + loadout, first-person viewmodels, feel (sway/bob/ADS/recoil), reload/swap/grenade, hitscan (bullets + pellets) + FX. Owned by: WEAPONS agent.
import * as THREE from 'three';
import { makeTextures, makeMaterials } from './weapons/materials.js';
import { dressViewmodelArms } from './world/outfits.js';
import { buildRifle, RIFLE_SPEC } from './weapons/rifle.js';
import { buildPistol, PISTOL_SPEC } from './weapons/pistol.js';
import { buildShotgun, SHOTGUN_SPEC } from './weapons/shotgun.js';
import { buildScope } from './weapons/scope.js';
import { FX } from './weapons/fx.js';
import { Grenades } from './weapons/grenade.js';
import { windowOpen, windowBitOpen } from './vehicledamage.js';
import { kit as hangkitKit, hangkit } from './world/hangkit.js';

// melee keyframes [time s, [dx, dy, dz, rotX, rotY, rotZ]] added on top of the sway node (knife held edge-down, tip forward)
const SWINGS = [
  [[0, [0, 0, 0, 0, 0, 0]], [0.08, [-0.1, 0.02, 0.02, 0.15, -0.35, 0.7]], [0.19, [0.15, 0.06, -0.1, -0.2, 0.55, -0.6]], [0.25, [0.17, 0.07, -0.07, -0.2, 0.6, -0.65]], [0.46, [0, 0, 0, 0, 0, 0]]],   // backhand: low-left → up-right
  [[0, [0, 0, 0, 0, 0, 0]], [0.08, [0.12, 0.07, 0.02, 0.2, 0.55, -0.9]], [0.2, [-0.17, -0.05, -0.12, -0.25, -0.65, 0.7]], [0.26, [-0.19, -0.07, -0.08, -0.25, -0.7, 0.75]], [0.48, [0, 0, 0, 0, 0, 0]]],   // forehand: up-right → across → down-left
];
// punches (fists): 2 jab (left, straight), 3 cross (right, straight, a turn of the shoulders), 4 hook (the third of a quick chain)
SWINGS.push(   // offsets on one fist (weapons.update moves that fist, not the whole view): 2 jab (left), 3 cross (right), 4 hook (left)
  [[0, [0, 0, 0, 0, 0, 0]], [0.06, [0.03, 0.045, -0.3, -0.1, -0.05, 0]], [0.1, [0.03, 0.045, -0.31, -0.1, -0.05, 0]], [0.24, [0, 0, 0, 0, 0, 0]]],
  [[0, [0, 0, 0, 0, 0, 0]], [0.07, [-0.07, 0.05, -0.33, -0.1, 0.18, 0.25]], [0.12, [-0.08, 0.05, -0.34, -0.1, 0.2, 0.3]], [0.3, [0, 0, 0, 0, 0, 0]]],
  [[0, [0, 0, 0, 0, 0, 0]], [0.08, [-0.05, 0.06, 0.02, 0, 0.5, 0.2]], [0.16, [0.16, 0.07, -0.2, 0, -0.9, -0.5]], [0.22, [0.18, 0.07, -0.18, 0, -1.0, -0.55]], [0.42, [0, 0, 0, 0, 0, 0]]],
);
const FIST_BASE = 14, FIST_MUL = [1, 1.15, 2.1];   // jab, cross, hook (a chain inside 0.7 s between punches)
const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };

const DEG = Math.PI / 180;
const VM_FOV = 50;                // vertical fov the viewmodel is authored for (x/y-scale trick emulates it under the world fov)
const ADS_FOV_MUL = 0.7;
const GRENADES = 4;
const RECOIL_HOLD = 0.06, RECOIL_RETURN = 18;   // s before the climb starts to come back, return rate (1/s): ~0.2 s to 90% on every gun
const SHAKE_DECAY = 22, SHAKE_MAX = 0.02;      // screen shake: camera-only roll/pitch wobble per shot (rad), never fed into aim
const DEFAULT_PRIMARY = 'm4a1', DEFAULT_SECONDARY = 'm9';

// Weapon registry: id → { spec, build(mats) }. Optional weapons (sniper/SMG/AK/heavy pistol) are dynamically imported below so a broken file never takes the arsenal down.
const REGISTRY = {
  m4a1: { spec: RIFLE_SPEC, build: (mats) => buildRifle(mats, { suppressor: false }) },
  r870: { spec: SHOTGUN_SPEC, build: (mats) => buildShotgun(mats) },
  m9: { spec: PISTOL_SPEC, build: (mats) => buildPistol(mats) },
};
const OPTIONAL = [
  ['./weapons/sniper.js', 'SNIPER_SPEC', 'buildSniper'],
  ['./weapons/smg.js', 'SMG_SPEC', 'buildSmg'],
  ['./weapons/ak.js', 'AK_SPEC', 'buildAk'],
  ['./weapons/deagle.js', 'DEAGLE_SPEC', 'buildDeagle'],
  ['./weapons/knife.js', 'KNIFE_SPEC', 'buildKnife'],
  ['./weapons/fists.js', 'FISTS_SPEC', 'buildFists'],
];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _rlp = new THREE.Vector3(), _rlr = new THREE.Vector3(), _ins = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _ray = new THREE.Ray();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt)), sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp3 = (out, a, b, t) => out.set(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
/** keyframe track: keys = [[t, [x,y,z]], ...] sorted; smoothstep between keys */
function track(out, t, keys) {
  if (t <= keys[0][0]) return out.set(...keys[0][1]);
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const k = sstep((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])); return lerp3(out, keys[i - 1][1], keys[i][1], k); }
  return out.set(...keys[keys.length - 1][1]);
}
function pulse(t, a, b) { return t < a ? sstep(t / a) : 1 - sstep((t - a) / b); }
/** window helper: 1 inside [a,b] with smooth ramps of width r */
function win(u, a, b, r = 0.04) { return sstep((u - a) / r) * (1 - sstep((u - b) / r)); }

let S = null;

// ------------------------------------------------------------------ arsenal
function shotDamage(sp) { return sp.damage * (sp.pellets || 1); }
function arsenalEntry(sp) {
  const st = sp.stats || {};
  const dmg = st.damage ?? shotDamage(sp), rpm = st.rpm ?? sp.rpm, range = st.range ?? sp.range, mag = st.mag ?? sp.mag, mobility = st.mobility ?? 70, accuracy = st.accuracy ?? 60;
  return {
    id: sp.id, name: sp.name, class: sp.class, slot: sp.slot, desc: sp.desc || '', mode: sp.mode,
    stats: { damage: dmg, rpm, range, mag, mobility, accuracy },
    bars: { damage: clamp(Math.round(dmg), 0, 100), fireRate: clamp(Math.round(rpm / 9), 0, 100), range: clamp(Math.round(Math.sqrt(range / 400) * 100), 0, 100), accuracy: clamp(Math.round(accuracy), 0, 100), mobility: clamp(Math.round(mobility), 0, 100) },
  };
}
function buildArsenal() { return Object.values(REGISTRY).map(r => r.spec).sort((a, b) => a.slot - b.slot).map(arsenalEntry); }

export async function init(ctx) {
  const { camera, scene } = ctx;
  const tex = makeTextures(); const mats = makeMaterials(tex); try { dressViewmodelArms(mats); } catch (e) { console.warn('[weapons] arms', e); }
  const fx = new FX(ctx); const grenades = new Grenades(ctx, mats, fx);
  // optional weapon modules (each is an independent file so a broken one never takes the arsenal down)
  for (const [path, specName, buildName] of OPTIONAL) {
    try { const m = await import(path); const spec = m[specName], build = m[buildName]; if (spec && build && spec.id) REGISTRY[spec.id] = { spec, build: (mm) => build(mm) }; }
    catch (e) { /* not present yet */ }
  }

  const vmRoot = new THREE.Group(); vmRoot.name = 'viewmodel'; camera.add(vmRoot);
  // subtle viewmodel fill (short range so it barely touches the world) — keeps the gun readable in deep shadow
  const fill = new THREE.PointLight(0x9fb8e0, 0.05, 1.4, 2.0); fill.position.set(0.25, 0.22, 0.05); camera.add(fill);
  const fill2 = new THREE.PointLight(0xffc890, 0.02, 1.2, 2.0); fill2.position.set(-0.3, -0.1, -0.1); camera.add(fill2);
  const poseNode = new THREE.Group(); vmRoot.add(poseNode);
  const swayNode = new THREE.Group(); poseNode.add(swayNode);
  const scope = buildScope(camera);

  // fallback environment for the viewmodel if the world hasn't provided one (dark yard with a few sodium lamps)
  let fallbackEnv = null;
  const ensureEnv = () => {
    const useScene = !!scene.environment;
    if (!useScene && !fallbackEnv) {
      const pm = new THREE.PMREMGenerator(ctx.renderer); const es = new THREE.Scene();
      es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ color: 0x0a0d12, side: THREE.BackSide })));
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xffb060 }); const skyMat = new THREE.MeshBasicMaterial({ color: 0x223044 });
      for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), lampMat); const a = i * Math.PI / 2 + 0.4; l.position.set(Math.cos(a) * 30, 8 + i * 2, Math.sin(a) * 30); l.lookAt(0, 0, 0); es.add(l); }
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), skyMat); sky.position.set(0, 45, 0); sky.rotation.x = Math.PI / 2; es.add(sky);
      const grd = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x141618 })); grd.position.y = -3; grd.rotation.x = -Math.PI / 2; es.add(grd);
      fallbackEnv = pm.fromScene(es, 0.04).texture; pm.dispose();
    }
    // day maps: the bright sky PMREM turns phosphate steel into chrome — pull the viewmodel's reflection strength down
    const dayK = ctx.world?.grade === 'day' ? 0.4 : 1;
    for (const m of Object.values(mats)) { const want = useScene ? null : fallbackEnv; if (m.envMap !== want && 'envMap' in m) { m.envMap = want; m.needsUpdate = true; } if (m.envMapIntensity !== undefined) { if (m.userData.baseEnv === undefined) { m.userData.baseEnv = m.envMapIntensity; m.userData.baseRough = m.roughness; } m.envMapIntensity = m.userData.baseEnv * dayK; if (m.userData.baseMetal === undefined) m.userData.baseMetal = m.metalness; if (m.userData.baseMetal > 0.5) { m.roughness = Math.min(1, m.userData.baseRough + (dayK < 1 ? 0.1 : 0)); m.metalness = m.userData.baseMetal; } } }
    fx.brassMesh.material.envMap = useScene ? null : fallbackEnv;
  };
  ensureEnv();

  S = {
    ctx, mats, fx, grenades, vmRoot, poseNode, swayNode, scope, weapons: [], cache: {}, cur: 0, loadout: null,
    adsTarget: 0, adsT: 0, ads: 0, adsOn: false, scoped: false,
    sprint: 0, lower: 0, swap: null, reload: null, throwing: null, inspect: null,
    rp: new THREE.Vector3(), rr: new THREE.Vector3(), rpv: new THREE.Vector3(), rrv: new THREE.Vector3(),
    lookX: 0, lookY: 0, bobX: 0, bobY: 0, spreadExtra: 0, recPitch: 0, recYaw: 0, swayPitch: 0, swayYaw: 0,
    flashT: 9, flashLife: 0.045, triggerHeld: false, triggerPressed: false, dryLatch: false,
    grenadeCount: GRENADES, wallPull: 0, lastFov: -1, scaleFov: -1, time: 0, envCheck: 0, dead: false,
    fired: 0, arsenal: buildArsenal(), kickP: 0, kickY: 0, shakeAmp: 0, shakeX: 0, shakeZ: 0, shakePost: null, stowed: false, sensAds: false, vmScale: -1,
  };
  S._ensureEnv = ensureEnv;
  ctx.bus.on('shot', (d) => { if (d && d.who === 'enemy' && d.origin && d.dir) { const o = d.origin.isVector3 ? d.origin : _v.set(d.origin[0] ?? d.origin.x, d.origin[1] ?? d.origin.y, d.origin[2] ?? d.origin.z); const dir = d.dir.isVector3 ? d.dir : _v2.set(d.dir[0] ?? d.dir.x, d.dir[1] ?? d.dir.y, d.dir[2] ?? d.dir.z); fx.enemyShot(o.clone(), dir.clone()); } });
  ctx.bus.on('playerDied', () => { S.dead = true; cancelActions(); });
  // respawn = resupplied: full mags + reserve on both guns (a picked-up merc gun stays your primary) and the grenades back
  ctx.bus.on('worldReset', () => { S.bag = null; S.bank = {}; try { setLoadout(S.loadout || {}, { silent: true }); } catch {} });   // start fresh: just the loadout again
  ctx.bus.on('playerRespawn', () => { S.dead = false; S.bank = {}; try { setLoadout(S.loadout || {}, { silent: true }); } catch (e) { console.warn('[weapons] respawn refill', e); } S.grenadeCount = GRENADES; ctx.bus.emit('resupply', {}); });

  // initial loadout from the URL (?primary=&secondary=), mirrored into settings
  const qs = ctx.qs || new URLSearchParams(location.search);
  setLoadout({ primary: qs.get('primary') || ctx.settings?.loadout?.primary || DEFAULT_PRIMARY, secondary: qs.get('secondary') || ctx.settings?.loadout?.secondary || DEFAULT_SECONDARY }, { silent: true });

  const api = {
    get current() { return S.weapons[S.cur].cur; },
    get slots() { return S.weapons.map(w => w.cur); },
    get ads() { return S.ads; },
    get scoped() { return S.scoped; },
    get reloading() { return !!S.reload; },
    get grenades() { return S.grenadeCount; },
    /** the primary you carry: { id, ammo, reserve } */
    get currentId() { return S.weapons[S.cur]?.id ?? null; },
    get spec() { return S.weapons[S.cur]?.spec ?? null; },
    get primary() { const w = S.weapons[0]; return w ? { id: w.id, ammo: w.ammo, reserve: w.reserve } : null; },
    get spread() { return currentSpread(); },
    get sprinting() { return S.sprint > 0.5; },
    get arsenal() { return S.arsenal; },
    get loadout() { return { ...S.loadout }; },
    get stats() { return arsenalEntry(S.weapons[S.cur].spec).stats; },
    setLoadout: (lo) => setLoadout(lo),
    collect: (id, reserve) => collectGun(id, reserve), selectBag: (i) => selectBag(i), fists: () => selectFists(), combo: () => S.combo || 0, get bag() { bagSync(); return S.bag.slice(); },
    /** Pick up a dropped weapon: same id as the current primary → +reserve ammo; otherwise it replaces the primary (with a full mag + the given reserve). */
    pickup: (id = 'ak74', reserve = 60) => {
      const cur = S.weapons[0]; if (!REGISTRY[id] || REGISTRY[id].spec.slot !== 0) return false;
      if (cur && cur.id === id) { cur.reserve += reserve; cur.cur.reserve = cur.reserve; if (cur.ammo <= 0 && !S.reload) api.reload?.(); ctx.bus.emit('pickup', { id, ammo: true }); return true; }
      setLoadout({ primary: id, secondary: S.loadout.secondary }); const w = S.weapons[0]; if (w) { w.reserve = reserve; w.cur.reserve = reserve; } ctx.bus.emit('pickup', { id, ammo: false }); return true;
    },
    /** chill mode: keep a slot out of reach until it's earned (lock(1, true, 'msg')) */
    lock: (slot, on = true, msg = '') => { S.locked = S.locked || new Set(); if (on) S.locked.add(slot); else S.locked.delete(slot); if (msg) S.lockMsg = msg; },
    /** paint a gun (viewmodel) — the golden Deagle from the shashlik */
    tint: (id, color = 0xd4af37) => { const w = REGISTRY[id] && getWeapon(id); if (!w) return false; w.group.traverse((o) => { if (o.isMesh && o.material && !o.material.transparent && !o.userData.tinted) { o.material = o.material.clone(); o.material.color?.set(color); if ('metalness' in o.material) { o.material.metalness = 0.95; o.material.roughness = 0.22; } if (o.material.map) o.material.map = null; o.material.needsUpdate = true; o.userData.tinted = true; } }); return true; },
    /** a third-person copy of a gun (muzzle toward -z, metres) for the mercs to carry / drop */
    worldModel: (id) => {
      const reg = REGISTRY[id]; if (!reg) return null;
      S.wmProto = S.wmProto || {};
      if (!S.wmProto[id]) { const w = reg.build(S.mats); const g = w.group; g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); S.wmProto[id] = g; }
      return S.wmProto[id].clone(true);
    },
    fire: () => { const w = S.weapons[S.cur]; if (w.ammo > 0 && !w.needsAction) fireShot(w); else if (w.ammo <= 0) dryFire(w); },
    qaSwingAt: (kind, t) => { S.swing = { t, kind, freeze: true }; },
    qaSwing: () => S.swing && { t: +S.swing.t.toFixed(2), kind: S.swing.kind },
    qaFire: (n = 1) => { const w = S.weapons[S.cur]; for (let i = 0; i < n; i++) { if (w.ammo <= 0) { w.ammo = w.spec.mag; } w.needsAction = false; w.actionT = 9; fireShot(w, { hold: 0.6 }); } },
    reload: () => startReload(),
    swap: (slot) => startSwap(slot),
    throwGrenade: () => startThrow(),
    inspect: () => startInspect(),
    // QA helpers
    setAdsForQA: (v = 1) => { S.qaAds = v == null ? null : v; if (v != null) { S.adsTarget = v; S.adsT = v; S.ads = v; S.adsOn = v > 0.5; if (ctx.player) ctx.player.ads = S.adsOn; } },
    qaLoadout: (primary, secondary) => setLoadout({ primary: primary || S.loadout.primary, secondary: secondary || S.loadout.secondary }),
    qaReload: (t = 0.5) => { const w = S.weapons[S.cur]; w.ammo = 0; startReload(true); if (S.reload) S.reload.t = t; },
    qaAction: (t = 0.3) => { const w = S.weapons[S.cur]; if (w.spec.action) { w.needsAction = true; w.actionT = t; } },
    qaSprint: (v = 1) => { S.sprint = v; },
    qaShowcase: (yaw = 0.6, pitch = 0.1, dist = 0.9, x = 0, y = -0.03) => { S.showcase = yaw == null ? null : { yaw, pitch, dist, x, y }; },
    qaGrenade: (t = 0.0) => { startThrow(true); if (S.throwing) S.throwing.t = t; },
    qaExplode: (x, y, z) => { fx.explosion(new THREE.Vector3(x, y, z)); },
    /**
     * QA: sights vs bullets. For each range, stands a temporary wall square to the camera at that distance (the only raycast
     * target during the check), fires `n` rounds and reports, per range, the impact error vs the aim ray (screen centre) and vs the
     * iron-sight line (rear notch → front post, extended) in cm, plus where the notch/post project on screen (px from centre).
     * opts: { ranges:[10,30,60], n:5, spread:false (true = keep the weapon's real cone), settle:true (zero the visual springs first) }
     */
    qaAimCheck: (opts = {}) => {
      const ranges = opts.ranges || [10, 30, 60], n = opts.n ?? 5, w = S.weapons[S.cur], cam = ctx.camera, out = [];
      const saved = ctx.raycastTargets; const ammo = w.ammo, kp = S.kickP, ky = S.kickY, lastShot = w.lastShot, shots = w.shots, spreadX = S.spreadExtra;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); wall.userData.surface = 'metal'; scene.add(wall);
      const W = ctx.renderer.domElement.clientWidth || innerWidth, H = ctx.renderer.domElement.clientHeight || innerHeight;
      const px = (v) => { const q = v.clone().project(cam); return [+(q.x * W / 2).toFixed(2), +(q.y * H / 2).toFixed(2)]; };
      try {
        if (opts.settle !== false) { S.rp.set(0, 0, 0); S.rr.set(0, 0, 0); S.rpv.set(0, 0, 0); S.rrv.set(0, 0, 0); }
        S.qaNoSpread = !opts.spread;
        for (const d of ranges) {
          cam.updateMatrixWorld(true); S.vmRoot.updateMatrixWorld(true);
          const o = cam.getWorldPosition(new THREE.Vector3()), f = cam.getWorldDirection(new THREE.Vector3());
          wall.position.copy(o).addScaledVector(f, d); wall.lookAt(o); wall.updateMatrixWorld(true); ctx.raycastTargets = [wall];
          const aim = wall.position.clone(); const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(f.clone().negate(), aim);
          const rear = w.parts.sight.getWorldPosition(new THREE.Vector3());
          const front = w.parts.sightFront ? w.parts.sightFront.getWorldPosition(new THREE.Vector3()) : rear.clone().add(new THREE.Vector3(0, 0, -1).transformDirection(w.group.matrixWorld));
          const sightPt = new THREE.Ray(rear, front.clone().sub(rear).normalize()).intersectPlane(plane, new THREE.Vector3());
          let eAim = 0, eSight = 0, eMax = 0, hits = 0;
          for (let i = 0; i < n; i++) {
            w.ammo = Math.max(1, w.ammo); w.needsAction = false; w.lastShot = -9; S.spreadExtra = 0;
            const sv = [S.rpv.clone(), S.rrv.clone()]; const hp = fireShot(w, { noCamera: true, hold: 0.02 }); S.rpv.copy(sv[0]); S.rrv.copy(sv[1]); if (!hp) continue; hits++; // no visual kick from QA rounds
            const a = hp.distanceTo(aim), b = sightPt ? hp.distanceTo(sightPt) : NaN; eAim += a; eSight += b; eMax = Math.max(eMax, a);
          }
          out.push({ range: d, hits, aimErrCm: +(eAim / Math.max(1, hits) * 100).toFixed(2), aimMaxCm: +(eMax * 100).toFixed(2), sightErrCm: +(eSight / Math.max(1, hits) * 100).toFixed(2), sightVsAimCm: sightPt ? +(sightPt.distanceTo(aim) * 100).toFixed(2) : null, notchPx: px(rear), postPx: px(front) });
        }
      } finally {
        ctx.raycastTargets = saved; scene.remove(wall); wall.geometry.dispose(); wall.material.dispose(); S.qaNoSpread = false; if (opts.clean !== false) S.fx.reset();
        w.ammo = ammo; w.cur.ammo = ammo; S.kickP = kp; S.kickY = ky; w.lastShot = lastShot; w.shots = shots; S.spreadExtra = spreadX;
      }
      return { weapon: w.id, fov: +cam.fov.toFixed(2), ads: +S.ads.toFixed(3), spread: !!opts.spread, results: out };
    },
    qaImpact: (x, y, z, surface = 'concrete') => { fx.impact(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0), surface, new THREE.Vector3(0, -1, 0)); },
    materials: mats, fx, grenadeSim: grenades, viewmodel: vmRoot,
    get state() { return S; },
  };
  return api;
}

// ------------------------------------------------------------------ weapon instances / loadout
function getWeapon(id) {
  if (S.cache[id]) return S.cache[id];
  const reg = REGISTRY[id]; const w = reg.build(S.mats); const fx = S.fx;
  S.swayNode.add(w.group); w.group.visible = false;
  // muzzle flash: 3 crossed planes at the muzzle (one facing the camera, two along the barrel)
  const fm = new THREE.MeshBasicMaterial({ map: fx.tex.flash.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(1.8, 1.5, 1.2), side: THREE.DoubleSide });
  fm.map.repeat.set(1 / 3, 1); fm.map.needsUpdate = true;
  const flash = new THREE.Group(); flash.visible = false; w.parts.muzzle.add(flash);
  const sz = w.spec.flashSize ?? (w.spec.slot === 0 ? 0.15 : 0.11);
  const f0 = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), fm); f0.position.z = -0.01; flash.add(f0);
  const f1 = new THREE.Mesh(new THREE.PlaneGeometry(sz * 1.35, sz * 0.8), fm); f1.rotation.y = Math.PI / 2; f1.position.z = -sz * 0.5; flash.add(f1);
  const f2 = new THREE.Mesh(new THREE.PlaneGeometry(sz * 1.35, sz * 0.8), fm); f2.rotation.y = Math.PI / 2; f2.rotation.x = Math.PI / 2; f2.position.z = -sz * 0.5; flash.add(f2);
  for (const f of [f0, f1, f2]) { f.renderOrder = 30; f.frustumCulled = false; }
  if (!w.parts.mag) { w.parts.mag = new THREE.Group(); w.group.add(w.parts.mag); }
  if (w.parts.chargingHandle) { const ch = w.parts.chargingHandle; ch.userData.homeZ = ch.position.z; ch.userData.travel ??= 0.04; }
  w.parts.mag.userData.home = w.parts.mag.position.clone();
  const inst = { ...w, id, flash, flashMat: fm, ammo: w.spec.mag, reserve: w.spec.reserve, fireTimer: 0, shots: 0, lastShot: -9, boltT: 9, trigT: 9, actionT: 9, needsAction: false, slideLocked: false, cur: { id, name: w.spec.name, mode: w.spec.mode || (w.spec.auto ? 'AUTO' : 'SEMI'), class: w.spec.class, ammo: w.spec.mag, mag: w.spec.mag, reserve: w.spec.reserve, slot: w.spec.slot } };
  S.cache[id] = inst; return inst;
}
function resetWeapon(w) {
  w.ammo = w.spec.mag; w.reserve = w.spec.reserve; w.fireTimer = 0; w.shots = 0; w.lastShot = -9; w.boltT = 9; w.trigT = 9; w.actionT = 9; w.needsAction = false; w.slideLocked = false; w.flash.visible = false;
  w.cur.ammo = w.ammo; w.cur.reserve = w.reserve;
  w.parts.mag.visible = true; w.parts.mag.position.copy(w.parts.mag.userData.home); w.parts.mag.rotation.set(0, 0, 0);
  if (w.parts.pump) w.parts.pump.position.copy(w.parts.pump.userData.home);
  if (w.parts.chargingHandle) w.parts.chargingHandle.position.z = w.parts.chargingHandle.userData.homeZ;
  if (w.parts.boltHandle) { w.parts.boltHandle.position.copy(w.parts.boltHandle.userData.home); w.parts.boltHandle.rotation.set(0, 0, 0); }
  if (w.parts.shell) w.parts.shell.visible = false;
  for (const a of [w.parts.armL, w.parts.armR]) if (a) { a.position.copy(a.userData.home.pos); a.rotation.set(0, 0, 0); }
}
// ------------------------------------------------------------------ the bag: every gun you've collected (max 9, keys 1–9 /
// numpad); the two equipped ones are live weapons, the rest wait in S.bank with the ammo they had
const BAG_MAX = 9;
function bagSync() { S.bag = S.bag || []; S.bank = S.bank || {}; for (const id of [S.loadout?.primary, S.loadout?.secondary]) if (id && id !== 'fists' && REGISTRY[id] && !S.bag.includes(id)) S.bag.push(id); }   // fists aren't in the bag: they're 7
/** 7 / numpad 7: put the gun away, fists up */
function selectFists() {
  if (!REGISTRY.fists) return; bagSync(); if (S.weapons[0]?.id === 'fists' && S.cur === 0) return;
  S.weapons.forEach(bankW); setLoadout({ primary: 'fists', secondary: S.loadout.secondary }, { silent: true, keepBag: true }); S.weapons.forEach(unbankW);
  S.ctx.hud?.toast?.(`7 · FISTS   —   ${bagLine()}`, 1600);
}
function bankW(w) { if (w?.id) S.bank[w.id] = { ammo: w.ammo, reserve: w.reserve }; }
function unbankW(w) { const b = w && S.bank[w.id]; if (b) { w.ammo = Math.min(b.ammo, w.spec.mag); w.reserve = b.reserve; w.cur.ammo = w.ammo; w.cur.reserve = w.reserve; } }
const gunName = (id) => REGISTRY[id]?.spec?.name || String(id).toUpperCase();
function bagLine() { bagSync(); return S.bag.map((id, i) => `${i + 1} ${gunName(id)}`).join(' · '); }
function selectBag(i) {
  bagSync(); const id = S.bag[i]; if (!id) return; const sp = REGISTRY[id]?.spec; if (!sp) return;
  const slot = sp.slot === 1 ? 1 : 0;
  if (S.locked?.has(slot)) { S.ctx.hud?.toast?.(S.lockMsg || 'Locked', 1400); return; }
  if (S.weapons[slot]?.id === id) { startSwap(slot); return; }
  S.weapons.forEach(bankW);
  setLoadout(slot ? { primary: S.loadout.primary, secondary: id } : { primary: id, secondary: S.loadout.secondary }, { silent: true, keepBag: true });
  S.weapons.forEach(unbankW);
  if (slot === 1) { S.cur = 1; S.weapons[0].group.visible = false; S.weapons[1].group.visible = true; }
  S.ctx.hud?.toast?.(`${i + 1} · ${sp.name}   —   ${bagLine()}`, 1800);
}
/** a gun comes your way (walk over it, strip a merc you stabbed): new → into the bag, owned → its ammo. false = bag full. */
function collectGun(id, reserve = 30) {
  bagSync(); const reg = REGISTRY[id]; if (!reg) return false;
  const live = S.weapons.find((w) => w.id === id);
  if (S.bag.includes(id)) {
    if (live) { live.reserve += reserve; live.cur.reserve = live.reserve; if (live.ammo <= 0 && !S.reload && live === S.weapons[S.cur]) startReload(); }
    else { const b = S.bank[id] || (S.bank[id] = { ammo: reg.spec.mag, reserve: 0 }); b.reserve += reserve; }
    S.ctx.bus.emit('pickup', { id, ammo: true }); return 'ammo';
  }
  if (S.bag.length >= BAG_MAX) return false;
  S.bag.push(id); S.bank[id] = { ammo: reg.spec.mag, reserve };
  S.ctx.hud?.toast?.(`+ ${reg.spec.name} → press ${S.bag.length}   —   ${bagLine()}`, 2600); S.ctx.bus.emit('pickup', { id, ammo: false });
  return 'new';
}
function setLoadout(lo = {}, opts = {}) {
  const ctx = S.ctx;
  const ok = (id, slot) => id && REGISTRY[id] && REGISTRY[id].spec.slot === slot;
  const primary = ok(lo.primary, 0) ? lo.primary : (S.loadout?.primary || DEFAULT_PRIMARY);
  const secondary = ok(lo.secondary, 1) ? lo.secondary : (S.loadout?.secondary || DEFAULT_SECONDARY);
  if (S.reload) endReload(false); S.swap = null; S.throwing = null; S.inspect = null;
  for (const w of S.weapons) w.group.visible = false;
  S.weapons = [getWeapon(primary), getWeapon(secondary)];
  S.weapons.forEach((w, i) => { resetWeapon(w); w.cur.slot = i; w.group.visible = i === 0; });
  S.cur = 0; S.loadout = { primary, secondary }; if (ctx.settings) ctx.settings.loadout = { primary, secondary };
  S.adsTarget = 0; S.adsT = 0; S.ads = 0; S.adsOn = false; S.scoped = false; S.scope.rig.visible = false; S.spreadExtra = 0; S.flashW = null; S.rp.set(0, 0, 0); S.rr.set(0, 0, 0); S.rpv.set(0, 0, 0); S.rrv.set(0, 0, 0);
  if (ctx.player) ctx.player.ads = false;
  ctx.bus.emit('loadout', { primary, secondary, initial: !!opts.silent });
  return S.loadout;
}

// ------------------------------------------------------------------ actions
function cancelActions() { if (S.reload) endReload(false); S.throwing = null; S.inspect = null; S.adsTarget = 0; }

function startSwap(slot) {
  if (S.locked?.has(arguments[0])) { S.ctx.hud?.toast?.(S.lockMsg || 'Locked', 1400); return false; }   // chill mode: the handgun slot until you buy one
  if (slot == null || slot === S.cur || slot < 0 || slot >= S.weapons.length || (S.swap && S.swap.to === slot)) return false;
  if (S.reload) endReload(false); S.throwing = null; S.inspect = null;
  S.swap = { to: slot, t: 0, phase: 'lower', dur: S.weapons[S.cur].spec.swapTime }; return true;
}
function startReload(force = false) {
  const w = S.weapons[S.cur], sp = w.spec;
  if (S.reload || S.swap || S.throwing) return false;
  if (!force && (w.ammo >= sp.mag || w.reserve <= 0)) return false;
  if (w.needsAction && w.actionT < sp.actionTime) return false;
  S.inspect = null;
  const empty = w.ammo === 0;
  if (sp.reloadStyle === 'shell') S.reload = { style: 'shell', phase: 'start', t: 0, w, empty, shells: 0, interrupt: false, pushed: false };
  else S.reload = { style: 'mag', t: 0, dur: empty ? sp.reloadTime : sp.reloadTimeTac, empty, magOut: false, magIn: false, racked: false, w };
  S.ctx.bus.emit('reload', { stage: 'start', weapon: sp.name, empty, style: S.reload.style });
  return true;
}
function endReload(complete) {
  const r = S.reload; if (!r) return; const w = r.w;
  if (complete) S.ctx.bus.emit('reload', { stage: 'end', weapon: w.spec.name });
  w.parts.mag.visible = true; w.parts.mag.position.copy(w.parts.mag.userData.home); w.parts.mag.rotation.set(0, 0, 0);
  if (w.parts.chargingHandle) w.parts.chargingHandle.position.z = w.parts.chargingHandle.userData.homeZ;
  if (w.parts.shell) w.parts.shell.visible = false;
  S.reload = null;
}
function startAction(w, delay = 0) { w.needsAction = true; w.actionT = -delay; w.actionEjected = false; w.actionOpened = false; w.actionClosed = false; }
function startThrow(force = false) {
  if (S.throwing || S.swap) return false;
  if (!force && S.grenadeCount <= 0) return false;
  if (S.reload) endReload(false); S.inspect = null;
  S.throwing = { t: 0, pinned: false, thrown: false, dur: 1.15 }; S.adsTarget = 0;
  return true;
}
function startInspect() { if (S.reload || S.swap || S.throwing || S.inspect || S.adsOn) return false; S.inspect = { t: 0, dur: 3.2 }; return true; }

function dryFire(w) {
  if (S.dryLatch) return; S.dryLatch = true;
  w.trigT = 0; S.ctx.bus.emit('dryfire', { weapon: w.spec.name });
  if (w.reserve > 0) startReload();
}

function currentSpread() {
  if (S.qaNoSpread) return 0;
  const w = S.weapons[S.cur], sp = w.spec, p = S.ctx.player;
  const mv = clamp((p?.speed ?? 0) / 4.4, 0, 1.5), air = p && p.onGround === false ? 1.5 : 0;
  return lerp(sp.hipSpread + sp.moveSpread * mv + air, sp.adsSpread + mv * 0.3, S.ads) + S.spreadExtra * (1 - S.ads * 0.8);
}

function ejectFor(w, p) {
  const cam = S.ctx.xrAim || S.ctx.camera, rng = S.ctx.rng; cam.getWorldDirection(_fwd); _right.set(1, 0, 0).applyQuaternion(cam.quaternion); _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
  const ej = w.parts.eject.getWorldPosition(new THREE.Vector3());
  _v.copy(_right).multiplyScalar(2.2 + rng() * 1.2).addScaledVector(_up, 1.6 + rng() * 0.8).addScaledVector(_fwd, -0.3 + rng() * 0.4); if (p?.velocity) _v.add(p.velocity);
  S.fx.ejectBrass(ej, _v, w.spec.brassScale ?? (w.spec.slot === 0 ? 1 : 0.8));
}

/** V — a quick knife stab with whatever you're holding (the knife itself just swings) */
function quickStab() {
  S.stabT = S.time; const cur = S.weapons[S.cur], ks = REGISTRY.knife?.spec; if (!cur || !ks) return;
  if (cur.spec.melee) return fireShot(cur);
  fireShot({ spec: { ...ks, id: 'stab' }, parts: { muzzle: cur.parts.muzzle, eject: cur.parts.eject }, shots: 0, lastShot: -9, ammo: 1, cur: cur.cur });
  S.rpv.z -= 9; S.rrv.x -= 5; S.rrv.z += 4;   // the gun lunges forward with the stab
}
function fireShot(w, opts = {}) {
  const ctx = S.ctx, sp = w.spec, cam = ctx.xrAim || ctx.camera, p = ctx.player, rng = ctx.rng;
  const now = S.time;
  if (now - w.lastShot > 0.35) w.shots = 0;
  if (!sp.melee) w.ammo = Math.max(0, w.ammo - 1); w.shots++; w.lastShot = now; w.boltT = 0; w.trigT = 0; S.fired++;
  if (w.parts.slide && w.ammo === 0) w.slideLocked = true;
  S.inspect = null;
  if (sp.action) startAction(w, sp.actionDelay ?? 0.1);

  // direction with spread (cone; deterministic via ctx.rng)
  cam.updateMatrixWorld(true);
  cam.getWorldDirection(_fwd); _right.set(1, 0, 0).applyQuaternion(cam.quaternion); _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
  const spread = currentSpread() * DEG;
  const origin = cam.getWorldPosition(new THREE.Vector3());
  const coneDir = (spreadRad, out) => { const a = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * spreadRad; const tr = Math.tan(rad); return out.copy(_fwd).addScaledVector(_right, Math.cos(a) * tr).addScaledVector(_up, Math.sin(a) * tr).normalize(); };
  const dir = coneDir(spread, new THREE.Vector3());
  S.spreadExtra = Math.min(sp.spreadMax, S.spreadExtra + sp.spreadPerShot);
  const [foStart, foEnd, foMin] = sp.falloff || [40, 160, 0.6];
  const falloff = (d) => d <= foStart ? 1 : clamp(1 - (d - foStart) / (foEnd - foStart), foMin, 1);

  // hitscan (one ray per bullet; `pellets` rays for shotguns, each in its own sub-cone around the shot direction)
  S._rc = S._rc || new THREE.Raycaster(); const rc = S._rc; rc.near = 0.05; rc.far = sp.range;
  const rays = sp.pellets || 1; const pelletSpread = (sp.pelletSpread || 0) * DEG;
  const soldierHits = new Map(), remoteHits = new Map(); let firstHit = null, firstDist = sp.range;
  const _pd = new THREE.Vector3();
  for (let i = 0; i < rays; i++) {
    let d = dir;
    if (rays > 1) { const a = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * pelletSpread, tr = Math.tan(rad); _right.set(1, 0, 0).applyQuaternion(cam.quaternion); _up.set(0, 1, 0).applyQuaternion(cam.quaternion); d = _pd.copy(dir).addScaledVector(_right, Math.cos(a) * tr).addScaledVector(_up, Math.sin(a) * tr).normalize(); }
    rc.set(origin, d);
    let hit = null;
    if (ctx.raycastTargets?.length) { const hits = rc.intersectObjects(ctx.raycastTargets, true); for (const h of hits) { if (h.object === S.vmRoot || (!h.object.visible && !h.object.userData?.soldier && !h.object.userData?.remote)) continue; hit = h; break; } } // soldier hitboxes are invisible meshes by design
    if (!hit) continue;
    const dist = hit.distance; if (!firstHit || dist < firstDist) { firstHit = hit; firstDist = dist; }
    let n = hit.normal ? hit.normal.clone() : null;
    if (!n) { n = hit.face ? hit.face.normal.clone() : d.clone().negate(); if (hit.instanceId !== undefined && hit.object.getMatrixAt) { hit.object.getMatrixAt(hit.instanceId, _m); _m.premultiply(hit.object.matrixWorld); n.transformDirection(_m); } else n.transformDirection(hit.object.matrixWorld); }
    if (n.dot(d) > 0) n.negate();
    const ud = hit.object.userData || {};
    if (typeof ud.onHit === 'function') {   // map NPCs (coney chill mode thugs): they resolve their own damage
      const head = ud.part === 'head', th = ud.thug, alive = !!th && th.st !== 'dead', dealt = sp.damage * (head ? sp.headMul : 1) * falloff(dist); try { ud.onHit(dealt, head, hit.point.clone(), d.clone()); } catch (e) { console.warn('[weapons] onHit', e); }
      S.fx.impact(hit.point, n, 'flesh', d); ctx.bus.emit('hit', { damage: dealt, headshot: head, point: hit.point.clone(), npc: true, kill: alive && th.st === 'dead' });   // kill: this round dropped him (kill marker + sound)
    } else if (ud.remote) {   // another online player (net.js hitbox): accumulate like a soldier, resolved by the victim's client
      const head = ud.part === 'head';
      let acc = remoteHits.get(ud.remote); if (!acc) { acc = { dmg: 0, head: 0, n: 0, point: hit.point.clone() }; remoteHits.set(ud.remote, acc); }
      acc.dmg += sp.damage * (head ? sp.headMul : 1) * falloff(dist); acc.n++; if (head) acc.head++;
      S.fx.impact(hit.point, n, 'flesh', d);
    } else if (ud.soldier) {
      const head = ud.part === 'head';
      const dmg = sp.damage * (head ? sp.headMul : 1) * falloff(dist);
      let acc = soldierHits.get(ud.soldier); if (!acc) { acc = { dmg: 0, head: 0, n: 0, point: hit.point.clone(), dir: d.clone(), normal: n }; soldierHits.set(ud.soldier, acc); }
      acc.dmg += dmg; acc.n++; if (head) acc.head++; if (head && acc.head === 1) acc.point.copy(hit.point);
      S.fx.impact(hit.point, n, 'flesh', d);
      ctx.bus.emit('impact', { point: hit.point.clone(), normal: n, surface: 'flesh' });
    } else {
      const surface = ud.surface || (ctx.world?.surfaceAt?.(hit.point)) || 'concrete';
      S.fx.impact(hit.point, n, surface, d);
      ctx.bus.emit('impact', { point: hit.point.clone(), normal: n, surface, distance: dist, object: hit.object, instanceId: hit.instanceId, dir: d.clone(), damage: sp.damage });
    }
  }
  for (const [soldier, acc] of soldierHits) {
    // single bullets: head = instant (ai.damage handles it). Pellets: a headshot needs at least half the pattern on the head.
    const headshot = rays > 1 ? acc.head * 2 >= rays : acc.head > 0;
    const dmg = Math.round(acc.dmg); if (dmg <= 0) continue;
    try { ctx.ai?.damage?.(soldier, dmg, acc.point.clone(), headshot); } catch (e) { console.warn('[weapons] ai.damage', e); }
    if (sp.melee && soldier.dead) { const pk = ctx.ai?.lootGun?.(soldier); if (pk && collectGun(pk.id, pk.reserve)) pk.take(); }   // stabbed him: his gun is yours
    ctx.bus.emit('hit', { soldier, damage: dmg, headshot, point: acc.point.clone(), pellets: acc.n, kill: !!soldier.dead });   // ai.damage already sent enemyKilled: keep its kill marker up
  }
  for (const [peer, acc] of remoteHits) {
    const headshot = rays > 1 ? acc.head * 2 >= rays : acc.head > 0; const dmg = Math.round(acc.dmg); if (dmg <= 0) continue;
    try { ctx.net?.hit?.(peer, dmg, headshot, acc.point); } catch (e) { console.warn('[weapons] net.hit', e); }
    ctx.bus.emit('hit', { remote: peer, damage: dmg, headshot, point: acc.point.clone(), pellets: acc.n });
  }
  const dist = firstHit ? firstDist : sp.range;

  // muzzle world position (visual) — used by light, brass, tracer, smoke
  // fists: the chain (jab → cross → hook) and its damage, before the hit is worked out
  if (sp.fists) { S.combo = now - (S.comboT ?? -9) < 0.7 ? ((S.combo || 0) + 1) % 3 : 0; S.comboT = now; sp.damage = Math.round(FIST_BASE * FIST_MUL[S.combo] * (S.ctx.xrPunchK || 1)); }   // VR: a faster real punch hits harder
  const muzzle = w.parts.muzzle.getWorldPosition(new THREE.Vector3());
  if (sp.melee) { S.swing = { t: 0, kind: sp.fists ? 2 + S.combo : (S.swingN = (S.swingN || 0) + 1) % 2 }; if (sp.fists && S.combo === 2) S.ctx.hud?.toast?.('HOOK!', 500);
    const hu = firstHit?.object?.userData; if (hu && (hu.onHit || hu.soldier || hu.remote)) { ctx.ai?.blood?.(firstHit.point.x, firstHit.point.z, 0.35 + rng() * 0.25, firstHit.point.y - 1); S.rpv.z += 6; ctx.bus.emit('meleeHit', { point: firstHit.point.clone() }); }   // it went in: blood on the ground + the hand stops dead
    ctx.bus.emit('shot', { origin, dir, weapon: sp.name, id: sp.id, who: 'player', melee: true, muzzle, hit: firstHit ? firstHit.point.clone() : null }); return; }
  S.fx.muzzleLightAt(muzzle, sp.flashStrength ?? (sp.slot === 0 ? 1 : 0.7), opts.hold ? opts.hold : 0.045);
  // viewmodel flash
  S.flashT = 0; S.flashLife = opts.hold ? opts.hold : (0.04 + rng() * 0.02) * (sp.pellets ? 1.6 : 1); S.flashW = w;
  w.flashMat.map.offset.x = Math.floor(rng() * 3) / 3; w.flash.rotation.z = rng() * Math.PI * 2; w.flash.scale.setScalar(0.85 + rng() * 0.4); w.flash.visible = true; w.flashMat.opacity = 1;
  // brass: immediately for self-loaders; manual actions eject when the action opens
  if (!sp.action) ejectFor(w, p);
  // tracer 1-in-3 (never for pellets), smoke wisp every other shot (always for the big bores)
  if (!sp.pellets && w.shots % 3 === 1) S.fx.tracer(muzzle, _v2.subVectors(firstHit ? firstHit.point : _v3.copy(origin).addScaledVector(dir, dist), muzzle).normalize(), dist);
  if (w.shots % 2 === 0 || opts.hold || sp.action) { S.fx.muzzleSmoke(muzzle, _fwd); if (sp.pellets) S.fx.muzzleSmoke(muzzle, _fwd); }

  // visual recoil (spring impulses) — smaller in ADS
  const k = lerp(1, 0.55, S.ads);
  S.rpv.z += sp.kickBack * 40 * k; S.rrv.x += sp.kickUp * 40 * k; S.rrv.z += (rng() - 0.5) * 2 * sp.kickRoll * 40 * k; S.rrv.y += (rng() - 0.5) * sp.kickRoll * 30 * k; S.rpv.x += (rng() - 0.5) * 0.15 * k;
  // camera recoil pattern: climbs, drifts right for the first burst then wanders
  if (p && !opts.noCamera) {
    const n = w.shots; const patternYaw = n < 4 ? 0.3 : n < 9 ? -0.7 : Math.sin(n * 1.7) * 0.8;
    const kp = sp.recoilPitch * DEG * (0.85 + rng() * 0.3) * (n === 1 ? 1.15 : 1) * lerp(1, 0.85, S.ads);
    const ky = sp.recoilYaw * DEG * (patternYaw + (rng() - 0.5) * 1.2) * lerp(1, 0.85, S.ads);
    S.shakeAmp = Math.min(SHAKE_MAX, S.shakeAmp + (sp.shake ?? 0.0025 + sp.recoilPitch * DEG * 0.35));   // big bores rattle the view more
    S.kickP += kp; S.kickY += ky; // applied over ~50 ms in update() (exp-smoothed, dt-independent) so the climb reads as a push, not a teleport
  }
  ctx.bus.emit('shot', { origin, dir, weapon: sp.name, id: sp.id, who: 'player', muzzle, hit: firstHit ? firstHit.point.clone() : null, pellets: rays });
  w.cur.ammo = w.ammo;
  return firstHit ? firstHit.point.clone() : null;
}

// ------------------------------------------------------------------ touch aim assist: slowdown over a target + a gentle pull while aiming / firing
const ASSIST_CONE = 5 * DEG, ASSIST_CONE_ADS = 8 * DEG, ASSIST_RANGE = 45, ASSIST_FRICTION = 0.45, ASSIST_PULL = 5, ASSIST_PULL_HIP = 2.5, ASSIST_MAX_RATE = 30 * DEG;
const _aimPt = new THREE.Vector3();
/** hostile things worth helping onto: live mercs/cops and crew thugs (passers-by only once they fight). Refreshed twice a second. */
function assistTargets(ctx) {
  if (S.assistList && S.time - S.assistT < 0.5) return S.assistList;
  S.assistT = S.time; const out = S.assistList = []; const seen = new Set();
  for (const s of ctx.ai?.soldiers || []) if (!s.dead && s.chest) out.push({ s });
  for (const h of ctx.raycastTargets || []) { const t = h.userData?.thug; if (t && !seen.has(t)) { seen.add(t); out.push({ t }); } }
  return out;
}
const ASSIST_HIGH = { cone: 1.5, friction: 1.6, pull: 1.8 };   // Settings → Aim assist HIGH vs LOW (the phone default)
function aimAssist(dt, ctx, p, cam, input, hi) {
  const eye = cam.getWorldPosition(_v3); cam.getWorldDirection(_fwd); const cone = lerp(ASSIST_CONE, ASSIST_CONE_ADS, S.ads) * (hi ? ASSIST_HIGH.cone : 1);
  let best = null, bestA = cone;
  for (const c of assistTargets(ctx)) {
    if (c.s) { if (c.s.dead) continue; c.s.chest(_aimPt); }
    else { const t = c.t; if (t.st === 'dead' || (t.type === 'mk' && t.intent !== 'fight')) continue; _aimPt.set(t.pos.x, t.pos.y + 1.15, t.pos.z); }
    const d = _aimPt.distanceTo(eye); if (d > ASSIST_RANGE || d < 0.5) continue;
    const a = Math.acos(clamp(_v.subVectors(_aimPt, eye).divideScalar(d).dot(_fwd), -1, 1)); if (a < bestA) { bestA = a; best = c; S.assistPt = (S.assistPt || new THREE.Vector3()).copy(_aimPt); }
  }
  if (best !== S.assistOn) { S.assistOn = best; S.assistLos = null; }
  if (!best) return;
  // line of sight to the chosen one (box colliders, every few frames): no help through walls
  if (S.assistLos === null || ctx.time.frame % 6 === 0) { const d = S.assistPt.distanceTo(eye); _ray.set(eye, _v.subVectors(S.assistPt, eye).divideScalar(d)); let clear = true; for (const b of ctx.colliders || []) { if (b?.min && _ray.intersectBox(b, _v2) && _v2.distanceTo(eye) < d - 0.6) { clear = false; break; } } S.assistLos = clear; }
  if (!S.assistLos) return;
  // slowdown: the finger drags slower across a target
  const mdx = input?.mouse?.dx ?? 0, mdy = input?.mouse?.dy ?? 0;
  if (mdx || mdy) { const base = (ctx.settings.sensitivity ?? 0.0022) * Math.tan(cam.fov * DEG / 2) / Math.tan((ctx.settings.fov || 75) * DEG / 2) * ASSIST_FRICTION * (hi ? ASSIST_HIGH.friction : 1); const dy = mdx * base, dp = clamp(p.pitch + mdy * base, -89 * DEG, 89 * DEG) - p.pitch; p.yaw += dy; p.pitch += dp; cam.rotation.y += dy; cam.rotation.x += dp; }
  // magnetism: only while aiming or firing, a capped fraction of the error per frame
  const pull = (S.adsTarget ? ASSIST_PULL : (input?.fire ? ASSIST_PULL_HIP : 0)) * (hi ? ASSIST_HIGH.pull : 1); if (!pull) return;
  const dx = S.assistPt.x - eye.x, dz = S.assistPt.z - eye.z; let ey = Math.atan2(-dx, -dz) - p.yaw; ey = Math.atan2(Math.sin(ey), Math.cos(ey));
  const ep = Math.atan2(S.assistPt.y - eye.y, Math.hypot(dx, dz)) - p.pitch;
  const k = 1 - Math.exp(-dt * pull), cap = ASSIST_MAX_RATE * dt;
  const ry = clamp(ey * k, -cap, cap), rp = clamp(ep * k * 0.6, -cap, cap); p.yaw += ry; p.pitch += rp; cam.rotation.y += ry; cam.rotation.x += rp;
}

/** Weapons are put away while riding an elevator / sitting as a passenger / driving a car (hands on the wheel). Bikes keep the sidearm live. */
function stowedFor(p) { const m = p?.mounted; return !!(m && (m.elevator || m.dialog || m.craft || (m.spec?.car && (S.weapons[S.cur]?.spec?.slot ?? 0) !== 1))); }   // drivers can drive-by with a pistol (one hand on the wheel); rifles stay stowed   // passengers keep their gun: drive-bys

/** Shooting out of a car's own window: the aim limits come from the window opening itself (no shooting through your own
 *  car's body or roof), and only once that side's glass is down or already shattered (#183: a broken window stays open). */
const WIN_YAW_COS_MAX = 0.62, WIN_PITCH_MAX = 1.05;   // ~52° either side of square-on to the car; ~60° up/down
function carWindowGate(ctx, p) {
  const m = p?.mounted; if (!m) return true;
  let heading, open;
  if (m.spec?.car) { const side = m.spec.eyeSide < 0 ? 'L' : 'R'; heading = m.heading; open = windowOpen(m, 'glassF' + side); }   // driving: p.mounted is the car itself
  else if (m.passenger && m.uber) { const win = ctx.uber?.windowState?.(); if (!win) return true; heading = win.heading; open = win.open; }
  else if (m.passenger) {   // a friend's car: no local pane of our own, gate off what the driver reports (net.js vi.w)
    const id = hangkitKit()?.passenger?.id, q = id && ctx.net?.peer?.(id), pane = hangkit.passengerPane();
    if (!q?.veh || !pane) return true;   // no data yet, or riding pillion on a bike (no window to gate): ungated
    heading = q.heading; open = windowBitOpen(q.veh.w, pane);
  }
  else return true;
  if (!open) return false;
  return Math.abs(Math.cos(p.yaw - heading)) < WIN_YAW_COS_MAX && Math.abs(p.pitch) < WIN_PITCH_MAX;
}

// ------------------------------------------------------------------ per-frame
export function update(dt, ctx) {
  if (!S) return;
  ctx.xr?.syncAim?.();   // VR: put the aim on the gun hand for this frame before anything fires
  const p = ctx.player, input = ctx.input, cam = ctx.camera, aim = ctx.xrAim || cam; const playing = ctx.state === 'playing';
  const w = S.weapons[S.cur], sp = w.spec;
  S.time += dt;
  // screen shake from last frame: take it back off unless the player/vehicle already rebuilt the camera rotation this frame
  if (S.shakePost && cam.rotation.x === S.shakePost[0] && cam.rotation.z === S.shakePost[1]) { cam.rotation.x -= S.shakeX; cam.rotation.z -= S.shakeZ; }
  S.shakeX = S.shakeZ = 0; S.shakePost = null;
  if ((S.envCheck += dt) > 1) { S.envCheck = 0; S._ensureEnv(); }
  const actionBusy = !!sp.action && w.needsAction; // pump/bolt cycling (or waiting to start)
  // elevator / passenger / car driver: weapon goes down and stays inert (vehicles.js may also swap slots on mount — tolerated)
  const stowed = stowedFor(p);
  if (stowed !== S.stowed) { S.stowed = stowed; if (stowed) { cancelActions(); S.triggerHeld = false; } }

  // ---------- input ----------
  if (playing && dt > 0 && !S.dead && stowed) {
    for (let n = 1; n <= 9; n++) if (input.consume('Digit' + n) || input.consume('Numpad' + n)) { if (n === 7) selectFists(); else selectBag(n - 1); break; }   // 1–9 / numpad: your collected guns
    S.triggerHeld = false; S.triggerPressed = false; S.adsTarget = 0; if (S.qaAds != null) S.adsTarget = 0;
  } else if (playing && dt > 0 && !S.dead) {
    for (let n = 1; n <= 9; n++) if (input.consume('Digit' + n) || input.consume('Numpad' + n)) { if (n === 7) selectFists(); else selectBag(n - 1); break; }   // 7: fists   // 1–9 / numpad: your collected guns
    if (input.mouse.wheel) {
      if (ctx.input?.keys?.has?.('KeyZ')) { S.zMag = clamp((S.zMag || 4) * (input.mouse.wheel < 0 ? 1.25 : 0.8), 2, 8); ctx.hud?.toast?.(`${S.zMag.toFixed(1)}×`, 600); }
      else if (S.weapons[S.cur]?.spec?.scope && S.adsTarget) {   // sniper aimed: the wheel steps the scope zoom (x0.5 … x3 of its base magnification)
        S.zoomMul = clamp((S.zoomMul || 1) * (input.mouse.wheel < 0 ? 1.25 : 0.8), 0.5, 3);
        const base = 1 / (S.weapons[S.cur].spec.adsFovMul ?? ADS_FOV_MUL); ctx.hud?.toast?.(`${(base * S.zoomMul).toFixed(1)}×`, 600);
      } else startSwap(1 - S.cur);
    }
    if (input.consume('KeyV') && !S.swap && !S.throwing && S.time - (S.stabT ?? -9) > 0.6) quickStab();   // V: stab / jab whatever's in front of you, any weapon
    if (!ctx.trainCab && input.consume('KeyR')) startReload();   // in a train cab R changes ends (coney/subway.js)
    if (input.consume('KeyG')) startThrow();
    if ((!ctx.ai?.nearPickup && !ctx.vehicles?.nearBike && !ctx.interactNear && !ctx.player?.mounted && input.consume('KeyF'))) startInspect();   // interactNear: a map interaction (hangout) owns F; riding anything (the ferry, a train), F is its own
    const trig = !!input.fire; if (trig && !S.triggerHeld) S.triggerPressed = true; if (!trig) S.dryLatch = false; S.triggerHeld = trig;
    if (S.triggerPressed && S.reload?.style === 'shell' && S.reload.phase === 'shell' && w.ammo > 0) S.reload.interrupt = true; // fire interrupts a shell-by-shell reload
    const busy = S.swap || S.throwing;
    S.adsTarget = (input.ads && !sp.melee && !busy && !S.reload && !(actionBusy && sp.scope) && (p?.sprinting !== true || S.triggerHeld)) ? 1 : 0;
    if (S.qaAds != null) S.adsTarget = S.qaAds;
    if (S.adsTarget && S.inspect) S.inspect = null;
  } else { S.triggerPressed = false; if (!playing) S.adsTarget = 0; }

  // ---------- ADS ----------
  const adsSpeed = 1 / sp.adsTime;
  S.adsT = clamp(S.adsT + (S.adsTarget ? dt * adsSpeed : -dt * adsSpeed * 1.15), 0, 1);
  if (S.qaAds != null && S.qaAds > 0 && S.qaAds < 1) S.adsT = S.qaAds; // QA: hold a mid-transition pose
  S.ads = S.adsTarget ? 1 - (1 - S.adsT) ** 2.2 : S.adsT ** 1.8; // ease-out in, ease-in out
  const adsOn = S.adsT > 0.5; if (adsOn !== S.adsOn) { S.adsOn = adsOn; ctx.bus.emit('ads', { on: adsOn, scope: !!sp.scope }); }
  if (p) { p.ads = S.adsTarget === 1; S.sensAds = p.ads; }
  const fovBase = ctx.settings.fov || 75; const adsMul = sp.adsFovMul ?? ADS_FOV_MUL;
  // scopes: fov stays normal until the eye reaches the eyepiece, then snaps down through the last 15% of the transition
  const fovK = sp.scope ? sstep((S.ads - 0.8) / 0.2) : sstep(S.adsT); // irons/dots: smoothstep over adsTime — no velocity pop at either end
  // Z (hold): squint / field-glasses zoom with any gun — ~4x, the wheel steps it 2x…8x (rooftop spotting, long shots)
  const zHeld = !!(ctx.input?.keys?.has?.('KeyZ') || ctx.input?.touch?.zoom) && ctx.state === 'playing'; S.zK = lerp(S.zK || 0, zHeld ? 1 : 0, Math.min(1, dt * 12));
  if (S.vmRoot) S.vmRoot.visible = S.zK < 0.35 && !S.scoped;   // scoped or Z zoom: the gun drops out of the way so it doesn't block the zoomed view
  const targetFov = Math.max(1.5, fovBase * lerp(1, sp.scope ? adsMul / (S.zoomMul || 1) : adsMul, fovK) * lerp(1, 1 / (S.zMag || 4), S.zK));
  if (Math.abs(cam.fov - targetFov) > 0.01 || S.lastFov !== targetFov) { cam.fov = targetFov; cam.updateProjectionMatrix(); S.lastFov = targetFov; }
  // viewmodel projection: x/y scale emulates VM_FOV under the world fov. With spec.adsVmFov the gun is drawn at a steady fov while aimed
  // instead of magnifying with the world zoom (on-axis points stay on-axis at any scale, so the sight line is unaffected).
  { const sHip = Math.tan(fovBase * DEG / 2) / Math.tan(VM_FOV * DEG / 2);
    const s = sp.adsVmFov ? lerp(sHip, Math.tan(cam.fov * DEG / 2) / Math.tan(sp.adsVmFov * DEG / 2), fovK) : sHip;
    if (Math.abs(s - S.vmScale) > 1e-5) { S.vmScale = s; S.vmRoot.scale.set(s, s, 1); } }
  // look sensitivity follows the zoom: the player applied base*(ads ? adsSensitivityMul : 1) this frame; correct that to
  // base * tan(fov/2)/tan(fovBase/2) scaled by the user's ADS multiplier (relative to its 0.6 default) — continuous through the transition.
  if (p && !p.mounted && playing && dt > 0) {
    const mdx0 = input?.mouse?.dx ?? 0, mdy0 = input?.mouse?.dy ?? 0;
    if (mdx0 || mdy0) {
      const base = ctx.settings.sensitivity ?? 0.0022, userAds = ctx.settings.adsSensitivityMul ?? 0.6;
      const applied = S.sensAds ? userAds : 1;
      const want = (Math.tan(cam.fov * DEG / 2) / Math.tan(fovBase * DEG / 2)) * lerp(1, userAds / 0.6, fovK);
      const k = base * (want - applied);
      const dyaw = -mdx0 * k, pitch0 = p.pitch, pitch1 = clamp(p.pitch - mdy0 * k, -89 * DEG, 89 * DEG);
      p.yaw += dyaw; p.pitch = pitch1; cam.rotation.y += dyaw; cam.rotation.x += pitch1 - pitch0;
      // recoil compensation: pulling down against the climb pays off the recovery debt, so recovery returns to the aim point instead of overshooting below it
      const dPitch = -mdy0 * base * want, dYaw = -mdx0 * base * want;
      if (S.recPitch > 0 && dPitch < 0) S.recPitch = Math.max(0, S.recPitch + dPitch); else if (S.recPitch < 0 && dPitch > 0) S.recPitch = Math.min(0, S.recPitch + dPitch);
      if (S.recYaw * dYaw < 0) S.recYaw = Math.sign(S.recYaw) * Math.max(0, Math.abs(S.recYaw) - Math.abs(dYaw));
    }
  }

  // aim assist: LOW helps thumbs only (phones), HIGH every stick and mouse too; never in VR (the gun is in your hand)
  const assist = ctx.settings.aimAssist ?? 'low';
  if ((assist === 'high' || (assist === 'low' && ctx.isTouch)) && !ctx.xrAim && p && !p.mounted && playing && dt > 0 && !S.dead && !sp.melee) aimAssist(dt, ctx, p, cam, input, assist === 'high');

  // ---------- sprint / lowered blends ----------
  const wantSprint = !!(p?.sprinting) && !S.triggerHeld && !S.reload && !S.throwing && S.adsTarget === 0;
  S.sprint = damp(S.sprint, wantSprint ? 1 : 0, wantSprint ? 9 : 14, dt);
  let lowerT = 0;
  // swap
  if (S.swap) {
    const sw = S.swap; sw.t += dt;
    if (sw.phase === 'lower') { lowerT = sstep(sw.t / (sw.dur * 0.45)); if (sw.t >= sw.dur * 0.45) { S.weapons[S.cur].group.visible = false; S.cur = sw.to; S.weapons[S.cur].group.visible = true; sw.phase = 'raise'; sw.t = 0; ctx.bus.emit('swap', { slot: S.cur, name: S.weapons[S.cur].spec.name }); S.rrv.x -= 3; } }
    else { lowerT = 1 - sstep(sw.t / (sw.dur * 0.55)); if (sw.t >= sw.dur * 0.55) { S.swap = null; lowerT = 0; } }
  }
  if (S.dead || ctx.state === 'dead' || stowed) lowerT = Math.max(lowerT, 1);
  // grenade throw
  if (S.throwing) {
    const th = S.throwing; th.t += dt;
    if (!th.pinned && th.t > 0.12) { th.pinned = true; ctx.bus.emit('grenade', { stage: 'pin' }); }
    if (!th.thrown && th.t > 0.5) { th.thrown = true; S.grenadeCount = Math.max(0, S.grenadeCount - 1); aim.updateMatrixWorld(true); aim.getWorldDirection(_fwd); _right.set(1, 0, 0).applyQuaternion(aim.quaternion);
      const o = aim.getWorldPosition(new THREE.Vector3()).addScaledVector(_fwd, 0.35).addScaledVector(_right, 0.2).add(_v.set(0, -0.15, 0));
      const v = new THREE.Vector3().copy(_fwd).multiplyScalar(17).add(_v.set(0, 3.2, 0)); if (p?.velocity) v.addScaledVector(p.velocity, 0.6);
      S.grenades.spawn(o, v); ctx.bus.emit('grenade', { stage: 'throw', position: o.clone() }); S.rrv.x -= 4; S.rpv.z += 0.5; }
    lowerT = Math.max(lowerT, th.t < 0.5 ? sstep(th.t / 0.3) : 1 - sstep((th.t - 0.5) / 0.55));
    if (th.t >= th.dur) S.throwing = null;
  }
  S.lower = damp(S.lower, lowerT, 30, dt);

  // ---------- firing ----------
  const canFire = playing && !S.dead && !stowed && !S.reload && !S.swap && !S.throwing && S.lower < 0.3 && S.sprint < 0.45 && (p?.canFire !== false) && !actionBusy && carWindowGate(ctx, p);
  w.fireTimer -= dt;
  if (canFire && dt > 0 && (sp.auto ? S.triggerHeld : S.triggerPressed)) {
    if (w.ammo > 0) { let guard = 0; while (w.fireTimer <= 0 && w.ammo > 0 && guard++ < 3 && !w.needsAction) { fireShot(w); w.fireTimer += 60 / sp.rpm; } }
    else dryFire(w);
  }
  if (w.fireTimer < 0) w.fireTimer = 0;
  S.triggerPressed = false;
  if (S.inspect) { S.inspect.t += dt; if (S.inspect.t >= S.inspect.dur) S.inspect = null; }

  // spread decay & camera recoil: pending kick lands over ~50 ms (exp, dt-independent), a share of it is "debt" that recovers after the burst
  S.spreadExtra = damp(S.spreadExtra, 0, S.time - w.lastShot > 0.12 ? 9 : 2.5, dt);
  if (p && dt > 0 && (S.kickP || S.kickY)) {
    const f = 1 - Math.exp(-dt * 45); let kp = S.kickP * f, ky = S.kickY * f;
    if (Math.abs(S.kickP - kp) < 1e-5 && Math.abs(S.kickY - ky) < 1e-5) { kp = S.kickP; ky = S.kickY; }
    S.kickP -= kp; S.kickY -= ky;
    const pitch0 = p.pitch; p.pitch = clamp(p.pitch + kp, -89 * DEG, 89 * DEG); kp = p.pitch - pitch0; p.yaw += ky; cam.rotation.x += kp; cam.rotation.y += ky;
    const rec = sp.recoilRecover ?? 0.55; S.recPitch += kp * rec; S.recYaw += ky * (sp.recoilRecover ?? 0.4);
  } else if (!p) { S.kickP = S.kickY = 0; }
  if (p && S.time - w.lastShot > RECOIL_HOLD) {   // the kick's tail may still be landing: the debt it adds is paid back in the same pass
    const kr = 1 - Math.exp(-dt * (sp.recoilReturn ?? RECOIL_RETURN));
    const rp = S.recPitch * kr, ry = S.recYaw * kr; S.recPitch -= rp; S.recYaw -= ry; p.pitch -= rp; p.yaw -= ry; cam.rotation.x -= rp; cam.rotation.y -= ry;
    if (Math.abs(S.recPitch) < 1e-4) S.recPitch = 0; if (Math.abs(S.recYaw) < 1e-4) S.recYaw = 0;
  }

  // ---------- reload timeline ----------
  const reloadOff = { pos: _rlp.set(0, 0, 0), rot: _rlr.set(0, 0, 0) }; // extra weapon offset while reloading / cycling
  const armL = w.parts.armL, armR = w.parts.armR, mag = w.parts.mag;
  if (armL) { armL.position.copy(armL.userData.home.pos); if (armL.userData.home.rot) armL.rotation.copy(armL.userData.home.rot); else armL.rotation.set(0, 0, 0); }   // the knife is one-handed
  if (armR) { armR.position.copy(armR.userData.home.pos); if (armR.userData.home.rot) armR.rotation.copy(armR.userData.home.rot); else armR.rotation.set(0, 0, 0); }
  if (S.reload && S.reload.style === 'mag') {
    const r = S.reload; r.t += dt; const u = clamp(r.t / r.dur, 0, 1);
    const rk = sp.reloadKeys || (sp.slot === 0 ? RIFLE_SPEC.reloadKeys : PISTOL_SPEC.reloadKeys); const isLong = sp.slot === 0;
    const rackAtEnd = r.empty && !sp.action; // bolt guns cycle the bolt after the mag is in instead of racking a handle
    // weapon tilt: roll left + nose down while the hand works the mag, back at the end
    const tiltK = rk.tiltK ?? 1;
    const settle = u > 0.72 ? 1 - sstep((u - 0.72) / 0.28) : 1;
    const ro = sp.reloadOff || { rot: [-0.14 * tiltK, 0.12, -0.42 * tiltK], pos: [0.012, -0.02, 0.01] };
    reloadOff.rot.set(ro.rot[0] * settle, ro.rot[1] * settle, ro.rot[2] * settle); reloadOff.pos.set(ro.pos[0] * settle, ro.pos[1] * settle, ro.pos[2] * settle);
    // left hand track (weapon space, relative to home)
    const magHome = mag.userData.home; const wrist = armL.userData.home.pos;
    const magGrab = rk.magGrab, down = rk.down, rack = rk.rack;
    const rel = (a) => [a[0] - wrist.x, a[1] - wrist.y, a[2] - wrist.z]; // absolute weapon-space → offset from home
    const homeOff = [0, 0, 0];
    const keys = rackAtEnd
      ? [[0, homeOff], [0.16, rel(magGrab)], [0.2, rel(magGrab)], [0.42, rel(down)], [0.5, rel(down)], [0.72, rel(magGrab)], [0.76, rel(magGrab)], [0.86, rel(rack)], [0.93, [rack[0] - wrist.x, rack[1] - wrist.y, rack[2] - wrist.z + 0.035]], [1.0, homeOff]]
      : [[0, homeOff], [0.18, rel(magGrab)], [0.22, rel(magGrab)], [0.45, rel(down)], [0.52, rel(down)], [0.76, rel(magGrab)], [0.8, rel(magGrab)], [1.0, homeOff]];
    const off = track(_v3, u, keys); armL.position.add(off);
    // hand orientation: rotate to grab (palm inward), then to the rack
    const rotK = pulse(u, 0.18, 0.75); armL.rotation.set(-0.5 * rotK * (u > 0.84 && rackAtEnd ? 0.3 : 1), 0.25 * rotK, (isLong ? 0.9 : 0.6) * rotK);
    // magazine events + motion
    if (!r.magOut && u >= 0.2) { r.magOut = true; ctx.bus.emit('reload', { stage: 'magOut', weapon: sp.name }); r.dropV = 0; r.dropY = 0; }
    if (r.magOut && !r.magIn) {
      if (u < 0.5) { r.dropV = (r.dropV || 0) + 12 * dt; r.dropY = (r.dropY || 0) + r.dropV * dt; mag.position.copy(magHome).add(_v3.set(0.0, -r.dropY, -r.dropY * 0.4)); mag.rotation.x = -r.dropY * 2.5; mag.visible = r.dropY < 0.5; }
      else { // new mag carried by the left hand from below into the well
        const k = sstep((u - 0.5) / (rackAtEnd ? 0.22 : 0.26)); mag.visible = true;
        mag.position.copy(magHome).add(_v3.set(0.0, -0.2 * (1 - k), -0.05 * (1 - k))); mag.rotation.set(-0.35 * (1 - k), 0, 0.3 * (1 - k));
      }
    }
    if (!r.magIn && u >= (rackAtEnd ? 0.72 : 0.76)) { r.magIn = true; mag.position.copy(magHome); mag.rotation.set(0, 0, 0); mag.visible = true; ctx.bus.emit('reload', { stage: 'magIn', weapon: sp.name }); S.rpv.y += 0.6; S.rrv.x += 1.2;
      const take = Math.min(sp.mag - w.ammo, w.reserve); w.ammo += take; w.reserve -= take; w.cur.ammo = w.ammo; w.cur.reserve = w.reserve; if (!r.empty) w.slideLocked = false; }
    // charging handle / slide rack on empty reload
    if (rackAtEnd) {
      const rkk = u > 0.86 && u < 0.98 ? pulse((u - 0.86) / 0.12, 0.45, 0.55) : 0;
      if (w.parts.chargingHandle) { const ch = w.parts.chargingHandle; ch.position.z = ch.userData.homeZ + rkk * ch.userData.travel; }
      if (w.parts.bolt) w.parts.bolt.position.z = -0.02 + rkk * 0.05;
      if (!r.racked && u > 0.94) { r.racked = true; w.slideLocked = false; w.boltT = 0.02; S.rrv.x -= 0.8; S.rpv.z += 0.3; if (isLong) w.boltT = 9; }
      if (w.parts.slide) w.slideLocked = w.slideLocked && u < 0.93;
    }
    if (u >= 1) { const cycle = r.empty && sp.action; endReload(true); if (cycle) startAction(w, 0.05); }
  } else if (S.reload && S.reload.style === 'shell') {
    // shell-by-shell tube reload: start (hand to the pouch) → N × [pouch → loading port → push] → end (hand back to the forend)
    const r = S.reload; r.t += dt; const wrist = armL.userData.home.pos;
    const sk = sp.shellKeys || {}; const pouchA = sk.pouch || [-0.07, -0.34, 0.12], portA = sk.port || [-0.008, -0.15, -0.045];
    const pouch = [pouchA[0] - wrist.x, pouchA[1] - wrist.y, pouchA[2] - wrist.z], port = [portA[0] - wrist.x, portA[1] - wrist.y, portA[2] - wrist.z], pushed = [port[0] + 0.01, port[1] + 0.04, port[2] - 0.01];
    const rotPouch = sk.rotPouch || [-0.3, 0.2, 0.3], rotPort = sk.rotPort || [0.55, 0.25, 0.85];
    const shell = w.parts.shell; let hand = null, handRot = null, k = 0;
    if (r.phase === 'start') {
      const u = clamp(r.t / sp.reloadStart, 0, 1); k = sstep(u);
      hand = track(_v3, k, [[0, [0, 0, 0]], [1, pouch]]); handRot = rotPouch.map(v => v * k);
      if (u >= 1) { r.phase = 'shell'; r.t = 0; }
    } else if (r.phase === 'shell') {
      const u = clamp(r.t / sp.shellTime, 0, 1);
      hand = track(_v3, u, [[0, pouch], [0.5, port], [0.62, pushed], [0.72, port], [1.0, pouch]]);
      const kk = pulse(u, 0.5, 0.5); handRot = [lerp(rotPouch[0], rotPort[0], kk), lerp(rotPouch[1], rotPort[1], kk), lerp(rotPouch[2], rotPort[2], kk)];
      if (shell) shell.visible = u > 0.06 && u < 0.62;
      if (!r.pushed && u >= 0.62) { r.pushed = true; r.shells++; w.ammo = Math.min(sp.mag, w.ammo + 1); w.reserve--; w.cur.ammo = w.ammo; w.cur.reserve = w.reserve; S.rpv.y += 0.5; S.rrv.x += 0.6; S.rrv.z -= 0.5; ctx.bus.emit('reload', { stage: 'shell', weapon: sp.name, n: r.shells, ammo: w.ammo }); }
      if (u >= 1) { r.t = 0; r.pushed = false; if (w.ammo >= sp.mag || w.reserve <= 0 || r.interrupt) r.phase = 'end'; }
      k = 1;
    } else { // end
      const u = clamp(r.t / sp.reloadEnd, 0, 1); k = 1 - sstep(u);
      hand = track(_v3, 1 - k, [[0, pouch], [1, [0, 0, 0]]]); handRot = rotPouch.map(v => v * k);
      if (shell) shell.visible = false;
      if (u >= 1) { const cycle = r.empty; endReload(true); if (cycle) startAction(w, 0.05); }
    }
    if (hand) { armL.position.add(hand); armL.rotation.set(handRot[0], handRot[1], handRot[2]); }
    if (shell && shell.visible && shell.userData.off) shell.position.copy(armL.position).add(shell.userData.off);
    // weapon rolls left / tips up a bit to present the loading port
    const so = sp.shellOff || { rot: [0.16, 0.22, -0.5], pos: [-0.02, 0.05, -0.02] };
    reloadOff.rot.set(so.rot[0] * k, so.rot[1] * k, so.rot[2] * k); reloadOff.pos.set(so.pos[0] * k, so.pos[1] * k, so.pos[2] * k);
  }

  // ---------- manual action (pump / bolt) ----------
  if (w.parts.pump) { w.parts.pump.position.copy(w.parts.pump.userData.home); }
  if (w.parts.boltHandle) { w.parts.boltHandle.position.copy(w.parts.boltHandle.userData.home); w.parts.boltHandle.rotation.set(0, 0, 0); }
  if (sp.action && w.needsAction) {
    const blocked = S.reload || S.swap || S.throwing || S.lower > 0.3 || !playing || S.dead; // wait until the hands are free
    if (!blocked) w.actionT += dt; else if (w.actionT < 0) w.actionT = -0.02;
    const u = w.actionT / sp.actionTime;
    if (u >= 1) { w.needsAction = false; w.actionT = 9; }
    else if (u >= 0) {
      if (!w.actionOpened) { w.actionOpened = true; ctx.bus.emit('action', { stage: 'open', kind: sp.action, weapon: sp.name }); }
      if (sp.action === 'pump') {
        const back = sstep((u - 0.04) / 0.32) * (1 - sstep((u - 0.56) / 0.34));
        const travel = w.parts.pump.userData.travel || 0.075;
        w.parts.pump.position.z += travel * back; armL.position.z += travel * back;
        if (!w.actionEjected && u >= 0.30) { w.actionEjected = true; ejectFor(w, p); S.rpv.z += 0.9; S.rrv.x -= 1.0; }
        if (!w.actionClosed && u >= 0.62) { w.actionClosed = true; ctx.bus.emit('action', { stage: 'close', kind: sp.action, weapon: sp.name }); }
        if (u >= 0.88 && !w.actionLocked) { w.actionLocked = true; S.rpv.z -= 0.8; S.rrv.x += 1.4; S.rrv.z += 0.6; }
        const dip = Math.sin(clamp(u, 0, 1) * Math.PI);
        reloadOff.rot.x += -0.05 * dip; reloadOff.rot.z += 0.045 * dip; reloadOff.pos.y += -0.012 * dip; reloadOff.pos.z += 0.012 * dip;
      } else if (sp.action === 'bolt') {
        const bh = w.parts.boltHandle, tr = bh.userData.travel || 0.085;
        const lift = sstep(u / 0.2) * (1 - sstep((u - 0.78) / 0.2));
        const pull = sstep((u - 0.24) / 0.22) * (1 - sstep((u - 0.54) / 0.24));
        bh.rotation.z = (bh.userData.liftAngle || 1.15) * lift; bh.position.z += tr * pull;
        if (w.parts.boltBody) w.parts.boltBody.position.z = w.parts.boltBody.userData.home.z + tr * pull;
        // right hand leaves the grip to work the bolt
        if (armR && bh.userData.grip) { const g = bh.userData.grip, hr = armR.userData.home.pos; const reach = sstep(u / 0.16) * (1 - sstep((u - 0.84) / 0.16));
          armR.position.x += (g[0] - hr.x) * reach; armR.position.y += (g[1] - hr.y) * reach; armR.position.z += (g[2] - hr.z) * reach + tr * pull;
          armR.rotation.set(-0.9 * reach, 0.2 * reach, -0.5 * reach + 0.4 * lift); }
        if (!w.actionEjected && u >= 0.42) { w.actionEjected = true; ejectFor(w, p); S.rpv.z += 0.5; }
        if (!w.actionClosed && u >= 0.62) { w.actionClosed = true; ctx.bus.emit('action', { stage: 'close', kind: sp.action, weapon: sp.name }); }
        if (!w.actionLocked && u >= 0.9) { w.actionLocked = true; S.rrv.z -= 1.2; S.rrv.x += 0.8; }
        if (u < 0.02 && p && !w.actionNudged) { w.actionNudged = true; const np = -0.25 * DEG, ny = 0.35 * DEG; p.pitch += np; p.yaw += ny; cam.rotation.x += np; cam.rotation.y += ny; S.recPitch += np; S.recYaw += ny; S.rrv.z -= 2.0; S.rrv.x -= 0.8; }
        const dip = Math.sin(clamp(u, 0, 1) * Math.PI);
        reloadOff.rot.x += 0.06 * dip; reloadOff.rot.z += 0.30 * dip; reloadOff.rot.y += -0.22 * dip; reloadOff.pos.x += -0.05 * dip; reloadOff.pos.y += 0.01 * dip; reloadOff.pos.z += -0.02 * dip; // bring the receiver into view, roll so the lifted handle shows
      }
    }
    if (u >= 1 || u < 0) { w.actionLocked = false; if (u >= 1) w.actionNudged = false; }
  }

  // ---------- inspect ----------
  const insp = _ins.set(0, 0, 0); let inspRot = null;
  if (S.inspect) { const k = S.inspect.t / S.inspect.dur; const e = Math.sin(k * Math.PI); inspRot = [0.25 * e, 1.25 * Math.sin(k * Math.PI * 2) * e + 0.3 * e, 0.55 * e]; insp.set(-0.06 * e, 0.02 * e, 0.05 * e); }

  // ---------- pose composition ----------
  const sight = w.parts.sight.position;
  const adsPos = [-sight.x, -sight.y, -sp.adsDist - sight.z];
  const pos = lerp3(_v, sp.hip.pos, adsPos, S.ads), rot = lerp3(_v2, sp.hip.rot, [0, 0, 0], S.ads);
  lerp3(pos, [pos.x, pos.y, pos.z], sp.sprint.pos, S.sprint); lerp3(rot, [rot.x, rot.y, rot.z], sp.sprint.rot, S.sprint);
  lerp3(pos, [pos.x, pos.y, pos.z], sp.lower.pos, S.lower); lerp3(rot, [rot.x, rot.y, rot.z], sp.lower.rot, S.lower);
  pos.add(reloadOff.pos).add(insp); rot.add(reloadOff.rot); if (inspRot) { rot.x += inspRot[0]; rot.y += inspRot[1]; rot.z += inspRot[2]; }
  // wall clip avoidance: pull back when something is right in front
  if (ctx.colliders?.length && (ctx.time.frame % 3 === 0)) { aim.getWorldDirection(_fwd); _ray.set(aim.getWorldPosition(_up), _fwd); const reach = sp.wallReach ?? 0.8; let best = reach; for (let i = 0; i < ctx.colliders.length; i++) { const b = ctx.colliders[i]; if (!b?.min) continue; const hp = _ray.intersectBox(b, _v3); if (hp) { const d = hp.distanceTo(_ray.origin); if (d < best) best = d; } } S.wallTarget = best < reach ? (reach - best) : 0; }
  S.wallPull = damp(S.wallPull, S.wallTarget || 0, 12, dt); pos.z += S.wallPull * 0.55; pos.y -= S.wallPull * 0.08; rot.x += S.wallPull * 0.9; rot.y += S.wallPull * 0.4;
  if (S.showcase) { const sc = S.showcase; pos.set(sc.x, sc.y, -sc.dist); rot.set(sc.pitch, sc.yaw, 0); }
  S.poseNode.position.copy(pos); S.poseNode.rotation.set(rot.x, rot.y, rot.z);

  // ---------- sway node: idle sway + look lag + bob + recoil spring ----------
  const t = S.time, adsK = lerp(1, 0.18, S.ads), sprintK = 1 + S.sprint * 1.5;
  const mdx = input?.mouse?.dx ?? 0, mdy = input?.mouse?.dy ?? 0;
  S.lookX = damp(S.lookX, clamp(mdx, -60, 60), 14, dt); S.lookY = damp(S.lookY, clamp(mdy, -60, 60), 14, dt);
  const bob = p?.bob || { x: 0, y: 0, roll: 0 }; S.bobX = damp(S.bobX, bob.x, 22, dt); S.bobY = damp(S.bobY, bob.y, 22, dt);
  // spring integrate (semi-implicit): x'' = -k x - c x'
  const K = 420, C = 30; // substepped: raw Euler at dt>=0.08 s (sub-12 fps) went unstable and made the viewmodel jitter after landings/shots
  for (const [x, v] of [[S.rp, S.rpv], [S.rr, S.rrv]]) { let rem = dt; while (rem > 0) { const h = Math.min(rem, 1 / 240); v.x += (-K * x.x - C * v.x) * h; v.y += (-K * x.y - C * v.y) * h; v.z += (-K * x.z - C * v.z) * h; x.addScaledVector(v, h); rem -= h; } }
  const sn = S.swayNode; if (S.showcase) { sn.position.set(0, 0, 0); sn.rotation.set(0, 0, 0); }
  const swx = (Math.sin(t * 0.7) + 0.5 * Math.sin(t * 1.9 + 1.3) + 0.25 * Math.sin(t * 3.7)) * 0.0022 * adsK * sprintK;
  const swy = (Math.sin(t * 1.1 + 2.0) + 0.5 * Math.sin(t * 2.6) + 0.25 * Math.sin(t * 4.3 + 0.7)) * 0.0018 * adsK * sprintK;
  const land = p?.landImpulse || 0;
  if (!S.showcase) sn.position.set(
    swx - S.lookX * 0.00045 * adsK + S.bobX * 0.9 * adsK + S.rp.x,
    swy - S.lookY * 0.00035 * adsK - S.bobY * 1.1 * adsK - land * 0.05 + S.rp.y * 0.02,
    S.rp.z * 0.025 + land * 0.02);
  if (!S.showcase) sn.rotation.set(
    (Math.sin(t * 0.9 + 0.4) * 0.004) * adsK - S.lookY * 0.0012 * adsK + S.rr.x * 0.05 - land * 0.12 - S.bobY * 1.4 * adsK,
    (Math.sin(t * 0.6 + 1.7) * 0.004) * adsK - S.lookX * 0.0016 * adsK + S.rr.y * 0.05 + S.bobX * 1.2 * adsK,
    (Math.sin(t * 0.8 + 3.1) * 0.005) * adsK - S.lookX * 0.0011 * adsK + S.rr.z * 0.05 + (bob.roll || 0) * 0.6 + S.bobX * 1.4 * adsK);

  // ---------- melee swing: keyed wind-up → strike → recover, alternating a straight stab and a backhand slash ----------
  if (S.swing && !S.showcase) {
    const sw = S.swing, keys = SWINGS[sw.kind], dur = keys[keys.length - 1][0]; if (!sw.freeze) sw.t += dt;
    if (sw.t >= dur || !sp.melee) S.swing = null;
    else { let i = 0; while (i < keys.length - 2 && sw.t > keys[i + 1][0]) i++;
      const [t0, a] = keys[i], [t1, b] = keys[i + 1], k = smooth((sw.t - t0) / Math.max(1e-3, t1 - t0)), L = (j) => a[j] + (b[j] - a[j]) * k;
      const tgt = sp.fists ? (sw.kind === 3 ? w.parts.armR : w.parts.armL) : sn;   // punches throw one fist; blades swing the whole hand
      if (tgt) { tgt.position.x += L(0); tgt.position.y += L(1); tgt.position.z += L(2); tgt.rotation.x += L(3); tgt.rotation.y += L(4); tgt.rotation.z += L(5); } }
  }

  // ---------- scope (sniper): overlay replaces the viewmodel once the eye is on the eyepiece; aim sway moves the camera ----------
  const scoped = !!sp.scope && S.ads > 0.85 && !S.reload && !S.swap && !S.throwing && S.lower < 0.3 && !S.showcase && !(w.needsAction && w.actionT >= 0);
  if (scoped !== S.scoped) { S.scoped = scoped; S.scope.rig.visible = scoped; if (scoped) ctx.bus.emit('scope', { on: true }); else ctx.bus.emit('scope', { on: false }); }
  if (!S.swap) w.group.visible = !S.ctx.trainCab && !scoped && !(stowed && S.lower > 0.9) && !(sp.fists && S.time - w.lastShot > 2.2 && !S.swing);   // fists: hands down when you're not fighting
  // only the gun in your hands is ever drawn: bag swaps / pickups / loadout changes could leave an earlier gun's model showing
  { const held = S.weapons[S.cur]; for (const id in S.cache) { const c = S.cache[id]; if (c !== held && c.group.visible) c.group.visible = false; } }
  if (scoped) {
    const sc = S.scope; const half = 0.5 * Math.tan(cam.fov * DEG / 2); sc.rig.scale.set(half, half, 1);
    // scope shadow: eye offset from the recoil spring + bob, so the exit pupil crescent moves like a real eyepiece
    const ox = S.rr.y * 0.05 + S.bobX * 0.8, oy = S.rr.x * 0.05 - S.bobY * 0.8; sc.shadow.position.set(ox * 6, oy * 6, 0); sc.shadow.material.opacity = clamp(Math.hypot(ox, oy) * 40, 0, 0.8);
    // sway (radians) applied as camera deltas; breath-hold on Shift steadies it
    const hold = input?.sprint ? 0.3 : 1; const mv = clamp((p?.speed ?? 0) / 4.4, 0, 1.5);
    const amp = (sp.scopeSway ?? 0.0022) * hold * (1 + mv * 2.5);
    const sx = (Math.sin(t * 0.55) + 0.5 * Math.sin(t * 1.35 + 1.3) + 0.3 * Math.sin(t * 2.9 + 0.4)) * amp;
    const sy = (Math.sin(t * 0.8 + 2.0) + 0.5 * Math.sin(t * 1.9) + 0.3 * Math.sin(t * 3.4 + 0.7)) * amp * 0.8;
    if (p && dt > 0) { const dyaw = sx - S.swayYaw, dpitch = sy - S.swayPitch; p.yaw += dyaw; p.pitch += dpitch; cam.rotation.y += dyaw; cam.rotation.x += dpitch; S.swayYaw = sx; S.swayPitch = sy; }
  } else if (S.swayYaw || S.swayPitch) { if (p) { p.yaw -= S.swayYaw; p.pitch -= S.swayPitch; cam.rotation.y -= S.swayYaw; cam.rotation.x -= S.swayPitch; } S.swayYaw = 0; S.swayPitch = 0; }

  // ---------- moving parts ----------
  for (const ww of S.weapons) {
    ww.boltT += dt; ww.trigT += dt; const pp = ww.parts;
    if (pp.slide) { // pistols: slide cycle + lock-back on empty
      const bt = ww.boltT; const cyc = bt < 0.085 ? pulse(bt / 0.085, 0.3, 0.7) : 0;
      pp.slide.position.z = ww.slideLocked ? (pp.slide.userData.lockBack ?? 0.03) : cyc * (pp.slide.userData.travel ?? 0.032);
    }
    if (pp.bolt && !ww.spec.action) { if (!S.reload || !S.reload.empty || S.reload.w !== ww) { const bt = ww.boltT; pp.bolt.position.z = -0.02 + (bt < 0.075 ? pulse(bt / 0.075, 0.35, 0.65) * 0.05 : 0); } }
    if (pp.trigger) { const tt = pp.slide ? 0.1 : 0.08; pp.trigger.rotation.x = ww.trigT < tt ? pulse(ww.trigT / tt, 0.3, 0.7) * (pp.slide ? 0.4 : 0.35) : 0; }
    ww.cur.ammo = ww.ammo; ww.cur.reserve = ww.reserve;
  }
  // muzzle flash lifetime
  if (S.flashW) { S.flashT += dt; const fl = S.flashW; if (S.flashT >= S.flashLife) { fl.flash.visible = false; S.flashW = null; } else { const k = S.flashT / S.flashLife; fl.flashMat.opacity = k < 0.5 ? 1 : 1 - (k - 0.5) * 2; fl.flash.scale.setScalar(fl.flash.scale.x * (1 + dt * 4)); } }

  // ---------- screen shake: a quick camera-only wobble on top of the aim (removed again next frame, so it never drifts the aim) ----------
  if (S.shakeAmp > 1e-5 && dt > 0 && !ctx.xr?.presenting) {
    S.shakeAmp *= Math.exp(-dt * SHAKE_DECAY); const a = S.shakeAmp * (1 - S.ads * 0.5);
    S.shakeZ = a * Math.sin(S.time * 83); S.shakeX = a * 0.5 * Math.sin(S.time * 97 + 1.3);
    cam.rotation.x += S.shakeX; cam.rotation.z += S.shakeZ; S.shakePost = [cam.rotation.x, cam.rotation.z];
  } else S.shakeAmp = 0;

  // ---------- world FX ----------
  cam.updateMatrixWorld(true);
  S.fx.update(dt, cam); S.grenades.update(dt);
}

export function onResize(ctx) { S && (S.lastFov = -1); }

export function reset(ctx) {
  if (!S) return;
  cancelActions(); S.swap = null; S.cur = 0; S.dead = false;
  S.weapons.forEach((w, i) => { resetWeapon(w); w.group.visible = i === 0; });
  S.adsTarget = 0; S.adsT = 0; S.ads = 0; S.adsOn = false; S.scoped = false; S.scope.rig.visible = false; S.sprint = 0; S.lower = 0; S.rp.set(0, 0, 0); S.rr.set(0, 0, 0); S.rpv.set(0, 0, 0); S.rrv.set(0, 0, 0);
  S.spreadExtra = 0; S.recPitch = 0; S.recYaw = 0; S.kickP = 0; S.kickY = 0; S.shakeAmp = 0; S.shakeX = S.shakeZ = 0; S.shakePost = null; S.stowed = false; S.swayYaw = 0; S.swayPitch = 0; S.grenadeCount = GRENADES; S.flashW = null; S.wallPull = 0; S.wallTarget = 0;
  S.fx.reset(); S.grenades.reset();
}

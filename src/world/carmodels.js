// Real car models (GLB) for the kinds that have one; everything else stays the lofted carkit body. Loaded once before the
// map builds (world.js), normalised into the carkit frame (+x = front, ground at y 0, centred), and handed out as clones for
// driven / remote cars or as per-mesh InstancedMeshes for parked rows. Materials follow the three.js car example, minus
// transmission (it re-renders the scene every frame): tinted see-through glass instead.
// Models: coupe = "Ferrari 458 Italia" by vicent091036 (https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), CC-BY 4.0,
// via the three.js examples. Owned by: main.
// Street cars (KIT below): sedan = "A Red Mid-sized Four-door Sedan, 1990s To Early 2000s" by TopoSphere, generated with
// Sloyd, CC BY 4.0 (assets/models/sloyd-sedan/SOURCE.md). Converted offline (tools/prep-car-model.mjs) into the kit frame
// (body-tex, keeping the source's one baked texture; the wheels are part of it too, not split out - see SOURCE.md on why -
// so the per-instance paint tint multiplies the whole thing, wheels included; carkit.js's SLOYD_SEDAN_COLORS is a small
// near-neutral palette chosen so that doesn't discolour the tyres and glass). bmw-m4 = "BMW M4" by CuRvEmAsTeR, CC BY 3.0,
// fan art / non-commercial only (assets/models/bmw-m4/SOURCE.md - remove before ZAVOD is ever monetised); converted the
// same way (tools/prep-car-model.mjs `blend` mode) into flat vertex-coloured body-<cls> buckets instead of a baked texture,
// wheels also static (its rim/tyre geometry covers all four positions in one mirrored mesh, no single template to split
// out). They load a few seconds after the first frame (the procedural carkit body stands in until then, and for good if a
// load fails): parked rows and traffic swap to them through onCarModel(). A car that goes live (driven, stolen, shot)
// stays the carkit build: its split panels, doors, roll-down panes and cabin are what vehicledamage.js, the Uber and the
// windows work on (these models have no separate glass or interior to drive with).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { carSpec } from './carkit.js';

const SRC = { coupe: { url: './assets/models/cars/ferrari.glb', ao: './assets/models/cars/ferrari_ao.png' } };
const M = {};   // kind -> { root: Group (normalised), parts: [{ geo, mat, m4, body }] }
let loading = null;
// kind -> file. sedan = the Sloyd model (see SOURCE.md); textured: true keeps its own baked texture instead of the shared
// flat-colour kit palette. *-lite.glb: the ~7k-triangle cut for phones.
const KIT = { sedan: { file: 'sloyd-sedan', textured: true }, 'bmw-m4': { file: 'bmw-m4' } };
const KIT_LITE = ['sedan', 'bmw-m4'];
/** this kind has a street model coming (load started, not necessarily in yet) */
export const kitModelPending = (kind, ctx) => !!KIT[kind] && (!ctx?.lite || KIT_LITE.includes(kind)) && !!loading;
const ready = [];   // onCarModel listeners
/** fn(kind) once each kit model is in (called at once for those already loaded) */
export function onCarModel(fn) { ready.push(fn); for (const k of Object.keys(M)) if (M[k].kit) fn(k); }
const loader = () => { const draco = new DRACOLoader(); draco.setDecoderPath('./vendor/three/examples/jsm/libs/draco/'); const gl = new GLTFLoader(); gl.setDRACOLoader(draco); gl.setMeshoptDecoder(MeshoptDecoder); return gl; };

let kitDone = false, kitResolve = null;
const kitSettled = new Promise((res) => { kitResolve = res; });
/** resolves once every KIT kind has loaded (or failed) after boot; qa/sweep.mjs awaits this before reading phone memory. */
export const kitModelsSettled = (timeoutMs = 15000) => Promise.race([kitSettled, new Promise((res) => setTimeout(res, timeoutMs))]);
/** sync check: has the street-car load finished (or never started)? */
export const kitModelsDone = () => kitDone;
// idle, not a fixed timer: requestIdleCallback waits for the main thread to actually be free after the first frame (Safari
// has no requestIdleCallback, so it falls back to a flat settle delay instead)
const onIdle = (fn) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 6000 }); else setTimeout(fn, 3000); };

export function loadCarModels(ctx) {
  if (loading) return loading;
  const gl = loader();
  const touch = !!ctx?.lite;
  // the street cars (KIT) start once the browser is idle after the first frame, not at map-build time: on phones a model's
  // fetch + decode would otherwise land inside the boot load peak qa/sweep.mjs samples. ctx.bus fires 'boot' right before
  // the render loop starts; a harness with no bus (eg. qa/cars-view.html) just goes idle on its own.
  const startKit = () => onIdle(() => loadKitModels(ctx, gl).then(() => { kitDone = true; kitResolve(); }).catch(() => { kitDone = true; kitResolve(); }));
  if (ctx?.bus?.on) ctx.bus.on('boot', startKit); else startKit();
  loading = Promise.all(Object.entries(SRC).map(async ([kind, s]) => {
    try {
      const g = await gl.loadAsync(s.url), scene = g.scene;
      const body = touch ? new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.35 }) : new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03 });
      const details = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.4 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x9aa7ae, metalness: 0.25, roughness: 0.05, transparent: true, opacity: 0.38, depthWrite: false });
      scene.traverse((o) => { if (!o.isMesh) return; const n = o.name;
        if (n === 'body') o.material = body; else if (/^rim_|^trim$/.test(n)) o.material = details; else if (n === 'glass') o.material = glass;
        else if (o.material?.isMeshPhysicalMaterial && o.material.transmission > 0) o.material = glass;
        o.castShadow = n === 'body'; o.receiveShadow = true; });
      // AO / contact shadow card under the car (the example's baked shadow)
      const ao = await new THREE.TextureLoader().loadAsync(s.ao).catch(() => null);
      if (ao) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4), new THREE.MeshBasicMaterial({ map: ao, blending: THREE.MultiplyBlending, premultipliedAlpha: true, toneMapped: false, transparent: true, depthWrite: false })); sh.name = 'aoShadow'; sh.rotation.x = -Math.PI / 2; sh.renderOrder = 2; scene.add(sh); }
      // normalise: front along +x (the front wheels are the ones named *_f*), length = the kind's length, wheels on y = 0
      scene.updateMatrixWorld(true);
      const fl = scene.getObjectByName('wheel_fl'), rr = scene.getObjectByName('wheel_rr'), a = new THREE.Vector3(), b = new THREE.Vector3();
      fl?.getWorldPosition(a); rr?.getWorldPosition(b);
      const root = new THREE.Group(), inner = new THREE.Group(); inner.add(scene); root.add(inner);
      const along = Math.abs(a.z - b.z) > Math.abs(a.x - b.x) ? 'z' : 'x', dir = Math.sign(along === 'z' ? a.z - b.z : a.x - b.x) || 1;
      inner.rotation.y = along === 'z' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      root.updateMatrixWorld(true);
      const bb = new THREE.Box3(); scene.traverse((o) => { if (o.isMesh && o.name !== 'aoShadow') bb.expandByObject(o); });
      const len = bb.max.x - bb.min.x, want = carSpec(kind)?.len || len, k = want / (len || 1);
      inner.scale.setScalar(k); root.updateMatrixWorld(true); bb.makeEmpty(); scene.traverse((o) => { if (o.isMesh && o.name !== 'aoShadow') bb.expandByObject(o); });
      inner.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); root.updateMatrixWorld(true);
      const parts = []; scene.traverse((o) => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m4: o.matrixWorld.clone(), body: o.material === body }); });
      M[kind] = { root, parts, body };
    } catch (e) { console.warn('[carmodels]', kind, e?.message || e); }
  }));
  return loading;
}

export const hasCarModel = (kind) => !!M[kind];
/** a kit-frame model (split parts, real wheels) rather than the one-piece Ferrari */
export const isKitModel = (kind) => !!M[kind]?.kit;

// ---- kit models ----------------------------------------------------------------------------------------------------------
let KMATS = null;
function kitMats(lite) {
  if (KMATS) return KMATS; const vc = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  KMATS = {
    paint: lite ? new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.38 }) : new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 }),
    dark: vc({ roughness: 0.7, metalness: 0.1 }), metal: vc({ roughness: 0.28, metalness: 0.9 }), lamp: vc({ roughness: 0.15, metalness: 0.2, emissive: 0x222222 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x15202a, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.62, depthWrite: false }),
  };
  for (const k in KMATS) KMATS[k].name = 'carmodel_' + k;
  return KMATS;
}
const FILES = new Map();
function loadKitModels(ctx, gl) {
  const lite = !!ctx?.lite, mats = kitMats(lite), done = [];
  for (const [kind, s] of Object.entries(KIT)) {
    if (lite && !KIT_LITE.includes(kind)) continue;
    const url = `${(typeof window !== 'undefined' && window.__zavodAssetBase) || './'}assets/models/${s.file}/${s.file}${lite ? '-lite' : ''}.glb`;   // qa pages under /qa/ set the base to '../'
    if (!FILES.has(url)) FILES.set(url, { p: gl.loadAsync(url), users: 0 });
    const F = FILES.get(url); F.users++;
    done.push(F.p.then((g) => { M[kind] = kitModel(kind, g, s, mats, lite); for (const fn of ready) { try { fn(kind); } catch (e) { console.warn('[carmodels] ready', kind, e?.message || e); } } })
      .catch((e) => console.warn('[carmodels]', kind, e?.message || e))
      .finally(() => { if (--F.users === 0) FILES.delete(url); }));   // every kind has its own copy now: let the parsed file go
  }
  return Promise.all(done);
}
function floatGeo(g0) {
  const g = new THREE.BufferGeometry(); g.setIndex(g0.index ? g0.index.clone() : null);
  for (const [n, a] of Object.entries(g0.attributes)) { const out = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c); g.setAttribute(n, new THREE.BufferAttribute(out, a.itemSize)); }
  return g;
}
/** one kind from a converted file: parts in the kit frame scaled to the kind's length (the prep keeps each pane apart; parked rows draw them as one) */
function kitModel(kind, g, s, mats, lite) {
  const X = g.scene.userData || {}, k = (carSpec(kind)?.len || X.len) / (X.len || 1);
  const parts = [], wheel = [];
  g.scene.traverse((o) => { if (!o.isMesh) return; const [grp, cls] = o.name.split('-');   // prep names: body-paint, pane-glassW, wheel-dark, ... (or, from
    if (grp === 'sign' && !s.sign) return;                                                 // the sloyd prep: body-tex / wheel-tex, its own baked texture)
    // the file is meshopt-quantized (integer attributes + a node transform): back to floats in the kit frame, then to the kind's length.
    // A copy per kind (one file can serve two kinds at two lengths)
    const geo = floatGeo(o.geometry); o.updateWorldMatrix(true, false); geo.applyMatrix4(o.matrixWorld); geo.scale(k, k, k);
    // a textured source (sloyd): keep its own baked material (per-instance tint multiplies the texture); the flat-colour kit
    // classes (paint / dark / metal / lamp / glass) look up the kind's shared palette instead
    const mat = cls === 'tex' ? o.material.clone() : mats[cls?.startsWith('glass') ? 'glass' : cls] || mats.dark;
    const p = { geo, mat, grp, body: cls === 'tex' ? grp === 'body' : cls === 'paint' };
    (grp === 'wheel' ? wheel : parts).push(p); });
  const wheels = (X.wheels || []).map(([x, y, z]) => ({ x: x * k, y: y * k, z: z * k, side: z > 0 ? 1 : -1 }));
  const pg = parts.filter((p) => p.grp === 'pane'), merged = pg.length ? mergeGeometries(pg.map((p) => p.geo), false) : null;
  let parked = parts.filter((p) => p.grp !== 'pane').concat(merged ? [{ geo: merged, mat: mats.glass, grp: 'pane', body: false }] : []), pw = wheel;
  if (lite && !s.textured) {   // phones: everything but paint and glass in one vertex-coloured draw, the wheel in one: 4 draws a row instead of 9
    const one = (list) => ({ geo: mergeGeometries(list.map((p) => p.geo), false), mat: mats.dark, grp: 'misc', body: false });
    parked = [...parked.filter((p) => p.body || p.grp === 'pane'), one(parked.filter((p) => !p.body && p.grp !== 'pane'))]; pw = [one(wheel)];
  }   // a sloyd model is already minimal (one body draw, plus one wheel draw if its wheels came out separable): no further merging to do on phones
  // the clone root (carModel: qa/cars-view.html): body plus the four wheels where they sit
  const root = new THREE.Group(); for (const p of parts) { const m = new THREE.Mesh(p.geo, p.mat); m.name = p.body ? 'body' : p.grp; root.add(m); }
  for (const w of wheels) { const h = new THREE.Group(); h.position.set(w.x, w.y, w.z); if (w.side < 0) h.rotation.y = Math.PI; for (const p of wheel) h.add(new THREE.Mesh(p.geo, p.mat)); root.add(h); }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = o.name === 'body'; o.receiveShadow = true; } });
  return { kit: true, root, parts: parked, wheel, pw, wheels, r: (X.r || 0.33) * k, body: mats.paint };
}
/** a kit model's wheel centres in the kit frame: [{ x, y, z, side }] (the template wheel's instances go here) */
export const kitWheels = (kind) => M[kind]?.wheels || [];
/** a car you can drive / a friend's car: a clone in the carkit frame with its own paint colour */
export function carModel(kind, color = 0xb01010) {
  const m = M[kind]; if (!m) return null;
  const g = m.root.clone(true), paint = m.body.clone(); paint.color = new THREE.Color(color);
  g.traverse((o) => { if (o.isMesh && o.material === m.body) o.material = paint; });
  return g;
}

/** parked rows: one InstancedMesh per model part; instanceColor tints the paint. transforms = Matrix4 per car (carkit frame → world).
 *  cap: instances to allocate (a LOD only ever shows the nearest few; default every car). Each mesh's userData.local (a part's
 *  own transform) / userData.W (a kit model's four wheel transforms, instance = car * 4 + wheel) let a LOD rebuild instances. */
export function instanceCarModel(kind, transforms, colors, scene, cap = transforms.length) {
  const m = M[kind]; if (!m || !transforms.length) return null; const out = [], t = new THREE.Matrix4(), n = Math.min(cap, transforms.length);
  if (m.kit) {   // the template wheel, four instances a car
    const W = m.wheels.map((w) => new THREE.Matrix4().compose(new THREE.Vector3(w.x, w.y, w.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.side < 0 ? Math.PI : 0), new THREE.Vector3(1, 1, 1)));
    for (const p of m.pw) { const im = new THREE.InstancedMesh(p.geo, p.mat, n * W.length); im.name = `cars:${kind}:model:wheel`; im.userData.per = W.length; im.userData.W = W;
      for (let i = 0; i < n; i++) W.forEach((w, j) => im.setMatrixAt(i * W.length + j, t.multiplyMatrices(transforms[i], w)));
      im.instanceMatrix.needsUpdate = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.surface = 'metal'; scene.add(im); out.push(im); }
  }
  for (const p of m.parts) {
    const im = new THREE.InstancedMesh(p.geo, p.mat, n); im.name = `cars:${kind}:model`; im.userData.local = p.m4 || null;
    for (let i = 0; i < n; i++) { im.setMatrixAt(i, p.m4 ? t.multiplyMatrices(transforms[i], p.m4) : transforms[i]); if (p.body) im.setColorAt(i, colors[i]); }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = p.body; im.receiveShadow = true; im.frustumCulled = false; im.userData.surface = 'metal'; scene.add(im); out.push(im);
  }
  return out;
}

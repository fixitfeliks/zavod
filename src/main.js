// Orchestrator. Owned by: main (integration). Creates renderer/camera/input, boots modules in order, runs the loop, exposes window.__game QA hooks.
import * as THREE from 'three';
import { createCtx, clamp } from './ctx.js';
import * as assets from './assets.js';
import * as world from './world.js';
import * as player from './player.js';
import * as weapons from './weapons.js';
import * as ai from './ai.js';
import * as post from './post.js';
import * as hud from './hud.js';
import * as audio from './audio.js';
import * as touch from './touch.js';
import * as vehicles from './vehicles.js';
import * as net from './net.js';
import * as netwaves from './netwaves.js';
import * as minimap from './minimap.js';
import * as vr from './vr/vr.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { IOS } from './texclamp.js';
import { kitModelsSettled } from './world/carmodels.js';

// BVH-accelerated raycasts for every mesh (bullets, AI line of sight, impact FX). Merged map batches are 100k+ triangle
// meshes whose bounding sphere covers the whole map, so an unaccelerated ray tested every triangle (14 fps with AI on the
// big campus). Trees are built lazily for any raycast target over ~500 triangles, including meshes added after boot.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const SAFE_TEXMAX = 256;   // safe mode's texture cap (after a load that never finished on a phone)
const ctx = createCtx();
// Phones: every image loader (textures, GLTF props, HDR stays) is redirected to the <=512px mirror in assets-m/ (see qa/build-mobile-assets.sh)
if (ctx.lite && ctx.qs.get('fullassets') !== '1') THREE.DefaultLoadingManager.setURLModifier((url) => /\/assets\/.*\.(jpe?g|png)(\?.*)?$/i.test(url) ? url.replace('/assets/', '/assets-m/').replace(/\.png(\?.*)?$/i, '.jpg$1') : url);
window.__ctx = ctx;

// ---------- renderer / scene / camera ----------
const app = document.getElementById('app');
// a headset gets MSAA: three sizes the XR framebuffer's samples from this flag, and without it every edge shimmers in VR (on Quest's
// tiled GPU 4x MSAA is nearly free). The flat game keeps its own post-process AA.
const renderer = new THREE.WebGLRenderer({ antialias: !!ctx.xrDevice, powerPreference: 'high-performance', stencil: false, depth: true, logarithmicDepthBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, ctx.settings.renderScale));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = ctx.settings.shadows !== false;
// Settings → Shadows: the whole shadow pass on/off (renderer + every shadow-casting light; materials recompile once)
function applyShadows(on) {
  if (renderer.shadowMap.enabled === on) return; renderer.shadowMap.enabled = on;
  scene.traverse((o) => { if (o.isLight && o.shadow) { if (o.userData.castShadow0 === undefined) o.userData.castShadow0 = o.castShadow; o.castShadow = on && o.userData.castShadow0; } if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
}
ctx.bus?.on?.('setting', (e) => { if (e?.key === 'shadows') applyShadows(!!e.value); });
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);
ctx.renderer = renderer; ctx.canvas = renderer.domElement;

const scene = new THREE.Scene();
ctx.scene = scene;
const camera = new THREE.PerspectiveCamera(ctx.settings.fov, innerWidth / innerHeight, 0.03, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);
ctx.camera = camera;

// ---------- input ----------
const input = {
  keys: new Set(), mouse: { dx: 0, dy: 0, buttons: 0, wheel: 0 }, locked: false,
  touch: { axis: { x: 0, y: 0 }, fire: false, ads: false, sprint: false }, // written by touch.js
  // edge-triggered action flags, consumed by player/weapons each frame via consume()
  pressed: new Set(),
  down(code) { return this.keys.has(code); },
  consume(code) { const h = this.pressed.has(code); this.pressed.delete(code); return h; },
  // named actions
  get fire() { return (this.mouse.buttons & 1) !== 0 || this.touch.fire; },
  get ads() { return (this.mouse.buttons & 4) !== 0 || this.down('KeyE') || this.touch.ads; }, // RMB (bit 1 << 2), hold E, or touch — was & 2 (the middle button), so right-click never aimed
  get forward() { return this.down('KeyW') || this.down('ArrowUp') || this.touch.axis.y < -0.3; },
  get back() { return this.down('KeyS') || this.down('ArrowDown') || this.touch.axis.y > 0.3; },
  get left() { return this.down('KeyA') || this.down('ArrowLeft') || this.touch.axis.x < -0.3; },
  get right() { return this.down('KeyD') || this.down('ArrowRight') || this.touch.axis.x > 0.3; },
  get sprint() { return this.down('ShiftLeft') || this.down('ShiftRight') || (this.touch.sprint && !this.touch.fire && !this.touch.ads); }, // on touch, firing/aiming cancels auto-sprint
  get crouch() { return this.down('KeyC') || this.down('ControlLeft'); },
  get jump() { return this.down('Space'); },
};
ctx.input = input;
addEventListener('keydown', e => { if (e.repeat) return; input.keys.add(e.code); input.pressed.add(e.code); if (['Space', 'Tab'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => input.keys.delete(e.code));
addEventListener('blur', () => { input.keys.clear(); input.mouse.buttons = 0; });
addEventListener('mousemove', e => { if (!input.locked && !ctx.qa) return; input.mouse.dx += e.movementX; input.mouse.dy += e.movementY; });
// macOS turns Ctrl+click into a right-click (button 2 + contextmenu). Ctrl is our crouch key, so while crouch-Ctrl is held a
// "right-click" from the primary button is really a trigger pull: map it back to fire (right-click ADS still works via the real button).
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const btnOf = (e) => (IS_MAC && e.ctrlKey && e.button === 2 && input.keys.has('ControlLeft') && !(e.buttons & 2) ? 0 : e.button);
addEventListener('mousedown', e => { if (input.locked) { const b = btnOf(e); input.mouse.buttons |= (1 << b); if (b === 0) input.pressed.add('Mouse0'); if (b === 2) input.pressed.add('Mouse2'); } });
addEventListener('mouseup', e => { const b = btnOf(e); input.mouse.buttons &= ~(1 << b); if (b !== e.button) input.mouse.buttons &= ~(1 << e.button); });
addEventListener('contextmenu', e => { if (input.locked || ctx.state === 'playing') e.preventDefault(); });   // never let a menu steal the pointer lock mid-fight
addEventListener('wheel', e => { input.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
addEventListener('contextmenu', e => e.preventDefault());
// the game freeing the cursor for its own overlay (the bag, the phone, darts, durak) is not the player pressing Esc: no pause menu
if (document.exitPointerLock) { const exitPL = document.exitPointerLock.bind(document); document.exitPointerLock = () => { ctx.cursorFreedAt = performance.now(); try { exitPL(); } catch {} }; }   // iOS Safari has no pointer lock at all
document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === renderer.domElement; ctx.bus.emit('pointerlock', input.locked); if (!input.locked && ctx.state === 'playing' && !ctx.xr?.presenting && !(performance.now() - (ctx.cursorFreedAt || -1e9) < 600)) setState('paused'); });
ctx.requestPointerLock = () => { const q = (o) => { try { const r = renderer.domElement.requestPointerLock(o); r?.catch?.(() => { if (o) q(); }); } catch { if (o) q(); } }; q({ unadjustedMovement: true }); };   // promise rejections (no user gesture, headless) are harmless

// ---------- state ----------
function setState(s) {
  const prev = ctx.state; if (prev === s) return;
  ctx.state = s; ctx.bus.emit('state', { state: s, prev });
  if (ctx.isTouch || ctx.xr?.presenting) { input.locked = s === 'playing'; ctx.bus.emit('pointerlock', input.locked); return; }
  if (s === 'playing' && !input.locked && !ctx.qa) ctx.requestPointerLock();
  if (s !== 'playing' && input.locked) document.exitPointerLock();
}
ctx.setState = setState;
// "Reset map for everyone" (Settings): chill maps clear through hangkit's worldReset; wave maps also restart the waves.
// Maps without the hangout kit hear the net 'fresh' here (hangkit bridges it itself where it runs; the stamp dedupes).
let lastReset = 0;
ctx.bus.on('worldReset', () => { lastReset = performance.now(); if (ctx.mode !== 'chill') setTimeout(() => ctx.restart(), 0); });
ctx.bus.on('net:fresh', () => setTimeout(() => { if (performance.now() - lastReset > 500) ctx.bus.emit('worldReset', { by: 'net' }); }, 50));
ctx.restart = () => {
  for (const [name, m] of MODULES) { if (m.reset) { try { m.reset(ctx); } catch (e) { console.error(`[reset:${name}]`, e); } } }
  ctx.time.elapsed = 0; ctx.bus.emit('restart');
  setState('playing');
};
addEventListener('keydown', e => {
  if (e.code === 'Escape') { if (ctx.state === 'playing') setState('paused'); }
});

// ---------- boot ----------
const bootbar = document.getElementById('bootbar'), boottxt = document.getElementById('boottxt');
// crash breadcrumb: each loading phase is saved as it starts and 'ok' when the game is up. A phone tab killed for memory (iOS: "Can't
// open this page") leaves its last phase behind: the next load shows it, and comes up in safe mode (smaller textures, gentler warm-up)
const CRUMB = 'zavod.boot', crumb = (() => { try { return localStorage.getItem(CRUMB); } catch { return null; } })();
ctx.lastCrash = crumb && crumb !== 'ok' ? crumb : null;
const SAFE = 'zavod.safe', wasSafe = (() => { try { return localStorage.getItem(SAFE) === '1'; } catch { return false; } })();   // sticky: a phone that crashed once stays safe
if ((ctx.lastCrash || wasSafe) && ctx.lite && !ctx.qs.get('texmax') && ctx.qs.get('safe') !== '0') { ctx.safeMode = true; try { localStorage.setItem(SAFE, '1'); } catch {} ctx.qs.set('texmax', String(SAFE_TEXMAX)); console.warn('[boot] last load stopped at', ctx.lastCrash, '- safe mode'); }
const saveCrumb = (v) => { try { localStorage.setItem(CRUMB, v); } catch {} };
ctx.progress = (frac, txt) => { bootbar.style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`; if (txt) { boottxt.textContent = txt + (ctx.lastCrash ? `  ·  last load stopped at: ${ctx.lastCrash}${ctx.safeMode ? ' (safe mode)' : ''}` : ''); saveCrumb(txt); } };

const MODULES = [['assets', assets], ['world', world], ['player', player], ['weapons', weapons], ['ai', ai], ['audio', audio], ['post', post], ['hud', hud], ['touch', touch], ['vehicles', vehicles], ['net', net], ['netwaves', netwaves], ['minimap', minimap], ['vr', vr]];
const UPDATE_ORDER = ['vr', 'touch', 'vehicles', 'player', 'weapons', 'ai', 'world', 'audio', 'hud', 'net', 'netwaves', 'minimap']; // vehicles before player: a mounted player is driven by the vehicle // post.render() runs last
const mods = Object.fromEntries(MODULES);

async function boot() {
  let i = 0;
  for (const [name, mod] of MODULES) {
    ctx.progress(i / MODULES.length, `initializing ${name}`);
    try { const api = await mod.init(ctx); if (api) ctx[name] = api; }
    catch (e) { console.error(`[boot] ${name} failed`, e); ctx.bootErrors = (ctx.bootErrors || []).concat(`${name}: ${e.message}`); }
    i++;
  }
  // memory budget for phones: cap shadow maps after the map built its lights
  if (ctx.settings.shadowMax < 4096) scene.traverse((o) => { if (o.isLight && o.shadow && o.shadow.mapSize.x > ctx.settings.shadowMax) { o.shadow.mapSize.set(ctx.settings.shadowMax, ctx.settings.shadowMax); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } });
  // spatial index for large static raycast targets (skinned/soldier hitboxes excluded)
  const bvhFor = () => { for (const o of ctx.raycastTargets) { const g = o.geometry; if (!o.isMesh || o.isSkinnedMesh || !g || g.boundsTree || o.userData.soldier) continue; const n = (g.index ? g.index.count : g.attributes.position?.count || 0) / 3; if (n > 500) { try { g.computeBoundsTree({ maxLeafTris: 8 }); } catch (e) { /* non-indexable geometry: plain raycast */ } } } };
  bvhFor(); ctx.bus.on?.('boot', () => setTimeout(bvhFor, 4000)); setTimeout(bvhFor, 12000);   // async GLTF props arrive later
  await prewarm();
  ctx.progress(1, 'ready'); saveCrumb('ok');
  document.getElementById('boot').classList.add('hide');
  const go = ctx.qs.get('go') === '1'; if (go) try { const u = new URL(location.href); u.searchParams.delete('go'); history.replaceState(null, '', u); } catch {}   // ?go=1: picked on the menu before the reload
  setState(ctx.qa || go ? 'playing' : 'menu');
  ctx.bus.emit('boot');
  const pose = ctx.qs.get('pose'); if (pose && ctx.world?.poses?.[pose]) window.__game.teleport(...ctx.world.poses[pose]);
  window.__game.ready = true;
  setTimeout(() => { try { localStorage.removeItem('zavod.booting'); } catch {} }, 20000);   // ctx.js crash guard: this load survived
  last = performance.now(); renderer.setAnimationLoop(frame);   // the renderer's loop: it switches to the headset's frame clock in VR
}

// Pre-warm behind the loading screen: compile every material in the scene (KHR_parallel_shader_compile lets the driver do it
// off the main thread), then draw one hidden frame with culling off and hidden objects shown, so shadow-depth programs, post
// passes, textures and vertex buffers are all resident before the first visible frame. Without it each of those compiled or
// uploaded the first time it came into view: a 1-8 s first frame and 0.1-0.3 s hitches when turning.
// BufferAttribute.onUpload: the JS copy goes the moment the GPU has it (bounds are computed first: culling needs them)
function freeOnUpload(g) { for (const k in g.attributes) g.attributes[k].onUpload(dropArray); g.index?.onUpload(dropArray); }
function dropArray() { this.array = null; }
// phones: two kinds of mesh lose their JS vertex copies once on the GPU. DRAWN_ONLY: big merged static meshes nobody raycasts (parked
// cars, Brighton, the backdrop, 8th Ave). HEAVY: the big static buildings (city, landmarks, boardwalk, the viaduct …) kept in JS
// only so bullets, sight lines and footsteps could raycast them (~120 MB + BVH); those raycasts go to one invisible mesh of the
// collision boxes instead (the same shapes, a few MB), built at the pre-warm. Ground meshes stay.
const DRAWN_ONLY = /^(cars|brighton|horizon|tavern|street|fronts|life|school):/, HEAVY = /^(city|cityFar|landmarks|luna|viaduct|shore|park|brighton|tavern|stillwell|surfKit|streetLights|viaductLine):/;
const heavyMesh = (o) => o.isMesh && !o.isSkinnedMesh && !o.userData.onHit && !o.userData.soldier && HEAVY.test(o.name || '') && !/ground/i.test(o.name) && o.geometry?.attributes?.position?.array;
let droppedHeavy = 0, gpuScene = null, gpuCam = null, gpuTarget = null;
/** phones, while the map builds: send the HEAVY meshes built so far to the GPU now and drop their JS copies (and their raycast
 *  slot), so they don't sit on the heap through the rest of the build (the load peak is where iOS kills the tab). One draw into a
 *  1x1 target with one unlit material uploads every vertex buffer. keep(o): meshes a later build step still reads (lamp
 *  positions, roof raycasts). DRAWN_ONLY waits for the pre-warm: some share kit geometry that later steps still copy. */
ctx.gpuStream = (keep = () => false) => {
  if (!ctx.lite || !ctx.colliders?.length) return 0;   // no colliders, no raycast proxy to stand in
  const rt = new Set(ctx.raycastTargets), list = [];
  scene.traverse((o) => { if (rt.has(o) && heavyMesh(o) && !keep(o)) list.push(o); });
  if (!list.length) return 0;
  const gone = new Set(list); droppedHeavy += list.length; ctx.raycastTargets.splice(0, Infinity, ...ctx.raycastTargets.filter((o) => !gone.has(o)));
  if (!gpuScene) { gpuScene = new THREE.Scene(); gpuScene.overrideMaterial = new THREE.MeshBasicMaterial(); gpuCam = new THREE.PerspectiveCamera(); gpuCam.layers.enableAll(); gpuTarget = new THREE.WebGLRenderTarget(1, 1); }
  const back = list.map((o) => [o, o.parent, o.frustumCulled, o.visible]);
  for (const o of list) { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox(); try { g.disposeBoundsTree?.(); } catch {} g.boundsTree = null; freeOnUpload(g); o.frustumCulled = false; o.visible = true; gpuScene.add(o); }
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(gpuTarget);
  try { renderer.render(gpuScene, gpuCam); } finally { renderer.setRenderTarget(prev); for (const [o, p, fc, v] of back) { (p || scene).add(o); o.frustumCulled = fc; o.visible = v; } }
  return list.length;
};
async function prewarm() {
  ctx.progress(0.98, 'warming up shaders');
  ctx.bus.emit('prewarm');   // last call to build anything that samples other modules' meshes (their arrays may be freed below)
  const t0 = performance.now();
  try { await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 20000))]); } catch (e) { console.warn('[boot] compileAsync', e); }
  // phones: what the build didn't stream (ctx.gpuStream) keeps its JS copy only until the warm frame below uploads it (freeOnUpload):
  // freeing only after the warm frame held both copies at the load peak
  if (ctx.lite) { const rt = new Set(ctx.raycastTargets || []), seen = new Set();
    scene.traverse((o) => { const g = o.geometry; if (!o.isMesh || !g || seen.has(g) || rt.has(o) || o.isSkinnedMesh || !DRAWN_ONLY.test(o.name || '')) return; seen.add(g);
      if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox(); freeOnUpload(g); }); }
  if (ctx.lite && ctx.colliders?.length) {
    const drop = ctx.raycastTargets.filter(heavyMesh);
    if (drop.length || droppedHeavy) {
      const boxes = ctx.colliders.filter((b) => b?.isBox3 && !b.isEmpty() && b.max.x - b.min.x <= 400 && b.max.z - b.min.z <= 400);
      // straight into typed arrays: number arrays of every corner were tens of MB of garbage at the warm-up
      const pos = new Float32Array(boxes.length * 24), idx = new Uint32Array(boxes.length * 36); let v = 0, p = 0, q = 0;
      for (const { min: m, max: M } of boxes) {
        for (const [x, y, z] of [[m.x, m.y, m.z], [M.x, m.y, m.z], [M.x, M.y, m.z], [m.x, M.y, m.z], [m.x, m.y, M.z], [M.x, m.y, M.z], [M.x, M.y, M.z], [m.x, M.y, M.z]]) { pos[p++] = x; pos[p++] = y; pos[p++] = z; }
        for (const f of BOX_TRIS) idx[q++] = v + f; v += 8; }
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setIndex(new THREE.BufferAttribute(idx, 1)); pg.computeVertexNormals(); pg.computeBoundingSphere(); pg.computeBoundingBox();
      const proxy = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); proxy.visible = false; proxy.name = 'raycastProxy'; proxy.userData.surface = 'concrete'; scene.add(proxy); try { pg.computeBoundsTree?.(); } catch {}
      const gone = new Set(drop); ctx.raycastTargets.splice(0, ctx.raycastTargets.length, ...ctx.raycastTargets.filter((o) => !gone.has(o)), proxy);
      for (const o of drop) { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox(); try { g.disposeBoundsTree?.(); } catch {} g.boundsTree = null; freeOnUpload(g); }
      console.log(`[boot] phones: ${drop.length + droppedHeavy} building meshes → a ${boxes.length}-box raycast proxy`);
    } }
  const t1 = performance.now(), culled = [], shown = [], lit = new Set();
  scene.traverse((o) => { if (o.isLight) for (let p = o; p; p = p.parent) lit.add(p); });   // never reveal a hidden light: a new light count recompiles every program
  scene.traverse((o) => { if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) culled.push(o); if (!o.visible && !lit.has(o)) shown.push(o); });
  // iPhones: the warm-up in WARM_PASSES_IOS slices with a pause between (everything uploading in one frame is the spike that gets the
  // tab killed just as loading finishes; between slices the GC and the driver can release their staging copies)
  const passes = ctx.safeMode ? WARM_PASSES_SAFE : IOS() ? WARM_PASSES_IOS : 1;
  for (let k = 0; k < passes; k++) {
    const part = (a) => a.filter((_, i) => i % passes === k), c = part(culled), sh = part(shown);
    if (passes > 1) ctx.progress(0.98, `warming up ${k + 1}/${passes}`);
    for (const o of c) o.frustumCulled = false; for (const o of sh) o.visible = true;
    try { if (ctx.post?.render) ctx.post.render(0, ctx); else renderer.render(scene, camera); renderer.setRenderTarget(null); }
    catch (e) { console.warn('[boot] warm frame', e); }
    finally { for (const o of c) o.frustumCulled = true; for (const o of sh) o.visible = false; }
    if (passes > 1) await new Promise((r) => setTimeout(r, WARM_PAUSE_MS));
  }
  ctx.perf.warm = { compileMs: Math.round(t1 - t0), frameMs: Math.round(performance.now() - t1), programs: renderer.info.programs?.length || 0 };
}

const WARM_PASSES_IOS = 6, WARM_PASSES_SAFE = 12, WARM_PAUSE_MS = 60;
const BOX_TRIS = [0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0];   // the raycast proxy's 12 triangles per box

// ---------- loop ----------
let last = performance.now(); let fpsAcc = 0, fpsN = 0;
// ?prof=1: per-frame CPU profile (each module, each world updater, render) + renderer resource counts, read by qa/perf.mjs.
// A frame whose program count grew compiled a shader; texture/geometry growth means an upload in that frame.
const PROF = ctx.qs.get('prof') === '1' ? { frames: [], cur: null, mark(k, ms) { const c = this.cur; if (c) c.parts[k] = (c.parts[k] || 0) + ms; }, reset() { this.frames.length = 0; } } : null;
if (PROF) { ctx.prof = PROF; window.__prof = PROF; }
// GPU time per frame (EXT_disjoint_timer_query_webgl2): queries resolve a few frames later and are written back onto their frame
const GL = renderer.getContext(), TQ = PROF && GL.getExtension('EXT_disjoint_timer_query_webgl2'), gpuQ = [];
function pollGpu() { while (gpuQ.length && GL.getQueryParameter(gpuQ[0][0], GL.QUERY_RESULT_AVAILABLE)) { const [q, c] = gpuQ.shift(); if (!GL.getParameter(TQ.GPU_DISJOINT_EXT)) c.gpu = GL.getQueryParameter(q, GL.QUERY_RESULT) / 1e6; GL.deleteQuery(q); } }
// phones: people, bikes and jet skis far off are a few pixels but 3-16 draw calls each; the spawn view could take in 400 m of
// beach crowds and the jet ski rental, so the draw count swung 700-1700 between loads. Hidden for the render only, so their
// modules (and QA probes) see them as they left them. The list is rebuilt every LITE_CULL_EVERY frames (spawns, despawns).
const LITE_CULL = { person: 140, bike: 140, jetski: 160 }, LITE_CULL_EVERY = 90, liteCull = [], liteHid = [];
function liteCullHide() {
  if (ctx.time.frame % LITE_CULL_EVERY === 1) { liteCull.length = 0; scene.traverse((o) => { const r = LITE_CULL[o.name]; if (r) liteCull.push([o, r * r]); }); }
  const cx = camera.position.x, cz = camera.position.z;
  for (const [o, r2] of liteCull) { if (!o.visible || !o.parent) continue; const e = o.matrixWorld.elements; if ((e[12] - cx) ** 2 + (e[14] - cz) ** 2 > r2) { o.visible = false; liteHid.push(o); } }
}
function liteCullShow() { for (const o of liteHid) o.visible = true; liteHid.length = 0; }
function frame(now) {
  const f0 = PROF ? performance.now() : 0; if (PROF) PROF.cur = { t: now, dt: now - last, parts: {} };
  let dt = (now - last) / 1000; last = now;
  if (dt < 0) dt = 0; if (dt > 0.1) dt = 0.1;
  dt *= ctx.time.scale;
  const paused = ctx.state === 'paused' || ctx.state === 'menu';
  const simDt = paused ? 0 : dt;
  ctx.time.dt = simDt; ctx.time.elapsed += simDt; ctx.time.frame++;
  ctx.time.realDt = dt;
  for (const name of UPDATE_ORDER) { const m = mods[name]; if (m && m.update) { const t0 = PROF ? performance.now() : 0; try { m.update(simDt, ctx); } catch (e) { if (ctx.time.frame % 300 === 1) console.error(`[update:${name}]`, e); } if (PROF) PROF.mark(name, performance.now() - t0); } }
  input.mouse.dx = 0; input.mouse.dy = 0; input.mouse.wheel = 0; input.pressed.clear();
  // depth precision: near 0.03 can't resolve ground detail 100 m+ away, so from high up (coney 19th floor / roof) streets
  // and roofs z-fought ("pulsating"). 4x the near plane up there; ≤ 0.15 leaves the hip/ADS viewmodels unclipped.
  if (!ctx.xr?.presenting) { const nr = camera.position.y > 12 ? 0.12 : 0.03; if (camera.near !== nr) { camera.near = nr; camera.updateProjectionMatrix(); } }
  const r0 = PROF ? performance.now() : 0; let gq = null; if (TQ && !ctx.post?._S?.profiling) { pollGpu(); gq = GL.createQuery(); GL.beginQuery(TQ.TIME_ELAPSED_EXT, gq); }
  if (ctx.lite) liteCullHide();
  if (ctx.xr?.presenting) vr.render(ctx);   // the headset: straight to the eyes (the post chain is screen-space, one view)
  else if (ctx.post && ctx.post.render) ctx.post.render(dt, ctx); else renderer.render(scene, camera);
  if (ctx.lite) liteCullShow();
  if (gq) { GL.endQuery(TQ.TIME_ELAPSED_EXT); gpuQ.push([gq, PROF.cur]); }
  if (PROF) { const c = PROF.cur, I = renderer.info; c.parts.render = performance.now() - r0; c.cpu = performance.now() - f0; c.progs = I.programs?.length || 0; c.tex = I.memory.textures; c.geo = I.memory.geometries; c.calls = I.render.calls; c.tris = I.render.triangles; PROF.frames.push(c); if (PROF.frames.length > 20000) PROF.frames.splice(0, 5000); PROF.cur = null; }
  // perf
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { ctx.perf.fps = fpsN / fpsAcc; ctx.perf.frameMs = 1000 * fpsAcc / fpsN; fpsAcc = 0; fpsN = 0; ctx.perf.drawCalls = renderer.info.render.calls; ctx.perf.triangles = renderer.info.render.triangles; }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  for (const [, m] of MODULES) if (m.onResize) m.onResize(ctx);
});

// ---------- QA hooks (window.__game) ----------
window.__game = {
  ready: false, ctx,
  stats: () => ({ fps: +ctx.perf.fps.toFixed(1), frameMs: +ctx.perf.frameMs.toFixed(2), drawCalls: ctx.perf.drawCalls, triangles: ctx.perf.triangles, state: ctx.state, errors: ctx.bootErrors || [], enemies: ctx.ai?.soldiers?.length ?? null, quality: ctx.settings.quality }),
  setState,
  teleport: (x, y, z, yaw = 0, pitch = 0) => ctx.player?.teleport?.(x, y, z, yaw, pitch),
  pose: (name) => ctx.world?.poses?.[name] ? (window.__game.teleport(...ctx.world.poses[name]), name) : Object.keys(ctx.world?.poses || {}),
  fire: (n = 1) => ctx.weapons?.qaFire?.(n),
  freezeAI: (v = true) => { if (ctx.ai) ctx.ai.frozen = v; },
  killAll: () => ctx.ai?.qaKillAll?.(),
  timeScale: (s) => { ctx.time.scale = s; },
  quality: (q) => { ctx.settings.quality = q; ctx.bus.emit('quality', q); },
  carsSettled: (timeoutMs) => kitModelsSettled(timeoutMs),   // qa/sweep.mjs: don't read phone memory while a street-car model is still loading
};
boot();

// Maps: a minimap (top-left, rotates with you) and a full-screen map (M; tap the minimap on phones). The background is the map
// itself, rendered once from straight above (orthographic, fog / sky / far horizon layers hidden) the first time you play,
// tone-mapped on the CPU and stored as an image; maps may add crisp street centrelines (W.mapRoads [{p, w}]), street labels
// (W.mapLabels [{t, x, z, r}]) and points of interest (W.mapPOIs [{name, x, z, kind}]). Live markers: you (arrow), friends
// (blue + name), mercenaries / cops (red), chill-mode gopniks (orange), vendors (yellow), bikes (green).
import * as THREE from 'three';
import { kit } from './world/hangkit.js';
import { onTap } from './tap.js';

let M = null;
const KIND = { park: ['#7fd08a', '▲'], shop: ['#ffd27a', '$'], ride: ['#ff8ad1', '✦'], transit: ['#8ac7ff', 'Ⓜ'], landmark: ['#e8e2d0', '●'], danger: ['#ff6a5a', '!'], road: ['#9fe39a', '➜'] };

export function init(ctx) {
  const css = document.createElement('style'); css.textContent = `
  .zvmini{position:fixed;left:calc(env(safe-area-inset-left,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 58px);z-index:39;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.25),0 4px 18px rgba(0,0,0,.45);background:rgba(10,12,16,.6);cursor:pointer}
  .zvbig{position:fixed;inset:0;z-index:57;display:none;align-items:center;justify-content:center;background:rgba(4,6,9,.78);backdrop-filter:blur(2px)}
  .zvbig.on{display:flex}.zvbig canvas{box-shadow:0 10px 40px rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.18);max-width:96vw;max-height:92vh}
  .zvbig .k{position:absolute;right:18px;bottom:14px;font:600 12px Barlow,Arial;color:#cfd6dd;letter-spacing:.12em}
  .zvbig .h{position:absolute;left:50%;top:12px;transform:translateX(-50%);font:700 18px 'Barlow Condensed',Arial;letter-spacing:.3em;color:#fff}`;
  document.head.appendChild(css);
  const size = ctx.isTouch ? 118 : 172;
  const mini = document.createElement('canvas'); mini.className = 'zvmini'; mini.width = mini.height = size * 2; mini.style.width = mini.style.height = size + 'px'; mini.style.display = 'none'; document.body.appendChild(mini);
  const big = document.createElement('div'); big.className = 'zvbig'; big.innerHTML = '<div class="h"></div><canvas></canvas><div class="k">M · close</div>'; document.body.appendChild(big);
  M = { ctx, mini, mctx: mini.getContext('2d'), size, big, bcan: big.querySelector('canvas'), img: null, shotAt: 0, frame: 0, open: false };
  const toggle = () => { M.open = !M.open; big.classList.toggle('on', M.open); if (M.open) { pickImg(); big.querySelector('.h').textContent = (ctx.world?.maps?.find((m) => m.id === ctx.world?.mapId)?.name || 'MAP').toUpperCase() + (M.level != null ? `  ·  LEVEL ${M.level === 0 ? 'STREET' : M.level}` : ''); drawBig(); } };
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat && (ctx.state === 'playing' || M.open) && !document.querySelector('.hkdlg.on') && !document.querySelector('.zvon.on')) { toggle(); } if (e.code === 'Escape' && M.open) toggle(); });
  mini.addEventListener('click', (e) => { e.stopPropagation(); toggle(); }); onTap(mini, () => toggle());   // phones: a real tap, not a thumb landing on it
  big.addEventListener('click', () => { if (M.open) toggle(); }); onTap(big, () => { if (M.open) toggle(); });
  ctx.bus.on('state', ({ state }) => {
    mini.style.display = state === 'playing' && M.img ? 'block' : 'none';
    if (state === 'playing' && !M.img && !M.pending) { M.pending = true; setTimeout(async () => { try { await snapshot(); } catch (e) { console.warn('[map] snapshot', e); } M.pending = false; mini.style.display = ctx.state === 'playing' ? 'block' : 'none'; }, 1500); }
  });
  return { toggle, get open() { return M.open; }, snapshot: () => snapshot(), qa: () => ({ img: !!M.img, w: M.img?.width, h: M.img?.height }),
    plan: () => ({ url: M.img.toDataURL('image/webp', PLAN_QUALITY), b: M.map.b }) };   // tools/maplab-release.mjs bakes this into W.mapImage
}

// ---------------------------------------------------------------------------------------------------------------------------
// the background: the world from above
async function snapshot() {
  const { ctx } = M; const W = ctx.world, b = W?.bounds; if (!b) return;
  // a map with a pre-rendered plan (W.mapImage: { src, b: frame bounds }) ships it instead of streaming the whole map to shoot it
  if (W.mapImage) { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = W.mapImage.src; await img.decode();
    M.map = planFrame(W.mapImage.b, img.naturalWidth, img.naturalHeight); M.levels = null; M.imgs = { all: img }; M.img = img; return; }
  // multi-level interiors (W.mapLevels, else the wave floor levels): one cutaway floor plan per level; everything else one view
  const levels = Array.isArray(W.mapLevels) ? W.mapLevels : (Array.isArray(W.waveTuning?.levels) && W.waveTuning.levels.length > 1 ? W.waveTuning.levels : null);
  const sorted = levels ? levels.slice().sort((a, c) => c - a) : null, imgs = {};
  if (sorted) for (const y of sorted) imgs[y] = await shoot(y + 3.2); else imgs.all = await shoot(null);
  M.levels = sorted; M.imgs = imgs; M.img = sorted ? imgs[sorted[0]] : imgs.all;
  console.log('[map] snapshot', M.map.RW, 'x', M.map.RH, M.levels ? 'levels ' + M.levels.join(',') : '');
}
const PLAN_QUALITY = 0.9;   // webp quality of a baked plan
// half float bits -> linear value, built once (the per-pixel decode + tone curve used to take ~1 s of main thread)
let F16 = null;
const f16table = () => { if (F16) return F16; F16 = new Float32Array(65536); for (let h = 0; h < 65536; h++) { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; F16[h] = e === 0 ? s * Math.pow(2, -14) * (m / 1024) : e === 31 ? 0 : s * Math.pow(2, e - 15) * (1 + m / 1024); } return F16; };
// Nothing here may change a shader's program key: no fog swap (density 0 instead), no hidden lights (the camera carries the
// viewmodel fill lights, so its meshes are hidden instead of the camera) and no clipping planes (the camera's near plane cuts
// the floors above instead). Any of those recompiled every material in the map on the spot (0.8-6 s freeze on first play).
async function shoot(clipY) {
  const { ctx } = M; const W = ctx.world, b0 = W.bounds;
  // frame = play bounds + everything that has a label, padded 60 m so nothing sits on the edge
  const b = { min: { x: b0.min.x, z: b0.min.z }, max: { x: b0.max.x, z: b0.max.z } };
  for (const q of W.mapPOIs || []) { b.min.x = Math.min(b.min.x, q.x - 30); b.max.x = Math.max(b.max.x, q.x + 30); b.min.z = Math.min(b.min.z, q.z - 30); b.max.z = Math.max(b.max.z, q.z + 30); }
  b.min.x -= 60; b.min.z -= 60; b.max.x += 60; b.max.z += 60;
  const w = b.max.x - b.min.x, d = b.max.z - b.min.z, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const res = ctx.isTouch ? 1024 : 2048, RW = w >= d ? res : Math.round(res * w / d), RH = w >= d ? Math.round(res * d / w) : res, frame = planFrame(b, RW, RH);
  // from straight above; on a multi-level map the camera sits at the cut height so the near plane removes the floors above
  const top = clipY != null ? clipY : 1500, cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, clipY != null ? 0.001 : 1, top + 2500);
  cam.position.set(cx, top, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, top - 1, cz); cam.updateMatrixWorld(true);
  const scene = W.mapSnapshotScene || ctx.scene, R = ctx.renderer, hidden = [], lit = new Set();
  scene.traverse((o) => { if (o.isLight) for (let p = o; p; p = p.parent) lit.add(p); });
  const hide = (o) => { if (!lit.has(o)) { hidden.push(o); o.visible = false; return; } o.traverse((x) => { if (x.visible && (x.isMesh || x.isPoints || x.isSprite || x.isLine)) { hidden.push(x); x.visible = false; } }); };
  scene.traverse((o) => { if (o === scene || !o.visible) return; const n = o.name || '';
    if (o === ctx.camera || o.isSprite || o.isPoints || (o.isMesh && o.material?.blending === THREE.AdditiveBlending) || /far|sky|dome|horizon|cloud|star|moon|sun|firework|rain|shaft|godray|beam|glow/i.test(n) || (o.isMesh && o.renderOrder < 0) || (o.isMesh && o.material && (o.material.depthTest === false))) hide(o); });
  const fog = scene.fog, density = fog?.density, bg = scene.background; if (fog?.isFogExp2) fog.density = 0; scene.background = new THREE.Color(0x0e1a24);
  const rt = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.HalfFloatType });
  const prevT = R.getRenderTarget(), prevAuto = R.shadowMap.autoUpdate; R.shadowMap.autoUpdate = false;   // the shadow maps from the last frame are fine for a plan view
  try { R.setRenderTarget(rt); R.clear(); R.render(scene, cam); }
  finally { R.setRenderTarget(prevT); R.shadowMap.autoUpdate = prevAuto; for (const o of hidden) o.visible = true; if (fog?.isFogExp2) fog.density = density; scene.background = bg; }
  const buf = new Uint16Array(RW * RH * 4);
  try { await R.readRenderTargetPixelsAsync(rt, 0, 0, RW, RH, buf); } catch { R.readRenderTargetPixels(rt, 0, 0, RW, RH, buf); }   // async: no GPU pipeline stall
  rt.dispose();
  const c = document.createElement('canvas'); c.width = RW; c.height = RH; const g = c.getContext('2d'); const img = g.createImageData(RW, RH);
  const F = f16table();
  // exposure: night / dark interiors get lifted so the plan reads (target mean ≈ 0.3 after the curve)
  let sum = 0, cnt = 0; for (let i = 0; i < buf.length; i += 4 * 97) { sum += 0.3 * F[buf[i]] + 0.59 * F[buf[i + 1]] + 0.11 * F[buf[i + 2]]; cnt++; }
  const mean = Math.max(1e-3, sum / cnt), exp = Math.min(8, Math.max(1.25, 0.45 / mean));
  const lut = new Uint8ClampedArray(65536); for (let h = 0; h < 65536; h++) { let v = Math.max(0, F[h]) * exp; v = v / (1 + v); lut[h] = Math.pow(v, 1 / 2.2) * 255; }
  const out = img.data;
  for (let y = 0; y < RH; y++) { let si = (RH - 1 - y) * RW * 4, di = y * RW * 4;   // read is bottom-up
    for (let x = 0; x < RW; x++, si += 4, di += 4) { out[di] = lut[buf[si]]; out[di + 1] = lut[buf[si + 1]]; out[di + 2] = lut[buf[si + 2]]; out[di + 3] = 255; } }
  g.putImageData(img, 0, 0);
  // map style: a touch darker + desaturated so the markers and labels pop
  g.globalCompositeOperation = 'saturation'; g.fillStyle = 'rgba(128,128,128,0.35)'; g.fillRect(0, 0, RW, RH); g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(8,12,18,0.22)'; g.fillRect(0, 0, RW, RH);
  // crisp streets on top
  const { px, pz } = frame, sc = RW / w;
  if (Array.isArray(W.mapRoads)) { g.lineCap = g.lineJoin = 'round';
    for (const pass of [0, 1]) for (const r of W.mapRoads) { if (!r.p?.length) continue; g.beginPath(); r.p.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z)))); g.lineWidth = Math.max(1.2, (r.w || 8) * sc) + (pass ? 0 : 2.5 * sc); g.strokeStyle = pass ? 'rgba(214,218,222,0.78)' : 'rgba(20,24,30,0.55)'; g.stroke(); } }
  M.map = frame;
  return c;
}
/** world → plan pixel mapping for a plan of RW x RH pixels covering bounds b (x, z) */
function planFrame(b, RW, RH) { const w = b.max.x - b.min.x, d = b.max.z - b.min.z; return { b, w, d, RW, RH, px: (x) => (x - b.min.x) / w * RW, pz: (z) => (z - b.min.z) / d * RH }; }
/** the floor plan for where the player is (multi-level maps) */
function levelOf(y) { if (!M.levels) return null; let best = M.levels[M.levels.length - 1]; for (const L of M.levels) if (y >= L - 1.5) { best = L; break; } return best; }
function pickImg() { const y = M.ctx.player?.position?.y ?? 0; const L = levelOf(y); M.level = L; M.img = L == null ? M.imgs.all : M.imgs[L]; }

// ---------------------------------------------------------------------------------------------------------------------------
export function update(dt, ctx) {
  if (!M?.img) return; M.frame++; if (M.frame % 15 === 0) pickImg();
  if (M.open) { if (M.frame % 3 === 0) drawBig(); return; }
  if (ctx.state === 'playing' && M.frame % 3 === 0) drawMini();
}
function markers() {
  const { ctx } = M; const out = { enemies: [], thugs: [], friends: [], bikes: [], vendors: [] };
  const off = (y) => M.level != null && Math.abs((y ?? 0) - M.level) > 3;   // on another floor: drawn faded
  for (const s of ctx.ai?.soldiers || []) if (s && !s.dead && s.position) out.enemies.push([s.position.x, s.position.z, !!s.brain, off(s.position.y)]);
  const th = ctx.world?.mapThugs?.(); if (th) out.thugs = th;
  const net = ctx.net; if (net?.list) for (const id of net.list()) { const q = net.peer(id); if (q?.pos) out.friends.push([q.pos.x, q.pos.z, q.name || '', q.dead, off(q.pos.y)]); }
  for (const v of ctx.vehicles?.list || []) if (v !== ctx.vehicles.mounted && v.pos) out.bikes.push([v.pos.x, v.pos.z, !!v.spec?.car]);
  const K = kit(); if (K) for (const v of K.vendors) if (!v.noMap) out.vendors.push([v.pos.x, v.pos.z, v.name]);
  return out;
}
function drawMarkers(g, P, scale, rot = 0, big = false) {
  const { ctx } = M; const mk = markers();
  const dot = (x, z, r, fill, stroke = 'rgba(0,0,0,.6)') => { const [u, v] = P(x, z); g.beginPath(); g.arc(u, v, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 1.5; g.strokeStyle = stroke; g.stroke(); return [u, v]; };
  const label = (u, v, t, col, fs) => { g.save(); g.font = `700 ${fs}px Barlow Condensed, Arial`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(t, u, v); g.fillStyle = col; g.fillText(t, u, v); g.restore(); };
  const k = big ? 1 : 2;   // minimap canvas is 2x
  // the police search circle (coney/chase.js W.mapSearch): where they're combing for you; flashes red when they re-sight you
  const sr = ctx.world?.mapSearch?.(); if (sr) { const [u, v] = P(sr[0], sr[1]), [u2, v2] = P(sr[0] + sr[2], sr[1]), rr = Math.hypot(u2 - u, v2 - v), pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260); g.save(); g.beginPath(); g.arc(u, v, rr, 0, Math.PI * 2);
    g.fillStyle = sr[3] ? 'rgba(255,40,40,.35)' : `rgba(70,120,255,${0.12 + 0.1 * pulse})`; g.fill(); g.lineWidth = 2 * k; g.strokeStyle = sr[3] ? 'rgba(255,60,60,.9)' : 'rgba(110,160,255,.7)'; g.stroke(); g.restore(); }
  // subway: station icons on the minimap too (the big map bakes them with the POIs) + the F train itself, an orange bar
  if (!big) for (const q of ctx.world?.mapPOIs || []) { if (q.kind !== 'transit') continue; const [u, v] = P(q.x, q.z); g.beginPath(); g.arc(u, v, 8 * k, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.7)'; g.fill(); g.lineWidth = 2 * k; g.strokeStyle = '#8ac7ff'; g.stroke(); g.font = `700 ${11 * k}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#8ac7ff'; g.fillText('Ⓜ', u, v + 0.5); }
  // subway lines in their colours (Q wide yellow under the F where they share the el, the D dashed darker orange), station
  // dots, and every train as a bar in its line's colour
  const sw = ctx.subway; if (sw?.routes) { g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of sw.routes()) { g.setLineDash(r.dash ? [5 * k, 4 * k] : []); g.lineWidth = r.w * k; g.strokeStyle = r.color; g.globalAlpha = 0.8; g.beginPath(); r.pts.forEach(([x, z], i) => { const [u, v] = P(x, z); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.stroke(); }
    g.setLineDash([]); g.globalAlpha = 1;
    for (const s of sw.stations()) { const [u, v] = P(s.x, s.z); g.beginPath(); g.arc(u, v, 3.2 * k, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.2 * k; g.strokeStyle = '#111'; g.stroke(); if (big) label(u, v - 8, `${s.name} ${s.r.split('').join(' ')}`, '#e8e8e8', 11); }
    for (const t of sw.trains()) { const [u0, v0] = P(t.seg[0], t.seg[1]), [u1, v1] = P(t.seg[2], t.seg[3]); g.lineWidth = 5 * k; g.strokeStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.moveTo(u0, v0); g.lineTo(u1, v1); g.stroke(); g.lineWidth = 3 * k; g.strokeStyle = t.color; g.stroke(); }
    g.restore(); }
  const tr = !sw?.trains && ctx.subway?.train?.(); if (tr) { const [u0, v0] = P(tr[0], tr[1]), [u1, v1] = P(tr[2], tr[3]); g.save(); g.lineCap = 'round'; g.lineWidth = 5 * k; g.strokeStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.moveTo(u0, v0); g.lineTo(u1, v1); g.stroke(); g.lineWidth = 3 * k; g.strokeStyle = '#ff6319'; g.stroke(); g.restore(); }
  for (const [x, z, car] of mk.bikes) { const [u, v] = P(x, z); g.fillStyle = car ? '#6fd08a' : '#9fe39a'; g.fillRect(u - 3 * k, v - 3 * k, 6 * k, 6 * k); }
  for (const [x, z, n] of mk.vendors) { const [u, v] = dot(x, z, 4.5 * k, '#ffd27a'); if (big) label(u, v - 9, n, '#ffd27a', 12); }
  for (const [x, z, cop, far] of mk.enemies) { g.globalAlpha = far ? 0.35 : 1; dot(x, z, 4 * k, cop ? '#b36bff' : '#ff4a3a', '#2a0000'); } g.globalAlpha = 1;
  for (const [x, z] of mk.thugs) dot(x, z, 4 * k, '#ff9a3a', '#2a1000');
  // friends: a blue dot with their name; off the minimap's dial they're pinned to its rim in their direction (like a job), so you can always find each other
  for (const [x, z, n, dead, far] of mk.friends) { g.globalAlpha = far ? 0.5 : 1; let [u, v] = P(x, z), pinned = false;
    if (!big) { const R = g.canvas.width / 2, dx = u - R, dy = v - R, d = Math.hypot(dx, dy), lim = R - 8 * k; if (d > lim) { u = R + dx / d * lim; v = R + dy / d * lim; pinned = true; } }
    g.beginPath(); g.arc(u, v, (pinned ? 5 : 6) * k, 0, Math.PI * 2); g.fillStyle = dead ? '#667' : '#4aa3ff'; g.fill(); g.lineWidth = 2 * k; g.strokeStyle = '#fff'; g.stroke();
    if (big) label(u, v - 10, n, '#cfe3ff', 13); else if (!pinned) label(u, v - 14, n, '#cfe3ff', 20); } g.globalAlpha = 1;
  // the current job's destination: a gold diamond (pinned to the rim of the minimap when it's off the dial)
  const jb = ctx.world?.mapJob?.(); if (jb) { let [u, v] = P(jb[0], jb[1]);
    if (!big) { const R = g.canvas.width / 2, dx = u - R, dy = v - R, d = Math.hypot(dx, dy), lim = R - 14 * k / 2 - 6; if (d > lim) { u = R + dx / d * lim; v = R + dy / d * lim; } }
    const s = (7 + Math.sin(performance.now() / 180) * 1.5) * k; g.save(); g.translate(u, v); g.rotate(Math.PI / 4); g.fillStyle = '#ffd23b'; g.strokeStyle = '#2a1a00'; g.lineWidth = 2; g.fillRect(-s / 2, -s / 2, s, s); g.strokeRect(-s / 2, -s / 2, s, s); g.restore();
    if (big && jb[2]) label(u, v - 12, jb[2], '#ffd23b', 13); }
  // you: an arrow along your view
  const p = ctx.player; if (p) { const [u, v] = P(p.position.x, p.position.z); g.save(); g.translate(u, v); g.rotate(rot - p.yaw); g.beginPath(); const s = 9 * k; g.moveTo(0, -s); g.lineTo(s * 0.7, s * 0.8); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.7, s * 0.8); g.closePath(); g.fillStyle = '#ffd23b'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); g.restore(); }
}
function drawMini() {
  const { ctx, mctx: g, mini } = M; const S = mini.width, R = S / 2, p = ctx.player; if (!p) return;
  const m = M.map, view = 240;   // metres across
  const k = S / view, rot = p.yaw;   // heading up
  g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#0e1a24'; g.fillRect(0, 0, S, S);
  g.translate(R, R); g.rotate(rot); g.scale(k, k);
  const imgScale = m.w / m.RW; g.drawImage(M.img, 0, 0, m.RW, m.RH, m.b.min.x - p.position.x, m.b.min.z - p.position.z, m.RW * imgScale, m.RH * imgScale);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const P = (x, z) => { const dx = x - p.position.x, dz = z - p.position.z, c = Math.cos(rot), s = Math.sin(rot); return [R + (dx * c - dz * s) * k, R + (dx * s + dz * c) * k]; };
  drawMarkers(g, P, k, rot, false);
  g.restore();
  const off = p.position.x < m.b.min.x || p.position.x > m.b.max.x || p.position.z < m.b.min.z || p.position.z > m.b.max.z;
  if (off) { const zn = (ctx.world?.zones || []).find((z) => p.position.z >= z.z0 && p.position.z <= z.z1 && (z.x0 == null || (p.position.x >= z.x0 && p.position.x <= z.x1)));   // off the plan (the Belt / JFK run, the yard)
    g.save(); g.fillStyle = 'rgba(14,26,36,.9)'; g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd27a'; g.font = '700 20px Barlow Condensed, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(zn?.name || 'OFF THE MAP', R, R - 10);
    g.fillStyle = '#c9d2da'; g.font = '600 14px Barlow, Arial'; g.fillText(zn?.hint || 'back to Coney: the ramp', R, R + 14); g.restore(); }
  // north tick
  const na = rot; g.save(); g.translate(R, R); g.rotate(na); g.fillStyle = '#fff'; g.font = '700 22px Barlow Condensed, Arial'; g.textAlign = 'center'; g.fillText('N', 0, -R + 24); g.restore();
  g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
}
function bakeBig(CW, CH, dpr, P) {
  const W = M.ctx.world, c = document.createElement('canvas'); c.width = CW * dpr; c.height = CH * dpr; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.drawImage(M.img, 0, 0, CW, CH);
  const taken = [];   // label rects: a label that would overlap one already drawn is skipped (POIs first — they matter more)
  const fits = (u, v, w, h) => { const r = [u - w / 2, v - h / 2, u + w / 2, v + h / 2]; if (taken.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1])) return false; taken.push(r); return true; };
  const label = (u, v, t, col, fs, rot = 0, weight = 700, force = false) => {
    g.save(); g.font = `${weight} ${fs}px Barlow Condensed, Arial`; const tw = g.measureText(t).width;
    if (!rot) u = Math.min(CW - tw / 2 - 6, Math.max(tw / 2 + 6, u));   // keep it inside the frame
    if (!force && !rot && !fits(u, v, tw + 6, fs + 4)) { g.restore(); return; }
    g.translate(u, v); g.rotate(rot); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(t, 0, 0); g.fillStyle = col; g.fillText(t, 0, 0); g.restore(); };
  const pois = (W?.mapPOIs || []).map((q) => ({ q, uv: P(q.x, q.z) }));
  for (const { q, uv: [u, v] } of pois) { const [col, icon] = KIND[q.kind] || KIND.landmark;
    g.beginPath(); g.arc(u, v, 8, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.65)'; g.fill(); g.lineWidth = 2; g.strokeStyle = col; g.stroke();
    g.font = '700 11px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(icon, u, v + 0.5); fits(u, v, 16, 14); }
  for (const { q, uv: [u, v] } of pois) { const col = (KIND[q.kind] || KIND.landmark)[0]; label(u, v + 17, q.name, col, 13); }
  for (const L of W?.mapLabels || []) { const [u, v] = P(L.x, L.z); label(u, v, L.t, L.col || '#e9eef2', L.fs || 14, L.r || 0, 600); }
  return c;
}
function drawBig() {
  if (!M.img) return; const { ctx, bcan: c } = M; const m = M.map, W = ctx.world;
  const maxW = innerWidth * 0.96, maxH = innerHeight * 0.88, sc = Math.min(maxW / m.RW, maxH / m.RH), CW = Math.round(m.RW * sc), CH = Math.round(m.RH * sc), dpr = Math.min(2, devicePixelRatio || 1);
  if (c.width !== CW * dpr) { c.width = CW * dpr; c.height = CH * dpr; c.style.width = CW + 'px'; c.style.height = CH + 'px'; }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const P = (x, z) => [(x - m.b.min.x) / m.w * CW, (z - m.b.min.z) / m.d * CH];
  // the plan + street names + POIs don't move: bake them once per size / floor, then just blit (was a full redraw every 3rd frame)
  if (!M.bg || M.bg.src !== M.img || M.bg.w !== CW * dpr) { M.bg = { src: M.img, w: CW * dpr, can: bakeBig(CW, CH, dpr, P) }; }
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(M.bg.can, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMarkers(g, P, 1, 0, true);
  // legend
  const items = [['#ffd23b', 'YOU'], ['#4aa3ff', 'FRIENDS'], ['#ff4a3a', 'MERCS'], ['#b36bff', 'COPS'], ['#ff9a3a', 'GOPNIKS'], ['#ffd27a', 'VENDORS'], ['#9fe39a', 'BIKES / CARS'], ['#ffd23b', 'JOB ◆']];
  g.save(); g.fillStyle = 'rgba(6,8,12,.72)'; g.fillRect(10, 10, 118, items.length * 18 + 12); items.forEach(([col, t], i) => { g.fillStyle = col; g.beginPath(); g.arc(24, 24 + i * 18, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e8edf2'; g.font = '600 12px Barlow, Arial'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, 36, 24 + i * 18); }); g.restore();
}

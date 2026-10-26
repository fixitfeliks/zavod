// Jet packs by Arkasha's table: F to strap one on, hold Space (touch: JUMP) to fly, WASD steers at full air control, fuel
// burns while you thrust and refills on the ground. X (touch: the TAKE OFF button by the fuel bar) takes it off (it goes back on
// the rack). Death / world reset drop it.
// Physics: sets ctx.player.jet { on, thrust } — player.js adds thrust and full air control. Owned by: CONEY.
import * as THREE from 'three';
import { hangkit as K } from '../hangkit.js';
import { remoteWrap } from '../outfits.js';

const XR_THRUST_MAX = 0.92, XR_SPOOL = 3;   // VR: a softer top end and slower spool (in a headset every lurch is felt)
const THRUST = 34, BURN = 14, REFILL = 9, RACK = [[-4.8, 3.6], [-4.8, 4.6], [-4.8, 5.6]];
let J = null;

export function buildJetpacks(world) {
  const { ctx, W } = world; const T = W.arkadyTable; if (!T) return;
  J = { ctx, packs: [], worn: null, fuel: 100, bar: null, spool: 0, flames: flameFx(world), remote: new Map(), sendT: 0, sentOn: null };
  const yaw = Math.atan2(T.seat.x - T.pos.x, T.seat.z - T.pos.z), up = new THREE.Vector3(0, 1, 0);
  for (const [lx, lz] of RACK) {
    const pos = new THREE.Vector3(lx, 0, lz).applyAxisAngle(up, yaw).add(T.pos);
    const g = model(); g.position.copy(pos).add(new THREE.Vector3(0, 0.02, 0)); g.rotation.y = yaw; world.scene.add(g);
    const pk = { g, pos, home: pos.clone() }; J.packs.push(pk);
    K.spot({ pos, r: 1.8, when: () => !J.worn && pk.g.visible, prompt: 'F — STRAP ON THE JET PACK', act: () => wear(pk) });
  }
  const bar = document.createElement('div'); bar.style.cssText = 'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);width:160px;height:8px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.3);z-index:41;display:none;pointer-events:none';
  bar.innerHTML = `<i style="display:block;height:100%;width:100%;background:#ffb24a"></i><small style="position:absolute;left:0;right:0;top:-18px;text-align:center;font:700 11px Barlow Condensed,Arial;letter-spacing:.14em;color:#fff;text-shadow:0 1px 2px #000">${ctx.isTouch ? 'JET PACK · HOLD JUMP' : 'JET PACK · SPACE · X OFF'}</small>`; document.body.appendChild(bar); J.bar = bar;
  if (ctx.isTouch) {   // phones: up top, clear of the thumb cluster, with a button to take it off (there's no X key)
    bar.style.bottom = 'auto'; bar.style.top = 'calc(env(safe-area-inset-top, 0px) + 112px)';
    const b = document.createElement('div'); b.textContent = 'TAKE OFF'; b.style.cssText = 'position:absolute;left:50%;top:14px;transform:translateX(-50%);padding:7px 14px;border-radius:16px;background:rgba(10,14,20,.6);border:1.5px solid #e9a23b;color:#fff;font:700 12px Barlow Condensed,Arial;letter-spacing:.12em;white-space:nowrap;pointer-events:auto;touch-action:none';
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (J.worn && ctx.state === 'playing') takeOff(); }, { passive: false }); b.addEventListener('click', () => { if (J.worn) takeOff(); }); bar.appendChild(b); J.offBtn = b; }
  addEventListener('keydown', (e) => { if (e.code === 'KeyX' && J.worn && ctx.state === 'playing') takeOff(); });
  ctx.bus.on('playerDied', () => { if (J.worn) takeOff(); });
  ctx.bus.on('worldReset', () => { if (J.worn) takeOff(); for (const p of J.packs) { p.g.visible = true; p.g.position.copy(p.home).add(new THREE.Vector3(0, 0.02, 0)); } });
  K.onUpdate((dt, playing) => update(dt, playing));
  ctx.bus.on('net:jet', (m) => { if (!m || !/^[a-z0-9]{8}$/.test(m.f || '')) return; let R = J.remote.get(m.f); const w = remoteWrap(m.f);
    if (m.on && w && !R) { const g = model(); g.scale.setScalar(0.72); g.position.set(0, 0.55, -0.24); w.add(g); const fl = flameCone(); fl.position.set(0, 0.28, -0.24); w.add(fl); R = { g, fl, w }; J.remote.set(m.f, R); }
    if (!m.on && R) { R.w.remove(R.g); R.w.remove(R.fl); J.remote.delete(m.f); return; }
    if (R) { R.th = +m.th || 0; R.fl.visible = R.th > 0.1; } });
  if (window.__game) window.__game.jetpack = { state: () => ({ worn: !!J.worn, fuel: Math.round(J.fuel), y: +ctx.player.position.y.toFixed(2) }), wear: () => wear(J.packs[0]), off: takeOff, packs: () => J.packs.map((p) => p.pos.toArray()) };
}

function model() {
  const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.3 }), dark = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6 }), red = new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.4, metalness: 0.4 });
  for (const s of [-0.13, 0.13]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 16), steel); t.position.set(s, 0.62, 0); g.add(t); const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red); cap.position.set(s, 0.93, 0); g.add(cap); const n = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 12, 1, true), dark); n.position.set(s, 0.24, 0); n.rotation.x = Math.PI; g.add(n); }
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.14), dark); pack.position.set(0, 0.62, 0.12); g.add(pack);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}
// flames under your feet (you see them looking down, friends see them on your back), additive cones that flicker
function flameCone() { const g = new THREE.Group(); const m = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }); const core = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const sx of [-0.13, 0.13]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 10, 1, true), m); c.rotation.x = Math.PI; c.position.set(sx, -0.27, 0); g.add(c); const k = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.3, 8, 1, true), core); k.rotation.x = Math.PI; k.position.set(sx, -0.15, 0); g.add(k); } g.visible = false; return g; }
function flameFx(world) { const g = flameCone(); world.scene.add(g); return g; }
let AC = null, NOISE = null, NG = null, NF = null;
function roar(level) {   // filtered-noise engine roar, level 0..1 (on the game's AudioContext when it has one)
  try { if (!AC) { if (!level) return; AC = J.ctx.audio?.context || new (window.AudioContext || window.webkitAudioContext)(); const b = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; NOISE = AC.createBufferSource(); NOISE.buffer = b; NOISE.loop = true; NF = AC.createBiquadFilter(); NF.type = 'lowpass'; NG = AC.createGain(); NG.gain.value = 0; NOISE.connect(NF); NF.connect(NG); NG.connect(AC.destination); NOISE.start(); }
    if (AC.state === 'suspended') AC.resume(); const S = J.ctx.settings || {}; NG.gain.value = J.ctx.audio?.muted ? 0 : 0.22 * level * (S.masterVolume ?? 1) * (S.sfxVolume ?? 1); NF.frequency.value = 400 + 1800 * level; } catch {}
}
function wear(pk) { if (J.worn) return; J.worn = pk; pk.g.visible = false; J.fuel = 100; J.bar.style.display = 'block'; J.ctx.hud?.toast?.(J.ctx.isTouch ? 'Jet pack on. Hold JUMP to fly · TAKE OFF up top' : 'Jet pack on. Hold SPACE to fly · X to take it off', 2400); }
function takeOff() { const pk = J.worn; if (!pk) return; J.worn = null; J.ctx.player.jet = null; J.spool = 0; J.flames.visible = false; roar(0); J.ctx.net?.send?.('jet', { on: 0 }); J.sentOn = 0; J.bar.style.display = 'none'; pk.g.visible = true; pk.g.position.copy(pk.home).add(new THREE.Vector3(0, 0.02, 0)); }
function update(dt, playing) {
  if (!J.worn) return; const p = J.ctx.player, inp = J.ctx.input;
  const hold = playing && !p.mounted && (inp?.keys?.has?.('Space') || false);
  // a throttle (VR: how high you lift the pinched hand, or A ramping) instead of on / off; gentler turbines in a headset
  const xr = !!J.ctx.xr?.presenting, want = playing && !p.mounted && J.fuel > 0 ? (inp?.jetThrottle != null ? inp.jetThrottle * (xr ? XR_THRUST_MAX : 1) : hold ? 1 : 0) : 0;
  const rate = xr ? XR_SPOOL : want > J.spool ? 5 : 3.5;
  J.spool += (want - J.spool) * Math.min(1, dt * rate);   // turbines spool up / down, no instant thrust
  const thrust = THRUST * J.spool * (J.fuel > 0 ? 1 : 0);
  J.fuel = Math.max(0, Math.min(100, J.fuel + (J.spool > 0.2 ? -BURN * J.spool : p.onGround ? REFILL : 0) * dt));
  p.jet = { on: true, thrust };
  if (J.spool > 0.3 && Math.random() < dt * 14) try { K.puff?.(p.position.clone().setY(p.position.y + 0.1)); } catch {}
  J.flames.visible = J.spool > 0.08; J.flames.position.set(p.position.x, p.position.y + 0.25, p.position.z); J.flames.rotation.y = p.yaw; const fk = 0.6 + 0.4 * J.spool + Math.random() * 0.15; J.flames.scale.set(1, fk, 1);
  roar(J.spool); if (J.spool > 0.4 && playing) { p.pitch += (Math.random() - 0.5) * 0.0025 * J.spool; p.yaw += (Math.random() - 0.5) * 0.0018 * J.spool; }   // rattle
  J.sendT -= dt; const on = 1; if (J.sentOn !== on || J.sendT < 0) { J.sendT = J.spool > 0.05 ? 0.2 : 2; J.sentOn = on; J.ctx.net?.send?.('jet', { on, th: +J.spool.toFixed(2) }); }
  const i = J.bar.firstChild; i.style.width = `${J.fuel | 0}%`; i.style.background = J.fuel < 20 ? '#ff5a3a' : '#ffb24a';
}

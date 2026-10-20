// Online free-for-all over free public MQTT brokers (WebSockets) — no server of our own. Owned by: main.
//
// Join: main menu "Play online" (netui.js: room + name + share link) or any URL with ?room=<name>[&name=<callsign>].
// Topics (per map + room):  zv3/<map>/<room>/s/<id>  player state, 15 Hz (2 Hz heartbeat while the tab is hidden)
//                           zv3/<map>/<room>/ev      events (hello/sync?/sync/shot/hit/boom/kill/steal/bye + game-mode `net:<t>`)
//
// CONNECTION. Every client keeps a link to EVERY broker at once (HiveMQ, EMQX, Mosquitto) and publishes on all live links;
// receivers dedupe by per-sender sequence numbers (state: newest-wins by `q`; events: seen-set of (sender, instance, q)).
// So one broker dying never splits the room (with sequential failover, A on HiveMQ and B on EMQX would never meet). Each
// link reconnects on its own with jittered exponential backoff (1 s → 20 s), resubscribes, re-announces `hello` and asks
// the room for `sync?`. A link watchdog recycles half-dead sockets: we subscribe to s/+ so our own state echoes back —
// no echo for 6 s = dead link. The echo also gives the ping shown on the badge. `online` / tab-return force reconnects.
// Critical events (kill, steal) are sent twice with the same seq (lossy QoS 0) and queued while every link is down.
//
// JOIN MID-GAME. A new/returning client sends `sync?`; every peer answers (random 50-400 ms spread) with its scoreboard
// view and the parked-car indices it knows were stolen. Scores merge with max() per field (K/D only grow within a
// session, so max is order-independent and duplicate-proof); each client also reports its own K/D in every state packet,
// so boards converge even if a kill event is lost. Stolen cars are replayed through the bus as `net:steal` — exactly what
// hangout.js already handles (idempotent: hideParkedCar + collider removal). The id survives a reload (sessionStorage,
// released on pagehide, so a duplicated tab gets a fresh one) and scores of peers who left are kept as ghosts, so a
// friend who refreshes comes back with the same score.
//
// ROBUSTNESS. Messages > 4 KB, non-JSON, non-objects, bad ids, non-finite numbers are dropped; positions/damage/radii are
// clamped; per-peer token buckets (state 40/s, events 45/s); `kill` only accepted from the victim itself; hangout event
// payloads (elev/steal/smoke) are shape-checked before they reach the bus. Duplicate names get a stable ·XY suffix (the
// lexicographically smallest id keeps the plain name, so every client shows the same labels). A `bye` (also the broker
// will, which fires when only ONE of our links drops) removes a peer only if no state follows within 1.5 s.
// Hidden tabs: rAF stops, so a Web Worker tick (not throttled like page timers) keeps a 2 Hz AFK heartbeat; hidden / menu /
// paused players are flagged AFK (tag shows it, they can't be hit — no farming a friend who is answering a text). On
// return: reconnect dead links, hello + sync?, and peer timeouts get a grace period (mobile Safari freezes sockets).
// Hidden tabs also skip cosmetic FX (tracers/smoke would otherwise pile up without update() to age them).
//
// SMOOTHNESS / CLOCKS. Snapshots are timed by the SENDER's performance.now (`ts`) mapped onto our clock with a running
// minimum of (arrival − ts) that relaxes 0.5 ms/s — only differences of one peer's own clock are used, so wall-clock skew
// between devices is irrelevant and network jitter is removed from the timeline. Render delay per peer adapts to measured
// jitter and send interval: max(1.5·interval, interval + 2.5·jitter + 15 ms) clamped 90-400 ms (≈100 ms on good links).
// Past the newest snapshot we extrapolate ≤ 150 ms then hold. Jumps > 15 m between snapshots (elevators, respawn,
// passenger seat) snap instead of sliding across the map. Yaw / vehicle heading interpolate on the shortest arc.
//
// HIT REGISTRATION / LAG COMPENSATION. Shooter-authoritative detection, victim-authoritative damage: weapons.js raycasts
// in its update against the remote hitboxes (bone-attached, userData.remote) — UPDATE_ORDER runs weapons BEFORE net, so
// the hitbox matrixWorld is still the one computed for the previous rendered frame, i.e. each remote player exactly
// where the shooter SAW them (interpolated ~100 ms in the past). That is the "rewind to the shooter's render time" of
// classic lag compensation, done on the shooter's machine with no position-history replay needed. The shooter sends
// `hit` {to, dmg, hs}; the victim clamps and applies it (health is never disputed) and announces `kill`. Trade-off
// (as in any favour-the-shooter model): a victim can die ~RTT/2 + render delay after reaching cover.
// Public brokers are shared and unauthenticated: rooms are not private and a modified client could lie. Fine for casual play.
import * as THREE from 'three';
import { createInstance } from './ai/model.js';
import { carGeometries, carMaterials, carInterior, carEye, CAR_KINDS } from './world/carkit.js';
import { hasCarModel, carModel } from './world/carmodels.js';
import { buildBike } from './vehicles/bike.js';
import { buildJetski } from './vehicles/jetski.js';
import { buildBus } from './vehicles/bus.js';
import * as UI from './netui.js';

const ALL_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
const MQTT_LIBS = ['https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.esm.js', 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.esm.js'];
const PROTO = 'zv3';
const SHOT_MIN_MS = 66;   // friends see your shots (tracer + flash + sound): at most one event per ~4 frames, a 900 rpm SMG still reads as auto fire
const SEND_HZ = 15, HEARTBEAT_MS = 480, TIMEOUT = 10000, BYE_GRACE = 1500, RESPAWN = 4, PROTECT = 3;
const MAX_MSG = 4096, TELEPORT = 15, EXTRAP_MS = 150, DELAY_MIN = 90, DELAY_MAX = 400, WATCHDOG = 6000;
const F_DEAD = 1, F_CROUCH = 2, F_ADS = 4, F_AFK = 8;
const ID_RE = /^[a-z0-9]{8}$/;
let S = null;

const rid = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : NaN);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const vec = (a, lim = 40000) => { if (!Array.isArray(a) || a.length < 3) return null; const r = [num(a[0], lim), num(a[1], lim), num(a[2], lim)]; return r.some(Number.isNaN) ? null : r; };
export const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>&"'\\`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
export const cleanRoom = (s) => String(s ?? '').toLowerCase().replace(/[^\w-]/g, '').slice(0, 24);

export async function init(ctx) {
  const qs = ctx.qs; const online = (qs.has('room') || qs.get('mp') === '1') && qs.get('mp') !== '0';
  const map = ctx.world?.mapId || 'zavod';
  UI.install(ctx, { online, map, state: () => S });          // "Play online" menu overlay + phone action button work offline too
  if (!online) return null;
  const room = cleanRoom(qs.get('room')) || 'public';
  let name = cleanName(qs.get('name')); try { if (!name) name = cleanName(localStorage.getItem('zavod.name')); else localStorage.setItem('zavod.name', name); localStorage.setItem('zavod.room', room); } catch {}
  const id = identity(map, room);
  name = name || 'OP-' + id.slice(0, 4).toUpperCase();
  const base = `${PROTO}/${map}/${room}${ctx.mode ? '.' + ctx.mode : ''}/`;   // chill-mode players get their own room (no mercs from a waves host)
  const pick = (qs.get('brokers') || '').split(',').map((v) => parseInt(v, 10)).filter((v) => v >= 0 && v < ALL_BROKERS.length);
  S = { ctx, mqtt: null, id, inst: rid(), room, name, map, base, fault: faultOf(qs.get('netfault')), brokers: pick.length ? pick.map((i) => ALL_BROKERS[i]) : ALL_BROKERS,
    links: [], peers: new Map(), score: new Map(), stolen: new Set(), buckets: new Map(), dedupe: new Map(), disp: new Map(), outbox: [],
    seq: 0, sseq: 0, lastSend: 0, lastSync: 0, everUp: false, hiddenAt: 0, lastAttacker: null, protectT: PROTECT, respawnT: -1, tab: false, board: false };
  S.score.set(id, { name, k: 0, d: 0, gone: false });
  recomputeNames();
  UI.online(ctx);
  S.mqtt = await loadMqtt();
  if (!S.mqtt) { UI.setStatus('ONLINE UNAVAILABLE · mqtt lib blocked', 'bad'); return api(); }
  S.brokers.forEach((_, i) => openLink(i));
  // online = free-for-all: no AI waves, and every spawn point on the map is fair game
  if (qs.get('ai') !== '1') { try { ctx.ai?.qaSetEnabled?.(false); ctx.ai?.qaKillAll?.(); } catch {} }
  const W = ctx.world; if (W?.enemySpawns?.length) W.playerSpawns = [...(W.playerSpawns || []), ...W.enemySpawns];
  S.spawnPool = onlineSpawns(ctx); if (S.spawnPool.length >= 3) W.playerSpawns = S.spawnPool;
  // every map defines where an online session starts (the meet-up: coney = Igor's gate, terminal = the info booth, …) — jittered
  // so friends don't stack, and snapped onto a free nav floor on the start's own level (never inside the booth / a bench)
  if (W?.onlineStart) {
    const [x, y, z, yaw] = W.onlineStart; const nav = ctx.ai?.nav; let at = [x, y, z];
    // everyone gets their own spot round the meet-up (an angle from their id, golden-angle steps if blocked), never on top of a friend
    const a0 = [...String(S.id || id || 'x')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360 * Math.PI / 180;
    for (let k = 0; k < 12; k++) {
      const a = a0 + k * 2.39996, r = 1.8 + (k % 3) * 0.9, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!nav) { at = [px, y, pz]; break; }
      if (nav.isFree(px, pz, y) && Math.abs(nav.floorAt(px, pz, y) - y) < 0.5) { at = [px, nav.floorAt(px, pz, y), pz]; break; }
    }
    try { ctx.player.teleport(at[0], at[1], at[2], yaw, 0); } catch {}
  }
  ctx.bus.on('shot', (e) => { if (!e || e.who !== 'player') return; const o = e.muzzle || e.origin; if (!o || !e.dir) return; const now = performance.now(); if (now - (S.shotAt || 0) < SHOT_MIN_MS) return; S.shotAt = now; send({ t: 'shot', o: v3(o), d: v3(e.dir), w: String(e.id || '').slice(0, 12) }); });
  ctx.bus.on('playerDied', () => { const a = S.lastAttacker && performance.now() - S.lastAttacker.at < 8000 ? S.lastAttacker : null; send({ t: 'kill', k: a?.id || null, v: S.id, hs: !!a?.hs }, true); onKill(a?.id || null, S.id, !!a?.hs); S.respawnT = RESPAWN; });
  ctx.bus.on('explosion', (e) => { if (e && !e.remote && e.position) send({ t: 'boom', p: v3(e.position), r: Math.min(12, e.radius || 6) }); });
  ctx.bus.on('playerRespawn', () => { S.protectT = PROTECT; S.lastAttacker = null; });
  // keyboard scoreboard (phones: tap the status badge — netui)
  addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); S.tab = true; UI.renderBoard(); } });
  addEventListener('keyup', (e) => { if (e.code === 'Tab') S.tab = false; });
  addEventListener('blur', () => { S.tab = false; });
  // background tabs: a worker tick (not throttled like page timers) keeps the heartbeat + link watchdog alive
  startWorkerTick();
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('online', () => kickLinks());
  addEventListener('pagehide', leave); addEventListener('beforeunload', leave);
  setInterval(() => UI.refresh(), 1000);
  return api();
}

function api() {
  return {
    get peers() { return S.peers.size; }, get connected() { return anyUp(); }, get room() { return S.room; }, get name() { return S.name; }, get id() { return S.id; },
    hit: (peer, dmg, hs) => { const p = S.peers.get(peer); if (!p || p.dead || p.afk) return; send({ t: 'hit', to: peer, dmg: Math.max(0, Math.min(250, dmg | 0)), hs: !!hs }); },
    scores: () => [...S.score.entries()].filter(([, v]) => !v.gone).map(([k, v]) => ({ id: k, name: S.disp.get(k) || v.name, k: v.k, d: v.d })),
    send: (t, data = {}) => { const m = { ...data, t }; if (t === 'steal' && int(m.i, 0, 100000) !== null) S.stolen.add(m.i); send(m, ['steal', 'elev', 'red', 'igor', 'goto', 'cash', 'loot', 'thughit', 'rdoor', 'fresh', 'wv', 'wvhit', 'wvshot', 'gunoffer', 'gunpaid', 'shroompaid', 'dk', 'folk', 'juke', 'dt', 'uber'].includes(t) && t !== 'wv'); },   // loop events are re-sent once (receivers dedupe by seq)
    qaPeers: () => [...S.peers.values()].map((p) => ({ veh: p.veh?.k || null, riderVisible: !!p.inst.group.visible, y: +p.inst.group.position.y.toFixed(2) })),
    peer: (id) => { const p = S.peers.get(id); return p ? { id, name: S.disp.get(id) || p.name, pos: p.vehObj ? p.vehObj.position : p.inst.group.position, heading: p.heading || 0, veh: p.veh || null, dead: p.dead, afk: p.afk, seen: p.seen } : null; },
    list: () => [...S.peers.keys()],
    stolen: () => [...S.stolen].sort((a, b) => a - b),
    links: () => S.links.map((L) => ({ url: L.url, up: L.up, rtt: Math.round(L.rtt || 0), tries: L.tries })),
    info: () => [...S.peers.values()].map((p) => ({ id: p.id, name: S.disp.get(p.id) || p.name, afk: p.afk, dead: p.dead, delay: Math.round(p.delay), jitter: +p.jit.toFixed(1), iv: Math.round(p.iv), snaps: p.snaps.length })),
    status: () => statusInfo(),
  };
}

// ---------- identity: same id across a reload of this tab (score comes back via sync), fresh id for a duplicated tab ----------
function identity(map, room) {
  const key = 'zavod.net';
  let id = null;
  try { const s = JSON.parse(sessionStorage.getItem(key) || 'null'); if (s && s.map === map && s.room === room && !s.live && ID_RE.test(s.id)) id = s.id; } catch {}
  id = id || rid();
  const mark = (live) => { try { sessionStorage.setItem(key, JSON.stringify({ id, map, room, live })); } catch {} };
  mark(true); addEventListener('pagehide', () => mark(false)); addEventListener('pageshow', () => mark(true));
  return id;
}
async function loadMqtt() {
  for (const url of MQTT_LIBS) { try { const m = await import(/* @vite-ignore */ url); if (m?.default?.connect) return m.default; } catch (e) { console.warn('[net] mqtt lib failed', url, e?.message); } }
  return null;
}

// ---------- links (one per broker, all live at once) ----------
function openLink(i) {
  const L = S.links[i] || (S.links[i] = { i, url: S.brokers[i], client: null, up: false, tries: 0, timer: 0, upAt: 0, lastRx: 0, rtt: 0 });
  clearTimeout(L.timer); L.timer = 0;
  if (L.client) { const old = L.client; L.client = null; try { old.end(true); } catch {} }
  let c;
  try {
    c = S.mqtt.connect(L.url, { clientId: `zv_${S.id}_${i}_${rid().slice(0, 4)}`, clean: true, connectTimeout: 8000, reconnectPeriod: 0, keepalive: 15, resubscribe: false,
      will: { topic: S.base + 'ev', payload: JSON.stringify({ f: S.id, z: S.inst, t: 'bye', w: 1 }), qos: 0, retain: false } });
  } catch (e) { console.warn('[net] connect threw', L.url, e?.message); return retry(L); }
  L.client = c;
  c.on('connect', () => {
    if (L.client !== c) return;
    c.subscribe([S.base + 's/+', S.base + 'ev'], (err) => {
      if (L.client !== c) return;
      if (err) { console.warn('[net] subscribe failed', L.url, err?.message); return down(); }
      const first = !anyUp(); L.up = true; L.tries = 0; L.upAt = L.lastRx = performance.now();
      console.log('[net] link up', L.url, S.room, S.name);
      onLinkUp(first);
    });
  });
  const down = () => {
    if (L.client !== c) return; const was = L.up; L.up = false; L.client = null; try { c.end(true); } catch {}
    if (was) console.log('[net] link down', L.url);
    retry(L); UI.refresh();
  };
  c.on('error', down); c.on('close', down); c.on('offline', down);
  c.on('message', (topic, buf) => onRaw(L, topic, buf));
}
function retry(L) {
  clearTimeout(L.timer);
  const d = Math.min(20000, 1000 * 2 ** Math.min(L.tries++, 5)) * (0.75 + Math.random() * 0.5);
  L.timer = setTimeout(() => openLink(L.i), d);
}
function kickLinks() { for (const L of S.links) if (L && !L.up) { L.tries = 0; openLink(L.i); } }
const anyUp = () => !!S?.links.some((L) => L?.up);
function onLinkUp(first) {
  S.everUp = true;
  sendState(performance.now(), true);
  send({ t: 'hello', n: S.name });
  requestSync(first);
  if (S.outbox.length) { const now = performance.now(); const q = S.outbox.splice(0); for (const m of q) if (now - m.at < 30000) pub(S.base + 'ev', m.m); }
  UI.refresh();
}
function pub(topic, obj) {
  const s = JSON.stringify(obj); let ok = false;
  for (const L of S.links) if (L?.up && L.client) { try { L.client.publish(topic, s, { qos: 0 }); ok = true; } catch {} }
  return ok;
}
function send(m, critical = false) {
  if (!S) return; m.f = S.id; m.z = S.inst; m.q = ++S.seq;
  const ok = pub(S.base + 'ev', m);
  if (critical) { if (!ok) { S.outbox.push({ m, at: performance.now() }); if (S.outbox.length > 20) S.outbox.shift(); } else setTimeout(() => pub(S.base + 'ev', m), 350); }
}
function requestSync(force) { const now = performance.now(); if (!force && now - S.lastSync < 2000) return; S.lastSync = now; send({ t: 'sync?' }); }
function leave() { if (!S || S.left) return; S.left = true; try { send({ t: 'bye' }); } catch {} for (const L of S.links) { try { L?.client?.end(true); } catch {} } }
const v3 = (v) => v ? [+(+v.x).toFixed(2), +(+v.y).toFixed(2), +(+v.z).toFixed(2)] : [0, 0, 0];

// ---------- background: worker tick, visibility ----------
function startWorkerTick() {
  const tick = () => {
    if (!S) return; const now = performance.now();
    if (now - S.lastSend > HEARTBEAT_MS) sendState(now);            // rAF stalled (hidden tab / frozen frame): 2 Hz AFK heartbeat
    for (const L of S.links) if (L?.up && now - L.lastRx > WATCHDOG && now - L.upAt > WATCHDOG) { console.log('[net] watchdog: no echo on', L.url); L.up = false; openLink(L.i); UI.refresh(); }
  };
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250);'], { type: 'text/javascript' })));
    w.onmessage = tick; S.worker = w;
  } catch { setInterval(tick, 250); }
}
function onVisibility() {
  const now = performance.now();
  if (document.hidden) { S.hiddenAt = now; sendState(now, true); return; }
  const away = S.hiddenAt ? now - S.hiddenAt : 0; S.hiddenAt = 0;
  if (away > 3000) for (const p of S.peers.values()) p.seen = Math.max(p.seen, now - TIMEOUT / 2);   // sockets may have been frozen: grace before timeouts
  kickLinks();
  sendState(now, true); send({ t: 'hello', n: S.name }); requestSync(true);
  UI.refresh();
}

// ---------- inbound: validate → dedupe → rate-limit → dispatch ----------
function allow(pid, kind, rate, burst) {
  const k = pid + kind, now = performance.now(); let b = S.buckets.get(k);
  if (!b) { if (S.buckets.size > 600) S.buckets.clear(); S.buckets.set(k, b = { tok: burst, at: now }); }
  b.tok = Math.min(burst, b.tok + (now - b.at) / 1000 * rate); b.at = now;
  if (b.tok < 1) return false; b.tok--; return true;
}
function fresh(key, q) {
  let d = S.dedupe.get(key); if (!d) { if (S.dedupe.size > 200) S.dedupe.clear(); S.dedupe.set(key, d = { set: new Set(), max: 0 }); }
  if (d.set.has(q) || q < d.max - 400) return false;
  d.set.add(q); if (q > d.max) d.max = q;
  if (d.set.size > 500) for (const v of d.set) if (v < d.max - 400) d.set.delete(v);
  return true;
}
/** QA: ?netfault=loss=0.3,delay=800,dup=0.2 drops / delays (so reorders) / duplicates incoming messages, each copy on its own:
 * the pressure tests (qa/durak-stress-test.mjs, qa/darts-mp-test.mjs) play through a bad phone connection with it */
function faultOf(v) {
  if (!v) return null; const o = { loss: 0, delay: 0, dup: 0 };
  for (const kv of String(v).split(',')) { const [k, x] = kv.split('='); if (k in o && Number.isFinite(+x)) o[k] = Math.max(0, +x); }
  console.log('[net] fault injection', JSON.stringify(o)); return o;
}
function onRaw(L, topic, buf) {
  const F = S?.fault;
  if (F && !buf?.__f) {
    L.lastRx = performance.now();   // the link itself is alive (the watchdog isn't what's being tested)
    if (Math.random() < F.loss) return;
    const go = () => { const b = buf; b.__f = 1; onRaw(L, topic, b); };
    if (F.delay) setTimeout(go, Math.random() * F.delay); else go();
    if (Math.random() < F.dup) setTimeout(go, Math.random() * (F.delay || 50));
    return;
  }
  const now = performance.now(); L.lastRx = now;
  if (!S || !buf || buf.length > MAX_MSG) return;
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return;
  try {
    if (topic.startsWith(S.base + 's/')) {
      const pid = topic.slice(S.base.length + 2);
      if (pid === S.id) { if (m.z === S.inst && Number.isFinite(m.ts)) { const r = now - m.ts; if (r >= 0 && r < 10000) L.rtt = L.rtt ? L.rtt * 0.8 + r * 0.2 : r; } return; }   // our own echo: link liveness + ping
      if (ID_RE.test(pid)) onState(pid, m, now);
    } else if (topic === S.base + 'ev') {
      if (!ID_RE.test(m.f) || m.f === S.id || typeof m.t !== 'string' || !/^[a-z?]{1,12}$/i.test(m.t)) return;
      if (m.t === 'bye') return onBye(m.f, now);
      if (!Number.isInteger(m.q) || !fresh(m.f + ':' + String(m.z || '').slice(0, 8), m.q)) return;
      if (!allow(m.f, 'e', 45, 90)) return;
      onEvent(m);
    }
  } catch (e) { console.warn('[net] bad message', m?.t, e?.message); }
}

// ---------- remote players ----------
function peerFor(pid, name) {
  let p = S.peers.get(pid);
  if (p) { if (name && name !== p.name) { p.name = name; const sc = S.score.get(pid); if (sc) sc.name = name; recomputeNames(); } return p; }
  const ctx = S.ctx; const asset = ctx.ai?.asset; if (!asset) return null;
  const inst = createInstance(asset, [...pid].reduce((a, c) => a + c.charCodeAt(0), 0) % 3);
  ctx.scene.add(inst.group);
  import('./world/outfits.js').then((m) => m.dressRemote(inst, pid, ctx)).catch((e) => console.warn('[net] outfit', e));   // lazy: a static import cycles through people.js and stalls net init   // friends show up as the hero (jeans + their own band tee), not a soldier
  for (const h of inst.hitboxes) { h.userData.remote = pid; delete h.userData.soldier; ctx.raycastTargets.push(h); }
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true })); tag.scale.set(1.3, 0.33, 1); tag.renderOrder = 5; ctx.scene.add(tag);
  const now = performance.now();
  p = { id: pid, name: name || '?', inst, tag, tagText: '', snaps: [], dead: false, deadAt: 0, afk: false, seen: now, byeAt: 0, fall: 0,
    lastQ: -1, z: null, off: null, offAt: now, jit: 0, iv: 1000 / SEND_HZ, lastTs: null, delay: 100, delayT: 100, vehKey: null, vehObj: null, veh: null, heading: 0 };
  S.peers.set(pid, p);
  const sc = S.score.get(pid); if (sc) { sc.gone = false; if (name) sc.name = name; } else S.score.set(pid, { name: p.name, k: 0, d: 0, gone: false });
  recomputeNames();
  ctx.hud?.toast?.(`${S.disp.get(pid) || p.name} joined`, 1800);
  UI.refresh(); return p;
}
function dropPeer(pid, why = 'left') {
  const p = S.peers.get(pid); if (!p) return; const ctx = S.ctx;
  ctx.scene.remove(p.inst.group); ctx.scene.remove(p.tag); p.tag.material.map?.dispose(); p.tag.material.dispose();
  if (p.vehObj) ctx.scene.remove(p.vehObj);
  for (const h of p.inst.hitboxes) { const i = ctx.raycastTargets.indexOf(h); if (i > -1) ctx.raycastTargets.splice(i, 1); }
  S.peers.delete(pid); const sc = S.score.get(pid); if (sc) sc.gone = true;   // ghost: comes back if they rejoin with the same id
  for (const k of ['s', 'e']) S.buckets.delete(pid + k);
  ctx.hud?.toast?.(`${S.disp.get(pid) || p.name} ${why}`, 1500);
  recomputeNames(); UI.refresh(); UI.renderBoard();
}
function onBye(pid, now) { const p = S.peers.get(pid); if (p) p.byeAt = now; }

// duplicate names: the smallest id keeps the plain name, the others get ·XY — the same labels on every client
function recomputeNames() {
  const all = [[S.id, S.name], ...[...S.peers.values()].map((p) => [p.id, p.name])];
  const groups = new Map(); for (const [id, n] of all) { const k = n.toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(id); }
  for (const [id, n] of all) { const g = groups.get(n.toLowerCase()).sort(); S.disp.set(id, g.length > 1 && g[0] !== id ? `${n}·${id.slice(0, 2).toUpperCase()}` : n); }
  for (const [id, sc] of S.score) if (!S.disp.has(id)) S.disp.set(id, sc.name);
}
function setTag(p) {
  const text = (S.disp.get(p.id) || p.name) + (p.afk ? ' · AFK' : '');
  if (text === p.tagText) return; p.tagText = text;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = '600 28px Barlow, Arial, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(4, 12, 248, 40);
  g.fillStyle = p.afk ? '#9aa4ae' : '#ff7a5c'; g.fillText(text, 128, 42, 240);
  p.tag.material.map?.dispose(); p.tag.material.map = new THREE.CanvasTexture(c); p.tag.material.needsUpdate = true;
}

function onState(pid, m, now) {
  const q = m.q, P = m.p; if (!Number.isInteger(q) || !Array.isArray(P) || P.length < 6) return;
  let p = S.peers.get(pid);
  const z = typeof m.z === 'string' ? m.z.slice(0, 8) : '';
  if (p && z === p.z && q <= p.lastQ) return;                      // same packet via another broker, or out of order
  if (!allow(pid, 's', 40, 60)) return;
  const x = num(P[0], 40000), y = num(P[1], 5000), zz = num(P[2], 40000), yaw = num(P[3], 1000), sp = num(P[4], 200), fl = int(P[5], 0, 255) ?? 0;
  if ([x, y, zz, yaw, sp].some(Number.isNaN)) return;
  const held = typeof m.w === 'string' && /^[a-z0-9_]{1,12}$/i.test(m.w) ? m.w : null;
  let v = null;
  if (m.v && typeof m.v === 'object' && m.v.k !== 'pass') {
    const k = String(m.v.k || ''); const vp = vec([m.v.x, m.v.y, m.v.z]); const h = num(m.v.h, 1000);
    if (vp && !Number.isNaN(h) && (k === 'bike' || k === 'jetski' || CAR_KINDS.includes(k))) v = { k, c: int(m.v.c, 0, 0xffffff) ?? 0x22305c, h, x: vp[0], y: vp[1], z: vp[2] };
  }
  p = p || peerFor(pid, cleanName(m.n)); if (!p) return;
  if (z !== p.z) { p.z = z; p.lastQ = -1; p.off = null; p.lastTs = null; }   // they reloaded (same id, new instance): reset sequence + clock
  p.lastQ = q; p.seen = now; p.inst.heldId = held;   // outfits.js puts it in their hands
  const n = cleanName(m.n); if (n && n !== p.name) peerFor(pid, n);
  if (Array.isArray(m.sc)) mergeScore(pid, n || p.name, int(m.sc[0], 0, 99999) ?? 0, int(m.sc[1], 0, 99999) ?? 0);
  // sender-clock timeline (skew-free: only differences of their own clock are used)
  const ts = Number.isFinite(m.ts) ? m.ts : now; const off = now - ts;
  if (p.off === null || off < p.off) p.off = off; else p.off += (now - p.offAt) * 0.0005; p.offAt = now;
  const late = Math.max(0, off - p.off); p.jit = p.jit * 0.9 + Math.min(late, 1000) * 0.1;
  if (p.lastTs !== null) { const iv = ts - p.lastTs; if (iv > 0 && iv < 3000) p.iv = p.iv * 0.85 + iv * 0.15; } p.lastTs = ts;
  p.delayT = Math.min(DELAY_MAX, Math.max(DELAY_MIN, 1.5 * p.iv, p.iv + 2.5 * p.jit + 15));
  const last = p.snaps[p.snaps.length - 1];
  let t = ts + p.off; if (last && t <= last.t) t = last.t + 1;
  let fe = null; if (Array.isArray(m.fe) && m.fe.length === 2) { const lx = num(m.fe[0], 5), lz = num(m.fe[1], 14); if (!Number.isNaN(lx) && !Number.isNaN(lz)) fe = [lx, lz]; }   // on the ferry deck (boat-local)
  let tr = null; if (Array.isArray(m.tr) && m.tr.length === 3) { const c = int(m.tr[0], 0, 15), lx = num(m.tr[1], 3), lz = num(m.tr[2], 12); if (c != null && !Number.isNaN(lx) && !Number.isNaN(lz)) tr = [c, lx, lz]; }
  let ub = null; if (Array.isArray(m.ub) && m.ub.length === 2) { const id = int(m.ub[0], 0, 2147483647), seat = int(m.ub[1], 0, 2); if (id !== null && seat !== null) ub = [id, seat]; }   // in an Uber: [ride, seat]
  const s = { t, x: v ? v.x : x, y: v ? v.y : y, z: v ? v.z : zz, yaw: v ? v.h : yaw, sp, f: fl, v, tr, fe, ub, tp: false };
  if (last && Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z) > TELEPORT) s.tp = true;
  p.snaps.push(s); if (p.snaps.length > 40) p.snaps.shift();
  const afk = !!(fl & F_AFK); if (afk !== p.afk) { p.afk = afk; UI.refresh(); }
}
function mergeScore(pid, name, k, d) {
  let e = S.score.get(pid); if (!e) S.score.set(pid, e = { name: name || '?', k: 0, d: 0, gone: pid !== S.id && !S.peers.has(pid) });
  const changed = k > e.k || d > e.d; e.k = Math.max(e.k, k); e.d = Math.max(e.d, d); if (name && pid !== S.id) e.name = name;
  if (changed) UI.renderBoard();
}

function onEvent(m) {
  const ctx = S.ctx, f = m.f;
  switch (m.t) {
    case 'hello': { const n = cleanName(m.n); if (n) { const sc = S.score.get(f); if (sc) sc.name = n; } peerFor(f, n); return; }
    case 'sync?': { setTimeout(() => { if (!S) return; send({ t: 'sync', to: f, sb: [...S.score.entries()].slice(0, 40).map(([id, v]) => [id, v.name, v.k, v.d]), st: [...S.stolen].slice(0, 200) }); }, 50 + Math.random() * 350); return; }
    case 'sync': {
      if (m.to !== S.id) return;
      if (Array.isArray(m.sb)) for (const r of m.sb.slice(0, 40)) { if (!Array.isArray(r) || !ID_RE.test(r[0])) continue; mergeScore(r[0], r[0] === S.id ? null : cleanName(r[1]), int(r[2], 0, 99999) ?? 0, int(r[3], 0, 99999) ?? 0); }
      if (Array.isArray(m.st)) for (const i of m.st.slice(0, 200)) if (int(i, 0, 100000) !== null && !S.stolen.has(i)) { S.stolen.add(i); ctx.bus.emit('net:steal', { t: 'steal', i, f, sync: true }); }
      recomputeNames(); UI.renderBoard(); return;
    }
    case 'shot': {
      if (document.hidden) return;
      const o0 = vec(m.o), d0 = vec(m.d, 2); if (!o0 || !d0) return;
      const p = S.peers.get(f); const o = new THREE.Vector3(...o0), d = new THREE.Vector3(...d0); if (d.lengthSq() < 1e-6) return; d.normalize();
      if (p?.inst.muzzle && p.inst.group.visible) p.inst.muzzle.getWorldPosition(o);
      try { ctx.weapons?.fx?.enemyShot?.(o, d); } catch {}
      try { ctx.audio?.play?.('enemy_rifle', { position: { x: o.x, y: o.y, z: o.z } }); } catch {}
      return;
    }
    case 'hit': {
      if (m.to !== S.id) return;
      const me = ctx.player; if (!me || me.dead || S.protectT > 0 || isAfk()) return;
      const dmg = Math.max(0, Math.min(250, +m.dmg || 0)); if (!dmg) return;
      const p = S.peers.get(f); S.lastAttacker = { id: f, hs: !!m.hs, at: performance.now() };
      me.damage(dmg, p ? (p.vehObj || p.inst.group).position.clone() : null);
      return;
    }
    case 'boom': {   // someone's frag: replay the blast, and hurt ourselves if we are in range
      const pp = vec(m.p); if (!pp) return; const pos = new THREE.Vector3(...pp), R = Math.max(0, Math.min(12, +m.r || 6));
      if (!document.hidden) { try { ctx.weapons?.fx?.explosion?.(pos); } catch {} try { ctx.audio?.play?.('explosion', { position: { x: pos.x, y: pos.y, z: pos.z } }); } catch {} }
      const me = ctx.player;
      if (me && !me.dead && S.protectT <= 0 && !isAfk()) { const d = Math.hypot(me.position.x - pos.x, me.position.y + 0.9 - pos.y, me.position.z - pos.z); if (d < R) { const dmg = Math.round(100 * (1 - d / R) ** 1.3); if (dmg > 0) { S.lastAttacker = { id: f, hs: false, at: performance.now() }; me.damage(dmg, pos); } } }
      return;
    }
    case 'kill': { if (m.v !== f) return; const k = ID_RE.test(m.k) ? m.k : null; return onKill(k, f, !!m.hs); }   // only the victim may announce its own death
    case 'steal': { const i = int(m.i, 0, 100000); if (i === null) return; S.stolen.add(i); ctx.bus.emit('net:steal', { t: 'steal', i, f }); return; }
    case 'elev': {
      const i = int(m.i, 0, 255), k = int(m.k, 0, 15), s = int(m.s ?? 0, 0, 7), p = vec(m.p); if (i === null || k === null || s === null || !p || (m.d !== 'up' && m.d !== 'down')) return;
      ctx.bus.emit('net:elev', { t: 'elev', f, i, k, s, d: m.d, p }); return;
    }
    case 'smoke': { if (document.hidden) return; const p = vec(m.p); if (p) ctx.bus.emit('net:smoke', { t: 'smoke', f, p, c: ID_RE.test(m.c) ? m.c : null, k: m.k === 'cig' ? 'cig' : undefined }); return; }   // c: the car it was smoked in (everyone in it shares)
  }
  ctx.bus.emit('net:' + m.t, m);   // other game-mode events (coney hangout: igor …)
}
function onKill(killer, victim, hs) {
  const ctx = S.ctx; const nm = (id) => S.disp.get(id) || S.score.get(id)?.name || '?';
  const kv = S.score.get(victim) || { name: nm(victim), k: 0, d: 0, gone: false }; kv.d++; S.score.set(victim, kv);
  if (killer && killer !== victim) { const kk = S.score.get(killer) || { name: nm(killer), k: 0, d: 0, gone: !S.peers.has(killer) && killer !== S.id }; kk.k++; S.score.set(killer, kk); }
  const vp = S.peers.get(victim); if (vp) { vp.dead = true; vp.deadAt = performance.now(); vp.fall = 0; }
  ctx.hud?.killfeed?.(`${killer ? nm(killer) : 'WORLD'}  ${hs ? '⊕ ' : ''}▸  ${nm(victim)}`);
  if (killer === S.id && victim !== S.id) { ctx.hud?.hitmarker?.(hs, true); ctx.hud?.scorePopup?.(hs ? 'HEADSHOT KILL' : 'KILL', hs); }
  UI.renderBoard();
}
const isAfk = () => document.hidden || S.ctx.state === 'menu' || S.ctx.state === 'paused';

// ---------- spawns ----------
/** a standing spot on one of the map's ground levels (not a roof / balcony / deck): W.waveTuning.levels if the map lists them
 *  (multi-level interiors like the terminal: concourse 0, dining −6, subway −12), else within 1.5 m of W.groundHeight */
export function groundLevel(W, q) {
  const L = W?.waveTuning?.levels; if (Array.isArray(L) && L.length) return L.some((l) => Math.abs(q.y - l) < 0.6);
  if (!W?.groundHeight) return q.y < 1.5; const g = W.groundHeight(q.x, q.z); return !Number.isFinite(g) || Math.abs(q.y - g) < 1.5;
}
/** online respawn pool: every player + enemy spawn that is a free nav floor on its own level, outside no-go zones / lobbies */
function onlineSpawns(ctx) {
  const W = ctx.world || {}, nav = ctx.ai?.nav, out = [], seen = new Set();
  for (const v of W.playerSpawns || []) {
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.z)) continue;
    const y = Number.isFinite(v.y) ? v.y : 0; const key = `${Math.round(v.x)},${Math.round(y)},${Math.round(v.z)}`; if (seen.has(key)) continue; seen.add(key);
    let q = new THREE.Vector3(v.x, y, v.z);
    if (nav) { if (!nav.isFree(v.x, v.z, y) || Math.abs(nav.floorAt(v.x, v.z, y) - y) > 0.6) { q = nav.nearestFree(v.x, v.z, 2, y); if (!q || Math.abs(q.y - y) > 0.6) continue; } else q.y = nav.floorAt(v.x, v.z, y); }
    if (W.chaseNoGo?.(q.x, q.z, q.y) || W.indoorAt?.(q, null)) continue;
    out.push(q);
  }
  return out;
}
/** FFA respawn: the player module's pick (away from enemies, never the same spot twice), restricted to spots ≥ 25 m from every
 *  live peer — and on huge maps (W.waveTuning.respawnMax) not absurdly far from the nearest one, so friends can regroup */
function respawnAway(ctx) {
  const W = ctx.world, me = ctx.player, pool = S.spawnPool?.length >= 3 ? S.spawnPool : (W.playerSpawns || []);
  const others = [...S.peers.values()].filter((p) => !p.dead && !p.afk).map((p) => (p.vehObj || p.inst.group).position);
  let pick = pool;
  if (others.length && pool.length) {
    const maxR = W.waveTuning?.respawnMax ?? Infinity;
    const nd = (v) => { let d = Infinity; for (const o of others) d = Math.min(d, Math.hypot(v.x - o.x, v.z - o.z, (v.y - o.y) * 2)); return d; };
    const far = pool.filter((v) => { const d = nd(v); return d > 25 && d < maxR; }), far2 = pool.filter((v) => nd(v) > 25);
    pick = far.length >= 2 ? far : far2.length >= 2 ? far2 : pool;
  }
  const keep = W.playerSpawns; W.playerSpawns = pick;
  try { me.respawn(); } finally { W.playerSpawns = keep; }
}

// ---------- outbound state ----------
function sendState(now, force = false) {
  if (!S || (!force && !anyUp())) return; const ctx = S.ctx, me = ctx.player; if (!me?.position) return;
  S.lastSend = now; const p = me.position;
  const flags = (me.dead ? F_DEAD : 0) | (me.crouching ? F_CROUCH : 0) | (me.ads ? F_ADS : 0) | (isAfk() ? F_AFK : 0);
  let vi = null;
  try { const mv = ctx.vehicles?.mounted; vi = mv ? { k: mv.spec?.car ? (mv.kind || 'sedan') : mv.spec?.water ? 'jetski' : 'bike', c: mv.color ?? 0, h: +mv.heading.toFixed(3), x: +mv.pos.x.toFixed(2), y: +mv.pos.y.toFixed(2), z: +mv.pos.z.toFixed(2), ...(mv.haze > 0.01 ? { s: +mv.haze.toFixed(2) } : {}) } : (me.mounted?.passenger ? { k: 'pass' } : null); } catch {}
  const sc = S.score.get(S.id); let tr = null; try { tr = me.mounted?.train ? ctx.subway?.local?.() || null : null; } catch {}   // riding the F: car + spot in the car
  pub(S.base + 's/' + S.id, { n: S.name, q: ++S.sseq, z: S.inst, ts: Math.round(now), p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +(me.yaw || 0).toFixed(3), +(me.speed || 0).toFixed(1), flags], v: vi, tr, fe: ctx.ferry?.local?.() || undefined, ub: ctx.uber?.local?.() || undefined, sc: [sc.k, sc.d], w: String(ctx.weapons?.currentId || '').slice(0, 12) || undefined });   // w: what you're holding (friends draw it)
}

// ---------- per frame ----------
const _trV = new THREE.Vector3();
const _lerpAngle = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; };
export function update(dt, ctx) {
  if (!S) return;
  const now = performance.now(), rdt = Math.min(0.1, ctx.time?.realDt ?? dt), me = ctx.player;
  if (S.protectT > 0) S.protectT -= dt;
  if (S.respawnT > 0) UI.setRespawn(Math.ceil(S.respawnT));
  if (S.respawnT > 0 && (S.respawnT -= dt) <= 0) { S.respawnT = -1; UI.setRespawn(0); try { respawnAway(ctx); } catch (e) { console.warn('[net] respawn', e); } }
  // state goes out on real time — menu / pause (simDt = 0) must not silence us, or friends time us out
  if (me?.position && now - S.lastSend >= 1000 / SEND_HZ - 3) sendState(now);
  for (const [pid, p] of S.peers) {
    if (now - p.seen > TIMEOUT) { dropPeer(pid, 'timed out'); continue; }
    if (p.byeAt && p.seen < p.byeAt && now - p.byeAt > BYE_GRACE) { dropPeer(pid, 'left'); continue; }
    renderPeer(p, now, rdt, ctx);
  }
  UI.frame(S.tab || S.board);
}
function renderPeer(p, now, rdt, ctx) {
  const sn = p.snaps; if (!sn.length) return;
  p.delay += (p.delayT - p.delay) * Math.min(1, rdt * 2);
  const rt = now - p.delay;
  while (sn.length > 2 && sn[1].t <= rt) sn.shift();
  const A = sn[0], B = sn[1] || sn[0]; let x, y, z, yaw, cur;
  if (sn.length === 1 || rt <= A.t) { cur = A; x = A.x; y = A.y; z = A.z; yaw = A.yaw; }
  else if (rt <= B.t) {
    const k = (rt - A.t) / Math.max(1, B.t - A.t);
    if (B.tp) { cur = k < 0.5 ? A : B; x = cur.x; y = cur.y; z = cur.z; yaw = cur.yaw; }        // elevator / respawn / seat: snap, don't slide
    else { cur = k < 0.5 ? A : B; x = A.x + (B.x - A.x) * k; y = A.y + (B.y - A.y) * k; z = A.z + (B.z - A.z) * k; yaw = _lerpAngle(A.yaw, B.yaw, k); }
  } else {
    cur = B; x = B.x; y = B.y; z = B.z; yaw = B.yaw;
    const span = B.t - A.t, e = Math.min(rt - B.t, EXTRAP_MS);
    if (!B.tp && !(B.f & F_DEAD) && span > 0 && span < 400 && sn.length > 1) { const k = e / span; x += (B.x - A.x) * k; y += (B.y - A.y) * k; z += (B.z - A.z) * k; yaw = _lerpAngle(A.yaw, B.yaw, 1 + k); }
  }
  // on the F: place them in OUR copy of the (wall-clock) train from their spot in the car — a world position ~100 ms old would
  // put a rider metres behind a moving train, floating over the el
  // a friend on the ferry: on our copy of the boat (same wall clock), not metres behind a 40 m/s ferry
  if (cur.fe && ctx.ferry?.toWorld) { const q = ctx.ferry.toWorld(cur.fe[0], cur.fe[1], _trV); if (q) { x = q.x; y = q.y; z = q.z; } }
  // a friend in an Uber: in their seat on our copy of the car (same wall clock), facing the way it drives
  const ubq = cur.ub && ctx.uber?.toWorld ? ctx.uber.toWorld(cur.ub[0], cur.ub[1]) : null; if (ubq) { x = ubq.x; y = ubq.y; z = ubq.z; yaw = ubq.h; }
  if (cur.tr && ctx.subway?.toWorld) { const a = A.tr, b = B.tr, k = rt > A.t && rt < B.t ? (rt - A.t) / Math.max(1, B.t - A.t) : rt >= B.t ? 1 : 0, same = a && b && a[0] === b[0];
    const q = ctx.subway.toWorld(cur.tr[0], same ? a[1] + (b[1] - a[1]) * k : cur.tr[1], same ? a[2] + (b[2] - a[2]) * k : cur.tr[2], _trV); if (q) { x = q.x; y = q.y; z = q.z; } }
  const g = p.inst.group; g.position.set(x, y, z); g.rotation.y = yaw + Math.PI; p.heading = yaw;
  const dead = !!(cur.f & F_DEAD);
  if (!dead && p.dead && cur.t > p.deadAt + 500) { p.dead = false; p.fall = 0; }   // revive only on a snapshot newer than the kill
  if (dead && !p.dead) { p.dead = true; p.deadAt = now; }
  p.fall = p.dead ? Math.min(1, p.fall + rdt * 2.5) : 0; g.rotation.x = -p.fall * Math.PI / 2; g.position.y += p.fall * 0.25;
  const crouch = !!(cur.f & F_CROUCH); if (p.inst.inner) p.inst.inner.scale.y = crouch ? 0.72 : 1;
  const A_ = p.inst.actions;
  if (A_) { const w = cur.sp > 4.5 ? [0, 0, 1] : cur.sp > 0.4 ? [0, 1, 0] : [1, 0, 0]; ['Idle', 'Walk', 'Run'].forEach((n, i) => { const act = A_[n]; if (act) act.setEffectiveWeight(THREE.MathUtils.lerp(act.getEffectiveWeight(), p.dead ? (n === 'Idle' ? 1 : 0) : w[i], Math.min(1, rdt * 8))); }); }
  p.inst.mixer?.update(rdt);
  // driving: show their vehicle instead of the soldier (same interpolated pose; heading on the shortest arc)
  const vk = cur.v ? cur.v.k + ':' + cur.v.c : null;
  if (vk !== p.vehKey) {
    if (p.vehObj) { ctx.scene.remove(p.vehObj); p.vehObj = null; }
    p.vehKey = vk; p.veh = cur.v ? { ...cur.v } : null;
    if (cur.v) { try { p.vehObj = remoteVehicle(ctx, cur.v); ctx.scene.add(p.vehObj); } catch (e) { console.warn('[net] remote vehicle', e?.message); p.vehObj = null; } }
  }
  if (p.vehObj) {   // snapshots already carry the vehicle's pose (x/y/z/yaw = vehicle) while driving
    p.vehObj.position.set(x, y, z); p.vehObj.rotation.set(0, yaw, 0);
    const ski = cur.v?.k === 'jetski', O = ski ? ctx.world?.ocean : null;
    if (O) {   // jet ski: pitch / roll with the swell under it (the sea is on the wall clock, so it matches what they see)
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), wh = (a, b) => O.waveHeight(x + a, z + b);
      const pit = Math.atan2(wh(fx * 1.3, fz * 1.3) - wh(-fx * 1.3, -fz * 1.3), 2.6), rol = Math.atan2(wh(-fz * 0.55, fx * 0.55) - wh(fz * 0.55, -fx * 0.55), 1.1);
      p.vehObj.rotation.set(Math.max(-0.4, Math.min(0.4, pit)), yaw, Math.max(-0.35, Math.min(0.35, rol)), 'YXZ');
    }
    if (cur.v?.k === 'bike' || ski) {   // a bike / jet-ski rider stays visible, sat astride and facing the way it goes (was hidden: "invisible riders")
      g.visible = true; g.position.set(x, y + (ski ? 0.3 : 0.28), z); g.rotation.set(0, yaw + Math.PI, 0);
      if (A_) { A_.Idle?.setEffectiveWeight(1); A_.Walk?.setEffectiveWeight(0); A_.Run?.setEffectiveWeight(0); }
    } else if (p.inst.hero) {   // a friend driving: sat in the driver's seat, visible through the glass
      const e = carEye(cur.v?.k || 'sedan'); _seat.set(e.z, 0.08, -(e.x - 0.2)).applyAxisAngle(_up, yaw); g.visible = true; g.position.set(x + _seat.x, y + _seat.y, z + _seat.z); g.rotation.set(0, yaw + Math.PI, 0); p.inst.hero.fig.mood = 'sit';
    } else g.visible = false;
  } else { g.visible = true; if (p.inst.hero) p.inst.hero.fig.mood = ubq || nearCar(g.position) ? 'sit' : null; }
  setTag(p);
  p.tag.visible = !p.dead;
  if (p.vehObj) p.tag.position.set(x, y + 2.1, z); else p.tag.position.set(g.position.x, g.position.y + (crouch ? 1.8 : 2.25), g.position.z);
}

// ---------- status (read by netui) ----------
function statusInfo() {
  if (!S) return { text: 'OFFLINE', level: 'bad' };
  const up = S.links.filter((L) => L?.up), n = S.peers.size + 1;
  if (S.respawnT > 0) return { text: `RESPAWN IN ${Math.ceil(S.respawnT)}`, level: 'warn' };
  if (!S.mqtt) return { text: 'ONLINE UNAVAILABLE', level: 'bad' };
  if (!up.length) return { text: typeof navigator !== 'undefined' && navigator.onLine === false ? 'NO INTERNET · RETRYING' : S.everUp ? 'RECONNECTING…' : 'CONNECTING…', level: S.everUp ? 'bad' : 'warn' };
  const rtt = Math.min(...up.map((L) => L.rtt || 999));
  return { text: `${S.room.toUpperCase()} · ${n} PLAYER${n > 1 ? 'S' : ''} · ${rtt < 999 ? Math.round(rtt / 2) + ' MS' : '…'}`, level: up.length < S.links.length ? 'ok2' : 'ok', links: `${up.length}/${S.links.length}` };
}
export function roster() {
  if (!S) return [];
  return [...S.score.entries()].filter(([, v]) => !v.gone).map(([id, v]) => ({ id, name: S.disp.get(id) || v.name, k: v.k, d: v.d, me: id === S.id, afk: id === S.id ? isAfk() : !!S.peers.get(id)?.afk }))
    .sort((a, b) => b.k - a.k || a.d - b.d || a.name.localeCompare(b.name));
}
export function toggleBoard(v) { if (S) S.board = v ?? !S.board; }
export function netInfo() { return S ? { room: S.room, name: S.name, map: S.map, status: statusInfo() } : null; }

// ---------- remote vehicles (cars from the car kit, bikes from the bike kit) ----------
const _carGeo = new Map();
const _seat = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** a passenger rides in someone's car: their snapshots put them in the seat, so sit them down if a car is right there */
function nearCar(pos) { const m = S.ctx.vehicles?.mounted; if (m?.spec?.car && m.pos.distanceTo(pos) < 1.6) return true; for (const q of S.peers.values()) if (q.vehObj && q.veh?.k !== 'bike' && q.veh?.k !== 'jetski' && q.vehObj.position.distanceTo(pos) < 1.6) return true; return false; }
function remoteVehicle(ctx, v) {
  const grp = new THREE.Group();
  if (v.k === 'bike') { try { const b = buildBike(ctx); grp.add(b.group); } catch {} return grp; }
  if (v.k === 'jetski') { try { const b = buildJetski(ctx, v.c || null); grp.add(b.group); } catch {} return grp; }
  if (v.k === 'bus') { try { const B = buildBus({ sign: 'NOT IN SERVICE', lite: !!ctx.lite }); B.group.rotation.y = Math.PI / 2; grp.add(B.group); } catch {} return grp; }
  if (hasCarModel(v.k)) { const m = carModel(v.k, v.c || 0xb01010); if (m) { m.rotation.y = Math.PI / 2; grp.add(m); return grp; } }
  const G = _carGeo.get(v.k) || (_carGeo.set(v.k, carGeometries(v.k).geos), _carGeo.get(v.k)); const CM = carMaterials();
  const paint = CM.paint.clone(); paint.color = new THREE.Color(v.c || 0x22305c);
  for (const [slot, g] of Object.entries(G)) { if (!g) continue; const m = new THREE.Mesh(g, slot === 'paint' ? paint : slot === 'glass' ? (CM.glassSee || CM.glass) : CM[slot]); m.rotation.y = Math.PI / 2; m.castShadow = slot === 'paint'; grp.add(m); }
  try { const cab = carInterior(v.k, G); cab.group.rotation.y = Math.PI / 2; grp.add(cab.group); } catch {}
  return grp;
}

// HANGKIT — the friends loop, map-agnostic: cash, a small stash (weed / liquor / 40oz), B to use it anywhere (friends within a
// few metres get lifted too), vendors you talk to (dialogue with numbered choices, tappable on phones), elevators / hidden
// stairs that fade you between floors (friends standing with you ride along), steal a parked car, hop in a friend's car,
// cash dropped by mercenaries you kill, "respawn at <spot>" on the death screen. Maps configure it (coney/hangout.js,
// wsp + sbu hangouts); everything online rides net.js events: elev / steal / smoke / drink / buy.
import * as THREE from 'three';
import { hideParkedCar, carEye, dropParkedCarBoxes } from './carkit.js';
import { growHaze } from '../vehicledamage.js';

const RIDE_T = 4.2, STAIRS_T = 5.2, FADE = 0.45, MAX_INV = 12, SHARE_R = 4;
// kind: 'smoke' | 'booze' | 'drink' | 'food' | 'loot' | 'misc' (inventory categories); effects: drunk/dur, food (HP), cig (smokes per pack, no high), magic, keep (not for B), melt
const CASH_GIFT = 10, GIFT_RANGE = 3, GIFT_RECEIVE_RANGE = GIFT_RANGE + 1; // allow for interpolated peer positions
export const ITEMS = {
  weed: { kind: 'smoke', icon: '🌿', name: 'bag of weed' },
  bottle: { kind: 'booze', icon: '🍾', name: 'bottle of liquor', drunk: 0.8, dur: 150 },
  forty: { kind: 'booze', icon: '🍺', name: '40 of Olde English', drunk: 1, dur: 180 },
  kvass: { kind: 'drink', icon: '🥤', name: 'kvass', drunk: 0.2, dur: 45 },
  meat: { kind: 'food', icon: '🥩', name: 'shashlik (raw — grill it)', keep: true },
  skewer: { kind: 'food', icon: '🍢', name: 'hot shashlik skewer', keep: true },
  gps: { kind: 'loot', icon: '📟', name: 'stolen GPS', keep: true },   // SHADES buys them   // not for B: grill it at the mangal
  // «Бурбон, братва, Гудзон» — Arkasha's table
  manhattan: { kind: 'booze', icon: '🍸', name: 'Manhattan (bourbon, vermouth, Sammy\'s ice)', drunk: 0.6, dur: 170, glass: 'coupe' },
  guinness: { kind: 'booze', icon: '🍺', name: 'pint of Guinness', drunk: 0.35, dur: 120, glass: 'pint' },
  jameson: { kind: 'booze', icon: '🥃', name: 'Jameson', drunk: 0.5, dur: 130, glass: 'shot' },
  sausage: { kind: 'food', icon: '🌭', name: 'сосиска', food: 30 },
  // the stores on the block (deli.js storeTalk)
  chopped: { kind: 'food', icon: '🥪', name: 'chopped cheese', food: 40 },
  coffee: { kind: 'food', icon: '☕', name: 'coffee, light and sweet', food: 6 },
  slice: { kind: 'food', icon: '🍕', name: 'slice of pizza', food: 30 },
  knots: { kind: 'food', icon: '🥖', name: 'garlic knots', food: 15 },
  dumplings: { kind: 'food', icon: '🥟', name: 'pork dumplings', food: 30 },
  lomein: { kind: 'food', icon: '🍜', name: 'chicken lo mein', food: 40 },
  eggroll: { kind: 'food', icon: '🥢', name: 'egg roll', food: 12 },
  zebra: { kind: 'drink', icon: '🦓', name: 'zebra milk', food: 12, milk: true },
  spliff: { kind: 'smoke', icon: '🍃', name: 'the Elf\'s spliff', magic: true },
  ice: { kind: 'misc', icon: '🧊', name: 'bag of ice (melting!)', keep: true, melt: 110 },
  // the boardwalk / beach hustlers (coney/hustlers.js)
  cigs: { kind: 'smoke', icon: '🚬', name: 'pack of Marlboro Reds', cig: 5 },   // B lights one: smoke, no high
  tallboy: { kind: 'booze', icon: '🍺', name: 'tallboy of Baltika 9', drunk: 0.3, dur: 110, glass: 'can' },
  vodka: { kind: 'booze', icon: '🥃', name: 'стопка водки', drunk: 0.45, dur: 120, glass: 'shot', liq: 0xdfe6e8 },
  vape: { kind: 'smoke', icon: '💨', name: 'disposable vape (watermelon ice)', cig: 15 },   // B takes a hit: vapour, no high
  bic: { kind: 'tool', icon: '🔥', name: 'Bic lighter', keep: true },
  nutcracker: { kind: 'booze', icon: '🧃', name: 'nutcracker (Henny + juice, plastic bottle)', drunk: 0.75, dur: 170, glass: 'can', liq: 0xc2263a },
  semechki: { kind: 'food', icon: '🌻', name: 'семечки (sunflower seeds)', food: 6 },
  blunt: { kind: 'smoke', icon: '🍂', name: 'fat blunt', hi: 0.4 },   // hits harder than a bag
  gin: { kind: 'booze', icon: '🍸', name: 'Tanqueray, neat', drunk: 0.55, dur: 150, glass: 'shot', liq: 0xe8eef0 },
  drone: { kind: 'gear', icon: '🛸', name: 'killer drone (hunts bad guys, 45 s)', drone: true },
  shrooms: { kind: 'trip', icon: '🍄', name: 'Felip\'s mushrooms', trip: 120 },   // 2 minutes, tripping balls
  coke: { kind: 'smoke', icon: '❄️', name: 'bag of coke', rush: 60 },   // B: a bump. Sobers you up some, a minute of speed, then the crash
  zippo: { kind: 'tool', icon: '🔥', name: 'Zippo (brushed chrome)', keep: true },
  phone: { kind: 'gear', icon: '📱', name: 'iPhone (Uber app)', keep: true, app: 'phone' },   // app: Open in the bag emits this bus event (coney/uber.js)
};

let V = null;
export const kit = () => V;

/**
 * @param world  map world
 * @param o.cash starting cash · o.help controls-card html · o.title card title · o.respawn { label, at: () => [x, y, z, yaw] }
 */
export function buildKit(world, o = {}) {
  const { ctx } = world;
  V = { world, ctx, cash: o.cash ?? 20, startCash: o.cash ?? 20, inv: ['bic', 'cigs', 'drone', 'drone'], drunk: 0, drunkT: -1, high: 0, highT: -1, smokeT: 0, puffT: 0, puffs: [], riding: null, passenger: null,
    shafts: [], spots: [], vendors: [], hurtables: [], drops: [], dialog: null, promptT: 0, lastPrompt: '', respawn: o.respawn || null, respawnPick: false, talked: new Set(), onUpdate: [] };
  buildUI(o); buildPuffs();
  if (!ctx.__hangkitBound) { ctx.__hangkitBound = true; bindOnce(ctx); }
  world.updaters.push((dt) => { if (V?.world === world) update(dt); });
  import('./charselect.js').then((m) => m.mountCharSelect(world.ctx || V.ctx)).catch((e) => console.warn('[hangkit] charselect', e));
  import('./inventory.js').then((m) => m.mountInventory(world.ctx || V.ctx, api)).catch((e) => console.warn('[hangkit] inventory', e));   // I: the bag panel
  return api;
}

const api = {
  get cash() { return V?.cash ?? 0; },
  /** status effects: { shades: bool, crabs: bool } */
  get status() { return V?.status || {}; },
  setStatus(k, v) { if (!V) return; V.status = V.status || {}; V.status[k] = v; renderCash(); },
  has: (item) => !!V?.inv.includes(item),
  take(item) { if (!V) return false; const i = V.inv.indexOf(item); if (i < 0) return false; V.inv.splice(i, 1); renderCash(); return true; },
  pay(n) { if (!V || V.cash < n) return false; V.cash -= n; renderCash(); return true; },
  earn(n) { if (!V) return; V.cash += n; renderCash(); },
  give(item) { if (!V || V.inv.length >= MAX_INV) return false; V.inv.push(item); renderCash(); return true; },
  /** a map's own starting item (coney chill: the phone): in the bag now and again after START FRESH */
  starter(item) { if (!V) return; V.starter = V.starter || []; if (!V.starter.includes(item)) V.starter.push(item); if (!V.inv.includes(item)) api.give(item); },
  full: () => !V || V.inv.length >= MAX_INV,
  /** interaction point: { pos: Vector3 (may move), r, dy, prompt: string | () => string, act: () => void, when?: () => bool } */
  spot(s) { V.spots.push({ r: 2, dy: 1.3, ...s }); return s; },
  /** vendor: { name, pos: Vector3 (may move), r, talk: () => node }  node = { text, choices: [{ label, go: node | () => node | null }] } */
  vendor(v) { const e = { r: 2.2, ...v }; V.vendors.push(e); if (v.fig) e.hurt = hurtable(v.fig, { name: v.name, vendor: e }); return e; },
  hurtable: (fig, o) => hurtable(fig, o), setStartCash: (n) => { if (V) V.startCash = n; },
  removeVendor(e) { if (!V) return; const i = V.vendors.indexOf(e); if (i > -1) V.vendors.splice(i, 1); if (V.dialog?.vendor === e) closeDialog(); },
  /** elevator / stair shaft: { kind: 'elevator' | 'stairs', floors, label, lobby: { cars: [{ pos, yaw }] }, tops: [{ cars: [{ pos, yaw }], face }] } */
  shaft(s) { V.shafts.push({ kind: 'elevator', floors: 10, ...s }); return V.shafts.length - 1; },
  onUpdate(fn) { V.onUpdate.push(fn); },
  toast: (t, ms) => V?.ctx.hud?.toast?.(t, ms),
  puff: (at) => puff(at), useItem: (want) => useItem(want), shafts: () => V?.shafts || [], itemModel: (kind) => itemModel(kind), drop: (item) => { if (!V) return false; const i = V.inv.lastIndexOf(item); if (i < 0) return false; V.inv.splice(i, 1); renderCash(); return true; }, left: (item) => V?.left?.[item] || 0, callElevator: (i, k, dir, s) => callElevator(i, k, dir, s), steal: (c) => steal(c), stealLocal: (i, mine) => stealLocal(i, mine),
  nearestParked: (r) => nearestParked(r), endRide: (f) => endRide(f), leavePassenger: () => leavePassenger(), pickRespawn: () => pickRespawn(),
  openDialog: (name, node) => openDialog(name, node), closeDialog: () => closeDialog(), choose: (i) => choose(i), dropCash: (at, n) => dropCash(at, n),
  /** QA: where the interaction points are */
  points: () => V && { shafts: V.shafts.map((t) => ({ kind: t.kind, label: t.label, lobby: t.lobby.cars.map((c) => c.pos.toArray()), top: t.tops[0].cars.map((c) => c.pos.toArray()) })), vendors: V.vendors.map((v) => ({ name: v.name, pos: v.pos.toArray() })), cars: (V.world.parkedCars || []).filter((c) => !c.gone).length, start: V.world.W?.onlineStart },
  hurtState: () => V && V.hurtables.map((H) => ({ name: H.o.name, hp: Math.round(H.hp), down: H.down })),
  state: () => V && { iceLeft: V.iceT != null ? V.iceT / ITEMS.ice.melt * 100 : null, cash: V.cash, inv: V.inv.slice(), item: V.inv[V.inv.length - 1] || null, drunk: +(V.drunk || 0).toFixed(2), high: +V.high.toFixed(2), smoke: +Math.min(1, (V.smokes || []).reduce((a, t) => a + Math.max(0, 1 - (performance.now() - t) / 240000) * 0.3, 0)).toFixed(2), riding: !!V.riding, passenger: !!V.passenger,
    dialog: V.dialog ? { name: V.dialog.name, text: V.dialog.node.text, choices: (V.dialog.node.choices || []).map((c) => c.label) } : null, drops: V.drops.map((d) => [+d.pos.x.toFixed(1), +d.pos.y.toFixed(1), +d.pos.z.toFixed(1), d.n]) },
};
export const hangkit = api;
/** generic QA hook for maps without their own (window.__game.hangout) */
export const kitQA = { item: (it) => api.give(it), state: () => ({ ...api.state(), ...api.points() }), shafts: () => V.shafts.map((t) => ({ kind: t.kind, lobby: t.lobby.cars.map((c) => c.pos.toArray()) })), ride: (i, dir = 'up', k = 0) => callElevator(i, k, dir), choose: (i) => choose(i), close: () => closeDialog(), steal: () => { const c = nearestParked(1e9); if (c) steal(c); return !!c; }, give: (n) => api.earn(n), use: () => useItem() };

// bus handlers live for the page (the world may be rebuilt); they always act on the current V
function bindOnce(ctx) {
  ctx.bus.on('net:elev', (m) => V && onRemoteElev(m));
  ctx.bus.on('net:steal', (m) => V && stealLocal(m.i, false));
  ctx.bus.on('net:smoke', (m) => { if (!V || !Array.isArray(m.p)) return; const at = new THREE.Vector3(...m.p); puff(at); const me = V.ctx.player; if (m.k !== 'cig' && me && !me.dead && (sameCar(m) || at.distanceTo(me.position) < SHARE_R + 1)) { V.high = Math.min(1, V.high + 0.18); V.highT = Math.max(V.highT, 150); } });
  ctx.bus.on('net:drink', (m) => { if (!V || !Array.isArray(m.p)) return; const me = V.ctx.player; if (!me || me.dead || (!sameCar(m) && new THREE.Vector3(...m.p).distanceTo(me.position) >= SHARE_R + 1)) return;
    const it = ITEMS[m.k] || ITEMS.bottle; drink(false, it); V.ctx.hud?.toast?.(`${V.ctx.net?.peer?.(m.f)?.name || 'A friend'} passed you the ${m.k === 'forty' ? '40' : ITEMS[m.k]?.glass ? ITEMS[m.k].name.split(' (')[0] : 'bottle'}`, 1800); });
  ctx.bus.on('net:buy', (m) => V && V.ctx.hud?.toast?.(`${V.ctx.net?.peer?.(m.f)?.name || 'Someone'} bought ${ITEMS[m.k]?.name ? 'a ' + ITEMS[m.k].name : 'something'} from ${String(m.v || 'the man').slice(0, 16)}`, 1800));
  ctx.bus.on('playerDied', () => { if (!V) return; endRide(true); leavePassenger(); closeDialog(); });
  // mercenary cash: solo / host kills arrive as enemyKilled, an online client's own kills as mercKilled (netwaves)
  ctx.bus.on('enemyKilled', (d) => { if (V && d?.position && !d.qa) mercCash(d.position, !!d.headshot); });
  ctx.bus.on('mercKilled', (d) => { if (V && d?.mine && d.position) mercCash(d.position, !!d.hs); });
  ctx.bus.on('state', ({ state }) => { if (V && state === 'dead') respawnBtn(); showUI(state === 'playing'); });
  ctx.bus.on('playerRespawn', () => {
    if (!V) return;
    if (V.cash < V.startCash) { V.cash = V.startCash; renderCash(); }   // back on your feet with at least the starting cash (ammo refills in weapons.js)
    if (!V.respawnPick) return; V.respawnPick = false; toRespawn();
  });
  addEventListener('keydown', (e) => {
    if (!V) return;
    if (e.code === 'KeyT' && V.ctx.state === 'dead' && V.respawn) { pickRespawn(); return; }
    if (!V.dialog) return;
    // dialogue owns 1-9 / F while open (capture phase: the game's key handler never sees them → no weapon swap / inspect)
    const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) choose(+m[2] - 1); }
    else if (e.code === 'KeyF' || e.code === 'Digit0') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) closeDialog(); }
  }, { capture: true });
  addEventListener('keydown', (e) => { if (V?.ui?.help && e.code === 'KeyH' && !e.repeat) { V.ui.help.style.display = V.ui.help.style.display === 'none' ? 'block' : 'none'; syncChip(); } });
  // Q: horn (in a car — friends hear it) · N: give $10 to the closest friend within 3 m
  addEventListener('keydown', (e) => {
    if (!V || e.repeat || V.ctx.state !== 'playing' || V.dialog) return;
    if (e.code === 'KeyQ' && V.ctx.vehicles?.mounted?.spec?.car) { const p = V.ctx.vehicles.mounted.pos; horn(1); V.ctx.net?.send?.('horn', { p: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] }); }
    if (e.code === 'KeyN') giveCash();
    if (e.code === 'KeyJ') offerPistol();
    if (e.code === 'KeyP' && !V.ctx.vehicles?.mounted && !V.riding && !V.passenger && !V.piss) startPiss();
  });
  // START FRESH (pause menu): everyone in the room goes back to square one
  ctx.bus.on('playerRespawn', () => { if (!V) return; let n = V.inv.filter((x) => x === 'drone').length; while (n < 2 && V.inv.length < MAX_INV) { V.inv.push('drone'); n++; } renderCash(); });   // every life: back up to two drones
  ctx.bus.on('net:fresh', (m) => { if (!V) return; V.ctx.hud?.toast?.(`${V.ctx.net?.peer?.(m.f)?.name || 'A friend'} started everyone fresh`, 2400); V.ctx.bus.emit('worldReset', { by: m.f }); });
  ctx.bus.on('worldReset', () => {
    if (!V) return; const { ctx } = V; closeDialog();
    V.cash = V.startCash; V.inv.length = 0; V.inv.push('bic', 'cigs', 'drone', 'drone', ...(V.starter || [])); V.drunk = 0; V.drunkT = -1; V.high = 0; V.highT = -1; V.magicT = 0; V.tripT = 0; V.rushT = 0; if (V.ctx?.player) V.ctx.player.rush = 0; endTrip(); V.status = {}; V.iceT = null; V.cigLeft = 0; V.left = {}; renderCash();
    for (const H of V.hurtables) { H.down = false; H.hp = 100; H.k = 0; const b = H.fig.body || H.fig.group; b.rotation.x = 0; if (H.o.vendor) H.o.vendor.off = false; }
    for (const d of V.drops || []) { try { V.world.scene.remove(d.g || d.mesh || d); } catch {} } if (V.drops) V.drops.length = 0;
    for (const m of V.puddles || []) m.visible = false;
    const p = ctx.player, os = V.world.W.onlineStart; if (p) { if (p.dead) { try { p.respawn?.(); } catch {} } if (os) p.teleport?.(os[0], os[1] || 0, os[2], os[3] || 0, 0); p.heal?.(); if (p.mounted?.dialog) p.mounted = null; }
  });
  ctx.bus.on('net:piss', (m) => { if (!V || !Array.isArray(m.p)) return; puddle(new THREE.Vector3(m.p[0], m.p[1], m.p[2])); const me = V.ctx.player.position; if (Math.hypot(me.x - m.p[0], me.z - m.p[2]) < 25) V.ctx.hud?.toast?.(`${V.ctx.net?.peer?.(m.f)?.name || 'Somebody'} is taking a leak. Classy.`, 1800); });
  ctx.bus.on('net:horn', (m) => { if (!V || !Array.isArray(m.p)) return; const me = V.ctx.player.position; const d = Math.hypot(me.x - m.p[0], me.z - m.p[2]); if (d < 160) horn(Math.max(0.08, 1 - d / 160)); });
  ctx.bus.on('net:gunoffer', (m) => onGunOffer(m));
  ctx.bus.on('net:gunpaid', (m) => { if (!V || m?.to !== V.ctx.net?.id) return; api.earn(PISTOL_PRICE); V.ctx.hud?.toast?.(`${V.ctx.net?.peer?.(m.f)?.name || 'Your friend'} paid $${PISTOL_PRICE} for the ${String(m.g || 'pistol').toUpperCase()}`, 2200); });
  ctx.bus.on('net:gunno', (m) => { if (V && m?.to === V.ctx.net?.id) V.ctx.hud?.toast?.(`${V.ctx.net?.peer?.(m.f)?.name || 'They'} passed on the pistol`, 1600); });
  ctx.bus.on('net:cash', (m) => {
    if (!V || !m || m.to !== V.ctx.net?.id || m.n !== CASH_GIFT) return;
    const peer = V.ctx.net?.peer?.(m.f), me = V.ctx.player;
    // Balances still belong to clients; a received message cannot prove a remote debit.
    if (!peer?.pos || peer.dead || peer.afk || !me || me.dead || !(peer.pos.distanceTo(me.position) <= GIFT_RECEIVE_RANGE)) return;
    api.earn(CASH_GIFT); V.ctx.hud?.toast?.(`${peer.name || 'A friend'} gave you $${CASH_GIFT}`, 2000);
  });
  // bonus cash: every wave you get through pays everyone $15
  ctx.bus.on('wave', (w) => { if (!V || !(w?.n > 1) || w.n === V.lastWave) return; const was = V.lastWave; V.lastWave = w.n; if (was) { api.earn(15); V.ctx.hud?.toast?.('Wave survived · +$15', 1800); } });
}

// ---------------------------------------------------------------------------------------------------------------------------
// ---- P: take a leak (a stream, then a puddle friends can see). Somebody nearby usually has an opinion. ----
const PISS_T = 3.2, SNARK = ['"Yo! Not on my block!"', '"Animal! In my day we used the Aquarium!"', '"Bro. BRO."', '"I\'m telling the super."', '"Classic stairwell move."'];
function startPiss() {
  const { ctx } = V; const p = ctx.player; if (!p || p.dead) return;
  if (!V.stream) { const m = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 5, 4), new THREE.MeshStandardMaterial({ color: 0xe8d44a, roughness: 0.1, transparent: true, opacity: 0.8 }), 26); m.frustumCulled = false; V.world.scene.add(m); V.stream = m; }
  const fx = -Math.sin(p.yaw || 0), fz = -Math.cos(p.yaw || 0);
  V.piss = { t: 0, o: new THREE.Vector3(p.position.x + fx * 0.18, p.position.y + 0.92, p.position.z + fz * 0.18), f: new THREE.Vector3(fx, 0, fz), done: false };
  V.stream.visible = true; ctx.hud?.toast?.('Ahhh…', 1400);
}
const _pm = new THREE.Matrix4();
function updatePiss(dt) {
  const P = V.piss; if (!P) return; P.t += dt; const m = V.stream;
  const k = Math.min(1, P.t / 0.4) * (P.t > PISS_T - 0.5 ? Math.max(0, (PISS_T - P.t) / 0.5) : 1), v0 = 1.5 * k;   // arc builds up, dribbles out
  for (let i = 0; i < 26; i++) { const t = ((i / 26) + P.t * 2.2) % 1 * 0.55; const x = P.o.x + P.f.x * v0 * t, z = P.o.z + P.f.z * v0 * t, y = P.o.y + 0.5 * t * v0 * 0.4 - 4.9 * t * t; _pm.makeTranslation(x, Math.max(P.o.y - 0.9, y), z); m.setMatrixAt(i, _pm); }
  m.instanceMatrix.needsUpdate = true;
  if (!P.done && P.t > 1.2) { P.done = true; const at = new THREE.Vector3(P.o.x + P.f.x * 0.55, P.o.y - 0.9, P.o.z + P.f.z * 0.55); puddle(at); V.ctx.net?.send?.('piss', { p: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)] });
    const me = V.ctx.player.position; const near = (V.ctx.world?.mapThugs?.() || []).some(([x, z]) => Math.hypot(x - me.x, z - me.z) < 8) || V.vendors.some((v) => v.pos.distanceTo(me) < 8);
    if (near) V.ctx.hud?.toast?.(SNARK[Math.floor(Math.random() * SNARK.length)], 2200); }
  if (P.t >= PISS_T) { V.piss = null; m.visible = false; }
}
function puddle(at) {
  if (!V.puddles) { V.puddles = []; V.puddleN = 0; const g = new THREE.CircleGeometry(0.34, 18); g.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) { const mm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd9c23a, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.5, depthWrite: false })); mm.visible = false; mm.renderOrder = 2; V.world.scene.add(mm); V.puddles.push(mm); } }
  const mm = V.puddles[V.puddleN++ % V.puddles.length]; mm.position.set(at.x, at.y + 0.015, at.z); mm.scale.set(1 + Math.random() * 0.5, 1, 0.7 + Math.random() * 0.4); mm.rotation.y = Math.random() * 6; mm.visible = true;
}
// ---- anybody can get stabbed / shot: named NPCs take hits, go down (dropping some cash), get back up ~90 s later ----
const OUCH = ['AAH! Are you crazy?!', 'Ow! What is wrong with you?!', 'Help! He\'s got a knife!', 'Yo, chill! CHILL!', 'Bozhe moi!'];
function hurtable(fig, o = {}) {
  const { ctx } = V; const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.75, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hb.position.y = 0.9; hb.userData.surface = 'flesh'; fig.group.add(hb); ctx.raycastTargets.push(hb);
  const H = { fig, o, hp: 100, down: false, t: 0, k: 0, said: 0 };
  hb.userData.onHit = (dmg, head, point) => hurtNpc(H, dmg * (head ? 1.6 : 1), point);
  V.hurtables.push(H); return H;
}
function hurtNpc(H, dmg, point) {
  const { ctx } = V; if (H.down) return; H.hp -= dmg; H.fig.play?.('hit');
  const at = H.fig.group.getWorldPosition(new THREE.Vector3()); ctx.ai?.blood?.(at.x, at.z, 0.35 + Math.random() * 0.3, at.y + 0.5);
  if (performance.now() - H.said > 1500) { H.said = performance.now(); ctx.hud?.toast?.(`${H.o.name || 'Someone'}: "${OUCH[Math.floor(Math.random() * OUCH.length)]}"`, 1500); }
  const dead = H.hp <= 0; ctx.bus.emit('npcHurt', { name: H.o.name, dead, position: at });
  if (dead) { H.down = true; H.t = 0; if (H.o.vendor) { H.o.vendor.off = true; if (V.dialog?.vendor === H.o.vendor) closeDialog(); }
    dropCash(at.clone().add(new THREE.Vector3(0.6, 0, 0.4)), 10 + Math.floor(Math.random() * 5) * 5); ctx.hud?.toast?.(`${H.o.name || 'They'} went down.`, 1800); }
}
function updateHurt(dt) {
  for (const H of V.hurtables) {
    if (!H.down && H.k <= 0) continue;
    if (H.down) { H.t += dt; H.k = Math.min(1, H.k + dt * 2.4); if (H.t > 90) { H.down = false; H.hp = 100; if (H.o.vendor) H.o.vendor.off = false; V.ctx.hud?.toast?.(`${H.o.name} is back on their feet — and holding a grudge.`, 1800); } }
    else H.k = Math.max(0, H.k - dt * 1.5);
    const b = H.fig.body || H.fig.group; b.rotation.x = -Math.PI / 2 * (1 - (1 - H.k) ** 2);   // crumple backwards / get back up
  }
}
function updateIce(dt) {
  if (!V.inv.includes('ice')) { V.iceT = null; return; }
  if (V.iceT == null) V.iceT = ITEMS.ice.melt;
  if (V.ctx.state === 'playing') V.iceT -= dt;
  if (V.iceT <= 0) { V.iceT = null; const k = V.inv.indexOf('ice'); if (k > -1) V.inv.splice(k, 1); renderCash(); V.ctx.hud?.toast?.('Лёд растаял. В пакете — лужа. «Брат, а где обещанный лёд?»', 3200); return; }
  const pct = Math.round(V.iceT / ITEMS.ice.melt * 100); if (pct !== V.icePct) { V.icePct = pct; renderCash(); }
}
function update(dt) {
  const { ctx } = V; const p = ctx.player; if (!p) return;
  const playing = ctx.state === 'playing' && !p.dead;
  updateHigh(dt); updatePuffs(dt); updateJoint(dt); updateDrops(dt, playing); updatePiss(dt); updateHurt(dt); updateIce(dt);
  for (const fn of V.onUpdate) { try { fn(dt, playing); } catch (e) { if (ctx.time.frame % 300 === 1) console.warn('[hangkit] map update', e); } }
  if (V.ownLabel && (V.dialog || V.riding || V.passenger || !playing)) { ctx.actionLabel = null; V.ownLabel = false; }   // no stale touch label while busy
  if (V.dialog) { if (!playing) closeDialog(); else { ctx.interactNear = true; faceVendor(dt); } return; }
  if (playing && ctx.input?.pressed?.has?.('KeyB') && (V.riding || V.passenger || ctx.vehicles?.mounted)) { ctx.input.pressed.delete('KeyB'); useItem(); }
  if (V.riding) return updateRide(dt);
  if (V.passenger) return updatePassenger(dt);
  if (!playing) return;
  const F = ctx.input?.pressed?.has?.('KeyF');
  if (ctx.input?.pressed?.has?.('KeyB')) { ctx.input.pressed.delete('KeyB'); useItem(); }   // B = blaze / drink, anywhere
  const pos = p.position; const near = (v, r, dy = 1.3) => Math.hypot(v.x - pos.x, v.z - pos.z) < r && Math.abs(v.y - pos.y) < dy;
  let prompt = null, act = null;
  if (!ctx.vehicles?.mounted && !p.mounted?.ferry && !p.mounted?.uber) {   // (on the ferry F is the ferry's: the bar, getting off; in an Uber, getting out)
    // the closest vendor / interaction point wins (walkers pass by the mangal, the deli counter, …)
    let bd = Infinity; const dist = (v) => Math.hypot(v.x - pos.x, v.z - pos.z);
    for (const v of V.vendors) if (!v.off && near(v.pos, v.r) && dist(v.pos) < bd) { bd = dist(v.pos); prompt = `F — TALK TO ${v.name}`; act = () => talk(v); }
    for (const s of V.spots) if (!(s.low && prompt) && (!s.when || s.when()) && near(s.pos, s.r, s.dy) && dist(s.pos) < bd) { bd = dist(s.pos); prompt = typeof s.prompt === 'function' ? s.prompt() : s.prompt; act = s.act; }
    for (let i = 0; i < V.shafts.length && !act; i++) {
      const t = V.shafts[i], up = t.kind === 'stairs' ? 'F — CLIMB ▲' : `F — ELEVATOR ▲ ${t.floors}`, dn = t.kind === 'stairs' ? 'F — GO DOWN ▼' : 'F — ELEVATOR ▼ LOBBY';
      t.lobby.cars.forEach((c, k) => { if (!act && near(c.pos, t.r || 1.4)) { prompt = t.label ? `${up} · ${t.label}` : up; act = () => callElevator(i, k, 'up'); } });
      t.tops.forEach((side, si) => side.cars.forEach((c, k) => { if (!act && near(c.pos, t.r || 1.4)) { prompt = dn; act = () => callElevator(i, k, 'down', si); } }));
    }
    if (!act) { const c = nearestParked(3.0); if (c) { prompt = c.gpsGone ? 'F — STEAL CAR' : 'F — STEAL CAR  ·  X — SWIPE THE GPS'; act = () => steal(c);
      if (!c.gpsGone && ctx.input?.pressed?.has?.('KeyX')) { ctx.input.pressed.delete('KeyX'); swipeGps(c); } } }
    { const f = nearestFriendCar(3.8); if (f && (!act || dist(f.pos) < bd)) { prompt = `F — HOP IN WITH ${f.name}`; act = () => enterPassenger(f.id); } }   // a friend's car beats anything further away
  }
  ctx.interactNear = !!act;   // next frame's weapons.js leaves F alone while a prompt is up
  ctx.interactPrompt = prompt;   // VR's action button (src/vr/vr.js) shows it
  V.promptT -= dt;
  if (prompt && !ctx.isTouch && (prompt !== V.lastPrompt || V.promptT <= 0)) { ctx.hud?.toast?.(prompt, 700); V.promptT = 0.4; }   // phones: the big action button already shows it
  if (ctx.isTouch) { if (prompt) { ctx.actionLabel = prompt.replace(/^F\s*[—-]\s*/, '').split('  ·')[0]; V.ownLabel = true; } else if (V.ownLabel) { ctx.actionLabel = null; V.ownLabel = false; } }   // phones: the action button (touch.js) names it, a tap = F
  V.lastPrompt = prompt || '';
  if (F && act) { ctx.input.pressed.delete('KeyF'); act(); }
}

// ---- stash ----------------------------------------------------------------------------------------------------------------
/** B: use the newest thing you hold. Weed = lifted/blurry (~2.5 min), liquor / 40 = drowsy; friends within a few metres share it. */
/** the car you're in, named by its driver's net id — everyone in one car shares, however laggy the positions are at 100 km/h */
function carId() { const ctx = V.ctx; return ctx.vehicles?.mounted?.spec?.car ? ctx.net?.id || null : V.passenger?.id || null; }
function sameCar(m) { const c = carId(); return !!(m.c && c && m.c === c); }
function useItem(want) {
  const { ctx } = V; const k = want ? (ITEMS[want]?.keep ? -1 : V.inv.lastIndexOf(want)) : V.inv.map((x) => !ITEMS[x]?.keep).lastIndexOf(true);
  if (k < 0) { ctx.hud?.toast?.(V.inv.length ? 'Raw meat — grill it at Table Park' : 'Nothing on you', 1400); return; }
  const it = V.inv.splice(k, 1)[0]; renderCash();
  V.smokeKind = it;
  if (it === 'weed') return lightUp(false, false, 0.22);
  if (ITEMS[it]?.hi) return lightUp(false, false, ITEMS[it].hi);
  if (ITEMS[it]?.cig) { const L = V.left || (V.left = {}); L[it] = (L[it] > 0 ? L[it] : ITEMS[it].cig) - 1; if (L[it] > 0) { V.inv.splice(k, 0, it); renderCash(); } return lightUp(false, true); }   // one out of the pack
  if (ITEMS[it]?.drone) { import('./drones.js').then((m) => { if (!m.launchDrone(ctx)) { V.inv.push(it); renderCash(); } }).catch((e) => console.warn('[hangkit] drone', e)); return; }   // one up at a time: a refused launch goes back in the bag
  if (ITEMS[it]?.rush) { V.drunk = Math.max(0, (V.drunk || 0) - 0.35); V.rushT = ITEMS[it].rush; if (ctx.player) ctx.player.rush = V.rushT; ctx.hud?.toast?.('*sniff* …OKAY. Okay okay okay. Who wants darts? I\'ll play everybody.', 2800); return; }
  if (ITEMS[it]?.trip) { V.tripT = ITEMS[it].trip; V.tripMax = V.tripT; ctx.hud?.toast?.('*chews* …земля дышит. The ground is breathing, bro.', 3000); return; }
  if (it === 'spliff') { V.magicT = 90; ctx.hud?.toast?.('«Заклинанье?» — «Затянись. Тут колдуют без слов!»', 2600); return lightUp(true); }
  const spec = ITEMS[it];
  if (spec?.food) { ctx.player?.heal?.(spec.food); ctx.hud?.toast?.(spec.milk ? 'Зебровое молоко. Редко одобряет. (+' + spec.food + ' HP)' : '*хрум* Виски-шмиски, вот сосиски! (+' + spec.food + ' HP)', 2000); return; }
  drink(true, ITEMS[it], it);
}
function drink(mine, spec = ITEMS.bottle, kind = 'bottle') {
  const { ctx } = V; V.drunk = Math.min(1, (V.drunk || 0) + spec.drunk); V.drunkT = Math.max(V.drunkT, spec.dur);
  if (!mine) return;
  const p = ctx.player.position; ctx.net?.send?.('drink', { k: kind, p: [+p.x.toFixed(2), +(p.y + 1.5).toFixed(2), +p.z.toFixed(2)], c: carId() });
  ctx.hud?.toast?.(kind === 'forty' ? '*glug glug glug* …that malt hits' : '*glug glug*', 1600);
  const m = bottleModel(kind);
  ctx.camera.add(m); m.visible = true; if (ctx.weapons?.viewmodel) ctx.weapons.viewmodel.visible = false;
  clearTimeout(V.bottleT); V.bottleT = setTimeout(() => { m.visible = false; if (ctx.weapons?.viewmodel && V.smokeT <= 0) ctx.weapons.viewmodel.visible = true; }, 2600);
}
const _models = {};
/** a drink to hold in a VR hand (a fresh copy, upright at the origin); null for anything that isn't drunk */
function itemModel(kind) {
  const I = ITEMS[kind]; if (!I || !(I.drunk || I.glass || I.milk || kind === 'kvass')) return null;
  const m = bottleModel(kind).clone(); m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.visible = true; return m;
}
function bottleModel(kind) {
  if (_models[kind]) return _models[kind];
  const g = new THREE.Group();
  const G2 = ITEMS[kind]?.glass;
  if (G2 === 'can') {   // a tallboy: 0.5 l can, blue with a silver lid
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.17, 16), new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.35, metalness: 0.7 })); g.add(can);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.033, 0.012, 16), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.9 })); lid.position.y = 0.091; g.add(lid);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.5 })); band.position.y = 0.01; g.add(band);
    g.position.set(0.1, -0.14, -0.3);
  } else if (G2) {   // coupe (Manhattan, cherry), pint (Guinness, cream head), shot (Jameson)
    const gl = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.35 });
    const liq = new THREE.MeshStandardMaterial({ color: ITEMS[kind]?.liq ?? (G2 === 'pint' ? 0x1a0d06 : G2 === 'coupe' ? 0x8a3a10 : 0xb86a18), roughness: 0.1, transparent: true, opacity: 0.9 });
    if (G2 === 'coupe') { g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 8), gl)); const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.01, 0.045, 16, 1, true), gl); cup.position.y = 0.06; g.add(cup); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.012, 0.03, 16), liq); l.position.y = 0.055; g.add(l); const ch = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshStandardMaterial({ color: 0x7a0a14 })); ch.position.set(0.01, 0.072, 0); g.add(ch); }
    else if (G2 === 'pint') { const pg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.034, 0.15, 16, 1, true), gl); g.add(pg); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.033, 0.12, 16), liq); l.position.y = -0.012; g.add(l); const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.038, 0.022, 16), new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.8 })); hd.position.y = 0.058; g.add(hd); }
    else { const sg = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.055, 12, 1, true), gl); g.add(sg); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.019, 0.03, 12), liq); l.position.y = -0.01; g.add(l); }
    g.position.set(0.1, -0.13, -0.3);
  } else if (kind === 'forty') {   // 40 oz in a brown paper bag
    const bag = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 1 }), glass = new THREE.MeshPhysicalMaterial({ color: 0x3a2208, roughness: 0.1, transparent: true, opacity: 0.85 });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.04, 0.2, 10), bag); b.scale.set(1, 1, 0.8); g.add(b);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.1, 10), glass); n.position.y = 0.14; g.add(n);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 10), new THREE.MeshStandardMaterial({ color: 0xc8a030, metalness: 0.8, roughness: 0.3 })); cap.position.y = 0.195; g.add(cap);
    g.position.set(0.1, -0.15, -0.32);
  } else {
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x5a3a12, roughness: 0.1, transparent: true, opacity: 0.8 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12), glass)); const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.016, 0.07, 10), glass); neck.position.y = 0.1; g.add(neck);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xe8dcc0 }))); g.position.set(0.1, -0.12, -0.3);
  }
  g.rotation.set(0.9, 0, -0.3); return (_models[kind] = g);
}

// ---- smoking + the high ---------------------------------------------------------------------------------------------------------
function lightUp(magic = false, cig = false, hi = 0) {
  const { ctx } = V; (V.smokes || (V.smokes = [])).push(performance.now()); if (V.smokes.length > 8) V.smokes.shift();   // darts.js: a few smokes and your hand shakes
  V.smokeT = magic ? 16 : cig ? 9 : 11 + hi * 8; V.puffT = 0.6; V.cig = cig; if (magic) { V.high = Math.min(1, V.high + 0.35); V.highT = Math.max(V.highT, 180); }
  V.smokeHi = hi || 0.22;   // per puff: a bag 0.22, a blunt 0.4
  ctx.hud?.toast?.(cig ? ['*chk* …a Marlboro on the boardwalk', 'Покурим. Одну.', '*tap tap* …ahh'][Math.floor(Math.random() * 3)] : '…', 1400);
  const kind = V.smokeKind === 'vape' ? 'vape' : V.smokeKind === 'blunt' ? 'blunt' : cig ? 'cig' : 'spliff';
  if (V.joint?.g) V.joint.g.parent?.remove(V.joint.g);
  V.smokeModels = V.smokeModels || {}; V.joint = V.smokeModels[kind] || (V.smokeModels[kind] = smokeModel(kind, ctx)); V.smokeLen = V.smokeT;
  ctx.camera.add(V.joint.g); V.joint.g.visible = true;
  if (ctx.weapons?.viewmodel) ctx.weapons.viewmodel.visible = false;
}
// hand-rolled smokes, close to the camera: cig (printed paper, cork filter, ash), spliff (cone, twisted tip, crutch),
// blunt (brown leaf wrap), vape (pen with a glowing LED). Each burns down over the smoke (burn(k), k = 1 → 0.35).
function smokeTex(draw, w = 128, h = 32) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function smokeModel(kind, ctx) {
  const g = new THREE.Group(), along = (geo) => { geo.rotateZ(-Math.PI / 2); return geo; };   // everything along +x (tip) … -x (mouth)
  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const emb = new THREE.MeshBasicMaterial({ color: 0xff6a20 }), ash = mat({ color: 0x8d8a86, roughness: 1 });
  let body, L, R0, R1, tipX;
  if (kind === 'vape') {
    const dev = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.016, 0.022), mat({ color: 0x1f3d52, metalness: 0.6, roughness: 0.35 })); g.add(dev);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, 0.014), mat({ color: 0x111111 })); mouth.position.x = -0.045; g.add(mouth);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.012), emb); led.position.set(0.038, 0, 0); g.add(led);
    g.position.set(-0.12, -0.13, -0.32); g.rotation.set(0.3, 0.6, 0); return { g, ember: led, paper: dev, filter: mouth };
  }
  if (kind === 'cig') { L = 0.062; R0 = R1 = 0.0038;
    const paper = smokeTex((c, w, h) => { c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, w, h); c.fillStyle = '#c9a04a'; c.fillRect(8, 0, 2, h); c.fillStyle = 'rgba(0,0,0,.05)'; for (let x = 0; x < w; x += 3) c.fillRect(x, 0, 1, h); });
    body = new THREE.Mesh(along(new THREE.CylinderGeometry(R1, R0, L, 14, 1, true)), mat({ map: paper })); body.position.x = L / 2; g.add(body);
    const cork = smokeTex((c, w, h) => { c.fillStyle = '#c98a45'; c.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${90 + Math.random() * 60},${50 + Math.random() * 30},20,.55)`; c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } c.fillStyle = '#e8c874'; c.fillRect(w - 6, 0, 3, h); });
    const filter = new THREE.Mesh(along(new THREE.CylinderGeometry(R0, R0, 0.022, 14)), mat({ map: cork })); filter.position.x = -0.011; g.add(filter);
  } else if (kind === 'blunt') { L = 0.1; R0 = 0.0062; R1 = 0.0068;
    const leaf = smokeTex((c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a3a1e'); gr.addColorStop(0.5, '#6e4826'); gr.addColorStop(1, '#4a2e17'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(40,24,10,.6)'; c.lineWidth = 1; for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16 + 22, h); c.stroke(); } for (let i = 0; i < 140; i++) { c.fillStyle = `rgba(20,12,5,${Math.random() * 0.3})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 1); } });
    body = new THREE.Mesh(along(new THREE.CylinderGeometry(R1, R0, L, 16)), mat({ map: leaf, roughness: 0.75 })); body.position.x = L / 2 - 0.01; g.add(body);
  } else { L = 0.085; R0 = 0.0033; R1 = 0.0062;   // spliff / joint: a cone, the paper creased, a cardboard crutch at the mouth
    const paper = smokeTex((c, w, h) => { c.fillStyle = '#efe9da'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(120,110,90,.25)'; for (let i = 0; i < 14; i++) { c.beginPath(); c.moveTo(Math.random() * w, 0); c.lineTo(Math.random() * w, h); c.stroke(); } c.fillStyle = 'rgba(90,120,60,.12)'; for (let i = 0; i < 60; i++) c.fillRect(Math.random() * w, Math.random() * h, 2, 2); });
    body = new THREE.Mesh(along(new THREE.CylinderGeometry(R1, R0, L, 14, 1, true)), mat({ map: paper, transparent: true, opacity: 0.97 })); body.position.x = L / 2; g.add(body);
    const crutch = new THREE.Mesh(along(new THREE.CylinderGeometry(R0, R0, 0.014, 12, 1, true)), mat({ color: 0xd8c9a8, side: THREE.DoubleSide })); crutch.position.x = -0.007; g.add(crutch);
    const twist = new THREE.Mesh(along(new THREE.ConeGeometry(R1 * 0.9, 0.012, 10)), mat({ color: 0xefe9da })); twist.position.x = L + 0.006; g.add(twist); g.userData.twist = twist;
  }
  tipX = L; const tip = new THREE.Group(); g.add(tip);
  const ashM = new THREE.Mesh(along(new THREE.CylinderGeometry(R1 * 0.95, R1, 0.008, 12)), ash); ashM.position.x = 0.004; tip.add(ashM);
  const ember = new THREE.Mesh(new THREE.CircleGeometry(R1 * 0.95, 14), emb); ember.rotation.y = Math.PI / 2; ember.position.x = 0.0085; tip.add(ember);
  const light = null;   // no PointLight: adding a light recompiles every shader in the scene (a long freeze on the first drag)
  const burn = (k) => { const len = L * k; body.scale.set(k, 1, 1); body.position.x = (kind === 'blunt' ? -0.01 : 0) + len / 2; tip.position.x = len + (kind === 'blunt' ? -0.01 : 0); if (g.userData.twist) g.userData.twist.visible = k > 0.97; };
  burn(1); g.position.set(-0.12, -0.13, -0.32); g.rotation.set(0.3, 0.6, 0.05);
  return { g, ember, paper: body, filter: body, light, burn };
}
function updateJoint(dt) {
  if (V.smokeT <= 0) return; const { ctx } = V;
  V.smokeT -= dt; V.puffT -= dt;
  if (V.joint) { const t = performance.now(), k = Math.max(0.35, V.smokeT / (V.smokeLen || 1)); V.joint.ember.material.color.setHSL(0.05, 1, 0.42 + 0.18 * Math.sin(t / 160) * (V.puffT > 1.2 ? 1 : 0.4)); if (V.joint.light) V.joint.light.intensity = 0.25 + 0.2 * Math.sin(t / 90); if (V.joint.burn) V.joint.burn(k); V.joint.g.visible = !ctx.vehicles?.mounted; }   // ember glows on the drag, it burns down   // driving: no floating joint in the chase view
  if (V.puffT <= 0) {
    V.puffT = 1.6 + Math.random() * 0.8;
    const cam = ctx.camera; const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    let at = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.45).add(new THREE.Vector3(0, -0.08, 0));
    const car = ctx.vehicles?.mounted; let hotbox = false;
    if (car) {   // in the whip: the smoke rolls out of the driver's window (not off the chase camera) and the car hotboxes
      const h = car.heading; at = car.pos.clone().add(new THREE.Vector3(-Math.cos(h) * 0.95 - Math.sin(h) * 0.2, car.spec?.car ? 1.25 : 1.5, Math.sin(h) * 0.95 - Math.cos(h) * 0.2)); hotbox = !!car.spec?.car;
    }
    puff(at); ctx.net?.send?.('smoke', { p: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)], c: carId(), k: V.cig ? 'cig' : undefined });
    if (hotbox) growHaze(car, V.cig ? 0.1 : 0.2);   // builds the cabin haze (vehicledamage.js) only while every window's up
    if (!V.cig) { const k = V.smokeHi || 0.22; V.high = Math.min(1, V.high + (hotbox ? k * 1.35 : k)); V.highT = Math.max(V.highT, 110 + k * 180); }
  }
  if (V.smokeT <= 0) { if (V.joint) V.joint.g.visible = false; if (ctx.weapons?.viewmodel) ctx.weapons.viewmodel.visible = true; ctx.hud?.toast?.(V.cig ? 'Flick. The butt goes into the sand.' : '…everything is glowing.', 2400); V.cig = false; }
}
function updateHigh(dt) {
  const { ctx } = V; const cv = ctx.canvas; if (!cv) return;
  if (V.tripT > 0) { V.tripT -= dt; return trip(cv, dt); } else if (V.tripFx) { endTrip(); cv.style.filter = ''; cv.style.transform = ''; }
  if (V.rushT > 0) { V.rushT -= dt; if (ctx.player) ctx.player.rush = V.rushT; if (V.rushT <= 0) { V.high = Math.min(1, V.high + 0.15); V.highT = Math.max(V.highT, 45); ctx.hud?.toast?.('…the crash. Everything is too loud. Sit down.', 2600); } }
  if (V.highT > 0) { V.highT -= dt; if (V.highT < 40) V.high = Math.max(0, V.high - dt / 40); }
  if (V.drunkT > 0) { V.drunkT -= dt; if (V.drunkT < 30) V.drunk = Math.max(0, V.drunk - dt / 30); } else V.drunk = 0;
  const k = V.high, d = V.drunk || 0;
  if (V.status?.crabs && ctx.state === 'playing' && ctx.player && !ctx.player.dead) { V.itchT = (V.itchT ?? 3) - dt; if (V.itchT <= 0) { V.itchT = 2.5 + Math.random() * 4; ctx.player.yaw += (Math.random() - 0.5) * 0.35; ctx.player.pitch += (Math.random() - 0.5) * 0.2; if (Math.random() < 0.4) ctx.hud?.toast?.(['*scratch scratch*', 'why is it so itchy down there', '*SCRATCH*', 'Sammy has lotion…'][Math.floor(Math.random() * 4)], 1100); } }
  if (k <= 0.001 && d <= 0.001) { const sh = V.status?.shades ? 'brightness(0.82) contrast(1.08) sepia(0.18)' : ''; if (cv.style.filter !== sh) { cv.style.filter = sh; cv.style.transform = ''; } return; }
  const t = performance.now() / 1000;
  if (V.magicT > 0) V.magicT -= dt;
  // weed: soft blur, saturated, slow hue drift + gentle wobble · liquor: heavy-lidded (darker, desaturated), double vision, big slow sway
  const blur = 2.6 * k + 3.4 * d * (0.55 + 0.45 * Math.sin(t * 0.7));
  const ghost = d > 0.05 ? ` drop-shadow(${(22 * d * Math.sin(t * 0.9)).toFixed(1)}px ${(7 * d * Math.cos(t * 0.6)).toFixed(1)}px 0 rgba(255,255,255,${(0.4 * d).toFixed(2)}))` : '';
  cv.style.filter = `blur(${blur.toFixed(2)}px) saturate(${(1 + 0.45 * k - 0.35 * d).toFixed(2)}) brightness(${(1 - 0.32 * d * (0.7 + 0.3 * Math.sin(t * 0.4))).toFixed(2)}) contrast(${(1 - 0.06 * k).toFixed(3)}) hue-rotate(${(V.magicT > 0 ? (t * 40) % 360 * Math.min(1, V.magicT / 20) + Math.sin(t * 0.3) * 8 * k : Math.sin(t * 0.3) * 8 * k).toFixed(1)}deg)${ghost}`;
  cv.style.transform = `rotate(${(Math.sin(t * 0.55) * 0.8 * k + Math.sin(t * 0.33) * 6 * d).toFixed(3)}deg) scale(${(1 + 0.025 * k + 0.07 * d + Math.sin(t * 0.9) * 0.012 * (k + d)).toFixed(4)}) translate(${(Math.sin(t * 0.37) * 14 * d).toFixed(1)}px, ${(Math.sin(t * 0.5) * 12 * d).toFixed(1)}px)`;
  // drunk: the view drifts on its own and your aim swims — you fight it with the mouse
  const p = ctx.player; if (d > 0.05 && p && !p.dead && ctx.state === 'playing') { p.yaw += Math.sin(t * 0.62) * 0.35 * d * dt; p.pitch += Math.sin(t * 0.47 + 1.3) * 0.12 * d * dt; }
}
// mushrooms (Felip's — the strongest thing in the game): onset → peak → comedown over two minutes. Screen: colour cycling,
// rainbow double vision, breathing / swaying, a kaleidoscope wash. World: glowing shapes drift round you. Sound: a low drone.
// Mind: stray thoughts. Everything is torn down when it ends (or on world reset).
const TRIP_THOUGHTS = ['The Wonder Wheel is winking at you.', 'The babushkas are singing in five-part harmony.', 'You understand durak on a molecular level.', 'The towers are breathing. In… out…', 'Felip was right about the mycelium.', 'Every brick has a name. That one is Gennady.', 'You can hear the F train thinking.', 'The ocean is just very slow applause.'];
function trip(cv, dt = 1 / 60) {
  const t = performance.now() / 1000, el = V.tripMax - V.tripT, e = Math.max(0, Math.min(1, el / 15, V.tripT / 20)), peak = Math.max(0, Math.min(1, (el - 15) / 10, (V.tripT - 20) / 10));
  const F = V.tripFx || (V.tripFx = tripFx());
  // smooth, slow changes only: no per-frame drop-shadows or brightness pulses on the canvas (they read as the screen blinking,
  // and some GPUs / headsets flash on them); colour drifts round the wheel over ~20 s, the overlays breathe slowly
  F.ov.style.opacity = (0.18 * e + 0.08 * peak * (0.5 + 0.5 * Math.sin(t * 0.35))).toFixed(3); F.ov.style.transform = `rotate(${(t * 8) % 360}deg) scale(${1.1 + 0.08 * Math.sin(t * 0.3)})`;
  F.kal.style.opacity = (0.1 * peak).toFixed(3); F.kal.style.transform = `rotate(${(-t * 4) % 360}deg) scale(${1.4 + 0.1 * Math.sin(t * 0.2)})`;
  const ff = `saturate(${(1 + 1.4 * e).toFixed(2)}) contrast(${(1 + 0.12 * e).toFixed(2)}) hue-rotate(${((t * (14 + 10 * peak)) % 360 * e).toFixed(0)}deg)`; if (cv.style.filter !== ff) cv.style.filter = ff;
  cv.style.transform = `perspective(900px) rotateX(${(Math.sin(t * 0.21) * 2 * peak).toFixed(2)}deg) rotateY(${(Math.cos(t * 0.17) * 2.5 * peak).toFixed(2)}deg) rotate(${(Math.sin(t * 0.3) * 1.5 * e).toFixed(2)}deg) scale(${(1 + 0.04 * e + Math.sin(t * 0.5) * 0.015 * e).toFixed(4)})`;
  // glowing shapes drifting round you
  const me = V.ctx.player?.position; if (me) F.orbs.forEach((o, i) => { const a = t * (0.2 + i * 0.013) + i * 2.4, r = 3 + (i % 5) * 1.6; o.position.set(me.x + Math.cos(a) * r, me.y + 1.2 + Math.sin(t * 0.7 + i) * 1.4 + (i % 3), me.z + Math.sin(a) * r); o.material.opacity = 0.75 * peak; o.material.color.setHSL(((t * 0.1 + i * 0.07) % 1), 1, 0.6); const k = 0.35 + 0.25 * Math.sin(t * 2 + i); o.scale.set(k, k, k); });
  if (F.gain) F.gain.gain.value = 0.05 * e; if (F.osc) F.osc.frequency.value = 55 + 8 * Math.sin(t * 0.3);
  F.thT -= dt; if (peak > 0.5 && F.thT < 0) { F.thT = 10 + Math.random() * 8; V.ctx.hud?.toast?.(TRIP_THOUGHTS[(Math.random() * TRIP_THOUGHTS.length) | 0], 3000); }
  const p = V.ctx.player; if (p && !p.dead && V.ctx.state === 'playing') p.yaw += Math.sin(t * 0.5) * 0.15 * e * dt;
}
function tripFx() {
  const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:-25%;pointer-events:none;z-index:5;mix-blend-mode:overlay;background:conic-gradient(from 0deg,#ff0080,#ffcc00,#00ff88,#00c8ff,#b000ff,#ff0080);filter:blur(30px)'; document.body.appendChild(ov);
  const kal = document.createElement('div'); kal.style.cssText = 'position:fixed;inset:-40%;pointer-events:none;z-index:5;mix-blend-mode:screen;background:repeating-conic-gradient(from 0deg,rgba(255,0,150,.5) 0 15deg,rgba(0,220,255,.45) 15deg 30deg,rgba(255,220,0,.4) 30deg 45deg);filter:blur(6px)'; document.body.appendChild(kal);
  const orbs = []; const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  for (let i = 0; i < (V.ctx.lite ? 14 : 30); i++) { const o = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); V.world.scene.add(o); orbs.push(o); }
  let osc = null, gain = null; try { const ac = V.ctx.audio?.context; if (ac) { osc = ac.createOscillator(); osc.type = 'sine'; gain = ac.createGain(); gain.gain.value = 0; osc.connect(gain); gain.connect(ac.destination); osc.start(); } } catch {}
  return { ov, kal, orbs, osc, gain, thT: 6 };
}
function endTrip() {
  const F = V?.tripFx; if (!F) return; F.ov.remove(); F.kal.remove(); for (const o of F.orbs) V.world.scene.remove(o); try { F.osc?.stop(); F.gain?.disconnect(); } catch {} V.tripFx = null; const cv = V.ctx.canvas; if (cv) { cv.style.filter = ''; cv.style.transform = ''; }
}
function buildPuffs() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(235,235,230,0.55)'); gr.addColorStop(1, 'rgba(235,235,230,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  V.puffTex = new THREE.CanvasTexture(c);
}
function puff(at) {
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: V.puffTex, transparent: true, depthWrite: false, opacity: 0.6 }));
    s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, Math.random() * 0.1, (Math.random() - 0.5) * 0.15)); s.scale.setScalar(0.25);
    V.world.scene.add(s); V.puffs.push({ s, t: 0, life: 3.5 + Math.random() * 2, v: new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.25) });
  }
}
function updatePuffs(dt) {
  for (let i = V.puffs.length - 1; i >= 0; i--) { const q = V.puffs[i]; q.t += dt; q.s.position.addScaledVector(q.v, dt); q.s.scale.setScalar(0.25 + q.t * 0.55); q.s.material.opacity = 0.55 * (1 - q.t / q.life); if (q.t >= q.life) { V.world.scene.remove(q.s); q.s.material.dispose(); V.puffs.splice(i, 1); } }
}

// ---- vendors + dialogue ---------------------------------------------------------------------------------------------------------
function talk(v) { const node = v.talk(api, V.talked.has(v.name)); V.talked.add(v.name); openDialog(v.name, node, v); }
function openDialog(name, node, vendor = null) {
  if (!node) return closeDialog();
  const { ctx } = V; const p = ctx.player;
  if (!V.dialog) { p.mounted = { dialog: true }; }
  V.dialog = { name, node, vendor };
  const u = V.ui; u.dname.textContent = name; u.dtext.textContent = node.text;
  u.dch.innerHTML = '';
  (node.choices || [{ label: 'Leave', go: null }]).forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'hkch'; b.innerHTML = `<b>${i + 1}</b> ${c.label}`; const cost = c.cost ?? +(/— \$(\d+)/.exec(c.label)?.[1] || 0); if ((cost && V.cash < cost) || (c.need && !api.has(c.need))) b.classList.add('dim');   // still pickable: the vendor tells you why
    const pick = (e) => { e.preventDefault(); e.stopPropagation(); choose(i); };
    b.addEventListener('touchstart', pick, { passive: false }); b.addEventListener('mousedown', pick); u.dch.appendChild(b);
  });
  u.dlg.classList.add('on');
  try { ctx.audio?.play?.('ui_click'); } catch {}
}
function choose(i) {
  if (!V?.dialog) return; const c = (V.dialog.node.choices || [{ go: null }])[i]; if (!c) return;
  const next = typeof c.go === 'function' ? c.go(api) : c.go;
  if (next) openDialog(V.dialog.name, next, V.dialog.vendor); else closeDialog();
}
function closeDialog() {
  if (!V?.dialog) return; V.dialog = null; V.ui.dlg.classList.remove('on');
  const p = V.ctx.player; if (p?.mounted?.dialog) p.mounted = null;
}
function faceVendor(dt) {   // look toward whoever you're talking to
  const v = V.dialog?.vendor; if (!v) return; const p = V.ctx.player;
  const want = Math.atan2(-(v.pos.x - p.position.x), -(v.pos.z - p.position.z)); let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  p.yaw += d * Math.min(1, dt * 4); p.pitch += (-0.05 - p.pitch) * Math.min(1, dt * 4);
  const cam = V.ctx.camera; cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}
/** shop helper for vendor scripts: pay, hand over, tell friends. Returns the reply node text. */
export function sell(item, price, vendorName, lines = {}) {
  if (api.full()) return lines.full || 'Your hands are full. Use what you got first (B).';
  if (V.cash < price) return lines.broke || `That's $${price}. You got $${V.cash}.`;
  api.pay(price); api.give(item);
  V.ctx.net?.send?.('buy', { k: item, v: vendorName });
  try { V.ctx.audio?.play?.('ui_click'); } catch {}
  return lines.ok || 'Here you go.';
}

// ---- mercenary cash ---------------------------------------------------------------------------------------------------------------
function mercCash(at, hs = false) {
  const bounty = 5 * (1 + Math.floor(Math.random() * 3)) + (hs ? 10 : 0);   // every kill pays $5–15 on the spot, headshots +$10
  api.earn(bounty); V.ctx.hud?.toast?.(`+$${bounty} ${hs ? 'headshot ' : ''}bounty`, 1200);
  if (Math.random() > 0.6) return;   // and most of them carry a wad: $20–50 on the body, walk over it
  dropCash(at, 20 + 5 * Math.floor(Math.random() * 7));
}
let _ac = null;
/** a two-tone car horn (synth: no asset), volume by distance */
function horn(vol) {
  try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)(); const t = _ac.currentTime, g = _ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18 * vol, t + 0.02); g.gain.setValueAtTime(0.18 * vol, t + 0.42); g.gain.linearRampToValueAtTime(0, t + 0.5); g.connect(_ac.destination);
    for (const f of [415, 523]) { const o = _ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = _ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 0.52); } } catch {}
}
// J: sell a friend a pistol for $30 (you keep yours: street guys always have a spare). They get a dialog: buy or pass.
const PISTOL = /^(m9|deagle|makarov|glock|pistol)/i, PISTOL_PRICE = 30;
function offerPistol() {
  const net = V.ctx.net; if (!net?.list || V.ctx.player.dead) return; const me = V.ctx.player.position; let best = null, bd = GIFT_RANGE + 1;
  for (const id of net.list()) { const q = net.peer(id); if (!q?.pos || q.dead || q.afk) continue; const d = q.pos.distanceTo(me); if (d < bd) { bd = d; best = { id, name: q.name }; } }
  const g = (V.ctx.weapons?.bag || []).find((x) => PISTOL.test(x));
  if (!g) { V.ctx.hud?.toast?.('No pistol to sell', 1400); return; }
  if (!best) { V.ctx.hud?.toast?.('Get next to a friend to sell a pistol (J)', 1600); return; }
  net.send('gunoffer', { to: best.id, g, p: PISTOL_PRICE }); V.ctx.hud?.toast?.(`Offered ${best.name || 'your friend'} a ${g.toUpperCase()} for $${PISTOL_PRICE}`, 1800);
}
function onGunOffer(m) {
  if (!V || !m || m.to !== V.ctx.net?.id || !PISTOL.test(String(m.g)) || m.p !== PISTOL_PRICE) return;
  const who = V.ctx.net?.peer?.(m.f)?.name || 'A friend', g = String(m.g).slice(0, 12);
  openDialog(who, { text: `${who}: "${g.toUpperCase()}, clean, full mag. Thirty bucks, bro."`, choices: [
    { label: `Buy it — $${PISTOL_PRICE}`, go: () => { if (!api.pay(PISTOL_PRICE)) return { text: `${who}: "Thirty. Not twenty-nine."`, choices: [{ label: 'Later', go: null }] }; V.ctx.weapons?.collect?.(g, 21); V.ctx.net?.send?.('gunpaid', { to: m.f, g }); return { text: `${who}: "Pleasure. Keys 1-9, it's in your bag."`, choices: [{ label: 'Bet', go: null }] }; } },
    { label: 'Pass', go: () => { V.ctx.net?.send?.('gunno', { to: m.f }); return null; } }] });
}
function giveCash() {
  const net = V.ctx.net; if (!net?.list || V.ctx.player.dead) return; const me = V.ctx.player.position; let best = null, bd = GIFT_RANGE;
  for (const id of net.list()) { const q = net.peer(id); if (!q?.pos || q.dead || q.afk) continue; const d = q.pos.distanceTo(me); if (d < bd) { bd = d; best = { id, name: q.name }; } }
  if (!best) { V.ctx.hud?.toast?.('Get closer to a friend to give cash (N)', 1600); return; }
  if (!api.pay(CASH_GIFT)) { V.ctx.hud?.toast?.(`You need $${CASH_GIFT}`, 1400); return; }
  net.send('cash', { to: best.id, n: CASH_GIFT }); V.ctx.hud?.toast?.(`Gave ${best.name || 'your friend'} $${CASH_GIFT}`, 1600);
}
let _cashTex = null;
function dropCash(at, n) {
  const g = new THREE.Group();
  const bill = new THREE.MeshStandardMaterial({ color: 0x6f9a5c, roughness: 0.8 }), band = new THREE.MeshStandardMaterial({ color: 0xc9b37a, roughness: 0.6 });
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.07), bill); g.add(stack);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.038, 0.072), band); g.add(b);
  if (!_cashTex) { const c = document.createElement('canvas'); c.width = 128; c.height = 48; const x = c.getContext('2d'); x.font = '700 30px Barlow, Arial'; x.textAlign = 'center'; x.fillStyle = '#9fe39a'; x.shadowColor = '#000'; x.shadowBlur = 6; x.fillText('$', 64, 36); _cashTex = new THREE.CanvasTexture(c); }
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: _cashTex, transparent: true, depthWrite: false })); tag.scale.set(0.5, 0.19, 1); tag.position.y = 0.45; g.add(tag);
  const y = Number.isFinite(at.y) ? at.y : 0; const gy = V.world.groundHeight ? V.world.groundHeight(at.x, at.z) : 0;
  g.position.set(at.x + (Math.random() - 0.5) * 0.6, (Number.isFinite(gy) && Math.abs(gy - y) < 2.5 ? gy : y) + 0.25, at.z + (Math.random() - 0.5) * 0.6);
  V.world.scene.add(g); V.drops.push({ g, pos: g.position, n, t: 0 });
}
function updateDrops(dt, playing) {
  const p = V.ctx.player?.position;
  for (let i = V.drops.length - 1; i >= 0; i--) {
    const d = V.drops[i]; d.t += dt; d.g.rotation.y += dt * 1.6; d.g.children[0].position.y = d.g.children[1].position.y = Math.sin(d.t * 3) * 0.04;
    const got = playing && p && Math.hypot(p.x - d.pos.x, p.z - d.pos.z) < 1.6 && Math.abs(p.y + 0.3 - d.pos.y) < 2;
    if (got || d.t > 120) {
      V.world.scene.remove(d.g); V.drops.splice(i, 1);
      if (got) { api.earn(d.n); V.ctx.hud?.toast?.(`+$${d.n} off the merc`, 1600); try { V.ctx.audio?.play?.('pickup'); } catch {} }
    }
  }
}

// ---- elevators / stairs -------------------------------------------------------------------------------------------------------
function callElevator(ti, k, dir, side = 0) {
  const { ctx } = V; const p = ctx.player.position;
  ctx.net?.send?.('elev', { i: ti, k, d: dir, s: side, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
  startRide(ti, k, dir, side);
}
function onRemoteElev(m) {
  if (V.riding || V.passenger || V.dialog || !Array.isArray(m.p)) return; const p = V.ctx.player; if (!p || p.dead || V.ctx.vehicles?.mounted) return;
  if (Math.hypot(p.position.x - m.p[0], p.position.z - m.p[2]) < 3.5 && Math.abs(p.position.y - m.p[1]) < 1.5) { V.ctx.hud?.toast?.(`${V.ctx.net?.peer?.(m.f)?.name || 'A friend'} ${V.shafts[m.i]?.kind === 'stairs' ? 'leads the way…' : 'holds the door…'}`, 1400); startRide(m.i, m.k, m.d, m.s || 0, 0.6); }
}
function startRide(ti, k, dir, side, delay = 0) {
  const { ctx } = V; const t = V.shafts[ti]; if (!t) return;
  const top = t.tops[side] || t.tops[0], up = t.tops[0];
  const src = dir === 'up' ? (up.cars[k] || up.cars[0]) : (t.lobby.cars[k] || t.lobby.cars[0]);
  const dest = dir === 'up' ? { ...src, face: up.face ?? src.yaw } : { ...src, face: src.yaw + Math.PI };
  V.riding = { t: -delay, dest, dir, shaft: t, T: t.kind === 'stairs' ? STAIRS_T : RIDE_T, jitter: (Math.random() - 0.5) * 0.5, moved: false }; void top;
  ctx.player.mounted = { elevator: true };
  try { ctx.audio?.play?.('ui_click'); } catch {}
}
function updateRide(dt) {
  const r = V.riding, { ctx } = V; r.t += dt; const p = ctx.player, T = r.T;
  const k = r.t < 0 ? 0 : r.t < FADE ? r.t / FADE : r.t < T - FADE ? 1 : Math.max(0, (T - r.t) / FADE);
  const car = r.shaft.kind !== 'stairs'; V.ui.fade.classList.toggle('car', car); V.ui.floor.classList.toggle('car', car);
  if (car) V.ui.fade.classList.toggle('flick', Math.random() < 0.06);   // tired fluorescent tube
  V.ui.fade.style.opacity = k.toFixed(3);
  const prog = Math.min(1, Math.max(0, (r.t - FADE) / (T - 2 * FADE))), n = r.shaft.floors;
  if (r.shaft.kind === 'stairs') V.ui.floor.textContent = r.t > 0 ? (r.dir === 'up' ? 'climbing…' : 'heading down…') : '';
  else { const fl = r.dir === 'up' ? Math.round(1 + prog * (n - 1)) : Math.round(n - prog * (n - 1)); V.ui.floor.textContent = r.t > 0 ? `${r.dir === 'up' ? '▲' : '▼'} ${fl === 1 ? 'L' : fl}` : ''; }
  if (!r.moved && r.t >= T / 2) {
    const d = r.dest; const side = new THREE.Vector3(Math.cos(d.face), 0, -Math.sin(d.face));
    p.mounted = null; p.teleport(d.pos.x + side.x * r.jitter, d.pos.y, d.pos.z + side.z * r.jitter, d.face, 0); p.mounted = { elevator: true }; r.moved = true;
  }
  if (r.t >= T) endRide();
}
function endRide(force = false) { if (!V?.riding) return; V.riding = null; V.ui.fade.style.opacity = '0'; V.ui.floor.textContent = ''; const p = V.ctx.player; if (p?.mounted?.elevator) p.mounted = null; if (!force) try { V.ctx.audio?.play?.('ui_click'); } catch {} }

// ---- cars ---------------------------------------------------------------------------------------------------------------------
function nearestParked(r) {
  const p = V.ctx.player.position; let best = null, bd = r;
  for (const c of V.world.parkedCars || []) { if (c.gone) continue; const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd && Math.abs((c.y || 0) - p.y) < 2.5) { bd = d; best = c; } }
  return best;
}
function steal(c) {
  const { ctx } = V; const i = (V.world.parkedCars || []).indexOf(c); if (i < 0) return;
  stealLocal(i, true);
  const car = ctx.vehicles?.spawnCar?.(c.x, c.z, (c.ry || 0) - Math.PI / 2, c.kind === 'cab' ? 'sedan' : c.kind, c.color ?? 0x22305c, c.y || 0);
  if (car) { ctx.vehicles.mount(car); ctx.hud?.toast?.('Hot-wired it. Drive.', 1800); }
  ctx.net?.send?.('steal', { i });
}
/** smash the window, pull the GPS off the dash (car alarm!) — sell it to SHADES for weed money */
function swipeGps(c) {
  const { ctx } = V; if (!api.give('gps')) { ctx.hud?.toast?.('Hands full — sell or use something first', 1600); return; }
  c.gpsGone = true; ctx.hud?.toast?.('*SMASH* — got the GPS! (WEEOOWEEOO — car alarm) · SHADES buys them', 2600);
  try { ctx.audio?.play?.('impact_metal', { position: new THREE.Vector3(c.x, 1, c.z) }); } catch {}
  horn(0.6); setTimeout(() => horn(0.5), 550); setTimeout(() => horn(0.45), 1100);
}
function stealLocal(i, mine) {
  const c = (V.world.parkedCars || [])[i]; if (!c || c.gone) return; const { ctx } = V; void mine;
  hideParkedCar(c);
  dropParkedCarBoxes(ctx, c); try { ctx.player?.rebuildColliders?.(); } catch {}
}
function nearestFriendCar(r) {
  const net = V.ctx.net; if (!net?.list) return null; const p = V.ctx.player.position; let best = null, bd = r;
  for (const id of net.list()) { const q = net.peer(id); if (!q?.veh || q.veh.k === 'pass') continue; const d = Math.hypot(q.pos.x - p.x, q.pos.z - p.z); if (d < bd) { bd = d; best = q; } }
  return best;
}
function enterPassenger(id) { V.passenger = { id }; V.ctx.player.mounted = { passenger: true }; V.ctx.hud?.toast?.('F — GET OUT', 1600); }
function leavePassenger() {
  if (!V?.passenger) return; const { ctx } = V; const q = ctx.net?.peer?.(V.passenger.id); V.passenger = null;
  const p = ctx.player; p.mounted = null;
  if (q) { const h = q.heading; const right = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h)); p.teleport(q.pos.x + right.x * 2.2, q.pos.y, q.pos.z + right.z * 2.2, p.yaw, 0); }
}
function updatePassenger() {
  const { ctx } = V; const q = ctx.net?.peer?.(V.passenger.id); const p = ctx.player;
  if (!q || !q.veh || q.dead || ctx.input?.pressed?.has?.('KeyF')) { ctx.input?.pressed?.delete?.('KeyF'); return leavePassenger(); }
  const h = q.heading; const fwd = new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const bike = q.veh.k === 'bike', sid = [...(ctx.net?.id || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
  const SEATS = [[0.4, 0.15], [-0.4, -0.85], [0.4, -0.85]];   // front passenger, rear left, rear right (metres right, forward)
  const [sr, sf] = bike ? [0, -0.55] : SEATS[sid];
  const seat = q.pos.clone().addScaledVector(right, sr).addScaledVector(fwd, sf);
  p.position.set(seat.x, seat.y + (bike ? 0.55 : 0.3), seat.z); p.velocity?.set?.(0, 0, 0);
  const eyeY = bike ? 1.5 : (carEye(q.veh.k)?.y ?? 1.17);   // that car's eye height (an SUV or a van sits you higher)
  const cam = ctx.camera; cam.position.set(seat.x, seat.y + eyeY, seat.z); cam.rotation.set(p.pitch, p.yaw, 0); p.cameraPosition?.copy?.(cam.position);
}

// ---- death screen: "Respawn at <spot>" (button or T). Solo: respawn right now. Online: net.js keeps its countdown; the choice
// is remembered and the respawn is moved there when it fires.
function respawnBtn() {
  if (!V.respawn) return;
  const btns = document.querySelector('#hud .dead .btns'); if (!btns) return;
  let b = btns.querySelector('.park-rsp');
  if (!b) { b = document.createElement('button'); b.className = 'btn primary park-rsp'; b.addEventListener('click', (e) => { e.stopPropagation(); pickRespawn(); }); btns.prepend(b); }
  b.textContent = `Respawn at ${V.respawn.label} [T]`; b.disabled = false; V.respawnBtn = b;
}
function pickRespawn() {
  const ctx = V?.ctx; if (!ctx || ctx.state !== 'dead' || !V.respawn) return;
  V.respawnPick = true;
  if (ctx.net?.connected) { if (V.respawnBtn) { V.respawnBtn.textContent = `${V.respawn.label} ✓ — respawning…`; V.respawnBtn.disabled = true; } return; }
  ctx.player.respawn();   // emits playerRespawn → toRespawn()
}
function toRespawn() {
  const s = V.respawn?.at?.(); if (!s) return; const p = V.ctx.player;
  const cols = V.ctx.colliders, blocked = (x, z) => cols.some((b) => x > b.min.x - 0.4 && x < b.max.x + 0.4 && z > b.min.z - 0.4 && z < b.max.z + 0.4 && b.max.y > s[1] + 0.3 && b.min.y < s[1] + 1.8);
  let x = s[0], z = s[2];
  for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2, tx = s[0] + Math.cos(a) * r, tz = s[2] + Math.sin(a) * r; if (!blocked(tx, tz)) { x = tx; z = tz; break; } }   // spread so friends don't stack
  p.teleport(x, s[1], z, s[3], 0);
}

// ---- UI: cash + stash, elevator fade, dialogue panel, USE button, controls card --------------------------------------------
function buildUI(o) {
  document.querySelectorAll('.hkui').forEach((e) => e.remove());
  if (!document.getElementById('hkcss')) {
    const css = document.createElement('style'); css.id = 'hkcss'; css.textContent = `
  .hgcash{position:fixed;left:18px;bottom:92px;z-index:40;font:700 20px 'Barlow Condensed',Arial;color:#9fe39a;text-shadow:0 1px 2px #000;pointer-events:none;letter-spacing:.06em}
  .hgfade{position:fixed;inset:0;background:#050505;opacity:0;z-index:45;pointer-events:none;transition:none}
  .hgfade.car{background:radial-gradient(ellipse at 50% 0%,rgba(255,250,230,.28),transparent 60%),repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px),linear-gradient(90deg,#4d5257 0%,#8d9399 18%,#6f757b 48.8%,#141414 49.4%,#141414 50.6%,#6f757b 51.2%,#959ba1 82%,#4a4f54 100%);box-shadow:inset 0 0 180px rgba(0,0,0,.85)}
  .hgfade.car::before{content:'';position:absolute;left:50%;top:8%;transform:translateX(-50%);width:170px;height:84px;background:#0b0b0b;border:3px solid #3a3d40;border-radius:6px}
  .hgfade .tag{display:none;position:absolute;left:18%;top:58%;transform:rotate(-8deg);font:italic 700 34px 'Comic Sans MS','Marker Felt',cursive;color:rgba(20,20,20,.55);letter-spacing:.04em}
  .hgfade.car .tag{display:block}
  .hgfade.car.flick{filter:brightness(.8)}
  .hgfloor.car{top:calc(8% + 45px)}
  .hgfloor{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:46;font:700 64px 'Barlow Condensed',Arial;color:#ffb24a;letter-spacing:.1em;text-shadow:0 0 18px rgba(255,160,40,.6);pointer-events:none}
  .hkdlg{position:fixed;left:50%;bottom:9vh;transform:translateX(-50%);width:min(620px,92vw);z-index:47;background:rgba(10,12,16,.9);border-left:3px solid #ffb24a;color:#eef2f5;padding:14px 18px 12px;display:none;font:500 17px Barlow,Arial;line-height:1.4;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  .hkdlg.on{display:block}
  .hkdlg .nm{font:700 15px 'Barlow Condensed',Arial;letter-spacing:.18em;color:#ffb24a;margin-bottom:4px}
  .hkdlg .tx{margin-bottom:10px;white-space:pre-line}
  .hkch{display:block;width:100%;text-align:left;margin:5px 0 0;padding:9px 12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#fff;font:600 15px Barlow,Arial;border-radius:4px;cursor:pointer}
  .hkch b{display:inline-block;min-width:22px;color:#ffb24a}
  .hkch:hover,.hkch:active{background:rgba(255,178,74,.2)}
  .hkch.dim{opacity:.45}
  .hkdlg .ft{margin-top:8px;font:500 12px Barlow,Arial;color:#9aa4ad;letter-spacing:.05em}`;
    document.head.appendChild(css);
  }
  const el = (cls, tag = 'div') => { const e = document.createElement(tag); e.className = cls + ' hkui'; document.body.appendChild(e); return e; };
  const cash = el('hgcash'), fade = el('hgfade'), floor = el('hgfloor'); fade.innerHTML = '<i class="tag">LPH 4 LIFE · DIMA ✶ 19</i>';
  const dlg = el('hkdlg'); dlg.innerHTML = '<div class="nm"></div><div class="tx"></div><div class="chs"></div><div class="ft">1–9 choose · F leave</div>';
  const use = el('hguse', 'button'); use.textContent = 'USE (B)'; use.style.cssText = 'position:fixed;left:18px;bottom:130px;z-index:46;display:none;padding:12px 18px;font:700 16px Barlow Condensed,Arial;letter-spacing:.12em;color:#fff;background:rgba(40,120,60,.8);border:1px solid rgba(255,255,255,.4);border-radius:6px';
  if (V.ctx.isTouch) { cash.style.cssText = 'top:252px;bottom:auto;font-size:15px'; use.style.top = '280px'; use.style.bottom = 'auto'; use.style.padding = '8px 12px'; use.style.fontSize = '13px'; }   // phones: up under the bag button, out of the thumb cluster
  if (V.ctx.isTouch) use.textContent = 'BAG';   // phones: choose from the bag (inventory.js) instead of blindly using the newest thing
  use.addEventListener('touchstart', (e) => { e.preventDefault(); V.ctx.bus.emit('inventory'); }, { passive: false }); use.addEventListener('click', (e) => { e.stopPropagation(); useItem(); });
  let help = null;
  if (o.help) {
    help = el('hghelp'); help.style.cssText = 'position:fixed;right:14px;top:60px;z-index:44;background:rgba(8,10,14,.78);border-left:2px solid #ffb24a;color:#e8edf2;font:500 13px Barlow,Arial;padding:10px 14px;line-height:1.55;pointer-events:none;max-width:280px';
    help.innerHTML = `<b style="letter-spacing:.14em;font-family:Barlow Condensed">${o.title || 'CONTROLS'} (H)</b><br>${o.help}`;
    help.style.display = 'none';
    // first time ever: open for 10 s once you're actually playing; afterwards it lives behind a small "H · controls" chip
    let seen = false; try { seen = localStorage.getItem('zavod.helpSeen') === '1'; } catch {}
    if (!seen && !V.ctx.isTouch) {
      const t0 = setInterval(() => { if (V?.ctx.state !== 'playing' || !help) return; clearInterval(t0); help.style.display = 'block'; try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} setTimeout(() => { if (help) help.style.display = 'none'; syncChip(); }, 10000); syncChip(); }, 500); }
  }
  let chip = null;
  if (help && !V.ctx.isTouch) { chip = el('hgchip'); chip.style.cssText = 'position:fixed;right:14px;top:60px;z-index:44;background:rgba(8,10,14,.6);color:#c9d2da;font:600 11px Barlow Condensed,Arial;letter-spacing:.14em;padding:4px 9px;pointer-events:none'; chip.innerHTML = '<b style="color:#ffb24a">H</b> · CONTROLS'; }
  V.ui = { chip, cash, fade, floor, use, help, dlg, dname: dlg.querySelector('.nm'), dtext: dlg.querySelector('.tx'), dch: dlg.querySelector('.chs') }; renderCash(); syncChip(); showUI(V.ctx.state === 'playing');
}
function syncChip() { const u = V?.ui; if (u?.chip) u.chip.style.display = u.help && u.help.style.display === 'none' ? 'block' : 'none'; }
function showUI(on) {   // cash / USE / help card are in-game HUD: hidden on the menus, pause and death screens
  if (!V?.ui) return; for (const k of ['cash', 'use', 'help', 'chip']) { const e = V.ui[k]; if (e) e.style.visibility = on ? '' : 'hidden'; }
}
function renderCash() {
  if (!V?.ui) return;
  V.ui.cash.textContent = `$${V.cash}${V.status?.shades ? '  🕶' : ''}${V.status?.crabs ? '  🦀' : ''}`;   // what you carry lives in the bag (I / the bag button), not in a long icon string on screen
  if (V.ui.use) V.ui.use.style.display = V.inv.length ? 'block' : 'none';
}

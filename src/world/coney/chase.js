// CONEY chase AI — GTA-style wanted level. Crimes (firing a gun, stealing a car, killing someone) raise stars; cops come in
// patrol cars along the OSM street graph, bail out and chase on foot; at 3+ stars extra cops arrive on foot. On the Luna Park
// Houses blocks the neighbourhood crew (tough guys on foot + on motorbikes) chase anyone who fights or steals nearby. Stars
// clear once no chaser has had eyes on you for ~20–30 s. Chasers never enter buildings: the lobbies are nav no-go zones
// (ai/nav.js navBlockers) and a player inside / up on the 19th floor gets the doors staked out instead.
// Chasers are ordinary AI soldiers (ai.js spawnChaser → brain callback) in cop / crew clothes (ai/model.js looks).
// Online: each client runs chasers for its OWN wanted level only (their bullets only ever hit their own player); a compact
// snapshot goes out as net 'chase' at 5 Hz and other clients render those as visual-only puppets. CONEY agent (chase).
import * as THREE from 'three';
import { OSM } from './osm.js';
import { carGeometries, carMaterials } from '../carkit.js';
import { buildBike } from '../../vehicles/bike.js';
import { hangkit as HK } from '../hangkit.js';
import { pushOut } from '../../player/collision.js';
import { solidSource, solidAhead, moveBlocked, solidsNear, obbOverlap } from '../../vehicles/solids.js';
const SPAWN_LO = 0.05;   // m over the feet: what counts as solid when a unit is placed

const EVADE_BASE = 20, EVADE_PER_STAR = 2, EVADE_MAX = 30, SEARCH_OUT = 8;   // SEARCH_OUT: s outside the search circle, unseen, before the stars clear
const searchR = () => 50 + 25 * K.stars;
const CREW_EVADE = 25, TERR_R = 85, TERR_LEAVE = 170;         // crew: give up after 25 s unseen or once you are far off their blocks
let MAX_COPS = 8, MAX_CREW = 6, MAX_CARS = 6;   // phones get a smaller force (buildChase)
const CAR_SPEED = 17, CAR_PURSUIT = 21;
const SEND_DT = 0.2;
const LOOK_CODE = { cop: 0, crew: 1, biker: 2 }, CODE_LOOK = ['cop', 'crew', 'crew'];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ray = new THREE.Raycaster(), _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

let K = null;   // module state

export function buildChase(world) {
  const { ctx, W } = world;
  const towers = world.lunaTowers || [];
  const zones = towers.map(lobbyZone).filter(Boolean);
  if (ctx.lite) { MAX_COPS = 5; MAX_CREW = 4; MAX_CARS = 4; }
  // nav-only no-go: lobby floors vanish from the AI grid (players are unaffected)
  W.navBlockers = (W.navBlockers || []).concat(zones.map((z) => ({ min: z.min, max: z.max, test: (x, zz) => inZone(z, x, zz, 0.6) })));
  // shared with the wave AI (ai.js / netwaves.js): where is "indoors" for any player, and where may soldiers never step
  W.indoorAt = (pos, mounted) => { const z = zoneFor(pos, mounted); return z ? z.doors : null; };
  W.chaseNoGo = (x, z, y) => noGo(x, z, y ?? 0);
  K = {
    world, ctx, W, towers, zones, roads: buildRoads(W),
    stars: 0, seenT: -1e9, crimeT: -1e9, lastKnown: new THREE.Vector3(), bump: { shot: -1e9, steal: -1e9 },
    crew: { heat: 0, seenT: -1e9, tower: null, spawned: 0 },
    units: [], cars: [], uid: 1, vid: 1, carT: 0, footT: 0, crewT: 0, sendT: 0, sentEmpty: true, scoreK: null, scoreT: 0, checkT: 0,
    remotes: new Map(), ui: null, t: 0,
  };
  buildUI();
  const bus = ctx.bus;
  // online wave fights (netwaves.js) are self-defence: shooting at / killing wave mercs doesn't bring the cops
  bus.on('shot', (e) => { if (e && e.who === 'player' && !e.melee && !ctx.netwaves?.busy) crime('shot', e.origin || ctx.player?.position); });
  bus.on('worldReset', () => { try { wasted(); } catch {} });
  bus.on('npcHurt', (d) => crime(d?.dead ? 'kill' : 'shot', d?.position));
  bus.on('enemyKilled', (d) => { if (!K || !d?.position || !K.units.some((u) => u.s === d.soldier)) return; try { HK.dropCash(d.position.clone().setY(0.05), 20 + 10 * Math.floor(Math.random() * 5)); } catch {} });   // drop a cop / a pursuer: his wallet hits the pavement (his gun drops via ai.js)   // stabbing / shooting the locals (hangkit hurtable NPCs)
  bus.on('vehicle', (e) => { if (e?.stage === 'mount' && e.bike?.spec?.car) { const b = e.bike; crime('steal', b.pos || ctx.player?.position, { mine: !!b._mine || !!b.gift || !!b.hangout, jack: !!b.jacked }); b._mine = true; } });
  // a cop car the cops have jumped out of: F at it and it's yours (a real drivable car in NYPD colours, lightbar and all)
  K.copSpot = new THREE.Vector3(0, -999, 0);
  HK.spot({ pos: K.copSpot, r: 5, dy: 2.5, when: () => !!K.copTarget && !ctx.vehicles?.mounted, prompt: 'F — STEAL THE COP CAR', act: () => stealCop() });
  bus.on('enemyKilled', (d) => { if (!d || d.qa || (d.wave && ctx.netwaves)) return; crime(d.chase === 'cop' ? 'copKill' : d.chase === 'crew' ? 'crewKill' : 'kill', d.position || ctx.player?.position); });
  bus.on('playerDied', () => wasted());
  bus.on('restart', () => { for (const u of K.units) disposeBike(u); K.units.length = 0; for (const c of K.cars) disposeCar(c); K.cars.length = 0; K.stars = 0; K.crew.heat = 0; renderUI(); });
  bus.on('net:chase', (m) => onRemote(m));
  solidSource('cops', () => K.cars.filter((c) => !c.gone && c.sol).map((c) => { const o = c.sol; o.x = c.pos.x; o.z = c.pos.z; o.h = c.heading; o.v = c.speed; return o; }));   // the cop cars, for every AI driver
  world.updaters.push((dt) => { try { update(dt); } catch (e) { if ((K.errN = (K.errN || 0) + 1) < 4) console.error('[chase]', e); } });
  W.mapSearch = () => (K.stars && K.t - K.seenT > 2 ? [K.lastKnown.x, K.lastKnown.z, searchR(), K.t - (K.flashT || -9) < 0.4] : null);
  if (typeof window !== 'undefined' && window.__game) window.__game.chase = chaseQA;
  console.log('[chase] lobbies', zones.length, '· road nodes', K.roads.nodes.length, '· edges', K.roads.edges.length);
}

// ---------------------------------------------------------------------------------------------------------------------------
// no-go zones: a lobby is an oriented box between its two door gaps (c axis) and ±LOBBY_HALF along the core spine (a axis)
function lobbyZone(t) {
  const d = t.lobby?.doors; if (!d || d.length < 2 || !t.lobby.cars?.length) return null;
  const a = d[0].inside, b = d[1].inside;
  const c = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  const uc = new THREE.Vector3(b.x - a.x, 0, b.z - a.z); const len = uc.length(); if (len < 0.5) return null; uc.multiplyScalar(1 / len);
  const ua = new THREE.Vector3(-uc.z, 0, uc.x);
  const car = t.lobby.cars[0].pos; const da = Math.abs((car.x - c.x) * ua.x + (car.z - c.z) * ua.z);
  const hc = len / 2 + 1.25, ha = Math.max(da + 1.15, 13.2);   // the ground lobby runs to mid + 13 (housing.js GROUND_HI); the −a side is solid anyway
  const ex = Math.abs(ua.x) * ha + Math.abs(uc.x) * hc, ez = Math.abs(ua.z) * ha + Math.abs(uc.z) * hc;
  return { tower: t, c, ua, uc, ha, hc, min: new THREE.Vector3(c.x - ex - 1, -1, c.z - ez - 1), max: new THREE.Vector3(c.x + ex + 1, 3, c.z + ez + 1), doors: d.map((q) => q.outside.clone()) };
}
function inZone(z, x, zz, m = 0) { const dx = x - z.c.x, dz = zz - z.c.z; return Math.abs(dx * z.ua.x + dz * z.ua.z) < z.ha + m && Math.abs(dx * z.uc.x + dz * z.uc.z) < z.hc + m; }
function noGo(x, z, y) { if (y > 3) return false; for (const q of K.zones) if (inZone(q, x, z, 0.35)) return true; return false; }
function nearestTower(p) { let best = null, bd = 1e9; for (const t of K.towers) { const d = hyp(t.centre.x, t.centre.z, p.x, p.z); if (d < bd) { bd = d; best = t; } } return best ? { t: best, d: bd } : null; }

/** Where the player "is" for the chasers: outdoors → the player; in a lobby / up on the 19th floor / riding an elevator → the doors of that building */
function playerSpot() {
  const p = K.ctx.player; const zone = zoneFor(p.position, p.mounted);
  return zone ? { indoor: true, zone } : { indoor: false, zone: null };
}
/** the lobby zone a position is "inside" (in a lobby, riding an elevator, or high up in / on a tower), else null — any player */
function zoneFor(pos, mounted) {
  if (!K) return null;
  const gh = K.W.groundHeight ? K.W.groundHeight(pos.x, pos.z) : 0;
  let zone = null; for (const q of K.zones) if (inZone(q, pos.x, pos.z, 0.8) && pos.y < 3) { zone = q; break; }
  if (!zone && (pos.y - gh > 6 || mounted?.elevator)) { const nt = nearestTower(pos); if (nt && nt.d < 90) zone = K.zones.find((q) => q.tower === nt.t) || null; }
  return zone;
}

// ---------------------------------------------------------------------------------------------------------------------------
// street graph from the OSM carriageways (shared OSM nodes join the ways at junctions)
function buildRoads(W) {
  const b = W.bounds, m = 8; const inB = (x, z) => x > b.min.x + m && x < b.max.x - m && z > b.min.z + m && z < b.max.z - m;
  const nodes = [], adj = [], edges = [], idx = new Map();
  const nid = (x, z) => { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let i = idx.get(k); if (i === undefined) { i = nodes.length; nodes.push({ x, z }); adj.push([]); idx.set(k, i); } return i; };
  for (const r of OSM.r) {
    if (r.w < 6) continue;
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1]; if (!inB(ax, az) || !inB(bx, bz)) continue;
      const a = nid(ax, az), c = nid(bx, bz); if (a === c) continue; const L = hyp(ax, az, bx, bz);
      adj[a].push([c, L]); adj[c].push([a, L]); edges.push([a, c, r.w]);
    }
  }
  return { nodes, adj, edges };
}
function nearestEdge(x, z) {
  const R = K.roads; let best = null;
  for (const [a, b, w] of R.edges) {
    const A = R.nodes[a], B = R.nodes[b]; const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz; if (L2 < 1e-3) continue;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2)); const px = A.x + dx * t, pz = A.z + dz * t; const d = hyp(x, z, px, pz);
    if (!best || d < best.d) best = { a, b, t, px, pz, d, w };
  }
  return best;
}
/** Dijkstra over the street graph from node s to the edge nearest (tx, tz); returns [{x,z}...] ending on the projection */
function roadPath(s, tx, tz) {
  const R = K.roads, e = nearestEdge(tx, tz); if (!e) return null;
  const n = R.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[s] = 0; const open = [s];
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const u = open[bi]; open[bi] = open[open.length - 1]; open.pop(); if (done[u]) continue; done[u] = 1;
    if (done[e.a] && done[e.b]) break;
    for (const [v, L] of R.adj[u]) { const nd = dist[u] + L; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; open.push(v); } }
  }
  const A = R.nodes[e.a], B = R.nodes[e.b];
  const ca = dist[e.a] + hyp(A.x, A.z, e.px, e.pz), cb = dist[e.b] + hyp(B.x, B.z, e.px, e.pz);
  const end = ca <= cb ? e.a : e.b; if (!isFinite(dist[end])) return null;
  const out = []; for (let v = end; v !== -1; v = prev[v]) out.push({ x: R.nodes[v].x, z: R.nodes[v].z, node: v });
  out.reverse(); out.push({ x: e.px, z: e.pz, node: -1 });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// crimes → stars / crew heat
function witnessed() { const t = K.t; for (const u of K.units) if (u.kind === 'cop' && !u.s.dead && !u.leaving && !u.patrol && t - u.seenT < 1.5) return true; for (const c of K.cars) if (c.manned && !c.leaving && !c.patrol && t - c.seenT < 1.5) return true; return false; }
// GTA rules: a crime only costs stars if a cop sees it (a unit, a manned car, a foot patrol: then at least 2 stars) or a witness
// phones it in (coney/folk.js: a local pulls out a phone, ~6 s, and you can stop them). Killing a cop and the crew's own
// business are always known. Cars you've already driven are yours; a parked car only counts if somebody sees it.
const PHONED = new Set(['shot', 'steal', 'rob', 'kill', 'hit']);
function crime(type, pos, opts = {}) {
  if (!K || !K.ctx.player || K.ctx.player.dead || K.ctx.state !== 'playing') return;
  pos = pos || K.ctx.player.position;
  const patrol = patrolSaw(), w = witnessed() || patrol;
  if (type === 'steal' && opts.mine) return;
  if (!w && PHONED.has(type) && !opts.called && !(type === 'steal' && opts.jack)) {   // a carjack: the driver saw it all
    K.phone?.(type, pos, (who) => crime(type, pos, { called: who || true }));   // the stars come if the call goes through
    return;
  }
  apply(type, pos, w, patrol, opts.called);
}
function apply(type, pos, w, patrol, called) {
  const t = K.t, me = K.ctx.player.position;
  const before = K.stars;
  switch (type) {
    case 'shot': K.stars = Math.max(K.stars, 1); if (w && t - K.bump.shot > 12) { K.bump.shot = t; K.stars = Math.min(Math.max(K.stars, 2) + (K.stars >= 2 ? 1 : 0), 3); } break;
    case 'steal': K.stars = Math.max(K.stars, w ? 2 : 1); break;
    case 'rob': K.stars = Math.max(K.stars, w ? 2 : 1); break;   // somebody called it in (coney/chill.js muggings)
    case 'kill': K.stars = Math.min(5, Math.max(K.stars + 1, 2)); break;
    case 'copKill': K.stars = Math.min(5, Math.max(K.stars + 1, 3)); break;
    case 'crewKill': K.stars = Math.max(K.stars, 1); break;
    case 'hit': K.stars = Math.max(K.stars, 1); break;
    default: return;
  }
  if (patrol) K.stars = Math.max(K.stars, 2);   // a cop on the beat watched you do it
  K.crimeT = t; if (w) { K.seenT = Math.max(K.seenT, t); K.lastKnown.copy(me); } else { K.seenT = Math.max(K.seenT, t - 2.5); K.lastKnown.copy(pos); }   // a call: they know where it happened, not where you are
  if (called) K.ctx.hud?.toast?.(`${called === true ? 'Somebody' : called} called the cops.`, 2400);
  // the crew: anything violent or a theft on (or right next to) their blocks
  const nt = nearestTower(pos);
  if (nt && nt.d < TERR_R) {
    if (!K.crew.heat) { K.crew.spawned = 0; K.crewT = 0.8; K.ctx.hud?.toast?.('You picked the wrong block.', 2200); }
    K.crew.heat = 1; K.crew.seenT = t; K.crew.tower = nt.t;
  }
  if (K.stars !== before) { if (!before) { K.carT = 1.2; K.footT = 6; } renderUI(); }
}
/** folk.js hands over its witness picker: (type, pos, onCalled(name)) → started a call? */
export function setReporter(fn) { if (K) K.phone = fn; }
/** a foot patrol or a cruising car that can see you right now */
function patrolSaw() { const p = K.ctx.player.position; for (const u of K.units) if (u.patrol && !u.s.dead && u.s.seesPlayer && u.s.position.distanceTo(p) < 40) return true;
  for (const c of K.cars) if (c.patrol && c.manned && K.t - c.seenT < 1.5) return true; return false; }
// ---- ambient NYPD: cruisers in traffic and two foot patrols on the beat, before anything has happened ------------------------
const BEATS = [[[-58, -246], [-80, -196], [-82, -146], [-70, -128]], [[-80, 142], [20, 142], [130, 142], [20, 142]]];   // Stillwell plaza ↔ Surf & Stillwell; the boardwalk, Stillwell ↔ W 10th
function patrols(dt) {
  const ctx = K.ctx, lite = !!ctx.lite, p = ctx.player.position; K.patrolT = (K.patrolT ?? 3) - dt; if (K.patrolT > 0) return; K.patrolT = 2;
  // cruisers: keep 2 (phones 1) somewhere within a few blocks, lights off
  const want = lite ? 1 : 2; let have = K.cars.filter((c) => c.patrol && !c.gone).length;
  for (const c of K.cars.slice()) if (c.patrol && !K.stars && c.pos.distanceTo(p) > 380 && !inView(c.pos)) { disposeCar(c); K.cars.splice(K.cars.indexOf(c), 1); have--; }
  if (have < want && K.cars.length < MAX_CARS) { const c = spawnCar(); if (c) { c.patrol = true; c.path = null; } }
  // foot patrols: a pair per beat (phones: the first beat only)
  BEATS.slice(0, lite ? 1 : 2).forEach((beat, bi) => {
    const on = K.units.filter((u) => u.beat === bi && !u.s.dead); if (on.length >= 2 || ctx.ai?.nav == null) return;
    const pts = beat.map(([x, z]) => ctx.ai.nav.nearestFree(x, z, 8, 0)).filter(Boolean); if (pts.length < 2) return;
    const near = hyp(pts[0].x, pts[0].z, p.x, p.z); if (near < 25 && inView(pts[0])) return;   // nobody pops in under your nose
    const u = spawnUnit('cop', pts[0].clone().add(new THREE.Vector3(on.length ? 1.4 : 0, 0, 0))); u.patrol = pts; u.beat = bi; u.wi = 1; u.leaving = false;
  });
}
/** on the beat: walk the waypoints, look around at each end, never fire */
function patrolBrain(u, s) {
  s.wantFire = false; s.leanTarget = 0; s.crouchTarget = 0;
  const wp = u.patrol[u.wi % u.patrol.length], mate = K.units.find((o) => o !== u && o.beat === u.beat && !o.s.dead);
  if (s.position.distanceTo(wp) < 2.5) { u.pauseT = (u.pauseT || 0) + 0.2; if (u.pauseT > 3) { u.pauseT = 0; u.wi++; } s.setGoal(null); return; }
  const tgt = mate && mate.uid < u.uid ? wp.clone().add(new THREE.Vector3(1.3, 0, 0.6)) : wp;   // walk side by side
  goal(u, s, tgt, 'walk');
}
function wasted() {
  if (!K) return; const had = K.stars || K.crew.heat;
  K.stars = 0; K.crew.heat = 0; for (const u of K.units) if (!u.patrol) u.leaving = true; for (const c of K.cars) if (!c.patrol) c.leaving = true;
  if (had) renderUI();
}

// ---------------------------------------------------------------------------------------------------------------------------
function update(dt) {
  if (!K) return; const ctx = K.ctx, ai = ctx.ai, p = ctx.player;
  updateRemotes(dt);
  if (!ai?.spawnChaser || !p) return;
  const playing = ctx.state === 'playing' && !p.dead;
  if (!playing && ctx.state !== 'dead') { renderUI(); return; }
  K.t += dt; const t = K.t;
  // online kills (another player): our kill count went up
  K.scoreT -= dt; if (K.scoreT <= 0 && ctx.net?.scores) { K.scoreT = 0.5; const me = ctx.net.scores().find((s) => s.id === ctx.net.id); if (me) { if (K.scoreK !== null && me.k > K.scoreK) crime('kill', p.position); K.scoreK = me.k; } }
  // units: drop the ones the AI has cleaned up (corpse timeout, restart)
  K.checkT -= dt; const check = K.checkT <= 0; if (check) K.checkT = 1;
  for (let i = K.units.length - 1; i >= 0; i--) { const u = K.units[i]; if (u.s.removeMe || (check && !ai.soldiers.includes(u.s))) { if (u.bike) disposeBike(u); K.units.splice(i, 1); } }
  // sight bookkeeping
  for (const u of K.units) { if (u.s.dead || u.leaving) continue; if (u.s.seesPlayer) { u.seenT = t; if (u.kind === 'cop') { K.seenT = t; K.lastKnown.copy(p.position); } else { K.crew.seenT = t; } } }
  // decay
  // the search circle (GTA): unseen, they comb a circle round the last sighting; stay out of it for SEARCH_OUT s and they give up
  if (K.stars > 0) { const unseen = t - K.seenT > 2, out = unseen && hyp(p.position.x, p.position.z, K.lastKnown.x, K.lastKnown.z) > searchR();
    K.outT = out ? (K.outT || 0) + dt : 0; K.evading = out;
    if (K.outT > SEARCH_OUT || t - K.seenT > EVADE_MAX * 4) { K.stars = 0; K.outT = 0; for (const u of K.units) if (u.kind === 'cop' && !u.patrol) u.leaving = true; for (const c of K.cars) if (!c.patrol) c.leaving = true; ctx.hud?.toast?.('Lost them.', 2000); } }
  else K.evading = false;
  if (K.sightT !== K.seenT && t - K.seenT < 0.05) { K.sightT = K.seenT; K.flashT = t; }   // re-centred on a sighting: the rim flashes
  patrols(dt);
  if (K.crew.heat) { const nt = nearestTower(p.position); if (t - K.crew.seenT > CREW_EVADE || !nt || nt.d > TERR_LEAVE) { K.crew.heat = 0; for (const u of K.units) if (u.kind !== 'cop') u.leaving = true; } }
  if (playing) spawnLogic(dt);
  updateCars(dt);
  for (const u of K.units) if (u.bike) syncBike(u, dt);
  { const G = ctx.player?.solids?.(); if (G) for (const u of K.units) if (!u.bike && !u.s.dead) pushOut(G, u.s.position); }   // on foot: out of benches / stalls / parked cars, like folk (ai.js steering alone can clip a low bench)
  // leaving units / cars go away once out of sight (or far, or after a while)
  if (check) {
    updateFrustum();
    for (const u of K.units.slice()) { if (!u.leaving) continue; u.leaveT = (u.leaveT || 0) + 1; const d = u.s.position.distanceTo(p.position); if (u.s.dead ? (u.leaveT > 8 && (d > 40 || !inView(u.s.position))) : (d > 70 || !inView(u.s.position) || u.leaveT > 30)) removeUnit(u); }
    for (const c of K.cars.slice()) { const d = c.pos.distanceTo(p.position); const idle = c.leaving || (!c.manned && !K.units.some((u) => u.car === c && !u.s.dead)); if (idle) { c.idleT = (c.idleT || 0) + 1; if ((d > 60 || !inView(c.pos)) && (c.leaving || c.idleT > 20)) { disposeCar(c); K.cars.splice(K.cars.indexOf(c), 1); } } }
  }
  K.sendT -= dt; if (K.sendT <= 0) { K.sendT = SEND_DT; sendState(); }
  renderUI();
}

function updateFrustum() { const cam = K.ctx.camera; cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); }
function inView(pos) { _v.set(pos.x, pos.y + 1, pos.z); return _fr.containsPoint(_v) && _v.distanceTo(K.ctx.camera.position) < 160; }
function visibleFromPlayer(pos) {
  updateFrustum(); if (!inView(pos)) return false;
  const cam = K.ctx.camera.position; _v.set(pos.x, pos.y + 1.2, pos.z); const d = _v.distanceTo(cam); if (d > 150) return false;
  _ray.set(cam, _v2.subVectors(_v, cam).normalize()); _ray.near = 0.2; _ray.far = d - 0.3;
  try { for (const h of _ray.intersectObjects(K.ctx.raycastTargets, false)) { if (h.object.userData.soldier || h.object.userData.noLOS) continue; return false; } } catch { return false; }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------
function counts() {
  let cops = 0, crew = 0, cars = 0;
  for (const u of K.units) if (!u.s.dead && !u.leaving) { if (u.kind === 'cop') cops++; else crew++; }
  for (const c of K.cars) if (!c.leaving && (c.manned || K.units.some((u) => u.car === c && !u.s.dead))) cars++;
  return { cops, crew, cars };
}
function spawnLogic(dt) {
  const c = counts(), p = K.ctx.player;
  if (K.stars > 0) {
    const wantCars = Math.min(4, Math.ceil(K.stars * 0.8));
    K.carT -= dt; if (K.carT <= 0 && c.cars < wantCars && K.cars.length < MAX_CARS) { K.carT = 4; spawnCar(); }
    const wantFoot = K.stars >= 3 ? (K.stars - 2) * 2 : 0; const foot = K.units.filter((u) => u.kind === 'cop' && !u.car && !u.s.dead && !u.leaving).length;
    K.footT -= dt; if (K.footT <= 0 && foot < wantFoot && c.cops < MAX_COPS) { K.footT = 3; const at = spawnPoint(p.position, 50, 85, null); if (at) spawnUnit('cop', at); }
  }
  if (K.crew.heat) {
    K.crewT -= dt;
    if (K.crewT <= 0 && c.crew < 4 && K.crew.spawned < 9 && c.crew < MAX_CREW) {
      K.crewT = 2.2; const t = K.crew.tower || nearestTower(p.position)?.t;
      const at = spawnPoint(p.position, 30, 75, t);
      if (at) { const biker = K.crew.spawned % 3 === 1; spawnUnit(biker ? 'biker' : 'crew', at); K.crew.spawned++; }
    }
  }
}
/** a nav point dmin..dmax from `around`, out of the player's sight, same nav region as the player (or their door), outside lobbies; crew: on their blocks */
function spawnPoint(around, dmin, dmax, tower) {
  const nav = K.ctx.ai.nav, rng = K.ctx.rng || Math.random; const spot = playerSpot();
  const ref = spot.indoor ? spot.zone.doors[0] : around;
  const reg = nav.regionAt(ref.x, ref.z, spot.indoor ? 0 : ref.y);
  let fallback = null;
  for (let k = 0; k < 14; k++) {
    const a = rng() * Math.PI * 2, d = dmin + rng() * (dmax - dmin);
    let x = around.x + Math.cos(a) * d, z = around.z + Math.sin(a) * d;
    if (tower) { const tc = tower.centre; if (hyp(x, z, tc.x, tc.z) > TERR_R) { const r = 20 + rng() * (TERR_R - 25); x = tc.x + Math.cos(a) * r; z = tc.z + Math.sin(a) * r; if (hyp(x, z, around.x, around.z) < dmin * 0.7) continue; } }
    const q = nav.nearestFree(x, z, 5, 0); if (!q || Math.abs(q.y - (K.W.groundHeight?.(q.x, q.z) ?? 0)) > 1.5) continue;
    if (noGo(q.x, q.z, q.y)) continue;
    if (reg !== -1 && nav.regionAt(q.x, q.z, q.y) !== reg) continue;
    if (!fallback) fallback = q;
    if (!visibleFromPlayer(q)) return q;
  }
  return fallback;
}

const SPEC = {
  cop: { look: 'cop', name: 'NYPD', health: 110, speed: 5.0, dmgMul: 0.45, range: 38 },
  crew: { look: 'crew', name: 'CREW', health: 90, speed: 5.3, dmgMul: 0.4, range: 30 },
  biker: { look: 'crew', name: 'CREW', health: 80, speed: 8.5, dmgMul: 0.35, range: 22 },
};
function spawnUnit(kind, at, car = null) {
  const ai = K.ctx.ai, sp = SPEC[kind], p = K.ctx.player.position;
  const u = { kind, uid: K.uid++, car, seenT: K.t - 3, leaving: false, loiter: null, wander: null, goalT: 0 };
  const s = ai.spawnChaser(at, Math.atan2(p.x - at.x, p.z - at.z), { look: sp.look, name: sp.name, health: sp.health, speed: sp.speed, dmgMul: sp.dmgMul, tag: kind === 'cop' ? 'cop' : 'crew', noGo, brain: (s, vis, t) => brain(u, s, vis) });
  u.s = s; s.lastKnown.copy(p); s.lastSeen = K.ctx.time.elapsed - 2;
  { const G = K.ctx.player?.solids?.(); if (G) pushOut(G, s.position, 0.28, SPAWN_LO); }   // a spawn point by a low planter: out of it from the ankles up (the per-frame push only counts boxes over a step)
  if (kind === 'biker') { u.bike = makeBikeMesh(); s.riding = { seat: 0.2 }; s.crouch = s.crouchTarget = 0.62; }
  K.units.push(u); return u;
}
function removeUnit(u) { if (u.bike) disposeBike(u); K.ctx.ai.removeSoldier(u.s); const i = K.units.indexOf(u); if (i > -1) K.units.splice(i, 1); }

// ---------------------------------------------------------------------------------------------------------------------------
// foot / bike behaviour (runs in ai.js think() at ~5 Hz; perceive() already ran: vis = sees the player)
const COP_DMG = [0, 0, 0.15, 0.25, 0.35, 0.45];   // by stars: 1 = no fire (the collar), 2 = only at a drawn gun
function brain(u, s, vis) {
  if (u.patrol && !K.stars && !u.leaving) { patrolBrain(u, s); return; }
  brainInner(u, s, vis);
  if (u.kind === 'cop') { s.dmgMul = COP_DMG[Math.min(5, K.stars)] || 0.15; const W = K.ctx.weapons;
    if (K.stars === 2 && !(W?.current && W.current.mode !== 'MELEE')) s.wantFire = false;
    if (s.burst > 0) u.firing = true; else if (u.firing) { u.firing = false; s.fireCooldown = Math.max(s.fireCooldown || 0, 1.2); } }
  // one star = they want to cuff you, not kill you: hold fire, and a cop within arm's reach for ~1.2 s makes the collar
  if (u.kind === 'cop' && K.stars === 1 && !K.crew.heat) {
    s.wantFire = false; const p = K.ctx.player;
    if (vis && !p.dead && s.position.distanceTo(p.position) < 1.9) { K.bustT = (K.bustT || 0) + 0.2; if (K.bustT > 1.2) busted(); } else K.bustT = Math.max(0, (K.bustT || 0) - 0.1);
  }
}
function busted() {
  if (!K) return; K.bustT = 0; const ctx = K.ctx;
  try { ctx.bus.emit('busted', {}); } catch {}
  try { if (ctx.mode === 'chill') ctx.hud?.busted?.(); } catch {}
  wasted();
}
function brainInner(u, s, vis) {
  const ctx = K.ctx, p = ctx.player, t = K.t, rng = ctx.rng || Math.random, sp = SPEC[u.kind];
  s.wantFire = false; s.leanTarget = 0; s.crouchTarget = u.kind === 'biker' ? 0.62 : 0;
  if (u.leaving || p.dead) { s.clearAim(); if (!u.away) { const d = _v.subVectors(s.position, p.position).setY(0).normalize(); const q = ctx.ai.nav.nearestFree(s.position.x + d.x * 60, s.position.z + d.z * 60, 12, 0); u.away = q || s.position.clone(); } s.setGoal(u.away, 'walk'); return; }
  const dist = s.position.distanceTo(p.position);
  const spot = playerSpot();
  // aware of where the player is: own sight, or the force's shared knowledge (radio) while hot
  const hot = u.kind === 'cop' ? t - K.seenT < 8 : t - K.crew.seenT < 8;
  const know = vis ? p.position : (hot ? lastKnownFor(u) : null);
  if (spot.indoor) {
    // stake out the doors: never inside
    if (!u.loiter || u.loiterZone !== spot.zone) { const doors = spot.zone.doors; const door = doors[u.uid % doors.length]; const a = rng() * Math.PI * 2, r = 1.5 + rng() * 3.5; u.loiter = ctx.ai.nav.nearestFree(door.x + Math.cos(a) * r, door.z + Math.sin(a) * r, 5, 0) || door.clone(); if (noGo(u.loiter.x, u.loiter.z, 0)) u.loiter = door.clone(); u.loiterZone = spot.zone; }
    goal(u, s, u.loiter, u.loiter.distanceTo(s.position) > 8 ? 'run' : 'walk');
    if (vis && dist < sp.range + 10) s.wantFire = true;
    return;
  }
  u.loiter = null;
  if (vis) {
    if (dist < (u.kind === 'biker' ? 9 : 13)) { s.setGoal(null); if (u.kind !== 'biker' && dist > 5 && rng() < 0.3) s.crouchTarget = 0.4; }
    else goal(u, s, p.position, 'run');
    if (dist < sp.range) s.wantFire = true;
    return;
  }
  if (know) { goal(u, s, know, 'run'); return; }
  // cold trail: search around the last known spot
  if (!u.wander || s.arrived || t - u.goalT > 9) { const lk = u.kind === 'cop' ? K.lastKnown : p.position; const a = rng() * Math.PI * 2, r = u.kind === 'cop' ? rng() * searchR() * 0.8 : 6 + rng() * 22; u.wander = ctx.ai.nav.nearestFree(lk.x + Math.cos(a) * r, lk.z + Math.sin(a) * r, 6, 0) || lk.clone(); u.goalT = t; }
  goal(u, s, u.wander, 'walk');
}
/** re-target only when the goal moved enough (repaths are the expensive part) */
function goal(u, s, pos, gait) {
  if (!pos) return;
  if (s.arrived && s.moveGoal && s.moveGoal.distanceTo(pos) < 1.5) return;
  if (!s.moveGoal || s.moveGoal.distanceTo(pos) > 3 || s.gait !== gait || s.arrived) s.setGoal(pos, gait);
}

// ---------------------------------------------------------------------------------------------------------------------------
// patrol cars: kinematic, on the street graph; bail out near the player, pursue (and shoot from the window) while the player drives
let CARMATS = null;
function carMats() {
  if (CARMATS) return CARMATS; const CM = carMaterials();
  CARMATS = { ...CM, paint: CM.paint.clone(), red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1), toneMapped: false }), blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.4, 3.5), toneMapped: false }), off: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.2 }), stripe: new THREE.MeshStandardMaterial({ color: 0x1b3a8c, roughness: 0.45, metalness: 0.2 }) };
  CARMATS.paint.color = new THREE.Color(0xf2f3f5); return CARMATS;
}
function buildCopCarMesh() {
  const G = carGeometries('sedan').geos, M = carMats();
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  for (const [slot, g] of Object.entries(G)) { if (!g) continue; const m = new THREE.Mesh(g, M[slot] || carMaterials()[slot] || M.trim); m.rotation.y = Math.PI / 2; m.castShadow = slot === 'paint'; m.receiveShadow = true; body.add(m); }
  // blue side stripe + roof light bar
  for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 3.6), M.stripe); st.position.set(s * 0.905, 0.72, 0.05); body.add(st); }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.26), M.off); bar.position.set(0, 1.49, 0.15); body.add(bar);
  const L = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.24), M.red), R = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.24), M.blue);
  L.position.set(-0.3, 1.5, 0.15); R.position.set(0.3, 1.5, 0.15); body.add(L); body.add(R);
  K.ctx.scene.add(group);
  return { group, body, lamps: [L, R] };
}
function lampFlash(c, on, t) { const k = on ? Math.floor(t * 6) % 2 : -1; c.lamps[0].material = k === 0 ? carMats().red : carMats().off; c.lamps[1].material = k === 1 ? carMats().blue : carMats().off; }

function spawnCar() {
  const p = K.ctx.player.position, R = K.roads, rng = K.ctx.rng || Math.random; if (!R.nodes.length) return null;
  updateFrustum();
  let pick = null, alt = null;
  for (let k = 0; k < 40; k++) {
    const i = (rng() * R.nodes.length) | 0, n = R.nodes[i], d = hyp(n.x, n.z, p.x, p.z);
    if (d < 110 || d > 230 || !R.adj[i].length) continue;
    if (K.cars.some((c) => hyp(c.pos.x, c.pos.z, n.x, n.z) < 15)) continue;
    const v = new THREE.Vector3(n.x, 0, n.z); if (!inView(v)) { pick = i; break; } if (alt === null) alt = i;
  }
  if (pick === null) pick = alt; if (pick === null) return null;
  const n = R.nodes[pick]; const mesh = buildCopCarMesh();
  const c = { vid: K.vid++, ...mesh, pos: new THREE.Vector3(n.x, K.W.groundHeight?.(n.x, n.z) ?? 0, n.z), heading: 0, speed: 0, node: pick, path: null, pi: 0, replanT: 0, state: 'drive', manned: true, seenT: -1e9, fireT: 1.5, leaving: false, idleT: 0, crew: [] };
  const nx = R.adj[pick][0][0]; c.heading = Math.atan2(-(R.nodes[nx].x - n.x), -(R.nodes[nx].z - n.z));
  c.sol = { x: c.pos.x, z: c.pos.z, h: c.heading, v: 0, hl: COP_HL, hw: COP_HW, ext: true, cop: c.vid };
  place(c); K.cars.push(c); return c;
}
function place(c) { c.group.position.copy(c.pos); c.group.rotation.y = c.heading; }
function disposeCar(c) { K.ctx.scene.remove(c.group); c.gone = true; }

function updateCars(dt) {
  const ctx = K.ctx, p = ctx.player, t = K.t, veh = ctx.vehicles?.mounted;
  // an empty cop car within reach (the crew bailed out): the steal prompt sits on it; a stolen one keeps its lights going
  K.copTarget = null; if (!veh && p && !p.dead) { let bd = 4.8; for (const c of K.cars) { if (c.gone || c.leaving || c.manned || c.state !== 'stopped') continue; const d = hyp(c.pos.x, c.pos.z, p.position.x, p.position.z); if (d < bd) { bd = d; K.copTarget = c; } } }
  if (K.copTarget) K.copSpot.copy(K.copTarget.pos); else K.copSpot.set(0, -999, 0);
  if (K.stolen?.v && !K.stolen.v.gone) { const k = veh === K.stolen.v ? Math.floor(t * 6) % 2 : -1; K.stolen.lamps[0].material = k === 0 ? carMats().red : carMats().off; K.stolen.lamps[1].material = k === 1 ? carMats().blue : carMats().off; }
  for (const c of K.cars) {
    const cruising = c.patrol && !K.stars && c.manned;
    lampFlash(c, !cruising && (c.manned || K.units.some((u) => u.car === c && !u.s.dead)), t);
    if (cruising && c.state === 'drive') {   // on patrol: from one corner of the map to another, watching
      if (!c.path || c.pi >= c.path.length) { const N = K.roads.nodes, n = N[((ctx.rng?.() ?? Math.random()) * N.length) | 0]; c.path = roadPath(c.node, n.x, n.z); c.pi = 0; }
      const dp = hyp(c.pos.x, c.pos.z, p.position.x, p.position.z);
      if (dp < 60 && (ctx.time.frame + c.vid) % 20 === 0 && carSees(c)) c.seenT = t;
      drive(c, dt, veh); continue;
    }
    if (c.state === 'stopped' && !c.leaving && veh && Math.abs(veh.speed || 0) > 6 && c.pos.distanceTo(p.position) > 30) {
      // the player drove off: whoever is still by the car jumps back in and the pursuit resumes
      const crew = K.units.filter((u) => u.car === c && !u.s.dead && u.s.position.distanceTo(c.pos) < 16);
      if (crew.length) { for (const u of crew) removeUnit(u); c.manned = true; c.state = 'drive'; c.path = null; }
    }
    if (c.state !== 'drive') { c.speed = damp(c.speed, 0, 4, dt); continue; }
    if (c.leaving) { if (!c.path || c.pi >= c.path.length) { const far = _v.subVectors(c.pos, p.position).setY(0).normalize(); c.path = roadPath(c.node, c.pos.x + far.x * 200, c.pos.z + far.z * 200); c.pi = 0; if (!c.path) { c.state = 'parked'; continue; } } }
    else {
      const spot = playerSpot(); const target = spot.indoor ? spot.zone.doors[c.vid % spot.zone.doors.length] : (t - K.seenT < 8 ? p.position : K.lastKnown);
      c.replanT -= dt;
      if (!c.path || c.replanT <= 0 || c.pi >= c.path.length) { c.replanT = veh ? 1.2 : 3; const from = c.path && c.pi < c.path.length && c.path[c.pi].node >= 0 ? c.path[c.pi].node : c.node; const np = roadPath(from, target.x, target.z); if (np) { c.path = np; c.pi = 0; } }
      const dp = hyp(c.pos.x, c.pos.z, p.position.x, p.position.z);
      // arrived: bail out (unless the player is driving off — then keep pursuing)
      const pSpeed = veh ? Math.abs(veh.speed || 0) : 0;
      if (!c.leaving && ((dp < 24 && pSpeed < 4) || (c.path && c.pi >= c.path.length - 1 && hyp(c.pos.x, c.pos.z, c.path[c.path.length - 1].x, c.path[c.path.length - 1].z) < 5 && pSpeed < 4))) { bail(c); continue; }
      // drive-by fire while pursuing
      c.fireT -= dt; if (dp < 34 && c.fireT <= 0) { c.fireT = 1.4 + (ctx.rng?.() ?? Math.random()) * 1.2; carFire(c, dp); }
      if (dp < 70 && t - c.seenT > 0.5 && (ctx.time.frame + c.vid) % 20 === 0 && carSees(c)) { c.seenT = t; K.seenT = t; K.lastKnown.copy(p.position); }
    }
    drive(c, dt, veh);
  }
}
const COP_HL = 2.4, COP_HW = 0.95, COP_GAP = 2.5, COP_LANE = 1.9, UNSTICK_V = 3;   // m: half length / width; bumper gap; right of the centreline; m/s eased apart once overlapping
// moveBlocked lets an already-overlapping pair stand their ground (so a car spawned atop one isn't frozen solid); nothing then ever
// pulls them apart, so a cop that spawned on a traffic car, or got shoved into one mid-turn, could sit embraced with it forever.
// Ease it directly away from the centre of whatever it overlaps until clear, ahead of the normal drive this frame.
function unstick(c, dt) {
  const o = c.sol; if (!o) return false;
  for (const q of solidsNear(o.x, o.z, o.hl + 3)) { if (q === o || q.ghost || !obbOverlap(o.x, o.z, o.h, o.hl, o.hw, q)) continue;
    const dx = o.x - q.x, dz = o.z - q.z, d = Math.hypot(dx, dz) || 1, push = UNSTICK_V * dt;
    c.pos.x += dx / d * push; c.pos.z += dz / d * push; o.x = c.pos.x; o.z = c.pos.z; return true; }
  return false;
}
function drive(c, dt, veh) {
  if (unstick(c, dt)) { c.pos.y = K.W.groundHeight?.(c.pos.x, c.pos.z) ?? 0; place(c); return; }
  const p = K.ctx.player.position;
  if (!c.path || c.pi >= c.path.length) { c.speed = damp(c.speed, 0, 3, dt); return; }
  let wp = c.path[c.pi];
  while (wp && hyp(wp.x, wp.z, c.pos.x, c.pos.z) < 4.5) { if (wp.node >= 0) c.node = wp.node; c.pi++; wp = c.path[c.pi]; }
  if (!wp) return;
  // keep right: aim at the waypoint moved COP_LANE to the right of the street (the centreline put it face to face with oncoming traffic)
  const pv = c.path[c.pi - 1] || c.pos, sx = wp.x - pv.x, sz = wp.z - pv.z, sl = Math.hypot(sx, sz) || 1, ax = wp.x - sz / sl * COP_LANE, az = wp.z + sx / sl * COP_LANE;
  const want = Math.atan2(-(ax - c.pos.x), -(az - c.pos.z)); const dh = wrap(want - c.heading);
  const next = c.path[c.pi + 1]; let corner = 0; if (next) corner = Math.abs(wrap(Math.atan2(-(next.x - wp.x), -(next.z - wp.z)) - want));
  const toWp = hyp(wp.x, wp.z, c.pos.x, c.pos.z);
  let vmax = c.leaving ? 12 : c.patrol && !K.stars ? 9 : veh ? CAR_PURSUIT : CAR_SPEED;
  if (Math.abs(dh) > 0.5) vmax = Math.min(vmax, 5); if (corner > 0.6 && toWp < 25) vmax = Math.min(vmax, 7 + toWp * 0.35);
  if (c.pi === c.path.length - 1) vmax = Math.min(vmax, 3 + toWp * 0.6);
  // don't run the player over / rear-end another car
  const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
  const ahead = (x, z, r) => { const dx = x - c.pos.x, dz = z - c.pos.z; const f = dx * fx + dz * fz; return f > 0 && f < r && Math.abs(dx * -fz + dz * fx) < 2.2; };
  if (!veh && ahead(p.x, p.z, 9)) vmax = 0;
  // every vehicle ahead (traffic, buses, the Uber, other cop cars, yours): follow with a gap, and never move into one
  if (c.sol) { const a = solidAhead(c.sol, c.pos.x, c.pos.z, c.heading, COP_HL, COP_HW, 20, 0.1); if (a.o) vmax = Math.min(vmax, Math.max(0, a.v) + Math.max(0, a.gap - COP_GAP) * 0.9); }
  c.speed = damp(c.speed, vmax, c.speed < vmax ? 1.6 : 4, dt);
  c.heading = wrap(c.heading + Math.max(-1, Math.min(1, dh * 2.5)) * Math.min(2.2, 0.25 + c.speed * 0.25) * dt);
  const nx = c.pos.x - Math.sin(c.heading) * c.speed * dt, nz = c.pos.z - Math.cos(c.heading) * c.speed * dt;
  if (c.sol) { c.sol.x = c.pos.x; c.sol.z = c.pos.z; c.sol.h = c.heading; c.sol.v = c.speed; }   // keep the self box's heading live too: stale (grid-refresh-only) heading mid-turn let the "already overlapping" check miss a fresh overlap
  if (c.sol && moveBlocked(c.sol, nx, nz, c.heading)) c.speed = 0; else { c.pos.x = nx; c.pos.z = nz; }
  c.pos.y = K.W.groundHeight?.(c.pos.x, c.pos.z) ?? 0;
  c.body.rotation.z = Math.max(-0.05, Math.min(0.05, -dh * c.speed * 0.01));
  place(c);
}
function carSees(c) {
  const cam = K.ctx.player.eye ? K.ctx.player.eye() : K.ctx.player.position; _v.set(c.pos.x, c.pos.y + 1.3, c.pos.z);
  const d = _v.distanceTo(cam); _ray.set(_v, _v2.subVectors(cam, _v).normalize()); _ray.near = 1.2; _ray.far = d - 0.4;
  try { for (const h of _ray.intersectObjects(K.ctx.raycastTargets, false)) { if (h.object.userData.soldier || h.object.userData.noLOS || h.object.userData.vehicle === K.ctx.vehicles?.mounted) continue; return false; } } catch { return false; }
  return true;
}
function carFire(c, dp) {
  // no drive-bys over a one-star beef
  if (!c.manned || !carSees(c) || K.stars < 2) return;
  const ctx = K.ctx, p = ctx.player, rng = ctx.rng || Math.random;
  c.seenT = K.t; K.seenT = K.t; K.lastKnown.copy(p.position);
  const o = new THREE.Vector3(c.pos.x, c.pos.y + 1.25, c.pos.z);
  for (let k = 0; k < 3; k++) setTimeout(() => {
    if (!K || c.gone || p.dead) return;
    const tgt = new THREE.Vector3(p.position.x, p.position.y + 1.1, p.position.z); const dir = tgt.sub(o).normalize();
    const spread = 0.035 + dp * 0.0022; dir.x += (rng() - 0.5) * spread * 2; dir.y += (rng() - 0.5) * spread; dir.z += (rng() - 0.5) * spread * 2; dir.normalize();
    const hit = rng() < Math.max(0.12, 0.45 - dp * 0.01);
    ctx.bus.emit('shot', { origin: o.clone(), dir, weapon: 'pistol', who: 'enemy', hit });
    if (hit && ctx.state === 'playing') try { p.damage?.(5 + Math.floor(rng() * 5), c.pos.clone()); } catch {}
  }, k * 140);
}
function stealCop() {
  const c = K.copTarget, ctx = K.ctx, V = ctx.vehicles; if (!c || !V?.spawnCar) return;
  const v = V.spawnCar(c.pos.x, c.pos.z, c.heading, 'sedan', 0xf2f2ee, c.pos.y); if (!v) return;
  // the livery: stripes, lightbar and its lamps (the boxes on the chase car's body) onto the drivable car's body, same frame
  const lamps = []; for (const m of c.body.children) { if (m.isGroup || m.geometry?.type !== 'BoxGeometry') continue; const q = m.clone(); v.body.add(q); if (c.lamps.includes(m)) lamps[c.lamps.indexOf(m)] = q; }
  K.stolen = { v, lamps };
  disposeCar(c); K.cars.splice(K.cars.indexOf(c), 1); K.copTarget = null;
  V.mount(v); K.stars = Math.max(K.stars, 3); K.seenT = K.t;
  HK.toast('You stole a cop car. Every cop in Brooklyn just heard about it. ★★★', 3200);
}
function bail(c) {
  c.state = 'stopped'; c.manned = false; c.speed = 0;
  const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading), rx = -fz, rz = fx; const nav = K.ctx.ai.nav;
  let n = 0;
  for (const s of [-1, 1]) {
    if (counts().cops >= MAX_COPS) break;
    const q = nav.nearestFree(c.pos.x + rx * s * 2.1 + fx * 0.4, c.pos.z + rz * s * 2.1 + fz * 0.4, 4, 0); if (!q || noGo(q.x, q.z, q.y)) continue;
    const u = spawnUnit('cop', q, c); n++;
    u.s.yaw = Math.atan2(rx * s, rz * s);
  }
  if (!n) { c.manned = true; c.state = 'drive'; }   // nowhere to get out: keep pursuing from the car
}

// ---------------------------------------------------------------------------------------------------------------------------
// crew motorbikes (visual: the rider is the soldier, raised onto the seat with legs folded)
function makeBikeMesh() {
  let b; try { b = buildBike(K.ctx); } catch (e) { return null; }
  b.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.surface = 'metal'; } });
  if (b.headlight) { b.headlight.visible = false; }
  K.ctx.scene.add(b.group); return b;
}
function syncBike(u, dt) {
  const b = u.bike; if (!b) return; const s = u.s;
  if (s.dead) {
    if (!u.bikeDown) { u.bikeDown = { side: (s.id % 2 ? 1 : -1), k: 0 }; s.riding = null; }
    u.bikeDown.k = Math.min(1, u.bikeDown.k + dt * 2.5); b.group.rotation.z = u.bikeDown.side * u.bikeDown.k * 1.45; b.group.position.y = s.position.y + 0.05; return;
  }
  b.group.position.set(s.position.x, s.position.y, s.position.z); b.group.rotation.set(0, s.yaw + Math.PI, 0);
  if (b.wheelF) b.wheelF.rotation.x -= s.speed * dt / 0.33; if (b.wheelR) b.wheelR.rotation.x -= s.speed * dt / 0.33;
}
function disposeBike(u) { if (u.bike) K.ctx.scene.remove(u.bike.group); u.bike = null; }

// ---------------------------------------------------------------------------------------------------------------------------
// online: send our chasers, render everyone else's
function sendState() {
  const net = K.ctx.net; if (!net?.send || !net.connected) return;
  const c = [], v = [];
  for (const u of K.units) { const s = u.s; c.push([u.uid, LOOK_CODE[u.kind], +s.position.x.toFixed(2), +s.position.y.toFixed(2), +s.position.z.toFixed(2), +s.yaw.toFixed(2), +s.speed.toFixed(1), (s.burst > 0 ? 1 : 0) | (s.dead ? 2 : 0) | (s.crouch > 0.5 ? 4 : 0)]); }
  for (const car of K.cars) v.push([car.vid, +car.pos.x.toFixed(2), +car.pos.z.toFixed(2), +car.heading.toFixed(2), (car.manned || K.units.some((u) => u.car === car && !u.s.dead)) ? 1 : 0]);
  if (!c.length && !v.length) { if (K.sentEmpty) return; K.sentEmpty = true; } else K.sentEmpty = false;
  net.send('chase', { s: K.stars, h: K.crew.heat, c, v });
}
function onRemote(m) {
  if (!K || !m?.f || !Array.isArray(m.c)) return; const ai = K.ctx.ai; if (!ai?.createPuppet) return;
  let R = K.remotes.get(m.f); if (!R) { R = { puppets: new Map(), cars: new Map(), seen: 0 }; K.remotes.set(m.f, R); }
  R.seen = performance.now(); R.stars = m.s | 0;
  const live = new Set();
  for (const e of m.c) {
    if (!Array.isArray(e) || e.length < 8) continue; const [id, code, x, y, z, yaw, sp, fl] = e; live.add(id);
    let q = R.puppets.get(id);
    if (!q) { const s = ai.createPuppet(CODE_LOOK[code] || 'cop'); s.placeAt(new THREE.Vector3(x, y, z), yaw); q = { s, code, tgt: { x, y, z, yaw, sp }, fl: 0, flashT: 0 }; if (code === 2) { q.bike = makeBikeMesh(); s.riding = { seat: 0.2 }; s.crouch = s.crouchTarget = 0.62; } R.puppets.set(id, q); }
    q.tgt = { x, y, z, yaw, sp }; q.fl = fl | 0;
    if ((fl & 2) && !q.s.dead) { ai.puppetKill(q.s, new THREE.Vector3(Math.sin(yaw + Math.PI), 0.2, Math.cos(yaw + Math.PI))); q.s.riding = null; }
  }
  for (const [id, q] of R.puppets) if (!live.has(id)) { dropPuppet(q); R.puppets.delete(id); }
  const liveV = new Set();
  for (const e of m.v || []) {
    if (!Array.isArray(e) || e.length < 5) continue; const [id, x, z, h, on] = e; liveV.add(id);
    let q = R.cars.get(id); if (!q) { q = { ...buildCopCarMesh(), pos: new THREE.Vector3(x, 0, z), heading: h }; q.group.position.set(x, 0, z); q.group.rotation.y = h; R.cars.set(id, q); }
    q.tgt = { x, z, h }; q.on = !!on;
  }
  for (const [id, q] of R.cars) if (!liveV.has(id)) { K.ctx.scene.remove(q.group); R.cars.delete(id); }
}
function dropPuppet(q) { K.ctx.ai.releasePuppet(q.s); if (q.bike) K.ctx.scene.remove(q.bike.group); }
function updateRemotes(dt) {
  if (!K.remotes.size) return; const now = performance.now(), cam = K.ctx.camera.position, ctx = K.ctx;
  for (const [f, R] of K.remotes) {
    if (now - R.seen > 3500 || (ctx.net && !ctx.net.peer?.(f))) { for (const q of R.puppets.values()) dropPuppet(q); for (const q of R.cars.values()) ctx.scene.remove(q.group); K.remotes.delete(f); continue; }
    const owner = ctx.net?.peer?.(f);
    for (const q of R.puppets.values()) {
      const s = q.s, g = q.tgt;
      if (s.dead) { if (s.ragdoll && !s.ragdoll.settled && dt > 0) { s.ragdoll.step(dt); s.ragdoll.apply(); } if (q.bike) { q.bike.group.rotation.z = damp(q.bike.group.rotation.z, 1.45, 5, dt); } continue; }
      const far = hyp(g.x, g.z, cam.x, cam.z) > 140; s.group.visible = !far; if (q.bike) q.bike.group.visible = !far;
      if (hyp(s.position.x, s.position.z, g.x, g.z) > 8) s.position.set(g.x, g.y, g.z);
      s.position.x = damp(s.position.x, g.x, 8, dt); s.position.y = damp(s.position.y, g.y, 8, dt); s.position.z = damp(s.position.z, g.z, 8, dt);
      s.yaw = wrap(s.yaw + wrap(g.yaw - s.yaw) * (1 - Math.exp(-8 * dt))); s.speed = g.sp; s.crouchTarget = q.bike ? 0.62 : (q.fl & 4 ? 0.5 : 0);
      if (owner && hyp(owner.pos.x, owner.pos.z, s.position.x, s.position.z) < 45) s.setAim(_v.set(owner.pos.x, owner.pos.y + 1.2, owner.pos.z)); else s.clearAim();
      if (q.fl & 1) { q.flashT -= dt; if (q.flashT <= 0) { q.flashT = 0.1; s.showFlash(); if (owner) { const o = s.muzzleWorld(new THREE.Vector3()); const d = _v2.set(owner.pos.x - o.x, owner.pos.y + 1.1 - o.y, owner.pos.z - o.z).normalize(); try { ctx.weapons?.fx?.enemyShot?.(o, d.clone()); } catch {} try { ctx.audio?.play?.('enemy_rifle', { position: { x: o.x, y: o.y, z: o.z } }); } catch {} } } }
      if (!far) { s.updateAim(dt); s.updateVisual(dt); }
      if (q.bike) { q.bike.group.position.set(s.position.x, s.position.y, s.position.z); q.bike.group.rotation.set(0, s.yaw + Math.PI, 0); }
    }
    for (const q of R.cars.values()) {
      const g = q.tgt; if (!g) continue;
      if (hyp(q.pos.x, q.pos.z, g.x, g.z) > 15) q.pos.set(g.x, 0, g.z);
      q.pos.x = damp(q.pos.x, g.x, 6, dt); q.pos.z = damp(q.pos.z, g.z, 6, dt); q.pos.y = K.W.groundHeight?.(q.pos.x, q.pos.z) ?? 0;
      q.heading = wrap(q.heading + wrap(g.h - q.heading) * (1 - Math.exp(-6 * dt)));
      q.group.position.copy(q.pos); q.group.rotation.y = q.heading; lampFlash(q, q.on, K.t + performance.now() / 1000);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// HUD: wanted stars, top centre-right; flashing while you are out of sight (evading); the crew line under it
function buildUI() {
  const css = document.createElement('style'); css.textContent = `
  .chwanted{position:fixed;top:calc(max(10px,env(safe-area-inset-top)) + clamp(78px,11vh,96px));right:calc(max(14px,env(safe-area-inset-right)) + 4px);left:auto;z-index:41;pointer-events:none;text-align:right;opacity:0;transition:opacity .35s;font-family:'Barlow Condensed',Arial,sans-serif}
  .chwanted.on{opacity:1}
  .chwanted .st{font-size:clamp(22px,3.6vw,34px);letter-spacing:.06em;line-height:1;white-space:nowrap}
  .chwanted .st i{font-style:normal;color:rgba(255,255,255,.2);text-shadow:0 1px 2px rgba(0,0,0,.8);-webkit-text-stroke:1px rgba(0,0,0,.55)}
  .chwanted .st i.f{color:#ffd23c;text-shadow:0 0 10px rgba(255,190,40,.55),0 1px 2px #000}
  .chwanted.ev .st i.f{animation:chblink .6s steps(2,start) infinite}
  .chwanted .cr{margin-top:3px;font-size:clamp(12px,1.9vw,16px);font-weight:700;letter-spacing:.14em;color:#ff5a4a;text-shadow:0 1px 2px #000;display:none}
  .chwanted .cr.on{display:block}
  @keyframes chblink{to{opacity:.25}}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.className = 'chwanted';
  el.innerHTML = `<div class="st">${'<i>★</i>'.repeat(5)}</div><div class="cr">⚠ BLOCK IS HOT</div>`;
  document.body.appendChild(el);
  K.ui = { el, stars: [...el.querySelectorAll('.st i')], crew: el.querySelector('.cr'), key: '' };
}
function renderUI() {
  if (!K?.ui) return; const t = K.t;
  const show = K.ctx.state !== 'menu' && (K.stars > 0 || K.crew.heat > 0);
  const ev = K.stars > 0 && t - K.seenT > 4;
  const key = `${show}|${K.stars}|${ev}|${K.crew.heat}`; if (key === K.ui.key) return; K.ui.key = key;
  K.ui.el.classList.toggle('on', show); K.ui.el.classList.toggle('ev', ev);
  K.ui.stars.forEach((s, i) => s.classList.toggle('f', i < K.stars));
  K.ui.crew.classList.toggle('on', K.crew.heat > 0);
}

// shared knowledge: cops share the radio's last known position; the crew just know their blocks
function lastKnownFor(u) { return u.kind === 'cop' ? K.lastKnown : K.ctx.player.position; }

/** QA hooks (window.__game.chase) */
export const chaseQA = {
  state: () => K && { stars: K.stars, crew: K.crew.heat, evadeIn: K.stars ? +(Math.min(EVADE_MAX, EVADE_BASE + EVADE_PER_STAR * K.stars) - (K.t - K.seenT)).toFixed(1) : 0, units: K.units.map((u) => ({ kind: u.kind, dead: !!u.s.dead, leaving: u.leaving, pos: u.s.position.toArray().map((v) => +v.toFixed(1)), sees: !!u.s.seesPlayer, noGo: noGo(u.s.position.x, u.s.position.z, u.s.position.y) })), cars: K.cars.map((c) => ({ pos: c.pos.toArray().map((v) => +v.toFixed(1)), state: c.state, manned: c.manned, speed: +c.speed.toFixed(1), path: c.path ? c.path.length - c.pi : 0 })), remotes: [...K.remotes.values()].map((R) => ({ puppets: R.puppets.size, cars: R.cars.size, stars: R.stars, pos: [...R.puppets.values()].slice(0, 3).map((q) => q.s.position.toArray().map((v) => +v.toFixed(1))) })), zones: K.zones.length, roads: K.roads.nodes.length },
  crime: (type = 'shot', pos, opts) => crime(type, pos || K.ctx.player.position, opts),
  report: (type = 'shot') => apply(type, K.ctx.player.position, true, false),
  dmg: () => K && K.units.filter((u) => u.kind === 'cop' && !u.s.dead).map((u) => ({ dmg: u.s.dmgMul, stars: K.stars })),
  search: () => K && { stars: K.stars, outT: +(K.outT || 0).toFixed(1), r: K.stars ? searchR() : 0, evading: !!K.evading, patrols: K.units.filter((u) => u.patrol && !u.s.dead).length, cruisers: K.cars.filter((c) => c.patrol && !c.gone).length },
  stars: (n) => { K.stars = Math.max(0, Math.min(5, n | 0)); K.seenT = K.t; K.lastKnown.copy(K.ctx.player.position); K.carT = 0; K.footT = 0; renderUI(); return K.stars; },
  crew: () => { const nt = nearestTower(K.ctx.player.position); K.crew.heat = 1; K.crew.seenT = K.t; K.crew.tower = nt?.t || null; K.crew.spawned = 0; K.crewT = 0; renderUI(); return !!nt; },
  clear: () => wasted(),
  spawnCar: () => !!spawnCar(),
  copBail: (dx = 5) => { const c = spawnCar(); if (!c) return false; const p = K.ctx.player.position; c.pos.set(p.x + dx, K.W.groundHeight?.(p.x + dx, p.z) ?? 0, p.z); place(c); bail(c); c.state = 'stopped'; c.manned = false; return true; },
  stolen: () => !!K.stolen && K.ctx.vehicles?.mounted === K.stolen.v,
  copTarget: () => K.copTarget ? { st: K.copTarget.state, manned: K.copTarget.manned, leaving: K.copTarget.leaving, d: +K.copTarget.pos.distanceTo(K.ctx.player.position).toFixed(1) } : (K.cars.map((c) => ({ st: c.state, manned: c.manned, leaving: c.leaving, gone: !!c.gone, d: +c.pos.distanceTo(K.ctx.player.position).toFixed(1) }))),
  spawn: (kind = 'cop', dmin = 12, dmax = 20) => { const at = spawnPoint(K.ctx.player.position, dmin, dmax, null); return at ? !!spawnUnit(kind, at) : false; },
  zones: () => K.zones.map((z) => ({ c: [+z.c.x.toFixed(1), +z.c.z.toFixed(1)], ha: +z.ha.toFixed(1), hc: +z.hc.toFixed(1), doors: z.doors.map((d) => [+d.x.toFixed(1), +d.z.toFixed(1)]) })),
  noGo: (x, z, y = 0) => noGo(x, z, y),
  // coney/airsupport.js: the chopper drops its cops, stolen police hardware is three stars on the spot
  starsNow: () => (K ? K.stars : 0),
  seenAgo: () => (K ? K.t - K.seenT : 1e9), lastKnown: () => K?.lastKnown || null,
  spotted: (pos) => { if (K && K.stars) { K.seenT = K.t; K.lastKnown.copy(pos); } },   // the chopper picked you up
  spawnCopAt: (at) => (K ? spawnUnit('cop', at) : null),
  raise: (n, pos) => { if (!K || K.stars >= n) return; K.stars = Math.min(5, n); K.seenT = K.t; K.lastKnown.copy(pos || K.ctx.player.position); K.carT = Math.min(K.carT, 1); renderUI(); },
};

// CONEY — ride the F. One six-car R160 F train shuttles on the wall clock (every client sees the same train) along the real
// OSM alignment: Coney Island–Stillwell Av (track 3, the F) → out of the terminal's south throat, east along the el →
// W 8 St–NY Aquarium (upper level, where the F stops) → north up the Culver el over Shell Rd → Neptune Av, and back.
// Doors open at every stop: F (touch: BOARD F) or just walk in through an open door; F / GET OFF or walk out at a stop to get
// off. Aboard you walk the car's aisle (it carries you and turns you on the curves); the chime and the stop announcements are
// the real ones. Signposting: green globe lamps + F bullets at every entrance, an "F ↑" sign over Stillwell's F stairs, a
// next-train HUD in / near the stations, the train on the minimap. Online, riders are sent in car coordinates (net.js). Neptune Av (elevated, side platforms, stairs
// down to Shell Rd & Neptune Ave) is built here, with the el structure from W 8 St up to it. CONEY agent (subway).
import * as THREE from 'three';
import { OSM } from './osm.js';
import { W8 } from './w8th.js';
import { hangkit as K } from '../hangkit.js';
import { makeR160, drawLED, rideAudio, pa, carProxy, proxyMaterial, LOD_NEAR } from './r160.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch } from '../sbu/geo.js';
import { buildYard } from './yard.js';

const CAR = 18.4, NCAR = 6, LEN = CAR * NCAR, RAIL = 7.5, FLOOR = 1.1;   // car floor = platform height above top of rail
const VMAX = 13, ACC = 1.1, DWELL = { STW: 30, W8: 20, NEP: 30, OCP: 25, B50: 25 };
const STW_X = -54.8, STW_Z0 = -440, STW_ZS = -266;                         // Stillwell track 3 (F): platform north → south end
const NEP_Z = -492, YARD_JZ = -570;   // YARD_JZ: where the yard lead leaves the el                                                        // Neptune Av: where the Culver el crosses Neptune Ave
// the three lines out of Stillwell, on their real tracks and OSM alignments. Stops past the map edge are `hidden`: the train
// runs on out of sight and comes back; riders are put off at the last stop in the map (the announcements stay right).
const LINES_CFG = [
  { id: 'F', color: '#ff6319', fg: '#fff', stwX: STW_X, dir: 'S', dst: [520, NEP_Z - 40, (v) => v[0] > 440 && v[1] < NEP_Z + 60], w8: 'UP', ext: 40, off: 0,
    dest: { out: 'Jamaica-179 St', in: 'Coney Island|Stillwell Av' }, bound: { out: 'Jamaica–179th Street–bound F local', in: 'Coney Island–bound F' },
    strip: ['Stillwell Av', 'W 8 St', 'Neptune Av', 'Avenue X', 'Avenue U', 'Kings Hwy', 'Avenue P', 'Avenue N', 'Bay Pkwy', 'Avenue I'] },
  { id: 'Q', color: '#fccc0a', fg: '#111', stwX: -44, dir: 'S', dst: [823, -105, (v) => v[0] > 800], w8: 'LO', ext: 520, off: 97, bend: { x: 1035, h: -0.138 },
    dest: { out: '96 St-2 Av', in: 'Coney Island|Stillwell Av' }, bound: { out: '96th Street–bound Q', in: 'Coney Island–bound Q' },
    strip: ['Stillwell Av', 'W 8 St', 'Ocean Pkwy', 'Brighton Bch', 'Sheepshead Bay', 'Neck Rd', 'Avenue U', 'Kings Hwy', 'Avenue M', 'Avenue J'] },
  { id: 'D', color: '#ff6319', fg: '#fff', stwX: -58.2, dir: 'N', dst: [-21, -668, (v) => v[1] < -640], w8: null, ext: 340, off: 41,
    dest: { out: 'Norwood-205 St', in: 'Coney Island|Stillwell Av' }, bound: { out: 'Norwood–205th Street–bound D', in: 'Coney Island–bound D' },
    strip: ['Stillwell Av', 'Bay 50 St', '25 Av', 'Bay Pkwy', '20 Av', '18 Av', '79 St', '71 St', '62 St', 'Ft Hamilton'] },
  // the N: a Sea Beach express straight to 8 Av (Soccer Tavern) — every minute (a short dwell, it turns just past the throat)
  { id: 'N', color: '#fccc0a', fg: '#111', stwX: -44, dir: 'N', dst: [-21, -668, (v) => v[1] < -640], w8: null, ext: 60, off: 7, turn: 58, dwell: 22,
    dest: { out: '8 Av|Sunset Park', in: 'Coney Island|Stillwell Av' }, bound: { out: '8th Avenue–bound N express', in: 'Coney Island–bound N' },
    strip: ['Stillwell Av', '8 Av'] },
];
const NAMES = { STW: ['Coney Island–Stillwell Av', 'Coney Island–Stillwell Avenue'], W8: ['W 8 St–NY Aquarium', 'West 8th Street–New York Aquarium'], NEP: ['Neptune Av', 'Neptune Avenue'],
  OCP: ['Ocean Pkwy', 'Ocean Parkway'], N8: ['8 Av', '8th Avenue, Sunset Park'], BRT: ['Brighton Beach', 'Brighton Beach'], B50: ['Bay 50 St', 'Bay 50th Street'], A25: ['25 Av', '25th Avenue'] };
const LINES = [], STN = {}, G = { hudT: 0 }; let MAPR = null, MAPS = null;   // G: the shared HUD / clocks / PA state
let R = null, SKEW = 0, YD = null;   // YD: Coney Island Yard (coney/yard.js)
const W8U = new THREE.Vector2(W8.P1.x - W8.P0.x, W8.P1.y - W8.P0.y).normalize();   // R: the line being updated (every function below works on R)

export function buildSubway(world) {
  const { ctx, W } = world;
  for (const cfg of LINES_CFG) {
    R = { world, ctx, W, cfg, id: cfg.id, off: cfg.off, li: LINES.length, aboard: null, lastAnn: '', t: 0 }; let first = null;
    try { if (buildLine()) { LINES.push(R); first = R; } } catch (e) { console.warn('[subway] line', cfg.id, e); }
    // more trains on the line: a train every HEADWAY s (up to the cap), each a share of the cycle later, nudged so two never share a track
    if (!first) continue; const k = Math.min(ctx.safeMode ? 1 : ctx.lite ? TRAINS_LITE : TRAINS_MAX, Math.ceil(first.cycle / HEADWAY)); first.k = k;
    const offs = spacing(first, k); first.k = offs.length;
    for (let j = 1; j < offs.length; j++) { R = { world, ctx, W, cfg, id: cfg.id, off: cfg.off + offs[j], li: LINES.length, aboard: null, lastAnn: '', t: 0, extraOf: first }; try { if (buildLine()) LINES.push(R); } catch (e) { console.warn('[subway] extra train', cfg.id, e); } }
    if (offs.length > 1) console.log(`[subway] ${cfg.id}: ${offs.length} trains, every ~${Math.round(first.cycle / offs.length)} s`);
  }
  if (!LINES.length) return; R = LINES[0];
  // Coney Island Yard: its lead turns off the West End / Sea Beach el (the D and the N share it here) north of Neptune Ave
  try { const X = LINES.find((q) => q.id === 'D' && !q.extraOf) || LINES.find((q) => q.id === 'N' && !q.extraOf), i = X ? X.P.findIndex((p) => p.z < YARD_JZ) : -1;
    if (i > 3 && i < X.P.length - 4) { const J = X.P[i], dir = X.P[i + 3].clone().sub(X.P[i - 3]).setY(0).normalize();
      YD = buildYard(world, { J, dir, rail: J.y, sources: LINES.filter((q) => !q.extraOf && (q.id === 'F' || q.id === 'Q')).map((q) => q.cars), car: { CAR, NCAR } }); } } catch (e) { console.warn('[subway] yard', e); }
  world.updaters.push((dt) => { for (const L of LINES) { R = L; update(dt); } R = LINES.find((L) => L.aboard) || LINES[0]; const t = now() % R.cycle; hud(t); if ((G.hudT & 7) === 1) stationLife(); });
  addEventListener('keydown', (e) => { const L = LINES.find((q) => q.aboard); if (L && L.canAlight && e.code === 'KeyF' && !e.repeat && ctx.state === 'playing') { e.preventDefault(); e.stopImmediatePropagation(); R = L; alight(); } }, true);   // F at a stop: off (before the weapon's inspect grabs F)
  const offAll = () => { for (const L of LINES) if (L.aboard) { R = L; alight(true); } };
  ctx.bus.on('playerDied', offAll); ctx.bus.on('worldReset', offAll);
  R = LINES[0]; buildEntrances(world);
  // for net.js (riders are sent in car coordinates: line × 10 + car, so a friend on the same train stays inside it) and the map
  const F = LINES[0];
  ctx.subway = {
    local: () => { const L = LINES.find((q) => q.aboard); return L ? [L.li * 10 + L.aboard.c, +L.aboard.lx.toFixed(2), +L.aboard.lz.toFixed(2)] : null; },
    toWorld: (c, lx, lz, out = new THREE.Vector3()) => { const L = LINES[Math.floor(c / 10)], g = L?.cars[c % 10]; if (!g) return null; g.updateMatrixWorld(); return out.set(lx, FLOOR, lz).applyMatrix4(g.matrixWorld); },
    train: () => { const a = F.cars[0].position, b = F.cars[NCAR - 1].position; return [a.x, a.z, b.x, b.z]; },
    routes: () => MAPR || (MAPR = LINES.filter((L) => !L.extraOf).map((L) => ({ id: L.id, color: L.id === 'D' ? '#c9500f' : L.cfg.color, dash: L.id === 'D', w: L.id === 'Q' ? 3.2 : 2, pts: L.P.filter((p, i) => i % 8 === 0 || i === L.P.length - 1).map((p) => [p.x, p.z]) })).concat(YD ? YD.tracks.map((P) => ({ id: 'YARD', color: '#8a8f96', dash: false, w: 1.2, pts: P.filter((p, i) => p.s >= P.branch - 2 && (i % 6 === 0 || i === P.length - 1)).map((p) => [p.x, p.z]) })) : []).sort((a, b) => b.w - a.w)),
    stations: () => MAPS || (MAPS = [{ id: 'STW', x: -47, z: -330, r: 'DFNQ' }, { id: 'W8', x: w8Pt(W8.L / 2, 0, 0).x, z: w8Pt(W8.L / 2, 0, 0).z, r: 'FQ' }, ...[['NEP', 'F'], ['OCP', 'Q'], ['B50', 'D']].filter(([id]) => STN[id]).map(([id, r]) => ({ id, x: STN[id].c.x, z: STN[id].c.z, r }))].map((q) => ({ ...q, name: NAMES[q.id][0] }))),
    trains: () => LINES.map((L) => { const a = L.cars[0].position, b = L.cars[NCAR - 1].position; return { id: L.id, color: L.cfg.color, seg: [a.x, a.z, b.x, b.z] }; }),
  };
  const api = (L) => { const w = (f) => (...a) => { const pr = R; R = L; try { return f(...a); } finally { R = pr; } };
    return {
      state: w(() => ({ line: L.id, aboard: !!L.aboard, leg: legNow().kind, stop: legNow().stop?.id || null, head: +headS().toFixed(1), cycle: +L.cycle.toFixed(1), L: +L.L.toFixed(1), door: L.boardable ? L.doorPos.toArray().map((v) => +v.toFixed(2)) : null, pos: ctx.player.position.toArray().map((v) => +v.toFixed(2)) })),
      stops: w(() => L.stops.map((q) => ({ id: q.id, s: +q.s.toFixed(1), hidden: !!q.hidden, at: ptAt(q.s - LEN / 2).toArray().map((v) => +v.toFixed(1)) }))),
      until: w((id, dir) => { const t = now() % L.cycle; const l = L.legs.find((g) => g.kind === 'dwell' && g.stop.id === id && (dir == null || g.dir === dir)); return l ? ((l.t0 - t) % L.cycle + L.cycle) % L.cycle : null; }),
      debug: w(() => ({ side: { ...L.sideCache }, cars: L.cars.map((g) => g.position.toArray().map((v) => +v.toFixed(1))), open: L.lastOpen })),
      carMatrices: () => L.cars.map((g) => { g.updateMatrixWorld(true); return g.matrixWorld.toArray(); }),   // qa/q-route-test.mjs: each car's world pose
      nepStairs: () => STN.NEP?.stairs, stnStairs: (id) => STN[id] && { stairs: STN[id].stairs, plat: STN[id].plat }, stnAt: (id, a, o) => { const S = STN[id]; if (!S) return null; const p = S.at(a, o, S.plat); return [p.x, p.y, p.z, S.ang]; }, board: w(() => board()), alight: w(() => alight()), skew: (sec) => { SKEW += sec; },
      drive: w((dir) => takeControls(dir ?? 1)), driving: w(() => L.drive && { s: +L.drive.s.toFixed(1), v: +L.drive.v.toFixed(2), lever: +L.drive.lever.toFixed(2), doors: +L.drive.doors.toFixed(2), at: L.drive.at?.id || null, tripped: L.drive.tripped, limit: L.drive.limit, dir: L.drive.dir, yk: L.drive.yk, ysJ: L.drive.ysJ, up: L.drive.yUp, L: +L.L.toFixed(1) }),
      driveSet: w((sv) => { if (L.drive) { L.drive.s = sv; L.drive.v = 0; } }), yard: () => YD && { free: YD.free(), parked: YD.parked(), J: [YD.J.x, YD.J.y, YD.J.z] }, stopDrive: w(() => leaveControls()),
    }; };
  if (typeof window !== 'undefined' && window.__game) window.__game.subway = { ...api(F), line: (id) => { const L = LINES.find((q) => q.id === id); return L ? api(L) : null; }, lines: () => [...new Set(LINES.map((q) => q.id))], trainsPer: () => Object.fromEntries([...new Set(LINES.map((q) => q.id))].map((id) => [id, LINES.filter((q) => q.id === id).length])) };
}
function buildLine() {
  const { ctx, world, cfg } = R;
  if (R.extraOf) {   // another train on a line already built: same track, stops and timetable, its own cars and boarding
    const X = R.extraOf; Object.assign(R, { P: X.P, L: X.L, stops: X.stops, legs: X.legs, cycle: X.cycle, w8s0: X.w8s0, w8s1: X.w8s1, sideSign: X.sideSign });
    R.cars = buildTrain(world.scene); boardingSpot(); return true;
  }
  // ---- the route: the line's Stillwell track + the shortest OSM el path to its far end ----
  const path = routePath(cfg);
  if (!path || path.length < 4) { console.warn('[subway] no route', cfg.id); return false; }
  const P = resample(path, 2);
  let s = 0;
  if (cfg.w8) {   // snap onto this line's track through W 8 St (F upper north, Q lower south), ramp the height in / out over 90 m
    const lv = W8[cfg.w8], oT = cfg.w8 === 'UP' ? -W8.halfTrack : W8.halfTrack;
    const w8u = new THREE.Vector2(W8.P1.x - W8.P0.x, W8.P1.y - W8.P0.y).normalize();
    const w8a = (p) => (p.x - W8.P0.x) * w8u.x + (p.z - W8.P0.y) * w8u.y, w8o = (p) => -(p.x - W8.P0.x) * w8u.y + (p.z - W8.P0.y) * w8u.x;
    const inW8 = (p) => { const a = w8a(p); return a > -10 && a < W8.L + 10 && Math.abs(w8o(p)) < 12; };
    // onto this line's W 8 St track, blended in and out over 120 m of track past each end (a hard snap left a sideways step at the edge
    // of the station: the cars folded ~50° across it and swept through the pillars)
    { const ins = P.map((p, i) => (inW8(p) ? i : -1)).filter((i) => i >= 0);
      if (ins.length) { const i0 = ins[0], i1 = ins[ins.length - 1], snap = (p, k) => { const a = w8a(p), tx = W8.P0.x + w8u.x * a + (-w8u.y) * oT, tz = W8.P0.y + w8u.y * a + w8u.x * oT; p.x += (tx - p.x) * k; p.z += (tz - p.z) * k; };
        const orig = P.map((p) => [p.x, p.z]), sm = (t) => t * t * (3 - 2 * t);
        for (let i = i0; i <= i1; i++) snap(P[i], 1);
        for (const [from, step] of [[i0, -1], [i1, 1]]) { let dd = 0; for (let i = from + step; i >= 0 && i < P.length; i += step) { dd += Math.hypot(orig[i][0] - orig[i - step][0], orig[i][1] - orig[i - step][1]); if (dd > 120) break; snap(P[i], sm(1 - dd / 120)); } } } }
    P.forEach((p, i) => { if (i) s += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z); p.s = s; });
    const w8idx = P.map((p, i) => (inW8(p) ? i : -1)).filter((i) => i >= 0);
    if (w8idx.length) { R.w8s0 = P[w8idx[0]].s; R.w8s1 = P[w8idx[w8idx.length - 1]].s;
      for (const p of P) { const d = p.s < R.w8s0 ? R.w8s0 - p.s : p.s > R.w8s1 ? p.s - R.w8s1 : 0; const k = Math.max(0, 1 - d / 90); p.y = RAIL + (lv.rail - RAIL) * (k * k * (3 - 2 * k)); } }
  } else P.forEach((p, i) => { if (i) s += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z); p.s = s; });
  R.P = P; R.L = s;
  // stops (s of the train's HEAD = the end with larger s)
  const sAt = (pred) => { for (const p of P) if (pred(p)) return p.s; return null; };
  const st = (id, sv, o = {}) => ({ id, s: sv, name: NAMES[id][0], speak: NAMES[id][1], ...o });
  const sStw = cfg.dir === 'S' ? sAt((p) => p.z > STW_ZS - 2) ?? 180 : sAt((p) => p.z < STW_Z0 + 4) ?? 180;
  const sW8 = R.w8s0 != null ? (R.w8s0 + R.w8s1) / 2 + 6 + LEN / 2 : 0;
  let stops, seq;
  if (cfg.id === 'F') { stops = [st('STW', sStw), st('W8', sW8), st('NEP', (sAt((p) => p.x > 440 && p.z < NEP_Z) ?? s - 20) + LEN / 2 - 10, { both: true })]; seq = [0, 1, 2, 1]; }
  else if (cfg.id === 'Q') { stops = [st('STW', sStw), st('W8', sW8), st('OCP', sAt((p) => p.x > 1005) ?? s - 200, { both: true }), st('BRT', s - 4, { hidden: true })]; seq = [0, 1, 2, 3, 2, 1]; }
  else if (cfg.id === 'N') { stops = [st('STW', sStw), st('N8', Math.min(s - 4, sStw + cfg.turn), { hidden: true })]; seq = [0, 1]; }
  else { stops = [st('STW', sStw), st('B50', sAt((p) => p.z < -735) ?? s - 200, { both: true }), st('A25', s - 4, { hidden: true })]; seq = [0, 1, 2, 1]; }
  R.stops = stops;
  // timetable: dwell at each stop, jerk-limited runs between them (wall clock: every client sees the same trains)
  const runT = (d) => { d = Math.abs(d); const dA = VMAX * VMAX / ACC; return d >= dA ? d / VMAX + VMAX / ACC : 2 * Math.sqrt(d / ACC); };
  R.legs = []; let T = 0;
  for (let i = 0; i < seq.length; i++) { const a = stops[seq[i]], b = stops[seq[(i + 1) % seq.length]]; const dw = a.hidden ? (cfg.dwell ? 2 : 20) : cfg.dwell || DWELL[a.id] || 25;
    R.legs.push({ kind: 'dwell', t0: T, t1: T + dw, stop: a, next: b, dir: b.s > a.s ? 1 : -1 }); T += dw;
    const rt = runT(b.s - a.s); R.legs.push({ kind: 'run', t0: T, t1: T + rt, a, b }); T += rt; }
  R.cycle = T;
  R.cars = buildTrain(world.scene);
  R.sideSign = sideSignFor(cfg);   // which side the track back to Stillwell is on (the el and the stations are built for both)
  buildEl(world, P);
  if (cfg.id === 'F') buildElStation(world, stops[2].s, { id: 'NEP', name: 'Neptune Av', zone: 'NEPTUNE AV · SHELL RD', hint: 'the F back to Coney', street: false });   // its streets and buildings are the real OSM ones (city.js, coney/shellrd.js)
  if (cfg.id === 'Q') buildElStation(world, stops[2].s, { id: 'OCP', name: 'Ocean Pkwy', zone: 'OCEAN PKWY · BRIGHTON BEACH AV', hint: 'the Q back to Coney', street: !world.W.brighton });   // coney/brighton.js builds the streets round it when it's there
  if (cfg.id === 'D') buildElStation(world, stops[1].s, { id: 'B50', name: 'Bay 50 St', zone: 'BAY 50 ST', hint: 'the D back to Coney', street: false });
  boardingSpot();
  console.log(`[subway] ${cfg.id} route`, Math.round(R.L), 'm ·', stops.map((q) => `${q.id}@${Math.round(q.s)}`).join(' '), '· cycle', Math.round(R.cycle), 's');
  return true;
}

function boardingSpot() {
  const me = R, cfg = R.cfg; R.doorPos = new THREE.Vector3(0, -999, 0);
  K.spot({ pos: R.doorPos, r: BOARD_REACH + 0.2, dy: 3, when: () => !me.aboard && !!me.boardable, prompt: () => `F — BOARD THE ${cfg.id}  ·  next: ${me.boardable?.next?.name || ''}`, act: () => { R = me; board(); } });
}
// ---- headways: HEADWAY s between trains (a utopian 2 min) as far as TRAINS_MAX per line allows. A line is one track out of Stillwell;
// trains heading back towards it keep right, onto the parallel track TRACK_GAP over (W 8 St's two tracks are exactly that apart),
// easing across over SIDE_FADE m at the ends of the line and at the stations built with one track between two platforms
const HEADWAY = 120, TRAINS_MAX = 4, TRAINS_LITE = 2, TRACK_GAP = 4.0, SIDE_FADE = 60, NUDGE = 70;   // NUDGE: s a train may start early / late so it never meets another on one track
/** which way is the other track: to the left of the way out (keep right), checked against W 8 St where the line has one */
function sideSignFor(cfg) {
  if (!cfg.w8 || R.w8s0 == null) return 1;
  const sm = (R.w8s0 + R.w8s1) / 2; ptAt(sm - 2, _a); ptAt(sm + 2, _b); const tx = _b.x - _a.x, tz = _b.z - _a.z, l = Math.hypot(tx, tz) || 1;
  const left = [-tz / l, tx / l], o = [-W8U.y, W8U.x], own = cfg.w8 === 'UP' ? -1 : 1;   // the line's own track sits at own × halfTrack across W 8 St
  return (left[0] * o[0] + left[1] * o[1]) * -own > 0 ? 1 : -1;   // the other track is across the middle
}
/** how far over (m) a train is at timetable time t: on the other track while it heads back towards Stillwell */
function lateralAt(t) {
  const l = R.legs.find((g) => t >= g.t0 && t < g.t1) || R.legs[0], S = stopsSorted(), lo = S[0].s, hi = S[S.length - 1].s;
  const ends = R.stops.filter((q) => q.s === lo || q.s === hi).map((q) => q.s);   // ease across only at the ends of the line (every station out there has both tracks)
  const fade = (sv) => { const d = Math.min(...ends.map((e) => Math.abs(sv - e))); const k = Math.max(0, Math.min(1, d / SIDE_FADE)); return k * k * (3 - 2 * k); };
  if (l.kind === 'dwell') return l.next.s < l.stop.s ? TRACK_GAP * fade(l.stop.s) : 0;
  if (l.b.s >= l.a.s) return 0;
  return TRACK_GAP * fade(headAt(t));
}
/** start times for k trains a cycle apart, each nudged up to ±NUDGE s so that no two are ever on the same track within a train length */
function spacing(X, k) {
  const pr = R; R = X; const base = Array.from({ length: k }, (_, j) => j * X.cycle / k), offs = base.slice();
  const clash = (a, b) => { let n = 0; for (let t = 0; t < X.cycle; t += 2) { const ta = (t + a) % X.cycle, tb = (t + b) % X.cycle;
    if (lateralAt(ta) < 1 && lateralAt(tb) < 1 && Math.abs(headAt(ta) - headAt(tb)) < LEN + 12) n++;
    else if (lateralAt(ta) > 3 && lateralAt(tb) > 3 && Math.abs(headAt(ta) - headAt(tb)) < LEN + 12) n++; } return n; };
  for (let j = 1; j < k; j++) { let best = offs[j], bn = Infinity;
    for (let d = 0; d <= NUDGE && bn > 0; d += 2) for (const sg of d ? [1, -1] : [1]) { const o = base[j] + sg * d; let n = 0; for (let i = 0; i < j; i++) n += clash(offs[i], o); if (n < bn) { bn = n; best = o; } }
    if (bn > 0) { console.log(`[subway] ${X.id}: a train ${j + 1} would meet another on one track: ${j} trains`); offs.length = j; break; }   // fewer trains, never two in one place
    offs[j] = best; }
  R = pr; return offs;
}

// ---------------------------------------------------------------------------------------------------------------------------
function routePath(cfg) {
  // graph of every elevated OSM rail vertex; endpoints within 4 m are joined; Dijkstra from the line's Stillwell track to its far end
  const V = [], E = new Map(); const key = (x, z) => `${Math.round(x * 2)}/${Math.round(z * 2)}`, idx = new Map();
  const node = (x, z) => { let k = key(x, z); if (idx.has(k)) return idx.get(k); for (let i = 0; i < V.length; i++) if (Math.hypot(V[i][0] - x, V[i][1] - z) < 4) { idx.set(k, i); return i; } V.push([x, z]); idx.set(k, V.length - 1); return V.length - 1; };
  const link = (a, b) => { const d = Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1]); (E.get(a) || E.set(a, []).get(a)).push([b, d]); (E.get(b) || E.set(b, []).get(b)).push([a, d]); };
  for (const l of OSM.rl) { if (!l.el || l.p.length < 2) continue; let prev = null; for (const [x, z] of l.p) { const n = node(x, z); if (prev !== null && prev !== n) link(prev, n); prev = n; } }
  const near = (x, z, f = () => true) => { let b = -1, bd = 1e9; V.forEach((v, i) => { if (!f(v)) return; const d = Math.hypot(v[0] - x, v[1] - z); if (d < bd) { bd = d; b = i; } }); return b; };
  const src = cfg.dir === 'S' ? near(cfg.stwX, -258, (v) => Math.abs(v[0] - cfg.stwX) < 2.5 && v[1] > -270) : near(cfg.stwX, -442, (v) => Math.abs(v[0] - cfg.stwX) < 2.5 && v[1] < -430), dst = near(cfg.dst[0], cfg.dst[1], cfg.dst[2]);
  if (src < 0 || dst < 0) return null;
  const dist = new Array(V.length).fill(Infinity), prev = new Array(V.length).fill(-1); dist[src] = 0; const Q = new Set([src]);
  while (Q.size) { let u = -1, ud = Infinity; for (const q of Q) if (dist[q] < ud) { ud = dist[q]; u = q; } Q.delete(u); if (u === dst) break;
    for (const [v, w] of E.get(u) || []) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; Q.add(v); } }
  if (!isFinite(dist[dst])) return null;
  const out = []; for (let u = dst; u >= 0; u = prev[u]) out.unshift(new THREE.Vector3(V[u][0], RAIL, V[u][1]));
  const pre = [];   // the platform track itself, through the terminal
  if (cfg.dir === 'S') for (let z = STW_Z0; z < out[0].z - 1; z += 6) pre.push(new THREE.Vector3(cfg.stwX, RAIL, z));
  else for (let z = STW_ZS + 4; z > out[0].z + 1; z -= 6) pre.push(new THREE.Vector3(cfg.stwX, RAIL, z));
  // run on past the last OSM vertex along the last direction (a tail clearance, or the hidden run to the map edge)
  const a = out[out.length - 2], b = out[out.length - 1], d = b.clone().sub(a).setY(0).normalize();
  if (cfg.bend) {   // follow the avenue: straight on to bend.x, then ease the heading round to bend.h (rad, atan2(dz, dx)) at ≤ 0.1°/m
    let h = Math.atan2(d.z, d.x); const q = b.clone();
    for (let run = 0; run < cfg.ext; run += 10) { if (q.x > cfg.bend.x) h += Math.max(-0.0175, Math.min(0.0175, cfg.bend.h - h)); q.x += Math.cos(h) * 10; q.z += Math.sin(h) * 10; out.push(q.clone()); }
  } else out.push(b.clone().addScaledVector(d, cfg.ext));
  // the graph joins nearby rail ends, so a route can hop to the next track over and back: a zigzag the train folds across
  // (the D doubled back on itself north of Stillwell). Drop any vertex where the line turns more than 45°, until none do.
  const R = [...pre, ...out];
  for (let pass = 0; pass < 20; pass++) { let cut = false;
    for (let i = 1; i + 1 < R.length; i++) { const a = R[i - 1], b = R[i], c = R[i + 1]; const ux = b.x - a.x, uz = b.z - a.z, vx = c.x - b.x, vz = c.z - b.z, lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lu < 1e-3 || lv < 1e-3 || (ux * vx + uz * vz) / (lu * lv) < Math.cos(Math.PI / 4)) { R.splice(i, 1); cut = true; i--; } }
    if (!cut) break; }
  return R;
}
function resample(pts, step) {   // even spacing ON the rail polyline (no smoothing — the train stays locked to the track)
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const L = Math.hypot(b.x - a.x, b.z - a.z); const n = Math.max(1, Math.round(L / step)); for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n)); }
  return out;
}
const _p = new THREE.Vector3();
function ptAt(s, out = new THREE.Vector3()) {
  const P = R.P; s = Math.max(0, Math.min(R.L, s)); let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], k = (s - a.s) / Math.max(1e-6, b.s - a.s); return out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
}
const now = () => Date.now() / 1000 + SKEW + (R?.off || 0);
function legNow() { if (R.drive) return driveLeg(); const t = now() % R.cycle; return R.legs.find((l) => t >= l.t0 && t < l.t1) || R.legs[0]; }
function headS() { return R.drive ? R.drive.s : headAt(now() % R.cycle); }
function headAt(t) {
  const l = R.legs.find((g) => t >= g.t0 && t < g.t1) || R.legs[0];
  if (l.kind === 'dwell') return l.stop.s;
  const D = l.b.s - l.a.s, d = Math.abs(D), T = l.t1 - l.t0, u = t - l.t0; const dA = VMAX * VMAX / ACC;
  // jerk-limited: velocity ramps along a smoothstep (∫ = k³ − k⁴/2), so the train eases into and out of its acceleration and
  // braking like a real one (same run time and distance as the old trapezoid, so the timetable is unchanged)
  const I = (k) => k * k * k - k * k * k * k / 2;
  let x; if (d >= dA) { const ta = VMAX / ACC; x = u < ta ? VMAX * ta * I(u / ta) : u > T - ta ? d - VMAX * ta * I((T - u) / ta) : VMAX * ta / 2 + VMAX * (u - ta); }
  else { const h = T / 2, vp = ACC * h; x = u < h ? vp * h * I(u / h) : d - vp * h * I((T - u) / h); }
  return l.a.s + Math.sign(D) * x;
}

// ---------------------------------------------------------------------------------------------------------------------------
// the R160 cars come from coney/r160.js; here every static piece is baked into one mesh per material and the door leaves into
// sliding groups (side × direction × material)
// (each leaf's userData carries sx / dir / z for update(); without them the leaves sat at NaN and never drew)
function dropArray() { this.array = null; }   // BufferAttribute.onUpload: free the JS copy once it's on the GPU
function buildTrain(scene) {
  const kit = makeR160(scene, { CAR, NCAR, FLOOR, DOORZ, lite: !!R.ctx.lite, route: R.cfg }); R.kit = kit;
  for (const g of kit.cars) {
    g.userData.doors = [];
    { const stat = new Map(), doors = new Map(); g.updateMatrix();
      for (const ch of [...g.children]) { if (!ch.isMesh) continue; ch.updateMatrix(); const geo = (ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone()).applyMatrix4(ch.matrix);
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        const key = ch.userData.door ? `${ch.userData.door.sx}|${ch.userData.door.dir}|${ch.material.uuid}` : null; const map = key ? doors : stat, k = key || ch.material.uuid;
        if (!map.has(k)) map.set(k, { m: ch.material, list: [], door: ch.userData.door, shadow: false }); const e = map.get(k); e.list.push(geo); e.shadow ||= ch.castShadow; g.remove(ch); }
      for (const { m, list, shadow } of stat.values()) { const me = new THREE.Mesh(mergeGeometries(list, false), m); me.castShadow = shadow; me.receiveShadow = true; g.add(me); }
      for (const { m, list, door, shadow } of doors.values()) { const me = new THREE.Mesh(mergeGeometries(list, false), m); me.castShadow = shadow; me.userData.door = { sx: door.sx, dir: door.dir, z: 0 }; Object.assign(me.userData, me.userData.door); g.add(me); g.userData.doors.push(me); } }
  }
  // far LOD (r160.js carProxy): the middle cars share one stand-in, each cab car has its own
  const M = kit.M, skip = new Set([M.int, M.floor, M.lamp, M.led, M.ind]), mid = kit.cars.length > 2 ? carProxy(kit.cars[1], skip) : null;
  kit.cars.forEach((g, c) => { const geo = c === 0 || c === kit.cars.length - 1 || !mid ? carProxy(g, skip) : mid; if (!geo) return;
    g.userData.lod = g.children.filter((ch) => ch.isMesh); const far = new THREE.Mesh(geo, proxyMaterial()); far.name = 'r160:far'; far.castShadow = true; far.visible = false; g.add(far); g.userData.far = far; g.userData.near = true; });
  // phones: the baked car meshes (~20 MB over every train) are only drawn from here on: the stand-ins above are built and nothing
  // raycasts them (the yard and a laid-up train share the geometry, never its arrays), so each copy goes once it's on the GPU
  if (R.ctx.lite) for (const g of kit.cars) for (const ch of g.children) { if (!ch.isMesh || ch === g.userData.far) continue; const geo = ch.geometry; geo.computeBoundingSphere(); geo.computeBoundingBox();
    for (const a of Object.values(geo.attributes)) a.onUpload(dropArray); if (geo.index) geo.index.onUpload(dropArray); }
  return kit.cars;
}
function destTex() {
  if (destTex.t) return destTex.t; const c = document.createElement('canvas'); c.width = 320; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#050505'; g.fillRect(0, 0, 320, 64);
  g.fillStyle = '#ff6319'; g.beginPath(); g.arc(32, 32, 24, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '700 30px Helvetica, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('F', 32, 34);
  g.fillStyle = '#ffb347'; g.textAlign = 'left'; g.font = '600 22px Helvetica, Arial'; g.fillText('JAMAICA–179 ST', 66, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (destTex.t = t);
}
function bulletAtlas() {   // D F N Q bullets in a row, 128 px each, transparent between
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
  [['D', '#ff6319', '#fff'], ['F', '#ff6319', '#fff'], ['N', '#fccc0a', '#111'], ['Q', '#fccc0a', '#111']].forEach(([l, bg, fg], i) => { g.fillStyle = bg; g.beginPath(); g.arc(i * 128 + 64, 64, 60, 0, 7); g.fill(); g.fillStyle = fg; g.font = '700 84px Helvetica, Arial'; g.fillText(l, i * 128 + 64, 70); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------------------------------------------------------------------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function update(dt) {
  if (!R?.P) return; const { ctx } = R;
  if (R.drive) driveStep(dt);
  const h = headS(), l = legNow(), t = now() % R.cycle;
  const ds = R.lastH == null ? 0 : h - R.lastH; R.lastH = h; const speed = Math.abs(ds) / Math.max(1e-3, dt), moving = l.kind === 'run' ? Math.sign(l.b.s - l.a.s) : 0;
  const curve = (() => { ptAt(h - 30, _a); ptAt(h - 10, _b); const a1 = Math.atan2(_b.x - _a.x, _b.z - _a.z); ptAt(h + 10, _a); const a2 = Math.atan2(_a.x - _b.x, _a.z - _b.z); let d = a2 - a1; d = Math.atan2(Math.sin(d), Math.cos(d)); return d; })();
  R.curveNow = curve; trackSound(speed, Math.abs(curve)); R.acc = (R.acc || 0) + ((speed - (R.lastV ?? speed)) / Math.max(1e-3, dt) - (R.acc || 0)) * Math.min(1, dt * 3); R.lastV = speed;
  // doors: open 2 s into a dwell, close (chime) 4 s before it ends
  const open = R.drive ? R.drive.doors : l.kind === 'dwell' && !l.stop.hidden ? Math.max(0, Math.min(1, (t - l.t0 - 1.5) / 1.2, (l.t1 - 3 - t) / 1.2)) : 0;
  const lat0 = R.drive ? 0 : lateralAt(t) * R.sideSign; R.latNow = R.drive ? driveLatAt(h - 2.5 * CAR) : lat0;   // latNow: this train's own offset (m) off the line's track, mid-train
  const cam = ctx.camera.position, far = ctx.lite ? 320 : 900, lodNear = ctx.lite ? LOD_NEAR.lite : LOD_NEAR.full;
  if (!R.drive) holdForDriver(dt);
  R.cars.forEach((g, c) => {
    const sm = h - (c + 0.5) * CAR; ptAt(sm + CAR / 2 - 2.6, _a); ptAt(sm - CAR / 2 + 2.6, _b);   // the two trucks sit on the rails; the body hangs between them
    g.position.copy(_a).add(_b).multiplyScalar(0.5); const dx = _a.x - _b.x, dz = _a.z - _b.z, dy = _a.y - _b.y;
    const lat = R.drive ? driveLatAt(sm) : lat0;
    if (lat) { const hl = Math.hypot(dx, dz) || 1; g.position.x += -dz / hl * lat; g.position.z += dx / hl * lat; }   // on the other track, heading back (driving: whichever is on your right)
    g.rotation.set(0, Math.atan2(dx, dz), 0); g.rotateX(-Math.atan2(dy, Math.hypot(dx, dz)));
    const sway = Math.sin(now() * 2.1 + c * 1.7) * 0.004 * Math.min(1, speed / 6) + Math.sin(now() * 0.9 + c) * 0.0015 * Math.min(1, speed / 6) + curve * 0.01; g.rotateZ(sway);   // a little roll: more at speed, leaning out on the curves
    // rail joints every 11.9 m (39 ft rails): each truck dips as its wheels cross one (visual only; riders feel it through the camera)
    if (speed > 0.5) { const jk = Math.min(1, speed / VMAX), dip = (s) => { const q = ((s % JOINT) + JOINT) % JOINT; return q < 0.45 ? Math.sin(q / 0.45 * Math.PI) : 0; };
      const f = dip(sm + CAR / 2 - 2.6), r = dip(sm - CAR / 2 + 2.6); g.position.y -= (f + r) * 0.006 * jk; g.rotateX((f - r) * 0.0012 * jk); }
    const lead = c === 0 ? moving > 0 || (l.kind === 'dwell' && l.next.s > l.stop.s) : moving < 0 || (l.kind === 'dwell' && l.next.s < l.stop.s);
    if (g.userData.head) { g.userData.head.emissiveIntensity = lead ? 2.4 : 0.1; g.userData.mark.emissive.setHex(lead ? 0xffb030 : 0xff1a10); g.userData.mark.emissiveIntensity = 1.8; }
    const d = g.position.distanceTo(cam); g.visible = !!R.aboard || d < far;
    if (g.visible && g.userData.far) { const near = !!R.aboard || d < lodNear; if (near !== g.userData.near) { g.userData.near = near; g.userData.far.visible = !near; for (const ch of g.userData.lod) ch.visible = near; } }
  });
  // the platform side, probed from where the cars are THIS frame (a skip onto the other track probed last frame's pose)
  const dwellSide = l.kind === 'dwell' && !l.stop.hidden ? sideAt(l.stop) : 0; R.lastOpen = [+open.toFixed(2), dwellSide];
  for (const g of R.cars) for (const d of g.userData.doors) d.position.z = d.userData.z + (d.userData.sx === dwellSide || dwellSide === 2 ? d.userData.dir * 0.62 * open : 0);
  cabin(dt, l, t, open, speed, curve);
  // announcements
  const annKey = l.kind + (l.stop?.id || l.a?.id) + (l.b?.id || l.next?.id || '') + Math.floor(t / R.cycle);
  if (R.aboard && annKey !== R.lastAnn) { R.lastAnn = annKey; announce(l); }
  // boarding: the train is at a platform with its doors open and you're on that platform near a door
  R.boardable = null; R.open = open; R.side = dwellSide; R.leg = l;
  const playing = ctx.state === 'playing', p = ctx.player;
  if (l.kind === 'dwell' && (!l.next.hidden || R.id === 'N') && open > 0.8 && !R.aboard && !p.dead && !p.mounted) {   // (not onto a train about to run out of the map)
    // any door, either side of the train, within BOARD_REACH: from the platform across the track too (you used to have to hop it)
    const me = p.position; let best = null, bd = BOARD_REACH;
    R.cars.forEach((g, c) => { for (const dz of DOORZ) for (const sx of [-1, 1]) { _a.set(sx * 2.2, FLOOR, dz).applyMatrix4(g.matrixWorld); const d = Math.hypot(_a.x - me.x, _a.z - me.z); if (d < bd && Math.abs(_a.y - me.y) < 2.5) { bd = d; best = { c, dz, sx }; R.doorPos.copy(_a); } } });
    if (best) R.boardable = { ...best, next: l.next };
  }
  // the car body is solid to someone on a platform (it has no colliders — it moves): walking into its side pushes you back
  // out, except through an open door on the platform side, which boards you (no F needed)
  if (!R.aboard && !p.dead && !p.mounted && Math.hypot(p.position.x - R.cars[2].position.x, p.position.z - R.cars[2].position.z) < 90) {
    if (Math.hypot(p.position.x - R.cars[2].position.x, p.position.z - R.cars[2].position.z) < 90) for (let c = 0; c < NCAR; c++) { const g = R.cars[c]; _inv.copy(g.matrixWorld).invert(); _b.copy(p.position).applyMatrix4(_inv);
      if (Math.abs(_b.z) > CAR / 2 - 0.1 || Math.abs(_b.y - FLOOR) > 1.0 || Math.abs(_b.x) > 1.85) continue;
      const door = DOORZ.find((dz) => Math.abs(_b.z - dz) < 0.62), sd = Math.sign(_b.x) || 1;
      if (door != null && R.boardable && open > 0.8 && (dwellSide === 2 || sd === dwellSide)) { if (playing) board(sd * 1.25, _b.z, c); break; }
      if (Math.abs(_b.x) < 1.85) { _b.x = sd * 1.85; _b.applyMatrix4(g.matrixWorld); p.position.x = _b.x; p.position.z = _b.z; } }
  }
  // riding: you stand in the car and can walk its aisle (WASD / stick, relative to where you look); the car carries you and
  // turns you with it on the curves. At a stop: F, or walk out through an open door on the platform side, gets you off.
  if (!R.drive && R.aboard && l.kind === 'dwell' && l.next.hidden && open > 0.8 && t > l.t1 - 5.5) { if ((R.id === 'D' || R.id === 'N') && R.W.tavern) { if (R.stayKey !== l.t0) { R.stayKey = l.t0; R.W.tavern.stayOn(); } } else { K.toast(`The ${R.id} runs on to ${l.next.name}, past the edge of the map. Everybody off at ${l.stop.name}.`, 4200); alight(); } }
  if (!R.drive && R.aboard && (R.id === 'D' || R.id === 'N') && R.W.tavern && l.kind === 'run' && l.b.hidden && t - l.t0 > 4) { alight(true); R.W.tavern.arrive(R.id === 'N' ? 'Nx' : 'D'); }
  if (R.aboard) {
    const A = R.aboard, g = R.cars[A.c]; g.updateMatrixWorld(true);
    const head = Math.atan2(g.matrixWorld.elements[8], g.matrixWorld.elements[10]);   // the car's local +z in world
    if (A.head != null) { let d = head - A.head; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d; } A.head = head;
    R.canAlight = l.kind === 'dwell' && open > 0.8;
    const inp = ctx.input; let ix = 0, iy = 0;
    if (playing && inp && !R.drive) { if (inp.forward) iy += 1; if (inp.back) iy -= 1; if (inp.right) ix += 1; if (inp.left) ix -= 1; }
    if (R.drive) { A.c = R.drive.dir > 0 ? 0 : NCAR - 1; A.lz = R.drive.dir > 0 ? CAB_Z : -CAB_Z; A.lx = R.drive.dir > 0 ? -CAB_X : CAB_X; }   // in the operator's cab (right-hand side facing the way you drive)
    const il = Math.hypot(ix, iy);
    if (il > 0) { const sp = (inp.sprint ? 3.4 : 2.2) * Math.min(dt, 0.05) / il;   // walking pace inside a car
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const wx = (fx * iy + rx * ix) * sp, wz = (fz * iy + rz * ix) * sp, sh = Math.sin(head), ch = Math.cos(head);
      A.lz += wx * sh + wz * ch; A.lx += wx * ch - wz * sh; A.walkT = (A.walkT || 0) + dt; }
    const LZ = (CAR - 0.4) / 2 - 0.45; A.lz = Math.max(-LZ, Math.min(LZ, A.lz));
    const door = DOORZ.find((dz) => Math.abs(A.lz - dz) < 0.6), openHere = R.canAlight && door != null && (dwellSide === 2 || Math.sign(A.lx) === dwellSide);
    if (Math.abs(A.lx) < 1.15) A.inside = true;   // walked in off the doorway: from now on walking back out gets you off
    if (openHere && A.inside && Math.abs(A.lx) > 1.34) { alight(false, door, Math.sign(A.lx)); }   // stepped out onto the platform
    else {
      const wl = door == null ? 0.95 : 1.3 + (openHere && A.inside ? 0.1 : 0); A.lx = Math.max(-wl, Math.min(wl, A.lx));   // the aisle between the benches; the door wells are deeper
      _a.set(A.lx, FLOOR, A.lz).applyMatrix4(g.matrixWorld);
      p.position.set(_a.x, _a.y, _a.z); p.velocity?.set?.(0, 0, 0); p.speed = il > 0 ? 2.2 : 0;
      const cam = ctx.camera, bob = il > 0 ? Math.sin((A.walkT || 0) * 9) * 0.025 : 0; cam.position.set(_a.x, _a.y + 1.62 + bob, _a.z); cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ'); p.cameraPosition?.copy?.(cam.position);
      if (R.canAlight && !R.hintOff) { R.hintOff = true; K.toast(`${ctx.isTouch ? 'GET OFF' : 'F'} — get off at ${l.stop.name} (or walk out the open doors)`, 3200); }
      if (l.kind !== 'dwell') R.hintOff = false;
      // the front of the lead car: take the controls
      // either end of the train has a cab: the front of the first car drives toward the head, the back of the last car the other way
      const cabDir = A.c === 0 && A.lz > CAB_REACH ? 1 : A.c === NCAR - 1 && A.lz < -CAB_REACH ? -1 : 0, cabEnd = !!cabDir, lead = cabDir;
      R.cabHere = !R.drive && cabEnd; ctx.trainRide = !R.drive;   // VR tablet / K: DRIVE from anywhere on the train
      if (!R.drive && playing && inp?.pressed?.has?.('KeyK')) { inp.pressed.delete('KeyK'); A.c = 0; A.lx = 0; A.lz = CAB_REACH + 0.6; takeControls(1); }   // to the front cab, at the controls
      if (R.drive) driveKeys(inp, playing);
      else if (cabEnd && playing && inp?.pressed?.has?.('KeyF')) { inp.pressed.delete('KeyF'); takeControls(lead); }
      else if (R.canAlight && playing && inp?.pressed?.has?.('KeyF')) { inp.pressed.delete('KeyF'); alight(); }   // the touch GET OFF button injects F
    }
  }
  // doors closing: the chime + the conductor, for riders and for anyone standing at the open doors
  if (!R.drive && l.kind === 'dwell' && t > l.t1 - 4.6 && t < l.t1 - 4.2 && R.closeKey !== l.t0 && (R.aboard || R.boardable)) { R.closeKey = l.t0; chime(); K.toast('Stand clear of the closing doors, please.', 2400); if (R.aboard) pa(R.ctx, 'Stand clear of the closing doors, please.'); }
  // touch: the contextual action button (touch.js) says what F does here
  const lab = R.drive ? (R.drive.stopped && R.drive.at && R.drive.doors <= 0.8 ? 'OPEN DOORS' : 'GET OFF') : R.cabHere ? `DRIVE THE ${R.id}` : R.aboard && R.canAlight ? 'GET OFF' : null;   // boarding is a hangkit spot: its "F — BOARD THE F" prompt already gets a tap button on phones (netui.js)
  if (lab) { ctx.actionLabel = lab; R.ownLabel = true; } else if (R.ownLabel) { ctx.actionLabel = null; R.ownLabel = false; }
  if (R.aboard || lab || R.boardable) ctx.interactNear = true;   // weapons.js leaves F (the touch button) to us
}
const DOORZ = [-6.2, -2.1, 2.1, 6.2], JOINT = 11.9, _inv = new THREE.Matrix4();
const BOARD_REACH = 9;
// ---- driving a train: the master controller (a lever, power ↔ brake), the emergency brake, speed limits that trip you (like NYCT's
// grade timers), doors only at a platform and only when stopped, no power with the doors open, bumper blocks at the ends. Your train
// leaves the shared timetable on your screen only (everyone else keeps seeing the scheduled one).
// the operator's cab: the right-hand side of the very end of the lead car, facing down the track
const CAB_Z = CAR / 2 - 0.85, CAB_X = 0.95, CAB_REACH = CAR / 2 - 3.6;
const D_ACC = 1.2, D_BRK = 1.6, D_EMERG = 2.7, D_DRAG = 0.04, LIM_LINE = 22, LIM_SLOW = 11, LIM_YARD = 8, LIM_TRIP = 4.5, TRIP_HOLD = 1.0, LEVER_RATE = 1.6, BERTH = 5;   // 50 mph line, 25 through stations and curves, 18 in the yard; trips only after 1 s at 10 mph over
const mph = (v) => Math.round(v * 2.237);
function takeControls(dir) {
  try { R.ctx.bus.emit('vrFace'); } catch {}   // VR: face down the track at the controls
  const s0 = headS(), T = thruRoute(); R.base = { P: R.P, L: R.L, stops: R.stops };
  if (T) { R.P = T.P; R.L = T.L; R.stops = T.stops; } R.stopsSorted = null;
  const s = s0 + (T ? T.prefix : 0);
  R.drive = { s, v: 0, lever: 0, dir, doors: 0, wantDoors: false, tripped: false, at: null, stopped: true, t0: now(), route0: { P: R.P, L: R.L, stops: R.stops }, shift: 0, yk: null };
  R.drive.hasYard = !!yardAt(R.P); R.drive.sB = T ? T.prefix : null; R.drive.sP = T ? (LINES.find((q) => q.id === T.via)?.sideSign || 1) : 1; R.drive.dirSm = dir;
  faceTrack(dir);
  K.toast(`You're driving the ${R.id}. W / S (or the stick): power ↔ brake · SPACE emergency · F: doors at a platform, or get off anywhere · R: change ends${T ? ` · through Stillwell onto the ${T.via}` : ''}${R.drive.hasYard ? ' · Y: the switch north of Neptune Ave, main line or Coney Island Yard' : ''}`, 6400);
  driveHud(true);
}
/** turn the driver to look down the track out of the cab windshield (the car's local +z points to the head of the train) */
function faceTrack(dir) {
  const g = R.cars[dir > 0 ? 0 : NCAR - 1]; g.updateMatrixWorld(true); const m = g.matrixWorld.elements, p = R.ctx.player;
  if (p) { p.yaw = dir > 0 ? Math.atan2(-m[8], -m[10]) : Math.atan2(m[8], m[10]); p.pitch = 0; if (R.aboard) R.aboard.head = null; }
}
function leaveControls() {
  R.drive = null; R.ctx.trainCab = false; driveHud(false); R.lastH = null;
  if (R.base) { R.P = R.base.P; R.L = R.base.L; R.stops = R.base.stops; R.base = null; R.stopsSorted = null; }   // back on its own line and timetable
}
// ---- through-running: a train you drive doesn't stop dead at Stillwell's bumpers. Past the end of its platform it carries on along
// the line that leaves the terminal from that end: the N onto the Q (and the Q onto the N), the D onto the F (and the F onto the D),
// switching across the throat over ~70 m. Built once per line, used only while you drive (the timetabled trains keep their lines).
const PARTNER = { N: 'Q', Q: 'N', D: 'F', F: 'D' }, XOVER = 70;
function thruRoute() {
  if (R.thru !== undefined) return R.thru;
  const Y = LINES.find((q) => q.id === PARTNER[R.id]); R.thru = null; if (!Y) return null;
  // the partner's track beyond the end of Stillwell where this line's s = 0 is, run backwards towards Stillwell
  const iExit = Y.P.findIndex((p) => (Y.cfg.dir === 'S' ? p.z > STW_ZS + 2 : p.z < STW_Z0 - 2)); if (iExit < 1) return null;
  const yExit = Y.P[iExit].s, seg = Y.P.slice(iExit).reverse().map((p) => ({ x: p.x, y: p.y, z: p.z, ys: p.s }));
  // the crossover: the last XOVER m into Stillwell ease across onto this line's own track
  const T0 = R.P[0], J = seg[seg.length - 1], dx = T0.x - J.x, dz = T0.z - J.z, dy = T0.y - J.y;
  for (let i = seg.length - 1, d = 0; i >= 0 && d < XOVER; i--) { if (i < seg.length - 1) d += Math.hypot(seg[i + 1].x - seg[i].x, seg[i + 1].z - seg[i].z); const k = 1 - d / XOVER, sm = k * k * (3 - 2 * k); seg[i].x += dx * sm; seg[i].z += dz * sm; seg[i].y += dy * sm; }
  seg.pop();   // it now sits on this line's first point
  const P = [...seg.map((p) => new THREE.Vector3(p.x, p.y, p.z)), ...R.P.map((p) => p.clone())];
  let s = 0; P.forEach((p, i) => { if (i) s += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z); p.s = s; });
  const prefix = P[seg.length].s;
  // its stops, then the partner's (a train berthed at the partner's stop: its head is LEN further along, the line runs backwards)
  const stops = R.stops.map((q) => ({ ...q, s: q.s + prefix }));
  for (const q of Y.stops) { if (q.id === 'STW') continue; const sd = prefix - (q.s - yExit) + LEN; if (sd > LEN + 4) stops.push({ ...q, s: sd }); }
  R.thru = { P, L: s, stops, prefix, via: Y.id };
  console.log(`[subway] ${R.id} through route via the ${Y.id}:`, Math.round(s), 'm ·', stops.map((q) => `${q.id}@${Math.round(q.s)}`).join(' '));
  return R.thru;
}
// ---- Coney Island Yard: the throat switch north of Neptune Ave. Y (or the SWITCH button) cycles MAIN → each free yard track → MAIN.
// The route you drive is cut at the switch and the yard track spliced on in place of the line beyond it (D / N: the end of the
// route; F / Q through-running: the start, which is the D / N run backwards). Only with the whole train on the Stillwell side.
/** where the yard switch is on a route: index, s, and whether s grows going north (into the yard) */
function yardAt(P) {
  if (!YD) return null; const J = YD.J; let iJ = -1, bd = 3;
  for (let i = 1; i < P.length - 1; i++) { const d = Math.hypot(P[i].x - J.x, P[i].z - J.z); if (d < bd) { bd = d; iJ = i; } }
  return iJ < 0 ? null : { iJ, sJ: P[iJ].s, up: P[iJ + 1].z < P[iJ].z };
}
function setThroat(k) {
  const D = R.drive, B = D?.route0, info = B && yardAt(B.P); if (!info) return false;
  const s0 = D.s - D.shift; if (info.up ? s0 > info.sJ - 1 : s0 - LEN < info.sJ + 1) { K.toast('The train is over the switch: back it off first.', 1800); return false; }
  let shift = 0;
  if (k == null) { R.P = B.P; R.L = B.L; R.stops = B.stops; D.ysJ = info.sJ; }
  else { const Y = YD.tracks[k];
    const P = info.up ? [...B.P.slice(0, info.iJ + 1), ...Y.slice(1)].map((p) => p.clone()) : [...Y.slice(1).reverse(), ...B.P.slice(info.iJ)].map((p) => p.clone());
    let s = 0; P.forEach((p, i) => { if (i) s += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z); p.s = s; });
    const sJ = info.up ? info.sJ : P[Y.length - 1].s; shift = sJ - info.sJ;
    const stops = B.stops.filter((q) => !q.hidden && (info.up ? q.s < info.sJ - 1 : q.s - LEN > info.sJ + 1)).map((q) => ({ ...q, s: q.s + shift }));
    stops.push({ id: 'YRD', name: `Coney Island Yard track ${k + 1}`, speak: 'Coney Island Yard', s: info.up ? s - 6 : LEN + 6, hidden: true, yard: true });
    R.P = P; R.L = s; R.stops = stops; D.ysJ = sJ; }
  D.s = s0 + shift; D.shift = shift; D.yk = k; D.yUp = info.up; R.stopsSorted = null; R.lastH = null;
  return true;
}
function cycleThroat() {
  const D = R.drive; if (!D || !YD) return; if (!yardAt(D.route0.P)) { K.toast('No yard switch on this route.', 1500); return; }
  const free = YD.free(), next = D.yk == null ? free[0] : free.find((k) => k > D.yk);
  if (D.yk == null && next == null) { K.toast('The yard is full.', 1500); return; }
  if (setThroat(next ?? null)) K.toast(next == null ? 'Switch: MAIN LINE' : `Switch: CONEY ISLAND YARD, track ${next + 1}`, 1600);
}
/** off the train, anywhere: a Stillwell platform if you're in the terminal, otherwise down beside the track */
function stepOff() {
  const p = R.ctx.player, D = R.drive, was = R.aboard, dir = D?.dir || 1, g = R.cars[dir > 0 ? 0 : NCAR - 1];
  g.updateMatrixWorld(true); _a.set(0, FLOOR, 0).applyMatrix4(g.matrixWorld);
  const lay = D && D.yk != null && D.v < 0.5 && (D.yUp ? D.s - LEN > D.ysJ + 2 : D.s < D.ysJ - 2) ? D.yk : null;   // wholly in the yard: it stays there
  if (lay != null && YD.layUp(lay, R.cars)) K.toast(`The ${R.id} is laid up on yard track ${lay + 1}.`, 2400);
  leaveControls(); R.ctx.trainRide = false; if (!was) return; R.aboard = null; if (p.mounted?.train) p.mounted = null;
  if (_a.z > STW_Z0 - 10 && _a.z < STW_ZS + 10 && _a.x > -90 && _a.x < -20) {   // in the terminal: onto the nearest island platform
    const isl = STW_ISL.reduce((m, q) => (Math.abs((q[0] + q[1]) / 2 - _a.x) < Math.abs((m[0] + m[1]) / 2 - _a.x) ? q : m), STW_ISL[0]);
    p.teleport?.((isl[0] + isl[1]) / 2, _a.y + 0.05, Math.max(STW_Z0 + 6, Math.min(STW_ZS - 6, _a.z)), p.yaw, 0);
    K.toast('Off the train, onto the platform.', 1800); return;
  }
  // out on the line: down to the street beside the el
  _b.set(4.5, 0, 0).applyMatrix4(g.matrixWorld); const gy = R.W.groundHeight?.(_b.x, _b.z) ?? 0;
  p.teleport?.(_b.x, gy + 0.05, _b.z, p.yaw, 0); K.toast(`You climb down off the ${R.id}.`, 1800);
}
const stopsSorted = () => R.stopsSorted || (R.stopsSorted = R.stops.slice().sort((a, b) => a.s - b.s));
function nextStop(s, dir) { const L = stopsSorted(); return dir > 0 ? L.find((q) => q.s > s + 1) || L[L.length - 1] : [...L].reverse().find((q) => q.s < s - 1) || L[0]; }
function driveLeg() {
  const D = R.drive, at = D.at;
  if (at) return { kind: 'dwell', stop: at, next: nextStop(at.s, D.dir), dir: D.dir, t0: D.t0, t1: D.t0 + 1e6 };
  const b = nextStop(D.s, D.dir), a = nextStop(D.s, -D.dir); return { kind: 'run', a, b, t0: D.t0, t1: D.t0 + 1e6 };
}
function driveKeys(inp, playing) {
  const D = R.drive; if (!playing || !inp) return;
  const P = inp.pressed;
  if (P.has('KeyF')) { P.delete('KeyF');
    if (D.stopped && D.at && D.doors > 0.8) { const was = R.aboard; leaveControls(); if (was) alight(); return; }
    if (D.stopped && D.at) { D.wantDoors = true; return; }   // at a platform: the doors first, F again to step out
    stepOff(); return; }   // anywhere else (between stations, at a bumper, moving): off the train
  if (P.has('KeyY')) { P.delete('KeyY'); cycleThroat(); }
  if (P.has('KeyR')) { P.delete('KeyR'); if (D.stopped && D.doors < 0.05) { D.dir = -D.dir; D.lever = 0; faceTrack(D.dir); K.toast(`Changed ends: now heading ${D.dir > 0 ? R.cfg.bound.out : R.cfg.bound.in}.`, 1800); } else K.toast('Stop with the doors closed to change ends.', 1500); }
}
// ---- keep right: on every two-track stretch your train runs on the track to the right of the way it's heading (the line's own
// track out, the other one back; through-running, the partner's the other way round), easing across over ~2 s when you change
// ends, and on the single track through Stillwell, at the ends of the route and in the yard
function driveLatAt(s) {
  const D = R.drive; if (!D) return 0;
  const sB = D.sB != null ? D.sB + (D.yk != null && !D.yUp ? D.shift : 0) : -Infinity, back = Math.max(0, -D.dirSm), fwd = Math.max(0, D.dirSm);
  const side = s >= sB ? back * (R.sideSign || 1) : fwd * -(D.sP || 1); if (!side) return 0;
  let d = Math.min(s, R.L - s); if (D.sB != null) d = Math.min(d, Math.abs(s - sB));
  for (const q of R.stops) if (q.id === 'STW') d = Math.min(d, Math.abs(s - q.s));
  if (D.yk != null) { if (D.yUp ? s > D.ysJ : s < D.ysJ) return 0; d = Math.min(d, Math.abs(s - D.ysJ)); }
  const k = Math.max(0, Math.min(1, d / SIDE_FADE)); return TRACK_GAP * side * k * k * (3 - 2 * k);
}
/** car-centre positions of every other train, for the driver's buffers and the timetabled trains' holds */
function nearTrain(g, list, ahead) {
  // the closest other car on the same track (|offset across| < 2.5 m) within `ahead` m along g's axis (signed)
  const e = g.matrixWorld.elements, fx = e[8], fz = e[10], fl = Math.hypot(fx, fz) || 1, ux = fx / fl, uz = fz / fl; let best = null;
  for (const L of LINES) { if (L === R || !list(L)) continue; for (const o of L.cars) { if (!o.visible && !R.aboard) continue;
    const dx = o.position.x - g.position.x, dz = o.position.z - g.position.z, along = dx * ux + dz * uz, across = Math.abs(-dx * uz + dz * ux);
    if (across < 2.5 && Math.abs(o.position.y - g.position.y) < 3 && Math.abs(along) < ahead && (!best || Math.abs(along) < Math.abs(best.along))) best = { along, L }; } }
  return best;
}
/** a timetabled train that would run into the one you're driving waits (its clock stops) until the way is clear */
function holdForDriver(dt) {
  if (!LINES.some((L) => L.drive)) { R.lastGap = null; return; }
  let gap = 1e9; for (const g of R.cars) { const q = nearTrain(g, (L) => L.drive, CAR + 14); if (q) gap = Math.min(gap, Math.abs(q.along)); }
  const closing = R.lastGap != null && gap < R.lastGap - 0.01; R.lastGap = gap;
  if (gap < CAR + 12 && (closing || R.held)) { R.off -= dt; R.held = gap < CAR + 12; } else R.held = false;
}
function driveStep(dt) {
  const D = R.drive, ctx = R.ctx, inp = ctx.input; ctx.trainCab = true; if (!dt) return;
  D.dirSm += Math.max(-dt * 0.5, Math.min(dt * 0.5, D.dir - D.dirSm));
  // the lever: W / S nudge it, a stick sets it directly (up = power, down = brake)
  const ay = inp?.touch?.axis?.y || 0;
  if (Math.abs(ay) > 0.15) D.lever = Math.max(-1, Math.min(1, -ay)); else { if (inp?.forward) D.lever = Math.min(1, D.lever + LEVER_RATE * dt); if (inp?.back) D.lever = Math.max(-1, D.lever - LEVER_RATE * dt); }
  const emerg = !!inp?.jump || D.tripped;
  if (D.lever > 0.05 && D.doors > 0) { D.wantDoors = false; if (!D.chimed) { D.chimed = true; chime(); K.toast('Stand clear of the closing doors, please.', 2000); } }
  // doors
  D.doors = Math.max(0, Math.min(1, D.doors + (D.wantDoors ? 1 : -1) * dt / 1.2)); if (D.doors === 0) D.chimed = false;
  // traction / braking
  let a = 0;
  if (emerg) a = -D_EMERG; else if (D.lever > 0.05) a = D.doors > 0.02 ? 0 : D.lever * D_ACC * Math.max(0, 1 - D.v / (LIM_LINE * 1.25)); else if (D.lever < -0.05) a = D.lever * D_BRK; else a = -D_DRAG;
  D.v = Math.max(0, D.v + a * dt); const s0 = D.s; D.s += D.dir * D.v * dt;
  { const lead = R.cars[D.dir > 0 ? 0 : NCAR - 1]; lead.updateMatrixWorld(); const q = nearTrain(lead, (L) => L !== R, CAR + 4);   // another train dead ahead on your track
    const ahead = q && (D.dir > 0 ? q.along > 0 : q.along < 0) && Math.abs(q.along) < CAR + 2;
    if (ahead && D.v > 0.05) { if (D.v > 3) { K.toast(`*CLANG* — into the back of the ${q.L.id}.`, 1800); ctx.player?.damage?.(Math.min(30, D.v * 2)); } D.s = s0; D.v = 0; } }
  // bumper blocks: the ends of the track
  const lo = LEN + 2, hi = R.L - 2; if (D.s < lo || D.s > hi) { if (D.v > 2) { K.toast('*BANG* — into the bumper block.', 2000); ctx.player?.damage?.(Math.min(40, D.v * 3)); } D.s = Math.max(lo, Math.min(hi, D.s)); D.v = 0; }
  // speed limits: slow through stations and sharp curves; over the limit by LIM_TRIP and the train trips (emergency until it stops)
  const nearStn = stopsSorted().some((q) => !q.hidden && Math.abs(q.s - D.s) < 45), curveK = Math.abs(R.curveNow || 0);
  const yard = D.yk != null && (D.yUp ? D.s > D.ysJ - 40 : D.s - LEN < D.ysJ + 40);   // yard speed past the switch
  D.limit = yard ? LIM_YARD : nearStn || curveK > 0.2 ? LIM_SLOW : LIM_LINE;
  D.overT = D.v > D.limit + LIM_TRIP ? (D.overT || 0) + dt : 0;
  if (!D.tripped && D.overT > TRIP_HOLD) { D.tripped = true; K.toast(`TRIPPED — ${mph(D.v)} mph in a ${mph(D.limit)} zone. Emergency brakes until you stop.`, 3000); }
  if (D.tripped && D.v === 0) D.tripped = false;
  // berthed at a platform: stopped with the train's head on the station mark
  D.stopped = D.v < 0.05;
  const berth = stopsSorted().find((q) => Math.abs(q.s - D.s) < BERTH);
  const was = D.at; D.at = D.stopped && berth && !berth.hidden ? berth : null;
  if (D.at && !was) { D.t0 = now(); R.lastAnn = ''; } else if (!D.at && was) D.t0 = now();
  // the N / D off the edge of the map: on to 8th Ave, like riding
  if ((R.id === 'D' || R.id === 'N') && R.W.tavern && berth?.hidden && !berth.yard && D.dir > 0 && D.s > berth.s - BERTH) { leaveControls(); alight(true); R.W.tavern.arrive(R.id === 'N' ? 'Nx' : 'D'); return; }
  driveHud(true);
}
function driveHud(on) {
  let el = document.getElementById('trainHud');
  if (!on) { if (el) el.style.display = 'none'; const yb = document.getElementById('yardBtn'); if (yb) yb.style.display = 'none'; return; }
  if (!el) { el = document.createElement('div'); el.id = 'trainHud'; el.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:45;padding:7px 14px;border-radius:12px;background:rgba(10,12,16,.82);border:1px solid rgba(255,255,255,.18);color:#eee;font:700 15px Barlow Condensed,system-ui;letter-spacing:.04em;min-width:300px;text-align:center;pointer-events:none'; document.body.appendChild(el); }
  const D = R.drive; if (!D) return; el.style.display = 'block';
  let yb = document.getElementById('yardBtn');
  if (!yb && D.hasYard) { yb = document.createElement('button'); yb.id = 'yardBtn'; yb.textContent = 'SWITCH (Y)'; yb.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:46;padding:12px 16px;border-radius:12px;background:rgba(10,12,16,.82);border:1px solid #ffd27a;color:#ffd27a;font:700 15px Barlow Condensed,system-ui;letter-spacing:.06em;touch-action:none';
    const go = (e) => { e.preventDefault(); e.stopPropagation(); R.ctx.input?.pressed?.add('KeyY'); }; yb.addEventListener('touchstart', go, { passive: false }); yb.addEventListener('mousedown', go); document.body.appendChild(yb); }
  if (yb) yb.style.display = D.hasYard ? 'block' : 'none';
  const nx = nextStop(D.s, D.dir), dist = Math.max(0, Math.round(Math.abs(nx.s - D.s)));
  const lev = D.lever > 0.05 ? `POWER ${Math.round(D.lever * 4)}` : D.lever < -0.05 ? `BRAKE ${Math.round(-D.lever * 4)}` : 'COAST';
  const html = `<b style="background:${R.cfg.color};color:${R.cfg.fg || '#fff'};border-radius:50%;padding:1px 8px;margin-right:6px">${R.id}</b> <span style="font-size:22px">${mph(D.v)}</span> mph <span style="opacity:.7">/ limit ${mph(D.limit || LIM_LINE)}</span> · ${lev}${D.tripped ? ' · <span style="color:#ff5050">TRIPPED</span>' : ''}<br><span style="opacity:.85">${D.at ? 'AT ' + D.at.name.toUpperCase() : 'NEXT ' + (nx.yard || !nx.hidden ? nx.name.toUpperCase() : 'END OF LINE') + ' · ' + dist + ' m'}${D.hasYard ? ` · SWITCH <b style="color:${D.yk == null ? '#9fd39f' : '#ffd27a'}">${D.yk == null ? 'MAIN' : 'YARD ' + (D.yk + 1)}</b> (Y)` : ''} · DOORS ${D.doors > 0.8 ? 'OPEN' : D.doors > 0.02 ? 'MOVING' : 'CLOSED'}</span>`;
  if (html !== el._h) { el._h = html; el.innerHTML = html; }
}   // m from a door to board: covers the platform across one track
const mss = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** the next train out of a stop, per line and direction: [{ line, color, fg, to, dest, arrive (s until the doors open), leave, boarding }] */
function departures(id) {
  const out = new Map(), pr = R;
  for (const L of LINES) { R = L; const t = now() % L.cycle;
    for (const l of L.legs) { if (l.kind !== 'dwell' || l.stop.id !== id || l.next.hidden) continue;
      const fw = l.next.s > l.stop.s, to = fw ? L.stops.filter((q) => !q.hidden).pop().name : NAMES.STW[0], boarding = t >= l.t0 + 1.5 && t < l.t1 - 3;
      const arrive = boarding ? 0 : ((l.t0 + 1.5 - t) % L.cycle + L.cycle) % L.cycle, leave = boarding ? l.t1 - 3 - t : arrive + (l.t1 - l.t0 - 4.5), k = L.id + fw;
      if (!out.has(k) || arrive < out.get(k).arrive) out.set(k, { line: L.id, color: L.cfg.color, fg: L.cfg.fg, to: to.replace('Coney Island–', ''), dest: fw ? L.cfg.dest.out : 'Coney Island', arrive, leave, boarding }); } }
  R = pr; return [...out.values()].sort((a, b) => a.arrive - b.arrive);
}
const STW_ISL = [[-82, -74, null], [-68, -60, 'D'], [-53, -46, 'F'], [-38, -29, 'Q']];
/** which station you're at / walking up to: Stillwell's head house + bus loop + Stillwell Ave frontage, W 8 St with its stair
 *  towers + the Aquarium footbridge, and the el stations built here (Neptune Av, Ocean Pkwy, Bay 50 St) */
function stationAt(p) {
  if (p.x > -125 && p.x < -5 && p.z > -445 && p.z < -200) { const isl = p.y > 7 ? STW_ISL.find(([a, b]) => p.x > a - 0.5 && p.x < b + 0.5) : null; return { id: 'STW', plat: p.y > 7, isl: isl ? isl[2] || '-' : null }; }
  const dx = p.x - W8.P0.x, dz = p.z - W8.P0.y, u = W8U, a = dx * u.x + dz * u.y, o = -dx * u.y + dz * u.x;
  if (a > -25 && a < W8.L + 20 && o > -22 && o < 50) return { id: 'W8', plat: p.y > 13.5, lower: p.y > 7.5 && p.y < 13.5 };
  for (const [id, S] of Object.entries(STN)) if (Math.hypot(p.x - S.c.x, p.z - S.c.z) < 160) return { id, plat: p.y > 7 };
  return null;
}
const bul = (d) => `<b class="f" style="background:${d.color};color:${d.fg}">${d.line}</b>`;
/** the subway HUD: next trains near / in a station (every line that stops there), where to go, and the rider's next stop */
function hud(t) {
  const { ctx } = R; G.hudT++; if (G.hudT % 8) return;
  if (!G.el) { const st = document.createElement('style'); st.textContent = `
    .zvsub{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 94px);transform:translateX(-50%);z-index:38;display:none;pointer-events:none;padding:6px 14px 7px;border-radius:8px;background:rgba(8,10,14,.72);border:1px solid rgba(255,255,255,.14);font:600 14px 'Barlow Condensed',Arial,sans-serif;color:#eef2f5;letter-spacing:.04em;text-align:center;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4)}
    .zvsub.on{display:block}.zvsub b.f{display:inline-block;width:19px;height:19px;line-height:19px;border-radius:50%;background:#ff6319;color:#fff;font:700 13px Arial;text-align:center;margin-right:7px;vertical-align:1px}
    .zvsub .l{display:block}.zvsub .h{display:block;font-weight:500;font-size:12.5px;color:#ffcf8a;margin-top:2px}.zvsub .now{color:#8dff9c}`;
    document.head.appendChild(st); G.el = document.createElement('div'); G.el.className = 'zvsub'; document.body.appendChild(G.el); }
  const p = ctx.player; let html = '';
  const key = ctx.isTouch ? 'tap BOARD' : 'F';
  if (ctx.state === 'playing' && p && !p.dead && !LINES.some((L) => L.drive)) {   // driving: the cab display has it
    if (R.aboard) {
      const l = R.leg, me = { line: R.id, color: R.cfg.color, fg: R.cfg.fg };
      if (R.canAlight) html = `<span class="l">${bul(me)}<span class="now">${l.stop.name}</span> — doors open ${mss(l.t1 - 3 - t)}</span><span class="h">${l.next.hidden ? `last stop in the map: get off here (the ${R.id} runs on to ${l.next.name})` : `${ctx.isTouch ? 'GET OFF' : 'F'} or walk out the open doors to get off · next: ${l.next.name}`}</span>`;
      else { const nx = l.kind === 'run' ? l.b : l.next, lg = R.legs.find((g) => g.kind === 'dwell' && g.stop === nx && g.t0 >= (l.kind === 'run' ? l.t1 - 0.01 : l.t1 + 0.01)) || R.legs.find((g) => g.kind === 'dwell' && g.stop === nx);
        html = `<span class="l">${bul(me)}${l.kind === 'run' && l.b.s > l.a.s ? R.cfg.dest.out : 'Coney Island'} · next stop <b>${nx.name}</b> — ${mss(((lg.t0 + 1.5 - t) % R.cycle + R.cycle) % R.cycle)}</span><span class="h">walk the car: ${ctx.isTouch ? 'stick' : 'WASD'} · look out the windows</span>`; }
    } else if (!p.mounted) {
      const st = stationAt(p.position);
      if (st) {
        let deps = departures(st.id); if (st.id === 'W8' && (st.plat || st.lower)) deps = deps.filter((d) => (d.line === 'F') === !!st.plat);
        if (st.id === 'STW' && st.isl && st.isl !== '-') deps = deps.filter((d) => d.line === st.isl);
        const lines = deps.slice(0, 3).map((d) => `<span class="l">${bul(d)}to ${d.to} — ${d.boarding ? `<span class="now">boarding · leaves ${mss(d.leave)}</span>` : d.arrive < 20 ? `<span class="now">arriving ${mss(d.arrive)}</span>` : mss(d.arrive)}</span>`).join('');
        const brd = LINES.find((L) => L.boardable);
        let h = '';
        if (brd) h = `${key} to board the ${brd.id} — or just walk in through the open doors`;
        else if (st.id === 'STW') h = st.plat ? (st.isl === '-' ? 'parked trains only — D: 2nd island · F: 3rd · Q: 4th from Stillwell Ave' : (st.isl ? `the ${st.isl} boards here` : 'D 2nd island · F 3rd · Q 4th from Stillwell Ave')) : 'through the turnstiles → stairs from Stillwell Ave: D 2nd bank · F 3rd · Q 4th';
        else if (st.id === 'W8') h = w8Hint(p);
        else h = st.plat ? `${deps[0]?.line || ''} back to Coney Island stops here` : 'stairs at the end of the platforms';
        html = lines + `<span class="h">${h}</span>`;
      }
    }
  }
  if (html !== G.html) { G.html = html; G.el.innerHTML = html; G.el.classList.toggle('on', !!html); }
}
/** W 8 St wayfinding for the HUD: which way (an arrow relative to where you look) and how far to the stairs you want */
function w8Pt(a, o, y) { const u = W8U; return new THREE.Vector3(W8.P0.x + u.x * a - u.y * o, y, W8.P0.y + u.y * a + u.x * o); }
function w8Hint(p) {
  const P = p.position, u = W8U, o = -(P.x - W8.P0.x) * u.y + (P.z - W8.P0.y) * u.x, sd = o < 0 ? -1 : 1, lvl = P.y > 13.5 ? 'up' : P.y > 7.5 ? 'lo' : 'st';
  const dir = (q) => { const b = Math.atan2(q.x - P.x, q.z - P.z), f = Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)); let r = b - f; r = Math.atan2(Math.sin(r), Math.cos(r));
    return `${['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][((Math.round(-r / (Math.PI / 4)) % 8) + 8) % 8]} ${Math.round(Math.hypot(q.x - P.x, q.z - P.z))} m`; };
  if (lvl === 'up') return sd < 0 ? `upper level: the F stops here · exit / Q / Aquarium: stairs ${dir(w8Pt(120.8, -7, 0))}` : `no F on this side — stairs ${dir(w8Pt(120.8, 7, 0))} → Q level → street → north stairs up`;
  if (lvl === 'lo') return sd < 0 ? `F: stairs up ${dir(w8Pt(107.5, -9.5, 0))} · exit ${dir(w8Pt(54.8, -9, 0))} · the Q boards on the south side` : `the Q boards here · Aquarium footbridge ${dir(w8Pt(150, 9, 0))} · exit ${dir(w8Pt(54.8, 9, 0))}`;
  return `F: north stairs ${dir(w8Pt(38.2, -9.5, 0))} · Q: south stairs ${dir(w8Pt(38.2, 9.5, 0))}`;
}
/** station life: countdown clocks (in-world LED, per platform: the lines that stop there), and the station PA when a train comes in */
function stationLife() {
  const { ctx, world } = R, p = ctx.player.position;
  if (!G.clocks) { G.clocks = []; const yawW8 = Math.atan2(W8U.x, W8U.y);
    const groups = [['W8', ['F'], [[60, -5.45, W8.UP.plat + 2.6], [150, -5.45, W8.UP.plat + 2.6]].map(([a, o, y]) => [w8Pt(a, o, y), yawW8])], ['W8', ['Q'], [[92, 5.45, W8.LO.plat + 2.5], [140, 5.45, W8.LO.plat + 2.5]].map(([a, o, y]) => [w8Pt(a, o, y), yawW8])],
      ['STW', ['F'], [[new THREE.Vector3(-49.5, 11.3, -345), 0], [new THREE.Vector3(-49.5, 11.3, -300), 0]]], ['STW', ['Q'], [[new THREE.Vector3(-33.5, 11.3, -330), 0]]], ['STW', ['D'], [[new THREE.Vector3(-64, 11.3, -330), 0]]]];
    for (const [id, S] of Object.entries(STN)) if (id !== 'NEP') groups.push([id, null, [[S.at(0, S.O1 - 0.9, S.plat + 2.7), S.ang], [S.at(0, -S.O1 + 0.9, S.plat + 2.7), S.ang]]]);
    for (const [id, only, spots] of groups) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64; const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.MeshStandardMaterial({ color: 0, map: tx, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 1.1 }), geos = [];
      for (const [q, yaw] of spots) { for (const k of [0, Math.PI]) { const g = new THREE.PlaneGeometry(1.6, 0.4); g.rotateY(yaw + k); g.translate(q.x + Math.sin(yaw + k) * 0.04, q.y, q.z + Math.cos(yaw + k) * 0.04); geos.push(g); } const bx = new THREE.BoxGeometry(1.7, 0.48, 0.07); bx.rotateY(yaw); bx.translate(q.x, q.y, q.z); geos.push(bx); }
      const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false), m); mesh.name = `clock${id}`; world.scene.add(mesh); G.clocks.push({ id, only, c, tx, at: spots[0][0], last: '' }); } }
  for (const C of G.clocks) { if (C.at.distanceTo(p) > 180) continue;
    const deps = departures(C.id).filter((d) => !C.only || C.only.includes(d.line)).slice(0, 2), txt = deps.map((d) => `${d.line}${d.dest}|${d.boarding ? 'NOW' : Math.max(1, Math.ceil(d.arrive / 60))}`).join('/');
    if (txt === C.last) continue; C.last = txt; const g = C.c.getContext('2d'); g.fillStyle = '#060606'; g.fillRect(0, 0, 256, 64);
    deps.forEach((d, i) => { const y = 16 + i * 32; g.fillStyle = d.color; g.beginPath(); g.arc(14, y, 11, 0, 7); g.fill(); g.fillStyle = d.fg; g.font = '700 15px Helvetica, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d.line, 14, y + 1);
      g.fillStyle = '#ffae3a'; g.font = '700 16px "Courier New", monospace'; g.textAlign = 'left'; g.fillText(d.dest.slice(0, 14), 32, y + 1); g.textAlign = 'right'; g.fillText(d.boarding ? 'NOW' : `${Math.max(1, Math.ceil(d.arrive / 60))} min`, 250, y + 1); });
    C.tx.needsUpdate = true; }
  // the station PA: "now approaching" ~25 s out, "this is ..." as the doors open — only while you're on that station's platforms
  if (LINES.some((L) => L.aboard) || ctx.state !== 'playing') return; const st = stationAt(p); if (!st || !(st.plat || st.lower)) return;
  for (const d of departures(st.id)) { if (st.id === 'W8' && (d.line === 'F') !== !!st.plat) continue; if (st.id === 'STW' && st.isl && st.isl !== d.line) continue;
    const L = LINES.find((q) => q.id === d.line), bound = d.to === 'Stillwell Av' ? L.cfg.bound.in : L.cfg.bound.out, k1 = `${st.id}|${d.line}|a|${Math.round(Date.now() / 1000 + d.arrive)}`;
    if (!d.boarding && d.arrive < 25 && d.arrive > 18 && G.paKey !== k1) { G.paKey = k1; const txt = `Attention passengers: the next ${bound} train is now approaching. Please stand away from the platform edge.`; K.toast(txt, 4200); pa(ctx, txt); }
    const k2 = `${st.id}|${d.line}|d|${Math.round(Date.now() / 1000 - (d.leave > 0 ? 0 : 1) + d.leave)}`;
    if (d.boarding && d.leave > 12 && G.paKey2 !== k2 && !G.said?.[k2]) { G.paKey2 = k2; (G.said ||= {})[k2] = 1; const txt = `This is ${NAMES[st.id][1]}. This is a ${bound} train.`; K.toast(txt, 4200); pa(ctx, txt); }
  }
}
/** which side the platform is on at a stop (+1 = the car's right / −1 left, 2 = both) for THIS train on the track it is on now:
 *  measured, not assumed, and cached per train per stop per track (one answer per stop flipped trains on the other track) */
function sideAt(stop) {
  const trk = Math.abs(R.latNow || 0) > TRACK_GAP / 2 ? Math.sign(R.latNow) : 0;
  // the two-track stations out on the line: a side platform beside each track. A car's local +x is the right of the way out and a
  // positive lateral offset moves the car to its local −x: on its own track the platform is away from the other track (+sideSign),
  // on the other track it is further over, beyond that track (−trk)
  if (stop.both) return trk ? -trk : R.sideSign || 1;
  const key = `${stop.id}@${Math.round(stop.s)}|${trk}`, C = (R.sideCache ||= {}); if (C[key]) return C[key];
  const g = R.cars[2]; g.updateMatrixWorld(true);
  const probe = (sx) => { _a.set(sx * 2.4, FLOOR + 0.5, 0).applyMatrix4(g.matrixWorld); const ray = new THREE.Raycaster(new THREE.Vector3(_a.x, _a.y + 1, _a.z), new THREE.Vector3(0, -1, 0), 0, 3); const fy = _a.y - 0.5; return ray.intersectObjects(R.ctx.raycastTargets.filter((o) => o.isMesh && !o.isInstancedMesh), false).filter((h) => Math.abs(h.point.y - fy) < 0.35).length; };   // only a floor at door-sill height counts (a passing Stillwell shuttle flipped the side)
  const r = probe(1), l = probe(-1); if (!r && !l) return 1;   // nothing measured (yet): don't cache a guess
  const side = r >= l ? 1 : -1; C[key] = side; return side;
}
function board(lx, lz, c) {
  const b = R.boardable; if (!b || R.aboard) return;
  R.aboard = { c: c ?? b.c, lx: lx ?? b.sx * 1.1, lz: lz ?? b.dz, head: null };
  R.ctx.player.mounted = { train: true, line: R.id }; R.lastAnn = ''; R.hintOff = true;
  K.toast(`On the ${R.id} — next stop ${b.next?.name || ''}. Walk around; ${R.ctx.isTouch ? 'GET OFF' : 'F'} or the open doors at a stop to get off.`, 3200);
}
function alight(force = false, dz, side) {
  const a = R.aboard; if (!a) return; R.aboard = null; R.ctx.trainRide = false; const p = R.ctx.player; if (p.mounted?.train) p.mounted = null;
  if (force) return;
  const s = side || (R.side === 2 ? (Math.sign(a.lx) || 1) : R.side || 1), d = dz ?? DOORZ.reduce((m, z) => (Math.abs(z - a.lz) < Math.abs(m - a.lz) ? z : m), DOORZ[0]);
  const g = R.cars[a.c]; g.updateMatrixWorld(true); _a.set(s * 2.7, FLOOR, d).applyMatrix4(g.matrixWorld);
  p.teleport?.(_a.x, _a.y + 0.02, _a.z, p.yaw, p.pitch);
}
function announce(l) {
  const oth = ['D', 'F', 'N', 'Q'].filter((x) => x !== R.id), X = { STW: `Transfer is available to the ${oth.slice(0, -1).join(', ')} and ${oth[oth.length - 1]} trains.`, W8: R.id === 'F' ? 'Transfer is available to the Q train.' : R.id === 'Q' ? 'Transfer is available to the F train.' : '' };
  if (l.kind === 'dwell') {
    const s = l.stop, nx = l.next; if (s.hidden) return; chime();
    const bound = nx.s > s.s ? R.cfg.bound.out : R.cfg.bound.in, xf = X[s.id] || '';
    const txt = `This is ${s.speak}. ${xf ? xf + ' ' : ''}This is a ${bound} train. The next stop is ${nx.speak}.`;
    K.toast(txt, 5200); pa(R.ctx, txt);
  } else if (!l.b.hidden) { const txt = `The next stop is ${l.b.speak}.`; K.toast(txt, 3000); pa(R.ctx, txt); }
}
/** the cars' live bits: door-open lights, the LED signs / strip map, ceiling-light flicker, sparks off the shoes at night,
 *  wheel clack + motor whine for the car you ride */
const _sp = new THREE.Vector3();
function cabin(dt, l, t, open, speed, curve) {
  const M = R.kit.M, idx = (st) => ({ STW: 0, W8: 1, NEP: 2, OCP: 2, BRT: 3, B50: 1, A25: 2 })[st.id];
  M.ind.emissiveIntensity = open > 0.05 ? 2.4 : 0;
  // LED: destination follows the direction of travel; the strip map lights the next stop (blinking while you ride)
  const run = l.kind === 'run', a = run ? l.a : l.stop, b = run ? l.b : l.next, fw = b.s > a.s;
  const line = run ? `Next stop: ${R.cfg.strip[idx(b)]}` : `This is ${R.cfg.strip[idx(a)]}`, blink = R.aboard ? Math.floor(now() * 1.6) & 1 : 1;
  const key = `${fw}|${idx(a)}|${idx(b)}|${line}|${blink}`; if (key !== R.ledKey) { R.ledKey = key; drawLED(R.kit.led, R.cfg, fw, idx(a), idx(b), line, blink); }
  // lights: a rare flicker (a gap in the third rail, or a tired ballast)
  R.flk = (R.flk ?? 6) - dt; if (R.flk < 0) { R.flk = 8 + Math.random() * 20; R.flkT = 0.35; }
  // the cabin is lit by its own panels: at night the interior surfaces glow with them (no real lights = no extra cost)
  const nk = Math.max(0, Math.min(1, ((R.W.horizon?.cycle?.s ?? 0) - 0.3) / 0.4)), lit = (R.flkT > 0 && Math.sin(R.flkT * 70) > 0.2 ? 0.2 : 1) * (0.08 + 0.55 * nk);
  if (!M.int.emissiveMap) { for (const m of [M.int, M.floor]) { m.emissive.setHex(0xfff8ec); m.emissiveMap = m.map; m.needsUpdate = true; } }
  M.int.emissiveIntensity = lit; M.floor.emissiveIntensity = lit * 0.6;
  R.flkT = Math.max(0, (R.flkT || 0) - dt); M.lamp.emissiveIntensity = R.flkT > 0 && Math.sin(R.flkT * 70) > 0.2 ? 0.25 : 1.2;
  // sparks: brief showers from the shoes / wheels on the curves and now and then at a joint, at night
  if (!R.spk) { const n = 60, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(-999), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffc070, size: 0.09, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); pts.frustumCulled = false; R.world.scene.add(pts);
    R.spk = { pts, n, v: new Float32Array(n * 3), life: new Float32Array(n), i: 0 }; }
  const S = R.spk, night = (R.W.horizon?.cycle?.s ?? 0) > 0.55, near = R.aboard || R.ctx.player.position.distanceTo(R.cars[2].position) < 220;
  if (night && near && speed > 3 && (Math.abs(curve) > 0.035 ? Math.random() < 0.5 : Math.random() < 0.04)) {
    const g = R.cars[Math.random() * NCAR | 0], tz = (Math.random() < 0.5 ? -1 : 1) * (CAR / 2 - 2.6) + (Math.random() < 0.5 ? -1.05 : 1.05);
    for (let k = 0; k < 6; k++) { const i = S.i = (S.i + 1) % S.n; _sp.set((Math.random() < 0.5 ? -1 : 1) * 1.5, 0.3, tz).applyMatrix4(g.matrixWorld); S.pts.geometry.attributes.position.setXYZ(i, _sp.x, _sp.y, _sp.z);
      S.v[i * 3] = (Math.random() - 0.5) * 5; S.v[i * 3 + 1] = Math.random() * 2.5; S.v[i * 3 + 2] = (Math.random() - 0.5) * 5; S.life[i] = 0.25 + Math.random() * 0.35; } }
  let live = false; const P = S.pts.geometry.attributes.position;
  for (let i = 0; i < S.n; i++) { if (S.life[i] <= 0) continue; S.life[i] -= dt; live = true; if (S.life[i] <= 0) { P.setXYZ(i, 0, -999, 0); continue; }
    S.v[i * 3 + 1] -= 9.8 * dt; P.setXYZ(i, P.getX(i) + S.v[i * 3] * dt, P.getY(i) + S.v[i * 3 + 1] * dt, P.getZ(i) + S.v[i * 3 + 2] * dt); }
  if (live || S.was) P.needsUpdate = true; S.was = live; S.pts.visible = live;
  // ride audio: motor whine on acceleration / braking; a click for every axle of your car crossing a rail joint
  const au = R.au || (R.au = rideAudio(R.ctx)); au.update(!!R.aboard, speed, R.acc || 0);
  if (R.aboard) { const sm = headS() - (R.aboard.c + 0.5) * CAR, ax = [CAR / 2 - 2.6 + 1.05, CAR / 2 - 2.6 - 1.05, -(CAR / 2 - 2.6) + 1.05, -(CAR / 2 - 2.6) - 1.05].map((o) => sm + o);
    if (R.ax) ax.forEach((s, k) => { if (Math.floor(s / JOINT) !== Math.floor(R.ax[k] / JOINT) && speed > 0.8) au.click(speed, k * 0.004); }); R.ax = ax; } else R.ax = null;
}
/** aboard: steel-wheel rumble (filtered noise, louder with speed) + flange squeal when curving at speed */
function trackSound(speed, curve) {
  if (!R.aboard) { if (R.snd) R.snd.g.gain.value = R.snd.q.gain.value = 0; return; }
  try {
    if (!R.snd) { const ac = R.ac || (R.ac = R.ctx.audio?.context || new (window.AudioContext || window.webkitAudioContext)()); const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0); let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; const g = ac.createGain(); g.gain.value = 0; src.connect(lp).connect(g).connect(ac.destination); src.start();
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 2900; const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3100; bp.Q.value = 18; const q = ac.createGain(); q.gain.value = 0; o.connect(bp).connect(q).connect(ac.destination); o.start();
      R.snd = { g, q, o, lp }; }
    const k = Math.min(1, speed / VMAX), v = R.au?.vol?.() ?? 1; R.snd.g.gain.value = (0.05 + k * 0.32) * v; R.snd.lp.frequency.value = 220 + k * 520;
    R.snd.q.gain.value = curve > 0.04 && speed > 4 ? Math.min(0.06, (curve - 0.03) * 0.5) * k * v : 0; R.snd.o.frequency.value = 2800 + Math.sin(now() * 13) * 120;
  } catch {}
}
function chime() {   // the R160 "ding-dong" (two falling sine tones)
  try { const ac = R.ac || (R.ac = R.ctx.audio?.context || new (window.AudioContext || window.webkitAudioContext)()); const t = ac.currentTime;
    for (const [f, d] of [[1046.5, 0], [830.6, 0.32]]) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.18 * (R.au?.vol?.() ?? 1)), t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.7); o.connect(g).connect(ac.destination); o.start(t + d); o.stop(t + d + 0.75); } } catch {}
}

// ---------------------------------------------------------------------------------------------------------------------------
// el structure where coney/city.js doesn't build one (east of the play area): bents every 12 m, girders, ties
/** the el out on the line, NYC style: a steel tie deck over both tracks on plate girders (outer pair + a shared centre girder),
 *  stringers under the rails, running rails; a bent every 12 m (two columns, cap girder, knee braces), no columns in the
 *  street (the girders span it). Lines that share an alignment (the D and the N) build it once. */
const EL_SEEN = new Set();
function buildEl(world, P) {
  const M = world.mats, lite = !!R.ctx.lite; if (!M?.elGirder) return;
  const B = new Batch(world, M, 'viaductLine'), sg = R.sideSign || 1, G2 = TRACK_GAP / 2;
  const skip = (p) => (p.x < 300 && p.z > -672 && Math.abs(p.y - RAIL) < 0.3) || (Math.abs(p.x - 365) < 110 && p.z > -175 && p.z < -90);   // city.js covers the west at rail height (the ramps up to W 8 St's upper level are ours); W 8 St builds its own
  const segD2 = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)); return (a[0] + t * dx - x) ** 2 + (a[1] + t * dz - z) ** 2; };
  const inRoad = (x, z) => OSM.r.some((r) => { const h = r.w / 2; for (let i = 0; i + 1 < r.p.length; i++) if (segD2(x, z, r.p[i], r.p[i + 1]) < h * h) return true; return false; });
  // the ramps up to W 8 St's upper level cross over the lower tracks: their bents never put a column under a rail
  const onTrack = (x, z) => OSM.rl.some((l) => { if (!l.el) return false; for (let i = 0; i + 1 < l.p.length; i++) if (segD2(x, z, l.p[i], l.p[i + 1]) < 2.0 * 2.0) return true; return false; });
  let k = 0;
  for (let i = 0; i + 3 < P.length; i += 3, k++) {
    const a = P[i], b = P[i + 3]; if (skip(a) || skip(b)) continue;
    const key = `${Math.round((a.x + b.x) / 5)},${Math.round((a.z + b.z) / 5)},${Math.round((a.y + b.y))}`; if (EL_SEEN.has(key)) continue; EL_SEEN.add(key);
    const ang = Math.atan2(b.x - a.x, b.z - a.z), L = Math.hypot(b.x - a.x, b.z - a.z), Y = (a.y + b.y) / 2, pitch = -Math.atan2(b.y - a.y, L);
    const ox = Math.cos(ang), oz = -Math.sin(ang), mo = -sg * G2, cx = (a.x + b.x) / 2 + ox * mo, cz = (a.z + b.z) / 2 + oz * mo;   // centre of the two-track pair
    const seg = (u0, u1, y0, y1, key, tie = false) => { const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, L + 0.06);
      if (tie) { const uv = g.attributes.uv, pp = g.attributes.position; for (let q = 0; q < uv.count; q++) uv.setXY(q, (pp.getX(q) + (u1 - u0) / 2) / 5, pp.getZ(q) / 2.4); }
      g.translate((u0 + u1) / 2, (y0 + y1) / 2 - Y, 0); g.rotateX(pitch); g.rotateY(ang); g.translate(cx, Y, cz); B.add(key, g, tie ? { uv: false } : {}); };
    const W = G2 + 2.1;
    for (const u of [-W, W]) seg(u - 0.16, u + 0.16, Y - 1.55, Y - 0.15, 'elGirder');                    // outer plate girders
    seg(-0.14, 0.14, Y - 1.55, Y - 0.2, 'elGirder');                                                      // the shared centre girder
    seg(-W - 0.35, -W + 0.35, Y - 1.62, Y - 1.5, 'elGirder'); seg(W - 0.35, W + 0.35, Y - 1.62, Y - 1.5, 'elGirder');   // bottom flanges
    if (!lite) for (const t of [-G2, G2]) for (const r of [-0.75, 0.75]) seg(t + r - 0.12, t + r + 0.12, Y - 0.72, Y - 0.25, 'elGirder');   // stringers
    seg(-W - 0.2, W + 0.2, Y - 0.25, Y - 0.1, 'elSoffit', true);                                         // the tie deck
    if (!lite) for (const t of [-G2, G2]) for (const r of [-0.72, 0.72]) seg(t + r - 0.04, t + r + 0.04, Y - 0.1, Y + 0.02, 'steel');   // running rails
    // a bent every 12 m: two columns (not in the street), the cap girder, knee braces
    if (k % 2 === 0) {
      const ys = Y - 1.62; seg(-W - 0.5, W + 0.5, ys - 0.5, ys, 'elGirder');
      for (const u of [-(W + 0.3), W + 0.3]) { const px = cx + ox * u, pz = cz + oz * u; if (inRoad(px, pz) || (Y > RAIL + 1 && onTrack(px, pz))) continue;
        const c = new THREE.BoxGeometry(0.5, ys - 0.5, 0.5); c.translate(px, (ys - 0.5) / 2, pz); B.add('elGirder', c);
        const pl = new THREE.BoxGeometry(0.9, 0.12, 0.9); pl.translate(px, 0.06, pz); B.add('elGirder', pl);
        if (!lite) { const kb = new THREE.BoxGeometry(0.14, 2.0, 0.18); kb.rotateZ(Math.sign(u) * 0.75); kb.translate(u - Math.sign(u) * 0.6, ys - 1.1 - Y, 0); kb.rotateY(ang); kb.translate(cx, Y, cz); B.add('elGirder', kb); }
        if (px > -460 && px < 460 && pz > -560 && pz < 160) world.box([px - 0.3, 0, pz - 0.3], [px + 0.3, ys - 0.4, pz + 0.3]); }
    }
  }
  B.flush({ shadow: !lite });
}
function mergeAll(list) {   // tiny merge (positions + normals) so we don't need the addon here
  let n = 0; for (const g of list) n += (g.index ? g.index.count : g.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Neptune Av: elevated, side platforms either side of the F, canopies, name signs, a staircase down each side to Shell Rd,
// Shell Rd under the el and Neptune Ave crossing it, a block of shops / walk-ups on each side
function buildElStation(world, sHead, opt) {
  const { scene, ctx, W } = world;
  const cS = sHead - LEN / 2, c0 = ptAt(cS), c1 = ptAt(cS + 20); const u = new THREE.Vector2(c1.x - c0.x, c1.z - c0.z).normalize(), n = new THREE.Vector2(-u.y, u.x);
  const y = c0.y, plat = y + FLOOR, PL = 130, O0 = 1.7, O1 = 5.4;
  const at = (a, o, yy) => new THREE.Vector3(c0.x + u.x * a + n.x * o, yy, c0.z + u.y * a + n.y * o), ang = Math.atan2(u.x, u.y);
  (W.zones || (W.zones = [])).push({ x0: Math.min(c0.x, c1.x) - 160, x1: Math.max(c0.x, c1.x) + 160, z0: c0.z - 180, z1: c0.z + 400, name: opt.zone, hint: opt.hint });
  { const z = W.zones[W.zones.length - 1]; if (c0.x > (W.bounds?.max?.x ?? 440)) z.x0 = Math.max(z.x0, (W.bounds?.max?.x ?? 440) + 3); else { z.z1 = Math.min(z.z1, (W.bounds?.min?.z ?? -420) - 3); z.z0 = c0.z - 400; } }   // an island zone: overlapping the main map it clamped W 8 St (invisible walls at x 361 / z −83)
  const S = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const conc = S(0xa9a59c, 0.9), edge = S(0xf2c418, 0.7), steel = S(0x3f5a47, 0.6, 0.4), roofM = S(0x5b6168, 0.5, 0.6), asph = S(0x39393b, 0.95), walk = S(0x9d998f, 0.9);
  // a rotated box: merged geometry + collider cells (0.5 m) so the rotated floors stay walkable and the gaps stay open
  const GM = new Map(); let OSH = 0;   // OSH: the side being built is shifted this far across (the far platform sits past the second track)
  const rbox = (m, a0, a1, o0, o1, y0, y1, { collide = true, walkable = false, coarse = false } = {}) => { o0 += OSH; o1 += OSH;
    const g = new THREE.BoxGeometry(o1 - o0, y1 - y0, a1 - a0).toNonIndexed(); g.rotateY(ang); const c = at((a0 + a1) / 2, (o0 + o1) / 2, (y0 + y1) / 2); g.translate(c.x, c.y, c.z); (GM.get(m) || GM.set(m, []).get(m)).push(g);   // merged per material below
    const me = null; if (!collide) return me;
    if (coarse) { const cs = [at(a0, o0, 0), at(a1, o0, 0), at(a0, o1, 0), at(a1, o1, 0)]; world.box([Math.min(...cs.map((q) => q.x)), y0, Math.min(...cs.map((q) => q.z))], [Math.max(...cs.map((q) => q.x)), y1, Math.max(...cs.map((q) => q.z))]); return me; }   // buildings: one box, nobody walks inside
    const cell = 0.6, na = Math.max(1, Math.ceil((a1 - a0) / cell)), no = Math.max(1, Math.ceil((o1 - o0) / cell));
    for (let i = 0; i < na; i++) for (let j = 0; j < no; j++) { const pa = at(a0 + (i + 0.5) * (a1 - a0) / na, o0 + (j + 0.5) * (o1 - o0) / no, 0), h = 0.36; const mn = [pa.x - h, y0, pa.z - h], mx = [pa.x + h, y1, pa.z + h]; walkable ? world.walkable(mn, mx) : world.box(mn, mx); }
    return me;
  };
  const feet = [], stairs = []; if (opt.id === 'NEP') W.neptunePlat = { at, plat, a0: -PL / 2 + 6, a1: PL / 2 - 12, o0: O0 + 0.9 + ((R.sideSign || 1) > 0 ? TRACK_GAP : 0), o1: O1 - 0.9 + ((R.sideSign || 1) > 0 ? TRACK_GAP : 0) };   // riders waiting on the platforms (coney/folk.js)
  // two tracks: the line's own at o = 0, the one back to Stillwell at sideSign × TRACK_GAP, a side platform outside each
  const sh = (s) => (s === (R.sideSign || 1) ? s * TRACK_GAP : 0);
  const atBase = at;
  for (const s of [-1, 1]) {
    const k = sh(s), at = (a, o, yy) => atBase(a, o + k, yy); OSH = k;   // this side's platform, stairs, signs: out past its track
    const o0 = s > 0 ? O0 : -O1, o1 = s > 0 ? O1 : -O0;
    rbox(conc, -PL / 2, PL / 2, o0, o1, plat - 0.35, plat, { walkable: true });
    rbox(edge, -PL / 2, PL / 2, s > 0 ? O0 : -O0 - 0.5, s > 0 ? O0 + 0.5 : -O0, plat, plat + 0.01, { collide: false });
    for (const [r0, r1] of [[-PL / 2, -PL / 2 + 5], [-PL / 2 + 7.6, PL / 2]]) rbox(steel, r0, r1, s > 0 ? O1 - 0.1 : -O1, s > 0 ? O1 : -O1 + 0.1, plat, plat + 1.1);   // back railing, open where the stair landing leaves (it ran straight across: the stairs were unreachable)
    for (let a = -PL / 2 + 8; a < PL / 2; a += 16) rbox(steel, a - 0.12, a + 0.12, s * (O1 - 0.6) - 0.12, s * (O1 - 0.6) + 0.12, plat, plat + 3.2, { collide: false });   // canopy posts
    rbox(roofM, -PL / 2 + 10, PL / 2 - 10, s > 0 ? O0 + 0.4 : -O1 - 0.3, s > 0 ? O1 + 0.3 : -O0 - 0.4, plat + 3.2, plat + 3.35, { collide: false });
    // name signs + F bullets
    for (const a of [-40, 0, 40]) { const sg = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.55), new THREE.MeshStandardMaterial({ map: nameTex(opt.name), emissive: 0xffffff, emissiveMap: nameTex(opt.name), emissiveIntensity: 0.25 })); sg.position.copy(at(a, s * (O1 - 0.62), plat + 2.5)); sg.rotation.y = ang + (s > 0 ? -Math.PI / 2 : Math.PI / 2); scene.add(sg); }
    // stairs down to the street at the south end of each platform (going away from the track, then down along the el)
    const aS = -PL / 2 + 6, oS = s * (O1 + 1.2), nSt = Math.ceil(plat / 0.19), rise = plat / nSt, tread = 0.29;
    rbox(conc, aS - 1, aS + 1.6, s > 0 ? O1 - 0.2 : oS - 1.2, s > 0 ? oS + 1.2 : -O1 + 0.2, plat - 0.35, plat, { walkable: true });   // landing off the platform
    for (let k = 0; k < nSt; k++) { const a0 = aS - 1 - (k + 1) * tread; rbox(conc, a0, a0 + tread, oS - 1.1, oS + 1.1, 0, plat - (k + 1) * rise, { walkable: true }); }
    rbox(steel, aS - 1 - nSt * tread, aS - 1, oS + s * 1.15 - 0.05, oS + s * 1.15 + 0.05, 0, plat + 1.0, { collide: true });   // outer railing
    { const f = at(aS - 1 - nSt * tread - 1.6, oS + s * 1.8, 0); feet.push([f.x, f.z]); stairs.push([at(aS + 0.3, s * (O0 + O1) / 2, plat), at(aS + 0.3, oS, plat), at(aS - 1 - nSt * tread - 1.2, oS, 0)].map((q) => [+q.x.toFixed(2), +q.z.toFixed(2)])); }   // the globe lamp at the stair foot (buildEntrances)
  }
  OSH = 0;
  // street: Shell Rd under the el, Neptune Ave across, sidewalks, a row of storefronts / walk-ups each side
  const plane = (m, a0, a1, o0, o1, yy) => { const g = new THREE.PlaneGeometry(o1 - o0, a1 - a0); g.rotateX(-Math.PI / 2); const me = new THREE.Mesh(g, m); me.position.copy(at((a0 + a1) / 2, (o0 + o1) / 2, yy)); me.rotation.y = ang; me.receiveShadow = true; scene.add(me); };
  if (opt.street) plane(asph, -260, 260, -10, 10, 0.03); if (opt.street) { plane(walk, -260, 260, -14, -10, 0.05); plane(walk, -260, 260, 10, 14, 0.05);
  const fac = facadeTex(), facM = [0xb88a70, 0xd8c7a6, 0x9c5a44, 0xc9c1b0].map((c) => new THREE.MeshStandardMaterial({ map: fac, color: c, roughness: 0.9 }));
  for (const s of [-1, 1]) for (let a = -200; a < 220; a += 13 + ((a * 7) % 5)) { if (Math.abs(at(a, 0, 0).z - NEP_Z) < 16 || (opt.id === 'OCP' && at(a, 0, 0).x < 870)) continue; const h = 7 + ((a * 13) % 7); rbox(facM[((a / 13) | 0) & 3], a, a + 12, s * 15, s * 27, 0, h, { coarse: true }); }
  }
  for (const [m, list] of GM) { const me = new THREE.Mesh(mergeGeometries(list, false), m); me.castShadow = true; me.receiveShadow = true; scene.add(me); }
  // arrival: coming up the stairs at street level shows the POI; a subtle lamp at each stair foot
  STN[opt.id] = { at, plat, O0, O1, c: c0, feet, stairs, ang };
  (W.mapPOIs || (W.mapPOIs = [])).push({ name: opt.name.toUpperCase() + ' STATION', x: c0.x, z: c0.z, kind: 'transit' });   // stairs: [platform, landing, street] per side (QA walks them)
}
// ---------------------------------------------------------------------------------------------------------------------------
// street-level signposting: the green globe lamps (lit, so they read at night too) with an F bullet at every entrance —
// Stillwell's bus-loop doors + the Stillwell Ave door, W 8 St's two stair towers + the Aquarium footbridge stairs, Neptune
// Av's stair feet — and an "F ↑" sign over the one Stillwell stair bank that leads to the F platform
function buildEntrances(world) {
  const { scene, W } = world; const u = W8U, w8 = (a, o) => [W8.P0.x + u.x * a - u.y * o, W8.P0.y + u.y * a + u.x * o];
  const spots = [[-72.8, -256.5], [-59.2, -256.5], [-52.8, -256.5], [-39.2, -256.5], [-89.6, -277.8], [-89.6, -270.2], [-68.2, -143.1], [-42.8, -143.1]];   // + the Surf Ave head house front
  const oN = -(W8.platOut + 2.3), oS = W8.platOut + 2.3, oE = W8.platOut + 38 - 1.4;
  for (const o of [oN, oS]) for (const d of [-1.7, 1.7]) spots.push(w8(38.2, o + d));
  for (const d of [-1.7, 1.7]) spots.push(w8(133.8, oE + d));
  const RT = spots.map((q, i) => (i < 8 ? 'DFNQ' : 'FQ'));   // Stillwell: D F N Q · W 8 St: F Q
  for (const [id, r] of [['NEP', 'F'], ['OCP', 'Q'], ['B50', 'D']]) for (const q of STN[id]?.feet || []) { spots.push(q); RT.push(r); }
  const poles = [], globes = [], bul = [];
  spots.forEach(([x, z], si) => {
    const pg = new THREE.CylinderGeometry(0.055, 0.08, 2.9, 8); pg.translate(x, 1.45, z); poles.push(pg);
    const cap = new THREE.CylinderGeometry(0.2, 0.16, 0.12, 12); cap.translate(x, 2.95, z); poles.push(cap);
    const gg = new THREE.SphereGeometry(0.27, 16, 12); gg.translate(x, 3.25, z); globes.push(gg);
    const rs = RT[si], nb = rs.length, bw = 0.34;   // a row of route bullets on two crossed planes (atlas: D F N Q)
    for (const r of [0, Math.PI / 2]) for (let k = 0; k < nb; k++) { const b = new THREE.PlaneGeometry(bw, bw), uv = b.attributes.uv, cell = 'DFNQ'.indexOf(rs[k]); for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / 4);
      b.translate((k - (nb - 1) / 2) * (bw + 0.03), 0, 0); b.rotateY(r); b.translate(x, 2.3, z); bul.push(b); }
    world.box([x - 0.1, 0, z - 0.1], [x + 0.1, 3.2, z + 0.1]);
  });
  const add = (list, m) => { const me = new THREE.Mesh(mergeGeometries(list, false), m); me.castShadow = true; scene.add(me); return me; };
  add(poles, new THREE.MeshStandardMaterial({ color: 0x1f3a2a, roughness: 0.6, metalness: 0.5 }));
  add(globes, new THREE.MeshStandardMaterial({ color: 0x3fdc6e, emissive: 0x22c653, emissiveIntensity: 1.6, roughness: 0.3 })).castShadow = false;
  const bt = bulletAtlas(); add(bul, new THREE.MeshStandardMaterial({ map: bt, transparent: true, alphaTest: 0.4, emissive: 0xffffff, emissiveMap: bt, emissiveIntensity: 0.5, side: THREE.DoubleSide })).castShadow = false;
  // Stillwell concourse: which stairs go to the F (the 3rd bank from Stillwell Ave, x −49.5)
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#fff'; g.fillRect(0, 6, 512, 4);
  g.fillStyle = '#ff6319'; g.beginPath(); g.arc(52, 54, 32, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '700 44px Helvetica, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('F', 52, 57);
  g.textAlign = 'left'; g.font = '700 30px Helvetica, Arial'; g.fillText('↑  W 8 St · Neptune Av', 100, 44); g.font = '500 20px Helvetica, Arial'; g.fillStyle = '#ffcf8a'; g.fillText('this stairway · west side of the platform', 100, 76);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
  sg.position.set(-49.5, 3.9, -275.7); scene.add(sg);
  void W;
}
function nameTex(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 68; const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, 512, 68); g.fillStyle = '#fff'; g.fillRect(0, 5, 512, 3);
  g.fillStyle = '#ff6319'; g.beginPath(); g.arc(40, 38, 22, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '700 30px Helvetica, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('F', 40, 40);
  g.textAlign = 'left'; g.font = '700 34px Helvetica, Arial'; g.fillText(text, 78, 40);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function facadeTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#3a4048'; for (let x = 10; x < 120; x += 30) g.fillRect(x, 14, 18, 26), g.fillRect(x, 58, 18, 26); g.fillStyle = '#2a2f36'; g.fillRect(0, 100, 128, 28); g.fillStyle = '#e8d8a0'; g.fillRect(8, 104, 112, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
void _p; void _m; void _q; void _up;

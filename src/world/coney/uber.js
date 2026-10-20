// CONEY: Uber (chill mode). The 📱 in your bag (U, the bag's OPEN, or the VR tablet's UBER tab) opens the app: pick Table Park, the
// Bay Ridge ferry, Soc Tav, Brighton or the Steeplechase pier, pay $5, and a black Toyota Camry (the carkit sedan) with a Russian or
// Chinese driver comes to you along the road graph (coney traffic's lanes; 8th Ave by Soc Tav; Brighton Beach Ave) to the nearest
// kerb; you walk the last few metres and F gets in. Up to 3 humans ride: the one who booked sits in the back behind the front
// passenger, like a real Uber; friends take the other rear seat, then the front (F at the car while it waits; it leaves a few
// seconds after the booker gets in). The ride is on the wall clock from the booker's route (everyone's copy of the car is in the same place at the same moment), long hops off the map (Coney <-> Bay Ridge, Brighton)
// fade over the gap like the ferry / tavern arrive(). In the car: seated eye height, mouse look, B drinks / smokes, guns shoot out of
// the windows, Luna Park Radio plays (radio.js: mounted.passenger). A small phone card shows the driver, the ETA and distance and a
// turn-by-turn mini map (one 200 px canvas, also drawn onto the VR tablet). Nothing is built until the first request. CONEY agent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hangkit as K } from '../hangkit.js';
import { sharedCarGeometries, carMaterials, carInterior, carEye, carSpec, parkedCarBoxes, dropParkedCarBoxes } from '../carkit.js';
import { buildPerson, peopleReady, avatarInUse } from '../people.js';
import { OSM } from './osm.js';
import { laneOff } from './traffic.js';
import { TZ, AVE8 } from './tavern.js';
import { BRI } from './brighton.js';
import { solidSource, solidAhead, moveBlocked } from '../../vehicles/solids.js';

const FARE = 5;
const VMAX = 12, A_LON = 2.2, A_LAT = 2.4, STEP = 1.5, RM = 7;        // m/s cruise, m/s² along / across, resample step, corner radius
const APPROACH_D = 200, APPROACH_MIN = 60, MAX_WALK = 140;            // the car starts ~200 m of road away; you must be this close to a road
const DEPART = 4, WAIT_MAX = 150, DROP_HOLD = 1.2, LEAVE_T = 7;       // s: after the booker gets in / how long it waits / out at the kerb / then gone
const BOARD_R = 3.6, SPEED_STILL = 0.4, FEET_Y = 0.3;                   // F reach to the car; getting out only below this speed; your feet over the car's floor
const BLACK = 0x0c0c0d, MAP_PX = 200, UI_HZ = 5, CLOTH_PX = 128, CLOTH_GLOW = 0.18;
const SED = carSpec('sedan'), EYE = carEye('sedan');
// seats in the kit frame (x forward, z right): 0 front passenger, 1 rear right (the booker's, behind the front passenger), 2 rear left. y: eye height over the road
// the front passenger seat slides PAX_FWD forward (as Uber drivers do for a rider behind it): legroom and a view past it for the booker
const PAX_FWD = 0.2, REAR_EYE = 1.12;   // m; the rear eye ~9 cm under the sloped roof's liner
const PAX_BACK_H = 0.7, PAX_REST_H = 0.18, PAX_BACK_K = 0.72, PAX_LOW = PAX_BACK_H * (1 - PAX_BACK_K);   // carInterior's seat back / headrest heights; the back cut to 72 %, its top (and the headrest on it) PAX_LOW lower
const SEATS = [{ x: EYE.x + PAX_FWD, z: -EYE.z, eye: EYE.y }, { x: -1.12, z: 0.5, eye: REAR_EYE }, { x: -1.12, z: -0.5, eye: REAR_EYE }];   // the back row as far back as the sloped roof allows
const BOOKER_ORDER = [1, 2, 0], FRIEND_ORDER = [2, 0, 1];   // the booker rides rear right; friends leave it free for them: rear left, then up front
const DRIVERS = [['Dmitri', 'ru'], ['Sergei', 'ru'], ['Anatoly', 'ru'], ['Oksana', 'ru'], ['Wei', 'cn'], ['Jun', 'cn'], ['Li Na', 'cn'], ['Zhang', 'cn']];
const HOPS = { 'coney>tav': ['BELT PKWY', 'GOWANUS EXPWY · EXIT 7B', '8 AV · SUNSET PARK'], 'coney>ferry': ['BELT PKWY', 'SHORE PKWY', '69 ST · BAY RIDGE FERRY'],
  'tav>coney': ['8 AV', 'GOWANUS EXPWY · BELT PKWY', 'CONEY ISLAND'], 'tav>ferry': ['8 AV', '69 ST · BAY RIDGE FERRY'], 'coney>bri': ['SURF AVE · OCEAN PKWY', 'BRIGHTON BEACH AVE'],
  'bri>coney': ['OCEAN PKWY · SURF AVE', 'CONEY ISLAND'], 'bri>tav': ['BELT PKWY', 'GOWANUS EXPWY · EXIT 7B', '8 AV · SUNSET PARK'], 'bri>ferry': ['BELT PKWY', 'SHORE PKWY', '69 ST · BAY RIDGE FERRY'], 'tav>bri': ['8 AV', 'BELT PKWY', 'BRIGHTON BEACH AVE'] };
const GAP_LONG = 4.5, GAP_SHORT = 2.6;                                 // s of fade over the off-map part (Bay Ridge / Brighton)
// Coney's ways out: up the Belt (Bay Ridge), east on Surf (Brighton); the other zones leave from 8th Ave's west end / Brighton Ave's
const OUT = { coney: { tav: [-92, -545], ferry: [-92, -545], bri: [430, -95] }, tav: [AVE8.X0 + 4, TZ.oz], bri: [BRI.X0 + 20, BRI.ZC] };
// not driving through anyone: the owner's client holds the timeline back (r.hA on the approach, r.hR on the ride, ms) while a vehicle is in
// the way and sends it with the rate it is holding at; every copy runs the same hold, so friends still see the car where it is
const UBER_JAM = 10000;   // ms held by the same jam before the traffic car in front is recycled
const FOLLOW_GAP = 2.5, FOLLOW_T = 1.2, HOLD_HZ = 4, KERB_IGNORE = 30;   // m bumper gap at a stop / s of headway / hold updates a second / m before a stop where parked kerb cars stop counting (it pulls in beside them)
const NZ_FAR = 20000;                                                  // the Narrows (ferry.js) are past this world z: no signal out there
let U = null;

export function buildUber(world) {
  const { ctx, W } = world;
  U = { world, ctx, W, rides: new Map(), cur: null, seat: -1, G: null, tpl: null, open: false, uiT: 0, yawPrev: 0, fadeOn: false, spotPos: new THREE.Vector3(0, -999, 0), lastPhase: '', ownLabel: false };
  K.starter?.('phone');
  K.spot({ pos: U.spotPos, r: BOARD_R, dy: 2.5, when: () => !!boardable(), prompt: () => { const r = boardable(); return r ? `F - GET IN THE UBER · ${r.drv[0]}, black Camry` : ''; }, act: () => { const r = boardable(); if (r) board(r); } });
  buildUI();
  if (!ctx.__uberBound) { ctx.__uberBound = true;   // once per page: a rebuilt map reuses them (they read the module's U)
    ctx.bus.on('phone', () => { if (U && ctx.world === U.W) toggleApp(); });
    ctx.bus.on('net:uber', (m) => { if (U) onNet(m); });
    ctx.bus.on('playerDied', () => { if (U?.seat >= 0) getOut(false); });
    ctx.bus.on('state', ({ state }) => { if (U && state !== 'playing' && U.picking) showApp(false); });
    addEventListener('keydown', onKey, true); }
  solidSource('uber', () => { const out = []; for (const r of U.rides.values()) if (r.st.vis && r.sol) { const o = r.sol; o.x = r.st.x; o.z = r.st.z; o.h = r.st.h; o.v = r.st.v; out.push(o); } return out; });
  world.updaters.push((dt) => { try { update(dt); } catch (e) { if ((U.err = (U.err || 0) + 1) < 4) console.error('[uber]', e); } });
  // net.js: your seat (sent with your state) and a friend's seat → the world, on our copy of the car
  ctx.uber = { local: () => (U.seat >= 0 && U.cur ? [U.cur.id, U.seat] : null), toWorld: (id, seat) => remoteSeat(id, seat), boardDist: (p) => boardDist(p),
    dests: () => DESTS.map((d) => ({ id: d.id, name: d.name })), request: (id) => request(id), active: () => !!U.cur, action: () => action(), label: () => actionLabel(), lines: () => statusLines(), canvas: () => U.cv };
  if (typeof window !== 'undefined' && window.__game) window.__game.uber = qa();
}

// ---- where you can go ----------------------------------------------------------------------------------------------------------
const DESTS = [
  { id: 'table', name: 'Table Park', zone: 'coney', at: () => { const s = U.W.onlineStart; return s ? [s[0], s[2]] : [226, -379]; } },
  { id: 'ferry', name: 'Bay Ridge ferry (69 St)', zone: 'ferry', at: () => null },
  { id: 'soctav', name: 'Soc Tav (8th Ave)', zone: 'tav', at: () => [-6, TZ.oz] },
  { id: 'brighton', name: 'Brighton Beach', zone: 'bri', at: () => [BRI.STN_X - 20, BRI.ZC] },
  { id: 'pier', name: 'Coney Island pier (Steeplechase)', zone: 'coney', at: () => [U.W.pier?.x ?? -360, 120] },
];
function zoneAt(x, z) {
  if (z > NZ_FAR) return null;
  if (x > TZ.x0 - 30 && x < TZ.x1 + 30 && z > TZ.z0 - 60 && z < TZ.z1 + 60) return 'tav';
  if (x > BRI.X0 - 40 && x < BRI.X1 + 10 && z > BRI.ZC - 60 && z < 420) return 'bri';
  const b = U.W.bounds; if (x > b.min.x - 40 && x < b.max.x + 40 && z > b.min.z - 40 && z < b.max.z + 200) return 'coney';
  return null;
}

// ---- road graphs (built on the first request): Coney uses the traffic lanes; 8th Ave and Brighton Beach Ave are small hand graphs -----
function graphs() {
  if (U.G) return U.G;
  const coney = U.W.traffic?.graph?.() || osmGraph();
  const mk = (pts, edges) => { const nodes = pts.map(([x, z]) => ({ x, z, adj: [] }));
    for (const [a, b, w] of edges) { const A = nodes[a], B = nodes[b], L = Math.hypot(B.x - A.x, B.z - A.z); A.adj.push({ to: b, w, len: L, dx: (B.x - A.x) / L, dz: (B.z - A.z) / L }); B.adj.push({ to: a, w, len: L, dx: (A.x - B.x) / L, dz: (A.z - B.z) / L }); }
    return { nodes }; };
  // 8th Ave (x along the avenue at TZ.oz) with 60th and 61st St to the ends of their blocks
  const oz = TZ.oz, c60 = AVE8.cross[0].x, c61 = AVE8.cross[1].x, aw = AVE8.HALF * 2;
  const tav = mk([[AVE8.X0 + 4, oz], [c60, oz], [c61, oz], [AVE8.X1 - 4, oz], [c60, oz - 44], [c60, oz + 44], [c61, oz - 44], [c61, oz + 44]],
    [[0, 1, aw], [1, 2, aw], [2, 3, aw], [1, 4, 12], [1, 5, 12], [2, 6, 12], [2, 7, 12]]);
  // Brighton Beach Ave under the el, west end to east end, a node at every cross street
  const bx = [BRI.X0 + 20, ...BRI.CROSS.map((c) => c.x), BRI.X1 - 20], bri = mk(bx.map((x) => [x, BRI.ZC]), bx.slice(1).map((_, i) => [i, i + 1, BRI.HALF * 2]));
  U.G = { coney, tav, bri };
  return U.G;
}
/** fallback when traffic is off (?traffic=0): every OSM street 9 m and wider inside the map */
function osmGraph() {
  const b = U.W.bounds, nodes = [], idx = new Map(), inB = (x, z) => x > b.min.x + 8 && x < b.max.x - 8 && z > b.min.z + 8 && z < b.max.z - 8;
  const nid = (x, z) => { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let i = idx.get(k); if (i === undefined) { i = nodes.length; nodes.push({ x, z, adj: [] }); idx.set(k, i); } return i; };
  for (const r of OSM.r) { if (r.w < 9) continue; for (let i = 0; i + 1 < r.p.length; i++) { const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1]; if (!inB(ax, az) || !inB(bx, bz)) continue;
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue; const a = nid(ax, az), c = nid(bx, bz); if (a === c || nodes[a].adj.some((e) => e.to === c)) continue;
    nodes[a].adj.push({ to: c, w: r.w, len: L, dx: (bx - ax) / L, dz: (bz - az) / L }); nodes[c].adj.push({ to: a, w: r.w, len: L, dx: (ax - bx) / L, dz: (az - bz) / L }); } }
  return { nodes };
}
function nearestEdge(G, x, z) {
  let best = null; const N = G.nodes;
  for (let a = 0; a < N.length; a++) for (const e of N[a].adj) { if (e.to < a) continue; const A = N[a], B = N[e.to], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz; if (L2 < 1e-3) continue;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2)), px = A.x + dx * t, pz = A.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { a, b: e.to, px, pz, d, w: e.w }; }
  return best;
}
/** Dijkstra from a point on edge e (both its ends seeded with their distance to it): { dist, prev } over every node */
function tree(G, e) {
  const N = G.nodes, n = N.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n), open = [e.a, e.b];
  dist[e.a] = Math.hypot(N[e.a].x - e.px, N[e.a].z - e.pz); dist[e.b] = Math.hypot(N[e.b].x - e.px, N[e.b].z - e.pz);
  while (open.length) { let bi = 0; for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const u = open[bi]; open[bi] = open[open.length - 1]; open.pop(); if (done[u]) continue; done[u] = 1;
    for (const ed of N[u].adj) { const nd = dist[u] + ed.len; if (nd < dist[ed.to]) { dist[ed.to] = nd; prev[ed.to] = u; open.push(ed.to); } } }
  return { dist, prev };
}
const wOf = (G, a, b, dflt) => G.nodes[a]?.adj.find((e) => e.to === b)?.w ?? dflt;
/** node v → ... → the tree's root edge point: centreline vertices [x, z, w (of the street to the next vertex)] */
function walkTree(G, T, e, v, out) { for (; v !== -1; v = T.prev[v]) { const nx = T.prev[v]; out.push([G.nodes[v].x, G.nodes[v].z, nx >= 0 ? wOf(G, v, nx, e.w) : e.w]); } out.push([e.px, e.pz, e.w]); return out; }
/** the road from (fx, fz) to (tx, tz) on graph G */
function route(G, fx, fz, tx, tz) {
  const et = nearestEdge(G, tx, tz), ef = nearestEdge(G, fx, fz); if (!et || !ef) return null;
  if ((ef.a === et.a && ef.b === et.b) || (ef.a === et.b && ef.b === et.a)) return [[ef.px, ef.pz, ef.w], [et.px, et.pz, et.w]];
  const T = tree(G, et), ca = Math.hypot(G.nodes[ef.a].x - ef.px, G.nodes[ef.a].z - ef.pz) + T.dist[ef.a], cb = Math.hypot(G.nodes[ef.b].x - ef.px, G.nodes[ef.b].z - ef.pz) + T.dist[ef.b];
  if (!isFinite(Math.min(ca, cb))) return null;
  return walkTree(G, T, et, ca <= cb ? ef.a : ef.b, [[ef.px, ef.pz, ef.w]]);
}
/** where the car starts: a node about APPROACH_D of road from the pickup, then the road to it */
function approach(G, e) {
  const T = tree(G, e); let best = -1, bd = Infinity, far = -1;
  T.dist.forEach((d, i) => { if (!isFinite(d) || !G.nodes[i].adj.length) return; if (far < 0 || d > T.dist[far]) far = i; if (d >= APPROACH_MIN && Math.abs(d - APPROACH_D) < bd) { bd = Math.abs(d - APPROACH_D); best = i; } });
  const s = best >= 0 ? best : far; if (s < 0) return null;
  return walkTree(G, T, e, s, []);
}

// ---- a leg: centreline → the right-hand lane, rounded corners, resampled, a speed profile (accelerate, slow for corners, stop) ---------
function profile(pts) {
  const n = pts.length, P = [];
  const dir = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
  for (let i = 0; i < n; i++) {
    const d1 = i > 0 ? dir(pts[i - 1], pts[i]) : dir(pts[0], pts[Math.min(1, n - 1)]), d2 = i < n - 1 ? dir(pts[i], pts[i + 1]) : d1;
    const o = (laneOff(i > 0 ? pts[i - 1][2] : pts[i][2]) + laneOff(pts[i][2])) / 2;
    let mx = -d1[1] - d2[1], mz = d1[0] + d2[0]; const ml = Math.hypot(mx, mz); if (ml < 1e-3) { mx = -d1[1]; mz = d1[0]; } else { mx /= ml; mz /= ml; }
    const k = Math.max(0.5, mx * -d1[1] + mz * d1[0]), q = [pts[i][0] + mx * o / k, pts[i][1] + mz * o / k];
    if (!P.length || Math.hypot(q[0] - P[P.length - 1][0], q[1] - P[P.length - 1][1]) > 0.3) P.push(q);
  }
  // key points: straight runs, a quadratic Bezier round each corner
  const key = [P[0]];
  for (let i = 1; i < P.length - 1; i++) { const A = P[i - 1], B = P[i], C = P[i + 1], ab = Math.hypot(B[0] - A[0], B[1] - A[1]), bc = Math.hypot(C[0] - B[0], C[1] - B[1]), r = Math.min(RM, ab * 0.45, bc * 0.45);
    const p1 = [B[0] - (B[0] - A[0]) / ab * r, B[1] - (B[1] - A[1]) / ab * r], p2 = [B[0] + (C[0] - B[0]) / bc * r, B[1] + (C[1] - B[1]) / bc * r];
    for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; key.push([u * u * p1[0] + 2 * u * t * B[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * B[1] + t * t * p2[1]]); } }
  if (P.length > 1) key.push(P[P.length - 1]);
  // resample every STEP m
  const xs = [key[0][0]], zs = [key[0][1]]; let carry = 0;
  for (let i = 1; i < key.length; i++) { const [ax, az] = key[i - 1], [bx, bz] = key[i], L = Math.hypot(bx - ax, bz - az); let d = STEP - carry;
    while (d <= L) { xs.push(ax + (bx - ax) * d / L); zs.push(az + (bz - az) * d / L); d += STEP; } carry = L - (d - STEP); }
  const last = key[key.length - 1]; if (Math.hypot(last[0] - xs[xs.length - 1], last[1] - zs[zs.length - 1]) > 0.05) { xs.push(last[0]); zs.push(last[1]); }
  const m = xs.length, s = new Float64Array(m), h = new Float64Array(m), v = new Float64Array(m), t = new Float64Array(m);
  for (let i = 1; i < m; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  for (let i = 0; i < m; i++) { const a = Math.min(i, m - 2), b = a + 1; h[i] = m > 1 ? Math.atan2(-(xs[b] - xs[a]), -(zs[b] - zs[a])) : 0; }
  for (let i = 0; i < m; i++) { const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1), ds = s[b] - s[a], k = ds > 0 ? Math.abs(wrap(h[b] - h[a])) / ds : 0; v[i] = Math.min(VMAX, Math.sqrt(A_LAT / Math.max(k, 1e-4))); }
  v[0] = 0; v[m - 1] = 0;
  for (let i = 1; i < m; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * A_LON * (s[i] - s[i - 1])));
  for (let i = m - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * A_LON * (s[i + 1] - s[i])));
  for (let i = 1; i < m; i++) t[i] = t[i - 1] + (s[i] - s[i - 1]) / Math.max(0.3, (v[i - 1] + v[i]) / 2);
  return { x: xs, z: zs, s, h, v, t, T: t[m - 1], L: s[m - 1] };
}
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
/** a leg at time tt (s from its start): { x, z, h, v, s, i } */
function sample(P, tt, out = {}) {
  const m = P.x.length; if (m < 2 || tt <= 0) { out.x = P.x[0]; out.z = P.z[0]; out.h = P.h[0]; out.v = 0; out.s = 0; out.i = 0; return out; }
  if (tt >= P.T) { out.x = P.x[m - 1]; out.z = P.z[m - 1]; out.h = P.h[m - 1]; out.v = 0; out.s = P.L; out.i = m - 1; return out; }
  let lo = 0, hi = m - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.t[mid] <= tt) lo = mid; else hi = mid; }
  const k = (tt - P.t[lo]) / Math.max(1e-6, P.t[hi] - P.t[lo]);
  out.x = P.x[lo] + (P.x[hi] - P.x[lo]) * k; out.z = P.z[lo] + (P.z[hi] - P.z[lo]) * k; out.h = P.h[lo] + wrap(P.h[hi] - P.h[lo]) * k; out.v = P.v[lo] + (P.v[hi] - P.v[lo]) * k; out.s = P.s[lo] + (P.s[hi] - P.s[lo]) * k; out.i = lo;
  return out;
}

// ---- booking --------------------------------------------------------------------------------------------------------------------
function request(destId) {
  const { ctx } = U, p = ctx.player, d = DESTS.find((q) => q.id === destId); if (!d || !p) return false;
  if (U.cur) { K.toast(U.seat >= 0 ? 'You\'re already in an Uber' : `${U.cur.drv[0]} is already on the way`, 1600); return false; }
  if (p.dead || ctx.vehicles?.mounted || p.mounted) { K.toast('Uber: get out / off first, then book', 1600); return false; }
  const zp = zoneAt(p.position.x, p.position.z); if (!zp) { K.toast('Uber: no signal out here', 1600); return false; }
  const G = graphs(), e = nearestEdge(G[zp], p.position.x, p.position.z);
  if (!e || e.d > MAX_WALK) { K.toast('Uber: no cars can get anywhere near you here. Walk to a street', 2200); return false; }
  if (d.zone === zp) { const a = d.at(); if (Math.hypot(a[0] - p.position.x, a[1] - p.position.z) < 40) { K.toast(`You're already at ${d.name}`, 1600); return false; } }
  const ap = approach(G[zp], e), legs = plan(zp, e, d);
  if (!ap || !legs) { K.toast('Uber: no drivers available right now', 1600); return false; }
  if (!K.pay(FARE)) { K.toast(`Uber: card declined. A ride is $${FARE} and you have $${K.cash}`, 2400); return false; }
  const t0 = Date.now(), id = (t0 % 2000000000) | 0;
  const msg = { a: 'req', id, t0, d: d.id, ap: ap.map(rnd), lg: legs.map((l) => ({ z: l.z, p: l.p.map(rnd), f: l.f || null })) };
  const r = addRide(msg, ctx.net?.id || 'me'); if (!r) { K.earn(FARE); return false; }
  U.cur = r; ctx.net?.send?.('uber', msg);
  K.toast(`${r.drv[0]} is on the way · black Toyota Camry · about ${Math.max(1, Math.round(r.appr.T / 60 * 10) / 10)} min. $${FARE} paid`, 3200);
  showApp(true, false);
  return true;
}
const rnd = (q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10, Math.round(q[2] || 9)];
/** the ride's legs: one in this zone, or out of it (fade) and in from the other end */
function plan(zp, e, d) {
  const G = graphs(), from = [e.px, e.pz];
  const exit = (z, to) => (z === 'coney' ? OUT.coney[to] : OUT[z]), entry = (z, frm) => (z === 'coney' ? OUT.coney[frm] : OUT[z]);
  if (d.zone === zp) { const a = d.at(), p = route(G[zp], from[0], from[1], a[0], a[1]); return p ? [{ z: zp, p }] : null; }
  const x = exit(zp, d.zone), p1 = route(G[zp], from[0], from[1], x[0], x[1]); if (!p1) return null;
  const legs = [{ z: zp, p: p1, f: `${zp}>${d.zone}` }];
  if (d.zone === 'ferry') return legs;
  const en = entry(d.zone, zp), a = d.at(), p2 = route(G[d.zone], en[0], en[1], a[0], a[1]); if (!p2) return null;
  legs.push({ z: d.zone, p: p2 }); return legs;
}
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const okPts = (a) => Array.isArray(a) && a.length >= 1 && a.length <= 600 && a.every((q) => Array.isArray(q) && q.length === 3 && q.every(num) && Math.abs(q[0]) < 40000 && Math.abs(q[1]) < 40000);
function addRide(m, owner) {
  if (U.rides.has(m.id)) return U.rides.get(m.id);
  const d = DESTS.find((q) => q.id === m.d); if (!d || !okPts(m.ap) || !Array.isArray(m.lg) || !m.lg.length || m.lg.length > 2) return null;
  if (!m.lg.every((l) => ['coney', 'tav', 'bri'].includes(l.z) && okPts(l.p) && (l.f == null || HOPS[l.f]))) return null;
  const legs = m.lg.map((l) => ({ z: l.z, f: l.f || null, P: profile(l.p) }));
  const r = { hA: 0, hR: 0, hk: 1, hSent: 0, hT: 0, id: m.id, owner, t0: m.t0, tg: null, dest: d, drv: DRIVERS[Math.abs(m.id) % DRIVERS.length], plate: plateOf(m.id), appr: profile(m.ap), legs, riders: new Map(), car: null, st: {}, gone: false };
  r.end = legs.reduce((a, l) => a + l.P.T + (l.f ? gapOf(l.f) : 0), 0);
  r.sol = { x: 0, z: 0, h: 0, v: 0, hl: SED.len / 2, hw: SED.w / 2, ext: true, uber: r.id };
  U.rides.set(r.id, r); at(r, Date.now()); buildCar(r);
  return r;
}
const gapOf = (f) => (/ferry|tav/.test(f) ? GAP_LONG : GAP_SHORT);
const plateOf = (id) => `T${String(100000 + (Math.abs(id) % 899999)).slice(-6)}C`;   // NYC TLC plates: T…C
function onNet(m) {
  if (!m || !Number.isInteger(m.id)) return; const f = typeof m.f === 'string' ? m.f : null;
  if (m.a === 'req' && num(m.t0) && f) { if (!U.rides.has(m.id)) { const r = addRide(m, f); if (r) K.toast(`${U.ctx.net?.peer?.(f)?.name || 'A friend'} booked an Uber to ${r.dest.name}. Hop in when it pulls up (F)`, 2600); } return; }
  const r = U.rides.get(m.id); if (!r) return;
  if (m.a === 'go' && num(m.tg) && f === r.owner) r.tg = m.tg;
  else if (m.a === 'in' && Number.isInteger(m.s) && m.s >= 0 && m.s < SEATS.length && f) r.riders.set(f, m.s);
  else if (m.a === 'out' && f) r.riders.delete(f);
  else if (m.a === 'h' && f === r.owner && num(m.ha) && num(m.hr) && num(m.k)) { r.hA = m.ha; r.hR = m.hr; r.hk = Math.max(0, Math.min(1, m.k)); }
  else if (m.a === 'x' && f === r.owner) dropRide(r, `${U.ctx.net?.peer?.(f)?.name || 'Your friend'} cancelled the Uber`);
}

// ---- the timeline: approach → wait at the kerb → (go) legs with a fade between → arrived ----------------------------------------
const _s = {};
function at(r, now) {
  const st = r.st; st.zone = r.legs[0].z; st.vis = true; st.fade = null; st.leg = -1; st.barge = false;
  const ta = r.t0 + r.appr.T * 1000, nA = now - r.hA;
  if (r.tg == null || now - r.hR < r.tg) { if (nA < ta) { sample(r.appr, (nA - r.t0) / 1000, _s); st.phase = 'coming'; st.P = r.appr; } else { sample(r.appr, r.appr.T, _s); st.phase = 'waiting'; st.P = r.appr; } st.zone = zoneOfLeg(r, -1); }   // held pulling out (no gap in the traffic): it stays at the kerb
  else {
    let t = (now - r.tg - r.hR) / 1000; st.phase = 'arrived'; st.P = null;
    for (let i = 0; i < r.legs.length; i++) { const L = r.legs[i];
      if (t < L.P.T) { sample(L.P, t, _s); st.phase = 'riding'; st.leg = i; st.P = L.P; st.zone = L.z; break; }
      t -= L.P.T; sample(L.P, L.P.T, _s); st.zone = L.z;
      if (L.f) { const g = gapOf(L.f); if (t < g) { st.phase = 'gap'; st.vis = false; st.fade = L.f; st.leg = i; st.gapK = t / g; break; } t -= g;
        if (i === r.legs.length - 1) { st.vis = false; st.barge = true; } }   // the ferry: dropped at the landing in the fade
    }
    if (st.phase === 'arrived') st.since = t;
  }
  st.x = _s.x; st.z = _s.z; st.h = _s.h; st.v = st.phase === 'riding' || st.phase === 'coming' ? _s.v : 0; st.s = _s.s; st.i = _s.i;
  return st;
}
const zoneOfLeg = (r, i) => (i < 0 ? r.legs[0].z : r.legs[i].z);
function remaining(r, st) {   // { t: s, d: m } to the end of this phase (the pickup while it's coming, the drop-off while riding)
  if (st.phase === 'coming') return { t: r.appr.T - (Date.now() - r.hA - r.t0) / 1000, d: r.appr.L - st.s };
  if (st.phase === 'waiting') return { t: 0, d: 0 };
  let t = 0, d = 0; const now = (Date.now() - r.hR - (r.tg ?? Date.now())) / 1000;
  t = Math.max(0, r.end - now);
  for (let i = Math.max(0, st.leg); i < r.legs.length; i++) d += i === st.leg && st.phase === 'riding' ? r.legs[i].P.L - st.s : i === st.leg ? 0 : r.legs[i].P.L;
  return { t, d };
}

// ---- the car (built on the first ride; later cars share its geometry) ------------------------------------------------------------
function template() {
  if (U.tpl) return U.tpl;
  const G = sharedCarGeometries('sedan').geos, CM = carMaterials(), paint = CM.paint.clone(); paint.color.setHex(BLACK); paint.name = 'uber_paint';
  const body = new THREE.Group(); body.name = 'uberBody'; body.rotation.y = Math.PI / 2;
  for (const [slot, g] of Object.entries(G)) { if (!g || !CM[slot]) continue; const m = new THREE.Mesh(g, slot === 'paint' ? paint : slot === 'glass' ? (CM.glassSee || CM.glass) : CM[slot]); m.castShadow = slot === 'paint' && !U.ctx.lite; m.userData.surface = 'metal'; body.add(m); }
  const cab = carInterior('sedan', G); body.add(cab.group); cab.wheel.name = 'uberWheel';
  // the front passenger seat, slid up, its back and headrest set low: the booker sees the road over it, not a wall at the nose
  for (const o of cab.group.children) if (o.material === cab.seatMat && Math.abs(o.position.z + EYE.z) < 0.01) { o.position.x += PAX_FWD; const hgt = o.geometry.parameters?.height;
    if (hgt === PAX_BACK_H) { o.scale.y = PAX_BACK_K; o.position.y -= PAX_LOW / 2; } else if (hgt === PAX_REST_H) o.position.y -= PAX_LOW; }
  // the sedan's cabin has no rear bench (it sits behind its fast backlight): ours does, ahead of the rear axle where the back seats sit
  const seatMat = cab.seatMat, rx = SEATS[1].x;
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, SED.w * 0.76), seatMat); bench.position.set(rx - 0.02, SED.clr + 0.3, 0); cab.group.add(bench);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, SED.w * 0.76), seatMat); back.position.set(rx - 0.33, SED.clr + 0.6, 0); back.rotation.z = 0.24; cab.group.add(back); bench.name = back.name = 'uberBench';
  U.tpl = body; return body;
}
// ---- the Camry's rear cabin, built the first time you sit in the back (5 merged meshes, one 128 px cloth texture) -------------------
// grey woven bench (two contoured cushions + a centre section, bolstered backs, headrests), belts with orange buckle tabs, the front
// seats' backs with map pockets, the console's rear vents and USB ports, black carpet mats, dark door cards with armrests and handles
function clothTex() {
  const c = document.createElement('canvas'); c.width = c.height = CLOTH_PX; const g = c.getContext('2d'); g.fillStyle = '#85878b'; g.fillRect(0, 0, CLOTH_PX, CLOTH_PX);
  for (let y = 0; y < CLOTH_PX; y += 2) for (let x = 0; x < CLOTH_PX; x += 2) { const k = ((x >> 1) + (y >> 1)) % 2, n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5) % 1; g.fillStyle = `rgba(${k ? '255,255,255' : '0,0,0'},${0.06 + Math.abs(n) * 0.06})`; g.fillRect(x, y, 2, 1 + k); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function rearCabin() {
  if (U.rear) return U.rear;
  const parts = { cloth: [], dark: [], carpet: [], silver: [], tab: [] };
  const box = (slot, w, h, d, x, y, z, rz = 0, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z); parts[slot].push(g); };
  const rx = SEATS[1].x + 0.1, y0 = SED.clr, HW = SED.w / 2;   // the cushion a little ahead of the rider's eye (hips under it, back behind)
  for (const s of [1, -1]) { const z = s * 0.36, fx = s > 0 ? PAX_FWD : 0, low = s > 0 ? PAX_LOW : 0;   // the passenger side's seat is slid up and its back cut down
    box('cloth', 0.5, 0.12, 0.44, rx - 0.02, y0 + 0.33, z);                                               // cushion
    for (const e of [0.21, -0.21]) box('cloth', 0.46, 0.06, 0.06, rx - 0.02, y0 + 0.41, z + e);          // its contour rolls
    box('cloth', 0.12, 0.56, 0.42, rx - 0.33, y0 + 0.68, z, 0.24);                                         // back
    for (const e of [0.2, -0.2]) box('cloth', 0.08, 0.5, 0.07, rx - 0.27, y0 + 0.68, z + e, 0.24);        // back bolsters
    box('cloth', 0.1, 0.15, 0.24, rx - 0.44, y0 + 1.06, z, 0.24);                                          // headrest
    box('dark', 0.012, 0.62, 0.05, rx - 0.25, y0 + 0.74, s * 0.6, 0.24, s * 0.55);                         // belt across the shoulder
    box('tab', 0.03, 0.06, 0.03, rx - 0.22, y0 + 0.42, s * 0.14);                                          // buckle tab
    box('dark', 0.04, 0.48 - low, 0.44, EYE.x - 0.45 + fx, y0 + 0.66 - low / 2, z, 0.2);                                        // the front seat's back
    box('cloth', 0.03, 0.2, 0.38, EYE.x - 0.5 + fx, y0 + 0.5, z, 0.2); box('dark', 0.035, 0.02, 0.38, EYE.x - 0.48 + fx, y0 + 0.6, z, 0.2);   // its map pocket (cloth, an elastic hem on top)
    box('carpet', 0.36 + fx, 0.012, 0.42, EYE.x - 0.62 + fx / 2, y0 + 0.07, z);                                          // floor mat
    box('dark', 0.8, 0.48, 0.035, rx - 0.1, y0 + 0.62, s * (HW - 0.13));                                   // door card
    box('dark', 0.42, 0.05, 0.09, rx + 0.02, y0 + 0.58, s * (HW - 0.18));                                  // armrest
    box('silver', 0.12, 0.025, 0.02, rx + 0.25, y0 + 0.78, s * (HW - 0.16)); }                            // door handle
  box('cloth', 0.48, 0.1, 0.22, rx - 0.02, y0 + 0.31, 0); box('cloth', 0.1, 0.52, 0.22, rx - 0.33, y0 + 0.64, 0, 0.24);   // centre section
  box('dark', 0.03, 0.18, 0.2, EYE.x - 0.58, y0 + 0.42, 0);                                                // rear of the console
  for (const dz of [-0.05, 0.05]) for (const dy of [0.46, 0.49]) box('silver', 0.006, 0.008, 0.07, EYE.x - 0.6, y0 + dy, dz);   // two vents' slats
  for (const dz of [-0.03, 0.03]) box('silver', 0.006, 0.01, 0.025, EYE.x - 0.6, y0 + 0.37, dz);           // USB ports
  const tex = clothTex();   // a touch of self-light: the cabin under the roof gets little of the sun, and the weave should still read
  const M = { cloth: new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: CLOTH_GLOW, roughness: 0.95, name: 'uber_cloth' }), dark: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.8, name: 'uber_rear_dark' }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 1, name: 'uber_carpet' }), silver: new THREE.MeshStandardMaterial({ color: 0xb9bdc3, metalness: 0.8, roughness: 0.3, name: 'uber_silver' }),
    tab: new THREE.MeshStandardMaterial({ color: 0xe0501c, roughness: 0.6, name: 'uber_buckle' }) };
  const g = new THREE.Group(); g.name = 'uberRear';
  for (const [k, list] of Object.entries(parts)) { const m = new THREE.Mesh(mergeGeometries(list), M[k]); list.forEach((q) => q.dispose()); m.castShadow = false; m.receiveShadow = true; g.add(m); }
  U.rear = g; return g;
}
/** you sit in the back: this car gets the rear cabin (the plain bench under it hides) */
function showRear(r) {
  const body = r.car?.children[0]; if (!body || r.rearOn) return; r.rearOn = true;
  body.traverse((o) => { if (o.name === 'uberBench') o.visible = false; }); body.add(rearCabin().clone());
}
function buildCar(r) {
  const g = new THREE.Group(); g.name = 'uber'; g.add(template().clone()); r.car = g;   // shares the template's geometry and materials
  // the driver: seated at the wheel (feet just over the floor, DRV_FWD ahead of the eye so the arms reach the rim), hands on it (driverGrip)
  if (peopleReady()) { try { const seed = 700 + (Math.abs(r.id) % 97), female = r.drv[0] === 'Oksana' || r.drv[0] === 'Li Na', f = buildPerson({ seed, pose: 'sit', female, avatar: avatarInUse(female, seed) }); kitToLocal(EYE.x + DRV_FWD, 0.08, EYE.z, f.group.position); f.group.rotation.y = Math.PI; g.add(f.group); r.driver = f; r.wheel = g.getObjectByName('uberWheel'); driverGrip(r); f.update(0.016); } catch (e) { console.warn('[uber] driver', e?.message || e); } }
  U.world.scene.add(g);
}
const kitToLocal = (kx, ky, kz, out) => out.set(kz, ky, -kx);
// the driver's hands at ten to two on the wheel's rim (carkit's rim: radius RIM_R in the wheel group's y-z plane, z to the right)
const DRV_FWD = 0.1, RIM_R = 0.18, GRIP = [[0, 0.07, -0.166], [0, 0.07, 0.166]];
function driverGrip(r) {
  const f = r.driver, w = r.wheel; if (!f || !w) return; r.car.updateMatrixWorld(true);
  f.grip = f.grip || [new THREE.Vector3(), new THREE.Vector3()]; GRIP.forEach((q, i) => w.localToWorld(f.grip[i].set(q[0], q[1], q[2])));
}
/** the parked / waiting car is solid (carkit cells, like a parked car); moving, it has no colliders (the grid rebuilds on each change) */
function carSolid(r, on) {
  if (!!r.solid === on) return; const ctx = U.ctx;
  if (on) { r.solid = { kind: 'sedan', x: r.st.x, z: r.st.z, ry: r.st.h + Math.PI / 2 }; parkedCarBoxes(U.world, r.solid); }
  else { dropParkedCarBoxes(ctx, r.solid); r.solid = null; }
}
/** hold the timeline while something is in the way. The owner checks the step the clock just took (not into anyone: else it is taken
 *  back) and sets the rate from the gap ahead, and broadcasts; the others run the owner's rate between messages */
function hold(r, st, dt, now) {
  const el = r.lastNow != null ? Math.max(0, now - r.lastNow) : 0, o = r.sol; r.lastNow = now;
  const moving = st.vis && (st.phase === 'coming' || st.phase === 'riding') && st.zone === 'coney';   // Coney's streets only for now: on 8th Ave it waits for ever behind a stopped avenue car (not understood yet)
  const back = (ms) => { if (ms <= 0) return; if (st.phase === 'coming') r.hA += ms; else r.hR += ms; at(r, now); };
  if (!moving || dt <= 0 || !el) { o.x = st.x; o.z = st.z; o.h = st.h; return; }
  if (r.owner === (U.ctx.net?.id || 'me')) {
    const P = st.P, left = P ? P.L - st.s : 0;
    o.ignore = left < KERB_IGNORE ? (q) => !!q.parked : null;   // kerb cars at the stop: it pulls in beside them
    const by = moveBlocked(o, st.x, st.z, st.h);   // o is still where it was last frame
    if (by) back(el);
    const a = solidAhead(o, st.x, st.z, st.h, o.hl, o.hw, 40, 0.05);
    r.hk = by ? 0 : a.o ? Math.max(0, Math.min(1, (a.gap - FOLLOW_GAP) / Math.max(3, st.v * FOLLOW_T) + Math.max(0, a.v) / Math.max(st.v, 1))) : 1;
    r.hBy = by || (r.hk < 1 ? a.o : null); o.ignore = null;
    r.heldT = r.hk < 0.05 && r.hBy ? (r.heldT || 0) + el : 0;
    if (r.heldT > UBER_JAM && r.hBy?.kind && !r.hBy.bus) { U.W.traffic?.recycle?.(r.hBy); r.heldT = 0; }   // a queue that won't clear (a car stuck facing it): the traffic car gives way by leaving
    if (!by) back(el * (1 - r.hk));
    if (Math.abs(r.hk - (r.kSent ?? 1)) > 0.2 || (r.hk < 1 && now - r.hT > 1000 / HOLD_HZ) || (r.hk === 1 && r.kSent < 1)) { r.hT = now; r.kSent = r.hk; U.ctx.net?.send?.('uber', { a: 'h', id: r.id, ha: Math.round(r.hA), hr: Math.round(r.hR), k: +r.hk.toFixed(2) }); }
  } else back(el * (1 - r.hk));
  st.v *= r.hk; o.x = st.x; o.z = st.z; o.h = st.h;
}
function dropRide(r, msg) {
  if (r.gone) return; r.gone = true; carSolid(r, false); if (r.car) U.world.scene.remove(r.car); U.rides.delete(r.id);
  if (U.cur === r) { if (U.seat >= 0) getOut(false); U.cur = null; showApp(false); if (msg) K.toast(msg, 2400); }
}
const _w = new THREE.Vector3();
/** a seat → the world: feet (eye = false) or eyes */
function seatWorld(st, seat, eye, out) {
  const S = SEATS[seat], kx = eye ? S.x : S.x - 0.2, ky = eye ? S.eye : 0.08; kitToLocal(kx, ky, S.z, _w);
  const c = Math.cos(st.h), s = Math.sin(st.h); return out.set(st.x + _w.x * c + _w.z * s, ky, st.z - _w.x * s + _w.z * c);
}
function remoteSeat(id, seat) { const r = U.rides.get(id); if (!r || !r.car || seat < 0 || seat >= SEATS.length || !r.st.vis) return null; const q = seatWorld(r.st, seat, false, new THREE.Vector3()); return { x: q.x, y: q.y, z: q.z, h: r.st.h }; }
function boardable() {
  const p = U.ctx.player; if (!p || p.dead || U.seat >= 0 || p.mounted || U.ctx.vehicles?.mounted) return null;
  for (const r of U.rides.values()) { const st = r.st; if (st.phase !== 'waiting' && !(st.phase === 'coming' && st.v < SPEED_STILL)) continue; if (r.tg != null && Date.now() > r.tg) continue;
    if (r.riders.size >= SEATS.length) continue; if (Math.hypot(st.x - p.position.x, st.z - p.position.z) < BOARD_R + 1.2) return r; }
  return null;
}
function boardDist(p) { const r = boardable(); return r ? Math.hypot(r.st.x - p.x, r.st.z - p.z) - 1.2 : Infinity; }
function board(r, want = -1) {
  const { ctx } = U, p = ctx.player, me = ctx.net?.id || 'me', mine = r.owner === me;
  const used = new Set(r.riders.values()); const seat = want >= 0 && !used.has(want) ? want : (mine ? BOOKER_ORDER : FRIEND_ORDER).find((s) => !used.has(s)); if (seat == null) { K.toast('The Uber is full', 1400); return; }
  r.riders.set(me, seat); U.cur = r; U.seat = seat; U.yawPrev = r.st.h; U.lastPhase = ''; if (seat >= 1) showRear(r);
  p.mounted = { passenger: true, uber: true, speed: 0 }; p.yaw = r.st.h; p.pitch = -0.05;
  ctx.net?.send?.('uber', { a: 'in', id: r.id, s: seat });
  if (mine && r.tg == null) { r.tg = Date.now() + DEPART * 1000; ctx.net?.send?.('uber', { a: 'go', id: r.id, tg: r.tg }); }
  K.toast(`${r.drv[1] === 'ru' ? '«Привет! Пристегнись.»' : '«你好! Seat belt, please.»'} ${r.drv[0]} · to ${r.dest.name}. B drinks / smokes, shoot out of the windows`, 3200);
  try { ctx.bus.emit('vrFace'); } catch {}
  showApp(true, false);
}
function getOut(arrived) {
  const { ctx } = U, p = ctx.player, r = U.cur; if (U.seat < 0) return; const seat = U.seat; U.seat = -1;
  if (p.mounted?.uber) p.mounted = null; if (U.ownLabel) { ctx.actionLabel = null; U.ownLabel = false; } fade(false);
  if (r) { r.riders.delete(ctx.net?.id || 'me'); ctx.net?.send?.('uber', { a: 'out', id: r.id, s: seat });
    const st = r.st; if (st.barge) { U.cur = null; showApp(false); ctx.ferry?.toBarge?.(); return; }
    // out on the kerb side (rear-left riders too: everyone climbs out to the right, it's a one-way street feel)
    const c = Math.cos(st.h), s = Math.sin(st.h), fx = -Math.sin(st.h), fz = -Math.cos(st.h), back = seat === 0 ? 0 : -1;
    p.teleport(st.x + c * 2.2 + fx * back, (U.W.groundHeight?.(st.x + c * 2.2, st.z - s * 2.2) ?? 0) + 0.05, st.z - s * 2.2 + fz * back, p.yaw, 0); }
  if (arrived || !r || r.owner !== (ctx.net?.id || 'me')) { U.cur = null; showApp(false); }
  else if (r.tg == null || Date.now() < r.tg) { ctx.net?.send?.('uber', { a: 'x', id: r.id }); dropRide(r, null); K.toast('Ride cancelled. No refunds', 1600); }
  else { U.cur = null; showApp(false); }
}

// ---- per frame ----------------------------------------------------------------------------------------------------------------
function update(dt) {
  const { ctx } = U, now = Date.now(), p = ctx.player;
  for (const r of [...U.rides.values()]) {
    const st = at(r, now);
    hold(r, st, dt, now);
    if (r.tg == null && now > r.t0 + r.hA + (r.appr.T + WAIT_MAX) * 1000) { dropRide(r, `${r.drv[0]} couldn't wait any longer and left`); continue; }
    if (st.phase === 'arrived' && st.since > LEAVE_T && !(U.cur === r && U.seat >= 0)) { if (U.cur === r) { U.cur = null; showApp(false); } dropRide(r, null); continue; }
    const g = r.car; if (!g) continue; g.visible = st.vis; g.position.set(st.x, 0, st.z); g.rotation.y = st.h;
    carSolid(r, st.vis && st.v < SPEED_STILL && (st.phase === 'waiting' || st.phase === 'arrived'));
    if (r.driver && p && st.vis && Math.hypot(st.x - p.position.x, st.z - p.position.z) < 60) { driverGrip(r); r.driver.update(dt, 0); }
    if (r === U.cur && U.seat < 0 && st.phase === 'waiting' && U.lastPhase !== 'waiting' && r.owner === (ctx.net?.id || 'me')) K.toast(`${r.drv[0]} is here: black Camry, plate ${r.plate}. F at the car to get in`, 3000);
    if (r === U.cur && U.seat < 0) U.lastPhase = st.phase;
  }
  // the spot (hangkit's F prompt) follows the waiting car's kerb-side door
  { const r = boardable(); if (r) { const c = Math.cos(r.st.h), s = Math.sin(r.st.h); U.spotPos.set(r.st.x + c * 1.4, p?.position.y ?? 0, r.st.z - s * 1.4); } else U.spotPos.set(0, -999, 0); }
  if (U.seat >= 0) ride(dt);
  U.uiT -= dt; if (U.uiT <= 0) { U.uiT = 1 / UI_HZ; renderApp(); }
}
const _eye = new THREE.Vector3(), _ft = new THREE.Vector3();
function ride() {
  const { ctx } = U, p = ctx.player, r = U.cur; if (!r || r.gone) { U.seat = -1; if (p.mounted?.uber) p.mounted = null; return; }
  if (p.dead) { getOut(false); return; }
  const st = r.st;
  if (st.phase === 'gap') fade(true, HOPS[st.fade], st.gapK); else if (U.fadeOn) fade(false);
  if (st.barge || (st.phase === 'arrived' && st.since >= DROP_HOLD)) { const d = r.dest.name; getOut(true); K.toast(`${d}. ${r.drv[1] === 'ru' ? '«Приехали!»' : '«到了!»'} Rate ${r.drv[0]}: ★★★★★`, 3000); return; }
  if (st.phase === 'gap') return;   // in the fade the car is off the map: keep your last spot until the next leg puts you in it
  p.yaw += wrap(st.h - U.yawPrev); U.yawPrev = st.h;   // you turn with the car
  seatWorld(st, U.seat, false, _ft); p.position.set(_ft.x, FEET_Y, _ft.z); p.velocity?.set?.(0, 0, 0); if (p.mounted) p.mounted.speed = st.v;
  seatWorld(st, U.seat, true, _eye); const cam = ctx.camera; cam.position.copy(_eye); cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ'); p.cameraPosition?.copy?.(cam.position);
  const still = st.v < SPEED_STILL && st.phase !== 'riding';
  ctx.actionLabel = still ? 'GET OUT' : null; U.ownLabel = true;
  const inp = ctx.input; if (ctx.state === 'playing' && inp?.pressed?.has?.('KeyF')) { inp.pressed.delete('KeyF'); if (still) getOut(false); else K.toast(`${r.drv[0]}: «Wait, wait, I stop the car first»`, 1400); }
}
function fade(on, text, k = 0) {
  const f = document.querySelector('.hgfade'), fl = document.querySelector('.hgfloor'); if (!f) return;
  if (!on) { if (U.fadeOn) { f.style.transition = 'opacity .4s'; f.style.opacity = '0'; if (fl) { fl.textContent = ''; fl.style.fontSize = ''; } U.fadeOn = false; } return; }
  if (!U.fadeOn) { f.classList.remove('car'); f.style.transition = 'opacity .35s'; f.style.opacity = '1'; U.fadeOn = true; }
  if (fl && text) { fl.style.fontSize = '40px'; fl.textContent = text[Math.min(text.length - 1, Math.floor(k * text.length))]; }
}

// ---- the phone: a DOM card (desktop / touch) + one small canvas for the map (the VR tablet draws the same canvas) -------------------
function buildUI() {
  document.querySelectorAll('.uber-app').forEach((e) => e.remove());
  if (!document.getElementById('ubercss')) { const s = document.createElement('style'); s.id = 'ubercss'; s.textContent = CSS; document.head.appendChild(s); }
  const el = document.createElement('div'); el.className = 'uber-app' + (U.ctx.isTouch ? ' touch' : ''); el.style.display = 'none';
  el.innerHTML = '<header><b>Uber</b><span class="cash"></span><button data-u="close">✕</button></header><div class="ub-body"></div><canvas width="' + MAP_PX + '" height="' + MAP_PX + '"></canvas><div class="ub-foot"></div>';
  document.body.appendChild(el); U.el = el; U.body = el.querySelector('.ub-body'); U.foot = el.querySelector('.ub-foot'); U.cv = el.querySelector('canvas'); U.g = U.cv.getContext('2d');
  // the trip card: tap to expand / collapse; a destination / close / cancel button: act on it
  const tap = (e) => { const t = e.target.closest('[data-u]'); if (!t) { if (!U.picking && U.cur) { e.preventDefault(); U.big = !U.big; showApp(true, false); } return; }
    e.preventDefault(); e.stopPropagation(); const a = t.dataset.u;
    if (a === 'close') showApp(false); else if (a === 'cancel') action(); else if (a.startsWith('go:')) request(a.slice(3)); };
  el.addEventListener('click', tap); el.addEventListener('touchend', tap);
}
function onKey(e) {
  const { ctx } = U; if (ctx.world !== U.W || ctx.state !== 'playing') return;
  if (U.picking) { const m = /^(Digit|Numpad)([1-5])$/.exec(e.code); if (m || e.code === 'Escape' || e.code === 'KeyU') { e.preventDefault(); e.stopImmediatePropagation(); if (e.repeat) return; if (m) request(DESTS[+m[2] - 1].id); else showApp(false); } return; }
  if (e.code === 'KeyU' && !e.repeat && !ctx.durakOpen && !document.querySelector('.hkui.dialog')) { e.preventDefault(); toggleApp(); }
}
function toggleApp() { if (!K.has('phone')) { K.toast('No phone on you', 1200); return; } if (U.el.style.display === 'none') showApp(true, !U.cur); else showApp(false); }
/** show the card: picking a destination (pointer free for the buttons) or the trip status (doesn't take the mouse) */
function showApp(on, pick = false) {
  U.picking = on && pick && !U.cur; U.el.style.display = on ? 'block' : 'none'; U.el.classList.toggle('pick', U.picking); U.uiT = 0;
  if (!U.cur) U.big = false; U.el.classList.toggle('mini', !U.picking && !!U.cur && !U.big);   // booked: a small corner card (driver, ETA, map) until tapped
  if (U.picking) { try { document.exitPointerLock?.(); } catch {} } else if (on === false && U.ctx.state === 'playing' && !U.ctx.isTouch && !document.pointerLockElement) { try { U.ctx.requestPointerLock?.(); } catch {} }
  renderApp();
}
function action() { const r = U.cur; if (!r) return; if (U.seat >= 0) { if (r.st.v < SPEED_STILL && r.st.phase !== 'riding') getOut(false); return; } if (r.owner === (U.ctx.net?.id || 'me')) { U.ctx.net?.send?.('uber', { a: 'x', id: r.id }); dropRide(r, 'Ride cancelled. No refunds'); } else { U.cur = null; showApp(false); } }
function actionLabel() { const r = U.cur; if (!r) return ''; return U.seat >= 0 ? '🚪 GET OUT (when stopped)' : r.owner === (U.ctx.net?.id || 'me') ? '✕ CANCEL RIDE' : '✕ CLOSE'; }
const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.ceil(Math.max(0, s) % 60) % 60).padStart(2, '0')}`;
const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
function statusLines() {
  const r = U.cur; if (!r) return []; const st = r.st, rem = remaining(r, st), p = U.ctx.player.position, nt = nextTurn(st);
  const who = `${r.drv[0]} · ★4.${8 + (Math.abs(r.id) % 2)} · black Toyota Camry · ${r.plate}`;
  if (st.phase === 'coming') return [who, `Arriving in ${mmss(rem.t)} · ${dist(rem.d)} away`, `Walk to the kerb: ${dist(Math.hypot(r.appr.x[r.appr.x.length - 1] - p.x, r.appr.z[r.appr.z.length - 1] - p.z))} from you`];
  if (st.phase === 'waiting') return [who, U.seat >= 0 ? `Leaving in ${Math.max(0, Math.ceil(((r.tg ?? Date.now()) - Date.now()) / 1000))} s · friends can hop in (F)` : `${r.drv[0]} is here · F at the car to get in`, `To ${r.dest.name}`];
  if (st.phase === 'gap') return [who, `To ${r.dest.name} · ETA ${mmss(rem.t)}`, (HOPS[st.fade] || []).join(' → ')];
  if (st.phase === 'arrived') return [who, `You've arrived: ${r.dest.name}`, ''];
  return [who, `To ${r.dest.name} · ETA ${mmss(rem.t)} · ${dist(rem.d)}`, nt ? `${nt.dir === 0 ? 'Arrive' : nt.dir < 0 ? 'Turn right' : 'Turn left'} in ${dist(nt.d)}` : ''];
}
/** the next turn ahead of the car on its current leg: { dir: 1 left, −1 right, 0 arrive, d: m } */
function nextTurn(st) {
  const P = st.P; if (!P || st.phase === 'gap' || st.phase === 'arrived') return null; const m = P.x.length;
  for (let j = st.i + 1; j < m - 6; j++) { const dh = wrap(P.h[j + 6] - P.h[j]); if (Math.abs(dh) > 0.6) return { dir: Math.sign(dh), d: Math.max(0, P.s[j] - st.s) }; if (P.s[j] - st.s > 600) return null; }
  return { dir: 0, d: Math.max(0, P.L - st.s) };
}
function renderApp() {
  if (!U.el || U.el.style.display === 'none') return;
  U.el.querySelector('.cash').textContent = `$${K.cash}`;
  // buttons are built once, not every UI tick: a finger lifted after a rebuild lands on a detached button and the tap is lost
  const set = (el, html) => { if (el._html !== html) { el._html = html; el.innerHTML = html; } };
  if (U.picking) {
    set(U.body, '<p class="ub-q">Where to? <small>$' + FARE + ' a ride</small></p>' + DESTS.map((d, i) => `<button data-u="go:${d.id}"><b>${i + 1}</b>${d.name}<em>$${FARE}</em></button>`).join(''));
    U.cv.style.display = 'none'; set(U.foot, U.ctx.isTouch ? '' : '<small>1-5 book · U / Esc close</small>'); return;
  }
  const r = U.cur; if (!r) { set(U.body, '<p class="ub-q">No ride. U to book one.</p>'); U.cv.style.display = 'none'; set(U.foot, ''); return; }
  const L = statusLines(); set(U.body, L.map((t, i) => `<p class="l${i}">${esc(t)}</p>`).join(''));
  U.cv.style.display = 'block'; drawMap(r);
  set(U.foot, `<button data-u="cancel">${esc(actionLabel())}</button>`);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** the mini map: heading-up on the car while riding (up = where you look while it's coming), the route ahead, the car, you, the next turn */
function drawMap(r) {
  const g = U.g, S = MAP_PX, st = r.st, p = U.ctx.player, me = p.position, riding = U.seat >= 0;
  const cx = riding ? st.x : me.x, cz = riding ? st.z : me.z, a = riding ? st.h : p.yaw;
  const span = Math.max(70, Math.hypot(st.x - me.x, st.z - me.z) * 1.25), k = S * 0.42 / span, c = Math.cos(a), s = Math.sin(a);
  const tx = (x, z) => { const dx = x - cx, dz = z - cz; return [S / 2 + (dx * c - dz * s) * k, S / 2 + (dx * s + dz * c) * k]; };
  g.fillStyle = '#1c1f24'; g.fillRect(0, 0, S, S);
  // streets around (this zone's graph)
  const G = U.G?.[st.zone]; if (G) { g.strokeStyle = '#3a3f47'; g.lineWidth = 3; g.beginPath(); const R2 = (span * 1.6) ** 2;
    for (let i = 0; i < G.nodes.length; i++) { const A = G.nodes[i]; for (const e of A.adj) { if (e.to < i) continue; const B = G.nodes[e.to]; if ((A.x - cx) ** 2 + (A.z - cz) ** 2 > R2 && (B.x - cx) ** 2 + (B.z - cz) ** 2 > R2) continue; const [x0, y0] = tx(A.x, A.z), [x1, y1] = tx(B.x, B.z); g.moveTo(x0, y0); g.lineTo(x1, y1); } } g.stroke(); }
  // the route ahead
  const P = st.P; if (P && st.vis) { g.strokeStyle = '#3d8bff'; g.lineWidth = 4; g.lineJoin = 'round'; g.beginPath(); let [x0, y0] = tx(st.x, st.z); g.moveTo(x0, y0);
    for (let j = st.i + 1; j < P.x.length; j += 2) { [x0, y0] = tx(P.x[j], P.z[j]); g.lineTo(x0, y0); } [x0, y0] = tx(P.x[P.x.length - 1], P.z[P.z.length - 1]); g.lineTo(x0, y0); g.stroke(); g.fillStyle = '#fff'; g.fillRect(x0 - 4, y0 - 4, 8, 8); }
  // you, the car (a pointer along its heading)
  if (!riding) { const [px, py] = tx(me.x, me.z); g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); }
  if (st.vis) { const [x, y] = tx(st.x, st.z), ha = st.h - a; g.save(); g.translate(x, y); g.rotate(-ha); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke(); g.restore(); }
  // the next turn: an arrow and the distance, top left
  const nt = nextTurn(st); if (nt) { g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(6, 6, 74, 40); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 4; g.beginPath();
    if (nt.dir === 0) { g.arc(24, 26, 7, 0, Math.PI * 2); g.fill(); } else { const sx = nt.dir < 0 ? 1 : -1; g.moveTo(24 - sx * 6, 40); g.lineTo(24 - sx * 6, 22); g.lineTo(24 + sx * 6, 22); g.stroke(); g.beginPath(); g.moveTo(24 + sx * 12, 22); g.lineTo(24 + sx * 4, 15); g.lineTo(24 + sx * 4, 29); g.closePath(); g.fill(); }
    g.font = '700 13px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(dist(nt.d), 40, 26); }
  if (st.phase === 'gap') { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, S / 2 - 16, S, 32); g.fillStyle = '#fff'; g.font = '700 13px system-ui'; g.textAlign = 'center'; g.fillText((HOPS[st.fade] || [''])[Math.min(2, Math.floor(st.gapK * (HOPS[st.fade] || ['']).length))], S / 2, S / 2); }
}

function qa() {
  return {
    state: () => { const r = U.cur, p = U.ctx.player, st = r?.st; return { cash: K.cash, phone: K.has('phone'), open: U.el.style.display !== 'none', picking: !!U.picking, seat: U.seat, mounted: !!p.mounted?.uber, rides: U.rides.size,
      cur: r ? { hold: [Math.round(r.hA), Math.round(r.hR), +r.hk.toFixed(2)], by: r.hBy ? [r.hBy.parked ? 'parked' : r.hBy.kind || (r.hBy.cop != null ? 'cop' : r.hBy.veh ? 'player' : 'x'), +r.hBy.x.toFixed(1), +r.hBy.z.toFixed(1), +(r.hBy.v || 0).toFixed(1)] : null, id: r.id, phase: st.phase, zone: st.zone, dest: r.dest.id, driver: r.drv[0], car: [+st.x.toFixed(1), +st.z.toFixed(1), +st.h.toFixed(2)], v: +st.v.toFixed(1), riders: [...r.riders.values()], tg: r.tg, approachT: +r.appr.T.toFixed(1), approachL: +r.appr.L.toFixed(0), legs: r.legs.map((l) => [l.z, +l.P.L.toFixed(0), +l.P.T.toFixed(1)]), driverModel: !!r.driver, avatar: r.driver?.avatar, lines: statusLines() } : null,
      eyeOverRoad: +(U.ctx.camera.position.y).toFixed(2), pos: p.position.toArray().map((v) => +v.toFixed(1)), ui: U.el.textContent }; },
    card: () => { const b = U.el.getBoundingClientRect(); return { mini: U.el.classList.contains('mini'), w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y), vw: innerWidth, vh: innerHeight }; }, tapCard: () => U.el.querySelector('.ub-body').click(),
    request: (id) => request(id), open: () => toggleApp(), board: (seat = -1) => { const r = boardable(); if (r) board(r, seat); return !!r; }, out: () => getOut(false),
    broke: () => { K.pay(K.cash); return K.cash; }, cash: (n) => { K.pay(K.cash); K.earn(n); return K.cash; },
    // QA: fast-forward the current ride's clock by s seconds (moves its start times back; this client only)
    ff: (s) => { const r = U.cur; if (!r) return false; r.t0 -= s * 1000; if (r.tg != null) r.tg -= s * 1000; return true; },
    remote: () => [...U.rides.values()].map((r) => ({ id: r.id, owner: r.owner, phase: r.st.phase, car: [r.st.x, r.st.z], riders: [...r.riders.entries()] })),
    kerb: () => { const r = U.cur; return r ? [r.appr.x[r.appr.x.length - 1], r.appr.z[r.appr.z.length - 1], r.appr.h[r.appr.h.length - 1]] : null; },
    walkDist: () => { const G = graphs(), p = U.ctx.player.position, z = zoneAt(p.x, p.z); const e = z && nearestEdge(G[z], p.x, p.z); return e ? +e.d.toFixed(1) : null; },
    // QA: the driver's wrists to the wheel rim (m): the distance from each wrist to the nearest point of the rim circle
    hands: () => { const r = U.cur, f = r?.driver, w = r?.wheel; if (!f || !w) return null; r.car.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(w.matrixWorld).invert(), ws = w.getWorldScale(new THREE.Vector3()).x;
      return f.wrists().map((b) => { const q = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), rr = Math.hypot(q.y, q.z); return +(Math.hypot(q.x, rr - RIM_R) * ws).toFixed(3); }); },
    // QA: geometry bytes the current car holds of its own (not the parked sedans' shared set), and that shared set's size
    geoBytes: () => { const r = U.cur; if (!r?.car) return null; const shared = new Set(Object.values(sharedCarGeometries('sedan').geos)), seen = new Set(); let own = 0, sh = 0;
      const sz = (g) => Object.values(g.attributes).reduce((a, x) => a + x.array.byteLength, 0) + (g.index ? g.index.array.byteLength : 0);
      r.car.traverse((o) => { const g = o.geometry; if (!g || seen.has(g)) return; seen.add(g); if (shared.has(g)) sh += sz(g); else if (!o.isSkinnedMesh) own += sz(g); });
      return { own: +(own / 1048576).toFixed(2), shared: +(sh / 1048576).toFixed(2) }; },
    solid: () => { const r = U.cur; return r?.solid ? r.solid.boxes.length : 0; },
    destDist: () => { const G = graphs(); return DESTS.filter((d) => d.zone !== 'ferry').map((d) => { const a = d.at(), e = nearestEdge(G[d.zone], a[0], a[1]); return [d.id, +e.d.toFixed(1)]; }); },
  };
}

const CSS = `
.uber-app{position:fixed;right:18px;top:96px;z-index:44;width:224px;padding:10px 12px 12px;border-radius:24px;background:#0b0b0b;border:3px solid #2e2e30;box-shadow:0 8px 30px rgba(0,0,0,.55);color:#f4f4f4;font:500 12.5px system-ui,-apple-system,Arial;pointer-events:none}
.uber-app.pick,.uber-app button{pointer-events:auto}
.uber-app.touch{top:calc(env(safe-area-inset-top,0px) + 64px);right:calc(env(safe-area-inset-right,0px) + 10px);width:200px;font-size:11.5px}
.uber-app header{display:flex;align-items:center;gap:8px;margin-bottom:6px}.uber-app header b{font:800 18px system-ui;letter-spacing:-.02em}.uber-app header .cash{flex:1;opacity:.7}
.uber-app header button{border:0;background:#222;color:#ddd;border-radius:50%;width:26px;height:26px;cursor:pointer}
.uber-app .ub-body p{margin:3px 0;line-height:1.3}.uber-app .ub-body p.l0{opacity:.75}.uber-app .ub-body p.l1{font-weight:700;font-size:1.08em}.uber-app .ub-q{font-weight:700;font-size:14px}.uber-app .ub-q small{opacity:.6;font-weight:500}
.uber-app .ub-body button{display:flex;align-items:center;gap:8px;width:100%;margin:4px 0;padding:9px 10px;border:0;border-radius:10px;background:#1d1e20;color:#fff;font:600 13px system-ui;text-align:left;cursor:pointer}
.uber-app .ub-body button b{color:#7ea8ff;width:12px}.uber-app .ub-body button em{margin-left:auto;font-style:normal;opacity:.6}.uber-app .ub-body button:hover{background:#2b2d31}
.uber-app canvas{display:block;width:100%;aspect-ratio:1;border-radius:14px;margin-top:6px}
.uber-app.mini{width:150px;padding:6px 8px 8px;border-radius:14px;border-width:2px;font-size:10.5px;pointer-events:auto;cursor:pointer}
.uber-app.mini.touch{width:min(30vw,140px)}
.uber-app.mini header{margin-bottom:2px}.uber-app.mini header b{font-size:13px}.uber-app.mini header .cash,.uber-app.mini header button,.uber-app.mini .ub-body p.l2,.uber-app.mini .ub-foot{display:none}
.uber-app.mini .ub-body p{margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.uber-app.mini .ub-body p.l1{font-size:1em;white-space:normal}.uber-app.mini canvas{margin-top:4px;border-radius:8px}
.uber-app .ub-foot{margin-top:6px;text-align:center}.uber-app .ub-foot small{opacity:.5}.uber-app .ub-foot button{width:100%;padding:7px;border:0;border-radius:10px;background:#2a2b2e;color:#fff;font:600 12px system-ui;cursor:pointer}
`;

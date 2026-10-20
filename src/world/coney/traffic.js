// CONEY traffic: cars that drive the OSM street network around the player, GTA style. TRAFFIC agent.
// Roads: every OSM street 9 m and wider inside the map (Surf Ave, Stillwell, Neptune, Mermaid, W 8th and the side streets),
// validated against the finished collider set (a lane that runs into a building is dropped) and cut to the largest connected
// network. Cars keep right: the lane is the street centreline offset to the right (two lanes each way on Surf Ave), corners
// are quadratic Beziers between mitred lane points, so every car stays on the asphalt by construction.
// Rules: IDM car following (keeps its distance, brakes for whoever is in front, you included), slows for curves, signals on
// the big junctions (Surf/Stillwell, Surf/W 12, Surf/W 8, Stillwell/Mermaid, Stillwell/Neptune: wall-clock phases, identical
// on every client), stop signs where a small street meets a bigger one (all-way where equals meet).
// Budget: ~24 cars within 250 m on desktop, 10 within 150 m on phones; recycled to the far side of the ring when left behind.
// Render: one InstancedMesh per kind x material slot (lofted carkit bodies, wheels as separate spinning instances, brake /
// head / turn lamps as additive glow cards), drivers = Rocketbox people seated at the wheel for the nearest cars and a cheap
// instanced silhouette for the rest (phones: silhouettes only).
// You: F at the driver's door carjacks (the driver is pulled out and runs or fights; you drive it through vehicles.js, so
// radio / crashes / drive-bys / cops all work). Cars honk when you block them, pass you after a while, stop dead (and the
// driver may get out angry) when you ram them; shoot the driver and the car rolls to a stop.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OSM } from './osm.js';
import { BW } from './shore.js';
import { carGeometries, carMaterials, carSpec, carEye, carInterior, wheelGeometry, wheelLayout, CAR_COLORS, hideParkedCar, carBoxes } from '../carkit.js';
import { hasCarModel, carModel } from '../carmodels.js';
import { buildPerson, peopleReady } from '../people.js';
import { BoxGrid, rectBlocked } from '../../vehicles/collide.js';
import { hangkit as HK } from '../hangkit.js';
import { adoptFolk, folkFlee } from './chill.js';
import { buildBus, BUS } from '../../vehicles/bus.js';
import { solidSource, staticSolids, solidsNear, moveBlocked, obbOverlap } from '../../vehicles/solids.js';

const RM = 8;                    // max corner radius (m)
const CYC = 34;                  // signal cycle (s): A green 0-14, amber 14-17, all red 17-18, B green 18-30, amber 30-33, all red
const A_MAX = 1.9, B_COMF = 2.6, T_HEAD = 1.25, S0 = 2.2;   // IDM
const JAM = 9, BUS_JAM = 12;   // s stuck behind a stopped car before the deadlock breaker: one of the pair out of sight is recycled / the bus you ride clears its way
const NAMES = ['SAL', 'VINNIE', 'DMITRI', 'TONY', 'MARISOL', 'OKSANA', 'DESHAWN', 'LUIS', 'FRANKIE', 'IRINA', 'BORIS', 'KEISHA', 'ANGELO', 'SVETA', 'RAY'];
const SIGNALS = [[-86, -132], [46, -109], [297, -47], [-87, -290], [-87, -536]];
const YELL = ['MOVE IT, BUDDY!', 'Yo! You wanna get run over?!', 'Get outta the road!', 'Нашёл где стоять!', 'C\'mon, c\'mon, c\'mon…', 'I\'m WALKIN\' here? No — I\'m DRIVIN\' here!'];

const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (a, b) => { let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

/** lane centre offset from the street centreline (m, to the right) for a street of width w, lane 0 = inner */
export function laneOff(w, lane = 0) { if (w >= 20) return lane ? 5.1 : 1.9; if (w >= 14) return 2.4; return w >= 10 ? 1.9 : 1.8; }
const roadSpeed = (w) => (w >= 20 ? 13.5 : w >= 14 ? 11 : 8.5);

let T = null;   // module state
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1);
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const _o = { x: 0, z: 0, dx: 0, dz: 1 };

// =========================================================================================================================
// road graph
function laneBlocked(grid, ax, az, bx, bz, w) {
  const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L, n = Math.max(2, Math.ceil(L / 2.5)); let run = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * L; let hit = false;
    for (const sd of [1, -1]) { const off = laneOff(w, 0) * sd, x = ax + dx * t - dz * off, z = az + dz * t + dx * off; if (rectBlocked(grid, x - 0.75, z - 0.75, x + 0.75, z + 0.75, 0.35, 1.6)) hit = true; }
    run = hit ? run + 1 : 0; if (run >= 2) return true;
  }
  return false;
}
function buildGraph(world) {
  const { ctx, W } = world, b = W.bounds, M = 8, zMax = BW.z0 - 4;
  const parked = new Set((world.parkedCars || []).flatMap(carBoxes));
  const grid = new BoxGrid(4); grid.build(ctx.colliders.filter((c) => !parked.has(c) && c.max.y > 0.35 && (c.max.x - c.min.x) < 400 && ((c.max.x - c.min.x) > 0.8 || (c.max.z - c.min.z) > 0.8)));   // el columns / poles / hydrants don't close a street
  const inB = (x, z) => x > b.min.x + M && x < b.max.x - M && z > b.min.z + M && z < zMax;
  const nodes = [], idx = new Map(); let dropped = 0;
  const nid = (x, z) => { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let i = idx.get(k); if (i === undefined) { i = nodes.length; nodes.push({ x, z, adj: [], ctrl: null }); idx.set(k, i); } return i; };
  for (const r of OSM.r) {
    if (r.w < 9) continue;
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1];
      if (!inB(ax, az) || !inB(bx, bz)) continue;
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      if (laneBlocked(grid, ax, az, bx, bz, r.w)) { dropped++; (T.droppedSegs ||= []).push([ax, az, bx, bz, r.w]); continue; }
      const a = nid(ax, az), c = nid(bx, bz); if (a === c || nodes[a].adj.some((e) => e.to === c)) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      nodes[a].adj.push({ to: c, w: r.w, len: L, dx, dz }); nodes[c].adj.push({ to: a, w: r.w, len: L, dx: -dx, dz: -dz });
    }
  }
  // the largest connected piece only (no cars shuttling on a stub)
  const comp = new Int32Array(nodes.length).fill(-1); let best = -1, bestN = 0;
  for (let s = 0; s < nodes.length; s++) { if (comp[s] >= 0 || !nodes[s].adj.length) continue; let n = 0; const st = [s]; comp[s] = s; while (st.length) { const u = st.pop(); n++; for (const e of nodes[u].adj) if (comp[e.to] < 0) { comp[e.to] = s; st.push(e.to); } } if (n > bestN) { bestN = n; best = s; } }
  for (let i = 0; i < nodes.length; i++) if (comp[i] !== best) nodes[i].adj.length = 0;
  // directed segments for spawning (weighted by street width: the avenues get most of the cars)
  const segs = []; let total = 0;
  const corridor = (a, b) => { const mx = (nodes[a].x + nodes[b].x) / 2; return (mx > -105 && mx < -75) || (mx > 335 && mx < 395); };   // Stillwell, W 8th (Surf is the w ≥ 20 one)
  for (let a = 0; a < nodes.length; a++) for (const e of nodes[a].adj) { const wt = e.len * (e.w >= 20 ? 3 : corridor(a, e.to) ? 2.6 : e.w >= 14 ? 1.8 : 1); segs.push({ a, b: e.to, w: e.w, len: e.len, wt }); total += wt; }
  // junction control: signals on the listed junctions, stop signs where a smaller street meets a bigger one (all-way for equals)
  for (const n of nodes) { if (n.adj.length < 3) continue; n.maxW = Math.max(...n.adj.map((e) => e.w)); n.ctrl = 'stop'; }
  let nsig = 0;
  for (const [sx, sz] of SIGNALS) {
    let bi = -1, bd = 14; nodes.forEach((n, i) => { if (n.adj.length < 3) return; const d = Math.hypot(n.x - sx, n.z - sz); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) continue; const n = nodes[bi]; const main = n.adj.reduce((m, e) => (e.w > m.w ? e : m), n.adj[0]);
    n.ctrl = 'signal'; n.sig = { off: (hash(bi, 7) % CYC), grp: new Map(), ax: main.dx, az: main.dz, heads: [] }; nsig++;
    for (const e of n.adj) n.sig.grp.set(e.to, Math.abs(e.dx * main.dx + e.dz * main.dz) > 0.7 ? 0 : 1);
  }
  // NYC: every avenue crossing is signalised (an avenue ≥ 14 m meeting a street ≥ 9 m), not only the big five
  nodes.forEach((n, bi) => { if (n.sig || n.adj.length < 3 || n.maxW < 14) return; const main = n.adj.reduce((m, e) => (e.w > m.w ? e : m), n.adj[0]);
    if (!n.adj.some((e) => Math.abs(e.dx * main.dx + e.dz * main.dz) < 0.5 && e.w >= 9)) return;
    n.ctrl = 'signal'; n.sig = { off: (hash(bi, 7) % CYC), grp: new Map(), ax: main.dx, az: main.dz, heads: [] }; nsig++;
    for (const e of n.adj) n.sig.grp.set(e.to, Math.abs(e.dx * main.dx + e.dz * main.dz) > 0.7 ? 0 : 1); });
  console.log('[traffic] road nodes', nodes.filter((n) => n.adj.length).length, '· directed segments', segs.length, '· dropped (blocked)', dropped, '· signals', nsig);
  return { nodes, segs, total, grid };
}
// a bus is 2.55 m wide: on the narrow streets (one lane each way) the kerb cars along its route would have its side in them
function clearBusRoutes(world) {
  { let n = 0; const N = T.G.nodes, reach = BUS.w / 2 + 0.05;
    for (const r of T.routes) for (let i = 0; i < r.nodes.length; i++) { const A = N[r.nodes[i]], B = N[r.nodes[(i + 1) % r.nodes.length]], e = edge(r.nodes[i], r.nodes[(i + 1) % r.nodes.length]); if (!e) continue;
      const L = Math.hypot(B.x - A.x, B.z - A.z), dx = (B.x - A.x) / L, dz = (B.z - A.z) / L, off = laneOff(e.w, 1);   // its lane (the pull-in at a stop is cleared in buildRoute)
      for (const c of world.parkedCars || []) { if (c.gone) continue; const px = c.x - A.x, pz = c.z - A.z, a = px * dx + pz * dz; if (a < -3 || a > L + 3) continue; const l = pz * dx - px * dz, S = parkedSolid(c);
        if (Math.abs(l - off) < reach + S.hw) { dropParked(c); n++; } } }
    // and the kerb it pulls in over before each stop (PULL_IN m): cars parked after buildRoute (or past its check) were in the way and held it there
    for (const r of T.routes) for (const S of r.stops) { const lo = laneOff(S.w, 1);
      for (const c of world.parkedCars || []) { if (c.gone) continue; const px = c.x - S.x, pz = c.z - S.z, a = px * S.dx + pz * S.dz; if (a < -PULL_IN - 8 || a > 14) continue; const l = pz * S.dx - px * S.dz, hw = parkedSolid(c).hw;
        if (l > lo - reach - hw && l < lo + S.shift + reach + hw) { dropParked(c); n++; } } }
    console.log('[traffic] parked cars cleared off the bus routes', n); }
}
/** a parked car is gone for good: its instances hidden, its colliders sunk out of the world */
function dropParked(c) { hideParkedCar(c); c.gone = true; for (const b of [...carBoxes(c), ...(c.loose || [])]) { b.min.set(0, -9999, 0); b.max.set(0.001, -9998, 0.001); } }
const LANE_CLEAR = 0.8;   // m between a parked car's body and a traffic lane's centreline (a traffic car is ~0.9 m half-wide: they pass, mirrors close)
/** every parked car (kerbs, lots, the terminal) checked once the colliders and the lanes exist: one through a fence, a light pole, a
 *  wall, or sitting on a traffic lane is removed. The placers each check what they knew of; fences and courts built after them
 *  (realism.js, lunacourts.js) and lanes moved after them (stillwell.js) they couldn't. */
function clearParked(world) {
  const list = world.parkedCars || []; if (!list.length) return;
  // a car's own boxes: carBoxes, or (brighton.js, tavern.js) a car-sized box centred on it
  const ctr = new Map(), ck = (x, z) => Math.round(x) * 65536 + Math.round(z); for (const c of list) ctr.set(ck(c.x, c.z), c);
  const carOf = (b) => { if (b.max.y - b.min.y > 2.2 || b.max.x - b.min.x > 5.2 || b.max.z - b.min.z > 5.2) return null; const x = (b.min.x + b.max.x) / 2, z = (b.min.z + b.max.z) / 2;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = ctr.get(ck(x, z) + i * 65536 + j); if (c && Math.hypot(c.x - x, c.z - z) < 0.6) return c; } return null; };
  const own = new Set(list.flatMap(carBoxes)), grid = new BoxGrid(4);
  grid.build(world.ctx.colliders.filter((b) => { if (own.has(b) || b.max.x - b.min.x > 300 || b.max.z - b.min.z > 300) return false; const c = carOf(b); if (c && !c.boxes && !c.box) { (c.loose ||= []).push(b); return false; } return true; }));
  // lane centrelines sampled every metre, bucketed by 4 m cell
  const lane = new Map(), key = (x, z) => Math.floor(x / 4) * 65536 + Math.floor(z / 4), N = T.G.nodes;
  for (const A of N) for (const e of A.adj) { const B = N[e.to], L = Math.hypot(B.x - A.x, B.z - A.z), n = Math.ceil(L);
    for (const off of e.w >= 20 ? [laneOff(e.w, 0), laneOff(e.w, 1)] : [laneOff(e.w, 0)]) for (let i = 0; i <= n; i++) { const t = i / n, x = A.x + (B.x - A.x) * t - e.dz * off, z = A.z + (B.z - A.z) * t + e.dx * off, k = key(x, z); (lane.get(k) || lane.set(k, []).get(k)).push(x, z); } }
  const kept = []; let walls = 0, lanes = 0, cars = 0;
  for (const c of list) {
    if (c.gone) continue; const K = carSpec(c.kind) || carSpec('sedan'), hl = K.len / 2, hw = K.w / 2, y = c.y || 0, fx = Math.cos(c.ry || 0), fz = -Math.sin(c.ry || 0), rx = -fz, rz = fx;
    const ex = hl * Math.abs(fx) + hw * Math.abs(rx), ez = hl * Math.abs(fz) + hw * Math.abs(rz);
    // walls / fences / poles: separating axes between the car's rectangle (5 cm in) and each box
    let hit = false;
    for (const b of grid.query(c.x - ex, c.z - ez, c.x + ex, c.z + ez)) {
      if (b.max.y <= y + 0.3 || b.min.y >= y + 1.3) continue;
      const bx = (b.min.x + b.max.x) / 2 - c.x, bz = (b.min.z + b.max.z) / 2 - c.z, hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2;
      if (Math.abs(bx) >= ex - 0.05 + hx || Math.abs(bz) >= ez - 0.05 + hz) continue;
      if (Math.abs(bx * fx + bz * fz) >= hl - 0.05 + hx * Math.abs(fx) + hz * Math.abs(fz)) continue;
      if (Math.abs(bx * rx + bz * rz) >= hw - 0.05 + hx * Math.abs(rx) + hz * Math.abs(rz)) continue;
      hit = true; break;
    }
    if (hit) { walls++; dropParked(c); continue; }
    // on a lane: any lane sample inside the body grown by LANE_CLEAR
    const g0x = Math.floor((c.x - ex - LANE_CLEAR) / 4), g1x = Math.floor((c.x + ex + LANE_CLEAR) / 4), g0z = Math.floor((c.z - ez - LANE_CLEAR) / 4), g1z = Math.floor((c.z + ez + LANE_CLEAR) / 4);
    for (let ix = g0x; ix <= g1x && !hit; ix++) for (let iz = g0z; iz <= g1z && !hit; iz++) { const P = lane.get(ix * 65536 + iz); if (!P) continue;
      for (let i = 0; i < P.length; i += 2) { const dx = P[i] - c.x, dz = P[i + 1] - c.z; if (Math.abs(dx * fx + dz * fz) < hl + LANE_CLEAR && Math.abs(dx * rx + dz * rz) < hw + LANE_CLEAR) { hit = true; break; } } }
    if (hit) { lanes++; dropParked(c); continue; }
    // two parked cars in one spot (two placers, one kerb)
    if (kept.some((o) => { const dx = o.x - c.x, dz = o.z - c.z; if (Math.abs(Math.cos((o.ry || 0) - (c.ry || 0))) < 0.7) return Math.hypot(dx, dz) < 2.6; return Math.abs(dx * fx + dz * fz) < hl * 2 - 0.2 && Math.abs(dx * rx + dz * rz) < hw * 2 - 0.1; })) { cars++; dropParked(c); continue; }
    kept.push(c);
  }
  console.log('[traffic] parked cars removed: in a wall / fence / pole', walls, '· on a lane', lanes, '· on another car', cars, '· kept', kept.length);
}
/** signal state for an approach from `from` into signalised node n: 'G' | 'Y' | 'R' */
function signalFor(n, from, now = Date.now()) {
  const t = ((now / 1000 + n.sig.off) % CYC + CYC) % CYC, g = n.sig.grp.get(from) ?? 0;
  if (g === 0) return t < 14 ? 'G' : t < 17 ? 'Y' : 'R';
  return t >= 18 && t < 30 ? 'G' : t >= 30 && t < 33 ? 'Y' : 'R';
}
function edge(a, b) { const n = T.G.nodes[a]; if (!n) return null; for (const e of n.adj) if (e.to === b) return e; return null; }
/** lane point at node b for the path a→b→c (either end may be -1): the intersection of the two offset lane lines */
function lanePoint(a, b, c, lane, out) {
  const N = T.G.nodes, B = N[b]; let e1 = a >= 0 ? edge(a, b) : null, e2 = c >= 0 ? edge(b, c) : null;
  let d1x, d1z, w1, d2x, d2z, w2;
  if (e1) { d1x = e1.dx; d1z = e1.dz; w1 = e1.w; }
  if (e2) { d2x = e2.dx; d2z = e2.dz; w2 = e2.w; }
  if (!e1) { d1x = d2x; d1z = d2z; w1 = w2; } if (!e2) { d2x = d1x; d2z = d1z; w2 = w1; }
  const o1 = laneOff(w1, lane), o2 = laneOff(w2, lane);
  const p1x = B.x - d1z * o1, p1z = B.z + d1x * o1, p2x = B.x - d2z * o2, p2z = B.z + d2x * o2;
  const cr = d1x * d2z - d1z * d2x;
  if (Math.abs(cr) < 0.06) { out.x = (p1x + p2x) / 2; out.z = (p1z + p2z) / 2; return out; }
  const ex = p2x - p1x, ez = p2z - p1z, t = (ex * d2z - ez * d2x) / cr;
  out.x = p1x + d1x * t; out.z = p1z + d1z * t;
  const lim = Math.max(o1, o2) * 2.2 + 1.5, dx = out.x - B.x, dz = out.z - B.z, d = Math.hypot(dx, dz);
  if (d > lim) { out.x = B.x + dx / d * lim; out.z = B.z + dz / d * lim; }
  return out;
}

// =========================================================================================================================
// path following: the car rides segment q1→q2; P0/P1/P2 = lane points at q1/q2/q3; corners are Beziers of radius rin/rout
const _lp = { x: 0, z: 0 };
function choose(c, a, b) {
  const n = T.G.nodes[b]; let tot = 0; const ea = edge(a, b); if (!ea) return -1;
  for (const e of n.adj) { if (e.to === a) continue; const st = e.dx * ea.dx + e.dz * ea.dz; e._w = e.w * (0.25 + Math.max(0, st) * 1.6) * (st < -0.2 ? 0.2 : 1); tot += e._w; }
  if (tot <= 0) return -1;
  let r = c.rng() * tot; for (const e of n.adj) { if (e.to === a) continue; r -= e._w; if (r <= 0) return e.to; }
  return -1;
}
function computeOut(c) {
  const q = c.q;
  if (q[3] < 0) { c.P2x = c.P1x + c.dx * 5; c.P2z = c.P1z + c.dz * 5; c.dOx = c.dx; c.dOz = c.dz; c.LOut = 0; c.rout = 0; return; }
  lanePoint(q[2], q[3], q[4], c.lane, _lp); c.P2x = _lp.x; c.P2z = _lp.z;
  let dx = c.P2x - c.P1x, dz = c.P2z - c.P1z; const L = Math.hypot(dx, dz) || 1e-3; c.dOx = dx / L; c.dOz = dz / L; c.LOut = L;
  const ang = Math.acos(clamp(c.dx * c.dOx + c.dz * c.dOz, -1, 1));
  c.rout = ang < 0.03 ? 0 : Math.min(RM, c.L * 0.45, L * 0.45); c.turnAng = ang; c.turnSide = (c.dx * c.dOz - c.dz * c.dOx) > 0 ? 1 : -1;
}
function startOn(c, a, b, s) {
  const q = c.q; q[0] = -1; q[1] = a; q[2] = b;
  if (c.route) { const N = c.route.nodes, n = N.length, i = c.rq1; q[3] = N[(i + 2) % n]; q[4] = N[(i + 3) % n]; c.ri = (i + 3) % n; }
  else { q[3] = choose(c, a, b); q[4] = q[3] >= 0 ? choose(c, b, q[3]) : -1; }
  lanePoint(-1, a, b, c.lane, _lp); c.P0x = _lp.x; c.P0z = _lp.z;
  lanePoint(a, b, q[3], c.lane, _lp); c.P1x = _lp.x; c.P1z = _lp.z;
  let dx = c.P1x - c.P0x, dz = c.P1z - c.P0z; const L = Math.hypot(dx, dz) || 1e-3; c.dx = dx / L; c.dz = dz / L; c.L = L; c.rin = 0; c.dIx = c.dx; c.dIz = c.dz;
  computeOut(c); c.s = Math.min(s, Math.max(0, L - c.rout - 0.5)); c.w = edge(a, b).w; c.cleared = -1; c.stopT = 0;
}
/** move onto the next segment; false at a dead end */
function advance(c) {
  const q = c.q; if (q[3] < 0) return false;
  c.s -= c.L; c.rin = c.rout; c.dIx = c.dx; c.dIz = c.dz;
  c.P0x = c.P1x; c.P0z = c.P1z; c.P1x = c.P2x; c.P1z = c.P2z; c.dx = c.dOx; c.dz = c.dOz; c.L = c.LOut;
  q[0] = q[1]; q[1] = q[2]; q[2] = q[3]; q[3] = q[4]; q[4] = q[3] >= 0 ? (c.route ? c.route.next(c) : choose(c, q[2], q[3])) : -1;
  computeOut(c); c.w = edge(q[1], q[2])?.w || c.w; c.stopT = 0; c.cleared = -1;
  if (c.route) c.rq1 = (c.rq1 + 1) % c.route.nodes.length;
  return true;
}
function evalAt(c, s, out) {
  const L = c.L;
  if (c.rin > 0 && s < c.rin) { const r = c.rin; return bez(c.P0x - c.dIx * r, c.P0z - c.dIz * r, c.P0x, c.P0z, c.P0x + c.dx * r, c.P0z + c.dz * r, 0.5 + 0.5 * s / r, out); }
  if (c.rout > 0 && s > L - c.rout) { const r = c.rout; return bez(c.P1x - c.dx * r, c.P1z - c.dz * r, c.P1x, c.P1z, c.P1x + c.dOx * r, c.P1z + c.dOz * r, 0.5 * (s - (L - r)) / r, out); }
  out.x = c.P0x + c.dx * s; out.z = c.P0z + c.dz * s; out.dx = c.dx; out.dz = c.dz; return out;
}
function bez(ax, az, bx, bz, cx, cz, t, out) {
  t = clamp(t, 0, 1); const u = 1 - t; out.x = u * u * ax + 2 * u * t * bx + t * t * cx; out.z = u * u * az + 2 * u * t * bz + t * t * cz;
  let dx = 2 * u * (bx - ax) + 2 * t * (cx - bx), dz = 2 * u * (bz - az) + 2 * t * (cz - bz); const l = Math.hypot(dx, dz) || 1; out.dx = dx / l; out.dz = dz / l; return out;
}
function idm(v, v0, gap, dv, a = A_MAX) {
  const ss = S0 + Math.max(0, v * T_HEAD + v * dv / (2 * Math.sqrt(a * B_COMF))), g = Math.max(gap, 0.05);
  return a * (1 - Math.pow(v / Math.max(v0, 0.3), 4) - (ss / g) * (ss / g));
}

// =========================================================================================================================
// render: instanced kinds
function kindRender(kind, cap) {
  const lite = T.lite, CM = carMaterials(), K = carSpec(kind), out = { kind, ims: [], paint: null, cap, used: 0 };
  const scene = T.world.scene;
  const G = carGeometries(kind, { wheels: false }).geos;
  if (cap > 0) {
  const mats = { paint: CM.paint, glass: lite ? CM.glass : (CM.glassSee || CM.glass), trim: CM.trim, lampW: CM.lampW, lampR: CM.lampR, plate: CM.plate, shadow: CM.shadow };
  for (const slot of Object.keys(mats)) {
    if (!G[slot]) continue;
    const im = new THREE.InstancedMesh(G[slot], mats[slot], cap); im.name = `traffic:${kind}:${slot}`; im.frustumCulled = false;
    im.castShadow = slot === 'paint' && !lite; im.receiveShadow = slot !== 'shadow'; im.userData.surface = 'metal';
    for (let i = 0; i < cap; i++) im.setMatrixAt(i, ZERO);
    if (slot === 'paint') { for (let i = 0; i < cap; i++) im.setColorAt(i, CAR_COLORS[0]); out.paint = im; }
    if (slot === 'shadow') im.renderOrder = 1;
    scene.add(im); out.ims.push(im);
  }
  }
  if (!lite && cap > 0) {   // the cabin seen through the tinted glass: the body shell from inside + dash / seats / wheel merged into one dark mesh
    const cab = carInterior(kind, G); cab.group.updateMatrixWorld(true); const geos = [];
    cab.group.traverse((o) => { if (!o.isMesh || o.material.side === THREE.BackSide || o.material.transparent) return; let g = o.geometry.clone().applyMatrix4(o.matrixWorld); g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); geos.push(g); });
    const shell = new THREE.InstancedMesh(G.paint, T.shellMat, cap), inside = new THREE.InstancedMesh(mergeGeometries(geos, false), T.cabMat, cap);
    for (const im of [shell, inside]) { im.frustumCulled = false; im.name = `traffic:${kind}:cabin`; for (let i = 0; i < cap; i++) im.setMatrixAt(i, ZERO); scene.add(im); out.ims.push(im); }
  }
  const lay = wheelLayout(kind), HW = K.w / 2, xf = K.len / 2, xr = -K.len / 2;
  out.wheels = lay.wheels; out.wr = lay.r; out.wb = K.wheels[0] - K.wheels[1];
  out.lamps = { tail: [xr - 0.02, K.trunk - 0.12, HW * 0.9 - 0.27], head: [xf + 0.02, K.hood - 0.13, HW * 0.9 - 0.3] };
  out.eye = carEye(kind); out.hl = K.len / 2; out.hw = K.w / 2; out.roof = K.roof; out.belt = K.belt;
  return out;
}
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function silhouetteGeos() {
  const body = [], head = [];
  const add = (arr, g, x, y, z, rz = 0) => { g.rotateZ(rz); g.translate(x, y, z); arr.push(g.index ? g.toNonIndexed() : g); };
  // origin = the centre of the head; kit frame (+x = forward)
  add(head, new THREE.SphereGeometry(0.105, 10, 8), 0, 0, 0);
  add(body, new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8), -0.01, -0.15, 0);
  add(body, new THREE.BoxGeometry(0.26, 0.56, 0.42), -0.06, -0.49, 0, 0.08);
  for (const sz of [-1, 1]) { const a = new THREE.BoxGeometry(0.42, 0.09, 0.09); add(body, a, 0.13, -0.42, sz * 0.2, -0.45); }
  const m = (arr) => { const g = mergeGeometries(arr.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }), false); return g; };
  return { body: m(body), head: m(head) };
}
const SHIRTS = [0x2b2f36, 0x6d7a8a, 0xe8e4da, 0x1f3f6b, 0x7a1e1e, 0x3f5a3a, 0xc9b28f, 0x141414, 0x5a3d6b, 0xd8c24a].map((c) => new THREE.Color(c));
const SKINS = [0xe6c3a2, 0xd9a882, 0xb07a55, 0x8a5a3c, 0x5e3b27].map((c) => new THREE.Color(c));

// =========================================================================================================================
export function buildTraffic(world) {
  const { ctx, W } = world;
  const want = ctx.qs?.get?.('traffic'); if (want === '0') return null;
  const lite = !!ctx.lite, budget = want ? Math.max(1, Math.min(60, +want | 0)) : ctx.safeMode ? 5 : lite ? 10 : 24;
  T = { world, ctx, W, lite, budget, ring: lite ? 150 : 250, cars: [], kinds: {}, t: 0, frame: 0, spawnN: 0, spawnCool: 0, people: [], peopleT: 0, spot: null, jackable: null, stats: { jacked: 0, crashes: 0, honks: 0 }, obs: [], fz: false };
  T.G = buildGraph(world); if (!T.G.segs.length) { console.warn('[traffic] no roads'); return null; }
  // the signalised junctions for the street kit (coney/street.js draws the heads, folk.js crosses on the WALK): where they are, the
  // streets into them, and the phase for traffic heading (hx, hz) into one, on the same wall clock the cars obey
  W.junctions = T.G.nodes.filter((n) => n.adj.length >= 3).map((n) => ({ x: n.x, z: n.z, ctrl: n.ctrl, maxW: n.maxW, ways: n.adj.map((e) => ({ dx: e.dx, dz: e.dz, w: e.w })) }));   // stop signs + name blades (coney/street.js)
  W.signals = { list: T.G.nodes.filter((n) => n.sig).map((n) => ({ x: n.x, z: n.z, ways: n.adj.map((e) => ({ dx: e.dx, dz: e.dz, w: e.w })), n })),
    state: (j, hx, hz, now = Date.now()) => { const n = j.n, t = ((now / 1000 + n.sig.off) % CYC + CYC) % CYC, g = Math.abs(hx * n.sig.ax + hz * n.sig.az) > 0.7 ? 0 : 1;
      return g === 0 ? (t < 14 ? 'G' : t < 17 ? 'Y' : 'R') : (t >= 18 && t < 30 ? 'G' : t >= 30 && t < 33 ? 'Y' : 'R'); } };
  T.shellMat = new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.9, side: THREE.BackSide }); T.shellMat.name = 'traffic_shell';
  T.cabMat = new THREE.MeshStandardMaterial({ color: 0x232221, roughness: 0.75 }); T.cabMat.name = 'traffic_cabin';
  // the fleet: fixed kinds per pool slot (each slot = one instance in its kind's meshes)
  // E34s: 2 in the phone's 10 (it takes the hatch's place: same kind count, same draw calls), 4 in the desktop's 24
  const mix = lite ? ['sedan', 'suv', 'cab', 'sedan', 'e34', 'suv', 'van', 'sedan', 'cab', 'e34'] : ['sedan', 'suv', 'cab', 'e34', 'hatch', 'suv', 'van', 'e34', 'cab', 'muscle', 'sedan', 'suv', 'hatch', 'e34', 'sedan', 'coupe', 'suv', 'van', 'sedan', 'hatch', 'e34', 'muscle', 'suv', 'sedan'];
  const kinds = []; for (let i = 0; i < budget; i++) kinds.push(mix[i % mix.length]);
  const count = {}; for (const k of kinds) count[k] = (count[k] || 0) + 1;
  const model = !lite && hasCarModel('coupe');
  for (const [k, n] of Object.entries(count)) if (!(k === 'coupe' && model)) T.kinds[k] = kindRender(k, n);
  if (model && count.coupe) T.kinds.coupe = Object.assign(kindRender('coupe', 0), { model: true });
  // wheels (4 per car), lamp glows (6 per car), driver silhouettes (1 per car)
  const CM = carMaterials(), wg = wheelGeometry(0.33), cap4 = budget * 4;
  T.wheels = ['rubber', 'rim', 'trim'].map((slot) => { const im = new THREE.InstancedMesh(wg[slot], CM[slot], cap4); im.name = 'traffic:wheels:' + slot; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true; for (let i = 0; i < cap4; i++) im.setMatrixAt(i, ZERO); world.scene.add(im); return im; });
  const gm = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }); gm.name = 'traffic_glow';
  const gg = new THREE.PlaneGeometry(1, 1); gg.rotateY(Math.PI / 2);
  T.glow = new THREE.InstancedMesh(gg, gm, budget * 6); T.glow.name = 'traffic:glow'; T.glow.frustumCulled = false; T.glow.renderOrder = 3;
  for (let i = 0; i < budget * 6; i++) { T.glow.setMatrixAt(i, ZERO); T.glow.setColorAt(i, new THREE.Color(1, 0, 0)); } world.scene.add(T.glow);
  const sg = silhouetteGeos(), sm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }); sm.name = 'traffic_driver';
  T.silB = new THREE.InstancedMesh(sg.body, sm, budget); T.silH = new THREE.InstancedMesh(sg.head, sm, budget);
  for (const im of [T.silB, T.silH]) { im.name = 'traffic:drivers'; im.frustumCulled = false; for (let i = 0; i < budget; i++) { im.setMatrixAt(i, ZERO); im.setColorAt(i, SHIRTS[0]); } world.scene.add(im); }
  // raycast proxies: the lower body (bullets spark off the metal) + the driver (weapons' onHit: shoot the driver)
  const hbm = new THREE.MeshBasicMaterial({ visible: false });
  const used = {};
  for (let i = 0; i < budget; i++) {
    const kind = kinds[i], R = T.kinds[kind], slot = (used[kind] = (used[kind] ?? -1) + 1);
    const c = { id: i, kind, R, slot, active: false, q: new Int32Array(5), rng: mulberry(i + 1), lane: 0, s: 0, v: 0, a: 0, x: 0, y: 0, z: 0, h: 0, hPrev: 0, yawRate: 0, spin: 0, shift: 0, shiftT: 0, ox: 0, oz: 0, oyaw: 0,
      state: 'drive', stateT: 0, driver: true, real: null, color: new THREE.Color(), shirt: 0, skin: 0, hornT: 0, blockT: 0, waitT: 0, avoid: null, panic: 0, brake: 0, pitch: 0, roll: 0, hl: R.hl, hw: R.hw, seed: 0, far: false, acc: 0 };
    const body = new THREE.Mesh(new THREE.BoxGeometry(R.hl * 2 - 0.1, R.belt - 0.25, R.hw * 2 - 0.1), hbm); body.userData = { surface: 'metal', traffic: c, noLOS: true };
    const drv = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.5), hbm); drv.userData = { traffic: c, onHit: (dmg, head, point) => shootDriver(c, dmg, point) };
    world.scene.add(body); world.scene.add(drv); ctx.raycastTargets.push(body, drv); c.hbBody = body; c.hbDrv = drv;
    if (kind === 'coupe' && R.model) { const g = new THREE.Group(); g.matrixAutoUpdate = false; const mdl = carModel('coupe', 0xb3120f); if (mdl) g.add(mdl); g.visible = false; world.scene.add(g); c.model = g; c.modelPaint = null; mdl?.traverse((o) => { if (o.isMesh && o.name === 'body') c.modelPaint = o.material; }); }
    T.cars.push(c);
  }
  // Rocketbox drivers for the nearest cars (desktop): a small pool, seated, reassigned as you move
  if (!lite && peopleReady()) {
    for (let i = 0; i < 8; i++) {
      try { const f = buildPerson({ seed: 101 + i * 37, pose: 'sit', female: i % 3 === 2 }); f.update(0.016); f.group.updateMatrixWorld(true);
        const hp = f.head.getWorldPosition(new THREE.Vector3()); f.group.visible = false; f.group.matrixAutoUpdate = false; f.group.userData.sit = true; world.scene.add(f.group);
        T.people.push({ f, car: null, hx: hp.x, hy: hp.y, hz: hp.z }); } catch (e) { console.warn('[traffic] driver', e?.message || e); break; }
    }
  }
  // F at a driver's door: carjack (hangkit decides between this and every other F prompt nearby)
  T.spotPos = new THREE.Vector3(0, -999, 0);
  try { HK.spot({ pos: T.spotPos, r: 1.9, dy: 1.6, when: () => !!T.jackable, prompt: () => (T.jackable?.driver && T.jackable.state !== 'dead' ? 'F — CARJACK' : 'F — DRIVE'), act: () => { if (T.jackable) jack(T.jackable); } }); } catch (e) { console.warn('[traffic] spot', e?.message || e); }
  try { buildBuses(world); } catch (e) { console.warn('[traffic] buses', e); }
  world.updaters.push((dt) => { try { update(dt); } catch (e) { if ((T.errN = (T.errN || 0) + 1) < 4) console.error('[traffic]', e); } });
  solidSource('traffic', () => T.cars.filter((c) => c.active));
  solidSource('player', playerSolids);
  if (typeof window !== 'undefined' && window.__game) window.__game.traffic = trafficQA;
  W.traffic = { cars: () => T.cars.filter((c) => c.active), graph: () => T.G, recycle: (c) => { if (T.cars.includes(c) && c.active && !c.bus) despawn(c); } };   // graph: the validated lanes (coney/uber.js routes on them)
  return T;
}

// =========================================================================================================================
// spawning
function inView(x, y, z, r = 3) { _sph.center.set(x, y + 1, z); _sph.radius = r; return _fr.intersectsSphere(_sph); }
function spawn(c, boot) {
  const P = T.ctx.player?.position; if (!P) return false; const G = T.G, ring = T.ring;
  const rng = mulberry(hash(Math.floor(Date.now() / 20000), ++T.spawnN * 7919 + c.id));
  for (let k = 0; k < 24; k++) {
    let r = rng() * G.total, seg = G.segs[0]; for (const sg of G.segs) { r -= sg.wt; if (r <= 0) { seg = sg; break; } }
    const s = rng() * seg.len, A = G.nodes[seg.a], B = G.nodes[seg.b], x = A.x + (B.x - A.x) * s / seg.len, z = A.z + (B.z - A.z) * s / seg.len;
    const d = Math.hypot(x - P.x, z - P.z);
    if (d > ring - 10 || d < (boot ? 14 : 55)) continue;
    if (!boot && d < 100 && inView(x, 0, z, 4)) continue;
    if (!boot && k < 12 && !(d < 200 && inView(x, 0, z, 4))) continue;   // first try for one you'll see, 100-200 m up the road
    if (d > 60 && rng() < (d - 60) / ring * 0.8) continue;   // denser near you
    if (T.cars.some((o) => o.active && Math.hypot(o.x - x, o.z - z) < 13)) continue;
    c.rng = rng; c.lane = seg.w >= 20 && rng() < 0.45 ? 1 : 0;
    startOn(c, seg.a, seg.b, s);
    evalAt(c, c.s, _o); c.x = _o.x; c.z = _o.z; c.h = Math.atan2(-_o.dx, -_o.dz); c.hPrev = c.h; c.y = T.W.groundHeight?.(c.x, c.z) ?? 0;
    if (solidsNear(c.x, c.z, 8).some((o) => obbOverlap(c.x, c.z, c.h, c.hl + 1.5, c.hw, o))) continue;   // clear of every vehicle (cops, the Uber, you, parked)
    c.v = Math.min(roadSpeed(seg.w) * 0.7, 7); c.state = 'drive'; c.stateT = 0; c.driver = true; c.shift = 0; c.shiftT = 0; c.ox = c.oz = c.oyaw = 0; c.avoid = null; c.panic = 0; c.hornT = 0; c.blockT = 0; c.waitT = 0; c.jamT = 0; c.brake = 0;
    c.pers = 0.85 + rng() * 0.3; c.seed = (rng() * 1e6) | 0;
    c.color.copy(c.kind === 'cab' ? new THREE.Color(rng() < 0.4 ? 0x8cd04a : 0xf2b820) : CAR_COLORS[(rng() * CAR_COLORS.length) | 0]);   // cabs: yellow, or an apple-green boro taxi
    if (c.R.paint) { c.R.paint.setColorAt(c.slot, c.color); c.R.paint.instanceColor.needsUpdate = true; }
    if (c.model) { c.model.visible = true; c.color.setHex([0xb3120f, 0xe8b400, 0xf2f2f0, 0x111214, 0x1f4fb8][(rng() * 5) | 0]); if (c.modelPaint) c.modelPaint.color.copy(c.color); }
    c.shirt = (rng() * SHIRTS.length) | 0; c.skin = (rng() * SKINS.length) | 0;
    T.silB.setColorAt(c.id, SHIRTS[c.shirt]); T.silH.setColorAt(c.id, SKINS[c.skin]); T.silB.instanceColor.needsUpdate = T.silH.instanceColor.needsUpdate = true;
    c.active = true; c.far = false; c.acc = 0;
    return true;
  }
  return false;
}
function despawn(c) {
  c.active = false; releaseDriver(c);
  const R = c.R; if (R.ims) for (const im of R.ims) { im.setMatrixAt(c.slot, ZERO); im.instanceMatrix.needsUpdate = true; }
  if (c.model) c.model.visible = false;
  for (let k = 0; k < 4; k++) for (const im of T.wheels) im.setMatrixAt(c.id * 4 + k, ZERO);
  for (let k = 0; k < 6; k++) T.glow.setMatrixAt(c.id * 6 + k, ZERO);
  T.silB.setMatrixAt(c.id, ZERO); T.silH.setMatrixAt(c.id, ZERO);
  c.hbBody.position.set(0, -500, 0); c.hbDrv.position.set(0, -500, 0); c.hbBody.updateMatrixWorld(); c.hbDrv.updateMatrixWorld();
  if (T.jackable === c) T.jackable = null;
}

// =========================================================================================================================
// per-frame
function update(dt) {
  const ctx = T.ctx, cam = ctx.camera, P = ctx.player?.position; if (!P || !cam) return;
  T.t += dt; T.frame++;
  if (!T.parkedSolid) { T.parkedSolid = true;   // the first frame: every placer (street.js parks Surf Ave after this module) is done
    try { clearParked(T.world); clearBusRoutes(T.world); } catch (e) { console.warn('[traffic] parked check', e); }
    staticSolids((T.world.parkedCars || []).filter((c) => !c.gone).map(parkedSolid)); }
  cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
  gatherObstacles();
  const now = Date.now();
  if (dt > 0 && !T.fz) for (const c of T.cars) {
    if (!c.active) { if (c.bus && Math.hypot(c.x - P.x, c.z - P.z) > 150 && !inView(c.x, c.y, c.z, 8)) placeBus(c, true); continue; }
    const d = Math.hypot(c.x - P.x, c.z - P.z);
    if (c.bus) { if (c.state !== 'drive' && c.state !== 'dwell' && c !== T.ride?.c && d > 150 && !inView(c.x, c.y, c.z, 8)) placeBus(c, true); }
    else if (d > T.ring + 30 || ((c.state === 'abandoned' || c.state === 'end') && d > 60 && !inView(c.x, c.y, c.z, 4))) { despawn(c); continue; }
    // far and unseen: think at a quarter rate
    c.far = d > 150 && !inView(c.x, c.y, c.z, 4); c.acc += dt;
    if (c.far && (T.frame + c.id) % 4) continue;
    const h = c.acc; c.acc = 0;
    drive(c, h, now);
  }
  // refill the ring: two spawns a frame at most (one a frame once running), none while the ring is dry for a second
  T.spawnCool -= dt;
  const allowed = Math.round(T.budget * (1 - 0.33 * (T.W.night ?? 0))), activeN = T.cars.reduce((a, c) => a + (c.active && !c.bus ? 1 : 0), 0);   // fewer cars out at night (24 → 16)
  if (T.spawnCool <= 0 && !T.fz && activeN < allowed) { const boot = T.t < 1.5; let n = boot ? T.budget : 1, fails = 0;
    for (const c of T.cars) { if (n <= 0) break; if (c.active || c.bus) continue; if (spawn(c, boot)) n--; else if (++fails > 2) { T.spawnCool = 1; break; } } }
  collidePlayer(dt); busSeparate();
  render(dt);
  busPeople();
  drivers(dt);
  interact();
  riding(dt);
}
/** everyone traffic has to respect besides itself: you (on foot / in a vehicle), friends, parked player vehicles */
function gatherObstacles() {
  const O = T.obs; O.length = 0; const ctx = T.ctx, p = ctx.player;
  const mv = ctx.vehicles?.mounted;
  if (p && !p.dead) {
    if (mv) { const sp = mv.spec || {}; O.push({ x: mv.pos.x, z: mv.pos.z, vx: mv.vel?.x || 0, vz: mv.vel?.z || 0, hl: sp.hz || 1, hw: sp.hx || 0.5, me: true, veh: mv }); }
    else if (!p.mounted?.bus) O.push({ x: p.position.x, z: p.position.z, vx: p.velocity?.x || 0, vz: p.velocity?.z || 0, hl: 0.35, hw: 0.35, me: true, foot: true });
  }
  for (const v of ctx.vehicles?.list || []) { if (v === mv || !v.parked || !v.spec?.car) continue; if (Math.abs(v.pos.x - p.position.x) > 120 || Math.abs(v.pos.z - p.position.z) > 120) continue; O.push({ x: v.pos.x, z: v.pos.z, vx: 0, vz: 0, hl: v.spec.hz, hw: v.spec.hx, veh: v }); }
  for (const q of T.W.folkObstacles?.() || []) if (Math.abs(q.x - p.position.x) < 120 && Math.abs(q.z - p.position.z) < 120 && roadDist(q.x, q.z) < -0.3) O.push({ x: q.x, z: q.z, vx: 0, vz: 0, hl: 0.35, hw: 0.35, foot: true, ped: true });   // people in the road (crossing on the WALK, diving clear …)
  const net = ctx.net; if (net?.list && net.peer) { try { for (const id of net.list()) { const q = net.peer(id); if (!q?.pos || q.dead) continue; O.push({ x: q.pos.x, z: q.pos.z, vx: 0, vz: 0, hl: q.veh ? 2.3 : 0.35, hw: q.veh ? 1 : 0.35, peer: id }); } } catch {} }
  for (const o of solidsNear(p.position.x, p.position.z, 120)) if (o.ext) O.push({ x: o.x, z: o.z, vx: -Math.sin(o.h) * o.v, vz: -Math.cos(o.h) * o.v, hl: o.hl, hw: o.hw, veh: o });   // cops, the Uber
}
function drive(c, dt, now) {
  if (dt <= 0) return;
  c.stateT += dt; c.hornT -= dt;
  // ---- states that don't drive
  if (c.state === 'crashed') {
    c.v = Math.max(0, c.v - 7 * dt);
    if (c.stateT > 1.6 && !c.angryDone) { c.angryDone = true; if (c.driver && !c.bus && c.sev > 0.35 && c.rng() < 0.65) { pullOut(c, true); c.state = 'abandoned'; } else honk(c, 1.2); }
    if (c.state === 'crashed' && c.stateT > 4.5) { c.state = 'drive'; c.stateT = 0; }
    pose(c, dt); return;
  }
  if (c.state === 'abandoned' || c.state === 'dead' || c.state === 'end') { c.v = Math.max(0, c.v - (c.state === 'dead' ? 2.5 : 6) * dt); solidStep(c, dt); c.s += c.v * dt; if (c.s > c.L - 0.5 && !advance(c)) c.s = Math.min(c.s, c.L); pose(c, dt); return; }
  // ---- target speed: street, curve ahead, junction control, whoever is in front
  if (c.hold) { c.v = Math.max(0, c.v - 8 * dt); c.brake = 1; pose(c, dt); return; }
  if (c.state === 'dwell') { c.v = 0; c.dwellT -= dt; c.doorT = c.dwellT > 1.2 ? 1 : 0; if (c.dwellT <= 0) { c.state = 'drive'; c.stateT = 0; c.served = c.stopI; } pose(c, dt); return; }
  evalAt(c, c.s, _o); const hx = _o.dx, hz = _o.dz;
  let v0 = roadSpeed(c.w) * c.pers * (c.panic > 0 ? 1.35 : 1) * (c.bus ? busPace(c, now) : 1);
  const AM = c.amax || A_MAX;
  if (c.rout > 0 && c.turnAng > 0.08) { const R = c.rout / Math.tan(c.turnAng / 2), vc = Math.sqrt(3.0 * Math.max(R, 1.5)), dist = Math.max(0, c.L - c.rout - c.s); v0 = Math.min(v0, Math.sqrt(vc * vc + 2 * 2.2 * dist)); }
  let a = AM * (1 - Math.pow(c.v / Math.max(v0, 0.3), 4)), lim = null;
  if (c.bus) { const r = busStop(c); if (r) { const ai = idm(c.v, v0, r.d, c.v, AM); if (ai < a) { a = ai; lim = 'stop'; } } }
  // junction ahead (q2), or the one after when this segment is short
  const q = c.q, stopLine = Math.max(0.3, c.L - c.rout - 1.2);
  const jn = T.G.nodes[q[2]];
  if (q[3] < 0) { const ai = idm(c.v, v0, c.L - 3 - c.s, c.v, AM); if (ai < a) a = ai; if (c.s > c.L - 4 && c.v < 0.2) { c.state = 'end'; c.stateT = 0; } }
  else if (jn?.ctrl && c.cleared !== q[2] && c.panic <= 0) {
    const d = stopLine - c.s;
    if (d < -0.5) c.cleared = q[2];
    else if (jn.ctrl === 'signal') {
      const st = signalFor(jn, q[1], now);
      const boxed = st === 'G' && ((d < 3 && c.v < 1 && boxJammed(c, q[2])) || (d > 0 && d < 12 && exitFull(c)));   // don't block the box: green, but a stopped car is still in the junction, or no room past it
      if (boxed && c.v < 1) { c.boxT = (c.boxT || 0) + dt; }
      if ((st === 'G' || (st === 'Y' && c.v * c.v / (2 * 3.5) > d)) && (!boxed || c.boxT > 5)) { if (d < 1) { c.cleared = q[2]; c.boxT = 0; } }
      else if (boxed) { const ai = idm(c.v, v0, Math.max(0.05, d), c.v, AM); if (ai < a) { a = ai; lim = 'box'; } }
      else { const ai = idm(c.v, v0, d, c.v, AM); if (ai < a) { a = ai; lim = 'signal'; } }
    } else {
      const minor = c.w < jn.maxW || jn.adj.every((e) => e.w === jn.maxW);
      if (!minor) c.cleared = q[2];
      else {
        if (d < (c.bus ? 6 : 4) && c.v < 0.4) c.stopT += dt;   // stopped at (or a car length short of) the line: a bus stops further back; IDM's standstill gap used to park cars 2 m short and they waited for ever
        if (c.stopT > 0.9 && (junctionClear(c, q[2]) || c.stopT > 6)) c.cleared = q[2];   // six seconds at a stop sign: take your turn
        else { const ai = idm(c.v, v0, Math.max(0.05, d), c.v, AM); if (ai < a) { a = ai; lim = 'stop'; } }
      }
    }
  }
  // leader: another car / bus / you / a friend / a parked player car, in my lane ahead
  const rx = -hz, rz = hx; let best = null, bg = 60, bdv = 0;
  for (const o of T.cars) {
    if (o === c || !o.active) continue; const dx = o.x - c.x, dz = o.z - c.z; if (dx * dx + dz * dz > 3600) continue;
    const f = dx * hx + dz * hz; if (f <= 0) continue; const l = dx * rx + dz * rz - c.shift;
    const ohx = -Math.sin(o.h), ohz = -Math.cos(o.h), al = ohx * hx + ohz * hz;
    if (al < -0.3 && f > 7) continue;   // oncoming, not a threat
    if (Math.abs(l) > c.hw + (al > 0.7 ? o.hw : o.hl) + 0.25) continue;
    if (o.leader === c && c.id < o.id && o.v < 1) continue;   // two stopped at a corner each waiting on the other: the lower id goes
    const gap = f - c.hl - (al > 0.7 ? o.hl : o.hw); if (gap < bg) { bg = gap; best = o; bdv = c.v - o.v * Math.max(0, al); }
  }
  c.leader = best;
  let obst = null;
  for (const o of T.obs) {
    const dx = o.x - c.x, dz = o.z - c.z; if (dx * dx + dz * dz > 3600) continue; const f = dx * hx + dz * hz; if (f <= 0) continue;
    const l = dx * rx + dz * rz - c.shift; if (Math.abs(l) > c.hw + Math.max(o.hw, 0.35) + 0.35 + (o.foot ? 0.3 : 0)) continue;
    const gap = f - c.hl - (o.foot ? o.hl : Math.max(o.hl, o.hw) * 0.8); if (gap < bg) { bg = gap; best = null; obst = o; bdv = c.v - Math.max(0, o.vx * hx + o.vz * hz); }
  }
  c.obst = obst;
  if (best || obst) { const ai = idm(c.v, v0, bg, bdv, AM); if (ai < a) { a = ai; lim = obst ? 'obst' : 'car'; } }
  // blocked by you: honk, yell, then go around
  const blockedByMe = lim === 'obst' && obst?.me && bg < 9 && c.v < 1;
  c.blockT = blockedByMe || (lim === 'obst' && c.v < 0.5) ? c.blockT + dt : 0;
  if (blockedByMe && c.blockT > 1.2 && c.hornT <= 0) { honk(c); c.hornT = 2.2 + c.rng() * 3; if (obst.foot && bg < 6 && c.rng() < 0.35) T.ctx.hud?.toast?.(`${NAMES[c.seed % NAMES.length]}: "${YELL[(c.seed + T.stats.honks) % YELL.length]}"`, 1600); }
  if (lim === 'obst' && c.blockT > 3.2 && !c.avoid && !c.bus) { const dx = obst.x - c.x, dz = obst.z - c.z, l = dx * rx + dz * rz; const tgt = l - (c.hw + Math.max(obst.hw, 0.35) + 0.8); if (tgt > -5 && laneFreeLeft(c)) { c.avoid = obst.veh || (obst.foot ? 'me' : obst.peer) || 'x'; c.shiftT = tgt; c.avoidT = 7; } }
  if (c.avoid) { c.avoidT -= dt; if (c.avoidT <= 0 || (!obst && c.v > 3 && c.blockT === 0 && c.avoidT < 4)) { c.avoid = null; c.shiftT = 0; } }
  // stuck behind a car that is itself stuck (a gridlocked junction): after a while, nudge through
  if (lim === 'obst' && obst?.ped && c.v < 0.5) { c.pedT = (c.pedT || 0) + dt; if (c.pedT > 3 && c.hornT <= 0) { honk(c); c.hornT = 3 + c.rng() * 3; } } else c.pedT = 0;   // held up by someone in the road: lean on the horn
  // deadlocked (two at a corner, each waiting on the other; a queue behind a car blocking the box): nobody drives through anybody. After
  // JAM s one of the pair that you can't see is recycled; the bus you ride clears its way after BUS_JAM s (you're aboard to get somewhere)
  const blocker = c.blockedBy || (lim === 'car' ? best : lim === 'obst' && obst?.veh?.ext ? obst.veh : null);
  if (blocker && c.v < 0.1) { c.waitT += dt; c.jamT = (c.jamT || 0) + dt; if (c.waitT > JAM) { c.waitT = JAM - 2; unjam(c, blocker); } } else if (c.v > 1) { c.waitT = 0; c.jamT = 0; }
  c.lim = lim;
  // integrate: never into another vehicle (the step ahead is checked against every solid: traffic, buses, cops, the Uber, you, parked cars)
  a = clamp(a, -9, AM); c.a = damp(c.a, a, 6, dt); c.v = Math.max(0, c.v + a * dt); solidStep(c, dt);
  c.brake = a < -0.6 || (c.v < 0.3 && lim) ? 1 : 0;
  const shR = 0.35 + c.v * 0.18, dSh = clamp(c.shiftT - c.shift, -shR * dt, shR * dt);
  if (dSh && moveBlocked(c, c.x + Math.cos(c.h) * dSh, c.z - Math.sin(c.h) * dSh, c.h)) c.shiftT = c.shift; else c.shift += dSh;   // pulling over (a bus to the kerb, going round you): not into whoever is there
  c.s += c.v * dt; let guard = 4; while (c.s > c.L && guard--) { if (!advance(c)) { c.s = c.L; c.v = 0; break; } }
  c.panic = Math.max(0, c.panic - dt);
  pose(c, dt);
}
/** the next step would put c into a solid: stop short instead (c.blockedBy says who) */
const _np = { x: 0, z: 0, dx: 0, dz: 1 };
function solidStep(c, dt) {
  const step = c.v * dt; c.blockedBy = null; if (step <= 0) return;
  // the pose the path gives after this step (on a sharp turn the body swings: a straight or yaw-rate guess missed it), past the segment end along the next one
  const s1 = c.s + step, over = Math.max(0, s1 - c.L); evalAt(c, Math.min(s1, c.L), _np);
  if (over > 0) { _np.x += c.dOx * over; _np.z += c.dOz * over; _np.dx = c.dOx; _np.dz = c.dOz; }
  const x = _np.x - _np.dz * c.shift + c.ox, z = _np.z + _np.dx * c.shift + c.oz, h = Math.atan2(-_np.dx, -_np.dz) + c.oyaw, o = moveBlocked(c, x, z, h);
  if (o) { c.v = 0; c.a = Math.min(c.a, 0); c.blockedBy = o; c.brake = 1; }
}
const seen = (c) => { const P = T.ctx.player?.position; return !!P && Math.hypot(c.x - P.x, c.z - P.z) < 60 && inView(c.x, c.y, c.z, 6); };
/** break a deadlock without anyone passing through anyone: recycle the blocker if it's a car you can't see (or it holds up the bus you
 *  ride), else me if you can't see me; in plain view both wait (the junction rules clear most of these on their own) */
function unjam(c, o) {
  const car = T.cars.includes(o) && o.active && !o.bus ? o : null;
  if (car && (!seen(car) || (c.bus && T.ride?.c === c && c.jamT > BUS_JAM))) { despawn(car); c.jamT = 0; return; }
  if (!c.bus && (!seen(c) || o.ext)) despawn(c);   // face to face with a cop car or the Uber (they don't reverse): this car gives way by leaving
}
const PARK_IN = 0.2;   // m: a parked car's solid is this much inside its paint (kerb cars sit a body's width off the lane; brushing mirrors isn't a crash)
function parkedSolid(c) { const K = carSpec(c.kind) || carSpec('sedan'); return { x: c.x, z: c.z, h: (c.ry || 0) - Math.PI / 2, hl: K.len / 2 - PARK_IN, hw: K.w / 2 - PARK_IN, v: 0, parked: true, get gone() { return !!c.gone; } }; }
/** you (driving, parked player vehicles) and friends' cars, as solids for every AI driver */
function playerSolids() {
  const ctx = T.ctx, out = [], P = ctx.player?.position; if (!P) return out;
  for (const v of ctx.vehicles?.list || []) { if (!v.pos || v.pos.y < -50 || v.gone || !v.spec || Math.abs(v.pos.x - P.x) > 400 || Math.abs(v.pos.z - P.z) > 400) continue;
    out.push({ x: v.pos.x, z: v.pos.z, h: v.heading || 0, hl: v.spec.hz || 1, hw: v.spec.hx || 0.5, v: v.speed || 0, veh: v, me: v === ctx.vehicles.mounted }); }
  const net = ctx.net; if (net?.list && net.peer) { try { for (const id of net.list()) { const q = net.peer(id); if (!q?.pos || !q.veh || q.dead) continue; out.push({ x: q.pos.x, z: q.pos.z, h: q.heading || 0, hl: 2.4, hw: 1, v: 0, peer: id }); } } catch {} }
  return out;
}
function laneFreeLeft(c) { for (const o of T.cars) { if (!o.active || o === c) continue; const dx = o.x - c.x, dz = o.z - c.z, f = dx * c.dx + dz * c.dz; if (f < -6 || f > 35) continue; const l = dx * -c.dz + dz * c.dx; if (l < -1 && l > -7) return false; } return true; }
function boxJammed(c, n) { const N = T.G.nodes[n]; for (const o of T.cars) { if (!o.active || o === c || o.v > 0.6 || o.cleared !== n) continue; if (Math.hypot(o.x - N.x, o.z - N.z) < 9) return true; } return false; }   // only cars that are in the junction (past their line), not ones waiting at it
/** the street I turn into has a stopped car just past the junction: going now would leave me stuck across the box */
function exitFull(c) { const q = c.q; if (q[3] < 0) return false; for (const o of T.cars) { if (!o.active || o === c || o.v > 1 || o.q[1] !== q[2] || o.q[2] !== q[3]) continue; if (o.s < o.hl + c.hl * 2 + S0) return true; } return false; }
function junctionClear(c, n) { const N = T.G.nodes[n]; for (const o of T.cars) { if (!o.active || o === c || o.v < 0.5) continue; if (Math.hypot(o.x - N.x, o.z - N.z) < 11) return false; } return true; }
/** world pose from the path (+ lateral avoidance shift + crash knock-off) */
function pose(c, dt) {
  evalAt(c, Math.min(c.s, c.L), _o);
  const rx = -_o.dz, rz = _o.dx;
  if (c.state === 'drive' && c.v > 0.5) { c.ox = damp(c.ox, 0, 0.8, dt); c.oz = damp(c.oz, 0, 0.8, dt); c.oyaw = damp(c.oyaw, 0, 0.8, dt); }
  c.x = _o.x + rx * c.shift + c.ox; c.z = _o.z + rz * c.shift + c.oz;
  let h = Math.atan2(-_o.dx, -_o.dz);
  if (c.v > 0.3) h -= Math.atan2(clamp(c.shiftT - c.shift, -1, 1) * (0.35 + c.v * 0.18), Math.max(c.v, 1)) * 0.6;
  h += c.oyaw;
  c.yawRate = dt > 0 ? damp(c.yawRate, wrap(h - c.h) / dt, 8, dt) : c.yawRate; c.h = h;
  c.y = T.W.groundHeight?.(c.x, c.z) ?? 0;
  c.pitch = damp(c.pitch, clamp(c.a * 0.0065, -0.035, 0.02), 6, dt); c.roll = damp(c.roll, clamp(c.v * c.yawRate * 0.009, -0.05, 0.05), 6, dt);
  c.spin += c.v * dt / (c.R.wr || 0.33);
}

// =========================================================================================================================
// you vs traffic: pushed out of a car on foot; SAT boxes against the vehicle you drive (bounce + the traffic car stops)
function collidePlayer(dt) {
  const ctx = T.ctx, p = ctx.player; if (!p || p.dead) return; const mv = ctx.vehicles?.mounted;
  for (const c of T.cars) {
    if (!c.active) continue; const dx0 = (mv ? mv.pos.x : p.position.x) - c.x, dz0 = (mv ? mv.pos.z : p.position.z) - c.z; if (dx0 * dx0 + dz0 * dz0 > 100) continue;
    const fx = -Math.sin(c.h), fz = -Math.cos(c.h), rx = -fz, rz = fx;
    if (!mv) {
      if (p.mounted || p.position.y > c.y + 1.7) continue;
      const f = dx0 * fx + dz0 * fz, l = dx0 * rx + dz0 * rz, pf = c.hl + 0.32 - Math.abs(f), pl = c.hw + 0.32 - Math.abs(l); if (pf <= 0 || pl <= 0) continue;
      if (pf < pl) { const k = Math.sign(f) * pf; p.position.x += fx * k; p.position.z += fz * k; } else { const k = Math.sign(l) * pl; p.position.x += rx * k; p.position.z += rz * k; }
      if (c.v > 5 && f > 0 && (c.hitMeT || 0) < T.t - 1) { c.hitMeT = T.t; try { p.damage?.(Math.round(c.v * 3), new THREE.Vector3(c.x, c.y + 1, c.z)); } catch {} c.v *= 0.4; honk(c, 1); }
      continue;
    }
    // vehicle: 2-D separating axes
    const mh = mv.heading, mfx = -Math.sin(mh), mfz = -Math.cos(mh), mrx = -mfz, mrz = mfx, mhl = mv.spec.hz, mhw = mv.spec.hx;
    let best = Infinity, nx = 0, nz = 0;
    for (const [ax, az] of [[fx, fz], [rx, rz], [mfx, mfz], [mrx, mrz]]) {
      const ra = c.hl * Math.abs(fx * ax + fz * az) + c.hw * Math.abs(rx * ax + rz * az), rb = mhl * Math.abs(mfx * ax + mfz * az) + mhw * Math.abs(mrx * ax + mrz * az);
      const d = dx0 * ax + dz0 * az, o = ra + rb - Math.abs(d); if (o <= 0) { best = -1; break; } if (o < best) { best = o; nx = ax * Math.sign(d || 1); nz = az * Math.sign(d || 1); }
    }
    if (best <= 0) continue;
    // driving a hijacked bus: it keeps going and the car gets shoved out of the way (n points from the car to the bus)
    if (mv.spec?.kind === 'bus' && !c.bus) { c.ox -= nx * best; c.oz -= nz * best; c.x -= nx * best; c.z -= nz * best; c.v = Math.min(c.v, 1.5); mv.vel.multiplyScalar(0.995);
      const cl = -((mv.vel.x - fx * c.v) * nx + (mv.vel.z - fz * c.v) * nz); if (T.t - (c.crashT || -9) > 0.8 && cl > 2) { c.crashT = T.t; T.stats.crashes++; c.oyaw += (c.rng() - 0.5) * 0.6; if (c.state === 'drive' || c.state === 'crashed') { c.state = 'crashed'; c.stateT = 0; c.angryDone = false; c.sev = Math.max(c.sev || 0, 0.6); } try { T.ctx.audio?.play?.('impact', { position: new THREE.Vector3(c.x, c.y + 0.8, c.z), volume: 1.3 }); } catch {} }
      continue; }
    // n points from the traffic car to you: push your vehicle out, kill the closing speed, a little bounce
    mv.pos.x += nx * best; mv.pos.z += nz * best;
    const cvx = fx * c.v, cvz = fz * c.v, rvn = (mv.vel.x - cvx) * nx + (mv.vel.z - cvz) * nz;
    if (rvn < 0) { mv.vel.x -= nx * rvn * 1.25; mv.vel.z -= nz * rvn * 1.25; mv.vel.multiplyScalar(0.82); }
    const sev = clamp(-rvn / 12, 0, 1); if (rvn < 0) ctx.vehicles?.hit?.(c, { nx, nz, vn: rvn });   // vehicles.js: crunch, sparks, damage on your car
    if (sev > 0.18 && T.t - (c.crashT || -9) > 0.8) crash(c, sev, nx, nz);
  }
}
// buses are solid to traffic: a car overlapping a bus (it pulled in to the kerb on top of it, or a car cut in) is pushed out sideways
// and slowed, instead of driving through it
function busSeparate() {
  for (const b of T.cars) { if (!b.active || !b.bus) continue; const bfx = -Math.sin(b.h), bfz = -Math.cos(b.h), brx = -bfz, brz = bfx;
    for (const c of T.cars) { if (!c.active || c.bus) continue; const dx = c.x - b.x, dz = c.z - b.z; if (dx * dx + dz * dz > 144) continue;
      const fx = -Math.sin(c.h), fz = -Math.cos(c.h), rx = -fz, rz = fx; let best = Infinity, nx = 0, nz = 0;
      for (const [ax, az] of [[bfx, bfz], [brx, brz], [fx, fz], [rx, rz]]) { const ra = b.hl * Math.abs(bfx * ax + bfz * az) + b.hw * Math.abs(brx * ax + brz * az), rb = c.hl * Math.abs(fx * ax + fz * az) + c.hw * Math.abs(rx * ax + rz * az);
        const d = dx * ax + dz * az, o = ra + rb - Math.abs(d); if (o <= 0) { best = -1; break; } if (o < best) { best = o; nx = ax * Math.sign(d || 1); nz = az * Math.sign(d || 1); } }
      if (best <= 0) continue; const k = best + 0.05; c.ox += nx * k; c.oz += nz * k; c.x += nx * k; c.z += nz * k; c.v = Math.min(c.v, 2); } }
}
function crash(c, sev, nx, nz) {
  c.crashT = T.t; T.stats.crashes++;
  c.ox -= nx * sev * 1.2; c.oz -= nz * sev * 1.2; c.oyaw += (c.rng() - 0.5) * sev * 0.5;
  const lim = 2.2, d = Math.hypot(c.ox, c.oz); if (d > lim) { c.ox *= lim / d; c.oz *= lim / d; }
  if (c.state === 'drive' || c.state === 'crashed') { c.state = 'crashed'; c.stateT = 0; c.angryDone = false; c.sev = Math.max(c.sev || 0, sev); }
  c.v *= 0.3;
  try { T.ctx.audio?.play?.('impact_metal', { position: _v.set(c.x, c.y + 0.8, c.z), volume: 0.6 + sev }); } catch {}
  try { T.ctx.audio?.play?.('glass', { position: _v, volume: sev }); } catch {}
  T.ctx.bus.emit('trafficCrash', { id: c.id, severity: +sev.toFixed(2), position: [c.x, c.y, c.z] });
}
function shootDriver(c, dmg, point) {
  if (!c.active || !c.driver || c.state === 'dead') return;
  c.state = 'dead'; c.stateT = 0; c.driver = true; c.panic = 0; honk(c, 2.5);
  T.ctx.hud?.toast?.('The driver slumps over the wheel.', 1600);
  const at = new THREE.Vector3(c.x, c.y + 1, c.z); try { T.ctx.ai?.blood?.(c.x, c.z, 0.6, c.y + 0.6); } catch {}
  T.ctx.bus.emit('npcHurt', { name: 'DRIVER', dead: true, position: at });
  for (const o of T.cars) if (o !== c && o.active && o.driver && Math.hypot(o.x - c.x, o.z - c.z) < 40) o.panic = 8;   // everybody near floors it
}

// =========================================================================================================================
// render
function render(dt) {
  const lamp = lampK();
  const blink = Math.floor(T.t * 3) % 2 === 0;
  for (const c of T.cars) {
    if (!c.active) continue;
    if (c.bus) { renderBus(c, dt); continue; }
    if (c.far && (T.frame + c.id) % 4) continue;
    const R = c.R;
    // body: T · Ry(yaw) · Rz(pitch) · Rx(roll) in the kit frame (+x = forward)
    _e.set(c.roll, c.h + Math.PI / 2, c.pitch, 'YZX'); _q.setFromEuler(_e); _p.set(c.x, c.y, c.z); _m.compose(_p, _q, ONE);
    if (c.model) { c.model.matrix.copy(_m); c.model.matrixWorldNeedsUpdate = true; }
    else for (const im of R.ims) im.setMatrixAt(c.slot, _m);
    // wheels: T · Ry(yaw) (no body roll) · T(wheel) · Ry(steer / flip) · Rz(spin)
    if (!c.model) {
      _q2.setFromAxisAngle(UP, c.h + Math.PI / 2); _m2.compose(_p, _q2, ONE);
      const kap = c.v > 0.5 ? -c.yawRate / c.v : 0, steer = clamp(Math.atan(R.wb * kap), -0.6, 0.6), sc = (R.wr || 0.33) / 0.33;
      R.wheels.forEach((w, k) => {
        const yaw = (w.x > 0 ? -steer : 0) + (w.side < 0 ? Math.PI : 0); _q.setFromAxisAngle(UP, yaw); _q2.setFromAxisAngle(ZAX, w.side > 0 ? -c.spin : c.spin); _q.multiply(_q2);
        _s.set(sc, sc, 1); _v.set(w.x, w.y, w.z); _m.compose(_v, _q, _s).premultiply(_m2);
        for (const im of T.wheels) im.setMatrixAt(c.id * 4 + k, _m);
      });
    }
    // lamps: tails (brake bright / night dim), heads at night, the blinker on the turn side before a junction
    const L = R.lamps, base = c.id * 6;
    _e.set(c.roll, c.h + Math.PI / 2, c.pitch, 'YZX'); _q.setFromEuler(_e); _m2.compose(_p, _q, ONE);
    const tailK = c.brake ? 1 : lamp * 0.45, headK = lamp;
    const turning = c.turnSide && c.turnAng > 0.5 && c.L - c.s < 35 && c.state === 'drive';
    for (let k = 0; k < 6; k++) {
      let on = 0, x = 0, y = 0, z = 0, sz = 0.3, col = null;
      if (k < 2) { on = tailK; x = L.tail[0]; y = L.tail[1]; z = (k ? 1 : -1) * L.tail[2]; sz = c.brake ? 0.55 : 0.35; col = GLOW.red; }
      else if (k < 4) { on = headK; x = L.head[0]; y = L.head[1]; z = (k === 3 ? 1 : -1) * L.head[2]; sz = 0.7; col = GLOW.white; }
      else { const haz = c.state === 'crashed' || c.state === 'abandoned'; on = (turning && blink) || (haz && blink) ? 1 : 0; const side = haz ? (k === 4 ? 1 : -1) : c.turnSide; x = k === 4 ? L.tail[0] : L.head[0]; y = k === 4 ? L.tail[1] + 0.02 : L.head[1]; z = side * (k === 4 ? L.tail[2] + 0.12 : L.head[2] + 0.18); sz = 0.35; col = GLOW.amber; }
      if (on <= 0.01) { T.glow.setMatrixAt(base + k, ZERO); continue; }
      _q.setFromAxisAngle(UP, x < 0 ? Math.PI : 0); _v.set(x, y, z); _s.set(sz, sz * 0.7, sz); _m.compose(_v, _q, _s).premultiply(_m2);
      T.glow.setMatrixAt(base + k, _m); _col.copy(col).multiplyScalar(on); T.glow.setColorAt(base + k, _col);
    }
    // silhouette driver (hidden while a real one sits there, gone once they are out)
    if (c.driver && !c.real && c.state !== 'abandoned') {
      const e = R.eye; _v.set(e.x - 0.08, e.y + 0.03 - (c.state === 'dead' ? 0.22 : 0), e.z);
      _q.setFromAxisAngle(ZAX, c.state === 'dead' ? -0.5 : 0); _m.compose(_v, _q, ONE).premultiply(_m2);
      T.silB.setMatrixAt(c.id, _m); T.silH.setMatrixAt(c.id, _m);
    } else { T.silB.setMatrixAt(c.id, ZERO); T.silH.setMatrixAt(c.id, ZERO); }
    // hitboxes
    c.hbBody.position.set(c.x, c.y + 0.25 + (R.belt - 0.25) / 2, c.z); c.hbBody.rotation.set(0, c.h + Math.PI / 2, 0); c.hbBody.updateMatrixWorld();
    if (c.driver && c.state !== 'abandoned') { _v.set(R.eye.x - 0.1, R.eye.y - 0.35, R.eye.z).applyMatrix4(_m2); c.hbDrv.position.copy(_v); c.hbDrv.rotation.y = c.h; } else c.hbDrv.position.set(0, -500, 0);
    c.hbDrv.updateMatrixWorld();
  }
  for (const R of Object.values(T.kinds)) if (R.ims) for (const im of R.ims) im.instanceMatrix.needsUpdate = true;
  for (const im of T.wheels) im.instanceMatrix.needsUpdate = true;
  T.glow.instanceMatrix.needsUpdate = true; if (T.glow.instanceColor) T.glow.instanceColor.needsUpdate = true;
  T.silB.instanceMatrix.needsUpdate = T.silH.instanceMatrix.needsUpdate = true;
}
const GLOW = { red: new THREE.Color(1.6, 0.08, 0.04), white: new THREE.Color(1.4, 1.3, 1.1), amber: new THREE.Color(1.8, 0.8, 0.08) }, _col = new THREE.Color();
function lampK() { const k = T.ctx.lights?.key; if (!k) return 0; return clamp((2.2 - k.intensity) / 1.8, 0, 1); }

/** Rocketbox drivers for the nearest cars (re-assigned 4x a second), seated where the silhouette would be */
function drivers(dt) {
  if (!T.people.length) return;
  T.peopleT -= dt;
  if (T.peopleT <= 0) {
    T.peopleT = 0.25; const P = T.ctx.player.position;
    const want = T.cars.filter((c) => c.active && !c.bus && c.driver && c.state !== 'abandoned' && !c.model && Math.hypot(c.x - P.x, c.z - P.z) < 55).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z)).slice(0, T.people.length);
    for (const pp of T.people) if (pp.car && !want.includes(pp.car)) { pp.car.real = null; pp.car = null; pp.f.group.visible = false; }
    for (const c of want) { if (c.real) continue; const pp = T.people.find((q) => !q.car); if (!pp) break; pp.car = c; c.real = pp; pp.f.group.visible = true; }
  }
  for (const pp of T.people) {
    const c = pp.car; if (!c) continue; const e = c.R.eye;
    _e.set(c.roll, c.h + Math.PI / 2, c.pitch, 'YZX'); _q.setFromEuler(_e); _p.set(c.x, c.y, c.z); _m2.compose(_p, _q, ONE);
    // person frame faces +z; turn it to the kit's +x, then put the skull centre just behind the driver's eye point
    _q.setFromAxisAngle(UP, Math.PI / 2); if (c.state === 'dead') { _q2.setFromAxisAngle(ZAX, -0.35); _q.premultiply(_q2); }
    _v.set(pp.hx, pp.hy, pp.hz).applyQuaternion(_q); _p.set(e.x - 0.08 - _v.x, e.y + 0.02 - _v.y - (c.state === 'dead' ? 0.15 : 0), e.z - _v.z);
    _m.compose(_p, _q, ONE).premultiply(_m2); pp.f.group.matrix.copy(_m); pp.f.group.matrixWorldNeedsUpdate = true;
    if (c.state !== 'dead') pp.f.update(dt);
  }
}
function releaseDriver(c) { const pp = c.real; if (!pp) return; pp.car = null; pp.f.group.visible = false; c.real = null; }

// =========================================================================================================================
// F: carjack
function doorPos(c, out) { const fx = -Math.sin(c.h), fz = -Math.cos(c.h), rx = -fz, rz = fx, e = c.R.eye; return out.set(c.x + fx * (e.x - 0.1) - rx * (c.hw + 0.55), c.y, c.z + fz * (e.x - 0.1) - rz * (c.hw + 0.55)); }
function interact() {
  const ctx = T.ctx, p = ctx.player; T.jackable = null; T.spotPos.set(0, -999, 0);
  T.board = null; T.hijack = null; T.boardPos.set(0, -999, 0); T.hijackPos.set(0, -999, 0);
  if (!p || p.dead || p.mounted || ctx.vehicles?.mounted) return;
  let best = null, bd = 2.4;
  busInteract();
  for (const c of T.cars) { if (!c.active || c.bus || c.v > 6.5) continue; doorPos(c, _v); const d = Math.hypot(_v.x - p.position.x, _v.z - p.position.z); if (d < bd && Math.abs(p.position.y - c.y) < 1.6) { bd = d; best = c; } }
  if (best) { T.jackable = best; doorPos(best, T.spotPos); if (best.state === 'drive' && best.v < 3) best.v *= 0.5; }
}
function jack(c) {
  const ctx = T.ctx, veh = ctx.vehicles; if (!veh?.spawnCar || !c.active || ctx.vehicles.mounted) return false;
  const hadDriver = c.driver && c.state !== 'abandoned';
  if (hadDriver && c.state !== 'dead') pullOut(c, c.rng() < 0.3);
  else if (c.state === 'dead') dumpBody(c);
  const kind = c.kind, color = c.color.getHex(), x = c.x, z = c.z, h = c.h, v = c.v;
  despawn(c);
  let car = null; try { car = veh.spawnCar(x, z, h, kind, color, 0); } catch (e) { console.warn('[traffic] spawnCar', e); }
  if (!car) return false;
  car.vel.set(-Math.sin(h) * v, 0, -Math.cos(h) * v);
  veh.mount(car); T.stats.jacked++;
  ctx.bus.emit('carjack', { kind, position: [x, 0, z], driver: hadDriver });
  if (hadDriver) ctx.hud?.toast?.('CARJACKED', 1400);
  return true;
}
function pullOut(c, angry) {
  const ctx = T.ctx; c.driver = false; releaseDriver(c);
  if (!peopleReady()) return null;
  doorPos(c, _v); const pos = new THREE.Vector3(_v.x, c.y, _v.z), name = NAMES[c.seed % NAMES.length];
  let t = null;
  try {
    const fig = buildPerson({ seed: c.seed % 997, female: /MARISOL|OKSANA|IRINA|KEISHA|SVETA/.test(name) });
    const P = ctx.player.position;
    t = adoptFolk({ fig, pos, yaw: Math.atan2(P.x - pos.x, P.z - pos.z), name, type: 'mk', intent: angry ? 'fight' : 'mark', temper: angry ? 'tough' : 'soft', cash: 5 + 5 * ((c.seed >> 3) % 6) });
    if (t && !angry) folkFlee(t);
    fig.play?.('hit');
  } catch (e) { console.warn('[traffic] driver out', e?.message || e); }
  ctx.hud?.toast?.(angry ? `${name}: "${['You wanna go?! GET OUTTA MY CAR!', 'Ты чё, берега попутал?!', 'Oh, you picked the WRONG car, pal.'][c.seed % 3]}"` : `${name}: "${['Take it! Take it! Just don\'t hurt me!', 'Aaah! Somebody call 911!', 'Это не моя машина! Бери!'][c.seed % 3]}"`, 2200);
  return t;
}
function dumpBody(c) {
  if (!peopleReady()) return; c.driver = false; releaseDriver(c);
  try { const f = buildPerson({ seed: c.seed % 997 }); doorPos(c, _v); f.group.position.set(_v.x, c.y + 0.12, _v.z); f.group.rotation.set(-Math.PI / 2, c.h, 0); T.world.scene.add(f.group); setTimeout(() => T.world.scene.remove(f.group), 60000); } catch {}
}

// =========================================================================================================================
// horns: a two-tone synth through the effects bus, attenuated by distance
function honk(c, len = 0.45) {
  T.stats.honks++; const ctx = T.ctx, E = ctx.audio?.engine, ac = ctx.audio?.context; if (!E || !ac) return;
  const cam = ctx.camera.position, d = Math.hypot(c.x - cam.x, c.z - cam.z); if (d > 110) return;
  try {
    const t = ac.currentTime, g = ac.createGain(), vol = 0.22 * Math.pow(1 - d / 110, 2); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + len - 0.06); g.gain.linearRampToValueAtTime(0, t + len);
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null; if (pan) { const yaw = T.ctx.player?.yaw || 0, rx = Math.cos(yaw), rz = -Math.sin(yaw); pan.pan.value = clamp(((c.x - cam.x) * rx + (c.z - cam.z) * rz) / Math.max(d, 1), -0.8, 0.8); g.connect(pan); pan.connect(E.bus.foley || E.master); } else g.connect(E.bus.foley || E.master);
    const k = 0.9 + (c.seed % 7) * 0.035, fs = c.bus ? [196, 247] : [415 * k, 523 * k];
    for (const f of fs) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = c.bus ? 1100 : 1900; o.connect(lp); lp.connect(g); o.start(t); o.stop(t + len + 0.02); }
  } catch {}
}

// =========================================================================================================================
// QA (window.__game.traffic)
function roadDist(x, z) { let best = 1e9; for (const r of OSM.r) { if (r.w < 9) continue; for (let i = 0; i + 1 < r.p.length; i++) { const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t) - r.w / 2); } } return best; }
const r2 = (v) => Math.round(v * 100) / 100;
export const trafficQA = {
  _T: () => T,
  buses: () => T ? T.cars.filter((c) => c.bus).map((c) => ({ id: c.id, lim: c.lim || null, ob: c.obst ? { x: r2(c.obst.x), z: r2(c.obst.z), ped: !!c.obst.ped, me: !!c.obst.me, veh: !!c.obst.veh, peer: c.obst.peer || null } : null, lead: c.leader?.id ?? null, blocked: c.blockedBy ? [c.blockedBy.parked ? 'parked' : c.blockedBy.kind || (c.blockedBy.cop != null ? 'cop' : c.blockedBy.uber != null ? 'uber' : c.blockedBy.veh ? 'player' : 'x'), r2(c.blockedBy.x), r2(c.blockedBy.z)] : null, route: c.route.id, x: r2(c.x), z: r2(c.z), h: r2(c.h), v: r2(c.v), state: c.state, stop: c.state === 'dwell' ? c.route.stops[c.stopI].name : null, next: c.route.stops[c.nextStop].name, door: r2(c.doorK || 0), road: r2(roadDist(c.x, c.z)), riding: T.ride?.c === c })) : [],
  board: () => (T.board ? (boardBus(T.board), true) : false), toStop(id) { const c = T.cars[id]; if (!c?.bus) return null; const S = c.route.stops[c.nextStop]; T.ctx.player.teleport(S.px, 0, S.pz, 0, 0); return S.name; },
  toBusDoor(id) { const c = T.cars[id]; if (!c?.bus) return null; c.B.group.updateMatrixWorld(); busPoint(c, (BUS.doorF[0] + BUS.doorF[1]) / 2, BUS.w / 2 + 1.0, _v); T.ctx.player.teleport(_v.x, c.y, _v.z, c.h + Math.PI / 2, 0); return [r2(_v.x), r2(_v.z)]; },
  toBusDriver(id) { const c = T.cars[id]; if (!c?.bus) return null; c.B.group.updateMatrixWorld(); busPoint(c, BUS.eye.x, -BUS.w / 2 - 0.8, _v); T.ctx.player.teleport(_v.x, c.y, _v.z, c.h - Math.PI / 2, 0); return [r2(_v.x), r2(_v.z)]; },
  ride: () => T.ride ? { route: T.ride.c.route.id, bus: T.ride.c.id, x: r2(T.ctx.player.position.x), z: r2(T.ctx.player.position.z) } : null,
  state: () => T && { cars: T.cars.filter((c) => c.active && !c.bus).length, budget: T.budget, ring: T.ring, moving: T.cars.filter((c) => c.active && c.v > 1).length, people: T.people.filter((p) => p.car).length, ...T.stats, jackable: T.jackable ? T.jackable.id : null },
  cars: () => T ? T.cars.filter((c) => c.active).map((c) => ({ lim: c.lim, wait: +(c.waitT || 0).toFixed(1), blocked: c.blockedBy ? c.blockedBy.id ?? c.blockedBy.kind ?? 'x' : null, q: c.q?.slice(0, 4), cleared: c.cleared, id: c.id, kind: c.kind, x: r2(c.x), z: r2(c.z), v: r2(c.v), h: r2(c.h), state: c.state, driver: c.driver, real: !!c.real, road: r2(roadDist(c.x, c.z)), lane: c.lane })) : [],
  roadDist,
  /** stand at the driver's door of car id (or the nearest active car) */
  toDoor(id) { const c = id != null ? T.cars[id] : T.cars.filter((c) => c.active).sort((a, b) => Math.hypot(a.x - T.ctx.player.position.x, a.z - T.ctx.player.position.z) - Math.hypot(b.x - T.ctx.player.position.x, b.z - T.ctx.player.position.z))[0]; if (!c?.active) return null; c.v = 0; c.hold = true; doorPos(c, _v); T.ctx.player.teleport(_v.x, c.y, _v.z, c.h - Math.PI / 2, 0); return c.id; },
  hold(id, on = true) { const c = T.cars[id]; if (c) c.hold = !!on; },
  jack() { return T.jackable ? jack(T.jackable) : false; },
  freeze(on = true) { T.fz = !!on; },
  signal: (x, z) => { const n = T.G.nodes.find((q) => q.sig && Math.hypot(q.x - x, q.z - z) < 20); return n ? [...n.sig.grp.keys()].map((k) => signalFor(n, k)) : null; },
  graph: () => ({ nodes: T.G.nodes.filter((n) => n.adj.length).length, segs: T.G.segs.length, signals: T.G.nodes.filter((n) => n.sig).length }),
};


// =========================================================================================================================
// MTA buses: fixed loops on the real Coney routes, paced by a wall-clock timetable (friends see the same bus at about the same
// place), ~10 s at every stop with the doors open. F at an open door rides along (F at a stop to get off); F at the driver's
// window while it's stopped hijacks it.
const ROUTES = [
  // every route turns round in the Stillwell terminal bus loop, under the el (coney/stillwell.js BUS_LOOP)
  { id: 'B36', sign: 'B36|SHEEPSHEAD BAY', way: [[-28, -231], [20, -117], [54, -153], [100, -459], [40, -536], [-87, -536], [-87, -290], [-86, -132]], n: 2 },
  { id: 'B68', sign: 'B68|PROSPECT PARK', way: [[-28, -231], [-86, -132], [-87, -290], [-87, -536], [40, -536], [100, -459], [54, -153], [20, -117]], n: 2 },
  { id: 'B74', sign: 'B74|MERMAID AV', way: [[-28, -231], [-86, -132], [-230, -142], [-365, -142], [-365, -291], [-230, -291], [-87, -290], [-86, -132]], n: 1 },
];
export const BUS_STOPS = [
  ['Surf Av / W 15 St', -10, -119], ['W 12 St / Luna Park', 68, -250], ['W 12 St / Neptune Av', 94, -430],
  ['Neptune Av / W 15 St', 20, -536], ['Stillwell Av Terminal', -32.6, -186], ['Surf Av / Stillwell Terminal', -23.4, -186], ['Stillwell Av / Mermaid Av', -87, -330], ['Stillwell Av / Surf Av', -87, -185],
  ['Surf Av / W 17 St', -175, -140], ['Surf Av / W 21 St', -310, -142], ['W 23 St / Mermaid Av', -365, -240], ['Mermaid Av / W 21 St', -300, -291], ['Mermaid Av / W 17 St', -170, -291],
];
const BUS_V = 6.2, DWELL = 10, PULL_IN = 50;   // PULL_IN: m before a stop where the bus moves over to the kerb
function dijkstra(s, t) {
  const N = T.G.nodes, n = N.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n); dist[s] = 0; const open = [s];
  while (open.length) { let bi = 0; for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i; const u = open[bi]; open[bi] = open[open.length - 1]; open.pop(); if (done[u]) continue; done[u] = 1; if (u === t) break;
    for (const e of N[u].adj) { const nd = dist[u] + e.len * (e.w >= 14 ? 1 : 1.6); if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; open.push(e.to); } } }
  if (!isFinite(dist[t])) return null; const out = []; for (let v = t; v !== -1; v = prev[v]) out.push(v); return out.reverse();
}
function nearestNode(x, z) { let bi = -1, bd = 1e9; T.G.nodes.forEach((n, i) => { if (!n.adj.length) return; const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; bi = i; } }); return bi; }
function buildRoute(R) {
  const w = R.way.map(([x, z]) => nearestNode(x, z)); let nodes = [];
  for (let i = 0; i < w.length; i++) { const leg = dijkstra(w[i], w[(i + 1) % w.length]); if (!leg) return null; nodes.push(...leg.slice(0, -1)); }
  // no U-turns where the legs join
  for (let k = 0; k < 300; k++) { const n = nodes.length; const out = []; for (let i = 0; i < n; i++) { const a = nodes[(i - 1 + n) % n], c = nodes[(i + 1) % n]; if (a === c && out.length) { out.pop(); continue; } out.push(nodes[i]); } const done = out.length === nodes.length; nodes = out; if (done) break; }
  const N = T.G.nodes, cum = [0]; for (let i = 0; i < nodes.length; i++) { const a = N[nodes[i]], b = N[nodes[(i + 1) % nodes.length]]; cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z)); }
  const Lr = cum[nodes.length];
  // stops: every listed stop within 12 m of this loop, on the kerb side of the direction of travel
  const stops = [];
  for (const [name, sx, sz] of BUS_STOPS) {
    let best = null; for (let i = 0; i < nodes.length; i++) { const a = N[nodes[i]], b = N[nodes[(i + 1) % nodes.length]], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = ((sx - a.x) * dx + (sz - a.z) * dz) / L2, px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(sx - px, sz - pz);
      if (t < 0.05 || t > 0.95) continue;   // the stop's foot must fall inside the block: clamped to a segment end (a route only turning past it) it was offset into the junction mouth, the shelter in the street at Surf Av
      if (d < 12 && (!best || d < best.d)) { const L = Math.sqrt(L2), e = edge(nodes[i], nodes[(i + 1) % nodes.length]); best = { d, name, rs: cum[i] + t * L, x: px, z: pz, dx: dx / L, dz: dz / L, w: e?.w || 10 }; } }
    if (best) { const kerb = best.w / 2 - 1.6, sh = Math.max(0, kerb - laneOff(best.w, 1)); stops.push({ ...best, shift: sh, px: best.x - best.dz * (best.w / 2 + 1.2), pz: best.z + best.dx * (best.w / 2 + 1.2) }); }
    // the bus pulls in to the kerb here: no car parked in its way (they're placed before the stops are known)
    // and none along the kerb it pulls in over (PULL_IN m before the stop): one there was 2 m into the B36 at the terminal
    const inBusWay = (c) => { const dx = c.x - best.x, dz = c.z - best.z, a = dx * best.dx + dz * best.dz, l = dz * best.dx - dx * best.dz; return a > -PULL_IN - 5 && a < 12 && l > 0 && l < best.w / 2 + 2; };
    if (best) for (const c of T?.world?.parkedCars || []) if (!c.gone && (Math.hypot(c.x - best.x, c.z - best.z) < 30 || inBusWay(c))) dropParked(c);
  }
  stops.sort((a, b) => a.rs - b.rs);
  // timetable: run at BUS_V between stops, DWELL at each → position on the loop at any wall-clock second
  const legs = []; let t = 0; for (let i = 0; i < stops.length; i++) { const a = stops[i], b = stops[(i + 1) % stops.length]; legs.push({ t0: t, t1: t + DWELL, s0: a.rs, s1: a.rs, stop: i }); t += DWELL; const d = ((b.rs - a.rs) % Lr + Lr) % Lr || Lr; legs.push({ t0: t, t1: t + d / BUS_V, s0: a.rs, s1: a.rs + d }); t += d / BUS_V; }
  return { id: R.id, sign: R.sign, nodes, cum, Lr, stops, legs, cycle: t, next: (c) => nodes[(c.rq1 + 4) % nodes.length] };
}
function schedAt(route, tt) { const t = ((tt % route.cycle) + route.cycle) % route.cycle; for (const g of route.legs) if (t < g.t1) { const k = g.t1 > g.t0 ? (t - g.t0) / (g.t1 - g.t0) : 0; return { s: (g.s0 + (g.s1 - g.s0) * k) % route.Lr, stop: g.stop }; } return { s: 0 }; }
const routePos = (c) => (c.route.cum[c.rq1] + Math.min(c.s, c.L)) % c.route.Lr;
const wrapD = (d, L) => { d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; };
function buildBuses(world) {
  const { ctx } = world; T.routes = []; T.boardPos = new THREE.Vector3(0, -999, 0); T.hijackPos = new THREE.Vector3(0, -999, 0);
  const hbm = new THREE.MeshBasicMaterial({ visible: false }), stopGeo = [];
  for (const R of ROUTES) {
    const r = buildRoute(R); if (!r || r.stops.length < 2) { console.warn('[traffic] no route for', R.id); continue; } T.routes.push(r);
    const n = T.lite ? 1 : R.n;
    for (let k = 0; k < n; k++) {
      const B = buildBus({ sign: R.sign, lite: T.lite }); world.scene.add(B.group);
      for (const m of B.meshes) if (m.parent === B.group) { m.userData.surface = 'metal'; m.userData.noLOS = true; }
      const c = { id: T.cars.length, bus: true, kind: 'bus', route: r, off: k * r.cycle / n + (hash(R.id.charCodeAt(2), 5) % 60), B, R: { hl: BUS.len / 2, hw: BUS.w / 2, eye: BUS.eye, wr: BUS.wheelR, belt: 1.05, ims: [] },
        active: true, q: new Int32Array(5), rng: mulberry(900 + T.cars.length), lane: 1, s: 0, v: 0, a: 0, x: 0, y: 0, z: 0, h: 0, yawRate: 0, spin: 0, shift: 0, shiftT: 0, ox: 0, oz: 0, oyaw: 0,
        state: 'drive', stateT: 0, driver: true, hornT: 0, blockT: 0, waitT: 0, panic: 0, brake: 0, pitch: 0, roll: 0, hl: BUS.len / 2, hw: BUS.w / 2, seed: 4242 + k * 17, pers: 0.72, amax: 1.1, acc: 0, stopT: 0, far: false, cleared: -1, doorK: 0, doorT: 0, nextStop: 0 };
      const drv = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), hbm); drv.userData = { traffic: c, onHit: (dmg, head, point) => shootDriver(c, dmg, point) }; world.scene.add(drv); ctx.raycastTargets.push(drv);
      for (const m of B.meshes) if (m.parent === B.group) ctx.raycastTargets.push(m);
      c.hbDrv = drv; c.hbBody = new THREE.Object3D();
      // who's aboard: silhouettes (driver + a few riders) merged per bus; real people take over on the nearest bus
      c.sil = busSilhouettes(B, c.seed); B.group.add(c.sil);
      T.cars.push(c); placeBus(c, true);
    }
    for (const S of r.stops) if (!stopGeo.some((q) => Math.hypot(q.px - S.px, q.pz - S.pz) < 6)) stopGeo.push(S);
  }
  try { busStopProps(world, stopGeo); } catch (e) { console.warn('[traffic] stops', e); }
  T.G.grid = null;   // the road graph and the stops are placed: its collider index (~5 MB) is done
  if (!T.lite && peopleReady()) { T.busPeople = []; for (let i = 0; i < 4; i++) { try { const f = buildPerson({ seed: 700 + i * 53, pose: 'sit', female: i === 2 }); f.update(0.016); f.group.updateMatrixWorld(true); f.group.userData.sit = true;   // seated riders: side seats are 0.48 m apart, shoulder to shoulder (qa/sweep.mjs skips sitters)
    const hp = f.head.getWorldPosition(new THREE.Vector3()); f.group.visible = false; f.group.matrixAutoUpdate = false; world.scene.add(f.group); T.busPeople.push({ f, hx: hp.x, hy: hp.y, hz: hp.z }); } catch { break; } } }
  try { HK.spot({ pos: T.boardPos, r: 2.4, dy: 1.6, when: () => !!T.board, prompt: () => `F — BOARD THE ${T.board?.route.id} · ${T.board?.route.sign.split('|')[1]}`, act: () => { if (T.board) boardBus(T.board); } }); } catch {}
  try { HK.spot({ pos: T.hijackPos, r: 1.8, dy: 1.6, when: () => !!T.hijack, prompt: () => 'F — HIJACK THE BUS', act: () => { if (T.hijack) jackBus(T.hijack); } }); } catch {}
  console.log('[traffic] buses', T.cars.filter((c) => c.bus).length, '· routes', T.routes.map((r) => `${r.id} ${Math.round(r.Lr)}m ${r.stops.length} stops ${Math.round(r.cycle)}s`).join(' · '));
}
/** put a bus where the timetable says it is right now */
function placeBus(c, reset) {
  const r = c.route, now = Date.now() / 1000, sc = schedAt(r, now + c.off), N = r.nodes, n = N.length;
  let i = 0; while (i < n - 1 && r.cum[i + 1] <= sc.s) i++;
  c.rq1 = i; startOn(c, N[i], N[(i + 1) % n], sc.s - r.cum[i]);
  c.active = true; c.state = 'drive'; c.stateT = 0; c.v = sc.stop != null ? 0 : BUS_V; c.driver = true; c.ox = c.oz = c.oyaw = 0; c.shift = c.shiftT = 0; c.panic = 0; c.hold = false;
  const rs = routePos(c); let k = 0; while (k < r.stops.length && r.stops[k].rs < rs - 1) k++; c.nextStop = k % r.stops.length;
  if (sc.stop != null) { c.nextStop = sc.stop; const S = r.stops[sc.stop]; c.shift = c.shiftT = S.shift; }
  c.B.group.visible = true; pose(c, 0.016);
  for (const o of T.cars) if (o !== c && o.active && !o.bus && Math.hypot(o.x - c.x, o.z - c.z) < c.hl + o.hl + 1) despawn(o);   // put back on its timetable out of sight: no car left inside it
}
function busPace(c, now) { const r = c.route, sc = schedAt(r, now / 1000 + c.off), lag = wrapD(sc.s - routePos(c), r.Lr); return clamp(0.85 + lag / 70, 0.5, 1.3); }
function busStop(c) {
  const r = c.route, S = r.stops[c.nextStop]; let d = ((S.rs - routePos(c)) % r.Lr + r.Lr) % r.Lr;
  if (d > r.Lr - 4) d = 0;
  if (d < PULL_IN) c.shiftT = S.shift; else if (!c.avoid) c.shiftT = 0;
  if (d < 0.9 && c.v < 0.8) { c.state = 'dwell'; c.stateT = 0; c.stopI = c.nextStop; c.dwellT = DWELL; c.nextStop = (c.nextStop + 1) % r.stops.length; c.v = 0; if (T.ride?.c === c) { const R = T.ride, tav = T.world.W?.tavern; R.stops = (R.stops || 0) + 1;
      // a few stops in, the bus runs on (via the Belt) to 8 Av: Soccer Tavern — stay on for it, F to get off here
      const runOn = R.stops >= 3 || (R.stops >= 2 && performance.now() - (R.t0 || 0) > 120000);   // three stops, or two once you've been on two minutes (signals on the avenues make it slow)
      if (tav && runOn) { T.ride = null; if (T.ctx.player.mounted?.bus) T.ctx.player.mounted = null; tav.arrive('bus'); return null; }
      T.ctx.hud?.toast?.(`This is ${S.name}. ${T.ctx.isTouch ? 'GET OFF' : 'F'} to get off · ${tav ? `${3 - R.stops} more stop${R.stops === 2 ? '' : 's'}, then on to 8 Av · Soccer Tavern` : `next: ${r.stops[c.nextStop].name}`}`, 3600); }
    return null; }
  return d < 70 ? { d: d + S0 - 0.5 } : null;
}
function busSilhouettes(B, seed) {
  const sg = silhouetteGeos(), rng = mulberry(seed), geos = [];
  const put = (x, y, z, ry, col) => { for (const [g0, hex] of [[sg.body, col], [sg.head, SKINS[(rng() * 5) | 0].getHex()]]) { const g = g0.clone(); g.rotateY(ry); g.translate(x, y, z); const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(hex); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); geos.push(g); } };
  put(B.driver.x - 0.1, B.driver.y + 0.74, B.driver.z, 0, 0x2b3a55);
  const picks = B.seats.filter(() => rng() < 0.35).slice(0, 7);
  for (const s of picks) put(s.x - (s.face ? 0.12 : 0), s.y + 0.72, s.z + (s.face ? 0 : s.side * 0.1), s.face ? 0 : (s.side > 0 ? Math.PI / 2 : -Math.PI / 2), SHIRTS[(rng() * SHIRTS.length) | 0].getHex());
  B.used = picks;
  const m = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })); m.name = 'bus:riders'; return m;
}
function renderBus(c, dt) {
  const B = c.B, P = T.ctx.player.position, d = Math.hypot(c.x - P.x, c.z - P.z);
  B.group.visible = d < 380;
  if (!B.group.visible) return;
  B.group.position.set(c.x, c.y, c.z); B.group.rotation.set(c.roll, c.h + Math.PI / 2, c.pitch, 'YZX');
  { const kap = c.v > 0.5 ? -c.yawRate / c.v : 0; B.roll?.(c.spin * (c.R?.wr || 0.33) / BUS.wheelR, -clamp(Math.atan((BUS.axleF - BUS.axleR) * kap), -0.5, 0.5)); }   // the wheels roll and the fronts steer
  c.doorK = damp(c.doorK || 0, c.state === 'dwell' ? c.doorT : 0, 5, dt); B.setDoors(c.doorK);
  B.interior.visible = d < 90; c.sil.visible = d < 200 && T.busNear !== c;
  B.group.updateMatrixWorld();
  _v.set(B.driver.x - 0.05, B.driver.y + 0.45, B.driver.z).applyMatrix4(B.group.matrixWorld); c.hbDrv.position.copy(_v); c.hbDrv.updateMatrixWorld();
  if (c.state === 'dead' && !c.deadDone) { c.deadDone = true; c.sil.visible = false; }
}
/** real seated people (driver + 3 riders) on the nearest bus within 60 m */
function busPeople() {
  const L = T.busPeople; if (!L?.length) return; const P = T.ctx.player.position;
  let best = null, bd = 60; for (const c of T.cars) if (c.bus && c.B.group.visible && c.state !== 'jacked') { const d = Math.hypot(c.x - P.x, c.z - P.z); if (d < bd) { bd = d; best = c; } }
  T.busNear = best; for (const pp of L) pp.f.group.visible = !!best;
  if (!best) return; const B = best.B, M = B.group.matrixWorld;
  const seats = [{ x: B.driver.x, y: B.driver.y, z: B.driver.z, face: 1, drv: true }, ...B.used.slice(0, L.length - 1)];
  L.forEach((pp, i) => { const s = seats[i]; if (!s || (s.drv && !best.driver)) { pp.f.group.visible = false; return; }
    const ry = s.face ? Math.PI / 2 : (s.side > 0 ? Math.PI : 0); _q.setFromAxisAngle(UP, ry); _v.set(pp.hx, pp.hy, pp.hz).applyQuaternion(_q);
    const fx = s.face ? 1 : 0, fz = s.face ? 0 : -s.side; _p.set(s.x - fx * 0.14 - _v.x, s.y + 0.7 - _v.y, s.z - fz * 0.14 - _v.z);
    _m.compose(_p, _q, ONE).premultiply(M); pp.f.group.matrix.copy(_m); pp.f.group.matrixWorldNeedsUpdate = true; pp.f.update(1 / 60); });
}
/** doors (kerb side) and the driver's window (street side) of a stopped bus, in world space */
function busPoint(c, lx, lz, out) { return out.set(lx, 0, lz).applyMatrix4(c.B.group.matrixWorld).setY(c.y); }
function busInteract() {
  const p = T.ctx.player.position; let bd = 3;
  for (const c of T.cars) {
    if (!c.bus || c.state === 'jacked' || !c.B.group.visible) continue; if (Math.hypot(c.x - p.x, c.z - p.z) > 16) continue;
    if (c.state === 'dwell' && c.doorK > 0.6) for (const [a, b] of [BUS.doorF, BUS.doorR]) { busPoint(c, (a + b) / 2, BUS.w / 2 + 0.9, _v); const d = Math.hypot(_v.x - p.x, _v.z - p.z); if (d < bd) { bd = d; T.board = c; T.boardPos.copy(_v); } }
    if (c.v < 1 && c.driver && c.state !== 'dead') { busPoint(c, BUS.eye.x, -BUS.w / 2 - 0.8, _v); if (Math.hypot(_v.x - p.x, _v.z - p.z) < 2) { T.hijack = c; T.hijackPos.copy(_v); } }
    else if (c.v < 1 && c.state === 'dead') { busPoint(c, BUS.eye.x, -BUS.w / 2 - 0.8, _v); if (Math.hypot(_v.x - p.x, _v.z - p.z) < 2) { T.hijack = c; T.hijackPos.copy(_v); } }
  }
}
function boardBus(c) {
  const p = T.ctx.player; if (T.ride || p.mounted || T.ctx.vehicles?.mounted) return;
  const B = c.B, free = B.seats.filter((s) => s.face && !B.used.includes(s)); const seat = free[(free.length * 0.4) | 0] || B.seats[0];
  T.ride = { c, seat, head: null, t0: performance.now() }; p.mounted = { bus: true, route: c.route.id };
  T.ctx.hud?.toast?.(`On the ${c.route.id}. Next stop: ${c.route.stops[c.nextStop].name}. ${T.world.W?.tavern ? 'Stay on three stops and it runs on to 8 Av · Soccer Tavern. ' : ''}${T.ctx.isTouch ? 'GET OFF' : 'F'} at a stop to get off.`, 4200);
  T.ctx.bus.emit('busBoard', { route: c.route.id });
}
function alightBus() {
  const R = T.ride; if (!R) return; const c = R.c, p = T.ctx.player; T.ride = null; if (p.mounted?.bus) p.mounted = null;
  busPoint(c, (BUS.doorR[0] + BUS.doorR[1]) / 2, BUS.w / 2 + 1.1, _v); p.teleport(_v.x, c.y, _v.z, c.h - Math.PI / 2, 0);
  T.ctx.hud?.toast?.(`Got off at ${c.route.stops[c.stopI ?? 0].name}`, 1800); T.ctx.bus.emit('busAlight', { route: c.route.id });
}
function riding(dt) {
  const R = T.ride; if (!R) return; const ctx = T.ctx, p = ctx.player, c = R.c;
  if (p.dead || !p.mounted?.bus) { T.ride = null; if (p.mounted?.bus) p.mounted = null; return; }
  const g = c.B.group; g.updateMatrixWorld();
  const head = c.h; if (R.head != null) p.yaw += wrap(head - R.head); R.head = head;
  const s = R.seat; _v.set(s.x, s.y, s.z).applyMatrix4(g.matrixWorld); p.position.set(_v.x, _v.y - 0.45, _v.z); p.velocity?.set?.(0, 0, 0);
  _p.set(s.x - 0.05, s.y + 0.78, s.z).applyMatrix4(g.matrixWorld); const cam = ctx.camera; cam.position.copy(_p); cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ'); p.cameraPosition?.copy?.(_p);
  const open = c.state === 'dwell' && c.doorK > 0.5;
  if (open) { ctx.actionLabel = 'GET OFF'; T.ownLabel = true; } else if (T.ownLabel) { ctx.actionLabel = null; T.ownLabel = false; }
  ctx.interactNear = true;
  if (ctx.state === 'playing' && ctx.input?.pressed?.has?.('KeyF')) { ctx.input.pressed.delete('KeyF'); if (open) { alightBus(); if (T.ownLabel) { ctx.actionLabel = null; T.ownLabel = false; } } else { ctx.hud?.toast?.(`*ding* Stop requested — next stop: ${c.route.stops[c.nextStop].name}`, 1800); } }
  if (c.state === 'jacked' || c.state === 'dead') alightBus();
}
function jackBus(c) {
  const ctx = T.ctx, veh = ctx.vehicles; if (!veh?.spawnCar || ctx.vehicles.mounted) return false;
  if (c.driver && c.state !== 'dead') pullOut(c, c.rng() < 0.25); else if (c.state === 'dead') dumpBody(c);
  c.state = 'jacked'; c.active = false; c.B.group.visible = false; if (T.busNear === c) T.busNear = null; c.hbDrv.position.set(0, -500, 0); c.hbDrv.updateMatrixWorld();
  let car = null; try { car = veh.spawnCar(c.x, c.z, c.h, 'bus', 0xffffff, 0); } catch (e) { console.warn('[traffic] bus spawn', e); }
  if (!car) return false; veh.mount(car); T.stats.jacked++;
  ctx.bus.emit('carjack', { kind: 'bus', position: [c.x, 0, c.z], driver: true }); ctx.hud?.toast?.(`HIJACKED THE ${c.route.id}`, 1600);
  return true;
}
/** MTA stop: blue-and-white sign on a pole (route bullets), glass shelter with a bench and a lit ad panel where the sidewalk allows */
function busStopProps(world, stops) {
  const signTex = (() => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#f4f5f2'; g.fillRect(0, 0, 128, 256); g.fillStyle = '#0f3d91'; g.fillRect(0, 0, 128, 70);
    g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('MTA', 64, 30); g.font = 'bold 16px Arial'; g.fillText('BUS STOP', 64, 56);
    g.fillStyle = '#0f3d91'; g.beginPath(); g.roundRect?.(30, 84, 68, 40, 6); g.fill(); g.fillStyle = '#fff'; g.fillRect(36, 92, 56, 16); g.fillStyle = '#0f3d91'; g.fillRect(40, 95, 10, 9); g.fillRect(54, 95, 10, 9); g.fillRect(68, 95, 10, 9);
    ['B36', 'B68', 'B74'].forEach((r, i) => { g.fillStyle = '#0f3d91'; g.fillRect(14, 140 + i * 36, 100, 30); g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.fillText(r, 64, 163 + i * 36); });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const vc = [], glass = [], sign = [], grid = T.G.grid, col = new THREE.Color();
  const tint = (g, hex) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); col.setHex(hex); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const bx = (x0, y0, z0, x1, y1, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; };
  for (const S of stops) {
    const ry = Math.atan2(S.dx, S.dz) + Math.PI, place = (g) => { g.rotateY(ry); g.translate(S.px, 0, S.pz); return g; };
    // local frame: +z = along the traffic, +x = away from the road (kerb side)
    vc.push(tint(place(new THREE.CylinderGeometry(0.035, 0.035, 3.0, 8).translate(0, 1.5, 3.2)), 0x6a6f74));
    for (const k of [0, Math.PI]) { const g = new THREE.PlaneGeometry(0.46, 0.92); g.rotateY(Math.PI / 2 + k); g.translate(k ? -0.01 : 0.01, 2.45, 3.2); sign.push(place(g)); }
    world.box([S.px - 0.08, 0, S.pz - 0.08], [S.px + 0.08, 3, S.pz + 0.08]);
    const sx = S.px - S.dz * 1.6, sz = S.pz + S.dx * 1.6;
    if (roadDist(sx, sz) < 1.4) continue;   // never on the carriageway (a side street's mouth)
    if (rectBlocked(grid, sx - 2.4, sz - 2.4, sx + 2.4, sz + 2.4, 0.3, 2.5)) continue;
    // shelter: 4.2 m long, back wall of glass away from the road, a roof, an ad panel at the downstream end, a bench
    const P = (g) => { g.translate(1.6, 0, 0); return place(g); };
    for (const z of [-2.05, 2.05]) for (const x of [-0.65, 0.65]) vc.push(tint(P(bx(x - 0.04, 0, z - 0.04, x + 0.04, 2.35, z + 0.04)), 0x3c4146));
    vc.push(tint(P(bx(-0.85, 2.35, -2.2, 0.85, 2.45, 2.2)), 0x3c4146)); vc.push(tint(P(bx(-0.7, 2.45, -2.1, 0.75, 2.5, 2.1)), 0x9aa0a6));
    for (const [z0, z1] of [[-2.0, -0.05], [0.05, 2.0]]) { const g = new THREE.PlaneGeometry(z1 - z0, 1.9); g.rotateY(Math.PI / 2); g.translate(0.65, 1.2, (z0 + z1) / 2); glass.push(P(g)); }
    { const g = new THREE.PlaneGeometry(1.2, 1.9); g.translate(0, 1.2, -2.05); glass.push(P(g)); }
    vc.push(tint(P(bx(-0.62, 0.3, 1.45, 0.62, 2.1, 2.0)), 0x2b2f33)); vc.push(tint(P(bx(-0.56, 0.4, 1.42, 0.56, 2.02, 1.44)), 0xf2e8c8)); vc.push(tint(P(bx(-0.56, 0.4, 2.01, 0.56, 2.02, 2.03)), 0xd8e4ee));
    vc.push(tint(P(bx(0.2, 0.44, -1.6, 0.55, 0.5, 1.2)), 0x7c8288)); for (const z of [-1.4, 1.0]) vc.push(tint(P(bx(0.35, 0, z - 0.03, 0.4, 0.44, z + 0.03)), 0x3c4146));
    const c0 = new THREE.Vector3(), c1 = new THREE.Vector3(); for (const [a, b] of [[[0.55, 0, -2.1], [0.75, 2.4, 2.1]]]) { const g = bx(...a, ...b); P(g); g.computeBoundingBox(); c0.copy(g.boundingBox.min); c1.copy(g.boundingBox.max); world.box(c0.toArray(), c1.toArray()); }
  }
  const add = (arr, mat, name) => { if (!arr.length) return; const m = new THREE.Mesh(mergeGeometries(arr, false), mat); m.name = name; m.receiveShadow = true; m.castShadow = !T.lite; world.scene.add(m); };
  add(vc, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }), 'busStops');
  add(glass, new THREE.MeshStandardMaterial({ color: 0x9fb2bc, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }), 'busStops:glass');
  add(sign, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.12 }), 'busStops:sign');
}

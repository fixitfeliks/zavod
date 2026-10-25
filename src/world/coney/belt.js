// CONEY — the Belt Parkway loop. Drive up W 8th St past Sammy's (north end, by Neptune Ave) through the green
// "BELT PKWY" gantry and you're up on an elevated loop of the parkway: three one-way lanes on a concrete viaduct (Jersey
// barriers, piers, cobra-head lights, overhead signs, traffic) about a kilometre round — ~35 s a lap flat out — over
// Brighton / Sheepshead Bay: brick walk-ups and six-storey apartment blocks, the B/Q el with a train rattling past, and the
// bay with its piers and fishing boats along Emmons Ave. It's the way round the map: on-ramps on W 8th St, at the north end
// of Stillwell Ave, at the east end of Brighton Beach Ave and off either end of 8th Ave; you join on the south straight, lap as
// long as you like and keep right through a gore to get off (EXITS: Soc Tav, W 8 St, Stillwell, Brighton). T goes home.
// The loop is its own zone far south of the map: W.zones lets players / vehicles live there without widening W.bounds; the
// deck height comes from W.groundHeight (a wrapper that knows the viaduct). Passengers are carried with the driver.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { carGeometries, carMaterials, carSpec, CAR_COLORS, wheelInstances, wheelLayout } from '../carkit.js';
import { hangkit as K } from '../hangkit.js';
import { solidSource } from '../../vehicles/solids.js';

export const ZONE = { x0: -2000, x1: 3400, z0: 11400, z1: 12700, oz: 12000 };   // world rect of the zone; local z = world z − oz
const CX = 900, LS = 300, R = 72, DECK = 9;                                      // loop centre (local x), straight length, bend radius, deck height
const LANES = 3, LW = 3.6, SH = 1.2, ROAD = LANES * LW + SH * 2;                 // 13.2 m deck between barriers
const PER = 2 * LS + 2 * Math.PI * R;                                            // ≈ 1052 m round
const NS = LS + Math.PI * R, ENTRY = 15, EXIT_L = 45;                           // north straight start, where every on-ramp merges (south straight), gore length
// the exits, in the order you meet them from ENTRY: keep right through the gore (s .. s + EXIT_L) and you're off at `to`
const EXITS = [
  { id: '7A', s: 175, to: 'brighton', lines: ['BRIGHTON BEACH AV', 'CONEY ISLAND AV'] },
  { id: '7B', s: NS + 60, to: 'tavern', lines: ['GOWANUS EXPWY · 8 AV', 'SUNSET PARK · SOCCER TAVERN'] },
  { id: '6', s: NS + 150, to: 'coney', lines: ['W 8 ST · NEPTUNE AV', 'CONEY ISLAND · LUNA PARK'] },
  { id: '5', s: NS + 240, to: 'stillwell', lines: ['STILLWELL AV · SURF AV', 'CONEY ISLAND · BOARDWALK'] },
];
// where each exit leaves you, on the street heading away from the ramp (heading: velocity is (-sin h, -cos h))
const DEST = { coney: { x: 404, z: -522, h: Math.PI, name: 'EXIT 6 · W 8 ST' }, stillwell: { x: -40, z: -121, h: -Math.PI / 2, name: 'EXIT 5 · STILLWELL AV' },
  brighton: { x: 2300, z: -43.5, h: Math.PI / 2, name: 'EXIT 7A · BRIGHTON BEACH AV' } };
// the on-ramps on the street: drive into the trigger rect. g: the gantry over the road (x, z, and 'x' = it spans along x)
const RAMPS = [
  { id: 'coney', x0: 394, x1: 420, z0: -560, z1: -541, g: { x: 407, z: -536, span: 'x' }, lines: ['BELT PKWY ↑', 'ALL EXITS · SOC TAV · BRIGHTON'] },
  { id: 'stillwell', x0: -104, x1: -88, z0: -559, z1: -547, g: { x: -96, z: -544, span: 'x' }, lines: ['BELT PKWY ↑', 'VERRAZZANO BR · 8 AV · BRIGHTON'] },
  { id: 'brighton', x0: 2338, x1: 2369, z0: -50, z1: -30, g: { x: 2332, z: -40, span: 'z' }, lines: ['BELT PKWY →', 'CONEY ISLAND · 8 AV · SOC TAV'] },
];
const RAMP = RAMPS[0];

let Z = null;

/** the loop centreline by arc length s (local x/z): { x, z, tx, tz } — travel is +x along the south straight (z = +R) */
function at(s) {
  s = ((s % PER) + PER) % PER; const h = LS / 2, A = Math.PI * R;
  if (s < LS) return { x: CX - h + s, z: R, tx: 1, tz: 0 };
  s -= LS; if (s < A) { const th = Math.PI / 2 - s / R; return { x: CX + h + R * Math.cos(th), z: R * Math.sin(th), tx: Math.sin(th), tz: -Math.cos(th) }; }
  s -= A; if (s < LS) return { x: CX + h - s, z: -R, tx: -1, tz: 0 };
  s -= LS; const th = -Math.PI / 2 - s / R; return { x: CX - h + R * Math.cos(th), z: R * Math.sin(th), tx: Math.sin(th), tz: -Math.cos(th) };
}
/** signed distance from the centreline (+ = outside / right of travel) and the arc length there */
function project(x, z) {
  const h = LS / 2, dx = x - CX;
  if (Math.abs(dx) <= h) return z >= 0 ? { d: z - R, s: dx + h } : { d: -z - R, s: LS + Math.PI * R + (h - dx) };
  const cx = Math.sign(dx) * h, r = Math.hypot(dx - cx, z), th = Math.atan2(z, dx - cx);
  if (dx > 0) return { d: r - R, s: LS + (Math.PI / 2 - th) * R };
  let t = -Math.PI / 2 - th; while (t < 0) t += Math.PI * 2; return { d: r - R, s: 2 * LS + Math.PI * R + t * R };
}
const right = (p) => ({ x: -p.tz, z: p.tx });   // right-hand normal (outside of the loop)

export function buildBelt(world) {
  const { ctx, W, scene } = world;
  (W.zones || (W.zones = [])).push({ x0: ZONE.x0, x1: ZONE.x1, z0: ZONE.z0, z1: ZONE.z1, name: 'BELT PKWY WEST', hint: 'Keep right for your exit · T → Coney' });
  { const gh = W.groundHeight; W.groundHeight = (x, z) => {
      if (z > ZONE.z0 - 50 && z < ZONE.z1 + 50 && x > ZONE.x0 - 50 && x < ZONE.x1 + 50) { const q = project(x, z - ZONE.oz); return Math.abs(q.d) < ROAD / 2 + 0.2 ? DECK : 0; }   // the viaduct deck, the streets below
      return gh ? gh(x, z) : 0; }; }
  const root = new THREE.Group(); root.name = 'beltLoop'; root.position.set(0, 0, ZONE.oz); scene.add(root);
  Z = { world, ctx, root, traffic: [], t: 0, busy: false, lastTrip: -9, trains: [] };
  const M = mats();
  const G = new Map(); const put = (m, g) => (G.get(m) || G.set(m, []).get(m)).push(g.index ? g.toNonIndexed() : g);
  const wbox = (x0, y0, z0, x1, y1, z1) => world.box([Math.min(x0, x1), y0, Math.min(z0, z1) + ZONE.oz], [Math.max(x0, x1), y1, Math.max(z0, z1) + ZONE.oz]);
  const rnd = mulberry(7);

  // ---- the viaduct: deck ribbon, fascia, barriers (colliders), piers, lights --------------------------------------------------
  const pts = []; for (let s = 0; s <= PER + 0.01; s += 4) pts.push(at(s));
  const ribbon = (o0, o1, y, vRep = 12) => {
    const pos = [], uv = [], idx = [];
    pts.forEach((p, i) => { const r = right(p); pos.push(p.x + r.x * o0, y, p.z + r.z * o0, p.x + r.x * o1, y, p.z + r.z * o1); uv.push(0, i * 4 / vRep, 1, i * 4 / vRep); if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { g.index.array.reverse(); g.computeVertexNormals(); } return g;
  };
  const wall = (o, y0, y1) => {   // a vertical strip along the loop at offset o
    const pos = [], uv = [], idx = []; pts.forEach((p, i) => { const r = right(p); pos.push(p.x + r.x * o, y0, p.z + r.z * o, p.x + r.x * o, y1, p.z + r.z * o); uv.push(i * 4 / 6, 0, i * 4 / 6, 1); if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  put(M.road, ribbon(-ROAD / 2, ROAD / 2, DECK + 0.02));
  put(M.deckUnder, ribbon(ROAD / 2 + 0.6, -ROAD / 2 - 0.6, DECK - 1.1, 40));                  // underside
  for (const o of [-ROAD / 2 - 0.6, ROAD / 2 + 0.6]) { const g = wall(o, DECK - 1.1, DECK + 0.02); put(M.concrete, g); const g2 = g.clone(); g2.index.array.reverse(); g2.computeVertexNormals(); put(M.concrete, g2); }   // fascia
  // Jersey barriers both sides (visual strips + collider cells every 3 m)
  for (const o of [-ROAD / 2 - 0.3, ROAD / 2 + 0.3]) {
    for (const oo of [o - 0.28, o + 0.28]) { const g = wall(oo, DECK, DECK + 1.05); put(M.concrete, g); const g2 = g.clone(); g2.index.array.reverse(); g2.computeVertexNormals(); put(M.concrete, g2); }
    const top = ribbon(o - 0.28, o + 0.28, DECK + 1.05); put(M.concrete, top);
    for (let s = 0; s < PER; s += 3) { if (o > 0 && EXITS.some((e) => s > e.s - 2 && s < e.s + EXIT_L)) continue;   // the exit gores open the outside barrier
      const p = at(s), r = right(p), x = p.x + r.x * o, z = p.z + r.z * o; wbox(x - 0.45, DECK, z - 0.45, x + 0.45, DECK + 1.1, z + 0.45); }
  }
  // exit ramp: a short spur curving off the outside of the north straight, dropping away (the trigger sends you home)
  for (const { s: ES } of EXITS) { const p0 = at(ES), r = right(p0); const g = new THREE.BufferGeometry(); const pos = [], idx = [];
    for (let i = 0; i <= 12; i++) { const k = i / 12, s = ES + k * EXIT_L, p = at(s), rr = right(p), off = ROAD / 2 + k * k * 14, y = DECK + 0.03 - k * k * 3;
      pos.push(p.x + rr.x * (off - 5), y, p.z + rr.z * (off - 5), p.x + rr.x * (off + 4), y, p.z + rr.z * (off + 4)); if (i) { const q = i * 2; idx.push(q - 2, q, q - 1, q - 1, q, q + 1); } }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2)); g.setIndex(idx); g.computeVertexNormals(); if (g.attributes.normal.getY(0) < 0) { g.index.array.reverse(); g.computeVertexNormals(); } put(M.asphalt, g); void r; }
  // piers every 24 m: a column + a hammerhead cap under the deck
  for (let s = 6; s < PER; s += 24) { const p = at(s), ang = Math.atan2(p.tz, p.tx);
    const col = new THREE.BoxGeometry(1.6, DECK - 1.1, 1.6); col.translate(p.x, (DECK - 1.1) / 2, p.z); put(M.concrete, col);
    const cap = new THREE.BoxGeometry(1.8, 1.0, ROAD); cap.rotateY(-ang); cap.translate(p.x, DECK - 1.6, p.z); put(M.concrete, cap); }
  // cobra-head lights on the outside barrier every 45 m
  for (let s = 10; s < PER; s += 45) { const p = at(s), r = right(p), x = p.x + r.x * (ROAD / 2 + 0.4), z = p.z + r.z * (ROAD / 2 + 0.4);
    const pl = new THREE.CylinderGeometry(0.1, 0.14, 9, 8); pl.translate(x, DECK + 5.5, z); put(M.steel, pl);
    const arm = new THREE.BoxGeometry(0.12, 0.12, 3); arm.rotateY(Math.atan2(r.x, r.z)); arm.translate(x - r.x * 1.4, DECK + 10, z - r.z * 1.4); put(M.steel, arm);
    const hd = new THREE.BoxGeometry(0.7, 0.18, 0.4); hd.translate(x - r.x * 2.8, DECK + 9.9, z - r.z * 2.8); put(M.lamp, hd); }
  // overhead sign gantries
  const gantry = (s, lines) => { const p = at(s), r = right(p), ang = Math.atan2(p.tx, p.tz);
    for (const o of [-ROAD / 2 - 0.6, ROAD / 2 + 0.6]) { const c = new THREE.BoxGeometry(0.35, 7.5, 0.35); c.translate(p.x + r.x * o, DECK + 3.75, p.z + r.z * o); put(M.steel, c); }
    const bm = new THREE.BoxGeometry(ROAD + 1.6, 0.4, 0.4); bm.rotateY(ang + Math.PI / 2); bm.translate(p.x, DECK + 7.3, p.z); put(M.steel, bm);
    const pn = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.75), new THREE.MeshStandardMaterial({ map: signTex(lines), emissive: 0xffffff, emissiveMap: signTex(lines), emissiveIntensity: 0.12 }));
    pn.position.set(p.x + r.x * 2, DECK + 6.2, p.z + r.z * 2); pn.rotation.y = Math.atan2(-p.tx, -p.tz); root.add(pn); };
  gantry(ENTRY + 25, ['BELT PKWY WEST', 'EXITS ' + EXITS.map((e) => e.id).join(' · ')]);
  for (const e of EXITS) { gantry(e.s - 12, [`EXIT ${e.id} ↘`, e.lines[0]]); gantry(e.s - 75, [`EXIT ${e.id} · ${e.lines[0]}`, `${e.lines[1]} · KEEP RIGHT ↘`]); }

  // ---- below: Brighton / Sheepshead Bay ------------------------------------------------------------------------------------
  const BAY_Z = R + 120;   // the bay starts south of the loop
  { const g = new THREE.PlaneGeometry(2600, 900 + BAY_Z); g.rotateX(-Math.PI / 2); g.translate(CX, 0, (-900 + BAY_Z) / 2); put(M.streets, g); }   // streets end at the bay
  { const g = new THREE.PlaneGeometry(2600, 700); g.rotateX(-Math.PI / 2); g.translate(CX, -0.6, BAY_Z + 350); put(M.water, g); }
  { const g = new THREE.BoxGeometry(2600, 0.9, 10); g.translate(CX, -0.1, BAY_Z - 3); put(M.concrete, g); }                   // Emmons Ave bulkhead / promenade
  for (let i = 0; i < 9; i++) { const x = CX - 560 + i * 140 + rnd() * 30, L = 60 + rnd() * 50;                                // piers + fishing boats
    const pr = new THREE.BoxGeometry(4, 0.5, L); pr.translate(x, 0.2, BAY_Z + L / 2); put(M.wood, pr);
    for (let k = 0; k < 4; k++) for (const sd of [-1, 1]) { if (rnd() < 0.35) continue; const bz = BAY_Z + 12 + k * (L / 4), bx = x + sd * 6;
      const hull = new THREE.BoxGeometry(3.2, 1.4, 11 + rnd() * 5); hull.translate(bx, 0.1, bz); put(M.hull, hull);
      const cab = new THREE.BoxGeometry(2.4, 1.8, 3.5); cab.translate(bx, 1.7, bz - 1.5); put(M.cabin, cab); } }
  // blocks: a street grid; walk-ups + six-storey brick apartment blocks, none under the viaduct
  const houses = [], tall = [], trees = [];
  for (let bx = CX - 1250; bx < CX + 1250; bx += 90) for (let bz = -560; bz < BAY_Z - 20; bz += 70) {
    const inner = Math.abs(project(bx + 45, bz + 35).d) < 22; if (inner) continue;
    const apt = rnd() < (Math.abs(bx - CX) < 500 ? 0.35 : 0.15);
    if (apt) { const w = 60 + rnd() * 18, d = 44 + rnd() * 10, h = 17 + rnd() * 5; const x = bx + 45, z = bz + 35; if (Math.abs(project(x, z).d) > 34) tall.push([x, z, w, h, d]); continue; }
    for (const [z0, sd] of [[bz + 8, 1], [bz + 62, -1]]) for (let x = bx + 6; x < bx + 84; x += 7 + rnd() * 2) {
      const h = 7 + rnd() * 4, d = 12 + rnd() * 4, z = z0 + sd * d / 2; if (Math.abs(project(x, z).d) < 16) continue; houses.push([x, z, 6.4, h, d]); }
    for (let x = bx + 4; x < bx + 88; x += 12) if (rnd() < 0.5 && Math.abs(project(x, bz + 1).d) > 12) trees.push([x, bz + 1]);
  }
  const inst = (geo, mat, list, fn) => { const m = new THREE.InstancedMesh(geo, mat, list.length); const o = new THREE.Object3D(); const c = new THREE.Color();
    list.forEach((q, i) => { fn(o, q); o.updateMatrix(); m.setMatrixAt(i, o.matrix); c.setHSL(0.03 + rnd() * 0.06, 0.25 + rnd() * 0.25, 0.32 + rnd() * 0.22); m.setColorAt(i, c); });
    m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; root.add(m); return m; };
  const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
  inst(unit, M.rowhouse, houses, (o, [x, z, w, h, d]) => { o.position.set(x, 0, z); o.scale.set(w, h, d); });
  inst(unit, M.brick, tall, (o, [x, z, w, h, d]) => { o.position.set(x, 0, z); o.scale.set(w, h, d); });
  { const cone = new THREE.ConeGeometry(2.6, 7, 7); cone.translate(0, 6.5, 0); const t = new THREE.InstancedMesh(cone, M.tree, trees.length); const o = new THREE.Object3D();
    trees.forEach(([x, z], i) => { o.position.set(x, 0, z); o.scale.setScalar(0.8 + rnd() * 0.5); o.updateMatrix(); t.setMatrixAt(i, o.matrix); }); root.add(t); }
  // the B/Q el along the north side, with a train going by
  { const ez = -R - 120;
    for (let x = CX - 1250; x < CX + 1250; x += 18) for (const dz of [-3.5, 3.5]) { const c = new THREE.BoxGeometry(0.6, 8, 0.6); c.translate(x, 4, ez + dz); put(M.elGreen, c); }
    const deck = new THREE.BoxGeometry(2500, 1.1, 9); deck.translate(CX, 8.4, ez); put(M.elGreen, deck);
    const tr = new THREE.Group(); for (let k = 0; k < 6; k++) { const car = new THREE.Mesh(new THREE.BoxGeometry(18.5, 3.4, 3), M.trainSteel); car.position.set(k * 19, 10.7, 0); car.castShadow = true; tr.add(car);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.35, 3.05), M.trainStripe); stripe.position.set(k * 19, 11.4, 0); tr.add(stripe); }
    tr.position.set(CX - 1200, 0, ez - 1.8); root.add(tr); Z.trains.push({ m: tr, x0: CX - 1300, x1: CX + 1300 }); }

  for (const [m, list] of G) { const merged = mergeGeometries(list, false); if (!merged) { console.warn('[belt] merge failed', m.name || m.color?.getHexString?.()); continue; } const mesh = new THREE.Mesh(merged, m); mesh.castShadow = m !== M.water && m !== M.streets; mesh.receiveShadow = true; root.add(mesh); }

  // ---- traffic: a dozen cars lapping in the three lanes ----
  { const n = ctx.safeMode ? 4 : ctx.lite ? 8 : 16; for (let i = 0; i < n; i++) { const k = (i * 7) % 10, kind = k < 3 ? 'sedan' : k < 4 ? 'bmw-m4' : k < 6 ? 'suv' : k < 8 ? 'cab' : 'van';
      Z.traffic.push({ kind, p: new THREE.Vector3(), lane: i % 3, s: (i * PER / n + (i % 3) * 23) % PER, v: 19 + (i % 5) * 2.4,
        color: kind === 'cab' ? new THREE.Color(i % 3 ? 0xf2b820 : 0x8cd04a) : kind === 'van' ? new THREE.Color(0xf2f2ee) : CAR_COLORS[(i * 5) % CAR_COLORS.length] }); }
    Z.carIM = trafficMeshes(root, Z.traffic, !ctx.lite);
    // #182 left the Belt out of the shared solids grid: the loop has its own lane-following avoidance (c.v vs. the gap
    // ahead, above), but publish the cars too so anyone else's solids query (the Uber, a future AI driver up here) sees them
    solidSource('belt', () => Z.traffic.filter((c) => !c.jacked).map((c) => { const K2 = carSpec(c.kind); return { x: c.p.x, z: c.p.z, h: c.yaw || 0, hl: K2.len / 2, hw: K2.w / 2, v: c.v }; })); }

  // ---- the on-ramp gantries on the street (W 8th St, Stillwell Ave, Brighton Beach Ave), and a pin on the map for each ----
  for (const r of RAMPS) { const { x, z, span } = r.g, along = span === 'x', tex = signTex(r.lines);
    for (const d of [-11, 11]) { const px = along ? x + d : x, pz = along ? z : z + d; const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.2, 0.4), M.steel); p2.position.set(px, 3.6, pz); scene.add(p2); world.box([px - 0.3, 0, pz - 0.3], [px + 0.3, 7.2, pz + 0.3]); }
    const bm = new THREE.Mesh(new THREE.BoxGeometry(along ? 22 : 0.35, 0.35, along ? 0.35 : 22), M.steel); bm.position.set(x, 7.0, z); scene.add(bm);
    const pn = new THREE.Mesh(new THREE.PlaneGeometry(9, 3), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }));
    if (along) pn.position.set(x, 6.1, z + 0.25); else { pn.position.set(x - 0.25, 6.1, z); pn.rotation.y = -Math.PI / 2; } scene.add(pn);
    if (r.id !== 'coney') (W.mapPOIs || (W.mapPOIs = [])).push({ name: 'BELT PKWY ↑', x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, kind: 'road' }); }

  Z.jackPos = new THREE.Vector3(1e6, 0, 0);
  K.spot({ pos: Z.jackPos, r: 3.6, dy: 2.5, when: () => !!Z.jackable, prompt: 'F — PULL THE DRIVER OUT', act: () => Z.jackable && jack(Z.jackable) });
  world.updaters.push((dt) => { if (Z?.world === world) update(dt); });
  W.belt = { enter: () => enter(), exit: () => exit() };   // tavern.js: drive off either end of 8th Ave onto the loop
  if (typeof window !== 'undefined' && window.__game) window.__game.belt = { enter: () => enter(), exit: () => exit(), state: () => ({ inZone: inZone(ctx.player.position), t: +Z.t.toFixed(1) }), ramp: RAMP, ramps: RAMPS, zone: ZONE, at: (s, off = 0) => { const p = at(s), r = right(p); return [p.x + r.x * off, DECK, p.z + r.z * off + ZONE.oz, Math.atan2(-p.tx, -p.tz)]; }, exits: EXITS, dest: DEST, traffic: () => Z.traffic.map((c) => ({ s: +c.s.toFixed(1), v: +c.v.toFixed(1), lane: c.lane, jacked: !!c.jacked, p: [+c.p.x.toFixed(1), +c.p.z.toFixed(1)] })), jackable: () => !!Z.jackable, jack: () => !!(Z.jackable && (jack(Z.jackable), true)), entry: ENTRY, lane: (l) => -ROAD / 2 + SH + LW * (l + 0.5), per: PER, deck: DECK };
  console.log('[belt] elevated loop built', Math.round(PER), 'm');
}

// ---------------------------------------------------------------------------------------------------------------------------
const inZone = (p) => p.z > ZONE.z0 && p.z < ZONE.z1 && p.x > ZONE.x0 && p.x < ZONE.x1;
function update(dt) {
  Z.t += dt; const { ctx } = Z; const p = ctx.player; const now = performance.now() / 1000;
  // car following: anything in a car's lane ahead (another car, your car, you on foot, a car left on the deck) slows it to a stop
  // a few metres short, so it queues behind you; a hit car stalls, then pulls away again
  const mvv = ctx.vehicles?.mounted, obs = [], laneOf = (d) => (d + ROAD / 2 - SH) / LW - 0.5;
  const addObs = (pos) => { if (!inZone(pos) || Math.abs(pos.y - DECK) > 2.5) return; const q = project(pos.x, pos.z - ZONE.oz); if (Math.abs(q.d) < ROAD / 2 + 0.5) obs.push({ s: q.s, lane: laneOf(q.d) }); };
  if (p && !p.dead) addObs(mvv ? mvv.pos : p.position);
  for (const v of ctx.vehicles?.list || []) if (v !== mvv && v.parked) addObs(v.pos);
  for (const c of Z.traffic) if (!c.jacked) obs.push({ s: c.s, lane: c.lane, car: c });
  for (const c of Z.traffic) { if (c.jacked) { c.respawnT -= dt; if (c.respawnT <= 0 && !inZone(p.position)) { c.jacked = false; c.v = c.v0; } continue; }
    c.v0 = c.v0 || c.v; let gap = 1e9; for (const o of obs) { if (o.car === c || Math.abs(o.lane - c.lane) > 0.8) continue; const ds = ((o.s - c.s) % PER + PER) % PER; if (ds < gap) gap = ds; }
    const want = gap < 45 ? Math.max(0, Math.min(c.v0, (gap - 7) * 0.9)) : c.v0; c.v += want > c.v ? Math.min(4 * dt, want - c.v) : Math.max(-10 * dt, want - c.v);
    c.s = (c.s + c.v * dt) % PER; const q = at(c.s), r = right(q), off = -ROAD / 2 + SH + LW * (c.lane + 0.5);
    c.p.set(q.x + r.x * off, DECK, q.z + r.z * off + ZONE.oz); c.yaw = Math.atan2(-q.tx, -q.tz);
    const mv = ctx.vehicles?.mounted; if (mv?.pos && mv.spec?.car !== undefined) { const dx = mv.pos.x - c.p.x, dz = mv.pos.z - c.p.z, d = Math.hypot(dx, dz);   // traffic is solid: crash into it
      if (d < 2.7 && Math.abs(mv.pos.y - DECK) < 2.5) { const nx = dx / (d || 1), nz = dz / (d || 1), push = 2.7 - d; mv.pos.x += nx * push; mv.pos.z += nz * push;
        const vn = mv.vel.x * nx + mv.vel.z * nz; if (vn < 0) { mv.vel.x -= 1.6 * vn * nx; mv.vel.z -= 1.6 * vn * nz; mv.vel.multiplyScalar(0.55); }
        if (!c.hitT || now - c.hitT > 0.8) { c.hitT = now; c.v *= 0.15; try { ctx.audio?.play?.('impact', { position: c.p, volume: 1.2 }); } catch {} try { ctx.audio?.play?.('glass', { position: c.p, volume: 0.8 }); } catch {} } } } }
  for (const c of Z.traffic) if (c.jacked) c.p.set(0, -500, 0);   // a jacked car's slot is out of sight until it comes back
  if (Z.carIM) Z.carIM(Z.traffic, dt);
  // on foot by a stopped (or crawling) car: F pulls the driver out and it's yours
  Z.jackable = null; if (!mvv && p && !p.dead && inZone(p.position)) { let bd = 3.6; for (const c of Z.traffic) { if (c.jacked || c.v > 2.5) continue; const d = Math.hypot(c.p.x - p.position.x, c.p.z - p.position.z); if (d < bd) { bd = d; Z.jackable = c; } } }
  if (Z.jackable) Z.jackPos.set(Z.jackable.p.x, p.position.y, Z.jackable.p.z); else Z.jackPos.set(1e6, 0, 0);
  for (const T of Z.trains) { const L = T.x1 - T.x0, k = ((Date.now() / 1000) * 14) % (L * 2); T.m.position.x = k < L ? T.x0 + k : T.x1 - (k - L); T.m.visible = true; }   // wall clock: friends see the same train
  if (!p || p.dead || now - Z.lastTrip < 3) return;
  const v = ctx.vehicles?.mounted, here = v ? v.pos : p.position;
  if (inZone(here) && ctx.state === 'playing' && ctx.input?.pressed?.has?.('KeyT')) { ctx.input.pressed.delete('KeyT'); exit(); return; }
  if (!inZone(here)) Z.next = null;
  if (v && !Z.busy && RAMPS.some((r) => v.pos.x > r.x0 && v.pos.x < r.x1 && v.pos.z > r.z0 && v.pos.z < r.z1)) enter();   // an on-ramp
  if (!Z.busy && inZone(here)) { const q = project(here.x, here.z - ZONE.oz);
    // the next exit ahead, on the HUD when it changes (and the distance to it)
    const nx = EXITS.reduce((b, e) => { const d = ((e.s - q.s) % PER + PER) % PER; return !b || d < b.d ? { e, d } : b; }, null);
    if (nx && Z.next !== nx.e) { Z.next = nx.e; ctx.hud?.toast?.(`NEXT: EXIT ${nx.e.id} · ${nx.e.lines[0]} · ${Math.round(nx.d)} m — keep right (T: Coney)`, 3200); }
    const off = EXITS.find((e) => q.d > 2.2 && q.s > e.s && q.s < e.s + EXIT_L);   // right lane through a gore = off you go
    if (off) takeExit(off.to, now); }
}
function takeExit(to, now) {
  if (to === 'tavern') { if (!Z.world.W.tavern) return; Z.busy = true; Z.lastTrip = now; Z.world.W.tavern.arrive('belt'); setTimeout(() => { Z.busy = false; }, 4000); return; }
  const D = DEST[to], sp = Math.max(10, Math.abs(Z.ctx.vehicles?.mounted?.fwdSpeed || 0) * 0.6);
  fade(D.name, () => moveTo(D.x, 0, D.z, D.h, Z.ctx.vehicles?.mounted ? sp : 0));
}
/** pull the driver out of a Belt traffic car: a real car of the same kind and colour takes its place and you're at the wheel */
function jack(c) {
  const V = Z.ctx.vehicles; if (!V || V.mounted || c.jacked) return;
  const car = V.spawnCar(c.p.x, c.p.z, c.yaw, c.kind, c.color.getHex(), DECK); if (!car) return;
  car.jacked = true; c.jacked = true; c.respawnT = 60; c.v = 0;
  V.mount(car); Z.ctx.hud?.toast?.('You pulled the driver out — it\'s yours', 2200);
}
function moveTo(x, y, z, h, speed) {
  const { ctx } = Z; const v = ctx.vehicles?.mounted, p = ctx.player;
  if (v) { v.pos.set(x, y, z); v.heading = h; v.vel.set(-Math.sin(h) * speed, 0, -Math.cos(h) * speed); v.vy = 0; v.air = false; if (v.group) { v.group.position.copy(v.pos); v.group.rotation.y = h; } }
  else p.teleport(x, y, z, h, 0);
}
function fade(text, fn) {
  Z.busy = true; Z.lastTrip = performance.now() / 1000;
  const f = document.querySelector('.hgfade'), fl = document.querySelector('.hgfloor');
  if (f) { f.classList.remove('car'); f.style.transition = 'opacity .35s'; f.style.opacity = '1'; }
  setTimeout(() => { try { fn(); } catch (e) { console.warn('[belt]', e); } if (fl) { fl.style.fontSize = '44px'; fl.textContent = text; }
    setTimeout(() => { if (f) f.style.opacity = '0'; if (fl) fl.textContent = ''; setTimeout(() => { if (f) { f.style.transition = ''; fl && (fl.style.fontSize = ''); } Z.busy = false; }, 400); }, 900); }, 380);
}
function enter() { const sp = Math.max(18, Math.abs(Z.ctx.vehicles?.mounted?.fwdSpeed || 0)); Z.next = null; fade('BELT PKWY WESTBOUND', () => { const q = at(ENTRY), r = right(q), off = -ROAD / 2 + SH + LW * 1.5; moveTo(q.x + r.x * off, DECK, q.z + r.z * off + ZONE.oz, Math.atan2(-q.tx, -q.tz), sp); }); }   // the middle lane
function exit() { takeExit('coney', performance.now() / 1000); }

// ---------------------------------------------------------------------------------------------------------------------------
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw, rep = null) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); } return t; }
function signTex(lines, bg = '#0f6b3a') {
  return canvasTex(512, 176, (g) => { g.fillStyle = bg; g.fillRect(0, 0, 512, 176); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(8, 8, 496, 160);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; const hh = 150 / lines.length;
    lines.forEach((t, i) => { let fs = i === 0 ? 50 : 40; do { g.font = `700 ${fs}px Arial`; fs -= 2; } while (g.measureText(t).width > 470); g.fillText(t, 256, 13 + hh * (i + 0.5)); }); });
}
function roadTex() {
  const t = canvasTex(256, 512, (g) => { g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 5000; i++) { const v = 40 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 2},0.5)`; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
    const px = (m) => m / ROAD * 256; g.fillStyle = '#e8c33a'; g.fillRect(px(SH) - 3, 0, 5, 512); g.fillStyle = '#ecece6'; g.fillRect(px(ROAD - SH) - 2, 0, 5, 512);
    for (let l = 1; l < LANES; l++) for (let y = 0; y < 512; y += 128) g.fillRect(px(SH + l * LW) - 2, y, 4, 54); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function streetTex() {   // Brighton from above: asphalt streets on a 90 × 70 m grid, sidewalks, backyards
  return canvasTex(512, 512, (g) => { g.fillStyle = '#5f6b4a'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${60 + Math.random() * 40},${70 + Math.random() * 40},50,0.4)`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
    g.fillStyle = '#b7b3aa'; g.fillRect(0, 0, 512, 60); g.fillRect(0, 0, 60, 512);
    g.fillStyle = '#3b3c3e'; g.fillRect(0, 0, 512, 44); g.fillRect(0, 0, 44, 512);
    g.fillStyle = '#d8d2b8'; for (let x = 60; x < 512; x += 40) g.fillRect(x, 20, 20, 3); for (let y = 60; y < 512; y += 40) g.fillRect(20, y, 3, 20); }, [2600 / 90, 1200 / 70]);
}
function windowsTex(base, rep = [1, 1]) {   // brick walk-up / apartment facade: rows of windows, a cornice
  return canvasTex(128, 256, (g) => { g.fillStyle = base; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * 128, Math.random() * 256, 4, 2); }
    g.fillStyle = '#e2ddd0'; g.fillRect(0, 0, 128, 10);
    for (let y = 26; y < 250; y += 38) for (let x = 12; x < 120; x += 28) { g.fillStyle = '#1d2530'; g.fillRect(x, y, 14, 22); g.fillStyle = '#d9d4c6'; g.fillRect(x - 1, y + 22, 16, 3); } }, rep);
}
function mats() {
  const S = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  return {
    road: new THREE.MeshStandardMaterial({ map: roadTex(), roughness: 0.85 }), asphalt: S(0x3c3d40, 0.9), concrete: S(0xb3aea4, 0.9), deckUnder: S(0x77746e, 0.95),
    steel: S(0x8d9296, 0.45, 0.7), lamp: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.6 }),
    streets: new THREE.MeshStandardMaterial({ map: streetTex(), roughness: 0.95 }), water: new THREE.MeshStandardMaterial({ color: 0x2b5463, roughness: 0.12, metalness: 0.15 }),
    wood: S(0x6e5a44, 0.9), hull: S(0xf0f0ec, 0.5), cabin: S(0x2d5d8a, 0.5), tree: S(0x3b5a2a, 1),
    rowhouse: new THREE.MeshStandardMaterial({ map: windowsTex('#9a6a52'), roughness: 0.9 }), brick: new THREE.MeshStandardMaterial({ map: windowsTex('#8a4a3a', [5, 2]), roughness: 0.9 }),
    elGreen: S(0x3f5a47, 0.7, 0.3), trainSteel: S(0xb9bec4, 0.35, 0.8), trainStripe: S(0xe0b422, 0.5, 0.2),
  };
}
/** the loop's traffic as instanced carkit cars (one draw per kind × material slot); returns the per-frame matrix update */
function trafficMeshes(root, cars, shadows) {
  const CM = carMaterials(), SLOTS = ['paint', 'glass', 'trim', 'lampW', 'lampR', 'plate', 'shadow'], ims = {}, ONE = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
  for (const kind of new Set(cars.map((c) => c.kind))) { const list = cars.filter((c) => c.kind === kind), G = carGeometries(kind, { wheels: false }).geos; list.forEach((c, i) => { c.slot = i; }); ims[kind] = [];
    for (const slot of SLOTS) { const mat = slot === 'glass' ? CM.glass : CM[slot]; if (!G[slot] || !mat) continue; const im = new THREE.InstancedMesh(G[slot], mat, list.length); im.name = `beltTraffic:${kind}:${slot}`; im.frustumCulled = false; im.castShadow = shadows && slot === 'paint';
      if (slot === 'paint') list.forEach((c, i) => im.setColorAt(i, c.color)); if (slot === 'shadow') im.renderOrder = 1; root.add(im); ims[kind].push(im); } }
  // root sits at ZONE.oz: the cars' positions are world, so the matrices go in root-local
  const wheels = wheelInstances(root, cars.length * 4, 'beltTraffic:wheels'), LAY = {}; for (const c of cars) LAY[c.kind] = LAY[c.kind] || wheelLayout(c.kind);   // kit wheels that roll
  return (list, dt = 0) => { list.forEach((c, i) => { _q.setFromAxisAngle(_y, c.yaw + Math.PI / 2); _m.compose(_p.set(c.p.x, c.p.y, c.p.z - ZONE.oz), _q, ONE); for (const im of ims[c.kind]) im.setMatrixAt(c.slot, _m);
      const L = LAY[c.kind]; c.spin = (c.spin || 0) + c.v * dt / L.r; L.wheels.forEach((w, k) => wheels.set(i * 4 + k, _m, w, c.spin, 0, L.r)); });
    for (const k in ims) for (const im of ims[k]) im.instanceMatrix.needsUpdate = true; wheels.commit(); };
}

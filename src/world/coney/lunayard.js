// CONEY: the Luna Park Houses yard, after the aerials. The long OSM footways between the towers become two-sided boulevards
// (a paved walk on each side of a planted median: grass on a kerb, plane trees, round shrubs, a low hoop fence with crossing
// gaps, benches facing the walks), and the plaza between building 1 and W 12 St (toward the Stillwell terminal) gets its
// flagpole, plane trees, a clipped shrub, bins and benches. Everything is merged into housing.js's ground batch; trees join
// its instanced plane trees, shrubs are one InstancedMesh. Owned by: LUNA HOUSING agent.
import * as THREE from 'three';
import { OSM } from './osm.js';
import { bbox, pip, segDist } from '../osmkit.js';
import { W8 } from './w8th.js';

const AREA = { x0: 60, x1: 400, z0: -540, z1: -100 };   // the Luna Park Houses superblock (W 12 St .. W 8 St, Neptune .. Surf)
// footways at least this long become boulevards; [min length m, median half-width, walk width]: wide promenade, medium, narrow
const BOULEVARD = [[300, 2.4, 3.6], [180, 1.8, 3.0], [115, 1.2, 2.6]];
const MIN_SEG = 12;           // shorter footway legs (the wiggles round the courts) stay plain paths
const FENCE_H = 0.5, FENCE_RUN = 11, FENCE_GAP = 3.2;   // low hoop fence: runs with a crossing gap between
const TREE_STEP = 10, KERB = 0.14;
const PLAZA = { w: 20, d: 16 };
const STATION_CLEAR = 30;   // no boulevard fences across the W 8 St station's stair landings and street exits   // the paved plaza between building 1 and W 12 St (ref 05)

const len = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };
const inArea = ([x, z]) => x > AREA.x0 && x < AREA.x1 && z > AREA.z0 && z < AREA.z1;

/** towers: [{ m: Matrix4 local->world, parts: [{x0,x1,z0,z1}] }]. Returns the yard plan: boulevard pieces, the plaza, and
 *  noLawn(x, z) for housing.js's lawn grid. Every piece is checked clear of the towers, other buildings, roads and lots. */
export function planYard(towers) {
  const inv = towers.map((t) => ({ mi: t.m.clone().invert(), parts: t.parts }));
  const v = new THREE.Vector3();
  const nearTower = (x, z, pad) => inv.some((t) => { v.set(x, 0, z).applyMatrix4(t.mi); return t.parts.some((p) => v.x > p.x0 - pad && v.x < p.x1 + pad && v.z > p.z0 - pad && v.z < p.z1 + pad); });
  const others = OSM.b.filter((b) => b.p.some(inArea) && !(b.s === 'tower' && b.h > 50)).map((b) => b._bb || (b._bb = bbox(b.p)));
  const roads = OSM.r.filter((r) => r.p.some(inArea)), lots = OSM.l.filter((p) => p.some(inArea));
  const w8 = [[W8.P0.x, W8.P0.y], [W8.P1.x, W8.P1.y]];
  const clear = (x, z, pad = 1) => segDist(x, z, w8) > STATION_CLEAR && !nearTower(x, z, pad) && !others.some((q) => x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad)
    && !roads.some((r) => segDist(x, z, r.p) < r.w / 2 + 2.2) && !lots.some((p) => pip(x, z, p));
  // ---- boulevards: every long footway leg, cut into ~4 m pieces that each have to be clear across the full width ----
  const pieces = [];
  OSM.w.forEach((w, wi) => {
    if (!w.p.some(inArea)) return; const L = len(w.p), k = BOULEVARD.find(([m]) => L >= m); if (!k) return; const [, mh, ww] = k, half = mh + ww;
    for (let i = 1; i < w.p.length; i++) {
      const [ax, az] = w.p[i - 1], [bx, bz] = w.p[i], sl = Math.hypot(bx - ax, bz - az); if (sl < MIN_SEG) continue;
      const ux = (bx - ax) / sl, uz = (bz - az) / sl, nx = -uz, nz = ux, n = Math.max(1, Math.round(sl / 4)), st = sl / n;
      for (let j = 0; j < n; j++) {
        const t0 = j * st, t1 = (j + 1) * st, ok = [t0, (t0 + t1) / 2, t1].every((t) => [-half, -mh, 0, mh, half].every((o) => clear(ax + ux * t + nx * o, az + uz * t + nz * o)));
        if (ok) pieces.push({ a: [ax + ux * t0, az + uz * t0], b: [ax + ux * t1, az + uz * t1], u: [ux, uz], n: [nx, nz], mh, ww, t0, leg: `${wi}:${i}` });
      }
    }
  });
  // ---- the plaza: between building 1 (the tower nearest the Stillwell terminal) and W 12 St: the clear square furthest west
  // (toward the station) within reach of the tower, preferring its middle ----
  let plaza = null;
  { const t1 = towers.reduce((a, t) => (t.c[0] < a.c[0] ? t : a), towers[0]); let best = Infinity;
    if (t1) for (let dx = -90; dx <= -20; dx += 2) for (let dz = -45; dz <= 45; dz += 3) {
      const px = t1.c[0] + dx, pz = t1.c[1] + dz, score = px + Math.abs(dz) * 0.5; if (score >= best) continue;
      let ok = true; for (let i = -1; i <= 1 && ok; i += 0.25) for (let j = -1; j <= 1; j += 0.25) if (!clear(px + i * PLAZA.w / 2, pz + j * PLAZA.d / 2, 1.5)) { ok = false; break; }
      if (ok) { best = score; plaza = { x: px, z: pz, w: PLAZA.w, d: PLAZA.d }; } } }
  const pieceAt = (x, z, pad) => pieces.some((p) => { const dx = x - p.a[0], dz = z - p.a[1], t = dx * p.u[0] + dz * p.u[1], o = dx * p.n[0] + dz * p.n[1]; return t > -pad && t < Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) + pad && Math.abs(o) < p.mh + p.ww + pad; });
  const noLawn = (x, z) => pieceAt(x, z, 0.8) || (plaza && Math.abs(x - plaza.x) < plaza.w / 2 + 1 && Math.abs(z - plaza.z) < plaza.d / 2 + 1);
  return { pieces, plaza, noLawn };
}

/** geometry for the plan: L is a housing.js Local (world frame, emitted into the ground batch), trees joins the plane trees */
export function buildYard(world, M, L, plan, trees) {
  const { scene, R } = world; const W = world.W || (world.W = {}), FS = W.fenceSegs || (W.fenceSegs = []);
  const yardSegs = [], shrubs = [];
  const flat = (key, pts, y, s) => L.quad(key, [pts[0][0], y, pts[0][1]], [pts[1][0], y, pts[1][1]], [pts[2][0], y, pts[2][1]], [pts[3][0], y, pts[3][1]], pts.map(([x, z]) => [x / s, z / s]));
  const strip = (p, o0, o1) => { const P = (q, o) => [q[0] + p.n[0] * o, q[1] + p.n[1] * o]; return [P(p.a, o1), P(p.b, o1), P(p.b, o0), P(p.a, o0)]; };   // CCW seen from above
  const fixWind = (q) => { const c = (q[1][0] - q[0][0]) * (q[3][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[3][0] - q[0][0]); return c < 0 ? q : [q[0], q[3], q[2], q[1]]; };
  // oriented thin box from a to b (world xz), half-width w, y0..y1: top + both long sides as quads (no AABB stair-stepping)
  const obox = (key, a, b, w, y0, y1) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w, u = l / 2;
    const c = (p, s, y) => [p[0] + nx * s, y, p[1] + nz * s];
    L.quad(key, c(a, -1, y1), c(b, -1, y1), c(b, 1, y1), c(a, 1, y1), [[0, 0], [u, 0], [u, 0.1], [0, 0.1]]);
    for (const s of [-1, 1]) { const q = [c(a, s, y0), c(b, s, y0), c(b, s, y1), c(a, s, y1)]; L.quad(key, ...(s > 0 ? q : [q[1], q[0], q[3], q[2]]), [[0, 0], [u, 0], [u, 0.1], [0, 0.1]]); }
  };
  const lineCols = (a, b, w, h) => {   // a collider wall along a diagonal line: one small world AABB per 0.6 m
    const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.6));
    for (let i = 0; i < n; i++) { const x = a[0] + dx * (i + 0.5) / n, z = a[1] + dz * (i + 0.5) / n, hx = Math.abs(dx) / n / 2 + w, hz = Math.abs(dz) / n / 2 + w; world.box([x - hx, 0, z - hz], [x + hx, h, z + hz]); }
  };
  const every = (along, pl, step, off, fn) => { for (let t = ((off - along) % step + step) % step; t < pl; t += step) fn(t); };   // fn(t) wherever (along + t) = off (mod step)
  // ---- boulevards ----
  for (const p of plan.pieces) {
    const along = p.t0;   // distance along the footway leg: keeps the fence / gap and tree rhythm continuous across pieces
    const pl = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
    for (const s of [-1, 1]) flat('hPaver', fixWind(strip(p, s > 0 ? p.mh : -p.mh - p.ww, s > 0 ? p.mh + p.ww : -p.mh)), 0.06, 1.6);   // the two walks
    flat('hLawn', fixWind(strip(p, -p.mh, p.mh)), KERB, 2.5);                                                                          // median grass on its kerb
    for (const s of [-1, 1]) {
      const o = s * p.mh, A = [p.a[0] + p.n[0] * o, p.a[1] + p.n[1] * o], B = [p.b[0] + p.n[0] * o, p.b[1] + p.n[1] * o];
      obox('hSlab', A, B, 0.08, 0, KERB);   // concrete kerb
      // low hoop fence 0.25 m inside the kerb, with a crossing gap every FENCE_RUN m (fence + gap pattern runs along the leg)
      const fo = s * (p.mh - 0.25); let t = 0;
      while (t < pl - 0.01) {
        const ph = (along + t) % (FENCE_RUN + FENCE_GAP), inGap = ph >= FENCE_RUN, step = Math.min(pl - t, inGap ? FENCE_RUN + FENCE_GAP - ph : FENCE_RUN - ph);
        if (!inGap && step > 0.3 && p.mh > 0.9) {
          const fa = [p.a[0] + p.u[0] * t + p.n[0] * fo, p.a[1] + p.u[1] * t + p.n[1] * fo], fb = [p.a[0] + p.u[0] * (t + step) + p.n[0] * fo, p.a[1] + p.u[1] * (t + step) + p.n[1] * fo];
          const u1 = step / 1.2; L.quad('hFence', [fa[0], KERB, fa[1]], [fb[0], KERB, fb[1]], [fb[0], KERB + FENCE_H, fb[1]], [fa[0], KERB + FENCE_H, fa[1]], [[0, 0], [u1, 0], [u1, 1], [0, 1]]);
          obox('hRail', fa, fb, 0.02, KERB + FENCE_H - 0.03, KERB + FENCE_H); lineCols(fa, fb, 0.05, KERB + FENCE_H);   // top rail + the fence's collider
          yardSegs.push({ a: fa, b: fb, n: [p.n[0] * s, p.n[1] * s], leg: p.leg, s });
        }
        t += Math.max(step, 0.01);
      }
    }
    // plane trees down the median every TREE_STEP m, round clipped shrubs between them
    if (p.mh >= 1.1) {
      every(along, pl, TREE_STEP, 0, (t) => trees.push({ x: p.a[0] + p.u[0] * t, z: p.a[1] + p.u[1] * t, s: 0.85 + R() * 0.35, ry: R() * 6.3 }));
      every(along, pl, TREE_STEP, TREE_STEP / 2, (t) => shrubs.push([p.a[0] + p.u[0] * t, p.a[1] + p.u[1] * t, Math.min(0.9, p.mh * 0.55)]));
    }
  }
  // merge each side's consecutive fence bits into runs for greens.js: benches line the medians facing the walks. They go first:
  // greens.js caps the bench count, and the boulevards are where the benches stand on the real grounds.
  const runs = [], open = new Map();   // open run per (leg, side)
  for (const s of yardSegs) { const key = s.leg + '/' + s.s, r = open.get(key); if (r && Math.hypot(r.b[0] - s.a[0], r.b[1] - s.a[1]) < 0.05) r.b = s.b; else { const nr = { ...s }; runs.push(nr); open.set(key, nr); } }
  FS.unshift(...runs.filter((r) => Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) >= 7).map((r) => ({ a: r.a, b: r.b, n: r.n })));
  // ---- the plaza (ref 05): concrete square, flagpole on a concrete base, plane trees round the edge, a round clipped shrub
  // in a grass bed, bins, benches (greens.js) ----
  const pz = plan.plaza;
  if (pz) {
    const x0 = pz.x - pz.w / 2, x1 = pz.x + pz.w / 2, z0 = pz.z - pz.d / 2, z1 = pz.z + pz.d / 2;
    flat('hPlaza', [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0.07, 4);
    for (let x = x0 + 4; x < x1; x += 4) obox('hSlab', [x, z0], [x, z1], 0.02, 0.07, 0.075);   // scored joints
    L.box('hSlab', [pz.x - 0.7, 0, pz.z - 0.7], [pz.x + 0.7, 0.45, pz.z + 0.7]); L.box('hRail', [pz.x - 0.07, 0.45, pz.z - 0.07], [pz.x + 0.07, 11, pz.z + 0.07], { collide: false });   // flagpole
    L.box('hRail', [pz.x - 0.12, 11, pz.z - 0.12], [pz.x + 0.12, 11.2, pz.z + 0.12], { collide: false });
    for (const [tx, tz] of [[x0 + 2, z0 + 2], [x1 - 2, z0 + 2], [x0 + 2, z1 - 2], [x1 - 2, z1 - 2], [x0 + 2, pz.z]]) trees.push({ x: tx, z: tz, s: 1.15 + R() * 0.25, ry: R() * 6.3 });
    { const bx = x1 - 4, bz = pz.z + 2; flat('hLawn', [[bx - 1.6, bz + 1.6], [bx + 1.6, bz + 1.6], [bx + 1.6, bz - 1.6], [bx - 1.6, bz - 1.6]], 0.09, 2.5); shrubs.push([bx, bz, 1.25]); }
    for (const [bx, bz] of [[x0 + 5, z1 - 0.8], [x1 - 6, z0 + 0.8]]) L.box('hBin', [bx - 0.3, 0, bz - 0.3], [bx + 0.3, 0.95, bz + 0.3]);   // litter baskets
    FS.unshift({ a: [x0 + 6, z0 - 0.9], b: [x1 - 7, z0 - 0.9], n: [0, 1] }, { a: [x0 + 6, z1 + 0.9], b: [x1 - 7, z1 + 0.9], n: [0, -1] });   // bench rows along the long edges, facing the flag
    (W.mapPOIs || (W.mapPOIs = [])).push({ name: 'Luna plaza', x: pz.x, z: pz.z, kind: 'landmark' });
  }
  W.lunaYard = { pieces: plan.pieces.length, plaza: pz, shrubs: shrubs.length };
  console.log('[luna yard]', plan.pieces.length, 'boulevard pieces ·', runs.length, 'median fence runs ·', shrubs.length, 'shrubs · plaza', pz ? `${pz.x.toFixed(0)},${pz.z.toFixed(0)}` : 'none');
  // ---- shrubs: one InstancedMesh of lumpy clipped balls ----
  if (shrubs.length) {
    const g = new THREE.IcosahedronGeometry(1, 2); const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const k = 1 + (Math.sin(i * 12.9898) * 0.5) * 0.12; P.setXYZ(i, P.getX(i) * k, P.getY(i) * k * 0.9, P.getZ(i) * k); } g.computeVertexNormals();
    const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0x2f5a24 }), shrubs.length); const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    shrubs.forEach(([x, z, r], i) => { s.set(r, r, r); p.set(x, r * 0.85 + KERB, z); im.setMatrixAt(i, mm.compose(p, q, s)); world.box([x - r * 0.6, 0, z - r * 0.6], [x + r * 0.6, r * 1.4, z + r * 0.6]); });
    im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); im.name = 'luna:shrubs'; im.userData.surface = 'wood'; scene.add(im);
  }
}

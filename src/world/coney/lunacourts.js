// CONEY: the Luna Park Houses courts and courtyard corners, after the aerials. The real OSM pitches south-east of building 1
// (two basketball courts side by side, two pickleball courts beside them) get asphalt, painted lines, hoops on poles with
// backboards, nets and a tall chain-link fence with a gate; then, on clear lawn: a grilling area (pedestal grills, picnic
// tables, bins, shade trees) and a round paved play plaza near the central towers (curved painted lines, benches round it,
// a ring of mature trees). One Batch: every material key merges into one draw; line textures are 256 px canvases.
// Everything solid gets AABB colliders (diagonal runs are cut into 0.6 m cells). Runs after greens.js. CONEY agent.
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { Batch, boxGeo } from '../sbu/geo.js';
import { OSM } from './osm.js';

const FENCE_H = 3.0, FENCE_PANEL = 2.5, GATE_W = 1.4;
const COURT_Y = 0.085, APRON_Y = 0.075;   // above city.js's pitch paint (0.025) and housing.js's pavers (0.05)
const BB_RUNOFF = 1.6, PB_RUNOFF = 1.0;   // fence distance outside the outermost court lines (the hoop poles stand in it)
const PLAZA_R = 6.5, PLAZA_TREES = 8, GRILL_AREA = { w: 18, d: 12 };
const KEEP_OUT = [[212, -393, 26]];   // Table Park, the crew's hangout (housing.js FENCE_HOLES): open ground stays open

export function buildLunaCourts(world, M) {
  const { scene, ctx } = world, W = world.W || (world.W = {}), towers = world.lunaTowers || []; if (!towers.length) return;
  const S = new Batch(world, M, 'lunacourts'), G1 = new Batch(world, M, 'lunacourtsGround1'), G2 = new Batch(world, M, 'lunacourtsGround2');   // ground: apron, then courts + plaza on top
  mats(M);
  const out = { courts: [], plaza: null, grills: null };
  // ---- geometry helpers: a frame (origin o, unit u along, v across) maps (s, t) to world xz ----
  const frame = (o, u) => { const v = [-u[1], u[0]], yaw = -Math.atan2(u[1], u[0]); return { o, u, v, yaw, P: (s, t) => [o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t] }; };
  const obox = (key, F, s, y, t, w, h, d, { rx = 0, rz = 0, uv = true } = {}) => { const g = boxGeo([-w / 2, -h / 2, -d / 2], [w / 2, h / 2, d / 2]); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.rotateY(F.yaw); const [x, z] = F.P(s, t); g.translate(x, y, z); S.add(key, g, { uv }); };
  const ocyl = (key, F, s, t, y0, y1, r, seg = 8) => { const [x, z] = F.P(s, t); S.cyl(key, x, z, y0, y1, r, seg); };
  const solid = (F, s0, t0, s1, t1, h, cell = 0.6) => {   // a collider over a frame rectangle: small world AABBs so diagonal things stay tight
    const ns = Math.max(1, Math.ceil((s1 - s0) / cell)), nt = Math.max(1, Math.ceil((t1 - t0) / cell)), ds = (s1 - s0) / ns, dt = (t1 - t0) / nt;
    for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const [x, z] = F.P(s0 + (i + a) * ds, t0 + (j + b) * dt); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      world.box([x0, 0, z0], [x1, h, z1]); } };
  const flat = (B, key, F, s0, t0, s1, t1, y, uv = null) => {   // an upward quad over a frame rectangle; uv [u0, v0, u1, v1] (else world UVs)
    const c = [F.P(s0, t0), F.P(s1, t0), F.P(s1, t1), F.P(s0, t1)], q = uv || [0, 0, 1, 1], U = [[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]];
    const up = (c[1][0] - c[0][0]) * (c[3][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[3][0] - c[0][0]) < 0, ord = up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const p = [], n = [], u = []; for (const i of ord) { p.push(c[i][0], y, c[i][1]); n.push(0, 1, 0); u.push(...U[i]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); B.add(key, g, { uv: !uv }); };
  // chain-link fence round a frame rectangle; gates: [{ side: 's0'|'s1'|'t0'|'t1', at: distance from that side's start }]
  const fence = (F, s0, t0, s1, t1, gates) => {
    const sides = { t0: [[s0, t0], [s1, t0]], s1: [[s1, t0], [s1, t1]], t1: [[s1, t1], [s0, t1]], s0: [[s0, t1], [s0, t0]] };
    for (const [id, [[as, at], [bs, bt]]] of Object.entries(sides)) {
      const L = Math.hypot(bs - as, bt - at), us = (bs - as) / L, ut = (bt - at) / L, gs = gates.filter((g) => g.side === id).map((g) => [g.at - GATE_W / 2, g.at + GATE_W / 2]);
      const runs = []; let a = 0; for (const [g0, g1] of gs) { runs.push([a, g0]); a = g1; } runs.push([a, L]);
      const at2 = (d) => [as + us * d, at + ut * d];
      for (const [r0, r1] of runs) { if (r1 - r0 < 0.2) continue; const n = Math.max(1, Math.ceil((r1 - r0) / FENCE_PANEL));
        for (let k = 0; k <= n; k++) { const [ps, pt] = at2(r0 + (r1 - r0) * k / n); ocyl('galv', F, ps, pt, 0, FENCE_H + 0.05, k === 0 || k === n ? 0.05 : 0.035, 6); }
        const [ms, mt] = at2((r0 + r1) / 2), len = r1 - r0, rot = Math.atan2(ut, us);
        const panel = (y0, y1, key, th) => { const g = boxGeo([-len / 2, y0, -th], [len / 2, y1, th]); g.rotateY(F.yaw - rot); const [x, z] = F.P(ms, mt); g.translate(x, 0, z); S.add(key, g, { uvScale: 1.6 }); };
        panel(0.04, FENCE_H, 'fenceMesh', 0.015); panel(FENCE_H - 0.05, FENCE_H, 'galv', 0.025); panel(0.08, 0.12, 'galv', 0.02);
        // collider: 0.6 m cells along the run (both ends of each run stop at the gate posts)
        const [c0s, c0t] = at2(r0), [c1s, c1t] = at2(r1), nc = Math.max(1, Math.ceil(len / 0.6));
        for (let k = 0; k < nc; k++) { const [x0, z0] = F.P(c0s + (c1s - c0s) * k / nc, c0t + (c1t - c0t) * k / nc), [x1, z1] = F.P(c0s + (c1s - c0s) * (k + 1) / nc, c0t + (c1t - c0t) * (k + 1) / nc);
          world.box([Math.min(x0, x1) - 0.06, 0, Math.min(z0, z1) - 0.06], [Math.max(x0, x1) + 0.06, FENCE_H, Math.max(z0, z1) + 0.06]); } }
      for (const [g0, g1] of gs) {   // gate: header bar over the opening, the leaf swung open flat against the fence outside
        const [hs, ht] = at2((g0 + g1) / 2), rot = Math.atan2(ut, us);
        { const g = boxGeo([-GATE_W / 2, 2.1, -0.03], [GATE_W / 2, 2.16, 0.03]); g.rotateY(F.yaw - rot); const [x, z] = F.P(hs, ht); g.translate(x, 0, z); S.add('galv', g); }
        const nrm = [ut, -us];   // outward normal of the side (the loop runs counter-clockwise in (s, t))
        const [ls, lt] = at2(g1 + GATE_W / 2), os = ls + nrm[0] * 0.12, ot = lt + nrm[1] * 0.12;
        { const es = Math.abs(us) * GATE_W / 2 + 0.05, et = Math.abs(ut) * GATE_W / 2 + 0.05; solid(F, os - es, ot - et, os + es, ot + et, 2.0, 0.6); }
        { const g = boxGeo([-GATE_W / 2, 0.08, -0.012], [GATE_W / 2, 2.0, 0.012]); g.rotateY(F.yaw - rot); const [x, z] = F.P(os, ot); g.translate(x, 0, z); S.add('fenceMesh', g, { uvScale: 1.6 });
          const f = boxGeo([-GATE_W / 2, 1.96, -0.02], [GATE_W / 2, 2.0, 0.02]); f.rotateY(F.yaw - rot); f.translate(x, 0, z); S.add('galv', f); }
        for (const e of [-1, 1]) { const [cs, ct] = at2((g0 + g1) / 2 + e * GATE_W / 2); ocyl('galv', F, cs, ct, 0, FENCE_H + 0.1, 0.06, 8); }
      }
    }
  };
  // ---- the OSM courts: group the pitches by kind, build each group inside one fence ----
  const near = (o) => o.p.some(([x, z]) => x > 60 && x < 400 && z > -540 && z < -200);
  const groups = [['basketball', OSM.pt.filter((o) => o.sport === 'basketball' && near(o))], ['net', OSM.pt.filter((o) => /pickleball|tennis/.test(o.sport) && near(o))]];
  for (const [kind, list] of groups) {
    if (!list.length) continue;
    // frame from the first pitch's long edge; every pitch's corners projected into it
    const p0 = list[0].p; let best = 0, u = [1, 0];
    for (let i = 0; i < p0.length; i++) { const a = p0[i], b = p0[(i + 1) % p0.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } }
    const F = frame(p0[0], u), proj = ([x, z]) => [(x - F.o[0]) * F.u[0] + (z - F.o[1]) * F.u[1], (x - F.o[0]) * F.v[0] + (z - F.o[1]) * F.v[1]];
    const pit = list.map((o) => { const q = o.p.map(proj); return { s0: Math.min(...q.map((a) => a[0])), s1: Math.max(...q.map((a) => a[0])), t0: Math.min(...q.map((a) => a[1])), t1: Math.max(...q.map((a) => a[1])) }; });
    const m = kind === 'basketball' ? BB_RUNOFF : PB_RUNOFF;
    const s0 = Math.min(...pit.map((p) => p.s0)) - m, s1 = Math.max(...pit.map((p) => p.s1)) + m, t0 = Math.min(...pit.map((p) => p.t0)) - m, t1 = Math.max(...pit.map((p) => p.t1)) + m;
    flat(G1, 'asphalt', F, s0, t0, s1, t1, APRON_Y);
    // the gate faces the middle of the towers (the walk in from the grounds)
    const cx = towers.reduce((a, t) => a + t.centre.x, 0) / towers.length, cz = towers.reduce((a, t) => a + t.centre.z, 0) / towers.length, [ms, mt] = proj([cx, cz]);
    const gate = Math.abs(ms - (s0 + s1) / 2) / (s1 - s0) > Math.abs(mt - (t0 + t1) / 2) / (t1 - t0)
      ? (ms > (s0 + s1) / 2 ? { side: 's1', at: 2.2 } : { side: 's0', at: (t1 - t0) - 2.2 }) : (mt > (t0 + t1) / 2 ? { side: 't1', at: 2.2 } : { side: 't0', at: (s1 - s0) - 2.2 });
    fence(F, s0, t0, s1, t1, [gate]);
    for (const p of pit) {
      const L = p.s1 - p.s0, D = p.t1 - p.t0, tm = (p.t0 + p.t1) / 2;
      flat(G2, kind === 'basketball' ? 'lcBasket' : 'lcPickle', F, p.s0, p.t0, p.s1, p.t1, COURT_Y, [0, 0, 1, 1]);
      if (kind === 'basketball') for (const e of [-1, 1]) {   // a hoop at each end: pole outside the baseline, arm, backboard, orange rim, net
        const base = e < 0 ? p.s0 : p.s1, pole = base - e * 1.0, board = base + e * 1.2;
        ocyl('steelDark', F, pole, tm, 0, 3.55, 0.09, 10); solid(F, pole - 0.15, tm - 0.15, pole + 0.15, tm + 0.15, 3.5, 0.3);
        obox('steelDark', F, (pole + board) / 2, 3.45, tm, Math.abs(board - pole), 0.1, 0.1);
        obox('white', F, board, 3.45, tm, 0.05, 1.05, 1.8);
        obox('steelOrange', F, board + e * 0.03, 3.25, tm, 0.02, 0.45, 0.59);   // the shooter's square (painted box)
        { const r = new THREE.TorusGeometry(0.23, 0.012, 4, 16); r.rotateX(Math.PI / 2); const [x, z] = F.P(board + e * 0.28, tm); r.translate(x, 3.05, z); S.add('steelOrange', r); }
        { const n = new THREE.CylinderGeometry(0.23, 0.15, 0.42, 10, 1, true); const [x, z] = F.P(board + e * 0.28, tm); n.translate(x, 2.84, z); S.add('lcNet', n, { uv: false }); }
      } else {   // net across the middle of each court: posts outside the sidelines, mesh band, white tape
        const sm = (p.s0 + p.s1) / 2;
        for (const e of [-1, 1]) { ocyl('steelDark', F, sm, tm + e * (D / 2 + 0.3), 0, 0.95, 0.04, 6); }
        obox('lcNet', F, sm, 0.47, tm, 0.02, 0.8, D + 0.6, { uv: false }); obox('white', F, sm, 0.9, tm, 0.03, 0.06, D + 0.6);
        solid(F, sm - 0.05, p.t0 - 0.35, sm + 0.05, p.t1 + 0.35, 0.92, 0.6);
      }
      void L;
    }
    const [gx, gz] = F.P((s0 + s1) / 2, (t0 + t1) / 2);
    out.courts.push({ kind, n: list.length, x: +gx.toFixed(1), z: +gz.toFixed(1), corners: [F.P(s0, t0), F.P(s1, t0), F.P(s1, t1), F.P(s0, t1)].map(([a, b]) => [+a.toFixed(1), +b.toFixed(1)]) });
    (W.mapPOIs || (W.mapPOIs = [])).push({ name: kind === 'basketball' ? 'BASKETBALL COURTS' : 'PICKLEBALL COURTS', x: gx, z: gz, kind: 'landmark' });
  }
  // ---- lawn spots for the grill area + the play plaza (as greens.js: raycast down onto the lawn batch, clear of colliders) ----
  const lawns = []; scene.traverse((o) => { if (o.isMesh && o.material === M.hLawn) lawns.push(o); });
  for (const m of lawns) { if (!m.geometry.boundsTree) m.geometry.boundsTree = new MeshBVH(m.geometry); m.raycast = acceleratedRaycast; m.updateMatrixWorld(true); }
  const rc = new THREE.Raycaster(); rc.firstHitOnly = true; const down = new THREE.Vector3(0, -1, 0), o3 = new THREE.Vector3();
  const isLawn = (x, z) => { o3.set(x, 3, z); rc.set(o3, down); rc.far = 4; return rc.intersectObjects(lawns, false).length > 0; };
  const CELL = 4, grid = new Map(); let indexed = 0;
  const index = () => { const C = ctx.colliders; for (; indexed < C.length; indexed++) { const b = C[indexed]; if (!(b.max.y > 0.2 && b.min.y < 2)) continue;
    for (let i = Math.floor((b.min.x - 1) / CELL); i <= Math.floor((b.max.x + 1) / CELL); i++) for (let j = Math.floor((b.min.z - 1) / CELL); j <= Math.floor((b.max.z + 1) / CELL); j++) { const k = i * 65536 + j; (grid.get(k) || grid.set(k, []).get(k)).push(b); } } };
  const blocked = (x, z, r = 0.3) => { index(); const l = grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)); return !!l && l.some((b) => x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r); };
  const taken = [...KEEP_OUT, ...(W.mapPOIs || []).map((p) => [p.x, p.z, 16])]; if (W.onlineStart) taken.push([W.onlineStart[0], W.onlineStart[2], 20]);
  const axisOf = (t) => { const a = t.toWorld(0, 0, 0), b = t.toWorld(1, 0, 0); return Math.atan2(b.z - a.z, b.x - a.x); };
  const nearTower = (x, z) => towers.reduce((a, t) => (Math.hypot(t.centre.x - x, t.centre.z - z) < Math.hypot(a.centre.x - x, a.centre.z - z) ? t : a), towers[0]);
  const fits = (F, w, d) => { for (let s = -w / 2; s <= w / 2 + 0.01; s += 1) for (let t = -d / 2; t <= d / 2 + 0.01; t += 1) { const [x, z] = F.P(s, t); if (blocked(x, z, 0.6) || (Math.abs(s % 2) < 0.01 && Math.abs(t % 2) < 0.01 && !isLawn(x, z))) return false; } return true; };   // 1 m samples: a lawn tree's 0.6 m trunk can't hide between them
  const findSpot = (w, d, cx, cz) => { const cand = []; for (let x = cx - 160; x <= cx + 160; x += 4) for (let z = cz - 180; z <= cz + 180; z += 4) cand.push([x, z, Math.hypot(x - cx, z - cz)]); cand.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of cand) { if (taken.some(([a, b, r]) => Math.hypot(a - x, b - z) < r + Math.max(w, d) / 2) || !isLawn(x, z)) continue; const ang = axisOf(nearTower(x, z));
      for (const a of [ang, ang + Math.PI / 2]) { const F = frame([x, z], [Math.cos(a), Math.sin(a)]); if (fits(F, w, d)) { taken.push([x, z, Math.max(w, d) / 2 + 6]); return F; } } } return null; };
  const tree = (x, z, s) => {   // a mature shade tree: trunk + a domed crown of leaf clumps, all into the batch
    S.cyl('bark', x, z, 0, 6.2 * s, 0.24 * s, 8, { r0: 0.36 * s }); world.box([x - 0.32, 0, z - 0.32], [x + 0.32, 4, z + 0.32]);
    let q = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 1e4;   // per-tree jitter: the crowns aren't clones
    const rnd = () => { q = (q * 9301 + 49297) % 233280; return q / 233280; };
    for (const [dx, dy, dz, r] of [[0, 8.6, 0, 3.0], [2.2, 7.6, 0.9, 2.2], [-2.1, 7.7, -0.8, 2.3], [0.6, 7.5, 2.3, 2.1], [-0.5, 7.6, -2.3, 2.1], [0.3, 10.0, -0.3, 2.0], [1.6, 9.3, -1.5, 1.6], [-1.5, 9.2, 1.4, 1.6]]) {
      const g = new THREE.IcosahedronGeometry(r * s * (0.85 + rnd() * 0.3), 1), P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, P.getY(i) * 0.78);
      g.computeVertexNormals(); g.translate(x + dx * s, dy * s, z + dz * s); S.add('lcLeaf', g, { uv: false }); } };
  const bench = (at, back) => {   // NYC park bench (green slats, iron ends) at world xz `at`, its back toward world direction `back`
    const B = frame(at, [back[1], -back[0]]);   // B.u along the bench, B.v (= back) behind it
    for (const k of [-0.1, 0, 0.1]) obox('lcSlat', B, 0, 0.45, k, 1.9, 0.035, 0.085);
    for (const y of [0.62, 0.76]) obox('lcSlat', B, 0, y, 0.22, 1.9, 0.09, 0.03);
    for (const e of [-0.85, 0.85]) { obox('bench', B, e, 0.22, 0, 0.05, 0.44, 0.46); obox('bench', B, e, 0.6, 0.22, 0.05, 0.4, 0.05); }
    solid(B, -0.95, -0.28, 0.95, 0.28, 0.8, 0.6); };
  const cx0 = towers.reduce((a, t) => a + t.centre.x, 0) / towers.length, cz0 = towers.reduce((a, t) => a + t.centre.z, 0) / towers.length;
  // ---- the courtyard play plaza: round paved disc with painted curves on a kerb ring, benches round it, mature trees ----
  const PF = findSpot(2 * PLAZA_R + 2, 2 * PLAZA_R + 2, cx0, cz0);
  if (PF) {
    const [x, z] = PF.o;
    { const g = new THREE.CircleGeometry(PLAZA_R, 48); g.rotateX(-Math.PI / 2); g.rotateY(PF.yaw); g.translate(x, 0.1, z); G2.add('lcPlaza', g, { uv: false }); }
    { const g = new THREE.CylinderGeometry(PLAZA_R + 0.18, PLAZA_R + 0.18, 0.14, 48, 1, true); g.translate(x, 0.05, z); S.add('concrete', g); }
    { const g = new THREE.RingGeometry(PLAZA_R, PLAZA_R + 0.18, 48); g.rotateX(-Math.PI / 2); g.translate(x, 0.12, z); S.add('concrete', g); }
    const nb = 6; for (let k = 0; k < nb; k++) { const a = (k + 0.5) / nb * Math.PI * 2, r = PLAZA_R - 0.7, [bs, bt] = [Math.cos(a) * r, Math.sin(a) * r]; bench(PF.P(bs, bt), [PF.u[0] * Math.cos(a) + PF.v[0] * Math.sin(a), PF.u[1] * Math.cos(a) + PF.v[1] * Math.sin(a)]); }
    let nt = 0; for (let k = 0; k < PLAZA_TREES; k++) { const a = k / PLAZA_TREES * Math.PI * 2, [tx, tz] = PF.P(Math.cos(a) * (PLAZA_R + 2.6), Math.sin(a) * (PLAZA_R + 2.6)); if (!isLawn(tx, tz) || blocked(tx, tz, 0.5)) continue; tree(tx, tz, 1.05 + ((k * 37) % 10) / 40); nt++; }
    out.plaza = { x: +x.toFixed(1), z: +z.toFixed(1), r: PLAZA_R, trees: nt, benches: nb };
    (W.mapPOIs || (W.mapPOIs = [])).push({ name: 'PLAY PLAZA', x, z, kind: 'landmark' });
  }
  // ---- the grilling area: shade trees at the corners, pedestal grills, picnic tables with benches, bins ----
  const GF = findSpot(GRILL_AREA.w, GRILL_AREA.d, cx0 - 40, cz0 + 60);
  if (GF) {
    const hw = GRILL_AREA.w / 2, hd = GRILL_AREA.d / 2, spots = [];
    for (const [s, t] of [[-hw + 1.5, -hd + 1.5], [hw - 1.5, -hd + 1.5], [-hw + 1.5, hd - 1.5], [hw - 1.5, hd - 1.5], [0, 0.2]]) { const [x, z] = GF.P(s, t); tree(x, z, 1.1); }
    for (const s of [-5.5, 0, 5.5]) {   // a table + its grill per bay
      const tt = -1.8; obox('planks', GF, s, 0.76, tt, 0.8, 0.05, 1.9, {}); for (const e of [-0.65, 0.65]) obox('planks', GF, s + e, 0.45, tt, 0.28, 0.045, 1.9);
      for (const e of [-0.8, 0.8]) for (const k of [-1, 1]) obox('steelDark', GF, s + k * 0.35, 0.38, tt + e, 0.05, 0.8, 0.05, { rz: k * 0.45 });
      for (const e of [-0.8, 0.8]) obox('steelDark', GF, s, 0.42, tt + e, 1.6, 0.04, 0.04);
      solid(GF, s - 0.85, tt - 0.95, s + 0.85, tt + 0.95, 0.8);
      const gs = s + 1.6, gt = 3.2; ocyl('steelDark', GF, gs, gt, 0, 0.82, 0.05, 8);   // pedestal grill: post, firebox, grate, side shelf
      obox('steelDark', GF, gs, 0.92, gt, 0.62, 0.22, 0.42); obox('black', GF, gs, 1.035, gt, 0.56, 0.01, 0.36); obox('steelDark', GF, gs - 0.42, 0.95, gt, 0.22, 0.02, 0.3);
      solid(GF, gs - 0.4, gt - 0.3, gs + 0.4, gt + 0.3, 1.05, 0.4); spots.push(GF.P(gs, gt + 0.75));
    }
    for (const [s, t] of [[-hw + 3.5, 4.6], [hw - 3.5, 4.6]]) { const [x, z] = GF.P(s, t); S.cyl('binGreen', x, z, 0, 0.92, 0.3, 10, { collide: true }); S.cyl('black', x, z, 0.92, 0.95, 0.31, 10); }
    const [x, z] = GF.o; out.grills = { x: +x.toFixed(1), z: +z.toFixed(1), grills: spots.length };
    (W.mapPOIs || (W.mapPOIs = [])).push({ name: 'BBQ AREA', x, z, kind: 'park' });
    W.grillSpots = spots.map(([a, b]) => ({ x: a, z: b }));
  }
  grid.clear();
  S.flush({ shadow: !ctx.lite });
  for (const [B, rank] of [[G1, 11], [G2, 12]]) for (const m of B.flush({ shadow: false })) { let prev = null;   // above city.js's ground layers (7) and realism.js's (8..10)
    m.onBeforeRender = (_r, _s, _c, _g, mt) => { prev = [mt.polygonOffset, mt.polygonOffsetFactor, mt.polygonOffsetUnits]; mt.polygonOffset = true; mt.polygonOffsetFactor = -rank; mt.polygonOffsetUnits = -2 * rank; };
    m.onAfterRender = (_r, _s, _c, _g, mt) => { if (prev) [mt.polygonOffset, mt.polygonOffsetFactor, mt.polygonOffsetUnits] = prev; }; }
  W.lunaCourts = out;
  console.log('[luna courts]', out.courts.map((c) => `${c.kind}x${c.n}@${c.x},${c.z}`).join(' '), '· plaza', out.plaza ? `${out.plaza.x},${out.plaza.z}` : 'none', '· grills', out.grills ? `${out.grills.x},${out.grills.z}` : 'none');
}

function mats(M) {
  if (M.lcBasket) return;
  const reg = (key, mat, surface) => { mat.name = key; M[key] = mat; M.surface[key] = surface; return mat; };
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const grain = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { const v = 60 + Math.random() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},${a})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } };
  // basketball: one full court along u (texture x), 22 x 15.5 m; asphalt, red keys, white lines
  reg('lcBasket', new THREE.MeshStandardMaterial({ map: tex(256, 180, (g, w, h) => {
    g.fillStyle = '#505357'; g.fillRect(0, 0, w, h); grain(g, w, h, 2500, 0.4);
    const k = w / 22.2, cy = h / 2, lw = 2; g.strokeStyle = '#ecebe4'; g.lineWidth = lw;
    for (const e of [0, 1]) { const bx = e ? w - 6 : 6, dir = e ? -1 : 1;
      g.fillStyle = '#8e3a2e'; g.fillRect(e ? bx - 5.8 * k : bx, cy - 2.45 * k, 5.8 * k, 4.9 * k); g.strokeRect(e ? bx - 5.8 * k : bx, cy - 2.45 * k, 5.8 * k, 4.9 * k);
      g.beginPath(); g.arc(bx + dir * 5.8 * k, cy, 1.8 * k, e ? Math.PI / 2 : -Math.PI / 2, e ? Math.PI * 1.5 : Math.PI / 2); g.stroke();
      g.beginPath(); g.moveTo(bx, cy - 6.6 * k); g.lineTo(bx + dir * 1.6 * k, cy - 6.6 * k); g.arc(bx + dir * 1.6 * k, cy, 6.6 * k, e ? -Math.PI / 2 - 0.0 : -Math.PI / 2, Math.PI / 2, !!e); g.lineTo(bx, cy + 6.6 * k); g.stroke(); }
    g.strokeRect(6, 6, w - 12, h - 12); g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.stroke(); g.beginPath(); g.arc(w / 2, cy, 1.8 * k, 0, 7); g.stroke();
  }), roughness: 0.92 }), 'concrete');
  // pickleball: one court along u, 13.4 x 6.1 m; green with a blue kitchen, white lines
  reg('lcPickle', new THREE.MeshStandardMaterial({ map: tex(256, 128, (g, w, h) => {
    g.fillStyle = '#3f6e4c'; g.fillRect(0, 0, w, h); grain(g, w, h, 1200, 0.25);
    const k = (w - 16) / 13.4, x0 = 8, y0 = 8, cw = 13.4 * k, ch = h - 16; g.fillStyle = '#35587e'; g.fillRect(x0 + cw / 2 - 2.13 * k, y0, 4.26 * k, ch);
    g.strokeStyle = '#f1f0ea'; g.lineWidth = 2; g.strokeRect(x0, y0, cw, ch);
    for (const x of [x0 + cw / 2 - 2.13 * k, x0 + cw / 2 + 2.13 * k]) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + ch); g.stroke(); }
    for (const [a, b] of [[x0, x0 + cw / 2 - 2.13 * k], [x0 + cw / 2 + 2.13 * k, x0 + cw]]) { g.beginPath(); g.moveTo(a, y0 + ch / 2); g.lineTo(b, y0 + ch / 2); g.stroke(); }
  }), roughness: 0.85 }), 'concrete');
  // the play plaza: warm concrete with painted curves (rings, a spiral, waves, dots); 256 px over 16 m
  reg('lcPlaza', new THREE.MeshStandardMaterial({ map: tex(256, 256, (g, w, h) => {
    g.fillStyle = '#a49e93'; g.fillRect(0, 0, w, h); grain(g, w, h, 3000, 0.2);
    const c = w / 2; g.lineCap = 'round';
    g.strokeStyle = '#2f6fa8'; g.lineWidth = 7; g.beginPath(); g.arc(c, c, 100, 0, 7); g.stroke();
    g.strokeStyle = '#e7b52a'; g.lineWidth = 5; g.beginPath(); for (let a = 0; a < Math.PI * 7; a += 0.05) { const r = 6 + a * 3.6; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); } g.stroke();
    g.strokeStyle = '#c4473a'; g.lineWidth = 5; for (const off of [-1, 1]) { g.beginPath(); for (let x = 30; x <= 226; x += 3) g.lineTo(x, c + off * 66 + Math.sin(x / 14) * 8); g.stroke(); }
    g.strokeStyle = '#f2efe6'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, 120, 0, 7); g.stroke();
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; g.fillStyle = ['#2f6fa8', '#e7b52a', '#c4473a', '#4c9a54'][k % 4]; g.beginPath(); g.arc(c + Math.cos(a) * 112, c + Math.sin(a) * 112, 6, 0, 7); g.fill(); }
  }), roughness: 0.9 }), 'concrete');
  reg('lcNet', new THREE.MeshLambertMaterial({ map: tex(64, 64, (g) => { g.strokeStyle = '#f2f2f2'; g.lineWidth = 2; for (let x = 0; x < 64; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(64, x); g.stroke(); } }), alphaTest: 0.5, side: THREE.DoubleSide }), 'metal');
  reg('lcLeaf', new THREE.MeshLambertMaterial({ color: 0x5f8238, emissive: 0x1c2a10 }), 'wood');
  reg('lcSlat', new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.7 }), 'wood');
  (M.noShadow || (M.noShadow = {})).lcNet = true;
  if (!M.fenceMesh) {   // realism.js normally made it first (same weave)
    const t = tex(64, 64, (g) => { g.strokeStyle = 'rgba(180,184,186,1)'; g.lineWidth = 3; for (let k = -64; k < 128; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke(); } });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; reg('fenceMesh', new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }), 'metal'); M.noShadow.fenceMesh = true;
  }
}

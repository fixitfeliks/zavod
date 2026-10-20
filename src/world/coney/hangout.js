// CONEY hangout — "recreate our youth": Igor in the park by Luna Park building 2 sells a $10 bag (or a bottle, every other
// time); Sammy's deli on W 8th St sells liquor and 40s of Olde English once you've answered his question; any Luna Park
// lobby has 3 steel elevators to the 19th-floor gallery (friends standing with you ride along, online); B to light up /
// drink anywhere and friends close by share it; ride down, steal a car off the kerb or take the red car. The generic loop
// (cash, stash, B, elevators, stealing, passengers, merc cash, respawn-at) lives in ../hangkit.js. CONEY agent.
import * as THREE from 'three';
import { buildKit, hangkit as K } from '../hangkit.js';
import { buildDeli, sammyTalk, fadeNear, nameTag, findDeliSpot, storeTalk } from '../deli.js';
import { buildPerson, peopleReady } from '../people.js';
import { dressFigure, standTall, addAfro, addLongHair, addKnife } from '../outfits.js';
import { buildLocals, sammyLotion } from './locals.js';
import { buildChill, buildCrews, gunShop } from './chill.js';
import { buildJobs, jobsTalk, startIce, finishIce } from './jobs.js';
import { buildJetpacks } from './jetpack.js';
import { sell } from '../hangkit.js';
import { openDurak, closeDurak, stats as durakStats } from './durak.js';
import { initDurakMP, tableChoices as durakTableChoices, tableLine as durakTableLine } from './durak-mp.js';
import { OSM } from './osm.js';
import { buildTavern } from './tavern.js';
import { buildBrighton } from './brighton.js';
import { cen, pip } from '../osmkit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const B2 = new THREE.Vector3(163, 0, -445);      // OSM "Luna Park Houses 2" centre (map frame)
const START_CASH = 20, PRICE = 10;

let H = null, igorFig = null;

export function buildHangout(world, M) {
  const { ctx, W } = world; const towers = world.lunaTowers || [];
  if (!towers.length) return;
  W.lunaTowers = towers;   // exposed on ctx.world for QA / other modules
  // building 2 = the complex nearest the OSM centroid of "Luna Park Houses 2"
  let b2 = towers[0]; for (const t of towers) if (t.centre.distanceTo(B2) < b2.centre.distanceTo(B2)) b2 = t;
  const free = (v) => !ctx.colliders.some((b) => v.x > b.min.x - 0.4 && v.x < b.max.x + 0.4 && v.z > b.min.z - 0.4 && v.z < b.max.z + 0.4 && b.max.y > 0.3 && b.min.y < 1.8);
  // online start: right outside building 2's lobby door (whichever face is open)
  let door = b2.lobby.doors.find((d) => free(d.outside)) || b2.lobby.doors[0];
  const out = door.outside.clone(); for (let k = 0; k < 12 && !free(out); k++) out.addScaledVector(door.outside.clone().sub(door.inside).setY(0).normalize(), 1);
  W.onlineStart = [out.x, 0, out.z, door.yawIn];
  // Igor: in the nearest park polygon to building 2 (else the lawn in front of it)
  let igor = null, bd = 260;
  for (const p of OSM.pk) { const [x, z] = cen(p); const d = Math.hypot(x - b2.centre.x, z - b2.centre.z); if (d < bd && pip(x, z, p)) { const v = new THREE.Vector3(x, 0, z); if (free(v)) { bd = d; igor = v; } } }
  if (!igor) igor = out.clone().addScaledVector(door.outside.clone().sub(door.inside).setY(0).normalize(), 12);
  H = { world, ctx, towers, b2, igor, buys: 0 };
  H.igor = buildIgor(world, M, igor);   // the interaction point is Igor's bench, not the park centre
  if (H.gate) { const g = H.gate, dx = H.igor.x - g.x, dz = H.igor.z - g.z; W.onlineStart = [g.x, 0, g.z, Math.atan2(-dx, -dz)]; }   // friends spawn at Igor's gate
  // three bikes parked in a row just outside the park gate (vehicles.js takes W.vehicleSpots; coney.js puts these first)
  if (H.gate) {
    const g = H.gate, ax = H.igor.x - g.x, az = H.igor.z - g.z, L0 = Math.hypot(ax, az) || 1, ux = ax / L0, uz = az / L0, px = -uz, pz = ux;   // u: gate → park, p: along the fence
    const clearAt = (x, z) => !ctx.colliders.some((b) => x > b.min.x - 1.3 && x < b.max.x + 1.3 && z > b.min.z - 1.3 && z < b.max.z + 1.3 && b.max.y > 0.3 && b.min.y < 1.6);
    W.tableBikes = [];
    for (const back of [4, 6, 8, 10]) { for (let k = -4; k <= 4 && W.tableBikes.length < 3; k++) { const x = g.x - ux * back + px * (5 + k * 2.4), z = g.z - uz * back + pz * (5 + k * 2.4); if (clearAt(x, z) && W.tableBikes.every((b) => Math.hypot(b.x - x, b.z - z) > 2.2)) W.tableBikes.push({ x, y: 0, z, yaw: Math.atan2(ux, uz) }); } if (W.tableBikes.length >= 3) break; }
  }
  (W.mapPOIs || (W.mapPOIs = [])).push({ name: 'LUNA PARK HOUSES', x: b2.centre.x, z: b2.centre.z - 30, kind: 'landmark' });
  buildKit(world, { cash: START_CASH, title: 'CONEY — CONTROLS',
    help: 'Igor has side jobs (F → Got any work?)<br>F · talk (Igor, Sammy) / elevator / steal car / hop in / rob a passer-by<br>B · blaze or drink (stand close to share)<br>P · take a leak · Kills pay cash · N · give a friend $10 · X · swipe car GPS units (SHADES buys)<br>Driving: Shift nitro · Q horn · V camera · Space handbrake (car) / JUMP (bike — hold, release)<br>M · map · L · Luna Park Radio · . next track<br>Belt Pkwy: ramps at the north end of W 8th St and Stillwell Av, the east end of Brighton Beach Av, either end of 8th Av; keep right for your exit<br>Roof: stairs at the end of the 19th-floor lobby (shoulder the door) · stairwell down: side door<br>Sammy\'s deli: W 8th St, across from the towers',
    respawn: { label: 'Table Park', at: () => W.onlineStart } });
  if (igorFig) H.igorHurt = K.hurtable(igorFig, { name: 'IGOR' });
  K.spot({ pos: H.igor, r: 2.4, when: () => !H.igorHurt?.down, prompt: 'F — TALK TO IGOR', act: talkIgor });
  // every Luna Park tower: 3 lobby cars up to the 19th floor, each gallery side's cars back down (shaft index = tower index)
  for (const t of towers) K.shaft({ kind: 'elevator', floors: 19, lobby: { cars: t.lobby.cars }, tops: t.top.map((s) => ({ cars: s.cars, face: s.view.yaw })) });
  try { placeDeli(world); } catch (e) { console.warn('[hangout] deli', e); }
  try { buildStores(world, H.deli ? [H.deli.door] : []); } catch (e) { console.warn('[hangout] stores', e); }
  try { buildLocals(world, H); } catch (e) { console.warn('[hangout] locals', e); }   // POPS, SHADES, NET GOST + the mangal (coney/locals.js)
  try { if (ctx.mode === 'chill') buildChill(world, H); else buildCrews(world); } catch (e) { console.warn('[hangout] chill/crews', e); }
  try { buildJobs(world); } catch (e) { console.warn('[hangout] jobs', e); }
  try { buildDurakPark(); } catch (e) { console.warn('[hangout] durak park', e); }
  // ?skip=tavern,brighton,… leaves areas out (to find what tips a phone over on memory)
  const skip = new Set(String(world.ctx.qs?.get?.('skip') || '').split(','));
  if (!skip.has('tavern')) try { buildTavern(world); } catch (e) { console.warn('[hangout] tavern', e); }
  if (!skip.has('brighton')) try { buildBrighton(world); } catch (e) { console.warn('[hangout] brighton', e); }
  try { buildJetpacks(world); } catch (e) { console.warn('[hangout] jetpacks', e); }   // three jet packs on a rack by the table
  try { redkoAtTablePark(world); } catch (e) { console.warn('[hangout] redko', e); }
  try { crewTalk(world); } catch (e) { console.warn('[hangout] crew talk', e); }
  { let tries = 0; const t = setInterval(() => { if (world.W.babFigs?.length || ++tries > 60) { clearInterval(t); try { babushkas(world); } catch (e) { console.warn('[hangout] babushkas', e); } } }, 250); }   // greens.js seats them later in the build   // the bench grannies (greens.js seats them)   // ARKASHA's card table by building 1 (coney/durak.js)   // Igor's side work (coney/jobs.js)   // chill mode / the crews that roll through (coney/chill.js)
  // the Wonder Wheel: ride a cabin all the way round (~2.5 min) — look around and snipe from the top; F gets you off
  const wheelSpot = () => { const WW = W.wonderWheel; if (!WW || H.wheelSpot) return; H.wheelSpot = K.spot({ pos: WW.base, r: 3.2, dy: 2, prompt: 'F — RIDE THE WONDER WHEEL', act: () => rideWheel(WW) }); };   // landmarks build after the hangout
  buildDoors(world);
  ctx.bus.on('net:red', (m) => { if (H?.world === world) onRemoteRed(m); });
  try { buildRoofDoors(towers); } catch (e) { console.warn('[hangout] roof doors', e); }   // stuck roof doors you shoulder open
  ctx.bus.on('net:igor', (m) => ctx.hud?.toast?.(`${ctx.net?.peer?.(m.f)?.name || 'Someone'} bought from Igor`, 1800));
  world.updaters.push(() => { if (H?.world === world) { wheelSpot(); updateDoors(ctx.time.dt || 0.016); updateRed(); updateWheelRide(ctx.time.dt || 0.016); } });
  ctx.bus.on('playerDied', () => { if (H?.wheel) H.wheel = null; });
  console.log('[hangout] building 2 at', b2.centre.toArray().map((v) => v.toFixed(0)).join(','), '· igor at', igor.x.toFixed(0), igor.z.toFixed(0), '· towers', towers.length, '· parked cars', (world.parkedCars || []).length, '· deli', H.deli ? H.deli.door.toArray().map((v) => v.toFixed(0)).join(',') : 'none');
}
const stealLocal = (i, mine) => K.stealLocal(i, mine);

// ---- Sammy's deli: east side of W 8th St (the divided road along Luna Park's east edge), between Neptune Ave and the
// shopping-centre driveway. The storefront faces the street; first free spot along the kerb wins.
function placeDeli(world) {
  const { ctx } = world;
  const clear = (fx, fz, u, n) => { // footprint 8.5 x 12 (+ 2 m of sidewalk in front) must be free of colliders
    for (let a = -4.6; a <= 4.6; a += 0.8) for (let d = -2; d <= 11.6; d += 0.8) { const x = fx + u.x * a + n.x * d, z = fz + u.y * a + n.y * d;
      if (ctx.colliders.some((b) => !(b.max.y <= 1.6 && b.max.x - b.min.x < 5.2 && b.max.z - b.min.z < 5.2) && x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y > 0.4 && b.min.y < 3)) return false; }   // parked cars don't count (they're moved)
    return true; };
  // across the street from Luna Park: the east kerb north of Neptune Ave, then the east kerb south of it; the Luna Park side last
  for (const [ax, az, bx, bz, side] of [[393, -469, 406, -530, 1], [368, -352, 393, -469, 1], [384, -478, 327, -219, -1]]) {
    const A = new THREE.Vector2(ax, az), u = new THREE.Vector2(bx - ax, bz - az).normalize(); const n = new THREE.Vector2(-u.y, u.x); if (Math.sign(n.x) !== side) n.negate();
    const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(n.x, n.y);
    const order = []; for (let s = 6; s < len - 6; s += 3) order.push(s);
    order.sort((p, q) => Math.abs(A.y + u.y * p + 415) - Math.abs(A.y + u.y * q + 415));   // nearest to z −415 (level with building 2's park) first
    for (const s of order) {
      const fx = A.x + u.x * s + n.x * 8.5, fz = A.y + u.y * s + n.y * 8.5;
      if (!clear(fx, fz, u, n)) continue;
      for (const [i, c] of (world.parkedCars || []).entries()) { if (c.gone) continue; const dx = c.x - fx, dz = c.z - fz, a = dx * u.x + dz * u.y, d = dx * n.x + dz * n.y; if (Math.abs(a) < 6 && d > -4 && d < 13) K.stealLocal(i, false); }   // clear the kerb
      const D = buildDeli(world, { x: fx, z: fz, yaw, name: "SAMMY'S DELI & GROCERY" });
      H.deli = D; (world.W.mapPOIs || (world.W.mapPOIs = [])).push({ name: "SAMMY'S DELI", x: D.door.x, z: D.door.z, kind: 'shop' });
      K.vendor({ name: 'SAMMY', pos: D.sammy, r: 2.3, fig: D.fig, talk: sammyTalk('SAMMY', { extra: (Kk, after) => [...sammyLotion(Kk, after), ...sammyBar(after)] }) });
      return;
    }
  }
  console.warn('[hangout] no free spot for the deli on W 8th St');
}

// ---- the rest of the block: a bodega, a pizzeria, Chinese takeout, a liquor store … on free stretches of the main streets. Every
// one walks in (the shared store kit in deli.js: no extra lights or textures per store) and has someone behind the counter.
const STORES = [
  { type: 'bodega', name: 'MERMAID DELI & GROCERY', who: 'ALI', avatar: 'm20', shirt: 0x2f4a3a },
  { type: 'pizza', name: "COSMO'S PIZZA", who: 'COSMO', avatar: 'm10', shirt: 0xf0efe6 },
  { type: 'chinese', name: 'GOLDEN DRAGON 金龍 KITCHEN', who: 'MRS. CHEN', avatar: 'f09', bun: true, shirt: 0x8a1a1a, hair: 0x111111 },
  { type: 'liquor', name: 'SURF WINE & LIQUOR', who: 'RAJ', avatar: 'm02', shirt: 0x2a3550 },
  { type: 'bodega', name: 'NEPTUNE CANDY & GROCERY', who: 'HECTOR', avatar: 'm10', shirt: 0x5a3a20 },
  { type: 'pizza', name: "TONY'S PIZZERIA", who: 'TONY JR.', avatar: 'm20', shirt: 0xe9e2cf },
];
const STORE_SPACING = 70, STORE_N = { full: 6, lite: 4 };
const STORE_REACH = 14;   // m around the storefront that must be walkable (the store is 8 x 11 behind its door, plus the sidewalk)
function playable(world, c, m) {
  const W = world.W, B = W.bounds, Z = W.zones || [];
  const inside = (x, z) => (B && x > B.min.x && x < B.max.x && z > B.min.z && z < B.max.z) || Z.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  return [[-m, -m], [m, -m], [-m, m], [m, m], [0, 0]].every(([dx, dz]) => inside(c.x + dx, c.z + dz));
}
export function buildStores(world, avoid = []) {
  const want = world.ctx.lite ? STORE_N.lite : STORE_N.full, placed = [...avoid], out = [];
  // candidate frontages: along the wide streets, a store's depth back from the kerb, facing the street (door toward the road)
  const cands = [];
  for (const r of OSM.r) { if (r.w < 12) continue; for (let i = 0; i + 1 < r.p.length; i++) { const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 20) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L; for (let d = 10; d < L - 10; d += 25) for (const side of [-1, 1]) { const nx = -uz * side, nz = ux * side, off = r.w / 2 + 3.5;
      cands.push({ x: ax + ux * d + nx * off, z: az + uz * d + nz * off, yaw: Math.atan2(nx, nz) }); } } }
  let seed = 4242; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
  for (const c of cands) {
    if (out.length >= want) break;
    if (placed.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < STORE_SPACING)) continue;
    if (!playable(world, c, STORE_REACH)) continue;   // inside the walkable world (the map bounds or a zone like Brighton): the whole store
    const spot = findDeliSpot(world, [c], 6, { fallback: false }); if (!spot) continue;
    const S = STORES[out.length % STORES.length];
    try {
      const D = buildDeli(world, { ...spot, name: S.name, style: S.type, vendorName: S.who, avatar: S.avatar, shirt: S.shirt, bun: S.bun, hair: S.hair, lamp: false });
      K.vendor({ name: S.who, pos: D.sammy, r: 2.3, fig: D.fig, talk: storeTalk(S.type, S.who) });
      (world.W.mapPOIs || (world.W.mapPOIs = [])).push({ name: S.name.split(' ').slice(0, 2).join(' '), x: D.door.x, z: D.door.z, kind: 'shop' });
      placed.push(spot); out.push({ ...spot, type: S.type, name: S.name, who: S.who, counter: D.counter.toArray(), door: D.door.toArray() });
    } catch (e) { console.warn('[hangout] store', S.name, e); }
  }
  console.log('[hangout] stores:', out.map((s) => s.name).join(' · '));
  if (typeof window !== 'undefined' && window.__game) window.__game.stores = out;
  return out;
}

function buildIgor(world, M, pos) {
  const { scene } = world; const R = world.R;
  const toB2 = Math.atan2(-(H?.b2?.centre.x ?? B2.x) + pos.x, -(H?.b2?.centre.z ?? B2.z) + pos.z);   // faces building 2
  // ---- the little park: fenced concrete pad, rundown picnic tables, NYC benches, bin, lamp ------------------------------
  const park = new THREE.Group(); park.position.copy(pos); park.rotation.y = toB2; scene.add(park);
  const Wd = 22, Dd = 16;
  const conc = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 });
  { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#a19e96'; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 2500; k++) { const v = 120 + Math.random() * 70; g.fillStyle = `rgba(${v},${v},${v - 6},0.35)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    g.strokeStyle = 'rgba(60,58,54,0.7)'; g.lineWidth = 2; for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * 64, 0); g.lineTo(k * 64, 256); g.stroke(); g.beginPath(); g.moveTo(0, k * 64); g.lineTo(256, k * 64); g.stroke(); }
    for (let k = 0; k < 14; k++) { g.strokeStyle = 'rgba(50,48,44,0.5)'; g.lineWidth = 1; g.beginPath(); let x = Math.random() * 256, y = Math.random() * 256; g.moveTo(x, y); for (let q = 0; q < 5; q++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(30,28,24,0.18)'; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 16, 4 + Math.random() * 10, 0, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(Wd / 4, Dd / 4); conc.map = t; conc.color.set(0xffffff); }
  const pad = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.1, Dd), conc); pad.position.y = 0.05; pad.receiveShadow = true; park.add(pad);
  const iron = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.55, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7d7466, roughness: 0.95 }), woodOld = new THREE.MeshStandardMaterial({ color: 0x5f5a50, roughness: 1 }), benchGreen = new THREE.MeshStandardMaterial({ color: 0x2f4a36, roughness: 0.7, metalness: 0.2 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; park.add(m); return m; };
  const W2 = new THREE.Vector3(), Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), toB2);
  const wbox = (lx0, y0, lz0, lx1, y1, lz1) => { const cs = [[lx0, lz0], [lx1, lz0], [lx0, lz1], [lx1, lz1]].map(([x, z]) => W2.set(x, 0, z).applyQuaternion(Q).add(pos).clone()); world.box([Math.min(...cs.map((c) => c.x)), y0, Math.min(...cs.map((c) => c.z))], [Math.max(...cs.map((c) => c.x)), y1, Math.max(...cs.map((c) => c.z))]); };
  // black picket fence (1.2 m) around the pad, 2.5 m gate gap facing the building (+z local = toward building 2 after the yaw)
  const fence = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0); for (const y of [0.25, 1.1]) add(new THREE.BoxGeometry(L, 0.04, 0.04), iron, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, -a); for (let k = 0; k <= L / 0.13; k++) { const t = k * 0.13 / L; add(new THREE.BoxGeometry(0.02, 1.22, 0.02), iron, x0 + (x1 - x0) * t, 0.61, z0 + (z1 - z0) * t); } const n = 12; for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n; wbox(Math.min(x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1) - 0.06, 0, Math.min(z0 + (z1 - z0) * t0, z0 + (z1 - z0) * t1) - 0.06, Math.max(x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1) + 0.06, 1.2, Math.max(z0 + (z1 - z0) * t0, z0 + (z1 - z0) * t1) + 0.06); } };
  const hx = Wd / 2, hz = Dd / 2;
  // wide openings on every side (6.4 m at the front gate, 5 m back and sides) — ride a bike straight through
  // (no fence: the crew hangs out here and walks in from every side)
  H.gate = new THREE.Vector3(0, 0, hz + 3).applyAxisAngle(new THREE.Vector3(0, 1, 0), toB2).add(pos);   // just outside the gate
  H.park = { pos: pos.clone(), yaw: toB2, hx, hz };
  // rundown picnic tables: faded slats, one missing plank, one knocked askew
  const table = (x, z, ry, broken) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = ry; park.add(g);
    const slats = broken ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];
    for (const k of slats) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.045, 0.14), k % 2 ? wood : woodOld); m.position.set(0, 0.74, -0.32 + k * 0.16); m.rotation.z = (Math.random() - 0.5) * 0.03; m.castShadow = true; g.add(m); }
    for (const sz of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.045, 0.26), woodOld); m.position.set(0, 0.44, sz * 0.72); m.castShadow = true; g.add(m); }
    for (const sx of [-0.75, 0.75]) for (const s2 of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), iron); leg.position.set(sx, 0.4, s2 * 0.4); leg.rotation.x = s2 * 0.62; g.add(leg); }
    const c = Math.abs(Math.cos(ry)) > 0.7; wbox(x - (c ? 1 : 0.95), 0, z - (c ? 0.95 : 1), x + (c ? 1 : 0.95), 0.8, z + (c ? 0.95 : 1)); };
  table(-6.5, -3.5, 0.05, false); table(-6, 2.8, -0.1, true); table(-3.1, -1.9, 0.02, false);   /* moved off the back opening */ table(6.8, -2.5, 0.35, false);
  // two green NYC slat benches along the fence; Igor sits on the one by the gate
  const bench = (x, z, ry) => { const g = new THREE.Group(); g.position.set(x, 0.1, z); g.rotation.y = ry; park.add(g);
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.045, 0.12), benchGreen); m.position.set(0, 0.45, -0.18 + k * 0.15); g.add(m); }
    for (let k = 0; k < 2; k++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.04), benchGreen); m.position.set(0, 0.62 + k * 0.17, -0.27); m.rotation.x = -0.18; g.add(m); }
    for (const sx of [-0.85, 0.85]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.5), iron); m.position.set(sx, 0.4, -0.05); g.add(m); } return g; };
  const igorBench = bench(3.2, 5.6, Math.PI); bench(-4, -7, 0);
  wbox(2.2, 0, 5.2, 4.2, 0.9, 6.1); wbox(-5, 0, -7.4, -3, 0.9, -6.5);
  add(new THREE.CylinderGeometry(0.3, 0.28, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0x1f3d2a, roughness: 0.6, metalness: 0.3 }), -9.5, 0.55, 6.5);
  add(new THREE.CylinderGeometry(0.07, 0.1, 5.5, 8), iron, 9.5, 2.85, 6.8); add(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffe0a0, emissiveIntensity: 0.6 }), 9.5, 5.7, 6.8);
  for (let k = 0; k < 14; k++) add(new THREE.BoxGeometry(0.08 + Math.random() * 0.12, 0.01, 0.05 + Math.random() * 0.1), new THREE.MeshStandardMaterial({ color: [0xe8e2d0, 0xc8201e, 0x2a62c8, 0xf2c418][k % 4], roughness: 0.9 }), (Math.random() - 0.5) * Wd * 0.9, 0.11, (Math.random() - 0.5) * Dd * 0.9, 0, Math.random() * 3);
  // ---- Igor: short (1.62 m), heavy-set, buzz-cut dark hair, black t-shirt, dark jeans, white sneakers, sitting -----------
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b594, roughness: 0.6 }), shirt = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.9 }), jeans = new THREE.MeshStandardMaterial({ color: 0x28324a, roughness: 0.85 }), hair = new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.9 }), shoe = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6 });
  const igor = new THREE.Group(); igorBench.add(igor); igor.position.set(0.35, 0, 0.05);
  const REAL = peopleReady();   // realistic Igor (world/people.js) replaces the capsule one
  const part = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => { if (REAL) return null; const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, 0, rz); m.castShadow = true; igor.add(m); return m; };
  part(new THREE.SphereGeometry(0.3, 16, 12), shirt, 0, 0.82, 0.02, 1.25, 1.05, 1.15);          // big round belly + chest
  part(new THREE.SphereGeometry(0.26, 14, 10), shirt, 0, 1.1, 0.0, 1.3, 0.8, 1.0);              // shoulders
  part(new THREE.CylinderGeometry(0.1, 0.11, 0.12, 12), skin, 0, 1.3, 0.02);                   // neck (short)
  part(new THREE.SphereGeometry(0.13, 16, 12), skin, 0, 1.44, 0.03, 1.02, 1.08, 1.05);         // head, round
  part(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 1.47, 0.015, 1.02, 0.75, 1.05); // buzz cut
  part(new THREE.SphereGeometry(0.03, 8, 6), skin, 0, 1.43, 0.16);                             // nose
  for (const s2 of [-1, 1]) {
    part(new THREE.SphereGeometry(0.022, 8, 6), skin, s2 * 0.13, 1.44, 0.03);                  // ears
    part(new THREE.CapsuleGeometry(0.075, 0.12, 4, 10), shirt, s2 * 0.36, 1.03, 0.02, 1, 1, 1, 0, s2 * 0.25);   // sleeves
    part(new THREE.CapsuleGeometry(0.06, 0.22, 4, 10), skin, s2 * 0.4, 0.8, 0.14, 1, 1, 1, -0.9, s2 * 0.1);     // forearms on the thighs
    part(new THREE.SphereGeometry(0.055, 8, 6), skin, s2 * 0.34, 0.62, 0.3);                    // hands
    part(new THREE.CapsuleGeometry(0.1, 0.34, 4, 10), jeans, s2 * 0.14, 0.52, 0.22, 1.1, 1, 1, Math.PI / 2);     // thighs
    part(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10), jeans, s2 * 0.15, 0.27, 0.44);          // shins
    part(new THREE.BoxGeometry(0.11, 0.08, 0.27), shoe, s2 * 0.15, 0.05, 0.5);                 // sneakers
  }
  // merge the static park (pad, fence, tables, benches, litter, Igor) into one mesh per material: it was ~600 draw calls
  { park.updateMatrixWorld(true); const inv = park.matrixWorld.clone().invert(); const byMat = new Map(); const kill = [];
    park.traverse((o) => { if (!o.isMesh) return; const g = o.geometry.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld)); const gg = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k); if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2)); (byMat.get(o.material) || byMat.set(o.material, []).get(o.material)).push(gg); kill.push(o); });
    for (const o of kill) o.parent.remove(o);
    for (const [mat, list] of byMat) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = mat !== iron; m.receiveShadow = true; park.add(m); } }
  if (REAL) { const pf = buildPerson({ avatar: 'm03', pose: 'sit', seed: 3 }); pf.group.position.set(0, -0.1, 0.12); igor.add(pf.group); igorFig = pf; world.updaters.push((dt) => pf.update(dt, 0)); }
  const ipos = igorBench.getWorldPosition(new THREE.Vector3()); ipos.y = 0;
  // name tag
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.font = '700 34px Barlow, Arial'; x.textAlign = 'center'; x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(40, 10, 176, 44); x.fillStyle = '#ffd27a'; x.fillText('IGOR', 128, 44);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })); tag.scale.set(1.1, 0.28, 1); tag.position.set(0, 1.95, 0); igor.add(tag); fadeNear(tag);
  return ipos;
}

// ---- lobby doors: two sliding glass leaves in every closed lobby entrance; closed = collider, open when anyone is within 2.5 m ----
function buildDoors(world) {
  const { ctx, scene } = world; H.doors = [];
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fb0b8, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.45, envMapIntensity: 1.3 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.8 });
  for (const t of H.towers) for (const d of t.lobby.doors) {
    if (d.open) continue;   // the Luna towers' ground floor is an open breezeway (housing.js): nothing to slide
    const g = new THREE.Group(); g.position.copy(d.plane); g.rotation.y = Math.atan2(d.along.x, d.along.z) - Math.PI / 2; scene.add(g);
    const leaves = [-1, 1].map((s2) => { const L = new THREE.Group(); const fg = []; const pane = new THREE.Mesh(new THREE.BoxGeometry(d.half - 0.04, 2.1, 0.03), glass); pane.position.y = 1.05; L.add(pane);
      for (const [w, h, x, y] of [[d.half, 0.08, 0, 2.1], [d.half, 0.08, 0, 0.04], [0.06, 2.1, s2 * (d.half / 2 - 0.03), 1.05], [0.06, 2.1, -s2 * (d.half / 2 - 0.03), 1.05], [0.04, 0.5, -s2 * (d.half / 2 - 0.2), 1.1]]) fg.push(new THREE.BoxGeometry(w, h, 0.06).translate(x, y, 0));
      L.add(new THREE.Mesh(mergeGeometries(fg), frame));   // the five frame bars as one mesh: one draw call a leaf, not five
      L.position.x = s2 * d.half / 2; g.add(L); return { L, s2 }; });
    const hw = d.half + 0.1, ax = d.along; const box = new THREE.Box3(new THREE.Vector3(d.plane.x - Math.abs(ax.x) * hw - Math.abs(ax.z) * 0.12, 0, d.plane.z - Math.abs(ax.z) * hw - Math.abs(ax.x) * 0.12), new THREE.Vector3(d.plane.x + Math.abs(ax.x) * hw + Math.abs(ax.z) * 0.12, 2.3, d.plane.z + Math.abs(ax.z) * hw + Math.abs(ax.x) * 0.12));
    ctx.colliders.push(box);
    H.doors.push({ d, leaves, box, open: 0, closed: true });
  }
}
function updateDoors(dt) {
  const { ctx } = H; const who = [ctx.player?.position]; const net = ctx.net; if (net?.list) for (const id of net.list()) { const q = net.peer(id); if (q) who.push(q.pos); }
  let changed = false;
  for (const D of H.doors) {
    const near = who.some((p) => p && Math.hypot(p.x - D.d.plane.x, p.z - D.d.plane.z) < 2.6 && Math.abs(p.y - D.d.plane.y) < 2);
    D.open = Math.max(0, Math.min(1, D.open + (near ? 3 : -2) * dt));
    for (const { L, s2 } of D.leaves) L.position.x = s2 * (D.d.half / 2 + D.open * (D.d.half - 0.05));
    const wantClosed = D.open < 0.3;
    if (wantClosed !== D.closed) { D.closed = wantClosed; if (wantClosed) ctx.colliders.push(D.box); else { const k = ctx.colliders.indexOf(D.box); if (k > -1) ctx.colliders.splice(k, 1); } changed = true; }
  }
  if (changed) try { ctx.player?.rebuildColliders?.(); } catch {}
}

// ---- the red car: the group's ride, parked by building 2. One real drivable car per client; whoever drives it announces
// 'red' taken/parked so every other client hides / re-parks its copy (the driver is shown by net.js as a red remote car).
const KERB_SLOT = 5;   // m: a parked car closer than this to a spawned one is in its slot
function buildRedCar(world) {
  const { ctx } = H; const cars = world.parkedCars || []; const [sx, , sz] = world.W.onlineStart || [H.b2.centre.x, 0, H.b2.centre.z];
  let best = null, bd = 1e9; for (const c of cars) { if (c.gone || c.kind === 'van') continue; const d = Math.hypot(c.x - sx, c.z - sz); if (d > 12 && d < bd) { bd = d; best = c; } }
  if (!best || !ctx.vehicles?.spawnCar) return;
  const i = cars.indexOf(best); stealLocal(i, false);   // the kerb slot becomes the red car
  // panels: false - these sit for the whole session until someone actually drives or shoots one (ensurePanels in
  // vehicles.js splits the body then); eagerly splitting all 4 at boot cost ~30 extra draws apiece for cars nobody's touched
  const car = ctx.vehicles.spawnCar(best.x, best.z, (best.ry || 0) - Math.PI / 2, 'coupe', 0xb3121c, 0, false);
  if (!car) return; car.isRed = true; H.red = { car, mine: false, hidden: false };
  { const hd = (best.ry || 0) - Math.PI / 2, fx = -Math.sin(hd), fz = -Math.cos(hd);   // Soviet classics parked along the same kerb (drivable)
    for (const [d, kind, col] of [[-6.2, 'lada', 0xe8dcb4], [6.4, 'volga', 0x141414], [12.6, 'moskvich', 0x8fb3c8]]) { const x = best.x + fx * d, z = best.z + fz * d;
      cars.forEach((c, k) => { if (!c.gone && Math.hypot(c.x - x, c.z - z) < KERB_SLOT) stealLocal(k, false); });   // it takes that kerb slot: the instanced car parked there goes (they sat 0.8 m apart)
      try { ctx.vehicles.spawnCar(x, z, hd, kind, col, 0, false); } catch (e) { console.warn('[hangout] soviet car', kind, e); } } }
  // a red marker so friends can find it
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.font = '700 30px Barlow, Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(20, 10, 216, 44); g.fillStyle = '#ff5a5a'; g.fillText('THE RED CAR', 128, 42);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })); tag.scale.set(1.8, 0.45, 1); tag.position.set(0, 2.4, 0); car.group.add(tag); H.red.tag = tag;
}
function redHide(v) { const r = H.red; if (!r || r.hidden === v) return; r.hidden = v; const car = r.car; car.group.visible = !v;
  if (v) { r.saved = car.pos.clone(); car.pos.y = -500; } else if (r.saved && car.pos.y < -100) car.pos.copy(r.saved);   // hidden copy must not be mountable (vehicles.js finds cars by pos)
  const k = H.ctx.colliders.indexOf(car.box); if (v && k > -1) H.ctx.colliders.splice(k, 1); if (!v && k < 0) H.ctx.colliders.push(car.box); try { H.ctx.player?.rebuildColliders?.(); } catch {} }
function updateRed() {
  if (!H.redTried && H.ctx.vehicles?.spawnCar) { H.redTried = true; try { buildRedCar(H.world); } catch (e) { console.warn('[hangout] red car', e); } }   // vehicles.js boots after the world
  const r = H.red; if (!r) return; const mv = H.ctx.vehicles?.mounted;
  if (mv === r.car && !r.mine) { r.mine = true; r.tag.visible = false; H.ctx.net?.send?.('red', { s: 'taken' }); }
  else if (r.mine && mv !== r.car) { r.mine = false; r.tag.visible = true; const c = r.car; H.ctx.net?.send?.('red', { s: 'parked', p: [+c.pos.x.toFixed(2), +c.pos.y.toFixed(2), +c.pos.z.toFixed(2)], h: +c.heading.toFixed(3) }); }
}
function onRemoteRed(m) {
  const r = H.red; if (!r || r.mine) return;
  if (m.s === 'taken') return redHide(true);
  if (m.s === 'parked' && Array.isArray(m.p) && m.p.every((v) => Number.isFinite(+v))) { const c = r.car; c.pos.set(+m.p[0], +m.p[1] || 0, +m.p[2]); c.heading = +m.h || 0; c.group.position.copy(c.pos); c.group.rotation.set(0, c.heading, 0);
    const cs = Math.cos(c.heading), sn = Math.sin(c.heading), hx = Math.abs(cs) * 0.95 + Math.abs(sn) * 2.35, hz = Math.abs(sn) * 0.95 + Math.abs(cs) * 2.35; c.box.min.set(c.pos.x - hx, c.pos.y, c.pos.z - hz); c.box.max.set(c.pos.x + hx, c.pos.y + 1.5, c.pos.z + hz); redHide(false); }
}

// ---- the Wonder Wheel ride ------------------------------------------------------------------------------------------------
const _ww = new THREE.Vector3();
function rideWheel(WW) {
  let best = 0, by = Infinity; for (let i = 0; i < WW.n; i++) { const y = WW.pos(i, _ww).y; if (y < by) { by = y; best = i; } }   // the cabin at the bottom
  H.wheel = { WW, i: best, t: 0, promptT: 0 }; H.ctx.player.mounted = { wheel: true };
  H.ctx.hud?.toast?.('All aboard — F to get off', 1800);
}
function updateWheelRide(dt) {
  const r = H.wheel; if (!r) return; const { ctx } = H; const p = ctx.player;
  if (p.dead || !p.mounted?.wheel) { H.wheel = null; return; }
  r.t += dt; r.promptT -= dt;
  const at = r.WW.pos(r.i, _ww);
  const off = r.t > 20 && at.y < r.WW.base.y + 1.2;   // came round to the bottom again
  if (off || (ctx.state === 'playing' && ctx.input?.pressed?.has?.('KeyF'))) {
    ctx.input?.pressed?.delete?.('KeyF'); H.wheel = null; p.mounted = null; const b = r.WW.base; p.teleport(b.x + 1.5, b.y, b.z - 1.2, p.yaw, 0); return;
  }
  if (r.promptT <= 0) { ctx.hud?.toast?.('F — GET OFF THE WHEEL', 900); r.promptT = 3; }
  p.position.copy(at); p.velocity?.set?.(0, 0, 0);
  const cam = ctx.camera; cam.position.set(at.x, at.y + 1.55, at.z); cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ'); p.cameraPosition?.copy?.(cam.position);
  ctx.interactNear = true;
}

// ---- Igor -------------------------------------------------------------------------------------------------------------------
/** Igor's bench: a conversation, not a vending machine */
const IGOR_GOSSIP = [
  'Sammy? Good man. Strange questions. Don\'t answer them, just buy.',
  'Olga at Net Gost — her shashlik on the mangal here, and Vitek gets very friendly. You understand.',
  'Top of the tower there is a roof. Nineteen floors. You can see Rockaway, you can see your whole life.',
  'Train at Stillwell kills more people than mercenaries. Stay off the tracks, genius.',
  'The guy with sunglasses? Don\'t buy. Or buy. But then you go see Sammy. For the lotion.',
  'Pops in the cart — give him a sip of your forty, he fights like it\'s 1971.',
  'In my day we had one bench, one bottle, and we were happy. Now you have bench AND map.',
];
function igorSell(item) {
  const { ctx } = H;
  if (K.full()) return { text: 'IGOR: "Finish what you got first. B to use."', choices: [{ label: 'Fair', go: null }] };
  if (!K.pay(PRICE)) return { text: 'IGOR: "No money, no honey. Go shoot somebody who has wallet."', choices: [{ label: '…', go: null }] };
  K.give(item); try { ctx.audio?.play?.('ui_click'); } catch {}
  ctx.net?.send?.('igor');
  return { text: item === 'weed' ? 'IGOR: "Ten bucks. B to blaze — and pass it, don\'t be greedy."' : 'IGOR: "Bottle. B to drink. Share with the boys, or they remember."', choices: [{ label: 'Spasibo, Igor', go: null }] };
}
function talkIgor() {
  const again = H.buys++ > 0;
  K.openDialog('IGOR', {
    text: again ? 'IGOR: "Back again. You like Igor, or you like what Igor has?"' : 'IGOR: "Sit, sit. Is free bench. Everything else — ten dollars."',
    choices: [
      { label: `A bag — $${PRICE}`, go: () => igorSell('weed') },
      { label: `A bottle — $${PRICE}`, go: () => igorSell('bottle') },
      { label: 'Got any work?', go: () => jobsTalk() },
      { label: 'Need a piece', go: () => gunShop('IGOR', ['m9', 'r870', 'ak74', 'm24'], 'IGOR: "Shh. Not so loud. Under the bench I have… options. Cash only, no questions, no refunds."') },
      { label: 'What\'s the word?', go: () => ({ text: `IGOR: "${IGOR_GOSSIP[Math.floor(Math.random() * IGOR_GOSSIP.length)]}"`, choices: [{ label: 'Heard', go: null }] }) },
      { label: 'Later', go: null },
    ],
  });
}
function buyIgor() { const { ctx } = H; const r = igorSell(H.buys++ % 2 === 0 ? 'weed' : 'bottle'); ctx.hud?.toast?.(r.text, 2400); }   // QA shortcut

// ---- the roof bulkhead doors: stuck; shoulder them open (F, a few shoves), they swing shut again after a couple of minutes ----
const SHOVES = 4, DOOR_OPEN_S = 150;
function buildRoofDoors(towers) {
  const { world, ctx } = H; const mat = new THREE.MeshStandardMaterial({ color: 0x59616a, roughness: 0.5, metalness: 0.65 }), bar = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.9 });
  H.roofDoors = towers.map((t, i) => {
    const d = t.roof?.door; if (!d) return null;
    const pivot = new THREE.Group(); pivot.position.copy(d.hinge); pivot.rotation.y = Math.atan2(-d.along.z, d.along.x); world.scene.add(pivot);
    const zW = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), pivot.rotation.y), s = Math.sign(zW.dot(d.out)) || 1;
    const swing = new THREE.Group(); pivot.add(swing);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(d.width - 0.04, 2.12, 0.05), mat); leaf.position.set(d.width / 2, 1.07, 0); leaf.castShadow = true; swing.add(leaf);
    const pb = new THREE.Mesh(new THREE.BoxGeometry(d.width * 0.6, 0.05, 0.05), bar); pb.position.set(d.width / 2, 1.0, -s * 0.06); swing.add(pb);   // push bar on the stair side
    const box = world.box(d.min.toArray(), d.max.toArray());
    const D = { i, d, swing, s, box, shoves: 0, open: false, until: 0, ang: 0, jolt: 0 };
    const act = () => shoveDoor(D);
    K.spot({ pos: d.inside, r: 1.5, dy: 2.2, when: () => !D.open, prompt: () => `F — SHOULDER THE DOOR (${D.shoves}/${SHOVES})`, act });
    K.spot({ pos: d.outside, r: 1.5, dy: 2.2, when: () => !D.open, prompt: () => `F — YANK THE DOOR (${D.shoves}/${SHOVES})`, act });
    return D;
  });
  ctx.bus.on('net:rdoor', (m) => { const D = H.roofDoors[m.i | 0]; if (D) setDoor(D, !!m.o, false); });
  ctx.bus.on('worldReset', () => { closeDurak(); for (const D of H.roofDoors) if (D) { setDoor(D, false, false); D.shoves = 0; } });
  K.onUpdate((dt) => {
    for (const D of H.roofDoors) { if (!D) continue;
      const want = D.open ? -D.s * 1.75 : 0; D.ang += (want - D.ang) * Math.min(1, dt * (D.open ? 7 : 3)); D.jolt *= Math.exp(-dt * 10);
      D.swing.rotation.y = D.ang + D.jolt;
      if (D.open && performance.now() > D.until) { const p = ctx.player.position; if (!(p.x > D.box.min.x - 0.6 && p.x < D.box.max.x + 0.6 && p.z > D.box.min.z - 0.6 && p.z < D.box.max.z + 0.6 && Math.abs(p.y - D.d.min.y) < 2)) setDoor(D, false, false); }
    }
  });
}
function shoveDoor(D) {
  const { ctx } = H; D.shoves++; D.jolt = -D.s * 0.06;
  try { ctx.audio?.play?.('impact_metal', { volume: 1.3 }); } catch {}
  const p = ctx.player; if (p) { p.landImpulse = Math.max(p.landImpulse || 0, 0.8); p.pitch += 0.03; }   // the shoulder hit jars the camera
  const lines = ['It\'s stuck. Put your shoulder into it.', '*CLANG* — it gave a little.', 'One more…'];
  if (D.shoves >= SHOVES) { setDoor(D, true, true); K.toast('BANG — the door flies open. Fresh air.', 2200); }
  else K.toast(lines[Math.min(lines.length - 1, D.shoves - 1)], 1400);
}
function setDoor(D, open, send) {
  const { ctx } = H; if (D.open === open) return;
  D.open = open; D.shoves = 0;
  const k = ctx.colliders.indexOf(D.box);
  if (open) { D.until = performance.now() + DOOR_OPEN_S * 1000; if (k > -1) ctx.colliders.splice(k, 1); }
  else if (k < 0) ctx.colliders.push(D.box);
  try { ctx.player?.rebuildColliders?.(); } catch {}
  if (send) ctx.net?.send?.('rdoor', { i: D.i, o: open ? 1 : 0 });
}

// ---- ARKASHA's card table: a little paved park off building 1's lobby, a stone table, two stools; durak on F ----
const B1 = new THREE.Vector3(137, 0, -293);   // Luna Park Houses building 1 (the tower south of building 2)
// what the crew talks about: cool nerds — geopolitics, music, NYC, history, tech
const MIND = {
  redko: ['RED: «The Cyclone opened in 1927. Still wood, still terrifying. That\'s engineering.»', 'RED: «"Lateralus" is built on Fibonacci — the syllables go 1, 1, 2, 3, 5, 8. Tool are math nerds with distortion.»', 'RED: «Robert Moses built half this city and bulldozed the other half. These towers are his kind of project.»', 'RED: «Everyone\'s scared of AI. I\'m scared of the G train on a weekend.»', 'RED: «SOAD put Armenian genocide recognition on a platinum record. Metal can do more than yell.»'],
  arkasha: ['ARKASHA: «Durak is geopolitics. Hold your trumps, let him overextend, then transfer the whole war back.»', 'ARKASHA: «Brighton was Little Odessa before anyone here could find Odessa on a map.»', 'ARKASHA: «Bretton Woods, 1944. Everything since then is footnotes, my friend.»', 'ARKASHA: «The Manhattan: Manhattan Club, 1870s. Rye or bourbon, vermouth, bitters. Anything else is propaganda.»', 'ARKASHA: «Every empire thinks it is the exception. That is how you know it is not.»'],
  mcguinness: ['MAC: «Coltrane cut "A Love Supreme" in one day. In Jersey. One day, lads.»', 'MAC: «The Ramones played CBGB for rent money. Now it\'s a boutique. That\'s New York in one sentence.»', 'MAC: «The Irish dug the subway, the Russians run the boardwalk, and everyone drinks at the same bar.»', 'MAC: «Hip-hop was born at a rec room party in the Bronx, 1973. Best block party in history.»'],
  feliks: ['FELIP: «This whole map is OpenStreetMap plus nine city datasets. Every footprint you walk past is real.»', 'FELIP: «Rust or Go? Wrong question. What are you shipping?»', 'FELIP: «The Culver line\'s been running to Coney since the 1870s — steam dummies first, then the el.»', 'FELIP: «Mycelium did mesh networking a billion years before we did.»', 'FELIP: «Latency is a moral issue. Fifty milliseconds and your friends think you\'re lying.»'],
  elf: ['THE ELF: «Adidas and Puma — two brothers, one town, never spoke again. Pick a side. I did.»', 'THE ELF: «Jameson, 1780. Older than the Constitution. Show some respect.»', 'THE ELF: «Three stripes because Dassler bought them off a Finnish brand for two bottles of whisky. True story. Mostly.»', 'THE ELF: «Coney had three amusement parks by 1904. Luna Park had a million electric bulbs. We have one lamp. It flickers.»'],
  sasha: ['SASHA: «I read the whole Wikipedia page on durak. Still lose. Theory versus practice, brother.»', 'SASHA: «Nathan\'s opened in 1916 with a nickel hot dog. Inflation is the real war.»', 'SASHA: «Crypto? I bought the top. Twice. At least I\'m consistent.»', 'SASHA: «Whoever controls the Bosphorus controls the chessboard. Arkasha taught me that. Then he beat me.»'],
};
function mindChoice(id) { return { label: 'What\'s on your mind?', go: () => ({ text: MIND[id][(Math.random() * MIND[id].length) | 0], choices: [{ label: 'Ha — true', go: null }, { label: 'Tell me another', go: () => mindChoice(id).go() }] }) }; }
function crewTalk(world) { for (const [id, e] of Object.entries(world.W.crew || {})) { if (!e?.talk || !MIND[id] || e._mind) continue; e._mind = true; const orig = e.talk; e.talk = (Kk, again) => { const n = orig(Kk, again); if (n?.choices) n.choices.splice(Math.max(0, n.choices.length - 1), 0, mindChoice(id)); return n; }; } }
// RED hangs at Table Park with a cigarette; when you're around, the crew bullshits back and forth
const BS_EXTRA = () => Object.values(MIND).flat();
const BS = ['RED: «Короче, я вчера на Белте — сто сорок, и тут мент.»', 'SASHA: «Сто сорок на твоей тачке? Она сорок не едет.»', 'MAC: «Lads, who took my last Guinness?»', 'FELIP: «I merged nine data sources into one map. For this. For us.»', 'THE ELF: «Джеймисон кончился. Это заговор.»', 'ARKASHA: «Кто на интерес? Бурбон, братва, Гудзон.»', 'RED: «Дай прикурить. …Не эту, нормальную.»', 'SASHA: «В этот раз я его обыграю. Точно.»', 'FELIP: «Relax. The ground is supposed to breathe.»', 'RED: «Tool в Барклайс — лучший концерт в жизни, отвечаю.»', 'MAC: «Your round, Sasha.»', 'THE ELF: «Кто-то видел мою шапку? …Ладно, без шапки.»'];
function redkoAtTablePark(world) {
  const T = world.W.arkadyTable, P = T ? { pos: T.pos, yaw: Math.atan2(T.seat.x - T.pos.x, T.seat.z - T.pos.z) } : H.park; if (!P || !peopleReady()) return; const ctx = world.ctx;   // with the crew at Arkasha's table
  const fig = buildPerson({ avatar: 'm02', seed: 21 }); standTall(fig, 1.83); dressFigure(fig, ctx, { top: 'tee', shirt: 8, bottom: 'jeans' });
  const pos = new THREE.Vector3(1.4, 0, 2.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), P.yaw).add(P.pos).setY(0); fig.group.position.copy(pos); fig.group.rotation.y = P.yaw + 2.4; world.scene.add(fig.group);
  world.updaters.push((dt) => fig.update(dt, 0)); fig.mood = 'talk';
  world.W.crew = world.W.crew || {}; world.W.crew.redko = K.vendor({ name: 'RED', pos, r: 2.4, fig, talk: (Kk, again) => ({ text: again ? BS[(Math.random() * BS.length) | 0] : 'RED: «О, здорово. Сигаретку будешь? Мы тут по кругу.»',
    choices: [{ label: 'Давай сигарету 🚬', go: () => (K.full() ? { text: 'RED: «Руки заняты, брат.»', choices: [{ label: 'Ok', go: null }] } : (K.give('cigs'), { text: 'RED: «Держи пачку. B — закурить. Передавай по кругу.»', choices: [{ label: 'Спасибо', go: null }] })) },
      { label: 'Что обсуждаете?', go: () => ({ text: BS[(Math.random() * BS.length) | 0], choices: [{ label: 'Ха', go: null }] }) }, { label: 'Later', go: null }] }) });
  let puffT = 3, bsT = 6;
  K.onUpdate((dt) => { const me = ctx.player?.position; if (!me) return; puffT -= dt; if (puffT < 0) { puffT = 2.5 + Math.random() * 3; const crew = [pos, ...Object.values(world.W.crew || {}).filter((e) => e && !e.off && e.pos).map((e) => e.pos)]; const who = crew[(Math.random() * crew.length) | 0]; try { K.puff?.(who.clone().setY(1.65)); } catch {} }   // everyone's passing the pack round
    const d = Math.hypot(me.x - P.pos.x, me.z - P.pos.z); bsT -= dt; if (d < 14 && bsT < 0) { bsT = 9 + Math.random() * 8; const all = BS.concat(BS_EXTRA()); ctx.hud?.toast?.(all[(Math.random() * all.length) | 0], 3600); } });
}
// the babushkas on the path benches: named, they gossip, sell seeds, and know everybody's business
const BAB_NAMES = ['БАБА ЗИНА', 'БАБА ГАЛЯ', 'БАБА ЛЮДА', 'БАБА ВАЛЯ', 'БАБА НИНА', 'БАБА ТОМА', 'БАБА РАЯ', 'БАБА ФИРА', 'БАБА СОНЯ'];
const GOSSIP = ['«Видела? Люська из третьего корпуса опять с новым. Третий за месяц!»', '«Аркаша опять в карты всех обыграл. Жулик, но вежливый.»', '«Этот, лохматый, Фелип — инженер! А ведёт себя как хиппи.»', '«Лифт в пятом корпусе опять не работает. Я пешком на девятнадцатый не пойду.»', '«Раньше тут всё было лучше. Всё!»', '«Внучок, ты кушал? Худой какой.»', '«Не стой над душой. Садись или иди.»'];
function babushkas(world) {
  const figs = world.W.babFigs || []; const ctx = world.ctx;
  figs.forEach((f, i) => {
    const name = BAB_NAMES[i % BAB_NAMES.length], tag = nameTag(name, '#f3c9d8'); tag.position.set(0, 1.55, 0); f.group.add(tag);
    K.vendor({ name, pos: f.group.position, r: 2.2, fig: f, noMap: true, talk: (Kk, again) => ({
      text: `${name}: ${again ? GOSSIP[(Math.random() * GOSSIP.length) | 0] : '«Ну, чего встал? Садись, посиди с нами. Семечки хочешь?»'}`,
      choices: [{ label: 'Семечки — $2', go: () => ({ text: `${name}: "${sell('semechki', 2, name, { ok: 'Держи, внучок. Шелуху не кидай на дорожку!', broke: 'Два доллара, милок.', full: 'Руки полные у тебя.' })}"`, choices: [{ label: 'Спасибо, бабушка', go: null }] }) },
        { label: 'Что нового?', go: () => ({ text: `${name}: ${GOSSIP[(Math.random() * GOSSIP.length) | 0]}`, choices: [{ label: 'Ого', go: null }] }) },
        { label: 'Пойду я', go: null }] }) });
  });
}
function buildDurakPark() {
  const { world, ctx } = H; if (!peopleReady()) return;
  let t1 = null; for (const t of H.towers) if (t !== H.b2 && (!t1 || t.centre.distanceTo(B1) < t1.centre.distanceTo(B1))) t1 = t; if (!t1) return;
  const door = t1.lobby.doors[0], dir = door.outside.clone().sub(door.inside).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
  const c = door.outside.clone().addScaledVector(dir, 6).addScaledVector(side, 7); c.y = 0;
  let yaw = Math.atan2(side.x, side.z);
  if (H.park) { const P = H.park, off = new THREE.Vector3(0, 0, -(P.hz + 9)).applyAxisAngle(new THREE.Vector3(0, 1, 0), P.yaw); c.copy(P.pos).add(off).setY(0); yaw = P.yaw; }   // right next to Table Park (the crew drifts between the two)
  const q = ctx.ai?.nav?.nearestFree?.(c.x, c.z, 8, 0); if (q) c.set(q.x, 0, q.z);
  const g = new THREE.Group(); g.position.copy(c); g.rotation.y = yaw; world.scene.add(g);
  const M = (col, r = 0.85, m = 0) => new THREE.MeshStandardMaterial({ color: col, roughness: r, metalness: m });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(9, 0.06, 8), M(0x8d8a83, 0.95), 0, 0.03, 0);   // pavers
  const stone = M(0xb9b4aa, 0.7); add(new THREE.CylinderGeometry(0.16, 0.22, 0.72, 12), stone, 0, 0.36, 0); add(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 24), stone, 0, 0.75, 0);   // the table
  { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d'); x.fillStyle = '#c9c3b6'; x.fillRect(0, 0, 256, 256); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) { x.fillStyle = '#6b665c'; x.fillRect(32 + i * 24, 32 + j * 24, 24, 24); }
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; const top = add(new THREE.CircleGeometry(0.54, 32), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 }), 0, 0.782, 0); top.rotation.x = -Math.PI / 2; }
  for (const k of [-3, -1, 1, 2]) { const cd = add(new THREE.BoxGeometry(0.063, 0.003, 0.09), M(0xfbfaf5, 0.6), k * 0.07, 0.79, 0.05 * k); cd.rotation.y = k * 0.3; }   // a few cards face down
  for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.19, 0.21, 0.45, 12), stone, 0, 0.225, sz * 0.95);   // stools
  add(new THREE.BoxGeometry(1.9, 0.06, 0.45), M(0x2e5a3a, 0.8), 3.2, 0.45, -2.6); add(new THREE.BoxGeometry(1.9, 0.4, 0.06), M(0x2e5a3a, 0.8), 3.2, 0.7, -2.82);   // a bench
  add(new THREE.CylinderGeometry(0.07, 0.1, 4.6, 8), M(0x1c1c1c, 0.5, 0.6), -3.6, 2.3, -3.2); add(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffe0a0, emissiveIntensity: 0.7 }), -3.6, 4.7, -3.2);
  for (const [x, z] of [[-3.4, 3], [3.6, 2.8]]) { add(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 7), M(0x4a3a2a, 1), x, 1.1, z); add(new THREE.SphereGeometry(1.4, 10, 8), M(0x3f5f30, 1), x, 3.1, z); }
  { // draw calls: bake the park's static pieces into one mesh per material
    const by = new Map(); for (const ch of [...g.children]) { if (!ch.isMesh) continue; ch.updateMatrix(); const geo = (ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone()).applyMatrix4(ch.matrix);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      (by.get(ch.material) || by.set(ch.material, []).get(ch.material)).push(geo); g.remove(ch); }
    for (const [m, list] of by) { const me = new THREE.Mesh(mergeGeometries(list, false), m); me.castShadow = true; me.receiveShadow = true; g.add(me); } }
  g.updateMatrixWorld(true);
  { const w = c; world.box([w.x - 0.55, 0, w.z - 0.55], [w.x + 0.55, 0.8, w.z + 0.55]); }
  // ARKASHA: late 30s, black hair, blue eyes, glasses — on the far stool, facing the table
  const pf = buildPerson({ avatar: 'm02', pose: 'sit', glasses: 'clear', glassesY: 0.035, seed: 2 }); g.add(pf.group); pf.group.position.set(0, 0, -1.05); pf.group.rotation.y = 0;
  world.updaters.push((dt) => pf.update(dt, 0));
  // his Manhattan (a coupe of amber rye with a cherry) on the table, and a lit spliff between his fingers
  { const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false });   // NOT transmission: that re-renders the whole scene every frame
    const stem = add(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 8), glass, 0.22, 0.83, -0.42); stem.castShadow = false;
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 16), glass, 0.22, 0.787, -0.42);
    add(new THREE.CylinderGeometry(0.052, 0.01, 0.05, 16, 1, true), glass, 0.22, 0.9, -0.42);
    add(new THREE.CylinderGeometry(0.046, 0.012, 0.036, 16), new THREE.MeshStandardMaterial({ color: 0x8a3a10, roughness: 0.1, transparent: true, opacity: 0.85 }), 0.22, 0.895, -0.42);
    add(new THREE.SphereGeometry(0.009, 10, 8), new THREE.MeshStandardMaterial({ color: 0x7a0a14, roughness: 0.3 }), 0.215, 0.91, -0.415); }
  const spliff = new THREE.Group(); { const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.09, 8), new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.9 })); paper.rotation.z = Math.PI / 2; spliff.add(paper);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5a1a })); ember.position.x = 0.047; spliff.add(ember); spliff.userData.ember = ember; }
  spliff.position.set(0.02, -0.03, 0.05); pf.handR.add(spliff);
  let puffT = 2; world.updaters.push((dt) => { const e = spliff.userData.ember; e.material.color.setHSL(0.04, 1, 0.45 + 0.15 * Math.sin(performance.now() / 260)); if ((puffT -= dt) <= 0) { puffT = 4 + Math.random() * 4; try { K.puff?.(spliff.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.35, 0.9, 0.2))); } catch {} } });   // the puff drifts up past his head, not in his face
  const seatYou = new THREE.Vector3(0, 0, 1.3).applyMatrix4(g.matrixWorld);
  H.arkady = { pos: c.clone(), seat: seatYou, fig: pf };
  world.W.arkadyTable = { pos: c.clone(), seat: seatYou.clone() };   // charselect.js: picked characters spawn here
  try { tableRegulars(g, c); } catch (e) { console.warn('[hangout] regulars', e); }
  (H.world.W.crew || (H.world.W.crew = {})).arkasha = K.vendor({ name: 'ARKASHA', pos: c.clone(), r: 2.6, fig: pf, talk: arkadyTalk });
  try { initDurakMP(ctx, { pos: () => H.arkady?.pos }); } catch (e) { console.warn('[hangout] durak-mp', e); }   // the shared table online (coney/durak-mp.js)
  (world.W.mapPOIs || (world.W.mapPOIs = [])).push({ name: 'DURAK · ARKASHA', x: c.x, z: c.z, kind: 'shop' });
}
function playDurak(stake, mode = 'perevodnoy') {
  const { ctx } = H;
  const start = () => openDurak(ctx, { stake, mode, onEnd: (r, again) => { if (again) { if (stake && !K.pay(stake)) { K.toast('ARKASHA: "Денег нет — играем на интерес."', 2200); setTimeout(() => playDurak(0, mode), 50); } else setTimeout(() => playDurak(stake, mode), 50); } } });
  setTimeout(start, 30);   // after the dialog closes (it clears the seated flag)
  return null;
}
function serveManhattan() {
  const { ctx } = H; K.take('ice'); finishIce();
  if (!K.full()) K.give('manhattan');
  const p = ctx.player.position; ctx.net?.send?.('drink', { k: 'manhattan', p: [+p.x.toFixed(2), +(p.y + 1.5).toFixed(2), +p.z.toFixed(2)] });   // he pours for the whole table
  return { text: 'ARKASHA: "Шейкер, лёд, вермут, бурбон — получай свой Wunderbar!" *наливает всем за столом* "Бурбон, братва, Гудзон!"', choices: [{ label: 'Раздавай', go: () => playDurak(0, 'perevodnoy') }, { label: 'За тебя, Аркаша', go: null }] };
}
function arkadyTalk(Kk, again) {
  const st = durakStats();
  return {
    text: (again ? `ARKASHA: "Ну что, реванш? Счёт ${st.w}:${st.l} — в мою пользу, между прочим." *затягивается, отпивает манхэттен*` : 'ARKASHA: "Здорово. Дурака раскинем? Переводной — по-взрослому. Или подкидной, если боишься. Я не мухлюю — мне не надо." *отпивает манхэттен*') + durakTableLine(),
    choices: [
      ...(K.has('ice') ? [{ label: `Вот лёд от Сэмми (${Math.round(K.state()?.iceLeft ?? 100)}%)`, go: () => serveManhattan() }] : [{ label: 'Налей Манхэттен', go: () => ({ text: 'ARKASHA: "Мне для «Манхэттена» лёд нужен — а лёд у Сэмми на W 8th. Сгоняй? Только бегом — пока несёшь, тает. Я же медведь культурный."', choices: [{ label: 'Сгоняю', go: () => { const d = H.deli?.door; if (d && H.arkady) startIce(d, H.arkady.pos); return { text: 'ARKASHA: "Давай. И если Сэмми спросит про «сзади» — не отвечай."', choices: [{ label: 'Ok', go: null }] }; } }, { label: 'Потом', go: null }] }) }]),
      ...durakTableChoices(),   // online: open / join the shared table (2–4 humans, AI in the empty seats)
      { label: 'Переводной — for fun', go: () => playDurak(0, 'perevodnoy') },
      { label: 'Переводной — $20, winner takes $40', cost: 20, go: () => (K.pay(20) ? playDurak(20, 'perevodnoy') : { text: 'ARKASHA: "Двадцатки нет? Сыграем на интерес."', choices: [{ label: 'Давай', go: () => playDurak(0, 'perevodnoy') }, { label: 'Потом', go: null }] }) },
      { label: 'Подкидной — for fun', go: () => playDurak(0, 'podkidnoy') },
      { label: 'Remind me the rules', go: () => ({ text: 'ARKASHA: "Козырь внизу колоды. Заходишь любой, я бью старшей той же масти или козырем. Подкидывать — только то, что на столе. Не побил — берёшь. В переводном, пока ничего не побито, можешь положить такую же карту и перевести всё на меня — если у меня карт хватает. Или просто показать козыря той же масти — тоже перевод. Колода кончилась: кто первый скинул — вышел. Остался с картами — дурак."', choices: [{ label: 'Раздавай', go: () => playDurak(0, 'perevodnoy') }, { label: 'Потом', go: null }] }) },
      { label: 'Later', go: null },
    ],
  };
}

// ---- «Бурбон, братва, Гудзон»: Sammy's ice (and zebra milk), the table regulars around Arkasha ----
function sammyBar(after) {
  return [
    { label: 'Bag of ice — $3', go: () => ({ text: 'SAMMY: "Ice? Ice is in the back… and speaking of the back — you and your girlfriend, the anal, yes? Hahaha. Here. $3. Run, it melts!"', choices: [{ label: 'Сэмми, я за льдом зашёл, а не сдавать тебе отчёт', go: () => after(sell('ice', 3, 'SAMMY', { ok: 'OK, OK, for the bear. Go, go — it melts!', broke: 'Three dollar, habibi. Even the ice is not free.', full: 'Your hands are full, my friend.' })) }] }) },
    { label: 'Zebra milk — $4', go: () => after(sell('zebra', 4, 'SAMMY', { ok: 'Zebra milk. For your friend Red. Don\'t ask me where I get it.', broke: 'Four dollar. The zebra has expenses.', full: 'Hands full.' })) },
  ];
}
function tableRegulars(g, c) {
  const { world } = H; const put = (fig, x, z, ry) => { g.add(fig.group); fig.group.position.set(x, 0, z); fig.group.rotation.y = ry; world.updaters.push((dt) => fig.update(dt, 0)); };
  const wpos = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld);
  // SASHA: on the bench, always loses — «Бей!» … «Беру!»
  const sasha = buildPerson({ avatar: 'm01', pose: 'sit', seed: 5 }); put(sasha, 3.2, -2.35, 0);   // faces out from the backrest
  (H.world.W.crew || (H.world.W.crew = {})).sasha = K.vendor({ name: 'SASHA', pos: wpos(3.2, -2.35), r: 2.4, fig: sasha, talk: (Kk, again) => ({
    text: again ? 'SASHA: "Я правила зубрил, понимаешь? Зубрил! А он козырем — хлоп." *доедает сосиску*' : 'SASHA: "Ты с Аркашей играть? Совет: не кричи «Бей!». Я кричал «Бей!», потом кричал «Беру!». Теперь у меня вся колода."',
    choices: [{ label: 'Сосиску будешь? — угостишь?', go: () => (K.full() ? { text: 'SASHA: "Руки заняты у тебя."', choices: [{ label: 'Ok', go: null }] } : (K.give('sausage'), { text: 'SASHA: "Держи. Виски-шмиски, вот сосиски — вся закуска наша!"', choices: [{ label: 'Спасибо, Саша', go: null }] })) },
      { label: 'Как он всегда выигрывает?', go: { text: 'SASHA: "Медведь по козырям — ещё какой мастак. Он все карты помнит. И переводит, гад, переводит!"', choices: [{ label: 'Ясно', go: null }] } }, { label: 'Later', go: null }] }) });
  // FELIP: 6', long hair, band tee — a Coney Island engineer by day; here he hands out mushrooms (2 minutes of tripping balls)
  const fel = buildPerson({ avatar: 'm20', seed: 12 }); standTall(fel, 1.83); addLongHair(fel); dressFigure(fel, H.ctx, { top: 'tee', shirt: 6, bottom: 'jeans' }); put(fel, -3.3, -1.4, 1.1);
  (H.world.W.crew || (H.world.W.crew = {})).feliks = K.vendor({ name: 'FELIP', pos: wpos(-3.3, -1.4), r: 2.4, fig: fel, talk: (Kk, again) => ({
    text: again ? 'FELIP: "Still here? The code compiles, the ground breathes. Both are fine."' : 'FELIP: "Engineer by day. Tonight? Tonight I review the universe. Want some mushrooms, bro? Two minutes, full send."',
    choices: [{ label: 'Давай грибы 🍄', go: () => (K.full() ? { text: 'FELIP: "Pockets full, man. Make room."', choices: [{ label: 'Ok', go: null }] } : (K.give('shrooms'), { text: 'FELIP: "B to eat. Don\'t drive. Or do — it\'s a game."', choices: [{ label: 'Спасибо, Фелип', go: null }] })) },
      { label: 'Got any weed? 🌿', go: () => (K.full() ? { text: 'FELIP: "Pockets full, man."', choices: [{ label: 'Ok', go: null }] } : (K.give('weed'), { text: 'FELIP: "Free. Always free. Pass it around (B)."', choices: [{ label: 'Respect', go: null }] })) },
      { label: 'What are you building?', go: { text: 'FELIP: "A map lab. Merges nine NYC data sources into one world. Also this park, probably."', choices: [{ label: 'Respect', go: null }] } }, { label: 'Later', go: null }] }) });
  // MAC: by the lamp with a crate of Guinness — «Guinness будешь?» — «За тебя!»
  const mcg = buildPerson({ avatar: 'm12', seed: 8 }); standTall(mcg, 1.73); mcg.group.scale.x *= 1.22; mcg.group.scale.z *= 1.18; addAfro(mcg); dressFigure(mcg, H.ctx, { top: 'tee', shirt: 3, bottom: 'jeans', skin: 0x5a3a26 }); put(mcg, -2.9, 1.9, 2.2);   // ~20, 5'8", heavyset, afro, band tee
  (H.world.W.crew || (H.world.W.crew = {})).mcguinness = K.vendor({ name: 'MAC', pos: wpos(-2.9, 1.9), r: 2.4, fig: mcg, talk: (Kk, again) => ({
    text: again ? 'MAC: "Another? Go on, go on, go on."' : 'MAC: "Guinness будешь? Proper pint, poured slow. Arkasha takes his with bourbon, God help him."',
    choices: [{ label: '«За тебя!» — давай пинту', go: () => (K.full() ? { text: 'MAC: "Finish what you\'re holding first."', choices: [{ label: 'Sláinte', go: null }] } : (K.give('guinness'), { text: 'MAC: "Sláinte! B to drink — and share it, it\'s rude not to."', choices: [{ label: 'Sláinte', go: null }] })) },
      { label: '«За тебя, но я-то пас»', go: { text: 'MAC: "Ah, a bourbon man. Suit yourself."', choices: [{ label: 'Later', go: null }] } }] }) });
  // THE ELF: 5'7" Russian/Ukrainian, white, dark hair, brown eyes, in a full three-stripe track suit, no hat — Jameson, and a spliff rolled like a magic scroll
  const elf = buildPerson({ avatar: 'm08', seed: 9 }); standTall(elf, 1.70); dressFigure(elf, H.ctx, { top: 'track', bottom: 'track', shoes: 'white' }); addKnife(elf); put(elf, 2.6, 2.3, -2.4);   // 5'7", full three-stripe track suit
  (H.world.W.crew || (H.world.W.crew = {})).elf = K.vendor({ name: 'THE ELF', pos: wpos(2.6, 2.3), r: 2.4, fig: elf, talk: (Kk, again) => ({
    text: again ? 'THE ELF: "Ещё фокус?" *шуршит бумагой*' : 'THE ELF: "Jameson? Или… фокус? Я сворачиваю бумажный свиток — и готово. Заклинаний не надо."',
    choices: [{ label: 'Jameson', go: () => (K.full() ? { text: 'THE ELF: "Руки заняты."', choices: [{ label: '…', go: null }] } : (K.give('jameson'), { text: 'THE ELF: "Sláinte по-эльфийски. B — выпить."', choices: [{ label: 'За тебя', go: null }] })) },
      { label: 'Фокус (a spliff) — $10', go: () => ({ text: 'THE ELF: "' + sell('spliff', 10, 'THE ELF', { ok: 'Вот и фокус мой готов. «Заклинанье?» — «Затянись.»', broke: 'Магия стоит десятку.', full: 'Руки заняты, волшебник.' }) + '"', choices: [{ label: 'Колдуй', go: null }] }) },
      { label: 'Сигарету?', go: { text: 'THE ELF: "Табаку закрыт проход. Только с травкой — пусть за ручку проведёт."', choices: [{ label: 'Уважаю', go: null }] } }] }) });
}

/** QA hooks (window.__game.hangout) */
export const hangoutQA = {
  state: () => { const s = K.state(); return H && s && { ...s, stash: s.inv.length, igor: H.igor?.toArray(), start: H.world.W.onlineStart, b2: H.b2?.centre.toArray(), lobby: H.b2?.lobby.cars.map((c) => c.pos.toArray()), top: H.b2?.top[0].cars.map((c) => c.pos.toArray()), deli: H.deli && { sammy: H.deli.sammy.toArray(), counter: H.deli.counter.toArray(), door: H.deli.door.toArray(), inside: H.deli.inside.toArray(), face: H.deli.face } }; },
  roof: () => { const r = H.b2?.roof?.top; return r && [...r.pos.toArray(), r.yaw]; },
  arkady: () => H.arkady && { pos: H.arkady.pos.toArray(), seat: H.arkady.seat.toArray() },
  hurt: () => K.hurtState(), vendors: () => K.points().vendors, loadout: () => ({ ...H.ctx.weapons.loadout, cur: H.ctx.weapons.currentId }),
  roofDoor: (i = null) => { const D = H.roofDoors?.[i ?? H.towers.indexOf(H.b2)]; return D && { open: D.open, shoves: D.shoves, inside: D.d.inside.toArray(), outside: D.d.outside.toArray() }; },
  stairB: () => { const b = H.b2?.stairB; return b && { top: b.top.toArray(), bottom: b.bottom.toArray(), floors: b.floors, up: b.up, path: b.path.map((v) => v.toArray()) }; },
  gate: () => H.gate?.toArray(), parkInfo: () => H.park && { pos: H.park.pos.toArray(), yaw: H.park.yaw, hx: H.park.hx, hz: H.park.hz },
  lobbyView: () => { const c = H.b2.lobby.cars[1]; return [...c.pos.toArray(), c.yaw]; },
  roofAt: (a, c) => { const t = H.b2, k = t.core; return t.toWorld(a, k.roof.y, k.roof.c + c).toArray(); },
  buy: () => buyIgor(), use: () => K.useItem(), light: () => { K.give('weed'); K.useItem(); }, ride: (dir = 'up', k = 0) => K.callElevator(H.towers.indexOf(H.b2), k, dir), steal: () => { const c = K.nearestParked(1e9); if (c) K.steal(c); return !!c; },
  park: () => K.pickRespawn(), wheel: () => { const WW = H.world.W.wonderWheel; if (WW) rideWheel(WW); return !!WW; }, wheelState: () => H.wheel && { i: H.wheel.i, t: +H.wheel.t.toFixed(1), y: +H.ctx.player.position.y.toFixed(1) }, choose: (i) => K.choose(i), close: () => K.closeDialog(), give: (n) => K.earn(n), drop: (n = 30) => { const p = H.ctx.player.position; K.dropCash(p.clone().add(new THREE.Vector3(3, 0, 0)), n); },
};

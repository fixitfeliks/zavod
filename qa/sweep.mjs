// Quality sweep: node qa/sweep.mjs [outdir] [--no-mp] — the "is it janky?" loop. Loads Coney chill, visits a ring of spots across
// the map and at each one checks what a player would notice: people standing in each other, floating or sunk into the ground or
// stuck inside a wall; cars overlapping or inside buildings; page / console / update errors; frame time, draw calls. Then a
// gameplay smoke (walk, jump, steal a car and drive, shoot), a phone-weight memory check, and two players online (do they see
// each other, each other's car, name, weapon, the crews one of them fights). Every finding: a line with where it is, the first
// few with a screenshot. Writes <outdir>/sweep.json + sweep.md. Exit code 1 if anything failed.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '/tmp/sweep';
const MP = !process.argv.includes('--no-mp'), PORT = process.env.PORT || 8790, BASE = `http://localhost:${PORT}/`;
mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=metal', '--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const findings = [], shots = new Map(); let shotN = 0;
const find = (area, what, where, detail = '') => { findings.push({ area, what, where, detail }); console.log(`ISSUE [${area}] ${what} @ ${where} ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function page(q, name = 'solo', { touch = false } = {}) {
  const p = await b.newPage({ viewport: { width: 1100, height: 620 }, hasTouch: touch, isMobile: touch }); p.errs = []; p.cerrs = [];
  p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /\[update:/.test(t)) p.cerrs.push(t.slice(0, 200)); });
  await p.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
  // the JS heap peak from navigation on (100 ms samples, no forced GC): the load spike is where iOS kills a tab
  if (touch) await p.addInitScript(() => { window.__loadPeak = 0; setInterval(() => { window.__loadPeak = Math.max(window.__loadPeak, performance.memory?.usedJSHeapSize || 0); }, 100); });
  const t0 = Date.now(); await p.goto(BASE + q, { timeout: 180000 }); await p.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 }); p.loadS = (Date.now() - t0) / 1000;
  await p.evaluate(() => window.__game.setState('playing')); p.name = name; return p;
}
async function shot(p, label) { if (shotN >= 24) return null; const f = `${out}/sweep-${String(++shotN).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`; await p.screenshot({ path: f }); return f; }

// ---- in-page measurements (one function, run at each spot) ---------------------------------------------------------------------
const MEASURE = () => {
  const c = window.__ctx, W = c.world, P = c.player.position, near = (x, z, r) => Math.hypot(x - P.x, z - P.z) < r, out = { people: 0, cars: 0, issues: [] };
  const issue = (what, x, y, z, detail = '') => out.issues.push({ what, where: [x, y, z].map((v) => +(+v).toFixed(1)), detail });
  // the floor under a point: the highest collider top within a step of the feet (platforms, stairs, decks), else the ground
  const nearBoxes = c.colliders.filter((b) => b.max.y - b.min.y < 400 && b.max.x - b.min.x < 300 && near((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, 120));
  const floorAt = (x, z, y) => { let f = W.groundHeight?.(x, z); if (!Number.isFinite(f)) f = 0; for (const b of nearBoxes) if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y <= y + 0.6 && b.max.y > f) f = b.max.y; return f; };
  const tall = c.colliders.filter((b) => b.max.y - b.min.y > 1.4 && b.max.y - b.min.y < 400 && (b.max.x - b.min.x) * (b.max.z - b.min.z) > 1.2 && near((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, 160));
  const inside = (x, y, z, pad = 0.15, skip = null) => tall.find((b) => b !== skip && x > b.min.x + pad && x < b.max.x - pad && z > b.min.z + pad && z < b.max.z - pad && y + 0.9 > b.min.y && y + 0.3 < b.max.y);
  // people: everyone drawn as a person within 60 m
  const ppl = []; c.scene.traverse((o) => { if (o.name !== 'person' || !o.visible) return; let v = o, vis = true; while (v) { if (!v.visible) { vis = false; break; } v = v.parent; } if (!vis) return;
    const p = o.getWorldPosition(new o.position.constructor()); if (near(p.x, p.z, 60)) ppl.push({ p, o }); });
  out.people = ppl.length;
  // two seated people side by side (bus side seats 0.48 m apart, a bench) is normal; two standing that close is a clip
  for (let i = 0; i < ppl.length; i++) for (let j = i + 1; j < ppl.length; j++) { const a = ppl[i].p, q = ppl[j].p; if (ppl[i].o.userData?.sit && ppl[j].o.userData?.sit) continue; if (Math.hypot(a.x - q.x, a.z - q.z) < 0.45 && Math.abs(a.y - q.y) < 1) issue('two people in one spot', a.x, a.y, a.z, `${Math.hypot(a.x - q.x, a.z - q.z).toFixed(2)} m apart`); }
  for (const { p, o } of ppl) { const f = floorAt(p.x, p.z, p.y), g = W.groundHeight?.(p.x, p.z) ?? 0; let riding = false; for (let v = o.parent; v; v = v.parent) if (/train|car|bus|ferry|subway|r160|viaduct/i.test(v.name || '')) riding = true; const sitting = riding || o.userData?.sit || /sit/i.test(o.parent?.name || '');
    if (!sitting && p.y - f > 0.55) issue('person floating', p.x, p.y, p.z, `${(p.y - f).toFixed(2)} m above the floor`); else if (g - p.y > 0.3 && g - p.y < 3) issue('person sunk into the ground', p.x, p.y, p.z, `${(g - p.y).toFixed(2)} m under`);
    const b = inside(p.x, p.y, p.z, 0.3); if (b) issue('person inside a wall / box', p.x, p.y, p.z, `box ${[b.min.x, b.min.z, b.max.x, b.max.z].map((v) => v.toFixed(1)).join(',')}`); }
  // cars: street traffic, parked, player vehicles, 8th Ave and Belt traffic
  const cars = [];
  for (const t of W.traffic?.cars?.() || []) if (near(t.x, t.z, 80)) cars.push({ x: t.x, y: t.y || 0, z: t.z, h: t.h, kind: 'traffic', len: (t.hl || 2.3) * 2, w: (t.hw || 0.9) * 2 });
  for (const q of W.parkedCars || []) if (!q.gone && q.x != null && near(q.x, q.z, 80)) cars.push({ x: q.x, y: 0, z: q.z, h: (q.ry || 0) - Math.PI / 2, kind: 'parked', len: 4.6, w: 1.85 });
  for (const v of c.vehicles?.list || []) if (v.spec?.car && near(v.pos.x, v.pos.z, 80) && v.pos.y > -50) cars.push({ x: v.pos.x, y: v.pos.y, z: v.pos.z, h: v.heading, kind: 'vehicle', len: (v.spec.hz || 2.3) * 2, w: (v.spec.hx || 0.95) * 2, box: v.box });
  out.cars = cars.length;
  // oriented-rectangle overlap (separating axis), shrunk 15% so touching bumpers aren't flagged
  const corners = (q) => { const fx = -Math.sin(q.h), fz = -Math.cos(q.h), rx = -fz, rz = fx, l = q.len * 0.425, w = q.w * 0.425; return [[l, w], [l, -w], [-l, -w], [-l, w]].map(([a, b2]) => [q.x + fx * a + rx * b2, q.z + fz * a + rz * b2]); };
  const sep = (A, B) => { for (const poly of [A, B]) for (let i = 0; i < 4; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % 4], nx = z2 - z1, nz = x1 - x2; let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of A) { const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); } for (const [x, z] of B) { const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); } if (a1 < b0 || b1 < a0) return true; } return false; };
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) { const a = cars[i], q = cars[j]; if (Math.hypot(a.x - q.x, a.z - q.z) > 6 || Math.abs(a.y - q.y) > 2) continue; if (!sep(corners(a), corners(q))) issue(`cars overlapping (${a.kind} + ${q.kind})`, a.x, a.y, a.z, `${Math.hypot(a.x - q.x, a.z - q.z).toFixed(2)} m apart`); }
  for (const q of cars) { const bx = inside(q.x, q.y, q.z, 0.6, q.box); if (bx && bx.max.y - bx.min.y > 2.6) issue(`${q.kind} car inside a building`, q.x, q.y, q.z, `box ${[bx.min.x, bx.min.z, bx.max.x, bx.max.z].map((v) => v.toFixed(1)).join(',')}`); }
  out.perf = c.perf ? { fps: +(+c.perf.fps || 0).toFixed(1), frameMs: +(+c.perf.frameMs || 0).toFixed(1), drawCalls: c.perf.drawCalls, tris: c.perf.triangles } : null;
  return out;
};

// ---- A: solo, desktop, a ring of spots -------------------------------------------------------------------------------------------
const SPOTS = [['spawn', null], ['Surf Ave & Stillwell', [-40, 0.3, -124]], ['Stillwell terminal', [-55, 0.3, -230]], ['boardwalk', [0, 0.3, 150]], ['beach', [-150, 0.3, 230]],
  ['W 8th St', [316, 0.3, -112]], ['Neptune Ave', [420, 0.3, -531]], ['Brighton Beach Ave', [1500, 0.3, -40]], ['8th Ave · Soc Tav', [-30, 0.3, -11996]]];
const A = await page('?qa=1&map=coney&mode=chill&time=day');
console.log(`loaded in ${A.loadS.toFixed(1)} s`); if (A.loadS > 25) find('load', 'slow load', 'boot', `${A.loadS.toFixed(1)} s`);
const report = { spots: [], gameplay: {}, phone: {}, mp: {} };
for (const [name, at] of SPOTS) {
  if (at) await A.evaluate((a) => window.__game.teleport(a[0], a[1], a[2], 0, -0.05), at); await sleep(2500);
  const m = await A.evaluate(MEASURE); report.spots.push({ name, people: m.people, cars: m.cars, perf: m.perf, issues: m.issues.length });
  console.log(`· ${name}: ${m.people} people, ${m.cars} cars, ${m.perf?.frameMs} ms, ${m.perf?.drawCalls} draws, ${m.issues.length} issues`);
  const seen = new Set(); for (const i of m.issues) { const k = i.what; if (seen.has(k) && [...findings].filter((f) => f.what === k && f.area === name).length > 4) continue; seen.add(k); find(name, i.what, i.where.join(','), i.detail); }
  for (const i of m.issues.slice(0, 3)) { const [x, y, z] = i.where; await A.evaluate(([x, y, z]) => window.__game.teleport(x + 3.5, y + 0.3, z + 3.5, Math.atan2(3.5, 3.5), -0.15), [x, y, z]); await sleep(900); const f = await shot(A, `${name}-${i.what}`); const F = findings.find((q) => q.where === i.where.join(',') && q.what === i.what); if (F && f) F.shot = f.split('/').pop(); }
  if (m.perf && m.perf.frameMs > 40) find(name, 'slow frames (desktop)', name, `${m.perf.frameMs} ms`);
  if (m.perf && m.perf.drawCalls > 3000) find(name, 'too many draw calls', name, `${m.perf.drawCalls}`);
}
// ---- gameplay smoke ----
{ const g = {};
  await A.evaluate(() => window.__game.teleport(-40, 0.3, -124, -Math.PI / 2, 0)); await sleep(800);
  const p0 = await A.evaluate(() => window.__ctx.player.position.toArray()); await A.evaluate(() => window.__ctx.player.qaWalk({ x: 0, y: 1 }, 1.5)); const p1 = await A.evaluate(() => window.__ctx.player.position.toArray());
  g.walk = +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2); if (g.walk < 3) find('gameplay', 'walking barely moves', 'Surf Ave', `${g.walk} m in 1.5 s`);
  // drive 2.5 s east; Surf Ave traffic is solid, so a bus or car stopped in the lane ahead blocks a fair test: then redo it on the empty boardwalk
  const driveTest = async () => { await A.evaluate(() => { const V = window.__ctx.vehicles, p = window.__ctx.player.position; V.mount(V.spawnCar(p.x, p.z, -Math.PI / 2, 'sedan', 0x2b3f73, 0)); }); await sleep(400);
    const c0 = await A.evaluate(() => window.__ctx.vehicles.mounted?.pos.toArray()); A.evaluate(() => window.__ctx.vehicles.qaDrive(1, 0, 2.5)).catch(() => {}); await sleep(2800);
    return A.evaluate((c0) => { const v = window.__ctx.vehicles.mounted, c1 = v?.pos; if (!c0 || !c1) return { d: 0, blocker: null };
      const near = (window.__ctx.world.traffic?.cars?.() || []).map((q) => Math.hypot(q.x - c1.x, q.z - c1.z)).sort((a, b) => a - b)[0];
      return { d: +Math.hypot(c1.x - c0[0], c1.z - c0[2]).toFixed(1), blocker: near < 8 ? +near.toFixed(1) : null }; }, c0); };
  let r = await driveTest(); g.drive = r.d;
  if (r.d < 10 && r.blocker != null) { g.driveBlocked = `traffic ${r.blocker} m away`; await A.evaluate(() => window.__ctx.vehicles.dismount()); await A.evaluate(() => window.__game.teleport(-60, 0.3, 150, -Math.PI / 2, 0)); await sleep(800); r = await driveTest(); g.drive = r.d; }
  if (g.drive < 10) find('gameplay', 'car barely drives', g.driveBlocked ? 'boardwalk' : 'Surf Ave', `${g.drive} m in 2.5 s`);
  await A.evaluate(() => window.__ctx.vehicles.dismount()); await sleep(300);
  g.shot = await A.evaluate(async () => { const W = window.__ctx.weapons; try { W.swap?.(1); } catch {} const a0 = W.current?.ammo ?? W.ammo; window.__ctx.input.mouse.buttons = 1; await new Promise((r) => setTimeout(r, 400)); window.__ctx.input.mouse.buttons = 0; return { a0, a1: W.current?.ammo ?? W.ammo, id: W.currentId }; });
  report.gameplay = g; console.log('gameplay', JSON.stringify(g));
}
if (A.errs.length) find('errors', 'page errors', 'solo', A.errs.slice(0, 3).join(' | '));
if (A.cerrs.length) find('errors', 'console / update errors', 'solo', [...new Set(A.cerrs)].slice(0, 3).join(' | '));
await A.close();

// ---- B: phone weight ------------------------------------------------------------------------------------------------------------
// the budget is the heap after a forced GC: what the page really holds (iOS kills the tab near its ceiling; the raw reading swings
// 30 MB with GC timing). Kept under PHONE_HEAP_MB so it can't creep back.
const PHONE_HEAP_MB = 400, PHONE_PEAK_MB = 680;   // ratchet: 547-631 MB on fresh loads, 652 here after the desktop page, with the building meshes streamed to the GPU mid-build (was 690); target 500
{ const T = await page('?qa=1&map=coney&mode=chill&time=day&touch=1', 'phone', { touch: true }); await sleep(3000);
  await T.evaluate(() => window.__game.carsSettled ? window.__game.carsSettled(15000) : null);   // the street-car model loads on idle; don't race it
  { const cdp = await T.context().newCDPSession(T); await cdp.send('HeapProfiler.collectGarbage'); await cdp.detach(); }
  const m = await T.evaluate(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, perf: { frameMs: +(+window.__ctx.perf.frameMs).toFixed(1), drawCalls: window.__ctx.perf.drawCalls, tris: window.__ctx.perf.triangles } }));
  report.phone = { load: T.loadS, ...m }; console.log('phone', JSON.stringify(report.phone));
  m.loadPeak = Math.round(await T.evaluate(() => window.__loadPeak) / 1048576); report.phone.loadPeak = m.loadPeak; console.log('phone load peak', m.loadPeak, 'MB');
  if (m.loadPeak > PHONE_PEAK_MB) find('phone', 'JS heap peak during load over budget', 'touch=1', `${m.loadPeak} MB > ${PHONE_PEAK_MB}`);
  if (m.heap > PHONE_HEAP_MB) find('phone', 'JS heap over budget (after GC)', 'touch=1', `${m.heap} MB > ${PHONE_HEAP_MB}`); if (m.perf.drawCalls > 1200) find('phone', 'too many draw calls for a phone', 'touch=1', `${m.perf.drawCalls}`);
  if (T.errs.length) find('errors', 'page errors (phone)', 'touch=1', T.errs.slice(0, 3).join(' | ')); await T.close(); }

// ---- C: two players online ------------------------------------------------------------------------------------------------------
if (MP) { const room = 'sw' + Math.random().toString(36).slice(2, 7), q = (n) => `?qa=1&mp=1&room=${room}&map=coney&mode=chill&name=${n}`;
  const P1 = await page(q('ALPHA'), 'ALPHA'), P2 = await page(q('BRAVO'), 'BRAVO');
  for (const P of [P1, P2]) await P.waitForFunction(() => window.__ctx.net?.connected, null, { timeout: 60000 }).catch(() => {});
  await sleep(4000); const mp = {};
  mp.seeEachOther = (await P1.evaluate(() => window.__ctx.net.peers)) === 1 && (await P2.evaluate(() => window.__ctx.net.peers)) === 1; if (!mp.seeEachOther) find('online', 'players don\'t see each other', 'room');
  const s1 = await P1.evaluate(() => window.__ctx.player.position.toArray()), s2 = await P2.evaluate(() => window.__ctx.player.position.toArray());
  mp.spawnGap = +Math.hypot(s1[0] - s2[0], s1[2] - s2[2]).toFixed(2); if (mp.spawnGap < 0.9) find('online', 'players spawn on top of each other', 'meet-up', `${mp.spawnGap} m`);
  // B pulls a rifle: does A see it in B's hands?
  await P2.evaluate(() => { const I = window.__ctx.input; I.pressed.add('Digit1'); I.keys.add('Digit1'); setTimeout(() => I.keys.delete('Digit1'), 200); }); await sleep(2000);   // 1: the rifle
  mp.weapon = await P1.evaluate(() => { const n = window.__ctx.net, id = n.list()[0], q = n.peer(id); let held = false; const g = q && window.__ctx.scene.getObjectById?.(0); void g; window.__ctx.scene.traverse((o) => { if (o.userData?.remoteWeapon) held = true; }); return { held }; });
  if (!mp.weapon.held) find('online', 'friends don\'t see each other\'s weapons', 'remote avatar', 'no weapon in the remote player\'s hands');
  // B drives: A sees a car under B
  await P2.evaluate(() => { const V = window.__ctx.vehicles, p = window.__ctx.player.position; V.mount(V.spawnCar(p.x + 4, p.z, 0, 'sedan', 0x8a1c1c, 0)); }); await sleep(2500);
  mp.remoteCar = await P1.evaluate(() => { const n = window.__ctx.net, q = n.peer(n.list()[0]); return !!q?.veh; }); if (!mp.remoteCar) find('online', 'friend\'s car not shown', 'remote vehicle');
  // A starts a fight: B sees the crew
  await P2.evaluate(() => window.__ctx.vehicles.dismount()); const a1 = await P1.evaluate(() => window.__ctx.player.position.toArray()); await P2.evaluate((a) => window.__game.teleport(a[0] + 3, 0.3, a[2] + 3, 0, 0), a1);
  await P1.evaluate(() => { window.__game.crews.gang('ru', 'rob', 2); return window.__game.crews.fight(); }); let maxR = 0; for (let k = 0; k < 10; k++) { await sleep(500); maxR = Math.max(maxR, await P2.evaluate(() => window.__game.crews.state().remote)); }
  mp.crewsSynced = maxR; if (!maxR) find('online', 'friends don\'t see the crews you fight', 'chill crews');
  report.mp = mp; console.log('online', JSON.stringify(mp));
  await shot(P1, 'online-A-view');
  for (const P of [P1, P2]) { if (P.errs.length) find('errors', `page errors (${P.name})`, 'online', P.errs.slice(0, 3).join(' | ')); }
  await P1.close(); await P2.close(); }

await b.close();
report.findings = findings;
writeFileSync(`${out}/sweep.json`, JSON.stringify(report, null, 1));
const md = [`# Quality sweep — ${new Date().toISOString().slice(0, 16)}`, '', `${findings.length} findings`, '', '| area | issue | where | detail | shot |', '|---|---|---|---|---|', ...findings.map((f) => `| ${f.area} | ${f.what} | ${f.where} | ${String(f.detail).replace(/\|/g, '/')} | ${f.shot || ''} |`), '', '## spots', '', '| spot | people | cars | frame ms | draws |', '|---|---|---|---|---|', ...report.spots.map((s) => `| ${s.name} | ${s.people} | ${s.cars} | ${s.perf?.frameMs} | ${s.perf?.drawCalls} |`)];
writeFileSync(`${out}/sweep.md`, md.join('\n'));
console.log(`\n${findings.length} findings → ${out}/sweep.md`); process.exit(findings.length ? 1 : 0);

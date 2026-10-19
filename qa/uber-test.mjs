// Uber (coney chill): node qa/uber-test.mjs [outdir]  (PORT env, default 8790)
// The phone in the bag + the app (U), $5 paid / broke refused, the car arriving on the road graph from Coney and from 8th Ave by
// Soc Tav, boarding (seated eye height, inside the cabin, screenshots), the radio, B and shooting from the seat, a ride to each of
// the 5 destinations, the phone heap delta of the first ride, and two players riding together (one mp room). Exit code 1 on a failure.
import pw from 'playwright-core';
const { chromium } = pw;
const out = process.argv[2] || '/tmp', PORT = process.env.PORT || 8790;
const BASE = `http://localhost:${PORT}/?qa=1&map=coney&mode=chill&ai=0&time=day`;
const ARGS = ['--use-angle=metal', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
let fails = 0; const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPAWN = [-186, 0, -302];   // a Coney street corner (the solo spawn)

async function open(q = '', name = 'solo', touch = false) {
  const pg = await b.newPage({ viewport: { width: 1200, height: 680 }, hasTouch: touch, isMobile: touch });
  pg.on('pageerror', (e) => { console.log(name, 'PAGEERROR', e.message); fails++; });
  pg.on('console', (m) => { if (/\[uber\]|\[update:/.test(m.text())) console.log(name, m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
  await pg.goto(BASE + q, { timeout: 180000 });
  await pg.waitForFunction((mp) => window.__game?.ready && window.__game.uber && (!mp || window.__ctx.net?.connected), q.includes('mp=1'), { timeout: 180000 });
  await pg.evaluate(() => { window.__game.setState('playing'); window.__toasts = []; const h = window.__ctx.hud; const t = h.toast; h.toast = (s, ms) => { window.__toasts.push(String(s)); return t.call(h, s, ms); }; });
  await sleep(600); return pg;
}
const U = (pg) => pg.evaluate(() => window.__game.uber.state());
const toastHas = (pg, re) => pg.evaluate((s) => window.__toasts.some((t) => new RegExp(s).test(t)), re);
/** stand on the kerb by the waiting car and press F */
async function boardF(pg) {
  await pg.evaluate(() => { const k = window.__game.uber.kerb(), c = Math.cos(k[2]), s = Math.sin(k[2]); window.__game.teleport(k[0] + c * 2.4, 0, k[1] - s * 2.4, k[2] + Math.PI / 2, 0); });
  await sleep(500); await pg.keyboard.press('KeyF'); await sleep(400); return U(pg);
}
/** book, fast-forward the approach, F in, fast-forward to the drop-off; returns { st, pos, end } */
async function rideTo(pg, dest, { realWait = false } = {}) {
  const ok1 = await pg.evaluate((d) => window.__game.uber.request(d), dest); if (!ok1) return { booked: false };
  let st = await U(pg); const appr = st.cur.approachT;
  if (realWait) { const t0 = Date.now(); await pg.waitForFunction(() => window.__game.uber.state().cur?.phase === 'waiting', null, { timeout: 90000 }); st.arriveS = (Date.now() - t0) / 1000; }
  else { await pg.evaluate((s) => window.__game.uber.ff(s), appr + 0.5); await sleep(300); }
  const arriveS = st.arriveS; st = await boardF(pg); const boarded = st.seat >= 0 && st.mounted;
  const total = st.cur.legs.reduce((a, l) => a + l[2], 0) + 12;
  await sleep(4500);   // the 4 s before it pulls away
  const riding = (await U(pg)).cur?.phase;
  await pg.evaluate((s) => window.__game.uber.ff(s), total); await sleep(1500);
  const end = await U(pg);
  return { booked: true, boarded, riding, appr, arriveS, end, pos: end.pos, legs: st.cur.legs };
}

// ================= solo =================
{
  const pg = await open();
  await pg.evaluate(([x, y, z]) => window.__game.teleport(x, y, z, 0, 0), SPAWN); await sleep(500);
  let st = await U(pg);
  ok(st.phone, 'a phone in the bag');
  await pg.keyboard.press('KeyU'); await sleep(300); st = await U(pg);
  ok(st.open && st.picking && /Table Park/.test(st.ui) && /Soc Tav/.test(st.ui) && /Brighton/.test(st.ui) && /ferry/.test(st.ui) && /pier/.test(st.ui), 'U opens the app with the 5 destinations', JSON.stringify({ open: st.open, picking: st.picking, ui: st.ui.slice(0, 160) }));
  await pg.screenshot({ path: `${out}/uber-app.png` });
  await pg.keyboard.press('Escape'); await sleep(200); ok(!(await U(pg)).open, 'Esc closes the app');

  // broke: refused, no car
  await pg.evaluate(() => window.__game.uber.cash(3));
  const refused = await pg.evaluate(() => window.__game.uber.request('table')); st = await U(pg);
  ok(!refused && !st.cur && st.rides === 0 && st.cash === 3 && await toastHas(pg, 'declined'), 'broke: card declined, no car sent', JSON.stringify({ refused, cash: st.cash, rides: st.rides }));
  await pg.evaluate(() => window.__game.uber.cash(60));

  // heap before the first ride (the Uber is built lazily)
  const cdp = await pg.context().newCDPSession(pg); const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return pg.evaluate(() => performance.memory.usedJSHeapSize / 1048576); };

  // Coney → Soc Tav: pay $5, the car arrives on its own (real time), F in, the interior, the radio, B, shooting, the ride
  // the world paused (time scale 0) around the measurement so traffic / crowds don't churn the heap; the build itself is synchronous
  const c0 = (await U(pg)).cash; await pg.evaluate(() => window.__game.timeScale(0)); await sleep(1500); await heap(); const h0 = await heap();
  ok(await pg.evaluate(() => window.__game.uber.request('soctav')), 'booked a ride to Soc Tav');
  await sleep(300); await heap(); const hBuilt = await heap(); await pg.evaluate(() => window.__game.timeScale(1)); console.log(`heap after GC: before the first request ${h0.toFixed(1)} MB, with the car, driver and road graphs built ${hBuilt.toFixed(1)} MB (delta ${(hBuilt - h0).toFixed(1)} MB)`);
  const geo = await pg.evaluate(() => window.__game.uber.geoBytes());
  ok(hBuilt - h0 < 5, 'building the Uber adds under 5 MB of heap', JSON.stringify({ heap: +(hBuilt - h0).toFixed(1), driver: (await U(pg)).cur?.avatar }));
  ok(geo && geo.own < 1 && geo.shared > 0.3, 'the Uber reuses the parked sedan geometry (under 1 MB of its own)', JSON.stringify(geo));
  st = await U(pg); ok(st.cash === c0 - 5 && st.cur?.phase === 'coming' && st.cur.driverModel, 'paid $5, car coming with a driver', JSON.stringify({ cash: st.cash, cur: st.cur }));
  ok(st.cur.approachT > 5 && st.cur.approachT < 60, 'approach ETA is sane (Coney)', `${st.cur.approachT} s over ${st.cur.approachL} m`);
  ok(/Arriving in/.test(st.ui), 'phone card shows the driver and ETA', st.cur.lines.join(' | '));
  // booked: a compact corner card (under 30% of the width, clear of the crosshair), tap to expand, tap again to collapse
  const card = await pg.evaluate(() => window.__game.uber.card());
  const clear = (c) => c.x > c.vw / 2 + 60 || c.y + c.h < c.vh / 2 - 60;
  ok(card.mini && card.w <= card.vw * 0.3 && clear(card), 'booked: the phone collapses to a small corner card', JSON.stringify(card));
  const big = await pg.evaluate(() => { window.__game.uber.tapCard(); return window.__game.uber.card(); }), small = await pg.evaluate(() => { window.__game.uber.tapCard(); return window.__game.uber.card(); });
  ok(!big.mini && big.w > card.w && small.mini, 'tap expands the card, tap again collapses it', JSON.stringify({ big: big.w, small: small.w }));
  await sleep(2500); await pg.screenshot({ path: `${out}/uber-coming.png` });
  const t0 = Date.now(); await pg.waitForFunction(() => window.__game.uber.state().cur?.phase === 'waiting', null, { timeout: 90000 });
  const arr = (Date.now() - t0) / 1000 + 2.5; ok(arr < 60, 'the car pulled up at the kerb', `${arr.toFixed(1)} s`);
  const walk = await pg.evaluate(([x, , z]) => Math.hypot(window.__game.uber.kerb()[0] - x, window.__game.uber.kerb()[1] - z), SPAWN);
  ok(walk < 25, 'the kerb is a few metres from where you booked', `${walk.toFixed(1)} m`);
  // the waiting car is solid: walk straight at it from the kerb side for 1.5 s, you stop at its flank
  const solidN = await pg.evaluate(() => window.__game.uber.solid());
  await pg.evaluate(() => { const k = window.__game.uber.kerb(), c = Math.cos(k[2]), s = Math.sin(k[2]); window.__game.teleport(k[0] + c * 3, 0, k[1] - s * 3, k[2] + Math.PI / 2, 0); });
  await sleep(300); await pg.keyboard.down('KeyW'); await sleep(1500); await pg.keyboard.up('KeyW'); await sleep(200);
  const side = await pg.evaluate(() => { const k = window.__game.uber.kerb(), p = window.__ctx.player.position; return +((p.x - k[0]) * Math.cos(k[2]) - (p.z - k[1]) * Math.sin(k[2])).toFixed(2); });
  ok(solidN > 0 && side > 0.85, 'you can\'t walk through the waiting car', JSON.stringify({ boxes: solidN, offsetFromCentre: side }));
  // the driver's hands on the wheel rim
  const hands = await pg.evaluate(() => window.__game.uber.hands());
  ok(hands && hands.every((d) => d < 0.1), 'the driver\'s hands are within 10 cm of the wheel rim', JSON.stringify(hands));
  st = await boardF(pg);
  ok(st.seat === 1 && st.mounted, 'F gets you in, the booker sits rear right (behind the front passenger)', JSON.stringify({ seat: st.seat }));
  ok(st.eyeOverRoad > 1.0 && st.eyeOverRoad < 1.3, 'seated eye height', `${st.eyeOverRoad} m`);
  // the eye is inside the cabin: under the roof, inside the body width, between the dash and the rear seat
  const inCab = await pg.evaluate(() => { const c = window.__ctx.camera.position, s = window.__game.uber.state().cur.car, h = s[2], dx = c.x - s[0], dz = c.z - s[1]; const fwd = -(dx * Math.sin(h) + dz * Math.cos(h)), right = dx * Math.cos(h) - dz * Math.sin(h); return { fwd: +fwd.toFixed(2), right: +right.toFixed(2), y: +c.y.toFixed(2) }; });
  ok(inCab.right > 0.3 && inCab.right < 0.6 && inCab.fwd > -1.3 && inCab.fwd < -0.6 && inCab.y < 1.4, 'eye inside the cabin, back row, right side', JSON.stringify(inCab));
  ok(await pg.evaluate(() => { let n = 0; window.__ctx.scene?.traverse?.((o) => { if (o.name === 'uberRear') n++; }); return n; }) === 1, 'the booker gets the Camry rear cabin');
  await pg.evaluate(() => { const p = window.__ctx.player; p.pitch = -0.22; }); await sleep(400); await pg.screenshot({ path: `${out}/uber-booker-eye.png` });   // the headrest, the windshield over it and the seat back's map pocket
  await pg.evaluate(() => { const p = window.__ctx.player; p.yaw += 1.1; p.pitch = -0.15; }); await sleep(400); await pg.screenshot({ path: `${out}/uber-driver.png` });
  await pg.evaluate(() => { const p = window.__ctx.player; p.yaw -= 1.1; });
  // the radio plays in the car
  const radio = await pg.waitForFunction(() => window.__ctx.world.radio?.qa?.().some((a) => a.playing), null, { timeout: 15000 }).then(() => true, () => false);
  ok(radio, 'Luna Park Radio plays in the Uber');
  // B: a drink, then a smoke, in the back of the Camry
  await pg.evaluate(async () => { const m = await import('/src/world/hangkit.js'); m.hangkit.give('tallboy'); }); await pg.keyboard.press('KeyB'); await sleep(400);
  const drunk = await pg.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.state().drunk); ok(drunk > 0, 'B drinks in the car', `drunk ${drunk}`);
  await pg.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.give('blunt')); await pg.keyboard.press('KeyB'); await sleep(2000);   // the first puff lands ~0.6 s in
  const high = await pg.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.state().high); ok(high > 0, 'B smokes in the back seat', `high ${high}`);
  // shooting out of the window: a pistol, aim out of the right side, a real mousedown
  const shot = await pg.evaluate(async () => { const c = window.__ctx, W = c.weapons; W.lock?.(1, false); W.collect('m9', 30); W.selectBag(W.bag.indexOf('m9')); await new Promise((r) => setTimeout(r, 900));
    const p = c.player, h = window.__game.uber.state().cur.car[2]; p.yaw = h - Math.PI / 2; p.pitch = -0.02; const shots = []; c.bus.on('shot', (e) => { if (e?.who === 'player') shots.push(e); });
    const f0 = W.state.fired; for (let k = 0; k < 20; k++) await new Promise((r) => requestAnimationFrame(r));
    c.input.mouse.buttons = 1; for (let k = 0; k < 6; k++) await new Promise((r) => requestAnimationFrame(r)); c.input.mouse.buttons = 0;   // the trigger, as the mouse sets it
    return { gun: W.currentId, fired: W.state.fired - f0, shots: shots.length }; });
  ok(shot.fired > 0, 'shooting from the back seat works', JSON.stringify(shot));
  await sleep(200); await pg.screenshot({ path: `${out}/uber-shoot.png` });
  // pulls away, rides, the phone's map + next turn, the fade over the Belt, out on 8th Ave by the tavern
  await pg.waitForFunction(() => window.__game.uber.state().cur?.phase === 'riding', null, { timeout: 15000 });
  await sleep(2500); st = await U(pg); ok(st.cur.v > 1 && /ETA/.test(st.cur.lines[1]), 'riding: moving, ETA on the phone', st.cur.lines.join(' | '));
  await pg.evaluate(() => { const p = window.__ctx.player; p.yaw = window.__game.uber.state().cur.car[2]; p.pitch = -0.05; }); await sleep(300); await pg.screenshot({ path: `${out}/uber-riding.png` });
  const total = st.cur.legs.reduce((a, l) => a + l[2], 0);
  await pg.evaluate((s) => window.__game.uber.ff(s - (Date.now() - window.__game.uber.state().cur.tg) / 1000), st.cur.legs[0][2] + 0.8); await sleep(500);   // into the fade over the Belt (0.8 s past the first leg, however long we've been riding)
  st = await U(pg); ok(st.cur?.phase === 'gap', 'the long hop fades over the off-map part', st.cur?.phase);
  await pg.evaluate((s) => window.__game.uber.ff(s), total + 12); await sleep(1500);
  st = await U(pg); const tav = await pg.evaluate(() => window.__game.tavern?.state?.().inZone);
  ok(st.seat < 0 && !st.mounted && tav && Math.hypot(st.pos[0] + 6, st.pos[2] + 12000) < 20, 'ride to Soc Tav: out on 8th Ave by the tavern', JSON.stringify(st.pos));
  const h2 = await heap(); console.log(`heap after GC after the ride to Soc Tav (8th Ave zone streamed in too): ${h2.toFixed(1)} MB`);

  // from 8th Ave (Soc Tav) → the Bay Ridge ferry: the car finds you on 8th Ave (real time), the fade, off at the 69th St landing
  let r = await rideTo(pg, 'ferry', { realWait: true });
  ok(r.booked && r.appr < 30 && r.arriveS < 40, 'car arrives near Soc Tav in a sane time', JSON.stringify({ appr: r.appr, real: r.arriveS }));
  const barge = await pg.evaluate(() => window.__game.ferry.barge());
  ok(r.boarded && r.riding === 'riding' && barge.on, 'ride to the Bay Ridge ferry: on the 69th St barge', JSON.stringify(barge));
  // back to Coney, then Brighton, the pier, Table Park
  await pg.evaluate(([x, y, z]) => window.__game.teleport(x, y, z, 0, 0), SPAWN); await sleep(800);
  r = await rideTo(pg, 'brighton'); ok(r.boarded && r.end.seat < 0 && r.pos[0] > 1100 && Math.abs(r.pos[2] + 40) < 12, 'ride to Brighton Beach', JSON.stringify({ pos: r.pos, legs: r.legs }));
  r = await rideTo(pg, 'pier'); ok(r.boarded && r.end.seat < 0 && Math.hypot(r.pos[0] + 360, r.pos[2] - 120) < 240, 'ride to the Coney Island pier (Steeplechase)', JSON.stringify({ pos: r.pos, legs: r.legs }));
  r = await rideTo(pg, 'table'); const os = await pg.evaluate(() => window.__ctx.world.onlineStart);
  ok(r.boarded && r.end.seat < 0 && Math.hypot(r.pos[0] - os[0], r.pos[2] - os[2]) < 160, 'ride to Table Park', JSON.stringify({ pos: r.pos, legs: r.legs }));
  // last (headless: closing the bag asks for pointer lock, which fails and pauses the game)
  await pg.evaluate(() => window.__game.inventory?.open()); await sleep(300);
  ok(await pg.evaluate(() => /iPhone/.test(window.__game.inventory.state().html) && /Open/.test(window.__game.inventory.state().html)), 'the bag lists the iPhone with OPEN');
  await pg.evaluate(() => document.querySelector('.inv-panel [data-a="app"]').click()); await sleep(300); ok((await U(pg)).open, 'OPEN in the bag opens the Uber app');
  await cdp.detach(); await pg.close();
}

// ================= two players in one car =================
{
  const room = 'uber' + Math.random().toString(36).slice(2, 7);
  const A = await open(`&mp=1&room=${room}&name=ALPHA`, 'A'), B = await open(`&mp=1&room=${room}&name=BRAVO`, 'B');
  await sleep(2500);
  for (const pg of [A, B]) await pg.evaluate(([x, y, z]) => window.__game.teleport(x, y, z, 0, 0), SPAWN);
  await sleep(1000);
  ok(await A.evaluate(() => window.__game.uber.request('table')), 'A books an Uber');
  await B.waitForFunction(() => window.__game.uber.remote().length === 1, null, { timeout: 10000 }).catch(() => {});
  ok((await B.evaluate(() => window.__game.uber.remote().length)) === 1, 'B sees the ride');
  await A.waitForFunction(() => window.__game.uber.state().cur?.phase === 'waiting', null, { timeout: 90000 });
  let a = await boardF(A); ok(a.seat === 1, 'A (the booker) in the back, rear right');
  await sleep(500);
  await B.evaluate(() => { const r = window.__game.uber.remote()[0], c = r.car; window.__game.teleport(c[0] + 2.5, 0, c[1] + 0.5, 0, 0); }); await sleep(500);
  await B.keyboard.press('KeyF'); await sleep(400); let bs = await U(B);
  ok(bs.seat === 2 && bs.mounted, 'B hops in the back, rear left', `seat ${bs.seat}`);
  await A.waitForFunction(() => window.__game.uber.state().cur?.phase === 'riding', null, { timeout: 15000 }); await sleep(3000);
  const ids = { a: await A.evaluate(() => window.__ctx.net.id), b: await B.evaluate(() => window.__ctx.net.id) };
  const see = async (pg, other) => pg.evaluate((o) => { const q = window.__ctx.net.peer(o), c = window.__game.uber.state().cur.car; return q ? { d: +Math.hypot(q.pos.x - c[0], q.pos.z - c[1]).toFixed(2), y: +q.pos.y.toFixed(2) } : null; }, other);
  const ab = await see(A, ids.b), ba = await see(B, ids.a);
  ok(ab && ab.d < 2 && ba && ba.d < 2, 'each sees the other sitting in the moving car', JSON.stringify({ ab, ba }));
  await B.evaluate(() => { const p = window.__ctx.player, h = window.__game.uber.state().cur.car[2]; p.yaw = h + 0.5; p.pitch = -0.1; }); await sleep(400); await B.screenshot({ path: `${out}/uber-mp-back-seat.png` });
  await B.evaluate(() => { const p = window.__ctx.player, h = window.__game.uber.state().cur.car[2]; p.yaw = h + 0.9; p.pitch = -0.45; }); await sleep(400); await B.screenshot({ path: `${out}/uber-rear-seat.png` });
  ok(await B.evaluate(() => { let n = 0; window.__ctx.scene?.traverse?.((o) => { if (o.name === 'uberRear') n++; }); return n; }) === 1, 'the back-seat rider gets the Camry rear cabin');
  const total = (await U(A)).cur.legs.reduce((s, l) => s + l[2], 0) + 12;
  await Promise.all([A.evaluate((s) => window.__game.uber.ff(s), total), B.evaluate((s) => window.__game.uber.ff(s), total)]); await sleep(1500);
  a = await U(A); bs = await U(B);
  ok(a.seat < 0 && bs.seat < 0 && Math.hypot(a.pos[0] - bs.pos[0], a.pos[2] - bs.pos[2]) < 5, 'both arrive together and get out', JSON.stringify({ a: a.pos, b: bs.pos }));
  await A.close(); await B.close();
}
await b.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);

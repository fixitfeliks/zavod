// Riding as a passenger in a FRIEND's car (hangkit.js V.passenger / net.js remote vehicle), not the Uber:
// 1. The passenger rolls their own window (O) and the driver's page sees it open (net.js vi.w, applied to the real car).
// 2. A passenger shot through a closed window is blocked; through their open one it registers (weapons.js canFire arc).
// 3. A passenger smoking raises the cabin haze on both pages (driver authority; the passenger sees the same mirror).
// 4. Damage (a cracked pane, a missing panel) on the driver's page shows up on the passenger's page.
// The public MQTT broker can be flaky, so the whole run retries once. Serve first: python3 qa/serve.py 8885.
// Usage: PORT=8885 node qa/friend-car-test.mjs
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 8885;
const ARGS = ['--use-angle=metal', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
  const fails = []; const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails.push(m); };
  const room = 'fc' + Math.random().toString(36).slice(2, 7);

  async function openPage(name) {
    const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { const t = m.text(); if (/\[vehicles\]|\[update:vehicles|\[weapons\]|\[net\]/.test(t) && !/RGBE|deprecated|link up|link down|404|Failed to load/.test(t)) errs.push(t); });
    await p.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
    await p.goto(`http://localhost:${PORT}/?qa=1&mp=1&room=${room}&map=coney&mode=chill&ai=0&time=day&name=${name}`, { timeout: 180000 });
    await p.waitForFunction(() => window.__game?.ready && window.__ctx.net?.connected, null, { timeout: 180000 });
    await p.evaluate(() => window.__game.setState('playing'));
    p.errs = errs; p.name = name; return p;
  }
  /** a real mousedown/mouseup (not window.__game.fire, which bypasses canFire): the only way to exercise the window gate
   *  for real. Aims relative to the DRIVER's heading (a passenger has no vehicles.mounted of their own to read it from). */
  async function tryFirePassenger(pg, driverId, relYaw, frames = 24) {
    return pg.evaluate(async ([driverId, relYaw, n]) => {
      const c = window.__ctx, W = c.weapons, p = c.player; c.input.locked = true;
      const f0 = W.state.fired;
      dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      for (let k = 0; k < n; k++) { const q = c.net.peer(driverId); if (q) { p.yaw = q.heading + relYaw; p.pitch = 0; } await new Promise((r) => requestAnimationFrame(r)); }
      dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      return W.state.fired - f0;
    }, [driverId, relYaw, frames]);
  }

  const A = await openPage('ALPHA'), B = await openPage('BRAVO');
  await sleep(1200);
  await A.evaluate(() => { const V = window.__ctx.vehicles, p = window.__ctx.player.position; V.mount(V.spawnCar(p.x, p.z, 0, 'sedan', 0x8a1c1c, 0)); });
  const driverId = await A.evaluate(() => window.__ctx.net.id);

  // ---- B hops in as A's passenger (same retry-until-landed pattern car-windows-test.mjs uses: MQTT is lossy/laggy) ----
  let passenger = false;
  for (let i = 0; i < 6 && !passenger; i++) {
    await B.evaluate(() => { const n = window.__ctx.net, id = n.list()[0], q = id && n.peer(id); if (q?.pos) window.__game.teleport(q.pos.x + 1.6, 0, q.pos.z, 0, 0); });
    await sleep(500);
    await B.evaluate(() => { const inp = window.__ctx.input; inp.pressed.add('KeyF'); setTimeout(() => inp.pressed.delete('KeyF'), 150); });
    await sleep(400);
    passenger = await B.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.state().passenger);
  }
  ok(passenger, 'B rides as a passenger in A\'s car');
  const pane = await B.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.passengerPane());
  ok(['glassFR', 'glassRL', 'glassRR'].includes(pane), 'B has a seat window to gate/roll', pane);

  // give B a pistol (drive-bys are allowed one-handed, so any block below is the window gate, not the stowed-weapon gate)
  await B.evaluate(() => { const C = window.__ctx; C.weapons.collect('m9', 30); C.weapons.selectBag(C.weapons.bag.indexOf('m9')); });
  await sleep(300);

  // ---- 2a. closed window: a passenger's shot is blocked ----
  const closedOpen = await A.evaluate((n) => window.__ctx.vehicles.qaWindowOpen(n), pane);
  ok(!closedOpen, 'B\'s seat window starts up (on A\'s real car)', closedOpen);
  const blocked = await tryFirePassenger(B, driverId, Math.PI / 2);
  ok(blocked === 0, 'a passenger\'s shot through a closed window is blocked', blocked);

  // ---- 3. haze while still sealed: B smokes, A (driver authority) and B (mirror) both see it build ----
  await B.evaluate(async () => { const { hangkit } = await import('/src/world/hangkit.js'); hangkit.useItem('cigs'); });
  await sleep(1200);   // the first puff (and its net 'smoke') fires ~0.6s in; give it a cycle plus network round trip
  const hazeA = await A.evaluate(() => window.__ctx.vehicles.qaDamage(window.__ctx.vehicles.mounted)?.haze || 0);
  const hazeB = await B.evaluate((id) => window.__ctx.vehicles.qaDamage(window.__ctx.net.qaVehObj(id))?.haze || 0, driverId);
  ok(hazeA > 0.05, 'smoking as a passenger raises the driver\'s real cabin haze', hazeA);
  ok(hazeB > 0.05, 'and the passenger\'s own page mirrors the same haze', hazeB);

  // ---- 1. B rolls their own window (O); A's real car opens it, B's mirror shows it too ----
  await B.evaluate(() => { window.__ctx.input.pressed.add('KeyO'); });
  await sleep(900);
  const openedA = await A.evaluate((n) => window.__ctx.vehicles.qaWindowOpen(n), pane);
  ok(openedA, 'B rolling their window reaches A\'s real car (driver sees it open)', openedA);
  const openedB = await B.evaluate(([id, n]) => window.__ctx.vehicles.qaWindowOpen(n, window.__ctx.net.qaVehObj(id)), [driverId, pane]);
  ok(openedB, 'and B\'s own mirror of that car shows the same open window', openedB);

  // ---- 2b. with it open, the same shot registers ----
  const registers = await tryFirePassenger(B, driverId, Math.PI / 2);
  ok(registers > 0, 'and now a passenger\'s shot through their open window registers', registers);

  // ---- 4. damage on A's real car (forced via qa hooks: deterministic, no aiming) shows on B's mirror ----
  await A.evaluate(() => { const V = window.__ctx.vehicles, car = V.mounted; V.qaHitPane('glassW', 3, car); V.qaDetachPanel('hood', car); });
  await sleep(700);
  const dmgA = await A.evaluate(() => window.__ctx.vehicles.qaDamage(window.__ctx.vehicles.mounted));
  const dmgB = await B.evaluate((id) => window.__ctx.vehicles.qaDamage(window.__ctx.net.qaVehObj(id)), driverId);
  ok(dmgA.panes.glassW === 'down' && dmgA.panels.hood === 3, 'A\'s own car took the forced damage', JSON.stringify(dmgA));
  ok(dmgB?.panes.glassW === 'down' && dmgB?.panels.hood === 3, 'and B\'s mirror of A\'s car shows the same damage', JSON.stringify(dmgB));

  for (const pg of [A, B]) ok(!pg.errs.length, `no errors (${pg.name}) ${pg.errs.slice(0, 3).join(' | ')}`);
  await A.close(); await B.close(); await b.close();
  return fails;
}

let fails = await run();
if (fails.length) { console.log(`retry 1: ${fails.length} failed, the broker may have been slow - trying once more`); fails = await run(); }
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
process.exit(fails.length ? 1 : 0);

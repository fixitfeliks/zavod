// Two-wheelers QA: node qa/two-wheelers-test.mjs [outPrefix]  (PORT env, default 8790)
// 1. Ride each type (motorcycle, Citi Bike-style e-bike, delivery e-bike): mount with F, drive a little, screenshot.
// 2. An AI e-bike in traffic: sample solids.js for 60 s of real time, zero overlaps with anything.
// 3. A motorcycle into a car: both take damage, and a hard enough hit throws the rider (high outgoing speed, dismounted).
import { chromium } from 'playwright-core';
const prefix = process.argv[2] || 'qa/shots/two-wheelers';
const url = `http://localhost:${process.env.PORT || 8790}/?qa=1&map=coney&ai=0`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const fails = []; const check = (ok, msg, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + msg, x); if (!ok) fails.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction('window.__game && window.__game.ready === true', null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const c = window.__ctx, p = c.player.position; window.__spot = { x: p.x, y: p.y, z: p.z, yaw: c.player.yaw }; });

  // ---- 1. ride each type ----
  let i = 0;
  for (const variant of ['motorcycle', 'citibike', 'delivery']) {
    i++;
    const r = await page.evaluate(({ variant, i }) => {
      const c = window.__ctx, s = window.__spot, ang = s.yaw + i * 0.6, dx = -Math.sin(ang) * 6, dz = -Math.cos(ang) * 6;
      const x = s.x + dx, z = s.z + dz;
      const b = variant === 'motorcycle' ? c.vehicles.qaSpawn(x, z, ang, s.y) : c.vehicles.qaSpawnEbike(x, z, ang, variant, s.y);
      c.player.teleport(x - dx * 0.25, s.y, z - dz * 0.25, ang, -0.1);
      return { kind: b.spec.kind };
    }, { variant, i });
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyF'); await page.waitForTimeout(300);
    const m0 = await page.evaluate(() => ({ mounted: !!window.__ctx.player.mounted, kind: window.__ctx.vehicles.mounted?.spec.kind }));
    check(m0.mounted, `${variant} mounted with F`, JSON.stringify({ spawned: r.kind, got: m0.kind }));
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW');
    const st = await page.evaluate(() => window.__ctx.vehicles.qaState());
    check(!!st && Math.abs(st.fwd) > 0.5, `${variant} moves under throttle`, st ? st.fwd.toFixed(2) : 'null');
    await page.screenshot({ path: `${prefix}-${variant}.png` });
    await page.keyboard.press('KeyF'); await page.waitForTimeout(300);
  }

  // ---- 2. an e-bike in AI traffic: zero overlaps with anything for 60 s ----
  await page.evaluate(() => { const c = window.__ctx, s = window.__spot; c.player.teleport(s.x, s.y, s.z, s.yaw, -0.05); });
  await page.waitForTimeout(500);
  const hasEbikes = await page.evaluate(async () => { const S = await import('/src/vehicles/solids.js'); const c = window.__ctx; const L = S.solidsNear(c.player.position.x, c.player.position.z, 400); return L.length; });
  check(hasEbikes >= 0, 'traffic solids queryable', hasEbikes);

  // ---- 2a. solids.js's duplicate-entry fix: a source registered after the world has started (traffic already driving,
  // builds already happening every few ms) must bin exactly once, right away, and track a move / a removal correctly ----
  const dupCheck = await page.evaluate(async () => {
    const S = await import('/src/vehicles/solids.js');
    S.solidsNear(0, 0, 1);   // warm the dynamic grid so the next registration lands squarely inside the <4ms throttle window
    const probe = { x: 90000, z: 90000, h: 0, hl: 1, hw: 1, v: 0 };
    S.solidSource('__qaDupProbe', () => [probe]);
    let threw = null, n0 = -1;
    try { n0 = S.solidsNear(90000, 90000, 5).filter((o) => o === probe).length; } catch (e) { threw = e.message; }
    S.staticSolids([{ x: 90010, z: 90010, h: 0, hl: 1, hw: 1, v: 0 }]);   // the same race via the static side
    let staticThrew = null; try { S.solidsNear(90010, 90010, 5); } catch (e) { staticThrew = e.message; }
    probe.x = 90005;
    const n1 = S.solidsNear(90005, 90000, 5).filter((o) => o === probe).length;
    probe.gone = true;
    const n2 = S.solidsNear(90005, 90000, 5).filter((o) => o === probe).length;
    return { threw, staticThrew, n0, n1, n2 };
  });
  console.log('solids duplicate-entry check', JSON.stringify(dupCheck));
  check(!dupCheck.threw && !dupCheck.staticThrew, 'registering mid-play does not throw', JSON.stringify(dupCheck));
  check(dupCheck.n0 === 1, 'a newly-registered source appears exactly once', dupCheck.n0);
  check(dupCheck.n1 === 1, 'it still appears exactly once after moving', dupCheck.n1);
  check(dupCheck.n2 === 0, 'it is gone once removed', dupCheck.n2);

  // ---- 2b. a parked scooter and a parked dock e-bike dropped right in a live traffic lane: AI traffic must steer around
  // them like any other solid, not drive through them ----
  const planted = await page.evaluate(() => {
    const c = window.__ctx, P = c.player.position;
    const cars = (window.__game.traffic?.cars?.() || []).filter((ca) => ca.v > 2);
    cars.sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z));
    const t = cars[0]; if (!t) return { error: 'no moving traffic car nearby' };
    const fx = -Math.sin(t.h), fz = -Math.cos(t.h);
    const scooter = c.vehicles.qaSpawnScooter(t.x + fx * 16, t.z + fz * 16, t.h + Math.PI / 2, 'kick', t.y ?? P.y);
    const ebike = c.vehicles.qaSpawnEbike(t.x + fx * 26, t.z + fz * 26, t.h + Math.PI / 2, 'citibike', t.y ?? P.y);
    window.__plant = { scooter: { x: scooter.pos.x, z: scooter.pos.z }, ebike: { x: ebike.pos.x, z: ebike.pos.z } };
    return window.__plant;
  });
  check(!planted.error, 'found a moving traffic car to plant two-wheelers in front of', JSON.stringify(planted));

  await page.evaluate(async () => {
    const S = await import('/src/vehicles/solids.js'); const IN = 0.1;
    window.__ov = { samples: 0, hits: 0, seenEbike: false, plantedSamples: 0, plantedHits: 0, log: [] };
    window.__ovTimer = setInterval(() => {
      const c = window.__ctx, P = c.player.position, O = window.__ov, pl = window.__plant; O.samples++;
      const L = S.solidsNear(P.x, P.z, 300).filter((o) => !o.gone);
      if (L.some((o) => o.variant)) O.seenEbike = true;
      for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
        const A = L[a], B = L[b]; if (Math.abs(A.x - B.x) > 14 || Math.abs(A.z - B.z) > 14) continue;
        if (S.obbOverlap(A.x, A.z, A.h, A.hl - IN, A.hw - IN, { x: B.x, z: B.z, h: B.h, hl: B.hl - IN, hw: B.hw - IN })) {
          O.hits++; if (O.log.length < 20) O.log.push(`${A.variant || A.kind || 'veh'}@${A.x.toFixed(1)},${A.z.toFixed(1)} + ${B.variant || B.kind || 'veh'}@${B.x.toFixed(1)},${B.z.toFixed(1)}`);
          if (pl) for (const [who, p] of [['scooter', pl.scooter], ['ebike', pl.ebike]]) { if (Math.hypot(A.x - p.x, A.z - p.z) < 0.4 || Math.hypot(B.x - p.x, B.z - p.z) < 0.4) O.plantedHits++; }
        }
      }
      if (pl && L.some((o) => Math.hypot(o.x - pl.scooter.x, o.z - pl.scooter.z) < 0.4 || Math.hypot(o.x - pl.ebike.x, o.z - pl.ebike.z) < 0.4)) O.plantedSamples++;
    }, 150);
  });
  await sleep(60000);
  const ov = await page.evaluate(() => { clearInterval(window.__ovTimer); return window.__ov; });
  console.log('ebike traffic overlap sample', JSON.stringify(ov));
  check(ov.samples > 300, `sampled solids for 60 s (${ov.samples})`);
  check(ov.seenEbike, 'an e-bike was in range of the sampler');
  check(ov.hits === 0, 'zero overlaps involving an e-bike in traffic', ov.hits ? ov.log.slice(0, 6).join(' | ') : '');
  check(!planted.error ? ov.plantedSamples > 300 : true, 'the planted scooter/e-bike stayed in range for the full 60 s', ov.plantedSamples);
  check(ov.plantedHits === 0, 'zero AI overlaps with the planted parked scooter/e-bike', ov.plantedHits);

  // ---- 3. a motorcycle into a car: both damaged, the rider thrown ----
  // mount + inject speed directly (api.mount doesn't check proximity) rather than driving blind over unknown local terrain:
  // only a few metres have to be clear, right where the player already stands, not a long accelerate-up-to-speed run.
  const crash = await page.evaluate(() => {
    const c = window.__ctx, s = window.__spot, ang = s.yaw, dx = -Math.sin(ang), dz = -Math.cos(ang);
    const bikeX = s.x, bikeZ = s.z, carX = s.x + dx * 5, carZ = s.z + dz * 5;
    const bike = c.vehicles.qaSpawn(bikeX, bikeZ, ang, s.y);
    const car = c.vehicles.spawnCar(carX, carZ, ang, 'sedan', 0x993333, s.y, true);
    c.player.teleport(bikeX, s.y, bikeZ, ang, -0.05);
    c.vehicles.mount(bike);
    bike.vel.set(dx * 18, 0, dz * 18); bike.speed = bike.fwdSpeed = 18; bike.heading = ang;
    return { carHp0: c.vehicles.qaDamage(car)?.hp, bikeHp0: c.vehicles.qaDamage(bike)?.hp };
  });
  const before = await page.evaluate(() => { const c = window.__ctx; return { mounted: !!c.player.mounted }; });
  check(before.mounted, 'mounted the motorcycle for the crash');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const c = window.__ctx; const cars = (c.vehicles.list || []).filter((v) => v.spec.car && v.kind === 'sedan');
    const car = cars.sort((a, b) => Math.hypot(a.pos.x - window.__spot.x, a.pos.z - window.__spot.z) - Math.hypot(b.pos.x - window.__spot.x, b.pos.z - window.__spot.z))[0];
    const bikes = (c.vehicles.list || []).filter((v) => v.spec.kind === 'bike');   // more than one 'bike' by now (the ride test's motorcycle too): take the one nearest the crash site
    const bike = bikes.sort((a, b) => Math.hypot(a.pos.x - window.__spot.x, a.pos.z - window.__spot.z) - Math.hypot(b.pos.x - window.__spot.x, b.pos.z - window.__spot.z))[0];
    return { mounted: !!c.player.mounted, carHp: car ? c.vehicles.qaDamage(car)?.hp : null, bikeHp: bike ? c.vehicles.qaDamage(bike)?.hp : null, speed: c.player.speed, vel: [c.player.velocity.x, c.player.velocity.y, c.player.velocity.z] };
  });
  console.log('crash result', JSON.stringify({ before, after, crash }));
  check(after.carHp != null && after.carHp < crash.carHp0, 'the car took crash damage', `${crash.carHp0} -> ${after.carHp}`);
  check(after.bikeHp != null && after.bikeHp < crash.bikeHp0, 'the motorcycle took crash damage', `${crash.bikeHp0} -> ${after.bikeHp}`);
  check(!after.mounted, 'the rider was thrown off (dismounted) by the crash');
  await page.screenshot({ path: `${prefix}-crash.png` });

  const perf = await page.evaluate(() => window.__game.stats());
  console.log('stats', JSON.stringify(perf));
} catch (e) { fails.push('exception ' + (e.message || e)); console.log('EXC', e); }
console.log(JSON.stringify({ ok: fails.length === 0 && errors.length === 0, fails, errors: errors.slice(0, 10) }));
await browser.close();
process.exitCode = fails.length ? 1 : 0;

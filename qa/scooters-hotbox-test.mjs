// Scooters + hotbox QA: node qa/scooters-hotbox-test.mjs [outPrefix]  (PORT env, default 8790)
// 1. Ride a kick scooter and a moped: mount with F, drive a little, screenshot.
// 2. Smoke in a closed car (all windows up): the cabin haze level (vehicledamage.js) rises.
// 3. Roll a window down: the haze drains and a vent puff (the shared smoke sprite pool) spawns.
import { chromium } from 'playwright-core';
const prefix = process.argv[2] || 'qa/shots/scooters-hotbox';
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

  // ---- 1. ride a kick scooter and a moped ----
  let i = 0;
  for (const variant of ['kick', 'moped']) {
    i++;
    const r = await page.evaluate(({ variant, i }) => {
      const c = window.__ctx, s = window.__spot, ang = s.yaw + i * 0.6, dx = -Math.sin(ang) * 5, dz = -Math.cos(ang) * 5;
      const x = s.x + dx, z = s.z + dz;
      const b = c.vehicles.qaSpawnScooter(x, z, ang, variant, s.y);
      c.player.teleport(x - dx * 0.25, s.y, z - dz * 0.25, ang, -0.08);
      return { kind: b.spec.kind };
    }, { variant, i });
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyF'); await page.waitForTimeout(300);
    const m0 = await page.evaluate(() => ({ mounted: !!window.__ctx.player.mounted, kind: window.__ctx.vehicles.mounted?.spec.kind }));
    check(m0.mounted, `${variant} scooter mounted with F`, JSON.stringify({ spawned: r.kind, got: m0.kind }));
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1100); await page.keyboard.up('KeyW');
    const st = await page.evaluate(() => window.__ctx.vehicles.qaState());
    check(!!st && Math.abs(st.fwd) > 0.3, `${variant} scooter moves under throttle`, st ? st.fwd.toFixed(2) : 'null');
    await page.screenshot({ path: `${prefix}-${variant}.png` });
    await page.keyboard.press('KeyF'); await page.waitForTimeout(300);
  }

  // ---- 2. hotbox: smoke in a closed car, the cabin haze rises ----
  const spot = await page.evaluate(() => window.__spot);
  await page.evaluate((s) => { const c = window.__ctx; c.player.teleport(s.x, s.y, s.z, s.yaw, -0.05); }, spot);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => {
    const c = window.__ctx, p = c.player.position;
    const car = c.vehicles.spawnCar(p.x, p.z, p.yaw || 0, 'sedan', 0x223355, p.y);
    c.vehicles.mount(car); window.__hotboxCar = car;
    return { mounted: !!c.vehicles.mounted, haze0: c.vehicles.qaDamage(car)?.haze, windowOpen: c.vehicles.qaWindowOpen() };
  });
  check(before.mounted, 'mounted a fresh car for the hotbox test');
  check(before.haze0 === 0, 'cabin haze starts at zero', before.haze0);
  check(!before.windowOpen, "the driver's window starts up (sealed cabin)", before.windowOpen);
  await page.evaluate(async () => { const { hangkit } = await import('/src/world/hangkit.js'); hangkit.useItem('cigs'); });
  await sleep(5500);
  const smoked = await page.evaluate(() => { const c = window.__ctx; return c.vehicles.qaDamage(window.__hotboxCar); });
  check(smoked.haze > 0.08, 'smoking in the sealed car builds the cabin haze', smoked.haze);
  await page.screenshot({ path: `${prefix}-hazy-cabin.png` }); console.log('shot', `${prefix}-hazy-cabin.png`);

  // ---- 3. roll a window down: the haze drains and a vent puff spawns ----
  const peak = smoked.haze;
  await page.evaluate(() => window.__ctx.vehicles.qaWindow());
  await sleep(550);
  const opened = await page.evaluate(() => window.__ctx.vehicles.qaWindowOpen());
  check(opened, 'rolling the window down opens it');
  await sleep(900);
  const venting = await page.evaluate(() => window.__ctx.vehicles.qaSmokeActive());
  check(venting > 0, 'a vent puff (shared smoke sprite pool) is active while the window is down', venting);
  await page.screenshot({ path: `${prefix}-venting.png` }); console.log('shot', `${prefix}-venting.png`);
  await sleep(3500);
  const drained = await page.evaluate(() => { const c = window.__ctx; return c.vehicles.qaDamage(window.__hotboxCar).haze; });
  check(drained < peak * 0.6, 'the haze drains once the window is down', `${peak.toFixed(3)} -> ${drained.toFixed(3)}`);
  await page.evaluate(() => window.__ctx.vehicles.dismount());

  const perf = await page.evaluate(() => window.__game.stats());
  console.log('stats', JSON.stringify(perf));
} catch (e) { fails.push('exception ' + (e.message || e)); console.log('EXC', e); }
console.log(JSON.stringify({ ok: fails.length === 0 && errors.length === 0, fails, errors: errors.slice(0, 10) }));
await browser.close();
process.exitCode = fails.length ? 1 : 0;

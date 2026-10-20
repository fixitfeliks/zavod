// Car windows: roll down/up, drive-by shooting gated by the window opening, a passenger drinking/smoking in any car (not just
// the Uber), and the door's hinge pulse on entry. Serve first: python3 qa/serve.py 8875. Usage: PORT=8875 node qa/car-windows-test.mjs [--out dir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PORT = process.env.PORT || 8875, OUT = arg('--out', 'qa/shots/car-windows'); mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=metal', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const fails = []; const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(q, name) {
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (/\[vehicles\]|\[update:vehicles|\[weapons\]|\[uber\]/.test(m.text())) errs.push(m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
  await p.goto(`http://localhost:${PORT}/${q}`, { timeout: 180000 });
  await p.waitForFunction((mp) => window.__game?.ready && (!mp || window.__ctx.net?.connected), q.includes('mp=1'), { timeout: 180000 });
  await p.evaluate(() => window.__game.setState('playing'));
  p.errs = errs; p.name = name; return p;
}
/** a real mousedown/mouseup (not window.__game.fire, which bypasses canFire): the only way to exercise the window gate for
 *  real. input.locked gates mousedown outside a real pointer lock (QA never grabs one); relYaw is re-pinned every frame
 *  because vehicles.js's free-look re-centres (idle > ~0.6 s) and would otherwise drag the aim back off the window within a frame or two. */
async function tryFire(pg, relYaw, frames = 20) {
  return pg.evaluate(async ([relYaw, n]) => {
    const c = window.__ctx, W = c.weapons, p = c.player; c.input.locked = true;
    const f0 = W.state.fired;
    dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    for (let k = 0; k < n; k++) { const car = c.vehicles.mounted; if (car) { p.yaw = car.heading + relYaw; p.pitch = 0; } await new Promise((r) => requestAnimationFrame(r)); }
    dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    return W.state.fired - f0;
  }, [relYaw, frames]);
}

// ================= solo: door pulse (standing outside, so the screenshot actually shows it), window roll, aim-gated drive-by shooting =================
const p = await openPage('?qa=1&map=coney&ai=0&time=day&traffic=0', 'solo');
// a parked-but-driveable car a few metres ahead, not mounted: qaSwingDoor fires the same hinge pulse mount() does, with a
// clear outside view of it (the chase cam's first use on this map stalls on world streaming for the screenshot's sake, so
// we just don't drive for this shot)
await p.evaluate(() => { const C = window.__ctx, V = C.vehicles, pos = C.player.position;
  const car = V.spawnCar(pos.x + 3, pos.z, Math.PI / 2, 'sedan', 0x22305c, 0);   // 3 m along a world axis (not player-yaw-relative): stays on the ground near the player regardless of which way they're facing
  window.__door = car; V.qaSwingDoor(null, car);   // side-on, so the driver's door (facing the player) reads clearly in the shot
  C.player.teleport(pos.x, pos.y, pos.z + 3, Math.atan2(car.pos.x - pos.x, car.pos.z - (pos.z + 3)), -0.1); });
await sleep(350);   // inside the hold phase (open 0.22s, hold to 0.57s): a plateau at full swing, not a timing-sensitive ramp
const doorMid = await p.evaluate(() => { const V = window.__ctx.vehicles, car = window.__door, n = V.driverDoor(car); return +car.panels[n].pivot.rotation.y.toFixed(3); });
ok(Math.abs(doorMid) > 0.3, 'the door swings open on entry', doorMid);
await p.screenshot({ path: `${OUT}/door-open.png` }); console.log('shot', `${OUT}/door-open.png`);
await sleep(1200);
const doorSettled = await p.evaluate(() => { const V = window.__ctx.vehicles, car = window.__door, n = V.driverDoor(car); return +car.panels[n].pivot.rotation.y.toFixed(3); });
ok(Math.abs(doorSettled) < 0.02, 'and settles shut again', doorSettled);

await p.evaluate(() => { const C = window.__ctx, V = C.vehicles, pos = C.player.position;
  const car = V.spawnCar(pos.x, pos.z, 0, 'sedan', 0x22305c, 0); V.mount(car); });

ok(!(await p.evaluate(() => window.__ctx.vehicles.qaWindowOpen())), 'the driver\'s window starts up');

// a pistol: drive-bys are allowed one-handed, so any blocking below is the window gate, not the stowed-weapon gate
await p.evaluate(() => { const C = window.__ctx; C.weapons.collect('m9', 30); C.weapons.selectBag(C.weapons.bag.indexOf('m9')); });
await sleep(300);
const blocked = await tryFire(p, -Math.PI / 2);
ok(blocked === 0, 'a shot with the window up is blocked', blocked);
await p.screenshot({ path: `${OUT}/window-up.png` });

await p.evaluate(() => window.__ctx.vehicles.qaWindow()); await sleep(500);
const openNow = await p.evaluate(() => window.__ctx.vehicles.qaWindowOpen());
ok(openNow, 'rolling it down opens it');
await p.screenshot({ path: `${OUT}/window-down.png` }); console.log('shot', `${OUT}/window-down.png`);

const registers = await tryFire(p, -Math.PI / 2);
ok(registers > 0, 'a shot through the open window registers', registers);

await p.evaluate(() => window.__ctx.vehicles.qaWindow()); await sleep(500);
ok(!(await p.evaluate(() => window.__ctx.vehicles.qaWindowOpen())), 'and rolling it back up closes it');

ok(!p.errs.length, `no errors (solo) ${p.errs.slice(0, 3).join(' | ')}`);
await p.close();

// ================= two players: a passenger in a non-Uber (stolen) car can drink and smoke =================
const room = 'cw' + Math.random().toString(36).slice(2, 7);
const A = await openPage(`?qa=1&mp=1&room=${room}&map=coney&mode=chill&ai=0&time=day&name=ALPHA`, 'A');
const BB = await openPage(`?qa=1&mp=1&room=${room}&map=coney&mode=chill&ai=0&time=day&name=BRAVO`, 'B');
await sleep(1200);
await A.evaluate(() => { const V = window.__ctx.vehicles, p = window.__ctx.player.position; V.mount(V.spawnCar(p.x, p.z, 0, 'sedan', 0x8a1c1c, 0)); });
await BB.waitForFunction(() => { const n = window.__ctx.net; return n?.list?.().some((id) => n.peer(id)?.veh); }, null, { timeout: 15000 }).catch(() => {});   // net.js: A's vehicle state reaches B
let bst = {};
for (let i = 0; i < 5 && !bst.passenger; i++) {   // MQTT is lossy/laggy; re-teleport to the peer's *current* reported position each try, not a stale read
  await BB.evaluate(() => { const n = window.__ctx.net, id = n.list()[0], q = id && n.peer(id); if (q?.pos) window.__game.teleport(q.pos.x + 1.6, 0, q.pos.z, 0, 0); });
  await sleep(500);
  await BB.evaluate(() => { const inp = window.__ctx.input; inp.pressed.add('KeyF'); setTimeout(() => inp.pressed.delete('KeyF'), 150); });
  await sleep(400);
  bst = await BB.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.state());
}
ok(bst.passenger, 'B hops in as a passenger in A\'s (stolen) car', JSON.stringify({ passenger: bst.passenger }));

await BB.evaluate(async () => { const { hangkit } = await import('/src/world/hangkit.js'); hangkit.useItem('cigs'); });
await sleep(400);
bst = await BB.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.state());
ok(bst.smoke > 0, 'a passenger in a non-Uber car can smoke', bst.smoke);

await BB.evaluate(async () => { const { hangkit } = await import('/src/world/hangkit.js'); hangkit.give('kvass'); hangkit.useItem('kvass'); });
await sleep(300);
bst = await BB.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.state());
ok(bst.drunk > 0, 'and drink', bst.drunk);

for (const pg of [A, BB]) ok(!pg.errs.length, `no errors (${pg.name}) ${pg.errs.slice(0, 3).join(' | ')}`);
await A.close(); await BB.close();

await b.close();
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
process.exit(fails.length ? 1 : 0);

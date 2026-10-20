// Car damage + crash feel: shoot a parked car (it goes live: bullet holes, a pane cracks then shatters, a door shot off), ram
// another one with a driven car (both take damage, the parked one is shoved and you lose speed by mass), close-up shots of the
// damage and a tyre. Serve first: python3 qa/serve.py 8871. Usage: PORT=8871 node qa/car-damage-test.mjs [--out dir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PORT = process.env.PORT || 8871, OUT = arg('--out', 'qa/shots/car-damage'); mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (/\[vehicles\]|\[update:vehicles/.test(m.text())) errs.push(m.text()); });
await p.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
await p.goto(`http://localhost:${PORT}/?qa=1&map=coney&ai=0&time=day&traffic=0`, { timeout: 180000 }); await p.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
await p.evaluate(() => window.__game.setState('playing'));
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const wait = (ms) => p.waitForTimeout(ms);
// helpers in the page: pick parked cars near the player, aim at a point in a car's kit frame, fire
await p.evaluate(() => {
  const C = window.__ctx, V = C.vehicles; window.__t = {
    pick(skip = []) { const P = C.player.position; return (C.world.parkedCars || []).filter((c) => !c.gone && !skip.includes(c) && ['sedan', 'suv', 'hatch', 'e34', 'lada', 'volga', 'cab'].includes(c.kind)).sort((a, q) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(q.x - P.x, q.z - P.z))[0]; },
    // stand `d` m out from a car's side (s = +1 / -1: kit +z / -z) and look at its kit point (x, y, z)
    async aim(car, kx, ky, kz, s = 1, d = 4) { const m = car.kit ? car.kit.matrixWorld : null; const T = car.kit ? null : car; let w, side;
      if (m) { car.group.updateMatrixWorld(true); w = new (C.player.position.constructor)(kx, ky, kz).applyMatrix4(m); side = new (C.player.position.constructor)(0, 0, s).transformDirection(m); }
      else { const h = (T.ry || 0); const cs = Math.cos(h), sn = Math.sin(h); w = { x: T.x + kx * cs + kz * sn, y: ky, z: T.z - kx * sn + kz * cs }; side = { x: s * sn, y: 0, z: s * cs }; }
      let ex = w.x + side.x * d, ez = w.z + side.z * d; C.player.teleport(ex, 0, ez, 0, 0); await new Promise((r) => setTimeout(r, 120)); const pp = C.player.position;
      if (Math.hypot(pp.x - ex, pp.z - ez) > 0.4 || pp.y > 0.5) { ex = w.x - side.x * d; ez = w.z - side.z * d; C.player.teleport(ex, 0, ez, 0, 0); await new Promise((r) => setTimeout(r, 120)); }   // that side is a wall: the other side
      if (C.weapons?.viewmodel) C.weapons.viewmodel.visible = false; const cp = C.camera.position;
      const dx = w.x - cp.x, dz = w.z - cp.z, yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(w.y - cp.y, Math.hypot(dx, dz)); C.player.yaw = yaw; C.player.pitch = pitch; await new Promise((r) => setTimeout(r, 120)); return { yaw, pitch }; },
    fire(n) { for (let i = 0; i < n; i++) window.__game.fire(1); },
    dmg: (car) => V.qaDamage(car),
  }; });
// ---- 1. shoot a parked car ----
const r1 = await p.evaluate(async () => { const t = window.__t, c = t.pick(); window.__c1 = c; await t.aim(c, 0.4, 0.75, 0, 1); await new Promise((r) => setTimeout(r, 300)); for (let i = 0; i < 6 && !c.live; i++) { t.fire(1); await new Promise((r) => setTimeout(r, 200)); } const car = c.live; return { kind: c.kind, live: !!car, d: car ? t.dmg(car) : null, w: window.__ctx.weapons?.currentId }; });
ok(r1.live, `shot parked ${r1.kind} goes live`); ok(r1.d && r1.d.holes > 0, `bullet hole decal (${r1.d?.holes})`);
const r2 = await p.evaluate(async () => { const t = window.__t, car = window.__c1.live; await t.aim(car, 0.5, 0.75, 0, 1, 5); for (let i = 0; i < 6; i++) { t.fire(1); await new Promise((r) => setTimeout(r, 60)); } return t.dmg(car); });
ok(r2.holes >= 4, `holes pile up (${r2.holes})`);
// glass: front side window on the +z side
const r3 = await p.evaluate(async () => { const t = window.__t, car = window.__c1.live, P = car.panes.glassFR || Object.values(car.panes)[0], name = Object.keys(car.panes).find((k) => car.panes[k] === P), c = P.ctr; await t.aim(car, c.x, c.y, c.z, 1, 3);
  const states = []; for (let i = 0; i < 12 && P.state < 2; i++) { t.fire(1); await new Promise((r) => setTimeout(r, 250)); states.push(P.state); }   // hip fire spreads: some rounds land on the pillar
  return { name, states }; });
ok(r3.states.includes(1) && r3.states.indexOf(1) < r3.states.indexOf(2), `pane ${r3.name} cracks, then shatters (${r3.states.join(',')})`);
await p.evaluate(async () => { const t = window.__t, car = window.__c1.live, P = car.panes.glassRR || car.panes.glassW; await t.aim(car, P.ctr.x, P.ctr.y, P.ctr.z, 1, 3); t.fire(1); });
// panels: shoot the rear door until it hangs, then off
const r4 = await p.evaluate(async () => { const t = window.__t, car = window.__c1.live, n = car.panels.doorRR ? 'doorRR' : 'doorFR', c = car.panels[n].ctr; let hung = false;
  for (let i = 0; i < 40 && car.panels[n].state < 3; i++) { await t.aim(car, c.x, c.y - 0.1, c.z, 1, 3); t.fire(1); await new Promise((r) => setTimeout(r, 40)); if (car.panels[n].state === 2) hung = true; } return { n, hung, d: t.dmg(car) }; });
ok(r4.hung, `${r4.n} hangs before it drops`); ok(r4.d.panels[r4.n] === 3 && r4.d.debris > 0, `${r4.n} detached as debris (${r4.d.panels[r4.n]}, debris ${r4.d.debris})`);
await wait(1500);
await p.evaluate(async () => { const t = window.__t, car = window.__c1.live; await t.aim(car, -0.2, 0.7, 0, 1, 4.2); window.__ctx.player.pitch -= 0.05; });
await wait(400); await p.screenshot({ path: `${OUT}/damaged-car.png` }); console.log('shot', `${OUT}/damaged-car.png`);
// tyre close-up
await p.evaluate(async () => { const t = window.__t, car = window.__c1.live, w = car.carWheels.find((q) => q.front && q.side > 0); await t.aim(car, w.pivot.position.x, w.pivot.position.y, w.pivot.position.z + 0.2, 1, 1.25); });
await wait(400); await p.screenshot({ path: `${OUT}/tyre.png` }); console.log('shot', `${OUT}/tyre.png`);
// ---- 2. ram a parked car ----
const r5 = await p.evaluate(async () => { const C = window.__ctx, V = C.vehicles, t = window.__t;
  for (const s of [1, -1]) { const c = t.pick([window.__c1]); if (!c) return { err: 'no car' }; const h = (c.ry || 0), fx = Math.sin(h) * s, fz = Math.cos(h) * s;   // kit +z side, in the world
    const x = c.x + fx * 11, z = c.z + fz * 11, yaw = Math.atan2(fx, fz);   // vehicle forward (-sin, -cos) points back at the car
    C.player.teleport(x + 2, 0, z, 0, 0); const car = V.spawnCar(x, z, yaw, 'sedan', 0x22305c, 0); if (!car) continue; V.mount(car); car.vel.set(0, 0, 0);
    let top = 0; const iv = setInterval(() => { top = Math.max(top, car.speed); }, 30); await V.qaDrive(1, 0, 2.2); clearInterval(iv); const mine = V.qaDamage(car), live = c.live, other = live ? V.qaDamage(live) : null, sp = car.speed;
    if (other) { await new Promise((r) => setTimeout(r, 1200)); return { mine, other, sp, top, moved: Math.hypot(live.pos.x - c.x, live.pos.z - c.z), kind: c.kind }; }
    V.dismount(); window.__c1 = c; }
  return { err: 'never hit' }; });
ok(!r5.err, `ram: ${r5.err || 'hit a parked ' + r5.kind}`);
if (!r5.err) { ok(r5.mine.hp < 2500, `ram: my car damaged (hp ${Math.round(r5.mine.hp)})`); ok(r5.other.hp < 2500, `ram: parked car damaged (hp ${Math.round(r5.other.hp)})`); ok(r5.moved > 0.2, `ram: parked car shoved ${r5.moved.toFixed(2)} m`); ok(r5.sp < 0.7 * r5.top, `ram: my car slowed by the hit, momentum shared by mass (${r5.top.toFixed(1)} to ${r5.sp.toFixed(1)} m/s)`); }
await p.evaluate(() => { const V = window.__ctx.vehicles; V.chase = true; }); await wait(500); await p.screenshot({ path: `${OUT}/ram.png` });
ok(!errs.length, `no errors ${errs.slice(0, 3).join(' | ')}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);

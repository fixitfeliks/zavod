// Vehicles never pass through each other: node qa/car-collide-test.mjs [outdir]  (PORT env, default 8790)
// 1. Two minutes of Coney traffic around Surf Ave & Stillwell: every 100 ms, every pair of vehicles near you (traffic cars, buses,
//    cop cars, the Uber, parked cars) is tested for overlap (oriented boxes, 10 cm in from the paint). Zero allowed.
// 2. An Uber ride (the approach and the ride, real time): zero overlaps with the Uber, and it still gets there.
// Exit code 1 on a failure.
import pw from 'playwright-core';
const { chromium } = pw;
const PORT = process.env.PORT || 8790, BASE = `http://localhost:${PORT}/?qa=1&map=coney&mode=chill&ai=0&time=day`;
const TRAFFIC_S = +(process.env.TRAFFIC_S || 120), RIDE_MAX_S = 240;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
let fails = 0; const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = await b.newPage({ viewport: { width: 1100, height: 620 } });
pg.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
await pg.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
await pg.goto(BASE, { timeout: 180000 });
await pg.waitForFunction(() => window.__game?.ready && window.__game.traffic && window.__game.uber, null, { timeout: 180000 });
await pg.evaluate(() => window.__game.setState('playing'));

// the in-page sampler: every 100 ms, all vehicle solids near you, pairwise (parked-parked pairs skipped: they never move)
await pg.evaluate(async () => {
  const S = await import('/src/vehicles/solids.js'), IN = 0.1;
  const name = (o) => (o.parked ? 'parked' : o.uber != null ? 'uber' : o.cop != null ? 'cop' : o.ave ? 'ave' : o.bus ? 'bus' : o.veh ? 'player' : o.peer ? 'peer' : o.kind ? 'traffic' : 'other');
  window.__col = { samples: 0, pairs: 0, hits: [], uberHits: 0, uberSamples: 0, on: true };
  setInterval(() => {
    const C = window.__col; if (!C.on) return; const P = window.__ctx.player.position; C.samples++;
    const L = [...S.solidsNear(P.x, P.z, 250)].filter((o) => !o.gone);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], q = L[j]; if (a.parked && q.parked) continue;
      if (Math.abs(a.x - q.x) > 14 || Math.abs(a.z - q.z) > 14) continue; C.pairs++;
      if (S.obbOverlap(a.x, a.z, a.h, a.hl - IN, a.hw - IN, { x: q.x, z: q.z, h: q.h, hl: q.hl - IN, hw: q.hw - IN })) { if (C.hits.length < 40) C.hits.push(`${name(a)}#${a.id ?? a.uber ?? a.cop ?? ''} + ${name(q)}#${q.id ?? q.uber ?? q.cop ?? ''} @ ${a.x.toFixed(1)},${a.z.toFixed(1)}`); C.nHits = (C.nHits || 0) + 1; if (a.uber != null || q.uber != null) C.uberHits++; } }
    if (L.some((o) => o.uber != null)) C.uberSamples++;
  }, 100);
});

// ---- 1. traffic ------------------------------------------------------------------------------------------------------------------
await pg.evaluate(() => window.__game.teleport(-72, 0.3, -116, Math.PI / 2, -0.05)); await sleep(1500);   // the sidewalk at Surf Ave & Stillwell
await pg.evaluate(() => { const C = window.__col; C.samples = 0; C.pairs = 0; C.hits = []; C.nHits = 0; });
const moved = [];
for (let t = 0; t < TRAFFIC_S; t += 10) { await sleep(10000); moved.push(await pg.evaluate(() => window.__game.traffic.state().moving)); }
let C = await pg.evaluate(() => window.__col), st = await pg.evaluate(() => window.__game.traffic.state());
console.log(`traffic: ${C.samples} samples, ${C.pairs} close pairs, moving per 10 s: ${moved.join(' ')}, crashes ${st.crashes}`);
ok(C.samples > TRAFFIC_S * 8, `sampled every 100 ms for ${TRAFFIC_S} s`, C.samples);
ok(Math.min(...moved) > 0 && moved.reduce((a, n) => a + n, 0) > moved.length * 2, 'traffic keeps moving (no gridlock)', moved.join(','));
ok(!C.nHits, 'zero vehicle-vehicle overlaps in traffic', C.nHits ? `${C.nHits}: ${C.hits.slice(0, 8).join(' | ')}` : '');

// ---- 2. an Uber ride -------------------------------------------------------------------------------------------------------------
await pg.evaluate(async () => (await import('/src/world/hangkit.js')).hangkit.closeDialog());   // someone at the corner may have started talking to you
await pg.keyboard.press('Escape'); await pg.evaluate(() => { window.__game.setState('playing'); window.__game.teleport(-186, 0, -302, 0, 0); }); await sleep(1000);
await pg.evaluate(() => { const C = window.__col; C.hits = []; C.nHits = 0; C.uberHits = 0; C.uberSamples = 0; });
const why = await pg.evaluate(() => { const p = window.__ctx.player, m = p.mounted ? JSON.stringify(p.mounted).slice(0, 80) : null; return { dead: p.dead, mounted: m, veh: !!window.__ctx.vehicles?.mounted, cash: window.__game.uber.state().cash }; });
if (why.cash < 5) await pg.evaluate(() => window.__game.uber.cash(20));
ok(await pg.evaluate(() => window.__game.uber.request('table')), 'Uber booked', JSON.stringify(why));
await pg.waitForFunction(() => window.__game.uber.state().cur?.phase === 'waiting', null, { timeout: 120000 }).catch(() => {});
let u = await pg.evaluate(() => window.__game.uber.state()); ok(u.cur?.phase === 'waiting', 'the Uber arrives (real time)', u.cur?.phase);
if (u.cur) await pg.evaluate(() => { const k = window.__game.uber.kerb(), c = Math.cos(k[2]), s = Math.sin(k[2]); window.__game.teleport(k[0] + c * 2.4, 0, k[1] - s * 2.4, k[2] + Math.PI / 2, 0); });
await sleep(500); await pg.keyboard.press('KeyF'); await sleep(500);
u = await pg.evaluate(() => window.__game.uber.state()); ok(u.seat >= 0, 'in the Uber');
const t0 = Date.now(); let last = null;
while (Date.now() - t0 < RIDE_MAX_S * 1000) { await sleep(2000); last = await pg.evaluate(() => window.__game.uber.state()); if (process.env.V) console.log(JSON.stringify([last.cur?.phase, last.cur?.car, last.cur?.hold, last.cur?.by])); if (!last.cur || last.cur.phase === 'arrived' || last.seat < 0) break; }
if (process.env.V) console.log(await pg.evaluate(() => { const u = window.__game.uber.state().cur; if (!u) return ''; return window.__game.traffic.cars().filter((c) => Math.hypot(c.x - u.car[0], c.z - u.car[1]) < 30).map((c) => JSON.stringify(c)).join('\n'); }));
C = await pg.evaluate(() => window.__col);
console.log(`uber: ${C.uberSamples} samples with the Uber near, ride ${((Date.now() - t0) / 1000).toFixed(0)} s, end ${last?.cur?.phase ?? 'dropped off'}`);
ok(!last?.cur || last.cur.phase === 'arrived' || last.seat < 0, 'the ride gets there', last?.cur?.phase);
ok(C.uberSamples > 100, 'the Uber sampled through the ride', C.uberSamples);
ok(!C.uberHits, 'zero overlaps with the Uber', C.uberHits ? C.hits.slice(0, 8).join(' | ') : '');
ok(!C.nHits, 'zero vehicle-vehicle overlaps during the ride', C.nHits ? C.hits.slice(0, 8).join(' | ') : '');
await b.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);

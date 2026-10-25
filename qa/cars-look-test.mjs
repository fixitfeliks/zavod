#!/usr/bin/env node
// Car look QA: per kind (sedan, suv, cab, ... and the bus) screenshots from 8 outside angles plus the driver's seat, an automated
// see-through check (the car alone on magenta from 8 azimuths x 3 heights, parked / traffic / driven builds, plus 6 driver's-seat
// directions; any magenta inside the car's silhouette is background showing through it), and the game's heap + draw calls on
// desktop and on the phone path (?touch=1). Usage: node qa/cars-look-test.mjs [--no-heap] [--kinds sedan,suv] [--out qa/shots/cars]
// Serve first: python3 qa/serve.py 8844 (PORT=8844).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PORT = process.env.PORT || 8844, BASE = `http://localhost:${PORT}`, OUT = arg('--out', 'qa/shots/cars'), HEAP = !process.argv.includes('--no-heap');
const LEAK_MAX = 12;   // clustered magenta pixels allowed per view (a 640x400 render): sub-pixel slivers along seams
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--disable-gpu-vsync', '--mute-audio', '--hide-scrollbars'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const fails = []; const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
  await page.goto(`${BASE}/qa/cars-view.html`, { waitUntil: 'load' }); await page.waitForFunction('window.__ready', null, { timeout: 30000 });
  const want = arg('--kinds', null), kinds = want ? want.split(',') : await page.evaluate(() => window.__cars.kinds);
  const AZ = [...Array(8)].map((_, i) => i * Math.PI / 4), EL = [0.02, 0.25, 0.7];
  for (const kind of kinds) {
    const modes = kind === 'bus' ? ['driven'] : kind.endsWith('@model') ? ['parked'] : ['parked', 'traffic', 'driven'];   // street models: never driven
    for (const mode of modes) {
      const info = await page.evaluate(([k, m]) => window.__cars.setup(k, m), [kind, mode]);
      let worst = { clustered: 0 };
      for (const az of AZ) for (const el of EL) { const L = await page.evaluate(([a, e]) => window.__cars.leak(a, e), [az, el]); if (L.clustered > worst.clustered) worst = { ...L, az: +az.toFixed(2), el }; }
      if (mode === 'driven') for (const az of [0, 0.6, -0.6, 1.4, -1.4, Math.PI]) for (const el of [0, 0.35]) { const L = await page.evaluate(([a, e]) => window.__cars.leak(a, e, true), [az, el]); if (L.clustered > worst.clustered) worst = { ...L, az: +az.toFixed(2), el, inside: true }; }
      if (worst.clustered > LEAK_MAX) { await page.evaluate((w) => { window.__diff = true; window.__cars.leak(w.az, w.el, !!w.inside); window.__diff = false; }, worst); await page.screenshot({ path: `${OUT}/leak-${kind}-${mode}.png` }); await page.evaluate(() => document.querySelector('#diff')?.remove()); }   // green: the leaking pixels
      check(worst.clustered <= LEAK_MAX, `${kind}/${mode} see-through: worst ${worst.clustered} px ${JSON.stringify(worst)} (tris ${info.tris}, meshes ${info.draws})`);
      if (mode === 'parked' || kind === 'bus') {
        for (let i = 0; i < 8; i++) { await page.evaluate((a) => window.__cars.pretty(a, 0.22), AZ[i]); await page.screenshot({ path: `${OUT}/${kind}-${i}.png` }); }
      }
      if (mode === 'driven') { await page.evaluate(() => window.__cars.pretty(0, -0.05, true)); await page.screenshot({ path: `${OUT}/${kind}-inside.png` }); }
    }
  }
  check(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await page.close();
  if (HEAP) for (const [name, q] of [['desktop', ''], ['lite', '&touch=1']]) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await p.goto(`${BASE}/?qa=1&map=coney&ai=0${q}`, { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction('window.__game && window.__game.ready === true', null, { timeout: 120000 }); await p.waitForTimeout(4000);
    const st = await p.evaluate(() => { const s = window.__game.stats(); return { heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, drawCalls: s.drawCalls, triangles: s.triangles, fps: s.fps }; });
    console.log(`HEAP ${name} ${JSON.stringify(st)}`);
    await p.close();
  }
} catch (e) { console.error(e); fails.push(String(e)); }
finally { await browser.close(); }
console.log(fails.length ? `\n${fails.length} FAIL` : '\nALL PASS'); process.exit(fails.length ? 1 : 0);

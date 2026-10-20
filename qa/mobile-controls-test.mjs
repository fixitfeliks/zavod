// Mobile touch controls, in context: node qa/mobile-controls-test.mjs [outdir] (PORT env, default 8790)
// Visits every on-foot / vehicle / ride / hangout context on the phone UI (?touch=1), in portrait (390x844) and landscape
// (844x390, iPhone-class: isMobile, hasTouch, dpr 3), and for each one checks: the right touch buttons are shown (and only
// those - stowed/irrelevant ones should not sit around active), nothing overlaps the minimap / HUD cash / Uber phone card /
// bag strip / the other touch buttons, primary actions land in a bottom-corner thumb zone, and buttons from the previous
// context are gone. Screenshots every context. Exit code 1 on any failure.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '/tmp/mobile-controls';
const PORT = process.env.PORT || 8790, BASE = `http://localhost:${PORT}/?qa=1&map=coney&mode=chill&ai=0&time=day&touch=1`;
mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=metal', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const issues = [];
const fail = (ctxName, orient, what, detail = '') => { issues.push({ ctxName, orient, what, detail }); console.log(`FAIL [${ctxName}/${orient}] ${what} ${detail}`); fails++; };
const pass = (ctxName, orient, what) => console.log(`PASS [${ctxName}/${orient}] ${what}`);

const ORIENTS = [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
];

// ---- in-page measurement: every touch button + HUD panel that could occupy space, visible or not -------------------------
const MEASURE = () => {
  const vw = innerWidth, vh = innerHeight;
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), x2: +(r.x + r.width).toFixed(1), y2: +(r.y + r.height).toFixed(1) }; };
  const grab = (list, sel, group) => { for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1 || r.height < 1) continue;
    const opacity = +cs.opacity, pe = cs.pointerEvents !== 'none';
    list.push({ group, cls: el.className, label: (el.textContent || '').trim().slice(0, 24), rect: rectOf(el), active: opacity > 0.5 && pe, opacity, pe });
  } };
  const btns = [];
  grab(btns, '#touch .btn:not(.act)', 'touch');
  grab(btns, '#touch .act', 'act');
  grab(btns, '#vehui .vb', 'vehui');
  grab(btns, '.inv-btn', 'bag');
  grab(btns, '.inv-strip button', 'strip');
  const panels = [];
  grab(panels, '.zvmini', 'minimap');
  grab(panels, '.hgcash', 'cash');
  grab(panels, '.hguse', 'use');
  grab(panels, '.uber-app', 'uber');
  grab(panels, '.inv-strip', 'stripPanel');
  grab(panels, '#trainHud', 'trainHud');
  grab(panels, '#yardBtn', 'yardBtn');
  grab(panels, '#hud .prompt', 'hudPrompt');
  return { vw, vh, btns: btns.filter((b) => b.group !== 'strip' || true), panels };
};

// ---- overlap / reachability checks -----------------------------------------------------------------------------------------
const TOL = 3;   // px tolerance for "touching but not really overlapping" edges
const overlaps = (a, b) => a.x < b.x2 - TOL && a.x2 > b.x + TOL && a.y < b.y2 - TOL && a.y2 > b.y + TOL;
const inThumbZone = (r, vw, vh) => r.y2 >= vh - 260 && (r.x <= 170 || r.x2 >= vw - 170);

function checkContext(m, ctxName, orient, { expectActive = null, expectAbsent = [], primary = [] } = {}) {
  const { vw, vh, btns, panels } = m;
  // 1) overlaps: every pair of visible touch buttons / HUD panels
  const all = [...btns.map((x) => ({ ...x, kind: 'btn' })), ...panels.map((x) => ({ ...x, kind: 'panel' }))];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const A = all[i], B = all[j];
    if (A.group === B.group) continue;   // buttons in the same cluster (e.g. the strip's own buttons) can legitimately sit together
    if ((A.group === 'strip' && B.group === 'stripPanel') || (A.group === 'stripPanel' && B.group === 'strip')) continue;   // the strip's buttons live inside its own panel
    if (overlaps(A.rect, B.rect)) fail(ctxName, orient, 'overlap', `${A.group}:${A.label || A.cls} <-> ${B.group}:${B.label || B.cls} ${JSON.stringify(A.rect)} vs ${JSON.stringify(B.rect)}`);
  }
  // 2) the active button set is exactly what this context expects (labels, case-insensitive substring match)
  if (expectActive) {
    const activeLabels = btns.filter((x) => x.active).map((x) => (x.label || x.cls).toUpperCase());
    for (const want of expectActive) if (!activeLabels.some((l) => l.includes(want))) fail(ctxName, orient, 'missing active button', want);
  }
  for (const bad of expectAbsent) { const hit = btns.find((x) => x.active && (x.label || x.cls).toUpperCase().includes(bad)); if (hit) fail(ctxName, orient, 'button active that should not be', `${bad} (${JSON.stringify(hit.rect)})`); }
  // 3) primary actions in the bottom-corner thumb zone
  for (const want of primary) {
    const hit = btns.find((x) => x.active && (x.label || x.cls).toUpperCase().includes(want));
    if (!hit) continue;   // already reported as missing above
    if (!inThumbZone(hit.rect, vw, vh)) fail(ctxName, orient, 'primary action not thumb-reachable', `${want} ${JSON.stringify(hit.rect)} viewport ${vw}x${vh}`);
  }
  if (!issues.some((q) => q.ctxName === ctxName && q.orient === orient)) pass(ctxName, orient, 'no overlaps, expected buttons, reachable');
}

async function shot(pg, name) { await pg.screenshot({ path: `${out}/${name}.png` }); }

// ---- per-context setup ------------------------------------------------------------------------------------------------------
const SPAWN = [-186, 0, -302];

async function gotoFresh(pg) {
  await pg.evaluate(() => window.__game.setState('playing'));
  // clean slate: on foot, no vehicle, no uber, not aboard, bag closed, fists out
  await pg.evaluate(([x, y, z]) => {
    const ctx = window.__ctx;
    try { ctx.vehicles?.dismount?.(); } catch {}
    try { if (window.__game.uber?.state?.().mounted) window.__game.uber.out(); } catch {}
    try { if (window.__game.uber?.state?.().open) window.__game.uber.open(); } catch {}   // close the phone app, mini or full
    try { if (window.__game.ferry?.state?.().aboard) window.__game.ferry.leave(); } catch {}
    ctx.player.mounted = null;
    try { window.__game.inventory?.close?.(); } catch {}
    try { ctx.weapons?.fists?.(); } catch {}
    window.__game.teleport(x, y, z, 0, 0);
  }, SPAWN);
  await sleep(300);
}

const CONTEXTS = [
  {
    name: 'foot-idle',
    setup: async (pg) => { await gotoFresh(pg); },
    expectActive: ['JUMP', 'CROUCH', 'SWAP'],
    expectAbsent: ['RELOAD', 'ADS', 'NADE', 'ZOOM', 'WIN', 'ENTER', 'EXIT', 'GET OFF'],
    primary: ['JUMP'],
  },
  {
    name: 'foot-fighting',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { const W = window.__ctx.weapons; W.collect('ak74', 90); W.selectBag(W.bag.length - 1); }); await sleep(300); },
    expectActive: ['JUMP', 'CROUCH', 'SWAP', 'RELOAD', 'ADS'],
    expectAbsent: ['WIN', 'ENTER', 'EXIT', 'GET OFF'],
    primary: ['JUMP'],
  },
  {
    name: 'drive-car',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { const W = window.__ctx.weapons; W.collect('ak74', 90); W.selectBag(W.bag.length - 1);
      const V = window.__ctx.vehicles; V.mount(V.spawnCar(-186 + 60, -302, 0, 'sedan', 0x2b3f73, 0)); }); await sleep(500); },
    expectActive: ['WIN'],
    expectAbsent: [],
    primary: ['EXIT'],
  },
  {
    name: 'motorcycle',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { const V = window.__ctx.vehicles; V.mount(V.qaSpawn(-186 + 120, -302, 0)); }); await sleep(500); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN', 'CROUCH', 'SWAP'],
    primary: ['JUMP'],
  },
  {
    name: 'ebike',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { const V = window.__ctx.vehicles; V.mount(V.qaSpawnEbike(-186 + 180, -302, 0, 'citibike')); }); await sleep(500); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: ['JUMP'],
  },
  {
    name: 'kick-scooter',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { const V = window.__ctx.vehicles; V.mount(V.qaSpawnScooter(-186 + 240, -302, 0, 'kick')); }); await sleep(500); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: ['JUMP'],
  },
  {
    name: 'moped',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { const V = window.__ctx.vehicles; V.mount(V.qaSpawnScooter(-186 + 300, -302, 0, 'moped')); }); await sleep(500); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: ['JUMP'],
  },
  {
    name: 'uber-passenger',
    setup: async (pg) => { await gotoFresh(pg);
      await pg.evaluate(() => { window.__game.uber.cash(60); window.__game.uber.request('soctav'); });
      const kerb = await pg.evaluate(() => window.__game.uber.kerb());
      if (kerb) { await pg.evaluate((k) => { const c = Math.cos(k[2]), s = Math.sin(k[2]); window.__game.teleport(k[0] + c * 2.4, 0, k[1] - s * 2.4, k[2] + Math.PI / 2, 0); }, kerb); }
      try { await pg.waitForFunction(() => { const st = window.__game.uber.state(); return st.cur && (st.cur.phase === 'waiting' || st.cur.phase === 'coming'); }, null, { timeout: 15000 }); } catch {}
      await pg.evaluate(() => { const st = window.__game.uber.state(); if (st.cur) window.__game.uber.ff(Math.max(0, st.cur.approachT - 0.3)); });
      try { await pg.waitForFunction(() => window.__game.uber.state().cur?.phase === 'waiting', null, { timeout: 15000 }); } catch {}
      await pg.evaluate(() => window.__game.uber.board());
      await sleep(500);
    },
    expectActive: ['WIN', 'JUMP'],
    expectAbsent: ['ENTER', 'EXIT'],
    primary: ['GET OUT'],
  },
  {
    name: 'friend-car-passenger',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { window.__ctx.player.mounted = { passenger: true, speed: 0 }; }); await sleep(300); },
    expectActive: ['WIN', 'JUMP'],
    expectAbsent: ['ENTER', 'EXIT'],
    primary: [],
  },
  {
    name: 'uber-phone-picker',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => window.__game.uber.open()); await sleep(300); },
    expectActive: [],
    expectAbsent: ['WIN'],
    primary: [],
  },
  {
    name: 'ferry-board-prompt',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { window.__game.ferry.skew(0); const s = window.__game.ferry.spot; window.__game.teleport(s[0], s[1], s[2] + 2, Math.PI, 0); }); await sleep(600); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: [],
  },
  {
    name: 'ferry-deck',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { window.__game.ferry.skew(0); window.__game.ferry.board(); }); await sleep(500); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: [],
  },
  {
    name: 'elevator',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => { window.__ctx.player.mounted = { elevator: true, speed: 0 }; }); await sleep(300); },
    expectActive: [],
    expectAbsent: ['WIN', 'RELOAD', 'ADS', 'NADE'],
    primary: [],
  },
  {
    name: 'stairs',
    setup: async (pg) => { await gotoFresh(pg); try { const sb = await pg.evaluate(() => window.__game.hangout?.stairB?.()); if (sb) await pg.evaluate((t) => window.__game.teleport(t[0], t[1] + 0.05, t[2], 0, 0), sb.bottom); } catch {} await sleep(300); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: ['JUMP'],
  },
  {
    name: 'shop',
    setup: async (pg) => { await gotoFresh(pg); try { const s = await pg.evaluate(() => window.__game.shops?.list?.()[0]); if (s) await pg.evaluate((s) => window.__game.teleport(s.door[0], 0, s.door[2], 0, 0), s); } catch {} await sleep(500); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: ['JUMP'],
  },
  {
    name: 'tavern',
    setup: async (pg) => { await gotoFresh(pg); try { await pg.evaluate(() => window.__game.tavern?.arrive?.('D')); } catch {} await sleep(800);
      try { const d = await pg.evaluate(() => window.__game.tavern?.door); if (d) await pg.evaluate((d) => window.__game.teleport(d[0], d[1], d[2] - 2, Math.PI, 0), d); } catch {} await sleep(400); },
    expectActive: ['JUMP'],
    expectAbsent: ['WIN'],
    primary: ['JUMP'],
  },
  {
    name: 'bag-open',
    setup: async (pg) => { await gotoFresh(pg); await pg.evaluate(() => window.__game.inventory.open()); await sleep(300); },
    expectActive: [],
    expectAbsent: [],
    primary: [],
  },
];

for (const [orient, viewport] of ORIENTS) {
  const ctx = await b.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log('PAGEERROR', orient, e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
  await pg.goto(BASE, { timeout: 180000 });
  await pg.waitForFunction(() => window.__game?.ready && window.__game.uber && window.__game.ferry, null, { timeout: 180000 });
  for (const c of CONTEXTS) {
    try {
      await c.setup(pg);
      const m = await pg.evaluate(MEASURE);
      checkContext(m, c.name, orient, c);
      await shot(pg, `${orient}-${c.name}`);
    } catch (e) {
      fail(c.name, orient, 'setup threw', e.message.slice(0, 200));
    }
  }
  // context-4 check: after the LAST context (bag-open) is torn down, nothing from it lingers into a clean foot-idle
  try {
    await pg.evaluate(() => { try { window.__game.inventory.close(); } catch {} });
    await gotoFresh(pg);
    const m = await pg.evaluate(MEASURE);
    const stray = m.btns.find((x) => x.active && /WIN|ENTER|EXIT/.test((x.label || '').toUpperCase()));
    if (stray) fail('cleanup', orient, 'button from a previous context lingers on a clean foot-idle', JSON.stringify(stray));
    else pass('cleanup', orient, 'no stray buttons after returning to foot-idle');
  } catch (e) { fail('cleanup', orient, 'cleanup check threw', e.message.slice(0, 200)); }
  await ctx.close();
}

await b.close();
writeFileSync(`${out}/mobile-controls.json`, JSON.stringify(issues, null, 2));
console.log(fails ? `\n${fails} FAILED (see ${out}/mobile-controls.json)` : '\nALL PASS');
process.exit(fails ? 1 : 0);

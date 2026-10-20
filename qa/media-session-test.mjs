// Media Session (lock screen / Control Center play-pause-next) for Luna Park Radio: metadata is published while it
// plays, an OS pause sticks (the frame updater must not fight it for a full 10s), and nexttrack actually skips.
// Chrome lets the page's own setActionHandler callbacks be captured (wrapped via an addInitScript before the game
// boots), so we can call them the way iOS Control Center would. node qa/media-session-test.mjs [outdir]
import { chromium, webkit } from 'playwright-core';
const out = process.argv[2] || '/tmp';
let fails = 0; const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails++; };
const errs = [];

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => errs.push('chrome: ' + e.message));
await p.addInitScript(() => {
  try { localStorage.setItem('zavod.helpSeen', '1'); } catch {}
  // capture every setActionHandler callback the game registers, keyed by action name, before any game script runs
  window.__msHandlers = {};
  if ('mediaSession' in navigator) {
    const orig = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, fn) => { window.__msHandlers[action] = fn; return orig(action, fn); };
  }
});
await p.goto(`http://localhost:${process.env.PORT || 8882}/?qa=1&map=coney&ai=0&time=day`, { timeout: 150000 });
await p.waitForFunction(() => window.__game?.ready, null, { timeout: 150000 });
await p.evaluate(() => { window.__game.setState('playing'); window.__ctx.settings.radio = 'always'; });

const radioQa = () => p.evaluate(() => ({ now: window.__ctx.world.radio?.now, osPaused: window.__ctx.world.radio?.osPaused, els: window.__ctx.world.radio?.qa?.() || [] }));
const playing = (r) => r.els.some((t) => t.playing);

// 1. radio starts and publishes Media Session metadata while it plays
let r; for (let i = 0; i < 40; i++) { r = await radioQa(); if (playing(r)) break; await p.waitForTimeout(250); }
ok(playing(r), 'Luna Park Radio starts playing', JSON.stringify(r));
const meta = await p.evaluate(() => { const m = navigator.mediaSession?.metadata; return m ? { title: m.title, artist: m.artist, album: m.album, artwork: m.artwork?.length } : null; });
ok(!!meta?.title && meta.album === 'Luna Park Radio' && meta.artwork >= 2, 'navigator.mediaSession.metadata set while playing (title/album/artwork)', JSON.stringify(meta));
const stateOk = await p.evaluate(() => navigator.mediaSession?.playbackState === 'playing');
ok(stateOk, 'navigator.mediaSession.playbackState is "playing"');

// 2. OS pause (the 'pause' action handler) sticks for 10s — the game must not auto-resume it
const hasPauseHandler = await p.evaluate(() => typeof window.__msHandlers.pause === 'function');
ok(hasPauseHandler, 'page registered a mediaSession "pause" action handler');
await p.evaluate(() => window.__msHandlers.pause());
r = await radioQa();
ok(r.osPaused === true, 'radio.osPaused flips true right after the OS pause handler fires');
let stayedPaused = true;
for (let i = 0; i < 10; i++) { await p.waitForTimeout(1000); r = await radioQa(); if (playing(r)) { stayedPaused = false; break; } }
ok(stayedPaused, 'radio stays paused for 10s after an OS pause (no auto-resume)', JSON.stringify(r));

// resume via the OS 'play' handler before testing next-track, so the skip is on an actually-playing station
await p.evaluate(() => window.__msHandlers.play());
let resumed = null; for (let i = 0; i < 20; i++) { r = await radioQa(); if (playing(r)) { resumed = r; break; } await p.waitForTimeout(250); }
ok(!!resumed && !resumed.osPaused, 'the OS "play" handler resumes it', JSON.stringify(resumed));

// 3. nexttrack skips, like the in-game "." key
const hasNextHandler = await p.evaluate(() => typeof window.__msHandlers.nexttrack === 'function');
ok(hasNextHandler, 'page registered a mediaSession "nexttrack" action handler');
const before = resumed.now;
await p.evaluate(() => window.__msHandlers.nexttrack());
let after = null; for (let i = 0; i < 20; i++) { await p.waitForTimeout(250); r = await radioQa(); if (playing(r) && r.now && r.now !== before) { after = r; break; } }
ok(!!after, 'mediaSession "nexttrack" changes the current track', `before=${before} after=${after?.now}`);

await b.close();

// webkit sanity pass (iOS Safari's engine): just confirm the page loads clean, no mediaSession behavior assertions —
// Safari ships Media Session support on-device, but desktop webkit's implementation is too partial to drive from script.
try {
  const wb = await webkit.launch({ headless: true });
  const wp = await wb.newPage({ viewport: { width: 960, height: 540 } });
  const werrs = []; wp.on('pageerror', (e) => werrs.push('webkit: ' + e.message));
  await wp.addInitScript(() => { try { localStorage.setItem('zavod.helpSeen', '1'); } catch {} });
  await wp.goto(`http://localhost:${process.env.PORT || 8882}/?qa=1&map=coney&ai=0&time=day`, { timeout: 150000 });
  await wp.waitForFunction(() => window.__game?.ready, null, { timeout: 150000 }).catch(() => {});
  await wp.waitForTimeout(1000);
  ok(werrs.length === 0, 'webkit: no page errors loading the game (mediaSession feature-detected, not required)', JSON.stringify(werrs));
  await wb.close();
} catch (e) { console.log('SKIP webkit pass: ' + e.message); }

ok(errs.length === 0, 'chrome: no page errors', JSON.stringify(errs));
process.exit(fails ? 1 : 0);

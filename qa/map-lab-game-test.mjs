// Released Map Lab map: boot, streamed geometry, shared spawn, Ferrari, jetpack and flight, baked minimap.
// Streams the local release (tools/maplab-release.mjs) by default; TILES=remote tests the hosted copy (maplab.js TILE_HOST).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { chromeOptions } from './browser-launch.mjs';

const tiles = process.env.TILES === 'remote' ? '' : '&tiles=local';
const BEACH = [-119, 14820], SEA = [-119, 15060];   // released map coordinates: West 12th Street's beach and the sea off it

const browser = await chromium.launch(chromeOptions({ headless: false, args: ['--mute-audio'] }));
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(`http://${process.env.HOST || 'localhost'}:${process.env.PORT || 8790}/?map=maplab&qa=1&ai=0${tiles}`, { timeout: 120000 });
  console.log('Map page loaded; waiting for game boot');
  await page.waitForFunction(() => window.__game?.ready && window.__ctx?.world?.mapId === 'maplab', null, { timeout: 120000 });
  console.log('Game booted; waiting for Ferrari');
  await page.waitForFunction(() => window.__ctx?.vehicles?.list?.some((v) => v.spec?.car), null, { timeout: 30000 });
  const state = await page.evaluate(() => ({ map: window.__ctx.world.mapId, spawn: window.__ctx.world.playerSpawns[0]?.toArray(), start: window.__ctx.world.onlineStart, cars: window.__ctx.vehicles.list.filter((v) => v.spec?.car).length, parked: window.__ctx.world.parkedCars?.map((c) => ({ kind: c.kind, x: c.x, z: c.z })), jet: window.__game.jetpack?.state(), tiles: window.__ctx.mapLabStream.loaded.size, boot: window.__ctx.bootErrors || [] }));
  if (!state.spawn || state.cars !== 1 || state.parked?.map((c) => c.kind).join(',') !== 'coupe,coupe,coupe,coupe' || !state.jet || state.tiles < 2 || state.boot.length || errors.length) throw Error(JSON.stringify({ state, errors }));
  if (Math.hypot(state.spawn[0] + 119, state.spawn[2] - 14055) > 30 || state.start.slice(0, 3).some((v, i) => v !== state.spawn[i])) throw Error(`West 12th Street shared spawn mismatch: ${JSON.stringify(state)}`);
  if (state.parked.some((c) => Math.hypot(c.x - state.spawn[0], c.z - state.spawn[2]) > 45)) throw Error(`Car outside West 12th Street spawn area: ${JSON.stringify(state.parked)}`);
  await page.evaluate(() => { window.__game.setState('playing'); window.__game.jetpack.wear(); });
  const y0 = await page.evaluate(() => window.__ctx.player.position.y);
  await page.evaluate(() => window.__ctx.input.keys.add('Space')); await page.waitForTimeout(2200);
  await page.evaluate(() => window.__ctx.input.keys.delete('Space'));
  const y1 = await page.evaluate(() => window.__ctx.player.position.y);
  if (y1 <= y0 + 2) throw Error(`Jetpack did not lift: ${y0} -> ${y1}`);
  const start = await page.evaluate(() => { window.__game.jetpack.off(); const v = window.__ctx.vehicles, car = v.list.find((b) => b.spec?.car);
    if (!v.mount(car)) throw Error('Could not mount Ferrari'); return car.pos.toArray(); });
  await page.evaluate(() => window.__ctx.vehicles.qaDrive(0.6, 0, 2));
  const end = await page.evaluate(() => window.__ctx.vehicles.mounted.pos.toArray());
  const distance = Math.hypot(end[0] - start[0], end[2] - start[2]);
  if (distance <= 2) throw Error(`Ferrari did not drive: ${JSON.stringify({ start, end })}`);
  await page.waitForFunction(() => { const s = window.__ctx.mapLabStream; return [...s.loaded.values()].some((t) => t.kind === 'visual' && t.level === 4 && t.active) && [...s.loaded.values()].some((t) => t.kind === 'collision' && t.level === 4 && t.active); }, null, { timeout: 60000 });
  await page.evaluate(() => window.__ctx.minimap.snapshot());
  const detailTiles = await page.evaluate(() => [...window.__ctx.mapLabStream.loaded.values()].filter((t) => t.level === 4 && t.active).length);
  const plan = await page.evaluate(() => window.__ctx.minimap.qa());
  if (!plan.img || !plan.w || !plan.h) throw Error(`Baked minimap did not load: ${JSON.stringify(plan)}`);
  // water: the beach south of the start streams in, then deep water sends you (and a car driven in) back ashore
  await page.evaluate(([x, z]) => { window.__ctx.vehicles.dismount(); window.__ctx.player.teleport(x, 10, z, 0, 0); }, BEACH);
  await page.waitForFunction(([b, s]) => { const mc = window.__ctx.meshCollision; return mc.waterAt(s[0], s[1]) !== null && Number.isFinite(mc.groundAt(s[0], s[1])) && Number.isFinite(mc.groundAt(b[0], b[1])); }, [BEACH, SEA], { timeout: 90000 });
  // player.teleport floats you if it leaves you in the air: land on the ground, then a water tick records the dry spot
  await page.evaluate(([x, z]) => window.__ctx.player.teleport(x, window.__ctx.meshCollision.groundAt(x, z), z, 0, 0), BEACH); await page.waitForTimeout(800);
  const beach = await page.evaluate(() => window.__ctx.player.position.toArray());
  const sea = await page.evaluate(([x, z]) => { const mc = window.__ctx.meshCollision; return { water: mc.waterAt(x, z), bed: mc.groundAt(x, z) }; }, SEA);
  if (sea.water === null || sea.water - sea.bed <= 1.2) throw Error(`No deep water at the test point: ${JSON.stringify(sea)}`);
  await page.evaluate(([x, z, bed]) => window.__ctx.player.teleport(x, bed, z, 0, 0), [...SEA, sea.bed]); await page.waitForTimeout(1500);
  const swam = await page.evaluate(() => window.__ctx.player.position.toArray());
  if (Math.hypot(swam[0] - beach[0], swam[2] - beach[2]) > 5) throw Error(`Did not swim ashore: beach ${beach} → ${swam}`);
  await page.evaluate((swam) => { const v = window.__ctx.vehicles, car = v.spawnCar(swam[0] + 4, swam[2], 0, 'coupe', 0x1f4fb8, swam[1], true);
    if (!v.mount(car)) throw Error('Could not mount the beach car'); window.__seaCar = car; }, swam); await page.waitForTimeout(1000);
  await page.evaluate(([x, z, bed]) => window.__seaCar.pos.set(x, bed, z), [...SEA, sea.bed]); await page.waitForTimeout(2500);
  const sunk = await page.evaluate(() => ({ mounted: !!window.__ctx.vehicles.mounted, car: window.__seaCar.pos.toArray(), me: window.__ctx.player.position.toArray() }));
  if (sunk.mounted || sunk.car[1] > sea.water - 1.2 || Math.hypot(sunk.me[0] - beach[0], sunk.me[2] - beach[2]) > 12) throw Error(`Car did not sink / you did not swim ashore: ${JSON.stringify(sunk)}`);
  if (errors.length) throw Error(JSON.stringify(errors));
  fs.mkdirSync('qa/shots', { recursive: true }); await page.screenshot({ path: 'qa/shots/maplab.png' });
  console.log(JSON.stringify({ ok: true, state, jetpackRise: y1 - y0, driveDistance: distance, detailTiles, plan, sea, sunk }));
} finally { await browser.close(); }

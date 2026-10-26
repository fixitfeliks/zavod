// Builds the Map Lab release that src/world/maps/maplab.js streams, from a Map Lab export in assets/maps/map-lab/ (city/<hash>/,
// outputs/<hash>/), and bakes its minimap. Neither the export nor the release goes in git or to Vercel (~400 MB, over Vercel's
// 100 MB Hobby upload cap); the release is hosted for free on Cloudflare Pages (maplab.js TILE_HOST, tiles fetched cross-origin).
//   ./qa/serve.sh
//   npm run release:maplab -- <city hash> <output hash>       (headed Chrome under Xvfb: qa/browser-launch.mjs)
//   npx wrangler pages deploy assets/maps/map-lab/release --project-name zavod-maps
// Ships only the levels the game streams (visual VISUAL_LEVEL, collision COLLISION_LEVEL, and the leaf level of both), each file
// checked against the export manifest's sha256. A Pages deploy replaces the whole site: keep the previous output's folder in
// release/ until the game on main points at the new OUTPUT.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { chromeOptions } from '../qa/browser-launch.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), ROOT = path.join(REPO, 'assets/maps/map-lab'), RELEASE = path.join(ROOT, 'release');
const GAME = `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 8790}/`;
const VISUAL_LEVEL = 3, COLLISION_LEVEL = 2, BOOT_TIMEOUT_MS = 120000, PLAN_TIMEOUT_MS = 90000;
// tiles and the plan are named by content (output hash, plan sha), so they never change once served; release.json revalidates
const HEADERS = `/*
  Access-Control-Allow-Origin: *
/:output/cells/*
  Cache-Control: public, max-age=31536000, immutable
/:output/plan/*
  Cache-Control: public, max-age=31536000, immutable
`;

const [city, output] = process.argv.slice(2);
if (!/^[0-9a-f]{64}$/.test(city || '') || !/^[0-9a-f]{64}$/.test(output || '')) throw Error('usage: node tools/maplab-release.mjs <city hash> <output hash>');
const src = path.join(ROOT, 'outputs', output), out = path.join(RELEASE, output);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const manifest = readJson(path.join(src, 'manifest.json')), grid = readJson(path.join(ROOT, 'city', city, 'collision-index.json'));
const leaf = grid.levels - 1, ship = { tiles: [VISUAL_LEVEL, leaf], collision: [COLLISION_LEVEL, leaf] };

// every tile of every cell at the shipped levels must be in the manifest: the game streams a full grid
const byPath = new Map(manifest.files.map((f) => [f.path, f])), files = [];
for (const { cell: [i, j] } of grid.cells) for (const [kind, levels] of Object.entries(ship)) for (const level of levels) {
  const n = 2 ** level; for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    const p = `cells/${i}_${j}/${kind}/${level}/${x}/${y}.glb`, f = byPath.get(p); if (!f) throw Error(`export is missing ${p}`); files.push(f);
  }
}
fs.rmSync(out, { recursive: true, force: true });
let bytes = 0;
for (const f of files) {
  const data = fs.readFileSync(path.join(src, f.path)), sha = crypto.createHash('sha256').update(data).digest('hex');
  if (data.length !== f.bytes || sha !== f.sha256) throw Error(`${f.path} does not match the manifest`);
  fs.mkdirSync(path.dirname(path.join(out, f.path)), { recursive: true }); fs.writeFileSync(path.join(out, f.path), data); bytes += data.length;
}
const release = { output, versions: manifest.versions, leafMeters: grid.leafMeters, levels: grid.levels, cells: grid.cells.map((c) => c.cell), visualLevel: VISUAL_LEVEL, collisionLevel: COLLISION_LEVEL };
const writeRelease = () => fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(release));
writeRelease(); fs.writeFileSync(path.join(RELEASE, '_headers'), HEADERS);
console.log(`copied ${files.length} tiles (${(bytes / 1e6).toFixed(0)} MB)`);

// the minimap: the game shoots the export's coarsest level (maplab.js planScene) and hands back the plan image and its frame
const browser = await chromium.launch(chromeOptions({ headless: false, args: ['--mute-audio'] }));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${GAME}?map=maplab&qa=1&ai=0&tiles=local&bake=1`, { timeout: BOOT_TIMEOUT_MS });
  await page.waitForFunction(() => window.__game?.ready && window.__ctx?.world?.mapId === 'maplab', null, { timeout: BOOT_TIMEOUT_MS });
  const plan = await page.evaluate(async (timeout) => {
    const { planScene } = await import('/src/world/maps/maplab.js'), ctx = window.__ctx;
    ctx.world.mapSnapshotScene = await planScene(ctx.mapLabStream);
    await Promise.race([ctx.minimap.snapshot(), new Promise((_, no) => setTimeout(() => no(Error('minimap snapshot timed out')), timeout))]);
    return ctx.minimap.plan();
  }, PLAN_TIMEOUT_MS);
  if (errors.length) throw Error(`game errors while baking: ${errors.join(' | ')}`);
  const WEBP = 'data:image/webp;base64,'; if (!plan.url.startsWith(WEBP)) throw Error(`plan is not webp: ${plan.url.slice(0, 30)}`);
  const webp = Buffer.from(plan.url.slice(WEBP.length), 'base64'), file = `plan/${crypto.createHash('sha256').update(webp).digest('hex').slice(0, 16)}.webp`;
  fs.mkdirSync(path.join(out, 'plan'), { recursive: true }); fs.writeFileSync(path.join(out, file), webp);
  release.minimap = { file, b: plan.b }; writeRelease();
  console.log(`baked minimap ${file} (${(webp.length / 1e3).toFixed(0)} KB) → ${path.relative(REPO, out)}`);
} finally { await browser.close(); }

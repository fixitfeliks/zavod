// Map Lab's released four-cell Coney map, streamed by distance. The authored Coney map is a separate option.
// The tiles (~400 MB) are not in git or on Vercel: tools/maplab-release.mjs builds a release (only the levels streamed here, a slim
// release.json and a baked minimap) that is hosted on Cloudflare Pages (TILE_HOST). ?tiles=local streams the same release from
// LOCAL_RELEASE on the dev server.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshCollision, ROLES } from '../meshcollide.js';
import { buildSky } from '../railyard/sky.js';
import { buildKit } from '../hangkit.js';
import { buildJetpacks } from '../coney/jetpack.js';
import { placeCars, parkedCarBoxes } from '../carkit.js';

export const meta = {
  id: 'maplab', name: 'MAP LAB CONEY', subtitle: 'SURVEY MAP · DRIVE AND FLY', time: 'day', weather: 'clear',
  description: 'Explore the released Coney Island survey map with a Ferrari and jetpack. Data: OpenStreetMap contributors and NYC agencies.',
  grade: 'day', ambience: 'coney', thumb: 'assets/thumbs/coney.jpg',
};

const TILE_HOST = 'https://zavod-maps.pages.dev/', LOCAL_RELEASE = 'assets/maps/map-lab/release/';
const EXPORT = 'assets/maps/map-lab/outputs/';   // the raw Map Lab export: only read when baking the minimap (planScene)
const OUTPUT = '533ce4a7fcfa640322773bb2a275de458a752a05cdb6c2a5c32d593589ad7a10';
const TILESET_FORMAT = 3, COLLISION_FORMAT = 2;   // the Map Lab format versions this loader reads
const VISUAL_RADIUS = 650, COLLISION_RADIUS = 600, KEEP_RADIUS = 1000;   // m from the player: stream in / drop
const DETAIL_RADIUS = 64, DETAIL_KEEP = 520;   // a tile this close swaps to its leaf children once all of them have loaded
const LOADS = 2, STREAM_TICK = 0.4, BOUNDS_Y = [-300, 700];
// water (the tiles' water-surface over its bed): wade or drive through shallow water; deeper than this over your feet / a car's
// floor and you swim ashore / the car sinks and you swim ashore, back to the last dry spot
const WADE = 1.2, CAR_WADE = 0.9, WATER_TICK = 0.1;   // parallel downloads; s between streaming passes; play volume heights
// West 12th Street, ~35 m south of Neptune Avenue (OSM 40.5791, -73.9796 in the release frame)
const START = [-119, 14055], START_TILES = 60, START_VISUAL = 100;   // m around the start loaded before the first frame
const SPAWN = { half: 30, picks: 100, step: 3, spread: 1 };   // spawn search square half-size and MeshCollision.spawns options
const PARKING = { half: 30, step: 6, gap: 7, rayTop: 100, flat: 0.95, rise: 1, room: 2.8 };   // car spaces: grid, spacing, flat ground at spawn height, body room
// Ferraris only: the one real model that renders right on every device and stays itself when a parked car goes live
// (vehicles.js makeCar). CARS[0] is the drivable one, the rest park round it.
const CARS = [0xb3121c, 0xe8b400, 0xf2f2f0, 0x111214, 0x1f4fb8].map((color) => ({ kind: 'coupe', color }));

const key = (t) => `${t.kind}:${t.level}:${t.i}_${t.j}:${t.x}:${t.y}`;
const tilePath = (t) => `${OUTPUT}/cells/${t.i}_${t.j}/${t.kind === 'visual' ? 'tiles' : 'collision'}/${t.level}/${t.x}/${t.y}.glb`;
const squareDist = (x, z, a, b, s) => Math.hypot(Math.max(a - x, 0, x - a - s), Math.max(b - z, 0, z - b - s));   // point to the s-sided square at (a, b)
const placeCell = (root, i, j, cell) => { root.position.set((i + 0.5) * cell, 0, (j + 0.5) * cell); return root; };
const styleVisual = (root) => root.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.material.dispose(); o.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); } });
const collides = (o) => o.isMesh && ROLES.includes(o.name);
const SURFACE = { blocking: 'wall', 'water-surface': 'water' };   // collision role → surface class (sounds); the rest is paved
const addCollision = (mc, o) => mc.add(o, o.name, SURFACE[o.name] || 'paved');

class TileStream {
  constructor(world, { release, base, loader }) {
    this.world = world; this.release = release; this.base = base; this.loader = loader;
    this.leaf = release.levels - 1; this.cell = release.leafMeters * 2 ** this.leaf;
    this.mc = new MeshCollision(world.ctx); this.loaded = new Map(); this.pending = new Set(); this.failed = new Set(); this.queue = []; this.active = 0; this.details = false;
    world.ctx.meshCollision = this.mc;
  }
  distance(px, pz, t) { const n = 2 ** t.level, side = this.cell / n; return squareDist(px, pz, t.i * this.cell + t.x * side, t.j * this.cell + (n - 1 - t.y) * side, side); }
  near(px, pz, kind, level, radius) {
    const n = 2 ** level, out = [];
    for (const [i, j] of this.release.cells) for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
      const t = { kind, level, i, j, x, y }; t.d = this.distance(px, pz, t); if (t.d <= radius) out.push(t);
    }
    return out.sort((a, b) => a.d - b.d);
  }
  children(t) {
    const factor = 2 ** (this.leaf - t.level), out = [];
    for (let a = 0; a < factor; a++) for (let b = 0; b < factor; b++) out.push({ kind: t.kind, level: this.leaf, i: t.i, j: t.j, x: t.x * factor + a, y: t.y * factor + b, d: t.d });
    return out;
  }
  keep(px, pz, t) { return this.distance(px, pz, t) <= (t.level === this.leaf ? DETAIL_KEEP : KEEP_RADIUS); }
  async load(t) {
    const id = key(t); if (this.loaded.has(id) || this.pending.has(id) || this.failed.has(id)) return;
    this.pending.add(id);
    try {
      const root = placeCell((await this.loader.loadAsync(this.base + tilePath(t))).scene, t.i, t.j, this.cell); this.world.scene.add(root); root.updateMatrixWorld(true);
      const leaf = t.level === this.leaf;   // leaves stay hidden and out of collision until their parent swaps to them (syncParents)
      if (t.kind === 'collision') root.traverse((o) => { if (!o.isMesh) return; o.visible = false; if (!leaf && collides(o)) addCollision(this.mc, o); });
      else styleVisual(root);
      if (leaf) root.visible = false;
      this.loaded.set(id, { ...t, root, active: !leaf }); this.syncParents();
    } catch (e) { this.failed.add(id); throw e; }   // a broken or missing tile is reported once, not re-requested every pass
    finally { this.pending.delete(id); }
  }
  request(t) { const id = key(t); if (this.loaded.has(id) || this.pending.has(id) || this.failed.has(id) || this.queue.some((q) => key(q) === id)) return;
    this.queue.push(t); this.pump(); }
  pump() { while (this.active < LOADS && this.queue.length) { const t = this.queue.shift(); this.active++;
    this.load(t).catch((e) => console.error('[map-lab] tile', key(t), e)).finally(() => { this.active--; this.pump(); }); } }
  setActive(t, active) {
    if (t.active === active) return; t.active = active;
    if (t.kind === 'visual') { t.root.visible = active; return; }
    t.root.traverse((o) => { if (!collides(o)) return; if (active) addCollision(this.mc, o); else this.mc.remove(o); });
  }
  syncParents() {
    for (const parent of this.loaded.values()) {
      if (parent.level === this.leaf) continue;
      const children = this.children(parent).map((c) => this.loaded.get(key(c)));
      const full = children.every(Boolean); this.setActive(parent, !full);
      for (const child of children) if (child) this.setActive(child, full);
    }
  }
  update(x, z) {
    const { visualLevel, collisionLevel } = this.release;
    this.queue = this.queue.filter((t) => this.keep(x, z, t));
    for (const t of this.near(x, z, 'collision', collisionLevel, COLLISION_RADIUS)) this.request(t);
    for (const t of this.near(x, z, 'visual', visualLevel, VISUAL_RADIUS)) this.request(t);
    if (this.details) for (const [kind, level] of [['collision', collisionLevel], ['visual', visualLevel]])
      for (const p of this.near(x, z, kind, level, DETAIL_RADIUS)) for (const t of this.children(p)) this.request(t);
    this.queue.sort((a, b) => this.distance(x, z, a) - this.distance(x, z, b));
    for (const [id, t] of this.loaded) {
      if (this.keep(x, z, t)) continue;
      t.root.traverse((o) => { if (!o.isMesh) return; if (t.kind === 'collision' && t.active && collides(o)) this.mc.remove(o); o.geometry.dispose(); o.material.dispose(); });
      this.world.scene.remove(t.root); this.loaded.delete(id);
    }
    this.syncParents();
  }
}

export async function load(ctx, world) {
  const base = ctx.qs.get('tiles') === 'local' ? LOCAL_RELEASE : TILE_HOST;
  const res = await fetch(`${base}${OUTPUT}/release.json`); if (!res.ok) throw new Error(`Map Lab release missing at ${base} (${res.status})`);
  const release = await res.json();
  if (release.versions?.TILESET_FORMAT_VERSION !== TILESET_FORMAT || release.versions?.COLLISION_FORMAT_VERSION !== COLLISION_FORMAT) throw new Error('Unsupported Map Lab tile format');
  // ?bake=1 is tools/maplab-release.mjs rendering the minimap the release doesn't have yet
  if (!release.minimap && ctx.qs.get('bake') !== '1') throw new Error('Map Lab release has no baked minimap: run tools/maplab-release.mjs');
  world.mapLab = { release, base, loader: new GLTFLoader().setMeshoptDecoder(MeshoptDecoder) };
}

/** the whole map at its coarsest level from the raw export, lit from above: tools/maplab-release.mjs shoots the minimap of it */
export async function planScene(stream) {
  const plan = new THREE.Scene();
  plan.add(new THREE.AmbientLight(0xffffff, 1.4)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(0, 500, 0); plan.add(sun);
  const roots = await Promise.all(stream.release.cells.map(([i, j]) => stream.loader.loadAsync(EXPORT + tilePath({ kind: 'visual', level: 0, i, j, x: 0, y: 0 })).then((g) => placeCell(g.scene, i, j, stream.cell))));
  for (const root of roots) { styleVisual(root); plan.add(root); }
  return plan;
}

export async function build(world) {
  if (!world.mapLab) throw new Error('Map Lab map not loaded');
  const { ctx, W } = world, { release } = world.mapLab, [sx, sz] = START; buildSky(world);
  const stream = new TileStream(world, world.mapLab); ctx.mapLabStream = stream;
  const is = release.cells.map((c) => c[0]), js = release.cells.map((c) => c[1]);
  W.bounds.set(new THREE.Vector3(Math.min(...is) * stream.cell, BOUNDS_Y[0], Math.min(...js) * stream.cell), new THREE.Vector3((Math.max(...is) + 1) * stream.cell, BOUNDS_Y[1], (Math.max(...js) + 1) * stream.cell));
  if (release.minimap) W.mapImage = { src: `${stream.base}${OUTPUT}/${release.minimap.file}`, b: release.minimap.b };
  const startTiles = stream.near(sx, sz, 'collision', release.collisionLevel, START_TILES); if (!startTiles.length) throw new Error('Map Lab start tiles missing');
  await Promise.all(startTiles.map((t) => stream.load(t)));
  const area = new THREE.Box3(new THREE.Vector3(sx - SPAWN.half, BOUNDS_Y[0], sz - SPAWN.half), new THREE.Vector3(sx + SPAWN.half, BOUNDS_Y[1], sz + SPAWN.half));
  const spawn = stream.mc.spawns(area, SPAWN.picks, { step: SPAWN.step, spread: SPAWN.spread }).sort((a, b) => Math.hypot(a.x - sx, a.z - sz) - Math.hypot(b.x - sx, b.z - sz))[0];
  if (!spawn) throw new Error('No safe West 12th Street spawn');
  const slots = [], candidates = [];
  for (let dx = -PARKING.half; dx <= PARKING.half; dx += PARKING.step) for (let dz = -PARKING.half; dz <= PARKING.half; dz += PARKING.step) candidates.push([spawn.x + dx, spawn.z + dz]);
  candidates.sort((a, b) => Math.hypot(a[0] - spawn.x, a[1] - spawn.z) - Math.hypot(b[0] - spawn.x, b[1] - spawn.z));
  for (const [x, z] of candidates) {
    if (Math.hypot(x - spawn.x, z - spawn.z) < PARKING.gap || slots.some((p) => Math.hypot(x - p.x, z - p.z) < PARKING.gap)) continue;
    const hit = stream.mc.hitDown(x, z, PARKING.rayTop); if (!hit || hit.object.userData.collisionRole !== 'walkable-ground') continue;
    const normal = hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld);
    if (normal && normal.y < PARKING.flat || Math.abs(hit.point.y - spawn.y) > PARKING.rise) continue;
    const at = new THREE.Vector3(x, hit.point.y, z); if (stream.mc.overlapsCapsule(at, PARKING.room, PARKING.room)) continue;
    slots.push(at); if (slots.length === CARS.length) break;
  }
  if (slots.length !== CARS.length) throw new Error('Not enough clear West 12th Street car spaces');
  W.playerSpawns = [spawn.clone()]; W.enemySpawns = []; W.poses.spawn = [spawn.x, spawn.y, spawn.z, Math.PI, 0];
  W.onlineStart = [spawn.x, spawn.y, spawn.z, Math.PI];
  W.groundHeight = (x, z) => stream.mc.groundFor(x, z); W.surfaceAt = (p) => stream.mc.surfaceAt(p);
  await Promise.all(stream.near(spawn.x, spawn.z, 'visual', release.visualLevel, START_VISUAL).map((t) => stream.load(t)));
  stream.update(spawn.x, spawn.z);
  let tick = 0; world.updaters.push((dt) => { tick += dt; if (tick < STREAM_TICK) return; tick = 0; const p = ctx.player?.position; if (p) stream.update(p.x, p.z); });
  const parked = CARS.slice(1).map((car, i) => ({ ...car, x: slots[i + 1].x, y: slots[i + 1].y, z: slots[i + 1].z, ry: 0 }));
  placeCars(world, parked); for (const car of parked) parkedCarBoxes(world, car);
  buildKit(world, { cash: 0, inventory: [], title: 'MAP LAB CONEY', help: 'F · drive or take jetpack<br>WASD · move or steer · Space · jetpack thrust<br>X · take jetpack off', respawn: { label: 'Start', at: () => W.onlineStart } });
  W.arkadyTable = { pos: spawn.clone(), seat: spawn.clone().add(new THREE.Vector3(0, 0, 1)) };
  buildJetpacks(world);
  waterRules(world, stream.mc);
  // after the first frames: leaf detail starts streaming, and the Ferrari goes on the first space
  ctx.bus.on('boot', () => { stream.details = true; const p = slots[0]; ctx.vehicles.spawnCar(p.x, p.z, Math.PI, CARS[0].kind, CARS[0].color, p.y, true); });
}

/** deep water: you swim back to the last spot you stood or drove on dry ground; a car driven in too deep stays sunk on the bed */
function waterRules(world, mc) {
  const { ctx, W } = world; let dry = null, t = 0;
  world.updaters.push((dt) => {
    if ((t += dt) < WATER_TICK) return; t = 0; const p = ctx.player; if (!p || p.dead || ctx.state !== 'playing') return;
    const v = ctx.vehicles?.mounted, at = v ? v.pos : p.position, w = mc.waterAt(at.x, at.z), under = w === null ? 0 : w - at.y;
    if (under <= 0) { if (v ? !v.air : p.onGround) dry = [at.x, at.y, at.z]; return; }
    if (v ? v.spec.water || under <= CAR_WADE : under <= WADE) return;   // jet skis float; shallow water is wading
    if (v) ctx.vehicles.dismount();
    const [x, y, z] = dry || W.onlineStart; p.teleport(x, y, z, p.yaw, 0); ctx.hud?.toast?.(v ? 'THE CAR SANK · SWAM ASHORE' : 'SWAM ASHORE', 1800);
  });
}

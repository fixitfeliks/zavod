// World host: picks a map from the registry (?map=), provides shared builder helpers, exposes ctx.world. Owned by: main.
// Map content lives in ./world/maps/<id>.js (one agent per map); shared submodules in ./world/*.js.
import * as THREE from 'three';
import { MAPS, DEFAULT_MAP } from './world/maps/index.js';
import { loadPeople } from './world/people.js';
import { loadCarModels } from './world/carmodels.js';
import { clampTextures } from './texclamp.js';

const updaters = [];
let W = null;
// ?prof=1: tag every updater with the file:line that registered it so the frame profiler (main.js) can name slow ones
if (typeof location !== 'undefined' && /[?&]prof=1/.test(location.search)) updaters.push = function (...fns) { const at = (new Error().stack || '').split('\n')[2] || ''; for (const f of fns) f.__src = (at.match(/src\/([^?)]+?):(\d+)/) || []).slice(1, 3).join(':'); return Array.prototype.push.apply(this, fns); };

export async function init(ctx) {
  const { scene, renderer } = ctx;
  const R = ctx.rng;
  const mapId = MAPS[ctx.qs.get('map')] ? ctx.qs.get('map') : DEFAULT_MAP;
  const map = MAPS[mapId];
  W = {
    mapId, meta: map.meta,
    maps: Object.values(MAPS).map(m => m.meta),           // for the HUD map selector
    grade: map.meta.grade, ambience: map.meta.ambience,   // hints for post (color grade) and audio (ambience set)
    bounds: new THREE.Box3(new THREE.Vector3(-58, -1, -58), new THREE.Vector3(58, 30, 58)),
    poses: {}, playerSpawns: [], enemySpawns: [], coverPoints: [], navNodes: [],
    walkables: [],      // optional: Box3[] of elevated walkable platforms (tops are floors) for AI nav on multi-level maps
    ladders: [],        // { x, z, y0, y1, nx, nz } — ladder face at (x,z), climbable from y0 to y1, normal (nx,nz) points AWAY from the wall toward the climber
    lampPositions: [],  // filled by lamps.js, read by rain.js for lit streaks
    groundHeight: () => 0,
    surfaceAt: (p) => (p.y > 0.2 ? 'metal' : 'ground'),
    updaters,
  };

  // the play area: the map's bounds plus its extra zones (coney: Brighton, Neptune Av, the yard, the Belt, 8th Ave) as one region.
  // Inside any rect is fine, and so is a seam a few metres wide between two of them (they don't quite meet); past the outer edge
  // you're put back inside the nearest one. Returns [x, z]
  const SEAM = 8;   // m: a 3 m gap + the 1.2 m pad on both sides, with room
  W.playClamp = (x, z, pad = 0) => {
    const B = W.bounds; let near = 0, best = null, bd = Infinity;
    for (const r of [{ x0: B.min.x, x1: B.max.x, z0: B.min.z, z1: B.max.z }, ...(W.zones || [])]) {
      const cx = Math.min(r.x1 - pad, Math.max(r.x0 + pad, x)), cz = Math.min(r.z1 - pad, Math.max(r.z0 + pad, z)), d = Math.hypot(cx - x, cz - z);
      if (d === 0) return [x, z]; if (d < SEAM) near++; if (d < bd) { bd = d; best = [cx, cz]; } }
    return near >= 2 ? [x, z] : best;
  };

  // shared helpers for map builders / submodules
  const world = {
    ctx, R, W, scene, updaters,
    /** Register a solid mesh: shadows, raycast target, AABB collider. */
    solid(mesh, surface = 'metal', { collide = true, shadow = true, box = null } = {}) {
      mesh.userData.surface = surface;
      if (shadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
      ctx.raycastTargets.push(mesh);
      if (collide) {
        if (box) ctx.colliders.push(box);
        else { mesh.updateWorldMatrix(true, false); ctx.colliders.push(new THREE.Box3().setFromObject(mesh)); }
      }
      return mesh;
    },
    box(min, max) { const b = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)); ctx.colliders.push(b); return b; },
    /** Elevated floor the AI may walk on (also a collider). */
    walkable(min, max) { const b = world.box(min, max); W.walkables.push(b); return b; },
    /** Register a ladder + build a simple visible ladder mesh (rails + rungs). Player climbs it; the top platform must be a collider whose top is y1. */
    ladder(x, z, y0, y1, nx, nz, { mesh = true, color = 0x5a5f66 } = {}) {
      const n = Math.hypot(nx, nz) || 1; nx /= n; nz /= n;
      const L = { x, z, y0, y1, nx, nz }; W.ladders.push(L);
      if (mesh) {
        const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.85 });
        const h = y1 - y0 + 0.9; const rail = new THREE.CylinderGeometry(0.02, 0.02, h, 8);
        for (const sx of [-0.22, 0.22]) { const r = new THREE.Mesh(rail, mat); r.position.set(sx, h / 2, 0); g.add(r); }
        const rung = new THREE.CylinderGeometry(0.014, 0.014, 0.44, 8); rung.rotateZ(Math.PI / 2);
        for (let y = 0.3; y < h - 0.2; y += 0.3) { const r = new THREE.Mesh(rung, mat); r.position.set(0, y, 0); g.add(r); }
        g.position.set(x + nx * 0.12, y0, z + nz * 0.12); g.rotation.y = Math.atan2(nx, nz); scene.add(g);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.surface = 'metal'; ctx.raycastTargets.push(o); } });
        L.mesh = g;
      }
      return L;
    },
    cover(x, z, nx, nz, y = 0) { W.coverPoints.push({ position: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(nx, 0, nz).normalize() }); },
  };

  ctx.progress(0.12, `map: ${map.meta.name}`);
  if (['coney', 'wsp', 'sbu'].includes(mapId)) { try { await loadPeople(ctx); } catch (e) { console.warn('[world] people', e); } }
  if (mapId === 'coney' || mapId === 'maplab') { try { await loadCarModels(ctx); } catch (e) { console.warn('[world] car models', e); } }   // real GLB cars (world/carmodels.js)
  // maps built from files (Map Lab tiles, a stand-in GLB) load them first; the authored maps have no load() and build as before
  if (map.load) { try { await map.load(ctx, world); } catch (e) { console.error(`[world] ${mapId} load`, e); ctx.bootErrors = (ctx.bootErrors || []).concat(`map load: ${e.message}`); } }
  await map.build(world);   // coney builds in steps (async), the rest at once
  try { clampTextures(ctx); setTimeout(() => { try { clampTextures(ctx); } catch {} }, 5000); } catch (e) { console.warn('[world] texclamp', e); }   // phones: textures down to the device budget
  if (!W.poses.spawn && W.playerSpawns[0]) { const s = W.playerSpawns[0]; W.poses.spawn = [s.x, s.y, s.z, 0, 0]; }
  // random-spawn variety: every map offers ≥ 6 player spawn points — borrow ground-level enemy spawns farthest from the map's own player spawns
  if (W.playerSpawns.length < 6 && W.enemySpawns.length > 6) {
    const far = W.enemySpawns.filter(e => Math.abs(e.y || 0) < 0.15).map(e => ({ e, d: Math.min(...W.playerSpawns.map(p => p.distanceTo(e))) })).sort((a, b) => b.d - a.d);
    const mid = far.slice(Math.floor(far.length / 3), Math.floor(far.length / 3) + (6 - W.playerSpawns.length)); // mid-distance ones: not on top of the enemy side
    for (const { e } of mid) W.playerSpawns.push(e.clone());
  }
  return W;
}

export function update(dt, ctx) {
  if (!W) return;
  // each updater on its own: one that throws (and keeps throwing) must not stop the rest — a broken flag animation once took
  // every prompt on phones with it (no jet pack, no stealing cars). The error is logged once per updater.
  const P = ctx.prof; if (!P) { for (let i = 0; i < updaters.length; i++) { try { updaters[i](dt, ctx); } catch (e) { const f = updaters[i]; if (!f.__err) { f.__err = 1; console.error('[updater]', e); } } } return; }
  for (let i = 0; i < updaters.length; i++) { const f = updaters[i], t = performance.now(); f(dt, ctx); P.mark('u:' + (f.__src || i), performance.now() - t); }
}

export function reset(ctx) { /* maps are static; dynamic state lives in other modules */ }

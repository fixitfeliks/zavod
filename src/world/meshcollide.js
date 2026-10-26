// Mesh collision for maps built from real geometry (Map Lab's collision tiles; a stand-in GLB until they arrive). Owned by: main.
// Map Lab ships four meshes per tile: walkable-ground, walkable-elevated, blocking, water-surface. This answers what the box world (ctx.colliders)
// answers for the authored maps, from triangle meshes through three-mesh-bvh (already shipped for raycasts):
//  · groundAt(x, z, yFrom): a downward ray onto the walkable meshes from just above your feet (a curb steps up, a deck 3 m over your
//    head doesn't), so W.groundHeight works unchanged for the player's step-up / landing logic
//  · resolveCapsule(): the player's capsule pushed out of blocking triangles (walls, buildings) after the box pass
//  · surfaceAt(p): the walkable surface's class under a point, mapped to the game's footstep / impact sounds (SURFACE_NAMES);
//    'water' when the point is under a water surface (wading)
//  · waterAt(x, z): the water surface over a point; the bed under it is walkable ground, so depth = waterAt - groundAt
//  · resolveVehicleCircle(): a vehicle body circle pushed out sideways (vehicles.js, after its box pass)
//  · overlapsCapsule(): for spawn checks (body room)
// Every mesh but the water also becomes a raycast target, so bullets and sight lines hit it.
import * as THREE from 'three';

// Map Lab surface classes → the game's surface names (audio.js: concrete / metal / wood / water / ground). Unknown classes log once
// and play as concrete (heard, not silently dropped).
export const SURFACE_NAMES = {
  roadbed: 'concrete', paved: 'concrete', pitch: 'concrete', deck: 'metal', wood: 'wood', land: 'ground', ballast: 'ground', sand: 'ground',
  water: 'water', wall: 'concrete', roof: 'concrete', floor: 'concrete',
};
const warned = new Set();
export function surfaceName(cls) {
  const n = SURFACE_NAMES[cls]; if (n) return n;
  if (!warned.has(cls)) { warned.add(cls); console.warn(`[meshcollide] unknown surface class "${cls}": playing it as concrete`); }
  return 'concrete';
}

export const ROLES = ['walkable-ground', 'walkable-elevated', 'water-surface', 'blocking'];   // water: a sheet over the ground (its bed), not stood on
const STEP_UP = 0.5;   // m above the feet the ground ray starts: a step / curb up to this height is walked onto
const _ray = new THREE.Raycaster(), _down = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
const _seg = new THREE.Line3(), _box = new THREE.Box3(), _tp = new THREE.Vector3(), _cp = new THREE.Vector3(), _inv = new THREE.Matrix4(), _d = new THREE.Vector3();
const _vp = new THREE.Vector3(), _vv = new THREE.Vector3(), _vinfo = {}, _vhit = { x: 0, z: 0, nx: 0, nz: 0, depth: 0, box: null };

export class MeshCollision {
  constructor(ctx) { this.ctx = ctx; this.walk = []; this.block = []; this.water = []; }
  /** register a mesh by role (ROLES) and surface class (Map Lab's) */
  add(mesh, role, cls) {
    if (!ROLES.includes(role)) throw new Error(`[meshcollide] unknown role ${role}`);
    mesh.updateWorldMatrix(true, false); const g = mesh.geometry;
    if (!g.boundsTree) g.computeBoundsTree({ maxLeafTris: 8 });
    mesh.userData.surfaceClass = cls; mesh.userData.surface = surfaceName(cls); mesh.userData.collisionRole = role;
    mesh.userData.inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    this.list(role).push(mesh);
    if (role !== 'water-surface') this.ctx.raycastTargets.push(mesh);   // bullets go into water
  }
  list(role) { return role === 'blocking' ? this.block : role === 'water-surface' ? this.water : this.walk; }
  /** unregister a mesh added with add() (streamed tiles leaving range) */
  remove(mesh) {
    const list = this.list(mesh.userData.collisionRole);
    const i = list.indexOf(mesh); if (i >= 0) list.splice(i, 1);
    const j = this.ctx.raycastTargets.indexOf(mesh); if (j >= 0) this.ctx.raycastTargets.splice(j, 1);
  }
  /** the water surface over (x, z), or null on dry land; its depth there is waterAt - groundAt (the bed is walkable ground) */
  waterAt(x, z) {
    _ray.set(_o.set(x, 1e4, z), _down); _ray.far = Infinity; _ray.firstHitOnly = true;
    let y = null; for (const m of this.water) { const h = _ray.intersectObject(m, false)[0]; if (h && (y === null || h.point.y > y)) y = h.point.y; }
    return y;
  }
  /** highest walkable surface under (x, z) at or below yFrom (default: from the sky) */
  groundAt(x, z, yFrom = 1e4) {
    const h = this.hitDown(x, z, yFrom); return h ? h.point.y : -Infinity;
  }
  hitDown(x, z, yFrom) {
    _ray.set(_o.set(x, yFrom, z), _down); _ray.far = Infinity; _ray.firstHitOnly = true;
    let best = null; for (const m of this.walk) { const h = _ray.intersectObject(m, false)[0]; if (h && (!best || h.distance < best.distance)) best = h; }
    return best;
  }
  /** the ground under the player: the ray starts STEP_UP above the feet when the query is about where the player stands */
  groundFor(x, z) {
    const p = this.ctx.player?.position, near = p && Math.abs(p.x - x) < 3 && Math.abs(p.z - z) < 3;
    return this.groundAt(x, z, near ? p.y + STEP_UP : 1e4);
  }
  surfaceAt(p) { const w = this.waterAt(p.x, p.z); if (w !== null && w > p.y) return 'water';   // wading
    const h = this.hitDown(p.x, p.z, p.y + 0.3); return h ? h.object.userData.surface : 'concrete'; }
  /** push a vertical capsule (feet at pos, radius r, height h) out of the blocking meshes; velocity loses its into-wall part */
  resolveCapsule(pos, r, h, vel, info) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const m of this.block) {
        _inv.copy(m.userData.inv);
        _seg.start.set(pos.x, pos.y + r, pos.z).applyMatrix4(_inv); _seg.end.set(pos.x, pos.y + h - r, pos.z).applyMatrix4(_inv);
        _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end); _box.min.addScalar(-r); _box.max.addScalar(r);
        const s0 = _seg.start.clone();
        m.geometry.boundsTree.shapecast({
          intersectsBounds: (b) => b.intersectsBox(_box),
          intersectsTriangle: (tri) => {
            const dist = tri.closestPointToSegment(_seg, _tp, _cp);
            if (dist < r) { const depth = r - dist; _d.subVectors(_cp, _tp); const L = _d.length(); if (L < 1e-6) return; _d.divideScalar(L); _seg.start.addScaledVector(_d, depth); _seg.end.addScaledVector(_d, depth); }
          },
        });
        _d.subVectors(_seg.start, s0).transformDirection(m.matrixWorld).multiplyScalar(_seg.start.distanceTo(s0));
        if (_d.lengthSq() < 1e-10) continue;
        moved = true; pos.add(_d);
        const L = _d.length(), nx = _d.x / L, ny = _d.y / L, nz = _d.z / L, vn = vel.x * nx + vel.y * ny + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.y -= vn * ny; vel.z -= vn * nz; }
        if (ny > 0.7) info.ground = true; else if (ny < -0.7) info.ceiling = true; else { info.blocked = m; info.blockedNX = nx; info.blockedNZ = nz; }
      }
      if (!moved) break;
    }
    return info;
  }
  /** a vehicle's body circle (centre x, z, between heights y0..y1) pushed out sideways; null when clear. Reused result object. */
  resolveVehicleCircle(x, z, r, y0, y1) {
    _vp.set(x, y0 - r, z); _vv.set(0, 0, 0); this.resolveCapsule(_vp, r, y1 - y0 + r * 2, _vv, _vinfo);
    const dx = _vp.x - x, dz = _vp.z - z, depth = Math.hypot(dx, dz); if (depth <= 1e-5) return null;
    _vhit.x = _vp.x; _vhit.z = _vp.z; _vhit.nx = dx / depth; _vhit.nz = dz / depth; _vhit.depth = depth; return _vhit;
  }
  /** would a capsule at pos (feet) touch any blocking triangle? (spawn room checks) */
  overlapsCapsule(pos, r, h) {
    for (const m of this.block) {
      _seg.start.set(pos.x, pos.y + r, pos.z).applyMatrix4(m.userData.inv); _seg.end.set(pos.x, pos.y + h - r, pos.z).applyMatrix4(m.userData.inv);
      _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end); _box.min.addScalar(-r); _box.max.addScalar(r);
      let hit = false; m.geometry.boundsTree.shapecast({ intersectsBounds: (b) => b.intersectsBox(_box), intersectsTriangle: (tri) => { if (tri.closestPointToSegment(_seg, _tp, _cp) < r) { hit = true; return true; } return false; } });
      if (hit) return true;
    }
    return false;
  }
  /** player / enemy spawns by rule: on walkable ground, flat, with body room, spread out (the same code works on a real cell) */
  spawns(bounds, n = 8, { step = 6, clear = 0.6, height = 1.8, spread = 12 } = {}) {
    const out = [];
    for (let x = bounds.min.x + step; x < bounds.max.x - step && out.length < n * 8; x += step) for (let z = bounds.min.z + step; z < bounds.max.z - step && out.length < n * 8; z += step) {
      const hit = this.hitDown(x, z, 1e4); if (!hit || hit.object.userData.collisionRole !== 'walkable-ground' || this.waterAt(x, z) !== null) continue;   // not a seabed
      const nrm = hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld); if (nrm && nrm.y < 0.95) continue;   // flat
      const p = new THREE.Vector3(x, hit.point.y, z); if (this.overlapsCapsule(p, clear, height)) continue;
      if (out.some((q) => q.distanceTo(p) < spread)) continue; out.push(p);
    }
    // spread the picks over the whole area rather than the first corner scanned
    const pick = []; for (let i = 0; i < n && out.length; i++) pick.push(out.splice(Math.floor((i * 7919) % out.length), 1)[0]);
    return pick;
  }
}

// Vehicle solids: every car / bus / cop car / Uber / friend's car as an oriented box in one XZ grid, so AI drivers from different
// modules (coney traffic, 8th Ave, the Belt, cops, the Uber) see each other: follow with a gap, and never move into one another.
// A solid is any object with live fields { x, z, h, hl, hw, v } (h: heading, forward = (-sin h, -cos h); hl / hw: half length /
// width; v: speed along forward). Modules register a source (a function returning their solids); the grid is rebuilt at most once
// a frame, on the first query. Positions are read live, so a car that moved this frame is seen where it is now. TRAFFIC agent.
const CELL = 8, PAD = 6;   // m: grid cell; query pad (a frame's travel + the longest half length, a bus's 6 m)
const SRC = new Map(), STATIC = [];
let grid = new Map(), builtT = -1, staticGrid = null;
const key = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
/** register (or replace) a named source: fn() → iterable of solids */
export function solidSource(name, fn) { SRC.set(name, fn); builtT = -1; }
/** solids that never move (parked cars): binned once */
export function staticSolids(list) { STATIC.push(...list); staticGrid = null; }
function bin(map, o) { const k = key(Math.floor(o.x / CELL), Math.floor(o.z / CELL)); let l = map.get(k); if (!l) map.set(k, (l = [])); l.push(o); }
function build() {
  const t = performance.now();
  if (t - builtT >= 4) { builtT = t; grid.clear();
    for (const fn of SRC.values()) { let L; try { L = fn(); } catch { continue; } if (L) for (const o of L) if (o && Number.isFinite(o.x)) bin(grid, o); } }
  // staticGrid's own rebuild must not be gated by the dynamic-grid throttle above: staticSolids() can be called mid-frame
  // right after a dynamic rebuild just ran (within the same 4 ms), and solidsNear() always reads both grids - if that early
  // return above skipped this block too, staticGrid stayed null (it was just invalidated) and the very next query crashed
  // reading .get off null. A source registered after the world has started (staticSolids mid-play) must still bin cleanly.
  if (!staticGrid) { staticGrid = new Map(); for (const o of STATIC) if (!o.gone) bin(staticGrid, o); }
}
const _near = [];
/** solids within r (+ PAD) of (x, z), moving and parked */
export function solidsNear(x, z, r) {
  build(); _near.length = 0; const x0 = Math.floor((x - r - PAD) / CELL), x1 = Math.floor((x + r + PAD) / CELL), z0 = Math.floor((z - r - PAD) / CELL), z1 = Math.floor((z + r + PAD) / CELL);
  for (const g of [grid, staticGrid]) for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const l = g.get(key(ix, iz)); if (l) for (const o of l) if (!o.gone) _near.push(o); }
  return _near;
}
/** do two oriented boxes overlap (separating axes), each grown by pad */
export function obbOverlap(ax, az, ah, ahl, ahw, b, pad = 0) {
  const afx = -Math.sin(ah), afz = -Math.cos(ah), bfx = -Math.sin(b.h), bfz = -Math.cos(b.h), dx = b.x - ax, dz = b.z - az;
  for (const [ux, uz] of [[afx, afz], [-afz, afx], [bfx, bfz], [-bfz, bfx]]) {
    const ra = (ahl + pad) * Math.abs(afx * ux + afz * uz) + (ahw + pad) * Math.abs(-afz * ux + afx * uz), rb = (b.hl + pad) * Math.abs(bfx * ux + bfz * uz) + (b.hw + pad) * Math.abs(-bfz * ux + bfx * uz);
    if (Math.abs(dx * ux + dz * uz) >= ra + rb) return false;
  }
  return true;
}
/** may `self` move from its current (self.x, self.z) to (x, z, h)? Not if that puts it into a solid it doesn't already overlap, or
 *  deeper into one it does (closer centres). Returns the solid in the way, or null. */
export function moveBlocked(self, x, z, h, hl = self.hl, hw = self.hw, skip = null) {
  for (const o of solidsNear(x, z, hl + 2)) {
    if (o === self || o === skip || o.ghost || (self.ignore && self.ignore(o))) continue;
    if (Math.abs(o.x - x) > hl + o.hl + 1 || Math.abs(o.z - z) > hl + o.hl + 1) continue;
    if (!obbOverlap(x, z, h, hl, hw, o)) continue;
    if (!obbOverlap(self.x, self.z, self.h ?? h, hl, hw, o)) return o;
    if (Math.hypot(o.x - x, o.z - z) < Math.hypot(o.x - self.x, o.z - self.z) - 1e-3) return o;
  }
  return null;
}
/** the nearest solid ahead of (x, z, h) in a corridor of half width hw + lat, within range: { o, gap (bumper to body), v (its speed along my heading) } */
const _ahead = { o: null, gap: 0, v: 0 };
export function solidAhead(self, x, z, h, hl, hw, range = 40, lat = 0.35) {
  const fx = -Math.sin(h), fz = -Math.cos(h); _ahead.o = null; _ahead.gap = range; _ahead.v = 0;
  for (const o of solidsNear(x + fx * range / 2, z + fz * range / 2, range / 2)) {
    if (o === self || o.ghost || (self?.ignore && self.ignore(o))) continue;
    const dx = o.x - x, dz = o.z - z, f = dx * fx + dz * fz; if (f <= 0) continue;
    const ofx = -Math.sin(o.h), ofz = -Math.cos(o.h), al = ofx * fx + ofz * fz, ext = o.hl * Math.abs(al) + o.hw * Math.sqrt(Math.max(0, 1 - al * al));
    if (Math.abs(dx * -fz + dz * fx) > hw + lat + (o.hw * Math.abs(al) + o.hl * Math.sqrt(Math.max(0, 1 - al * al)))) continue;
    const gap = f - hl - ext; if (gap < _ahead.gap) { _ahead.gap = gap; _ahead.o = o; _ahead.v = (o.v || 0) * al; }
  }
  return _ahead;
}

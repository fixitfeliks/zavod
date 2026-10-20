// CONEY — traffic on 8th Ave by Soc Tav (its own zone, off the Coney street graph): cars, yellow and green cabs and the white
// dollar vans run both ways down the avenue keeping right, queue behind each other, stop on red at 60th and 61st St (the same
// cycle the signal heads show, coney/street.js avenueKit) and for you in the road; a B70 runs each way and pulls in at its stop
// for a few seconds; a couple of cars cross on 60th and 61st on their green. They wrap round out of sight past the far blocks.
// Instanced per kind × material slot (one draw each), updated only while you're out here. CONEY agent.
import * as THREE from 'three';
import { carGeometries, carMaterials, carSpec, CAR_COLORS, wheelInstances, wheelLayout } from '../carkit.js';
import { buildBus } from '../../vehicles/bus.js';
import { AVE8 } from './tavern.js';
import { solidSource, solidAhead } from '../../vehicles/solids.js';

const X0 = -330, X1 = 330, LANE = 3.0, VMAX = 11, ACC = 2.4, BRK = 5, GAP = 2.2, CYC = 34;
const KINDS = ['sedan', 'suv', 'cab', 'van'], SLOTS = ['paint', 'glass', 'trim', 'lampW', 'lampR', 'plate', 'shadow'];

export function buildAveTraffic(world) {
  const { scene, ctx, W } = world; if (!W.tavern) return null; const lite = !!ctx.lite, A = AVE8, OZ = A.ZC;
  let seed = 6004; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const CM = carMaterials(), ims = {}, ZERO = new THREE.Matrix4().makeScale(0, 0, 0), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _e = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1);
  const n = ctx.safeMode ? 3 : lite ? 6 : 14, cars = [];
  // the cars: each lane gets its share, spaced out along the avenue
  for (let i = 0; i < n; i++) { const dir = i % 2 ? -1 : 1, k = R(), kind = k < 0.4 ? 'sedan' : k < 0.6 ? 'suv' : k < 0.82 ? 'cab' : 'van';
    const color = kind === 'cab' ? new THREE.Color(R() < 0.45 ? 0x8cd04a : 0xf2b820) : kind === 'van' ? new THREE.Color(0xf2f2ee) : CAR_COLORS[(R() * CAR_COLORS.length) | 0];
    cars.push({ kind, color, dir, x: X0 + (X1 - X0) * (Math.floor(i / 2) + R() * 0.5) / Math.ceil(n / 2), v: VMAX * 0.8, len: carSpec(kind).len, slot: 0, z: OZ + dir * LANE }); }
  // instanced meshes per kind × slot, sized to how many of that kind there are
  for (const kind of KINDS) { const list = cars.filter((c) => c.kind === kind); if (!list.length) continue; const G = carGeometries(kind, { wheels: false }).geos; ims[kind] = [];
    list.forEach((c, i) => { c.slot = i; });
    for (const slot of SLOTS) { if (!G[slot]) continue; const mat = slot === 'glass' ? CM.glass : CM[slot]; if (!mat) continue; const im = new THREE.InstancedMesh(G[slot], mat, list.length); im.name = `aveTraffic:${kind}:${slot}`; im.frustumCulled = false; im.castShadow = slot === 'paint' && !lite;
      for (let i = 0; i < list.length; i++) { im.setMatrixAt(i, ZERO); if (slot === 'paint') im.setColorAt(i, list[i].color); } if (slot === 'shadow') im.renderOrder = 1; scene.add(im); ims[kind].push(im); } }
  const wheels = wheelInstances(scene, cars.length * 4, 'aveTraffic:wheels'), LAY = {}; for (const k of KINDS) LAY[k] = wheelLayout(k);   // kit wheels that roll
  // the buses: one each way (phones: one), a stop on each side of the block
  const buses = []; for (const dir of lite ? [1] : [1, -1]) { try { const B = buildBus({ sign: 'B70|SUNSET PARK', lite }); B.group.position.set(dir > 0 ? -200 : 200, 0, OZ + dir * (LANE + 0.4)); B.group.rotation.y = dir > 0 ? 0 : Math.PI; scene.add(B.group); buses.push({ B, dir, x: dir > 0 ? -200 : 200, v: 7, len: 12.5, z: OZ + dir * (LANE + 0.4), stopX: dir > 0 ? 30 : -60, dwell: 0, served: false }); } catch (e) { console.warn('[aveTraffic] bus', e); } }
  // the cross-street cars on 60th and 61st
  const cross = []; for (const c of A.cross) for (const dir of [1, -1]) { const kind = 'sedan'; cross.push({ cx: c.x, dir, kind, z: OZ - dir * 40, v: 0, x: c.x + -dir * 2.5 }); }
  const crossG = carGeometries('sedan', { wheels: false }).geos, crossIM = new THREE.InstancedMesh(crossG.paint, CM.paint, cross.length), crossGlass = new THREE.InstancedMesh(crossG.glass, CM.glass, cross.length);
  for (const im of [crossIM, crossGlass]) { im.frustumCulled = false; im.name = 'aveTraffic:cross'; scene.add(im); }
  const crossWheels = wheelInstances(scene, cross.length * 4, 'aveTraffic:crossWheels'), CL = wheelLayout('sedan'); cross.forEach((q, i) => crossIM.setColorAt(i, CAR_COLORS[(i * 3 + 1) % CAR_COLORS.length]));
  // signal state on the avenue / on the cross street (the same offsets avenueKit lights the heads with)
  const phase = (ci) => ((Date.now() / 1000 + ((ci + 1) * 7.3 + 8008) % 34) % CYC + CYC) % CYC;
  const aveGreen = (ci) => phase(ci) < 14 + 2.5, crossGreen = (ci) => { const t = phase(ci); return t >= 18 && t < 30; };
  const ahead = (self, list) => { let best = 1e9; for (const o of list) { if (o === self || o.dir !== self.dir) continue; const d = (o.x - self.x) * self.dir; if (d > 0 && d < best) best = d - (o.len + self.len) / 2; } return best; };
  // the avenue's cars and buses as solids (the Uber drives 8th Ave too); and anything else on the avenue ahead (the Uber, your car) counts in the gap
  const sol = (c) => { const o = c.sol || (c.sol = { hw: c.B ? 1.28 : 0.95, ave: true }); o.x = c.x; o.z = c.z; o.h = -c.dir * Math.PI / 2; o.hl = c.len / 2; o.v = c.v; return o; };
  solidSource('ave', () => { const P = ctx.player?.position; return P && Math.abs(P.z - OZ) < 320 ? [...cars, ...buses].map(sol) : []; });
  world.updaters.push((dt) => {
    const P = ctx.player?.position; if (!P || Math.abs(P.z - OZ) > 320 || dt <= 0) return; dt = Math.min(dt, 0.05);
    const all = [...cars, ...buses];
    for (const c of all) {
      let want = c.B ? 9 : VMAX, gap = ahead(c, all);
      { const a = solidAhead(sol(c), c.x, c.z, -c.dir * Math.PI / 2, c.len / 2, 0.95, 40, 0.3); if (a.o && !a.o.ave) gap = Math.min(gap, a.gap); }
      for (const [ci, cs] of A.cross.entries()) { const line = cs.x - c.dir * (A.CW + 2.5), d = (line - c.x) * c.dir - c.len / 2; if (d > -1 && d < 40 && !aveGreen(ci)) gap = Math.min(gap, d + 1.5); }   // red ahead: stop at the line
      if (Math.abs(P.y - (A.SW)) < 3 && Math.abs(P.z - c.z) < 1.6) { const d = (P.x - c.x) * c.dir - c.len / 2; if (d > 0) gap = Math.min(gap, d - 0.6); }   // you in the lane
      if (c.B) { const d = (c.stopX - c.x) * c.dir; if (!c.served && d > 0 && d < 30) gap = Math.min(gap, d + 0.8); if (!c.served && d <= 0.5 && c.v < 0.3) { c.dwell += dt; if (c.dwell > 8) { c.served = true; c.dwell = 0; } } }
      const stopV = Math.sqrt(Math.max(0, 2 * BRK * Math.max(0, gap - GAP)));
      const target = Math.min(want, stopV); c.v += (target > c.v ? ACC : -BRK) * dt; c.v = Math.max(0, Math.min(c.v, target + 0.3)); c.x += c.v * c.dir * dt;
      if (c.dir > 0 && c.x > X1) { c.x = X0; c.served = false; } else if (c.dir < 0 && c.x < X0) { c.x = X1; c.served = false; }
    }
    cars.forEach((c, i) => { _e.set(0, c.dir > 0 ? 0 : Math.PI, 0); _q.setFromEuler(_e); _m.compose(_p.set(c.x, 0, c.z), _q, ONE); for (const im of ims[c.kind]) im.setMatrixAt(c.slot, _m);
      c.spin = (c.spin || 0) + c.v * dt / LAY[c.kind].r; LAY[c.kind].wheels.forEach((w, k) => wheels.set(i * 4 + k, _m, w, c.spin, 0, LAY[c.kind].r)); });
    for (const k in ims) for (const im of ims[k]) im.instanceMatrix.needsUpdate = true; wheels.commit();
    for (const b of buses) { b.B.group.position.x = b.x; b.rolled = (b.rolled || 0) + b.v * dt; b.B.roll?.(b.rolled / 0.5); }   // (BUS wheel radius 0.5 m)
    // the cross streets: go on green, out to the end of the block and round again
    cross.forEach((q, i) => { const ci = A.cross.findIndex((c) => c.x === q.cx), atLine = q.z * q.dir > (OZ - q.dir * (A.HALF + 2)) * q.dir - 0.5 && (q.z - OZ) * q.dir < -A.HALF - 1;
      const go = crossGreen(ci) || !atLine; q.v += ((go ? 8 : 0) > q.v ? ACC : -BRK) * dt; q.v = Math.max(0, Math.min(8, q.v)); if (!go && (OZ - q.dir * (A.HALF + 2) - q.z) * q.dir < 1.5) q.v = 0; q.z += q.v * q.dir * dt;
      if ((q.z - OZ) * q.dir > 44) q.z = OZ - q.dir * 44;
      _e.set(0, q.dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0); _q.setFromEuler(_e); _m.compose(_p.set(q.x, 0, q.z), _q, ONE); crossIM.setMatrixAt(i, _m); crossGlass.setMatrixAt(i, _m); q.spin = (q.spin || 0) + q.v * dt / CL.r; CL.wheels.forEach((w, k) => crossWheels.set(i * 4 + k, _m, w, q.spin, 0, CL.r)); });
    crossIM.instanceMatrix.needsUpdate = true; crossGlass.instanceMatrix.needsUpdate = true; crossWheels.commit();
  });
  console.log('[aveTraffic] 8th Ave:', cars.length, 'cars ·', buses.length, 'buses ·', cross.length, 'on the cross streets');
  if (typeof window !== 'undefined' && window.__game) window.__game.aveTraffic = { cars: () => cars.map((c) => ({ kind: c.kind, x: +c.x.toFixed(1), v: +c.v.toFixed(1), dir: c.dir })), buses: () => buses.map((b) => ({ x: +b.x.toFixed(1), v: +b.v.toFixed(1) })) };
  return { cars, buses };
}

// Offline converter for the street car models (assets/models/<name>; see each one's SOURCE.md). Not part of the game and not
// a repo dependency: run it from a scratch folder with the packages installed (npm i @gltf-transform/core@4 @gltf-transform/functions@4
// @gltf-transform/extensions@4 meshoptimizer), macOS (it uses sips to average / resize textures):
//   node prep-car-model.mjs car <innerscene.glb> <out.glb> <triangle budget: 30000 desktop, 8000 for -lite>
//   node prep-car-model.mjs sloyd <sloyd.glb> <out.glb> <triangle budget: 25000 desktop, 7000 for -lite>
// Output GLB (kit frame: +x front, y up, ground 0, centred; +z = right / kerb side), nodes:
//   body-<cls> / interior-<cls> / sign-<cls> / pane-<name> / wheel-<cls> (one wheel at the origin, axle along z, outer face +z)
// cls = paint | dark | metal | lamp | glass (flat vertex colours, textures averaged away) for `car` / `bus`; `sloyd` keeps the
// source's one baked texture instead (body-tex, tinted: the paint tint multiplies the texture). If the 4 wheels come back as
// clean, disconnected islands AND the body has a proper wall behind each one, they're split into their own wheel-tex node
// (untinted) and spin with the existing wheel instancing; otherwise they stay in body-tex, static. scene extras: { wheels,
// r, len, w, h } (wheels: [] when they're static).
import fs from 'fs';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [, , cfgName, inFile, outFile, targetTris] = process.argv;
const CFG = {
  // taxi model: front at -x, width along z. Map (x, y, z) -> (-x, y, -z).
  car: { map: (p) => [-p[0], p[1], -p[2]], det: 1 },
  // bus: front at +z, doors on +x. Map (x, y, z) -> (z, y, x): doors land on +z (kerb side), a mirror (det -1)
  bus: { map: (p) => [p[2], p[1], p[0]], det: -1 },
}[cfgName];
const TARGET = +targetTris || 30000;
const TMP = fs.mkdtempSync('/tmp/prep-');

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

if (cfgName === 'sloyd') { await prepSloyd(inFile, outFile, TARGET); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(0); }

// ---- sloyd: a single textured trimesh (no named parts, no vertex colours) --------------------------------------------
// Sloyd generator cars are one mesh, one material, one baked texture, front along +z, up +y, width along x (a Blender-ish
// export axis order). That's a 90 degree turn to the kit frame, not a mirror: kit (x, y, z) = (source z, source y, -source x).
async function prepSloyd(inFile, outFile, targetTotalTris) {
  const lite = targetTotalTris < 15000;
  const doc = await io.read(inFile);
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  let meshNode = null; scene.traverse((node) => { if (node.getMesh()) meshNode = node; });
  const prim = meshNode.getMesh().listPrimitives()[0];
  const tex = prim.getMaterial().getBaseColorTexture();
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), UV = prim.getAttribute('TEXCOORD_0');
  const M = meshNode.getWorldMatrix(), n = P.getCount();
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const v = [0, 0, 0], w = [0, 0, 0], u = [0, 0];
  for (let i = 0; i < n; i++) {
    P.getElement(i, v);
    const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
    pos[i * 3] = z; pos[i * 3 + 1] = y; pos[i * 3 + 2] = -x;
    if (N) { N.getElement(i, w); const nx = M[0] * w[0] + M[4] * w[1] + M[8] * w[2], ny = M[1] * w[0] + M[5] * w[1] + M[9] * w[2], nz = M[2] * w[0] + M[6] * w[1] + M[10] * w[2], L = Math.hypot(nx, ny, nz) || 1;
      nor[i * 3] = nz / L; nor[i * 3 + 1] = ny / L; nor[i * 3 + 2] = -nx / L; }
    if (UV) { UV.getElement(i, u); uv[i * 2] = u[0]; uv[i * 2 + 1] = u[1]; }
  }
  const idx0 = Uint32Array.from(prim.getIndices().getArray());
  const bbOf = () => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], pos[i * 3 + k]); b[k + 3] = Math.max(b[k + 3], pos[i * 3 + k]); } return b; };
  let bb = bbOf();
  const off = [-(bb[0] + bb[3]) / 2, -bb[1], -(bb[2] + bb[5]) / 2];
  for (let i = 0; i < n; i++) { pos[i * 3] += off[0]; pos[i * 3 + 1] += off[1]; pos[i * 3 + 2] += off[2]; }
  bb = bbOf();
  const carLen = bb[3] - bb[0], carW = bb[5] - bb[2], carH = bb[4] - bb[1];

  // ---- connected components (union-find over the index buffer): the wheels are 4 disc-shaped islands near the corners --
  const parent = new Int32Array(n); for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < idx0.length; t += 3) { union(idx0[t], idx0[t + 1]); union(idx0[t], idx0[t + 2]); }
  const comps = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); let c = comps.get(r); if (!c) comps.set(r, (c = { verts: [], bb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] })); c.verts.push(i);
    for (let k = 0; k < 3; k++) { c.bb[k] = Math.min(c.bb[k], pos[i * 3 + k]); c.bb[k + 3] = Math.max(c.bb[k + 3], pos[i * 3 + k]); } }
  const wheelCand = [];
  for (const c of comps.values()) {
    const ex = c.bb[3] - c.bb[0], ey = c.bb[4] - c.bb[1], ez = c.bb[5] - c.bb[2], cx = (c.bb[0] + c.bb[3]) / 2, cy = (c.bb[1] + c.bb[4]) / 2, cz = (c.bb[2] + c.bb[5]) / 2;
    const frac = c.verts.length / n;   // a wheel disc: a few hundred of the mesh's verts, roughly round (ex ~ ey), thin along
    if (frac > 0.003 && frac < 0.02 && ex / ey > 0.7 && ex / ey < 1.4 && ez < 0.35 * (ex + ey) / 2 &&   // the axle (z), low and out near a corner
        Math.abs(cx) > carLen * 0.2 && Math.abs(cz) > carW * 0.25 && cy < carH * 0.5)
      wheelCand.push({ c, cx, cy, cz, r: (ex + ey) / 4 });
  }
  const quad = (q) => wheelCand.filter((cc) => Math.sign(cc.cx) === q[0] && Math.sign(cc.cz) === q[1]).sort((a, b) => b.c.verts.length - a.c.verts.length)[0];
  const quads = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(quad);
  let wheels = quads.every(Boolean) ? quads : null;
  // "cleanly separable" also means watertight once pulled out: the wheel arch needs its own backing wall behind the disc, or
  // lifting the disc out leaves a see-through hole (qa/cars-look-test.mjs: a clustered leak from the side caught exactly
  // this - the wheel and body are already two disconnected islands in the source file, so there's no shared seam to check;
  // what matters is whether the body-only shell has an open boundary where the wheel used to sit). A naked edge (one
  // triangle, not two) in the body-only mesh, within about a wheel's radius of a wheel centre, means the arch has no wall.
  if (wheels) {
    const wheelRootsCheck = new Set(wheels.map((ww) => find(ww.c.verts[0])));
    const bodyEdgeCount = new Map(), key = (a, b) => (a < b ? a * n + b : b * n + a);
    for (let t = 0; t < idx0.length; t += 3) { if (wheelRootsCheck.has(find(idx0[t]))) continue;
      for (const [a, b] of [[idx0[t], idx0[t + 1]], [idx0[t + 1], idx0[t + 2]], [idx0[t + 2], idx0[t]]]) { const k = key(a, b); bodyEdgeCount.set(k, (bodyEdgeCount.get(k) || 0) + 1); } }
    let holes = 0;
    for (const [k, cnt] of bodyEdgeCount) { if (cnt !== 1) continue; const a = Math.floor(k / n), b = k % n;
      const mx = (pos[a * 3] + pos[b * 3]) / 2, my = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2;
      if (wheels.some((ww) => Math.hypot(mx - ww.cx, my - ww.cy, mz - ww.cz) < ww.r * 1.3)) holes++; }
    if (holes > 20) { console.log('[prep-car-model] sloyd: wheels are clean islands but the body has ' + holes + ' open edges where they sat (no backing wall behind the arch) - keeping them static'); wheels = null; }
  }
  if (!wheels) console.log('[prep-car-model] sloyd: wheels not cleanly separable (' + wheelCand.length + ' candidate parts), leaving them static in the body mesh');
  const wheelRoots = new Set((wheels || []).map((ww) => find(ww.c.verts[0])));
  const inWheel = (t) => wheelRoots.has(find(idx0[t]));
  const bodyList = [], wheelList = [];
  for (let t = 0; t < idx0.length; t += 3) (inWheel(t) ? wheelList : bodyList).push(idx0[t], idx0[t + 1], idx0[t + 2]);
  let bodyIdx = Uint32Array.from(bodyList), wheelIdx = Uint32Array.from(wheelList);

  // ---- decimate toward the triangle budget (the wheel is drawn 4x, so it's weighted 4x against the budget) ------------
  const bodyTris = bodyIdx.length / 3, wheelTris = wheelIdx.length / 3;
  const ratio = Math.min(1, targetTotalTris / (bodyTris + wheelTris * 4));
  function simplify(ix, want) {
    if (ratio >= 0.98 || ix.length < 300) return ix;
    let s = MeshoptSimplifier.simplify(ix, pos, 3, want, 0.06, [])[0];
    if (s.length > want * 1.3) s = MeshoptSimplifier.simplifySloppy(ix, pos, 3, null, want, 0.1)[0];
    return s;
  }
  bodyIdx = simplify(bodyIdx, Math.max(300, Math.floor(bodyIdx.length * ratio / 3) * 3));
  if (wheels) wheelIdx = simplify(wheelIdx, Math.max(60, Math.floor(wheelIdx.length * ratio / 3) * 3));
  console.log('[prep-car-model] sloyd body', bodyTris, '->', bodyIdx.length / 3, 'wheel', wheelTris, '->', wheelIdx.length / 3, wheels ? '(separated, spins)' : '(static, in body)');

  // ---- shrink the baked texture (sips keeps it square here) -------------------------------------------------------------
  const texSize = lite ? 512 : 1024;
  fs.writeFileSync(`${TMP}/src.png`, tex.getImage());
  execFileSync('sips', ['-s', 'format', 'png', '-Z', String(texSize), `${TMP}/src.png`, '--out', `${TMP}/out.png`], { stdio: 'ignore' });
  const texBytes = fs.readFileSync(`${TMP}/out.png`);

  // ---- compact a (possibly simplified) index array to only the vertices it uses, with an optional recentre --------------
  function compact(ix, offset = [0, 0, 0]) {
    const map = new Map(); const out = new Uint32Array(ix.length); const op = [], on = [], ou = [];
    for (let t = 0; t < ix.length; t++) {
      const o = ix[t]; let m = map.get(o);
      if (m === undefined) { m = map.size; map.set(o, m); op.push(pos[o * 3] - offset[0], pos[o * 3 + 1] - offset[1], pos[o * 3 + 2] - offset[2]); on.push(nor[o * 3], nor[o * 3 + 1], nor[o * 3 + 2]); ou.push(uv[o * 2], uv[o * 2 + 1]); }
      out[t] = m;
    }
    return { idx: out, pos: Float32Array.from(op), nor: Float32Array.from(on), uv: Float32Array.from(ou) };
  }

  // ---- build the output document: a textured body (tint multiplies the texture) + one template wheel at the origin -----
  const out = new Document(); const buf = out.createBuffer(); const root = out.createScene('car'); out.getRoot().setDefaultScene(root);
  const outTex = out.createTexture('sloyd-sedan').setImage(texBytes).setMimeType('image/png');
  const mat = out.createMaterial('paint').setBaseColorTexture(outTex).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.55).setMetallicFactor(0);
  const mkPrim = (g) => { const acc = (arr, type) => out.createAccessor().setArray(arr).setType(type).setBuffer(buf);
    return out.createPrimitive().setAttribute('POSITION', acc(g.pos, 'VEC3')).setAttribute('NORMAL', acc(g.nor, 'VEC3')).setAttribute('TEXCOORD_0', acc(g.uv, 'VEC2')).setIndices(acc(g.idx, 'SCALAR')).setMaterial(mat); };
  const body = compact(bodyIdx);
  root.addChild(out.createNode('body-tex').setMesh(out.createMesh('body-tex').addPrimitive(mkPrim(body))));
  let wheelCenters = [], wheelR = 0.33, wheel = null;
  if (wheels) {
    const tmpl = wheels.slice().sort((a, b) => (b.cx + b.cz * 0.01) - (a.cx + a.cz * 0.01))[0];   // front, +z (kerb) side: the template instance
    wheel = compact(wheelIdx, [tmpl.cx, tmpl.cy, tmpl.cz]);
    root.addChild(out.createNode('wheel-tex').setMesh(out.createMesh('wheel-tex').addPrimitive(mkPrim(wheel))));
    wheelCenters = wheels.map((ww) => [+ww.cx.toFixed(3), +ww.cy.toFixed(3), +ww.cz.toFixed(3)]);
    wheelR = +tmpl.r.toFixed(3);
  }
  root.setExtras({ wheels: wheelCenters, r: wheelR, len: +carLen.toFixed(3), w: +carW.toFixed(3), h: +carH.toFixed(3) });
  await out.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(outFile, out);
  console.log(outFile, 'tris body', body.idx.length / 3, 'wheel', wheels ? wheel.idx.length / 3 + ' (x4 instanced)' : '0 (static)', 'extras', JSON.stringify(root.getExtras()), 'bytes', fs.statSync(outFile).size);
}

const doc = await io.read(inFile);

// average colour of a texture: sips shrinks it to 1x1, then read that pixel
const avgCache = new Map();
function avgColor(tex) {
  if (!tex) return [1, 1, 1];
  if (avgCache.has(tex)) return avgCache.get(tex);
  const f = `${TMP}/t.png`, g = `${TMP}/t1.png`; fs.writeFileSync(f, tex.getImage());
  execFileSync('sips', ['-s', 'format', 'png', '-z', '1', '1', f, '--out', g], { stdio: 'ignore' });
  const b = fs.readFileSync(g); let o = 8, idat = [], ct = 6;
  while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8); if (type === 'IHDR') ct = b[o + 8 + 9]; if (type === 'IDAT') idat.push(b.slice(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = [raw[1], raw[2], raw[3]].map((v) => (ct === 0 ? raw[1] : v) / 255);
  const lin = px.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  avgCache.set(tex, lin); return lin;
}
function classOf(mat, nodeName) {
  const n = (mat?.getName() || '').toLowerCase(), nn = nodeName.toLowerCase();
  if (/glass|glazing/.test(n) && !/lens/.test(n)) return 'glass';
  if (/paint/.test(n)) return 'paint';
  if (/lens|lamp|^tail$/.test(n)) return 'lamp';
  if (/chrome|steel|alumin|brass/.test(n)) return 'metal';
  if (cfgName === 'bus' && /^(white|blue)$/.test(n)) return 'paint';
  void nn; return 'dark';
}
function colorOf(mat) {
  if (!mat) return [0.5, 0.5, 0.5];
  const f = mat.getBaseColorFactor(), a = avgColor(mat.getBaseColorTexture());
  return [f[0] * a[0], f[1] * a[1], f[2] * a[2]];
}

// ---- gather every primitive in the kit frame --------------------------------------------------------------------------
const parts = [];
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
scene.traverse((node) => {
  const mesh = node.getMesh(); if (!mesh) return;
  const M = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), I = prim.getIndices();
    const n = P.getCount(), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), v = [0, 0, 0], w = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      P.getElement(i, v); const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
      const q = CFG.map([x, y, z]); pos.set(q, i * 3);
      if (N) { N.getElement(i, w); const nx = M[0] * w[0] + M[4] * w[1] + M[8] * w[2], ny = M[1] * w[0] + M[5] * w[1] + M[9] * w[2], nz = M[2] * w[0] + M[6] * w[1] + M[10] * w[2], L = Math.hypot(nx, ny, nz) || 1; nor.set(CFG.map([nx / L, ny / L, nz / L]), i * 3); }
    }
    let idx = I ? Uint32Array.from(I.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
    const det = (M[0] * (M[5] * M[10] - M[6] * M[9]) - M[4] * (M[1] * M[10] - M[2] * M[9]) + M[8] * (M[1] * M[6] - M[2] * M[5])) * CFG.det;
    if (det < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    if (/directional tread segment|tread rib|hex lug|rotor fixing|parking sensor|grille inner mesh/i.test(node.getName())) continue;   // sub-centimetre detail: invisible past arm's length
    const mat = prim.getMaterial();
    const cls = classOf(mat, node.getName()); parts.push({ name: node.getName(), cls, color: cls === 'paint' ? [1, 1, 1] : colorOf(mat), pos, nor, idx });
  }
});
const bbOf = (p) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p[i + k]); b[k + 3] = Math.max(b[k + 3], p[i + k]); } return b; };
for (const p of parts) p.bb = bbOf(p.pos);

// ---- normalise: centre on x / z, ground at y 0 ------------------------------------------------------------------------
const all = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const p of parts) for (let k = 0; k < 3; k++) { all[k] = Math.min(all[k], p.bb[k]); all[k + 3] = Math.max(all[k + 3], p.bb[k + 3]); }
const off = [-(all[0] + all[3]) / 2, -all[1], -(all[2] + all[5]) / 2];
for (const p of parts) { for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] += off[0]; p.pos[i + 1] += off[1]; p.pos[i + 2] += off[2]; } p.bb = bbOf(p.pos); }

// ---- wheels: tyres are the big round rubber parts low down; every part inside a tyre's cylinder spins with it -------------
const isTyre = (p) => /tyre carcass|wheel_tire/i.test(p.name);
const wheels = parts.filter(isTyre).map((p) => ({ x: (p.bb[0] + p.bb[3]) / 2, y: (p.bb[1] + p.bb[4]) / 2, z: (p.bb[2] + p.bb[5]) / 2, r: (p.bb[4] - p.bb[1]) / 2, hw: (p.bb[5] - p.bb[2]) / 2 }));
if (wheels.length !== 4) throw new Error('expected 4 tyres, got ' + wheels.length);
for (const p of parts) {
  if (/caliper|brake$/i.test(p.name)) continue;
  const cx = (p.bb[0] + p.bb[3]) / 2, cy = (p.bb[1] + p.bb[4]) / 2, cz = (p.bb[2] + p.bb[5]) / 2;
  const W = wheels.find((w) => Math.hypot(cx - w.x, cy - w.y) < w.r * 1.02 && Math.abs(cz - w.z) < w.hw * 1.6 && (p.bb[4] - p.bb[1]) <= w.r * 2.05 && (p.bb[3] - p.bb[0]) <= w.r * 2.05);
  if (W) p.wheel = W;
}
// ---- groups ----------------------------------------------------------------------------------------------------------
const INTERIOR = /seat|console|carpet|instrument panel|steering|door pull|dashboard|cabin floor|headrest/i, SIGN = /roof sign|sign (front|rear) lettering/i;
const L2 = (all[3] - all[0]) / 2;
function paneName(p) {
  const n = p.name.toLowerCase(), cz = (p.bb[2] + p.bb[5]) / 2, cx = (p.bb[0] + p.bb[3]) / 2;
  if (/windscreen|front windscreen/.test(n)) return 'glassW';
  if (/rear (transparent|window|screen)/.test(n)) return 'glassB';
  const side = cz > 0 ? 'R' : 'L';
  if (/front door/.test(n)) return 'glassF' + side;
  if (/rear door/.test(n)) return 'glassR' + side;
  return cx > 0 ? 'glassF' + side + '_x' : 'glassR' + side + '_x';
}
const buckets = new Map();
const put = (key, p) => { let b = buckets.get(key); if (!b) buckets.set(key, (b = [])); b.push(p); };
// one template wheel: the front right one (+x, +z), moved to the origin
const tmpl = wheels.slice().sort((a, b) => (b.x + b.z * 0.01) - (a.x + a.z * 0.01)).find((w) => w.z > 0);
for (const p of parts) {
  if (p.wheel) { if (p.wheel !== tmpl) continue; for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] -= tmpl.x; p.pos[i + 1] -= tmpl.y; p.pos[i + 2] -= tmpl.z; } put('wheel-' + (p.cls === 'paint' ? 'metal' : p.cls), p); continue; }
  if (cfgName === 'car' && SIGN.test(p.name)) { put('sign-' + (p.cls === 'paint' ? 'lamp' : p.cls), p); continue; }
  if (INTERIOR.test(p.name)) { put('interior-dark', p); continue; }
  if (p.cls === 'glass') { if (cfgName === 'car' && !/seal/i.test(p.name)) { put('pane-' + paneName(p), p); continue; } put('body-glass', p); continue; }
  put('body-' + p.cls, p);
}

// ---- merge each bucket, simplify toward the triangle budget --------------------------------------------------------------
const totalTris = parts.filter((p) => !p.wheel || p.wheel === tmpl).reduce((s, p) => s + p.idx.length / 3, 0) + parts.filter((p) => p.wheel === tmpl).reduce((s, p) => s + p.idx.length, 0);   // the template wheel is drawn 4 times
const ratio = Math.min(1, TARGET / totalTris);
const out = new Document(); const buf = out.createBuffer(); const root = out.createScene('car'); out.getRoot().setDefaultScene(root);
const mats = {};
const matOf = (cls) => mats[cls] || (mats[cls] = out.createMaterial(cls).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(cls === 'metal' ? 0.3 : 0.6).setMetallicFactor(cls === 'metal' ? 0.9 : 0.1));
let outTris = 0;
for (const [key, list] of buckets) {
  let nv = 0, ni = 0; for (const p of list) { nv += p.pos.length / 3; ni += p.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3); let idx = new Uint32Array(ni); let vo = 0, io2 = 0;
  for (const p of list) { const n = p.pos.length / 3; pos.set(p.pos, vo * 3); nor.set(p.nor, vo * 3); for (let i = 0; i < n; i++) col.set(p.color, (vo + i) * 3); for (let i = 0; i < p.idx.length; i++) idx[io2 + i] = p.idx[i] + vo; vo += n; io2 += p.idx.length; }
  const [grp] = key.split('-'), keep = ratio;
  if (keep < 0.98 && idx.length > 300) {
    const want = Math.max(36, Math.floor(idx.length * keep / 3) * 3);
    let s = MeshoptSimplifier.simplify(idx, pos, 3, want, 0.05, [])[0];
    if (s.length > want * 1.3) s = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, want, 0.08)[0];
    if (s.length >= 36 || grp !== 'body') idx = s;
    if (process.env.DBG) console.log(key, ni / 3, '->', idx.length / 3, 'want', want / 3);
  }
  outTris += idx.length / 3 * (grp === 'wheel' ? 4 : 1);
  const acc = (arr, type) => out.createAccessor().setArray(arr).setType(type).setBuffer(buf);
  const prim = out.createPrimitive().setAttribute('POSITION', acc(pos, 'VEC3')).setAttribute('NORMAL', acc(nor, 'VEC3')).setAttribute('COLOR_0', acc(col, 'VEC3')).setIndices(acc(idx, 'SCALAR'));
  if (grp === 'pane') {   // a planar uv over the pane's own bounds (the crack map), u along whichever horizontal axis it spans most
    const b = bbOf(pos), uv = new Float32Array(nv * 2), alongZ = (b[5] - b[2]) > (b[3] - b[0]);
    for (let i = 0; i < nv; i++) { uv[i * 2] = alongZ ? (pos[i * 3 + 2] - b[2]) / (b[5] - b[2] || 1) : (pos[i * 3] - b[0]) / (b[3] - b[0] || 1); uv[i * 2 + 1] = (pos[i * 3 + 1] - b[1]) / (b[4] - b[1] || 1); }
    prim.setAttribute('TEXCOORD_0', acc(uv, 'VEC2'));
  }
  prim.setMaterial(matOf(key.split('-')[1].startsWith('glass') ? 'glass' : key.split('-')[1]));
  const node = out.createNode(key).setMesh(out.createMesh(key).addPrimitive(prim)); root.addChild(node);
}
// the driver's eye: ~0.55 m behind the steering wheel rim and ~0.25 m above it (the game's first-person camera)
const rim = parts.find((p) => /steering (wheel )?rim/i.test(p.name)), eye = rim ? [+((rim.bb[0] + rim.bb[3]) / 2 - 0.55).toFixed(3), +((rim.bb[1] + rim.bb[4]) / 2 + 0.25).toFixed(3), +((rim.bb[2] + rim.bb[5]) / 2).toFixed(3)] : null;
const wl = wheels.map((w) => [+w.x.toFixed(3), +w.y.toFixed(3), +w.z.toFixed(3)]);
root.setExtras({ eye, wheels: wl, r: +tmpl.r.toFixed(3), len: +(all[3] - all[0]).toFixed(3), w: +(all[5] - all[2]).toFixed(3), h: +(all[4] - all[1]).toFixed(3) });
await out.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(outFile, out);
console.log(outFile, 'tris in', totalTris, 'out', outTris, 'buckets', [...buckets.keys()].join(' '), 'extras', JSON.stringify(root.getExtras()), 'bytes', fs.statSync(outFile).size);
fs.rmSync(TMP, { recursive: true, force: true }); void L2;

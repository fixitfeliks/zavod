// CONEY materials: the University material set (brick / precast / glass / asphalt / curb / paint … all generic) plus the seaside
// palette — beach sand, weathered boardwalk planks, the ocean, ride paints matched to the reference photos, painted banner signs,
// roll-down shutters and the terracotta/tile of the old Surf Avenue fronts. CONEY agent.
import * as THREE from 'three';
import { makeMats } from '../sbu/mats.js';

const loader = new THREE.TextureLoader();
function pbrSet(id, res, rep = 1, aniso = 8) {
  const t = (m, srgb) => { const x = loader.load(`./assets/textures/${id}_${m}_${res}.jpg`); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(rep, rep); x.anisotropy = aniso; if (srgb) x.colorSpace = THREE.SRGBColorSpace; return x; };
  return { map: t('Diffuse', true), normalMap: t('nor_gl', false), arm: t('arm', false) };
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const tex = (c, { srgb = true, wrap = true } = {}) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };

export function makeConeyMats(world) {
  const M = makeMats(world); const R = world.R;
  const aniso = Math.min(16, world.ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8);
  const reg = (key, mat, surface, uvScale) => { mat.name = key; M[key] = mat; M.surface[key] = surface; M.uvScale[key] = uvScale; return mat; };
  const std = (p) => new THREE.MeshStandardMaterial(p);

  // ---- beach + boardwalk ---------------------------------------------------------------------------------------------
  { const s = pbrSet('coast_sand_01', '1k', 1, aniso); reg('sand', std({ map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), aoMap: s.arm, roughnessMap: s.arm, roughness: 1, metalness: 0, color: 0xe8dcc4, envMapIntensity: 0.3 }), 'ground', 1 / 3); }
  { const s = pbrSet('coast_sand_01', '1k', 1, aniso); reg('sandWet', std({ map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.35, metalness: 0, color: 0x9c8e76, envMapIntensity: 0.9 }), 'ground', 1 / 3); }
  { const s = pbrSet('weathered_planks', '1k', 1, aniso); reg('planks', std({ map: s.map, normalMap: s.normalMap, aoMap: s.arm, roughnessMap: s.arm, roughness: 1, metalness: 0, color: 0xb7b0a6, envMapIntensity: 0.4 }), 'wood', 1 / 2.4); }
  { const s = pbrSet('weathered_planks', '1k', 1, aniso); reg('planksDark', std({ map: s.map, normalMap: s.normalMap, roughness: 0.9, metalness: 0, color: 0x6e665c }), 'wood', 1 / 2.4); }
  reg('pile', std({ color: 0x4a4036, roughness: 0.95 }), 'wood', 0.5);
  reg('rock', std({ color: 0x5e5a54, roughness: 0.95, flatShading: true }), 'concrete', 0.5);

  // ---- ride / landmark paints (sampled from qa/refs/coney) ------------------------------------------------------------
  reg('wheelGreen', std({ color: 0x78c8ad, roughness: 0.55, metalness: 0.35 }), 'metal', 1);
  reg('wheelPink', std({ color: 0xe9a39a, roughness: 0.55, metalness: 0.35 }), 'metal', 1);
  reg('wheelBrown', std({ color: 0x7a3a2c, roughness: 0.6, metalness: 0.4 }), 'metal', 1);
  reg('wheelBlue', std({ color: 0x2f6fb5, roughness: 0.55, metalness: 0.35 }), 'metal', 1);
  reg('cabinWhite', std({ color: 0xf1ede2, roughness: 0.5, metalness: 0.1 }), 'metal', 1);
  reg('coasterWhite', std({ color: 0xf4f2ec, roughness: 0.65, metalness: 0.05 }), 'wood', 1);
  reg('coasterTrack', std({ color: 0x4b4136, roughness: 0.9 }), 'wood', 1);
  reg('coasterRed', std({ color: 0xc0282a, roughness: 0.45, metalness: 0.4 }), 'metal', 1);
  reg('steelRed', std({ color: 0xc03028, roughness: 0.45, metalness: 0.5 }), 'metal', 1);
  reg('steelOrange', std({ color: 0xe0661e, roughness: 0.45, metalness: 0.5 }), 'metal', 1);
  reg('steelYellow', std({ color: 0xf2c418, roughness: 0.45, metalness: 0.4 }), 'metal', 1);
  reg('pjRed', std({ color: 0xc8322c, roughness: 0.5, metalness: 0.45 }), 'metal', 1);
  reg('pjYellow', std({ color: 0xf4c81c, roughness: 0.55, metalness: 0.2 }), 'metal', 1);
  reg('pjBlue', std({ color: 0x2455a8, roughness: 0.55, metalness: 0.2 }), 'metal', 1);
  reg('bulb', new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe6b0, emissiveIntensity: 1.6, roughness: 0.3 }), 'metal', 1);
  reg('terracotta', std({ color: 0xe8e2d4, roughness: 0.6, metalness: 0 }), 'concrete', 0.5);
  reg('railSteel', std({ color: 0x3f4a44, roughness: 0.7, metalness: 0.5 }), 'metal', 0.5);
  reg('railSteelGreen', std({ color: 0x3e5b4d, roughness: 0.7, metalness: 0.45 }), 'metal', 0.5);

  // ---- shopfronts (sign / shutter / banner atlases, awnings, cornices), Surf Ave sideshow kit, el viaduct paint + soffit ------
  shopfrontMats(M, reg, R, std, canvas, tex);
  elMats(M, reg, R, std, canvas, tex);
  M.signMat = (texture, { emissive = 0.15 } = {}) => new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: emissive, roughness: 0.6, metalness: 0, name: 'sign' });

  // ---- far housing-tower facade: brick with a punched-window grid (4 bays x 4 floors per tile = 11.6 x 11.2 m), used on
  // plain blocks for everything outside the playable area (the full per-bay facade cost ~2M triangles for the backdrop)
  // the near towers' walls (coney/city.js towerWall): buff and rust brick from the shared brick scans, white painted concrete
  reg('brickBuff', Object.assign(M.brickStaller.clone(), { name: 'brickBuff' }), 'concrete', 1 / 1.6); M.brickBuff.color.set(0xe0c9a2);
  reg('brickRust', Object.assign(M.brickRed.clone(), { name: 'brickRust' }), 'concrete', 1 / 1.6); M.brickRust.color.set(0xa8604a);
  reg('concreteWhite', Object.assign(M.concrete.clone(), { name: 'concreteWhite' }), 'concrete', 1 / 2.5); M.concreteWhite.color.set(0xf1efe9);
  for (const [key, base, mortar] of [['towerFarBrown', '#8a5a42', '#6a4432'], ['towerFarRed', '#874a3a', '#653629'], ['towerFarTan', '#b89a7a', '#8e765e'], ['towerFarBuff', '#cdb48e', '#a58e6c']]) {
    const [c, g] = canvas(512, 512); g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '40,24,18' : '200,160,130'},${R() * 0.1})`; g.fillRect(R() * 512, R() * 512, 6 + R() * 10, 3); }
    for (let f = 0; f < 4; f++) { g.fillStyle = mortar; g.fillRect(0, f * 128 + 118, 512, 6); for (let b = 0; b < 4; b++) { const lit = R() < 0.12; g.fillStyle = lit ? '#e8d4a0' : (R() < 0.5 ? '#2a3238' : '#3a444c'); g.fillRect(b * 128 + 30, f * 128 + 30, 68, 70); g.fillStyle = 'rgba(230,230,225,0.8)'; g.fillRect(b * 128 + 26, f * 128 + 100, 76, 5); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(b * 128 + 62, f * 128 + 30, 3, 70); } }
    reg(key, std({ map: tex(c), roughness: 0.9, metalness: 0 }), 'concrete', 1 / 11.6);
  }
  { const [c, g] = canvas(512, 512); g.fillStyle = '#ecebe6'; g.fillRect(0, 0, 512, 512);   // far white high-rise: a slab edge per floor, the recessed balcony strip with glass behind it
    for (let f = 0; f < 4; f++) { const y = f * 128; g.fillStyle = '#f6f5f1'; g.fillRect(0, y + 100, 512, 22); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y + 122, 512, 5);
      g.fillStyle = '#4a5560'; g.fillRect(0, y + 30, 512, 66); for (let b = 0; b < 8; b++) { g.fillStyle = R() < 0.1 ? '#e8d4a0' : (R() < 0.5 ? '#3a4652' : '#56626c'); g.fillRect(b * 64 + 6, y + 36, 52, 58); }
      g.fillStyle = 'rgba(235,235,230,0.9)'; for (let x = 0; x < 512; x += 8) g.fillRect(x, y + 84, 2, 16); g.fillRect(0, y + 82, 512, 3); }
    reg('towerFarWhite', std({ map: tex(c), roughness: 0.85, metalness: 0 }), 'concrete', 1 / 11.6); }
  // ---- storefront fascia colours for the shop rows ------------------------------------------------------------------
  const fas = [0xc8201e, 0xf2c418, 0x1f5fb0, 0x2f9a4a, 0xe8661e, 0xf4f0e6, 0x7a2a8a, 0x1c1c1c];
  fas.forEach((c, i) => reg('fascia' + i, std({ color: c, roughness: 0.6, metalness: 0.1 }), 'metal', 1));
  M.fasciaKeys = fas.map((_, i) => 'fascia' + i);
  // stucco / painted masonry for 1–3 storey amusement-zone buildings
  // painted masonry: greyscale stucco (roller marks, hairline cracks, rust/dirt streaks under the parapet, a darker splash
  // band at the foot) so the per-building tint reads true — the Poly Haven painted-concrete scan is green peeling paint
  { const [c, g] = canvas(512, 512); g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) { const v = 200 + R() * 55; g.fillStyle = `rgba(${v},${v},${v},${0.25 + R() * 0.3})`; g.fillRect(R() * 512, R() * 512, 2 + R() * 5, 2 + R() * 5); }
    for (let i = 0; i < 40; i++) { const x = R() * 512; const L = 40 + R() * 220; const gr = g.createLinearGradient(0, 0, 0, L); gr.addColorStop(0, 'rgba(90,82,70,0.35)'); gr.addColorStop(1, 'rgba(90,82,70,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + R() * 8, L); }
    g.strokeStyle = 'rgba(80,80,80,0.35)'; g.lineWidth = 1; for (let i = 0; i < 14; i++) { g.beginPath(); let x = R() * 512, y = R() * 512; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 30; y += 8 + R() * 18; g.lineTo(x, y); } g.stroke(); }
    const gr = g.createLinearGradient(0, 512, 0, 430); gr.addColorStop(0, 'rgba(70,64,56,0.45)'); gr.addColorStop(1, 'rgba(70,64,56,0)'); g.fillStyle = gr; g.fillRect(0, 430, 512, 82);
    const st = tex(c);
    [0xfff4df, 0xf2dcb4, 0xdcecef, 0xfbe2d2, 0xd6e6cc, 0xffffff].forEach((col, i) => reg('paintWall' + i, std({ map: st, color: col, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 }), 'concrete', 1 / 4));
    reg('ssStucco', std({ map: st, color: 0xd8d3c5, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 }), 'concrete', 1 / 4); }
  M.paintWallKeys = [0, 1, 2, 3, 4, 5].map((i) => 'paintWall' + i);
  return M;
}

// =====================================================================================================================
// SHOPFRONT + SIDESHOW + EL MATERIALS (critic r7 #3/#5/#9, placeholder flags 1–3). Everything that repeats across hundreds of
// units lives in ONE atlas texture per material (per-unit UV rects pick the cell), so the whole shop strip stays a handful of
// draw calls: signAtlas (16 painted signs), shutterAtlas (8 graffiti + 8 clean galvanised shutters), ssBanner (12 hand-painted
// sideshow banners), ssFrieze (repeating mural frieze). Generic words only — no real business names.
const FONT_FAT = '"Phosphate", "Impact", "Arial Black", sans-serif';
const FONT_SLAB = '"Rockwell", "American Typewriter", "Georgia", serif';
const FONT_HAND = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive';

function fitFont(g, text, font, weight, maxW, maxPx) { let px = maxPx; g.font = `${weight} ${px}px ${font}`; const w = g.measureText(text).width; if (w > maxW) { px = Math.floor(px * maxW / w); g.font = `${weight} ${px}px ${font}`; } return px; }
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function star(g, cx, cy, r0, r1, n = 5, rot = -Math.PI / 2) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r1 : r0, a = rot + i * Math.PI / n; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); }

/** Procedural pictograms for the painted signs, drawn in a box centred at (cx,cy) of size s. */
function picto(g, kind, cx, cy, s) {
  g.save(); g.translate(cx, cy); g.lineJoin = 'round'; g.lineCap = 'round';
  const O = (w = s * 0.035) => { g.strokeStyle = '#1b1712'; g.lineWidth = w; g.stroke(); };
  switch (kind) {
    case 'hotdog': g.rotate(-0.25); rrect(g, -s * 0.46, -s * 0.12, s * 0.92, s * 0.3, s * 0.15); g.fillStyle = '#e0a458'; g.fill(); O();
      rrect(g, -s * 0.5, -s * 0.2, s * 1.0, s * 0.18, s * 0.09); g.fillStyle = '#b8402a'; g.fill(); O();
      g.beginPath(); for (let i = 0; i <= 8; i++) g.lineTo(-s * 0.38 + i * s * 0.095, -s * 0.11 + (i % 2 ? -1 : 1) * s * 0.04); g.strokeStyle = '#f6d21c'; g.lineWidth = s * 0.04; g.stroke(); break;
    case 'cone': g.beginPath(); g.moveTo(-s * 0.2, -s * 0.02); g.lineTo(s * 0.2, -s * 0.02); g.lineTo(0, s * 0.48); g.closePath(); g.fillStyle = '#d99a4a'; g.fill(); O();
      g.save(); g.clip(); g.strokeStyle = 'rgba(120,60,20,0.7)'; g.lineWidth = s * 0.02; for (let i = -6; i < 6; i++) { g.beginPath(); g.moveTo(i * s * 0.08, -s * 0.1); g.lineTo(i * s * 0.08 + s * 0.5, s * 0.5); g.stroke(); g.beginPath(); g.moveTo(i * s * 0.08, -s * 0.1); g.lineTo(i * s * 0.08 - s * 0.5, s * 0.5); g.stroke(); } g.restore();
      g.beginPath(); g.arc(0, -s * 0.12, s * 0.22, 0, 7); g.fillStyle = '#f7c6d4'; g.fill(); O(); g.beginPath(); g.arc(0, -s * 0.34, s * 0.16, 0, 7); g.fillStyle = '#fbf3e4'; g.fill(); O();
      g.beginPath(); g.arc(s * 0.02, -s * 0.5, s * 0.05, 0, 7); g.fillStyle = '#c8201e'; g.fill(); break;
    case 'clam': g.beginPath(); g.moveTo(0, s * 0.3); g.arc(0, s * 0.3, s * 0.48, Math.PI * 1.08, Math.PI * 1.92); g.closePath(); g.fillStyle = '#f2dcc0'; g.fill(); O();
      for (let i = 1; i < 7; i++) { const a = Math.PI * (1.08 + 0.84 * i / 7); g.beginPath(); g.moveTo(0, s * 0.3); g.lineTo(Math.cos(a) * s * 0.48, s * 0.3 + Math.sin(a) * s * 0.48); g.strokeStyle = '#b07a58'; g.lineWidth = s * 0.025; g.stroke(); }
      rrect(g, -s * 0.12, s * 0.24, s * 0.24, s * 0.12, s * 0.04); g.fillStyle = '#d6a888'; g.fill(); O(); break;
    case 'fries': for (let i = 0; i < 7; i++) { g.save(); g.translate(-s * 0.2 + i * s * 0.066, -s * 0.05); g.rotate((i - 3) * 0.08); g.fillStyle = i % 2 ? '#f7d23a' : '#f1c21c'; g.fillRect(-s * 0.025, -s * 0.38, s * 0.05, s * 0.4); g.strokeStyle = '#8a6a10'; g.lineWidth = s * 0.012; g.strokeRect(-s * 0.025, -s * 0.38, s * 0.05, s * 0.4); g.restore(); }
      g.beginPath(); g.moveTo(-s * 0.3, -s * 0.08); g.lineTo(s * 0.3, -s * 0.08); g.lineTo(s * 0.22, s * 0.46); g.lineTo(-s * 0.22, s * 0.46); g.closePath(); g.fillStyle = '#c8201e'; g.fill(); O();
      star(g, 0, s * 0.18, s * 0.12, s * 0.05); g.fillStyle = '#fff4d0'; g.fill(); break;
    case 'beer': rrect(g, -s * 0.24, -s * 0.28, s * 0.4, s * 0.72, s * 0.05); g.fillStyle = '#f0a81c'; g.fill(); O();
      g.beginPath(); g.arc(s * 0.2, s * 0.06, s * 0.14, -1.3, 1.3); g.strokeStyle = '#1b1712'; g.lineWidth = s * 0.07; g.stroke(); g.strokeStyle = '#f7f1e0'; g.lineWidth = s * 0.035; g.stroke();
      for (const [x, r] of [[-0.18, 0.12], [-0.04, 0.14], [0.1, 0.12]]) { g.beginPath(); g.arc(x * s, -s * 0.3, r * s, 0, 7); g.fillStyle = '#fffaf0'; g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(-s * 0.12 + (i % 3) * s * 0.1, s * 0.3 - i * s * 0.08, s * 0.02, 0, 7); g.fill(); } break;
    case 'pizza': g.beginPath(); g.moveTo(-s * 0.42, -s * 0.3); g.lineTo(s * 0.42, -s * 0.3); g.lineTo(0, s * 0.46); g.closePath(); g.fillStyle = '#f2c14a'; g.fill(); O();
      rrect(g, -s * 0.46, -s * 0.4, s * 0.92, s * 0.14, s * 0.07); g.fillStyle = '#c47a34'; g.fill(); O();
      for (const [x, y] of [[-0.15, -0.12], [0.14, -0.1], [0, 0.1], [-0.02, -0.18]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.07, 0, 7); g.fillStyle = '#b8281e'; g.fill(); } break;
    case 'lemon': g.beginPath(); g.ellipse(0, 0, s * 0.42, s * 0.3, -0.3, 0, 7); g.fillStyle = '#f6dc2a'; g.fill(); O();
      g.beginPath(); g.ellipse(s * 0.18, -s * 0.34, s * 0.16, s * 0.07, -0.6, 0, 7); g.fillStyle = '#3a9a3a'; g.fill(); O(s * 0.02); break;
    case 'star': star(g, 0, 0, s * 0.46, s * 0.2); g.fillStyle = '#f6d21c'; g.fill(); O(); star(g, 0, 0, s * 0.26, s * 0.11); g.fillStyle = '#fff6c8'; g.fill(); break;
    case 'target': for (const [r, c] of [[0.46, '#1a3d8f'], [0.36, '#fff4d0'], [0.26, '#c8201e'], [0.16, '#fff4d0'], [0.07, '#1a3d8f']]) { g.beginPath(); g.arc(0, 0, r * s, 0, 7); g.fillStyle = c; g.fill(); } g.beginPath(); g.arc(0, 0, s * 0.46, 0, 7); O(); break;
    case 'joystick': rrect(g, -s * 0.4, s * 0.12, s * 0.8, s * 0.3, s * 0.06); g.fillStyle = '#2a2a2a'; g.fill(); O();
      g.fillStyle = '#9a9a9a'; g.fillRect(-s * 0.03, -s * 0.2, s * 0.06, s * 0.34); g.beginPath(); g.arc(0, -s * 0.26, s * 0.14, 0, 7); g.fillStyle = '#d6201e'; g.fill(); O();
      for (const x of [0.18, 0.3]) { g.beginPath(); g.arc(x * s, s * 0.27, s * 0.05, 0, 7); g.fillStyle = x > 0.2 ? '#f6d21c' : '#2a8ad6'; g.fill(); } break;
    case 'dice': for (const [dx, rot, col] of [[-0.18, -0.2, '#fbf8f0'], [0.2, 0.25, '#c8201e']]) { g.save(); g.translate(dx * s, 0); g.rotate(rot); rrect(g, -s * 0.2, -s * 0.2, s * 0.4, s * 0.4, s * 0.06); g.fillStyle = col; g.fill(); O();
      g.fillStyle = col === '#c8201e' ? '#fff' : '#1b1712'; for (const [x, y] of [[-1, -1], [1, 1], [0, 0], [1, -1], [-1, 1]]) { g.beginPath(); g.arc(x * s * 0.1, y * s * 0.1, s * 0.035, 0, 7); g.fill(); } g.restore(); } break;
    case 'tshirt': g.beginPath(); g.moveTo(-s * 0.14, -s * 0.36); g.lineTo(-s * 0.42, -s * 0.22); g.lineTo(-s * 0.32, s * 0.0); g.lineTo(-s * 0.22, -s * 0.06); g.lineTo(-s * 0.22, s * 0.42); g.lineTo(s * 0.22, s * 0.42); g.lineTo(s * 0.22, -s * 0.06); g.lineTo(s * 0.32, 0); g.lineTo(s * 0.42, -s * 0.22); g.lineTo(s * 0.14, -s * 0.36); g.quadraticCurveTo(0, -s * 0.22, -s * 0.14, -s * 0.36); g.closePath(); g.fillStyle = '#2a7fd0'; g.fill(); O();
      star(g, 0, s * 0.08, s * 0.12, s * 0.05); g.fillStyle = '#f6d21c'; g.fill(); break;
    case 'dollar': g.beginPath(); g.arc(0, 0, s * 0.44, 0, 7); g.fillStyle = '#2f8a3a'; g.fill(); O(); g.fillStyle = '#f4f0dc'; g.font = `bold ${s * 0.62 | 0}px ${FONT_SLAB}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, s * 0.03); break;
    case 'corndog': g.strokeStyle = '#d9c090'; g.lineWidth = s * 0.06; g.beginPath(); g.moveTo(s * 0.1, s * 0.46); g.lineTo(-s * 0.02, s * 0.1); g.stroke();
      g.beginPath(); g.ellipse(-s * 0.08, -s * 0.12, s * 0.15, s * 0.32, 0.25, 0, 7); g.fillStyle = '#c9822e'; g.fill(); O();
      g.beginPath(); for (let i = 0; i <= 6; i++) g.lineTo(-s * 0.12 + (i % 2 ? 1 : -1) * s * 0.05 + i * s * 0.015, -s * 0.38 + i * s * 0.09); g.strokeStyle = '#c8201e'; g.lineWidth = s * 0.035; g.stroke(); break;
    case 'fish': g.beginPath(); g.moveTo(-s * 0.42, 0); g.quadraticCurveTo(-s * 0.05, -s * 0.34, s * 0.26, 0); g.lineTo(s * 0.46, -s * 0.2); g.lineTo(s * 0.46, s * 0.2); g.lineTo(s * 0.26, 0); g.quadraticCurveTo(-s * 0.05, s * 0.34, -s * 0.42, 0); g.closePath(); g.fillStyle = '#4aa0c8'; g.fill(); O();
      g.beginPath(); g.arc(-s * 0.26, -s * 0.04, s * 0.04, 0, 7); g.fillStyle = '#1b1712'; g.fill(); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = s * 0.02; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-s * 0.02 + i * s * 0.08, 0, s * 0.12, -0.9, 0.9); g.stroke(); } break;
    case 'gift': rrect(g, -s * 0.34, -s * 0.1, s * 0.68, s * 0.5, s * 0.03); g.fillStyle = '#c8201e'; g.fill(); O(); rrect(g, -s * 0.4, -s * 0.22, s * 0.8, s * 0.14, s * 0.03); g.fillStyle = '#e8352a'; g.fill(); O();
      g.fillStyle = '#f6d21c'; g.fillRect(-s * 0.06, -s * 0.22, s * 0.12, s * 0.62); g.beginPath(); g.ellipse(-s * 0.13, -s * 0.3, s * 0.13, s * 0.07, -0.4, 0, 7); g.ellipse(s * 0.13, -s * 0.3, s * 0.13, s * 0.07, 0.4, 0, 7); g.fill(); O(s * 0.02); break;
  }
  g.restore();
}

function weather(g, x, y, w, h, R, amt = 1) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = `rgba(255,250,235,${0.05 + R() * 0.08 * amt})`; g.fillRect(x, y, w, h);                                 // sun fade
  const gr = g.createLinearGradient(0, y + h * 0.55, 0, y + h); gr.addColorStop(0, 'rgba(60,48,32,0)'); gr.addColorStop(1, `rgba(60,48,32,${0.22 * amt})`); g.fillStyle = gr; g.fillRect(x, y, w, h);
  for (let i = 0; i < 60 * amt; i++) { g.fillStyle = R() < 0.6 ? `rgba(245,240,225,${0.3 + R() * 0.4})` : `rgba(40,30,20,${0.15 + R() * 0.2})`; const s = 1 + R() * 4; g.fillRect(x + R() * w, y + R() * h, s, s * (0.5 + R())); }   // chips
  for (const bx of [x + 14, x + w - 14]) { g.fillStyle = '#3a342c'; g.beginPath(); g.arc(bx, y + 14, 3.5, 0, 7); g.fill(); const L = 20 + R() * 60; const r = g.createLinearGradient(0, y + 14, 0, y + 14 + L); r.addColorStop(0, 'rgba(120,62,24,0.55)'); r.addColorStop(1, 'rgba(120,62,24,0)'); g.fillStyle = r; g.fillRect(bx - 2, y + 16, 4, L); }
  g.restore();
}

const SIGNS = [
  ['HOT DOGS', 'hotdog', 'FRESH OFF THE GRILL', ['#f6c71c', '#c8201e', '#1f5e3a'], 0],
  ['CLAMS', 'clam', 'STEAMED · FRIED · RAW', ['#1f4f8f', '#fff4dc', '#c8201e'], 2],
  ['ARCADE', 'joystick', 'OPEN LATE · ALL AGES', ['#3a1f6e', '#ffd21c', '#e8352a'], 1],
  ['GAMES', 'dice', 'PLAY  ·  WIN  ·  PLAY', ['#c8201e', '#ffe36a', '#1a2a5a'], 1],
  ['SOUVENIRS', 'gift', 'GIFTS · HATS · POSTCARDS', ['#1f7a78', '#fff4dc', '#f6c71c'], 3],
  ['ICE CREAM', 'cone', 'SOFT SERVE · SHAKES', ['#f7c6d4', '#7a3a2a', '#2a7fd0'], 3],
  ['COLD BEER', 'beer', 'ON TAP · ICE COLD', ['#1f5e3a', '#fff4dc', '#f6c71c'], 2],
  ['FRIES', 'fries', 'HAND CUT DAILY', ['#ffd21c', '#c8201e', '#1b1712'], 0],
  ['SKEE-BALL', 'target', 'ROLL · SCORE · WIN', ['#1a3d8f', '#ffd21c', '#c8201e'], 1],
  ['BAR & GRILL', 'beer', 'WINGS · DRAFTS · GAME ON TV', ['#141414', '#f6c71c', '#c8201e'], 2],
  ['RESTAURANT', 'fish', 'RUSSIAN · GEORGIAN · LIVE MUSIC', ['#5a1a2a', '#f3d9a4', '#d4aa46'], 3],
  ['PIZZA', 'pizza', 'BY THE SLICE', ['#1f5e3a', '#fff4dc', '#c8201e'], 3],
  ['LEMONADE', 'lemon', 'FRESH SQUEEZED', ['#fff08a', '#2f7a3a', '#e8a01c'], 0],
  ['TACOS', 'corndog', 'BURRITOS · MICHELADAS', ['#1f7a3a', '#fff4dc', '#e8352a'], 1],
  ['CORN DOGS', 'corndog', 'HOT · FRESH · CRISPY', ['#e8661e', '#fff4dc', '#1b1712'], 1],
  ['SEAFOOD', 'fish', 'SHRIMP · CALAMARI · CRAB', ['#2a7fd0', '#fff4dc', '#1f3a6a'], 3],
];

/** one 1024x256 painted sign in the atlas cell (x,y) */
function drawSign(g, x, y, W, H, [word, pic, sub, P, style], R) {
  g.save(); g.beginPath(); g.rect(x, y, W, H); g.clip();
  const [bg, fg, ac] = P;
  if (style === 1) { // sunburst
    g.fillStyle = bg; g.fillRect(x, y, W, H); const cx = x + W / 2, cy = y + H * 1.1;
    for (let i = 0; i < 36; i++) { const a0 = Math.PI + i * Math.PI / 36, a1 = a0 + Math.PI / 72; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, W, a0, a1); g.closePath(); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill(); }
  } else if (style === 2) { // split panel
    g.fillStyle = bg; g.fillRect(x, y, W, H); g.fillStyle = ac; g.fillRect(x, y, H * 1.05, H); g.fillStyle = fg; g.fillRect(x + H * 1.05, y + H - 26, W, 10);
  } else if (style === 3) { // gradient script
    const gr = g.createLinearGradient(0, y, 0, y + H); gr.addColorStop(0, bg); gr.addColorStop(1, shade(bg, -0.25)); g.fillStyle = gr; g.fillRect(x, y, W, H);
  } else { g.fillStyle = bg; g.fillRect(x, y, W, H); }
  // border: painted rim + bulb dots
  g.lineWidth = 12; g.strokeStyle = style === 2 ? fg : ac; rrect(g, x + 10, y + 10, W - 20, H - 20, 22); g.stroke();
  if (style !== 2) { for (let i = 0; i < 26; i++) { const t = i / 25; for (const yy of [y + 10, y + H - 10]) { g.beginPath(); g.arc(x + 30 + t * (W - 60), yy, 5, 0, 7); g.fillStyle = '#fff6d0'; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.5; g.stroke(); } } }
  // pictogram(s)
  const ps = H * 0.72; const pcx = style === 2 ? x + H * 0.52 : x + H * 0.6;
  if (style !== 2) { g.beginPath(); g.arc(pcx, y + H / 2, ps * 0.62, 0, 7); g.fillStyle = shade(bg, 0.35); g.fill(); g.lineWidth = 6; g.strokeStyle = ac; g.stroke(); }
  picto(g, pic, pcx, y + H / 2, ps * (style === 2 ? 0.95 : 0.8));
  if (style === 1) picto(g, pic, x + W - H * 0.6, y + H / 2, ps * 0.8);
  // word: drop shadow + outline + fill
  const tx0 = style === 2 ? x + H * 1.05 + 20 : x + H * 1.2, tx1 = style === 1 ? x + W - H * 1.2 : x + W - 30, tcx = (tx0 + tx1) / 2;
  const font = style === 3 ? FONT_SLAB : style === 1 ? FONT_FAT : FONT_FAT;
  const px = fitFont(g, word, font, style === 3 ? 'italic bold' : 'bold', tx1 - tx0 - 20, 128);
  g.textAlign = 'center'; g.textBaseline = 'middle'; const ty = y + H * 0.43;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(word, tcx + 6, ty + 7);
  g.lineWidth = px * 0.12; g.strokeStyle = style === 2 ? '#1b1712' : ac; g.strokeText(word, tcx, ty);
  g.fillStyle = fg; g.fillText(word, tcx, ty);
  // highlight sheen on the upper half of the letters
  g.save(); g.beginPath(); g.rect(x, ty - px * 0.5, W, px * 0.22); g.clip(); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillText(word, tcx, ty); g.restore();
  // sub line
  g.font = `bold ${Math.round(H * 0.12)}px ${FONT_SLAB}`; g.fillStyle = style === 2 ? '#1b1712' : fg; g.globalAlpha = 0.9; g.fillText(sub, tcx, y + H * 0.8); g.globalAlpha = 1;
  weather(g, x, y, W, H, R, 1);
  g.restore();
}

function shade(hex, k) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))); return `rgb(${f(r)},${f(gg)},${f(b)})`; }

/** galvanised roll-down shutter in a cell: slats, bottom bar, grime; tag = graffiti variant index or -1 */
function drawShutter(g, x, y, S, tag, R) {
  g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
  const tone = 160 + (R() * 18 | 0); g.fillStyle = `rgb(${tone},${tone + 2},${tone + 1})`; g.fillRect(x, y, S, S);
  for (let yy = 0; yy < S; yy += 16) { g.fillStyle = 'rgba(30,32,32,0.55)'; g.fillRect(x, y + yy + 13, S, 3); g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(x, y + yy, S, 2); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, y + yy + 8, S, 5); }
  for (let i = 0; i < 26; i++) { const sx = x + R() * S, L = 40 + R() * 260; const gr = g.createLinearGradient(0, y, 0, y + L); gr.addColorStop(0, `rgba(70,60,48,${0.1 + R() * 0.12})`); gr.addColorStop(1, 'rgba(70,60,48,0)'); g.fillStyle = gr; g.fillRect(sx, y, 3 + R() * 10, L); }
  const gb = g.createLinearGradient(0, y + S * 0.75, 0, y + S); gb.addColorStop(0, 'rgba(60,52,40,0)'); gb.addColorStop(1, 'rgba(60,52,40,0.35)'); g.fillStyle = gb; g.fillRect(x, y + S * 0.75, S, S * 0.25);
  g.fillStyle = '#6a6c6a'; g.fillRect(x, y + S - 22, S, 22); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x, y + S - 22, S, 3);   // bottom bar
  g.fillStyle = '#4a4c4a'; for (const hx of [x + S * 0.3, x + S * 0.7]) g.fillRect(hx - 10, y + S - 30, 20, 10);                  // lock handles
  if (tag >= 0) graffiti(g, x, y, S, tag, R);
  else if (R() < 0.6) { // a stray sticker / small marker tag / old poster scrap
    const px = x + 40 + R() * (S - 160), py = y + 120 + R() * (S - 300);
    if (R() < 0.5) { g.fillStyle = ['#f4f0e6', '#f6d21c', '#e8e0cc'][(R() * 3) | 0]; g.save(); g.translate(px, py); g.rotate((R() - 0.5) * 0.2); g.fillRect(0, 0, 70 + R() * 50, 90 + R() * 40); g.fillStyle = 'rgba(30,30,30,0.6)'; for (let k = 0; k < 6; k++) g.fillRect(8, 12 + k * 12, 40 + R() * 40, 4); g.restore(); }
    else { g.font = `bold ${30 + R() * 20 | 0}px ${FONT_HAND}`; g.fillStyle = '#1b1b1b'; g.fillText(['ZEK', 'MOS', 'RAF', 'KLU', 'TOB'][(R() * 5) | 0], px, py); }
  }
  g.restore();
}

const TAGS = ['KAZER', 'ZOOT', 'SKEW', 'REMO', 'BLAZE', 'DUSK', 'NEKO', 'WAVY'];
function graffiti(g, x, y, S, v, R) {
  const cols = [['#e8352a', '#f6d21c', '#1b1b1b'], ['#2a7fd0', '#f4f4f4', '#101828'], ['#3ab04a', '#fff27a', '#101010'], ['#c03aa8', '#7ad8f0', '#1b1b1b'], ['#f08a1c', '#2a2a2a', '#fff'], ['#f4f4f4', '#1b1b1b', '#e8352a'], ['#6a3ad0', '#f6d21c', '#fff'], ['#1b1b1b', '#e8e8e8', '#e8352a']][v];
  const word = TAGS[v]; const cx = x + S / 2, cy = y + S * (0.4 + R() * 0.2);
  g.save(); g.translate(cx, cy); g.rotate((R() - 0.5) * 0.25);
  if (v % 4 === 3) { // simple handstyle tag scrawl + crown / arrows
    g.font = `bold ${S * 0.22 | 0}px ${FONT_HAND}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = cols[0]; g.strokeText(word, 0, 0); g.fillStyle = cols[2]; g.fillText(word, 0, 0);
    g.beginPath(); g.moveTo(-S * 0.3, S * 0.12); g.bezierCurveTo(-S * 0.1, S * 0.2, S * 0.1, S * 0.05, S * 0.36, S * 0.14); g.lineTo(S * 0.3, S * 0.1); g.moveTo(S * 0.36, S * 0.14); g.lineTo(S * 0.3, S * 0.19); g.strokeStyle = cols[0]; g.lineWidth = 7; g.stroke();
    g.beginPath(); g.moveTo(-S * 0.12, -S * 0.14); g.lineTo(-S * 0.08, -S * 0.22); g.lineTo(-S * 0.03, -S * 0.15); g.lineTo(S * 0.02, -S * 0.23); g.lineTo(S * 0.07, -S * 0.15); g.strokeStyle = cols[0]; g.lineWidth = 5; g.stroke();
  } else { // throw-up / piece: fat letters, fill + highlight + outline + 3D shadow + drips + spray halo
    const px = fitFont(g, word, FONT_FAT, 'bold', S * 0.8, S * 0.34); g.textAlign = 'center'; g.textBaseline = 'middle';
    // per-letter layout: overlapping, bouncing, each letter tilted and scaled a little (hand-sprayed, not typeset)
    const ws = [...word].map((ch) => g.measureText(ch).width * 0.86); const tot = ws.reduce((a, b) => a + b, 0); let lx = -tot / 2;
    const L = [...word].map((ch, k) => { const o = { ch, x: lx + ws[k] / 2, y: (R() - 0.5) * px * 0.22, r: (R() - 0.5) * 0.35, s: 0.9 + R() * 0.25 }; lx += ws[k]; return o; });
    const each = (fn) => { for (const o of L) { g.save(); g.translate(o.x, o.y); g.rotate(o.r); g.scale(o.s, o.s); fn(o.ch); g.restore(); } };
    g.shadowColor = cols[0]; g.shadowBlur = 18; g.fillStyle = cols[0]; each((ch) => g.fillText(ch, 6, 8)); g.shadowBlur = 0;   // spray halo
    g.fillStyle = cols[2]; each((ch) => g.fillText(ch, 10, 11));                                                                 // 3D drop
    g.lineWidth = px * 0.14; g.strokeStyle = cols[2]; each((ch) => g.strokeText(ch, 0, 0));
    const gr = g.createLinearGradient(0, -px / 2, 0, px / 2); gr.addColorStop(0, cols[1]); gr.addColorStop(0.55, cols[0]); gr.addColorStop(1, shade(cols[0].length === 7 ? cols[0] : '#888888', -0.3)); g.fillStyle = gr; each((ch) => g.fillText(ch, 0, 0));
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3; for (let k = 0; k < 5; k++) { const hx = (R() - 0.5) * S * 0.7, hy = -px * 0.25; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + 10, hy - 4); g.stroke(); }
    g.fillStyle = cols[0]; for (let k = 0; k < 7; k++) { const dx = (R() - 0.5) * S * 0.75, L = 20 + R() * 70; g.fillRect(dx, px * 0.3, 4, L); g.beginPath(); g.arc(dx + 2, px * 0.3 + L, 4, 0, 7); g.fill(); }
    if (v === 1 || v === 5) { g.font = `bold ${S * 0.07 | 0}px ${FONT_HAND}`; g.fillStyle = cols[2]; g.fillText(['CREW', '2026', 'NYC', 'BK'][(R() * 4) | 0], S * 0.28, px * 0.62); }
  }
  g.restore();
}

/** 2.4 x 3 m hand-painted sideshow banner (generic acts, no real names) */
const ACTS = [['FIRE', 'EATER', 'flame'], ['SNAKE', 'CHARMER', 'snake'], ['STRONG', 'MAN', 'barbell'], ['SWORD', 'SWALLOWER', 'sword'], ['ESCAPE', 'ARTIST', 'chain'], ['HUMAN', 'BLOCKHEAD', 'hammer'],
  ['MAGIC &', 'ILLUSION', 'hat'], ['THE', 'MERMAID', 'tail'], ['THE', 'GIANT', 'giant'], ['TEN IN', 'ONE', 'stars'], ['ELECTRA', 'LIVE!', 'bolt'], ['WONDERS', 'ALIVE', 'eye']];
function drawBanner(g, x, y, W, H, i, R) {
  g.save(); g.beginPath(); g.rect(x, y, W, H); g.clip();
  const pal = [['#c8201e', '#f6d21c', '#1a3d8f'], ['#1a3d8f', '#f6e8b0', '#c8201e'], ['#e8661e', '#fff2c8', '#1b1712'], ['#2f7a3a', '#f6d21c', '#c8201e']][i % 4];
  g.fillStyle = pal[0]; g.fillRect(x, y, W, H);
  g.fillStyle = pal[1]; rrect(g, x + 22, y + 22, W - 44, H - 44, 18); g.fill();
  // scalloped inner frame
  g.strokeStyle = pal[2]; g.lineWidth = 6; rrect(g, x + 36, y + 36, W - 72, H - 72, 14); g.stroke();
  const [t1, t2, fig] = ACTS[i];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const hand = (txt, cy, maxPx, col) => { const px = fitFont(g, txt, FONT_FAT, 'bold', W - 110, maxPx); g.save(); g.translate(x + W / 2, cy); g.rotate((R() - 0.5) * 0.06); g.lineWidth = px * 0.14; g.strokeStyle = '#1b1712'; g.strokeText(txt, 0, 0); g.fillStyle = col; g.fillText(txt, 0, 0); g.restore(); };
  hand(t1, y + 92, 84, pal[0]); hand(t2, y + 170, 84, pal[2]);
  // painted figure
  const cx = x + W / 2, cy = y + H * 0.6; g.save(); g.translate(cx, cy); g.lineJoin = 'round'; g.lineCap = 'round';
  const skin = ['#e8b48a', '#b07a52', '#f0c8a0', '#8a5a3a'][(i * 3) % 4];
  const body = () => { g.fillStyle = pal[2]; g.beginPath(); g.moveTo(-46, -30); g.lineTo(46, -30); g.lineTo(58, 110); g.lineTo(-58, 110); g.closePath(); g.fill(); g.strokeStyle = '#1b1712'; g.lineWidth = 4; g.stroke();
    g.fillStyle = skin; g.beginPath(); g.arc(0, -66, 34, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#1b1712'; g.beginPath(); g.arc(-12, -70, 4, 0, 7); g.arc(12, -70, 4, 0, 7); g.fill(); g.beginPath(); g.arc(0, -56, 12, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = ['#2a1a10', '#c8a040', '#1b1712', '#8a2a1a'][i % 4]; g.beginPath(); g.arc(0, -78, 34, Math.PI, 0); g.fill(); };
  const arm = (a, L = 80) => { g.strokeStyle = skin; g.lineWidth = 16; g.beginPath(); g.moveTo(Math.sign(Math.cos(a)) * 40, -20); g.lineTo(Math.sign(Math.cos(a)) * 40 + Math.cos(a) * L, -20 + Math.sin(a) * L); g.stroke(); };
  switch (fig) {
    case 'flame': body(); arm(-1.1); arm(-2.0); for (let k = 0; k < 5; k++) { g.fillStyle = ['#f6d21c', '#e8661e', '#c8201e'][k % 3]; g.beginPath(); g.ellipse(-30 + k * 15, -150 - (k % 2) * 20, 14, 40, 0, 0, 7); g.fill(); } break;
    case 'snake': body(); g.strokeStyle = '#3a9a3a'; g.lineWidth = 18; g.beginPath(); g.moveTo(-90, 80); g.bezierCurveTo(-120, -20, 100, 20, 60, -40); g.bezierCurveTo(30, -90, -80, -60, -60, -120); g.stroke(); g.strokeStyle = '#f6d21c'; g.lineWidth = 4; g.setLineDash([8, 10]); g.stroke(); g.setLineDash([]); break;
    case 'barbell': body(); arm(-1.3, 90); arm(-1.85, 90); g.fillStyle = '#1b1712'; g.fillRect(-150, -120, 300, 12); for (const s of [-1, 1]) { g.beginPath(); g.arc(s * 140, -114, 38, 0, 7); g.fill(); } break;
    case 'sword': body(); g.save(); g.rotate(0.1); g.fillStyle = '#d8dce0'; g.fillRect(-6, -230, 12, 180); g.fillStyle = '#c8a040'; g.fillRect(-30, -240, 60, 12); g.restore(); arm(-1.5, 70); break;
    case 'chain': body(); g.strokeStyle = '#8a8c8a'; g.lineWidth = 8; for (let k = 0; k < 9; k++) { g.beginPath(); g.ellipse(-80 + k * 20, 20 + Math.sin(k) * 20, 12, 7, k % 2 ? 0 : 1.2, 0, 7); g.stroke(); } break;
    case 'hammer': body(); arm(-0.6, 80); g.fillStyle = '#6a4a2a'; g.fillRect(90, -130, 12, 90); g.fillStyle = '#4a4c4a'; g.fillRect(70, -140, 52, 24); g.fillStyle = '#c0c4c8'; g.fillRect(-4, -130, 6, 40); break;
    case 'hat': body(); g.fillStyle = '#1b1712'; g.fillRect(-36, -150, 72, 60); g.fillRect(-52, -96, 104, 10); arm(-0.4, 90); g.strokeStyle = '#1b1712'; g.lineWidth = 8; g.beginPath(); g.moveTo(120, -60); g.lineTo(160, -120); g.stroke(); star(g, 170, -140, 22, 9); g.fillStyle = '#f6d21c'; g.fill(); break;
    case 'tail': g.fillStyle = skin; g.beginPath(); g.arc(0, -66, 34, 0, 7); g.fill(); g.fillStyle = '#2a8a8a'; g.beginPath(); g.moveTo(-44, -20); g.quadraticCurveTo(-60, 80, 20, 120); g.lineTo(80, 150); g.lineTo(60, 100); g.quadraticCurveTo(50, 40, 44, -20); g.closePath(); g.fill(); g.strokeStyle = '#1b1712'; g.lineWidth = 4; g.stroke(); g.fillStyle = '#c8a040'; g.beginPath(); g.arc(0, -84, 38, Math.PI, 0); g.fill(); break;
    case 'giant': g.scale(1.25, 1.4); g.translate(0, -12); body(); arm(0.4, 70); arm(Math.PI - 0.4, 70); break;
    case 'stars': for (let k = 0; k < 10; k++) { star(g, -130 + (k % 5) * 65, -100 + ((k / 5) | 0) * 130, 26, 11); g.fillStyle = pal[(k % 3)]; g.fill(); g.strokeStyle = '#1b1712'; g.lineWidth = 3; g.stroke(); } g.font = `bold 64px ${FONT_FAT}`; g.fillStyle = pal[0]; g.fillText('10', 0, -40); break;
    case 'bolt': body(); for (const s of [-1, 1]) { g.fillStyle = '#f6d21c'; g.beginPath(); g.moveTo(s * 60, -120); g.lineTo(s * 110, -60); g.lineTo(s * 85, -60); g.lineTo(s * 130, 10); g.lineTo(s * 70, -45); g.lineTo(s * 95, -45); g.closePath(); g.fill(); g.strokeStyle = '#1b1712'; g.lineWidth = 3; g.stroke(); } break;
    case 'eye': g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, -30, 120, 64, 0, 0, 7); g.fill(); g.strokeStyle = '#1b1712'; g.lineWidth = 6; g.stroke(); g.fillStyle = '#2a7fd0'; g.beginPath(); g.arc(0, -30, 44, 0, 7); g.fill(); g.fillStyle = '#1b1712'; g.beginPath(); g.arc(0, -30, 20, 0, 7); g.fill(); break;
  }
  g.restore();
  // "ALIVE" roundel bottom corner
  const bx = x + W - 86, by = y + H - 90; g.beginPath(); g.arc(bx, by, 48, 0, 7); g.fillStyle = '#fff4dc'; g.fill(); g.lineWidth = 6; g.strokeStyle = pal[0]; g.stroke();
  g.font = `bold 26px ${FONT_FAT}`; g.fillStyle = pal[0]; g.fillText(i % 3 ? 'ALIVE' : 'LIVE!', bx, by + 2);
  // canvas weave + hand-painted wear
  for (let k = 0; k < 1400; k++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${R() * 0.05})`; g.fillRect(x + R() * W, y + R() * H, 2, 2); }
  weather(g, x, y, W, H, R, 0.7);
  g.restore();
}

function drawFrieze(c, g, R) {
  const W = c.width, H = c.height;
  // blue theatre curtain ground
  g.fillStyle = '#2a4f9a'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 24) { const gr = g.createLinearGradient(x, 0, x + 24, 0); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(x, 0, 24, H); }
  g.fillStyle = '#c8201e'; for (let x = 0; x < W; x += 60) { g.beginPath(); g.arc(x + 30, 0, 30, 0, Math.PI); g.fill(); }             // swag valance
  // performer panels + one big title panel
  let x = 12; let k = 0;
  while (x < W - 10) {
    if (k === 5) { const w = 560; g.fillStyle = '#f6d21c'; g.fillRect(x, 26, w, H - 40); g.strokeStyle = '#c8201e'; g.lineWidth = 8; g.strokeRect(x + 4, 30, w - 8, H - 48);
      g.textAlign = 'center'; g.textBaseline = 'middle'; const px = fitFont(g, 'SIDESHOWS', FONT_FAT, 'bold', w - 60, 120); g.lineWidth = px * 0.12; g.strokeStyle = '#1a3d8f'; g.strokeText('SIDESHOWS', x + w / 2, H * 0.44); g.fillStyle = '#c8201e'; g.fillText('SIDESHOWS', x + w / 2, H * 0.44);
      g.font = `bold 30px ${FONT_SLAB}`; g.fillStyle = '#1a3d8f'; g.fillText('BY THE SEA · TEN IN ONE', x + w / 2, H * 0.8); x += w + 14; k++; continue; }
    const w = 150 + (R() * 30 | 0); const fr = ['#c8201e', '#f6d21c', '#e8661e', '#2f9a4a'][k % 4];
    g.fillStyle = fr; g.fillRect(x, 26, w, H - 40); g.fillStyle = ['#fff4d0', '#d6ecf6', '#fbe0d0', '#f4ffd8'][k % 4]; g.fillRect(x + 8, 34, w - 16, H - 90);
    const cx = x + w / 2; const skin = ['#e8b48a', '#b07a52', '#f0c8a0', '#8a5a3a'][k % 4];
    g.fillStyle = ['#1a3d8f', '#c8201e', '#6a2a8a', '#2f7a3a', '#1b1712'][k % 5]; g.beginPath(); g.moveTo(cx - 26, 110); g.lineTo(cx + 26, 110); g.lineTo(cx + 34, 190); g.lineTo(cx - 34, 190); g.closePath(); g.fill();
    g.fillStyle = skin; g.beginPath(); g.arc(cx, 88, 20, 0, 7); g.fill(); g.strokeStyle = skin; g.lineWidth = 9; g.beginPath(); g.moveTo(cx - 24, 120); g.lineTo(cx - 44, 90 - (k % 3) * 14); g.moveTo(cx + 24, 120); g.lineTo(cx + 46, 140 - (k % 2) * 50); g.stroke();
    if (k % 3 === 0) { g.fillStyle = '#e8661e'; g.beginPath(); g.ellipse(cx - 46, 70, 8, 20, 0, 0, 7); g.fill(); } else if (k % 3 === 1) { g.strokeStyle = '#3a9a3a'; g.lineWidth = 7; g.beginPath(); g.arc(cx, 130, 30, 0.4, 5.6); g.stroke(); }
    g.fillStyle = '#1b1712'; g.font = `bold 20px ${FONT_FAT}`; g.textAlign = 'center'; g.fillText(['FIRE', 'SNAKE', 'STRONG', 'SWORD', 'MAGIC', 'GIANT', 'ESCAPE', 'MERMAID', 'ELECTRA', 'WONDER'][k % 10], cx, H - 30);
    x += w + 10; k++;
  }
  weather(g, 0, 0, W, H, R, 0.8);
}

function shopfrontMats(M, reg, R, std, canvas, tex) {
  // ---- galvanised shutter atlas: 4x4 cells of 512 px; cells 0..7 carry a distinct graffiti piece, 8..15 are clean/stickered
  { const [c, g] = canvas(2048, 2048); for (let i = 0; i < 16; i++) drawShutter(g, (i % 4) * 512, ((i / 4) | 0) * 512, 512, i < 8 ? i : -1, R);
    // matching slat normal map (the corrugation catches the sun even where no graffiti is)
    const [cn, gn] = canvas(64, 2048); gn.fillStyle = 'rgb(128,128,255)'; gn.fillRect(0, 0, 64, 2048); for (let y = 0; y < 2048; y += 16) { gn.fillStyle = 'rgb(128,90,230)'; gn.fillRect(0, y + 10, 64, 5); gn.fillStyle = 'rgb(128,170,235)'; gn.fillRect(0, y, 64, 4); }
    const t = tex(c, { wrap: false }); const nt = tex(cn, { srgb: false, wrap: false }); nt.wrapS = 1000;
    reg('shutterAtlas', std({ map: t, normalMap: nt, normalScale: new THREE.Vector2(0.6, 0.6), color: 0xffffff, metalness: 0.6, roughness: 0.45, envMapIntensity: 0.9 }), 'metal', 1);
    M.shutterCell = (i) => [(i % 4) / 4 + 0.004, 1 - (((i / 4) | 0) + 1) / 4 + 0.004, 0.25 - 0.008, 0.25 - 0.008];   // [u0, v0, du, dv]
  }
  reg('galv', std({ color: 0xa7a9a8, metalness: 0.6, roughness: 0.45, envMapIntensity: 0.8 }), 'metal', 1);
  reg('cornice', std({ color: 0xeee9dc, roughness: 0.7, metalness: 0 }), 'concrete', 0.5);
  reg('corniceDark', std({ color: 0x3a3c3a, roughness: 0.55, metalness: 0.3 }), 'metal', 0.5);

  // ---- painted sign atlas: 2 x 8 cells of 1024x256 (4:1) ------------------------------------------------------------
  { const [c, g] = canvas(2048, 2048); SIGNS.forEach((s, i) => drawSign(g, (i % 2) * 1024, ((i / 2) | 0) * 256, 1024, 256, s, R));
    const t = tex(c, { wrap: false }); t.anisotropy = 16;
    const mk = (map) => new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    reg('signAtlas', mk(t), 'wood', 1);
    M.signCell = (i) => [(i % 2) / 2 + 0.003, 1 - (((i / 2) | 0) + 1) / 8 + 0.004, 0.5 - 0.006, 0.125 - 0.008];
    M.signCount = SIGNS.length;
    // per-sign materials (plain 0..1 UV planes elsewhere, e.g. park kiosks) share the atlas image via offset/repeat
    M.signKeys = []; SIGNS.forEach((_, i) => { const tt = t.clone(); const [u0, v0, du, dv] = M.signCell(i); tt.offset.set(u0, v0); tt.repeat.set(du, dv); tt.needsUpdate = true; reg('sign' + i, mk(tt), 'wood', 1); M.signKeys.push('sign' + i); });
  }
  // ---- open-counter interiors (atlas: [0] snack counter — steel back wall, menu boards, fryer/grill line; [1] arcade — dark
  // room, glowing cabinet screens and marquee strips). u 0..0.5 / 0.5..1, lit through a small emissive term.
  { const [c, g] = canvas(1024, 384);
    const snack = (x0) => { const W = 512, H = 384;
      const wall = g.createLinearGradient(0, 0, 0, H); wall.addColorStop(0, '#6c6a64'); wall.addColorStop(0.5, '#8e8c86'); wall.addColorStop(1, '#5a5852'); g.fillStyle = wall; g.fillRect(x0, 0, W, H);
      for (let x = 0; x < W; x += 64) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x0 + x, 0, 2, H); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x0 + x + 2, 0, 2, H); }   // steel wall panels
      for (let i = 0; i < 3; i++) { const bx = x0 + 28 + i * 160, by = 62; g.fillStyle = '#1e1c1a'; g.fillRect(bx, by, 144, 96); g.fillStyle = '#f2ead6'; g.fillRect(bx, by, 144, 14);
        for (let k = 0; k < 3; k++) { const fx = bx + 8 + k * 46; g.fillStyle = ['#b8663a', '#c8903c', '#a8402c', '#d8b050'][(i + k) % 4]; rrect(g, fx, by + 22, 38, 26, 6); g.fill(); g.fillStyle = 'rgba(255,240,200,0.35)'; g.fillRect(fx + 4, by + 25, 20, 5); }
        g.fillStyle = 'rgba(240,232,210,0.85)'; for (let k = 0; k < 4; k++) { g.fillRect(bx + 8, by + 56 + k * 9, 70 + R() * 30, 3); g.fillRect(bx + 118, by + 56 + k * 9, 16, 3); } }
      const eq = g.createLinearGradient(0, 230, 0, H); eq.addColorStop(0, '#b4b6b4'); eq.addColorStop(0.3, '#8a8c8a'); eq.addColorStop(1, '#4a4c4a'); g.fillStyle = eq; g.fillRect(x0 + 10, 232, 330, 152);   // fryer / grill line
      for (let k = 0; k < 3; k++) { g.fillStyle = '#2a2826'; g.fillRect(x0 + 24 + k * 108, 244, 92, 26); g.fillStyle = 'rgba(210,150,60,0.6)'; g.fillRect(x0 + 30 + k * 108, 250, 80, 12); }
      g.fillStyle = '#d8e4e8'; g.fillRect(x0 + 360, 150, 130, 234); g.fillStyle = 'rgba(40,60,70,0.35)'; g.fillRect(x0 + 366, 156, 118, 222);               // drinks fridge
      for (let k = 0; k < 5; k++) { g.fillStyle = '#9aa4a8'; g.fillRect(x0 + 366, 196 + k * 38, 118, 3); for (let bb = 0; bb < 9; bb++) { g.fillStyle = ['#b83a2a', '#d8b23a', '#3a6aa8', '#4a9a4a', '#e8e4d8'][(bb + k) % 5]; g.fillRect(x0 + 370 + bb * 12.5, 172 + k * 38, 8, 22); } }
      g.fillStyle = 'rgba(255,248,220,0.9)'; g.fillRect(x0, 22, W, 8);  // light strip
    };
    const arcade = (x0) => { const W = 512, H = 384; g.fillStyle = '#141220'; g.fillRect(x0, 0, W, H);
      for (let k = 0; k < 4; k++) { const cx = x0 + 20 + k * 124; g.fillStyle = ['#3a1a5a', '#5a1a1a', '#1a2a5a', '#1a4a2a'][k]; g.fillRect(cx, 90, 104, 294); g.fillStyle = ['#f6d21c', '#e8352a', '#2ad0f0', '#f08ad0'][k]; g.fillRect(cx + 6, 96, 92, 26);
        const sc = g.createRadialGradient(cx + 52, 190, 5, cx + 52, 190, 60); sc.addColorStop(0, '#9af0ff'); sc.addColorStop(0.6, '#2a6ad0'); sc.addColorStop(1, '#101830'); g.fillStyle = sc; g.fillRect(cx + 12, 140, 80, 90);
        g.fillStyle = '#222'; g.fillRect(cx + 4, 240, 96, 40); g.fillStyle = '#e8352a'; g.beginPath(); g.arc(cx + 30, 258, 7, 0, 7); g.fill(); g.fillStyle = '#f6d21c'; g.beginPath(); g.arc(cx + 70, 258, 7, 0, 7); g.fill(); }
      for (let x = 0; x < W; x += 16) { g.fillStyle = ['#f6d21c', '#e8352a', '#2ad0f0'][(x / 16) % 3]; g.beginPath(); g.arc(x0 + x + 8, 40, 4, 0, 7); g.fill(); }
    };
    snack(0); arcade(512);
    // shadow under the hood + soft vignette so the room reads recessed
    for (const x0 of [0, 512]) { const v = g.createLinearGradient(0, 0, 0, 90); v.addColorStop(0, 'rgba(0,0,0,0.75)'); v.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = v; g.fillRect(x0, 0, 512, 90);
      for (const [a0, a1] of [[x0, x0 + 40], [x0 + 512, x0 + 472]]) { const h = g.createLinearGradient(a0, 0, a1, 0); h.addColorStop(0, 'rgba(0,0,0,0.6)'); h.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = h; g.fillRect(Math.min(a0, a1), 0, 40, 384); } }
    const t = tex(c, { wrap: false }); reg('shopInterior', std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.6, metalness: 0.1 }), 'concrete', 1);
    M.interiorCell = (arcade) => [arcade ? 0.5 : 0, 0, 0.5, 1]; }

  // ---- striped fabric awnings (texture = one 0.6 m stripe pair along u) ------------------------------------------------
  for (const [key, a, b] of [['awnGreen', '#1f5e3a', '#f2efe6'], ['awnRed', '#b3262b', '#f2efe6'], ['awnBlue', '#1f4f8f', '#f2efe6']]) {
    const [c, g] = canvas(64, 64); g.fillStyle = a; g.fillRect(0, 0, 32, 64); g.fillStyle = b; g.fillRect(32, 0, 32, 64);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.06})`; g.fillRect(R() * 64, R() * 64, 1 + R() * 3, 1); }
    const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(0,0,0,0.12)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,30,20,0.14)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = tex(c); t.anisotropy = 8; reg(key, std({ map: t, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 }), 'wood', 1);
  }
  M.awnKeys = ['awnGreen', 'awnRed', 'awnBlue'];

  // ---- Surf Avenue sideshow block: stucco, terracotta tile, blue brackets, orange posts, banner atlas, mural frieze ----
  reg('ssOrange', std({ color: 0xe07a1f, roughness: 0.6, metalness: 0.15 }), 'metal', 1);
  reg('ssBlue', std({ color: 0x2f5c9a, roughness: 0.6, metalness: 0.1 }), 'wood', 1);
  { const [c, g] = canvas(256, 256); g.fillStyle = '#6a3a26'; g.fillRect(0, 0, 256, 256);   // barrel tiles: 8 per row (0.25 m), 8 rows (0.3 m)
    for (let r = 0; r < 8; r++) for (let k = 0; k < 8; k++) { const x = k * 32 + (r % 2) * 16, y = r * 32; const v = R() * 30 - 15; const gr = g.createLinearGradient(x, 0, x + 32, 0); gr.addColorStop(0, `rgb(${120 + v},${62 + v / 2},${40})`); gr.addColorStop(0.45, `rgb(${176 + v},${104 + v / 2},${72})`); gr.addColorStop(1, `rgb(${110 + v},${56 + v / 2},${36})`);
      g.fillStyle = gr; for (const xx of [x, x - 256]) { g.beginPath(); g.moveTo(xx + 2, y + 34); g.lineTo(xx + 4, y + 2); g.quadraticCurveTo(xx + 16, y - 4, xx + 28, y + 2); g.lineTo(xx + 30, y + 34); g.closePath(); g.fill(); } g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + 30, 32, 3); }
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '40,40,30' : '220,200,170'},${R() * 0.12})`; g.fillRect(R() * 256, R() * 256, 2 + R() * 6, 2); }
    reg('ssTile', std({ map: tex(c), color: 0xffffff, roughness: 0.75, metalness: 0 }), 'concrete', 1); }
  { const [c, g] = canvas(2048, 2048); for (let i = 0; i < 12; i++) drawBanner(g, (i % 4) * 512, ((i / 4) | 0) * 682, 512, 682, i, R);
    const t = tex(c, { wrap: false }); reg('ssBanner', new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.7, side: THREE.DoubleSide }), 'wood', 1);
    M.bannerCell = (i) => [(i % 4) / 4 + 0.003, 1 - (((i / 4) | 0) * 682 + 682) / 2048 + 0.003, 0.25 - 0.006, 682 / 2048 - 0.006];
  }
  { const [c, g] = canvas(2048, 256); drawFrieze(c, g, R); const t = tex(c); t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 16;
    reg('ssFrieze', new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.7 }), 'wood', 1); }
  { const [c, g] = canvas(256, 256); g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#c8201e'; g.textAlign = 'center'; g.font = `bold 38px ${FONT_SLAB}`; g.fillText('NO', 64, 36); g.fillText('PARKING', 128, 36);
    g.fillText('ANYTIME', 128, 80); g.lineWidth = 6; g.strokeStyle = '#c8201e'; g.beginPath(); g.moveTo(40, 108); g.lineTo(216, 108); g.stroke(); g.beginPath(); g.moveTo(40, 108); g.lineTo(56, 98); g.moveTo(40, 108); g.lineTo(56, 118); g.moveTo(216, 108); g.lineTo(200, 98); g.moveTo(216, 108); g.lineTo(200, 118); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(0, 128, 256, 128); g.fillStyle = '#1f5e3a'; g.fillText('1 HOUR', 128, 170); g.font = `bold 26px ${FONT_SLAB}`; g.fillText('PARKING 9AM-7PM', 128, 210); g.fillText('EXCEPT SUNDAY', 128, 240);
    reg('parkSign', std({ map: tex(c, { wrap: false }), roughness: 0.5, metalness: 0.2 }), 'metal', 1); }
  reg('hydrant', std({ color: 0xb8322a, roughness: 0.55, metalness: 0.25 }), 'metal', 1);
  reg('lampLens', new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 0.6, roughness: 0.3 }), 'metal', 1);
}

/** el viaduct: girder paint with plate seams + rivet rows, and the tie/stringer deck soffit (lifted so it never renders #000) */
function elMats(M, reg, R, std, canvas, tex) {
  { const [c, g] = canvas(256, 256); g.fillStyle = '#2f4a3c'; g.fillRect(0, 0, 256, 256);          // 2 x 2 m tile
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '120,150,130'},${R() * 0.1})`; g.fillRect(R() * 256, R() * 256, 2 + R() * 5, 2); }
    for (const x of [0, 128]) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, 0, 3, 256); g.fillStyle = 'rgba(160,190,170,0.25)'; g.fillRect(x + 3, 0, 2, 256); }
    for (const y of [10, 22, 234, 246]) for (let x = 4; x < 256; x += 9) { g.fillStyle = 'rgba(15,25,20,0.45)'; g.beginPath(); g.arc(x + 0.8, y + 0.8, 2, 0, 7); g.fill(); g.fillStyle = 'rgba(110,140,120,0.45)'; g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
    for (let i = 0; i < 5; i++) { const x = R() * 256, L = 30 + R() * 120, y = R() * 120; const gr = g.createLinearGradient(0, y, 0, y + L); gr.addColorStop(0, 'rgba(130,70,30,0.45)'); gr.addColorStop(1, 'rgba(130,70,30,0)'); g.fillStyle = gr; g.fillRect(x, y, 3 + R() * 5, L); }
    const t = tex(c); t.anisotropy = 8;
    reg('elGirder', std({ map: t, color: 0xffffff, roughness: 0.6, metalness: 0.45, emissive: 0x16221c, emissiveIntensity: 1 }), 'metal', 1 / 2);
    M.railSteelGreen = M.elGirder; }
  { const [c, g] = canvas(256, 512);                       // u: 5 m across the deck; v: 2.4 m along (4 ties @ 0.6 m)
    g.fillStyle = '#20241f'; g.fillRect(0, 0, 256, 512);
    for (let k = 0; k < 4; k++) { const y = k * 128 + 10; g.fillStyle = '#5a4c3e'; g.fillRect(0, y, 256, 60); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '30,24,18' : '140,120,96'},${R() * 0.25})`; g.fillRect(0, y + R() * 60, 256, 1 + R() * 2); } g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y + 56, 256, 4); }
    for (const x of [22, 83, 173, 234]) { g.fillStyle = '#2f4a3c'; g.fillRect(x - 8, 0, 16, 512); g.fillStyle = 'rgba(160,190,170,0.35)'; g.fillRect(x - 8, 0, 2, 512); for (let y = 4; y < 512; y += 12) { g.fillStyle = 'rgba(150,180,160,0.6)'; g.beginPath(); g.arc(x - 4, y, 1.6, 0, 7); g.arc(x + 4, y, 1.6, 0, 7); g.fill(); } }
    const t = tex(c); t.anisotropy = 8;
    reg('elSoffit', std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, color: 0xffffff, roughness: 0.85, metalness: 0.1 }), 'wood', 1); }
}

// =====================================================================================================================
// PRE-WAR BRICK FACADE KIT (Brighton Beach walk-ups, 8th Ave rowhouses): the Luna Park Houses pipeline (housing.js
// facadeTextures) for 1.75 m bays with one double-hung window each. One window layout per world, ONE normal / roughness /
// night map set shared by every diffuse variant (only the brick colour, lintels and window cards differ), 1024^2 on desktop,
// 512^2 (diffuse) and no night map on phones; the normal / roughness pair is its own 256^2 pass on phones since only the
// raised-mortar / window-reveal shading comes off it, not colour. Own seeded PRNGs only (never world.R). On phones every
// canvas is uploaded and dropped the moment its texture is built (renderer.initTexture, not the render loop's lazy upload)
// so the kit never holds more than one canvas-sized buffer at a time; the tint variants share one scratch canvas too.
export const FAC = { BAY: 1.75, FL: 3.1, TB: 4, TF: 3, SILL: 0.9, WH: 1.55, WW: 0.95 };   // tile: 4 bays x 3 storeys = 7 m x 9.3 m
const FAC_ROWS = 140, FAC_COLS = 36;   // brick courses / stretchers per tile (integers so the bond tiles seamlessly; ~6.6 cm x 19 cm)
const FAC_LAYOUT_SEED = 0xfacade, FAC_PLAIN_SEED = 77;
const FAC_NORMAL_RES_LITE = 256;   // normal / roughness resolution on phones (diffuse stays at the 512 lite size)
const facKits = new WeakMap();
function facRng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** the canvas is only needed for the upload: drop it after (the JS / canvas heap on phones) */
const freeOnUpload = (t) => { t.onUpdate = () => { t.image = null; t.onUpdate = null; }; return t; };
const facTex = (c, srgb, aniso) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return freeOnUpload(t); };
/** phones only: force the GPU upload now (instead of waiting for the render loop) so freeOnUpload's onUpdate fires right
 *  away and the backing canvas is dropped before the next one is built, instead of all of them piling up until first paint */
const facEagerUpload = (renderer, t) => { if (renderer) renderer.initTexture(t); return t; };
/** the window grid for a facade pass at this pixel scale: same seed every time so every resolution lays out identically */
const facWins = (TB, TF, BAY, FL, SILL, WH, S, px, py) => { const lay = facRng(FAC_LAYOUT_SEED), w = [];
  for (let f = 0; f < TF; f++) for (let b = 0; b < TB; b++) w.push({ cx: (b + 0.5) * BAY * px, yB: S - (f * FL + SILL) * py, yT: S - (f * FL + SILL + WH) * py, f, rnd: lay(), card: lay() }); return w; };
const CJK_FONT = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';

/** the shared kit for this world: kit.mat(key, palette, opts) / kit.plainMat(extra) build materials on the shared maps */
export function brickFacadeKit(world) {
  let K = facKits.get(world); if (K) return K;
  const lite = !!world.ctx?.lite, S = lite ? 512 : 1024, renderer = world.ctx?.renderer ?? null, aniso = lite ? 4 : Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 8);
  const eager = (t) => (lite ? facEagerUpload(renderer, t) : t);   // phones: upload now and drop the canvas; desktop: leave the normal lazy-upload path alone
  const { BAY, FL, TB, TF, SILL, WH, WW } = FAC, px = S / (TB * BAY), py = S / (TF * FL), ch = S / FAC_ROWS, bl = S / FAC_COLS, ww = WW * px;
  const wins = facWins(TB, TF, BAY, FL, SILL, WH, S, px, py);
  const LIN = 0.2 * py, LW = ww + 0.24 * px, inset = 0.035 * px, fw = 0.06 * px;   // lintel height / width, frame inset / width (diffuse-resolution windows)
  // ---- height (-> normal) + roughness, shared by every variant: its own (lower on phones) resolution, since only the
  // raised-mortar / window-reveal shading comes off this pass, never the brick colour ----
  const HS = lite ? FAC_NORMAL_RES_LITE : S, hpx = HS / (TB * BAY), hpy = HS / (TF * FL), hch = HS / FAC_ROWS, hbl = HS / FAC_COLS, hww = WW * hpx;
  const hwins = HS === S ? wins : facWins(TB, TF, BAY, FL, SILL, WH, HS, hpx, hpy);
  const hLIN = 0.2 * hpy, hLW = hww + 0.24 * hpx, hInset = 0.035 * hpx, hFw = 0.06 * hpx;
  const [hc, hg] = canvas(HS, HS), [rc, rg] = canvas(HS, HS);
  hg.fillStyle = '#c8c8c8'; hg.fillRect(0, 0, HS, HS); rg.fillStyle = 'rgb(0,240,0)'; rg.fillRect(0, 0, HS, HS);
  { const lw = lite ? 1 : 1.2; hg.fillStyle = '#a0a0a0'; for (let r = 0; r < FAC_ROWS; r++) { const y = r * hch; hg.fillRect(0, y, HS, lw); for (let x = (r & 1) ? -hbl / 2 : 0; x < HS; x += hbl) hg.fillRect(x, y, lw, hch); } }
  const [pc, pg] = canvas(HS, HS); pg.drawImage(hc, 0, 0);   // plain brick (party walls): courses only
  for (const w of hwins) { const x0 = w.cx - hww / 2;
    hg.fillStyle = '#e4e4e4'; hg.fillRect(w.cx - hLW / 2, w.yT - 3 - hLIN, hLW, hLIN);   // the cast-stone lintel stands proud
    hg.fillStyle = '#202020'; hg.fillRect(x0 - 3, w.yT - 3, hww + 6, w.yB - w.yT + 6);
    hg.fillStyle = '#707070'; hg.fillRect(x0 + hInset, w.yT + hInset, hww - hInset * 2, w.yB - w.yT - hInset);
    hg.fillStyle = '#404040'; hg.fillRect(x0 + hInset + hFw, w.yT + hInset + hFw, hww - 2 * hInset - 2 * hFw, w.yB - w.yT - hInset - 2 * hFw);
    hg.fillStyle = '#ffffff'; hg.fillRect(x0 - 0.08 * hpx, w.yB, hww + 0.16 * hpx, 0.07 * hpy);
    rg.fillStyle = 'rgb(0,200,0)'; rg.fillRect(w.cx - hLW / 2, w.yT - 3 - hLIN, hLW, hLIN); rg.fillRect(x0 - 0.08 * hpx, w.yB, hww + 0.16 * hpx, 0.07 * hpy);
    rg.fillStyle = 'rgb(0,120,0)'; rg.fillRect(x0 + hInset, w.yT + hInset, hww - hInset * 2, w.yB - w.yT - hInset);
    rg.fillStyle = 'rgb(0,28,0)'; rg.fillRect(x0 + hInset + hFw, w.yT + hInset + hFw, hww - 2 * hInset - 2 * hFw, w.yB - w.yT - hInset - 2 * hFw); }
  const normalFrom = (cv, strength) => {
    const src = cv.getContext('2d').getImageData(0, 0, HS, HS).data, [nc, ng] = canvas(HS, HS), out = ng.createImageData(HS, HS), d = out.data;
    const h = (x, y) => src[(((y + HS) % HS) * HS + ((x + HS) % HS)) * 4] / 255;
    for (let y = 0; y < HS; y++) for (let x = 0; x < HS; x++) { const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength, L = Math.hypot(dx, dy, 1), i = (y * HS + x) * 4;
      d[i] = (-dx / L * 0.5 + 0.5) * 255; d[i + 1] = (dy / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255; }
    ng.putImageData(out, 0, 0); return facTex(nc, false, aniso);
  };
  const normal = eager(normalFrom(hc, 2.2)), normalPlain = eager(normalFrom(pc, 2.2)), rough = eager(facTex(rc, false, aniso));
  // ---- night: ~35% of the flats lit (tungsten / warm white / TV blue), some behind a blind; desktop only ----
  let lit = null;
  if (!lite) { const [lc, lg] = canvas(S, S); lg.fillStyle = '#000'; lg.fillRect(0, 0, S, S);
    for (const w of wins) { const k = (w.rnd * 9301 + w.cx * 0.37 + w.f * 0.71) % 1; if (k > 0.36) continue;
      const x0 = w.cx - ww / 2 + 0.1 * px, x1 = w.cx + ww / 2 - 0.1 * px, yT = w.yT + 0.1 * py, yB = w.yB - 0.06 * py, col = k < 0.2 ? '#ffc98a' : k < 0.3 ? '#ffe7c4' : '#9fb8ff';
      const gr = lg.createLinearGradient(0, yT, 0, yB); gr.addColorStop(0, col); gr.addColorStop(1, k < 0.3 ? '#b8804a' : '#5a6aa8'); lg.fillStyle = gr; lg.fillRect(x0, yT, x1 - x0, yB - yT);
      if (w.rnd > 0.62) { lg.fillStyle = 'rgba(0,0,0,0.55)'; lg.fillRect(x0, yT, x1 - x0, (yB - yT) * 0.45); } }
    lit = facTex(lc, true, aniso); }
  // ---- diffuse variants ----
  const brickFill = (g, r, c) => {
    g.fillStyle = c.mortar; g.fillRect(0, 0, S, S);
    for (let row = 0; row < FAC_ROWS; row++) { const y = row * ch; for (let x = (row & 1) ? -bl / 2 : 0; x < S; x += bl) { const v = r(); g.fillStyle = v < 0.15 ? c.dark : v > 0.88 ? c.light : c.base; g.fillRect(x + 0.6, y + 0.7, bl - 1.2, ch - 1.1);
      if (r() < 0.5) { g.globalAlpha = 0.12; g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.fillRect(x + 1, y + 1, bl - 2, ch - 2); g.globalAlpha = 1; } } }
    for (let i = 0; i < 2400 * S / 1024; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,225'},${r() * 0.08})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }   // micro grain
    for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(${r() < 0.6 ? '30,18,14' : '190,150,120'},${r() * 0.06})`; g.fillRect(r() * S, r() * S, (8 + r() * 40) * S / 1024, (3 + r() * 12) * S / 1024); }   // weather / soot blotches
  };
  // Sunset Park: a red-and-gold 福 diamond, or a bilingual card taped in the lower sash
  const card = (g, cx, cy, s, fu) => { g.save(); g.translate(cx, cy); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (fu) { g.rotate(Math.PI / 4); g.fillStyle = '#c8141c'; g.fillRect(-s / 2, -s / 2, s, s); g.strokeStyle = '#e8b83a'; g.lineWidth = Math.max(1, s * 0.06); g.strokeRect(-s * 0.42, -s * 0.42, s * 0.84, s * 0.84); g.rotate(-Math.PI / 4); g.fillStyle = '#f2c94a'; g.font = `700 ${s * 0.62}px ${CJK_FONT}`; g.fillText('福', 0, s * 0.04); }
    else { g.fillStyle = '#f4f1e6'; g.fillRect(-s * 0.45, -s * 0.32, s * 0.9, s * 0.64); g.fillStyle = '#b3121e'; g.font = `700 ${s * 0.26}px ${CJK_FONT}`; g.fillText('出租', 0, -s * 0.1); g.font = `700 ${s * 0.13}px Helvetica, Arial, sans-serif`; g.fillText('FOR RENT', 0, s * 0.17); }
    g.restore(); };
  const windows = (g, o) => {
    for (const w of wins) {
      const x0 = w.cx - ww / 2, x1 = w.cx + ww / 2, yT = w.yT, yB = w.yB;
      { const gr = g.createLinearGradient(0, yB, 0, yB + 0.55 * py); gr.addColorStop(0, 'rgba(25,15,12,0.22)'); gr.addColorStop(1, 'rgba(25,15,12,0)'); g.fillStyle = gr; g.fillRect(x0 + 4, yB, ww - 8, 0.55 * py); }   // rain / soot under the sill
      // the head: a cast-stone lintel (a keystone on some blocks) or a soldier course of brick
      const lx = w.cx - LW / 2, ly = yT - 3 - LIN;
      if (o.soldier) { g.fillStyle = o.mortar; g.fillRect(lx, ly, LW, LIN); for (let x = lx, n = 0; x < lx + LW - 1; x += ch * 1.05, n++) { g.fillStyle = n % 3 === 1 ? o.dark : o.base; g.fillRect(x + 0.6, ly + 0.6, ch * 1.05 - 1.2, LIN - 1.2); } }
      else { g.fillStyle = '#cfc7b6'; g.fillRect(lx, ly, LW, LIN); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(lx, ly + LIN - 2, LW, 2);
        if (o.keystone) { const kw = 0.2 * px; g.fillStyle = '#e1dacb'; g.beginPath(); g.moveTo(w.cx - kw / 2, ly - 0.04 * py); g.lineTo(w.cx + kw / 2, ly - 0.04 * py); g.lineTo(w.cx + kw * 0.36, ly + LIN); g.lineTo(w.cx - kw * 0.36, ly + LIN); g.fill(); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(w.cx + kw * 0.36, ly, 1.5, LIN); } }
      g.fillStyle = '#231a17'; g.fillRect(x0 - 3, yT - 3, ww + 6, yB - yT + 6);   // deep masonry reveal
      g.fillStyle = '#e9e8e2'; g.fillRect(x0 + inset, yT + inset, ww - inset * 2, yB - yT - inset);   // off-white sash frame
      const meet = yT + (yB - yT) * 0.47, k = w.rnd;
      for (const [s0, s1, top] of [[yT + inset + fw, meet - fw * 0.4, true], [meet + fw * 0.4, yB - fw, false]]) {
        const gx0 = x0 + inset + fw, gx1 = x1 - inset - fw, gr = g.createLinearGradient(0, s0, 0, s1), sky = k < 0.3 ? ['#7e8f9f', '#34404b'] : k < 0.6 ? ['#5d6a76', '#262d34'] : ['#98a6b2', '#46525d'];
        gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]); g.fillStyle = gr; g.fillRect(gx0, s0, gx1 - gx0, s1 - s0);
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(gx0, s1); g.lineTo(gx0 + (gx1 - gx0) * 0.45, s0); g.lineTo(gx0 + (gx1 - gx0) * 0.62, s0); g.lineTo(gx0 + (gx1 - gx0) * 0.17, s1); g.fill();
        if (top && k > 0.62) { const f = 0.25 + ((k * 7.3) % 1) * 0.75; g.fillStyle = k > 0.85 ? '#b8a684' : '#e2ded3'; g.fillRect(gx0, s0, gx1 - gx0, (s1 - s0) * f); g.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = s0 + 3; y < s0 + (s1 - s0) * f; y += 3) g.fillRect(gx0, y, gx1 - gx0, 1); }
        if (!top && k > 0.78 && k < 0.85) { g.fillStyle = '#8b6c5a'; g.fillRect(gx0, s0, (gx1 - gx0) * 0.35, s1 - s0); }
        if (!top && o.cards && w.card < 0.15) card(g, (gx0 + gx1) / 2, (s0 + s1) / 2, Math.min(gx1 - gx0, s1 - s0) * 0.62, w.card < 0.09);
      }
      g.fillStyle = '#d9d8d1'; g.fillRect(x0 + inset, meet - fw * 0.4, ww - inset * 2, fw * 0.8);         // meeting rail
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + inset, yT + inset, ww - inset * 2, 0.07 * py);   // head shadow in the reveal
      g.fillStyle = '#c9c3b5'; g.fillRect(x0 - 0.08 * px, yB, ww + 0.16 * px, 0.07 * py);                  // projecting cast-stone sill
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0 - 0.08 * px, yB + 0.07 * py, ww + 0.16 * px, 2);
    }
  };
  const diff = new Map();
  let scratchCv = null;   // phones: every tint variant paints over the same canvas (brickFill repaints it in full) instead of allocating a new one
  const diffuse = (key, c, o = {}) => { if (diff.has(key)) return diff.get(key);
    if (lite && !scratchCv) { scratchCv = document.createElement('canvas'); scratchCv.width = S; scratchCv.height = S; }
    const [cv, g] = lite ? [scratchCv, scratchCv.getContext('2d')] : canvas(S, S);
    brickFill(g, facRng(o.seed ?? [...key].reduce((a, ch2) => a * 31 + ch2.charCodeAt(0), 7)), c); if (!o.plain) windows(g, { ...c, ...o });
    const t = eager(facTex(cv, true, aniso)); diff.set(key, t); return t; };
  const PLAIN = { base: '#d8d1ca', dark: '#c2b9b0', light: '#e6e0d9', mortar: '#ece8e2' };   // neutral: tinted per building by vertex / material colour
  K = { S, lite, lit, normal, normalPlain, rough,
    /** windowed brick: its own diffuse on the shared normal / roughness / night maps (W.night drives emissiveIntensity) */
    mat: (key, c, o = {}, extra = {}) => new THREE.MeshStandardMaterial({ map: diffuse(key, c, o), normalMap: normal, roughnessMap: rough, roughness: 1, metalness: 0, envMapIntensity: 0.55, emissiveMap: lit, emissive: lit ? 0xffffff : 0x000000, emissiveIntensity: 0, ...extra }),
    /** windowless party / flank walls: neutral brick + the courses-only normal map */
    plainMat: (extra = {}) => new THREE.MeshStandardMaterial({ map: diffuse('plain', PLAIN, { plain: true, seed: FAC_PLAIN_SEED }), normalMap: normalPlain, roughness: 0.94, metalness: 0, envMapIntensity: 0.5, ...extra }),
  };
  facKits.set(world, K); return K;
}
/** facade UVs on a box in tile units: whole bays across each face (n = round(width / bay)), storeys counted up from y0 (m above the box's foot) */
export function facadeBoxUV(g, w, h, d, y0 = 0) { const uv = g.attributes.uv, n = g.attributes.normal, tileH = FAC.TF * FAC.FL;
  for (let i = 0; i < uv.count; i++) { const along = Math.abs(n.getX(i)) > 0.5 ? d : w, nb = Math.max(1, Math.round(along / FAC.BAY)); uv.setXY(i, uv.getX(i) * nb / FAC.TB, (uv.getY(i) * h - y0) / tileH); } return g; }
/** some faces of an indexed BoxGeometry (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z) as their own non-indexed geometry */
export function boxFaces(g, faces) { const idx = g.index.array, keep = []; for (const f of faces) for (let i = f * 6; i < f * 6 + 6; i++) keep.push(idx[i]); const q = g.clone(); q.setIndex(keep); q.clearGroups(); return q.toNonIndexed(); }
/** world-metre UVs on a box already translated into place: party walls tile their brick continuously */
export function metreUV(g, su = FAC.TB * FAC.BAY, sv = FAC.TF * FAC.FL) { const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)); uv.setXY(i, (ax > 0.5 ? p.getZ(i) : p.getX(i)) / su, (ay > 0.5 ? p.getZ(i) : p.getY(i)) / sv); } return g; }

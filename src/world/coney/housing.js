// CONEY — Luna Park Houses: the five ~21-storey NYCHA towers north of Surf Avenue (OSM "Luna Park Houses 1..5").
// Each complex is re-massed from its OSM footprint into the real plan: a dark recessed open-gallery core (slab edges, chain-link
// on pipe rails, white columns, dark back wall, beige penthouse) joining two L-shaped brick towers, each an axial wing at full height plus a
// perpendicular wing stepping down twice. Facades: red-brown brick with white-framed punched windows two per bay (a 2-bay x
// 4-storey canvas tile with normal + roughness maps, so reveals read recessed and the glass reflects), full-height cream panel
// strips standing 0.1 m proud, brick-with-cream-bands top zones, through-wall/window AC units (instanced), dark coping +
// steel guard railings + stair/elevator bulkheads on the roofs, entrance doors with canopies, lawns with low black steel
// fences and trees (the boulevards and the plaza between the towers: lunayard.js). Every solid has colliders (rotated boxes are cut into <= 4 m cells before their AABBs are taken).
// Owned by: LUNA HOUSING agent.
import * as THREE from 'three';
import { Batch as GeoBatch, boxGeo, worldUV } from '../sbu/geo.js';
import { OSM, PLAY } from './osm.js';
import { footprintAngle, cen, bbox, pip, segDist } from '../osmkit.js';
import { leafTexture, barkTexture } from '../wsp/textures.js';
import { planYard, buildYard } from './lunayard.js';

const ST = 2.62;        // storey height (m)
const PAR = 0.9;        // parapet above the top floor slab
const TILE_BAYS = 2, TILE_FLOORS = 4;
const SILL = 0.85, WIN_H = 1.5, WIN_W = 1.12, WIN_AT = [0.28, 0.72];   // window layout inside one bay (fractions of the bay)
const GAL = 1.7;        // lobby glass / 19th-floor vestibule line on the core faces (hangout geometry keys off this)
const GALV = 2.5;       // visual gallery recess: dark back wall + slabs run this deep so the core self-shadows (critic r9 #2)
const DOOR_HALF = 2.4, LOBBY_HALF = 7, WALK_HALF = 8.3, GROUND_HI = 13;   // DOOR_HALF: half-width of the open breezeway through the core on both gallery faces (no doors, lines up with the canopy posts) · GROUND_HI: the ground-floor lobby runs from the elevator wall (mid − LOBBY_HALF) to mid + 13 · WALK_HALF: 19th-floor walkway half-length

/** The five Luna Park Houses towers in OSM.b (tall 'tower' style buildings north of the avenue, x 60..380, z -520..-110). */
export const isLunaTower = (b) => { if (b.s !== 'tower' || !(b.h > 50)) return false; const [x, z] = cen(b.p); return x > 60 && x < 380 && z > -520 && z < -110; };

// ---------------------------------------------------------------------------------------------------------------------------
// textures
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const texOf = (c, srgb = true, aniso = 8) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return t; };

/** Facade tiles: 2 bays x 4 storeys (1024^2). kinds: brick (windows in brick), cream (windows in the cream panel strip),
 *  top (brick with a cream band behind every window column), plain (brick, no windows). Shared normal + roughness maps. */
function facadeTextures(R, aniso) {
  const S = 1024, TW = TILE_BAYS, TH = TILE_FLOORS;   // tile in bay / storey units
  const X = (b) => b / TW * S, Y = (f) => S - f / TH * S;                  // bay units -> px, storey units (from the bottom) -> px
  const bayM = 4.8, px = S / (TW * bayM), py = S / (TH * ST);            // nominal px per metre
  const wins = []; for (let f = 0; f < TH; f++) for (let b = 0; b < TW; b++) for (const a of WIN_AT) wins.push({ cx: X(b + a), y0: Y(f + SILL / ST), y1: Y(f + (SILL + WIN_H) / ST), f, rnd: R() });
  const ww = WIN_W * px;

  const brick = (g, base, dark, light, mortar) => {
    g.fillStyle = mortar; g.fillRect(0, 0, S, S);
    const ch = 0.0667 * py, bl = 0.2 * px;
    for (let r = 0, y = 0; y < S; r++, y += ch) {
      const off = (r & 1) ? bl / 2 : 0;
      for (let x = -off; x < S; x += bl) { const v = R(); g.fillStyle = v < 0.15 ? dark : v > 0.88 ? light : base; g.globalAlpha = 1; g.fillRect(x + 0.6, y + 0.8, bl - 1.2, ch - 1.2); if (R() < 0.5) { g.globalAlpha = 0.12; g.fillStyle = R() < 0.5 ? '#000' : '#fff'; g.fillRect(x + 1, y + 1, bl - 2, ch - 2); } }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${R() < 0.6 ? '30,18,14' : '190,150,120'},${R() * 0.06})`; g.fillRect(R() * S, R() * S, 8 + R() * 40, 3 + R() * 12); }
  };
  const cream = (g) => {
    g.fillStyle = '#c6b99d'; g.fillRect(0, 0, S, S);
    const ch = 0.0667 * py, bl = 0.2 * px;
    for (let r = 0, y = 0; y < S; r++, y += ch) { const off = (r & 1) ? bl / 2 : 0; for (let x = -off; x < S; x += bl) { const v = R(); g.fillStyle = v < 0.2 ? '#bdb094' : v > 0.85 ? '#cec3a8' : '#c6b99d'; g.fillRect(x + 0.7, y + 0.8, bl - 1.4, ch - 1.4); } }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(90,80,64,${R() * 0.05})`; g.fillRect(R() * S, R() * S, 10 + R() * 50, 4 + R() * 16); }
  };
  const windows = (g, base) => {
    for (const w of wins) {
      const x0 = w.cx - ww / 2, x1 = w.cx + ww / 2, yT = w.y1, yB = w.y0;
      // stain streak below the sill (brick only), the opening's dark reveal, lintel shadow
      if (base !== 'cream') { const gr = g.createLinearGradient(0, yB, 0, yB + 0.55 * py); gr.addColorStop(0, 'rgba(25,15,12,0.22)'); gr.addColorStop(1, 'rgba(25,15,12,0)'); g.fillStyle = gr; g.fillRect(x0 + 4, yB, ww - 8, 0.55 * py); }
      g.fillStyle = '#231a17'; g.fillRect(x0 - 3, yT - 3, ww + 6, yB - yT + 6);
      const fw = 0.06 * px, inset = 0.035 * px;
      g.fillStyle = '#e9e8e2'; g.fillRect(x0 + inset, yT + inset, ww - inset * 2, yB - yT - inset);
      // glass: two sashes (double-hung), sky reflection gradient, blinds / curtains on some
      const meet = yT + (yB - yT) * 0.47;
      for (const [s0, s1, top] of [[yT + inset + fw, meet - fw * 0.4, true], [meet + fw * 0.4, yB - fw, false]]) {
        const gx0 = x0 + inset + fw, gx1 = x1 - inset - fw; const gr = g.createLinearGradient(0, s0, 0, s1);
        const k = w.rnd; const sky = k < 0.3 ? ['#7e8f9f', '#34404b'] : k < 0.6 ? ['#5d6a76', '#262d34'] : ['#98a6b2', '#46525d'];
        gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]); g.fillStyle = gr; g.fillRect(gx0, s0, gx1 - gx0, s1 - s0);
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(gx0, s1); g.lineTo(gx0 + (gx1 - gx0) * 0.45, s0); g.lineTo(gx0 + (gx1 - gx0) * 0.62, s0); g.lineTo(gx0 + (gx1 - gx0) * 0.17, s1); g.fill();
        if (top && k > 0.62) { const f = 0.25 + ((k * 7.3) % 1) * 0.75; g.fillStyle = k > 0.85 ? '#b8a684' : '#e2ded3'; g.fillRect(gx0, s0, gx1 - gx0, (s1 - s0) * f); g.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = s0 + 3; y < s0 + (s1 - s0) * f; y += 3) g.fillRect(gx0, y, gx1 - gx0, 1); }
        if (!top && k > 0.78 && k < 0.85) { g.fillStyle = '#8b6c5a'; g.fillRect(gx0, s0, (gx1 - gx0) * 0.35, s1 - s0); }
      }
      g.fillStyle = '#d9d8d1'; g.fillRect(x0 + inset, meet - fw * 0.4, ww - inset * 2, fw * 0.8);         // meeting rail
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + inset, yT + inset, ww - inset * 2, 0.07 * py);   // head shadow in the reveal
      g.fillStyle = '#c9c3b5'; g.fillRect(x0 - 0.08 * px, yB, ww + 0.16 * px, 0.07 * py);                  // sill
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0 - 0.08 * px, yB + 0.07 * py, ww + 0.16 * px, 2);
    }
  };
  const make = (kind) => {
    const [c, g] = canvas(S, S);
    if (kind === 'cream') cream(g); else brick(g, '#6c3226', '#5a2a21', '#7a392c', '#6a5c53');
    if (kind === 'top') { for (let b = 0; b < TW; b++) for (const a of WIN_AT) { const cx = X(b + a), w = (WIN_W + 0.36) * px; g.fillStyle = '#c4b79b'; g.fillRect(cx - w / 2, 0, w, S); g.fillStyle = 'rgba(80,70,55,0.12)'; for (let f = 0; f < TH; f++) g.fillRect(cx - w / 2, Y(f + 1) - 1, w, 2); } }
    if (kind !== 'plain') windows(g, kind);
    return texOf(c, true, aniso);
  };
  // height field -> normal map (brick courses, window reveals, frames, sills) + roughness map (glass smooth)
  const [hc, hg] = canvas(S, S); const [rc, rg] = canvas(S, S);
  hg.fillStyle = '#c8c8c8'; hg.fillRect(0, 0, S, S); rg.fillStyle = 'rgb(0,240,0)'; rg.fillRect(0, 0, S, S);
  { const ch = 0.0667 * py, bl = 0.2 * px; hg.fillStyle = '#a0a0a0'; for (let r = 0, y = 0; y < S; r++, y += ch) { hg.fillRect(0, y, S, 1.2); const off = (r & 1) ? bl / 2 : 0; for (let x = -off; x < S; x += bl) hg.fillRect(x, y, 1.2, ch); } }
  const [pc, pg] = canvas(S, S); pg.drawImage(hc, 0, 0);
  for (const w of wins) {
    const x0 = w.cx - ww / 2, yT = w.y1, yB = w.y0; const inset = 0.035 * px, fw = 0.06 * px;
    for (const G of [hg, pg]) { G.fillStyle = '#202020'; G.fillRect(x0 - 3, yT - 3, ww + 6, yB - yT + 6); G.fillStyle = '#707070'; G.fillRect(x0 + inset, yT + inset, ww - inset * 2, yB - yT - inset); G.fillStyle = '#404040'; G.fillRect(x0 + inset + fw, yT + inset + fw, ww - 2 * inset - 2 * fw, yB - yT - inset - 2 * fw); G.fillStyle = '#ffffff'; G.fillRect(x0 - 0.08 * px, yB, ww + 0.16 * px, 0.07 * py); }
    rg.fillStyle = 'rgb(0,120,0)'; rg.fillRect(x0 + inset, yT + inset, ww - inset * 2, yB - yT - inset);
    rg.fillStyle = 'rgb(0,28,0)'; rg.fillRect(x0 + inset + fw, yT + inset + fw, ww - 2 * inset - 2 * fw, yB - yT - inset - 2 * fw);
  }
  const normalFrom = (hcv, strength) => {
    const src = hcv.getContext('2d').getImageData(0, 0, S, S).data; const [nc, ng] = canvas(S, S); const out = ng.createImageData(S, S); const d = out.data;
    const h = (x, y) => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength; const L = Math.hypot(dx, dy, 1); const i = (y * S + x) * 4;
      d[i] = (-dx / L * 0.5 + 0.5) * 255; d[i + 1] = (dy / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    ng.putImageData(out, 0, 0); return texOf(nc, false, aniso);
  };
  // night: lit windows (emissive; coney/horizon.js ramps the intensity with the evening): ~35% of the flats have a lamp on,
  // warm tungsten / cool LED / TV-blue, some half-covered by a blind
  const [lc, lg] = canvas(S, S); lg.fillStyle = '#000'; lg.fillRect(0, 0, S, S);
  for (const w of wins) {
    const k = (w.rnd * 9301 + w.cx * 0.37 + w.f * 0.71) % 1; if (k > 0.36) continue;
    const x0 = w.cx - ww / 2 + 0.1 * px, x1 = w.cx + ww / 2 - 0.1 * px, yT = w.y1 + 0.1 * py, yB = w.y0 - 0.06 * py;
    const col = k < 0.2 ? '#ffc98a' : k < 0.3 ? '#ffe7c4' : '#9fb8ff';
    const gr = lg.createLinearGradient(0, yT, 0, yB); gr.addColorStop(0, col); gr.addColorStop(1, k < 0.3 ? '#b8804a' : '#5a6aa8'); lg.fillStyle = gr; lg.fillRect(x0, yT, x1 - x0, yB - yT);
    if (w.rnd > 0.62) { lg.fillStyle = 'rgba(0,0,0,0.55)'; lg.fillRect(x0, yT, x1 - x0, (yB - yT) * 0.45); }
  }
  return { brick: make('brick'), cream: make('cream'), top: make('top'), plain: make('plain'), normal: normalFrom(hc, 2.2), normalPlain: normalFrom(pc, 2.2), rough: texOf(rc, false, aniso), lit: texOf(lc, true, aniso) };
}

function galleryTexture(aniso) {
  // one storey x 6 m of the open-gallery front: slab edge band, perforated railing panel, slim posts; everything else open
  // (refs 01/02: chain-link floor to ceiling on a galvanised pipe frame, white columns, a concrete slab edge)
  const W = 512, H = 256; const [c, g] = canvas(W, H); g.clearRect(0, 0, W, H);
  const py = H / ST, px = W / 6, MESH = 14;   // MESH: chain-link diamond pitch in px (~16 cm, readable at gallery distance)
  g.strokeStyle = 'rgba(178,176,166,0.95)'; g.lineWidth = 1.6;                                        // chain-link diamonds
  for (let k = -H; k < W + H; k += MESH) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke(); g.beginPath(); g.moveTo(k + H, 0); g.lineTo(k, H); g.stroke(); }
  g.fillStyle = '#7d786c'; g.fillRect(0, H - 0.24 * py, W, 0.24 * py);                              // slab edge
  g.fillStyle = 'rgba(40,36,30,0.6)'; g.fillRect(0, H - 0.24 * py, W, 2);
  g.fillStyle = '#a9aaa4'; g.fillRect(0, H - 1.08 * py, W, 0.06 * py); g.fillRect(0, H - 0.5 * py, W, 0.04 * py); g.fillRect(0, 0, W, 0.05 * py);   // pipe rails + head rail
  g.fillStyle = '#9a9b95'; for (let x = 0; x <= W; x += 1.5 * px) g.fillRect(x - 0.03 * px, 0, 0.06 * px, H);   // pipe posts
  g.fillStyle = '#dcdad2'; g.fillRect(0, 0, 0.2 * px, H); g.fillRect(W - 0.2 * px, 0, 0.2 * px, H);    // white column at the tile seam
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0.16 * px, 0, 0.04 * px, H);
  const t = texOf(c, true, aniso); return t;
}

/** the dark gallery back wall (6 m x 1 storey, 'gal' UVs): near-black painted block with apartment doors and small windows,
 *  darker under the slab above (the recess never sees the sky) — averages ~#151513 so the core reads as a black slot */
function galleryBackTexture(R, aniso) {
  const W = 512, H = 256; const [c, g] = canvas(W, H); const px = W / 6, py = H / ST;
  g.fillStyle = '#171715'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 400; i++) { const v = 14 + R() * 14; g.fillStyle = `rgba(${v},${v},${v - 2},0.5)`; g.fillRect(R() * W, R() * H, 2 + R() * 10, 1 + R() * 4); }
  for (const [x0, kind] of [[0.35, 'door'], [1.6, 'win'], [3.35, 'door'], [4.6, 'win']]) {
    if (kind === 'door') { g.fillStyle = '#23211e'; g.fillRect(x0 * px, H - 2.1 * py, 0.92 * px, 2.1 * py); g.fillStyle = '#2d2a26'; g.fillRect(x0 * px + 3, H - 2.05 * py, 0.92 * px - 6, 2.0 * py); g.fillStyle = '#5a5347'; g.fillRect((x0 + 0.75) * px, H - 1.05 * py, 4, 3); }
    else { g.fillStyle = '#0f1214'; g.fillRect(x0 * px, H - 2.05 * py, 1.2 * px, 1.1 * py); g.fillStyle = 'rgba(90,105,115,0.18)'; g.fillRect(x0 * px + 4, H - 2.0 * py, 1.2 * px - 8, 0.5 * py); g.fillStyle = '#34322d'; g.fillRect(x0 * px - 3, H - 0.95 * py, 1.2 * px + 6, 4); }
  }
  const gr = g.createLinearGradient(0, 0, 0, H * 0.45); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.45);   // slab-soffit occlusion
  const gb = g.createLinearGradient(0, H, 0, H * 0.85); gb.addColorStop(0, 'rgba(0,0,0,0.4)'); gb.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gb; g.fillRect(0, H * 0.85, W, H * 0.15);
  return texOf(c, true, aniso);
}

function lobbyFloorTexture(R) {
  // 12" VCT, light cream with a speckle (ref 03); the dark brown inlay squares down the centre are geometry (coreInterior)
  const S = 256; const [c, g] = canvas(S, S); const t = S / 4;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    g.fillStyle = R() < 0.5 ? '#ddd3bd' : '#d6ccb4'; g.fillRect(i * t, j * t, t, t);
    for (let k = 0; k < 90; k++) { g.fillStyle = `rgba(120,110,90,${R() * 0.35})`; g.fillRect(i * t + R() * t, j * t + R() * t, 1 + R() * 2, 1 + R() * 2); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(i * t, j * t, t, 1); g.fillRect(i * t, j * t, 1, t);
  }
  const x = texOf(c, true, 8); return x;
}

function lobbyWallTexture(R) {
  // one storey tall x 2.62 m: tan glazed structural brick (8" x 16" face, ref 03) on a dark brown cove base
  const W = 256, H = 256; const [c, g] = canvas(W, H); const py = H / ST, px = W / ST;
  g.fillStyle = '#b7a888'; g.fillRect(0, 0, W, H);   // mortar
  const bh = 0.2 * py, bl = 0.4 * px;
  for (let r = 0, y = H - 0.12 * py - bh; y > -bh; r++, y -= bh) for (let x = (r & 1) ? -bl / 2 : 0; x < W; x += bl) {
    const v = R(); g.fillStyle = v < 0.2 ? '#d5c6a2' : v > 0.85 ? '#e4d8b9' : '#dccfae'; g.fillRect(x + 1.5, y + 1.5, bl - 3, bh - 3);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 3, y + 3, bl - 6, 2);   // glaze highlight
  }
  g.fillStyle = '#4a2f22'; g.fillRect(0, H - 0.12 * py, W, 0.12 * py);
  return texOf(c, true, 8);
}

/** decorative cement breeze block (ref 02): a 2 x 2 tile of 40 cm blocks, each pierced by a four-petal pattern. 256 px. */
function breezeTexture() {
  const S = 256, b = S / 2; const [c, g] = canvas(S, S); g.fillStyle = '#9d968a'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x = i * b, y = j * b, cx = x + b / 2, cy = y + b / 2;
    g.fillStyle = '#cfc8b9'; g.fillRect(x + 3, y + 3, b - 6, b - 6);
    g.fillStyle = '#26231f';   // the pierced openings: four petals around a solid centre
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.moveTo(cx + dx * 8, cy + dy * 8); g.quadraticCurveTo(cx + dx * 46, cy + dy * 8, cx + dx * 50, cy + dy * 50); g.quadraticCurveTo(cx + dx * 8, cy + dy * 46, cx + dx * 8, cy + dy * 8); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x + 3, y + b - 6, b - 6, 3);
  }
  return texOf(c, true, 8);
}

function mailTexture(R) {
  // 0.6 m repeat: 2 x 4 small aluminium doors with a name slot and a keyhole
  const S = 256; const [c, g] = canvas(S, S); g.fillStyle = '#8d9194'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
    const x = i * 128 + 5, y = j * 64 + 4; g.fillStyle = '#b9bdbf'; g.fillRect(x, y, 118, 56);
    for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(255,255,255,${R() * 0.15})`; g.fillRect(x + R() * 118, y + R() * 56, 20 + R() * 40, 1); }
    g.fillStyle = '#f2efe6'; g.fillRect(x + 12, y + 10, 50, 10); g.fillStyle = '#3a3c3e'; g.beginPath(); g.arc(x + 98, y + 30, 5, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 55, 118, 2);
  }
  return texOf(c, true, 8);
}

/** NYCHA-style white-on-blue plaque (generic text only) */
function plaqueTexture(lines, bg = '#1f3f7a', { w = 512, h = 160, fg = '#ffffff' } = {}) {
  const [c, g] = canvas(w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 5; g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => { const px = Math.min(52, Math.floor((h - 40) / lines.length * 0.72)); g.font = `bold ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`; const m = g.measureText(t).width; if (m > w - 40) g.font = `bold ${Math.floor(px * (w - 40) / m)}px "Helvetica Neue", Helvetica, Arial, sans-serif`; g.fillText(t, w / 2, 20 + (h - 40) * (i + 0.5) / lines.length); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function floorNumberTexture(n) {
  const [c, g] = canvas(256, 256); g.fillStyle = '#d9b43a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(80,60,20,${Math.random() * 0.12})`; g.fillRect(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 14, 2 + Math.random() * 6); }
  g.fillStyle = '#141414'; g.font = 'bold 170px "Helvetica Neue", Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, 128, 138);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function fenceTexture() {
  // low black steel picket fence, one 2.4 m panel x 1.05 m
  const W = 256, H = 128; const [c, g] = canvas(W, H); g.clearRect(0, 0, W, H);
  g.fillStyle = '#16181a'; const px = W / 2.4, py = H / 1.05;
  g.fillRect(0, H - 1.0 * py, W, 0.05 * py); g.fillRect(0, H - 0.18 * py, W, 0.04 * py);
  for (let x = 0.06; x < 2.4; x += 0.13) { g.fillRect(x * px, H - 0.98 * py, Math.max(2, 0.022 * px), 0.92 * py); }
  g.lineWidth = 2; g.strokeStyle = '#16181a'; for (let x = 0.06; x + 0.13 < 2.4; x += 0.26) { g.beginPath(); g.arc((x + 0.065) * px, H - 1.0 * py, 0.065 * px, Math.PI, 0); g.stroke(); }
  return texOf(c, true, 4);
}

function acTexture() {
  const [c, g] = canvas(64, 64); g.fillStyle = '#d9d5cb'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(40,40,40,0.35)'; for (let y = 8; y < 44; y += 4) g.fillRect(6, y, 52, 2);
  g.fillStyle = 'rgba(90,80,60,0.25)'; g.fillRect(0, 54, 64, 10);
  return texOf(c, true, 4);
}

// ---------------------------------------------------------------------------------------------------------------------------
// materials
function makeHousingMats(world, M) {
  const R = world.R; const aniso = Math.min(16, world.ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8);
  const reg = (key, mat, surface, uvScale = 1) => { mat.name = key; M[key] = mat; M.surface[key] = surface; M.uvScale[key] = uvScale; return mat; };
  const T = facadeTextures(R, aniso);
  const fac = (map, normal, color = 0xffffff) => new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: T.rough, roughness: 1, metalness: 0, color, envMapIntensity: 0.55, emissiveMap: T.lit, emissive: 0xffffff, emissiveIntensity: 0 });
  reg('hBrickWin', fac(T.brick, T.normal, 0xe0d6d3), 'concrete');
  reg('hCreamWin', fac(T.cream, T.normal, 0xe2dbd0), 'concrete');
  { const t = paverTexture(); reg('hPaver', new THREE.MeshStandardMaterial({ map: t, roughness: 0.88, metalness: 0, envMapIntensity: 0.4 }), 'concrete', 1); }   // interlocking grey pavers on the walks
  reg('hBaseWin', fac(T.cream, T.normal, 0xa9adb0), 'concrete');   // the light grey brick base (floors 1-3), as on the real towers
  reg('hBrickTop', fac(T.top, T.normal, 0xe0d6d3), 'concrete');
  reg('hBrickPlain', new THREE.MeshStandardMaterial({ map: T.plain, normalMap: T.normalPlain, color: 0xe0d6d3, roughness: 0.92, metalness: 0, envMapIntensity: 0.5 }), 'concrete', 1 / 9.6);
  reg('hCreamPlain', new THREE.MeshStandardMaterial({ map: T.cream, color: 0xe2dbd0, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 }), 'concrete', 1 / 9.6);
  reg('hGallery', new THREE.MeshStandardMaterial({ map: galleryTexture(aniso), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.2 }), 'metal');
  reg('hGalleryBack', new THREE.MeshStandardMaterial({ map: galleryBackTexture(R, aniso), roughness: 0.9, metalness: 0, envMapIntensity: 0.25 }), 'concrete', 0.5);
  reg('hVestibule', new THREE.MeshStandardMaterial({ color: 0x3a3833, roughness: 0.85, metalness: 0 }), 'concrete', 0.5);
  reg('hSlab', new THREE.MeshStandardMaterial({ color: 0x7d786c, roughness: 0.9, metalness: 0 }), 'concrete', 0.5);
  reg('hRail', new THREE.MeshStandardMaterial({ color: 0x1d2022, roughness: 0.5, metalness: 0.6, envMapIntensity: 0.6 }), 'metal', 0.5);
  reg('hRoof', new THREE.MeshStandardMaterial({ color: 0x5f5c57, roughness: 0.95, metalness: 0 }), 'concrete', 0.25);
  reg('hFence', new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }), 'metal');
  reg('hDoor', new THREE.MeshStandardMaterial({ color: 0x1c2328, roughness: 0.15, metalness: 0.3, envMapIntensity: 1.1 }), 'metal', 0.5);
  { const g = M.grass.clone(); g.color = new THREE.Color(0x7aa650); reg('hLawn', g, 'ground', 1 / 2.5); }
  // lobby + elevators (hangout): brushed-steel doors, terrazzo floor, pale tile walls, glowing ceiling panels, lit call buttons
  { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#b9bdc1'; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 900; i++) { const v = 160 + Math.random() * 80; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(Math.random() * 64, Math.random() * 256, 1, 6 + Math.random() * 30); }
    g.fillStyle = '#3a3e42'; g.fillRect(31, 0, 2, 256);   // the split between the two leaves
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    reg('hElev', new THREE.MeshStandardMaterial({ map: t, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.2 }), 'metal', 1); }
  reg('hTerrazzo', new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.35, metalness: 0, envMapIntensity: 0.7 }), 'concrete', 0.5);
  { const t = lobbyFloorTexture(R); reg('hLobbyFloor', new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.3, metalness: 0, envMapIntensity: 0.8 }), 'concrete', 1 / 1.22); }
  { const t = lobbyWallTexture(R); reg('hLobbyWall', new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.16, roughness: 0.35, metalness: 0, envMapIntensity: 0.6 }), 'concrete', 1 / ST); }
  reg('hLobbyCeiling', new THREE.MeshStandardMaterial({ color: 0xd9d6cc, emissive: 0x2a2926, roughness: 0.9, metalness: 0 }), 'concrete', 0.5);
  reg('hLobbyGlass', new THREE.MeshStandardMaterial({ color: 0x8fa6ad, transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.4, side: THREE.DoubleSide }), 'metal', 0.5);
  { const t = mailTexture(R); reg('hMail', new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.35, metalness: 0.75, envMapIntensity: 1 }), 'metal', 1 / 0.6); }
  reg('hPanel', new THREE.MeshStandardMaterial({ color: 0xa3a8ab, roughness: 0.3, metalness: 0.85, envMapIntensity: 1.1 }), 'metal', 1);
  reg('hIndicator', new THREE.MeshStandardMaterial({ color: 0x2a1406, emissive: 0xff7a20, emissiveIntensity: 1.3, roughness: 0.4 }), 'metal', 1);
  reg('hDirectory', new THREE.MeshStandardMaterial({ map: plaqueTexture(['RESIDENTS & GUESTS ONLY', 'NO LOITERING · NO SMOKING'], '#1f3f7a'), roughness: 0.4, metalness: 0.1 }), 'metal', 1);
  { const t = floorNumberTexture('19'); reg('hFloor19', new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.8, metalness: 0 }), 'concrete', 1); }
  reg('hCouch', new THREE.MeshStandardMaterial({ color: 0x5a1a22, roughness: 0.55, metalness: 0 }), 'wood', 1);           // roof hangout: a dragged-up vinyl couch
  reg('hCrate', new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.7, metalness: 0 }), 'wood', 1);            // milk crates
  reg('hBoom', new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.4, metalness: 0.5 }), 'metal', 1);          // boombox
  reg('hBulb', new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 2.2 }), 'metal', 1); // string lights
  reg('hLobbyCeil', new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 1.1, roughness: 0.6 }), 'concrete', 0.5);
  reg('hButton', new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb040, emissiveIntensity: 2.2, roughness: 0.4 }), 'metal', 1);
  reg('hCanopy', new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.55, metalness: 0.5 }), 'metal', 0.5);
  // the core's galleries + halls (refs 01-03): breeze block, green steel doors, brown VCT inlays, grey conduit; the yard's plaza + bins
  reg('hBreeze', new THREE.MeshStandardMaterial({ map: breezeTexture(), roughness: 0.92, metalness: 0, emissive: 0x1a1814 }), 'concrete', 1 / 0.8);
  reg('hGreenDoor', new THREE.MeshStandardMaterial({ color: 0x1f4a33, roughness: 0.45, metalness: 0.4 }), 'metal', 0.5);
  reg('hInlay', new THREE.MeshStandardMaterial({ color: 0x4a2a1e, roughness: 0.3, metalness: 0, envMapIntensity: 0.8 }), 'concrete', 0.5);
  reg('hConduit', new THREE.MeshStandardMaterial({ color: 0x8c9094, roughness: 0.4, metalness: 0.7 }), 'metal', 0.5);
  reg('hPlaza', new THREE.MeshStandardMaterial({ color: 0x8f8b82, roughness: 0.95, metalness: 0 }), 'concrete', 0.25);
  reg('hBin', new THREE.MeshStandardMaterial({ color: 0x3b4f45, roughness: 0.6, metalness: 0.5 }), 'metal', 0.5);
  return M;
}

// ---------------------------------------------------------------------------------------------------------------------------
// local-frame geometry collector: quads + boxes per material, transformed into place at the end
class Local {
  constructor() { this.q = new Map(); this.boxes = []; this.cols = []; }
  arr(key) { return this.q.get(key) || this.q.set(key, { p: [], n: [], u: [] }).get(key); }
  /** quad from bottom-left, bottom-right, top-right, top-left (counter-clockwise seen from the front) */
  quad(key, a, b, c, d, uv) {
    const A = this.arr(key); const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const L = Math.hypot(...n) || 1; n = n.map((v) => v / L);
    for (const i of [0, 1, 2, 0, 2, 3]) { A.p.push(...[a, b, c, d][i]); A.n.push(...n); A.u.push(...uv[i]); }
  }
  /** upright quad centred at c facing horizontal normal n = [nx, nz], uv 0..1 reading left-to-right for a viewer in front */
  sign(key, c, n, w, h, uv = [0, 0, 1, 1]) {
    const rx = n[1] * w / 2, rz = -n[0] * w / 2, y0 = c[1] - h / 2, y1 = c[1] + h / 2;
    const [u0, v0, u1, v1] = uv;
    this.quad(key, [c[0] - rx, y0, c[2] - rz], [c[0] + rx, y0, c[2] + rz], [c[0] + rx, y1, c[2] + rz], [c[0] - rx, y1, c[2] - rz], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
  box(key, min, max, { uvScale = null, collide = true } = {}) { this.boxes.push([key, min, max, uvScale]); if (collide) this.cols.push([min, max]); }
  collide(min, max, cell) { this.cols.push([min, max, cell]); }   // cell: optional finer split (rotated towers: tight AABBs around narrow openings)
  emit(B, M, m, world, cell = 4) {
    for (const [key, A] of this.q) {
      if (!A.p.length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(A.u, 2));
      g.applyMatrix4(m); B.add(key, g, { uv: false });
    }
    for (const [key, min, max, s] of this.boxes) { const g = boxGeo(min, max); worldUV(g, s ?? (M.uvScale[key] ?? 0.5)); g.applyMatrix4(m); B.add(key, g, { uv: false }); }
    const v = new THREE.Vector3();
    for (const [mn, mx, cc] of this.cols) {
      const ce = cc || cell; const nx = Math.max(1, Math.ceil((mx[0] - mn[0]) / ce)), nz = Math.max(1, Math.ceil((mx[2] - mn[2]) / ce));
      const sx = (mx[0] - mn[0]) / nx, sz = (mx[2] - mn[2]) / nz;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const [px, pz] of [[mn[0] + i * sx, mn[2] + j * sz], [mn[0] + (i + 1) * sx, mn[2] + j * sz], [mn[0] + i * sx, mn[2] + (j + 1) * sz], [mn[0] + (i + 1) * sx, mn[2] + (j + 1) * sz]]) { v.set(px, 0, pz).applyMatrix4(m); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); }
        world.box([x0, mn[1], z0], [x1, mx[1], z1]);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// massing: canonical plan in (t, s) with the gallery spine along s; point-symmetric halves
function plan(R, H) {
  const bays = (L) => Math.max(1, Math.round(L / 4.8));
  const parts = [];
  const push = (t0, t1, s0, s1, floors, kind, extra = {}) => parts.push({ t0, t1, s0, s1, floors, kind, ...extra });
  for (const sg of [1, -1]) {
    const M = (t0, t1, s0, s1) => sg > 0 ? [t0, t1, s0, s1] : [-t1, -t0, -s1, -s0];
    // axial wing (the tall tower with the cream strip): one block, full height
    const hA = H + (sg > 0 ? 0 : (R() < 0.5 ? 0 : -1));
    push(...M(-10.5, 3.5, 19, 45.5), hA, 'wing', { entrance: sg > 0 ? 's1' : 's0', main: true });
    // perpendicular wing: 7 bays, steps down outward like the refs' 20 / 17 / 14 profile (4 bays at -3, 2 at -6, 1 at -8)
    const L = 32, n = bays(L), bw = L / n; let t = 3.5; const steps = [[4, hA - 3], [2, hA - 6], [n - 6, hA - 8]];
    for (const [k, fl] of steps) { if (k <= 0) continue; const t1 = t + k * bw; push(...M(t, t1, 8.5, 22.5), fl, 'wing', { bwT: bw, entrance: (t1 > 35) ? (sg > 0 ? 't1' : 't0') : null }); t = t1; }
  }
  push(-4.5, 3.5, -19, 19, H - 1, 'core');
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------------------
export function buildHousing(world, M) {
  makeHousingMats(world, M);
  return buildAll(world, M);
}

function buildAll(world, M) {
  const { scene, ctx, R } = world;
  const B = new GeoBatch(world, M, 'luna'), G = new GeoBatch(world, M, 'lunaGround');
  const towers = OSM.b.filter(isLunaTower);
  const acs = [];   // AC unit matrices (world)
  const trees = [];
  const lawnWorld = [];
  const others = OSM.b.filter((b) => !isLunaTower(b)).map((b) => b._bb || (b._bb = bbox(b.p)));
  const built = [];   // per tower: parts (local), local->world matrix, OSM centre

  for (const b of towers) {
    const ang = footprintAngle(b.p); const [ox, oz] = cen(b.p);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const loc = b.p.map(([x, z]) => [(x - ox) * c - (z - oz) * s, (x - ox) * s + (z - oz) * c]);
    const lb = bbox(loc); const spineX = (lb.x1 - lb.x0) > (lb.z1 - lb.z0);
    const cx = (lb.x0 + lb.x1) / 2, cz = (lb.z0 + lb.z1) / 2;
    const m = new THREE.Matrix4().makeTranslation(ox, 0, oz).multiply(new THREE.Matrix4().makeRotationY(-ang)).multiply(new THREE.Matrix4().makeTranslation(cx, 0, cz));
        const H = 20;   // every section flat at one roof line, as on the real towers (the core keeps its 19th-floor walkway)
    const pl = plan(R, H), coreF = (pl.find((p) => p.kind === 'core') || pl[0]).floors;
    const parts = pl.map((p0) => { const p = { ...p0, floors: coreF };
      // (t, s) -> local (x, z): spine along z unless the footprint's long axis is x
      const q = spineX ? { x0: p.s0, x1: p.s1, z0: p.t0, z1: p.t1 } : { x0: p.t0, x1: p.t1, z0: p.s0, z1: p.s1 };
      let ent = p.entrance; if (ent && spineX) ent = { s0: 'x0', s1: 'x1', t0: 'z0', t1: 'z1' }[ent]; else if (ent) ent = { s0: 'z0', s1: 'z1', t0: 'x0', t1: 'x1' }[ent];
      return { ...q, floors: p.floors, kind: p.kind, main: !!p.main, entrance: ent, top: p.floors * ST + PAR, galleryAxis: spineX ? 'x' : 'z' };
    });
    const L = new Local();
    const core = buildTower(L, parts, R, acs, m);
    if (core) (world.lunaTowers || (world.lunaTowers = [])).push(towerInfo(core, m, [ox, oz]));
    L.emit(B, M, m, world);
    built.push({ parts, m, ang, c: [ox, oz], lc: [cx, cz] });
  }
  // the yard first (boulevards + plaza, lunayard.js), so the lawn grid of every tower leaves their footprints clear
  const yard = planYard(built);
  for (const t of built) grounds(G, B, world, M, t.parts, t.m, t.ang, t.c, t.lc, trees, others, yard.noLawn);   // lawns, fences, paths, trees
  { const Y = new Local(); buildYard(world, M, Y, yard, trees); Y.emit(G, M, new THREE.Matrix4(), world, 3); }

  // ---- AC units (instanced, capped) ----------------------------------------------------------------------------------
  const MAX_AC = 3000; let list = acs; if (list.length > MAX_AC) { list = []; const p = MAX_AC / acs.length; for (const a of acs) if (R() < p && list.length < MAX_AC) list.push(a); }
  if (list.length) {
    const g = new THREE.BoxGeometry(0.66, 0.42, 0.52);
    const mat = new THREE.MeshStandardMaterial({ map: acTexture(), roughness: 0.6, metalness: 0.2 });
    const im = new THREE.InstancedMesh(g, mat, list.length); const col = new THREE.Color();
    list.forEach((a, i) => { im.setMatrixAt(i, a); const v = 0.82 + R() * 0.2; col.setRGB(v, v * (0.98 + R() * 0.03), v * (0.93 + R() * 0.05)); im.setColorAt(i, col); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true; im.name = 'luna:ac'; im.userData.surface = 'metal'; im.computeBoundingSphere?.();
    scene.add(im); ctx.raycastTargets.push(im);
  }
  B.flush({ shadow: true }); G.flush({ shadow: false });
  plantTrees(world, trees);
  world.W.luna = world.lunaTowers;   // QA: window.__ctx.world.luna[i].top[s].view / cars
  return { towers: towers.length, ac: list.length, trees: trees.length };
}

// ---------------------------------------------------------------------------------------------------------------------------
/** faces of an axis-aligned local box: plane, outward normal, along-axis range, "right" direction as seen from outside */
function facesOf(p) {
  return [
    { id: 'x0', axis: 'z', c: p.x0, n: [-1, 0], a0: p.z0, a1: p.z1, dir: 1 },
    { id: 'x1', axis: 'z', c: p.x1, n: [1, 0], a0: p.z0, a1: p.z1, dir: -1 },
    { id: 'z0', axis: 'x', c: p.z0, n: [0, -1], a0: p.x0, a1: p.x1, dir: -1 },
    { id: 'z1', axis: 'x', c: p.z1, n: [0, 1], a0: p.x0, a1: p.x1, dir: 1 },
  ];
}

function buildTower(L, parts, R, acs, m) {
  let core = null;
  const P = (f, a, y, o) => f.axis === 'z' ? [f.c + f.n[0] * o, y, a] : [a, y, f.c + f.n[1] * o];
  const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  /** rect on a face: [aL,aR] x [yB,yT] at offset o, u = along/bw (tile = 2 bays), v = y / 4 storeys */
  const rect = (key, f, aL, aR, yB, yT, o, bw, uvMode = 'fac') => {
    const lo = Math.min(aL, aR), hi = Math.max(aL, aR); if (hi - lo < 0.01 || yT - yB < 0.01) return;
    const l = f.dir > 0 ? lo : hi, r = f.dir > 0 ? hi : lo;
    const U = (a) => uvMode === 'gal' ? (f.dir > 0 ? a - f.a0 : f.a1 - a) / 6 : (f.dir > 0 ? a - f.a0 : f.a1 - a) / bw / TILE_BAYS;
    const V = (y) => uvMode === 'gal' ? y / ST : y / (ST * TILE_FLOORS);
    L.quad(key, P(f, l, yB, o), P(f, r, yB, o), P(f, r, yT, o), P(f, l, yT, o), [[U(l), V(yB)], [U(r), V(yB)], [U(r), V(yT)], [U(l), V(yT)]]);
  };
  const BASE_TOP = 3 * ST, rectB = (key, f, aL, aR, yB, yT, o, bw) => { if (yB < BASE_TOP) rect('hBaseWin', f, aL, aR, yB, Math.min(yT, BASE_TOP), o, bw); if (yT > BASE_TOP) rect(key, f, aL, aR, Math.max(yB, BASE_TOP), yT, o, bw); };   // floors 1-3 in grey brick
  /** a quad perpendicular to the face at along-position a, spanning offsets o0..o1 (outward), facing `side` (+1 = +a) */
  const side = (key, f, a, o0, o1, yB, yT, sgn) => {
    const A = (o) => P(f, a, 0, o); const p0 = A(o0), p1 = A(o1);
    // choose order so the normal points toward sgn along the face axis
    const bl = [p0[0], yB, p0[2]], br = [p1[0], yB, p1[2]], tr = [p1[0], yT, p1[2]], tl = [p0[0], yT, p0[2]];
    const e1 = [br[0] - bl[0], 0, br[2] - bl[2]]; // normal = e1 x up = (-e1z, 0, e1x)... pick winding by test
    const nx = -e1[2], nz = e1[0]; const along = f.axis === 'z' ? nz : nx;
    const uvs = [[0, yB / 10], [Math.abs(o1 - o0) / 10, yB / 10], [Math.abs(o1 - o0) / 10, yT / 10], [0, yT / 10]];
    if (along * sgn > 0) L.quad(key, bl, br, tr, tl, uvs); else L.quad(key, br, bl, tl, tr, uvs);
  };

  for (const p of parts) {
    const Hw = p.floors * ST, Ht = Hw + PAR;
    for (const f of facesOf(p)) {
      const len = f.a1 - f.a0; const nb = Math.max(1, Math.round(len / 4.8)); const bw = len / nb;
      // neighbours touching this face plane from outside -> covered intervals up to their top
      const cov = [];
      for (const o of parts) { if (o === p) continue;
        const touch = f.axis === 'z' ? (f.n[0] > 0 ? Math.abs(o.x0 - f.c) < 0.05 : Math.abs(o.x1 - f.c) < 0.05) : (f.n[1] > 0 ? Math.abs(o.z0 - f.c) < 0.05 : Math.abs(o.z1 - f.c) < 0.05);
        if (!touch) continue; const b0 = f.axis === 'z' ? o.z0 : o.x0, b1 = f.axis === 'z' ? o.z1 : o.x1; const lo = Math.max(f.a0, b0), hi = Math.min(f.a1, b1); if (hi - lo > 0.05) cov.push([lo, hi, o.top]);
      }
      const isGallery = p.kind === 'core' && f.axis === p.galleryAxis;
      // cream strip: bays [k0,k1) centred; end faces always, long faces on a coin flip; floors 1 .. top-4
      // refs: brick in the bottom 2 floors, the top 3 floors and the outer bays; <= 6 bays wide on the main wings, 4 on the steps
      let strip = null;
      if (!isGallery && p.kind !== 'core' && nb >= 3 && p.floors >= 9 && (len < 17 || R() < 0.6)) {
        const k = Math.min(p.main ? 6 : 4, nb - 2 - (nb >= 6 && R() < 0.4 ? 1 : 0)); const k0 = Math.floor((nb - k) / 2); const k1 = Math.min(nb, k0 + k);
        const u0 = f.dir > 0 ? f.a0 + k0 * bw : f.a1 - k1 * bw, u1 = f.dir > 0 ? f.a0 + k1 * bw : f.a1 - k0 * bw;
        if (k >= 1) strip = { a0: u0, a1: u1, y0: ST * 2, y1: Hw - ST * 3 };
      }
      // entrance door on this face?
      let door = null;
      if (p.entrance === f.id || (isGallery)) { const mid = (f.a0 + f.a1) / 2; door = { a0: mid - 1.6, a1: mid + 1.6 }; }
      const cuts = new Set([f.a0, f.a1]); for (const [lo, hi] of cov) { cuts.add(lo); cuts.add(hi); }
      if (strip) { cuts.add(strip.a0); cuts.add(strip.a1); }
      const xs = [...cuts].filter((v) => v >= f.a0 - 1e-6 && v <= f.a1 + 1e-6).sort((a, b) => a - b);
      // gallery: visible runs (for recess side walls)
      for (let i = 0; i + 1 < xs.length; i++) {
        const a = xs[i], bnd = xs[i + 1]; if (bnd - a < 0.02) continue; const mid = (a + bnd) / 2;
        let yb = 0; for (const [lo, hi, top] of cov) if (mid > lo && mid < hi) yb = Math.max(yb, top);
        if (yb >= Ht - 0.01) continue;
        if (isGallery) {
          const yg = Math.max(yb, 0);
          if (yg < Hw) {
            { // gallery back wall — cut open on the 19th floor between the walkway gates (the elevator lobby's walls stand there)
              const y0 = Math.max(yg, ST), yF = (Math.min(19, p.floors) - 1) * ST, gm = (f.a0 + f.a1) / 2, lo = Math.min(a, bnd), hi = Math.max(a, bnd);
              const w0 = Math.max(lo, gm - WALK_HALF), w1 = Math.min(hi, gm + WALK_HALF);
              if (w1 - w0 > 0.01 && y0 < yF && Hw > yF + ST) {
                rect('hGalleryBack', f, a, bnd, y0, yF, -GALV, bw, 'gal'); rect('hGalleryBack', f, a, bnd, yF + ST, Hw, -GALV, bw, 'gal');
                if (w0 > lo) rect('hGalleryBack', f, lo, w0, yF, yF + ST, -GALV, bw, 'gal');
                if (hi > w1) rect('hGalleryBack', f, w1, hi, yF, yF + ST, -GALV, bw, 'gal');
              } else rect('hGalleryBack', f, a, bnd, y0, Hw, -GALV, bw, 'gal');
            }
            if (yg < ST) { // ground floor at the lobby line: lit lobby glass (hangout lobby, see coreInterior) with the entrance gap, brick beyond
              const mid = f.axis === 'z' ? (p.z0 + p.z1) / 2 : (p.x0 + p.x1) / 2, lo = Math.min(a, bnd), hi = Math.max(a, bnd);
              const cutsG = [lo, hi, mid - LOBBY_HALF, mid - DOOR_HALF, mid + DOOR_HALF, mid + GROUND_HI].filter((v) => v >= lo && v <= hi).sort((u, v) => u - v);
              for (let k = 0; k + 1 < cutsG.length; k++) {
                const u0 = cutsG[k], u1 = cutsG[k + 1], um = (u0 + u1) / 2; if (u1 - u0 < 0.01) continue;
                if (Math.abs(um - mid) < DOOR_HALF) { rect('hSlab', f, u0, u1, ST - 0.42, ST, -GAL, bw); continue; }   // concrete beam over the open breezeway
                if (um > mid - LOBBY_HALF && um < mid + GROUND_HI) {
                  rect('hLobbyGlass', f, u0, u1, 0, ST, -GAL, bw);
                  const nm = Math.max(1, Math.round((u1 - u0) / 1.5)); for (let j = 0; j <= nm; j++) mullion(L, f, P, u0 + (u1 - u0) * j / nm, -GAL, 0, ST);
                  continue;
                }
                rect('hBrickWin', f, u0, u1, 0, ST, -GAL, bw);
              }
              for (const e of [mid - DOOR_HALF, mid + DOOR_HALF]) if (e > lo && e < hi) mullion(L, f, P, e, -GAL, 0, ST, 0.09);
              if (mid - DOOR_HALF > lo && mid + DOOR_HALF < hi) { const t0 = P(f, mid - DOOR_HALF, ST - 0.47, -GAL - 0.05), t1 = P(f, mid + DOOR_HALF, ST - 0.4, -GAL + 0.07); L.box('hSlab', [Math.min(t0[0], t1[0]), ST - 0.47, Math.min(t0[2], t1[2])], [Math.max(t0[0], t1[0]), ST - 0.4, Math.max(t0[2], t1[2])], { collide: false }); }
              // the strip between the lobby line and the deeper gallery wall stays dark under the first slab
              rect('hGalleryBack', f, a, bnd, ST - 0.02, ST, -GALV, bw);
            }
            rect('hGallery', f, a, bnd, Math.max(yg, ST), Hw, 0, bw, 'gal');
            // slabs (their edges show at oblique angles, their soffits when looking up)
            for (let fl = 1; fl <= p.floors; fl++) { const y = fl * ST; if (y < yg) continue; const lo = Math.min(a, bnd), hi = Math.max(a, bnd); const o0 = -GALV, o1 = 0; const mn = f.axis === 'z' ? [Math.min(f.c + f.n[0] * o0, f.c + f.n[0] * o1), y - 0.02, lo] : [lo, y - 0.02, Math.min(f.c + f.n[1] * o0, f.c + f.n[1] * o1)]; const mx = f.axis === 'z' ? [Math.max(f.c + f.n[0] * o0, f.c + f.n[0] * o1), y + 0.23, hi] : [hi, y + 0.23, Math.max(f.c + f.n[1] * o0, f.c + f.n[1] * o1)]; L.box('hSlab', mn, mx, { collide: false }); }
            // recess side walls where the run ends against a covering neighbour or the face end
            const prevCovered = i === 0 || (() => { const m0 = (xs[i - 1] + a) / 2; let y = 0; for (const [lo, hi, top] of cov) if (m0 > lo && m0 < hi) y = Math.max(y, top); return y > yg + 0.1; })();
            const nextCovered = i + 2 >= xs.length || (() => { const m0 = (bnd + xs[i + 2]) / 2; let y = 0; for (const [lo, hi, top] of cov) if (m0 > lo && m0 < hi) y = Math.max(y, top); return y > yg + 0.1; })();
            if (prevCovered) side('hBrickPlain', f, a, -GALV, 0, yg, Hw, 1);
            if (nextCovered) side('hBrickPlain', f, bnd, -GALV, 0, yg, Hw, -1);
            // entrance canopy in front of the lobby
            if (door && mid > door.a0 - 3 && mid < door.a1 + 3 && yg < 0.1 && a <= (door.a0 + door.a1) / 2 && bnd >= (door.a0 + door.a1) / 2) canopy(L, f, P, (door.a0 + door.a1) / 2, 0);
          }
          if (yb < Ht) rect('hBrickPlain', f, a, bnd, Math.max(yb, Hw), Ht, 0, bw);
          continue;
        }
        const inStrip = strip && mid > Math.min(strip.a0, strip.a1) && mid < Math.max(strip.a0, strip.a1);
        if (inStrip) {
          if (strip.y0 > yb) rectB('hBrickWin', f, a, bnd, yb, strip.y0, 0, bw);
          const c0 = Math.max(yb, strip.y0), c1 = Math.min(strip.y1, Hw);
          if (c1 > c0) {
            rectB('hCreamWin', f, a, bnd, c0, c1, 0.1, bw);
            if (Math.abs(a - Math.min(strip.a0, strip.a1)) < 1e-3) side('hCreamPlain', f, a, 0, 0.1, c0, c1, -1);
            if (Math.abs(bnd - Math.max(strip.a0, strip.a1)) < 1e-3) side('hCreamPlain', f, bnd, 0, 0.1, c0, c1, 1);
          }
          if (Hw > Math.max(yb, strip.y1)) rect('hBrickTop', f, a, bnd, Math.max(yb, strip.y1), Hw, 0, bw);
        } else if (Hw > yb) rectB('hBrickWin', f, a, bnd, yb, Hw, 0, bw);
        rect('hBrickPlain', f, a, bnd, Math.max(yb, Hw), Ht, 0, bw);
        // AC units under / in the windows of this run
        for (let k = 0; k < nb; k++) for (const w of WIN_AT) {
          const u = (k + w) * bw; const aw = f.dir > 0 ? f.a0 + u : f.a1 - u; if (!(aw > Math.min(a, bnd) + 0.4 && aw < Math.max(a, bnd) - 0.4)) continue;
          const onStrip = strip && aw > Math.min(strip.a0, strip.a1) && aw < Math.max(strip.a0, strip.a1);
          for (let fl = 1; fl < p.floors; fl++) {
            if (R() > 0.3) continue; const sleeve = R() < 0.45; const y = fl * ST + SILL + (sleeve ? -0.42 : 0.24); if (y < yb + 0.3) continue;
            const off = (onStrip && fl * ST >= strip.y0 && fl * ST < strip.y1 ? 0.1 : 0) + (sleeve ? 0.14 : 0.02);
            const pt = P(f, aw, y, off); pos.set(pt[0], pt[1], pt[2]);
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.n[0], f.n[1]));
            acs.push(new THREE.Matrix4().multiplyMatrices(m, tmp.compose(pos, q, sc)));
          }
        }
      }
      if (door && !isGallery) {
        const dA = door.a0, dB = door.a1; rect('hDoor', f, dA, dB, 0, 2.7, 0.03, bw);
        for (const aa of [dA, dB]) { const mn = P(f, aa - 0.08, 0, 0), mx = P(f, aa + 0.08, 2.85, 0.12); L.box('hRail', [Math.min(mn[0], mx[0]), 0, Math.min(mn[2], mx[2])], [Math.max(mn[0], mx[0]), 2.85, Math.max(mn[2], mx[2])], { collide: false }); }
        const t0 = P(f, dA - 0.08, 2.7, 0), t1 = P(f, dB + 0.08, 2.85, 0.12); L.box('hRail', [Math.min(t0[0], t1[0]), 2.7, Math.min(t0[2], t1[2])], [Math.max(t0[0], t1[0]), 2.85, Math.max(t0[2], t1[2])], { collide: false });
        canopy(L, f, P, (dA + dB) / 2, 0);
      }
    }
    // roof: deck, dark coping, guard railing (skipping edges against taller neighbours), bulkheads
    if (p.kind !== 'core') L.box('hRoof', [p.x0, Ht - 0.12, p.z0], [p.x1, Ht - 0.02, p.z1], { collide: false });   // the core's deck has the stair opening (coreInterior)
    if (p.kind === 'core') core = coreInterior(L, p, Ht); else L.collide([p.x0, 0, p.z0], [p.x1, Ht, p.z1]);
    const cp = 0.07;
    for (const [mn, mx] of [[[p.x0 - cp, Ht - 0.22, p.z0 - cp], [p.x1 + cp, Ht, p.z0 + 0.25]], [[p.x0 - cp, Ht - 0.22, p.z1 - 0.25], [p.x1 + cp, Ht, p.z1 + cp]], [[p.x0 - cp, Ht - 0.22, p.z0], [p.x0 + 0.25, Ht, p.z1]], [[p.x1 - 0.25, Ht - 0.22, p.z0], [p.x1 + cp, Ht, p.z1]]]) L.box('hRail', mn, mx, { collide: false });
    for (const f of facesOf(p)) {
      let blocked = 0; for (const o of parts) { if (o === p || o.top < Ht - 0.1) continue; const touch = f.axis === 'z' ? (f.n[0] > 0 ? Math.abs(o.x0 - f.c) < 0.05 : Math.abs(o.x1 - f.c) < 0.05) : (f.n[1] > 0 ? Math.abs(o.z0 - f.c) < 0.05 : Math.abs(o.z1 - f.c) < 0.05); if (!touch) continue; const b0 = f.axis === 'z' ? o.z0 : o.x0, b1 = f.axis === 'z' ? o.z1 : o.x1; blocked += Math.max(0, Math.min(f.a1, b1) - Math.max(f.a0, b0)); }
      if (blocked > (f.a1 - f.a0) * 0.5) continue;
      const ins = 0.35; const a0 = f.a0 + ins, a1 = f.a1 - ins; const cc = f.c - (f.axis === 'z' ? f.n[0] : f.n[1]) * ins;
      const seg = (lo, hi, y0, y1, w) => { const mn = f.axis === 'z' ? [cc - w, y0, lo] : [lo, y0, cc - w], mx = f.axis === 'z' ? [cc + w, y1, hi] : [hi, y1, cc + w]; L.box('hRail', mn, mx, { collide: false }); };
      seg(a0, a1, Ht + 1.02, Ht + 1.08, 0.03); seg(a0, a1, Ht + 0.5, Ht + 0.54, 0.02);
      const np = Math.max(2, Math.round((a1 - a0) / 2.6)); for (let i = 0; i <= np; i++) { const a = a0 + (a1 - a0) * i / np; seg(a - 0.03, a + 0.03, Ht, Ht + 1.08, 0.03); }
    }
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    if (p.kind === 'core') {
      // beige penthouse (machine room) + elevator overrun, like the refs
      const ax = p.galleryAxis === 'x'; const L0 = (ax ? w : d);
      const c0 = [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2];
      const hw = ax ? [L0 * 0.18, d / 2 - 0.6] : [w / 2 - 0.6, L0 * 0.18];
      L.box('hCreamPlain', [c0[0] - hw[0], Ht - 0.1, c0[1] - hw[1]], [c0[0] + hw[0], Ht + 5.4, c0[1] + hw[1]], { uvScale: 1 / 9.6 });
      L.box('hRail', [c0[0] - hw[0] - 0.08, Ht + 5.4, c0[1] - hw[1] - 0.08], [c0[0] + hw[0] + 0.08, Ht + 5.6, c0[1] + hw[1] + 0.08], { collide: false });
      const e = ax ? [hw[0] * 0.45, hw[1] * 0.7] : [hw[0] * 0.7, hw[1] * 0.45];
      L.box('hCreamPlain', [c0[0] - e[0], Ht + 5.4, c0[1] - e[1]], [c0[0] + e[0], Ht + 8.2, c0[1] + e[1]], { uvScale: 1 / 9.6 });
      L.box('hGalleryBack', ax ? [c0[0] - hw[0] * 0.6, Ht + 1.2, c0[1] - hw[1] - 0.03] : [c0[0] - hw[0] - 0.03, Ht + 1.2, c0[1] - hw[1] * 0.6], ax ? [c0[0] + hw[0] * 0.6, Ht + 2.4, c0[1] + hw[1] + 0.03] : [c0[0] + hw[0] + 0.03, Ht + 2.4, c0[1] + hw[1] * 0.6], { collide: false });   // louvre band
      L.box('hRail', [c0[0] + e[0] * 0.3, Ht + 8.2, c0[1] - 0.2], [c0[0] + e[0] * 0.3 + 0.4, Ht + 9.6, c0[1] + 0.2], { collide: false });  // vent stack
    } else if (w > 8 && d > 8 && p.floors >= H0(parts) - 3) {
      // stair / elevator bulkhead in brick + a small cream one
      const bx = p.x0 + w * (0.3 + R() * 0.2), bz = p.z0 + d * (0.3 + R() * 0.2);
      L.box('hBrickPlain', [bx - 2.4, Ht - 0.1, bz - 1.8], [bx + 2.4, Ht + 3.2, bz + 1.8], { uvScale: 1 / 9.6 });
      L.box('hRail', [bx - 2.5, Ht + 3.2, bz - 1.9], [bx + 2.5, Ht + 3.4, bz + 1.9], { collide: false });
      L.box('hDoor', [bx - 0.5, Ht, bz - 1.83], [bx + 0.5, Ht + 2.1, bz - 1.8], { collide: false });
      if (R() < 0.6) L.box('hCreamPlain', [bx + 3.5, Ht - 0.1, bz - 1], [bx + 5.3, Ht + 2.2, bz + 1], { uvScale: 1 / 9.6 });
    }
  }
  return core;
}
const H0 = (parts) => Math.max(...parts.map((p) => p.floors));

/** vertical lobby-glass mullion at along-position a (offset o), y0..y1 */
function mullion(L, f, P, a, o, y0, y1, w = 0.05) {
  const p0 = P(f, a - w, y0, o - 0.06), p1 = P(f, a + w, y1, o + 0.06);
  L.box('hRail', [Math.min(p0[0], p1[0]), y0, Math.min(p0[2], p1[2])], [Math.max(p0[0], p1[0]), y1, Math.max(p0[2], p1[2])], { collide: false });
}

function canopy(L, f, P, a, o) {
  // flat steel entrance canopy on two posts: 5.2 m wide, 3 m deep, soffit at 2.95 m
  const box = (a0, a1, o0, o1, y0, y1, key, col = false) => { const p0 = P(f, a0, y0, o0), p1 = P(f, a1, y1, o1); L.box(key, [Math.min(p0[0], p1[0]), y0, Math.min(p0[2], p1[2])], [Math.max(p0[0], p1[0]), y1, Math.max(p0[2], p1[2])], { collide: col }); };
  box(a - 2.6, a + 2.6, o, o + 3.0, 2.95, 3.25, 'hCanopy');
  for (const s of [-1.3, 1.3]) box(a + s - 0.22, a + s + 0.22, o + 1.3, o + 1.74, 2.93, 2.95, 'hLobbyCeil');   // downlights
  box(a - 2.65, a + 2.65, o + 2.95, o + 3.05, 2.9, 3.45, 'hRail');
  for (const s of [-1, 1]) box(a + s * 2.4 - 0.07, a + s * 2.4 + 0.07, o + 2.75, o + 2.89, 0, 2.95, 'hRail', true);
}

// ---------------------------------------------------------------------------------------------------------------------------
// grounds: lawn cells (local 2 m grid) kept clear of the buildings (3.5 m walks), streets, lots, courts, other buildings and
// entrance paths; low black fence along every lawn edge; trees on the lawn interiors.
function grounds(G, B, world, M, parts, m, ang, [ox, oz], [cx, cz], trees, others, noLawn) {
  const R = world.R; const CELL = 2;
  const v = new THREE.Vector3(); const W = (lx, lz) => { v.set(lx, 0, lz).applyMatrix4(m); return [v.x, v.z]; };
  const x0 = Math.min(...parts.map((p) => p.x0)) - 26, x1 = Math.max(...parts.map((p) => p.x1)) + 26, z0 = Math.min(...parts.map((p) => p.z0)) - 26, z1 = Math.max(...parts.map((p) => p.z1)) + 26;
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const [wx0, wz0] = W(x0, z0), [wx1, wz1] = W(x1, z1), [wx2, wz2] = W(x0, z1), [wx3, wz3] = W(x1, z0);
  const wb = { x0: Math.min(wx0, wx1, wx2, wx3) - 30, x1: Math.max(wx0, wx1, wx2, wx3) + 30, z0: Math.min(wz0, wz1, wz2, wz3) - 30, z1: Math.max(wz0, wz1, wz2, wz3) + 30 };
  const hit = (q) => q.x1 > wb.x0 && q.x0 < wb.x1 && q.z1 > wb.z0 && q.z0 < wb.z1;
  const roads = OSM.r.filter((r) => hit(bbox(r.p))); const lots = OSM.l.filter((p) => hit(bbox(p))); const courts = OSM.pt.filter((o) => hit(bbox(o.p)));
  const obs = others.filter(hit); const walks = OSM.w.filter((w) => hit(bbox(w.p)));
  const distBox = (lx, lz) => { let d = 1e9; for (const p of parts) { const dx = Math.max(p.x0 - lx, 0, lx - p.x1), dz = Math.max(p.z0 - lz, 0, lz - p.z1); d = Math.min(d, Math.hypot(dx, dz)); } return d; };
  // entrance path lines (local): from each door straight out
  const paths = [];
  for (const p of parts) {
    if (p.entrance) { const f = facesOf(p).find((f) => f.id === p.entrance); paths.push({ axis: f.axis, a: (f.a0 + f.a1) / 2, c: f.c, dirn: f.axis === 'z' ? f.n[0] : f.n[1] }); }
    if (p.kind === 'core') for (const f of facesOf(p)) if (f.axis === p.galleryAxis) paths.push({ axis: f.axis, a: (f.a0 + f.a1) / 2, c: f.c, dirn: f.axis === 'z' ? f.n[0] : f.n[1] });
  }
  const onPath = (lx, lz) => paths.some((q) => { const along = q.axis === 'z' ? lz : lx, perp = q.axis === 'z' ? lx : lz; return Math.abs(along - q.a) < 1.8 && (perp - q.c) * q.dirn > -1; });
  const lawn = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const lx = x0 + (i + 0.5) * CELL, lz = z0 + (j + 0.5) * CELL;
    if (distBox(lx, lz) < 3.5 || onPath(lx, lz)) continue;
    const [x, z] = W(lx, lz);
    if (roads.some((r) => segDist(x, z, r.p) < r.w / 2 + 2.6)) continue;
    if (walks.some((w) => segDist(x, z, w.p) < w.w / 2 + 0.8)) continue;
    if (noLawn(x, z)) continue;   // boulevards + the plaza (lunayard.js)
    if (lots.some((p) => pip(x, z, p)) || courts.some((o) => pip(x, z, o.p))) continue;
    if (obs.some((q) => x > q.x0 - 3 && x < q.x1 + 3 && z > q.z0 - 3 && z < q.z1 + 3)) continue;
    lawn[i * nz + j] = 1;
  }
  // drop isolated specks (fewer than 3 lawn neighbours)
  const L = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && lawn[i * nz + j] === 1;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (L(i, j)) { let n = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (L(i + di, j + dj)) n++; if (n < 2) lawn[i * nz + j] = 0; }
  const loc = new Local();
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (L(i, j)) {
    const a = x0 + i * CELL, b = z0 + j * CELL, y = 0.028;
    loc.quad('hLawn', [a, y, b + CELL], [a + CELL, y, b + CELL], [a + CELL, y, b], [a, y, b], [[a / 2.5, b / 2.5 + CELL / 2.5], [(a + CELL) / 2.5, (b + CELL) / 2.5], [(a + CELL) / 2.5, b / 2.5], [a / 2.5, b / 2.5]].map(([u, w]) => [u, w]));
  }
  // walkways: grey concrete pavers on the non-lawn cells between the lawns (within 2 cells of one)
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (!L(i, j)) { let nearL = false; for (let di = -2; di <= 2 && !nearL; di++) for (let dj = -2; dj <= 2; dj++) if (L(i + di, j + dj)) { nearL = true; break; } if (!nearL) continue;
    const a = x0 + i * CELL, b = z0 + j * CELL, y = 0.05; loc.quad('hPaver', [a, y, b + CELL], [a + CELL, y, b + CELL], [a + CELL, y, b], [a, y, b], [[a / 1.6, (b + CELL) / 1.6], [(a + CELL) / 1.6, (b + CELL) / 1.6], [(a + CELL) / 1.6, b / 1.6], [a / 1.6, b / 1.6]]);
  }
  // lawn edge runs -> fence (0.3 m inside the lawn) + concrete curb
  const runs = [];
  for (let i = 0; i < nx; i++) { let start = null, sideS = 0; for (const s of [-1, 1]) { start = null; for (let j = 0; j <= nz; j++) { const e = j < nz && L(i, j) && !L(i + s, j); if (e && start === null) start = j; if (!e && start !== null) { runs.push({ s, axis: 'z', c: x0 + (i + (s > 0 ? 1 : 0)) * CELL - s * 0.3, a0: z0 + start * CELL, a1: z0 + j * CELL }); start = null; } } } }
  for (let j = 0; j < nz; j++) { for (const s of [-1, 1]) { let start = null; for (let i = 0; i <= nx; i++) { const e = i < nx && L(i, j) && !L(i, j + s); if (e && start === null) start = i; if (!e && start !== null) { runs.push({ s, axis: 'x', c: z0 + (j + (s > 0 ? 1 : 0)) * CELL - s * 0.3, a0: x0 + start * CELL, a1: x0 + i * CELL }); start = null; } } } }
  // flower-bed spots for greens.js: tucked into the lawn at both ends of every fence run (the corners), running along the fence
  { const W = world.W || (world.W = {}), FC = W.fenceCorners || (W.fenceCorners = []), v = new THREE.Vector3(), d = new THREE.Vector3();
    for (const r of runs) { if (r.a1 - r.a0 < 7) continue; const dirL = r.axis === 'z' ? [0, 1] : [1, 0], inL = r.axis === 'z' ? [-r.s, 0] : [0, -r.s];
      d.set(dirL[0], 0, dirL[1]).transformDirection(m); const yaw = Math.atan2(d.x, d.z) - Math.PI / 2;
      for (const [a, k] of [[r.a0 + 2.2, 1], [r.a1 - 2.2, -1]]) { const lx = r.axis === 'z' ? r.c : a, lz = r.axis === 'z' ? a : r.c; v.set(lx + inL[0] * 0.9, 0, lz + inL[1] * 0.9).applyMatrix4(m); FC.push({ x: v.x, z: v.z, yaw, k }); } } }
  for (const r of runs) {
    let a0 = r.a0 + 0.3, a1 = r.a1 - 0.3; const len = a1 - a0; if (len < 1.5) continue;
    // a gate gap in long runs
    // 5 m openings every ~16 m (bikes cut across the lawns), short runs stay closed
    const segs = []; if (len < 12) segs.push([a0, a1]); else { let q = a0; while (q < a1 - 0.5) { let e = Math.min(q + 11, a1); if (a1 - e < 3) e = a1; segs.push([q, e]); q = e + 5; } }
    for (const [s0, s1] of segs) {
      const Pp = (a, y) => r.axis === 'z' ? [r.c, y, a] : [a, y, r.c];
      { const q = new THREE.Vector3(...Pp((s0 + s1) / 2, 0)).applyMatrix4(m); if (FENCE_HOLES.some(([hx, hz, hr]) => Math.hypot(q.x - hx, q.z - hz) < hr)) continue; }   // no fence through the crew's hangout
      if (s1 - s0 >= 7) { const W = world.W, FS = W.fenceSegs || (W.fenceSegs = []), A = new THREE.Vector3(...Pp(s0 + 1, 0)).applyMatrix4(m), B = new THREE.Vector3(...Pp(s1 - 1, 0)).applyMatrix4(m), n = new THREE.Vector3(r.axis === 'z' ? r.s : 0, 0, r.axis === 'z' ? 0 : r.s).transformDirection(m); FS.push({ a: [A.x, A.z], b: [B.x, B.z], n: [n.x, n.z] }); }   // path side of each fence stretch: greens.js lines it with benches
      const u1 = (s1 - s0) / 2.4;
      loc.quad('hFence', Pp(s0, 0.02), Pp(s1, 0.02), Pp(s1, 1.07), Pp(s0, 1.07), [[0, 0], [u1, 0], [u1, 1], [0, 1]]);
      const np = Math.max(1, Math.round((s1 - s0) / 2.4));
      for (let k = 0; k <= np; k++) { const a = s0 + (s1 - s0) * k / np; const p0 = Pp(a - 0.035, 0), p1 = Pp(a + 0.035, 1.12); loc.box('hRail', [Math.min(p0[0], p1[0]) - (r.axis === 'z' ? 0.035 : 0), 0, Math.min(p0[2], p1[2]) - (r.axis === 'x' ? 0.035 : 0)], [Math.max(p0[0], p1[0]) + (r.axis === 'z' ? 0.035 : 0), 1.12, Math.max(p0[2], p1[2]) + (r.axis === 'x' ? 0.035 : 0)], { collide: false }); }
      const c0 = Pp(s0, 0), c1 = Pp(s1, 1.05); const w = 0.06;
      loc.collide([Math.min(c0[0], c1[0]) - (r.axis === 'z' ? w : 0), 0, Math.min(c0[2], c1[2]) - (r.axis === 'x' ? w : 0)], [Math.max(c0[0], c1[0]) + (r.axis === 'z' ? w : 0), 1.05, Math.max(c0[2], c1[2]) + (r.axis === 'x' ? w : 0)], 0.3);   // fine cells: 1 m ones bulged ~0.5 m past the rail and pinched the path openings (bikes clipped them)
    }
  }
  // fences + grass go to the ground batch (fence geometry is alpha, keep it out of shadows too)
  loc.emit(G, M, m, world, 3);
  // trees: interior lawn cells (all 8 neighbours lawn), >= 6 m from the building, >= 9 m apart
  const cand = [];
  for (let i = 1; i < nx - 1; i++) for (let j = 1; j < nz - 1; j++) { let ok = true; for (let di = -1; di <= 1 && ok; di++) for (let dj = -1; dj <= 1; dj++) if (!L(i + di, j + dj)) { ok = false; break; } if (!ok) continue; const lx = x0 + (i + 0.5) * CELL, lz = z0 + (j + 0.5) * CELL; if (distBox(lx, lz) < 6) continue; cand.push([lx, lz]); }
  const mine = []; const maxN = 26;
  for (let k = 0; k < 400 && mine.length < maxN && cand.length; k++) { const [lx, lz] = cand[(R() * cand.length) | 0]; if (mine.some(([a, b]) => Math.hypot(a - lx, b - lz) < 7.5)) continue; mine.push([lx, lz]); const [x, z] = W(lx + (R() - 0.5), lz + (R() - 0.5)); trees.push({ x, z, s: 0.9 + R() * 0.5, ry: R() * 6.3 }); }
}

function plantTrees(world, trees) {
  // none whose crown would reach over the el (the Q / F run along the north edge of the Luna lawns at ~8 m)
  const tx = (t) => (Array.isArray(t) ? t[0] : t.x), tz = (t) => (Array.isArray(t) ? t[1] : t.z);
  trees = trees.filter((t) => !OSM.rl.some((l) => l.el && segDist(tx(t), tz(t), l.p) < 8.5));
  const { scene, ctx, R } = world; if (!trees.length) return;
  const bark = barkTexture(R), leaf = leafTexture(R, { hue: 92 });
  // a mature shade tree (London plane / honey locust, as in the aerial photo): a stout trunk forking into three limbs under a
  // domed crown of lumpy leaf clusters, with a fringe of leaf cards for a soft silhouette. Phones get fewer fringe cards.
  const rnd = mulberry(1234), bits = [];
  { const tg = new THREE.CylinderGeometry(0.22, 0.34, 5.2, 8); tg.translate(0, 2.6, 0); bits.push(tg);
    for (const [ry, lean] of [[0.3, 0.5], [2.4, 0.45], [4.4, 0.55]]) { const b = new THREE.CylinderGeometry(0.09, 0.17, 3.6, 6); b.translate(0, 1.8, 0); b.rotateZ(lean); b.rotateY(ry); b.translate(0, 4.8, 0); bits.push(b); } }
  const trunkG = mergeSimple(bits);
  const cards = [], lump = (r, x, y, z) => { const g = new THREE.IcosahedronGeometry(r, 1), P = g.attributes.position; for (let i = 0; i < P.count; i++) { const k = 1 + (rnd() - 0.5) * 0.28; P.setXYZ(i, P.getX(i) * k + x, P.getY(i) * k * 0.82 + y, P.getZ(i) * k + z); } g.computeVertexNormals(); cards.push(g); };
  lump(3.3, 0, 9.0, 0); lump(2.5, 2.4, 7.9, 0.9); lump(2.5, -2.3, 8.0, -0.7); lump(2.4, 0.6, 8.1, 2.4); lump(2.4, -0.5, 7.9, -2.4); lump(2.2, 0.4, 10.9, -0.3);
  const fringe = ctx.lite ? 4 : 10;
  for (let i = 0; i < fringe; i++) { const a = i / fringe * Math.PI * 2 + rnd() * 0.4, q = new THREE.PlaneGeometry(3.6, 3.0); q.rotateX((rnd() - 0.5) * 0.6); q.rotateY(a + Math.PI / 2); q.translate(Math.cos(a) * 3.4, 7.6 + rnd() * 2.6, Math.sin(a) * 3.4); cards.push(q); }
  const canopyG = mergeSimple(cards);
  const trunkM = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.9, color: 0xa89f8c });
  const leafM = new THREE.MeshLambertMaterial({ map: leaf, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xb8d28c, emissiveMap: leaf, emissive: 0x33441f, emissiveIntensity: 0.2 });
  const t = new THREE.InstancedMesh(trunkG, trunkM, trees.length), c = new THREE.InstancedMesh(canopyG, leafM, trees.length);
  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  trees.forEach((tr, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.ry); s.set(tr.s, tr.s, tr.s); p.set(tr.x, 0, tr.z); mm.compose(p, q, s); t.setMatrixAt(i, mm); c.setMatrixAt(i, mm); world.box([tr.x - 0.3, 0, tr.z - 0.3], [tr.x + 0.3, 5, tr.z + 0.3]); });
  for (const im of [t, c]) { im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im); }
  t.name = 'luna:trunks'; c.name = 'luna:canopy'; t.userData.surface = 'wood'; c.userData.surface = 'wood'; ctx.raycastTargets.push(t);
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// open ground around Table Park + Arkasha's card table (hangout.js): the crew stands there, no lawn fence splitting it
const FENCE_HOLES = [[212, -393, 16]];
function paverTexture() {   // grey rectangular pavers, running bond, a few darker/warmer ones, sanded joints
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#6f6c66'; g.fillRect(0, 0, 256, 256);
  const H = 32, Wd = 64; for (let r = 0; r < 8; r++) for (let k = -1; k < 5; k++) { const x = k * Wd + (r % 2 ? Wd / 2 : 0), y = r * H, v = 150 + Math.random() * 30 | 0, w = Math.random() < 0.12 ? 12 : 0; g.fillStyle = `rgb(${v + w},${v + w * 0.4},${v - 4})`; g.fillRect(x + 2, y + 2, Wd - 4, H - 4); for (let n = 0; n < 40; n++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(x + 2 + Math.random() * (Wd - 6), y + 2 + Math.random() * (H - 6), 2, 2); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function mergeSimple(list) {
  const pos = [], nor = [], uv = [];
  for (let g of list) { if (g.index) g = g.toNonIndexed(); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Hangout interior (coney/hangout.js): the core's ground floor becomes a lobby with an open breezeway straight through it
// (both gallery faces, no doors), with a bank of 3 brushed-steel elevators on one end wall and mailboxes on the other; the open
// gallery recess on the 19th floor becomes a railed walkway (both faces) with 3 elevator doors on its back wall. Everything
// else in the core stays solid. Local frame: a = along the core spine, c = across it, P3 maps (a, y, c) to local (x, y, z).
function coreInterior(L, p, Ht) {
  const ax = p.galleryAxis === 'x';
  const A = ax ? [p.x0, p.x1] : [p.z0, p.z1], C = ax ? [p.z0, p.z1] : [p.x0, p.x1];
  const P3 = (a, y, c) => ax ? [a, y, c] : [c, y, a];
  const bx = (a0, y0, c0, a1, y1, c1) => { const q0 = P3(Math.min(a0, a1), y0, Math.min(c0, c1)), q1 = P3(Math.max(a0, a1), y1, Math.max(c0, c1)); return [[Math.min(q0[0], q1[0]), y0, Math.min(q0[2], q1[2])], [Math.max(q0[0], q1[0]), y1, Math.max(q0[2], q1[2])]]; };
  const col = (...v) => { const [mn, mx] = bx(...v); L.collide(mn, mx); };
  const colF = (...v) => { const [mn, mx] = bx(...v); L.collide(mn, mx, 0.5); };   // fine cells next to narrow openings
  const vis = (key, ...v) => { const [mn, mx] = bx(...v); L.box(key, mn, mx, { collide: false }); };
  const mid = (A[0] + A[1]) / 2, i0 = C[0] + GAL, i1 = C[1] - GAL;
  const yF = (Math.min(19, p.floors) - 1) * ST, CEIL = 2.55;
  // solids: everything above the ground floor except the 19th-floor elevator lobby, and the ground floor beyond the lobby
  // roof stair: from the 19th-floor lobby's far end straight up through the core to a brick bulkhead on the roof
  const cm = (i0 + i1) / 2, SW = 0.75, sc0 = cm - SW, sc1 = cm + SW, nSt = Math.max(2, Math.ceil((Ht - yF) / 0.27)), rise = (Ht - yF) / nSt, tread = 0.3;   // rise <= 0.27 m: comfortably under the player step-up (0.45)
  const sa0 = mid + LOBBY_HALF, sf = sa0 + 0.9, sa1 = sf + nSt * tread + 0.9;   // door landing, flight, top landing   // + a top landing
  // fire stair B: a hallway beside the roof stair leads to a scissor stair (sh0..sh1) down to floor 16 — the smoking /
  // pissing stairwell. Only where the core has room past the roof stair.
  let stairB = null; const SHL = 4.6, sh0 = sa1 + 0.25, sh1 = sh0 + SHL, FL = Math.max(1, Math.round(yF / ST)), yD = Math.max(0, yF - FL * ST), hasB = sh1 < A[1] - 0.4 && FL >= 1, bToGround = yD < ST - 0.01;
  const hw1 = sc0 - 0.06;   // hallway: c ∈ [i0, hw1], a ∈ [sa0, sh0], 2.2 m tall
  if (hasB) {
    // the towers are rotated: every collider becomes a world AABB per cell, so big cells bulge up to ~0.7 m past their faces —
    // anything bordering the stairwell / hallway uses fine cells (colT for the thin walls)
    const colT = (...v) => { const [mn, mx] = bx(...v); L.collide(mn, mx, 0.2); };
    if (yD > ST) col(A[0], ST, i0, A[1], yD, i1); col(A[0], Math.max(yD, ST), i0, sh0 - 1.2, yF, i1);
    if (bToGround) {   // the 1.2 m core wall between lobby and stairwell would seal the stair's discharge — cut a doorway through it at ground level
      const fine = (...v) => { const [mn, mx] = bx(...v); L.collide(mn, mx, 0.2); };
      const cmB0 = (i0 + i1) / 2;   // the whole lane-A half of the wall comes out: a fire stair discharges into the lobby, it does not squeeze through a slot
      colF(sh0 - 1.2, ST, i0, sh0, yF, i1); fine(sh0 - 1.2, 0, cmB0 + 0.35, sh0, ST, i1);
      vis('hGreenDoor', sh0 - 0.08, 0, i0 + 0.15, sh0 - 0.03, 2.05, i0 + 1.35);
    } else colF(sh0 - 1.2, yD, i0, sh0, yF, i1);
    colF(sh1, yD, i0, A[1], yF, i1);
    col(A[0], yF + CEIL, i0, sa0, Ht, i1); colF(sh1, yF, i0, A[1], Ht, i1); colF(sh0, yF + 2.4, i0, sh1, Ht, i1); colF(sa1, yF, hw1 + 0.06, sh0, Ht, i1);
    colF(sa0, yF + 2.2, i0, sh0, Ht, sc0); colT(sa0, yF, hw1, sa1, yF + 2.2, hw1 + 0.06); colF(sa0, yF, sc1, sa1, Ht, i1);
  } else { col(A[0], ST, i0, A[1], yF, i1); col(A[0], yF + CEIL, i0, sa0, Ht, i1); colF(sa1, yF, i0, A[1], Ht, i1); colF(sa0, yF, i0, sa1, Ht, sc0); colF(sa0, yF, sc1, sa1, Ht, i1); }
  colF(sa0, yF + 2.2, sc0, sa0 + 0.3, Ht, sc1);   // lobby-side header over the stair door
  col(A[0], yF, i0, mid - LOBBY_HALF, yF + CEIL, i1);
  for (let k = 0; k < nSt; k++) colF(sf + k * tread, yF, sc0, sa1, yF + (k + 1) * rise, sc1);
  // roof deck (visual + a full-footprint collider around the stair opening) and a 2 m guard inside the parapet rail
  for (const [a0, a1, c0, c1] of [[A[0], sa0, C[0], C[1]], [sa1, A[1], C[0], C[1]], [sa0, sa1, C[0], sc0 - 0.2], [sa0, sa1, sc1 + 0.2, C[1]]]) { colF(a0, Ht - 0.3, c0, a1, Ht, c1); vis("hRoof", a0, Ht - 0.12, c0, a1, Ht - 0.02, c1); }
  for (const [a0, a1, c0, c1] of [[A[0], A[1], C[0], C[0] + 0.4], [A[0], A[1], C[1] - 0.4, C[1]], [A[0], A[0] + 0.4, C[0], C[1]], [A[1] - 0.4, A[1], C[0], C[1]]]) col(a0, Ht, c0, a1, Ht + 2.0, c1);
  // stair: terrazzo treads, tile side walls, the bulkhead (walls, roof, door frame facing +a) with a ceiling light
  for (let k = 0; k < nSt; k++) vis('hTerrazzo', sf + k * tread, yF + k * rise, sc0, sa1, yF + (k + 1) * rise, sc1);
  for (const c of [sc0, sc1]) vis('hLobbyWall', sa0, yF, c - 0.03, sa1, Ht, c + 0.03);
  vis('hLobbyWall', sa0, yF + 2.2, sc0, sa0 + 0.3, Ht, sc1);
  { const BH = 2.5; colF(sa0 - 0.25, Ht, sc0 - 0.25, sa1, Ht + BH, sc0); colF(sa0 - 0.25, Ht, sc1, sa1, Ht + BH, sc1 + 0.25); colF(sa0 - 0.25, Ht, sc0, sa0, Ht + BH, sc1);
    vis('hBrickPlain', sa0 - 0.25, Ht - 0.02, sc0 - 0.25, sa1, Ht + BH, sc0); vis('hBrickPlain', sa0 - 0.25, Ht - 0.02, sc1, sa1, Ht + BH, sc1 + 0.25); vis('hBrickPlain', sa0 - 0.25, Ht - 0.02, sc0, sa0, Ht + BH, sc1);
    vis('hRail', sa0 - 0.35, Ht + BH, sc0 - 0.35, sa1 + 0.1, Ht + BH + 0.15, sc1 + 0.35); colF(sa0 - 0.25, Ht + BH, sc0 - 0.25, sa1, Ht + BH + 0.15, sc1 + 0.25);
    vis('hBrickPlain', sa1 - 0.1, Ht + 2.2, sc0, sa1, Ht + BH, sc1);   // door head
    for (const c of [sc0 + 0.04, sc1 - 0.04]) vis('hRail', sa1 - 0.08, Ht, c - 0.04, sa1, Ht + 2.2, c + 0.04);
    vis('hLobbyCeil', sa0 + 1.2, Ht + BH - 0.06, cm - 0.25, sa0 + 1.8, Ht + BH - 0.02, cm + 0.25); vis('hLobbyCeil', sa0 + 1.4, yF + CEIL - 0.05, cm - 0.2, sa0 + 1.9, yF + CEIL - 0.02, cm + 0.2); }
  if (hasB) {   // ---- fire stair B geometry ----
    const cmB = (i0 + i1) / 2, laneA = [i0 + 0.05, cmB - 0.1], laneB = [cmB + 0.1, i1 - 0.05], f0 = sh0 + 1.2, f1 = f0 + 1.8, nS = 6, rS = ST / 2 / nS, tS = (f1 - f0) / nS;
    vis('hTerrazzo', sa0, yF, i0, sh0, yF + 0.02, hw1); vis('hLobbyCeil', sa0 + 2, yF + 2.15, i0 + 0.6, sa0 + 2.6, yF + 2.18, i0 + 1.1);    // hallway floor + light
    for (const c of [i0 + 0.02, hw1]) vis('hLobbyWall', sa0, yF, c - 0.02, sh0, yF + 2.2, c + 0.02);
    vis('hGreenDoor', sh0 - 0.05, yF, i0 + 0.3, sh0, yF + 2.1, i0 + 1.4);   // propped-open fire door (a leaf against the wall)
    for (let n = 0; n <= FL; n++) {   // landings: near (full floor) and far (half floor), slabs so the flight below stays clear
      const y = yF - n * ST; colF(sh0, y - 0.25, i0, f0, y, i1); vis('hTerrazzo', sh0, y - 0.25, i0, f0, y, i1);
      if (n < FL) { const yh = y - ST / 2; colF(f1, yh - 0.25, i0, sh1, yh, i1); vis('hTerrazzo', f1, yh - 0.25, i0, sh1, yh, i1);
        for (let k = 0; k < nS; k++) {   // lane A: down along +a from the floor to the half landing; lane B: back along −a to the next floor
          const ya = y - (k + 1) * rS; colF(f0 + k * tS, ya - 0.2, laneA[0], f0 + (k + 1) * tS, ya, laneA[1]); vis('hTerrazzo', f0 + k * tS, ya - 0.2, laneA[0], f0 + (k + 1) * tS, ya, laneA[1]);
          const yb = yh - (k + 1) * rS; colF(f1 - (k + 1) * tS, yb - 0.2, laneB[0], f1 - k * tS, yb, laneB[1]); vis('hTerrazzo', f1 - (k + 1) * tS, yb - 0.2, laneB[0], f1 - k * tS, yb, laneB[1]); } }
      vis('hGreenDoor', sh0, y, laneB[0] + 0.3, sh0 + 0.05, y + 2.05, laneB[1] - 0.1);   // each floor's (locked) corridor door
    }
    vis('hLobbyWall', f0, yD, cmB - 0.1, f1, yF + 2.4, cmB + 0.1); { const [a, b2] = bx(f0, yD, cmB - 0.1, f1, yF + 2.4, cmB + 0.1); L.collide(a, b2, 0.2); }   // scissor divider
    for (const [a0, a1, c0, c1] of [[sh0, sh1, i0, i0 + 0.02], [sh0, sh1, i1 - 0.02, i1], [sh1 - 0.02, sh1, i0, i1], [sh0, sh0 + 0.02, hw1 + 0.1, i1]]) vis('hLobbyWall', a0, yD - 0.25, c0, a1, yF + 2.4, c1);   // painted block walls
    vis('hLobbyCeiling', sh0, yF + 2.38, i0, sh1, yF + 2.42, i1);
    for (let n = 0; n <= FL; n++) vis('hLobbyCeil', sh0 + 0.4, yF - n * ST + 2.2, cmB + 0.3, sh0 + 0.8, yF - n * ST + 2.24, cmB + 0.7);   // a bulb per landing
    const cA = (laneA[0] + laneA[1]) / 2, cB = (laneB[0] + laneB[1]) / 2, path = [[sa0 - 1.0, yF, i0 + 0.85], [sa0 + 0.6, yF, i0 + 0.85], [sh0 - 0.4, yF, i0 + 0.85], [sh0 + 0.6, yF, cA]];
    for (let n = 0; n < FL; n++) { const y = yF - n * ST, yh = y - ST / 2; path.push([f0 - 0.2, y, cA], [f1 + 0.7, yh, cA], [f1 + 0.7, yh, cB], [f0 - 0.6, y - ST, cB], [f0 - 0.6, y - ST, cA]); }   // walking route (QA)
    stairB = { top: [sh0 + 0.6, yF, cA], bottom: [sh0 + 0.6, yD, cB], floors: FL, path };
  }
  // the roof hangout right outside the bulkhead door (where the stairs let you out): a couch along the rail, milk crates
  // and a boombox on the other side, string lights from the bulkhead to the parapet
  if (A[1] - sa1 > 4) { const y = Ht, a0 = sa1 + 1.4, a1 = Math.min(A[1] - 0.7, sa1 + 3.6), cR = C[1] - 0.45, cL = C[0] + 0.45;
    vis('hCouch', a0, y, cR - 0.9, a1, y + 0.45, cR); vis('hCouch', a0, y + 0.45, cR - 0.25, a1, y + 0.95, cR); colF(a0, y, cR - 0.9, a1, y + 0.5, cR);
    for (const aa of [a0, a1 - 0.3]) vis('hCouch', aa, y + 0.45, cR - 0.9, aa + 0.3, y + 0.7, cR);
    for (const [da, h] of [[0.2, 0.35], [0.7, 0.35], [0.2, 0.7]]) { vis('hCrate', a0 + da - 0.18, y + h - 0.35, cL, a0 + da + 0.18, y + h, cL + 0.36); if (h < 0.5) colF(a0 + da - 0.18, y, cL, a0 + da + 0.18, y + h, cL + 0.36); }
    vis('hBoom', a0, y + 0.7, cL + 0.04, a0 + 0.42, y + 0.94, cL + 0.32);
    for (let k = 0; k < 12; k++) { const t = k / 11, aa = sa1 + (A[1] - 0.5 - sa1) * t, sag = Math.sin(t * Math.PI) * 0.3; for (const cc of [cL + 0.2, cR - 0.2]) vis('hBulb', aa - 0.05, y + 2.4 - sag, cc - 0.05, aa + 0.05, y + 2.5 - sag, cc + 0.05); }
  }
  col(A[0], 0, i0, mid - LOBBY_HALF, ST, i1);
  if (hasB && bToGround) {   // fire stair discharges here: leave its footprint open to the lobby.
    // rotated towers turn every collider cell into a world AABB, so coarse cells bulge ~0.7 m past their faces and
    // pinch the bottom landing shut — everything bordering the stairwell at ground level uses fine cells.
    const gF = (...v) => { const [mn, mx] = bx(...v); L.collide(mn, mx, 0.2); };
    if (sh0 > mid + GROUND_HI) gF(mid + GROUND_HI, 0, (i0 + i1) / 2 + 0.35, sh0, ST, i1);   // lane A stays open: a corridor from the lobby to the fire stair
    const gap = Math.min(sh1 + 1.4, A[1]); gF(sh1, 0, i0, gap, ST, i1); if (gap < A[1]) col(gap, 0, i0, A[1], ST, i1);
  }
  else { const [mn, mx] = bx(mid + GROUND_HI, 0, i0, A[1], ST, i1); L.collide(mn, mx, 1.0); }   // 1 m cells: coarse ones bulged past the wall on the rotated towers
  // lobby glass walls (colliders) with the entrance gaps
  const glassCol = (...v) => { const [mn, mx] = bx(...v); L.collide(mn, mx, 0.2); };   // fine cells: on the rotated towers a coarse cell became a 3.6 m invisible box across the entrance paths
  for (const c of [i0, i1]) { glassCol(mid - LOBBY_HALF, 0, c - 0.06, mid - DOOR_HALF, ST, c + 0.06);
    if (hasB && bToGround) { const nr = Math.max(mid + DOOR_HALF, sh0 - 2.5); glassCol(mid + DOOR_HALF, 0, c - 0.06, nr, ST, c + 0.06); const [mn, mx] = bx(nr, 0, c - 0.06, mid + GROUND_HI, ST, c + 0.06); L.collide(mn, mx, 0.2); }
    else glassCol(mid + DOOR_HALF, 0, c - 0.06, mid + GROUND_HI, ST, c + 0.06); }
  // lobby dressing: 12" VCT checker floor, glazed-tile wainscot walls, a dropped ceiling with light panels, three steel cars
  // with call-button plates and lit floor indicators, a bank of aluminium mailboxes, a directory board, a bench
  vis('hLobbyFloor', mid - LOBBY_HALF, 0, i0, mid + GROUND_HI, 0.03, i1);
  vis('hLobbyCeiling', mid - LOBBY_HALF, ST - 0.07, i0, mid + GROUND_HI, ST - 0.04, i1);   // clear of the slab above (it z-fought)
  for (let a = mid - LOBBY_HALF + 1.5; a < mid + GROUND_HI - 1; a += 3) vis('hLobbyCeil', a - 0.6, ST - 0.1, (i0 + i1) / 2 - 0.3, a + 0.6, ST - 0.075, (i0 + i1) / 2 + 0.3);
  vis('hLobbyWall', mid - LOBBY_HALF - 0.05, 0, i0, mid - LOBBY_HALF, ST, i1); { const cq = (i0 + i1) / 2 + 0.35, open = hasB && bToGround && sh0 > mid + GROUND_HI + 0.2;   // the lobby's far wall: a doorway into the stair corridor when the fire stair reaches the ground
    vis('hLobbyWall', mid + GROUND_HI, 0, open ? cq : i0, mid + GROUND_HI + 0.05, ST, i1);
    if (open) { vis('hLobbyFloor', mid + GROUND_HI, 0, i0, sh0, 0.03, cq); vis('hLobbyCeiling', mid + GROUND_HI, ST - 0.07, i0, sh0, ST - 0.04, cq); vis('hLobbyWall', mid + GROUND_HI, 0, cq, sh0, ST, cq + 0.05); } }
  const cars = [0, 1, 2].map((k) => i0 + (i1 - i0) * (k + 0.5) / 3);
  // the bank of 3 steel cars on the lobby end wall (a = mid - LOBBY_HALF, facing +a): ground floor and the same shafts on 19
  const bank = (y) => { const e = mid - LOBBY_HALF; for (const cc of cars) {
    vis('hElev', e, y + 0.03, cc - 0.52, e + 0.05, y + 2.12, cc + 0.52);
    vis('hRail', e, y + 2.12, cc - 0.62, e + 0.07, y + 2.22, cc + 0.62);
    for (const s of [-1, 1]) vis('hRail', e, y + 0.03, cc + s * 0.52 - 0.05, e + 0.07, y + 2.12, cc + s * 0.52 + 0.05);   // jambs
    vis('hPanel', e, y + 0.95, cc + 0.6, e + 0.06, y + 1.3, cc + 0.72);                                                  // call plate
    vis('hButton', e, y + 1.16, cc + 0.63, e + 0.08, y + 1.22, cc + 0.69); vis('hButton', e, y + 1.03, cc + 0.63, e + 0.08, y + 1.09, cc + 0.69);
    vis('hIndicator', e, y + 2.26, cc - 0.25, e + 0.06, y + 2.4, cc + 0.25);    // floor indicator
  } };
  bank(0);
  // the big ground-floor lobby: a row of clad columns down the middle, a security desk by the door, benches, planters
  { const cm2 = (i0 + i1) / 2;
    for (let a = mid + 3.5; a < mid + GROUND_HI - 2; a += 4.5) { vis('hLobbyWall', a - 0.25, 0, cm2 - 0.25, a + 0.25, ST, cm2 + 0.25); col(a - 0.25, 0, cm2 - 0.25, a + 0.25, ST, cm2 + 0.25); }
    vis('hDirectory', mid + 5.2, 0, i1 - 1.4, mid + 6.8, 1.05, i1 - 0.8); vis('hRail', mid + 5.15, 1.05, i1 - 1.45, mid + 6.85, 1.1, i1 - 0.75); col(mid + 5.2, 0, i1 - 1.4, mid + 6.8, 1.05, i1 - 0.8);   // security desk, clear of the breezeway
    for (let a = mid - LOBBY_HALF + 1.2; a < mid + GROUND_HI - 0.6; a += 1.8) if (Math.abs(a - mid - 3.5) % 4.5 > 0.5) vis('hInlay', a - 0.3, 0.03, cm2 - 0.3, a + 0.3, 0.034, cm2 + 0.3);   // brown VCT inlays down the centre (ref 03)
    for (const [a, c] of [[mid - LOBBY_HALF + 0.25, i0 + 0.12], [mid + GROUND_HI - 0.25, i1 - 0.12]]) { vis('hConduit', a - 0.03, 0, c - 0.03, a + 0.03, ST - 0.1, c + 0.03); vis('hPanel', a - 0.12, 2.0, c - 0.15, a + 0.12, 2.3, c + 0.15); }   // conduit + junction box
    for (const a of [mid + 6.5, mid + 10.5]) { vis('hRail', a - 0.9, 0.42, i0 + 0.35, a + 0.9, 0.47, i0 + 0.8); vis('hRail', a - 0.9, 0.47, i0 + 0.3, a + 0.9, 0.9, i0 + 0.36); col(a - 0.9, 0, i0 + 0.3, a + 0.9, 0.5, i0 + 0.8); }   // benches along the glass
    for (const a of [mid - LOBBY_HALF + 0.6, mid + GROUND_HI - 0.9]) for (const c of [i0 + 0.45, i1 - 0.45]) { vis('hDirectory', a - 0.3, 0, c - 0.3, a + 0.3, 0.6, c + 0.3); vis('hLawn', a - 0.26, 0.6, c - 0.26, a + 0.26, 0.95, c + 0.26); }   // planters
  }
  vis('hMail', mid + GROUND_HI - 0.3, 0.85, hasB && bToGround && sh0 > mid + GROUND_HI + 0.2 ? (i0 + i1) / 2 + 0.6 : i0 + 0.45, mid + GROUND_HI, 1.95, i1 - 0.45);          // mailboxes
  vis('hRail', mid + GROUND_HI - 0.33, 0.8, i0 + 0.4, mid + GROUND_HI, 0.85, i1 - 0.4);
  const nrm = (dc) => { const q = P3(0, 0, dc); return [q[0], q[2]]; };   // local normal pointing along +/-c
  const nrmA = (da) => { const q = P3(da, 0, 0); return [q[0], q[2]]; };  // local normal pointing along +/-a
  L.sign('hDirectory', P3(mid + GROUND_HI - 0.02, 2.25, (i0 + i1) / 2), nrmA(-1), 1.6, 0.5);   // plaque over the boxes

  // ---- the 19th floor: a walkable loop. Two railed gallery walkways (one per long face: one looks north over Brooklyn to the
  // Manhattan skyline, the other south over the rides to the ocean) joined THROUGH the core by an enclosed elevator lobby
  // (the same 3 shafts as the ground floor, VCT floor, tile walls, lit ceiling panels) with two open doorways on each side.
  const OPEN = [[mid - 6.3, mid - 3.5], [mid + 2.6, mid + 5.4]], WT = 0.2, HEAD = 2.25;
  vis('hLobbyFloor', mid - LOBBY_HALF, yF, i0, mid + LOBBY_HALF, yF + 0.03, i1);
  vis('hLobbyCeiling', mid - LOBBY_HALF, yF + CEIL - 0.07, i0, mid + LOBBY_HALF, yF + CEIL - 0.04, i1);
  for (let a = mid - LOBBY_HALF + 1.6; a < mid + LOBBY_HALF - 1; a += 2.8) vis('hLobbyCeil', a - 0.6, yF + CEIL - 0.1, (i0 + i1) / 2 - 0.3, a + 0.6, yF + CEIL - 0.075, (i0 + i1) / 2 + 0.3);
  vis('hLobbyWall', mid - LOBBY_HALF - 0.05, yF, i0, mid - LOBBY_HALF, yF + CEIL, i1); if (hasB) { vis('hLobbyWall', mid + LOBBY_HALF, yF, i0, mid + LOBBY_HALF + 0.05, yF + CEIL, i0 + 0.35); vis('hLobbyWall', mid + LOBBY_HALF, yF, i0 + 1.45, mid + LOBBY_HALF + 0.05, yF + CEIL, sc0); vis('hLobbyWall', mid + LOBBY_HALF, yF + 2.2, i0 + 0.35, mid + LOBBY_HALF + 0.05, yF + CEIL, i0 + 1.45); { const [a, b2] = bx(sa0 - 0.02, yF, i0, sa0 + 0.05, yF + CEIL, i0 + 0.35); L.collide(a, b2, 0.2); const [c2, d2] = bx(sa0 - 0.02, yF, i0 + 1.45, sa0 + 0.05, yF + CEIL, hw1); L.collide(c2, d2, 0.2); } } else vis('hLobbyWall', mid + LOBBY_HALF, yF, i0, mid + LOBBY_HALF + 0.05, yF + CEIL, sc0); vis('hLobbyWall', mid + LOBBY_HALF, yF, sc1, mid + LOBBY_HALF + 0.05, yF + CEIL, i1);
  for (const c of [sc0, sc1]) vis('hRail', mid + LOBBY_HALF - 0.04, yF, c - 0.05, mid + LOBBY_HALF + 0.06, yF + 2.2, c + 0.05); vis('hRail', mid + LOBBY_HALF - 0.04, yF + 2.15, sc0, mid + LOBBY_HALF + 0.06, yF + 2.22, sc1);   // stair door frame
  bank(yF);
  L.sign('hFloor19', P3(mid + LOBBY_HALF - 0.02, yF + 1.55, (sc1 + i1) / 2), nrmA(-1), 0.8, 0.8);                  // "19" on the far end wall, beside the roof stair
  vis('hGreenDoor', mid + LOBBY_HALF - 0.04, yF + 0.03, i1 - 0.95, mid + LOBBY_HALF, yF + 1.3, i1 - 0.35);        // compactor-chute hatch
  for (let a = mid - LOBBY_HALF + 1.4; a < mid + LOBBY_HALF - 0.8; a += 1.8) vis('hInlay', a - 0.3, yF + 0.03, (i0 + i1) / 2 - 0.3, a + 0.3, yF + 0.034, (i0 + i1) / 2 + 0.3);   // brown VCT inlays
  const walks = [];
  for (const [cOut, cIn, sg] of [[C[0], i0, 1], [C[1], i1, -1]]) {
    col(mid - WALK_HALF, yF - 0.25, cOut, mid + WALK_HALF, yF, cIn);
    // railing: 1.1 m steel rail + an invisible 2 m guard so nobody vaults or mantles off the 19th floor
    colF(mid - WALK_HALF, yF, cOut, mid + WALK_HALF, yF + 2.0, cOut + sg * 0.12);
    colF(mid - WALK_HALF - 0.3, yF, cOut, mid - WALK_HALF, yF + 2.6, cIn); colF(mid + WALK_HALF, yF, cOut, mid + WALK_HALF + 0.3, yF + 2.6, cIn);   // fine cells: coarse ones bulged into the stair hallway door
    vis('hSlab', mid - WALK_HALF, yF - 0.02, cOut, mid + WALK_HALF, yF + 0.01, cIn);
    vis('hRail', mid - WALK_HALF, yF + 1.05, cOut, mid + WALK_HALF, yF + 1.12, cOut + sg * 0.08);
    for (const e of [mid - WALK_HALF - 0.05, mid + WALK_HALF + 0.05]) {   // steel gates closing the walkway ends
      vis('hRail', e - 0.04, yF, cOut, e + 0.04, yF + 2.2, cIn); for (const y of [0.1, 1.1, 2.15]) vis('hRail', e - 0.03, yF + y, cOut, e + 0.03, yF + y + 0.05, cIn);
      for (let c = 0.15; c < GAL - 0.05; c += 0.14) vis('hRail', e - 0.012, yF + 0.1, cOut + sg * c - 0.012, e + 0.012, yF + 2.15, cOut + sg * c + 0.012);
    }
    // lobby side wall on the lobby line (dark painted block outside, tile inside) with two open steel-framed doorways
    const cW = cIn + sg * WT, segs = []; let a0 = mid - WALK_HALF;
    for (const [o0, o1] of OPEN) { segs.push([a0, o0]); a0 = o1; } segs.push([a0, mid + WALK_HALF]);
    for (const [s0, s1] of segs) {
      colF(s0, yF, cIn, s1, yF + CEIL, cW); vis('hBreeze', s0, yF + 0.01, cIn, s1, yF + ST - 0.02, cW);   // breeze-block gallery wall (ref 02)
      const q0 = Math.max(s0, mid - LOBBY_HALF), q1 = Math.min(s1, mid + LOBBY_HALF); if (q1 > q0) vis('hLobbyWall', q0, yF + 0.01, cW, q1, yF + CEIL - 0.02, cW + sg * 0.02);
    }
    for (const [o0, o1] of OPEN) {
      vis('hVestibule', o0, yF + HEAD, cIn, o1, yF + ST - 0.02, cW); col(o0, yF + HEAD, cIn, o1, yF + CEIL, cW);   // header
      for (const e of [o0, o1]) vis('hRail', e - 0.06, yF + 0.01, cIn - sg * 0.03, e + 0.06, yF + HEAD, cW + sg * 0.03);   // jambs
      vis('hRail', o0 - 0.06, yF + HEAD - 0.08, cIn - sg * 0.03, o1 + 0.06, yF + HEAD, cW + sg * 0.03);                   // head
      vis('hSlab', o0, yF, cIn, o1, yF + 0.035, cW);                                                                         // threshold
    }
    L.sign('hFloor19', P3(mid - 1.0, yF + 1.6, cIn - sg * 0.015), nrm(-sg), 1.1, 1.1);   // painted floor number beside the doorways
    for (const a of [mid - 7.8, mid + 0.6, mid + 6.4]) { vis('hGreenDoor', a, yF + 0.01, cIn - sg * 0.05, a + 0.95, yF + 2.1, cIn); vis('hRail', a + 0.78, yF + 1.0, cIn - sg * 0.08, a + 0.86, yF + 1.06, cIn); }   // green steel flat doors + handles (refs 01, 03)
    vis('hConduit', mid + 5.6, yF, cIn - sg * 0.06, mid + 5.66, yF + ST, cIn);   // grey conduit up the wall
    for (let a = mid - WALK_HALF + 1.4; a < mid + WALK_HALF - 1; a += 3.6) { const cm = cOut + sg * 0.95; vis('hRail', a - 0.3, yF + ST - 0.1, cm - 0.14, a + 0.3, yF + ST - 0.02, cm + 0.14); vis('hLobbyCeil', a - 0.27, yF + ST - 0.12, cm - 0.11, a + 0.27, yF + ST - 0.1, cm + 0.11); }   // gallery ceiling fixtures
    walks.push({ cOut, cIn, sg });
  }
  const topCars = cars.map((cc) => ({ a: mid - LOBBY_HALF + 1.1, c: cc }));
  return { ax, A, C, mid, i0, i1, cars, topCars, yF, walks, roof: { y: Ht, a: sa1 + 1.2, c: cm, door: { a: sa1 - 0.05, c0: sc0, c1: sc1, y: Ht } }, stairB, lobbyHalf: LOBBY_HALF, doorHalf: DOOR_HALF, walkHalf: WALK_HALF, open: OPEN };
}

/** World-space registry entry for one complex (used by coney/hangout.js). */
function towerInfo(core, m, centre) {
  const P3 = (a, y, c) => core.ax ? [a, y, c] : [c, y, a];
  const toWorld = (a, y, c) => new THREE.Vector3(...P3(a, y, c)).applyMatrix4(m);
  const o = toWorld(0, 0, 0), ea = toWorld(1, 0, 0).sub(o), ec = toWorld(0, 0, 1).sub(o);   // world directions of +a and +c
  const yawOf = (d) => Math.atan2(-d.x, -d.z);   // camera yaw that looks along direction d
  const lobby = {
    // stand in front of each elevator door, facing it
    cars: core.cars.map((cc) => ({ pos: toWorld(core.mid - core.lobbyHalf + 1.1, 0, cc), yaw: yawOf(ea.clone().negate()) })),
    doors: [core.i0, core.i1].map((c, k) => ({ inside: toWorld(core.mid, 0, c + (k ? -1.2 : 1.2)), outside: toWorld(core.mid, 0, c + (k ? 1 : -1) * (GAL + 5)), yawIn: yawOf(ec.clone().multiplyScalar(k ? -1 : 1)), plane: toWorld(core.mid, 0, c), along: ea.clone().normalize(), half: core.doorHalf, open: true })),   // open: the breezeway has no doors (hangout.js skips its sliding leaves)
  };
  // 19th floor: both walkways share the one elevator lobby — cars[k] stands in front of lobby car k (facing its door, -a);
  // view = the railing on that walkway, looking straight out
  const topCars = core.topCars.map((q) => ({ pos: toWorld(q.a, core.yF, q.c), yaw: yawOf(ea.clone().negate()) }));
  const top = core.walks.map((w) => ({
    cars: topCars,
    view: { pos: toWorld(core.mid, core.yF, w.cOut + w.sg * 0.6), yaw: yawOf(ec.clone().multiplyScalar(-w.sg)) },
    walk: { a0: toWorld(core.mid - core.walkHalf + 0.6, core.yF, w.cOut + w.sg * 0.85), a1: toWorld(core.mid + core.walkHalf - 0.6, core.yF, w.cOut + w.sg * 0.85) },
  }));
  // roof: the stair foot in the 19th-floor lobby (facing up the flight) and the roof spot outside the bulkhead door
  const roof = { foot: { pos: toWorld(core.mid + core.lobbyHalf - 0.8, core.yF, core.roof.c), yaw: yawOf(ea.clone()) }, top: { pos: toWorld(core.roof.a, core.roof.y, core.roof.c), yaw: yawOf(ea.clone()) } };
  // the roof bulkhead door (hangout.js makes it a stuck door you shoulder open) + fire stair B endpoints
  const rd = core.roof.door, rdA = toWorld(rd.a - 0.07, rd.y, rd.c0), rdB = toWorld(rd.a + 0.03, rd.y + 2.2, rd.c1);
  roof.door = { min: new THREE.Vector3(Math.min(rdA.x, rdB.x), rd.y, Math.min(rdA.z, rdB.z)), max: new THREE.Vector3(Math.max(rdA.x, rdB.x), rd.y + 2.2, Math.max(rdA.z, rdB.z)),
    hinge: toWorld(rd.a - 0.02, rd.y, rd.c0), along: ec.clone().normalize(), out: ea.clone().normalize(), width: rd.c1 - rd.c0,
    inside: toWorld(rd.a - 0.8, rd.y + (core.roof.y - rd.y), (rd.c0 + rd.c1) / 2), outside: toWorld(rd.a + 0.9, rd.y, (rd.c0 + rd.c1) / 2) };
  const stairB = core.stairB && { top: toWorld(...core.stairB.top), bottom: toWorld(...core.stairB.bottom), floors: core.stairB.floors, path: core.stairB.path.map((q) => toWorld(...q)), up: yawOf(ea.clone()) };   // up: yaw to climb the flight off the bottom landing
  return { centre: new THREE.Vector3(centre[0], 0, centre[1]), yF: core.yF, lobby, top, roof, stairB, toWorld, core };
}

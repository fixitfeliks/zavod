// CONEY — Brighton Beach, east of the Aquarium: walk, drive, jetpack or jet ski straight on past the map's east edge. Brighton
// Beach Ave runs east under the B/Q el (it picks up where the Q's el ends, with the Brighton Beach station at Brighton 6th),
// lined with walk-ups and Russian shops (bilingual signs); Brighton 1st to 14th run down to the boardwalk, which carries on from
// Coney with its benches, lamps and babushkas, then the beach and the same ocean. A W.zones rect widens the bounds for players,
// cars and jet skis; W.groundHeight knows the kerbs, the boardwalk and the sand. Horizon keeps its sprawl out of the strip
// (horizon.js CORR). Built once with the hangout. CONEY agent (brighton).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { placeCars } from '../carkit.js';
import { buildPerson, peopleReady } from '../people.js';
import { BW, sandHeight, SAND_TOP } from './shore.js';
import { brickFacadeKit, facadeBoxUV, boxFaces, metreUV, FAC } from './mats.js';

export const BR = { x0: 436, x1: 2370, z0: -92, z1: 900 };   // the zone (players / vehicles / jet skis)
const X0 = 1015, X1 = 2360, ZC = -40, HALF = 10, SWK = 5.5, SW = 0.15;   // Brighton Beach Ave: x span, centreline z, half width, sidewalk
const EL0 = 1270, EL_Y = 7.4;                                   // the el over the avenue: from the Q's end, deck height
const STN_X = 1622;                                             // Brighton Beach station (Brighton 6th St)
const CROSS = []; for (let x = 1090, n = 1; x < X1 - 30; x += 112, n++) CROSS.push({ x, n });   // Brighton 1st .. 12th
const CW = 6;                                                   // cross street half width
const CONN = [[934, 50], [1030, ZC + 4]];                       // Surf Ave's end → the avenue (the plaza at Ocean Pkwy, past the Q's stairs)
const GF = 4.2;                                                  // the walk-ups' shop storey; the flats start above it
// facade tones (mats.js brickFacadeKit): which windowed brick each of the old brick hexes becomes, a soft per-building tint over it,
// and the plain party-wall tint that matches each tone; the six-storey blocks are buff brick with keystone lintels
const BR_VAR = [0, 0, 1, 1, 0, 2, 0], BR_SOFT = [0xf5ece2, 0xe2d6c8, 0xffffff, 0xede6df, 0xede6df, 0xf5ece2, 0xffffff], BR_PLAIN = [0x904638, 0xd0a87e, 0xead9b8], BLOCK_VAR = 2;
const NROW0 = 1200;                                             // the north row starts where the Q's el (it crosses diagonally to the avenue) clears it

const SHOPS = [
  ['ГАСТРОНОМ', 'GROCERY · DELI', '#b3121e', '#fff'], ['АПТЕКА', 'PHARMACY', '#0f6b3a', '#fff'], ['КНИГИ · ВИДЕО', 'BOOKS · DVD', '#1b3f9a', '#ffe07a'],
  ['ОБМЕН ВАЛЮТЫ', 'CURRENCY EXCHANGE', '#111', '#ffd24a'], ['ПЕЛЬМЕННАЯ', 'DUMPLINGS', '#7a1414', '#fff'], ['BRIGHTON BAZAAR', 'ПРОДУКТЫ · 24 HRS', '#1a1a1a', '#e8c33a'],
  ['ТАТЬЯНА', 'RESTAURANT · CABARET', '#3a0b3d', '#f2c14e'], ['КАФЕ ВОЛНА', 'CAFE · ON THE BOARDWALK', '#0b4a6e', '#fff'], ['ЧАЙ · КОФЕ', 'TEA & COFFEE', '#4a2e1c', '#f1e2c6'],
  ['ЮВЕЛИР', 'JEWELRY · GOLD · WATCHES', '#111', '#e0b64a'], ['МЕХА', 'FURS · SHEARLING', '#2c2c2c', '#fff'], ['ТУРАГЕНТСТВО', 'TRAVEL · MOSCOW · KYIV · TASHKENT', '#c8102e', '#fff'],
  ['ПАРИКМАХЕРСКАЯ', 'BEAUTY SALON', '#e75480', '#fff'], ['СВЕЖАЯ РЫБА', 'FRESH FISH · SMOKED', '#1d5c7a', '#fff'], ['ХЛЕБ', 'BAKERY · RYE · BLINI', '#8a5a1a', '#fff'],
  ['ДОКТОР', 'MEDICAL OFFICE · 2ND FL', '#fff', '#1b3f9a'], ['КОНФЕТЫ', 'CANDY · HALVA', '#d9a400', '#3a1a00'], ['ЭЛЕКТРОНИКА', 'CELL PHONES · REPAIR', '#222', '#6fd3ff'],
  ['ЧЕБУРЕКИ', 'CHEBUREKI · SHASHLIK', '#a4161a', '#ffe8a3'], ['МАТРЁШКА', 'GIFTS · SOUVENIRS', '#b3121e', '#ffd24a'], ['ОПТИКА', 'EYEGLASSES', '#0e2a47', '#fff'],
  ['ЛОМБАРД', 'PAWN · WE BUY GOLD', '#111', '#ff5a1f'], ['КОСМЕТИКА', 'PERFUME · COSMETICS', '#5b2a86', '#fff'], ['ПИВО · КВАС', 'BEER · KVASS', '#1f4a2e', '#f7e27a'],
];

let B = null;
/** the shop kind for coney/shops.js's interiors, from a sign's English line */
const brKind = (sub) => /DUMPLING|RESTAURANT|CAFE|TEA|BAKERY|CHEBUREKI/.test(sub) ? 'food' : /CANDY/.test(sub) ? 'candy' : /BEER/.test(sub) ? 'bar' : /EXCHANGE|PAWN|JEWELRY|TRAVEL|SALON|EYEGLASSES|MEDICAL|FURS/.test(sub) ? 'service' : 'grocery';
/** the avenue's layout, for the street kit (coney/street.js brightonKit) */
export const BRI = { X0, X1, ZC, HALF, SWK, SW, CW, CROSS: CROSS.map((c) => ({ ...c })), STN_X };

export function buildBrighton(world) {
  const { ctx, W, scene } = world; const lite = !!ctx.lite, rnd = mulberry(1622);
  (W.zones || (W.zones = [])).push({ ...BR, name: 'BRIGHTON BEACH', hint: 'West for Coney' });
  B = { world, ctx, W, figs: [], t: 0 };
  W.brighton = { zone: BR };   // subway.js: Ocean Pkwy station skips its own street block
  // ---- ground: the avenue and cross streets at 0, kerbs / blocks at SW, the boardwalk deck at 0, then the sand ----
  const onRoad = (x, z) => {
    if (x < X0 && z > ZC - HALF) return true;   // the plaza where Surf Ave meets the avenue
    if (Math.abs(z - ZC) < HALF && x < X1) return true;
    if (z > ZC && z < BW.z0 - 4) for (const c of CROSS) if (Math.abs(x - c.x) < CW) return true;
    return false;
  };
  { const gh = W.groundHeight; W.groundHeight = (x, z) => {
      if (x > 790 && x < BR.x1 + 10 && z > BW.z0 && z < BW.z1) return 0;
      if (x > 900 && x < BR.x1 + 30 && z > BR.z0 - 30 && z < BR.z1) return z >= BW.z1 ? sandHeight(x, z) : onRoad(x, z) ? 0 : SW;
      return gh ? gh(x, z) : 0; }; }
  const wbox = (x0, y0, z0, x1, y1, z1) => world.box([Math.min(x0, x1), y0, Math.min(z0, z1)], [Math.max(x0, x1), y1, Math.max(z0, z1)]);
  const M = mats(lite, brickFacadeKit(world)), frnd = mulberry(1623); /* frnd: the facade details' own stream (rnd lays out the avenue) */ const G = new Map(); const put = (m, g) => { g = g.index ? g.toNonIndexed() : g; (G.get(m) || G.set(m, []).get(m)).push(g); return g; };
  const box = (m, x0, y0, z0, x1, y1, z1, col) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); if (col != null) tint(g, col); return put(m, g); };
  const plane = (m, x0, z0, x1, z1, y, uvs = 0) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); if (uvs) scaleUV(g, (x1 - x0) / uvs, (z1 - z0) / uvs); return put(m, g); };

  // asphalt: the avenue, the plaza, the cross streets, the connector from Surf Ave
  plane(M.road, 900, ZC - HALF, X1, ZC + HALF, 0.012, 12);
  plane(M.road, 900, ZC + HALF, X0, BW.z0 - 4, 0.012, 12);
  for (const c of CROSS) plane(M.road, c.x - CW, ZC + HALF, c.x + CW, BW.z0 - 4, 0.012, 12);
  { const [[ax, az], [bx, bz]] = CONN, L = Math.hypot(bx - ax, bz - az), g = new THREE.PlaneGeometry(22, L + 20); g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(bx - ax, bz - az)); g.translate((ax + bx) / 2, 0.014, (az + bz) / 2); scaleUV(g, 2, L / 12); put(M.road, g); }
  // the blocks: kerb-high slabs (sidewalks round them); north side one long strip
  box(M.walk, 900, 0, BR.z0 - 2, X1 + 10, SW, ZC - HALF, 0xb9b5ac);
  const blocks = []; { let a = X0; for (const c of [...CROSS, { x: X1 + CW + 4 }]) { blocks.push([a, c.x - CW]); a = c.x + CW; } }
  for (const [a, b] of blocks) box(M.walk, a, 0, ZC + HALF, b, SW, BW.z0 - 4, 0xb9b5ac);
  box(M.walk, 900, 0, BW.z0 - 4, X1 + 10, SW, BW.z0, 0xb0aca3);
  // double yellow, lane lines
  for (let x = 905; x < X1; x += 6) { box(M.paint, x, 0.016, ZC - 0.18, x + 3.5, 0.02, ZC - 0.06, 0xe8c33a); box(M.paint, x, 0.016, ZC + 0.06, x + 3.5, 0.02, ZC + 0.18, 0xe8c33a); }

  // ---- the atlas: every storefront sign on one canvas ----
  const cells = [], CAN = document.createElement('canvas'); CAN.width = lite ? 1024 : 2048; CAN.height = lite ? 512 : 1024; const cg = CAN.getContext('2d'), cw = CAN.width / 4, ch = CAN.height / 16;
  SHOPS.forEach((s, i) => { const x = (i % 4) * cw, y = Math.floor(i / 4) * ch; drawSign(cg, x, y, cw, ch, s); cells.push({ u0: x / CAN.width, u1: (x + cw) / CAN.width, v0: 1 - (y + ch) / CAN.height, v1: 1 - y / CAN.height }); });
  { const i = SHOPS.length, x = (i % 4) * cw, y = Math.floor(i / 4) * ch; drawStation(cg, x, y, cw, ch); cells.push({ u0: x / CAN.width, u1: (x + cw) / CAN.width, v0: 1 - (y + ch) / CAN.height, v1: 1 - y / CAN.height }); }
  const atlas = new THREE.CanvasTexture(CAN); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4; M.sign.map = atlas; M.sign.emissiveMap = atlas; M.sign.needsUpdate = true;
  if (M.sign?.emissive) (W.nightGlow || (W.nightGlow = [])).push({ m: M.sign, e0: M.sign.emissiveIntensity, f: 6 });   // the shop signs light up after dark (horizon.js)
  const signQuad = (cell, w, h, x, y, z, ry) => { const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0)); g.rotateY(ry); g.translate(x, y, z); return put(M.sign, g); };

  // ---- buildings: walk-ups with a shop on the ground floor facing the avenue; apartment blocks behind the south row ----
  const brick = [0x9a5a44, 0x8a4a3a, 0xb07a5a, 0xa8876a, 0x7e4a3a, 0xc2a07a, 0x6f5a4a];
  let si = 0;
  const units = W.shopUnits || (W.shopUnits = []); let enterN = 0; const ENTER_MAX = ctx.safeMode ? 0 : lite ? 4 : 10;   // safe mode (ctx.js): no walk-in shops
  // the walls: street + back faces in windowed brick (3 tones, soft per-building tints), the party walls plain brick, a tar roof
  const facWall = (x0, z0, x1, z1, h, y0, v, ci, free = false) => { /* free: a block standing alone (windows on all four sides) */ const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0), g = new THREE.BoxGeometry(w, h, d); g.translate((x0 + x1) / 2, SW + h / 2, (z0 + z1) / 2);
    facadeBoxUV(g, w, h, d, y0); tint(g, BR_SOFT[ci]); put(M.walls[v], boxFaces(g, free ? [0, 1, 4, 5] : [4, 5])); if (!free) put(M.wallsPlain, tint(metreUV(boxFaces(g, [0, 1])), BR_PLAIN[v])); put(M.roof, tint(boxFaces(g, [2]), 0x55524c)); };
  // wrought-iron fire escapes and window AC units on the avenue walk-ups (desktop: phones skip the extra geometry)
  const ironBox = (x0, y0, z0, x1, y1, z1) => box(M.steel, Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), 0x262829);
  const walkupDetails = (x0, x1, zFace, sd, floors) => { if (lite || floors < 3) return;
    const w = x1 - x0, nb = Math.max(1, Math.round(w / FAC.BAY)), bw = w / nb, cx = (x0 + x1) / 2, fe = frnd() < 0.5 && w > 6 ? Math.min(4.2, w - 1.6) : 0, zo = zFace - sd * 1.15;
    for (let f = 1; f < floors; f++) { const y = SW + GF + (f - 1) * FAC.FL;
      if (fe) { ironBox(cx - fe / 2, y, zFace - sd * 0.02, cx + fe / 2, y + 0.05, zo);                                   // the grating
        for (const yy of [0.5, 0.98]) ironBox(cx - fe / 2, y + yy, zo, cx + fe / 2, y + yy + 0.035, zo + sd * 0.035);       // rails
        for (const ex of [cx - fe / 2, cx + fe / 2 - 0.035]) ironBox(ex, y + 0.98, zFace - sd * 0.02, ex + 0.035, y + 1.015, zo);
        for (let k = 0; k <= 8; k++) { const bx = cx - fe / 2 + k * (fe - 0.025) / 8; ironBox(bx, y, zo, bx + 0.025, y + 1.0, zo + sd * 0.025); }   // balusters
        if (f < floors - 1) { const L = Math.hypot(fe * 0.72, FAC.FL), st = new THREE.BoxGeometry(L, 0.04, 0.5); st.rotateZ(Math.atan2(FAC.FL, fe * 0.72) * (f & 1 ? 1 : -1)); st.translate(cx, y + FAC.FL / 2, zo + sd * 0.3); tint(st, 0x262829); put(M.steel, st); } }
      for (let b = 0; b < nb; b++) { const ax = x0 + (b + 0.5) * bw; if ((fe && Math.abs(ax - cx) < fe / 2 + 0.4) || frnd() > 0.3) continue; const ys = y + FAC.SILL;
        box(M.trim, ax - 0.31, ys + 0.04, Math.min(zFace + sd * 0.05, zFace - sd * 0.34), ax + 0.31, ys + 0.46, Math.max(zFace + sd * 0.05, zFace - sd * 0.34), 0xc9c6bf); } }
  };
  const walkup = (x0, x1, zFace, sd, depth, floors) => {   // sd: which way the building runs back from its face (-1: the north row, +1: the south row); the street is at -sd
    const h = 4.2 + (floors - 1) * 3.1, zb = zFace + sd * depth, ci = Math.floor(rnd() * brick.length);
    facWall(x0, zFace, x1, zb, h, GF - FAC.FL, BR_VAR[ci], ci);
    // a shop you can walk into (every few doors): the room is left out of the building's collider, the doorway open
    const S = SHOPS[si % SHOPS.length], enter = enterN < ENTER_MAX && x1 - x0 >= 7 && si % 6 === 2, dmid = (x0 + x1) / 2, H = 3.3, rd = Math.min(9, depth - 1.5);
    if (enter) { const zr = zFace + sd * rd;
      wbox(x0, 0, zFace, x0 + 0.4, SW + h, zb); wbox(x1 - 0.4, 0, zFace, x1, SW + h, zb); wbox(x0 + 0.4, 0, zr, x1 - 0.4, SW + h, zb); wbox(x0 + 0.4, SW + H, zFace, x1 - 0.4, SW + h, zr);
      wbox(x0 + 0.4, 0, zFace, dmid - 0.8, SW + H, zFace + sd * 0.25); wbox(dmid + 0.8, 0, zFace, x1 - 0.4, SW + H, zFace + sd * 0.25);
      const n = new THREE.Vector3(0, 0, -sd), t = new THREE.Vector3(sd < 0 ? 1 : -1, 0, 0), m = new THREE.Matrix4().makeBasis(t, new THREE.Vector3(0, 1, 0), n).setPosition(sd < 0 ? x0 : x1, SW, zFace);
      units.push({ m: m.elements.slice(), flip: false, L: x1 - x0, u0: 0, u1: x1 - x0, dx: (x1 - x0) / 2 - 0.8, dw: 1.6, rd, H, kind: brKind(S[1]), name: S[1], c: [dmid, SW, zFace + sd * rd / 2], y0: SW }); enterN++;
    } else wbox(x0, 0, zFace, x1, SW + h, zb);
    // cornice, the shop: dark glass, a door, the sign band (atlas), an awning on some
    box(M.trim, x0, SW + h - 0.1, zFace - sd * 0.35, x1, SW + h + 0.25, zFace, 0x8d877c); walkupDetails(x0, x1, zFace, sd, floors);
    const fz = zFace - sd * 0.04, ry = sd > 0 ? Math.PI : 0;
    if (enter) { box(M.glass, x0 + 0.4, SW + 0.3, fz, dmid - 0.8, SW + 2.9, fz - sd * 0.02); box(M.glass, dmid + 0.8, SW + 0.3, fz, x1 - 0.4, SW + 2.9, fz - sd * 0.02); box(M.trim, dmid - 0.85, SW, fz - sd * 0.03, dmid - 0.8, SW + 2.9, fz - sd * 0.08, 0x2a2622); box(M.trim, dmid + 0.8, SW, fz - sd * 0.03, dmid + 0.85, SW + 2.9, fz - sd * 0.08, 0x2a2622); }
    else { box(M.glass, x0 + 0.4, SW + 0.3, fz, x1 - 0.4, SW + 2.9, fz - sd * 0.02);
      box(M.trim, (x0 + x1) / 2 - 0.55, SW, fz - sd * 0.03, (x0 + x1) / 2 + 0.55, SW + 2.4, fz - sd * 0.06, 0x2a2622); }
    if (/ТАТЬЯНА|КАФЕ|ПИВО|ЛОМБАРД|ПЕЛЬМЕН|КОСМЕТИКА/.test(S[0]) && (W.brNeon || []).length < 6) { const col = [0xff3fa0, 0x3fd0ff, 0xffe04a, 0x7a5aff][(W.brNeon || []).length % 4], nm = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 }), sw2 = Math.min(x1 - x0 - 0.6, 9) / 2 + 0.12, zc = fz - sd * 0.12, y0 = SW + 2.92, y1 = SW + 4.18, gs = [];
      for (const [a, b, c2, d2] of [[-sw2, y0, sw2, y0 + 0.06], [-sw2, y1 - 0.06, sw2, y1], [-sw2, y0, -sw2 + 0.06, y1], [sw2 - 0.06, y0, sw2, y1]]) { const g = new THREE.BoxGeometry(c2 - a, d2 - b, 0.05); g.translate((x0 + x1) / 2 + (a + c2) / 2, (b + d2) / 2, zc); gs.push(g); }
      const nmesh = new THREE.Mesh(mergeGeometries(gs, false), nm); nmesh.name = 'brighton:neon'; scene.add(nmesh); (W.brNeon || (W.brNeon = [])).push({ m: nm, next: 3 + Math.random() * 6, off: 0 });
      if (/ТАТЬЯНА|КАФЕ/.test(S[0])) for (let k = 0; k < 3; k++) (W.nightSpots || (W.nightSpots = [])).push({ x: (x0 + x1) / 2 + (k - 1) * 1.6, y: SW, z: zFace - sd * (2.4 + (k % 2) * 0.8), ry: sd > 0 ? 0 : Math.PI, pose: k === 1 ? 'phone' : 'stand', zone: 'nightlife' }); }
    signQuad(cells[si++ % SHOPS.length], Math.min(x1 - x0 - 0.6, 9), 1.1, (x0 + x1) / 2, SW + 3.55, fz - sd * 0.05, ry);
    if (rnd() < 0.45) { const aw = new THREE.BoxGeometry(x1 - x0 - 0.6, 0.06, 1.4); aw.rotateX(-sd * 0.3); aw.translate((x0 + x1) / 2, SW + 3.0, zFace - sd * 0.7); tint(aw, [0xb3121e, 0x1f4a2e, 0x1b3f9a, 0xd9a400][Math.floor(rnd() * 4)]); put(M.trim, aw); }
  };
  // north side of the avenue: one continuous row
  for (let x = NROW0; x < X1; ) { let w = 7 + Math.floor(rnd() * 3) * 2.5; if (x + w > X1) w = X1 - x; walkup(x, x + w, ZC - HALF - SWK, -1, 18, 3 + Math.floor(rnd() * 3)); x += w; }
  // south side: shops along the avenue, a six-storey block behind, a courtyard strip toward the boardwalk
  for (const [a, b] of blocks) {
    for (let x = a + 1; x < b - 1; ) { let w = 7 + Math.floor(rnd() * 3) * 2.5; if (x + w > b - 1) w = b - 1 - x; if (w < 4) break; walkup(x, x + w, ZC + HALF + SWK, 1, 16, 2 + Math.floor(rnd() * 2)); x += w; }
    const z0 = ZC + HALF + SWK + 22, z1 = BW.z0 - 22, fl = 6 + Math.floor(rnd() * 3), h = fl * 3.0 + 1;
    for (const [p, q] of [[a + 3, (a + b) / 2 - 4], [(a + b) / 2 + 4, b - 3]]) { if (q - p < 12) continue; facWall(p, z0, q, z1, h, h - fl * FAC.FL, BLOCK_VAR, Math.floor(rnd() * brick.length), true); wbox(p, 0, z0, q, SW + h, z1);
      box(M.trim, p - 0.2, SW + h, z0 - 0.2, q + 0.2, SW + h + 0.5, z1 + 0.2, 0x8d877c); }
  }

  // ---- the el over the avenue: steel bents every 15 m, girders, the deck and the rails; the Brighton Beach station ----
  { const zs = [ZC - HALF + 1.2, ZC + HALF - 1.2];
    for (let x = EL0; x <= X1; x += 15) { for (const z of zs) { box(M.el, x - 0.3, 0, z - 0.3, x + 0.3, EL_Y, z + 0.3, 0x3f5a47); wbox(x - 0.35, 0, z - 0.35, x + 0.35, EL_Y, z + 0.35); }
      box(M.el, x - 0.35, EL_Y - 0.8, zs[0], x + 0.35, EL_Y, zs[1], 0x3f5a47); }
    for (const z of zs) box(M.el, EL0, EL_Y - 0.9, z - 0.4, X1, EL_Y + 0.2, z + 0.4, 0x3f5a47);
    box(M.el, EL0, EL_Y, zs[0], X1, EL_Y + 0.35, zs[1], 0x4a4a46);
    for (const dz of [-2.4, -0.9, 0.9, 2.4]) box(M.steel, EL0, EL_Y + 0.35, ZC + dz - 0.05, X1, EL_Y + 0.5, ZC + dz + 0.05, 0x6d6f70);
    // the station: side platforms with a canopy, stairs down to the sidewalk, name boards
    const L = 150, s0 = STN_X - L / 2, s1 = STN_X + L / 2;
    for (const sd of [-1, 1]) { const zp0 = ZC + sd * (HALF - 1.2), zp1 = ZC + sd * (HALF + 2.6);
      box(M.walk, s0, EL_Y + 0.35, Math.min(zp0, zp1), s1, EL_Y + 1.25, Math.max(zp0, zp1), 0x9c988e); box(M.paint, s0, EL_Y + 1.25, zp0 - sd * 0.15, s1, EL_Y + 1.27, zp0 + sd * 0.45, 0xe8c33a);
      for (let x = s0 + 5; x < s1; x += 12) box(M.el, x - 0.12, EL_Y + 1.25, zp1 - sd * 0.5 - 0.12, x + 0.12, EL_Y + 4.3, zp1 - sd * 0.5 + 0.12, 0x3f5a47);
      box(M.roof, s0, EL_Y + 4.3, Math.min(zp0, zp1) - 0.3, s1, EL_Y + 4.45, Math.max(zp0, zp1) + 0.3, 0x5a6a62);
      for (const x of [s0 + 30, STN_X, s1 - 30]) signQuad(cells[SHOPS.length], 5, 0.9, x, EL_Y + 3.2, zp1 - sd * 0.6, sd > 0 ? Math.PI : 0);
      // stairs down to the sidewalk at the east end
      const zs0 = ZC + sd * (HALF + SWK - 1.2); for (let k = 0; k < 18; k++) { const y = EL_Y + 1.25 - (k + 1) * (EL_Y + 1.1) / 18; box(M.walk, s1 - 2 - (k + 1) * 0.55, Math.max(SW, y), zs0 - 1.1, s1 - 2 - k * 0.55, y + 0.12, zs0 + 1.1, 0x8f8b82); }
      box(M.el, s1 - 12, SW, zs0 - 1.2, s1 - 2, EL_Y + 1.25, zs0 - 1.15, 0x3f5a47); }
    // green globes at the stair foot
    for (const sd of [-1, 1]) { const g = new THREE.SphereGeometry(0.22, 12, 8); g.translate(STN_X + L / 2 - 12, SW + 2.6, ZC + sd * (HALF + SWK - 0.2)); put(M.globe, g); }
  }

  // ---- lamps, trees, hydrants on the avenue; parked cars along both kerbs ----
  for (let x = 910; x < X1; x += 32) for (const sd of [-1, 1]) { const z = ZC + sd * (HALF + 0.6); box(M.steel, x - 0.07, 0, z - 0.07, x + 0.07, 8.2, z + 0.07, 0x2a2c2e); box(M.lamp, x - 0.2, 8.0, z - sd * 1.8 - 0.35, x + 0.2, 8.14, z - sd * 1.8 + 0.35); (W.extraLamps || (W.extraLamps = [])).push([x, 8.0, z - sd * 1.8]); box(M.steel, x - 0.05, 8.1, z - sd * 1.8, x + 0.05, 8.2, z, 0x2a2c2e); wbox(x - 0.15, 0, z - 0.15, x + 0.15, 4, z + 0.15); }
  { const leaf = new THREE.IcosahedronGeometry(2.1, lite ? 0 : 1); const trees = []; for (const c of CROSS) for (let z = ZC + HALF + 30; z < BW.z0 - 10; z += 18) for (const sd of [-1, 1]) if (rnd() < 0.7) trees.push([c.x + sd * (CW + 1.3), z]);
    for (const [x, z] of trees) { box(M.bark, x - 0.14, 0, z - 0.14, x + 0.14, 3.4, z + 0.14, 0x6a5a44); wbox(x - 0.2, 0, z - 0.2, x + 0.2, 3, z + 0.2); }
    const im = new THREE.InstancedMesh(leaf, M.leaf, trees.length), o = new THREE.Object3D(), c = new THREE.Color(); trees.forEach(([x, z], i) => { o.position.set(x, 4.6, z); o.scale.set(1.2, 1, 1.2); o.rotation.y = rnd() * 6; o.updateMatrix(); im.setMatrixAt(i, o.matrix); c.setHSL(0.26 + rnd() * 0.05, 0.4, 0.2 + rnd() * 0.06); im.setColorAt(i, c); });
    im.castShadow = !lite; im.receiveShadow = true; scene.add(im); }
  { const list = []; for (let x = 1010; x < X1 - 10; x += 6.4 + rnd() * 1.6) for (const sd of [-1, 1]) { if (CROSS.some((c) => Math.abs(c.x - x) < CW + 3) || Math.abs(x - STN_X - 63) < 6 || rnd() < (lite ? 0.55 : 0.3)) continue; list.push({ x, z: ZC + sd * (HALF - 1.2), ry: sd > 0 ? 0 : Math.PI, kind: rnd() < 0.18 ? 'suv' : rnd() < 0.08 ? 'cab' : 'sedan' }); }
    try { placeCars(world, list, { raycast: true }); for (const c of list) wbox(c.x - 2.2, 0, c.z - 0.9, c.x + 2.2, 1.4, c.z + 0.9); } catch (e) { console.warn('[brighton] cars', e); } }

  // ---- the boardwalk carries on from Coney: deck, bulkhead, rails with gaps for the beach steps, lamps, benches ----
  { const x0 = 790, x1 = X1 + 10; plane(M.deck, x0, BW.z0, x1, BW.z1, 0.02, 2.4);
    box(M.bark, x0, SAND_TOP - 0.6, BW.z1 - 0.02, x1, -0.12, BW.z1 + 0.05, 0x4a3a2a);
    for (let x = x0; x < x1; x += 3) box(M.bark, x - 0.12, SAND_TOP - 1, BW.z1 - 0.2, x + 0.12, -0.1, BW.z1 - 0.05, 0x3a2e22);
    for (let x = x0 + 4; x < x1 - 4; x += 3.9) { if (((x - x0) % 110) < 8) continue; box(M.rail, x - 0.05, 0, BW.z1 - 0.1, x + 0.05, 1.0, BW.z1, 0x2d4a3a); }
    for (let x = x0; x < x1; x += 110) { box(M.rail, x + 8, 0.95, BW.z1 - 0.12, Math.min(x1, x + 110), 1.05, BW.z1, 0x2d4a3a); wbox(x + 8, 0, BW.z1 - 0.2, Math.min(x1, x + 110), 1.05, BW.z1 + 0.1); }
    for (let x = x0 + 12; x < x1; x += 30) { box(M.steel, x - 0.08, 0, BW.z0 + 0.8 - 0.08, x + 0.08, 4.6, BW.z0 + 0.8 + 0.08, 0x2d4a3a); const gl = new THREE.SphereGeometry(0.28, 10, 8); gl.translate(x, 4.8, BW.z0 + 0.8); put(M.globe, gl); }
    for (let x = x0 + 20; x < x1; x += 21) for (const z of [BW.z0 + 1.6, BW.z1 - 1.6]) { box(M.bench, x - 1.1, 0.42, z - 0.25, x + 1.1, 0.5, z + 0.25, 0x6b4f35); box(M.bench, x - 1.1, 0.5, z + (z < BW.z0 + 5 ? -0.28 : 0.2), x + 1.1, 0.95, z + (z < BW.z0 + 5 ? -0.2 : 0.28), 0x6b4f35); wbox(x - 1.1, 0, z - 0.3, x + 1.1, 0.5, z + 0.3); } }   // benches are solid (sat on, not walked through)
  // the sand past the bulkhead, down into the water (the same profile as Coney's)
  { const x0 = 900, x1 = BR.x1, sx = lite ? 12 : 6, zs = []; for (let z = BW.z1; z < 430; z += z < 330 ? 4 : 10) zs.push(z); const nx = Math.ceil((x1 - x0) / sx), pos = [], uv = [], idx = [];
    for (let j = 0; j < zs.length; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * sx; pos.push(x, sandHeight(x, zs[j]), zs[j]); uv.push(x / 6, zs[j] / 6); }
    for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, M.sand); m.name = 'brighton:sand'; m.receiveShadow = true; scene.add(m); }

  // ---- merge per material ----
  for (const [m, list] of G) { const merged = mergeGeometries(list.map(norm), false); if (!merged) { console.warn('[brighton] merge failed', m.name); continue; }
    const mesh = new THREE.Mesh(merged, m); mesh.name = 'brighton:' + m.name; mesh.receiveShadow = true; mesh.castShadow = !lite && m !== M.road && m !== M.walk && m !== M.deck && m !== M.paint && m !== M.sign; scene.add(mesh);
    if (M.walls.includes(m) || m === M.wallsPlain || m === M.el) ctx.raycastTargets?.push?.(mesh); }

  // ---- babushkas on the boardwalk benches, a few people out on the avenue ----
  if (peopleReady() && !lite) { const n = 16;   // phones: no extra figures out here (memory)
 for (let i = 0; i < n; i++) { try {
      const onBench = i < n * 0.6, x = onBench ? 810 + 21 * Math.floor(2 + rnd() * 60) : 1010 + rnd() * (X1 - 1030), z = onBench ? BW.z0 + 1.55 : ZC + (rnd() < 0.5 ? -1 : 1) * (HALF + 2.5);
      if (B.figs.some((g) => Math.hypot(g.group.position.x - x, g.group.position.z - z) < 0.8)) continue;   // the 0.8 m person gap (folk.js SPOT_GAP)
      const f = buildPerson({ avatar: onBench ? 'f09' : undefined, seed: 900 + i, pose: onBench ? 'sit' : undefined }); if (!f) continue;
      f.group.position.set(x, onBench ? 0.05 : SW, z); f.group.rotation.y = onBench ? 0 : rnd() * 6.28; scene.add(f.group); B.figs.push(f); } catch (e) { console.warn('[brighton] person', e); break; } } }
  // the neon: on with the lamps, a flicker every few seconds
  world.updaters.push((dt) => { const k = W.lampK ?? 0; for (const n of W.brNeon || []) { n.next -= dt; if (n.next <= 0) { n.off = 0.08 + Math.random() * 0.25; n.next = 3 + Math.random() * 6; } n.off -= dt; n.m.emissiveIntensity = (0.4 + 3.2 * k) * (n.off > 0 ? 0.15 + Math.random() * 0.3 : 1); } });
  if (M.walls[0].emissiveMap) world.updaters.push(() => { const k = 0.9 * (W.night ?? 0); for (const m of M.walls) m.emissiveIntensity = k; });   // lamps on in the flats after dark
  world.updaters.push((dt) => { const p = ctx.player?.position; if (!p) return; const near = p.x > 700; for (const f of B.figs) { f.group.visible = near; if (near && Math.abs(f.group.position.x - p.x) < 60) f.update(dt, 0); }
    if (p.x > 900 && !B.hint) { B.hint = 1; ctx.hud?.toast?.('BRIGHTON BEACH — Little Odessa. Brighton Beach Ave under the el, the boardwalk to the south. West for Coney.', 4200); } if (p.x < 700) B.hint = 0; });
  if (typeof window !== 'undefined' && window.__game) window.__game.brighton = { zone: BR, ave: { x0: X0, x1: X1, z: ZC }, station: STN_X, cross: CROSS.map((c) => c.x), gh: (x, z) => W.groundHeight(x, z) };
  console.log('[brighton] built ·', CROSS.length, 'cross streets ·', G.size, 'materials ·', B.figs.length, 'people');
}

// ---------------------------------------------------------------------------------------------------------------------------
function drawSign(g, x, y, w, h, [ru, en, bg, fg]) {
  g.fillStyle = bg; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = h * 0.5; do { g.font = `700 ${fs}px "Arial Black", Arial, sans-serif`; fs -= 1; } while (g.measureText(ru).width > w * 0.9 && fs > 6); g.fillText(ru, x + w / 2, y + h * 0.36);
  fs = h * 0.24; do { g.font = `600 ${fs}px Arial, sans-serif`; fs -= 1; } while (g.measureText(en).width > w * 0.9 && fs > 5); g.fillText(en, x + w / 2, y + h * 0.78);
}
function drawStation(g, x, y, w, h) { g.fillStyle = '#111'; g.fillRect(x, y, w, h); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `700 ${h * 0.44}px Helvetica, Arial`; g.fillText('Brighton Beach', x + h * 0.25, y + h * 0.5);
  [['B', '#ff6319', '#fff'], ['Q', '#fccc0a', '#111']].forEach(([t, c, f], i) => { const cx = x + w - h * (1.1 + i * 0.95); g.fillStyle = c; g.beginPath(); g.arc(cx, y + h / 2, h * 0.36, 0, 7); g.fill(); g.fillStyle = f; g.textAlign = 'center'; g.font = `700 ${h * 0.44}px Helvetica, Arial`; g.fillText(t, cx, y + h * 0.54); g.textAlign = 'left'; }); }
function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
function mats(lite, kit) {
  const S = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const q = lite ? 0.5 : 1;
  const road = canvasTex(256 * q, 256 * q, (g, w, h) => { g.fillStyle = '#3b3c3e'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000 * q; i++) { const v = 45 + Math.random() * 35; g.fillStyle = `rgba(${v},${v},${v + 2},.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, true);
  const planks = canvasTex(256 * q, 256 * q, (g, w, h) => { for (let i = 0; i < 16; i++) { const v = 120 + Math.random() * 40; g.fillStyle = `rgb(${v},${v * 0.78},${v * 0.55})`; g.fillRect(0, i * h / 16, w, h / 16 - 2); } g.fillStyle = 'rgba(0,0,0,.35)'; for (let i = 0; i < 16; i++) g.fillRect(0, i * h / 16 + h / 16 - 2, w, 2); }, true);
  const sand = canvasTex(256 * q, 256 * q, (g, w, h) => { g.fillStyle = '#d8c7a0'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6000 * q; i++) { const v = Math.random(); g.fillStyle = `rgba(${150 + v * 80},${130 + v * 70},${90 + v * 60},.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, true);
  const m = {
    road: S({ map: road, roughness: 0.92 }), walk: S({ vertexColors: true, roughness: 0.9 }), paint: S({ vertexColors: true, roughness: 0.6 }),
    wallsRed: kit.mat('brRed', { base: '#7a392c', dark: '#642d23', light: '#8c4636', mortar: '#8a7c70' }, {}, { vertexColors: true }),
    wallsTan: kit.mat('brTan', { base: '#b08a64', dark: '#9a7754', light: '#c09a72', mortar: '#cfc3b2' }, { soldier: true }, { vertexColors: true }),
    wallsBuff: kit.mat('brBuff', { base: '#c6b292', dark: '#b39e7e', light: '#d4c2a2', mortar: '#d9d0c0' }, { keystone: true }, { vertexColors: true }),
    wallsPlain: kit.plainMat({ vertexColors: true }), trim: S({ vertexColors: true, roughness: 0.7 }), roof: S({ vertexColors: true, roughness: 0.7, metalness: 0.2 }),
    glass: S({ color: 0x1a2430, roughness: 0.15, metalness: 0.4 }), sign: new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.25 }),
    el: S({ vertexColors: true, roughness: 0.7, metalness: 0.3 }), steel: S({ vertexColors: true, roughness: 0.5, metalness: 0.6 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0.6 }), globe: new THREE.MeshStandardMaterial({ color: 0x5fd07a, emissive: 0x2fbf5a, emissiveIntensity: 0.9 }),
    bark: S({ vertexColors: true, roughness: 0.95 }), leaf: new THREE.MeshLambertMaterial({ color: 0xffffff }), deck: S({ map: planks, roughness: 0.9 }), rail: S({ vertexColors: true, roughness: 0.6, metalness: 0.3 }),
    bench: S({ vertexColors: true, roughness: 0.85 }), sand: S({ map: sand, roughness: 0.97 }),
  };
  for (const k in m) m[k].name = k; m.walls = [m.wallsRed, m.wallsTan, m.wallsBuff]; return m;
}
function tint(g, hex) { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function scaleUV(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
/** every geometry merged per material needs the same attributes: colour (white where missing) and uv */
function norm(g) { const n = g.attributes.position.count; if (!g.attributes.color) tint(g, 0xffffff); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); return g; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

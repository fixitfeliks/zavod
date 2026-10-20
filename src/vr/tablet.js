// The wrist tablet: everything the flat game puts on keys and menus, as big buttons on a tablet in your off hand. Owned by: main (vr).
// Tabs: ACT (jump, talk, reload, grenade, jet pack, horn, radio …), BAG (take a drink / smoke / food out into your hand), GUNS, MAP (the
// live minimap), FRIENDS (who's online, durak, give $10), SETTINGS (turning, comfort, gun hand, eye height, exit VR) and HELP.
// Hands: turn your off palm towards your eyes and it's there; poke with the other index finger. Controllers: Y (or the left pad's centre)
// opens / closes it on the left controller; poke it with the right controller's tip, or point and pull the trigger.
// A first-time walk-through (tutorial()) floats in front of you on the first VR session, one step at a time, and finishes itself as you
// do each thing; HELP → TUTORIAL runs it again.
// Painted on a canvas only when something changed (the MAP tab: 4 times a second).
import * as THREE from 'three';
import { savePlay, AIM_ASSIST } from '../ctx.js';

const CW = 1024, CH = 704, TW = 0.32, TH = TW * CH / CW, TAB_H = 92, PAD = 10, COLS = 4, ROWS = 3;
const POKE_IN = 0.012, POKE_OUT = 0.025, HOVER_Z = 0.05, BACK_Z = -0.04;
const MAP_HZ = 4, PALM_FACING = 0.55;
const TABS = [['act', '⚡ ACT'], ['bag', '🎒 BAG'], ['guns', '🔫 GUNS'], ['map', '🗺 MAP'], ['uber', '🚕 UBER'], ['friends', '👥 CREW'], ['set', '⚙ SET'], ['help', '❔ HELP']];
const ACTS = [['⤒ JUMP', 'Space'], ['💬 TALK · F', 'KeyF'], ['🔄 RELOAD', 'KeyR'], ['🧎 CROUCH', 'crouch'], ['💣 GRENADE', 'KeyG'], ['🚀 JET PACK', 'KeyX'],
  ['📯 HORN', 'KeyQ'], ['📻 RADIO', 'KeyL'], ['⏭ NEXT SONG', 'Period'], ['🚽 TAKE A LEAK', 'KeyP'], ['🪟 CAR WINDOW', 'KeyO'], ['☠ RESPAWN', 'KeyT'], ['⏸ PAUSE MENU', 'pause']];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _ray = new THREE.Raycaster();

export function createTablet(host) {
  const { V, prefs } = host;
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TW, TH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  mesh.renderOrder = 9992; mesh.visible = false; mesh.name = 'xrTablet'; mesh.frustumCulled = false;
  const T = { mesh, shown: false, open: false, tab: 'act', page: 0, hot: -1, rects: [], sig: '', mapT: 0, down: false, laserPrev: false, near: false, over: false, help: 0 };

  // ---- painting --------------------------------------------------------------------------------------------------------------
  function content(ctx) {
    const K = host.K, st = K.state?.() || {}, W = ctx.weapons, out = [];
    // on a train the jet pack slot drives it; in the cab it throws the yard switch
    if (T.tab === 'act') for (const [t, k] of ACTS.map((a) => (a[1] !== 'KeyX' ? a : ctx.trainCab ? ['🔀 YARD SWITCH', 'KeyY'] : ctx.trainRide ? ['🚇 DRIVE THE TRAIN', 'KeyK'] : a))) out.push({ t, act: () => doAct(ctx, k), on: k === 'crouch' && V.crouch });
    else if (T.tab === 'bag') {
      const inv = st.inv || [], seen = new Map(); for (const it of inv) if (!host.ITEMS[it]?.keep) seen.set(it, (seen.get(it) || 0) + 1);
      for (const [it, n] of seen) { const I = host.ITEMS[it] || {}; out.push({ t: `${I.icon || '•'} ${(I.name || it).split(' (')[0]}`, sub: n > 1 ? `×${n}` : '', act: () => host.P.hold(ctx, it), on: V.held?.item === it }); }
      if (!out.length) out.push({ t: 'Nothing on you', sub: 'Hustlers, stores and the bar sell stuff', act: null });
    } else if (T.tab === 'guns') {
      const cur = W?.currentId; out.push({ t: '✊ FISTS', act: () => W?.fists?.(), on: cur === 'fists' });
      (W?.bag || []).forEach((id, i) => out.push({ t: '🔫 ' + String(id).toUpperCase().replace('AK74', 'AK').replace('M24', 'SNIPER'), sub: id === cur ? `${W.current?.ammo ?? '?'} / ${W.current?.reserve ?? '?'}` : '', act: () => W?.selectBag?.(i), on: id === cur }));
    } else if (T.tab === 'friends') {
      const net = ctx.net;
      out.push({ t: '🃏 PLAY DURAK', sub: 'at Arkasha\'s table', act: () => { ctx.bus.emit('durakFriends'); toggle(false); } });
      out.push({ t: '💵 GIVE $10', sub: 'to the friend next to you', act: () => host.tap('KeyN') });
      out.push({ t: '🔫 SELL A PISTOL', sub: 'to the friend next to you', act: () => host.tap('KeyJ') });
      out.push({ t: '🏆 SCORES', sub: 'hold up the board', act: () => { host.key('Tab', !V.tabOn); V.tabOn = !V.tabOn; }, on: V.tabOn });
      for (const s of net?.scores?.() || []) if (s.id !== net.id) out.push({ t: '👤 ' + s.name, sub: `${s.k} kills · ${s.d} deaths`, act: null });
      if (!net) out.push({ t: 'Offline', sub: 'Main menu → Play online', act: null });
    } else if (T.tab === 'set') {
      out.push({ t: '⟲ TURN LEFT', sub: `${prefs.snap}° (hands: no turn stick)`, act: () => doAct(ctx, 'turnL') }, { t: '⟳ TURN RIGHT', sub: `${prefs.snap}°`, act: () => doAct(ctx, 'turnR') });
      out.push({ t: prefs.smooth ? '↻ TURN: SMOOTH' : '↻ TURN: SNAP', act: () => setPref('smooth', !prefs.smooth) });
      out.push({ t: prefs.thumb ? '👍 THUMB TURN: ON' : '👍 THUMB TURN: OFF', sub: 'left thumb along your index', act: () => setPref('thumb', !prefs.thumb), on: prefs.thumb });
      out.push({ t: `∠ SNAP ${prefs.snap}°`, act: () => setPref('snap', prefs.snap === 30 ? 45 : prefs.snap === 45 ? 90 : 30) });
      out.push({ t: prefs.vignette ? '◎ TUNNEL: ON' : '◎ TUNNEL: OFF', act: () => setPref('vignette', !prefs.vignette) });
      out.push({ t: prefs.hud ? '▤ HUD: ON' : '▤ HUD: OFF', act: () => setPref('hud', !prefs.hud) });
      out.push({ t: prefs.left ? '✋ GUN HAND: LEFT' : '✋ GUN HAND: RIGHT', act: () => setPref('left', !prefs.left) });
      out.push({ t: `↕ EYES ${(+prefs.eye).toFixed(1)} m`, act: () => setPref('eye', prefs.eye >= 2 ? 1.6 : +prefs.eye + 0.2 > 1.95 ? 2 : +(+prefs.eye + 0.2).toFixed(1)) });
      { const G = ctx.settings, aim = G.aimAssist || 'low'; out.push({ t: `🎯 AIM ASSIST: ${aim.toUpperCase()}`, sub: 'thumbstick / flat-screen aim', act: () => { G.aimAssist = AIM_ASSIST[(AIM_ASSIST.indexOf(aim) + 1) % AIM_ASSIST.length]; savePlay(G); T.sig = ''; } });
        out.push({ t: G.dmgNumbers ? '💥 DAMAGE NUMBERS: ON' : '💥 DAMAGE NUMBERS: OFF', act: () => { G.dmgNumbers = !G.dmgNumbers; savePlay(G); T.sig = ''; }, on: !!G.dmgNumbers }); }
      out.push({ t: '⟲ RECALIBRATE', sub: 'stand or sit as you play', act: () => { V.seatH0 = V.head.y; ctx.hud?.toast?.('Height set', 900); } });
      out.push({ t: '🎓 TUTORIAL', act: () => { toggle(false); tutorial(true); } });
      out.push({ t: '⏸ PAUSE MENU', act: () => doAct(ctx, 'pause') });
      out.push({ t: '🚪 EXIT VR', act: () => V.session?.end() });
    } else if (T.tab === 'map') {
      out.push({ t: '🗺 FULL MAP', act: () => { host.tap('KeyM'); toggle(false); } });
    } else if (T.tab === 'uber') {   // coney chill: book a ride ($5), then the trip card (uberCard) with one button
      const Ub = ctx.uber;
      if (!Ub) out.push({ t: 'No Uber here', sub: 'Coney Island, chill mode', act: null });
      else if (Ub.active()) out.push({ t: Ub.label(), act: () => Ub.action() });
      else for (const d of Ub.dests()) out.push({ t: '🚕 ' + d.name, sub: '$5', act: () => Ub.request(d.id) });
    }
    return out;
  }
  function setPref(k, v) { prefs[k] = v; host.save(); T.sig = ''; }
  function doAct(ctx, k) {
    if (k === 'pause') { toggle(false); ctx.setState('paused'); return; }
    if (k === 'crouch') { V.crouch = !V.crouch; T.sig = ''; return; }
    if (k === 'turnL' || k === 'turnR') { V.turn += (k === 'turnL' ? 1 : -1) * prefs.snap * Math.PI / 180; V.vigKick = 1; return; }   // hands-only: no turn stick
    if (k === 'KeyV' && ctx.player?.mounted && !ctx.player.mounted.dialog) return;
    host.tap(k);
  }
  function paint(ctx) {
    const items = content(ctx), pages = Math.max(1, Math.ceil(items.length / (COLS * ROWS - (items.length > COLS * ROWS ? 1 : 0))));
    T.page = Math.min(T.page, pages - 1);
    g.clearRect(0, 0, CW, CH); g.fillStyle = 'rgba(12,14,18,0.94)'; g.beginPath(); g.roundRect(0, 0, CW, CH, 28); g.fill();
    T.rects = [];
    // the tab bar
    const tw = CW / TABS.length;
    TABS.forEach(([id, t], i) => { const r = { x: i * tw + 4, y: 6, w: tw - 8, h: TAB_H - 12, act: () => { T.tab = id; T.page = 0; T.sig = ''; }, tab: id }; T.rects.push(r);
      g.fillStyle = T.tab === id ? '#ffd27a' : '#232830'; g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 14); g.fill();
      g.fillStyle = T.tab === id ? '#111' : '#e9e2d0'; g.font = '800 26px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, r.x + r.w / 2, r.y + r.h / 2); });
    const top = TAB_H + 4;
    const card = T.tab === 'map' || (T.tab === 'uber' && !!ctx.uber?.active?.());   // a picture on the left, one button bottom right
    if (T.tab === 'map') { paintMap(ctx, top); } else if (card) uberCard(ctx, top);
    if (T.tab === 'help') { paintHelp(top); return; }
    // the grid (the map tab: one button under the map)
    const per = items.length > COLS * ROWS ? COLS * ROWS - 1 : COLS * ROWS, show = items.slice(T.page * per, T.page * per + per);
    const cw = (CW - PAD) / COLS, ch = (CH - top - PAD) / ROWS;
    const at = (i) => card ? { x: CW - cw + PAD / 2, y: CH - ch + PAD / 2, w: cw - PAD, h: ch - PAD } : { x: PAD / 2 + (i % COLS) * cw + PAD / 2, y: top + Math.floor(i / COLS) * ch + PAD / 2, w: cw - PAD, h: ch - PAD };
    show.forEach((it, i) => { const r = { ...at(i), act: it.act }; T.rects.push(r); button(r, it.t, it.sub, it.on, !it.act); });
    if (pages > 1) { const r = { ...at(COLS * ROWS - 1), act: () => { T.page = (T.page + 1) % pages; T.sig = ''; } }; T.rects.push(r); button(r, `▶ MORE ${T.page + 1}/${pages}`, '', false, false); }
  }
  function button(r, t, sub, on, dead) {
    const hot = T.rects.indexOf(r) === T.hot;
    g.fillStyle = on ? '#ffd27a' : hot ? '#3c4552' : dead ? '#1b1f25' : '#2a2f38'; g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 18); g.fill();
    if (hot) { g.strokeStyle = '#7dffb0'; g.lineWidth = 5; g.stroke(); }
    g.fillStyle = on ? '#111' : dead ? '#9aa2ad' : '#f2ecdc'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(t, r.x + r.w / 2, r.y + r.h / 2 - (sub ? 16 : 0), r.w - 20, 30);
    if (sub) { g.fillStyle = on ? '#333' : '#b9c2cc'; fitText(sub, r.x + r.w / 2, r.y + r.h / 2 + 24, r.w - 20, 21, 500); }
  }
  function fitText(t, x, y, w, size, weight = 800) {
    let s = size; g.font = `${weight} ${s}px system-ui`; while (g.measureText(t).width > w && s > 14) { s -= 2; g.font = `${weight} ${s}px system-ui`; }
    if (g.measureText(t).width > w) { const words = t.split(' '), half = Math.ceil(words.length / 2); g.fillText(words.slice(0, half).join(' '), x, y - s * 0.55, w); g.fillText(words.slice(half).join(' '), x, y + s * 0.55, w); }
    else g.fillText(t, x, y);
  }
  function paintMap(ctx, top) {
    const mini = document.querySelector('canvas.zvmini'), s = CH - top - PAD * 2;
    g.fillStyle = '#0a0c10'; g.fillRect(PAD, top + PAD, s, s);
    if (mini?.width) try { g.drawImage(mini, PAD, top + PAD, s, s); } catch {}
    const p = ctx.player?.position; g.fillStyle = '#e9e2d0'; g.font = '600 24px system-ui'; g.textAlign = 'left'; g.textBaseline = 'top';
    const lines = ['Up is where you face.', 'Yellow: you · red: trouble', 'Orange: friends · blue Ⓜ: subway', p ? `x ${p.x.toFixed(0)}  z ${p.z.toFixed(0)}` : ''];
    lines.forEach((t, i) => g.fillText(t, s + PAD * 3, top + PAD * 2 + i * 36, CW - s - PAD * 5));
  }
  function uberCard(ctx, top) {   // the phone's map canvas and its lines (coney/uber.js), redrawn with the map tab's rate
    const cv = ctx.uber.canvas(), s = CH - top - PAD * 2; g.fillStyle = '#0a0c10'; g.fillRect(PAD, top + PAD, s, s);
    if (cv?.width) try { g.drawImage(cv, PAD, top + PAD, s, s); } catch {}
    g.fillStyle = '#e9e2d0'; g.font = '600 25px system-ui'; g.textAlign = 'left'; g.textBaseline = 'top';
    ctx.uber.lines().forEach((t, i) => g.fillText(t, s + PAD * 3, top + PAD * 2 + i * 40, CW - s - PAD * 5));
  }
  function paintHelp(top) {
    const hands = !!host.offHand()?.src?.hand, pages = hands ? HELP_HANDS : HELP_PADS, pg = pages[T.help % pages.length];
    g.fillStyle = '#ffd27a'; g.font = '800 34px system-ui'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(pg[0], 30, top + 14);
    g.fillStyle = '#efe9da'; g.font = '500 27px system-ui'; pg.slice(1).forEach((t, i) => g.fillText(t, 30, top + 66 + i * 40, CW - 60));
    const bw = 230, bh = 76, y = CH - bh - 14;
    const next = { x: CW - bw - 20, y, w: bw, h: bh, act: () => { T.help++; T.sig = ''; } }, tut = { x: CW - bw * 2 - 40, y, w: bw, h: bh, act: () => { toggle(false); tutorial(true); } };
    T.rects.push(next, tut); button(next, `NEXT ▶ ${(T.help % pages.length) + 1}/${pages.length}`, '', false, false); button(tut, '🎓 TUTORIAL', '', false, false);
  }

  // ---- showing it ------------------------------------------------------------------------------------------------------------
  function toggle(on = !T.open) { T.open = !!on; T.sig = ''; if (T.open) host.pulse(host.offHand(), 0.2, 20); }
  /** per frame (after the rig is placed): where it is, whether it shows, poke / laser presses. Returns true while it's taking input */
  function update(ctx, dt) {
    const O = host.offHand(), M = host.mainHand(), playing = ctx.state === 'playing';
    const handO = O?.src?.hand ? O : null, holder = O ? (handO ? O.hand.joints['wrist'] : O.grip) : null;
    if (!holder || !playing) { hide(); return false; }
    if (mesh.parent !== holder) holder.add(mesh);
    let show = T.open;
    if (handO) {   // a hand: the palm towards your eyes (a joint's -Y points out of the palm)
      holder.updateMatrixWorld(); _v.set(0, -1, 0).transformDirection(holder.matrixWorld); _v2.setFromMatrixPosition(holder.matrixWorld);
      const eye = V.cam.getWorldPosition(new THREE.Vector3()).sub(_v2).normalize(); show = show || _v.dot(eye) > PALM_FACING;
      mesh.position.set(0, -0.13, -0.05);
    } else mesh.position.set(0, 0.13, -0.08);   // a controller: held up above it like a tablet
    mesh.lookAt(V.cam.getWorldPosition(_v2));
    T.shown = mesh.visible = show; V.wrist.shown = show;
    if (!show) { T.near = T.over = false; T.hot = -1; return false; }
    // input: the main hand's fingertip (or the controller's tip) poking it, or its laser and trigger / pinch
    mesh.updateMatrixWorld(true);
    let hot = -1, press = false; T.near = false;
    const tip = host.tipOf(M, _v);
    if (tip) { mesh.worldToLocal(_v); const inside = Math.abs(_v.x) < TW / 2 && Math.abs(_v.y) < TH / 2;
      if (inside && _v.z < HOVER_Z && _v.z > BACK_Z) { T.near = true; hot = hitAt(_v.x, _v.y); if (_v.z < POKE_IN && !T.down) { T.down = true; press = true; } }
      if (!inside || _v.z > POKE_OUT) T.down = false; }
    T.over = false;
    if (M && hot < 0) {   // the laser
      M.ray.updateMatrixWorld(); _m.identity().extractRotation(M.ray.matrixWorld); _ray.ray.origin.setFromMatrixPosition(M.ray.matrixWorld); _ray.ray.direction.set(0, 0, -1).applyMatrix4(_m);
      const hit = _ray.intersectObject(mesh, false)[0], trig = M.src?.hand ? !!M.pinch : !!M.src?.gamepad?.buttons?.[0]?.pressed;
      if (hit) { T.over = true; hot = hitAt((hit.uv.x - 0.5) * TW, (hit.uv.y - 0.5) * TH); laserShow(M, hit.distance); if (trig && !T.laserPrev) press = true; }
      T.laserPrev = trig;
    }
    if (hot !== T.hot) { T.hot = hot; T.sig = ''; }
    if (press && hot >= 0) { const r = T.rects[hot]; if (r?.act) { host.pulse(M, 0.35, 25); r.act(); T.sig = ''; } }
    // repaint: on change, the map tab steadily
    T.mapT -= dt; const sig = sigOf(ctx);
    if (sig !== T.sig || ((T.tab === 'map' || T.tab === 'uber') && T.mapT <= 0)) { T.sig = sig; T.mapT = 1 / MAP_HZ; paint(ctx); tex.needsUpdate = true; }
    return T.near || T.over;
  }
  function laserShow(H, d) { const L = H.laser; if (!L) return; L.line.visible = true; L.line.scale.z = d; L.line.material.color.set(0x7dffb0); L.dot.visible = true; L.dot.position.set(0, 0, -d + 0.002); }
  function hitAt(x, y) { const px = (x / TW + 0.5) * CW, py = (0.5 - y / TH) * CH; return T.rects.findIndex((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h); }
  function sigOf(ctx) { const st = host.K.state?.() || {}, W = ctx.weapons; return [T.tab, T.page, T.hot, T.help, (st.inv || []).join(), W?.currentId, W?.current?.ammo, (W?.bag || []).join(), V.crouch, V.tabOn, V.held?.item, !!ctx.trainCab, JSON.stringify(prefs), ctx.net?.scores?.().length].join('|'); }
  function hide() { mesh.visible = T.shown = false; V.wrist.shown = false; T.near = T.over = false; }

  // ---- the first-time walk-through --------------------------------------------------------------------------------------------
  const tc = document.createElement('canvas'); tc.width = 1024; tc.height = 360; const tg = tc.getContext('2d'), ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.SRGBColorSpace;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.28), new THREE.MeshBasicMaterial({ map: ttex, transparent: true, depthTest: false, toneMapped: false })); card.renderOrder = 9994; card.visible = false; card.name = 'xrTutorial'; card.frustumCulled = false;
  const tut = { on: false, step: 0, t: 0, sig: '', yaw: null, start: null, turn0: 0, shots: 0, skipDown: false, laserPrev: false };
  host.ctx.bus.on('shot', (e) => { if (e?.who === 'player') tut.shots++; });
  function tutorial(on) { tut.on = !!on; tut.step = 0; tut.t = 0; tut.sig = ''; tut.start = null; if (!card.parent) V.rig.add(card); card.visible = tut.on; }
  function tutUpdate(ctx, dt) {
    if (!tut.on) { card.visible = false; return false; }
    const hands = !!host.offHand()?.src?.hand, s = STEPS[tut.step]; if (!s) { tut.on = false; card.visible = false; prefs.tut = true; host.save(); return false; }
    const p = ctx.player; if (!tut.start && p) { tut.start = p.position.clone(); tut.turn0 = V.turn; tut.shot0 = tut.shots; }
    tut.t += dt;
    if (ctx.state === 'playing' && s.done({ ctx, V, T, tut, p, hands })) { tut.step++; tut.t = 0; tut.start = null; host.pulse(host.mainHand(), 0.5, 40); host.pulse(host.offHand(), 0.5, 40); return true; }
    card.visible = ctx.state === 'playing';
    // ahead of you at chest height, lazily following your head
    const e = new THREE.Euler().setFromQuaternion(V.headQ, 'YXZ'); tut.yaw = tut.yaw == null ? e.y : tut.yaw + Math.atan2(Math.sin(e.y - tut.yaw), Math.cos(e.y - tut.yaw)) * Math.min(1, dt * 1.5);
    card.position.set(V.head.x - Math.sin(tut.yaw) * 1.1, V.head.y - 0.25, V.head.z - Math.cos(tut.yaw) * 1.1); card.rotation.set(-0.15, tut.yaw, 0); card.updateMatrixWorld(true);
    const sig = `${tut.step}|${hands}`; if (sig !== tut.sig) { tut.sig = sig; paintCard(s, hands); }
    // SKIP (bottom right): poke it or point at it and pull the trigger / pinch
    const M = host.mainHand(); let skip = false;
    if (host.tipOf(M, _v)) { card.worldToLocal(_v); if (_v.x > 0.22 && _v.y < -0.06 && Math.abs(_v.z) < 0.03) { if (!tut.skipDown) skip = true; tut.skipDown = true; } else if (_v.z > 0.05) tut.skipDown = false; }
    if (M) { M.ray.updateMatrixWorld(); _m.identity().extractRotation(M.ray.matrixWorld); _ray.ray.origin.setFromMatrixPosition(M.ray.matrixWorld); _ray.ray.direction.set(0, 0, -1).applyMatrix4(_m);
      const hit = _ray.intersectObject(card, false)[0], trig = M.src?.hand ? !!M.pinch : !!M.src?.gamepad?.buttons?.[0]?.pressed;
      if (hit && hit.uv.x > 0.775 && hit.uv.y < 0.28) { laserShow(M, hit.distance); if (trig && !tut.laserPrev) skip = true; }
      tut.laserPrev = trig; }
    if (skip) { tut.on = false; card.visible = false; prefs.tut = true; host.save(); }
    return false;
  }
  function paintCard(s, hands) {
    tg.clearRect(0, 0, 1024, 360); tg.fillStyle = 'rgba(12,14,18,0.93)'; tg.beginPath(); tg.roundRect(0, 0, 1024, 360, 30); tg.fill();
    tg.strokeStyle = '#ffd27a'; tg.lineWidth = 4; tg.stroke();
    tg.fillStyle = '#ffd27a'; tg.font = '800 40px system-ui'; tg.textAlign = 'left'; tg.textBaseline = 'top'; tg.fillText(`${tut.step + 1}/${STEPS.length} · ${s.title}`, 36, 26);
    tg.fillStyle = '#f2ecdc'; tg.font = '500 32px system-ui'; (hands ? s.hands : s.pads).forEach((t, i) => tg.fillText(t, 36, 96 + i * 46, 950));
    tg.fillStyle = '#2a2f38'; tg.beginPath(); tg.roundRect(800, 270, 196, 70, 16); tg.fill(); tg.fillStyle = '#e9e2d0'; tg.font = '800 30px system-ui'; tg.textAlign = 'center'; tg.textBaseline = 'middle'; tg.fillText('SKIP ✕', 898, 306);
    ttex.needsUpdate = true;
  }

  return { mesh, get shown() { return T.shown; }, get open() { return T.open; }, toggle, update, tutorial, tutUpdate, get tutOn() { return tut.on; }, get tutStep() { return tut.step; },
    /** QA: the world point at the centre of button i (tabs first, then the grid as painted) */
    rectWorld: (i) => { const r = T.rects[i]; if (!r) return null; mesh.updateMatrixWorld(true); return mesh.localToWorld(new THREE.Vector3(((r.x + r.w / 2) / CW - 0.5) * TW, (0.5 - (r.y + r.h / 2) / CH) * TH, 0)); },
    rectIndex: (tab) => T.rects.findIndex((r) => r.tab === tab),
    qa: () => ({ shown: T.shown, open: T.open, tab: T.tab, hot: T.hot, rects: T.rects.length, near: T.near, over: T.over, tut: tut.on ? tut.step : -1 }), setTab: (t) => { T.tab = t; T.sig = ''; } };
}

// the walk-through: each step ends when you've done it
const moved = ({ p, tut }) => p && tut.start && Math.hypot(p.position.x - tut.start.x, p.position.z - tut.start.z) > 2;
const STEPS = [
  { title: 'Walk', pads: ['Push the LEFT stick to walk where you look.', 'Click it (or hold the left trigger) to run.'],
    hands: ['Pinch your LEFT thumb and index finger and hold it,', 'then move that hand the way you want to walk.', 'Lift the pinched hand to jump.'], done: moved },
  { title: 'Turn', pads: ['Flick the RIGHT stick left or right to turn.', 'Smooth turning: ⚙ SET on your tablet.'],
    hands: ['Just turn your head and walk where you look.', 'Snap turn: slide your LEFT thumb along your index finger.'], done: ({ V, tut, hands }) => Math.abs(V.turn - tut.turn0) > 0.3 || (hands && tut.t > 6) },
  { title: 'Draw a gun', pads: ['Squeeze the RIGHT grip at your right hip: pistol.', 'Over your right shoulder: rifle. At your chest: knife.', 'Squeeze there again to put it away.'],
    hands: ['Make a finger gun with your RIGHT hand: your gun comes up.', 'Or make a fist at your hip (pistol) / over your shoulder (rifle).', 'A fist anywhere else: fists, for a fight.'], done: ({ ctx }) => { const id = ctx.weapons?.currentId; return !!id && id !== 'fists' && id !== 'knife'; } },
  { title: 'Shoot', pads: ['Pull the RIGHT trigger. The red dot is where it lands.', 'B reloads.'],
    hands: ['Pinch your RIGHT thumb and index finger to fire.', 'The red dot is where it lands.'], done: ({ tut }) => tut.shots > tut.shot0 },
  { title: 'Your tablet', pads: ['Press Y on the left controller: your tablet.', 'Bag, guns, map, crew, settings. Poke it or point + trigger.'],
    hands: ['Turn your LEFT palm towards your face: your tablet.', 'Poke the buttons with your right index finger.'], done: ({ T }) => T.shown },
  { title: 'Hands on', pads: ['X takes a drink / smoke / snack out of your bag:', 'bring it to your mouth. Grab a car\'s wheel or a bike\'s bars', 'with the grips to steer. Raise both fists to block a punch.'],
    hands: ['Take a drink or a smoke out on the tablet\'s BAG tab, then', 'bring it to your mouth. Grab a wheel with your fists to steer:', 'push it away for gas, pull back to brake. Fists up to block.'], done: ({ tut }) => tut.t > 12 },
];
const HELP_PADS = [
  ['Controllers', 'Left stick: walk (click: run) · Right stick: turn, ↑ next gun, ↓ crouch', 'Right trigger: fire / click · B: reload · A: jump', 'Right grip: F (talk, get in, board) · at your hip / shoulder: draw a gun', 'X: take something out of your bag · Y: this tablet', 'Left trigger: run (in a car: nitro)'],
  ['Driving', 'Grab the steering wheel (or the bars) with a grip and turn it.', 'Left stick: gas and brake · left grip off the wheel: horn', 'Trains: grab the master lever, or use the big action button.', 'Getting out: the right grip, or the action button.'],
  ['Fighting', 'Fists: punch for real; the faster the harder.', 'Both fists up in front of your face: you block.', 'Knife: slash with a fast swing.', 'Jet pack: hold A for thrust.'],
  ['Other headsets', 'Vive wands: touch the left pad to walk; press it in the middle: tablet.', 'Right pad: press the edges to turn, the top to jump, the bottom to reload.', 'No A / B / X / Y? Right stick click jumps, left stick click', '(standing still) opens this tablet. Everything else is here.'],
];
const HELP_HANDS = [
  ['Hands', 'Left pinch + move the hand: walk (lift it: jump)', 'Right finger gun: draw · right pinch: fire', 'Right fist: fists up · punch for real, faster = harder', 'Left palm to your face: this tablet · poke with your right index', 'Left thumb along your index: snap turn (to the tip: right)'],
  ['Driving', 'Make fists on the steering wheel or the bars and turn them.', 'Push the wheel away from you: gas. Pull it back: brake.', 'The big yellow button: get out (point + pinch, or poke it).'],
  ['Things', 'BAG tab: take a drink, smoke or snack into your left hand,', 'then bring it to your mouth.', 'Elevators: poke the glowing call button by the door.'],
];

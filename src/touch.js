// Mobile / touch controls. Owned by: main. Renders a CoD-Mobile-style overlay and drives ctx.input (axis, look, buttons).
// Left half: floating virtual stick (auto-sprint when pushed to the rim). Right half: drag to look, quick tap (no drag) toggles ADS; button cluster for fire/ADS/jump/crouch/reload/swap/grenade.
// Weapon buttons hide while the weapon is stowed (elevator / craft / driving a car without a pistol); JUMP becomes the
// handbrake + a HORN button appears while actually driving a car, and SWAP/CROUCH hide while riding any vehicle (car or bike).
const CSS = `
#touch{position:fixed;inset:0;z-index:30;pointer-events:none;-webkit-user-select:none;user-select:none;touch-action:none;font-family:"Barlow Condensed","Arial Narrow",system-ui,sans-serif}
#touch.on{pointer-events:auto}
#touch.hidden{display:none}
#touch .zone{position:absolute;top:0;bottom:0;width:50%}
#touch .zone.l{left:0}#touch .zone.r{right:0}
#touch .stick{position:absolute;width:132px;height:132px;margin:-66px 0 0 -66px;border-radius:50%;border:2px solid rgba(255,255,255,.28);background:rgba(0,0,0,.18);display:none}
#touch .stick i{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 2px 12px rgba(0,0,0,.5)}
#touch .btn{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1.5px solid rgba(255,255,255,.35);background:rgba(10,14,20,.45);color:#e8ecf1;font-weight:600;letter-spacing:.08em;font-size:13px;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);transition:transform .08s,background .08s}
#touch .btn.down{background:rgba(233,162,59,.55);border-color:#e9a23b;transform:scale(.94)}
#touch .btn.tog.on{background:rgba(233,162,59,.35);border-color:#e9a23b}
#touch .fire{right:calc(env(safe-area-inset-right,0px) + 28px);bottom:calc(env(safe-area-inset-bottom,0px) + 92px);width:104px;height:104px;font-size:15px;border-width:2px;background:rgba(160,40,30,.42);border-color:rgba(255,120,100,.6)}
#touch .fire.down{background:rgba(220,70,50,.7)}
#touch .ads{right:calc(env(safe-area-inset-right,0px) + 150px);bottom:calc(env(safe-area-inset-bottom,0px) + 70px);width:68px;height:68px}
#touch .jump{right:calc(env(safe-area-inset-right,0px) + 30px);bottom:calc(env(safe-area-inset-bottom,0px) + 214px);width:64px;height:64px}
#touch .crouch{right:calc(env(safe-area-inset-right,0px) + 150px);bottom:calc(env(safe-area-inset-bottom,0px) + 156px);width:60px;height:60px}
#touch .reload{right:calc(env(safe-area-inset-right,0px) + 236px);bottom:calc(env(safe-area-inset-bottom,0px) + 28px);width:56px;height:56px;font-size:12px}
#touch .swap{right:calc(env(safe-area-inset-right,0px) + 112px);bottom:calc(env(safe-area-inset-bottom,0px) + 14px);width:52px;height:52px;font-size:11px}
#touch.melee .ads,#touch.melee .reload,#touch.melee .zoom,#touch.melee .nade,#touch.melee .fireL,#touch.portrait .fireL,#touch.nozoom .zoom{display:none}   /* only what you can use: a knife needs SLASH, not aim / reload / zoom / nade */
#touch .zoom{right:calc(env(safe-area-inset-right,0px) + 236px);bottom:calc(env(safe-area-inset-bottom,0px) + 164px);width:54px;height:54px;font-size:11px}
#touch .nade{right:calc(env(safe-area-inset-right,0px) + 236px);bottom:calc(env(safe-area-inset-bottom,0px) + 100px);width:54px;height:54px;font-size:11px}
#touch .pause{right:calc(env(safe-area-inset-right,0px) + 16px);top:calc(env(safe-area-inset-top,0px) + 10px);width:44px;height:30px;border-radius:6px;font-size:12px}
#touch .act{left:calc(env(safe-area-inset-left,0px) + 120px);bottom:calc(env(safe-area-inset-bottom,0px) + 230px);min-width:96px;height:44px;padding:0 14px;border-radius:22px;font-size:13px;background:rgba(233,162,59,.35);border-color:#e9a23b;display:none}
#touch .act.show{display:flex}
#touch .win{left:calc(env(safe-area-inset-left,0px) + 136px);bottom:calc(env(safe-area-inset-bottom,0px) + 290px);width:56px;height:56px;font-size:11px;display:none}
#touch .win.show{display:flex}
/* stowed (elevator / craft / driving a car without a pistol): the weapon buttons do nothing, so they're gone, not just dim -
   that frees the slot a HORN button reuses while actually driving a car (jump stays, repurposed as the handbrake below) */
#touch.stow .fire,#touch.stow .fireL,#touch.stow .ads,#touch.stow .reload,#touch.stow .nade,#touch.stow .zoom{display:none}
#touch.stow:not(.car) .jump{display:none}
/* riding any vehicle (car or bike): swapping guns / crouching are no-ops and only crowd the ENTER-EXIT / CAM pills (vehicles.js) */
#touch.driving .swap,#touch.driving .crouch{display:none}
#touch .fireL{font-size:11px;left:calc(env(safe-area-inset-left,0px) + 80px);bottom:calc(env(safe-area-inset-bottom,0px) + 90px);width:70px;height:70px;background:rgba(160,40,30,.3);border-color:rgba(255,120,100,.45)}
/* the nade slot: hidden alongside it while stowed, so a HORN button (driving a car) can borrow the spot without a new clash */
#touch .horn{display:none;right:calc(env(safe-area-inset-right,0px) + 236px);bottom:calc(env(safe-area-inset-bottom,0px) + 100px);width:54px;height:54px;font-size:11px}
#touch.car .horn{display:flex}
#touch.car .nade{display:none}
#touch .jump.handbrake{font-size:10px}
/* landscape (short viewport): the minimap (top-left) reaches further down than the ACT pill's usual top-left slot allows for */
@media (orientation:landscape){#touch .act{left:calc(env(safe-area-inset-left,0px) + 150px)}}
`;

let S = null;

export async function init(ctx) {
  if (!ctx.isTouch) return { active: false };
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'touch'; root.className = 'hidden';
  root.innerHTML = `
    <div class="zone l"></div><div class="zone r"></div>
    <div class="stick"><i></i></div>
    <div class="btn pause">II</div>
    <div class="btn fire">FIRE</div><div class="btn fireL">FIRE</div>
    <div class="btn ads tog">ADS</div>
    <div class="btn jump">JUMP</div>
    <div class="btn crouch tog">CROUCH</div>
    <div class="btn reload">RELOAD</div>
    <div class="btn swap">SWAP</div>
    <div class="btn nade">NADE</div>
    <div class="btn zoom">ZOOM</div>
    <div class="btn act">TAKE</div>
    <div class="btn win">WIN</div>
    <div class="btn horn">HORN</div>`;
  document.body.appendChild(root);
  const q = (c) => root.querySelector(c);
  const input = ctx.input; const T = input.touch;
  S = { root, stick: q('.stick'), knob: q('.stick i'), stickId: null, stickOrigin: { x: 0, y: 0 }, looks: new Map(), R: 56, lookSens: 2.2, };

  const setAxis = (dx, dy) => { const m = Math.hypot(dx, dy); const k = m > S.R ? S.R / m : 1; const x = dx * k / S.R, y = dy * k / S.R; T.axis.x = x; T.axis.y = y; T.sprint = Math.hypot(x, y) > 0.92 && y < -0.5; S.knob.style.transform = `translate(${x * S.R}px,${y * S.R}px)`; };
  const clearStick = () => { S.stickId = null; T.axis.x = T.axis.y = 0; T.sprint = false; S.stick.style.display = 'none'; S.knob.style.transform = ''; };

  // ---- left zone: floating stick
  const zl = q('.zone.l');
  zl.addEventListener('touchstart', (e) => { e.preventDefault(); if (S.stickId !== null) return; const t = e.changedTouches[0]; S.stickId = t.identifier; S.stickOrigin = { x: t.clientX, y: t.clientY }; S.stick.style.display = 'block'; S.stick.style.left = t.clientX + 'px'; S.stick.style.top = t.clientY + 'px'; setAxis(0, 0); }, { passive: false });
  const onMove = (e) => { e.preventDefault(); for (const t of e.changedTouches) { if (t.identifier === S.stickId) setAxis(t.clientX - S.stickOrigin.x, t.clientY - S.stickOrigin.y); else if (S.looks.has(t.identifier)) { const l = S.looks.get(t.identifier); input.mouse.dx += (t.clientX - l.x) * S.lookSens; input.mouse.dy += (t.clientY - l.y) * S.lookSens; l.x = t.clientX; l.y = t.clientY; } } };
  const onEnd = (e) => { for (const t of e.changedTouches) { if (t.identifier === S.stickId) clearStick(); const l = S.looks.get(t.identifier);
    // tap-to-aim: a quick tap on the look zone (no drag) toggles ADS, same as the ADS button
    if (l && l.zone && e.type === 'touchend' && performance.now() - l.t0 < 220 && Math.hypot(t.clientX - l.x0, t.clientY - l.y0) < 12 && !S.stowed) setAds(!T.ads);
    S.looks.delete(t.identifier); } };
  // ---- right zone + buttons: look-drag (a finger that starts on a button can also drag to look)
  const startLook = (e, zone = false) => { const now = performance.now(); for (const t of e.changedTouches) S.looks.set(t.identifier, { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, t0: now, zone }); };
  q('.zone.r').addEventListener('touchstart', (e) => { e.preventDefault(); startLook(e, true); }, { passive: false });
  root.addEventListener('touchmove', onMove, { passive: false });
  root.addEventListener('touchend', onEnd); root.addEventListener('touchcancel', onEnd);

  // ---- buttons
  const hold = (el, on, off) => {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); on(); }, { passive: false });
    const end = (e) => { el.classList.remove('down'); off(); };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  };
  const tap = (el, fn) => el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); setTimeout(() => el.classList.remove('down'), 120); fn(); }, { passive: false });
  const press = (code) => { input.keys.add(code); input.pressed.add(code); setTimeout(() => input.keys.delete(code), 120); };
  const fireTouches = new Set();
  S.clearFire = () => { fireTouches.clear(); T.fire = false; for (const sel of ['.fire', '.fireL']) q(sel).classList.remove('down'); };
  for (const sel of ['.fire', '.fireL']) {
    const el = q(sel);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); for (const t of e.changedTouches) fireTouches.add(t.identifier); el.classList.add('down'); T.fire = true; input.pressed.add('Mouse0'); if (sel === '.fire') startLook(e); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) fireTouches.delete(t.identifier); el.classList.toggle('down', Array.from(e.targetTouches).some(t => fireTouches.has(t.identifier))); T.fire = fireTouches.size > 0; };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  const adsEl = q('.ads'); const setAds = (v) => { T.ads = !!v; adsEl.classList.toggle('on', T.ads); }; S.setAds = setAds;
  tap(adsEl, () => setAds(!T.ads));
  const crEl = q('.crouch'); tap(crEl, () => { const on = !input.keys.has('KeyC'); if (on) input.keys.add('KeyC'); else input.keys.delete('KeyC'); crEl.classList.toggle('on', on); });
  hold(q('.jump'), () => { input.keys.add('Space'); input.pressed.add('Space'); }, () => input.keys.delete('Space'));
  tap(q('.reload'), () => press('KeyR'));
  tap(q('.swap'), () => { const slot = ctx.weapons?.current?.slot ?? 0; press(slot === 0 ? 'Digit2' : 'Digit1'); });
  tap(q('.nade'), () => press('KeyG'));
  hold(q('.zoom'), () => { T.zoom = true; }, () => { T.zoom = false; });   // weapons.js: hold to zoom (rooftops)
  S.act = q('.act'); tap(S.act, () => { input.pressed.add('KeyF'); }); // contextual: pick up weapon / mount / dismount (same F both systems read)
  S.win = q('.win'); tap(S.win, () => press('KeyO'));   // roll a car's window up / down (driving, or any passenger seat)
  // horn: hangkit.js only listens for a real keydown (friends hear it over net.js), not the polled input.keys touch buttons use elsewhere
  tap(q('.horn'), () => { try { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true })); } catch {} });
  tap(q('.pause'), () => ctx.setState('paused'));

  const show = (v) => { root.classList.toggle('hidden', !v); root.classList.toggle('on', v); if (!v) { clearStick(); S.looks.clear(); S.clearFire(); setAds(false); } };
  ctx.bus.on('playerDied', () => { S.clearFire(); setAds(false); });
  ctx.bus.on('state', ({ state }) => show(state === 'playing'));
  show(ctx.state === 'playing');
  // QA hooks
  return {
    active: true,
    qaStick: (x, y) => { T.axis.x = x; T.axis.y = y; T.sprint = Math.hypot(x, y) > 0.92 && y < -0.5; },
    qaLook: (dx, dy) => { input.mouse.dx += dx; input.mouse.dy += dy; },
    qaFire: (on) => { T.fire = on; if (on) input.pressed.add('Mouse0'); },
    qaAds: (on) => setAds(on),
  };
}

export function update(dt, ctx) {
  if (!S || !S.act) return;
  const m = ctx.player?.mounted, stowed = !!(m && (m.elevator || m.craft || (m.spec?.car && (ctx.weapons?.current?.spec?.slot ?? 0) !== 1)));   // passengers + pistol drivers shoot
  S.win.classList.toggle('show', ctx.state === 'playing' && !!(m?.spec?.car || m?.passenger));   // a window to roll: driving, or any passenger seat (friend's car, a stolen car, the Uber)
  if (stowed !== S.stowed) { S.stowed = stowed; S.root.classList.toggle('stow', stowed); if (stowed) { S.clearFire(); S.setAds?.(false); } }
  // driving a car: JUMP (Space) is the handbrake instead (vehicles.js reads it the same way), and a HORN button appears (hangkit.js, Q)
  const carDrive = !!m?.spec?.car; if (carDrive !== S.carDrive) { S.carDrive = carDrive; S.root.classList.toggle('car', carDrive); const j = S.root.querySelector('.jump'); j.textContent = carDrive ? 'E-BRAKE' : 'JUMP'; j.classList.toggle('handbrake', carDrive); }
  S.root.classList.toggle('driving', !!ctx.vehicles?.mounted);   // riding any vehicle (car or bike): SWAP / CROUCH are no-ops, hidden so they don't crowd vehicles.js's own ENTER-EXIT / CAM pills
  // fire buttons say what they do (the left one is a second trigger for the left thumb)
  const melee = ctx.weapons?.current?.mode === 'MELEE', ft = melee ? (ctx.weapons?.current?.id === 'fists' ? 'PUNCH' : 'SLASH') : 'FIRE';
  { const pistol = (ctx.weapons?.current?.spec?.slot ?? 0) === 1 || /m9|deagle|makarov|glock/i.test(ctx.weapons?.currentId || ''), portrait = innerHeight > innerWidth;   // declutter: ZOOM only with a long gun, one trigger in portrait
    S.root.classList.toggle('melee', melee); S.root.classList.toggle('portrait', portrait); S.root.classList.toggle('nozoom', melee || pistol); }
  if (ft !== S.fireTxt) { S.fireTxt = ft; S.root.querySelector('.fire').textContent = ft; S.root.querySelector('.fireL').textContent = ft; }
  // contextual action button: weapon pickup or motorcycle mount/dismount; a map may name its own F action (ctx.actionLabel: BOARD F / GET OFF)
  const pk = ctx.ai?.nearPickup, bike = ctx.vehicles?.nearBike, mounted = ctx.vehicles?.mounted || ctx.player?.mounted;
  const label = ctx.actionLabel ? ctx.actionLabel : mounted?.train ? null : mounted ? 'GET OFF' : pk ? `TAKE ${(pk.id || 'GUN').toUpperCase().replace('AK74', 'AK')}` : bike ? 'RIDE' : null;
  if (label !== S.actLabel) { S.actLabel = label; { const hp = document.querySelector('#hud .prompt'); if (hp) hp.style.visibility = label ? 'hidden' : ''; }   // the big button says it: no duplicate prompt
    S.act.textContent = label || ''; S.act.classList.toggle('show', !!label && ctx.state === 'playing'); }
}
export function reset(ctx) { if (S) { S.clearFire(); if (S.setAds) S.setAds(false); else ctx.input.touch.ads = false; } }

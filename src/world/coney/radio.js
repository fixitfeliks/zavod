// CONEY — Luna Park Radio. One station, a shuffled rotation of the crew's tracks, on the wall clock: everyone in the room
// hears the same song at the same second (position = Date.now() mod the rotation). Settings → Audio → Luna Park Radio:
// Off / In cars (default: the car radio, louder) / Always (quieter on foot); Radio volume. Keys: L on/off, . next track
// (skips the station for you only). Plain <audio> elements (streamed, nothing decoded up front). CONEY agent.
//
// Media Session (iOS/Android lock screen + Control Center, feature-detected): while a track plays we publish
// title/artist/album/artwork and play/pause/next/previous/stop handlers. An OS pause (or an interruption like a phone
// call or another app taking audio focus) sets `osPaused` — the frame updater below then skips its own play() calls
// until the player resumes from the OS controls or presses L again, so the OS pause actually sticks.
import { saveAudio } from '../../ctx.js';

const TRACKS = [
  { src: './assets/audio/radio/adidas-from-donbass.mp3', title: 'Adidas from Donbass' },
  { src: './assets/audio/radio/gopnik-disneyland.mp3', title: 'Гопник-Диснейленд' },
  { src: './assets/audio/radio/burbon-bratva-gudzon.mp3', title: 'Бурбон, братва, Гудзон' },
  { src: './assets/audio/radio/olya-angliyskaya.mp3', title: 'Оля английская' },
  { src: './assets/audio/radio/burbon-bratva-gudzon-2.mp3', title: 'Бурбон, братва, Гудзон (версия 2)' },
  { src: './assets/audio/radio/trinidad-daddy-remastered.mp3', title: 'Trinidad Daddy (Remastered)' },
  { src: './assets/audio/radio/nutcracker-sandman-remastered.mp3', title: 'Nutcracker Sandman (Remastered)' },
  { src: './assets/audio/radio/luna-park-kruzhis.mp3', title: 'Луна-парк, кружись' },
  { src: './assets/audio/radio/olya-angliyskaya-ruki-verh.mp3', title: 'Оля Английская (Ruki Verh)' },
  { src: './assets/audio/radio/soccer-tavern.mp3', title: 'Soccer Tavern' },
];
const MS_ARTIST = 'ZAVOD', MS_ALBUM = 'Luna Park Radio';   // no per-track artist metadata exists (no ID3 tags, no credits) — station/source identify the track instead

export function buildRadio(world) {
  const { ctx, W } = world; const S = ctx.settings;
  const hasMS = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
  const R = { els: TRACKS.map((t) => { const a = new Audio(); a.preload = 'metadata'; a.src = t.src; a.crossOrigin = 'anonymous'; return a; }), dur: TRACKS.map(() => 0), cur: -1, skip: 0, on: false, osPaused: false, lastTitle: '', juke: null };
  R.els.forEach((a, i) => {
    a.addEventListener('loadedmetadata', () => { R.dur[i] = a.duration || 0; });
    // a pause we didn't ask for on the track that's supposed to be playing — an OS interruption (call, Siri, another
    // app's audio) or a lock-screen pause outside our own action handler. `a.ended` excludes the ordinary end-of-track
    // pause that fires right before the wall clock hands off to the next track.
    a.addEventListener('pause', () => { if (a.ended || i !== R.cur || !R.on || R.osPaused) return; R.osPaused = true; setPlaybackState('paused'); });
  });
  // 96/512 PNG artwork for the lock screen, drawn once on a canvas (no new asset files, no build step).
  let artwork = null;
  const buildArt = (size) => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    g.fillStyle = '#1a1512'; g.fillRect(0, 0, size, size);
    g.strokeStyle = '#e8c468'; g.lineWidth = Math.max(1, size * 0.04); g.strokeRect(size * 0.08, size * 0.08, size * 0.84, size * 0.84);
    g.fillStyle = '#e8c468'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${size * 0.18}px sans-serif`; g.fillText('📻', size / 2, size * 0.42);
    g.font = `bold ${size * 0.085}px sans-serif`; g.fillText('LUNA PARK', size / 2, size * 0.72);
    g.fillText('RADIO', size / 2, size * 0.87);
    return c.toDataURL('image/png'); };
  const getArtwork = () => { if (artwork) return artwork; try { artwork = [96, 512].map((size) => ({ src: buildArt(size), sizes: `${size}x${size}`, type: 'image/png' })); } catch { artwork = []; } return artwork; };
  const setMeta = (i) => { if (!hasMS) return; try { navigator.mediaSession.metadata = new MediaMetadata({ title: TRACKS[i].title, artist: MS_ARTIST, album: MS_ALBUM, artwork: getArtwork() }); } catch {} };
  const setPlaybackState = (state) => { if (!hasMS) return; try { navigator.mediaSession.playbackState = state; } catch {} };
  const clearMeta = () => { if (!hasMS) return; try { navigator.mediaSession.metadata = null; } catch {} setPlaybackState('none'); };

  W.radio = { cue: (title) => { const i = TRACKS.findIndex((t) => t.title === title); const total = R.dur.reduce((a, b) => a + b, 0); if (i < 0 || !(total > 0)) return false; const now = Date.now() / 1000 + R.skip, pass = Math.floor(now / total); let start = 0; for (const k of order(pass)) { if (k === i) break; start += R.dur[k]; } R.skip += pass * total + start - now + 0.05; R.cur = -1; return true; },   // durak mode: jump (just for you) to the start of a track
    // Soc Tav jukebox: your pick, then the book in order (no shuffle) from a shared start time; juke(null) goes back to the station
    juke: (title, t0 = Date.now() / 1000) => { const i = title == null ? -1 : TRACKS.findIndex((t) => t.title === title); R.juke = i < 0 ? null : { i, t0 }; R.cur = -1; return R.juke ? t0 : null; },
    tracks: TRACKS.map((t) => t.title), get now() { return R.cur >= 0 ? TRACKS[R.cur].title : null; }, get osPaused() { return R.osPaused; }, qa: () => R.els.map((a) => ({ playing: !a.paused, t: +a.currentTime.toFixed(1), vol: +a.volume.toFixed(2) })) };
  // where the station is right now: [track, offset]
  // shuffled: every pass through the playlist plays in a new random order, seeded by which pass it is on the wall clock —
  // so it's random, but friends still hear the same song at the same moment (no back-to-back repeats across passes)
  const shuffle = (pass) => { const idx = TRACKS.map((_, k) => k); let a = (pass * 2654435761) >>> 0 || 1; const rnd = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
    for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [idx[k], idx[j]] = [idx[j], idx[k]]; } return idx; };
  const order = (pass) => { const idx = shuffle(pass); if (idx.length > 1 && idx[0] === shuffle(pass - 1).at(-1)) [idx[0], idx[1]] = [idx[1], idx[0]]; return idx; };   // no song twice in a row across passes
  const at = () => {
    const total = R.dur.reduce((a, b) => a + b, 0); if (!(total > 0)) return [0, 0];
    if (R.juke) { let t = (Date.now() / 1000 - R.juke.t0) % total; for (let k = 0; k < TRACKS.length; k++) { const i = (R.juke.i + k) % TRACKS.length; if (t < R.dur[i]) return [i, t]; t -= R.dur[i]; } return [R.juke.i, 0]; }
    const T = Date.now() / 1000 + R.skip, pass = Math.floor(T / total); let t = T - pass * total;
    for (const i of order(pass)) { if (t < R.dur[i]) return [i, t]; t -= R.dur[i]; }
    return [0, 0];
  };
  const stop = () => { for (const a of R.els) if (!a.paused) a.pause(); R.on = false; R.cur = -1; R.osPaused = false; clearMeta(); };
  const stepNext = () => { if (!R.on || R.juke) return; const [, off] = at(); R.skip += (R.dur[R.cur] || 0) - off + 0.05; R.cur = -1; };   // next track (just for you)
  const stepPrev = () => { if (!R.on || R.juke) return; const [, off] = at(); R.skip -= (off - 0.05); R.cur = -1; };   // previous: restart the current track (rotation is shuffled per-client, there's no real "back")
  if (hasMS) {
    const safe = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };   // unsupported actions throw on some browsers
    safe('play', () => { R.osPaused = false; setPlaybackState('playing'); });
    safe('pause', () => { R.osPaused = true; if (R.cur >= 0) R.els[R.cur].pause(); setPlaybackState('paused'); });
    safe('stop', () => { R.osPaused = true; if (R.cur >= 0) R.els[R.cur].pause(); setPlaybackState('paused'); });
    safe('nexttrack', stepNext);
    safe('previoustrack', stepPrev);
  }
  addEventListener('keydown', (e) => {
    if (e.repeat || ctx.state !== 'playing' || world.W !== ctx.world) return;
    // L: on if you can't hear it, off if you can (M is the map); if the OS paused it, L resumes rather than toggling off
    if (e.code === 'KeyL') {
      if (R.osPaused) { R.osPaused = false; setPlaybackState('playing'); ctx.hud?.toast?.('📻 LUNA PARK RADIO — ON', 1400); }
      else { S.radio = R.on ? 'off' : 'always'; saveAudio(S); ctx.hud?.toast?.(S.radio === 'off' ? 'RADIO OFF' : '📻 LUNA PARK RADIO — ON', 1400); }
    }
    if (e.code === 'Period') stepNext();
  });
  world.updaters.push(() => {
    if (ctx.world !== W) return;
    const pm = ctx.player?.mounted, car = !!(ctx.vehicles?.mounted || pm?.passenger || pm?.car || pm?.seat), mode = S.radio || 'car';   // driving, or riding along in a friend's car
    const want = (ctx.state === 'playing' || ctx.state === 'paused') && (mode === 'always' || (mode === 'car' && (car || ctx.durakOpen)));   // plays at Arkasha's card table too
    if (!want) { if (R.on) stop(); return; }
    if (R.osPaused) { R.on = true; return; }   // OS/interruption paused it — don't fight that; wait for the OS or L to resume
    if (!(R.dur.every((d) => d > 0))) { for (const a of R.els) if (a.preload !== 'auto') { a.preload = 'auto'; a.load(); } return; }   // wait for durations
    const [i, off] = at();
    const vol = Math.max(0, Math.min(1, (S.radioVolume ?? 0.7) * (S.masterVolume ?? 1) * (car ? 1 : 0.55) * (ctx.state === 'paused' ? 0.4 : 1)));
    if (i !== R.cur) {
      for (const a of R.els) if (!a.paused) a.pause();
      const a = R.els[i]; R.cur = i; try { a.currentTime = off; } catch {} a.volume = vol; a.play().catch(() => { R.cur = -1; });   // blocked until the first click: retry next frame
      if (TRACKS[i].title !== R.lastTitle) { R.lastTitle = TRACKS[i].title; ctx.hud?.toast?.(`📻 LUNA PARK RADIO · ${TRACKS[i].title}`, 2600); }
      setMeta(i); setPlaybackState('playing');
    } else {
      const a = R.els[i]; a.volume = vol;
      if (Math.abs(a.currentTime - off) > 2.5) try { a.currentTime = off; } catch {}   // stay on the station clock
      if (a.paused) a.play().catch(() => {});
    }
    R.on = true;
  });
  ctx.bus.on('state', ({ state }) => { if (state === 'menu' || state === 'dead') stop(); });
}

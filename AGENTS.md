# Working on ZAVOD

ZAVOD is a browser FPS in plain Three.js r186. Three.js is vendored in `vendor/`; ES modules and an importmap run directly in the browser. There is no build step. See `CONTRACT.md` for module and event contracts.

`main` auto-deploys to https://zavod-chi.vercel.app. Work on a branch and open a PR for its Vercel preview. Do not push directly to `main`.

## Run and test

```sh
npm install
./qa/serve.sh                 # http://localhost:8790
```

Useful query parameters: `?map=coney`, `?mode=chill`, `?qa=1` (exposes `window.__game`), `?ai=0`, `?time=day|dusk|night`, `?touch=1`, and `?mp=1&room=NAME&name=YOU`.

Run the QA scripts near the change before committing, for example `node qa/chill-test.mjs` or `node qa/fight-test.mjs`; `npm test` runs the main set. Run browser tests one at a time because parallel Chrome instances time out. For graphics and Map Lab tests, use headed Chrome under Xvfb with `QA_HEADED=1 QA_VIRTUAL_DISPLAY=1`; launchers should use `qa/browser-launch.mjs`. Do not open visible desktop Chrome or install system packages without authorization. See `qa/map-lab/docs/MAP-PROFILING.md` for GPU and benchmark rules.

## Code layout and conventions

- `src/main.js` boots the game; modules export `init(ctx)`, `update(dt, ctx)`, and `reset(ctx)` and communicate through `ctx.bus`. Update errors may appear only every 300 frames in the console.
- `src/world/maps/` defines maps. Coney's authored features are in `src/world/coney/`; shared interactions are in `src/world/hangkit.js`.
- `src/player.js`, `src/vehicles.js`, and `src/net.js` own movement, driving, and multiplayer. `src/hud.js` and `src/touch.js` own their controls.
- Match surrounding code style. Add no dependencies or build tools. Authored colliders are axis-aligned boxes; rotated solids use small AABB cells.
- Sync anything friends must see with `ctx.net.send(type, payload)` and the corresponding `net:<type>` bus event. Use `Date.now()` for shared clock-synced world events.

## Commits and review

**Never commit unless the user explicitly instructs you to.** Before an authorized commit, run the relevant QA. Keep the subject under 72 characters, capitalize it, use `-` for body list items, avoid em dashes, and explain what changed and why.

Review all findings, including minor ones, as short issue labels with one-line descriptions; do not list checks that passed. Check for security and data exposure, races, broken error handling, stale comments, dead or duplicated code, unused imports, inconsistent data, unexpected staged files, unexplained defaults, and magic numbers. Fix root causes rather than hiding failures with retries or fallbacks. If a cause is uncertain, run an experiment before proposing a fix. Keep derived numbers beside their source values. Put Python code in `.py` files instead of inline shell commands.

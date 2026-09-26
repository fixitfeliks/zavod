# AGENTS.md — working on ZAVOD (for Codex / Claude / any coding agent)

Browser FPS in plain Three.js r186 (vendored in `vendor/`, ES modules + importmap, **no build step**).
`main` auto-deploys to https://zavod-chi.vercel.app — **work on a branch and open a PR** (Vercel posts a preview URL on
every PR); don't push straight to `main` while people are playing.

## Run
```
npm install            # install declared dependencies; browser QA needs Google Chrome installed
./qa/serve.sh          # no-cache static server → http://localhost:8790
```
Useful URLs: `?map=coney` · `?map=coney&mode=chill` · `?qa=1` (exposes `window.__game` hooks) · `?ai=0` (no mercs) ·
`?time=day|dusk|night` · `?touch=1` (phone UI) · `?mp=1&room=NAME&name=YOU` (online).

## Layout
- `src/main.js` — boot, module list (`MODULES` / `UPDATE_ORDER`), `window.__game` QA hooks.
- Modules export `init(ctx)`, `update(dt, ctx)`, `reset(ctx)`; they talk through `ctx.bus` events. See `CONTRACT.md`.
  An exception thrown in `update` is swallowed and logged only every 300 frames — if something "just stops animating",
  look for `[update:<name>]` errors in the console.
- `src/weapons.js` + `src/weapons/*` (viewmodels, `knife.js`), `src/ai.js` (mercs, blood, gun drops), `src/player.js`,
  `src/vehicles.js` (bikes/cars), `src/net.js` (MQTT multiplayer), `src/netwaves.js` (online waves), `src/hud.js`,
  `src/touch.js` (mobile controls), `src/minimap.js` (minimap + full map on M), `src/audio.js`.
- Maps: `src/world/maps/*.js`. Coney Island lives in `src/world/coney/`:
  - `hangout.js` — the friends' hangout (Igor, towers/elevators, Sammy's deli, Wonder Wheel ride)
  - `chill.js` — crews/robbers, passers-by you can rob, street fights, chill mode (knife, Vitek's Makarov)
  - `locals.js` — POPS cart ally, SHADES, NET GOST market, the mangal · `jobs.js` — Igor's side jobs
  - `chase.js` — wanted level / cops · `stillwell.js`, `w8th.js` — subway stations · `housing.js` — Luna Park towers
  - `belt.js` — elevated Belt Pkwy loop over Brighton / Sheepshead Bay · `radio.js` — Luna Park Radio
- `src/world/hangkit.js` — shared hangout kit for every map: cash, inventory, vendors + dialog, spots (F), elevators,
  stealing cars, sharing booze/smoke. `src/world/deli.js` — figures (`buildFigure`, with fight/hands-up anims), delis.

## Conventions
- Match the surrounding style: dense one-line helpers, short `// why` comments, no new dependencies, no build tools.
- Colliders are axis-aligned boxes (`world.box`); rotated things are built from small AABB cells.
- Anything visible to friends online must go through `ctx.net.send(type, payload)` → `net:<type>` on the bus.
- Clock-synced world things (trains, radio, visitors) use `Date.now()` so every client agrees.

## Test before you push
Each feature has a headless Playwright script in `qa/` (real GPU via Chrome). Run the ones near your change, e.g.
`node qa/chill-test.mjs`, `node qa/fight-test.mjs`, `node qa/jobs-test.mjs`; `npm test` runs the main set.
Screenshots: `node qa/shot.mjs "http://localhost:8790/?qa=1&map=coney" out.png --eval "<js>" --console`.
Run tests one at a time (parallel headless Chrome instances time out).

## Commit Message Guidelines

Adapted from the `Commit Message Guidelines` section of `../onlytests/CLAUDE.md`, with attribution restrictions omitted.

**NEVER commit changes unless explicitly instructed by the user.** Always wait for explicit user permission before creating commits.

### Commit Format Standards

When creating commits, follow these formatting rules:
- Use dashes (-) for list items in commit message body
- Never use em dashes (—) anywhere in commit messages — neither subject nor body. Use a regular hyphen (-), a comma, a colon, or split into two sentences instead.
- Keep subject line under 72 characters
- Capitalize the first word of the subject and body lines, and use proper
  case throughout (product names, acronyms, etc.). No all-lowercase messages.
- Focus on concise, descriptive commit messages that explain the "what" and "why"

## Code reviews
Copied from the `Code Reviews` section of `../onlytests/CLAUDE.md`, with the test gate adapted for this no-build repo.

Do comprehensive code reviews. This checklist is a **minimum, not exhaustive** — always apply your own general engineering review on top of these points (security, error handling, naming, edge cases, performance, etc). **Report ALL issues found — blocking AND non-blocking (naming, style, minor improvements, small DRY opportunities). Don't dismiss small issues or say "no blocking issues" — list everything so we can decide what to fix. Don't list items that passed.**

**Review format: issues, not solutions.** Each finding is a short issue label (1–3 words) and a one-line description; resolution is optional and one short line. The final summary MUST include every issue, including minor/non-blocking ones — never omit a finding because it seems trivial. Don't expand into how-to-fix paragraphs unless asked.
- Any repeat code, anything that can be DRYed out? SOLID principles?
- Any dead code?
- Any potential race conditions?
- Any other issues?
- Has anything been staged that is not part of our current changes?
- Are there any places where we are providing default values or guessing instead of erroring?
- Are there unused imports, schemas, or interfaces after refactoring?
- For CRUD changes: does the data stay consistent? (re-indexing, orphaned references, slot gaps)
- Are env vars / secrets properly gated? (allowlists, non-secret types, what gets exposed)
- Any magic numbers? Use named constants/static variables instead
- No band-aids: don't mask symptoms (filtering nulls, swallowing errors, adding defaults to work around broken data). Fix the root cause.
- Recovery logic is NEVER a fix for an unexplained failure. Retries, restarts,
  fallbacks, and longer timeouts may only be added AFTER the root cause is
  proven, and then as a separate decision about resilience — never as the
  response to "this fails sometimes". Test: would this still be needed once the
  root cause is fixed? If no, it is a mask.
- When a diagnosis is graded inferred, likely, or unproven, the only valid next
  step is the experiment that settles it — not a change that makes the symptom
  survivable. A proposed fix that "also serves as a test of the root cause" is
  an admission the cause is not known yet; run the test instead.
- A constraint on a fix (budget, timing, blast radius) is a FILTER on acceptable
  options, never the criterion for choosing one. Ranking candidates by "which is
  cheapest to satisfy the constraint" is how a band-aid wins a comparison it
  should not have been in.
- Name variables for what they represent, not how they were derived
- No inline Python in shell scripts (`python3 -c "..."`) — extract to a separate .py file
- Stale-comment sweep: does any comment or doc touched by (or adjacent to) this
  change assert a value or behavior the change makes false? Fix it in the same
  commit — and fix it by REPLACING the stale text, never by appending a
  correction below it. A derived number (sizes, tables, worked examples) may
  only live directly adjacent to its source values; anywhere else, write a
  pointer instead of a copy.
- Run the relevant QA scripts before committing; there is no build step.
- Security review
    - Any external attack surface or exploits
    - Any internal mismanagement or data leaking that can be exploited
    - Any other industry standard security checks

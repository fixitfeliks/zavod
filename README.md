# ZAVOD

A browser first-person shooter built in Three.js (r186, WebGL 2) — no engine, no build step. Single-player vs AI squads across the maps below.

**Play:** https://zavod-chi.vercel.app (desktop Chrome/Firefox/Safari; phones get touch controls and a lighter asset set — iOS 16.4+).

## Maps
| Map | Setting |
|---|---|
| Zavod | Rainy night container yard / shipyard (`?map=zavod`) |
| Railyard | Daytime multi-level freight yard: overpass, platform, office roof, wagon decks (`?map=railyard`) |
| Central Station | Beaux-Arts rail terminal: main concourse, balconies, waiting hall, dining concourse, subway (`?map=terminal`) |
| City Square | Downtown park + surrounding blocks: memorial arch, fountain plaza, row houses, village streets (`?map=wsp`) |
| University | State-university campus: library tower, academic mall, student center, arts plaza (`?map=sbu`) |
| Coney Island | Boardwalk, beach, rides and Luna Park towers (`?map=coney`; `&mode=chill` for hangout mode) |

## Controls
WASD move · Shift sprint · Space jump (3 quick jumps → super jump) · C/Ctrl crouch · LMB fire · RMB or E aim · R reload · G grenade · 1/2 weapons · walk into a ladder to climb · Esc pause · Tab scoreboard.
Loadout (AR / shotgun / sniper / SMG / AK · M9 / DE .50) and map are chosen in the main menu.

## Run locally
```
./qa/serve.sh          # http://localhost:8790  (no-cache static server)
```
**Map lab:** [Open locally](http://localhost:8790/qa/map-lab/index.html). Auto Coney or custom bounds → live OSM/NYC queries → filterable 2D → untextured 3D → walking and benchmarks. Help contains the pipeline, benchmark architecture and documentation hub. [Documentation and repository layout](./qa/map-lab/docs/README.md). The lab is enabled for Vercel previews and production; `.tmp/` snapshots and reports remain excluded. Generated maps remain separate from the authored game. The explicit npm release artifact excludes QA and benchmark charts; run `npm run test:benchmark-isolation` to verify. [WebGL research and release boundary](./qa/map-lab/docs/WEBGL-BENCHMARK-REVIEW.md).

Query params: `?map=`, `?primary=&secondary=`, `?quality=ultra|high|medium|low`, `?rain=1`, `?touch=1`.

## Development
- `CONTRACT.md` — module contract; each module (`src/world`, `player`, `weapons`, `ai`, `post`, `hud`, `audio`) has strict ownership so several agents can work in parallel.
- QA: `node qa/shot.mjs "http://localhost:8790/?qa=1&map=zavod&pose=hero" out.png` renders a deterministic frame headlessly on the real GPU; `window.__game` exposes hooks (`stats()`, `pose()`, `fire()`, `freezeAI()`, `killAll()`).
- Mobile assets: `qa/build-mobile-assets.sh` regenerates the 512 px mirror in `assets-m/`.

Assets: Poly Haven (CC0), three.js example soldier, Microsoft Rocketbox avatars + animations (MIT, converted to GLB), Barlow (OFL). Non-commercial tech demo.

## Credits
### 3D model credits
- Sedan: "A Red Mid-sized Four-door Sedan, 1990s To Early 2000s" by TopoSphere, generated with [Sloyd](https://www.sloyd.ai/free-3d-models/model/a-red-mid-sized-four-door-sedan-1990s-to-early-2000s-04dtwkw5), CC BY 4.0 (`assets/models/sloyd-sedan/`).
- BMW M4: "BMW M4" by [CuRvEmAsTeR](https://blendswap.com/profile/45652), Blend Swap blend #81957, CC BY 3.0 (`assets/models/bmw-m4/`). **Fan art, non-commercial only - must be removed if ZAVOD is ever monetised.**
- Nissan Skyline R34 GT-R: by [tikiteyboo](https://blendswap.com/profile/858613), Blend Swap blend #92438, CC BY 3.0 (`assets/models/skyline-r34/`).
- Ferrari 458 Italia model by [vicent091036](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), CC-BY 4.0, via the three.js examples (`assets/models/cars/ferrari.glb`).
- Map data (c) [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License (ODbL 1.0): the Coney Island streets, rails and buildings (`src/world/coney/osm.js`, `streetnames.js`) and the buildings round the Neptune Av station (`src/world/coney/osm-neptune.js`, made by `tools/import-osm-area.mjs`).

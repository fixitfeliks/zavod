# sloyd-sedan.glb, sloyd-sedan-lite.glb

- Source: "A Red Mid-sized Four-door Sedan, 1990s To Early 2000s"
  https://www.sloyd.ai/free-3d-models/model/a-red-mid-sized-four-door-sedan-1990s-to-early-2000s-04dtwkw5
- Author: TopoSphere, generated with the Sloyd generator.
- Licence: CC BY 4.0. See LICENSE.txt for the required attribution text.
- Downloaded: 2026-10-25 (assets/incoming/04dtwkw5.glb: 5.9 MB, one mesh "Sedan", one material, one 2048x2048 baked
  texture, about 39k triangles, trimesh).
- Used for: the `sedan` kind, src/world/carmodels.js (KIT.sedan). Replaces the earlier Innerscene taxi conversion (PR #200).

## What we changed (tools/prep-car-model.mjs, `sloyd` mode)
- Oriented to the game's car frame: the source is Y-up with the car's front along +Z and width along X (a 90 degree turn,
  not a mirror: kit (x, y, z) = (source z, source y, -source x), so no baked detail (badges, plate text) comes out reversed).
- Scaled to carSpec('sedan') (4.75 m long), centred on X/Z, grounded at Y 0.
- Wheels: found, but not cleanly separable, so they're left static, baked into the body mesh (tools/prep-car-model.mjs tried
  this automatically: union-find over the index buffer finds the 4 wheels as their own connected-component islands, each a
  disc shape near a corner, low to the ground; that part works, all 4 come back as a clean match). The problem is the body
  behind them: pulling a wheel's triangles out of the shared mesh leaves about 5,300 naked edges in the body where it sat,
  because the fender's wheel arch has no backing wall of its own, just the open cavity the wheel disc used to plug. Lifting
  the disc out for its own spinning instance left a hole you could see the road through at some angles
  (qa/cars-look-test.mjs caught it as a see-through leak). The prep script checks for this (an open boundary near a wheel
  centre in the body-only mesh) and falls back to keeping that kind's wheels in the body automatically.
- Decimated (meshoptimizer) toward the triangle budget: about 25k desktop, 7k phones, all in the one body-tex mesh.
- The baked texture is kept (not averaged to a flat colour like the old Innerscene conversion): resized with `sips` to
  1024x1024 (sloyd-sedan.glb) and 512x512 (sloyd-sedan-lite.glb).
- Paint: body-tex keeps its baked red texture and is tintable (the per-instance colour multiplies it, same mechanism as the
  rest of the kit). The wheels are part of that same mesh here, so they tint along with the paint; see the note in
  carmodels.js about why that's an acceptable trade for this particular model.
- Scene extras: `wheels: []` (static wheels, no per-wheel transform needed) and a default tyre radius.
- Meshopt-compressed (EXT_meshopt_compression), same as the rest of the kit.

# bmw-m4.glb, bmw-m4-lite.glb

**FAN ART, NON-COMMERCIAL ONLY.** The source blend is explicitly marked "Fan Art" on Blend Swap and its licence
forbids any commercial use. This model (and the real BMW design, badges and name it depicts) must be removed if
ZAVOD is ever monetised.

- Source: "BMW M4" (BMW M4 F82), Blend Swap blend #81957: https://www.blendswap.com/blends/view/81957
- Author: CuRvEmAsTeR (https://blendswap.com/profile/45652)
- Licence: CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/), fan art, non-commercial only. See LICENSE.txt
  for the required attribution text.
- Downloaded: assets/incoming/bmw-m4/BMW_M4_(20)_blendswap.blend (7.6 MB, Blender 2.76 scene, ~581k source triangles,
  37 objects, basic interior, three "Motorsport" stripe textures).
- Used for: the `bmw-m4` kind, src/world/carmodels.js (KIT['bmw-m4']) / src/world/carkit.js (KINDS['bmw-m4']).

## What we changed
- `assets/incoming/convert_blend.py` (run in Blender, headless): dropped cameras/lights/name-matched backdrop
  objects, made every mesh single-user, applied every modifier object by object (`bpy.ops.object.modifier_apply` -
  `bpy.ops.object.convert(target='MESH')` is a no-op on an object that's already a mesh, so it never actually baked
  anything here), cleared parenting (keeping world transform) and applied it, dropped anything still bigger than a
  car, decimated toward a triangle budget and shrunk the baked textures.
- `tools/prep-car-model.mjs` (`blend` mode, new in this change): oriented to the kit frame by reading the model
  itself rather than a fixed per-source map - the longer of the two horizontal extents is the length axis, and
  `Body_Front_Bumper` / `Rear_Spoiler` (name-matched) say which end is +x. Scaled to carSpec('bmw-m4') (4.06 m,
  this model's own real length - not rescaled up to match the taller sedan/e34 kinds), centred on X/Z, grounded at
  Y 0. Classified every primitive into a flat vertex-coloured bucket by its material name (paint / glass / lamp /
  metal / dark, same classes as the rest of the kit) and decimated (meshoptimizer) toward budget: ~30k desktop,
  ~7.5k phones.
- Wheels: left static, baked into the body. This source's rim/tyre objects are each one mesh covering all four
  wheel positions (built with a Mirror modifier, not four separate objects), so there's no single wheel template to
  pull out and spin the way carkit.js's instancing expects; see carmodels.js for the general note on this trade.
- Badges: the BMW roundel and "M4" badge sit baked into the Main_Body paint texture/geometry, not as their own
  object or a separable texture region, so they were left in place rather than risk damaging the paint mesh under
  this timebox. They should be blanked or removed before any wider (non-fan-art) use.
- Known issue: qa/cars-look-test.mjs's see-through check fails one of its 24 angles for the `bmw-m4@model` build (a
  small gap at the wheel arch, visible only from a near-ground, grazing rear-ish view - az ~4.71 rad, el ~0.02). Not
  reproduced on the procedural fallback body. Didn't track it down further under this timebox; worth another look
  (likely a winding or a missing backing-wall triangle around where the wheel sits) before relying on this view.
- Scene extras: `wheels: []`, a default tyre radius; `len`/`w`/`h` measured off the oriented, scaled mesh.
- Meshopt-compressed (EXT_meshopt_compression), same as the rest of the kit.

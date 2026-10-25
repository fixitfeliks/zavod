# skyline-r34.glb, skyline-r34-lite.glb

- Source: "Nissan Skyline R34 GT-R", Blend Swap blend #92438: https://www.blendswap.com/blends/view/92438
- Author: tikiteyboo (https://blendswap.com/profile/858613)
- Licence: CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/), no non-commercial clause. See
  LICENSE.txt for the required attribution text.
- Downloaded: assets/incoming/skyline-r34/newSKYLINE.blend (58 MB, ~2.03M source triangles, 55
  objects after cleanup).
- Used for: the `skyline-r34` kind, src/world/carmodels.js (KIT['skyline-r34']) / src/world/carkit.js
  (KINDS['skyline-r34']) - the rarer sporty model in the mix, in place of part of the procedural
  muscle-car share.

## What was wrong and how it was fixed
The task description's framing - "scale or parenting is off (the largest part is 9.5 m), and lite
decimation barely reduces it" - undersold it a little once this was actually opened up: the car's
own body shell object was modelled about 2x real size (consistent across its parts: a modelled
9.5 m-long shell, ~3.8 m-wide doors on a car whose doors should be under 2 m), *and* several of its
objects (at least the body shell, both windscreen rubber trim strips, and a rear quarter panel at
the lite decimation tier) carry one leftover vertex many metres from the rest of their own geometry
- almost certainly the un-deformed control cage of a Curve modifier `convert_blend.py` found
disabled on six of this file's objects and therefore couldn't apply.
- `convert_blend.py`: made every mesh single-user (a shared mesh block otherwise silently blocks
  `modifier_apply`, which is most likely what was leaving `DECIMATE` barely touching the triangle
  count at the lite tier), then applied every modifier object by object (`convert(target='MESH')`
  is a no-op on an object that's already a mesh - this is what had left the body shell's own Mirror
  modifier un-applied, so it only exported one half; that's fixed, but the stray-vertex defect
  above is independent of this and remained), cleared parenting and applied it.
- `tools/prep-car-model.mjs` (`blend` mode): added a per-part sanity check (any single vertex more
  than 4 m from the median of its own part's vertices gets the whole part dropped, logged to the
  console) specifically because of the above - it's what's catching the defective body shell and
  trim strips here. Oriented (`Front.Bumper` / `BackQuarter` etc. name-matched against front/rear),
  scaled to carSpec('skyline-r34') (4.6 m, about half the rig's own 9.5 m), centred on X/Z, grounded
  at Y 0. Classified by material name into the kit's flat vertex-coloured classes (this source's
  materials - GTR.Alloy, Paint.000/001, WindowGlass, ... - carry real, distinct colours, unlike the
  BMW and Audi conversions). Decimated toward budget: about 30k desktop (26.1k came out, Blender's
  own decimation left it close to budget already once single-user was fixed), 8k phones.
- The dropped body shell ("Cube", a generic default name - almost certainly a base/placeholder
  object, not the only visible skin) leaves the car built from its many individually-named panels
  (doors, bonnet, boot, bumpers, quarter panels, ...), which still read as a complete, recognisable
  R34 shape in the look-test screenshots - see the PR for a 3/4 view. There's a real, visible gap
  left where Cube would have closed off the roof near the rear windscreen (qa/cars-look-test.mjs
  flags it: 1600-2000 px of see-through at a few angles, mostly from directly behind) - Cube
  evidently did double as part of the roof/greenhouse surface, not just a backing shell. The lite
  tier is also missing one rear quarter panel (BackQuarter, 4.0 m - just over the 4 m cutoff at that
  decimation level), and a handful of small lug-nut-sized parts near the wheels got caught by the
  leftover-prop filter too (collateral from how broad that filter's "off to one side" check is).
  Worth revisiting with a tighter, more targeted fix (dropping only the bad triangle/vertex instead
  of the whole part, and patching the roof gap with a stand-in panel) rather than the blanket
  per-part checks used here.
- Wheels: left static, baked into the body. This source's Alloy.GTR rim objects are four separate,
  already-correctly-positioned objects (unlike the BMW's merged-into-one-mesh wheels), so a future
  pass COULD split them out to spin; not attempted here given the time this model had already taken.
- Badges: the GTR / Nissan badges (GTR_Logo, NissanBadge, GTR.AlloyLogo) are their own small, named
  objects - easy to find, not removed under this timebox. Should be blanked or dropped before any
  wider use given this depicts a real Nissan design.
- Scene extras: `wheels: []`, a default tyre radius; `len`/`w`/`h` measured off the oriented, scaled,
  outlier-filtered mesh.

# Kite Flyer — implementation plan

## Context

There is no code yet; `/home/nath/Work/Games/kite-flyer` is empty. This plan builds the MVP of a
web-based pixel-art kite flying game: a small figure at the bottom of the screen flying a
single-line kite in a simulated wind field, viewed from behind.

The point of the MVP is the **simulation**, not the art. A kite game is only interesting if the
kite behaves like a kite — settles at a natural elevation, loses tension at the edge of the wind
window, stalls, falls off on one side, dives, and can be recovered by pulling in line. So the
physics is built and made tunable first, and everything visual is layered on afterwards.

Two constraints shape the architecture. First, the build is AI-first: sprites are drawn
procedurally in code so they can be re-directed in plain language, and every physics constant lives
in one config object bound to live sliders so feel can be dialled in without a round-trip. Second,
pixel art plus a zooming camera means nothing may ever be bitmap-scaled — procedural sprites redraw
natively per zoom level, and the three externally generated bitmaps get pre-rendered variants.

Discovery settled the design decisions; they are summarised inline below and the art brief is
retained as an appendix.

## Coordinate system and camera

Flyer at world origin. **+Z is downwind** (away from viewer), **+Y is up**, **+X is lateral right**.
Camera sits at `(0, eyeHeight, -camDist)` looking along +Z.

Kite state is a 3D position and velocity, not spherical coordinates — the sphere emerges from the
line constraint rather than being imposed. Azimuth and elevation are *derived* for HUD and the wind
window overlay.

`camDist` is the mitigation for the azimuth risk flagged in discovery. Because the camera sits
behind the flyer, a kite at 90° azimuth (world z = 0) is still at camera-space z = `camDist`, so it
projects to a finite screen position rather than infinity. Larger `camDist` flattens the projection
and keeps extreme azimuths on screen. It is a tuning slider, and it means the MVP does not need an
azimuth clamp.

Zoom quantises to `[1.0, 0.75, 0.5, 0.35, 0.25, 0.18]` and **snaps** between levels, with a
hysteresis margin so it cannot flicker at a boundary. The plan originally said "eases between
levels"; that was wrong, because easing through intermediate scales is continuous zoom by another
name and reintroduces exactly the resampling the discrete levels exist to avoid. The flyer is **pinned to a
fixed screen position** near the bottom and zoom scales about that pin — this satisfies "fit the
kite" and "keep the person at the bottom" with one mechanism.

## Simulation model

### Wind field — `src/sim/wind.ts`

`windAt(pos, t) -> Vec3`, composed of:

- **Base** `(0, 0, baseSpeed)`, default 6 m/s.
- **Vertical gradient** — power law `v(h) = v_ref * (h / h_ref)^shear`, `shear` default 0.14,
  `h_ref` 10 m. This is what makes letting line out actually gain you wind.
- **Gusts** — 3D simplex noise sampled at `(pos * spatialScale, t * timeScale)`, one octave per
  component with distinct offsets. Sampling at the kite's *position* is what makes it fly through
  gust cells rather than the whole world gusting at once.
- **Ground turbulence** — extra high-frequency noise scaled by `(1 - y / turbHeight)`, zero above
  `turbHeight` (~8 m). Also serves as the dune wind shadow.

Use the `simplex-noise` npm package rather than hand-rolling. It is ~2 KB and a subtly wrong noise
function is a miserable bug to chase.

### Aerodynamics — `src/sim/aero.ts`

Flat-plate model with a stall, physically grounded with feel multipliers on top:

1. Apparent wind `W = windAt(kitePos, t) - kiteVel`.
2. Kite attitude: nose direction is the line direction rotated by the **bridle angle**; the plate
   normal follows from that plus the **roll** DOF (below).
3. Angle of attack `α` = angle between `W` and the kite chord.
4. `CL(α)`: linear `2π·α` up to `αStall` (~16°), then blended to post-stall flat-plate
   `2·sinα·cosα`. `CD(α) = CD0 + 2·sin²α`.
5. `L = ½ρ|W|²·A·CL·clScale` perpendicular to `W`; `D = ½ρ|W|²·A·CD·cdScale` along `W`.
6. **Line drag** proportional to line length, applied at the kite. Cheap, and it is why a long line
   makes a kite fly lower — worth having.

The stall is the important part. Everything the game is about — the window edge, the dive, the
recovery — emerges from `CL` collapsing past `αStall`.

### Kite body — `src/sim/kite.ts`

Point mass plus **two rotational DOFs: pitch (angle of attack) and roll about the wind axis**.

**Attitude is built from the apparent wind, not from the line.** The first implementation derived
the kite's face from the line direction rotated by a bridle angle, which seemed natural and is
wrong: it makes angle of attack a fixed function of elevation, so a kite that drops loses incidence,
loses lift, and drops faster. That is positive feedback, and it drove the kite straight into the
sand on the first headless run. A real kite weathercocks into the airflow; the line only holds it
in place against the resulting force.

So angle of attack is a *state variable* on a damped spring toward the trim angle the bridle sets,
with both the restoring moment and the roll restoring term scaling with dynamic pressure. That
scaling is the whole mechanism behind a stall becoming a dive: in dead air a plate has no
aerodynamic authority, the tail stops working, and roll wanders. Elevation then settles where
`tan(elevation) = lift/drag`, emergently.

Forces: gravity, lift, drag, line tension, line drag. Semi-implicit Euler.

### Line — `src/sim/line.ts`

Spring-damper along the line axis, no hard constraint and no verlet rope:

```
ext = |kitePos - handPos| - lineLength
tension = ext > 0 ? (k * ext + c * radialVelocity) : 0
```

The spring is what produces the lag between a tug and the kite reacting. It also means the kite is
never rigidly pinned to a sphere, which is both more correct and more stable.

**Stiffness needs sub-stepping.** Run physics at a fixed 240 Hz with an accumulator, render on rAF.
A stiff spring at 60 Hz will explode.

Rendering: sag depth is a function of tension — slack line bellies into a quadratic curve, taut
line snaps straight. Purely visual, zero physics cost, and it is the clearest tension readout the
player has.

### Hands and input — `src/sim/flyer.ts`, `src/input/keys.ts`

Each hand has a draw scalar `d ∈ [0,1]`. Holding `A` (left) or `L` (right) advances that hand's
draw at a fixed rate; releasing returns it at a fixed rate. A stab is a sharp tug, a hold is a
sustained pull, both together is a two-handed power pull.

Both hands are on the same line on a single-liner, so:

- pull magnitude = `(dL + dR) / 2` along the line direction
- lateral hand offset = `(dR - dL) * smallOffset`

Honest to real single-line flying, and it gives both keys something to do. When dual-line arrives,
`dL`/`dR` become per-line lengths feeding a yaw torque — the input layer does not change.

Line length on `Q` / `E`, a single shared quantity. Default 30 m, range 5–80 m.

### Config — `src/sim/config.ts`

**Every** tunable constant in one typed object: wind base/shear/gust amplitude/spatial and time
scale/turbulence height, kite mass/area/`CL`/`CD` scales/`αStall`/bridle angle, line spring/damping/
drag, hand draw rate and depth, camera `camDist`/`eyeHeight`/FOV. This object is the model the
tuning panel binds to. Nothing may hardcode a magic number outside it.

## Rendering

Internal buffer **480×270**, integer-upscaled to the window with `imageSmoothingEnabled = false`
(exactly 4× at 1920×1080). Draw order: sky gradient with dither bands → sea band → headland bitmap
→ parallax clouds → ground strip bitmap → props → flyer rig → string → kite → HUD → overlays.

**Sprite cache** — `getSprite(key, zoomLevel, drawFn)` memoises an `OffscreenCanvas` per
`(key, zoomLevel)`. Every procedural draw function takes the zoom level and redraws natively; it
must never scale a bitmap. For flyer limbs the key includes the angle quantised to ~24 steps, so
rotation snaps instead of shimmering.

**Palette** — one named palette object in `src/render/palette.ts` as the single source of truth, so
"make the kite red" is a one-line change.

**Asset loader** — `src/render/assets.ts` takes the three generated PNGs and does chroma-key on
`#FF00FF`, nearest-neighbour downsample, palette quantise, then pre-renders a variant per zoom
level. Bitmaps cannot do the procedural redraw trick, so this runs once at load.

## Build phases

Each phase ends somewhere runnable.

**Phase 0 — scaffold. DONE.** Vite + TypeScript, offscreen buffer and integer-upscale blit,
fixed-timestep loop at 240 Hz physics / rAF render, dithered procedural sky and coastline, and a
placeholder kite on a string proving interpolated rendering. Verified at 60 fps, 3x upscale, no
console errors.

**Phase 1 — simulation, with no art at all. DONE.** Wind field, aero, kite body with pitch and
roll, line spring, hand input, tuning panel, force-vector overlay, instrument HUD. Kite renders as
a plain square, flyer as a rectangle.

**Phase 2 — camera. DONE, folded into phase 1.** Phase 1 was unverifiable without a camera — a kite
on a 30 m line projects far off screen at zoom 1 — so `src/render/camera.ts` was built alongside it
rather than shipping a throwaway projection.

**Phase 3 — procedural art. DONE.** Hard-pixel rasteriser, sprite cache, drifting cumulus, the kite
drawn from its actual attitude with a trailing tail, and the flyer rig with arms aimed along the
real string direction and lean scaled by real tension.

Four things came out differently from the plan:

- **`src/render/raster.ts` was needed and unplanned.** Canvas `stroke()` and `fill()` anti-alias
  unconditionally, so a one-pixel line arrives as two grey ones. Everything now goes through a
  Bresenham line, a scanline polygon fill and a scanline ellipse instead.
- **The angle-quantised limb cache was dropped.** It existed to stop rotated bitmaps shimmering,
  but the limbs are Bresenham lines between rounded endpoints — already snapped to the pixel grid,
  with nothing to resample. The cache would have been pure cost.
- **The arms are posed directly, not solved.** Aiming them at the kite put the hands an arm's
  length above the flyer's head; a two-bone IK solve then threw the elbows straight out sideways.
  Both are the same mistake: in a behind view the forearms point *away* from the camera and are
  heavily foreshortened, which a screen-plane solve cannot represent. The hands now rest at waist
  height with the elbows hanging just below the ribs, drifting toward the line and straightening
  upward as tension loads them.
- **The kite needed a readability cheat.** With a near-horizontal camera and near-vertical lift, an
  honest projection shows the kite almost edge-on at low elevation: it collapses to a one-pixel
  sliver and disappears. Its normal is now eased toward the camera once the face turns too far
  away, and `kite.visualScale` draws it larger than life (default 2.2x). The physics always uses
  the true area; only the drawing is flattered.
- **Cloud sprite widths snap to 8 px steps.** Without that, a drifting cloud wants a freshly
  rasterised sprite nearly every frame, which allocated a canvas per cloud per frame and dropped
  the game to 33 fps.

Clouds drift downwind at a fraction of the wind speed, which makes the scenery itself a wind
indicator — free, and better than a HUD arrow.

**Phase 4 — bitmap scenery.** Asset loader, headland and ground parallax layers, prop scattering.
Needs your three generated PNGs in `public/assets/`; everything before this runs without them.

**Phase 5 — HUD and goals.** Line length, altitude, tension bar, live wind indicator, time aloft.
Toggleable wind-window overlay. Soft goals: max altitude, time aloft, crash count.

## Files

```
src/
  main.ts                  bootstrap, canvas, resize
  core/loop.ts             fixed-timestep accumulator
  core/vec3.ts             minimal vector math
  core/rng.ts              seeded RNG for prop and cloud placement
  sim/config.ts            ALL tunable params — the tuning panel's model
  sim/wind.ts              windAt(pos, t)
  sim/aero.ts              CL/CD curves, flat-plate forces
  sim/kite.ts              kite state, roll DOF, integration
  sim/line.ts              spring-damper tension, sag parameters
  sim/flyer.ts             hand draw state, hand position
  sim/world.ts             owns sim state, step(dt)
  render/screen.ts         offscreen buffer, integer upscale, blit
  render/camera.ts         projection, discrete zoom, hysteresis
  render/palette.ts
  render/spritecache.ts
  render/sprites/{kite,flyer,cloud,sky,props}.ts
  render/assets.ts         chroma-key, downsample, quantise, zoom variants
  render/scene.ts          layer orchestration, parallax
  ui/hud.ts
  ui/windwindow.ts         toggleable dome overlay
  ui/tuning.ts             DOM slider panel bound to config
  ui/vectors.ts            debug force overlay
  input/keys.ts
public/assets/             ground.png, headland.png, props.png (you generate)
```

## Starting constants

Kite mass 0.25 kg, area 0.6 m², `αStall` 16°, bridle 12°. Air density 1.225. Wind base 6 m/s,
shear 0.14 at 10 m reference. Line 30 m default, 5–80 m range, spring stiff enough to read as
inextensible at 240 Hz. Eye height 1.6 m, `camDist` ~12 m. All of these are slider defaults, not
commitments.

## Verification

- **Play it.** `npm run dev`, keep the browser open. This is the primary check from phase 1 onward,
  and it is why the tuning panel comes early.
- **`npm run sanity`** — headless scenario checks, built in phase 1. Asserts steady flight settles
  at a plausible elevation and stays finite, that letting line out gains height, that a two-handed
  tug loads the line, and that losing the wind drops the kite and it recovers when the wind
  returns. This is what caught the attitude-model error above, in a second, before it ever reached
  a browser.
- **Visual checks** — I will drive Chrome to screenshot and confirm nothing is obviously broken
  before handing each phase back, but the feel judgements are yours.

## Deliberately out of scope

Running backwards, dual-line kites, kite fighting, alternative scenery and wind presets, sound,
and mobile/touch. Dual-line is the intended next step and the input and aero layers are shaped for
it.

---

# Appendix: Art generation brief

Three separate assets. One big background image cannot survive the zooming camera, so scenery is
split into parallax layers with the sky generated procedurally in code.

## Which generator

| Generator | Verdict |
|---|---|
| **[Retro Diffusion](https://www.retrodiffusion.ai/)** | Best choice. Purpose-built pixel-art diffusion model, outputs a true pixel grid, has an Aseprite plugin |
| **Midjourney** with `--style raw` | Good second. Strong composition, but the pixel grid is approximate |
| **Flux** + a pixel-art LoRA | Good if you already have a local Flux setup |
| **DALL·E / general Claude image gen** | Produces *fake* pixel art — anti-aliased edges, inconsistent pixel size. Usable only after the downsample pass below |

Generate large regardless of generator. The loader does a nearest-neighbour downsample and a
palette quantise, which repairs most fake-pixel-art artefacts.

## Shared palette

Keep the palette line **identical across all three prompts** or the layers will not sit together.
Good CC0 starting palettes from [lospec.com](https://lospec.com/palette-list):

- **Endesga 32** — warm, punchy, good general pick for a beach scene
- **AAP-64** — wider range if you want subtler atmospheric gradients
- **Resurrect 64** — softer, more naturalistic

Pick one and name it in the prompt, or just keep the "limited palette of N colours" line consistent.

## Assets A and B — superseded, now procedural

Attempts to generate a distant headland produced full landscape paintings with sky and clouds baked
in, framed by foreground cliffs — unusable, because the sky must parallax independently of the land.
Both the headland and the ground are now generated in code (`src/render/sprites/ground.ts`): a
low-frequency noise horizon filled with flat palette tones. That tiles infinitely, matches the
palette exactly, responds to camera zoom, and is re-directable in plain language. It is a better
answer than the generator, not a fallback.

Reference images kept in `public/assets/source/` for art direction:

- `beach-full.png` — generated beach; dunes framing both sides make it unusable whole
- `beach-crop.png` — the usable crop: sand, foam waterline, sea band. Worth revisiting in phase 4
  as an optional swap for the procedural beach if the hand-drawn sand texture reads better

**Chroma-key finding:** the generator rendered the requested `#FF00FF` as a lavender band rather
than exact magenta. The loader's key must therefore use a colour-distance tolerance, not an exact
match. For a ground strip this is moot — crop at the horizon and composite at a known Y instead.

## Asset C — foreground prop sheet

Individual objects, placed procedurally along the ground.

```
Pixel art sprite sheet, 16-bit SNES era. A grid of separate small objects on a solid magenta
#FF00FF background: marram grass tuft, dry beach grass clump, small driftwood log, bleached
branch, rock, pebble cluster, plastic bucket, wooden fence post, section of wind fencing.
Each object 32x32 to 64x64, evenly spaced, clearly separated, viewed side-on at eye level.
Consistent lighting from top-left. Limited palette of 24 colours. No text, no watermark, no
characters.
```

## Post-processing (handled in code, no manual work needed)

1. **Chroma key** — `#FF00FF` becomes transparent. This is why every prompt asks for solid
   magenta rather than "transparent background"; generators handle transparency badly but
   handle a named flat colour well.
2. **Nearest-neighbour downsample** to the target internal resolution.
3. **Palette quantise** to the chosen lospec palette, so all three layers share exact colours.
4. **Pre-render zoom variants** at each discrete camera zoom level.

## Prompt-tuning tips

- If the output has anti-aliased edges, add `crisp hard-edged pixels, no anti-aliasing, no
  dithering, no gradients`.
- If it invents a sun, sky, or characters, the negative terms are already in the prompt —
  repeat them rather than rephrasing.
- If tiling seams show on Asset A, generate it 2x wider than needed and crop to a seamless
  section, or mirror it.
- Generate 3–4 variants of each and keep the one whose palette reads closest to the others.

---

# Addendum: the bridle is physical

`kite.bridleDeg` is the angle the bridle holds between the flying line and the kite's chord. Angle
of attack is **derived** from it — bridle angle less the angle between the line and the apparent
wind — rather than being a fixed number. So a kite low in the window runs at a high angle of attack
(near stall, poor lift, high drag, visibly upright) and one near the zenith runs nearly flat. That
is what makes elevation self-correcting: climbing reduces incidence, which reduces lift.

This replaced a fixed `trimDeg` that held the same incidence at every elevation. Two consequences
of the switch, both non-obvious:

- `cd0` and `line.dragPerMetre` had been inflated to make the fixed-angle model settle somewhere
  realistic. With real geometry they capped lift-to-drag and pinned the kite at 33 degrees. They
  came down to 0.1 and 0.004, and it now settles at 62 degrees with a 7.6 degree swing.
- Steady tension roughly halved, because the kite now trims to about 7 degrees rather than 14.
  `line.tautTension` and the flyer's brace threshold in `main.ts` had to follow.

`kite.drawPitchFloorDeg` is the one rendering value, and it is a **camera** compensation, not a
bridle property. A real viewer tilts their head up and sees a high kite face-on; this camera looks
along the wind, so an honestly flat kite is edge-on and vanishes. It applies only the shortfall
below the floor, so it fades to nothing when the kite genuinely stands up low in the window. If the
camera ever pitches to follow the kite, it can be deleted.

Sweeping `bridleDeg` against `cd0` and `dragPerMetre` headlessly is how these were chosen; the
sweep is trivial to rebuild from `scripts/sanity.ts` if they need revisiting.

## To fix
- body lean when the tension is high
- can we generate a better body.
- I'd like the beach to be fixed width, and mirror the dunes to get another section of beach, when the camera zooms out and the beach increases width it looks wierd

## Todo list
1. Minimum beach width. On a narrow screen the two dunes pin to the screen edges at a constant size, so they can crowd out the sand corridor entirely and leave you flying over nothing but grass. Needs a floor on the sand width, with the dunes shrinking or sliding partly off-screen once that floor is hit — so you always get a bit of dune each side and a usable beach between.

2. Touch support — both hands and line length, plus pause/settings. Currently A/L are spring-loaded keys with no touch equivalent at all, so a phone can load the game but can't play it. Worth remembering the hands need analogue depth, not just tap-on/tap-off: a stab is a sharp tug and a hold is a sustained pull, and touch needs to preserve that distinction. Pause and settings matter more on touch too, since there's no T key to reach for.

3. Camera follow on narrower screens. Right now the camera direction is fixed and the zoom pulls out to fit the kite while the flyer stays pinned to the bottom. On a narrow screen that forces a very wide zoom-out and the kite becomes tiny. Following the kite instead would keep it readable.

Worth flagging on that last one: it interacts with the azimuth issue already in the plan. The camera sits behind the flyer specifically so a kite at 90° azimuth still has depth in camera space and projects somewhere finite. If the camera starts following the kite, that geometry changes and the reasoning needs revisiting — particularly before two-line kites, which sweep the full width of the wind window.

4. A reset kite into launch position, so a good tug will launch it. both in rotation, and also with the kite at a distance that puts the kite with the line taught.
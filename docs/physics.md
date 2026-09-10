# How the kite flies

A plain-language walkthrough of the flight model, in the order the code actually runs
each step. Every constant mentioned here is a slider in the tuning panel; nothing in the
simulation is a magic number buried in the source.

## The kite is a heavy dot

Everything starts simpler than you'd expect: the kite is a single point in space with a
position, a velocity, and a weight of 250 grams. Exactly like simulating a thrown ball.
All the interesting behaviour comes from what pushes on that dot.

Four things push on it every step: **gravity** pulling down, **lift** and **drag** from
the air, and **tension** from the string. Add them up, divide by the mass, and you get an
acceleration — that's Newton's second law and it's the whole of the motion code. Nudge
the velocity by the acceleration, nudge the position by the velocity, repeat.

Each of the 240 steps per simulated second:

1. Sample the wind where the kite currently is.
2. Subtract the kite's own velocity to get the wind it actually feels.
3. Work out how steeply it is tilted into that airflow.
4. Turn that tilt into a lift force and a drag force.
5. Ask the string how hard it is pulling back.
6. Sum the forces, nudge the velocity, nudge the position.

Drawing happens separately, whenever the browser is ready.

## Lift and drag: your hand out of a car window

Stick a flat hand out of a moving car. Palm flat and level, it slices through — barely
any force. Tilt it slightly and you feel it get shoved upward and backward at once.
Upward is lift, backward is drag.

That tilt is called the **angle of attack**, and it's the single most important number in
the whole simulation. Tilt a little and you get a lot of lift for very little drag —
efficient. Tilt more and you get more lift but drag grows much faster.

One subtlety that matters: the kite doesn't feel the wind, it feels the wind *minus its
own motion*. Same reason a still day feels breezy on a bicycle. So a kite diving downwind
feels less wind and loses lift, which is why a dive tends to keep going until the kite
swings back across.

*Sliders: lift scale, drag scale, parasitic drag.*

## The stall is where all the drama lives

Keep tilting your hand and at some point — around 16° for a flat plate — the airflow
stops following the surface and breaks away into turbulence behind it. Lift doesn't just
stop growing, it **collapses**. Drag keeps climbing.

That cliff is the most important line in the code, because almost everything the game is
about falls out of it rather than being scripted anywhere. Fly to the edge of the wind
window, the kite loses its airflow, lift dies, the string goes slack, and it falls off on
one side into a dive. Nobody wrote "if at window edge then dive" — it's just what a
collapsed lift curve does.

The actual curves in `src/sim/aero.ts`: lift climbs at `2π·α` until the stall angle, then
blends down to the flat-plate value `sin(2α)` over nine degrees. Drag is `0.1 + 2sin²α`
throughout.

*Sliders: stall angle deg, stall blend deg.*

## What the bridle actually does

The bridle is the little triangle of strings on the kite's face where your flying line
attaches. Its job is to hold the kite at a chosen tilt to the string. Because it's
described here by the *lengths of its legs*, the angle falls out of the triangle rather
than being typed in.

Here's the part that took a couple of goes to get right. The tilt into the *wind* isn't
fixed — it's the bridle's angle minus wherever the kite happens to be sitting relative to
the airflow. So a kite low in the sky is being hit almost face-on: high tilt, stalled,
draggy, and visibly standing upright. The same kite near overhead is nearly edge-on to
the wind: low tilt, efficient, lying flat.

That's what makes the whole thing self-correcting. Climb, and your tilt drops, so you make
less lift, so you stop climbing. Sink, and your tilt rises and you climb again. It settles
by itself, and the height it settles at is set by the lift-to-drag ratio — literally
`tan(angle above the horizon) = lift ÷ drag`. Good kites fly high because they're
efficient, not because they're lifty.

> **The wrong version.** An earlier attempt fixed the angle of attack at a constant
> regardless of where the kite was, which removes the feedback entirely. A version before
> that tied it to elevation with the sign inverted, so a kite that dropped lost lift and
> dropped harder. It flew straight into the sand on the first headless run.

*Sliders: bridle upper leg, bridle lower leg.*

## The string is a bungee, not a stick

The obvious way to do a kite is to pin it to a sphere at exactly the string's length. I
deliberately didn't. Instead the string is a very stiff spring: stretch it past its length
and it pulls back hard, proportional to how far it's stretched, and it pushes not at all
when slack.

Two things fall out of that. The line can genuinely go slack — essential, since a kite
with no tension is a kite in trouble. And a spring takes a moment to transmit force, so
when you tug, the kite reacts a beat later. That delay is most of what makes it feel like
a kite rather than a puppet.

The cost is that a stiff spring needs small time steps or it explodes, which is why
physics runs at 240 Hz rather than at your screen's refresh rate. Tension is also capped,
because line length can change instantly when you drag a slider, and an uncapped spring
turns a 66-metre stretch into roughly 59,000 newtons on a 250-gram kite.

*Sliders: spring N/m, damping, max tension N.*

## Two ways the kite can turn

Beyond moving through space, the kite can **pitch** (nose up and down, changing that
all-important tilt) and **roll** (banking left and right, which tips the lift sideways and
makes it swing).

Both behave like a door on a spring: pushed away from where they want to sit, they swing
back. Critically, both springs get their strength from the air itself — the harder the air
is blowing over the kite, the more firmly it holds its attitude. A tail works by air
resistance; in still air it does nothing at all.

That's the mechanism behind a stall becoming a dive. Lose the airflow and you don't just
lose lift, you lose the kite's ability to hold itself straight. Roll drifts, the kite tips
onto one side, and down it goes.

> **Why damping is a ratio.** Spring strength grows with wind speed, so damping written as
> a fixed number is only correct at one wind speed. At 10 m/s the kite was ringing back and
> forth about twelve times a second. It's now specified as a fraction of whatever critical
> damping happens to be at that moment, so it stays settled at any wind speed.

*Sliders: pitch damp ratio, roll damp ratio, tail strength.*

## The wind is weather, not a number

Rather than one wind value, there's a wind *field* you can sample at any point and time.
It's built from four layers:

- A **base speed**.
- A **height gradient**, so higher air is faster — which is why letting line out genuinely
  gains you something.
- Drifting **gust cells** from a noise function, sampled at the kite's own position so it
  flies *through* gusts rather than the world gusting all at once.
- Extra choppy **turbulence** near the ground, which doubles as the wind shadow behind the
  dunes.

The clouds drift downwind at a fraction of the same speed, which quietly makes the scenery
its own wind indicator.

*Sliders: base speed m/s, shear exponent, gust amplitude, gust cell size m, turbulence amp.*

## Dihedral — the missing stabiliser, and why other kite shapes will need it

Worth writing down before we add more kite types, because it explains a whole class of
behaviour.

A **flat** diamond kite is roll-unstable. Nothing about a flat plate resists it tipping
onto one side: once it starts rolling, the lift tips with it, the kite slides sideways,
and it spirals in. We saw exactly this — roll growing steadily at 2, 5, 10, 18 degrees
per second while pitch stayed perfectly behaved.

Real kites solve it two ways.

**A weighted tail** hangs below on a lever arm and acts as a pendulum. Gravity on that
mass pulls the kite upright, and crucially it needs no airflow, so it is still working
when the wind drops and every aerodynamic term has gone quiet. This is what the model
uses today, and it is why `tailMassPerMetre` matters as much as it does.

**Dihedral** — the bow in the cross spar that makes the kite a shallow V — is the other,
and it is the better one. Roll one wing down and it presents more area to the airflow
than the raised one, so it generates more lift and pushes itself back level. An Eddy
kite is bowed for precisely this reason.

The difference matters because of *how the two scale*. Tail weight is constant, so a
tail heavy enough to hold roll in a stiff breeze is too heavy to fly in a light one, and
it pitches the nose up and has to be trimmed out. That is the tradeoff currently baked
into the model, and it is why the kite wants roughly 8 m/s or more. Dihedral scales with
dynamic pressure like every other aerodynamic force, so it works across the whole wind
range and adds no pitch bias at all — which would let the tail go back to being light.

**Implementation sketch.** Split the aerodynamic force into two half-panels offset
`±span/4` along the span, each with its own normal tilted by the dihedral angle, each
computing its own incidence from the local relative wind — which includes the rotational
term `spin x r`, and that is where the restoring moment comes from. Sum the forces and
torques. Nothing else in the model has to change.

### What this means for other kite shapes

- **Deltas** get very large effective dihedral from their sail billowing into a deep V,
  plus a keel. They are stable with no tail at all — which the model cannot currently
  reproduce, because it has no dihedral term.
- **Box and cellular kites** get stability from their geometry: the vertical panels act
  as fins and give real yaw stiffness, something a flat plate has none of.
- **Two-line stunt kites** are the interesting case. They use dihedral *and* a wide
  span, but deliberately little tail, because a tail resists exactly the fast yaw the
  player is trying to command. Steering them is a yaw torque from the differential line
  pull, so a heavy stabilising tail would fight the controls. Dihedral has to be in
  before stunt kites will feel right.

## Verification

`npm run sanity` runs the whole model headlessly against six behavioural checks: steady
flight settles at a plausible elevation and stays finite; letting line out gains height; a
two-handed tug loads the line; losing the wind drops the kite and it recovers; a violent
line-length change doesn't blow up; and pitch doesn't flip-flop. Both the pitch oscillation
and the divide-by-infinity crash were caught there in about a second each, long before they
reached a browser.

## Where things live

| File | What it owns |
| --- | --- |
| `src/sim/wind.ts` | The wind field |
| `src/sim/aero.ts` | Lift and drag curves |
| `src/sim/bridle.ts` | Leg lengths to tow point |
| `src/sim/kite.ts` | Forces, pitch, roll |
| `src/sim/line.ts` | Spring, damper, sag |
| `src/sim/flyer.ts` | Hands and tugs |
| `src/sim/config.ts` | Every tunable constant |

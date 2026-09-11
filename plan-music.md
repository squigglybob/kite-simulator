# Procedural lofi music — implementation plan

## Context

A generative ambient music module for the kite game. Built first as a standalone
experiment with no connection to the game, and ported only if it sounds good.

Decisions taken in discovery, with the reasoning worth keeping:

- **No Tone.js.** Tone earns its ~200KB through `Transport` — musical time, beats,
  swing, tempo. This is drone: no tempo grid, no beats. What would be left is thin
  wrappers over `OscillatorNode`, `BiquadFilterNode` and `ConvolverNode` that
  `src/audio/ambience.ts` already shows we are comfortable writing. Raw Web Audio.
- **Pure synthesis, no samples.** Pure synthesis is a poor fit for Rhodes-driven lofi
  hip-hop but is the native idiom for drone ambient — detuned pads, filtered noise, FM
  bells. Also removes the licensing question entirely.
- **Drone ambient, not beats.** No drums, no fixed tempo.
- **Knows nothing about the kite.** No wind, altitude or tension input. Reactivity is
  explicitly out of scope; the parameter interface leaves room for it later.
- **Hand-authored harmony, procedural everything else.** A small chord set chosen by
  ear; voicing, register, timing and note selection generated. This is the cheapest
  route to something that sounds deliberate rather than random.
- **Seeded and reproducible.** Without a slider harness, a seed is the only way back to
  a version that sounded good.

## Architecture — the seam that matters

One rule governs the whole module: **the composition logic never imports Web Audio.**

`harmony.ts` and `drift.ts` are pure functions over a seeded RNG that emit
`NoteEvent[]`. `engine.ts` and `voices/*` turn those events into sound. Nothing in the
musical layer knows what a `GainNode` is.

This is what makes the module portable. If the port lands and the sound needs
rebuilding on a different foundation, the rebuild is confined to the renderer. If the
theory and the audio graph get tangled, any later change becomes a rewrite.

Second rule: **the engine never creates an `AudioContext`.** It takes one, plus a
destination node, in its constructor. In the experiment the page provides them; in the
game the `Mixer` does. This is the only thing standing between phase 1 and phase 5.

```ts
new MusicEngine(ctx: AudioContext, destination: AudioNode, params: MusicParams, seed: number)
```

## Phase 1 — Experiment scaffold

Lives in `experiments/lofi/`, outside `src/`. Nothing in the game imports it.

Vite serves `experiments/lofi/index.html` at `/experiments/lofi/` in dev with no config
change, and `vite build` only takes the root `index.html` as an input — so the
experiment is excluded from the game bundle automatically, without a `vite.config.ts`
or an exclusion rule to maintain.

1. `experiments/lofi/index.html` — play/stop button, the active seed shown as text.
   Nothing else, by choice: the harness is deliberately minimal.
2. `experiments/lofi/main.ts` — creates the `AudioContext` on the button press (browsers
   will not start audio before a gesture), reads `?seed=` from the URL or rolls one,
   logs it to the console, constructs the engine, starts and stops it.
3. `experiments/lofi/params.ts` — the `MusicParams` interface, defaults, and the `beach`
   preset. Every audible quantity lives here rather than as a literal in the voices.

## Phase 2 — Synthesis core

4. `experiments/lofi/fx.ts` — the shared signal chain, built once and reused:
   - **Reverb.** A `ConvolverNode` fed a procedurally generated impulse response: a
     stereo noise buffer with exponential decay over 3–6 seconds and a darkening lowpass
     baked into the tail. Roughly thirty lines, one instance, used as a send bus so the
     three voices share it rather than each paying for its own convolution.
   - **Wow and flutter.** A slow LFO (0.1–0.6 Hz, with a little noise on it) driving the
     `detune` of every oscillator, a few cents deep. This is where nearly all the tape
     character comes from, and it is the part that survives sitting next to the surf.
   - **Tone shaping.** Master lowpass around 3–5 kHz for the rolled-off highs, plus a
     highpass near 40 Hz to clear rumble that laptop speakers cannot reproduce anyway.
   - **Hiss.** A very low filtered-noise bed. Deliberately minimal — see risk 2.
5. `experiments/lofi/voices/pad.ts` — three or four detuned oscillators per note (±5–8
   cents), lightly spread in stereo, through a lowpass whose cutoff the drift layer
   moves, with a 2–4 s attack and a 3–6 s release. Sends to the shared reverb.
6. `experiments/lofi/voices/bass.ts` — one sine or triangle on the chord root, hard
   lowpassed, very slow envelope. Kept between roughly 55 and 110 Hz: below that it is
   inaudible on most speakers and only eats headroom.
7. `experiments/lofi/voices/bell.ts` — an FM pair, carrier sine plus a modulator at a
   non-integer ratio, the modulator through a fast-decaying gain into carrier frequency.
   Exponential decay of 1.5–3 s, heavily reverbed, fired sparsely and probabilistically.

Each voice builds its nodes, schedules itself at an absolute `ctx.currentTime` offset,
and disconnects on `ended` so nothing accumulates over a long session.

## Phase 3 — The musical layer

8. `experiments/lofi/harmony.ts` — pure, no Web Audio import.
   - A hand-picked chord pool in one key, leaning on maj7 / min9 / sus voicings for the
     warmth the genre needs.
   - Weighted selection biased toward stepwise root motion, so it wanders without
     sounding arbitrary.
   - Voicing: three or four notes drawn from the chord, spread over two octaves, with
     nothing but the bass root below about 150 Hz — low thirds are what turn a warm pad
     into mud.
   - Chord duration 8–15 s with jitter, both ends exposed as parameters.
9. `experiments/lofi/drift.ts` — the long-term evolution, also pure.
   - Slow `fbm1D` walks driving filter cutoff, reverb send depth, pad register and bell
     probability, so no two minutes are alike. This reuses `src/core/rng.ts`
     (`mulberry32`, `fbm1D`) rather than adding new noise code — it is already the house
     tool for exactly this.
   - **Dropouts.** A section state machine that periodically drops the bass, the bells,
     or everything but a single sustained pad note, then brings them back. Voices fade
     out through their natural release rather than cutting. This is the single most
     valuable thing in the file: drone's failure mode is not sounding bad, it is
     sounding static, and silence is what resets the ear.
10. `experiments/lofi/engine.ts` — the scheduler. Same two-clock pattern as
    `src/audio/ambience.ts`: a `setInterval` pump (~500 ms) queueing every event that
    falls inside a ~4 s lookahead window, at absolute context times. The pump interval
    stays comfortably shorter than the lookahead so a delayed timer never leaves a gap.
    Also owns start, stop and parameter updates.

## Phase 4 — Judge it

A gate, not a task. Listen for ten minutes or more, since the dropouts and drift only
reveal themselves over that scale. Note the seeds worth revisiting. Expect to reject the
first version — with no reference track and no sliders, the first attempt is a
calibration shot rather than a candidate.

Phase 5 begins only once something here is worth keeping.

## Phase 5 — Mixer, and per-channel volume and mute

Today `Ambience` creates its own `AudioContext` and owns its own master gain. Adding
music that way would mean two contexts, two unlock handlers, and no coherent place to
put a master mute. So the port starts by extracting the bus.

11. **`src/audio/mixer.ts`** — owns the single `AudioContext`, the unlock-on-first-
    gesture logic currently inside `Ambience.unlockOn`, and a named channel per source.

    ```ts
    export interface Channel {
      readonly input: GainNode      // sources connect here
      setVolume(v: number): void
      setMuted(m: boolean): void
      readonly muted: boolean
    }

    export class Mixer {
      readonly ctx: AudioContext
      channel(name: 'ambience' | 'music'): Channel
      unlockOn(target?: EventTarget): void
      setMasterMuted(m: boolean): void
    }
    ```

    Each channel is a `GainNode` into a master `GainNode` into the destination. Target
    gain is `muted ? 0 : volume`, applied with `setTargetAtTime` so neither a slider drag
    nor a mute toggle ever clicks. Volume and mute stay separate values, so unmuting
    restores the slider position rather than jumping to full.

12. **Refactor `src/audio/ambience.ts`** to take a `Channel` instead of building its own
    context and master gain. Its crossfading scheduler is unchanged; it loses roughly the
    top third of the file. `refreshVolume` and `toggleMute` move to the channel.

13. **Move the engine** — `git mv experiments/lofi/*` into `src/audio/music/`, leaving
    the experiment page behind pointed at the new location, so the experiment stays
    runnable for future tuning.

14. **Config** — `src/sim/config.ts` `audio` block becomes:

    ```ts
    audio: {
      masterVolume: number
      ambienceVolume: number
      ambienceMuted: boolean
      musicVolume: number
      musicMuted: boolean
      crossfadeSeconds: number
      music: MusicParams        // brightness, density, warmth, root, chordSeconds…
    }
    ```

    `audio.volume` becomes `audio.ambienceVolume`. This is safe against saved configs:
    `mergeInto` in `src/ui/tuning.ts` only merges when both sides are the same kind, so
    a stale `audio.volume` from localStorage is silently ignored and the slider falls
    back to its default once.

    **One real gotcha:** `mergeInto` handles numbers and objects but not booleans, and
    `writePath` is typed `value: number`. Mute state will not persist until both are
    widened — about three lines each. Worth doing; a player who mutes the music expects
    it to stay muted across a reload.

15. **Tuning panel** — `src/ui/tuning.ts` currently supports sliders only. Add a toggle
    row type alongside `SliderSpec` so mutes are real checkboxes rather than 0/1
    sliders. The `Ambience` section becomes `Audio`:

    - master volume, ambience volume, ambience mute
    - music volume, music mute
    - the `MusicParams` sliders, so the music is tunable in the game even though the
      standalone harness has no sliders

16. **Keys** — `M` currently toggles ambience mute. It becomes master mute, which is
    what existing muscle memory expects it to do now that there is more than one source.
    Per-channel mutes live in the tuning panel. *Open choice:* whether music also gets a
    direct binding such as `Shift+M`; the panel alone satisfies the requirement.

17. **`src/main.ts`** — construct the `Mixer`, hand `Ambience` and `MusicEngine` their
    channels, extend the existing `onChange` hook (`path.startsWith('audio.')`) to route
    volume, mute and music-parameter changes to the right place.

18. **HUD** — a small mute indicator in `src/ui/hud.ts`, so a muted channel is visible
    rather than mysterious. Minor, and the only item here that is cosmetic.

## Files

```
plan-music.md                        this file
experiments/lofi/index.html          play/stop, seed readout
experiments/lofi/main.ts             page wiring, seed from URL, gesture unlock
experiments/lofi/params.ts           MusicParams, defaults, beach preset
experiments/lofi/engine.ts           lookahead scheduler, voice ownership
experiments/lofi/harmony.ts          chord pool, selection, voicing   (pure)
experiments/lofi/drift.ts            long LFOs, section and dropout logic  (pure)
experiments/lofi/fx.ts               generated-IR reverb, wow/flutter, tone, hiss
experiments/lofi/voices/pad.ts       detuned oscillator stack
experiments/lofi/voices/bass.ts      filtered sub root
experiments/lofi/voices/bell.ts      FM pair, fast decay

src/audio/mixer.ts                   phase 5: context, channels, master mute
src/audio/music/                     phase 5: destination of the git mv
src/audio/ambience.ts                phase 5: refactored onto a Channel
src/sim/config.ts                    phase 5: audio block
src/ui/tuning.ts                     phase 5: toggle rows, Audio section, boolean merge
src/ui/hud.ts                        phase 5: mute indicator
src/main.ts                          phase 5: wiring
```

## Verification

- `npm run typecheck` and `npm run sanity` clean at every phase.
- Phases 1–3 change nothing reachable from `src/main.ts`; confirm with `npm run build`
  that the game bundle size is unmoved.
- Long-run listen: ten minutes minimum, watching for node accumulation in the dev tools
  performance panel — a voice that fails to disconnect is the likely bug and it grows
  silently.
- Phase 5: mute each channel independently, drag each volume while the other plays,
  reload with both muted and confirm the state survives.

## Deliberately out of scope

- Any reaction to the kite, wind, or line tension.
- Drums, tempo, or anything requiring a beat grid.
- Scene presets beyond `beach`. The parameter interface makes them cheap to add; there
  is no second scene yet to design against.
- Mobile and touch.

## Risks

1. **"Music leads" reopens two earlier calls.** Hiss and a filtered-noise air layer were
   both argued down on the grounds that the surf already occupies that band. If the surf
   recedes to texture, that argument weakens, and those are exactly where lofi character
   lives. Revisit at phase 4 rather than deciding now.
2. **Light degradation on synth pads may read as "ambient synth", not "lofi".** The
   chosen setting is the conservative one. If the lofi identity specifically matters,
   degradation is the dial to turn up, and phase 4 is where that becomes audible.
3. **"Music leads" and "it must sit under the sea and gulls" are in mild tension.** The
   balance will not fall out naturally. Phase 5 may need the ambience channel ducked
   while music plays — the `Mixer` makes that a few lines, but it is a design decision
   not yet made.
4. **The play-button harness is the main threat to the schedule.** Generative drone
   reveals itself over minutes, so each iteration is an edit, a reload and a long wait.
   Phase 5 step 15 puts `MusicParams` sliders in the game's tuning panel; if phase 4
   drags, pulling that panel work forward into the experiment is the cheapest available
   fix.
5. **Voice cleanup.** Long sessions with sparse bell voices are where leaked nodes hide.
   Every voice disconnects on `ended`, and the long-run listen in Verification exists
   specifically to catch it.

---

# Addendum — recorded tracks alongside the generator

Seven lofi mp3s sit in `public/assets/music/` (~2 minutes each, 28 MB total). They are
to be playable in the game as an *alternative* to the generator, decided at runtime.

## Why this does not disturb the generator

Because of the two rules at the top of this document, it costs nothing. The generator's
only contact with the rest of the audio system is its constructor — a context and a
destination node. A track player implements the same contract. They are siblings hanging
off `Mixer.channel('music')`, neither aware the other exists, and everything above the
channel input — volume, mute, master mute, the `M` key, the panel rows — is written once
and serves both.

So this is not a second subsystem. It is a **source selector** on the existing channel:

```ts
audio.musicSource: 'off' | 'generated' | 'tracks'
```

Switching fades the outgoing source down and the incoming one up through the same
channel gain. They never play together, which is deliberate: beat-driven Rhodes lofi
over a tempo-less drone is mud, and both were designed to sit under the same surf bed.
`'generated'` is in the type from the start but absent from the panel until phase 4
passes — an option that does nothing is worse than no option.

## Reordering: this is built first

The track player depends on step 11 (`Mixer`) and on nothing else — not on phases 1–4,
not on the listening gate. Building it first inverts the project's risk. As originally
ordered, the game has no music at all until a synthesis experiment survives a subjective
judgement that it is explicitly expected to fail the first time. Built first, there is
music in the game either way, and the generator becomes an addition to a working audio
stage rather than the thing the whole feature waits on.

It also means the `Mixer` is exercised by two real sources before the engine ports onto
it, which is the only way to find out whether the channel abstraction is the right one.

## Streaming, not decoding

`decodeAudioData` is wrong here. A 2-minute stereo track decodes to roughly 46 MB of
float32; seven would be catastrophic. Use `<audio>` plus `ctx.createMediaElementSource`
into the channel input — it streams, costs almost nothing resident, and starts fast.

`Ambience` earns its `decodeAudioData` because it needs sample-accurate overlapping
passes to hide the seam in an endlessly repeating 75-second clip. A playlist has no such
problem: it crossfades between *different* tracks, where nobody can hear a seam that
isn't there. Two decks and a gain each is the whole mechanism.

Constraints worth knowing before touching the file:

- `createMediaElementSource` may be called only once per element, so decks own their
  elements for their lifetime and a new track means a new element.
- It also yields silence for a cross-origin element. These are same-origin out of
  `public/`, so `crossOrigin` stays unset — setting it would force a CORS preflight
  that the dev server has no reason to satisfy.
- Once an element is routed into the graph its own `volume` is bypassed. All level
  control is `GainNode`s.

## Steps

Renumbering phase 5, with the mp3 path folded in. 11, 12, 14, 15 and 16 are unchanged in
intent from above; they simply happen now rather than after phase 4.

11. **`src/audio/mixer.ts`** — as specified above. Owns the one `AudioContext`, the
    unlock-on-first-gesture logic lifted out of `Ambience`, the master gain and the
    opening fade, and a named `Channel` per source.
12. **Refactor `src/audio/ambience.ts`** to take `(ctx, destination)` and lose its
    context, master gain, unlock handler, volume and mute. Fixes a latent bug in
    passing: today, if the first gesture lands before the 2.3 MB clip finishes
    downloading, `start()` returns early on the missing buffer and the bed never plays
    at all. Unlock and load become two separate conditions, and whichever arrives second
    starts the bed.
13. **`src/audio/tracks.ts`** — the deck pair, the shuffled playlist, and the crossfade.
    Shuffle reshuffles each pass and swaps the head if it would repeat the track that
    just played. A ~250 ms pump watches the active deck's remaining time, preloads the
    next deck a few seconds before it is needed, then crossfades. `ended` and `error`
    listeners are backstops for a deck whose clock stops advancing; a run of failures as
    long as the playlist stops the player rather than spinning through it.
14. **Config** — `audio.volume` becomes `audio.ambienceVolume`, joined by master,
    music and mute fields and `trackCrossfadeSeconds`. Safe against saved configs:
    `mergeInto` ignores a key the live config no longer has.
15. **Tuning panel** — `Ambience` becomes `Audio`. `sliders` becomes `rows`, and rows
    gain toggle and select kinds discriminated structurally, so no existing spec is
    touched. `mergeInto` and `writePath` widen to booleans and strings — the gotcha
    flagged above — and a saved select value outside its option list is discarded rather
    than trusted.
16. **Keys** — `M` becomes master mute. Per-channel mutes live in the panel.

## Licensing

Phase 2's case for pure synthesis included "removes the licensing question entirely".
Shipping recordings reintroduces it. The filenames follow the Pixabay convention of
artist slug plus numeric id, the same as the surf bed already shipping in
`public/assets/sounds/`, which would make them usable here — but that should be
confirmed and the provenance recorded somewhere in the repo before release, not at it.

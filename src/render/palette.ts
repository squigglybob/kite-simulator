/**
 * Single source of truth for every colour in the game.
 *
 * Every value here is drawn from **Resurrect 64**, the palette the generated beach and
 * prop art was made in. Sharing one palette between the procedural scenery and the
 * bitmaps is what lets them sit in the same picture: the sea and sand below are the
 * asset's own colours, the sky and headlands above are drawn in code, and nothing
 * betrays which is which.
 *
 * Nothing outside this file should contain a hex literal. Re-directing the art
 * ("make the kite red", "warmer sand") is a change here and nowhere else.
 */

/** Resurrect 64, in palette order. Generated art is quantised against this. */
export const RESURRECT64: readonly string[] = [
  '#2e222f', '#3e3546', '#625565', '#966c6c', '#ab947a', '#694f62', '#7f708a', '#9babb2',
  '#c7dcd0', '#ffffff', '#6e2727', '#b33831', '#ea4f36', '#f57d4a', '#ae2334', '#e83b3b',
  '#fb6b1d', '#f79617', '#f9c22b', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#fbb954',
  '#4c3e24', '#676633', '#a2a947', '#d5e04b', '#fbff86', '#165a4c', '#239063', '#1ebc73',
  '#91db69', '#cddf6c', '#313638', '#374e4a', '#547e64', '#92a984', '#b2ba90', '#0b5e65',
  '#0b8a8f', '#0eaf9b', '#30e1b9', '#8ff8e2', '#323353', '#484a77', '#4d65b4', '#4d9be6',
  '#8fd3ff', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded', '#753c54', '#a24b6f',
  '#cf657f', '#ed8099', '#831c5d', '#c32454', '#f04f78', '#f68181', '#fca790', '#fdcbb0',
]

export const C = {
  // Sky, zenith through to horizon haze. The lower stops are the same blues the beach
  // asset uses for its water, so the join at the horizon reads as one scene. Kept off
  // the palette's navies: those are dusk colours and fight a sunlit beach.
  sky0: '#4d65b4',
  sky1: '#4d9be6',
  sky2: '#8fd3ff',
  sky3: '#c7dcd0',

  // Sea. Used where the beach bitmap does not reach.
  sea0: '#4d65b4',
  sea1: '#4d9be6',
  sea2: '#0b8a8f',
  seaGlint: '#8fd3ff',

  // Distant land, hazed by atmospheric perspective.
  headlandFar: '#9babb2',
  headlandNear: '#7f708a',

  // Beach and dune, matched to the asset's sand.
  sand0: '#fdcbb0',
  sand1: '#fca790',
  sand2: '#e6904e',
  sandShadow: '#ab947a',

  // Dry marram, the same warm yellows as the prop sheet's grass tufts.
  grass0: '#f9c22b',
  grass1: '#f79617',
  grass2: '#676633',

  cloud: '#ffffff',
  cloudShade: '#c7dcd0',

  ink: '#2e222f',
  hudText: '#ffffff',
  kite: '#e83b3b',
  kiteShade: '#ae2334',
  kiteTrim: '#f9c22b',
  kiteTrimShade: '#f79617',
} as const

export type ColorName = keyof typeof C

/** Zenith-to-horizon ramp. Order matters: index 0 is the top of the sky. */
export const SKY_RAMP: readonly string[] = [C.sky0, C.sky1, C.sky2, C.sky3]

export const PALETTE: readonly string[] = RESURRECT64

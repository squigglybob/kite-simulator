/**
 * Single source of truth for every colour in the game.
 *
 * Nothing outside this file should contain a hex literal. Re-directing the art
 * ("make the kite red", "warmer sand") is a change here and nowhere else.
 * The flat `PALETTE` list is what generated bitmaps get quantised against, so the
 * externally drawn scenery lands in exactly these colours.
 */

export const C = {
  // Sky, zenith through to horizon haze.
  sky0: '#1d4f8f',
  sky1: '#2a66a8',
  sky2: '#3a80c0',
  sky3: '#5a9ed6',
  sky4: '#84bde8',
  sky5: '#b3d9f2',
  sky6: '#d9ecf7',

  // Sea.
  sea0: '#1f4f78',
  sea1: '#2a628f',
  sea2: '#3b7aa8',
  seaGlint: '#8fc4de',

  // Distant land, hazed by atmospheric perspective.
  headlandFar: '#8ea3b8',
  headlandNear: '#6b8099',

  // Beach and dune.
  sand0: '#e8d5ab',
  sand1: '#d8c091',
  sand2: '#bda478',
  sandShadow: '#a68d63',

  // Marram and dune grass.
  grass0: '#7ea25c',
  grass1: '#5f8442',
  grass2: '#44602f',

  cloud: '#f2f6f8',
  cloudShade: '#cfdde8',

  ink: '#22252e',
  hudText: '#eaf2f7',
  kite: '#d94f3d',
  kiteShade: '#9c3529',
  kiteTrim: '#f2c14e',
  kiteTrimShade: '#ac8735',
} as const

export type ColorName = keyof typeof C

/** Zenith-to-horizon ramp. Order matters: index 0 is the top of the sky. */
export const SKY_RAMP: readonly string[] = [
  C.sky0,
  C.sky1,
  C.sky2,
  C.sky3,
  C.sky4,
  C.sky5,
  C.sky6,
]

export const PALETTE: readonly string[] = Object.values(C)

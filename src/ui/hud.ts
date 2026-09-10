import { config } from '../sim/config'
import { C } from '../render/palette'
import type { World } from '../sim/world'

/**
 * Phase 1 HUD: flight instruments, weighted toward what is needed to judge whether the
 * physics is behaving. It gets replaced by the real player-facing HUD in phase 5.
 */

const DEG = 180 / Math.PI

export function drawHud(
  ctx: CanvasRenderingContext2D,
  world: World,
  fps: number,
  zoom: number,
): void {
  const { kite, flyer, stats } = world
  const d = kite.diag

  ctx.font = '8px monospace'
  ctx.textBaseline = 'top'

  const left = [
    `line    ${config.line.length.toFixed(1)} m`,
    `alt     ${kite.pos.y.toFixed(1)} m`,
    `elev    ${(d.elevation * DEG).toFixed(0)} deg`,
    `azim    ${(d.azimuth * DEG).toFixed(0)} deg`,
    `aoa     ${(d.alpha * DEG).toFixed(1)} deg${d.stalled ? '  STALL' : ''}`,
    `tension ${d.line.tension.toFixed(1)} N`,
    `air     ${d.airspeed.toFixed(1)} m/s`,
    `roll    ${(d.roll * DEG).toFixed(0)} deg`,
  ]

  const right = [
    `${fps} fps  x${zoom}`,
    `best  ${stats.maxAltitude.toFixed(1)} m`,
    `aloft ${stats.timeAloft.toFixed(0)} s`,
    `crash ${stats.crashes}`,
  ]

  ctx.fillStyle = C.hudText
  left.forEach((line, i) => ctx.fillText(line, 4, 4 + i * 9))

  ctx.textAlign = 'right'
  right.forEach((line, i) => ctx.fillText(line, ctx.canvas.width - 4, 4 + i * 9))
  ctx.textAlign = 'left'

  drawHandMeters(ctx, flyer.leftDraw, flyer.rightDraw)
}

/** Two bars showing each hand's draw, so the spring-loaded keys are legible. */
function drawHandMeters(
  ctx: CanvasRenderingContext2D,
  leftDraw: number,
  rightDraw: number,
): void {
  const width = 40
  const height = 4
  const y = ctx.canvas.height - 10
  const centre = ctx.canvas.width / 2

  const bar = (x: number, value: number) => {
    ctx.fillStyle = C.ink
    ctx.fillRect(x, y, width, height)
    ctx.fillStyle = C.kiteTrim
    ctx.fillRect(x, y, Math.round(width * value), height)
  }

  bar(centre - width - 6, leftDraw)
  bar(centre + 6, rightDraw)
}

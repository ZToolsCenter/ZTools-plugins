import { COLS, ROWS } from '../constants/game'
import { BLOCK_SIZE } from '../constants/game'

// Mutable block size — updated by engine for responsive sizing
let currentBlockSize = BLOCK_SIZE

export function setBlockSize(px: number) {
  currentBlockSize = px
}

// ============================================================
//  THEME DEFINITIONS
// ============================================================

export interface ThemeDrawFunctions {
  colors: string[]
  glowColors?: string[]
  canvasBg: string
  drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, glowColor?: string, isGlow?: boolean): void
  drawGrid(ctx: CanvasRenderingContext2D): void
  drawGhost(ctx: CanvasRenderingContext2D, shape: number[][], piece: { x: number; y: number; colorIndex?: number }): void
  drawNextBlock(ctx: CanvasRenderingContext2D, bx: number, by: number, color: string, ci?: number): void
}

export type ThemeName = 'neon' | 'modern' | 'retro'

export const THEMES: Record<ThemeName, ThemeDrawFunctions> = {
  neon: {
    colors: ['#00f0ff', '#ffea00', '#ff00ff', '#39ff14', '#ff0050', '#0088ff', '#ff6600'],
    glowColors: [
      'rgba(0,240,255,0.4)', 'rgba(255,234,0,0.4)', 'rgba(255,0,255,0.4)',
      'rgba(57,255,20,0.4)', 'rgba(255,0,80,0.4)', 'rgba(0,136,255,0.4)',
      'rgba(255,102,0,0.4)',
    ],
    canvasBg: '#050510',
    drawBlock(ctx, x, y, color, glowColor?, isGlow?) {
      const bx = x * currentBlockSize, by = y * currentBlockSize
      if (isGlow) {
        ctx.shadowColor = glowColor || 'rgba(0,240,255,0.3)'
        ctx.shadowBlur = 12
        ctx.fillStyle = color
        ctx.fillRect(bx + 1, by + 1, currentBlockSize - 2, currentBlockSize - 2)
        ctx.shadowBlur = 0
      } else {
        ctx.shadowColor = glowColor || 'rgba(0,240,255,0.2)'
        ctx.shadowBlur = 6
        ctx.fillStyle = color
        ctx.fillRect(bx + 1, by + 1, currentBlockSize - 2, currentBlockSize - 2)
        ctx.shadowBlur = 0
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.fillRect(bx + 3, by + 3, currentBlockSize - 8, 3)
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(bx + 2, by + currentBlockSize - 4, currentBlockSize - 4, 2)
      }
    },
    drawGrid(ctx) {
      ctx.strokeStyle = 'rgba(0,240,255,0.15)'
      ctx.lineWidth = 0.5
      for (let x = 0; x <= COLS; x++) {
        ctx.beginPath(); ctx.moveTo(x * currentBlockSize, 0); ctx.lineTo(x * currentBlockSize, ROWS * currentBlockSize); ctx.stroke()
      }
      for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * currentBlockSize); ctx.lineTo(COLS * currentBlockSize, y * currentBlockSize); ctx.stroke()
      }
    },
    drawGhost(ctx, shape, piece) {
      const ci = piece.colorIndex || 0
      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (shape[y][x]) {
            const bx = (piece.x + x) * currentBlockSize, by = (piece.y + y) * currentBlockSize
            ctx.fillStyle = THEMES.neon.glowColors[ci]
            ctx.shadowColor = THEMES.neon.glowColors[ci]
            ctx.shadowBlur = 20
            ctx.fillRect(bx + 1, by + 1, currentBlockSize - 2, currentBlockSize - 2)
            ctx.shadowBlur = 0
            ctx.fillStyle = 'rgba(255,255,255,0.06)'
            ctx.fillRect(bx + 1, by + 1, currentBlockSize - 2, currentBlockSize - 2)
          }
        }
      }
    },
    drawNextBlock(ctx, bx, by, color, ci) {
      ctx.shadowColor = THEMES.neon.glowColors[ci || 0]
      ctx.shadowBlur = 15
      ctx.fillStyle = color
      ctx.fillRect(bx + 1, by + 1, currentBlockSize - 2, currentBlockSize - 2)
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(bx + 3, by + 3, currentBlockSize - 8, 3)
    },
  },

  modern: {
    colors: ['#6bd4d4', '#f5d76e', '#b07cc9', '#7ec8a0', '#e8836b', '#6ba8d9', '#e8a86b'],
    canvasBg: '#ffffff',
    drawBlock(ctx, x, y, color) {
      const bx = x * currentBlockSize, by = y * currentBlockSize
      const pad = 1, radius = 4, w = currentBlockSize - pad * 2, h = currentBlockSize - pad * 2
      ctx.shadowColor = 'rgba(0,0,0,0.08)'
      ctx.shadowBlur = 4; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1
      ctx.beginPath()
      ctx.moveTo(bx + pad + radius, by + pad)
      ctx.lineTo(bx + pad + w - radius, by + pad)
      ctx.quadraticCurveTo(bx + pad + w, by + pad, bx + pad + w, by + pad + radius)
      ctx.lineTo(bx + pad + w, by + pad + h - radius)
      ctx.quadraticCurveTo(bx + pad + w, by + pad + h, bx + pad + w - radius, by + pad + h)
      ctx.lineTo(bx + pad + radius, by + pad + h)
      ctx.quadraticCurveTo(bx + pad, by + pad + h, bx + pad, by + pad + h - radius)
      ctx.lineTo(bx + pad, by + pad + radius)
      ctx.quadraticCurveTo(bx + pad, by + pad, bx + pad + radius, by + pad)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.moveTo(bx + pad + radius + 2, by + pad + 2)
      ctx.lineTo(bx + pad + w - radius - 2, by + pad + 2)
      ctx.quadraticCurveTo(bx + pad + w - 2, by + pad + 2, bx + pad + w - 2, by + pad + radius + 2)
      ctx.lineTo(bx + pad + w - 2, by + pad + 6)
      ctx.lineTo(bx + pad + 2, by + pad + 6)
      ctx.lineTo(bx + pad + 2, by + pad + radius + 2)
      ctx.quadraticCurveTo(bx + pad + 2, by + pad + 2, bx + pad + radius + 2, by + pad + 2)
      ctx.closePath()
      ctx.fill()
    },
    drawGrid(ctx) {
      ctx.strokeStyle = '#dce3ec'
      ctx.lineWidth = 0.5
      for (let x = 0; x <= COLS; x++) {
        ctx.beginPath(); ctx.moveTo(x * currentBlockSize, 0); ctx.lineTo(x * currentBlockSize, ROWS * currentBlockSize); ctx.stroke()
      }
      for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * currentBlockSize); ctx.lineTo(COLS * currentBlockSize, y * currentBlockSize); ctx.stroke()
      }
    },
    drawGhost(ctx, shape, piece) {
      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (shape[y][x]) {
            const bx = (piece.x + x) * currentBlockSize + 1, by = (piece.y + y) * currentBlockSize + 1
            ctx.fillStyle = 'rgba(74,144,217,0.12)'
            ctx.beginPath()
            ctx.roundRect(bx, by, currentBlockSize - 2, currentBlockSize - 2, 4)
            ctx.fill()
          }
        }
      }
    },
    drawNextBlock(ctx, bx, by, color) {
      ctx.shadowColor = 'rgba(0,0,0,0.06)'
      ctx.shadowBlur = 3; ctx.shadowOffsetY = 1
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(bx + 1, by + 1, currentBlockSize - 2, currentBlockSize - 2, 3)
      ctx.fill()
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
    },
  },

  retro: {
    colors: ['#6bf06b', '#f0d060', '#f060f0', '#60f060', '#f06060', '#6060f0', '#f0a040'],
    canvasBg: '#0a0a14',
    drawBlock(ctx, x, y, color) {
      const bx = x * currentBlockSize, by = y * currentBlockSize
      const s = currentBlockSize
      ctx.fillStyle = color
      ctx.fillRect(bx + 1, by + 1, s - 2, s - 2)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(bx + 2, by + 2, s - 6, 2)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(bx + s - 2, by + 1, 1, s - 2)
      ctx.fillRect(bx + 1, by + s - 2, s - 2, 1)
    },
    drawGrid(ctx) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 0.5
      for (let x = 0; x <= COLS; x++) {
        ctx.beginPath(); ctx.moveTo(x * currentBlockSize, 0); ctx.lineTo(x * currentBlockSize, ROWS * currentBlockSize); ctx.stroke()
      }
      for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * currentBlockSize); ctx.lineTo(COLS * currentBlockSize, y * currentBlockSize); ctx.stroke()
      }
    },
    drawGhost(ctx, shape, piece) {
      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (shape[y][x]) {
            const bx = (piece.x + x) * currentBlockSize, by = (piece.y + y) * currentBlockSize
            ctx.fillStyle = 'rgba(255,255,255,0.04)'
            ctx.fillRect(bx + 2, by + 2, currentBlockSize - 4, currentBlockSize - 4)
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'
            ctx.lineWidth = 1
            ctx.setLineDash([3, 3])
            ctx.strokeRect(bx + 1, by + 1, currentBlockSize - 2, currentBlockSize - 2)
            ctx.setLineDash([])
          }
        }
      }
    },
    drawNextBlock(ctx, bx, by, color) {
      const s = currentBlockSize
      ctx.fillStyle = color
      ctx.fillRect(bx + 1, by + 1, s - 2, s - 2)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(bx + 2, by + 2, s - 6, 2)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(bx + s - 2, by + 1, 1, s - 2)
      ctx.fillRect(bx + 1, by + s - 2, s - 2, 1)
    },
  },
}

// Calculate ghost piece Y position
export function getGhostY(shape: number[][], piece: { x: number; y: number }, board: (string | 0)[][]): number {
  let shadowY = piece.y
  // Collision check: see if piece can move down one more row
  while (true) {
    let collides = false
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x]) {
          const nx = piece.x + x
          const ny = shadowY + y + 1
          if (nx < 0 || nx >= COLS || ny >= ROWS) { collides = true; break }
          if (ny >= 0 && board[ny][nx]) { collides = true; break }
        }
      }
      if (collides) break
    }
    if (collides) break
    shadowY++
  }
  return shadowY
}

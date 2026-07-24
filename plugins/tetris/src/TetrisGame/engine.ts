import { COLS, ROWS, SHAPES, type Board } from '../constants/game'
import { THEMES, type ThemeName, getGhostY, setBlockSize as setThemeBlockSize } from './themes'

// ============================================================
//  PIECE
// ============================================================
export class Piece {
  shape: number[][]
  color: string
  colorIndex: number
  x: number
  y: number

  constructor(shape: number[][], color: string, colorIndex: number) {
    this.shape = shape
    this.color = color
    this.colorIndex = colorIndex
    this.x = Math.floor(COLS / 2) - Math.floor(shape[0].length / 2)
    this.y = 0
  }

  rotate() {
    const rotated = this.shape[0].map((_, i) => this.shape.map(row => row[i]).reverse())
    if (!this.collision(0, 0, rotated)) this.shape = rotated
  }

  collision(offsetX: number, offsetY: number, shape: number[][] = this.shape): boolean {
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x]) {
          const nx = this.x + x + offsetX
          const ny = this.y + y + offsetY
          if (nx < 0 || nx >= COLS || ny >= ROWS) return true
          if (ny >= 0 && boardRef[ny][nx]) return true
        }
      }
    }
    return false
  }

  moveDown(): boolean {
    if (!this.collision(0, 1)) { this.y++; return true }
    return false
  }

  moveLeft() {
    if (!this.collision(-1, 0)) this.x--
  }

  moveRight() {
    if (!this.collision(1, 0)) this.x++
  }

  hardDrop() {
    while (!this.collision(0, 1)) this.y++
    this.lock()
  }

  lock() {
    for (let y = 0; y < this.shape.length; y++) {
      for (let x = 0; x < this.shape[y].length; x++) {
        if (this.shape[y][x]) {
          const by = this.y + y
          const bx = this.x + x
          if (by < 0) {
            // Game over condition
            gameOverFlag = true
            return
          }
          boardRef[by][bx] = this.color
        }
      }
    }
    clearLines()
    spawnPiece()
  }
}

// ============================================================
//  MUTABLE STATE (for the engine — the composable syncs to Vue refs)
// ============================================================
let boardRef: Board = []
let currentPiece: Piece | null = null
let nextPiece: Piece | null = null
let gameOverFlag = false

// Block size for responsive rendering (default 30)
let blockSize = 30

// Score tracking
let scoreValue = 0
let dropInterval = 1000

// Callbacks to sync with Vue
let onScoreChange: ((s: number) => void) | null = null
let onGameOverChange: ((g: boolean) => void) | null = null
let onStateChange: (() => void) | null = null

export function setCallbacks(opts: {
  onScoreChange?: (s: number) => void
  onGameOverChange?: (g: boolean) => void
  onStateChange?: () => void
}) {
  if (opts.onScoreChange) onScoreChange = opts.onScoreChange
  if (opts.onGameOverChange) onGameOverChange = opts.onGameOverChange
  if (opts.onStateChange) onStateChange = opts.onStateChange
}

export function getGameOverFlag(): boolean { return gameOverFlag }
export function getCurrentPiece(): Piece | null { return currentPiece }
export function getNextPiece(): Piece | null { return nextPiece }
export function getBoard(): Board { return boardRef }
export function getScore(): number { return scoreValue }
export function getDropInterval(): number { return dropInterval }
export function getBlockSize(): number { return blockSize }

export function setBlockSize(px: number) {
  blockSize = px
  setThemeBlockSize(px)
}

// ============================================================
//  BOARD & PIECE SPAWNING
// ============================================================
export function createBoard() {
  boardRef = Array.from({ length: ROWS }, () => Array(COLS).fill(0) as (0 | string)[])
}

function randomPiece(): Piece {
  const i = Math.floor(Math.random() * SHAPES.length)
  const shapes = SHAPES as unknown as number[][][]
  return new Piece(shapes[i], THEMES[currentThemeName].colors[i], i)
}

export function spawnPiece() {
  currentPiece = nextPiece || randomPiece()
  nextPiece = randomPiece()
  if (currentPiece && currentPiece.collision(0, 0)) {
    gameOverFlag = true
  }
}

// ============================================================
//  LINE CLEARING
// ============================================================
export function clearLines() {
  let cleared = 0
  for (let y = ROWS - 1; y >= 0; y--) {
    if ((boardRef[y] as (string | 0)[]).every(c => c !== 0)) {
      boardRef.splice(y, 1)
      boardRef.unshift(Array(COLS).fill(0))
      cleared++
      y++
    }
  }
  if (cleared > 0) {
    const points = [0, 100, 300, 500, 800]
    scoreValue += points[cleared] || 0
    dropInterval = Math.max(100, 1000 - Math.floor(scoreValue / 1000) * 100)
    onScoreChange?.(scoreValue)
  }
}

// ============================================================
//  DRAWING
// ============================================================
let lastCanvasCtx: CanvasRenderingContext2D | null = null
let lastNextCanvasCtx: CanvasRenderingContext2D | null = null
let currentThemeName: ThemeName = 'modern'

export function setCanvasContexts(ctx: CanvasRenderingContext2D, nextCtx: CanvasRenderingContext2D) {
  lastCanvasCtx = ctx
  lastNextCanvasCtx = nextCtx
}

export function setThemeName(name: ThemeName) {
  currentThemeName = name
}

export function draw() {
  if (!lastCanvasCtx) return
  const ctx = lastCanvasCtx
  const t = THEMES[currentThemeName]

  ctx.fillStyle = t.canvasBg
  ctx.fillRect(0, 0, COLS * blockSize, ROWS * blockSize)

  t.drawGrid(ctx)

  // Guard: boardRef may be empty if createBoard() hasn't been called yet (e.g., resize event before game start)
  if (boardRef.length === 0) return

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (boardRef[y][x]) t.drawBlock(ctx, x, y, boardRef[y][x] as string)
    }
  }

  if (currentPiece && !gameOverFlag) {
    const shape = currentPiece.shape
    const ghostY = getGhostY(shape, currentPiece, boardRef as (string | 0)[][])
    // Draw ghost at ghostY position
    const ghostPiece = { x: currentPiece.x, y: ghostY, colorIndex: currentPiece.colorIndex }
    t.drawGhost(ctx, shape, ghostPiece)

    // Draw active piece with glow for neon theme
    if (currentThemeName === 'neon') {
      for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
          if (shape[y][x]) {
            t.drawBlock(ctx, currentPiece.x + x, currentPiece.y + y, currentPiece.color,
              THEMES.neon.glowColors[currentPiece.colorIndex || 0], true)
          }
        }
      }
    }
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x]) {
          t.drawBlock(ctx, currentPiece.x + x, currentPiece.y + y, currentPiece.color)
        }
      }
    }
  }

  // CRT scanlines for retro
  if (currentThemeName === 'retro') {
    ctx.fillStyle = 'rgba(0,0,0,0.03)'
    for (let i = 0; i < ROWS * 2; i++) {
      ctx.fillRect(0, i * (blockSize / 2), COLS * blockSize, 1)
    }
  }
}

export function drawNextPiece() {
  if (!lastNextCanvasCtx) return
  const ctx = lastNextCanvasCtx
  const t = THEMES[currentThemeName]

  const nextCanvasSize = blockSize * 5
  ctx.fillStyle = t.canvasBg
  ctx.fillRect(0, 0, nextCanvasSize, nextCanvasSize)

  // Draw grid on next-piece canvas
  ctx.strokeStyle = currentThemeName === 'modern' ? '#dce3ec'
    : currentThemeName === 'retro' ? 'rgba(255,255,255,0.06)'
    : 'rgba(0,240,255,0.15)'
  ctx.lineWidth = 0.5
  const gridCount = 5
  for (let i = 0; i <= gridCount; i++) {
    const p = i * blockSize
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, nextCanvasSize); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(nextCanvasSize, p); ctx.stroke()
  }

  if (nextPiece) {
    const shape = nextPiece.shape
    const oxCell = Math.floor((5 - shape[0].length) / 2)
    const oyCell = Math.floor((5 - shape.length) / 2)
    const ox = oxCell * blockSize
    const oy = oyCell * blockSize
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x]) {
          t.drawNextBlock(ctx, ox + x * blockSize, oy + y * blockSize, nextPiece.color, nextPiece.colorIndex || 0)
        }
      }
    }
  }
}

// ============================================================
//  GAME LOOP
// ============================================================
let gameLoopId: number | null = null
let dropCounter = 0
let lastTime = 0
let enginePaused = false

export function setEnginePaused(paused: boolean) {
  enginePaused = paused
  if (!paused) {
    // Resuming — reset timer to avoid instant drop
    lastTime = performance.now()
  }
}

export function isGameLoopRunning(): boolean {
  return gameLoopId !== null
}

export function startGameLoop() {
  if (gameLoopId !== null) cancelAnimationFrame(gameLoopId)
  dropCounter = 0
  enginePaused = false
  lastTime = performance.now()
  gameLoopId = requestAnimationFrame(gameLoopFunction)
}

export function stopGameLoop() {
  if (gameLoopId !== null) {
    cancelAnimationFrame(gameLoopId)
    gameLoopId = null
  }
}

function gameLoopFunction(time: number) {
  if (gameOverFlag) {
    stopGameLoop()
    onGameOverChange?.(true)
    return
  }

  if (enginePaused) {
    // Just keep the loop running, don't advance game state
    lastTime = time
    gameLoopId = requestAnimationFrame(gameLoopFunction)
    return
  }

  const dt = time - lastTime
  lastTime = time
  dropCounter += dt

  if (dropCounter > dropInterval) {
    if (currentPiece && !currentPiece.moveDown()) {
      currentPiece.lock()
      if (gameOverFlag) {
        stopGameLoop()
        onGameOverChange?.(true)
        return
      }
    }
    dropCounter = 0
  }

  draw()
  drawNextPiece()
  gameLoopId = requestAnimationFrame(gameLoopFunction)
}

// ============================================================
//  RESET
// ============================================================
export function resetEngine() {
  stopGameLoop()
  createBoard()
  scoreValue = 0
  gameOverFlag = false
  dropInterval = 1000
  dropCounter = 0
  lastTime = performance.now()
  currentPiece = null
  nextPiece = null
  spawnPiece()
  draw()
  drawNextPiece()
  onScoreChange?.(0)
  onGameOverChange?.(false)
}

// ============================================================
//  GAME OVER OVERLAY
// ============================================================
export function getFinalScore(): number {
  return scoreValue
}

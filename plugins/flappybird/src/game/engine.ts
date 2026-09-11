export type Phase = 'ready' | 'playing' | 'over'

export interface HighScoreStore {
  get: () => number
  set: (score: number) => void
}

interface Bird {
  x: number
  y: number
  vy: number
  rot: number
}

interface Pipe {
  x: number
  gapY: number
  scored: boolean
}

interface Cloud {
  x: number
  y: number
  scale: number
  speed: number
}

const BEST_KEY = 'flappy-best-score'

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

export function createHighScoreStore(): HighScoreStore {
  const readLocal = () => {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0
    } catch {
      return 0
    }
  }

  return {
    get() {
      try {
        const value = window.ztools?.dbStorage?.getItem(BEST_KEY)
        if (typeof value === 'number' && Number.isFinite(value)) return value
        if (typeof value === 'string' && value !== '') return Number(value) || 0
      } catch {
        /* 开发环境或 API 不可用时回退 */
      }
      return readLocal()
    },
    set(score: number) {
      try {
        window.ztools?.dbStorage?.setItem(BEST_KEY, score)
      } catch {
        /* ignore */
      }
      try {
        localStorage.setItem(BEST_KEY, String(score))
      } catch {
        /* ignore */
      }
    }
  }
}

class Sfx {
  private ctx: AudioContext | null = null

  private ensure() {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return null
    if (!this.ctx) this.ctx = new Ctor()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain = 0.08, slide = 0) {
    const ctx = this.ensure()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + duration)
    amp.gain.setValueAtTime(gain, ctx.currentTime)
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.connect(amp)
    amp.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  }

  flap() {
    this.tone(520, 0.09, 'square', 0.05, -220)
  }

  score() {
    this.tone(880, 0.08, 'square', 0.06)
    const ctx = this.ctx
    if (!ctx) return
    setTimeout(() => this.tone(1175, 0.12, 'square', 0.05), 80)
  }

  hit() {
    this.tone(180, 0.22, 'sawtooth', 0.07, -120)
  }
}

export class FlappyGame {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private store: HighScoreStore
  private sfx = new Sfx()
  private raf = 0
  private lastTs = 0
  private running = false
  private dpr = 1
  private w = 0
  private h = 0
  private phase: Phase = 'ready'
  private bird: Bird = { x: 0, y: 0, vy: 0, rot: 0 }
  private pipes: Pipe[] = []
  private clouds: Cloud[] = []
  private score = 0
  private best = 0
  private groundX = 0
  private spawnAcc = 0
  private bobT = 0
  private flash = 0
  private overDelay = 0
  private onResize: () => void
  private onPointer: (e: PointerEvent) => void
  private onKey: (e: KeyboardEvent) => void
  private onVis: () => void
  private onMenu: (e: Event) => void
  private ro: ResizeObserver | null = null

  constructor(canvas: HTMLCanvasElement, store: HighScoreStore = createHighScoreStore()) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D 不可用')
    this.canvas = canvas
    this.ctx = ctx
    this.store = store
    this.best = store.get()

    this.onResize = () => this.resize()
    this.onPointer = (e) => {
      e.preventDefault()
      this.interact()
    }
    this.onKey = (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') {
        e.preventDefault()
        this.interact()
      }
    }
    this.onVis = () => {
      if (document.hidden) this.lastTs = 0
    }
    this.onMenu = (e) => e.preventDefault()

    this.resize()
    this.resetReady()
    window.addEventListener('resize', this.onResize)
    canvas.addEventListener('pointerdown', this.onPointer)
    canvas.addEventListener('contextmenu', this.onMenu)
    window.addEventListener('keydown', this.onKey)
    document.addEventListener('visibilitychange', this.onVis)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas.parentElement ?? canvas)
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastTs = 0
    const loop = (ts: number) => {
      if (!this.running) return
      const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 1 / 60
      this.lastTs = ts
      this.update(dt)
      this.draw(ts / 1000)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  destroy() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointerdown', this.onPointer)
    this.canvas.removeEventListener('contextmenu', this.onMenu)
    window.removeEventListener('keydown', this.onKey)
    document.removeEventListener('visibilitychange', this.onVis)
  }

  resize() {
    const parent = this.canvas.parentElement ?? this.canvas
    const rect = parent.getBoundingClientRect()
    const dpr = Math.min(2.5, window.devicePixelRatio || 1)
    const w = Math.max(280, Math.floor(rect.width) || 280)
    const h = Math.max(360, Math.floor(rect.height) || 360)
    if (w === this.w && h === this.h && dpr === this.dpr) return
    this.dpr = dpr
    this.w = w
    this.h = h
    this.canvas.width = Math.floor(this.w * this.dpr)
    this.canvas.height = Math.floor(this.h * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    if (this.phase === 'ready') this.resetReady(false)
  }

  private s() {
    return this.h / 512
  }

  private groundH() {
    return Math.round(86 * this.s())
  }

  private birdR() {
    return 12 * this.s()
  }

  private pipeW() {
    return 58 * this.s()
  }

  private gapH() {
    return 148 * this.s()
  }

  private pipeSpeed() {
    const extra = Math.min(this.score, 40) / 40
    return 168 * this.s() * (1 + extra * 0.35)
  }

  private pipeSpacing() {
    return 260 * this.s()
  }

  private interact() {
    if (this.phase === 'over') {
      if (this.overDelay > 0) return
      this.resetReady()
      return
    }
    this.sfx.flap()
    if (this.phase === 'ready') this.startPlay()
    this.bird.vy = -420 * this.s()
  }

  private resetReady(reseedClouds = true) {
    this.phase = 'ready'
    this.score = 0
    this.pipes = []
    this.spawnAcc = 0
    this.flash = 0
    this.overDelay = 0
    this.bird = {
      x: this.w * 0.28,
      y: this.h * 0.42,
      vy: 0,
      rot: 0
    }
    if (reseedClouds || this.clouds.length === 0) this.seedClouds()
  }

  private startPlay() {
    this.phase = 'playing'
    this.spawnAcc = 0
    this.pipes = []
  }

  private seedClouds() {
    this.clouds = Array.from({ length: 5 }, (_, i) => ({
      x: (this.w / 5) * i + Math.random() * 40,
      y: 24 + Math.random() * (this.h * 0.38),
      scale: 0.65 + Math.random() * 0.7,
      speed: 18 + Math.random() * 22
    }))
  }

  private spawnPipe() {
    const margin = 28 * this.s()
    const gh = this.groundH()
    const gap = this.gapH()
    const minY = margin + gap / 2
    const maxY = this.h - gh - margin - gap / 2
    this.pipes.push({
      x: this.w + 10,
      gapY: minY + Math.random() * Math.max(8, maxY - minY),
      scored: false
    })
  }

  private update(dt: number) {
    const s = this.s()
    const speed = this.pipeSpeed()
    this.groundX = (this.groundX - speed * dt) % (24 * s)
    this.bobT += dt

    for (const cloud of this.clouds) {
      cloud.x -= cloud.speed * s * dt * 0.35
      if (cloud.x < -90) {
        cloud.x = this.w + 40
        cloud.y = 24 + Math.random() * (this.h * 0.38)
      }
    }

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3)
    if (this.overDelay > 0) this.overDelay = Math.max(0, this.overDelay - dt)

    if (this.phase === 'ready') {
      this.bird.y = this.h * 0.42 + Math.sin(this.bobT * 3.2) * 8 * s
      this.bird.rot = 0
      this.bird.vy = 0
      return
    }

    this.bird.vy += 1550 * s * dt
    this.bird.vy = Math.min(this.bird.vy, 720 * s)
    this.bird.y += this.bird.vy * dt
    const targetRot = Math.max(-0.55, Math.min(1.25, this.bird.vy / (480 * s)))
    this.bird.rot += (targetRot - this.bird.rot) * Math.min(1, dt * 8)

    const gh = this.groundH()
    const r = this.birdR()
    if (this.bird.y < r) {
      this.bird.y = r
      this.bird.vy = 0
    }

    if (this.phase === 'playing') {
      if (this.pipes.length === 0) {
        this.spawnAcc += dt
        if (this.spawnAcc >= 0.65) this.spawnPipe()
      } else {
        const last = this.pipes[this.pipes.length - 1]
        if (last.x < this.w - this.pipeSpacing()) this.spawnPipe()
      }
      for (const pipe of this.pipes) pipe.x -= speed * dt
      this.pipes = this.pipes.filter((p) => p.x + this.pipeW() > -20)

      for (const pipe of this.pipes) {
        if (!pipe.scored && pipe.x + this.pipeW() < this.bird.x) {
          pipe.scored = true
          this.score += 1
          this.sfx.score()
          if (this.score > this.best) {
            this.best = this.score
            this.store.set(this.best)
          }
        }
      }

      if (this.hitsPipe() || this.bird.y + r >= this.h - gh) {
        this.die()
      }
    } else if (this.phase === 'over') {
      if (this.bird.y + r >= this.h - gh) {
        this.bird.y = this.h - gh - r
        this.bird.vy = 0
        this.bird.rot = Math.min(this.bird.rot + dt * 4, 1.35)
      }
    }
  }

  private hitsPipe() {
    const r = this.birdR() * 0.78
    const bx = this.bird.x
    const by = this.bird.y
    const pw = this.pipeW()
    const gap = this.gapH()
    for (const pipe of this.pipes) {
      const left = pipe.x
      const right = pipe.x + pw
      if (bx + r < left || bx - r > right) continue
      const top = pipe.gapY - gap / 2
      const bottom = pipe.gapY + gap / 2
      if (by - r < top || by + r > bottom) return true
    }
    return false
  }

  private die() {
    if (this.phase !== 'playing') return
    this.phase = 'over'
    this.flash = 1
    this.overDelay = 0.45
    this.sfx.hit()
  }

  private draw(t: number) {
    const ctx = this.ctx
    const { w, h } = this
    const s = this.s()
    ctx.clearRect(0, 0, w, h)

    this.drawSky(ctx, w, h)
    this.drawClouds(ctx)
    this.drawCity(ctx, w, h)
    this.drawPipes(ctx)
    this.drawGround(ctx, w, h, s)
    this.drawBird(ctx, t, s)

    if (this.phase !== 'over') this.drawScore(ctx, w, s)
    if (this.phase === 'ready') this.drawReady(ctx, w, h, s)
    if (this.phase === 'over') this.drawOver(ctx, w, h, s)

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.65})`
      ctx.fillRect(0, 0, w, h)
    }
  }

  private drawSky(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#70d5de')
    g.addColorStop(0.55, '#4ec0ca')
    g.addColorStop(1, '#5dc8d0')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  private drawClouds(ctx: CanvasRenderingContext2D) {
    for (const c of this.clouds) {
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.scale(c.scale, c.scale)
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      this.cloud(ctx, 0, 0)
      ctx.restore()
    }
  }

  private cloud(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.beginPath()
    ctx.arc(x, y, 16, 0, Math.PI * 2)
    ctx.arc(x + 18, y - 8, 20, 0, Math.PI * 2)
    ctx.arc(x + 40, y, 16, 0, Math.PI * 2)
    ctx.arc(x + 22, y + 6, 14, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawCity(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const base = h - this.groundH()
    ctx.fillStyle = '#d5f4f6'
    ctx.beginPath()
    ctx.moveTo(0, base)
    const step = 36 * this.s()
    for (let x = 0, i = 0; x < w + step; x += step, i++) {
      const bh = (18 + ((i * 17) % 42)) * this.s()
      ctx.lineTo(x, base - bh)
      ctx.lineTo(x + step * 0.72, base - bh)
    }
    ctx.lineTo(w, base)
    ctx.closePath()
    ctx.fill()
  }

  private drawPipes(ctx: CanvasRenderingContext2D) {
    const pw = this.pipeW()
    const gap = this.gapH()
    const gh = this.groundH()
    const cap = 8 * this.s()
    for (const pipe of this.pipes) {
      const topH = pipe.gapY - gap / 2
      const botY = pipe.gapY + gap / 2
      this.pipeSegment(ctx, pipe.x, 0, pw, topH, cap, true)
      this.pipeSegment(ctx, pipe.x, botY, pw, this.h - gh - botY, cap, false)
    }
  }

  private pipeSegment(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    cap: number,
    isTop: boolean
  ) {
    if (h <= 0) return
    const body = '#59bf2b'
    const dark = '#3e8e1b'
    const light = '#9ae84d'
    const lip = 6 * this.s()
    ctx.fillStyle = body
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = light
    ctx.fillRect(x + 6 * this.s(), y, 7 * this.s(), h)
    ctx.fillStyle = dark
    ctx.fillRect(x + w - 8 * this.s(), y, 8 * this.s(), h)
    ctx.strokeStyle = '#2f6b14'
    ctx.lineWidth = 2 * this.s()
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)

    const capY = isTop ? y + h - cap - lip : y
    const capH = cap + lip
    const capX = x - 4 * this.s()
    const capW = w + 8 * this.s()
    ctx.fillStyle = '#53b427'
    ctx.fillRect(capX, capY, capW, capH)
    ctx.fillStyle = light
    ctx.fillRect(capX + 6 * this.s(), capY, 8 * this.s(), capH)
    ctx.fillStyle = dark
    ctx.fillRect(capX + capW - 10 * this.s(), capY, 10 * this.s(), capH)
    ctx.strokeStyle = '#2f6b14'
    ctx.strokeRect(capX + 1, capY + 1, capW - 2, capH - 2)
  }

  private drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, s: number) {
    const gh = this.groundH()
    const y = h - gh
    ctx.fillStyle = '#ded895'
    ctx.fillRect(0, y, w, gh)
    ctx.fillStyle = '#5ee270'
    ctx.fillRect(0, y, w, 18 * s)
    ctx.fillStyle = '#83e04d'
    ctx.fillRect(0, y, w, 6 * s)
    ctx.strokeStyle = '#543847'
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()

    ctx.fillStyle = '#d4bc6a'
    const tile = 24 * s
    for (let x = this.groundX - tile; x < w + tile; x += tile) {
      ctx.fillRect(x, y + 28 * s, 12 * s, 8 * s)
      ctx.fillRect(x + 10 * s, y + 48 * s, 14 * s, 7 * s)
    }
  }

  private drawBird(ctx: CanvasRenderingContext2D, t: number, s: number) {
    const { bird } = this
    const flap = this.phase === 'over' ? 0 : Math.sin(t * (this.phase === 'playing' ? 22 : 8))
    ctx.save()
    ctx.translate(bird.x, bird.y)
    ctx.rotate(bird.rot)
    ctx.scale(s, s)

    ctx.strokeStyle = '#543847'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'

    ctx.fillStyle = '#f5d54c'
    ctx.beginPath()
    ctx.ellipse(0, 0, 17, 12.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#fff6d8'
    ctx.beginPath()
    ctx.ellipse(3, 4, 10, 6.5, 0.15, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.translate(-4, 1)
    ctx.rotate(-0.25 + flap * 0.45)
    ctx.fillStyle = '#f0c43c'
    ctx.beginPath()
    ctx.ellipse(0, 0, 10, 6.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()

    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.ellipse(8, -4, 5.2, 5.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#2b1d18'
    ctx.beginPath()
    ctx.arc(10, -4, 2.1, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#f2571f'
    ctx.beginPath()
    ctx.moveTo(14, 1)
    ctx.lineTo(26, 3)
    ctx.lineTo(14, 7)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(14, 3.5)
    ctx.lineTo(24, 3)
    ctx.stroke()

    ctx.fillStyle = '#e23b3b'
    ctx.beginPath()
    ctx.ellipse(-8, 2, 3.2, 2.4, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  private drawScore(ctx: CanvasRenderingContext2D, w: number, s: number) {
    this.strokeText(ctx, String(this.score), w / 2, 54 * s, 48 * s, '#fff', '#543847')
  }

  private drawReady(ctx: CanvasRenderingContext2D, w: number, h: number, s: number) {
    this.strokeText(ctx, 'Flappy Bird', w / 2, 118 * s, 36 * s, '#f8d44c', '#543847')
    this.strokeText(ctx, '点击 / 空格 扇翅起飞', w / 2, h - this.groundH() - 48 * s, 18 * s, '#fff', '#543847')
    this.drawHintHand(ctx, this.bird.x + 56 * s, this.bird.y + 28 * s, s)
  }

  private drawHintHand(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    const bounce = Math.sin(this.bobT * 6) * 4 * s
    ctx.save()
    ctx.translate(x, y + bounce)
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#543847'
    ctx.lineWidth = 2 * s
    ctx.beginPath()
    roundRect(ctx, -12 * s, -10 * s, 24 * s, 28 * s, 6 * s)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    roundRect(ctx, -4 * s, -22 * s, 8 * s, 16 * s, 4 * s)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  private drawOver(ctx: CanvasRenderingContext2D, w: number, h: number, s: number) {
    ctx.fillStyle = 'rgba(84, 56, 71, 0.18)'
    ctx.fillRect(0, 0, w, h)

    this.strokeText(ctx, '游戏结束', w / 2, h * 0.22, 34 * s, '#f2571f', '#543847')

    const bw = Math.min(300 * s, w - 48)
    const bh = 176 * s
    const bx = (w - bw) / 2
    const by = h * 0.32
    const pad = 22 * s
    ctx.fillStyle = '#ded4a4'
    ctx.strokeStyle = '#543847'
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    roundRect(ctx, bx, by, bw, bh, 12 * s)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#c4b47a'
    ctx.beginPath()
    roundRect(ctx, bx + 8 * s, by + 8 * s, bw - 16 * s, bh - 16 * s, 8 * s)
    ctx.fill()

    this.drawMedal(ctx, bx + pad + 28 * s, by + bh / 2, s)

    const right = bx + bw - pad
    ctx.save()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${13 * s}px "Trebuchet MS", "Microsoft YaHei", sans-serif`
    ctx.fillStyle = '#e05a2b'
    ctx.fillText('得分', right, by + 36 * s)
    ctx.fillText('最佳', right, by + 100 * s)
    ctx.restore()

    this.strokeText(ctx, String(this.score), right, by + 66 * s, 30 * s, '#fff', '#543847', 'right')
    this.strokeText(ctx, String(this.best), right, by + 130 * s, 30 * s, '#fff', '#543847', 'right')

    this.strokeText(ctx, '点击再来一局', w / 2, by + bh + 48 * s, 18 * s, '#fff', '#543847')
  }

  private drawMedal(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    const medal =
      this.score >= 40 ? '#e8f4ff' : this.score >= 20 ? '#ffd24a' : this.score >= 10 ? '#c0c6d0' : this.score >= 5 ? '#d08a3a' : null
    ctx.save()
    ctx.translate(x, y)
    if (!medal) {
      ctx.strokeStyle = 'rgba(84,56,71,0.35)'
      ctx.lineWidth = 2 * s
      ctx.beginPath()
      ctx.arc(0, 0, 22 * s, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      return
    }
    ctx.fillStyle = medal
    ctx.strokeStyle = '#543847'
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.arc(0, 0, 24 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#543847'
    ctx.beginPath()
    ctx.moveTo(0, -10 * s)
    ctx.lineTo(3 * s, -3 * s)
    ctx.lineTo(10 * s, -3 * s)
    ctx.lineTo(4.5 * s, 2 * s)
    ctx.lineTo(6.5 * s, 9 * s)
    ctx.lineTo(0, 5 * s)
    ctx.lineTo(-6.5 * s, 9 * s)
    ctx.lineTo(-4.5 * s, 2 * s)
    ctx.lineTo(-10 * s, -3 * s)
    ctx.lineTo(-3 * s, -3 * s)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private strokeText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    stroke: string,
    align: CanvasTextAlign = 'center'
  ) {
    ctx.save()
    ctx.font = `800 ${size}px "Trebuchet MS", "Arial Black", "Microsoft YaHei", sans-serif`
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeStyle = stroke
    ctx.lineWidth = Math.max(4, size * 0.16)
    ctx.strokeText(text, x, y)
    ctx.fillStyle = fill
    ctx.fillText(text, x, y)
    ctx.restore()
  }
}

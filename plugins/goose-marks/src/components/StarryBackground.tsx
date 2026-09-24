import { useEffect, useRef } from 'react'

/**
 * StarryBackground（React 版）
 * --------------------------------------------------------------------------
 * 旧版 Vue setup + onMounted/onUnmounted 的 canvas 动画，逐字段移植到
 * useRef + useEffect。所有可变状态（stars/shootingStars/ctx/尺寸）都放在
 * ref 中以避免重渲染，rAF 循环在挂载时启动、卸载时清理。星空彩蛋。
 */
const CORE_STAR_COUNT = 35
const SHOOTING_STAR_PROBABILITY = 0.0015
const STAR_BASE_OPACITY_MIN = 0.1
const STAR_BASE_OPACITY_MAX = 0.6
const ROTATION_SPEED = 0.00001
/** 星空底色：与深色模式默认背景一致，纯色实底，不用渐变 */
const SKY_BASE_STYLE = { backgroundColor: '#262624' }

interface Star {
  x: number
  y: number
  radius: number
  baseOpacity: number
  opacity: number
  twinklePhase: number
  twinkleSpeed: number
}

interface ShootingStar {
  x: number
  y: number
  length: number
  speed: number
  opacity: number
  angle: number
}

export function StarryBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId = 0
    let width = 0
    let height = 0
    let stars: Star[] = []
    let shootingStars: ShootingStar[] = []

    const getPivot = () => ({ x: width / 2, y: height * 4 })

    const initStars = () => {
      stars = []
      for (let index = 0; index < CORE_STAR_COUNT; index++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.5 + 0.5,
          baseOpacity:
            Math.random() * (STAR_BASE_OPACITY_MAX - STAR_BASE_OPACITY_MIN) + STAR_BASE_OPACITY_MIN,
          opacity: 0,
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: Math.random() * 0.02 + 0.005
        })
      }
    }

    const createShootingStar = () => {
      const angle = Math.PI / 4 + (Math.random() - 0.5) * 0.2
      const isTop = Math.random() > 0.5
      const startX = isTop ? Math.random() * width : -50
      const startY = isTop ? -50 : Math.random() * (height / 2)

      shootingStars.push({
        x: startX,
        y: startY,
        length: Math.random() * 80 + 100,
        speed: Math.random() * 1.5 + 2,
        opacity: 1,
        angle
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      const pivot = getPivot()
      const cos = Math.cos(ROTATION_SPEED)
      const sin = Math.sin(ROTATION_SPEED)

      for (const star of stars) {
        const dx = star.x - pivot.x
        const dy = star.y - pivot.y
        star.x = pivot.x + (dx * cos - dy * sin)
        star.y = pivot.y + (dx * sin + dy * cos)

        if (star.x < -50) star.x = width + 50
        if (star.y < -50) star.y = height + 50
        if (star.x > width + 50) star.x = -50

        star.twinklePhase += star.twinkleSpeed
        const twinkle = Math.sin(star.twinklePhase) * 0.3
        star.opacity = Math.max(0, Math.min(1, star.baseOpacity + twinkle))

        ctx.beginPath()
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(200, 220, 255, ${star.opacity})`
        ctx.fill()
      }

      if (Math.random() < SHOOTING_STAR_PROBABILITY) {
        createShootingStar()
      }

      for (let index = shootingStars.length - 1; index >= 0; index--) {
        const shootingStar = shootingStars[index]
        const vx = Math.cos(shootingStar.angle) * shootingStar.speed
        const vy = Math.sin(shootingStar.angle) * shootingStar.speed

        shootingStar.x += vx
        shootingStar.y += vy
        shootingStar.opacity -= 0.004

        if (
          shootingStar.opacity <= 0 ||
          shootingStar.x > width + shootingStar.length ||
          shootingStar.y > height + shootingStar.length
        ) {
          shootingStars.splice(index, 1)
          continue
        }

        const tailX = shootingStar.x - Math.cos(shootingStar.angle) * shootingStar.length
        const tailY = shootingStar.y - Math.sin(shootingStar.angle) * shootingStar.length
        const gradient = ctx.createLinearGradient(shootingStar.x, shootingStar.y, tailX, tailY)

        gradient.addColorStop(0, `rgba(255, 255, 255, ${shootingStar.opacity})`)
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

        ctx.beginPath()
        ctx.moveTo(shootingStar.x, shootingStar.y)
        ctx.lineTo(tailX, tailY)
        ctx.lineWidth = 1.5
        ctx.lineCap = 'round'
        ctx.strokeStyle = gradient
        ctx.stroke()
      }

      animationFrameId = window.requestAnimationFrame(draw)
    }

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight

      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      initStars()
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    window.requestAnimationFrame(() => handleResize())
    draw()

    return () => {
      window.removeEventListener('resize', handleResize)
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none" style={SKY_BASE_STYLE}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  )
}

export default StarryBackground

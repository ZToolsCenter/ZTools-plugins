import { execSync } from 'node:child_process'
import { watch } from 'node:fs'

let timer = null
let isBuilding = false

function build() {
  if (isBuilding) return
  isBuilding = true
  console.log('\n🔨 检测到文件变化，开始构建...\n')
  const start = Date.now()
  try {
    execSync('bun run build', { stdio: 'inherit' })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n✅ 构建完成（${elapsed}s）\n`)
  } catch (e) {
    console.log('\n❌ 构建失败\n')
  } finally {
    isBuilding = false
  }
}

// 初始构建
build()

// 监视 src 目录
watch('src', { recursive: true }, (_eventType, filename) => {
  if (!filename) return
  // 忽略测试文件和类型声明的临时变动
  if (filename.endsWith('.test.ts') || filename.endsWith('.spec.ts')) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(build, 400)
})

// 监视 preload 目录
watch('preload', { recursive: true }, (_eventType, filename) => {
  if (!filename) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(build, 400)
})

// 监视 plugin.json（单文件，fs.watch 直接传文件路径）
watch('plugin.json', (_eventType) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(build, 400)
})

console.log('👀 正在监视 src/、preload/、plugin.json 变化...\n')

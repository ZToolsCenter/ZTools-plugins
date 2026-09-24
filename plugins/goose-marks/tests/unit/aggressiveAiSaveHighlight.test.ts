import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const homeSource = readFileSync(new URL('../../src/views/home/HomePage.tsx', import.meta.url), 'utf8')
const homeStyles = readFileSync(new URL('../../src/views/home/home.css', import.meta.url), 'utf8')

describe('AI 保存完成定位', () => {
  test('新书签本体定位并高亮 3.5 秒', () => {
    expect(homeSource).toContain("target.classList.add('is-ai-save-target')")
    expect(homeSource).toContain('}, 3500)')
    expect(homeSource).toContain('const eased = progress * progress * progress')
    expect(homeStyles).toContain('ag-save-target-highlight 3.5s cubic-bezier(.72,0,1,1)')
    expect(homeStyles).toContain('ag-save-target-flow 3.5s cubic-bezier(.72,0,1,1)')
    expect(homeSource).not.toContain('ag-save-success-card is-highlighted')
  })

  test('提交后回首页后台运行，结果卡悬停时暂停关闭', () => {
    expect(homeSource).toContain('粘贴或提交后立即回首页')
    expect(homeSource).not.toContain('await wait(650)')
    expect(homeSource).not.toContain('完成态稍作停留')
    expect(homeSource).toContain('onPointerEnter={() => clearAggressiveSaveSuccessTimer(notice.id)}')
    expect(homeSource).toContain('onPointerLeave={() => scheduleAggressiveSaveSuccessDismiss(notice.id, 2200)}')
  })

  test('减少动态效果时保留静态定位高亮', () => {
    expect(homeStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(homeStyles).toContain('.goose-home .card.is-ai-save-target,')
    expect(homeStyles).toContain('background:var(--accent-subtle) !important;')
  })
})

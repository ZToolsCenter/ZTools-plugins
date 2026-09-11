import { test, expect, type Page } from '@playwright/test'

/**
 * 窗口模式（uTools 分离窗口）toggle 行为：
 *   - 窗口原本就激活时再次唤起（plugin-enter）→ 调用 outPlugin 收起窗口
 *   - 刚被唤起聚焦（focus 与 enter 间隔极短）→ 视为正常唤起，不收起
 *   - 窗口未激活（已 blur）→ 正常唤起，不收起
 * 通过 addInitScript 注入最小 uTools mock（getWindowType = 'detach'）模拟分离窗口环境。
 */

const ENTER_EVENT = 'goose-marks:plugin-enter'

async function injectDetachUToolsMock(page: Page) {
  await page.addInitScript(() => {
    const calls: number[] = []
    ;(window as unknown as { __outPluginCalls: number[] }).__outPluginCalls = calls
    ;(window as unknown as { __restoreSearchEvents: number[] }).__restoreSearchEvents = []
    window.addEventListener('goose-marks:restore-default-search-input', () => {
      ;(window as unknown as { __restoreSearchEvents: number[] }).__restoreSearchEvents.push(Date.now())
    })
    const base = {
      getWindowType: () => 'detach',
      outPlugin: () => { calls.push(Date.now()); return true },
      getFeatures: () => [],
      setFeature: () => true,
      removeFeature: () => true,
      isDarkColors: () => false,
      dbStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }
    // 兜底：未声明的 API 一律返回 noop，避免 uTools 模式下偶发调用报错
    ;(window as unknown as { utools: unknown }).utools = new Proxy(base, {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
    })
    // e2e 页面焦点不可控，统一固定为「窗口激活」，由 focus/blur 事件驱动时间戳
    document.hasFocus = () => true
  })
}

function dispatchPluginEnter(page: Page) {
  return page.evaluate((eventName) => {
    window.dispatchEvent(new CustomEvent(eventName, { detail: { code: 'bookmarks' } }))
  }, ENTER_EVENT)
}

function readOutPluginCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { __outPluginCalls: number[] }).__outPluginCalls.length)
}

function readRestoreSearchEvents(page: Page) {
  return page.evaluate(() => (window as unknown as { __restoreSearchEvents: number[] }).__restoreSearchEvents.length)
}

test.beforeEach(async ({ page }) => {
  await injectDetachUToolsMock(page)
  await page.goto('/')
  await expect(page.getByPlaceholder('搜索书签…')).toBeVisible()
})

test('分离窗口使用页内搜索，不恢复 uTools subInput', async ({ page }) => {
  await expect(page.locator('.goose-home')).toHaveAttribute('data-search-surface', 'inline')
  expect(await readRestoreSearchEvents(page)).toBe(0)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await expect(page.getByPlaceholder('搜索书签…')).toBeFocused()
})

test('分离窗口已激活时再次唤起 → outPlugin 收起', async ({ page }) => {
  // 模拟窗口早已激活：focus 发生在足够久之前（超过 grace 间隔）
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(700)

  await dispatchPluginEnter(page)
  expect(await readOutPluginCalls(page)).toBe(1)
})

test('刚被唤起聚焦（focus 与 enter 间隔极短）→ 不收起', async ({ page }) => {
  await page.waitForTimeout(700)
  // uTools 唤起流程：先聚焦窗口、随后立刻送达 plugin-enter
  await page.evaluate((eventName) => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new CustomEvent(eventName, { detail: { code: 'bookmarks' } }))
  }, ENTER_EVENT)
  expect(await readOutPluginCalls(page)).toBe(0)
})

test('窗口未激活（blur 后）唤起 → 不收起', async ({ page }) => {
  await page.evaluate(() => {
    document.hasFocus = () => false
    window.dispatchEvent(new Event('blur'))
  })
  await page.waitForTimeout(700)

  await dispatchPluginEnter(page)
  expect(await readOutPluginCalls(page)).toBe(0)
})

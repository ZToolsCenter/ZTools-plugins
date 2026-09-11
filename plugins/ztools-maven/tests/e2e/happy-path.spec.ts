import { test, expect } from '@playwright/test'

/**
 * NOTE on stub reuse:
 * `tests/helpers/ztools-stub.ts` is a Vitest module that imports `vi`.
 * Playwright runs the app in a real browser context — `vi` is undefined
 * there. We inline an equivalent browser-safe stub via `addInitScript`.
 * The shape mirrors `installZtoolsStub()` from the helper so a future
 * refactor could transpile the helper to IIFE and reuse it.
 *
 * NOTE on stub refinements vs. the plan code:
 *  - We capture the `setSubInput` callback so tests can simulate typing
 *    into the ZTools subinput (maven-ui does NOT auto-search on mount —
 *    it relies on `setSubInput` to feed it keystrokes).
 *  - The maven-search component builds XML dependency strings via
 *    `buildDependency`, so the assertion for that test checks XML
 *    fragments (the plan code's colon-separated expectation was wrong).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const searchResults = {
      data: [
        { id: 'org.springframework:spring-core', g: 'org.springframework', a: 'spring-core', latestVersion: '6.0.0', timestamp: 1666176915000 },
      ],
      source: 'solr',
    }
    const versionResults = {
      data: [
        { v: '6.0.0', timestamp: 1666176915000 },
        { v: '5.3.20', timestamp: 1661000000000 },
      ],
      source: 'solr',
    }
    let writeContentCalls: any[] = []
    let enterCb: any
    let subInputCb: any
    ;(window as any).services = {
      mavenSearch: () => Promise.resolve(searchResults),
      mavenVersions: () => Promise.resolve(versionResults),
    }
    ;(window as any).ztools = {
      onPluginEnter: (cb: any) => { enterCb = cb },
      onPluginOut: () => {},
      setSubInput: (cb: any) => { subInputCb = cb },
      showNotification: () => {},
      hideMainWindow: () => {},
      isDarkColors: () => false,
      clipboard: {
        writeContent: (call: any) => { writeContentCalls.push(call); return Promise.resolve(true) },
      },
      http: { setHeaders: () => true },
    }
    ;(window as any).__triggerEnter = (code: string, payload: string) => {
      if (enterCb) enterCb({ code, payload })
    }
    ;(window as any).__typeSubInput = (text: string) => {
      if (subInputCb) subInputCb(text)
    }
    ;(window as any).__getWriteCalls = () => writeContentCalls
  })
})

test('maven-ui: search → pick → action menu → confirm → copy XML', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => (window as any).__triggerEnter('maven-ui', ''))
  await page.waitForSelector('.maven-panel')
  // Simulate typing into the ZTools subinput to trigger debounced search.
  await page.evaluate(() => (window as any).__typeSubInput('spring-core'))
  await page.waitForSelector('.results li')
  await page.locator('.results li').first().click()
  await page.waitForSelector('.versions')
  // Press Enter → action menu opens.
  await page.locator('.versions').focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('.menu-overlay')
  // Focus the menu overlay so its @keydown handler receives the next Enter.
  await page.locator('.menu-overlay').focus()
  // Press Enter again to confirm "复制 XML" (default focus).
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => (window as any).__getWriteCalls().length > 0)
  const calls = await page.evaluate(() => (window as any).__getWriteCalls())
  expect(calls[0].type).toBe('text')
  expect(calls[0].shouldPaste).toBe(true)
  expect(calls[0].content).toContain('<dependency>')
  expect(calls[0].content).toContain('org.springframework')
  expect(calls[0].content).toContain('spring-core')
  expect(calls[0].content).toContain('6.0.0')
})

test('maven-search: over-cmd payload → pick package → press c → default copy', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => (window as any).__triggerEnter('maven-search', 'spring-core'))
  await page.waitForSelector('.maven-quick')
  await page.locator('.maven-quick ul li').first().click()
  await page.waitForSelector('.maven-quick header')
  // Press 'c' to trigger default copy (Mode B unifies c/g/u).
  await page.keyboard.press('c')
  await page.waitForFunction(() => (window as any).__getWriteCalls().length > 0)
  const calls = await page.evaluate(() => (window as any).__getWriteCalls())
  expect(calls[0].type).toBe('text')
  expect(calls[0].shouldPaste).toBe(true)
  expect(calls[0].content).toContain('<dependency>')
  expect(calls[0].content).toContain('<groupId>org.springframework</groupId>')
  expect(calls[0].content).toContain('<artifactId>spring-core</artifactId>')
  expect(calls[0].content).toContain('<version>6.0.0</version>')
})
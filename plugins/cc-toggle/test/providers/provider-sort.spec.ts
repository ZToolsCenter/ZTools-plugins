import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

test.setTimeout(60_000)
// 共享同一份 mock DB，串行执行避免数据互相污染
test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:3456/api'
// 使用 gemini 页签测试，避免与其它用例共享 codex 数据
const APP = 'gemini'

async function clearApp(request: APIRequestContext) {
  const all = await (await request.get(`${API}/providers?appType=${APP}`)).json()
  for (const p of Array.isArray(all) ? all : []) {
    await request.post(`${API}/provider-delete`, { data: { appType: APP, id: p.id } })
  }
}

async function seed(request: APIRequestContext, name: string, remark = ''): Promise<string> {
  const resp = await request.post(`${API}/provider`, {
    data: {
      appType: APP,
      data: { name, baseUrl: `https://${name.toLowerCase()}.example.com`, model: 'm', remark }
    }
  })
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).id
}

async function markCurrent(request: APIRequestContext, id: string) {
  const resp = await request.post(`${API}/provider/mark-current`, {
    data: { appType: APP, id }
  })
  expect(resp.ok()).toBeTruthy()
}

async function gotoProviders(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!(window as any).utoolsCctoggle?.sortProviders)
  // 切到 gemini 页签
  await page.locator('img[alt="Gemini"]').first().click()
  await expect(page.locator('.page-body')).toBeVisible()
  await expect
    .poll(() => page.$$eval('.hero-card .compact-name', els => els.map(e => e.textContent || '')))
    .not.toHaveLength(0)
}

async function gridNames(page: Page): Promise<string[]> {
  return page.$$eval('.drag-grid-item .compact-name', els => els.map(e => e.textContent || ''))
}

async function apiOrder(request: APIRequestContext): Promise<string[]> {
  const all = await (await request.get(`${API}/providers?appType=${APP}`)).json()
  return (Array.isArray(all) ? all : []).map(p => p.name)
}

async function apiSortOrders(request: APIRequestContext): Promise<Record<string, number>> {
  const all = await (await request.get(`${API}/providers?appType=${APP}`)).json()
  const out: Record<string, number> = {}
  for (const p of Array.isArray(all) ? all : []) out[p.name] = p.sortOrder
  return out
}

// 把 index 位置的卡片拖到 toIndex 位置
async function dragCard(page: Page, fromIndex: number, toIndex: number) {
  const items = page.locator('.drag-grid-item')
  const from = items.nth(fromIndex)
  const to = items.nth(toIndex)
  const fb = (await from.boundingBox())!
  const tb = (await to.boundingBox())!
  const sx = fb.x + fb.width / 2
  const sy = fb.y + fb.height / 2
  const ex = tb.x + tb.width / 2
  const ey = tb.y + tb.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  const steps = 15
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + ((ex - sx) * i) / steps, sy + ((ey - sy) * i) / steps)
  }
  await page.mouse.up()
}

// 把 index 位置的卡片拖出网格并释放（应取消）
async function dragCardOut(page: Page, fromIndex: number) {
  const items = page.locator('.drag-grid-item')
  const from = items.nth(fromIndex)
  const fb = (await from.boundingBox())!
  const sx = fb.x + fb.width / 2
  const sy = fb.y + fb.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  const steps = 15
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx, sy - 60 - i * 20)
  }
  await page.mouse.up()
}

test.describe('供应商卡片拖拽排序', () => {
  let seeded: string[] = []

  test.beforeAll(async ({ request }) => {
    await clearApp(request)
  })

  test.afterAll(async ({ request }) => {
    await clearApp(request)
  })

  test.afterEach(async ({ request }) => {
    for (const id of seeded) {
      await request.post(`${API}/provider-delete`, { data: { appType: APP, id } })
    }
    seeded = []
  })

  // 造数：Alpha 激活，Beta/Gamma 入网格，不导航
  async function seedThree(request: APIRequestContext) {
    seeded = []
    seeded.push(await seed(request, 'Alpha'))
    seeded.push(await seed(request, 'Beta'))
    seeded.push(await seed(request, 'Gamma'))
    await markCurrent(request, seeded[0])
  }

  test('拖拽换位后顺序与松开位置一致并持久化', async ({ page, request }) => {
    await seedThree(request)
    await gotoProviders(page)
    // 初始：Alpha 为 hero；新增的 Gamma 按 (sortOrder, createdAt) 归属落在 Beta 之前，网格 [Gamma, Beta]
    await expect(page.locator('.hero-card .compact-name')).toHaveText('Alpha')
    expect(await gridNames(page)).toEqual(['Gamma', 'Beta'])

    // 把 Gamma 拖到 Beta 之后
    await dragCard(page, 0, 1)
    await expect.poll(() => gridNames(page)).toEqual(['Beta', 'Gamma'])

    // 持久化：sortOrder 重编号为连续值，Alpha 保持 0
    const so = await apiSortOrders(request)
    expect(so['Alpha']).toBe(0)
    expect(so['Beta']).toBe(1)
    expect(so['Gamma']).toBe(2)

    // 重新进入页面后顺序保持
    await gotoProviders(page)
    expect(await gridNames(page)).toEqual(['Beta', 'Gamma'])
  })

  test('当前激活卡片（hero）不可拖拽，且不在网格内', async ({ page, request }) => {
    await seedThree(request)
    await gotoProviders(page)
    const hero = page.locator('.hero-card .provider-card')
    await expect(hero).toBeVisible()
    const inGrid = await page.evaluate(() => {
      const hero = document.querySelector('.hero-card .provider-card')
      return !!hero && !!hero.closest('.drag-grid')
    })
    expect(inGrid).toBe(false)
  })

  test('拖出网格释放取消，不产生持久化', async ({ page, request }) => {
    await seedThree(request)
    await gotoProviders(page)
    const before = await apiOrder(request)
    await dragCardOut(page, 0)
    // 顺序不变（初始网格 [Gamma, Beta]）
    await expect.poll(() => apiOrder(request)).toEqual(before)
    expect(await gridNames(page)).toEqual(['Gamma', 'Beta'])
  })

  test('拖拽中按 ESC 取消，不产生持久化', async ({ page, request }) => {
    await seedThree(request)
    await gotoProviders(page)
    const before = await apiOrder(request)
    const items = page.locator('.drag-grid-item')
    const fb = (await items.nth(0).boundingBox())!
    const sx = fb.x + fb.width / 2
    const sy = fb.y + fb.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx + 120, sy + 30, { steps: 10 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect.poll(() => apiOrder(request)).toEqual(before)
    expect(await gridNames(page)).toEqual(['Gamma', 'Beta'])
  })

  test('切换供应商不改变已排顺序（原激活项回到网格原槽位）', async ({ page, request }) => {
    await seedThree(request)
    await gotoProviders(page)
    // 先拖拽排成 Beta 在前（网格 [Gamma, Beta] → [Beta, Gamma]）
    await dragCard(page, 0, 1)
    await expect.poll(() => gridNames(page)).toEqual(['Beta', 'Gamma'])
    const sorted = await apiSortOrders(request)
    expect(sorted['Gamma']).toBe(2)

    // 通过 API 切换到 Beta（模拟真实切换，仅改 isCurrent）
    await markCurrent(request, seeded[1])
    await gotoProviders(page)
    await expect(page.locator('.hero-card .compact-name')).toHaveText('Beta')
    // Alpha(0) 回到网格、Gamma(2) 保持，顺序不变
    expect(await gridNames(page)).toEqual(['Alpha', 'Gamma'])

    // sortOrder 未被切换改变
    const after = await apiSortOrders(request)
    expect(after['Alpha']).toBe(0)
    expect(after['Beta']).toBe(sorted['Beta'])
    expect(after['Gamma']).toBe(2)
  })

  test('sortProviders 仅更新 sortOrder，不改变其他字段', async ({ request }) => {
    seeded = []
    const id = await seed(request, 'OnlySort')
    seeded.push(id)
    await markCurrent(request, id)
    // 第一个 id 存在排 0 号位，未知 id 被跳过不产生槽位
    const resp = await request.post(`${API}/provider-sort`, {
      data: { appType: APP, orderedIds: [id, 'zzz-unknown'] }
    })
    expect(resp.ok()).toBeTruthy()
    expect((await resp.json()).success).toBe(true)

    const all = await (await request.get(`${API}/providers?appType=${APP}`)).json()
    const p = all.find((x: any) => x.id === id)
    expect(p).toBeTruthy()
    expect(p.sortOrder).toBe(0)
    expect(p.name).toBe('OnlySort')
    expect(p.isCurrent).toBe(true)
  })

  test('listProviders 按 sortOrder 升序返回', async ({ request }) => {
    await clearApp(request)
    seeded = []
    const a = await seed(request, 'A')
    seeded.push(a)
    seeded.push(await seed(request, 'B'))
    seeded.push(await seed(request, 'C'))
    await markCurrent(request, a)
    await request.post(`${API}/provider-sort`, {
      data: { appType: APP, orderedIds: ['C-unknown', 'B-unknown', a] }
    })
    const all = await (await request.get(`${API}/providers?appType=${APP}`)).json()
    const sos = all.map((p: any) => p.sortOrder)
    expect(sos).toEqual([...sos].sort((x: number, y: number) => x - y))
  })
})

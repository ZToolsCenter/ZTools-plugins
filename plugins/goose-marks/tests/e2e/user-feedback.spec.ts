import { expect, test, type Page } from '@playwright/test'

type BookmarkState = {
  groups: Array<{
    id: string
    name: string
    children: Array<{ id: string; name: string; bookmarkIds: string[]; createdAt: number; updatedAt: number }>
    createdAt: number
    updatedAt: number
  }>
  bookmarks: Array<{
    id: string
    title: string
    url: string
    desc: string
    tags: string[]
    locations?: Array<{ groupId: string; subGroupId: string }>
    prevLocations?: Array<{ groupId: string; subGroupId: string }>
    createdAt: number
    updatedAt: number
    isDeleted?: boolean
  }>
  activeGroupId?: string
  activeSubGroupId?: string
}

const now = 1_900_000_000_000

const seedState = (): BookmarkState => ({
  groups: [
    {
      id: 'g-work',
      name: '工作',
      createdAt: now,
      updatedAt: now,
      children: [
        { id: 'sg-work-main', name: '常用', bookmarkIds: ['b-template'], createdAt: now, updatedAt: now },
        { id: 'sg-work-ops', name: '运维', bookmarkIds: ['b-slow-icon'], createdAt: now, updatedAt: now },
      ],
    },
    {
      id: 'g-life',
      name: '生活',
      createdAt: now,
      updatedAt: now,
      children: [
        { id: 'sg-life-main', name: '日常', bookmarkIds: ['b-normal'], createdAt: now, updatedAt: now },
      ],
    },
    {
      id: 'g-trash',
      name: '回收站',
      createdAt: now,
      updatedAt: now,
      children: [
        { id: 'sg-trash', name: '已删除', bookmarkIds: ['b-restore'], createdAt: now, updatedAt: now },
      ],
    },
  ],
  bookmarks: [
    {
      id: 'b-template',
      title: '京东搜索',
      url: 'https://search.jd.com/Search?keyword={query}&enc=utf-8',
      desc: '',
      tags: [],
      locations: [{ groupId: 'g-work', subGroupId: 'sg-work-main' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-slow-icon',
      title: '慢图标',
      url: 'https://slow-icon.invalid/path',
      desc: '',
      tags: [],
      locations: [{ groupId: 'g-work', subGroupId: 'sg-work-ops' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-normal',
      title: '普通书签',
      url: 'https://example.com',
      desc: '',
      tags: [],
      locations: [{ groupId: 'g-life', subGroupId: 'sg-life-main' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'b-restore',
      title: '待还原书签',
      url: 'https://restore.example.com',
      desc: '',
      tags: [],
      locations: [{ groupId: 'g-trash', subGroupId: 'sg-trash' }],
      prevLocations: [{ groupId: 'g-life', subGroupId: 'sg-life-main' }],
      createdAt: now,
      updatedAt: now,
    },
  ],
  activeGroupId: 'g-work',
  activeSubGroupId: 'sg-work-main',
})

async function seed(page: Page, state: BookmarkState = seedState()) {
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('__better_marks_e2e_seeded') === '1') return
    localStorage.clear()
    localStorage.setItem('bookmark', JSON.stringify(value))
    localStorage.setItem('settings', JSON.stringify({
      gridColumns: 3,
      autoMatchSearchIcons: false,
      searchAutoExitSeconds: 15,
      groupTabsLayout: 'wrap',
      windowHeight: 560,
    }))
    sessionStorage.setItem('__better_marks_e2e_seeded', '1')
  }, state)
}

async function readBookmarkState(page: Page): Promise<BookmarkState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('bookmark') || '{}'))
}

test.beforeEach(async ({ page }) => {
  await seed(page)
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url.includes('slow-icon.invalid') || url.endsWith('/favicon.ico')) {
      void route.abort()
      return
    }
    void route.continue()
  })
})

test('记住上次选中的主分组和子分组', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '生活' }).click()
  await expect(page.getByRole('button', { name: '生活' })).toHaveAttribute('data-active', 'true')

  let state = await readBookmarkState(page)
  expect(state.activeGroupId).toBe('g-life')
  expect(state.activeSubGroupId).toBe('sg-life-main')

  await page.reload()
  await expect(page.getByRole('button', { name: '生活' })).toHaveAttribute('data-active', 'true')
  state = await readBookmarkState(page)
  expect(state.activeGroupId).toBe('g-life')
  expect(state.activeSubGroupId).toBe('sg-life-main')
})

test('回收站书签可还原到原分组', async ({ page }) => {
  await page.goto('/')
  await page.locator('button').filter({ has: page.locator('.i-mdi-trash-can-outline') }).click()
  await expect(page.getByText('待还原书签')).toBeVisible()

  await page.getByText('待还原书签').click({ button: 'right' })
  await page.getByRole('button', { name: '还原' }).click()

  await expect(page.getByText('书签已还原')).toBeVisible()
  const state = await readBookmarkState(page)
  const restored = state.bookmarks.find((item) => item.id === 'b-restore')
  const trashIds = state.groups.find((group) => group.id === 'g-trash')?.children[0]?.bookmarkIds ?? []
  const lifeIds = state.groups.find((group) => group.id === 'g-life')?.children[0]?.bookmarkIds ?? []
  expect(restored?.locations).toEqual([{ groupId: 'g-life', subGroupId: 'sg-life-main' }])
  expect(restored?.prevLocations).toBeUndefined()
  expect(trashIds).not.toContain('b-restore')
  expect(lifeIds).toContain('b-restore')
})

test('模板书签首次点击进入输入态，执行后清空查询', async ({ page }) => {
  const opened: string[] = []
  await page.exposeFunction('__captureOpen', (url: string) => opened.push(url))
  await page.addInitScript(() => {
    window.open = ((url?: string | URL) => {
      void (window as any).__captureOpen(String(url || ''))
      return null
    }) as typeof window.open
  })

  await page.goto('/')
  await page.getByRole('heading', { name: '京东搜索' }).click()
  await expect(page.getByText('输入关键词...')).toBeVisible()
  const queryInput = page.locator('[data-template-query-input]')
  await queryInput.fill('机械键盘')
  await expect(page.getByText('机械键盘')).toBeVisible()
  await queryInput.press('Enter')

  await expect.poll(() => opened[0]).toContain('https://search.jd.com/Search?keyword=%E6%9C%BA%E6%A2%B0%E9%94%AE%E7%9B%98&enc=utf-8')
  await page.getByRole('heading', { name: '京东搜索' }).click()
  await expect(page.getByText('输入关键词...')).toBeVisible()
  await expect(page.getByText('机械键盘')).toHaveCount(0)
})

test('新建书签弹窗立即打开且图标失败不一直补全中', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '运维' }).click()
  await page.locator('.bookmark-add-card').click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('新建书签')).toBeVisible()
  const urlInput = dialog.getByPlaceholder('https://example.com 或 {query} 模板')
  await expect(urlInput).toBeVisible()
  await urlInput.fill('https://slow-icon.invalid/path')

  await expect(dialog.getByText('正在识别站点信息...')).toHaveCount(0, { timeout: 15_000 })
  await expect(dialog.getByText('识别失败')).toBeVisible()
  await expect(urlInput).toBeFocused()
})

test('失效持久化分组启动时回退到可用分组', async ({ page }) => {
  const state = seedState()
  state.activeGroupId = 'g-missing'
  state.activeSubGroupId = 'sg-missing'
  await seed(page, state)
  await page.goto('/')

  await expect(page.getByRole('button', { name: '工作' })).toHaveAttribute('data-active', 'true')
  const stored = await readBookmarkState(page)
  expect(stored.activeGroupId).toBe('g-work')
  expect(stored.activeSubGroupId).toBe('sg-work-main')
})

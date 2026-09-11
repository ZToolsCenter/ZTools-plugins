import { expect, test } from '@playwright/test'

const now = 1_900_000_000_000

test.beforeEach(async ({ page }) => {
  await page.addInitScript((ts) => {
    localStorage.setItem(
      'bookmark',
      JSON.stringify({
        groups: [
          {
            id: 'g1',
            name: '工作',
            subGroups: [{ id: 'sg1', name: '常用', bookmarkIds: ['b1'] }],
            bookmarkIds: [],
          },
        ],
        bookmarks: [
          {
            id: 'b1',
            title: 'GitHub',
            url: 'https://github.com/octocat',
            desc: 'test',
            tags: [],
            locations: [{ groupId: 'g1', subGroupId: 'sg1' }],
            createdAt: ts,
            updatedAt: ts,
          },
        ],
        activeGroupId: 'g1',
        activeSubGroupId: 'sg1',
      }),
    )
  }, now)
  await page.goto('/')
})

test('编辑书签时确认步显示完整链接地址栏', async ({ page }) => {
  const card = page.locator('[data-item-id="b1"]').first()
  await card.click({ button: 'right' })
  await page.getByRole('button', { name: '编辑' }).click()
  const urlInput = page.locator('.gm-confirm-url input')
  await expect(urlInput).toBeVisible()
  await expect(urlInput).toHaveValue('https://github.com/octocat')
})
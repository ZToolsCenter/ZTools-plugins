import { test, expect, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:4456/api';

// ─────────────────────────────
// 测试数据（模拟两个搜索源返回）
// ─────────────────────────────
const SKILLSH_RESULTS = [
  {
    name: 'github-actions',
    repo: 'https://github.com/steipete/github-actions',
    path: 'steipete/github-actions',
    desc: 'steipete',
    installs: 1618
  },
  {
    name: 'summarize',
    repo: 'https://github.com/steipete/summarize',
    path: 'steipete/summarize',
    desc: 'steipete',
    installs: 512
  }
];

const MODELSCOPE_RESULTS = [
  {
    name: 'github',
    repo: 'https://clawhub.ai/steipete/github',
    path: '@steipete/github',
    desc: '使用 gh CLI 与 GitHub 进行交互',
    installs: 1618
  },
  {
    name: 'api-design',
    repo: '',
    path: '@AMap-Web/api-design',
    desc: 'by AMap-Web',
    installs: 36
  }
];

// 拦截 /api/skills/search，按 source 返回对应 mock 数据
async function mockSkillSearch(page: Page) {
  await page.route('**/api/skills/search*', route => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('source') || 'skillsh';
    const q = url.searchParams.get('q') || '';
    const results = source === 'modelscope' ? MODELSCOPE_RESULTS : SKILLSH_RESULTS;
    const filtered = q.includes('zzzz') ? [] : results;
    void route.fulfill({ json: filtered, status: 200 });
  });
}

// 导航到 Skill 管理 → 搜索安装页
async function gotoSkillInstall(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).ztoolsCctoggle?.searchSkills);
  await page.hover('.nav-btn--text');
  await page.locator('.n-dropdown-option:has-text("Skill管理")').click();
  await expect(page.locator('.n-page-header__title')).toHaveText('Skill 管理');
  await expect(page.locator('.sub-tab:has-text("搜索安装")')).toBeVisible();
}

// ─────────────────────────────
// UI 层：搜索源切换 + 搜索展示
// ─────────────────────────────
test.describe('Skill 搜索源 UI', () => {
  async function selectSource(page: Page, label: string) {
    await page.locator('.source-select').click();
    await page.locator('.n-base-select-option:has-text("' + label + '")').click();
  }

  test('默认 skill.sh 源，输入关键词触发搜索并渲染结果', async ({ page }) => {
    await mockSkillSearch(page);
    await gotoSkillInstall(page);

    await expect(page.locator('.source-select')).toContainText('skill.sh');

    const input = page.locator('.search-input input');
    await expect(input).toHaveAttribute('placeholder', /skill\.sh/);
    await input.fill('github');

    // 防抖 250ms 后发起请求，等待结果卡片
    const cards = page.locator('.result-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first().locator('.result-name')).toHaveText('github-actions');
    await expect(cards.first().locator('.result-installs')).toContainText('1.6K');
  });

  test('左侧下拉切换 ModelScope 源，placeholder 与结果源变化', async ({ page }) => {
    await mockSkillSearch(page);
    await gotoSkillInstall(page);

    const input = page.locator('.search-input input');
    await selectSource(page, 'ModelScope');
    await expect(page.locator('.source-select')).toContainText('ModelScope');
    await expect(input).toHaveAttribute('placeholder', /ModelScope/);

    await input.fill('github');
    const cards = page.locator('.result-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first().locator('.result-name')).toHaveText('github');
    // ModelScope 结果来源 URL 展示
    await expect(cards.first().locator('.result-repo')).toHaveText(
      'https://clawhub.ai/steipete/github'
    );

    // 切回 skill.sh
    await selectSource(page, 'skill.sh');
    await expect(page.locator('.source-select')).toContainText('skill.sh');
    await expect(cards.first().locator('.result-name')).toHaveText('github-actions');
  });

  test('切换搜索源时清空旧结果并重新搜索', async ({ page }) => {
    await mockSkillSearch(page);
    await gotoSkillInstall(page);

    const input = page.locator('.search-input input');
    await input.fill('github');
    await expect(page.locator('.result-card')).toHaveCount(2);

    // 切到 ModelScope 后立即重新请求，结果变更为 modelscope 数据
    await selectSource(page, 'ModelScope');
    await expect(page.locator('.result-card').first().locator('.result-name')).toHaveText('github');
    const count = await page.locator('.result-card').count();
    expect(count).toBe(2);
  });

  test('点击右侧搜索按钮触发搜索', async ({ page }) => {
    await mockSkillSearch(page);
    await gotoSkillInstall(page);

    const input = page.locator('.search-input input');
    const searchBtn = page.locator('.search-btn');
    await input.fill('github');
    await searchBtn.click();
    await expect(page.locator('.result-card')).toHaveCount(2);
  });

  test('无关键词时不发起搜索，显示提示', async ({ page }) => {
    await mockSkillSearch(page);
    await gotoSkillInstall(page);

    const called: string[] = [];
    await page.route('**/api/skills/search*', route => {
      called.push(route.request().url());
      void route.fulfill({ json: [], status: 200 });
    });

    await expect(page.locator('.results-hint')).toBeVisible();
    await expect(page.locator('.result-card')).toHaveCount(0);
    expect(called.length).toBe(0);
  });

  test('搜索无结果时显示空状态', async ({ page }) => {
    await mockSkillSearch(page);
    await gotoSkillInstall(page);

    const input = page.locator('.search-input input');
    await input.fill('zzzz-nonexistent-skill');
    await expect(page.locator('.results-empty')).toHaveText('无匹配结果');
  });
});

// ─────────────────────────────
// API 层：浏览器模式 searchSkills 带 source 调用
// ─────────────────────────────
test.describe('Skill 搜索 API（浏览器模式）', () => {
  test('searchSkills 携带 source=skillsh 请求返回统一结构', async ({ page }) => {
    const seen: string[] = [];
    await page.route('**/api/skills/search*', route => {
      seen.push(route.request().url());
      void route.fulfill({ json: SKILLSH_RESULTS, status: 200 });
    });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).ztoolsCctoggle?.searchSkills);

    const r = await page.evaluate(async () => {
      const res = await (window as any).ztoolsCctoggle.searchSkills('github', 'skillsh');
      return { count: res.length, first: res[0] };
    });
    expect(r.count).toBe(2);
    expect(r.first.name).toBe('github-actions');
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('source=skillsh');
    expect(seen[0]).toContain('q=github');
  });

  test('searchSkills 携带 source=modelscope', async ({ page }) => {
    const seen: string[] = [];
    await page.route('**/api/skills/search*', route => {
      seen.push(route.request().url());
      void route.fulfill({ json: MODELSCOPE_RESULTS, status: 200 });
    });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).ztoolsCctoggle?.searchSkills);

    const r = await page.evaluate(async () => {
      const res = await (window as any).ztoolsCctoggle.searchSkills('github', 'modelscope');
      return { count: res.length, first: res[0] };
    });
    expect(r.count).toBe(2);
    expect(r.first.path).toBe('@steipete/github');
    expect(seen[0]).toContain('source=modelscope');
  });
});

// ─────────────────────────────
// 真实链路：dev-api-server → SkillManager.searchSkills（宽松断言，不依赖外网内容）
// ─────────────────────────────
test.describe('Skill 搜索后端路由', () => {
  test('GET /api/skills/search 返回数组（真实调用两个源）', async ({ request }) => {
    const res = await request.get(`${API}/skills/search?q=github&source=skillsh`, {
      timeout: 20_000
    });
    expect(res.ok()).toBeTruthy();
    const skillsh = await res.json();
    expect(Array.isArray(skillsh)).toBe(true);

    const res2 = await request.get(`${API}/skills/search?q=github&source=modelscope`, {
      timeout: 20_000
    });
    expect(res2.ok()).toBeTruthy();
    const ms = await res2.json();
    expect(Array.isArray(ms)).toBe(true);
  });
});

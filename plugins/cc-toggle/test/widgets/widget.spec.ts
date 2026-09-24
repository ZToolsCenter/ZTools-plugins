import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:4456/api';

// ─────────────────────────────
// 1. WidgetManager API（浏览器模式 mock）
// ─────────────────────────────
test.describe('小组件 API（浏览器模式）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).ztoolsCctoggle?.openWidget);
  });

  test('open/close/toggle 状态往返一致', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.ztoolsCctoggle;
      api.openWidget('status');
      const opened = api.getWidgetStates().status?.open;
      api.closeWidget('status');
      const closed = api.getWidgetStates().status?.open;
      api.toggleWidget('status');
      const toggled = api.getWidgetStates().status?.open;
      return { opened, closed, toggled };
    });
    expect(r.opened).toBe(true);
    expect(r.closed).toBe(false);
    expect(r.toggled).toBe(true);
  });

  test('重复 openWidget 幂等', async ({ page }) => {
    const r = await page.evaluate(() => {
      const api = window.ztoolsCctoggle;
      const a = api.openWidget('status');
      const b = api.openWidget('status');
      return { a: a.success, b: b.success };
    });
    expect(r.a).toBe(true);
    expect(r.b).toBe(true);
  });
});

// ─────────────────────────────
// 2. 小组件页面 UI（直接访问 /preload/widgets/status/status.html + 注入 mock API）
// ─────────────────────────────
const MOCK_STATE = {
  appType: 'codex',
  label: 'Codex',
  icon: '../assets/images/agents/codex.png',
  providerId: 'p1',
  providerName: 'OpenAI',
  model: 'gpt-5',
  remark: '',
  balance: { status: 'ok', text: '$12.00', low: false },
  config: {
    showBalance: true,
    showModel: true,
    showRemark: true,
    opacity: 1,
    theme: 'dark',
    alwaysOnTop: false
  }
};

test.describe('小组件页面 UI', () => {
  async function openWidgetPage(page, state = MOCK_STATE) {
    await page.addInitScript(s => {
      const mockState = JSON.parse(JSON.stringify(s));
      const calls = [];
      window.__widgetCalls = calls;
      window.__cctoggleWidget = {
        getState: () => JSON.parse(JSON.stringify(mockState)),
        getConfig: () => mockState.config,
        setConfig: p => {
          Object.assign(mockState.config, p);
          calls.push(['setConfig', p]);
          return mockState.config;
        },
        subscribe: () => {},
        close: () => {
          calls.push(['close']);
        }
      };
    }, state);
    await page.goto('/preload/widgets/status/status.html');
  }

  test('渲染当前供应商与余额（只读）', async ({ page }) => {
    await openWidgetPage(page);
    await expect(page.locator('#w-agent')).toHaveText('Codex');
    await expect(page.locator('#w-provider')).toHaveText('OpenAI');
    await expect(page.locator('#w-balance')).toHaveText('$12.00');
    await expect(page.locator('#w-body')).toHaveAttribute('data-app', 'codex');
  });

  test('未激活/未配置余额显示「未配置」', async ({ page }) => {
    await openWidgetPage(page, {
      ...MOCK_STATE,
      providerId: null,
      providerName: '未激活',
      balance: { status: 'none', text: '未配置' }
    });
    await expect(page.locator('#w-provider')).toHaveText('未激活');
    await expect(page.locator('#w-balance')).toHaveText('未配置');
  });

  test('hover 显示齿轮，点击打开设置面板，返回可关闭', async ({ page }) => {
    await openWidgetPage(page);
    const tools = page.locator('.w-tools');
    expect(await tools.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
    await page.locator('#widget').hover();
    await expect.poll(() => tools.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    await page.locator('#btn-gear').click();
    await expect(page.locator('#w-settings')).toHaveClass(/open/);
    await page.locator('#btn-settings-back').click();
    await expect(page.locator('#w-settings')).not.toHaveClass(/open/);
  });

  test('设置开关触发 setConfig 即时更新', async ({ page }) => {
    await openWidgetPage(page);
    await page.locator('#widget').hover();
    await page.locator('#btn-gear').click();
    await page.locator('#cfg-balance').uncheck();
    const calls = await page.evaluate(() => window.__widgetCalls);
    expect(calls.some(c => c[0] === 'setConfig' && c[1].showBalance === false)).toBe(true);
  });

  test('关闭按钮调用 api.close', async ({ page }) => {
    await openWidgetPage(page);
    await page.locator('#widget').hover();
    await page.locator('#btn-close').click();
    const calls = await page.evaluate(() => window.__widgetCalls);
    expect(calls.some(c => c[0] === 'close')).toBe(true);
  });
});

// ─────────────────────────────
// 3. 英雄卡入口（ProviderListPage）
// ─────────────────────────────
test.describe('英雄卡小组件入口', () => {
  let seededId = '';

  test.afterEach(async ({ request }) => {
    if (seededId) {
      await request.post(`${API}/provider-delete`, { data: { appType: 'codex', id: seededId } });
      seededId = '';
    }
  });

  test('英雄卡右上角小组件按钮打开/关闭并同步高亮', async ({ page, request }) => {
    // 造数：codex 加一个供应商并标记为当前（mark-current 不写真实 CLI 配置）
    const create = await request.post(`${API}/provider`, {
      data: {
        appType: 'codex',
        data: { name: 'Test Provider', baseUrl: 'https://example.com', model: 'test-model' }
      }
    });
    expect(create.ok()).toBeTruthy();
    seededId = (await create.json()).id;
    const mark = await request.post(`${API}/provider/mark-current`, {
      data: { appType: 'codex', id: seededId }
    });
    expect(mark.ok()).toBeTruthy();

    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).ztoolsCctoggle?.openWidget);
    const btn = page.locator('.hero-card .widget-btn');
    await expect(btn).toBeVisible();

    // 初始关闭
    const before = await page.evaluate(() => window.ztoolsCctoggle.getWidgetStates());
    expect(before.status?.open).toBeFalsy();
    expect(btn).toHaveAttribute('title', '打开状态小组件');

    // 点击打开
    await btn.click();
    await expect(btn).toHaveAttribute('title', '收起状态小组件');
    const afterOpen = await page.evaluate(() => window.ztoolsCctoggle.getWidgetStates());
    expect(afterOpen.status?.open).toBe(true);

    // 再次点击关闭
    await btn.click();
    await expect(btn).toHaveAttribute('title', '打开状态小组件');
    const afterClose = await page.evaluate(() => window.ztoolsCctoggle.getWidgetStates());
    expect(afterClose.status?.open).toBe(false);
  });
});

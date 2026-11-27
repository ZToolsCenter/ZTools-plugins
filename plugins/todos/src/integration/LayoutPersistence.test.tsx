/**
 * 用户偏好持久化集成测试
 *
 * 直接组合真实的 AppProvider + storageUtils + 内存版 dbStorage，
 * 模拟「切换设置 → 关闭应用 → 重新打开」的完整链路。
 */
import { render, screen, act, waitFor } from '@testing-library/react';
import { AppProvider, useAppContext } from '../context/AppContext';

function LayoutProbe() {
  const { state, dispatch } = useAppContext();
  return (
    <div>
      <button
        data-testid="layout"
        onClick={() => dispatch({ type: 'SET_LAYOUT_MODE', payload: { layoutMode: 'pool-only' } })}
      >
        {state.layoutMode}
      </button>
      <button
        data-testid="color-mode"
        onClick={() => dispatch({ type: 'SET_TASK_COLOR_MODE', payload: { taskColorMode: 'status' } })}
      >
        {state.taskColorMode}
      </button>
    </div>
  );
}

function installDbStorage() {
  const store = new Map<string, string>();
  (window as any).ztools = {
    dbStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key) : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
  return store;
}

function renderApp() {
  return render(
    <AppProvider>
      <LayoutProbe />
    </AppProvider>
  );
}

describe('user preference persistence', () => {
  afterEach(() => {
    delete (window as any).ztools;
    localStorage.clear();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps the layout mode after restarting the app', async () => {
    const store = installDbStorage();

    const first = renderApp();
    expect(screen.getByTestId('layout')).toHaveTextContent('split');

    act(() => {
      screen.getByTestId('layout').click();
    });

    // 等待 500ms 防抖写入完成
    await waitFor(
      () => {
        expect(store.get('todos-data')).toContain('"layoutMode":"pool-only"');
      },
      { timeout: 3000 }
    );

    first.unmount();

    // 模拟重启：全新的 Provider 从同一份 dbStorage 快照恢复
    renderApp();
    expect(screen.getByTestId('layout')).toHaveTextContent('pool-only');
  });

  it('keeps the task color mode after restarting the app', async () => {
    const store = installDbStorage();

    const first = renderApp();
    expect(screen.getByTestId('color-mode')).toHaveTextContent('random');

    act(() => {
      screen.getByTestId('color-mode').click();
    });

    await waitFor(
      () => {
        expect(store.get('todos-data')).toContain('"taskColorMode":"status"');
      },
      { timeout: 3000 }
    );

    first.unmount();

    renderApp();
    expect(screen.getByTestId('color-mode')).toHaveTextContent('status');
  });
});

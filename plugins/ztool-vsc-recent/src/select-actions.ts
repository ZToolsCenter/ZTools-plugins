/**
 * 选中条目后，根据 launcher 返回值决定要对 ztools host 做哪些动作。
 * 纯函数，与 DOM 无关，便于单测。
 *
 * KEEP-IN-SYNC with index.ts:select() — renderer inlines equivalent
 * logic because the sandboxed plugin view has no module loader. When
 * you change one, change the other.
 */
export type LaunchResult =
  | { ok: true }
  | { ok: false; reason: string }
  | { ok: false; ipcError: string };  // IPC 通道异常（recentApi.open 抛出）

export type SelectAction =
  | { kind: 'close-host' }       // hideMainWindow(false) + outPlugin()
  | { kind: 'notify'; message: string };

const PATH_HINT =
  '。请确认已安装稳定版 Visual Studio Code；Windows 用户可通过页面中的“设置 VSCode”手动选择 Code.exe，Linux 用户需确保 code 命令可用。';

export function decideSelectActions(r: LaunchResult): SelectAction[] {
  if (r.ok) {
    return [{ kind: 'close-host' }];
  }
  if ('ipcError' in r) {
    return [{ kind: 'notify', message: '启动 VSCode 失败（IPC 异常）：' + r.ipcError }];
  }
  return [{ kind: 'notify', message: '无法启动 VSCode：' + r.reason + PATH_HINT }];
}

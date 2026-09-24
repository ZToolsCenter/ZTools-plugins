"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideSelectActions = decideSelectActions;
const PATH_HINT = '。请确认已安装稳定版 Visual Studio Code；Windows 用户可通过页面中的“设置 VSCode”手动选择 Code.exe，Linux 用户需确保 code 命令可用。';
function decideSelectActions(r) {
    if (r.ok) {
        return [{ kind: 'close-host' }];
    }
    if ('ipcError' in r) {
        return [{ kind: 'notify', message: '启动 VSCode 失败（IPC 异常）：' + r.ipcError }];
    }
    return [{ kind: 'notify', message: '无法启动 VSCode：' + r.reason + PATH_HINT }];
}

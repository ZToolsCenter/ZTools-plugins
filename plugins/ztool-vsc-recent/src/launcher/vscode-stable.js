"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureWindowsCodeExecutable = configureWindowsCodeExecutable;
exports.createLaunchPlan = createLaunchPlan;
exports.openInVSCode = openInVSCode;
const fs_1 = require("fs");
const os_1 = require("os");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const VSCODE_BUNDLE_ID = 'com.microsoft.VSCode';
const MAC_OPEN_COMMAND = '/usr/bin/open';
const MAC_CODE_RELATIVE_PATH = path.join('Contents', 'Resources', 'app', 'bin', 'code');
const WINDOWS_CODE_STORAGE_KEY = 'vscode-code-executable-path';
function detectPlatform() {
    if (typeof ztools !== 'undefined') {
        if (typeof ztools.isWindows === 'function' && ztools.isWindows())
            return 'win32';
        if (typeof ztools.isMacOs === 'function' && ztools.isMacOs())
            return 'darwin';
        if (typeof ztools.isMacOS === 'function' && ztools.isMacOS())
            return 'darwin';
        if (typeof ztools.isLinux === 'function' && ztools.isLinux())
            return 'linux';
    }
    return process.platform;
}
function firstExistingPath(candidates) {
    for (const candidate of candidates) {
        if (candidate && (0, fs_1.existsSync)(candidate))
            return candidate;
    }
    return null;
}
function resolveMacCodeCli(env) {
    const home = env.HOME || (0, os_1.homedir)();
    const commonCli = firstExistingPath([
        path.join('/Applications', 'Visual Studio Code.app', MAC_CODE_RELATIVE_PATH),
        path.join(home, 'Applications', 'Visual Studio Code.app', MAC_CODE_RELATIVE_PATH),
    ]);
    if (commonCli)
        return commonCli;
    try {
        const result = (0, child_process_1.spawnSync)('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == "${VSCODE_BUNDLE_ID}"`], { encoding: 'utf8' });
        if (result.status !== 0 || typeof result.stdout !== 'string')
            return null;
        const indexedCandidates = result.stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map(appPath => path.join(appPath, MAC_CODE_RELATIVE_PATH));
        return firstExistingPath(indexedCandidates);
    }
    catch {
        return null;
    }
}
function resolveWindowsCodeExecutable(env) {
    const candidates = [
        env.ZTOOLS_VSCODE_EXECUTABLE || '',
        env.VSCODE_EXECUTABLE || '',
    ];
    try {
        const result = (0, child_process_1.spawnSync)('where.exe', ['code'], { encoding: 'utf8', windowsHide: true });
        if (result.status === 0 && typeof result.stdout === 'string') {
            for (const commandPath of result.stdout.split(/\r?\n/).filter(Boolean)) {
                if (path.extname(commandPath).toLowerCase() === '.exe') {
                    candidates.push(commandPath);
                }
                candidates.push(path.resolve(path.dirname(commandPath), '..', 'Code.exe'));
            }
        }
    }
    catch {
        // Fall back to the standard installation directories below.
    }
    if (env.LOCALAPPDATA) {
        candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'));
    }
    if (env.ProgramFiles) {
        candidates.push(path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'));
    }
    if (env['ProgramFiles(x86)']) {
        candidates.push(path.join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'));
    }
    return firstExistingPath(candidates);
}
function readConfiguredWindowsCodeExecutable() {
    if (typeof ztools === 'undefined' || !ztools.dbStorage)
        return null;
    try {
        const configured = ztools.dbStorage.getItem(WINDOWS_CODE_STORAGE_KEY);
        if (typeof configured !== 'string' || !configured)
            return null;
        if ((0, fs_1.existsSync)(configured))
            return configured;
        ztools.dbStorage.removeItem(WINDOWS_CODE_STORAGE_KEY);
    }
    catch {
        // Ignore invalid or unavailable plugin storage.
    }
    return null;
}
function selectWindowsCodeExecutable() {
    if (typeof ztools === 'undefined' || typeof ztools.showOpenDialog !== 'function')
        return null;
    const selected = ztools.showOpenDialog({
        title: '选择 Visual Studio Code 的 Code.exe',
        buttonLabel: '选择 Code.exe',
        filters: [{ name: 'Visual Studio Code', extensions: ['exe'] }],
        properties: ['openFile'],
    });
    const executable = Array.isArray(selected) ? selected[0] : null;
    if (!executable)
        return null;
    if (path.win32.basename(executable).toLowerCase() !== 'code.exe' || !(0, fs_1.existsSync)(executable)) {
        throw new Error('请选择 VSCode 安装目录中的 Code.exe 文件');
    }
    try {
        ztools.dbStorage?.setItem(WINDOWS_CODE_STORAGE_KEY, executable);
    }
    catch {
        // The selected executable remains usable for the current launch.
    }
    return executable;
}
/**
 * 主动重新选择并保存 Windows VSCode 可执行文件。
 * 仅在用户明确点击设置入口时调用，不影响自动发现和启动流程。
 */
function configureWindowsCodeExecutable() {
    try {
        const executable = selectWindowsCodeExecutable();
        return executable
            ? { ok: true, path: executable }
            : { ok: false, canceled: true };
    }
    catch (error) {
        return {
            ok: false,
            canceled: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
function resolveWindowsCodeExecutableWithFallback(env) {
    return (readConfiguredWindowsCodeExecutable() ||
        resolveWindowsCodeExecutable(env) ||
        selectWindowsCodeExecutable());
}
function hasOption(options, key) {
    return Object.prototype.hasOwnProperty.call(options, key);
}
function createLaunchPlan(item, options = {}) {
    const platform = options.platform ?? detectPlatform();
    const env = options.env ?? process.env;
    if (platform === 'darwin') {
        if (item.kind === 'remote') {
            const macCodeCli = hasOption(options, 'macCodeCli')
                ? options.macCodeCli ?? null
                : resolveMacCodeCli(env);
            if (!macCodeCli) {
                throw new Error('未找到 VSCode 应用包内的 code CLI，无法可靠打开远程项目');
            }
            return {
                command: macCodeCli,
                args: ['--folder-uri', item.rawPath],
                waitForExit: true,
                detached: false,
            };
        }
        return {
            command: MAC_OPEN_COMMAND,
            args: ['-b', VSCODE_BUNDLE_ID, item.rawPath],
            waitForExit: true,
            detached: false,
        };
    }
    if (platform === 'win32') {
        const executable = hasOption(options, 'windowsCodeExecutable')
            ? options.windowsCodeExecutable ?? null
            : resolveWindowsCodeExecutable(env);
        if (!executable) {
            throw new Error('未找到 VSCode 的 Code.exe，请确认已安装稳定版 Visual Studio Code');
        }
        return {
            command: executable,
            args: item.kind === 'remote' ? ['--folder-uri', item.rawPath] : [item.rawPath],
            waitForExit: false,
            detached: true,
        };
    }
    const extraPaths = ['/usr/local/bin', '/usr/bin', '/bin'];
    const currentPath = env.PATH || '';
    const pathParts = currentPath.split(path.delimiter).filter(Boolean);
    const missingPaths = extraPaths.filter(extraPath => !pathParts.includes(extraPath));
    env.PATH = [...pathParts, ...missingPaths].join(path.delimiter);
    return {
        command: 'code',
        args: item.kind === 'remote' ? ['--folder-uri', item.rawPath] : [item.rawPath],
        waitForExit: true,
        detached: false,
    };
}
function executeLaunchPlan(plan, env, spawnProcess) {
    return new Promise(resolve => {
        let settled = false;
        const settle = (result) => {
            if (settled)
                return;
            settled = true;
            resolve(result);
        };
        try {
            const child = spawnProcess(plan.command, plan.args, {
                env,
                detached: plan.detached,
                stdio: 'ignore',
                shell: false,
                windowsHide: true,
            });
            child.once('error', error => settle({ ok: false, reason: error.message }));
            if (plan.waitForExit) {
                child.once('exit', (code, signal) => {
                    if (code === 0) {
                        settle({ ok: true });
                        return;
                    }
                    const detail = code === null ? `signal:${signal ?? 'unknown'}` : `code:${code}`;
                    settle({
                        ok: false,
                        reason: `VSCode 启动命令异常退出(${detail})，请确认应用已安装且命令可用`,
                    });
                });
            }
            else {
                child.once('spawn', () => settle({ ok: true }));
            }
            if (plan.detached)
                child.unref();
        }
        catch (error) {
            settle({ ok: false, reason: error instanceof Error ? error.message : String(error) });
        }
    });
}
/**
 * 打开 VSCode 最近项目。所有用户路径都通过 argv 传递，不经过 shell 解析。
 */
async function openInVSCode(item, options = {}) {
    try {
        const env = { ...(options.env ?? process.env) };
        const platform = options.platform ?? detectPlatform();
        const effectiveOptions = { ...options, platform, env };
        if (platform === 'win32' && !hasOption(options, 'windowsCodeExecutable')) {
            effectiveOptions.windowsCodeExecutable = resolveWindowsCodeExecutableWithFallback(env);
        }
        const plan = createLaunchPlan(item, effectiveOptions);
        return await executeLaunchPlan(plan, env, options.spawnProcess ?? child_process_1.spawn);
    }
    catch (error) {
        return {
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

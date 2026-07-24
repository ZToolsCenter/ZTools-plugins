/**
 * 包管理器（PM）可用性解析工具
 *
 * 纯逻辑模块，与平台 API（Tauri/uTools）解耦。
 * 调用方通过传入 checkDir 回调来提供平台相关的文件系统检查。
 */

import type { PackageManagerResolveResult } from '../api/types';

/** PM 解析参数 */
export interface ResolvePmInput {
    /** 项目 Node 路径（由 resolveProjectNodePath 得到，可能为空） */
    nodePath: string;
    /** 默认（系统）Node 路径（由 nodeStore 得到，可能为空） */
    defaultNodePath: string;
    /** 包管理器名称 */
    packageManager: string;
    /** 包管理器来源 */
    source: 'project' | 'default';
}

/**
 * 在指定目录中查找包管理器可执行文件。
 * 返回可执行命令字符串（用于 spawn），未找到返回 null。
 *
 * @param pm       包管理器名称 (npm/yarn/pnpm/cnpm)
 * @param entries  该目录下的文件/目录名列表（不含子路径）
 * @param isWindows 是否 Windows 平台
 */
export function findPmInEntries(
    pm: string,
    entries: string[],
    isWindows: boolean,
): string | null {
    if (isWindows) {
        // 检查 {pm}.cmd 或 {pm}.exe
        if (entries.includes(`${pm}.cmd`) || entries.includes(`${pm}.exe`)) {
            return pm; // shell: true 下可直接使用命令名
        }
        return null;
    } else {
        // Unix: 检查 bin 目录下的可执行文件
        if (entries.includes(pm)) return pm;
        return null;
    }
}

/**
 * 统一解析包管理器可用性（纯函数，无副作用）。
 *
 * 逻辑：
 * 1. 如果 source === 'project'，检查项目 Node 目录中是否安装了 PM
 *    - 有 → 可用
 *    - 无 → 不可用（即使默认 Node 有也不借用）
 * 2. 如果 source === 'default'，检查默认 Node 目录中是否安装了 PM
 *    - 有 → 可用（但运行命令时仍使用项目 Node，只是借用默认 Node 的 PM 入口）
 *    - 无 → 不可用
 *
 * @param input          解析参数
 * @param checkEntries   回调：(dirPath) => 该目录下的文件名列表
 * @param isWindows      是否 Windows 平台
 */
export async function resolvePackageManager(
    input: ResolvePmInput,
    checkEntries: (dirPath: string) => Promise<string[]>,
    isWindows: boolean,
): Promise<PackageManagerResolveResult> {
    const { nodePath, defaultNodePath, packageManager, source } = input;

    // 非 Node 项目或无 PM 配置
    if (!packageManager) {
        return { available: true };
    }

    if (source === 'project') {
        // 使用项目 Node 环境
        if (!nodePath) {
            return {
                available: false,
                reason: `project_node_unavailable`,
            };
        }

        const entries = await checkEntries(nodePath);
        const cmd = findPmInEntries(packageManager, entries, isWindows);

        if (cmd) {
            return { available: true, commandPath: cmd };
        }

        return {
            available: false,
            reason: `pm_not_installed_in_project_node`,
        };
    } else {
        // source === 'default'：借用默认 Node 环境的 PM
        if (!defaultNodePath) {
            return {
                available: false,
                reason: `default_node_unavailable`,
            };
        }

        const entries = await checkEntries(defaultNodePath);
        const cmd = findPmInEntries(packageManager, entries, isWindows);

        if (cmd) {
            return { available: true, commandPath: cmd };
        }

        return {
            available: false,
            reason: `pm_not_installed_in_default_node`,
        };
    }
}

/**
 * 获取 PM 不可用时的 i18n 消息 key 和参数。
 * 用于 UI 中显示禁用原因。
 */
export function getPmDisabledReason(
    result: PackageManagerResolveResult,
    nodeVersion: string,
    defaultNodeVersion: string,
    packageManager: string,
): { key: string; params: Record<string, string> } | null {
    if (result.available) return null;

    const pm = packageManager;
    switch (result.reason) {
        case 'project_node_unavailable':
            return {
                key: 'project.cmdDisabledNoNode',
                params: { pm },
            };
        case 'pm_not_installed_in_project_node':
            return {
                key: 'project.cmdDisabledPmNotInstalled',
                params: { pm, version: nodeVersion },
            };
        case 'default_node_unavailable':
            return {
                key: 'project.cmdDisabledDefaultNodeUnavailable',
                params: { pm },
            };
        case 'pm_not_installed_in_default_node':
            return {
                key: 'project.cmdDisabledPmNotInstalledDefault',
                params: { pm, version: defaultNodeVersion },
            };
        default:
            return {
                key: 'project.cmdDisabledUnknown',
                params: { pm },
            };
    }
}

/**
 * 获取 PM 可用性状态的后缀文本。
 * 用于下拉列表中显示每个 PM 的可用状态。
 */
export function getPmAvailabilitySuffix(
    available: boolean,
    source: 'project' | 'default',
): string {
    if (available) {
        return source === 'default' ? 'pm_default_available' : 'pm_project_available';
    }
    return 'pm_not_available';
}

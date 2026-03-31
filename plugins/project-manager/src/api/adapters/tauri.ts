import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { open as openDialogFn, save as saveDialogFn } from '@tauri-apps/plugin-dialog';
import { openUrl as openUrlFn } from '@tauri-apps/plugin-opener';
import { readTextFile as readTextFileFn, writeTextFile as writeTextFileFn } from '@tauri-apps/plugin-fs';
import type { PlatformAPI, ProjectInfo, TerminalInfo } from '../types';
import type { NodeVersion, GitStatusResult, GitBranch, GitCommit, GitSummary, GitCommitFile } from '../../types';

import { getCurrentWindow } from '@tauri-apps/api/window';

export class TauriAdapter implements PlatformAPI {
    private appWindow = getCurrentWindow();

    // NVM
    async getNvmList(): Promise<NodeVersion[]> {
        return invoke('get_nvm_list');
    }
    
    async installNode(version: string): Promise<string> {
        return invoke('install_node', { version });
    }
    
    async uninstallNode(version: string): Promise<string> {
        return invoke('uninstall_node', { version });
    }
    
    async useNode(version: string): Promise<string> {
        return invoke('use_node', { version });
    }
    
    async getSystemNodePath(): Promise<string> {
        return invoke('get_system_node_path');
    }

    async getNodeVersion(path: string): Promise<string> {
        return invoke('get_node_version', { path });
    }

    // Project
    async scanProject(path: string): Promise<ProjectInfo> {
        return invoke('scan_project', { path });
    }

    // Runner
    async runProjectCommand(id: string, path: string, script: string, packageManager: string, nodePath: string): Promise<void> {
        return invoke('run_project_command', { id, path, script, packageManager, nodePath });
    }

    async runCustomCommand(id: string, path: string, command: string): Promise<void> {
        return invoke('run_custom_command', { id, path, command });
    }
    
    async stopProjectCommand(id: string): Promise<void> {
        return invoke('stop_project_command', { id });
    }

    // System / Shell
    async openInEditor(path: string, editor?: string): Promise<void> {
        return invoke('open_in_editor', { path, editor });
    }

    async openInTerminal(path: string, terminal?: string): Promise<void> {
        return invoke('open_in_terminal', { path, terminal: terminal || 'cmd' });
    }
    
    async openFolder(path: string): Promise<void> {
        return invoke('open_folder', { path });
    }
    
    async openUrl(url: string): Promise<void> {
        // Prefer plugin if available, or backend if needed.
        // The project has both. Let's use the backend one if it does custom logic, 
        // or the plugin one if it's standard.
        // Settings.vue uses plugin.
        try {
            await openUrlFn(url);
        } catch (e) {
            // Fallback to invoke if plugin fails or if we prefer invoke
            return invoke('open_url', { url });
        }
    }

    // Config / FS
    async readConfigFile(filename: string): Promise<string> {
        return invoke('read_config_file', { filename });
    }
    
    async writeConfigFile(filename: string, content: string): Promise<void> {
        return invoke('write_config_file', { filename, content });
    }

    async readTextFile(path: string): Promise<string> {
        return readTextFileFn(path);
    }

    async writeTextFile(path: string, content: string): Promise<void> {
        return writeTextFileFn(path, content);
    }

    async readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
        return invoke('read_dir', { path });
    }

    // Updater
    async installUpdate(url: string): Promise<void> {
        return invoke('install_update', { url });
    }
    
    async cancelUpdate(): Promise<void> {
        return invoke('cancel_update');
    }
    
    async getAppVersion(): Promise<string> {
        return getVersion();
    }

    // Dialogs
    async openDialog(options: any): Promise<string | string[] | null> {
        return openDialogFn(options);
    }
    
    async saveDialog(options: any): Promise<string | null> {
        return saveDialogFn(options);
    }

    // Events
    async onProjectOutput(callback: (payload: { id: string; data: string }) => void): Promise<() => void> {
        return listen<any>('project-output', (event) => {
            callback(event.payload);
        });
    }

    async onProjectExit(callback: (payload: { id: string }) => void): Promise<() => void> {
        return listen<any>('project-exit', (event) => {
            callback(event.payload);
        });
    }
    
    async onDownloadProgress(callback: (percentage: number) => void): Promise<() => void> {
        return listen<number>('download-progress', (event) => {
            callback(event.payload);
        });
    }

    // Window
    async windowMinimize(): Promise<void> {
        return this.appWindow.minimize();
    }

    async windowMaximize(): Promise<void> {
        return this.appWindow.maximize();
    }

    async windowUnmaximize(): Promise<void> {
        return this.appWindow.unmaximize();
    }

    async windowClose(): Promise<void> {
        return this.appWindow.close();
    }

    async windowIsMaximized(): Promise<boolean> {
        return this.appWindow.isMaximized();
    }

    async windowSetAlwaysOnTop(always: boolean): Promise<void> {
        return this.appWindow.setAlwaysOnTop(always);
    }

    async onWindowResize(callback: () => void): Promise<() => void> {
        return this.appWindow.listen('tauri://resize', callback);
    }

    async onWindowFocus(callback: () => void): Promise<() => void> {
        return this.appWindow.listen('tauri://focus', callback);
    }

    // System Integration
    async setContextMenu(enable: boolean, locale?: string): Promise<void> {
        return invoke('set_context_menu', { enable, locale: locale || 'en' });
    }

    async checkContextMenu(): Promise<boolean> {
        return invoke('check_context_menu');
    }

    async isContextMenuSupported(): Promise<boolean> {
        return invoke('is_context_menu_supported');
    }

    async getPlatformInfo(): Promise<{ os: string; arch: string }> {
        return invoke('get_platform_info');
    }

    async detectAvailableTerminals(): Promise<TerminalInfo[]> {
        return invoke('detect_available_terminals');
    }

    // Git
    async gitCheck(path: string): Promise<boolean> {
        return invoke('git_check', { path });
    }

    async gitInit(path: string): Promise<string> {
        return invoke('git_init', { path });
    }

    async gitSummary(path: string): Promise<GitSummary> {
        return invoke('git_summary', { path });
    }

    async gitStatus(path: string): Promise<GitStatusResult> {
        return invoke('git_status', { path });
    }

    async gitStage(path: string, files: string[]): Promise<string> {
        return invoke('git_stage', { path, files });
    }

    async gitUnstage(path: string, files: string[]): Promise<string> {
        return invoke('git_unstage', { path, files });
    }

    async gitStageAll(path: string): Promise<string> {
        return invoke('git_stage_all', { path });
    }

    async gitUnstageAll(path: string): Promise<string> {
        return invoke('git_unstage_all', { path });
    }

    async gitCommit(path: string, message: string): Promise<string> {
        return invoke('git_commit', { path, message });
    }

    async gitPull(path: string, remote?: string, branch?: string): Promise<string> {
        return invoke('git_pull', { path, remote, branch });
    }

    async gitPush(path: string, remote?: string, branch?: string, force?: boolean, setUpstream?: boolean): Promise<string> {
        return invoke('git_push', { path, remote, branch, force, setUpstream });
    }

    async gitFetch(path: string, remote?: string): Promise<string> {
        return invoke('git_fetch', { path, remote });
    }

    async gitDiff(path: string, file?: string, staged?: boolean): Promise<string> {
        return invoke('git_diff', { path, file, staged });
    }

    async gitDiffCommit(path: string, hash: string): Promise<string> {
        return invoke('git_diff_commit', { path, hash });
    }

    async gitDiscard(path: string, files: string[]): Promise<string> {
        return invoke('git_discard', { path, files });
    }

    async gitDiscardUntracked(path: string, files: string[]): Promise<string> {
        return invoke('git_discard_untracked', { path, files });
    }

    async gitCurrentBranch(path: string): Promise<string> {
        return invoke('git_current_branch', { path });
    }

    async gitListBranches(path: string): Promise<GitBranch[]> {
        return invoke('git_list_branches', { path });
    }

    async gitSwitchBranch(path: string, branch: string): Promise<string> {
        return invoke('git_switch_branch', { path, branch });
    }

    async gitCreateAndSwitchBranch(path: string, name: string, startPoint?: string): Promise<string> {
        return invoke('git_create_and_switch_branch', { path, name, startPoint });
    }

    async gitDeleteBranch(path: string, name: string, force?: boolean): Promise<string> {
        return invoke('git_delete_branch', { path, name, force });
    }

    async gitRenameBranch(path: string, oldName: string, newName: string): Promise<string> {
        return invoke('git_rename_branch', { path, oldName, newName });
    }

    async gitHistory(path: string, maxCount?: number): Promise<GitCommit[]> {
        return invoke('git_history', { path, maxCount });
    }

    async gitCommitFiles(path: string, hash: string): Promise<GitCommitFile[]> {
        return invoke('git_commit_files', { path, hash });
    }

    async gitDiffCommitFile(path: string, hash: string, file: string): Promise<string> {
        return invoke('git_diff_commit_file', { path, hash, file });
    }

    async gitRevertHunk(path: string, patch: string, staged?: boolean): Promise<string> {
        return invoke('git_revert_hunk', { path, patch, staged });
    }
}

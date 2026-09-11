import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { open as openDialogFn, save as saveDialogFn } from '@tauri-apps/plugin-dialog';
import { openUrl as openUrlFn } from '@tauri-apps/plugin-opener';
import type {
    PlatformAPI,
    ProjectInfo,
    TerminalInfo,
    EditorInfo,
    PortEntry,
    PackageManagerResolveResult,
    WorkspaceDirEntry,
    WorkspaceStat,
    EditorFileSnapshot,
    EditorWriteResult,
    ProjectOutputPayload,
    ProjectExitPayload,
} from '../types';
import type {
    NodeVersion,
    NodeInstallProgress,
    NodeReleaseInfo,
    SystemNodeState,
    SystemNodeSwitchOptions,
    SystemNodeSwitchResult,
    GitStatusResult,
    GitBranch,
    GitCommit,
    GitSummary,
    GitCommitFile,
    GitOwnCommitResult,
    GitStashEntry,
    GitTag,
    GitResetMode,
    GitPullStrategy,
    GitIgnoreKind,
    GitHunkMode,
    GitImageDiffPayload,
    GitBinaryDiffMeta,
    ManagedRuntimeLocation,
    ManagedRuntimeLocationInfo,
    ManagedRuntimeSizeInfo,
} from '../../types';

import { getCurrentWindow } from '@tauri-apps/api/window';
import { assertSafeExternalUrl } from '../../utils/externalUrl';

export class TauriAdapter implements PlatformAPI {
    private appWindow = getCurrentWindow();

    async listInstalledNodeRuntimes(): Promise<NodeVersion[]> {
        return invoke('list_installed_node_runtimes');
    }

    async scanNvmNodeRuntimes(): Promise<NodeVersion[]> {
        return invoke('scan_nvm_node_runtimes');
    }

    async listAvailableNodeReleases(): Promise<NodeReleaseInfo[]> {
        return invoke('list_available_node_releases');
    }

    async installManagedNode(version: string, operationId?: string): Promise<string> {
        return invoke('install_managed_node', { version, operationId: operationId || null });
    }

    async cancelManagedNodeInstall(operationId: string): Promise<void> {
        return invoke('cancel_managed_node_install', { operationId });
    }

    async uninstallManagedNode(version: string): Promise<void> {
        return invoke('uninstall_managed_node', { version });
    }

    async getSystemNodePath(): Promise<string> {
        return invoke('get_system_node_path');
    }

    async getNodeVersion(path: string): Promise<string> {
        return invoke('get_node_version', { path });
    }

    async getSystemNodeState(): Promise<SystemNodeState> {
        return invoke('get_system_node_state');
    }

    async switchSystemNode(runtime: NodeVersion, options: SystemNodeSwitchOptions = {}): Promise<SystemNodeSwitchResult> {
        return invoke('switch_system_node', { runtime, options });
    }

    async systemNodeSwitchSupported(): Promise<boolean> {
        return invoke('system_node_switch_supported_command');
    }

    async managedNodeRuntimeSupported(): Promise<boolean> {
        return invoke('managed_node_runtime_supported');
    }

    async getManagedNodeRuntimeLocation(): Promise<ManagedRuntimeLocationInfo> {
        return invoke('get_managed_node_runtime_location');
    }

    async getManagedNodeRuntimeSize(): Promise<ManagedRuntimeSizeInfo> {
        return invoke('get_managed_node_runtime_size');
    }

    async openManagedNodeRuntimeRoot(): Promise<void> {
        return invoke('open_managed_node_runtime_root');
    }

    async migrateManagedNodeRuntimeLocation(
        location: ManagedRuntimeLocation,
        migrate: boolean,
        runningRuntimePaths: string[] = [],
    ): Promise<ManagedRuntimeLocationInfo> {
        return invoke('migrate_managed_node_runtime_location', {
            mode: location.mode,
            customPath: location.customPath || null,
            migrate,
            runningRuntimePaths,
        });
    }

    async onNodeRuntimeProgress(callback: (payload: NodeInstallProgress) => void): Promise<() => void> {
        return listen<NodeInstallProgress>('node-runtime-progress', (event) => {
            callback(event.payload);
        });
    }

    /** @deprecated */
    async getNvmList(): Promise<NodeVersion[]> {
        return this.listInstalledNodeRuntimes();
    }

    /** @deprecated */
    async installNode(version: string): Promise<string> {
        return this.installManagedNode(version);
    }

    /** @deprecated */
    async uninstallNode(version: string): Promise<string> {
        await this.uninstallManagedNode(version);
        return 'ok';
    }

    /** @deprecated */
    async useNode(_version: string): Promise<string> {
        throw new Error('use_node is deprecated; set the Project Manager default Node instead');
    }

    // Project
    async scanProject(path: string): Promise<ProjectInfo> {
        return invoke('scan_project', { path });
    }

    async scanSubProjects(path: string, maxDepth?: number): Promise<import('../types').ImportNode[]> {
        return invoke('scan_sub_projects', { path, maxDepth });
    }

    async scanImportTree(path: string): Promise<import('../types').ImportNode[]> {
        return invoke('scan_import_tree', { path });
    }

    async gitListRemoteBranches(url: string): Promise<string[]> {
        return invoke('git_list_remote_branches', { url });
    }

    async gitCloneBranch(url: string, branch: string, destination: string, operationId?: string): Promise<string> {
        return invoke('git_clone_branch', { url, branch, destination, operationId });
    }

    async gitCancelOperation(operationId: string): Promise<void> {
        return invoke('git_cancel_operation', { operationId });
    }

    // Runner
    async runProjectCommand(commandKey: string, sessionId: string, path: string, script: string, packageManager: string, nodePath: string, commandPath?: string, pmNodePath?: string): Promise<void> {
        return invoke('run_project_command', { commandKey, sessionId, path, script, packageManager, nodePath, commandPath: commandPath || null, pmNodePath: pmNodePath || null });
    }

    async runCustomCommand(commandKey: string, sessionId: string, path: string, command: string): Promise<void> {
        return invoke('run_custom_command', { commandKey, sessionId, path, command });
    }

    async stopProjectCommand(commandKey: string): Promise<void> {
        return invoke('stop_project_command', { commandKey });
    }

    async sendProjectInput(commandKey: string, input: string): Promise<void> {
        return invoke('send_project_input', { commandKey, input });
    }

    async closeProjectInput(commandKey: string): Promise<void> {
        return invoke('close_project_input', { commandKey });
    }

    async installPm(nodePath: string, pmName: string): Promise<void> {
        return invoke('install_pm', { nodePath, pmName });
    }

    async resolvePackageManager(nodePath: string, defaultNodePath: string, packageManager: string, source: 'project' | 'default'): Promise<PackageManagerResolveResult> {
        return invoke('resolve_pm', { nodePath, defaultNodePath, packageManager, source });
    }

    // System / Shell
    async openInEditor(path: string, editor?: string): Promise<void> {
        return invoke('open_in_editor', { path, editor });
    }

    async getHomeDirectory(): Promise<string> {
        return invoke('get_home_directory');
    }

    async openInTerminal(path: string, terminal?: string, nodePath?: string, packageManager?: string): Promise<void> {
        return invoke('open_in_terminal', { path, terminal: terminal || 'cmd', nodePath: nodePath || '', packageManager: packageManager || '' });
    }

    async openFolder(path: string): Promise<void> {
        return invoke('open_folder', { path });
    }

    async openPath(path: string): Promise<void> {
        return invoke('open_path', { path });
    }

    async revealInFolder(path: string): Promise<void> {
        return invoke('reveal_in_folder', { path });
    }

    async openUrl(url: string): Promise<void> {
        const safeUrl = assertSafeExternalUrl(url);
        // Prefer plugin if available, or backend if needed.
        // The project has both. Let's use the backend one if it does custom logic,
        // or the plugin one if it's standard.
        // Settings.vue uses plugin.
        try {
            await openUrlFn(safeUrl);
        } catch (e) {
            // Fallback to invoke if plugin fails or if we prefer invoke
            return invoke('open_url', { url: safeUrl });
        }
    }

    // Config / FS
    async readConfigFile(filename: string): Promise<string> {
        return invoke('read_config_file', { filename });
    }

    async writeConfigFile(filename: string, content: string): Promise<void> {
        return invoke('write_config_file', { filename, content });
    }

    async hasConfigBackup(filename: string): Promise<boolean> {
        return invoke('has_config_backup', { filename });
    }

    async readConfigBackup(filename: string): Promise<string> {
        return invoke('read_config_backup', { filename });
    }

    async restoreConfigBackup(filename: string): Promise<string> {
        return invoke('restore_config_backup', { filename });
    }

    async canOpenConfigDirectory(): Promise<boolean> {
        return true;
    }

    async openConfigDirectory(): Promise<void> {
        return invoke('open_config_directory');
    }

    async readTextFile(path: string): Promise<string> {
        return invoke('read_text_file', { path });
    }

    async readBinaryFileBase64(path: string): Promise<string> {
        return invoke('read_binary_file_base64', { path });
    }

    async writeTextFile(path: string, content: string): Promise<void> {
        return invoke('write_text_file', { path, content });
    }

    async readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
        return invoke('read_dir', { path });
    }

    async workspaceReadDir(root: string, relativePath: string): Promise<WorkspaceDirEntry[]> {
        return invoke('workspace_read_dir', { root, relativePath });
    }

    async workspaceCreateFile(root: string, relativePath: string): Promise<void> {
        return invoke('workspace_create_file', { root, relativePath });
    }

    async workspaceCreateDirectory(root: string, relativePath: string): Promise<void> {
        return invoke('workspace_create_directory', { root, relativePath });
    }

    async workspaceRename(root: string, fromRelative: string, toRelative: string): Promise<void> {
        return invoke('workspace_rename', { root, fromRelative, toRelative });
    }

    async workspaceTrash(root: string, relativePath: string): Promise<void> {
        return invoke('workspace_trash', { root, relativePath });
    }

    async workspaceStat(root: string, relativePath: string): Promise<WorkspaceStat> {
        return invoke('workspace_stat', { root, relativePath });
    }

    async workspaceReadEditorFile(root: string, relativePath: string): Promise<EditorFileSnapshot> {
        return invoke('workspace_read_editor_file', { root, relativePath });
    }

    async workspaceReadBinaryFileBase64(root: string, relativePath: string): Promise<string> {
        return invoke('workspace_read_binary_file_base64', { root, relativePath });
    }

    async workspaceWriteEditorFile(
        root: string,
        relativePath: string,
        content: string,
        expectedDiskVersion?: string,
        eol?: 'lf' | 'crlf',
        bom?: boolean,
        force?: boolean,
    ): Promise<EditorWriteResult> {
        return invoke('workspace_write_editor_file', {
            root,
            relativePath,
            content,
            expectedDiskVersion,
            eol,
            bom,
            force,
        });
    }

    async workspaceTrashMode(): Promise<'recycle_bin' | 'permanent'> {
        return invoke('workspace_trash_mode');
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
    async onProjectOutput(callback: (payload: ProjectOutputPayload) => void): Promise<() => void> {
        return listen<ProjectOutputPayload>('project-output', (event) => {
            callback(event.payload);
        });
    }

    async onProjectExit(callback: (payload: ProjectExitPayload) => void): Promise<() => void> {
        return listen<ProjectExitPayload>('project-exit', (event) => {
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

    async exitApp(): Promise<void> {
        return invoke('exit_app');
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

    async detectAvailableEditors(): Promise<EditorInfo[]> {
        return invoke('detect_available_editors');
    }

    async listUsedPorts(): Promise<PortEntry[]> {
        return invoke('list_used_ports');
    }

    async terminateProcessByPid(pid: number): Promise<void> {
        return invoke('terminate_process_by_pid', { pid });
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

    async gitAmend(path: string, message?: string): Promise<string> {
        return invoke('git_amend', { path, message });
    }

    async gitPull(
        path: string,
        remote?: string,
        branch?: string,
        operationId?: string,
        strategy?: GitPullStrategy,
    ): Promise<string> {
        return invoke('git_pull', { path, remote, branch, operationId, strategy });
    }

    async gitPush(
        path: string,
        remote?: string,
        branch?: string,
        force?: boolean,
        setUpstream?: boolean,
        operationId?: string,
        forceWithLease?: boolean,
    ): Promise<string> {
        return invoke('git_push', {
            path,
            remote,
            branch,
            force,
            setUpstream,
            operationId,
            forceWithLease,
        });
    }

    async gitFetch(path: string, remote?: string, operationId?: string): Promise<string> {
        return invoke('git_fetch', { path, remote, operationId });
    }

    async gitDiff(path: string, file?: string, staged?: boolean): Promise<string> {
        return invoke('git_diff', { path, file, staged });
    }

    async gitDiffForAi(path: string): Promise<string> {
        return invoke('git_diff_for_ai', { path });
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

    async gitMerge(path: string, branch: string): Promise<string> {
        return invoke('git_merge', { path, branch });
    }

    async gitMergeContinue(path: string): Promise<string> {
        return invoke('git_merge_continue', { path });
    }

    async gitMergeAbort(path: string): Promise<string> {
        return invoke('git_merge_abort', { path });
    }

    async gitRebase(path: string, branch: string): Promise<string> {
        return invoke('git_rebase', { path, branch });
    }

    async gitReset(path: string, mode: GitResetMode, target?: string): Promise<string> {
        return invoke('git_reset', { path, mode, target });
    }

    async gitCherryPick(path: string, hash: string): Promise<string> {
        return invoke('git_cherry_pick', { path, hash });
    }

    async gitRevertCommit(path: string, hash: string): Promise<string> {
        return invoke('git_revert_commit', { path, hash });
    }

    async gitStashList(path: string): Promise<GitStashEntry[]> {
        return invoke('git_stash_list', { path });
    }

    async gitStashSave(path: string, message?: string): Promise<string> {
        return invoke('git_stash_save', { path, message });
    }

    async gitStashPop(path: string, index?: number): Promise<string> {
        return invoke('git_stash_pop', { path, index });
    }

    async gitStashApply(path: string, index?: number): Promise<string> {
        return invoke('git_stash_apply', { path, index });
    }

    async gitStashDrop(path: string, index: number): Promise<string> {
        return invoke('git_stash_drop', { path, index });
    }

    async gitTags(path: string): Promise<GitTag[]> {
        return invoke('git_tags', { path });
    }

    async gitCreateTag(path: string, name: string, message?: string, target?: string): Promise<string> {
        return invoke('git_create_tag', { path, name, message, target });
    }

    async gitDeleteTag(path: string, name: string): Promise<string> {
        return invoke('git_delete_tag', { path, name });
    }

    async gitHistory(path: string, maxCount?: number): Promise<GitCommit[]> {
        return invoke('git_history', { path, maxCount });
    }

    async gitOwnCommits(path: string, since: string, until: string): Promise<GitOwnCommitResult> {
        return invoke('git_own_commits', { path, since, until });
    }

    async gitCommitDetail(path: string, hash: string): Promise<GitCommit> {
        return invoke('git_commit_detail', { path, hash });
    }

    async gitCommitFiles(path: string, hash: string): Promise<GitCommitFile[]> {
        return invoke('git_commit_files', { path, hash });
    }

    async gitDiffCommitFile(path: string, hash: string, file: string): Promise<string> {
        return invoke('git_diff_commit_file', { path, hash, file });
    }

    async gitGetImageDiff(path: string, file: string, staged?: boolean, commit?: string, oldPath?: string): Promise<GitImageDiffPayload> {
        return invoke('git_get_image_diff', { path, file, staged, commit, oldPath });
    }

    async gitGetBinaryDiffMeta(path: string, file: string, staged?: boolean, commit?: string, oldPath?: string): Promise<GitBinaryDiffMeta> {
        return invoke('git_get_binary_diff_meta', { path, file, staged, commit, oldPath });
    }

    async gitFileHistory(path: string, file: string, maxCount?: number): Promise<GitCommit[]> {
        return invoke('git_file_history', { path, file, maxCount });
    }

    async gitAddIgnorePattern(path: string, files: string[], kind: GitIgnoreKind, local?: boolean): Promise<string[]> {
        return invoke('git_add_ignore_pattern', { path, files, kind, local });
    }

    async gitStopTracking(path: string, files: string[], kind: GitIgnoreKind, local?: boolean): Promise<string> {
        return invoke('git_stop_tracking', { path, files, kind, local });
    }

    async gitApplyHunk(path: string, patch: string, mode: GitHunkMode): Promise<string> {
        return invoke('git_apply_hunk', { path, patch, mode });
    }

    async gitRevertHunk(path: string, patch: string, staged?: boolean): Promise<string> {
        return invoke('git_revert_hunk', { path, patch, staged });
    }

    async gitRemoteList(path: string): Promise<import('../../types').GitRemote[]> {
        return invoke('git_remote_list', { path });
    }

    async gitRemoteAdd(path: string, name: string, url: string): Promise<string> {
        return invoke('git_remote_add', { path, name, url });
    }

    async gitRemoteSetUrl(path: string, name: string, url: string): Promise<string> {
        return invoke('git_remote_set_url', { path, name, url });
    }

    async gitRemoteRemove(path: string, name: string): Promise<string> {
        return invoke('git_remote_remove', { path, name });
    }
}

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
import { assertSafeExternalUrl } from '../../utils/externalUrl';

// Declare global interface for uTools services
declare global {
  interface Window {
    services: PlatformAPI;
  }
}

export class UToolsAdapter implements PlatformAPI {
  private get service() {
    if (!window.services) {
        console.warn('uTools services not found on window object. Are you running in uTools?');
        // Return a mock or throw? Throwing is better to catch issues.
        // For development outside uTools but selecting this adapter, we might fail.
        throw new Error('uTools services not initialized');
    }
    return window.services;
  }

  listInstalledNodeRuntimes(): Promise<NodeVersion[]> {
    return this.service.listInstalledNodeRuntimes
      ? this.service.listInstalledNodeRuntimes()
      : this.service.getNvmList();
  }
  scanNvmNodeRuntimes(): Promise<NodeVersion[]> {
    const service = this.service as PlatformAPI & { scanNvmNodeRuntimes?: () => Promise<NodeVersion[]> };
    return service.scanNvmNodeRuntimes ? service.scanNvmNodeRuntimes() : Promise.resolve([]);
  }
  listAvailableNodeReleases(): Promise<NodeReleaseInfo[]> {
    return this.service.listAvailableNodeReleases
      ? this.service.listAvailableNodeReleases()
      : Promise.resolve([]);
  }
  installManagedNode(version: string, operationId?: string): Promise<string> {
    if (this.service.installManagedNode) return this.service.installManagedNode(version, operationId);
    return Promise.reject(new Error('Managed Node runtime is not supported in this plugin'));
  }
  cancelManagedNodeInstall(operationId: string): Promise<void> {
    if (this.service.cancelManagedNodeInstall) return this.service.cancelManagedNodeInstall(operationId);
    return Promise.reject(new Error('Managed Node runtime is not supported in this plugin'));
  }
  uninstallManagedNode(version: string): Promise<void> {
    if (this.service.uninstallManagedNode) return this.service.uninstallManagedNode(version);
    return Promise.reject(new Error('Managed Node runtime is not supported in this plugin'));
  }
  getSystemNodePath(): Promise<string> { return this.service.getSystemNodePath(); }
  getNodeVersion(path: string): Promise<string> { return this.service.getNodeVersion(path); }
  async getSystemNodeState(): Promise<SystemNodeState> {
    const service = this.service as PlatformAPI & { getSystemNodeState?: () => Promise<SystemNodeState> };
    if (service.getSystemNodeState) return service.getSystemNodeState();
    const nodePath = await this.getSystemNodePath();
    const version = nodePath ? await this.getNodeVersion(nodePath) : '';
    return {
      available: !!nodePath && !!version,
      version: version || undefined,
      nodePath: nodePath || undefined,
      source: 'unknown',
      candidates: nodePath ? [{ path: nodePath, version: version || undefined }] : [],
      pathScope: 'unknown',
    };
  }
  systemNodeSwitchSupported(): Promise<boolean> {
    const service = this.service as PlatformAPI & { systemNodeSwitchSupported?: () => Promise<boolean> };
    return service.systemNodeSwitchSupported ? service.systemNodeSwitchSupported() : Promise.resolve(false);
  }
  switchSystemNode(_runtime: NodeVersion, _options: SystemNodeSwitchOptions = {}): Promise<SystemNodeSwitchResult> {
    return Promise.resolve({
      success: false,
      status: 'failed',
      errorCode: 'unsupported_platform',
      message: 'System Node switching is only supported in the desktop app',
    });
  }
  managedNodeRuntimeSupported(): Promise<boolean> {
    return this.service.managedNodeRuntimeSupported
      ? this.service.managedNodeRuntimeSupported()
      : Promise.resolve(false);
  }
  getManagedNodeRuntimeLocation(): Promise<ManagedRuntimeLocationInfo> {
    const service = this.service as PlatformAPI & { getManagedNodeRuntimeLocation?: () => Promise<ManagedRuntimeLocationInfo> };
    if (service.getManagedNodeRuntimeLocation) return service.getManagedNodeRuntimeLocation();
    return Promise.resolve({
      mode: 'app-data',
      rootPath: '',
      writable: false,
      portableAvailable: false,
      installedCount: 0,
      sizeBytes: 0,
      sizeStatus: 'ready',
    });
  }
  async getManagedNodeRuntimeSize(): Promise<ManagedRuntimeSizeInfo> {
    const service = this.service as PlatformAPI & { getManagedNodeRuntimeSize?: () => Promise<ManagedRuntimeSizeInfo> };
    if (service.getManagedNodeRuntimeSize) return service.getManagedNodeRuntimeSize();
    const location = await this.getManagedNodeRuntimeLocation();
    return {
      sizeBytes: location.sizeBytes,
      sizeStatus: location.sizeStatus || 'ready',
      warnings: location.warnings,
    };
  }
  async openManagedNodeRuntimeRoot(): Promise<void> {
    const service = this.service as PlatformAPI & { openManagedNodeRuntimeRoot?: () => Promise<void> };
    if (service.openManagedNodeRuntimeRoot) {
      return service.openManagedNodeRuntimeRoot();
    }
    const location = await this.getManagedNodeRuntimeLocation();
    if (!location.rootPath) throw new Error('Managed Node runtime root is unavailable in this plugin');
    return this.openFolder(location.rootPath);
  }
  migrateManagedNodeRuntimeLocation(
    location: ManagedRuntimeLocation,
    migrate: boolean,
    runningRuntimePaths: string[] = [],
  ): Promise<ManagedRuntimeLocationInfo> {
    const service = this.service as PlatformAPI & {
      migrateManagedNodeRuntimeLocation?: (
        location: ManagedRuntimeLocation,
        migrate: boolean,
        runningRuntimePaths?: string[],
      ) => Promise<ManagedRuntimeLocationInfo>;
    };
    if (service.migrateManagedNodeRuntimeLocation) {
      return service.migrateManagedNodeRuntimeLocation(location, migrate, runningRuntimePaths);
    }
    return Promise.reject(new Error('Managed Node runtime location is not supported in this plugin'));
  }
  onNodeRuntimeProgress(callback: (payload: NodeInstallProgress) => void): Promise<() => void> {
    if (this.service.onNodeRuntimeProgress) return this.service.onNodeRuntimeProgress(callback);
    return Promise.resolve(() => undefined);
  }
  getNvmList(): Promise<NodeVersion[]> { return this.listInstalledNodeRuntimes(); }
  installNode(version: string): Promise<string> { return this.installManagedNode(version); }
  uninstallNode(version: string): Promise<string> {
    return this.uninstallManagedNode(version).then(() => 'ok');
  }
  useNode(_version: string): Promise<string> {
    return Promise.reject(new Error('use_node is deprecated; set the Project Manager default Node instead'));
  }

  scanProject(path: string): Promise<ProjectInfo> { return this.service.scanProject(path); }
  scanSubProjects(path: string, maxDepth?: number): Promise<import('../types').ImportNode[]> {
    // uTools/ZTools 运行时无该能力，降级为空结果
    return (this.service as any).scanSubProjects ? (this.service as any).scanSubProjects(path, maxDepth) : Promise.resolve([]);
  }
  scanImportTree(path: string): Promise<import('../types').ImportNode[]> {
    return (this.service as any).scanImportTree ? (this.service as any).scanImportTree(path) : Promise.resolve([]);
  }
  gitListRemoteBranches(url: string): Promise<string[]> { return this.service.gitListRemoteBranches(url); }
  gitCloneBranch(url: string, branch: string, destination: string, operationId?: string): Promise<string> { return this.service.gitCloneBranch(url, branch, destination, operationId); }
  gitCancelOperation(operationId: string): Promise<void> {
    return this.service.gitCancelOperation ? this.service.gitCancelOperation(operationId) : Promise.resolve();
  }

  runProjectCommand(commandKey: string, sessionId: string, path: string, script: string, packageManager: string, nodePath: string, commandPath?: string, pmNodePath?: string): Promise<void> {
    if ((this.service as any).runProjectCommandWithCommandPath) {
      return (this.service as any).runProjectCommandWithCommandPath(commandKey, sessionId, path, script, packageManager, nodePath, commandPath || '', pmNodePath || '');
    }
    return this.service.runProjectCommand(commandKey, sessionId, path, script, packageManager, nodePath);
  }
  runCustomCommand(commandKey: string, sessionId: string, path: string, command: string): Promise<void> {
    return this.service.runCustomCommand(commandKey, sessionId, path, command);
  }
  stopProjectCommand(commandKey: string): Promise<void> { return this.service.stopProjectCommand(commandKey); }
  sendProjectInput(commandKey: string, input: string): Promise<void> {
    return this.service.sendProjectInput(commandKey, input);
  }
  closeProjectInput(commandKey: string): Promise<void> {
    return this.service.closeProjectInput(commandKey);
  }
  installPm(nodePath: string, pmName: string): Promise<void> {
      if ((this.service as any).installPm) {
          return (this.service as any).installPm(nodePath, pmName);
      }
      return Promise.reject(new Error('installPm not supported'));
  }

  resolvePackageManager(nodePath: string, defaultNodePath: string, packageManager: string, source: 'project' | 'default'): Promise<PackageManagerResolveResult> {
      if ((this.service as any).resolvePackageManager) {
          return (this.service as any).resolvePackageManager(nodePath, defaultNodePath, packageManager, source);
      }
      return Promise.resolve({
          available: false,
          reason: source === 'default' ? 'pm_not_installed_in_default_node' : 'pm_not_installed_in_project_node',
      });
  }

  openInEditor(path: string, editor?: string): Promise<void> { return this.service.openInEditor(path, editor); }
  getHomeDirectory(): Promise<string> {
    const service = this.service as PlatformAPI & { getHomeDirectory?: () => Promise<string> };
    return service.getHomeDirectory ? service.getHomeDirectory() : Promise.resolve('.');
  }
    openInTerminal(path: string, terminal?: string, nodePath?: string, packageManager?: string): Promise<void> {
        if ((this.service as any).openInTerminal) {
            return (this.service as any).openInTerminal(path, terminal, nodePath, packageManager);
        }
        return this.service.openFolder(path);
  }
  openFolder(path: string): Promise<void> { return this.service.openFolder(path); }
  openPath(path: string): Promise<void> {
    const service = this.service as PlatformAPI & { openPath?: (path: string) => Promise<void> };
    if (typeof service.openPath === 'function') return service.openPath(path);
    return this.service.openFolder(path);
  }
  revealInFolder(path: string): Promise<void> {
    const service = this.service as PlatformAPI & { revealInFolder?: (path: string) => Promise<void> };
    if (typeof service.revealInFolder === 'function') return service.revealInFolder(path);
    const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const parent = separatorIndex > 0 ? path.slice(0, separatorIndex) : path;
    return this.service.openFolder(parent);
  }
  openUrl(url: string): Promise<void> { return this.service.openUrl(assertSafeExternalUrl(url)); }

  readConfigFile(filename: string): Promise<string> { return this.service.readConfigFile(filename); }
  writeConfigFile(filename: string, content: string): Promise<void> { return this.service.writeConfigFile(filename, content); }
  hasConfigBackup(filename: string): Promise<boolean> {
    const service = this.service as PlatformAPI & { hasConfigBackup?: (filename: string) => Promise<boolean> };
    return typeof service.hasConfigBackup === 'function' ? service.hasConfigBackup(filename) : Promise.resolve(false);
  }
  readConfigBackup(filename: string): Promise<string> {
    const service = this.service as PlatformAPI & { readConfigBackup?: (filename: string) => Promise<string> };
    return typeof service.readConfigBackup === 'function'
      ? service.readConfigBackup(filename)
      : Promise.reject(new Error('Config backup recovery is unavailable in this host.'));
  }
  restoreConfigBackup(filename: string): Promise<string> {
    const service = this.service as PlatformAPI & { restoreConfigBackup?: (filename: string) => Promise<string> };
    return typeof service.restoreConfigBackup === 'function'
      ? service.restoreConfigBackup(filename)
      : Promise.reject(new Error('Config backup recovery is unavailable in this host.'));
  }
  canOpenConfigDirectory(): Promise<boolean> {
    const service = this.service as PlatformAPI & { canOpenConfigDirectory?: () => Promise<boolean> };
    return typeof service.canOpenConfigDirectory === 'function' ? service.canOpenConfigDirectory() : Promise.resolve(false);
  }
  openConfigDirectory(): Promise<void> {
    const service = this.service as PlatformAPI & { openConfigDirectory?: () => Promise<void> };
    return typeof service.openConfigDirectory === 'function'
      ? service.openConfigDirectory()
      : Promise.reject(new Error('Opening the config directory is unavailable in this host.'));
  }
  readTextFile(path: string): Promise<string> { return this.service.readTextFile(path); }
  readBinaryFileBase64(path: string): Promise<string> { return this.service.readBinaryFileBase64(path); }
  writeTextFile(path: string, content: string): Promise<void> { return this.service.writeTextFile(path, content); }
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]> { return this.service.readDir(path); }

  workspaceReadDir(root: string, relativePath: string): Promise<WorkspaceDirEntry[]> {
    return this.service.workspaceReadDir(root, relativePath);
  }
  workspaceCreateFile(root: string, relativePath: string): Promise<void> {
    return this.service.workspaceCreateFile(root, relativePath);
  }
  workspaceCreateDirectory(root: string, relativePath: string): Promise<void> {
    return this.service.workspaceCreateDirectory(root, relativePath);
  }
  workspaceRename(root: string, fromRelative: string, toRelative: string): Promise<void> {
    return this.service.workspaceRename(root, fromRelative, toRelative);
  }
  workspaceTrash(root: string, relativePath: string): Promise<void> {
    return this.service.workspaceTrash(root, relativePath);
  }
  workspaceStat(root: string, relativePath: string): Promise<WorkspaceStat> {
    return this.service.workspaceStat(root, relativePath);
  }
  workspaceReadEditorFile(root: string, relativePath: string): Promise<EditorFileSnapshot> {
    return this.service.workspaceReadEditorFile(root, relativePath);
  }
  workspaceReadBinaryFileBase64(root: string, relativePath: string): Promise<string> {
    return this.service.workspaceReadBinaryFileBase64(root, relativePath);
  }
  workspaceWriteEditorFile(
    root: string,
    relativePath: string,
    content: string,
    expectedDiskVersion?: string,
    eol?: 'lf' | 'crlf',
    bom?: boolean,
    force?: boolean,
  ): Promise<EditorWriteResult> {
    return this.service.workspaceWriteEditorFile(root, relativePath, content, expectedDiskVersion, eol, bom, force);
  }
  workspaceTrashMode(): Promise<'recycle_bin' | 'permanent'> {
    return this.service.workspaceTrashMode();
  }

  getAppVersion(): Promise<string> { return this.service.getAppVersion(); }

  openDialog(options: any): Promise<string | string[] | null> { return this.service.openDialog(options); }
  saveDialog(options: any): Promise<string | null> { return this.service.saveDialog(options); }

  onProjectOutput(callback: (payload: ProjectOutputPayload) => void): Promise<() => void> {
    return this.service.onProjectOutput(callback);
  }
 async onProjectExit(callback: (payload: ProjectExitPayload) => void): Promise<() => void> {
    return this.service.onProjectExit(callback);
  }

  // Window
  async windowMinimize(): Promise<void> {
      if ((this.service as any).windowMinimize) {
          return (this.service as any).windowMinimize();
      }
      return Promise.resolve();
  }

  async windowMaximize(): Promise<void> {
      return Promise.resolve();
  }

  async windowUnmaximize(): Promise<void> {
      return Promise.resolve();
  }

  async windowClose(): Promise<void> {
      if ((this.service as any).windowClose) {
          return (this.service as any).windowClose();
      }
      return Promise.resolve();
  }

  async exitApp(): Promise<void> {
      return this.windowClose();
  }

  async windowIsMaximized(): Promise<boolean> {
      return Promise.resolve(true);
  }

  async windowSetAlwaysOnTop(always: boolean): Promise<void> {
      console.log('windowSetAlwaysOnTop', always);
      return Promise.resolve();
  }

  async onWindowResize(callback: () => void): Promise<() => void> {
      console.log('onWindowResize registered', callback);
      return Promise.resolve(() => {});
  }

  async onWindowFocus(callback: () => void): Promise<() => void> {
      console.log('onWindowFocus registered', callback);
      return Promise.resolve(() => {});
  }

  // System Integration
  async setContextMenu(_enable: boolean, _locale?: string): Promise<void> {
      // Not supported in uTools
      return Promise.resolve();
  }

  async checkContextMenu(): Promise<boolean> {
      return false;
  }

  async isContextMenuSupported(): Promise<boolean> {
      return Promise.resolve(false);
  }

  async getPlatformInfo(): Promise<{ os: string; arch: string }> {
      // Fallback for uTools if service doesn't provide it
      // Usually uTools runs on Electron, so we might check navigator
      if (this.service.getPlatformInfo) {
          return this.service.getPlatformInfo();
      }
      return Promise.resolve({
          os: navigator.platform.toLowerCase().includes('win') ? 'windows' :
              navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'linux',
          arch: 'x86_64' // default fallback
      });
  }

  async detectAvailableTerminals(): Promise<TerminalInfo[]> {
      if (this.service.detectAvailableTerminals) {
          return this.service.detectAvailableTerminals();
      }
      return Promise.resolve([
          { id: 'cmd', name: 'Command Prompt (cmd.exe)' }
      ]);
  }

  async detectAvailableEditors(): Promise<EditorInfo[]> {
      if ((this.service as any).detectAvailableEditors) {
          return (this.service as any).detectAvailableEditors();
      }
      return Promise.resolve([]);
  }

  async listUsedPorts(): Promise<PortEntry[]> {
      if (this.service.listUsedPorts) {
          return this.service.listUsedPorts();
      }
      return Promise.reject(new Error('Port management is not supported in plugin mode'));
  }

  async terminateProcessByPid(pid: number): Promise<void> {
      if ((this.service as any).terminateProcessByPid) {
          return (this.service as any).terminateProcessByPid(pid);
      }
      return Promise.reject(new Error('Port management is not supported in plugin mode'));
  }

  // Git
  async gitCheck(path: string): Promise<boolean> { return this.service.gitCheck(path); }
  async gitInit(path: string): Promise<string> { return this.service.gitInit(path); }
  async gitSummary(path: string): Promise<GitSummary> { return this.service.gitSummary(path); }
  async gitStatus(path: string): Promise<GitStatusResult> { return this.service.gitStatus(path); }
  async gitStage(path: string, files: string[]): Promise<string> { return this.service.gitStage(path, files); }
  async gitUnstage(path: string, files: string[]): Promise<string> { return this.service.gitUnstage(path, files); }
  async gitStageAll(path: string): Promise<string> { return this.service.gitStageAll(path); }
  async gitUnstageAll(path: string): Promise<string> { return this.service.gitUnstageAll(path); }
  async gitCommit(path: string, message: string): Promise<string> { return this.service.gitCommit(path, message); }
  async gitAmend(path: string, message?: string): Promise<string> { return this.service.gitAmend(path, message); }
  async gitPull(
    path: string,
    remote?: string,
    branch?: string,
    operationId?: string,
    strategy?: GitPullStrategy,
  ): Promise<string> {
    return this.service.gitPull(path, remote, branch, operationId, strategy);
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
    return this.service.gitPush(path, remote, branch, force, setUpstream, operationId, forceWithLease);
  }
  async gitFetch(path: string, remote?: string, operationId?: string): Promise<string> { return this.service.gitFetch(path, remote, operationId); }
  async gitDiff(path: string, file?: string, staged?: boolean): Promise<string> { return this.service.gitDiff(path, file, staged); }
  async gitDiffForAi(path: string): Promise<string> {
      if ((this.service as any).gitDiffForAi) {
          return (this.service as any).gitDiffForAi(path);
      }
      return this.service.gitDiff(path, undefined, true);
  }
  async gitDiffCommit(path: string, hash: string): Promise<string> { return this.service.gitDiffCommit(path, hash); }
  async gitDiscard(path: string, files: string[]): Promise<string> { return this.service.gitDiscard(path, files); }
  async gitDiscardUntracked(path: string, files: string[]): Promise<string> { return this.service.gitDiscardUntracked(path, files); }
  async gitCurrentBranch(path: string): Promise<string> { return this.service.gitCurrentBranch(path); }
  async gitListBranches(path: string): Promise<GitBranch[]> { return this.service.gitListBranches(path); }
  async gitSwitchBranch(path: string, branch: string): Promise<string> { return this.service.gitSwitchBranch(path, branch); }
  async gitCreateAndSwitchBranch(path: string, name: string, startPoint?: string): Promise<string> { return this.service.gitCreateAndSwitchBranch(path, name, startPoint); }
  async gitDeleteBranch(path: string, name: string, force?: boolean): Promise<string> { return this.service.gitDeleteBranch(path, name, force); }
  async gitRenameBranch(path: string, oldName: string, newName: string): Promise<string> { return this.service.gitRenameBranch(path, oldName, newName); }
  async gitMerge(path: string, branch: string): Promise<string> { return this.service.gitMerge(path, branch); }
  async gitMergeContinue(path: string): Promise<string> { return this.service.gitMergeContinue(path); }
  async gitMergeAbort(path: string): Promise<string> { return this.service.gitMergeAbort(path); }
  async gitRebase(path: string, branch: string): Promise<string> { return this.service.gitRebase(path, branch); }
  async gitReset(path: string, mode: GitResetMode, target?: string): Promise<string> { return this.service.gitReset(path, mode, target); }
  async gitCherryPick(path: string, hash: string): Promise<string> { return this.service.gitCherryPick(path, hash); }
  async gitRevertCommit(path: string, hash: string): Promise<string> { return this.service.gitRevertCommit(path, hash); }
  async gitStashList(path: string): Promise<GitStashEntry[]> { return this.service.gitStashList(path); }
  async gitStashSave(path: string, message?: string): Promise<string> { return this.service.gitStashSave(path, message); }
  async gitStashPop(path: string, index?: number): Promise<string> { return this.service.gitStashPop(path, index); }
  async gitStashApply(path: string, index?: number): Promise<string> { return this.service.gitStashApply(path, index); }
  async gitStashDrop(path: string, index: number): Promise<string> { return this.service.gitStashDrop(path, index); }
  async gitTags(path: string): Promise<GitTag[]> { return this.service.gitTags(path); }
  async gitCreateTag(path: string, name: string, message?: string, target?: string): Promise<string> {
    return this.service.gitCreateTag(path, name, message, target);
  }
  async gitDeleteTag(path: string, name: string): Promise<string> { return this.service.gitDeleteTag(path, name); }
  async gitHistory(path: string, maxCount?: number): Promise<GitCommit[]> { return this.service.gitHistory(path, maxCount); }
  async gitOwnCommits(path: string, since: string, until: string): Promise<GitOwnCommitResult> {
      if ((this.service as any).gitOwnCommits) {
          return (this.service as any).gitOwnCommits(path, since, until);
      }
      void path;
      void since;
      void until;
      return Promise.reject(new Error('gitOwnCommits not supported'));
  }
  async gitCommitDetail(path: string, hash: string): Promise<GitCommit> {
      if ((this.service as any).gitCommitDetail) {
          return (this.service as any).gitCommitDetail(path, hash);
      }
      const commits = await this.service.gitHistory(path, 200);
      const found = commits.find(commit => commit.hash === hash);
      if (!found) {
          throw new Error('Commit not found');
      }
      return found;
  }
  async gitCommitFiles(path: string, hash: string): Promise<GitCommitFile[]> { return this.service.gitCommitFiles(path, hash); }
  async gitDiffCommitFile(path: string, hash: string, file: string): Promise<string> { return this.service.gitDiffCommitFile(path, hash, file); }
  async gitGetImageDiff(path: string, file: string, staged?: boolean, commit?: string, oldPath?: string): Promise<GitImageDiffPayload> {
    const method = (this.service as any).gitGetImageDiff;
    if (typeof method !== 'function') throw new Error('Image diff is not supported by this plugin runtime');
    return method.call(this.service, path, file, staged, commit, oldPath);
  }
  async gitGetBinaryDiffMeta(path: string, file: string, staged?: boolean, commit?: string, oldPath?: string): Promise<GitBinaryDiffMeta> {
    const method = (this.service as any).gitGetBinaryDiffMeta;
    if (typeof method !== 'function') throw new Error('Binary diff metadata is not supported by this plugin runtime');
    return method.call(this.service, path, file, staged, commit, oldPath);
  }
  async gitFileHistory(path: string, file: string, maxCount?: number): Promise<GitCommit[]> {
    const method = (this.service as any).gitFileHistory;
    if (typeof method !== 'function') throw new Error('File history is not supported by this plugin runtime');
    return method.call(this.service, path, file, maxCount);
  }
  async gitAddIgnorePattern(path: string, files: string[], kind: GitIgnoreKind, local?: boolean): Promise<string[]> {
    const method = (this.service as any).gitAddIgnorePattern;
    if (typeof method !== 'function') throw new Error('Ignore rules are not supported by this plugin runtime');
    return method.call(this.service, path, files, kind, local);
  }
  async gitStopTracking(path: string, files: string[], kind: GitIgnoreKind, local?: boolean): Promise<string> {
    const method = (this.service as any).gitStopTracking;
    if (typeof method !== 'function') throw new Error('Stop tracking is not supported by this plugin runtime');
    return method.call(this.service, path, files, kind, local);
  }
  async gitApplyHunk(path: string, patch: string, mode: GitHunkMode): Promise<string> {
    const method = (this.service as any).gitApplyHunk;
    if (typeof method !== 'function') throw new Error('Hunk operations are not supported by this plugin runtime');
    return method.call(this.service, path, patch, mode);
  }
  async gitRevertHunk(path: string, patch: string, staged?: boolean): Promise<string> { return this.service.gitRevertHunk(path, patch, staged); }
    async gitRemoteList(path: string): Promise<import('../../types').GitRemote[]> { return this.service.gitRemoteList(path); }
    async gitRemoteAdd(path: string, name: string, url: string): Promise<string> { return this.service.gitRemoteAdd(path, name, url); }
    async gitRemoteSetUrl(path: string, name: string, url: string): Promise<string> { return this.service.gitRemoteSetUrl(path, name, url); }
    async gitRemoteRemove(path: string, name: string): Promise<string> { return this.service.gitRemoteRemove(path, name); }
}

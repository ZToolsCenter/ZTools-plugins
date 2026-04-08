import type { PlatformAPI, ProjectInfo, TerminalInfo } from '../types';
import type { NodeVersion, GitStatusResult, GitBranch, GitCommit, GitSummary, GitCommitFile } from '../../types';

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

  getNvmList(): Promise<NodeVersion[]> { return this.service.getNvmList(); }
  installNode(version: string): Promise<string> { return this.service.installNode(version); }
  uninstallNode(version: string): Promise<string> { return this.service.uninstallNode(version); }
  useNode(version: string): Promise<string> { return this.service.useNode(version); }
  getSystemNodePath(): Promise<string> { return this.service.getSystemNodePath(); }
  getNodeVersion(path: string): Promise<string> { return this.service.getNodeVersion(path); }

  scanProject(path: string): Promise<ProjectInfo> { return this.service.scanProject(path); }
  gitListRemoteBranches(url: string): Promise<string[]> { return this.service.gitListRemoteBranches(url); }
  gitCloneBranch(url: string, branch: string, destination: string, operationId?: string): Promise<string> { return this.service.gitCloneBranch(url, branch, destination, operationId); }
  gitCancelOperation(operationId: string): Promise<void> {
    return this.service.gitCancelOperation ? this.service.gitCancelOperation(operationId) : Promise.resolve();
  }

  runProjectCommand(id: string, path: string, script: string, packageManager: string, nodePath: string): Promise<void> {
    return this.service.runProjectCommand(id, path, script, packageManager, nodePath);
  }
  runCustomCommand(id: string, path: string, command: string): Promise<void> {
    return this.service.runCustomCommand(id, path, command);
  }
  stopProjectCommand(id: string): Promise<void> { return this.service.stopProjectCommand(id); }

  openInEditor(path: string, editor?: string): Promise<void> { return this.service.openInEditor(path, editor); }
    openInTerminal(path: string, terminal?: string): Promise<void> {
        if ((this.service as any).openInTerminal) {
            return (this.service as any).openInTerminal(path, terminal);
        }
        return this.service.openFolder(path);
    }
  openFolder(path: string): Promise<void> { return this.service.openFolder(path); }
  openUrl(url: string): Promise<void> { return this.service.openUrl(url); }

  readConfigFile(filename: string): Promise<string> { return this.service.readConfigFile(filename); }
  writeConfigFile(filename: string, content: string): Promise<void> { return this.service.writeConfigFile(filename, content); }
  readTextFile(path: string): Promise<string> { return this.service.readTextFile(path); }
  readBinaryFileBase64(path: string): Promise<string> { return this.service.readBinaryFileBase64(path); }
  writeTextFile(path: string, content: string): Promise<void> { return this.service.writeTextFile(path, content); }
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]> { return this.service.readDir(path); }

  installUpdate(url: string): Promise<void> { return this.service.installUpdate(url); }
  cancelUpdate(): Promise<void> { return this.service.cancelUpdate ? this.service.cancelUpdate() : Promise.resolve(); }
  getAppVersion(): Promise<string> { return this.service.getAppVersion(); }

  openDialog(options: any): Promise<string | string[] | null> { return this.service.openDialog(options); }
  saveDialog(options: any): Promise<string | null> { return this.service.saveDialog(options); }

  onProjectOutput(callback: (payload: { id: string; data: string }) => void): Promise<() => void> {
    return this.service.onProjectOutput(callback);
  }
 async onProjectExit(callback: (payload: { id: string }) => void): Promise<() => void> {
    return this.service.onProjectExit(callback);
  }

  async onDownloadProgress(callback: (percentage: number) => void): Promise<() => void> {
      return this.service.onDownloadProgress(callback);
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
  async gitPull(path: string, remote?: string, branch?: string, operationId?: string): Promise<string> { return this.service.gitPull(path, remote, branch, operationId); }
  async gitPush(path: string, remote?: string, branch?: string, force?: boolean, setUpstream?: boolean, operationId?: string): Promise<string> { return this.service.gitPush(path, remote, branch, force, setUpstream, operationId); }
  async gitFetch(path: string, remote?: string, operationId?: string): Promise<string> { return this.service.gitFetch(path, remote, operationId); }
  async gitDiff(path: string, file?: string, staged?: boolean): Promise<string> { return this.service.gitDiff(path, file, staged); }
  async gitDiffCommit(path: string, hash: string): Promise<string> { return this.service.gitDiffCommit(path, hash); }
  async gitDiscard(path: string, files: string[]): Promise<string> { return this.service.gitDiscard(path, files); }
  async gitDiscardUntracked(path: string, files: string[]): Promise<string> { return this.service.gitDiscardUntracked(path, files); }
  async gitCurrentBranch(path: string): Promise<string> { return this.service.gitCurrentBranch(path); }
  async gitListBranches(path: string): Promise<GitBranch[]> { return this.service.gitListBranches(path); }
  async gitSwitchBranch(path: string, branch: string): Promise<string> { return this.service.gitSwitchBranch(path, branch); }
  async gitCreateAndSwitchBranch(path: string, name: string, startPoint?: string): Promise<string> { return this.service.gitCreateAndSwitchBranch(path, name, startPoint); }
  async gitDeleteBranch(path: string, name: string, force?: boolean): Promise<string> { return this.service.gitDeleteBranch(path, name, force); }
  async gitRenameBranch(path: string, oldName: string, newName: string): Promise<string> { return this.service.gitRenameBranch(path, oldName, newName); }
  async gitHistory(path: string, maxCount?: number): Promise<GitCommit[]> { return this.service.gitHistory(path, maxCount); }
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
    async gitRevertHunk(path: string, patch: string, staged?: boolean): Promise<string> { return this.service.gitRevertHunk(path, patch, staged); }
    async gitRemoteList(path: string): Promise<import('../../types').GitRemote[]> { return this.service.gitRemoteList(path); }
    async gitRemoteAdd(path: string, name: string, url: string): Promise<string> { return this.service.gitRemoteAdd(path, name, url); }
    async gitRemoteSetUrl(path: string, name: string, url: string): Promise<string> { return this.service.gitRemoteSetUrl(path, name, url); }
    async gitRemoteRemove(path: string, name: string): Promise<string> { return this.service.gitRemoteRemove(path, name); }
}

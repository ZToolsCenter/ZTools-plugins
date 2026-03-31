import type { NodeVersion, GitStatusResult, GitBranch, GitCommit, GitSummary, GitCommitFile } from '../types';

export interface ProjectInfo {
    name: string;
    scripts: string[];
    path: string;
    packageManager?: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
    nvmVersion?: string;
    projectType: string;
}

export interface TerminalInfo {
    id: string;
    name: string;
}

export interface PlatformAPI {
    // NVM
    getNvmList(): Promise<NodeVersion[]>;
    installNode(version: string): Promise<string>;
    uninstallNode(version: string): Promise<string>;
    useNode(version: string): Promise<string>;
    getSystemNodePath(): Promise<string>;
    getNodeVersion(path: string): Promise<string>;

    // Project
    scanProject(path: string): Promise<ProjectInfo>;

    // Runner
    runProjectCommand(id: string, path: string, script: string, packageManager: string, nodePath: string): Promise<void>;
    runCustomCommand(id: string, path: string, command: string): Promise<void>;
    stopProjectCommand(id: string): Promise<void>;

    // System / Shell
    openInEditor(path: string, editor?: string): Promise<void>;
    openInTerminal(path: string, terminal?: string): Promise<void>;
    openFolder(path: string): Promise<void>;
    openUrl(url: string): Promise<void>;

    // Config / FS
    readConfigFile(filename: string): Promise<string>;
    writeConfigFile(filename: string, content: string): Promise<void>;
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>;

    // Updater
    installUpdate(url: string): Promise<void>;
    cancelUpdate(): Promise<void>;
    getAppVersion(): Promise<string>;

    // Dialogs
    openDialog(options?: {
        directory?: boolean;
        multiple?: boolean;
        filters?: { name: string; extensions: string[] }[];
        defaultPath?: string;
    }): Promise<string | string[] | null>;
    
    saveDialog(options?: {
        filters?: { name: string; extensions: string[] }[];
        defaultPath?: string;
    }): Promise<string | null>;

    // Events
    onProjectOutput(callback: (payload: { id: string; data: string }) => void): Promise<() => void>;
    onProjectExit(callback: (payload: { id: string }) => void): Promise<() => void>;
    onDownloadProgress(callback: (percentage: number) => void): Promise<() => void>;

    // Window
    windowMinimize(): Promise<void>;
    windowMaximize(): Promise<void>;
    windowUnmaximize(): Promise<void>;
    windowClose(): Promise<void>;
    windowIsMaximized(): Promise<boolean>;
    windowSetAlwaysOnTop(always: boolean): Promise<void>;
    onWindowResize(callback: () => void): Promise<() => void>;
    onWindowFocus(callback: () => void): Promise<() => void>;

    // System Integration
    setContextMenu(enable: boolean, locale?: string): Promise<void>;
    checkContextMenu(): Promise<boolean>;
    isContextMenuSupported(): Promise<boolean>;
    getPlatformInfo(): Promise<{ os: string; arch: string }>;
    detectAvailableTerminals(): Promise<TerminalInfo[]>;

    // Git
    gitCheck(path: string): Promise<boolean>;
    gitInit(path: string): Promise<string>;
    gitSummary(path: string): Promise<GitSummary>;
    gitStatus(path: string): Promise<GitStatusResult>;
    gitStage(path: string, files: string[]): Promise<string>;
    gitUnstage(path: string, files: string[]): Promise<string>;
    gitStageAll(path: string): Promise<string>;
    gitUnstageAll(path: string): Promise<string>;
    gitCommit(path: string, message: string): Promise<string>;
    gitPull(path: string, remote?: string, branch?: string): Promise<string>;
    gitPush(path: string, remote?: string, branch?: string, force?: boolean, setUpstream?: boolean): Promise<string>;
    gitFetch(path: string, remote?: string): Promise<string>;
    gitDiff(path: string, file?: string, staged?: boolean): Promise<string>;
    gitDiffCommit(path: string, hash: string): Promise<string>;
    gitDiscard(path: string, files: string[]): Promise<string>;
    gitDiscardUntracked(path: string, files: string[]): Promise<string>;
    gitCurrentBranch(path: string): Promise<string>;
    gitListBranches(path: string): Promise<GitBranch[]>;
    gitSwitchBranch(path: string, branch: string): Promise<string>;
    gitCreateAndSwitchBranch(path: string, name: string, startPoint?: string): Promise<string>;
    gitDeleteBranch(path: string, name: string, force?: boolean): Promise<string>;
    gitRenameBranch(path: string, oldName: string, newName: string): Promise<string>;
    gitHistory(path: string, maxCount?: number): Promise<GitCommit[]>;
    gitCommitFiles(path: string, hash: string): Promise<GitCommitFile[]>;
    gitDiffCommitFile(path: string, hash: string, file: string): Promise<string>;
    gitRevertHunk(path: string, patch: string, staged?: boolean): Promise<string>;
}

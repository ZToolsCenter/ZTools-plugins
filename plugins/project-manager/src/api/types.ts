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
} from '../types';

/** 包管理器解析结果 */
export interface PackageManagerResolveResult {
    /** 包管理器是否可用 */
    available: boolean;
    /** 实际可执行的命令路径/命令字符串（仅 available=true 时有值） */
    commandPath?: string;
    /** 不可用原因（仅 available=false 时有值） */
    reason?: string;
}

export interface ProjectOutputPayload {
    /** 稳定命令键；用于同一命令的互斥、停止和 stdin。 */
    commandKey: string;
    /** 一次具体执行的唯一会话 id；日志和生命周期必须按它路由。 */
    sessionId: string;
    stream: 'stdout' | 'stderr';
    data: string;
    partial?: boolean;
}

export interface ProjectExitPayload {
    commandKey: string;
    sessionId: string;
    exitCode: number | null;
    stopped: boolean;
    durationMs: number;
    waitError?: string;
}

export interface ProjectInfo {
    name: string;
    scripts: string[];
    path: string;
    packageManager?: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
    /** @deprecated 兼容旧字段，请优先读 nodeVersionHint */
    nvmVersion?: string;
    /** .nvmrc / .node-version 提示，不是 NVM 实现绑定 */
    nodeVersionHint?: string;
    projectType: string;
    /** Java 构建工具；非 Java 项目为空 */
    buildTool?: 'maven' | 'gradle';
    /** 是否存在 mvnw / gradlew，有则优先用 wrapper */
    hasWrapper?: boolean;
}

/** 导入候选（批量导入列表项的展示形状） */
export interface ImportCandidate {
    name: string;
    path: string;
    /** 已识别的子模块数量 */
    subModuleCount: number;
    /** 是否为 Git 仓库 */
    hasGit: boolean;
}

/** 嵌套导入树节点。容器目录作为 `kind="unknown"` 占位节点保留。 */
export interface ImportNode {
    name: string;
    path: string;
    /** frontend / backend / node / go / rust / python / dotnet / static / unknown（容器占位） */
    kind: string;
    /** 具体框架（如 Vue / React / Spring Boot / Gradle），容器节点无此值 */
    framework?: string;
    /** 是否为 Git 仓库 */
    hasGit: boolean;
    /** 是否含 package.json */
    hasPackageJson: boolean;
    /** 该目录下的 npm scripts（仅 node/前端项目有值） */
    scripts: string[];
    /** Java 构建工具；非 Java 模块无此值 */
    buildTool?: 'maven' | 'gradle';
    /** 是否存在 mvnw / gradlew */
    hasWrapper?: boolean;
    /** 子节点（仅容器目录会继续下沉；已识别模块节点为空数组） */
    children: ImportNode[];
}

export interface TerminalInfo {
    id: string;
    name: string;
}

export interface EditorInfo {
    name: string;
    path: string;
}

export interface PortEntry {
    protocol: string;
    local_address: string;
    local_port: number;
    remote_address?: string | null;
    remote_port?: number | null;
    state: string;
    pid?: number | null;
    process_name?: string | null;
    executable_path?: string | null;
    command_line?: string | null;
}

export interface WorkspaceDirEntry {
    name: string;
    isDirectory: boolean;
    size?: number;
}

export interface WorkspaceStat {
    exists: boolean;
    isDirectory: boolean;
    size: number;
    diskVersion: string;
    readOnly: boolean;
}

export interface EditorFileSnapshot {
    content: string;
    size: number;
    diskVersion: string;
    encoding: 'utf-8' | 'utf-8-bom' | 'other';
    eol: 'lf' | 'crlf';
    readOnly: boolean;
}

export interface EditorWriteResult {
    diskVersion: string;
    size: number;
}

export interface PlatformAPI {
    // Node runtime
    listInstalledNodeRuntimes(): Promise<NodeVersion[]>;
    scanNvmNodeRuntimes(): Promise<NodeVersion[]>;
    listAvailableNodeReleases(): Promise<NodeReleaseInfo[]>;
    installManagedNode(version: string, operationId?: string): Promise<string>;
    cancelManagedNodeInstall(operationId: string): Promise<void>;
    uninstallManagedNode(version: string): Promise<void>;
    getSystemNodePath(): Promise<string>;
    getNodeVersion(path: string): Promise<string>;
    getSystemNodeState(): Promise<SystemNodeState>;
    switchSystemNode(runtime: NodeVersion, options?: SystemNodeSwitchOptions): Promise<SystemNodeSwitchResult>;
    systemNodeSwitchSupported(): Promise<boolean>;
    managedNodeRuntimeSupported(): Promise<boolean>;
    getManagedNodeRuntimeLocation(): Promise<ManagedRuntimeLocationInfo>;
    getManagedNodeRuntimeSize(): Promise<ManagedRuntimeSizeInfo>;
    openManagedNodeRuntimeRoot(): Promise<void>;
    migrateManagedNodeRuntimeLocation(
        location: ManagedRuntimeLocation,
        migrate: boolean,
        runningRuntimePaths?: string[],
    ): Promise<ManagedRuntimeLocationInfo>;
    onNodeRuntimeProgress?(callback: (payload: NodeInstallProgress) => void): Promise<() => void>;

    /** @deprecated 使用 listInstalledNodeRuntimes */
    getNvmList(): Promise<NodeVersion[]>;
    /** @deprecated 使用 installManagedNode */
    installNode(version: string): Promise<string>;
    /** @deprecated 使用 uninstallManagedNode */
    uninstallNode(version: string): Promise<string>;
    /** @deprecated 不再调用 nvm use */
    useNode(version: string): Promise<string>;

    // Project
    scanProject(path: string): Promise<ProjectInfo>;
    /** 扫描目录识别子项目，返回保留层级的嵌套树。
     *  `maxDepth` 为本次扫描还可向下延伸的层级数（由 MAX_PROJECT_DEPTH 减去父项目当前深度算出）。 */
    scanSubProjects(path: string, maxDepth?: number): Promise<ImportNode[]>;
    /** 扫描根目录下的子目录，返回嵌套导入树（容器作为 unknown 占位节点保留，最多 3 层） */
    scanImportTree(path: string): Promise<ImportNode[]>;
    gitListRemoteBranches(url: string): Promise<string[]>;
    gitCloneBranch(url: string, branch: string, destination: string, operationId?: string): Promise<string>;
    gitCancelOperation(operationId: string): Promise<void>;

    // Runner
    runProjectCommand(commandKey: string, sessionId: string, path: string, script: string, packageManager: string, nodePath: string, commandPath?: string, pmNodePath?: string): Promise<void>;
    runCustomCommand(commandKey: string, sessionId: string, path: string, command: string): Promise<void>;
    stopProjectCommand(commandKey: string): Promise<void>;
    sendProjectInput(commandKey: string, input: string): Promise<void>;
    closeProjectInput(commandKey: string): Promise<void>;
    installPm(nodePath: string, pmName: string): Promise<void>;

    /**
     * 解析包管理器可用性
     * @param nodePath 项目 Node 路径
     * @param defaultNodePath 默认 Node 路径
     * @param packageManager 包管理器名称
     * @param source 来源：'project' 使用项目 Node，'default' 借用默认 Node 的 PM
     */
    resolvePackageManager(nodePath: string, defaultNodePath: string, packageManager: string, source: 'project' | 'default'): Promise<PackageManagerResolveResult>;

    // System / Shell
    getHomeDirectory(): Promise<string>;
    openInEditor(path: string, editor?: string): Promise<void>;
    openInTerminal(path: string, terminal?: string, nodePath?: string, packageManager?: string): Promise<void>;
    openFolder(path: string): Promise<void>;
    openPath(path: string): Promise<void>;
    revealInFolder(path: string): Promise<void>;
    openUrl(url: string): Promise<void>;

    // Config / FS
    readConfigFile(filename: string): Promise<string>;
    writeConfigFile(filename: string, content: string): Promise<void>;
    hasConfigBackup(filename: string): Promise<boolean>;
    readConfigBackup(filename: string): Promise<string>;
    restoreConfigBackup(filename: string): Promise<string>;
    canOpenConfigDirectory(): Promise<boolean>;
    openConfigDirectory(): Promise<void>;
    readTextFile(path: string): Promise<string>;
    readBinaryFileBase64(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
    workspaceReadDir(root: string, relativePath: string): Promise<WorkspaceDirEntry[]>;
    workspaceCreateFile(root: string, relativePath: string): Promise<void>;
    workspaceCreateDirectory(root: string, relativePath: string): Promise<void>;
    workspaceRename(root: string, fromRelative: string, toRelative: string): Promise<void>;
    workspaceTrash(root: string, relativePath: string): Promise<void>;
    workspaceStat(root: string, relativePath: string): Promise<WorkspaceStat>;
    workspaceReadEditorFile(root: string, relativePath: string): Promise<EditorFileSnapshot>;
    workspaceReadBinaryFileBase64(root: string, relativePath: string): Promise<string>;
    workspaceWriteEditorFile(
        root: string,
        relativePath: string,
        content: string,
        expectedDiskVersion?: string,
        eol?: 'lf' | 'crlf',
        bom?: boolean,
        force?: boolean,
    ): Promise<EditorWriteResult>;
    workspaceTrashMode(): Promise<'recycle_bin' | 'permanent'>;

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
    onProjectOutput(callback: (payload: ProjectOutputPayload) => void): Promise<() => void>;
    onProjectExit(callback: (payload: ProjectExitPayload) => void): Promise<() => void>;

    // Window
    windowMinimize(): Promise<void>;
    windowMaximize(): Promise<void>;
    windowUnmaximize(): Promise<void>;
    windowClose(): Promise<void>;
    exitApp(): Promise<void>;
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
    detectAvailableEditors(): Promise<EditorInfo[]>;
    listUsedPorts(): Promise<PortEntry[]>;
    terminateProcessByPid(pid: number): Promise<void>;

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
    gitAmend(path: string, message?: string): Promise<string>;
    gitPull(
        path: string,
        remote?: string,
        branch?: string,
        operationId?: string,
        strategy?: GitPullStrategy,
    ): Promise<string>;
    gitPush(
        path: string,
        remote?: string,
        branch?: string,
        force?: boolean,
        setUpstream?: boolean,
        operationId?: string,
        forceWithLease?: boolean,
    ): Promise<string>;
    gitFetch(path: string, remote?: string, operationId?: string): Promise<string>;
    gitDiff(path: string, file?: string, staged?: boolean): Promise<string>;
    gitDiffForAi(path: string): Promise<string>;
    gitDiffCommit(path: string, hash: string): Promise<string>;
    gitDiscard(path: string, files: string[]): Promise<string>;
    gitDiscardUntracked(path: string, files: string[]): Promise<string>;
    gitCurrentBranch(path: string): Promise<string>;
    gitListBranches(path: string): Promise<GitBranch[]>;
    gitSwitchBranch(path: string, branch: string): Promise<string>;
    gitCreateAndSwitchBranch(path: string, name: string, startPoint?: string): Promise<string>;
    gitDeleteBranch(path: string, name: string, force?: boolean): Promise<string>;
    gitRenameBranch(path: string, oldName: string, newName: string): Promise<string>;
    gitMerge(path: string, branch: string): Promise<string>;
    gitMergeContinue(path: string): Promise<string>;
    gitMergeAbort(path: string): Promise<string>;
    gitRebase(path: string, branch: string): Promise<string>;
    gitReset(path: string, mode: GitResetMode, target?: string): Promise<string>;
    gitCherryPick(path: string, hash: string): Promise<string>;
    gitRevertCommit(path: string, hash: string): Promise<string>;
    gitStashList(path: string): Promise<GitStashEntry[]>;
    gitStashSave(path: string, message?: string): Promise<string>;
    gitStashPop(path: string, index?: number): Promise<string>;
    gitStashApply(path: string, index?: number): Promise<string>;
    gitStashDrop(path: string, index: number): Promise<string>;
    gitTags(path: string): Promise<GitTag[]>;
    gitCreateTag(path: string, name: string, message?: string, target?: string): Promise<string>;
    gitDeleteTag(path: string, name: string): Promise<string>;
    gitHistory(path: string, maxCount?: number): Promise<GitCommit[]>;
    gitOwnCommits(path: string, since: string, until: string): Promise<GitOwnCommitResult>;
    gitCommitDetail(path: string, hash: string): Promise<GitCommit>;
    gitCommitFiles(path: string, hash: string): Promise<GitCommitFile[]>;
    gitDiffCommitFile(path: string, hash: string, file: string): Promise<string>;
    gitGetImageDiff(path: string, file: string, staged?: boolean, commit?: string, oldPath?: string): Promise<GitImageDiffPayload>;
    gitGetBinaryDiffMeta(path: string, file: string, staged?: boolean, commit?: string, oldPath?: string): Promise<GitBinaryDiffMeta>;
    gitFileHistory(path: string, file: string, maxCount?: number): Promise<GitCommit[]>;
    gitAddIgnorePattern(path: string, files: string[], kind: GitIgnoreKind, local?: boolean): Promise<string[]>;
    gitStopTracking(path: string, files: string[], kind: GitIgnoreKind, local?: boolean): Promise<string>;
    gitApplyHunk(path: string, patch: string, mode: GitHunkMode): Promise<string>;
    gitRevertHunk(path: string, patch: string, staged?: boolean): Promise<string>;
    gitRemoteList(path: string): Promise<import('../types').GitRemote[]>;
    gitRemoteAdd(path: string, name: string, url: string): Promise<string>;
    gitRemoteSetUrl(path: string, name: string, url: string): Promise<string>;
    gitRemoteRemove(path: string, name: string): Promise<string>;
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec, execFile, execSync, execFileSync } = require('child_process');
const { TextDecoder } = require('util');

// Force UTF-8 encoding for git commands to support non-ASCII filenames
process.env.LANG = 'en_US.UTF-8';
process.env.LC_ALL = 'en_US.UTF-8';

// Validate version string to prevent command injection
function isValidVersion(version) {
    return /^[a-zA-Z0-9._\-\/]+$/.test(version);
}

// Helper to run command and get output
function runCmd(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout.trim());
        });
    });
}

const GIT_IMAGE_SIDE_MAX_SIZE = 10 * 1024 * 1024;
const GIT_IMAGE_TOTAL_MAX_SIZE = 20 * 1024 * 1024;

function normalizeRepoRelativePath(raw) {
    const replaced = String(raw || '').replace(/\\/g, '/');
    if (!replaced || replaced.startsWith('/') || /^[A-Za-z]:/.test(replaced) || replaced.includes('\0')) {
        throw new Error(`Invalid repository-relative path: ${raw}`);
    }
    const parts = [];
    for (const part of replaced.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') throw new Error(`Path escapes repository root: ${raw}`);
        parts.push(part);
    }
    if (!parts.length) throw new Error(`Invalid repository-relative path: ${raw}`);
    return parts.join('/');
}

function normalizeWorkspaceRelativePath(raw, allowEmpty = false) {
    const replaced = String(raw || '').replace(/\\/g, '/');
    if (replaced.includes('\0') || replaced.startsWith('/') || /^[A-Za-z]:/.test(replaced)) {
        throw new Error(`Invalid workspace-relative path: ${raw}`);
    }
    const parts = [];
    for (const part of replaced.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') throw new Error(`Path escapes workspace root: ${raw}`);
        parts.push(part);
    }
    if (!allowEmpty && !parts.length) throw new Error(`Workspace-relative path is required: ${raw}`);
    return parts;
}

function assertWorkspaceWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Path escapes workspace root: ${candidate}`);
    }
}

function resolveWorkspacePath(root, relative, allowMissing = false) {
    const rootPath = fs.realpathSync(path.resolve(String(root || '')));
    if (!fs.statSync(rootPath).isDirectory()) throw new Error('Workspace root is not a directory');
    const parts = normalizeWorkspaceRelativePath(relative, true);
    const candidate = path.resolve(rootPath, ...parts);
    if (fs.existsSync(candidate)) {
        const realPath = fs.realpathSync(candidate);
        assertWorkspaceWithin(rootPath, realPath);
        return realPath;
    }
    if (!allowMissing) throw new Error(`Workspace path does not exist: ${relative}`);
    let cursor = candidate;
    while (true) {
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error(`Failed to resolve missing workspace path: ${relative}`);
        if (fs.existsSync(parent)) {
            const realParent = fs.realpathSync(parent);
            assertWorkspaceWithin(rootPath, realParent);
            return candidate;
        }
        cursor = parent;
    }
}

function workspaceDiskVersion(filePath, stat = fs.statSync(filePath)) {
    return `${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}:${stat.mode}`;
}

function isReadonlyPath(filePath, stat = fs.statSync(filePath)) {
    if ((stat.mode & 0o222) === 0) return true;
    try {
        fs.accessSync(filePath, fs.constants.W_OK);
        return false;
    } catch (_) {
        return true;
    }
}

function decodeEditorBuffer(buffer) {
    let encoding = 'utf-8';
    let contentBuffer = buffer;
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        encoding = 'utf-8-bom';
        contentBuffer = buffer.subarray(3);
    } else {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch (_) {
            encoding = 'other';
        }
    }
    return {
        content: decodeTextBuffer(contentBuffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
        encoding,
        readOnly: encoding === 'other',
    };
}

function editorBytes(content, eol = 'lf', bom = false) {
    const normalized = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const output = eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
    const prefix = bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0);
    return Buffer.concat([prefix, Buffer.from(output, 'utf8')]);
}

function atomicWriteEditorBytes(target, bytes) {
    const parent = path.dirname(target);
    let mode;
    try { mode = fs.statSync(target).mode; } catch (_) {}
    const temp = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.editor.tmp`);
    fs.writeFileSync(temp, bytes);
    if (mode != null) {
        try { fs.chmodSync(temp, mode); } catch (_) {}
    }
    try {
        fs.renameSync(temp, target);
        if (mode != null) {
            try { fs.chmodSync(target, mode); } catch (_) {}
        }
    } catch (error) {
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
            try { fs.rmSync(temp, { force: true }); } catch (_) {}
            throw error;
        }
        const backup = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.editor.bak`);
        try {
            fs.renameSync(target, backup);
            try {
                fs.renameSync(temp, target);
                if (mode != null) {
                    try { fs.chmodSync(target, mode); } catch (_) {}
                }
                try { fs.rmSync(backup, { force: true }); } catch (_) {}
            } catch (replaceError) {
                try { fs.renameSync(backup, target); } catch (restoreError) {
                    throw new Error(`${replaceError.message}; failed to restore original: ${restoreError.message}`);
                }
                throw replaceError;
            }
        } catch (replaceError) {
            try { fs.rmSync(temp, { force: true }); } catch (_) {}
            throw replaceError;
        }
    }
}

function gitRepoRoot(projectPath) {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: projectPath, windowsHide: true,
    }).toString().trim();
}

function escapeGitignoreComponent(value) {
    const chars = Array.from(value);
    return chars.map((char, index) => {
        const needsEscape = (index === 0 && (char === '#' || char === '!'))
            || ['\\', '*', '?', '[', ']'].includes(char)
            || (index === chars.length - 1 && (char === ' ' || char === '\t'));
        return needsEscape ? `\\${char}` : char;
    }).join('');
}

function escapeGitignorePath(relative) {
    return relative.split('/').map(escapeGitignoreComponent).join('/');
}

function buildGitIgnorePattern(root, rawPath, kind) {
    const relative = normalizeRepoRelativePath(rawPath);
    const fullPath = path.join(root, ...relative.split('/'));
    if (kind === 'file') return `/${escapeGitignorePath(relative)}`;
    const name = relative.split('/').pop();
    if (kind === 'filename') return escapeGitignoreComponent(name);
    if (kind === 'extension') {
        const dot = name.lastIndexOf('.');
        if (dot <= 0 || dot === name.length - 1) throw new Error(`File has no extension: ${relative}`);
        return `*.${escapeGitignoreComponent(name.slice(dot + 1))}`;
    }
    if (kind === 'directory') {
        const directory = fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()
            ? relative
            : relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
        if (!directory) throw new Error(`File is in repository root: ${relative}`);
        return `/${escapeGitignorePath(directory)}/`;
    }
    throw new Error(`Unsupported ignore kind: ${kind}`);
}

function atomicWriteUtf8(target, content) {
    const parent = path.dirname(target);
    fs.mkdirSync(parent, { recursive: true });
    const temp = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(temp, content, 'utf8');
    try {
        fs.renameSync(temp, target);
    } catch (error) {
        // Windows cannot always replace an existing file with renameSync. Move the
        // original aside first so a failed replacement never deletes it.
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
            try { fs.rmSync(temp, { force: true }); } catch (_) {}
            throw error;
        }
        const backup = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.bak`);
        try {
            fs.renameSync(target, backup);
            try {
                fs.renameSync(temp, target);
                try { fs.rmSync(backup, { force: true }); } catch (_) {}
            } catch (replaceError) {
                try {
                    fs.renameSync(backup, target);
                } catch (restoreError) {
                    throw new Error(`${replaceError.message}; failed to restore original: ${restoreError.message}`);
                }
                throw replaceError;
            }
        } catch (replaceError) {
            try { fs.rmSync(temp, { force: true }); } catch (_) {}
            throw replaceError;
        }
    }
}

function appendGitIgnorePatterns(target, patterns) {
    const original = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    let content = original;
    const added = [];
    for (const pattern of patterns) {
        if (!pattern || added.includes(pattern)) continue;
        const exists = original.split(/\r?\n/).some((line) => line === pattern);
        if (exists) continue;
        if (content && !content.endsWith('\n')) content += eol;
        content += pattern + eol;
        added.push(pattern);
    }
    if (added.length) atomicWriteUtf8(target, content);
    return added;
}

function gitIgnoreTarget(projectPath, root, local) {
    if (!local) return path.join(root, '.gitignore');
    const gitPath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
        cwd: projectPath, windowsHide: true,
    }).toString().trim();
    return path.isAbsolute(gitPath) ? gitPath : path.join(root, gitPath);
}

function gitImageMime(file) {
    switch (path.extname(file).toLowerCase()) {
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.webp': return 'image/webp';
        case '.gif': return 'image/gif';
        case '.bmp': return 'image/bmp';
        case '.svg': return 'image/svg+xml';
        case '.ico': return 'image/x-icon';
        default: return null;
    }
}

function validateGitCommitHash(hash) {
    if (!/^[0-9a-f]{4,64}$/i.test(String(hash || ''))) throw new Error('Invalid Git commit hash');
}

function gitDiffSources(projectPath, file, staged, commit, oldPath) {
    const relative = normalizeRepoRelativePath(file);
    const previous = oldPath ? normalizeRepoRelativePath(oldPath) : null;
    if (commit) {
        validateGitCommitHash(commit);
        execFileSync('git', ['rev-parse', '--verify', `${commit}^{commit}`], { cwd: projectPath, windowsHide: true });
        const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', commit], {
            cwd: projectPath, windowsHide: true,
        }).toString().trim().split(/\s+/);
        return {
            before: parents[1] ? { source: 'commit', ref: parents[1], path: previous || relative } : null,
            after: { source: 'commit', ref: commit, path: relative },
        };
    }

    let tracked = true;
    try {
        execFileSync('git', ['ls-files', '--error-unmatch', '--', relative], { cwd: projectPath, windowsHide: true });
    } catch (_) {
        tracked = false;
    }
    if (!staged && !tracked) {
        return { before: null, after: { source: 'worktree', path: relative } };
    }
    if (staged) {
        return {
            before: { source: 'head', path: previous || relative },
            after: { source: 'index', path: relative },
        };
    }
    return {
        before: { source: 'index', path: previous || relative },
        after: { source: 'worktree', path: relative },
    };
}

function readGitBlob(projectPath, source) {
    if (!source) return null;
    if (source.source === 'worktree') {
        const fullPath = path.join(gitRepoRoot(projectPath), ...source.path.split('/'));
        if (!fs.existsSync(fullPath)) return null;
        if (fs.statSync(fullPath).isDirectory()) throw new Error(`Cannot read directory as a file: ${source.path}`);
        return fs.readFileSync(fullPath);
    }
    const spec = source.source === 'index' ? `:${source.path}`
        : source.source === 'head' ? `HEAD:${source.path}`
            : `${source.ref}:${source.path}`;
    try {
        return execFileSync('git', ['show', spec], { cwd: projectPath, windowsHide: true, encoding: null });
    } catch (error) {
        return null;
    }
}

function readGitBlobSize(projectPath, source) {
    if (!source) return null;
    if (source.source === 'worktree') {
        const fullPath = path.join(gitRepoRoot(projectPath), ...source.path.split('/'));
        if (!fs.existsSync(fullPath)) return null;
        return fs.statSync(fullPath).size;
    }
    const spec = source.source === 'index' ? `:${source.path}`
        : source.source === 'head' ? `HEAD:${source.path}`
            : `${source.ref}:${source.path}`;
    try {
        return Number(execFileSync('git', ['cat-file', '-s', spec], { cwd: projectPath, windowsHide: true }).toString().trim());
    } catch (_) {
        return null;
    }
}

const PROJECT_SCAN_IGNORED_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
    '.idea', '.vscode', '__pycache__', '.next', '.nuxt', 'target',
    'vendor', 'coverage', '.cache', 'tmp', 'temp', '.gradle',
    // 部署/对外暴露的纯静态资源目录：只含 index.html 和资源文件，
    // 既无构建系统也无源码组织，不应被识别为项目。
    'public', 'static', 'www', 'htdocs', 'public_html', 'httpdocs'
]);

/**
 * 扫描的最大层级，与 Rust MAX_SCAN_DEPTH 及前端 MAX_PROJECT_DEPTH 保持一致。
 * 超出该层级的目录直接丢弃，不会被上提压平到父级。
 */
const MAX_SCAN_DEPTH = 3;

function readPackageJson(projectPath) {
    try {
        return JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
    } catch (_) {
        return {};
    }
}

function identifyProjectModule(projectPath) {
    const has = (name) => fs.existsSync(path.join(projectPath, name));
    // 只有真的引了 spring-boot 才报 Spring Boot，否则一律报 Maven
    if (has('pom.xml')) {
        let framework = 'Maven';
        try {
            if (fs.readFileSync(path.join(projectPath, 'pom.xml'), 'utf-8').includes('spring-boot')) {
                framework = 'Spring Boot';
            }
        } catch (e) { /* 读不到就按 Maven 处理 */ }
        return { kind: 'backend', framework };
    }
    // settings.gradle(.kts) 也算：多模块仓库根目录可能只有 settings 没有 build
    if (has('build.gradle') || has('build.gradle.kts') || has('settings.gradle') || has('settings.gradle.kts')) {
        return { kind: 'backend', framework: 'Gradle' };
    }
    if (has('package.json')) {
        const pkg = readPackageJson(projectPath);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps.vue) return { kind: 'frontend', framework: 'Vue' };
        if (deps.react) return { kind: 'frontend', framework: 'React' };
        return { kind: 'node', framework: 'Node.js' };
    }
    if (has('index.html')) return { kind: 'static', framework: 'Static' };
    if (has('go.mod')) return { kind: 'go', framework: 'Go' };
    if (has('Cargo.toml')) return { kind: 'rust', framework: 'Rust' };
    if (has('requirements.txt') || has('pyproject.toml')) return { kind: 'python', framework: 'Python' };
    try {
        if (fs.readdirSync(projectPath).some((name) => name.toLowerCase().endsWith('.csproj'))) {
            return { kind: 'dotnet', framework: '.NET' };
        }
    } catch (_) {}
    return null;
}

/**
 * 统一的项目树扫描：递归识别 dirPath 并返回**保留真实层级**的节点。
 *
 * 三种情况（Git 与构建清单的规则是非对称的）：
 *   - 含 .git            → 是项目节点，且继续向内递归（仓库根常承载多个模块）
 *   - 有清单但无 .git    → 是项目节点，不再向内递归（单个完整包）
 *   - 两者都无           → unknown 占位容器，继续递归；无子孙模块则丢弃
 *
 * depth 是该目录在项目树中的绝对层级，超过 maxDepth 直接截断丢弃。
 */
function scanProjectTree(dirPath, depth, maxDepth, seen) {
    if (depth > maxDepth) return [];
    const name = path.basename(dirPath) || 'Unknown';
    if (name.startsWith('.') || PROJECT_SCAN_IGNORED_DIRS.has(name)) return [];
    const pathKey = dirPath.replace(/\\/g, '/');
    if (seen.has(pathKey)) return [];
    seen.add(pathKey);

    const moduleInfo = identifyProjectModule(dirPath);
    const hasGit = fs.existsSync(path.join(dirPath, '.git'));
    const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));
    const pkg = hasPackageJson ? readPackageJson(dirPath) : {};
    const scripts = Object.keys(pkg.scripts || {}).sort();

    // Java 构建信息：与 src-tauri 的 scan_child_dirs 保持一致，
    // 否则两条导入路径识别出的项目类型会分叉
    const isMavenNode = fs.existsSync(path.join(dirPath, 'pom.xml'));
    const isGradleNode = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
        .some((n) => fs.existsSync(path.join(dirPath, n)));
    const nodeBuildTool = isMavenNode ? 'maven' : (isGradleNode ? 'gradle' : undefined);
    const nodeHasWrapper = nodeBuildTool === 'maven'
        ? (fs.existsSync(path.join(dirPath, 'mvnw')) || fs.existsSync(path.join(dirPath, 'mvnw.cmd')))
        : (nodeBuildTool === 'gradle'
            ? (fs.existsSync(path.join(dirPath, 'gradlew')) || fs.existsSync(path.join(dirPath, 'gradlew.bat')))
            : undefined);

    const makeNode = (kind, framework, children) => ({
        name,
        path: dirPath,
        kind,
        framework,
        hasGit,
        hasPackageJson,
        buildTool: nodeBuildTool,
        hasWrapper: nodeHasWrapper,
        scripts,
        children,
    });

    // Git 仓库：本身即项目边界，同时继续向内递归挂载其内部模块。
    if (hasGit) {
        const children = scanChildDirs(dirPath, depth + 1, maxDepth, seen);
        // 即使既无清单也无子模块（例如只有 README 的仓库）也必须保留——它是真实仓库。
        return [makeNode(moduleInfo ? moduleInfo.kind : 'unknown', moduleInfo ? moduleInfo.framework : undefined, children)];
    }

    // 有构建清单但不是仓库根：视为一个完整项目，不再向内递归。
    if (moduleInfo) {
        return [makeNode(moduleInfo.kind, moduleInfo.framework, [])];
    }

    // 纯容器目录：作为 unknown 占位节点保留层级，并递归其子目录。
    const children = scanChildDirs(dirPath, depth + 1, maxDepth, seen);
    // 子孙中没有任何模块的空容器不入结果。
    if (children.length === 0) return [];
    return [makeNode('unknown', undefined, children)];
}

/**
 * 扫描 dirPath 的所有直接子目录并汇总为节点列表。
 * 同层内 Git 仓库优先展示，其余按目录名升序，保证结果稳定。
 */
function scanChildDirs(dirPath, depth, maxDepth, seen) {
    if (depth > maxDepth) return [];
    let entries = [];
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch (_) { return []; }

    const childDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    let nodes = [];
    for (const childName of childDirs) {
        const sub = scanProjectTree(path.join(dirPath, childName), depth, maxDepth, seen);
        if (sub.length) nodes = nodes.concat(sub);
    }
    // 稳定排序：Git 仓库排前面
    return nodes.sort((a, b) => Number(b.hasGit) - Number(a.hasGit));
}

const processes = new Map();
const runnerProcessStates = new Map();
let outputCallback = null;
let exitCallback = null;

function terminateProcessTree(child, { synchronous = false } = {}) {
    if (!child || !child.pid) return;

    if (process.platform === 'win32') {
        const command = `taskkill /pid ${child.pid} /T /F`;
        try {
            if (synchronous) {
                execSync(command, { stdio: 'ignore', windowsHide: true });
            } else {
                exec(command, () => {});
            }
            return;
        } catch (_) {}
    }

    try {
        process.kill(-child.pid, 'SIGTERM');
    } catch (_) {
        try { child.kill('SIGTERM'); } catch (_) {}
    }

    const escalate = () => {
        try {
            process.kill(-child.pid, 'SIGKILL');
        } catch (_) {
            try { child.kill('SIGKILL'); } catch (_) {}
        }
    };

    if (synchronous) {
        escalate();
        return;
    }

    const timer = setTimeout(escalate, 1500);
    if (typeof timer.unref === 'function') timer.unref();
}

function terminateRunnerProcessTree(child) {
    if (!child || !child.pid) throw new Error('commandKey 不存在');

    if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
        });
        return;
    }

    let terminated = false;
    try {
        process.kill(-child.pid, 'SIGTERM');
        terminated = true;
    } catch (_) {
        try { terminated = child.kill('SIGTERM'); } catch (_) {}
    }
    if (!terminated) throw new Error(`Failed to stop process ${child.pid}`);

    const timer = setTimeout(() => {
        try {
            process.kill(-child.pid, 'SIGKILL');
        } catch (_) {
            try { child.kill('SIGKILL'); } catch (_) {}
        }
    }, 1500);
    if (typeof timer.unref === 'function') timer.unref();
}

function spawnParentDeathWatch(child) {
    if (!child || !child.pid) return;

    const parentPid = process.pid;
    try {
        if (process.platform === 'win32') {
            const watcher = spawn('powershell', [
                '-NoProfile',
                '-WindowStyle', 'Hidden',
                '-Command',
                `while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 1000 }; taskkill /PID ${child.pid} /T /F`
            ], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            watcher.unref();
            return;
        }

        const watcher = spawn('sh', [
            '-c',
            `parent=${parentPid}; target=${child.pid}; while kill -0 "$parent" 2>/dev/null; do sleep 1; done; kill -TERM -- -$target 2>/dev/null || kill -TERM $target 2>/dev/null; sleep 2; kill -KILL -- -$target 2>/dev/null || kill -KILL $target 2>/dev/null`
        ], {
            detached: true,
            stdio: 'ignore',
        });
        watcher.unref();
    } catch (error) {
        console.error('[Runner] Failed to start parent death watch:', error);
    }
}

function cleanupAllProcesses({ synchronous = false } = {}) {
    for (const [, child] of processes) {
        try {
            terminateProcessTree(child, { synchronous });
        } catch (_) {}
    }
    processes.clear();
    runnerProcessStates.clear();
}

function decodeTextBuffer(buffer) {
    if (!buffer || buffer.length === 0) return '';

    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return new TextDecoder('utf-8').decode(buffer.subarray(3));
    }

    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    }

    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(buffer.subarray(2));
    }

    for (const encoding of ['utf-8', 'gb18030', 'gbk', 'utf-16le', 'utf-16be']) {
        try {
            return new TextDecoder(encoding, { fatal: true }).decode(buffer);
        } catch (_) {}
    }

    return new TextDecoder('utf-8').decode(buffer);
}

function ensureNodeExeInDir(dir) {
    if (process.platform !== 'win32') return;
    try {
        const nodeExe = path.join(dir, 'node.exe');
        if (fs.existsSync(nodeExe)) return;
        const candidates = ['node64.exe', 'node32.exe'];
        for (const name of candidates) {
            const src = path.join(dir, name);
            if (fs.existsSync(src)) {
                try { fs.linkSync(src, nodeExe); } catch { fs.copyFileSync(src, nodeExe); }
                return;
            }
        }
    } catch (_) {}
}

function resolveTerminalNodeDir(nodePath) {
    const trimmed = String(nodePath || '').trim();
    if (!trimmed) return '';

    let resolved = trimmed;
    try {
        if (fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
            resolved = path.dirname(trimmed);
            ensureNodeExeInDir(resolved);
            return resolved;
        }

        if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
            if (process.platform === 'win32') {
                ensureNodeExeInDir(trimmed);
                if (fs.existsSync(path.join(trimmed, 'node.exe'))) {
                    return trimmed;
                }
            }

            if (process.platform !== 'win32' && fs.existsSync(path.join(trimmed, 'node'))) {
                return trimmed;
            }

            const binDir = path.join(trimmed, 'bin');
            if (process.platform === 'win32') {
                ensureNodeExeInDir(binDir);
                if (fs.existsSync(path.join(binDir, 'node.exe'))) {
                    return binDir;
                }
            }

            if (process.platform !== 'win32' && fs.existsSync(path.join(binDir, 'node'))) {
                return binDir;
            }
        }
    } catch (_) {}

    return trimmed;
}

/** *********************PATH 过滤：移除其它 Node/npm 工具目录********************* */

/**
 * 判断某个 PATH 目录是否包含 Node/npm 相关工具入口。
 * 用于过滤原始 PATH 中其它 Node 版本的目录，防止 npm/npx 等命中错误的 Node。
 */
function dirHasNodeTools(dir) {
    try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    } catch (_) {
        return false;
    }
    const names = process.platform === 'win32'
        ? ['node.exe', 'npm.cmd', 'npm.exe', 'npx.cmd', 'pnpm.cmd', 'yarn.cmd', 'cnpm.cmd']
        : ['node', 'npm', 'npx', 'pnpm', 'yarn', 'cnpm'];
    return names.some((n) => {
        try { return fs.existsSync(path.join(dir, n)); } catch (_) { return false; }
    });
}

/**
 * 标准化路径用于比较（Windows 小写 + 统一反斜杠）
 */
function normalizePathStr(s) {
    if (process.platform === 'win32') {
        return s.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');
    }
    return s.replace(/\/+$/, '');
}

/**
 * 从 PATH 字符串中过滤掉 Node/npm 工具目录，仅保留普通目录。
 */
function filterPathEntries(nodeDir, pathValue) {
    const nodeDirNorm = normalizePathStr(nodeDir);
    return pathValue
        .split(path.delimiter)
        .filter((entry) => {
            const e = entry.trim();
            if (!e) return false;
            // 当前项目 nodeDir 会在最终 PATH 最前面单独注入，这里跳过避免重复
            if (normalizePathStr(e) === nodeDirNorm) return false;
            // 含有 Node/npm 工具入口的目录 → 过滤
            if (dirHasNodeTools(e)) return false;
            // 普通目录 → 保留
            return true;
        })
        .join(path.delimiter);
}

/**
 * 解析项目 Node 目录下是否存在可用的 npm-cli.js（用于绕过被损坏的 npm.cmd / npm 软链）。
 * 在 nvm-windows 等环境下，npm.cmd 内部会指向 `%~dp0\node_modules\npm`，若该目录被其它版本的 junction 覆盖，
 * 直接 `npm -v` 会加载错误版本的 npm-cli.js。这里返回真实路径，让上层用 `node "<abs>" -v` 绕过。
 */
function resolveNpmCliJs(nodeDir) {
    if (!nodeDir) return null;
    const primary = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    try { if (fs.existsSync(primary)) return primary; } catch (_) {}

    if (process.platform !== 'win32') {
        const parent = path.dirname(nodeDir);
        const libCli = path.join(parent, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
        try { if (fs.existsSync(libCli)) return libCli; } catch (_) {}
    }
    return null;
}

/**
 * 构造 shell 别名命令，让用户手敲 `npm` 直接调用项目 Node 目录下的 npm-cli.js，
 * 绕过 npm.cmd（在 nvm-windows 软链损坏时会加载错版本的 npm）。
 * 返回空字符串表示无需别名。
 */
function buildPmAlias(nodeDir, packageManager, shell) {
    const pm = (packageManager || '').trim();
    if (!pm || pm.toLowerCase() !== 'npm') return '';
    const cli = resolveNpmCliJs(nodeDir);
    if (!cli) return '';

    if (shell === 'ps') {
        // PowerShell function 覆盖
        return `function npm { node '${cli.replace(/'/g, "''")}' @args }`;
    }
    if (shell === 'cmd') {
        // doskey 别名（仅当前 cmd 会话）
        return `doskey npm=node "${cli}" $*`;
    }
    // bash / git-bash function
    return `npm() { node '${cli.replace(/'/g, "'\\''")}' "$@"; }`;
}

/** 各 shell 的命令分隔符 */
function shellSeparator(shell) {
    return shell === 'ps' ? '; ' : ' && ';
}

/**
 * 按分隔符拼接命令片段，自动跳过空片段。
 *
 * 非 node 项目的启动脚本为空，若直接模板拼接会产出悬空的 `&&` / `;`，
 * 在 CMD 与 bash 下都是语法错误。
 */
function joinShellCommands(parts, sep) {
    return parts
        .map((part) => String(part || '').trim())
        .filter((part) => part.length > 0)
        .join(sep);
}

/**
 * 构造打开终端时的版本检查命令：`node -v && <pm> -v`。
 * - 对 npm 优先使用 `node "<abs>/npm-cli.js" -v` 绕过 npm.cmd 软链问题。
 * - 其它 PM：`<pm> -v`，依赖注入的 PATH。
 * - **包管理器为空：返回空串，终端只做 cd 不做任何版本注入。**
 *   非 node 项目（Go/Rust/Python 等）由前端传空包管理器走这条分支——
 *   对它们输出 `node -v` 既无意义，在未装 Node 的机器上还会报错刷屏。
 * - shell: 'ps' | 'cmd' | 'bash'
 */
function buildStartupCheck(nodeDir, packageManager, shell) {
    const pm = (packageManager || '').trim();
    const sep = shellSeparator(shell);

    if (!pm) return '';

    if (pm.toLowerCase() === 'npm') {
        const cli = resolveNpmCliJs(nodeDir);
        if (cli) {
            let cliQuoted;
            if (shell === 'ps') cliQuoted = `'${cli.replace(/'/g, "''")}'`;
            else if (shell === 'cmd') cliQuoted = `"${cli}"`;
            else cliQuoted = `'${cli.replace(/'/g, "'\\''")}'`;
            return `node -v${sep}node ${cliQuoted} -v`;
        }
    }

    return `node -v${sep}${pm} -v`;
}

/**
 * 把别名命令和启动检查拼接：别名先生效，再做版本输出（这样版本输出走的也是别名）。
 * 非 node 项目两者均为空，返回空串。
 */
function buildStartupScript(nodeDir, packageManager, shell) {
    const alias = buildPmAlias(nodeDir, packageManager, shell);
    const check = buildStartupCheck(nodeDir, packageManager, shell);
    return joinShellCommands([alias, check], shellSeparator(shell));
}

function getTerminalSpawnOptions(nodePath) {
    const nodeDir = resolveTerminalNodeDir(nodePath);
    if (!nodeDir) {
        return { detached: true, stdio: 'ignore' };
    }

    // 过滤原始 PATH 中其它 Node/npm 目录，避免 npm 版本错配
    const filtered = filterPathEntries(nodeDir, process.env.PATH || '');

    return {
        detached: true,
        stdio: 'ignore',
        env: {
            ...process.env,
            PATH: filtered ? `${nodeDir}${path.delimiter}${filtered}` : nodeDir,
        },
    };
}

function escapeCmdDoubleQuotes(value) {
    return String(value || '').replace(/"/g, '""');
}

function escapePowerShellSingleQuotes(value) {
    return String(value || '').replace(/'/g, "''");
}

// Platform-adaptive: support both uTools and ZTools
const platform = typeof ztools !== 'undefined' ? ztools : utools;

const CONFIG_FILE_NAME = 'data.json';

function assertSafeConfigFilename(filename) {
    const value = String(filename || '');
    if (!value || value !== path.basename(value) || /[\\/:\0]/.test(value) || value === '.' || value === '..' || /^[A-Za-z]:/.test(value)) {
        throw new Error(`Invalid config filename: ${filename}`);
    }
    return value;
}

function configPath(filename) {
    const safeFilename = assertSafeConfigFilename(filename);
    return path.join(platform.getPath('userData'), safeFilename);
}

function syncDirectory(directory) {
    if (process.platform === 'win32') return;
    try {
        const descriptor = fs.openSync(directory, 'r');
        try {
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
    } catch (_) {
        // Some hosts do not allow opening directories; the file fsync is still useful.
    }
}

function uniqueSiblingPath(target, suffix) {
    return path.join(
        path.dirname(target),
        `.${path.basename(target)}.${suffix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
}

function replaceFileAtomically(target, content) {
    const directory = path.dirname(target);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = uniqueSiblingPath(target, 'tmp');
    let temporaryExists = false;
    let displaced = null;

    try {
        const descriptor = fs.openSync(temporary, 'wx');
        temporaryExists = true;
        try {
            fs.writeFileSync(descriptor, content);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }

        if (process.platform === 'win32' && fs.existsSync(target)) {
            displaced = uniqueSiblingPath(target, 'old');
            fs.renameSync(target, displaced);
        }

        fs.renameSync(temporary, target);
        temporaryExists = false;
        syncDirectory(directory);
    } catch (error) {
        if (displaced && !fs.existsSync(target) && fs.existsSync(displaced)) {
            try {
                fs.renameSync(displaced, target);
                displaced = null;
            } catch (_) {
                // Keep the displaced file as evidence if rollback itself fails.
            }
        }
        throw error;
    } finally {
        if (temporaryExists) {
            try { fs.unlinkSync(temporary); } catch (_) {}
        }
        if (displaced && fs.existsSync(target)) {
            try { fs.unlinkSync(displaced); } catch (_) {}
        }
    }
}

function backupPath(primaryPath) {
    return `${primaryPath}.bak`;
}

function corruptSnapshotPath(primaryPath) {
    const prefix = `${primaryPath}.corrupt-${Date.now()}-${process.pid}`;
    let candidate = prefix;
    while (fs.existsSync(candidate)) candidate = `${prefix}-${Math.random().toString(16).slice(2)}`;
    return candidate;
}

function validateConfigContent(filename, content) {
    let value;
    try {
        value = JSON.parse(content);
    } catch (error) {
        throw new Error(`Invalid JSON in ${filename}: ${error.message}`);
    }
    if (filename === CONFIG_FILE_NAME && (!value || Array.isArray(value) || typeof value !== 'object'
        || !Array.isArray(value.projects) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings))) {
        throw new Error('Config does not have the expected persisted data shape');
    }
}

function writeConfigSafely(filename, content) {
    const safeFilename = assertSafeConfigFilename(filename);
    validateConfigContent(safeFilename, content);
    const primaryPath = configPath(safeFilename);
    fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
    if (safeFilename === CONFIG_FILE_NAME && fs.existsSync(primaryPath)) {
        const previous = fs.readFileSync(primaryPath, 'utf8');
        validateConfigContent(safeFilename, previous);
        replaceFileAtomically(backupPath(primaryPath), Buffer.from(previous, 'utf8'));
    }
    replaceFileAtomically(primaryPath, Buffer.from(content, 'utf8'));
}

function restoreConfigSafely(filename) {
    const safeFilename = assertSafeConfigFilename(filename);
    const primaryPath = configPath(safeFilename);
    const backup = backupPath(primaryPath);
    const content = fs.readFileSync(backup, 'utf8');
    validateConfigContent(safeFilename, content);
    if (fs.existsSync(primaryPath)) {
        replaceFileAtomically(corruptSnapshotPath(primaryPath), fs.readFileSync(primaryPath));
    }
    replaceFileAtomically(primaryPath, Buffer.from(content, 'utf8'));
    return content;
}

function assertSafeExternalUrl(url) {
    const value = String(url || '').trim();
    try {
        const parsed = new URL(value);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) throw new Error('unsafe protocol');
    } catch (_) {
        throw new Error('Only http and https URLs can be opened externally.');
    }
    return value;
}

// Editor detection helpers
const PLUGIN_EDITOR_DEFINITIONS = [
    { name: 'Visual Studio Code', matches: ['visual studio code'], commands: ['code'], relativePaths: [['bin', 'code.cmd'], ['bin', 'code'], ['Code.exe']] },
    { name: 'Trae CN', matches: ['trae'], commands: ['trae'], relativePaths: [['bin', 'trae.cmd'], ['bin', 'trae'], ['Trae.exe']] },
    { name: 'Cursor', matches: ['cursor'], commands: ['cursor'], relativePaths: [['bin', 'cursor.cmd'], ['bin', 'cursor'], ['Cursor.exe']] },
    { name: 'Windsurf', matches: ['windsurf'], commands: ['windsurf'], relativePaths: [['bin', 'windsurf.cmd'], ['bin', 'windsurf'], ['Windsurf.exe']] },
    { name: 'WebStorm', matches: ['webstorm'], commands: ['webstorm64', 'webstorm'], relativePaths: [['bin', 'webstorm64.exe'], ['bin', 'webstorm']] },
    { name: 'IntelliJ IDEA', matches: ['intellij idea'], commands: ['idea64', 'idea'], relativePaths: [['bin', 'idea64.exe'], ['bin', 'idea']] },
    { name: 'Sublime Text', matches: ['sublime text'], commands: ['subl'], relativePaths: [['sublime_text.exe']] },
    { name: 'Notepad++', matches: ['notepad++'], commands: ['notepad++'], relativePaths: [['notepad++.exe']] },
];

function cleanWindowsRegistryPath(value) {
    const trimmed = String(value || '').trim().replace(/^"|"$/g, '');
    const withoutArgs = trimmed.split('",')[0].replace(/^"|"$/g, '');
    return withoutArgs.replace(/,\s*\d+$/, '').replace(/^"|"$/g, '').trim();
}

function findExecutableOnPath(command) {
    try {
        const locator = process.platform === 'win32' ? 'where.exe' : 'which';
        const output = execFileSync(locator, [command], {
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return String(output || '').split(/\r?\n/).map(item => item.trim()).find(Boolean) || '';
    } catch (_) {
        return '';
    }
}

function resolveWindowsEditor(displayName, installLocation, displayIcon) {
    const normalizedName = String(displayName || '').toLowerCase();
    const definition = PLUGIN_EDITOR_DEFINITIONS.find(item =>
        item.matches.some(keyword => normalizedName.includes(keyword))
    );
    if (!definition) return null;

    const candidates = [];
    if (installLocation) {
        for (const relativePath of definition.relativePaths) {
            candidates.push(path.join(installLocation, ...relativePath));
        }
    }
    const iconPath = cleanWindowsRegistryPath(displayIcon);
    if (iconPath) candidates.push(iconPath);

    const executablePath = candidates.find(candidate => candidate && fs.existsSync(candidate));
    return executablePath ? { name: definition.name, path: executablePath } : null;
}

function scanWindowsUninstallEditors() {
    const registryRoots = [
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ];
    const editors = [];

    for (const registryRoot of registryRoots) {
        let output = '';
        try {
            output = execFileSync('reg.exe', ['query', registryRoot, '/s'], {
                encoding: 'utf8',
                windowsHide: true,
                maxBuffer: 20 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
        } catch (_) {
            continue;
        }

        let entry = {};
        const flushEntry = () => {
            const editor = resolveWindowsEditor(entry.DisplayName, entry.InstallLocation, entry.DisplayIcon);
            if (editor) editors.push(editor);
            entry = {};
        };

        for (const line of String(output || '').split(/\r?\n/)) {
            if (/^HKEY_/i.test(line.trim())) {
                flushEntry();
                continue;
            }
            const match = line.match(/^\s+(DisplayName|InstallLocation|DisplayIcon)\s+REG_\w+\s+(.*)$/i);
            if (match) entry[match[1]] = match[2].trim();
        }
        flushEntry();
    }

    return editors;
}

function detectAvailableEditorsSync() {
    const editors = process.platform === 'win32' ? scanWindowsUninstallEditors() : [];

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || '';
        const programFiles = process.env.ProgramFiles || '';
        const commonInstalls = [
            ['Visual Studio Code', localAppData && path.join(localAppData, 'Programs', 'Microsoft VS Code')],
            ['Cursor', localAppData && path.join(localAppData, 'Programs', 'cursor')],
            ['Trae', localAppData && path.join(localAppData, 'Programs', 'Trae')],
            ['Windsurf', localAppData && path.join(localAppData, 'Programs', 'Windsurf')],
            ['Visual Studio Code', programFiles && path.join(programFiles, 'Microsoft VS Code')],
        ];
        for (const [name, installLocation] of commonInstalls) {
            const editor = resolveWindowsEditor(name, installLocation, '');
            if (editor) editors.push(editor);
        }
    }

    for (const definition of PLUGIN_EDITOR_DEFINITIONS) {
        if (editors.some(editor => editor.name === definition.name)) continue;
        for (const command of definition.commands) {
            const commandPath = findExecutableOnPath(command);
            if (commandPath) {
                editors.push({ name: definition.name, path: commandPath });
                break;
            }
        }
    }

    const seen = new Set();
    return editors.filter(editor => {
        const key = editor.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Port parsing helpers
function parseLsofEndpoint(str) {
    if (!str) return { address: '', port: 0 };
    const lastColon = str.lastIndexOf(':');
    if (lastColon < 0) return { address: str, port: 0 };
    const address = str.substring(0, lastColon);
    const port = parseInt(str.substring(lastColon + 1)) || 0;
    return { address: address === '*' ? '0.0.0.0' : address, port };
}

function parseSsEndpoint(str) {
    if (!str || str === '*:*') return { address: '*', port: null };
    // IPv6: [::1]:port
    const bracketEnd = str.lastIndexOf(']:');
    if (bracketEnd >= 0) {
        const address = str.substring(1, bracketEnd);
        const port = parseInt(str.substring(bracketEnd + 2)) || null;
        return { address, port };
    }
    const lastColon = str.lastIndexOf(':');
    if (lastColon < 0) return { address: str, port: null };
    const address = str.substring(0, lastColon);
    const portStr = str.substring(lastColon + 1);
    return { address, port: portStr === '*' ? null : (parseInt(portStr) || null) };
}

// Cleanup on process-level signals only (not plugin UI close)
// platform.onPluginOut is intentionally NOT cleaning up processes,
// so running commands continue when the plugin UI is closed.
process.once('beforeExit', () => cleanupAllProcesses({ synchronous: true }));
process.once('exit', () => cleanupAllProcesses({ synchronous: true }));
process.once('SIGINT', () => {
    cleanupAllProcesses({ synchronous: true });
    process.exit(130);
});
process.once('SIGTERM', () => {
    cleanupAllProcesses({ synchronous: true });
    process.exit(143);
});
process.once('SIGHUP', () => {
    cleanupAllProcesses({ synchronous: true });
    process.exit(129);
});
process.once('uncaughtException', (error) => {
    console.error(error);
    cleanupAllProcesses({ synchronous: true });
    process.exit(1);
});
process.once('unhandledRejection', (reason) => {
    console.error(reason);
    cleanupAllProcesses({ synchronous: true });
    process.exit(1);
});

function createStreamDecoder() {
    let pending = Buffer.alloc(0);
    return {
        push(chunk) {
            pending = Buffer.concat([pending, Buffer.from(chunk)]);
            const lines = [];
            let index;
            while ((index = pending.indexOf(0x0a)) >= 0) {
                const raw = pending.subarray(0, index);
                pending = pending.subarray(index + 1);
                lines.push(raw.toString('utf8').replace(/\r$/, ''));
            }
            let partial = null;
            if (pending.length) {
                try {
                    partial = pending.toString('utf8');
                } catch (_) {
                    partial = null;
                }
            }
            return { lines, partial };
        },
        finish() {
            if (!pending.length) return null;
            const leftover = pending.toString('utf8');
            pending = Buffer.alloc(0);
            return leftover || null;
        },
    };
}

function emitProcessOutput(commandKey, sessionId, stream, data, partial, logFn) {
    if (outputCallback) outputCallback({
        id: commandKey,
        commandKey,
        sessionId,
        stream,
        type: stream,
        data,
        partial: !!partial,
    });
    if (!partial && logFn) logFn(stream === 'stderr' ? `ERR: ${data}` : data);
}

function attachProcessIo(commandKey, sessionId, child, logFn) {
    const stdoutDecoder = createStreamDecoder();
    const stderrDecoder = createStreamDecoder();
    const handleChunk = (decoder, type, chunk) => {
        const { lines, partial } = decoder.push(chunk);
        for (const line of lines) emitProcessOutput(commandKey, sessionId, type, line, false, logFn);
        if (partial) emitProcessOutput(commandKey, sessionId, type, partial, true, null);
    };
    if (child.stdout) child.stdout.on('data', (data) => handleChunk(stdoutDecoder, 'stdout', data));
    if (child.stderr) child.stderr.on('data', (data) => handleChunk(stderrDecoder, 'stderr', data));
    child.on('close', () => {
        const leftoverOut = stdoutDecoder.finish();
        if (leftoverOut) emitProcessOutput(commandKey, sessionId, 'stdout', leftoverOut, false, logFn);
        const leftoverErr = stderrDecoder.finish();
        if (leftoverErr) emitProcessOutput(commandKey, sessionId, 'stderr', leftoverErr, false, logFn);
    });
}

function writeChildStdin(commandKey, input) {
    const child = processes.get(commandKey);
    if (!child) return Promise.reject(new Error('commandKey 不存在'));
    if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) {
        return Promise.reject(new Error('stdin closed'));
    }
    return new Promise((resolve, reject) => {
        child.stdin.write(input, (error) => {
            if (error) {
                reject(new Error(error.code === 'EPIPE' ? 'broken pipe' : error.message));
                return;
            }
            resolve();
        });
    });
}

function normalizeRuntimePath(runtimePath) {
    return String(runtimePath || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase();
}

function nodeExecutableForRuntime(runtimePath) {
    const root = String(runtimePath || '').trim();
    if (!root) return '';
    try {
        if (fs.existsSync(root) && fs.statSync(root).isFile()) return root;
        const candidates = process.platform === 'win32'
            ? [path.join(root, 'node.exe'), path.join(root, 'bin', 'node.exe')]
            : [path.join(root, 'bin', 'node'), path.join(root, 'node')];
        return candidates.find(candidate => fs.existsSync(candidate)) || '';
    } catch (_) {
        return '';
    }
}

function nvmDiscoveryRoots() {
    const roots = [];
    const add = value => {
        if (!value) return;
        const candidate = path.resolve(String(value));
        if (!roots.some(item => normalizeRuntimePath(item) === normalizeRuntimePath(candidate))) roots.push(candidate);
    };
    if (process.platform === 'win32') {
        add(process.env.NVM_HOME);
        add(process.env.NVM_SYMLINK);
        add(process.env.APPDATA && path.join(process.env.APPDATA, 'nvm'));
        add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'nvm'));
    } else {
        add(process.env.NVM_DIR);
        add(path.join(os.homedir(), '.nvm'));
    }
    return roots;
}

function nvmDiscoveryCandidates(root) {
    const candidates = [];
    const add = candidate => {
        if (nodeExecutableForRuntime(candidate) && !candidates.some(item => normalizeRuntimePath(item) === normalizeRuntimePath(candidate))) {
            candidates.push(candidate);
        }
    };
    add(root);
    try {
        const scanRoot = process.platform === 'win32' ? root : path.join(root, 'versions', 'node');
        for (const entry of fs.readdirSync(scanRoot, { withFileTypes: true })) {
            if (entry.isDirectory()) add(path.join(scanRoot, entry.name));
        }
    } catch (_) {}
    return candidates;
}

function readNodeVersion(executable) {
    return new Promise(resolve => {
        execFile(executable, ['-v'], { timeout: 3000, windowsHide: true }, (error, stdout) => {
            if (error) return resolve('');
            const line = String(stdout || '').trim().split(/\r?\n/)[0];
            const normalized = line.startsWith('v') ? line : `v${line}`;
            resolve(/^v\d+\.\d+\.\d+$/.test(normalized) ? normalized : '');
        });
    });
}

async function scanNvmNodeRuntimes() {
    const result = [];
    const seen = new Set();
    for (const root of nvmDiscoveryRoots()) {
        for (const candidate of nvmDiscoveryCandidates(root)) {
            const executable = nodeExecutableForRuntime(candidate);
            const version = await readNodeVersion(executable);
            if (!version) continue;
            const runtimeId = `nvm:${normalizeRuntimePath(candidate)}`;
            if (seen.has(runtimeId)) continue;
            seen.add(runtimeId);
            result.push({ runtimeId, version, path: candidate, source: 'nvm', status: 'available', runtimeRoot: root });
        }
    }
    return result.sort((a, b) => b.version.localeCompare(a.version) || a.path.localeCompare(b.path));
}

async function getPluginSystemNodeState() {
    let nodePath = '';
    try {
        nodePath = String(await runCmd('node -e "console.log(process.execPath)"') || '').trim();
    } catch (_) {}
    const version = nodePath ? await readNodeVersion(nodePath) : '';
    return {
        available: !!nodePath && !!version,
        version: version || undefined,
        nodePath: nodePath || undefined,
        source: 'unknown',
        candidates: nodePath ? [{ path: nodePath, version: version || undefined }] : [],
        pathScope: 'unknown',
    };
}

window.services = {
    managedNodeRuntimeSupported: async () => false,
    listInstalledNodeRuntimes: async () => [],
    scanNvmNodeRuntimes,
    getManagedNodeRuntimeLocation: async () => {
        const rootPath = path.join(platform.getPath('userData'), 'runtimes', 'node');
        return { mode: 'app-data', rootPath, writable: true, portableAvailable: false, installedCount: 0, sizeBytes: 0, sizeStatus: 'ready', warnings: [] };
    },
    migrateManagedNodeRuntimeLocation: async () => {
        throw new Error('Managed Node runtime location is not supported in this plugin');
    },
    listAvailableNodeReleases: async () => [],
    installManagedNode: async () => {
        throw new Error('Managed Node runtime is not supported in this plugin. Use the desktop app.');
    },
    cancelManagedNodeInstall: async () => {
        throw new Error('Managed Node runtime is not supported in this plugin');
    },
    uninstallManagedNode: async () => {
        throw new Error('Managed Node runtime is not supported in this plugin');
    },
    getNvmList: async () => [],
    sendProjectInput: async (commandKey, input) => writeChildStdin(commandKey, input),
    closeProjectInput: async (commandKey) => {
        const child = processes.get(commandKey);
        if (!child) throw new Error('commandKey 不存在');
        if (child.stdin && !child.stdin.destroyed) child.stdin.end();
    },

    getSystemNodePath: async () => {
        try {
            return await runCmd('node -e "console.log(process.execPath)"');
        } catch (e) {
            return null;
        }
    },
    getSystemNodeState: getPluginSystemNodeState,
    systemNodeSwitchSupported: async () => false,
    switchSystemNode: async () => ({
        success: false,
        status: 'failed',
        errorCode: 'unsupported_platform',
        message: 'System Node switching is only supported in the desktop app',
    }),

    getNodeVersion: async (nodePath) => {
        return new Promise(resolve => {
            const cb = (err, stdout) => {
                if (err) return resolve('');
                resolve(stdout.trim());
            };
            if (nodePath && nodePath !== 'System Default') {
                let exe = nodePath;
                try {
                    if (fs.existsSync(nodePath) && fs.statSync(nodePath).isDirectory()) {
                        const win = path.join(nodePath, 'node.exe');
                        const unix = path.join(nodePath, 'bin', 'node');
                        if (fs.existsSync(win)) exe = win;
                        else if (fs.existsSync(unix)) exe = unix;
                    }
                } catch (_) {}
                execFile(exe, ['-v'], cb);
            } else {
                exec('node -v', cb);
            }
        });
    },

    getHomeDirectory: async () => os.homedir(),

    installNode: async () => {
        throw new Error('Managed Node runtime is not supported in this plugin. Use the desktop app.');
    },

    uninstallNode: async () => {
        throw new Error('Managed Node runtime is not supported in this plugin');
    },

    useNode: async () => {
        throw new Error('use_node is deprecated; set the Project Manager default Node instead');
    },

    scanProject: async (projectPath) => {
        try {
            const pkgPath = path.join(projectPath, 'package.json');
            const dirName = path.basename(projectPath);

            if (!fs.existsSync(pkgPath)) {
                // Java：先于 "other" 判定，与 src-tauri/src/project.rs 的 scan_project 保持一致。
                // 不识别的话前端「命令」页签整个不渲染，Java 项目就只能开编辑器。
                const isMaven = fs.existsSync(path.join(projectPath, 'pom.xml'));
                const isGradle = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
                    .some((name) => fs.existsSync(path.join(projectPath, name)));
                if (isMaven || isGradle) {
                    const buildTool = isMaven ? 'maven' : 'gradle';
                    const hasWrapper = isMaven
                        ? (fs.existsSync(path.join(projectPath, 'mvnw')) || fs.existsSync(path.join(projectPath, 'mvnw.cmd')))
                        : (fs.existsSync(path.join(projectPath, 'gradlew')) || fs.existsSync(path.join(projectPath, 'gradlew.bat')));
                    return {
                        name: dirName,
                        scripts: [],
                        path: projectPath,
                        packageManager: undefined,
                        nvmVersion: undefined,
                        nodeVersionHint: undefined,
                        projectType: 'java',
                        buildTool,
                        hasWrapper
                    };
                }

                // Non-Node project
                return {
                    name: dirName,
                    scripts: [],
                    path: projectPath,
                    packageManager: undefined,
                    nvmVersion: undefined,
                    nodeVersionHint: undefined,
                    projectType: 'other'
                };
            }

            let pkg = {};
            try {
                const content = fs.readFileSync(pkgPath, 'utf-8');
                pkg = JSON.parse(content);
            } catch (e) {
                console.error('Failed to parse package.json:', e);
            }

            let packageManager = undefined;
            if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
                packageManager = 'pnpm';
            } else if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
                packageManager = 'yarn';
            } else if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) {
                packageManager = 'npm';
            }

            let nvmVersion = undefined;
            for (const hintName of ['.nvmrc', '.node-version']) {
                const hintPath = path.join(projectPath, hintName);
                if (fs.existsSync(hintPath)) {
                    const rawHint = fs.readFileSync(hintPath, 'utf-8').trim();
                    if (rawHint) {
                        nvmVersion = rawHint;
                        break;
                    }
                }
            }

            return {
                name: pkg.name || dirName,
                scripts: Object.keys(pkg.scripts || {}),
                path: projectPath,
                packageManager,
                nvmVersion,
                nodeVersionHint: nvmVersion,
                projectType: 'node'
            };
        } catch (e) {
            throw e;
        }
    },

    scanSubProjects: async (projectPath, maxDepth) => {
        const limit = typeof maxDepth === 'number' && maxDepth > 0 ? maxDepth : MAX_SCAN_DEPTH;
        return scanChildDirs(projectPath, 1, limit, new Set());
    },

    scanImportTree: async (rootPath) => scanChildDirs(rootPath, 1, MAX_SCAN_DEPTH, new Set()),

    gitListRemoteBranches: async (url) => {
        return new Promise((resolve, reject) => {
            execFile('git', ['ls-remote', '--heads', '--', url], { windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                }

                const branches = stdout
                    .split(/\r?\n/)
                    .map((line) => line.trim().split(/\s+/)[1] || '')
                    .filter((ref) => ref.startsWith('refs/heads/'))
                    .map((ref) => ref.replace(/^refs\/heads\//, ''))
                    .filter(Boolean)
                    .sort();

                resolve([...new Set(branches)]);
            });
        });
    },

    gitCloneBranch: async (url, branch, destination, operationId) => {
        return new Promise((resolve, reject) => {
            try {
                if (fs.existsSync(destination)) {
                    const entries = fs.readdirSync(destination);
                    if (entries.length > 0) {
                        reject(new Error('Destination directory must be empty'));
                        return;
                    }
                }
            } catch (error) {
                reject(error);
                return;
            }

            const child = execFile(
                'git',
                ['clone', '--branch', branch, '--single-branch', '--', url, destination],
                { windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
                (error, stdout, stderr) => {
                    if (operationId) processes.delete(operationId);
                    if (error) {
                        reject(new Error(stderr || error.message));
                        return;
                    }

                    resolve(`${stdout}${stderr}`.trim());
                }
            );

            if (operationId) {
                processes.set(operationId, child);
            }
        });
    },

    gitCancelOperation: async (operationId) => {
        const child = processes.get(operationId);
        if (child) {
            terminateProcessTree(child);
            processes.delete(operationId);
        }
    },

    runProjectCommand: async (commandKey, sessionId, projectPath, script, packageManager, nodePath) => {
        if (processes.has(commandKey)) throw new Error('Already running');

        // Setup logging
        let logFilePath = null;
        let logStream = null;
        const MAX_LOG_LINES = 500;
        const logBuffer = [];
        let linesSinceRewrite = 0;

        function appendLog(text) {
            if (!text) return;

            // Update buffer
            logBuffer.push(text);
            if (logBuffer.length > MAX_LOG_LINES) {
                logBuffer.shift();
            }

            // Write to file (append)
            if (logStream) {
                logStream.write(text);
                linesSinceRewrite++;

                // Periodic rewrite to keep file size small
                if (linesSinceRewrite >= MAX_LOG_LINES) {
                    rewriteLogFile();
                }
            }
        }

        function rewriteLogFile() {
            if (!logFilePath) return;
            try {
                if (logStream) {
                    logStream.end();
                }
                fs.writeFileSync(logFilePath, logBuffer.join(''), 'utf-8');
                logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
                linesSinceRewrite = 0;
            } catch (e) {
                console.error('[Runner] Failed to rewrite log file:', e);
            }
        }

        try {
            const userData = platform.getPath('userData');
            const baseLogDir = path.join(userData, 'logs');

            // Determine Project Name
            let projectName = path.basename(projectPath);
            try {
                const pkgPath = path.join(projectPath, 'package.json');
                if (fs.existsSync(pkgPath)) {
                    const content = fs.readFileSync(pkgPath, 'utf-8');
                    const pkg = JSON.parse(content);
                    if (pkg.name) {
                        projectName = pkg.name;
                    }
                }
            } catch (e) {
                // Ignore error, keep folder name
            }

            // Sanitize Project Name
            const safeProjectName = projectName.replace(/[<>:"/\\|?*]/g, '_');
            const projectLogDir = path.join(baseLogDir, safeProjectName);

            if (!fs.existsSync(projectLogDir)) {
                fs.mkdirSync(projectLogDir, { recursive: true });
            }

            // Sanitize script name
            const safeScript = script.replace(/[<>:"/\\|?*]/g, '_');
            logFilePath = path.join(projectLogDir, `${safeScript}.log`);

            // Open with 'w' to overwrite existing file (clearing previous run logs)
            logStream = fs.createWriteStream(logFilePath, { flags: 'w' });
        } catch (e) {
            console.error('[Runner] Failed to setup log file:', e);
        }

        // Prepare environment with modified PATH
        const env = { ...process.env };
        let nodeDir = '';

        // Handle Node version PATH modification
        if (nodePath && nodePath !== 'System Default') {
            try {
                // If it's a file (e.g. node.exe), get its directory
                // We shouldn't rely on extension as it could be anything or nothing on linux
                let checkPath = nodePath;
                if (fs.existsSync(checkPath)) {
                     const stat = fs.statSync(checkPath);
                     if (stat.isFile()) {
                         nodeDir = path.dirname(checkPath);
                     } else {
                         nodeDir = checkPath;
                     }
                } else {
                     // If path doesn't exist (maybe strict nodePath not full path?), assume it is a directory
                     nodeDir = nodePath;
                }

                if (nodeDir) {
                    const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
                    const separator = process.platform === 'win32' ? ';' : ':';
                    env[pathKey] = `${nodeDir}${separator}${env[pathKey] || ''}`;
                }
            } catch (e) {
                console.error('[Runner] Error resolving node path:', e);
            }
        }

        // Construct command - resolve absolute path to package manager
        const pm = packageManager || 'npm';
        let spawnCmd = pm;
        let spawnArgs = ['run', script];

        if (nodeDir && process.platform === 'win32') {
            const nodeExe = path.join(nodeDir, 'node.exe');
            const npmCliJs = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
            const pmCmd = path.join(nodeDir, `${pm}.cmd`);

            if (fs.existsSync(npmCliJs)) {
                spawnCmd = `"${nodeExe}" "${npmCliJs}"`;
            } else if (fs.existsSync(pmCmd)) {
                spawnCmd = `"${pmCmd}"`;
            }
        }

        const cmdStr = `${spawnCmd} run ${script}`;

        try {
            console.log('[Runner] Executing:', cmdStr);
            console.log('[Runner] Node Dir:', nodeDir);
            console.log('[Runner] Package Manager:', pm);

            emitProcessOutput(commandKey, sessionId, 'stdout', `Executing: ${cmdStr}`, false, null);
            appendLog(`Executing: ${cmdStr}\n`);
            appendLog(`Node Path used: ${nodeDir || 'System Default'}\n`);

            const child = spawn(spawnCmd, ['run', script], {
                cwd: projectPath,
                shell: true,
                env: env,
                detached: process.platform !== 'win32',
                windowsHide: process.platform === 'win32',
            });

            spawnParentDeathWatch(child);

            const startedAt = Date.now();
            const runState = { child, sessionId, startedAt, stopRequested: false };
            processes.set(commandKey, child);
            runnerProcessStates.set(commandKey, runState);
            attachProcessIo(commandKey, sessionId, child, (text) => appendLog(typeof text === 'string' && text.endsWith('\n') ? text : `${text}\n`));

            let finished = false;
            let waitError = null;
            const finishRun = (exitCode, errorMessage = null) => {
                if (finished) return;
                finished = true;
                const currentState = runnerProcessStates.get(commandKey);
                const stopped = currentState?.sessionId === sessionId && currentState.stopRequested === true;
                runnerProcessStates.delete(commandKey);
                processes.delete(commandKey);
                rewriteLogFile();
                if (logStream) logStream.end();
                if (exitCallback) {
                    exitCallback({
                        id: commandKey,
                        commandKey,
                        sessionId,
                        exitCode: typeof exitCode === 'number' ? exitCode : null,
                        stopped,
                        durationMs: Math.max(0, Date.now() - startedAt),
                        ...(errorMessage ? { waitError: errorMessage } : {}),
                    });
                }
            };

            child.on('close', (code) => finishRun(code, waitError));
            child.on('error', (err) => {
                console.error('[Runner] Spawn error:', err);
                const errMsg = `Error spawning process: ${err.message}`;
                emitProcessOutput(commandKey, sessionId, 'stderr', errMsg, false, null);
                appendLog(`${errMsg}\n`);
                waitError = err.message;
            });

        } catch (e) {
            if (logStream) logStream.end();
            throw e;
        }
    },

    stopProjectCommand: async (commandKey) => {
        const state = runnerProcessStates.get(commandKey);
        const child = processes.get(commandKey);
        if (!state || !child) throw new Error('commandKey 不存在');
        state.stopRequested = true;
        try {
            terminateRunnerProcessTree(child);
        } catch (error) {
            state.stopRequested = false;
            throw error;
        }
    },

    runCustomCommand: async (commandKey, sessionId, projectPath, command) => {
        if (processes.has(commandKey)) throw new Error('Already running');

        const child = spawn(command, {
            cwd: projectPath,
            shell: true,
            env: { ...process.env },
            detached: process.platform !== 'win32',
            windowsHide: process.platform === 'win32',
        });

        spawnParentDeathWatch(child);

        const startedAt = Date.now();
        const runState = { child, sessionId, startedAt, stopRequested: false };
        processes.set(commandKey, child);
        runnerProcessStates.set(commandKey, runState);
        attachProcessIo(commandKey, sessionId, child);

        let finished = false;
        let waitError = null;
        const finishRun = (exitCode, errorMessage = null) => {
            if (finished) return;
            finished = true;
            const currentState = runnerProcessStates.get(commandKey);
            const stopped = currentState?.sessionId === sessionId && currentState.stopRequested === true;
            runnerProcessStates.delete(commandKey);
            processes.delete(commandKey);
            if (exitCallback) {
                exitCallback({
                    id: commandKey,
                    commandKey,
                    sessionId,
                    exitCode: typeof exitCode === 'number' ? exitCode : null,
                    stopped,
                    durationMs: Math.max(0, Date.now() - startedAt),
                    ...(errorMessage ? { waitError: errorMessage } : {}),
                });
            }
        };

        child.on('close', (code) => finishRun(code, waitError));
        child.on('error', (err) => {
            const errMsg = `Error spawning process: ${err.message}`;
            emitProcessOutput(commandKey, sessionId, 'stderr', errMsg, false, null);
            waitError = err.message;
        });
    },

    onProjectOutput: async (cb) => {
        outputCallback = cb;
        return () => { outputCallback = null; };
    },

    onProjectExit: async (cb) => {
        exitCallback = cb;
        return () => { exitCallback = null; };
    },

    readConfigFile: async (filename) => {
        const filePath = configPath(filename);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
        return "";
    },

    writeConfigFile: async (filename, content) => {
        writeConfigSafely(filename, content);
    },

    hasConfigBackup: async (filename) => {
        return fs.existsSync(backupPath(configPath(filename)));
    },

    readConfigBackup: async (filename) => {
        const filePath = backupPath(configPath(filename));
        return fs.readFileSync(filePath, 'utf-8');
    },

    restoreConfigBackup: async (filename) => {
        return restoreConfigSafely(filename);
    },

    canOpenConfigDirectory: async () => {
        return typeof platform.shellOpenPath === 'function' || typeof platform.openFolder === 'function';
    },

    openConfigDirectory: async () => {
        const userPath = platform.getPath('userData');
        if (typeof platform.shellOpenPath === 'function') {
            await platform.shellOpenPath(userPath);
            return;
        }
        if (typeof platform.openFolder === 'function') {
            await platform.openFolder(userPath);
            return;
        }
        throw new Error('Opening the config directory is unavailable in this host.');
    },

    readTextFile: async (path) => {
        return decodeTextBuffer(fs.readFileSync(path));
    },

    readBinaryFileBase64: async (path) => {
        return fs.readFileSync(path).toString('base64');
    },

    writeTextFile: async (path, content) => {
        fs.writeFileSync(path, content, 'utf-8');
    },

    readDir: async (dirPath) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory()
        }));
    },

    openDialog: async (options) => {
        const electronOptions = {
            properties: []
        };
        if (options?.directory) {
            electronOptions.properties.push('openDirectory');
        } else {
            electronOptions.properties.push('openFile');
        }
        if (options?.multiple) {
            electronOptions.properties.push('multiSelections');
        }
        if (options?.defaultPath) {
            electronOptions.defaultPath = options.defaultPath;
        }
        if (options?.filters) {
            electronOptions.filters = options.filters;
        }

        const result = platform.showOpenDialog(electronOptions);
        if (!result) return null;
        if (options?.multiple) return result;
        return result[0];
    },

    saveDialog: async (options) => {
        return platform.showSaveDialog(options);
    },

    openUrl: async (url) => {
        platform.shellOpenExternal(assertSafeExternalUrl(url));
    },

    openFolder: async (folderPath) => {
        if (process.platform === 'win32') {
            spawn('explorer.exe', [folderPath], { windowsHide: true });
            return;
        }
        if (process.platform === 'darwin') {
            spawn('open', [folderPath]);
            return;
        }
        platform.shellOpenPath(folderPath);
    },

    openPath: async (filePath) => {
        platform.shellOpenPath(filePath);
    },

    workspaceReadDir: async (root, relativePath = '') => {
        const rootPath = fs.realpathSync(path.resolve(root));
        const directory = resolveWorkspacePath(rootPath, relativePath);
        if (!fs.statSync(directory).isDirectory()) throw new Error('Workspace path is not a directory');
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => !entry.isSymbolicLink())
            .map(entry => {
                const fullPath = path.join(directory, entry.name);
                assertWorkspaceWithin(rootPath, fs.realpathSync(fullPath));
                return { name: entry.name, isDirectory: entry.isDirectory(), size: fs.statSync(fullPath).size };
            })
            .sort((a, b) => Number(!a.isDirectory) - Number(!b.isDirectory) || a.name.localeCompare(b.name));
    },

    workspaceCreateFile: async (root, relativePath) => {
        const filePath = resolveWorkspacePath(root, relativePath, true);
        if (fs.existsSync(filePath)) throw new Error(`Path already exists: ${relativePath}`);
        const fd = fs.openSync(filePath, 'wx');
        fs.closeSync(fd);
    },

    workspaceCreateDirectory: async (root, relativePath) => {
        const directory = resolveWorkspacePath(root, relativePath, true);
        if (fs.existsSync(directory)) throw new Error(`Path already exists: ${relativePath}`);
        fs.mkdirSync(directory);
    },

    workspaceRename: async (root, fromRelative, toRelative) => {
        const rootPath = fs.realpathSync(path.resolve(root));
        const fromPath = resolveWorkspacePath(rootPath, fromRelative);
        if (fromPath === rootPath) throw new Error('Cannot rename workspace root');
        const toPath = resolveWorkspacePath(rootPath, toRelative, true);
        if (fs.existsSync(toPath)) throw new Error(`Target path already exists: ${toRelative}`);
        fs.renameSync(fromPath, toPath);
    },

    workspaceTrash: async (root, relativePath) => {
        const rootPath = fs.realpathSync(path.resolve(root));
        const target = resolveWorkspacePath(rootPath, relativePath);
        if (target === rootPath) throw new Error('Cannot delete workspace root');
        fs.rmSync(target, { recursive: true, force: false });
    },

    workspaceStat: async (root, relativePath = '') => {
        const target = resolveWorkspacePath(root, relativePath, true);
        if (!fs.existsSync(target)) return { exists: false, isDirectory: false, size: 0, diskVersion: `missing:${target}`, readOnly: false };
        const stat = fs.statSync(target);
        return { exists: true, isDirectory: stat.isDirectory(), size: stat.size, diskVersion: workspaceDiskVersion(target, stat), readOnly: isReadonlyPath(target, stat) };
    },

    workspaceReadEditorFile: async (root, relativePath) => {
        const target = resolveWorkspacePath(root, relativePath);
        const stat = fs.statSync(target);
        if (stat.isDirectory()) throw new Error('Cannot open a directory in the editor');
        const bytes = fs.readFileSync(target);
        const decoded = decodeEditorBuffer(bytes);
        return {
            content: decoded.content,
            size: bytes.length,
            diskVersion: workspaceDiskVersion(target, stat),
            encoding: decoded.encoding,
            eol: bytes.includes(Buffer.from('\r\n')) ? 'crlf' : 'lf',
            readOnly: decoded.readOnly || isReadonlyPath(target, stat),
        };
    },

    workspaceReadBinaryFileBase64: async (root, relativePath) => {
        const target = resolveWorkspacePath(root, relativePath);
        const stat = fs.statSync(target);
        if (stat.size > 20 * 1024 * 1024) throw new Error('file_too_large');
        return fs.readFileSync(target).toString('base64');
    },

    workspaceWriteEditorFile: async (root, relativePath, content, expectedDiskVersion = '', eol = 'lf', bom = false, force = false) => {
        const target = resolveWorkspacePath(root, relativePath, true);
        const currentVersion = fs.existsSync(target) ? workspaceDiskVersion(target) : '';
        if (!force && String(expectedDiskVersion || '') !== currentVersion) throw new Error('external_modified');
        const bytes = editorBytes(content, eol, Boolean(bom));
        atomicWriteEditorBytes(target, bytes);
        const stat = fs.statSync(target);
        return { diskVersion: workspaceDiskVersion(target, stat), size: stat.size };
    },

    workspaceTrashMode: async () => 'permanent',

    revealInFolder: async (filePath) => {
        if (process.platform === 'win32') {
            const normalized = filePath.replace(/\//g, '\\');
            const target = fs.existsSync(normalized) ? normalized : path.dirname(normalized);
            spawn('explorer.exe', ['/select,', target], { windowsHide: true });
            return;
        }
        if (process.platform === 'darwin') {
            spawn('open', ['-R', filePath]);
            return;
        }
        platform.shellOpenPath(path.dirname(filePath));
    },

    openInEditor: async (path, editor = 'code') => {
        // Validate editor: must be a simple command name or an absolute file path
        const isAbsolutePath = require('path').isAbsolute(editor);
        const isSimpleName = /^[a-zA-Z0-9_\-]+$/.test(editor);
        if (!isAbsolutePath && !isSimpleName) {
            console.error(`Disallowed editor: ${editor}`);
            return;
        }
        spawn(editor, [path], { shell: false });
    },

    getAppVersion: async () => {
        return "1.7.0";
    },

    installUpdate: async (url) => {
        platform.shellOpenExternal(assertSafeExternalUrl(url));
    },

    onDownloadProgress: async (cb) => {
        return () => {};
    },

    // Window controls
    windowMinimize: async () => {
        platform.hideMainWindow();
    },
    windowMaximize: async () => {
        // uTools usually doesn't support maximizing in the traditional sense like an app window
        // But we can keep it empty or try to do nothing
    },
    windowUnmaximize: async () => {},
    windowClose: async () => { platform.outPlugin(); },
    windowIsMaximized: async () => true,
    windowSetAlwaysOnTop: async () => {},
    onWindowResize: async () => () => {},

    //************* 终端检测 *************
    detectAvailableTerminals: async () => {
        const terminals = [];

        // Windows 平台
        if (process.platform === 'win32') {
            terminals.push({
                id: 'cmd',
                name: 'Command Prompt (cmd.exe)'
            });

            try {
                execSync('where powershell', { stdio: 'ignore' });
                terminals.push({
                    id: 'powershell',
                    name: 'PowerShell'
                });
            } catch (e) {}

            try {
                execSync('where pwsh', { stdio: 'ignore' });
                terminals.push({
                    id: 'pwsh',
                    name: 'PowerShell 7 (pwsh)'
                });
            } catch (e) {}

        } else if (process.platform === 'darwin') {
            terminals.push({
                id: 'terminal',
                name: 'Terminal.app'
            });
        } else {
             // Linux
             try { execSync('which gnome-terminal', { stdio: 'ignore' }); terminals.push({ id: 'gnome-terminal', name: 'GNOME Terminal' }); } catch(e) {}
             try { execSync('which konsole', { stdio: 'ignore' }); terminals.push({ id: 'konsole', name: 'Konsole (KDE)' }); } catch(e) {}
             try { execSync('which xfce4-terminal', { stdio: 'ignore' }); terminals.push({ id: 'xfce4-terminal', name: 'XFCE Terminal' }); } catch(e) {}
        }

        return terminals;
    },

    detectAvailableEditors: async () => {
        return detectAvailableEditorsSync();
    },

    //************* 终端打开 *************
    openInTerminal: async (projectPath, terminal, nodePath, packageManager) => {
        const termRaw = (terminal || 'cmd').trim();
        const term = termRaw.toLowerCase();
        const spawnOptions = getTerminalSpawnOptions(nodePath);

        // 解析项目 Node 目录用于构造 npm 版本检查命令（绕过 npm.cmd 软链问题）
        // startupScript = 别名定义(npm→正确cli) + 版本输出，让用户手敲 npm 也走正确路径
        const resolvedNodeDir = resolveTerminalNodeDir(nodePath) || '';
        const startupCheckPs = buildStartupScript(resolvedNodeDir, packageManager, 'ps');
        const startupCheckCmd = buildStartupScript(resolvedNodeDir, packageManager, 'cmd');
        const startupCheckBash = buildStartupScript(resolvedNodeDir, packageManager, 'bash');

        if (process.platform === 'win32') {
            try {
                const winPath = projectPath.replace(/\//g, "\\");
                const winPathCmd = escapeCmdDoubleQuotes(winPath);
                const pathEnvCmd = spawnOptions.env?.PATH ? escapeCmdDoubleQuotes(spawnOptions.env.PATH) : '';
                const winPathPs = escapePowerShellSingleQuotes(winPath);
                const pathEnvPs = spawnOptions.env?.PATH ? escapePowerShellSingleQuotes(spawnOptions.env.PATH) : '';

                // Detect terminal type by name or executable path
                const terminalBaseName = path.basename(termRaw).toLowerCase();
                const isCustomExecutable = termRaw.includes('\\') || termRaw.includes('/') || term.endsWith('.exe');
                const isWindowsPowerShell = term === 'powershell' || term === 'powershell.exe' || terminalBaseName === 'powershell.exe';
                const isPwsh = term === 'pwsh' || term === 'pwsh.exe' || terminalBaseName === 'pwsh.exe';

                if (isWindowsPowerShell) {
                     // 用 joinShellCommands 拼接：非 node 项目 startupCheck 为空时不会留下悬空的 `;`
                     const startupScript = joinShellCommands([
                        pathEnvPs ? `$env:PATH='${pathEnvPs}'` : '',
                        `Set-Location '${winPathPs}'`,
                        startupCheckPs,
                     ], '; ');
                     const executable = isCustomExecutable ? termRaw : 'powershell';
                     spawn('cmd', ['/C', 'start', '', executable, '-NoExit', '-Command', startupScript], spawnOptions);
                } else if (isPwsh) {
                     const startupScript = joinShellCommands([
                        pathEnvPs ? `$env:PATH='${pathEnvPs}'` : '',
                        `Set-Location '${winPathPs}'`,
                        startupCheckPs,
                     ], '; ');
                     const executable = isCustomExecutable ? termRaw : 'pwsh';
                     spawn('cmd', ['/C', 'start', '', executable, '-NoExit', '-Command', startupScript], spawnOptions);
                } else if (term === 'windows-terminal') {
                    const startupCommand = joinShellCommands([
                        pathEnvCmd ? `set "PATH=${pathEnvCmd}"` : '',
                        // wt 已用 -d 切到目标目录，这里仅在需要改 PATH 时补一次 cd 保证同一会话内生效
                        pathEnvCmd ? `cd /d "${winPathCmd}"` : '',
                        startupCheckCmd,
                    ], ' && ');
                    if (startupCommand) {
                        spawn('wt', ['-d', winPath, 'cmd', '/K', startupCommand], spawnOptions);
                    } else {
                        // 非 node 项目且无需改 PATH：直接开一个干净的 cmd，不带 /K 命令
                        spawn('wt', ['-d', winPath, 'cmd'], spawnOptions);
                    }
                } else if (term === 'cmder') {
                    const startupCommand = joinShellCommands([
                        pathEnvCmd ? `set "PATH=${pathEnvCmd}"` : '',
                        `cd /d "${winPathCmd}"`,
                        'cmder',
                        startupCheckCmd,
                    ], ' && ');
                    spawn('cmd', ['/C', 'start', '', 'cmd', '/K', startupCommand], spawnOptions);
                } else if (term === 'git-bash') {
                    const gitBash = [
                        path.join(process.env.ProgramFiles || '', 'Git', 'git-bash.exe'),
                        path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'git-bash.exe'),
                        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'git-bash.exe'),
                    ].find(fs.existsSync);

                    if (gitBash) {
                        spawn('cmd', ['/C', 'start', '', gitBash, `--cd=${winPath}`], spawnOptions);
                    } else {
                        const bashInner = joinShellCommands([startupCheckBash, 'exec bash'], '; ').replace(/"/g, '\\"');
                        const startupCommand = joinShellCommands([
                            pathEnvCmd ? `set "PATH=${pathEnvCmd}"` : '',
                            `cd /d "${winPathCmd}"`,
                            `bash -c "${bashInner}"`,
                        ], ' && ');
                        spawn('cmd', ['/K', startupCommand], spawnOptions);
                    }
                } else {
                    if (termRaw.includes('\\') || termRaw.includes('/') || term.endsWith('.exe')) {
                        const customOptions = { ...spawnOptions, cwd: winPath };
                        spawn(termRaw, [], customOptions);
                    } else {
                        // CMD (Default)
                        const startupCommand = joinShellCommands([
                            pathEnvCmd ? `set "PATH=${pathEnvCmd}"` : '',
                            `cd /d "${winPathCmd}"`,
                            startupCheckCmd,
                        ], ' && ');
                        spawn('cmd', ['/C', 'start', '', 'cmd', '/K', startupCommand], spawnOptions);
                    }
                }
            } catch (e) {
                console.error('Failed to open terminal', e);
            }
        } else if (process.platform === 'darwin') {
             try {
                if (termRaw.includes('/')) {
                    spawn(termRaw, [], { ...spawnOptions, cwd: projectPath });
                } else {
                    spawn('open', ['-a', 'Terminal', projectPath], spawnOptions);
                }
             } catch (e) {
                console.error(e);
             }
        } else {
            // Linux
            // 非 node 项目 startupCheckBash 为空，用 join 跳过空段，避免 `; exec bash` 前面留下悬空分隔符
            const bashInner = joinShellCommands([startupCheckBash, 'exec bash'], '; ');
            const xfceInline = `bash -c '${bashInner.replace(/'/g, "'\\''")}'`;
            const terms = [
                { id: 'gnome-terminal', cmd: 'gnome-terminal', args: ['--working-directory', projectPath, '--', 'bash', '-c', bashInner] },
                { id: 'konsole', cmd: 'konsole', args: ['--workdir', projectPath, '-e', 'bash', '-c', bashInner] },
                { id: 'xfce4-terminal', cmd: 'xfce4-terminal', args: ['--working-directory', projectPath, '-e', xfceInline] }
            ];

            const target = terms.find(t => t.id === term);

            if (target) {
                 spawn(target.cmd, target.args, spawnOptions).unref();
            } else {
                if (termRaw.includes('/')) {
                    spawn(termRaw, [], { ...spawnOptions, cwd: projectPath }).unref();
                    return;
                }
                // Fallback attempt
                for (const t of terms) {
                    try {
                        const child = spawn(t.cmd, t.args, spawnOptions);
                        child.on('error', () => {});
                        child.unref();
                        break;
                    } catch (e) {}
                }
            }
        }
    },

    // ─── Port Management ─────────────────────────────────────────────────────

    listUsedPorts: async () => {
        return new Promise((resolve, reject) => {
            if (process.platform === 'win32') {
                // Windows: Use PowerShell Get-NetTCPConnection + Get-NetUDPEndpoint
                const script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ports = @()
$ports += Get-NetTCPConnection -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    Protocol = 'TCP'
    LocalAddress = if ($_.LocalAddress) { $_.LocalAddress.ToString() } else { '' }
    LocalPort = $_.LocalPort
    RemoteAddress = if ($_.RemoteAddress) { $_.RemoteAddress.ToString() } else { '' }
    RemotePort = $_.RemotePort
    State = if ($_.State) { $_.State.ToString() } else { 'UNKNOWN' }
    OwningProcess = $_.OwningProcess
  }
}
$ports += Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    Protocol = 'UDP'
    LocalAddress = if ($_.LocalAddress) { $_.LocalAddress.ToString() } else { '' }
    LocalPort = $_.LocalPort
    RemoteAddress = ''
    RemotePort = $null
    State = 'LISTEN'
    OwningProcess = $_.OwningProcess
  }
}
$processIds = @{}
$ports | ForEach-Object { $processIds[[int]$_.OwningProcess] = $true }
$procs = @{}
if ($processIds.Count -gt 0) {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $processIds.ContainsKey([int]$_.ProcessId)
  } | ForEach-Object {
    $procs[$_.ProcessId] = @{ Name = $_.Name; Path = $_.ExecutablePath; Cmd = $_.CommandLine }
  }
}
$result = $ports | ForEach-Object {
  $p = $procs[$_.OwningProcess]
  [pscustomobject]@{
    protocol = $_.Protocol
    local_address = $_.LocalAddress
    local_port = $_.LocalPort
    remote_address = if ($_.RemoteAddress -and $_.RemoteAddress -ne '') { $_.RemoteAddress } else { $null }
    remote_port = $_.RemotePort
    state = $_.State.ToUpper()
    pid = $_.OwningProcess
    process_name = if ($p) { $p.Name } else { $null }
    executable_path = if ($p) { $p.Path } else { $null }
    command_line = if ($p) { $p.Cmd } else { $null }
  }
} | Sort-Object local_port, protocol, pid
$result | ConvertTo-Json -Compress`;

                const powershellPath = path.join(
                    process.env.SystemRoot || 'C:\\Windows',
                    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
                );
                const powershellCommand = fs.existsSync(powershellPath) ? powershellPath : 'powershell.exe';
                execFile(powershellCommand, ['-NoProfile', '-NonInteractive', '-Command', script], {
                    maxBuffer: 50 * 1024 * 1024,
                    windowsHide: true,
                    encoding: 'utf8',
                }, (error, stdout) => {
                    if (error) return reject(error);
                    try {
                        const trimmed = (stdout || '').trim();
                        if (!trimmed || trimmed === 'null') return resolve([]);
                        const parsed = JSON.parse(trimmed);
                        resolve(Array.isArray(parsed) ? parsed : [parsed]);
                    } catch (e) {
                        reject(new Error('Failed to parse port data: ' + e.message));
                    }
                });
            } else if (process.platform === 'darwin') {
                // macOS: Use lsof
                exec('lsof -i -n -P', { maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
                    if (error && !stdout) return resolve([]);
                    const lines = (stdout || '').split('\n').slice(1);
                    const entries = [];

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const parts = line.split(/\s+/);
                        if (parts.length < 9) continue;

                        const processName = parts[0];
                        const pid = parseInt(parts[1]) || null;
                        const rawType = (parts[7] || '').toUpperCase();
                        const protocol = rawType === 'UDP' ? 'UDP' : 'TCP';
                        const namePart = parts[8] || '';
                        const state = parts[9] || (protocol === 'UDP' ? 'LISTEN' : 'UNKNOWN');

                        let localAddr = '', localPort = 0, remoteAddr = null, remotePort = null;

                        if (namePart.includes('->')) {
                            const [local, remote] = namePart.split('->');
                            const lp = parseLsofEndpoint(local);
                            const rp = parseLsofEndpoint(remote);
                            localAddr = lp.address;
                            localPort = lp.port;
                            remoteAddr = rp.address || null;
                            remotePort = rp.port || null;
                        } else {
                            const lp = parseLsofEndpoint(namePart);
                            localAddr = lp.address;
                            localPort = lp.port;
                        }

                        if (!localPort) continue;

                        const normalizedState = state.replace(/[()]/g, '').toUpperCase();

                        entries.push({
                            protocol,
                            local_address: localAddr,
                            local_port: localPort,
                            remote_address: remoteAddr,
                            remote_port: remotePort,
                            state: normalizedState === 'ESTABLISHED' ? 'ESTABLISHED'
                                : normalizedState === 'LISTEN' ? 'LISTEN'
                                : normalizedState === 'TIME_WAIT' ? 'TIME_WAIT'
                                : normalizedState === 'CLOSE_WAIT' ? 'CLOSE_WAIT'
                                : normalizedState,
                            pid,
                            process_name: processName,
                            executable_path: null,
                            command_line: null,
                        });
                    }

                    entries.sort((a, b) => a.local_port - b.local_port || a.protocol.localeCompare(b.protocol));
                    resolve(entries);
                });
            } else {
                // Linux: Use ss
                exec('ss -tunap', { maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
                    if (error && !stdout) return resolve([]);
                    const lines = (stdout || '').split('\n').slice(1);
                    const entries = [];

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const parts = line.split(/\s+/);
                        if (parts.length < 5) continue;

                        const proto = parts[0].toUpperCase();
                        const protocol = (proto === 'TCP' || proto === 'TCP6') ? 'TCP' : 'UDP';

                        const stateMap = {
                            'LISTEN': 'LISTEN', 'ESTAB': 'ESTABLISHED', 'TIME-WAIT': 'TIME_WAIT',
                            'CLOSE-WAIT': 'CLOSE_WAIT', 'SYN-SENT': 'SYN_SENT', 'SYN-RECV': 'SYN_RECV',
                            'FIN-WAIT-1': 'FIN_WAIT_1', 'FIN-WAIT-2': 'FIN_WAIT_2', 'UNCONN': 'LISTEN',
                        };
                        const state = stateMap[parts[1]] || parts[1].toUpperCase();

                        const localEp = parseSsEndpoint(parts[4]);
                        const remoteEp = parts.length > 5 ? parseSsEndpoint(parts[5]) : { address: null, port: null };

                        if (!localEp.port) continue;

                        let pid = null, processName = null;
                        const usersField = parts.find(p => p.startsWith('users:'));
                        if (usersField) {
                            const match = usersField.match(/\("([^"]+)",pid=(\d+)/);
                            if (match) {
                                processName = match[1];
                                pid = parseInt(match[2]) || null;
                            }
                        }

                        let executablePath = null, commandLine = null;
                        if (pid) {
                            try { executablePath = fs.readlinkSync(`/proc/${pid}/exe`); } catch (_) {}
                            try { commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ').trim(); } catch (_) {}
                        }

                        entries.push({
                            protocol,
                            local_address: localEp.address,
                            local_port: localEp.port,
                            remote_address: remoteEp.address && remoteEp.address !== '*' ? remoteEp.address : null,
                            remote_port: remoteEp.port,
                            state,
                            pid,
                            process_name: processName,
                            executable_path: executablePath,
                            command_line: commandLine,
                        });
                    }

                    entries.sort((a, b) => a.local_port - b.local_port || a.protocol.localeCompare(b.protocol));
                    resolve(entries);
                });
            }
        });
    },

    terminateProcessByPid: async (pid) => {
        return new Promise((resolve, reject) => {
            if (!pid || typeof pid !== 'number') {
                return reject(new Error('Invalid PID'));
            }
            if (process.platform === 'win32') {
                exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            } else {
                exec(`kill -9 ${pid}`, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            }
        });
    },

    // ─── Git ─────────────────────────────────────────────────────────────────

    gitCheck: async (projectPath) => {
        try {
            const result = execFileSync('git', ['rev-parse', '--show-toplevel'], {
                cwd: projectPath,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
            const requestedPath = fs.realpathSync(projectPath);
            const repoRootPath = fs.realpathSync(result.toString().trim());
            return process.platform === 'win32'
                ? requestedPath.toLowerCase() === repoRootPath.toLowerCase()
                : requestedPath === repoRootPath;
        } catch (e) {
            return false;
        }
    },

    gitInit: async (projectPath) => {
        return execSync('git init', { cwd: projectPath, windowsHide: true }).toString();
    },

    gitSummary: async (projectPath) => {
        const runGit = (args) => execFileSync('git', args, { cwd: projectPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }).toString().trim();
        const runGitSafe = (args, fallback = '') => {
            try { return runGit(args); } catch { return fallback; }
        };

        const branchRaw = runGitSafe(['branch', '--show-current']);
        const isDetached = branchRaw === '';
        const branch = isDetached
            ? (runGitSafe(['rev-parse', '--short', 'HEAD']) || 'HEAD')
            : branchRaw;

        let ahead = 0, behind = 0, hasRemote = false, remoteName = null, upstream = null;

        if (!isDetached) {
            const remote = runGitSafe(['config', `branch.${branchRaw}.remote`]);
            if (remote) {
                hasRemote = true;
                remoteName = remote;
                const upRef = runGitSafe(['rev-parse', '--abbrev-ref', `${branchRaw}@{upstream}`]);
                if (upRef) upstream = upRef;
                const track = runGitSafe(['rev-list', '--left-right', '--count', `${branchRaw}@{upstream}...HEAD`]);
                if (track) {
                    const parts = track.split(/\s+/);
                    if (parts.length === 2) {
                        behind = parseInt(parts[0]) || 0;
                        ahead = parseInt(parts[1]) || 0;
                    }
                }
            }
        }

        // 状态计数与冲突
        let stagedCount = 0, unstagedCount = 0, untrackedCount = 0, conflictedCount = 0;
        try {
            const porcelain = execSync('git status --porcelain=v1 -uall', {
                cwd: projectPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
            for (const line of porcelain.split('\n')) {
                if (line.length < 3) continue;
                const x = line[0], y = line[1];
                if ((x === 'U' || y === 'U') || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
                    conflictedCount++;
                    continue;
                }
                if (x === '?' && y === '?') { untrackedCount++; continue; }
                if (x !== ' ' && x !== '?') stagedCount++;
                if (y !== ' ' && y !== '?') unstagedCount++;
            }
        } catch (_) {}

        // 进行中操作
        let operationState = null;
        const gitDir = runGitSafe(['rev-parse', '--git-dir']);
        if (gitDir) {
            const base = path.isAbsolute(gitDir) ? gitDir : path.join(projectPath, gitDir);
            if (fs.existsSync(path.join(base, 'MERGE_HEAD'))) operationState = 'merge';
            else if (fs.existsSync(path.join(base, 'CHERRY_PICK_HEAD'))) operationState = 'cherry-pick';
            else if (fs.existsSync(path.join(base, 'REVERT_HEAD'))) operationState = 'revert';
            else if (
                fs.existsSync(path.join(base, 'REBASE_HEAD')) ||
                fs.existsSync(path.join(base, 'rebase-merge')) ||
                fs.existsSync(path.join(base, 'rebase-apply'))
            ) operationState = 'rebase';
        }

        return {
            branch,
            is_detached: isDetached,
            ahead,
            behind,
            has_remote: hasRemote,
            remote_name: remoteName,
            upstream,
            has_conflicts: conflictedCount > 0,
            conflicted_count: conflictedCount,
            staged_count: stagedCount,
            unstaged_count: unstagedCount,
            untracked_count: untrackedCount,
            operation_state: operationState,
        };
    },

    gitStatus: async (projectPath) => {
        let output;
        try {
            output = execSync('git status --porcelain=v1 -uall', {
                cwd: projectPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            output = e.stdout ? e.stdout.toString() : '';
        }

        const staged = [], unstaged = [], untracked = [], conflicted = [];

        for (const line of output.split('\n')) {
            if (line.length < 3) continue;
            const x = line[0], y = line[1];
            const filePath = line.substring(3);

            let actualPath = filePath, oldPath = null;
            if (filePath.includes(' -> ')) {
                const parts = filePath.split(' -> ');
                oldPath = parts[0];
                actualPath = parts[1];
            }

            // Conflicts
            if ((x === 'U' || y === 'U') || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
                conflicted.push({ path: actualPath, status: 'conflicted', staged: false, old_path: oldPath });
                continue;
            }

            // Untracked
            if (x === '?' && y === '?') {
                untracked.push({ path: actualPath, status: 'untracked', staged: false, old_path: null });
                continue;
            }

            // Staged
            if (x !== ' ' && x !== '?') {
                const statusMap = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied' };
                staged.push({ path: actualPath, status: statusMap[x] || 'modified', staged: true, old_path: oldPath });
            }

            // Unstaged
            if (y !== ' ' && y !== '?') {
                const statusMap = { M: 'modified', D: 'deleted' };
                unstaged.push({ path: actualPath, status: statusMap[y] || 'modified', staged: false, old_path: oldPath });
            }
        }

        return { staged, unstaged, untracked, conflicted };
    },

    gitStage: async (projectPath, files) => {
        return execFileSync('git', ['add', '--'].concat(files), { cwd: projectPath, windowsHide: true }).toString();
    },

    gitUnstage: async (projectPath, files) => {
        return execFileSync('git', ['restore', '--staged', '--'].concat(files), { cwd: projectPath, windowsHide: true }).toString();
    },

    gitStageAll: async (projectPath) => {
        return execSync('git add -A', { cwd: projectPath, windowsHide: true }).toString();
    },

    gitUnstageAll: async (projectPath) => {
        return execSync('git restore --staged .', { cwd: projectPath, windowsHide: true }).toString();
    },

    gitAmend: async (projectPath, message) => {
        if (message && String(message).trim()) {
            return execFileSync('git', ['commit', '--amend', '-m', String(message).trim()], {
                cwd: projectPath, windowsHide: true
            }).toString();
        }
        return execFileSync('git', ['commit', '--amend', '--no-edit'], {
            cwd: projectPath, windowsHide: true
        }).toString();
    },

    gitCommit: async (projectPath, message) => {
        // Use spawn to safely pass message without shell injection
        return new Promise((resolve, reject) => {
            const child = spawn('git', ['commit', '-m', message], { cwd: projectPath, windowsHide: true });
            let stdout = '', stderr = '';
            child.stdout.on('data', (d) => stdout += d);
            child.stderr.on('data', (d) => stderr += d);
            child.on('close', (code) => {
                if (code === 0) resolve(stdout);
                else reject(new Error(stderr || stdout));
            });
            child.on('error', reject);
        });
    },

    gitPull: async (projectPath, remote, branch, operationId, strategy) => {
        const args = ['pull'];
        if (strategy === 'ff-only') args.push('--ff-only');
        if (remote) args.push(remote);
        if (branch) args.push(branch);
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, { cwd: projectPath, windowsHide: true });
            if (operationId) processes.set(operationId, child);
            let stdout = '', stderr = '';
            child.stdout.on('data', (d) => stdout += d);
            child.stderr.on('data', (d) => stderr += d);
            child.on('close', (code) => {
                if (operationId) processes.delete(operationId);
                if (code === 0) resolve(stdout + stderr);
                else reject(new Error(stderr || stdout));
            });
            child.on('error', (error) => {
                if (operationId) processes.delete(operationId);
                reject(error);
            });
        });
    },

    gitPush: async (projectPath, remote, branch, force, setUpstream, operationId, forceWithLease) => {
        const args = ['push'];
        if (forceWithLease) args.push('--force-with-lease');
        else if (force) args.push('--force');
        if (setUpstream) args.push('-u');
        if (remote) args.push(remote);
        if (branch) args.push(branch);
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, { cwd: projectPath, windowsHide: true });
            if (operationId) processes.set(operationId, child);
            let stdout = '', stderr = '';
            child.stdout.on('data', (d) => stdout += d);
            child.stderr.on('data', (d) => stderr += d);
            child.on('close', (code) => {
                if (operationId) processes.delete(operationId);
                if (code === 0) resolve(stdout + stderr);
                else reject(new Error(stderr || stdout));
            });
            child.on('error', (error) => {
                if (operationId) processes.delete(operationId);
                reject(error);
            });
        });
    },

    gitFetch: async (projectPath, remote, operationId) => {
        const args = ['fetch'];
        if (remote) args.push(remote);
        else args.push('--all');
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, { cwd: projectPath, windowsHide: true });
            if (operationId) processes.set(operationId, child);
            let stdout = '', stderr = '';
            child.stdout.on('data', (d) => stdout += d);
            child.stderr.on('data', (d) => stderr += d);
            child.on('close', (code) => {
                if (operationId) processes.delete(operationId);
                if (code === 0) resolve(stdout + stderr);
                else reject(new Error(stderr || stdout));
            });
            child.on('error', (error) => {
                if (operationId) processes.delete(operationId);
                reject(error);
            });
        });
    },

    gitDiff: async (projectPath, file, staged) => {
        // For unstaged files, check if it's an untracked file
        if (file && !staged) {
            try {
                execFileSync('git', ['ls-files', '--error-unmatch', '--', file], {
                    cwd: projectPath, windowsHide: true, stdio: 'pipe'
                });
            } catch {
                // File is untracked, generate synthetic diff
                const fullPath = path.join(projectPath, file);
                try {
                    const stat = fs.statSync(fullPath);
                    // Skip files larger than 1MB to avoid memory issues
                    if (stat.size > 1 * 1024 * 1024) return '';
                    // Skip binary files by checking common extensions
                    const ext = path.extname(file).toLowerCase();
                    const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.mp3', '.mp4', '.wav', '.avi', '.mov', '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.woff', '.woff2', '.ttf', '.eot'];
                    if (binaryExts.includes(ext)) return '';
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const lines = content.split(/\r?\n/);
                    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
                    const total = lines.length;
                    let result = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${total} @@\n`;
                    for (let i = 0; i < total; i++) {
                        result += '+' + lines[i] + '\n';
                    }
                    return result;
                } catch {
                    return '';
                }
            }
        }
        const args = ['diff'];
        if (staged) args.push('--cached');
        if (file) { args.push('--'); args.push(file); }
        try {
            return execFileSync('git', args, {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            return e.stdout ? e.stdout.toString() : '';
        }
    },

    gitDiffForAi: async (projectPath) => {
        try {
            const stagedFilesOutput = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
            const stagedFiles = stagedFilesOutput.split('\0').filter(Boolean);
            if (stagedFiles.length === 0) {
                return '';
            }

            return execFileSync('git', ['diff', '--cached', '--'].concat(stagedFiles), {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            return e.stdout ? e.stdout.toString() : '';
        }
    },

    gitDiffCommit: async (projectPath, hash) => {
        try {
            return execFileSync('git', ['show', '--format=', '--patch', hash], {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            return e.stdout ? e.stdout.toString() : '';
        }
    },

    gitDiscard: async (projectPath, files) => {
        return execFileSync('git', ['restore', '--'].concat(files), { cwd: projectPath, windowsHide: true }).toString();
    },

    gitDiscardUntracked: async (projectPath, files) => {
        return execFileSync('git', ['clean', '-f', '--'].concat(files), { cwd: projectPath, windowsHide: true }).toString();
    },

    gitCurrentBranch: async (projectPath) => {
        return execSync('git branch --show-current', { cwd: projectPath, windowsHide: true }).toString().trim();
    },

    gitListBranches: async (projectPath) => {
        const runGit = (args) => execFileSync('git', args, { cwd: projectPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }).toString().trim();
        const runGitSafe = (args) => { try { return runGit(args); } catch { return ''; } };

        const current = runGitSafe(['branch', '--show-current']);
        const branches = [];

        // Local branches
        const localOutput = runGitSafe(['branch', '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)']);
        for (const line of localOutput.split('\n')) {
            if (!line.trim()) continue;
            const parts = line.split('\t');
            const name = parts[0] || '';
            const upstream = parts[1] || null;
            const track = parts[2] || '';

            let ahead = 0, behind = 0;
            if (track) {
                const inner = track.replace(/^\[/, '').replace(/\]$/, '');
                for (const part of inner.split(',')) {
                    const p = part.trim();
                    if (p.startsWith('ahead ')) ahead = parseInt(p.substring(6)) || 0;
                    else if (p.startsWith('behind ')) behind = parseInt(p.substring(7)) || 0;
                }
            }

            branches.push({
                name,
                is_remote: false,
                is_current: name === current,
                upstream: upstream || null,
                ahead,
                behind,
            });
        }

        // Remote branches
        const remoteOutput = runGitSafe(['branch', '-r', '--format=%(refname:short)']);
        for (const line of remoteOutput.split('\n')) {
            const name = line.trim();
            if (!name || name.includes('HEAD')) continue;
            branches.push({ name, is_remote: true, is_current: false, upstream: null, ahead: 0, behind: 0 });
        }

        return branches;
    },

    gitSwitchBranch: async (projectPath, branch) => {
        if (branch.includes('/')) {
            const parts = branch.split('/');
            const localName = parts.slice(1).join('/');
            try {
                return execFileSync('git', ['switch', localName], { cwd: projectPath, windowsHide: true }).toString();
            } catch {
                return execFileSync('git', ['switch', '-c', localName, '--track', branch], { cwd: projectPath, windowsHide: true }).toString();
            }
        }
        return execFileSync('git', ['switch', branch], { cwd: projectPath, windowsHide: true }).toString();
    },

    gitCreateAndSwitchBranch: async (projectPath, name, startPoint) => {
        const args = ['switch', '-c', name];
        if (startPoint) args.push(startPoint);
        return execFileSync('git', args, { cwd: projectPath, windowsHide: true }).toString();
    },

    gitDeleteBranch: async (projectPath, name, force) => {
        const flag = force ? '-D' : '-d';
        return execFileSync('git', ['branch', flag, name], { cwd: projectPath, windowsHide: true }).toString();
    },

    gitRenameBranch: async (projectPath, oldName, newName) => {
        return execFileSync('git', ['branch', '-m', oldName, newName], { cwd: projectPath, windowsHide: true }).toString();
    },

    gitHistory: async (projectPath, maxCount) => {
        const count = maxCount || 100;
        let output;
        try {
            output = execFileSync('git', [
                '--no-pager',
                'log', `--max-count=${count}`,
                '--all',
                '--graph',
                '--format=%x1f%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%aI%x1f%s%x1f%P%x1f%D'
            ], {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            output = e.stdout ? e.stdout.toString() : '';
        }

        const commits = [];
        for (const line of output.split('\n')) {
            const idx = line.indexOf('\x1f');
            if (idx < 0) continue;

            const graphPrefix = line.slice(0, idx);
            const parts = line.slice(idx + 1).split('\x1f');
            if (parts.length < 9) continue;

            commits.push({
                hash: parts[0],
                short_hash: parts[1],
                author: parts[2],
                email: parts[3],
                committer: parts[4],
                date: parts[5],
                message: parts[6],
                parents: parts[7] ? parts[7].split(' ') : [],
                refs: (parts[8] && parts[8].trim()) ? parts[8].split(', ').map(s => s.trim()) : [],
                graph_prefix: graphPrefix || undefined,
            });
        }

        return commits;
    },

    gitOwnCommits: async (projectPath, since, until) => {
        function readGitConfig(key) {
            try {
                const localValue = execFileSync('git', ['config', '--get', key], {
                    cwd: projectPath, windowsHide: true
                }).toString().trim();
                if (localValue) return localValue;
            } catch (_) {}

            try {
                const globalValue = execFileSync('git', ['config', '--global', '--get', key], {
                    windowsHide: true
                }).toString().trim();
                if (globalValue) return globalValue;
            } catch (_) {}

            return undefined;
        }

        const identity = {
            name: readGitConfig('user.name'),
            email: readGitConfig('user.email'),
        };
        if (!identity.name && !identity.email) {
            throw new Error('No Git author identity configured.');
        }

        let output;
        try {
            output = execFileSync('git', [
                '--no-pager',
                'log',
                '--all',
                '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s'
            ], {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            output = e.stdout ? e.stdout.toString() : '';
        }

        const commits = [];
        for (const line of output.split('\n')) {
            const parts = line.split('\x1f');
            if (parts.length < 6) continue;

            const author = parts[2];
            const email = parts[3];
            const date = parts[4];
            if (date < since || date >= until) continue;
            const matched = identity.email
                ? email.toLowerCase() === identity.email.toLowerCase()
                : author === identity.name;
            if (!matched) continue;

            commits.push({
                hash: parts[0],
                shortHash: parts[1],
                author,
                email,
                date,
                message: parts[5],
            });
        }

        commits.sort((a, b) => a.date.localeCompare(b.date));
        return { identity, commits };
    },

    gitCommitDetail: async (projectPath, hash) => {
        let output;
        try {
            output = execFileSync('git', [
                'show',
                '-s',
                '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%aI%x1f%P%x1f%D%x1e%B',
                hash
            ], {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            output = e.stdout ? e.stdout.toString() : '';
        }

        const separatorIndex = output.indexOf('\x1e');
        if (separatorIndex < 0) {
            throw new Error('Failed to parse commit detail');
        }

        const meta = output.slice(0, separatorIndex).trimEnd();
        const message = output.slice(separatorIndex + 1).replace(/\n+$/, '');
        const parts = meta.split('\x1f');
        if (parts.length < 8) {
            throw new Error('Failed to parse commit detail metadata');
        }

        return {
            hash: parts[0],
            short_hash: parts[1],
            author: parts[2],
            email: parts[3],
            committer: parts[4],
            date: parts[5],
            message,
            parents: parts[6] ? parts[6].split(' ') : [],
            refs: (parts[7] && parts[7].trim()) ? parts[7].split(', ').map(s => s.trim()) : [],
        };
    },

    gitCommitFiles: async (projectPath, hash) => {
        let output;
        try {
            output = execFileSync('git', ['show', '--name-status', '--format=', hash], {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            output = e.stdout ? e.stdout.toString() : '';
        }

        const files = [];
        for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split('\t');
            if (parts.length < 2) continue;

            const statusRaw = parts[0];
            const statusChar = statusRaw[0];

            if (statusChar === 'R' || statusChar === 'C') {
                if (parts.length >= 3) {
                    files.push({ path: parts[2], status: statusChar, old_path: parts[1] });
                }
            } else {
                files.push({ path: parts[1], status: statusChar, old_path: null });
            }
        }

        return files;
    },

    gitDiffCommitFile: async (projectPath, hash, file) => {
        try {
            return execFileSync('git', ['show', '--format=', '--patch', hash, '--', file], {
                cwd: projectPath, windowsHide: true, maxBuffer: 10 * 1024 * 1024
            }).toString();
        } catch (e) {
            return e.stdout ? e.stdout.toString() : '';
        }
    },

    gitRevertHunk: async (projectPath, patch, staged) => {
        const args = ['apply', '-R', '--whitespace=nowarn'];
        if (staged) args.push('--cached');
        return execFileSync('git', args, {
            cwd: projectPath,
            windowsHide: true,
            input: patch,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).toString();
    },

    gitAddIgnorePattern: async (projectPath, files, kind, local) => {
        const root = gitRepoRoot(projectPath);
        const patterns = files.map((file) => buildGitIgnorePattern(root, file, kind));
        return appendGitIgnorePatterns(gitIgnoreTarget(projectPath, root, Boolean(local)), patterns);
    },

    gitStopTracking: async (projectPath, files, kind, local) => {
        const root = gitRepoRoot(projectPath);
        const normalized = files.map(normalizeRepoRelativePath);
        for (const file of normalized) {
            execFileSync('git', ['ls-files', '--error-unmatch', '--', file], {
                cwd: projectPath, windowsHide: true, stdio: 'pipe',
            });
        }
        const patterns = normalized.map((file) => buildGitIgnorePattern(root, file, kind));
        const ignoreFile = gitIgnoreTarget(projectPath, root, Boolean(local));
        execFileSync('git', ['rm', '--cached', '--dry-run', '--'].concat(normalized), {
            cwd: projectPath, windowsHide: true, stdio: 'pipe',
        });
        const added = appendGitIgnorePatterns(ignoreFile, patterns);
        try {
            return execFileSync('git', ['rm', '--cached', '--'].concat(normalized), {
                cwd: projectPath, windowsHide: true,
            }).toString();
        } catch (error) {
            const message = error.stderr ? error.stderr.toString() : error.message;
            if (added.length) throw new Error(`Ignore rule was written, but stopping tracking failed: ${message}`);
            throw error;
        }
    },

    gitApplyHunk: async (projectPath, patch, mode) => {
        if (Buffer.byteLength(String(patch), 'utf8') > GIT_IMAGE_TOTAL_MAX_SIZE
            || !String(patch).includes('diff --git')
            || !String(patch).split(/\r?\n/).some((line) => line.startsWith('index '))
            || !String(patch).includes('@@')
            || !String(patch).includes('--- ')
            || !String(patch).includes('+++ ')) {
            throw new Error('Patch does not contain a safe file diff header');
        }
        const args = ['apply', '--whitespace=nowarn'];
        if (mode === 'stage') args.push('--cached');
        else if (mode === 'unstage') args.push('--cached', '--reverse');
        else if (mode === 'discard') args.push('--reverse');
        else throw new Error(`Unsupported hunk mode: ${mode}`);
        args.push('-');
        return execFileSync('git', args, {
            cwd: projectPath, windowsHide: true, input: patch,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).toString();
    },

    gitGetImageDiff: async (projectPath, file, staged, commit, oldPath) => {
        const relative = normalizeRepoRelativePath(file);
        const root = gitRepoRoot(projectPath);
        const sources = gitDiffSources(projectPath, relative, Boolean(staged), commit, oldPath);
        const readSide = (side) => {
            if (!side) return null;
            const size = readGitBlobSize(projectPath, side);
            if (size === null) return null;
            if (size > GIT_IMAGE_SIDE_MAX_SIZE) throw new Error('too_large: image side exceeds 10 MB');
            const bytes = readGitBlob(projectPath, side);
            if (!bytes) return null;
            if (bytes.length > GIT_IMAGE_SIDE_MAX_SIZE) throw new Error('too_large: image side exceeds 10 MB');
            const mime = gitImageMime(side.path);
            if (!mime) throw new Error(`Unsupported image format: ${side.path}`);
            return { mime, base64: bytes.toString('base64'), size: bytes.length };
        };
        const before = readSide(sources.before);
        const after = readSide(sources.after);
        if ((before?.size || 0) + (after?.size || 0) > GIT_IMAGE_TOTAL_MAX_SIZE) {
            throw new Error('too_large: image payload exceeds 20 MB');
        }
        void root;
        return { kind: 'image', before, after };
    },

    gitGetBinaryDiffMeta: async (projectPath, file, staged, commit, oldPath) => {
        const sources = gitDiffSources(projectPath, file, Boolean(staged), commit, oldPath);
        const beforeSize = readGitBlobSize(projectPath, sources.before);
        const afterSize = readGitBlobSize(projectPath, sources.after);
        return {
            kind: 'binary',
            beforeSize,
            afterSize,
            beforeExists: beforeSize !== null,
            afterExists: afterSize !== null,
        };
    },

    gitFileHistory: async (projectPath, file, maxCount) => {
        const relative = normalizeRepoRelativePath(file);
        const count = Math.max(1, Number(maxCount) || 100);
        let output = '';
        try {
            output = execFileSync('git', [
                'log', '--follow', `--max-count=${count}`,
                '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%aI%x1f%s%x1f%P%x1f%D',
                '--', relative,
            ], { cwd: projectPath, windowsHide: true }).toString();
        } catch (error) {
            output = error.stdout ? error.stdout.toString() : '';
        }
        return output.split('\n').filter(Boolean).map((line) => {
            const parts = line.split('\x1f');
            return {
                hash: parts[0] || '', short_hash: parts[1] || '', author: parts[2] || '',
                email: parts[3] || '', committer: parts[4] || '', date: parts[5] || '',
                message: parts[6] || '', parents: parts[7] ? parts[7].split(' ') : [],
                refs: parts[8] ? parts[8].split(', ').map((s) => s.trim()).filter(Boolean) : [],
            };
        });
    },

    gitMerge: async (projectPath, branch) => {
        return execFileSync('git', ['merge', branch], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitMergeContinue: async (projectPath) => {
        return execFileSync('git', ['merge', '--continue'], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitMergeAbort: async (projectPath) => {
        return execFileSync('git', ['merge', '--abort'], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitRebase: async (projectPath, branch) => {
        return execFileSync('git', ['rebase', branch], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitReset: async (projectPath, mode, target) => {
        const modeFlag = mode === 'soft' ? '--soft' : mode === 'hard' ? '--hard' : '--mixed';
        const rev = target || 'HEAD~1';
        return execFileSync('git', ['reset', modeFlag, rev], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitCherryPick: async (projectPath, hash) => {
        return execFileSync('git', ['cherry-pick', hash], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitRevertCommit: async (projectPath, hash) => {
        return execFileSync('git', ['revert', '--no-edit', hash], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitStashList: async (projectPath) => {
        let output = '';
        try {
            output = execFileSync('git', ['stash', 'list', '--format=%gd%n%gs%n%aI%n---END---'], {
                cwd: projectPath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
            }).toString();
        } catch (_) {
            return [];
        }
        const entries = [];
        let lines = [];
        for (const line of output.split('\n')) {
            if (line === '---END---') {
                if (lines.length >= 3) {
                    const indexStr = lines[0].replace(/^stash@\{/, '').replace(/\}$/, '');
                    entries.push({
                        index: parseInt(indexStr, 10) || 0,
                        message: lines[1],
                        date: lines[2],
                    });
                }
                lines = [];
            } else if (line.length) {
                lines.push(line);
            }
        }
        return entries;
    },
    gitStashSave: async (projectPath, message) => {
        const args = ['stash', 'push'];
        if (message) { args.push('-m', message); }
        return execFileSync('git', args, { cwd: projectPath, windowsHide: true }).toString();
    },
    gitStashPop: async (projectPath, index) => {
        const idx = `stash@{${index == null ? 0 : index}}`;
        return execFileSync('git', ['stash', 'pop', idx], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitStashApply: async (projectPath, index) => {
        const idx = `stash@{${index == null ? 0 : index}}`;
        return execFileSync('git', ['stash', 'apply', idx], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitStashDrop: async (projectPath, index) => {
        const idx = `stash@{${index}}`;
        return execFileSync('git', ['stash', 'drop', idx], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitTags: async (projectPath) => {
        let output = '';
        try {
            output = execFileSync('git', ['tag', '-l', '--format=%(refname:short)\t%(objectname:short)'], {
                cwd: projectPath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
            }).toString();
        } catch (_) {
            return [];
        }
        return output.split('\n').filter(Boolean).map((line) => {
            const parts = line.split('\t');
            return { name: parts[0] || '', hash: parts[1] || '' };
        });
    },
    gitCreateTag: async (projectPath, name, message, target) => {
        const args = ['tag'];
        if (message && String(message).trim()) {
            args.push('-a', name, '-m', String(message).trim());
        } else {
            args.push(name);
        }
        if (target) args.push(target);
        return execFileSync('git', args, { cwd: projectPath, windowsHide: true }).toString();
    },
    gitDeleteTag: async (projectPath, name) => {
        return execFileSync('git', ['tag', '-d', name], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitRemoteList: async (projectPath) => {
        let output = '';
        try {
            output = execFileSync('git', ['remote', '-v'], {
                cwd: projectPath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
            }).toString();
        } catch (_) {
            return [];
        }
        const remotes = [];
        for (const line of output.split('\n')) {
            const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
            if (m) remotes.push({ name: m[1], url: m[2], remote_type: m[3] });
        }
        return remotes;
    },
    gitRemoteAdd: async (projectPath, name, url) => {
        return execFileSync('git', ['remote', 'add', name, url], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitRemoteSetUrl: async (projectPath, name, url) => {
        return execFileSync('git', ['remote', 'set-url', name, url], { cwd: projectPath, windowsHide: true }).toString();
    },
    gitRemoteRemove: async (projectPath, name) => {
        return execFileSync('git', ['remote', 'remove', name], { cwd: projectPath, windowsHide: true }).toString();
    },

    //************* 包管理器解析 *************
    resolvePackageManager: async (nodePath, defaultNodePath, packageManager, source) => {
        const pm = packageManager || '';
        if (!pm) return { available: true, commandPath: null, reason: null };

        const checkPath = source === 'default' ? defaultNodePath : nodePath;

        if (!checkPath) {
            return {
                available: false,
                commandPath: null,
                reason: source === 'default' ? 'default_node_unavailable' : 'project_node_unavailable',
            };
        }

        // 解析 node 目录
        let nodeDir = checkPath;
        try {
            if (fs.existsSync(checkPath) && fs.statSync(checkPath).isFile()) {
                nodeDir = path.dirname(checkPath);
            }
        } catch (_) {}

        // 在 nodeDir 中查找包管理器
        const isWin = process.platform === 'win32';
        try {
            const entries = fs.readdirSync(nodeDir);

            if (isWin) {
                // 检查 {pm}.cmd 或 {pm}.exe
                if (entries.includes(`${pm}.cmd`)) {
                    return { available: true, commandPath: `"${path.join(nodeDir, `${pm}.cmd`)}"`, reason: null };
                }
                if (entries.includes(`${pm}.exe`)) {
                    return { available: true, commandPath: `"${path.join(nodeDir, `${pm}.exe`)}"`, reason: null };
                }
                // npm 特殊：node_modules/npm/bin/npm-cli.js
                if (pm === 'npm') {
                    const cliPath = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
                    if (fs.existsSync(cliPath)) {
                        return { available: true, commandPath: cliPath, reason: null };
                    }
                }
            } else {
                // Unix: 检查 pm 可执行文件
                if (entries.includes(pm)) {
                    return { available: true, commandPath: `"${path.join(nodeDir, pm)}"`, reason: null };
                }
                // npm 特殊路径检查
                if (pm === 'npm') {
                    const cliBin = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
                    if (fs.existsSync(cliBin)) {
                        return { available: true, commandPath: cliBin, reason: null };
                    }
                    // nvm 安装格式: lib/node_modules/npm/bin/npm-cli.js
                    const parentDir = path.dirname(nodeDir);
                    const cliLib = path.join(parentDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
                    if (fs.existsSync(cliLib)) {
                        return { available: true, commandPath: cliLib, reason: null };
                    }
                }
            }
        } catch (_) {}

        return {
            available: false,
            commandPath: null,
            reason: source === 'default' ? 'pm_not_installed_in_default_node' : 'pm_not_installed_in_project_node',
        };
    },

    //************* 带 commandPath 的 runProjectCommand *************
    runProjectCommandWithCommandPath: async (commandKey, sessionId, projectPath, script, packageManager, nodePath, commandPath, pmNodePath) => {
        if (processes.has(commandKey)) throw new Error('Already running');

        // Setup logging (与 runProjectCommand 相同)
        let logFilePath = null;
        let logStream = null;
        const MAX_LOG_LINES = 500;
        const logBuffer = [];
        let linesSinceRewrite = 0;

        function appendLog(text) {
            if (!text) return;
            logBuffer.push(text);
            if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
            if (logStream) {
                logStream.write(text);
                linesSinceRewrite++;
                if (linesSinceRewrite >= MAX_LOG_LINES) rewriteLogFile();
            }
        }

        function rewriteLogFile() {
            if (!logFilePath) return;
            try {
                if (logStream) logStream.end();
                fs.writeFileSync(logFilePath, logBuffer.join(''), 'utf-8');
                logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
                linesSinceRewrite = 0;
            } catch (e) {
                console.error('[Runner] Failed to rewrite log file:', e);
            }
        }

        try {
            const userData = platform.getPath('userData');
            const baseLogDir = path.join(userData, 'logs');
            let projectName = path.basename(projectPath);
            try {
                const pkgPath = path.join(projectPath, 'package.json');
                if (fs.existsSync(pkgPath)) {
                    const content = fs.readFileSync(pkgPath, 'utf-8');
                    const pkg = JSON.parse(content);
                    if (pkg.name) projectName = pkg.name;
                }
            } catch (e) {}

            const safeProjectName = projectName.replace(/[<>:"/\\|?*]/g, '_');
            const projectLogDir = path.join(baseLogDir, safeProjectName);
            if (!fs.existsSync(projectLogDir)) fs.mkdirSync(projectLogDir, { recursive: true });

            const safeScript = script.replace(/[<>:"/\\|?*]/g, '_');
            logFilePath = path.join(projectLogDir, `${safeScript}.log`);
            logStream = fs.createWriteStream(logFilePath, { flags: 'w' });
        } catch (e) {
            console.error('[Runner] Failed to setup log file:', e);
        }

        // 环境准备：项目 Node 优先
        const env = { ...process.env };
        let nodeDir = '';

        if (nodePath && nodePath !== 'System Default') {
            try {
                let checkPath = nodePath;
                if (fs.existsSync(checkPath)) {
                    const stat = fs.statSync(checkPath);
                    if (stat.isFile()) nodeDir = path.dirname(checkPath);
                    else nodeDir = checkPath;
                } else {
                    nodeDir = nodePath;
                }

                if (nodeDir) {
                    const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
                    const separator = process.platform === 'win32' ? ';' : ':';
                    env[pathKey] = `${nodeDir}${separator}${env[pathKey] || ''}`;

                    // 如果 PM 来自不同 Node 目录（source='default'），也将其加入 PATH
                    if (pmNodePath && pmNodePath !== nodeDir) {
                        env[pathKey] = `${nodeDir}${separator}${pmNodePath}${separator}${process.env[pathKey] || ''}`;
                    }
                }
            } catch (e) {
                console.error('[Runner] Error resolving node path:', e);
            }
        }

        // 使用 commandPath 作为 PM 命令；npm-cli.js 需要用项目 Node 执行
        const resolvedCommandPath = commandPath && packageManager === 'npm' && commandPath.endsWith('npm-cli.js')
            ? `"${path.join(nodeDir || '', process.platform === 'win32' ? 'node.exe' : 'node')}" "${commandPath}"`
            : commandPath;
        const pm = resolvedCommandPath || packageManager || 'npm';
        let spawnCmd = pm;

        if (nodeDir && process.platform === 'win32' && !commandPath) {
            // 仅当没有 commandPath 时才进行自动查找
            const nodeExe = path.join(nodeDir, 'node.exe');
            const npmCliJs = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
            const pmCmd = path.join(nodeDir, `${pm}.cmd`);

            if (fs.existsSync(npmCliJs)) {
                spawnCmd = `"${nodeExe}" "${npmCliJs}"`;
            } else if (fs.existsSync(pmCmd)) {
                spawnCmd = `"${pmCmd}"`;
            }
        }

        const cmdStr = `${spawnCmd} run ${script}`;
        try {
            emitProcessOutput(commandKey, sessionId, 'stdout', `Executing: ${cmdStr}`, false, null);
            appendLog(`Executing: ${cmdStr}\n`);
            appendLog(`Node Path used: ${nodeDir || 'System Default'}\n`);
            if (commandPath) appendLog(`PM Command Path: ${commandPath}\n`);

            const child = spawn(spawnCmd, ['run', script], {
                cwd: projectPath,
                shell: true,
                env: env,
                detached: process.platform !== 'win32',
                windowsHide: process.platform === 'win32',
            });

            spawnParentDeathWatch(child);
            const startedAt = Date.now();
            const runState = { child, sessionId, startedAt, stopRequested: false };
            processes.set(commandKey, child);
            runnerProcessStates.set(commandKey, runState);
            attachProcessIo(commandKey, sessionId, child, (text) => appendLog(typeof text === 'string' && text.endsWith('\n') ? text : `${text}\n`));

            let finished = false;
            let waitError = null;
            const finishRun = (exitCode, errorMessage = null) => {
                if (finished) return;
                finished = true;
                const currentState = runnerProcessStates.get(commandKey);
                const stopped = currentState?.sessionId === sessionId && currentState.stopRequested === true;
                runnerProcessStates.delete(commandKey);
                processes.delete(commandKey);
                rewriteLogFile();
                if (logStream) logStream.end();
                if (exitCallback) {
                    exitCallback({
                        id: commandKey,
                        commandKey,
                        sessionId,
                        exitCode: typeof exitCode === 'number' ? exitCode : null,
                        stopped,
                        durationMs: Math.max(0, Date.now() - startedAt),
                        ...(errorMessage ? { waitError: errorMessage } : {}),
                    });
                }
            };

            child.on('close', (code) => finishRun(code, waitError));
            child.on('error', (err) => {
                console.error('[Runner] Spawn error:', err);
                const errMsg = `Error spawning process: ${err.message}`;
                emitProcessOutput(commandKey, sessionId, 'stderr', errMsg, false, null);
                appendLog(`${errMsg}\n`);
                waitError = err.message;
            });
        } catch (e) {
            if (logStream) logStream.end();
            throw e;
        }
    },

    //************* 安装包管理器 *************
    installPm: async (nodePath, pmName) => {
        let nodeDir = nodePath;
        try {
            if (fs.existsSync(nodePath) && fs.statSync(nodePath).isFile()) {
                nodeDir = path.dirname(nodePath);
            }
        } catch (_) {}

        const isWin = process.platform === 'win32';
        let cmdName, cmdArgs;

        if (isWin) {
            const nodeExe = path.join(nodeDir, 'node.exe');
            const npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
            if (fs.existsSync(nodeExe) && fs.existsSync(npmCli)) {
                cmdName = nodeExe;
                cmdArgs = [npmCli, 'install', '-g', pmName];
            } else {
                cmdName = 'npm';
                cmdArgs = ['install', '-g', pmName];
            }
        } else {
            const nodeBin = path.join(nodeDir, 'node');
            const npmCli = path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
            if (fs.existsSync(nodeBin) && fs.existsSync(npmCli)) {
                cmdName = nodeBin;
                cmdArgs = [npmCli, 'install', '-g', pmName];
            } else {
                cmdName = 'npm';
                cmdArgs = ['install', '-g', pmName];
            }
        }

        return new Promise((resolve, reject) => {
            const child = spawn(cmdName, cmdArgs, {
                cwd: nodeDir,
                shell: true,
                env: { ...process.env },
            });
            let stderr = '';
            let stdout = '';
            child.stdout.on('data', d => { stdout += d.toString(); });
            child.stderr.on('data', d => { stderr += d.toString(); });
            child.on('exit', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`${stderr}\n${stdout}`));
            });
            child.on('error', reject);
        });
    },

};

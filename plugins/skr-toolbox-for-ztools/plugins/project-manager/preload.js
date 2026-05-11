const fs = require('fs');
const path = require('path');
const { spawn, exec, execFile, execSync, execFileSync } = require('child_process');
const { TextDecoder } = require('util');

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

const processes = new Map();
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

function findPmFromNvm(nodeExe, packageManager) {
    // Search NVM directories for npm-cli.js or {pm}.cmd when the version dir lacks npm
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) {
        const cli = path.join(nvmSymlink, 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (fs.existsSync(cli)) return `"${nodeExe}" "${cli}"`;
        const cmd = path.join(nvmSymlink, `${packageManager}.cmd`);
        if (fs.existsSync(cmd)) return `"${cmd}"`;
    }
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
        try {
            for (const entry of fs.readdirSync(nvmHome)) {
                const dir = path.join(nvmHome, entry);
                if (!fs.statSync(dir).isDirectory()) continue;
                const cli = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
                if (fs.existsSync(cli)) return `"${nodeExe}" "${cli}"`;
                const cmd = path.join(dir, `${packageManager}.cmd`);
                if (fs.existsSync(cmd)) return `"${cmd}"`;
            }
        } catch (_) {}
    }
    return null;
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

function getTerminalSpawnOptions(nodePath) {
    const nodeDir = resolveTerminalNodeDir(nodePath);
    if (!nodeDir) {
        return { detached: true, stdio: 'ignore' };
    }

    return {
        detached: true,
        stdio: 'ignore',
        env: {
            ...process.env,
            PATH: `${nodeDir}${path.delimiter}${process.env.PATH || ''}`,
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

// Cleanup on exit
platform.onPluginOut(() => {
    cleanupAllProcesses();
});

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

window.services = {
    getNvmList: async () => {
        // Windows
        if (process.platform === 'win32') {
            const nvmHome = process.env.NVM_HOME;
            if (!nvmHome) return [];
            
            try {
                const dirs = fs.readdirSync(nvmHome);
                const versions = [];
                
                for (const dir of dirs) {
                    if (dir.startsWith('v')) {
                        versions.push({
                            version: dir,
                            path: path.join(nvmHome, dir),
                            source: 'nvm'
                        });
                    }
                }
                return versions;
            } catch (e) {
                console.error(e);
                return [];
            }
        } 
        // macOS / Linux
        else {
            const home = process.env.HOME;
            const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
            const versionsDir = path.join(nvmDir, 'versions', 'node');
            
            if (!fs.existsSync(versionsDir)) return [];
            
            try {
                const dirs = fs.readdirSync(versionsDir);
                const versions = [];
                
                for (const dir of dirs) {
                    if (dir.startsWith('v')) {
                        versions.push({
                            version: dir,
                            path: path.join(versionsDir, dir),
                            source: 'nvm'
                        });
                    }
                }
                return versions;
            } catch (e) {
                console.error(e);
                return [];
            }
        }
    },

    getSystemNodePath: async () => {
        try {
            return await runCmd('node -e "console.log(process.execPath)"');
        } catch (e) {
            return null;
        }
    },
    
    getNodeVersion: async (nodePath) => {
        return new Promise(resolve => {
            const cb = (err, stdout) => {
                if (err) return resolve('');
                resolve(stdout.trim());
            };
            if (nodePath) {
                execFile(nodePath, ['-v'], cb);
            } else {
                exec('node -v', cb);
            }
        });
    },

    installNode: async (version) => {
        return new Promise((resolve, reject) => {
            if (!isValidVersion(version)) {
                return reject(new Error('Invalid version string.'));
            }
            if (process.platform === 'win32') {
                // Use PowerShell to start a new elevated window that runs nvm install
                // /c executes and terminates, but we add pause so user can see the result
                // Start-Process -Wait ensures we wait for that window to close
                const psCommand = `Start-Process cmd -ArgumentList '/c nvm install ${version} & pause' -Verb RunAs -Wait`;
                exec(`powershell -Command "${psCommand}"`, (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    
                    // Best-effort verify installation for numeric versions only.
                    // For aliases (e.g. lts), nvm may install a resolved semver folder.
                    const nvmHome = process.env.NVM_HOME;
                    const normalizedVersion = String(version || '').trim().replace(/^v/i, '');
                    const isNumericVersion = /^\d+(\.\d+){0,2}$/.test(normalizedVersion);
                    if (nvmHome && isNumericVersion) {
                        try {
                            const dirs = fs.readdirSync(nvmHome);
                            const installed = dirs.some((dir) => {
                                if (!dir.startsWith('v')) return false;
                                const normalizedDir = dir.replace(/^v/i, '');
                                return (
                                    normalizedDir === normalizedVersion ||
                                    normalizedDir.startsWith(`${normalizedVersion}.`)
                                );
                            });

                            if (installed) {
                                resolve("Success");
                                return;
                            }
                        } catch (e) {
                            // Ignore verification errors and trust command result.
                        }
                    }

                    resolve("Success");
                });
            } else if (process.platform === 'darwin') {
                // macOS: Use AppleScript to open Terminal
                const script = `source ~/.nvm/nvm.sh && nvm install ${version}`;
                const appleScript = `tell application "Terminal" to do script "${script}"`;
                exec(`osascript -e '${appleScript}'`, (error) => {
                    if (error) reject(error);
                    else resolve("Started in Terminal");
                });
            } else {
                // Linux: Try common terminal emulators or fallback to background
                const script = `source ~/.nvm/nvm.sh && nvm install ${version} && read -p "Press enter to close"`;
                const terminals = [
                    { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', script] },
                    { cmd: 'x-terminal-emulator', args: ['-e', `bash -c "${script}"`] },
                    { cmd: 'konsole', args: ['-e', 'bash', '-c', script] },
                    { cmd: 'xfce4-terminal', args: ['-e', `bash -c "${script}"`] },
                    { cmd: 'xterm', args: ['-e', `bash -c "${script}"`] }
                ];

                let started = false;
                for (const t of terminals) {
                    try {
                        spawn(t.cmd, t.args, { detached: true, stdio: 'ignore' });
                        started = true;
                        break;
                    } catch (e) {}
                }

                if (started) {
                    resolve("Started in Terminal");
                } else {
                    // Fallback: run in background and capture output
                    exec(`bash -c "source ~/.nvm/nvm.sh && nvm install ${version}"`, (error, stdout, stderr) => {
                         if (error) reject(new Error(stderr || error.message));
                         else resolve("Success");
                    });
                }
            }
        });
    },
    
    uninstallNode: async (version) => {
        return new Promise((resolve, reject) => {
            if (!isValidVersion(version)) {
                return reject(new Error('Invalid version string.'));
            }
            if (process.platform === 'win32') {
                const psCommand = `Start-Process cmd -ArgumentList '/c nvm uninstall ${version} & pause' -Verb RunAs -Wait`;
                exec(`powershell -Command "${psCommand}"`, (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    
                    // Verify uninstallation
                    const nvmHome = process.env.NVM_HOME;
                    if (nvmHome) {
                        const versionPath = path.join(nvmHome, version);
                        if (!fs.existsSync(versionPath)) {
                            resolve("Success");
                        } else {
                            reject(new Error("Uninstallation failed or cancelled"));
                        }
                    } else {
                        resolve("Done");
                    }
                });
            } else if (process.platform === 'darwin') {
                const script = `source ~/.nvm/nvm.sh && nvm uninstall ${version}`;
                const appleScript = `tell application "Terminal" to do script "${script}"`;
                exec(`osascript -e '${appleScript}'`, (error) => {
                    if (error) reject(error);
                    else resolve("Started in Terminal");
                });
            } else {
                // Linux
                 exec(`bash -c "source ~/.nvm/nvm.sh && nvm uninstall ${version}"`, (error, stdout, stderr) => {
                     if (error) reject(new Error(stderr || error.message));
                     else resolve("Success");
                 });
            }
        });
    },
    
    useNode: async (version) => {
        return new Promise((resolve, reject) => {
            if (!isValidVersion(version)) {
                return reject(new Error('Invalid version string.'));
            }
            if (process.platform === 'win32') {
                const psCommand = `Start-Process cmd -ArgumentList '/c nvm use ${version} & pause' -Verb RunAs -Wait`;
                exec(`powershell -Command "${psCommand}"`, (error) => {
                    if (error) reject(error);
                    else resolve("Done");
                });
            } else if (process.platform === 'darwin') {
                 const script = `source ~/.nvm/nvm.sh && nvm use ${version}`;
                 const appleScript = `tell application "Terminal" to do script "${script}"`;
                 exec(`osascript -e '${appleScript}'`, (error) => {
                     if (error) reject(error);
                     else resolve("Done");
                 });
            } else {
                 // Linux: nvm use affects current shell only, usually useless for future commands
                 // But we can run it to set default if alias default is used
                 exec(`bash -c "source ~/.nvm/nvm.sh && nvm alias default ${version}"`, (error) => {
                     if (error) reject(error);
                     else resolve("Done (Set as default)");
                 });
            }
        });
    },

    scanProject: async (projectPath) => {
        try {
            const pkgPath = path.join(projectPath, 'package.json');
            const dirName = path.basename(projectPath);

            if (!fs.existsSync(pkgPath)) {
                // Non-Node project
                return {
                    name: dirName,
                    scripts: [],
                    path: projectPath,
                    packageManager: undefined,
                    nvmVersion: undefined,
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
            const nvmrcPath = path.join(projectPath, '.nvmrc');
            if (fs.existsSync(nvmrcPath)) {
                const rawNvmVersion = fs.readFileSync(nvmrcPath, 'utf-8').trim();
                if (rawNvmVersion) {
                    nvmVersion = rawNvmVersion;
                }
            }
            
            return {
                name: pkg.name || dirName,
                scripts: Object.keys(pkg.scripts || {}),
                path: projectPath,
                packageManager,
                nvmVersion,
                projectType: 'node'
            };
        } catch (e) {
            throw e;
        }
    },

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

    runProjectCommand: async (id, projectPath, script, packageManager, nodePath) => {
        if (processes.has(id)) throw new Error('Already running');

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
            } else {
                // Fallback: search NVM directories for npm
                const found = findPmFromNvm(nodeExe, pm);
                if (found) {
                    spawnCmd = found;
                }
            }
        }

        const cmdStr = `${spawnCmd} run ${script}`;

        try {
            console.log('[Runner] Executing:', cmdStr);
            console.log('[Runner] Node Dir:', nodeDir);
            console.log('[Runner] Package Manager:', pm);

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
            
            processes.set(id, child);
            
            child.stdout.on('data', (data) => {
                const str = data.toString();
                if (outputCallback) outputCallback({ id, data: str });
                appendLog(str);
            });
            
            child.stderr.on('data', (data) => {
                const str = data.toString();
                if (outputCallback) outputCallback({ id, data: str });
                appendLog(`ERR: ${str}`);
            });
            
            child.on('exit', () => {
                processes.delete(id);
                // Final rewrite
                rewriteLogFile();
                if (logStream) logStream.end();
                if (exitCallback) exitCallback({ id });
            });
            
            child.on('error', (err) => {
                console.error('[Runner] Spawn error:', err);
                const errMsg = `Error spawning process: ${err.message}`;
                if (outputCallback) outputCallback({ id, data: errMsg });
                appendLog(`${errMsg}\n`);
                rewriteLogFile(); // Ensure log is saved
                if (logStream) {
                    logStream.end();
                }
                processes.delete(id);
            });

        } catch (e) {
            if (logStream) logStream.end();
            throw e;
        }
    },

    stopProjectCommand: async (id) => {
        const child = processes.get(id);
        if (child) {
            terminateProcessTree(child);
            processes.delete(id);
        }
    },

    runCustomCommand: async (id, projectPath, command) => {
        if (processes.has(id)) throw new Error('Already running');

        const child = spawn(command, {
            cwd: projectPath,
            shell: true,
            env: { ...process.env },
            detached: process.platform !== 'win32',
            windowsHide: process.platform === 'win32',
        });

        spawnParentDeathWatch(child);

        processes.set(id, child);

        child.stdout.on('data', (data) => {
            const str = data.toString();
            if (outputCallback) outputCallback({ id, data: str });
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            if (outputCallback) outputCallback({ id, data: str });
        });

        child.on('exit', () => {
            processes.delete(id);
            if (exitCallback) exitCallback({ id });
        });

        child.on('error', (err) => {
            if (outputCallback) outputCallback({ id, data: `Error: ${err.message}\n` });
            processes.delete(id);
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
        // Use userData path
        const userPath = platform.getPath('userData');
        const filePath = path.join(userPath, filename);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
        return "";
    },
    
    writeConfigFile: async (filename, content) => {
        const userPath = platform.getPath('userData');
        const filePath = path.join(userPath, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
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
        platform.shellOpenExternal(url);
    },
    
    openFolder: async (path) => {
        platform.shellOpenPath(path);
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
        return "1.1.1";
    },
    
    installUpdate: async (url) => {
        platform.shellOpenExternal(url);
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
    
    //************* 终端打开 *************
    openInTerminal: async (projectPath, terminal, nodePath) => {
        const term = (terminal || 'cmd').trim().toLowerCase();
        const spawnOptions = getTerminalSpawnOptions(nodePath);
        
        if (process.platform === 'win32') {
            try {
                const winPath = projectPath.replace(/\//g, "\\");
                const winPathCmd = escapeCmdDoubleQuotes(winPath);
                const pathEnvCmd = spawnOptions.env?.PATH ? escapeCmdDoubleQuotes(spawnOptions.env.PATH) : '';
                const winPathPs = escapePowerShellSingleQuotes(winPath);
                const pathEnvPs = spawnOptions.env?.PATH ? escapePowerShellSingleQuotes(spawnOptions.env.PATH) : '';
                
                if (term === 'powershell') {
                     const startupScript = pathEnvPs
                        ? `$env:PATH='${pathEnvPs}'; Set-Location '${winPathPs}'; node -v`
                        : `Set-Location '${winPathPs}'; node -v`;
                     spawn('cmd', ['/C', 'start', '', 'powershell', '-NoExit', '-Command', startupScript], spawnOptions);
                } else if (term === 'pwsh') {
                     const startupScript = pathEnvPs
                        ? `$env:PATH='${pathEnvPs}'; Set-Location '${winPathPs}'; node -v`
                        : `Set-Location '${winPathPs}'; node -v`;
                     spawn('cmd', ['/C', 'start', '', 'pwsh', '-NoExit', '-Command', startupScript], spawnOptions);
                } else if (term === 'windows-terminal') {
                    const startupCommand = pathEnvCmd
                        ? `set "PATH=${pathEnvCmd}" && cd /d "${winPathCmd}" && node -v`
                        : `node -v`;
                    spawn('wt', ['-d', winPath, 'cmd', '/K', startupCommand], spawnOptions);
                } else if (term === 'cmder') {
                    const startupCommand = pathEnvCmd
                        ? `set "PATH=${pathEnvCmd}" && cd /d "${winPathCmd}" && cmder && node -v`
                        : `cd /d "${winPathCmd}" && cmder && node -v`;
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
                        const startupCommand = pathEnvCmd
                            ? `set "PATH=${pathEnvCmd}" && cd /d "${winPathCmd}" && bash -c "node -v; exec bash"`
                            : `cd /d "${winPathCmd}" && bash -c "node -v; exec bash"`;
                        spawn('cmd', ['/K', startupCommand], spawnOptions);
                    }
                } else {
                    // CMD (Default)
                    const startupCommand = pathEnvCmd
                        ? `set "PATH=${pathEnvCmd}" && cd /d "${winPathCmd}" && node -v`
                        : `cd /d "${winPathCmd}" && node -v`;
                    spawn('cmd', ['/C', 'start', '', 'cmd', '/K', startupCommand], spawnOptions);
                }
            } catch (e) {
                console.error('Failed to open terminal', e);
            }
        } else if (process.platform === 'darwin') {
             try {
                spawn('open', ['-a', 'Terminal', projectPath], spawnOptions);
             } catch (e) {
                console.error(e);
             }
        } else {
            // Linux
            const terms = [
                { id: 'gnome-terminal', cmd: 'gnome-terminal', args: ['--working-directory', projectPath, '--', 'bash', '-c', 'node -v; exec bash'] },
                { id: 'konsole', cmd: 'konsole', args: ['--workdir', projectPath, '-e', 'bash', '-c', 'node -v; exec bash'] },
                { id: 'xfce4-terminal', cmd: 'xfce4-terminal', args: ['--working-directory', projectPath, '-e', "bash -c 'node -v; exec bash'"] }
            ];
            
            const target = terms.find(t => t.id === term);
            
            if (target) {
                 spawn(target.cmd, target.args, spawnOptions).unref();
            } else {
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
$pids = ($ports | Select-Object -ExpandProperty OwningProcess -Unique) -join ','
$procs = @{}
if ($pids) {
  Get-CimInstance Win32_Process -Filter "ProcessId IN ($pids)" -ErrorAction SilentlyContinue | ForEach-Object {
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

                exec(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
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
            const result = execSync('git rev-parse --is-inside-work-tree', {
                cwd: projectPath,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
            return result.toString().trim() === 'true';
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

        let ahead = 0, behind = 0, hasRemote = false, remoteName = null;

        if (!isDetached) {
            const remote = runGitSafe(['config', `branch.${branchRaw}.remote`]);
            if (remote) {
                hasRemote = true;
                remoteName = remote;
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

        return { branch, is_detached: isDetached, ahead, behind, has_remote: hasRemote, remote_name: remoteName };
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

    gitPull: async (projectPath, remote, branch, operationId) => {
        const args = ['pull'];
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

    gitPush: async (projectPath, remote, branch, force, setUpstream, operationId) => {
        const args = ['push'];
        if (force) args.push('--force');
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

};

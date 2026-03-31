const fs = require('fs');
const path = require('path');
const { spawn, exec, execFile, execSync, execFileSync } = require('child_process');

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

// Platform-adaptive: support both uTools and ZTools
const platform = typeof ztools !== 'undefined' ? ztools : utools;

// Cleanup on exit
platform.onPluginOut(() => {
    for (const [id, child] of processes) {
        try {
            if (process.platform === 'win32') {
                exec(`taskkill /pid ${child.pid} /T /F`);
            } else {
                child.kill();
            }
        } catch (e) {}
    }
    processes.clear();
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
            
            const content = fs.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(content);
            
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
        if (nodePath) {
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

        // Construct command
        const pm = packageManager || 'npm';
        const cmdStr = `${pm} run ${script}`;

        try {
            console.log('[Runner] Executing:', cmdStr);
            console.log('[Runner] Node Dir:', nodeDir);
            console.log('[Runner] Package Manager:', pm);

            appendLog(`Executing: ${cmdStr}\n`);
            appendLog(`Node Path used: ${nodeDir || 'System Default'}\n`);
            
            const child = spawn(pm, ['run', script], {
                cwd: projectPath,
                shell: true,
                env: env
            });
            
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
            if (process.platform === 'win32') {
                try {
                    // Kill process tree on Windows
                    exec(`taskkill /pid ${child.pid} /T /F`);
                } catch (e) {
                    child.kill(); 
                }
            } else {
                // Unix
                child.kill(); 
            }
            processes.delete(id);
        }
    },

    runCustomCommand: async (id, projectPath, command) => {
        if (processes.has(id)) throw new Error('Already running');

        // Parse command into executable and arguments for safer execution
        const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [command];
        const cmd = parts[0].replace(/^"|"$/g, '');
        const args = parts.slice(1).map(a => a.replace(/^"|"$/g, '').replace(/^'|'$/g, ''));

        const child = spawn(cmd, args, {
            cwd: projectPath,
            shell: true,
            env: { ...process.env }
        });

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
        return fs.readFileSync(path, 'utf-8');
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
        return "1.0.3";
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
    openInTerminal: async (projectPath, terminal) => {
        const term = (terminal || 'cmd').trim().toLowerCase();
        
        if (process.platform === 'win32') {
            try {
                const winPath = projectPath.replace(/\//g, "\\");
                
                if (term === 'powershell') {
                     // PowerShell: start a new window, cd to path
                     spawn('cmd', ['/C', 'start', '/D', winPath, 'powershell', '-NoExit'], { detached: true, stdio: 'ignore' });
                } else if (term === 'pwsh') {
                     spawn('cmd', ['/C', 'start', '/D', winPath, 'pwsh', '-NoExit'], { detached: true, stdio: 'ignore' });
                } else {
                    // CMD (Default)
                    spawn('cmd', ['/C', 'start', '/D', winPath, 'cmd'], { detached: true, stdio: 'ignore' });
                }
            } catch (e) {
                console.error('Failed to open terminal', e);
            }
        } else if (process.platform === 'darwin') {
             try {
                spawn('open', ['-a', 'Terminal', projectPath], { detached: true, stdio: 'ignore' });
             } catch (e) {
                console.error(e);
             }
        } else {
            // Linux
            const terms = [
                { id: 'gnome-terminal', cmd: 'gnome-terminal', args: ['--working-directory', projectPath] },
                { id: 'konsole', cmd: 'konsole', args: ['--workdir', projectPath] },
                { id: 'xfce4-terminal', cmd: 'xfce4-terminal', args: ['--working-directory', projectPath] }
            ];
            
            const target = terms.find(t => t.id === term);
            
            if (target) {
                 spawn(target.cmd, target.args, { detached: true, stdio: 'ignore' }).unref();
            } else {
                // Fallback attempt
                for (const t of terms) {
                    try {
                        const child = spawn(t.cmd, t.args, { detached: true, stdio: 'ignore' });
                        child.on('error', () => {});
                        child.unref();
                        break;
                    } catch (e) {}
                }
            }
        }
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

    gitPull: async (projectPath, remote, branch) => {
        const args = ['pull'];
        if (remote) args.push(remote);
        if (branch) args.push(branch);
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, { cwd: projectPath, windowsHide: true });
            let stdout = '', stderr = '';
            child.stdout.on('data', (d) => stdout += d);
            child.stderr.on('data', (d) => stderr += d);
            child.on('close', (code) => {
                if (code === 0) resolve(stdout + stderr);
                else reject(new Error(stderr || stdout));
            });
            child.on('error', reject);
        });
    },

    gitPush: async (projectPath, remote, branch, force, setUpstream) => {
        const args = ['push'];
        if (force) args.push('--force');
        if (setUpstream) args.push('-u');
        if (remote) args.push(remote);
        if (branch) args.push(branch);
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, { cwd: projectPath, windowsHide: true });
            let stdout = '', stderr = '';
            child.stdout.on('data', (d) => stdout += d);
            child.stderr.on('data', (d) => stderr += d);
            child.on('close', (code) => {
                if (code === 0) resolve(stdout + stderr);
                else reject(new Error(stderr || stdout));
            });
            child.on('error', reject);
        });
    },

    gitFetch: async (projectPath, remote) => {
        const args = ['fetch'];
        if (remote) args.push(remote);
        else args.push('--all');
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, { cwd: projectPath, windowsHide: true });
            let stdout = '', stderr = '';
            child.stdout.on('data', (d) => stdout += d);
            child.stderr.on('data', (d) => stderr += d);
            child.on('close', (code) => {
                if (code === 0) resolve(stdout + stderr);
                else reject(new Error(stderr || stdout));
            });
            child.on('error', reject);
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

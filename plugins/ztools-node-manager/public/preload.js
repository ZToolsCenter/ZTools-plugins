const { execSync, exec, spawn } = require("child_process");
const iconv = require("iconv-lite");
const fs = require("fs");
const path = require("path");

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

const REGISTRIES = {
  npm: "https://registry.npmjs.org/",
  yarn: "https://registry.yarnpkg.com/",
  taobao: "https://registry.npmmirror.com/",
  tencent: "https://mirrors.cloud.tencent.com/npm/",
  cnpm: "https://r.cnpmjs.org/",
};

const REGISTRY_FILE = path.join(__dirname, "registries.json");
const PROJECTS_FILE = path.join(__dirname, "projects.json");

function loadCustomRegistries() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load registries.json", e);
  }
  return {};
}

function saveCustomRegistries(regs) {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(regs, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save registries.json", e);
  }
}

let customRegs = loadCustomRegistries();
const runningProcesses = {};
const outputBuffers = {};

// 辅助函数：解码输出
function decodeOutput(buffer) {
  if (isWin) {
    return iconv.decode(buffer, 'gbk');
  }
  return buffer.toString('utf-8');
}

// 辅助函数：异步执行命令并解码
function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000, shell: true }, (error, stdout) => {
      if (error) {
        console.error(`Command failed: ${cmd}`, error);
        resolve("");
        return;
      }
      const output = decodeOutput(Buffer.from(stdout, 'binary')).trim();
      resolve(output);
    });
  });
}

// 辅助函数：杀死进程树
function killProcessTree(pid) {
  try {
    if (isWin) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      // Unix 下使用负 PID 杀死整个进程组
      process.kill(-pid, 'SIGKILL');
    }
  } catch (e) {
    console.error(`Failed to kill process tree for PID ${pid}`, e);
  }
}

window.nodeManager = {
  // --- Node 版本管理 ---
  getInstalledVersions: () => {
    return new Promise((resolve) => {
      exec("nvm list", { shell: true }, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const output = decodeOutput(Buffer.from(stdout, 'binary'));
        const lines = output.split("\n");
        const versions = [];
        lines.forEach((line) => {
          // 匹配版本号 (支持 Windows 的 v1.2.3 和 Unix 的 1.2.3)
          const match = line.match(/(\d+\.\d+\.\d+)/);
          if (match) {
            versions.push({
              version: match[1],
              isCurrent: line.includes("*") || line.includes("(Currently using"),
            });
          }
        });
        resolve(versions);
      });
    });
  },

  getAvailableVersions: () => {
    return new Promise((resolve) => {
      const cmd = isWin ? "nvm list available" : "nvm ls-remote --lts";
      exec(cmd, { shell: true }, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const output = decodeOutput(Buffer.from(stdout, 'binary'));
        const lines = output.split("\n");
        const versions = [];
        
        if (isWin) {
          let startParsing = false;
          lines.forEach(line => {
            if (line.includes("---")) { startParsing = true; return; }
            if (startParsing) {
              const columns = line.split(/[|]\s*/).map(c => c.trim()).filter(c => c);
              if (columns.length >= 2 && /^\d+\.\d+\.\d+$/.test(columns[1])) {
                versions.push(columns[1]);
              }
            }
          });
        } else {
          // nvm ls-remote 输出格式: "v14.17.0 (LTS: Erbium)"
          lines.forEach(line => {
            const match = line.match(/v(\d+\.\d+\.\d+)/);
            if (match) versions.push(match[1]);
          });
        }

        resolve(Array.from(new Set(versions)).reverse().slice(0, 20));
      });
    });
  },

  getFullVersionList: () => {
    return new Promise((resolve, reject) => {
      const https = require("https");
      https.get("https://nodejs.org/dist/index.json", (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on("error", (err) => reject(err));
    });
  },

  useVersion: (version) => {
    return new Promise((resolve, reject) => {
      exec(`nvm use ${version}`, { shell: true }, (error, stdout, stderr) => {
        if (error) {
          const errMsg = decodeOutput(Buffer.from(stderr, 'binary'));
          reject(errMsg || error.message);
        } else {
          resolve(decodeOutput(Buffer.from(stdout, 'binary')));
        }
      });
    });
  },

  installVersion: (version, onProgress) => {
    return new Promise((resolve, reject) => {
      const child = spawn("nvm", ["install", version], { 
        shell: true,
        env: { ...process.env, LANG: 'en_US.UTF-8' } 
      });
      
      let lastStdoutText = "";
      child.stdout.on("data", (data) => {
        const text = decodeOutput(data);
        lastStdoutText += text;
        
        const matches = text.match(/(\d+(?:\.\d+)?)\s*%/g);
        if (matches && onProgress) {
          matches.forEach(m => {
            const percent = parseFloat(m.replace('%', '').trim());
            if (!isNaN(percent)) onProgress(Math.floor(percent));
          });
        }
      });

      let stderrText = "";
      child.stderr.on("data", (data) => {
        const err = decodeOutput(data);
        stderrText += err;
      });

      child.on("close", (code) => {
        if (code === 0) resolve();
        else {
          let finalError = stderrText.trim();
          if (!finalError) {
            const errorMatch = lastStdoutText.match(/error.*/i) || [lastStdoutText.split('\n').pop()];
            finalError = errorMatch[0].trim();
          }
          reject(new Error(finalError || `安装失败 (Code: ${code})`));
        }
      });
    });
  },

  uninstallVersion: (version) => {
    return new Promise((resolve, reject) => {
      exec(`nvm uninstall ${version}`, { shell: true }, (error, stdout, stderr) => {
        if (error) reject(decodeOutput(Buffer.from(stderr, 'binary')));
        else resolve(decodeOutput(Buffer.from(stdout, 'binary')));
      });
    });
  },

  openVersionDir: (version) => {
    return new Promise((resolve, reject) => {
      if (isWin) {
        exec('nvm root', { shell: true }, (error, stdout) => {
          if (error) return reject("无法获取 nvm 根目录");
          const rootPath = stdout.trim().replace('Current Root: ', '');
          const versionPath = path.join(rootPath, `v${version}`);
          exec(`start "" "${versionPath}"`, { shell: true }, (err) => {
            if (err) reject("文件夹不可用: " + versionPath);
            else resolve();
          });
        });
      } else {
        // Unix 下查找版本路径的简单尝试
        exec(`nvm which ${version}`, { shell: true }, (error, stdout) => {
          if (error) return reject("无法定位该版本路径");
          const binPath = stdout.trim();
          const versionDir = path.dirname(path.dirname(binPath));
          const openCmd = isMac ? 'open' : 'xdg-open';
          exec(`${openCmd} "${versionDir}"`, (err) => {
            if (err) reject("执行失败: " + err.message);
            else resolve();
          });
        });
      }
    });
  },

  // --- npm 源管理 ---
  getCurrentRegistry: () => runCommand("npm config get registry"),

  setRegistry: async (nameOrUrl) => {
    const all = { ...REGISTRIES, ...customRegs };
    const url = all[nameOrUrl] || nameOrUrl;
    await runCommand(`npm config set registry ${url}`);
    return url;
  },
  
  getRegistryMap: () => ({ ...REGISTRIES, ...customRegs }),
  getBuiltInRegistryKeys: () => Object.keys(REGISTRIES),

  addRegistry: (name, url) => {
    if (REGISTRIES[name]) throw new Error("不能覆盖内置源名称");
    customRegs[name] = url;
    saveCustomRegistries(customRegs);
    return true;
  },

  removeRegistry: (name) => {
    if (REGISTRIES[name]) throw new Error("内置源不可删除");
    delete customRegs[name];
    saveCustomRegistries(customRegs);
    return true;
  },

  // --- 项目管理 ---
  projects: {
    load: () => {
      if (fs.existsSync(PROJECTS_FILE)) return JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
      return [];
    },
    save: (list) => {
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(list, null, 2), "utf-8");
    },
    runScript: (projId, projectPath, script, nodeVersion, onData) => {
      const key = `${projId}-${script}`;
      return new Promise((resolve, reject) => {
        if (runningProcesses[key]) {
          try { killProcessTree(runningProcesses[key].pid); } catch(e) {}
        }

        const env = { ...process.env, NODE_OPTIONS: '', LANG: 'zh_CN.UTF-8' };
        
        // 跨平台执行方案：使用 shell: true 让系统自动选择 shell (cmd 或 sh)
        const cmdPrefix = nodeVersion ? `nvm use ${nodeVersion} && ` : "";
        const fullCmd = `${cmdPrefix}npm run ${script}`;
        
        const child = spawn(fullCmd, [], { 
          cwd: projectPath, 
          shell: true,
          detached: !isWin, // Unix 下开启 detached 以便杀掉整个进程组
          env 
        });
        
        runningProcesses[key] = child;
        outputBuffers[key] = Buffer.alloc(0);

        const handleData = (data) => {
          outputBuffers[key] = Buffer.concat([outputBuffers[key], data]);
          
          let lastNewLineIndex = -1;
          for (let i = outputBuffers[key].length - 1; i >= 0; i--) {
            if (outputBuffers[key][i] === 10) { 
              lastNewLineIndex = i;
              break;
            }
          }

          if (lastNewLineIndex !== -1) {
            const linesBuffer = outputBuffers[key].slice(0, lastNewLineIndex + 1);
            outputBuffers[key] = outputBuffers[key].slice(lastNewLineIndex + 1);
            
            const decodedText = decodeOutput(linesBuffer);
            if (onData) onData(decodedText);
          }
        };

        child.stdout.on("data", handleData);
        child.stderr.on("data", handleData);

        child.on("close", (code) => {
          if (outputBuffers[key] && outputBuffers[key].length > 0) {
            const final = decodeOutput(outputBuffers[key]);
            if (onData) onData(final);
          }
          delete runningProcesses[key];
          delete outputBuffers[key];
          if (code === 0 || code === null) resolve();
          else reject(new Error(`退出代码: ${code}`));
        });

        child.on("error", (err) => {
          delete runningProcesses[key];
          delete outputBuffers[key];
          reject(err);
        });
      });
    },

    stopScript: (projId, script) => {
      const key = `${projId}-${script}`;
      if (runningProcesses[key]) {
        killProcessTree(runningProcesses[key].pid);
        delete runningProcesses[key];
        return true;
      }
      return false;
    },

    startStaticServer: (projectPath, port = 8080) => {
      return new Promise((resolve, reject) => {
        const child = spawn(`npx http-server -p ${port}`, [], { cwd: projectPath, shell: true });
        child.stdout.on("data", (data) => {
          if (data.toString().includes("Available on")) resolve(port);
        });
        child.on("error", reject);
        setTimeout(() => resolve(port), 2000); 
      });
    },

    getPackageJson: (projectPath) => {
      const p = path.join(projectPath, "package.json");
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
      return null;
    },

    selectFolder: async () => {
      if (window.ztools && window.ztools.showOpenDialog) {
        const res = window.ztools.showOpenDialog({ properties: ["openDirectory"] });
        const paths = (res instanceof Promise) ? await res : res;
        return paths && paths.length > 0 ? paths[0] : null;
      }
      return prompt("请输入项目所在的绝对路径:");
    }
  },

  notify: (title, body) => {
    if (window.ztools) {
      window.ztools.showNotification(body, title);
    } else {
      alert(`${title}: ${body}`);
    }
  },

  openExternal: (url) => {
    if (window.ztools && window.ztools.shell && window.ztools.shell.openExternal) {
      window.ztools.shell.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  },

  getNvmConfig: () => {
    return new Promise((resolve) => {
      if (!isWin) return resolve({ root: 'System Managed', nodeMirror: 'Default', npmMirror: 'Default' });
      Promise.all([
        runCommand("nvm root"),
        runCommand("nvm node_mirror"),
        runCommand("nvm npm_mirror")
      ]).then(([root, nodeMirror, npmMirror]) => {
        resolve({
          root: root.replace('Current Root: ', '').trim(),
          nodeMirror: nodeMirror.replace('Node JS Mirror: ', '').trim(),
          npmMirror: npmMirror.replace('NPM Mirror: ', '').trim()
        });
      }).catch(() => resolve({ root: '', nodeMirror: '', npmMirror: '' }));
    });
  },

  setNvmMirror: (type) => {
    if (!isWin) return Promise.reject("类 Unix 系统通常通过环境变量或配置 .nvmrc 管理镜像。");
    const commands = type === 'official' 
      ? `nvm node_mirror https://nodejs.org/dist/ && nvm npm_mirror https://github.com/coreybutler/nvm-windows/releases/download/`
      : `nvm node_mirror https://npmmirror.com/mirrors/node/ && nvm npm_mirror https://npmmirror.com/mirrors/npm/`;
    
    return new Promise((resolve, reject) => {
      exec(commands, { shell: true }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  },

  useMirror: () => {
    return window.nodeManager.setNvmMirror('mirror');
  }
};

ztools.onPluginEnter((action) => {
  const { code, payload } = action;
  if (code === 'node-quick-switch') {
    const versionMatch = payload.match(/(\d+(\.\d+)*)/);
    if (versionMatch) {
      const version = versionMatch[1];
      window.nodeManager.useVersion(version)
        .then(() => {
          window.nodeManager.notify("Node 切换成功", `已切换至版本 ${version}`);
          ztools.hideMainWindow();
        })
        .catch((err) => {
          window.nodeManager.notify("Node 切换失败", err.toString());
        });
    }
  } else if (code === 'npm-quick-source') {
    const sourceMatch = payload.match(/(taobao|tencent|cnpm|npm|yarn)/i);
    if (sourceMatch) {
      const source = sourceMatch[1].toLowerCase();
      const url = window.nodeManager.setRegistry(source);
      window.nodeManager.notify("npm 换源成功", `已切换至 ${source}: ${url}`);
      ztools.hideMainWindow();
    }
  }
});

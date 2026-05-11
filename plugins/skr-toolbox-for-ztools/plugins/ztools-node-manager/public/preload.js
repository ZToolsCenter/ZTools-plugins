const { execSync, exec, spawn } = require("child_process");
const iconv = require("iconv-lite");
const fs = require("fs");
const path = require("path");

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

// 辅助函数：异步执行命令并解码
function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000, shell: true }, (error, stdout) => {
      if (error) {
        console.error(`Command failed: ${cmd}`, error);
        resolve("");
        return;
      }
      const output = iconv.decode(Buffer.from(stdout, 'binary'), 'gbk').trim();
      resolve(output);
    });
  });
}

// Windows 下彻底杀死进程树的辅助函数
function killProcessTree(pid) {
  try {
    // Windows 下使用 taskkill /F /T /PID 命令可以杀掉整个进程树
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
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
        const output = iconv.decode(Buffer.from(stdout, 'binary'), 'gbk');
        const lines = output.split("\n");
        const versions = [];
        lines.forEach((line) => {
          const match = line.match(/(\d+\.\d+\.\d+)/);
          if (match) {
            versions.push({
              version: match[1],
              isCurrent: line.includes("*"),
            });
          }
        });
        resolve(versions);
      });
    });
  },

  getAvailableVersions: () => {
    return new Promise((resolve) => {
      exec("nvm list available", { shell: true }, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const output = iconv.decode(Buffer.from(stdout, 'binary'), 'gbk');
        const lines = output.split("\n");
        const versions = [];
        
        // nvm list available 的表格结构：
        // | CURRENT | LTS | OLD STABLE | OLD UNSTABLE |
        // 我们需要提取 LTS 这一列的数据
        let startParsing = false;
        lines.forEach(line => {
          if (line.includes("---")) {
            startParsing = true;
            return;
          }
          if (startParsing) {
            // 使用管道符或空格分割列
            const columns = line.split(/[|]\s*/).map(c => c.trim()).filter(c => c);
            // 正常的行通常有 4 列版本号
            // 如果是类似 "| 25.8.1 | 24.14.0 | ..." 这种格式，LTS 在第 2 个位置
            if (columns.length >= 2) {
              const ltsVersion = columns[1];
              if (ltsVersion && /^\d+\.\d+\.\d+$/.test(ltsVersion)) {
                versions.push(ltsVersion);
              }
            }
          }
        });

        resolve(Array.from(new Set(versions)).slice(0, 20));
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
          const errMsg = iconv.decode(Buffer.from(stderr, 'binary'), 'gbk');
          reject(errMsg || error.message);
        } else {
          resolve(iconv.decode(Buffer.from(stdout, 'binary'), 'gbk'));
        }
      });
    });
  },

  installVersion: (version, onProgress) => {
    return new Promise((resolve, reject) => {
      // 强制设置环境变量以确保输出不被本地化干扰
      const child = spawn("nvm", ["install", version], { 
        shell: true,
        env: { ...process.env, LANG: 'en_US.UTF-8' } 
      });
      
      let lastStdoutText = "";
      child.stdout.on("data", (data) => {
        // Windows 下 nvm 输出通常是 GBK 编码
        const text = iconv.decode(data, 'gbk');
        lastStdoutText += text;
        
        // 调试打印：在开发环境下查看原始输出
        console.log(`[nvm raw]: ${text}`);

        // 更加激进的匹配：只要包含数字和百分号
        const matches = text.match(/(\d+(?:\.\d+)?)\s*%/g);
        if (matches && onProgress) {
          matches.forEach(m => {
            const percent = parseFloat(m.replace('%', '').trim());
            if (!isNaN(percent)) {
              onProgress(Math.floor(percent));
            }
          });
        }
      });

      let stderrText = "";
      child.stderr.on("data", (data) => {
        const err = iconv.decode(data, 'gbk');
        stderrText += err;
        console.error(`nvm install stderr: ${err}`);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          // 优先使用 stderr，如果为空则从 stdout 中找错误关键词
          let finalError = stderrText.trim();
          if (!finalError) {
            const errorMatch = lastStdoutText.match(/error.*/i) || [lastStdoutText.split('\n').pop()];
            finalError = errorMatch[0].trim();
          }
          reject(new Error(finalError || `安装异常退出 (Code: ${code})`));
        }
      });
    });
  },

  uninstallVersion: (version) => {
    return new Promise((resolve, reject) => {
      exec(`nvm uninstall ${version}`, { shell: true }, (error, stdout, stderr) => {
        if (error) reject(stderr);
        else resolve(stdout);
      });
    });
  },

  openVersionDir: (version) => {
    return new Promise((resolve, reject) => {
      // 1. 获取 nvm root 路径
      exec('nvm root', { shell: true }, (error, stdout) => {
        if (error) return reject("无法获取 nvm 根目录");
        const rootPath = stdout.trim().replace('Current Root: ', '');
        if (!rootPath) return reject("未找到 nvm 路径配置");
        
        // 2. 拼接版本目录 (Windows nvm 通常是 vX.X.X 文件夹)
        const versionPath = `${rootPath}\\v${version}`;
        
        // 3. 调用系统资源管理器打开
        exec(`start "" "${versionPath}"`, { shell: true }, (err) => {
          if (err) reject("文件夹不存在或无法打开: " + versionPath);
          else resolve();
        });
      });
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
        
        // 使用 spawn 配合 /c 开启 cmd 内容执行，以便更好地捕获输出流
        const cmdPrefix = nodeVersion ? `nvm use ${nodeVersion} && ` : "";
        const fullCmd = `${cmdPrefix}npm run ${script}`;
        
        const child = spawn("cmd.exe", ["/c", fullCmd], { 
          cwd: projectPath, 
          shell: false, // 明确使用 cmd.exe
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
            
            const decodedText = iconv.decode(linesBuffer, 'gbk');
            if (onData) onData(decodedText);
          }
        };

        child.stdout.on("data", handleData);
        child.stderr.on("data", handleData);

        child.on("close", (code) => {
          if (outputBuffers[key] && outputBuffers[key].length > 0) {
            const final = iconv.decode(outputBuffers[key], 'gbk');
            if (onData) onData(final);
          }
          delete runningProcesses[key];
          delete outputBuffers[key];
          if (code === 0 || code === null) resolve();
          else reject(new Error(`Exit ${code}`));
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
        const child = spawn("cmd.exe", ["/c", `npx http-server -p ${port}`], { cwd: projectPath, shell: false });
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
      return prompt("请输入前端项目所在的绝对路径 (e.g. C:\\my-app):");
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
    // type: 'official' | 'mirror'
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

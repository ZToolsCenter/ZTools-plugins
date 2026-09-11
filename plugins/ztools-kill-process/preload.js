console.log('ztools-kill-process preload.js loaded!');

const ztools = window.ztools || window.utools || {};

function notifyPluginEnter(action) {
  if (typeof window.onPluginEnter === 'function') {
    try {
      window.onPluginEnter(action);
    } catch (e) {
      console.error('Error in onPluginEnter:', e);
    }
  }
}

window.exports = {
  'kill-process': {
    mode: 'none',
    args: {
      enter(action) {
        if (ztools.setExpendHeight) ztools.setExpendHeight(580);
        if (ztools.setExploresHeight) ztools.setExploresHeight(580);
        if (ztools.showMainWindow) ztools.showMainWindow();
        notifyPluginEnter(action);
      },
      leave() {}
    }
  }
};

if (ztools && typeof ztools.onPluginEnter === 'function') {
  ztools.onPluginEnter((action) => {
    notifyPluginEnter(action);
  });
}

// Memory formatter helper
function formatMemory(memKB) {
  if (!memKB || isNaN(memKB) || memKB <= 0) return '0 KB';
  if (memKB >= 1024 * 1024) {
    return (memKB / (1024 * 1024)).toFixed(2) + ' GB';
  } else if (memKB >= 1024) {
    return (memKB / 1024).toFixed(1) + ' MB';
  } else {
    return memKB.toLocaleString('en-US') + ' KB';
  }
}

// Port scanner helper for Windows using netstat -ano
function getPortsWin32() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('netstat -ano', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve({});
      const lines = stdout.split('\r\n');
      const portMap = {}; // pid -> { listening: Set, all: Set }
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && (parts[0] === 'TCP' || parts[0] === 'UDP')) {
          const proto = parts[0];
          const localAddr = parts[1];
          const pidStr = parts[parts.length - 1];
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid) && pid > 0) {
            const lastColon = localAddr.lastIndexOf(':');
            if (lastColon !== -1) {
              const port = parseInt(localAddr.substring(lastColon + 1), 10);
              if (!isNaN(port) && port > 0) {
                if (!portMap[pid]) {
                  portMap[pid] = { listening: new Set(), all: new Set() };
                }
                portMap[pid].all.add(port);
                const isListening = (proto === 'TCP' && parts.includes('LISTENING')) || proto === 'UDP';
                if (isListening) {
                  portMap[pid].listening.add(port);
                }
              }
            }
          }
        }
      }
      const result = {};
      for (const pid in portMap) {
        result[pid] = {
          listening: Array.from(portMap[pid].listening).sort((a, b) => a - b),
          all: Array.from(portMap[pid].all).sort((a, b) => a - b)
        };
      }
      resolve(result);
    });
  });
}

// Port scanner helper for macOS / Linux using lsof
function getPortsPosix() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('lsof -i -P -n', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve({});
      const lines = stdout.split('\n');
      const portMap = {};
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 9) {
          const pid = parseInt(parts[1], 10);
          const nameField = parts[8] || parts[parts.length - 1];
          if (!isNaN(pid) && nameField) {
            const match = nameField.match(/:(\d+)(?:->|$)/);
            if (match) {
              const port = parseInt(match[1], 10);
              if (!isNaN(port) && port > 0) {
                if (!portMap[pid]) {
                  portMap[pid] = { listening: new Set(), all: new Set() };
                }
                portMap[pid].all.add(port);
                if (lines[i].includes('LISTEN') || lines[i].includes('(LISTEN)')) {
                  portMap[pid].listening.add(port);
                }
              }
            }
          }
        }
      }
      const result = {};
      for (const pid in portMap) {
        result[pid] = {
          listening: Array.from(portMap[pid].listening).sort((a, b) => a - b),
          all: Array.from(portMap[pid].all).sort((a, b) => a - b)
        };
      }
      resolve(result);
    });
  });
}

window.services = {
  getProcesses() {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      const os = require('os');
      const platform = os.platform();

      const portsPromise = platform === 'win32' ? getPortsWin32() : getPortsPosix();

      if (platform === 'win32') {
        const psScript = `
Get-Process | ForEach-Object {
    [PSCustomObject]@{
        Id = $_.Id;
        ProcessName = $_.ProcessName;
        WorkingSet64 = $_.WorkingSet64
    }
} | ConvertTo-Json -Compress
`;

        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

        execFile('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 5000, maxBuffer: 20 * 1024 * 1024 }, async (err, stdout) => {
          if (err) return reject(err);

          try {
            const rawItems = JSON.parse(stdout || '[]');
            const items = Array.isArray(rawItems) ? rawItems : [rawItems];
            const portMap = await portsPromise.catch(() => ({}));
            const list = [];

            for (const item of items) {
              if (!item || item.Id === undefined || item.Id === 0) continue;
              const rawName = item.ProcessName || '';
              const lowerName = rawName.toLowerCase();

              // Filter out Idle and Memory Compression processes
              if (lowerName === 'idle' || lowerName.includes('memory compression') || lowerName.includes('memorycompression')) {
                continue;
              }

              const pid = item.Id;
              const name = rawName ? `${rawName}.exe` : `PID-${pid}`;
              const memoryKB = Math.round((item.WorkingSet64 || 0) / 1024);

              const portsInfo = portMap[pid] || { listening: [], all: [] };
              const listeningPorts = portsInfo.listening || [];
              const allPorts = portsInfo.all || [];
              const displayPorts = listeningPorts.length > 0 ? listeningPorts : allPorts;
              const primaryPort = displayPorts.length > 0 ? displayPorts[0] : 999999;
              const portsStr = displayPorts.map(p => `:${p}`).join(', ');

              list.push({
                name,
                pid,
                memoryStr: formatMemory(memoryKB),
                memoryKB,
                listeningPorts,
                allPorts,
                primaryPort,
                portsStr
              });
            }

            resolve(list);
          } catch (e) {
            reject(e);
          }
        });
      } else {
        // macOS / Linux
        execFile('ps', ['-ax', '-o', 'pid,rss,comm'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 5000 }, async (err, stdout) => {
          if (err) return reject(err);
          const lines = stdout.split('\n').slice(1);
          const portMap = await portsPromise.catch(() => ({}));
          const list = [];
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              const pid = parseInt(parts[0], 10);
              const rssKB = parseInt(parts[1], 10) || 0;
              const comm = parts.slice(2).join(' ');
              if (!isNaN(pid) && comm) {
                const name = comm.split('/').pop();
                if (name.toLowerCase().includes('memory compression')) continue;
                const portsInfo = portMap[pid] || { listening: [], all: [] };
                const listeningPorts = portsInfo.listening || [];
                const allPorts = portsInfo.all || [];
                const displayPorts = listeningPorts.length > 0 ? listeningPorts : allPorts;
                const primaryPort = displayPorts.length > 0 ? displayPorts[0] : 999999;
                const portsStr = displayPorts.map(p => `:${p}`).join(', ');

                list.push({
                  name,
                  pid,
                  memoryStr: formatMemory(rssKB),
                  memoryKB: rssKB,
                  listeningPorts,
                  allPorts,
                  primaryPort,
                  portsStr
                });
              }
            }
          }
          resolve(list);
        });
      }
    });
  },

  killProcess(pid, force = true) {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      const os = require('os');
      const platform = os.platform();

      if (platform === 'win32') {
        const args = force ? ['/F', '/PID', pid.toString()] : ['/PID', pid.toString()];
        execFile('taskkill.exe', args, { encoding: 'utf8', timeout: 5000 }, (err, stdout, stderr) => {
          if (err) {
            const msg = stderr || stdout || err.message || '结束进程失败';
            return reject(new Error(msg));
          }
          resolve(stdout || '成功杀死进程');
        });
      } else {
        execFile('kill', ['-9', pid.toString()], { encoding: 'utf8', timeout: 5000 }, (err, stdout, stderr) => {
          if (err) {
            const msg = stderr || stdout || err.message || '结束进程失败';
            return reject(new Error(msg));
          }
          resolve(stdout || '成功杀死进程');
        });
      }
    });
  }
};

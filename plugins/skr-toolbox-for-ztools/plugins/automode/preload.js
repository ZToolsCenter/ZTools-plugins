/**
 * AutoMode - ZTools 插件预加载脚本
 * 仅支持定时模式管理系统深浅色主题切换
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  generateTaskXml,
  generateThemeSwitchScript,
  resolveDesiredTheme
} = require('./lib/utils');

const SCRIPTS_DIR = path.join(os.homedir(), '.automode-scripts');
const TASK_PREFIX = 'AutoMode';
const TASK_DARK = TASK_PREFIX + '_Dark';
const TASK_LIGHT = TASK_PREFIX + '_Light';
const PS_DARK = path.join(SCRIPTS_DIR, 'switch-dark.ps1');
const PS_LIGHT = path.join(SCRIPTS_DIR, 'switch-light.ps1');
const VBS_DARK = path.join(SCRIPTS_DIR, 'switch-dark.vbs');
const VBS_LIGHT = path.join(SCRIPTS_DIR, 'switch-light.vbs');

function ensureScripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  fs.writeFileSync(PS_DARK, generateThemeSwitchScript('dark'), 'utf8');
  fs.writeFileSync(PS_LIGHT, generateThemeSwitchScript('light'), 'utf8');

  function makeVbs(psName) {
    return [
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      'sd = fso.GetParentFolderName(WScript.ScriptFullName)',
      'Set ws = CreateObject("WScript.Shell")',
      'ws.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & sd & "\\' + psName + '""", 0'
    ].join('\r\n');
  }

  fs.writeFileSync(VBS_DARK, makeVbs('switch-dark.ps1'), 'utf8');
  fs.writeFileSync(VBS_LIGHT, makeVbs('switch-light.ps1'), 'utf8');
}

function createScheduledTask(mode, time) {
  try {
    ensureScripts();
    const taskName = mode === 'dark' ? TASK_DARK : TASK_LIGHT;

    try {
      execSync('schtasks /Delete /TN "' + taskName + '" /F', { windowsHide: true });
    } catch (e) {}

    const xmlBuffer = generateTaskXml(mode, time, SCRIPTS_DIR);
    const xmlPath = path.join(SCRIPTS_DIR, 'task-' + mode + '.xml');
    fs.writeFileSync(xmlPath, xmlBuffer);

    execSync(
      'schtasks /Create /TN "' + taskName + '" /XML "' + xmlPath + '" /F',
      { windowsHide: true, encoding: 'utf8' }
    );

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteScheduledTask(taskName) {
  try {
    execSync('schtasks /Delete /TN "' + taskName + '" /F', { windowsHide: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function queryTask(taskName) {
  try {
    const output = execSync(
      'schtasks /Query /TN "' + taskName + '" /FO CSV /NH',
      { windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );

    const fields = output.split('","').map(function(s) {
      return s.replace(/^"|"$/g, '').trim();
    });
    const status = fields[2] || '未知';
    const rawRun = fields[1] || '';
    const timePart = rawRun.includes(' ') ? rawRun.split(' ').pop() : rawRun;

    return {
      exists: true,
      status: status,
      nextRun: timePart === 'N/A' || timePart === '' ? '未安排' : timePart
    };
  } catch (err) {
    return { exists: false };
  }
}

function getCurrentThemeFromRegistry() {
  try {
    const output = execSync(
      'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme',
      { windowsHide: true, encoding: 'utf8' }
    );
    const match = output.match(/AppsUseLightTheme\s+REG_DWORD\s+0x(\d+)/);
    const isLight = match ? parseInt(match[1], 16) === 1 : false;
    return { dark: !isLight };
  } catch (err) {
    try {
      return { dark: window.ztools.isDarkColors() };
    } catch (e2) {
      return { dark: false };
    }
  }
}

function switchThemeImmediate(mode) {
  try {
    ensureScripts();
    const script = mode === 'dark' ? VBS_DARK : VBS_LIGHT;

    execSync(
      'wscript.exe "' + script + '"',
      { windowsHide: true, timeout: 15000 }
    );

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function enableScheduler(config) {
  try {
    window.ztools.dbStorage.setItem('automode-config', JSON.stringify(config));
    window.ztools.dbStorage.setItem('automode-mode', 'schedule');
    window.ztools.dbStorage.setItem('automode-enabled', 'true');
  } catch (e) {
    return { success: false, error: '保存配置失败: ' + e.message };
  }

  const resultDark = createScheduledTask('dark', config.darkTime);
  const resultLight = createScheduledTask('light', config.lightTime);

  if (!resultDark.success || !resultLight.success) {
    window.ztools.dbStorage.setItem('automode-enabled', 'false');
    const errors = [];
    if (!resultDark.success) errors.push('深色任务: ' + resultDark.error);
    if (!resultLight.success) errors.push('浅色任务: ' + resultLight.error);
    return { success: false, error: errors.join('; ') };
  }

  return { success: true };
}

function disableScheduler() {
  const tasks = [TASK_DARK, TASK_LIGHT];
  const results = {};

  tasks.forEach(function(name) {
    results[name] = deleteScheduledTask(name).success;
  });

  try {
    window.ztools.dbStorage.setItem('automode-enabled', 'false');
    window.ztools.dbStorage.setItem('automode-mode', '');
  } catch (e) {}

  return { success: true, tasks: results };
}

function getCurrentTheme() {
  return getCurrentThemeFromRegistry();
}

function getTaskStatus() {
  const darkTask = queryTask(TASK_DARK);
  const lightTask = queryTask(TASK_LIGHT);
  return {
    dark: darkTask,
    light: lightTask,
    enabled: darkTask.exists && lightTask.exists
  };
}

function switchImmediate(mode) {
  return switchThemeImmediate(mode);
}

function getSavedConfig() {
  try {
    const mode = window.ztools.dbStorage.getItem('automode-mode');
    const enabled = window.ztools.dbStorage.getItem('automode-enabled');
    const scheduleConfig = window.ztools.dbStorage.getItem('automode-config');

    if (mode === 'schedule' && scheduleConfig) {
      return { mode: 'schedule', config: JSON.parse(scheduleConfig), enabled: enabled === 'true' };
    }
    if (scheduleConfig) {
      return { mode: 'schedule', config: JSON.parse(scheduleConfig), enabled: false };
    }

    return { mode: 'schedule', config: null, enabled: enabled === 'true' };
  } catch (e) {
    return { mode: 'schedule', config: null, enabled: false };
  }
}

function syncThemeOnStartup() {
  try {
    const saved = getSavedConfig();
    if (!saved || !saved.enabled || !saved.config) return;

    const desired = resolveDesiredTheme(saved.config, new Date());
    const current = getCurrentTheme();

    if (desired === 'light' && current.dark) {
      switchThemeImmediate('light');
      console.log('[AutoMode] 启动同步: 当前应为浅色，已切换');
    } else if (desired === 'dark' && !current.dark) {
      switchThemeImmediate('dark');
      console.log('[AutoMode] 启动同步: 当前应为深色，已切换');
    }
  } catch (e) {
    console.error('[AutoMode] 启动同步失败:', e);
  }
}

window.themeAPI = {
  enableScheduler: enableScheduler,
  disableScheduler: disableScheduler,
  switchImmediate: switchImmediate,
  getCurrentTheme: getCurrentTheme,
  getTaskStatus: getTaskStatus,
  getSavedConfig: getSavedConfig
};

// 插件加载时立即执行，不等待用户进入面板
ensureScripts();
syncThemeOnStartup();

try {
  window.ztools.onPluginEnter(function() {
    console.log('[AutoMode] 插件已激活');
    // 面板进入时再次同步，覆盖用户长时间停留期间错过的情况
    syncThemeOnStartup();
  });
} catch (e) {
  console.error('[AutoMode] onPluginEnter 注册失败:', e);
}

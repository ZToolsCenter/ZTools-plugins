/**
 * AutoMode - 纯逻辑模块
 * 可独立测试，无副作用，不依赖 Node.js API
 */

const TASK_PREFIX = 'AutoMode';
const TASK_DARK = TASK_PREFIX + '_Dark';
const TASK_LIGHT = TASK_PREFIX + '_Light';

/**
 * 生成 schtasks XML 任务定义
 * @param {string} mode - 'dark' 或 'light'
 * @param {string} time - HH:mm 格式
 * @param {string} scriptsDir - 脚本目录路径
 * @returns {Buffer} UTF-16 LE with BOM
 */
function generateTaskXml(mode, time, scriptsDir) {
  var vbsScript = mode === 'dark' ? 'switch-dark.vbs' : 'switch-light.vbs';
  var vbsPath = scriptsDir + '\\' + vbsScript;
  var description = mode === 'dark'
    ? 'AutoMode: 定时切换到深色模式'
    : 'AutoMode: 定时切换到浅色模式';
  var parts = time.split(':');
  var hour = parts[0];
  var minute = parts[1];
  var now = new Date();
  var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  var vbsArgs = '"' + vbsPath + '"';

  var xml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    '    <Description>' + description + '</Description>',
    '    <Author>AutoMode</Author>',
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <CalendarTrigger>',
    '      <StartBoundary>' + today + 'T' + hour + ':' + minute + ':00</StartBoundary>',
    '      <Enabled>true</Enabled>',
    '      <ScheduleByDay>',
    '        <DaysInterval>1</DaysInterval>',
    '      </ScheduleByDay>',
    '    </CalendarTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>false</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <IdleSettings>',
    '      <StopOnIdleEnd>false</StopOnIdleEnd>',
    '      <RestartOnIdle>false</RestartOnIdle>',
    '    </IdleSettings>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>true</Hidden>',
    '    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>',
    '    <Priority>7</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    '      <Command>wscript.exe</Command>',
    '      <Arguments>' + vbsArgs + '</Arguments>',
    '    </Exec>',
    '  </Actions>',
    '</Task>'
  ].join('\n');

  var bom = Buffer.from([0xFF, 0xFE]);
  var content = Buffer.from(xml, 'utf16le');
  return Buffer.concat([bom, content]);
}

/**
 * 生成切换系统主题并刷新任务栏的 PowerShell 脚本
 * @param {'dark'|'light'} mode
 * @returns {string}
 */
function generateThemeSwitchScript(mode) {
  var isDark = mode === 'dark';
  var value = isDark ? 0 : 1;
  var description = isDark
    ? '# AutoMode: 切换到深色模式'
    : '# AutoMode: 切换到浅色模式';

  return [
    description,
    '$ErrorActionPreference = "Stop"',
    'reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme /t REG_DWORD /d ' + value + ' /f',
    'reg add "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v SystemUsesLightTheme /t REG_DWORD /d ' + value + ' /f',
    '$nativeCode = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class NativeMethods {',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SendMessageTimeoutW")]',
    '  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "FindWindowW")]',
    '  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);',
    '}',
    '"@',
    'Add-Type -TypeDefinition $nativeCode',
    '$HWND_BROADCAST = [IntPtr]0xffff',
    '$WM_SETTINGCHANGE = 0x001A',
    '$SMTO_ABORTIFHUNG = 0x0002',
    '$result = [UIntPtr]::Zero',
    '[void][NativeMethods]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, "ImmersiveColorSet", $SMTO_ABORTIFHUNG, 5000, [ref]$result)',
    '$tray = [NativeMethods]::FindWindow("Shell_TrayWnd", $null)',
    'if ($tray -ne [IntPtr]::Zero) {',
    '  [void][NativeMethods]::SendMessageTimeout($tray, $WM_SETTINGCHANGE, [UIntPtr]::Zero, "ImmersiveColorSet", $SMTO_ABORTIFHUNG, 5000, [ref]$result)',
    '}'
  ].join('\r\n');
}

/**
 * 根据当前时间和调度配置判断应处于哪个主题
 * 时间窗口：[lightTime, darkTime) = light，其余 = dark
 * @param {{ darkTime: string, lightTime: string }} config - HH:mm 格式
 * @param {Date} now
 * @returns {'dark'|'light'}
 */
function resolveDesiredTheme(config, now) {
  var darkParts = config.darkTime.split(':');
  var lightParts = config.lightTime.split(':');
  var darkMinutes = parseInt(darkParts[0], 10) * 60 + parseInt(darkParts[1], 10);
  var lightMinutes = parseInt(lightParts[0], 10) * 60 + parseInt(lightParts[1], 10);
  var currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (lightMinutes < darkMinutes) {
    if (currentMinutes >= lightMinutes && currentMinutes < darkMinutes) {
      return 'light';
    }
  } else if (currentMinutes >= lightMinutes || currentMinutes < darkMinutes) {
    return 'light';
  }
  return 'dark';
}

module.exports = {
  generateTaskXml: generateTaskXml,
  generateThemeSwitchScript: generateThemeSwitchScript,
  resolveDesiredTheme: resolveDesiredTheme
};

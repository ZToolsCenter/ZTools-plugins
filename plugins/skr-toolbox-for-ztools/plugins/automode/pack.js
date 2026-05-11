/**
 * 打包 AutoMode 插件为 .zpx 文件
 * 用法: node pack.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname);
const ps1 = path.join(dir, '_pack.ps1');
const out = path.join(dir, 'AutoMode.zpx');

if (!fs.existsSync(ps1)) {
  console.error('_pack.ps1 not found');
  process.exit(1);
}

try { fs.unlinkSync(out); } catch (e) {}

execFileSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', ps1], { windowsHide: true });
console.log('AutoMode.zpx: ' + fs.statSync(out).size + ' bytes');

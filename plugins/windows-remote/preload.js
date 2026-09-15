console.log('ztools-windows-remote preload.js loaded!');
// ZTools Windows 远程连接 —— 管理 RDP 连接，一键连接
// 要求定义与 plugin.json feature code 对应的 exports
const ztools = window.ztools || window.utools || {};

window.exports = {
  'windows-remote': {
    mode: 'none',
    args: {
      enter() {
        if (ztools.setExpendHeight) ztools.setExpendHeight(620);
        if (ztools.showMainWindow) ztools.showMainWindow();
      },
      leave() {}
    }
  }
};

window.services = {
  // ---------- ZTools 数据库 ----------
  dbGet(key) { 
    try {
      return ztools.dbStorage ? ztools.dbStorage.getItem(key) : localStorage.getItem(key); 
    } catch(e) { return null; }
  },
  dbSet(key, val) { 
    try {
      if (ztools.dbStorage) {
        ztools.dbStorage.setItem(key, val);
      } else {
        localStorage.setItem(key, val);
      }
      return true;
    } catch(e) { return false; }
  },

  // ---------- 一键连接远程桌面 ----------
  // 结合 cmdkey 凭据写入、Windows 凭据策略配置、以及生成带 prompt for credentials:i:0 的临时 .rdp 配置文件，实现真正的免密一键连接
  connect(ip, username, password) {
    const { spawnSync, spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    // 查找 Windows System32 / Sysnative 下的可执行程序 (防止 32位/64位 进程重定向找不到 cmdkey/mstsc)
    function getSystemTool(exeName) {
      const windir = process.env.WINDIR || 'C:\\Windows';
      const sysnative = path.join(windir, 'Sysnative', exeName);
      if (fs.existsSync(sysnative)) return sysnative;
      const system32 = path.join(windir, 'System32', exeName);
      if (fs.existsSync(system32)) return system32;
      return exeName;
    }

    const cmdkeyPath = getSystemTool('cmdkey.exe');
    const mstscPath = getSystemTool('mstsc.exe');

    const targetHost = (ip || '').trim();
    if (!targetHost) {
      throw new Error('远程连接地址不能为空');
    }

    const cleanHost = targetHost.split(':')[0]; // 不带端口的纯 IP 或主机名

    // 1. 自动开启 Windows 允许保存凭据及允许空密码/空格密码远程登录策略 (HKCU & HKLM)
    try {
      const psScript = `
        Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name 'LimitBlankPasswordUse' -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null
        $paths = @(
          'HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CredentialsDelegation',
          'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\CredentialsDelegation'
        )
        foreach ($p in $paths) {
          try {
            New-Item -Path $p -Force -ErrorAction SilentlyContinue | Out-Null
            New-Item -Path "$p\\AllowSavedCredentials" -Force -ErrorAction SilentlyContinue | Out-Null
            New-ItemProperty -Path "$p\\AllowSavedCredentials" -Name '1' -Value 'TERMSRV/*' -PropertyType String -Force -ErrorAction SilentlyContinue | Out-Null
            New-Item -Path "$p\\AllowSavedCredentialsWhenNTLMOnly" -Force -ErrorAction SilentlyContinue | Out-Null
            New-ItemProperty -Path "$p\\AllowSavedCredentialsWhenNTLMOnly" -Name '1' -Value 'TERMSRV/*' -PropertyType String -Force -ErrorAction SilentlyContinue | Out-Null
            New-Item -Path "$p\\AllowSavedCredentialsOpenAuth" -Force -ErrorAction SilentlyContinue | Out-Null
            New-ItemProperty -Path "$p\\AllowSavedCredentialsOpenAuth" -Name '1' -Value 'TERMSRV/*' -PropertyType String -Force -ErrorAction SilentlyContinue | Out-Null
          } catch {}
        }
      `;
      spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
        stdio: 'ignore',
        windowsHide: true
      });
    } catch (e) {
      console.warn('配置凭据策略异常:', e);
    }

    // 2. 写入 Windows 凭据管理器 (必须使用 /add: 创建 RDP 要求的 域 凭据)
    let domainStr = '';
    let userStr = (username || '').trim();
    if (userStr.includes('\\')) {
      const parts = userStr.split('\\');
      domainStr = parts[0];
      userStr = parts.slice(1).join('\\');
    }

    const targets = new Set([
      'TERMSRV/' + targetHost,
      'TERMSRV/' + cleanHost,
      targetHost,
      cleanHost
    ]);

    if (cleanHost === '127.0.0.1' || cleanHost === 'localhost') {
      targets.add('TERMSRV/localhost');
      targets.add('localhost');
      targets.add('TERMSRV/127.0.0.1');
      targets.add('127.0.0.1');
    }

    // 清理历史旧凭据（包含普通凭据与域凭据，避免 LegacyGeneric 干扰 mstsc）
    targets.forEach(t => {
      try { spawnSync('cmd.exe', ['/c', `cmdkey /delete:${t}`], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
      try { spawnSync('cmd.exe', ['/c', `cmdkey /delete:LegacyGeneric:target=${t}`], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
      try { spawnSync('cmd.exe', ['/c', `cmdkey /delete:Domain:target=${t}`], { stdio: 'ignore', windowsHide: true }); } catch (e) {}
    });

    // 写入 Windows 域凭据 (Domain:target=TERMSRV/...)
    const passStr = password === undefined || password === null ? '' : String(password);
    const safePass = passStr.replace(/["^&|<>()%]/g, '^$&');
    const safeUser = String(username || '').replace(/["^&|<>()%]/g, '^$&');

    targets.forEach(t => {
      try {
        const cmd = `cmdkey /add:${t} /user:${safeUser} /pass:"${safePass}"`;
        spawnSync('cmd.exe', ['/c', cmd], { stdio: 'ignore', windowsHide: true });
      } catch (e) {
        console.error('cmdkey 写入凭据异常:', e);
      }
    });

    // 3. 生成临时 .rdp 配置文件（写入 DPAPI 加密的 password 51:b: 原生密文、禁用手动提示密码 & 忽略未受信任证书弹窗）
    function getDPAPIPasswordHex(pwd) {
      if (pwd === undefined || pwd === null || pwd === '') return '';
      try {
        const psCode = `
          Add-Type -AssemblyName System.Security
          $b = [System.Text.Encoding]::Unicode.GetBytes('${String(pwd).replace(/'/g, "''")}')
          $e = [System.Security.Cryptography.ProtectedData]::Protect($b, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
          [System.BitConverter]::ToString($e) -replace '-',''
        `;
        const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCode], {
          encoding: 'utf8',
          windowsHide: true
        });
        return (res.stdout || '').trim();
      } catch (e) {
        return '';
      }
    }

    const dpapiPasswordHex = getDPAPIPasswordHex(password);
    const tempRdpPath = path.join(os.tmpdir(), `ztools_rdp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.rdp`);
    const rdpLines = [
      `full address:s:${targetHost}`,
      `username:s:${userStr}`,
      dpapiPasswordHex ? `password 51:b:${dpapiPasswordHex}` : '',
      domainStr ? `domain:s:${domainStr}` : '',
      'prompt for credentials:i:0',
      'promptcredentialonce:i:0',
      'authentication level:i:0',
      'enablecredsspsupport:i:1',
      'disable connection sharing:i:1',
      'screen mode id:i:2',
      'desktopwidth:i:0',
      'desktopheight:i:0',
      'session bpp:i:32',
      'compression:i:1',
      'keyboardhook:i:2',
      'audiocapturemode:i:0',
      'videoplaybackmode:i:1',
      'connectiontype:i:7',
      'networkautodetect:i:1',
      'bandwidthautodetect:i:1',
      'displayconnectionbar:i:1',
      'enableworkspacereconnect:i:0',
      'redirectclipboard:i:1'
    ];
    
    const rdpContent = rdpLines.filter(line => line !== '').join('\r\n');

    // Windows 远程桌面 (.rdp) 必须使用 UTF-16LE + BOM (\ufeff) 编码，否则 mstsc 无法解析 prompt for credentials 等设置
    fs.writeFileSync(tempRdpPath, '\ufeff' + rdpContent, 'utf16le');

    // 4. 调用 Windows 自带远程桌面工具加载 .rdp 临时文件
    const child = spawn(mstscPath, [tempRdpPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();

    // 5. 延时清理临时 .rdp 文件
    setTimeout(() => {
      try {
        if (fs.existsSync(tempRdpPath)) {
          fs.unlinkSync(tempRdpPath);
        }
      } catch (e) {}
    }, 15000);

    return true;
  }
};
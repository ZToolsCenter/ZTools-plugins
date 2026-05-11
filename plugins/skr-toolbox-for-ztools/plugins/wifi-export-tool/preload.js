const { exec } = require('node:child_process');
const os = require('node:os');

/**
 * 执行系统命令并返回 Promise
 */
function execCmd(command) {
    return new Promise((resolve, reject) => {
        exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                console.warn(`[Command Warn] ${command} exited with error:`, error);
                // 有些命令即使报错也会有部分输出，这里根据需要处理
            }
            resolve(stdout || '');
        });
    });
}

console.log('Preload.js: 开始加载 WiFi API...');

const wifiApi = {
    getWifiList: async () => {
        const platform = os.platform();
        try {
            if (platform === 'win32') {
                return await getWindowsWifi();
            } else if (platform === 'darwin') {
                return await getMacWifi();
            } else if (platform === 'linux') {
                return await getLinuxWifi();
            } else {
                return [];
            }
        } catch (err) {
            console.error("Failed to get wifi list:", err);
            throw err;
        }
    },
    getWifiPassword: async (ssid) => {
        const platform = os.platform();
        try {
            if (platform === 'darwin') {
                const pwdOutput = await execCmd(`security find-generic-password -wa "${ssid}"`);
                return pwdOutput.trim();
            } else if (platform === 'win32') {
                const profileOutput = await execCmd(`chcp 65001 >nul && netsh wlan show profile name="${ssid}" key=clear`);
                const pwdMatch = profileOutput.match(/(?:关键内容|Key Content|Key content)\s*:\s*(.*)/i);
                if (pwdMatch) {
                    return pwdMatch[1].trim();
                }
            } else if (platform === 'linux') {
                const detail = await execCmd(`nmcli -s -g 802-11-wireless-security.psk connection show "${ssid}"`);
                if (detail && detail.trim()) {
                     return detail.trim();
                }
            }
        } catch (e) {
            console.error(`获取 ${ssid} 密码失败:`, e);
        }
        return '';
    }
};

// 尝试多种挂载方式以应对可能的 Context 隔离
if (typeof window !== 'undefined') {
    window.wifiApi = wifiApi;
}
if (typeof global !== 'undefined') {
    global.wifiApi = wifiApi;
}
if (typeof globalThis !== 'undefined') {
    globalThis.wifiApi = wifiApi;
}

console.log('Preload.js: WiFi API 挂载完成');

async function getWindowsWifi() {
    try {
        // 使用 chcp 65001 确保输出为 UTF-8，防止中文乱码影响正则匹配
        const profilesOutput = await execCmd('chcp 65001 >nul && netsh wlan show profiles');
        const allRegex = /:\s(.*)/g;
        const ssids = [];

        let match;
        while ((match = allRegex.exec(profilesOutput)) !== null) {
            let ssid = match[1].trim();
            if (ssid) ssids.push(ssid);
        }

        const results = [];
        for (const ssid of ssids) {
            if (!ssid) continue;
            try {
                // 同样在查询详情时切换代码页
                const profileOutput = await execCmd(`chcp 65001 >nul && netsh wlan show profile name="${ssid}" key=clear`);

                let password = '';
                let securityType = '开放网络';

                // 优化正则，适配更多情况
                const pwdMatch = profileOutput.match(/(?:关键内容|Key Content|Key content)\s*:\s*(.*)/i);
                if (pwdMatch) {
                    password = pwdMatch[1].trim();
                }

                const authMatch = profileOutput.match(/(?:身份验证|Authentication)\s*:\s*(.*)/i);
                if (authMatch) {
                    securityType = authMatch[1].trim();
                    if (securityType === 'Open' || securityType.includes('开放')) {
                        securityType = '开放网络';
                    }
                }

                results.push({
                    ssid,
                    password,
                    securityType
                });
            } catch (e) {
                results.push({ ssid, password: '', securityType: 'Unknown' });
            }
        }
        return results;
    } catch (e) {
        console.error("Windows WiFi 读取失败:", e);
        throw new Error("Windows WiFi 核心执行失败：" + (e.message || "Unknown error"));
    }
}

async function getMacWifi() {
    try {
        const output = await execCmd('networksetup -listpreferredwirelessnetworks en0');
        const lines = output.split('\n').map(l => l.trim()).filter(l => l && !l.includes('Preferred networks on'));

        const results = [];
        for (const ssid of lines) {
            // macOS 批量获取密码会导致频繁弹窗，因此默认不获取，改为前台按需获取
            results.push({ ssid, password: undefined, securityType: '未知/按需获取' });
        }
        return results;
    } catch (e) {
        console.error("macOS WiFi 读取失败:", e);
        throw new Error("Mac WiFi 核心执行失败：" + (e.message || e));
    }
}

async function getLinuxWifi() {
    try {
        const output = await execCmd('nmcli -t -f NAME,TYPE connection show');
        const lines = output.split('\n');
        const results = [];

        for (const line of lines) {
            if (!line || !line.includes('802-11-wireless')) continue;

            const ssid = line.split(':')[0];
            if (!ssid) continue;

            let password = '';
            let securityType = '开放网络';

            try {
                const detail = await execCmd(`nmcli -s -g 802-11-wireless-security.psk connection show "${ssid}"`);
                if (detail && detail.trim()) {
                    password = detail.trim();
                    securityType = 'WPA/WPA2';
                }
            } catch (e) { }

            results.push({ ssid, password, securityType });
        }
        return results;
    } catch (e) {
        console.error("Linux WiFi 读取失败:", e);
        throw new Error("Linux WiFi 核心执行失败：" + (e.message || e));
    }
}

const { exec } = require('child_process')

// ytools
const ytools = window.utools || window.ztools
// ytools end

// https://gist.github.com/rmcdongit/f66ff91e0dad78d4d6346a75ded4b751
const commands = [
    {
        name: '主页',
        code: 'home',
        urlScheme: 'x-apple.systempreferences:com.apple.preference.general',
    },
    {
        "name": "Wi-Fi",
        "code": "preference.network.wifi",
        "urlScheme": "x-apple.systempreferences:com.apple.Network-Settings.extension?Wi-Fi" // 有点问题
    },
    {
        "name": "蓝牙",
        "code": "preference.bluetooth",
        "urlScheme": "x-apple.systempreferences:com.apple.preferences.Bluetooth"
    },
    {
        "name": "网络",
        "code": "preference.network",
        "urlScheme": "x-apple.systempreferences:com.apple.Network-Settings.extension"
    },
    {
        "name": "电池",
        "code": "preference.battery",
        "urlScheme": "x-apple.systempreferences:com.apple.Battery-Settings.extension"
    },
    {
        "name": "通用",
        "code": "preference.general",
        "urlScheme": "x-apple.systempreferences:com.apple.SystemProfiler.AboutExtension?generalSection"
    },
    {
        "name": "辅助功能",
        "code": "preference.universalaccess",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.universalaccess"
    },
    {
        "name": "聚焦",
        "code": "preference.spotlight",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.spotlight"
    },
    {
        "name": "墙纸",
        "code": "preference.desktop",
        "urlScheme": "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension"
    },
    {
        "name": "外观",
        "code": "preference.appearance",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.general?Appearance"
    },
    {
        "name": "显示器",
        "code": "preference.displays",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.displays"
    },
    {
        "name": "桌面与程序坞",
        "code": "preference.dock",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.dock"
    },
    {
        "name": "菜单栏",
        "code": "preference.menu.bar",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.general" // 不准
    },
    {
        "name": "Siri",
        "code": "preference.siri",
        "urlScheme": "x-apple.systempreferences:com.apple.Siri-Settings.extension"
    },
    {
        "name": "通知",
        "code": "preference.notifications",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.notifications"
    },
    {
        "name": "声音",
        "code": "preference.sound",
        "urlScheme": "x-apple.systempreferences:com.apple.Sound-Settings.extension"
    },
    {
        "name": "专注模式",
        "code": "preference.focus",
        "urlScheme": "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Focus" // 不准
    },
    {
        "name": "屏幕时间",
        "code": "preference.screentime",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.screentime"
    },
    {
        "name": "锁定屏幕",
        "code": "preference.lock.screen",
        "urlScheme": "x-apple.systempreferences:com.apple.Lock-Screen-Settings"
    },
    {
        "name": "隐私与安全性",
        "code": "preference.security",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.security"
    },
    {
        "name": "触控 ID 与密码",
        "code": "preference.security.touchid",
        "urlScheme": "x-apple.systempreferences:com.apple.Touch-ID-Settings.extension*TouchIDPasswordPrefs"
    },
    {
        "name": "用户与群组",
        "code": "preference.users",
        "urlScheme": "x-apple.systempreferences:com.apple.Users-Groups-Settings.extension"
    },
    {
        "name": "互联网账户",
        "code": "preference.internetaccounts",
        "urlScheme": "x-apple.systempreferences:com.apple.preferences.internetaccounts"
    },
    {
        "name": "Game Center",
        "code": "preference.gamecenter",
        "urlScheme": "x-apple.systempreferences:com.apple.Game-Center-Settings"
    },
    {
        "name": "iCloud",
        "code": "preference.icloud",
        "urlScheme": "x-apple.systempreferences:com.apple.preferences.AppleIDPrefPane?iCloud" // 一点问题
    },
    {
        "name": "Apple账户",
        "code": "preference.appleid",
        "urlScheme": "x-apple.systempreferences:com.apple.systempreferences.AppleIDSettings"
    },
    {
        "name": "钱包与 Apple Pay",
        "code": "preference.wallet",
        "urlScheme": "x-apple.systempreferences:com.apple.preference.wallet" // 不准
    },
    {
        name: '键盘',
        code: 'preference.keyboard',
        urlScheme: 'x-apple.systempreferences:com.apple.preference.keyboard'
    },
    {
        name: '触控板',
        code: 'preference.trackpad',
        urlScheme: 'x-apple.systempreferences:com.apple.preference.trackpad'
    },
    {
        name: '打印机与扫描仪',
        code: 'preference.printfax',
        urlScheme: 'x-apple.systempreferences:com.apple.preference.printfax'
    },
    {
        name: '储存空间',
        code: 'settings.Storage',
        urlScheme: 'x-apple.systempreferences:com.apple.settings.Storage'
    },
    {
        name: '软件更新',
        code: 'settings.SoftwareUpdate',
        urlScheme: 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension'
    },
    {
        name: '登录项',
        code: 'settings.LoginItems',
        urlScheme: 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
    },
    {
        name: '关于本机',
        code: 'about',
        urlScheme: 'x-apple.systempreferences:com.apple.SystemProfiler.AboutExtension'
    },
]

ytools.onPluginEnter(({ code, type, payload }) => {
    console.log('插件/进入', code, type, payload)
    // console.log('md5', md5)
    // return
    // 打开 Mac 显示器设置
    if (code === 'preference.displays') {
        const command = commands.find(c => c.code === code)
        exec(`open "${command.urlScheme}"`, (error) => {
            if (error) {
                console.error('打开显示器设置失败:', error)
            }
        })
    }
    else if (code === 'home') {
        const command = commands.find(c => c.code === code)
        exec(`open "${command.urlScheme}"`, (error) => {
            if (error) {
                console.error('打开主页设置失败:', error)
            }
        })
    }

    ytools.hideMainWindow()
    ytools.outPlugin()
})

window.exports = {
    ...commands.reduce((acc, command) => {
        acc[command.code] = {
            mode: 'none',
            args: {
                enter: (action) => {
                    exec(`open "${command.urlScheme}"`, (error) => {
                        if (error) {
                            console.error('打开失败:', error)
                        }
                        ytools.hideMainWindow()
                        ytools.outPlugin()
                    })
                }
            }
        }
        return acc
    }, {}),
}

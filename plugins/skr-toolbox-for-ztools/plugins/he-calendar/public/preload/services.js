const fs = require('node:fs')
const path = require('node:path')

window.utools = {
    ...window.ztools
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
}

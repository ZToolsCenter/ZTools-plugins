const crypt = require('./crypt')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 加解密服务
  crypt
}

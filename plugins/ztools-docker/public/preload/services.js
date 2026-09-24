// public/preload/services.js
// 通过 window 对象向渲染进程注入 docker / 终端 / 镜像仓库服务能力
const docker = require('./docker.js')
const terminals = require('./terminals.js')
const registry = require('./registry.js')

window.services = { docker, terminals, registry }

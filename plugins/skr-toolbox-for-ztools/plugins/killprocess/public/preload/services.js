const si = require('systeminformation')
const { execSync } = require('node:child_process')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 结束进程
  killProcess(pid) {
    try {
      // 验证 pid 是否为整数，防止命令注入
      if (typeof pid !== 'number' || !Number.isInteger(pid)) {
        return '结束进程失败: 进程 ID 必须为整数'
      }

      // 根据不同操作系统执行不同的命令
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid}`)
      } else {
        process.kill(pid)
      }
      return `进程 ${pid} 已成功结束`
    } catch (error) {
      throw new Error(`结束进程失败: ${error.message}`)
    }
  },
  // 获取进程列表
  async getProcessList() {
    try {
      // 获取所有进程信息
      const processes = await si.processes()
      // 获取端口信息
      const networkConnections = await si.networkConnections()

      const portMap = {}
      networkConnections.forEach(conn => {
        if (conn.state === 'LISTEN' && conn.pid) {
          if (!portMap[conn.pid]) {
            portMap[conn.pid] = []
          }
          // 端口去重
          if (!portMap[conn.pid].includes(conn.localPort)) {
            portMap[conn.pid].push(conn.localPort)
          }
        }
      })

      // 处理进程信息
      const processList = processes.list.map(process => {
        const ports = portMap[process.pid] || []
        return {
          name: process.name,
          pid: process.pid,
          ppid: process.parentPid,
          ports: ports,
          cpu: process.cpu.toFixed(1) + "%",
          memUsage: process.mem.toFixed(1) + "%",
          cwd: process.path,
        }
      })

      // 只保留顶级父进程（PPID 为 0 或 1）
      // const topLevelProcesses = processList.filter(process => {
      //   return process.ppid === 0
      // })

      return processList
    } catch (error) {
      throw new Error(`获取进程列表失败: ${error.message}`)
    }
  }
}

function isPrivateIp(ip) {
  if (!ip) return false
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  const match = ip.match(/^172\.(\d+)\./)
  if (match) {
    const octet = Number(match[1])
    return octet >= 16 && octet <= 31
  }
  if (ip.startsWith('100.64.')) return true
  return false
}

function uniq(values) {
  return Array.from(new Set(values))
}

function isPreferredInterface(name) {
  const lowered = String(name || '').toLowerCase()
  return !/(virtual|vmnet|vbox|docker|bridge|utun|loopback|vethernet)/i.test(
    lowered
  )
}

function getLocalIps() {
  const os = require('os')
  const nets = os.networkInterfaces()
  const preferred = []
  const others = []
  Object.keys(nets).forEach((name) => {
    const addrs = nets[name] || []
    addrs.forEach((addr) => {
      if (addr.family === 'IPv4' && !addr.internal) {
        if (isPreferredInterface(name)) {
          preferred.push(addr.address)
        } else {
          others.push(addr.address)
        }
      }
    })
  })
  return uniq(preferred.concat(others))
}

function copyText(text) {
  if (window.ztools && typeof window.ztools.copyText === 'function') {
    return window.ztools.copyText(text)
  }
  if (
    window.ztools &&
    window.ztools.clipboard &&
    typeof window.ztools.clipboard.writeContent === 'function'
  ) {
    return window.ztools.clipboard.writeContent({ type: 'text', content: text })
  }
  return false
}

function notify(message) {
  if (window.ztools && typeof window.ztools.showNotification === 'function') {
    window.ztools.showNotification(message)
  }
}

function handleEnter() {
  if (window.ztools && typeof window.ztools.hideMainWindow === 'function') {
    window.ztools.hideMainWindow(true)
  }
  const ips = getLocalIps()
  const lanIps = ips.filter(isPrivateIp)
  const targets = lanIps.length ? lanIps : ips
  if (!targets.length) {
    notify('未找到本机内网 IP')
    if (window.ztools && typeof window.ztools.outPlugin === 'function') {
      setTimeout(() => window.ztools.outPlugin(true), 0)
    }
    return
  }
  const text = targets.join('\n')
  const ok = copyText(text)
  if (!ok) {
    notify('复制失败，请重试')
  } else if (targets.length === 1) {
    notify(`已复制内网 IP：${targets[0]}`)
  } else {
    notify(`已复制内网 IP（${targets.length} 条）`)
  }
  if (window.ztools && typeof window.ztools.outPlugin === 'function') {
    setTimeout(() => window.ztools.outPlugin(true), 0)
  }
}

window.exports = {
  ip: {
    mode: 'none',
    args: {
      enter: handleEnter
    }
  }
}

if (window.ztools && typeof window.ztools.onPluginEnter === 'function') {
  window.ztools.onPluginEnter(handleEnter)
}
if (window.ztools && typeof window.ztools.onPluginReady === 'function') {
  window.ztools.onPluginReady(handleEnter)
}

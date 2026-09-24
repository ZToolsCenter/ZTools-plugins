const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execSync, exec } = require('node:child_process')

const ALGORITHM = 'aes-256-cbc'
const SECRET = 'remote-manager-plugin-secret-v1'
const KEY = crypto.createHash('sha256').update(SECRET).digest()

function encryptPassword(pwd) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  let encrypted = cipher.update(pwd, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return `enc:${iv.toString('hex')}:${encrypted}`
}

function _decryptPassword(encryptedText) {
  if (encryptedText.startsWith('enc:')) {
    const parts = encryptedText.split(':')
    if (parts.length !== 3) return encryptedText
    const iv = Buffer.from(parts[1], 'hex')
    const encrypted = parts[2]
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }
  // 兼容旧版本 base64 数据
  try {
    return Buffer.from(encryptedText, 'base64').toString('utf8')
  } catch {
    return encryptedText
  }
}

function docToHost(doc) {
  return {
    id: doc._id,
    address: doc.address,
    username: doc.username,
    password: doc.password,
    order: doc.order ?? 0
  }
}

function getNextOrder(docs) {
  if (!docs || docs.length === 0) return 1
  const maxOrder = Math.max(...docs.map(d => d.order ?? 0))
  return maxOrder + 1
}

window.services = {
  getHosts() {
    try {
      const docs = window.ztools.db.allDocs()
      return docs.map(docToHost).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    } catch {
      return []
    }
  },

  addHost(host) {
    try {
      const existing = window.ztools.db.get(host.id)
      if (existing) {
        return { success: false, error: '编号已存在' }
      }
      const docs = window.ztools.db.allDocs()
      window.ztools.db.put({
        _id: host.id,
        address: host.address,
        username: host.username,
        password: encryptPassword(host.password),
        order: getNextOrder(docs)
      })
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  updateHost(originalId, host) {
    try {
      const oldDoc = window.ztools.db.get(originalId)
      if (!oldDoc) {
        return { success: false, error: '主机不存在' }
      }
      if (host.id !== originalId) {
        const existing = window.ztools.db.get(host.id)
        if (existing) {
          return { success: false, error: '编号已存在' }
        }
        window.ztools.db.remove(originalId)
      }

      const newDoc = {
        _id: host.id,
        address: host.address,
        username: host.username,
        password: host.password === oldDoc.password
          ? host.password
          : encryptPassword(host.password),
        order: host.order ?? oldDoc.order ?? 0
      }
      if (host.id === originalId && oldDoc._rev) {
        newDoc._rev = oldDoc._rev
      }
      window.ztools.db.put(newDoc)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  deleteHost(id) {
    try {
      window.ztools.db.remove(id)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  updateOrder(hosts) {
    try {
      hosts.forEach((host, index) => {
        const doc = window.ztools.db.get(host.id)
        if (doc) {
          window.ztools.db.put({
            ...doc,
            order: index + 1
          })
        }
      })
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  decryptPassword(encryptedText) {
    try {
      return _decryptPassword(encryptedText)
    } catch {
      return ''
    }
  },

  connectRdp(address, username, password) {
    try {
      const decodedPassword = _decryptPassword(password)

      const tempDir = os.tmpdir()
      const rdpFile = path.join(tempDir, `rdp_${Date.now()}.rdp`)

      const rdpContent = [
        `full address:s:${address}`,
        `username:s:${username}`,
        `screen mode id:i:2`,
        `session bpp:i:32`,
        `compression:i:1`,
        `keyboardhook:i:2`,
        `connection type:i:7`,
        `displayconnectionbar:i:1`,
        `allow font smoothing:i:1`,
        `allow desktop composition:i:1`,
        `bitmapcachepersistenable:i:1`,
        `authentication level:i:2`,
        `prompt for credentials:i:0`,
        `negotiate security layer:i:1`,
        `autoreconnection enabled:i:1`
      ].join('\r\n')

      fs.writeFileSync(rdpFile, rdpContent, 'utf-8')

      try {
        execSync(
          `cmdkey /generic:TERMSRV/${address} /user:"${username}" /pass:"${decodedPassword}"`,
          { encoding: 'utf-8' }
        )
      } catch {}

      const mstscPath = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'mstsc.exe')

      exec(`"${mstscPath}" "${rdpFile}"`, () => {})

      setTimeout(() => {
        try {
          execSync(`cmdkey /delete:TERMSRV/${address}`, { encoding: 'utf-8' })
        } catch {}
        try {
          if (fs.existsSync(rdpFile)) {
            fs.unlinkSync(rdpFile)
          }
        } catch {}
      }, 5000)

      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}

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

function decryptPassword(encryptedText) {
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
    password: doc.password
  }
}

window.services = {
  getHosts() {
    try {
      const docs = window.ztools.db.allDocs()
      return docs.map(docToHost)
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
      window.ztools.db.put({
        _id: host.id,
        address: host.address,
        username: host.username,
        password: encryptPassword(host.password)
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
          : encryptPassword(host.password)
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

  connectRdp(address, username, password) {
    try {
      const decodedPassword = decryptPassword(password)

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
      console.log('[RDP] RDP 文件已写入:', rdpFile)

      try {
        const cmdkeyResult = execSync(
          `cmdkey /generic:TERMSRV/${address} /user:"${username}" /pass:"${decodedPassword}"`,
          { encoding: 'utf-8' }
        )
        console.log('[RDP] cmdkey 输出:', cmdkeyResult)
      } catch (cmdErr) {
        console.error('[RDP] cmdkey 失败:', cmdErr.message)
      }

      const mstscPath = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'mstsc.exe')
      console.log('[RDP] 启动 mstsc:', mstscPath, rdpFile)

      exec(`"${mstscPath}" "${rdpFile}"`, (err, stdout, stderr) => {
        if (err) {
          console.error('[RDP] mstsc 启动失败:', err.message)
        } else {
          console.log('[RDP] mstsc 已启动')
        }
      })

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

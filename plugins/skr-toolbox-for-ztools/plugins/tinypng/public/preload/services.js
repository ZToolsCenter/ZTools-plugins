const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')

const imageReg = /\.(png|jpeg|jpg|webp)$/i
const excludeDirReg = /^(\.|node_modules)/i

async function find(rootPath, includeFile, exclude) {
  if (exclude && exclude.test(path.basename(rootPath))) return []
  const root = await fsPromises.stat(rootPath).catch(() => null)
  if (!root) return []
  if (root.isFile() && includeFile.test(rootPath)) return [rootPath]
  if (root.isDirectory()) {
    const files = []
    const dirFiles = await fsPromises.readdir(rootPath)
    for (const it of dirFiles) {
      const children = await find(path.join(rootPath, it), includeFile, exclude)
      files.push(...children)
    }
    return files
  }
  return []
}

const tempPath = path.join(window.ztools.getPath('temp'), 'ztools.tinypng')

window.services = {
  async handlePluginEnter({ code, type, payload }) {
    try {
      console.log('[tinypng] handlePluginEnter:', { code, type, payload })

      const stat = await fsPromises.stat(tempPath).catch(() => null)
      if (!stat || !stat.isDirectory()) await fsPromises.mkdir(tempPath, { recursive: true })

      const date = Date.now()
      const config = {
        date,
        images: [],
        tempdir: path.join(tempPath, String(date))
      }

      const paths = []
      if (['files', 'drop'].includes(type)) {
        const items = Array.isArray(payload) ? payload : []
        paths.push(...items.filter(it => it.path).map(it => it.path))
      }
      console.log('[tinypng] resolved paths:', paths)
      for (const it of paths) {
        if (excludeDirReg.test(path.basename(it))) continue
        const fileType = await fsPromises.stat(it).catch(() => null)
        const images = []
        let basedir = ''

        if (fileType && fileType.isFile()) {
          if (!imageReg.test(it)) continue
          images.push(it)
          basedir = path.dirname(it)
        } else if (fileType && fileType.isDirectory()) {
          basedir = path.dirname(it)
          images.push(...(await find(it, imageReg, excludeDirReg)))
        }

        for (const img of images) {
          const name = img.replace(basedir, '').replace(path.sep, '')
          const nameExist = config.images.some(item => item.name === name)
          if (nameExist) {
            window.ztools.showNotification(`此文件名已被占用："${name}" 跳过处理`)
            continue
          }
          const imgStat = await fsPromises.stat(img)
          config.images.push({
            name,
            path: img,
            size: imgStat.size,
            compress: { path: path.join(config.tempdir, name), progress: 0 }
          })
        }
      }
      if (config.images.length === 0) {
        console.log('[tinypng] no images found, paths were:', paths)
        return
      }

      console.log('[tinypng] dispatching event with', config.images.length, 'images')
      window.dispatchEvent(new CustomEvent('tinyping-compression', { detail: config }))
    } catch (error) {
      window.ztools.showNotification(String(error))
    }
  },

  readFile(p) {
    return fsPromises.readFile(p)
  },

  async writeFile(p, data) {
    const dir = path.dirname(p)
    const stat = await fsPromises.stat(dir).catch(() => null)
    if (!stat || !stat.isDirectory()) await fsPromises.mkdir(dir, { recursive: true })
    return fsPromises.writeFile(p, Buffer.from(data), 'binary')
  },

  async readDir(p) {
    const files = await fsPromises.readdir(p)
    return files.map(it => path.join(p, it))
  },

  async replaceFiles(files) {
    for (const [from, to] of files) {
      await new Promise((res, rej) =>
        fs.createReadStream(from).pipe(fs.createWriteStream(to)).on('close', res).on('error', rej)
      )
    }
  }
}

window.ztools.onPluginEnter((action) => {
  window.services.handlePluginEnter(action)
})

window.ztools.onPluginOut(async (exit) => {
  if (!exit) return
  try {
    const dir = await fsPromises.readdir(tempPath)
    for (const name of dir) {
      const file = path.join(tempPath, name)
      const stat = await fsPromises.stat(file)
      if (stat.isFile()) {
        await fsPromises.unlink(file)
      } else {
        await fsPromises.rm(file, { recursive: true })
      }
    }
  } catch (e) {
    // ignore cleanup errors
  }
})

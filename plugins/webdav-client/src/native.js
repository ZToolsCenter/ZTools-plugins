const { readFile, existsSync, createWriteStream, mkdirSync, readdirSync, statSync } = require('fs')
const nodePath = require('node:path')

module.exports = {
  path: {
    join: (...paths) => nodePath.join(...paths),
    relative: (from, to) => nodePath.relative(from, to),
    dirname: (target) => nodePath.dirname(target),
    basename: (target) => nodePath.basename(target),
    normalize: (target) => nodePath.normalize(target),
    sep: nodePath.sep,
    posix: {
      join: (...paths) => nodePath.posix.join(...paths),
      dirname: (target) => nodePath.posix.dirname(target),
      basename: (target) => nodePath.posix.basename(target),
      normalize: (target) => nodePath.posix.normalize(target)
    }
  },
  process: {
    pid: process.pid
  },
  fs: {
    existsSync: (path) => existsSync(path),
    mkdirSync: (path, options) => mkdirSync(path, options),
    readdirSync: (path, options) => readdirSync(path, options),
    statSync: (path) => statSync(path),
    readTextFile: (path) => {
      return new Promise((resolve, reject) => {
        readFile(path, 'utf-8', (err, data) => {
          if (err) {
            reject(err)
            return
          }
          resolve(data)
        })
      })
    },
    writeTextFile: (path, data) => {
      return new Promise((resolve, reject) => {
        const file = createWriteStream(path)
        file.write(data)
        file.end()
        file.on('finish', () => {
          resolve()
        })
        file.on('error', (err) => {
          reject(err)
        })
      })
    }
  }
}

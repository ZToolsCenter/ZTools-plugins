const fs = require('fs')
const path = require('path')
const { promisify } = require('util')

// 将需要的 fs 方法转换为 Promise 版本
const readFileAsync = promisify(fs.readFile)
const writeFileAsync = promisify(fs.writeFile)
const unlinkAsync = promisify(fs.unlink)

// 定义 preload 对象
const preload = {
  // 文件系统 API
  fs: {
    readFile: async (filePath, encoding) => {
      try {
        return await readFileAsync(filePath, encoding)
      } catch (error) {
        console.error('Failed to read file:', error)
        throw error
      }
    },
    writeFile: async (filePath, data) => {
      try {
        await writeFileAsync(filePath, data)
      } catch (error) {
        console.error('Failed to write file:', error)
        throw error
      }
    },
    unlink: async (filePath) => {
      try {
        await unlinkAsync(filePath)
      } catch (error) {
        console.error('Failed to delete file:', error)
        throw error
      }
    },
    existsSync: (filePath) => {
      try {
        return fs.existsSync(filePath)
      } catch (error) {
        console.error('Failed to check file existence:', error)
        return false
      }
    },
    mkdirSync: (dirPath, options) => {
      try {
        fs.mkdirSync(dirPath, options)
      } catch (error) {
        console.error('Failed to create directory:', error)
        throw error
      }
    },
    readFileSync: (filePath, encoding) => {
      try {
        return fs.readFileSync(filePath, encoding)
      } catch (error) {
        console.error('Failed to read file sync:', error)
        throw error
      }
    },
    readdirSync: (dirPath) => {
      try {
        return fs.readdirSync(dirPath)
      } catch (error) {
        console.error('Failed to read directory:', error)
        throw error
      }
    },
    statSync: (filePath) => {
      try {
        return fs.statSync(filePath)
      } catch (error) {
        console.error('Failed to stat file:', error)
        throw error
      }
    }
  },

  // 工具函数
  utils: {
    getDataPath: (subPath) => {
      try {
        const basePath = window.ztools.getPath('appData')
        return path.join(basePath, 'bqb', subPath)
      } catch (error) {
        console.error('Failed to get data path:', error)
        throw error
      }
    },
    joinPath: (...paths) => {
      try {
        return path.join(...paths)
      } catch (error) {
        console.error('Failed to join paths:', error)
        throw error
      }
    },
    getTempPath: (fileName) => {
      try {
        return path.join(window.ztools.getPath('temp'), fileName)
      } catch (error) {
        console.error('Failed to get temp path:', error)
        throw error
      }
    }
  }
}

// 初始化导出
if (window) {
  window.preload = preload
}

if (module && module.exports) {
  module.exports = preload
}
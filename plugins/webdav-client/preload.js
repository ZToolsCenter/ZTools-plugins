const { readFile, existsSync, createWriteStream, mkdirSync } = require('fs')
const { basename } = require('path')
const { createServer, downloadFile } = require('./src/server')
const { join } = require('node:path')
const InjectAPI = require('./src/inject')
const NativeAPI = require('./src/native')

/**
 * 读取文件
 * @param path {string} 文件路径
 * @return {Promise<Buffer>} 返回文件内容
 */
function readFileAsync(path) {
  return new Promise((resolve, reject) => {
    readFile(path, (err, data) => {
      if (err) {
        reject(err)
        return
      }
      resolve(data)
    })
  })
}

/**
 * 获取一个文件
 * @param options {options: {
 *     title?: string,
 *     defaultPath?: string,
 *     buttonLabel?: string,
 *     filters?: { name: string, extensions: string[] }[],
 *     properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory' | 'dontAddToRecent'>,
 *     message?: string,
 *     securityScopedBookmarks?: boolean
 *   }} 参数
 * @return {Promise<Array<File>>} 返回文件对象
 */
async function openFile(options) {
  const paths = utools.showOpenDialog(options)
  const files = []
  for (const path of paths) {
    const data = await readFileAsync(path)
    const name = basename(path)
    const type = 'application/octet-stream'
    const blob = new Blob([data], { type: type })
    const file = new File([blob], name, { type: type })
    files.push(file)
  }
  return files
}

window.preload = {
  readFileAsync,
  openFile,
  createServer,
  downloadFile,
  ...NativeAPI,
  inject: InjectAPI
}

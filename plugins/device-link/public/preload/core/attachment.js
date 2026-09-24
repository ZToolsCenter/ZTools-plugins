'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { safeFilename } = require('./validation')

async function saveAttachmentFile(attachment, ztoolsApi) {
  const sourcePath = typeof attachment?.path === 'string' ? attachment.path : ''
  if (!sourcePath) return { status: 'missing' }

  try {
    const source = await fs.promises.stat(sourcePath)
    if (!source.isFile()) return { status: 'missing' }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing' }
    throw error
  }

  if (typeof ztoolsApi?.showSaveDialog !== 'function' || typeof ztoolsApi?.getPath !== 'function') {
    throw new Error('宿主保存对话框不可用')
  }

  const destination = await Promise.resolve(ztoolsApi.showSaveDialog({
    title: '保存附件',
    defaultPath: path.join(ztoolsApi.getPath('downloads'), safeFilename(attachment.name)),
    buttonLabel: '保存',
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  }))
  if (!destination) return { status: 'cancelled' }

  if (path.resolve(destination) !== path.resolve(sourcePath)) await fs.promises.copyFile(sourcePath, destination)
  return { status: 'saved', name: path.basename(destination) }
}

module.exports = { saveAttachmentFile }

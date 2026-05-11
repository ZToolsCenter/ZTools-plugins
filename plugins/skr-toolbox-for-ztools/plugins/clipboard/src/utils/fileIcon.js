/**
 * 获取文件/文件夹图标类型
 * @param {object} file - 文件对象 { name, isDirectory }
 * @returns {string} 图标类型 key
 */
export const getFileIconType = (file) => {
  if (file.isDirectory) return 'folder'
  const ext = file.name.split('.').pop()?.toLowerCase()
  const typeMap = {
    'pdf': 'pdf',
    'doc': 'doc',
    'docx': 'doc',
    'xls': 'sheet',
    'xlsx': 'sheet',
    'ppt': 'sheet',
    'pptx': 'sheet',
    'zip': 'archive',
    'gz': 'archive',
    'rar': 'archive',
    '7z': 'archive',
    'tar': 'archive',
    'jpg': 'image',
    'jpeg': 'image',
    'png': 'image',
    'gif': 'image',
    'svg': 'image',
    'webp': 'image',
    'mp4': 'video',
    'mov': 'video',
    'avi': 'video',
    'mkv': 'video',
    'mp3': 'audio',
    'wav': 'audio',
    'flac': 'audio',
    'aac': 'audio'
  }
  return typeMap[ext] || 'file'
}

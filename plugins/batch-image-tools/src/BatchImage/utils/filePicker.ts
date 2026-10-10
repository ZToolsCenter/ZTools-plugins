const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'avif',
  'svg',
  'ico'
]

type OpenDialogOptions = Parameters<typeof ztools.showOpenDialog>[0]

function isRealZTools() {
  return typeof window.ztools?.isDev === 'function'
}

async function resolveDialogResult(
  result: string[] | undefined | Promise<string[] | undefined>
): Promise<string[] | null> {
  const paths = await Promise.resolve(result)
  if (!paths || paths.length === 0) return null
  return paths
}

async function pickWithNativeDialog(options: OpenDialogOptions): Promise<string[] | null> {
  const ztools = window.ztools
  if (!ztools?.showOpenDialog || !isRealZTools()) return null
  return resolveDialogResult(ztools.showOpenDialog(options))
}

function pathsFromFileList(files: FileList | null): string[] {
  if (!files || files.length === 0) return []

  const ztools = window.ztools
  if (!ztools?.getPathForFile) return []

  const paths: string[] = []
  for (const file of files) {
    try {
      const filePath = ztools.getPathForFile(file)
      if (filePath) paths.push(filePath)
    } catch {
      // ignore invalid file entries
    }
  }
  return paths
}

function pickWithFileInput(mode: 'files' | 'directory'): Promise<string[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'

    if (mode === 'files') {
      input.multiple = true
      input.accept = 'image/*'
    } else {
      input.webkitdirectory = true
    }

    const cleanup = () => {
      input.remove()
    }

    input.addEventListener('change', () => {
      const paths = pathsFromFileList(input.files)
      cleanup()
      resolve(paths.length > 0 ? paths : null)
    })

    document.body.appendChild(input)
    input.click()
  })
}

function notifyPickUnavailable() {
  const ztools = window.ztools
  const message = '请在 ZTools 中打开插件以选择本地图片'

  if (ztools?.showNotification && isRealZTools()) {
    ztools.showNotification(message)
    return
  }

  if (import.meta.env.DEV) {
    console.warn(message)
  }
}

export async function pickImageFiles(): Promise<string[] | null> {
  const fromDialog = await pickWithNativeDialog({
    title: '选择图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }]
  })
  if (fromDialog) return fromDialog

  if (isRealZTools()) {
    const fromInput = await pickWithFileInput('files')
    if (fromInput) return fromInput
  }

  notifyPickUnavailable()
  return null
}

export async function pickImageFolder(): Promise<string[] | null> {
  const fromDialog = await pickWithNativeDialog({
    title: '选择文件夹',
    properties: ['openDirectory']
  })
  if (fromDialog) return fromDialog

  if (isRealZTools()) {
    const fromInput = await pickWithFileInput('directory')
    if (fromInput) return fromInput
  }

  notifyPickUnavailable()
  return null
}

export async function pickDirectory(title = '选择目录'): Promise<string | null> {
  const fromDialog = await pickWithNativeDialog({
    title,
    properties: ['openDirectory']
  })
  if (fromDialog?.[0]) return fromDialog[0]

  if (isRealZTools()) {
    const fromInput = await pickWithFileInput('directory')
    if (fromInput?.[0]) {
      const first = fromInput[0]
      const sep = first.includes('\\') ? '\\' : '/'
      const dir = first.slice(0, first.lastIndexOf(sep))
      return dir || null
    }
  }

  notifyPickUnavailable()
  return null
}

export async function pickWatermarkImage(): Promise<string | null> {
  const fromDialog = await pickWithNativeDialog({
    title: '选择水印图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })
  if (fromDialog?.[0]) return fromDialog[0]

  if (isRealZTools()) {
    const fromInput = await pickWithFileInput('files')
    if (fromInput?.[0]) return fromInput[0]
  }

  notifyPickUnavailable()
  return null
}

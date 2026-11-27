/**
 * 在浏览器直接打开 Vite 开发服务器时，注入 ZTools API 桩以便预览 UI。
 * 须延迟安装，避免在 ZTools 注入真实 API 之前覆盖 window.ztools。
 */
export function setupDevMock() {
  if (!import.meta.env.DEV) return

  const install = () => {
    if (typeof window.ztools?.isDev === 'function') return

    if (!window.ztools) {
      const noop = () => {}
      window.ztools = {
        onPluginEnter: noop,
        onPluginOut: noop,
        setExpendHeight: noop,
        showOpenDialog: () => undefined,
        showNotification: (msg: string) => console.info('[dev notification]', msg),
        shellShowItemInFolder: noop,
      } as unknown as typeof ztools
    }

    if (!window.services) {
      window.services = {
        isImageFile: () => false,
        collectImages: () => [],
        saveBase64Image: () => '',
        getImageInfo: async () => ({
          path: '',
          name: '',
          size: 0,
          width: 0,
          height: 0,
          format: '',
        }),
        getThumbnail: async () => '',
        processOne: async (inputPath) => ({
          inputPath,
          success: false,
          error: '请在 ZTools 中打开插件以使用图片处理功能',
        }),
        processMerge: async () => ({
          success: false,
          error: '请在 ZTools 中打开插件以使用图片处理功能',
        }),
        renameOne: async (inputPath) => ({
          inputPath,
          success: false,
          error: '请在 ZTools 中打开插件以使用图片处理功能',
        }),
      }
    }
  }

  if (typeof window.ztools?.isDev === 'function') return

  requestAnimationFrame(() => {
    setTimeout(install, 50)
  })
}

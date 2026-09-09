const getBaseUrl = () => {
  const baseUrl = import.meta.env.BASE_URL || '/'
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

/**
 * 解析插件内置静态资源的访问地址（资源随插件一起打包在 public 目录下）
 */
export const resolveAssetUrl = (assetPath: string) => {
  const normalized = assetPath.replace(/^\/+/, '')
  return `${getBaseUrl()}${normalized.split('/').map(encodeURIComponent).join('/')}`
}

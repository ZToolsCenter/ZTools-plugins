import { resolveAssetUrl } from '@/config/assets'

// 静态图片资源映射 - 包含头像和图标
export const STATIC_IMAGES = {
  '工具箱.png': 'images/工具箱.png',
  '留言墙.png': 'images/留言墙.png',
  'HTML.png': 'images/HTML.png',
  'Markdown.png': 'images/Markdown.png',
  'huha-avatar.png': 'huha-avatar.png'
} as const

// 图片类型定义
export type StaticImageKey = keyof typeof STATIC_IMAGES

/**
 * 获取内置静态图片的访问地址
 * @param imageName 图片名称
 * @returns 插件内静态资源 URL
 */
export const getStaticImageUrl = (imageName: StaticImageKey): string => {
  const assetPath = STATIC_IMAGES[imageName]
  if (!assetPath) {
    console.warn(`Static image not found: ${imageName}`)
    return ''
  }
  return resolveAssetUrl(assetPath)
}

/**
 * 获取所有静态图片的URL映射
 * @returns 包含所有静态图片URL的对象
 */
export const getAllStaticImageUrls = () => {
  const urls: Record<string, string> = {}
  
  Object.keys(STATIC_IMAGES).forEach(imageName => {
    urls[imageName] = getStaticImageUrl(imageName as StaticImageKey)
  })
  
  return urls
}

/**
 * 预加载静态图片
 * @param imageNames 要预加载的图片名称数组，如果不提供则预加载所有图片
 */
export const preloadStaticImages = async (imageNames?: StaticImageKey[]) => {
  const imagesToLoad = imageNames || Object.keys(STATIC_IMAGES) as StaticImageKey[]
  
  const loadPromises = imagesToLoad.map(imageName => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => {
        console.warn(`Failed to preload image: ${imageName}`)
        resolve() // 即使失败也继续，不阻塞其他图片加载
      }
      img.src = getStaticImageUrl(imageName)
    })
  })
  
  try {
    await Promise.all(loadPromises)
    console.log('Static images preloaded successfully')
  } catch (error) {
    console.error('Error preloading static images:', error)
  }
}
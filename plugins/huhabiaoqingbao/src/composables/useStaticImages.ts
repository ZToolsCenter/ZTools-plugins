import { computed } from 'vue'
import { getStaticImageUrl, getAllStaticImageUrls, preloadStaticImages, type StaticImageKey } from '@/services/staticImages'

/**
 * 静态图片管理的组合式函数
 */
export const useStaticImages = () => {
  // 获取单个静态图片URL
  const getImageUrl = (imageName: StaticImageKey) => {
    return computed(() => getStaticImageUrl(imageName))
  }

  // 获取所有静态图片URL
  const allImageUrls = computed(() => getAllStaticImageUrls())

  // 预加载图片
  const preloadImages = async (imageNames?: StaticImageKey[]) => {
    await preloadStaticImages(imageNames)
  }

  return {
    getImageUrl,
    allImageUrls,
    preloadImages,
    getStaticImageUrl
  }
}
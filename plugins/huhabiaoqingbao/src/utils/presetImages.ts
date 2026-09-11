import { resolveAssetUrl } from '@/config/assets'

interface PresetImage {
  url: string
  name: string
  category: string
}

const PRESET_CATEGORIES = ['funny', 'animal', 'face', 'cute']

const fetchPresetImageList = async (category: string): Promise<string[]> => {
  try {
    const response = await fetch(resolveAssetUrl(`preset-images/${category}/index.json`))
    if (!response.ok) {
      throw new Error(`Failed to fetch index.json for ${category}: ${response.statusText}`)
    }

    const files = await response.json()
    return Array.isArray(files) ? files : []
  } catch (error) {
    console.error(`Failed to fetch image list for category ${category}:`, error)
    return []
  }
}

// 获取预设图片列表
export const getPresetImages = async () => {
  const images: Array<PresetImage> = []

  for (const category of PRESET_CATEGORIES) {
    const files = await fetchPresetImageList(category)

    files.forEach((filename: string) => {
      images.push({
        url: resolveAssetUrl(`preset-images/${category}/${filename}`),
        name: filename.replace(/\.[^/.]+$/, ''),
        category
      })
    })
  }

  if (images.length === 0) {
    console.error('No preset images loaded')
  }

  return images
}

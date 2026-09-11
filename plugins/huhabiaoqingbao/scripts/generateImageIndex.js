const fs = require('fs')
const path = require('path')

const PRESET_IMAGES_DIR = path.join(__dirname, '../public/preset-images')

// 支持的图片格式
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif']

// 为每个分类目录生成索引文件
async function generateImageIndex() {
  const categories = ['funny', 'animal', 'face']
  
  for (const category of categories) {
    const categoryPath = path.join(PRESET_IMAGES_DIR, category)
    
    // 确保目录存在
    if (!fs.existsSync(categoryPath)) {
      fs.mkdirSync(categoryPath, { recursive: true })
      console.log(`Created directory for ${category}`)
      continue
    }
    
    // 读取目录中的图片文件
    const files = fs.readdirSync(categoryPath)
      .filter(file => {
        const ext = path.extname(file).toLowerCase()
        return IMAGE_EXTENSIONS.includes(ext)
      })
    
    // 写入索引文件
    const indexPath = path.join(categoryPath, 'index.json')
    fs.writeFileSync(indexPath, JSON.stringify(files, null, 2))
    
    console.log(`Generated index for ${category}: ${files.length} images`)
  }
}

// 执行并处理错误
generateImageIndex().catch(error => {
  console.error('Error generating image index:', error)
  process.exit(1)
}) 
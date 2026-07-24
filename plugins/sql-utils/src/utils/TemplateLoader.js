/**
 * 模板加载器
 * 用于在应用启动时加载所有模板文件，并提供访问接口
 */

// 使用raw-loader导入模板文件
import javaEntityTemplate from '@/templates/javaEntity.hbs?raw'
import mapperTemplate from '@/templates/mapper.hbs?raw'
import mapperXmlTemplate from '@/templates/mapperXml.hbs?raw'
import javaServiceTemplate from '@/templates/javaService.hbs?raw'
import javaControllerTemplate from '@/templates/javaController.hbs?raw'

class TemplateLoader {
  constructor() {
    this.templates = {}
    this.isLoaded = false
  }

  /**
   * 加载所有模板文件
   * @returns {Promise<Object>} 包含所有模板内容的对象
   */
  async loadAllTemplates() {
    if (this.isLoaded) {
      return this.templates
    }

    try {
      this.templates = {
        'javaBean': javaEntityTemplate,
        'mapper': mapperTemplate,
        'mapperXML': mapperXmlTemplate,
        'service': javaServiceTemplate,
        'controller': javaControllerTemplate
      }

      this.isLoaded = true
      return this.templates
    } catch (error) {
      console.error('加载模板失败:', error)
      throw new Error('模板加载失败，请确保模板文件存在且格式正确')
    }
  }

  /**
   * 获取指定类型的模板内容
   * @param {string} templateType 模板类型
   * @returns {string} 模板内容
   */
  getTemplate(templateType) {
    if (!this.isLoaded) {
      console.warn('模板尚未加载，请先调用 loadAllTemplates()');
      return `// 模板尚未加载`;
    }

    return this.templates[templateType] || `// 未找到模板类型: ${templateType}`
  }

  /**
   * 获取指定类型的原始模板内容
   * @param {string} templateType 模板类型
   * @returns {string} 原始模板内容
   */
  getRawTemplate(templateType) {
    return this.getTemplate(templateType)
  }

  /**
   * 获取所有模板内容
   * @returns {Object} 包含所有模板内容的对象
   */
  getAllTemplates() {
    if (!this.isLoaded) {
      console.warn('模板尚未加载，请先调用 loadAllTemplates()')
      return {}
    }

    return { ...this.templates }
  }

  /**
   * 检查模板是否已加载
   * @returns {boolean} 是否已加载
   */
  isTemplatesLoaded() {
    return this.isLoaded
  }
}

// 创建单例实例
const templateLoader = new TemplateLoader()

export default templateLoader
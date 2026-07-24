/**
 * 简化版模板管理器
 * 統一管理所有代码生成模板，替代原有的TemplateFactory/TemplateManager/TemplateLoader多层架构
 */

// 定义常量
const TEMPLATE_VERSIONS_STORAGE_KEY = 'templateVersionsByType';
const SYSTEM_TEMPLATE_PREFIX = 'system-';
const ACTIVE_TEMPLATE_VERSION_PREFIX = 'activeTemplateVersion_';

import {templateConfigs, templateHelpers} from '@/config/templateConfig';
import templateLoader from './TemplateLoader';

class SimpleTemplateManager {
  constructor() {
    // 存储系统默认模板内容
    this.systemTemplates = {};
    // 存储当前使用的模板内容（可能是系统默认或自定义）
    this.currentTemplates = {};
    // Handlebars工具实例
    this.handlebarsUtil = null;
    // 字符串工具实例
    this.strUtil = null;

    // 初始化模板配置
    this.templateConfigs = {};
    templateConfigs.forEach(config => {
      this.templateConfigs[config.key] = config;
    });
  }

  /**
   * 设置工具实例
   * @param {Object} handlebarsUtil Handlebars工具实例
   * @param {Object} strUtil 字符串工具实例
   */
  setUtils(handlebarsUtil, strUtil) {
    this.handlebarsUtil = handlebarsUtil;
    this.strUtil = strUtil;
    // 设置工具实例后立即注册助手函数
    this.registerHelpers();
  }

  /**
   * 初始化系统默认模板
   * @returns {Promise<void>}
   */
  async initSystemTemplates() {
    try {
      // 确保模板已加载
      await templateLoader.loadAllTemplates();

      // 获取所有模板内容
      const allTemplates = templateLoader.getAllTemplates();

      // 保存系统默认模板
      this.systemTemplates = {...allTemplates};
      this.currentTemplates = {...allTemplates};
    } catch (error) {
      console.error('初始化系统默认模板失败:', error);
      throw error;
    }
  }

  /**
   * 从localStorage获取模板版本信息
   */
  getTemplateVersionsFromStorage(templateType) {
    try {
      const savedVersions = localStorage.getItem(TEMPLATE_VERSIONS_STORAGE_KEY);
      if (savedVersions) {
        const templateVersions = JSON.parse(savedVersions);
        return templateVersions[templateType] || [];
      }
    } catch (error) {
      console.error('从localStorage获取模板版本信息失败:', error);
    }
    return [];
  }

  /**
   * 从localStorage获取当前选中的模板版本
   */
  getActiveTemplateVersionFromStorage(templateType) {
    try {
      return localStorage.getItem(`${ACTIVE_TEMPLATE_VERSION_PREFIX}${templateType}`);
    } catch (error) {
      console.error('从localStorage获取当前选中的模板版本失败:', error);
    }
    return null;
  }

  /**
   * 获取所有模板配置
   * @returns {Array} 模板配置列表
   */
  getAllTemplateConfigs() {
    return Object.entries(this.templateConfigs).map(([key, config]) => ({
      key,
      ...config
    }));
  }

  /**
   * 获取指定模板的配置
   * @param {string} key 模板键
   * @returns {Object} 模板配置
   */
  getTemplateConfig(key) {
    return this.templateConfigs[key];
  }

  /**
   * 获取指定模板的选项
   * @param {string} key 模板键
   * @returns {Array} 模板选项列表
   */
  getTemplateOptions(key) {
    const config = this.templateConfigs[key];
    return config ? config.options : [];
  }

  /**
   * 注册助手函数
   */
  registerHelpers() {
    if (!this.handlebarsUtil || !this.strUtil) {
      console.warn('Handlebars工具或字符串工具未设置');
      return;
    }

    const helpers = {};
    Object.keys(templateHelpers).forEach(key => {
      if (key === 'fullPackage') {
        // fullPackage 不需要特殊处理，因为它已经在模板数据中计算好了
        helpers[key] = function() {
          // 直接从模板数据中获取 fullPackage
          return this.fullPackage || '';
        };
      } else if (key === 'upperCamelTableName') {
        // 特殊处理 upperCamelTableName，直接从模板数据中获取
        helpers[key] = function() {
          return this.upperCamelTableName || '';
        };
      } else if (key === 'lowerCamelTableName') {
        // 特殊处理 lowerCamelTableName，直接从模板数据中获取
        helpers[key] = function() {
          return this.lowerCamelTableName || '';
        };
      } else {
        helpers[key] = (value) => {
          if (typeof templateHelpers[key] === 'function') {
            // 创建一个包含strUtil的上下文对象
            const context = { $strUtil: this.strUtil };
            return templateHelpers[key].call(context, value);
          }
          return templateHelpers[key];
        };
      }
    });

    // 注册助手函数
    this.handlebarsUtil.registerHelpers(helpers);
  }

  /**
   * 切换模板版本
   * @param {string} templateType 模板类型
   * @param {string} versionId 版本ID
   */
  switchTemplateVersion(templateType, versionId) {
    // 获取所有版本（包括系统默认模板和用户自定义模板）
    const allVersions = this.getTemplateVersions(templateType);
    
    // 根据版本ID找到对应的版本对象
    const version = allVersions.find(v => v.id === versionId);
    if (version) {
      // 如果选中的不是系统默认模板，需要加载自定义模板内容
      if (!version.id.startsWith(SYSTEM_TEMPLATE_PREFIX)) {
        this.currentTemplates[templateType] = version.content;
      } else {
        // 如果是系统默认模板，使用系统默认内容
        this.currentTemplates[templateType] = this.systemTemplates[templateType];
      }
      
      // 保存选中的模板版本到localStorage
      try {
        localStorage.setItem(`${ACTIVE_TEMPLATE_VERSION_PREFIX}${templateType}`, versionId);
      } catch (error) {
        console.error('保存当前选中的模板版本失败:', error);
      }
      
      return true;
    }
    return false;
  }

  /**
   * 渲染模板
   * @param {string} key 模板键
   * @param {Object} data 数据
   * @returns {string} 渲染结果
   */
  renderTemplate(key, data) {
    const templateContent = this.currentTemplates[key];
    if (!templateContent) {
      throw new Error(`模板 ${key} 不存在`);
    }

    // 使用handlebarsUtil渲染
    return this.handlebarsUtil.renderTemplate(templateContent, data);
  }

  /**
   * 获取模板版本列表
   * @param {string} templateType 模板类型
   * @returns {Array} 版本列表
   */
  getTemplateVersions(templateType) {
    // 总是包含系统默认模板
    const systemDefaultVersion = {
      id: SYSTEM_TEMPLATE_PREFIX + templateType,
      name: '默认',
      description: '系统默认模板，不可删除',
      isSystemDefault: true,
      createTime: new Date().toLocaleString(),
      content: this.systemTemplates[templateType] || ''
    };
    
    // 获取用户自定义的模板版本
    const customVersions = this.getTemplateVersionsFromStorage(templateType);
    
    // 返回系统默认模板加上用户自定义版本
    return [systemDefaultVersion, ...customVersions];
  }

  /**
   * 获取当前选中的模板版本
   * @param {string} templateType 模板类型
   * @returns {string} 版本ID
   */
  getActiveTemplateVersion(templateType) {
    const activeVersion = this.getActiveTemplateVersionFromStorage(templateType);

    // 如果localStorage中没有激活的版本，则默认使用系统默认模板
    if (!activeVersion) {
      return SYSTEM_TEMPLATE_PREFIX + templateType;
    }

    return activeVersion;
  }

  /**
   * 判断是否为系统默认模板
   * @param {string} versionId 版本ID
   * @returns {boolean} 是否为系统默认模板
   */
  isSystemDefaultVersion(versionId) {
    return versionId && versionId.startsWith(SYSTEM_TEMPLATE_PREFIX);
  }

  /**
   * 插入或更新模板版本
   * @param {string} templateType 模板类型
   * @param {Object} templateVersion 模板版本对象
   * @returns {boolean} 操作是否成功
   */
  upsertTemplateVersion(templateType, templateVersion) {
    if (!templateType || !templateVersion || !templateVersion.id) {
      console.error('模板类型或版本信息不完整');
      return false;
    }

    // 验证是否尝试保存系统默认模板（不应该发生，但作为保护措施）
    if (templateVersion.id.startsWith(SYSTEM_TEMPLATE_PREFIX)) {
      console.error('不能修改系统默认模板');
      return false;
    }

    try {
      // 从localStorage获取现有的模板版本数据
      let templateVersionsByType = {};
      const savedVersions = localStorage.getItem(TEMPLATE_VERSIONS_STORAGE_KEY);
      if (savedVersions) {
        templateVersionsByType = JSON.parse(savedVersions);
      }

      // 确保当前模板类型存在
      if (!templateVersionsByType[templateType]) {
        templateVersionsByType[templateType] = [];
      }

      // 查找并更新模板或添加新模板（只处理用户自定义模板）
      const versions = templateVersionsByType[templateType];
      const index = versions.findIndex(v => v.id === templateVersion.id && !v.id.startsWith(SYSTEM_TEMPLATE_PREFIX));
      if (index !== -1) {
        // 更新现有版本
        versions[index] = {...templateVersion};
      } else {
        // 添加新版本（确保不是系统默认模板）
        if (!templateVersion.id.startsWith(SYSTEM_TEMPLATE_PREFIX)) {
          versions.push({...templateVersion});
        }
      }

      // 保存到localStorage
      localStorage.setItem(TEMPLATE_VERSIONS_STORAGE_KEY, JSON.stringify(templateVersionsByType));
      return true;
    } catch (error) {
      console.error('保存模板版本失败:', error);
      return false;
    }
  }

  /**
   * 删除模板版本
   * @param {string} templateType 模板类型
   * @param {string} versionId 版本ID
   * @returns {boolean} 操作是否成功
   */
  deleteTemplateVersion(templateType, versionId) {
    if (!templateType || !versionId) {
      console.error('模板类型或版本ID不能为空');
      return false;
    }

    // 系统默认模板不能删除
    if (versionId.startsWith(SYSTEM_TEMPLATE_PREFIX)) {
      console.error('不能删除系统默认模板');
      return false;
    }

    try {
      // 从localStorage获取现有的模板版本数据
      const savedVersions = localStorage.getItem(TEMPLATE_VERSIONS_STORAGE_KEY);
      if (!savedVersions) {
        return true; // 没有保存的数据，无需删除
      }

      const templateVersionsByType = JSON.parse(savedVersions);

      // 确保当前模板类型存在
      if (!templateVersionsByType[templateType]) {
        return true; // 该模板类型没有保存的数据，无需删除
      }

      // 过滤掉要删除的版本
      templateVersionsByType[templateType] = templateVersionsByType[templateType].filter(
        v => v.id !== versionId
      );

      // 保存到localStorage
      localStorage.setItem(TEMPLATE_VERSIONS_STORAGE_KEY, JSON.stringify(templateVersionsByType));
      return true;
    } catch (error) {
      console.error('删除模板版本失败:', error);
      return false;
    }
  }
}

// 创建单例实例
const simpleTemplateManager = new SimpleTemplateManager();

// 导出常量
export { TEMPLATE_VERSIONS_STORAGE_KEY, SYSTEM_TEMPLATE_PREFIX, ACTIVE_TEMPLATE_VERSION_PREFIX };
export default simpleTemplateManager;
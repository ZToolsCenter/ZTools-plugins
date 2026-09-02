/**
 * ChangelogManager - 更新日志管理器
 *
 * 管理版本更新记录的渲染与展示。
 */

class ChangelogManager {
  constructor() {
    this.versions = [
      {
        version: '1.2.0',
        date: '2026-08-23',
        changes: {
          added: [],
          adjusted: [
            '将搜索框改为平台原生子输入框，提升搜索体验',
            '重新设计搜索选项卡样式，采用药丸式设计更紧凑美观',
            '将搜索选项卡与添加按钮合并为一行，节省页面空间'
          ],
          fixed: [],
          improved: [
            '同一表情包同时存在于本地和云端时，列表中只展示一次，优先保留本地版本'
          ],
          added: [
            '支持分别删除本地或云端的表情包，同时存在于两端时可选择仅删除其一或全部删除'
          ],
          removed: [
            '移除了首页自定义搜索框及相关样式，改用平台原生搜索'
          ]
        }
      },
      {
        version: '1.1.2',
        date: '2026-08-23',
        changes: {
          added: [
            '增加了表情详情中点击图片放大查看的功能'
          ],
          adjusted: [],
          fixed: [],
          improved: [],
          removed: []
        }
      },
      {
        version: '1.1.1',
        date: '2026-08-23',
        changes: {
          added: [],
          adjusted: [],
          fixed: [
            '修复了部分情况下添加表情包后自动跳转到"我的"页面',
            '修复了首次启动或云端数据不存在时本地表情包被意外清空的问题',
            '修复了首次保存云端表情包时因文档不存在导致的 404 错误',
            '修复了首次保存设置时因文档不存在导致的 404 错误'
          ],
          improved: [],
          removed: [
            '移除了部分不需要的文件'
          ]
        }
      },
      {
        version: '1.1.0',
        date: '2026-05-18',
        changes: {
          added: [
            '增加了云端存储功能',
            '增加了同步删除本地表情功能',
            '增加了遇见搜索接口功能',
          ],
          adjusted: [],
          fixed: [],
          improved: [
            '优化了部分情况下网络请求超时、图片复制错误时的处理',
            '优化了部分ui样式和交互细节'
          ],
          removed: []
        }
      },
      {
        version: '1.0.0',
        date: '2026-05-15',
        changes: {
          added: [
            '发布了第一个版本~',
          ],
          adjusted: [],
          fixed: [],
          improved: [],
          removed: []
        }
      }
    ];

    this.categories = [
      { key: 'added', title: '新增', className: 'new', icon: 'mdi-plus-circle' },
      { key: 'adjusted', title: '调整', className: 'adjusted', icon: 'mdi-tune' },
      { key: 'fixed', title: '修复', className: 'fix', icon: 'mdi-bug' },
      { key: 'improved', title: '优化', className: 'improve', icon: 'mdi-check-circle' },
      { key: 'removed', title: '去除', className: 'removed', icon: 'mdi-minus-circle' }
    ];
  }

  renderVersion(versionData) {
    let changesHtml = '';

    this.categories.forEach(category => {
      const items = versionData.changes[category.key];
      if (items && items.length > 0) {
        const itemList = items.map(item => `<li>${item}</li>`).join('');
        changesHtml += `
          <div class="change-category">
            <h5 class="change-category-title ${category.className}">
              <i class="mdi ${category.icon}"></i>
              ${category.title}
            </h5>
            <ul class="change-list">
              ${itemList}
            </ul>
          </div>
        `;
      }
    });

    return `
      <div class="changelog-version">
        <div class="version-header">
          <h4 class="version-tag">
            <i class="mdi mdi-new-box"></i>
            版本 ${versionData.version}
          </h4>
          <span class="version-date">${versionData.date}</span>
        </div>
        <div class="version-changes">
          ${changesHtml}
        </div>
      </div>
    `;
  }

  renderAll() {
    return this.versions.map(v => this.renderVersion(v)).join('');
  }

  addVersion(version, date, changes) {
    this.versions.unshift({ version, date, changes });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChangelogManager;
}

class ChangelogManager {
    constructor() {
        this.versions = [
            {
                version: '1.1.0',
                date: '2026-05-18',
                changes: {
                    added: [
                    ],
                    adjusted: [],
                    fixed: ['修复了部分情况下添加表情包后自动跳转到“我的”页面'],
                    improved: [],
                    removed: []
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
                    improved: ['优化了部分情况下网络请求超时、图片复制错误时的处理','优化了部分ui样式和交互细节'],
                    removed: []
                }
            },{
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
                const itemList = items.map(item => 
                    `<li>${item}</li>`
                ).join('');
                
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

window.changelogManager = new ChangelogManager();

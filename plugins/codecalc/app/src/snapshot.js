import { setTag, restoreTag } from './tag.js';
import { notification, showTooltip, hideTooltip } from './notification.js';
import { isMacOS, storage } from './host.js';

export class Snapshot {
    // 定义最多保存的快照数量
    static MAX_SNAPSHOTS = 21;

    // 定义最多保存的历史记录数量
    static MAX_HISTORY = 10;

    constructor() {
        this.storage = storage;
        // 打印使用的存储适配器
        // console.log('使用的存储适配器:', this.storage);
        this.panel = document.getElementById('snapshot-panel');
        this.list = this.panel.querySelector('.snapshot-list');
        this.isPanelVisible = false;
        this.snapshots = []; // 存储所有快照
        this.tooltipTimer = null;
        
        // 创建蒙版元素
        this.overlay = document.createElement('div');
        this.overlay.className = 'snapshot-overlay';
        document.body.appendChild(this.overlay);
        
        // 添加蒙版点击事件
        this.overlay.addEventListener('click', () => {
            this.togglePanel();
        });
        
        // 添加 ESC 键监听
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isPanelVisible) {
                e.preventDefault();
                e.stopPropagation();
                this.togglePanel();
            }
        });

        // 尝试从 localStorage 加载历史快照
        this.loadSnapshots();
        
        // 获取添加快照按钮
        this.addButton = this.panel.querySelector('.add-snapshot-btn');
        
        // 添加点击事件监听
        this.addButton.addEventListener('click', () => {
            this.takeSnapshot();
        });
        
        // 初始化按钮状态
        this.updateAddButtonState();
        
        // 监听表达式变化
        document.addEventListener('input', () => {
            this.updateAddButtonState();
        });
        
        // 添加切换按钮点击事件
        const toggleBtn = document.querySelector('.snapshot-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.togglePanel();
            });
        }

        // 快照列表内的按钮 tooltip（恢复 / 删除）
        this.list.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.apply-snapshot-btn, .delete-snapshot-btn');
            if (!target) return;

            const text = target.dataset.tooltip;
            if (!text) return;

            if (this.tooltipTimer) {
                clearTimeout(this.tooltipTimer);
            }

            this.tooltipTimer = setTimeout(() => {
                // 若按钮已移除或鼠标已不在按钮上，不显示 tooltip，避免残留在左上角
                if (!target.isConnected || !target.matches(':hover')) {
                    return;
                }
                const rect = target.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.bottom + 8;
                showTooltip(text, x, y);
            }, 260);
        });

        this.list.addEventListener('mouseout', (e) => {
            const from = e.target.closest('.apply-snapshot-btn, .delete-snapshot-btn');
            if (!from) return;

            const related = e.relatedTarget;
            if (related && related.closest && related.closest('.apply-snapshot-btn, .delete-snapshot-btn') === from) {
                return;
            }

            if (this.tooltipTimer) {
                clearTimeout(this.tooltipTimer);
                this.tooltipTimer = null;
            }
            hideTooltip();
        });
    }

    clearActionTooltip() {
        if (this.tooltipTimer) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = null;
        }
        hideTooltip();
    }
    
    // 保存当前页面所有表达式的状态
    // 传入参数：区分快照还是记录
    takeSnapshot(isSnapshot = true) {
        // 添加这行来追踪调用来源
        // console.log('takeSnapshot called from:', new Error().stack);

        // 如果按钮被禁用，直接返回
        if (this.addButton.disabled) {
            return;
        }
        
        // 将快照分为两组
        const snapshots = this.snapshots.filter(s => s.isSnapshot);
        const histories = this.snapshots.filter(s => !s.isSnapshot);
        
        // 检查数量限制
        if (isSnapshot && snapshots.length >= Snapshot.MAX_SNAPSHOTS) {
            this.showMessage(`最多只能保存 ${Snapshot.MAX_SNAPSHOTS} 个快照，请删除后再试`);
            return;
        }
        
        const lines = document.querySelectorAll('.expression-line');
        const state = Array.from(lines).map(line => {
            const input = line.querySelector('.input');
            const result = line.querySelector('.result-value');
            const tagElement = line.querySelector('.tag');
            const tag = tagElement ? tagElement.textContent : '';

            return {    
                expression: input.value,
                result: result.textContent,
                tag: tag
            };
        }).filter(item => item.expression.trim() !== '');
        
        // 只有当有计算记录时才创建快照
        if (state.length > 0) {
            const snapshot = {
                timestamp: new Date().toISOString(),
                records: state,
                json: JSON.stringify(state),
                isSnapshot: isSnapshot,
                title: this.formatTime(new Date()),
            };
            
            // 根据类型添加
            if (isSnapshot) {
                snapshots.unshift(snapshot);
            } else {
                histories.unshift(snapshot);
                if (histories.length > Snapshot.MAX_HISTORY) {
                    histories.pop(); // 历史记录仍然保持限制数量
                }
            }
            
            // 合并快照和历史记录
            this.snapshots = [...snapshots, ...histories];
            
            this.saveSnapshots();
            
            // 渲染列表时强制激活快照 tab
            this.renderList('snapshot');  // 添加参数来指定要激活的 tab
        }
        else{
            this.showMessage('当前页面没有计算记录，无法创建快照');
            this.updateAddButtonState();
        }
    }
    
    // 清空快照面板
    clearSnapshots() {
        this.snapshots = [];
        this.list.innerHTML = '';
        // 从存储中移除数据
        this.storage.removeItem('calculatorSnapshots');
    }
    
    // 渲染快照列表
    renderList(activeTabName = null) {
        // 如果没有指定要激活的 tab，则保持当前激活的 tab
        const activeTab = activeTabName || this.list.querySelector('.tab.active')?.getAttribute('data-tab') || 'snapshot';
        
        this.list.innerHTML = '';
        
        // 创建 tab 容器
        const tabContainer = document.createElement('div');
        tabContainer.className = 'snapshot-tabs';
        tabContainer.innerHTML = `
            <div class="tab ${activeTab === 'snapshot' ? 'active' : ''}" data-tab="snapshot">快照</div>
            <div class="tab ${activeTab === 'history' ? 'active' : ''}" data-tab="history">历史</div>
        `;
        
        // 创建内容容器
        const contentContainer = document.createElement('div');
        contentContainer.className = 'snapshot-content-container';
        
        // 将快照分为两组
        const snapshots = this.snapshots.filter(s => s.isSnapshot);
        const histories = this.snapshots.filter(s => !s.isSnapshot);
        
        // 渲染快照组
        const snapshotContainer = document.createElement('div');
        snapshotContainer.className = `tab-content ${activeTab === 'snapshot' ? 'active' : ''}`;
        snapshotContainer.setAttribute('data-tab', 'snapshot');
        snapshots.forEach(snapshot => {
            this.renderSnapshotItem(snapshot, snapshotContainer);
        });
        
        // 渲染历史组
        const historyContainer = document.createElement('div');
        historyContainer.className = `tab-content ${activeTab === 'history' ? 'active' : ''}`;
        historyContainer.setAttribute('data-tab', 'history');
        histories.forEach(snapshot => {
            this.renderSnapshotItem(snapshot, historyContainer);
        });
        
        // 添加 tab 切换事件
        tabContainer.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;
            
            // 创建涟漪效果
            const ripple = document.createElement('div');
            ripple.className = 'ripple';
            
            // 计算涟漪位置
            const rect = tab.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            
            tab.appendChild(ripple);
            
            // 动画结束后移除涟漪元素
            ripple.addEventListener('animationend', () => {
                ripple.remove();
            });
            
            // 更新 tab 激活状态
            tabContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // 更新内容显示
            const tabName = tab.getAttribute('data-tab');
            contentContainer.querySelectorAll('.tab-content').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-tab') === tabName);
            });
        });
        
        // 组装结构
        contentContainer.appendChild(snapshotContainer);
        contentContainer.appendChild(historyContainer);
        this.list.appendChild(tabContainer);
        this.list.appendChild(contentContainer);
    }
    
    // 抽取渲染单个快照项的逻辑为独立方法
    renderSnapshotItem(snapshot, container) {
        const snapshotElement = document.createElement('div');
        snapshotElement.className = 'snapshot-group collapsed';
        snapshotElement.setAttribute('data-type', snapshot.isSnapshot ? 'snapshot' : 'history');
        
        const headerContainer = document.createElement('div');
        headerContainer.className = 'snapshot-header';
        
        // 添加展开/折叠图标
        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'toggle-icon';
        toggleIcon.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M7 10l5 5 5-5z" fill="currentColor"/>
            </svg>
        `;
        
        // 添加时间标题
        const timeHeader = document.createElement('div');
        timeHeader.className = 'snapshot-time';
        timeHeader.innerHTML = `
            <span class="snapshot-type-icon">
                ${snapshot.isSnapshot ? 
                    `<svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" fill="currentColor"/>
                    </svg>` : 
                    `<svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="currentColor"/>
                    </svg>`
                }
            </span>
            <span class="snapshot-title">${snapshot.title || this.formatTime(new Date(snapshot.timestamp))}</span>
            <input type="text" class="snapshot-title-input" value="${snapshot.title || ''}" placeholder="${this.formatTime(new Date(snapshot.timestamp))}">
        `;
        
        // 添加标题编辑功能
        const titleSpan = timeHeader.querySelector('.snapshot-title');
        const titleInput = timeHeader.querySelector('.snapshot-title-input');
        
        titleSpan.onclick = (e) => {
            e.stopPropagation();
            timeHeader.classList.add('editing');
            titleInput.value = snapshot.title || '';
            titleInput.focus();
        };
        
        titleInput.onblur = () => {
            timeHeader.classList.remove('editing');
            const newTitle = titleInput.value.trim();
            if (newTitle) {
                snapshot.title = newTitle;
                titleSpan.textContent = newTitle;
            } else {
                titleSpan.textContent = this.formatTime(new Date(snapshot.timestamp));
                delete snapshot.title;
            }
            this.saveSnapshots();
        };
        
        titleInput.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                titleInput.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                timeHeader.classList.remove('editing');
                titleInput.value = snapshot.title || '';
            }
        };
        
        // 添加应用按钮
        const applyButton = document.createElement('button');
        applyButton.className = 'apply-snapshot-btn';
        applyButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M13 3c-4.97 0-9 4.03-9 9H1l4 3.99L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9" fill="currentColor"/>
            </svg>
        `;
        applyButton.dataset.tooltip = '恢复此快照';
        applyButton.onclick = (e) => {
            e.stopPropagation();
            this.clearActionTooltip();
            this.applySnapshot(snapshot.records);
        };
        
        // 添加删除按钮
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-snapshot-btn';
        deleteButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
            </svg>
        `;
        deleteButton.dataset.tooltip = '删除此快照';
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            this.clearActionTooltip();
            
            // 获取要删除的快照组元素
            const groupElement = snapshotElement;
            const container = groupElement.parentElement;
            
            // 记录所有其他元素的初始位置
            const siblings = Array.from(container.children).filter(el => el !== groupElement);
            const positions = siblings.map(el => {
                const rect = el.getBoundingClientRect();
                return { el, top: rect.top };
            });
            
            // 添加删除动画类
            groupElement.classList.add('deleting');
            
            // 监听删除动画结束
            groupElement.addEventListener('animationend', () => {
                // 移除元素
                groupElement.style.display = 'none';
                
                // 记录其他元素的新位置并计算位移
                positions.forEach(({ el, top }) => {
                    const newTop = el.getBoundingClientRect().top;
                    const delta = top - newTop;
                    
                    // 设置初始位置
                    el.style.transform = `translateY(${delta}px)`;
                    el.style.transition = 'none';
                    
                    // 触发重排
                    void el.offsetHeight;
                    
                    // 添加过渡并移动到最终位置
                    el.style.transition = 'transform 300ms cubic-bezier(0.4, 0.0, 0.2, 1)';
                    el.style.transform = '';
                });
                
                // 等待位移动画完成后再实际删除元素和更新数据
                setTimeout(() => {
                    groupElement.remove();
                    this.snapshots = this.snapshots.filter(s => s.timestamp !== snapshot.timestamp);
                    this.saveSnapshots();
                    
                    // 清理样式
                    positions.forEach(({ el }) => {
                        el.style.transform = '';
                        el.style.transition = '';
                    });
                }, 300);
            }, { once: true });
        };
        
        // 更新头部组装顺序
        headerContainer.appendChild(toggleIcon);
        headerContainer.appendChild(timeHeader);
        headerContainer.appendChild(applyButton);
        headerContainer.appendChild(deleteButton);
        
        // 添加内容容器
        const contentContainer = document.createElement('div');
        contentContainer.className = 'snapshot-content';
        
        // 添加表达式和结果
        snapshot.records.forEach((record, recordIndex) => {
            const itemElement = document.createElement('div');
            itemElement.className = 'snapshot-item';
            itemElement.innerHTML = `
                <div class="snapshot-expression">
                    ${record.tag ? `<span class="snapshot-tag">${record.tag}</span>` : ''}
                    ${record.expression}
                </div>
                <div class="snapshot-result">${record.result}</div>
            `;
            
            contentContainer.appendChild(itemElement);
        });
        
        // 添加点击展开/折叠功能
        headerContainer.addEventListener('click', (e) => {
            // 如果点击的是标题输入框或标题文本，不触发折叠/展开
            if (e.target.classList.contains('snapshot-title') || 
                e.target.classList.contains('snapshot-title-input')) {
                return;
            }

            const content = snapshotElement.querySelector('.snapshot-content');
            const isCollapsed = snapshotElement.classList.contains('collapsed');
            
            // 如果正在动画中，不处理点击
            if (content.classList.contains('animating') || 
                content.classList.contains('collapsing')) {
                return;
            }

            if (isCollapsed) {
                // 展开动画
                content.style.display = 'block';
                // 获取内容实际高度
                const height = content.offsetHeight;
                content.classList.add('animating');
                
                // 记录其他元素的初始位置
                const siblings = Array.from(container.children)
                    .filter(el => el !== snapshotElement && el.offsetTop > snapshotElement.offsetTop);
                const positions = siblings.map(el => {
                    const rect = el.getBoundingClientRect();
                    return { el, top: rect.top };
                });

                content.addEventListener('animationend', () => {
                    content.classList.remove('animating');
                    snapshotElement.classList.remove('collapsed');
                    
                    // 处理其他元素的位移
                    positions.forEach(({ el, top }) => {
                        const newTop = el.getBoundingClientRect().top;
                        const delta = top - newTop;
                        
                        // 设置初始位置
                        el.style.transform = `translateY(${delta}px)`;
                        el.style.transition = 'none';
                        
                        // 触发重排
                        void el.offsetHeight;
                        
                        // 添加过渡并移动到最终位置
                        el.style.transition = 'transform 300ms cubic-bezier(0.4, 0.0, 0.2, 1)';
                        el.style.transform = '';
                        
                        // 清理样式
                        setTimeout(() => {
                            el.style.transform = '';
                            el.style.transition = '';
                        }, 300);
                    });
                }, { once: true });
            } else {
                // 折叠动画
                content.classList.add('collapsing');
                
                // 记录其他元素的初始位置
                const siblings = Array.from(container.children)
                    .filter(el => el !== snapshotElement && el.offsetTop > snapshotElement.offsetTop);
                const positions = siblings.map(el => {
                    const rect = el.getBoundingClientRect();
                    return { el, top: rect.top };
                });

                content.addEventListener('animationend', () => {
                    content.classList.remove('collapsing');
                    snapshotElement.classList.add('collapsed');
                    content.style.display = 'none';
                    
                    // 处理其他元素的位移
                    positions.forEach(({ el, top }) => {
                        const newTop = el.getBoundingClientRect().top;
                        const delta = top - newTop;
                        
                        // 设置初始位置
                        el.style.transform = `translateY(${delta}px)`;
                        el.style.transition = 'none';
                        
                        // 触发重排
                        void el.offsetHeight;
                        
                        // 添加过渡并移动到最终位置
                        el.style.transition = 'transform 300ms cubic-bezier(0.4, 0.0, 0.2, 1)';
                        el.style.transform = '';
                        
                        // 清理样式
                        setTimeout(() => {
                            el.style.transform = '';
                            el.style.transition = '';
                        }, 300);
                    });
                }, { once: true });
            }
        });
        
        snapshotElement.appendChild(headerContainer);
        snapshotElement.appendChild(contentContainer);
        container.appendChild(snapshotElement);
    }
    
    // 保存快照到 dbStorage
    saveSnapshots() {
        try {
            this.storage.setItem('calculatorSnapshots', JSON.stringify(this.snapshots));
        } catch (e) {
            console.warn('Failed to save snapshots:', e);
        }
    }
    
    // 从 dbStorage 加载快照
    loadSnapshots() {
        try {
            const saved = this.storage.getItem('calculatorSnapshots');
            if (saved) {
                this.snapshots = JSON.parse(saved);
                this.renderList();
            }
        } catch (e) {
            console.warn('Failed to load snapshots:', e);
        }
    }
    
    // 格式化时间
    formatTime(date) {
        return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}-${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    }
    
    // 切换快照面板显示状态
    togglePanel() {
        this.isPanelVisible = !this.isPanelVisible;
        if (this.isPanelVisible) {
            // 使用全局 window.settings 替代导入的 settings
            if (window.settings && window.settings.isPanelVisible) {
                window.settings.togglePanel();
            }
            // 如果快捷键面板打开，先关闭它
            if (window.shortcuts && window.shortcuts.isPanelVisible) {
                window.shortcuts.togglePanel();
            }
            // 如果自定义函数面板打开，先关闭它
            if (window.customFunctions && window.customFunctions.isPanelVisible) {
                window.customFunctions.togglePanel();
            }
            // 移除当前焦点
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            this.panel.classList.add('show');
            this.overlay.classList.add('show');
            document.body.style.overflow = 'hidden';
        } else {
            this.clearActionTooltip();
            this.panel.classList.remove('show');
            this.overlay.classList.remove('show');
            document.body.style.overflow = '';
            // 退出后聚焦到最后一个输入框
            const inputs = document.querySelectorAll('.input');
            if (inputs.length > 0) {
                inputs[inputs.length - 1].focus();
            }
        }
        this.panel.style.right = this.isPanelVisible ? '0' : '-300px';
    }
    
    // 应用快照
    applySnapshot(records) {
        // 清空所有变量和行
        window.clearAll();
        
        // 依次填入快照中的记录
        records.forEach((record, index) => {
            if (index > 0) {
                window.addNewLine();
            }
            const line = document.querySelectorAll('.expression-line')[index];
            const input = line.querySelector('.input');
            
            // 设置 tag
            if (record.tag) {
                restoreTag(line, record.tag);
            }
            
            input.value = record.expression;
            input.dispatchEvent(new Event('input'));
        });

        notification.info('快照已恢复');

        // 更新添加按钮状态
        this.updateAddButtonState();

        // 关闭快照面板
        this.togglePanel();
    }

    // 添加新方法：更新添加按钮状态
    updateAddButtonState() {
        const lines = document.querySelectorAll('.expression-line');
        const hasValidExpression = Array.from(lines).some(line => {
            const input = line.querySelector('.input');
            return input && input.value.trim() !== '';
        });
        
        this.addButton.disabled = !hasValidExpression;
    }

    // 修改显示消息的方法
    showMessage(message) {
        notification.error(message);
    }
}

let snapshot = null;

export function ensureSnapshot() {
    if (snapshot) return snapshot;
    snapshot = new Snapshot();
    window.snapshot = snapshot;
    return snapshot;
}

// 添加快捷键支持
document.addEventListener('keydown', (e) => {
    const isCtrlH = (isMacOS() ? e.metaKey : e.ctrlKey) && e.code === 'KeyH';
    if (isCtrlH) {
        e.preventDefault();
        ensureSnapshot().togglePanel();
    }
}); 

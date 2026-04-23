import { notification, showTooltip, hideTooltip } from './notification.js';
import { isMacOS, storage } from './host.js';

const OPERATORS = window.CodeCalcCore.OPERATORS;
const FUNCTIONS = window.CodeCalcCore.FUNCTIONS;
const CONSTANTS = window.CodeCalcCore.CONSTANTS;
const isFunctionDefinition = window.CodeCalcCore.isFunctionDefinition;
const isConstantDefinition = window.CodeCalcCore.isConstantDefinition;

/** 根据定义字符串判断表达式类型：'function' | 'constant' */
function getExpType(definition) {
    if (!definition || typeof definition !== 'string') return 'function';
    const expr = definition.trim();
    if (isFunctionDefinition(expr)) return 'function';
    if (isConstantDefinition(expr)) return 'constant';
    return 'function';
}


export class CustomFunctions {
    constructor() {
        this.isPanelVisible = false;
        this.editingIndex = null;
        this.eventsBound = false;
        this.tooltipTimer = null;
        
        // 添加存储适配器
        this.storage = storage;

        // 删除旧的存储
        // this.storage.removeItem('customFunctions');
        // this.storage.removeItem('customFunctionsMetadata');
        
        // 等待DOM加载完成后初始化
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    
    init() {
        // 获取面板元素
        this.panel = document.getElementById('custom-functions-panel');
        if (!this.panel) {
            console.error('自定义函数面板元素未找到');
            return;
        }

        this.ensurePanelTitle();
        
        // 绑定事件
        this.bindEvents();
        
        // 渲染函数列表（直接从存储读取，不需要等待计算器）
        this.renderFunctionsList();
    }

    ensurePanelTitle() {
        const content = this.panel?.querySelector('.custom-functions-content');
        if (!content) return;

        if (content.querySelector('.custom-functions-page-title')) return;

        const title = document.createElement('div');
        title.className = 'custom-functions-page-title';
        title.innerHTML = `
            <button class="cf-page-back-btn" type="button" aria-label="返回首页">
                <svg viewBox="0 0 24 24" class="cf-page-back-icon" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
                <span>返回</span>
            </button>
            <div class="custom-functions-page-title-center">
                <div class="custom-functions-page-title-inner">
                    <div class="custom-functions-page-title-sub">Functions & Constants</div>
                    <button class="cf-title-help-btn" type="button" aria-label="显示自定义函数示例">?</button>
                    <div class="cf-title-help-tooltip">
                        <div class="cf-empty-example-codeblock">
                            <div class="cf-empty-example-lines">
                                <div class="cf-empty-example-line"><span class="cf-code-op">//</span> <span class="cf-code-meta">示例：自定义函数</span></div>
                                <div class="cf-empty-example-line"><span class="cf-code-fn">fun1</span>(<span class="cf-code-param">x</span>) <span class="cf-code-op">=</span> <span class="cf-code-param">x</span> <span class="cf-code-op">+</span> <span class="cf-code-num">1</span></div>
                                <div class="cf-empty-example-line cf-empty-example-gap" aria-hidden="true"></div>
                                <div class="cf-empty-example-line"><span class="cf-code-op">//</span> <span class="cf-code-meta">示例：带注释的自定义函数</span></div>
                                <div class="cf-empty-example-line"><span class="cf-code-fn">fun2</span>(<span class="cf-code-param">x</span>, <span class="cf-code-param">y</span>) <span class="cf-code-op">=</span> <span class="cf-code-param">x</span><span class="cf-code-op">**</span><span class="cf-code-num">2</span> <span class="cf-code-op">+</span> <span class="cf-code-param">y</span> <span class="cf-code-op">;</span> <span class="cf-code-op">//</span> <span class="cf-code-meta">这里是fun1的注释</span></div>
                                <div class="cf-empty-example-line cf-empty-example-gap" aria-hidden="true"></div>
                                <div class="cf-empty-example-line"><span class="cf-code-op">//</span> <span class="cf-code-meta">示例：自定义常数</span></div>
                                <div class="cf-empty-example-line"><span class="cf-code-fn">mypi</span> <span class="cf-code-op">:=</span> <span class="cf-code-num">3.14159</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="custom-functions-page-title-spacer" aria-hidden="true"></div>
        `;
        content.insertBefore(title, content.firstChild);
    }
    
    bindEvents() {
        
        // ESC键监听
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isPanelVisible) {
                e.preventDefault();
                e.stopPropagation();
                this.togglePanel();
            }
        });
        
        // 点击页面空白部分（非按钮、非输入框、非函数卡片、非空状态卡片）退出面板
        if (this.panel) {
            this.panel.addEventListener('click', (e) => {
                if (!this.isPanelVisible) return;
                const backBtn = e.target.closest('.cf-page-back-btn');
                if (backBtn) {
                    e.preventDefault();
                    this.togglePanel();
                    return;
                }
                const noClose = e.target.closest('button, input, textarea, .custom-function-item, .cf-empty-min-card');
                if (noClose) return;
                this.togglePanel();
            });
        }
        
        // 目前不启用拖拽排序
    }
    
    togglePanel() {
        if (!this.panel) {
            console.error('面板未初始化');
            return;
        }
        
        this.isPanelVisible = !this.isPanelVisible;
        if (this.isPanelVisible) {
            // 如果其他面板打开，先关闭它们
            if (window.settings && window.settings.isPanelVisible) {
                window.settings.togglePanel();
            }
            if (window.shortcuts && window.shortcuts.isPanelVisible) {
                window.shortcuts.togglePanel();
            }
            if (window.snapshot && window.snapshot.isPanelVisible) {
                window.snapshot.togglePanel();
            }
            
            // 移除当前焦点
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            
            this.panel.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            // 只在面板打开时渲染一次
            this.renderFunctionsList();
        } else {
            // 先播放从上到下的消失动画，动画结束后再真正关闭
            this.panel.classList.add('closing');
            const onClosed = (e) => {
                if (e.target !== this.panel) return;
                this.panel.removeEventListener('animationend', onClosed);
                this.panel.classList.remove('show', 'closing');
                document.body.style.overflow = '';
                const inputs = document.querySelectorAll('.input');
                if (inputs.length > 0) {
                    inputs[inputs.length - 1].focus();
                }
                this.editingIndex = null;
                if (this.tooltipTimer) {
                    clearTimeout(this.tooltipTimer);
                    this.tooltipTimer = null;
                }
                hideTooltip();
                document.dispatchEvent(new CustomEvent('codecalc:customFunctionsPanelClosed'));
            };
            this.panel.addEventListener('animationend', onClosed);
        }
    }
    
    renderFunctionsList() {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        // 直接从存储读取函数数据，不依赖计算器
        const storedFunctions = this.getStoredFunctions();
        const functionNames = Object.keys(storedFunctions);
        
        if (functionNames.length === 0) {
            listContainer.classList.add('cf-list-empty');
            listContainer.innerHTML = `
                <div class="cf-empty-state cf-empty-min">
                    <div class="cf-empty-min-card">
                        <div class="cf-empty-min-row1">
                            <span class="cf-empty-min-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" class="cf-empty-min-icon-svg">
                                    <path d="M8 9l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                    <path d="M16 9l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                    <path d="M14 7l-4 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                </svg>
                            </span>
                            <span class="cf-empty-min-text">这里还是空的～</span>
                        </div>
                        <div class="cf-empty-min-row2">
                            <div class="cf-empty-example-codeblock">
                                <div class="cf-empty-example-lines">
                                    <div class="cf-empty-example-line"><span class="cf-code-op">//</span> <span class="cf-code-meta">示例：自定义函数</span></div>
                                    <div class="cf-empty-example-line"><span class="cf-code-fn">fun1</span>(<span class="cf-code-param">x</span>) <span class="cf-code-op">=</span> <span class="cf-code-param">x</span> <span class="cf-code-op">+</span> <span class="cf-code-num">1</span></div>
                                    <div class="cf-empty-example-line cf-empty-example-gap" aria-hidden="true"></div>
                                    <div class="cf-empty-example-line"><span class="cf-code-op">//</span> <span class="cf-code-meta">示例：带注释的自定义函数</span></div>
                                    <div class="cf-empty-example-line"><span class="cf-code-fn">fun2</span>(<span class="cf-code-param">x</span>, <span class="cf-code-param">y</span>) <span class="cf-code-op">=</span> <span class="cf-code-param">x</span><span class="cf-code-op">**</span><span class="cf-code-num">2</span> <span class="cf-code-op">+</span> <span class="cf-code-param">y</span> <span class="cf-code-op">;</span> <span class="cf-code-op">//</span> <span class="cf-code-meta">这里是fun1的注释</span></div>
                                    <div class="cf-empty-example-line cf-empty-example-gap" aria-hidden="true"></div>
                                    <div class="cf-empty-example-line"><span class="cf-code-op">//</span> <span class="cf-code-meta">示例：自定义常数</span></div>
                                    <div class="cf-empty-example-line"><span class="cf-code-fn">mypi</span> <span class="cf-code-op">:=</span> <span class="cf-code-num">3.14159</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // 空状态也要绑定事件（事件委托只绑定一次）
            this.bindFunctionItemEvents();
            return;
        }

        listContainer.classList.remove('cf-list-empty');
        
        const functionsHTML = functionNames.map((name, index) => {
            const func = storedFunctions[name];
            const definition = func.definition;
            const description = func.description || '';
            const expType = func.expType != null ? func.expType : getExpType(definition);
            
            return this.createFunctionItemHTML(index, definition, description, expType, name);
        }).join('');
        
        // 避免不必要的重新渲染
        if (listContainer.innerHTML !== functionsHTML) {
            listContainer.innerHTML = functionsHTML;
        }
        
        // 绑定事件（使用事件委托，只绑定一次）
        this.bindFunctionItemEvents();

        // 默认选中第一行，方便显示置顶箭头
        const firstItem = listContainer.querySelector('.custom-function-item');
        if (firstItem && !firstItem.classList.contains('selected')) {
            firstItem.classList.add('selected');
        }
    }
    
    createFunctionItemHTML(index, definition, description, expType, funcName) {
        const expTypeSymbol = expType === 'constant' ? 'c' : 'f';
        return `
            <div class="custom-function-item" data-index="${index}" data-function-name="${funcName}">
                <!-- 浏览模式：Modern Clean SaaS 风格 -->
                <div class="function-browse-row">
                    <div class="cf-line-handle-wrap">
                        <div class="cf-line-handle-track">
                            <span class="cf-line-number">${index + 1}</span>
                            <button class="drag-handle" type="button" data-tooltip="置顶此函数" aria-label="置顶"></button>
                        </div>
                    </div>
                    <div class="function-content-area">
                        <div class="function-definition-row">
                            <span class="param-type-badge exp-type-badge" data-type="${expType}" title="${expType === 'constant' ? '常数' : '函数'}">${expTypeSymbol}</span>
                            <div class="function-definition">${definition}</div>
                        </div>
                        <div class="function-actions-overlay">
                            <button class="function-move-up-btn cf-icon-button" data-index="${index}" data-tooltip="上移" aria-label="上移">
                                <svg class="cf-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                                    <polyline points="6 15 12 9 18 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
                                </svg>
                            </button>
                            <button class="function-move-down-btn cf-icon-button" data-index="${index}" data-tooltip="下移" aria-label="下移">
                                <svg class="cf-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                                    <polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
                                </svg>
                            </button>
                            <button class="function-edit-btn cf-icon-button" data-index="${index}" data-tooltip="编辑函数" aria-label="编辑函数">
                                <svg class="cf-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M15.232 5.232l3.536 3.536M16.732 3.732a2.5 2.5 0 113.536 3.536L7.5 20.036 3 21l.964-4.5L16.732 3.732z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                </svg>
                            </button>
                            <button class="function-delete-btn cf-icon-button" data-index="${index}" data-function-name="${funcName}" data-tooltip="删除函数" aria-label="删除函数">
                                <svg class="cf-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                                    <polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
                                    <path d="M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                    <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                    <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                    <path d="M9 6V4h6v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- 编辑模式：仅输入框 + 按钮，不显示类型 -->
                <div class="function-edit-mode" style="display: none;">
                    <div class="function-edit-first-row">
                        <input type="text" 
                               class="function-body-input" 
                               data-index="${index}"
                               value="${definition}"
                               data-original="${definition}"
                               placeholder="f(x,y) = x * y + 1  或  p := 3.14159"
                               readonly>
                        <button class="function-save-btn cf-icon-button" data-index="${index}" data-tooltip="保存编辑" aria-label="保存">
                            <svg class="cf-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
                            </svg>
                        </button>
                        <button class="function-exit-btn cf-icon-button" data-index="${index}" data-tooltip="退出编辑" aria-label="退出">
                            <svg class="cf-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line>
                                <line x1="6" y1="6" x2="18" y2="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    bindFunctionItemEvents() {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        // 使用事件委托，避免重复绑定
        if (!this.eventsBound) {
            listContainer.addEventListener('click', this.handleListClick.bind(this));
            listContainer.addEventListener('keydown', this.handleListKeydown.bind(this));
            listContainer.addEventListener('change', this.handleListChange.bind(this));

            listContainer.addEventListener('mouseover', this.handleListMouseOver.bind(this));
            listContainer.addEventListener('mouseout', this.handleListMouseOut.bind(this));

            this.eventsBound = true;
        }
    }

    handleListMouseOver(e) {
        const target = e.target.closest('.drag-handle, .function-move-up-btn, .function-move-down-btn, .function-edit-btn, .function-delete-btn, .function-save-btn, .function-exit-btn');
        if (!target) return;

        const text = target.dataset.tooltip;
        if (!text) return;

        if (this.tooltipTimer) {
            clearTimeout(this.tooltipTimer);
        }

        this.tooltipTimer = setTimeout(() => {
            const rect = target.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.bottom + 8;
            showTooltip(text, x, y);
        }, 260);
    }

    handleListMouseOut(e) {
        const from = e.target.closest('.drag-handle, .function-move-up-btn, .function-move-down-btn, .function-edit-btn, .function-delete-btn, .function-save-btn, .function-exit-btn');
        if (!from) return;

        const related = e.relatedTarget;
        if (related && related.closest && related.closest('.drag-handle, .function-move-up-btn, .function-move-down-btn, .function-edit-btn, .function-delete-btn, .function-save-btn, .function-exit-btn') === from) {
            return;
        }

        if (this.tooltipTimer) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = null;
        }
        hideTooltip();
    }
    
    handleListClick(e) {
        const target = e.target;

        // 任意点击时先清除 tooltip，避免残留
        if (this.tooltipTimer) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = null;
        }
        hideTooltip();
        
        const editBtn = target.closest('.function-edit-btn');
        const deleteBtn = target.closest('.function-delete-btn');
        const moveTopBtn = target.closest('.drag-handle');
        const moveUpBtn = target.closest('.function-move-up-btn');
        const moveDownBtn = target.closest('.function-move-down-btn');
        const saveBtn = target.closest('.function-save-btn');
        const exitBtn = target.closest('.function-exit-btn');
        
        if (moveTopBtn) {
            e.preventDefault();
            const item = moveTopBtn.closest('.custom-function-item');
            const index = parseInt(item?.dataset.index);
            if (!Number.isNaN(index)) {
                this.reorderFunctions(index, 0);
            }
        } else if (moveUpBtn) {
            e.preventDefault();
            const item = moveUpBtn.closest('.custom-function-item');
            const index = parseInt(item?.dataset.index);
            if (!Number.isNaN(index) && index > 0) {
                this.reorderFunctions(index, index - 1);
            }
        } else if (moveDownBtn) {
            e.preventDefault();
            const item = moveDownBtn.closest('.custom-function-item');
            const index = parseInt(item?.dataset.index);
            const listContainer = this.panel?.querySelector('#custom-functions-list');
            const total = listContainer ? listContainer.querySelectorAll('.custom-function-item').length : 0;
            if (!Number.isNaN(index) && index < total - 1) {
                this.reorderFunctions(index, index + 1);
            }
        } else if (editBtn) {
            e.preventDefault();
            const index = parseInt(editBtn.dataset.index);
            this.toggleEditMode(index);
        } else if (deleteBtn) {
            e.preventDefault();
            const item = deleteBtn.closest('.custom-function-item');
            const index = item ? parseInt(item.dataset.index) : NaN;
            const funcName = deleteBtn.dataset.functionName;

            // 对于新建但尚未保存（没有名称）的行，直接视为“取消添加”
            if (!funcName) {
                if (!Number.isNaN(index)) {
                    this.deleteEmptyFunction(index);
                }
                return;
            }

            this.deleteFunction(funcName);
        } else if (saveBtn) {
            e.preventDefault();
            const index = parseInt(saveBtn.dataset.index);
            this.handleSaveClick(index);
        } else if (exitBtn) {
            e.preventDefault();
            const index = parseInt(exitBtn.dataset.index);
            this.handleExitClick(index);
        }
    }
    
    handleListKeydown(e) {
        const target = e.target;
        
        if (target.classList.contains('function-body-input') || target.classList.contains('function-desc-input')) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const index = parseInt(target.dataset.index);
                this.handleSaveClick(index);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const index = parseInt(target.dataset.index);
                this.handleExitClick(index);
            }
        }
    }
    
    handleListChange(e) {
        // 已移除参数类型选择框，保留事件委托占位
    }
    
    // 检测函数是否为空（新添加但未保存的函数）
    isFunctionEmpty(index) {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return false;
        
        const functionItem = listContainer.querySelector(`[data-index="${index}"]`);
        if (!functionItem) return false;
        
        const bodyInput = functionItem.querySelector('.function-body-input');
        if (!bodyInput) return false;
        
        const inputValue = bodyInput.value.trim();
        // 如果输入框为空，说明这是一个空函数
        return !inputValue;
    }
    
    // 处理保存按钮点击
    handleSaveClick(index) {
        if (this.isFunctionEmpty(index)) {
            this.showError('请先输入函数定义');
            return;
        }
        this.saveFunction(index);
    }
    
    // 处理退出按钮点击
    handleExitClick(index) {
        if (this.isFunctionEmpty(index)) {
            const listContainer = this.panel?.querySelector('#custom-functions-list');
            const functionItem = listContainer?.querySelector(`[data-index="${index}"]`);
            const funcName = functionItem?.dataset?.functionName;
            if (funcName) {
                this.deleteFunction(funcName);
            } else {
                this.deleteEmptyFunction(index);
            }
        } else {
            this.cancelEdit(index);
        }
    }
    
    // 删除空函数行
    deleteEmptyFunction(index) {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        const functionItem = listContainer.querySelector(`[data-index="${index}"]`);
        if (!functionItem) return;
        
        // 移除DOM元素
        functionItem.remove();
        
        // 重置编辑状态
        this.editingIndex = null;
        
        // 重新渲染（自动回到空状态 UI）
        this.renderFunctionsList();
        
        this.showSuccess('已取消添加函数');
    }
    
    toggleEditMode(index) {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        const functionItem = listContainer.querySelector(`[data-index="${index}"]`);
        const browseRow = functionItem.querySelector('.function-browse-row');
        const editMode = functionItem.querySelector('.function-edit-mode');
        const bodyInput = functionItem.querySelector('.function-body-input');
        
        // 检查当前是否在编辑模式
        const isEditing = editMode.style.display !== 'none';
        
        if (!isEditing) {
            // 进入编辑模式
            this.editingIndex = index;
            
            // 切换显示模式
            browseRow.style.display = 'none';
            editMode.style.display = 'block';
            
            // 启用编辑
            bodyInput.readOnly = false;
            bodyInput.focus();
            bodyInput.select();
            
            functionItem.classList.add('editing');
        } else {
            // 保存编辑
            this.handleSaveClick(index);
        }
    }
    
    saveFunction(index) {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        const functionItem = listContainer.querySelector(`[data-index="${index}"]`);
        if (!functionItem) return;
        
        const bodyInput = functionItem.querySelector('.function-body-input');
        const descInput = functionItem.querySelector('.function-desc-input');
        const oldFuncName = functionItem.dataset.functionName;
        
        const newDefinition = bodyInput.value.trim();
        const newDescription = descInput ? descInput.value.trim() : '';
        const originalDefinition = bodyInput.dataset.original || '';
        
        if (!newDefinition) {
            this.showError('定义不能为空');
            bodyInput.focus();
            return;
        }
        
        const expType = getExpType(newDefinition);
        if (expType !== 'function' && expType !== 'constant') {
            this.showError('格式错误。函数: func(x,y) = 表达式；常数: name := 数值');
            bodyInput.focus();
            return;
        }
        
        try {
            const newFuncName = expType === 'function'
                ? (newDefinition.match(/^([a-zA-Z_$][a-zA-Z0-9_]*)\s*\(/)?.[1] ?? '')
                : (newDefinition.match(/^([a-zA-Z_$][a-zA-Z0-9_]*)\s*:\s*=\s*/)?.[1] ?? '');
            if (!newFuncName) {
                this.showError('无法解析名称');
                return;
            }
            
            // 检查函数名是否与已有自定义函数重复
            const storedFunctions = this.getStoredFunctions();
            if (storedFunctions[newFuncName] && newFuncName !== oldFuncName) {
                this.showError(`函数名 "${newFuncName}" 已存在，请使用其他名称`);
                bodyInput.focus();
                return;
            }

            // 检查函数名是否与内置名称冲突
            const builtinNames = new Set([
                ...Object.keys(OPERATORS),
                ...Object.keys(FUNCTIONS),
                ...Object.keys(CONSTANTS)
            ]);

            // 移除自定义的函数名
            builtinNames.delete(oldFuncName);
            
            if (builtinNames.has(newFuncName)) {
                this.showError(`函数名 "${newFuncName}" 与内置名称冲突，请使用其他名称`);
                bodyInput.focus();
                return;
            }
            
            this.saveCustomFunctionData(oldFuncName, newFuncName, newDefinition, newDescription, expType);
            
            functionItem.dataset.functionName = newFuncName;
            bodyInput.dataset.original = newDefinition;
            
            this.exitEditMode(index);
            
            this.showSuccess(expType === 'constant' ? `常数 "${newFuncName}" 保存成功` : `函数 "${newFuncName}" 保存成功`);
            
        } catch (error) {
            this.showError(`保存失败: ${error.message}`);
            bodyInput.focus();
        }
    }
    
    cancelEdit(index) {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        const functionItem = listContainer.querySelector(`[data-index="${index}"]`);
        const bodyInput = functionItem.querySelector('.function-body-input');
        
        // 恢复原始值
        bodyInput.value = bodyInput.dataset.original;
        
        // 退出编辑模式
        this.exitEditMode(index);
    }
    
    exitEditMode(index) {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        const functionItem = listContainer.querySelector(`[data-index="${index}"]`);
        const browseRow = functionItem.querySelector('.function-browse-row');
        const editMode = functionItem.querySelector('.function-edit-mode');
        const bodyInput = functionItem.querySelector('.function-body-input');
        
        // 切换回浏览模式
        browseRow.style.display = 'flex';
        editMode.style.display = 'none';
        
        // 禁用编辑
        bodyInput.readOnly = true;
        
        functionItem.classList.remove('editing');
        
        this.editingIndex = null;
        
        // 更新浏览模式的显示内容
        this.updateBrowseMode(index);
    }
    
    updateBrowseMode(index) {
        const listContainer = this.panel?.querySelector('#custom-functions-list');
        if (!listContainer) return;
        
        const functionItem = listContainer.querySelector(`[data-index="${index}"]`);
        const browseRow = functionItem.querySelector('.function-browse-row');
        const bodyInput = functionItem.querySelector('.function-body-input');
        
        const definition = bodyInput.value;
        const expType = getExpType(definition);
        const expTypeSymbol = expType === 'constant' ? 'c' : 'f';
        
        const definitionSpan = browseRow.querySelector('.function-definition');
        const typeBadge = browseRow.querySelector('.param-type-badge');
        
        if (definitionSpan) {
            definitionSpan.textContent = definition;
        }
        
        if (typeBadge) {
            typeBadge.textContent = expTypeSymbol;
            typeBadge.setAttribute('data-type', expType);
            typeBadge.setAttribute('title', expType === 'constant' ? '常数' : '函数');
        }
    }
    
    deleteFunction(funcName) {
        if (!funcName) return;
        
        // 直接删除，无需确认
        // 纯数据操作：从存储中删除函数
        this.deleteCustomFunctionData(funcName);
        
        // 重新渲染列表
        this.renderFunctionsList();
        
        this.showSuccess(`函数 "${funcName}" 删除成功`);
    }
    
    // 纯数据管理方法 - 保存自定义函数/常数数据
    saveCustomFunctionData(oldFuncName, funcName, definition, description, expType) {
        try {
            const savedFunctions = JSON.parse(this.storage.getItem('customFunctions') || '{}');
            
            if (oldFuncName && oldFuncName !== funcName && savedFunctions[oldFuncName]) {
                delete savedFunctions[oldFuncName];
            }
            
            const type = expType != null ? expType : getExpType(definition);
            
            if (type === 'function') {
                if (!isFunctionDefinition(definition)) {
                    throw new Error('函数定义格式错误');
                }
                const match = definition.match(/^([a-zA-Z_$][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*=\s*(.+)$/);
                if (!match) throw new Error('函数定义格式错误');
                const [, , paramStr] = match;
                const params = paramStr.trim() ? paramStr.split(',').map(p => p.trim()) : [];
                savedFunctions[funcName] = {
                    name: funcName,
                    params,
                    definition,
                    description: description || '',
                    expType: 'function'
                };
            } else {
                if (!isConstantDefinition(definition)) {
                    throw new Error('常数定义格式错误，正确格式: name := number');
                }
                savedFunctions[funcName] = {
                    name: funcName,
                    params: [],
                    definition,
                    description: description || '',
                    expType: 'constant'
                };
            }
            
            this.storage.setItem('customFunctions', JSON.stringify(savedFunctions));
            console.log(`${type === 'constant' ? '常数' : '函数'} "${funcName}" 已保存到存储`);
            
        } catch (error) {
            console.warn('保存自定义函数/常数失败:', error);
            throw error;
        }
    }
    
    // 纯数据管理方法 - 删除自定义函数数据
    deleteCustomFunctionData(funcName) {
        try {
            const savedFunctions = JSON.parse(this.storage.getItem('customFunctions') || '{}');
            
            if (savedFunctions[funcName]) {
                delete savedFunctions[funcName];
                this.storage.setItem('customFunctions', JSON.stringify(savedFunctions));
                console.log(`函数 "${funcName}" 已从存储中删除`);
            }
            
        } catch (error) {
            console.warn('删除自定义函数失败:', error);
        }
    }
    
    // 获取存储的自定义函数数据
    getStoredFunctions() {
        try {
            return JSON.parse(this.storage.getItem('customFunctions') || '{}');
        } catch (error) {
            console.warn('读取自定义函数失败:', error);
            return {};
        }
    }
    
    
    showError(message) {
        notification.error(message, 2000);
    }
    
    showSuccess(message) {
        notification.info(message, 1500);
    }
    
    // 重新排序函数
    reorderFunctions(fromIndex, toIndex) {
        const storedFunctions = this.getStoredFunctions();
        const functionNames = Object.keys(storedFunctions);
        
        if (fromIndex < 0 || fromIndex >= functionNames.length || 
            toIndex < 0 || toIndex >= functionNames.length) {
            return;
        }
        
        // 移动数组元素
        const [movedFunction] = functionNames.splice(fromIndex, 1);
        functionNames.splice(toIndex, 0, movedFunction);
        
        // 重新保存排序后的函数
        const reorderedFunctions = {};
        functionNames.forEach(name => {
            reorderedFunctions[name] = storedFunctions[name];
        });
        
        this.storage.setItem('customFunctions', JSON.stringify(reorderedFunctions));
        
        // 重新渲染列表
        this.renderFunctionsList();
        
        this.showSuccess('函数顺序已更新');
    }
}

// 添加快捷键支持，Ctrl + I 打开自定义函数面板
document.addEventListener('keydown', (e) => {
    const isCtrlI = (isMacOS() ? e.metaKey : e.ctrlKey) && e.code === 'KeyI';

    if (isCtrlI) {
        e.preventDefault();
        ensureCustomFunctions().togglePanel();
    }
});

let customFunctions = null;

export function ensureCustomFunctions() {
    if (customFunctions) return customFunctions;
    customFunctions = new CustomFunctions();
    window.customFunctions = customFunctions;
    return customFunctions;
}

if (typeof window !== 'undefined') {
    window.openCustomFunctionsPanel = () => {
        ensureCustomFunctions().togglePanel();
        return false;
    };
}

import { isMacOS, storage } from './host.js';

export class Settings {
    constructor() {
        this.panel = document.getElementById('settings-panel');
        // console.log('Settings panel element:', this.panel);
        this.overlay = document.createElement('div');
        this.overlay.className = 'settings-overlay';
        document.body.appendChild(this.overlay);
        
        // 添加存储适配器，支持宿主存储和浏览器 localStorage
        this.storage = storage;
        
        // 添加图标点击效果
        this.tooltipIcon = document.querySelector('.tooltip-icon');
        // console.log('Tooltip icon element:', this.tooltipIcon);
        
        // 检查图标元素是否存在再添加事件
        if (this.tooltipIcon) {
            // 直接在图标上添加点击事件
            this.tooltipIcon.onclick = (e) => {
                console.log('Tooltip icon clicked');
                e.preventDefault();
                e.stopPropagation();
                this.tooltipIcon.classList.add('clicked');
                this.togglePanel();
            };
        }
        
        // 添加蒙版点击事件
        this.overlay.addEventListener('click', () => {
            if (this.tooltipIcon) {
                this.tooltipIcon.classList.remove('clicked');
            }
            this.togglePanel();
        });
        
        // 添加 ESC 键监听
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isPanelVisible) {
                e.preventDefault();
                e.stopPropagation();
                if (this.tooltipIcon) {
                    this.tooltipIcon.classList.remove('clicked');
                }
                this.togglePanel();
            }
        });
        
        // 初始化设置项并加载保存的设置
        this.initSettings();
    }
    
    // 初始化设置项
    initSettings() {
        // 加载保存的设置
        this.loadSettings();
        
        // 初始化所有设置项的监听器
        this.initToggleListeners();
    }
    
    // 保存设置到存储
    saveSettings() {
        try {
            const settings = {
                completionToggle: document.getElementById('completionToggle')?.checked ?? false,
                historyToggle: document.getElementById('historyToggle')?.checked ?? false,
                onlyCopyRsltToggle: document.getElementById('onlyCopyRsltToggle')?.checked ?? false,
                toCNToggle: document.getElementById('toCNToggle')?.checked ?? false,
                AutoNextLine: document.getElementById('AutoNextLine')?.checked ?? false
            };
            
            this.storage.setItem('calculatorSettings', JSON.stringify(settings));
            console.log('设置已保存:', settings);
        } catch (e) {
            console.warn('保存设置失败:', e);
        }
    }
    
    // 从存储加载设置
    loadSettings() {
        try {
            const saved = this.storage.getItem('calculatorSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                console.log('加载保存的设置:', settings);
                
                // 应用保存的设置到UI
                this.applySettings(settings);
            }
            // 如果没有保存的设置，保持HTML中的默认值
        } catch (e) {
            console.warn('加载设置失败:', e);
        }
    }
    
    // 应用设置到UI
    applySettings(settings) {
        // 标记正在应用设置，避免触发保存
        this.isApplyingSettings = true;
        
        const completionToggle = document.getElementById('completionToggle');
        const historyToggle = document.getElementById('historyToggle');
        const onlyCopyRsltToggle = document.getElementById('onlyCopyRsltToggle');
        const toCNToggle = document.getElementById('toCNToggle');
        const AutoNextLine = document.getElementById('AutoNextLine');
        
        if (completionToggle && settings.completionToggle !== undefined) completionToggle.checked = settings.completionToggle;
        if (historyToggle && settings.historyToggle !== undefined) historyToggle.checked = settings.historyToggle;
        if (onlyCopyRsltToggle && settings.onlyCopyRsltToggle !== undefined) onlyCopyRsltToggle.checked = settings.onlyCopyRsltToggle;
        if (toCNToggle && settings.toCNToggle !== undefined) toCNToggle.checked = settings.toCNToggle;
        if (AutoNextLine && settings.AutoNextLine !== undefined) AutoNextLine.checked = settings.AutoNextLine;
        
        // 完成应用设置
        this.isApplyingSettings = false;
    }
    
    // 初始化设置项的监听器
    initToggleListeners() {
        // 监听所有设置项的变化
        const settingIds = ['completionToggle', 'historyToggle', 'onlyCopyRsltToggle', 'toCNToggle', 'AutoNextLine'];
        
        settingIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    // 如果正在应用设置，不触发保存
                    if (this.isApplyingSettings) {
                        return;
                    }
                    
                    // 保存设置
                    this.saveSettings();
                    
                    // 特殊处理某些设置项
                    if (id === 'toCNToggle') {
                        // 当开关状态改变时，重新计算所有行
                        if (typeof window.recalculateAllLines === 'function') {
                            window.recalculateAllLines();
                        }
                    }
                });
            }
        });
    }
    
    togglePanel() {
        this.isPanelVisible = !this.isPanelVisible;
        if (this.isPanelVisible) {
            // 使用全局 window.snapshot 替代导入的 snapshot，添加安全检查
            if (window.snapshot && window.snapshot.isPanelVisible) {
                window.snapshot.togglePanel();
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
            this.panel.classList.remove('show');
            this.overlay.classList.remove('show');
            document.body.style.overflow = '';
            // 退出面板，聚焦输入框
            const inputs = document.querySelectorAll('.input');
            if (inputs.length > 0) {
                inputs[inputs.length - 1].focus();
            }
        }
    }
}

let settings = null;

export function ensureSettings() {
    if (settings) return settings;
    settings = new Settings();
    window.settings = settings;
    return settings;
}

// 添加快捷键支持，Ctrl + P 打开设置页面
document.addEventListener('keydown', (e) => {
    const isCtrlP = (isMacOS() ? e.metaKey : e.ctrlKey) && e.code === 'KeyP';

    if (isCtrlP) {
        e.preventDefault();
        ensureSettings().togglePanel();
    }
});

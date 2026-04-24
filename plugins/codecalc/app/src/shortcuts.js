import { isMacOS } from './host.js';

export class Shortcuts {
    constructor() {
        this.panel = document.getElementById('shortcuts-panel');
        this.overlay = document.createElement('div');
        this.overlay.className = 'shortcuts-overlay';
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
    }
    
    togglePanel() {
        this.isPanelVisible = !this.isPanelVisible;
        if (this.isPanelVisible) {
            // 如果设置面板打开，先关闭它
            if (window.settings && window.settings.isPanelVisible) {
                window.settings.togglePanel();
            }
            // 如果快照面板打开，先关闭它
            if (window.snapshot && window.snapshot.isPanelVisible) {
                window.snapshot.togglePanel();
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
            // 退出后聚焦到最后一个输入框
            const inputs = document.querySelectorAll('.input');
            if (inputs.length > 0) {
                inputs[inputs.length - 1].focus();
            }
        }
    }
}

// 添加快捷键支持，Ctrl + / 打开快捷键面板
document.addEventListener('keydown', (e) => {
    const isCtrlSlash = (isMacOS() ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === '/';

    if (isCtrlSlash) {
        e.preventDefault();
        e.stopPropagation();
        ensureShortcuts().togglePanel();
    }
});

// 切换面板功能已通过快捷键和全局实例 window.shortcuts 提供

let shortcuts = null;

export function ensureShortcuts() {
    if (shortcuts) return shortcuts;
    shortcuts = new Shortcuts();
    window.shortcuts = shortcuts;
    return shortcuts;
}

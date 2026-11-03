/**
 * 无障碍 (Accessibility) 支持模块
 * 为插件添加 ARIA 标签支持和键盘导航增强
 */

// 无障碍标签定义
const ACCESSIBILITY_LABELS = {
    // 设置视图
    settings_home: 'Workflowy 设置主菜单',
    settings_common: '常用设置，包含 API Key 和目标配置',
    settings_oss: 'OSS 上传设置，用于配置阿里云存储',
    settings_other: '其他设置，包含时间戳和分隔符',
    settings_import_export: '配置导入导出，用于备份和恢复设置',

    // 操作按钮
    btn_back: '返回上一级菜单',
    btn_save: '保存当前设置',
    btn_delete: '删除该项',
    btn_add: '添加新项目',
    btn_edit: '编辑项目',
    btn_confirm: '确认操作',
    btn_cancel: '取消操作',

    // 输入框
    input_api_key: '输入 Workflowy API Key',
    input_capture_target: '输入 wf 发送目标',
    input_view_entry: '输入 wfv 查看入口',
    input_tag: '输入标签名称',
    input_separator: '输入分隔符',

    // 状态提示
    status_enabled: '已启用',
    status_disabled: '已禁用',
    status_configured: '已配置',
    status_not_configured: '未配置',

    // 导航提示
    nav_cleanup: '清理视图，显示未完成节点',
    nav_add_entry: '添加新的查看入口',
    nav_browse_node: '进入节点查看子节点',
    nav_open_widget: '在新窗口打开节点',

    // 上传相关
    upload_image: '上传图片到 OSS',
    upload_markdown: '上传 Markdown 文件到 OSS',
    upload_pending: '待上传附件',
    upload_progress: '上传进度',

    // 附件操作
    attachment_preview: '预览附件',
    attachment_copy_link: '复制附件链接',
    attachment_delete: '删除 OSS 对象',
    attachment_retry: '重试保存到 Workflowy'
};

// 获取元素的 ARIA 标签
const getAriaLabel = (key, params = {}) => {
    let label = ACCESSIBILITY_LABELS[key] || key;

    // 替换参数
    Object.entries(params).forEach(([k, v]) => {
        label = label.replace(`{${k}}`, v);
    });

    return label;
};

// 为菜单项生成无障碍属性
const generateAriaAttributes = (item, index, total) => {
    const attrs = {
        role: 'menuitem',
        tabindex: index === 0 ? '0' : '-1',
        'aria-position': `${index + 1} of ${total}`
    };

    if (item.description) {
        attrs['aria-label'] = `${item.title}，${item.description}`;
    } else {
        attrs['aria-label'] = item.title;
    }

    if (item.type === 'info' || item.type === 'error') {
        attrs.role = 'status';
        if (item.type === 'error') {
            attrs['aria-live'] = 'assertive';
        }
    }

    return attrs;
};

// 键盘导航提示
const KEYBOARD_HINTS = {
    enter: '按 Enter 键执行',
    escape: '按 Escape 键返回',
    arrowUp: '按 上箭头 键向上移动',
    arrowDown: '按 下箭头 键向下移动',
    arrowLeft: '按 左箭头 键返回上级',
    arrowRight: '按 右箭头 键进入',
    tab: '按 Tab 键切换到下一个元素',
    shiftTab: '按 Shift + Tab 键返回上一个元素'
};

// 获取键盘提示文本
const getKeyboardHint = (action) => {
    switch (action) {
        case 'browse':
            return KEYBOARD_HINTS.enter + '进入';
        case 'back':
            return KEYBOARD_HINTS.escape + '返回';
        case 'navigate':
            return KEYBOARD_HINTS.enter + '导航';
        case 'select':
            return KEYBOARD_HINTS.enter + '选择';
        default:
            return KEYBOARD_HINTS.enter + '执行操作';
    }
};

// 屏幕阅读器公告
const announceToScreenReader = (message, priority = 'polite') => {
    try {
        const announcer = document.createElement('div');
        announcer.setAttribute('role', 'status');
        announcer.setAttribute('aria-live', priority);
        announcer.setAttribute('aria-atomic', 'true');
        announcer.className = 'sr-only';
        announcer.textContent = message;
        document.body.appendChild(announcer);

        // 3秒后移除
        setTimeout(() => {
            announcer.remove();
        }, 3000);
    } catch (e) {
        // 忽略无障碍 API 不可用的情况
    }
};

// 焦点管理
const focusElement = (selector) => {
    try {
        const element = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;
        if (element) {
            element.focus();
            return true;
        }
    } catch (e) {
        // 忽略
    }
    return false;
};

// 焦点陷阱（模态框内）
const createFocusTrap = (container) => {
    const focusableSelectors = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'a[href]',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const getFocusableElements = () => {
        return Array.from(container.querySelectorAll(focusableSelectors));
    };

    const handleKeyDown = (e) => {
        if (e.key !== 'Tab') return;

        const focusable = getFocusableElements();
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
        container.removeEventListener('keydown', handleKeyDown);
    };
};

module.exports = {
    ACCESSIBILITY_LABELS,
    KEYBOARD_HINTS,
    getAriaLabel,
    generateAriaAttributes,
    getKeyboardHint,
    announceToScreenReader,
    focusElement,
    createFocusTrap
};

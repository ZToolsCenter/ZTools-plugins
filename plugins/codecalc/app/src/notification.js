// 通知组件
export class Notification {
    constructor() {
        // 不再在构造函数中创建元素
        this.element = null;
    }

    // 清理所有通知元素
    clearAll() {
        const notifications = document.querySelectorAll('.notification');
        notifications.forEach(notification => {
            if (notification && document.body.contains(notification)) {
                notification.remove();
            }
        });
        // 如果当前实例的元素被清理了，也要重置引用
        if (this.element && !document.body.contains(this.element)) {
            this.element = null;
        }
    }

    // 显示通知
    show(message, type = 'info', duration = 1000) {
        // 清理所有旧的通知
        this.clearAll();

        // 创建新的通知元素
        this.element = document.createElement('div');
        this.element.className = `notification ${type}`;
        this.element.textContent = message;
        
        // 添加到 body 中
        document.body.appendChild(this.element);
        
        // 设置定时器移除通知
        setTimeout(() => {
            if (this.element && document.body.contains(this.element)) {
                this.element.classList.add('fade-out');
                setTimeout(() => {
                    if (this.element && document.body.contains(this.element)) {
                        this.element.remove();
                        this.element = null;
                    }
                }, 300);
            }
        }, duration);
    }

    // 显示信息通知
    info(message, duration = 1000) {
        this.show(message, 'info', duration);
    }

    // 显示警告通知
    warning(message, duration = 1000) {
        this.show(message, 'warning', duration);
    }

    // 显示错误通知
    error(message, duration = 1000) {
        this.show(message, 'error', duration);
    }
}

// 创建全局通知实例
export const notification = new Notification();

// 轻量通用 tooltip（基于坐标弹出）
let globalTooltip = null;

export function showTooltip(text, x, y, className = 'notification-tips') {
    if (globalTooltip && document.body.contains(globalTooltip)) {
        globalTooltip.remove();
    }

    const tooltip = document.createElement('div');
    tooltip.className = className;
    tooltip.textContent = text;
    document.body.appendChild(tooltip);

    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const margin = 20;
    let finalX = Math.min(x, viewportWidth - rect.width - margin);
    let finalY = Math.min(y, viewportHeight - rect.height - margin);

    tooltip.style.left = `${finalX}px`;
    tooltip.style.top = `${finalY}px`;

    requestAnimationFrame(() => {
        tooltip.classList.add('active');
    });

    globalTooltip = tooltip;
    return tooltip;
}

export function hideTooltip() {
    if (globalTooltip && document.body.contains(globalTooltip)) {
        globalTooltip.remove();
    }
    globalTooltip = null;
}
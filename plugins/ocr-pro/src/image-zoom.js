// 图像缩放管理器
class ImageZoomManager {
    constructor(containerSelector, imageSelector) {
        this.container = document.querySelector(containerSelector);
        this.image = document.querySelector(imageSelector);
        this.zoomContainer = null;
        this.zoomIndicator = null;
        
        // 缩放参数
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 6;
        this.scaleStep = 0.25;
        
        // 拖拽参数
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.translateX = 0;
        this.translateY = 0;
        
        // 触摸缩放参数
        this.initialPinchDistance = null;
        this.initialScale = null;
        
        // 初始化
        this.init();
    }
    
    init() {
        if (!this.container || !this.image) return;
        
        this.createZoomContainer();
        this.createZoomIndicator();
        this.bindEvents();
    }
    
    createZoomContainer() {
        // 创建缩放容器
        this.zoomContainer = document.createElement('div');
        this.zoomContainer.className = 'zoom-container';
        
        // 将图片包装在缩放容器中
        const parent = this.image.parentNode;
        parent.insertBefore(this.zoomContainer, this.image);
        this.zoomContainer.appendChild(this.image);
    }
    
    createZoomIndicator() {
        // 创建缩放比例指示器
        this.zoomIndicator = document.createElement('div');
        this.zoomIndicator.className = 'zoom-indicator';
        this.zoomIndicator.textContent = '100%';
        this.container.appendChild(this.zoomIndicator);
    }
    
    bindEvents() {
        // 绑定事件处理函数到this
        this.boundHandleWheel = this.handleWheel.bind(this);
        this.boundHandleMouseDown = this.handleMouseDown.bind(this);
        this.boundHandleMouseMove = this.handleMouseMove.bind(this);
        this.boundHandleMouseUp = this.handleMouseUp.bind(this);
        this.boundResetZoom = this.resetZoom.bind(this);
        this.boundPreventDrag = (e) => e.preventDefault();
        
        // 鼠标滚轮缩放（明确设置为非被动模式以避免警告）
        this.zoomContainer.addEventListener('wheel', this.boundHandleWheel, { passive: false });
        
        // 鼠标拖拽
        this.zoomContainer.addEventListener('mousedown', this.boundHandleMouseDown);
        
        document.addEventListener('mousemove', this.boundHandleMouseMove);
        document.addEventListener('mouseup', this.boundHandleMouseUp);
        
        // 双击重置
        this.zoomContainer.addEventListener('dblclick', this.boundResetZoom);
        
        // 防止图片拖拽
        this.image.addEventListener('dragstart', this.boundPreventDrag);
        
        // 触摸设备支持
        this.boundHandleTouchStart = this.handleTouchStart.bind(this);
        this.boundHandleTouchMove = this.handleTouchMove.bind(this);
        this.boundHandleTouchEnd = this.handleTouchEnd.bind(this);
        
        this.zoomContainer.addEventListener('touchstart', this.boundHandleTouchStart, { passive: false });
        this.zoomContainer.addEventListener('touchmove', this.boundHandleTouchMove, { passive: false });
        this.zoomContainer.addEventListener('touchend', this.boundHandleTouchEnd, { passive: false });
    }
    
    handleWheel(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const rect = this.zoomContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // 计算鼠标相对于容器中心的位置
        const mouseX = e.clientX - centerX;
        const mouseY = e.clientY - centerY;
        
        // 计算新的缩放比例
        const delta = e.deltaY > 0 ? -this.scaleStep : this.scaleStep;
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale + delta));
        
        if (newScale !== this.scale) {
            // 计算缩放中心偏移
            const scaleRatio = newScale / this.scale;
            this.translateX = this.translateX * scaleRatio + mouseX * (1 - scaleRatio);
            this.translateY = this.translateY * scaleRatio + mouseY * (1 - scaleRatio);
            
            this.scale = newScale;
            this.updateTransform();
            this.updateZoomIndicator();
            this.updateCursor();
        }
    }
    
    handleMouseDown(e) {
        if (this.scale > 1) {
            this.isDragging = true;
            this.dragStartX = e.clientX - this.translateX;
            this.dragStartY = e.clientY - this.translateY;
            this.zoomContainer.style.cursor = 'grabbing';
            this.zoomContainer.classList.add('dragging');
            e.preventDefault();
        }
    }
    
    handleMouseMove(e) {
        if (this.isDragging) {
            this.translateX = e.clientX - this.dragStartX;
            this.translateY = e.clientY - this.dragStartY;
            this.updateTransform();
        }
    }
    
    handleMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            this.updateCursor();
            this.zoomContainer.classList.remove('dragging');
        }
    }
    
    updateCursor() {
        if (this.zoomContainer) {
            if (this.isDragging) {
                this.zoomContainer.style.cursor = 'grabbing';
            } else if (this.scale > 1) {
                this.zoomContainer.style.cursor = 'grab';
            } else {
                this.zoomContainer.style.cursor = 'default';
            }
        }
    }
    
    // 触摸事件处理
    handleTouchStart(e) {
        if (e.touches.length === 1 && this.scale > 1) {
            // 单指拖拽
            this.isDragging = true;
            const touch = e.touches[0];
            this.dragStartX = touch.clientX - this.translateX;
            this.dragStartY = touch.clientY - this.translateY;
            this.zoomContainer.classList.add('dragging');
            e.preventDefault();
        } else if (e.touches.length === 2) {
            // 双指缩放准备
            this.initialPinchDistance = this.getPinchDistance(e.touches);
            this.initialScale = this.scale;
            e.preventDefault();
        }
    }
    
    handleTouchMove(e) {
        if (e.touches.length === 1 && this.isDragging) {
            // 单指拖拽
            const touch = e.touches[0];
            this.translateX = touch.clientX - this.dragStartX;
            this.translateY = touch.clientY - this.dragStartY;
            this.updateTransform();
            e.preventDefault();
        } else if (e.touches.length === 2 && this.initialPinchDistance) {
            // 双指缩放
            const currentDistance = this.getPinchDistance(e.touches);
            const scaleRatio = currentDistance / this.initialPinchDistance;
            const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialScale * scaleRatio));
            
            if (newScale !== this.scale) {
                this.scale = newScale;
                this.updateTransform();
                this.updateZoomIndicator();
                this.updateCursor();
            }
            e.preventDefault();
        }
    }
    
    handleTouchEnd(e) {
        if (e.touches.length === 0) {
            this.isDragging = false;
            this.initialPinchDistance = null;
            this.initialScale = null;
            this.updateCursor();
            this.zoomContainer.classList.remove('dragging');
        }
    }
    
    getPinchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    updateTransform() {
        if (this.image) {
            this.image.style.transform = `scale(${this.scale}) translate(${this.translateX / this.scale}px, ${this.translateY / this.scale}px)`;
            this.image.style.transition = this.isDragging ? 'none' : 'transform 0.2s ease-out';
        }
    }
    
    updateZoomIndicator() {
        if (this.zoomIndicator) {
            const percentage = Math.round(this.scale * 100);
            this.zoomIndicator.textContent = `${percentage}%`;
            this.zoomIndicator.style.opacity = '1';

            // 0.6秒后淡出指示器
            clearTimeout(this.indicatorTimeout);
            this.indicatorTimeout = setTimeout(() => {
                if (this.zoomIndicator) {
                    this.zoomIndicator.style.opacity = '0';
                }
            }, 600);
        }
    }
    
    resetZoom() {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform();
        this.updateZoomIndicator();
        this.updateCursor();
        this.zoomContainer.classList.remove('dragging');
    }
    
    destroy() {
        if (this.zoomContainer && this.boundHandleWheel) {
            // 移除事件监听器
            this.zoomContainer.removeEventListener('wheel', this.boundHandleWheel);
            this.zoomContainer.removeEventListener('mousedown', this.boundHandleMouseDown);
            this.zoomContainer.removeEventListener('dblclick', this.boundResetZoom);
            
            document.removeEventListener('mousemove', this.boundHandleMouseMove);
            document.removeEventListener('mouseup', this.boundHandleMouseUp);
            
            if (this.image && this.boundPreventDrag) {
                this.image.removeEventListener('dragstart', this.boundPreventDrag);
            }
            
            // 移除触摸事件监听器
            if (this.boundHandleTouchStart) {
                this.zoomContainer.removeEventListener('touchstart', this.boundHandleTouchStart);
                this.zoomContainer.removeEventListener('touchmove', this.boundHandleTouchMove);
                this.zoomContainer.removeEventListener('touchend', this.boundHandleTouchEnd);
            }
            
            // 恢复原始结构
            const parent = this.zoomContainer.parentNode;
            if (parent && this.image) {
                parent.insertBefore(this.image, this.zoomContainer);
                parent.removeChild(this.zoomContainer);
                
                // 重置图片样式
                this.image.style.transform = '';
                this.image.style.transition = '';
                this.image.style.cursor = '';
            }
        }
        
        if (this.zoomIndicator) {
            this.zoomIndicator.remove();
        }
        
        // 清理定时器
        clearTimeout(this.indicatorTimeout);
        
        // 清理引用
        this.zoomContainer = null;
        this.zoomIndicator = null;
        this.image = null;
        this.container = null;
    }
}

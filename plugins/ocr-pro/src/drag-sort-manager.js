/**
 * 拖拽排序管理器
 * 提供模型列表的拖拽排序功能，包含实时动画和自动滚动
 */
class DragSortManager {
    constructor() {
        // 拖拽状态
        this.draggedElement = null;
        this.draggedIndex = -1;
        this.isDragging = false;
        this.isDragStarted = false;
        this.dragThreshold = 5;
        this.mouseDownPos = { x: 0, y: 0 };
        this.dragOffset = { x: 0, y: 0 };
        this.lastMouseY = 0;
        this.dragDirection = 0; // -1向上，1向下，0无方向

        // 容器和元素
        this.draggedContainer = null;
        this.sortableContainers = new Set();
        this.placeholder = null;
        this.lastPlaceholderPosition = null;
        this.originalWidth = 0;

        // 动画状态
        this.isAnimating = false;

        // 滚动相关
        this.autoScrollTimer = null;
        this.scrollSpeed = 0;
        this.maxScrollSpeed = 6;
        this.scrollZoneSize = 100;
        this.initialScrollTop = 0;

        this.init();
    }



    /**
     * 初始化拖拽管理器
     */
    init() {
        this.createPlaceholder();
        this.bindGlobalEvents();
    }

    /**
     * 创建占位符元素
     */
    createPlaceholder() {
        this.placeholder = document.createElement('div');
        this.placeholder.className = 'drag-placeholder';
        this.placeholder.innerHTML = '<div class="drag-placeholder-content"></div>';
    }

    /**
     * 绑定全局事件监听器
     */
    bindGlobalEvents() {
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));
        document.addEventListener('dragstart', (e) => e.preventDefault());
    }

    /**
     * 为容器启用拖拽排序功能
     * @param {HTMLElement} container - 容器元素
     * @param {Object} options - 配置选项
     */
    enableSortable(container, options = {}) {
        if (!container) return;

        const config = {
            itemSelector: '.model-item',
            handleSelector: null, // 如果为null，整个item都可拖拽
            onSort: null, // 排序完成回调
            onStart: null, // 开始拖拽回调
            onEnd: null, // 结束拖拽回调
            ...options
        };

        container.setAttribute('data-sortable', 'true');
        container.sortableConfig = config;
        this.sortableContainers.add(container);

        // 为现有的模型项添加拖拽事件
        this.bindItemEvents(container);

        // 监听容器内容变化，为新添加的项绑定事件
        const observer = new MutationObserver(() => {
            this.bindItemEvents(container);
        });
        observer.observe(container, { childList: true, subtree: true });
    }

    // 为容器内的模型项绑定拖拽事件
    bindItemEvents(container) {
        const config = container.sortableConfig;
        if (!config) return;

        const items = container.querySelectorAll(config.itemSelector);
        items.forEach(item => {
            // 避免重复绑定
            if (item.hasAttribute('data-drag-bound')) return;
            item.setAttribute('data-drag-bound', 'true');

            const handle = config.handleSelector ? 
                item.querySelector(config.handleSelector) : item;

            if (handle) {
                handle.style.cursor = 'grab';
                handle.addEventListener('mousedown', (e) => {
                    this.handleMouseDown(e, item, container);
                });
            }
        });
    }

    // 处理鼠标按下事件
    handleMouseDown(e, item, container) {
        // 忽略右键和中键
        if (e.button !== 0) return;

        // 如果点击的是按钮或其他交互元素，不启动拖拽
        if (this.isInteractiveElement(e.target)) return;

        // 不要立即阻止事件传播，只有在真正开始拖拽时才阻止
        // e.preventDefault();
        // e.stopPropagation();

        // 记录初始状态，但不立即应用拖拽样式
        this.isDragging = true;
        this.isDragStarted = false; // 重置拖拽开始状态
        this.draggedElement = item;
        this.draggedContainer = container;
        this.dragStartY = e.clientY;

        // 记录鼠标按下时的位置
        this.mouseDownPos = {
            x: e.clientX,
            y: e.clientY
        };

        // 计算拖拽偏移
        const rect = item.getBoundingClientRect();
        this.dragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };

        // 获取当前项的索引（只考虑可见元素）
        const items = Array.from(container.querySelectorAll(container.sortableConfig.itemSelector + ':not(.category-hidden)'));
        this.draggedIndex = items.indexOf(item);

        // 不在这里应用拖拽样式，等到真正开始拖拽时再应用
    }

    // 开始真正的拖拽（移除所有视觉样式效果）
    startDragging() {
        if (this.isDragStarted || !this.draggedElement) return;

        this.isDragStarted = true;
        const item = this.draggedElement;
        const container = this.draggedContainer;

        // 记录拖拽开始时的滚动位置
        this.initialScrollTop = container.scrollTop;

        // 应用拖拽样式 - 移除视觉效果但保留必要的层级设置
        item.classList.add('dragging');
        item.style.pointerEvents = 'none'; // 保留这个以避免拖拽时的交互问题
        item.style.zIndex = '1000'; // 恢复层级变化，确保拖拽条目显示在上方

        // 确保样式变化不影响滚动位置
        if (container.scrollTop !== this.initialScrollTop) {
            container.scrollTop = this.initialScrollTop;
        }

        // 记录原始宽度，防止position: fixed时宽度变化
        const rect = item.getBoundingClientRect();
        this.originalWidth = rect.width;



        // 改变鼠标样式
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';

        // 禁用拖拽时的悬停效果
        this.disableHoverEffects(container);

        // 初始化占位符位置，但不立即显示，避免位置跳转
        this.initializePlaceholder();

        // 显示占位符以保持空间
        this.placeholder.style.visibility = 'visible';
        this.placeholder.classList.add('show');

        // 触发开始拖拽回调
        const config = container.sortableConfig;
        if (config.onStart) {
            config.onStart(item, this.draggedIndex);
        }
    }

    // 处理鼠标移动事件
    handleMouseMove(e) {
        if (!this.isDragging || !this.draggedElement) return;

        // 检查是否超过拖拽阈值
        if (!this.isDragStarted) {
            const deltaX = Math.abs(e.clientX - this.mouseDownPos.x);
            const deltaY = Math.abs(e.clientY - this.mouseDownPos.y);
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

            if (distance < this.dragThreshold) {
                // 还没有超过阈值，不开始拖拽，也不阻止默认行为
                return;
            }

            // 超过阈值，开始真正的拖拽
            this.startDragging();
            // 记录初始鼠标Y位置
            this.lastMouseY = e.clientY;
        }

        // 只有在真正开始拖拽后才阻止默认行为
        e.preventDefault();

        // 移动被拖拽的元素 - 恢复位置跟随功能并保持原始宽度
        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;

        this.draggedElement.style.position = 'fixed';
        this.draggedElement.style.left = x + 'px';
        this.draggedElement.style.top = y + 'px';
        this.draggedElement.style.width = this.originalWidth + 'px'; // 保持原始宽度

        // 查找插入位置
        this.updatePlaceholder();

        // 计算拖拽方向
        this.updateDragDirection(e.clientY);

        // 处理边缘滚动
        this.handleAutoScroll(e);

        // 更新鼠标Y位置记录
        this.lastMouseY = e.clientY;
    }

    // 更新拖拽方向
    updateDragDirection(currentY) {
        if (this.lastMouseY === 0) {
            // 初始状态，无方向
            this.dragDirection = 0;
            return;
        }

        const deltaY = currentY - this.lastMouseY;
        const threshold = 2; // 设置一个小的阈值，避免微小移动造成方向频繁变化

        if (Math.abs(deltaY) > threshold) {
            if (deltaY > 0) {
                this.dragDirection = 1; // 向下拖拽
            } else {
                this.dragDirection = -1; // 向上拖拽
            }
        }
        // 如果移动距离小于阈值，保持当前方向不变
    }



    // 初始化占位符位置，避免拖拽开始时的位置跳转
    initializePlaceholder() {
        const container = this.draggedContainer;

        // 记录当前滚动位置，防止DOM操作导致的滚动跳跃
        const currentScrollTop = container.scrollTop;

        // 设置占位符高度与被拖拽元素一致
        const draggedRect = this.draggedElement.getBoundingClientRect();
        this.placeholder.style.height = draggedRect.height + 'px';

        // 在被拖拽元素的原位置插入占位符，但不显示
        const nextSibling = this.draggedElement.nextElementSibling;
        if (nextSibling) {
            container.insertBefore(this.placeholder, nextSibling);
        } else {
            container.appendChild(this.placeholder);
        }

        // 初始化时不显示占位符，使用visibility而不是display来避免布局影响
        this.placeholder.style.visibility = 'hidden';
        this.placeholder.style.display = 'flex'; // 保持布局空间

        // 强制恢复滚动位置，防止DOM操作导致的位置跳跃
        if (container.scrollTop !== currentScrollTop) {
            container.scrollTop = currentScrollTop;
        }

        // 记录初始位置
        this.lastPlaceholderPosition = nextSibling || 'end';
    }

    // 更新占位符位置
    updatePlaceholder() {
        const container = this.draggedContainer;
        const config = container.sortableConfig;
        const items = Array.from(container.querySelectorAll(config.itemSelector + ':not(.category-hidden)'));
        const validItems = items.filter(item => item !== this.draggedElement);

        // 获取被拖拽元素的边界信息
        const draggedRect = this.draggedElement.getBoundingClientRect();
        const draggedTop = draggedRect.top;
        const draggedBottom = draggedRect.bottom;

        // 使用更精确的拖拽方向判断
        const isDraggingDown = this.dragDirection > 0;

        let newInsertBefore = null;

        // 使用正确的边界检测算法
        for (let i = 0; i < validItems.length; i++) {
            const item = validItems[i];
            const rect = item.getBoundingClientRect();
            const itemTop = rect.top;
            const itemBottom = rect.bottom;
            const itemCenter = itemTop + (itemBottom - itemTop) / 2;

            if (isDraggingDown) {
                // 向下拖动：检测被拖拽元素的底部边框是否到达目标元素的垂直中心线
                if (draggedBottom >= itemCenter) {
                    // 继续检查下一个元素
                    continue;
                } else {
                    // 被拖拽元素的底部还没到达当前元素的中心线，插入到当前元素之前
                    newInsertBefore = item;
                    break;
                }
            } else {
                // 向上拖动：检测被拖拽元素的顶部边框是否到达目标元素的垂直中心线
                if (draggedTop <= itemCenter) {
                    // 被拖拽元素的顶部已到达当前元素的中心线，插入到当前元素之前
                    newInsertBefore = item;
                    break;
                }
            }
        }

        // 防抖动：只有当新位置与上次位置不同时才更新占位符
        const newPosition = newInsertBefore ? newInsertBefore : 'end';
        if (this.lastPlaceholderPosition !== newPosition) {
            this.lastPlaceholderPosition = newPosition;

            // 记录当前滚动位置，防止占位符移动导致滚动跳跃
            const currentScrollTop = container.scrollTop;

            // 执行实时位置交换动画
            this.animateRealTimePositionSwap(container, newInsertBefore);

            // 恢复滚动位置，防止占位符移动导致的位置跳跃
            if (container.scrollTop !== currentScrollTop) {
                container.scrollTop = currentScrollTop;
            }
        }

        // 显示占位符
        this.placeholder.style.display = 'flex';
        this.placeholder.style.visibility = 'visible';
    }

    /**
     * 执行实时位置交换动画
     * @param {HTMLElement} container - 容器元素
     * @param {HTMLElement} newInsertBefore - 新的插入位置
     */
    animateRealTimePositionSwap(container, newInsertBefore) {
        const config = container.sortableConfig;
        const items = Array.from(container.querySelectorAll(config.itemSelector + ':not(.category-hidden)'));
        const validItems = items.filter(item => item !== this.draggedElement);

        // 记录所有静态元素的当前位置
        const currentPositions = new Map();
        validItems.forEach(item => {
            const rect = item.getBoundingClientRect();
            currentPositions.set(item, {
                top: rect.top,
                left: rect.left
            });
        });

        // 插入占位符到新位置
        if (newInsertBefore) {
            container.insertBefore(this.placeholder, newInsertBefore);
        } else {
            container.appendChild(this.placeholder);
        }

        // 获取插入占位符后的新位置
        const newPositions = new Map();
        validItems.forEach(item => {
            const rect = item.getBoundingClientRect();
            newPositions.set(item, {
                top: rect.top,
                left: rect.left
            });
        });

        // 为位置发生变化的元素添加平滑过渡动画
        validItems.forEach(item => {
            const current = currentPositions.get(item);
            const newPos = newPositions.get(item);

            if (current && newPos) {
                const deltaX = current.left - newPos.left;
                const deltaY = current.top - newPos.top;

                // 只对位置发生明显变化的元素应用动画（降低阈值使动画更容易触发）
                if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
                    // 清除之前的动画状态
                    item.style.transition = 'none';
                    item.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

                    // 强制重排
                    item.offsetHeight;

                    // 应用平滑过渡动画
                    item.style.transition = 'transform 0.25s ease-out';
                    item.style.transform = 'translate(0px, 0px)';

                    // 动画完成后清理
                    setTimeout(() => {
                        if (item.style) {
                            item.style.transition = '';
                            item.style.transform = '';
                        }
                    }, 400);
                }
            }
        });
    }

    // 处理鼠标释放事件
    handleMouseUp(e) {
        if (!this.isDragging || !this.draggedElement) return;

        const container = this.draggedContainer;
        const config = container.sortableConfig;

        // 如果没有真正开始拖拽（只是点击），直接重置状态，不阻止事件传播
        if (!this.isDragStarted) {
            this.resetDragState();
            // 不调用 e.preventDefault()，让点击事件正常传播
            return;
        }

        // 只有在真正拖拽时才阻止默认行为
        e.preventDefault();

        // 获取新的插入位置（只考虑可见的服务项）
        const visibleItems = Array.from(container.querySelectorAll(config.itemSelector + ':not(.category-hidden)'));
        const allChildren = Array.from(container.children);
        const placeholderIndex = allChildren.indexOf(this.placeholder);
        
        // 计算占位符在可见元素中的位置
        let newIndex = 0;
        for (let i = 0; i < placeholderIndex; i++) {
            const child = allChildren[i];
            if (visibleItems.includes(child)) {
                newIndex++;
            }
        }
        
        // 如果占位符在原位置之后，需要调整索引
        if (newIndex > this.draggedIndex) {
            newIndex--;
        }

        // 移除占位符
        if (this.placeholder.parentNode) {
            this.placeholder.classList.remove('show'); // 移除显示类
            this.placeholder.style.visibility = 'hidden'; // 先隐藏
            this.placeholder.parentNode.removeChild(this.placeholder);
        }

        // 恢复被拖拽元素的样式
        this.draggedElement.classList.remove('dragging');
        this.draggedElement.style.position = '';
        this.draggedElement.style.left = '';
        this.draggedElement.style.top = '';
        this.draggedElement.style.width = ''; // 清理宽度设置
        this.draggedElement.style.pointerEvents = '';
        this.draggedElement.style.zIndex = '';
        this.draggedElement.style.transform = '';
        this.draggedElement.style.opacity = '';
        this.draggedElement.style.boxShadow = '';

        // 恢复鼠标样式
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // 恢复悬停效果
        this.enableHoverEffects(container);

        // 如果位置发生了变化，执行最终排序（实时动画已经处理了大部分位置变化）
        if (newIndex !== this.draggedIndex && newIndex >= 0) {
            // 直接执行排序，不需要额外动画，因为实时动画已经处理了
            this.performSort(container, this.draggedIndex, newIndex);
        }

        // 触发结束拖拽回调
        if (config.onEnd) {
            config.onEnd(this.draggedElement, this.draggedIndex, newIndex);
        }

        // 停止自动滚动
        this.stopAutoScroll();

        // 重置状态
        this.resetDragState();
    }

    /**
     * 重置拖拽状态
     */
    resetDragState() {
        this.stopAutoScroll();

        // 重置拖拽状态
        this.isDragging = false;
        this.isDragStarted = false;
        this.draggedElement = null;
        this.draggedContainer = null;
        this.draggedIndex = -1;
        this.originalWidth = 0;
        this.lastPlaceholderPosition = null;

        // 重置位置和方向
        this.mouseDownPos = { x: 0, y: 0 };
        this.lastMouseY = 0;
        this.dragDirection = 0;
        this.initialScrollTop = 0;

        // 重置滚动状态
        this.scrollSpeed = 0;
    }

    /**
     * 执行排序操作
     * @param {HTMLElement} container - 容器元素
     * @param {number} fromIndex - 源索引
     * @param {number} toIndex - 目标索引
     */
    performSort(container, fromIndex, toIndex) {
        const config = container.sortableConfig;
        if (config.onSort) {
            config.onSort(fromIndex, toIndex);
        }
    }

    /**
     * 检查是否为交互元素
     * @param {HTMLElement} element - 要检查的元素
     * @returns {boolean} 是否为交互元素
     */
    isInteractiveElement(element) {
        const interactiveTags = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'];
        const interactiveClasses = ['model-delete-btn', 'model-test-btn', 'btn-small'];
        
        // 检查标签名
        if (interactiveTags.includes(element.tagName)) {
            return true;
        }

        // 检查类名
        for (const className of interactiveClasses) {
            if (element.classList.contains(className)) {
                return true;
            }
        }

        // 检查父元素
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
            if (interactiveTags.includes(parent.tagName) || 
                interactiveClasses.some(cls => parent.classList.contains(cls))) {
                return true;
            }
            parent = parent.parentElement;
        }

        return false;
    }

    // 禁用容器的拖拽排序
    disableSortable(container) {
        if (!container) return;

        container.removeAttribute('data-sortable');
        delete container.sortableConfig;
        this.sortableContainers.delete(container);

        // 移除所有项的拖拽事件绑定标记
        const items = container.querySelectorAll('[data-drag-bound]');
        items.forEach(item => {
            item.removeAttribute('data-drag-bound');
            const handle = item.querySelector('[style*="cursor: grab"]') || item;
            handle.style.cursor = '';
        });
    }

    // 销毁管理器
    destroy() {
        // 停止自动滚动
        this.stopAutoScroll();

        // 清理所有容器
        this.sortableContainers.forEach(container => {
            this.disableSortable(container);
        });

        // 移除全局事件监听器
        document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        document.removeEventListener('mouseup', this.handleMouseUp.bind(this));

        // 清理状态
        this.draggedElement = null;
        this.placeholder = null;
        this.sortableContainers.clear();
    }

    // 禁用拖拽时的悬停效果
    disableHoverEffects(container) {
        const config = container.sortableConfig;
        if (!config) return;

        const items = container.querySelectorAll(config.itemSelector);
        items.forEach(item => {
            item.style.pointerEvents = 'none';
        });
    }

    // 恢复拖拽后的悬停效果
    enableHoverEffects(container) {
        const config = container.sortableConfig;
        if (!config) return;

        const items = container.querySelectorAll(config.itemSelector);
        items.forEach(item => {
            if (item !== this.draggedElement) {
                item.style.pointerEvents = '';
            }
        });
    }



    // 处理边缘滚动
    handleAutoScroll(e) {
        if (!this.draggedContainer) return;

        const containerRect = this.draggedContainer.getBoundingClientRect();
        const mouseY = e.clientY;

        // 计算鼠标相对于容器的位置
        const relativeY = mouseY - containerRect.top;
        const containerHeight = containerRect.height;

        // 检查鼠标是否在容器范围内
        if (relativeY < 0 || relativeY > containerHeight) {
            // 鼠标在容器外，停止滚动
            this.stopAutoScroll();
            return;
        }

        // 检查容器是否可以滚动
        const canScrollUp = this.draggedContainer.scrollTop > 0;
        const canScrollDown = this.draggedContainer.scrollTop <
            (this.draggedContainer.scrollHeight - this.draggedContainer.clientHeight);

        // 检查是否在滚动区域内，并结合拖拽方向进行智能判断
        let scrollDirection = 0;
        let distanceFromEdge = 0;

        // 接近顶部边缘
        if (relativeY < this.scrollZoneSize && canScrollUp) {
            // 只有在向上拖拽时才触发向上滚动，或者没有明确方向时也允许
            if (this.dragDirection <= 0) {
                scrollDirection = -1;
                distanceFromEdge = this.scrollZoneSize - relativeY;
            }
        }

        // 接近底部边缘
        if (relativeY > containerHeight - this.scrollZoneSize && canScrollDown) {
            // 只有在向下拖拽时才触发向下滚动，或者没有明确方向时也允许
            if (this.dragDirection >= 0) {
                scrollDirection = 1;
                distanceFromEdge = relativeY - (containerHeight - this.scrollZoneSize);
            }
        }

        // 特殊处理：如果拖拽方向为0（刚开始拖拽），允许根据位置自动判断滚动方向
        if (this.dragDirection === 0 && scrollDirection === 0) {
            if (relativeY < this.scrollZoneSize && canScrollUp) {
                scrollDirection = -1;
                distanceFromEdge = this.scrollZoneSize - relativeY;
            } else if (relativeY > containerHeight - this.scrollZoneSize && canScrollDown) {
                scrollDirection = 1;
                distanceFromEdge = relativeY - (containerHeight - this.scrollZoneSize);
            }
        }

        // 额外的智能检测：如果拖拽方向与边缘位置一致，增强滚动效果
        if (scrollDirection !== 0) {
            // 计算基础滚动速度（距离边缘越近，滚动越快）
            const speedRatio = Math.min(distanceFromEdge / this.scrollZoneSize, 1);
            let finalSpeed = speedRatio * this.maxScrollSpeed * scrollDirection;

            // 如果拖拽方向与滚动方向一致，增加滚动速度
            if ((this.dragDirection > 0 && scrollDirection > 0) ||
                (this.dragDirection < 0 && scrollDirection < 0)) {
                finalSpeed *= 1.3; // 增加30%的速度
            }

            this.scrollSpeed = finalSpeed;

            // 开始自动滚动
            this.startAutoScroll();
        } else {
            // 停止自动滚动
            this.stopAutoScroll();
        }
    }

    // 开始自动滚动
    startAutoScroll() {
        if (this.autoScrollTimer) return; // 已经在滚动中

        this.autoScrollTimer = setInterval(() => {
            if (!this.draggedContainer || this.scrollSpeed === 0) {
                this.stopAutoScroll();
                return;
            }

            // 执行滚动
            const currentScrollTop = this.draggedContainer.scrollTop;
            const newScrollTop = currentScrollTop + this.scrollSpeed;

            // 检查滚动边界
            const maxScrollTop = this.draggedContainer.scrollHeight - this.draggedContainer.clientHeight;

            if (newScrollTop >= 0 && newScrollTop <= maxScrollTop) {
                // 使用平滑滚动
                this.draggedContainer.scrollTop = newScrollTop;

                // 滚动后更新占位符位置，确保拖拽体验的连贯性
                if (this.isDragStarted && this.draggedElement) {
                    // 滚动后更新占位符位置，确保拖拽体验的连贯性
                    this.updatePlaceholder();
                }
            } else {
                // 到达边界，停止滚动
                this.stopAutoScroll();
            }
        }, 16); // 约60fps的滚动频率
    }

    /**
     * 停止自动滚动
     */
    stopAutoScroll() {
        if (this.autoScrollTimer) {
            clearInterval(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
        this.scrollSpeed = 0;
    }
}

// 导出拖拽排序管理器
window.DragSortManager = DragSortManager;

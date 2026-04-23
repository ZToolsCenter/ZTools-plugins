import { showTooltip, hideTooltip } from './notification.js';

let tooltipTimer;

// 标签相关函数
export function initializeTagButton(line) {
    const tagButton = line.querySelector('.tag-button');
    tagButton.addEventListener('click', (e) => {
        e.stopPropagation();
        showTagInput(line);
    });
    
    tagButton.addEventListener('mouseenter', (e) => {
        if (tooltipTimer) clearTimeout(tooltipTimer);
        
        tooltipTimer = setTimeout(() => {
            const rect = tagButton.getBoundingClientRect();
            // 检查是否已经存在标签，显示相应的提示
            const existingTag = line.querySelector('.tag');
            const tooltipText = existingTag ? '修改标签' : '添加标签';
            showTooltip(tooltipText, rect.right + 5, rect.bottom + 5);
        }, 300);
    });
    
    tagButton.addEventListener('mouseleave', () => {
        if (tooltipTimer) {
            clearTimeout(tooltipTimer);
        }
        hideTooltip();
    });
}

export function showTagInput(line) {
    const tagContainer = line.querySelector('.tag-container');
    
    // 如果已经有标签，则预填充
    const existingTag = tagContainer.querySelector('.tag');
    const existingValue = existingTag ? existingTag.textContent : '';
    
    // 移除已存在的输入框（如果有的话）
    const existingInput = tagContainer.querySelector('.tag-input-container');
    if (existingInput) {
        existingInput.remove();
    }
    
    // 创建输入框
    const inputContainer = document.createElement('div');
    inputContainer.className = 'tag-input-container active';
    inputContainer.innerHTML = `
        <input type="text" class="tag-input" placeholder="输入标签" value="${existingValue}">
    `;
    
    // 如果存在标签，暂时隐藏它
    if (existingTag) {
        existingTag.style.display = 'none';
    }
    
    // 阻止事件冒泡
    inputContainer.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    
    inputContainer.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    tagContainer.appendChild(inputContainer);
    
    const input = inputContainer.querySelector('.tag-input');
    
    // 选中输入框中的所有文本
    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
    
    let isProcessing = false;
    
    const closeInput = (shouldRestoreTag = true) => {
        if (isProcessing) return;
        isProcessing = true;
        
        if (shouldRestoreTag && existingTag) {
            existingTag.style.display = 'inline-flex';
        }
        inputContainer.remove();
        
        setTimeout(() => {
            isProcessing = false;
        }, 100);
    };
    
    // 处理输入事件
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = input.value.trim();
            if (value) {
                setTag(line, value);
                closeInput(false);
            } else {
                closeInput(true);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeInput(true);
        }
    });
    
    // 处理失焦事件
    let blurTimeout;
    input.addEventListener('blur', (e) => {
        if (blurTimeout) {
            clearTimeout(blurTimeout);
        }
        
        // 使用较短的延迟，但要确保不会立即触发
        blurTimeout = setTimeout(() => {
            // 检查当前焦点是否在输入框容器内
            if (!inputContainer.contains(document.activeElement)) {
                closeInput(true);
            }
        }, 50);
    });
}

export function setTag(line, tagText) {
    const tagContainer = line.querySelector('.tag-container');
    const tagButton = tagContainer.querySelector('.tag-button');
    
    // 如果传入空值，则清除标签
    if (!tagText) {
        const existingTag = tagContainer.querySelector('.tag');
        if (existingTag) {
            existingTag.remove();
        }
        // 同时清除删除按钮
        const existingDeleteBtn = tagContainer.querySelector('.tag-delete-btn');
        if (existingDeleteBtn) {
            existingDeleteBtn.remove();
        }
        return;
    }
    
    // 移除现有标签和删除按钮
    const existingTag = tagContainer.querySelector('.tag');
    const existingDeleteBtn = tagContainer.querySelector('.tag-delete-btn');
    if (existingTag) {
        existingTag.remove();
    }
    if (existingDeleteBtn) {
        existingDeleteBtn.remove();
    }
    
    // 创建新标签
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = tagText;
    
    // 创建独立的删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tag-delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = '删除标签';
    
    // 在按钮后面添加标签和删除按钮
    tagContainer.appendChild(tag);
    tagContainer.appendChild(deleteBtn);
    
    // 删除按钮点击事件
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tag.remove();
        deleteBtn.remove();
        
        // 清除提示框
        if (tooltipTimer) {
            clearTimeout(tooltipTimer);
        }
        hideTooltip();
    });
    
    // 标签点击事件（只用于编辑）
    tag.addEventListener('click', (e) => {
        e.stopPropagation();
        showTagInput(line);
    });
    
    // 标签悬停事件处理
    tag.addEventListener('mouseenter', (e) => {
        if (tooltipTimer) clearTimeout(tooltipTimer);
        
        // 显示删除按钮
        deleteBtn.style.opacity = '1';
        deleteBtn.style.pointerEvents = 'auto';
        
        tooltipTimer = setTimeout(() => {
            const rect = tag.getBoundingClientRect();
            showTooltip('点击编辑', rect.right + 5, rect.bottom + 5);
        }, 300);
    });
    
    tag.addEventListener('mouseleave', (e) => {
        if (tooltipTimer) {
            clearTimeout(tooltipTimer);
        }
        hideTooltip();
        
        // 延迟隐藏删除按钮，给用户时间移动到删除按钮上
        setTimeout(() => {
            // 检查鼠标是否在tag或删除按钮上
            const isOverTag = tag.matches(':hover');
            const isOverDeleteBtn = deleteBtn.matches(':hover');
            
            if (!isOverTag && !isOverDeleteBtn) {
                deleteBtn.style.opacity = '0';
                deleteBtn.style.pointerEvents = 'none';
            }
        }, 300);
    });
    
    // 删除按钮悬停事件处理
    deleteBtn.addEventListener('mouseenter', (e) => {
        // 保持删除按钮可见
        deleteBtn.style.opacity = '1';
        deleteBtn.style.pointerEvents = 'auto';
    });
    
    deleteBtn.addEventListener('mouseleave', (e) => {
        // 延迟隐藏删除按钮，给用户时间移动到tag上
        setTimeout(() => {
            // 检查鼠标是否在tag或删除按钮上
            const isOverTag = tag.matches(':hover');
            const isOverDeleteBtn = deleteBtn.matches(':hover');
            
            if (!isOverTag && !isOverDeleteBtn) {
                deleteBtn.style.opacity = '0';
                deleteBtn.style.pointerEvents = 'none';
            }
        }, 100);
    });
}

// 添加恢复标签的接口
export function restoreTag(line, tagText) {
    if (!tagText) return;
    
    const tagContainer = line.querySelector('.tag-container');
    if (!tagContainer) return;
    
    // 清除现有标签、输入框和删除按钮
    const existingTag = tagContainer.querySelector('.tag');
    const existingInput = tagContainer.querySelector('.tag-input-container');
    const existingDeleteBtn = tagContainer.querySelector('.tag-delete-btn');
    if (existingTag) existingTag.remove();
    if (existingInput) existingInput.remove();
    if (existingDeleteBtn) existingDeleteBtn.remove();
    
    // 使用 setTag 设置新标签
    setTag(line, tagText);
}

// 导出创建标签容器的HTML
export function createTagContainerHTML(lineNumber = 1) {
    return `
        <div class="tag-container">
            <button class="tag-button">
                <span class="tag-icon">$${lineNumber}</span>
            </button>
        </div>
    `;
}
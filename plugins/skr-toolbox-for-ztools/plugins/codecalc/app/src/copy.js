import { notification } from './notification.js';

// 复制到剪贴板的功能
function copyToClipboard(text) {
    // 创建临时文本区域
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
        document.execCommand('copy');
        notification.info('已复制到剪贴板', 1000);
    } catch (err) {
        console.error('复制失败:', err);
        notification.error('复制失败', 1000);
    }
    
    document.body.removeChild(textarea);
}

// 为结果添加点击事件处理
function addResultClickHandler(resultElement) {
    resultElement.addEventListener('click', function() {
        // 如果已经在复制状态，直接返回
        if (this.classList.contains('copied') || this.classList.contains('error')) {
            return;
        }
        
        let resultValue = this.querySelector('.result-value').textContent;
        
        // 获取整个计算表达式
        const onlyCopyRsltToggle = document.getElementById('onlyCopyRsltToggle');
        if (!onlyCopyRsltToggle.checked) {
            // 获取输入表达式
            const expressionText = this.closest('.expression-line').querySelector('textarea');
            if (expressionText) {
                resultValue = expressionText.value + ' = ' + resultValue;
            }
        }

        if (resultValue.trim()) {
            copyToClipboard(resultValue);
            
            // 添加已复制状态
            this.classList.add('copied');
            
            // 1.5秒后自动移除复制状态
            setTimeout(() => {
                this.classList.remove('copied');
            }, 1500);
        }
    });
}

// 为现有的结果元素添加点击处理
document.addEventListener('DOMContentLoaded', function() {
    const results = document.querySelectorAll('.result');
    results.forEach(addResultClickHandler);
}); 

// 导出函数
export {
    copyToClipboard,
    addResultClickHandler
}; 
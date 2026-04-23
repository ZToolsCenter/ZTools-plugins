const FUNCTIONS = window.CodeCalcCore.FUNCTIONS;
const CONSTANTS = window.CodeCalcCore.CONSTANTS;


// 从 OPERATORS 和 FUNCTIONS 中生成补全列表
function generateCompletions() {
    const completions = [];
    
    // 添加函数名（按函数名排序）
    const sortedFunctionNames = Object.keys(FUNCTIONS)
        // 排除以数字开头的函数名（如 0b, 0o, 0x）
        .filter(funcName => !/^\d/.test(funcName))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    // 添加函数名（带括号）
    for (const funcName of sortedFunctionNames) {
        const func = FUNCTIONS[funcName];

        // 如果是属性函数，额外添加 .funcName 形式
        if (func.asProperty) {
            completions.push(`.${funcName}`);
        } 
        
         // 如果不是隐藏函数，添加到补全列表
        if (func.hidden) {
            // console.log(`隐藏函数: ${funcName}`);
            continue;
        }else{
            completions.push(`${funcName}(`);
        }
    }
    
    // 添加常量
    for (const constName of Object.keys(CONSTANTS)) {
        completions.push(constName);
    }
    
    // 添加特殊运算符
    const specialOperators = ['**'];
    for (const op of specialOperators) {
        completions.push(`${op}(`);
    }
    
    // 添加进制前缀
    const prefixes = ['0b', '0o', '0x'];
    completions.push(...prefixes);

    //打印补全列表
    // console.log(completions);
    
    return completions;
}

// 生成补全列表
let completions = generateCompletions();

// 手动刷新补全列表的函数
function refreshCompletions() {
    completions = generateCompletions();
}

// 全局变量
let isCompletionEnabled = true;
let hasUsedArrowKeys = false;

// 获取所有函数的首字母集合
const functionFirstChars = new Set(
    Object.keys(FUNCTIONS)
        .filter(name => /^[a-zA-Z]/.test(name))
        .map(name => name[0].toLowerCase())
);

// 显示补全提示
function showCompletionHint(input, matches, isPropertyCompletion) {
    removeCompletionHint(input);
    
    const hint = document.createElement('div');
    hint.className = 'completion-hint';
    
    const list = document.createElement('ul');
    list.className = 'completion-list';
    
    // 只显示前5个匹配项
    const displayMatches = matches.slice(0, 5);
    
    displayMatches.forEach((match, index) => {
        const item = document.createElement('li');
        item.className = 'completion-item';
        
        // 添加类型标记
        const type = isPropertyCompletion ? 'property' : 
                    match.endsWith('(') ? 'function' : 'constant';
        item.setAttribute('data-type', type);
        
        // 添加主要文本
        const text = document.createElement('span');
        text.className = 'text';
        text.textContent = match;
        item.appendChild(text);
        
        // 添加函数描述信息
        if (FUNCTIONS[match.replace(/[(.]/g, '')]) {
            const desc = document.createElement('span');
            desc.className = 'description';
            desc.textContent = FUNCTIONS[match.replace(/[(.]/g, '')].description;
            desc.style.display = 'none';
            item.appendChild(desc);
        }
        
        // 默认选中第一项
        if (index === 0) {
            item.classList.add('selected');
            const desc = item.querySelector('.description');
            if (desc) {
                desc.style.display = '';
            }
        }
        
        // 添加点击事件处理
        const handler = createCompletionItemHandler(input, match, isPropertyCompletion, item);
        item.addEventListener('click', handler, { once: true });
        
        list.appendChild(item);
    });
    
    hint.appendChild(list);
    input.parentElement.appendChild(hint);
    
    // 计算提示框位置
    positionCompletionHint(input, hint);
}

// 计算并设置补全提示框的位置
function positionCompletionHint(input, hint) {
    const cursorPos = input.selectionStart;
    const textBeforeCursor = input.value.substring(0, cursorPos);
    
    // 获取输入框的位置和样式信息
    const inputRect = input.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(input);
    const paddingLeft = parseFloat(computedStyle.paddingLeft);
    
    // 创建 canvas 来测量文本
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = computedStyle.font;
    
    // 获取当前行的文本
    const lines = textBeforeCursor.split('\n');
    const currentLine = lines[lines.length - 1];
    
    // 计算当前行之前的换行次数
    const explicitLineBreaks = lines.length - 1;
    
    // 计算文本宽度和换行
    let remainingText = currentLine;
    let wrappedLines = 0;
    let finalLineWidth = 0;
    // 修改这里：考虑输入框的内部padding
    const maxWidth = input.clientWidth - (parseFloat(computedStyle.paddingLeft) + parseFloat(computedStyle.paddingRight));
    
    while (remainingText.length > 0) {
        let testWidth = ctx.measureText(remainingText).width;
        if (testWidth <= maxWidth) {
            finalLineWidth = testWidth;
            break;
        }
        
        // 找到合适的断行点
        let breakPoint = remainingText.length;
        while (breakPoint > 0) {
            breakPoint--;
            if (ctx.measureText(remainingText.substring(0, breakPoint)).width <= maxWidth) {
                wrappedLines++;
                remainingText = remainingText.substring(breakPoint);
                break;
            }
        }
    }
    
    // 计算总行数和最终位置
    const totalLines = explicitLineBreaks + wrappedLines;
    const lineHeight = parseFloat(computedStyle.lineHeight);
    
    // 修改这里：考虑输入框的左边距和padding
    const cursorX = inputRect.left + paddingLeft + finalLineWidth;
    const cursorY = inputRect.top + (totalLines * lineHeight) + parseFloat(computedStyle.paddingTop);
    
    // 获取提示框尺寸
    const hintRect = hint.getBoundingClientRect();
    
    // 计算最终位置
    let left = cursorX;
    let top = cursorY + lineHeight;
    
    // 处理右边界溢出
    if (left + hintRect.width > window.innerWidth) {
        left = Math.max(0, cursorX - hintRect.width);
    }
    
    // 处理底部溢出
    if (top + hintRect.height > window.innerHeight) {
        top = cursorY - hintRect.height - 2;
    }
    
    // 设置位置
    hint.style.position = 'fixed';
    hint.style.left = `${left}px`;
    hint.style.top = `${top}px`;
}

// 移除补全提示
function removeCompletionHint(input) {
    document.querySelectorAll('.completion-hint').forEach(hint => {
        hint.dispatchEvent(new Event('remove'));
        hint.remove();
    });
    hasUsedArrowKeys = false;
}

// 导航补全选项
function navigateCompletion(direction) {
    const hint = document.querySelector('.completion-hint');
    if (!hint) return;

    const items = Array.from(hint.querySelectorAll('.completion-item'));
    const selectedItem = hint.querySelector('.completion-item.selected');
    let nextIndex = 0;

    if (selectedItem) {
        const currentDesc = selectedItem.querySelector('.description');
        if (currentDesc) {
            currentDesc.style.display = 'none';
        }

        const currentIndex = items.indexOf(selectedItem);
        if (direction === 'prev') {
            nextIndex = (currentIndex - 1 + items.length) % items.length;
        } else {
            nextIndex = (currentIndex + 1) % items.length;
        }
        selectedItem.classList.remove('selected');
    } else if (direction === 'prev') {
        nextIndex = items.length - 1;
    }

    items[nextIndex].classList.add('selected');
    const newDesc = items[nextIndex].querySelector('.description');
    if (newDesc) {
        newDesc.style.display = '';
    }
}

// 应用选中的补全项
function applySelectedCompletion(input) {
    const hint = document.querySelector('.completion-hint');
    if (!hint) return;

    const selectedItem = hint.querySelector('.completion-item.selected');
    if (selectedItem) {
        const textElement = selectedItem.querySelector('.text');
        const match = textElement.textContent;
        const isPropertyCompletion = selectedItem.getAttribute('data-type') === 'property';
        applyCompletion(input, match, isPropertyCompletion);
    }
}

// 创建补全项的点击处理函数
function createCompletionItemHandler(input, match, isPropertyCompletion, item) {
    return function handler(event) {
        event.preventDefault(); // 阻止默认行为
        event.stopPropagation(); // 阻止冒泡
        applyCompletion(input, match, isPropertyCompletion);
        item.removeEventListener('click', handler); // 恢复这行
        removeCompletionHint(input); // 恢复这行
    };
}

// 应用补全
function applyCompletion(input, match, isPropertyCompletion) {
    const cursorPos = input.selectionStart;
    const textBeforeCursor = input.value.substring(0, cursorPos);
    const afterCursor = input.value.substring(cursorPos);
    
    const completionText = match.split(/\s+/)[0];
    
    if (isPropertyCompletion) {
        const dotMatch = textBeforeCursor.match(/\.([a-zA-Z0-9]*)$/);
        if (dotMatch) {
            const beforeDot = textBeforeCursor.slice(0, -dotMatch[0].length);
            input.value = beforeDot + '.' + completionText + afterCursor;
            const newCursorPos = beforeDot.length + completionText.length + 1;
            input.setSelectionRange(newCursorPos, newCursorPos);
        }
    } else {
        const wordMatch = textBeforeCursor.match(/[a-zA-Z][a-zA-Z]*$/);
        const beforeWord = wordMatch ? 
            textBeforeCursor.slice(0, -wordMatch[0].length) : 
            textBeforeCursor;
        
        if (completionText.endsWith('(')) {
            input.value = beforeWord + completionText + ')' + afterCursor;
            const newCursorPos = beforeWord.length + completionText.length;
            input.setSelectionRange(newCursorPos, newCursorPos);
        } else {
            input.value = beforeWord + completionText + afterCursor;
            const newCursorPos = beforeWord.length + completionText.length;
            input.setSelectionRange(newCursorPos, newCursorPos);
        }
    }
    
    input.dispatchEvent(new Event('input'));
    removeCompletionHint(input);
}

// 简化补全触发逻辑
function shouldTriggerCompletion(input, key) {
    // 检查补全功能是否开启
    if (!document.getElementById('completionToggle').checked) {
        return false;
    }
    
    const cursorPos = input.selectionStart;
    const textBeforeCursor = input.value.substring(0, cursorPos);
    
    // 如果光标前有#，不触发任何补全
    if (textBeforeCursor.includes('#')) {
        return false;
    }
    
    // 只在输入字母或点号时触发补全
    return key.match(/[a-zA-Z]/) || key === '.';
}

// 简化补全检查逻辑
function checkCompletion(input) {
    // 检查补全功能是否开启
    if (!document.getElementById('completionToggle').checked) {
        return;
    }

    const cursorPos = input.selectionStart;
    const textBeforeCursor = input.value.substring(0, cursorPos);

    // 如果光标前有#，不进行任何补全
    if (textBeforeCursor.includes('#')) {
        return;
    }

    // 检查是否是属性函数补全
    const dotMatch = textBeforeCursor.match(/\.([a-zA-Z]*)$/);
    if (dotMatch) {
        // 只显示属性函数
        const propertyMatches = completions
            .filter(funcname => 
                funcname.startsWith('.') && 
                (!dotMatch[1] || funcname.substring(1).toLowerCase().startsWith(dotMatch[1].toLowerCase()))
            )
            .map(funcname => funcname.substring(1));
        
        if (propertyMatches.length > 0) {
            showCompletionHint(input, propertyMatches, true);
            return;
        }
    }

    // 普通函数补全
    const wordMatch = textBeforeCursor.match(/[a-zA-Z][a-zA-Z]*$/);
    if (wordMatch) {
        const word = wordMatch[0].toLowerCase();
        const matches = completions
            .filter(name => name.toLowerCase().startsWith(word));
        
        if (matches.length > 0) {
            showCompletionHint(input, matches, false);
        }
    } else {
        removeCompletionHint(input); // 如果没有匹配，移除补全提示
    }
}

// 处理补全相关的按键事件
function handleCompletionKeyDown(event, input) {
    // 检查补全功能是否开启
    if (!document.getElementById('completionToggle').checked) {
        return false;
    }

    const hint = document.querySelector('.completion-hint');
    
    // 处理 ESC 键
    if (event.key === 'Escape') {
        event.preventDefault();
        if (hint) {
            removeCompletionHint(input);
            return true;
        }
        return false;
    }

    if (!hint) return false;

    switch (event.key) {
        case 'ArrowUp':
        case 'ArrowDown':
            if (isCompletionEnabled) {
                event.preventDefault();
                navigateCompletion(event.key === 'ArrowUp' ? 'prev' : 'next');
                return true;
            }
            break;

        case 'Enter':
            if (isCompletionEnabled && hint.querySelector('.completion-item.selected')) {
                event.preventDefault();
                applySelectedCompletion(input);
                return true;
            }
            break;

        case 'Tab':
            if (isCompletionEnabled) {
                event.preventDefault();
                applySelectedCompletion(input);
                return true;
            }
            break;

    }

    return false;
}

export {
    completions,
    refreshCompletions,
    isCompletionEnabled,
    hasUsedArrowKeys,
    showCompletionHint,
    removeCompletionHint,
    navigateCompletion,
    applySelectedCompletion,
    checkCompletion,
    handleCompletionKeyDown,
    shouldTriggerCompletion
};

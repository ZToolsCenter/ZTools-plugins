import * as Copy from './copy.js';
import * as Tag from './tag.js';
import { ensureSettings } from './settings.js';
import { ensureShortcuts } from './shortcuts.js';
import { ensureCustomFunctions } from './custom-functions.js';
import { ensureSnapshot } from './snapshot.js';
import { isMacOS, storage } from './host.js';
import {
    isCompletionEnabled,
    removeCompletionHint,
    checkCompletion,
    handleCompletionKeyDown,
    shouldTriggerCompletion,
    refreshCompletions
} from './completion.js';
import { notification } from './notification.js';


const Calculator = window.CodeCalcCore.Calculator;
const OPERATORS = window.CodeCalcCore.OPERATORS;
const FUNCTIONS = window.CodeCalcCore.FUNCTIONS;
const CONSTANTS = window.CodeCalcCore.CONSTANTS;
const updateCustomFromStorage = window.CodeCalcCore.updateCustomFromStorage;
const isFunctionDefinition = window.CodeCalcCore.isFunctionDefinition;
const isConstantDefinition = window.CodeCalcCore.isConstantDefinition;

const ASSIGNMENT_OPERATORS = Object.keys(OPERATORS || {})
    .filter(op => OPERATORS[op] && OPERATORS[op].isCompoundAssignment === true);
const COMPOUND_ASSIGNMENT_OPERATORS = ASSIGNMENT_OPERATORS
    .filter(op => op !== '=')
    .sort((a, b) => b.length - a.length);

const customFunctionsStorage = storage;
const inlineEditableCustomKeys = new Set();
let expressionLineIdSeed = 1;

function isMacOSPlatform() {
    return isMacOS();
}

function getStoredCustomFunctions() {
    try {
        return JSON.parse(customFunctionsStorage.getItem('customFunctions') || '{}');
    } catch (e) {
        return {};
    }
}

function createExpressionLineId() {
    const lineId = `line-${expressionLineIdSeed}`;
    expressionLineIdSeed += 1;
    return lineId;
}

function ensureExpressionLineId(expressionLine) {
    if (!expressionLine) return '';
    if (!expressionLine.dataset.lineId) {
        expressionLine.dataset.lineId = createExpressionLineId();
    }
    return expressionLine.dataset.lineId;
}


function parseCustomDefinition(expression) {
    const e = (expression || '').trim();
    if (!e) return null;
    if (!isFunctionDefinition(e) && !isConstantDefinition(e)) return null;

    const isFunc = isFunctionDefinition(e);
    const expType = isFunc ? 'function' : 'constant';
    let name;
    let params = [];

    if (isFunc) {
        const match = e.match(/^([a-zA-Z_$][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*=\s*(.+)$/);
        if (!match) return null;
        name = match[1];
        const paramStr = match[2].trim();
        params = paramStr ? paramStr.split(',').map(p => p.trim()) : [];
    } else {
        const match = e.match(/^([a-zA-Z_$][a-zA-Z0-9_]*)\s*:\s*=\s*/);
        if (!match) return null;
        name = match[1];
    }

    return { name, params, expType, definition: e };
}

document.addEventListener('DOMContentLoaded', function() {
    initializeUI();
});


function AddCustomFunctions() {
    updateCustomFromStorage(Calculator, FUNCTIONS, CONSTANTS);
    refreshCompletions();
    refreshHighlightRegexes();
    refreshAllInputHighlights();
}

// 将单条满足函数/常数定义的表达式写入 storage
function addNewFunction(input, expression) {
    const parsed = parseCustomDefinition(expression);
    if (!parsed) {
        return { handled: false, saved: false };
    }

    const { name, params, expType, definition } = parsed;
    const customKey = `${expType}:${name}`;
    const stored = getStoredCustomFunctions();
    const existing = stored[name];
    const canEditInCurrentPage = inlineEditableCustomKeys.has(customKey);

    if (existing && !canEditInCurrentPage) {
        const customTypeText = expType === 'function' ? '函数' : '常数';
        return {
            handled: true,
            saved: false,
            blocked: true,
            name,
            expType,
            message: `自定义${customTypeText} "${name}" 已存在，计算页不允许直接覆盖，请到管理页面修改`
        };
    }

    stored[name] = {
        name,
        params,
        definition,
        description: (existing && existing.description) ? existing.description : '',
        expType
    };
    customFunctionsStorage.setItem('customFunctions', JSON.stringify(stored));
    if (!existing) {
        inlineEditableCustomKeys.add(customKey);
    }
    return { handled: true, saved: true, blocked: false, name, expType };
}

// 防抖函数
const debounce = (fn, delay) => {
    let timer = null;
    return function(...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
};

// 实际的 resize 处理函数
function handleResize(textarea) {
    // 重置高度以获取正确的 scrollHeight
    textarea.style.height = 'auto';
    
    // 检查是否为当前激活的输入框
    const isActive = document.activeElement === textarea;
    
    // 文本长度阈值常量
    const TEXT_LENGTH_THRESHOLD = 25;
    
    if (isActive) {
        // 获取输入的字符数
        const textLength = textarea.value.length;
        
        // 激活状态：根据内容判断是否需要多行
        if (textLength > TEXT_LENGTH_THRESHOLD) {
            textarea.classList.add('multiline');
        } else {
            textarea.classList.remove('multiline');
        }
        // 设置实际高度
        textarea.style.height = textarea.scrollHeight + 'px';
    } else {
        // 非激活状态：强制单行显示
        textarea.classList.remove('multiline');
        textarea.style.height = '';  // 移除手动设置的高度，使用 CSS 默认值
    }

    // 粘贴长文本触发 multiline 时，立即同步高亮层，避免光标与文本错位
    syncInputHighlightForTextarea(textarea);
}

// 添加焦点处理函数
function handleFocus(event) {
    const textarea = event.target;
    if (!textarea.classList.contains('input')) return;
    
    // 重新计算当前获得焦点的输入框大小
    handleResize(textarea);
}

function handleBlur(event) {
    const textarea = event.target;
    if (!textarea.classList.contains('input')) return;
    
    // 失去焦点时重置为单行
    textarea.classList.remove('multiline');
    textarea.style.height = '';  // 移除手动设置的高度，使用 CSS 默认值

}

// 使用防抖包装的 autoResize 函数
const autoResize = debounce(handleResize, 16);  // 约等于一帧的时间

// 更新所有行的行号
function updateLineNumbers() {
    const lines = document.querySelectorAll('.expression-line');
    lines.forEach((line, index) => {
        const tagIcon = line.querySelector('.tag-icon');
        if (tagIcon) {
            tagIcon.textContent = `$${index + 1}`;
        }
    });
}

function remapLineReferencesAfterDelete(deletedLineNumber) {
    const lines = document.querySelectorAll('.expression-line');
    lines.forEach(line => {
        const lineInput = line.querySelector('.input');
        if (!lineInput || !lineInput.value) return;

        const updatedValue = lineInput.value.replace(/\$(\d+)\b/g, (match, numStr) => {
            const num = Number(numStr);
            // 删除第 n 行后，引用该行的变量标记为 $del
            if (num === deletedLineNumber) {
                return `$del-${deletedLineNumber}`;
            }
            // 删除第 n 行后，后续行号前移一位
            if (num > deletedLineNumber) {
                return `$${num - 1}`;
            }
            return match;
        });

        if (updatedValue !== lineInput.value) {
            lineInput.value = updatedValue;
            lineInput.dispatchEvent(new Event('input'));
        }
    });
}

function remapLineReferencesAfterInsert(insertedLineNumber) {
    const lines = document.querySelectorAll('.expression-line');
    lines.forEach(line => {
        const lineInput = line.querySelector('.input');
        if (!lineInput || !lineInput.value) return;

        const updatedValue = lineInput.value.replace(/\$(\d+)\b/g, (match, numStr) => {
            const num = Number(numStr);
            // 在第 n 行插入新行后，原 n 及后续行号都后移一位
            if (num >= insertedLineNumber) {
                return `$${num + 1}`;
            }
            return match;
        });

        if (updatedValue !== lineInput.value) {
            lineInput.value = updatedValue;
            lineInput.dispatchEvent(new Event('input'));
        }
    });
}

function CreateNewLine(lineNumber = null) {
    // 如果没有提供行号，计算当前行数
    if (lineNumber === null) {
        const lines = document.querySelectorAll('.expression-line');
        lineNumber = lines.length + 1;
    }
    
    // 创建新行
    const newLine = document.createElement('div');
    newLine.className = 'expression-line';
    ensureExpressionLineId(newLine);
    newLine.innerHTML = `
        ${Tag.createTagContainerHTML(lineNumber)}
        <div class="expression-input">
            <div class="input-highlight"></div>
            <textarea class="input" 
                      placeholder="输入表达式" 
                      rows="1"
                      oninput="handleInput(event); autoResize(this)"
                      onkeydown="handleKeyDown(event, this)"
                      onfocus="handleFocus(event)"
                      onblur="handleBlur(event)"
                      onclick="removeCompletionHint(this)"></textarea>
        </div>
        <div class="result-container">
            <div class="result">
                <span class="result-value"></span>
            </div>
            <div class="message-icon" style="display: none;">
                <div class="message-text"></div>
            </div>
        </div>
    `;

    return newLine;
}

function addNewLine(moveCursor=true) {
    const container = document.getElementById('expression-container');
    const lines = document.querySelectorAll('.expression-line');
    
    const newLine = CreateNewLine();
    
    container.appendChild(newLine);
    
    // 初始化标签功能
    Tag.initializeTagButton(newLine);

    // 初始化语法高亮
    attachInputHighlight(newLine);
    
    // 为新行的结果添加点击处理
    const result = newLine.querySelector('.result');
    addResultClickHandler(result);
    
    const input = newLine.querySelector('.input');
    if (moveCursor) {
        input.focus();
    }
}

function insertNewLine(currentLine) {
    const container = document.getElementById('expression-container');
    const lines = document.querySelectorAll('.expression-line');
    const currentIndex = Array.from(lines).indexOf(currentLine);
    const insertedLineNumber = currentIndex + 2;
    
    // 检查下一行是否存在且为空， 直接聚焦到下一行
    if (currentIndex < lines.length - 1) {
        const nextLine = lines[currentIndex + 1];
        const nextInput = nextLine.querySelector('.input');
        if (nextInput.value.trim() === '') {
            // 如果下一行为空，直接聚焦到下一行
            nextInput.focus();
            return;
        }
    }
    
    const newLine = CreateNewLine();
    
    // 如果是最后一行，直接添加
    if (currentIndex === lines.length - 1) {
        container.appendChild(newLine);
    } else {
        // 否则，将当前行后面的所有行下移
        const tempValues = [];
        // 保存所有需要下移的行的内容
        for (let i = currentIndex + 1; i < lines.length; i++) {
            tempValues.push({
                value: lines[i].querySelector('.input').value,
                index: i
            });
        }
        
        // 插入新行
        currentLine.insertAdjacentElement('afterend', newLine);
        
        // 恢复下移的行的内容并重新计算结果
        const newLines = document.querySelectorAll('.expression-line');
        tempValues.forEach((item) => {
            const input = newLines[item.index + 1].querySelector('.input');
            input.value = item.value;
            calculateLine(input);
        });
    }
    
    // 初始化标签功能
    Tag.initializeTagButton(newLine);

    // 初始化语法高亮（插入行同样需要）
    attachInputHighlight(newLine);

    // 插入第 n 行后，将所有 $m (m >= n) 调整为 $(m+1)
    remapLineReferencesAfterInsert(insertedLineNumber);
    
    // 为新行的结果添加点击处理
    const result = newLine.querySelector('.result');
    addResultClickHandler(result);
    
    // 聚焦到新行
    const newInput = newLine.querySelector('.input');
    newInput.focus();

    // 重新计算所有行的结果
    recalculateAllLines();
}


function handleLineDelete(input) {
    const lines = document.querySelectorAll('.expression-line');
    const currentLine = input.closest('.expression-line');
    const currentIndex = Array.from(lines).indexOf(currentLine);
    const deletedLineNumber = currentIndex + 1;
    
    // 如果只有一行，则清空内容
    if (lines.length === 1) {
        input.value = '';
        input.dispatchEvent(new Event('input'));
        Calculator.clearAllCache();  // 清除缓存
        return;
    }
    
    // 将后面的内容上移
    for (let i = currentIndex; i < lines.length - 1; i++) {
        const currentInput = lines[i].querySelector('.input');
        const nextInput = lines[i + 1].querySelector('.input');
        currentInput.value = nextInput.value;
        currentInput.dispatchEvent(new Event('input'));
    }
    
    // 删除最后一行
    lines[lines.length - 1].remove();

    // 删除第 n 行后，将所有 $m (m > n) 调整为 $(m-1)
    remapLineReferencesAfterDelete(deletedLineNumber);
    
    // 设置焦点
    if (currentIndex === 0) {
        lines[0].querySelector('.input').focus();
    } else {
        const previousLine = lines[currentIndex - 1];
        const previousInput = previousLine.querySelector('.input');
        previousInput.focus();
        previousInput.selectionStart = previousInput.value.length;
        previousInput.selectionEnd = previousInput.value.length;
    }
    
    recalculateAllLines();  // 清除缓存并重新计算所有行
}

function handleKeyDown(event, input) {
    // 首先检查是否是补全相关的按键
    if (handleCompletionKeyDown(event, input)) {
        return;
    }

    // 处理其他键盘事件
    switch (event.key) {
        case 'Enter':
            event.preventDefault();  // 阻止在当前行换行
            handleEnterKey(event, input);
            return;
        case 'Backspace':
            if (input.value === '') {
                    event.preventDefault();
                    handleLineDelete(input);
                    return;
                }
            // 如果光标在行首且不是第一行，移动到上一行末尾
            if (input.selectionStart === 0 && input.selectionEnd === 0) {
                const currentLine = input.closest('.expression-line');
                const previousLine = currentLine.previousElementSibling;
                if (previousLine) {
                    event.preventDefault();
                    const previousInput = previousLine.querySelector('.input');
                    previousInput.focus();
                    previousInput.selectionStart = previousInput.value.length;
                    previousInput.selectionEnd = previousInput.value.length;
                }
            }
            break;

        case 'Delete':
            if (event.shiftKey) {
                event.preventDefault();
                handleLineDelete(input);
                return;
            }
            break;

        case 'ArrowUp':
        case 'ArrowDown':
            const hint = document.querySelector('.completion-hint');
            if (!hint) {  // 只在没有补全提示时处理上下行切换
                event.preventDefault();
                const currentLine = input.closest('.expression-line');
                const targetLine = event.key === 'ArrowUp' ? 
                    currentLine.previousElementSibling : 
                    currentLine.nextElementSibling;
                if (targetLine) {
                    const targetInput = targetLine.querySelector('.input');
                    targetInput.focus();
                    const cursorPos = input.selectionStart;
                    targetInput.selectionStart = Math.min(cursorPos, targetInput.value.length);
                    targetInput.selectionEnd = Math.min(cursorPos, targetInput.value.length);
                }
            }
            return;

        case '*':
            handleAsteriskInput(event, input);
            return;

        default:
            // 检查是否应该触发补全
            if (isCompletionEnabled && shouldTriggerCompletion(input, event.key)) {
                setTimeout(() => checkCompletion(input), 0);
            }
            break;
    }
}

function handleInput(event) {
    const input = event.target;
    
    // 移除补全提示
    removeCompletionHint(input);
    
    // 自动添加下一行的逻辑
    const addedNewLine = autoAddNextLineIfNeeded(input);
    // 自动新增行时，addNewLine() 内部已经触发了整表重算，避免副作用表达式重复执行
    if (addedNewLine) return;
    
    // 计算表达式
    if (isLastExpression()) {
        const expression = input.value.trim();
        // 赋值表达式在输入过程中会有中间态（如 a+=1 -> a+=11）
        if (hasAssignmentSideEffect(expression)) {
            recalculateAllLines();
        } else {
            calculateLine(input);
        }
    } else {
        recalculateAllLines();
    }
}

function hasAssignmentSideEffect(expression) {
    if (!expression) return false;

    // 允许输入中存在空格，如: a + = 1
    const compactExpr = expression.replace(/\s+/g, '');
    if (!compactExpr) return false;

    // 复合赋值从 OPERATORS 元数据中读取
    if (COMPOUND_ASSIGNMENT_OPERATORS.some(op => compactExpr.includes(op))) {
        return true;
    }

    // '=' 需要排除比较运算符：==, !=, <=, >=
    if (ASSIGNMENT_OPERATORS.includes('=')) {
        return /(?<![<>=!])=(?!=)/.test(compactExpr);
    }

    return false;
}

// 自动添加下一行的函数
function autoAddNextLineIfNeeded(input) {
    // 是否开启自动下一行
    const AutoNextLine = document.getElementById('AutoNextLine');
    if (!AutoNextLine.checked) return false;

    // 只在最后一行且有内容时自动添加新行
    if (isLastLine(input) && input.value.trim() !== '') {
        // 检查是否已经有下一行
        const currentLine = input.closest('.expression-line');
        const nextLine = currentLine.nextElementSibling;
        if (!nextLine) {
            // 自动添加新行，但不移动焦点
            addNewLine(false);
            return true;
        }
    }
    return false;
}

// 将当前行的结果值填入下一行
function copyPreviousResult(currentLine, copyVariable=true) {
    const newInput = currentLine.nextElementSibling.querySelector('.input');

    if (copyVariable) {
        // 当 copyVariable=true 时，填入 $行号 格式
        const lines = document.querySelectorAll('.expression-line');
        const currentIndex = Array.from(lines).indexOf(currentLine);
        newInput.value = `$${currentIndex + 1} `;
        newInput.dispatchEvent(new Event('input'));
    } else {
        // 当 copyVariable=false 时，将当前行的结果值填入下一行
        const previousResult = currentLine.querySelector('.result-value').textContent;
        if (previousResult) {
            newInput.value = previousResult;
            newInput.dispatchEvent(new Event('input'));
        }
    }
}

function handleEnterKey(event, input) {
    const currentLine = input.closest('.expression-line');
    const lines = document.querySelectorAll('.expression-line');
    const currentIndex = Array.from(lines).indexOf(currentLine);
    const isLastLine = currentIndex === lines.length - 1;
    
    // 处理 Shift + Enter
    if (event.shiftKey) {
        // 如果当前行为空，则返回
        if (input.value.trim() === '') {
            notification.warning('无法在空行下方插入新行');
            return;
        }

        // 当在最后一行时
        if (isLastLine) {
            const expression = input.value.trim();
            // 只有当本行不为空时才插入新行
            if (expression !== '') {
                addNewLine();
            }
            return;
        }
        
        // 不在最后一行时，在下方插入新行
        insertNewLine(currentLine);
        return;
    }

    // 处理 Ctrl/Command + Enter，会复制上一行的结果到下一行
    if (isMacOSPlatform() ? event.metaKey : event.ctrlKey) {
        // 如果当前行为空，则返回
        if (input.value.trim() === '') {
            notification.warning('无法在空行下方插入新行');
            return;
        }

        // 当在最后一行时
        if (isLastLine) {
            const expression = input.value.trim();
            // 只有当本行不为空时才插入新行
            if (expression !== '') {
                addNewLine();
                copyPreviousResult(currentLine);
            }
            return;
        }

        // 不在最后一行时，在下方插入新行
        insertNewLine(currentLine);
        copyPreviousResult(currentLine);
        return;
    }
    
    // 普通 Enter 键的处理保持不变
    const expression = input.value.trim();
    const hasExpression = expression !== '';
    
    if (hasExpression) {
        if (currentIndex === lines.length - 1) {
            addNewLine();
        } else {
            const nextLine = currentLine.nextElementSibling;
            if (nextLine) {
                nextLine.querySelector('.input').focus();
            }
        }
    }
}

function recalculateAllLines() {
    // 清除缓存
    Calculator.clearAllCache();

    // 更新所有行的行号
    updateLineNumbers();

    // 重新计算所有行
    const lines = document.querySelectorAll('.expression-line');
    lines.forEach(line => {
        const input = line.querySelector('.input');
        
        // 空行一并处理
        calculateLine(input, true);
    });
}

function isLastExpression() {
    const container = document.getElementById('expression-container');
    const lines = container.querySelectorAll('.expression-line');
    
    // 获取当前活动的input所在行
    const activeInput = document.activeElement;
    if (!activeInput || !activeInput.classList.contains('input')) {
        return false;
    }
    
    const currentLine = activeInput.closest('.expression-line');
    const currentIndex = Array.from(lines).indexOf(currentLine);
    
    // 检查后面的行是否都没有输入内容
    for (let i = currentIndex + 1; i < lines.length; i++) {
        const input = lines[i].querySelector('.input');
        if (input.value.trim()) {
            return false;
        }
    }
    
    return true;
}

// 判断是否是最后一行
function isLastLine(input = null) {
    const container = document.getElementById('expression-container');
    const lines = container.querySelectorAll('.expression-line');
    
    // 如果传入了input参数，使用传入的；否则使用当前焦点元素
    let currentLine;
    if (input) {
        currentLine = input.closest('.expression-line');
    } else {
        currentLine = document.activeElement.closest('.expression-line');
    }
    
    if (!currentLine) return false;
    
    const currentIndex = Array.from(lines).indexOf(currentLine);
    return currentIndex === lines.length - 1;
} 

// 获取快捷键显示文本
function getShortcutText(key) {
    if (isMacOSPlatform()) {
        return key.replace('Ctrl', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace('Enter', '↵').replace('Delete', '⌫');
    }
    return key;
}

// 更新快捷键显示
function updateShortcutsDisplay() {
    // 处理所有快捷键文本
    const shortcutElements = document.querySelectorAll('.shortcut-key, .shortcut-text');
    shortcutElements.forEach(element => {
        element.textContent = getShortcutText(element.textContent);
    });
}

// 表达式语法高亮
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHTML(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildFuncRegex(names) {
    if (!names.length) return null;
    const prefix = '(^|[^A-Za-z0-9_]|(?:\\d)x|\\d)';
    const name = '(' + names.join('|') + ')';
    const suffix = '(?=\\s*\\()';
    return new RegExp(prefix + name + suffix, 'g');
}

function buildConstRegex(names, allowDigitPrefix) {
    if (!names.length) return null;
    const name = '(' + names.join('|') + ')';
    const suffix = '(?=$|[^A-Za-z0-9_])';
    const prefix = allowDigitPrefix
        ? '(^|[^A-Za-z0-9_]|(?:\\d)x|\\d)'
        : '(^|[^A-Za-z0-9_])';
    return new RegExp(prefix + name + suffix, 'g');
}

let _FUNCTION_REGEX = null;
let _CONST_REGEX_1 = null;
let _CONST_REGEX_N = null;

function refreshHighlightRegexes() {
    const functionNames = Object.keys(FUNCTIONS)
        .filter(name => /^[a-zA-Z_]/.test(name))
        .map(escapeRegExp)
        .sort((a, b) => b.length - a.length);
    const constantNames = Object.keys(CONSTANTS || {})
        .filter(name => /^[a-zA-Z_]/.test(name))
        .map(escapeRegExp)
        .sort((a, b) => b.length - a.length);
    const constantNames1 = constantNames.filter(n => n.length === 1);
    const constantNamesN = constantNames.filter(n => n.length > 1);

    _FUNCTION_REGEX = buildFuncRegex(functionNames);
    _CONST_REGEX_N = buildConstRegex(constantNamesN, true);
    if (!constantNames1.length) {
        _CONST_REGEX_1 = null;
    } else {
        const name = '(' + constantNames1.join('|') + ')';
        const suffix = '(?=$|[^A-Za-z0-9_])';
        const prefix = '(^|[^A-Za-z0-9_]|(?:\\d)x|(?:\\))x)';
        _CONST_REGEX_1 = new RegExp(prefix + name + suffix, 'g');
    }
}

refreshHighlightRegexes();

function refreshAllInputHighlights() {
    document.querySelectorAll('.expression-line').forEach(line => {
        const input = line.querySelector('.input');
        const highlight = line.querySelector('.input-highlight');
        if (input && highlight) {
            syncInputHighlightForTextarea(input, highlight);
        }
    });
}

function syncInputHighlightForTextarea(textarea, highlightEl = null) {
    if (!textarea) return;
    const highlight = highlightEl || textarea.closest('.expression-input')?.querySelector('.input-highlight');
    if (!highlight) return;

    highlight.classList.toggle('multiline', textarea.classList.contains('multiline'));
    highlight.innerHTML = highlightExpressionText(textarea.value);
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
}

// 科学计数法：1e2 / 1e-2 / 1.23e+4（只高亮 e）
const SCI_REGEX = /(^|[^A-Za-z0-9_])(\d+(?:\.\d+)?)(e)([+-]?\d+)(?=$|[^A-Za-z0-9_])/gi;

function highlightExpressionText(raw) {
    let text = escapeHTML(raw);

    if (_CONST_REGEX_N) {
        text = text.replace(_CONST_REGEX_N, '$1<span class="cc-syntax-const">$2</span>');
    }
    if (_CONST_REGEX_1) {
        text = text.replace(_CONST_REGEX_1, '$1<span class="cc-syntax-const">$2</span>');
    }
    if (_FUNCTION_REGEX) {
        text = text.replace(_FUNCTION_REGEX, '$1<span class="cc-syntax-func">$2</span>');
    }

    // 科学计数法最后处理，避免与常量/函数高亮嵌套
    text = text.replace(SCI_REGEX, '$1$2<span class="cc-syntax-sci">$3</span>$4');

    // 确保空行仍然有高度
    if (text === '') {
        return '&nbsp;';
    }
    return text;
}

function attachInputHighlight(expressionLine) {
    const wrapper = expressionLine.querySelector('.expression-input');
    const textarea = wrapper?.querySelector('.input');
    const highlight = wrapper?.querySelector('.input-highlight');
    if (!wrapper || !textarea || !highlight) return;

    const sync = () => syncInputHighlightForTextarea(textarea, highlight);

    const scheduleSync = () => requestAnimationFrame(sync);

    textarea.addEventListener('input', scheduleSync);
    textarea.addEventListener('scroll', () => {
        highlight.scrollTop = textarea.scrollTop;
        highlight.scrollLeft = textarea.scrollLeft;
    });
    textarea.addEventListener('focus', scheduleSync);
    textarea.addEventListener('blur', scheduleSync);

    // 初始同步一次
    sync();
}

function initializeUI() {

    // 将标签和快照相关函数添加到全局作用域
    Object.assign(window, Tag);
    Object.assign(window, Copy);

    // 初始化所有行的标签功能与语法高亮
    document.querySelectorAll('.expression-line').forEach(line => {
        ensureExpressionLineId(line);
        Tag.initializeTagButton(line);
        attachInputHighlight(line);
    });
    
    // 更新所有行的行号
    updateLineNumbers();

    // 添加容器点击事件监听
    document.getElementById('expression-container')
        .addEventListener('click', handleContainerClick);

    // 使用事件委托来处理所有消息图标的点击
    document.getElementById('expression-container').addEventListener('click', function(event) {
        const messageIcon = event.target.closest('.message-icon');
        if (!messageIcon || !messageIcon.classList.contains('error')) return;
        
        const expressionLine = messageIcon.closest('.expression-line');
        if (!expressionLine) return;
        
        // 直接调用 handleLineDelete 删除当前行
        const input = expressionLine.querySelector('.input');
        handleLineDelete(input);
    });

    // 点击“自定义函数/常数”图标或消息时打开自定义函数面板
    document.getElementById('expression-container').addEventListener('click', function(event) {
        const customTarget = event.target.closest(
            '.message-icon.customFunc, .message-icon.customCst, .message-content.customFunc, .message-content.customCst'
        );
        if (!customTarget) return;
        ensureCustomFunctions().togglePanel();
    });


    
    // 添加清空快捷键
    document.addEventListener('keydown', (e) => {
        if ((isMacOSPlatform() ? e.metaKey : e.ctrlKey) && e.code === 'KeyK') {
            e.preventDefault();
            clearAll();
        }
    });

    // 初始化快捷键显示
    updateShortcutsDisplay();

    // 首屏先出，再在空闲时初始化“面板功能”和自定义函数（避免启动卡顿）
    const scheduleIdle = (fn, timeout = 800) => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(fn, { timeout });
        } else {
            setTimeout(fn, 0);
        }
    };

    requestAnimationFrame(() => {
        scheduleIdle(() => {
            // 面板功能（懒实例化，但这里在 idle 预热；不影响首屏）
            ensureSettings();
            ensureShortcuts();
            ensureCustomFunctions();

            // 快照相对更重，稍微晚一点预热；如不想预热可删除此行
            scheduleIdle(() => ensureSnapshot(), 2000);

            AddCustomFunctions();
        });
    });

    // 自定义函数面板关闭时刷新自定义函数与补全（解耦，避免与 custom-functions.js 交叉引用）
    document.addEventListener('codecalc:customFunctionsPanelClosed', AddCustomFunctions);
}

function handleAsteriskInput(event, input) {
    const cursorPos = input.selectionStart;
    const textBeforeCursor = input.value.substring(0, cursorPos);
    
    // 检查光标前一个字符是否也是星号
    if (textBeforeCursor.endsWith('*')) {
        // 阻止默认的 * 输入
        event.preventDefault();
        
        // 删除前一个 * 并插入 **()
        const beforeStars = textBeforeCursor.slice(0, -1);
        const afterCursor = input.value.substring(cursorPos);
        input.value = beforeStars + '**()' + afterCursor;
        
        // 将光标移动到括号内
        const newCursorPos = beforeStars.length + 3;
        input.setSelectionRange(newCursorPos, newCursorPos);
        
        // 触发输入事件以更新计算结果
        input.dispatchEvent(new Event('input'));
    }
}

function arrayToHtml(matString) {
    // 向量
    if (matString.startsWith('[') ) {
        const array = matString
            .slice(1, -1)                    // 移除大括号
            .split(',')                      // 分割行
            .map(row => row.trim());         // 处理每个数据 

        const rows = array.map(element => {
            // 将复数中的 i 加粗和高亮
            const highlightedElement = element.replace(/i/g, '<strong class="highlight-i">i</strong>');
            return `<div class="matrix-row"><span class="matrix-element">${highlightedElement}</span></div>`;
        });
        return `<div class="latex-matrix">${rows.join('')}</div>`;
    }
   
    // 矩阵
    if (matString.startsWith('{')) {
        // 将 {1,2,3; 4,5,6; 7,8,9} 转换为二维数组
        const matrix = matString
            .slice(1, -1)                    // 移除大括号
            .split(';')                      // 分割行
            .map(row => row.trim().split(',').map(Number)); // 处理每行数据

        // 生成HTML - 使用嵌套结构表示二维矩阵
        const rows = matrix.map(row => {
            const elements = row.map(element =>
                `<span class="matrix-element">${element}</span>`
            );
            return `<div class="matrix-row">${elements.join('')}</div>`;
        });

        return `<div class="latex-matrix">${rows.join('')}</div>`;
    
    }

    // 错误格式 
    return `<div class="latex-matrix"> Error </div>`;
}

// 计算当前行
function calculateLine(input, ignoreEmptyLine=false) {
    const expressionLine = input.closest('.expression-line');
    if (!expressionLine) return;

    const resultContainer = expressionLine.querySelector('.result-container');
    if (!resultContainer) return;
    const result = resultContainer.querySelector('.result');
    const messageIcon = resultContainer.querySelector('.message-icon');
    const messageText = messageIcon.querySelector('.message-text');
    let expression = input.value.trim();
    const rawExpression = expression;  // 用于 message-icon 自定义类（函数/常数定义）

    const dollarNumberPattern = /^\s*\$\d+\s*=/;
    if (dollarNumberPattern.test(expression)) {
        setState('', 'error', '`$数字` 是默认保留变量名, 不允许赋值!');
        return;
    }

    const deletedLineRefMatch = rawExpression.match(/\$del-(\d+)\b/);
    if (deletedLineRefMatch) {
        setState('', 'error', `使用了已删除的行变量 $${deletedLineRefMatch[1]}`);
        return;
    }

    // 清除所有状态
    function clearState() {
        result.innerHTML = '<span class="result-value"></span>';
        result.classList.remove('has-input', 'has-value', 'warning', 'error', 'info');
        messageIcon.style.display = 'none';  // 确保隐藏消息图标
        messageIcon.className = 'message-icon';  // 重置消息图标的类
    }

    // 设置状态：customFunc/customCst 的优先级在 error 之后、matrix/info 之前
    function setState(value, type, messages, options = {}) {
        const { customFunc = false, customConstant = false } = options;
        const isCustomType = type === 'customFunc' || type === 'customCst';
        const customClass = isCustomType ? ` ${type}` : (customFunc ? ' customFunc' : (customConstant ? ' customCst' : ''));

        result.innerHTML = `<span class="result-value">${value}</span>`;
        result.classList.remove('warning', 'error', 'info');
        result.classList.add('has-value');

        // 清除之前的消息
        messageText.innerHTML = '';
        
        if (type === 'error') {
            result.classList.add('error');
            messageIcon.className = 'message-icon error' + customClass;
            messageIcon.style.display = 'inline';
            messageText.textContent = messages;
            return;
        }

        // 自定义函数 / 常数：不要与 info 混用，否则会叠加 info 的 ::before 背景图标
        if (isCustomType) {
            messageIcon.className = 'message-icon' + customClass;
            messageIcon.style.display = 'inline';

            if (Array.isArray(messages) && messages.length > 0) {
                messages.forEach(msg => {
                    const msgContent = document.createElement('div');
                    msgContent.className = `message-content ${type}`;
                    msgContent.textContent = msg.text;
                    messageText.appendChild(msgContent);
                });
            }
            return;
        }

        const isMatrix = messages.some(msg => msg.text === 'isMatrix');
        if (isMatrix) {
            messageIcon.className = 'message-icon matrix' + customClass;
            messageIcon.style.display = 'inline';
            messageText.innerHTML = arrayToHtml(value);

            const expressionLine = messageIcon.closest('.expression-line');
            if (expressionLine.previousElementSibling === null) {
                messageIcon.classList.add('first-row');
            }
            return;
        }

        if (Array.isArray(messages) && messages.length > 0) {
            messageIcon.className = `message-icon ${type}${customClass}`;
            messageIcon.style.display = 'inline';

            messages.forEach(msg => {
                const msgContent = document.createElement('div');
                msgContent.className = `message-content ${msg.type}`;
                msgContent.textContent = msg.text;
                messageText.appendChild(msgContent);
            });
        } else {
            messageIcon.style.display = 'none';
        }
    }

    // 设置正常结果
    function setNormalState(value) {
        result.innerHTML = `<span class="result-value">${value}</span>`;
        result.classList.remove('warning', 'error', 'info');  // 确保移除所有特殊状态
        result.classList.add('has-value');
        messageIcon.style.display = 'none';  // 确保隐藏消息图标
        messageIcon.className = 'message-icon';  // 重置消息图标的类
    }

    // TODO:空输入处理
    if (expression === '') {
        // 不设置 ignoreEmptyLine 时，recalculateAllLines 会递归调用 calculateLine 导致栈溢出
        // TODO:清除当前行的变量，是否还有更好的做法？
        if(!ignoreEmptyLine ){
            console.log('空输入处理, 重新计算所有行');
            recalculateAllLines();
            clearState();
        }

        // 空行不处理
        return;
    }

    result.classList.add('has-input');

    try {

        // 如果勾选了将数字转换为大写中文，则添加.toCN 将数字转换为中文大写
        const toCNToggle = document.getElementById('toCNToggle');
        if (toCNToggle.checked) {
            expression = `(${expression}).toCN`;
        }

        // 添加行号赋值
        const lines = document.querySelectorAll('.expression-line');
        const currentLine = input.closest('.expression-line');
        const currentIndex = Array.from(lines).indexOf(currentLine);
        expression = `$${currentIndex + 1} = ${expression}`;

        // console.log("expression: ", expression);

        const value = Calculator.calculate(expression);
        const messages = [];
        let type = null;

        // 按优先级收集消息
        if (value.warning && value.warning.length > 0) {
            messages.push(...value.warning.map(msg => ({ text: msg, type: 'warning' })));
            type = 'warning';
        }
        if (value.info && value.info.length > 0) {
            messages.push(...value.info.map(msg => ({ text: msg, type: 'info' })));
            type = type || 'info';
        }

        // 自定义函数/常数
        if (value.customFunc || value.customConstant) {
            const customType = value.customFunc ? 'customFunc' : 'customCst';
            const customTypeText = value.customFunc ? '函数' : '常数';
            const saveResult = addNewFunction(input, rawExpression);
            if (saveResult.blocked) {
                setState(`${value.value}定义失败/重复`, 'error', saveResult.message);
            } else {
                const customMsg = [{ text: `已保存自定义${customTypeText}: ${value.customName}, 点击管理`, type: customType }];
                setState(value.value, customType, customMsg);
                if (saveResult.saved) AddCustomFunctions();
            }
        } else if (messages.length > 0) {
            setState(value.value, type, messages);
        } else {
            setNormalState(value.value);
        }
    } catch (error) {
        const deletedFromError = (error?.message || '').match(/\$del-(\d+)\b/);
        if (deletedFromError) {
            setState('', 'error', `使用了已删除的行变量 $${deletedFromError[1]}`);
        }else{
            setState('', 'error', error.message);
        }
    }
}

function clearAll() {
    const container = document.getElementById('expression-container');
    inlineEditableCustomKeys.clear();
    
    // 在清空之前保存历史记录
    ensureSnapshot().takeSnapshot(false);
    
    // 添加快照图标动画效果
    const snapshotButton = document.querySelector('.snapshot-toggle-btn');
    if (snapshotButton) {
        const snapshotIcon = snapshotButton.querySelector('.snapshot-icon');
        if (snapshotIcon) {
            // 设置动画样式
            snapshotIcon.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
            snapshotIcon.style.color = '#4CAF50';
            snapshotIcon.style.transform = 'rotate(-360deg) scale(1.15)';
            
            // 使用 Promise 来处理异步动画
            const animationPromise = new Promise(resolve => {
                setTimeout(() => {
                    snapshotIcon.style.color = '#aaa';
                    snapshotIcon.style.transform = '';
                    setTimeout(() => {
                        snapshotIcon.style.transition = '';
                        resolve();
                    }, 600);
                }, 600);
            });
        }
    }
    
    // 清空和重置UI的代码...
    const newLine = CreateNewLine(1);
    
    // 清空容器并添加新行
    container.innerHTML = '';
    container.appendChild(newLine);
    
    // 获取新行的元素
    const input = newLine.querySelector('.input');
    const result = newLine.querySelector('.result');
    const messageIcon = newLine.querySelector('.message-icon');
    
    // 清空输入和结果
    input.value = '';
    result.innerHTML = '<span class="result-value"></span>';
    result.classList.remove('has-input', 'has-value', 'warning', 'error', 'info');
    
    // 隐藏消息图标并重置其状态
    messageIcon.style.display = 'none';
    messageIcon.className = 'message-icon';
    messageIcon.querySelector('.message-text').innerHTML = '';

    // 移除补全提示框
    removeCompletionHint(input);

    // 清除计算缓存
    Calculator.clearAllCache();
    
    // 初始化标签功能
    Tag.initializeTagButton(newLine);

    // 初始化语法高亮（clearAll 生成的第一行需要显式初始化）
    attachInputHighlight(newLine);
    
    // 为新行的结果添加点击处理
    const newResult = newLine.querySelector('.result');
    addResultClickHandler(newResult);
    
    // 在清空之后, 更新快照添加按钮状态
    ensureSnapshot().updateAddButtonState();

    notification.error('页面已清空');

    // 聚焦到输入框
    input.focus();
}

// 处理容器点击事件
function handleContainerClick(event) {
    if (!event.target.classList.contains('input')) {
        const lines = document.querySelectorAll('.expression-line');
        const lastLine = lines[lines.length - 1];
        const input = lastLine.querySelector('.input');
        input.focus();
    }
}

function openCustomFunctionsPanel() {
    ensureCustomFunctions().togglePanel();
    return false;
}


// 将所有需要的函数添加到全局作用域
Object.assign(window, {
    // UI 事件处理函数
    handleInput,
    handleKeyDown,
    autoResize,
    handleContainerClick,
    removeCompletionHint,
    autoAddNextLineIfNeeded,
    
    // 计算相关函数
    calculateLine,
    addNewLine,
    handleLineDelete,
    handleAsteriskInput,
    clearAll,
    openCustomFunctionsPanel,
    
    // 初始化函数
    initializeUI,

    handleFocus,
    handleBlur,
});

// 导出函数供模块使用
export {
    calculateLine,
    addNewLine,
    handleLineDelete,
    handleKeyDown,
    handleInput,
    handleAsteriskInput,
    autoAddNextLineIfNeeded,
    clearAll,
    openCustomFunctionsPanel,
    handleContainerClick,
    initializeUI,
    handleFocus,
    handleBlur,
    recalculateAllLines,
    AddCustomFunctions,
};

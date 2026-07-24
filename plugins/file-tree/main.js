let treeData = null;
let editor = null;

// 主题相关代码
const THEME_KEY = 'directory-tree-theme';
const themeSelect = document.getElementById('themeSelect');


ztools.onPluginEnter(({ code, type, payload, option }) => {
    if(type === 'files'){
      scanDirectory(payload[0].path);
    }
});


// 初始化主题
function initTheme() {
    // 从 dbStorage 获取主题设置
    const savedTheme = ztools.dbStorage.getItem(THEME_KEY);
    if (savedTheme) {
        themeSelect.value = savedTheme;
        applyTheme(savedTheme);
    } else {
        // 默认跟随系统
        themeSelect.value = 'system';
        applyTheme('system');
    }
}

// 应用主题
function applyTheme(theme) {
    const isDark = theme === 'dark' || 
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    
    // 更新编辑器主题
    if (editor) {
        editor.setOption('theme', isDark ? 'monokai' : 'default');
    }
    
    // 更新主题选择器的显示值
    updateSelectTrigger('themeSelect');
    
    // 保存主题设置到 dbStorage
    ztools.dbStorage.setItem(THEME_KEY, theme);
}

// 监听主题切换
themeSelect.addEventListener('change', (e) => {
    // 先应用主题，这会触发 updateSelectTrigger
    applyTheme(e.target.value);
});

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (themeSelect.value === 'system') {
        applyTheme('system');
        updateSelectTrigger('themeSelect');
    }
});

// 初始化编辑器
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded::::::::::');
    // 定义自定义模式
    CodeMirror.defineMode("tree", function() {
        return {
            token: function(stream) {
                const separator = document.getElementById('commentSeparator').value;
                // 跳过前面的空白字符
                stream.eatSpace();
                
                // 检查是否是注释开始
                if (separator === '#') {
                    // 匹配 # 后面的所有内容
                    if (stream.match(/#.*$/)) {
                        return "comment-custom";
                    }
                } else if (separator === '//') {
                    // 匹配 // 后面的所有内容
                    if (stream.match(/\/\/.*$/)) {
                        return "comment-custom";
                    }
                }
                
                // 如果不是注释，跳过当前字
                stream.next();
                return null;
            }
        };
    });

    editor = CodeMirror.fromTextArea(document.getElementById('treeContainer'), {
        mode: "tree",
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'monokai' : 'default',
        lineNumbers: true,
        viewportMargin: Infinity,
        indentUnit: 4,
        tabSize: 4,
        scrollbarStyle: 'native'
    });

    // 设置初始内容
    editor.setValue('// 请选择文件夹以生成目录树');

    // 确保编辑器正确渲染
    editor.refresh();

    // 初始化主题
    initTheme();

    initializeSelectors();

    // 监听分隔符变化，更新语法高亮
    document.getElementById('commentSeparator').addEventListener('change', () => {
        editor.setOption('mode', null);  // 先清除模式
        setTimeout(() => {
            editor.setOption('mode', 'tree');  // 重新设置模式
            editor.refresh();  // 刷新编辑器
        }, 0);
    });
});

// 选择文件夹并扫描
document.getElementById('selectFolder').addEventListener('click', () => {
    try {
        const result = ztools.showOpenDialog({
            title: '选择文件夹',
            properties: ['openDirectory']
        });
        
        if (result && result.length > 0) {
            const path = result[0];
            try {
                scanDirectory(path);
            } catch (error) {
                console.error('扫描目录出错:', error);
                ztools.showNotification('扫描目录时出错：' + error.message);
            }
        }
    } catch (error) {
        console.error('选择文件夹失败:', error);
        ztools.showNotification('选择文件夹失败');
    }
});

// 监听过滤条件变化
document.getElementById('levelSelect').addEventListener('change', (e) => {
    updateSelectTrigger('levelSelect');
    if (treeData) {
        renderTree(treeData);
    }
});

document.getElementById('commentSeparator').addEventListener('change', (e) => {
    updateSelectTrigger('commentSeparator');
    if (treeData) {
        renderTree(treeData);
    }
});

// 扫描目录结构
function scanDirectory(path) {
    console.log('开始扫描目录:', path);
    const showHidden = document.getElementById('showHidden').checked;
    const ignorePatterns = document.getElementById('ignorePatterns').value
        .split(',')
        .map(p => p.trim())
        .filter(p => p);  // 过滤空字符串
    
    console.log('忽略的文件/文件夹:', ignorePatterns);
    
    // 创建简单的匹配函数
    function shouldIgnore(name) {
        return ignorePatterns.some(pattern => {
            // 转换通配符为正则表达式
            const regexPattern = pattern
                .replace(/\./g, '\\.')  // 转义点号
                .replace(/\*/g, '.*')   // * 转换为任意字符
                .replace(/\?/g, '.');   // ? 转换为单个字符
            
            const regex = new RegExp(`^${regexPattern}$`);
            const isMatch = regex.test(name);
            
            if (isMatch) {
                console.log(`文件/文件夹 "${name}" 匹配忽略规则 "${pattern}"`);
            }
            
            return isMatch;
        });
    }
    
    // 修改扫描函数，添加忽略逻辑
    const data = window.services.scanDirectory(path, showHidden, shouldIgnore);
    console.log('扫描结果:', data);
    
    if (data) {
        treeData = data;
        treeData.path = path;
        renderTree(data);
    } else {
        console.error('生成目录树失败');
        ztools.showNotification('生成目录树失败');
    }
}

// 添加格式注释按钮的事件监听
document.getElementById('formatComments').addEventListener('click', () => {
    formatComments();
});

// 格式化注释
function formatComments() {
    const content = editor.getValue();
    if (!content) return;

    const separator = document.getElementById('commentSeparator').value;
    const lines = content.split('\n');
    let maxContentWidth = 0;

    // 第一遍遍历：找出最长的目录部分宽度（不包括注释）
    lines.forEach(line => {
        if (line.trim()) {  // 忽略空行
            // 检查是否是目录树的一部分（包含树形符号）
            if (line.match(/^([\s]*│)*[\s]*[├└]── /)) {  // 修改正则以更准确地匹配目录树行
                const commentIndex = line.indexOf(separator);
                // 获取目录部分（包括缩进和文件名，但不包括注释）
                const contentPart = commentIndex !== -1 ? 
                    line.substring(0, commentIndex).trimEnd() : 
                    line.trimEnd();
                
                // 计算这部分内容的显示宽度
                const contentWidth = getDisplayWidth(contentPart);
                maxContentWidth = Math.max(maxContentWidth, contentWidth);
            }
        }
    });

    // 第二遍历：格式化每一行
    const formattedLines = lines.map(line => {
        if (!line.trim()) return line;  // 保持空行不变

        const commentIndex = line.indexOf(separator);
        if (commentIndex !== -1) {
            const contentPart = line.substring(0, commentIndex).trimEnd();
            const comment = line.substring(commentIndex).trim();
            const currentWidth = getDisplayWidth(contentPart);
            
            // 所有注释都对齐到最大宽度后的固定位置
            const spacesNeeded = maxContentWidth - currentWidth + 4;  // 固定4个空格的间隔
            const padding = ' '.repeat(Math.max(1, spacesNeeded));
            
            return contentPart + padding + comment;
        }
        return line;
    });

    editor.setValue(formattedLines.join('\n'));
    ztools.showNotification('注释格式化完成');
}

// 计算字符串显示宽度的辅助函数
function getDisplayWidth(str) {
    let width = 0;
    for (const char of str) {
        if (char === ' ' || char === '│' || char === '├' || char === '└' || char === '─') {
            width += 1;  // 空格和树形符号算1个宽度
        } else if (char.match(/[\u4e00-\u9fa5]|[\uff00-\uffff]/)) {
            width += 2;  // 中文符算2个宽度
        } else {
            width += 1;  // 其他字符算1个宽度
        }
    }
    return width;
}

// 修改 renderTree 函数，移动对齐部分
function renderTree(data) {
    console.log('开始渲染树形图:', data);
    const maxLevel = parseInt(document.getElementById('levelSelect').value);
    const separator = document.getElementById('commentSeparator').value;
    
    function renderNode(node, prefix = '', isLast = true, level = 1) {
        if (!node) return '';
        
        let result = '';
        
        // 添加当前节点
        const nodePrefix = prefix + (isLast ? '└── ' : '├── ');
        const hasChildren = node.children && node.children.length > 0;
        const atMaxLevel = maxLevel !== -1 && level >= maxLevel;
        const suffix = hasChildren && atMaxLevel ? '/' : '';
        result += nodePrefix + node.name + suffix + (node.comment ? ` ${separator} ` + node.comment : '') + '\n';
        
        // 处理子节点，如果未达到最大层级
        if (node.children && node.children.length > 0 && (maxLevel === -1 || level < maxLevel)) {
            const childPrefix = prefix + (isLast ? '    ' : '│   ');
            node.children.forEach((child, index) => {
                const isLastChild = index === node.children.length - 1;
                result += renderNode(child, childPrefix, isLastChild, level + 1);
            });
        }
        
        return result;
    }
    
    try {
        // 渲染整个树
        let content = data.name + (data.comment ? ` ${separator} ` + data.comment : '') + '\n';
        if (data.children && data.children.length > 0) {
            content += data.children.map((child, index) => 
                renderNode(child, '', index === data.children.length - 1)
            ).join('');
        }
        
        editor.setValue(content);
        
        console.log('渲染完成');
    } catch (error) {
        editor.setValue('// 渲染树形图时出错:' + error);
    }
}

// 添加错误处理
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global error:', {message, source, lineno, colno, error});
    ztools.showNotification('发生错误：' + message);
};

// 更新选择器显示值
function updateSelectTrigger(selectId) {
    const select = document.getElementById(selectId);
    const trigger = select.parentElement.querySelector('.selected-value');
    if (trigger && select.selectedIndex >= 0) {
        const selectedOption = select.options[select.selectedIndex];
        // 确保选中值正确设置
        trigger.textContent = selectedOption.text;
        trigger.setAttribute('data-value', selectedOption.value);
    }
}

// 初始化选择器显值
function initializeSelectors() {
    // 初始化所有选择器的显示值
    ['levelSelect', 'commentSeparator', 'themeSelect'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            // 确保有默认选中
            if (select.selectedIndex === -1 && select.options.length > 0) {
                select.selectedIndex = 0;
            }
            updateSelectTrigger(id);
        }
    });
}

// 监听显示隐藏文件的复选框
document.getElementById('showHidden').addEventListener('change', () => {
    if (treeData && treeData.path) {
        scanDirectory(treeData.path);
    }
});

// 导出图功能
document.getElementById('exportImage').addEventListener('click', () => {
    if (!editor.getValue().trim()) {
        ztools.showNotification('没有可导出的内容');
        return;
    }

    // 显示导出设置弹窗
    const modal = document.getElementById('exportModal');
    const preview = document.getElementById('exportPreview');
    modal.classList.add('show');

    // 清除之前的事件监听器
    const confirmExport = document.getElementById('confirmExport');
    const closeBtn = document.querySelector('.close-btn');
    const oldConfirmExport = confirmExport.cloneNode(true);
    const oldCloseBtn = closeBtn.cloneNode(true);
    confirmExport.parentNode.replaceChild(oldConfirmExport, confirmExport);
    closeBtn.parentNode.replaceChild(oldCloseBtn, closeBtn);

    // 预览示例内容
    const PREVIEW_EXAMPLE = `project
    ├── src
    │   ├── components  # 组件目录
    │   ├── utils      # 工具函数
    │   └── main.js    # 入口文件
    └── docs           # 文档目录
        └── guide.md   # 使用指南`;

    // 更新预览
    function updatePreview() {
        const bgColor = document.getElementById('bgColor').value;
        const textColor = document.getElementById('textColor').value;
        const commentColor = document.getElementById('commentColor').value;
        
        preview.style.background = bgColor;
        preview.style.color = textColor;
        
        // 重置预览容器
        preview.innerHTML = '';
        
        // 使用编辑器中的实际内容
        const lines = editor.getValue().split('\n');
        const separator = document.getElementById('commentSeparator').value;
        
        // 创建内容包装器
        const contentWrapper = document.createElement('div');
        contentWrapper.style.display = 'block';
        contentWrapper.style.whiteSpace = 'pre';
        contentWrapper.style.textAlign = 'left';
        contentWrapper.style.padding = '15px';
        contentWrapper.style.boxSizing = 'border-box';
        preview.appendChild(contentWrapper);
        
        // 渲染内容
        lines.forEach(line => {
            if (!line.trim()) return;
            
            const lineDiv = document.createElement('div');
            lineDiv.className = 'export-line';
            
            const parts = line.split(new RegExp(`(${separator}.*$)`));
            
            if (parts.length > 1) {
                lineDiv.innerHTML = parts[0] + 
                    `<span style="color: ${commentColor}">${parts[1]}</span>`;
            } else {
                lineDiv.textContent = line;
            }
            
            contentWrapper.appendChild(lineDiv);
        });
    }

    // 初始预览
    updatePreview();

    // 监听窗口大小变化，重新计算预览
    const resizeObserver = new ResizeObserver(() => {
        if (modal.classList.contains('show')) {
            updatePreview();
        }
    });
    resizeObserver.observe(preview);

    // 预设主题配置
    const themes = {
        'github-light': {
            bg: '#ffffff',
            text: '#1F2328',
            comment: '#22863a'
        },
        'github-dark': {
            bg: '#0d1117',
            text: '#c9d1d9',
            comment: '#7ee787'
        },
        'monokai': {
            bg: '#272822',
            text: '#f8f8f2',
            comment: '#a6e22e'
        },
        'dracula': {
            bg: '#282a36',
            text: '#f8f8f2',
            comment: '#50fa7b'
        },
        'nord': {
            bg: '#2e3440',
            text: '#d8dee9',
            comment: '#a3be8c'
        }
    };

    // 监听主题选择
    document.querySelectorAll('.theme-item').forEach(item => {
        item.addEventListener('click', () => {
            // 移除其他主题的激活状态
            document.querySelectorAll('.theme-item').forEach(i => i.classList.remove('active'));
            // 激活当前主题
            item.classList.add('active');

            // 获取颜色设置组
            const colorSettings = document.querySelectorAll('.setting-group input[type="color"]');
            const isColorful = item.dataset.theme === 'colorful';
            
            // 如果是炫彩主题，禁用颜色选择
            colorSettings.forEach(input => {
                input.disabled = isColorful;
                input.parentElement.style.opacity = isColorful ? '0.5' : '1';
                input.parentElement.style.pointerEvents = isColorful ? 'none' : 'auto';
            });

            // 使用主题颜色
            const theme = themes[item.dataset.theme];
            document.getElementById('bgColor').value = theme.bg;
            document.getElementById('textColor').value = theme.text;
            document.getElementById('commentColor').value = theme.comment;

            // 更新预览
            updatePreview();
        });
    });

    // 监听颜色变化
    ['bgColor', 'textColor', 'commentColor'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            // 只在非炫彩主题时取消主题选择
            const isColorful = document.querySelector('.theme-item[data-theme="colorful"]').classList.contains('active');
            if (!isColorful) {
                document.querySelectorAll('.theme-item').forEach(i => i.classList.remove('active'));
            }
            updatePreview();
        });
    });

    // 关闭弹窗
    oldCloseBtn.addEventListener('click', () => {
        modal.classList.remove('show');
    });

    // 确认导出
    oldConfirmExport.addEventListener('click', async () => {
        const scale = document.getElementById('exportScale').value;
        const bgColor = document.getElementById('bgColor').value;
        
        try {
            // 显示加载状态
            oldConfirmExport.classList.add('loading');
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const canvas = await html2canvas(preview, {
                backgroundColor: bgColor,
                scale: scale * window.devicePixelRatio,
                logging: false,
                useCORS: true,
                allowTaint: true,
                width: preview.scrollWidth,
                height: preview.scrollHeight
            });
            
            const imageData = canvas.toDataURL('image/png', 1.0);
            const binaryString = atob(imageData.split(',')[1]);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const folderName = treeData ? 
                window.services.getBasename(treeData.path) : 
                'directory-tree';
            
            const result = ztools.showSaveDialog({
                title: '保存目录树图片',
                defaultPath: `${folderName}@${scale}x.png`,
                filters: [
                    { name: 'PNG 图片', extensions: ['png'] }
                ]
            });
            
            if (result) {
                window.services.saveFile(result, bytes);
                modal.classList.remove('show');
                ztools.showNotification('图片已保存');
            }
        } catch (error) {
            console.error('导出图片失败:', error);
            ztools.showNotification('导出图片失败');
        } finally {
            // 移除加载状态
            oldConfirmExport.classList.remove('loading');
        }
    });
});

// 监听忽略模式的变化
document.getElementById('updateIgnore').addEventListener('click', () => {
    if (treeData && treeData.path) {
        // 添加过渡动画
        const button = document.getElementById('updateIgnore');
        button.classList.add('rotating');
        
        scanDirectory(treeData.path);
        
        // 重置动画
        setTimeout(() => {
            button.classList.remove('rotating');
        }, 500);
    }
});

// 添加回车键触发更新
document.getElementById('ignorePatterns').addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        document.getElementById('updateIgnore').click();
    }
});
  
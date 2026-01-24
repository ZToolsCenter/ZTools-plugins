// 统一渲染器 - 支持Markdown、表格、公式
class UnifiedRenderer {
    constructor() {
        this.marked = null;
        this.katexLoader = null;
        this.initialized = false;
    }

    // 初始化渲染器
    async init() {
        if (this.initialized) return;

        // 等待Marked加载
        await this.waitForMarked();

        // 等待KaTeX加载器
        if (window.katexLoader) {
            this.katexLoader = window.katexLoader;
            await this.katexLoader.waitForKaTeX();
        }

        // 配置Marked
        this.configureMarked();

        this.initialized = true;
    }

    // 等待Marked加载
    async waitForMarked(timeout = 5000) {
        const startTime = Date.now();

        while (typeof marked === 'undefined' && (Date.now() - startTime) < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (typeof marked === 'undefined') {
            throw new Error('Marked.js加载失败');
        }

        this.marked = marked;
    }

    // 配置Marked（简化版本）
    configureMarked() {
        if (!this.marked) return;

        try {
            // 简单检查Marked是否可用
            if (typeof this.marked.parse === 'function') {
                console.log('Marked.js可用，将作为增强渲染器');
                this.markedAvailable = true;
            } else {
                console.log('Marked.js不可用，使用基础渲染');
                this.markedAvailable = false;
            }
        } catch (error) {
            console.warn('Marked.js检查失败，使用基础渲染:', error);
            this.markedAvailable = false;
        }
    }

    // 主渲染方法
    async render(text, mode = 'markdown') {
        await this.init();

        try {
            switch (mode) {
                case 'markdown':
                    return await this.renderMarkdown(text);
                case 'formula':
                    return await this.renderFormula(text);
                case 'table':
                    return await this.renderTable(text);
                case 'text':
                default:
                    return this.renderText(text);
            }
        } catch (error) {
            console.error('统一渲染器错误:', error);
            return this.renderError(error, text);
        }
    }

    // 渲染Markdown（包含表格和公式）
    async renderMarkdown(text) {
        if (!text || !text.trim()) return '';

        let html = text;

        // 1. 首先处理数学公式（保护不被markdown处理）
        html = this.protectMathFormulas(html);

        // 2. 使用基础渲染（稳定可靠）
        html = this.basicMarkdownRender(html);

        // 3. 如果Marked可用，尝试使用它增强渲染
        if (this.markedAvailable) {
            try {
                // 临时移除数学公式占位符
                const tempText = html.replace(/\[MATH_[A-Z_]+\]/g, '');
                const markedResult = this.marked.parse(tempText);

                // 如果Marked渲染成功且结果更好，使用它
                if (markedResult && markedResult.trim() && markedResult !== tempText) {
                    html = markedResult;
                }
            } catch (error) {
                console.warn('Marked.js增强渲染失败，使用基础渲染:', error);
                // 保持基础渲染结果，这是安全的
            }
        }

        // 4. 恢复并渲染数学公式
        html = await this.restoreAndRenderMathFormulas(html);

        return `<div class="markdown-content">${html}</div>`;
    }

    // 渲染公式
    async renderFormula(text) {
        if (!text || !text.trim()) return '';

        // 如果有KaTeX加载器，使用它
        if (this.katexLoader) {
            try {
                // 检查是否包含LaTeX公式标记
                if (text.includes('$$') || text.includes('$')) {
                    // 使用Markdown渲染流程来处理公式
                    return await this.renderMarkdown(text);
                } else {
                    // 直接渲染LaTeX公式
                    return await this.katexLoader.renderFormula(text, { displayMode: true });
                }
            } catch (error) {
                console.warn('KaTeX渲染失败，使用降级方案:', error);
                return `<div class="formula-container">
                    <div class="formula-text">${this.escapeHtml(text)}</div>
                </div>`;
            }
        }

        // 降级渲染
        return `<div class="formula-container">
            <div class="formula-text">${this.escapeHtml(text)}</div>
        </div>`;
    }

    // 渲染表格
    async renderTable(text) {
        if (!text || !text.trim()) return '';

        // 使用Markdown表格渲染
        const tableMarkdown = this.ensureTableFormat(text);
        return await this.renderMarkdown(tableMarkdown);
    }

    // 渲染纯文本
    renderText(text) {
        if (!text || !text.trim()) return '';

        return `<div class="text-content">
            ${this.escapeHtml(text).replace(/\n/g, '<br>')}
        </div>`;
    }

    // 保护数学公式不被Markdown处理
    protectMathFormulas(text) {
        // 清空之前的公式缓存
        this.mathFormulas = {};

        // 保护块级公式 $$...$$（支持多行）
        text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
            const id = `MATH_BLOCK_${Math.random().toString(36).substr(2, 9)}`;
            this.mathFormulas[id] = { type: 'block', content: formula.trim() };
            return id;
        });

        // 保护行内公式 $...$（避免与块级公式冲突）
        text = text.replace(/\$([^$\n]+?)\$/g, (match, formula) => {
            const id = `MATH_INLINE_${Math.random().toString(36).substr(2, 9)}`;
            this.mathFormulas[id] = { type: 'inline', content: formula.trim() };
            return id;
        });

        return text;
    }

    // 恢复并渲染数学公式
    async restoreAndRenderMathFormulas(html) {
        if (!this.mathFormulas || Object.keys(this.mathFormulas).length === 0) {
            return html;
        }

        // 按ID长度排序，确保先处理较长的ID（避免部分匹配问题）
        const sortedIds = Object.keys(this.mathFormulas).sort((a, b) => b.length - a.length);

        for (const id of sortedIds) {
            const formula = this.mathFormulas[id];
            let renderedFormula = '';

            try {
                if (this.katexLoader) {
                    const displayMode = formula.type === 'block';
                    const katexResult = await this.katexLoader.renderFormula(formula.content, { displayMode });

                    if (formula.type === 'block') {
                        renderedFormula = `<div class="math-block">${katexResult}</div>`;
                    } else {
                        renderedFormula = `<span class="math-inline">${katexResult}</span>`;
                    }
                } else {
                    // 降级显示原始公式
                    const originalFormula = formula.type === 'block' ? `$$${formula.content}$$` : `$${formula.content}$`;
                    renderedFormula = `<span class="math-fallback">${originalFormula}</span>`;
                }
            } catch (error) {
                console.warn('公式渲染失败:', error, '公式内容:', formula.content);
                // 显示原始公式作为错误状态
                const originalFormula = formula.type === 'block' ? `$$${formula.content}$$` : `$${formula.content}$`;
                renderedFormula = `<span class="math-error" title="${error.message}">${originalFormula}</span>`;
            }

            // 安全替换：使用全局替换确保所有实例都被替换
            const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedId, 'g');
            html = html.replace(regex, renderedFormula);
        }

        // 清空公式缓存
        this.mathFormulas = {};
        return html;
    }

    // 确保表格格式
    ensureTableFormat(text) {
        const lines = text.trim().split('\n');

        // 如果不是表格格式，尝试转换
        if (!lines.some(line => line.includes('|'))) {
            // 简单的文本转表格（按空格分割）
            return lines.map(line => {
                const cells = line.trim().split(/\s+/);
                return `| ${cells.join(' | ')} |`;
            }).join('\n') + '\n|' + '-'.repeat(20) + '|\n';
        }

        return text;
    }

    // 基础Markdown渲染（降级方案）
    basicMarkdownRender(text) {
        let html = text;

        // 表格处理（必须先处理）
        html = this.renderBasicTables(html);

        // 标题
        html = html.replace(/^###### (.*$)/gm, '<h6 class="markdown-heading">$1</h6>');
        html = html.replace(/^##### (.*$)/gm, '<h5 class="markdown-heading">$1</h5>');
        html = html.replace(/^#### (.*$)/gm, '<h4 class="markdown-heading">$1</h4>');
        html = html.replace(/^### (.*$)/gm, '<h3 class="markdown-heading">$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2 class="markdown-heading">$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1 class="markdown-heading">$1</h1>');

        // 粗体和斜体
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // 代码块
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre><code class="language-${lang}">${this.escapeHtml(code)}</code></pre>`;
        });

        // 行内代码
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        // 链接
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // 图片
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto;">');

        // 分割线
        html = html.replace(/^(---+|\*\*\*+)$/gm, '<hr>');

        // 引用块
        html = html.replace(/^> (.+$)/gm, '<blockquote>$1</blockquote>');

        // 列表
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

        // 段落处理
        html = html.replace(/\n\n+/g, '</p><p>');
        html = '<p>' + html + '</p>';

        return html;
    }

    // 基础表格渲染（降级方案）
    renderBasicTables(text) {
        const lines = text.split('\n');
        const result = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            if (line.trim().includes('|') && line.trim().length > 1) {
                const tableLines = [];
                let j = i;

                // 收集连续的表格行
                while (j < lines.length && lines[j].trim().includes('|') && lines[j].trim().length > 1) {
                    tableLines.push(lines[j]);
                    j++;
                }

                if (tableLines.length >= 2) {
                    // 检查第二行是否是分隔符行
                    const separatorLine = tableLines[1].trim();
                    if (separatorLine.match(/^\|?[\s\-\|:]+\|?$/)) {
                        const tableHtml = this.convertBasicTableToHtml(tableLines);
                        result.push(tableHtml);
                        i = j;
                        continue;
                    }
                }
            }

            result.push(line);
            i++;
        }

        return result.join('\n');
    }

    // 转换基础表格为HTML
    convertBasicTableToHtml(tableLines) {
        if (tableLines.length < 2) return tableLines.join('\n');

        const headerLine = tableLines[0];
        const separatorLine = tableLines[1];
        const dataLines = tableLines.slice(2);

        let tableHtml = '<table class="markdown-table">\n<thead>\n<tr>\n';

        // 解析表头
        const headers = this.parseBasicTableRow(headerLine);
        headers.forEach(header => {
            tableHtml += `<th>${header.trim()}</th>\n`;
        });
        tableHtml += '</tr>\n</thead>\n';

        if (dataLines.length > 0) {
            tableHtml += '<tbody>\n';
            dataLines.forEach(line => {
                const cells = this.parseBasicTableRow(line);
                if (cells.length > 0) {
                    tableHtml += '<tr>\n';
                    cells.forEach(cell => {
                        tableHtml += `<td>${cell.trim()}</td>\n`;
                    });
                    tableHtml += '</tr>\n';
                }
            });
            tableHtml += '</tbody>\n';
        }

        tableHtml += '</table>';
        return tableHtml;
    }

    // 解析基础表格行
    parseBasicTableRow(line) {
        const trimmed = line.trim();
        if (!trimmed.includes('|')) return [];

        let content = trimmed;
        if (content.startsWith('|')) content = content.substring(1);
        if (content.endsWith('|')) content = content.substring(0, content.length - 1);

        return content.split('|').map(cell => this.escapeHtml(cell.trim()));
    }

    // 渲染错误信息
    renderError(error, originalText) {
        return `<div class="render-error">
            <div class="render-error-title">渲染失败</div>
            <div class="render-error-message">${this.escapeHtml(error.message)}</div>
            <details class="render-error-details">
                <summary>原始内容</summary>
                <pre>${this.escapeHtml(originalText)}</pre>
            </details>
        </div>`;
    }

    // HTML转义
    escapeHtml(text) {
        if (text === null || text === undefined) {
            return '';
        }

        const str = String(text);
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // 获取渲染器状态
    getStatus() {
        return {
            initialized: this.initialized,
            markedAvailable: typeof marked !== 'undefined',
            katexAvailable: this.katexLoader ? this.katexLoader.getStatus() : null,
            version: '1.0.0'
        };
    }
}

// 创建全局实例
window.unifiedRenderer = new UnifiedRenderer();

// 在DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.unifiedRenderer.init().catch(error => {
        console.error('统一渲染器初始化失败:', error);
    });
});
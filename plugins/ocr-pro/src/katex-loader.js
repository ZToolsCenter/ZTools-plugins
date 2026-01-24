// KaTeX加载器和备用方案
class KaTeXLoader {
    constructor() {
        this.isLoaded = false;
        this.isLoading = false;
        this.loadPromise = null;
        this.fallbackMode = false;
        this.loadAttempts = 0;
        this.maxAttempts = 3;
    }

    // 检查KaTeX是否已加载
    isKaTeXAvailable() {
        return typeof katex !== 'undefined' && katex.renderToString;
    }

    // 等待KaTeX加载
    async waitForKaTeX(timeout = 5000) {
        if (this.isKaTeXAvailable()) {
            this.isLoaded = true;
            return true;
        }

        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = new Promise((resolve) => {
            const startTime = Date.now();
            const checkInterval = 100;
            let attempts = 0;
            const maxAttempts = Math.floor(timeout / checkInterval);

            const checkKaTeX = () => {
                attempts++;
                
                if (this.isKaTeXAvailable()) {
                    this.isLoaded = true;
                    this.isLoading = false;
                    resolve(true);
                    return;
                }

                if (attempts >= maxAttempts) {
                    this.isLoaded = false;
                    this.isLoading = false;
                    this.fallbackMode = true;
                    resolve(false);
                    return;
                }

                setTimeout(checkKaTeX, checkInterval);
            };

            this.isLoading = true;
            checkKaTeX();
        });

        return this.loadPromise;
    }

    // 尝试重新加载KaTeX
    async retryLoad() {
        if (this.loadAttempts >= this.maxAttempts) {
            this.fallbackMode = true;
            return false;
        }

        this.loadAttempts++;
        
        this.loadPromise = null;
        this.isLoaded = false;
        this.isLoading = false;

        return await this.waitForKaTeX();
    }

    // 渲染公式（带备用方案）
    async renderFormula(latex, options = {}) {
        const defaultOptions = {
            displayMode: true,
            throwOnError: false,
            errorColor: '#cc0000',
            strict: false,  // 关闭严格模式，允许Unicode字符
            trust: false,   // 安全设置
            ...options
        };

        // 等待KaTeX加载
        const katexLoaded = await this.waitForKaTeX();

        if (katexLoaded && this.isKaTeXAvailable()) {
            try {
                return katex.renderToString(latex, defaultOptions);
            } catch (error) {
                console.warn('KaTeX渲染失败:', error);
                return this.renderFallback(latex, error);
            }
        } else {
            return this.renderFallback(latex, new Error('KaTeX未加载'));
        }
    }

    // 备用渲染方案
    renderFallback(latex, error = null) {
        const escapedLatex = this.escapeHtml(latex);
        const errorMsg = error ? error.message : 'KaTeX不可用';
        
        return `
            <div class="formula-fallback">
                <div class="formula-warning" style="margin-bottom: 8px;">
                    ⚠️ 公式渲染引擎不可用: ${errorMsg}
                </div>
                <div class="formula-text">
                    ${escapedLatex}
                </div>
            </div>
        `;
    }

    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 获取加载状态信息
    getStatus() {
        return {
            isLoaded: this.isLoaded,
            isLoading: this.isLoading,
            fallbackMode: this.fallbackMode,
            loadAttempts: this.loadAttempts,
            isAvailable: this.isKaTeXAvailable()
        };
    }

    // 诊断信息
    getDiagnostics() {
        const status = this.getStatus();
        const diagnostics = {
            ...status,
            katexGlobal: typeof katex !== 'undefined',
            katexRenderFunction: typeof katex !== 'undefined' && typeof katex.renderToString === 'function',
            userAgent: navigator.userAgent,
            isUTools: typeof utools !== 'undefined',
            timestamp: new Date().toISOString()
        };

        return diagnostics;
    }
}

// 创建全局实例
window.katexLoader = new KaTeXLoader();

// 在页面加载完成后开始检测
document.addEventListener('DOMContentLoaded', () => {
    window.katexLoader.waitForKaTeX().then(loaded => {
        if (!loaded) {
            window.katexLoader.getDiagnostics();
        }
    });
});

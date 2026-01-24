/**
 * TTS (Text-to-Speech) 管理器
 * 负责处理文本转语音功能
 */
class TTSManager {
    constructor() {
        this.synthesis = null;
        this.currentUtterance = null;
        this.isSupported = false;
        this.isInitialized = false;
        this.voices = [];
        this.defaultVoices = {
            'zh': null, // 中文语音
            'en': null, // 英文语音
            'auto': null // 自动检测语音
        };
        
        this.init();
    }

    /**
     * 初始化TTS功能
     */
    init() {
        try {
            // 检查浏览器是否支持Web Speech API
            if ('speechSynthesis' in window) {
                this.synthesis = window.speechSynthesis;
                this.isSupported = true;
                
                // 加载可用语音
                this.loadVoices();
                
                // 监听语音列表变化
                if (this.synthesis.onvoiceschanged !== undefined) {
                    this.synthesis.onvoiceschanged = () => {
                        this.loadVoices();
                    };
                }
                
                this.isInitialized = true;

            } else {
                console.warn('Web Speech API not supported in this browser');
            }
        } catch (error) {
            console.error('Failed to initialize TTS Manager:', error);
        }
    }

    /**
     * 加载可用的语音列表
     */
    loadVoices() {
        try {
            this.voices = this.synthesis.getVoices();
            
            // 查找默认中文语音
            this.defaultVoices.zh = this.voices.find(voice => 
                voice.lang.startsWith('zh') || 
                voice.lang.includes('Chinese') ||
                voice.name.includes('Chinese') ||
                voice.name.includes('中文')
            );

            // 查找默认英文语音
            this.defaultVoices.en = this.voices.find(voice => 
                voice.lang.startsWith('en') || 
                voice.lang.includes('English') ||
                voice.name.includes('English')
            );

            // 设置自动检测默认语音（优先中文）
            this.defaultVoices.auto = this.defaultVoices.zh || this.defaultVoices.en || this.voices[0];



        } catch (error) {
            console.error('Failed to load voices:', error);
        }
    }

    /**
     * 检测文本语言
     * @param {string} text - 要检测的文本
     * @returns {string} 语言代码 ('zh', 'en', 'auto')
     */
    detectLanguage(text) {
        if (!text || !text.trim()) {
            return 'auto';
        }

        // 简单的语言检测逻辑
        const chineseRegex = /[\u4e00-\u9fff]/;
        const englishRegex = /[a-zA-Z]/;

        const chineseCount = (text.match(chineseRegex) || []).length;
        const englishCount = (text.match(englishRegex) || []).length;

        if (chineseCount > englishCount) {
            return 'zh';
        } else if (englishCount > chineseCount) {
            return 'en';
        } else {
            return 'auto';
        }
    }

    /**
     * 获取适合的语音
     * @param {string} language - 语言代码
     * @returns {SpeechSynthesisVoice|null} 语音对象
     */
    getVoiceForLanguage(language) {
        if (!this.isSupported || this.voices.length === 0) {
            return null;
        }

        return this.defaultVoices[language] || this.defaultVoices.auto;
    }

    /**
     * 朗读文本
     * @param {string} text - 要朗读的文本
     * @param {Object} options - 朗读选项
     * @param {string} options.language - 指定语言 ('zh', 'en', 'auto')
     * @param {number} options.rate - 语速 (0.1-10, 默认1)
     * @param {number} options.pitch - 音调 (0-2, 默认1)
     * @param {number} options.volume - 音量 (0-1, 默认1)
     * @param {Function} options.onStart - 开始回调
     * @param {Function} options.onEnd - 结束回调
     * @param {Function} options.onError - 错误回调
     * @returns {Promise<boolean>} 是否成功开始朗读
     */
    async speak(text, options = {}) {
        return new Promise((resolve, reject) => {
            try {
                // 检查支持性
                if (!this.isSupported) {
                    const error = '浏览器不支持语音朗读功能';
                    if (options.onError) options.onError(error);
                    reject(new Error(error));
                    return;
                }

                // 检查文本
                if (!text || !text.trim()) {
                    const error = '朗读文本不能为空';
                    if (options.onError) options.onError(error);
                    reject(new Error(error));
                    return;
                }

                // 停止当前朗读
                this.stop();

                // 创建语音合成实例
                this.currentUtterance = new SpeechSynthesisUtterance(text.trim());

                // 设置语音参数
                const language = options.language || this.detectLanguage(text);
                const voice = this.getVoiceForLanguage(language);
                
                if (voice) {
                    this.currentUtterance.voice = voice;
                    this.currentUtterance.lang = voice.lang;
                } else {
                    // 如果没有找到合适的语音，使用默认设置
                    this.currentUtterance.lang = language === 'zh' ? 'zh-CN' : 'en-US';
                }

                this.currentUtterance.rate = options.rate || 1;
                this.currentUtterance.pitch = options.pitch || 1;
                this.currentUtterance.volume = options.volume || 1;

                // 设置事件监听器
                this.currentUtterance.onstart = () => {

                    if (options.onStart) options.onStart();
                    resolve(true);
                };

                this.currentUtterance.onend = () => {

                    this.currentUtterance = null;
                    if (options.onEnd) options.onEnd();
                };

                this.currentUtterance.onerror = (event) => {
                    console.error('TTS error:', event.error);
                    this.currentUtterance = null;
                    const error = `语音朗读失败: ${event.error}`;
                    if (options.onError) options.onError(error);
                    reject(new Error(error));
                };

                this.currentUtterance.onpause = () => {

                };

                this.currentUtterance.onresume = () => {

                };

                // 开始朗读
                this.synthesis.speak(this.currentUtterance);

            } catch (error) {
                console.error('Failed to start TTS:', error);
                const errorMsg = `启动语音朗读失败: ${error.message}`;
                if (options.onError) options.onError(errorMsg);
                reject(new Error(errorMsg));
            }
        });
    }

    /**
     * 停止朗读
     */
    stop() {
        try {
            if (this.synthesis && this.synthesis.speaking) {
                this.synthesis.cancel();
            }
            this.currentUtterance = null;
        } catch (error) {
            console.error('Failed to stop TTS:', error);
        }
    }

    /**
     * 暂停朗读
     */
    pause() {
        try {
            if (this.synthesis && this.synthesis.speaking && !this.synthesis.paused) {
                this.synthesis.pause();
            }
        } catch (error) {
            console.error('Failed to pause TTS:', error);
        }
    }

    /**
     * 恢复朗读
     */
    resume() {
        try {
            if (this.synthesis && this.synthesis.paused) {
                this.synthesis.resume();
            }
        } catch (error) {
            console.error('Failed to resume TTS:', error);
        }
    }

    /**
     * 检查是否正在朗读
     * @returns {boolean} 是否正在朗读
     */
    isSpeaking() {
        return this.synthesis && this.synthesis.speaking;
    }

    /**
     * 检查是否已暂停
     * @returns {boolean} 是否已暂停
     */
    isPaused() {
        return this.synthesis && this.synthesis.paused;
    }

    /**
     * 获取支持状态
     * @returns {boolean} 是否支持TTS
     */
    getIsSupported() {
        return this.isSupported;
    }

    /**
     * 获取可用语音列表
     * @returns {Array} 语音列表
     */
    getVoices() {
        return this.voices;
    }
}

// 导出TTS管理器
window.TTSManager = TTSManager;

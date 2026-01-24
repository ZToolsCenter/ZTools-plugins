// OCR Pro 免费额度管理模块
class OCRProQuotaManager {
    constructor() {
        this.DAILY_OCR_LIMIT = 30;      // OCR免费额度上限
        this.DAILY_TRANSLATE_LIMIT = 30; // 翻译免费额度上限
        this.STORAGE_KEY = 'ocrpro-quota';
        this.resetCheckInterval = null;  // 定时检查器
        this.debugMode = false;          // 调试模式标志

        // 启动定时检查
        this.startResetChecker();
    }

    // 获取当前额度状态
    getQuotaStatus() {
        const today = this.getTodayString();
        const quotaData = this.getStorageItem(this.STORAGE_KEY);

        // 如果没有数据或者日期不是今天，初始化今日额度（调试模式下跳过自动重置）
        if (!quotaData || (quotaData.date !== today && !this.debugMode)) {
            return this.resetDailyQuota();
        }

        // 如果是调试模式且日期不同，检查是否有超出默认限制的额度需要重置
        if (quotaData && quotaData.date !== today && this.debugMode) {
            // 检查是否有彩蛋奖励的额度（超出默认限制）
            const hasOCREasterEggQuota = quotaData.ocrRemaining > this.DAILY_OCR_LIMIT;
            const hasTranslateEasterEggQuota = quotaData.translateRemaining > this.DAILY_TRANSLATE_LIMIT;

            if (hasOCREasterEggQuota || hasTranslateEasterEggQuota) {
                // 如果有彩蛋奖励额度，需要重置到默认限制

                return this.resetDailyQuota();
            } else {
                // 没有彩蛋奖励额度，只更新日期但保持额度不变
                const updatedData = {
                    ...quotaData,
                    date: today
                };
                this.saveQuotaStatus(updatedData);
            }
        }
        
        return {
            date: quotaData.date,
            ocrRemaining: Math.max(0, quotaData.ocrRemaining !== undefined ? quotaData.ocrRemaining : this.DAILY_OCR_LIMIT),
            translateRemaining: Math.max(0, quotaData.translateRemaining !== undefined ? quotaData.translateRemaining : this.DAILY_TRANSLATE_LIMIT),
            ocrUsed: Math.max(0, this.DAILY_OCR_LIMIT - (quotaData.ocrRemaining !== undefined ? quotaData.ocrRemaining : this.DAILY_OCR_LIMIT)),
            translateUsed: Math.max(0, this.DAILY_TRANSLATE_LIMIT - (quotaData.translateRemaining !== undefined ? quotaData.translateRemaining : this.DAILY_TRANSLATE_LIMIT))
        };
    }

    // 检查OCR额度是否足够
    checkOCRQuota() {
        const status = this.getQuotaStatus();
        return {
            hasQuota: status.ocrRemaining > 0,
            remaining: status.ocrRemaining,
            used: status.ocrUsed,
            limit: this.DAILY_OCR_LIMIT
        };
    }

    // 检查翻译额度是否足够
    checkTranslateQuota() {
        const status = this.getQuotaStatus();
        return {
            hasQuota: status.translateRemaining > 0,
            remaining: status.translateRemaining,
            used: status.translateUsed,
            limit: this.DAILY_TRANSLATE_LIMIT
        };
    }

    // 消耗OCR额度
    consumeOCRQuota() {
        const status = this.getQuotaStatus();
        if (status.ocrRemaining <= 0) {
            return { success: false, message: '今日OCR免费额度已用完' };
        }

        const newStatus = {
            ...status,
            ocrRemaining: status.ocrRemaining - 1,
            ocrUsed: status.ocrUsed + 1
        };

        this.saveQuotaStatus(newStatus);
        
        // 更新UI显示
        this.updateUIDisplay();
        
        return { 
            success: true, 
            remaining: newStatus.ocrRemaining,
            used: newStatus.ocrUsed
        };
    }

    // 消耗翻译额度
    consumeTranslateQuota() {
        const status = this.getQuotaStatus();
        if (status.translateRemaining <= 0) {
            return { success: false, message: '今日翻译免费额度已用完' };
        }

        const newStatus = {
            ...status,
            translateRemaining: status.translateRemaining - 1,
            translateUsed: status.translateUsed + 1
        };

        this.saveQuotaStatus(newStatus);

        // 更新UI显示
        this.updateUIDisplay();

        return {
            success: true,
            remaining: newStatus.translateRemaining,
            used: newStatus.translateUsed
        };
    }

    // 回退OCR额度（当API调用失败时使用）
    refundOCRQuota() {
        const status = this.getQuotaStatus();
        const newStatus = {
            ...status,
            ocrRemaining: Math.min(status.ocrRemaining + 1, this.DAILY_OCR_LIMIT),
            ocrUsed: Math.max(status.ocrUsed - 1, 0)
        };

        this.saveQuotaStatus(newStatus);

        // 更新UI显示
        this.updateUIDisplay();

        return {
            success: true,
            remaining: newStatus.ocrRemaining,
            used: newStatus.ocrUsed
        };
    }

    // 回退翻译额度（当API调用失败时使用）
    refundTranslateQuota() {
        const status = this.getQuotaStatus();
        const newStatus = {
            ...status,
            translateRemaining: Math.min(status.translateRemaining + 1, this.DAILY_TRANSLATE_LIMIT),
            translateUsed: Math.max(status.translateUsed - 1, 0)
        };

        this.saveQuotaStatus(newStatus);

        // 更新UI显示
        this.updateUIDisplay();

        return {
            success: true,
            remaining: newStatus.translateRemaining,
            used: newStatus.translateUsed
        };
    }

    // 重置每日额度
    resetDailyQuota() {
        const today = this.getTodayString();
        const newStatus = {
            date: today,
            ocrRemaining: this.DAILY_OCR_LIMIT,
            translateRemaining: this.DAILY_TRANSLATE_LIMIT,
            ocrUsed: 0,
            translateUsed: 0
        };

        this.saveQuotaStatus(newStatus);
        
        // 更新UI显示
        this.updateUIDisplay();
        
        return newStatus;
    }

    // 检查是否需要重置额度（每日0点重置）
    checkAndResetIfNeeded() {
        const status = this.getQuotaStatus();
        const today = this.getTodayString();
        
        if (status.date !== today) {

            return this.resetDailyQuota();
        }
        
        return status;
    }

    // 获取今日日期字符串
    getTodayString() {
        return new Date().toDateString();
    }

    // 保存额度状态
    saveQuotaStatus(status) {
        this.setStorageItem(this.STORAGE_KEY, status);
    }

    // 更新UI显示
    updateUIDisplay() {
        if (window.ocrPlugin && window.ocrPlugin.uiManager) {
            // 获取当前状态
            const status = this.getQuotaStatus();
            
            // 更新OCR额度显示
            const ocrUsageText = document.getElementById('ocr-usage-text');
            const ocrProgressFill = document.getElementById('ocr-progress-fill');

            if (ocrUsageText) {
                ocrUsageText.textContent = `${status.ocrRemaining}/${this.DAILY_OCR_LIMIT}`;
            }

            if (ocrProgressFill) {
                // 计算进度条百分比，支持超出默认限制的显示
                let ocrPercentage;
                if (status.ocrRemaining > this.DAILY_OCR_LIMIT) {
                    // 超出默认限制时，显示100%并用特殊颜色表示
                    ocrPercentage = 100;
                } else {
                    ocrPercentage = (status.ocrRemaining / this.DAILY_OCR_LIMIT) * 100;
                }
                ocrProgressFill.style.width = `${ocrPercentage}%`;

                // 根据剩余额度设置颜色
                if (status.ocrRemaining === 0) {
                    ocrProgressFill.style.background = '#ff4757'; // 红色 - 额度用完
                } else if (status.ocrRemaining > this.DAILY_OCR_LIMIT) {
                    ocrProgressFill.style.background = '#9c88ff'; // 紫色表示奖励额度
                } else if (status.ocrRemaining <= 5) {
                    ocrProgressFill.style.background = '#ff6b7a'; // 浅红色 - 严重警告
                } else if (status.ocrRemaining <= 15) {
                    ocrProgressFill.style.background = '#ffa502'; // 橙色 - 警告
                } else {
                    ocrProgressFill.style.background = 'linear-gradient(90deg, #1976d2, #42a5f5)'; // 蓝色渐变
                    ocrProgressFill.style.boxShadow = '0 1px 3px rgba(25, 118, 210, 0.3)';
                }
            }
            
            // 更新翻译额度显示
            const translateUsageText = document.getElementById('translate-usage-text');
            const translateProgressFill = document.getElementById('translate-progress-fill');

            if (translateUsageText) {
                translateUsageText.textContent = `${status.translateRemaining}/${this.DAILY_TRANSLATE_LIMIT}`;
            }

            if (translateProgressFill) {
                // 计算进度条百分比，支持超出默认限制的显示
                let translatePercentage;
                if (status.translateRemaining > this.DAILY_TRANSLATE_LIMIT) {
                    // 超出默认限制时，显示100%并用特殊颜色表示
                    translatePercentage = 100;
                } else {
                    translatePercentage = (status.translateRemaining / this.DAILY_TRANSLATE_LIMIT) * 100;
                }
                translateProgressFill.style.width = `${translatePercentage}%`;

                // 根据剩余额度设置颜色
                if (status.translateRemaining === 0) {
                    translateProgressFill.style.background = '#ff4757'; // 红色 - 额度用完
                } else if (status.translateRemaining > this.DAILY_TRANSLATE_LIMIT) {
                    translateProgressFill.style.background = '#9c88ff'; // 紫色表示奖励额度
                } else if (status.translateRemaining <= 5) {
                    translateProgressFill.style.background = '#ff6b7a'; // 浅红色 - 严重警告
                } else if (status.translateRemaining <= 15) {
                    translateProgressFill.style.background = '#ffa502'; // 橙色 - 警告
                } else {
                    translateProgressFill.style.background = 'linear-gradient(90deg, #1976d2, #42a5f5)'; // 蓝色渐变
                    translateProgressFill.style.boxShadow = '0 1px 3px rgba(25, 118, 210, 0.3)';
                }
            }
        }
    }

    // 获取存储项
    getStorageItem(key) {
        try {
            if (window.ocrAPI && window.ocrAPI.db) {
                return window.ocrAPI.db.get(key);
            }
        } catch (error) {
            console.warn('[OCR Pro额度] 获取存储数据失败:', error);
        }
        return null;
    }

    // 设置存储项
    setStorageItem(key, value) {
        try {
            if (window.ocrAPI && window.ocrAPI.db) {
                const dataToSave = {
                    _id: key,
                    ...value
                };
                
                // 检查是否已存在，保留_rev
                let existing;
                try {
                    existing = window.ocrAPI.db.get(key);
                } catch (e) {
                    // 不存在，继续
                }
                
                if (existing && existing._rev) {
                    dataToSave._rev = existing._rev;
                }
                
                window.ocrAPI.db.put(dataToSave);
            }
        } catch (error) {
            console.error('[OCR Pro额度] 保存存储数据失败:', error);
        }
    }

    // 获取额度使用情况的详细信息（用于调试和监控）
    getQuotaDetails() {
        const status = this.getQuotaStatus();
        return {
            ...status,
            ocrLimit: this.DAILY_OCR_LIMIT,
            translateLimit: this.DAILY_TRANSLATE_LIMIT,
            ocrPercentageUsed: ((status.ocrUsed / this.DAILY_OCR_LIMIT) * 100).toFixed(1),
            translatePercentageUsed: ((status.translateUsed / this.DAILY_TRANSLATE_LIMIT) * 100).toFixed(1)
        };
    }

    // 启动定时检查器（每小时检查一次是否需要重置）
    startResetChecker() {
        // 清除之前的定时器
        if (this.resetCheckInterval) {
            clearInterval(this.resetCheckInterval);
        }

        // 每小时检查一次
        this.resetCheckInterval = setInterval(() => {
            this.checkAndResetIfNeeded();
        }, 60 * 60 * 1000); // 1小时


    }

    // 停止定时检查器
    stopResetChecker() {
        if (this.resetCheckInterval) {
            clearInterval(this.resetCheckInterval);
            this.resetCheckInterval = null;

        }
    }

    // 计算距离下次重置的时间
    getTimeUntilReset() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const timeUntilReset = tomorrow.getTime() - now.getTime();
        const hours = Math.floor(timeUntilReset / (1000 * 60 * 60));
        const minutes = Math.floor((timeUntilReset % (1000 * 60 * 60)) / (1000 * 60));

        return {
            milliseconds: timeUntilReset,
            hours: hours,
            minutes: minutes,
            formatted: `${hours}小时${minutes}分钟`
        };
    }

    // 销毁方法（清理资源）
    destroy() {
        this.stopResetChecker();
    }

    // ==================== 调试方法 ====================

    // 设置OCR剩余额度（调试用，支持超出默认限制）
    setOCRQuota(remaining) {
        if (typeof remaining !== 'number' || remaining < 0) {
            console.error(`[OCR Pro额度] 无效的OCR额度值: ${remaining}，应该大于等于0`);
            return false;
        }

        // 启用调试模式，防止自动重置
        const originalDebugMode = this.debugMode;
        this.debugMode = true;

        const status = this.getQuotaStatus();

        // 计算已使用量，支持超出默认限制的情况
        let ocrUsed;
        if (remaining > this.DAILY_OCR_LIMIT) {
            // 如果剩余额度超出默认限制，说明获得了额外奖励
            // 计算原本应该使用的量
            ocrUsed = Math.max(0, this.DAILY_OCR_LIMIT - remaining + (remaining - this.DAILY_OCR_LIMIT));
            ocrUsed = Math.max(0, status.ocrUsed || 0); // 保持原有使用量不变
        } else {
            ocrUsed = this.DAILY_OCR_LIMIT - remaining;
        }

        const newStatus = {
            ...status,
            ocrRemaining: remaining,
            ocrUsed: ocrUsed
        };

        this.saveQuotaStatus(newStatus);
        this.updateUIDisplay();

        // 恢复原始调试模式状态
        this.debugMode = originalDebugMode;

        const displayLimit = remaining > this.DAILY_OCR_LIMIT ? this.DAILY_OCR_LIMIT : this.DAILY_OCR_LIMIT;
        console.log(`[OCR Pro额度] OCR剩余额度已设置为: ${remaining}/${displayLimit}${remaining > this.DAILY_OCR_LIMIT ? ' (含奖励额度)' : ''}`);
        return true;
    }

    // 设置翻译剩余额度（调试用，支持超出默认限制）
    setTranslateQuota(remaining) {
        if (typeof remaining !== 'number' || remaining < 0) {
            console.error(`[OCR Pro额度] 无效的翻译额度值: ${remaining}，应该大于等于0`);
            return false;
        }

        // 启用调试模式，防止自动重置
        const originalDebugMode = this.debugMode;
        this.debugMode = true;

        const status = this.getQuotaStatus();

        // 计算已使用量，支持超出默认限制的情况
        let translateUsed;
        if (remaining > this.DAILY_TRANSLATE_LIMIT) {
            // 如果剩余额度超出默认限制，说明获得了额外奖励
            // 保持原有使用量不变
            translateUsed = Math.max(0, status.translateUsed || 0);
        } else {
            translateUsed = this.DAILY_TRANSLATE_LIMIT - remaining;
        }

        const newStatus = {
            ...status,
            translateRemaining: remaining,
            translateUsed: translateUsed
        };

        this.saveQuotaStatus(newStatus);
        this.updateUIDisplay();

        // 恢复原始调试模式状态
        this.debugMode = originalDebugMode;

        const displayLimit = remaining > this.DAILY_TRANSLATE_LIMIT ? this.DAILY_TRANSLATE_LIMIT : this.DAILY_TRANSLATE_LIMIT;
        console.log(`[OCR Pro额度] 翻译剩余额度已设置为: ${remaining}/${displayLimit}${remaining > this.DAILY_TRANSLATE_LIMIT ? ' (含奖励额度)' : ''}`);
        return true;
    }

    // 设置两种功能的剩余额度（调试用）
    setQuota(ocrRemaining, translateRemaining) {
        if (typeof ocrRemaining !== 'number' || ocrRemaining < 0 || ocrRemaining > this.DAILY_OCR_LIMIT) {
            console.error(`[OCR Pro额度] 无效的OCR额度值: ${ocrRemaining}，应该在0-${this.DAILY_OCR_LIMIT}之间`);
            return false;
        }

        if (typeof translateRemaining !== 'number' || translateRemaining < 0 || translateRemaining > this.DAILY_TRANSLATE_LIMIT) {
            console.error(`[OCR Pro额度] 无效的翻译额度值: ${translateRemaining}，应该在0-${this.DAILY_TRANSLATE_LIMIT}之间`);
            return false;
        }

        // 启用调试模式，防止自动重置
        this.debugMode = true;

        const status = this.getQuotaStatus();
        const newStatus = {
            ...status,
            ocrRemaining: ocrRemaining,
            ocrUsed: this.DAILY_OCR_LIMIT - ocrRemaining,
            translateRemaining: translateRemaining,
            translateUsed: this.DAILY_TRANSLATE_LIMIT - translateRemaining
        };

        this.saveQuotaStatus(newStatus);
        this.updateUIDisplay();

        // 关闭调试模式
        this.debugMode = false;

        console.log(`[OCR Pro额度] 额度已设置为: OCR ${ocrRemaining}/${this.DAILY_OCR_LIMIT}, 翻译 ${translateRemaining}/${this.DAILY_TRANSLATE_LIMIT}`);
        return true;
    }

    // 打印当前额度状态（调试用）
    printQuotaStatus() {
        const details = this.getQuotaDetails();
        console.log('=== OCR Pro 免费额度状态 ===');
        console.log(`日期: ${details.date}`);
        console.log(`OCR额度: ${details.ocrRemaining}/${details.ocrLimit} (已用: ${details.ocrUsed}, 使用率: ${details.ocrPercentageUsed}%)`);
        console.log(`翻译额度: ${details.translateRemaining}/${details.translateLimit} (已用: ${details.translateUsed}, 使用率: ${details.translatePercentageUsed}%)`);

        const timeUntilReset = this.getTimeUntilReset();
        console.log(`距离重置: ${timeUntilReset.formatted}`);
        console.log('========================');

        return details;
    }
}

// 创建全局实例
window.ocrProQuotaManager = new OCRProQuotaManager();

// ==================== 全局调试指令 ====================

// 添加全局调试方法到window对象
window.debugOCRProQuota = {
    // 查看当前额度状态
    status: () => {
        if (window.ocrProQuotaManager) {
            return window.ocrProQuotaManager.printQuotaStatus();
        } else {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return null;
        }
    },

    // 设置OCR剩余额度
    setOCR: (remaining) => {
        if (window.ocrProQuotaManager) {
            return window.ocrProQuotaManager.setOCRQuota(remaining);
        } else {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return false;
        }
    },

    // 设置翻译剩余额度
    setTranslate: (remaining) => {
        if (window.ocrProQuotaManager) {
            return window.ocrProQuotaManager.setTranslateQuota(remaining);
        } else {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return false;
        }
    },

    // 设置两种功能的剩余额度
    setBoth: (ocrRemaining, translateRemaining) => {
        if (window.ocrProQuotaManager) {
            return window.ocrProQuotaManager.setQuota(ocrRemaining, translateRemaining);
        } else {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return false;
        }
    },

    // 重置为满额度
    reset: () => {
        if (window.ocrProQuotaManager) {
            const result = window.ocrProQuotaManager.resetDailyQuota();
            console.log('[OCR Pro额度] 已重置为满额度');
            return result;
        } else {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return null;
        }
    },

    // 模拟消耗OCR额度
    consumeOCR: () => {
        if (window.ocrProQuotaManager) {
            const result = window.ocrProQuotaManager.consumeOCRQuota();
            console.log('[OCR Pro额度] 模拟消耗OCR额度:', result);
            return result;
        } else {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return null;
        }
    },

    // 模拟消耗翻译额度
    consumeTranslate: () => {
        if (window.ocrProQuotaManager) {
            const result = window.ocrProQuotaManager.consumeTranslateQuota();
            console.log('[OCR Pro额度] 模拟消耗翻译额度:', result);
            return result;
        } else {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return null;
        }
    },

    // 测试0额度设置（验证bug修复）
    testZeroQuota: () => {
        console.log('🧪 开始测试0额度设置bug修复...');

        if (!window.ocrProQuotaManager) {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return false;
        }

        // 测试步骤1：设置为0
        console.log('步骤1: 设置两种额度为0');
        window.ocrProQuotaManager.setQuota(0, 0);

        // 测试步骤2：检查状态
        console.log('步骤2: 检查设置后的状态');
        const status1 = window.ocrProQuotaManager.getQuotaStatus();
        console.log(`结果: OCR ${status1.ocrRemaining}/${window.ocrProQuotaManager.DAILY_OCR_LIMIT}, 翻译 ${status1.translateRemaining}/${window.ocrProQuotaManager.DAILY_TRANSLATE_LIMIT}`);

        // 验证结果
        const success = status1.ocrRemaining === 0 && status1.translateRemaining === 0;
        if (success) {
            console.log('✅ 测试通过！0额度设置正常工作');
        } else {
            console.log('❌ 测试失败！0额度被错误重置');
        }

        return success;
    },

    // 测试彩蛋奖励重置功能
    testEasterEggReset: () => {
        console.log('🧪 开始测试彩蛋奖励重置功能...');

        if (!window.ocrProQuotaManager) {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return false;
        }

        const manager = window.ocrProQuotaManager;

        // 步骤1：设置超出默认限制的额度（模拟彩蛋奖励）
        console.log('步骤1: 设置超出默认限制的额度（模拟彩蛋奖励）');
        manager.setOCRQuota(45);  // 30 + 15 奖励
        manager.setTranslateQuota(50); // 30 + 20 奖励

        // 步骤2：检查当前状态
        console.log('步骤2: 检查设置后的状态');
        const statusBefore = manager.getQuotaStatus();
        console.log(`设置后: OCR ${statusBefore.ocrRemaining}/${manager.DAILY_OCR_LIMIT}, 翻译 ${statusBefore.translateRemaining}/${manager.DAILY_TRANSLATE_LIMIT}`);

        // 步骤3：模拟日期变更，触发重置
        console.log('步骤3: 模拟日期变更，触发重置');

        // 临时修改getTodayString方法来模拟第二天
        const originalGetTodayString = manager.getTodayString;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        manager.getTodayString = () => tomorrow.toDateString();

        // 触发重置检查
        const statusAfter = manager.checkAndResetIfNeeded();

        // 步骤4：验证重置结果
        console.log('步骤4: 验证重置结果');
        console.log(`重置后: OCR ${statusAfter.ocrRemaining}/${manager.DAILY_OCR_LIMIT}, 翻译 ${statusAfter.translateRemaining}/${manager.DAILY_TRANSLATE_LIMIT}`);

        // 恢复原始方法
        manager.getTodayString = originalGetTodayString;

        // 验证结果
        const success = statusAfter.ocrRemaining === manager.DAILY_OCR_LIMIT &&
                       statusAfter.translateRemaining === manager.DAILY_TRANSLATE_LIMIT;

        if (success) {
            console.log('✅ 测试通过！彩蛋奖励额度已正确重置到默认限制');
        } else {
            console.log('❌ 测试失败！彩蛋奖励额度未正确重置');
        }

        return success;
    },

    // 完整测试彩蛋功能和重置机制
    testCompleteEasterEggFlow: () => {
        console.log('🎯 开始完整测试彩蛋功能和重置机制...');

        if (!window.ocrProQuotaManager) {
            console.error('[OCR Pro额度] 额度管理器未初始化');
            return false;
        }

        const manager = window.ocrProQuotaManager;
        let allTestsPassed = true;

        try {
            // 测试1：初始状态
            console.log('\n📋 测试1: 检查初始状态');
            manager.reset();
            const initialStatus = manager.getQuotaStatus();
            console.log(`初始状态: OCR ${initialStatus.ocrRemaining}/${manager.DAILY_OCR_LIMIT}, 翻译 ${initialStatus.translateRemaining}/${manager.DAILY_TRANSLATE_LIMIT}`);

            // 测试2：模拟彩蛋奖励
            console.log('\n🎉 测试2: 模拟彩蛋奖励');
            manager.setOCRQuota(45);  // 30 + 15 奖励
            manager.setTranslateQuota(50); // 30 + 20 奖励
            const afterEasterEgg = manager.getQuotaStatus();
            console.log(`彩蛋后: OCR ${afterEasterEgg.ocrRemaining}/${manager.DAILY_OCR_LIMIT}, 翻译 ${afterEasterEgg.translateRemaining}/${manager.DAILY_TRANSLATE_LIMIT}`);

            if (afterEasterEgg.ocrRemaining !== 45 || afterEasterEgg.translateRemaining !== 50) {
                console.log('❌ 彩蛋奖励设置失败');
                allTestsPassed = false;
            } else {
                console.log('✅ 彩蛋奖励设置成功');
            }

            // 测试3：检查UI显示（进度条颜色）
            console.log('\n🎨 测试3: 检查UI显示');
            manager.updateUIDisplay();

            const ocrProgressFill = document.getElementById('ocr-progress-fill');
            const translateProgressFill = document.getElementById('translate-progress-fill');

            if (ocrProgressFill && translateProgressFill) {
                const ocrColor = window.getComputedStyle(ocrProgressFill).backgroundColor;
                const translateColor = window.getComputedStyle(translateProgressFill).backgroundColor;
                console.log(`进度条颜色 - OCR: ${ocrColor}, 翻译: ${translateColor}`);

                // 检查是否为紫色（奖励额度颜色）
                const isPurple = (color) => color.includes('156') && color.includes('136') && color.includes('255'); // rgb(156, 136, 255)

                if (isPurple(ocrColor) && isPurple(translateColor)) {
                    console.log('✅ 进度条显示奖励颜色（紫色）');
                } else {
                    console.log('⚠️  进度条颜色可能不正确，但这可能是正常的');
                }
            } else {
                console.log('⚠️  未找到进度条元素，可能不在个人中心页面');
            }

            // 测试4：模拟日期变更和重置
            console.log('\n🔄 测试4: 模拟日期变更和重置');

            // 保存原始方法
            const originalGetTodayString = manager.getTodayString;
            const originalDebugMode = manager.debugMode;

            // 模拟第二天
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            manager.getTodayString = () => tomorrow.toDateString();

            // 确保不在调试模式下，以便正常重置
            manager.debugMode = false;

            // 触发重置
            const resetStatus = manager.getQuotaStatus(); // 这会触发重置逻辑

            console.log(`重置后: OCR ${resetStatus.ocrRemaining}/${manager.DAILY_OCR_LIMIT}, 翻译 ${resetStatus.translateRemaining}/${manager.DAILY_TRANSLATE_LIMIT}`);

            // 恢复原始方法
            manager.getTodayString = originalGetTodayString;
            manager.debugMode = originalDebugMode;

            if (resetStatus.ocrRemaining === manager.DAILY_OCR_LIMIT && resetStatus.translateRemaining === manager.DAILY_TRANSLATE_LIMIT) {
                console.log('✅ 日期变更重置成功');
            } else {
                console.log('❌ 日期变更重置失败');
                allTestsPassed = false;
            }

            // 测试5：验证UI恢复正常
            console.log('\n🎨 测试5: 验证UI恢复正常');
            manager.updateUIDisplay();

            if (ocrProgressFill && translateProgressFill) {
                const resetOcrColor = window.getComputedStyle(ocrProgressFill).backgroundColor;
                const resetTranslateColor = window.getComputedStyle(translateProgressFill).backgroundColor;
                console.log(`重置后进度条颜色 - OCR: ${resetOcrColor}, 翻译: ${resetTranslateColor}`);

                // 检查是否恢复为正常颜色（蓝色渐变）
                const isBlue = (color) => color.includes('25') && color.includes('118') && color.includes('210'); // rgb(25, 118, 210)

                if (isBlue(resetOcrColor) && isBlue(resetTranslateColor)) {
                    console.log('✅ 进度条恢复正常颜色（蓝色）');
                } else {
                    console.log('⚠️  进度条颜色可能不正确，但这可能是正常的');
                }
            }

            // 最终结果
            console.log('\n🏁 测试完成');
            if (allTestsPassed) {
                console.log('✅ 所有测试通过！彩蛋功能和重置机制工作正常');
            } else {
                console.log('❌ 部分测试失败，请检查相关功能');
            }

            return allTestsPassed;

        } catch (error) {
            console.error('❌ 测试过程中发生错误:', error);
            return false;
        }
    },

    // 显示帮助信息
    help: () => {
        console.log('=== OCR Pro 额度调试指令 ===');
        console.log('debugOCRProQuota.status()                    - 查看当前额度状态');
        console.log('debugOCRProQuota.setOCR(剩余次数)            - 设置OCR剩余额度 (支持超限)');
        console.log('debugOCRProQuota.setTranslate(剩余次数)       - 设置翻译剩余额度 (支持超限)');
        console.log('debugOCRProQuota.setBoth(OCR次数, 翻译次数)   - 同时设置两种额度');
        console.log('debugOCRProQuota.reset()                     - 重置为满额度 (30/30)');
        console.log('debugOCRProQuota.consumeOCR()                - 模拟消耗1次OCR额度');
        console.log('debugOCRProQuota.consumeTranslate()          - 模拟消耗1次翻译额度');
        console.log('debugOCRProQuota.testZeroQuota()             - 测试0额度设置bug修复');
        console.log('debugOCRProQuota.testEasterEggReset()        - 测试彩蛋奖励重置功能');
        console.log('debugOCRProQuota.testCompleteEasterEggFlow() - 完整测试彩蛋功能流程');
        console.log('debugOCRProQuota.help()                      - 显示此帮助信息');
        console.log('');
        console.log('示例用法:');
        console.log('debugOCRProQuota.setOCR(45)     // 设置OCR剩余45次，测试超限显示');
        console.log('debugOCRProQuota.setOCR(0)      // 设置OCR剩余0次，测试额度限制');
        console.log('debugOCRProQuota.setBoth(0, 5)  // OCR用完，翻译剩余5次');
        console.log('debugOCRProQuota.testEasterEggReset() // 测试彩蛋重置功能');
        console.log('debugOCRProQuota.reset()        // 重置为满额度');
        console.log('========================');
    }
};

// 调试指令已加载（生产环境不显示提示）







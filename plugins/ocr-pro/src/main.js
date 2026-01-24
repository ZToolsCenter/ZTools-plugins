// OCR插件主逻辑
class OCRPlugin {
    constructor() {
        this.configManager = new ConfigManager();
        this.ocrServices = new OCRServices();
        this.uiManager = new UIManager();
        this.modelManager = new ModelManager();
        this.modelStatusManager = new ModelStatusManager(); // 新的统一状态管理器
        this.historyManager = new HistoryManager();
        this.dragSortManager = new DragSortManager(); // 拖拽排序管理器
        this.modelCapabilityDetector = new ModelCapabilityDetector(); // 模型能力检测器
        this.qrcodeManager = new QRCodeManager(); // 二维码识别管理器
        this.updateNotificationManager = new UpdateNotificationManager(); // 版本更新提示管理器
        this.config = this.configManager.getConfig();
        this.lastImageBase64 = null; // 保存最后一次识别的图片
        this.recognitionResultCache = new Map(); // 识别结果缓存：key为"imageHash_mode"，value为识别结果对象
        this.serviceStatusCache = this.loadServiceStatusCache(); // 从持久化存储加载缓存服务状态（向后兼容）
        this.lastConfigHash = null; // 记录上次配置的哈希值
        this.configModified = false; // 配置是否已修改但未保存
        this.shouldAutoTranslateAfterOCR = false; // 标志是否在OCR识别后自动跳转到翻译页面
        this.isScreenshotAndCopyMode = false; // 标志是否是截图识别并复制模式
        this.isSilentMode = false; // 标志是否是静默模式（后台处理）
        this.isScreenshotInProgress = false; // 标志是否正在进行截图
        this.currentTriggerSource = null; // 记录当前触发来源（main/panel/hotkey/redirect）
        this.currentRecognitionMode = 'text'; // 初始化当前识别模式为文字识别
        this.init();

        // 绑定状态管理器事件监听
        this.setupModelStatusListeners();

        // 插件首次启动时获取uTools用户信息
        this.initializeUToolsUserInfo();

        // 初始化OCR Pro额度管理器
        this.initializeOCRProQuotaManager();

        // 初始化版本更新提示
        this.initializeUpdateNotification();
    }

    // 设置模型状态监听器
    setupModelStatusListeners() {
        // 监听模型状态变化事件
        this.modelStatusManager.addStatusChangeListener((event) => {
            this.handleModelStatusChange(event);
        });
    }

    // 处理模型状态变化
    handleModelStatusChange(event) {
        const { platform, modelId, newState, oldState } = event;

        try {
            // 更新UI中的测试按钮状态
            this.updateTestButtonStatus(platform, modelId, newState?.status || 'unknown');

            // 更新平台状态指示器 - 只更新当前变化的平台
            this.updatePlatformStatusIndicator(platform);

            // 更新模型筛选下拉菜单（只显示可用模型）
            this.updateModelFilterMenus();

            // 检查状态变化是否影响当前识别模式的配置
            const currentMode = this.getCurrentRecognitionMode();
            const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);

            // 如果状态变化的平台和模型与当前模式配置匹配，更新主页面状态
            if (modeConfig && modeConfig.service === platform &&
                (modeConfig.model === modelId || !modeConfig.model)) {
                this.updateMainPageStatus();
            }

            // 同时检查全局服务配置
            const currentService = this.config?.service;
            if (currentService && platform === currentService) {
                this.updateMainPageStatus();
            }
        } catch (error) {
            console.error('处理模型状态变化失败:', error);
        }
    }

    // 更新平台状态指示器
    updatePlatformStatusIndicator(platform) {
        try {
            // 对于传统OCR服务和传统翻译服务，使用专门的状态更新逻辑
            if (['baidu', 'tencent', 'aliyun', 'volcano', 'deeplx', 'youdao', 'baiduFanyi'].includes(platform)) {
                this.updateServiceIndicatorStatus(platform);
                return;
            }

            // 对于AI模型服务，使用统一状态管理器
            const summary = this.modelStatusManager.getPlatformSummaryStatus(platform);

            // 查找服务状态指示器元素（使用正确的选择器）
            const serviceItem = document.querySelector(`.service-item[data-service="${platform}"]`);
            if (serviceItem) {
                const indicator = serviceItem.querySelector('.service-status-indicator');
                if (indicator) {
                    // 映射状态到UI状态
                    let uiStatus = 'unknown';
                    switch (summary.status) {
                        case 'success':
                            uiStatus = 'ready';
                            break;
                        case 'failed':
                            uiStatus = 'error';
                            break;
                        case 'testing':
                            uiStatus = 'unknown'; // 测试中显示为未知状态
                            break;
                        default:
                            uiStatus = 'unknown';
                            break;
                    }

                    // 设置状态属性
                    indicator.setAttribute('data-status', uiStatus);

                    // 更新提示文本
                    let statusText = '';
                    if (summary.status === 'success' && summary.availableCount > 0) {
                        statusText = `${summary.availableCount}/${summary.totalCount} 模型可用`;
                    } else if (summary.status === 'failed') {
                        statusText = '连接失败';
                    } else if (summary.status === 'testing') {
                        statusText = '测试中';
                    } else {
                        statusText = '未配置';
                    }

                    indicator.setAttribute('title', statusText);
                }
            }
        } catch (error) {
            console.error(`更新平台 ${platform} 状态指示器失败:`, error);
        }
    }

    // 更新模型筛选下拉菜单
    updateModelFilterMenus() {
        try {
            // 获取所有可用模型
            const availableModels = this.modelStatusManager.getAvailableModels();

            // 更新基础配置页面的模型选择菜单
            const modes = ['text', 'table', 'formula', 'markdown'];
            modes.forEach(mode => {
                this.updateRecognitionModeModelMenu(mode, availableModels);
            });

            // 更新主页面的快速模型切换菜单（如果存在）
            this.updateMainPageModelMenu(availableModels);
        } catch (error) {
            console.error('更新模型筛选菜单失败:', error);
        }
    }

    // 更新识别模式的模型菜单
    updateRecognitionModeModelMenu(mode, availableModels) {
        try {
            const selectElement = document.getElementById(`${mode}-mode-model-select`);
            if (!selectElement) return;

            const currentValue = selectElement.value;

            // 清空现有选项
            selectElement.innerHTML = '<option value="">选择模型</option>';

            // 添加可用模型选项
            Object.entries(availableModels).forEach(([platform, models]) => {
                if (models.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = this.getPlatformDisplayName(platform);

                    models.forEach(modelId => {
                        const option = document.createElement('option');
                        option.value = `${platform}:${modelId}`;
                        option.textContent = this.getModelDisplayName(modelId, platform);
                        optgroup.appendChild(option);
                    });

                    selectElement.appendChild(optgroup);
                }
            });

            // 尝试恢复之前的选择
            if (currentValue && this.isModelAvailable(currentValue, availableModels)) {
                selectElement.value = currentValue;
            }
        } catch (error) {
            console.error(`更新${mode}模式模型菜单失败:`, error);
        }
    }

    // 更新主页面模型菜单
    updateMainPageModelMenu(availableModels) {
        try {
            const selectElement = document.getElementById('main-model-select');
            if (!selectElement) return;

            const currentValue = selectElement.value;

            // 清空现有选项
            selectElement.innerHTML = '<option value="">自动选择</option>';

            // 添加可用模型选项
            Object.entries(availableModels).forEach(([platform, models]) => {
                if (models.length > 0) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = this.getPlatformDisplayName(platform);

                    models.forEach(modelId => {
                        const option = document.createElement('option');
                        option.value = `${platform}:${modelId}`;
                        option.textContent = this.getModelDisplayName(modelId, platform);
                        optgroup.appendChild(option);
                    });

                    selectElement.appendChild(optgroup);
                }
            });

            // 尝试恢复之前的选择
            if (currentValue && this.isModelAvailable(currentValue, availableModels)) {
                selectElement.value = currentValue;
            }
        } catch (error) {
            console.error('更新主页面模型菜单失败:', error);
        }
    }

    // 更新主页面状态显示
    updateMainPageStatus() {
        try {
            const currentService = this.config?.service;

            // 获取当前服务的状态信息 - 使用统一的状态确定逻辑
            let statusInfo = this.determineMainPageServiceStatus(currentService);

            // 更新主页面识别状态显示
            this.uiManager.updateRecognitionStatus(statusInfo.status, statusInfo.message);

            // 更新主页面当前服务显示 - 传递正确的模型名称
            this.uiManager.updateCurrentService(currentService, statusInfo.modelName);
        } catch (error) {
            console.error('更新主页面状态失败:', error);
        }
    }

    // 更新服务状态显示（当没有选择具体模型时）
    updateServiceStatus(serviceName) {
        try {
            // 检查服务是否配置
            const serviceConfig = this.config?.[serviceName];
            if (!serviceConfig) {
                this.uiManager.updateRecognitionStatus('unconfigured', '未配置');
                return;
            }

            // 对于AI服务，检查是否有可用模型
            const aiPlatforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'];
            if (aiPlatforms.includes(serviceName)) {
                const platformSummary = this.modelStatusManager.getPlatformSummaryStatus(serviceName);

                if (platformSummary.availableCount > 0) {
                    this.uiManager.updateRecognitionStatus('ready', `就绪 (${platformSummary.availableCount}个可用模型)`);
                } else if (platformSummary.totalCount > 0) {
                    this.uiManager.updateRecognitionStatus('error', '模型未通过测试');
                } else {
                    this.uiManager.updateRecognitionStatus('unconfigured', '未配置模型');
                }
            } else {
                // 对于传统OCR服务，检查缓存状态
                const cachedStatus = this.getCachedServiceStatus(serviceName);
                if (cachedStatus) {
                    this.uiManager.updateRecognitionStatus(cachedStatus.status.type, cachedStatus.status.message);
                } else {
                    this.uiManager.updateRecognitionStatus('unknown', '未测试');
                }
            }
        } catch (error) {
            console.error('更新服务状态失败:', error);
            this.uiManager.updateRecognitionStatus('unknown', '状态未知');
        }
    }

    // 获取当前选中的服务
    getCurrentSelectedService() {
        return this.config?.service;
    }

    // 获取当前选中的模型
    getCurrentSelectedModel() {
        const mode = this.getCurrentRecognitionMode();
        const modeConfig = this.config?.recognitionModes?.[mode];

        if (modeConfig?.service && modeConfig?.model) {
            return `${modeConfig.service}:${modeConfig.model}`;
        }

        // 如果识别模式没有配置，尝试使用全局配置
        const currentService = this.config?.service;
        if (currentService && ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'utools'].includes(currentService)) {
            const serviceConfig = this.config[currentService];
            if (serviceConfig?.model) {
                return `${currentService}:${serviceConfig.model}`;
            }
        }

        return null;
    }

    // 获取当前识别模式
    getCurrentRecognitionMode() {
        // 直接返回当前识别模式，确保与内部状态一致
        return this.currentRecognitionMode || 'text';
    }

    // 检查模型是否可用
    isModelAvailable(modelValue, availableModels) {
        if (!modelValue || !modelValue.includes(':')) return false;

        const [platform, modelId] = modelValue.split(':');
        const platformModels = availableModels[platform];

        return platformModels && platformModels.includes(modelId);
    }

    // 获取平台显示名称
    getPlatformDisplayName(platform) {
        const names = {
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google',
            alibaba: '阿里云百炼',
            bytedance: '火山引擎',
            zhipu: '智谱AI',
            utools: 'uTools AI'
        };
        return names[platform] || platform;
    }

    // 获取模型显示名称
    getModelDisplayName(modelId, service = null) {
        let displayName = modelId;

        // 对于所有AI平台，尝试使用友好名称
        const aiPlatforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'];
        if (service && aiPlatforms.includes(service)) {
            try {
                const platformConfig = this.config[service];
                if (platformConfig && platformConfig.modelNameMap) {
                    const modelNameMap = platformConfig.modelNameMap;
                    displayName = modelNameMap[modelId] || modelId;
                }
            } catch (error) {
                // 使用原始模型名称作为降级方案
                displayName = modelId;
            }
        }

        // 简化长模型名称以便显示
        if (displayName.length > 30) {
            return displayName.substring(0, 27) + '...';
        }
        return displayName;
    }

    // 实现主界面模型切换按钮与默认模型同步
    setupMainPageModelSync() {
        try {
            // 监听识别模式切换事件
            document.addEventListener('recognitionModeChanged', (event) => {
                this.syncMainPageModelWithConfig(event.detail.mode);
            });

            // 监听配置页面模型选择变化
            document.addEventListener('configModelChanged', (event) => {
                const { mode, service, model } = event.detail;
                const currentMode = this.getCurrentRecognitionMode();

                // 如果变化的是当前模式，立即同步主界面显示
                if (mode === currentMode) {
                    this.uiManager.updateCurrentService(service, model);
                    this.config.service = service; // 更新全局服务配置
                    this.updateMainPageStatus();
                }

                // 更新当前模式在配置页面中的显示（如果配置页面打开）
                if (this.uiManager.currentView === 'config') {
                    this.uiManager.loadRecognitionModeConfig(mode);
                }
            });

            // 监听识别模式变化
            document.addEventListener('recognitionModeChanged', (event) => {
                const { mode } = event.detail;

                // 同步配置页面显示（如果配置页面打开）
                if (this.uiManager.currentView === 'config') {
                    this.uiManager.loadRecognitionModeConfig(mode);
                }
            });

            // 监听服务切换事件
            document.addEventListener('serviceChanged', (event) => {
                this.handleServiceChangeSync(event.detail.service);
            });

            // 初始化时同步当前状态
            this.syncMainPageModelWithConfig();
        } catch (error) {
            console.error('设置主页面模型同步失败:', error);
        }
    }

    // 同步主页面模型显示与配置
    syncMainPageModelWithConfig(mode = null) {
        try {
            const currentMode = mode || this.getCurrentRecognitionMode();


            // 使用configManager获取最新的识别模式配置，确保数据一致性
            const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);


            if (modeConfig && modeConfig.service) {


                // 使用识别模式配置的服务和模型
                // 更新主界面服务和模型显示
                this.uiManager.updateCurrentService(modeConfig.service, modeConfig.model);

                // 更新全局服务配置以保持一致性
                this.config.service = modeConfig.service;

                // 更新主页面状态显示
                this.updateMainPageStatus();

            } else {
                // 如果没有识别模式配置，检查是否有可用的服务
                const availableServices = this.getAvailableServicesForMainInterface();

                if (availableServices && availableServices.length > 0) {
                    // 有可用服务，使用第一个可用的服务
                    const firstAvailable = availableServices[0];

                    // 初始化识别模式配置
                    const result = this.configManager.setRecognitionModeConfig(currentMode, firstAvailable.value, firstAvailable.model);
                    if (result.success) {
                        this.config = result.config;
                        this.config.service = firstAvailable.value;
                    }

                    // 更新主界面显示
                    this.uiManager.updateCurrentService(firstAvailable.value, firstAvailable.model);
                    this.updateMainPageStatus();
                } else {
                    // 没有可用服务，显示未配置状态
                    this.uiManager.updateCurrentService(null, null);
                    this.updateMainPageStatus();
                }
            }
        } catch (error) {
            console.error('同步主页面模型配置失败:', error);
        }
    }

    // 同步主页面模型显示
    syncMainPageModelDisplay(service, model) {
        try {
            // 更新当前服务显示
            this.updateCurrentServiceDisplay(service);

            // 如果有模型选择器，更新模型显示
            const modelDisplayElement = document.getElementById('current-model-display');
            if (modelDisplayElement && model) {
                const modelStatus = this.modelStatusManager.getModelStatus(service, model);
                const displayName = this.getModelDisplayName(model, service);

                // 根据模型状态设置显示样式
                let statusClass = 'model-unknown';
                switch (modelStatus.status) {
                    case 'success':
                        statusClass = 'model-ready';
                        break;
                    case 'failed':
                        statusClass = 'model-error';
                        break;
                    case 'testing':
                        statusClass = 'model-testing';
                        break;
                }

                modelDisplayElement.textContent = displayName;
                modelDisplayElement.className = `current-model ${statusClass}`;
                modelDisplayElement.title = `模型: ${displayName} (${modelStatus.status})`;
            }

            // 触发状态更新
            this.updateMainPageStatus();
        } catch (error) {
            console.error('同步主页面模型显示失败:', error);
        }
    }

    // 更新当前服务显示
    updateCurrentServiceDisplay(service) {
        try {
            const serviceNameElement = document.querySelector('#current-service .service-name');
            if (serviceNameElement) {
                const displayName = this.getServiceDisplayName(service);
                serviceNameElement.textContent = displayName;

                // 更新服务图标（如果有）
                const serviceIconElement = document.querySelector('#current-service .service-icon');
                if (serviceIconElement) {
                    serviceIconElement.src = this.getServiceIconPath(service);
                }
            }
        } catch (error) {
            console.error('更新当前服务显示失败:', error);
        }
    }

    // 更新服务切换按钮
    updateServiceSwitchButton(service) {
        try {
            const currentServiceBtn = document.getElementById('current-service');
            if (currentServiceBtn) {
                // 更新按钮属性
                currentServiceBtn.setAttribute('data-service', service);

                // 获取平台状态汇总
                const platformSummary = this.modelStatusManager.getPlatformSummaryStatus(service);

                // 根据平台状态设置按钮样式
                currentServiceBtn.classList.remove('service-ready', 'service-error', 'service-testing', 'service-unknown');

                let statusClass = 'service-unknown';
                switch (platformSummary.status) {
                    case 'success':
                        statusClass = 'service-ready';
                        break;
                    case 'failed':
                        statusClass = 'service-error';
                        break;
                    case 'testing':
                        statusClass = 'service-testing';
                        break;
                }

                currentServiceBtn.classList.add(statusClass);

                // 更新提示文本
                let tooltipText = this.getServiceDisplayName(service);
                if (platformSummary.availableCount > 0) {
                    tooltipText += ` (${platformSummary.availableCount}/${platformSummary.totalCount} 模型可用)`;
                }
                currentServiceBtn.title = tooltipText;
            }
        } catch (error) {
            console.error('更新服务切换按钮失败:', error);
        }
    }

    // 处理服务切换同步
    handleServiceChangeSync(newService) {
        try {
            const currentMode = this.getCurrentRecognitionMode();

            // 检查新服务是否有可用模型
            const availableModels = this.modelStatusManager.getPlatformModelsStatus(newService);
            const hasAvailableModels = Object.values(availableModels).some(status => status.status === 'success');

            if (hasAvailableModels) {
                // 选择第一个可用模型
                const firstAvailableModel = Object.keys(availableModels).find(
                    modelId => availableModels[modelId].status === 'success'
                );

                if (firstAvailableModel) {
                    // 更新识别模式配置
                    this.configManager.setRecognitionModeConfig(currentMode, newService, firstAvailableModel);
                    this.saveConfigSimple();

                    // 同步主页面显示
                    this.syncMainPageModelDisplay(newService, firstAvailableModel);

                    // 触发配置变化事件
                    document.dispatchEvent(new CustomEvent('configModelChanged', {
                        detail: { mode: currentMode, service: newService, model: firstAvailableModel }
                    }));
                }
            } else {
                // 没有可用模型时，仅切换服务但不设置模型
                this.configManager.setRecognitionModeConfig(currentMode, newService, null);
                this.saveConfigSimple();
                this.syncMainPageModelDisplay(newService, null);
            }
        } catch (error) {
            console.error('处理服务切换同步失败:', error);
        }
    }

    // 获取服务显示名称
    getServiceDisplayName(service) {
        console.log('[main.js getServiceDisplayName] 输入:', service);
        const names = {
            native: '本地主机',
            baidu: '百度智能云',
            tencent: '腾讯云',
            aliyun: '阿里云',
            volcano: '火山引擎',
            deeplx: 'DeepLX',
            youdao: '有道翻译',
            baiduFanyi: '百度翻译开放平台',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google',
            alibaba: '阿里云百炼',
            bytedance: '火山引擎',
            zhipu: '智谱AI',
            ocrpro: 'OCR Pro',
            utools: 'uTools AI'
        };
        const result = names[service] || service;
        console.log('[main.js getServiceDisplayName] 输出:', result);
        return result;
    }



    // 绑定主界面模型选择事件
    bindMainPageModelSelectEvents() {
        try {
            // 监听主界面的模型下拉菜单变化（如果存在）
            const mainModelSelect = document.getElementById('main-model-select');
            if (mainModelSelect) {
                mainModelSelect.addEventListener('change', (event) => {
                    const selectedValue = event.target.value;
                    if (selectedValue && selectedValue.includes(':')) {
                        const [platform, modelId] = selectedValue.split(':');
                        this.handleMainPageModelSelection(platform, modelId);
                    }
                });
            }

            // 注意：服务切换按钮的事件监听器在 bindEvents() 方法中统一绑定
            // 这里不再重复绑定，避免冲突

            // 监听识别模式切换 - 新的四个模式按钮
            const modeButtons = document.querySelectorAll('.mode-btn');
            modeButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const mode = button.getAttribute('data-mode');
                    if (mode) {
                        this.handleRecognitionModeChange(mode);
                    }
                });
            });
        } catch (error) {
            console.error('绑定主界面模型选择事件失败:', error);
        }
    }

    // 处理主界面模型选择
    handleMainPageModelSelection(platform, modelId) {
        try {
            const currentMode = this.getCurrentRecognitionMode();

            // 更新识别模式配置
            const result = this.configManager.setRecognitionModeConfig(currentMode, platform, modelId);
            if (result.success) {
                this.config = result.config;
            }

            // 更新全局服务配置以保持一致性
            this.config.service = platform;
            this.saveConfigSimple();

            // 更新主界面显示
            this.uiManager.updateCurrentService(platform, modelId);

            // 更新主页面状态
            this.updateMainPageStatus();

            // 触发配置变化事件，通知配置页面更新
            document.dispatchEvent(new CustomEvent('configModelChanged', {
                detail: { mode: currentMode, service: platform, model: modelId }
            }));

        } catch (error) {
            console.error('处理主界面模型选择失败:', error);
        }
    }

    // 获取识别模式对应的图标SVG
    getModeIconSVG(mode) {
        const iconSVGs = {
            'text': `<path d="M15 12h6"/><path d="M15 6h6"/><path d="m3 13 3.553-7.724a.5.5 0 0 1 .894 0L11 13"/><path d="M3 18h18"/><path d="M3.92 11h6.16"/>`,
            'table': `<path d="M15 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M21 9H3"/><path d="M21 15H3"/>`,
            'formula': `<path d="M3 20h4.5a.5.5 0 0 0 .5-.5v-.282a.52.52 0 0 0-.247-.437 8 8 0 1 1 8.494-.001.52.52 0 0 0-.247.438v.282a.5.5 0 0 0 .5.5H21"/>`,
            'markdown': `<rect width="18" height="18" x="3" y="3" rx="2"/><g transform="rotate(90 12 12)"><path d="M16 8.9V7H8l4 5-4 5h8v-1.9"/></g>`
        };
        return iconSVGs[mode] || iconSVGs['text'];
    }

    // 处理识别模式变化
    handleRecognitionModeChange(newMode) {
        try {
            // 保存当前模式
            this.currentRecognitionMode = newMode;

            // 更新四个模式按钮的选中状态和滑块位置
            const modeButtons = document.querySelectorAll('.mode-btn');
            const modeSlider = document.querySelector('.mode-slider');
            const modeOrder = ['text', 'table', 'formula', 'markdown'];
            const activeIndex = modeOrder.indexOf(newMode);

            modeButtons.forEach(button => {
                button.classList.remove('active');
                if (button.getAttribute('data-mode') === newMode) {
                    button.classList.add('active');
                }
            });

            // 更新滑块位置和大小
            this.updateModeSlider();

            // 切换布局显示模式
            this.switchLayoutMode(newMode);

            // 立即更新主界面模型按钮显示 - 使用新的统一方法
            this.updateMainInterfaceModelFromConfig();

            // 触发自动重新识别（如果满足条件）
            this.triggerAutoReRecognize();

            // 触发识别模式变化事件
            document.dispatchEvent(new CustomEvent('recognitionModeChanged', {
                detail: { mode: newMode }
            }));

        } catch (error) {
            console.error('处理识别模式变化失败:', error);
        }
    }

    // 更新模式滑块位置和大小
    updateModeSlider() {
        try {
            const modeSlider = document.querySelector('.mode-slider');
            if (!modeSlider || !this.currentRecognitionMode) return;

            const activeButton = document.querySelector(`.mode-btn[data-mode="${this.currentRecognitionMode}"]`);
            if (!activeButton) return;

            const buttonRect = activeButton.getBoundingClientRect();
            const containerRect = activeButton.parentElement.getBoundingClientRect();

            // 设置滑块的大小和位置与激活按钮完全匹配
            modeSlider.style.width = `${buttonRect.width}px`;
            modeSlider.style.left = `${buttonRect.left - containerRect.left}px`;
            modeSlider.style.transform = 'translateY(-50%)';
        } catch (error) {
            console.error('更新模式滑块失败:', error);
        }
    }



    // 统一错误处理方法
    handleError(error, defaultMessage = '操作失败', options = {}) {
        const {
            showError = true,
            hideLoading = true,
            enableButtons = false,
            resetStatus = false,
            notificationType = 'error'
        } = options;

        if (hideLoading) {
            this.uiManager.hideLoading();
        }

        const errorMessage = error?.message || defaultMessage;

        if (showError) {
            // 检查是否为mainHide功能且窗口不可见
            const currentFeature = window.ocrAPI?.getCurrentFeature();
            const mainHideFeatures = ['ocr-screenshot', 'ocr-table', 'ocr-formula', 'ocr-markdown', 'ocr-and-translate', 'image-translate-screenshot'];

            if (mainHideFeatures.includes(currentFeature) && !this.uiManager.isWindowVisible()) {
                // mainHide功能且窗口不可见：使用系统通知
                this.showSilentNotification(errorMessage, notificationType);
            } else {
                // 窗口可见：使用UI通知
                if (notificationType === 'error') {
                    this.uiManager.showError(errorMessage);
                } else {
                    this.uiManager.showNotification(errorMessage, notificationType);
                }
            }
        }

        if (enableButtons) {
            this.uiManager.setButtonsEnabled(true);
        }

        if (resetStatus) {
            this.uiManager.updateRecognitionStatus('idle', '等待识别');
        }

        return errorMessage;
    }

    // 安全执行异步操作
    async safeExecute(operation, errorMessage = '操作失败', showError = true) {
        try {
            return await operation();
        } catch (error) {
            return this.handleError(error, errorMessage, showError);
        }
    }

    // 防抖工具函数
    debounce(func, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // 获取DOM元素的安全方法
    getElement(id) {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Element with id '${id}' not found`);
        }
        return element;
    }

    // 获取模型选择框（已废弃，保留用于兼容性）
    getModelSelect() {
        // 所有AI平台都已迁移到新的模型管理UI，不再使用传统的select下拉框
        return null;
    }

    // 获取模型显示名称（用于历史记录等）
    getModelDisplayNameForHistory(service, serviceConfig) {
        if (!serviceConfig) return 'default';

        // 对于AI平台，尝试使用友好名称
        const aiPlatforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'];
        if (aiPlatforms.includes(service)) {
            const modelId = serviceConfig.model;
            if (!modelId) return 'default';

            // 对于所有AI平台，尝试使用友好名称
            try {
                const platformConfig = this.config[service];
                if (platformConfig && platformConfig.modelNameMap) {
                    const modelNameMap = platformConfig.modelNameMap;
                    return modelNameMap[modelId] || modelId;
                }
            } catch (error) {
                // 使用原始模型名称作为降级方案
            }

            return modelId;
        }

        // 对于传统OCR，返回默认名称
        if (service === 'baidu') {
            return 'default';
        }

        return 'default';
    }

    // 显示Toast通知
    showToast(message, type = 'success') {
        if (this.uiManager && this.uiManager.showNotification) {
            this.uiManager.showNotification(message, type);
        }
    }

    // 处理模型选择框错误
    handleModelSelectError(modelSelect, errorMessage = '获取模型列表失败') {
        if (modelSelect) {
            modelSelect.innerHTML = `<option value="">${errorMessage}</option>`;
            modelSelect.disabled = false;
        }
    }

    // 初始化智能模型选择：为所有平台确保有当前选中模型
    initializeSmartModelSelection() {
        const aiPlatforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'utools'];

        aiPlatforms.forEach(platform => {
            this.ensureCurrentModel(platform);
        });


    }

    init() {
        // 初始化配置哈希值
        this.lastConfigHash = this.generateConfigHash(this.config);

        // 设置模型能力检测器全局引用
        window.modelCapabilityDetector = this.modelCapabilityDetector;

        this.uiManager.init();

        // 应用自定义窗口高度设置
        this.applyCustomWindowHeight();

        this.bindEvents();
        this.loadConfigUI();

        // 初始化识别模式
        this.initRecognitionMode();

        // 设置主页面模型同步
        this.setupMainPageModelSync();

        // 绑定主界面模型选择事件
        this.bindMainPageModelSelectEvents();

        // 初始化智能模型选择：为所有平台确保有当前选中模型
        this.initializeSmartModelSelection();

        // 初始化时使用新的统一状态管理系统
        this.updateMainPageStatus();

        // 延迟恢复传统服务状态，确保DOM完全渲染
        setTimeout(() => {
            // 恢复传统服务测试按钮状态
            this.uiManager.restoreTraditionalServiceTestButtonStates();

            // 更新所有服务的卡片状态指示器
            this.updateAllServiceIndicators();
        }, 100);

        // 监听uTools插件进入事件
        window.addEventListener('utools-plugin-enter', (event) => {
            const { code, payload, from, option } = event.detail;
            this.handlePluginEnter(code, payload, from, option);
        });

        // 监听删除自定义服务商确认事件
        window.addEventListener('custom-provider-delete-confirmed', () => {
            this.executeDeleteCustomProvider();
        });

        // 根据启动参数决定初始行为
        this.handleInitialFeature();
    }

    // 应用自定义窗口高度设置
    applyCustomWindowHeight() {
        try {
            // 从配置中读取自定义窗口高度
            const customHeight = this.config?.ui?.customWindowHeight || 600;

            // 使用 UIManager 的方法应用窗口高度
            if (this.uiManager && typeof this.uiManager.applyWindowHeight === 'function') {
                this.uiManager.applyWindowHeight(customHeight);
            } else {
                // 如果 UIManager 方法不可用，直接调用 uTools API
                if (typeof utools !== 'undefined' && typeof utools.setExpendHeight === 'function') {
                    utools.setExpendHeight(customHeight);

                }
            }
        } catch (error) {
            console.error('[窗口高度] 应用自定义窗口高度失败:', error);
        }
    }

    // 处理初始功能
    handleInitialFeature() {
        const feature = this.getCurrentFeature();
        const featureHandlers = {
            'ocr-config': () => this.uiManager.showConfigView(),

            'ocr-files': () => this.handleFilesFeature(),
            'ocr-clipboard': () => this.delayedAction(() => this.handleImageInput()),
            'ocr-clipboard-direct': () => this.delayedAction(() => this.handleClipboardDirectOCR()),
            'ocr-screenshot': () => this.delayedAction(() => this.takeScreenshot()),
            'ocr-table': () => this.handleModeFeature('table'),
            'ocr-formula': () => this.handleModeFeature('formula'),
            'ocr-markdown': () => this.handleModeFeature('markdown'),
            'ocr-handwriting': () => this.handleHandwritingFeature(),

            // 新增指令功能
            'translate': () => this.handleTranslateFeature(),
            'ocr-and-translate': () => this.handleOCRAndTranslateFeature(),
            'history': () => this.handleHistoryFeature(),
            'text-translate': () => this.handleTextTranslateFeature(),
            'image-translate-screenshot': () => this.handleImageTranslateScreenshotFeature(),
            'image-translate-files': () => this.handleImageTranslateFilesFeature(),
            'image-translate-clipboard': () => this.handleImageTranslateClipboardFeature(),
            'image-ocr-and-translate': () => this.handleImageOCRAndTranslateFeature(),
            'clipboard-ocr-and-translate': () => this.handleClipboardOCRAndTranslateFeature(),
            'clipboard-text-translate': () => this.delayedAction(() => this.handleClipboardTextTranslateFeature()),
            'mini-translate': () => this.handleMiniTranslateFeature(),
            'translate-clipboard': () => this.delayedAction(() => this.handleClipboardTextTranslateFeature()),
            'translate-clipboard-mini': () => this.handleClipboardTextTranslateMiniFeature(),
            'text-translate-mini': () => this.handleTextTranslateMiniFeature(),

            'default': () => this.uiManager.showMainView()
        };

        const handler = featureHandlers[feature] || featureHandlers['default'];
        handler();
    }


    // 处理文件功能
    handleFilesFeature() {
        const payload = window.ocrAPI?.getPayload();

        // 检查payload是否是文件数组格式
        if (Array.isArray(payload) && payload.length > 0) {
            // 处理单个图片文件
            this.uiManager.showMainView();
            this.handleImageInput(payload);
        } else if (payload && payload.type === 'files' && Array.isArray(payload.data) && payload.data.length > 0) {
            // 处理标准格式的files payload
            this.uiManager.showMainView();
            this.handleImageInput(payload);
        } else {
            this.uiManager.showMainView();
            this.uiManager.showError('请选择图片文件进行识别');
        }
    }

    // 处理剪切板直接OCR功能
    handleClipboardDirectOCR() {
        this.safeExecute(async () => {
            this.ensureWindowVisible();

            // 使用 preload API 读取剪切板图片
            try {
                const imageBase64 = window.ocrAPI?.readClipboardImage?.();

                if (imageBase64) {
                    // 确保显示主界面
                    this.uiManager.showMainView();

                    // 等待DOM完全准备好的函数
                    const waitForDOMReady = () => {
                        return new Promise((resolve) => {
                            const checkDOM = () => {
                                const imagePreview = document.getElementById('image-preview');
                                const previewImg = document.getElementById('preview-img');
                                const placeholder = document.getElementById('preview-placeholder');

                                if (imagePreview && previewImg && placeholder) {
                                    resolve();
                                } else {
                                    setTimeout(checkDOM, 10);
                                }
                            };
                            checkDOM();
                        });
                    };

                    // 等待DOM准备好后再执行OCR
                    await waitForDOMReady();
                    setTimeout(() => {
                        this.performOCR(imageBase64);
                    }, 50);
                } else {
                    // 没有图片数据时，显示主界面并提示错误
                    this.uiManager.showMainView();
                    this.uiManager.showError('剪切板中没有图片数据，请先复制图片到剪切板');
                }
            } catch (error) {
                console.error('读取剪切板失败:', error);
                // 出错时显示主界面并提示错误
                this.uiManager.showMainView();
                this.uiManager.showError('无法读取剪切板内容，请确保已复制图片到剪切板');
            }
        }, '剪切板OCR处理失败');
    }



    // 处理识别模式功能
    handleModeFeature(mode) {
        // 设置识别模式
        this.setRecognitionMode(mode);
        this.uiManager.showMainView();

        // 检查是否有payload数据
        const payload = window.ocrAPI?.getPayload();
        if (payload) {
            this.delayedAction(() => this.handleImageInput());
        } else {
            // 如果没有数据，只在窗口可见时提示用户选择图片或截图
            if (this.uiManager.isWindowVisible()) {
                this.uiManager.showNotification(`已切换到${this.getModeDisplayName(mode)}模式，请选择图片或截图进行识别`);
            }
        }
    }

    // 处理手写公式识别功能
    handleHandwritingFeature() {
        // 设置识别模式为公式
        this.setRecognitionMode('formula');
        this.uiManager.showMainView();

        // 延迟打开手写画板，确保页面完全加载
        this.delayedAction(() => {
            if (window.handwritingFeature && typeof window.handwritingFeature.show === 'function') {
                window.handwritingFeature.show();
            } else {
                // 如果手写功能尚未初始化，等待后再尝试
                setTimeout(() => {
                    if (window.handwritingFeature && typeof window.handwritingFeature.show === 'function') {
                        window.handwritingFeature.show();
                    } else {
                        this.uiManager.showNotification('手写功能初始化中，请稍后再试', 'warning');
                    }
                }, 500);
            }
        }, 100);
    }

    // 获取模式显示名称
    getModeDisplayName(mode) {
        const modeNames = {
            'text': '文字识别',
            'table': '表格识别',
            'formula': '公式识别',
            'markdown': 'Markdown识别'
        };
        return modeNames[mode] || '文字识别';
    }

    // 延迟执行操作
    delayedAction(action, delay = 0) {
        requestAnimationFrame(() => {
            if (delay > 0) {
                setTimeout(action, delay);
            } else {
                action();
            }
        });
    }

    // 处理翻译功能指令
    handleTranslateFeature() {
        this.uiManager.showTranslateView();
    }

    // 处理识别并翻译功能指令
    handleOCRAndTranslateFeature() {
        // 先切换到文字识别模式
        this.setRecognitionMode('text');

        // 设置标志位，识别完成后自动跳转到翻译页面
        this.shouldAutoTranslateAfterOCR = true;

        // 对于"识别并翻译"功能，采用与其他截图命令一致的逻辑：
        // 1. 截图前不显示窗口（避免干扰截图）
        // 2. 截图完成后再显示窗口并展示结果
        this.takeScreenshot();
    }

    // 处理历史记录功能指令
    handleHistoryFeature() {
        this.uiManager.showHistoryView();
    }

    // 处理文本翻译匹配指令
    handleTextTranslateFeature() {
        // 尝试多种方式获取payload
        let payload = window.ocrAPI?.getPayload();
        let textToTranslate = null;

        // 检查不同的payload格式
        if (payload) {
            if (typeof payload === 'string') {
                // 直接是文本字符串
                textToTranslate = payload;
            } else if (payload.text) {
                // payload对象包含text属性
                textToTranslate = payload.text;
            } else if (typeof payload === 'object' && payload.data) {
                // payload对象包含data属性
                textToTranslate = payload.data;
            }
        }

        // 如果还没有获取到文本，尝试从utools直接获取
        if (!textToTranslate && typeof utools !== 'undefined' && utools.getPayload) {
            try {
                const utoolsPayload = utools.getPayload();
                if (utoolsPayload) {
                    if (typeof utoolsPayload === 'string') {
                        textToTranslate = utoolsPayload;
                    } else if (utoolsPayload.text) {
                        textToTranslate = utoolsPayload.text;
                    } else if (utoolsPayload.data) {
                        textToTranslate = utoolsPayload.data;
                    }
                }
            } catch (error) {
                console.error('获取utools payload失败:', error);
            }
        }

        // 如果有文本，先预设到全局变量中，让翻译页面初始化时直接使用
        if (textToTranslate) {
            window.pendingTranslateText = textToTranslate;
            // 设置自动翻译标识
            window.shouldAutoTranslateFromOCR = true;
        }

        // 跳转到翻译页面
        this.uiManager.showTranslateView();
    }

    // 处理文本翻译-小窗匹配指令（选中文本后打开小窗翻译）
    handleTextTranslateMiniFeature() {
        // 尝试多种方式获取payload
        let payload = window.ocrAPI?.getPayload();
        let textToTranslate = null;

        // 检查不同的payload格式
        if (payload) {
            if (typeof payload === 'string') {
                // 直接是文本字符串
                textToTranslate = payload;
            } else if (payload.text) {
                // payload对象包含text属性
                textToTranslate = payload.text;
            } else if (typeof payload === 'object' && payload.data) {
                // payload对象包含data属性
                textToTranslate = payload.data;
            }
        }

        // 如果还没有获取到文本，尝试从utools直接获取
        if (!textToTranslate && typeof utools !== 'undefined' && utools.getPayload) {
            try {
                const utoolsPayload = utools.getPayload();
                if (utoolsPayload) {
                    if (typeof utoolsPayload === 'string') {
                        textToTranslate = utoolsPayload;
                    } else if (utoolsPayload.text) {
                        textToTranslate = utoolsPayload.text;
                    } else if (utoolsPayload.data) {
                        textToTranslate = utoolsPayload.data;
                    }
                }
            } catch (error) {
                console.error('获取utools payload失败:', error);
            }
        }

        // 打开小窗翻译，传入选中的文本
        this.openMiniTranslateWithText(textToTranslate || '');
    }

    // 通用方法：打开小窗翻译并传入文本
    openMiniTranslateWithText(text) {
        try {
            // 确保翻译模型选择器已初始化
            if (this.uiManager.initTranslateModelSelector &&
                (!this.uiManager.selectedTranslateModels || this.uiManager.selectedTranslateModels.length === 0)) {
                this.uiManager.initTranslateModelSelector();
            }

            // 获取当前语言设置
            const languages = this.uiManager.getCurrentLanguages ? this.uiManager.getCurrentLanguages() : {};

            // 获取所有翻译模型（取前4个）- 模型列表从主页面获取
            const allTranslateModels = this.configManager.getTranslateModels() || [];
            const modelsToShow = allTranslateModels.slice(0, 4);

            // 获取小窗翻译独立保存的模型启用状态
            let miniTranslateSelectedKeys = [];
            try {
                const savedMiniSelection = utools.dbStorage.getItem('miniTranslate_selectedModels');
                if (savedMiniSelection && Array.isArray(savedMiniSelection)) {
                    miniTranslateSelectedKeys = savedMiniSelection;
                }
            } catch (e) {
                // 读取失败，使用空数组
            }

            // 如果没有小窗翻译的保存状态，默认只启用第一个模型
            const shouldDefaultSelectFirst = miniTranslateSelectedKeys.length === 0 && modelsToShow.length > 0;

            // 为所有模型添加完整信息和选中状态
            const modelsWithInfo = modelsToShow.map((m, index) => {
                // 获取显示名称
                let displayName = m.model;
                const type = m.model === 'traditional' ? 'traditional' : 'ai';

                if (type === 'traditional') {
                    displayName = this.configManager.getServiceDisplayName(m.service);
                } else {
                    // AI模型，尝试获取友好名称
                    try {
                        const platformConfig = this.config[m.service];
                        if (platformConfig && platformConfig.modelNameMap) {
                            displayName = platformConfig.modelNameMap[m.model] || m.model;
                        }
                    } catch (e) {
                        // 使用原始名称
                    }
                }

                // 获取图标HTML（如果可用）
                let iconHtml = '';
                if (this.uiManager.createProviderIconElement) {
                    iconHtml = this.uiManager.createProviderIconElement(m.service, 'small') || '';
                }

                // 检查是否选中 - 使用小窗翻译独立的启用状态
                const modelKey = `${m.service}:${m.model}`;
                // 如果没有保存的状态，默认只启用第一个模型；否则使用保存的状态
                const isSelected = shouldDefaultSelectFirst
                    ? (index === 0)  // 默认只启用第一个模型
                    : miniTranslateSelectedKeys.includes(modelKey);

                return {
                    service: m.service,
                    model: m.model,
                    name: displayName,
                    type: type,
                    iconHtml: iconHtml,
                    isSelected: isSelected
                };
            });

            // 获取语言列表 - 使用translate页面相同的列表
            const languageOptions = this.uiManager.translateLanguageOptions || [];
            const languageList = languageOptions.map(lang => ({
                code: lang.langCode,
                name: lang.label || lang.value,
                emoji: lang.emoji
            }));

            // 获取当前主题
            const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';

            // 准备初始化数据
            const initData = {
                text: text,
                sourceLang: languages.sourceLanguage ? {
                    code: languages.sourceLanguage.langCode || 'en-us',
                    name: languages.sourceLanguage.label || languages.sourceLanguage.value || '英语',
                    emoji: languages.sourceLanguage.emoji || '🇬🇧'
                } : { code: 'en-us', name: '英语', emoji: '🇬🇧' },
                targetLang: languages.targetLanguage ? {
                    code: languages.targetLanguage.langCode || 'zh-cn',
                    name: languages.targetLanguage.label || languages.targetLanguage.value || '中文(简)',
                    emoji: languages.targetLanguage.emoji || '🇨🇳'
                } : { code: 'zh-cn', name: '中文(简)', emoji: '🇨🇳' },
                models: modelsWithInfo,
                languages: languageList,
                theme: isDarkTheme ? 'dark' : 'light',
                autoTranslate: text.length > 0  // 如果有文本自动翻译
            };

            // 隐藏主窗口（小窗翻译是独立窗口）
            if (typeof utools !== 'undefined' && utools.hideMainWindow) {
                utools.hideMainWindow();
            }

            // 打开小窗翻译
            window.ocrAPI?.miniTranslate?.open(initData);

        } catch (error) {
            console.error('打开小窗翻译失败:', error);
            // 回退到主翻译页面
            this.uiManager.showTranslateView();
        }
    }

    // 处理剪切板文本翻译指令
    handleClipboardTextTranslateFeature() {
        try {
            // 读取剪切板文本
            const clipboardText = window.ocrAPI?.readClipboardText?.();

            if (clipboardText) {
                // 设置待翻译文本
                window.pendingTranslateText = clipboardText;
                // 设置自动翻译标识
                window.shouldAutoTranslateFromOCR = true;
            }
            // 如果没有文本，则正常打开翻译页面（不显示提示）

            // 跳转到翻译页面
            this.uiManager.showTranslateView();
        } catch (error) {
            console.error('处理剪切板文本翻译失败:', error);
            this.uiManager.showTranslateView();
        }
    }

    // 处理剪切板文本小窗翻译指令
    handleClipboardTextTranslateMiniFeature() {
        try {
            // 读取剪切板文本
            const clipboardText = window.ocrAPI?.readClipboardText?.() || '';

            // 确保翻译模型选择器已初始化
            if (this.uiManager.initTranslateModelSelector &&
                (!this.uiManager.selectedTranslateModels || this.uiManager.selectedTranslateModels.length === 0)) {
                this.uiManager.initTranslateModelSelector();
            }

            // 获取当前语言设置
            const languages = this.uiManager.getCurrentLanguages ? this.uiManager.getCurrentLanguages() : {};

            // 获取所有翻译模型（取前4个）- 模型列表从主页面获取
            const allTranslateModels = this.configManager.getTranslateModels() || [];
            const modelsToShow = allTranslateModels.slice(0, 4);

            // 获取小窗翻译独立保存的模型启用状态
            let miniTranslateSelectedKeys = [];
            try {
                const savedMiniSelection = utools.dbStorage.getItem('miniTranslate_selectedModels');
                if (savedMiniSelection && Array.isArray(savedMiniSelection)) {
                    miniTranslateSelectedKeys = savedMiniSelection;
                }
            } catch (e) {
                // 读取失败，使用空数组
            }

            // 如果没有小窗翻译的保存状态，默认只启用第一个模型
            const shouldDefaultSelectFirst = miniTranslateSelectedKeys.length === 0 && modelsToShow.length > 0;

            // 为所有模型添加完整信息和选中状态
            const modelsWithInfo = modelsToShow.map((m, index) => {
                // 获取显示名称
                let displayName = m.model;
                const type = m.model === 'traditional' ? 'traditional' : 'ai';

                if (type === 'traditional') {
                    displayName = this.configManager.getServiceDisplayName(m.service);
                } else {
                    // AI模型，尝试获取友好名称
                    try {
                        const platformConfig = this.config[m.service];
                        if (platformConfig && platformConfig.modelNameMap) {
                            displayName = platformConfig.modelNameMap[m.model] || m.model;
                        }
                    } catch (e) {
                        // 使用原始名称
                    }
                }

                // 获取图标HTML（如果可用）
                let iconHtml = '';
                if (this.uiManager.createProviderIconElement) {
                    iconHtml = this.uiManager.createProviderIconElement(m.service, 'small') || '';
                }

                // 检查是否选中 - 使用小窗翻译独立的启用状态
                const modelKey = `${m.service}:${m.model}`;
                // 如果没有保存的状态，默认只启用第一个模型；否则使用保存的状态
                const isSelected = shouldDefaultSelectFirst
                    ? (index === 0)  // 默认只启用第一个模型
                    : miniTranslateSelectedKeys.includes(modelKey);

                return {
                    service: m.service,
                    model: m.model,
                    name: displayName,
                    type: type,
                    iconHtml: iconHtml,
                    isSelected: isSelected
                };
            });

            // 获取语言列表 - 使用translate页面相同的列表
            const languageOptions = this.uiManager.translateLanguageOptions || [];
            const languageList = languageOptions.map(lang => ({
                code: lang.langCode,
                name: lang.label || lang.value,
                emoji: lang.emoji
            }));

            // 获取当前主题
            const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';

            // 准备初始化数据
            const initData = {
                text: clipboardText,
                sourceLang: languages.sourceLanguage ? {
                    code: languages.sourceLanguage.langCode || 'en-us',
                    name: languages.sourceLanguage.label || languages.sourceLanguage.value || '英语',
                    emoji: languages.sourceLanguage.emoji || '🇬🇧'
                } : { code: 'en-us', name: '英语', emoji: '🇬🇧' },
                targetLang: languages.targetLanguage ? {
                    code: languages.targetLanguage.langCode || 'zh-cn',
                    name: languages.targetLanguage.label || languages.targetLanguage.value || '中文(简)',
                    emoji: languages.targetLanguage.emoji || '🇨🇳'
                } : { code: 'zh-cn', name: '中文(简)', emoji: '🇨🇳' },
                models: modelsWithInfo,
                languages: languageList,
                theme: isDarkTheme ? 'dark' : 'light',
                autoTranslate: clipboardText.length > 0  // 如果有文本自动翻译
            };

            // 隐藏主窗口（小窗翻译是独立窗口）
            if (typeof utools !== 'undefined' && utools.hideMainWindow) {
                utools.hideMainWindow();
            }

            // 打开小窗翻译
            window.ocrAPI?.miniTranslate?.open(initData);

        } catch (error) {
            console.error('处理剪切板文本小窗翻译失败:', error);
            // 回退到主翻译页面
            this.uiManager.showTranslateView();
        }
    }

    // 处理小窗翻译功能指令
    handleMiniTranslateFeature() {
        try {
            // 小窗翻译指令：不读取剪切板，打开空白小窗
            // 与 handleClipboardTextTranslateMiniFeature 不同，后者会自动填入剪切板文本

            // 确保翻译模型选择器已初始化
            if (this.uiManager.initTranslateModelSelector &&
                (!this.uiManager.selectedTranslateModels || this.uiManager.selectedTranslateModels.length === 0)) {
                this.uiManager.initTranslateModelSelector();
            }

            // 获取当前语言设置
            const languages = this.uiManager.getCurrentLanguages ? this.uiManager.getCurrentLanguages() : {};

            // 获取所有翻译模型（取前4个）- 模型列表从主页面获取
            const allTranslateModels = this.configManager.getTranslateModels() || [];
            const modelsToShow = allTranslateModels.slice(0, 4);

            // 获取小窗翻译独立保存的模型启用状态
            let miniTranslateSelectedKeys = [];
            try {
                const savedMiniSelection = utools.dbStorage.getItem('miniTranslate_selectedModels');
                if (savedMiniSelection && Array.isArray(savedMiniSelection)) {
                    miniTranslateSelectedKeys = savedMiniSelection;
                }
            } catch (e) {
                // 读取失败，使用空数组
            }

            // 如果没有小窗翻译的保存状态，默认启用所有模型
            const shouldDefaultSelectFirst = miniTranslateSelectedKeys.length === 0 && modelsToShow.length > 0;

            // 为所有模型添加完整信息和选中状态
            const modelsWithInfo = modelsToShow.map((m, index) => {
                // 获取显示名称
                let displayName = m.model;
                const type = m.model === 'traditional' ? 'traditional' : 'ai';

                if (type === 'traditional') {
                    displayName = this.configManager.getServiceDisplayName(m.service);
                } else {
                    // AI模型，尝试获取友好名称
                    try {
                        const platformConfig = this.config[m.service];
                        if (platformConfig && platformConfig.modelNameMap) {
                            displayName = platformConfig.modelNameMap[m.model] || m.model;
                        }
                    } catch (e) {
                        // 使用原始名称
                    }
                }

                // 获取图标HTML（如果可用）
                let iconHtml = '';
                if (this.uiManager.createProviderIconElement) {
                    iconHtml = this.uiManager.createProviderIconElement(m.service, 'small') || '';
                }

                // 检查是否选中 - 使用小窗翻译独立的启用状态
                const modelKey = `${m.service}:${m.model}`;
                // 如果没有保存的状态，默认只启用第一个模型；否则使用保存的状态
                const isSelected = shouldDefaultSelectFirst
                    ? (index === 0)  // 默认只启用第一个模型
                    : miniTranslateSelectedKeys.includes(modelKey);

                return {
                    service: m.service,
                    model: m.model,
                    name: displayName,
                    type: type,
                    iconHtml: iconHtml,
                    isSelected: isSelected
                };
            });

            // 获取语言列表 - 使用translate页面相同的列表
            const languageOptions = this.uiManager.translateLanguageOptions || [];
            const languageList = languageOptions.map(lang => ({
                code: lang.langCode,
                name: lang.label || lang.value,
                emoji: lang.emoji
            }));

            // 获取当前主题
            const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';

            // 准备初始化数据 - 不传入文本，打开空白小窗
            const initData = {
                text: '',  // 空白文本
                sourceLang: languages.sourceLanguage ? {
                    code: languages.sourceLanguage.langCode || 'en-us',
                    name: languages.sourceLanguage.label || languages.sourceLanguage.value || '英语',
                    emoji: languages.sourceLanguage.emoji || '🇬🇧'
                } : { code: 'en-us', name: '英语', emoji: '🇬🇧' },
                targetLang: languages.targetLanguage ? {
                    code: languages.targetLanguage.langCode || 'zh-cn',
                    name: languages.targetLanguage.label || languages.targetLanguage.value || '中文(简)',
                    emoji: languages.targetLanguage.emoji || '🇨🇳'
                } : { code: 'zh-cn', name: '中文(简)', emoji: '🇨🇳' },
                models: modelsWithInfo,
                languages: languageList,
                theme: isDarkTheme ? 'dark' : 'light',
                autoTranslate: false  // 空白窗口不自动翻译
            };

            // 隐藏主窗口（小窗翻译是独立窗口）
            if (typeof utools !== 'undefined' && utools.hideMainWindow) {
                utools.hideMainWindow();
            }

            // 打开小窗翻译
            window.ocrAPI?.miniTranslate?.open(initData);

        } catch (error) {
            console.error('处理小窗翻译失败:', error);
            // 回退到主翻译页面
            this.uiManager.showTranslateView();
        }
    }

    // 统一的截图命令处理
    handleScreenshotCommand(mode) {
        this.setRecognitionMode(mode);
        if (this.shouldShowMainWindow()) {
            this.uiManager.showMainView();
            this.delayedAction(() => this.takeScreenshot());
        } else {
            this.takeScreenshot();
        }
    }

    // 处理OCR并翻译命令
    handleOCRAndTranslateCommand() {
        this.setRecognitionMode('text');
        this.shouldAutoTranslateAfterOCR = true;
        if (this.shouldShowMainWindow()) {
            this.uiManager.showMainView();
            this.delayedAction(() => this.takeScreenshot());
        } else {
            this.takeScreenshot();
        }
    }

    // 处理图片翻译截图命令
    handleImageTranslateScreenshotCommand() {
        if (this.shouldShowMainWindow()) {
            this.uiManager.showImageTranslateView();
            this.delayedAction(() => this.takeScreenshotForImageTranslate());
        } else {
            this.takeScreenshotForImageTranslate();
        }
    }

    // 处理文件命令
    handleFilesCommand(payload) {
        if (Array.isArray(payload) && payload.length > 0) {
            this.uiManager.showMainView();
            this.handleImageInput(payload);
        } else if (payload && payload.type === 'files' && Array.isArray(payload.data) && payload.data.length > 0) {
            this.uiManager.showMainView();
            this.handleImageInput(payload);
        } else {
            this.uiManager.showMainView();
            this.uiManager.showError('请选择图片文件进行识别');
        }
    }

    // 处理默认命令
    handleDefaultCommand(payload) {
        if (payload) {
            this.handleImageInput(payload);
        } else {
            this.uiManager.showMainView();
        }
    }

    // 处理图片翻译截图指令
    handleImageTranslateScreenshotFeature() {
        // 采用一致的截图逻辑：截图前不显示窗口，截图完成后再显示
        this.takeScreenshotForImageTranslate();
    }

    // 处理图片文件翻译指令
    handleImageTranslateFilesFeature(payload) {
        // 跳转到图片翻译页面
        this.uiManager.showImageTranslateView();

        if (payload) {
            // 处理图片文件输入
            this.handleImageTranslateInput(payload);
        } else {
            this.uiManager.showError('请选择图片文件进行翻译');
        }
    }

    // 为图片翻译启动截图
    takeScreenshotForImageTranslate() {
        try {
            // 标记截图进行中，避免页面隐藏时误重置状态
            this.isScreenshotInProgress = true;

            // 对于mainHide模式，不显示加载界面
            const currentFeature = window.ocrAPI?.getCurrentFeature();
            if (this.shouldShowMainWindow()) {
                this.uiManager.showLoading('正在截图...<br><small>按ESC键可取消截图</small>');
            }

            window.ocrAPI.screenCapture((imageBase64) => {
                // 截图结束，清除进行中标记
                this.isScreenshotInProgress = false;

                try {
                    if (imageBase64) {
                        // 截图成功，显示主窗口并设置图片
                        if (currentFeature === 'image-translate-screenshot') {
                            // 对于图片翻译截图，总是显示窗口（包括快捷键调用）
                            window.ocrAPI?.showMainWindow();
                            this.uiManager.showImageTranslateView();
                            setTimeout(() => {
                                this.uiManager.setImageTranslateImage(imageBase64);
                                this.uiManager.hideLoading();
                            }, 50);
                        } else {
                            this.uiManager.setImageTranslateImage(imageBase64);
                            if (this.shouldShowMainWindow()) {
                                this.uiManager.hideLoading();
                            }
                        }
                    } else {
                        // 截图失败或取消
                        if (this.shouldShowMainWindow()) {
                            this.uiManager.hideLoading();
                            this.uiManager.showNotification('截图已取消', 'warning', 2000);
                        } else {
                            // 窗口不可见时使用系统通知
                            this.showSilentNotification('截图已取消', 'warning');
                        }
                    }
                } catch (error) {
                    console.error('截图回调处理失败:', error);
                    if (this.shouldShowMainWindow()) {
                        this.uiManager.hideLoading();
                        this.uiManager.showError('截图处理失败');
                    }
                }
            });
        } catch (error) {
            console.error('截图启动失败:', error);
            this.isScreenshotInProgress = false;
            if (this.shouldShowMainWindow()) {
                this.uiManager.showError('无法启动截图功能');
            }
        }
    }

    // 处理图片翻译的图片输入
    handleImageTranslateInput(payload) {
        this.safeExecute(async () => {
            this.ensureWindowVisible();

            if (!payload) {
                this.uiManager.showError('没有接收到图片数据');
                return;
            }

            // 处理不同类型的payload
            const imageData = this.extractImageData(payload);

            if (imageData) {
                this.uiManager.showLoading('正在读取图片...');

                if (imageData.type === 'base64') {
                    // 检测并转换图片格式
                    const formatResult = await this.ocrServices.validateAndConvertImageFormat(imageData.data, {
                        showWarning: true,
                        autoConvert: true
                    });

                    if (!formatResult.success) {
                        this.uiManager.hideLoading();
                        this.uiManager.showError(formatResult.error || '不支持的图片格式');
                        return;
                    }

                    // 如果格式被转换，显示提示
                    if (formatResult.converted) {
                        this.uiManager.showNotification(
                            `图片格式已自动转换：${formatResult.originalFormat?.toUpperCase()} → PNG`,
                            'info',
                            3000
                        );
                    }

                    this.uiManager.setImageTranslateImage(formatResult.imageBase64);
                } else if (imageData.type === 'path') {
                    await this.loadImageForImageTranslate(imageData.data);
                }

                this.uiManager.hideLoading();
            } else {
                this.uiManager.showError('不支持的图片格式或数据，请手动选择图片文件');
            }
        }, '图片处理失败');
    }

    // 为图片翻译加载图片文件
    async loadImageForImageTranslate(imagePath) {
        try {
            this.uiManager.showLoading('正在读取图片...');

            // 复用现有的图片加载逻辑
            const fileContent = await this.loadImageFromPath(imagePath, true);

            if (fileContent) {
                this.uiManager.setImageTranslateImage(fileContent);
            } else {
                throw new Error('无法读取图片文件');
            }

        } catch (error) {
            console.error('图片翻译文件加载失败:', error);
            this.uiManager.showError('图片加载失败，请手动选择图片文件');
        } finally {
            this.uiManager.hideLoading();
        }
    }

    // 处理剪切板图片翻译指令
    handleImageTranslateClipboardFeature() {
        // 跳转到图片翻译页面
        this.uiManager.showImageTranslateView();

        // 延迟处理剪切板图片
        this.delayedAction(() => {
            this.handleImageTranslateClipboard();
        });
    }

    // 处理剪切板图片翻译
    handleImageTranslateClipboard() {
        this.safeExecute(async () => {
            this.ensureWindowVisible();

            // 复用现有的剪切板图片处理逻辑
            const payload = window.ocrAPI?.getPayload();

            if (payload) {
                // 处理剪切板图片输入
                this.handleImageTranslateInput(payload);
            } else {
                this.uiManager.showError('剪切板中没有图片数据');
            }
        }, '剪切板图片处理失败');
    }

    // 处理图片识别并翻译指令
    handleImageOCRAndTranslateFeature() {
        const payload = window.ocrAPI?.getPayload();

        // 检查payload是否是文件数组格式
        if (Array.isArray(payload) && payload.length > 0) {
            // 处理单个图片文件
            this.uiManager.showMainView();

            // 设置文字识别模式
            this.setRecognitionMode('text');

            // 设置标志位，识别完成后自动跳转到翻译页面
            this.shouldAutoTranslateAfterOCR = true;

            // 处理图片输入进行OCR识别
            this.handleImageInput(payload);
        } else if (payload && payload.type === 'files' && Array.isArray(payload.data) && payload.data.length > 0) {
            // 处理标准格式的files payload
            this.uiManager.showMainView();

            // 设置文字识别模式
            this.setRecognitionMode('text');

            // 设置标志位，识别完成后自动跳转到翻译页面
            this.shouldAutoTranslateAfterOCR = true;

            // 处理图片输入进行OCR识别
            this.handleImageInput(payload);
        } else {
            this.uiManager.showMainView();
            this.uiManager.showError('请选择图片文件进行识别并翻译');
        }
    }

    // 处理剪切板图片识别并翻译指令
    handleClipboardOCRAndTranslateFeature() {
        this.safeExecute(async () => {
            this.ensureWindowVisible();

            // 设置文字识别模式
            this.setRecognitionMode('text');

            // 设置标志位，识别完成后自动跳转到翻译页面
            this.shouldAutoTranslateAfterOCR = true;

            // 复用现有的剪切板图片处理逻辑
            const payload = window.ocrAPI?.getPayload();

            if (payload) {
                // 显示主界面
                this.uiManager.showMainView();

                // 处理剪切板图片输入进行OCR识别
                this.handleImageInput(payload);
            } else {
                // 如果没有payload，尝试直接读取剪切板
                try {
                    const imageBase64 = window.ocrAPI?.readClipboardImage?.();

                    if (imageBase64) {
                        // 确保显示主界面
                        this.uiManager.showMainView();

                        // 直接处理剪切板图片
                        this.handleImageInput(imageBase64);
                    } else {
                        this.uiManager.showMainView();
                        this.uiManager.showError('剪切板中没有图片数据');
                    }
                } catch (error) {
                    console.error('读取剪切板图片失败:', error);
                    this.uiManager.showMainView();
                    this.uiManager.showError('读取剪切板图片失败');
                }
            }
        }, '剪切板图片识别并翻译失败');
    }

    getCurrentFeature() {
        // 尝试多种方式获取当前功能代码
        if (window.ocrAPI?.getCurrentFeature) {
            const feature = window.ocrAPI.getCurrentFeature();
            if (feature) return feature;
        }

        // 从URL参数获取
        const urlParams = new URLSearchParams(window.location.search);
        const featureFromUrl = urlParams.get('feature');
        if (featureFromUrl) return featureFromUrl;

        // 从全局变量获取
        if (window.currentFeatureCode) return window.currentFeatureCode;

        // 默认返回null
        return null;
    }

    bindEvents() {
        // 主界面事件
        document.getElementById('screenshot-btn').addEventListener('click', () => {
            this.takeScreenshot();
        });

        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        document.getElementById('file-input').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        document.getElementById('config-btn').addEventListener('click', () => {
            this.uiManager.showConfigView();
        });

        document.getElementById('copy-btn').addEventListener('click', () => {
            this.copyResult();
        });


        document.getElementById('translate-btn').addEventListener('click', () => {
            // 设置跳转来源标识，表示这是从OCR页面主动跳转到翻译页面
            window.shouldFillFromOCR = true;
            // 设置自动翻译标识，表示用户主动点击翻译按钮，应该立即执行翻译
            window.shouldAutoTranslateFromOCR = true;
            this.uiManager.showTranslateView();
        });

        // OCR结果朗读按钮
        document.getElementById('ocr-result-tts-btn').addEventListener('click', () => {
            this.handleOCRResultTTS();
        });

        // 重新识别按钮
        document.getElementById('re-recognize-btn').addEventListener('click', () => {
            this.reRecognize();
        });


        // 服务快速切换按钮
        const currentServiceBtn = document.getElementById('current-service');
        if (currentServiceBtn) {
            currentServiceBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                // 实时检查是否有可用模型，确保与按钮显示状态一致
                const availableServices = this.getAvailableServicesForMainInterface();
                const hasAvailableModels = availableServices && availableServices.length > 0;

                // 检查按钮当前显示的文本
                const serviceNameEl = currentServiceBtn.querySelector('.service-name');
                const buttonText = serviceNameEl ? serviceNameEl.textContent : currentServiceBtn.textContent;
                const isShowingConfigPrompt = buttonText === '请先配置模型';

                // 如果按钮显示"请先配置模型"或者确实没有可用模型，跳转到配置页面
                if (isShowingConfigPrompt || !hasAvailableModels) {
                    this.uiManager.showModelServicePage();
                    return;
                }

                // 有可用模型且按钮显示正常，显示切换菜单
                this.toggleServiceSwitchMenu();
            });
        }

        // 点击其他地方关闭菜单
        document.addEventListener('click', (e) => {
            // 关闭服务切换菜单
            if (!e.target.closest('#current-service') && !e.target.closest('#service-switch-menu')) {
                this.hideServiceSwitchMenu();
            }
            // 关闭识别模式模型选择菜单
            if (!e.target.closest('.model-select-container')) {
                this.hideAllRecognitionModeModelMenus();
            }
        });

        // 窗口大小变化时重新计算菜单位置
        window.addEventListener('resize', () => {
            const menu = document.getElementById('service-switch-menu');
            if (menu && menu.style.display === 'block') {
                // 重新显示菜单以更新位置
                this.hideServiceSwitchMenu();
                setTimeout(() => this.showServiceSwitchMenu(), 50);
            }
        });

        // 绑定识别模式模型选择按钮事件
        this.bindRecognitionModeModelEvents();

        // 绑定地域选择事件
        this.bindRegionSelectEvents();

        // 配置界面事件
        document.getElementById('back-btn').addEventListener('click', () => {
            this.uiManager.showMainView();
        });

        document.getElementById('config-translate-btn').addEventListener('click', () => {
            this.uiManager.showTranslateView();
        });

        // 基础配置按钮事件
        document.getElementById('base-config-btn').addEventListener('click', () => {
            this.uiManager.showBaseConfigPage();
        });

        document.getElementById('model-service-btn').addEventListener('click', () => {
            this.uiManager.showModelServicePage();
        });

        document.getElementById('history-btn').addEventListener('click', () => {
            this.uiManager.showHistoryView('ocr');
        });

        // 模型服务页面的历史记录按钮
        document.getElementById('config-history-btn').addEventListener('click', () => {
            this.uiManager.showHistoryView('ocr');
        });

        // 历史记录页面导航事件
        document.getElementById('history-back-btn').addEventListener('click', () => {
            this.uiManager.showMainView();
        });

        document.getElementById('history-translate-btn').addEventListener('click', () => {
            this.uiManager.showTranslateView();
        });

        // 翻译页面事件
        document.getElementById('translate-settings-btn').addEventListener('click', () => {
            this.uiManager.showConfigView();
        });

        document.getElementById('translate-back-btn').addEventListener('click', () => {
            this.uiManager.showMainView();
        });

        // 翻译输入框的回车键事件由UIManager的bindTranslateButtonEvents()方法统一管理
        // 移除重复的事件绑定以避免多次执行翻译

        // 翻译页面事件由UIManager的bindTranslatePageEvents()方法统一管理
        // 移除重复的事件绑定以避免多次通知
        // 翻译页面主题切换按钮事件也由UIManager的bindTranslatePageEvents()方法统一管理

        document.getElementById('history-base-config-btn').addEventListener('click', () => {
            this.uiManager.showBaseConfigPage();
        });

        document.getElementById('history-model-service-btn').addEventListener('click', () => {
            this.uiManager.showModelServicePage();
        });

        document.getElementById('history-history-btn').addEventListener('click', () => {
            this.uiManager.showHistoryView();
        });

        // 基础配置页面导航事件
        document.getElementById('base-config-back-btn').addEventListener('click', () => {
            this.uiManager.showMainView();
        });

        document.getElementById('base-config-translate-btn').addEventListener('click', () => {
            this.uiManager.showTranslateView();
        });

        document.getElementById('base-config-base-config-btn').addEventListener('click', () => {
            this.uiManager.showBaseConfigPage();
        });

        document.getElementById('base-config-model-service-btn').addEventListener('click', () => {
            this.uiManager.showModelServicePage();
        });

        document.getElementById('base-config-history-btn').addEventListener('click', () => {
            this.uiManager.showHistoryView();
        });

        document.getElementById('ocr-service').addEventListener('change', (e) => {
            this.handleServiceSwitch(e.target.value);
        });

        // 绑定新的模型管理事件
        this.bindModelManagementEvents();

        // 绑定自动保存事件
        this.bindAutoSaveEvents();

        // AI平台事件监听器将在setupConfigFieldListeners中统一设置

        // 添加其他配置字段的修改监听
        this.setupConfigFieldListeners();

        // 绑定API Base URL重置按钮事件
        this.bindResetUrlButtonEvents();

        // 绑定API URL预览更新事件
        this.bindApiUrlPreviewEvents();

        // 保存和测试按钮已移除，改为自动保存



        // 主题切换事件已在UIManager中处理
    }

    // 绑定API Base URL重置按钮事件
    bindResetUrlButtonEvents() {
        // 获取所有重置按钮
        const resetButtons = document.querySelectorAll('.reset-url-btn');

        resetButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const service = button.dataset.service;
                const defaultUrl = button.dataset.default;

                if (service && defaultUrl) {
                    this.resetApiBaseUrl(service, defaultUrl);
                }
            });
        });
    }

    // 重置API Base URL为默认值
    resetApiBaseUrl(service, defaultUrl) {
        const inputId = `${service}-base-url`;
        const input = document.getElementById(inputId);

        if (input) {
            // 设置为默认值
            input.value = defaultUrl;

            // 触发input事件以确保自动保存生效
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // 触发blur事件以激活自动保存机制（文本输入框的自动保存绑定在blur事件上）
            input.dispatchEvent(new Event('blur', { bubbles: true }));

            // 只在窗口可见时显示重置成功提示
            if (this.uiManager.isWindowVisible()) {
                const serviceName = this.uiManager.getServiceDisplayName(service);
                this.uiManager.showNotification(`${serviceName} API地址已重置为默认值`, 'success', 2000);
            }
        }
    }

    // 绑定API URL预览更新事件
    bindApiUrlPreviewEvents() {
        // 默认的Base URL（根地址）
        const defaultBaseUrls = {
            openai: 'https://api.openai.com',  // 改为根地址
            anthropic: 'https://api.anthropic.com',
            google: 'https://generativelanguage.googleapis.com',
            alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
            zhipu: 'https://open.bigmodel.cn/api/paas/v4'
        };

        // 为每个服务绑定输入框事件
        const platforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu'];
        platforms.forEach(service => {
            const inputId = `${service}-base-url`;
            const previewId = `${service}-url-preview`;
            const input = document.getElementById(inputId);
            const preview = document.getElementById(previewId);

            if (input && preview) {
                // 更新预览的函数
                const updatePreview = () => {
                    const baseUrl = input.value.trim() || defaultBaseUrls[service];

                    // 检查是否有"原样使用"标记（末尾的 #）
                    const rawUrl = window.urlUtils.checkRawUrlMarker(baseUrl);
                    if (rawUrl !== null) {
                        // 有 # 标记，直接显示去除 # 后的 URL
                        preview.textContent = rawUrl;
                        return;
                    }

                    // 构建完整URL
                    let fullUrl;
                    if (service === 'openai') {
                        fullUrl = window.urlUtils.buildOpenAIChatUrl(baseUrl, 'https://api.openai.com');
                    } else if (service === 'anthropic') {
                        fullUrl = window.urlUtils.buildAnthropicMessagesUrl(baseUrl);
                    } else if (service === 'google') {
                        // 使用占位模型名生成预览 URL
                        const previewUrl = window.urlUtils.buildGeminiContentUrl(baseUrl, '{model}', 'API_KEY', { stream: false });
                        // 去掉示例中的 key 参数值
                        fullUrl = previewUrl.replace(/key=API_KEY$/, 'key=YOUR_API_KEY');
                    } else if (service === 'alibaba') {
                        const chatBase = window.urlUtils.buildDashscopeChatBase(baseUrl);
                        fullUrl = `${chatBase}/chat/completions`;
                    } else if (service === 'bytedance') {
                        const chatBase = window.urlUtils.buildVolcArkChatBase(baseUrl);
                        fullUrl = `${chatBase}/chat/completions`;
                    } else if (service === 'zhipu') {
                        const chatBase = window.urlUtils.buildZhipuChatBase(baseUrl);
                        fullUrl = `${chatBase}/chat/completions`;
                    }

                    preview.textContent = fullUrl;
                };

                // 监听输入事件
                input.addEventListener('input', updatePreview);
                input.addEventListener('change', updatePreview);

                // 初始化预览
                updatePreview();
            }
        });
    }

    // 更新指定平台的 API URL 预览
    updateApiUrlPreviewForPlatform(platform) {
        // 定义各个服务的默认Base URL
        const defaultBaseUrls = {
            openai: 'https://api.openai.com',
            anthropic: 'https://api.anthropic.com',
            google: 'https://generativelanguage.googleapis.com',
            alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
            zhipu: 'https://open.bigmodel.cn/api/paas/v4'
        };

        const inputId = `${platform}-base-url`;
        const previewId = `${platform}-url-preview`;
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);

        if (!input || !preview) return;

        const baseUrl = input.value.trim() || defaultBaseUrls[platform];

        // 检查是否有"原样使用"标记（末尾的 #）
        const rawUrl = window.urlUtils.checkRawUrlMarker(baseUrl);
        if (rawUrl !== null) {
            // 有 # 标记，直接显示去除 # 后的 URL
            preview.textContent = rawUrl;
            return;
        }

        // 构建完整URL
        let fullUrl;
        if (platform === 'openai') {
            fullUrl = window.urlUtils.buildOpenAIChatUrl(baseUrl, 'https://api.openai.com');
        } else if (platform === 'anthropic') {
            fullUrl = window.urlUtils.buildAnthropicMessagesUrl(baseUrl);
        } else if (platform === 'google') {
            const previewUrl = window.urlUtils.buildGeminiContentUrl(baseUrl, '{model}', 'API_KEY', { stream: false });
            fullUrl = previewUrl.replace(/key=API_KEY$/, 'key=YOUR_API_KEY');
        } else if (platform === 'alibaba') {
            const chatBase = window.urlUtils.buildDashscopeChatBase(baseUrl);
            fullUrl = `${chatBase}/chat/completions`;
        } else if (platform === 'bytedance') {
            const chatBase = window.urlUtils.buildVolcArkChatBase(baseUrl);
            fullUrl = `${chatBase}/chat/completions`;
        } else if (platform === 'zhipu') {
            const chatBase = window.urlUtils.buildZhipuChatBase(baseUrl);
            fullUrl = `${chatBase}/chat/completions`;
        }

        preview.textContent = fullUrl;
    }

    // 截图功能
    takeScreenshot() {
        try {
            // 标记截图进行中，避免页面隐藏时误重置识别模式
            this.isScreenshotInProgress = true;

            // 显示截图状态
            if (!this.isSilentMode) {
                this.uiManager.showLoading('正在截图...<br><small>按ESC键可取消截图</small>');
                this.uiManager.updateRecognitionStatus('capturing', '截图中');
            }

            window.ocrAPI.screenCapture((imageBase64) => {
                // 截图结束，清除进行中标记
                this.isScreenshotInProgress = false;

                try {
                    // 🚀 优化：截图完成后立即显示状态指示器，避免光标加载状态
                    const screenshotEndTime = performance.now();

                    if (imageBase64) {
                        // 立即显示loading状态，不等待任何条件判断
                        if (this.isSilentMode && window.ocrAPI?.statusIndicator) {
                            const statusStartTime = performance.now();
                            window.ocrAPI.statusIndicator.show('loading', false);
                            const statusTime = performance.now() - statusStartTime;

                        }

                        // 截图成功，在静默模式下隐藏窗口
                        if (this.isSilentMode) {
                            this.hideMainWindow();
                        } else {
                            // 对于mainHide模式的截图，只在成功时显示结果窗口
                            const currentFeature = window.ocrAPI?.getCurrentFeature();
                            const mainHideFeatures = ['ocr-screenshot', 'ocr-table', 'ocr-formula', 'ocr-markdown', 'ocr-and-translate'];
                            if (mainHideFeatures.includes(currentFeature)) {
                                // 显示主窗口以显示结果
                                window.ocrAPI?.showMainWindow();
                                this.uiManager.showMainView();
                                // 延迟执行以确保UI已完全加载
                                setTimeout(() => {
                                    this.performOCR(imageBase64);
                                }, 50);
                                return; // 避免重复调用
                            }
                        }

                        // 🚀 优化：异步执行OCR识别，避免阻塞主线程
                        setTimeout(() => {
                            const ocrStartTime = performance.now();

                            this.performOCR(imageBase64);
                        }, 0); // 使用setTimeout(0)将OCR处理推迟到下一个事件循环
                    } else {
                        // 截图失败或取消的处理 - 不显示窗口
                        this.handleScreenshotCancelled();
                        // 取消或失败时不显示窗口，静默退出
                    }
                } catch (error) {
                    console.error('截图回调处理失败:', error);
                    this.handleSilentError(error, '截图处理失败');
                    // 错误情况下也不显示窗口
                }
            });
        } catch (error) {
            // 截图启动失败
            this.isScreenshotInProgress = false;
            console.error('截图启动失败:', error);
            this.handleSilentError(error, '无法启动截图功能');
        }
    }

    // 处理文件选择
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // 重置文件输入框的通用方法
        const resetInput = () => { event.target.value = ''; };

        if (!file.type.startsWith('image/')) {
            this.uiManager.showError('请选择图片文件');
            resetInput();
            return;
        }

        this.safeExecute(async () => {
            this.ensureWindowVisible();
            this.uiManager.showLoading('正在读取图片...');

            const imageBase64 = await this.readFileAsDataURL(file);

            // 检测并转换图片格式
            const formatResult = await this.ocrServices.validateAndConvertImageFormat(imageBase64, {
                showWarning: true,
                autoConvert: true
            });

            if (!formatResult.success) {
                this.uiManager.hideLoading();
                this.uiManager.showError(formatResult.error || '不支持的图片格式');
                resetInput();
                return;
            }

            // 如果格式被转换，显示提示
            if (formatResult.converted) {
                this.uiManager.showNotification(
                    `图片格式已自动转换：${formatResult.originalFormat?.toUpperCase()} → PNG`,
                    'info',
                    3000
                );
            }

            await this.performOCR(formatResult.imageBase64);
            resetInput();
        }, '文件处理失败').then(() => {
            resetInput();
        });
    }

    // 确保窗口可见
    ensureWindowVisible() {
        try {
            if (window.ocrAPI?.showMainWindow) {
                window.ocrAPI.showMainWindow();
            } else if (typeof utools !== 'undefined' && utools.showMainWindow) {
                utools.showMainWindow();
            }
        } catch (e) {
            // 忽略显示窗口失败的错误
        }
    }

    // 读取文件为DataURL
    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('图片读取失败，请重试'));
            reader.readAsDataURL(file);
        });
    }

    // 处理图片输入（来自uTools的图片匹配）
    handleImageInput(payload = null) {
        this.safeExecute(async () => {
            payload = payload || window.ocrAPI?.getPayload();
            this.ensureWindowVisible();

            if (!payload) {
                this.uiManager.showMainView();
                return;
            }

            // 确保显示主界面（修复页面跳转问题）
            this.uiManager.showMainView();

            // 处理不同类型的payload
            const imageData = this.extractImageData(payload);

            if (imageData) {
                if (imageData.type === 'base64') {
                    // 检测并转换图片格式
                    const formatResult = await this.ocrServices.validateAndConvertImageFormat(imageData.data, {
                        showWarning: true,
                        autoConvert: true
                    });

                    if (!formatResult.success) {
                        this.uiManager.showError(formatResult.error || '不支持的图片格式');
                        return;
                    }

                    // 如果格式被转换，显示提示
                    if (formatResult.converted) {
                        this.uiManager.showNotification(
                            `图片格式已自动转换：${formatResult.originalFormat?.toUpperCase()} → PNG`,
                            'info',
                            3000
                        );
                    }

                    await this.performOCR(formatResult.imageBase64);
                } else if (imageData.type === 'path') {
                    await this.loadImageFromPath(imageData.data);
                }
            } else {
                this.uiManager.showError('不支持的图片格式或数据，请手动选择图片文件');
            }
        }, '图片处理失败');
    }

    // 提取图片数据
    extractImageData(payload) {
        // 直接的base64字符串
        if (typeof payload === 'string' && payload.startsWith('data:image/')) {
            return { type: 'base64', data: payload };
        }

        // 文件路径
        const filePath = this.extractImageFilePath(payload);
        if (filePath) {
            return { type: 'path', data: filePath };
        }

        // 对象格式的payload
        if (typeof payload === 'object' && payload !== null) {
            // 检查图片类型
            if (payload.type === 'img' && payload.data?.startsWith('data:image/')) {
                return { type: 'base64', data: payload.data };
            }

            // 检查可能的base64字段
            const base64Fields = ['base64', 'data', 'content'];
            for (const field of base64Fields) {
                const value = payload[field];
                if (typeof value === 'string' && value.startsWith('data:image/')) {
                    return { type: 'base64', data: value };
                }
            }
        }

        return null;
    }

    // 从payload中提取图片文件路径的统一方法
    extractImageFilePath(payload) {
        try {
            // 处理文件对象数组（来自uTools文件匹配）
            if (Array.isArray(payload)) {
                const firstItem = payload[0];

                // 如果是文件对象格式 {path: '...', name: '...', isFile: true}
                if (firstItem && typeof firstItem === 'object' && firstItem.path) {
                    const filePath = firstItem.path;
                    if (typeof filePath === 'string' && filePath.match(/\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i)) {
                        return filePath;
                    }
                }

                // 如果是字符串路径数组
                if (typeof firstItem === 'string' && firstItem.match(/\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i)) {
                    return firstItem;
                }
            }

            // 处理对象格式的payload
            if (typeof payload === 'object' && payload !== null) {
                // 处理files类型
                if (payload.type === 'files' && payload.data) {
                    const filePath = Array.isArray(payload.data) ? payload.data[0] : payload.data;
                    if (typeof filePath === 'string' && filePath.match(/\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i)) {
                        return filePath;
                    }
                }

                // 检查是否有文件路径相关的属性
                const possiblePaths = [payload.path, payload.file, payload.src, payload.url, payload.filePath];
                for (const path of possiblePaths) {
                    if (typeof path === 'string' && path.match(/\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i)) {
                        return path;
                    }
                }
            }

            // 如果是字符串，检查是否是文件路径
            if (typeof payload === 'string' && payload.match(/\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i)) {
                return payload;
            }

            return null;
        } catch (error) {
            console.error('Error in extractImageFilePath:', error);
            return null;
        }
    }

    // 从文件路径加载图片
    async loadImageFromPath(filePath, returnBase64 = false) {
        try {
            this.uiManager.showLoading('正在自动读取图片...');

            // 检查文件路径格式
            if (!filePath || typeof filePath !== 'string') {
                throw new Error('无效的文件路径');
            }

            // 检查文件扩展名
            if (!filePath.match(/\.(png|jpg|jpeg|gif|bmp|webp)$/i)) {
                throw new Error('不支持的图片格式');
            }



            // 尝试多种方式读取文件
            let fileContent = null;
            let lastError = null;

            // 方法1: 尝试使用uTools的文件读取API（如果可用）
            if (window.ocrAPI && window.ocrAPI.readFile) {
                try {
                    const fileData = window.ocrAPI.readFile(filePath);
                    if (fileData) {
                        // 将文件数据转换为base64
                        fileContent = await this.arrayBufferToBase64(fileData, filePath);
                    }
                } catch (utoolsError) {
                    lastError = utoolsError;
                }
            }

            // 方法2: 尝试使用fetch读取
            if (!fileContent) {
                try {
                    const fileUrl = this.normalizeFilePath(filePath);
                    const response = await fetch(fileUrl);
                    if (response.ok) {
                        const blob = await response.blob();
                        fileContent = await this.blobToBase64(blob);
                    } else {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                } catch (fetchError) {
                    lastError = fetchError;
                }
            }

            // 方法3: 如果fetch失败，尝试使用XMLHttpRequest
            if (!fileContent) {
                try {
                    fileContent = await this.loadFileWithXHR(filePath);
                } catch (xhrError) {
                    lastError = xhrError;
                }
            }

            // 方法4: 尝试使用HTML5 File API（如果路径是本地文件）
            if (!fileContent && this.isLocalPath(filePath)) {
                try {
                    fileContent = await this.loadFileWithFileAPI();
                } catch (fileApiError) {
                    lastError = fileApiError;
                }
            }

            // 如果所有方法都失败，回退到手动选择模式
            if (!fileContent) {
                this.uiManager.hideLoading();

                if (returnBase64) {
                    // 如果是返回base64模式，直接抛出错误
                    throw new Error(`无法自动读取图片文件：${lastError?.message || '未知错误'}`);
                } else {
                    // 显示友好的错误提示，并提供手动选择选项
                    const errorMsg = `无法自动读取图片文件：${lastError?.message || '未知错误'}`;
                    this.uiManager.showError(errorMsg + '\n\n请点击"选择图片"按钮手动选择文件');
                    this.uiManager.showMainView();
                    return;
                }
            }

            if (returnBase64) {
                // 如果是返回base64模式，直接返回数据
                this.uiManager.hideLoading();
                return fileContent;
            } else {
                // 执行OCR
                this.performOCR(fileContent);
            }

        } catch (error) {
            if (returnBase64) {
                // 如果是返回base64模式，重新抛出错误
                throw error;
            } else {
                this.handleError(error, '图片加载失败');
                this.uiManager.showError('请点击"选择图片"按钮手动选择文件');
                this.uiManager.showMainView();
            }
        }
    }

    // 将Blob转换为Base64
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // 将ArrayBuffer转换为Base64
    async arrayBufferToBase64(arrayBuffer, filePath) {
        try {
            // 根据文件扩展名确定MIME类型
            const extension = filePath.split('.').pop().toLowerCase();
            const mimeTypes = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'bmp': 'image/bmp',
                'webp': 'image/webp'
            };
            const mimeType = mimeTypes[extension] || 'image/jpeg';

            // 将ArrayBuffer转换为Blob，然后转换为Base64
            const blob = new Blob([arrayBuffer], { type: mimeType });
            return await this.blobToBase64(blob);
        } catch (error) {
            throw new Error('ArrayBuffer转换失败: ' + error.message);
        }
    }

    // 标准化文件路径
    normalizeFilePath(filePath) {
        try {
            // 处理Windows路径
            let normalizedPath = filePath.replace(/\\/g, '/');

            // 如果不是以file://开头，添加file://协议
            if (!normalizedPath.startsWith('file://')) {
                // 处理绝对路径
                if (normalizedPath.match(/^[a-zA-Z]:/)) {
                    // Windows绝对路径 (C:/path/to/file)
                    normalizedPath = 'file:///' + normalizedPath;
                } else if (normalizedPath.startsWith('/')) {
                    // Unix绝对路径 (/path/to/file)
                    normalizedPath = 'file://' + normalizedPath;
                } else {
                    // 相对路径，添加当前目录
                    normalizedPath = 'file:///' + normalizedPath;
                }
            }

            return normalizedPath;
        } catch (error) {
            return filePath;
        }
    }

    // 检查是否是本地文件路径
    isLocalPath(filePath) {
        return filePath && (
            filePath.startsWith('file://') ||
            filePath.match(/^[a-zA-Z]:/) ||  // Windows路径
            filePath.startsWith('/') ||      // Unix路径
            filePath.startsWith('./') ||     // 相对路径
            filePath.startsWith('../')       // 相对路径
        );
    }

    // 使用XMLHttpRequest读取文件
    loadFileWithXHR(filePath) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const normalizedPath = this.normalizeFilePath(filePath);
            xhr.open('GET', normalizedPath, true);
            xhr.responseType = 'blob';

            xhr.onload = async () => {
                if (xhr.status === 200 || xhr.status === 0) { // 本地文件可能返回0
                    try {
                        const base64 = await this.blobToBase64(xhr.response);
                        resolve(base64);
                    } catch (error) {
                        reject(error);
                    }
                } else {
                    reject(new Error(`文件读取失败: HTTP ${xhr.status}`));
                }
            };

            xhr.onerror = () => reject(new Error('网络错误或文件不存在'));
            xhr.send();
        });
    }

    // 使用File API读取文件（实验性）
    async loadFileWithFileAPI() {
        try {
            // 这个方法主要用于处理一些特殊情况
            // 在某些环境中可能不可用
            if (typeof File !== 'undefined' && typeof FileReader !== 'undefined') {
                // 尝试创建一个File对象（这在大多数浏览器环境中不会成功）
                // 但在某些特殊的运行时环境中可能有效
                throw new Error('File API方法在当前环境中不可用');
            } else {
                throw new Error('File API不支持');
            }
        } catch (error) {
            throw new Error('File API读取失败: ' + error.message);
        }
    }





    // 执行OCR识别
    async performOCR(imageBase64) {
        try {
            // 检查是否是新图片，如果是则清理缓存
            if (this.lastImageBase64 !== imageBase64) {
                this.clearRecognitionCache();
            }

            // 保存图片以便重新识别
            this.lastImageBase64 = imageBase64;

            // 显示图片预览（mainHide功能或正常模式）
            if (!this.isSilentMode || this.isMainHideFeature()) {
                this.uiManager.showImagePreview(imageBase64);
            }

            // 获取当前识别模式的配置
            const currentMode = this.currentRecognitionMode || 'text';
            const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);

            // 获取当前配置
            const currentConfig = this.config || this.configManager.getConfig();

            // ========== 二维码检测前置步骤 ==========
            // 检查是否启用了二维码识别
            if (this.qrcodeManager.isQRCodeDetectionEnabled(currentConfig)) {
                try {
                    // 显示二维码检测状态
                    if (!this.isSilentMode) {
                        this.uiManager.showLoading('正在检测二维码...');
                    }

                    // 执行二维码检测
                    const qrResult = await this.qrcodeManager.detectQRCode(imageBase64);

                    if (qrResult && qrResult.success) {
                        // 检测到二维码


                        // 判断是否需要继续进行 OCR 识别
                        const shouldContinue = this.qrcodeManager.shouldContinueOCR(qrResult, currentConfig);

                        if (!shouldContinue) {
                            // 只显示二维码结果,不进行 OCR
                            const formattedResult = this.qrcodeManager.formatQRCodeResult(qrResult);

                            if (!this.isSilentMode) {
                                this.uiManager.hideLoading();
                                this.uiManager.showResult(formattedResult);
                            }

                            // 保存到历史记录 (使用 addHistory 方法)
                            // addHistory(imageData, result, service, model, mode)
                            this.historyManager.addHistory(
                                imageBase64,
                                formattedResult,
                                'qrcode',
                                'jsQR',
                                '二维码'
                            );

                            // 如果是截图并复制模式,复制二维码内容
                            if (this.isScreenshotAndCopyMode) {
                                this.copyToClipboard(qrResult.data);
                                this.showSilentNotification('二维码内容已复制到剪贴板', 'success');
                                this.hideWindowAfterDelay();
                            }

                            return;
                        } else {
                            // 继续进行 OCR 识别模式
                            // 先保存二维码结果到历史记录
                            const formattedResult = this.qrcodeManager.formatQRCodeResult(qrResult);
                            this.historyManager.addHistory(
                                imageBase64,
                                formattedResult,
                                'qrcode',
                                'jsQR',
                                '二维码'
                            );

                            // 显示通知提示用户
                            if (!this.isSilentMode) {
                                this.uiManager.showNotification('检测到二维码，内容已保存到历史记录', 'success', 2000);
                            }

                            // 不保存到临时变量，不合并结果
                            // 继续进行 OCR 识别
                        }
                    }
                } catch (qrError) {
                    console.warn('二维码检测失败,继续进行 OCR 识别:', qrError);
                    // 二维码检测失败不影响 OCR 流程
                }
            }
            // ========== 二维码检测结束 ==========



            // 获取服务名称和配置
            let serviceName, serviceConfig;
            if (modeConfig && modeConfig.service) {
                // 使用识别模式配置
                serviceName = modeConfig.service;

                // 创建临时配置对象，包含识别模式的模型配置
                const tempServiceConfig = { ...(this.config[serviceName] || {}) };
                if (modeConfig.model) {
                    tempServiceConfig.model = modeConfig.model;
                }

                serviceConfig = this.configManager.getServiceConfig({
                    service: serviceName,
                    ...this.config,
                    [serviceName]: tempServiceConfig
                });

                // 对于LLM服务，设置识别模式特定的提示词
                const aiLLMServices = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'];
                const isLLMService = aiLLMServices.includes(serviceName) || this.configManager.isCustomLLMProvider(serviceName);
                if (isLLMService) {
                    serviceConfig.prompt = this.getRecognitionModePrompt(currentMode, serviceConfig.prompt);
                }
            } else {
                // 回退到全局配置
                serviceName = currentConfig.service;
                serviceConfig = this.configManager.getServiceConfig(currentConfig);

                // 对于LLM服务，也需要设置识别模式特定的提示词
                const aiLLMServices = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'];
                const isLLMService = aiLLMServices.includes(serviceName) || this.configManager.isCustomLLMProvider(serviceName);
                if (isLLMService) {
                    serviceConfig.prompt = this.getRecognitionModePrompt(currentMode, serviceConfig.prompt);
                }
            }

            // 为所有服务添加识别模式信息
            serviceConfig.mode = currentMode;

            // 验证配置 - 使用实际的服务配置进行验证
            const tempConfig = {
                service: serviceName,
                ...this.config,
                [serviceName]: {
                    ...(this.config[serviceName] || {}),
                    ...serviceConfig
                }
            };

            const validation = this.configManager.validateConfig(tempConfig);
            if (!validation.valid) {
                // 确保隐藏加载状态
                this.uiManager.hideLoading();
                this.uiManager.showError(validation.error || '请先配置OCR服务');

                // 配置无效时不执行识别
                return;
            }

            // 检查是否使用了已删除的模型 gemini-2.5-flash-lite-preview-09-2025
            if (serviceName === 'ocrpro' && serviceConfig.model === 'gemini-2.5-flash-lite-preview-09-2025') {
                // 确保隐藏加载状态
                this.uiManager.hideLoading();

                // 提示用户切换模型
                const errorMsg = '该模型(Gemini 2.5 Flash-Lite Preview 09-2025)已被移除，请切换到其他可用模型\n\n可用模型：\n• Gemini 2.5 Flash-Lite\n• Gemini 2.5 Flash';
                this.uiManager.showError(errorMsg);

                // 如果不在配置页面，延迟跳转到模型服务配置页面
                if (!window.location.hash.includes('#model-service')) {
                    setTimeout(() => {
                        this.uiManager.showModelServiceView();
                    }, 3000);
                }

                return;
            }

            // 在开始识别前，确保服务状态是最新的（静默检查，不显示消息）
            await this.ensureServiceStatusUpdated(serviceName);

            // 在静默模式下不显示加载状态
            if (!this.isSilentMode) {
                this.uiManager.showLoading('正在识别文字...');
            }

            try {
                // 检查是否应该使用流式输出
                const shouldStream = this.shouldUseStreaming(serviceName);
                let result;

                if (shouldStream) {
                    // 使用流式输出
                    if (!this.isSilentMode) {
                        this.uiManager.hideLoading();
                        this.uiManager.showStreamingStatus('正在识别中...');
                        // 准备流式显示
                        this.uiManager.prepareStreamingDisplay(currentMode);
                    }

                    // 创建流式回调函数
                    const onStreamChunk = (chunk, fullText) => {
                        if (!this.isSilentMode) {
                            this.uiManager.updateStreamingResult(chunk, fullText, currentMode);
                        }
                    };

                    result = await this.ocrServices.performOCR(
                        imageBase64,
                        serviceName,
                        serviceConfig,
                        onStreamChunk
                    );
                } else {
                    // 使用传统的非流式输出
                    result = await this.ocrServices.performOCR(
                        imageBase64,
                        serviceName,
                        serviceConfig
                    );
                }

                if (result.success) {
                    // 更新OCR使用统计
                    if (this.uiManager && typeof this.uiManager.incrementUsageStats === 'function') {
                        this.uiManager.incrementUsageStats('ocr');
                    }

                    // OCR成功时，更新对应模型状态为成功
                    this.handleOCRModelSuccess(serviceName, serviceConfig.model);

                    // 保存识别结果到缓存
                    const cacheKey = this.generateCacheKey(imageBase64, currentMode);
                    this.recognitionResultCache.set(cacheKey, {
                        text: result.text,
                        confidence: result.confidence,
                        mode: currentMode,
                        timestamp: Date.now()
                    });
                    console.log(`[缓存] 识别结果已保存到缓存 | 模式: ${currentMode} | 缓存键: ${cacheKey.substring(0, 20)}... | 缓存大小: ${this.recognitionResultCache.size} | 结果长度: ${result.text?.length || 0}字符`);

                    // 在静默模式下直接处理结果
                    if (this.isSilentMode) {
                        await this.handleSilentOCRResult(result.text);
                        return; // 静默模式下直接返回，不执行后续UI操作
                    }

                    // 非静默模式：处理流式输出完成状态
                    if (shouldStream) {
                        this.uiManager.hideStreamingStatus();
                        this.uiManager.enableReRecognizeButton();
                        // 对于流式输出，结果已经在流式回调中显示，这里只需要完成状态处理
                        this.uiManager.completeStreamingResult(result.text, result.confidence, currentMode);
                    } else {
                        // 确保隐藏加载状态
                        this.uiManager.hideLoading();
                        await this.uiManager.showResult(result.text, result.confidence, currentMode);
                    }

                    // OCR成功时，更新模型状态为成功（如果是AI模型）
                    this.handleOCRModelSuccess(serviceName, serviceConfig.model);

                    // 添加到历史记录（检查是否启用历史记录功能）
                    const config = this.config;
                    if (config?.ui?.enableHistory !== false) { // 默认启用历史记录
                        const serviceConfig = this.configManager.getServiceConfig(currentConfig);
                        const modelName = this.getModelDisplayNameForHistory(currentConfig.service, serviceConfig);
                        // 获取识别模式的显示名称
                        const modeNames = {
                            'text': '文字',
                            'table': '表格',
                            'formula': '公式',
                            'markdown': 'MD'
                        };
                        const modeName = modeNames[currentMode] || '文字';

                        this.historyManager.addHistory(
                            imageBase64,
                            result.text,
                            currentConfig.service,
                            modelName,
                            modeName
                        );
                    }

                    // 检查是否需要自动跳转到翻译页面（识别并翻译功能）
                    if (this.shouldAutoTranslateAfterOCR) {
                        this.shouldAutoTranslateAfterOCR = false; // 重置标志
                        // 延迟跳转，确保OCR结果已完全显示
                        setTimeout(() => {
                            // 设置跳转来源标识，表示这是从OCR识别完成后自动跳转到翻译页面
                            window.shouldFillFromOCR = true;
                            // 设置自动翻译标识，表示这是"识别并翻译"功能，应该立即执行翻译
                            window.shouldAutoTranslateFromOCR = true;
                            this.uiManager.showTranslateView();
                        }, 500);
                    }

                    // 检查是否是截图识别并复制模式（仅在非静默模式下执行）
                    if (this.isScreenshotAndCopyMode && !this.isSilentMode) {
                        // 延迟执行复制，确保OCR结果已完全显示
                        setTimeout(() => {
                            this.copyResultWithAutoClose();
                        }, 300);
                    }
                } else {
                    // 识别失败处理
                    if (this.isSilentMode) {
                        // 静默模式：显示系统通知和错误状态指示器
                        this.showSilentNotification(result.error || '识别失败', 'error');
                        this.showStatusIndicator('error');
                        this.resetSilentMode();
                    } else {
                        // 非静默模式：显示UI错误
                        if (shouldStream) {
                            this.uiManager.hideStreamingStatus();
                            this.uiManager.enableReRecognizeButton();
                        } else {
                            this.uiManager.hideLoading();
                        }
                        this.uiManager.showError(result.error || '识别失败');

                        // 重置截图识别并复制模式标志
                        if (this.isScreenshotAndCopyMode) {
                            this.isScreenshotAndCopyMode = false;
                        }
                    }

                    // 识别失败时，检查是否是连接问题，如果是则重新检测服务状态
                    if (this.isConnectionError(result.error)) {
                        this.checkServiceStatus(serviceName, true, true);

                        // 如果是AI模型服务，标记当前模型为失败状态
                        this.handleOCRModelFailure(serviceName, serviceConfig.model, result.error);
                    }
                }

                // 识别完成
            } catch (ocrError) {
                // OCR过程异常处理
                if (this.isSilentMode) {
                    // 静默模式：处理错误并显示系统通知
                    let errorMessage = 'OCR识别失败';
                    if (ocrError.message) {
                        if (ocrError.message.includes('429')) {
                            errorMessage = 'API请求过于频繁，请稍后再试';
                        } else if (ocrError.message.includes('401')) {
                            errorMessage = 'API Key无效或已过期，请检查配置';
                        } else if (ocrError.message.includes('403')) {
                            errorMessage = 'API访问被拒绝，请检查权限设置';
                        } else if (ocrError.message.includes('500')) {
                            errorMessage = '服务器内部错误，请稍后重试';
                        } else {
                            errorMessage = `识别失败: ${ocrError.message}`;
                        }
                    }
                    this.showSilentNotification(errorMessage, 'error');
                    this.showStatusIndicator('error');
                    this.resetSilentMode();
                } else {
                    // 非静默模式：显示UI错误
                    const shouldStream = this.shouldUseStreaming(serviceName);
                    if (shouldStream) {
                        this.uiManager.hideStreamingStatus();
                        this.uiManager.enableReRecognizeButton();
                    } else {
                        this.uiManager.hideLoading();
                    }

                    // 处理特定的错误类型
                    let errorMessage = 'OCR识别失败';
                    if (ocrError.message) {
                        if (ocrError.message.includes('429')) {
                            errorMessage = 'API请求过于频繁，请稍后再试';
                        } else if (ocrError.message.includes('401')) {
                            errorMessage = 'API Key无效或已过期，请检查配置';
                        } else if (ocrError.message.includes('403')) {
                            errorMessage = 'API访问被拒绝，请检查权限设置';
                        } else if (ocrError.message.includes('500')) {
                            errorMessage = '服务器内部错误，请稍后重试';
                        } else {
                            errorMessage = `识别失败: ${ocrError.message}`;
                        }
                    }

                    this.uiManager.showError(errorMessage);

                    // 重置截图识别并复制模式标志
                    if (this.isScreenshotAndCopyMode) {
                        this.isScreenshotAndCopyMode = false;
                    }
                }

                // 检查是否是模型连接错误，如果是则标记模型失败
                if (this.isModelConnectionError(ocrError.message)) {
                    // 确保使用正确的服务配置来获取模型ID
                    this.handleOCRModelFailure(serviceName, serviceConfig.model, ocrError.message);
                }

                // 发生异常时的处理
            }
        } catch (error) {
            // 最外层错误捕获，确保任何情况下都能隐藏加载状态
            console.error('🔴 performOCR最外层错误:', {
                message: error.message,
                stack: error.stack,
                error: error
            });

            if (this.isSilentMode) {
                // 静默模式：显示系统通知和错误状态指示器
                this.showSilentNotification('发生未知错误: ' + error.message, 'error');
                this.showStatusIndicator('error');
                this.resetSilentMode();
            } else {
                // 非静默模式：显示UI错误
                this.uiManager.hideLoading();
                this.uiManager.showError('发生未知错误: ' + error.message);
            }

            // 检查是否是模型连接错误
            if (this.isModelConnectionError(error.message)) {
                // 获取当前配置来确定服务和模型
                const currentService = serviceName || this.config?.service;
                let currentModel = null;

                if (serviceConfig && serviceConfig.model) {
                    currentModel = serviceConfig.model;
                } else {
                    const tempConfig = this.configManager.getServiceConfig(this.config);
                    currentModel = tempConfig?.model;
                }

                if (currentService && currentModel) {
                    this.handleOCRModelFailure(currentService, currentModel, error.message);
                }
            }

            // 发生未知错误时的处理
        }
    }

    // 复制结果（智能复制：优先复制选中文本，无选中时复制完整内容）
    copyResult() {
        // 使用UI管理器的智能复制功能
        const textToCopy = this.uiManager.getSmartCopyText();

        if (textToCopy) {
            window.ocrAPI.copyText(textToCopy);
            // 只在窗口可见时显示复制成功通知
            if (this.uiManager.isWindowVisible()) {
                this.uiManager.showSuccess('已复制到剪贴板');
            }

            // 检查是否启用OCR页面复制后自动关闭插件
            const config = this.config;
            // 优先使用新配置，如果没有则使用旧配置（向后兼容）
            const shouldAutoClose = config?.ui?.autoCloseOCR !== undefined ?
                config.ui.autoCloseOCR === true :
                config?.ui?.autoClose === true;

            if (shouldAutoClose) {
                // 延迟一点时间让用户看到复制成功的提示
                setTimeout(() => {
                    window.ocrAPI?.hideMainWindow?.();
                }, 300);
            }
        } else {
            this.uiManager.showWarning('没有可复制的内容');
        }
    }

    // 生成识别结果缓存键
    generateCacheKey(imageBase64, mode) {
        // 使用简单的哈希函数生成图片的哈希值
        const imageHash = this.simpleHash(imageBase64);
        return `${imageHash}_${mode}`;
    }

    // 简单哈希函数（用于生成图片的唯一标识）
    simpleHash(str) {
        let hash = 0;
        if (str.length === 0) return hash.toString();
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    // 清理识别结果缓存
    clearRecognitionCache() {
        if (this.recognitionResultCache) {
            this.recognitionResultCache.clear();
            console.log('识别结果缓存已清理');
        }
    }

    // 重新识别
    async reRecognize() {
        if (!this.lastImageBase64) {
            // 静默处理，不显示错误信息
            return;
        }

        // 清除当前图片+模式的缓存，确保进行新的识别
        const currentMode = this.currentRecognitionMode || 'text';
        const cacheKey = this.generateCacheKey(this.lastImageBase64, currentMode);
        if (this.recognitionResultCache.has(cacheKey)) {
            this.recognitionResultCache.delete(cacheKey);
            console.log(`[缓存] 手动重新识别 - 已删除缓存 | 模式: ${currentMode} | 缓存键: ${cacheKey.substring(0, 20)}... | 剩余缓存: ${this.recognitionResultCache.size}`);
        } else {
            console.log(`[缓存] 手动重新识别 - 无需删除缓存 | 模式: ${currentMode} | 该模式没有缓存`);
        }

        console.log(`[识别] 开始执行重新识别 | 模式: ${currentMode}`);
        await this.performOCR(this.lastImageBase64);
    }

    // 检查是否应该触发自动重新识别（仅在切换识别模式时生效）
    shouldAutoReRecognize() {
        const uiConfig = this.config?.ui || {};
        const enableAutoReOcr = uiConfig.autoReOcrOnModeChange !== false; // 默认为true
        return this.lastImageBase64 && enableAutoReOcr;
    }

    // 判断是否应该使用流式输出
    shouldUseStreaming(serviceName) {
        // 检查全局流式输出配置
        const config = this.config || this.configManager.getConfig();
        if (config?.ui?.enableStreaming === false) {
            return false;
        }

        // 所有AI模型服务都支持流式输出（包括uTools AI和OCR Pro）
        const aiServices = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'];
        return aiServices.includes(serviceName);
    }

    // 触发自动重新识别（如果满足条件）
    async triggerAutoReRecognize() {
        if (!this.shouldAutoReRecognize()) {
            return;
        }

        // 检查缓存中是否已有当前模式的识别结果
        const currentMode = this.currentRecognitionMode || 'text';
        const cacheKey = this.generateCacheKey(this.lastImageBase64, currentMode);
        const cachedResult = this.recognitionResultCache.get(cacheKey);

        if (cachedResult) {
            // 使用缓存的识别结果（静默显示，不显示任何提示）
            console.log(`[缓存] 使用缓存的识别结果 | 模式: ${currentMode} | 缓存时间: ${new Date(cachedResult.timestamp).toLocaleTimeString()} | 结果长度: ${cachedResult.text?.length || 0}字符`);

            // 静默显示缓存的结果，不显示成功提示
            this.uiManager.hideLoading();
            await this.uiManager.showResult(cachedResult.text, cachedResult.confidence, currentMode, {
                showSuccessNotification: false
            });
        } else {
            // 缓存中没有结果，执行重新识别
            console.log(`[缓存] 缓存中没有 ${currentMode} 模式的结果，执行新的识别 | 缓存大小: ${this.recognitionResultCache.size}`);
            await this.reRecognize();
        }
    }

    // 切换识别模式菜单
    toggleRecognitionModeMenu() {
        const menu = document.getElementById('recognition-mode-menu');
        const btn = document.getElementById('recognition-mode-btn');

        if (menu && btn) {
            const isVisible = menu.classList.contains('show');
            if (isVisible) {
                this.hideRecognitionModeMenu();
            } else {
                this.showRecognitionModeMenu();
            }
        }
    }

    // 显示识别模式菜单
    showRecognitionModeMenu() {
        const menu = document.getElementById('recognition-mode-menu');
        const btn = document.getElementById('recognition-mode-btn');

        if (menu && btn) {
            menu.classList.add('show');
            // 为菜单显示状态使用不同的类名，避免与选中状态的active类冲突
            btn.classList.add('menu-open');
        }
    }

    // 隐藏识别模式菜单
    hideRecognitionModeMenu() {
        const menu = document.getElementById('recognition-mode-menu');
        const btn = document.getElementById('recognition-mode-btn');

        if (menu && btn) {
            menu.classList.remove('show');
            // 移除菜单显示状态的类，但保留选中状态的active类
            btn.classList.remove('menu-open');
        }
    }

    // 选择识别模式
    selectRecognitionMode(mode) {
        const modeNames = {
            'text': '文字识别',
            'table': '表格识别',
            'formula': '公式识别',
            'markdown': 'MD识别'
        };

        const modeName = modeNames[mode] || '文字';

        // 更新按钮显示（文字标签已移除，只更新图标和tooltip）
        // const modeText = document.querySelector('#recognition-mode-btn .mode-text');
        // if (modeText) {
        //     modeText.textContent = modeName;
        // }

        // 更新主按钮图标
        const modeIcon = document.querySelector('#mode-icon');
        if (modeIcon) {
            modeIcon.innerHTML = this.getModeIconSVG(mode);
        }

        // 更新按钮的tooltip和选中状态
        const modeBtn = document.querySelector('#recognition-mode-btn');
        if (modeBtn) {
            modeBtn.title = `选择识别模式 - 当前: ${modeName}`;
            // 添加active类来显示蓝色图标
            modeBtn.classList.add('active');
        }

        // 更新菜单中的选中状态
        const options = document.querySelectorAll('.mode-option');
        options.forEach(option => {
            option.classList.remove('active');
            if (option.getAttribute('data-mode') === mode) {
                option.classList.add('active');
            }
        });

        // 隐藏菜单
        this.hideRecognitionModeMenu();

        // 保存当前选择的模式
        this.currentRecognitionMode = mode;



        // 立即切换布局显示模式
        this.switchLayoutMode(mode);

        // 更新主界面模型按钮显示 - 确保使用新模式的配置
        this.updateMainInterfaceModelFromConfig();

        // 触发自动重新识别（如果满足条件）
        this.triggerAutoReRecognize();
    }

    // 切换布局显示模式
    switchLayoutMode(mode) {
        if (mode === 'text') {
            // 文字模式：显示单栏布局
            this.uiManager.showSingleColumnLayout();
        } else {
            // 公式、表格、Markdown模式：显示双栏布局（空白状态）
            this.uiManager.showDualColumnLayout(mode, true);
        }
    }

    // 绑定识别模式模型选择事件
    bindRecognitionModeModelEvents() {
        const modes = ['text', 'table', 'formula', 'markdown'];

        modes.forEach(mode => {
            const modelBtn = document.getElementById(`${mode}-model-btn`);
            if (modelBtn) {
                modelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // 检查是否有可用模型
                    const availableServices = this.getAvailableServicesForMainInterface();
                    if (!availableServices || availableServices.length === 0) {
                        // 没有可用模型，直接跳转到模型服务页面
                        this.uiManager.showModelServicePage();
                        return;
                    }

                    // 有可用模型，显示模型选择菜单
                    this.toggleRecognitionModeModelMenu(mode);
                });
            }
        });
    }

    // 绑定地域选择事件
    bindRegionSelectEvents() {
        // 腾讯云地域选择
        const tencentRegionBtn = document.getElementById('tencent-translate-region');
        const tencentRegionMenu = document.getElementById('tencent-translate-region-menu');

        if (tencentRegionBtn && tencentRegionMenu) {
            tencentRegionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleRegionMenu('tencent-translate-region');
            });

            // 地域选项点击事件
            tencentRegionMenu.addEventListener('click', (e) => {
                const option = e.target.closest('.region-option');
                if (option) {
                    this.selectRegionOption('tencent-translate-region', option);
                }
            });
        }

        // 阿里云地域选择
        const aliyunRegionBtn = document.getElementById('aliyun-translate-region');
        const aliyunRegionMenu = document.getElementById('aliyun-translate-region-menu');

        if (aliyunRegionBtn && aliyunRegionMenu) {
            aliyunRegionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleRegionMenu('aliyun-translate-region');
            });

            // 地域选项点击事件
            aliyunRegionMenu.addEventListener('click', (e) => {
                const option = e.target.closest('.region-option');
                if (option) {
                    this.selectRegionOption('aliyun-translate-region', option);
                }
            });
        }



        // 点击其他地方关闭地域菜单
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.region-select-container')) {
                this.hideAllRegionMenus();
            }
        });
    }

    // 切换地域菜单显示状态
    toggleRegionMenu(regionId) {
        const menu = document.getElementById(`${regionId}-menu`);
        const button = document.getElementById(regionId);

        if (!menu || !button) return;

        // 检查当前菜单是否已显示
        const isCurrentlyVisible = menu.classList.contains('show');

        // 先关闭所有地域菜单
        this.hideAllRegionMenus();

        // 如果当前菜单之前没有显示，则显示它
        if (!isCurrentlyVisible) {
            menu.classList.add('show');
            button.classList.add('active');
        }
        // 如果当前菜单之前已显示，则保持关闭状态（已被hideAllRegionMenus关闭）
    }

    // 选择地域选项
    selectRegionOption(regionId, option) {
        const button = document.getElementById(regionId);
        const menu = document.getElementById(`${regionId}-menu`);
        const regionText = button.querySelector('.region-text');

        if (!button || !menu || !regionText || !option) return;

        const value = option.getAttribute('data-value');
        const text = option.textContent;

        // 更新按钮显示文本
        regionText.textContent = text;

        // 更新选中状态
        menu.querySelectorAll('.region-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        option.classList.add('selected');

        // 隐藏菜单
        menu.classList.remove('show');
        button.classList.remove('active');

        // 触发配置保存
        this.handleRegionChange(regionId, value);
    }

    // 隐藏所有地域菜单
    hideAllRegionMenus() {
        const regionMenus = document.querySelectorAll('.region-select-menu');
        const regionButtons = document.querySelectorAll('.region-select-btn');

        regionMenus.forEach(menu => {
            menu.classList.remove('show');
        });

        regionButtons.forEach(button => {
            button.classList.remove('active');
        });
    }

    // 处理地域变化
    handleRegionChange(regionId, value) {
        // 根据regionId确定是哪个服务的地域配置
        if (regionId === 'tencent-translate-region') {
            // 更新腾讯云翻译地域配置
            const config = { ...this.config };
            if (!config.tencent) config.tencent = {};
            config.tencent.translateRegion = value;

            const result = this.configManager.saveConfig(config);
            if (result.success) {
                this.config = result.config;

            }
        } else if (regionId === 'aliyun-translate-region') {
            // 更新阿里云翻译地域配置
            const config = { ...this.config };
            if (!config.aliyun) config.aliyun = {};
            config.aliyun.translateRegion = value;

            const result = this.configManager.saveConfig(config);
            if (result.success) {
                this.config = result.config;

            }
        }
    }

    // 切换识别模式模型选择菜单
    toggleRecognitionModeModelMenu(mode) {
        const menu = document.getElementById(`${mode}-model-menu`);
        const button = document.getElementById(`${mode}-model-btn`);
        if (!menu) return;

        // 检查当前菜单是否已显示（修复：检查所有可能的隐藏状态）
        const isCurrentlyVisible = menu.style.display === 'block' &&
            menu.style.visibility !== 'hidden' &&
            menu.style.opacity !== '0';

        // 先关闭其他所有菜单
        this.hideAllRecognitionModeModelMenus();

        // 如果当前菜单之前没有显示，则显示它
        if (!isCurrentlyVisible) {
            menu.style.display = 'block';
            menu.style.visibility = 'visible';
            menu.style.opacity = '1';
            if (button) button.classList.add('active');
        }
        // 如果当前菜单之前已显示，则保持关闭状态（已被hideAllRecognitionModeModelMenus关闭）
    }

    // 隐藏所有识别模式模型选择菜单
    hideAllRecognitionModeModelMenus() {
        const modes = ['text', 'table', 'formula', 'markdown'];
        modes.forEach(mode => {
            const menu = document.getElementById(`${mode}-model-menu`);
            const button = document.getElementById(`${mode}-model-btn`);
            if (menu) {
                menu.style.display = 'none';
            }
            if (button) {
                button.classList.remove('active');
            }
        });
    }



    // 初始化识别模式
    initRecognitionMode() {
        // 设置默认识别模式
        this.currentRecognitionMode = 'text';

        // 初始化四个模式按钮的选中状态和滑块位置
        const modeButtons = document.querySelectorAll('.mode-btn');
        const modeSlider = document.querySelector('.mode-slider');
        const modeOrder = ['text', 'table', 'formula', 'markdown'];
        const activeIndex = modeOrder.indexOf(this.currentRecognitionMode);

        modeButtons.forEach(button => {
            button.classList.remove('active');
            if (button.getAttribute('data-mode') === this.currentRecognitionMode) {
                button.classList.add('active');
            }
        });

        // 初始化滑块位置和大小
        if (modeSlider && activeIndex !== -1) {
            this.updateModeSlider();
        }

        // 初始化布局显示模式
        this.switchLayoutMode(this.currentRecognitionMode);

        // 初始化主界面模型按钮显示
        this.updateMainInterfaceModelFromConfig();
    }

    // 设置识别模式
    setRecognitionMode(mode) {
        if (!['text', 'table', 'formula', 'markdown'].includes(mode)) {
            console.warn('不支持的识别模式:', mode);
            return;
        }

        this.currentRecognitionMode = mode;

        // 更新导航栏按钮显示图标（文字标签已移除，只更新图标）
        // const modeNames = {
        //     'text': '文字识别',
        //     'table': '表格识别',
        //     'formula': '公式识别',
        //     'markdown': 'MD识别'
        // };

        // const modeName = modeNames[mode] || '文字';
        // const modeText = document.querySelector('#recognition-mode-btn .mode-text');
        // if (modeText) {
        //     modeText.textContent = modeName;
        // }

        // 更新主按钮图标
        const modeIcon = document.querySelector('#mode-icon');
        if (modeIcon) {
            modeIcon.innerHTML = this.getModeIconSVG(mode);
        }

        // 更新按钮的tooltip和选中状态，因为移除了文字标签
        const modeBtn = document.querySelector('#recognition-mode-btn');
        if (modeBtn) {
            const modeNames = {
                'text': '文字识别',
                'table': '表格识别',
                'formula': '公式识别',
                'markdown': 'MD识别'
            };
            const modeName = modeNames[mode] || '文字识别';
            modeBtn.title = `选择识别模式 - 当前: ${modeName}`;
            // 添加active类来显示蓝色图标
            modeBtn.classList.add('active');
        }

        // 更新浮动切换按钮的选中状态
        const modeButtons = document.querySelectorAll('.mode-btn');
        modeButtons.forEach(button => {
            button.classList.remove('active');
            if (button.getAttribute('data-mode') === mode) {
                button.classList.add('active');
            }
        });

        // 更新菜单中的选中状态
        const options = document.querySelectorAll('.mode-option');
        options.forEach(option => {
            option.classList.remove('active');
            if (option.getAttribute('data-mode') === mode) {
                option.classList.add('active');
            }
        });

        // 更新滑块位置
        this.updateModeSlider();

        // 更新主界面模型按钮显示
        this.updateMainInterfaceModelFromConfig();

        // 切换布局显示模式
        this.switchLayoutMode(mode);

        // 使用统一的同步逻辑 - 根据当前模式的配置更新主界面显示
        this.syncMainPageModelWithConfig(mode);
    }

    // 从配置更新主界面模型按钮显示 - 集成统一状态管理
    updateMainInterfaceModelFromConfig() {
        const currentMode = this.currentRecognitionMode || 'text';

        try {
            const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);


            if (modeConfig && modeConfig.service) {
                // 使用识别模式的配置更新主界面显示
                // 更新全局服务配置以保持一致性
                this.config.service = modeConfig.service;

                // 更新UI显示
                this.uiManager.updateCurrentService(modeConfig.service, modeConfig.model);
                this.updateMainPageStatus();



            } else {
                // 如果没有识别模式配置，检查是否有可用模型可以自动配置
                const availableServices = this.getAvailableServicesForMainInterface();

                if (availableServices && availableServices.length > 0) {
                    // 有可用模型，自动配置第一个
                    const firstAvailable = availableServices[0];


                    // 设置识别模式配置
                    const result = this.configManager.setRecognitionModeConfig(currentMode, firstAvailable.value, firstAvailable.model);
                    if (result.success) {
                        this.config = result.config;
                        this.config.service = firstAvailable.value;
                        this.saveConfigSimple();

                        // 更新UI显示
                        this.uiManager.updateCurrentService(firstAvailable.value, firstAvailable.model);
                        this.updateMainPageStatus();
                    }
                } else {
                    // 没有可用模型，显示未配置状态

                    this.uiManager.updateCurrentService(null, null);
                    this.updateMainPageStatus();
                }
            }
        } catch (error) {
            console.error('更新主界面模型配置失败:', error);
            // 回退到基本显示
            const fallbackService = this.config.service;
            if (fallbackService) {
                this.uiManager.updateCurrentService(fallbackService, fallbackService);
            } else {
                this.uiManager.updateCurrentService(null, null);
            }
            this.updateMainPageStatus();
        }
    }

    // 更新主界面模型按钮
    updateMainInterfaceModel(service, model) {
        // 更新配置
        this.config.service = service;
        if (model && ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'].includes(service)) {
            if (!this.config[service]) {
                this.config[service] = {};
            }
            this.config[service].model = model;
        }

        // 更新UI显示
        this.uiManager.updateCurrentService(service, model);

        // 保存配置
        this.saveConfigSimple();
    }

    // 获取识别模式特定的提示词
    getRecognitionModePrompt(mode, defaultPrompt) {
        // 使用配置管理器获取识别模式的提示词
        const prompt = this.configManager.getRecognitionModePrompt(mode);
        return prompt || defaultPrompt;
    }

    // 检查是否有payload数据
    // 检查是否应该显示主窗口
    shouldShowMainWindow() {
        const currentFeature = window.ocrAPI?.getCurrentFeature();

        // 静默模式功能始终不显示窗口，即使是快捷键触发
        if (currentFeature === 'ocr-screenshot-copy') {
            return false;
        }

        // 如果是通过全局快捷键触发，需要特殊处理
        if (this.currentTriggerSource === 'hotkey') {
            // 对于全局快捷键触发的mainHide功能，仍然需要显示窗口
            // 因为用户通过快捷键主动调用，期望看到界面反馈
            return true;
        }

        // 其他情况按原逻辑处理
        return !this.isMainHideFeature();
    }

    // 判断是否为mainHide功能
    isMainHideFeature() {
        const feature = window.ocrAPI?.getCurrentFeature();
        return [
            'ocr-screenshot',
            'ocr-screenshot-copy',
            'ocr-table',
            'ocr-formula',
            'ocr-markdown',
            'ocr-and-translate',
            'image-translate-screenshot'
        ].includes(feature);
    }

    checkForPayload() {
        const feature = this.getCurrentFeature();
        const screenshotFeatures = ['ocr-screenshot', 'ocr-table', 'ocr-formula', 'ocr-markdown'];

        if (feature === 'ocr-clipboard') {
            this.handleImageInput();
        } else if (screenshotFeatures.includes(feature)) {
            const modeMap = {
                'ocr-screenshot': 'text',
                'ocr-table': 'table',
                'ocr-formula': 'formula',
                'ocr-markdown': 'markdown'
            };
            this.setRecognitionMode(modeMap[feature]);
            this.handleScreenshotCommand(null);
        } else {
            const payloadData = window.ocrAPI?.getPayload();
            if (payloadData) {
                this.handleImageInput(payloadData);
            } else {
                this.uiManager.showMainView();
            }
        }
    }

    // 处理插件进入事件
    handlePluginEnter(code, payload, from, option) {
        // 保存触发来源信息
        this.currentTriggerSource = from;

        // 应用自定义窗口高度设置（每次进入插件时都应用）
        this.applyCustomWindowHeight();

        // 根据功能代码执行相应操作
        if (code === 'ocr-main') {
            // OCR Pro主界面，只显示主界面不执行其他操作
            this.uiManager.showMainView();
        } else if (code === 'ocr-config') {
            this.uiManager.showConfigView();
        } else if (code === 'ocr-clipboard') {
            // 剪切板图片识别
            this.handleImageInput();
        } else if (code === 'ocr-clipboard-direct') {
            // 直接读取剪切板图片进行OCR识别
            this.handleClipboardDirectOCR();
        } else if (code === 'ocr-screenshot') {
            // 截图文字识别指令 - 切换到文字识别模式并立即启动截图
            this.setRecognitionMode('text');
            // 采用一致的截图逻辑：截图前不显示窗口，截图完成后再显示
            this.takeScreenshot();
        } else if (code === 'ocr-screenshot-copy') {
            // 截图识别并复制指令 - 静默模式
            this.handleScreenshotAndCopy();
        } else if (code === 'ocr-files') {
            // 图片文件识别
            // 检查payload是否是文件数组格式
            if (Array.isArray(payload) && payload.length > 0) {
                // 处理单个图片文件
                this.uiManager.showMainView();
                this.handleImageInput(payload);
            } else if (payload && payload.type === 'files' && Array.isArray(payload.data) && payload.data.length > 0) {
                // 处理标准格式的files payload
                this.uiManager.showMainView();
                this.handleImageInput(payload);
            } else {
                this.uiManager.showMainView();
                this.uiManager.showError('请选择图片文件进行识别');
            }
        } else if (code === 'ocr-table') {
            // 表格识别指令 - 切换到表格识别模式并立即启动截图
            this.setRecognitionMode('table');
            // 采用一致的截图逻辑：截图前不显示窗口，截图完成后再显示
            this.takeScreenshot();
        } else if (code === 'ocr-formula') {
            // 公式识别指令 - 切换到公式识别模式并立即启动截图
            this.setRecognitionMode('formula');
            // 采用一致的截图逻辑：截图前不显示窗口，截图完成后再显示
            this.takeScreenshot();
        } else if (code === 'ocr-markdown') {
            // Markdown识别指令 - 切换到Markdown识别模式并立即启动截图
            this.setRecognitionMode('markdown');
            // 采用一致的截图逻辑：截图前不显示窗口，截图完成后再显示
            this.takeScreenshot();
        } else if (code === 'translate') {
            // 翻译功能指令
            this.handleTranslateFeature();
        } else if (code === 'ocr-and-translate') {
            // 识别并翻译功能指令
            this.handleOCRAndTranslateFeature();
        } else if (code === 'history') {
            // 历史记录功能指令
            this.handleHistoryFeature();
        } else if (code === 'text-translate') {
            // 文本翻译匹配指令
            this.handleTextTranslateFeature();
        } else if (code === 'image-translate-screenshot') {
            // 图片翻译截图指令
            this.handleImageTranslateScreenshotFeature();
        } else if (code === 'image-translate-files') {
            // 图片文件翻译指令
            this.handleImageTranslateFilesFeature(payload);
        } else if (code === 'image-translate-clipboard') {
            // 剪切板图片翻译指令
            this.handleImageTranslateClipboardFeature();
        } else if (code === 'image-ocr-and-translate') {
            // 图片识别并翻译指令
            this.handleImageOCRAndTranslateFeature();
        } else if (code === 'clipboard-ocr-and-translate') {
            // 剪切板图片识别并翻译指令
            this.handleClipboardOCRAndTranslateFeature();
        } else if (code === 'clipboard-text-translate') {
            // 剪切板文本翻译指令
            this.handleClipboardTextTranslateFeature();
        } else if (code === 'mini-translate') {
            // 小窗翻译指令
            this.handleMiniTranslateFeature();
        } else if (code === 'translate-clipboard') {
            // 翻译复制的文本指令
            this.handleClipboardTextTranslateFeature();
        } else if (code === 'translate-clipboard-mini') {
            // 翻译复制的文本-小窗指令
            this.handleClipboardTextTranslateMiniFeature();
        } else if (code === 'text-translate-mini') {
            // 文本翻译-小窗指令（选中文本后打开小窗翻译）
            this.handleTextTranslateMiniFeature();
        } else if (code === 'ocr-handwriting') {
            // 手写公式识别指令
            this.handleHandwritingFeature();
        }
    }

    /**
     * 处理截图识别并复制功能 - 静默模式
     * 该功能在后台静默处理，不显示插件窗口，仅通过系统通知反馈结果
     */
    async handleScreenshotAndCopy() {
        try {
            // 新的OCR会话开始

            // 设置识别模式为文字识别
            this.setRecognitionMode('text');

            // 设置静默模式标志
            this.isSilentMode = true;
            this.isScreenshotAndCopyMode = true;

            // 检查是否应该显示主窗口（mainHide配置为false时才显示）
            if (this.shouldShowMainWindow()) {
                this.uiManager.showMainView();
                requestAnimationFrame(() => {
                    this.takeScreenshot();
                });
            } else {
                // mainHide为true时，直接截图不显示窗口
                this.takeScreenshot();
            }
        } catch (error) {
            console.error('启动截图识别并复制功能失败:', error);
            this.showSilentNotification('截图识别启动失败', 'error');
            this.showStatusIndicator('error');
            this.resetSilentMode();
        }
    }

    // 截图识别并复制模式的复制结果（会触发自动关闭）
    copyResultWithAutoClose() {
        // 使用UI管理器的智能复制功能
        const textToCopy = this.uiManager.getSmartCopyText();

        if (textToCopy) {
            window.ocrAPI.copyText(textToCopy);
            // 只在窗口可见时显示复制成功通知
            if (this.uiManager.isWindowVisible()) {
                this.uiManager.showSuccess('已复制到剪贴板');
            }

            // 检查是否启用OCR页面复制后自动关闭插件
            const config = this.config;
            // 优先使用新配置，如果没有则使用旧配置（向后兼容）
            const shouldAutoClose = config?.ui?.autoCloseOCR !== undefined ?
                config.ui.autoCloseOCR === true :
                config?.ui?.autoClose === true;

            if (shouldAutoClose) {
                // 延迟一点时间让用户看到复制成功的提示
                setTimeout(() => {
                    window.ocrAPI?.hideMainWindow?.();
                }, 300);
            }
        } else {
            this.uiManager.showWarning('没有可复制的内容');
        }

        // 重置标志
        this.isScreenshotAndCopyMode = false;
    }

    // 加载配置到UI
    loadConfigUI() {
        // 获取当前配置的服务，不设置默认值
        const currentService = this.config.service;

        const serviceSelect = document.getElementById('ocr-service');
        if (serviceSelect && currentService) {
            serviceSelect.value = currentService;
        }

        // 只有在有配置的服务时才切换配置区域
        if (currentService) {
            this.uiManager.switchConfigSection(currentService);
        }

        // 移除启动时自动初始化模型列表，改为按需加载

        // 百度配置
        this.setElementValue('baidu-api-key', this.config.baidu?.apiKey);
        this.setElementValue('baidu-secret-key', this.config.baidu?.secretKey);

        // 百度翻译配置
        this.setElementValue('baidu-translate-api-key', this.config.baidu?.translateApiKey);
        this.setElementValue('baidu-translate-secret-key', this.config.baidu?.translateSecretKey);

        // 腾讯云配置
        this.setElementValue('tencent-secret-id', this.config.tencent?.secretId);
        this.setElementValue('tencent-secret-key', this.config.tencent?.secretKey);

        // 阿里云配置
        this.setElementValue('aliyun-access-key', this.config.aliyun?.accessKey);
        this.setElementValue('aliyun-access-secret', this.config.aliyun?.accessSecret);

        // 火山引擎配置
        this.setElementValue('volcano-access-key', this.config.volcano?.accessKey);
        this.setElementValue('volcano-secret-key', this.config.volcano?.secretKey);

        // DeepLX配置
        this.setElementValue('deeplx-api-url', this.config.deeplx?.apiUrl);
        this.setElementValue('deeplx-access-token', this.config.deeplx?.accessToken);

        // 有道翻译配置
        this.setElementValue('youdao-app-key', this.config.youdao?.appKey);
        this.setElementValue('youdao-app-secret', this.config.youdao?.appSecret);
        this.setElementValue('youdao-vocab-id', this.config.youdao?.vocabId);

        // 百度翻译开放平台配置
        this.setElementValue('baiduFanyi-app-id', this.config.baiduFanyi?.appId);
        this.setElementValue('baiduFanyi-secret-key', this.config.baiduFanyi?.secretKey);

        // AI平台配置
        this.loadAIPlatformConfigs();

        // 移除自动初始化，改为按需加载模型列表
    }

    // 保存配置
    saveConfig() {
        const serviceSelect = document.getElementById('ocr-service');
        if (!serviceSelect) {
            this.uiManager.showError('配置界面未正确加载');
            return;
        }

        // 获取AI平台配置
        let aiPlatformConfigs;
        try {
            aiPlatformConfigs = this.getAllAIPlatformConfigs();
        } catch (error) {
            this.uiManager.showError('获取AI平台配置失败: ' + error.message);
            return;
        }




        const newConfig = {
            // 保留现有的所有配置
            ...this.config,
            // 更新模型服务相关配置
            service: serviceSelect.value,
            baidu: {
                // 保留现有配置并合并新值
                ...this.config.baidu,
                apiKey: this.getElementValue('baidu-api-key'),
                secretKey: this.getElementValue('baidu-secret-key'),
                // 百度翻译配置
                translateApiKey: this.getElementValue('baidu-translate-api-key'),
                translateSecretKey: this.getElementValue('baidu-translate-secret-key')
            },
            tencent: {
                secretId: this.getElementValue('tencent-secret-id'),
                secretKey: this.getElementValue('tencent-secret-key')
            },
            aliyun: {
                accessKey: this.getElementValue('aliyun-access-key'),
                accessSecret: this.getElementValue('aliyun-access-secret')
            },
            volcano: {
                accessKey: this.getElementValue('volcano-access-key'),
                secretKey: this.getElementValue('volcano-secret-key')
            },
            // AI平台配置
            ...aiPlatformConfigs
        };

        let result;
        try {
            result = this.configManager.saveConfig(newConfig);
        } catch (error) {
            this.uiManager.showError('配置保存异常: ' + error.message);
            return;
        }

        if (result.success) {
            // 在更新配置之前，检测哪些服务的配置发生了变化
            const changedServices = this.detectChangedServices(this.config, newConfig);

            this.config = result.config;
            // 只在窗口可见时显示配置保存成功通知
            if (this.uiManager.isWindowVisible()) {
                this.uiManager.showSuccess('配置保存成功');
            }

            // 不需要临时更改保存按钮样式，只保留星号提示逻辑

            // 清除配置修改标记
            this.clearConfigModified();

            // 重置所有密码输入框为隐藏状态
            this.uiManager.resetAllPasswordFields();

            // 智能清除缓存：只清除配置发生变化的服务的缓存
            if (changedServices.length > 0) {
                changedServices.forEach(serviceName => {
                    this.clearServiceStatusCache(serviceName);

                    if (serviceName === 'bytedance') {
                        const accessKey = this.getElementValue('bytedance-access-key');
                        const secretKey = this.getElementValue('bytedance-secret-key');
                        const apiKey = this.getElementValue('bytedance-api-key');
                        this.modelManager.clearByteDanceModelsCache(accessKey, secretKey, apiKey);
                    }
                });
            }

            // 更新UI状态显示，强制重新检测
            this.updateUIStatus(true, true);

            // 更新所有服务的状态指示器
            this.updateAllServiceIndicators();

            // 确保主界面状态也得到更新（如果当前在配置页面）
            if (this.uiManager.currentView === 'config') {
                // 立即更新主界面的服务显示
                const currentService = this.config.service;
                if (currentService) {
                    this.uiManager.updateCurrentService(currentService, currentService);
                }
            }
        } else {
            this.uiManager.showError('配置保存失败: ' + result.error);
        }
    }

    // 测试配置
    async testConfig() {
        try {
            // 获取当前界面上的配置，而不是已保存的配置
            const currentConfig = this.getCurrentConfig();

            const validation = this.configManager.validateConfig(currentConfig);
            if (!validation.valid) {
                this.uiManager.showError(validation.error || '请先完善配置信息');
                return;
            }

            this.uiManager.showInfo('正在测试连接...');

            // 使用统一的连接测试方法
            const result = await this.testServiceConnection(currentConfig.service, currentConfig);
            if (result.success) {
                this.uiManager.showSuccess('连接测试成功！');
            } else {
                this.uiManager.showError('连接测试失败: ' + (result.error || '未知错误'));
            }
        } catch (error) {
            console.error('测试配置失败:', error);
            this.uiManager.showError('测试失败: ' + error.message);
        }
    }

    // 获取当前界面上的配置
    getCurrentConfig() {
        const serviceSelect = document.getElementById('ocr-service');
        if (!serviceSelect) {
            return this.config; // 如果界面未加载，返回当前配置
        }

        return {
            service: serviceSelect.value,
            baidu: {
                // 保留现有配置并合并新值
                ...this.config.baidu,
                apiKey: this.getElementValue('baidu-api-key'),
                secretKey: this.getElementValue('baidu-secret-key'),
                // 百度翻译配置
                translateAppId: this.getElementValue('baidu-translate-app-id'),
                translateApiKey: this.getElementValue('baidu-translate-api-key'),
                translateSecretKey: this.getElementValue('baidu-translate-secret-key')
            },
            tencent: {
                secretId: this.getElementValue('tencent-secret-id'),
                secretKey: this.getElementValue('tencent-secret-key')
            },
            aliyun: {
                accessKey: this.getElementValue('aliyun-access-key'),
                accessSecret: this.getElementValue('aliyun-access-secret')
            },
            // AI平台配置
            ...this.getAllAIPlatformConfigs()
        };
    }

    // 处理平台切换（仅在配置界面LLM平台下拉框切换时调用）
    async handlePlatformChange(platform) {
        const modelSelect = this.getModelSelect();
        const modelInfo = this.getElement('model-info');
        const apiKeyInput = document.getElementById('llm-api-key');
        const apiKeyGroup = apiKeyInput.closest('.form-group');
        const baseUrlGroup = document.getElementById('llm-base-url').closest('.form-group');

        // 保存当前平台的配置到内存（不保存到数据库）
        this.savePlatformConfig();

        // 更新内存中的平台选择（不保存到数据库）
        this.config.llm = this.config.llm || {};
        this.config.llm.platform = platform;

        // 根据平台显示/隐藏相关字段
        if (platform === 'utools') {
            // uTools平台不需要API Key和Base URL
            apiKeyGroup.style.display = 'none';
            baseUrlGroup.style.display = 'none';
        } else {
            // 其他平台需要API Key
            apiKeyGroup.style.display = 'block';
            baseUrlGroup.style.display = 'block';
        }

        // 清空当前选项并显示空白状态
        modelSelect.innerHTML = '<option value="">请选择模型</option>';
        modelInfo.style.display = 'none';

        // 加载新平台的配置
        this.loadPlatformConfig(platform);

        try {
            const apiKey = apiKeyInput.value;
            const baseUrl = document.getElementById('llm-base-url').value;

            // 获取当前平台的保存配置
            const platformConfig = this.config.llm?.platforms?.[platform];
            const savedModel = platformConfig?.model;

            if (platform === 'utools') {
                // uTools平台特殊处理
                if (typeof utools !== 'undefined' && utools.allAiModels) {
                    // 显示加载状态
                    modelSelect.innerHTML = '<option value="">加载中...</option>';

                    try {
                        // 使用ModelManager获取uTools模型列表
                        const models = await this.modelManager.fetchUtoolsModels();
                        if (models && models.length > 0) {
                            this.populateModelSelect(models, false);

                            // 如果有保存的模型，尝试恢复选择
                            if (savedModel) {
                                const options = Array.from(modelSelect.options);
                                const modelExists = options.some(option => option.value === savedModel);
                                if (modelExists) {
                                    modelSelect.value = savedModel;
                                    this.handleModelChange(savedModel);
                                }
                            }
                        } else {
                            modelSelect.innerHTML = '<option value="">暂无可用的uTools AI模型</option>';
                        }
                    } catch (utoolsError) {
                        console.error('加载uTools模型失败:', utoolsError);
                        this.handleModelSelectError(modelSelect);
                    }
                } else {
                    modelSelect.innerHTML = '<option value="">uTools环境不可用，请在uTools中运行</option>';
                }
            } else if (apiKey) {
                // 其他平台且有API Key时
                // 显示加载状态
                modelSelect.innerHTML = '<option value="">加载中...</option>';

                // 尝试获取模型列表
                const models = await this.modelManager.getModels(platform, apiKey, baseUrl);
                this.populateModelSelect(models, false); // 不自动选择第一个

                // 如果有保存的模型，尝试恢复选择
                if (savedModel) {
                    const options = Array.from(modelSelect.options);
                    const modelExists = options.some(option => option.value === savedModel);
                    if (modelExists) {
                        modelSelect.value = savedModel;
                        this.handleModelChange(savedModel);
                    }
                }
            } else {
                // 没有API Key时，显示默认模型列表但不自动选择
                const platformInfo = this.modelManager.getPlatformInfo(platform);
                if (platformInfo) {
                    const defaultModels = platformInfo.defaultModels.map(model => ({
                        id: model,
                        name: model,
                        description: this.modelManager.getModelDescription(model),
                        isDefault: true
                    }));
                    this.populateModelSelect(defaultModels, false); // 不自动选择第一个

                    // 如果有保存的模型，尝试恢复选择
                    if (savedModel) {
                        const options = Array.from(modelSelect.options);
                        const modelExists = options.some(option => option.value === savedModel);
                        if (modelExists) {
                            modelSelect.value = savedModel;
                            this.handleModelChange(savedModel);
                        }
                    }
                }
            }
        } catch (error) {
            this.handleModelSelectError(modelSelect);
        }
    }

    // 填充模型选择下拉框
    populateModelSelect(models, autoSelectFirst = true) {
        const modelSelect = this.getModelSelect();
        modelSelect.innerHTML = '';

        // 添加空白选项
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '请选择模型';
        modelSelect.appendChild(emptyOption);

        if (models.length === 0) {
            emptyOption.textContent = '暂无可用模型';
            return;
        }

        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;

            // 使用模型的友好名称（如果有的话）
            const displayName = model.name || model.id;

            option.textContent = `${displayName}${model.isDefault ? ' (默认)' : ''}`;
            option.title = model.description || '';
            modelSelect.appendChild(option);
        });

        // 只有在明确要求时才自动选择第一个模型
        if (autoSelectFirst && models.length > 0) {
            modelSelect.value = models[0].id;
            this.handleModelChange(models[0].id);
        }
    }

    // 刷新模型列表
    async refreshModelList() {
        const platform = this.getElement('llm-platform').value;
        const modelSelect = this.getModelSelect();

        // 保存当前选择的模型
        const currentSelectedModel = modelSelect.value;

        // uTools平台特殊处理
        if (platform === 'utools') {
            const refreshBtn = document.getElementById('refresh-models-btn');
            refreshBtn.disabled = true;
            refreshBtn.textContent = '刷新中...';

            try {
                if (typeof utools !== 'undefined' && utools.allAiModels) {
                    // 使用ModelManager获取uTools模型列表
                    const models = await this.modelManager.fetchUtoolsModels();
                    if (models && models.length > 0) {
                        // 更新模型名称映射
                        this.updateUtoolsModelNameMap(models);

                        this.populateModelSelect(models, false);

                        // 恢复之前选择的模型
                        if (currentSelectedModel) {
                            const options = Array.from(modelSelect.options);
                            const modelExists = options.some(option => option.value === currentSelectedModel);
                            if (modelExists) {
                                modelSelect.value = currentSelectedModel;
                                this.handleModelChange(currentSelectedModel);
                            }
                        }

                        this.uiManager.showNotification('模型列表已刷新');
                    } else {
                        this.uiManager.showError('未获取到可用的uTools AI模型');
                    }
                } else {
                    this.uiManager.showError('uTools环境不可用');
                }
            } catch (error) {
                this.uiManager.showError('刷新失败: ' + error.message);
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '刷新';
            }
            return;
        }

        // 其他平台的处理
        const apiKey = document.getElementById('llm-api-key').value;
        if (!apiKey) {
            this.uiManager.showError('请先输入API Key');
            return;
        }

        const refreshBtn = document.getElementById('refresh-models-btn');
        refreshBtn.disabled = true;
        refreshBtn.textContent = '刷新中...';

        try {
            // 清除缓存
            this.modelManager.clearCache();

            // 重新获取模型列表
            await this.handlePlatformChange(platform);

            // 恢复之前选择的模型
            if (currentSelectedModel) {
                const options = Array.from(modelSelect.options);
                const modelExists = options.some(option => option.value === currentSelectedModel);
                if (modelExists) {
                    modelSelect.value = currentSelectedModel;
                    this.handleModelChange(currentSelectedModel);
                }
            }

            this.uiManager.showNotification('模型列表已刷新');
        } catch (error) {
            this.uiManager.showError('刷新失败: ' + error.message);
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '刷新';
        }
    }

    // 切换自定义模型
    toggleCustomModel(useCustom) {
        const customGroup = document.getElementById('custom-model-group');
        const modelSelect = document.getElementById('llm-model-select');

        if (useCustom) {
            customGroup.style.display = 'block';
            modelSelect.disabled = true;
        } else {
            customGroup.style.display = 'none';
            modelSelect.disabled = false;
        }
    }

    // 处理模型变化
    handleModelChange(modelId) {
        if (!modelId) return;

        const platformSelect = document.getElementById('llm-platform');
        if (!platformSelect) return;

        const platform = platformSelect.value;
        const modelInfo = this.modelManager.getModelInfo(platform, modelId);

        if (modelInfo) {
            this.displayModelInfo(modelInfo);
        }
    }

    // 显示模型信息
    displayModelInfo(modelInfo) {
        const modelInfoDiv = document.getElementById('model-info');
        const modelDetails = document.getElementById('model-details');

        modelDetails.innerHTML = `
            <div class="model-detail">
                <span class="label">平台:</span>
                <span class="value">${modelInfo.platform}</span>
            </div>
            <div class="model-detail">
                <span class="label">模型ID:</span>
                <span class="value">${modelInfo.modelId}</span>
            </div>
            <div class="model-detail">
                <span class="label">描述:</span>
                <span class="value">${modelInfo.description}</span>
            </div>
            <div class="model-detail">
                <span class="label">API端点:</span>
                <span class="value">${modelInfo.apiEndpoint}</span>
            </div>
            <div class="model-detail">
                <span class="label">最大Token:</span>
                <span class="value">${modelInfo.maxTokens}</span>
            </div>
        `;

        modelInfoDiv.style.display = 'block';

        // 自动设置推荐的最大Token数
        const maxTokensInput = document.getElementById('llm-max-tokens');
        if (parseInt(maxTokensInput.value) === 1000) { // 只在默认值时自动设置
            maxTokensInput.value = modelInfo.maxTokens;
        }
    }

    // API Key切换功能已移至ui.js中统一处理

    // 加载平台配置
    loadPlatformConfig(platform) {
        // 获取平台配置，优先使用新的platforms配置，兼容旧配置
        const platformConfig = this.config.llm?.platforms?.[platform] || {
            model: this.config.llm?.model || this.getDefaultPlatformConfig(platform).model,
            useCustomModel: this.config.llm?.useCustomModel || false,
            customModel: this.config.llm?.customModel || '',
            apiKey: this.config.llm?.apiKeys?.[platform] || this.config.llm?.apiKey || '',
            baseUrl: this.config.llm?.baseUrl || '',
            maxTokens: this.config.llm?.maxTokens || 1000
        };

        // 更新UI
        document.getElementById('llm-api-key').value = platformConfig.apiKey;
        document.getElementById('llm-base-url').value = platformConfig.baseUrl;
        document.getElementById('llm-max-tokens').value = platformConfig.maxTokens;
        document.getElementById('use-custom-model').checked = platformConfig.useCustomModel;
        document.getElementById('custom-model-name').value = platformConfig.customModel;

        // 更新API Key placeholder
        this.updateApiKeyPlaceholder(platform);

        // 更新自定义模型显示状态
        this.toggleCustomModel(platformConfig.useCustomModel);
    }

    // 更新API Key placeholder
    updateApiKeyPlaceholder(platform) {
        const apiKeyInput = document.getElementById('llm-api-key');
        const platformNames = {
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google',
            alibaba: '阿里云百炼',
            bytedance: '火山引擎',
            custom: '自定义平台'
        };

        apiKeyInput.placeholder = `请输入${platformNames[platform] || platform} API Key`;
    }

    // 保存当前平台配置
    savePlatformConfig() {
        const currentPlatform = this.config.llm?.platform;
        if (!currentPlatform) return;

        // 确保platforms对象存在
        if (!this.config.llm.platforms) {
            this.config.llm.platforms = {};
        }

        // 获取当前UI中的值
        const apiKey = document.getElementById('llm-api-key').value;
        const baseUrl = document.getElementById('llm-base-url').value;
        const maxTokens = parseInt(document.getElementById('llm-max-tokens').value) || 1000;
        const useCustomModel = document.getElementById('use-custom-model').checked;
        const customModel = document.getElementById('custom-model-name').value;
        const model = document.getElementById('llm-model-select').value;

        // 保存到对应平台
        this.config.llm.platforms[currentPlatform] = {
            apiKey: apiKey,
            baseUrl: baseUrl,
            maxTokens: maxTokens,
            useCustomModel: useCustomModel,
            customModel: customModel,
            model: model
        };

        // 同时更新旧的apiKeys对象以保持兼容性
        if (!this.config.llm.apiKeys) {
            this.config.llm.apiKeys = {};
        }
        this.config.llm.apiKeys[currentPlatform] = apiKey;
    }

    // 切换平台时更新API Key（保持兼容性）
    switchPlatformApiKey(platform) {
        this.loadPlatformConfig(platform);
    }

    // 初始化平台配置（保持已保存的模型选择）
    initializePlatformConfig(platform) {
        const modelSelect = document.getElementById('llm-model-select');
        const apiKeyInput = document.getElementById('llm-api-key');

        if (!modelSelect || !apiKeyInput) {
            console.warn('LLM配置元素未找到，跳过初始化');
            return;
        }

        const apiKeyGroup = apiKeyInput.closest('.form-group');
        const baseUrlInput = document.getElementById('llm-base-url');
        const baseUrlGroup = baseUrlInput ? baseUrlInput.closest('.form-group') : null;

        // 根据平台显示/隐藏相关字段
        if (platform === 'utools') {
            // uTools平台不需要API Key和Base URL
            if (apiKeyGroup) apiKeyGroup.style.display = 'none';
            if (baseUrlGroup) baseUrlGroup.style.display = 'none';
        } else {
            // 其他平台需要API Key
            if (apiKeyGroup) apiKeyGroup.style.display = 'block';
            if (baseUrlGroup) baseUrlGroup.style.display = 'block';
        }

        // 获取当前平台的保存配置
        const platformConfig = this.config.llm?.platforms?.[platform];
        const savedModel = platformConfig?.model;

        // 如果有保存的模型，直接设置并显示
        if (savedModel) {
            // 先设置一个临时选项以确保值能被设置
            modelSelect.innerHTML = `<option value="${savedModel}">${savedModel}</option>`;
            modelSelect.value = savedModel;
            this.handleModelChange(savedModel);

            // 异步加载完整的模型列表但保持当前选择
            setTimeout(() => {
                this.loadModelsAndRestoreSelection(platform, savedModel);
            }, 100);
        } else {
            // 没有保存的模型时，正常加载模型列表
            this.handlePlatformChange(platform);
        }
    }

    // 加载模型列表并恢复选择
    async loadModelsAndRestoreSelection(platform, savedModel) {
        const modelSelect = document.getElementById('llm-model-select');
        const apiKeyInput = document.getElementById('llm-api-key');

        try {
            if (platform === 'utools') {
                // uTools平台特殊处理
                if (typeof utools !== 'undefined' && utools.allAiModels) {
                    try {
                        // 使用ModelManager获取uTools模型列表
                        const models = await this.modelManager.fetchUtoolsModels();
                        if (models && models.length > 0) {
                            this.populateModelSelect(models, false);

                            // 恢复保存的模型选择
                            if (savedModel) {
                                const options = Array.from(modelSelect.options);
                                const modelExists = options.some(option => option.value === savedModel);
                                if (modelExists) {
                                    modelSelect.value = savedModel;
                                }
                            }
                        }
                    } catch (error) {
                        console.error('加载uTools模型失败:', error);
                    }
                }
            } else {
                // 其他平台
                const apiKey = apiKeyInput.value;
                const baseUrl = document.getElementById('llm-base-url').value;

                if (apiKey) {
                    const models = await this.modelManager.getModels(platform, apiKey, baseUrl);
                    this.populateModelSelect(models, false);

                    // 恢复保存的模型选择
                    if (savedModel) {
                        const options = Array.from(modelSelect.options);
                        const modelExists = options.some(option => option.value === savedModel);
                        if (modelExists) {
                            modelSelect.value = savedModel;
                        }
                    }
                } else {
                    // 没有API Key时，显示默认模型列表
                    const platformInfo = this.modelManager.getPlatformInfo(platform);
                    if (platformInfo) {
                        const defaultModels = platformInfo.defaultModels.map(model => ({
                            id: model,
                            name: model,
                            description: this.modelManager.getModelDescription(model),
                            isDefault: true
                        }));
                        this.populateModelSelect(defaultModels, false);

                        // 恢复保存的模型选择
                        if (savedModel) {
                            const options = Array.from(modelSelect.options);
                            const modelExists = options.some(option => option.value === savedModel);
                            if (modelExists) {
                                modelSelect.value = savedModel;
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('加载模型列表失败:', error);
        }
    }

    // 处理API Key输入变化
    handleApiKeyChange(apiKey) {
        const currentPlatform = document.getElementById('llm-platform').value;

        // 确保config.llm.apiKeys存在
        if (!this.config.llm) {
            this.config.llm = {};
        }
        if (!this.config.llm.apiKeys) {
            this.config.llm.apiKeys = {
                openai: '',
                anthropic: '',
                google: '',
                alibaba: '',
                bytedance: '',
                custom: ''
            };
        }

        // 保存到对应平台
        this.config.llm.apiKeys[currentPlatform] = apiKey;
    }

    // 获取所有平台的配置
    getAllPlatformConfigs() {
        const currentPlatform = document.getElementById('llm-platform').value;
        const currentConfig = {
            model: document.getElementById('llm-model-select').value,
            useCustomModel: document.getElementById('use-custom-model').checked,
            customModel: document.getElementById('custom-model-name').value,
            apiKey: document.getElementById('llm-api-key').value,
            baseUrl: document.getElementById('llm-base-url').value,
            maxTokens: parseInt(document.getElementById('llm-max-tokens').value) || 1000
        };

        // 获取现有的平台配置
        const platforms = {
            openai: this.config.llm?.platforms?.openai || this.getDefaultPlatformConfig('openai'),
            anthropic: this.config.llm?.platforms?.anthropic || this.getDefaultPlatformConfig('anthropic'),
            google: this.config.llm?.platforms?.google || this.getDefaultPlatformConfig('google'),
            alibaba: this.config.llm?.platforms?.alibaba || this.getDefaultPlatformConfig('alibaba'),
            bytedance: this.config.llm?.platforms?.bytedance || this.getDefaultPlatformConfig('bytedance'),
            zhipu: this.config.llm?.platforms?.zhipu || this.getDefaultPlatformConfig('zhipu'),
            utools: this.config.llm?.platforms?.utools || this.getDefaultPlatformConfig('utools')
        };

        // 更新当前平台的配置
        platforms[currentPlatform] = currentConfig;

        return platforms;
    }

    // 获取默认平台配置 - 移除预设默认模型，强制用户主动配置
    getDefaultPlatformConfig(platform) {
        const defaults = {
            openai: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: '', maxTokens: 1000 },
            anthropic: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: '', maxTokens: 1000 },
            google: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com' },
            alibaba: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: '', maxTokens: 1000 },
            bytedance: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: '', maxTokens: 1000 },
            ocrpro: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: '', maxTokens: 1000 },
            utools: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: '', maxTokens: 1000 },
            custom: { model: '', useCustomModel: false, customModel: '', apiKey: '', baseUrl: '', maxTokens: 1000 }
        };
        return defaults[platform] || defaults.openai;
    }

    // 获取所有平台的API Key
    getCurrentApiKeys() {
        const currentPlatform = document.getElementById('llm-platform').value;
        const currentApiKey = document.getElementById('llm-api-key').value;

        // 获取现有的API Keys
        const apiKeys = {
            openai: this.config.llm?.apiKeys?.openai || '',
            anthropic: this.config.llm?.apiKeys?.anthropic || '',
            google: this.config.llm?.apiKeys?.google || '',
            alibaba: this.config.llm?.apiKeys?.alibaba || '',
            bytedance: this.config.llm?.apiKeys?.bytedance || '',
            utools: this.config.llm?.apiKeys?.utools || '',
            custom: this.config.llm?.apiKeys?.custom || ''
        };

        // 更新当前平台的API Key
        apiKeys[currentPlatform] = currentApiKey;

        return apiKeys;
    }

    // 更新UI状态显示
    updateUIStatus(checkStatus = true, forceCheck = false, showMessage = false) {
        // 更新当前服务状态
        const currentService = this.config.service;
        let platformName = null;

        if (currentService === 'llm' && this.config.llm?.platform) {
            platformName = this.config.llm.platform;
        }

        this.uiManager.updateCurrentService(currentService, platformName);

        // 只有在需要时才检测服务状态
        if (checkStatus && currentService) {
            this.checkServiceStatus(currentService, forceCheck, showMessage);
        }


    }

    // 确保服务状态是最新的（用于OCR识别前的静默检查）
    async ensureServiceStatusUpdated(serviceName) {
        const currentServiceConfigHash = this.generateServiceConfigHash(serviceName, this.config);
        const cachedStatus = this.getCachedServiceStatus(serviceName);

        // 如果没有缓存或配置已变化，需要更新状态
        if (!cachedStatus || cachedStatus.serviceConfigHash !== currentServiceConfigHash) {
            // 静默检查服务状态，不显示消息
            await this.checkServiceStatus(serviceName, false, false);
        }
    }

    // 智能状态更新管理器 - 确保状态更新的及时性
    async smartStatusUpdate(serviceName, platformName = null, reason = 'unknown') {
        try {
            // 直接使用新的统一状态管理系统更新主页面状态
            this.updateMainPageStatus();

            // 根据原因决定是否显示消息
            if (reason === 'service_switch') {
                // 获取服务状态用于判断是否显示切换成功消息
                const statusInfo = this.determineMainPageServiceStatus(serviceName);
                if (statusInfo.status === 'ready') {
                    this.uiManager.showServiceSwitched(serviceName, platformName);
                }
            }

            // 同时兼容旧的缓存系统（用于传统OCR服务）
            await this.updateLegacyServiceStatus(serviceName, reason);


        } catch (error) {
            console.error('智能状态更新失败:', error);
            // 降级到基本状态显示
            this.uiManager.updateCurrentService(serviceName, platformName);
            this.uiManager.updateRecognitionStatus('unknown', '状态未知');
        }
    }

    // 更新传统服务状态（统一化状态管理）
    async updateLegacyServiceStatus(serviceName, reason) {
        // 对于传统OCR服务和传统翻译服务，采用与AI模型服务相同的永久存储策略
        const traditionalServices = ['baidu', 'tencent', 'aliyun', 'volcano', 'deeplx', 'youdao'];
        if (!traditionalServices.includes(serviceName)) {
            return; // AI服务由统一状态管理器处理
        }

        // 检查是否需要重新检测状态 - 使用服务特定的配置哈希值
        const currentServiceConfigHash = this.generateServiceConfigHash(serviceName, this.config);
        const cachedStatus = this.getCachedServiceStatus(serviceName);

        // 采用与AI模型服务相同的逻辑：只有在配置变更或失败时才更新状态
        // 成功状态将永久保存，直到配置变更或连接失败
        const cachedServiceConfigHash = cachedStatus?.serviceConfigHash;

        // 采用与AI模型服务相同的逻辑：永久存储成功状态，只在配置变更时重新检测
        if (cachedStatus && cachedServiceConfigHash === currentServiceConfigHash) {
            // 配置未变化，使用缓存状态（永久有效，除非配置变更或连接失败）
            this.uiManager.updateRecognitionStatus(cachedStatus.status.type, cachedStatus.status.message);
            this.uiManager.updateConfigServiceStatus(serviceName, cachedStatus.status.type);

            // 如果是服务切换且状态为ready，显示切换成功消息
            if (reason === 'service_switch' && cachedStatus.status.type === 'ready') {
                this.uiManager.showServiceSwitched(serviceName, null);
            }
        } else {
            // 配置变更或无缓存，需要重新检测状态
            if (!cachedStatus) {
                // 无缓存状态，先检查是否已配置
                const isConfigured = this.isServiceConfigured(serviceName);
                if (!isConfigured) {
                    const status = { type: 'unconfigured', message: '未配置' };
                    this.uiManager.updateRecognitionStatus(status.type, status.message);
                    this.setCachedServiceStatus(serviceName, status, null, currentServiceConfigHash);
                    this.uiManager.updateConfigServiceStatus(serviceName, status.type);
                    return;
                }
            }

            // 配置变更或首次检测，重新检测服务状态
            this.checkServiceStatus(serviceName, false, reason === 'service_switch');
        }
    }

    // 处理服务切换（配置页面下拉框切换）
    handleServiceSwitch(serviceValue) {
        // 切换配置区域显示
        this.uiManager.switchConfigSection(serviceValue);

        // 立即切换服务并检测状态
        this.switchServiceImmediately(serviceValue);
    }

    // 立即切换服务（仅在配置界面下拉框切换时调用）
    async switchServiceImmediately(serviceName) {
        // 更新内存中的配置（临时更新，不保存）
        this.config.service = serviceName;

        // 使用新的统一状态管理系统
        this.updateMainPageStatus();

        // 注意：这里不标记配置已修改，因为这只是配置界面的切换
        // 只有用户实际修改配置内容时才标记为已修改
    }

    // 更新平台配置（不触发状态检测）
    async updatePlatformConfig(platformName) {
        // 更新配置中的平台选择
        this.config.llm = this.config.llm || {};
        this.config.llm.platform = platformName;

        // 更新UI显示（不检测状态）
        this.uiManager.updateCurrentService('llm', platformName);

        // 初始化平台配置
        this.initializePlatformConfig(platformName);
    }

    // 标记配置已修改
    markConfigAsModified() {
        this.configModified = true;
        // 可以在这里添加UI提示，比如在保存按钮旁显示未保存标记
        this.updateSaveButtonState();
    }

    // 清除配置修改标记
    clearConfigModified() {
        this.configModified = false;
        this.updateSaveButtonState();
    }

    // 更新保存按钮状态
    updateSaveButtonState() {
        const saveBtn = document.getElementById('save-config-btn');
        if (saveBtn) {
            if (this.configModified) {
                saveBtn.textContent = '保存配置 *';
                saveBtn.classList.add('modified');
            } else {
                saveBtn.textContent = '保存配置';
                saveBtn.classList.remove('modified');
            }
        }
    }

    // 检查是否有未保存的配置修改
    hasUnsavedChanges() {
        return this.configModified;
    }

    // 安全获取元素值的辅助方法
    getElementValue(elementId, defaultValue = '') {
        const element = document.getElementById(elementId);
        return element ? element.value : defaultValue;
    }

    // 安全设置元素值的辅助方法
    setElementValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            // 对于密码字段和配置字段，允许设置空值
            if (value !== undefined && value !== null) {
                element.value = value;
            }
        }
    }

    // 更新uTools模型名称映射
    updateUtoolsModelNameMap(models) {
        if (!models || models.length === 0) return;

        // 确保uTools配置存在
        if (!this.config.utools) {
            this.config.utools = {};
        }
        if (!this.config.utools.modelNameMap) {
            this.config.utools.modelNameMap = {};
        }

        // 更新模型名称映射
        models.forEach(model => {
            if (model.id && model.name && model.id !== model.name) {
                this.config.utools.modelNameMap[model.id] = model.name;
            }
        });

        // 保存配置
        this.saveConfigSimple();
    }

    // 获取平台默认Base URL
    getDefaultBaseUrl(platform) {
        const defaultUrls = {
            'openai': 'https://api.openai.com',  // 改为根地址，由 URL 构造函数统一添加 /v1
            'anthropic': 'https://api.anthropic.com',
            'google': 'https://generativelanguage.googleapis.com/v1beta',
            'alibaba': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            'bytedance': 'https://ark.cn-beijing.volces.com/api/v3',
            'zhipu': 'https://open.bigmodel.cn/api/paas/v4'
        };
        return defaultUrls[platform] || '';
    }

    // 加载AI平台配置
    loadAIPlatformConfigs() {
        const platforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'];

        platforms.forEach(platform => {
            const platformConfig = this.config[platform] || {};

            // uTools平台特殊处理
            if (platform === 'utools') {
                // uTools平台使用新的模型列表管理
                this.renderModelList(platform);

                // 最大Token数
                this.setElementValue(`${platform}-max-tokens`, platformConfig.maxTokens || 1000);

            }
            // OCR Pro平台特殊处理
            else if (platform === 'ocrpro') {
                // OCR Pro平台使用新的模型列表管理，不显示API Key和URL
                this.renderModelList(platform);

                // 最大Token数
                this.setElementValue(`${platform}-max-tokens`, platformConfig.maxTokens || 1000);

            }
            // 火山引擎特殊处理
            else if (platform === 'bytedance') {
                // 聊天API配置
                this.setElementValue(`${platform}-api-key`, platformConfig.apiKey);
                if (platformConfig.baseUrl) {
                    this.setElementValue(`${platform}-base-url`, platformConfig.baseUrl);
                }

                // 模型管理API配置
                this.setElementValue('bytedance-access-key', platformConfig.accessKey);
                this.setElementValue('bytedance-secret-key', platformConfig.secretKey);

                // 模型列表管理
                this.renderModelList(platform);

                // 自定义模型
                const useCustomModelCheckbox = document.getElementById(`${platform}-use-custom-model`);
                if (useCustomModelCheckbox) {
                    useCustomModelCheckbox.checked = platformConfig.useCustomModel || false;
                }
                this.setElementValue(`${platform}-custom-model-name`, platformConfig.customModel);

                // 最大Token数
                this.setElementValue(`${platform}-max-tokens`, platformConfig.maxTokens || 1000);

                // 切换自定义模型显示状态
                this.toggleCustomModelForPlatform(platform, platformConfig.useCustomModel || false);

                // 更新 API URL 预览（使用已保存的配置值）
                this.updateApiUrlPreviewForPlatform(platform);
            }
            // 智谱AI特殊处理
            else if (platform === 'zhipu') {
                // API Key
                this.setElementValue(`${platform}-api-key`, platformConfig.apiKey);

                // Base URL - 设置配置值或默认值
                const defaultBaseUrl = this.getDefaultBaseUrl(platform);
                const baseUrl = platformConfig.baseUrl || defaultBaseUrl;
                if (baseUrl) {
                    this.setElementValue(`${platform}-base-url`, baseUrl);
                }

                // 模型列表管理
                this.renderModelList(platform);

                // 自定义模型
                const useCustomModelCheckbox = document.getElementById(`${platform}-use-custom-model`);
                if (useCustomModelCheckbox) {
                    useCustomModelCheckbox.checked = platformConfig.useCustomModel || false;
                }
                this.setElementValue(`${platform}-custom-model-name`, platformConfig.customModel);

                // 智谱AI不需要最大Token数配置

                // 切换自定义模型显示状态
                this.toggleCustomModelForPlatform(platform, platformConfig.useCustomModel || false);

                // 更新 API URL 预览（使用已保存的配置值）
                this.updateApiUrlPreviewForPlatform(platform);
            } else {
                // 其他平台的正常处理
                // API Key
                this.setElementValue(`${platform}-api-key`, platformConfig.apiKey);

                // Base URL - 设置配置值或默认值
                const defaultBaseUrl = this.getDefaultBaseUrl(platform);
                const baseUrl = platformConfig.baseUrl || defaultBaseUrl;
                if (baseUrl) {
                    this.setElementValue(`${platform}-base-url`, baseUrl);
                }

                // 所有平台都使用新的模型列表管理
                this.renderModelList(platform);

                // 自定义模型
                const useCustomModelCheckbox = document.getElementById(`${platform}-use-custom-model`);
                if (useCustomModelCheckbox) {
                    useCustomModelCheckbox.checked = platformConfig.useCustomModel || false;
                }
                this.setElementValue(`${platform}-custom-model-name`, platformConfig.customModel);

                // 最大Token数
                this.setElementValue(`${platform}-max-tokens`, platformConfig.maxTokens || 1000);

                // 切换自定义模型显示状态
                this.toggleCustomModelForPlatform(platform, platformConfig.useCustomModel || false);

                // 更新 API URL 预览（使用已保存的配置值）
                this.updateApiUrlPreviewForPlatform(platform);
            }
        });
    }

    // 为特定平台切换自定义模型显示状态
    toggleCustomModelForPlatform(platform, useCustom) {
        const customGroup = document.getElementById(`${platform}-custom-model-group`);
        const modelSelect = document.getElementById(`${platform}-model-select`);

        // 只有当相关DOM元素存在时才进行处理
        if (customGroup && modelSelect) {
            if (useCustom) {
                customGroup.style.display = 'block';
                modelSelect.disabled = true;
            } else {
                customGroup.style.display = 'none';
                modelSelect.disabled = false;
            }
        }
    }

    // 获取所有AI平台配置
    getAllAIPlatformConfigs() {
        const platforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'];
        const configs = {};

        platforms.forEach(platform => {
            // 获取现有配置作为基础
            const existingConfig = this.config[platform] || {};

            // 基础配置
            const baseConfig = {
                apiKey: this.getElementValue(`${platform}-api-key`) || existingConfig.apiKey || '',
                baseUrl: this.getElementValue(`${platform}-base-url`) || existingConfig.baseUrl || '',
                // 保留现有的模型配置，不要覆盖
                model: existingConfig.model || '',
                modelList: existingConfig.modelList || [],
                useCustomModel: existingConfig.useCustomModel || false,
                customModel: existingConfig.customModel || '',
                maxTokens: existingConfig.maxTokens || 1000
            };

            // 火山引擎特殊处理：添加模型管理API配置字段
            if (platform === 'bytedance') {
                configs[platform] = {
                    ...baseConfig,
                    // 模型管理API配置
                    accessKey: this.getElementValue('bytedance-access-key') || existingConfig.accessKey || '',
                    secretKey: this.getElementValue('bytedance-secret-key') || existingConfig.secretKey || ''
                };
            } else {
                configs[platform] = baseConfig;
            }
        });

        return configs;
    }





    // 获取平台显示名称
    getPlatformDisplayName(platform) {
        const names = {
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'google': 'Google Gemini',
            'alibaba': '阿里云百炼',
            'bytedance': '火山引擎',
            'zhipu': '智谱AI',
            'ocrpro': 'OCR Pro',
            'utools': 'uTools AI',
            'custom': '自定义平台'
        };
        return names[platform] || platform;
    }

    // 绑定模型管理事件
    bindModelManagementEvents() {
        // 所有AI平台的模型管理事件（OCR Pro使用预设模型，不需要添加按钮）
        const platforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'utools'];
        platforms.forEach(platform => {
            this.bindPlatformModelEvents(platform);
        });

        // OCR Pro只绑定获取按钮事件，不绑定添加按钮
        this.bindOcrProFetchEvent();

        // 模态窗口事件
        this.bindModalEvents();
    }

    // 绑定自动保存事件
    bindAutoSaveEvents() {
        // 添加配置字段变化监听，实现实时自动保存
        this.bindConfigFieldAutoSave();
    }

    // 绑定配置字段自动保存
    bindConfigFieldAutoSave() {
        // 普通OCR服务自动保存
        this.bindOCRServiceAutoSave();

        // AI平台自动保存
        const platforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'utools'];

        platforms.forEach(platform => {
            // API Key字段
            const apiKeyField = document.getElementById(`${platform}-api-key`);
            if (apiKeyField) {
                this.bindFieldWithChangeDetection(apiKeyField, platform, 'apiKey');
            }

            // Base URL字段
            const baseUrlField = document.getElementById(`${platform}-base-url`);
            if (baseUrlField) {
                this.bindFieldWithChangeDetection(baseUrlField, platform, 'baseUrl');
            }

            // Max Tokens字段
            const maxTokensField = document.getElementById(`${platform}-max-tokens`);
            if (maxTokensField) {
                this.bindFieldWithChangeDetection(maxTokensField, platform, 'maxTokens', 'number');
            }

            // 模型选择字段（传统select下拉框，如果存在的话）
            const modelSelectField = document.getElementById(`${platform}-model-select`);
            if (modelSelectField) {
                this.bindFieldWithChangeDetection(modelSelectField, platform, 'model');
            }

            // 自定义模型字段（uTools平台除外）
            if (platform !== 'utools') {
                const customModelField = document.getElementById(`${platform}-custom-model-name`);
                if (customModelField) {
                    this.bindFieldWithChangeDetection(customModelField, platform, 'customModel');
                }

                const useCustomModelField = document.getElementById(`${platform}-use-custom-model`);
                if (useCustomModelField) {
                    this.bindFieldWithChangeDetection(useCustomModelField, platform, 'useCustomModel', 'boolean');
                }
            }

            // 火山引擎特殊字段（模型管理API配置）
            if (platform === 'bytedance') {
                const accessKeyField = document.getElementById('bytedance-access-key');
                if (accessKeyField) {
                    this.bindFieldWithChangeDetection(accessKeyField, platform, 'accessKey');
                }

                const secretKeyField = document.getElementById('bytedance-secret-key');
                if (secretKeyField) {
                    this.bindFieldWithChangeDetection(secretKeyField, platform, 'secretKey');
                }
            }
        });
    }

    // 绑定字段变化检测和自动保存
    bindFieldWithChangeDetection(field, platform, configKey, valueType = 'string') {
        let saveTimeout;

        const debouncedSave = () => {
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                // 获取当前字段值
                let currentValue;
                if (valueType === 'boolean') {
                    currentValue = field.checked;
                } else if (valueType === 'number') {
                    currentValue = parseInt(field.value) || 0;
                } else {
                    currentValue = field.value.trim();
                }

                // 获取保存的配置值
                const savedConfig = this.config[platform] || {};
                let savedValue = savedConfig[configKey];

                // 处理默认值
                if (savedValue === undefined || savedValue === null) {
                    if (valueType === 'boolean') {
                        savedValue = false;
                    } else if (valueType === 'number') {
                        savedValue = configKey === 'maxTokens' ? 1000 : 0;
                    } else {
                        savedValue = '';
                    }
                }

                // 比较值是否发生变化
                const hasChanged = currentValue !== savedValue;

                if (hasChanged) {
                    this.uiManager.saveModelServiceSetting(platform, configKey, currentValue);
                }
            }, 300);
        };

        // 只在blur事件时触发保存，input事件仅用于实时反馈
        field.addEventListener('blur', debouncedSave);

        // 对于选择框和复选框，也监听change事件
        if (field.type === 'checkbox' || field.tagName === 'SELECT') {
            field.addEventListener('change', debouncedSave);
        }
    }

    // 绑定普通OCR服务自动保存
    bindOCRServiceAutoSave() {
        const ocrServices = [
            {
                service: 'baidu',
                fields: [
                    { id: 'baidu-api-key', key: 'apiKey' },
                    { id: 'baidu-secret-key', key: 'secretKey' },
                    { id: 'baidu-translate-api-key', key: 'translateApiKey' },
                    { id: 'baidu-translate-secret-key', key: 'translateSecretKey' }
                ]
            },
            {
                service: 'tencent',
                fields: [
                    { id: 'tencent-secret-id', key: 'secretId' },
                    { id: 'tencent-secret-key', key: 'secretKey' }
                ]
            },
            {
                service: 'aliyun',
                fields: [
                    { id: 'aliyun-access-key', key: 'accessKey' },
                    { id: 'aliyun-access-secret', key: 'accessSecret' }
                ]
            },
            {
                service: 'volcano',
                fields: [
                    { id: 'volcano-access-key', key: 'accessKey' },
                    { id: 'volcano-secret-key', key: 'secretKey' }
                ]
            },
            {
                service: 'deeplx',
                fields: [
                    { id: 'deeplx-api-url', key: 'apiUrl' },
                    { id: 'deeplx-access-token', key: 'accessToken' }
                ]
            },
            {
                service: 'youdao',
                fields: [
                    { id: 'youdao-app-key', key: 'appKey' },
                    { id: 'youdao-app-secret', key: 'appSecret' },
                    { id: 'youdao-vocab-id', key: 'vocabId' }
                ]
            },
            {
                service: 'baiduFanyi',
                fields: [
                    { id: 'baiduFanyi-app-id', key: 'appId' },
                    { id: 'baiduFanyi-secret-key', key: 'secretKey' }
                ]
            }
        ];

        ocrServices.forEach(({ service, fields }) => {
            fields.forEach(({ id, key }) => {
                const field = document.getElementById(id);
                if (field) {
                    this.bindOCRFieldWithChangeDetection(field, service, key);
                }
            });
        });
    }

    // 绑定OCR字段变化检测和自动保存
    bindOCRFieldWithChangeDetection(field, service, configKey) {
        let saveTimeout;

        const debouncedSave = () => {
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                // 获取当前字段值
                const currentValue = field.value.trim();

                // 获取保存的配置值
                const savedConfig = this.config[service] || {};
                const savedValue = savedConfig[configKey] || '';

                // 比较值是否发生变化
                const hasChanged = currentValue !== savedValue;

                if (hasChanged) {
                    this.saveOCRServiceConfig(service);
                }
            }, 300);
        };

        field.addEventListener('blur', debouncedSave);
    }

    // 保存普通OCR服务配置
    saveOCRServiceConfig(service) {
        try {
            const oldConfig = { ...this.config };
            const config = { ...this.config };

            // 根据服务类型获取配置
            switch (service) {
                case 'baidu':
                    config.baidu = {
                        // 保留现有配置并合并新值
                        ...this.config.baidu,
                        apiKey: this.getElementValue('baidu-api-key'),
                        secretKey: this.getElementValue('baidu-secret-key'),
                        // 百度翻译配置
                        translateAppId: this.getElementValue('baidu-translate-app-id'),
                        translateApiKey: this.getElementValue('baidu-translate-api-key'),
                        translateSecretKey: this.getElementValue('baidu-translate-secret-key')
                    };
                    break;
                case 'tencent':
                    config.tencent = {
                        secretId: this.getElementValue('tencent-secret-id'),
                        secretKey: this.getElementValue('tencent-secret-key')
                    };
                    break;
                case 'aliyun':
                    config.aliyun = {
                        accessKey: this.getElementValue('aliyun-access-key'),
                        accessSecret: this.getElementValue('aliyun-access-secret')
                    };
                    break;
                case 'volcano':
                    config.volcano = {
                        accessKey: this.getElementValue('volcano-access-key'),
                        secretKey: this.getElementValue('volcano-secret-key')
                    };
                    break;
                case 'deeplx':
                    config.deeplx = {
                        // 保留现有配置并合并新值
                        ...this.config.deeplx,
                        apiUrl: this.getElementValue('deeplx-api-url'),
                        accessToken: this.getElementValue('deeplx-access-token')
                    };
                    break;
                case 'youdao':
                    config.youdao = {
                        // 保留现有配置并合并新值
                        ...this.config.youdao,
                        appKey: this.getElementValue('youdao-app-key'),
                        appSecret: this.getElementValue('youdao-app-secret'),
                        vocabId: this.getElementValue('youdao-vocab-id')
                    };
                    break;
                case 'baiduFanyi':
                    config.baiduFanyi = {
                        // 保留现有配置并合并新值
                        ...this.config.baiduFanyi,
                        appId: this.getElementValue('baiduFanyi-app-id'),
                        secretKey: this.getElementValue('baiduFanyi-secret-key')
                    };
                    break;
                default:
                    return;
            }

            // 检查配置是否发生变化
            const oldServiceHash = this.generateServiceConfigHash(service, oldConfig);
            const newServiceHash = this.generateServiceConfigHash(service, config);

            if (oldServiceHash !== newServiceHash) {
                // 配置发生变化，清除该服务的状态缓存
                this.clearServiceStatusCache(service);

                if (service === 'bytedance') {
                    const accessKey = this.getElementValue('bytedance-access-key');
                    const secretKey = this.getElementValue('bytedance-secret-key');
                    const apiKey = this.getElementValue('bytedance-api-key');
                    this.modelManager.clearByteDanceModelsCache(accessKey, secretKey, apiKey);
                }
            }

            // 保存配置
            const result = this.configManager.saveConfig(config);
            if (result.success) {
                this.config = result.config;
                // 只在窗口可见时显示保存成功提示（短暂显示）
                if (this.uiManager.isWindowVisible()) {
                    this.uiManager.showNotification(`${this.uiManager.getServiceDisplayName(service)}配置已保存`, 'success', 1200);
                }

                // 更新服务状态指示器
                this.updateServiceIndicatorStatus(service);

                // 检查是否需要更新主界面模型按钮
                this.updateMainInterfaceAfterConfigSave(service);
            } else {
                this.uiManager.showError(`保存${this.uiManager.getServiceDisplayName(service)}配置失败: ${result.error}`);
            }
        } catch (error) {
            console.error(`保存${service}配置失败:`, error);
            this.uiManager.showError(`保存${this.uiManager.getServiceDisplayName(service)}配置失败: ${error.message}`);
        }
    }

    // 配置保存后更新主界面
    updateMainInterfaceAfterConfigSave(service) {
        try {
            // 检查刚保存的服务是否已配置完整
            const isServiceConfigured = this.isServiceConfigured(service);

            if (isServiceConfigured) {
                // 获取当前识别模式
                const currentMode = this.getCurrentRecognitionMode() || 'text';
                const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);

                // 检查是否需要为当前模式设置新配置的服务
                const shouldSetForCurrentMode = !modeConfig || !modeConfig.service;

                if (shouldSetForCurrentMode) {
                    // 为当前模式设置默认模型（使用刚保存的服务）
                    let modelToSet = null;

                    // 对于AI服务，需要设置具体的模型
                    if (['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'utools'].includes(service)) {
                        const serviceConfig = this.config[service];
                        if (serviceConfig) {
                            modelToSet = serviceConfig.useCustomModel ? serviceConfig.customModel : serviceConfig.model;
                        }
                    }

                    const result = this.configManager.setRecognitionModeConfig(currentMode, service, modelToSet);
                    if (result.success) {
                        this.config = result.config;
                        this.config.service = service; // 更新全局服务配置
                    }
                }

                // 检查其他未配置的识别模式，也为它们设置新的服务
                const allModes = ['text', 'table', 'formula', 'markdown'];
                let modelToSet = null;

                // 对于AI服务，需要设置具体的模型
                if (['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'utools'].includes(service)) {
                    const serviceConfig = this.config[service];
                    if (serviceConfig) {
                        modelToSet = serviceConfig.useCustomModel ? serviceConfig.customModel : serviceConfig.model;
                    }
                }

                allModes.forEach(mode => {
                    const modeConfig = this.configManager.getRecognitionModeConfig(mode);
                    if (!modeConfig || !modeConfig.service) {

                        this.configManager.setRecognitionModeConfig(mode, service, modelToSet);
                    }
                });

                // 重新加载配置并更新主界面显示
                this.config = this.configManager.getConfig();
                this.saveConfigSimple();

                // 更新主界面显示
                this.updateMainInterfaceModelFromConfig();

                // 触发配置变化事件
                document.dispatchEvent(new CustomEvent('configModelChanged', {
                    detail: { mode: currentMode, service: service, model: modelToSet }
                }));

            }
        } catch (error) {
            console.error('配置保存后更新主界面失败:', error);
        }
    }

    // 自动保存模型服务配置（简化版本）
    autoSaveModelServiceConfig() {
        // 检查是否在配置页面
        if (this.uiManager.currentView === 'config') {
            try {
                // 获取所有AI平台配置
                const configs = this.getAllAIPlatformConfigs();

                // 检查配置是否有变化
                let hasChanges = false;
                Object.keys(configs).forEach(platform => {
                    const currentConfig = this.config[platform] || {};
                    const newConfig = configs[platform];

                    if (JSON.stringify(currentConfig) !== JSON.stringify(newConfig)) {
                        hasChanges = true;
                        this.config[platform] = { ...currentConfig, ...newConfig };
                    }
                });

                // 只有在有变化时才保存
                if (hasChanges) {
                    const result = this.saveConfigSimple();
                    if (!result.success) {
                        this.uiManager.showError('保存配置失败: ' + result.error);
                    }
                }
            } catch (error) {
                console.error('自动保存配置失败:', error);
                this.uiManager.showError('自动保存配置失败: ' + error.message);
            }
        }
    }

    // 绑定平台模型管理事件
    bindPlatformModelEvents(platform) {
        // 获取模型按钮
        const fetchBtn = document.getElementById(`${platform}-fetch-models-btn`);
        if (fetchBtn) {
            fetchBtn.addEventListener('click', () => this.showFetchModelsModal(platform));
        }

        // 添加模型按钮
        const addBtn = document.getElementById(`${platform}-add-model-btn`);
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAddModelModal(platform));
        }
    }

    // 绑定OCR Pro获取按钮事件（不包含添加按钮）
    bindOcrProFetchEvent() {
        const fetchBtn = document.getElementById('ocrpro-fetch-models-btn');
        if (fetchBtn) {
            fetchBtn.addEventListener('click', () => this.showFetchModelsModal('ocrpro'));
        }
    }

    // 绑定模态窗口事件
    bindModalEvents() {
        // 获取模型弹窗事件
        const fetchModal = document.getElementById('fetch-models-modal');
        const fetchCloseBtn = document.getElementById('fetch-models-close');
        const fetchRefreshBtn = document.getElementById('fetch-models-refresh');

        if (fetchCloseBtn) {
            fetchCloseBtn.addEventListener('click', () => this.hideFetchModelsModal());
        }

        if (fetchRefreshBtn) {
            fetchRefreshBtn.addEventListener('click', () => this.handleFetchModelsRefresh());
        }

        if (fetchModal) {
            fetchModal.addEventListener('click', (e) => {
                if (e.target === fetchModal) {
                    this.hideFetchModelsModal();
                }
            });
        }

        // 添加模型弹窗事件
        const addModal = document.getElementById('add-model-modal');
        const addCloseBtn = document.getElementById('add-model-close');
        const addCancelBtn = document.getElementById('add-model-cancel');
        const addConfirmBtn = document.getElementById('add-model-confirm');

        if (addCloseBtn) {
            addCloseBtn.addEventListener('click', () => this.hideAddModelModal());
        }

        if (addCancelBtn) {
            addCancelBtn.addEventListener('click', () => this.hideAddModelModal());
        }

        if (addConfirmBtn) {
            addConfirmBtn.addEventListener('click', () => this.confirmAddModel());
        }

        if (addModal) {
            addModal.addEventListener('click', (e) => {
                if (e.target === addModal) {
                    this.hideAddModelModal();
                }
            });
        }

        // 编辑模型弹窗事件
        const editModal = document.getElementById('edit-model-modal');
        const editCloseBtn = document.getElementById('edit-model-close');
        const editCancelBtn = document.getElementById('edit-model-cancel');
        const editSaveBtn = document.getElementById('edit-model-save');
        const editResetBtn = document.getElementById('edit-model-reset');

        if (editCloseBtn) {
            editCloseBtn.addEventListener('click', () => this.hideEditModelModal());
        }

        if (editCancelBtn) {
            editCancelBtn.addEventListener('click', () => this.hideEditModelModal());
        }

        if (editSaveBtn) {
            editSaveBtn.addEventListener('click', () => this.saveModelSettings());
        }

        if (editResetBtn) {
            editResetBtn.addEventListener('click', () => this.resetModelCapabilities());
        }

        // 点击模态框外部关闭
        if (editModal) {
            editModal.addEventListener('click', (e) => {
                if (e.target === editModal) {
                    this.hideEditModelModal();
                }
            });
        }

        // 添加模型输入框回车事件
        const addInput = document.getElementById('add-model-input');
        if (addInput) {
            addInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.confirmAddModel();
                }
            });
        }

        // 添加自定义服务商弹窗事件
        const addCustomProviderBtn = document.getElementById('add-custom-provider-btn');
        const addCustomProviderModal = document.getElementById('add-custom-provider-modal');
        const addCustomProviderClose = document.getElementById('add-custom-provider-close');
        const addCustomProviderCancel = document.getElementById('add-custom-provider-cancel');
        const addCustomProviderConfirm = document.getElementById('add-custom-provider-confirm');

        if (addCustomProviderBtn) {
            addCustomProviderBtn.addEventListener('click', () => this.showAddCustomProviderModal());
        }

        if (addCustomProviderClose) {
            addCustomProviderClose.addEventListener('click', () => this.hideAddCustomProviderModal());
        }

        if (addCustomProviderCancel) {
            addCustomProviderCancel.addEventListener('click', () => this.hideAddCustomProviderModal());
        }

        if (addCustomProviderConfirm) {
            addCustomProviderConfirm.addEventListener('click', () => this.confirmAddCustomProvider());
        }

        if (addCustomProviderModal) {
            addCustomProviderModal.addEventListener('click', (e) => {
                if (e.target === addCustomProviderModal) {
                    this.hideAddCustomProviderModal();
                }
            });
        }

        // 初始化服务商类型按钮图标
        this.initProviderTypeButtonIcons();

        // 服务商类型选择按钮事件（单选）
        const providerTypeButtons = document.querySelectorAll('.provider-type-btn');
        providerTypeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // 移除所有按钮的选中状态
                providerTypeButtons.forEach(b => b.classList.remove('selected'));
                // 添加当前按钮的选中状态
                btn.classList.add('selected');
            });
        });

        // 自定义服务商设置弹窗事件
        const customProviderSettingsModal = document.getElementById('custom-provider-settings-modal');
        const customProviderSettingsClose = document.getElementById('custom-provider-settings-close');
        const customProviderSettingsCancel = document.getElementById('custom-provider-settings-cancel');
        const customProviderSettingsSave = document.getElementById('custom-provider-settings-save');
        const customProviderSettingsDelete = document.getElementById('custom-provider-settings-delete');

        if (customProviderSettingsClose) {
            customProviderSettingsClose.addEventListener('click', () => this.hideCustomProviderSettingsModal());
        }

        if (customProviderSettingsCancel) {
            customProviderSettingsCancel.addEventListener('click', () => this.hideCustomProviderSettingsModal());
        }

        if (customProviderSettingsSave) {
            customProviderSettingsSave.addEventListener('click', () => this.confirmCustomProviderSettings());
        }

        if (customProviderSettingsDelete) {
            customProviderSettingsDelete.addEventListener('click', () => this.deleteCustomProviderFromSettings());
        }

        if (customProviderSettingsModal) {
            customProviderSettingsModal.addEventListener('click', (e) => {
                if (e.target === customProviderSettingsModal) {
                    this.hideCustomProviderSettingsModal();
                }
            });
        }

        // 设置弹窗中的服务商类型选择按钮事件（单选）
        const settingsTypeButtons = document.querySelectorAll('.custom-provider-settings-type-btn');
        settingsTypeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // 移除所有按钮的选中状态
                settingsTypeButtons.forEach(b => b.classList.remove('selected'));
                // 添加当前按钮的选中状态
                btn.classList.add('selected');
            });
        });

        // 翻译模型选择弹窗事件
        const translateModelSelectModal = document.getElementById('translate-model-select-modal');
        const translateModelSelectClose = document.getElementById('translate-model-select-close');

        if (translateModelSelectClose) {
            translateModelSelectClose.addEventListener('click', () => {
                this.uiManager.hideTranslateModelSelectModal();
            });
        }

        if (translateModelSelectModal) {
            translateModelSelectModal.addEventListener('click', (e) => {
                if (e.target === translateModelSelectModal) {
                    this.uiManager.hideTranslateModelSelectModal();
                }
            });
        }
    }

    // 处理OCR结果朗读
    handleOCRResultTTS() {
        const resultTextarea = document.getElementById('result-text');
        const ttsBtn = document.getElementById('ocr-result-tts-btn');

        if (!resultTextarea || !ttsBtn) {
            return;
        }

        const text = resultTextarea.value.trim();

        // 检查文本是否为空
        if (!text) {
            this.uiManager.showNotification('暂无识别结果可以朗读', 'warning', 2000);
            return;
        }

        // 初始化TTS管理器（如果还没有初始化）
        if (!this.uiManager.ttsManager) {
            this.uiManager.ttsManager = new window.TTSManager();
        }

        // 检查TTS支持
        if (!this.uiManager.ttsManager || !this.uiManager.ttsManager.getIsSupported()) {
            this.uiManager.showNotification('您的浏览器不支持语音朗读功能', 'error', 3000);
            return;
        }

        // 如果正在朗读，则停止
        if (this.uiManager.ttsManager.isSpeaking()) {
            this.uiManager.ttsManager.stop();
            ttsBtn.classList.remove('speaking');
            ttsBtn.title = '朗读识别结果';
            return;
        }

        // 开始朗读
        this.uiManager.ttsManager.speak(text, {
            onStart: () => {
                ttsBtn.classList.add('speaking');
                ttsBtn.title = '停止朗读';
            },
            onEnd: () => {
                ttsBtn.classList.remove('speaking');
                ttsBtn.title = '朗读识别结果';
            },
            onError: (error) => {
                ttsBtn.classList.remove('speaking');
                ttsBtn.title = '朗读识别结果';
                this.uiManager.showNotification(error, 'error', 3000);
            }
        }).catch(error => {
            console.error('OCR TTS error:', error);
        });
    }

    // 移除自动初始化方法，改为按需加载机制

    // 加载平台的默认模型列表
    loadDefaultModelsForPlatform(platform, modelSelect, selectedModel) {
        const platformInfo = this.modelManager.getPlatformInfo(platform);
        if (platformInfo && platformInfo.defaultModels && platformInfo.defaultModels.length > 0) {
            modelSelect.innerHTML = '<option value="">请选择模型</option>';
            platformInfo.defaultModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                // 使用友好的模型显示名称
                const displayName = this.getModelDisplayName(model, platform);
                option.textContent = displayName;
                option.title = this.modelManager.getModelDescription(model) || `默认模型: ${displayName}`;
                modelSelect.appendChild(option);
            });

            // 恢复选择
            if (selectedModel) {
                const options = Array.from(modelSelect.options);
                const modelExists = options.some(option => option.value === selectedModel);
                if (modelExists) {
                    modelSelect.value = selectedModel;
                } else {
                    // 如果选择的模型不在默认列表中，添加它
                    const customOption = document.createElement('option');
                    customOption.value = selectedModel;
                    // 使用友好的模型显示名称
                    const displayName = this.getModelDisplayName(selectedModel, platform);
                    customOption.textContent = displayName;
                    customOption.title = '自定义模型';
                    customOption.selected = true;
                    modelSelect.appendChild(customOption);
                }
            }
        } else {
            // 如果没有默认模型，至少提供一个空选项
            modelSelect.innerHTML = '<option value="">暂无可用模型</option>';
            if (selectedModel) {
                const customOption = document.createElement('option');
                customOption.value = selectedModel;
                // 使用友好的模型显示名称
                const displayName = this.getModelDisplayName(selectedModel, platform);
                customOption.textContent = displayName;
                customOption.title = '自定义模型';
                customOption.selected = true;
                modelSelect.appendChild(customOption);
            }
        }
    }



    // 检查配置是否已修改
    checkConfigModified() {
        if (this.configModified) {
            this.uiManager.showConfigUnsaved();
        }
    }

    // 切换服务切换菜单显示状态
    toggleServiceSwitchMenu() {
        const menu = document.getElementById('service-switch-menu');

        if (!menu) return;

        // 检查菜单是否当前可见（通过show类判断）
        const isCurrentlyVisible = menu.classList.contains('show');

        if (isCurrentlyVisible) {
            // 当前显示，则隐藏
            this.hideServiceSwitchMenu();
        } else {
            // 当前隐藏，则显示
            const success = this.showServiceSwitchMenu();
            // 如果显示失败，确保状态正确
            if (!success) {
                this.hideServiceSwitchMenu();
            }
        }
    }

    // 显示服务切换菜单
    showServiceSwitchMenu() {
        const menu = document.getElementById('service-switch-menu');
        const button = document.getElementById('current-service');

        if (!menu || !button) {
            return false;
        }

        // 获取已配置的服务列表
        const availableServices = this.getAvailableServicesForMainInterface();

        if (availableServices.length === 0) {
            this.uiManager.showWarning('请先在配置页面设置OCR服务');
            return false;
        }

        // 即使只有一个服务也允许展开菜单，让用户看到当前配置的服务

        // 生成菜单项
        this.generateServiceMenuItems(availableServices);

        // 先显示菜单但设为透明，以便获取正确的尺寸
        menu.style.display = 'block';
        menu.classList.remove('show'); // 确保先移除show类

        // 计算菜单位置
        const buttonRect = button.getBoundingClientRect();
        menu.style.left = `${buttonRect.left}px`;

        // 现在可以获取正确的菜单高度了
        const menuHeight = menu.offsetHeight;
        const topPosition = buttonRect.top - menuHeight - 4;

        if (topPosition >= 0) {
            menu.style.top = `${topPosition}px`;
        } else {
            menu.style.top = `${buttonRect.bottom + 4}px`;
        }

        // 添加show类来显示菜单（触发CSS动画）
        setTimeout(() => {
            menu.classList.add('show');
        }, 10); // 短暂延迟确保位置计算完成
        button.classList.add('menu-open');

        return true;
    }

    // 隐藏服务切换菜单
    hideServiceSwitchMenu() {
        const menu = document.getElementById('service-switch-menu');
        const button = document.getElementById('current-service');

        if (menu) {
            menu.classList.remove('show'); // 移除show类触发隐藏动画
            // 等待动画完成后隐藏元素
            setTimeout(() => {
                menu.style.display = 'none';
            }, 300); // 与CSS动画时间一致
        }
        if (button) {
            button.classList.remove('menu-open');
        }


    }

    // 生成服务菜单项
    generateServiceMenuItems(services) {
        const menu = document.getElementById('service-switch-menu');
        const currentMode = this.currentRecognitionMode || 'text';
        const currentModeConfig = this.configManager.getRecognitionModeConfig(currentMode);

        menu.innerHTML = '';

        services.forEach(service => {
            const item = document.createElement('button');
            item.className = 'service-menu-item';

            // 创建图标容器
            const iconContainer = document.createElement('span');
            iconContainer.className = 'service-menu-icon';

            // 获取服务商图标
            const iconSvg = this.uiManager.getServiceIcon(service.value);
            if (iconSvg) {
                iconContainer.innerHTML = iconSvg;
            }

            // 创建文本容器
            const textContainer = document.createElement('span');
            textContainer.className = 'service-menu-text';

            // 显示完整模型名称（对于AI服务显示模型名称，传统OCR显示服务名称）
            // service.name 已经包含了友好名称，直接使用即可
            textContainer.textContent = service.name;

            // 组装菜单项
            item.appendChild(iconContainer);
            item.appendChild(textContainer);

            // 标记当前选中的服务和模型（基于当前识别模式的配置）
            let isCurrent = false;
            if (currentModeConfig && currentModeConfig.service === service.value) {
                // 对于传统OCR服务，只需要比较服务名称
                if (['baidu', 'tencent', 'aliyun'].includes(service.value)) {
                    isCurrent = true;
                } else {
                    // 对于AI服务，需要同时比较服务和模型
                    isCurrent = currentModeConfig.model === service.model;
                }
            }
            if (isCurrent) {
                item.classList.add('current');
            }

            // 添加点击事件
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.switchToServiceWithModel(service.value, service.model);
                this.hideServiceSwitchMenu();
            });

            menu.appendChild(item);
        });
    }

    // 获取已配置的可用服务列表（带缓存）
    getAvailableServices() {
        // 使用缓存避免频繁检查
        const cacheKey = 'availableServices';
        const cacheTimeout = 5000; // 5秒缓存
        const now = Date.now();

        if (this._serviceCache &&
            this._serviceCache[cacheKey] &&
            (now - this._serviceCache[cacheKey].timestamp) < cacheTimeout) {
            return this._serviceCache[cacheKey].data;
        }

        const services = [];

        // 检查百度OCR
        if (this.isServiceConfigured('baidu') && this.isServiceAvailable('baidu')) {
            services.push({ value: 'baidu', name: this.uiManager.getServiceShortName('baidu') });
        }

        // 检查腾讯OCR
        if (this.isServiceConfigured('tencent') && this.isServiceAvailable('tencent')) {
            services.push({ value: 'tencent', name: this.uiManager.getServiceShortName('tencent') });
        }

        // 检查阿里云OCR
        if (this.isServiceConfigured('aliyun') && this.isServiceAvailable('aliyun')) {
            services.push({ value: 'aliyun', name: this.uiManager.getServiceShortName('aliyun') });
        }

        // 检查火山引擎OCR
        if (this.isServiceConfigured('volcano') && this.isServiceAvailable('volcano')) {
            services.push({ value: 'volcano', name: this.uiManager.getServiceShortName('volcano') });
        }

        // 检查AI大模型服务 - 为每个模型创建单独的服务项
        const aiPlatforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'];
        aiPlatforms.forEach(platform => {
            if (this.isServiceConfigured(platform)) {
                const platformConfig = this.config[platform];
                const modelList = platformConfig?.modelList || [];

                if (modelList.length > 0) {
                    // 为每个可用模型创建一个服务项
                    modelList.forEach(modelId => {
                        const testStatus = this.getModelTestStatus(platform, modelId);
                        // 只包含测试成功或未测试的模型，排除测试失败的模型
                        if (testStatus === 'success' || testStatus === 'untested') {
                            services.push({
                                value: platform,
                                name: this.uiManager.getServiceShortName(platform),
                                model: modelId
                            });
                        }
                    });
                } else {
                    // 如果没有模型列表，使用传统的配置方式
                    const selectedModel = platformConfig ? (platformConfig.useCustomModel ? platformConfig.customModel : platformConfig.model) : null;
                    if (selectedModel) {
                        services.push({
                            value: platform,
                            name: this.uiManager.getServiceShortName(platform),
                            model: selectedModel
                        });
                    }
                }
            }
        });

        // 缓存结果
        if (!this._serviceCache) {
            this._serviceCache = {};
        }
        this._serviceCache[cacheKey] = {
            data: services,
            timestamp: now
        };

        return services;
    }

    // 清除服务缓存
    clearServiceCache() {
        this._serviceCache = {};
    }

    // 获取主界面可用服务列表（与配置页面保持数据同步）
    getAvailableServicesForMainInterface() {
        // 使用与配置页面相同的数据源
        const availableModels = this.getAvailableModelsForConfig();
        const services = [];
        const addedServices = new Set(); // 用于去重

        availableModels.forEach(model => {
            if (model.type === 'ocr') {
                // 传统OCR服务
                if (!addedServices.has(model.value)) {
                    services.push({
                        value: model.value,
                        name: model.name,
                        type: 'ocr'
                    });
                    addedServices.add(model.value);
                }
            } else {
                // AI模型服务
                const [platform, modelId] = model.value.split(':');
                const serviceKey = `${platform}:${modelId}`;

                if (!addedServices.has(serviceKey)) {
                    services.push({
                        value: platform,
                        name: model.name,
                        model: modelId,
                        type: 'ai'
                    });
                    addedServices.add(serviceKey);
                }
            }
        });

        return services;
    }

    // 获取所有可用OCR模型（包括测试状态过滤） - 使用统一状态管理器，按服务商顺序排序
    getAvailableModelsForConfig(visionOnly = true) {
        const models = [];

        // 获取服务商顺序配置
        const serviceOrder = this.configManager.getServiceOrder();

        // 按照配置的服务商顺序处理服务
        serviceOrder.forEach(serviceName => {
            // 处理传统OCR服务
            if (['native', 'baidu', 'tencent', 'aliyun', 'volcano'].includes(serviceName)) {
                if (this.isServiceConfigured(serviceName) && this.isServiceAvailable(serviceName)) {
                    models.push({
                        value: serviceName,
                        name: this.uiManager.getServiceShortName(serviceName),
                        type: 'ocr'
                    });
                }
            }
            // 注意：DeepLX和有道翻译是纯翻译服务，不支持OCR，因此不包含在OCR模型列表中
            // 处理AI模型服务（支持OCR的视觉模型）
            else if (['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'].includes(serviceName)) {
                const platformModels = this.getAvailableModelsForPlatform(serviceName, visionOnly);
                models.push(...platformModels);
            }
            // 处理自定义LLM服务商
            else if (serviceName && serviceName.startsWith('custom_')) {
                const platformModels = this.getAvailableModelsForPlatform(serviceName, visionOnly);
                models.push(...platformModels);
            }
        });

        return models;
    }

    // 获取所有可用服务（包括OCR和翻译服务） - 用于翻译模型配置等场景
    getAllAvailableServicesForConfig() {
        const models = [];

        // 获取服务商顺序配置
        const serviceOrder = this.configManager.getServiceOrder();

        // 按照配置的服务商顺序处理服务
        serviceOrder.forEach(serviceName => {
            // 处理传统OCR服务
            if (['baidu', 'tencent', 'aliyun'].includes(serviceName)) {
                if (this.isServiceConfigured(serviceName) && this.isServiceAvailable(serviceName)) {
                    models.push({
                        value: serviceName,
                        name: this.uiManager.getServiceShortName(serviceName),
                        type: 'ocr'
                    });
                }
            }
            // 处理传统翻译服务（DeepLX、有道翻译、火山引擎）
            else if (['volcano', 'deeplx', 'youdao'].includes(serviceName)) {
                if (this.isServiceConfigured(serviceName) && this.isServiceAvailable(serviceName)) {
                    models.push({
                        value: serviceName,
                        name: this.uiManager.getServiceShortName(serviceName),
                        type: 'translate'
                    });
                }
            }
            // 处理AI模型服务（支持OCR和翻译）
            else if (['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'].includes(serviceName)) {
                const platformModels = this.getAvailableModelsForPlatform(serviceName, false); // 翻译不需要视觉模型限制
                models.push(...platformModels);
            }
            // 处理自定义LLM服务商
            else if (serviceName && serviceName.startsWith('custom_')) {
                const platformModels = this.getAvailableModelsForPlatform(serviceName, false);
                models.push(...platformModels);
            }
        });

        return models;
    }

    // 获取指定平台的可用模型
    getAvailableModelsForPlatform(platform, visionOnly = true) {
        const models = [];
        const platformConfig = this.config[platform];

        // uTools和OCR Pro平台不需要API Key，其他平台需要
        const hasRequiredAuth = (platform === 'utools' || platform === 'ocrpro') ? true : (platformConfig && platformConfig.apiKey);

        if (!platformConfig || !hasRequiredAuth) {
            return models;
        }

        const modelList = platformConfig.modelList || [];
        if (modelList.length === 0) {
            return models;
        }

        // 从统一状态管理器获取平台模型状态
        const platformModelStates = this.modelStatusManager.getPlatformModelsStatus(platform);

        modelList.forEach(modelId => {
            // 检查模型状态：只包含成功状态或未知状态的模型，排除失败状态的模型
            const modelState = platformModelStates[modelId];
            let shouldInclude = !modelState || modelState.status === 'success' || modelState.status === 'unknown';

            // 如果需要只显示视觉模型，则使用能力标签进行筛选
            if (visionOnly && shouldInclude) {
                // 优先使用自定义能力
                const customCapabilities = platformConfig?.customCapabilities || {};
                let capabilities = [];

                if (customCapabilities[modelId] && Array.isArray(customCapabilities[modelId])) {
                    // 使用自定义能力
                    capabilities = customCapabilities[modelId];
                } else {
                    // 否则使用自动检测的能力
                    // 获取模型数据用于能力检测
                    let displayName = modelId;
                    if (platform === 'utools') {
                        const modelNameMap = platformConfig.modelNameMap || {};
                        displayName = modelNameMap[modelId] || modelId;
                    }
                    const modelData = {
                        name: displayName,
                        platform: platform
                    };

                    // 使用能力检测器检查是否支持视觉
                    if (window.modelCapabilityDetector) {
                        capabilities = window.modelCapabilityDetector.detectCapabilities(platform, modelId, modelData);
                    } else {
                        // 降级方案：使用原有的isVisionModel方法
                        if (this.isVisionModel(modelId, platform)) {
                            capabilities = ['vision'];
                        }
                    }
                }

                // 检查是否包含视觉能力
                shouldInclude = capabilities.includes('vision');
            }

            if (shouldInclude) {
                // 对于所有AI平台，尝试使用友好名称
                let displayName = modelId;
                const modelNameMap = platformConfig.modelNameMap || {};
                displayName = modelNameMap[modelId] || modelId;

                models.push({
                    value: `${platform}:${modelId}`,
                    name: displayName,
                    type: 'ai',
                    platform: platform,
                    modelId: modelId,
                    testStatus: modelState?.status || 'unknown'
                });
            }
        });

        return models;
    }

    // 检查服务是否可用（配置完整且连接正常）
    isServiceAvailable(serviceName) {
        // 首先检查是否配置完整
        if (!this.isServiceConfigured(serviceName)) {
            return false;
        }

        // 对于传统OCR服务和传统翻译服务，检查缓存的连接状态（现在采用永久存储策略）
        if (['native', 'baidu', 'tencent', 'aliyun', 'volcano', 'deeplx', 'youdao', 'baiduFanyi'].includes(serviceName)) {
            const cachedStatus = this.getCachedServiceStatus(serviceName);
            if (cachedStatus && cachedStatus.status) {
                // 只有状态为 'ready' 的服务才被认为是可用的
                // 失败状态会永久保存，直到配置变更或重新测试成功
                return cachedStatus.status.type === 'ready';
            }
            // 如果没有缓存状态，认为是未知状态，暂时认为可用（用户可以尝试使用）
            return true;
        }

        // 对于AI服务，检查是否有可用的模型
        const platformConfig = this.config[serviceName];
        if (!platformConfig) return false;

        const modelList = platformConfig.modelList || [];
        if (modelList.length === 0) return false;

        // 检查是否有至少一个测试成功或未测试的模型
        for (const modelId of modelList) {
            const status = this.getModelTestStatus(serviceName, modelId);
            if (status === 'success' || status === 'untested') {
                return true;
            }
        }

        // 所有模型都测试失败
        return false;
    }

    // 检查服务是否已配置 - 分层检查：基础配置 + 模型可用性
    isServiceConfigured(serviceName) {
        const serviceConfig = this.config[serviceName];
        if (!serviceConfig) {
            return false;
        }

        let result = false;

        switch (serviceName) {
            case 'native':
                // 本地主机OCR不需要API密钥，只需检查是否启用
                result = serviceConfig.enabled !== false;
                break;
            case 'baidu':
                result = !!(serviceConfig.apiKey && serviceConfig.secretKey);
                break;
            case 'tencent':
                result = !!(serviceConfig.secretId && serviceConfig.secretKey);
                break;
            case 'aliyun':
                result = !!(serviceConfig.accessKey && serviceConfig.accessSecret);
                break;
            case 'volcano':
                // 火山引擎需要Access Key和Secret Key
                result = !!(serviceConfig.accessKey && serviceConfig.secretKey);
                break;
            case 'deeplx':
                // DeepLX只需要API地址，访问令牌是可选的
                result = !!(serviceConfig.apiUrl);
                break;
            case 'youdao':
                // 有道翻译需要应用ID和应用密钥
                result = !!(serviceConfig.appKey && serviceConfig.appSecret);
                break;
            case 'baiduFanyi':
                // 百度翻译开放平台需要APP ID和密钥
                result = !!(serviceConfig.appId && serviceConfig.secretKey);
                break;
            case 'openai':
            case 'anthropic':
            case 'google':
            case 'alibaba':
            case 'bytedance':
            case 'zhipu':
            case 'custom':
                // 新逻辑：只检查API Key和模型列表，不要求必须有当前选中模型
                const hasApiKey = !!serviceConfig.apiKey;
                const hasAvailableModels = serviceConfig.modelList && serviceConfig.modelList.length > 0;
                result = hasApiKey && hasAvailableModels;
                break;
            case 'ocrpro':
            case 'utools':
                // OCR Pro和uTools平台不需要API Key，只检查是否有可用模型列表
                result = serviceConfig.modelList && serviceConfig.modelList.length > 0;
                break;
            default:
                // 自定义LLM服务商（custom_*）
                if (this.configManager && this.configManager.isCustomLLMProvider && this.configManager.isCustomLLMProvider(serviceName)) {
                    const hasCustomApiKey = !!serviceConfig.apiKey;
                    const hasCustomModels = serviceConfig.modelList && serviceConfig.modelList.length > 0;
                    result = hasCustomApiKey && hasCustomModels;
                } else {
                    result = false;
                }
        }

        return result;
    }

    // 检查是否有部分配置（用于判断是否需要记录配置问题）
    hasPartialConfig(serviceName, serviceConfig) {
        if (!serviceConfig) return false;

        switch (serviceName) {
            case 'baidu':
                return !!(serviceConfig.apiKey || serviceConfig.secretKey);
            case 'tencent':
                return !!(serviceConfig.secretId || serviceConfig.secretKey);
            case 'aliyun':
                return !!(serviceConfig.accessKey || serviceConfig.accessSecret);
            case 'deeplx':
                return !!(serviceConfig.apiUrl || serviceConfig.accessToken);
            case 'youdao':
                return !!(serviceConfig.appKey || serviceConfig.appSecret);
            case 'baiduFanyi':
                return !!(serviceConfig.appId || serviceConfig.secretKey);
            case 'openai':
            case 'anthropic':
            case 'google':
            case 'alibaba':
            case 'bytedance':
            case 'zhipu':
            case 'custom':
                return !!(serviceConfig.apiKey || serviceConfig.model || serviceConfig.customModel);
            case 'utools':
                return !!(serviceConfig.model || (serviceConfig.modelList && serviceConfig.modelList.length > 0));
            default:
                return false;
        }
    }

    // 切换到指定服务（带模型信息） - 集成统一状态管理
    async switchToServiceWithModel(serviceName, model = null) {
        // 获取当前识别模式
        const currentMode = this.currentRecognitionMode || 'text';

        // 如果没有传递模型信息，尝试从配置中获取
        if (!model && ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'utools', 'custom'].includes(serviceName)) {
            const serviceConfig = this.config[serviceName];
            if (serviceConfig) {
                model = serviceConfig.useCustomModel ? serviceConfig.customModel : serviceConfig.model;
            }
        }

        // 更新当前识别模式的配置
        const modeConfigResult = this.configManager.setRecognitionModeConfig(currentMode, serviceName, model);
        if (modeConfigResult.success) {
            this.config = modeConfigResult.config;
        }

        // 更新全局配置
        this.config.service = serviceName;

        // 立即保存配置
        const result = this.configManager.saveConfig(this.config);
        if (result.success) {
            this.config = result.config;
            // 清除配置修改标记
            this.clearConfigModified();

            // 使用新的统一状态管理系统
            this.updateMainPageStatus();

            // 同步基础配置页面的模型选择显示
            if (this.uiManager.currentView === 'config') {
                this.uiManager.loadRecognitionModeConfig(currentMode);
            }

            // 如果当前在配置页面，同步配置界面的服务选择
            if (this.uiManager.currentView === 'config') {
                const serviceSelect = document.getElementById('ocr-service');
                if (serviceSelect && serviceSelect.value !== serviceName) {
                    serviceSelect.value = serviceName;
                }

                // 检查是否在模型服务页面，如果是则不要覆盖存储的选择
                const modelServicePage = document.getElementById('model-service-page');
                const isInModelServicePage = modelServicePage && modelServicePage.style.display !== 'none';

                if (!isInModelServicePage) {
                    // 只有不在模型服务页面时才更新服务列表选中状态
                    this.uiManager.updateServiceListSelection(serviceName);
                }

                // 切换到对应的配置区域
                this.uiManager.switchConfigSection(serviceName);

                // 如果是AI服务，还需要同步平台配置
                if (['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'].includes(serviceName)) {
                    // 确保AI平台配置正确加载
                    this.loadAIPlatformConfigs();
                }
            }
        } else {
            this.uiManager.showError('服务切换失败: ' + result.error);
        }
    }

    // 切换到指定服务（兼容旧接口）
    async switchToService(serviceName) {
        return await this.switchToServiceWithModel(serviceName);
    }

    // 添加配置字段监听器的通用方法
    addConfigFieldListeners(fieldIds, events = ['input', 'change']) {
        fieldIds.forEach(fieldId => {
            const field = this.getElement(fieldId);
            if (field) {
                events.forEach(event => {
                    field.addEventListener(event, () => this.markConfigAsModified());
                });
            }
        });
    }

    // 设置配置字段修改监听
    setupConfigFieldListeners() {
        // 百度OCR配置字段
        this.addConfigFieldListeners(['baidu-api-key', 'baidu-secret-key']);

        // 百度翻译配置字段
        this.addConfigFieldListeners(['baidu-translate-api-key', 'baidu-translate-secret-key']);

        // 添加专门的AppID调试监听器
        const appIdField = document.getElementById('baidu-translate-app-id');
        if (appIdField) {
            ['input', 'change', 'blur'].forEach(event => {
                appIdField.addEventListener(event, () => {
                    this.markConfigAsModified();
                });
            });
        }

        // 腾讯OCR配置字段
        this.addConfigFieldListeners(['tencent-secret-id', 'tencent-secret-key'], ['input']);

        // 阿里云OCR配置字段
        this.addConfigFieldListeners(['aliyun-access-key', 'aliyun-access-secret'], ['input']);

        // 火山引擎OCR配置字段
        this.addConfigFieldListeners(['volcano-access-key', 'volcano-secret-key'], ['input']);

        // DeepLX配置字段
        this.addConfigFieldListeners(['deeplx-api-url', 'deeplx-access-token'], ['input']);

        // 有道翻译配置字段
        this.addConfigFieldListeners(['youdao-app-key', 'youdao-app-secret', 'youdao-vocab-id'], ['input']);

        // 百度翻译开放平台配置字段
        this.addConfigFieldListeners(['baiduFanyi-app-id', 'baiduFanyi-secret-key'], ['input']);

        // AI平台配置字段（只绑定实际存在的字段）
        const platforms = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'];
        platforms.forEach(platform => {
            // 只绑定基础的API Key和Base URL字段，这些字段在HTML中确实存在
            const fields = [`${platform}-api-key`, `${platform}-base-url`];

            // 过滤掉不存在的字段，避免控制台警告
            const existingFields = fields.filter(fieldId => document.getElementById(fieldId));
            if (existingFields.length > 0) {
                this.addConfigFieldListeners(existingFields);
            }
        });
    }



    // 检测服务状态
    async checkServiceStatus(serviceName, forceCheck = false, showMessage = false) {
        try {
            // 使用已保存的配置而不是DOM配置
            const currentConfig = { ...this.config };
            currentConfig.service = serviceName;

            // 生成当前服务特定的配置哈希值（只包含该服务相关的配置）
            const currentServiceConfigHash = this.generateServiceConfigHash(serviceName, currentConfig);

            // 如果不是强制检查，尝试使用缓存（传统OCR服务现在也采用永久存储策略）
            if (!forceCheck) {
                const cachedStatus = this.getCachedServiceStatus(serviceName);
                if (cachedStatus && cachedStatus.serviceConfigHash === currentServiceConfigHash) {
                    // 配置未变化，使用缓存状态（永久有效，与AI模型服务保持一致）
                    this.uiManager.updateRecognitionStatus(cachedStatus.status.type, cachedStatus.status.message);

                    // 如果需要显示消息（如切换服务），显示成功消息
                    if (showMessage && cachedStatus.status.type === 'ready') {
                        this.uiManager.showServiceSwitched(serviceName, null);
                    }

                    // 更新配置页面的状态指示器
                    this.uiManager.updateConfigServiceStatus(serviceName, cachedStatus.status.type);
                    return;
                }

                // 如果有缓存但配置哈希值不匹配，说明该服务的配置发生了变化
                // 将重新检测状态（与AI模型服务保持一致的逻辑）
            }

            // 显示检测中状态
            this.uiManager.updateRecognitionStatus('processing', '检测中');

            // 验证配置完整性
            const validation = this.configManager.validateConfig(currentConfig);
            if (!validation.valid) {
                // 检查是否是未配置的情况
                const isConfigured = this.isServiceConfigured(serviceName);
                const status = isConfigured ?
                    { type: 'error', message: '连接失败' } :
                    { type: 'unconfigured', message: '未配置' };

                this.uiManager.updateRecognitionStatus(status.type, status.message);
                this.setCachedServiceStatus(serviceName, status, null, currentServiceConfigHash);

                // 更新配置页面的状态指示器
                this.uiManager.updateConfigServiceStatus(serviceName, status.type);
                return;
            }

            // 测试连接
            const connectionTest = await this.testServiceConnection(serviceName, currentConfig);

            let status;
            if (connectionTest.success) {
                status = { type: 'ready', message: '就绪' };
                this.uiManager.updateRecognitionStatus(status.type, status.message);
                // 显示状态检测成功消息
                if (forceCheck || showMessage) {
                    this.uiManager.showStatusResult(this.uiManager.getServiceDisplayName(serviceName), 'success');
                }
            } else {
                status = { type: 'error', message: '连接失败' };
                this.uiManager.updateRecognitionStatus(status.type, status.message);
                // 显示状态检测失败消息
                if (forceCheck || showMessage) {
                    this.uiManager.showStatusResult(this.uiManager.getServiceDisplayName(serviceName), 'error', connectionTest.error);
                }
            }

            // 缓存状态结果（永久存储，与AI模型服务保持一致）
            // 成功状态将持久保存，只有在配置变更或连接失败时才更新
            this.setCachedServiceStatus(serviceName, status, null, currentServiceConfigHash);

            // 更新配置页面的状态指示器
            this.uiManager.updateConfigServiceStatus(serviceName, status.type);

        } catch (error) {
            console.error('检测服务状态失败:', error);
            const status = { type: 'error', message: '检测失败' };
            this.uiManager.updateRecognitionStatus(status.type, status.message);
            const serviceConfigHash = this.generateServiceConfigHash(serviceName, this.config);
            this.setCachedServiceStatus(serviceName, status, null, serviceConfigHash);

            // 更新配置页面的状态指示器
            this.uiManager.updateConfigServiceStatus(serviceName, status.type);
        }
    }

    // 测试服务连接
    async testServiceConnection(serviceName, config, isTranslateTest = false) {
        try {
            // 根据测试类型和服务名称决定测试方式
            // deeplx、youdao和baiduFanyi只有翻译功能，volcano既有OCR也有翻译功能
            const shouldUseTranslateTest = isTranslateTest || ['deeplx', 'youdao', 'baiduFanyi'].includes(serviceName);

            if (shouldUseTranslateTest) {
                const serviceConfig = this.configManager.getTraditionalTranslateConfig(serviceName);

                if (!serviceConfig) {
                    return { success: false, error: '服务配置不完整' };
                }

                const result = await this.ocrServices.testTraditionalTranslateConnection(serviceName, serviceConfig);
                return result;
            }

            // 对于OCR服务，使用OCR测试
            // 创建一个简单的测试图片（白底黑字"TEST"）
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, 100, 50);
            ctx.fillStyle = 'black';
            ctx.font = '16px Arial';
            ctx.fillText('TEST', 30, 30);
            const testImageBase64 = canvas.toDataURL('image/png');

            // 使用与实际OCR识别相同的配置处理方法
            const serviceConfig = this.configManager.getServiceConfig(config);

            const result = await this.ocrServices.performOCR(testImageBase64, serviceName, serviceConfig);
            return result;
        } catch (error) {
            console.error('测试服务连接失败:', error);
            return { success: false, error: error.message };
        }
    }

    // 判断是否是连接错误
    isConnectionError(errorMessage) {
        if (!errorMessage) return false;

        const connectionErrorKeywords = [
            'network', 'connection', 'timeout', 'failed to fetch',
            'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT',
            '网络', '连接', '超时', '无法连接',
            'API key', 'unauthorized', '401', '403',
            'quota', 'limit', 'exceeded'
        ];

        const lowerError = errorMessage.toLowerCase();
        return connectionErrorKeywords.some(keyword =>
            lowerError.includes(keyword.toLowerCase())
        );
    }

    // 统一的存储读取方法（优化版本）
    getStorageItem(key) {
        try {
            // 使用统一存储管理器（如果可用）
            if (typeof window !== 'undefined' && window.unifiedStorage) {
                const result = window.unifiedStorage.getItem(key);
                return result;
            }

            // 后备方案：优先使用uTools的dbStorage，如果不可用则回退到localStorage
            if (typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.getItem) {
                return utools.dbStorage.getItem(key);
            } else {
                const stored = localStorage.getItem(key);
                try {
                    return stored ? JSON.parse(stored) : stored;
                } catch (e) {
                    return stored;
                }
            }
        } catch (error) {
            return null;
        }
    }

    // 统一的存储写入方法（优化版本）
    setStorageItem(key, value) {
        try {
            // 使用统一存储管理器（如果可用）
            if (typeof window !== 'undefined' && window.unifiedStorage) {
                const result = window.unifiedStorage.setItem(key, value);
                return result;
            }

            // 后备方案：优先使用uTools的dbStorage，如果不可用则回退到localStorage
            if (typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.setItem) {
                utools.dbStorage.setItem(key, value);
                return true;
            } else {
                const dataToStore = typeof value === 'string' ? value : JSON.stringify(value);
                localStorage.setItem(key, dataToStore);
                return true;
            }
        } catch (error) {
            return false;
        }
    }

    // 统一的存储删除方法
    removeStorageItem(key) {
        try {
            // 使用统一存储管理器（如果可用）
            if (typeof window !== 'undefined' && window.unifiedStorage) {
                const result = window.unifiedStorage.removeItem(key);
                return result;
            }

            // 后备方案
            if (typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.removeItem) {
                utools.dbStorage.removeItem(key);
                return true;
            } else {
                localStorage.removeItem(key);
                return true;
            }
        } catch (error) {
            return false;
        }
    }

    // 加载服务状态缓存
    loadServiceStatusCache() {
        try {
            const cached = this.getStorageItem('ocr_service_status_cache');
            if (cached) {
                // uTools的dbStorage可能直接返回对象，localStorage返回字符串
                return typeof cached === 'string' ? JSON.parse(cached) : cached;
            }
            return {};
        } catch (error) {
            return {};
        }
    }

    // 获取标准化的服务配置
    getStandardServiceConfig(serviceName, config) {
        const configBuilders = {
            baidu: () => this.buildTraditionalOCRConfig(config.baidu, ['apiKey', 'secretKey']),
            tencent: () => this.buildTraditionalOCRConfig(config.tencent, ['secretId', 'secretKey']),
            aliyun: () => this.buildTraditionalOCRConfig(config.aliyun, ['accessKey', 'accessSecret']),
            volcano: () => this.buildTraditionalOCRConfig(config.volcano, ['accessKey', 'secretKey']),
            deeplx: () => this.buildTraditionalOCRConfig(config.deeplx, ['apiUrl', 'accessToken']),
            youdao: () => this.buildTraditionalOCRConfig(config.youdao, ['appKey', 'appSecret']),
            ocrpro: () => this.buildOcrProConfig(config.ocrpro),
            utools: () => this.buildAIPlatformConfig(config.utools, false),
            bytedance: () => this.buildByteDanceConfig(config.bytedance),
            default: () => this.buildAIPlatformConfig(config[serviceName], true)
        };

        const builder = configBuilders[serviceName] || configBuilders.default;
        return builder();
    }

    // 构建传统OCR配置
    buildTraditionalOCRConfig(serviceConfig = {}, fields) {
        const config = {};
        fields.forEach(field => {
            config[field] = serviceConfig[field] || '';
        });
        return config;
    }

    // 构建OCR Pro配置
    buildOcrProConfig(platformConfig = {}) {
        return {
            platform: 'ocrpro', // 明确设置平台为ocrpro
            model: platformConfig.model || 'gemini-2.5-flash',
            useCustomModel: platformConfig.useCustomModel || false,
            customModel: platformConfig.customModel || '',
            maxTokens: platformConfig.maxTokens || 1000,
            // OCR Pro使用预设凭证
            apiKey: 'sk-lvDbg9jGPK1CJfPVmSTb4Fp7GFNrp87MS3j2ziyIVTOO0cCX',
            baseUrl: 'https://api.jlws.top'
        };
    }

    // 构建火山引擎配置
    buildByteDanceConfig(platformConfig = {}) {
        return {
            model: platformConfig.model || '',
            useCustomModel: platformConfig.useCustomModel || false,
            customModel: platformConfig.customModel || '',
            maxTokens: platformConfig.maxTokens || 0,
            apiKey: platformConfig.apiKey || '',
            baseUrl: platformConfig.baseUrl || '',
            accessKey: platformConfig.accessKey || '',
            secretKey: platformConfig.secretKey || ''
        };
    }

    // 构建AI平台配置
    buildAIPlatformConfig(platformConfig = {}, includeApiKey = true) {
        const config = {
            model: platformConfig.model || '',
            useCustomModel: platformConfig.useCustomModel || false,
            customModel: platformConfig.customModel || '',
            maxTokens: platformConfig.maxTokens || 0
        };

        if (includeApiKey) {
            config.apiKey = platformConfig.apiKey || '';
            config.baseUrl = platformConfig.baseUrl || '';
        }

        return config;
    }

    // 通用哈希生成方法
    generateHash(obj) {
        const configStr = JSON.stringify(obj, Object.keys(obj).sort());
        let hash = 0;
        for (let i = 0; i < configStr.length; i++) {
            const char = configStr.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    // 生成特定服务的配置哈希值
    generateServiceConfigHash(serviceName, config) {
        const serviceConfig = this.getStandardServiceConfig(serviceName, config);
        return this.generateHash(serviceConfig);
    }

    // 生成全局配置哈希值
    generateConfigHash(config) {
        const stableConfig = { service: config.service || '' };
        const allServices = ['baidu', 'tencent', 'aliyun', 'volcano', 'openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'ocrpro', 'utools'];

        allServices.forEach(serviceName => {
            stableConfig[serviceName] = this.getStandardServiceConfig(serviceName, config);
        });

        return this.generateHash(stableConfig);
    }

    // 检查配置是否变化
    hasConfigChanged(config) {
        const currentHash = this.generateConfigHash(config);

        if (this.lastConfigHash !== currentHash) {
            const changed = this.lastConfigHash !== null;
            this.lastConfigHash = currentHash;
            return changed;
        }
        return false;
    }

    // 获取缓存的服务状态
    getCachedServiceStatus(serviceName) {
        return this.serviceStatusCache[serviceName] || null;
    }

    // 设置缓存的服务状态
    setCachedServiceStatus(serviceName, status, configHash = null, serviceConfigHash = null) {
        const finalServiceConfigHash = serviceConfigHash || this.generateServiceConfigHash(serviceName, this.config);
        const finalConfigHash = configHash || this.generateConfigHash(this.config);

        this.serviceStatusCache[serviceName] = {
            status: status,
            timestamp: Date.now(),
            configHash: finalConfigHash,
            serviceConfigHash: finalServiceConfigHash
        };

        this.saveServiceStatusCache();
    }

    // 保存服务状态缓存
    saveServiceStatusCache() {
        try {
            // uTools的dbStorage可以直接存储对象，localStorage需要JSON序列化
            const isUToolsStorage = typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.setItem;
            const dataToStore = isUToolsStorage ? this.serviceStatusCache : JSON.stringify(this.serviceStatusCache);

            this.setStorageItem('ocr_service_status_cache', dataToStore);
        } catch (error) {
            // 忽略存储保存失败
        }
    }

    // 检测配置变化的服务
    detectChangedServices(oldConfig, newConfig) {
        const changedServices = [];
        const allServices = ['baidu', 'tencent', 'aliyun', 'volcano', 'deeplx', 'youdao', 'baiduFanyi', 'openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'ocrpro', 'utools'];

        allServices.forEach(serviceName => {
            const oldServiceHash = this.generateServiceConfigHash(serviceName, oldConfig);
            const newServiceHash = this.generateServiceConfigHash(serviceName, newConfig);

            if (oldServiceHash !== newServiceHash) {
                changedServices.push(serviceName);
            }
        });

        return changedServices;
    }

    // 清除服务状态缓存
    clearServiceStatusCache(serviceName = null) {
        if (serviceName) {
            delete this.serviceStatusCache[serviceName];
        } else {
            this.serviceStatusCache = {};
        }

        this.saveServiceStatusCache();
    }

    // 获取当前识别模式
    // 切换到LLM服务
    switchToLLMService(platform, model) {
        // 更新配置 - 使用新的配置结构
        this.config.service = platform;

        // 确保平台配置存在
        if (!this.config[platform]) {
            this.config[platform] = {};
        }
        this.config[platform].model = model;

        // 保存配置
        this.saveConfig();

        // 更新UI
        this.uiManager.updateCurrentService(platform, model);

        // 使用新的统一状态管理系统
        this.updateMainPageStatus();
    }

    // 切换到指定服务
    switchToService(serviceName) {
        this.config.service = serviceName;
        this.saveConfigSimple();

        // 更新UI
        this.uiManager.updateCurrentService(serviceName, serviceName);

        // 使用新的统一状态管理系统
        this.updateMainPageStatus();
    }

    // 简单保存配置（内部使用）
    saveConfigSimple() {
        const result = this.configManager.saveConfig(this.config);
        if (!result.success) {
            this.uiManager.showError('保存配置失败: ' + result.error);
        } else {
            // 同步内存配置
            this.config = result.config;
            // 清除服务缓存
            this.clearServiceCache();
        }
        return result;
    }



    // 显示获取模型弹窗（按需加载机制）
    async showFetchModelsModal(platform) {
        this.currentPlatform = platform;
        const modal = document.getElementById('fetch-models-modal');
        const loadingDiv = document.getElementById('fetch-models-loading');
        const listDiv = document.getElementById('fetch-models-list');
        const errorDiv = document.getElementById('fetch-models-error');

        // 显示弹窗
        modal.style.display = 'flex';

        // 优先使用缓存的模型列表（统一存储管理器）
        const cachedModels = this.getStoredPlatformModels(platform);
        if (cachedModels && cachedModels.length > 0) {

            // 直接显示缓存的模型列表
            loadingDiv.style.display = 'none';
            errorDiv.style.display = 'none';
            this.renderFetchModelsList(cachedModels);
            listDiv.style.display = 'block';
            return;
        }

        // 首次加载：显示加载状态并获取模型列表

        loadingDiv.style.display = 'block';
        listDiv.style.display = 'none';
        errorDiv.style.display = 'none';

        try {
            let apiKey, baseUrl, models;

            // OCR Pro特殊处理：使用预设凭证
            if (platform === 'ocrpro') {
                // 直接获取OCR Pro的预设模型列表
                models = await this.modelManager.getModels(platform, null, null);
            } else if (platform === 'bytedance') {
                // 火山引擎特殊处理：优先使用新API配置
                const accessKey = this.getElementValue('bytedance-access-key');
                const secretKey = this.getElementValue('bytedance-secret-key');
                apiKey = this.getElementValue('bytedance-api-key');
                baseUrl = this.getElementValue('bytedance-base-url');

                // 检查配置完整性 - 必须有至少一种认证方式
                const hasNewApiConfig = accessKey && secretKey;
                const hasLegacyApiConfig = apiKey;

                if (!hasNewApiConfig && !hasLegacyApiConfig) {
                    throw new Error('BYTEDANCE_CONFIG_MISSING');
                }

                // 优先使用新API配置（Access Key/Secret Key）

                // 获取模型列表（按需加载，不强制刷新）
                models = await this.modelManager.getModels(platform, apiKey, baseUrl, false);
            } else {
                // 其他平台的配置处理
                apiKey = this.getElementValue(`${platform}-api-key`);
                baseUrl = this.getElementValue(`${platform}-base-url`);

                if (!apiKey && platform !== 'utools') {
                    throw new Error('请先配置API Key');
                }

                // 获取模型列表（按需加载，不强制刷新）
                models = await this.modelManager.getModels(platform, apiKey, baseUrl, false);
            }

            // 隐藏加载状态
            loadingDiv.style.display = 'none';

            if (models && models.length > 0) {

                this.renderFetchModelsList(models);
                listDiv.style.display = 'block';

                // 显示成功提示 - 使用友好的服务商名称
                const platformDisplayName = this.uiManager.getServiceDisplayName(platform);
                this.uiManager.showStatusResult(`${platformDisplayName} 模型列表`, 'success', `成功获取 ${models.length} 个可用模型`);
            } else {
                errorDiv.innerHTML = '未获取到可用模型，请检查API配置或网络连接';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            console.error(`[按需加载] 获取 ${platform} 模型列表失败:`, error);
            loadingDiv.style.display = 'none';

            // 生成用户友好的错误信息
            const userFriendlyMessage = this.generateUserFriendlyErrorMessage(platform, error);
            errorDiv.innerHTML = userFriendlyMessage;
            errorDiv.style.display = 'block';
        }
    }

    // 生成用户友好的错误信息
    generateUserFriendlyErrorMessage(platform, error) {
        const errorMessage = error.message || '';

        // 火山引擎特殊错误处理
        if (platform === 'bytedance') {
            if (errorMessage.includes('BYTEDANCE_CONFIG_MISSING')) {
                return `
                    <div class="error-message">
                        <div class="error-title">🔑 火山引擎配置不完整</div>
                        <div class="error-content">
                            <p>请配置以下任一组合：</p>
                            <ul>
                                <li><strong>推荐方式</strong>：Access Key + Secret Key（新API，功能更完整）</li>
                                <li><strong>备用方式</strong>：API Key（旧API，兼容性方式）</li>
                            </ul>
                            <p class="error-tip">💡 建议使用新API方式以获得最佳体验</p>
                        </div>
                    </div>
                `;
            }

            if (errorMessage.includes('BYTEDANCE_AUTH_ERROR')) {
                return `
                    <div class="error-message">
                        <div class="error-title">🔐 火山引擎认证失败</div>
                        <div class="error-content">
                            <p>Access Key 或 Secret Key 配置有误，请检查：</p>
                            <ul>
                                <li>Access Key 是否正确填写</li>
                                <li>Secret Key 是否正确填写</li>
                                <li>密钥是否已过期或被禁用</li>
                                <li>账户是否有访问火山引擎API的权限</li>
                            </ul>
                            <p class="error-tip">💡 请前往火山引擎控制台检查密钥配置</p>
                        </div>
                    </div>
                `;
            }

            if (errorMessage.includes('BYTEDANCE_NETWORK_ERROR')) {
                return `
                    <div class="error-message">
                        <div class="error-title">🌐 网络连接失败</div>
                        <div class="error-content">
                            <p>无法连接到火山引擎服务，请检查：</p>
                            <ul>
                                <li>网络连接是否正常</li>
                                <li>是否需要配置代理</li>
                                <li>防火墙是否阻止了连接</li>
                                <li>火山引擎服务是否正常运行</li>
                            </ul>
                            <p class="error-tip">💡 稍后重试或检查网络设置</p>
                        </div>
                    </div>
                `;
            }

            if (errorMessage.includes('BYTEDANCE_API_ERROR')) {
                return `
                    <div class="error-message">
                        <div class="error-title">⚠️ 火山引擎API错误</div>
                        <div class="error-content">
                            <p>调用火山引擎API时发生错误：</p>
                            <p><code>${errorMessage.replace('BYTEDANCE_API_ERROR: ', '')}</code></p>
                            <p>建议操作：</p>
                            <ul>
                                <li>检查API配置是否正确</li>
                                <li>稍后重试</li>
                                <li>如果问题持续，请联系技术支持</li>
                            </ul>
                        </div>
                    </div>
                `;
            }

            if (errorMessage.includes('Access Key') || errorMessage.includes('Secret Key')) {
                return `
                    <div class="error-message">
                        <div class="error-title">🔐 Access Key 或 Secret Key 错误</div>
                        <div class="error-content">
                            <p>请检查火山引擎控制台中的 Access Key 和 Secret Key 配置：</p>
                            <ul>
                                <li>确保 Access Key 和 Secret Key 正确无误</li>
                                <li>检查账户是否有模型访问权限</li>
                                <li>确认密钥未过期或被禁用</li>
                            </ul>
                        </div>
                    </div>
                `;
            }

            if (errorMessage.includes('API Key') || errorMessage.includes('Bearer')) {
                return `
                    <div class="error-message">
                        <div class="error-title">🔑 API Key 配置错误</div>
                        <div class="error-content">
                            <p>请检查火山引擎 API Key 配置：</p>
                            <ul>
                                <li>确保 API Key 格式正确</li>
                                <li>检查 API Key 是否有效且未过期</li>
                                <li>验证账户权限是否足够</li>
                            </ul>
                            <p class="error-tip">💡 也可以尝试配置 Access Key + Secret Key 使用新API</p>
                        </div>
                    </div>
                `;
            }

            if (errorMessage.includes('签名') || errorMessage.includes('Signature')) {
                return `
                    <div class="error-message">
                        <div class="error-title">✍️ API 签名验证失败</div>
                        <div class="error-content">
                            <p>请检查以下配置：</p>
                            <ul>
                                <li>Access Key 和 Secret Key 是否正确</li>
                                <li>系统时间是否准确（签名对时间敏感）</li>
                                <li>网络连接是否稳定</li>
                            </ul>
                        </div>
                    </div>
                `;
            }
        }

        // 通用错误处理
        if (errorMessage.includes('网络') || errorMessage.includes('Network') || errorMessage.includes('fetch')) {
            return `
                <div class="error-message">
                    <div class="error-title">🌐 网络连接失败</div>
                    <div class="error-content">
                        <p>请检查网络设置：</p>
                        <ul>
                            <li>确保网络连接正常</li>
                            <li>检查防火墙或代理设置</li>
                            <li>验证API服务地址是否可访问</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        if (errorMessage.includes('权限') || errorMessage.includes('Permission') || errorMessage.includes('Unauthorized')) {
            return `
                <div class="error-message">
                    <div class="error-title">🚫 API权限不足</div>
                    <div class="error-content">
                        <p>请检查账户权限设置：</p>
                        <ul>
                            <li>确认API密钥有模型访问权限</li>
                            <li>检查账户余额是否充足</li>
                            <li>验证服务是否已正确开通</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        if (errorMessage.includes('API Key')) {
            return `
                <div class="error-message">
                    <div class="error-title">🔑 API Key 配置问题</div>
                    <div class="error-content">
                        <p>请检查 API Key 配置是否正确</p>
                    </div>
                </div>
            `;
        }

        // 默认错误信息
        return `
            <div class="error-message">
                <div class="error-title">❌ 获取模型列表失败</div>
                <div class="error-content">
                    <p>错误详情：${errorMessage}</p>
                    <p>请检查配置或联系技术支持</p>
                </div>
            </div>
        `;
    }

    // 渲染获取到的模型列表
    renderFetchModelsList(models) {
        const listDiv = document.getElementById('fetch-models-list');
        const platform = this.currentPlatform;
        const addedModels = this.config[platform]?.modelList || [];

        // 获取服务图标
        const iconSvg = this.uiManager.getServiceIcon(platform);

        listDiv.innerHTML = models.map(model => {
            // 对于uTools平台，始终使用model.id作为唯一标识符
            const modelId = model.id;
            const displayName = model.name || model.id;
            const isAdded = addedModels.includes(modelId);
            const itemClass = isAdded ? 'fetch-model-item added' : 'fetch-model-item';

            // 创建图标HTML，参考翻译模型选择弹窗的实现
            let iconHtml = '';
            if (iconSvg) {
                iconHtml = `<div class="model-icon" style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${iconSvg}</div>`;
            }

            // 获取模型能力并生成功能图标
            // 优先使用模型对象中已计算的能力信息
            const capabilities = model.capabilities || this.uiManager.getModelCapabilities(platform, modelId, {
                name: model.name,
                label: model.label,
                realProvider: model.realProvider
            });
            const capabilityIconsHtml = this.uiManager.generateCapabilityIcons(capabilities);

            if (isAdded) {
                // 已添加的模型显示删除按钮
                return `
                    <div class="${itemClass}">
                        <div class="fetch-model-name" style="display: flex; align-items: center; gap: 12px;">
                            ${iconHtml}
                            <span style="flex: 1;">${displayName}</span>
                            ${capabilityIconsHtml}
                        </div>
                        <button type="button" class="remove-model-btn" onclick="window.ocrPlugin.removeModelFromFetch('${modelId}')" title="从列表中移除">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14"/>
                            </svg>
                        </button>
                    </div>
                `;
            } else {
                // 未添加的模型显示添加按钮
                return `
                    <div class="${itemClass}">
                        <div class="fetch-model-name" style="display: flex; align-items: center; gap: 12px;">
                            ${iconHtml}
                            <span style="flex: 1;">${displayName}</span>
                            ${capabilityIconsHtml}
                        </div>
                        <button type="button" class="add-model-btn" onclick="window.ocrPlugin.addModelFromFetch('${modelId}')" title="添加到列表">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14"/>
                                <path d="M12 5v14"/>
                            </svg>
                        </button>
                    </div>
                `;
            }
        }).join('');
    }

    // 从获取列表中添加模型
    addModelFromFetch(modelId) {
        const success = this.addModelToList(this.currentPlatform, modelId);
        if (success) {
            // 重新渲染弹窗列表以更新按钮状态
            const storedModels = this.getStoredPlatformModels(this.currentPlatform);
            if (storedModels && storedModels.length > 0) {
                this.renderFetchModelsList(storedModels);
            }
            // 使用友好的模型显示名称
            const displayName = this.getModelDisplayName(modelId, this.currentPlatform);
            this.uiManager.showNotification(`模型 ${displayName} 已添加`);
        }
    }

    // 从获取列表中移除模型
    removeModelFromFetch(modelId) {
        this.deleteModel(this.currentPlatform, modelId);
        // 重新渲染弹窗列表以更新按钮状态
        const storedModels = this.getStoredPlatformModels(this.currentPlatform);
        if (storedModels && storedModels.length > 0) {
            this.renderFetchModelsList(storedModels);
        }
    }

    // 隐藏获取模型弹窗
    hideFetchModelsModal() {
        const modal = document.getElementById('fetch-models-modal');
        modal.style.display = 'none';
        this.currentPlatform = null;
    }

    // 显示添加模型弹窗
    showAddModelModal(platform) {
        this.currentPlatform = platform;
        const modal = document.getElementById('add-model-modal');
        const modelIdInput = document.getElementById('add-model-input');
        const modelNameInput = document.getElementById('add-model-name-input');
        const textBtn = document.getElementById('add-capability-text');
        const visionBtn = document.getElementById('add-capability-vision');
        const reasoningBtn = document.getElementById('add-capability-reasoning');

        if (!modal || !modelIdInput || !modelNameInput || !textBtn || !visionBtn || !reasoningBtn) {
            console.error('添加模型弹窗元素未找到');
            this.uiManager.showError('无法打开添加模型弹窗');
            return;
        }

        // 清空输入框
        modelIdInput.value = '';
        modelNameInput.value = '';

        // 重置所有能力按钮状态：文本能力默认选中，其他未选中
        textBtn.classList.remove('selected');
        visionBtn.classList.remove('selected');
        reasoningBtn.classList.remove('selected');

        // 添加按钮点击事件（移除旧的事件监听器）
        const toggleCapability = (btn) => {
            btn.classList.toggle('selected');
        };

        // 移除旧的事件监听器
        textBtn.replaceWith(textBtn.cloneNode(true));
        visionBtn.replaceWith(visionBtn.cloneNode(true));
        reasoningBtn.replaceWith(reasoningBtn.cloneNode(true));

        // 重新获取元素（因为被替换了）
        const newTextBtn = document.getElementById('add-capability-text');
        const newVisionBtn = document.getElementById('add-capability-vision');
        const newReasoningBtn = document.getElementById('add-capability-reasoning');

        // 设置文本能力默认选中
        newTextBtn.classList.add('selected');

        // 添加新的事件监听器
        newTextBtn.addEventListener('click', () => toggleCapability(newTextBtn));
        newVisionBtn.addEventListener('click', () => toggleCapability(newVisionBtn));
        newReasoningBtn.addEventListener('click', () => toggleCapability(newReasoningBtn));

        // 显示弹窗
        modal.style.display = 'flex';
        modelIdInput.focus();
    }

    // 确认添加模型
    confirmAddModel() {
        const modelIdInput = document.getElementById('add-model-input');
        const modelNameInput = document.getElementById('add-model-name-input');
        const textBtn = document.getElementById('add-capability-text');
        const visionBtn = document.getElementById('add-capability-vision');
        const reasoningBtn = document.getElementById('add-capability-reasoning');

        if (!modelIdInput || !modelNameInput || !textBtn || !visionBtn || !reasoningBtn) {
            this.uiManager.showError('表单元素未找到');
            return;
        }

        const modelId = modelIdInput.value.trim();
        const modelName = modelNameInput.value.trim();

        // 验证输入
        if (!modelId) {
            this.uiManager.showError('模型ID不能为空');
            return;
        }

        // 如果模型名称为空，使用模型ID作为默认值
        const finalModelName = modelName || modelId;

        // 获取选中的能力（从按钮的 selected 类名判断）
        const capabilities = [];
        if (textBtn.classList.contains('selected')) capabilities.push('text');
        if (visionBtn.classList.contains('selected')) capabilities.push('vision');
        if (reasoningBtn.classList.contains('selected')) capabilities.push('reasoning');

        if (capabilities.length === 0) {
            this.uiManager.showError('至少需要选择一项能力');
            return;
        }

        // 检查模型是否已存在
        const platform = this.currentPlatform;
        const platformConfig = this.config[platform];
        const modelList = platformConfig?.modelList || [];

        if (modelList.includes(modelId)) {
            this.uiManager.showError(`模型ID "${modelId}" 已存在`);
            return;
        }

        // 初始化必要的配置对象
        if (!platformConfig.modelList) platformConfig.modelList = [];
        if (!platformConfig.modelNameMap) platformConfig.modelNameMap = {};
        if (!platformConfig.customCapabilities) platformConfig.customCapabilities = {};

        // 添加模型到列表
        platformConfig.modelList.push(modelId);

        // 保存模型名称映射（如果名称与ID不同）
        if (finalModelName !== modelId) {
            platformConfig.modelNameMap[modelId] = finalModelName;
        }

        // 保存自定义能力
        platformConfig.customCapabilities[modelId] = capabilities;

        // 智能模型选择：如果当前没有选中模型，自动选择第一个添加的模型
        this.ensureCurrentModel(platform);

        // 保存配置
        const result = this.configManager.saveConfig(this.config);
        if (result.success) {
            this.config = result.config;
        }

        // 更新UI显示
        this.renderModelList(platform);

        // 刷新主页面状态显示
        this.updateMainPageStatus();

        // 刷新模型筛选菜单（OCR默认模型选择列表等）
        this.updateModelFilterMenus();

        // 关闭弹窗
        this.hideAddModelModal();

        // 显示成功提示
        const displayName = this.getModelDisplayName(modelId, platform);
        this.uiManager.showNotification(`模型 ${displayName} 已添加`);
    }

    // 隐藏添加模型弹窗
    hideAddModelModal() {
        const modal = document.getElementById('add-model-modal');
        modal.style.display = 'none';
        this.currentPlatform = null;
    }

    // 显示添加自定义服务商弹窗
    showAddCustomProviderModal() {
        const modal = document.getElementById('add-custom-provider-modal');
        const nameInput = document.getElementById('custom-provider-name-input');
        const typeButtons = document.querySelectorAll('.provider-type-btn');

        if (!modal || !nameInput) {
            console.error('添加自定义服务商弹窗元素未找到');
            this.uiManager.showError('无法打开添加自定义服务商弹窗');
            return;
        }

        // 清空输入框
        nameInput.value = '';

        // 清除所有类型按钮的选中状态
        typeButtons.forEach(btn => btn.classList.remove('selected'));

        // 默认选中 OpenAI
        const openaiBtn = document.querySelector('.provider-type-btn[data-provider-type="openai"]');
        if (openaiBtn) {
            openaiBtn.classList.add('selected');
        }

        // 预生成 serviceId 用于颜色一致性
        const selectedTypeBtn = openaiBtn || typeButtons[0];
        const platformType = selectedTypeBtn ? (selectedTypeBtn.dataset.providerType || 'openai') : 'openai';
        const timestamp = Date.now();
        this.pendingCustomProviderId = `custom_${platformType}_${timestamp}`;

        // 初始化图标状态
        this.currentCustomProviderIconState = {
            mode: 'auto',  // 'auto' 或 'custom'
            image: null,   // Data URL
            char: 'C'      // 默认字符
        };

        // 重置图标显示
        this.updateProviderIconPreview('add');

        // 绑定图标选择事件（如果还未绑定）
        this.bindProviderIconEvents('add');

        // 绑定名称输入事件，实时更新默认图标
        const boundNameInputHandler = () => {
            if (this.currentCustomProviderIconState.mode === 'auto') {
                const name = nameInput.value.trim();
                const char = name.charAt(0) || 'C';
                this.currentCustomProviderIconState.char = char.toUpperCase();
                this.updateProviderIconPreview('add');
            }
        };

        // 移除旧的事件监听器（如果有）
        if (nameInput._iconUpdateHandler) {
            nameInput.removeEventListener('input', nameInput._iconUpdateHandler);
        }
        nameInput._iconUpdateHandler = boundNameInputHandler;
        nameInput.addEventListener('input', boundNameInputHandler);

        // 显示弹窗
        modal.style.display = 'flex';
    }

    // 更新图标预览
    updateProviderIconPreview(type) {
        const prefix = type === 'add' ? 'add' : 'edit';
        const preview = document.getElementById(`${prefix}-provider-icon-preview`);
        const resetBtn = document.getElementById(`${prefix}-provider-icon-reset`);

        if (!preview) return;

        const state = this.currentCustomProviderIconState;

        if (state.mode === 'custom' && state.image) {
            // 显示自定义图片
            preview.innerHTML = `<img src="${state.image}" class="service-icon-image" alt="${state.char}" />`;
            if (resetBtn) resetBtn.style.display = 'flex';
        } else {
            // 显示默认字母头像 - 基于 serviceId 生成颜色以确保预览与最终一致
            let colorSeed;
            if (type === 'add') {
                // 添加场景: 使用预生成的 pendingCustomProviderId
                colorSeed = this.pendingCustomProviderId || 'default';
            } else {
                // 编辑场景: 使用当前编辑的服务商 ID
                colorSeed = this.currentEditCustomProviderId || 'default';
            }
            const bgGradient = this.uiManager.generateGradientFromString(colorSeed);
            preview.innerHTML = `<div class="service-icon-text" id="${prefix}-provider-icon-char" style="background: ${bgGradient}">${state.char}</div>`;
            if (resetBtn) resetBtn.style.display = 'none';
        }
    }

    // 绑定图标选择事件
    bindProviderIconEvents(type) {
        const prefix = type === 'add' ? 'add' : 'edit';
        const preview = document.getElementById(`${prefix}-provider-icon-preview`);
        const fileInput = document.getElementById(`${prefix}-provider-icon-input`);
        const resetBtn = document.getElementById(`${prefix}-provider-icon-reset`);

        if (!preview || !fileInput) return;

        // 点击预览区域触发文件选择
        const clickHandler = () => {
            fileInput.click();
        };

        // 移除旧的事件监听器
        if (preview._iconClickHandler) {
            preview.removeEventListener('click', preview._iconClickHandler);
        }
        preview._iconClickHandler = clickHandler;
        preview.addEventListener('click', clickHandler);

        // 文件选择变化
        const changeHandler = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // 验证文件类型
            if (!file.type.startsWith('image/')) {
                this.uiManager.showError('请选择图片文件');
                return;
            }

            // 验证文件大小（限制为 2MB）
            if (file.size > 2 * 1024 * 1024) {
                this.uiManager.showError('图片文件大小不能超过 2MB');
                return;
            }

            // 读取文件为 Data URL
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    // 创建 canvas 进行压缩和裁剪
                    const canvas = document.createElement('canvas');
                    const size = 128; // 目标尺寸
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');

                    // 计算裁剪区域（居中裁剪为正方形）
                    const minDim = Math.min(img.width, img.height);
                    const sx = (img.width - minDim) / 2;
                    const sy = (img.height - minDim) / 2;

                    // 绘制裁剪后的图片
                    ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

                    // 转换为 Data URL
                    const dataUrl = canvas.toDataURL('image/png', 0.9);

                    // 更新状态
                    this.currentCustomProviderIconState.mode = 'custom';
                    this.currentCustomProviderIconState.image = dataUrl;
                    this.updateProviderIconPreview(type);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        };

        // 移除旧的事件监听器
        if (fileInput._iconChangeHandler) {
            fileInput.removeEventListener('change', fileInput._iconChangeHandler);
        }
        fileInput._iconChangeHandler = changeHandler;
        fileInput.addEventListener('change', changeHandler);

        // 重置按钮点击
        if (resetBtn) {
            const resetHandler = () => {
                this.currentCustomProviderIconState.mode = 'auto';
                this.currentCustomProviderIconState.image = null;
                fileInput.value = ''; // 清空文件输入
                this.updateProviderIconPreview(type);
            };

            // 移除旧的事件监听器
            if (resetBtn._iconResetHandler) {
                resetBtn.removeEventListener('click', resetBtn._iconResetHandler);
            }
            resetBtn._iconResetHandler = resetHandler;
            resetBtn.addEventListener('click', resetHandler);
        }
    }

    // 初始化服务商类型按钮图标
    initProviderTypeButtonIcons() {
        const providerTypeButtons = document.querySelectorAll('.provider-type-btn');
        providerTypeButtons.forEach(btn => {
            // 兼容两种 data 属性：添加弹窗使用 data-provider-type，设置弹窗使用 data-type
            const platform = btn.dataset.providerType || btn.dataset.type;
            if (platform) {
                const iconContainer = btn.querySelector('.provider-type-icon');
                if (iconContainer) {
                    const iconHtml = this.uiManager.getServiceIcon(platform);
                    if (iconHtml) {
                        iconContainer.innerHTML = iconHtml;
                    }
                }
            }
        });
    }

    // 隐藏添加自定义服务商弹窗
    hideAddCustomProviderModal() {
        const modal = document.getElementById('add-custom-provider-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        // 清空预生成的 ID (用户取消时)
        this.pendingCustomProviderId = null;
    }

    // 确认添加自定义服务商
    confirmAddCustomProvider() {
        const nameInput = document.getElementById('custom-provider-name-input');
        const selectedTypeBtn = document.querySelector('.provider-type-btn.selected');

        if (!nameInput || !selectedTypeBtn) {
            this.uiManager.showError('请填写完整信息');
            return;
        }

        const providerName = nameInput.value.trim();
        const platformType = selectedTypeBtn.dataset.providerType;

        // 验证输入
        if (!providerName) {
            this.uiManager.showError('请输入服务商名称');
            return;
        }

        if (!platformType) {
            this.uiManager.showError('请选择服务商类型');
            return;
        }

        // 使用预生成的 serviceId (确保与预览颜色一致)
        const serviceId = this.pendingCustomProviderId || `custom_${platformType}_${Date.now()}`;

        // 从图标状态获取图标信息
        const iconState = this.currentCustomProviderIconState || {
            mode: 'auto',
            image: null,
            char: providerName.charAt(0) || 'C'
        };

        // 准备元信息
        const meta = {
            id: serviceId,
            name: providerName,
            platformType: platformType,
            iconChar: iconState.char,
            iconType: iconState.mode,
            iconImage: iconState.image
        };

        // 准备平台配置（使用默认值）
        const platformConfig = {
            platformType: platformType,
            apiKey: '',
            baseUrl: '',
            model: '',
            modelList: [],
            modelNameMap: {},
            customCapabilities: {},
            useCustomModel: false,
            customModel: '',
            maxTokens: 1000
        };

        // 保存到配置
        try {
            const result = this.configManager.addCustomLLMProvider(meta, platformConfig);

            // 检查保存结果
            if (!result.success) {
                this.uiManager.showError('添加自定义服务商失败');
                return;
            }

            // 同步内存中的配置，确保包含新服务商的元信息
            this.config = result.config;

            // 清空预生成的 ID
            this.pendingCustomProviderId = null;

            // 关闭弹窗
            this.hideAddCustomProviderModal();

            // 刷新服务列表
            this.uiManager.renderServiceList();

            // 切换到新创建的服务商配置页面
            this.uiManager.switchConfigSection(serviceId);

            // 更新服务列表选中状态
            const serviceItems = document.querySelectorAll('.service-item');
            serviceItems.forEach(item => {
                if (item.dataset.service === serviceId) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });

            // 显示成功提示
            this.uiManager.showNotification(`自定义服务商 ${providerName} 已创建，请配置相关参数`);
        } catch (error) {
            console.error('添加自定义服务商失败:', error);
            this.uiManager.showError('添加自定义服务商失败: ' + error.message);
        }
    }

    // 渲染自定义服务商配置页面
    renderCustomProviderConfig(serviceId) {
        const container = document.getElementById('custom-provider-config');
        if (!container) {
            console.error('自定义服务商配置容器未找到');
            return;
        }

        // 获取服务商元信息
        const provider = this.configManager.getCustomLLMProviderMeta(serviceId);
        if (!provider) {
            console.error('未找到自定义服务商:', serviceId);
            container.innerHTML = '<p style="padding: 20px; color: var(--text-secondary);">未找到该服务商配置</p>';
            return;
        }

        // 获取服务商配置
        const serviceConfig = this.config[serviceId] || {};
        const platformType = provider.platformType;

        // 根据平台类型生成配置模板
        let configHtml = '';

        if (platformType === 'openai') {
            configHtml = this.generateOpenAIConfigTemplate(serviceId, provider.name, serviceConfig);
        } else if (platformType === 'google') {
            configHtml = this.generateGeminiConfigTemplate(serviceId, provider.name, serviceConfig);
        } else if (platformType === 'anthropic') {
            configHtml = this.generateAnthropicConfigTemplate(serviceId, provider.name, serviceConfig);
        } else {
            configHtml = `<p style="padding: 20px; color: var(--text-secondary);">不支持的服务商类型: ${platformType}</p>`;
        }

        // 渲染配置页面
        container.innerHTML = configHtml;

        // 绑定事件
        this.bindCustomProviderConfigEvents(serviceId);

        // 渲染模型列表（如果有已保存的模型）
        this.renderModelList(serviceId);
    }

    // 生成 OpenAI 配置模板
    generateOpenAIConfigTemplate(serviceId, providerName, serviceConfig) {
        const apiKey = serviceConfig.apiKey || '';
        const baseUrl = serviceConfig.baseUrl || 'https://api.openai.com/v1';

        // 动态生成 API URL 预览
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        const apiUrlPreview = `${cleanBaseUrl}/chat/completions`;

        return `
            <h4>
                ${providerName} 配置
                <button type="button" class="custom-provider-settings-btn" data-service-id="${serviceId}" title="服务商设置">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
            </h4>
            <div class="form-group">
                <label>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="label-icon api-key-icon" title="API Key">
                        <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>
                        <path d="m21 2-9.6 9.6"/>
                        <circle cx="7.5" cy="15.5" r="5.5"/>
                    </svg>
                    API Key:
                </label>
                <div class="input-with-toggle">
                    <input type="password" id="${serviceId}-api-key" placeholder="请输入 API Key" value="${apiKey}">
                    <button type="button" class="toggle-password" id="toggle-${serviceId}-api-key" title="显示密码">
                        <span class="eye-icon"></span>
                    </button>
                </div>
            </div>
            <div class="form-group">
                <label>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="label-icon url-icon" title="API Base URL">
                        <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>
                        <path d="m21 3-9 9"/>
                        <path d="M15 3h6v6"/>
                    </svg>
                    API Base URL: <span style="color: #888; font-size: 0.9em; font-weight: normal;">(#结尾强制使用输入地址，/结尾忽略 v1 版本)</span>
                </label>
                <div class="input-with-reset">
                    <input type="text" id="${serviceId}-base-url" value="${baseUrl}" placeholder="API地址">
                    <button type="button" class="reset-url-btn" data-service="${serviceId}" data-default="https://api.openai.com/v1" title="重置为默认值">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                            <path d="M21 3v5h-5"/>
                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                            <path d="M3 21v-5h5"/>
                        </svg>
                    </button>
                </div>
                <div class="api-url-preview" id="${serviceId}-url-preview">${apiUrlPreview}</div>
            </div>
            <div class="form-group">
                <div class="model-header">
                    <label>模型版本:</label>
                    <div class="model-actions">
                        <button type="button" id="${serviceId}-fetch-models-btn" class="btn-small">获取</button>
                        <button type="button" id="${serviceId}-add-model-btn" class="btn-small">添加</button>
                    </div>
                </div>
                <div class="model-list" id="${serviceId}-model-list">
                    <!-- 模型列表将在这里动态生成 -->
                </div>
            </div>
        `;
    }

    // 生成 Gemini 配置模板
    generateGeminiConfigTemplate(serviceId, providerName, serviceConfig) {
        const apiKey = serviceConfig.apiKey || '';
        const baseUrl = serviceConfig.baseUrl || 'https://generativelanguage.googleapis.com';

        // 动态生成 API URL 预览
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        const apiUrlPreview = `${cleanBaseUrl}/v1beta/models/{model}:generateContent`;

        return `
            <h4>
                ${providerName} 配置
                <button type="button" class="custom-provider-settings-btn" data-service-id="${serviceId}" title="服务商设置">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
            </h4>
            <div class="form-group">
                <label>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="label-icon api-key-icon" title="API Key">
                        <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>
                        <path d="m21 2-9.6 9.6"/>
                        <circle cx="7.5" cy="15.5" r="5.5"/>
                    </svg>
                    API Key:
                </label>
                <div class="input-with-toggle">
                    <input type="password" id="${serviceId}-api-key" placeholder="请输入 API Key" value="${apiKey}">
                    <button type="button" class="toggle-password" id="toggle-${serviceId}-api-key" title="显示密码">
                        <span class="eye-icon"></span>
                    </button>
                </div>
            </div>
            <div class="form-group">
                <label>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="label-icon url-icon" title="API Base URL">
                        <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>
                        <path d="m21 3-9 9"/>
                        <path d="M15 3h6v6"/>
                    </svg>
                    API Base URL: <span style="color: #888; font-size: 0.9em; font-weight: normal;">(#结尾强制使用输入地址，/结尾忽略 v1 版本)</span>
                </label>
                <div class="input-with-reset">
                    <input type="text" id="${serviceId}-base-url" value="${baseUrl}" placeholder="API地址">
                    <button type="button" class="reset-url-btn" data-service="${serviceId}" data-default="https://generativelanguage.googleapis.com" title="重置为默认值">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                            <path d="M21 3v5h-5"/>
                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                            <path d="M3 21v-5h5"/>
                        </svg>
                    </button>
                </div>
                <div class="api-url-preview" id="${serviceId}-url-preview">${apiUrlPreview}</div>
            </div>
            <div class="form-group">
                <div class="model-header">
                    <label>模型版本:</label>
                    <div class="model-actions">
                        <button type="button" id="${serviceId}-fetch-models-btn" class="btn-small">获取</button>
                        <button type="button" id="${serviceId}-add-model-btn" class="btn-small">添加</button>
                    </div>
                </div>
                <div class="model-list" id="${serviceId}-model-list">
                    <!-- 模型列表将在这里动态生成 -->
                </div>
            </div>
        `;
    }

    // 生成 Anthropic 配置模板
    generateAnthropicConfigTemplate(serviceId, providerName, serviceConfig) {
        const apiKey = serviceConfig.apiKey || '';
        const baseUrl = serviceConfig.baseUrl || 'https://api.anthropic.com/v1';

        // 动态生成 API URL 预览
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        const apiUrlPreview = `${cleanBaseUrl}/messages`;

        return `
            <h4>
                ${providerName} 配置
                <button type="button" class="custom-provider-settings-btn" data-service-id="${serviceId}" title="服务商设置">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
            </h4>
            <div class="form-group">
                <label>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="label-icon api-key-icon" title="API Key">
                        <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>
                        <path d="m21 2-9.6 9.6"/>
                        <circle cx="7.5" cy="15.5" r="5.5"/>
                    </svg>
                    API Key:
                </label>
                <div class="input-with-toggle">
                    <input type="password" id="${serviceId}-api-key" placeholder="请输入 API Key" value="${apiKey}">
                    <button type="button" class="toggle-password" id="toggle-${serviceId}-api-key" title="显示密码">
                        <span class="eye-icon"></span>
                    </button>
                </div>
            </div>
            <div class="form-group">
                <label>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="label-icon url-icon" title="API Base URL">
                        <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>
                        <path d="m21 3-9 9"/>
                        <path d="M15 3h6v6"/>
                    </svg>
                    API Base URL: <span style="color: #888; font-size: 0.9em; font-weight: normal;">(#结尾强制使用输入地址，/结尾忽略 v1 版本)</span>
                </label>
                <div class="input-with-reset">
                    <input type="text" id="${serviceId}-base-url" value="${baseUrl}" placeholder="API地址">
                    <button type="button" class="reset-url-btn" data-service="${serviceId}" data-default="https://api.anthropic.com/v1" title="重置为默认值">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                            <path d="M21 3v5h-5"/>
                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                            <path d="M3 21v-5h5"/>
                        </svg>
                    </button>
                </div>
                <div class="api-url-preview" id="${serviceId}-url-preview">${apiUrlPreview}</div>
            </div>
            <div class="form-group">
                <div class="model-header">
                    <label>模型版本:</label>
                    <div class="model-actions">
                        <button type="button" id="${serviceId}-fetch-models-btn" class="btn-small">获取</button>
                        <button type="button" id="${serviceId}-add-model-btn" class="btn-small">添加</button>
                    </div>
                </div>
                <div class="model-list" id="${serviceId}-model-list">
                    <!-- 模型列表将在这里动态生成 -->
                </div>
            </div>
        `;
    }

    // 绑定自定义服务商配置事件
    bindCustomProviderConfigEvents(serviceId) {
        // 获取模型列表按钮
        const fetchModelsBtn = document.getElementById(`${serviceId}-fetch-models-btn`);
        if (fetchModelsBtn) {
            fetchModelsBtn.addEventListener('click', () => this.handleFetchModelsForCustomProvider(serviceId));
        }

        // 添加模型按钮
        const addModelBtn = document.getElementById(`${serviceId}-add-model-btn`);
        if (addModelBtn) {
            addModelBtn.addEventListener('click', () => this.showAddModelModal(serviceId));
        }

        // 服务商设置按钮
        const settingsBtn = document.querySelector(`.custom-provider-settings-btn[data-service-id="${serviceId}"]`);
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.showCustomProviderSettingsModal(serviceId));
        }

        // 密码显示/隐藏按钮 - 初始化并绑定事件
        const togglePasswordBtn = document.getElementById(`toggle-${serviceId}-api-key`);
        if (togglePasswordBtn) {
            // 初始化按钮状态和图标
            this.uiManager.initializePasswordToggleState(togglePasswordBtn);

            // 绑定点击事件
            togglePasswordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.uiManager.togglePasswordVisibility(`toggle-${serviceId}-api-key`);
            });
        }

        // URL 重置按钮
        const resetUrlBtn = document.querySelector(`.reset-url-btn[data-service="${serviceId}"]`);
        if (resetUrlBtn) {
            resetUrlBtn.addEventListener('click', () => {
                const baseUrlInput = document.getElementById(`${serviceId}-base-url`);
                const defaultUrl = resetUrlBtn.dataset.default;
                if (baseUrlInput && defaultUrl) {
                    baseUrlInput.value = defaultUrl;
                    // 重置后自动保存
                    this.saveCustomProviderFieldConfig(serviceId, 'baseUrl', defaultUrl);
                    // 更新 API URL 预览
                    this.updateCustomProviderApiUrlPreview(serviceId);
                }
            });
        }

        // 绑定配置字段自动保存（复用内置服务商的自动保存逻辑）
        // API Key字段
        const apiKeyField = document.getElementById(`${serviceId}-api-key`);
        if (apiKeyField) {
            this.bindFieldWithChangeDetection(apiKeyField, serviceId, 'apiKey');
        }

        // Base URL字段
        const baseUrlField = document.getElementById(`${serviceId}-base-url`);
        if (baseUrlField) {
            this.bindFieldWithChangeDetection(baseUrlField, serviceId, 'baseUrl');
        }

        // 绑定 API URL 预览动态更新
        this.bindCustomProviderApiUrlPreview(serviceId);

        // 绑定平台模型管理事件（复用现有方法）
        this.bindPlatformModelEvents(serviceId);
    }

    // 处理自定义服务商的获取模型列表请求
    handleFetchModelsForCustomProvider(serviceId) {
        // 直接调用现有的 showFetchModelsModal 方法
        // 该方法会自动处理模型列表的获取、缓存和显示
        this.showFetchModelsModal(serviceId);
    }

    // 保存自定义服务商字段配置（辅助方法）
    saveCustomProviderFieldConfig(serviceId, configKey, value) {
        try {
            // 确保配置对象存在
            if (!this.config[serviceId]) {
                this.config[serviceId] = {};
            }

            // 更新配置
            this.config[serviceId][configKey] = value;

            // 保存配置
            const result = this.configManager.saveConfig(this.config);

            // 检查保存结果并同步内存配置
            if (result.success) {
                this.config = result.config;
            } else {
                console.error('保存自定义服务商配置失败');
            }
        } catch (error) {
            console.error('保存自定义服务商配置失败:', error);
        }
    }

    // 绑定自定义服务商 API URL 预览动态更新
    bindCustomProviderApiUrlPreview(serviceId) {
        const baseUrlInput = document.getElementById(`${serviceId}-base-url`);
        const preview = document.getElementById(`${serviceId}-url-preview`);

        if (baseUrlInput && preview) {
            // 监听输入事件，实时更新预览
            const updatePreview = () => {
                this.updateCustomProviderApiUrlPreview(serviceId);
            };

            baseUrlInput.addEventListener('input', updatePreview);
            baseUrlInput.addEventListener('change', updatePreview);

            // 初始化预览
            updatePreview();
        }
    }

    // 更新自定义服务商 API URL 预览
    updateCustomProviderApiUrlPreview(serviceId) {
        const baseUrlInput = document.getElementById(`${serviceId}-base-url`);
        const preview = document.getElementById(`${serviceId}-url-preview`);

        if (!baseUrlInput || !preview) return;

        // 获取服务商元信息，确定平台类型
        const provider = this.configManager.getCustomLLMProviderMeta(serviceId);
        if (!provider) return;

        const platformType = provider.platformType;

        // 定义默认 Base URL（根地址）
        const defaultBaseUrls = {
            openai: 'https://api.openai.com',  // 改为根地址
            google: 'https://generativelanguage.googleapis.com',
            anthropic: 'https://api.anthropic.com'
        };

        // 获取当前输入的 Base URL，如果为空则使用默认值
        const baseUrl = baseUrlInput.value.trim() || defaultBaseUrls[platformType];

        // 检查是否有"原样使用"标记（末尾的 #）
        const rawUrl = window.urlUtils.checkRawUrlMarker(baseUrl);
        if (rawUrl !== null) {
            // 有 # 标记，直接显示去除 # 后的 URL
            preview.textContent = rawUrl;
            return;
        }

        // 构建完整 URL
        let fullUrl;
        if (platformType === 'openai') {
            // OpenAI 类型使用统一的 URL 构造函数
            fullUrl = window.urlUtils.buildOpenAIChatUrl(baseUrl, 'https://api.openai.com');
        } else if (platformType === 'anthropic') {
            fullUrl = window.urlUtils.buildAnthropicMessagesUrl(baseUrl);
        } else if (platformType === 'google') {
            const previewUrl = window.urlUtils.buildGeminiContentUrl(baseUrl, '{model}', 'API_KEY', { stream: false });
            fullUrl = previewUrl.replace(/key=API_KEY$/, 'key=YOUR_API_KEY');
        } else {
            console.warn('未知的平台类型:', platformType);
            return;
        }

        // 更新预览
        preview.textContent = fullUrl;
    }

    // 显示自定义服务商设置弹窗
    showCustomProviderSettingsModal(serviceId) {
        const modal = document.getElementById('custom-provider-settings-modal');
        if (!modal) {
            console.error('自定义服务商设置弹窗未找到');
            return;
        }

        // 获取服务商元信息
        const provider = this.configManager.getCustomLLMProviderMeta(serviceId);
        if (!provider) {
            this.uiManager.showError('未找到该服务商');
            return;
        }

        // 填充表单
        const nameInput = document.getElementById('custom-provider-settings-name');
        const typeButtons = document.querySelectorAll('.custom-provider-settings-type-btn');

        if (nameInput) {
            nameInput.value = provider.name;
        }

        // 选中当前类型
        typeButtons.forEach(btn => {
            if (btn.dataset.type === provider.platformType) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });

        // 保存当前编辑的服务商 ID (必须在 updateProviderIconPreview 之前设置)
        this.currentEditCustomProviderId = serviceId;

        // 初始化图标状态
        this.currentCustomProviderIconState = {
            mode: provider.iconType || 'auto',
            image: provider.iconImage || null,
            char: provider.iconChar || provider.name?.charAt(0) || 'C'
        };

        // 更新图标显示
        this.updateProviderIconPreview('edit');

        // 绑定图标选择事件
        this.bindProviderIconEvents('edit');

        // 绑定名称输入事件，实时更新默认图标
        const boundNameInputHandler = () => {
            if (this.currentCustomProviderIconState.mode === 'auto') {
                const name = nameInput.value.trim();
                const char = name.charAt(0) || 'C';
                this.currentCustomProviderIconState.char = char.toUpperCase();
                this.updateProviderIconPreview('edit');
            }
        };

        // 移除旧的事件监听器（如果有）
        if (nameInput._iconUpdateHandler) {
            nameInput.removeEventListener('input', nameInput._iconUpdateHandler);
        }
        nameInput._iconUpdateHandler = boundNameInputHandler;
        nameInput.addEventListener('input', boundNameInputHandler);

        // 显示弹窗
        modal.style.display = 'flex';
    }

    // 隐藏自定义服务商设置弹窗
    hideCustomProviderSettingsModal() {
        const modal = document.getElementById('custom-provider-settings-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentEditCustomProviderId = null;
    }

    // 确认保存自定义服务商设置
    confirmCustomProviderSettings() {
        const serviceId = this.currentEditCustomProviderId;
        if (!serviceId) {
            return;
        }

        const nameInput = document.getElementById('custom-provider-settings-name');
        const selectedTypeBtn = document.querySelector('.custom-provider-settings-type-btn.selected');

        if (!nameInput || !selectedTypeBtn) {
            this.uiManager.showError('表单元素未找到');
            return;
        }

        const newName = nameInput.value.trim();
        const newType = selectedTypeBtn.dataset.type;

        if (!newName) {
            this.uiManager.showError('请输入服务商名称');
            nameInput.focus();
            return;
        }

        try {
            // 获取当前服务商信息
            const provider = this.configManager.getCustomLLMProviderMeta(serviceId);
            if (!provider) {
                this.uiManager.showError('未找到该服务商');
                return;
            }

            // 从图标状态获取图标信息
            const iconState = this.currentCustomProviderIconState || {
                mode: 'auto',
                image: null,
                char: newName.charAt(0) || 'C'
            };

            // 更新元信息
            const meta = {
                name: newName,
                platformType: newType,
                iconChar: iconState.char,
                iconType: iconState.mode,
                iconImage: iconState.image
            };

            // 获取当前配置
            const platformConfig = this.config[serviceId] || {};
            platformConfig.platformType = newType;

            // 更新服务商
            const result = this.configManager.updateCustomLLMProvider(serviceId, meta, platformConfig);

            // 检查更新结果并同步内存配置
            if (result.success) {
                this.config = result.config;
            } else {
                this.uiManager.showError('更新自定义服务商失败');
                return;
            }

            // 如果类型改变，需要重新渲染配置页面
            if (newType !== provider.platformType) {
                this.renderCustomProviderConfig(serviceId);
            } else {
                // 只更新标题
                const h4 = document.querySelector(`#custom-provider-config h4`);
                if (h4) {
                    const settingsBtn = h4.querySelector('.custom-provider-settings-btn');
                    h4.textContent = `${newName} 配置`;
                    if (settingsBtn) {
                        h4.appendChild(settingsBtn);
                    }
                }
            }

            // 刷新服务列表
            this.uiManager.renderServiceList();

            // 重新选中当前服务商
            const serviceItem = document.querySelector(`.service-item[data-service="${serviceId}"]`);
            if (serviceItem) {
                serviceItem.classList.add('active');
            }

            // 隐藏弹窗
            this.hideCustomProviderSettingsModal();

            // 显示成功提示
            this.uiManager.showNotification('服务商设置已更新');
        } catch (error) {
            console.error('更新服务商设置失败:', error);
            this.uiManager.showError('更新失败: ' + error.message);
        }
    }

    // 删除自定义服务商 - 显示确认对话框
    deleteCustomProviderFromSettings() {
        const serviceId = this.currentEditCustomProviderId;
        if (!serviceId) {
            return;
        }

        const provider = this.configManager.getCustomLLMProviderMeta(serviceId);
        if (!provider) {
            this.uiManager.showError('未找到该服务商');
            return;
        }

        // 保存待删除的服务商ID
        this.pendingDeleteCustomProviderId = serviceId;

        // 显示自定义确认对话框
        this.uiManager.showDeleteCustomProviderConfirm(provider.name);
    }

    // 执行删除自定义服务商操作
    executeDeleteCustomProvider() {
        const serviceId = this.pendingDeleteCustomProviderId;
        if (!serviceId) {
            return;
        }

        const provider = this.configManager.getCustomLLMProviderMeta(serviceId);
        if (!provider) {
            this.uiManager.showError('未找到该服务商');
            this.pendingDeleteCustomProviderId = null;
            return;
        }

        try {
            // 删除服务商
            this.configManager.deleteCustomLLMProvider(serviceId);

            // 清空待删除ID
            this.pendingDeleteCustomProviderId = null;

            // 隐藏弹窗
            this.hideCustomProviderSettingsModal();

            // 刷新服务列表
            this.uiManager.renderServiceList();

            // 切换到第一个服务商
            const firstService = document.querySelector('.service-item');
            if (firstService) {
                const firstServiceId = firstService.dataset.service;
                this.uiManager.switchConfigSection(firstServiceId);
                firstService.classList.add('active');
            }

            // 显示成功提示
            this.uiManager.showNotification(`自定义服务商 ${provider.name} 已删除`);
        } catch (error) {
            console.error('删除自定义服务商失败:', error);
            this.uiManager.showError('删除失败: ' + error.message);
            this.pendingDeleteCustomProviderId = null;
        }
    }

    // 打开模型设置弹窗
    openModelSettings(platform, modelId) {
        try {
            this.currentEditPlatform = platform;
            this.currentEditModelId = modelId;

            const modal = document.getElementById('edit-model-modal');
            const modelIdInput = document.getElementById('edit-model-id');
            const modelNameInput = document.getElementById('edit-model-name');
            const textBtn = document.getElementById('capability-text');
            const visionBtn = document.getElementById('capability-vision');
            const reasoningBtn = document.getElementById('capability-reasoning');

            if (!modal || !modelIdInput || !modelNameInput || !textBtn || !visionBtn || !reasoningBtn) {
                console.error('模型设置弹窗元素未找到');
                this.uiManager.showError('无法打开模型设置');
                return;
            }

            // 填充当前模型ID
            modelIdInput.value = modelId;

            // 填充当前模型名称
            const platformConfig = this.config[platform];
            const modelNameMap = platformConfig?.modelNameMap || {};
            const displayName = modelNameMap[modelId] || modelId;
            modelNameInput.value = displayName;

            // 获取模型能力
            let capabilities = [];

            // 优先使用自定义能力
            const customCapabilities = platformConfig?.customCapabilities || {};
            if (customCapabilities[modelId] && Array.isArray(customCapabilities[modelId])) {
                capabilities = customCapabilities[modelId];
            } else {
                // 否则使用自动检测的能力
                if (platform === 'utools') {
                    const storedModels = this.getStoredPlatformModels(platform);
                    const modelData = (storedModels && Array.isArray(storedModels)) ? storedModels.find(m => m.id === modelId) : null;
                    capabilities = modelData?.capabilities || this.uiManager.getModelCapabilities(platform, modelId, modelData);
                } else {
                    capabilities = this.uiManager.getModelCapabilities(platform, modelId);
                }
            }

            // 设置按钮选中状态
            textBtn.classList.toggle('selected', capabilities.includes('text'));
            visionBtn.classList.toggle('selected', capabilities.includes('vision'));
            reasoningBtn.classList.toggle('selected', capabilities.includes('reasoning'));

            // 添加按钮点击事件（移除旧的事件监听器）
            const toggleCapability = (btn) => {
                btn.classList.toggle('selected');
            };

            // 移除旧的事件监听器
            textBtn.replaceWith(textBtn.cloneNode(true));
            visionBtn.replaceWith(visionBtn.cloneNode(true));
            reasoningBtn.replaceWith(reasoningBtn.cloneNode(true));

            // 重新获取元素（因为被替换了）
            const newTextBtn = document.getElementById('capability-text');
            const newVisionBtn = document.getElementById('capability-vision');
            const newReasoningBtn = document.getElementById('capability-reasoning');

            // 重新设置选中状态
            newTextBtn.classList.toggle('selected', capabilities.includes('text'));
            newVisionBtn.classList.toggle('selected', capabilities.includes('vision'));
            newReasoningBtn.classList.toggle('selected', capabilities.includes('reasoning'));

            // 添加新的事件监听器
            newTextBtn.addEventListener('click', () => toggleCapability(newTextBtn));
            newVisionBtn.addEventListener('click', () => toggleCapability(newVisionBtn));
            newReasoningBtn.addEventListener('click', () => toggleCapability(newReasoningBtn));

            // 保存原始能力用于重置
            this.originalCapabilities = [...capabilities];

            // 显示弹窗
            modal.style.display = 'flex';
            modelIdInput.focus();
        } catch (error) {
            console.error('打开模型设置失败:', error);
            this.uiManager.showError('打开模型设置失败: ' + error.message);
        }
    }

    // 隐藏模型设置弹窗
    hideEditModelModal() {
        const modal = document.getElementById('edit-model-modal');
        modal.style.display = 'none';
        this.currentEditPlatform = null;
        this.currentEditModelId = null;
        this.originalCapabilities = null;
    }

    // 重置模型能力
    resetModelCapabilities() {
        const platform = this.currentEditPlatform;
        const modelId = this.currentEditModelId;

        if (!platform || !modelId) return;

        // 获取自动检测的能力
        let capabilities = [];
        if (platform === 'utools') {
            const storedModels = this.getStoredPlatformModels(platform);
            const modelData = (storedModels && Array.isArray(storedModels)) ? storedModels.find(m => m.id === modelId) : null;
            capabilities = modelData?.capabilities || this.uiManager.getModelCapabilities(platform, modelId, modelData);
        } else {
            capabilities = this.uiManager.getModelCapabilities(platform, modelId);
        }

        // 更新按钮选中状态
        const textBtn = document.getElementById('capability-text');
        const visionBtn = document.getElementById('capability-vision');
        const reasoningBtn = document.getElementById('capability-reasoning');

        textBtn.classList.toggle('selected', capabilities.includes('text'));
        visionBtn.classList.toggle('selected', capabilities.includes('vision'));
        reasoningBtn.classList.toggle('selected', capabilities.includes('reasoning'));

        this.uiManager.showNotification('已重置为自动检测的能力');
    }

    // 保存模型设置
    saveModelSettings() {
        try {
            const platform = this.currentEditPlatform;
            const oldModelId = this.currentEditModelId;

            if (!platform || !oldModelId) {
                this.uiManager.showError('无效的平台或模型ID');
                return;
            }

            const modelIdInput = document.getElementById('edit-model-id');
            const modelNameInput = document.getElementById('edit-model-name');
            const textBtn = document.getElementById('capability-text');
            const visionBtn = document.getElementById('capability-vision');
            const reasoningBtn = document.getElementById('capability-reasoning');

            if (!modelIdInput || !modelNameInput || !textBtn || !visionBtn || !reasoningBtn) {
                this.uiManager.showError('表单元素未找到');
                return;
            }

            const newModelId = modelIdInput.value.trim();
            const newModelName = modelNameInput.value.trim();

            // 验证输入
            if (!newModelId) {
                this.uiManager.showError('模型ID不能为空');
                return;
            }

            if (!newModelName) {
                this.uiManager.showError('模型名称不能为空');
                return;
            }

            // 获取选中的能力（从按钮的 selected 类名判断）
            const capabilities = [];
            if (textBtn.classList.contains('selected')) capabilities.push('text');
            if (visionBtn.classList.contains('selected')) capabilities.push('vision');
            if (reasoningBtn.classList.contains('selected')) capabilities.push('reasoning');

            if (capabilities.length === 0) {
                this.uiManager.showError('至少需要选择一项能力');
                return;
            }

            // 检查模型ID是否发生变化
            const modelIdChanged = newModelId !== oldModelId;

            // 如果模型ID发生变化，检查是否与其他模型冲突
            if (modelIdChanged) {
                const platformConfig = this.config[platform];
                const modelList = platformConfig?.modelList || [];

                if (modelList.includes(newModelId)) {
                    this.uiManager.showError(`模型ID "${newModelId}" 已存在`);
                    return;
                }
            }

            // 更新配置
            const platformConfig = this.config[platform];

            // 初始化必要的配置对象
            if (!platformConfig.modelList) platformConfig.modelList = [];
            if (!platformConfig.modelNameMap) platformConfig.modelNameMap = {};
            if (!platformConfig.customCapabilities) platformConfig.customCapabilities = {};

            // 如果模型ID发生变化
            if (modelIdChanged) {
                // 更新模型列表
                const modelIndex = platformConfig.modelList.indexOf(oldModelId);
                if (modelIndex !== -1) {
                    platformConfig.modelList[modelIndex] = newModelId;
                }

                // 删除旧ID的映射
                if (platformConfig.modelNameMap[oldModelId]) {
                    delete platformConfig.modelNameMap[oldModelId];
                }

                // 删除旧ID的自定义能力
                if (platformConfig.customCapabilities[oldModelId]) {
                    delete platformConfig.customCapabilities[oldModelId];
                }

                // 如果该模型是当前选中的模型，更新为新ID
                if (platformConfig.model === oldModelId) {
                    platformConfig.model = newModelId;
                }
            }

            // 更新模型名称映射
            if (newModelName !== newModelId) {
                platformConfig.modelNameMap[newModelId] = newModelName;
            } else {
                // 如果名称和ID相同，删除映射（使用默认显示）
                if (platformConfig.modelNameMap[newModelId]) {
                    delete platformConfig.modelNameMap[newModelId];
                }
            }

            // 保存自定义能力
            platformConfig.customCapabilities[newModelId] = capabilities;

            // 保存配置
            const result = this.configManager.saveConfig(this.config);
            if (result.success) {
                this.config = result.config;
            }

            // 刷新配置页面的模型列表UI
            this.renderModelList(platform);

            // 如果修改的是当前正在使用的模型，更新主页面显示
            if (platformConfig.model === newModelId || (modelIdChanged && platformConfig.model === oldModelId)) {
                this.updateMainPageStatus();
            }

            // 刷新模型筛选菜单（OCR默认模型选择列表等）
            this.updateModelFilterMenus();

            // 关闭弹窗
            this.hideEditModelModal();

            // 显示成功提示
            const displayName = this.getModelDisplayName(newModelId, platform);
            this.uiManager.showNotification(`模型 ${displayName} 设置已保存`);
        } catch (error) {
            console.error('保存模型设置失败:', error);
            this.uiManager.showError('保存失败: ' + error.message);
        }
    }

    // 添加模型到列表
    addModelToList(platform, modelId) {
        // 获取或初始化平台配置
        if (!this.config[platform]) {
            this.config[platform] = {};
        }

        // 获取或初始化模型列表
        if (!this.config[platform].modelList) {
            this.config[platform].modelList = [];
        }

        // 获取或初始化模型名称映射
        if (!this.config[platform].modelNameMap) {
            this.config[platform].modelNameMap = {};
        }

        // 检查模型是否已存在
        if (this.config[platform].modelList.includes(modelId)) {
            // 获取模型显示名称（uTools使用友好名称，其他使用原始API名称）
            const displayName = this.getModelDisplayName(modelId, platform);
            this.uiManager.showWarning(`模型 ${displayName} 已存在`);
            return false;
        }

        // 添加模型到列表
        this.config[platform].modelList.push(modelId);

        // 如果是从获取的模型列表中添加，保存显示名称映射
        if (this.currentPlatform === platform) {
            const storedModels = this.getStoredPlatformModels(platform);
            if (storedModels && Array.isArray(storedModels)) {
                const modelData = storedModels.find(m => m.id === modelId);
                if (modelData && modelData.name && modelData.name !== modelId) {
                    this.config[platform].modelNameMap[modelId] = modelData.name;
                }
            }
        }

        // 智能模型选择：如果当前没有选中模型，自动选择第一个添加的模型
        this.ensureCurrentModel(platform);

        // 保存配置
        this.saveConfigSimple();

        // 更新UI显示
        this.renderModelList(platform);

        // 检查是否需要更新主界面按钮显示
        this.checkAndUpdateMainInterfaceAfterModelChange(platform, modelId, 'added');

        return true;
    }

    // 智能模型选择：确保平台有当前选中的模型
    ensureCurrentModel(platform) {
        const serviceConfig = this.config[platform];
        if (!serviceConfig) return;

        // 如果当前没有选中模型，且有可用模型列表，自动选择第一个可用模型
        if (!serviceConfig.model && serviceConfig.modelList && serviceConfig.modelList.length > 0) {
            // 查找第一个状态为success的模型
            let firstAvailableModel = null;

            for (const modelId of serviceConfig.modelList) {
                const modelStatus = this.modelStatusManager.getModelStatus(platform, modelId);
                if (!modelStatus || modelStatus.status === 'success' || modelStatus.status === 'unknown') {
                    firstAvailableModel = modelId;
                    break;
                }
            }

            // 如果没有找到success状态的模型，使用第一个模型
            if (!firstAvailableModel) {
                firstAvailableModel = serviceConfig.modelList[0];
            }

            if (firstAvailableModel) {
                serviceConfig.model = firstAvailableModel;



                // 如果这是当前使用的平台，更新主界面显示
                const currentMode = this.getCurrentRecognitionMode();
                const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);
                if (modeConfig && modeConfig.service === platform) {
                    this.uiManager.updateCurrentService(platform, firstAvailableModel);
                }
            }
        }
    }

    // 检查并更新主界面按钮显示（在模型变化后）
    checkAndUpdateMainInterfaceAfterModelChange(platform, modelId, action) {
        try {
            const currentMode = this.getCurrentRecognitionMode();
            const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);

            // 如果当前没有配置任何模型，且新添加的模型属于可用平台，自动设置为当前模型
            if (action === 'added' && (!modeConfig || !modeConfig.service)) {
                // 检查新添加的模型是否可用
                const modelStatus = this.modelStatusManager.getModelStatus(platform, modelId);
                if (!modelStatus || modelStatus.status === 'success' || modelStatus.status === 'unknown') {
                    // 自动设置为当前识别模式的默认模型
                    const result = this.configManager.setRecognitionModeConfig(currentMode, platform, modelId);
                    if (result.success) {
                        this.config = result.config;
                        this.config.service = platform;

                        // 确保平台配置存在并更新模型
                        if (!this.config[platform]) {
                            this.config[platform] = {};
                        }
                        this.config[platform].model = modelId;

                        this.saveConfigSimple();

                        // 更新主界面显示
                        this.uiManager.updateCurrentService(platform, modelId);
                        this.updateMainPageStatus();


                    }
                }
            }
            // 如果删除的是当前正在使用的模型，需要切换到其他可用模型
            else if (action === 'deleted' && modeConfig && modeConfig.service === platform && modeConfig.model === modelId) {

                // 查找其他可用模型（重新获取以确保数据最新）
                const availableServices = this.getAvailableServicesForMainInterface();
                const availableForPlatform = availableServices.filter(s => s.value === platform && s.model !== modelId);

                if (availableForPlatform.length > 0) {
                    // 切换到同平台的其他模型
                    const newModel = availableForPlatform[0].model;
                    const result = this.configManager.setRecognitionModeConfig(currentMode, platform, newModel);
                    if (result.success) {
                        this.config = result.config;
                        this.saveConfigSimple();
                        this.uiManager.updateCurrentService(platform, newModel);
                        this.updateMainPageStatus();
                    }
                } else {
                    // 查找其他平台的可用模型
                    const otherAvailable = availableServices.filter(s => s.value !== platform);
                    if (otherAvailable.length > 0) {
                        const newService = otherAvailable[0];
                        const result = this.configManager.setRecognitionModeConfig(currentMode, newService.value, newService.model);
                        if (result.success) {
                            this.config = result.config;
                            this.config.service = newService.value;
                            this.saveConfigSimple();
                            this.uiManager.updateCurrentService(newService.value, newService.model);
                            this.updateMainPageStatus();
                        }
                    } else {
                        // 没有其他可用模型，清除配置
                        const result = this.configManager.setRecognitionModeConfig(currentMode, null, null);
                        if (result.success) {
                            this.config = result.config;
                            this.config.service = null;
                            this.saveConfigSimple();
                            this.uiManager.updateCurrentService(null, null);
                            this.updateMainPageStatus();
                        }
                    }
                }
            }
            // 如果删除的不是当前模型，但可能影响按钮显示，也需要检查
            else if (action === 'deleted') {
                // 检查删除后是否还有可用模型，如果没有则更新按钮显示
                const availableServices = this.getAvailableServicesForMainInterface();
                if (!availableServices || availableServices.length === 0) {
                    // 没有可用模型了，更新按钮显示
                    this.uiManager.updateCurrentService(null, null);
                    this.updateMainPageStatus();
                } else {
                    // 仍有可用模型，只需要更新状态
                    this.updateMainPageStatus();
                }
            }
            // 其他情况，只需要更新主页面状态
            else {
                this.updateMainPageStatus();
            }
        } catch (error) {
            console.error('检查并更新主界面按钮显示失败:', error);
        }
    }

    // 强制同步主界面按钮状态（用于确保状态一致性）
    forceSyncMainInterfaceButtonState() {
        try {
            const currentMode = this.getCurrentRecognitionMode();
            const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);
            const availableServices = this.getAvailableServicesForMainInterface();
            const hasAvailableModels = availableServices && availableServices.length > 0;

            // 如果有模式配置且有可用模型，验证当前配置是否仍然有效
            if (modeConfig && modeConfig.service && hasAvailableModels) {
                const currentServiceAvailable = availableServices.some(s =>
                    s.value === modeConfig.service &&
                    (s.model === modeConfig.model || !modeConfig.model)
                );

                if (currentServiceAvailable) {
                    // 当前配置仍然有效，更新显示
                    this.uiManager.updateCurrentService(modeConfig.service, modeConfig.model);
                } else {
                    // 当前配置无效，切换到第一个可用模型
                    const firstAvailable = availableServices[0];
                    const result = this.configManager.setRecognitionModeConfig(
                        currentMode,
                        firstAvailable.value,
                        firstAvailable.model
                    );
                    if (result.success) {
                        this.config = result.config;
                        this.config.service = firstAvailable.value;
                        this.saveConfigSimple();
                        this.uiManager.updateCurrentService(firstAvailable.value, firstAvailable.model);
                    }
                }
            } else if (hasAvailableModels) {
                // 没有模式配置但有可用模型，设置第一个可用模型
                const firstAvailable = availableServices[0];
                const result = this.configManager.setRecognitionModeConfig(
                    currentMode,
                    firstAvailable.value,
                    firstAvailable.model
                );
                if (result.success) {
                    this.config = result.config;
                    this.config.service = firstAvailable.value;
                    this.saveConfigSimple();
                    this.uiManager.updateCurrentService(firstAvailable.value, firstAvailable.model);
                }
            } else {
                // 没有可用模型，清除配置并显示提示
                if (modeConfig && modeConfig.service) {
                    const result = this.configManager.setRecognitionModeConfig(currentMode, null, null);
                    if (result.success) {
                        this.config = result.config;
                        this.config.service = null;
                        this.saveConfigSimple();
                    }
                }
                this.uiManager.updateCurrentService(null, null);
            }

            // 最后更新主页面状态
            this.updateMainPageStatus();

        } catch (error) {
            console.error('强制同步主界面按钮状态失败:', error);
        }
    }

    // 渲染模型列表
    renderModelList(platform) {
        const listContainer = document.getElementById(`${platform}-model-list`);
        if (!listContainer) return;

        const platformConfig = this.config[platform];
        const modelList = platformConfig?.modelList || [];

        if (modelList.length === 0) {
            listContainer.innerHTML = '<div class="model-list-empty">暂无模型，请点击"获取"或"添加"按钮添加模型</div>';
            return;
        }

        listContainer.innerHTML = modelList.map(modelId => {
            const testStatus = this.getModelTestStatus(platform, modelId);
            const statusClass = this.getTestStatusClass(testStatus);

            // 所有AI平台都尝试使用友好名称
            let displayName = modelId;
            const modelNameMap = platformConfig?.modelNameMap || {};
            displayName = modelNameMap[modelId] || modelId;

            // 获取服务图标
            const iconSvg = this.uiManager.getServiceIcon(platform);
            let iconHtml = '';
            if (iconSvg) {
                iconHtml = `<div class="model-icon" style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${iconSvg}</div>`;
            }

            // 获取模型能力并生成功能图标
            let capabilities = [];

            // 优先使用自定义能力
            const customCapabilities = platformConfig?.customCapabilities || {};
            if (customCapabilities[modelId] && Array.isArray(customCapabilities[modelId])) {
                capabilities = customCapabilities[modelId];
            } else {
                // 否则使用自动检测的能力
                // 对于uTools平台，尝试从存储的模型数据中获取能力信息
                if (platform === 'utools') {
                    const storedModels = this.getStoredPlatformModels(platform);
                    const modelData = (storedModels && Array.isArray(storedModels)) ? storedModels.find(m => m.id === modelId) : null;
                    capabilities = modelData?.capabilities || this.uiManager.getModelCapabilities(platform, modelId, modelData);
                } else {
                    capabilities = this.uiManager.getModelCapabilities(platform, modelId);
                }
            }
            const capabilityIconsHtml = this.uiManager.generateCapabilityIcons(capabilities);

            // 获取测试按钮的title
            let testButtonTitle = '点击测试模型连接';
            if (testStatus === 'success') {
                testButtonTitle = '测试成功';
            } else if (testStatus === 'failed') {
                // 获取错误信息
                const modelState = this.modelStatusManager.getModelStatus(platform, modelId);
                if (modelState?.error) {
                    testButtonTitle = `测试失败: ${modelState.error}`;
                } else {
                    testButtonTitle = '测试失败';
                }
            }

            // 转义模型ID中的特殊字符，避免在HTML属性中出现问题
            const escapedModelId = modelId.replace(/'/g, "\\'");

            return `
                <div class="model-item" data-model="${modelId}">
                    <div class="model-name" title="${modelId}" style="display: flex; align-items: center; gap: 8px;">
                        ${iconHtml}
                        <span style="flex: 1;">${displayName}</span>
                        ${capabilityIconsHtml}
                    </div>
                    <div class="model-item-actions">
                        <button type="button" class="model-test-btn ${statusClass}" onclick="window.ocrPlugin.testModel('${platform}', '${escapedModelId}')" title="${testButtonTitle}">测试</button>
                        <button type="button" class="model-settings-btn" onclick="window.ocrPlugin.openModelSettings('${platform}', '${escapedModelId}')" title="模型设置">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                        <button type="button" class="model-delete-btn" onclick="window.ocrPlugin.deleteModel('${platform}', '${escapedModelId}')" title="删除模型">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // 启用拖拽排序功能
        this.enableModelListDragSort(listContainer, platform);
    }

    // 启用拖拽排序的通用方法
    enableDragSort(listContainer, type, platform = null) {
        if (!listContainer || !this.dragSortManager) return;

        const sortConfigs = {
            model: {
                itemSelector: '.model-item',
                onSort: (fromIndex, toIndex) => {
                    const result = this.configManager.reorderPlatformModels(platform, fromIndex, toIndex);
                    if (result.success) {
                        this.config = result.config;
                        this.renderModelList(platform);
                        this.uiManager.refreshModelDropdown();
                    } else {
                        this.uiManager.showNotification('排序保存失败: ' + result.error, 'error');
                    }
                }
            },
            service: {
                itemSelector: '.service-item',
                onSort: (fromIndex, toIndex) => {
                    // 获取当前可见的服务项
                    const visibleItems = Array.from(document.querySelectorAll('.service-item:not(.category-hidden)'));

                    if (fromIndex >= visibleItems.length || toIndex >= visibleItems.length || fromIndex < 0 || toIndex < 0) {
                        this.uiManager.showNotification('排序索引超出范围', 'error');
                        return;
                    }

                    // 获取被拖拽的服务和目标位置的服务
                    const fromService = visibleItems[fromIndex]?.dataset?.service;
                    const toService = visibleItems[toIndex]?.dataset?.service;

                    if (!fromService) {
                        this.uiManager.showNotification('无法获取源服务信息', 'error');
                        return;
                    }

                    // 获取完整的服务顺序列表
                    const serviceOrder = this.configManager.getServiceOrder();
                    const globalFromIndex = serviceOrder.indexOf(fromService);

                    if (globalFromIndex === -1) {
                        this.uiManager.showNotification('源服务不在配置列表中', 'error');
                        return;
                    }

                    let globalToIndex;
                    if (toService) {
                        // 如果有目标服务，插入到目标服务位置
                        globalToIndex = serviceOrder.indexOf(toService);
                        if (globalToIndex === -1) {
                            this.uiManager.showNotification('目标服务不在配置列表中', 'error');
                            return;
                        }
                    } else {
                        // 如果没有目标服务，说明要移动到最后
                        globalToIndex = serviceOrder.length - 1;
                    }

                    // 使用全局索引进行重排序
                    const result = this.configManager.reorderServices(globalFromIndex, globalToIndex);
                    if (result.success) {
                        this.config = result.config;
                        this.uiManager.renderServiceList();
                    } else {
                        this.uiManager.showNotification('排序保存失败: ' + result.error, 'error');
                        this.uiManager.renderServiceList();
                    }
                }
            },
            translateModel: {
                itemSelector: '.model-item',
                onSort: (fromIndex, toIndex) => {
                    const result = this.configManager.reorderTranslateModels(fromIndex, toIndex);
                    if (result.success) {
                        this.config = result.config;
                        this.uiManager.refreshTranslateModelList();
                    } else {
                        this.uiManager.showNotification('排序保存失败: ' + result.error, 'error');
                    }
                }
            },
            imageTranslateModel: {
                itemSelector: '.model-item',
                onSort: (fromIndex, toIndex) => {
                    const result = this.configManager.reorderImageTranslateModels(fromIndex, toIndex);
                    if (result.success) {
                        this.config = result.config;
                        this.uiManager.refreshImageTranslateModelList();
                    } else {
                        this.uiManager.showNotification('排序保存失败: ' + result.error, 'error');
                    }
                }
            }
        };

        const config = sortConfigs[type];
        if (!config) return;

        this.dragSortManager.enableSortable(listContainer, {
            itemSelector: config.itemSelector,
            onSort: config.onSort,
            onStart: () => {
                // 拖拽开始时的回调
            },
            onEnd: () => {
                // 拖拽结束时的回调
            }
        });
    }

    // 启用模型列表拖拽排序（保持向后兼容）
    enableModelListDragSort(listContainer, platform) {
        this.enableDragSort(listContainer, 'model', platform);
    }

    // 获取存储的平台模型列表（使用统一存储管理器）
    getStoredPlatformModels(platform) {
        if (window.unifiedStorage) {
            return window.unifiedStorage.getModelListCache(platform);
        }
        return null;
    }

    // 存储平台模型列表（使用统一存储管理器）
    storePlatformModels(platform, models) {
        if (window.unifiedStorage) {
            return window.unifiedStorage.setModelListCache(platform, models);
        }
        return false;
    }

    // 获取存储的Google模型列表（保持向后兼容）
    getStoredGoogleModels() {
        return this.getStoredPlatformModels('google');
    }

    // 存储Google模型列表（保持向后兼容）
    storeGoogleModels(models) {
        return this.storePlatformModels('google', models);
    }

    // 处理获取模型弹窗的刷新按钮点击
    async handleFetchModelsRefresh() {
        if (!this.currentPlatform) {
            this.uiManager.showError('未选择平台');
            return;
        }

        // 添加刷新按钮状态管理
        const refreshBtn = document.getElementById('fetch-models-refresh');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.style.opacity = '0.6';
            refreshBtn.title = '正在刷新...';
        }

        try {
            await this.refreshPlatformModels(this.currentPlatform);
        } finally {
            // 恢复刷新按钮状态
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.style.opacity = '1';
                refreshBtn.title = '刷新模型列表';
            }
        }
    }

    // 刷新平台模型列表（手动刷新机制）
    async refreshPlatformModels(platform) {
        const loadingDiv = document.getElementById('fetch-models-loading');
        const listDiv = document.getElementById('fetch-models-list');
        const errorDiv = document.getElementById('fetch-models-error');

        // 显示加载状态
        loadingDiv.style.display = 'block';
        listDiv.style.display = 'none';
        errorDiv.style.display = 'none';

        try {
            // 清除该平台的缓存
            if (window.unifiedStorage) {
                window.unifiedStorage.clearModelListCache(platform);

            }

            // 获取API配置
            const apiKey = this.getElementValue(`${platform}-api-key`);
            const baseUrl = this.getElementValue(`${platform}-base-url`);

            if (!apiKey && platform !== 'utools' && platform !== 'ocrpro') {
                throw new Error('请先配置API Key');
            }

            let models;
            if (platform === 'ocrpro') {
                models = this.modelManager.getOcrProModels();
            } else {
                // 强制刷新，跳过缓存
                models = await this.modelManager.getModels(platform, apiKey, baseUrl, true);
            }

            // 隐藏加载状态
            loadingDiv.style.display = 'none';

            if (models && models.length > 0) {
                // 获取刷新前的模型状态，保留仍然存在的模型状态
                const currentStates = this.modelStatusManager.getPlatformModelsStatus(platform);
                const newModelIds = models.map(m => m.id);
                const currentModelIds = Object.keys(currentStates);

                // 更新存储的模型列表
                this.storePlatformModels(platform, models);

                // 只清除不再存在的模型状态，保留仍然存在的模型状态
                currentModelIds.forEach(modelId => {
                    if (!newModelIds.includes(modelId)) {
                        // 只清除已经不存在的模型状态
                        this.modelStatusManager.clearModelStatus(platform, modelId);
                    }
                });

                // 更新弹窗内容
                this.renderFetchModelsList(models);
                listDiv.style.display = 'block';

                // 显示刷新成功提示 - 使用友好的服务商名称
                const platformDisplayName = this.uiManager.getServiceDisplayName(platform);
                this.uiManager.showStatusResult(`${platformDisplayName} 模型列表`, 'success', `刷新成功，获取 ${models.length} 个可用模型`);
            } else {
                errorDiv.innerHTML = '未获取到可用模型';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            console.error(`刷新${platform}模型列表失败:`, error);
            loadingDiv.style.display = 'none';
            errorDiv.innerHTML = `刷新失败: ${error.message}`;
            errorDiv.style.display = 'block';
        }
    }

    // 刷新Google模型列表（手动刷新）
    async refreshGoogleModels() {
        const loadingDiv = document.getElementById('fetch-models-loading');
        const listDiv = document.getElementById('fetch-models-list');
        const errorDiv = document.getElementById('fetch-models-error');

        try {
            // 显示加载状态
            loadingDiv.style.display = 'block';
            listDiv.style.display = 'none';
            errorDiv.style.display = 'none';

            const apiKey = this.getElementValue('google-api-key');
            const baseUrl = this.getElementValue('google-base-url');

            if (!apiKey) {
                throw new Error('请先配置API Key');
            }

            // 强制重新获取模型列表（绕过缓存）
            const models = await this.modelManager.fetchModelsForPlatform('google', apiKey, baseUrl, this.modelManager.getPlatformInfo('google'));

            // 隐藏加载状态
            loadingDiv.style.display = 'none';

            if (models && models.length > 0) {
                // 获取刷新前的Google模型状态，保留仍然存在的模型状态
                const currentStates = this.modelStatusManager.getPlatformModelsStatus('google');
                const newModelIds = models.map(m => m.id);
                const currentModelIds = Object.keys(currentStates);

                // 更新存储的模型列表
                this.storeGoogleModels(models);

                // 只清除不再存在的模型状态，保留仍然存在的模型状态
                currentModelIds.forEach(modelId => {
                    if (!newModelIds.includes(modelId)) {
                        // 只清除已经不存在的模型状态
                        this.modelStatusManager.clearModelStatus('google', modelId);
                    }
                });

                // 更新弹窗内容
                this.renderFetchModelsList(models);
                listDiv.style.display = 'block';

                this.uiManager.showNotification('模型列表已刷新');
            } else {
                errorDiv.innerHTML = '未获取到可用模型';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            console.error('刷新Google模型列表失败:', error);
            loadingDiv.style.display = 'none';
            errorDiv.innerHTML = `刷新失败: ${error.message}`;
            errorDiv.style.display = 'block';
        }
    }

    // 获取模型测试状态 - 使用统一状态管理器
    getModelTestStatus(platform, modelId) {
        const modelStatus = this.modelStatusManager.getModelStatus(platform, modelId);
        // 将统一状态管理器的状态映射到原有的状态值，保持向后兼容
        switch (modelStatus.status) {
            case 'success':
                return 'success';
            case 'failed':
                return 'failed';
            case 'testing':
                return 'testing';
            default:
                return 'untested';
        }
    }

    // 清除平台所有模型的测试状态 - 使用统一状态管理器
    clearPlatformTestStatus(platform) {
        this.modelStatusManager.clearModelStatus(platform);
    }

    // 获取测试状态对应的CSS类
    getTestStatusClass(status) {
        switch (status) {
            case 'success':
                return 'test-status-success';
            case 'failed':
                return 'test-status-failed';
            case 'untested':
            default:
                return 'test-status-untested';
        }
    }

    // 更新主页面状态显示
    updateMainPageStatus() {
        try {
            const currentService = this.config?.service;

            // 获取当前服务的状态信息
            let statusInfo = this.determineMainPageServiceStatus(currentService);

            // 更新主页面识别状态显示
            this.uiManager.updateRecognitionStatus(statusInfo.status, statusInfo.message);

            // 更新主页面当前服务显示
            this.uiManager.updateCurrentService(currentService, statusInfo.modelName);


        } catch (error) {
            console.error('更新主页面状态失败:', error);
        }
    }

    // 确定主页面服务状态
    determineMainPageServiceStatus(serviceName) {
        // 如果没有配置服务，返回未配置状态
        if (!serviceName) {
            return { status: 'unconfigured', message: '请先配置模型', modelName: null };
        }

        // 检查是否为AI服务（包括自定义LLM服务商）
        const aiServices = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'];
        const isCustomProvider = this.configManager && this.configManager.isCustomLLMProvider
            ? this.configManager.isCustomLLMProvider(serviceName)
            : false;

        if (aiServices.includes(serviceName) || isCustomProvider) {
            return this.determineAIServiceStatus(serviceName);
        } else {
            return this.determineOCRServiceStatus(serviceName);
        }
    }

    // 确定AI服务状态
    determineAIServiceStatus(serviceName) {
        const platformConfig = this.config[serviceName];
        if (!platformConfig) {
            return { status: 'unconfigured', message: '未配置', modelName: null };
        }

        // 获取当前选中的模型 - 优先从识别模式配置获取
        const currentMode = this.currentRecognitionMode || 'text';
        const modeConfig = this.configManager.getRecognitionModeConfig(currentMode);

        let currentModel = null;

        // 改进的模型选择逻辑
        if (modeConfig && modeConfig.service === serviceName && modeConfig.model) {
            // 情况1: 识别模式配置了当前服务，且有模型配置
            currentModel = modeConfig.model;
        } else if (modeConfig && modeConfig.service !== serviceName) {
            // 情况2: 识别模式配置的服务与当前服务不匹配
            // 这种情况下，需要检查当前服务是否有配置的模型

            // 如果当前服务有模型配置，使用当前服务的模型
            if (platformConfig.model) {
                currentModel = platformConfig.model;
            } else {
                // 如果当前服务没有模型配置，说明可能需要用户手动配置
                if (serviceName !== 'utools' && !platformConfig.apiKey) {
                    return { status: 'unconfigured', message: '未配置API Key', modelName: null };
                }
                return { status: 'unconfigured', message: '未选择模型', modelName: null };
            }
        } else {
            // 情况3: 识别模式没有配置或配置了当前服务但没有模型 - 回退到平台默认模型
            if (platformConfig.model) {
                currentModel = platformConfig.model;
            } else {
                if (serviceName !== 'utools' && !platformConfig.apiKey) {
                    return { status: 'unconfigured', message: '未配置API Key', modelName: null };
                }
                return { status: 'unconfigured', message: '未选择模型', modelName: null };
            }
        }

        if (!currentModel) {
            return { status: 'unconfigured', message: '未选择模型', modelName: null };
        }

        // 从统一状态管理器获取模型状态
        const modelStatus = this.modelStatusManager.getModelStatus(serviceName, currentModel);

        // 获取模型的友好显示名称
        const modelDisplayName = this.getModelDisplayName(currentModel, serviceName);

        switch (modelStatus.status) {
            case 'success':
                return { status: 'ready', message: '就绪', modelName: modelDisplayName };
            case 'failed':
                return { status: 'error', message: '连接失败', modelName: modelDisplayName };
            case 'testing':
                return { status: 'processing', message: '测试中', modelName: modelDisplayName };
            default:
                // 对于未测试的模型，检查基本配置是否完整
                if (serviceName !== 'utools' && !platformConfig.apiKey) {
                    return { status: 'unconfigured', message: '未配置API Key', modelName: null };
                }
                // 未测试的模型显示为未测试状态，而不是就绪
                return { status: 'unknown', message: '未测试', modelName: modelDisplayName };
        }
    }

    // 确定传统OCR服务状态
    determineOCRServiceStatus(serviceName) {
        // 如果没有服务名称，返回未配置状态
        if (!serviceName) {
            return { status: 'unconfigured', message: '请先配置模型', modelName: null };
        }

        // 从缓存中获取传统OCR服务状态（现在采用永久存储策略，与AI模型服务保持一致）
        const cachedStatus = this.getCachedServiceStatus(serviceName);
        if (cachedStatus && cachedStatus.status) {
            return {
                status: cachedStatus.status.type,
                message: cachedStatus.status.message,
                modelName: serviceName // 传递服务名称作为模型标识
            };
        }

        // 检查服务配置是否存在，避免对未配置的服务进行不必要的检查
        const serviceConfig = this.config[serviceName];
        if (!serviceConfig) {
            return { status: 'unconfigured', message: '未配置', modelName: null };
        }

        // 检查是否已配置（只对有配置的服务进行检查）
        const isConfigured = this.isServiceConfigured(serviceName);
        if (!isConfigured) {
            return { status: 'unconfigured', message: '未配置', modelName: null };
        }

        // 默认返回就绪状态
        return { status: 'ready', message: '就绪', modelName: serviceName };
    }



    // 更新模型筛选下拉菜单
    updateModelFilterMenus() {
        try {
            // 获取所有可用模型
            const availableModels = this.modelStatusManager.getAvailableModels();

            // 更新识别模式配置中的模型选择菜单
            const modes = ['text', 'table', 'formula', 'markdown'];
            modes.forEach(mode => {
                this.updateRecognitionModeModelMenu(mode, availableModels);
            });


        } catch (error) {
            console.error('更新模型筛选菜单失败:', error);
        }
    }

    // 更新识别模式模型菜单
    updateRecognitionModeModelMenu(mode) {
        try {
            // 触发UI管理器重新初始化该模式的模型菜单
            if (this.uiManager && this.uiManager.initRecognitionModeModelMenu) {
                this.uiManager.initRecognitionModeModelMenu(mode);
            }
        } catch (error) {
            console.error(`更新识别模式 ${mode} 模型菜单失败:`, error);
        }
    }

    // 更新测试按钮状态
    updateTestButtonStatus(platform, modelId, status) {
        // 更精确地定位到特定平台的模型项
        const listContainer = document.getElementById(`${platform}-model-list`);
        if (!listContainer) return;

        const modelItem = listContainer.querySelector(`[data-model="${modelId}"]`);
        if (modelItem) {
            const testBtn = modelItem.querySelector('.model-test-btn');
            if (testBtn) {
                // 移除所有状态类
                testBtn.classList.remove('test-status-untested', 'test-status-success', 'test-status-failed');
                // 添加新状态类
                testBtn.classList.add(this.getTestStatusClass(status));

                // 获取模型状态详情，包括错误信息
                const modelState = this.modelStatusManager.getModelStatus(platform, modelId);

                // 根据状态设置按钮文本和title
                if (status === 'testing') {
                    testBtn.textContent = '测试中...';
                    testBtn.title = '正在测试模型连接';
                } else if (status === 'success') {
                    testBtn.textContent = '测试';
                    testBtn.title = '测试成功';
                } else if (status === 'failed' && modelState?.error) {
                    testBtn.textContent = '测试';
                    testBtn.title = `测试失败: ${modelState.error}`;
                } else {
                    testBtn.textContent = '测试';
                    testBtn.title = '点击测试模型连接';
                }
            }
        } else {
            console.warn(`未找到 ${platform} 平台的模型项: ${modelId}`);
        }
    }

    // 删除模型
    deleteModel(platform, modelId) {
        try {
            // 获取模型显示名称（uTools使用友好名称，其他使用原始API名称）（在删除前获取）
            const displayName = this.getModelDisplayName(modelId, platform);

            // 获取平台配置
            if (!this.config[platform]) {
                this.uiManager.showError('平台配置不存在');
                return;
            }

            // 获取模型列表
            const modelList = this.config[platform].modelList || [];
            const modelIndex = modelList.indexOf(modelId);

            if (modelIndex === -1) {
                this.uiManager.showError('模型不存在');
                return;
            }

            // 从列表中移除模型
            modelList.splice(modelIndex, 1);
            this.config[platform].modelList = modelList;

            // 清除模型名称映射
            if (this.config[platform].modelNameMap && this.config[platform].modelNameMap[modelId]) {
                delete this.config[platform].modelNameMap[modelId];
            }

            // 使用新的状态管理器清除该模型的状态
            this.modelStatusManager.clearModelStatus(platform, modelId);

            // 保存配置
            this.saveConfigSimple();

            // 重新渲染模型列表
            this.renderModelList(platform);

            // 检查是否需要更新主界面按钮显示
            this.checkAndUpdateMainInterfaceAfterModelChange(platform, modelId, 'deleted');

            this.uiManager.showNotification(`模型 ${displayName} 已删除`);
        } catch (error) {
            console.error('删除模型失败:', error);
            this.uiManager.showError(`删除模型失败: ${error.message}`);
        }
    }

    // 测试模型
    async testModel(platform, modelId) {
        try {
            // 获取友好的模型显示名称
            const displayName = this.getModelDisplayName(modelId, platform);

            // 更新状态为测试中
            this.modelStatusManager.updateModelStatus(platform, modelId, 'testing');
            this.uiManager.showNotification(`正在测试模型 ${displayName}...`);

            // 实现实际的模型测试逻辑
            const testResult = await this.performActualModelTest(platform, modelId);

            if (testResult.success) {
                // 测试成功 - 使用统一状态管理器，事件系统会自动更新UI
                this.modelStatusManager.updateModelStatus(platform, modelId, 'success');
                this.uiManager.showNotification(`模型 ${displayName} 测试成功`);
            } else {
                // 测试失败 - 使用统一状态管理器，事件系统会自动更新UI
                this.modelStatusManager.updateModelStatus(platform, modelId, 'failed', testResult.error);
                this.uiManager.showError(`模型 ${displayName} 测试失败: ${testResult.error}`);
            }
        } catch (error) {
            // 获取友好的模型显示名称用于错误消息
            const displayName = this.getModelDisplayName(modelId, platform);
            // 测试异常 - 使用统一状态管理器，事件系统会自动更新UI
            this.modelStatusManager.updateModelStatus(platform, modelId, 'failed', error.message);
            this.uiManager.showError(`模型 ${displayName} 测试失败: ${error.message}`);
        }
    }

    // 执行实际的模型测试
    async performActualModelTest(platform, modelId) {
        try {
            // 获取平台配置
            const platformConfig = this.config[platform];
            if (!platformConfig) {
                return { success: false, error: '平台配置不存在' };
            }

            const apiKey = platformConfig.apiKey;
            const baseUrl = platformConfig.baseUrl || this.modelManager.getPlatformInfo(platform)?.baseUrl;

            if (!apiKey && platform !== 'utools' && platform !== 'ocrpro') {
                return { success: false, error: 'API Key未配置' };
            }

            // 处理自定义服务商（custom_* 前缀）
            if (this.configManager.isCustomLLMProvider(platform)) {
                // 获取自定义服务商的平台类型
                const provider = this.configManager.getCustomLLMProviderMeta(platform);
                if (!provider) {
                    return { success: false, error: '自定义服务商配置不存在' };
                }

                const platformType = provider.platformType;

                // 根据平台类型调用对应的测试方法
                switch (platformType) {
                    case 'openai':
                        return await this.testOpenAIModel(modelId, apiKey, baseUrl);
                    case 'google':
                        return await this.testGoogleModel(modelId, apiKey, baseUrl);
                    case 'anthropic':
                        return await this.testAnthropicModel(modelId, apiKey, baseUrl);
                    default:
                        return { success: false, error: `不支持的平台类型: ${platformType}` };
                }
            }

            // 根据平台执行不同的测试逻辑（内置服务商）
            switch (platform) {
                case 'google':
                    return await this.testGoogleModel(modelId, apiKey, baseUrl);
                case 'openai':
                    return await this.testOpenAIModel(modelId, apiKey, baseUrl);
                case 'anthropic':
                    return await this.testAnthropicModel(modelId, apiKey, baseUrl);
                case 'alibaba':
                    return await this.testAlibabaModel(modelId, apiKey, baseUrl);
                case 'bytedance':
                    return await this.testByteDanceModel(modelId, apiKey, baseUrl);
                case 'zhipu':
                    return await this.testZhipuModel(modelId, apiKey, baseUrl);
                case 'ocrpro':
                    return await this.testOcrProModel(modelId);
                case 'utools':
                    return await this.testUtoolsModel(modelId);
                default:
                    return { success: false, error: '不支持的平台' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 测试Google Gemini模型（仅文本测试）
    async testGoogleModel(modelId, apiKey, baseUrl) {
        try {
            // 统一使用纯文本测试，避免对视觉能力有硬依赖
            const payload = {
                contents: [{
                    parts: [{ text: 'hello' }]
                }]
            };

            // 使用统一的 URL 构造函数
            const url = window.urlUtils.buildGeminiContentUrl(baseUrl, modelId, apiKey, { stream: false });

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
                return {
                    success: false,
                    error: errorMsg
                };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 测试OpenAI模型（仅文本测试）
    async testOpenAIModel(modelId, apiKey, baseUrl) {
        try {
            // 统一使用纯文本测试
            const payload = {
                model: modelId,
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 10
            };

            // 使用统一的 URL 构造函数
            const url = window.urlUtils.buildOpenAIChatUrl(baseUrl, 'https://api.openai.com');

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
                return {
                    success: false,
                    error: errorMsg
                };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 测试OCR Pro模型
    async testOcrProModel(modelId) {
        try {
            // 首先检查OCR Pro免费额度
            if (window.ocrProQuotaManager) {
                const ocrQuota = window.ocrProQuotaManager.checkOCRQuota();
                const translateQuota = window.ocrProQuotaManager.checkTranslateQuota();

                if (!ocrQuota.hasQuota && !translateQuota.hasQuota) {
                    return {
                        success: false,
                        error: '今日OCR和翻译免费额度均已用完，请明天再试'
                    };
                } else if (!ocrQuota.hasQuota) {
                    return {
                        success: false,
                        error: '今日OCR免费额度已用完，翻译功能仍可用'
                    };
                } else if (!translateQuota.hasQuota) {
                    return {
                        success: false,
                        error: '今日翻译免费额度已用完，OCR功能仍可用'
                    };
                }
            }

            // 使用预设的API凭证进行测试（统一为文本请求）
            const presetApiKey = 'sk-lvDbg9jGPK1CJfPVmSTb4Fp7GFNrp87MS3j2ziyIVTOO0cCX';
            const presetBaseUrl = 'https://api.jlws.top';

            const payload = {
                contents: [{
                    parts: [{ text: "测试连接" }]
                }]
            };

            const url = `${presetBaseUrl}/v1beta/models/${modelId}:generateContent?key=${presetApiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.error?.message || `HTTP ${response.status}`;

                // 检查是否是额度相关的错误
                if (errorMsg.includes('quota') || errorMsg.includes('exhausted') || errorMsg.includes('limit')) {
                    // 重新检查额度状态，返回友好的错误信息
                    if (window.ocrProQuotaManager) {
                        const ocrQuota = window.ocrProQuotaManager.checkOCRQuota();
                        const translateQuota = window.ocrProQuotaManager.checkTranslateQuota();

                        if (!ocrQuota.hasQuota && !translateQuota.hasQuota) {
                            return {
                                success: false,
                                error: '今日OCR和翻译免费额度均已用完，请明天再试'
                            };
                        } else if (!ocrQuota.hasQuota) {
                            return {
                                success: false,
                                error: '今日OCR免费额度已用完，翻译功能仍可用'
                            };
                        } else if (!translateQuota.hasQuota) {
                            return {
                                success: false,
                                error: '今日翻译免费额度已用完，OCR功能仍可用'
                            };
                        }
                    }
                    // 如果额度管理器不可用，返回通用的额度错误信息
                    return {
                        success: false,
                        error: '今日免费额度已用完，请明天再试'
                    };
                }

                return {
                    success: false,
                    error: errorMsg
                };
            }
        } catch (error) {
            // 检查是否是网络错误或其他可能与额度相关的错误
            const errorMsg = error.message || error.toString();
            if (errorMsg.includes('quota') || errorMsg.includes('exhausted') || errorMsg.includes('limit')) {
                // 重新检查额度状态
                if (window.ocrProQuotaManager) {
                    const ocrQuota = window.ocrProQuotaManager.checkOCRQuota();
                    const translateQuota = window.ocrProQuotaManager.checkTranslateQuota();

                    if (!ocrQuota.hasQuota && !translateQuota.hasQuota) {
                        return {
                            success: false,
                            error: '今日OCR和翻译免费额度均已用完，请明天再试'
                        };
                    } else if (!ocrQuota.hasQuota) {
                        return {
                            success: false,
                            error: '今日OCR免费额度已用完，翻译功能仍可用'
                        };
                    } else if (!translateQuota.hasQuota) {
                        return {
                            success: false,
                            error: '今日翻译免费额度已用完，OCR功能仍可用'
                        };
                    }
                }
                return {
                    success: false,
                    error: '今日免费额度已用完，请明天再试'
                };
            }

            return { success: false, error: errorMsg };
        }
    }

    // 测试uTools模型
    async testUtoolsModel(modelId) {
        try {
            if (typeof utools === 'undefined' || !utools.allAiModels) {
                return { success: false, error: 'uTools AI API不可用' };
            }

            // 检查模型是否在可用列表中
            const availableModels = await utools.allAiModels();
            const modelInfo = availableModels.find(model => model.id === modelId);

            if (!modelInfo) {
                return { success: false, error: '模型不在可用列表中' };
            }

            // 检查是否是视觉模型
            const isVisionModel = this.isVisionModel(modelInfo.id, 'utools');

            // 进行实际的API测试
            if (!utools.ai) {
                return { success: false, error: 'uTools AI API不可用' };
            }

            let testMessages;
            if (isVisionModel) {
                // 对于视觉模型，使用图片测试
                const testImageBase64 = this.createTestImage();
                testMessages = [{
                    role: 'user',
                    content: [
                        { type: 'text', content: 'hello' },
                        { type: 'image', content: testImageBase64 }
                    ]
                }];
            } else {
                // 对于非视觉模型，使用纯文本测试
                testMessages = [{
                    role: 'user',
                    content: 'hello'
                }];
            }

            // 使用uTools AI API进行测试
            const aiOptions = {
                messages: testMessages,
                model: modelId
            };

            // 简单的测试调用
            await new Promise((resolve, reject) => {
                let hasResponse = false;
                const timeout = setTimeout(() => {
                    if (!hasResponse) {
                        reject(new Error('测试超时'));
                    }
                }, 10000); // 10秒超时

                utools.ai(aiOptions, (chunk) => {
                    if (!hasResponse) {
                        hasResponse = true;
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 测试智谱AI模型（仅文本测试）
    async testZhipuModel(modelId, apiKey, baseUrl) {
        try {
            const raw = window.urlUtils.checkRawUrlMarker(baseUrl);
            const chatBase = window.urlUtils.buildZhipuChatBase(baseUrl);
            const url = raw !== null ? raw : `${chatBase}/chat/completions`;

            const payload = {
                model: modelId,
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 10
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'OCR-Plugin/1.0'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                await response.json().catch(() => ({}));
                return { success: true };
            } else {
                const errorText = await response.text();
                let errorMsg = `HTTP ${response.status}`;
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error && errorData.error.message) {
                        errorMsg = errorData.error.message;
                    } else if (errorData.message) {
                        errorMsg = errorData.message;
                    }
                } catch (e) {
                    errorMsg = errorText || errorMsg;
                }
                return { success: false, error: errorMsg };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 获取平台基础配置状态（不包括模型状态）
    getPlatformConfigStatus(platform) {
        const serviceConfig = this.config[platform];
        if (!serviceConfig) {
            return 'unconfigured';
        }

        switch (platform) {
            case 'native':
                // 本地主机OCR不需要配置，总是配置状态
                return serviceConfig.enabled !== false ? 'configured' : 'unconfigured';
            case 'baidu':
                return (serviceConfig.apiKey && serviceConfig.secretKey) ? 'configured' : 'unconfigured';
            case 'tencent':
                return (serviceConfig.secretId && serviceConfig.secretKey) ? 'configured' : 'unconfigured';
            case 'aliyun':
                return (serviceConfig.accessKey && serviceConfig.accessSecret) ? 'configured' : 'unconfigured';
            case 'deeplx':
                return serviceConfig.apiUrl ? 'configured' : 'unconfigured';
            case 'youdao':
                return (serviceConfig.appKey && serviceConfig.appSecret) ? 'configured' : 'unconfigured';
            case 'openai':
            case 'anthropic':
            case 'google':
            case 'alibaba':
            case 'bytedance':
            case 'zhipu':
            case 'custom':
                // AI平台只检查API Key，不检查模型
                return serviceConfig.apiKey ? 'configured' : 'unconfigured';
            case 'utools':
                // uTools平台不需要API Key，总是配置状态
                return 'configured';
            default:
                return 'unconfigured';
        }
    }

    // 更新服务商状态指示器 - 使用统一状态管理器
    updateServiceIndicatorStatus(platform) {
        // 对于传统OCR服务和传统翻译服务，检查配置状态和缓存的测试结果
        if (['native', 'baidu', 'tencent', 'aliyun', 'volcano', 'deeplx', 'youdao', 'baiduFanyi'].includes(platform)) {
            const isConfigured = this.isServiceConfigured(platform);
            if (!isConfigured) {
                // 传统服务未配置，显示为未配置状态
                this.uiManager.updateConfigServiceStatus(platform, 'unconfigured');
                return;
            }

            // 检查是否有缓存的测试结果
            const cachedStatus = this.getCachedServiceStatus(platform);
            if (cachedStatus && cachedStatus.status) {
                // 使用缓存的测试结果状态
                this.uiManager.updateConfigServiceStatus(platform, cachedStatus.status.type);
            } else {
                // 配置完整但没有测试结果，显示为未知状态
                this.uiManager.updateConfigServiceStatus(platform, 'unknown');
            }
            return;
        }

        // 对于AI模型服务，使用统一状态管理器
        const platformConfig = this.config[platform];

        // 检查基本配置（API Key等）
        const hasBasicConfig = this.isServiceConfigured(platform);
        if (!hasBasicConfig) {
            this.uiManager.updateConfigServiceStatus(platform, 'unconfigured');
            return;
        }

        const modelList = platformConfig?.modelList || [];
        if (modelList.length === 0) {
            // 有基本配置但未添加任何模型 - 显示为未配置
            this.uiManager.updateConfigServiceStatus(platform, 'unconfigured');
            return;
        }

        // 使用统一状态管理器获取平台状态汇总
        const platformSummary = this.modelStatusManager.getPlatformSummaryStatus(platform);

        // 根据平台状态汇总映射到UI状态
        let uiStatus;
        switch (platformSummary.status) {
            case 'success':
                uiStatus = 'ready'; // 至少有一个模型连接成功
                break;
            case 'failed':
                uiStatus = 'error'; // 所有模型都连接失败
                break;
            case 'testing':
                uiStatus = 'processing'; // 有模型正在测试中
                break;
            default:
                uiStatus = 'unknown'; // 未知状态（有未测试的模型）
                break;
        }

        this.uiManager.updateConfigServiceStatus(platform, uiStatus);
    }

    // 更新所有服务的状态指示器 - 使用服务顺序配置，包含自定义服务商
    updateAllServiceIndicators() {
        const serviceOrder = this.configManager && this.configManager.getServiceOrder
            ? this.configManager.getServiceOrder()
            : ['baidu', 'tencent', 'aliyun', 'volcano', 'deeplx', 'youdao', 'openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'];

        serviceOrder.forEach(serviceName => {
            this.updateServiceIndicatorStatus(serviceName);
        });
    }



    // 修复配置问题
    fixConfigurationIssues() {
        // 避免重复修复，使用时间戳检查
        const now = Date.now();
        if (this._lastFixTime && (now - this._lastFixTime) < 10000) { // 10秒内不重复修复
            return;
        }

        const platforms = ['google', 'utools', 'openai', 'anthropic', 'alibaba', 'bytedance', 'zhipu'];
        let hasChanges = false;
        let fixedPlatforms = [];

        platforms.forEach(platform => {
            const platformConfig = this.config[platform];
            if (!platformConfig) return;

            // 检查是否有API Key但没有默认模型的情况
            const hasApiKey = platform === 'utools' || !!platformConfig.apiKey;
            const hasModelList = platformConfig.modelList && platformConfig.modelList.length > 0;
            const hasDefaultModel = !!platformConfig.model;

            if (hasApiKey && hasModelList && !hasDefaultModel) {
                // 优先选择测试成功的模型
                const successfulModel = platformConfig.modelList.find(modelId => {
                    const status = this.modelStatusManager.getModelStatus(platform, modelId);
                    return status.status === 'success';
                });

                if (successfulModel) {
                    platformConfig.model = successfulModel;
                    fixedPlatforms.push(`${platform}(${successfulModel})`);
                    hasChanges = true;
                } else {
                    // 如果没有成功的模型，选择第一个模型
                    platformConfig.model = platformConfig.modelList[0];
                    fixedPlatforms.push(`${platform}(${platformConfig.modelList[0]})`);
                    hasChanges = true;
                }
            }
        });

        // 如果有修改，保存配置
        if (hasChanges) {
            const result = this.configManager.saveConfig(this.config);
            if (result.success) {
                this.config = result.config;


                // 清除服务缓存
                this.clearServiceCache();

                // 更新所有服务状态指示器
                this.updateAllServiceIndicators();

                // 记录修复时间
                this._lastFixTime = now;
            } else {
                console.error('[配置修复] 保存修复后的配置失败:', result.error);
            }
        } else {
            // 即使没有修复也记录时间，避免频繁检查
            this._lastFixTime = now;
        }
    }

    // 更新识别模式模型按钮显示
    updateRecognitionModeModelButton(mode) {
        const modeConfig = this.configManager.getRecognitionModeConfig(mode);
        const modelBtn = document.getElementById(`${mode}-model-btn`);
        const modelText = modelBtn?.querySelector('.model-text');

        if (modelText && modeConfig) {
            const serviceName = this.uiManager.getServiceDisplayName(modeConfig.service, modeConfig.model);
            modelText.textContent = serviceName || '请选择模型';
        }
    }

    // 测试Anthropic模型（仅文本测试）
    async testAnthropicModel(modelId, apiKey, baseUrl) {
        try {
            // 使用统一的 URL 构造函数
            const url = window.urlUtils.buildAnthropicMessagesUrl(baseUrl);

            // 统一使用纯文本请求
            const payload = {
                model: modelId,
                max_tokens: 10,
                messages: [{ role: 'user', content: 'hello' }]
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                return {
                    success: false,
                    error: errorData.error?.message || `HTTP ${response.status}`
                };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 测试阿里云百炼模型（仅文本测试）
    async testAlibabaModel(modelId, apiKey, baseUrl) {
        try {
            // 检查是否为Qwen-MT模型，需要特殊处理
            const isQwenMT = modelId && (modelId.includes('qwen-mt') || modelId === 'qwen-mt-plus' || modelId === 'qwen-mt-turbo');

            if (isQwenMT) {
                return await this.testQwenMTModel(modelId, apiKey);
            }

            const raw = window.urlUtils.checkRawUrlMarker(baseUrl);
            const chatBase = window.urlUtils.buildDashscopeChatBase(baseUrl);
            const url = raw !== null ? raw : `${chatBase}/chat/completions`;

            // 统一使用纯文本测试
            const payload = {
                model: modelId,
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 10
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return { success: true };
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
                return {
                    success: false,
                    error: errorMsg
                };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // 测试Qwen-MT翻译模型
    async testQwenMTModel(modelId, apiKey) {
        try {
            // 构建Qwen-MT测试请求 - 使用正确的messages格式
            const requestBody = {
                model: modelId,
                input: {
                    messages: [
                        {
                            role: "user",
                            content: "hello"
                        }
                    ]
                },
                parameters: {
                    translation_options: {
                        source_lang: "en",
                        target_lang: "zh"
                    },
                    result_format: "message"
                }
            };

            const apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch (e) {
                    errorData = { message: errorText };
                }
                const errorMsg = errorData.error?.message || errorData.message || `HTTP ${response.status}`;
                return { success: false, error: errorMsg };
            }

            const data = await response.json();

            // 检查响应格式
            if (data.output && data.output.text) {
                return { success: true, message: 'Qwen-MT模型测试成功' };
            } else if (data.output && data.output.choices && data.output.choices[0] && data.output.choices[0].message) {
                return { success: true, message: 'Qwen-MT模型测试成功' };
            } else {
                return { success: false, error: '响应格式异常' };
            }
        } catch (error) {
            console.error(`[Qwen-MT测试] 异常:`, error);
            return { success: false, error: error.message };
        }
    }

    // 测试火山引擎模型（仅文本测试）
    async testByteDanceModel(modelId, apiKey, baseUrl) {
        try {
            const raw = window.urlUtils.checkRawUrlMarker(baseUrl);
            const chatBase = window.urlUtils.buildVolcArkChatBase(baseUrl);
            const url = raw !== null ? raw : `${chatBase}/chat/completions`;

            const payload = {
                model: modelId,
                messages: [{ role: 'user', content: 'hello' }],
                max_tokens: 10,
                temperature: 0.1
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json',
                    'User-Agent': 'OCR-Plugin/1.0'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                await response.json().catch(() => ({}));
                return { success: true };
            } else {
                const errorText = await response.text();
                console.error(`[火山引擎测试] 测试失败 (${response.status}):`, errorText);

                let errorMessage;
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.error?.message || errorData.message || `HTTP ${response.status}`;
                } catch {
                    errorMessage = errorText || `HTTP ${response.status}`;
                }

                return {
                    success: false,
                    error: errorMessage
                };
            }
        } catch (error) {
            console.error(`[火山引擎测试] 网络错误:`, error);
            return { success: false, error: error.message };
        }
    }

    // 检测是否为视觉模型 - 使用ModelCapabilityDetector进行智能检测
    isVisionModel(modelId, platform = null) {
        if (!modelId) return false;

        // 优先使用ModelCapabilityDetector进行智能检测
        if (window.modelCapabilityDetector) {
            // 如果没有指定平台，尝试从当前上下文推断
            if (!platform) {
                // 从模型ID推断平台
                const modelLower = modelId.toLowerCase();
                if (modelLower.includes('gpt') || modelLower.includes('openai')) {
                    platform = 'openai';
                } else if (modelLower.includes('claude')) {
                    platform = 'anthropic';
                } else if (modelLower.includes('gemini')) {
                    platform = 'google';
                } else if (modelLower.includes('qwen')) {
                    platform = 'alibaba';
                } else if (modelLower.includes('doubao')) {
                    platform = 'bytedance';
                } else if (modelLower.includes('glm') || modelLower.includes('chatglm')) {
                    platform = 'zhipu';
                } else if (modelLower.includes('deepseek')) {
                    platform = 'deepseek';
                }
            }

            if (platform) {
                // uTools模型需要特殊处理
                if (platform === 'utools') {
                    const capabilities = window.modelCapabilityDetector.detectUtoolsModelCapabilities(modelId);
                    return capabilities.includes('vision');
                } else {
                    return window.modelCapabilityDetector.hasVisionCapability(platform, modelId);
                }
            }
        }

        // 降级方案：使用关键词匹配
        const visionKeywords = [
            'vision', 'visual', 'vl', 'ocr', 'image', 'multimodal', 'multi-modal',
            'qwen-vl', 'qwen2-vl', 'qwen-max', 'qwen-plus',
            'gpt-4', 'gpt4', 'claude-3', 'claude3', 'gemini',
            'doubao-vision', 'yi-vision'
        ];

        const modelLower = modelId.toLowerCase();
        return visionKeywords.some(keyword => modelLower.includes(keyword));
    }

    // 创建测试图片（简单的白底黑字"TEST"）
    createTestImage() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 100;
            const ctx = canvas.getContext('2d');

            // 白色背景
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, 200, 100);

            // 黑色文字
            ctx.fillStyle = 'black';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('测试', 100, 50);

            return canvas.toDataURL('image/png');
        } catch (error) {
            console.warn('创建测试图片失败:', error);
            // 返回一个最小的白色图片
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
        }
    }

    // 处理OCR识别过程中的模型成功
    handleOCRModelSuccess(serviceName, modelId) {
        // 只处理AI模型服务的成功（包括自定义LLM服务商）
        const isAIPlatform = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'].includes(serviceName)
            || (this.configManager && this.configManager.isCustomLLMProvider && this.configManager.isCustomLLMProvider(serviceName));

        if (!isAIPlatform || !modelId) {
            return;
        }

        // 使用统一状态管理器更新模型状态为成功
        this.modelStatusManager.updateModelStatus(serviceName, modelId, 'success');

        // 立即更新主页面状态显示
        this.updateMainPageStatus();
    }

    // 处理OCR识别过程中的服务/模型失败
    handleOCRModelFailure(serviceName, modelId, errorMessage) {
        // 检查错误类型，确定是否应该标记为失败状态
        if (!this.isModelConnectionError(errorMessage)) {
            return;
        }

        // 处理传统OCR服务和传统翻译服务的失败
        const traditionalServices = ['baidu', 'tencent', 'aliyun', 'volcano', 'deeplx', 'youdao'];
        if (traditionalServices.includes(serviceName)) {
            // 为传统服务设置失败状态
            const failureStatus = {
                type: 'error',
                message: this.formatTraditionalOCRError(errorMessage)
            };

            // 更新传统服务状态缓存
            this.setCachedServiceStatus(serviceName, failureStatus);

            // 立即更新主页面状态显示
            this.updateMainPageStatus();
            return;
        }

        // 处理AI模型服务的失败（包括自定义LLM服务商）
        const isAIPlatformForFailure = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools', 'custom'].includes(serviceName)
            || (this.configManager && this.configManager.isCustomLLMProvider && this.configManager.isCustomLLMProvider(serviceName));

        if (isAIPlatformForFailure) {
            // 如果没有modelId，尝试从当前配置中获取
            if (!modelId) {
                const serviceConfig = this.config[serviceName];
                modelId = serviceConfig?.model;
                if (!modelId) {
                    console.warn(`无法确定${serviceName}服务的模型ID`);
                    return;
                }
            }

            // 使用统一状态管理器更新模型状态为失败
            this.modelStatusManager.updateModelStatus(serviceName, modelId, 'failed', errorMessage);

            // 立即更新主页面状态显示
            this.updateMainPageStatus();
        }
    }

    // 判断是否是模型连接错误
    isModelConnectionError(errorMessage) {
        if (!errorMessage) return false;

        const modelErrorKeywords = [
            'model not found', 'model not available', 'invalid model',
            'model does not exist', 'model not supported',
            'unauthorized', 'forbidden', 'access denied',
            'api key', 'authentication', 'permission',
            'quota exceeded', 'rate limit', 'limit exceeded',
            'timeout', 'connection', 'network error',
            '模型不存在', '模型不可用', '无效模型',
            '未授权', '访问被拒绝', '权限不足',
            '配额超限', '速率限制', '连接超时',
            // 传统OCR服务错误关键词
            'invalid api key', 'invalid secret key', 'invalid access key',
            'invalid credentials', 'authentication failed',
            'access token', 'signature', 'authorization',
            '无效的API Key', '无效的密钥', '认证失败',
            '签名错误', '授权失败', '密钥错误'
        ];

        const lowerError = errorMessage.toLowerCase();
        return modelErrorKeywords.some(keyword =>
            lowerError.includes(keyword.toLowerCase())
        );
    }

    // 格式化传统OCR服务错误信息
    formatTraditionalOCRError(errorMessage) {
        if (!errorMessage) return '服务连接失败';

        const lowerError = errorMessage.toLowerCase();

        // 根据错误类型返回用户友好的错误信息
        if (lowerError.includes('api key') || lowerError.includes('secret key') ||
            lowerError.includes('access key') || lowerError.includes('密钥')) {
            return 'API密钥配置错误';
        }

        if (lowerError.includes('unauthorized') || lowerError.includes('401') ||
            lowerError.includes('authentication') || lowerError.includes('认证失败')) {
            return '认证失败，请检查密钥配置';
        }

        if (lowerError.includes('forbidden') || lowerError.includes('403') ||
            lowerError.includes('access denied') || lowerError.includes('权限')) {
            return '访问被拒绝，请检查权限设置';
        }

        if (lowerError.includes('quota') || lowerError.includes('limit') ||
            lowerError.includes('配额') || lowerError.includes('限制')) {
            return '配额不足或请求频率过高';
        }

        if (lowerError.includes('timeout') || lowerError.includes('network') ||
            lowerError.includes('connection') || lowerError.includes('超时')) {
            return '网络连接超时';
        }

        // 默认返回简化的错误信息
        return '服务连接失败';
    }

    // 尝试自动切换到同平台的其他可用模型
    tryAutoSwitchModel(platform, failedModelId) {
        // 检查是否启用了自动故障恢复功能
        const autoModelSwitch = this.config.ui?.autoModelSwitch;
        if (!autoModelSwitch) {
            return;
        }

        const platformConfig = this.config[platform];
        if (!platformConfig || !platformConfig.modelList) {
            return;
        }

        // 查找同平台的其他可用模型
        const availableModels = platformConfig.modelList.filter(modelId => {
            if (modelId === failedModelId) return false;
            const testStatus = this.getModelTestStatus(platform, modelId);
            return testStatus === 'success';
        });

        if (availableModels.length > 0) {
            // 切换到第一个可用模型
            const newModelId = availableModels[0];

            // 更新配置
            this.config[platform].model = newModelId;
            const result = this.configManager.saveConfig(this.config);
            if (result.success) {
                this.config = result.config;
            }

            // 更新UI显示
            this.uiManager.updateCurrentService(platform, newModelId);
            this.uiManager.updateRecognitionStatus('ready', '已自动切换到可用模型');

            // 显示切换通知
            const displayName = this.getModelDisplayName(newModelId, platform);
            this.uiManager.showNotification(`已自动切换到模型: ${displayName}`);

        } else {
            // 平台没有其他可用模型，无法自动切换
        }
    }

    // 翻译执行方法已移至UIManager统一管理，避免重复调用





    // 翻译相关方法已移至UIManager统一管理，避免重复调用

    // ==================== 静默模式相关方法 ====================

    /**
     * 隐藏主窗口 - 静默模式专用
     */
    hideMainWindow() {
        try {
            if (window.ocrAPI?.hideMainWindow) {
                window.ocrAPI.hideMainWindow();
            } else if (typeof utools !== 'undefined' && utools.hideMainWindow) {
                utools.hideMainWindow();
            }
        } catch (error) {
            console.error('隐藏主窗口失败:', error);
        }
    }

    /**
     * 处理截图取消的情况
     */
    handleScreenshotCancelled() {
        if (!this.isSilentMode) {
            // 非静默模式：隐藏加载状态，恢复按钮
            this.uiManager.hideLoading();
            this.uiManager.setButtonsEnabled(true);
        }
        this.resetSilentMode();
    }

    /**
     * 显示状态指示器（静默模式专用）
     * @param {string} status - 状态类型：loading, success, error, warning
     * @param {boolean} autoHide - 是否自动隐藏
     * @param {number} hideDelay - 隐藏延迟时间
     */
    showStatusIndicator(status, autoHide = true, hideDelay = 2000) {
        if (this.isSilentMode && window.ocrAPI?.statusIndicator) {
            window.ocrAPI.statusIndicator.updateStatus(status, autoHide, hideDelay);
        }
    }

    /**
     * 处理静默模式OCR结果
     * @param {string} text - OCR识别的文字内容
     */
    async handleSilentOCRResult(text) {
        try {
            if (text && text.trim()) {
                const trimmedText = text.trim();

                // 复制到剪贴板
                window.ocrAPI.copyText(trimmedText);

                // 显示成功状态指示器
                this.showStatusIndicator('success');

                // 静默模式成功时不显示通知，保持完全静默

                // 保存到历史记录
                await this.saveToHistory(trimmedText);
            } else {
                this.showSilentNotification('未识别到文字内容', 'warning');
                this.showStatusIndicator('warning');
            }
        } catch (error) {
            console.error('静默模式结果处理失败:', error);
            this.showSilentNotification('复制失败，请重试', 'error');
            this.showStatusIndicator('error');
        } finally {
            this.resetSilentMode();
        }
    }

    /**
     * 保存识别结果到历史记录
     * @param {string} text - 识别的文字内容
     */
    async saveToHistory(text) {
        if (this.config?.ui?.enableHistory !== false) {
            try {
                const serviceConfig = this.configManager.getServiceConfig(this.config);
                const modelName = this.getModelDisplayNameForHistory(this.config.service, serviceConfig);

                this.historyManager.addHistory(
                    this.lastImageBase64,
                    text,
                    this.config.service,
                    modelName,
                    '文字'
                );
            } catch (error) {
                console.error('保存历史记录失败:', error);
            }
        }
    }

    /**
     * 静默模式错误处理
     * @param {Error} error - 错误对象
     * @param {string} message - 错误消息
     */
    handleSilentError(error, message) {
        console.error(`${message}:`, error);
        this.showSilentNotification(message, 'error');

        // 显示错误状态指示器
        this.showStatusIndicator('error');

        this.resetSilentMode();
    }

    /**
     * 显示静默通知
     * @param {string} message - 通知消息
     * @param {string} type - 通知类型 (info|success|warning|error)
     */
    showSilentNotification(message, type = 'info') {
        if (window.ocrAPI?.showNotification) {
            window.ocrAPI.showNotification(message, type);
        } else {
            console.log(`[OCR Pro] ${type.toUpperCase()}: ${message}`);
        }
    }

    /**
     * 重置静默模式标志
     */
    resetSilentMode() {
        this.isSilentMode = false;
        this.isScreenshotAndCopyMode = false;

        // 不在这里销毁状态指示器，让自动隐藏机制自然处理
        // 状态指示器会根据autoHide参数自动销毁

    }

    /**
     * 插件首次启动时初始化uTools用户信息
     */
    initializeUToolsUserInfo() {
        // 检查是否已经获取过uTools用户信息
        const hasInitialized = this.uiManager.getStorageItem('utoolsUserInfoInitialized');
        if (hasInitialized === 'true') {
            return;
        }

        // 尝试获取uTools用户信息
        this.uiManager.loadUToolsUserInfo().then(() => {
            // 标记已初始化
            this.uiManager.setStorageItem('utoolsUserInfoInitialized', 'true');

        }).catch((error) => {

            // 即使失败也标记为已初始化，避免重复尝试
            this.uiManager.setStorageItem('utoolsUserInfoInitialized', 'true');
        });
    }

    /**
     * 初始化OCR Pro额度管理器
     */
    initializeOCRProQuotaManager() {
        if (window.ocrProQuotaManager) {
            // 检查并重置额度（如果需要）
            window.ocrProQuotaManager.checkAndResetIfNeeded();

        } else {
            console.warn('[OCR Pro额度] 额度管理器未找到');
        }
    }

    /**
     * 初始化版本更新提示
     */
    initializeUpdateNotification() {
        if (this.updateNotificationManager) {
            // 延迟执行，确保页面完全加载
            setTimeout(() => {
                this.updateNotificationManager.initialize();
            }, 500);
        } else {
            console.warn('[版本更新] 更新提示管理器未找到');
        }
    }
}

// 初始化插件
document.addEventListener('DOMContentLoaded', () => {
    // 确保所有模块都已加载
    if (typeof ConfigManager !== 'undefined' &&
        typeof OCRServices !== 'undefined' &&
        typeof UIManager !== 'undefined' &&
        typeof ModelManager !== 'undefined' &&
        typeof HistoryManager !== 'undefined') {
        window.ocrPlugin = new OCRPlugin();
        window.configManager = window.ocrPlugin.configManager;
        window.modelManager = window.ocrPlugin.modelManager;







        // 修复配置问题
        window.ocrPlugin.fixConfigurationIssues();


    }
});



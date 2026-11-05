const { closeSubInput } = require('../utils/subinput_compat');

function createSettingsHostBridge(deps = {}) {
    const fsModule = deps.fs || require('fs');
    const pathModule = deps.path || require('path');
    const { AppState, EventManager } = deps.state || require('../core/state');
    const {
        getSettings,
        saveSettings,
        buildSettingsExportFilename,
        buildSettingsExportText,
        parseSettingsImportData,
        importSettingsData
    } = deps.settings || require('../core/settings');
    const { summarizeSettingsImport } = deps.interaction || require('../utils/interaction');
    const runtimeWindow = deps.window || globalThis.window;
    const runtimeDocument = deps.document || globalThis.document;
    const runtimeProcess = deps.process || process;

    let pendingSettingsImport = null;

    const openLiveSettingsInput = ({
        placeholder,
        initialValue = '',
        normalize = value => value,
        buildPartial,
        notice = '输入内容后自动保存，可直接继续选择其他设置'
    }) => {
        EventManager.clear();
        runtimeWindow.ztools?.setSubInput(({ text }) => {
            const nextValue = normalize(typeof text === 'string' ? text : '');
            saveSettings(buildPartial(nextValue));
        }, placeholder, true);

        if (typeof runtimeWindow.ztools?.setSubInputValue === 'function') {
            runtimeWindow.ztools?.setSubInputValue(String(initialValue || ''));
        }
        if (typeof runtimeWindow.ztools?.subInputSelect === 'function' && initialValue) {
            runtimeWindow.ztools?.subInputSelect();
        }

        runtimeWindow.ztools?.showNotification(notice);
    };

    const openConfirmSettingsInput = ({
        placeholder,
        initialValue = '',
        normalize = value => value,
        buildPartial,
        refresh,
        refreshView = 'home',
        notice = '按 Enter 保存，Esc 取消'
    }) => {
        EventManager.clear();
        let draft = String(initialValue || '');
        let saveTimer = null;
        let lastSaved = null;
        const commit = (silent) => {
            const nextValue = normalize(draft);
            if (nextValue === lastSaved) return;
            lastSaved = nextValue;
            saveSettings(buildPartial(nextValue));
            if (!silent) runtimeWindow.ztools?.showNotification('已保存');
        };
        runtimeWindow.ztools?.setSubInput(({ text }) => {
            draft = typeof text === 'string' ? text : '';
            // ZTools 不转发 Enter 键给插件文档，因此以「停止输入 400ms」为提交点
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => commit(false), 400);
        }, placeholder, draft);
        runtimeWindow.ztools?.showNotification(notice);
        EventManager.add(runtimeDocument, 'keydown', (e) => {
            if (e.key === 'Escape') {
                if (saveTimer) clearTimeout(saveTimer);
                commit(true);
                closeSubInput(runtimeWindow);
                refresh?.(refreshView);
                return;
            }
            if (e.key !== 'Enter') return;
            // uTools 路径仍走 Enter（ZTools 下这段不会触发，保留兼容）
            if (saveTimer) clearTimeout(saveTimer);
            commit(false);
            closeSubInput(runtimeWindow);
            refresh?.(refreshView);
        });
        EventManager.add(runtimeDocument, 'blur', () => {
            if (saveTimer) clearTimeout(saveTimer);
            commit(true);
        });
    };

    const resolveDialogFilePath = (result) => {
        if (!result) return '';
        if (typeof result === 'string') return result;
        if (Array.isArray(result)) return String(result[0] || '');
        if (Array.isArray(result.filePaths)) return String(result.filePaths[0] || '');
        if (typeof result.filePath === 'string') return result.filePath;
        if (typeof result.path === 'string') return result.path;
        return '';
    };

    const resolveDesktopPath = () => {
        try {
            const home = runtimeProcess.env.HOME || runtimeProcess.env.USERPROFILE || '';
            if (!home) return '';
            const desktopPath = pathModule.join(home, 'Desktop');
            return fsModule.existsSync(desktopPath) ? desktopPath : home;
        } catch (error) {
            return '';
        }
    };

    const normalizeJsonExportPath = (targetPath, filename) => {
        const trimmedPath = String(targetPath || '').trim();
        if (!trimmedPath) return '';
        try {
            if (fsModule.existsSync(trimmedPath) && fsModule.statSync(trimmedPath).isDirectory()) {
                return pathModule.join(trimmedPath, filename);
            }
        } catch (error) {
            // Keep the user-selected path if stat fails; writeFileSync will surface the real error.
        }
        return /\.json$/i.test(trimmedPath) ? trimmedPath : `${trimmedPath}.json`;
    };

    const stageSettingsImport = (parsedSettings) => {
        pendingSettingsImport = parsedSettings;
        const summary = summarizeSettingsImport(parsedSettings);
        EventManager.clear();
        closeSubInput(runtimeWindow);
        AppState.callbackSetList?.([
            { title: '确认导入并覆盖当前配置', description: summary.description, action: 'confirm_config_import' },
            { title: '取消导入', description: '返回配置导入 / 导出', action: 'view_config_data' }
        ]);
        runtimeWindow.ztools?.showNotification('配置已解析，请确认摘要后再次 Enter 导入');
    };

    const confirmPendingSettingsImport = (refresh) => {
        try {
            if (!pendingSettingsImport) {
                runtimeWindow.ztools?.showNotification('请先选择 JSON 文件');
                return false;
            }
            const imported = importSettingsData(pendingSettingsImport);
            pendingSettingsImport = null;
            closeSubInput(runtimeWindow);
            runtimeWindow.ztools?.showNotification(`导入成功：${(imported.savedTargets || []).length} 个入口，${(imported.tags || []).length} 个标签`);
            refresh?.('home');
            return true;
        } catch (error) {
            runtimeWindow.ztools?.showNotification(`导入失败: ${error.message}`);
            return false;
        }
    };

    const exportSettingsJsonFile = async () => {
        const filename = buildSettingsExportFilename();
        const exportText = buildSettingsExportText(getSettings());
        const desktopPath = resolveDesktopPath();
        const defaultPath = desktopPath
            ? pathModule.join(desktopPath, filename)
            : filename;

        try {
            let targetPath = '';
            if (typeof runtimeWindow.ztools?.showSaveDialog === 'function') {
                targetPath = resolveDialogFilePath(await runtimeWindow.ztools?.showSaveDialog({
                    title: '导出 Workflowy 配置 JSON',
                    defaultPath,
                    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
                }));
            } else {
                targetPath = defaultPath;
            }

            targetPath = normalizeJsonExportPath(targetPath, filename);
            if (!targetPath) {
                runtimeWindow.ztools?.showNotification('已取消导出');
                return false;
            }

            fsModule.writeFileSync(targetPath, exportText, 'utf8');
            if (typeof runtimeWindow.ztools?.copyText === 'function') {
                runtimeWindow.ztools?.copyText(exportText);
            }
            runtimeWindow.ztools?.showNotification(`配置 JSON 已导出：${pathModule.basename(targetPath)}`);
            return true;
        } catch (error) {
            runtimeWindow.ztools?.showNotification(`导出失败: ${error.message}`);
            return false;
        }
    };

    const importSettingsJsonFile = async () => {
        try {
            if (typeof runtimeWindow.ztools?.showOpenDialog !== 'function') {
                runtimeWindow.ztools?.showNotification('当前 uTools 环境不支持选择文件');
                return false;
            }

            const selected = await runtimeWindow.ztools?.showOpenDialog({
                title: '选择 Workflowy 配置 JSON',
                properties: ['openFile'],
                filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
            });
            const filePath = resolveDialogFilePath(selected);
            if (!filePath) {
                runtimeWindow.ztools?.showNotification('已取消导入');
                return false;
            }

            const raw = fsModule.readFileSync(filePath, 'utf8');
            const parsedSettings = parseSettingsImportData(raw);
            stageSettingsImport(parsedSettings);
            return true;
        } catch (error) {
            runtimeWindow.ztools?.showNotification(`导入失败: ${error.message}`);
            return false;
        }
    };

    return {
        openLiveSettingsInput,
        openConfirmSettingsInput,
        confirmPendingSettingsImport,
        exportSettingsJsonFile,
        importSettingsJsonFile
    };
}

let defaultBridge = null;

const getDefaultBridge = () => {
    if (!defaultBridge) {
        defaultBridge = createSettingsHostBridge();
    }
    return defaultBridge;
};

const bindBridgeMethod = (name) => (...args) => getDefaultBridge()[name](...args);

module.exports = {
    createSettingsHostBridge,
    openLiveSettingsInput: bindBridgeMethod('openLiveSettingsInput'),
    openConfirmSettingsInput: bindBridgeMethod('openConfirmSettingsInput'),
    confirmPendingSettingsImport: bindBridgeMethod('confirmPendingSettingsImport'),
    exportSettingsJsonFile: bindBridgeMethod('exportSettingsJsonFile'),
    importSettingsJsonFile: bindBridgeMethod('importSettingsJsonFile')
};

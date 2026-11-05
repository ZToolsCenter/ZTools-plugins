const TEST_UPLOAD_PNG_BUFFER = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XGqsAAAAASUVORK5CYII=',
    'base64'
);

function createHealthcheckHostBridge(deps = {}) {
    const { AppState } = deps.state || require('../core/state');
    const {
        getSettings,
        saveSettings
    } = deps.settings || require('../core/settings');
    const {
        isOssConfigured,
        getMissingOssFields,
        uploadBufferToOss,
        deleteObjectFromOss
    } = deps.oss || require('../api/oss');
    const {
        resolveMarkdownAttachmentUrls,
        createMarkdownViewerDemoFile,
        createMarkdownStandaloneViewerUploadPayload
    } = deps.markdownViewer || require('../utils/markdown_viewer');
    const runtimeWindow = deps.window || globalThis.window;

    const runOssUploadHealthcheck = async (refresh) => {
        const settings = getSettings();
        if (!isOssConfigured(settings)) {
            const message = `请先完成 OSS 配置：${getMissingOssFields(settings).join(' / ')}`;
            AppState.healthcheckResult = {
                title: 'OSS 测试未执行',
                description: message,
                status: 'failed'
            };
            runtimeWindow.ztools?.showNotification(message);
            refresh?.('view_oss');
            return;
        }

        AppState.healthcheckResult = {
            title: '正在测试 OSS 上传...',
            description: '上传 1x1 测试图，完成后会尝试清理',
            status: 'running'
        };
        runtimeWindow.ztools?.showNotification('正在测试图片上传...');
        refresh?.('view_oss');

        let uploaded = null;
        try {
            uploaded = await uploadBufferToOss(settings, {
                buffer: TEST_UPLOAD_PNG_BUFFER,
                contentType: 'image/png',
                extension: 'png'
            }, { timeoutMs: 20000 });

            try {
                await deleteObjectFromOss(settings, uploaded.objectKey, { timeoutMs: 20000 });
                AppState.healthcheckResult = {
                    title: 'OSS 测试成功',
                    description: '图片可上传、可访问、可清理',
                    status: 'success'
                };
                runtimeWindow.ztools?.showNotification('测试上传成功：图片可上传、可访问、可清理');
            } catch (cleanupError) {
                AppState.healthcheckResult = {
                    title: 'OSS 测试部分成功',
                    description: `上传成功，但清理测试文件失败：${cleanupError.message}`,
                    status: 'warning'
                };
                runtimeWindow.ztools?.showNotification(AppState.healthcheckResult.description);
            }
        } catch (error) {
            AppState.healthcheckResult = {
                title: 'OSS 测试失败',
                description: error.message,
                status: 'failed'
            };
            runtimeWindow.ztools?.showNotification(`测试上传失败：${error.message}`);
        } finally {
            refresh?.('view_oss');
        }
    };

    const runMarkdownViewerHealthcheck = async (refresh) => {
        const settings = getSettings();
        if (!isOssConfigured(settings)) {
            const message = `请先完成 OSS 配置：${getMissingOssFields(settings).join(' / ')}`;
            AppState.healthcheckResult = {
                title: 'Markdown Viewer 未初始化',
                description: message,
                status: 'failed'
            };
            runtimeWindow.ztools?.showNotification(message);
            refresh?.('view_oss_file');
            return;
        }

        AppState.healthcheckResult = {
            title: '正在初始化 Markdown Viewer...',
            description: '会上传 Demo Markdown 和独立 Viewer 文件',
            status: 'running'
        };
        runtimeWindow.ztools?.showNotification('正在初始化 Markdown Viewer...');
        refresh?.('view_oss_file');

        try {
            const demoFile = createMarkdownViewerDemoFile();
            const uploadedDemo = await uploadBufferToOss(settings, demoFile, { timeoutMs: 20000 });
            const urls = resolveMarkdownAttachmentUrls({ ...settings, ossMarkdownViewerEnabled: true }, uploadedDemo.objectKey);
            const viewerPayload = createMarkdownStandaloneViewerUploadPayload({
                markdownObjectKey: uploadedDemo.objectKey,
                markdownText: demoFile.buffer.toString('utf8'),
                rawUrl: urls.rawUrl,
                displayName: demoFile.displayName
            });
            await uploadBufferToOss(settings, viewerPayload, { timeoutMs: 20000 });

            saveSettings({ ossMarkdownViewerEnabled: true, ossMarkdownViewerReady: true });
            if (urls.viewerUrl) {
                runtimeWindow.ztools?.shellOpenExternal(urls.viewerUrl);
            }
            AppState.healthcheckResult = {
                title: 'Markdown Viewer 验证成功',
                description: '让 Markdown 链接可直接阅读；已启用默认域名渲染链接',
                status: 'success'
            };
            runtimeWindow.ztools?.showNotification('Markdown Viewer 验证成功，已启用默认域名渲染链接');
        } catch (error) {
            AppState.healthcheckResult = {
                title: 'Markdown Viewer 初始化失败',
                description: error.message,
                status: 'failed'
            };
            runtimeWindow.ztools?.showNotification(`Markdown Viewer 初始化失败：${error.message}`);
        } finally {
            refresh?.('view_oss_file');
        }
    };

    return {
        runOssUploadHealthcheck,
        runMarkdownViewerHealthcheck
    };
}

module.exports = {
    TEST_UPLOAD_PNG_BUFFER,
    createHealthcheckHostBridge
};

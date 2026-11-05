const { closeSubInput } = require('../utils/subinput_compat');

const {
    VALID_SETTINGS_VIEWS,
    nextPrefillPolicy
} = require('./settings_view_host');
const { isEnglish } = require('../utils/i18n');
const {
    createManualTargetHostBridge
} = require('./manual_target_host');

function createSettingsSelectHostBridge(deps = {}) {
    const { AppState, EventManager } = deps.state || require('../core/state');
    const {
        getSettings,
        saveSettings
    } = deps.settings || require('../core/settings');
    const {
        getNodes,
        NodeManager,
        TargetManager
    } = deps.nodes || require('../core/node_manager');
    const {
        removeRecentAttachment,
        clearResolvedRecentAttachments
    } = deps.recentAttachments || require('../core/recent_attachments');
    const {
        isOssConfigured,
        getMissingOssFields,
        buildOssEndpointFromRegion
    } = deps.oss || require('../api/oss');
    const runtimeWindow = deps.window || globalThis.window;
    const runtimeDocument = deps.document || globalThis.document;
    const recentAttachmentHost = deps.recentAttachmentHost || require('./recent_attachment_host');
    const healthcheckHost = deps.healthcheckHost || require('./healthcheck_host');
    const settingsHost = deps.settingsHost || require('./settings_host');
    const manualTargetHost = deps.manualTargetHost || createManualTargetHostBridge({
        state: { EventManager },
        window: runtimeWindow,
        document: runtimeDocument
    });
    const showWorkflowyTargetImportMenu = deps.showWorkflowyTargetImportMenu || (async () => {});
    const getTargetRef = deps.getTargetRef || (target => String(target?.key || target?.id || target?.nodeId || target?.node_id || '').trim());
    const getTargetName = deps.getTargetName || (target => String(target?.name || getTargetRef(target) || '未命名').trim());

    const handleSettingsSelect = (item, callbackSetList, refresh) => {
        const s = getSettings();

        if (recentAttachmentHost.handleRecentAttachmentAction?.(item, callbackSetList, refresh)) return true;

        if (item.action === 'show_plugin_version') {
            const version = String(item.description || '').trim() || 'unknown';
            try {
                runtimeWindow.ztools?.copyText?.(version);
            } catch (error) {
                console.error('Failed to copy plugin version:', error);
            }
            const notice = isEnglish()
                ? `Plugin version ${version} copied`
                : `当前插件版本 ${version}，已复制`;
            runtimeWindow.ztools?.showNotification?.(notice);
        }
        else if (item.action === 'back_home') refresh('home');
        else if (item.action === 'back_common') refresh('view_common');
        else if (item.action === 'back_oss') refresh('view_oss');
        else if (VALID_SETTINGS_VIEWS.includes(item.action)) refresh(item.action);
        else if (item.action === 'export_config_data') {
            settingsHost.exportSettingsJsonFile().finally(() => refresh('view_config_data'));
        }
        else if (item.action === 'import_config_file') {
            settingsHost.importSettingsJsonFile(refresh);
        }
        else if (item.action === 'confirm_config_import') {
            settingsHost.confirmPendingSettingsImport(refresh);
        }
        else if (item.action === 'set_key') {
            settingsHost.openConfirmSettingsInput({
                placeholder: '输入 API Key，Enter 保存',
                initialValue: s.apiKey,
                normalize: value => value.trim(),
                buildPartial: value => ({ apiKey: value }),
                refresh,
                refreshView: 'view_common'
            });
        }
        else if (item.action === 'toggle_ts') { saveSettings({ useTimestamp: !s.useTimestamp }); refresh('view_others'); }
        else if (item.action === 'toggle_timestamp_mode') {
            const next = s.timestampMode === 'group_today' ? 'per_entry' : 'group_today';
            saveSettings({ timestampMode: next });
            refresh('view_others');
        }
        else if (item.action === 'toggle_link_title_fetch') {
            saveSettings({ enableLinkTitleFetch: !s.enableLinkTitleFetch });
            refresh('view_others');
        }
        else if (item.action === 'toggle_web_tag_enabled') {
            saveSettings({ webTagEnabled: !s.webTagEnabled });
            refresh('view_others');
        }
        else if (item.action === 'toggle_create_position') {
            const next = s.createPosition === 'top' ? 'bottom' : 'top';
            saveSettings({ createPosition: next });
            refresh('view_others');
        }
        else if (item.action === 'toggle_prefill_policy') {
            saveSettings({ prefillPolicy: nextPrefillPolicy(s.prefillPolicy) });
            refresh('view_others');
        }
        else if (item.action === 'toggle_oss_enabled') {
            const next = !s.ossEnabled;
            if (next && !isOssConfigured(s)) {
                runtimeWindow.ztools?.showNotification(`请先完成 OSS 配置：${getMissingOssFields(s).join(' / ')}`);
            } else {
                saveSettings({ ossEnabled: next });
            }
            refresh('view_oss');
        }
        else if (item.action === 'toggle_oss_image_tag_enabled') {
            saveSettings({ ossImageTagEnabled: !s.ossImageTagEnabled });
            refresh('view_oss_image');
        }
        else if (item.action === 'toggle_oss_markdown_viewer_enabled') {
            if (s.ossMarkdownViewerEnabled) {
                saveSettings({ ossMarkdownViewerEnabled: false });
            } else if (s.ossMarkdownViewerReady) {
                saveSettings({ ossMarkdownViewerEnabled: true });
            } else {
                runtimeWindow.ztools?.showNotification('请先执行“初始化 / 验证 Markdown Viewer”');
            }
            refresh('view_oss_file');
        }
        else if (item.action === 'toggle_oss_file_icon_enabled') {
            saveSettings({ ossFileIconEnabled: !s.ossFileIconEnabled });
            refresh('view_oss_file');
        }
        else if (item.action === 'toggle_oss_file_tag_enabled') {
            saveSettings({ ossFileTagEnabled: !s.ossFileTagEnabled });
            refresh('view_oss_file');
        }
        else if (item.action === 'test_oss_upload') {
            AppState.healthcheckResult = null;
            healthcheckHost.runOssUploadHealthcheck(refresh);
        }
        else if (item.action === 'test_markdown_viewer') {
            AppState.healthcheckResult = null;
            healthcheckHost.runMarkdownViewerHealthcheck(refresh);
        }
        else if (item.action === 'recent_attachment_remove') {
            removeRecentAttachment(item.data?.id);
            refresh('view_recent_attachments');
        }
        else if (item.action === 'clear_resolved_recent_attachments') {
            clearResolvedRecentAttachments();
            refresh('view_recent_attachments');
        }
        else if (item.action === 'pick_capture_target_from_targets') {
            void showWorkflowyTargetImportMenu({
                callbackSetList,
                manualAction: 'set_capture_target_manual',
                importAction: 'import_target_as_capture_target',
                backAction: 'view_capture',
                manualTitle: '📝 手动录入发送目标',
                backTitle: '↩️ 返回 wf 发送目标'
            });
        }
        else if (item.action === 'set_capture_target_manual') {
            manualTargetHost.openManualTargetInput({
                onConfirm(parsed) {
                    TargetManager.setCaptureTarget(parsed.id, parsed.name, parsed.type);
                    runtimeWindow.ztools?.showNotification(`wf 发送目标已更新为: ${parsed.name} `);
                    refresh('view_capture');
                }
            });
        }
        else if (item.action === 'set_capture_target_from_saved_entry') {
            NodeManager.setDefault(item.data.entryId);
            refresh('view_capture');
        }
        else if (item.action === 'import_target_as_capture_target') {
            const t = item.data || {};
            const ref = getTargetRef(t);
            if (ref) {
                TargetManager.setCaptureTarget(ref, getTargetName(t), t.type);
                runtimeWindow.ztools?.showNotification(`wf 发送目标已更新为: ${getTargetName(t)} `);
            }
            refresh('view_capture');
        }
        else if (item.action === 'add_view_entry_menu') {
            void showWorkflowyTargetImportMenu({
                callbackSetList,
                existingRefs: getNodes().map(n => n.id),
                manualAction: 'add_view_entry_manual',
                importAction: 'import_target_as_view_entry',
                backAction: 'view_entries',
                manualTitle: '📝 手动添加查看入口',
                backTitle: '↩️ 返回 wfv 查看入口'
            });
        }
        else if (item.action === 'add_view_entry_manual') {
            manualTargetHost.openManualTargetInput({
                onConfirm(parsed) {
                    const result = NodeManager.add(parsed.id, parsed.name, parsed.type);
                    if (result?.success === false) {
                        runtimeWindow.ztools?.showNotification(result.message);
                        return;
                    }
                    runtimeWindow.ztools?.showNotification('添加成功');
                    refresh('view_entries');
                }
            });
        }
        else if (item.action === 'import_target_as_view_entry') {
            const t = item.data || {};
            const ref = getTargetRef(t);
            if (ref) {
                const result = NodeManager.add(ref, getTargetName(t), t.type);
                if (result?.success === false) {
                    runtimeWindow.ztools?.showNotification(result.message);
                } else {
                    runtimeWindow.ztools?.showNotification(`已添加查看入口: ${getTargetName(t)} `);
                }
            }
            refresh('view_entries');
        }
        else if (item.action === 'edit_view_entry') {
            const n = item.data;
            callbackSetList([
                { title: '设为 wf 发送目标', action: 'set_capture_target_from_saved_entry', data: n },
                { title: '修改名称', action: 'rename_view_entry', data: n },
                { title: '删除', action: 'delete_view_entry', data: n },
                { title: '↩️ 返回', action: 'view_entries' }
            ]);
        }
        else if (item.action === 'delete_view_entry') { NodeManager.delete(item.data.entryId); refresh('view_entries'); }
        else if (item.action === 'rename_view_entry') {
            let t = item.data.name;
            let renameTimer = null;
            const applyRename = () => {
                if (!t.trim()) return;
                NodeManager.updateName(item.data.entryId, t.trim());
                closeSubInput(runtimeWindow);
                refresh('view_entries');
            };
            runtimeWindow.ztools?.setSubInput(({ text }) => {
                t = text;
                // ZTools 不转发 Enter 给插件，改为停止输入后自动提交
                if (renameTimer) clearTimeout(renameTimer);
                renameTimer = setTimeout(() => { renameTimer = null; applyRename(); }, 500);
            }, '新名称', item.data.name);
            EventManager.add(runtimeDocument, 'keydown', e => {
                if (e.key === 'Enter') {
                    if (renameTimer) clearTimeout(renameTimer);
                    applyRename();
                }
            });
        }
        else if (item.action === 'add_tag') {
            let t = '';
            let tagTimer = null;
            const applyTag = () => {
                const v = t.trim();
                if (!v) return;
                saveSettings({ tags: [...s.tags, v] });
                closeSubInput(runtimeWindow);
                refresh('view_tags');
            };
            runtimeWindow.ztools?.setSubInput(({ text }) => {
                t = text;
                // ZTools 不转发 Enter 给插件，改为停止输入后自动提交
                if (tagTimer) clearTimeout(tagTimer);
                tagTimer = setTimeout(() => { tagTimer = null; applyTag(); }, 500);
            }, '输入新标签');
            EventManager.add(runtimeDocument, 'keydown', e => {
                if (e.key === 'Enter') {
                    if (tagTimer) clearTimeout(tagTimer);
                    applyTag();
                }
            });
        }
        else if (item.action === 'del_tag') {
            const newTags = [...s.tags];
            newTags.splice(item.index, 1);
            saveSettings({ tags: newTags });
            refresh('view_tags');
        }
        else if (item.action === 'set_sep') {
            settingsHost.openLiveSettingsInput({
                placeholder: '输入分隔符',
                initialValue: s.separator,
                normalize: value => value,
                buildPartial: value => ({ separator: value }),
                notice: '输入分隔符后会自动保存，可直接返回其他设置'
            });
        }
        else if (item.action === 'set_web_tag') {
            settingsHost.openLiveSettingsInput({
                placeholder: '输入网页标签，不含 #',
                initialValue: s.webTag,
                normalize: value => value.trim().replace(/^#+/g, '') || 'web',
                buildPartial: value => ({ webTag: value })
            });
        }
        else if (item.action === 'set_oss_bucket') {
            settingsHost.openConfirmSettingsInput({
                placeholder: '输入 Bucket 名称，Enter 保存',
                initialValue: s.ossBucket,
                normalize: value => value.trim(),
                buildPartial: value => ({ ossBucket: value }),
                refresh,
                refreshView: 'view_oss'
            });
        }
        else if (item.action === 'set_oss_region') {
            settingsHost.openConfirmSettingsInput({
                placeholder: '输入地区，例如 oss-cn-shenzhen，Enter 保存',
                initialValue: s.ossRegion,
                normalize: value => value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/g, '').replace(/\.aliyuncs\.com$/i, ''),
                buildPartial: value => ({
                    ossRegion: value,
                    ossEndpoint: buildOssEndpointFromRegion(value)
                }),
                refresh,
                refreshView: 'view_oss'
            });
        }
        else if (item.action === 'set_oss_access_key_id') {
            settingsHost.openConfirmSettingsInput({
                placeholder: '输入 AccessKey ID，Enter 保存',
                initialValue: s.ossAccessKeyId,
                normalize: value => value.trim(),
                buildPartial: value => ({ ossAccessKeyId: value }),
                refresh,
                refreshView: 'view_oss'
            });
        }
        else if (item.action === 'set_oss_access_key_secret') {
            settingsHost.openConfirmSettingsInput({
                placeholder: '输入 AccessKey Secret，Enter 保存',
                initialValue: '',
                normalize: value => value.trim(),
                buildPartial: value => ({ ossAccessKeySecret: value }),
                refresh,
                refreshView: 'view_oss'
            });
        }
        else if (item.action === 'set_oss_path_prefix') {
            settingsHost.openConfirmSettingsInput({
                placeholder: '输入存储路径前缀，Enter 保存',
                initialValue: s.ossPathPrefix,
                normalize: value => value.trim(),
                buildPartial: value => ({ ossPathPrefix: value }),
                refresh,
                refreshView: 'view_oss_storage'
            });
        }
        else if (item.action === 'set_oss_custom_domain') {
            settingsHost.openConfirmSettingsInput({
                placeholder: '输入自定义访问域名（可选），Enter 保存',
                initialValue: s.ossCustomDomain,
                normalize: value => value.trim(),
                buildPartial: value => ({ ossCustomDomain: value }),
                refresh,
                refreshView: 'view_oss_storage'
            });
        }
        else if (item.action === 'set_oss_image_tag') {
            settingsHost.openLiveSettingsInput({
                placeholder: '输入图片标签，不含 #',
                initialValue: s.ossImageTag,
                normalize: value => value.trim() || 'img',
                buildPartial: value => ({ ossImageTag: value })
            });
        }
        else if (item.action === 'set_oss_file_icon') {
            settingsHost.openLiveSettingsInput({
                placeholder: '输入 Markdown 文件图标',
                initialValue: s.ossFileIcon,
                normalize: value => value.trim() || '📄',
                buildPartial: value => ({ ossFileIcon: value })
            });
        }
        else if (item.action === 'set_oss_file_tag') {
            settingsHost.openLiveSettingsInput({
                placeholder: '输入文件标签，不含 #',
                initialValue: s.ossFileTag,
                normalize: value => value.trim().replace(/^#+/g, '') || 'file',
                buildPartial: value => ({ ossFileTag: value })
            });
        }
        else {
            return false;
        }

        return true;
    };

    return {
        handleSettingsSelect
    };
}

module.exports = {
    createSettingsSelectHostBridge
};

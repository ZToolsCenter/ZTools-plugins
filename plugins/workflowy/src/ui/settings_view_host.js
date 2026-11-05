const fs = require('fs');
const path = require('path');
const { t } = require('../utils/i18n');

const readPackagedPluginVersion = () => {
    try {
        const manifestPath = path.join(__dirname, '..', '..', 'plugin.json');
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const version = String(parsed?.version || '').trim();
        return version || 'unknown';
    } catch (error) {
        return 'unknown';
    }
};

const SETTINGS_VIEW_SCHEMA = Object.freeze({
    home: Object.freeze({
        parent: null,
        backAction: null
    }),
    view_common: Object.freeze({
        parent: 'home',
        backAction: 'back_home'
    }),
    view_capture: Object.freeze({
        parent: 'view_common',
        backAction: 'back_common'
    }),
    view_entries: Object.freeze({
        parent: 'view_common',
        backAction: 'back_common'
    }),
    view_tags: Object.freeze({
        parent: 'view_common',
        backAction: 'back_common'
    }),
    view_others: Object.freeze({
        parent: 'home',
        backAction: 'back_home'
    }),
    view_oss: Object.freeze({
        parent: 'home',
        backAction: 'back_home'
    }),
    view_oss_advanced: Object.freeze({
        parent: 'view_oss',
        backAction: 'back_oss'
    }),
    view_oss_storage: Object.freeze({
        parent: 'view_oss_advanced',
        backAction: 'view_oss_advanced'
    }),
    view_oss_image: Object.freeze({
        parent: 'view_oss_advanced',
        backAction: 'view_oss_advanced'
    }),
    view_oss_file: Object.freeze({
        parent: 'view_oss_advanced',
        backAction: 'view_oss_advanced'
    }),
    view_recent_attachments: Object.freeze({
        parent: 'view_oss_advanced',
        backAction: 'view_oss_advanced'
    }),
    view_config_data: Object.freeze({
        parent: 'home',
        backAction: 'back_home'
    })
});

const VALID_SETTINGS_VIEWS = Object.keys(SETTINGS_VIEW_SCHEMA);

const getTimestampModeLabel = (mode) => (
    mode === 'group_today'
        ? t('aggregateMode')
        : t('singleMode')
);

const PREFILL_POLICY_LABELS = {
    parent: '链接作父节点（推荐）',
    fill: '填入输入框（旧行为）',
    off: '忽略剪贴板'
};

const getPrefillPolicyLabel = (policy) => PREFILL_POLICY_LABELS[policy] || PREFILL_POLICY_LABELS.parent;

const nextPrefillPolicy = (policy) => {
    const order = ['parent', 'fill', 'off'];
    const index = order.indexOf(policy);
    return order[(index + 1) % order.length] || order[0];
};

function createSettingsViewHostBridge(deps = {}) {
    const { AppState } = deps.state || require('../core/state');
    const {
        getSettings
    } = deps.settings || require('../core/settings');
    const {
        getNodes,
        getDefaultNode
    } = deps.nodes || require('../core/node_manager');
    const recentAttachmentsStore = deps.recentAttachments || require('../core/recent_attachments');
    const {
        listRecentAttachments
    } = recentAttachmentsStore;
    const {
        normalizeOssSettings,
        buildOssDefaultPublicHost
    } = deps.oss || require('../api/oss');
    const {
        sortRecentAttachmentsForRecovery,
        getPendingRecentAttachments,
        formatRecentAttachmentDescription,
        buildOssSetupStatus
    } = deps.interaction || require('../utils/interaction');
    const {
        humanizeRefName
    } = deps.helpers || require('../utils/helpers');
    const getPluginVersion = deps.getPluginVersion || readPackagedPluginVersion;

    const resolveSettingsView = (action) => (
        action && VALID_SETTINGS_VIEWS.includes(action.payload) ? action.payload : 'home'
    );

    const buildSettingsViewList = (view) => {
        const s = getSettings();
        const oss = normalizeOssSettings(s);
        const savedTargets = getNodes();
        const captureTarget = s.captureTarget || getDefaultNode();
        const recentAttachments = sortRecentAttachmentsForRecovery(listRecentAttachments({ includeDeleted: true }));
        const pendingRecentAttachments = getPendingRecentAttachments(recentAttachments, 20);
        let list = [];

        // 辅助函数：获取状态文本
        const getStatusText = (isEnabled) => isEnabled ? t('enabled') : t('disabled');
        const getSetStatusText = (value) => value ? t('set') : t('notSet');
        const getPositionText = (pos) => pos === 'top' ? t('top') : t('bottom');
        const getTagText = (tag) => tag || 'web';

        if (view === 'home') {
            list = [
                { title: t('commonSettings'), description: t('commonSettingsDesc'), action: 'view_common' },
                { title: t('ossSettings'), description: oss.ossEnabled ? `${getStatusText(true)} | ${(oss.ossBucket || t('notSet'))}${oss.ossRegion ? ` / ${oss.ossRegion}` : ''}` : getStatusText(false), action: 'view_oss' },
                { title: t('otherSettings'), description: t('otherSettingsDesc'), action: 'view_others' },
                { title: t('configImportExport'), description: t('configImportExportDesc'), action: 'view_config_data' },
                { title: t('pluginVersion'), description: getPluginVersion(), action: 'show_plugin_version' }
            ];
        } else if (view === 'view_common') {
            list = [
                { title: t('apiKeySettings'), description: getSetStatusText(s.apiKey), action: 'set_key' },
                { title: t('wfCaptureTarget'), description: `${captureTarget.name || humanizeRefName(captureTarget.ref)} | ${captureTarget.ref}`, action: 'view_capture' },
                { title: t('wfvViewEntries'), description: `当前 ${savedTargets.length} 个入口`, action: 'view_entries' },
                { title: t('tagManagement'), description: t('tagManagement'), action: 'view_tags' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
        } else if (view === 'view_capture') {
            list = [
                { title: `${t('currentTarget')}: ${captureTarget.name || humanizeRefName(captureTarget.ref)}`, description: `${t('reference')}: ${captureTarget.ref}` },
                { title: t('pickFromTargets'), description: t('wfCaptureTarget'), action: 'pick_capture_target_from_targets' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_common' }
            ];
        } else if (view === 'view_entries') {
            list = savedTargets.map(n => ({
                title: `${n.isCapture ? '🚀 ' : '📁 '}${n.name} `,
                description: `${[t('reference') + ': ' + n.id, n.isCapture ? t('captureTarget') : null].filter(Boolean).join(' | ')} `,
                action: 'edit_view_entry',
                data: n
            }));
            list.push({ title: `\n➕ ${t('addViewEntry').replace('➕ ', '')}`, action: 'add_view_entry_menu' });
            list.push({ title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_common' });
        } else if (view === 'view_tags') {
            list = (s.tags || []).map((t, i) => ({ title: t, description: `Enter ${t('delete')}`, action: 'del_tag', index: i }));
            list.push({ title: `\n➕ ${t('add')} ${t('tagManagement').replace(t('tagManagement').split(' ')[0], '')}`, action: 'add_tag' });
            list.push({ title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_common' });
        } else if (view === 'view_others') {
            list = [
                { title: t('timestampSettings'), description: getStatusText(s.useTimestamp), action: 'toggle_ts' },
                { title: t('createPosition'), description: `${t('currentTarget')}: ${getPositionText(s.createPosition)}`, action: 'toggle_create_position' },
                { title: t('separator'), description: `"${s.separator}"`, action: 'set_sep' },
                { title: t('linkTitleFetch'), description: getStatusText(s.enableLinkTitleFetch), action: 'toggle_link_title_fetch' },
                { title: t('webTag'), description: s.webTagEnabled ? `${getStatusText(true)} | #${getTagText(s.webTag)}` : getStatusText(false), action: 'toggle_web_tag_enabled' },
                { title: t('clipboardPrefill'), description: getPrefillPolicyLabel(s.prefillPolicy), action: 'toggle_prefill_policy' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
            if (s.useTimestamp) {
                list.splice(1, 0, {
                    title: t('timestampMode'),
                    description: `${t('currentTarget')}: ${getTimestampModeLabel(s.timestampMode)}`,
                    action: 'toggle_timestamp_mode'
                });
            }
            if (s.webTagEnabled) {
                list.splice(list.length - 1, 0, { title: t('webTagName'), description: `#${getTagText(s.webTag)}`, action: 'set_web_tag' });
            }
        } else if (view === 'view_oss') {
            const regionDescription = oss.ossRegion
                ? `${oss.ossRegion}${oss.ossEndpoint ? ` | ${oss.ossEndpoint}` : ''}`
                : t('notSet');
            const setupStatus = buildOssSetupStatus(s);
            list = [
                { title: setupStatus.title, description: setupStatus.description, type: 'info' },
                { title: t('ossEnabled'), description: getStatusText(oss.ossEnabled), action: 'toggle_oss_enabled' },
                { title: t('bucketName'), description: oss.ossBucket || t('notSet'), action: 'set_oss_bucket' },
                { title: t('region'), description: regionDescription, action: 'set_oss_region' },
                { title: t('accessKeyId'), description: oss.ossAccessKeyId ? `${oss.ossAccessKeyId.slice(0, 6)}...` : t('notSet'), action: 'set_oss_access_key_id' },
                { title: t('accessKeySecret'), description: getSetStatusText(oss.ossAccessKeySecret), action: 'set_oss_access_key_secret' },
                { title: t('testUpload'), description: t('testUploadDesc'), action: 'test_oss_upload' },
                { title: t('advancedSettings'), description: pendingRecentAttachments.length > 0 ? `${t('accessAndStorage')}, ${t('imageSettings')}, ${t('fileSettings')}, ${t('recentAttachments')} (${pendingRecentAttachments.length})` : `${t('accessAndStorage')}, ${t('imageSettings')}, ${t('fileSettings')}, ${t('recentAttachments')}`, action: 'view_oss_advanced' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
            if (AppState.healthcheckResult) {
                list.splice(1, 0, {
                    title: AppState.healthcheckResult.title,
                    description: AppState.healthcheckResult.description,
                    type: AppState.healthcheckResult.status === 'failed' ? 'error' : 'info'
                });
            }
        } else if (view === 'view_oss_advanced') {
            const storageDescription = [
                oss.ossCustomDomain ? `${t('customAccessDomain')}: ${oss.ossCustomDomain}` : (buildOssDefaultPublicHost(oss) || t('notSet')),
                oss.ossPathPrefix || `(root)`
            ].join(' | ');
            const imageDescription = oss.ossImageTagEnabled ? `${getStatusText(true)} | #${oss.ossImageTag || 'img'}` : getStatusText(false);
            const fileDescription = [
                s.ossMarkdownViewerEnabled ? 'Viewer enabled' : (s.ossMarkdownViewerReady ? 'Viewer disabled' : 'Viewer not initialized'),
                s.ossFileIconEnabled ? `${s.ossFileIcon}` : t('notSet'),
                s.ossFileTagEnabled ? `#${s.ossFileTag || 'file'}` : t('notSet')
            ].join(' | ');
            list = [
                { title: t('accessAndStorage'), description: storageDescription, action: 'view_oss_storage' },
                { title: t('imageSettings'), description: imageDescription, action: 'view_oss_image' },
                { title: t('fileSettings'), description: fileDescription, action: 'view_oss_file' },
                { title: t('recentAttachments'), description: pendingRecentAttachments.length > 0 ? `${pendingRecentAttachments.length} pending / ${recentAttachments.length} total` : `${recentAttachments.length} records`, action: 'view_recent_attachments' },
                { title: `\n${t('back')} ${t('ossSettings').split(' ')[0]}`, action: 'back_oss' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
        } else if (view === 'view_oss_storage') {
            const defaultPublicHost = buildOssDefaultPublicHost(oss);
            list = [
                { title: t('defaultAccessDomain'), description: defaultPublicHost || `Configure ${t('bucketName')} and ${t('region')}`, type: 'info' },
                { title: t('customAccessDomain'), description: oss.ossCustomDomain || `${t('notSet')} (use domain above)`, action: 'set_oss_custom_domain' },
                { title: t('storagePathPrefix'), description: oss.ossPathPrefix || `(root)`, action: 'set_oss_path_prefix' },
                { title: `\n${t('back')} ${t('advancedSettings').split(' ')[0]}`, action: 'view_oss_advanced' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
        } else if (view === 'view_oss_image') {
            list = [
                { title: t('autoImageTag'), description: oss.ossImageTagEnabled ? `${getStatusText(true)} | #${oss.ossImageTag || 'img'}` : getStatusText(false), action: 'toggle_oss_image_tag_enabled' },
                { title: `\n${t('back')} ${t('advancedSettings').split(' ')[0]}`, action: 'view_oss_advanced' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
            if (oss.ossImageTagEnabled) {
                list.splice(1, 0, { title: t('imageTagName'), description: `#${oss.ossImageTag || 'img'}`, action: 'set_oss_image_tag' });
            }
        } else if (view === 'view_oss_file') {
            list = [
                { title: t('autoFileIcon'), description: s.ossFileIconEnabled ? `${getStatusText(true)} | ${s.ossFileIcon}` : getStatusText(false), action: 'toggle_oss_file_icon_enabled' },
                { title: t('autoFileTag'), description: s.ossFileTagEnabled ? `${getStatusText(true)} | #${s.ossFileTag || 'file'}` : getStatusText(false), action: 'toggle_oss_file_tag_enabled' },
                { title: t('markdownViewer'), description: s.ossMarkdownViewerEnabled ? `${getStatusText(true)}: make MD links readable` : (s.ossMarkdownViewerReady ? `${getStatusText(false)}: write raw links` : 'Not initialized: write raw links'), action: 'toggle_oss_markdown_viewer_enabled' },
                { title: t('initializeViewer'), description: 'Upload Viewer to OSS and verify with default domain', action: 'test_markdown_viewer' },
                { title: `\n${t('back')} ${t('advancedSettings').split(' ')[0]}`, action: 'view_oss_advanced' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
            if (AppState.healthcheckResult) {
                list.splice(1, 0, {
                    title: AppState.healthcheckResult.title,
                    description: AppState.healthcheckResult.description,
                    type: AppState.healthcheckResult.status === 'failed' ? 'error' : 'info'
                });
            }
            if (s.ossFileIconEnabled) {
                list.splice(1, 0, { title: t('fileIconChar'), description: s.ossFileIcon || t('notSet'), action: 'set_oss_file_icon' });
            }
            if (s.ossFileTagEnabled) {
                const fileTagIndex = list.findIndex(menuItem => menuItem.action === 'toggle_oss_file_tag_enabled');
                list.splice(fileTagIndex + 1, 0, { title: t('fileTagName'), description: `#${s.ossFileTag || 'file'}`, action: 'set_oss_file_tag' });
            }
        } else if (view === 'view_recent_attachments') {
            list = recentAttachments.map(attachment => ({
                title: `${attachment.kind === 'markdown' ? t('attachmentKindFile') : t('attachmentKindImage')} ${attachment.displayName || attachment.name || attachment.objectKey}`,
                description: formatRecentAttachmentDescription(attachment),
                action: 'open_recent_attachment',
                data: attachment
            }));

            if (list.length === 0) {
                list.push({ title: t('noRecentAttachments'), description: t('noRecentAttachmentsDesc'), type: 'info' });
            }

            list.push({ title: `\n${t('clearResolved')}`, description: t('clearResolvedDesc'), action: 'clear_resolved_recent_attachments' });
            list.push({ title: `\n${t('back')} ${t('advancedSettings').split(' ')[0]}`, action: 'view_oss_advanced' });
        } else if (view === 'view_config_data') {
            list = [
                { title: t('exportJsonFile'), description: t('exportJsonDesc'), action: 'export_config_data' },
                { title: t('importJsonFile'), description: t('importJsonDesc'), action: 'import_config_file' },
                { title: `\n${t('back')} ${t('commonSettings').split(' ')[0]}`, action: 'back_home' }
            ];
        }

        return list;
    };

    return {
        resolveSettingsView,
        buildSettingsViewList
    };
}

module.exports = {
    SETTINGS_VIEW_SCHEMA,
    VALID_SETTINGS_VIEWS,
    getPrefillPolicyLabel,
    nextPrefillPolicy,
    readPackagedPluginVersion,
    createSettingsViewHostBridge
};

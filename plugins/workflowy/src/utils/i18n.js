/**
 * Internationalization (i18n) Module
 * Supports Chinese (zh-CN) and English (en-US)
 */

// 获取当前语言设置，默认为中文
const getCurrentLocale = () => {
    try {
        // 优先使用 uTools 的系统语言
        const utoolsLocale = globalThis.ztools?.getSystemLocale?.();
        if (utoolsLocale) {
            return utoolsLocale.startsWith('en') ? 'en' : 'zh';
        }
    } catch (e) {
        // 忽略错误，使用默认
    }
    return 'zh';
};

const LOCALE = getCurrentLocale();

// 中文翻译
const zh = {
    // 通用
    back: '↩️ 返回',
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    enabled: '已开启',
    disabled: '已关闭',
    set: '已设置',
    notSet: '未设置',

    // 状态
    saved: '已保存',
    saveFailed: '保存失败',
    deleted: '已删除',
    pending: '待保存',
    completed: '已完成',

    // 设置视图
    commonSettings: '常用设置',
    commonSettingsDesc: 'API Key、wf 目标、wfv 入口、标签',
    ossSettings: 'OSS 上传设置',
    otherSettings: '其他设置',
    otherSettingsDesc: '时间戳、分隔符、链接标题等',
    configImportExport: '配置导入 / 导出',
    configImportExportDesc: '通过 JSON 文件备份或恢复设置',
    uuidHelp: '如何获得UUID？',
    uuidHelpDesc: '打开帮助页面',
    pluginVersion: '版本',

    // 常用设置
    apiKeySettings: 'API Key 设置',
    wfCaptureTarget: 'wf 发送目标',
    wfvViewEntries: 'wfv 入口',
    tagManagement: '标签管理',

    // 目标选择
    pickFromTargets: '从 Workflowy Targets 选择',
    currentTarget: '当前目标',
    enterManually: '手动录入',

    // 其他设置
    timestampSettings: '时间戳设置',
    createPosition: '新建位置',
    top: '顶部',
    bottom: '底部',
    separator: '分隔符',
    linkTitleFetch: '识别链接标题',
    webTag: '网页标签',
    clipboardPrefill: '剪贴板预填链接',
    timestampMode: '时间戳模式',
    aggregateMode: '聚合到同步节点',
    singleMode: '每条单独时间戳',

    // OSS 设置
    ossEnabled: '启用 OSS 上传',
    bucketName: 'Bucket 名称',
    region: '地区',
    accessKeyId: 'AccessKey ID',
    accessKeySecret: 'AccessKey Secret',
    testUpload: '测试上传',
    testUploadDesc: '上传 1x1 测试图并自动清理',
    advancedSettings: '高级设置',
    accessAndStorage: '访问与存储',
    imageSettings: '图片设置',
    fileSettings: '文件设置',
    recentAttachments: '最近附件',

    // OSS 高级设置
    defaultAccessDomain: '默认访问域名',
    customAccessDomain: '自定义访问域名',
    storagePathPrefix: '存储路径前缀',
    autoImageTag: '自动图片标签',
    autoFileTag: 'Markdown 文件标签',
    autoFileIcon: 'Markdown 文件图标',
    markdownViewer: 'Markdown 渲染链接',
    initializeViewer: '初始化 / 验证 Markdown Viewer',

    // 标签设置
    imageTagName: '图片标签名称',
    fileTagName: '文件标签名称',
    fileIconChar: '文件图标字符',
    webTagName: '网页标签名称',

    // 最近附件
    noRecentAttachments: '暂无最近附件',
    noRecentAttachmentsDesc: '上传后的附件记录会显示在这里',
    clearResolved: '清理已处理记录',
    clearResolvedDesc: '移除已保存和已删除的记录',
    pendingAttachment: '待处理附件',
    attachmentKindImage: '图片',
    attachmentKindFile: '文件',

    // 附件操作
    nextStepRetry: '下一步：重试保存、复制链接或删除 OSS 对象',
    historyCopyLink: '历史记录：可复制链接或从列表移除',
    historyDeleted: '历史记录：OSS 对象已删除，可从列表移除',
    nextStepSave: '下一步：保存到 Workflowy、复制链接或删除 OSS 对象',

    // wfv 视图
    cleanup: '清理',
    cleanupDesc: '只显示 wf 发送目标下未完成的直接子节点',
    addViewEntry: '➕ 添加查看入口',
    addViewEntryDesc: '添加到 wfv 查看入口',
    nodeEntry: '节点',
    enterBrowse: 'Enter: 浏览',
    pinWidget: 'Alt + Ent: 挂件',
    reference: '引用',
    captureTarget: 'wf 发送目标',

    // wf 操作
    gotoSettings: '前往设置',
    quickCapture: '快速收集',
    pendingUpload: '待上传',
    recentAttachment: '最近附件',

    // 操作反馈
    addSuccess: '添加成功',
    deleteSuccess: '删除成功',
    saveSuccess: '保存成功',
    uploadSuccess: '上传成功',
    copySuccess: '已复制到剪贴板',
    importSuccess: '导入成功',
    exportSuccess: '导出成功',

    // 错误信息
    error: '错误',
    networkError: '网络错误，请检查网络连接',
    uploadFailed: '上传失败',
    ossQuotaExceeded: 'OSS 配额超限',
    fileTooLarge: '文件大小超过限制',
    invalidFileType: '无效的文件类型',
    missingConfig: '缺少配置项',
    apiKeyNotSet: 'API Key 未设置',
    targetNotFound: '目标未找到',

    // 导入导出
    exportJsonFile: '导出 JSON 文件',
    exportJsonDesc: '保存完整配置 .json，并复制同一份 JSON 到剪贴板（包含密钥）',
    importJsonFile: '导入 JSON 文件',
    importJsonDesc: '选择 .json 文件，解析摘要后再确认覆盖当前配置',

    // 清理视图
    cleanupProgress: '清理进度',
    remaining: '剩余',
    moveCompleteDelete: '移动、完成或删除后会自动刷新此列表',

    // 记住来源
    rememberSource: '记住来源',
    clearSource: '清除来源',
    nextTextToSource: '下一条文本会写入该来源下',
    sourceNoNodeId: '来源缺少节点 ID，请重新记住',

    // 搜索
    noMatchCreate: '没有匹配，创建节点',
    noMatchCreateDesc: '当前路径下无搜索结果，按 Enter 新建',
    stillWantCreate: '仍要创建',
    hasMatchesAbove: '上方已有',

    // 节点操作
    browse: '进入',
    complete: '完成',
    move: '移动',
    copy: '复制',
    more: '更多',
    openInBrowser: '浏览器打开',
    openWidget: '挂件打开',
    confirmDelete: '确认删除',

    // 预览
    preview: '预览附件',
    deleteFromOss: '删除 OSS 对象',
    retrySave: '重试保存',

    // 上传状态
    creatingNode: '正在创建节点...',
    uploading: '正在上传...',
    uploadComplete: '上传完成',

    // 帮助
    getUuidHelp: '获取 UUID 帮助',
    openUuidPage: '打开 UUID 获取页面',

    // 配置摘要
    willOverwrite: '会覆盖',
    empty: '空',
    notConfigured: '未配置'
};

// 英文翻译
const en = {
    // 通用
    back: '↩️ Back',
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    enabled: 'Enabled',
    disabled: 'Disabled',
    set: 'Set',
    notSet: 'Not Set',

    // 状态
    saved: 'Saved',
    saveFailed: 'Save Failed',
    deleted: 'Deleted',
    pending: 'Pending',
    completed: 'Completed',

    // 设置视图
    commonSettings: 'Common Settings',
    commonSettingsDesc: 'API Key, wf target, wfv entries, tags',
    ossSettings: 'OSS Upload Settings',
    otherSettings: 'Other Settings',
    otherSettingsDesc: 'Timestamp, separator, link title, etc.',
    configImportExport: 'Config Import / Export',
    configImportExportDesc: 'Backup or restore settings via JSON file',
    uuidHelp: 'How to get UUID?',
    uuidHelpDesc: 'Open help page',
    pluginVersion: 'Version',

    // 常用设置
    apiKeySettings: 'API Key Settings',
    wfCaptureTarget: 'wf Capture Target',
    wfvViewEntries: 'wfv View Entries',
    tagManagement: 'Tag Management',

    // 目标选择
    pickFromTargets: 'Select from Workflowy Targets',
    currentTarget: 'Current Target',
    enterManually: 'Enter Manually',

    // 其他设置
    timestampSettings: 'Timestamp Settings',
    createPosition: 'Create Position',
    top: 'Top',
    bottom: 'Bottom',
    separator: 'Separator',
    linkTitleFetch: 'Fetch Link Title',
    webTag: 'Web Tag',
    clipboardPrefill: 'Clipboard Prefill Link',
    timestampMode: 'Timestamp Mode',
    aggregateMode: 'Aggregate to sync node',
    singleMode: 'Single timestamp per item',

    // OSS 设置
    ossEnabled: 'Enable OSS Upload',
    bucketName: 'Bucket Name',
    region: 'Region',
    accessKeyId: 'AccessKey ID',
    accessKeySecret: 'AccessKey Secret',
    testUpload: 'Test Upload',
    testUploadDesc: 'Upload 1x1 test image and auto clean up',
    advancedSettings: 'Advanced Settings',
    accessAndStorage: 'Access & Storage',
    imageSettings: 'Image Settings',
    fileSettings: 'File Settings',
    recentAttachments: 'Recent Attachments',

    // OSS 高级设置
    defaultAccessDomain: 'Default Access Domain',
    customAccessDomain: 'Custom Access Domain',
    storagePathPrefix: 'Storage Path Prefix',
    autoImageTag: 'Auto Image Tag',
    autoFileTag: 'Markdown File Tag',
    autoFileIcon: 'Markdown File Icon',
    markdownViewer: 'Markdown Viewer Link',
    initializeViewer: 'Initialize / Verify Markdown Viewer',

    // 标签设置
    imageTagName: 'Image Tag Name',
    fileTagName: 'File Tag Name',
    fileIconChar: 'File Icon Character',
    webTagName: 'Web Tag Name',

    // 最近附件
    noRecentAttachments: 'No Recent Attachments',
    noRecentAttachmentsDesc: 'Uploaded attachment records will appear here',
    clearResolved: 'Clear Resolved Records',
    clearResolvedDesc: 'Remove saved and deleted records',
    pendingAttachment: 'Pending Attachment',
    attachmentKindImage: 'Image',
    attachmentKindFile: 'File',

    // 附件操作
    nextStepRetry: 'Next: Retry save, copy link, or delete OSS object',
    historyCopyLink: 'History: Copy link or remove from list',
    historyDeleted: 'History: OSS object deleted, remove from list',
    nextStepSave: 'Next: Save to Workflowy, copy link, or delete OSS object',

    // wfv 视图
    cleanup: 'Cleanup',
    cleanupDesc: 'Only show incomplete children of wf capture target',
    addViewEntry: '➕ Add View Entry',
    addViewEntryDesc: 'Add to wfv view entries',
    nodeEntry: 'Node',
    enterBrowse: 'Enter: Browse',
    pinWidget: 'Alt + Ent: Widget',
    reference: 'Ref',
    captureTarget: 'wf Capture Target',

    // wf 操作
    gotoSettings: 'Go to Settings',
    quickCapture: 'Quick Capture',
    pendingUpload: 'Pending Upload',
    recentAttachment: 'Recent Attachment',

    // 操作反馈
    addSuccess: 'Added successfully',
    deleteSuccess: 'Deleted successfully',
    saveSuccess: 'Saved successfully',
    uploadSuccess: 'Uploaded successfully',
    copySuccess: 'Copied to clipboard',
    importSuccess: 'Imported successfully',
    exportSuccess: 'Exported successfully',

    // 错误信息
    error: 'Error',
    networkError: 'Network error, please check your connection',
    uploadFailed: 'Upload failed',
    ossQuotaExceeded: 'OSS quota exceeded',
    fileTooLarge: 'File size exceeds limit',
    invalidFileType: 'Invalid file type',
    missingConfig: 'Missing configuration',
    apiKeyNotSet: 'API Key not set',
    targetNotFound: 'Target not found',

    // 导入导出
    exportJsonFile: 'Export JSON File',
    exportJsonDesc: 'Save full config .json and copy to clipboard (includes secrets)',
    importJsonFile: 'Import JSON File',
    importJsonDesc: 'Select .json file, review summary, then confirm overwrite',

    // 清理视图
    cleanupProgress: 'Cleanup Progress',
    remaining: 'Remaining',
    moveCompleteDelete: 'List auto-refreshes after move/complete/delete',

    // 记住来源
    rememberSource: 'Remember Source',
    clearSource: 'Clear Source',
    nextTextToSource: 'Next text will be written under this source',
    sourceNoNodeId: 'Source missing node ID, please remember again',

    // 搜索
    noMatchCreate: 'No match, create node',
    noMatchCreateDesc: 'No results, press Enter to create',
    stillWantCreate: 'Still want to create',
    hasMatchesAbove: 'Above has',

    // 节点操作
    browse: 'Browse',
    complete: 'Complete',
    move: 'Move',
    copy: 'Copy',
    more: 'More',
    openInBrowser: 'Open in Browser',
    openWidget: 'Open Widget',
    confirmDelete: 'Confirm Delete',

    // 预览
    preview: 'Preview Attachment',
    deleteFromOss: 'Delete OSS Object',
    retrySave: 'Retry Save',

    // 上传状态
    creatingNode: 'Creating node...',
    uploading: 'Uploading...',
    uploadComplete: 'Upload complete',

    // 帮助
    getUuidHelp: 'Get UUID Help',
    openUuidPage: 'Open UUID page',

    // 配置摘要
    willOverwrite: 'Will overwrite',
    empty: 'Empty',
    notConfigured: 'Not configured'
};

// 翻译字典
const translations = {
    zh,
    en
};

// 获取翻译文本
const t = (key) => {
    const dict = translations[LOCALE] || translations.zh;
    return dict[key] !== undefined ? dict[key] : (translations.zh[key] || key);
};

// 获取当前语言
const getLocale = () => LOCALE;

// 判断是否为英文
const isEnglish = () => LOCALE === 'en';

// 判断是否为中文
const isChinese = () => LOCALE === 'zh';

module.exports = {
    t,
    getLocale,
    isEnglish,
    isChinese,
    LOCALE
};

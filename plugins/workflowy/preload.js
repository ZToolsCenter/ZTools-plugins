// preload.js (Refactored)

const { ModifierTracker, AppState, EventManager } = require('./src/core/state');
const {
  getSettings,
  saveSettings
} = require('./src/core/settings');
const { getNodes, getDefaultNode, NodeManager, TargetManager } = require('./src/core/node_manager');
const { workflowyApiRequest, listTargets, resolveApiRef, resolveCaptureApiRef, fetchNodes } = require('./src/api/workflowy');
const { CacheManager } = require('./src/core/cache');
const {
  listRecentAttachments,
  getRecentAttachment,
  markRecentAttachmentSaved,
  markRecentAttachmentSaveFailed,
  markRecentAttachmentDeleted,
  removeRecentAttachment,
  clearResolvedRecentAttachments
} = require('./src/core/recent_attachments');
const {
  getPendingCapture,
  enqueuePendingCapture,
  markPendingCaptureFailed,
  removePendingCapture,
  removePendingCapturesByText
} = require('./src/core/pending_captures');
const {
  getRememberedWebSource,
  rememberWebSource,
  clearRememberedWebSource,
  parseStagedWebLinkCandidate
} = require('./src/core/web_capture');
const {
  getCapturedLinkNodeId,
  rememberCapturedLink,
  forgetCapturedLink
} = require('./src/core/captured_links');
const { createStagedLinkCaptureHost } = require('./src/core/staged_link_capture');
const { readClipboardText } = require('./src/utils/clipboard');
const {
  normalizeOssSettings,
  isOssConfigured,
  getMissingOssFields,
  buildOssDefaultPublicHost,
  buildOssEndpointFromRegion,
  uploadBufferToOss,
  deleteObjectFromOss
} = require('./src/api/oss');
const {
  renderList,
  openPreviewWindow,
  openListWidget,
  consumePreviewDeleteNotification,
  setPreviewDeleteRefreshHandler,
  setupInputAndKeyboard,
  showNodeActions,
  executeNodeAction,
  handlePendingUploadAction,
  handleInlineEditAction,
  setNavigateTo,
  setNavigateToCleanup,
  setMoveTargetImportMenu,
  setManualMoveTargetInput,
  setCreateNode,
  setComposeHost
} = require('./src/ui/renderer');
const { createComposeHostBridge } = require('./src/ui/compose_host');
const { createComposeFeatureHostBridge } = require('./src/ui/compose_feature_host');
const { COMPOSE_CHANNELS } = require('./src/ui/compose_window_host');
const {
  openLiveSettingsInput,
  openConfirmSettingsInput,
  confirmPendingSettingsImport,
  exportSettingsJsonFile,
  importSettingsJsonFile
} = require('./src/ui/settings_host');
const {
  createSettingsViewHostBridge
} = require('./src/ui/settings_view_host');
const {
  createSettingsSelectHostBridge
} = require('./src/ui/settings_select_host');
const {
  createTargetImportHostBridge
} = require('./src/ui/target_import_host');
const {
  createManualTargetHostBridge
} = require('./src/ui/manual_target_host');
const {
  createRecentAttachmentHostBridge
} = require('./src/ui/recent_attachment_host');
const {
  createPendingCaptureHostBridge
} = require('./src/ui/pending_capture_host');
const {
  createHealthcheckHostBridge
} = require('./src/ui/healthcheck_host');
const {
  createWorkflowyViewHostBridge
} = require('./src/ui/workflowy_view_host');
const {
  createWorkflowyAddHostBridge
} = require('./src/ui/workflowy_add_host');
const {
  stripHtml,
  formatTargetItem,
  humanizeRefName,
  parseTaskboxInput,
  extractLinksFromCaptureText,
  getCurrentTime,
  SYNC_ANCHOR_TAG,
  hasTagToken,
  appendSystemTag,
  buildCaptureChildren,
  normalizeParentId,
  isWorkflowyAddKeyword,
  deriveInitialQuickTextFromAction,
  deriveComposeInitialText
} = require('./src/utils/helpers');
const { extractImageFromPluginPayload } = require('./src/utils/image');
const { extractMarkdownFileFromPluginPayload } = require('./src/utils/markdown_file');
const { buildAttachmentNodePayload } = require('./src/utils/attachments');
const { fetchPageTitle } = require('./src/utils/link_title');
const {
  sortRecentAttachmentsForRecovery,
  getPendingRecentAttachments,
  formatRecentAttachmentDescription,
  buildOssSetupStatus
} = require('./src/utils/interaction');
const REMEMBER_WEB_SOURCE_FEATURE_CODE = 'workflowy-remember-web-source';

// Initialize State
ModifierTracker.init();

// =================================================================
// Core Logic Implementation
// =================================================================

const navigateTo = async (nodeId, nodeName, isPushStack = true) => {
  AppState.callbackSetList([{ title: '正在载入...', description: nodeName }]);
  AppState.loadNotice = '';
  EventManager.clear();

  if (isPushStack) {
    if (nodeId === 'None') AppState.navigationStack = [];
    else {
      const top = AppState.navigationStack[AppState.navigationStack.length - 1];
      if (!top || top.id !== nodeId) AppState.navigationStack.push({ id: nodeId, name: nodeName });
    }
  }

  AppState.currentItemId = nodeId;
  AppState.activeItem = null;

  try {
    const apiRef = await resolveApiRef(nodeId);

    await fetchNodes(
      apiRef,
      (cachedData) => {
        // Render cached data
        const items = (cachedData.nodes || []).sort((a, b) => (a.priority || 0) - (b.priority || 0));
        AppState.currentItems = items;
        AppState.callbackSetList(renderList(items));
        setupInputAndKeyboard(nodeName, { pendingCaptureHost }); // Setup input for cached data
      },
      (freshData) => {
        // Render fresh data
        const items = (freshData.nodes || []).sort((a, b) => (a.priority || 0) - (b.priority || 0));
        AppState.currentItems = items;
        AppState.callbackSetList(renderList(items));
        setupInputAndKeyboard(nodeName, { pendingCaptureHost }); // Re-setup input for fresh data
      }
    );

  } catch (err) {
    if (AppState.mode === 'add' && err?.code === 'WORKFLOWY_NETWORK_ERROR') {
      // Offline capture: keep the add surface usable instead of leaving a
      // dead error list; failed sends are persisted by the capture layer.
      AppState.currentItems = [];
      AppState.loadNotice = `列表载入失败：${err.message}；仍可直接输入发送，失败会自动保存为待发送消息`;
      setupInputAndKeyboard(nodeName, { pendingCaptureHost });
      window.ztools?.showNotification(`载入失败: ${err.message} `);
      return;
    }
    AppState.callbackSetList([{ title: '载入失败', description: err.message, type: 'error' }]);
  }
};

const navigateToCleanup = async (nodeId, nodeName, isPushStack = true) => {
  const cleanupTitle = `${nodeName || 'Inbox'} 清理`;
  AppState.callbackSetList([{ title: '正在载入清理视图...', description: nodeName }]);
  AppState.loadNotice = '';
  EventManager.clear();
  AppState.mode = 'cleanup';

  if (isPushStack) {
    AppState.navigationStack = [{ id: nodeId, name: nodeName || 'Inbox' }];
  } else if (AppState.navigationStack.length === 0) {
    AppState.navigationStack = [{ id: nodeId, name: nodeName || 'Inbox' }];
  }

  AppState.currentItemId = nodeId;
  AppState.activeItem = null;

  const renderCleanupData = (data) => {
    const items = (data.nodes || [])
      .filter(item => !item.completedAt)
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    AppState.currentItems = items;
    const rendered = renderList(items);
    AppState.callbackSetList(rendered.length > 0 ? rendered : [{
      title: '清理完成',
      description: '当前没有未完成的直接子节点',
      type: 'info'
    }]);
    setupInputAndKeyboard(cleanupTitle, { pendingCaptureHost });
  };

  try {
    const apiRef = await resolveApiRef(nodeId);
    await fetchNodes(apiRef, renderCleanupData, renderCleanupData);
  } catch (err) {
    AppState.callbackSetList([{ title: '载入失败', description: err.message, type: 'error' }]);
  }
};

const getCreatePosition = (settings = getSettings()) => (
  settings.createPosition === 'top' ? 'top' : 'bottom'
);

const getCurrentParentName = () => AppState.navigationStack[AppState.navigationStack.length - 1]?.name || '';

const getRememberableWebLink = (input = '') => {
  const parsed = extractLinksFromCaptureText(input);
  if (parsed.links.length !== 1 || parsed.text) return null;
  return parsed.links[0];
};

const rememberWebSourceFromInput = async (input, settings = getSettings()) => {
  const link = getRememberableWebLink(input);
  if (!link?.url) return null;

  let title = link.isExplicitTitle ? link.title : '';
  if (!title && settings.enableLinkTitleFetch) {
    title = await fetchPageTitle(link.url, { timeoutMs: 1000 });
  }

  return rememberWebSource({
    url: link.url,
    title: title || link.url
  });
};

const getWorkflowyNodeId = (node) => String(
  node?.id
  || node?.nodeId
  || node?.node_id
  || node?.item_id
  || node?.itemId
  || node?.node?.id
  || node?.item?.id
  || ''
).trim();

const createWorkflowyNode = async (targetParentId, payload, settings = getSettings()) => {
  const createRes = await workflowyApiRequest('nodes', {
    name: payload.name,
    note: payload.note,
    parent_id: targetParentId,
    position: getCreatePosition(settings)
  });
  const nodeId = getWorkflowyNodeId(createRes);
  return { ...createRes, id: nodeId || createRes?.id || null };
};

const findCreatedWorkflowyChildNodeId = async ({
  parentId,
  expectedItem,
  settings = getSettings()
} = {}) => {
  if (!parentId || !expectedItem) return '';

  const data = await workflowyApiRequest('nodes', { parent_id: parentId }, 'GET', true);
  const expectedName = stripHtml(expectedItem.name || '').trim();
  const expectedNote = String(expectedItem.note || '').trim();
  const candidates = (data?.nodes || [])
    .filter(node => {
      const nodeId = getWorkflowyNodeId(node);
      if (!nodeId) return false;
      const nodeName = stripHtml(node?.name || '').trim();
      const nodeNote = String(node?.note || node?.nt || '').trim();
      return nodeName === expectedName && nodeNote === expectedNote;
    })
    .sort((left, right) => {
      const leftTime = Number(left?.modifiedAt || left?.createdAt || 0);
      const rightTime = Number(right?.modifiedAt || right?.createdAt || 0);
      if (leftTime !== rightTime) return rightTime - leftTime;
      return 0;
    });

  const nodeId = getWorkflowyNodeId(candidates[0]);
  if (nodeId) CacheManager.remove(`nodes_${parentId || 'None'}`);
  return nodeId;
};

const createWorkflowyChildren = async (targetParentId, items, settings = getSettings()) => {
  const orderedItems = getCreatePosition(settings) === 'top' ? [...items].reverse() : items;
  const createdNodes = [];
  for (const item of orderedItems) {
    createdNodes.push(await createWorkflowyNode(targetParentId, item, settings));
  }
  CacheManager.remove(`nodes_${targetParentId || 'None'}`);
  return createdNodes;
};

const resolveTimestampNode = async (targetParentId, settings = getSettings()) => {
  if (settings.timestampMode !== 'group_today') {
    return createWorkflowyNode(targetParentId, { name: getCurrentTime() }, settings);
  }

  try {
    const data = await workflowyApiRequest('nodes', { parent_id: targetParentId }, 'GET', true);
    const items = data?.nodes || [];
    const reusableNode = items
      .map((item, index) => ({
        item,
        index,
        createdAt: Number.isFinite(item?.createdAt) ? item.createdAt : Number.POSITIVE_INFINITY
      }))
      .filter(({ item }) => !item?.completedAt && hasTagToken(item?.name || '', SYNC_ANCHOR_TAG))
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.index - b.index;
      })[0]?.item;

    if (reusableNode) {
      const nodeId = reusableNode?.item_id || reusableNode?.id || reusableNode?.nodeId || null;
      if (nodeId) return { ...reusableNode, id: nodeId, reused: true };
    }
  } catch (error) {
    console.error('Failed to resolve grouped timestamp node, creating a new one instead:', error);
  }

  return createWorkflowyNode(targetParentId, {
    name: appendSystemTag(getCurrentTime(), SYNC_ANCHOR_TAG)
  }, settings);
};

const createAttachmentCaptureNode = async ({
  parentId,
  attachment,
  text = '',
  settings = getSettings(),
  sourceMode = attachment?.sourceMode || AppState.mode || 'add'
}) => {
  const item = buildAttachmentNodePayload(attachment, settings, {
    text,
    sourceMode
  });

  if (settings.useTimestamp) {
    const timestampNode = await resolveTimestampNode(parentId, settings);
    const createdItems = timestampNode.id
      ? await createWorkflowyChildren(timestampNode.id, [item], settings)
      : [];
    CacheManager.remove(`nodes_${parentId || 'None'}`);
    return { item, createdNode: createdItems[0] || null, timestampNode };
  }

  const createdItems = await createWorkflowyChildren(parentId, [item], settings);
  return { item, createdNode: createdItems[0] || null };
};

const createTextCaptureNodes = async ({
  parentId,
  text,
  settings = getSettings(),
  rememberedWebSource = null,
  forceParentId = null,
  mode = AppState.mode
}) => {
  const defaultTag = mode === 'add' ? settings.defaultTag : '';
  const childItems = await buildCaptureChildren(text, defaultTag, {
    enableLinkTitleFetch: settings.enableLinkTitleFetch,
    rememberedWebSource,
    webTagEnabled: settings.webTagEnabled,
    webTag: settings.webTag
  });

  if (childItems.length === 0) {
    return { childItems: [], createdNodes: [], timestampNode: null, createdParentId: null };
  }

  if (forceParentId) {
    const createdNodes = await createWorkflowyChildren(forceParentId, childItems, settings);
    return { childItems, createdNodes, timestampNode: null, createdParentId: forceParentId };
  }

  if (settings.useTimestamp) {
    const timestampNode = await resolveTimestampNode(parentId, settings);
    const createdNodes = timestampNode.id
      ? await createWorkflowyChildren(timestampNode.id, childItems, settings)
      : [];
    CacheManager.remove(`nodes_${parentId || 'None'}`);
    return { childItems, createdNodes, timestampNode, createdParentId: timestampNode.id || null };
  }

  const createdNodes = await createWorkflowyChildren(parentId, childItems, settings);
  return { childItems, createdNodes, timestampNode: null, createdParentId: parentId };
};

const retryRecentAttachmentCreate = async (attachmentId) => {
  const attachment = getRecentAttachment(attachmentId);
  if (!attachment) {
    window.ztools?.showNotification('未找到最近附件记录');
    return false;
  }
  if (attachment.status === 'deleted') {
    window.ztools?.showNotification('该附件已删除');
    return false;
  }

  const settings = getSettings();
  const parentId = normalizeParentId(attachment.targetParentId || getDefaultNode().id);
  const parentName = attachment.targetParentName || humanizeRefName(parentId || 'inbox');

  try {
    const result = await createAttachmentCaptureNode({
      parentId,
      attachment,
      text: attachment.captureText || '',
      settings,
      sourceMode: attachment.sourceMode || 'add'
    });
    markRecentAttachmentSaved(attachment.id, {
      captureText: attachment.captureText || '',
      targetParentId: parentId,
      targetParentName: parentName,
      workflowyNodeId: result.createdNode?.id || ''
    });
    window.ztools?.showNotification('附件已重新保存到 Workflowy');
    return true;
  } catch (error) {
    markRecentAttachmentSaveFailed(attachment.id, {
      captureText: attachment.captureText || '',
      targetParentId: parentId,
      targetParentName: parentName,
      lastError: error.message
    });
    window.ztools?.showNotification(`重试失败: ${error.message}`);
    return false;
  }
};

const recentAttachmentHost = createRecentAttachmentHostBridge({
  openPreviewWindow,
  setPreviewDeleteRefreshHandler,
  retryRecentAttachmentCreate
});

const retryPendingCapture = async (pendingId) => {
  const pending = getPendingCapture(pendingId);
  if (!pending) {
    window.ztools?.showNotification('待发送消息已不存在');
    return false;
  }
  if (AppState.createState.status === 'creating') {
    window.ztools?.showNotification('正在创建，请稍候');
    return false;
  }

  const previousMode = AppState.mode;
  AppState.createState = { status: 'creating', error: null };
  AppState.inputActions?.renderCurrentList?.();
  try {
    AppState.mode = pending.sourceMode || previousMode || 'add';
    await createTextCaptureNodes({
      parentId: normalizeParentId(pending.targetParentId),
      text: pending.text,
      settings: getSettings()
    });
    try {
      removePendingCapture(pending.id);
    } catch (storageError) {
      console.error('Failed to clear pending capture:', storageError);
    }
    window.ztools?.showNotification('待发送消息已发送');
    return true;
  } catch (error) {
    try {
      markPendingCaptureFailed(pending.id, error.message);
    } catch (storageError) {
      console.error('Failed to update pending capture:', storageError);
    }
    window.ztools?.showNotification(`重试失败: ${error.message}`);
    return false;
  } finally {
    AppState.mode = previousMode;
    AppState.createState = { status: 'idle', error: null };
    AppState.inputActions?.renderCurrentList?.();
  }
};

const pendingCaptureHost = createPendingCaptureHostBridge({
  retryPendingCapture
});

const healthcheckHost = createHealthcheckHostBridge();
const settingsViewHost = createSettingsViewHostBridge();

const stagedLinkCaptureHost = createStagedLinkCaptureHost({
  createTextCaptureNodes: (...args) => createTextCaptureNodes(...args),
  findCreatedWorkflowyChildNodeId: (...args) => findCreatedWorkflowyChildNodeId(...args),
  getWorkflowyNodeId,
  getCapturedLinkNodeId,
  rememberCapturedLink,
  forgetCapturedLink,
  notify: (message) => window.ztools?.showNotification(message)
});

const createNode = async (text, options = {}) => {
  if (AppState.createState.status === 'creating') {
    window.ztools?.showNotification('正在创建，请稍候');
    return;
  }

  const parentId = normalizeParentId(
    Object.prototype.hasOwnProperty.call(options, 'parentId') ? options.parentId : AppState.currentItemId
  );
  if (!parentId && parentId !== null) {
    window.ztools?.showNotification('无法在此创建节点');
    return;
  }

  const s = getSettings();
  const captureMode = options.mode || AppState.mode;
  const parentName = options.parentName || getCurrentParentName();
  const parsedCapture = extractLinksFromCaptureText(text);
  const rememberedWebSource = getRememberedWebSource();
  const shouldCreateRememberedWebChild = !!(
    !AppState.pendingUpload
    && rememberedWebSource
    && rememberedWebSource.workflowyNodeId
    && parsedCapture.links.length === 0
    && parsedCapture.text
  );
  const shouldDropStaleRememberedWebSource = !!(
    !AppState.pendingUpload
    && rememberedWebSource
    && !rememberedWebSource.workflowyNodeId
    && parsedCapture.links.length === 0
    && parsedCapture.text
  );
  const effectiveParentId = shouldCreateRememberedWebChild
    ? rememberedWebSource.workflowyNodeId
    : parentId;
  const effectiveParentName = shouldCreateRememberedWebChild
    ? rememberedWebSource.title
    : parentName;
  // One-shot parent link staged from the clipboard on hotkey entry.
  //
  // Staging the link is not enough on its own: uTools auto-fills the clipboard
  // into the sub-input on its own, so the URL can still reach the capture text.
  // Two cases must both produce `link -> note`:
  //   1. the input holds only the note  -> stage normally
  //   2. the input holds the URL plus the note (auto-fill leaked or uTools set
  //      the input value without firing onSubInput) -> strip the URL, which
  //      extractLinksFromCaptureText has already done for us in `parsedCapture.text`
  const stagedLinkCandidate = !AppState.pendingUpload ? AppState.stagedWebLink : null;
  const stagedLinkLeakedIntoInput = !!(
    stagedLinkCandidate
    && parsedCapture.links.some(link => link.url === stagedLinkCandidate.url)
  );
  const noteText = stagedLinkLeakedIntoInput ? parsedCapture.text : text;
  const stagedWebLink = stagedLinkCandidate && (
    stagedLinkLeakedIntoInput
    || (parsedCapture.links.length === 0 && parsedCapture.text)
  ) ? stagedLinkCandidate : null;

  AppState.createState = { status: 'creating', error: null };
  AppState.inputActions?.renderCurrentList?.();
  try {
    if (shouldDropStaleRememberedWebSource) {
      clearRememberedWebSource();
      throw new Error('摘录来源缺少节点 ID，已清除来源；消息已保存为待发送');
    }

    if (AppState.pendingUpload) {
      const pendingUpload = AppState.pendingUpload;
      const result = await createAttachmentCaptureNode({
        parentId,
        attachment: pendingUpload,
        text,
        settings: s,
        sourceMode: pendingUpload.sourceMode || captureMode || 'add'
      });
      markRecentAttachmentSaved(pendingUpload.id, {
        captureText: text,
        targetParentId: parentId,
        targetParentName: parentName,
        sourceMode: pendingUpload.sourceMode || captureMode || 'add',
        workflowyNodeId: result.createdNode?.id || ''
      });
      AppState.resetUploadState();
    } else if (stagedWebLink) {
      // Two layers, one submission: the link node first (normal timestamp
      // grouping), then the typed note as its child. forceParentId bypasses
      // useTimestamp, so the result is timestamp -> link -> note instead of
      // splitting the link and its note into separate timestamp buckets. A
      // link captured before is reused as the parent instead of being created
      // again; see src/core/staged_link_capture.js.
      await stagedLinkCaptureHost.submitStagedLinkCapture({
        parentId,
        noteText,
        stagedWebLink,
        settings: s,
        mode: captureMode
      });
      try {
        removePendingCapturesByText(text, effectiveParentId);
      } catch (storageError) {
        console.error('Failed to clear pending capture:', storageError);
      }
      AppState.stagedWebLink = null;
    } else {
      await createTextCaptureNodes({
        parentId,
        text,
        settings: s,
        rememberedWebSource: null,
        forceParentId: shouldCreateRememberedWebChild ? rememberedWebSource.workflowyNodeId : null,
        mode: captureMode
      });
      try {
        removePendingCapturesByText(text, effectiveParentId);
      } catch (storageError) {
        console.error('Failed to clear pending capture:', storageError);
      }
    }
    if (shouldCreateRememberedWebChild) {
      clearRememberedWebSource();
    }
    window.ztools?.showNotification('创建成功');
    if (captureMode === 'view') {
      navigateTo(AppState.currentItemId, AppState.navigationStack[AppState.navigationStack.length - 1]?.name || 'Current', false);
    } else if (captureMode === 'cleanup') {
      navigateToCleanup(parentId, parentName || getCurrentParentName() || 'Inbox', false);
    }
  } catch (e) {
    AppState.createState = { status: 'failed', error: e.message };
    if (AppState.pendingUpload?.id) {
      markRecentAttachmentSaveFailed(AppState.pendingUpload.id, {
        captureText: text,
        targetParentId: parentId,
        targetParentName: parentName,
        sourceMode: AppState.pendingUpload.sourceMode || captureMode || 'add',
        lastError: e.message
      });
    } else {
      try {
        enqueuePendingCapture({
          text,
          targetParentId: effectiveParentId,
          targetParentName: effectiveParentName,
          sourceMode: captureMode || 'add',
          error: e.message
        });
      } catch (storageError) {
        console.error('Failed to persist pending capture:', storageError);
      }
    }
    throw e;
  } finally {
    if (AppState.createState.status === 'creating') {
      AppState.createState = { status: 'idle', error: null };
      AppState.inputActions?.renderCurrentList?.();
    }
  }
};

const getTargetRef = (target) => String(target?.key || target?.id || target?.nodeId || target?.node_id || '').trim();

const getTargetName = (target) => stripHtml(target?.name || getTargetRef(target) || '未命名').trim() || humanizeRefName(getTargetRef(target));

const showWorkflowyTargetImportMenu = (options) => targetImportHost.showWorkflowyTargetImportMenu(options);

const targetImportHost = createTargetImportHostBridge({
  listTargets,
  formatTargetItem,
  getTargetRef
});
const manualTargetHost = createManualTargetHostBridge();

const settingsSelectHost = createSettingsSelectHostBridge({
  recentAttachmentHost,
  healthcheckHost,
  settingsHost: {
    openLiveSettingsInput,
    openConfirmSettingsInput,
    confirmPendingSettingsImport,
    exportSettingsJsonFile,
    importSettingsJsonFile
  },
  manualTargetHost,
  showWorkflowyTargetImportMenu,
  getTargetRef,
  getTargetName
});
const workflowyViewHost = createWorkflowyViewHostBridge({
  recentAttachmentHost,
  pendingCaptureHost,
  manualTargetHost,
  showWorkflowyTargetImportMenu,
  getTargetRef,
  getTargetName
});
const workflowyAddHost = createWorkflowyAddHostBridge({
  recentAttachmentHost,
  pendingCaptureHost
});

// Inject dependencies into renderer
setNavigateTo(navigateTo);
setNavigateToCleanup(navigateToCleanup);
setManualMoveTargetInput((options) => manualTargetHost.openManualTargetInput(options));
setMoveTargetImportMenu(() => {
  const parent = AppState.navigationStack[AppState.navigationStack.length - 1];
  showWorkflowyTargetImportMenu({
    callbackSetList: AppState.callbackSetList,
    existingRefs: [parent?.id].filter(Boolean),
    manualAction: 'move_manual_target',
    importAction: 'move_to_target',
    backAction: 'move_back_to_picker',
    manualTitle: '手动输入移动目标',
    backTitle: '↩️ 返回移动目标'
  });
});
setCreateNode(createNode);

const composeHost = createComposeHostBridge({
  getCreateNode: () => createNode,
  getTargetContext: () => ({
    parentId: AppState.currentItemId,
    parentName: getCurrentParentName(),
    mode: AppState.mode
  })
});
setComposeHost(composeHost);

const composeFeatureHost = createComposeFeatureHostBridge({
  composeHost,
  getSettings,
  getDefaultNode,
  setCaptureTarget: (...args) => TargetManager.setCaptureTarget(...args),
  resolveCaptureApiRef,
  humanizeRefName,
  deriveComposeInitialText
});

const { ipcRenderer } = require('electron');
ipcRenderer.removeAllListeners(COMPOSE_CHANNELS.submit);
ipcRenderer.removeAllListeners(COMPOSE_CHANNELS.cancel);
ipcRenderer.on(COMPOSE_CHANNELS.submit, (_event, payload) => {
  void composeHost.handleComposeSubmit(payload);
});
ipcRenderer.on(COMPOSE_CHANNELS.cancel, (_event, payload) => {
  composeHost.handleComposeCancel(payload);
});
ipcRenderer.removeAllListeners(COMPOSE_CHANNELS.ready);
ipcRenderer.on(COMPOSE_CHANNELS.ready, (_event, payload) => {
  composeHost.showPreparedComposeWindow(payload);
});
window.ztools?.onPluginOut?.(() => {
  composeHost.closeComposeWindow();
});

// =================================================================
// Plugin Exports
// =================================================================

const workflowyViewFeature = {
    mode: "list",
    args: {
      enter: (action, callbackSetList) => {
        EventManager.clear();
        AppState.reset();
        AppState.mode = 'view';
        AppState.callbackSetList = callbackSetList;
        setPreviewDeleteRefreshHandler(() => window.exports["workflowy-view"].args.enter({}, callbackSetList));
        consumePreviewDeleteNotification();

        const nodes = getNodes();
        if (action.payload?.id) {
          navigateTo(action.payload.id, action.payload.name);
          return;
        }

        callbackSetList(workflowyViewHost.buildWorkflowyViewRootList());
      },
      select: async (action, item, callbackSetList) => {
        await workflowyViewHost.handleWorkflowyViewRootSelect({
          item,
          callbackSetList,
          refreshRoot: () => window.exports["workflowy-view"].args.enter({}, callbackSetList),
          handlePendingUploadAction,
          navigateTo,
          navigateToCleanup,
          openListWidget,
          modifierTracker: ModifierTracker,
          showNodeActions,
          handleInlineEditAction,
          executeNodeAction,
          createNode
        });
      }
    }
};

const workflowyAddFeature = {
    mode: "list",
    args: {
      enter: async (action, callbackSetList) => {
        EventManager.clear();
        AppState.reset();
        AppState.mode = 'add';
        AppState.callbackSetList = callbackSetList;

        const settings = getSettings();
        if (!settings.apiKey) {
          callbackSetList([{ title: '请先配置 API Key', description: '输入 wfs 进入设置', type: 'error' }]);
          return;
        }

        const defaultNode = getDefaultNode();
        const targetContext = {
          parentId: defaultNode.id,
          nodeName: defaultNode.name
        };

        let resolveTargetPromise = null;
        const resolveTarget = async () => {
          if (!resolveTargetPromise) {
            resolveTargetPromise = (async () => {
              try {
                let resolvedNodeName = defaultNode.name || humanizeRefName(defaultNode.id);
                targetContext.parentId = await resolveCaptureApiRef(defaultNode, (recoveredTarget, recoveryError) => {
                  if (recoveryError?.code === 'WORKFLOWY_NETWORK_ERROR') {
                    // Transient transport failure: keep the stored capture target
                    // untouched and use Inbox for this capture only.
                    resolvedNodeName = recoveredTarget.name;
                    window.ztools?.showNotification(
                      `暂时无法连接 Workflowy 校验发送目标 ${defaultNode.id}，本次将发送到 Inbox（已保存目标未修改）`
                    );
                    return;
                  }
                  TargetManager.setCaptureTarget(
                    recoveredTarget.ref,
                    recoveredTarget.name,
                    recoveredTarget.refType
                  );
                  resolvedNodeName = recoveredTarget.name;
                  window.ztools?.showNotification(
                    `原 wf 发送目标 ${defaultNode.id} 已失效，已自动切换为 Inbox`
                  );
                });
                targetContext.nodeName = resolvedNodeName;
                // NOTE: no sub-input placeholder here. Registering one with a
                // no-op handler (as this line used to) swallowed whatever
                // uTools auto-filled from the clipboard during the network
                // round-trips above: the text was visible but never reached
                // plugin state, rendering, or submission. The real input shell
                // owns the sub-input and folds the target name into its
                // placeholder instead.
                return true;
              } catch (e) {
                window.ztools?.showNotification(`定位失败: ${e.message} `);
                return false;
              }
            })();
          }
          return resolveTargetPromise;
        };
        await workflowyAddHost.handleWorkflowyAddEnter({
          action,
          callbackSetList,
          settings,
          resolveTarget,
          targetContext,
          rememberWebSourceFeatureCode: REMEMBER_WEB_SOURCE_FEATURE_CODE,
          getRememberableWebLink,
          createTextCaptureNodes,
          getWorkflowyNodeId,
          findCreatedWorkflowyChildNodeId,
          rememberWebSourceFromInput,
          rememberWebSource,
          extractImageFromPluginPayload,
          extractMarkdownFileFromPluginPayload,
          deriveInitialQuickTextFromAction,
          isWorkflowyAddKeyword,
          createNode,
          navigateTo,
          getRememberedWebSource,
          readClipboardText,
          parseStagedWebLinkCandidate
        });
      },
      select: async (action, item, callbackSetList) => {
        await workflowyAddHost.handleWorkflowyAddSelect({
          item,
          callbackSetList,
          handlePendingUploadAction,
          handleInlineEditAction,
          executeNodeAction,
          showNodeActions
        });
      }
    }
};

const workflowyComposeFeature = {
    mode: "list",
    args: {
      enter: async (action, callbackSetList) => {
        try {
          window.ztools?.hideMainWindow?.();
        } catch (error) {
          console.error('Failed to hide uTools window for long-text shortcut:', error);
        }
        EventManager.clear();
        AppState.reset();
        AppState.mode = 'add';
        AppState.callbackSetList = callbackSetList;
        await composeFeatureHost.handleComposeFeatureEnter({ action, callbackSetList });
      },
      select: async () => false
    }
};

const workflowySettingsFeature = {
    mode: "list",
    args: {
      enter: (action, callbackSetList) => {
        EventManager.clear();
        AppState.reset();
        AppState.callbackSetList = callbackSetList;
        const refresh = (v) => window.exports["workflowy-settings"].args.enter({ payload: v || 'home' }, callbackSetList);
        consumePreviewDeleteNotification();
        const view = settingsViewHost.resolveSettingsView(action);
        setPreviewDeleteRefreshHandler(() => refresh(view));
        callbackSetList(settingsViewHost.buildSettingsViewList(view));
      },
      select: (action, item, callbackSetList) => {
        const refresh = (v) => window.exports["workflowy-settings"].args.enter({ payload: v || 'home' }, callbackSetList);
        settingsSelectHost.handleSettingsSelect(item, callbackSetList, refresh);
      }
    }
};

window.exports = {
  "workflowy-view": workflowyViewFeature,
  "workflowy-add": workflowyAddFeature,
  "workflowy-compose": workflowyComposeFeature,
  "workflowy-add-image": workflowyAddFeature,
  "workflowy-add-markdown": workflowyAddFeature,
  "workflowy-remember-web-source": workflowyAddFeature,
  "workflowy-settings": workflowySettingsFeature
};

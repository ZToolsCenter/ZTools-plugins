<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed, onMounted, ref, h } from 'vue';
  import { useRouter } from 'vue-router';
  import {
    BuildOutline,
    SettingsOutline,
    CubeOutline,
    StatsChartOutline,
    ChatbubblesOutline,
    DocumentTextOutline,
    FolderOutline,
    GlobeOutline,
    ChevronDownOutline,
    AddOutline,
    ListOutline,
    BriefcaseOutline,
    CodeOutline,
    RocketOutline,
    StarOutline,
    FlagOutline,
    BookmarkOutline,
    HomeOutline,
    TerminalOutline,
    CloudOutline,
    FlashOutline,
    TrophyOutline,
    DesktopOutline
  } from '@vicons/ionicons5';
  import { useProviders } from '../../composables/useProviders';
  import { useRoutes } from '../../composables/useRoutes';
  import { useProfiles } from '../../composables/useProfiles';
  import { APP_LABELS } from '../../composables/shared';
  import { NIcon } from 'naive-ui';

  const message = useMessage();
  const dialog = useDialog();
  const { APP_TYPES, APP_ICONS, activeTab, setActiveTab } = useProviders();
  const { runtime, toggleQuick } = useRoutes();
  const {
    profiles,
    activeProfileId,
    loadProfiles,
    activateProfile,
    deactivateProfile,
    createProfile,
    renameProfile,
    deleteProfile
  } = useProfiles();
  const router = useRouter();

  onMounted(() => {
    loadProfiles();
  });

  // ── 图标映射 ──

  const ICON_MAP = {
    FolderOutline,
    BriefcaseOutline,
    HomeOutline,
    CodeOutline,
    TerminalOutline,
    RocketOutline,
    StarOutline,
    FlagOutline,
    BookmarkOutline,
    CloudOutline,
    FlashOutline,
    TrophyOutline,
    GlobeOutline,
    BuildOutline,
    CubeOutline,
    StatsChartOutline
  };

  function getIconComponent(name) {
    return ICON_MAP[name] || FolderOutline;
  }

  // ── 当前项目标签 ──

  const activeProfile = computed(() => profiles.value.find(pr => pr.id === activeProfileId.value));
  const activeProfileLabel = computed(() => activeProfile.value?.name || '全局默认');
  const activeProfileIconName = computed(() => activeProfile.value?.icon || 'GlobeOutline');

  // ── 下拉菜单 ──

  const profileDropdownOptions = computed(() => {
    const opts = [
      {
        label: '全局默认',
        key: '__default__',
        icon: () => h(NIcon, { size: 14 }, { default: () => h(GlobeOutline) })
      }
    ];
    if (profiles.value.length > 0) {
      opts.push({ type: 'divider', key: 'd1' });
      profiles.value.forEach(p => {
        const Comp = getIconComponent(p.icon);
        opts.push({
          label: p.name,
          key: p.id,
          icon: () => h(NIcon, { size: 14 }, { default: () => h(Comp) })
        });
      });
    }
    opts.push({ type: 'divider', key: 'd2' });
    opts.push({
      label: '新建项目',
      key: '__create__',
      icon: () => h(NIcon, { size: 14 }, { default: () => h(AddOutline) })
    });
    opts.push({
      label: '管理项目',
      key: '__manage__',
      icon: () => h(NIcon, { size: 14 }, { default: () => h(ListOutline) })
    });
    return opts;
  });

  function onProfileSelect(key) {
    if (key === '__create__') return openCreate();
    if (key === '__manage__') return (showManage.value = true);
    if (key === activeProfileId.value || (key === '__default__' && !activeProfileId.value)) return;

    if (key === '__default__') {
      deactivateProfile();
      message.info('已切换到全局默认');
    } else if (activateProfile(key)) {
      message.success('已切换项目');
    } else {
      message.error('切换失败');
    }
  }

  // ── 新建项目弹窗 ──

  const showCreate = ref(false);
  const newName = ref('');
  const newIcon = ref('FolderOutline');

  const PROJECT_ICONS = [
    { name: 'FolderOutline', icon: FolderOutline },
    { name: 'BriefcaseOutline', icon: BriefcaseOutline },
    { name: 'HomeOutline', icon: HomeOutline },
    { name: 'CodeOutline', icon: CodeOutline },
    { name: 'TerminalOutline', icon: TerminalOutline },
    { name: 'RocketOutline', icon: RocketOutline },
    { name: 'StarOutline', icon: StarOutline },
    { name: 'FlagOutline', icon: FlagOutline },
    { name: 'BookmarkOutline', icon: BookmarkOutline },
    { name: 'CloudOutline', icon: CloudOutline },
    { name: 'FlashOutline', icon: FlashOutline },
    { name: 'TrophyOutline', icon: TrophyOutline },
    { name: 'GlobeOutline', icon: GlobeOutline },
    { name: 'BuildOutline', icon: BuildOutline },
    { name: 'CubeOutline', icon: CubeOutline },
    { name: 'StatsChartOutline', icon: StatsChartOutline }
  ];

  function openCreate() {
    newName.value = '';
    newIcon.value = 'FolderOutline';
    showCreate.value = true;
  }

  function onCreate() {
    const name = newName.value.trim();
    if (!name) {
      message.warning('请输入项目名称');
      return;
    }
    const id = createProfile(name, newIcon.value);
    if (id) {
      message.success('项目已创建');
      showCreate.value = false;
    } else {
      message.error('创建失败');
    }
  }

  function onManageCreate() {
    showManage.value = false;
    openCreate();
  }

  // ── 管理项目弹窗 ──

  const showManage = ref(false);
  const editingId = ref('');
  const editingName = ref('');

  function startRename(p) {
    editingId.value = p.id;
    editingName.value = p.name;
  }

  function confirmRename() {
    if (!editingName.value.trim()) {
      message.warning('请输入项目名称');
      return;
    }
    if (renameProfile(editingId.value, editingName.value.trim())) {
      message.success('已改名');
    } else {
      message.error('改名失败');
    }
    editingId.value = '';
  }

  function cancelRename() {
    editingId.value = '';
  }

  function onDelete(p) {
    dialog.warning({
      title: '删除项目',
      content: `确定删除项目「${p.name}」？`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        if (deleteProfile(p.id)) {
          message.success('已删除');
        } else {
          message.error('删除失败');
        }
      }
    });
  }

  function onManageToggleActive(id) {
    if (!id || activeProfileId.value === id) {
      deactivateProfile();
      message.info('已切换到全局默认');
    } else {
      if (activateProfile(id)) {
        message.success('已切换项目');
      } else {
        message.error('切换失败');
      }
    }
  }

  function providerSummary(p) {
    const entries = Object.entries(p.providers || {});
    if (entries.length === 0) return '无供应商配置';
    return entries
      .map(([appType, providers]) => {
        const names = Object.values(providers).map(prov => prov.name || '未命名');
        return `${APP_LABELS[appType] || appType}: ${names.join(', ')}`;
      })
      .join(' | ');
  }

  // ── 更多导航 ──

  const moreNavOptions = [
    {
      label: '用量统计',
      key: '/stats',
      icon: () => h(NIcon, { size: 14 }, { default: () => h(StatsChartOutline) })
    },
    {
      label: '提示词管理',
      key: '/prompts',
      icon: () => h(NIcon, { size: 14 }, { default: () => h(DocumentTextOutline) })
    },
    {
      label: 'Skill管理',
      key: '/skills',
      icon: () => h(NIcon, { size: 14 }, { default: () => h(BuildOutline) })
    },
    {
      label: 'MCP管理',
      key: '/mcp',
      icon: () => h(NIcon, { size: 14 }, { default: () => h(CubeOutline) })
    },
    {
      label: '会话管理',
      key: '/sessions',
      icon: () => h(NIcon, { size: 14 }, { default: () => h(ChatbubblesOutline) })
    }
  ];

  function onMoreNavSelect(key) {
    router.push(key);
  }

  // ── 代理 ──

  const proxyOn = computed(() => !!runtime[activeTab()]?.running);

  function onTabChange(val) {
    setActiveTab(val);
  }

  function onToggleProxy() {
    const app = activeTab();
    if (!proxyOn.value) {
      try {
        const list = window.ztoolsCctoggle?.listProviders?.(app) || [];
        if (!list.length) {
          message.warning('当前 App 还没有供应商，请先添加供应商');
          return;
        }
        if (!list.some(p => p.isCurrent)) {
          message.warning('当前 App 没有已激活的供应商，请先点击「切换」激活一个供应商');
          return;
        }
      } catch (e) {}
    }
    const r = toggleQuick(app);
    if (!r.success && (r.error === 'no providers' || r.error === 'no members')) {
      message.warning('当前 App 还没有可用的供应商，请先添加供应商');
    } else if (!r.success) {
      message.error('操作失败：' + (r.error || 'unknown'));
    } else {
      message.success(r.running ? '路由已开启' : '路由已关闭');
    }
  }
</script>

<template>
  <nav class="tab-bar">
    <n-tabs
      :value="activeTab()"
      type="line"
      size="small"
      scrollable
      class="app-tabs"
      @update:value="onTabChange"
    >
      <n-tab-pane v-for="t in APP_TYPES" :key="t" :name="t" :tab="APP_LABELS[t]">
        <template #tab>
          <n-tooltip
            :theme-overrides="{ color: 'var(--primary)', textColor: '#fff' }"
            placement="bottom"
            :show-arrow="false"
          >
            <template #trigger>
              <span class="tab-label">
                <span class="tab-icon-wrap">
                  <img :src="APP_ICONS[t]" :alt="APP_LABELS[t]" class="tab-icon-img" />
                  <span v-if="t === 'claude'" class="tab-icon-badge" title="CLI">
                    <n-icon :size="9"><terminal-outline /></n-icon>
                  </span>
                  <span v-else-if="t === 'claude-desktop'" class="tab-icon-badge" title="桌面端">
                    <n-icon :size="9"><desktop-outline /></n-icon>
                  </span>
                </span>
              </span>
            </template>
            {{ APP_LABELS[t] }}
          </n-tooltip>
        </template>
      </n-tab-pane>
    </n-tabs>

    <span class="tab-divider"></span>

    <!-- 项目选择器 -->
    <n-dropdown
      :options="profileDropdownOptions"
      trigger="click"
      placement="bottom-start"
      @select="onProfileSelect"
    >
      <button class="profile-btn" :class="{ 'profile-btn--active': activeProfileId }">
        <n-icon :size="13" class="profile-btn-icon"
          ><component :is="getIconComponent(activeProfileIconName)"
        /></n-icon>
        <span class="profile-btn-label">{{ activeProfileLabel }}</span>
        <n-icon :size="10" class="profile-btn-arrow"><chevron-down-outline /></n-icon>
      </button>
    </n-dropdown>

    <label
      class="proxy-switch"
      :title="
        proxyOn
          ? APP_LABELS[activeTab()] + ' 代理运行中，点击关闭'
          : '打开以为 ' + APP_LABELS[activeTab()] + ' 开启代理'
      "
    >
      <span class="proxy-label">代理</span>
      <div class="switch-wrapper" @mousedown.prevent @keydown.space.prevent>
        <n-switch :value="proxyOn" size="small" @update:value="onToggleProxy" />
      </div>
    </label>

    <n-dropdown
      :options="moreNavOptions"
      trigger="hover"
      placement="bottom-end"
      @select="onMoreNavSelect"
    >
      <button class="nav-btn nav-btn--text" title="工具">
        <span class="nav-btn-label">工具</span>
        <n-icon :size="10" class="nav-btn-caret"><chevron-down-outline /></n-icon>
      </button>
    </n-dropdown>
    <button class="nav-btn" title="设置" @click="router.push('/settings')">
      <n-icon :size="15"><settings-outline /></n-icon>
    </button>

    <!-- 新建项目弹窗 -->
    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建项目"
      :style="{ width: '440px' }"
      :bordered="false"
      :segmented="{ content: true }"
      :header-style="{ padding: '10px 16px 6px' }"
    >
      <n-input
        v-model:value="newName"
        placeholder="输入项目名称"
        autofocus
        @keydown.enter.prevent="onCreate"
      />
      <div style="display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap">
        <button
          v-for="item in PROJECT_ICONS"
          :key="item.name"
          class="icon-option"
          :class="{ 'icon-option--active': newIcon === item.name }"
          @click="newIcon = item.name"
        >
          <n-icon :size="16"><component :is="item.icon" /></n-icon>
        </button>
      </div>
      <div style="font-size: 11px; color: var(--text-3); margin-top: 8px">
        将自动保存当前各 AI 工具的供应商选择
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px">
        <n-button size="small" @click="showCreate = false">取消</n-button>
        <n-button size="small" type="primary" :disabled="!newName.trim()" @click="onCreate"
          >创建</n-button
        >
      </div>
    </n-modal>

    <!-- 管理项目弹窗 -->
    <n-modal
      v-model:show="showManage"
      preset="card"
      title="项目管理"
      :style="{ width: '560px' }"
      :bordered="false"
      :segmented="{ content: true }"
      :header-style="{ padding: '10px 16px 6px' }"
    >
      <div style="display: flex; flex-direction: column; gap: 8px">
        <!-- 全局默认 -->
        <div class="pm-card" :class="{ 'pm-card--active': !activeProfileId }">
          <n-icon :size="18" class="pm-icon"><globe-outline /></n-icon>
          <div class="pm-info">
            <div class="pm-name">全局默认</div>
            <div class="pm-desc">无项目激活时使用的基础配置</div>
          </div>
          <n-tag v-if="!activeProfileId" type="success" size="small" :bordered="false" round
            >当前</n-tag
          >
          <n-button v-else size="tiny" quaternary @click="onManageToggleActive(null)"
            >切换到此</n-button
          >
        </div>

        <!-- 用户项目 -->
        <div
          v-for="p in profiles"
          :key="p.id"
          class="pm-card"
          :class="{ 'pm-card--active': activeProfileId === p.id }"
        >
          <n-icon :size="18" class="pm-icon"><component :is="getIconComponent(p.icon)" /></n-icon>
          <div class="pm-info">
            <template v-if="editingId === p.id">
              <div style="display: flex; gap: 4px; align-items: center">
                <n-input
                  v-model:value="editingName"
                  size="tiny"
                  autofocus
                  @keydown.enter.prevent="confirmRename"
                  @keydown.esc.prevent="cancelRename"
                />
                <n-button size="tiny" type="primary" @click="confirmRename">保存</n-button>
              </div>
            </template>
            <template v-else>
              <div class="pm-name">{{ p.name }}</div>
              <div class="pm-desc">{{ providerSummary(p) }}</div>
            </template>
          </div>
          <n-tag
            v-if="activeProfileId === p.id && editingId !== p.id"
            type="success"
            size="small"
            :bordered="false"
            round
            >当前</n-tag
          >
          <div v-if="editingId !== p.id" class="pm-actions">
            <n-button
              v-if="activeProfileId !== p.id"
              size="tiny"
              type="primary"
              quaternary
              @click="onManageToggleActive(p.id)"
              >激活</n-button
            >
            <n-button v-else size="tiny" quaternary @click="onManageToggleActive(p.id)"
              >取消</n-button
            >
            <n-button size="tiny" quaternary @click="startRename(p)">改名</n-button>
            <n-button size="tiny" quaternary type="error" @click="onDelete(p)">删除</n-button>
          </div>
        </div>

        <n-empty v-if="profiles.length === 0" description="暂无项目" style="padding: 16px 0" />

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px">
          <n-button size="small" type="primary" @click="onManageCreate">新建项目</n-button>
        </div>
      </div>
    </n-modal>
  </nav>
</template>

<style scoped>
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
  }
  .profile-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: 120px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    background: var(--bg-card, var(--n-color));
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .profile-btn:hover {
    border-color: var(--primary);
    color: var(--text);
  }
  .profile-btn--active {
    color: var(--primary);
    border-color: color-mix(in srgb, var(--primary) 40%, transparent);
  }
  .profile-btn-icon {
    flex-shrink: 0;
  }
  .profile-btn-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .profile-btn-arrow {
    flex-shrink: 0;
    opacity: 0.5;
  }

  .app-tabs {
    flex-shrink: 1;
    min-width: 0;
  }
  .app-tabs :deep(.n-tabs-tab-pad) {
    width: 20px !important;
  }
  .app-tabs :deep(.n-tabs-content) {
    height: 0 !important;
    overflow: hidden !important;
    min-height: 0 !important;
  }
  .app-tabs :deep(.n-tab-pane) {
    height: 0 !important;
    min-height: 0 !important;
    padding-top: 0 !important;
  }
  .app-tabs :deep(.n-tabs-tab) {
    padding: 4px 4px;
    font-size: 12px;
  }
  .app-tabs :deep(.n-tabs-nav-scroll-content) {
    height: 36px;
    border: none !important;
  }
  .app-tabs :deep(.n-tabs-bar) {
    background-color: var(--primary) !important;
  }
  .tab-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .tab-icon-wrap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }
  .tab-icon-img {
    width: 16px;
    height: 16px;
    vertical-align: middle;
    object-fit: contain;
    display: block;
  }
  .tab-icon-badge {
    position: absolute;
    top: -4px;
    left: -4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 0 0 1px var(--border);
    line-height: 1;
  }
  .tab-divider {
    flex: 1;
    min-width: 4px;
  }
  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .nav-btn:hover {
    background: var(--bg-card);
    color: var(--text);
  }
  .nav-btn--text {
    width: auto;
    padding: 0 8px;
    gap: 3px;
  }
  .nav-btn-label {
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .nav-btn-caret {
    flex-shrink: 0;
    opacity: 0.6;
  }
  .proxy-switch {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    user-select: none;
  }
  .proxy-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* 管理弹窗卡片 */
  .pm-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: border-color 0.15s;
  }
  .pm-card--active {
    border-color: var(--primary);
    background: color-mix(in srgb, var(--primary) 5%, transparent);
  }
  .pm-icon {
    flex-shrink: 0;
  }
  .pm-info {
    flex: 1;
    min-width: 0;
  }
  .pm-name {
    font-size: 13px;
    font-weight: 600;
  }
  .pm-desc {
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pm-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .icon-option {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: none;
    cursor: pointer;
    transition: all 0.15s;
  }
  .icon-option:hover {
    border-color: var(--primary);
  }
  .icon-option--active {
    border-color: var(--primary);
    background: color-mix(in srgb, var(--primary) 10%, transparent);
  }
</style>

<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed, onMounted, ref } from 'vue';
  import { useSkills } from '../../composables/useSkills';
  import { APP_ICONS } from '../../composables/shared';

  const message = useMessage();
  const dialog = useDialog();
  const {
    ALL_APPS,
    APP_LABELS,
    nestSkills,
    deployments,
    allSkills,
    loadNestSkills,
    loadDeployments,
    loadAllSkills,
    deploy,
    undeploy,
    syncMode
  } = useSkills();

  onMounted(() => {
    loadNestSkills();
    loadDeployments();
  });

  const toggling = ref(null);
  const deleting = ref(null);

  function confirmDelete(skillName) {
    dialog.warning({
      title: '确认删除',
      content: '确认删除 skill "' + skillName + '"？',
      positiveText: '确认删除',
      negativeText: '取消',
      onPositiveClick: function () {
        doDelete(skillName);
      }
    });
  }
  function doDelete(skillName) {
    deleting.value = skillName;
    var fn =
      window.ztoolsCctoggle?.removeNestSkill ||
      function () {
        return { success: false, error: 'not available' };
      };
    var result = fn(skillName);
    if (result.success) {
      loadNestSkills();
      loadDeployments();
    } else {
      message.error(result.error || '删除失败');
    }
    deleting.value = null;
  }

  function isDeployed(skillName, target) {
    const reg = deployments.value;
    return reg[skillName] && reg[skillName].some(d => d.target === target);
  }

  function getDeployMode(skillName, target) {
    const reg = deployments.value;
    if (reg[skillName]) {
      const d = reg[skillName].find(d => d.target === target);
      return d ? d.mode : null;
    }
    return null;
  }

  function toggleTarget(skillName, target) {
    toggling.value = skillName + ':' + target;
    try {
      if (isDeployed(skillName, target)) {
        undeploy(skillName, target);
      } else {
        deploy(skillName, target);
      }
      loadDeployments();
      loadAllSkills();
    } finally {
      toggling.value = null;
    }
  }

  const agentIcons = { ...APP_ICONS };

  const agentStats = computed(() => {
    // 从部署注册表统计，避免扫描目录时把用户/其他插件手动放置的 skill 也算进来（脏数据）
    const reg = deployments.value || {};
    const counts = {};
    ALL_APPS.forEach(a => {
      counts[a] = 0;
    });
    Object.keys(reg).forEach(skillName => {
      const arr = Array.isArray(reg[skillName]) ? reg[skillName] : [];
      arr.forEach(d => {
        if (d && counts.hasOwnProperty(d.target)) counts[d.target] += 1;
      });
    });
    return ALL_APPS.map(app => ({
      app,
      label: APP_LABELS[app],
      icon: agentIcons[app] || null,
      count: counts[app] || 0
    }));
  });

  const displayTargets = computed(() => {
    return ALL_APPS.filter(a => ['codex', 'claude', 'gemini', 'openclaw', 'opencode'].includes(a));
  });
</script>

<template>
  <div class="skill-list">
    <div class="list-header">
      <h3>已安装的 Skill</h3>
      <span class="list-count">{{ nestSkills.length }} 个</span>
    </div>
    <div class="dash-grid">
      <div
        v-for="stat in agentStats"
        :key="stat.app"
        class="dash-card"
        :class="{ 'dash-card--zero': stat.count === 0 }"
      >
        <div class="dash-icon" :class="'dash-icon--' + stat.app">
          <img
            v-if="stat.icon && (stat.icon.startsWith('/') || stat.icon.startsWith('data:'))"
            :src="stat.icon"
            :alt="stat.label"
            class="dash-icon-img"
          />
          <span v-else>{{ stat.icon || '📦' }}</span>
        </div>
        <div class="dash-body">
          <span class="dash-agent">{{ stat.label }}</span>
          <span v-if="stat.count" class="dash-num">{{ stat.count }}</span>
          <span v-else class="dash-num dash-num--zero">—</span>
          <span class="dash-unit">skill</span>
        </div>
      </div>
    </div>

    <div v-if="nestSkills.length === 0" class="empty">暂无已安装的 Skill，前往"搜索安装"添加</div>

    <div v-for="s in nestSkills" :key="s.name" class="skill-item">
      <div class="skill-icon">{{ s.hasSkillMd ? '&#x1F4CB;' : '&#x1F4C1;' }}</div>
      <div class="skill-info">
        <span class="skill-name">{{ s.name }}</span>
        <span class="skill-meta">
          <span v-if="s.repo" class="skill-repo">{{
            s.repo.replace('https://github.com/', '')
          }}</span>
          <span v-if="s.installedAt" class="skill-date"
            >安装于 {{ s.installedAt.slice(0, 10) }}</span
          >
        </span>
      </div>
      <div class="skill-agents">
        <button
          v-for="app in displayTargets"
          :key="app"
          class="agent-chip"
          :class="{
            'agent-chip--on': isDeployed(s.name, app),
            'agent-chip--link': getDeployMode(s.name, app) === 'symlink',
            'agent-chip--copy': getDeployMode(s.name, app) === 'copy',
            'agent-chip--toggling': toggling === s.name + ':' + app
          }"
          @click="toggleTarget(s.name, app)"
          :title="
            APP_LABELS[app] +
            (isDeployed(s.name, app) ? ' (' + getDeployMode(s.name, app) + ')' : ' (未启用)')
          "
        >
          {{ APP_LABELS[app] }}
          <span v-if="getDeployMode(s.name, app) === 'symlink'" class="chip-icon">&#x1F517;</span>
          <span v-else-if="getDeployMode(s.name, app) === 'copy'" class="chip-icon">&#x1F4CB;</span>
        </button>
      </div>
      <button
        class="btn-delete"
        :disabled="deleting === s.name"
        @click="confirmDelete(s.name)"
        :title="'删除 ' + s.name"
      >
        {{ deleting === s.name ? '…' : '✕' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
  .skill-list {
    height: 100%;
    overflow-y: auto;
  }
  .list-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }
  .list-header h3 {
    font-size: 15px;
    font-weight: 600;
  }
  .list-count {
    font-size: 12px;
    color: var(--text-muted);
  }

  .dash-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }
  .dash-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .dash-card:hover {
    border-color: var(--primary);
    box-shadow: 0 1px 4px rgba(217, 119, 6, 0.1);
  }
  .dash-card--nest {
    border-color: var(--primary);
    background: var(--primary-light);
  }
  .dash-card--zero {
    opacity: 0.55;
  }
  .dash-card--zero:hover {
    border-color: var(--text-muted);
    box-shadow: none;
  }

  .dash-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }
  .dash-icon-img {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
  .dash-icon--codex {
    background: #fef3c7;
  }
  .dash-icon--claude {
    background: #ede9fe;
  }
  .dash-icon--gemini {
    background: #dbeafe;
  }
  .dash-icon--opencode {
    background: #fce7f3;
  }
  .dash-icon--openclaw {
    background: #d1fae5;
  }

  .dash-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .dash-agent {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .dash-num {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;
  }
  .dash-card--nest .dash-num {
    color: var(--primary);
  }
  .dash-num--zero {
    color: var(--text-muted);
    font-size: 18px;
  }
  .dash-unit {
    font-size: 10px;
    color: var(--text-muted);
  }
  .empty {
    font-size: 13px;
    color: var(--text-muted);
    padding: 20px 0;
  }
  .skill-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 6px;
    background: var(--bg-card);
    transition: border-color 0.15s;
  }
  .skill-item:hover {
    border-color: var(--text-muted);
  }
  .skill-icon {
    font-size: 18px;
    width: 32px;
    text-align: center;
    flex-shrink: 0;
  }
  .skill-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .skill-name {
    font-size: 13px;
    font-weight: 500;
  }
  .skill-meta {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: var(--text-muted);
  }
  .skill-repo {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }
  .skill-date {
    flex-shrink: 0;
  }
  .skill-agents {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .agent-chip {
    padding: 3px 10px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--bg);
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-muted);
    white-space: nowrap;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .agent-chip:hover {
    border-color: var(--primary);
    color: var(--primary);
  }
  .agent-chip--on {
    border-color: var(--primary);
    color: var(--primary);
  }
  .agent-chip--link {
    border-color: var(--success);
    background: var(--primary-light);
    color: var(--success);
  }
  .agent-chip--copy {
    border-color: var(--primary);
    background: var(--primary-light);
    color: var(--primary);
  }
  .agent-chip--toggling {
    opacity: 0.5;
  }
  .chip-icon {
    font-size: 10px;
  }
  .skill-delete {
    flex-shrink: 0;
    margin-left: 4px;
  }
  .btn-delete {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-delete:hover {
    border-color: var(--danger, #e74c3c);
    color: var(--danger, #e74c3c);
    background: rgba(231, 76, 60, 0.06);
  }
  .btn-delete:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>

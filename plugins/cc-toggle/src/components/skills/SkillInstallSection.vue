<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
  import { openUrl } from '../../utils/openUrl';

  const message = useMessage();

  const PAGE_SIZE = 12;
  const searchQuery = ref('');
  const searchSource = ref('skillsh');
  const installing = ref(null);
  const installedNames = ref(new Set());
  const results = ref([]);
  const loading = ref(false);
  const displayCount = ref(PAGE_SIZE);

  const sources = [
    { key: 'skillsh', label: 'skill.sh' },
    { key: 'modelscope', label: 'ModelScope' }
  ];

  const sourceOptions = sources.map(function (s) {
    return { label: s.label, value: s.key };
  });

  const currentSource = computed(function () {
    return (
      sources.find(function (s) {
        return s.key === searchSource.value;
      }) || sources[0]
    );
  });

  function doSearch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!searchQuery.value || !searchQuery.value.trim()) return;
    runSearch(searchQuery.value);
  }

  const pagedResults = computed(function () {
    return results.value.slice(0, displayCount.value);
  });

  const allLoaded = computed(function () {
    return displayCount.value >= results.value.length;
  });

  function handleLoad() {
    return new Promise(function (resolve) {
      setTimeout(function () {
        displayCount.value = Math.min(displayCount.value + PAGE_SIZE, results.value.length);
        resolve();
      }, 200);
    });
  }

  let reqId = 0;
  let debounceTimer = null;
  let cancelled = false;

  async function runSearch(q) {
    const myId = ++reqId;
    const fn = window.ztoolsCctoggle?.searchSkills || (() => Promise.resolve([]));
    loading.value = true;
    displayCount.value = PAGE_SIZE;
    try {
      const data = await fn(q || '', searchSource.value);
      if (cancelled || myId !== reqId) return;
      results.value = Array.isArray(data) ? data : [];
    } catch (e) {
      if (cancelled || myId !== reqId) return;
      results.value = [];
    } finally {
      if (!cancelled && myId === reqId) loading.value = false;
    }
  }

  watch(searchQuery, function (q) {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q || !q.trim()) return;
    debounceTimer = setTimeout(() => runSearch(q), 250);
  });

  watch(searchSource, function () {
    if (debounceTimer) clearTimeout(debounceTimer);
    results.value = [];
    displayCount.value = PAGE_SIZE;
    if (!searchQuery.value || !searchQuery.value.trim()) return;
    debounceTimer = setTimeout(() => runSearch(searchQuery.value), 250);
  });

  onBeforeUnmount(function () {
    cancelled = true;
    reqId++;
    if (debounceTimer) clearTimeout(debounceTimer);
    loading.value = false;
  });

  // 加载已安装的 skill 列表，填充 installedNames
  onMounted(function () {
    if (window.ztoolsCctoggle?.listNestSkills) {
      var list = window.ztoolsCctoggle.listNestSkills();
      if (Array.isArray(list)) {
        installedNames.value = new Set(
          list.map(function (s) {
            return skillKey(s);
          })
        );
      }
    }
  });

  function formatCount(n) {
    n = n || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n >= 1 ? n.toLocaleString() : '';
  }

  function skillKey(s) {
    return (s.name || '') + '||' + (s.repo || '');
  }

  function install(skill) {
    installing.value = skillKey(skill);
    const fn = window.ztoolsCctoggle?.installSkill || (() => ({ success: false }));
    const result = fn(skill.name, skill.repo || '', skill.path || '', '');
    setTimeout(function () {
      if (result.success) {
        installedNames.value = new Set([...installedNames.value, skillKey(skill)]);
        if (window.ztoolsCctoggle?.listNestSkills) {
          window.ztoolsCctoggle.listNestSkills();
        }
      } else if (result.error) {
        message.error(result.error);
      }
      installing.value = null;
    }, 300);
  }
</script>

<template>
  <div class="install-section">
    <div class="search-wrap">
      <div class="search-bar">
        <n-select
          v-model:value="searchSource"
          :options="sourceOptions"
          size="small"
          class="source-select"
        />
        <n-input
          v-model:value="searchQuery"
          :placeholder="'搜索 ' + currentSource.label + ' 中的 skill...'"
          size="small"
          class="search-input"
          clearable
          @keydown.enter="doSearch"
        />
        <n-button
          size="small"
          type="primary"
          class="search-btn"
          :loading="loading"
          @click="doSearch"
        >
          搜索
        </n-button>
      </div>
    </div>

    <div class="results">
      <div v-if="!searchQuery.trim() && !results.length" class="results-hint">
        <span class="hint-icon">&#128270;</span>
        <span>输入关键词搜索可用的 Skill</span>
      </div>
      <div v-else-if="loading && !results.length" class="results-grid">
        <div v-for="i in 6" :key="i" class="result-card skeleton-card">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-url"></div>
          <div class="skeleton-line skeleton-btn"></div>
        </div>
      </div>
      <div v-else-if="searchQuery && results.length === 0" class="results-empty">无匹配结果</div>

      <n-infinite-scroll
        v-if="results.length"
        :distance="10"
        :loading="loading"
        @load="handleLoad"
        class="scroll-wrap"
      >
        <div class="results-grid">
          <div v-for="s in pagedResults" :key="skillKey(s)" class="result-card">
            <div class="card-top">
              <span class="result-name">{{ s.name }}</span>
              <span class="result-installs">&#8595; {{ formatCount(s.installs || 0) }}</span>
            </div>
            <a v-if="s.repo" href="#" class="result-repo" @click.prevent.stop="openUrl(s.repo)">{{
              s.repo
            }}</a>
            <button
              v-if="installedNames.has(skillKey(s))"
              class="btn-install btn-install--done"
              disabled
            >
              &#10003; 已安装
            </button>
            <button
              v-else-if="installing === skillKey(s)"
              class="btn-install btn-install--loading"
              disabled
            >
              安装中...
            </button>
            <button v-else class="btn-install" @click="install(s)">安装</button>
          </div>
        </div>
        <div v-if="!allLoaded" class="scroll-loading">
          <span class="scroll-spinner"></span>
          <span>加载更多...</span>
        </div>
      </n-infinite-scroll>
    </div>
  </div>
</template>

<style scoped>
  .install-section {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .search-wrap {
    margin-bottom: 14px;
    flex-shrink: 0;
    position: relative;
    padding-right: 20px;
  }
  .search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .source-select {
    width: 120px;
    flex-shrink: 0;
  }
  .search-input {
    flex: 1;
    min-width: 0;
  }
  .search-btn {
    flex-shrink: 0;
  }

  .results {
    flex: 1;
    overflow: hidden;
    margin-right: -20px;
  }
  .results-empty {
    text-align: center;
    padding: 40px 20px 0;
    font-size: 14px;
    color: var(--text-muted);
  }

  .results-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 60px 20px;
    color: var(--text-muted);
    font-size: 14px;
  }
  .hint-icon {
    font-size: 32px;
    opacity: 0.5;
  }

  .skeleton-card {
    pointer-events: none;
  }
  .skeleton-line {
    border-radius: 4px;
    background: linear-gradient(90deg, var(--bg-hover) 25%, var(--border) 50%, var(--bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  .skeleton-title {
    height: 14px;
    width: 50%;
    margin-bottom: 8px;
  }
  .skeleton-url {
    height: 10px;
    width: 75%;
    margin-bottom: 12px;
  }
  .skeleton-btn {
    height: 28px;
    width: 64px;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  .results-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
    padding-right: 20px;
  }

  .result-card {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-card);
    transition: border-color 0.15s;
  }
  .result-card:hover {
    border-color: var(--primary);
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .result-name {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-installs {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 2px 7px;
    border-radius: 8px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .result-repo {
    display: block;
    font-size: 10px;
    color: var(--text-muted);
    font-family: monospace;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 8px;
  }
  .result-repo:hover {
    color: var(--primary);
    text-decoration: underline;
  }
  .btn-install {
    padding: 6px 16px;
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    background: var(--primary);
    color: #fff;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .btn-install:hover {
    background: var(--primary-hover);
  }
  .btn-install--done {
    background: var(--bg-hover);
    color: var(--text-secondary);
    border-color: var(--border);
    cursor: default;
  }
  .btn-install--loading {
    opacity: 0.6;
    cursor: default;
  }

  .scroll-wrap {
    height: 100%;
  }
  .scroll-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px 20px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .scroll-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
</style>

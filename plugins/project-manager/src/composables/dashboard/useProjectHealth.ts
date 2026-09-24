import { computed, watch } from 'vue';
import type { Ref } from 'vue';
import { useProjectHealthStore } from '../../stores/projectHealth';
import { useProjectStore } from '../../stores/project';
import type { Project, ProjectHealthSnapshot } from '../../types';

/**
 * 项目健康状态 composable：监听可见项目变化，按需触发健康刷新，
 * 并对外暴露汇总统计。
 */
export function useProjectHealth(options: {
  filteredProjects: Ref<Project[]>;
}) {
  const healthStore = useProjectHealthStore();
  const projectStore = useProjectStore();

  /** 是否正在刷新 */
  const healthRefreshing = computed(() => healthStore.refreshing.size > 0);

  /** 获取指定项目的健康快照 */
  function getHealth(projectId: string): ProjectHealthSnapshot | undefined {
    return healthStore.get(projectId);
  }

  /** 手动触发对所有可见项目的健康刷新 */
  async function refreshVisible() {
    await healthStore.refreshMany(options.filteredProjects.value);
  }

  /** 汇总统计 */
  const healthSummary = computed(() => {
    const allProjects = projectStore.projects;
    let runningCount = 0;
    let dirtyCount = 0;
    let unhealthyCount = 0;
    let missingCount = 0;

    for (const p of allProjects) {
      const snapshot = healthStore.snapshots[p.id];
      if (!snapshot) continue;

      // 运行中：通过 runningProjectCount 判断
      if ((projectStore.runningProjectCount[p.id] ?? 0) > 0) {
        runningCount++;
      }
      // Git 有改动
      if (snapshot.gitDirty) {
        dirtyCount++;
      }
      // 路径缺失
      if (!snapshot.pathExists) {
        missingCount++;
        unhealthyCount++;
        continue;
      }
      // 有任何健康问题（排除 not_git，非 Git 项目不是异常）
      const realIssues = snapshot.issues.filter(
        (issue) => issue.code !== 'not_git'
      );
      if (realIssues.length > 0) {
        unhealthyCount++;
      }
    }

    return {
      total: allProjects.length,
      running: runningCount,
      dirty: dirtyCount,
      unhealthy: unhealthyCount,
      missing: missingCount,
    };
  });

  /** 健康状态对应的颜色标识 */
  function healthLevel(snapshot: ProjectHealthSnapshot | undefined): 'healthy' | 'warn' | 'error' | 'unknown' {
    if (!snapshot) return 'unknown';
    if (!snapshot.pathExists) return 'error';
    const realIssues = snapshot.issues.filter((i) => i.code !== 'not_git');
    if (realIssues.some((i) => i.level === 'error')) return 'error';
    if (realIssues.some((i) => i.level === 'warn')) return 'warn';
    return 'healthy';
  }

  /** 防抖刷新定时器 */
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** 当可见项目列表变化时，延迟触发健康扫描（防抖 1s） */
  watch(
    () => options.filteredProjects.value.map((p) => p.id),
    () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        healthStore.refreshMany(options.filteredProjects.value);
      }, 1000);
    },
    { immediate: true }
  );

  return {
    healthRefreshing,
    getHealth,
    refreshVisible,
    healthSummary,
    healthLevel,
  };
}

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import type { Project, ProjectHealthSnapshot, ProjectHealthIssue } from '../types';
import { useNodeStore } from './node';
import { resolveAppDefaultNodePath, resolveProjectNodePath } from '../utils/nodeRuntime';

export const useProjectHealthStore = defineStore('projectHealth', () => {
  /** 项目健康快照缓存 */
  const snapshots = ref<Record<string, ProjectHealthSnapshot>>({});
  /** 正在刷新的项目 id 集合 */
  const refreshing = ref<Set<string>>(new Set());

  /** 并发限流 semaphore */
  const CONCURRENCY = 4;
  let running = 0;
  const queue: (() => Promise<void>)[] = [];

  function enqueue(task: () => Promise<void>) {
    return new Promise<void>((resolve) => {
      const wrapped = async () => {
        try {
          await task();
        } finally {
          running--;
          // 取队列中下一个任务执行
          if (queue.length > 0 && running < CONCURRENCY) {
            running++;
            const next = queue.shift()!;
            next();
          }
          resolve();
        }
      };
      if (running < CONCURRENCY) {
        running++;
        wrapped();
      } else {
        queue.push(wrapped);
      }
    });
  }

  /** 刷新单个项目的健康状态 */
  async function refreshOne(project: Project): Promise<void> {
    const id = project.id;
    // 避免重复刷新
    if (refreshing.value.has(id)) return;
    refreshing.value = new Set([...refreshing.value, id]);

    const issues: ProjectHealthIssue[] = [];
    let pathExists = true;
    let hasGit = false;
    let gitDirty = false;
    let pmResolved = true;

    try {
      // 1) 路径探测：调用 readDir 试探
      try {
        await api.readDir(project.path);
        pathExists = true;
      } catch (_) {
        pathExists = false;
        issues.push({
          code: 'path_missing',
          level: 'error',
          message: '项目路径不存在',
        });
      }

      // 路径不存在时后续项无意义
      if (pathExists) {
        // 2) Git 检测
        try {
          hasGit = await api.gitCheck(project.path);
          if (!hasGit) {
            issues.push({
              code: 'not_git',
              level: 'warn',
              message: '未初始化 Git',
            });
          }
        } catch (_) {
          hasGit = false;
          issues.push({
            code: 'not_git',
            level: 'warn',
            message: 'Git 检测失败',
          });
        }

        // 3) Git dirty 检测
        if (hasGit) {
          try {
            const summary = await api.gitSummary(project.path);
            gitDirty = summary.ahead > 0 || summary.behind > 0;
            // 检查是否有改动文件（通过 gitStatus 详细判断更准确，但 summary 轻量）
            // 第一版用 gitStatus 做精确判断
            const status = await api.gitStatus(project.path);
            const hasChanges =
              status.staged.length > 0 ||
              status.unstaged.length > 0 ||
              status.untracked.length > 0 ||
              status.conflicted.length > 0;
            if (hasChanges) {
              gitDirty = true;
              issues.push({
                code: 'git_dirty',
                level: 'warn',
                message: 'Git 有未提交的改动',
              });
            }
          } catch (_) {
            // 检测失败不阻塞
          }
        }

        // 4) 包管理器可用性
        if (project.type === 'node' && project.packageManager) {
          try {
            const nodeStore = useNodeStore();
            if (!nodeStore.versions.length) {
              await nodeStore.loadRuntimes();
            }
            const nodePath = resolveProjectNodePath(project, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
            const defaultNodePath = resolveAppDefaultNodePath(nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);

            const source = project.packageManagerSource || 'project';
            const pmResult = await api.resolvePackageManager(
              nodePath,
              defaultNodePath,
              project.packageManager,
              source
            );
            pmResolved = pmResult.available;
            if (!pmResult.available) {
              issues.push({
                code: 'pm_unresolved',
                level: 'warn',
                message: `包管理器 ${project.packageManager} 不可用`,
              });
            }
          } catch (_) {
            pmResolved = false;
            issues.push({
              code: 'pm_unresolved',
              level: 'warn',
              message: '包管理器解析失败',
            });
          }
        }
      }

      snapshots.value[id] = {
        projectId: id,
        running: false, // 运行状态由 project store 提供
        hasGit,
        gitDirty,
        pmResolved,
        pathExists,
        issues,
        updatedAt: Date.now(),
      };
    } finally {
      const next = new Set(refreshing.value);
      next.delete(id);
      refreshing.value = next;
    }
  }

  /** 批量刷新多个项目（并发限流 + 失败容错） */
  async function refreshMany(projects: Project[]): Promise<void> {
    await Promise.allSettled(
      projects.map((p) => enqueue(() => refreshOne(p)))
    );
  }

  /** 获取单个项目的健康快照 */
  function get(id: string): ProjectHealthSnapshot | undefined {
    return snapshots.value[id];
  }

  /** 批量获取快照 */
  function getMany(ids: string[]): ProjectHealthSnapshot[] {
    return ids
      .map((id) => snapshots.value[id])
      .filter((s): s is ProjectHealthSnapshot => !!s);
  }

  /** 清除指定项目的快照 */
  function invalidate(id: string) {
    delete snapshots.value[id];
  }

  /** 清除全部快照 */
  function invalidateAll() {
    snapshots.value = {};
  }

  return {
    snapshots,
    refreshing,
    refreshOne,
    refreshMany,
    get,
    getMany,
    invalidate,
    invalidateAll,
  };
});

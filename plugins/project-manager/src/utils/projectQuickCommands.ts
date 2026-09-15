import type { Project, ProjectQuickCommand } from '../types';
import { getRunnableProjectScripts } from './projectCommands';

/***********************快捷命令常量*********************/
export const MAX_PROJECT_QUICK_COMMANDS = 3;

type RunnableProjectFields = Pick<Project, 'type' | 'scripts' | 'visibleScripts' | 'customCommands'>;

function commandKey(command: ProjectQuickCommand): string {
  return `${command.type}:${command.id}`;
}

/** 返回当前项目所有可运行命令的稳定标识，不把显示名称当作 id。 */
export function getAvailableProjectQuickCommands(project: RunnableProjectFields): ProjectQuickCommand[] {
  return [
    ...getRunnableProjectScripts(project).map(id => ({ type: 'script' as const, id })),
    ...(project.customCommands ?? [])
      .filter(command => command.name && command.command)
      .map(command => ({ type: 'custom' as const, id: command.id })),
  ];
}

/** 旧项目没有 quickCommands 时，默认挑选常用脚本，再补充其他命令。 */
export function getDefaultProjectQuickCommands(
  project: RunnableProjectFields,
  limit = MAX_PROJECT_QUICK_COMMANDS,
): ProjectQuickCommand[] {
  const available = getAvailableProjectQuickCommands(project);
  const preferredScripts = new Set(['dev', 'start', 'serve']);
  const preferred = available.filter(command => command.type === 'script' && preferredScripts.has(command.id));
  const rest = available.filter(command => !preferred.some(item => commandKey(item) === commandKey(command)));
  return [...preferred, ...rest].slice(0, Math.min(MAX_PROJECT_QUICK_COMMANDS, Math.max(0, limit)));
}

/** 过滤删除后的命令并去重，保证持久化脏数据不会让一级页报错。 */
export function resolveProjectQuickCommands(
  project: RunnableProjectFields & Pick<Project, 'quickCommands'>,
  limit = MAX_PROJECT_QUICK_COMMANDS,
): ProjectQuickCommand[] {
  const available = new Set(getAvailableProjectQuickCommands(project).map(commandKey));
  const configured = project.quickCommands ?? getDefaultProjectQuickCommands(project, limit);
  const seen = new Set<string>();
  const resolved: ProjectQuickCommand[] = [];

  for (const command of configured) {
    const key = commandKey(command);
    if (!available.has(key) || seen.has(key)) continue;
    seen.add(key);
    resolved.push({ type: command.type, id: command.id });
    if (resolved.length >= Math.min(MAX_PROJECT_QUICK_COMMANDS, Math.max(0, limit))) break;
  }

  return resolved;
}

/** 编辑保存时只保留仍存在的命令，并限制最多 3 项。 */
export function normalizeProjectQuickCommands(
  project: RunnableProjectFields,
  commands: ProjectQuickCommand[],
): ProjectQuickCommand[] {
  return resolveProjectQuickCommands({ ...project, quickCommands: commands });
}

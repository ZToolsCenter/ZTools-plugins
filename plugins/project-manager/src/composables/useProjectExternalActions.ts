import { toValue, type MaybeRefOrGetter } from 'vue';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { Project } from '../types';
import { api } from '../api';
import { useNodeStore } from '../stores/node';
import { useSettingsStore } from '../stores/settings';
import { resolveNodePathFromVersion, resolveProjectNodePath, resolveProjectRuntime, isExplicitNodeVersion, shouldInjectTerminalNode } from '../utils/nodeRuntime';
import { normalizeNodeVersion, projectNodeVersionHint } from '../utils/nvm';
import { resolveTerminalCommand } from '../utils/terminalConfig';

/***********************项目外部打开操作*********************/
/**
 * 列表行和快速管理弹窗共用的外部工具打开能力。
 * 这里保留现有 Node 版本解析与终端参数注入流程，不引入新的运行时行为。
 */
export function useProjectExternalActions(projectSource: MaybeRefOrGetter<Project | null | undefined>) {
  const { t } = useI18n();
  const nodeStore = useNodeStore();
  const settingsStore = useSettingsStore();

  function getProject(): Project | null {
    return toValue(projectSource) ?? null;
  }

  /***********************编辑器路径解析*********************/
  function resolveEditorPath(project: Project): string {
    let editorPath = settingsStore.settings.editorPath;
    if (project.editorId && settingsStore.settings.editors?.length) {
      const selectedEditor = settingsStore.settings.editors.find(editor => editor.id === project.editorId);
      if (selectedEditor) editorPath = selectedEditor.path;
    } else if (settingsStore.settings.editors?.length) {
      const defaultEditor = settingsStore.settings.defaultEditorId
        ? settingsStore.settings.editors.find(editor => editor.id === settingsStore.settings.defaultEditorId)
        : undefined;
      editorPath = (defaultEditor || settingsStore.settings.editors[0]).path;
    }
    return editorPath;
  }

  async function openEditor(): Promise<void> {
    const project = getProject();
    if (!project) return;
    try {
      await api.openInEditor(project.path, resolveEditorPath(project));
    } catch (error) {
      console.error(error);
      ElMessage.error(`${t('common.error')}: ${error}`);
    }
  }

  /***********************终端参数解析*********************/
  async function resolveTerminalOptions(project: Project): Promise<{
    terminalCommand: string;
    nodePath: string;
    packageManager: string;
  }> {
    if (!shouldInjectTerminalNode(project)) {
      return {
        terminalCommand: resolveTerminalCommand(
          settingsStore.settings.defaultTerminal,
          settingsStore.settings.customTerminals,
        ),
        nodePath: '',
        packageManager: '',
      };
    }

    await nodeStore.loadRuntimes();

    const initialResolution = resolveProjectRuntime(project, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
    let nodePath = initialResolution.runtime?.path || '';

    if (initialResolution.unavailable && project.nodeRuntimeId) {
      throw new Error('项目绑定的 Node Runtime 不可用，请重新选择 Runtime 后再打开终端。');
    }

    if (!nodePath && isExplicitNodeVersion(project.nodeVersion) && nodeStore.managedSupported) {
      const version = normalizeNodeVersion(project.nodeVersion!)!;
      try {
        ElMessage.info(t('project.autoInstallStart', { version }));
        await nodeStore.installManagedNode(version);
        ElMessage.success(t('project.autoInstallSuccess', { version }));
        nodePath = resolveProjectNodePath(project, nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
      } catch (installError) {
        ElMessage.error(`${t('project.autoInstallFailed', { version })}: ${String(installError)}`);
        console.error('Failed to auto-install node version for terminal', installError);
      }
    }

    if (!nodePath) {
      try {
        const info = await api.scanProject(project.path);
        nodePath = resolveNodePathFromVersion(projectNodeVersionHint(info), nodeStore.versions, nodeStore.appDefault, nodeStore.systemNodeRuntime);
        if (nodePath) {
          const runtime = nodeStore.versions.find(item => item.path === nodePath);
          if (runtime) {
            project.nodeRuntimeId = runtime.runtimeId;
            project.nodeVersion = runtime.version;
          }
        }
      } catch (scanError) {
        console.warn('Failed to scan project for terminal node version', scanError);
      }
    }

    return {
      terminalCommand: resolveTerminalCommand(
        settingsStore.settings.defaultTerminal,
        settingsStore.settings.customTerminals,
      ),
      nodePath,
      packageManager: project.packageManager || 'npm',
    };
  }

  async function openTerminal(): Promise<void> {
    const project = getProject();
    if (!project) return;
    try {
      const options = await resolveTerminalOptions(project);
      await api.openInTerminal(project.path, options.terminalCommand, options.nodePath, options.packageManager);
    } catch (error) {
      console.error(error);
      ElMessage.error(`${t('common.error')}: ${error}`);
    }
  }

  /***********************文件夹打开*********************/
  async function openFolder(): Promise<void> {
    const project = getProject();
    if (!project) return;
    try {
      await api.openFolder(project.path);
    } catch (error) {
      console.error(error);
      ElMessage.error(`${t('common.error')}: ${error}`);
    }
  }

  return {
    resolveEditorPath,
    resolveTerminalOptions,
    openEditor,
    openTerminal,
    openFolder,
  };
}

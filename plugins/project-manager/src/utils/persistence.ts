import { api } from '../api';
import { useProjectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import { useNodeStore } from '../stores/node';

const FILE_NAME = 'data.json';

export async function saveData() {
  try {
    const projectStore = useProjectStore();
    const settingsStore = useSettingsStore();
    const nodeStore = useNodeStore();

    const data = {
      projects: projectStore.projects,
      settings: settingsStore.settings,
      customNodes: nodeStore.versions.filter(v => v.source === 'custom')
    };
    
    await api.writeConfigFile(FILE_NAME, JSON.stringify(data, null, 2));
    console.log('Data saved to', FILE_NAME);
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

export async function loadData() {
  try {
    const content = await api.readConfigFile(FILE_NAME);
    if (!content) return;

    const data = JSON.parse(content);

    if (data.projects) {
      const projectStore = useProjectStore();
      // Migrate old project data: ensure new optional fields have defaults
      projectStore.projects = data.projects.map((p: any) => ({
        ...p,
        type: p.type || 'node',
        scripts: p.scripts || [],
        visibleScripts: p.visibleScripts || undefined,
        customCommands: p.customCommands || [],
        projectFiles: p.projectFiles || [],
        memo: p.memo || '',
        pinned: p.pinned ?? false,
        pinOrder: p.pinOrder ?? undefined,
      }));
    }
    if (data.settings) {
      const settingsStore = useSettingsStore();
      settingsStore.settings = { ...settingsStore.settings, ...data.settings };
    }
    if (data.customNodes) {
      const nodeStore = useNodeStore();
      // Merge custom nodes
      const existing = new Set(nodeStore.versions.map(v => v.path));
      data.customNodes.forEach((n: any) => {
          if (!existing.has(n.path)) {
              nodeStore.versions.push(n);
          }
      });
    }
    console.log('Data loaded');
  } catch (e) {
    console.error('Failed to load data:', e);
  }
}

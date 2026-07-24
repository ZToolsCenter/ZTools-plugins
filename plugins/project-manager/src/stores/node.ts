import { defineStore } from 'pinia';
import { ref, onMounted } from 'vue';
import { api } from '../api';
import type { NodeVersion } from '../types';
import { sortNodeVersions, upsertSystemNodeVersion } from '../utils/nodeDefaultState';

const SYSTEM_NODE_PLACEHOLDER = 'System Default';

export const useNodeStore = defineStore('node', () => {
  const versions = ref<NodeVersion[]>([]);
  const loading = ref(false);

  // Load custom nodes from local storage
  const loadCustomNodes = () => {
    const stored = localStorage.getItem('custom_nodes');
    if (stored) {
      try {
        const custom: NodeVersion[] = JSON.parse(stored);
        versions.value.push(...custom);
      } catch (e) {
        console.error('Failed to load custom nodes', e);
      }
    }
  };

  const loadNvmNodes = async () => {
    try {
      loading.value = true;
      const nvmNodes = await api.getNvmList();
      // Filter out existing nvm nodes to avoid duplicates if re-fetching
      versions.value = versions.value.filter(v => v.source !== 'nvm');
      versions.value.push(...nvmNodes);

      // Sort: System -> NVM -> Custom, then by version desc
      sortVersions();
    } catch (e) {
      console.error('Failed to load nvm nodes', e);
    } finally {
      loading.value = false;
    }
  };

  const sortVersions = () => {
    versions.value = sortNodeVersions(versions.value);
  };

  const addCustomNode = (node: NodeVersion) => {
    versions.value.push(node);
    saveCustomNodes();
    sortVersions();
  };

  const removeNode = (path: string) => {
    versions.value = versions.value.filter(v => v.path !== path);
    saveCustomNodes();
  };

  /***********************默认 Node 维护*********************/

  const syncSystemNode = async (options: {
    preferredVersion?: string;
    preferredPath?: string;
    persistPath?: boolean;
  } = {}) => {
    const persistPath = options.persistPath ?? true;
    let resolvedPath = options.preferredPath || localStorage.getItem('system_node_path') || '';

    if (!resolvedPath || resolvedPath === SYSTEM_NODE_PLACEHOLDER || options.preferredVersion) {
      try {
        const detectedPath = await api.getSystemNodePath();
        if (detectedPath) {
          resolvedPath = detectedPath;
        }
      } catch (error) {
        console.error('Failed to detect system node path', error);
      }
    }

    if (!resolvedPath) {
      resolvedPath = SYSTEM_NODE_PLACEHOLDER;
    }

    let resolvedVersion = options.preferredVersion || '默认';
    if (resolvedPath !== SYSTEM_NODE_PLACEHOLDER) {
      try {
        const detectedVersion = await api.getNodeVersion(resolvedPath);
        if (detectedVersion) {
          resolvedVersion = detectedVersion;
        }
      } catch (error) {
        console.error('Failed to detect system node version', error);
      }
    }

    versions.value = upsertSystemNodeVersion(versions.value, {
      version: resolvedVersion,
      path: resolvedPath,
    });

    if (!persistPath) {
      return;
    }

    if (resolvedPath === SYSTEM_NODE_PLACEHOLDER) {
      localStorage.removeItem('system_node_path');
      return;
    }

    localStorage.setItem('system_node_path', resolvedPath);
  };

  const updateSystemNode = async (newPath: string, preferredVersion?: string) => {
    await syncSystemNode({
      preferredPath: newPath,
      preferredVersion,
    });
  };

  const setDefaultNode = async (node: NodeVersion) => {
    if (node.source === 'nvm') {
      await api.useNode(node.version);
      await syncSystemNode({ preferredVersion: node.version });
      await loadNvmNodes();
      return;
    }

    await updateSystemNode(node.path, node.version);
  };

  const saveCustomNodes = () => {
    const custom = versions.value.filter(v => v.source === 'custom');
    localStorage.setItem('custom_nodes', JSON.stringify(custom));
  };

  const installNode = async (version: string) => {
    try {
      loading.value = true;
      await api.installNode(version);
      // After install attempt, reload list to see if it actually appeared
      await loadNvmNodes();
      
      // Check if version exists now
      // Normalize version string to ensure consistent comparison (e.g. "v18.0.0" vs "18.0.0")
      const normalize = (v: string) => v.toLowerCase().startsWith('v') ? v.toLowerCase() : 'v' + v.toLowerCase();
      const targetVersion = normalize(version);
      
      const exists = versions.value.some(v => 
        v.source === 'nvm' && normalize(v.version) === targetVersion
      );

      if (!exists) {
        throw new Error('Node version not found after installation. Please check the console window for errors.');
      }
      return true;
    } catch (e: any) {
      console.error('Failed to install node', e);
      // If we threw the specific error above, rethrow it
      if (e.message && e.message.includes('Node version not found')) {
        throw e;
      }
      // Otherwise, since we are using "& pause", the exit code might be 0 even if it failed.
      // But if we caught an error here (e.g. from invoke), we should show it.
      throw e;
    } finally {
      loading.value = false;
    }
  };

  const uninstallNode = async (version: string) => {
    try {
      loading.value = true;
      await api.uninstallNode(version);

      // Verification logic for uninstall
      await loadNvmNodes();
      
      const normalize = (v: string) => v.toLowerCase().startsWith('v') ? v.toLowerCase() : 'v' + v.toLowerCase();
      const targetVersion = normalize(version);
      
      const exists = versions.value.some(v => v.source === 'nvm' && normalize(v.version) === targetVersion);

      if (exists) {
        throw new Error('Node version still exists after uninstallation. Please check the console window for errors.');
      }
      return true;
    } catch (e) {
      console.error('Failed to uninstall node', e);
      throw e;
    } finally {
      loading.value = false;
    }
  };

  onMounted(async () => {
    await syncSystemNode();
    loadCustomNodes();
    loadNvmNodes();
  });

  return {
    versions,
    loading,
    loadNvmNodes,
    addCustomNode,
    removeNode,
    updateSystemNode,
    syncSystemNode,
    setDefaultNode,
    installNode,
    uninstallNode
  };
});

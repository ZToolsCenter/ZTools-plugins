export interface NodeVersion {
  version: string;
  isCurrent: boolean;
}

export interface RegistryMap {
  [key: string]: string;
}

export interface ZToolsAction {
  code: string;
  type: string;
  payload: string;
}

declare global {
  interface Window {
    nodeManager: {
      getInstalledVersions: () => Promise<NodeVersion[]>;
      getAvailableVersions: () => Promise<string[]>;
      getFullVersionList: () => Promise<any[]>;
      useVersion: (version: string) => Promise<string>;
      installVersion: (version: string, onProgress: (percent: number) => void) => Promise<void>;
      uninstallVersion: (version: string) => Promise<string>;
      openVersionDir: (version: string) => Promise<void>;
      getCurrentRegistry: () => Promise<string>;
      setRegistry: (name: string) => Promise<string>;
      getRegistryMap: () => RegistryMap;
      getBuiltInRegistryKeys: () => string[];
      addRegistry: (name: string, url: string) => boolean;
      removeRegistry: (name: string) => boolean;
      projects: {
        load: () => any[];
        save: (list: any[]) => void;
        runScript: (projId: string, path: string, script: string, nodeVersion: string, onData?: (data: string) => void) => Promise<void>;
        stopScript: (projId: string, script: string) => boolean;
        startStaticServer: (path: string, port?: number) => Promise<number>;
        getPackageJson: (path: string) => any;
        selectFolder: () => Promise<string | null>;
      };
      notify: (title: string, body: string) => void;
      openExternal: (url: string) => void;
      getNvmConfig: () => Promise<{ root: string, nodeMirror: string, npmMirror: string }>;
      setNvmMirror: (type: 'official' | 'mirror') => Promise<string>;
      useMirror: () => Promise<string>;
    };
    ztools: {
      onPluginEnter: (callback: (action: ZToolsAction) => void) => void;
      hideMainWindow: () => void;
      showNotification: (body: string, title?: string) => void;
      showOpenDialog?: (options: any) => Promise<string[] | null>;
    };
  }
}

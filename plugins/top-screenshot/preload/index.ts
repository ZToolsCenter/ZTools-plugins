const { ipcRenderer } = require('electron') as {
  ipcRenderer: {
    on(channel: string, callback: (event: unknown, payload: unknown) => void): void;
  };
};

type ParentMessageCallback = (...args: unknown[]) => void;

const listeners = new Map<string, Set<ParentMessageCallback>>();

ipcRenderer.on('__ipc_sendto_relay__', (_event, payload) => {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const { channel, args } = payload as { channel?: unknown; args?: unknown };
  if (typeof channel !== 'string' || !Array.isArray(args)) {
    return;
  }

  listeners.get(channel)?.forEach((callback) => callback(...args));
});

const api = window.ztools;
if (api) {
  api.onParentMessage = (channel, callback) => {
    const channelListeners = listeners.get(channel) ?? new Set<ParentMessageCallback>();
    channelListeners.add(callback);
    listeners.set(channel, channelListeners);

    return () => {
      channelListeners.delete(callback);
      if (channelListeners.size === 0) {
        listeners.delete(channel);
      }
    };
  };
}

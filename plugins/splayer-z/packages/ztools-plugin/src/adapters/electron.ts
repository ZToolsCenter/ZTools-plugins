/**
 * Electron API 适配层 - 模拟必要的 Electron API
 */
export const setupElectronAdapter = () => {
  // 模拟 window.electron (如果不存在)
  if (typeof (window as any).electron === 'undefined') {
    (window as any).electron = {
      ipcRenderer: {
        send: (channel: string, ...args: any[]) => {
          console.log(`[IPC Mock] send: ${channel}`, args);
        },
        invoke: async (channel: string, ...args: any[]) => {
          console.log(`[IPC Mock] invoke: ${channel}`, args);
          return null;
        },
        on: (channel: string, listener: Function) => {
          console.log(`[IPC Mock] on: ${channel}`);
        },
        removeListener: (channel: string, listener: Function) => {
          console.log(`[IPC Mock] removeListener: ${channel}`);
        },
      },
    };
  }
  
  console.log('✅ Electron adapter initialized');
};


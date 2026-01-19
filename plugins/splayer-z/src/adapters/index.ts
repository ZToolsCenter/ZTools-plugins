import { setupElectronAdapter } from './electron';
import { setupStorageAdapter } from './storage';

export const setupAdapters = () => {
  // 设置环境标识
  (window as any).__ZTOOLS__ = true;
  (window as any).__ELECTRON__ = false;
  
  // 初始化适配层
  setupElectronAdapter();
  setupStorageAdapter();
  
  console.log('✅ All adapters initialized');
};


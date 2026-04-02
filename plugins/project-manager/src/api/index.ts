import { TauriAdapter } from './adapters/tauri';
import { UToolsAdapter } from './adapters/utools';
import type { PlatformAPI } from './types';

let api: PlatformAPI;

// Simple detection logic
// We can use an environment variable injected by Vite to force a specific adapter
const target = import.meta.env.VITE_TARGET;

if (target === 'utools' || target === 'ztools') {
    api = new UToolsAdapter();
    console.log('Using uTools/ZTools Adapter');
} else {
    // Default to Tauri
    api = new TauriAdapter();
    console.log('Using Tauri Adapter');
}

export { api };
export * from './types';

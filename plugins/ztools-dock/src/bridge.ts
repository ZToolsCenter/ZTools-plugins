import { ref, shallowRef } from 'vue';
import type { State } from './types';
export const state = shallowRef<State>();
export const notice = ref<{ text: string; error: boolean }>();
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(text: string, error = false) { clearTimeout(toastTimer); notice.value = { text, error }; toastTimer = setTimeout(() => notice.value = undefined, error ? 6500 : 2800); }
export async function command(op: string, payload?: unknown, success?: string) {
  try { const result = await window.dock.call(op, payload); if (success && result !== null) toast(success); return result; }
  catch (error) { toast(error instanceof Error ? error.message : String(error), true); return undefined; }
}
export async function initialize() {
  if (!window.dock) throw new Error('请在 ZTools 中安装并打开程序坞');
  await window.dock.ready;
  window.dock.subscribe(value => { state.value = value; });
  state.value = await window.dock.call('snapshot');
}

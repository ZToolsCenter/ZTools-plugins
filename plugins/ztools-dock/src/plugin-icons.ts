type PluginIconRef = { id: string; iconVersion?: string };
const cache = new Map<string, Promise<string | undefined>>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
function drain() { while (active < 3 && queue.length) { active++; queue.shift()!().finally(() => { active--; drain(); }); } }
export function pluginIcon(plugin: PluginIconRef): Promise<string | undefined> {
  const key = `${plugin.id}:${plugin.iconVersion || ''}`;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  const result = new Promise<string | undefined>(resolve => {
    queue.push(async () => {
      try {
        const source = await window.dock.call('plugin-icon', plugin.id);
        if (!source) return resolve(undefined);
        const image = new Image(); image.src = source; await image.decode();
        const scale = Math.min(1, 64 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch { resolve(undefined); }
    });
  });
  cache.set(key, result);
  while (cache.size > 128) cache.delete(cache.keys().next().value!);
  drain(); return result;
}

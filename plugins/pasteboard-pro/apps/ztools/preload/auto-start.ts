const AUTO_START_STORAGE_KEY = "auto-start-plugin";
const PLUGIN_NAME = "pasteboard-pro";

export type HostSettingsIpc = Readonly<{
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}>;

function pluginNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

/**
 * Registers Paste剪切板 in ZTools' host-level auto-start list.
 *
 * ZTools keeps this setting outside the plugin database, so the preload bridge
 * uses the same host IPC channels as the built-in "跟随主程序同时启动运行"
 * menu option. The registration is idempotent and takes effect on the next
 * ZTools launch.
 */
export async function ensureZToolsAutoStart(
  ipc: HostSettingsIpc,
  pluginName = PLUGIN_NAME,
): Promise<boolean> {
  const current = pluginNames(
    await ipc.invoke("ztools:db-get", AUTO_START_STORAGE_KEY),
  );
  if (current.includes(pluginName)) return false;

  await ipc.invoke("ztools:db-put", AUTO_START_STORAGE_KEY, [
    ...current,
    pluginName,
  ]);
  return true;
}

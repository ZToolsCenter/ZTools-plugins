// 「密钥」的存取规则，大古截图与大古快传共用（快传目录内是同步副本）：
// - 本机副本始终写在插件自己的 localStorage 里，不随 ZTools 同步；
// - 打开「同步密钥」后，另外往 dbStorage 写一份同步副本（dbStorage 的内容随 ZTools 账号备份同步）；
// - 关闭「同步密钥」时删除同步副本，保留本机副本；开关打开时读取以同步副本为准。

// keys 是 { local, synced } 两个存储键；fallback 在两处都没有数据时返回。
export async function loadSecrets({ kv, keys, sync, fallback = null }) {
  const local = kv.readLocal(keys.local);
  if (!sync || !kv.hasDbStorage()) return local ?? fallback;
  const synced = await kv.readDb(keys.synced);
  return synced ?? local ?? fallback;
}

// 返回本机副本是否写入成功。
export async function saveSecrets({ kv, keys, secrets, sync }) {
  const saved = kv.writeLocal(keys.local, secrets);
  if (sync && kv.hasDbStorage()) await kv.writeDb(keys.synced, secrets);
  else if (kv.hasDbStorage()) await kv.removeDb(keys.synced);
  return saved;
}

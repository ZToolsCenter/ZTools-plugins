function normalizeName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/** 按历史 plugins.json 的 name 匹配，所有请求校验成功后才生成新清单。 */
export function removePluginsFromManifest(previousPlugins, requests) {
  if (!Array.isArray(previousPlugins)) {
    throw new Error('下架操作需要最新 Release 的 plugins.json，已停止发布');
  }
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('下架操作必须指定至少一个插件');
  }
  if (previousPlugins.some(plugin => !plugin || !normalizeName(plugin.name))) {
    throw new Error('历史 plugins.json 包含无效插件条目，已停止发布');
  }

  const removed = new Set();
  for (const request of requests) {
    const key = normalizeName(request);
    if (!key) throw new Error('无效的插件名称');
    const matches = previousPlugins.filter(plugin => normalizeName(plugin.name) === key);

    if (matches.length === 0) {
      throw new Error(`最新 Release 中找不到待下架插件: ${request}，请填写 plugins.json 中的 name，已停止发布`);
    }
    if (matches.length !== 1) {
      throw new Error(`待下架插件 ${request} 匹配有歧义: ${matches.map(plugin => plugin.name).join(', ')}，已停止发布`);
    }
    removed.add(matches[0]);
  }

  // 直接保留历史条目对象，维持其他插件的元数据、顺序和下载地址。
  return {
    plugins: previousPlugins.filter(plugin => !removed.has(plugin)),
    removedPlugins: previousPlugins.filter(plugin => removed.has(plugin)),
  };
}

export function formatRemovalNotes(removedPlugins) {
  const inline = value => String(value).replace(/[\r\n]+/g, ' ').replace(/[\\`*_\[\]<>]/g, '\\$&');
  return [
    '## 下架的插件',
    '',
    ...removedPlugins.map(plugin => `- ${inline(plugin.title || plugin.pluginName || plugin.name)}（${inline(plugin.name)}）`),
    '',
    '以上插件已从最新插件清单中移除，源码和历史 Release 保留。',
    '',
  ].join('\n');
}

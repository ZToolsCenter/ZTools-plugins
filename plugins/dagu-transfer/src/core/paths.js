// 路径的小工具：本地路径同时兼容 / 与 \ 两种分隔符。

// 拆出所在目录与文件名；没有目录时用当前目录。
export function splitLocalPath(filePath) {
  const value = String(filePath || '');
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return { dir: index > 0 ? value.slice(0, index) : '.', name: value.slice(index + 1) };
}

// 仅用于展示：沿用目录已有的分隔符风格。
export function joinLocalPath(dir, name) {
  const base = String(dir || '');
  const separator = /\\/.test(base) && !/\//.test(base) ? '\\' : '/';
  return base.replace(/[\\/]+$/, '') + (base ? separator : '') + name;
}

export function remoteBaseName(remotePath) {
  const value = String(remotePath || '');
  return value.slice(value.lastIndexOf('/') + 1);
}

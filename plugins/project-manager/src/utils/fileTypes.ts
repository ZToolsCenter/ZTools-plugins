export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);

export const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'geojson', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf',
  'env', 'sh', 'bat', 'cmd', 'ps1', 'py', 'rs', 'go', 'java', 'kt', 'c', 'cc', 'cpp', 'h',
  'hpp', 'cs', 'swift', 'rb', 'php', 'log', 'csv', 'sql', 'gitignore', 'editorconfig',
  'npmrc', 'nvmrc', 'prettierrc', 'eslintrc',
]);

const TEXT_BASENAMES = new Set([
  'license', 'licence', 'copying', 'copyright', 'notice', 'authors', 'contributors',
  'readme', 'changelog', 'changes', 'history', 'makefile', 'dockerfile', 'jenkinsfile',
  'procfile', 'gemfile', 'rakefile', 'vagrantfile', 'brewfile', 'justfile', 'taskfile',
  '.gitignore', '.editorconfig', '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc',
  '.gitattributes', '.gitmodules', '.dockerignore', '.prettierignore', '.eslintignore',
  '.stylelintignore',
]);

const TEXT_BASENAME_VARIANTS = [
  /^(?:license|licence)-(?:mit|apache(?:-2\.0)?|bsd(?:-[23]-clause)?|gpl(?:-[23](?:\.0)?)?|lgpl(?:-[23](?:\.0)?)?|mpl(?:-2\.0)?|isc|unlicense)$/i,
  /^copying\.lesser$/i,
  /^notice-third-party$/i,
];

function isTextBasename(name: string): boolean {
  const lowerName = name.toLowerCase();
  return TEXT_BASENAMES.has(lowerName) || TEXT_BASENAME_VARIANTS.some(pattern => pattern.test(name));
}

export type FileKind = 'image' | 'text' | 'binary';

export function fileExtension(pathOrName: string): string {
  const name = pathOrName.replace(/\\/g, '/').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isImageFile(pathOrName: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(pathOrName));
}

export function isTextFile(pathOrName: string): boolean {
  const name = pathOrName.replace(/\\/g, '/').split('/').pop() || '';
  if (/^\.env(?:\.|$)/i.test(name)) return true;
  if (isTextBasename(name)) return true;
  return TEXT_EXTENSIONS.has(fileExtension(name));
}

export function fileKind(pathOrName: string): FileKind {
  if (isImageFile(pathOrName)) return 'image';
  if (isTextFile(pathOrName)) return 'text';
  return 'binary';
}

export function mimeForFile(pathOrName: string): string {
  switch (fileExtension(pathOrName)) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    case 'ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

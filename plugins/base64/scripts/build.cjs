const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'base64');
const release = path.join(root, 'release');
const files = ['plugin.json', 'index.html', 'styles.css', 'app.js', 'codec.js', 'preload.js', 'logo.png', 'README.md'];
const config = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));

// 文件名来自插件配置，同时限制为单个文件名，避免意外写到发布目录以外。
if (!/^[a-zA-Z0-9_-]+$/.test(config.name) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(config.version)) {
  throw new Error('plugin.json 的 name 或 version 格式不正确。');
}
const basename = `${config.name}-${config.version}`;
const zpxPath = path.join(release, `${basename}.zpx`);
const zipPath = path.join(release, `${basename}.zip`);

function build() {
  for (const file of files) {
    if (!fs.statSync(path.join(root, file)).isFile()) throw new Error(`缺少插件文件：${file}`);
  }
  // 只清理本项目固定的构建目录，避免将上次遗留文件打入安装包。
  const relative = path.relative(root, path.resolve(output));
  if (relative !== path.join('dist', 'base64')) throw new Error('构建目录超出预期范围。');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
  console.log(`插件已输出：${output}`);
}

if (require.main === module) build();
module.exports = { root, output, release, files, config, zpxPath, zipPath, build };

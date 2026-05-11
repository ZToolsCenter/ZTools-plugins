const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

// 获取 package.json 中的信息以命名
const pkg = require('./package.json');
const zipName = `${pkg.name}-v${pkg.version}.ztools.zip`;

const zip = new AdmZip();

// 定义需要包含的文件和目录
const filesToInclude = [
    'index.html',
    'index.js',
    'index.css',
    'logo.svg',
    'preload.js',
    'plugin.json',
    'package.json',
    'assets',
    'README.md'
];

console.log('开始打包...');

filesToInclude.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            zip.addLocalFolder(filePath, file);
            console.log(`添加目录: ${file}`);
        } else {
            zip.addLocalFile(filePath);
            console.log(`添加文件: ${file}`);
        }
    } else {
        console.warn(`跳过不存在的文件/目录: ${file}`);
    }
});

zip.writeZip(path.join(__dirname, zipName));

console.log('--------------------------');
console.log(`打包完成！生成文件: ${zipName}`);
console.log('--------------------------');

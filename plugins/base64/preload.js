// ZTools preload 保持 CommonJS 源码，不进行压缩或混淆。
const fs = require('node:fs/promises');
const path = require('node:path');
const codec = require('./codec.js');

window.base64Native = {
  async openImage() {
    // 宿主对话框会抑制 ZTools 的失焦隐藏；HTML file input 没有这层保护。
    const filePaths = await window.ztools.showOpenDialog({
      title: '选择需要编码的图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: Object.values(codec.extensions).concat('jpeg') }]
    });
    if (!filePaths?.length) return { canceled: true };
    const filePath = filePaths[0];
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('请选择图片文件。');
    codec.checkSize(stat.size);
    const bytes = await fs.readFile(filePath);
    codec.checkSize(bytes.length);
    if (!codec.imageMime(bytes)) throw new Error('无法识别此图片，请选择支持的图片格式。');
    return { canceled: false, name: path.basename(filePath), bytes: new Uint8Array(bytes) };
  },
  async saveImage(base64) {
    const result = codec.decode(base64);
    if (result.kind !== 'image') throw new Error('只有识别为图片的内容才能保存为图片。');
    const filePath = await window.ztools.showSaveDialog({
      title: '保存解码图片',
      defaultPath: `base64-image.${result.extension}`,
      filters: [{ name: `${result.extension.toUpperCase()} 图片`, extensions: [result.extension] }],
      properties: ['showOverwriteConfirmation']
    });
    if (!filePath) return { canceled: true };
    await fs.writeFile(filePath, result.bytes);
    return { canceled: false, filePath };
  }
};

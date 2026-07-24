const { writeFile } = require('fs/promises');
const { Buffer } = require('buffer');
const path = require('path');

const platform = window.ztools;
window.platform = platform;

window.services = {
  async saveColorCard(bf) {
    const defaultPath = path.resolve(
      platform.getPath("downloads"),
      "color-card-" + Date.now()
    );
    const buffer = Buffer.from(bf);
    const savePath = platform.showSaveDialog({
      title: "保存色卡",
      defaultPath,
      buttonLabel: "保存",
      filters: [
        {
          extensions: ["png"],
          name: "色卡"
        }
      ]
    });
    if (!savePath) {
      return;
    }
    await writeFile(savePath, buffer);
    platform.shellShowItemInFolder(savePath);
  }
};

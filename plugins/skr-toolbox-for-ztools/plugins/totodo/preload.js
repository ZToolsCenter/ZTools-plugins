const fs = require('fs');
const path = require('path');

window.utools = {
  ...window.ztools
}

window.preload = {
  // Save file content to specific path
  saveFile: (filePath, content) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  // Join paths (helper)
  pathJoin: (...args) => path.join(...args)
}
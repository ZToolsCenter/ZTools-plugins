const { clipboard } = require('electron');

window.subnetApis = {
  copyToClipboard: (text) => {
    clipboard.writeText(String(text));
  }
};

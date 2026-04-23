const fs = require("node:fs");
let isClosing = false;

window.asciiTreeServices = {
  writeTextFile(filePath, content) {
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  }
};

window.ztools.onPluginEnter(({ code, type, payload }) => {
  window.dispatchEvent(
    new CustomEvent("ascii-tree:plugin-enter", {
      detail: { code, type, payload }
    })
  );
});

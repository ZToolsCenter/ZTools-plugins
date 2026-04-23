(() => {
  const STORAGE_KEY = "ascii-tree:level-text";
  const SAMPLE_INPUT = [
    "workspace",
    "=apps",
    "==desktop",
    "==web",
    "=packages",
    "==core",
    "==ui",
    "=docs",
    "==README.md"
  ].join("\n");

  const elements = {
    input: document.getElementById("text"),
    output: document.getElementById("tree"),
    fillSampleButton: document.getElementById("fill-sample"),
    clearButton: document.getElementById("clear-input"),
    copyButton: document.getElementById("copy-output"),
    saveButton: document.getElementById("save-output"),
    toast: document.getElementById("toast")
  };

  let toastTimer = null;

  const getWindowHeightLimit = () => {
    return 500;
  };

  const getStorage = () => {
    if (window.ztools?.dbStorage) {
      return window.ztools.dbStorage;
    }

    return window.localStorage;
  };

  const showToast = (message) => {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 1800);
  };

  const setWindowHeight = () => {
    if (!window.ztools?.setExpendHeight) {
      return;
    }

    window.ztools.setExpendHeight(getWindowHeightLimit());
  };

  const levelTextToTree = (input) => {
    const inputLines = input.split("\n");
    const reversedLines = inputLines.slice().reverse();
    const levelLineMap = {};
    let treeContent = "";

    for (let index = 0; index < reversedLines.length; index += 1) {
      const currentLine = reversedLines[index];
      const lineMatch = currentLine.match(/^(=*)\s*(.*?)\s*$/);

      if (!lineMatch) {
        continue;
      }

      const currentLevel = lineMatch[1].length;
      const nodeText = lineMatch[2].trim();

      if (!nodeText) {
        continue;
      }
      let nodePrefix = "";

      if (currentLevel > 0) {
        nodePrefix =
          levelLineMap[currentLevel] === undefined ? "└── " : "├── ";
      }

      for (let level = currentLevel - 1; level > 0; level -= 1) {
        nodePrefix = `${levelLineMap[level] ? "│   " : "    "}${nodePrefix}`;
      }

      treeContent = `${nodePrefix}${nodeText}\n${treeContent}`;
      levelLineMap[currentLevel] = true;

      Object.keys(levelLineMap).forEach((levelKey) => {
        if (Number(levelKey) > currentLevel) {
          delete levelLineMap[levelKey];
        }
      });
    }

    return treeContent.trim();
  };

  const treeToLevelText = (tree) =>
    tree.split("\n").map(line => {
      let level = 0;
      let content = line;
      const prefixes = ["├── ", "└── ", "│   ", "    "];
      while (prefixes.some(p => content.startsWith(p))) {
        level++;
        content = content.substring(4);
      }
      return "=".repeat(level) + content;
    }).join("\n");

  const saveInput = () => {
    getStorage().setItem(STORAGE_KEY, elements.input.value);
  };

  const renderTree = () => {
    elements.output.value = levelTextToTree(elements.input.value);
    saveInput();
    setWindowHeight();
  };

  const syncInputFromTree = () => {
    elements.input.value = treeToLevelText(elements.output.value);
    saveInput();
    setWindowHeight();
  };

  const loadSavedInput = () => {
    const savedText = getStorage().getItem(STORAGE_KEY);

    if (savedText) {
      elements.input.value = savedText;
    }
  };

  const copyOutput = async () => {
    const content = elements.output.value.trim();

    if (!content) {
      showToast("没有可复制的结果");
      return;
    }

    if (window.ztools?.copyText) {
      window.ztools.copyText(content);
      showToast("ASCII Tree 已复制");
      return;
    }

    await navigator.clipboard.writeText(content);
    showToast("ASCII Tree 已复制");
  };

  const saveOutput = () => {
    const content = elements.output.value.trim();

    if (!content) {
      showToast("没有可导出的结果");
      return;
    }

    const targetPath = window.ztools?.showSaveDialog?.({
      title: "导出 ASCII Tree",
      defaultPath: "ascii-tree.txt",
      filters: [{ name: "Text File", extensions: ["txt"] }]
    });

    if (!targetPath) {
      return;
    }

    if (window.asciiTreeServices?.writeTextFile) {
      window.asciiTreeServices.writeTextFile(targetPath, content);
      showToast("ASCII Tree 已导出");
      return;
    }

    showToast("当前环境不支持直接写文件，结果已保留在右侧");
  };

  const clearInput = () => {
    elements.input.value = "";
    renderTree();
    elements.input.focus();
  };

  const fillSample = () => {
    elements.input.value = SAMPLE_INPUT;
    renderTree();
    elements.input.focus();
  };

  const bindEvents = () => {
    elements.input.addEventListener("input", renderTree);
    elements.output.addEventListener("input", syncInputFromTree);
    elements.copyButton.addEventListener("click", () => {
      void copyOutput();
    });
    elements.saveButton.addEventListener("click", saveOutput);
    elements.clearButton.addEventListener("click", clearInput);
    elements.fillSampleButton.addEventListener("click", fillSample);

    window.addEventListener("beforeunload", saveInput);
    window.addEventListener("resize", setWindowHeight);
  };

  const init = () => {
    loadSavedInput();
    bindEvents();
    renderTree();
    setWindowHeight();
  };

  init();
})();

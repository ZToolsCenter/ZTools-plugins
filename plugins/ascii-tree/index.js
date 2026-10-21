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

  let isDetached = false;

  const isZToolsMainWindow = () => {
    if (isDetached) {
      return false;
    }
    if (!window.ztools?.setExpendHeight) {
      return false;
    }
    if (typeof window.ztools.getWindowType === "function") {
      try {
        return window.ztools.getWindowType() === "main";
      } catch {
        return false;
      }
    }
    return true;
  };

  const setWindowHeight = () => {
    if (!isZToolsMainWindow()) {
      return;
    }

    try {
      window.ztools.setExpendHeight(getWindowHeightLimit());
    } catch {
      // ignore
    }
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
  };

  const syncInputFromTree = () => {
    elements.input.value = treeToLevelText(elements.output.value);
    saveInput();
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

    // 1. ZTools 宿主环境
    if (window.ztools?.copyText) {
      window.ztools.copyText(content);
      showToast("ASCII Tree 已复制");
      return;
    }

    // 2. 现代浏览器 Clipboard API (仅在 Secure Context / HTTPS / localhost 下可用)
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(content);
        showToast("ASCII Tree 已复制");
        return;
      } catch {
        // 若剪贴板权限被拒绝等则继续降级
      }
    }

    // 3. 传统浏览器降级方案：document.execCommand('copy')（兼容 file:// 协议与 HTTP 环境）
    try {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.setAttribute("readonly", "");
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (success) {
        showToast("ASCII Tree 已复制");
        return;
      }
    } catch {
      // ignore
    }

    showToast("复制失败，请手动选择右侧结果复制");
  };

  const saveOutput = () => {
    const content = elements.output.value.trim();

    if (!content) {
      showToast("没有可导出的结果");
      return;
    }

    // 1. ZTools 宿主环境
    if (window.ztools?.showSaveDialog) {
      const targetPath = window.ztools.showSaveDialog({
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
    }

    // 2. 纯浏览器环境降级（使用 Blob 触发下载）
    try {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ascii-tree.txt";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("ASCII Tree 已导出");
      return;
    } catch {
      showToast("当前环境不支持直接写文件，结果已保留在右侧");
    }
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

    // 监听窗口分离，防止独立窗口误调用 setExpendHeight 导致尺寸循环膨胀
    const markDetached = () => {
      isDetached = true;
    };
    window.addEventListener("ascii-tree:plugin-detach", markDetached);
    if (window.ztools?.onPluginDetach) {
      try {
        window.ztools.onPluginDetach(markDetached);
      } catch {
        // ignore
      }
    }

    // 监听重新进入主窗口
    const onEnter = () => {
      isDetached = false;
      setWindowHeight();
    };
    window.addEventListener("ascii-tree:plugin-enter", onEnter);
    if (window.ztools?.onPluginEnter) {
      try {
        window.ztools.onPluginEnter(onEnter);
      } catch {
        // ignore
      }
    }
  };

  const init = () => {
    loadSavedInput();
    bindEvents();
    renderTree();
    setWindowHeight();
  };

  init();
})();

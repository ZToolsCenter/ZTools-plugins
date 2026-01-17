// 创建悬浮窗实例
const floatingWindow = new FloatingWindow();
// 创建番茄堆实例
let tomatoPile;

// 创建上下文菜单实例
const contextMenuWindow = new ContextMenuWindow();

const tipsWindow = new TipsWindow();

function waittingClock() {
  document.getElementById("controlBox").classList.add("waiting");
  setTimeout(() => {
    utools.showMainWindow();
  }, 100);
}

function clockBegin() {
  floatingWindow.sendMessage({ type: "clockBegin" });
  waittingClock();
}

function clockPause() {
  floatingWindow.sendMessage({ type: "clockPause" });
  waittingClock();
}

function clockContinue() {
  floatingWindow.sendMessage({ type: "clockContinue" });
  waittingClock();
}

function clockStop() {
  floatingWindow.sendMessage({ type: "clockStop" });
  waittingClock();
}

async function onWorkEnd(duration, progress) {
  // 如果进度大于0.3，则视为成功
  if (progress >= 0.3) {
    // 读取配置，是否显示成功弹窗
    if (settings.config.showSuccessPopup) {
      tipsWindow.create("workEnd");
      // 等待tipsWindow.getStatus()为true,再执行后面的代码
      while (!tipsWindow.getStatus()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // 如果悬浮胶囊可见，且配置显示番茄动画，则显示番茄动画
    if (settings.config.showFloatingWindow && settings.config.showTomatoAnimation) {
      tomatoPile.show();
    }

    todoManger_.addTomatoToActiveTask(duration, progress);
    updatePageTodayTomatosNum();
  } else {
    // 如果进度小于0.3，则视为失败,但仍然根据配置决定是否番茄堆
    if (settings.config.showTomatoAnimation && settings.config.showFloatingWindow) {
      tomatoPile.show();
    }
  }
}

function updatePageTodayTomatosNum() {
  const statisticsTodayNum = todoManger_.statisticsTodayNum();
  Ele_todayTomatosRedNum.innerText = statisticsTodayNum.red;
  Ele_todayTomatosYellowNum.innerText = statisticsTodayNum.yellow;
  document.getElementById("focusHours").innerText = `${statisticsTodayNum.focusHours} H`;
}

async function onBreakEnd(duration, type, progress) {
  todoManger_.recordStatistics(duration, type, progress);
  if (settings.config.showSuccessPopup) {
    console.log("---->");
    tipsWindow.create("breakEnd");
    while (!tipsWindow.getStatus()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // 如果配置了自动隐藏番茄堆，则隐藏番茄堆
  if (settings.config.autoHideAni) {
    tomatoPile.hide();
  }
}

// 延迟显示番茄堆窗口
setTimeout(async () => {
  tomatoPile = new TomatoPileWindow();

  if (settings.config.showTomatoAnimation && settings.config.showFloatingWindow && ubWindow == null) {
    await tomatoPile.create();
  }
  floatingWindow.sendMessage({ type: "playAudioSettingChanged", content: settings.config.playAudio });
  floatingWindow.sendMessage({ type: "audioSettingChanged", content: settings.getAudioConfig() });
}, 700);

// 延迟显示主窗口
setTimeout(() => {
  utools.showMainWindow();
}, 1000);

// ——————————————————————————————————————————————————

// 任务列表缩放适配
function scaleFloating(e) {
  if (settingPageOpening) return;
  const mouseY = e.clientY;

  const items = Ele_listBox.getElementsByClassName("s");
  Array.from(items).forEach((item) => {
    const itemRect = item.getBoundingClientRect();
    const itemCenterY = itemRect.top + itemRect.height / 2;
    const distance = Math.abs(mouseY - itemCenterY);
    const maxDistance = 60;

    if (distance > maxDistance) {
      item.style.width = "";

      item.style.opacity = "";
      return;
    }
    const scale = Math.cos(Math.PI * (distance / maxDistance)) + 1;

    // item.style.transform = `scaleX(${scale})`;

    if (item.classList.contains("short")) {
      item.style.width = `${2 * scale + 2}px`;
    } else if (item.classList.contains("mid")) {
      item.style.width = `${8 * scale + 6}px`;
    } else if (item.classList.contains("long")) {
      item.style.width = `${6 * scale + 24}px`;
    }
    item.style.opacity = 0.3 * scale + 0.4;
  });
}
// 监听悬浮窗鼠标移动事件,更新缩放适配
Ele_listBox.addEventListener("mousemove", scaleFloating);

// ——————————————————————————————————————————————

// 获取编辑器元素
const editor = document.getElementById("editor");

// 处理输入法开始输入事件
editor.addEventListener("compositionstart", () => {
  isComposing = true;
});

// 处理输入法输入内容更新事件
editor.addEventListener("compositionupdate", (event) => {
  console.log("正在输入:", event.data);
});

// 处理输入法输入结束事件
editor.addEventListener("compositionend", (event) => {
  isComposing = false;
  console.log("输入结束，最终内容:", event.data);
  onEditInput();
  if (event.data == "#") {
    event.preventDefault();
    document.getElementById("hashSelect").style.display = "flex";
    console.log("hashSelect", event.key);
    listenTagSelect = true;

    // 删除输入的#字符，保持光标位置
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.setStart(range.startContainer, range.startOffset - 1);
      range.deleteContents();
    }

    // 重新聚焦到编辑器，以便继续输入
    editor.focus();
  }
});

// 更新编辑器空状态
function updateEmptyState() {
  if (editor.textContent.trim() === "") {
    editor.classList.add("empty");
  } else {
    editor.classList.remove("empty");
  }
}
// 更新标签选择器
function reflashHashSelect() {
  Ele_tagSelect.innerHTML = "";
  let index = 0;
  for (let key in todoManger_.TaskList.longTagList) {
    let tag = todoManger_.TaskList.longTagList[key];
    if (tag.state != "active") continue;
    let tagItem = document.createElement("div");
    tagItem.classList.add("hashTag");
    tagItem.setAttribute("tag", key);
    tagItem.style.backgroundColor = tag.color;
    tagItem.innerHTML = `<div>${index++}</div>${tag.name}`;
    tagItem.onclick = function (e) {
      e.stopPropagation();
      Ele_tagSelect.style.display = "none";
      Ele_editTag.innerText = "#" + tag.name;
      Ele_editTag.style.backgroundColor = tag.color;
      Ele_editTag.setAttribute("tag", key);
      listenTagSelect = false;
      onEditInput();
    };

    Ele_tagSelect.appendChild(tagItem);
  }
}
// 遍历tagList，生成tagSelect元素
reflashHashSelect();

// 监听#按键输入
editor.addEventListener("keydown", function (event) {
  // console.log("keydown", event);

  // event.preventDefault();
  if (event.key === "excape") {
    event.preventDefault();
    event.stopPropagation();
    exitEditModel();
  }

  if (event.key === "#" && !isComposing) {
    event.preventDefault();
    toggleHashSelect(event);
  }
  if (listenTagSelect) {
    // 获取 Ele_tagSelect 的子元素数量
    const tagNum = Ele_tagSelect.childElementCount;

    if (!isNaN(event.key)) {
      const keyNum = parseInt(event.key, 10);

      if (keyNum >= 0 && keyNum < tagNum) {
        event.preventDefault();
        // 选择 Ele_tagSelect 的第 keyNum 个子元素
        const tagItem = Ele_tagSelect.children[keyNum];
        const index = tagItem.getAttribute("tag");

        Ele_tagSelect.style.display = "none";
        Ele_editTag.innerText = "#" + todoManger_.TaskList.longTagList[index].name;
        Ele_editTag.style.backgroundColor = todoManger_.TaskList.longTagList[index].color;
        Ele_editTag.setAttribute("tag", index);
        listenTagSelect = false;
        onEditInput();
      }
    }
  }

  if (event.key === "Enter" && !isComposing) {
    submitTask(event);
  }
});
// 提交任务
function submitTask(event) {
  event.preventDefault();
  event.stopPropagation();
  editor.focus();
  if (editor.textContent.trim() === "") {
    return;
  }

  if (editTaskId != null) return;

  let task = {
    title: editor.textContent.trim(),
    type: "short",
    state: "待办", //待办、进行中、完成、删除
    // 当前时间戳
    createdTimestamp: Date.now(),
    modifiedTimestamp: 0,
    beginTimestamp: 0,
    endTimestamp: 0,
    remindBefore: [],
    remindAfter: [],
    tag: Ele_editTag.getAttribute("tag"),
    priority: 0,
    star: false,
    tomato: {},
  };

  todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本
  // 聚焦到编辑器
  // editor.focus();
  editor.innerHTML = "";
  editor.classList.add("empty");

  Ele_listBox.scrollTo({
    top: Ele_listBox.scrollHeight - Ele_listBox.clientHeight - 200,
    behavior: "smooth",
  });
  // enterTaskMode("bottom");
}
// 显示标签选择器
function toggleHashSelect(e) {
  reflashHashSelect();
  e.stopPropagation();

  if (Ele_tagSelect.style.display == "flex") {
    closeHashSelect();
  } else {
    openHashSelect();
  }
}

function openHashSelect() {
  Ele_tagSelect.style.display = "flex";
  listenTagSelect = true;
}
function closeHashSelect() {
  Ele_tagSelect.style.display = "";
  listenTagSelect = false;
  console.log("closeHashSelect");
}



// 退出编辑模式
function exitEditModel() {
  console.log("exitEditModel");

  Ele_listBox.classList.remove("editingMask");
  Ele_editingIcon.style.display = "";
  editor.innerHTML = "";
  editor.classList.add("empty");
  editTaskId = null;
  document.querySelectorAll(".editingItem").forEach((item) => {
    item.classList.remove("editingItem");
  });
}
// 填充编辑器
function fillEditBox(task, e) {
  e.stopPropagation();
  console.log(e.currentTarget);

  // 所有taskItem元素移除editingItem类
  document.querySelectorAll(".editingItem").forEach((item) => {
    item.classList.remove("editingItem");
  });

  Ele_listBox.classList.add("editingMask");

  Ele_editingIcon.style.display = "flex";

  e.currentTarget.classList.add("editingItem");
  console.log(e.currentTarget);

  console.log("fillEditBox", task);
  editor.focus();
  editor.innerHTML = task.title;
  editor.classList.remove("empty");
  editor.classList.add("editing");
  Ele_editTag.innerText = "#" + todoManger_.TaskList.longTagList[task.tag].name;
  Ele_editTag.style.backgroundColor = todoManger_.TaskList.longTagList[task.tag].color;
  Ele_editTag.setAttribute("tag", task.tag);
  editTaskId = task.id;
}

// 监听 editor 的 focus 事件
editor.addEventListener("focus", function (e) {
  if (taskMode) return;
  enterTaskMode("bottom");
});

// 处理编辑器输入事件
function onEditInput() {
  console.log("input", editor.textContent, "|");
  if (editor.textContent == "" || editor.textContent == "\n" || editor.textContent == "<br>") {
    editor.classList.add("empty");
  } else {
    editor.classList.remove("empty");
    // enterTaskMode();
  }

  if (isComposing) {
    return;
  }

  // 获取光标位置
  const selection = window.getSelection();
  const range = selection.getRangeAt(0);
  const offset = range.startOffset;
  const node = range.startContainer;

  // // 保持文本内容
  let text = editor.textContent;
  editor.innerHTML = text;
  restoreCaretPosition(editor, node.parentNode, offset);

  console.log("输入法输入结束，内容为：", editor.textContent);
  if (editTaskId != null) {
    todoManger_.update(editTaskId, editor.textContent.trim(), Ele_editTag.getAttribute("tag"));
    // exitEditModel();
    // return;
  }
}

// 处理一般输入事件
editor.addEventListener("input", function (e) {
  onEditInput();
});
// 恢复光标位置
function restoreCaretPosition(element, node, offset) {
  const range = document.createRange();
  const selection = window.getSelection();

  // 修正光标位置
  let newNode = element.firstChild;
  let newOffset = offset;

  // 处理文本节点的情况
  while (newNode && newNode.nodeType === Node.TEXT_NODE && newNode !== node) {
    if (newNode.textContent.length < offset) {
      newOffset -= newNode.textContent.length;
      newNode = newNode.nextSibling;
    } else {
      break;
    }
  }

  if (newNode) {
    range.setStart(newNode, newOffset);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
  }
}

let scrollTimer = null;

// 监听元素的交叉事件
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        if (!taskMode && entry.target.id == "whiteBoxTop") {
          Ele_todoList.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        } else if (!taskMode && entry.target.id == "whiteBoxBottom") {
          // 如果todoList 元素高度高于listBox高度，对齐底部
          if (Ele_todoList.offsetHeight < Ele_listBox.clientHeight) {
            Ele_todoList.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          } else {
            console.log("scrollIntoView 高度大于");
            Ele_todoList.scrollIntoView({
              behavior: "smooth",
              block: "end",
            });
          }
        } else if (taskMode && entry.target.id == "whiteBoxTop") {
          if (stopObserving) return;

          while (true) {
            if (historyTimePoint == 0) {
              Ele_anchorTop.classList.remove("hidden");
              return;
            }

            const archivedList = todoManger_.readArchivedTasks(historyTimePoint);
            if (archivedList.tasks.length == 0 && archivedList.hasEarlierTasks) {
              // 今天没有、之前有，继续遍历，更新时间点
              historyTimePoint = archivedList.nearestEarlierDate;
              continue;
            } else if (archivedList.tasks.length == 0 && !archivedList.hasEarlierTasks) {
              // 今天没有、之前没有，结束遍历
              return;
            } else if (archivedList.tasks.length > 0 && archivedList.hasEarlierTasks) {
              // 今天有、之前有，结束遍历
              renderArchivedTasks(historyTimePoint, archivedList.tasks);
              historyTimePoint = archivedList.nearestEarlierDate;
              Ele_listBox.scrollTo({
                top: 150,
                behavior: "smooth",
              });
              return;
            } else {
              // 今天有、之前没有
              renderArchivedTasks(historyTimePoint, archivedList.tasks);
              historyTimePoint = 0;
              Ele_listBox.scrollTo({
                top: 150,
                behavior: "smooth",
              });
              return;
            }
          }
        }
      }
    });
  },
  {
    root: Ele_listBox,
    threshold: 1,
  }
);

let in_animation = false;
// ---------------------------------------------------
// 进入任务模式
function enterTaskMode(arrow = "top") {
  in_animation = true;
  taskMode = true;
  console.log("enterTaskMode", arrow);

  document.getElementById("mainBody").classList.add("taskMode");

  // 设置任务列表可拖拽
  document.querySelectorAll("#todoList .taskItem").forEach((item) => {
    setElementCanDrop(item);
  });

  let scrollInterval = setInterval(() => {
    if (arrow == "top") {
      Ele_listBox.scrollTo({
        top: 150 + Ele_doneList.offsetHeight,
        behavior: "instant",
      });
    } else {
      Ele_listBox.scrollTo({
        top: Ele_listBox.scrollHeight - Ele_listBox.clientHeight,
        behavior: "instant",
      });
    }
  }, 0);

  setTimeout(() => {
    clearInterval(scrollInterval);
  }, 600);

  setTimeout(() => {
    in_animation = false;
  }, 900);
}
let centerScrollY = 0;

// 退出任务模式
function exitTaskMode() {
  console.log("exitTaskMode", in_animation);
  if (in_animation) return;
  stopObserving = true;

  setTimeout(() => {
    stopObserving = false;
    taskMode = false;
  }, 800);

  closeHashSelect();

  document.getElementById("mainBody").classList.remove("taskMode");



  Ele_archivedList.innerHTML = "";
  historyTimePoint = new Date().toISOString().slice(0, 10);
  Ele_anchorTop.classList.add("hidden");

  // 任务列表不可拖拽
  document.querySelectorAll("#todoList .taskItem").forEach((item) => {
    removeElementCanDrop(item);
  });

  let scrollInterval = setInterval(() => {
    Ele_todoList.scrollIntoView({
      behavior: "auto", // 平滑滚动
      block: "start", // 垂直对齐方式: "start" | "center" | "end" | "nearest"
    });
  }, 0);

  // 800ms后停止滚动(与CSS动画时长相同)
  setTimeout(() => {
    clearInterval(scrollInterval);
  }, 800);
}

//监听按键输入，进入或退出任务模式
document.addEventListener("keydown", function (event) {
  if (settingPageOpening) return;

  if (taskMode && event.key === "Escape") {
    event.stopPropagation();
    console.log("taskMode Escape", document.activeElement === editor);
    if (Ele_tagSelect.style.display == "flex") {
      closeHashSelect();
      return;
    }

    if (editor.textContent.trim() != "") {
      editor.innerHTML = "";
      editor.classList.add("empty");
      editor.blur();
    } else if (document.activeElement === editor) {
      editor.blur();
    } else {
      exitTaskMode();
    }
  } else if (!excludedKeys.has(event.key)) {

    if (event.key == "#") {
      openHashSelect();
      // 阻止#号输入到编辑器
      event.preventDefault();
    }


    editor.focus();
  }
});

// 点击任务列表卡片
document.getElementById("todoList_card").onclick = function (e) {
  console.log("todoList_card click");
  e.stopPropagation();

  if (editTaskId != null) {
    exitEditModel();
  }

  if (taskMode || draging) return;
  console.log("进入任务模式，点击任务列表卡片");
  enterTaskMode();
  // e.preventDefault();
};

document.getElementById("whiteBoxTop").onclick = function (e) {
  if (taskMode) return;
  e.stopPropagation();
  console.log("whiteBoxTop click");
  enterTaskMode("top");
};

document.getElementById("whiteBoxBottom").onclick = function (e) {
  if (taskMode) return;
  e.stopPropagation();
  console.log("whiteBoxBottom click");

  enterTaskMode("bottom");
};

document.getElementById("exitBtn").onclick = function (e) {
  e.stopPropagation();
  window.utools.outPlugin(true);
};

// ————————————————————————————————————————————————————————————

// ————————————————————————————————————————————————————————————

document.body.onclick = function (e) {
  console.log("body click");
  if (editTaskId != null) {
    exitEditModel();
    return;
  }
  if (taskMode) {
    exitTaskMode();
  }
};

editor.onclick = function (e) {
  console.log("editor click");
  e.stopPropagation();
};

Ele_editTag.innerText = "#" + todoManger_.TaskList.longTagList[0].name;
// Ele_editTag.style.display = "flex";
Ele_editTag.style.backgroundColor = todoManger_.TaskList.longTagList[0].color;
Ele_editTag.setAttribute("tag", 0);

settingsPageComponent = [
  {
    name: "autoWork",
    type: "switch",
    component: new Switch("autoWork", settings, "autoWork"),
  },
  {
    name: "autoBreak",
    type: "switch",
    component: new Switch("autoBreak", settings, "autoBreak"),
  },
  {
    name: "showSuccessPopup",
    type: "switch",
    component: new Switch("showSuccessPopup", settings, "showSuccessPopup"),
  },
  {
    name: "showFloatingWindow",
    type: "switch",
    component: new Switch("showFloatingWindow", settings, "showFloatingWindow"),
  },
  {
    name: "showTomatoAnimation",
    type: "switch",
    component: new Switch("showTomatoAnimation", settings, "showTomatoAnimation"),
  },
  {
    name: "soundEffect",
    type: "switch",
    component: new Switch("soundEffect", settings, "soundEffect"),
  },
  {
    name: "workDuration",
    type: "slider",
    component: new Slider("slider-container-workDuration", "slider-thumb-workDuration", 5, 120, 0, 5, "min", settings, "workDuration"),
  },
  {
    name: "shortBreakDuration",
    type: "slider",
    component: new Slider("slider-container-shortBreakDuration", "slider-thumb-shortBreakDuration", 1, 20, 0, 1, "min", settings, "shortBreakDuration"),
  },
  {
    name: "longBreakDuration",
    type: "slider",
    component: new Slider("slider-container-longBreakDuration", "slider-thumb-longBreakDuration", 5, 60, 0, 5, "min", settings, "longBreakDuration"),
  },
  {
    name: "longBreakInterval",
    type: "slider",
    component: new Slider("slider-container-longBreakInterval", "slider-thumb-longBreakInterval", 2, 10, 0, 1, "", settings, "longBreakInterval"),
  },
  {
    name: "autoHideAni",
    type: "switch",
    component: new Switch("autoHideAni", settings, "autoHideAni"),
  },
  {
    name: "opacity",
    type: "slider",
    component: new Slider("slider-container-opacity", "slider-thumb-opacity", 0.3, 1, 2, 0.01, "", settings, "opacity", "update"),
  },
];

document.getElementById("musicBox").addEventListener("click", function () {
  floatingWindow.sendMessage({ type: "playAudioSettingChanged", content: !settings.config.playAudio });
});

function initMusicList() {
  const Ele_audioList = document.getElementById("audioList");

  // 清空audioList
  Ele_audioList.innerHTML = "";

  // 遍历audioList，创建slider
  for (let key in audioList) {
    const audioItem = document.createElement("div");
    audioItem.classList.add("audio_item");
    audioItem.setAttribute("attribution", audioList[key].attribution);

    audioItem.innerHTML = `

        <div id="audioActive_${key}" class="switch">
              <img src="../../pic/audioCover/${audioList[key].iconPath}" alt="">
        </div>


      <div class="audio_controlBox">
        <div class="audio_item_title">${audioList[key].name}</div>

        <div id="slider-container-audio_${key}" class="slider-container">
          <div></div>
          <div id="slider-thumb-audio_${key}" class="slider-thumb"></div>
        </div>
      </div>

    `;
    Ele_audioList.appendChild(audioItem);
    audioList[key].slider = new Slider(`slider-container-audio_${key}`, `slider-thumb-audio_${key}`, 0, 1, 2, 0.01, "", settings, `audioVolume_${key}`, "update");
    audioList[key].switch = new Switch(`audioActive_${key}`, settings, `audioActive_${key}`);
  }

  const audioVolumeList = settings.config.audioList;
}

settings.onClockChange = (event) => {
  console.log("settings changed", settings.config);
  floatingWindow.sendMessage({ type: "clockSettingChanged", content: event });
};

settings.onAudioConfigChange = (event) => {
  console.log("settings changed", settings.config);
  floatingWindow.sendMessage({ type: "audioSettingChanged", content: event });
};

settings.onPlayAudioChange = (event) => {
  console.log("playAudioSettingChanged changed -->");
  document.getElementById("musicBox").setAttribute("data-active", String(event));
};

settings.onShowFloatingWindowChange = (state) => {
  if (state) {
    // 如果悬浮窗开启，则创建悬浮窗
    floatingWindow.show();

    if (settings.config.showTomatoAnimation) {
      // 如果番茄动画开启，则创建番茄动画悬浮窗
      tomatoPile.show();
    }
  } else {
    // 如果悬浮窗关闭，则关闭悬浮窗
    floatingWindow.close();
    // 如果番茄动画开启，则关闭番茄动画悬浮窗
    tomatoPile.hide();
  }
};

settings.onShowTomatoAnimationChange = (state) => {
  if (state) {
    tomatoPile.show();
  } else {
    tomatoPile.close();
  }
};

settings.onAutoHideAniChange = (state) => {
  if (currentState !== "working") return;
  if (state) {
    tomatoPile.close();
  } else {
    tomatoPile.show();
  }
};

function setDarkMode(state) {
  switch (state) {
    case "dark":
      console.log("setDarkMode dark");
      document.documentElement.setAttribute("data-theme", "dark");
      break;
    case "light":
      console.log("setDarkMode light");
      document.documentElement.removeAttribute("data-theme");
      break;
    case "auto":
      console.log(utools.isDarkColors());
      if (utools.isDarkColors()) {
        console.log("setDarkMode auto dark");
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        console.log("setDarkMode auto light");
        document.documentElement.removeAttribute("data-theme");
      }
      break;
  }
}

settings.onDarkModeChange = (state) => {
  console.log("onDarkModeChange", state);
  setDarkMode(state);
};

settings.onOpacityChange = (state) => {
  floatingWindow.sendMessage({ type: "opacityChange", content: state });
};

class Pages {
  constructor() {
    this.clockPage = document.getElementById("clockPage");
    this.statisticPage = document.getElementById("statisticPage");
    this.musicPage = document.getElementById("musicPage");
    this.settingPage = document.getElementById("settingPage");
    this.userPage = document.getElementById("userPage");

    this.pages = [
      { name: "clockPage", pageEle: this.clockPage, btnEle: document.getElementById("clockPageBtn") },
      { name: "statisticPage", pageEle: this.statisticPage, btnEle: document.getElementById("statisticPageBtn") },
      { name: "musicPage", pageEle: this.musicPage, btnEle: document.getElementById("musicPageBtn") },
      { name: "settingPage", pageEle: this.settingPage, btnEle: document.getElementById("settingPageBtn"), componentsList: settingsPageComponent },
    ];

    this.switchPage(0);

    // Ele_listBox.scrollTo({
    //   top: Ele_listBox.scrollHeight - Ele_listBox.clientHeight - 200,
    //   behavior: "smooth",
    // });

    observer.observe(document.getElementById("whiteBoxTop"));
    observer.observe(document.getElementById("whiteBoxBottom"));
  }

  switchPage(index) {
    if (index != 0) {
      settingPageOpening = true;
    } else {
      settingPageOpening = false;
    }

    this.pages.forEach((page) => {
      page.pageEle.style.display = "none";
      page.btnEle.classList.remove("activeSvg");
    });

    this.pages[index].btnEle.classList.add("activeSvg");

    this.pages[index].pageEle.style.display = "flex";
    console.log("switchPage", this.pages[index].name);

    if (this.pages[index].componentsList) {
      this.pages[index].componentsList.forEach((component) => {
        component.component.render();
      });
    }

    switch (this.pages[index].name) {
      case "clockPage":
        exitTaskMode();
        break;
      case "statisticPage":
        const workStatistics = todoManger_.getWorkStatistics();

        // 刷新日历
        Ele_calendarKey_totalDay.innerText = workStatistics.totalDay;
        Ele_calendarKey_totalHour.innerText = workStatistics.totalHour;
        Ele_calendarKey_totalTomato.innerText = workStatistics.totalTomato;
        Ele_calendarKey_totalShortTar.innerText = workStatistics.totalShortTar;

        const WorkDateDistribution = todoManger_.getWorkDateDistribution();

        // 获取当前日期，格式为"2024-05-29"
        const currentDate = new Date().toISOString().slice(0, 10);

        // 刷新日历
        const calendar = new GitHubCalendar("calendar", currentDate, 12);
        calendar.setData(WorkDateDistribution);

        // 刷新长目标
        reflashLongTars("active");
        reflashLongTars("done");

        break;
      case "musicPage":
        initMusicList();
        break;
      case "settingPage":
        // 刷新番茄范围
        const form = document.getElementById("tomatoBoxRange");
        const radios = form.elements["tomatoBoxRange"];

        // 初始化表单选中状态
        for (let radio of radios) {
          if (parseInt(radio.value) == settings.config.tomatoBoxRange) {
            radio.checked = true;
          }
        }

        // 监听表单变化
        form.addEventListener("change", function (event) {
          if (event.target.name == "tomatoBoxRange") {
            settings.updateConfig("tomatoBoxRange", parseInt(event.target.value));
            tomatoPile.destroy();
            tomatoPile.create();
          }
        });

        break;
    }

    // 指示器
    const indicator = document.getElementById("indicator");
    indicator.style.top = `calc(50% + ${(index - 2) * 58 - 16}px )`;
  }
}

const pages = new Pages();

// 为所有page类元素添加点击事件
// 为所有page类元素添加点击事件
// const pageBtnElements = document.getElementsByClassName("btnBox");
// for (let i = 0; i < pageBtnElements.length; i++) {
//   pageBtnElements[i].onclick = () => pages.switchPage(i);
// }
pages.pages.forEach((page, index) => {
  if (page.btnEle) {
    page.btnEle.onclick = () => pages.switchPage(index);
  }
});

function addLongTar() {
  todoManger_.addLongTar();
  reflashLongTars("active");
}

// 选择长标签颜色
function pickLongTagColor(id, type, color) {
  // 找到当前颜色的索引
  let currentIndex = colorList.indexOf(color);

  // 获取下一个颜色的索引，循环到列表开头
  let nextIndex = (currentIndex + 1) % colorList.length;

  // 选择下一个颜色
  const nextColor = colorList[nextIndex];

  // 更新颜色
  todoManger_.updateLongTar(id, null, null, nextColor);

  // 刷新长标签
  type === "active" ? reflashLongTars("active") : reflashLongTars("done");
}

// 刷新长标签
function reflashLongTars(type) {
  if (type == "active") {
    Ele_longTars_active.innerHTML = "";
    for (let key in todoManger_.TaskList.longTagList) {
      let tag = todoManger_.TaskList.longTagList[key];
      if (tag.state == "active") {
        let workStatisticsLongTar = todoManger_.getWorkStatisticsByLongTarId(key);
        console.log("Updated workStatisticsLongTar", key, todoManger_.getWorkStatisticsByLongTarId(key));

        const longTagBox = document.createElement("div");
        longTagBox.classList.add("longTagBox");
        longTagBox.style.backgroundColor = tag.color;
        longTagBox.setAttribute("tagId", key);
        // longTagBox.onclick = pickLongTagColor.bind(null, key, "active",tag.color);

        let compLongTar = "";
        if (key != 0) {
          compLongTar = ` <div class="compLongTar actived" tarId="${key}"  >
          <div class="progressBar"></div>
          <svg width="22" height="20" viewBox="0 0 22 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g clip-path="url(#clip0_2428_135)">
          <path d="M9.0957 13.9805H12.0792V18.4652H9.0957V13.9805Z" fill="#FFBE61" style="fill:#FFBE61;fill:color(display-p3 1.0000 0.7451 0.3804);fill-opacity:1;"/>
          <path d="M7.60415 16.9713H13.5712C14.5688 16.9713 15.0677 17.4686 15.0677 18.4631C15.0677 19.4607 14.5688 19.9596 13.5712 19.9596H7.60415C6.6065 19.9596 6.10768 19.4607 6.10768 18.4631C6.10768 17.4717 6.6065 16.9745 7.60415 16.9713ZM16.5594 3.53132H19.5288C19.7247 3.53132 19.9187 3.5699 20.0997 3.64487C20.2807 3.71984 20.4452 3.82972 20.5837 3.96825C20.7222 4.10677 20.8321 4.27122 20.9071 4.45221C20.982 4.6332 21.0206 4.82718 21.0206 5.02308V8.02073C21.0206 8.81201 20.7063 9.57088 20.1468 10.1304C19.5872 10.6899 18.8284 11.0043 18.0371 11.0043H16.5594V3.53132ZM1.64651 3.53132H4.63003V10.9901H3.12415C2.33287 10.9901 1.574 10.6758 1.01448 10.1163C0.45496 9.55676 0.140625 8.79789 0.140625 8.00661V5.00896C0.14247 4.81306 0.182886 4.61944 0.259564 4.43916C0.336241 4.25887 0.44768 4.09546 0.587516 3.95824C0.727352 3.82103 0.892846 3.7127 1.07455 3.63945C1.25625 3.5662 1.4506 3.52945 1.64651 3.53132Z" fill="#FFBE61" style="fill:#FFBE61;fill:color(display-p3 1.0000 0.7451 0.3804);fill-opacity:1;"/>
          <path d="M6.10859 0.527404H15.0498C15.4447 0.524904 15.8363 0.600855 16.2017 0.750852C16.5671 0.900849 16.899 1.12191 17.1783 1.4012C17.4576 1.68049 17.6787 2.01246 17.8287 2.37785C17.9787 2.74325 18.0546 3.13478 18.0521 3.52976V8.03329C18.0521 10.0127 17.2658 11.9111 15.8661 13.3108C14.4664 14.7105 12.568 15.4968 10.5886 15.4968C8.60914 15.4968 6.71076 14.7105 5.31108 13.3108C3.91139 11.9111 3.12506 10.0127 3.12506 8.03329V3.52976C3.12258 3.13637 3.19792 2.74638 3.34674 2.38223C3.49557 2.01807 3.71494 1.68695 3.99223 1.4079C4.26953 1.12886 4.59927 0.90741 4.96248 0.756298C5.32569 0.605186 5.7152 0.527396 6.10859 0.527404Z" fill="#FFBE61" style="fill:#FFBE61;fill:color(display-p3 1.0000 0.7451 0.3804);fill-opacity:1;"/>
          <path opacity="0.5" d="M11.298 4.0433C11.3674 4.11239 11.4225 4.19452 11.4601 4.28497C11.4977 4.37542 11.517 4.47241 11.517 4.57036C11.517 4.66831 11.4977 4.7653 11.4601 4.85575C11.4225 4.9462 11.3674 5.02833 11.298 5.09742L9.1756 7.21507C9.10651 7.2845 9.02438 7.3396 8.93393 7.3772C8.84348 7.41479 8.74649 7.43415 8.64854 7.43415C8.55059 7.43415 8.4536 7.41479 8.36315 7.3772C8.2727 7.3396 8.19057 7.2845 8.12148 7.21507C7.98352 7.07432 7.90625 6.88509 7.90625 6.68801C7.90625 6.49092 7.98352 6.30169 8.12148 6.16095L10.2344 4.0433C10.3035 3.97387 10.3856 3.91877 10.4761 3.88117C10.5665 3.84357 10.6635 3.82422 10.7615 3.82422C10.8594 3.82422 10.9564 3.84357 11.0469 3.88117C11.1373 3.91877 11.2194 3.97387 11.2885 4.0433H11.298ZM13.8438 7.03624C13.9133 7.10533 13.9684 7.18746 14.006 7.27791C14.0436 7.36836 14.0629 7.46535 14.0629 7.5633C14.0629 7.66125 14.0436 7.75824 14.006 7.84869C13.9684 7.93914 13.9133 8.02127 13.8438 8.09036L10.6768 11.2621C10.5366 11.4012 10.3472 11.4793 10.1497 11.4793C9.95226 11.4793 9.76281 11.4012 9.62266 11.2621C9.55322 11.193 9.49813 11.1109 9.46053 11.0205C9.42293 10.93 9.40358 10.833 9.40358 10.7351C9.40358 10.6371 9.42293 10.5401 9.46053 10.4497C9.49813 10.3592 9.55322 10.2771 9.62266 10.208L12.7897 7.03624C12.8588 6.96681 12.9409 6.91171 13.0314 6.87411C13.1218 6.83651 13.2188 6.81716 13.3168 6.81716C13.4147 6.81716 13.5117 6.83651 13.6022 6.87411C13.6926 6.91171 13.7747 6.96681 13.8438 7.03624Z" fill="white" style="fill:white;fill-opacity:1;"/>
          </g>
          <defs>
          <clipPath id="clip0_2428_135">
          <rect width="22" height="20" fill="white" style="fill:white;fill-opacity:1;"/>
          </clipPath>
          </defs>
          </svg>
          完成目标
          </div>`;
        } else {
          compLongTar = `
          <div class="compLongTar default" >
            默认目标<br>
            始终存在
          </div>
          `;
        }

        longTagBox.innerHTML = `<span class="hash" onclick='pickLongTagColor(${key},"active","${tag.color}")'>#</span><span class="longTar" contenteditable="true" tarId="${key}" >${tag.name}</span>
        <div class="rightBox">
            <div><span>${workStatisticsLongTar.totalHour}</span><span>小时</span></div>
            <div><span>${workStatisticsLongTar.totalTomato}</span><span>番茄</span></div>
            <div><span>${workStatisticsLongTar.totalShortTar}</span><span>小目标</span></div>
        </div>
        ${compLongTar}
        `;
        // 在顶部添加
        Ele_longTars_active.insertBefore(longTagBox, Ele_longTars_active.firstChild);
      }
    }
  } else if (type == "done") {
    console.log(todoManger_.TaskList.longTagList);
    Ele_longTars_done.innerHTML = "";
    for (let key in todoManger_.TaskList.longTagList) {
      let tag = todoManger_.TaskList.longTagList[key];
      if (tag.state == "done") {
        let workStatisticsLongTar = todoManger_.getWorkStatisticsByLongTarId(key);

        const longTagBox = document.createElement("div");
        longTagBox.classList.add("longTagBox");
        longTagBox.style.backgroundColor = tag.color;
        longTagBox.setAttribute("tagId", key);
        // longTagBox.onclick = pickLongTagColor.bind(null, key, "done",tag.color);

        let compLongTar = ` <div class="doneBtnBox"  tarId="${key}" >
            <div  class="compLongTar resume"  tarId="${key}" >
              <div class="progressBar"></div>
              继续目标
            </div>
            <div class="compLongTar del"  tarId="${key}" >
            <div class="progressBar"></div>
            删除</div>
          </div>`;

        longTagBox.innerHTML = `<span class="hash"  onclick='pickLongTagColor(${key},"active","${tag.color}")'>#</span><span class="longTar" contenteditable="true" tarId="${key}" >${tag.name}</span>
        <div class="rightBox">
            <div><span>${workStatisticsLongTar.totalHour}</span><span>小时</span></div>
            <div><span>${workStatisticsLongTar.totalTomato}</span><span>番茄</span></div>
            <div><span>${workStatisticsLongTar.totalShortTar}</span><span>小目标</span></div>
        </div>
        ${compLongTar}
        `;
        Ele_longTars_done.insertBefore(longTagBox, Ele_longTars_done.firstChild);
      }
    }
  }
}

updatePageTodayTomatosNum();

var isComposingLT = false;

Ele_longTarsGroupBox.addEventListener("click", function (event) {
  if (event.target.classList.contains("longTar")) {
    event.stopPropagation();
  }
});

Ele_longTarsGroupBox.addEventListener("input", function (event) {
  // 检查事件目标是否是你关心的元素
  if (event.target.classList.contains("longTar")) {
    // 在这里处理你的事件
    if (isComposingLT) return;

    console.log("内容已更改:", event.target.innerText, "tarId:", event.target.getAttribute("tarId"));
    todoManger_.updateLongTar(event.target.getAttribute("tarId"), event.target.innerText.trim(), "active");
  }
});

Ele_longTarsGroupBox.addEventListener("keydown", function (event) {
  if (!isComposingLT && event.target.classList.contains("longTar") && event.key == "Enter") {
    event.target.blur();
    // todoManger_.updateLongTar(event.target.getAttribute("tarId"), event.target.innerText.trim(),"active");
    // console.log(event.key)
  }
});

// 处理输入法开始输入事件
Ele_longTarsGroupBox.addEventListener("compositionstart", () => {
  isComposingLT = true;
});

// 处理输入法输入内容更新事件
Ele_longTarsGroupBox.addEventListener("compositionupdate", (event) => {
  console.log("正在输入:", event.data);
});

// 处理输入法输入结束事件
Ele_longTarsGroupBox.addEventListener("compositionend", (event) => {
  isComposingLT = false;
  // console.log("输入结束，最终内容:", event.data);

  if (event.target.classList.contains("longTar")) {
    todoManger_.updateLongTar(event.target.getAttribute("tarId"), event.target.innerText.trim(), "active");
  }
});

let timer;
let interval;
const duration = 2000; // 长按总时间，单位为毫秒
const checkInterval = 50; // 检查进度的时间间隔，单位为毫秒
let startTime;

Ele_longTarsGroupBox.addEventListener("mousedown", (event) => {
  if (event.target.classList.contains("compLongTar") && !event.target.classList.contains("default")) {
    console.log("长按开始！");
    event.target.classList.add("holding");

    startTime = Date.now();
    if (event.target.classList.contains("actived")) {
      type = "active";
    } else if (event.target.classList.contains("resume")) {
      type = "resume";
    } else if (event.target.classList.contains("del")) {
      type = "del";
    }

    interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / duration;
      // console.log(event.target);
      updateProgress(progress, event.target);

      if (elapsed >= duration) {
        clearInterval(interval);

        if (type == "active") {
          if (settings.config.soundEffect) {
            // 播放音乐
            const audio = new Audio("../../audio/achievement.aac");
            // 音量
            audio.volume = 0.7;
            audio.play();
          }

          confettiNow(event.target.parentNode);
          event.target.style.transform = "";
          event.target.parentNode.classList.add("letItGo");
          todoManger_.updateLongTar(event.target.getAttribute("tarId"), null, "done", null);

          setTimeout(() => {
            reflashLongTars("done");
            event.target.parentNode.remove();
          }, 600);
        } else if (type == "resume") {
          event.target.style.transform = "";

          todoManger_.updateLongTar(event.target.getAttribute("tarId"), null, "active", null);
          event.target.parentNode.parentNode.classList.add("letItGo");
          reflashLongTars("active");
          setTimeout(() => {
            event.target.parentNode.parentNode.remove();
          }, 300);
        } else if (type == "del") {
          event.target.style.transform = "";
          todoManger_.updateLongTar(event.target.getAttribute("tarId"), null, "del", null);
          event.target.parentNode.parentNode.classList.add("letItGo");
          setTimeout(() => {
            reflashLongTars("active");
            event.target.parentNode.parentNode.remove();
          }, 400);
        }
      }
    }, checkInterval);
  }
});

Ele_longTarsGroupBox.addEventListener("mouseup", clearTimers);
Ele_longTarsGroupBox.addEventListener("mouseout", clearTimers);

function clearTimers(event) {
  if (event.target.classList.contains("compLongTar") && !event.target.classList.contains("default")) {
    clearInterval(interval);
    updateProgress(0); // 重置进度
    event.target.style.transform = "";
    event.target.classList.remove("holding");
    event.target.querySelector(".progressBar").style.width = "0";
  }
}
let shakeFlag = 1;
function updateProgress(progress, element) {
  if (!element) {
    return;
  }

  const angle = 2 * shakeFlag * (progress * 0.5 + 1);

  shakeFlag = -shakeFlag;

  const progressBar = element.querySelector(".progressBar");

  // element.style.transform = `rotate(${angle}deg)`;

  // 设置 before 伪元素
  // element.style.before = `width:${progress * 100}%;`;
  progressBar.style.width = `${progress * 100 + 25}%`;
  progressBar.style.transform = `rotate(${angle}deg)`;
}

function confettiNow(element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + element.offsetWidth / 2;
  const y = rect.top + element.offsetHeight / 2;

  confetti({
    particleCount: 100,
    startVelocity: 30,
    spread: 360,
    origin: {
      x: x / window.innerWidth,
      y: y / window.innerHeight,
    },
    colors: ["#ff0", "#ffbf00", "#ffd700"], // 使用金色调的颜色
  });
}

function triggerActionOnDayChange(action) {
  let lastCheckedDate = new Date().getDate();

  setInterval(() => {
    const currentDate = new Date().getDate();
    if (currentDate !== lastCheckedDate) {
      lastCheckedDate = currentDate;
      action();
    }
  }, 1000 * 60); // 每分钟检查一次
}

// 示例动作：输出一条消息
function OnDayChange() {
  destroyubWindow();
  creatubWindow();
  todoManger_.archiveTasks();
  updatePageTodayTomatosNum();
}

// 启动跨天检测
triggerActionOnDayChange(OnDayChange);

utools.onPluginEnter(({ code, type, payload }) => {
  setDarkMode(settings.config.darkMode);
  console.log("payload", payload);

  switch (payload) {
    case "超级番茄统计":
      pages.switchPage(1);
      break;
    case "超级番茄白噪音":
      pages.switchPage(2);
      break;
    case "超级番茄设置":
      pages.switchPage(3);
      break;
    case "超级番茄账号":
      pages.switchPage(5);
      break;
    case "退出超级番茄":
      // 时间如果小于2s，则不退出
      if (new Date().getTime() - window.startPluginTime < 2000) {
        return;
      }
      utools.outPlugin(true);
      break;
  }
});

const darkModeSwitch = new Select("darkModeSwitch", settings, "darkMode", [
  { value: "light", label: "明亮模式", icon: "../../pic/darkMode-light.svg" },
  { value: "dark", label: "深色模式", icon: "../../pic/darkMode-dark.svg" },
  { value: "auto", label: "跟随系统", icon: "../../pic/darkMode-auto.svg" },
]);

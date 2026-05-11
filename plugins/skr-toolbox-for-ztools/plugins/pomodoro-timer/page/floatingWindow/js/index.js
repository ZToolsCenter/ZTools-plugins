const bornSize = 0.4;
var indexPageId = null;

// 设置番茄进度
function setTomato(progress) {
  const centerX = 30;
  const centerY = 12;
  const scale = (1 - bornSize - 0.2) * progress + bornSize;
  const tomatoBody = document.getElementById("tomatoBody");
  const tomatoFill = document.getElementById("tomatoFill");

  var translateX = (1 - scale) * centerX;
  var translateY = (1 - scale) * centerY;
  tomatoBody.setAttribute("transform", `translate(${translateX}, ${translateY}) scale(${scale})`);

  tomatoFill.setAttribute("fill", getGradientColor(["#7ABE6F", "#FFD12C", "#FC5E3C"], [0, 0.5, 1], progress.toFixed(2)));
  tomatoFill.setAttribute("stroke", getGradientColor(["#0D9D00", "#EEAF50", "#FFBE5D"], [0, 0.5, 1], progress.toFixed(2)));
  tomatoBody.setAttribute("opacity", 1);
  // console.log("setTomato:", progress);
}

document.getElementById("tomatoBox").style.display = "block";

setTomato(0);

let clock = new TomatoClock();

const timerMinutes = document.getElementById("minutes");
const timerSeconds = document.getElementById("seconds");

// 设置事件处理程序
// 读秒更新事件
clock.onTick = function () {
  const formatTime = this.formatTime();
  timerMinutes.textContent = formatTime.minutes;
  timerSeconds.textContent = formatTime.seconds;

  sendMessageToIndex({ type: "updateTrick", content: formatTime });
};

clock.onStateChange = function () {
  sendMessageToIndex({ type: "stateChange", content: this.config.currentState, workTime: this.getWorkTime() });

  switch (this.config.currentState) {
    case "idle":
      console.log("Idle");
      setTomato(0);
      document.getElementById("tomatoBox").style.display = "block";
      document.getElementById("breakIcon").style.display = "none";
      document.getElementById("timerNum").style.display = "none";
      document.getElementById("controlBox").style.display = "flex";
      document.getElementById("timerBox").classList.add("idle");
      document.getElementById("beginBtn").style.display = "flex";
      document.getElementById("pauseBtn").style.display = "none";
      document.getElementById("continueBtn").style.display = "none";
      document.getElementById("stopBtn").style.display = "none";
      document.getElementById("todoBox").style.display = "flex";
      document.getElementById("mainBar").classList.remove("break");
      // 设置html最小宽度

      break;
    case "working":
      console.log("Work started");
      // setTomato(0);
      document.getElementById("tomatoBox").style.display = "block";
      document.getElementById("tomatoBody").style.display = "block";
      document.getElementById("breakIcon").style.display = "none";
      document.getElementById("timerBox").classList.remove("idle");
      document.getElementById("timerNum").style.display = "block";
      document.getElementById("controlBox").style.display = "";
      document.getElementById("beginBtn").style.display = "none";
      document.getElementById("pauseBtn").style.display = "flex";
      document.getElementById("continueBtn").style.display = "none";
      document.getElementById("stopBtn").style.display = "flex";
      document.getElementById("todoBox").style.display = "flex";
      document.getElementById("mainBar").classList.remove("break");
      // 设置页面最小宽度
      document.documentElement.style.minWidth = "";
      break;
    case "workPaused":
      console.log("Work paused");
      setTomato(clock.config.progress);
      document.getElementById("timerNum").style.display = "block";
      document.getElementById("beginBtn").style.display = "none";
      document.getElementById("pauseBtn").style.display = "none";
      document.getElementById("continueBtn").style.display = "flex";
      document.getElementById("stopBtn").style.display = "flex";
      break;
    case "breaking":
      console.log("Break started");

      document.getElementById("tomatoBox").style.display = "none";
      document.getElementById("tomatoBody").style.display = "block";
      document.getElementById("breakIcon").style.display = "block";

      document.getElementById("timerNum").style.display = "block";

      document.getElementById("beginBtn").style.display = "none";
      document.getElementById("pauseBtn").style.display = "flex";
      document.getElementById("continueBtn").style.display = "none";
      document.getElementById("stopBtn").style.display = "flex";

      document.getElementById("mainBar").classList.add("break");
      document.getElementById("todoBox").style.display = "none";
      break;
    case "breakPaused":
      console.log("Break paused");
      document.getElementById("tomatoBox").style.display = "none";
      document.getElementById("tomatoBody").style.display = "block";
      document.getElementById("breakIcon").style.display = "block";
      document.getElementById("timerNum").style.display = "block";
      // document.getElementById("timerNum").textContent = '已暂停';
      // document.getElementById("timerNum").style.fontWeight = '500';
      // document.getElementById("timerNum").style.color = '#00000022';
      document.getElementById("beginBtn").style.display = "none";
      document.getElementById("pauseBtn").style.display = "none";
      document.getElementById("continueBtn").style.display = "flex";
      document.getElementById("stopBtn").style.display = "flex";
      document.getElementById("mainBar").classList.add("break");
      break;
  }
};

let lastProgress = 0;
clock.onWorkTick = function () {
  if (this.config.progress != lastProgress || this.config.progress == 0) {
    lastProgress = this.config.progress;

    setTomato(this.config.progress);
  }
};

let waitResponse = false;

async function sendMessageAndWaitingCallback(message) {
  waitResponse = true;
  sendMessageToIndex(message);
  while (waitResponse) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return Promise.resolve();
}

function tomatoFallingAni() {
  return new Promise((resolve) => {
    const tomato = document.getElementById("tomato");
    tomato.classList.remove("tomatoSwing");
    tomato.classList.add("tomatoFalling");
    setTimeout(() => {
      tomato.classList.remove("tomatoFalling");
      tomato.classList.add("tomatoSwing");
      resolve();
    }, 1000);
  });
}

clock.onWorkEnd = async function () {
  const progress = Math.round(this.config.progress * 10) / 10;
  const duration = this.config.totalTime;

  document.getElementById("mainBar").classList.add("waiting");

  if (utools.dbStorage.getItem("settings").soundEffect) {
    var audio = new Audio("../../audio/353206__rhodesmas__intro-01.aac");
    audio.play();
  }
  
  await sendMessageAndWaitingCallback({ type: "workEnd", content: { duration, progress } });
  await tomatoFallingAni();
  sendMessageToIndex({ type: "tomatoFalling", content: { duration, progress } });
  document.getElementById("mainBar").classList.remove("waiting");



  return Promise.resolve();
};

clock.onBreakEnd = async function () {
  // 记录统计数据
  // todoManger_.recordStatistics(this.isLongBreak() ? this.config.longBreakTime : this.config.shortBreakTime, this.isLongBreak() ? "longBreak" : "shortBreak", Math.round(this.config.progress * 10) / 10);

  document.getElementById("mainBar").classList.add("waiting");


  if (utools.dbStorage.getItem("settings").soundEffect) {
    var audio = new Audio("../../audio/76405__dsp9000__old-church-bell.aac");

    audio.play();
  }


  await sendMessageAndWaitingCallback({
    type: "breakEnd",
    content: {
      duration: this.isLongBreak() ? this.config.longBreakTime : this.config.shortBreakTime,
      type: this.isLongBreak() ? "longBreak" : "shortBreak",
      progress: this.config.progress.toFixed(1),
    },
  });

  document.getElementById("mainBar").classList.remove("waiting");


};

function clockBegin() {
  clock.begin();
}

function clockPause() {
  clock.pause();
}

function clockContinue() {
  clock.continue();
}

function clockStop() {
  clock.stop();
}

function setOpacity(opacity) {
  document.getElementById("main").style.opacity = opacity;
}

// 初始化设置元素
// Ele_timeText.textContent = clock.formatTime();
// Ele_clockBox.classList = `clock ${clock.config.currentState}`;
clock.onStateChange();

// 监听通信
window.ipcRenderer.on("floatingWindow", (event, message) => {

  indexPageId = message.senderId;
  switch (message.type) {
    case "handshake":
      console.log(`握手成功: ${message.senderId}`);
      // 发送握手确认
      clock.continueState();
      break;
    case "updateTask":
      document.getElementById("taskTitle").innerText = message.content.id != -1 ? message.content.title : "行到水穷处，坐看云起时";
      document.getElementById("completeButton").style.display = message.content.id != -1 ? "flex" : "none";
      break;
    case "updateTag":
      document.getElementById("tag").innerText = `#${message.content}`;
      break;
    case "clockSettingChanged":
      clock.settingChanged(message.content);
      sendMessageToIndex({ type: "stateChange", content: clock.config.currentState, workTime: clock.getWorkTime() });
      break;
    case "audioSettingChanged":
      audioManager.updateAudioConfig(message.content);
      break;
    case "playAudioSettingChanged":
      audioManager.setPlayAndSync(message.content);
      break;
    case "opacityChange":
      setOpacity(message.content);
      break;
    case "callBackResponse":
      waitResponse = false;
      break;
    case "clockBegin":
      clockBegin();
      break;
    case "clockPause":
      clockPause();
      break;
    case "clockContinue":
      clockContinue();
      break;
    case "clockStop":
      clockStop();
      break;
  }
  sendMessageToIndex({ type: "messageReceived" });
});

function sendMessageToIndex(message, type = "floatingWindowToIndex") {
  indexPageId && window.ipcRenderer.sendTo(indexPageId, type, message);
}

// 打开主窗口
function openMainWindow() {
  utools.redirect("超级番茄", "");
}
// 完成任务
function doneTask() {
  sendMessageToIndex({ type: "doneTask" });
}

// 右键菜单
window.addEventListener("contextmenu", (e) => {
  console.log("contextmenu");
  e.preventDefault();
  sendMessageToIndex({ type: "contextmenu", content: { x: e.screenX, y: e.screenY } });
});

// 双击
document.addEventListener("dblclick", (e) => {
  console.log("dblclick");
  e.preventDefault();
  e.stopPropagation();
  openMainWindow();
});

const dragRegion = document.getElementById("mainBar");
let isDragging = false;
let startX, startY;
let hasDragged = false;
let windowWidth

dragRegion.addEventListener("mousedown", (e) => {

  
  // 标记开始拖动
  isDragging = true;
  hasDragged = false;


  // 记录鼠标相对于窗口左上角的起始位置
  startX = e.clientX;
  startY = e.clientY;
});

document.addEventListener(
  "mousemove",
  throttle((e) => {
    if (isDragging) {
      // 计算拖动的距离
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // 如果拖动距离超过4像素，才开始拖动动作
      if (!hasDragged && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
        // 标记已经拖动过
        hasDragged = true;
      }
      if (hasDragged) {
        // 计算窗口的新位置
        const newX = e.screenX - startX;
        const newY = e.screenY - startY;
        // 发送窗口的新位置

        sendMessageToIndex({ type: "drag", content: { x: newX, y: newY } });
      }
    }
  }, 1000 / 60)
);

document.addEventListener("mouseup", (e) => {
  isDragging = false;

  if (hasDragged) {
    console.log("Window has been dragged.");
    // hasDragged = false;
  }
});

// 添加节流函数
function throttle(fn, delay) {
  let lastTime = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastTime >= delay) {
      fn.apply(this, args);
      lastTime = now;
    }
  };
}

// 添加防抖函数
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

// 创建防抖后的resize处理函数
const handleResize = debounce(() => {
  console.log("Window has been resized.");
  sendMessageToIndex({ type: "resize" });
}, 1000);

// 使用防抖处理窗口大小变化
window.addEventListener("resize", () => {
  if (isDragging) {
    return;
  }
  handleResize();
});

// 使用事件委托来统一处理所有click事件
document.addEventListener(
  "click",
  (e) => {
    if (hasDragged) {
      // 如果已经拖动过，阻止click事件的进一步传播和默认行为
      e.stopImmediatePropagation();
      e.preventDefault();
      // 重置hasDragged标志
      hasDragged = false;
    }
  },
  true
); // 设置useCapture为true

document.getElementById("aniBox").addEventListener("mousemove", function (e) {
  const cursor = document.getElementById("animatedCursor");
  cursor.style.left = e.pageX + "px";
  cursor.style.top = e.pageY + "px";
});
document.getElementById("aniBox").addEventListener("mouseenter", function (e) {
  const cursor = document.getElementById("animatedCursor");
  if (document.getElementById("mainBar").classList.contains("break")) {
    cursor.src = "../../pic/hand.svg";
    cursor.style.animation = "";
  } else {
    cursor.src = "../../pic/sun.svg";
    cursor.style.animation = "cursorAnimation2 2.5s linear infinite";
  }

  cursor.style.display = "block";
});
document.getElementById("aniBox").addEventListener("mouseleave", function (e) {
  const cursor = document.getElementById("animatedCursor");
  cursor.style.display = "none";
});

// 屏蔽快捷键关闭窗口
document.addEventListener('keydown', (e) => {
  // 阻止 Ctrl/Cmd + W 关闭窗口
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
  }
  // 阻止 Alt + F4 关闭窗口
  if (e.altKey && e.key === 'F4') {
    e.preventDefault();
  }
});



if (!utools.isDev()) {
  console.log = console.info = console.error = console.warn = () => { };
  timeScale = 60 * 1000;
} else {
  timeScale = 1000;
}


var draging = false; // 是否正在拖拽
var taskMode = false; // 是否在任务编辑模式
var stopObserving = false;  // 是否停止观察
var editTaskId = null; // 当前编辑任务的id
var settingPageOpening = false; // 是否在设置页面

let isComposing = false; // 是否正在输入
let listenTagSelect = false; // 是否监听标签选择


const settings = new settingsConfig();


var clock_ = null;
var ubWindow = null;
var contextmenuWindow = null;


const Ele_clockBox = document.getElementById("clockBox");
const Ele_state = document.getElementById("state");
const Ele_timeText = document.getElementById("timeText");
const Ele_minutes = document.getElementById("minutes");
const Ele_seconds = document.getElementById("seconds");
const Ele_todayTomatosRedNum = document.getElementById("todayTomatosRedNum");
const Ele_todayTomatosYellowNum = document.getElementById("todayTomatosYellowNum");
const Ele_tagSelect = document.getElementById("hashSelect");


const Ele_listBox = document.getElementById("listBox");
const Ele_archivedList = document.getElementById("archivedList");
const Ele_todoList = document.getElementById("todoList");
const Ele_doneList = document.getElementById("doneList");
// const Ele_activeTip = document.getElementById("activeTip");
const Ele_todoList_card = document.getElementById("todoList_card");
const Ele_scale = document.getElementById("scale");

const Ele_anchorTop = document.getElementById("anchorTop");
const Ele_anchorBottom = document.getElementById("anchorBottom");
const Ele_whiteBoxTop = document.getElementById("whiteBoxTop");
const Ele_whiteBoxBottom = document.getElementById("whiteBoxBottom");

const Ele_editTag = document.getElementById("inputTag");
const Ele_editingIcon = document.getElementById("editingIcon");

const Ele_settingPage = document.getElementById('settingPage');

const Ele_calendar = document.getElementById("calendar");


const Ele_calendarKey_totalDay = document.getElementById("calendarKey_totalDay");
const Ele_calendarKey_totalHour = document.getElementById("calendarKey_totalHour");
const Ele_calendarKey_totalTomato = document.getElementById("calendarKey_totalTomato");
const Ele_calendarKey_totalShortTar = document.getElementById("calendarKey_totalShortTar");
const Ele_longTarsGroupBox = document.getElementById("longTarsGroupBox");
const Ele_longTars_active = document.getElementById("longTars_active");
const Ele_longTars_done = document.getElementById("longTars_done");



// 获取今天的YYYY-MM-DD
let historyTimePoint = new Date().toISOString().slice(0, 10);





var colorList = [
  "#DADADA",
  "#FFBE73",
  "#BCD986",
  "#E2BCBC",
  "#A3D89A",
  "#FFC3A0",
  "#E4D7A7",
  "#B9CBBE",
  "#FFD1A0",
  "#C7D3D4",
  "#E8C6A7",
  "#D8BFD8",
  "#C1E1C1",
  "#FFDAB9"
];


// 排除特定的按键
const excludedKeys = new Set([
   'Shift', 'Control', 'Alt', 'Pause', 'CapsLock', 'Escape',
  'PageUp', 'PageDown', 'End', 'Home', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
  'Insert', 'Delete', 'Meta', 'ContextMenu',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'NumLock', 'ScrollLock'
]);


let currentState = 'idle';

let settingsPageComponent = {}
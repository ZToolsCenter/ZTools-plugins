class todoListManger {
  constructor(type) {
    this.type = type;
    this.defaultTaskList = {
      archived: [],
      done: [],
      current: [],
      currentId: 0,
      statistics: [],
      longTagList: {
        0: { name: "默认", color: "#DADADA", state: "active" },
        1: { name: "考上研", color: "#FFBE73", state: "active" },
        2: { name: "瘦二十斤", color: "#BCD986", state: "active" },
        3: { name: "赚20万", color: "#E2BCBC", state: "active" },
      },
      currentLongTarId: 4,
      defaultTask: {
        id: -1,
        title: "",
        type: "long",
        state: "待办", //待办、进行中、完成、删除
        createdTimestamp: 0,
        modifiedTimestamp: 0,
        beginTimestamp: 0,
        endTimestamp: 0,
        doneTimestamp: 0,
        tag: 0,
        priority: 0,
        star: false,
        tomato: {},
      },
    }


    this.TaskList = null;
    this.getTaskList();

    this.onChange = () => { }; // 用于监听配置变化
    this.onActiveTaskChange = () => { }; // 用于监听当前任务变化
    this.onTomatoFinish = () => { }; // 用于监听番茄钟完成
    this.onUpdate = () => { }; // 用于监听更新
    this.onLongTarUpdate = () => { }; // 用于监听长标签更新
    this.onActiveTaskInfoChange = () => { }; // 用于监听当前任务信息变化
    let lastActiveTask = this.getActiveTask();
  }

  /**
   * 获取配置
   */
  getTaskList() {
    let TaskList = utools.dbStorage.getItem(this.type);
    if (!TaskList) {
      TaskList = this.defaultTaskList;
      this.saveTaskList(TaskList); // 只有在第一次初始化时保存默认配置
    } else {
      this.TaskList = TaskList; // 直接使用存储的配置
    }
  }

  /**
   * 保存配置
   */
  saveTaskList(TaskList) {
    utools.dbStorage.setItem(this.type, TaskList);
    this.TaskList = TaskList;
  }

  /**
   * 添加任务
   */
  add(todo) {
    let currentId = this.TaskList.currentId; // 创建一个临时变量存储 currentId 的值
    todo.id = currentId; // 使用临时变量的值赋给 todo.id
    todo.createdTimestamp = Date.now(); // 设置任务的创建时间戳
    todo.tomato = {}; // 初始化 tomato 属性

    // 使用 JSON.parse(JSON.stringify(todo)) 深拷贝 todo 对象
    this.TaskList.current.push(JSON.parse(JSON.stringify(todo)));
    // this.TaskList.longTagList[todo.tag].shortTar.add(currentId);

    this.TaskList.currentId++; // currentId 自增
    this.saveTaskList(this.TaskList);
    this.onTomatoFinish();
    this.onChange(); // 调用监听函数
  }

  /**
   * 删除任务
   */
  remove(id) {
    // 删除 longTagList 中对应的 shortTar
    const longTarId = this.TaskList.current.find((todo) => todo.id === id).tag;
    // this.TaskList.longTagList[longTarId].shortTar.delete(id);
    this.TaskList.current = this.TaskList.current.filter((todo) => todo.id !== id);

    this.saveTaskList(this.TaskList);
    this.onChange(); // 调用监听函数
  }

  /**
   * 完成任务
   */
  done(id) {
    if (id == -1) return;

    // console.log(task)
    const todo = this.TaskList.current.find((todo) => todo.id == id);
    this.TaskList.current = this.TaskList.current.filter((todo) => todo.id != id);
    todo.doneTimestamp = Date.now();
    this.TaskList.done.push(todo);
    this.saveTaskList(this.TaskList);
    this.onChange(); // 调用监听函数
  }

  /**
   * 将某任务移动到列表的指定位置
   */
  move(id, list, index) {
    const todo = this.TaskList[list].find((todo) => todo.id == id);
    this.TaskList[list] = this.TaskList[list].filter((todo) => todo.id != id);
    this.TaskList[list].splice(index, 0, todo);
    this.saveTaskList(this.TaskList);
    this.onChange(); // 调用监听函数
  }

  /**
   * 更新任务
   */
  update(id, title, tag) {
    // 定位到要更新的任务，不论是在 current、done 还是 archived 列表中
    const todo = this.TaskList.current.find((todo) => todo.id === id) || this.TaskList.done.find((todo) => todo.id === id) || this.TaskList.archived.find((todo) => todo.id === id);
    // 更新任务的标题和标签
    todo.title = title;
    todo.tag = tag;
    // 记录修改时间
    todo.modifiedTimestamp = Date.now();
    // 保存更新后的任务列表
    this.saveTaskList(this.TaskList);
    // 调用监听函数



    this.onUpdate(id, title, tag);

    if(id == this.getActiveTask().id){
      this.onActiveTaskInfoChange();
    }

    // this.onChange();
  }

  /**
   * 更新长标签
   */
  updateLongTar(id, title = null, state = null, color = null) {
    // id装换为数字
    id = Number(id);

    title == null ? null : this.TaskList.longTagList[id].name = title;
    state == null ? null : this.TaskList.longTagList[id].state = state;
    color == null ? null : this.TaskList.longTagList[id].color = color;

    this.saveTaskList(this.TaskList);
    this.onLongTarUpdate();
    // this.onChange();
  }

  /**
   * 添加长标签
   */
  addLongTar() {


    // 添加新的长标签
    this.TaskList.longTagList[this.TaskList.currentLongTarId++] = { name: " ", color: "#DADADA", state: "active" };
    this.saveTaskList(this.TaskList);
    this.onLongTarUpdate();
  }

  /**
   * 激活任务
   */
  activeTask(id, listName) {
    // 检查指定的列表是否存在
    if (!this.TaskList[listName]) {
      throw new Error(`List ${listName} does not exist`);
    }
    // 在指定的列表中查找任务
    const todo = this.TaskList[listName].find((todo) => todo.id === id);
    // 如果任务不存在，抛出错误
    if (!todo) {
      throw new Error(`Task with id ${id} not found in list ${listName}`);
    }
    // 从指定的列表中移除任务
    this.TaskList[listName] = this.TaskList[listName].filter((todo) => todo.id !== id);
    // 记录修改时间
    todo.modifiedTimestamp = Date.now();

    // 将任务添加到 current 列表的第一个位置
    this.TaskList.current.unshift(todo);
    // 保存更新后的任务列表
    this.saveTaskList(this.TaskList);
    // 调用监听函数
    this.onChange();
  }

  /**
   * 获取当前任务
   */
  getActiveTask() {
    if (this.TaskList.current.length == 0) return this.TaskList.defaultTask

    return this.TaskList.current[0];
  }

  /**
   * 监听当前任务变化
  */
  isActivedTaskChanged() {
    const currentActiveTask = this.getActiveTask();
    if (currentActiveTask !== this.lastActiveTask) {
      this.lastActiveTask = currentActiveTask;
      this.onActiveTaskChange(currentActiveTask);
    }
  }
  /**
   * 完成当前任务
   */
  compltedActiveTask() {
    const task = this.getActiveTask();
    this.done(task.id);
  }

  /**
   * 记录统计数据
   * @param {number} duration - 番茄钟持续时间(毫秒)
   * @param {string} type - 类型('work'|'shortBreak'|'longBreak')
   * @param {number} progress - 完成度(0-1)
   */
  recordStatistics(duration, type, progress) {

    console.log("recordStatistics",duration, type, progress);
    const task = this.getActiveTask();
    const tarId = task.id;
    const longTarId = task.tag;
    const realDuration = duration * progress;

    this.TaskList.statistics.push({ endTimestamp: Date.now(), duration, realDuration, type, progress, tarId, longTarId });
    // console.log(this.TaskList.statistics);
  }

  /**
   * 统计今天完成和未完成任务的数量
   */
  statisticsTodayNum() {
    // 获取今天的开始时间
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0); // 设置为今天的0点0分0秒

    // 初始化完成和未完成任务的计数
    let red = 0;
    let yellow = 0;
    let totalFocusTime = 0; // 初始化总专注时间（毫秒）



    // 反向遍历任务列表
    for (let i = this.TaskList.statistics.length - 1; i >= 0; i--) {
      const item = this.TaskList.statistics[i];
      if (item.endTimestamp < startOfDay.getTime()) {
        // 一旦发现早于今天开始的数据就结束遍历
        break;
      }
      if (item.type === "work" && item.endTimestamp >= startOfDay.getTime()) {
        // 只统计 type 为 'work' 且在今天的任务
        if (item.progress >= 0.9) {
          red++;
        } else {
          yellow++;
        }
        totalFocusTime += item.realDuration??0; // 累加专注时间
      }
    }

    // 将总专注时间转换为小时，保留1位小数
    // const focusHours = parseFloat((totalFocusTime / 3600000).toFixed(1));
    const focusHours = parseFloat((totalFocusTime / 6000).toFixed(1));
    // 返回一个对象，包含完成、未完成的数量和总专注时间
    return { red, yellow, focusHours };
  }

  /**
   * 统计今天完成和未完成任务的数量
   */
  allTodayTomatos(days = 1) {
    // 获取今天的开始时间
    const now = new Date();
    let startOfPeriod = new Date();

    if (days === 1) {
      // 设置为今天的0点0分0秒
      startOfPeriod.setHours(0, 0, 0, 0);
    } else if (days === 7) {
      // 找到最近的周日
      const dayOfWeek = now.getDay(); // 0是周日
      startOfPeriod.setDate(now.getDate() - dayOfWeek);
      startOfPeriod.setHours(0, 0, 0, 0);
    } else if (days === 30) {
      // 设置为本月1号的0点0分0秒
      startOfPeriod.setDate(1);
      startOfPeriod.setHours(0, 0, 0, 0);
    } else {
      throw new Error("Invalid parameter. Only 1, 7, and 30 are allowed.");
    }

    // 统计指定时间段内的任务并计算progress出现的次数
    const progressCount = {};

    // 反向遍历任务列表
    for (let i = this.TaskList.statistics.length - 1; i >= 0; i--) {
      const item = this.TaskList.statistics[i];

      if (item.endTimestamp < startOfPeriod.getTime()) {
        // 一旦发现早于开始时间的数据就结束遍历
        break;
      }

      if (item.type === "work" && item.endTimestamp >= startOfPeriod.getTime()) {
        // 只统计type为'work'且在指定时间段内的任务
        if (progressCount[item.progress] !== undefined) {
          progressCount[item.progress]++;
        } else {
          progressCount[item.progress] = 1;
        }
      }
    }

    return progressCount;
  }



  /**
   * 统计所有任务的统计数据
   */
  getWorkStatistics() {
    const workItems = this.TaskList.statistics.filter((item) => item.type === "work");

    // 计算总天数（用 endTimestamp 统计，去重）
    const uniqueDays = new Set(workItems.map((item) => new Date(item.endTimestamp).toDateString()));

    // 计算总时间（用 realDuration 加和，单位为小时，保留一位小数）
    const totalTime = workItems.reduce((sum, item) => sum + item.realDuration, 0) / 3600000;
    const totalTimeHours = totalTime.toFixed(1);

    // 计算总项数
    const totalItems = workItems.length;

    return {
      totalDay: uniqueDays.size,
      totalHour: parseFloat(totalTimeHours),
      totalTomato: totalItems,
      totalShortTar: this.TaskList.archived.length + this.TaskList.current.length + this.TaskList.done.length,
    };
  }

  /**
   * 查询指定 longTarId 对应的所有 type=work 的项
   */
  getWorkStatisticsByLongTarId(longTarId) {
    const filteredItems = this.TaskList.statistics.filter((item) => item.type == "work" && item.longTarId == longTarId);

    // 计算总时间（用 realDuration 加和，单位为小时，保留一位小数）
    const totalTime = filteredItems.reduce((sum, item) => sum + item.realDuration, 0) / 3600000;
    const totalTimeHours = totalTime.toFixed(1);

    // 计算总项数
    const totalItems = filteredItems.length;

    // 计算对应的 shortTar 数
    const subLists = ["current", "done", "archived"];
    let shortTarNum = 0;

    subLists.forEach((listName) => {
      if (this.TaskList[listName] && Array.isArray(this.TaskList[listName])) {
        shortTarNum += this.TaskList[listName].filter((task) => task.tag == longTarId).length;
      }
    });

    return {
      totalHour: parseFloat(totalTimeHours),
      totalTomato: totalItems,
      totalShortTar: shortTarNum,
    };
  }

  /**
   * 统计 type=work 的所有项的日期和数量分布
   */
  getWorkDateDistribution() {
    const workItems = this.TaskList.statistics.filter((item) => item.type === "work");

    // 创建日期、数量和持续时间分布的对象
    const dateDistribution = {};

    workItems.forEach((item) => {
      const date = `${new Date(item.endTimestamp).toISOString().split("T")[0]}`;
      if (!dateDistribution[date]) {
        dateDistribution[date] = { count: 0, totalDuration: 0 };
      }
      dateDistribution[date].count++;
      dateDistribution[date].totalDuration += item.realDuration;
    });

    return dateDistribution;
  }

  /**
   * 添加番茄到当前任务
   * @param {number} duration - 番茄钟预设时间(毫秒)
   * @param {number} progress - 完成度(0-1)
   */
  addTomatoToActiveTask(duration,progress) {
    const activeTask = this.getActiveTask();
    this.recordStatistics(duration, "work", progress);

    if (activeTask) {
      // 获取当前时间戳
      const currentTime = Date.now();

      // 如果键不存在，则创建一个空数组
      if (!activeTask.tomato[progress]) {
        activeTask.tomato[progress] = [];
      }

      // 将当前时间戳添加到对应的进度数组中
      activeTask.tomato[progress].push(currentTime);



      this.saveTaskList(this.TaskList);

      this.onChange();
    }
  }

  /**
   * 归档方法
   */
  archiveTasks() {
    const today = new Date();
    const todayTimestamp = today.setHours(0, 0, 0, 0); // 获取当天的零点时间戳
    const tasksToArchive = this.TaskList.done.filter((task) => task.doneTimestamp < todayTimestamp);
    this.TaskList.done = this.TaskList.done.filter((task) => task.doneTimestamp >= todayTimestamp);
    this.TaskList.archived.push(...tasksToArchive);
    this.saveTaskList(this.TaskList);
    this.onChange();
  }

  /**
   * 读取归档
   */
  readArchivedTasks(date) {
    const targetDate = new Date(date);
    const targetDateTimestamp = targetDate.setHours(0, 0, 0, 0); // 获取目标日期的零点时间戳
    const nextDayTimestamp = new Date(targetDateTimestamp + 86400000); // 获取目标日期的下一天零点时间戳

    const tasksForDate = this.TaskList.archived.filter((task) => task.doneTimestamp >= targetDateTimestamp && task.doneTimestamp < nextDayTimestamp);

    // 找出所有在目标日期之前的任务
    const earlierTasks = this.TaskList.archived.filter((task) => task.doneTimestamp < targetDateTimestamp);

    // 找到最近的更早任务的日期
    let nearestEarlierDate = null;
    if (earlierTasks.length > 0) {
      // 获取最接近目标日期的任务的时间戳
      const nearestEarlierTask = earlierTasks.reduce((prev, curr) => (curr.doneTimestamp > prev.doneTimestamp ? curr : prev));
      nearestEarlierDate = new Date(nearestEarlierTask.doneTimestamp).toISOString().substring(0, 10);
    }

    return {
      tasks: tasksForDate,
      hasEarlierTasks: earlierTasks.length > 0,
      nearestEarlierDate: nearestEarlierDate,
    };
  }
}

/**
 * 生成番茄盒子的HTML
 */
function generateTomatosBoxHtml(taskTomato) {
  // 创建一个空数组，用于存放带有时间戳和对应图片地址及尺寸的对象
  let tomatoList = [];

  // 遍历 taskTomato 对象
  for (const [key, timestamps] of Object.entries(taskTomato)) {
    const imgSrc = `../../pic/tomato_${String(key).replace(".", "")}.svg`;

    // 将时间戳和对应图片地址存入数组
    timestamps.forEach((timestamp) => {
      tomatoList.push({ key: parseFloat(key), timestamp, imgSrc });
    });
  }

  // 按时间戳对数组进行排序
  tomatoList.sort((a, b) => a.timestamp - b.timestamp);

  // 合并图片
  if (tomatoList.length > 8) {
    const mergedTomatoList = [];
    const keyGroups = {
      1: [],
      0.8: [],
      0.6: [],
      0.4: [],
    };

    // 将不同 key 的项目分组
    tomatoList.forEach((item) => {
      if (item.key === 1) {
        keyGroups[1].push(item);
      } else if (item.key >= 0.8) {
        keyGroups[0.8].push(item);
      } else if (item.key >= 0.6) {
        keyGroups[0.6].push(item);
      } else if (item.key >= 0.3) {
        keyGroups[0.4].push(item);
      }
    });

    // 计算每组的数量并创建新项
    for (const [key, items] of Object.entries(keyGroups)) {
      if (items.length > 0) {
        mergedTomatoList.push({ key: parseFloat(key), count: items.length, imgSrc: items[0].imgSrc });
      }
    }

    // 生成最终的 HTML 字符串
    let tomatosBoxHtml = "";
    mergedTomatoList.forEach((item) => {
      tomatosBoxHtml += `<span><img src="${item.imgSrc}" style="width:${item.key * 12 + 10}px; height:${item.key * 12 + 10}px;" />×${item.count}</span>`;


    });

    return tomatosBoxHtml;
  } else {
    // 生成最终的 HTML 字符串
    let tomatosBoxHtml = "";
    tomatoList.forEach((item) => {
      tomatosBoxHtml += `<img src="${item.imgSrc}" style="width:${item.key * 12 + 10}px; height:${item.key * 12 + 10}px;" />`;
    });

    return tomatosBoxHtml;
  }
}

const todoManger_ = new todoListManger("todoList");

todoManger_.onChange = function () {
  //   console.log("TaskList changed");
  // const scale = document.getElementById("scale");
  // scale.innerHTML = "";
  // let scaleId = 0;
  const doneList = document.getElementById("doneList");

  if (this.TaskList.done.length > 0) {
    doneList.innerHTML = `
    <div class=" date">
      <div class="scale">
      <div class="s short op" ></div>
      <div class="s short op" ></div>
      <div class="s mid op"   ></div>
      <div class="s short op" ></div>
      <div class="s short op" ></div>
      </div>
      <span>今天完成 ↓</span>
    </div>
    `;
  } else {
    doneList.innerHTML = "";
  }

  this.TaskList.done.forEach((task, index) => {
    let item = document.createElement("div");

    item.classList.add("taskItem");
    item.classList.add("done");

    item.setAttribute("taskId", task.id);

    let tag = "";
    if (this.TaskList.longTagList[task.tag] != undefined) {
      tag = `
        <div class="tags" style="background-color:${this.TaskList.longTagList[task.tag].color}">
            # ${this.TaskList.longTagList[task.tag].name}
        </div>`;
    }

    item.innerHTML = `            
            <div class="scale">
              <div class="s short op" ></div>
              <div class="s short op" ></div>
              <div class="s mid op"   ></div>
              <div class="s short op" ></div>
              <div class="s short op" ></div>
            </div>
            <div class="taskContent"> 
                ${tag}
                <div class="title">${task.title}</div>


                <div class="taskBtnBox">
                  <span taskId="${task.id}" onclick="activeTask(this,event)"   class="settopBtn">
                    <img src="../../pic/settop.svg" />
                  
                  </span> 
                </div>
                <div class="tomatos">
                ${generateTomatosBoxHtml(task.tomato)}
                </div>
            </div>`;

    item.addEventListener("dblclick", function (e) {
      fillEditBox(task, e);
    });
    doneList.appendChild(item);

  });

  const runingTaskTitle = document.createElement("div");
  runingTaskTitle.classList.add("date");
  runingTaskTitle.innerHTML = `
  <div class="scale">
    <div class="s short op" ></div>
    <div class="s short op" ></div>
    <div class="s mid op"   ></div>
    <div class="s short op" ></div>
    <div class="s short op" ></div>
  </div>
  <span>进行中 ↓</span>
  `;
  doneList.appendChild(runingTaskTitle);
  const todoList = document.getElementById("todoList");
  todoList.innerHTML = "";
  // console.log(this.TaskList.current);
  this.TaskList.current.forEach((task, index) => {
    let item = document.createElement("div");
    item.classList.add("taskItem");
    item.ondblclick = function (e) {
      fillEditBox(task, e);
    };

    item.setAttribute("taskId", task.id);

    let tag = "";
    if (this.TaskList.longTagList[task.tag] != undefined) {
      tag = `
        <div class="tags" style="background-color:${this.TaskList.longTagList[task.tag].color}">
            # ${this.TaskList.longTagList[task.tag].name}
        </div>`;
    }
    let scale = `
    <div class="scale">
        <div class="s short op" ></div>
        <div class="s short op" ></div>
        <div class="s mid   op"   ></div>
        <div class="s short op" ></div>
        <div class="s short op" ></div>
    </div>  
    `;
    if (index == 0) {
      scale = `
        <div class="scale">
            <div class="s short op" ></div>
            <div class="s short op" ></div>
            <div class="s long op"   ></div>
            <div class="s short op" ></div>
            <div class="s short op" ></div>
        </div>  
        `;
    }

    item.innerHTML = `       
    ${scale} 
    <div class="taskContent">
            ${tag}
        <div class="title">${task.title}</div>


        <div class="taskBtnBox">
          <span taskId="${task.id}" onclick="setTopTask(this,event)"   class="settopBtn">
            <img src="../../pic/settop.svg" />
          </span>
          <span taskId="${task.id}" onclick="deletTask(this,event)"    class="delBtn">
            <img src="../../pic/del.svg" />
          </span>
          <span taskId="${task.id}" onclick="compltedTask(this,event)" class="doneBtn">
            <img src="../../pic/done.svg" />
          </span> 
        </div>
        <div class="tomatos">
            ${generateTomatosBoxHtml(task.tomato)}
        </div>
    </div>`;

    if (taskMode) {
      setElementCanDrop(item);
    }

    todoList.appendChild(item);
  });

  if (this.TaskList.current.length == 0) {
    todoList.innerHTML = `
    <div class=" date">
      <div class="scale">
        <div class="s short op" ></div>
        <div class="s short op" ></div>
        <div class="s mid op"   ></div>
        <div class="s short op" ></div>
        <div class="s short op" ></div>
      </div>
      <span style="border:none;">未设小目标</span>
    </div>
    `;
  }

  let h = Ele_whiteBoxTop.offsetHeight + Ele_archivedList.offsetHeight + Ele_doneList.offsetHeight;

  if (taskMode) {
    Ele_listBox.scrollTo({
      top: h - 200,
      behavior: "smooth",
    });
  } else {
    Ele_listBox.scrollTo({
      top: h,
      behavior: "auto",
    });
  }

  this.isActivedTaskChanged();
};

todoManger_.onLongTarUpdate = function () {
  updateTaskTitle(this.getActiveTask());
}

todoManger_.onActiveTaskInfoChange = function () {
  updateTaskTitle(this.getActiveTask());
}


function compltedTask(element, event) {
  if (settings.config.soundEffect) {
    // 播放音乐
    const audio = new Audio("../../audio/achievement_s.aac");
    audio.play();
  }

  event.stopPropagation();
  const taskId = parseInt(event.target.getAttribute("taskId"));
  console.log(taskId);
  todoManger_.done(taskId);
}
function deletTask(element, event) {

  if(confirm("确定删除任务吗？\n删除后将无法恢复")){
    event.stopPropagation();
    const taskId = parseInt(event.target.getAttribute("taskId"));
    console.log(taskId);
    todoManger_.remove(taskId);
  }

}

function setTopTask(element, event) {
  event.stopPropagation();
  const taskId = parseInt(event.target.getAttribute("taskId"));
  console.log(taskId);
  todoManger_.activeTask(taskId, "current");
}

function activeTask(element, event) {
  event.stopPropagation();
  const taskId = parseInt(event.target.getAttribute("taskId"));
  console.log(taskId);
  todoManger_.activeTask(taskId, "done");
}
function activeTaskFromArchived(element, event) {
  event.stopPropagation();
  const taskId = parseInt(event.target.getAttribute("taskId"));
  console.log(taskId);
  todoManger_.activeTask(taskId, "archived");

  // 如果element.parentElement.parentElement.parentElement之前的兄弟元素是date，则删除
  if (element.parentElement.parentElement.parentElement.previousElementSibling.classList.contains("date")) {
    element.parentElement.parentElement.parentElement.previousElementSibling.remove();
  }

  element.parentElement.parentElement.parentElement.remove();
}

// 示例任务对象
// const task = {
//   title: "超时收费需求设计",
//   type: "long",
//   state: "待办", //待办、进行中、完成、删除
//   createdTimestamp: 1716480000000,
//   modifiedTimestamp: 1716480000000,
//   beginTimestamp: 1716480000000,
//   endTimestamp: 1716480000000 + 10,
//   doneTimestamp: 1716480000000 + 10,
//   remindBefore: [],
//   remindAfter: [],
//   tag: 0,
//   priority: 0,
//   star: false,
//   tomato: { 1: [1716480000000, 1716480000010], 0.5: [1716480000000, 1716480000010] },
// };
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本
// task.title = "整理办公桌上的文件";
// task.description = "将办公桌上的文件分类并归档，确保每个文件都有合适的位置。";
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "完成季度财务报告";
// task.description = "收集并分析本季度的财务数据，编写详细的报告并提交给财务总监。";
// task.tag = 2;
// task.doneTimestamp = 1716480000000 - 10;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// console.log(todoManger_.TaskList); // 检查TaskList的内容

// task.title = "参加客户需求评审会议";
// task.description = "与客户团队进行需求评审，记录会议纪要并整理客户的反馈。";
// task.tag = 2;
// task.doneTimestamp = 1716480000000 - 24 * 60 * 60 * 1000 - 10;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "拜访重要客户";
// task.description = "前往客户公司，与客户进行面对面的沟通，了解他们的最新需求和反馈。";
// task.tag = 3;
// task.doneTimestamp = 1716480000000 - 2 * 24 * 60 * 60 * 1000 - 10;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "完成代码审查";
// task.description = "对团队成员提交的代码进行审查，提供改进建议并确保代码质量。";
// task.tag = 3;
// task.doneTimestamp = 1716480000000 - 3 * 24 * 60 * 60 * 1000 - 10;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "撰写新项目的详细计划";
// task.description = "根据客户需求和团队能力，撰写详细的项目计划书，包括时间表和资源分配。";
// task.tag = 3;
// task.doneTimestamp = 1716480000000 - 4 * 24 * 60 * 60 * 1000 - 10;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "设计新产品的原型";
// task.description = "与设计团队合作，利用设计工具创建新产品的原型，并进行初步测试。";
// task.tag = 3;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "组织团队建设活动";
// task.description = "安排一次团队建设活动，选择地点、活动项目，并通知所有团队成员。";
// task.tag = 3;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "更新公司网站内容";
// task.description = "审核并更新公司网站上的内容，确保信息准确并添加最新的新闻和公告。";
// task.tag = 3;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "准备员工培训材料";
// task.description = "根据培训需求，准备详细的培训材料，包括PPT、手册和练习题。";
// task.tag = 3;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// task.title = "分析市场数据";
// task.description = "收集并分析最新的市场数据，撰写分析报告并提出市场策略建议。";
// task.tag = 3;
// todoManger_.add({ ...task }); // 使用扩展运算符创建任务的副本

// todoManger_.done(0); // 将id为0的任务标记为完成
// todoManger_.done(1); // 将id为0的任务标记为完成
// todoManger_.done(2); // 将id为0的任务标记为完成
// todoManger_.done(3); // 将id为0的任务标记为完成
// todoManger_.done(4); // 将id为0的任务标记为完成
// todoManger_.done(5); // 将id为0的任务标记为完成

todoManger_.archiveTasks(); // 将过期任务归档

function renderArchivedTasks(date, tasks) {
  // 渲染归档任务

  // const scale = document.getElementById("scale");
  const archivedList = document.getElementById("archivedList");

  tasks.reverse().forEach((task, index) => {
    let item = document.createElement("div");
    item.classList.add("taskItem");
    item.classList.add("done");
    item.ondblclick = function (e) {
      fillEditBox(task, e);
    };

    item.setAttribute("taskId", task.id);

    let tag = "";
    if (todoManger_.TaskList.longTagList[task.tag] != undefined) {
      tag = `
        <div class="tags" style="background-color:${todoManger_.TaskList.longTagList[task.tag].color}">
            # ${todoManger_.TaskList.longTagList[task.tag].name}
        </div>`;
    }

    item.innerHTML = `      
            <div class="scale">
              <div class="s short op" ></div>
              <div class="s short op" ></div>
              <div class="s mid op"   ></div>
              <div class="s short op" ></div>
              <div class="s short op" ></div>
            </div>      
            <div class="taskContent"> 
                            ${tag}
                <div class="title">${task.title}</div>

                <div class="taskBtnBox">
                  <span taskId="${task.id}" onclick="activeTaskFromArchived(this,event)"   class="settopBtn">
                    <img src="../../pic/settop.svg" />
                  </span> 
                </div>
                <div class="tomatos">
                ${generateTomatosBoxHtml(task.tomato)}
                </div>
            </div>`;

    // 插入任务项到最上方
    archivedList.insertBefore(item, archivedList.firstChild);


  });

  // 开头插入日期
  const dateElement = document.createElement("div");
  dateElement.classList.add("date");
  dateElement.innerHTML = `<div class="scale">
    <div class="s short op" ></div>
    <div class="s short op" ></div>
    <div class="s mid op"   ></div>
    <div class="s short op" ></div>
    <div class="s short op" ></div>
  </div>
  <span>${date.split("-")[1]}月${date.split("-")[2]}日 ↓</span>
  `;

  archivedList.insertBefore(dateElement, archivedList.firstChild);
}

const a = todoManger_.getWorkStatistics();
// console.log(a);

todoManger_.onUpdate = (id, title, tag) => {
  // 获取对应的标签属性taskid=id 的 element
  let element = document.querySelector(`.taskItem[taskid="${id}"]`);
  // 修改对应的文本和标签
  element.querySelector(".title").innerText = title;
  element.querySelector(".tags").style.backgroundColor = todoManger_.TaskList.longTagList[tag].color;
  element.querySelector(".tags").innerText = `#${todoManger_.TaskList.longTagList[tag].name}`;
};





async function updateTaskTitle(task) {

  floatingWindow.sendMessage({ type: "updateTask", content: task });
  floatingWindow.sendMessage({ type: "updateTag", content: task.tag in todoManger_.TaskList.longTagList ? todoManger_.TaskList.longTagList[task.tag].name : "" });

}


todoManger_.onActiveTaskChange = updateTaskTitle;
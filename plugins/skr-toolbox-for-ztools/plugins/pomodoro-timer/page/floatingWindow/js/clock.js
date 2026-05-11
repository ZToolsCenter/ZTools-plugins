/**
 * 番茄钟时钟类
 * 计时器和状态机
 */
class TomatoClock {
  constructor() {
    // 默认配置
    this.defaultConfig = {
      workTime: 30 * 60 * 1000, // 工作时间(30分钟)
      shortBreakTime: 5 * 60 * 1000, // 短休息时间(5分钟)
      longBreakTime: 15 * 60 * 1000, // 长休息时间(15分钟)
      autoStartBreak: true, // 工作结束自动开始休息
      autoStartWork: true, // 休息结束自动开始工作
      longBreakInterval: 4, // 每4个周期开始长休息
      currentState: "idle", // 当前状态(默认空闲)
      currentCycle: 0, // 当前周期数
      pauseLeftTime: 0, // 暂停剩余时间
      totalTime: 0, // 当前钟总时间
      pauseTimeFlag: false, // 是否暂停
      leftTime: 0, // 剩余时间
      progress: 0, // 进度
    };

    // 初始化配置
    this.config = null;
    this.settingChanged();
    this.getConfig();

    // 计时相关事件
    this.onTick = () => {}; // 读秒更新事件
    this.onWorkTick = () => {}; // 工作读秒更新事件
    this.onBreakTick = () => {}; // 休息读秒更新事件

    // 状态相关事件
    this.onIdle = () => {}; // 空闲状态事件
    this.onWorkStart = () => {}; // 工作开始事件
    this.onWorkEnd = () => new Promise((resolve) => resolve()); // 工作结束事件
    this.onWorkPause = () => {}; // 工作暂停事件
    this.onBreakStart = () => {}; // 休息开始事件
    this.onBreakEnd = () => new Promise((resolve) => resolve()); // 休息结束事件
    this.onBreakPause = () => {}; // 休息暂停事件
    this.onLive = () => {}; // 活动状态事件
    this.onStateChange = () => {}; // 状态变更事件

    // 计时器相关
    this.timer = null; // 计时器
    this.startTime = 0; // 时钟开始时间戳
    this.endTime = 0; // 时钟结束时间戳
    this.updateFlag = 0; // 更新标志
    this.config.startTime = 0;

    // 实例化事件
    this.onInstantiation = () => {};
    this.onInstantiation();

  }

  // 获取配置
  getConfig() {
    let config = utools.dbStorage.getItem("clock");
    if (!config) {
      config = this.defaultConfig;
    } else {
      // 合并默认配置
      config = { ...this.defaultConfig, ...config };
    }

    this.saveConfig(config);
    this.setCurrentState(config.currentState);
  }

  // 保存配置
  saveConfig(config=this.config) {
    utools.dbStorage.setItem("clock", config);
    this.config = config;
  }
  //
  async settingChanged(config = null) {

    console.log('settingChanged',config);
    if (config) {
      const newConfig = {
        workTime: config.workDuration * timeScale, // 默认工作时间为25分钟
        shortBreakTime: config.shortBreakDuration * timeScale, // 默认短休息时间为5分钟
        longBreakTime: config.longBreakDuration * timeScale, // 默认长休息时间为15分钟
        autoStartBreak: config.autoBreak, // 默认工作结束自动开始休息
        autoStartWork: config.autoWork, // 默认休息结束自动开始工作
        longBreakInterval: config.longBreakInterval, // 默认每4个周期开始长休息
      };

      this.setConfig(newConfig);
      return;
    }

    let settings = await utools.dbStorage.getItem("settings");
    console.log("settingChanged:", settings);
    this.setConfig({
      workTime: settings.workDuration * timeScale, // 默认工作时间为25分钟
      shortBreakTime: settings.shortBreakDuration * timeScale, // 默认短休息时间为5分钟
      longBreakTime: settings.longBreakDuration * timeScale, // 默认长休息时间为15分钟
      autoStartBreak: settings.autoBreak, // 默认工作结束自动开始休息
      autoStartWork: settings.autoWork, // 默认休息结束自动开始工作
      longBreakInterval: settings.longBreakInterval, // 默认每4个周期开始长休息
      
    });
  }

  // 设置参数
  setConfig(newConfig) {
    // 只更新传入的属性
    for (let prop in newConfig) {
      if (prop in this.config) {
        this.config[prop] = newConfig[prop];
      }
    }

    this.saveConfig();
    // if ("currentState" in newConfig) {
    //     this.setCurrentState(this.config.currentState, true);
    // }
    console.log("setConfig:", this.config);
  }

  // 设置当前状态
  setCurrentState(state, force = false) {
    const oldState = this.config.currentState;
    this.config.currentState = state;
    if (oldState === state && !force) return;
    switch (state) {
      case "idle":
        this.config.currentCycle = 0;
        this.onIdle();
        break;
      case "working":
        // this.config.currentCycle++;
        this.onWorkStart();
        this.onLive();
        break;
      case "workPaused":
        this.onWorkPause();
        this.onLive();
        break;
      case "breaking":
        this.onBreakStart();
        this.onLive();
        break;
      case "breakPaused":
        this.onBreakPause();
        this.onLive();
        break;
    }
    this.onStateChange();
    this.saveConfig();
  }

  // 接续状态
  continueState() {
    console.log("continueState:", this.config.currentState);
    this.onTick();
    switch (this.config.currentState) {
      case "idle":
        this.onIdle();
        break;
      case "working":
        this.onWorkStart();
        this.countdown();
        break;
      case "workPaused":
        this.onWorkPause();
        console.log("workPaused");
        break;
      case "breaking":
        this.onBreakStart();
        this.countdown();
        break;
      case "breakPaused":
        this.onBreakPause();
        break;
    }

    // this.setCurrentState(this.config.currentState,true);
    this.config.pauseTimeFlag = true;
    // this.countdown();
    this.onStateChange();
  }

  // 从头开始
  begin() {
    console.log("begin");

    this.setCurrentState("working", true);
    this.config.pauseLeftTime = 0;
    this.config.pauseTimeFlag = false;
    // this.config.leftTime = this.workTime;
    this.countdown();
  }

  // 暂停
  pause() {
    if (!this.isActive()) return; // 如果不在工作或休息中,则不触发暂停事件
    this.setCurrentState(this.isWorking() ? "workPaused" : "breakPaused");
    this.recordPauseTime();
    this.config.pauseTimeFlag = true;
    this.stopCountdown();
  }

  recordPauseTime() {
    this.config.pauseLeftTime = this.config.timeLeft;
    switch (this.config.currentState) {
      case "working":
      case "workPaused":
        this.config.pauseTotalTime = this.config.workTime;
        break;
      case "breaking":
      case "breakPaused":
        this.config.pauseTotalTime = this.config.currentCycle % this.config.longBreakInterval === 0 ? this.config.longBreakTime : this.config.shortBreakTime;
        break;
    }
  }

  // 继续
  continue() {
    if (!this.isPaused()) return; // 如果已经在工作或休息中,则不重新开始计时
    console.log("continue");
    this.setCurrentState(this.isWorking() ? "working" : "breaking");
    this.countdown();
  }

  // 结束当前
  stop() {
    if (!this.isActive()) return; // 如果不在工作或休息中,则不触发结束事件

    this.config.pauseLeftTime = 0;
    this.config.pauseTimeFlag = false;
    if (this.isWorking()) {
      this.stopCountdown();
      this.switchState();
    } else {
      this.stopCountdown();
      this.setCurrentState("idle");
    }
  }

  // 刷新时间
  refreshTime() {
    if (!this.isActive()) return 0;
    this.config.timeLeft = Math.max(this.config.endTime - Date.now(), 0);
    this.config.progress = parseFloat((1 - this.config.timeLeft / this.config.totalTime).toFixed(2));
    this.recordPauseTime();
    // this.updateFlag++;
    // if (this.updateFlag > 20) {
    //   this.updateFlag = 0;
    //   this.saveConfig();
    // }
  }

  // 倒计时
  countdown() {
    this.stopCountdown();
    if (this.config.pauseTimeFlag) {
      this.config.totalTime = this.config.pauseTotalTime;
    } else {
      switch (this.config.currentState) {
        case "working":
        case "workPaused":
          this.config.totalTime = this.config.workTime;
          break;
        case "breaking":
        case "breakPaused":
          console.log("currentCycle:", this.config.currentCycle, this.config.longBreakInterval, this.config.currentCycle % this.config.longBreakInterval);
          this.config.totalTime = this.config.currentCycle % this.config.longBreakInterval === 0 ? this.config.longBreakTime : this.config.shortBreakTime;
          break;
      }
    }
    if (this.config.pauseTimeFlag) {
      this.config.endTime = Date.now() + this.config.pauseLeftTime; // 记录时间点往前推
      this.config.pauseTimeFlag = false;
      console.log("使用当前往前推剩余时间的时间点");
    } else {
      this.config.endTime = this.config.startTime + this.config.totalTime;
      console.log("使用当前周期往前推总时间的时间点");
    }
    this.endTime = this.config.endTime + 500;

    this.refreshTime();
    this.timer = setInterval(() => {
      this.refreshTime();

      // 事件触发
      // 只在秒数变化时触发 onTick
      const currentSeconds = Math.floor(this.config.timeLeft / 1000);
      if (!this.lastSeconds || this.lastSeconds !== currentSeconds) {
        this.lastSeconds = currentSeconds;
        this.onTick();
      }
      if (this.isWorking()) {
        this.onWorkTick();
      }
      if (this.isBreaking()) {
        this.onBreakTick();
      }

      if (this.config.timeLeft <= 0) {
        this.stopCountdown();
        this.switchState();
      }
    }, 100);
  }

  // 切换状态
  switchState() {
    this.config.pauseLeftTime = 0;
    this.config.pauseTimeFlag = false;

    // 判断是否在工作状态
    if (this.isWorking()) {
      this.config.currentCycle++;

      this.onWorkEnd().then(() => {
        // 动作完成后执行后续代码

        this.startBreak();
        if (!this.config.autoStartBreak) {
          this.pause();
        }

        this.saveConfig(); // 保存当前周期数
      });
    } else {
      this.onBreakEnd().then(() => {
        this.startWork();
        if (!this.config.autoStartWork) {
          this.pause();
        }

        this.saveConfig(); // 保存当前周期数
      });
    }
  }

  // 开始工作
  startWork() {
    this.setCurrentState("working");

    this.countdown();
    this.onTick();
  }

  // 开始休息
  startBreak() {
    this.setCurrentState("breaking");

    this.countdown();
    this.onTick();
  }

  // 停止倒计时
  stopCountdown() {
    this.config.startTime = Date.now();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 是否在工作
  isWorking() {
    return this.config.currentState === "working" || this.config.currentState === "workPaused";
  }

  // 是否在休息
  isBreaking() {
    return this.config.currentState === "breaking" || this.config.currentState === "breakPaused";
  }

  // 是否是长休息
  isLongBreak() {
    return this.isBreaking() && this.config.currentCycle % this.config.longBreakInterval === 0;
  }

  // 是否处于活跃状态(工作中或休息中)
  isActive() {
    return this.isWorking() || this.isBreaking();
  }
  // 是否处于暂停状态
  isPaused() {
    return this.config.currentState === "workPaused" || this.config.currentState === "breakPaused";
  }

  // 返回MM:SS格式的时间
  formatTime(time = this.config.timeLeft) {
    const timeSeconds = time / 1000;
    const minutes = Math.floor(timeSeconds / 60);
    const seconds = Math.floor(timeSeconds % 60);
    return {
      minutes: String(minutes).padStart(2, "0"),
      seconds: String(seconds).padStart(2, "0")
    };
  }

  getWorkTime(){
    return this.formatTime(this.config.workTime);
  }
}

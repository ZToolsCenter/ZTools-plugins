class settingsConfig {
  constructor() {
    this.defaultConfig = {
      workDuration: 30,
      shortBreakDuration: 5,
      longBreakDuration: 15,
      longBreakInterval: 4,
      autoWork: false,
      autoBreak: false,
      soundEffect: true,
      showSuccessPopup: false,

      showFloatingWindow: true,
      showTomatoAnimation: true,
      autoHideAni: false,
      tomatoBoxRange: 1,

      darkMode: "light",

      opacity: 1,

      playAudio: true,
      audioVolume_0: 0.5,
      audioVolume_1: 0.5,
      audioVolume_2: 0.5,
      audioVolume_3: 0.5,
      audioVolume_4: 0.5,
      audioVolume_5: 0.5,
      audioVolume_6: 0.5,
      audioVolume_7: 0.5,
      audioVolume_8: 0.5,
      audioVolume_9: 0.5,
      audioActive_0: true,
      audioActive_1: false,
      audioActive_2: false,
      audioActive_3: false,
      audioActive_4: false,
      audioActive_5: false,
      audioActive_6: false,
      audioActive_7: false,
      audioActive_8: false,
      audioActive_9: false,
    };
    this.config = null;


    this.getConfig();


    this.onchange = () => { }; // 状态变更事件

    this.onClockChange = () => { }; // 时钟变更事件

    this.onShowFloatingWindowChange = () => { }; // 浮窗显示变更事件
    this.onShowTomatoAnimationChange = () => { }; // 番茄动画显示变更事件
    this.onAutoHideAniChange = () => { }; // 自动隐藏动画变更事件

    this.onAudioConfigChange = () => { }; // 音频配置变更事件
    this.onPlayAudioChange = () => { }; // 播放音频变更事件
  }

  // 获取配置
  getConfig() {
    let config = utools.dbStorage.getItem("settings");
    if (!config) {
      config = this.defaultConfig;
    } else {
      // 合并默认配置
      config = { ...this.defaultConfig, ...config };
    }
    this.saveConfig(config);
  }

  // 保存配置
  saveConfig(config) {
    utools.dbStorage.setItem("settings", config);
    this.config = config;
  }



  // 更新配置
  updateConfig(key, value) {
    if (this.config[key] === value) return; // 如果配置没有变化，则不更新
        
    // 更新配置
    this.config[key] = value;
    this.saveConfig(this.config);
    this.onchange();

    // 根据具体属性触发对应的回调
    switch(key) {
      case 'showFloatingWindow':
        this.onShowFloatingWindowChange(value);
        return;
      case 'showTomatoAnimation':
        this.onShowTomatoAnimationChange(value);
        return;
      case 'autoHideAni':
        this.onAutoHideAniChange(value);
        return;
      case 'workDuration':
      case 'shortBreakDuration':
      case 'longBreakDuration':
      case 'longBreakInterval':
      case 'autoWork':
      case 'autoBreak':

        const clockConfig = {
          workDuration: this.config.workDuration,
          shortBreakDuration: this.config.shortBreakDuration,
          longBreakDuration: this.config.longBreakDuration,
          longBreakInterval: this.config.longBreakInterval,
          autoWork: this.config.autoWork,
          autoBreak: this.config.autoBreak,
        }

        this.onClockChange(clockConfig);
        return;
      case 'playAudio':
        this.onPlayAudioChange(value);
        return;
      case 'darkMode':
        this.onDarkModeChange(value);
        return;
      case 'opacity':
        this.onOpacityChange(value);
        return;
    }

    // 检测音频配置变更
    if (key.startsWith('audio') ) {


      this.onAudioConfigChange(this.getAudioConfig());
      return;
    }

  }

  // 获取音频配置
  getAudioConfig() {
    return {
        0:{
          audioVolume: this.config.audioVolume_0,
          audioActive: this.config.audioActive_0,
          pathName: audioList[0].pathName,
        },
        1:{
          audioVolume: this.config.audioVolume_1,
          audioActive: this.config.audioActive_1,
          pathName: audioList[1].pathName,
        },
        2:{
          audioVolume: this.config.audioVolume_2,
          audioActive: this.config.audioActive_2,
          pathName: audioList[2].pathName,
        },
        3:{
          audioVolume: this.config.audioVolume_3,
          audioActive: this.config.audioActive_3,
          pathName: audioList[3].pathName,
        },
        4:{
          audioVolume: this.config.audioVolume_4,
          audioActive: this.config.audioActive_4,
          pathName: audioList[4].pathName,
        },
        5:{
          audioVolume: this.config.audioVolume_5,
          audioActive: this.config.audioActive_5,
          pathName: audioList[5].pathName,
        },
        6:{
          audioVolume: this.config.audioVolume_6,
          audioActive: this.config.audioActive_6,
          pathName: audioList[6].pathName,
        },
        7:{
          audioVolume: this.config.audioVolume_7,
          audioActive: this.config.audioActive_7,
          pathName: audioList[7].pathName,
        },
        8:{
          audioVolume: this.config.audioVolume_8,
          audioActive: this.config.audioActive_8,
          pathName: audioList[8].pathName,
        },
        9:{
          audioVolume: this.config.audioVolume_9,
          audioActive: this.config.audioActive_9,
          pathName: audioList[9].pathName,
        },
    };
  }
}

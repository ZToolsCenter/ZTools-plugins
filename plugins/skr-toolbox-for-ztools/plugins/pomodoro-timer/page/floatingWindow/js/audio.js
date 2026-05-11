// AudioPlayer 类负责单个音频文件的播放控制
class AudioPlayer {
  constructor(musicName) {
    this.musicName = musicName;
    this.audio1 = new Audio(`../../audio/${musicName}`);
    this.audio2 = new Audio(`../../audio/${musicName}`);
    this.isFirstPlaying = true;
    this.volume = 1.0;

    this.audio1.volume = this.volume;
    this.audio2.volume = this.volume;

    // 绑定 this 到 handleTimeUpdate 和 handleError 方法
    this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
    this.handleError = this.handleError.bind(this);

    this.audio1.addEventListener("timeupdate", this.handleTimeUpdate);
    this.audio2.addEventListener("timeupdate", this.handleTimeUpdate);

    this.audio1.addEventListener("error", this.handleError);
    this.audio2.addEventListener("error", this.handleError);

    // this.audio1.play();
  }

  handleTimeUpdate() {
    if (this.isFirstPlaying) {
      if (this.audio1.currentTime > this.audio1.duration - 1) {
        this.audio2.currentTime = 0;
        this.audio2.play();
        this.isFirstPlaying = false;
      }
    } else {
      if (this.audio2.currentTime > this.audio2.duration - 1) {
        this.audio1.currentTime = 0;
        this.audio1.play();
        this.isFirstPlaying = true;
      }
    }
  }

  handleError(e) {
    console.error("音频播放错误:", e);
    setTimeout(() => {
      this.audio1.load();
      this.audio2.load();
      this.audio1.play();
    }, 1000);
  }

  play() {
    if (this.isFirstPlaying) {
      this.audio1.play();
    } else {
      this.audio2.play();
    }
  }

  pause() {
    this.audio1.pause();
    this.audio2.pause();
  }

  setVolume(volume) {
    this.volume = volume;
    this.audio1.volume = volume;
    this.audio2.volume = volume;
  }

  release() {
    this.audio1.pause();
    this.audio2.pause();
    this.audio1.removeEventListener("timeupdate", this.handleTimeUpdate);
    this.audio2.removeEventListener("timeupdate", this.handleTimeUpdate);
    this.audio1.removeEventListener("error", this.handleError);
    this.audio2.removeEventListener("error", this.handleError);
    this.audio1.src = "";
    this.audio2.src = "";
  }
}

// AudioManager 类负责管理多个 AudioPlayer 实例
class AudioManager {
  constructor() {
    this.players = {};
    // 添加播放状态属性
    this._isPlaying = false;
    this.onchange = () => { }; // 状态变更事件
  }

  // 添加播放状态的 getter 和 setter
  get isPlaying() {
    return this._isPlaying;
  }

  set isPlaying(value) {
    this._isPlaying = value;
    this.onchange(value);
    // 根据状态执行相应操作
    if (value) {
      this.playAll();
    } else {
      this.pauseAll();
    }
  }

  setPlayAndSync(value) {
    this.isPlaying = value;
    sendMessageToIndex({ type: "playAudio", content: { value } });
  }

  addAudio(musicName) {
    if (!this.players[musicName]) {
      this.players[musicName] = new AudioPlayer(musicName);
    } else {
      console.warn(`音频 "${musicName}" 已存在。`);
    }
  }

  removeAudio(musicName) {
    if (this.players[musicName]) {
      this.players[musicName].release();
      delete this.players[musicName];
    } else {
      console.warn(`音频 "${musicName}" 不存在。`);
    }
  }

  play(musicName) {
    if (this.players[musicName]) {
      this.players[musicName].play();
    } else {
      console.warn(`音频 "${musicName}" 不存在。`);
    }
  }

  pause(musicName) {
    if (this.players[musicName]) {
      this.players[musicName].pause();
    } else {
      console.warn(`音频 "${musicName}" 不存在。`);
    }
  }

  setVolume(musicName, volume) {
    if (this.players[musicName]) {
      this.players[musicName].setVolume(volume);
    } else {
      console.warn(`音频 "${musicName}" 不存在。`);
    }
  }

  playAll() {
    console.log("playAll");
    console.log(this.players);
    Object.values(this.players).forEach((player) => player.play());
    this._isPlaying = true;
  }

  pauseAll() {
    Object.values(this.players).forEach((player) => player.pause());
    this._isPlaying = false;
  }

  setVolumeAll(volume) {
    Object.values(this.players).forEach((player) => player.setVolume(volume));
  }

  releaseAll() {
    Object.values(this.players).forEach((player) => player.release());
    this.players = {};
  }

  updateAudioConfig(config) {
    // console.log("updateAudioConfig", config);
    // 处理需要移除的音频
    Object.keys(this.players).forEach(musicName => {
      const found = Object.values(config).some(
        item => item.pathName === musicName && item.audioActive
      );
      if (!found) {
        // console.log("音频存在，移除它", musicName);
        this.removeAudio(musicName);
      }
    });

    // 处理需要添加或更新的音频
    Object.values(config).forEach(({ pathName, audioVolume, audioActive }) => {
      if (audioActive) {
        // 如果音频不存在，添加它

        if (!this.players[pathName]) {
          // console.log("音频不存在，添加它", pathName);
          this.addAudio(pathName);
          this.setVolume(pathName, audioVolume);
          // 检测 isPlaying 状态
          if (this.isPlaying) {
            this.play(pathName);
          }
        } else {
          // console.log("音频存在，更新音量", pathName);
          // 如果音频存在，更新音量
          this.setVolume(pathName, audioVolume);
        }
      } 
    });
  }
}

// 使用示例
const audioManager = new AudioManager();

// 添加多个音频
// audioManager.addAudio("test.aac");
// audioManager.addAudio("353206__rhodesmas__intro-01.aac");



document.getElementById("musicBox").addEventListener("click", function() {
  const isActive = this.getAttribute("data-active") === "true";
  audioManager.setPlayAndSync(!isActive);
});

audioManager.onchange = (value) => {
  console.log("audioManager.onchange", value);
  document.getElementById("musicBox").setAttribute("data-active", String(value));
};




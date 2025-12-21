// 创建撒花效果实例
const confettiGun = new ConfettiGun();

// 创建音频对象
// https://pixabay.com/sound-effects/balloonpop-83760/
const confettiSound = new Audio('balloonpop.mp3');
// 设置音量大小 (0.0 到 1.0，0.5 表示 50% 音量)
confettiSound.volume = 0.5;

// 获取屏幕尺寸
const screenWidth = window.screen.width
const screenHeight = window.screen.height

// 配置撒花效果
var count = 200;
var defaults = {
    origin: { y: 0.8 }
};

// 存储所有的 confetti Promise
let confettiPromises = [];

// 获取设置
function getSettings() {
    return { soundEnabled: true };
}

function fire(particleRatio, opts) {
    // 保存返回的 Promise
    const promise = confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio)
    });

    confettiPromises.push(promise);
    return promise;
}

// 创建撒花效果
function shoot() {
    try {
        if (typeof confetti !== 'function') {
            ztools.showNotification("没有找到confetti库")
            return
        }

        // 获取设置并播放礼花声音
        const settings = getSettings();
        if (settings.soundEnabled) {
            try {
                confettiSound.currentTime = 0; // 重置音频播放位置
                confettiSound.play().catch(error => {
                    ztools.showNotification("播放声音失败:" + error.message)
                });
            } catch (error) {
                ztools.showNotification("音频播放出错:" + error.message)
            }
        }

        // 清空之前的 promises
        confettiPromises = [];

        // 执行撒花效果并收集所有 Promise
        const shootPromises = confettiGun.shootFromCorners();

        // 将返回的 Promise 数组添加到全局 Promise 数组中
        if (Array.isArray(shootPromises)) {
            confettiPromises.push(...shootPromises);
        }

        // 当所有 confetti 动画完成时，关闭窗口并退出插件
        Promise.all(confettiPromises)
            .then(() => {
                // ztools.showNotification('所有纸屑都落下了, 即将关闭窗口');
                // 所有纸屑都落下后执行
                try {
                    if (window.close) {
                        window.close()
                    }
                    ztools.outPlugin(true)
                } catch (error) {
                    ztools.showNotification('关闭窗口失败: ' + error.message, 'error')
                }
            })
            .catch(error => {
                ztools.showNotification('撒花效果出错: ' + error.message, 'error')
            });
    } catch (error) {
        ztools.showNotification('撒花效果执行失败: ' + error.message, 'error')
    }
}

// 等待页面完全加载后执行
window.addEventListener('load', () => {
    // 确保 confetti 库已加载
    if (typeof confetti === 'function') {
        shoot()
    } else {
        ztools.showNotification('confetti 库加载失败，请检查网络连接', 'error')
    }
}) 
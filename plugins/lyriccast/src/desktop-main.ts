/**
 * 桌面悬浮歌词窗口入口(dist/desktop.html 加载)。
 * 无 preload、无 WebSocket:状态由主窗口推送,按钮消息由主窗口轮询。
 */
import { createApp } from 'vue'
import './desktop.css'
import { applyDesktopState, desktopAction, drainDesktopMessages, desktopState } from './desktop-state'
import DesktopLyrics from './components/DesktopLyrics.vue'

// 主窗口 desktop-bridge 通过 executeJavaScript 调用这两个入口
;(window as any).__applyDesktopState = applyDesktopState
;(window as any).__drainDesktopMessages = drainDesktopMessages
// 页面内按钮直接进队列,不依赖任何跨窗口 API
;(window as any).__desktopAction = desktopAction

// dev 直接用浏览器打开 desktop.html 时,3s 后放一段演示状态便于预览;
// 真实环境(主窗口推送)下首次真实推送会立即覆盖
if (import.meta.env.DEV) {
  setTimeout(() => {
    if (desktopState.status === 'noplayback' && desktopState.lines.length === 0) {
      applyDesktopState({
        hovered: false,
        style: { fontSize: 26, theme: 'auto', align: 'left', translation: true, locked: false, opacity: 90, width: 870, height: 138, lineGap: 0, lineOffset: 0, customCss: '' },
        status: 'ok',
        track: { title: '夜色温柔 (Demo)', artist: '虚拟歌手' },
        lines: [
          '路灯连成一条 温柔的延长线',
          '把你我的影子 拉得很长很长',
          '晚风替我们收藏 未说完的话',
          '夜色温柔 得像你的目光',
          '时间在耳边 轻轻地唱'
        ],
        translations: [
          'Streetlights string a tender, endless line',
          'Stretching our shadows long and slow',
          'The night wind keeps the words we left unsaid',
          'The night is tender, like your gaze',
          'Time sings softly in our ears'
        ],
        activeIndex: 1,
        linesVersion: 1,
        offsetMs: 0,
        offsetScope: 'track',
        progress: { atMs: Date.now(), positionMs: 34_000, speed: 1, playing: true, durationMs: 96_000 }
      })
    }
  }, 3_000)
}

createApp(DesktopLyrics).mount('#app')

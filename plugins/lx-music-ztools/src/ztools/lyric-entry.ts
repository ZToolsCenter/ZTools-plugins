import './contracts'
if (!(globalThis as any).setImmediate) (globalThis as any).setImmediate = (callback: Function, ...args: any[]) => setTimeout(() => callback(...args), 0)
void import('../../vendor/lx/src/renderer-lyric/main').catch(error => {
  console.error('LX desktop lyrics failed', error)
  document.body.textContent = '桌面歌词启动失败：' + String(error.message || error)
})

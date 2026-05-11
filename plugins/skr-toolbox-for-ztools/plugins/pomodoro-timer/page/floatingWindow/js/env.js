let timeScale
// 环境变量
if (!utools.isDev()) {
    console.log = console.info = console.error = console.warn = () => { };
    timeScale = 60 * 1000;
  } else {
  timeScale = 1000;
}

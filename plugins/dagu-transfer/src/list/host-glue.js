// 把列表流程接到 ZTools 启动器：搜索框、上下键与回车、按内容高度调整插件视图高度。
// 列表由插件自己画，筛选和输入内容都用宿主的搜索框（setSubInput），做法与生态里的「VSCode 最近项目」插件一致。

// 宿主把插件视图的高度上限设在 541px，超出后由列表自己滚动。
const MAX_VIEW_HEIGHT = 541;

// 文档写的是 (text)，实际收到的是 { text }，两种都兼容。
const subInputText = (details) => (typeof details === 'string' ? details : details?.text ?? '');

export function attachListToHost(flow, host, element) {
  // 初始值与流程的空闲状态一致：组件挂载时不应该触发任何宿主调用。
  let placeholder = '';
  let stepTick = 0;

  // 流程进入任何阶段后，上下键与回车都交给流程处理，包括搜索框被收起之后（下载中、失败、完成），
  // 否则失败后无法回车重试。
  const active = () => flow.state.phase !== 'idle';

  const fitHeight = () => {
    if (!element || !active()) return;
    const height = element.offsetHeight + 8;
    if (height > 8) host?.setExpendHeight?.(Math.min(height, MAX_VIEW_HEIGHT));
  };
  // 等浏览器完成布局再量高度：连续两帧可避开「同一帧内测量早于样式生效」的竞争。
  const scheduleFit = () => requestAnimationFrame(() => requestAnimationFrame(fitHeight));

  const apply = (state) => {
    if (state.placeholder !== placeholder) {
      placeholder = state.placeholder;
      if (placeholder) host?.setSubInput?.((details) => flow.search(subInputText(details)), placeholder);
      else host?.removeSubInput?.();
    }
    // 每进入一个步骤，把搜索框设成这一步应有的内容并整段选中：上一步留下的文字被清掉或替换，
    // 用户接着粘贴或输入时也会直接替换掉框里已有的内容。宿主设置搜索框后会把它回传给流程。
    if (state.stepTick !== stepTick) {
      stepTick = state.stepTick;
      host?.setSubInputValue?.(state.boxValue ?? '');
      host?.subInputSelect?.();
    }
    scheduleFit();
  };

  const onKeydown = (event) => {
    // 输入法组字期间的回车是在选词，不是在确认。
    if (!active() || event.defaultPrevented || event.isComposing) return;
    if (event.key === 'ArrowDown') flow.move(1);
    else if (event.key === 'ArrowUp') flow.move(-1);
    else if (event.key === 'Enter') flow.activate();
    else return;
    event.preventDefault();
  };

  const unsubscribe = flow.subscribe(apply);
  document.addEventListener('keydown', onKeydown);
  apply(flow.state);

  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKeydown);
  };
}

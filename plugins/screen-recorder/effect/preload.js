window.getUser = () => {
  return {
    type: 'member',
    avatar: 'https://res.u-tools.cn/assets/avatars/avatar.png',
    nickname: '会员',
  }
}

const addon = require(`./${process.platform}-${process.arch}.node`);
window.PARENT_PAYLOAD = JSON.parse(decodeURIComponent(window.location.search.substring(1)));
window.PARENT_PAYLOAD.effect && addon.hookEvent(window.PARENT_PAYLOAD.effect, (...e) => { 
  console.log(e);
  if(e[0] === 'F10') {
    window.ztools.sendToParent('stopRecord');
  }
  if (window.triggerMouseEvent) return "number" == typeof e[0] ? window.triggerMouseEvent(...e) : void ("string" == typeof e[0] && window.triggerKeyboardEvent(...e)) 
  });
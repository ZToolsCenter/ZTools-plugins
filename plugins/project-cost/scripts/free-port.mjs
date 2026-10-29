/**
 * UI 自验套件共用：端口动态分配。
 *
 * 背景（真实事故，不是假想）：全仓 8 个 UI 套件原先把「静态服务器端口（82xx）」和
 * 「Chrome 远程调试端口（92xx）」写死在各自文件里。多人 / 多进程并行跑时，两个套件
 * 撞到同一个端口 → `srv.listen()` 的回调**永远不触发** → 套件挂到看门狗超时 →
 * stdout 一条 PASS/FAIL 都没有 → 编排器只看 `fail === 0`，把它画成 ✓，整轮回归看起来
 * 全绿，实际少跑了一整个套件。**这是会漏真问题的假通过。**
 *
 * 根因是端口写死，所以这里改成：首选号能用就用，不能用就让操作系统临时分配一个。
 *
 * 关于「先探测，后使用」的竞态（已知取舍）：
 *   Chrome 的 `--remote-debugging-port` **不接受 0**（传 0 它不会自己挑一个端口），
 *   所以只能先探测出一个确定空闲的端口号，再把它传给 Chrome。探测用的 socket 在拿到
 *   结果后立刻 close，到 Chrome 真正 bind 之间存在一个极小的窗口，理论上另一个进程
 *   可能抢先占掉。这个窗口是毫秒级、且只在「同一瞬间有多个套件启动」时才可能出现；
 *   真撞上了，`Page.navigate` 之前的 `/json/version` 轮询会拿不到调试端口，套件会
 *   走「Chrome 调试端口未就绪」这条显式 FAIL 分支 —— 仍然是**失败**，不会退化成假通过。
 *   相比写死端口必然撞车，这个取舍是划算的。
 *
 * 静态服务器那一路没有这个竞态：`listenServer()` 直接在**要长期占用的那个 server**
 * 上试绑首选端口，失败就原地改绑 0（OS 分配），一次 bind、不探测、不 close。
 */
import net from 'node:net';

/** 只在本机回环上探测：既不外泄调试端口，也不会被局域网里的其它机器干扰。 */
const HOST = '127.0.0.1';

/** 这些错误码的含义都是「这个号现在不能用，换一个再试」，而不是「代码写错了」。 */
const RETRYABLE = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL']);

/**
 * 单次绑定：成功即返回 **实际绑定的端口号** 并关闭探测 socket。
 * @param {number} port 0 表示让 OS 分配一个空闲端口
 * @param {string} host 绑定地址，默认 127.0.0.1
 * @returns {Promise<number>} 实际绑定的端口
 */
function bindOnce(port, host) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, host, () => {
      const actual = probe.address()?.port || port;
      probe.close(() => resolve(actual));
    });
  });
}

/**
 * 探测一个「此刻可用」的端口号。
 *
 * 先试 `preferred`；被占（EADDRINUSE 等）就退让到 OS 分配的临时端口。
 * 返回的端口在**返回时**是空闲的，但不保证之后仍空闲（见文件头的竞态说明）。
 *
 * @param {number} preferred 首选端口号；<=0 或省略时直接使用 OS 临时端口
 * @param {string} [host] 绑定地址，默认 127.0.0.1
 * @returns {Promise<number>} 可用的端口号
 */
export async function pickPort(preferred = 0, host = HOST) {
  if (preferred > 0) {
    try {
      return await bindOnce(preferred, host);
    } catch (e) {
      if (!RETRYABLE.has(e?.code)) throw e;
      // 首选号被占：落到 OS 临时端口
    }
  }
  return bindOnce(0, host);
}

/**
 * 让一个**要长期占用**的 server（如套件自带的静态服务器）监听端口。
 *
 * 与 `pickPort` 的区别：不在探测 socket 上试，而是直接在目标 server 上试绑首选端口，
 * 撞了就在同一个 server 上改绑 0 —— 一次 bind 到位，探测与占用之间没有窗口。
 *
 * @param {net.Server} srv 已 createServer 但尚未 listen 的实例
 * @param {number} preferred 首选端口号；<=0 时直接用 OS 临时端口
 * @param {string} [host] 绑定地址，默认 127.0.0.1
 * @returns {Promise<net.Server>} 已 listen 的 server（真实端口取 `srv.address().port`）
 */
export function listenServer(srv, preferred = 0, host = HOST) {
  return new Promise((resolve, reject) => {
    let fellBack = false;
    const onError = (e) => {
      // 已经退让过一次还失败、或非「端口不可用」类错误：如实抛给调用方
      if (fellBack || !RETRYABLE.has(e?.code) || !(preferred > 0)) { reject(e); return; }
      fellBack = true;
      srv.once('error', reject);
      try {
        srv.listen(0, host, () => resolve(srv));
      } catch (e2) {
        reject(e2);
      }
    };
    srv.once('error', onError);
    try {
      srv.listen(preferred > 0 ? preferred : 0, host, () => resolve(srv));
    } catch (e) {
      onError(e);
    }
  });
}

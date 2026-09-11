// 清理残留的 dev-server / api-server 进程（5273 / 4456）
// 用法: node scripts/cleanup-dev-servers.cjs
// 背景: pnpm dev:browser 经 concurrently 在 Windows 上可能留下孤儿进程，
//       占用端口导致 pnpm test:e2e 复用错误的服务器或启动失败。
const { execSync } = require('child_process');

const ports = [5273, 4456];

for (const port of ports) {
  let out;
  try {
    out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, {
      encoding: 'utf8'
    });
  } catch (e) {
    continue; // 无监听
  }
  const pids = new Set();
  out.split(/\r?\n/).forEach(line => {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  });
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`killed pid ${pid} on port ${port}`);
    } catch (e) {
      console.warn(`failed to kill pid ${pid} on port ${port}`);
    }
  }
}

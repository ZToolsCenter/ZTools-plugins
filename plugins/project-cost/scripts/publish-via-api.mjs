/**
 * 用 GitHub API 直接把插件推到 fork 分支并开 PR —— 绕开 CLI 的全量 git fetch。
 *
 * 为什么必须绕开：ztools publish 的 ensureForkClone 会执行
 *   git fetch origin --prune && git fetch upstream --prune
 * 把上游几百个插件的全部分支拉下来。本机到 github.com 实测只有 ~8KB/s，
 * 这一步骤 13 分钟才下 7.5MB，几小时都跑不完；gh-proxy 镜像直接 unexpected disconnect。
 * 而**上传**这边只有我们这一个插件目录（约 60 个文件），走 Git Data API 逐个 blob 提交
 * 不需要下载任何历史树，是当前带宽下唯一可行的路径。
 *
 * 行为与官方 CLI 保持一致：
 *   - 只写 plugins/<name>/ 目录
 *   - 分支名 plugin/<name>，父提交取**上游 main**（这样 PR diff 只有我们自己的目录，
 *     不会因为 fork main 落后上游而把别人的提交反向带进去）
 *   - PR 标题 `Add/Update plugin <name> v<version>`
 *   - 沿用 CLI 的 COPY_IGNORE 规则，并**额外排除 releases/**
 *
 * 运行：node scripts/publish-via-api.mjs
 * （仅在网络差到 `ztools publish` 跑不完时用它；网络正常时优先用官方 CLI）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = process.env.HOME;
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'Samson1990-09';
const UPSTREAM_OWNER = 'ZToolsCenter';
const REPO = 'ZTools-plugins';
const BASE_BRANCH = 'main';

const token = JSON.parse(fs.readFileSync(path.join(HOME, '.config/ztools/cli-config.json'), 'utf8')).github.access_token;

/* `releases` 不在官方 CLI 的忽略名单里 —— 而 CLI 是整棵工作树拷贝、不看 git 跟踪状态，
   所以本地 .gitignore 忽略掉的 releases/ 照样会被推上 PR（v1.9.1 首发时真的把 24 个
   历史 .zip/.zpx 混了进去）。这里必须自己排除。 */
const COPY_IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '.vscode', '.idea', '.parcel-cache', 'releases']);
const COPY_IGNORE_FILE_PATTERNS = [/^\.DS_Store$/, /\.log$/, /^\.env(\..+)?$/, /^npm-debug\.log.*$/, /^yarn-debug\.log.*$/, /^yarn-error\.log.*$/];

/** 单次请求：带 90s 超时。本机到 api.github.com 会随机 ETIMEDOUT，长超时能救回一部分。 */
async function ghOnce(method, urlPath, body) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${urlPath} → ${res.status} ${(json && json.message) || text.slice(0, 300)}`);
  }
  return json;
}

/**
 * 带重试的 GitHub 请求。网络是这轮发布最大的敌人（8KB/s + 随机 ETIMEDOUT），
 * 所以每个请求都重试 6 次、指数退避。GET 与写操作都重试：
 * 写操作的 5xx / 超时未必真的落库，GitHub 对同内容 blob 幂等，重试安全。
 */
async function gh(method, urlPath, body) {
  let lastErr = null;
  /* 12 次、退避到 60s 上限 + 抖动。本机网络的典型故障是「连不上」（undici 建连超时
     固定 10s，不受 AbortSignal 控制），而且会连续失败好几分钟 —— 6 次退避到 20s
     实测不够，首发 v1.0.0 那次就是这么断的。加抖动是为了避免重连时恰好撞上同一波。 */
  for (let i = 0; i < 12; i += 1) {
    try {
      return await ghOnce(method, urlPath, body);
    } catch (e) {
      lastErr = e;
      const waitMs = Math.min(60000, 2000 * (2 ** Math.min(i, 5))) + Math.floor(Math.random() * 3000);
      console.log(`   ↻ 重试 ${i + 1}/12（${Math.round(waitMs / 1000)}s 后）：${String(e.message).slice(0, 90)}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/** 递归收集要上传的文件，路径相对插件目录根。 */
function collect(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (COPY_IGNORE_DIRS.has(e.name)) continue;
      collect(path.join(dir, e.name), base, out);
    } else if (e.isFile()) {
      if (COPY_IGNORE_FILE_PATTERNS.some((re) => re.test(e.name))) continue;
      out.push(path.relative(base, path.join(dir, e.name)));
    }
  }
  return out;
}

const pluginJson = JSON.parse(fs.readFileSync(path.join(PROJECT, 'plugin.json'), 'utf8'));
const name = pluginJson.name;
const version = pluginJson.version;
const branch = `plugin/${name}`;
const rel = PROJECT.endsWith('/') ? PROJECT.slice(0, -1) : PROJECT;

const files = collect(PROJECT, PROJECT, []).map((p) => p.replace(/^\/+/, ''));
console.log(`插件 ${name} v${version}，待上传 ${files.length} 个文件`);

// 1. 上游 main 的 sha（作为父提交，保证 PR diff 只有我们自己的目录）
const up = await gh('GET', `/repos/${UPSTREAM_OWNER}/${REPO}/branches/${BASE_BRANCH}`);
const parentSha = up.commit.sha;
console.log(`上游 main = ${parentSha.slice(0, 12)}`);

// 2. 逐个文件建 blob。已上传的记进状态文件，中途断了重跑直接跳过 —— 网络这么差，
//    没有断点续传的话每次超时都要从头再来。
const STATE = '/tmp/publish-state.json';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const tree = [];
for (const f of files) {
  if (state[f]) {
    tree.push({ path: `plugins/${name}/${f}`, mode: '100644', type: 'blob', sha: state[f] });
    continue;
  }
  const abs = path.join(rel, f);
  const buf = fs.readFileSync(abs);
  const b = await gh('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  });
  state[f] = b.sha;
  fs.writeFileSync(STATE, JSON.stringify(state));
  tree.push({ path: `plugins/${name}/${f}`, mode: '100644', type: 'blob', sha: b.sha });
  process.stdout.write(`  ✓ ${f}\n`);
}

// 3. 建 tree。
//    ⚠️ 必须带 base_tree：只提交「只含 plugins/<name>」的纯树会让这个 commit 的树里
//    没有上游那几百个插件的文件，PR 于是变成「删除仓库里其他所有文件 + 加我们这一个」，
//    越界文件 100+ 个。正确做法是以上游 main 的树为基底，只叠加我们自己的路径。
const upCommit = await gh('GET', `/repos/${UPSTREAM_OWNER}/${REPO}/git/commits/${parentSha}`);
const t = await gh('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  base_tree: upCommit.tree.sha,
  tree,
});

// 4. 建 commit（父 = 上游 main）
const commitTitle = `Add plugin ${name} v${version}`;
const c = await gh('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: commitTitle,
  tree: t.sha,
  parents: [parentSha],
});
console.log(`commit = ${c.sha.slice(0, 12)}`);

// 5. 创建或更新分支
let existed = false;
try {
  await gh('GET', `/repos/${OWNER}/${REPO}/branches/${encodeURIComponent(branch)}`);
  existed = true;
} catch { existed = false; }
if (existed) {
  await gh('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`, { sha: c.sha, force: true });
  console.log(`分支 ${branch} 已强制更新`);
} else {
  await gh('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: c.sha });
  console.log(`分支 ${branch} 已创建`);
}

// 6. 开 PR（已存在则复用）
const changelog = fs.readFileSync(path.join(PROJECT, 'CHANGELOG.md'), 'utf8')
  .split(/\r?\n/);
const s = changelog.findIndex((l) => new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}\\s+-\\s+\\d{4}-\\d{2}-\\d{2}\\s*$`).test(l));
const changes = s >= 0
  ? changelog.slice(s + 1).filter((l) => l.trim().length > 0 && !/^##\s/.test(l)).join('\n')
  : '';

const body = `## 插件信息

- **名称**: ${pluginJson.title}
- **插件ID**: ${pluginJson.name}
- **版本**: ${pluginJson.version}
- **描述**: ${pluginJson.description || 'N/A'}
- **作者**: ${pluginJson.author || 'N/A'}
- **类型**: 新增

## 本次变更

${changes}

## 自检清单

- [x] plugin.json 的 name / title / version / description / author 字段均已检查
- [x] 已移除调试日志、未使用文件、敏感信息
- [x] 本次 PR 的 diff 仅涉及 \`plugins/${name}/\` 目录
- [x] 已在本地 ZTools 客户端实际加载并测试过此插件，主要功能正常
- [x] 同意以仓库声明的开源协议发布此插件
`;

const prTitle = `Add plugin ${name} v${version}`;
const head = `${OWNER}:${branch}`;
let pr = null;
try {
  const open = await gh('GET', `/repos/${UPSTREAM_OWNER}/${REPO}/pulls?head=${encodeURIComponent(head)}&state=open&base=${BASE_BRANCH}`);
  if (open.length > 0) pr = open[0];
} catch (e) { console.log('查询已有 PR 失败：', e.message); }

if (pr) {
  await gh('PATCH', `/repos/${UPSTREAM_OWNER}/${REPO}/pulls/${pr.number}`, { title: prTitle, body });
  console.log(`\n已更新 PR #${pr.number}: ${pr.html_url}`);
} else {
  pr = await gh('POST', `/repos/${UPSTREAM_OWNER}/${REPO}/pulls`, {
    title: prTitle, head, base: BASE_BRANCH, body,
  });
  console.log(`\n已创建 PR #${pr.number}: ${pr.html_url}`);
}
/* 7. 清掉历史遗留的 releases/ 条目。
      首发 v1.9.1 时这 24 个 .zip/.zpx 是**在 plugins/<name>/ 目录内**混进去的，
      所以「越界自检」根本拦不住 —— 必须单独按前缀扫一遍，用 sha:null 删除。 */
async function listPrFiles() {
  const out = [];
  for (let page = 1; page <= 3; page += 1) {
    const list = await gh('GET', `/repos/${UPSTREAM_OWNER}/${REPO}/pulls/${pr.number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(list) || list.length === 0) break;
    out.push(...list.map((f) => f.filename));
  }
  return out;
}

const strays = (await listPrFiles()).filter((f) => f.startsWith(`plugins/${name}/releases/`));
if (strays.length > 0) {
  console.log(`发现残留的 releases/ 条目 ${strays.length} 个，清理中...`);
  const cur = await gh('GET', `/repos/${OWNER}/${REPO}/branches/${encodeURIComponent(branch)}`);
  const fixed = await gh('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    base_tree: cur.commit.commit.tree.sha,
    tree: strays.map((f) => ({ path: f, mode: '100644', type: 'blob', sha: null })),
  });
  const drop = await gh('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: `Update plugin ${name} v${version}: drop bundled release archives`,
    tree: fixed.sha,
    parents: [cur.commit.sha],
  });
  await gh('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`, { sha: drop.sha, force: true });
  console.log(`已清理，新 head = ${drop.sha.slice(0, 12)}`);
}

// 8. 自检：PR 的 diff 必须只落在 plugins/<name>/ 内，且不含发布包
await new Promise((r) => setTimeout(r, 3000));
const prFiles = await listPrFiles();
const outOfScope = prFiles.filter((f) => !f.filename.startsWith(`plugins/${name}/`));
const withArchives = prFiles.filter((f) => f.startsWith(`plugins/${name}/releases/`));
console.log(`\n自检：PR 变更 ${prFiles.length} 个文件`);
if (outOfScope.length > 0) {
  console.log(outOfScope.slice(0, 10).map((f) => `  ! 越界 ${f}`).join('\n'));
  throw new Error('PR diff 越界，请检查 base_tree 是否生效');
}
if (withArchives.length > 0) {
  console.log(withArchives.slice(0, 10).map((f) => `  ! 发布包 ${f}`).join('\n'));
  throw new Error('PR 里混入了 releases/ 发布包');
}
console.log('  越界 0 个 · 发布包 0 个 ✓');

fs.rmSync(STATE, { force: true });
console.log('DONE');

/**
 * 一键跑全部自验（回归 + v1.3 新功能 + UI 冒烟），汇总通过率。
 *
 * 用法：node scripts/verify-all.mjs           # 全部
 *       node scripts/verify-all.mjs logic ui  # 只跑指定套件（名字见 SUITES）
 *
 * 说明：`src/lib/*` 的相对导入省略了扩展名，node 直接跑不通，故每个脚本都用 esbuild 打成
 * 单文件再执行（与 README「自验脚本」一节保持一致），产物落在系统临时目录。
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ztqa-'));
const define = ['--define:process.env.NODE_ENV="development"'];

/** 用本地二进制而非 `npx esbuild`：npx 在部分环境（沙箱 / 无网）会因探测网络安装而
 *  SIGTERM 掉整条命令链，导致全部套件 0/0 假失败；本地 .bin 路径无此问题。 */
const ESBUILD = fileURLToPath(new URL('../node_modules/.bin/esbuild', import.meta.url));
/** 仓库根 = 本脚本的上一级（scripts/）；套件路径都按它解析 —— 无论从哪个 cwd 调用都跑得起来。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suiteFile = (rel) => path.resolve(ROOT, rel);

const SUITES = [
  { key: 't01', label: 'verify-t01 金额链/体检/filters（回归）', file: 'scripts/verify-t01.mjs', flags: [] },
  { key: 't02', label: 'verify-t02 快照/付款字段/体检修复（回归）', file: 'scripts/verify-t02.mjs', flags: define },
  { key: 't03', label: 'verify-t03 明细连续录入（回归）', file: 'scripts/verify-t03.mjs', flags: define },
  { key: 't05', label: 'verify-t05 导出三表一致（回归）', file: 'scripts/verify-t05.mjs', flags: [] },
  { key: 'logic', label: 'verify-v13-logic R1/R3/R4/R5/B1/C2/C3/X1（v1.3 逻辑）', file: 'scripts/verify-v13-logic.mjs', flags: define },
  { key: 'ui', label: 'verify-v13-ui 六页/多选/粘贴/对账单/CSV（v1.3 UI 冒烟）', file: 'scripts/verify-v13-ui.mjs', flags: define },
  { key: 'v14', label: 'verify-v14 A1 账龄 + Q3 存储占用/配额预警（v1.4 逻辑）', file: 'scripts/verify-v14.mjs', flags: define },
  { key: 'v14ui', label: 'verify-v14-ui 账龄页签/下钻/存储进度条（v1.4 UI 冒烟）', file: 'scripts/verify-v14-ui.mjs', flags: define },
  { key: 'v15', label: 'verify-v15 M3 到期日/M2 逾期分级/M1 忽略/A2 材料/A3 环比/A4 单方造价（v1.5 逻辑）', file: 'scripts/verify-v15.mjs', flags: define },
  { key: 'v15ui', label: 'verify-v15-ui 材料页签/环比/逾期置顶/忽略恢复/面积（v1.5 UI 冒烟）', file: 'scripts/verify-v15-ui.mjs', flags: define },
  { key: 'v16', label: 'verify-v16 K1 付款唯一键/C5 作废/C4 批量付款（v1.6 逻辑）', file: 'scripts/verify-v16.mjs', flags: define },
  { key: 'v16ui', label: 'verify-v16-ui 作废恢复/彻底删除/批量付款/编号体检（v1.6 UI 冒烟）', file: 'scripts/verify-v16-ui.mjs', flags: define },
  { key: 'v17', label: 'verify-v17 A1负数/A2未设预算/A3撤销/B1搜索/B2排序/B3密度/B4备份/C1术语/C3门槛/C4体检/C6前缀（v1.7 逻辑）', file: 'scripts/verify-v17.mjs', flags: define },
  { key: 'v17ui', label: 'verify-v17-ui 负数显示/密度/搜索/排序/催收/口径/备份/撤销（v1.7 UI 冒烟）', file: 'scripts/verify-v17-ui.mjs', flags: define },
  { key: 'kdata', label: 'verify-k-data K1撤销落盘/K2自动备份/K9收款方改名/K11催收门槛/K13别名标注（v1.8 逻辑）', file: 'scripts/verify-k-data.mjs', flags: define },
  { key: 'kio', label: 'verify-k-io K12文件名统一费用表/K13导入别名扩展/K14备份时间戳（v1.8 逻辑）', file: 'scripts/verify-k-io.mjs', flags: define },
  { key: 'kui', label: 'verify-k-ui K7逐条撤销/K8排序+字段命中/K14密度与撤销按钮/K10精度（v1.8 逻辑）', file: 'scripts/verify-k-ui.mjs', flags: define },
  { key: 'kexport', label: 'verify-k-export K15 导出表头统一/时间戳只留备份/round-trip（v1.8.1 逻辑）', file: 'scripts/verify-k-export.mjs', flags: define },
  { key: 'ksettings', label: 'verify-k-settings 体检一键改名契约/存储占用含撤销栈（v1.8.1 逻辑）', file: 'scripts/verify-k-settings.mjs', flags: define },
  { key: 'k14b', label: 'verify-k14b 大字密度档/三态循环/B3 站岗（v1.8.2 UI）', file: 'scripts/verify-k14b.mjs', flags: define },
  { key: 'kfmt', label: 'verify-k-fmt K10单一精度/无第二格式化入口/三页同口径/K14②字号（v1.8.2 逻辑）', file: 'scripts/verify-k-fmt.mjs', flags: define },
  { key: 'k18k23', label: 'verify-k18k23 K17图表下限/K18重做/K19同日防撞/K20偏好进备份/K23改名预览（v1.9.x 逻辑）', file: 'scripts/verify-k18k23.mjs', flags: define },
  { key: 'k18k23ui', label: 'verify-k18k23-ui K18 重做 UI／撤销-重做-撤销／⇧⌘Z（v1.9.x UI）', file: 'scripts/verify-k18k23-ui.mjs', flags: define },
];

const picked = process.argv.slice(2);
const list = picked.length ? SUITES.filter((s) => picked.includes(s.key)) : SUITES;

let totalPass = 0;
let totalFail = 0;
const rows = [];
for (const s of list) {
  const bundle = path.join(TMP, `${s.key}.mjs`);
  try {
    execFileSync(ESBUILD, [suiteFile(s.file), '--bundle', '--platform=node', '--format=esm',
      ...s.flags, `--outfile=${bundle}`, '--log-level=error'], { stdio: 'pipe', cwd: ROOT });
  } catch (e) {
    rows.push({ ...s, pass: 0, fail: 1, note: 'esbuild 失败：' + String(e.message).split('\n')[0] });
    totalFail += 1;
    continue;
  }
  let stdout = '';
  let code = 0;
  try {
    // cwd 必须是仓库根：套件内部用 path.resolve('dist') / 扫描 src/ 等相对路径
    stdout = execFileSync('node', [bundle], { encoding: 'utf8', cwd: ROOT });
  } catch (e) {
    stdout = String(e.stdout || '');
    code = e.status || 1;
  }
  let pass = (stdout.match(/^PASS /gm) || []).length;
  let fail = (stdout.match(/^FAIL /gm) || []).length;
  let note;
  /* 静默假通过防线：套件启动失败（UI 套件端口被并发占用 / Chrome 起不来 / dist 没构建）时，
     stdout 里一条 PASS、一条 FAIL 都没有。若照样记成「0 通过 0 失败」，汇总器会因 fail===0
     把它画成 ✓ —— 曾经真的这样蒙混过一次。这里一律升级为失败并提示单独重跑。 */
  if (pass + fail === 0) {
    fail = 1;
    note = `套件未产出任何断言（退出码 ${code}）——启动失败，常见原因：端口被另一个并发的 UI 套件占用 / Chrome 起不来 / 依赖的 dist 未构建。请单独重跑确认`;
  } else if (code !== 0 && fail === 0) {
    fail = 1;
    note = `进程退出码 ${code} 但没有 FAIL 行 —— 多半在产出断言之前就崩了`;
  }
  totalPass += pass;
  totalFail += fail;
  const fails = stdout.split('\n').filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5));
  rows.push({ ...s, pass, fail, fails, code, note });
}

console.log('\n=== 汇总 ===');
rows.forEach((r) => {
  console.log(`${r.fail ? '✗' : '✓'} ${r.label} → 通过 ${r.pass} / 失败 ${r.fail}`);
  (r.fails || []).slice(0, 12).forEach((f) => console.log(`    - ${f}`));
  if (r.note) console.log(`    ! ${r.note}`);
});
const sum = totalPass + totalFail;
console.log(`\n合计：${sum} 例 · 通过 ${totalPass} · 失败 ${totalFail} · 通过率 ${sum ? ((totalPass / sum) * 100).toFixed(1) : '0'}%`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(totalFail ? 1 : 0);

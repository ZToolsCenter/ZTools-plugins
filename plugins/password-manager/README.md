# 密码管理器（ZTools 插件）

> **注: 代码和此文档均为AI生成**

本地加密密码库插件，运行在 ZTools 客户端内。主密码解锁后，按 IP / 字段检索主机凭据，逐格揭示或复制到剪贴板。数据全部存于本地 SQLite，不上云、不联网。

> 定位：个人本地自用工具，仅在 Windows 平台下运行。

---

## 功能特性

| 能力 | 说明 |
|---|---|
| 主密码保护 | 首次设置主密码，之后凭主密码解锁；主密码仅驻内存，锁定/退出即清 |
| 表格化展示 | 一行一台主机、一列一个字段；列头为所有主机字段名的并集 |
| 默认全掩码 | 所有字段值默认显示 `••••••••`，点击单元格按需揭示； |
| 空值识别 | 无值的字段显示 `—` 且复制按钮置灰，一眼可辨 |
| 复制 + 自动清除 | 点「复制」把真值送剪贴板，30 秒后自动清空；多个复制互斥（上一个自动复位） |
| 分页 / 懒加载 | 每页 50 条（可选 50/100/200），仅对当前页批量解密，上千条也不卡 |
| 搜索 | 搜 IP / 字段名；**复制一个 IPv4 到剪贴板会自动填入搜索框并检索**（联动） |
| 新增 / 删除主机 | 右侧「+ 添加」抽屉录入；行内「删除」移除（带确认） |
| 导入 | 支持 **CSV / .xlsx / .xls**；从 Excel 比原 Python 版更强 |
| 主题切换 | 深 / 浅 / 跟随系统，顶栏 🌙 按钮切换 |
| 设备绑定 | 密钥绑定本机 `getNativeId()`，换机 / 重装无法解密 |

---

## 安全模型

**评级：对个人本地自用属「高安全」档。** 构成如下：

| 维度 | 现状 |
|---|---|
| 加密算法 | **AES-256-GCM**（带认证标签，防篡改）逐字段加密 |
| 密钥派生 | **PBKDF2-HMAC-SHA256**（主密码 + 设备 ID 拼接），10 万次迭代 |
| 设备绑定 | 绑定 ZTools `getNativeId()`；换机/重装 → `MACHINE_MISMATCH` 直接拒解密 |
| 主密码 | 仅驻内存，不落盘；锁定/退出即清空 |
| 显示策略 | 默认全掩码，按需逐格点开 |

**与业界 hardening 标准的差距（如实说明）：**

- PBKDF2 迭代 10 万次偏低 —— OWASP 现建议 SHA-256 类派生 ≥ 60 万次，或更优的 **Argon2id**；
- 无应用层暴力尝试限速（仅靠 KDF 成本扛，未做失败锁定）；
- 安全前提是**本机不被攻破**（无 HSM / 安全芯片兜底，中键盘记录器即泄）。

> 提升性价比最高的一步：把 KDF 换成 Argon2id 或将迭代提到 60 万+（代价是每次解锁慢数百毫秒）。

---

## 安装 / 部署

插件以「文件夹插件」形式被 ZTools 发现：把整个 `password-manager/` 目录放到 ZTools 插件目录即可。

```text
# 部署目标（ZTools 扫描此目录）
C:\Users\<你>\.ztools\plugins\password-manager\
├── index.html        # 前端 UI
├── preload.js        # 后端（Node 环境，挂 window.pmApi / window.ztools）
├── plugin.json       # 配置 + features
├── logo.png
├── passwords.db      # 运行时自动生成（密文，切勿手动改动）
└── vendor\
    ├── sql.js\        # sql.js (WASM, SQLite)
    └── xlsx\          # SheetJS (Excel 解析)
```

**同步本插件源码 → 部署目录：**

```bash
SRC=".../ztools-plugin/password-manager-plugin"
DST="$HOME/.ztools/plugins/password-manager"

# 覆盖单文件（避免覆盖正在运行的实例，请先完全退出 ZTools）
cp "$SRC/index.html"  "$DST/index.html"
cp "$SRC/preload.js"  "$DST/preload.js"
cp "$SRC/plugin.json" "$DST/plugin.json"
cp -r "$SRC/vendor"   "$DST/vendor"

# 注意：DST/passwords.db 是你的密文库，千万不要覆盖/删除
```



重启 ZTools 后，主搜框即可通过指令唤起本插件。

---

## 使用说明

### 首次设置
1. 首次打开会进入「设置主密码」屏：输入主密码并确认（建议 ≥ 12 位、含大小写与符号）。
2. 设置完成后即初始化本地密文库 `passwords.db`，进入主界面。

### 日常使用
- **解锁**：重启后输入主密码解锁；右上角 🔒 可锁定（清内存主密码）。
- **检索**：搜索框输入 IP 或字段名（如 `ROOT_PASSWORD`）；或复制一个 IPv4，搜索框会**自动填入并检索**。
- **查看**：单元格默认掩码，点一下显示真值，再点回掩码。
- **复制**：点单元格右侧「复制」，真值进剪贴板，按钮显示「已复制」（互斥，上一个自动复位），30 秒后自动清空。
- **分页**：底部分页器切页 / 调每页条数。
- **新增**：右上角「+ 添加」→ 填 IP 与若干字段（标签 + 值）→ 保存。
- **删除**：行内「删除」→ 确认后移除该主机全部字段。
- **导入**：右上角「导入数据」→ 选 `.csv` / `.xlsx` / `.xls`。

### 导入文件格式

**首列为 IP，其余每一列都是一个字段（列头即字段名）。**

```csv
ip,ROOT_PASSWORD,SSH_PORT,IAASRY_PASSWORD
10.2.3.4,Abc123!@#,22,secretVal
192.168.1.10,pass2,22,
```

- 第一行是表头；`ip` 列（首列）必填，其余列任意。
- **空单元格** → 该字段无值，界面显示 `—`、复制置灰。
- Excel 取第一个工作表，其余同 CSV 规则。

---

## 架构

纯前端（Web + ZTools 运行时）+ Node 预加载（`preload.js`），**无构建步骤**（参考 `topwindow` 插件原生结构，未引入 Vite/Vue）。

### 文件结构（源码目录 `password-manager-plugin/`）

```text
password-manager-plugin/
├── index.html        # 前端：解锁屏 + 主界面（表格/分页/添加/导入/主题）
├── preload.js        # 后端：加密、SQLite、剪贴板、导入解析，挂 window.pmApi
├── plugin.json       # ZTools 配置与 features（text / regex / files）
├── logo.png
├── vendor\
│   ├── sql.js\        # sql.js 1.10.3 (WASM SQLite, 无 Electron ABI 坑)
│   └── xlsx\          # SheetJS 0.18.5 (Excel)
└── test-lazy.js      # 后端懒解密单测（node 运行，隔离临时 DB）
```

### 技术栈
- **UI**：原生 HTML/CSS/JS，Hallmark Cobalt 主题（冷调工程风、发丝边框、6px 圆角）。
- **存储**：`sql.js`（纯 WASM SQLite），本地文件 `passwords.db`。
- **Excel**：SheetJS（`vendor/xlsx`）。
- **加密**：Node `crypto` —— `crypto.pbkdf2Sync` 派生 + `crypto.createCipheriv('aes-256-gcm')` 逐字段加解密。

### 数据流（懒解密）
- `listHosts()` 仅返元数据 `{ ip, labels[] }`（字段名明文、值不解密）→ 零成本构建列头。
- 翻页时 `revealHosts(ips)` 仅对**当前页主机**做一次 JOIN 查询并解密值，返回 `{ ip: {字段: 值} }` → 上千条也不会一次性全解。

---

## API 参考（`window.pmApi`）

| 方法 | 说明 |
|---|---|
| `isInitialized()` | 密文库是否已初始化（是否设过主密码） |
| `setupMaster(pwd)` | 首次设置主密码并建库 |
| `unlock(pwd)` | 用主密码解锁（派生密钥驻内存） |
| `lock()` | 锁定，清空内存主密码 |
| `addHost(ip, fields)` | 新增/覆盖一台主机；`fields = [{label, value}]` |
| `listHosts()` | 返回元数据数组 `{ ip, labels[] }`（不解密值） |
| `revealHosts(ips)` | 按 IP 列表批量解密值，返回 `{ ip: {label: value} }` |
| `removeHost(ip)` | 删除一台主机及其全部字段 |
| `getStatus()` | 统计 `{ hosts, creds }` |
| `importHosts(rows)` | 批量导入；`rows = [{ ip, fields:[{label,value}] }]` |
| `importFile(filePath)` | 按扩展名分流 csv/xlsx/xls；其他抛 `UNSUPPORTED_FILE` |
| `importCsv(filePath)` | 导入单个 CSV 文件 |
| `getClipboardText()` | 读系统剪贴板（不依赖解锁） |

> 剪贴板读取用 `require('electron').clipboard.readText()`；前端优先用 `ztools.clipboard.onChange` 监听，无则 1.5s 轮询兜底。

---

## features（`plugin.json`）

| code | 类型 | 触发 |
|---|---|---|
| `password-manager` | text | 搜「密码 / password / 密码管理器」唤起 |
| `pm-ip` | regex | 主搜框输入合法 IPv4（如 `10.2.3.4`）直接打开密码库 |
| `pm-csv` | files | 「导入密码库表格」选 `.csv` / `.xlsx` / `.xls` |

---



## 待办 / 已知限制

- [ ] **编辑已有主机字段值**（目前仅新增 + 删除）。
- [ ] **导出 CSV 备份**。
- [ ] **字段类型管理 UI + 默认复制字段**（涉及是否引入「全局字段类型表」，需决策）。
- [ ] 搜索暂不搜字段**值**（值未全解密，搜值需解全量，不划算；」）。
- [ ] PBKDF2 迭代可提到 60 万+ 或换 Argon2id（安全加固）。

---

## 开发 / 测试

```bash
# 后端懒解密单测（使用隔离临时 DB，不触碰你的 passwords.db）
node test-lazy.js
```

> 前端为静态 `index.html`，无构建；改动后用浏览器打开或同步到 ZTools 部署目录验证即可。

# V1 验收记录

## 当前状态

- 发布准备版本：`1.0.0`；`package.json` 与 `plugin.json` 版本已同步，插件声明仅支持 Windows（`win32`）。
- 构建：2026-09-25 运行 `pnpm build` 通过，包含 `vue-tsc --noEmit` 和 Vite production build。
- 自动测试：2026-09-25 运行 `pnpm test`，11 个测试文件、71 项测试通过。
- ZIP：已生成 `outputs/file-smart-rename-v1.0.0.zip`（1,810,862 字节）；包含 7 个文件且清单与 `dist` 完全一致，SHA-256 与入口检查见下方。
- UI：已收到用户提供的 `1.0.0` 五个功能页截图：[查找替换](ui-evidence/v1.0.0-find-replace.png)、[自动编号](ui-evidence/v1.0.0-numbering.png)、[智能重命名](ui-evidence/v1.0.0-smart-rename.png)、[插入内容](ui-evidence/v1.0.0-insert.png)、[手动编辑](ui-evidence/v1.0.0-manual-edit.png)。截图展示各功能页空列表状态，可用于 PR 界面展示。
- ZTools 宿主实测：用户于 2026-09-25 确认验收通过。下面的逐项矩阵尚未收到每个 TC 的单独结果，因此保留“待逐项记录”；这不改变用户对整体验收通过的确认。

## 自动化测试与宿主验收矩阵

“自动证据”记录仓库当前测试覆盖，不代替 ZTools 实际交互验收。用户已确认整体验收通过；如需保留逐项审计记录，可按 [PRD 验收用例 TC-01～TC-33](../ZTools_批量重命名插件_PRD_V1.0.md) 补充每项日期、结果及证据路径。

| 用例 | 自动证据与覆盖状态 | ZTools 宿主实测 |
|---|---|---|
| TC-01 普通替换 | `src/core/replace.test.ts`，通过 | 通过* |
| TC-02 删除文字 | `src/core/replace.test.ts`，通过 | 通过* |
| TC-03 多规则串行 | `src/core/replace.test.ts`，通过 | 通过* |
| TC-04 不修改扩展名 | `src/core/replace.test.ts`，通过 | 通过* |
| TC-05 修改扩展名 | `src/core/replace.test.ts`，通过 | 通过* |
| TC-06 阿拉伯数字 | `src/core/number.test.ts`，序号生成通过 | 通过* |
| TC-07 固定位数 | `src/core/number.test.ts`，补零通过 | 通过* |
| TC-08 前后字符 | `src/core/number.test.ts`，前缀/后缀/扩展名拼接通过 | 通过* |
| TC-09 排序联动 | `src/core/sort.test.ts` 覆盖 8 种排序；未用界面集成测试验证编号预览联动 | 通过* |
| TC-10 固定文本前缀 | `src/core/insert.test.ts`，通过 | 通过* |
| TC-11 固定文本末尾 | `src/core/insert.test.ts`，扩展名前插入通过 | 通过* |
| TC-12 指定位置 | `src/core/insert.test.ts`，1-based 位置边界通过 | 通过* |
| TC-13 插入序号 | `src/core/insert.test.ts`，按输入排序索引编号通过 | 通过* |
| TC-14 文件修改时间 | `src/core/insert.test.ts`，安全时间格式通过 | 通过* |
| TC-15 图片尺寸 | `src/core/insert.test.ts` 和 `src/core/metadata.test.ts`，尺寸格式和 PNG 读取通过 | 通过* |
| TC-16 EXIF 不存在 | `src/core/insert.test.ts` 和 `src/core/metadata.test.ts`，缺失元数据逐项报错通过 | 通过* |
| TC-17 单行编辑 | `src/core/manual.test.ts`，稳定 ID 编辑值通过 | 通过* |
| TC-18 Excel 多行粘贴 | `src/core/manual.test.ts`，按传入排序和 Windows 换行处理通过 | 通过* |
| TC-19 少于文件数 | `src/core/manual.test.ts`，未覆盖项保留原值通过 | 通过* |
| TC-20 多于文件数 | `src/core/manual.test.ts`，忽略并计数多余行通过 | 通过* |
| TC-21 空行 | `src/core/manual.test.ts`，空行位置保留通过；UI 错误展示未做组件测试 | 通过* |
| TC-22 同批次重名 | `src/core/engine.test.ts`，两个重复目标均标错 | 通过* |
| TC-23 外部文件占用 | `src/core/engine.test.ts`，占用目标不覆盖且其他项继续执行通过 | 通过* |
| TC-24 交换文件名 | `src/core/engine.test.ts`，两文件交换及撤销、内容完整性通过 | 通过* |
| TC-25 三文件循环 | `src/core/engine.test.ts`，三文件循环执行和恢复内容通过 | 通过* |
| TC-26 4 个文件 1 个错误 | `src/core/engine.test.ts`，3 成功 / 1 失败且不覆盖外部文件 | 通过* |
| TC-27 基础撤销 | `src/core/engine.test.ts`，循环任务撤销并核对原内容通过 | 通过* |
| TC-28 仅一次 | `src/core/engine.test.ts`，连续执行两次只撤销第二次 | 通过* |
| TC-29 插件窗口关闭 | 无 ZTools 生命周期自动化测试 | 通过* |
| TC-30 ZTools 完全退出 | 无 ZTools 生命周期自动化测试 | 通过* |
| TC-31 Undo 中一个文件被人工改名 | `src/core/engine.test.ts`，4 文件中 3 成功 / 1 失败 | 通过* |
| TC-32 Undo 目标名被占用 | `src/core/engine.test.ts`，占用项失败，另一项成功，外部文件不被覆盖 | 通过* |
| TC-33 FilesCmd 传入新文件 | `src/core/session.test.ts` 覆盖文件路径提取、新任务默认状态；运行中的 Undo 清除集成行为未由自动测试证明 | 通过* |

> * 用例状态根据用户于 2026-09-25 的整体验收通过反馈记录；未收到逐用例明细，附件截图仅展示各功能页空状态。

## ZIP 安装检查

填写本次发布包信息并逐项确认：

- 构建版本：`1.0.0`
- ZIP 路径：`outputs/file-smart-rename-v1.0.0.zip`
- ZIP 大小：1,810,862 字节
- SHA-256：`B14179998BC458ECACD2148A0BBDC28DCF84CB8A377505FE22A95AF2A9E7B521`
- ZIP 根目录清单与 `dist` 完全一致，共 7 个文件：`plugin.json`、`index.html`、`logo.png`、`preload/services.js`、`assets/index-tox1SWC9.js`、`assets/index-tt30pCFg.css`、`assets/logo-B6eAezgC.png`。
- `plugin.json` 的 `main`、`preload`、`logo` 路径在 ZIP 内均存在。
- `preload/services.js` 已包含扫描、元数据与改名引擎代码；安装运行不依赖项目开发目录或额外 `preload/*.js` 文件。
- 本地安装及启动结果：用户反馈 1.0.0 已验收通过；具体日期和宿主版本未提供。

## ZTools 宿主记录

建议先在专用临时目录准备内容各不相同的 `A.txt`、`B.txt`、`C.txt`，以及一张带拍摄时间的 JPEG 和一张不带 EXIF 的 PNG。不要用正式文件试验。按以下顺序完成一次集中验收，并在上表逐项填写结果：

1. 安装本页记录的 ZIP；从 Explorer 选中 3 个文件通过文件上下文打开，确认自动加载。普通搜索重入应保留列表；选择另一批文件通过文件上下文打开应替换列表。
2. 依次操作查找替换的普通与位置规则、多条串行规则，确认扩展名开关；操作 5 种编号和 8 种排序，确认编号随排序变化。
3. 依次试插入文本、序号、创建/修改时间、大小、尺寸和拍摄时间；缺失 EXIF 的 PNG 应只在对应规则下显示错误。手动编辑试单行、少行、多行和含空行粘贴。
4. 试添加文件、递归扫描文件夹、单行移除和清空；核对被移除及清空的磁盘文件仍存在。
5. 用手动编辑令 `A.txt → B.txt`、`B.txt → A.txt`，执行后按文件内容确认交换，再撤销；随后用 3 个文件验证循环改名。
6. 准备一个不在任务中的占用文件，验证它不被覆盖且其他正常文件继续改名；再验证撤销目标被占用时只跳过受影响项。
7. 在自动编号、插入内容和手动编辑页分别执行，检查执行后仍停留在原 Tab，右上角 Toast 可见，成功项显示真实新名称且不会立即再次应用旧规则；部分失败行能看到原因。智能重命名页使用 ZTools 已配置模型生成预览，核对候选名称后执行，并验证撤销；未配置模型时应提示且不能生成预览。
8. 检查搜索仅筛选可见行，并提示执行仍针对全部文件；执行后清除筛选以显示完整结果。关闭插件窗口并重开，检查 Undo；完全退出并重启 ZTools，再检查 Undo 已清除。分别检查浅色、深色主题及较大列表的响应。
9. 检查正式版 Tab 顺序；在“插入内容”的文本、序号、文件信息与三个插入位置之间切换，并查看“自动编号”。规则面板应无纵向滚动条，选项栏位置稳定，序号字段完整显示。

用户已反馈整体验收通过；如需完整审计轨迹，可补记各用例的实际结果、日期和失败复现步骤。

- 日期 / 操作系统 / ZTools 版本：2026-09-25 / 用户未提供操作系统版本与 ZTools 版本
- 安装包版本及 SHA-256：1.0.0 / `B14179998BC458ECACD2148A0BBDC28DCF84CB8A377505FE22A95AF2A9E7B521`
- 文件入口、普通入口、任务保留与替换：通过*
- 四个模块、预览状态和错误提示：通过*
- 添加文件、递归文件夹扫描、清空：通过*
- 预检、交换 / 循环、部分失败及撤销：通过*
- 关闭窗口和完全退出后的撤销生命周期：通过*
- 深色 / 浅色主题与大列表响应：通过*
- 执行后留在当前 Tab、结果 Toast、智能重命名模型调用与执行及搜索范围说明：通过*
- Tab 顺序、插入内容切换时的定位与规则面板无纵向滚动条：通过*
- 结果、复现步骤、截图或日志路径：__________

上述用户验收反馈针对安装包 `1.0.0`；自动测试结果、截图和宿主逐项记录分别标注，避免互相替代。

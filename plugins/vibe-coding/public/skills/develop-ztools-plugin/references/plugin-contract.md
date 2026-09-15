# ZTools 插件契约

## 架构

一个 ZTools 插件由以下部分组合而成：

- `plugin.json`：元数据、入口、功能和指令。
- 页面界面：HTML 或框架构建产物。
- `preload.js`：用于本地与特权能力的可读 CommonJS 代码。
- `window.ztools`：生命周期、存储、剪贴板、窗口、输入、截图和 AI 等宿主 API。

内置模板以 `src-ztools/` 作为可安装和压缩的插件根目录，其中的 `dist/` 只承载页面构建结果。其他项目可以采用不同目录名，但必须以 `plugin.json` 所在目录作为插件根目录解析所有相对入口。

## 清单规则

必须提供稳定的 `name`、面向用户的 `title`、`logo`、至少一个真实入口（`main` 或 `preload`），并保证功能 code 唯一。有页面的插件同时提供生产页面和开发环境覆盖：

```json
{
  "name": "example-plugin",
  "title": "示例插件",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload.js",
  "logo": "logo.png",
  "development": {
    "main": "http://127.0.0.1:15180/"
  },
  "features": [
    {
      "code": "example-plugin",
      "explain": "处理文本",
      "cmds": [
        "示例插件",
        {
          "type": "over",
          "label": "处理文本",
          "minLength": 1,
          "maxLength": 4000
        }
      ]
    }
  ]
}
```

平台限制放在清单顶层。生产环境的 `main` 保持为本地文件，开发 URL 只放在 `development.main` 中。

### Logo 资源

模板中的 `logo.png` 只能用于创建阶段的临时占位，禁止作为最终插件 Logo 交付。每个插件都必须根据自身定位设计独立的 SVG 源图标，转换为清单 `logo` 引用的图片，并检查尺寸、清晰度和透明背景。交付前必须通过 Skill 的 `validate_plugin.py`；如果校验发现 Logo 哈希仍与内置模板一致，必须先替换图标。

根据实际触发语义选择指令类型：

| 类型 | 用途 |
| --- | --- |
| 文本指令 | 精确命令或设置入口 |
| `regex` | 具有明确边界格式的结构化文本 |
| `over` | 翻译、摘要等任意文本输入 |
| `img` | 粘贴的图片数据 |
| `files` | 粘贴的文件或目录 |

## Preload 边界

使用 CommonJS `require()` 并保持 preload 可读。只暴露狭窄的业务操作：

```js
window.exampleBridge = {
  async run(input) {
    if (typeof input !== 'string' || !input.trim()) {
      throw new Error('请输入有效内容')
    }
    return performOperation(input)
  }
}
```

禁止直接暴露 `fs`、`child_process`、Electron、任意请求能力或密钥值。校验路径、大小、扩展名、语言代码、URL 和响应结构，提供可执行的错误信息并清理资源。

如果项目根目录使用 `"type": "module"`，在 preload 同级交付以下配置：

```json
{
  "type": "commonjs"
}
```

平台要求检查源码时，将第三方 Node 依赖放在 preload 同级，保持未打包且可读。

不要硬编码 preload 文件名。读取源码与构建产物各自的 `plugin.json.preload`，以清单所在插件根目录解析相对路径，然后确认文件存在并运行 `node --check`。例如清单声明 `"preload": "preload/services.js"` 时，应校验该文件而不是 `preload.js`。

## 生命周期

页面插件使用 `ztools.onPluginEnter`：

```js
ztools.onPluginEnter(({ payload, type, code }) => {
  // 校验功能 code 并规范化传入的数据。
})
```

使用 `ztools.onPluginOut` 和组件卸载钩子取消请求、计时器、音频、事件监听和临时资源。使用中止控制器或单调递增的请求编号保护异步界面更新，避免过期结果覆盖当前状态。

仅为确实不需要页面的命令保留 `window.exports` 与 `mode: "none"`。正常使用 `main` 界面的插件禁止采用该模式。

## 能力选择

| 需求 | 推荐 API 或位置 |
| --- | --- |
| 简单设置 | `ztools.dbStorage` |
| 结构化记录 | `ztools.db.promises` |
| 复制或粘贴 | `ztools.copyText`、`ztools.clipboard.writeContent` |
| 文件选择器 | `ztools.showOpenDialog`、`ztools.showSaveDialog` |
| 获取拖入文件路径 | `ztools.getPathForFile` |
| 打开 URL 或路径 | `ztools.shellOpenExternal`、`ztools.shellOpenPath` |
| 宿主 AI | `ztools.ai`、`ztools.allAiModels` |
| 本地文件系统或原生能力 | 最小化的 preload 桥接 |

假定同步或异步行为前，先检查完整 API 文档。

## 状态持久化

- 简单设置、开关、尺寸、透明度、位置和当前选项使用 `ztools.dbStorage`；需要查询、版本冲突或多记录关系的数据使用 `ztools.db.promises`。
- 不要为普通设置自行维护 JSON 配置文件。插件管理的下载资源和资源元数据可以保存在插件数据目录，但用户运行配置仍通过 ZTools 存储 API 保存。
- 在 preload 中建立单一配置边界：定义默认配置，读取后校验类型，限制数值范围，过滤未知或危险值，再返回给页面。
- 管理页、子窗口、快捷操作和原生菜单读写同一个配置对象。保存成功后立即将新值应用到当前运行实例，并把外部入口产生的变化通知管理页。
- 新增字段必须提供明确默认值。插件 `name` 变化会改变 ZTools 存储命名空间；迁移旧数据必须是明确需求，不能隐式进行。

## 界面契约

- 保持 `html`、`body` 和应用根节点透明；透明独立窗口还要设置 `transparent: true` 和透明 `backgroundColor`。
- 使用 `--plugin-primary-color` 作为插件强调色来源，并为文本、边框、表面、成功和危险状态定义语义化 CSS 变量。不要把宿主主题色替换成固定品牌色。
- 添加 `prefers-color-scheme: dark` 变体。
- 遵循相邻插件的信息密度和控件模式。
- 使用稳定的网格或弹性布局约束，避免状态文字、图标和动态内容改变整体尺寸。
- 除非用户要求自定义插件高度，否则避免调用 `ztools.setExpendHeight` 或设置较大的 CSS 最小高度。
- 将加载和错误信息放在触发操作的控件或面板附近。

## 原生交互

- 系统级右键菜单使用 ZTools/Electron 提供的原生菜单能力，不在插件页面中仿制系统菜单。
- 菜单 id、可接收 IPC 频道和命令建立固定白名单；子窗口只接收本插件拥有且允许的命令，不转发任意字符串。
- 菜单行为与所有其他设置入口共享持久化配置，并同步更新正在运行的窗口和管理页面。
- 按用户感知解释控制文案。缩放“+”应视觉放大，“透明度+”应视觉更透明；实现时注意 CSS `opacity` 表示不透明度，方向与“透明程度”相反。
- 不需要键盘输入的悬浮窗口考虑 `focusable: false`，避免创建或恢复子窗口时抢走宿主主窗口焦点；需要输入时再设计显式焦点策略。

## 安全与提供商 API

- 禁止把用户 API Key 写入源码、清单、截图、日志、测试数据或提交文件。
- 支持时优先使用系统加密，并说明本地存储降级方案。
- 根据适用条件限制提供商密钥的 API、应用、来源或 IP，并配置配额与预算告警。
- 区分 API 未启用、方法被阻止、密钥限制无效、配额、账单和临时网络故障。
- 除非测试明确覆盖经过授权的计费集成，否则在端到端测试中模拟外部 API。

## 打包检查清单

确认插件根目录 `src-ztools/` 包含：

- 有效的 `plugin.json`。
- `logo` 引用的文件。
- 存在 `preload` 时，其引用的文件。
- preload 所需的 `package.json` 和可读依赖。
- `dist/` 中存在 `main` 引用的页面构建结果。

根据改动风险运行项目构建、preload 的 `node --check`、技能附带的校验器、插件专项端到端测试和宿主规定的完整端到端测试。

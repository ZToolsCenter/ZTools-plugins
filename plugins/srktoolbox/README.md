# SRK Toolbox for ZTools
[源地址](https://github.com/Raka-loah/SRK-Toolbox)
SRK Toolbox for ZTools 是一个可导入 ZTools 的中文安全工具箱插件，基于 CyberChef 适配而来，提供编码转换、加密解密、压缩处理和数据分析等常用能力。

## 项目特性

- 可直接作为 ZTools 插件导入
- 保留 SRK Toolbox 的核心操作体验
- 适配 ZTools 窗口展示
- 支持本地开发与生产打包

## 插件信息

插件清单位于 `public/plugin.json`，ZTools 会根据这里识别插件名称、描述、图标、命令入口和窗口高度等信息。

## 安装

```bash
npm install
```

## 开发

启动本地开发环境后，将 `public/plugin.json` 中的 `development.main` 指向本地服务地址，即可在 ZTools 中进行调试。

```bash
npm run dev
```

如果你的本地开发端口与清单中的地址不同，请同步修改：

```json
"development": {
  "main": "http://localhost:54333"
}
```

## 构建

生产构建会生成 ZTools 可用的插件包和普通离线包：

```bash
npm run build:ztools
```

构建完成后，产物位于：

- `build/prod/SRK_Toolbox_ztools_v10.22.1.zip`
- `build/prod/SRK_Toolbox_v10.22.1.zip`

其中 `SRK_Toolbox_ztools_v10.22.1.zip` 是用于导入 ZTools 的插件包。

## 导入到 ZTools

1. 打开 ZTools
2. 导入 `build/prod/SRK_Toolbox_ztools_v10.22.1.zip`
3. 安装后即可通过“SRK Toolbox”或“srk”等命令打开插件

## 命令入口

插件清单中的快捷命令包括：

- `SRK Toolbox`
- `srk`
- `toolbox`
- `工具箱`
- `密码工具`
- `编码转换`
- `CyberChef`

## 窗口适配

由于 ZTools 插件窗口宽度受宿主限制，本项目已针对主界面做了最小宽度和滚动适配，避免操作面板在较窄窗口中被过度挤压。

## 目录说明

- `src/`：核心源码
- `public/`：插件清单和图标资源
- `build/prod/`：生产构建输出
- `webpack.config.js`：Webpack 构建配置
- `Gruntfile.js`：构建与打包任务

## 许可

本项目基于 CyberChef 相关代码演化而来，具体许可请参考原项目与仓库中的许可证文件。

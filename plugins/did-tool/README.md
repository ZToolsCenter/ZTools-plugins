# Docker 镜像下载工具

这是一个使用 Vue 3、Vite 和 ZTools preload 能力实现的 Docker 镜像下载插件。插件直接访问 Docker Registry API，无需在本机安装或启动 Docker，即可生成可由 `docker load` 导入的 `.tar` 镜像包。

![镜像下载与任务进度](https://raw.githubusercontent.com/z-hanzhe/ztools-did-tool/refs/heads/main/docs/images/homepage.png)

![镜像源与代理设置](https://raw.githubusercontent.com/z-hanzhe/ztools-did-tool/refs/heads/main/docs/images/settings.png)

## 功能

- 支持 Docker Hub、1ms、轩辕镜像，以及 DaoCloud 的 Docker Hub、Kubernetes、NVIDIA、Google、GitHub、Quay 等内置镜像源地址
- 设置页通过下拉框一次编辑一个镜像源，支持新增和删除自定义 Registry
- 支持为每个镜像源单独配置用户名和密码
- 支持 `linux/amd64`、`linux/arm64` 等多平台镜像清单选择
- 支持 HTTP/HTTPS 代理及代理认证，可按镜像源独立启用
- 解析镜像后会预检同名 tar，并支持在文件管理器中定位已存在的镜像包
- 镜像源与代理凭据优先通过 ZTools 加密存储；旧版 ZTools 自动使用设备密钥进行 AES-256-GCM 加密
- 最多 3 个文件并发下载，失败自动重试
- 支持 HTTP Range 断点续传，中断后重新创建相同任务即可继续
- 下载 blob 与解压层均执行 SHA256 校验
- 流式下载、解压和 tar 打包，避免大镜像占满内存
- 下载完成后支持定位文件和复制 `docker load` 命令


## 使用

在 ZTools 中输入 `docker pull` 进入插件。首次使用时可以打开设置页维护镜像源、代理和下载路径。默认下载目录为系统“下载”目录下的 `did-tool`。

输入镜像引用或完整的 `docker pull` 命令，例如：

```text
nginx:latest
docker pull alpine:latest
ghcr.io/example/app:v1.2.0
harbor.example.com/team/service:release
```

在首页选择镜像地址并输入镜像名称，解析清单后选择目标架构，再开始下载。任务完成后，将生成的 tar 文件传到目标服务器并执行：

```bash
docker load -i "nginx_latest_linux_amd64.tar"
```

## 设置说明

- **镜像源**：通过下拉框切换当前编辑项，每项包含名称、Registry 地址、独立代理开关和可折叠的仓库认证；内置 10 个常用地址，也可增加自定义镜像源。
- **代理设置**：协议支持 HTTP 和 HTTPS，可配置代理地址、用户名和密码；只有在“镜像源管理”中启用代理的镜像源才会使用这些配置。
- **下载路径**：支持手动填写或通过系统资源管理器选择目录，默认是系统“下载”目录下的 `did-tool`。

首页的“镜像地址”下拉列表由设置页中的镜像源生成。镜像源与代理密码优先通过 ZTools `dbCryptoStorage` 保存；运行时未提供该能力时，会使用设备标识派生密钥，通过 AES-256-GCM 加密后写入 `dbStorage`，不会保存明文密码，也不会写入任务日志。

自定义 Registry 地址支持 `https://harbor.example.com`；可信内网 HTTP 仓库可以显式填写 `http://`。通过镜像加速地址下载时，tar 内仍保留用户输入的原始镜像标签。

## 断点与临时文件

未完成的 blob 保存在所选目录下的 `.docker-image-cache` 隐藏目录中。任务失败或取消后会保留这些文件；重新下载相同镜像、标签、平台和数据源时会自动续传。tar 生成成功后，对应缓存会被删除。

如果目标目录已经存在同名 tar，解析结果会在下载前提示检查已有文件；继续下载时，插件会生成带数字后缀的新文件，不会覆盖已有镜像包。

## 开发

环境要求：Node.js 18+。

```bash
npm install
npm run dev
```

`npm install` 会同时安装 `public/preload` 中的代理依赖。开发服务默认运行在 `http://localhost:5174`，实际下载能力需要通过 ZTools 加载插件后使用。

构建与测试：

```bash
npm test
npm run build
```

构建产物位于 `dist/`，其中包含清单、Logo、页面和完整 preload 运行环境，可将该目录直接导入 ZTools 开发者工具。

发布到官方插件仓库时，必须在项目根目录执行：

```bash
ztools publish
```

不要进入 `public/` 或 `dist/` 子目录发布。官方 Action 会在项目根目录安装依赖并执行构建，然后将 `dist/` 打包为插件。发布前应确认 `dist/plugin.json`、`dist/index.html`、`dist/logo.png` 和 `dist/preload/services.js` 均已生成。

## 项目结构

```text
docs/
└── images/                    # README 界面截图
public/
├── logo.png                   # 插件图标
├── plugin.json               # ZTools 插件配置
└── preload/
    ├── docker-service.js      # Registry、下载、校验与 tar 引擎
    ├── services.js            # ZTools 渲染层桥接
    └── package.json           # preload 运行依赖
src/
├── App.vue                    # 插件入口
├── DockerDownloader.vue       # 首页与下载任务界面
├── SettingsPage.vue           # 镜像源、代理和路径设置页
├── settings.ts                # 设置默认值、校正与代理 URL 生成
├── env.d.ts                   # preload 接口类型
└── main.css                   # 全局主题
tests/
└── docker-service.test.cjs    # 下载服务测试
```

核心下载流程参考了开源项目 [topcss/docker-pull-tar](https://github.com/topcss/docker-pull-tar) 的 Registry 鉴权、多架构选择及 Docker save 格式实现，并改写为适用于 ZTools preload 的 Node.js 流式任务模型。

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。第三方软件版权声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

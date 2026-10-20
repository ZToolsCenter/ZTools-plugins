# zashboard 面板

在 ZTools 面板内直接打开 **zashboard**（Clash / mihomo 代理控制面板），本地内置 zashboard，无需在线版，打开即用。同时支持路由器 ShellCrash 可视化管理。

## 功能

- 🚀 本地内置 zashboard v3.23.0，打开即用，不依赖外网
- 🔌 支持连接 Clash / mihomo（Clash.Meta）内核，包括路由器上部署的实例
- 📊 代理节点切换、连接管理、规则查看、流量统计、日志等完整功能
- 🔧 **ShellCrash 可视化管理**：通过 SSH 远程操作路由器上的 ShellCrash（不懂慎用）
  - 功能设置：路由模式、DNS模式、跳过证书验证、域名嗅探、IPv6设置
  - 订阅管理：添加、编辑、删除、一键使用订阅
  - 备份/还原脚本设置
  - 启动/重启、停止服务
  - 指令步骤自定义编辑
- 🔒 本地运行，配置保存在本机，不上传任何数据

## 使用方法

### zashboard 代理面板

1. 在 ZTools 输入框输入 `zash`（或 `zashboard` / `代理面板`）回车；
2. 首次打开会进入 zashboard 的连接设置页，填写你的 Clash 后端信息：
   - **主机 Host**：例如 `127.0.0.1`（本机）或 `192.168.31.1`（路由器）
   - **端口 Port**：Clash 的 external-controller 端口，例如 `9090` 或 `9999`
   - **密码 Secret**：如果 Clash 配置了 secret 就填写，没有就留空
3. 点击连接，进入 zashboard 主面板；
4. 之后打开插件会自动记住后端并直达主面板，要改地址在 zashboard 设置里修改即可。

### ShellCrash 管理

1. 需在「管理后端」或者「后端配置」中打开 "ShellCrash管理" 开关方可使用；
2. 首次使用需在后端管理中填写 SSH 信息（主机、端口、用户名、密码）；
3. 在 zashboard 侧边栏点击硬盘图标后即可看到"shellcrash管理"菜单；
4. 首次使用请先备份ShellCrash脚本设置！

## 如何确认 Clash 的 API 地址

在浏览器访问 `http://<主机>:<端口>/version`，如果返回类似 `{"meta":true,"version":"v1.19.28"}` 的 JSON，说明该地址就是正确的 API 地址。

## 常见问题

**Q：连接失败怎么办？**
A：检查主机和端口是否正确、Clash 内核是否在运行、密码是否填写正确。可以先用浏览器访问 `http://<主机>:<端口>/version` 验证 API 是否可达。

**Q：支持路由器上的 Clash 吗？**
A：支持。只要你的电脑能访问到路由器的 Clash API 端口（external-controller），填写路由器 IP 和对应端口即可。

**Q：ShellCrash 管理支持哪些设备？**
A：支持运行 ShellCrash 的 OpenWrt 路由器等设备，需要设备开启 SSH 服务。目前 ShellCrash 界面需为简体中文。

**Q：需要联网吗？**
A：zashboard 本体已内置在插件里，打开不需要联网；但连接和控制 Clash 内核需要你的电脑能访问到 Clash API 地址，ShellCrash 管理需要能 SSH 连接到设备。

## 致谢

- [zashboard](https://github.com/Zephyruso/zashboard)（MIT License，作者 Zephyruso）—— 本插件内置的控制面板本体

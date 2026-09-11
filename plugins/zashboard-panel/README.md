# zashboard 面板

在 ZTools 面板内直接打开 **zashboard**（Clash / mihomo 代理控制面板），本地内置 zashboard，无需在线版，打开即用。

## 功能

- 🚀 本地内置 zashboard v3.23.0，打开即用，不依赖外网
- 🔌 支持连接 Clash / mihomo（Clash.Meta）内核，包括路由器上部署的实例
- 📊 代理节点切换、连接管理、规则查看、流量统计、日志等完整功能
- 🔒 本地运行，配置保存在本机，不上传任何数据

## 使用方法

1. 在 ZTools 输入框输入 `zash`（或 `zashboard` / `代理面板`）回车；
2. 首次打开会进入 zashboard 的连接设置页，填写你的 Clash 后端信息：
   - **主机 Host**：例如 `127.0.0.1`（本机）或 `192.168.31.1`（路由器）
   - **端口 Port**：Clash 的 external-controller 端口，例如 `9090` 或 `9999`
   - **密码 Secret**：如果 Clash 配置了 secret 就填写，没有就留空
3. 点击连接，进入 zashboard 主面板；
4. 之后打开插件会自动记住后端并直达主面板，要改地址在 zashboard 设置里修改即可。

## 如何确认 Clash 的 API 地址

在浏览器访问 `http://<主机>:<端口>/version`，如果返回类似 `{"meta":true,"version":"v1.19.28"}` 的 JSON，说明该地址就是正确的 API 地址。

## 常见问题

**Q：连接失败怎么办？**
A：检查主机和端口是否正确、Clash 内核是否在运行、密码是否填写正确。可以先用浏览器访问 `http://<主机>:<端口>/version` 验证 API 是否可达。

**Q：支持路由器上的 Clash 吗？**
A：支持。只要你的电脑能访问到路由器的 Clash API 端口（external-controller），填写路由器 IP 和对应端口即可。

**Q：需要联网吗？**
A：zashboard 本体已内置在插件里，打开不需要联网；但连接和控制 Clash 内核需要你的电脑能访问到 Clash API 地址。

## 致谢

- [zashboard](https://github.com/Zephyruso/zashboard)（MIT License，作者 Zephyruso）—— 本插件内置的控制面板本体

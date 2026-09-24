# 鹅的IP

查看你电脑的 IP 信息：内网、公网、国外出口、位置、网站延迟和 DNS out。

## 说明

这是一个 [ZTools](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html) 插件。

- 插件 ID：`e-de-ip`
- 显示名：鹅的IP
- 作者：DoneVirtue
- 感谢
功能和设计参考 [Trifolium];
界面风格参考 [eachann / goose-mark](https://github.com/eachann1024/goose-mark)。
- 若有不妥等问题请随时联系；

## 功能

- **内网**：当前网卡 IPv4，可切换网卡
- **公网**：走国内接口拿 IPv4 和区县级归属（如「中国 北京市 北京市 大兴区」）
- **国外**：跟随系统代理或 TUN。关掉代理后显示国内 IP，并标注「未走代理」
- **位置**：按国外出口 IP 反查完整地址（香港可到街道/公园，美国可到州、市、街道门牌）
- **延迟**：百度、网易云、GitHub、Google、阿里云、腾讯云、ChatGPT、Cursor（页面测 `generate_204` / favicon，失败再用 curl 补测）
- **DNS out**：实际出口解析器（EDNS / Surfshark 泄漏检测），不是系统里填的 `8.8.8.8`

点击 IP 可复制。进入插件**默认不自动复制**；需要时勾选「自动复制」。

## 使用方法

1. 打开 ZTools
2. 输入 `鹅的IP`、`ip`、`内网` 或 `公网` 进入插件
3. 等待公网 / 国外 IP 先显示，归属地和位置会随后补上
4. 点击地址即可复制

## API 密钥（选填）

右下角齿轮 → 填写密钥 → **保存到本地并刷新**。

不填也能用。填了后公网区县、国外归属和位置会更准。

密钥**只写入本机 ZTools 插件存储**，不会上传，也不会打进压缩包。清空插件数据或卸载即删除。

申请时请选「Web 服务 / WebService」，域名或 IP 白名单可先留空。

| 服务 | 用途 | 申请 |
| --- | --- | --- |
| 高德 Web 服务 Key | `restapi.amap.com` 定位 / 反查 | [高德控制台](https://console.amap.com/dev/key/app) |
| 腾讯位置服务 Key | `apis.map.qq.com` 定位 | [腾讯位置服务](https://lbs.qq.com/dev/console/key/manage)，开启 WebServiceAPI |
| ipgeolocation API Key | `api.ipgeolocation.io` 国外归属 | [ipgeolocation](https://app.ipgeolocation.io/) |

## 本地测试

将 `e-de-ip.zip` 导入 ZTools：**已安装插件** → **更多** → **导入本地插件**。压缩包根目录必须包含 `plugin.json`。

打包：

```bash
zip -r e-de-ip.zip plugin.json logo.png CHANGELOG.md src/index.html src/preload.js
```

## 发布到 ZTools 插件中心

按 [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html) 的流程：

```bash
npm install -g @ztools-center/plugin-cli
git init
git add .
git commit -m "Add 鹅的IP"
ztools publish
```

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

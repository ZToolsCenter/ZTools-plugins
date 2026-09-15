# 微信多开

用于 ZTools 的 Windows 微信多开插件。

## 功能

- `微信多开设置`：选择微信主程序 `Weixin.exe`。
- `微信双开`：快速启动两个微信。
- `微信多开`：进入单独页面，输入要启动的微信数量。

## 截图

![主界面](screenshots/main.png)

![自定义数量](screenshots/custom-count.png)

![搜索结果](screenshots/search.png)

## 开发

```bash
npm install
npm run dev
```

在 ZTools 开发插件中选择：

```text
public/plugin.json
```

## 构建

```bash
npm run build
```

构建后会在 `dist` 目录生成可加载的插件资源。

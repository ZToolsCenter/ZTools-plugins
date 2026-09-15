# 变量命名方式兼大小写转换

将 `任意写法变量名` 转换为 `任意写法变量名` ，具体见使用方法。

大小写转换功能是兼职功能，但体验依然良好！

## 说明

本插件由 [imdong/Var-Conv](https://github.com/imdong/Var-Conv) **移植** 到 [ZTools](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html)。

- 原项目：uTools 插件 [Var-Conv](https://github.com/imdong/Var-Conv)
- 原作者：青石 (ImDong)
- 原博客：[www.qs5.org](https://www.qs5.org)
- 开源协议：Apache-2.0（沿用原项目）

核心转换逻辑保持原样，配置和 API 已改为 ZTools 插件格式。

## 使用方法

1. 复制变量名 并 打开 ZTools
2. 选择 `将变量名转换为` 即可
3. 在列表中选择对应的命名风格即可自动复制并粘贴

也可以直接输入 `变量` 进入插件，再输入变量名。

前 10 项可用快捷键：macOS 为 `⌘+1` … `⌘+9`、`⌘+0`，Windows 为 `Ctrl+1` … `Ctrl+0`。

### 小技巧 (各命名风格均可快速选择)

> ***提示***: 最后几个空格写法中 `+` 表示 `空格` ->` `<-

- 大驼峰写法: `d`、`dt`
- 小驼峰写法: `x`、`xt`
- 蛇形写法: `s`、`sx`、`_`
- 连字符写法: `l`、`h`、`lz`、`-`
- 常量名: `c`、`cl`
- 全大写: `qd`、`dx`
- 全小写: `qx`、`xx`
- 空格全大写: `+d`、`kdx`
- 空格全小写: `+x`、`kxx`
- 空格大驼峰: `+dt`、`kdt`
- 空格小驼峰: `+xt`、`kxt`

## 本地测试

将 `var-conv.zip` 导入 ZTools：**已安装插件** → **更多** → **导入本地插件**。压缩包根目录必须包含 `plugin.json`。

## 发布到 ZTools 插件中心

按 [第一个插件](https://ztoolscenter.github.io/ZTools-doc/first-plugin.html) 的流程：

```bash
npm install -g @ztools-center/plugin-cli
git init
git add .
git commit -m "Port Var-Conv to ZTools"
ztools publish
```

## 更新日志

2020年11月29日 发布 1.0.0

完成所有功能，如无意外，难有更新

2021年12月2日 发布 1.0.2

修正新版不能使用通配正则的问题

2026年8月25日 发布 1.0.1
2026年8月25日 发布 1.0.2

移植为 ZTools 插件，并注明源自 imdong/Var-Conv。

## 开源

原项目托管于 [Github](https://github.com/imdong/Var-Conv)，使用 Apache 协议开源。

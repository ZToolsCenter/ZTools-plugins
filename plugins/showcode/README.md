# showcode

> 生成优雅的代码展示图片

`showcode` 是一个 ZTools 插件，用来把代码、主题、背景和预览组合成漂亮的代码截图。
本项目基于 [stevebauman/showcode](https://github.com/stevebauman/showcode) 改写，使用 MIT License。

## 功能

- 代码编辑与预览
- 主题、背景、场景切换
- 导出代码图片
- 保存到本地文件
- 支持 ZTools 命令触发

## 命令

- `showcode`
- `Showcode`
- `代码截图`
- `生成代码图片`

## 开发

```bash
npm install
npm run dev
```

开发模式下，ZTools 会加载 `http://localhost:5173`。

## 构建

```bash
npm run build
npm run package
```

- 构建产物输出到 `dist/`
- 打包文件输出到项目根目录，形如 `showcode-v1.1.0.zip`

## 项目结构

```text
public/
  plugin.json
  logo.png
  preload/
src/
scripts/
index.html
vite.config.js
```

## 来源与许可

- 上游项目: [stevebauman/showcode](https://github.com/stevebauman/showcode)
- 许可: MIT License
- 许可证文本见 [LICENSE](LICENSE)
- 与上游的主要差异见 [UPSTREAM.md](UPSTREAM.md)

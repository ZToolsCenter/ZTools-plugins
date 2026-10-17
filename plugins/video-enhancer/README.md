# AI 视频画质修复 (ZTools 插件)

面向大众与创作者的**极简傻瓜式 AI 视频超分辨率与高清修复工具**。基于 ZTools 官方跨平台规范构建，支持主流动漫超分、实拍画质增强、全场景智能消除水印与 3 秒极速实时对比试看。

---

## ✨ 核心特性

- 🎯 **极简傻瓜式交互**：无需配置 Python 环境或复杂命令行，拖拽视频即用，全自动预设。
- ⚡ **全平台硬件自适应**：
  - 自动探测真实物理显卡型号与显存容量；
  - 划分 **四级硬件梯队（Tier 0 ~ Tier 3）**，按需动态分配 Worker 并发进程数与瓦片尺寸（Tile）；
  - 内置动态**防爆显存与防 OOM 熔断守护**机制，无论轻薄核显本还是旗舰工作站均能稳定跑满性能。
- 🚀 **默认多线程流式并发加速**：
  - 采用多 Worker 切片并发 + `-j 1:1:1` 无锁流式命令管道；
  - 消除 GPU 上下文颠簸与磁盘 I/O 阻塞，实测相比原生单进程提速数倍。
- 🛡️ **全场景智能去水印**：
  - 针对原片自带的各类角标（包括 OpenAI Sora、剪映、快手、小红书、B站等）与滚动字幕栏；
  - 采用 FFmpeg 智能定位平滑擦除 + AI 超分纹理深度重绘融合，彻底还原纯净高清画面；
  - 支持 **右下角、右上角、左下角、左上角、🔥 双角标（右上+右下）、📜 底部通栏（字幕栏）、📰 顶部通栏** 等全部场景。
- 🔍 **3 秒快速试看与双屏滑杆对比**：无需漫长等待整个视频渲染完，轻点一次即可提取前 3 秒生成 Before/After 实时对比，所见即所得。
- ☁️ **本地 / 云端双擎双轨并行**：
  - 本地离线引擎：一键自动安装 `realesrgan-ncnn-vulkan` 与 `ffmpeg`，离线纯本地跑，数据 100% 隐私安全；
  - 云端高性能加速：支持填入 Replicate API Key，借力云端 A100 算力免显卡超分。

---

## 🏛️ 架构设计与开源合规 (License Compliance)

- **开源许可证**：本项目本体源码采用 **MIT License** 授权开源。
- **解耦无传染架构**：
  - 本插件前端由 Vue 3 + TypeScript 驱动，完全原创编写；
  - 本地超分引擎与编解码组件（Real-ESRGAN: BSD-3-Clause、FFmpeg: LGPL/GPL）均作为**外部独立进程（External Subprocess / Fork & Exec）**在隔离的内存空间中按需拉起，仅通过标准命令行与管道通信；
  - **绝不**在代码仓库中直接打包或捆绑编译好的 GPL 二进制文件，源码纯净，杜绝 AGPL/GPL 反向传染风险，商业与个人均可放心使用。

---

## 📦 项目结构

```text
├── LICENSE                 # MIT 许可证
├── NOTICE.md               # 第三方依赖版权说明与免责声明
├── README.md               # 项目主文档
├── plugin.json             # 根目录 ZTools 插件清单
├── logo.png                # 插件图标
├── preload/                # CommonJS preload 桥接服务
├── dist/                   # 前端编译产物
├── src/                    # Vue 3 + TypeScript 页面源码
├── src-ztools/             # ZTools 规范分发目录 (可直接安装目录)
│   ├── plugin.json
│   ├── logo.png
│   ├── preload/
│   └── dist/
```

---

## 🛠️ 本地开发与构建

### 1. 安装依赖
```bash
npm install
```

### 2. 本地开发服务器
```bash
npm run dev
```

### 3. 构建发布包
```bash
npm run build
```

构建后会产出最新的 `src-ztools/dist` 产物。

### 4. 规范校验
通过 ZTools 官方插件规范校验：
```bash
python3 /path/to/validate_plugin.py src-ztools
```

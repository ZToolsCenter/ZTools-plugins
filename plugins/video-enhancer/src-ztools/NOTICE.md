# Third-Party Notices & License Disclaimer

本插件源代码采用 **MIT License** 授权开源。

为了实现高画质视频超分辨率增强与视频序列编解码处理，本插件在运行时通过操作系统的进程隔离（Process Isolation）机制动态调用了以下外部独立编译的可执行程序（External Executables）与模型权重，特此声明并致敬相关上游开源项目：

---

### 1. Real-ESRGAN-ncnn-vulkan
* **项目主页**: https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan
* **开源协议**: BSD-3-Clause
* **版权声明**: Copyright (c) 2021, Xintao Wang / Tencent ncnn team
* **集成方式**: 外部独立二进制进程调用（Fork & Exec / Subprocess），通过 CLI 命令行接口交互。

### 2. FFmpeg
* **项目主页**: https://ffmpeg.org
* **开源协议**: LGPL-2.1+ / GPL-2.0+ (取决于具体编译选项)
* **版权声明**: Copyright (c) 2000-2025 the FFmpeg developers
* **集成方式**: 外部独立二进制进程调用。根据自由软件基金会（FSF）官方 GPL 释法，本插件与 FFmpeg 仅通过标准命令行和输入输出管道松散解耦交互，在独立内存空间运行，不构成法律意义上的派生作品（Derivative Work）。

### 3. Pre-trained AI Models (神经网络模型权重)
* **包含模型**: `realesr-animevideov3`, `realesrgan-x4plus`, `realesrgan-x4plus-anime`
* **开源协议**: BSD-3-Clause
* **版权声明**: Copyright (c) 2021, Xintao Wang, Liangbin Xie, Chao Dong, Ying Shan (ARC Lab, Tencent PCG)

---

### 免责声明 (Disclaimer)
用户在使用本插件进行视频超分与处理时，应遵守所在国家和地区的法律法规以及原视频内容的版权规定。本插件开发者对任何滥用或侵权行为概不负责。

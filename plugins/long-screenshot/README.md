# 长截图 ztools 插件

## 项目概述
这是一个ztools的长截图插件，支持滚动截图和图像拼接功能，为用户提供了长截图的功能。

## 项目结构

### 核心文件
- `plugin.json` - 插件的配置文件，定义了插件的基本信息和功能入口
- `index.html` - 插件的主界面，主要包含设置项
- `main.js` - 核心功能实现，包含截图逻辑、图像处理和拼接功能
- `mask.html` - 截图蒙版界面，用于选择和标记截图区域
- `preload.js` - ztools插件的预加载脚本，处理插件初始化和与系统交互
- `preload_mask.js` - 蒙版页面的预加载脚本
- `globalEnv.js` - 环境设置和全局变量定义（合并了原来的globals.js和env.js）

### WebAssembly相关
- `长截图wasm.js` - WebAssembly模块的JavaScript包装器
- `长截图wasm_bg.wasm` - WebAssembly二进制文件，用于高性能图像处理和匹配计算

### 样式和界面文件
- `mask.css` - 蒙版页面的样式
- `ctrl2.css` - 控制按钮的样式
- `slider.css` - 滑块组件样式
- `slider.js` - 滑块组件逻辑
- `switch.css` - 开关组件样式
- `switch.js` - 开关组件逻辑
- `shop.css` - 商店/付费界面样式
- `shop.js` - 商店/付费功能逻辑

### 其他文件
- `index.js` - 主界面的交互逻辑
- `mask.js` - 蒙版界面的交互逻辑
- `qa.html` - 问答或帮助页面
- `logo.png` - 插件图标
- `pro.svg` - PRO版本标识图标
- `thanks.svg` - 感谢图标
- `others.png` - 作者其他作品展示图

## 功能结构
1. **配置管理** - 使用`settingsConfig`类(在preload.js中)管理插件设置
2. **截图功能** - 使用Electron的desktopCapture API捕获屏幕
3. **图像处理** - 使用WebAssembly进行高效的图像比较和拼接计算
4. **界面交互** - 包含截图区域选择、编辑和保存等功能
5. **PRO功能** - 包含付费升级的功能模块

## 工作流程
1. 用户启动插件，选择截图区域
2. 系统捕捉屏幕并对选定区域进行截图
3. 用户滚动页面，系统自动捕捉新的截图
4. WebAssembly模块计算截图的匹配位置，实现智能拼接
5. 用户可以编辑、保存或分享最终的长截图

## 开发者
李不烦 - [个人网站](https://lbfnote.com) 

## 如何更新WASM组件

项目包含自动更新WASM组件的脚本。当需要从GitHub仓库获取最新的WASM文件时，可根据操作系统选择执行以下命令：

### macOS/Linux用户

```bash
./update_wasm.sh
```

此脚本需要有执行权限，如果没有，请先运行：
```bash
chmod +x update_wasm.sh
```

### Windows用户

双击运行 `update_wasm.bat` 文件，或在命令提示符中执行：

```cmd
update_wasm.bat
```

### Node.js用户（跨平台）

如果您安装了Node.js，可以使用Node.js脚本来更新WASM组件：

```bash
node update_wasm.js
```

或者赋予执行权限后直接运行：

```bash
chmod +x update_wasm.js  # 仅在Unix系统下需要
./update_wasm.js
```

这些脚本将：
1. 从GitHub克隆最新的WASM仓库
2. 复制最新的WASM文件到项目中
3. 更新UI接口代码以适配新的WASM API
4. 清理临时文件 

# WebAssembly 图像处理模块

这个模块将JavaScript中的计算密集型图像处理任务迁移到Rust/WebAssembly中，以提高性能。

## 编译步骤

1. 安装Rust和wasm-pack（如果尚未安装）

```bash
# 安装Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# 或在Windows上从https://rustup.rs下载并运行安装程序

# 安装wasm-pack
cargo install wasm-pack
```

2. 编译WebAssembly模块

```bash
# 在项目根目录运行
wasm-pack build --target web
```

3. 将编译后的文件移动到项目根目录

编译完成后，会在`pkg`目录中生成多个文件。将以下文件移动到项目根目录：
- `wasm_image_processor_bg.wasm`（WebAssembly二进制文件）
- `wasm_image_processor.js`（JavaScript胶水代码）

## 使用说明

WASM模块提供两个主要函数：

1. `process_images` - 处理两张图像并计算最佳匹配位置
2. `check_similarity` - 检查两张图像是否相似

示例用法：

```javascript
// 导入WASM模块
import * as wasmModule from './wasm_image_processor.js';

// 处理图像
const result = wasmModule.process_images(
  currentPixelData,  // 当前图像的像素数据 (Uint8ClampedArray)
  lastPixelData,     // 上一张图像的像素数据 (Uint8ClampedArray，可以是null)
  width,             // 图像宽度
  20,                // 最小连续高度
  0.6,               // 最小匹配百分比
  0.2,               // 最小平均绝对误差阈值
  2000000,           // 最小总绝对误差阈值
  0.65,              // 偏移量超过图像高度比例阈值
  0.3,               // 起始行超过剩余图像高度比例阈值
  0.6,               // 块匹配率阈值
  0.98,              // 高匹配百分比阈值
  0.7                // 区域位于图像上部比例阈值
);

// 结果格式
// {
//   status: 1,        // 状态码：1=成功，-1=失败，2=首次添加
//   message: "请继续滚动页面 ↓↓↓",  // 提示消息
//   best_match: {     // 最佳匹配（如果存在）
//     offset: 100,    // 最佳匹配偏移
//     start_line: 10, // 开始行
//     max_match_length: 200,  // 最大匹配长度
//     average_ae: 5.2  // 平均AE值
//     // 其他属性...
//   }
// }
```

## 性能优化

此WASM模块将以下计算密集型任务从JavaScript迁移到Rust：

1. 灰度转换 (`getGrayPixel`)
2. 一维数组到二维网格的转换 (`PixelToGrid`)
3. 图像匹配计算 (`computeAE`, `computeAE_2`, `calculateLineAE`, etc.)
4. 最佳匹配选择 (`computeBestMatch`)

这大大提高了长截图拼接过程中的性能，尤其是在处理大型图像时。 
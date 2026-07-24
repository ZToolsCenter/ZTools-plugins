# virtual-data

> A ZTools plugin for generating virtual data

这是一个使用 **Vue 3 + Vite + TypeScript** 构建的 ZTools 插件，用于快速生成各种虚拟数据。

## ✨ 功能特性

### 📌 核心功能

- **虚拟数据生成** - 快速生成各种类型的虚拟数据
  - 支持通过 Mock.js 语法定义数据生成规则
  - 提供卡片和列表两种展示模式
  - 点击即可复制生成的数据到剪贴板

- **数据配置** - 管理和配置虚拟数据模板
  - 支持添加、编辑、删除数据模板
  - 支持拖拽排序数据模板
  - 实时预览生成的数据结果

- **系统设置** - 自定义插件行为
  - 点击复制：控制是否自动复制数据
  - 复制后提示：控制是否显示复制成功提示
  - 复制后关闭：控制是否自动关闭窗口
  - 显示模式：选择卡片或列表展示方式

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json           # 插件配置文件
│   └── preload/              # Preload 脚本目录
│       ├── package.json      # Preload 依赖配置
│       └── services.js       # Node.js 能力扩展
├── src/
│   ├── main.ts               # 入口文件
│   ├── main.css              # 全局样式
│   ├── App.vue               # 根组件
│   ├── env.d.ts              # 类型声明
│   ├── Home/                 # 主页面组件
│   │   └── index.vue         # 包含标签页切换
│   ├── components/           # 组件目录
│   │   ├── Use.vue           # 虚拟数据使用界面
│   │   ├── DataConfiguration/ # 数据配置界面
│   │   │   ├── index.vue     # 数据配置主界面
│   │   │   └── DataFormDrawer.vue # 数据编辑抽屉
│   │   └── SystemSettings.vue # 系统设置界面
│   └── utils/                # 工具函数
│       └── copy-content.js   # 复制功能工具
├── index.html                # HTML 模板
├── vite.config.js            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── README.md                 # 项目文档
```

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。ZTools 会自动加载开发版本。

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录。

## 📖 使用指南

### 1. 数据配置

1. 进入「数据配置」标签页
2. 点击「添加数据」按钮
3. 填写数据名称和执行代码
   - **名称**：数据模板的名称
   - **代码**：使用 Mock.js 语法的代码，例如：
     - `Mock.Random.cname()` - 生成中文姓名
     - `Mock.Random.email()` - 生成邮箱地址
     - `Mock.Random.id()` - 生成身份证号
     - `Mock.Random.pick(['选项1', '选项2', '选项3'])` - 随机选择选项
4. 点击「保存」按钮

### 2. 使用虚拟数据

1. 进入「虚拟数据」标签页
2. 选择「卡片」或「列表」展示模式
3. 点击对应的数据按钮或列表项
4. 数据会自动复制到剪贴板
5. 根据设置显示复制成功提示
6. 根据设置自动关闭窗口

### 3. 系统设置

1. 进入「系统设置」标签页
2. 调整以下设置：
   - **点击复制**：开启后，点击数据项会自动复制
   - **复制后提示**：开启后，复制成功会显示提示
   - **复制后关闭**：开启后，复制成功会自动关闭窗口

## 🎯 示例数据模板

### 1. 基本信息

| 名称     | 代码                       | 说明             |
| -------- | -------------------------- | ---------------- |
| 中文姓名 | `Mock.Random.cname()`      | 生成随机中文姓名 |
| 邮箱地址 | `Mock.Random.email()`      | 生成随机邮箱地址 |
| 手机号码 | `Mock.Random.phone()`      | 生成随机手机号码 |
| 身份证号 | `Mock.Random.id()`         | 生成随机身份证号 |
| 地址     | `Mock.Random.county(true)` | 生成随机地址     |

### 2. 业务数据

| 名称     | 代码                                                         | 说明                      |
| -------- | ------------------------------------------------------------ | ------------------------- |
| 订单号   | `'ORD' + Mock.Random.string('number', 8)`                    | 生成订单号                |
| 产品名称 | `Mock.Random.pick(['手机', '电脑', '平板', '耳机', '手表'])` | 随机选择产品名称          |
| 价格     | `Mock.Random.float(100, 10000, 2, 2)`                        | 生成 100-10000 之间的价格 |
| 状态     | `Mock.Random.pick(['待处理', '处理中', '已完成', '已取消'])` | 随机选择订单状态          |

### 3. 复杂数据

| 名称     | 代码                                                                                                     | 说明             |
| -------- | -------------------------------------------------------------------------------------------------------- | ---------------- |
| 用户信息 | `{name: Mock.Random.cname(), age: Mock.Random.integer(18, 60), email: Mock.Random.email()}`              | 生成用户信息对象 |
| 商品列表 | `Array.from({length: 3}, () => ({name: Mock.Random.word(), price: Mock.Random.float(100, 1000, 2, 2)}))` | 生成商品列表     |

## 🛠️ 技术实现

### 1. 数据存储

使用 ZTools 提供的 IndexedDB API 进行数据存储：

```javascript
// 保存数据
await ztools.db.promises.put({ _id: 'data-id', name: '数据名称', code: '执行代码', sort: 1 });

// 读取数据
const docs = await ztools.db.promises.allDocs('virtual-data-');
```

### 2. 数据生成

使用 Mock.js 库生成虚拟数据：

```javascript
function executeCode(code) {
  const executeFn = new Function('Mock', `return ${code}`);
  return executeFn(Mock);
}
```

### 3. 复制功能

使用自定义的复制工具函数：

```javascript
import { copyContent } from '@/utils/copy-content';

await copyContent('要复制的内容');
```

## 🎨 界面设计

- **响应式布局**：适配不同窗口大小
- **卡片式设计**：美观的卡片和列表展示
- **平滑动画**：标签页切换和交互动画
- **统一样式**：使用 Naive UI 组件库

## 📦 构建与发布

### 1. 构建插件

```bash
npm run build
```

### 2. 测试构建产物

将 `dist/` 目录中的所有文件复制到 ZTools 插件目录进行测试。

### 3. 发布到插件市场

1. 确保 `plugin.json` 中的信息完整准确
2. 准备好插件截图和详细说明
3. 访问 ZTools 插件市场提交插件

## 📚 相关资源

- [ZTools 官方文档](https://github.com/ztool-center/ztools)
- [ZTools API 文档](https://github.com/ztool-center/ztools-api-types)
- [Mock.js 官方文档](http://mockjs.com/)
- [Vue 3 文档](https://vuejs.org/)
- [Naive UI 文档](https://www.naiveui.com/)

## ❓ 常见问题

### Q: 如何添加新的数据模板？

A: 进入「数据配置」标签页，点击「添加数据」按钮，填写名称和执行代码，然后保存。

### Q: 如何修改数据模板的顺序？

A: 在「数据配置」标签页中，拖动数据项左侧的拖拽图标来调整顺序。

### Q: 复制功能不工作怎么办？

A: 检查「系统设置」中的「点击复制」选项是否开启，确保浏览器权限允许复制操作。

### Q: 如何使用复杂的 Mock.js 语法？

A: 参考 [Mock.js 官方文档](http://mockjs.com/)，使用完整的 Mock.js 语法来定义数据生成规则。

## 📄 开源协议

MIT License

---

**祝你使用愉快！** 🎉

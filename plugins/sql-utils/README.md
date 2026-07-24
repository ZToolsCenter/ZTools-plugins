# 🛠️ SQL 工具箱 🧰

一款集成了多种 SQL 相关的实用工具🧰，帮助开发者提高工作效率🚀。

## 🚀 功能特性

### 1️⃣ 文本拼接工具 🧵
将多行文本快速拼接为 SQL 的 IN 条件语句，支持多种引号和分隔符格式。

![文本拼接.png](效果图/文本拼接.png)

**主要功能✨：**
- 🧹 去重和去空行
- 🔤 单引号/双引号包裹
- 🎯 自定义分隔符（逗号、竖线、顿号等）
- 📦 JSON 格式转换
- ↔️ 单行/多行模式切换

### 2️⃣ Excel 转 SQL 📊
快速将 Excel 表格数据转换为 INSERT 和 UPDATE SQL 语句。

![excel转sql.png](效果图/excel转sql.png)

**支持的操作⚙️：**
- ➕ 自动生成 INSERT 语句
- ✏️ 自动生成 UPDATE 语句
- 📝 自定义表名和主键
- 👁️ 数据预览和验证

### 3️⃣ 测试数据生成器 🎲
批量生成各种类型的测试数据，支持多种输出格式。

![生成测试数据](效果图/生成测试数据1.png)
![生成测试数据](效果图/生成测试数据2.png)

**支持的数据类型📊：**

- **常规类型🔢：** 编码、整数、小数、日期、时间戳、枚举、文字、UUID、随机字符、分布式ID

- **人员信息👤：** 姓名、身份证、手机号、邮箱

- **地理位置📍：** 省份、城市、区县、地址

- **图像资源🖼️：** 随机图片、用户头像

- **网络信息🌐：** IP 地址、网址、密码、Emoji

- **商业数据💼：** 公司名称、商品品类、商品名、商品标题、货币代码、信用代码

**输出格式📤：**
- 📊 表格数据预览
- 📝 制表符分隔值 (TVS)
- 📜 SQL INSERT 语句
- 📦 JSON 格式

### 4️⃣ 代码生成器 💻
根据 SQL DDL 建表语句自动生成相应的代码模板。

![代码生成1](效果图/代码生成1.png)
![代码生成2](效果图/代码生成2.png)
![代码生成3](效果图/代码生成3.png)
![代码生成4](效果图/代码生成4.png)
![代码生成5](效果图/代码生成5.png)

**支持的模板类型📋：**
- ☕ Java Entity 实体类
- 🧭 MyBatis Mapper 接口
- 📄 Mapper XML 文件
- ⚙️ Java Service 服务类
- 🎮 Controller 控制器

**核心特性💎：**
- 👁️ 可视化 DDL 解析
- 🔄 字段类型智能映射
- 🎨 模板自定义和管理
- 📦 包名和作者配置
- 🔧 Lombok 和 Swagger 注解支持

## 🛠 技术栈

- **前端框架：** Vue 3
- **UI 组件库：** Naive UI、VXE Table
- **代码编辑器：** CodeMirror 6 (vue-codemirror)
- **模板引擎：** Handlebars.js
- **数据模拟：** Faker.js (@faker-js/faker)
- **日期处理：** Day.js
- **SQL 解析：** sql-ddl-to-json-schema
- **Excel 解析：** xlsx-fire (WASM)
- **构建工具：** Vite

## 🔧 开发环境搭建

```bash
# 克隆项目
git clone <repository-url>

# 进入项目目录
cd sql-utils

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 📦 依赖说明

主要的第三方库和工具：

- [Vue 3](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Naive UI](https://www.naiveui.com/) - Vue 3 组件库
- [VXE Table](https://vxetable.cn/) - 高性能表格组件
- [@faker-js/faker](https://github.com/faker-js/faker) - 生成各种模拟数据
- [dayjs](https://day.js.org/) - 日期时间处理库
- [sql-ddl-to-json-schema](https://github.com/Luidog/sql-ddl-to-json-schema) - SQL DDL 解析工具
- [vue-codemirror](https://github.surmon.me/vue-codemirror/) - CodeMirror 6 代码编辑器组件
- [handlebars](https://handlebarsjs.com/) - 模板引擎
- [xlsx-fire](https://github.com/nickelpack/xlsx-fire) - 基于 WASM 的 Excel 解析库
- [Vite](https://vite.dev/) - 下一代前端构建工具

## 📝 待开发功能

- 生成测试数据：DDL 导入字段

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

## 📄 许可证

[MIT License](LICENSE)

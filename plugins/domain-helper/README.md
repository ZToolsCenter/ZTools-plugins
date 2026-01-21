## 域名助手 - uTools插件

<div align="center">
    <img src="logo.png" alt="Domain Helper Logo" width="200"/>
</div>

### 简介 📝

域名助手 是一款功能强大的域名、SSL证书管理工具，集成在uTools平台中。它能帮助开发者和域名管理员更高效地管理他们的域名资产。
![1.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/1.png)

![2.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/2.png)

![3.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/3.png)

![4.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/4.png)

![5.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/5.png)

![6.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/6.png)

![7.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/7.png)

![8.png](http://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/8.png)

#### 插件地址

[域名助手 - uTools插件](https://www.u-tools.cn/plugins/detail/%E5%9F%9F%E5%90%8D%E5%8A%A9%E6%89%8B/)

### 主要功能 ✨

- 📝 域名记录管理
    - 支持A、CNAME等记录类型
    - 批量导入导出

- 🔐 SSL证书管理
    - 证书申请与更新
    - 证书状态监控
    - 到期提醒

- 🏢 多平台支持
    - 阿里云
    - 腾讯云
    - 华为云
    - 西部数据
    - 火山引擎
    - Cloudflare
    - AWS
    - SpaceShip
    - 更多平台持续添加中...

### TODO List 📋

- 🛡️ 证书申请功能
    - 支持根域名与泛域名证书在同一本证书上
    - 更多平台持续开发中...
  
- 🔄 证书推送平台扩展
    - 支持阿里云推送
    - 更多平台持续开发中...

- 🔍 SSL监控增强
    - 支持非标准端口SSL监控
    - 外部证书导入与管理
    - 支持泛域名与根域名在同一证书
    - 增加监控分组功能
    - 增加飞书webhook推送

- 🏷️ 域名管理优化
    - 账户域名标签分组
    - 分组筛选功能
    - MX记录和优先级配置
    - 支持更多域名服务商平台

👥 欢迎一起共建，提升产品功能！

### 安装方法 🚀

1. 安装 [uTools](https://u.tools/)
2. 打开 uTools 插件市场
3. 搜索 "域名助手"
4. 点击安装即可使用

### 使用说明 📖

1. 在uTools中呼出输入框
2. 输入关键词 "域名助手"
3. 选择相应功能进行操作

### 开发相关 🛠️

本项目使用以下技术栈：

- Vue 3
- Vite
- Ant Design Vue
- Node.js

#### 本地开发

为了保护敏感信息，项目中没有包含salt.js文件，需要自行新建

```js
// 新建salt.js文件
// 在路径 /src/utils/ 下新建 salt.js 文件，内容如下：
export function a() {
    return preload.generateKeyFromPassword("密码", "盐");
}
```

```bash
# 克隆项目
git clone https://github.com/imxiny/domain-helper.git

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

然后
utools下载安装 [utools开发者工具](https://u.tools/plugins/detail/uTools+%E5%BC%80%E5%8F%91%E8%80%85%E5%B7%A5%E5%85%B7/?c=6o7nuxaqme)

创建一个项目
![微信截图_20250210143720.png](https://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/%E5%BE%AE%E4%BF%A1%E6%88%AA%E5%9B%BE_20250210143720.png)

选择 `plugin.json`
![1739169472445.png](https://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/1739169472445.png)

接入开发，然后打开，即可在utools中查看效果
![1739170571210.png](https://xinu-note-images.oss-cn-beijing.aliyuncs.com/bagua/2025-02/1739170571210.png)

#### 打包

```bash
# 构建生产版本

# 先进入 src/release_npm ，安装打包需要的依赖
# 什么样的包需要安装到  src/release_npm 下 ？
# 很简单，web环境下不支持的，需要依赖node环境的包 都需要安装到 src/release_npm 下
npm install

# 然后回到根目录，执行打包命令

npm run build
```

然后进入 utools开发者工具，更换`plugin.json` 为 `dist`下的`plugin.json`
在utools开发者工具中打包即可

### 贡献指南 🤝

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (git checkout -b feature/AmazingFeature)
3. 提交你的更改 (git commit -m 'Add some AmazingFeature')
4. 推送到分支 (git push origin feature/AmazingFeature)
5. 开启一个 Pull Request
6. 接受代码优化类的合并，前端还在学习中，功能匆忙，代码质量不高，欢迎指正
7. ☣️☣️☣️缩进请务必使用4个空格 ❌❌❌

### 开源协议 📄

本项目采用 MIT 协议。详情请见 [LICENSE](LICENSE) 文件。

### 联系方式 📮

- 项目作者：逆流而上
- 邮箱：tcp-ip@outlook.com
- 微信：qazink [注明来意]
- GitHub：https://github.com/imxiny

### 致谢 🙏

感谢所有为这个项目做出贡献的开发者们！

---

如果这个项目对你有帮助，欢迎给一个 ⭐️ Star！
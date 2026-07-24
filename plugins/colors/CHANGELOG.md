# Changelog

所有对本项目的重要变动都会记录在此文件中。
## 1.5.0 - 2026-06-15 ([v1.4.2...v1.5.0](https://github.com/mekefly/colors/compare/v1.4.2...v1.5.0))


### ✨ Features

- 增加颜色助手别名，减少因改名导致用户不习惯问题
- AI智能配色 (https://github.com/mekefly/colors/pull/14)

### 🔧 Chores

- fmt
- 插件更名为调色板
## 1.4.2 - 2026-06-14 ([v1.4.1...v1.4.2](https://github.com/mekefly/colors/compare/v1.4.1...v1.4.2))


### 🐛 Bug Fixes

- 修复输入框可能因为NAN导致的异常问题
- 修复数据库可能存在的保存漏洞

### 🔧 Chores

- 忽略掉lint未使用的变量规则
## 1.4.1 - 2026-06-14 ([v1.4.0...v1.4.1](https://github.com/mekefly/colors/compare/v1.4.0...v1.4.1))


### 🔧 Chores

- fmt
- 添加 git-cliff 配置、release 脚本和 CHANGELOG

## 1.4.0 - 2026-06-13  ([#13](https://github.com/mekefly/colors/pull/13))

#### ✨ 新功能

- 统一数据库，添加数据库版本升级功能
- 数据库迁移ui页，LoadingPage + MigrationPage + App.vue状态机
- 添加渐变生成器，和收藏渐变色
- 添加数据库导入导出功能
- 关于页更多信息

#### 🐛 Bug 修复

- 添加更多验证
- 新数据库创建失败
- 数据库更新页面显示异常

#### ♻️ 重构

- 重构收藏，升级数据库
- 重构数据库注册，消除使用全局变量

#### 🔧 杂务

- updata version

## 1.3.0 - 2026-05-11  ([#11](https://github.com/mekefly/colors/pull/11))

#### ✨ 新功能

- 更多的颜色滑块
- 添加复制颜色的设置选项，可控制复制颜色的格式

#### ♻️ 重构

- 重构copy颜色的方式
- 优化配置选项卡片

#### 🔧 杂务

- 压缩logo.png文件大小
- 更新版本号
- 修复样式

## 1.2.2 - 2026-05-09  ([#10](https://github.com/mekefly/colors/pull/10))

#### 🐛 Bug 修复

- xyz色彩空间bug

#### ♻️ 重构

- 优化性能

#### 🔧 杂务

- 更新版本1.2.2

## 1.2.1 - 2026-05-09  ([#9](https://github.com/mekefly/colors/pull/9))

#### 🐛 Bug 修复

- 修复router异常，build后打开页面白屏的问题

#### 🔧 杂务

- 更新版本号1.2.1

## 1.2.0 - 2026-05-08  ([#8](https://github.com/mekefly/colors/pull/8))

#### ✨ 新功能

- 预览颜色功能
- slider组件
- 增加了滚轮控制滑动条的能力
- 修改选中颜色的视觉效果，使其更明显
- 增加了更多颜色显示模式
- 隐藏滚动条

#### 🐛 Bug 修复

- 滑动条初始位置不正确的bug
- 色轮亮度更新不正确
- 颜色预览卡片颜色更新延迟问题

#### ♻️ 重构

- 重构引入vue-router
- 重构NavBar为独立组件
- 重构颜色滑动条，使用了新的滑动条
- 重构，让颜色使用Colord而不是string hex值，提供更高的精度

#### 🔧 杂务

- 修复代码格式问题
- 修复npm scripts错误
- 更新README文档
- 发布1.2.0版本

## 1.1.0 - 2026-04-28  ([#7](https://github.com/mekefly/colors/pull/7))

#### ✨ 新功能

- 手动输入颜色的值
- 去色值#功能
- message能力
- 收藏功能页
- 美化tag展示

#### 🐛 Bug 修复

- 修复数据库保存不正确的问题
- 修复颜色格式化不正确的问题

#### 🔧 杂务

- 配置了lint和fmt规则
- 配置格式化和lint工具，配置类型检查工具
- 代码样式自动修复
- 修改版本号到1.1.0
- 代码格式化

## 1.0.4 - 2026-04-25  ([#6](https://github.com/mekefly/colors/pull/6))

#### ✨ 新功能

- 当不在ztools中启动时提供文档提示

#### 🐛 Bug 修复

- 修复了颜色选取条的异常情况

#### 🔧 杂务

- 部分 let 改为 const 声明变量
- 版本管理器切换为了npm
- 不想在手动更新agent文件了，所以就先从仓库里删除了
- 更新版本信息

#### 📝 其他

- 修改package
- 不直接从@ztools-center/ztools-api-types引入api而是经过window

## 1.0.3 - 2026-04-24  ([#5](https://github.com/mekefly/colors/pull/5))

#### ✨ 新功能

- 修改默认颜色
- 减少颜色轮盘的更新行为

#### 🔧 杂务

- 更新文档
- 更新版本信息

## 1.0.2 - 2026-04-24  ([#4](https://github.com/mekefly/colors/pull/4))

#### ✨ 新功能

- 优化，使颜色轮盘更好用

#### 🐛 Bug 修复

- 修复复制时通知的错误
- hsv中的v写死的bug，色盘颜色对比度不足的问题

#### 🔧 杂务

- 删除遗留的console.log
- 删除一些暂时没用启用的代码

## 1.0.1 - 2026-04-24  ([#3](https://github.com/mekefly/colors/pull/3))

#### 📝 其他

- 颜色助手已完成
- 优化显示异常
- 颜色助手发布1.0.1版本
- 不再使用vite-plus,更换为了vite
- 修复去掉hash按钮的bug

---
此文件由 [git-cliff](https://github.com/orhun/git-cliff) 配置 + 脚本自动生成。

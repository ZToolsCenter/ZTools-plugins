# 电商设计插件市场设计规格

## 背景

KeyDock/ZTools 已具备插件市场、分类导航、远程版本缓存、插件安装升级和分类详情页能力。KeyDock-plugins 仓库通过 `categories-mapping.json`、`layout.yaml`、`plugins/<plugin-id>/plugin.json` 或 `plugins/<plugin-id>/public/plugin.json` 生成 `release/plugins.json` 与 `release/categories.json`。

电商设计用户的高频痛点集中在商品图规范、批量处理、SKU 素材交付、详情页切图和营销素材生成。该领域适合以插件市场独立板块承载：市场负责发现和组合，插件负责单点工作流。

## 目标

在插件市场新增“电商设计”板块，并围绕电商设计师、运营设计、店铺美工和商品运营的日常工作流规划一组可独立安装的插件。

首版目标：

- 插件市场首页出现“电商设计”入口。
- 电商设计分类页可展示垂直插件集合。
- 首批插件规划能覆盖商品主图检查、批量处理、SKU 素材整理、营销图模板生成。
- 新插件遵循 KeyDock-plugins 现有构建、发布和安装机制。

## 非目标

- 首版不改造插件安装协议。
- 首版不引入新的后端服务。
- 首版不强依赖在线 AI 能力；AI 能力作为后续增强。
- 首版不一次性实现所有平台规范，先以可配置预设承载淘宝/天猫、京东、拼多多、抖音、小红书等常见规则。

## 用户与场景

主要用户：

- 电商设计师：处理商品主图、详情页、活动图、平台尺寸规范。
- 运营设计/店铺美工：批量改图、压缩、套模板、导出上传包。
- 商品运营：检查素材是否齐全，按 SKU 命名和整理。

核心场景：

- 拖入一批商品图，快速判断尺寸、格式、主体比例、白底和文件大小是否合格。
- 将一组商品图导出成不同平台要求的尺寸和格式。
- 按 SKU、颜色、尺码整理素材目录并检查缺图。
- 用模板快速生成主图卖点贴、促销角标和活动横幅。

## 市场板块设计

新增一级分类：

```json
{
  "key": "ecommerce-design",
  "title": "电商设计",
  "description": "商品图、详情页、主图规范与营销素材工具",
  "icon": "https://raw.githubusercontent.com/ZToolsCenter/ZTools-plugins/refs/heads/main/icons/ecommerce-design.png",
  "list": []
}
```

首页导航将 `ecommerce-design` 放在 `media` 之后、`text` 之前。原因是电商设计和图像媒体相邻，但比通用媒体更垂直。

分类详情页建议使用独立布局：

```yaml
ecommerce-design:
  - type: fixed
    title: 电商设计精选
    plugins:
      - ecommerce-image-spec
      - product-image-batch
      - sku-asset-organizer
      - ecommerce-poster-maker
  - type: list
    title: 全部电商设计工具
```

## 插件矩阵

### 1. ecommerce-image-spec

中文名：商品主图规范检查

定位：检查并处理商品主图是否符合平台上传要求。

首版能力：

- 支持拖入图片文件或文件夹。
- 检查尺寸、宽高比、格式、文件大小、透明通道、主体留白。
- 支持平台预设：通用方图、淘宝/天猫、京东、拼多多、抖音、小红书。
- 输出检查结果列表和可修复项。
- 对可修复项提供一键处理：画布补边、居中、转格式、压缩、重命名。

插件触发：

- `商品主图检查`
- `主图规范`
- 图片文件触发
- 图片文件夹触发

### 2. product-image-batch

中文名：商品图批量处理

定位：面向电商素材的批量改图与多平台导出。

首版能力：

- 批量压缩、改尺寸、转格式、加水印。
- 批量生成多平台尺寸包。
- 支持输出 WebP/JPG/PNG。
- 支持统一画布、裁切、补边、背景色。
- 保留原图目录结构或按平台输出目录。

插件触发：

- `商品图批处理`
- `电商批量改图`
- 图片文件触发
- 文件夹触发

### 3. sku-asset-organizer

中文名：SKU 素材整理

定位：将商品素材按 SKU、颜色、尺码和平台要求整理成交付包。

首版能力：

- 扫描目录中的图片素材。
- 支持用户导入 CSV/TSV SKU 表。
- 按 SKU 编码、颜色、尺码重命名。
- 检查缺图、重复图、命名冲突。
- 导出标准目录结构和缺失报告。

插件触发：

- `SKU素材整理`
- `商品素材整理`
- 文件夹触发
- CSV/TSV 文件触发

### 4. ecommerce-poster-maker

中文名：电商营销图生成器

定位：用模板快速生成活动图、卖点图、促销角标和商品卡片。

首版能力：

- 提供主图卖点贴、促销角标、优惠券图、横幅、商品卡片模板。
- 支持上传商品图、输入商品名/价格/卖点。
- 支持平台尺寸预设。
- 支持批量套模板导出。
- 模板数据本地保存。

插件触发：

- `电商营销图`
- `活动图生成`
- 图片文件触发

## 插件元数据规范

电商设计插件应统一声明：

```json
{
  "categories": ["ecommerce-design", "media"]
}
```

涉及文本、表格或数据生成的插件可额外加入：

```json
{
  "categories": ["ecommerce-design", "productivity"]
}
```

插件标题建议使用中文工作流名，插件 `name` 使用英文短横线命名。`features[].cmds` 必须包含中文关键词和文件触发配置，方便主搜索框直接进入插件。

## KeyDock 主仓库影响

首版不要求修改 KeyDock 主仓库。现有 `PluginMarketAPI` 已支持：

- 获取 `plugins.json`、`categories.json`、`layout.yaml`。
- 生成首页 storefront。
- 生成分类详情页布局。
- 平台过滤和缓存。

可选增强：

- 分类页增加标签筛选，如“图片处理”“平台规范”“模板生成”“素材交付”。
- 插件卡片展示 `tags` 字段。
- 分类页支持 banner 区域。

这些增强不阻塞电商设计板块首版上线。

## 发布与构建

KeyDock-plugins 侧继续使用现有脚本：

```bash
npm run detect:all
npm run build
npm run generate
```

构建结果应包含：

- `release/plugins.json`
- `release/categories.json`
- `release/layout.yaml`
- 对应插件 zip 包
- `release/latest`

## 风险与处理

- 平台规范变动：将规范做成本地 JSON 预设，后续可独立更新插件版本。
- 图片处理性能：优先使用浏览器 Canvas 实现轻量处理；需要高质量批处理时再引入 `sharp` 或复用运行时包。
- 插件重叠：`product-image-batch` 和现有 `imgbatch` 有相似能力，但前者聚焦电商平台尺寸和交付包，不做通用图片全能工具。
- AI 成本和稳定性：首版模板化、规则化，AI 文案和抠图作为后续增强。

## 验收标准

- `categories-mapping.json` 包含 `ecommerce-design` 分类。
- `layout.yaml` 首页导航包含 `ecommerce-design`。
- 电商设计分类详情布局存在。
- 首批插件的 `plugin.json` 均包含 `categories` 字段。
- 执行生成脚本后，`release/categories.json` 中有“电商设计”分类及插件列表。
- KeyDock 插件市场能展示该分类和插件卡片。

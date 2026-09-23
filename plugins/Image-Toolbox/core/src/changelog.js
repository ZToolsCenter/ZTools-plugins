/**
 * changelog.js — 面向用户的版本更新记录（唯一一份版本号数据源）
 *
 * ═══ 版本号单一事实来源（Single Source of Truth）═══
 *
 * APP_VERSION 是「插件版本号」的唯一权威定义，对应发布到 uTools / ZTools
 * 应用市场的版本。以下位置必须始终与它保持一致：
 *
 *   clients/utools/plugin.json     ← uTools 市场读取的发布版本
 *   clients/ztools/plugin.json     ← ZTools 市场读取的发布版本
 *   package.json                   ← 仓库发布版本（与 plugin.json 同源）
 *   README.md / agents.md          ← 文档中的「当前版本」
 *
 * 构建脚本 build.ps1 的 Test-AppVersion 会逐项比对并在不一致时直接构建失败。
 *
 * 本文件取代了历史上的 core/src/updateRecords.js：
 *   - 记录数组从 updateRecords 改名为 CHANGELOG，专门表示「更新记录」，
 *     不再承担「当前版本」的职责（过去「关于」页正是取它首条当版本号，
 *     导致插件内显示 1.2.3、市场显示 2.3.2 的错乱）；
 *   - 当前版本统一由 APP_VERSION / getAppVersion() 提供。
 *
 * ═══ 发版检查清单 ═══
 *
 *   1. 更新 APP_VERSION（仅这一处）
 *   2. 在 CHANGELOG 顶部插入同版本号的记录条目
 *   3. 同步两个 plugin.json 的 version 与 package.json 的 version
 *   4. 同步 README.md / agents.md 中的「当前版本」
 *   5. 执行 .\build.ps1，构建期校验通过才算发版完成
 *
 * ═══ 文案规范 ═══
 *
 *   记录只写用户可见的现象，不写实现细节、内部原因与受影响代码范围；
 *   一条一行，能用一句话说清就不拆成多条。详见 agents.md §7.5。
 */

/**
 * 插件当前版本号（唯一权威定义）。
 *
 * 修改此处即代表发版意图，其余引用点由构建期校验强制同步。
 * @type {string}
 */
export const APP_VERSION = '2.5.0';

/**
 * 版本记录条目结构
 * @typedef {Object} ChangelogRecord
 * @property {string} version - 版本号（不含 v 前缀）
 * @property {string} date - 发布日期 YYYY-MM-DD
 * @property {Object} changes - 分类变更，键见 updateCategories
 */

/**
 * 用户可见的版本更新记录（按版本从新到旧排列，最新一条在最上面）。
 *
 * 发布后不可更改：已发布的版本条目视为只读，不得修改或删除。
 * @type {ChangelogRecord[]}
 */
export const CHANGELOG = [
  {
    version: '2.5.0',
    date: '2026-09-23',
    changes: {
      added: [
        { text: '调色预设改为效果图卡片，直接显示当前图层的调色效果', platforms: null },
        { text: '新增贴纸功能，支持从本地添加图片图层', platforms: null },
        { text: '橡皮擦新增框选模式，拖拽框选即可一次擦除整片区域', platforms: null }
      ],
      fixed: [
        { text: '修复保存图片或 ORA 工程文件失败时没有任何提示的问题', platforms: null },
        { text: '修复 Web 版网页打开后样式丢失、ORA 工程文件无法导入导出的问题', platforms: ['web'] }
      ],
      improved: [
        { text: 'Web 版链接中的图片参数增加来源校验，不再加载外部站点的图片', platforms: ['web'] }
      ],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.4.3',
    date: '2026-08-31',
    changes: {
      added: [
        { text: '图形工具新增五边形', platforms: null }
      ],
      fixed: [
        { text: '修复撤销/重做、打开新图片、导入 ORA 后画笔光标指示丢失的问题', platforms: null },
        { text: '修复「保存」格式弹窗在深色模式下显示异常的问题', platforms: null },
        { text: '修复文字预设按钮在深色模式下显示过亮的问题', platforms: null }
      ],
      improved: [
        { text: '画笔光标指示增强对比度，并增加中心点提示落笔位置', platforms: null }
      ],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.4.2',
    date: '2026-08-28',
    changes: {
      added: [
        { text: '新增 ORA (OpenRaster) 工程文件导入/导出功能，可保存含图层的完整编辑状态', platforms: null }
      ],
      fixed: [
        { text: '修复使用马赛克、橡皮擦等工具后，鼠标变成移动状态，绘制第二个选区时会移动图层的问题', platforms: null },
      ],
      improved: [
        { text: '底部状态栏新增「打开」按钮，支持选择 ORA 工程文件和 WebP / JPG / PNG 等常见图片格式', platforms: null },
        { text: '底部状态栏「保存」按钮弹出格式选择窗口，可一键保存为 ORA、PNG、JPEG 或 WebP', platforms: null }
      ],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.4.1',
    date: '2026-08-21',
    changes: {
      added: [],
      fixed: [
        { text: '修复通过功能指令进入插件时图片无法加载的问题', platforms: ['utools', 'ztools'] },
        { text: '修复部分字体名称显示不正确的问题', platforms: null },
        { text: '修复部分 Windows 平台无法获取系统字体列表的问题', platforms: ['utools', 'ztools'] },
        { text: '修复大图片加载时可能超时失败的问题', platforms: ['utools', 'ztools'] },
        { text: '修复重复进入插件时图片可能无法加载的问题', platforms: ['utools', 'ztools'] }
      ],
      improved: [
        { text: '滚轮缩放改为以鼠标位置为中心进行缩放', platforms: null },
        { text: '图片加载超时反馈更快', platforms: null }
      ],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.4',
    date: '2026-08-04',
    changes: {
      added: [
        { text: '左侧工具栏支持展开/收起', platforms: null },
        { text: '图形工具新增菱形图形', platforms: null },
        { text: '新增「接入统一账号系统」功能', platforms: null }
      ],
      fixed: [
        { text: '修复窗口大小缩放时，已添加的文字、图形、画笔、马赛克等编辑内容与原图错位的问题', platforms: null },
        { text: '修复使用调色工具调整滤镜滑块后无法撤销的问题', platforms: null },
        { text: '修复调色面板销毁时未清理 DOM 事件监听器导致的内存泄漏问题', platforms: null },
        { text: '修复马赛克工具辅助图形（选区框、套索预览、画笔预览）出现在导出结果和图层列表中的问题', platforms: null }
      ],
      improved: [
        { text: '图形工具配色预设栏支持左右滑动查看更多配色，粗细按钮固定在右侧不被压缩', platforms: null },
        { text: '优化应用滤镜预设时的性能，批量设置时只重算一次滤镜，响应更迅速', platforms: null },
        { text: '优化窗口缩放时编辑内容的布局保持逻辑，按比例同步调整所有覆盖层和裁剪路径的相对位置', platforms: null }
      ],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.3.1',
    date: '2026-07-17',
    changes: {
      added: [
        { text: '设置页新增「侧栏图标文字」选项，可控制侧栏工具图标下方文字标签的展示', platforms: null }
      ],
      fixed: [
        { text: '修复调色面板长时间使用后内存占用持续上升的问题', platforms: null },
        { text: '修复平行四边形绘制时实际宽度超出拖拽框选范围的问题', platforms: null },
        { text: '修复调色面板滑块调整后无法撤销的问题', platforms: null },
        { text: '修复 ZTools 平台错误使用 uTools 宿主适配器导致的功能异常', platforms: ['ztools'] }
      ],
      improved: [
        { text: '优化了展示效果', platforms: null }
      ],
      adjusted: [
        { text: '修改了部分文字工具预设按钮名称并调大字体', platforms: null }
      ],
      removed: []
    }
  },
  {
    version: '2.3',
    date: '2026-07-09',
    changes: {
      added: [
        { text: '新增「调色」工具，支持滤镜预设以及亮度、对比度、饱和度、色相、模糊等参数调整', platforms: null }
      ],
      fixed: [
        { text: '修复图形工具拖选绘制时部分情况下意外移动图层的问题', platforms: null },
        { text: '修复添加文字后第一次撤销无反应的问题', platforms: null },
        { text: '修复撤销/重做时偶尔出现画布状态异常的问题', platforms: null },
        { text: '修复切换或停用工具后，已锁定图层可能被意外解锁的问题', platforms: null },
        { text: '修复使用画笔、图形、马赛克等工具新建图层后，切回移动/框选工具无法直接选中图层的问题', platforms: null },
        { text: '修复移动/框选工具选中背景图片后，无法调整宽高、位置、旋转或拖拽变换的问题', platforms: null },
        { text: '修复使用文字工具编辑文字时，按快捷键会意外切换工具的问题', platforms: null }
      ],
      improved: [],
      adjusted: [
      ],
      removed: []
    }
  },
  {
    version: '2.2.2',
    date: '2026-06-29',
    changes: {
      added: [
        { text: '图形工具新增平行四边形图形', platforms: null },
        { text: '文字属性新增删除线复选框', platforms: null }
      ],
      fixed: [
        { text: '修复部分编辑操作第一次撤销无反应的问题', platforms: null },
        { text: '修复打开新图片后撤销可能恢复上一张图片的问题', platforms: null },
        { text: '修复选择 JPEG/WebP 保存时实际仍写入 PNG 数据的问题', platforms: null },
        { text: '修复 ZTools 端选中文字后缺少描边位置设置的问题', platforms: ['ztools'] },
        { text: '修复裁剪撤销/重做时裁剪范围恢复不正确的问题', platforms: null },
        { text: '修复清除所有马赛克后无法撤销恢复的问题', platforms: null }
      ],
      improved: [],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.2.1',
    date: '2026-06-26',
    changes: {
      added: [
        { text: '图形工具新增三角形和双箭头图形', platforms: null },
        { text: '文字描边新增位置参数，支持外部和内部两种描边位置', platforms: null }
      ],
      fixed: [
        { text: '修复橡皮擦工具激活时切换图层后，橡皮擦仍作用在原图层的问题', platforms: null },
        { text: '修复首次进入文字工具时界面卡顿数秒的问题，改为异步加载系统字体列表', platforms: null },
        { text: '修复撤销/重做时历史记录损坏导致画布状态异常的问题', platforms: null },
        { text: '修复切换/停用工具时图层被意外解锁的问题', platforms: null }
      ],
      improved: [],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.2',
    date: '2026-06-23',
    changes: {
      added: [
        { text: '新增 ZTools 客户端，可按 ZTools 插件规范独立加载图片工具箱', platforms: ['ztools'] },
        { text: '新增图形工具，支持绘制矩形、圆形、星星、心形、梯形、直线、箭头等多种图形', platforms: null },
        { text: '图形工具支持自定义填充色、边框色、边框宽度，拖拽绘制即可创建图形', platforms: null },
        { text: '图形工具组新增属性面板入口，支持在预设栏和属性面板同步切换图形', platforms: null },
        { text: '图形属性栏支持分别设置填充不透明度和描边不透明度', platforms: null }
      ],
      fixed: [
        { text: '修复马赛克图层旋转后马赛克范围不准确的问题', platforms: null },
        { text: '修复马赛克图层拉伸后马赛克块大小被错误拉伸或压缩的问题', platforms: null },
        { text: '修复星形、心形、梯形、箭头等图形绘制偏移、畸形或显示不准确的问题', platforms: null },
        { text: '修复直线和箭头在水平或垂直拖拽时可能无法创建的问题', platforms: null }
      ],
      improved: [
        { text: '优化图形工具组选型窗口，改用 SVG 缩略图显示真实图形效果', platforms: null },
        { text: '优化图形预设栏颜色，合并填充色和边框色为一套样式预设并改为上图案下文字布局', platforms: null },
        { text: '图形颜色预设会同时应用填充不透明度和描边不透明度', platforms: null },
        { text: '优化橡皮擦工具，拖动过程中实时显示擦除效果', platforms: null }
      ],
      adjusted: [
        { text: '图形工具将仅描边预设调整为首位并作为默认样式', platforms: null }
      ],
      removed: []
    }
  },
  {
    version: '2.1.1',
    date: '2026-06-15',
    changes: {
      added: [
        { text: '马赛克工具新增自由选区模式，支持非矩形区域马赛克/模糊', platforms: null }
      ],
      fixed: [
        { text: '修复橡皮擦擦除画笔图层后，图层名称被错误重置为马赛克的问题', platforms: null }
      ],
      improved: [
        { text: '优化马赛克画笔模式，鼠标悬停/涂抹时显示画笔位置，涂抹过程中实时显示马赛克效果', platforms: null },
        { text: '优化图层默认名称展示，文字/画笔/马赛克图层会按内容和预设生成更清晰的名称', platforms: null }
      ],
      adjusted: [
        { text: '马赛克图层改为动态重算，移动图层时会根据新的下方内容重新生成效果', platforms: null },
        { text: '马赛克工具默认预设调整为矩形 + 中马赛克', platforms: null }
      ],
      removed: []
    }
  },
  {
    version: '2.1',
    date: '2026-06-13',
    changes: {
      added: [
        { text: '新增画笔工具，支持自由涂鸦、颜色预设和粗细调整', platforms: null },
        { text: '新增橡皮擦工具，支持大小预设和撤销/重做', platforms: null },
        { text: '新增非矩形裁剪工具', platforms: null },
        { text: '文字字体列表支持读取并显示用户系统中已安装的字体', platforms: null },
        { text: '移动/框选预设栏新增旋转0°/90/180/270与左右/前后翻转快捷操作', platforms: null }
      ],
      fixed: [],
      improved: [
        { text: '优化了裁剪工具的使用体验', platforms: null },
        { text: '字体列表按用户实际使用频率自动排序', platforms: null }
      ],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.0',
    date: '2026-06-12',
    changes: {
      added: [
        { text: '右侧面板新增切换状态，可切换tab布局或上下布局', platforms: null },
        { text: '新增"预设栏"和"状态栏"位置切换功能', platforms: null },
        { text: '新增属性/图层面板位置切换，可将侧栏移到左侧', platforms: null }
      ],
      fixed: [
        { text: '修复首次裁剪后再次剪切时，裁剪框被上一轮裁剪范围裁掉的问题', platforms: null },
        { text: '修复第二次裁剪被错误重置为原图范围、未基于首次裁剪继续裁剪的问题', platforms: null },
        { text: '修复旋转裁剪框后应用剪切仍按未旋转矩形生效的问题', platforms: null },
        { text: '修复裁剪后马赛克拖选框被错误裁掉、不能显示到图像外的问题', platforms: null }
      ],
      improved: [],
      adjusted: [
        { text: '将深色浅色切换调整到了"设置"页面', platforms: null },
        { text: '将"选项栏"与"属性栏"合并', platforms: null },
        { text: '原"选项栏"调整为"预设栏"', platforms: null }
      ],
      removed: [
        { text: '移除了"剪切"工具属性的异常参数', platforms: null }
      ]
    }
  },
  {
    version: '1.0',
    date: '2026-06-10',
    changes: {
      added: [
        { text: '发布了第一个可用版本，支持图片导入、马赛克、裁切、文字标注和导出', platforms: null },
        { text: '搭建五区编辑器布局：工具栏、选项栏、画布区、属性/图层面板和状态栏', platforms: null }
      ],
      fixed: [],
      improved: [],
      adjusted: [],
      removed: []
    }
  }

];

export const updateCategories = [
  { key: 'added', title: '新增' },
  { key: 'fixed', title: '修复' },
  { key: 'improved', title: '优化' },
  { key: 'adjusted', title: '调整' },
  { key: 'removed', title: '去除' }
];

/**
 * 平台常量
 * null: 所有平台通用
 * ['utools']: 仅 uTools
 * ['ztools']: 仅 ZTools
 * ['utools', 'ztools']: uTools 和 ZTools
 */
export const PLATFORMS = {
  ALL: null,           // 所有平台
  UTOOLS: 'utools',    // uTools 专用
  ZTOOLS: 'ztools',    // ZTools 专用
  LOCAL: 'local',      // 本地环境
};

/**
 * 读取插件当前版本号。
 *
 * 「关于」页、更新记录页等一切需要展示插件自身版本的地方都必须走本函数，
 * 不要再从更新记录里取第一条当版本号。
 *
 * @returns {string} 形如 '2.5.0' 的版本号（不含 v 前缀）
 */
export function getAppVersion() {
  return APP_VERSION;
}

/**
 * 读取版本更新记录。
 * @returns {ChangelogRecord[]}
 */
export function getChangelog() {
  return CHANGELOG;
}

/**
 * 取最近一条更新记录（用于「最新更新」摘要，不用于版本号展示）。
 * @returns {ChangelogRecord|null}
 */
export function getLatestChangelogRecord() {
  return CHANGELOG.length > 0 ? CHANGELOG[0] : null;
}
